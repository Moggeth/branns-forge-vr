[CmdletBinding(DefaultParameterSetName='Read')]
param(
  [Parameter(Mandatory,ParameterSetName='Set')][string]$Key,
  [Parameter(Mandatory,ParameterSetName='Set')][double]$Value,
  [Parameter(Mandatory,ParameterSetName='Preset')][ValidateSet('default','gentle','punchy')][string]$Preset,
  [Parameter(Mandatory,ParameterSetName='Undo')][switch]$Undo,
  [Parameter(Mandatory,ParameterSetName='Reset')][switch]$Reset,
  [string]$Service='http://127.0.0.1:8787'
)
$ErrorActionPreference='Stop'
$watch=[Diagnostics.Stopwatch]::StartNew()
$outcome='failed'
try {
  $snapshot=Invoke-RestMethod ($Service+'/api/vr/tuning') -TimeoutSec 5
  $body=@{expectedRevision=$snapshot.revision}
  switch($PSCmdlet.ParameterSetName) {
    'Set' { $body.values=@{$Key=$Value} }
    'Preset' { $body.preset=$Preset }
    'Undo' { $body.action='undo' }
    'Reset' { $body.action='reset' }
  }
  if($PSCmdlet.ParameterSetName -ne 'Read') {
    $snapshot=Invoke-RestMethod ($Service+'/api/vr/tuning') -Method Post -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 5) -TimeoutSec 5
  }
  $outcome='passed'
  $snapshot | ConvertTo-Json -Depth 8
} finally {
  New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'logs') | Out-Null
  "tune-$($PSCmdlet.ParameterSetName),$outcome,$($watch.Elapsed.TotalSeconds)" | Add-Content (Join-Path $PSScriptRoot 'logs/work-timing.csv')
}
