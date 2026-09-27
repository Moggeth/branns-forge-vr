[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'Ensure-SteamVR.ps1') -TimeoutSeconds 90
$build = Join-Path $root 'outputs/ember-gallery-build'
$exe = Join-Path $build 'EmberGallery.exe'
$pack = Join-Path $build 'EmberGallery.pck'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $pack)) {
  throw 'The older Ember Gallery VR export is missing. Rebuild the gallery or use the current Adventure.'
}
$logs = Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$output = Join-Path $logs "game-$stamp.log"
$arguments = @('--main-pack',('"'+$pack+'"'),'--xr-mode','on','--log-file',('"'+$output+'"'),'--','--playful-demo','--demo-persistent','--ember-gallery-demo')
Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $build | Out-Null
Write-Output 'Ember Gallery VR opened after SteamVR became ready.'
