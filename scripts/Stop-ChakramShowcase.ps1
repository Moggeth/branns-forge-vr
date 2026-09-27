$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$statePath=Join-Path $root 'work/chakram/showcase-processes.json'
if(!(Test-Path $statePath)){Write-Output 'Showcase already stopped.';exit}
$state=Get-Content $statePath -Raw | ConvertFrom-Json
foreach($entry in @(@{id=$state.serverId;started=$state.serverStarted},@{id=$state.tunnelId;started=$state.tunnelStarted})){
 $process=Get-Process -Id $entry.id -ErrorAction SilentlyContinue
 if($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.started){Stop-Process -Id $entry.id}
}
Remove-Item -LiteralPath $statePath
Write-Output 'Only the chakram showcase and its tunnel were stopped.'
