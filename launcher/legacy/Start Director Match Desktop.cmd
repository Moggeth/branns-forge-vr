@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\start.ps1" -Desktop -DirectorMode
if errorlevel 1 pause
