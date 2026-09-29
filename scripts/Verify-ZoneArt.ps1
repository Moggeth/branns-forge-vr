param(
  [Parameter(Mandatory = $true)][string[]]$Zones,
  [switch]$Render
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$godot = Join-Path $repo 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$project = Join-Path $repo 'godot'
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$importLog = Join-Path $logDir "zone-art-import-$stamp.log"
$routeLog = Join-Path $logDir "zone-art-route-$stamp.log"
$renderLog = Join-Path $logDir "zone-art-render-$stamp.log"
$routeZones = @('sandstone_quarry', 'ember_foundry', 'enchanted_kitchen', 'mushroom_glade')
$timer = [Diagnostics.Stopwatch]::StartNew()
$outcome = 'failed'

try {
  if (!(Test-Path -LiteralPath $godot)) { throw "Godot executable missing: $godot" }
  foreach ($zone in $Zones) {
    if ($zone -notmatch '^[a-z][a-z0-9_]*$') { throw "Invalid zone name: $zone" }
    $manifest = Join-Path $project "assets/zone_art/$zone/placement.json"
    if (!(Test-Path -LiteralPath $manifest)) { throw "Authored manifest missing: $manifest" }
    & python (Join-Path $repo 'scripts/validate_zone_art.py') $manifest
    if ($LASTEXITCODE -ne 0) { throw "Asset validation failed for $zone" }
  }

  & $godot --headless --editor --xr-mode off --audio-driver Dummy --path $project --import --quit *> $importLog
  if ($LASTEXITCODE -ne 0) { throw "Godot asset import failed; inspect $importLog" }
  Write-Output "ZONE_ART_IMPORT_OK $importLog"

  $selectedRoutes = @($Zones | Where-Object { $_ -in $routeZones })
  if ($selectedRoutes.Count -gt 0) {
    $selection = '--zone=' + ($selectedRoutes -join ',')
    & $godot --headless --xr-mode off --audio-driver Dummy --path $project --script res://zone_art_route_checks.gd --quit-after 2400 -- $selection --require-authored *> $routeLog
    if ($LASTEXITCODE -ne 0) { throw "Art blocked a gameplay route; inspect $routeLog" }
    Write-Output "ZONE_ART_ROUTES_OK $routeLog"
  }

  if ($Render) {
    & $godot --xr-mode off --audio-driver Dummy --path $project --script res://environment_art_review.gd --quit-after 2400 -- --world-builder-preview *> $renderLog
    if ($LASTEXITCODE -ne 0) { throw "Godot environment capture failed; inspect $renderLog" }
    & python (Join-Path $repo 'scripts/make_environment_contact_sheet.py')
    if ($LASTEXITCODE -ne 0) { throw 'Contact sheet generation failed' }
    Write-Output "ZONE_ART_RENDER_OK $renderLog"
  }
  $outcome = 'passed'
  Write-Output "ZONE_ART_VERIFY_OK zones=$($Zones -join ',') seconds=$([math]::Round($timer.Elapsed.TotalSeconds, 3))"
} finally {
  "2026-09-30 zone art verify $($Zones -join '+'),$outcome,$([math]::Round($timer.Elapsed.TotalSeconds, 3))" | Add-Content -LiteralPath (Join-Path $logDir 'work-timing.csv')
}
