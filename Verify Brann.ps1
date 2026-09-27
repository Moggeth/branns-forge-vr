[CmdletBinding()]
param([switch]$Capture,[string]$CaptureDirectory)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$node='C:\Program Files\nodejs\node.exe'
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$verificationTimer=[Diagnostics.Stopwatch]::StartNew()
New-Item -ItemType Directory -Force "$projectRoot\logs" | Out-Null
function Invoke-BrannCheck {
  param([string]$Name,[string]$Executable,[string[]]$Arguments)
  $stepTimer=[Diagnostics.Stopwatch]::StartNew()
  $log=Join-Path $projectRoot ("logs/verify-"+$Name+'.log')
  $result='failed'
  try {
    & $Executable @Arguments 2>&1 | Tee-Object -FilePath $log
    if($LASTEXITCODE -ne 0){throw "$Name failed with exit $LASTEXITCODE. Inspect $log"}
    if((Get-Content $log -Raw) -match '(?m)^(SCRIPT ERROR:|ERROR:)' ){throw "$Name reported a native/script error. Inspect $log"}
    $result='passed'
  } finally {
    "verify-$Name,$result,$($stepTimer.Elapsed.TotalSeconds)" | Add-Content "$projectRoot\logs\work-timing.csv"
  }
}
Push-Location $projectRoot
try {
  $tests=@(Get-ChildItem service -File -Filter '*test.cjs' | Select-Object -ExpandProperty FullName)
  if($tests.Count -eq 0){throw 'No service tests found.'}
  Invoke-BrannCheck -Name 'service' -Executable $node -Arguments (@('--test')+$tests)
  Invoke-BrannCheck -Name 'audio-policy' -Executable $node -Arguments @('--test','audio-host/policy-test.cjs')
  Invoke-BrannCheck -Name 'audio-host' -Executable $node -Arguments @('audio-host/check.cjs')
  Invoke-BrannCheck -Name 'parse' -Executable $engine -Arguments @('--headless','--xr-mode','off','--path',"$projectRoot\godot",'--script','main.gd','--check-only')
  Invoke-BrannCheck -Name 'weather-game' -Executable $engine -Arguments @('--headless','--xr-mode','off','--path',"$projectRoot\godot",'--quit-after','4000','--','--weather-game-check')
  if((Get-Content "$projectRoot\logs\verify-weather-game.log" -Raw) -notmatch 'WEATHER_GAME_CHECK_RESULT \[\]'){throw 'Weather game checks did not complete.'}
  Invoke-BrannCheck -Name 'firecraft' -Executable $engine -Arguments @('--headless','--xr-mode','off','--path',"$projectRoot\godot",'--quit-after','300','--','--fire-check')
  if((Get-Content "$projectRoot\logs\verify-firecraft.log" -Raw) -notmatch 'FIRE_CHECK PASS'){throw 'Firecraft checks did not complete.'}
  Invoke-BrannCheck -Name 'living' -Executable $engine -Arguments @('--headless','--xr-mode','off','--path',"$projectRoot\godot",'--quit-after','900','--','--living-check')
  if((Get-Content "$projectRoot\logs\verify-living.log" -Raw) -notmatch 'LIVING_CHECK PASS'){throw 'Living workshop checks did not complete.'}
  Invoke-BrannCheck -Name 'living-network' -Executable $node -Arguments @('scripts/check-living-network.cjs')
  Invoke-BrannCheck -Name 'quests-network' -Executable $node -Arguments @('scripts/check-quests.cjs')
  Invoke-BrannCheck -Name 'integration' -Executable $node -Arguments @('service/integration.cjs')
  & (Join-Path $projectRoot 'scripts/check-playful.ps1')
  & (Join-Path $projectRoot 'scripts/check-demo.ps1')
  Invoke-BrannCheck -Name 'festival-walkthrough' -Executable $node -Arguments @('scripts/check-festival.cjs')
  Invoke-BrannCheck -Name 'arcade-walkthrough' -Executable $node -Arguments @('scripts/check-arcade.cjs')
  if($Capture){
    if(!$CaptureDirectory){$CaptureDirectory=Join-Path $projectRoot 'work/adventure-previews'}
    New-Item -ItemType Directory -Force $CaptureDirectory | Out-Null
    $CaptureDirectory=[IO.Path]::GetFullPath($CaptureDirectory)
    foreach($zone in @('forge_yard','sandstone_quarry','enchanted_kitchen','pinewood_ruins','mushroom_glade','crystal_hollow','sky_garden','ember_foundry')){
      $target=Join-Path $CaptureDirectory ($zone+'.png')
      Invoke-BrannCheck -Name ('capture-'+$zone) -Executable $engine -Arguments @('--xr-mode','off','--path',"$projectRoot\godot",'--',('--capture='+$target),('--capture-zone='+$zone),'--service=http://127.0.0.1:8799')
      if(!(Test-Path $target)){throw "Capture missing for $zone"}
    }
  }
  Write-Output "Verification completed in $($verificationTimer.Elapsed.TotalSeconds) seconds. See logs/verify-*.log."
}finally{Pop-Location}
