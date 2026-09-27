[CmdletBinding()]
param([switch]$SmokeTest)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs'
$work = Join-Path $root 'work/asset-lab-setup'
$blenderDir = Join-Path $root 'tools/blender-4.5.13-windows-x64'
$blender = Join-Path $blenderDir 'blender.exe'
$godot = Join-Path $root 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$zip = Join-Path $work 'blender-4.5.13-windows-x64.zip'
$expectedSha = 'B5FDF800CE65FA2F209E8F68D02667E4D720FA1C42F247C72D1882AB04DECBA6'
$timer = [Diagnostics.Stopwatch]::StartNew()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $logs,$work | Out-Null
$log = Join-Path $logs "asset-lab-setup-$stamp.log"
$result = 'failed'

try {
    if (!(Test-Path -LiteralPath $godot -PathType Leaf)) {
        throw 'Godot 4.7.2 is missing. Run Setup Tools.ps1 first.'
    }
    if (!(Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python 3.9+ is required on PATH.' }
    if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required on PATH.' }
    if (!(Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required on PATH.' }
    if (!(Test-Path -LiteralPath $blender -PathType Leaf)) {
        $url = 'https://download.blender.org/release/Blender4.5/blender-4.5.13-windows-x64.zip'
        "Downloading official Blender 4.5.13 archive: $url" | Tee-Object -FilePath $log -Append
        if (!(Test-Path -LiteralPath $zip -PathType Leaf)) {
            Invoke-WebRequest -Uri $url -OutFile $zip
        }
        $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
        if ($actual -ne $expectedSha) {
            throw "Blender archive checksum mismatch: $actual; expected $expectedSha. Remove only the cached archive at $zip and retry."
        }
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $root 'tools') -Force
    }
    if (!(Test-Path -LiteralPath $blender -PathType Leaf)) { throw "Blender executable missing after setup: $blender" }
    & npm ci --prefix (Join-Path $root 'assets/asset-lab') --no-audit --no-fund *>> $log
    if ($LASTEXITCODE -ne 0) { throw "Khronos validator install failed. See $log" }
    & $blender --background --version | Select-Object -First 1 | Tee-Object -FilePath $log -Append
    & $godot --version | Tee-Object -FilePath $log -Append
    if ($SmokeTest) {
        & python (Join-Path $root 'scripts/asset_lab.py') build (Join-Path $root 'assets/asset-lab/pilot/asset.json') *>> $log
        if ($LASTEXITCODE -ne 0) { throw "Asset Lab pilot failed. See $log" }
    }
    $result = 'passed'
    Write-Output "Asset Lab ready. Setup log: $log"
} catch {
    ($_ | Out-String) | Add-Content -LiteralPath $log
    throw
} finally {
    "asset-lab-setup-$result,$($timer.Elapsed.TotalSeconds)" | Add-Content -LiteralPath (Join-Path $logs 'work-timing.csv')
}
