[CmdletBinding()]
param([string]$OutputName='atelier-trial-20260924')
$ErrorActionPreference='Stop'
& "$PSScriptRoot/Build-FairyCoop.ps1" -OutputName $OutputName
$root=Split-Path $PSScriptRoot -Parent
$output=Join-Path $root ('outputs/'+$OutputName)
$launcher='@echo off'+"`r`n"+'cd /d "%~dp0"'+"`r`n"+'if not exist logs mkdir logs'+"`r`n"+'"%~dp0LittleWing.exe" --main-pack "%~dp0LittleWing.pck" --xr-mode off --log-file "%~dp0logs\atelier.log" -- --playful-demo --atelier-demo'+"`r`n"
Set-Content -LiteralPath (Join-Path $output 'Play Atelier.cmd') -Value $launcher -Encoding ascii
Set-Content -LiteralPath (Join-Path $output 'Play Atelier VR.cmd') -Value ($launcher.Replace('--xr-mode off','--xr-mode on')) -Encoding ascii
Copy-Item -LiteralPath (Join-Path $root 'docs/ATELIER-TRIAL.md') -Destination (Join-Path $output 'ATELIER-TRIAL.md')
$manifest=Get-Content (Join-Path $output 'manifest.json') -Raw | ConvertFrom-Json
$manifest.mode='offline-atelier-and-fairy'
foreach($name in @('Play Atelier.cmd','Play Atelier VR.cmd','ATELIER-TRIAL.md')){
 $file=Get-Item -LiteralPath (Join-Path $output $name)
 $manifest.files+=@{name=$name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $output 'manifest.json')
$files=@($manifest.files | ForEach-Object {Join-Path $output $_.name})+@(Join-Path $output 'manifest.json')
Compress-Archive -LiteralPath $files -DestinationPath (Join-Path $root ('outputs/Branns-Atelier-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.zip'))
