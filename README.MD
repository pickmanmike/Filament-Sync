# Filament-Sync (Creality Hi / Dropbear + Creality Print 6 & 7 fork)

This is a fork of HurricanePrint’s **Filament-Sync** that’s been adapted to work with **Creality Hi** firmware and modern **Creality Print 6 / 7** builds on **Windows**.

The big pain points this fork addresses:

- Many OpenWrt/Tina-based Creality firmwares ship with **Dropbear SSH**, but **do not provide an SFTP subsystem**, so upstream SFTP-based uploads can fail.
- Recent Creality Print builds sometimes create **“truncated” custom filament presets** that never show up in `filament\base`, which upstream Filament-Sync expects.
- If you have **multiple PCs** syncing to the same printer, you can accidentally overwrite each other unless you start from the printer’s current DB.

This fork adds:
- a Dropbear-friendly uploader (`tools/scp.js`) that uses **SSH exec + stream → temp → mv** (atomic write)
- a base preset “expander” (`fix-creality-base-filaments.js`) to build full presets under `...\filament\base\`
- an optional diagnostic pull script (`pull-printer-sourcedata.js`) to pull the on-printer DB/OPT locally
- improved Windows wrappers (`windows-sync.bat`, plus optional helpers)

> **Test status:** So far this has only been tested on **Windows 10/11**, **Creality Hi**, and **Creality Print 6.x + 7.x**.

---

## How the pipeline works

### On your PC (Creality Print)

Creality Print stores your custom filament presets under:

`%APPDATA%\Creality\Creality Print\<version>\user\<USERID>\filament\`

Recent Creality Print builds can sometimes write a short “wrapper” preset there (with `inherits` / `base_id`), but fail to create the fully-expanded preset in:

`...\filament\base\`

This fork’s `fix-creality-base-filaments.js` merges the referenced **system preset** with your custom preset and writes the expanded JSON into the `base` folder.

### On the printer (Creality Hi)

This fork uploads:

- `data/material_database.json`
- `data/material_option.json`

to a **staging path** on the printer:

`/usr/share/Filament-Sync/`

A printer-side service then copies these files into Creality’s live DB location:

`/mnt/UDISK/creality/userdata/box/`

On Creality Hi, that copy usually happens within ~15–30 seconds.

---

## Prerequisites

1. **Node.js LTS** installed on your PC (and available in `PATH`)
2. **Git** (optional but strongly recommended)
3. Creality Print **6.x and/or 7.x**
4. SSH access to the printer (Creality Hi default is typically: `root / Creality2024`)

---

## Install

```powershell
cd $env:USERPROFILE
git clone https://github.com/pickmanmike/Filament-Sync.git
cd Filament-Sync
npm install
```

---

## Configure

Edit `user-config.js`:

- `PRINTERIP` = your printer IP on the LAN
- `USER` / `PASSWORD` = printer SSH credentials
- `SLICER` = `creality`
- `USERID` = the folder name inside Creality Print’s `...\user\` directory (often a numeric ID)

---

## Create a custom filament preset (Creality Print)

Creality Print UI can be weird here.

The most reliable workflow (as of CP 6/7 + Hi firmware):

1. Select a spool/CFS slot
2. Choose **Edit** on a generic profile
3. Save as a custom filament

Then add this JSON blob into the filament **Notes** field:

```json
{"id":"50434","vendor":"Tinmorry","type":"PETG","name":"PETG-CF Tinmorry"}
```

- `id` must be unique (often 5 digits)
- `vendor` becomes the “Brand” shown on the printer
- `type` should match Creality’s type buckets (PLA, PETG, ABS, etc.)
- `name` is the display name

---

## Run (manual)

### Creality Print 7.x

```powershell
cd $env:USERPROFILE\Filament-Sync
$env:CREALITY_PRINT_VERSION = "7.0"
$env:FILAMENT_SYNC_DEBUG = "1"
.\windows-sync.bat
```

### Creality Print 6.x

```powershell
cd $env:USERPROFILE\Filament-Sync
$env:CREALITY_PRINT_VERSION = "6.0"
.\windows-sync.bat
```

---

## Run as a post-processing script (Creality Print)

In Creality Print slicing settings:

**Others → Post-processing Scripts**

Add:

```
C:\Users\<you>\Filament-Sync\windows-sync.bat;
```

If you use CP 7, set `CREALITY_PRINT_VERSION=7.0` in your environment or use the `windows-sync-cp7.bat` helper (optional).

---

## Multi-PC setups (recommended)

If two computers can sync to the same printer, always start from the printer’s current DB to avoid “last writer wins” clobbering.

This fork’s default `windows-sync.bat` does:

1. `pull-printer-sourcedata.js` (pull printer DB/OPT locally)
2. `fix-creality-base-filaments.js` (expand base presets, *skip unless stale*)
3. `main.js` (merge + upload)

---

## Environment variables

- `CREALITY_PRINT_VERSION=6.0|7.0` — force a Creality Print version folder
- `FILAMENT_SYNC_DEBUG=1` — verbose logs
- `FILAMENT_SYNC_AUTO_NOTES=1` — auto-generate `filament_notes` if missing
- `FILAMENT_SYNC_BACKUP=0` — disable local backups of remote files before upload

---

## Safety and backups

This tool ultimately modifies the printer’s material DB.

Before iterating a lot, take backups on the printer:

```sh
cp -a /mnt/UDISK/creality/userdata/box/material_database.json \
      /mnt/UDISK/creality/userdata/box/material_database.json.bak_$(date +%F-%H%M%S)
cp -a /mnt/UDISK/creality/userdata/box/material_option.json \
      /mnt/UDISK/creality/userdata/box/material_option.json.bak_$(date +%F-%H%M%S)
```

This fork also saves local backups under `./backups/<timestamp>/` by default.

---

## Troubleshooting

### “No profiles found in the selected custom profile directory”
- Make sure you set `CREALITY_PRINT_VERSION` correctly (6 vs 7)
- Make sure `fix-creality-base-filaments.js` created at least one file in `...\filament\base`
- Confirm your preset contains `filament_notes` (or enable `FILAMENT_SYNC_AUTO_NOTES=1`)

### “Uploads work, but the printer UI doesn’t show my filament”
- Wait ~30 seconds (printer-side copy)
- Power-cycle the printer UI (worst case: reboot printer)
- Confirm the live DB contains your ID in `/mnt/UDISK/creality/userdata/box/material_database.json`

---

## License

GPL-3.0 (same as upstream)

---

## Credits

All original credit goes to **HurricanePrint** for Filament-Sync and Filament-Sync-Service.

This fork’s goal is compatibility with Creality Hi + Dropbear + modern Creality Print.
