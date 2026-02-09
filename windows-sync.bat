@echo off
setlocal EnableExtensions

REM ------------------------------------------------------------
REM Filament-Sync Windows wrapper
REM Pipeline:
REM   1) Pull printer DB/OPT into .\tools\sourcedata\   (baseline for multi-PC)
REM   2) Expand Creality Print "base" presets            (skip unless stale)
REM   3) Run Filament-Sync merge + upload
REM
REM Optional env vars:
REM   CREALITY_PRINT_VERSION=6.0|7.0
REM   FILAMENT_SYNC_DEBUG=1
REM   FILAMENT_SYNC_AUTO_NOTES=1
REM   FILAMENT_SYNC_BACKUP=0
REM ------------------------------------------------------------

cd /d "%~dp0"

echo [windows-sync] Repo: %CD%
if not exist "node_modules" (
  echo [windows-sync] WARN: node_modules not found. Run: npm install
)

echo.
echo [windows-sync] Step 1/3: Pull current printer DB/OPT into .\tools\sourcedata
node pull-printer-sourcedata.js
if errorlevel 1 (
  echo [windows-sync] ERROR: pull-printer-sourcedata.js failed. Aborting to avoid clobbering another PC's changes.
  exit /b 1
)

echo.
echo [windows-sync] Step 2/3: Ensure base presets exist (skip unless stale)
node fix-creality-base-filaments.js
if errorlevel 1 (
  echo [windows-sync] ERROR: fix-creality-base-filaments.js failed.
  exit /b 1
)

echo.
echo [windows-sync] Step 3/3: Run Filament-Sync (merge + upload)
node main.js
exit /b %errorlevel%
