[CmdletBinding()]
param([switch]$SkipArchive,[switch]$Persistent)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$timer=[Diagnostics.Stopwatch]::StartNew()
$output=Join-Path $projectRoot $(if($Persistent){'outputs/bellworks-persistent-build'}else{'outputs/bellworks-build'})
$console=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64.exe'
$log=Join-Path $projectRoot 'logs/bellworks-build.log'
New-Item -ItemType Directory -Force -Path $output,(Join-Path $output 'logs') | Out-Null
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --export-pack 'Bellworks Windows Demo' (Join-Path $output 'Bellworks.pck') *> $log
$result=Get-Content $log -Raw
if($LASTEXITCODE -ne 0 -or $result -match 'SCRIPT ERROR:|ERROR:' -or !(Test-Path (Join-Path $output 'Bellworks.pck'))){throw "Export failed; inspect $log"}
Copy-Item -LiteralPath $engine -Destination (Join-Path $output 'Bellworks.exe')
& $console --headless --xr-mode off --path (Join-Path $projectRoot 'godot') --script res://package_licenses.gd -- ('--output='+$output) *> (Join-Path $projectRoot 'logs/bellworks-licenses.log')
if($LASTEXITCODE -ne 0 -or !(Test-Path (Join-Path $output 'GODOT-LICENSES.txt'))){throw 'Could not package engine licence notices'}
$desktop='@echo off'+"`r`n"+'cd /d "%~dp0"'+"`r`n"+'if not exist logs mkdir logs'+"`r`n"+'"%~dp0Bellworks.exe" --main-pack "%~dp0Bellworks.pck" --xr-mode off --log-file "%~dp0logs\game.log" -- --playful-demo'+"`r`n"
if($Persistent){$desktop=$desktop.Replace('--playful-demo','--playful-demo --demo-persistent')}
Set-Content -LiteralPath (Join-Path $output 'Play Desktop.cmd') -Value $desktop -Encoding ascii
Set-Content -LiteralPath (Join-Path $output 'Play VR.cmd') -Value ($desktop.Replace('--xr-mode off','--xr-mode on')) -Encoding ascii
@'
BELLWORKS - BRANN'S FORGE PLAYABLE DEMO

Open Play Desktop.cmd. No installation, service, API key or headset required.
Use the CMD launcher; opening Bellworks.exe alone shows launch instructions.
Keep only ONE persistent demo window open at a time. Concurrent sessions can
overwrite progress or undo a reset; shared-save locking is not implemented.
WASD walks. Hold right mouse to look. E picks up or throws Sunskipper.
Left click changes held throw strength or recalls a flying ring.
Take the ring from the stand on the left. Follow the three-trial board.
Cross the bridge on the right for Copper Kite: E equips, click pulls/drops,
X tosses. Set SUN, LEAF and MOON into matching nests, then use the lever.

Tab opens the toolbelt. Travel includes Bankshot Bell: bounce Sunskipper off
the teal panel, then into three moving bell positions. COURTYARD power is a
good starting point. Replay keeps your best score and earned medal.
Travel > Festival Relay links ring hits, cargo and garden light/song. Start
Practice for no clock, or Personal Best for an optional stopwatch with no limit.
NEXT at the relay posts guides you between tasks. Restart/Abandon keep medals.
Travel > More places finds Echo Bells and Lantern Parade. Echo Bells plays a
short phrase: click the matching bells in order, or grip/pull/release their
clappers in VR. Replay helps; New Round starts fresh. Lantern Parade calls out
six moving targets in order. Throw Sunskipper through the named lantern;
COURTYARD power is a good start. Both games are untimed, with saved medals and
best results. Retry/Abandon preserve achievements; unfinished rounds reset.
In Hall of Inventions, browse experiments to The Unfinished Lullaby; prepare
it, wait for the ready message, then Enter Experiment. Offer its buds light,
warmth and sound. Cinderloop is another optional experiment, at its forge stand.
Tuning in this offline demo is session-only, with Undo last.

Play VR.cmd requires a configured SteamVR/OpenXR headset. Grip picks up;
release throws; trigger changes power or recalls. Hardware validation pending.

This is an offline snapshot. Progress resets when closed. It does not connect
to Brann's voice, commission service or your normal inventory/saves.
Use the return gate to look around the forge. Service-dependent actions there
are unavailable. The full installed game saves Bellworks achievements normally.

Close the window to stop. If a launch fails, inspect logs/game.log.
This package includes the Godot editor runtime used only as a game player.
Its licence and third-party notices are in GODOT-LICENSES.txt.
'@ | Set-Content -LiteralPath (Join-Path $output 'READ ME.txt') -Encoding utf8
if($Persistent){
 $readme=Join-Path $output 'READ ME.txt'
 $text=Get-Content -LiteralPath $readme -Raw
 $text=$text.Replace('Tuning in this offline demo is session-only, with Undo last.','Tuning persists in this demo; Undo last applies to this session.')
 $text=$text.Replace('This is an offline snapshot. Progress resets when closed. It does not connect','This is an offline demo with its own saved progress. It does not connect')
 $text+="`nSaved progress lives only in the BellworksDemo subfolder of Godot's Brann's Forge VR user data. It never reads/writes normal world saves. Tab > Demo shows save status, help and a two-step Reset demo progress button. Reset keeps a dated backup. Trials, trophies, supported tuning and the two featured experiments persist; dropped/held object poses and flights reset. Corrupt saves recover from a valid backup; incompatible future saves stay untouched until explicit reset.`n"
 Set-Content -LiteralPath $readme -Value $text -Encoding utf8
}
$manifest=[ordered]@{builtUtc=[DateTime]::UtcNow.ToString('o');mode=$(if($Persistent){'persistent-offline-playful-demo'}else{'offline-playful-demo'});engine='Godot 4.7.2';files=@()}
foreach($name in @('Bellworks.exe','Bellworks.pck','GODOT-LICENSES.txt')){
 $file=Get-Item -LiteralPath (Join-Path $output $name)
 $manifest.files+=@{name=$name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
if(!$SkipArchive){
 $archive=Join-Path $projectRoot ($(if($Persistent){'outputs/Bellworks-Persistent-Demo-'}else{'outputs/Bellworks-Demo-'})+(Get-Date -Format yyyyMMdd-HHmmss)+'.zip')
 Compress-Archive -LiteralPath (Join-Path $output 'Bellworks.exe'),(Join-Path $output 'Bellworks.pck'),(Join-Path $output 'GODOT-LICENSES.txt'),(Join-Path $output 'Play Desktop.cmd'),(Join-Path $output 'Play VR.cmd'),(Join-Path $output 'READ ME.txt'),(Join-Path $output 'manifest.json') -DestinationPath $archive
 Write-Output "Archive: $archive"
}
"bellworks-build,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $projectRoot 'logs/work-timing.csv')
Write-Output "Playable folder: $output"
