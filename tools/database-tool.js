const fs = require('fs');
const path = require('path');

const { PRINTER_DB_PATH, REMOTE_BOX_DIR } = require('../user-config');
const cfg = require('../user-config');

const newMaterialTemplate = require('./sourcedata/newMaterial.json');

const { connectSSH, readRemoteFile } = require('./ssh-util');

const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const log = (...args) => console.log('[Filament-Sync][db]', ...args);
const dlog = (...args) => {
  if (DEBUG) log(...args);
};

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const unwrapFirst = (v) => (Array.isArray(v) ? v[0] : v);

const getNotesString = (profile) => {
  const n = profile?.filament_notes;
  if (Array.isArray(n)) return String(n[0] ?? '');
  if (typeof n === 'string') return n;
  return '';
};

const parseNotes = (profile) => {
  const raw = (getNotesString(profile) || '').trim();
  if (!raw || raw === '""') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const nowEpochSeconds = () => String(Math.floor(Date.now() / 1000));

const getPrinterConfig = () => {
  const host = cfg.PRINTER_IP || cfg.PRINTERIP || cfg.HOST || cfg.HOSTNAME;
  const port = Number(cfg.PORT || 22);
  const username = cfg.USER || 'root';
  const password = cfg.PASSWORD;

  if (!host || !password) return null;
  return { host, port, username, password };
};

const resolveRemotePaths = () => {
  const boxDir = cfg.REMOTE_BOX_DIR || '/mnt/UDISK/creality/userdata/box';
  const dbPath = cfg.PRINTER_DB_PATH || `${boxDir}/material_database.json`;
  return { boxDir, dbPath };
};

const loadJsonFile = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const loadBaseDatabase = async () => {
  // 1) Prefer reading the current DB off the printer (preserves OEM changes)
  const sshCfg = getPrinterConfig();
  const { dbPath } = resolveRemotePaths();
  if (sshCfg) {
    try {
      const conn = await connectSSH(sshCfg);
      try {
        const raw = await readRemoteFile(conn, dbPath);
        const json = JSON.parse(raw);
        dlog(`Loaded base DB from printer: ${dbPath}`);
        return json;
      } finally {
        conn.end();
      }
    } catch (e) {
      dlog(`WARN: couldn't read base DB from printer (${e.message.split('\n')[0]}). Falling back.`);
    }
  }

  // 2) Fall back to repo sourcedata (works offline, but may get stale)
  const fallbackPath = path.join(__dirname, 'sourcedata', 'material_database.json');
  const json = loadJsonFile(fallbackPath);
  dlog(`Loaded base DB from repo: ${fallbackPath}`);
  return json;
};

const getList = (dbObj) => {
  const list = dbObj?.result?.list;
  if (!Array.isArray(list)) {
    throw new Error(
      'Unexpected material_database.json shape: expected obj.result.list to be an array.'
    );
  }
  return list;
};

const findById = (list, id) => {
  return list.findIndex((m) => String(unwrapFirst(m?.id) ?? '') === String(id));
};

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

const normalizeToArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return v;
  // Keep objects as-is (rare in Creality exports)
  if (typeof v === 'object') return v;
  return [v];
};

const buildMaterialFromProfile = (profile, notesObj) => {
  const mat = deepClone(newMaterialTemplate);

  // Copy all profile keys first (so our identity fields override afterwards)
  for (const [k, v] of Object.entries(profile || {})) {
    mat[k] = normalizeToArray(v);
  }

  // Required identity fields (what the printer UI actually keys on)
  const id = String(notesObj.id);
  const name = String(notesObj.name);
  const vendor = String(notesObj.vendor);
  const type = String(notesObj.type);

  mat.id = [id];
  mat.name = [name];
  mat.filament_id = [id];
  mat.filament_vendor = [vendor];
  mat.filament_type = [type];
  mat.filament_settings_id = [name];
  mat.from = ['User'];
  mat.is_custom_defined = [0];
  mat.filament_notes = [JSON.stringify({ id, vendor, type, name })];

  return mat;
};

const addToDatabase = async (profiles) => {
  ensureDataDir();

  const dbObj = await loadBaseDatabase();
  const list = getList(dbObj);
  const startingCount = Number(dbObj?.result?.count ?? list.length);

  log(`Starting DB list length: ${list.length} (count=${startingCount})`);
  log(`Profiles to apply: ${profiles.length}`);

  let added = 0;
  let updated = 0;

  for (const p of profiles) {
    const notesObj = parseNotes(p);
    if (!notesObj || !notesObj.id) {
      log('SKIP: profile missing/invalid filament_notes:', unwrapFirst(p?.name) || '(unnamed)');
      continue;
    }

    const id = String(notesObj.id);
    const idx = findById(list, id);
    const material = buildMaterialFromProfile(p, notesObj);

    if (idx >= 0) {
      list[idx] = material;
      updated += 1;
      dlog(`UPDATED material id=${id} name=${notesObj.name}`);
    } else {
      list.push(material);
      added += 1;
      dlog(`ADDED material id=${id} name=${notesObj.name}`);
    }
  }

  dbObj.result.count = list.length;
  dbObj.result.version = nowEpochSeconds();

  log(
    `Ending DB list length: ${list.length} (count=${dbObj.result.count}, version=${dbObj.result.version})`
  );
  if (DEBUG) log(`Added: ${added}, Updated: ${updated}`);

  const outPath = path.join(DATA_DIR, 'material_database.json');
  fs.writeFileSync(outPath, JSON.stringify(dbObj, null, '\t'));
};

module.exports = { addToDatabase };
