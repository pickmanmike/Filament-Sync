const { initData, readProfiles, sendToPrinter } = require('./tools/config.js')
const { updateMaterialDatabase } = require('./tools/database-tool.js')
const { updateMaterialOptions } = require('./tools/options-tool.js')
const { installService } = require('./tools/service-installer.js')

;(async () => {
  try {
    // 1) Ensure ./data exists + seed from ./tools/sourcedata
    initData()

    // 2) Read local slicer presets (Creality Print or Orca)
    const profiles = readProfiles()

    // 3) Update JSON files in ./data
    updateMaterialDatabase(profiles)
    updateMaterialOptions(profiles)

    // 4) Ensure printer-side service is present (no-op if already installed)
    await installService()

    // 5) Upload DB/OPT to the printer
    await sendToPrinter()
  } catch (err) {
    console.error(err && err.stack ? err.stack : err)
    process.exitCode = 1
  }
})()
