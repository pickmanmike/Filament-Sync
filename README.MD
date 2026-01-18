# Filament-Sync (Creality Hi / Dropbear fork)

Creality has added syncing of your filaments with Creality Print for the Crealirty Hi, but it appears to only work well with Creality branded filaments with RFID tags. It will put all of your custom filament profiles under the "Generic" brand, not sync the profiles with the printer and not allow the use of custom RFID tags. HurricanePrint's Filament-Sync was the workaround for that.

In the firmware for the Creality Hi and in the most recent versions of Creality Print, they seemed to have removed several of the components that Filament-Sync relied upon, rendering it non-functional. I was getting the impression that Creality has been intentionally nerfing their Creality Print version of Orca slicer as well as the firmware on the Creality Hi, to push users into their Creality-branded ecosystem of RFID tagged filaments. 

This is a fork of HurricanePrint's **Filament-Sync** project to work the recent versions of Creality Print 6 and Creality Print 7, with the current Creality Hi firmware and with other printers and Creality Print versions that:

- run **Dropbear** SSH (common on OpenWrt/Tina-based Creality firmware), and
- **do not include an SFTP subsystem** (so SFTP uploads fail), and/or
- have a Creality Print build where the **printer-side “Create Filament” UI is broken** , leaving you with “truncated” user presets that never appear in `/filament/base`.

This has only been tested with Windows so all instructions are for Windows. Unlike the upstream version, this fork is not intended for Orca.

## What’s different vs upstream

1. **Uploader does not use SFTP**
   - Uses plain SSH exec and streams file content into `cat > file.tmp` then `mv` (atomic write).
   - Works on Creality Hi devices where `sftp-server` is missing.

2. **Creality Print “base preset” helper**
   - Includes `fix-creality-base-filaments.js` to build a full preset under:
     - `%APPDATA%\Creality\Creality Print\6.0\user\<USERID>\filament\base`
   - It merges the system preset referenced by `inherits` with your truncated custom preset.
   - Works on Creality Hi devices where `sftp-server` is missing.

3. **Notes handling**
   - Upstream Filament-Sync expects a JSON blob in `filament_notes` like:
     `{"id":"52341","vendor":"Acme","type":"PETG","name":"Acme PETG-CF"}`
   - This fork can optionally auto-generate that JSON if missing (see config).

4. **Works with Creality Print 6 or Creality Print 7**
   - If multiple Creality Print versions are installed (e.g. 6.0 and 7.0), this fork prefers `6.0` when locating your `...\Creality Print\<ver>\user\<USERID>\filament` folder.

## How the whole pipeline fits together

### On your PC (Windows)

1. Creality Print stores custom filament presets under:
   `%APPDATA%\Creality\Creality Print\<version>\user\<USERID>\filament\...`

2. `fix-creality-base-filaments.js` creates expanded presets in:
   `%APPDATA%\Creality\Creality Print\6.0\user\<USERID>\filament\base\...`

3. `main.js`:
   - reads those presets
   - builds:
     - `data/material_database.json`
     - `data/material_option.json`
   - uploads them to the printer via SSH


# Filament Sync 

This tool reads custom filament profiles from Orcaslicer and Creality Print, converts them to Creality's database format and then sends them to the printer to pick manually with the screen or automatically with custom RFID tags

It will categorize your profiles under the correct brand name, filament type, and a more readable name. It also allows automatic assigning when using custom RFID tags with the CFS and side spool. Using custom RFID tags will also enable tracking filament usage and showing remaining amount on the filament selection screen.

### Creating custom filament presets

If you want to get your presets ready just copy your settings into a new custom filament profile

Right side of the Filament section 

Do not bother with the "**Set filaments to use**" icon in the upper right corner. It seems like part of the menu has been disabled/hidden in the recent Creality Print versions to prevent custom filaments being created that way. 

Create custom filaments through the edit option when selecting the spool or CFS slot for the filament, customizing a generic profile as appropriate and saving it as a custom filament.

You will need to add this into the Notes section of the filament

```
{"id":"","vendor":"","type":"","name":""}
```

The "id" should be a unique 5 digit value that you will also match with your custom RFID tags if you are using them

You can ⌘/CTRL-F in the material_database.json to make sure the id you pick isn't already being used

An id is still required even if you are not using RFID tags as the tool searches by id when updating filament settings

Here is an example

```
{"id":"02345","vendor":"ELEGOO","type":"PLA","name":"Fast PLA"}
```

Use the advanced mode to set the id you picked as "Material Code" in the RFID for CFS app





## Prerequisites

#### Install Node.js

>[Download Node.js](https://nodejs.org/en)

#### Install Filament-Sync-Service on your printer

>[Filament-Sync-Service](https://github.com/pickmanmike/Filament-Sync-Service)


## Installation

#### Download Filament-Sync

[Latest release](https://github.com/pickmanmike/Filament-Sync/releases/latest)

Extract the folder on your computer

## Config

Open the **user-config.js** file with a text editor

Change **PRINTERIP** to the ip of your printer

Check in the printer UI to make sure the user and password are correct

```
const PRINTERIP = '127.0.0.1'
const USER = 'root'
const PASSWORD = 'Creality2024'
```
f you have changed your username or password they can also be updated here

Change **SLICER** to 'creality'

```
const SLICER = 'creality'
```

If you are using logged into an account in CrealityPrint, change **USERID** to the unique id number that the slicer has set for the user folder.

```
const USERID = 'default'
```

You can find your user id by clicking the **Help** tab in your slicer and then clicking **Show Configuration Folder**

CrealityPrint

    Mac: /Library/Application Support/Creality/Creality Print/6.0/user/USERID#
    Linux: /.config/Creality/Creality Print/6.0/user/USERID#
    Windows: /AppData/Roaming/Creality/Creality Print/6.0/user/USERID#

## Set to run as post-processing script in slicer

This will sync everytime you slice and export gcode to the printer

At the bottom of the "**Others**" tab of your slicing settings, find "**Post-processing Scripts**" 

Make sure to change the path to where you put the extracted Filament-Sync folder


#### Windows

```
C:\Users\your-user-name\Filament-Sync\windows-sync.bat;
```

### To sync manually

In Terminal/Powershell enter the Filament-Sync folder
then run
```
node main.js
```

Windows users can also run the windows-sync.bat file 

## Useful environment variables

- `FILAMENT_SYNC_DEBUG=1` — verbose logs
- `FILAMENT_SYNC_AUTO_NOTES=1` — auto-generate `filament_notes` if missing
- `FILAMENT_SYNC_BACKUP=0` — disable local backups of remote files before upload

## Safety and backups

This tool ultimately modifies the printer’s material database. Before you iterate a lot, grab a backup:

```sh
cp -a /mnt/UDISK/creality/userdata/box/material_database.json \
      /mnt/UDISK/creality/userdata/box/material_database.json.bak_$(date +%F-%H%M%S)
cp -a /mnt/UDISK/creality/userdata/box/material_option.json \
      /mnt/UDISK/creality/userdata/box/material_option.json.bak_$(date +%F-%H%M%S)
```

This fork also saves local backups under `./backups/<timestamp>/` by default.

## License

GPL-3.0

## Credits

All original credit goes to HurricanePrint for Filament-Sync and Filament-Sync-Service.
This fork is just compatibility shims and a Creality Print workaround.
