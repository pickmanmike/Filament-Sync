const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, 'sourcedata');
const defaultDatabaseFile = fs.readFileSync(path.join(SOURCE_DIR, 'material_database.json'), 'utf8');
const defaultOptionFile = fs.readFileSync(path.join(SOURCE_DIR, 'material_option.json'), 'utf8');

// Upload layer (we keep sendFiles for compatibility)
const { sendFiles, sendToPrinter: sendToPrinterFromScp } = require('./scp');

const { SLICER, USERID } = require('../user-config');

let loadedProfiles = [];
let filteredProfiles = [];

// Optional debug logging: set FILAMENT_SYNC_DEBUG=1
const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const dlog = (...args) => {
  if (DEBUG) console.log('[Filament-Sync]', ...args);
};

const getOSInfo = () => {
  return {
    osType: os.type(),
    homeDir: os.userInfo().homedir,
  };
};

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Prefer /filament/base when present (author's intent), but some builds store
// custom presets directly under /filament. Fall back gracefully.
const resolveCustomFilamentDir = (filamentRootDir) => {
  const baseDir = path.join(filamentRootDir, 'base');

  if (isDir(baseDir)) return baseDir;
  if (isDir(filamentRootDir)) {
    console.warn(`[Filament-Sync] Base folder not found: ${baseDir}`);
    console.warn(`[Filament-Sync] Falling back to: ${filamentRootDir}`);
    return filamentRootDir;
  }
  return null;
};

const listJsonFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => name.toLowerCase().endsWith('.json'));
};

const readProfilesFromDir = (dir) => {
  const files = listJsonFiles(dir);
  dlog(`Reading ${files.length} profile file(s) from:`, dir);

  const profiles = [];
  for (const filename of files) {
    const fullPath = path.join(dir, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    profiles.push(JSON.parse(raw));
  }
  return profiles;
};

/**
 * Creality presets are inconsistent:
 * - some keys are scalars (string/number/bool)
 * - some keys are arrays (as Orca-style expects)
 *
 * The old logic used "first value decides everything", which can double-wrap arrays:
 *   ["{...}"] -> [["{...}"]]
 *
 * This version:
 * - wraps ONLY non-arrays into [value]
 * - "heals" accidental double-wrap [[x]] -> [x]
 */
const normalizeCrealityProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return profile;

  const out = {};
  for (const [key, value] of Object.entries(profile)) {
    if (Array.isArray(value)) {
      // Heal common accidental double-wrap
      if (value.length === 1 && Array.isArray(value[0])) out[key] = value[0];
      else out[key] = value;
    } else {
      out[key] = [value];
    }
  }
  return out;
};

const checkCrealityFormatting = (profiles) => profiles.map(normalizeCrealityProfile);

// Choose a Creality Print version folder.
// Priority:
//   1) CREALITY_PRINT_VERSION override (exact match)
//   2) Version that appears to contain your presets (base folder count, then root count)
//   3) Highest numeric version
const pickCrealityVersionDir = (crealityPrintBaseDir) => {
  const override = String(process.env.CREALITY_PRINT_VERSION || '').trim();
  if (override) {
    const cand = path.join(crealityPrintBaseDir, override);
    if (isDir(cand)) return cand;
    console.warn('[Filament-Sync] CREALITY_PRINT_VERSION=' + override + ' not found under ' + crealityPrintBaseDir + '; falling back to autodetect.');
  }

  if (!isDir(crealityPrintBaseDir)) return null;

  const entries = fs
    .readdirSync(crealityPrintBaseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const versionDirs = entries.filter((n) => /^\d+(\.\d+)*$/.test(n));
  if (!versionDirs.length) return null;

  const userId = String(USERID || '').trim();

  const countJson = (dir) => {
    try {
      return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')).length;
    } catch (_) {
      return 0;
    }
  };

  const numericDesc = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return db - da;
    }
    return 0;
  };

  // Score each version by how many presets exist for this USERID.
  // base folder count is weighted more heavily because Filament-Sync prefers base presets.
  const scored = versionDirs.map((v) => {
    if (!userId) return { v, baseCount: 0, rootCount: 0 };
    const filamentDir = path.join(crealityPrintBaseDir, v, 'user', userId, 'filament');
    const baseDir = path.join(filamentDir, 'base');
    return {
      v,
      baseCount: countJson(baseDir),
      rootCount: countJson(filamentDir),
    };
  });

  scored.sort((a, b) => {
    if (a.baseCount !== b.baseCount) return b.baseCount - a.baseCount;
    if (a.rootCount !== b.rootCount) return b.rootCount - a.rootCount;
    return numericDesc(a.v, b.v);
  });

  return path.join(crealityPrintBaseDir, scored[0].v);
};

