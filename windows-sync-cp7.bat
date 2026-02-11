@echo off
setlocal
set CREALITY_PRINT_VERSION=7.0
call "%~dp0windows-sync.bat" %*
exit /b %errorlevel%
