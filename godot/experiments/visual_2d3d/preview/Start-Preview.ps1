param(
    [ValidateSet('A','B','C','D','E')][string]$Variant = 'E',
    [switch]$Fresh,
    [string]$Scene = '',
    [switch]$Smoke
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$project = Join-Path $repo 'godot'
$godot = Join-Path $repo 'tools\godot\Godot_v4.7.2-stable_win64_console.exe'
if (-not (Test-Path -LiteralPath $godot)) { throw "Godot console missing: $godot" }
if ($Scene) {
    if ($Scene -notlike 'res://*') { throw 'Scene must be a res:// path inside the Godot project.' }
    $scenePath = $Scene
} elseif (-not $Fresh) {
    $candidate = "res://experiments/visual_2d3d/$($Variant.ToLowerInvariant())_smoke/world.tscn"
    $diskCandidate = Join-Path $project ($candidate.Substring(6) -replace '/', '\')
    $scenePath = if (Test-Path -LiteralPath $diskCandidate) { $candidate } else { '' }
} else {
    $scenePath = ''
}
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$logPath = Join-Path $logs "preview-$Variant-$stamp.log"
$consolePath = Join-Path $logs "preview-$Variant-$stamp.console.log"
$args = @('--xr-mode','off','--audio-driver','Dummy','--path',$project,'--script','res://experiments/visual_2d3d/preview/preview.gd','--',"--variant=$Variant","--log=$logPath")
if ($scenePath) { $args += "--scene=$scenePath" }
if ($Smoke) { $args = @('--headless') + $args; $args += '--smoke' }
Write-Host "Preview $Variant; scene: $(if ($scenePath) { $scenePath } else { 'fresh world_spec build' }); log: $logPath"
& $godot @args 2>&1 | Tee-Object -FilePath $consolePath
exit $LASTEXITCODE
