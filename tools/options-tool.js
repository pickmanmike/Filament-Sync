// Tools for material options (safe / idempotent version)
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const optionsFile = path.join(dataDir, 'material_option.json');
const { readProfiles } = require('./config');

// Optional debug logging: set FILAMENT_SYNC_DEBUG=1
const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const dlog = (...args) => {
  if (DEBUG) console.log('[Filament-Sync][opt]', ...args);
};

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const writeJson = (filePath, obj) => {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, '\t'));
};

const parseNotes = (profile) => {
  const n = profile?.filament_notes;
  const s = Array.isArray(n) ? String(n[0] ?? '') : String(n ?? '');

  const trimmed = s.trim();
  if (!trimmed || trimmed === '""') return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const addNameToBucket = (bucketStr, name) => {
  const lines = String(bucketStr || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  if (!lines.includes(name)) lines.push(name);
  return lines.join('\n');
};

const addOptions = () => {
  if (!fs.existsSync(optionsFile)) {
    throw new Error(`material_option.json not found: ${optionsFile}\nRun initData first.`);
  }

  const opts = readJson(optionsFile) || {};
  const presets = readProfiles();

  let added = 0;

  for (const p of presets) {
    const notes = parseNotes(p);
    if (!notes) continue;

    const vendor = String(notes.vendor || '').trim();
    const type = String(notes.type || '').trim();
    const name = String(notes.name || '').trim();
    if (!vendor || !type || !name) continue;

    if (!opts[vendor] || typeof opts[vendor] !== 'object') opts[vendor] = {};
    opts[vendor][type] = addNameToBucket(opts[vendor][type], name);
    added += 1;
  }

  writeJson(optionsFile, opts);
  dlog(`Processed ${added} note entries into material_option.json`);
};

module.exports = addOptions;
