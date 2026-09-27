param([switch]$Capture)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$clock=[Diagnostics.Stopwatch]::StartNew()
$log=Join-Path $projectRoot 'logs/weather-verification.log'
$arguments=@('--xr-mode','off','--audio-driver','Dummy','--path',(Join-Path $projectRoot 'godot'),'--script','visual_demo.gd')
if(!$Capture){$arguments=@('--headless')+$arguments}
$arguments+=@('--','--weather-lab','--weather-check')
if($Capture){$arguments+=('--capture-demos='+(Join-Path $projectRoot 'outputs/visual-lab'))}
$result='failed'
try {
 & (Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe') @arguments *> $log
 $text=Get-Content $log -Raw
 if($LASTEXITCODE -ne 0 -or $text -match 'SCRIPT ERROR:|ERROR:' -or !$text.Contains('WEATHER_CHECK_RESULT []')){throw "Weather check failed: $log"}
 if($Capture -and !$text.Contains('WEATHER_CAPTURE_COMPLETE')){throw 'Weather capture incomplete'}
 $result='passed'
 Write-Output "Weather checks passed in $($clock.Elapsed.TotalSeconds) seconds. Log: $log"
}finally {"weather-verification,$result,$($clock.Elapsed.TotalSeconds)" | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')}
