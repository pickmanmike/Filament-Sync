#!/usr/bin/env node
/**
 * fix-creality-base-filaments.js
 *
 * Creality Print sometimes writes "truncated" custom filament presets into:
 *   %APPDATA%\Creality\Creality Print\<ver>\user\<USERID>\filament\
 * ...but fails to generate the expanded preset under:
 *   ...\filament\base\
 *
 * Filament-Sync reads full presets from the `base` folder. This helper:
 *   - reads each user preset in `filament\`
 *   - finds the referenced system preset (via `base_id` or `inherits`)
 *   - deep-merges system + user preset
 *   - writes the merged file into `filament\base\`
 *
 * New behavior (fork): **skip unless stale**.
 * We rebuild an output file only when:
 *   - it doesn't exist, OR
 *   - it looks broken (too small / too few keys), OR
 *   - the user preset or system preset is newer than the output, OR
 *   - --force is set
 *
 * Usage:
 *   node fix-creality-base-filaments.js
 *   node fix-creality-base-filaments.js --version 7.0
 *   node fix-creality-base-filaments.js --force
 */

'use strict'

const fs = require('fs')
const path = require('path')

const cfg = require('./user-config')

const FORCE = process.argv.includes('--force') || process.argv.includes('-f') || process.env.FILAMENT_SYNC_FORCE_BASE === '1'
const DRY_RUN = process.argv.includes('--dry-run') || process.env.FILAMENT_SYNC_DRY_RUN === '1'
const VERBOSE = process.env.FILAMENT_SYNC_DEBUG === '1' || process.argv.includes('--verbose')

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return null
}

const ONLY_VERSION = argValue('--version') || process.env.CREALITY_PRINT_VERSION || null

function log(msg) { console.log(`[base-fix] ${msg}`) }
function warn(msg) { console.warn(`[base-fix] WARN: ${msg}`) }

function fileExists(p) {
  try { fs.accessSync(p); return true } catch (_) { return false }
}

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return null }
}

function deepMerge(target, source) {
  // Merge objects recursively, arrays replaced (not concatenated).
  if (source === null || source === undefined) return target
  if (typeof source !== 'object') return source
  if (Array.isArray(source)) return source.slice()

  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? Object.assign({}, target) : {}
  for (const k of Object.keys(source)) {
    const sv = source[k]
    const tv = out[k]
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      out[k] = deepMerge(tv, sv)
    } else if (Array.isArray(sv)) {
      out[k] = sv.slice()
    } else {
      out[k] = sv
    }
  }
  return out
}

function countTopKeys(obj) {
  if (!obj || typeof obj !== 'object') return 0
  return Object.keys(obj).length
}

function findFilesByBasename(rootDir, baseName) {
  const results = []
  function walk(dir) {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const ent of entries) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && ent.name.toLowerCase() === `${baseName.toLowerCase()}.json`) results.push(p)
    }
  }
  walk(rootDir)
  return results
}

function findSystemPreset(systemDir, userPreset) {
  const candidates = [userPreset && userPreset.base_id, userPreset && userPreset.inherits].filter(Boolean)
  for (const id of candidates) {
    const matches = findFilesByBasename(systemDir, id)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      warn(`Multiple system presets match '${id}' under ${systemDir}. Using first: ${matches[0]}`)
      return matches[0]
    }
  }
  return null
}

function listInstalledCrealityVersions(crealityRoot) {
  let entries = []
  try { entries = fs.readdirSync(crealityRoot, { withFileTypes: true }) } catch (_) { return [] }
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => /^\d+\.\d+/.test(name))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }))
}

function shouldRebuild(outPath, srcPath, sysPath) {
  if (FORCE) return true
  if (!fileExists(outPath)) return true

  const outStat = fs.statSync(outPath)
  if (outStat.size < 1500) return true // too small: likely truncated

  // If the output JSON is too "short", treat as broken.
  const outJson = safeReadJson(outPath)
  if (!outJson) return true
  const keyCount = countTopKeys(outJson)
  if (keyCount < 50) return true

  const srcStat = fs.statSync(srcPath)
  const sysStat = sysPath && fileExists(sysPath) ? fs.statSync(sysPath) : null

  const newestInput = Math.max(srcStat.mtimeMs, sysStat ? sysStat.mtimeMs : 0)
  if (outStat.mtimeMs + 1000 < newestInput) return true // small clock skew cushion

  return false
}

