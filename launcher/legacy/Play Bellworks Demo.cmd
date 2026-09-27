@echo off
cd /d "%~dp0..\..\"
"%~dp0..\..\tools\godot\Godot_v4.7.2-stable_win64.exe" --path "%~dp0..\..\godot" --xr-mode off --log-file "%~dp0..\..\logs\bellworks-demo.log" -- --playful-demo
