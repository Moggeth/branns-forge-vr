[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$engine=Join-Path $projectRoot 'tools/blender-4.5.13-windows-x64/blender.exe'
if(!(Test-Path -LiteralPath $engine)){throw 'Blender 4.5.13 LTS is missing. See docs/SIEGEBIRD.md for the local tool setup.'}
$timer=[Diagnostics.Stopwatch]::StartNew()
$result='failed'
Push-Location $projectRoot
try {
  & $engine --background --factory-startup --python-exit-code 2 --python assets/siegebird-opus/build_siegebird_opus.py *> logs/siegebird-build.log
  if($LASTEXITCODE -ne 0){throw 'Siegebird asset build failed. See logs/siegebird-build.log and assets/siegebird-opus/logs/build_report.json.'}
  Copy-Item -LiteralPath assets/siegebird-opus/siegebird-opus.glb -Destination godot/assets/siegebird/siegebird.glb
  & tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot -- --siegebird-check *> logs/siegebird-rebuilt-check.log
  if($LASTEXITCODE -ne 0 -or (Get-Content logs/siegebird-rebuilt-check.log -Raw) -match '(?m)^(SCRIPT ERROR:|ERROR:)' -or (Get-Content logs/siegebird-rebuilt-check.log -Raw) -notmatch 'SIEGEBIRD_RESULT \[\]'){throw 'Siegebird runtime checks failed. See logs/siegebird-rebuilt-check.log.'}
  $result='passed'
  Write-Output 'Siegebird rebuilt and verified. Source blend, bundled GLB and clearance report refreshed.'
}finally{
  "$result-siegebird-builder,$($timer.Elapsed.TotalSeconds)" | Add-Content logs/work-timing.csv
  Pop-Location
}
