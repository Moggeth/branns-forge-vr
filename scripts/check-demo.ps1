$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
foreach($name in @('demo_save_store_checks','demo_session_checks','demo_tuning_checks','bankshot_session_checks','festival_session_checks','arcade_session_checks','persistence_edge_checks')){
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $log=Join-Path $projectRoot ('logs/'+$name+'.log')
 & $engine --headless --xr-mode off --audio-driver Dummy --path (Join-Path $projectRoot 'godot') --quit-after 4000 --script ('res://'+$name+'.gd') -- --demo-session-check --playful-demo *> $log
 $text=Get-Content $log -Raw
 $passed=$LASTEXITCODE -eq 0 -and $text -notmatch 'SCRIPT ERROR:|ERROR:|failures=[1-9]|"failures":\["' -and $text -match '(DEMO_(SAVE_STORE_RESULT|SESSION_CHECKS|TUNING_RESULT)|BANKSHOT_SESSION_CHECKS|FESTIVAL_SESSION_CHECKS|ARCADE_SESSION_CHECKS|PERSISTENCE_EDGE_CHECKS)'
 ($name+',passed='+$passed+','+$timer.Elapsed.TotalSeconds) | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
 if(!$passed){throw "Demo check failed: $log"}
 Write-Output ($name+' passed in '+$timer.Elapsed.TotalSeconds+' seconds')
}
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
if(!$node){$node='C:\Program Files\nodejs\node.exe'}
& $node (Join-Path $PSScriptRoot 'check-demo-persistence.cjs')
if($LASTEXITCODE -ne 0){throw 'Full-process demo persistence checks failed'}