const getFilamentRootDir = ({ osType, homeDir, slicer, userId }) => {
  if (slicer !== 'orca' && slicer !== 'creality') {
    throw new Error(`Invalid SLICER value: "${slicer}". Expected "orca" or "creality".`);
  }

  if (osType === 'Windows_NT') {
    if (slicer === 'orca') {
      return path.join(homeDir, 'AppData', 'Roaming', 'OrcaSlicer', 'user', userId, 'filament');
    }
    const base = path.join(homeDir, 'AppData', 'Roaming', 'Creality', 'Creality Print');
    const verDir = pickCrealityVersionDir(base);
    if (!verDir) return null;
    return path.join(verDir, 'user', userId, 'filament');
  }

  if (osType === 'Darwin') {
    if (slicer === 'orca') {
      return path.join(homeDir, 'Library', 'Application Support', 'OrcaSlicer', 'user', userId, 'filament');
    }
    const base = path.join(homeDir, 'Library', 'Application Support', 'Creality', 'Creality Print');
    const verDir = pickCrealityVersionDir(base);
    if (!verDir) return null;
    return path.join(verDir, 'user', userId, 'filament');
  }

  if (osType === 'Linux') {
    if (slicer === 'orca') {
      return path.join(homeDir, '.config', 'OrcaSlicer', 'user', userId, 'filament');
    }
    const base = path.join(homeDir, '.config', 'Creality', 'Creality Print');
    const verDir = pickCrealityVersionDir(base);
    if (!verDir) return null;
    return path.join(verDir, 'user', userId, 'filament');
  }

  throw new Error(`Unsupported OS type: ${osType}`);
};

const loadCustomProfiles = () => {
  const { osType, homeDir } = getOSInfo();
  const slicer = String(SLICER || '').toLowerCase();
  const userId = String(USERID || '');

  if (!userId) {
    throw new Error('USERID is blank. Set USERID in user-config.js.');
  }

  // Only resolve the selected slicer's folder.
  const filamentRoot = getFilamentRootDir({ osType, homeDir, slicer, userId });
  if (!filamentRoot) {
    throw new Error(
      `Could not locate ${slicer} filament root folder.\n` +
        `OS: ${osType}\nHOME: ${homeDir}\nUSERID: ${userId}\n`
    );
  }

  const customDir = resolveCustomFilamentDir(filamentRoot);
  if (!customDir) {
    throw new Error(
      `Filament preset folder not found for ${slicer}.\nTried:\n  ${path.join(filamentRoot, 'base')}\n  ${filamentRoot}\n`
    );
  }

  dlog('Selected slicer:', slicer);
  dlog('Filament root:', filamentRoot);
  dlog('Custom dir:', customDir);

  const profiles = readProfilesFromDir(customDir);

  loadedProfiles = slicer === 'creality' ? checkCrealityFormatting(profiles) : profiles;
};

const unwrapFirst = (v) => {
  let cur = v;
  while (Array.isArray(cur) && cur.length > 0) cur = cur[0];
  return cur;
};

const hasRequiredNotes = (profile) => {
  const note = unwrapFirst(profile?.filament_notes);

  if (typeof note !== 'string') return false;

  const s = note.trim();
  // Creality 7.0 has been observed to emit a literal '""' placeholder
  if (!s || s === '""') return false;

  return true;
};

const describeProfile = (p) => {
  const vendor =
    unwrapFirst(p?.filament_vendor) ||
    p?.vendor ||
    'UnknownVendor';

  const name =
    p?.name ||
    unwrapFirst(p?.filament_name) ||
    p?.filament_name ||
    'UnknownName';

  return `[${vendor} ${name}]`;
};

const filterProfiles = () => {
  filteredProfiles = [];

  if (!Array.isArray(loadedProfiles) || loadedProfiles.length === 0) {
    console.error('No profiles found in the selected custom profile directory.');
    process.exit(1);
  }

  for (const p of loadedProfiles) {
    if (hasRequiredNotes(p)) {
      filteredProfiles.push(p);
    } else {
      console.error('Ignoring Filament', describeProfile(p), "since it's missing required filament notes.");
      console.error('Check the instructions for info on how to add them:');
      console.error('https://github.com/HurricanePrint/Filament-Sync#creating-custom-filament-presets');
    }
  }

  dlog(`Filtered profiles kept: ${filteredProfiles.length}/${loadedProfiles.length}`);
};

const readProfiles = () => filteredProfiles;

const initData = () => {
  // Reset state each run
  loadedProfiles = [];
  filteredProfiles = [];

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const files = [
    { name: 'material_database.json', data: JSON.parse(defaultDatabaseFile) },
    { name: 'material_option.json', data: JSON.parse(defaultOptionFile) },
  ];

  for (const f of files) {
    fs.writeFileSync(path.join(dataDir, f.name), JSON.stringify(f.data, null, '\t'));
  }

  loadCustomProfiles();
  filterProfiles();
};

// Keep the old "sendToPrinter" name alive no matter what main.js imports.
const sendToPrinter = async () => {
  if (typeof sendToPrinterFromScp === 'function') return sendToPrinterFromScp();
  return sendFiles();
};

module.exports = { initData, readProfiles, sendToPrinter, sendFiles };
