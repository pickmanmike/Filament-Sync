/**
 * user-config.js — local configuration for Filament-Sync
 *
 * NOTE:
 * - Creality Hi commonly ships with SSH user 'root' and password 'Creality2024'
 * - USERID is the folder name under:
 *     %APPDATA%\Creality\Creality Print\<version>\user\<USERID>\
 */

const USERID = 'default'            // e.g. '6124739093' (Creality account numeric ID), or 'default'
const SLICER = 'creality'           // 'creality' or 'orca'
const PRINTERIP = '192.168.1.100'   // your printer IP on the LAN
const USER = 'root'
const PASSWORD = 'Creality2024'

// Creality Hi staging directory that this fork uploads to
// (printer-side service copies these into /mnt/UDISK/creality/userdata/box/)
const REMOTE_DIR = '/usr/share/Filament-Sync'

module.exports = {
  USERID,
  SLICER,
  PRINTERIP,
  USER,
  PASSWORD,
  REMOTE_DIR,
}
