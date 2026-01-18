const { initData, readProfiles } = require('./tools/config.js');
const database = require('./tools/database-tool.js');
const options = require('./tools/options-tool.js');
const sendToPrinter = require('./tools/scp.js');

// Entrypoint
(async () => {
  try {
    initData();

    const profiles = readProfiles();

    // Build the two files Creality actually consumes
    await options.addToOptions(profiles);
    await database.addToDatabase(profiles);

    // Upload to printer (Creality Hi: no SFTP server, so we use pure SSH exec + cat)
    await sendToPrinter();
  } catch (err) {
    console.error('\n[Filament-Sync] ERROR:', err?.message || err);
    if (process.env.FILAMENT_SYNC_DEBUG) {
      console.error(err);
    }
    process.exit(1);
  }
})();