function buildForVersion(crealityRoot, version) {
  const userId = cfg.USERID || 'default'
  const userFilamentDir = path.join(crealityRoot, version, 'user', userId, 'filament')
  const baseDir = path.join(userFilamentDir, 'base')
  const systemDir = path.join(crealityRoot, version, 'system')

  log(`Using Creality Print version: ${version}`)
  log(`Source filament dir: ${userFilamentDir}`)
  log(`Output base dir: ${baseDir}`)
  log(`System dir: ${systemDir}`)

  if (!fileExists(userFilamentDir)) {
    warn(`Missing filament dir for ${version}: ${userFilamentDir}`)
    return { built: 0, skipped: 0, warnings: 1 }
  }

  // user presets are top-level .json files in `filament\` (not inside base/)
  let presetFiles = []
  try {
    presetFiles = fs.readdirSync(userFilamentDir)
      .filter(n => n.toLowerCase().endsWith('.json'))
      .map(n => path.join(userFilamentDir, n))
      .filter(p => !p.toLowerCase().includes(`${path.sep}base${path.sep}`))
  } catch (_) {}

  if (!presetFiles.length) {
    log(`No .json presets found in ${userFilamentDir}`)
    return { built: 0, skipped: 0, warnings: 0 }
  }

  fs.mkdirSync(baseDir, { recursive: true })

  let built = 0
  let skipped = 0
  let warnings = 0

  for (const presetPath of presetFiles) {
    const userPreset = safeReadJson(presetPath)
    if (!userPreset) {
      warn(`Failed to parse JSON: ${presetPath}`)
      warnings++
      continue
    }

    const sysPath = findSystemPreset(systemDir, userPreset)
    if (!sysPath) {
      warn(`No system preset found for ${path.basename(presetPath)} (base_id=${userPreset.base_id || ''}, inherits=${userPreset.inherits || ''})`)
      warnings++
      continue
    }

    const outPath = path.join(baseDir, path.basename(presetPath))

    if (!shouldRebuild(outPath, presetPath, sysPath)) {
      if (VERBOSE) log(`SKIP (fresh): ${path.basename(outPath)}`)
      skipped++
      continue
    }

    const sysPreset = safeReadJson(sysPath)
    if (!sysPreset) {
      warn(`Failed to parse system preset JSON: ${sysPath}`)
      warnings++
      continue
    }

    const merged = deepMerge(sysPreset, userPreset)

    // Preserve filename as name if it looks helpful and no explicit name was provided.
    if (!merged.name) {
      merged.name = path.basename(outPath, '.json')
    }

    const jsonText = JSON.stringify(merged, null, 2)

    if (DRY_RUN) {
      log(`DRY-RUN: would write ${path.basename(outPath)} (${countTopKeys(merged)} keys)`)
      built++
      continue
    }

    fs.writeFileSync(outPath, jsonText, 'utf8')

    // If we rebuilt, align mtime to "now" so stale detection makes sense.
    try { fs.utimesSync(outPath, new Date(), new Date()) } catch (_) {}

    log(`WROTE: ${path.basename(outPath)} (${countTopKeys(merged)} keys)`)
    built++
  }

  log(`Done for ${version}. Built ${built}; skipped ${skipped}; warnings ${warnings}.`)
  return { built, skipped, warnings }
}

function main() {
  // Find Creality Print root
  const appData = process.env.APPDATA
  if (!appData) {
    throw new Error('APPDATA is not set. This script currently expects Windows (APPDATA).')
  }
  const crealityRoot = path.join(appData, 'Creality', 'Creality Print')

  const versions = listInstalledCrealityVersions(crealityRoot)
  if (!versions.length) {
    throw new Error(`No Creality Print version folders found under: ${crealityRoot}`)
  }

  const targetVersions = ONLY_VERSION ? versions.filter(v => v === ONLY_VERSION) : versions
  if (ONLY_VERSION && !targetVersions.length) {
    throw new Error(`Requested version '${ONLY_VERSION}' not found. Found: ${versions.join(', ')}`)
  }

  let totalBuilt = 0
  let totalSkipped = 0
  let totalWarnings = 0

  for (const v of targetVersions) {
    const r = buildForVersion(crealityRoot, v)
    totalBuilt += r.built
    totalSkipped += r.skipped
    totalWarnings += r.warnings
  }

  log(`ALL DONE. Total built: ${totalBuilt}; total skipped: ${totalSkipped}; total warnings: ${totalWarnings}.`)

  if (totalWarnings > 0) {
    log('NOTE: If you expected output, double-check:')
    log(`  1) USERID in user-config.js is correct (${cfg.USERID || 'default'})`)
    log('  2) Your custom presets exist under Creality Print: ...\\user\\<USERID>\\filament')
    log('  3) The presets are truncated (short) and include base_id + inherits.')
    log('  4) Your system preset exists under ...\\system\\ (searched recursively).')
  }
}

try {
  main()
} catch (e) {
  warn(e && e.message ? e.message : String(e))
  process.exit(1)
}
