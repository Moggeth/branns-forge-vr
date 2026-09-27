@echo off
cd /d "%~dp0..\..\"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\scripts\Start-ChakramShowcase.ps1"
pause
