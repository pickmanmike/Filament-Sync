@echo off
setlocal
set CREALITY_PRINT_VERSION=6.0
call "%~dp0windows-sync.bat" %*
exit /b %errorlevel%
