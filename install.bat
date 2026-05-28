@echo off
REM Digi Deck installer launcher.
REM Double-click this file to install. It just runs install.ps1 with the right flags.

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

echo.
pause
