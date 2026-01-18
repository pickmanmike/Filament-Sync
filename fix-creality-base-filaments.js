#!/usr/bin/env node
/**
 * fix-creality-base-filaments.js
 *
 * Purpose:
 *   Creality Print sometimes stores "custom" filament presets as *truncated* JSON files
 *   (only the settings you changed). Filament-Sync expects the *full* preset (hundreds
 *   of lines / lots of keys). This script expands those truncated presets by merging:
 *
 *     root template (e.g. fdm_filament_petg)
 *        + the chosen system preset (e.g. "Generic PETG @Creality Hi 0.4 nozzle")
 *        + your truncated user preset (e.g. "PETG-CF ExampleBrand")
 *
 *   Output is written to:
 *     .../Creality Print/<version>/user/<USERID>/filament/base/<preset>.json
 *
 * Behavior:
 *   - Prefers Creality Print 6.0 first (per repo README) but will also process 7.0
 *     (and any other numeric version folders it finds) if present.
 *   - Does NOT modify your original presets by default.
 *   - Skips output files that already exist unless you pass --force.
 *
 * Run:
 *   node fix-creality-base-filaments.js
 *   node fix-creality-base-filaments.js --force
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// --- Load user-config.js (best effort) ---
let USERID = "default";
try {
  const cfg = require("./user-config");
  if (cfg && typeof cfg.USERID !== "undefined") USERID = String(cfg.USERID);
} catch (e) {
  // If user-config.js isn't present or doesn't export USERID, we fall back to 'default'
}

// --- CLI flags ---
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");

// --- Paths ---
const APPDATA =
  process.env.APPDATA ||
  path.join(os.homedir(), "AppData", "Roaming"); // Windows fallback

const CREALITY_ROOT = path.join(APPDATA, "Creality", "Creality Print");

// --- Helpers ---
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listVersionDirs() {
  if (!isDir(CREALITY_ROOT)) return [];
  const entries = fs.readdirSync(CREALITY_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^[0-9]+\.[0-9]+$/.test(e.name))
    .map((e) => e.name);
}

function sortVersionsPrefer60First(versions) {
  const preferred = ["6.0", "7.0"];
  const out = [];
  const set = new Set(versions);

  // Pull preferred versions first, in order, if present
  for (const v of preferred) {
    if (set.has(v)) out.push(v);
  }

  // Then everything else sorted numerically
  const rest = versions
    .filter((v) => !out.includes(v))
    .sort((a, b) => parseFloat(a) - parseFloat(b));

  return out.concat(rest);
}

// Keys we want to keep as *strings* when present.
// Everything else is converted to an array form: ["value"].
const STRING_KEYS = new Set([
  "type",
  "name",
  "from",
  "instantiation",
  "inherits",
  "filament_id",
  "setting_id",
  "base_id",
  "version",
  "is_custom_defined",
]);

function normalizePresetValues(preset) {
  const out = {};
  for (const [k, v] of Object.entries(preset || {})) {
    if (v === undefined) continue;

    if (Array.isArray(v)) {
      out[k] = v;
      continue;
    }

    // Keep known metadata keys as strings
    if (STRING_KEYS.has(k)) {
      out[k] = String(v);
      continue;
    }

    // Everything else becomes a one-element array of strings
    out[k] = [String(v)];
  }
  return out;
}

function readJson(p) {
  const txt = fs.readFileSync(p, "utf8");
  return JSON.parse(txt);
}

/**
 * Try to locate a system preset JSON file by name.
 * We first try common expected locations, then fall back to a limited recursive search.
 */
function findSystemPresetPathByName(name, systemRoot) {
  if (!name || typeof name !== "string") return null;

  const filename = `${name}.json`;

  const candidates = [
    path.join(systemRoot, "Creality", "filament", filename),
    path.join(systemRoot, "Custom", "filament", filename),
    path.join(systemRoot, "filament", filename),
    path.join(systemRoot, "Creality", filename),
    path.join(systemRoot, "Custom", filename),
    path.join(systemRoot, filename),
  ];

  for (const p of candidates) {
    if (isFile(p)) return p;
  }

  // Fallback: limited recursive search (depth-limited)
  const maxDepth = 5;
  const queue = [{ dir: systemRoot, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === filename) return full;
      if (e.isDirectory()) queue.push({ dir: full, depth: depth + 1 });
    }
  }

  return null;
}

function sanitizeFilename(name) {
  // Keep it conservative for Windows filenames
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
}

function countKeys(obj) {
  return obj ? Object.keys(obj).length : 0;
}

