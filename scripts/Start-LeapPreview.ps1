param([switch]$Stop)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$entry=Join-Path $project 'multiplayer/leap-preview.mjs'
$state=Join-Path $project 'logs/leap-preview-process.json'
New-Item -ItemType Directory -Force (Join-Path $project 'logs') | Out-Null
if(Test-Path -LiteralPath $state){
  $saved=Get-Content -Raw -LiteralPath $state | ConvertFrom-Json
  $running=Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)"
  $owned=$running -and $running.CommandLine.Replace('\','/').Contains($entry.Replace('\','/')) -and ([string]$running.CreationDate.ToUniversalTime().Ticks -eq $saved.startedTicks)
  if($owned){
    if(!$Stop){Write-Output 'Already running: http://127.0.0.1:5194/?leap';exit 0}
    $reader=Join-Path $project 'scripts/leap_frames.py'
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($saved.pid)" | Where-Object {$_.Name -match '^python' -and $_.CommandLine -and $_.CommandLine.Replace('\','/').Contains($reader.Replace('\','/'))} | ForEach-Object {Stop-Process -Id $_.ProcessId}
    Stop-Process -Id $saved.pid
    Wait-Process -Id $saved.pid -Timeout 5 -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $state
}
if($Stop){Write-Output 'Owned Leap preview stopped.';exit 0}
$process=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('"'+$entry+'"') -WorkingDirectory (Join-Path $project 'multiplayer') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $project 'logs/leap-preview.stdout.log') -RedirectStandardError (Join-Path $project 'logs/leap-preview.stderr.log') -PassThru
$identity=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
if(!$identity){throw 'Preview exited during startup. Check logs/leap-preview.stderr.log; port 5194 may already be in use.'}
@{pid=$process.Id;startedTicks=[string]$identity.CreationDate.ToUniversalTime().Ticks} | ConvertTo-Json | Set-Content -LiteralPath $state
Start-Sleep -Milliseconds 700
if($process.HasExited){throw 'Preview failed to start. Check logs/leap-preview.stderr.log; port 5194 may already be in use.'}
Write-Output 'Open http://127.0.0.1:5194/?leap — choose God, Play solo, then Hands: off to enable.'
