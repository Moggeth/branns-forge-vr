[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe='C:\Program Files\obs-studio\bin\64bit\obs64.exe'
if(!(Test-Path $exe)){throw 'OBS Studio is not installed.'}
if(!(Test-Path "$env:APPDATA\obs-studio\basic\profiles\BrannsForge\basic.ini")){throw 'Run python scripts/setup_obs.py once, with OBS closed.'}
if(Get-Process obs64 -ErrorAction SilentlyContinue){return}
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList '--profile "Branns Forge Silent" --collection "Branns Forge" --minimize-to-tray --disable-missing-files-check' -WindowStyle Hidden
