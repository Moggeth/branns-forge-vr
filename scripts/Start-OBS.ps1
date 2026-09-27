[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe='C:\Program Files\obs-studio\bin\64bit\obs64.exe'
if(!(Test-Path $exe)){throw 'OBS Studio is not installed.'}
if(!(Test-Path "$env:APPDATA\obs-studio\basic\profiles\BrannsForge\basic.ini")){throw 'Run python scripts/setup_obs.py once, with OBS closed.'}
if(Get-Process obs64 -ErrorAction SilentlyContinue){return}
# OBS 32 removed --disable-shutdown-check. Preserve its stale launch sentinel
# only when no OBS instance exists, so the dedicated recorder can start normally.
$obsRoot=[IO.Path]::GetFullPath((Join-Path $env:APPDATA 'obs-studio'))
$sentinel=Join-Path $obsRoot '.sentinel'
$logDir=Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if(Test-Path -LiteralPath $sentinel){
    $resolved=(Resolve-Path -LiteralPath $sentinel).Path
    if($resolved -ne [IO.Path]::GetFullPath($sentinel)){throw 'Unexpected OBS sentinel path.'}
    $backup=Join-Path $logDir ('obs-sentinel-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $resolved -Destination $backup
    Add-Content -LiteralPath (Join-Path $logDir 'obs-startup.log') -Value "$(Get-Date -Format o) Preserved stale shutdown sentinel at $backup; starting dedicated recorder normally."
}
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList '--profile "Branns Forge Silent" --collection "Branns Forge" --minimize-to-tray --disable-missing-files-check' -WindowStyle Hidden
