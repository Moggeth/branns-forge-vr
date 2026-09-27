@echo off
cd /d "%~dp0..\..\"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\start.ps1" -ExperimentalFuelCombat -Desktop
