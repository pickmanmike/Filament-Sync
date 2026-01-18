const fs = require('fs');
const path = require('path');

const cfg = require('../user-config');

const { connectSSH, readRemoteFile } = require('./ssh-util');

const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const log = (...args) => console.log('[Filament-Sync][opt]', ...args);
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
  const optPath = cfg.PRINTER_OPT_PATH || `${boxDir}/material_option.json`;
  return { boxDir, optPath };
};

const loadJsonFile = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const loadBaseOptions = async () => {
  // 1) Prefer reading the current options off the printer
  const sshCfg = getPrinterConfig();
  const { optPath } = resolveRemotePaths();
  if (sshCfg) {
    try {
      const conn = await connectSSH(sshCfg);
      try {
        const raw = await readRemoteFile(conn, optPath);
        const json = JSON.parse(raw);
        dlog(`Loaded base options from printer: ${optPath}`);
        return json;
      } finally {
        conn.end();
      }
    } catch (e) {
      dlog(`WARN: couldn't read base options from printer (${e.message.split('\n')[0]}). Falling back.`);
    }
  }

  // 2) Fall back to repo sourcedata
  const fallbackPath = path.join(__dirname, 'sourcedata', 'material_option.json');
  const json = loadJsonFile(fallbackPath);
  dlog(`Loaded base options from repo: ${fallbackPath}`);
  return json;
};

const addToOptions = async (profiles) => {
  ensureDataDir();

  const obj = await loadBaseOptions();

  let processed = 0;

  for (const p of profiles) {
    const notes = parseNotes(p);
    if (!notes || !notes.vendor || !notes.type || !notes.name) {
      dlog('SKIP: invalid notes for profile', unwrapFirst(p?.name) || '(unnamed)');
      continue;
    }

    if (typeof obj[notes.vendor] !== 'object' || obj[notes.vendor] === null) {
      obj[notes.vendor] = {};
    }

    obj[notes.vendor][notes.type] = notes.name;
    processed += 1;
  }

  const outPath = path.join(DATA_DIR, 'material_option.json');
  fs.writeFileSync(outPath, JSON.stringify(obj, null, '	'));

  log(`Processed ${processed} note entries into material_option.json`);
};

module.exports = { addToOptions };
