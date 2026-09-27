$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$cases=@(
 @('chakram_checks','CHAKRAM_CHECK_RESULT'),
 @('playful_tools_checks','PLAYFUL_TOOLS_CHECK_RESULT'),
 @('playful_encounter_checks','BELLWORKS_CHECKS'),
 @('playful_feedback_checks','PLAYFUL_FEEDBACK_RESULT []'),
 @('playful_fair_art_checks','PLAYFUL_FAIR_ART_RESULT []'),
 @('magnetic_wand_checks','MAGNETIC_WAND_CHECK_RESULT'),
 @('cargo_playground_checks','CARGO_CHECKS'),
 @('playful_tuning_checks','PLAYFUL_TUNING_RESULT []'),
 @('living_lullaby_checks','LULLABY_CHECKS'),
 @('bankshot_checks','BANKSHOT_CHECKS'),
 @('bankshot_art_checks','BANKSHOT_ART_RESULT'),
 @('festival_relay_checks','FESTIVAL_RELAY_CHECKS'),
 @('festival_relay_art_checks','FESTIVAL_RELAY_ART_RESULT'),
 @('festival_relay_help_checks','FESTIVAL_RELAY_HELP_RESULT'),
 @('echo_bells_checks','ECHO_BELLS_CHECKS'),
 @('lantern_gallery_checks','LANTERN_GALLERY_CHECKS'),
 @('festival_flight_checks','FESTIVAL_FLIGHT_CHECKS'),
 @('arcade_input_ownership_checks','ARCADE_INPUT_OWNERSHIP_CHECKS'),
 @('inactive_playful_hand_checks','INACTIVE_PLAYFUL_HAND_CHECKS'),
 @('playful-integration','PLAYFUL_CHECK_RESULT []')
)
foreach($case in $cases){
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $log=Join-Path $projectRoot ('logs/'+$case[0]+'.log')
 $arguments=@('--headless','--xr-mode','off','--audio-driver','Dummy','--path',(Join-Path $projectRoot 'godot'),'--quit-after','4000')
 if($case[0] -eq 'playful-integration'){$arguments+=@('--','--playful-check')}
 else{$arguments+=@('--script',('res://'+$case[0]+'.gd'))}
 & $engine @arguments *> $log
 $result=Get-Content $log -Raw
 $passed=$LASTEXITCODE -eq 0 -and $result.Contains($case[1]) -and $result -notmatch 'SCRIPT ERROR:|ERROR:|failures=[1-9]|"failures":\["'
 ($case[0]+',passed='+$passed+','+$timer.Elapsed.TotalSeconds) | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
 if(!$passed){throw ('Failed '+$case[0]+': '+$log)}
 Write-Output ($case[0]+' passed in '+$timer.Elapsed.TotalSeconds+' seconds')
}
