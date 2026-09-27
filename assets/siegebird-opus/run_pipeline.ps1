# Siegebird-Opus pipeline: build (with clearance sweep) -> render -> Godot import + contract verification.
# Logs go to logs/, per-stage durations are appended to logs/timings.csv.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$blender = Resolve-Path '..\..\tools\blender-4.5.13-windows-x64\blender.exe'
$godot   = Resolve-Path '..\..\tools\godot\Godot_v4.7.2-stable_win64_console.exe'
New-Item -ItemType Directory -Force logs, renders | Out-Null
function Stage($name, [scriptblock]$body) {
  $t = [Diagnostics.Stopwatch]::StartNew(); & $body; $code = $LASTEXITCODE; $t.Stop()
  "$(Get-Date -Format s),$name,$([math]::Round($t.Elapsed.TotalSeconds,2)),$code" | Add-Content logs\timings.csv
  Write-Host ("{0,-8} {1,7:N1}s exit {2}" -f $name, $t.Elapsed.TotalSeconds, $code)
  if ($code -ne 0) { throw "$name failed ($code); see logs" }
}
Stage 'build'  { & $blender -b --factory-startup --python-exit-code 2 --python build_siegebird_opus.py *> logs\build.log }
Stage 'render' { & $blender -b Siegebird-Opus.blend --python-exit-code 2 --python render_siegebird_opus.py *> logs\render.log }
Copy-Item siegebird-opus.glb, contract\assembly.json godot_verify\ -Force
Stage 'import' { & $godot --headless --path godot_verify --import *> logs\godot_import.log }
Stage 'verify' { & $godot --headless --path godot_verify --script res://verify.gd *> logs\godot_verify.log }
Select-String -Path logs\build.log -Pattern 'CLEARANCE|TRIANGLES'
Select-String -Path logs\godot_verify.log -Pattern 'STATS|TIP|RESULT'
