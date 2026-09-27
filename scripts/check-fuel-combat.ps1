$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
foreach($case in @(@('fuel-combat-check','FUEL_COMBAT_CHECK_RESULT []'),@('fire-check','FIRE_CHECK PASS'),@('weather-game-check','WEATHER_GAME_CHECK_RESULT []'))){
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $log=Join-Path $projectRoot ('logs/'+$case[0]+'.log')
 & $engine --headless --xr-mode off --audio-driver Dummy --path (Join-Path $projectRoot 'godot') --quit-after 4000 -- ('--'+$case[0]) *> $log
 $result=Get-Content $log -Raw
 $passed=$LASTEXITCODE -eq 0 -and $result.Contains($case[1]) -and $result -notmatch 'SCRIPT ERROR:|ERROR:'
 ($case[0]+',passed='+$passed+','+$timer.Elapsed.TotalSeconds) | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
 if(!$passed){throw ('Failed '+$case[0]+': '+$log)}
 Write-Output ($case[0]+' passed in '+$timer.Elapsed.TotalSeconds+' seconds')
}
& (Join-Path $PSScriptRoot 'check-weather.ps1')
