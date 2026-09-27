$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$timer=[Diagnostics.Stopwatch]::StartNew()
$statePath=Join-Path $root 'work/chakram/showcase-processes.json'
if(Test-Path $statePath){
 $old=Get-Content $statePath -Raw | ConvertFrom-Json
 $serverOld=Get-Process -Id $old.serverId -ErrorAction SilentlyContinue
 $tunnelOld=Get-Process -Id $old.tunnelId -ErrorAction SilentlyContinue
 if($serverOld -and $tunnelOld -and $serverOld.StartTime.ToUniversalTime().ToString('o') -eq $old.serverStarted -and $tunnelOld.StartTime.ToUniversalTime().ToString('o') -eq $old.tunnelStarted){Write-Output $old.url;exit}
 throw 'A previous showcase process may remain. Run Stop-ChakramShowcase.ps1 before starting again.'
}
$server=Start-Process -FilePath 'C:/Program Files/nodejs/node.exe' -ArgumentList @((Join-Path $root 'scripts/chakram-server.cjs')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'logs/chakram-server.log') -RedirectStandardError (Join-Path $root 'logs/chakram-server-error.log')
$tunnel=Start-Process -FilePath (Join-Path $root 'tools/cloudflared.exe') -ArgumentList @('tunnel','--url','http://127.0.0.1:8846','--no-autoupdate') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'logs/chakram-tunnel-out.log') -RedirectStandardError (Join-Path $root 'logs/chakram-tunnel.log')
$state=@{serverId=$server.Id;serverStarted=$server.StartTime.ToUniversalTime().ToString('o');tunnelId=$tunnel.Id;tunnelStarted=$tunnel.StartTime.ToUniversalTime().ToString('o');url=''}
$state | ConvertTo-Json | Set-Content $statePath -Encoding utf8
for($attempt=0;$attempt -lt 35;$attempt++){
 Start-Sleep -Milliseconds 500
 $log=Get-Content (Join-Path $root 'logs/chakram-tunnel.log') -Raw -ErrorAction SilentlyContinue
 if($log -match 'https://[a-z0-9-]+\.trycloudflare\.com'){$state.url=$Matches[0];break}
}
$state | ConvertTo-Json | Set-Content $statePath -Encoding utf8
"chakram-showcase-start,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $root 'logs/work-timing.csv')
if(!$state.url){throw 'Tunnel URL not ready. Inspect logs/chakram-tunnel.log; process IDs retained for safe shutdown.'}
Write-Output $state.url
