// Tools for material database (safe / idempotent upsert version)
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const databaseFile = path.join(dataDir, 'material_database.json');

const { readProfiles } = require('./config');
const convertToPrinterFormat = require('./jsonhandler.js');

// Optional debug logging: set FILAMENT_SYNC_DEBUG=1
const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const dlog = (...args) => {
  if (DEBUG) console.log('[Filament-Sync][db]', ...args);
};

const readJson = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to read/parse JSON: ${filePath}\n` +
      `Error: ${err?.message || err}\n\n` +
      `This usually means material_database.json is not the real/full database file.\n` +
      `Make sure tools/sourcedata/material_database.json is the full file (tens of KB+), NOT the tiny .tmp-style metadata.`
    );
  }
};

const writeJson = (filePath, obj) => {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, '\t'));
};

const normalizeId = (id) => {
  if (id === null || id === undefined) return '';
  return String(id).trim();
};

const ensureDbShape = (db) => {
  if (!db || typeof db !== 'object') {
    throw new Error('material_database.json is not an object.');
  }
  if (!db.result || typeof db.result !== 'object') db.result = {};

  // The printer DB is expected to have result.list (array)
  if (!Array.isArray(db.result.list)) db.result.list = [];

  // Keep count consistent with list length
  if (typeof db.result.count !== 'number') db.result.count = db.result.list.length;

  // Keep version as a string if present; we'll update it on write
  if (db.result.version === undefined || db.result.version === null) {
    db.result.version = String(Math.floor(Date.now() / 1000));
  } else {
    db.result.version = String(db.result.version);
  }

  return db;
};

// Normalize the converted "material" object into what the printer DB expects.
// The original Filament-Sync logic treated:
//   - material.base.id as the *custom ID* (from filament_notes.id)
//   - material.base_id as the *system base preset id* (e.g., GFSA04)
// ...then rewired fields accordingly.
const normalizeConvertedMaterial = (converted, presetNameForErrors) => {
  if (!converted || typeof converted !== 'object') {
    throw new Error(`convertToPrinterFormat returned nothing for preset: ${presetNameForErrors}`);
  }

  // Clone to avoid side-effects leaking across runs
  const material = JSON.parse(JSON.stringify(converted));

  if (!material.base || typeof material.base !== 'object') material.base = {};

  // Prefer explicit id, else fall back to base.id (older behavior)
  const customId = normalizeId(material.id || material.base.id);
  if (!customId) {
    throw new Error(
      `Converted material is missing a custom id (id/base.id). Preset: ${presetNameForErrors}`
    );
  }

  // If base_id exists, use it as base.id and delete base_id
  const baseId = material.base_id !== undefined ? normalizeId(material.base_id) : '';
  material.id = customId;

  if (baseId) {
    material.base.id = baseId;
    delete material.base_id;
  }

  // Many entries appear to require base.is_system; keep consistent with original intent
  if (material.base.is_system === undefined) material.base.is_system = true;

  return material;
};

const upsertByMaterialId = (list, material) => {
  const id = normalizeId(material.id);
  const idx = list.findIndex((m) => normalizeId(m && m.id) === id);

  if (idx >= 0) {
    list[idx] = material;
    return { updated: true, index: idx };
  } else {
    list.push(material);
    return { updated: false, index: list.length - 1 };
  }
};

const addProfiles = () => {
  // Basic sanity: data folder must exist
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}\nRun initData first.`);
  }
  if (!fs.existsSync(databaseFile)) {
    throw new Error(`material_database.json not found: ${databaseFile}\nRun initData first.`);
  }

  const db = ensureDbShape(readJson(databaseFile));
  const beforeLen = db.result.list.length;

  const presets = readProfiles();
  dlog(`Starting DB list length: ${beforeLen} (count=${db.result.count})`);
  dlog(`Profiles to apply: ${Array.isArray(presets) ? presets.length : 0}`);

  for (const p of presets) {
    const presetName =
      (Array.isArray(p?.name) ? p.name[0] : p?.name) ||
      p?.name ||
      'UnknownPreset';

    const converted = convertToPrinterFormat(p);
    const material = normalizeConvertedMaterial(converted, presetName);

    const { updated } = upsertByMaterialId(db.result.list, material);

    dlog(`${updated ? 'UPDATED' : 'ADDED'} material id=${material.id} name=${material.name || ''}`);
  }

  // Always keep count in sync with list length
  db.result.count = db.result.list.length;

  // Bump version so the consumer has a reason to reload (string epoch seconds)
  db.result.version = String(Math.floor(Date.now() / 1000));

  writeJson(databaseFile, db);

  const afterLen = db.result.list.length;
  dlog(`Ending DB list length: ${afterLen} (count=${db.result.count}, version=${db.result.version})`);

  // Guard rail: if we ever shrink massively, something is wrong
  if (afterLen < beforeLen) {
    throw new Error(
      `material_database list SHRANK from ${beforeLen} to ${afterLen}. Refusing to proceed.\n` +
      `This indicates a logic or input-file problem. Restore backups before continuing.`
    );
  }
};

module.exports = addProfiles;