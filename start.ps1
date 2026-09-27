[CmdletBinding()]
param([switch]$Desktop,[switch]$ServiceOnly,[switch]$ExperimentalFuelCombat,[switch]$FairyCoop,[switch]$DirectorMode,[switch]$DirectorLocal)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$timer=[Diagnostics.Stopwatch]::StartNew()
New-Item -ItemType Directory -Force "$projectRoot\logs" | Out-Null
$node='C:\Program Files\nodejs\node.exe'
$engine="$projectRoot\tools\godot\Godot_v4.7.2-stable_win64.exe"
if(!(Test-Path $node)){throw 'Node is missing. Install Node 22.6+ or update start.ps1.'}
if(!(Test-Path $engine)){throw 'Bundled Godot is missing. Run Setup Tools.ps1.'}
if(!(Test-Path "$projectRoot\service\node_modules\express")){throw 'Dependencies are missing. Run Setup Tools.ps1.'}
$runtimeFile="$projectRoot\logs\runtime.json"
$runtime=@{}
if(Test-Path $runtimeFile){$saved=Get-Content $runtimeFile -Raw | ConvertFrom-Json;foreach($prop in $saved.PSObject.Properties){$runtime[$prop.Name]=$prop.Value}}
# Check mode before starting any new helper, so a second shortcut cannot change a live game.
if($runtime.game){
  $recordedGame=Get-Process -Id $runtime.game.pid -ErrorAction SilentlyContinue
  if($recordedGame -and $recordedGame.StartTime.ToUniversalTime().Ticks -eq ([datetime]$runtime.game.started).ToUniversalTime().Ticks -and $recordedGame.Path -eq $runtime.game.path){
    if([bool]$runtime.game.directorMode -ne [bool]($DirectorMode -or $DirectorLocal) -or [bool]$runtime.game.directorLocal -ne [bool]$DirectorLocal -or [bool]$runtime.game.desktopMode -ne [bool]$Desktop -or [bool]$runtime.game.experimentalFuelCombat -ne [bool]$ExperimentalFuelCombat -or [bool]$runtime.game.fairyCoop -ne [bool]$FairyCoop){
      throw 'A different game mode is already running. Close its game window, then use the launcher again. The current session was left untouched.'
    }
  }
}
if(!$Desktop -and !$ServiceOnly){
  & (Join-Path $projectRoot 'scripts/Ensure-SteamVR.ps1') -TimeoutSeconds 90
}
try{$health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2}catch{$health=$null}
if($health -and $health.app -ne 'branns-forge-vr'){throw 'Port 8787 belongs to another app. It was left untouched.'}
if(!$health){
  if(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue){throw 'Port 8787 is occupied. It was left untouched.'}
  $stamp=Get-Date -Format yyyyMMdd-HHmmss
  $env:PATH='C:\Program Files\nodejs;'+$env:PATH
  $server=Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory "$projectRoot\service" -RedirectStandardOutput "$projectRoot\logs\service-$stamp.log" -RedirectStandardError "$projectRoot\logs\service-$stamp-errors.log" -WindowStyle Hidden -PassThru
  $runtime.service=@{pid=$server.Id;started=$server.StartTime.ToUniversalTime().ToString('o');path=$node}
  for($attempt=0;$attempt -lt 40;$attempt++){
    Start-Sleep -Milliseconds 200
    try{$health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 1;if($health.app -eq 'branns-forge-vr'){break}}catch{}
    if($server.HasExited){throw 'Forge service exited. Inspect logs/service-*-errors.log.'}
  }
  if(!$health){throw 'Forge service did not become ready. Inspect logs.'}
}
if($DirectorMode -and !$DirectorLocal){
  try{
    $null=Invoke-RestMethod 'http://127.0.0.1:8787/api/director/state' -TimeoutSec 2
    $null=Invoke-WebRequest 'http://127.0.0.1:8787/api/director/frame' -TimeoutSec 2
  }catch{throw 'The running forge service predates the live Director camera. Use Stop managed session in the launcher, then launch Director Mode again.'}
}
if(!$ServiceOnly){
  # OBS is optional; failure must not prevent playing. No recording starts here.
  if(Test-Path "$env:APPDATA\obs-studio\basic\profiles\BrannsForge\basic.ini"){
    try { & "$projectRoot\scripts\Start-OBS.ps1" } catch { Write-Warning "Recorder unavailable: $_" }
  }
  $audioEngine=Join-Path $projectRoot 'audio-host/node_modules/electron/dist/electron.exe'
  if(!(Test-Path $audioEngine)){throw 'Audio helper is missing. Run Setup Tools.ps1.'}
  $audioExisting=$null
  if($runtime.audio){
    $audioExisting=Get-Process -Id $runtime.audio.pid -ErrorAction SilentlyContinue
    if($audioExisting -and ($audioExisting.Path -ne $audioEngine -or $audioExisting.StartTime.ToUniversalTime().Ticks -ne ([datetime]$runtime.audio.started).ToUniversalTime().Ticks)){$audioExisting=$null}
  }
  if(!$audioExisting){
    $audio=Start-Process -FilePath $audioEngine -ArgumentList ('"'+(Join-Path $projectRoot 'audio-host')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    $runtime.audio=@{pid=$audio.Id;started=$audio.StartTime.ToUniversalTime().ToString('o');path=$audioEngine}
  }
  # Wait for the hidden renderer to register before starting the game.
  $audioReady=$false
  for($attempt=0;$attempt -lt 30;$attempt++){
    try{$state=Invoke-RestMethod 'http://127.0.0.1:8787/api/vr/state' -TimeoutSec 1;if($state.voiceClient.connected -and $state.voiceClient.managed){$audioReady=$true;break}}catch{}
    Start-Sleep -Milliseconds 200
  }
  if(!$audioReady){
    $runtime | ConvertTo-Json -Depth 5 | Set-Content $runtimeFile
    throw 'Audio helper did not connect. Inspect audio-host/logs; Stop managed session in the launcher can close the recorded processes.'
  }
  $existing=$null
  if($runtime.game){$existing=Get-Process -Id $runtime.game.pid -ErrorAction SilentlyContinue;if($existing -and $existing.StartTime.ToUniversalTime().Ticks -ne ([datetime]$runtime.game.started).ToUniversalTime().Ticks){$existing=$null}}
  if(!$existing){
    $mode=if($Desktop){'off'}else{'on'}
    $stamp=Get-Date -Format yyyyMMdd-HHmmss
    $args=@('--path',('"'+"$projectRoot\godot"+'"'),'--xr-mode',$mode,'--log-file',('"'+"$projectRoot\logs\game-$stamp.log"+'"'))
    $gameFlags=@()
    if($ExperimentalFuelCombat){$gameFlags+='--experimental-fuel-combat'}
    if($FairyCoop){$gameFlags+='--fairy-coop'}
    if($DirectorMode -or $DirectorLocal){$gameFlags+='--director-mode'}
    if($DirectorLocal){$gameFlags+='--director-window'}
    if($gameFlags.Count){$args+=@('--')+$gameFlags}
    $game=Start-Process -FilePath $engine -ArgumentList $args -WorkingDirectory "$projectRoot\godot" -PassThru
    $runtime.game=@{pid=$game.Id;started=$game.StartTime.ToUniversalTime().ToString('o');path=$engine;desktopMode=[bool]$Desktop;experimentalFuelCombat=[bool]$ExperimentalFuelCombat;fairyCoop=[bool]$FairyCoop;directorMode=[bool]($DirectorMode -or $DirectorLocal);directorLocal=[bool]$DirectorLocal}
  }elseif([bool]$ExperimentalFuelCombat -ne [bool]$runtime.game.experimentalFuelCombat){
    Write-Warning 'The game is already running with a different fuel mode. Close the game, then run this launcher again to change modes.'
  }
  if($existing -and $FairyCoop){Write-Output 'Game already running: press F8 in its desktop window, or use Toolbelt > Comfort > Fairy co-op window.'}
  if($existing -and $DirectorMode -and ![bool]$runtime.game.directorMode){throw 'A normal game is already running. Close its window, then launch Director Mode; its live world cannot be switched into a different mode.'}
  if($DirectorMode -and !$DirectorLocal){
    $directorUrl='http://127.0.0.1:8787/director/'
    $chromium=@('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if($chromium){
      # A dedicated local app window avoids tab/address-bar chrome and honors fullscreen even if the normal browser is already open.
      $directorProfile=Join-Path $projectRoot 'logs/director-browser-profile'
      Start-Process -FilePath $chromium -ArgumentList @("--user-data-dir=$directorProfile",'--no-first-run','--no-default-browser-check',"--app=$directorUrl",'--start-fullscreen') | Out-Null
    }else{Start-Process $directorUrl}
  }
}
$runtime | ConvertTo-Json -Depth 5 | Set-Content $runtimeFile
"launch,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content "$projectRoot\logs\work-timing.csv"
Write-Output 'Brann is ready. Audio is managed by the game; approach Brann and press trigger to talk. The launcher stays open for status and shutdown.'
