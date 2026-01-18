const fs = require('fs');
const os = require('os');
const path = require('path');

// NOTE: This fork intentionally avoids importing ./scp.js here.
// Some printers (e.g. Creality Hi) don't expose SFTP, so upload settings
// should only be validated when we actually upload.

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

// Prefer /filament/base when present (author’s intent), but some builds store
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

const wrapScalarsAsArrays = (profile) => {
  // Creality exports often store values as scalars; downstream expects arrays.
  // Only wrap non-object values.
  for (const key of Object.keys(profile)) {
    const v = profile[key];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) continue;
    if (typeof v === 'object') continue;
    profile[key] = [v];
  }
  return profile;
};

const checkCrealityFormatting = (profiles) => {
  return profiles.map((p) => wrapScalarsAsArrays(p));
};

// Try "6.0" first (as documented), otherwise pick highest numeric version folder if present.
const pickCrealityVersionDir = (crealityPrintBaseDir) => {
  const preferred = path.join(crealityPrintBaseDir, '6.0');
  if (isDir(preferred)) return preferred;

  if (!isDir(crealityPrintBaseDir)) return null;

  const entries = fs
    .readdirSync(crealityPrintBaseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const versionDirs = entries.filter((n) => /^\d+(\.\d+)*$/.test(n));
  if (!versionDirs.length) return null;

  // Sort descending by numeric components
  versionDirs.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return db - da;
    }
    return 0;
  });

  return path.join(crealityPrintBaseDir, versionDirs[0]);
};

const getFilamentRootDir = ({ osType, homeDir, slicer, userId }) => {
  if (slicer !== 'orca' && slicer !== 'creality') {
    throw new Error(
      `Invalid SLICER value: "${slicer}". Expected "orca" or "creality".`
    );
  }

  if (osType === 'Windows_NT') {
    if (slicer === 'orca') {
      return path.join(
        homeDir,
        'AppData',
        'Roaming',
        'OrcaSlicer',
        'user',
        userId,
        'filament'
      );
    }
    const base = path.join(
      homeDir,
      'AppData',
      'Roaming',
      'Creality',
      'Creality Print'
    );
    const verDir = pickCrealityVersionDir(base);
    if (!verDir) return null;
    return path.join(verDir, 'user', userId, 'filament');
  }

  if (osType === 'Darwin') {
    if (slicer === 'orca') {
      return path.join(
        homeDir,
        'Library',
        'Application Support',
        'OrcaSlicer',
        'user',
        userId,
        'filament'
      );
    }
    const base = path.join(
      homeDir,
      'Library',
      'Application Support',
      'Creality',
      'Creality Print'
    );
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

// Notes are required upstream; this fork can auto-generate notes if missing.
const getNotesString = (profile) => {
  const notes = profile?.filament_notes;
  if (Array.isArray(notes)) return String(notes[0] ?? '');
  if (typeof notes === 'string') return notes;
  return '';
};

const notesLooksEmpty = (notesStr) => {
  const t = String(notesStr ?? '').trim();
  return t === '' || t === '""';
};

const safeFirst = (v) => (Array.isArray(v) ? v[0] : v);

// Create a stable-ish 5-digit numeric ID from a string (FNV-1a -> mod).
const stableFiveDigitId = (s) => {
  const str = String(s ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 10000..99999
  const id = (Math.abs(h) % 90000) + 10000;
  return String(id);
};

const deriveTypeFromInherits = (inherits) => {
  const s = String(inherits ?? '').toLowerCase();
  const m = s.match(/fdm_filament_([a-z0-9_]+)/);
  if (!m) return '';
  return m[1].toUpperCase();
};

const autoGenerateNotes = (profile) => {
  const name = safeFirst(profile?.name) || 'Custom Filament';
  const vendor = safeFirst(profile?.filament_vendor) || 'Custom';
  const type = safeFirst(profile?.filament_type) || deriveTypeFromInherits(safeFirst(profile?.inherits)) || 'CUSTOM';
  const id = stableFiveDigitId(`${vendor}|${type}|${name}`);
  const notesObj = { id, vendor, type, name };
  const notesStr = JSON.stringify(notesObj);

  // Creality formatting typically uses arrays.
  profile.filament_notes = [notesStr];

  console.warn(
    `[Filament-Sync] Auto-generated filament_notes for "${vendor} ${name}" with id=${id}. ` +
      'If you use RFID tags, write this ID down.'
  );
};

const loadCustomProfiles = () => {
  const { osType, homeDir } = getOSInfo();
  const slicer = String(SLICER || '').toLowerCase();
  const userId = String(USERID || '');

  if (!userId) {
    throw new Error('USERID is blank. Create user-config.js from user-config.example.js.');
  }

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
      `Filament preset folder not found for ${slicer}.\nTried:\n  ${path.join(
        filamentRoot,
        'base'
      )}\n  ${filamentRoot}\n`
    );
  }

  dlog('Selected slicer:', slicer);
  dlog('Filament root:', filamentRoot);
  dlog('Custom dir:', customDir);

  const profiles = readProfilesFromDir(customDir);
  loadedProfiles = slicer === 'creality' ? checkCrealityFormatting(profiles) : profiles;
};

const hasRequiredNotes = (profile) => {
  const notesStr = getNotesString(profile);
  if (notesLooksEmpty(notesStr)) return false;

  // Bonus sanity: must be valid JSON after trimming.
  try {
    JSON.parse(notesStr);
    return true;
  } catch {
    return false;
  }
};

const describeProfile = (p) => {
  const vendor = safeFirst(p?.filament_vendor) || p?.vendor || 'UnknownVendor';
  const name = safeFirst(p?.name) || p?.filament_name || 'UnknownName';
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
      continue;
    }

    // Try to auto-generate notes if possible.
    autoGenerateNotes(p);
    if (hasRequiredNotes(p)) {
      filteredProfiles.push(p);
      continue;
    }

    console.error('Ignoring Filament', describeProfile(p), "since it's missing required filament notes.");
    console.error('Check the instructions for info on how to add them:');
    console.error('https://github.com/HurricanePrint/Filament-Sync#creating-custom-filament-presets');
  }

  dlog(`Filtered profiles kept: ${filteredProfiles.length}/${loadedProfiles.length}`);
};

const readProfiles = () => {
  return filteredProfiles;
};

const initData = () => {
  // Reset state each run
  loadedProfiles = [];
  filteredProfiles = [];

  // Ensure ./data exists (other tools write output here)
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  loadCustomProfiles();
  filterProfiles();
};

module.exports = { initData, readProfiles };
