@echo off
setlocal

REM Run from this repo directory even if called from elsewhere
pushd "%~dp0"

REM Optional: enable verbose logging
REM set FILAMENT_SYNC_DEBUG=1

REM 1) Work around Creality Print bug by generating /filament/base presets
node fix-creality-base-filaments.js
if errorlevel 1 goto :err

REM 2) Build material_database.json + material_option.json and upload to printer
node main.js
if errorlevel 1 goto :err

popd
endlocal
exit /b 0

:err
echo.
echo [windows-sync] ERROR: sync failed (exit code %ERRORLEVEL%).
popd
endlocal
exit /b 1
