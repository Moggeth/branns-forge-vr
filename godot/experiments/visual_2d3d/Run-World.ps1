param(
    [Parameter(Mandatory=$true)][string]$Spec,
    [Parameter(Mandatory=$true)][string]$Out,
    [switch]$CheckOnly,
    [switch]$Headless
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$godot = Join-Path $repo 'tools\godot\Godot_v4.7.2-stable_win64_console.exe'
$benchmark = Join-Path $repo 'experiments\visual-2d3d-20260928\benchmark.json'
$project = Join-Path $repo 'godot'
$specPath = (Resolve-Path $Spec).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$outPath = (Resolve-Path $Out).Path
$arguments = @('--xr-mode', 'off', '--audio-driver', 'Dummy', '--path', $project, '--script', 'res://experiments/visual_2d3d/run_world.gd', '--', "--spec=$specPath", "--benchmark=$benchmark", "--out=$outPath")
if ($CheckOnly) { $arguments += '--check-only' }
if ($Headless) { $arguments = @('--headless') + $arguments }
& $godot @arguments
exit $LASTEXITCODE
