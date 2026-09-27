[CmdletBinding()]
param([switch]$VR)
$ErrorActionPreference='Stop'
$step=[Diagnostics.Stopwatch]::StartNew()
$config=$null
try{$config=Invoke-RestMethod 'http://127.0.0.1:8787/api/forge/config' -TimeoutSec 2}catch{}
if($config -and ($config.activeJob -or $config.activeSessions -gt 0)){throw 'Finish the active Brann conversation or crafting job before opening the animation lab.'}
if($VR){ & (Join-Path $PSScriptRoot 'scripts/Ensure-SteamVR.ps1') -TimeoutSeconds 90 }
if(Test-Path (Join-Path $PSScriptRoot 'logs/runtime.json')){ & (Join-Path $PSScriptRoot 'stop.ps1') }
$engine=Join-Path $PSScriptRoot 'tools/godot/Godot_v4.7.2-stable_win64.exe'
$mode=if($VR){'on'}else{'off'}
$stamp=Get-Date -Format yyyyMMdd-HHmmss
$arguments=@('--path',('"'+(Join-Path $PSScriptRoot 'godot')+'"'),'--xr-mode',$mode,'--log-file',('"'+(Join-Path $PSScriptRoot "logs/animation-lab-$stamp.log")+'"'),'--','--animation-lab')
$process=Start-Process -FilePath $engine -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
@{game=@{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o');path=$engine}} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $PSScriptRoot 'logs/runtime.json')
"animation-lab-launch,completed,$($step.Elapsed.TotalSeconds)" | Add-Content (Join-Path $PSScriptRoot 'logs/work-timing.csv')
Write-Output 'Animation lab running offline. Use Stop managed session in the launcher to close it, then launch the adventure there.'
