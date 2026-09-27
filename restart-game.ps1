[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$timer=[Diagnostics.Stopwatch]::StartNew()
$runtimeFile=Join-Path $PSScriptRoot 'logs/runtime.json'
# Reload native visuals without cancelling a running forge build or its materials.
$state=Invoke-RestMethod 'http://127.0.0.1:8787/api/forge/config' -TimeoutSec 3
if($state.activeSessions -gt 0){throw 'Brann is in a conversation. Finish talking before reloading the game.'}
$runtime=Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
if($runtime.game){
  $process=Get-Process -Id $runtime.game.pid -ErrorAction SilentlyContinue
  if($process){
    if($process.Path -ne $runtime.game.path -or $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$runtime.game.started).ToUniversalTime().Ticks){throw 'Game process identity changed. No process was stopped.'}
    Stop-Process -Id $process.Id
    $process.WaitForExit(5000) | Out-Null
  }
}
& (Join-Path $PSScriptRoot 'start.ps1')
"reload-game,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content (Join-Path $PSScriptRoot 'logs/work-timing.csv')
