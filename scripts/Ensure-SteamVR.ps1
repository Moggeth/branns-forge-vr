[CmdletBinding()]
param([int]$TimeoutSeconds = 90, [switch]$ProbeOnly)

$ErrorActionPreference = 'Stop'
$started = [Diagnostics.Stopwatch]::StartNew()
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'logs/steamvr-startup.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log -Parent) | Out-Null

function Write-StartupEvent([string]$message) {
  ('{0:o} {1}' -f (Get-Date),$message) | Add-Content -LiteralPath $log
  Write-Output $message
}

function Test-SteamVRProcesses {
  $server = Get-Process vrserver -ErrorAction SilentlyContinue
  $compositor = Get-Process vrcompositor -ErrorAction SilentlyContinue
  return [bool]($server -and $compositor)
}

function Find-SteamVRStartup {
  $roots = @()
  try {
    $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
    if ($steam) { $roots += $steam }
  } catch {}
  $roots += @('C:\Program Files (x86)\Steam','C:\Program Files\Steam')
  foreach ($base in ($roots | Select-Object -Unique)) {
    foreach ($name in @('vrstartup.exe','vrmonitor.exe')) {
      $candidate = Join-Path $base "steamapps/common/SteamVR/bin/win64/$name"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
  }
  return $null
}

try {
  if ($ProbeOnly) {
    $path = Find-SteamVRStartup
    Write-StartupEvent ('STEAMVR_PROBE processes={0} startup={1}' -f (Test-SteamVRProcesses),$path)
    return
  }
  if (!(Test-SteamVRProcesses)) {
    $path = Find-SteamVRStartup
    if (!$path) { throw 'SteamVR is not installed in a known Steam location. Open SteamVR once from Steam, then retry.' }
    Write-StartupEvent "STEAMVR_START path=$path"
    Start-Process -FilePath $path -WorkingDirectory (Split-Path $path -Parent) -WindowStyle Hidden | Out-Null
  }
  # A compositor process can appear before the OpenVR runtime is usable.
  # Require a few consecutive healthy samples before Godot initializes XR.
  $healthy = 0
  while ($started.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-SteamVRProcesses) { $healthy++ } else { $healthy = 0 }
    # Vive Console/link-box discovery can lag process creation. Let the
    # compositor remain healthy for six seconds before Godot initializes XR.
    if ($healthy -ge 9) {
      Write-StartupEvent ('STEAMVR_READY seconds={0:N1}' -f $started.Elapsed.TotalSeconds)
      return
    }
    Start-Sleep -Milliseconds 750
  }
  throw ('SteamVR did not become ready within {0} seconds. Check Vive Console and the headset display/link box, then use Open logs in the launcher.' -f $TimeoutSeconds)
} catch {
  Write-StartupEvent ('STEAMVR_FAILED seconds={0:N1} reason={1}' -f $started.Elapsed.TotalSeconds,$_.Exception.Message)
  throw
}
