param([switch]$DesktopVisual)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$game = Join-Path $root 'godot'
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
if (!(Test-Path -LiteralPath $engine)) { throw "Bundled Godot missing: $engine" }

$checks = @(
  @{ name='view'; script='director_local_view_checks.gd'; marker='DIRECTOR_LOCAL_CHECK passed'; args=@() },
  @{ name='integration'; script='director_local_integration_checks.gd'; marker='DIRECTOR_LOCAL_INTEGRATION {"failures":[]}'; args=@('--','--director-mode','--director-window') }
)
foreach ($check in $checks) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $log = Join-Path $logs "director-local-$($check.name)-$stamp.log"
  $arguments = @('--headless','--xr-mode','off','--audio-driver','Dummy','--path',$game,'--script',"res://$($check.script)") + $check.args
  $output = (& $engine @arguments 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  Set-Content -LiteralPath $log -Value $output
  $status = if ($exitCode -eq 0 -and $output.Contains($check.marker) -and $output -notmatch 'SCRIPT ERROR:|ERROR:') { 'passed' } else { 'failed' }
  "director-local-$($check.name),$status,$($timer.Elapsed.TotalSeconds.ToString('F3',[Globalization.CultureInfo]::InvariantCulture))" | Add-Content -LiteralPath (Join-Path $logs 'work-timing.csv')
  if ($status -ne 'passed') { throw "$($check.name) failed. See $log" }
  Write-Output "PASS director local $($check.name) ($([math]::Round($timer.Elapsed.TotalSeconds,2))s)"
}
if ($DesktopVisual) {
  Write-Output 'Running graphical desktop rehearsal; this briefly opens two windows.'
  & $engine --xr-mode off --audio-driver Dummy --path $game --script res://director_local_visual_check.gd -- --director-mode --director-window
  if ($LASTEXITCODE -ne 0) { throw 'Visual capture failed.' }
  & $engine --xr-mode off --audio-driver Dummy --path $game --script res://director_vr_performance_check.gd -- --director-mode --director-window
  if ($LASTEXITCODE -ne 0) { throw 'Desktop performance rehearsal failed.' }
}
