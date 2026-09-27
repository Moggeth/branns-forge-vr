@echo off
cd /d "%~dp0..\..\"
python "C:/Users/mog/.codex/skills/asset-showroom/scripts/showroom.py" --public --manifest "docs/atelier-showroom.json"
if errorlevel 1 pause
