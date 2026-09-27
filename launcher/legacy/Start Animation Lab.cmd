@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\Start Animation Lab.ps1"
if errorlevel 1 pause
