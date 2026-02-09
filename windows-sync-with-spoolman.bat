@echo off
setlocal EnableExtensions

REM Optional wrapper that runs Filament-Sync first, then a Spoolman sync script (if configured).
REM
REM Set this env var to point at your Spoolman/RFID integration script:
REM   SPOOLMAN_SYNC_SCRIPT=C:\path\to\setup-spoolman-and-sync.ps1

cd /d "%~dp0"

call "%~dp0windows-sync.bat"
if errorlevel 1 exit /b %errorlevel%

if not defined SPOOLMAN_SYNC_SCRIPT (
  echo [spoolman] SPOOLMAN_SYNC_SCRIPT not set. Skipping Spoolman sync.
  exit /b 0
)

if not exist "%SPOOLMAN_SYNC_SCRIPT%" (
  echo [spoolman] WARN: SPOOLMAN_SYNC_SCRIPT does not exist: %SPOOLMAN_SYNC_SCRIPT%
  exit /b 0
)

echo [spoolman] Running: %SPOOLMAN_SYNC_SCRIPT%

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%SPOOLMAN_SYNC_SCRIPT%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SPOOLMAN_SYNC_SCRIPT%"
)

exit /b %errorlevel%
