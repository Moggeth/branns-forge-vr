[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$timer=[Diagnostics.Stopwatch]::StartNew()
$root=$PSScriptRoot
New-Item -ItemType Directory -Force "$root\logs" | Out-Null
$runtimePath=(Get-ItemProperty 'HKLM:\SOFTWARE\Khronos\OpenXR\1' -ErrorAction SilentlyContinue).ActiveRuntime
$report=[ordered]@{
  at=(Get-Date).ToString('o')
  project=$root
  enginePresent=(Test-Path "$root\tools\godot\Godot_v4.7.2-stable_win64.exe")
  nodePresent=(Test-Path 'C:\Program Files\nodejs\node.exe')
  openxrRuntime=$runtimePath
  openxrManifestPresent=([bool]$runtimePath -and (Test-Path $runtimePath))
  steamVrProcesses=@(Get-Process vrserver,vrcompositor,vrmonitor -ErrorAction SilentlyContinue | Select-Object ProcessName,Id)
  graphics=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion)
  service=$null
  managedProcesses=@()
}
try {$health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2;$report.service=$health}catch{$report.service=@{available=$false;message='Loopback service is not responding.'}}
if(Test-Path "$root\logs\runtime.json"){
  $saved=Get-Content "$root\logs\runtime.json" -Raw | ConvertFrom-Json
  foreach($entry in @($saved.service,$saved.game)){
    if(!$entry){continue}
    $proc=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    $match=$proc -and $proc.Path -eq $entry.path -and $proc.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks
    $report.managedProcesses+=@{pid=$entry.pid;running=[bool]$proc;identityMatches=[bool]$match}
  }
}
$report.elapsedSeconds=$timer.Elapsed.TotalSeconds
$json=$report | ConvertTo-Json -Depth 7
$json | Set-Content "$root\logs\diagnostics-latest.json"
Write-Output $json
"diagnostics,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content "$root\logs\work-timing.csv"