// --- Main per-version processing ---
function processCrealityVersion(version) {
  const versionRoot = path.join(CREALITY_ROOT, version);
  const userFilamentDir = path.join(versionRoot, "user", USERID, "filament");
  const baseOutDir = path.join(userFilamentDir, "base");
  const systemRoot = path.join(versionRoot, "system");

  console.log(`[base-fix] Using Creality Print version: ${version}`);
  console.log(`[base-fix] Source filament dir: ${userFilamentDir}`);
  console.log(`[base-fix] Output base dir: ${baseOutDir}`);
  console.log(`[base-fix] System dir: ${systemRoot}`);

  if (!isDir(userFilamentDir)) {
    console.log(
      `[base-fix] SKIP: filament directory not found for USERID=${USERID}\n`
    );
    return { built: 0, skipped: 0, warnings: 0 };
  }
  if (!isDir(systemRoot)) {
    console.log(`[base-fix] SKIP: system directory not found\n`);
    return { built: 0, skipped: 0, warnings: 0 };
  }

  fs.mkdirSync(baseOutDir, { recursive: true });

  const entries = fs.readdirSync(userFilamentDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => e.name);

  if (jsonFiles.length === 0) {
    console.log(`[base-fix] No .json presets found in ${userFilamentDir}\n`);
    return { built: 0, skipped: 0, warnings: 0 };
  }

  let built = 0;
  let skipped = 0;
  let warnings = 0;

  for (const fname of jsonFiles) {
    const srcPath = path.join(userFilamentDir, fname);

    let userPreset;
    try {
      userPreset = readJson(srcPath);
    } catch (e) {
      console.log(`[base-fix] SKIP (bad JSON): ${fname}`);
      skipped++;
      continue;
    }

    // Heuristic: "truncated" user presets usually have base_id + inherits and relatively few keys,
    // and "from" is User.
    const fromVal =
      userPreset && typeof userPreset.from === "string"
        ? userPreset.from.trim().toLowerCase()
        : "";

    const looksLikeTruncatedUserPreset =
      userPreset &&
      typeof userPreset === "object" &&
      fromVal === "user" &&
      typeof userPreset.inherits === "string" &&
      typeof userPreset.base_id === "string" &&
      countKeys(userPreset) < 120;

    if (!looksLikeTruncatedUserPreset) {
      // Not what we expect to fix (or already expanded)
      skipped++;
      continue;
    }

    const outName = sanitizeFilename(fname);
    const outPath = path.join(baseOutDir, outName);

    if (isFile(outPath) && !FORCE) {
      console.log(`[base-fix] SKIP (exists): ${outName}`);
      skipped++;
      continue;
    }

    const baseName = userPreset.inherits.trim();
    const basePath = findSystemPresetPathByName(baseName, systemRoot);
    if (!basePath) {
      console.log(
        `[base-fix] SKIP (missing base preset "${baseName}"): ${outName}`
      );
      skipped++;
      continue;
    }

    let basePreset;
    try {
      basePreset = readJson(basePath);
    } catch (e) {
      console.log(`[base-fix] SKIP (bad base JSON "${baseName}"): ${outName}`);
      skipped++;
      continue;
    }

    // Root template (often fdm_filament_petg / pla / abs etc)
    const rootName =
      basePreset && typeof basePreset.inherits === "string"
        ? basePreset.inherits.trim()
        : null;

    let rootPreset = {};
    if (rootName) {
      const rootPath = findSystemPresetPathByName(rootName, systemRoot);
      if (!rootPath) {
        console.log(
          `[base-fix] WARN: Could not find root template "${rootName}" (continuing with base only)`
        );
        warnings++;
      } else {
        try {
          rootPreset = readJson(rootPath);
        } catch (e) {
          console.log(
            `[base-fix] WARN: Root template "${rootName}" is not valid JSON (continuing with base only)`
          );
          warnings++;
          rootPreset = {};
        }
      }
    }

    // Normalize formats so we end up with the "array-of-strings" style that Filament-Sync expects.
    const rootN = normalizePresetValues(rootPreset);
    const baseN = normalizePresetValues(basePreset);
    const userN = normalizePresetValues(userPreset);

    // Merge order: root -> base -> user overrides
    const merged = Object.assign({}, rootN, baseN, userN);

    // Strongly suggest the "inherits" points to the root template after expansion.
    // This is closer to what Creality Print tends to do for full presets.
    if (rootName) merged.inherits = rootName;

    // Ensure the preset has a name (prefer user preset name; else filename stem)
    if (!merged.name || typeof merged.name !== "string") {
      merged.name = path.basename(fname, ".json");
    }

    // Basic sanity: warn if still very small (likely means we didn't actually expand)
    const finalKeyCount = countKeys(merged);
    if (finalKeyCount < 120) {
      console.log(
        `[base-fix] WARN: Output still looks small (${finalKeyCount} keys): ${outName}`
      );
      warnings++;
    }

    // Write
    try {
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf8");
      built++;
      console.log(`[base-fix] WROTE: ${outName}  (${finalKeyCount} keys)`);
    } catch (e) {
      console.log(`[base-fix] SKIP (write failed): ${outName}`);
      skipped++;
      continue;
    }
  }

  console.log(
    `[base-fix] Done for ${version}. Built ${built} base presets; skipped ${skipped}; warnings ${warnings}.\n`
  );
  return { built, skipped, warnings };
}

// --- Entry point ---
const versions = sortVersionsPrefer60First(listVersionDirs());

if (versions.length === 0) {
  console.error(
    `[base-fix] ERROR: No Creality Print versions found under: ${CREALITY_ROOT}`
  );
  console.error(
    `[base-fix] Expected something like: ...\\Creality Print\\6.0\\user\\${USERID}\\filament`
  );
  process.exit(1);
}

let totalBuilt = 0;
let totalSkipped = 0;
let totalWarnings = 0;

for (const v of versions) {
  const res = processCrealityVersion(v);
  totalBuilt += res.built;
  totalSkipped += res.skipped;
  totalWarnings += res.warnings;
}

console.log(
  `[base-fix] ALL DONE. Total built: ${totalBuilt}; total skipped: ${totalSkipped}; total warnings: ${totalWarnings}.`
);

if (totalBuilt === 0) {
  console.log(
    `[base-fix] NOTE: If you expected output, double-check:\n` +
      `  1) USERID in user-config.js is correct (${USERID})\n` +
      `  2) Your custom presets exist under Creality Print 6.0: ${path.join(
        CREALITY_ROOT,
        "6.0",
        "user",
        USERID,
        "filament"
      )}\n` +
      `  3) The presets are "truncated" (short) and include base_id + inherits.\n` +
      `  4) Re-run with --force if you already created base files and want to overwrite them.`
  );
}