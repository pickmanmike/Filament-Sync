# Creality Hi notes (firmware + paths)

This fork has been tested against **Creality Hi** firmware variants that:

- are based on **Tina/OpenWrt**
- expose SSH via **Dropbear**
- may not include an SFTP subsystem (so SFTP uploads fail)

## SSH credentials

Common defaults:

- user: `root`
- password: `Creality2024`

(If you changed them, update `user-config.js`.)

## Paths used by this fork

### Live Creality DB (what the UI reads)

- `/mnt/UDISK/creality/userdata/box/material_database.json`
- `/mnt/UDISK/creality/userdata/box/material_option.json`

### Staging path used by this fork (what we upload)

- `/usr/share/Filament-Sync/material_database.json`
- `/usr/share/Filament-Sync/material_option.json`

A printer-side service copies staging → live (often within ~15–30 seconds).

## Quick on-printer verification commands

```sh
# Confirm live DB contains your vendor/id:
grep -n "Tinmorry" /mnt/UDISK/creality/userdata/box/material_database.json | head
grep -n "50434"    /mnt/UDISK/creality/userdata/box/material_database.json | head

# Compare staging vs live timestamps/sizes:
ls -lh /usr/share/Filament-Sync/material_database.json /mnt/UDISK/creality/userdata/box/material_database.json
```
