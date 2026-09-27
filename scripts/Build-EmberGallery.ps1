[CmdletBinding()]
param([switch]$SkipArchive,[string]$OutputName='ember-gallery-build')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$timer=[Diagnostics.Stopwatch]::StartNew()
$output=Join-Path $projectRoot ('outputs/'+$OutputName)
$console=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64.exe'
$log=Join-Path $projectRoot 'logs/ember-build.log'
New-Item -ItemType Directory -Force $output,(Join-Path $output 'logs') | Out-Null
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --export-pack 'Bellworks Windows Demo' (Join-Path $output 'EmberGallery.pck') *> $log
$result=Get-Content $log -Raw
if($LASTEXITCODE -ne 0 -or $result -match 'SCRIPT ERROR:|ERROR:' -or !(Test-Path (Join-Path $output 'EmberGallery.pck'))){throw "Export failed: $log"}
Copy-Item -LiteralPath $engine -Destination (Join-Path $output 'EmberGallery.exe')
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --script res://package_licenses.gd -- ('--output='+$output) *> (Join-Path $projectRoot 'logs/ember-licenses.log')
if($LASTEXITCODE -ne 0 -or !(Test-Path (Join-Path $output 'GODOT-LICENSES.txt'))){throw 'Licence packaging failed'}
$desktop='@echo off'+"`r`n"+'cd /d "%~dp0"'+"`r`n"+'if not exist logs mkdir logs'+"`r`n"+'"%~dp0EmberGallery.exe" --main-pack "%~dp0EmberGallery.pck" --xr-mode off --log-file "%~dp0logs\game.log" -- --playful-demo --demo-persistent --ember-gallery-demo'+"`r`n"
Set-Content -LiteralPath (Join-Path $output 'Play Desktop.cmd') -Value $desktop -Encoding ascii
Set-Content -LiteralPath (Join-Path $output 'Play VR.cmd') -Value ($desktop.Replace('--xr-mode off','--xr-mode on')) -Encoding ascii
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/EMBER-GALLERY-PLAY.txt') -Destination (Join-Path $output 'READ ME.txt')
$manifest=[ordered]@{builtUtc=[DateTime]::UtcNow.ToString('o');mode='persistent-offline-ember-gallery';engine='Godot 4.7.2';saveNamespace='EmberGalleryDemo';files=@()}
foreach($name in @('EmberGallery.exe','EmberGallery.pck','GODOT-LICENSES.txt','Play Desktop.cmd','Play VR.cmd','READ ME.txt')){
 $file=Get-Item -LiteralPath (Join-Path $output $name)
 $manifest.files+=@{name=$name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $output 'manifest.json')
if(!$SkipArchive){
 $archive=Join-Path $projectRoot ('outputs/Ember-Gallery-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.zip')
 $names=@('EmberGallery.exe','EmberGallery.pck','GODOT-LICENSES.txt','Play Desktop.cmd','Play VR.cmd','READ ME.txt','manifest.json') | ForEach-Object {Join-Path $output $_}
 Compress-Archive -LiteralPath $names -DestinationPath $archive
 Write-Output "Archive: $archive"
}
"ember-build,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
Write-Output "Playable folder: $output"

