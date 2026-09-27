[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$engine=Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64.exe'
New-Item -ItemType Directory -Force (Join-Path $projectRoot 'logs') | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$arguments=@('--xr-mode','off','--path',('"'+(Join-Path $projectRoot 'godot')+'"'),'--script','visual_demo.gd','--log-file',('"'+(Join-Path $projectRoot "logs/weather-lab-$stamp.log")+'"'),'--','--weather-lab')
$demoProcess=Start-Process -FilePath $engine -ArgumentList $arguments -WorkingDirectory $projectRoot -PassThru
[pscustomobject]@{pid=$demoProcess.Id;started=$demoProcess.StartTime.ToString('o');executable=$engine;log="logs/weather-lab-$stamp.log"} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $projectRoot 'logs/weather-lab-session.json')
Write-Output "Weather Lab opened. Close its window or press Escape to exit."
