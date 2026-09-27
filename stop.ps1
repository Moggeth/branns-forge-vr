$ErrorActionPreference='Stop'
$runtimeFile=Join-Path $PSScriptRoot 'logs/runtime.json'
$timer=[Diagnostics.Stopwatch]::StartNew()
if(!(Test-Path $runtimeFile)){Write-Output 'No managed Brann processes recorded.';exit}
$runtime=Get-Content $runtimeFile -Raw | ConvertFrom-Json
try{
  $health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2
  if($health.app -eq 'branns-forge-vr' -and $runtime.service -and $health.pid -eq $runtime.service.pid){
    $config=Invoke-RestMethod 'http://127.0.0.1:8787/api/forge/config' -TimeoutSec 2
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/forge/shutdown' -Headers @{'x-forge-token'=$config.token} -ContentType 'application/json' -Body '{}' | Out-Null
    # Allow cancelled jobs to persist refunds and Live sessions to finalize.
    for($i=0;$i -lt 17;$i++){
      $config=Invoke-RestMethod 'http://127.0.0.1:8787/api/forge/config' -TimeoutSec 2
      if(!$config.activeJob -and $config.activeSessions -eq 0){break}
      Start-Sleep -Seconds 1
    }
  }
}catch{Write-Output 'Service unavailable for graceful shutdown; checking owned process records.'}
$unmatched=$false
foreach($entry in @($runtime.audio,$runtime.game,$runtime.service)){
  if(!$entry){continue}
  $process=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks -and $process.Path -eq $entry.path){Stop-Process -Id $process.Id;Write-Output "Stopped owned Brann process $($process.Id)."}
  elseif($process){$unmatched=$true;Write-Output "Process $($entry.pid) did not match its recorded identity; left untouched."}
}
if(!$unmatched){Remove-Item -LiteralPath $runtimeFile}
"stop,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $PSScriptRoot 'logs/work-timing.csv')
