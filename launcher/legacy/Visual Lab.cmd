@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\Visual Lab.ps1"
if errorlevel 1 pause
