// Copy this file to "user-config.js" and fill in your real values.
// IMPORTANT: Do NOT commit your real user-config.js to GitHub.

module.exports = {
  // Printer connection
  PRINTER_IP: 'PRINTER_IP_OR_HOSTNAME_HERE', // e.g. "192.168.1.123" or "creality-hi.lan"
  PORT: 22,
  USER: 'root',
  PASSWORD: 'PRINTER_SSH_PASSWORD_HERE',

  // Slicer integration
  // "creality" = Creality Print, "orca" = OrcaSlicer
  SLICER: 'creality',

  // Your slicer "user" folder id (the directory name under .../user/<USERID>/...)
  USERID: 'YOUR_USER_ID_HERE',

  // Optional: where to place Filament-Sync files on the printer
  // If you're using Filament-Sync-Service, leave this as /usr/share/Filament-Sync
  REMOTE_SYNC_DIR: '/usr/share/Filament-Sync',

  // Optional: where to read the printer's current DB/options as a baseline.
  // Defaults to Creality Hi's box directory.
  REMOTE_BOX_DIR: '/mnt/UDISK/creality/userdata/box',
};
