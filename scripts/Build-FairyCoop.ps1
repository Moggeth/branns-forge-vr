[CmdletBinding()]
param([string]$OutputName='fairy-coop-build')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$timer=[Diagnostics.Stopwatch]::StartNew()
$output=Join-Path $projectRoot ('outputs/'+$OutputName)
$console=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64.exe'
$log=Join-Path $projectRoot 'logs/fairy-build.log'
New-Item -ItemType Directory -Force $output,(Join-Path $output 'logs') | Out-Null
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --export-pack 'Bellworks Windows Demo' (Join-Path $output 'LittleWing.pck') *> $log
$result=Get-Content $log -Raw
if($LASTEXITCODE -ne 0 -or $result -match 'SCRIPT ERROR:|ERROR:' -or !(Test-Path (Join-Path $output 'LittleWing.pck'))){throw "Export failed: $log"}
Copy-Item -LiteralPath $engine -Destination (Join-Path $output 'LittleWing.exe')
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --script res://package_licenses.gd -- ('--output='+$output) *> (Join-Path $projectRoot 'logs/fairy-licenses.log')
if($LASTEXITCODE -ne 0 -or !(Test-Path (Join-Path $output 'GODOT-LICENSES.txt'))){throw 'Licence packaging failed'}
$desktop='@echo off'+"`r`n"+'cd /d "%~dp0"'+"`r`n"+'if not exist logs mkdir logs'+"`r`n"+'"%~dp0LittleWing.exe" --main-pack "%~dp0LittleWing.pck" --xr-mode off --log-file "%~dp0logs\game.log" -- --playful-demo --fairy-coop'+"`r`n"
Set-Content -LiteralPath (Join-Path $output 'Play Flight Practice.cmd') -Value $desktop -Encoding ascii
Set-Content -LiteralPath (Join-Path $output 'Play VR + Fairy.cmd') -Value ($desktop.Replace('--xr-mode off','--xr-mode on')) -Encoding ascii
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/FAIRY-PLAY.txt') -Destination (Join-Path $output 'READ ME.txt')
$manifest=[ordered]@{builtUtc=[DateTime]::UtcNow.ToString('o');mode='offline-local-coop';engine='Godot 4.7.2';progress='resets-on-exit';files=@()}
foreach($name in @('LittleWing.exe','LittleWing.pck','GODOT-LICENSES.txt','Play Flight Practice.cmd','Play VR + Fairy.cmd','READ ME.txt')){
 $file=Get-Item -LiteralPath (Join-Path $output $name)
 $manifest.files+=@{name=$name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $output 'manifest.json')
$archive=Join-Path $projectRoot ('outputs/Little-Wing-Coop-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.zip')
$names=@('LittleWing.exe','LittleWing.pck','GODOT-LICENSES.txt','Play Flight Practice.cmd','Play VR + Fairy.cmd','READ ME.txt','manifest.json') | ForEach-Object {Join-Path $output $_}
Compress-Archive -LiteralPath $names -DestinationPath $archive
"fairy-build,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
Write-Output "Archive: $archive"
