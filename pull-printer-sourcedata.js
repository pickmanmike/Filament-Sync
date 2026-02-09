#!/usr/bin/env node
/**
 * pull-printer-sourcedata.js
 *
 * Diagnostic helper: pulls the current on-printer DB/OPT into:
 *   ./tools/sourcedata/material_database.json
 *   ./tools/sourcedata/material_option.json
 *
 * Default pulls from the *live* Creality DB location (what the printer UI reads):
 *   /mnt/UDISK/creality/userdata/box/material_database.json
 *   /mnt/UDISK/creality/userdata/box/material_option.json
 *
 * Optional:
 *   --staging   Pull from staging dir (/usr/share/Filament-Sync/*) instead.
 *   --dry-run   Verify remote sizes but do not write local files.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { Client } = require('ssh2')

const cfg = require('./user-config')

const wantStaging = process.argv.includes('--staging')
const dryRun = process.argv.includes('--dry-run')

const REMOTE_LIVE_DB  = '/mnt/UDISK/creality/userdata/box/material_database.json'
const REMOTE_LIVE_OPT = '/mnt/UDISK/creality/userdata/box/material_option.json'

const REMOTE_STAGING_DB  = (cfg.REMOTE_DIR || '/usr/share/Filament-Sync') + '/material_database.json'
const REMOTE_STAGING_OPT = (cfg.REMOTE_DIR || '/usr/share/Filament-Sync') + '/material_option.json'

const remoteDb  = wantStaging ? REMOTE_STAGING_DB  : REMOTE_LIVE_DB
const remoteOpt = wantStaging ? REMOTE_STAGING_OPT : REMOTE_LIVE_OPT

function log(msg) { console.log(`[pull] ${msg}`) }
function warn(msg) { console.warn(`[pull] WARN: ${msg}`) }
function die(msg) { console.error(`[pull] ERROR: ${msg}`); process.exit(1) }

function stripLoginBanner(s) {
  // Some Creality firmwares print a login banner before command output.
  // Keep the final lines that look like `SIZE|....` and discard the rest.
  const lines = String(s || '').replace(/\r/g, '').split('\n').filter(Boolean)
  const markerIdx = lines.findIndex(l => l.startsWith('SIZE|'))
  if (markerIdx >= 0) return lines.slice(markerIdx).join('\n')
  return lines.join('\n')
}

function readRemoteFile(conn, remotePath) {
  return new Promise((resolve, reject) => {
    const cmd = `sh -lc 'if [ -r "${remotePath.replace(/"/g,'\\"')}" ]; then echo "SIZE|$(wc -c < "${remotePath.replace(/"/g,'\\"')}")"; cat "${remotePath.replace(/"/g,'\\"')}"; else echo "NOFILE"; exit 2; fi'`
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      const chunks = []
      const errChunks = []
      stream.on('data', (d) => chunks.push(d))
      stream.stderr.on('data', (d) => errChunks.push(d))
      stream.on('close', (code) => {
        const raw = Buffer.concat(chunks).toString('utf8')
        const cleaned = stripLoginBanner(raw)
        if (code !== 0) {
          const e = Buffer.concat(errChunks).toString('utf8')
          return reject(new Error(`remote cmd failed (code=${code}). stdout=${cleaned.slice(0,200)} stderr=${e.slice(0,200)}`))
        }
        const lines = cleaned.split('\n')
        const header = lines.shift() || ''
        if (header.trim() === 'NOFILE') return reject(new Error(`Remote file not readable: ${remotePath}`))
        if (!header.startsWith('SIZE|')) {
          warn(`Unexpected header while reading ${remotePath}: ${header}`)
        }
        const size = parseInt(header.split('|')[1] || '0', 10) || 0
        const body = Buffer.from(lines.join('\n'), 'utf8')
        resolve({ size, body })
      })
    })
  })
}

function backupIfExists(destPath) {
  if (!fs.existsSync(destPath)) return
  const stamp = new Date().toISOString().replace(/[:.]/g,'-')
  const bak = destPath + `.bak_${stamp}`
  fs.copyFileSync(destPath, bak)
  log(`Backup: ${bak}`)
}

async function main() {
  const destDir = path.join(__dirname, 'tools', 'sourcedata')
  fs.mkdirSync(destDir, { recursive: true })

  const destDb = path.join(destDir, 'material_database.json')
  const destOpt = path.join(destDir, 'material_option.json')

  log(`Connecting to ${cfg.USER}@${cfg.PRINTERIP}:22 ...`)
  const conn = new Client()

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve)
    conn.on('error', reject)
    conn.connect({
      host: cfg.PRINTERIP,
      port: 22,
      username: cfg.USER,
      password: cfg.PASSWORD,
      readyTimeout: 20000,
    })
  })

  try {
    log(`Reading remote DB:  ${remoteDb}`)
    const db = await readRemoteFile(conn, remoteDb)

    log(`Reading remote OPT: ${remoteOpt}`)
    const opt = await readRemoteFile(conn, remoteOpt)

    // Sanity-ish checks
    if (db.size < 10000) warn(`DB size looks small (${db.size} bytes). Is the path correct?`)
    if (opt.size < 100) warn(`OPT size looks small (${opt.size} bytes). Is the path correct?`)

    log(`Remote sizes look ok — DB=${db.size} bytes, OPT=${opt.size} bytes`)

    if (dryRun) {
      log('--dry-run: not writing files.')
      return
    }

    backupIfExists(destDb)
    backupIfExists(destOpt)

    fs.writeFileSync(destDb, db.body)
    fs.writeFileSync(destOpt, opt.body)

    log('Wrote:')
    console.log(`  ${destDb}`)
    console.log(`  ${destOpt}`)
  } finally {
    conn.end()
  }
}

main().catch((e) => die(e && e.message ? e.message : String(e)))
