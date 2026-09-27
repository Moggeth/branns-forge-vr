$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$godotRoot = Join-Path $projectRoot 'godot'
$engine = Join-Path $projectRoot 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$logRoot = Join-Path $projectRoot 'logs'
$timingFile = Join-Path $logRoot 'work-timing.csv'

if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw "Godot executable missing: $engine" }
foreach ($file in @('desktop_hero_look_checks.gd', 'desktop_hero_actions_checks.gd', 'desktop_hero_integration_checks.gd', 'guardian_checks.gd', 'expedition_checks.gd')) {
    if (-not (Test-Path -LiteralPath (Join-Path $godotRoot $file) -PathType Leaf)) { throw "Check missing: $file" }
}
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$checks = @(
    @{ Name = 'look'; Script = 'res://desktop_hero_look_checks.gd'; Marker = 'DESKTOP_HERO_LOOK_CHECK_RESULT []'; Frames = 600 },
    @{ Name = 'actions'; Script = 'res://desktop_hero_actions_checks.gd'; Marker = 'DESKTOP_HERO_ACTIONS_CHECKS'; Frames = 600 },
    @{ Name = 'hero-integration'; Flag = '--desktop-hero-check'; Marker = 'DESKTOP_HERO_INTEGRATION_RESULT []'; Frames = 1800 },
    @{ Name = 'guardian'; Flag = '--guardian-check'; Marker = 'GUARDIAN_RESULT []'; Frames = 1800 },
    @{ Name = 'expedition-smoke'; Flag = '--expedition-check'; Marker = 'EXPEDITION_RESULT []'; Frames = 1800 }
)
$runStarted = [Diagnostics.Stopwatch]::StartNew()
$passed = 0
foreach ($check in $checks) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $log = Join-Path $logRoot ('desktop-hero-' + $check.Name + '.log')
    $info = [Diagnostics.ProcessStartInfo]::new($engine)
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in @('--headless', '--xr-mode', 'off', '--audio-driver', 'Dummy', '--path', $godotRoot, '--quit-after', [string]$check.Frames)) {
        [void]$info.ArgumentList.Add($arg)
    }
    if ($check.Script) {
        [void]$info.ArgumentList.Add('--script')
        [void]$info.ArgumentList.Add($check.Script)
    } else {
        [void]$info.ArgumentList.Add('--')
        [void]$info.ArgumentList.Add($check.Flag)
    }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $timedOut = $false
    try {
        if (-not $process.Start()) { throw 'Godot did not start' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) {
            $timedOut = $true
            $process.Kill($true) # Only this check's process tree; never the running game.
            $process.WaitForExit()
        }
        $output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText($log, $output)
        $passedCheck = -not $timedOut -and $process.ExitCode -eq 0 -and
            $output.Contains($check.Marker) -and $output -notmatch 'SCRIPT ERROR:|ERROR:|failures=[1-9]'
        $outcome = if ($passedCheck) { 'passed' } else { 'failed' }
        ('desktop-hero-' + $check.Name + ',' + $outcome + ',' + $timer.Elapsed.TotalSeconds.ToString('F3', [Globalization.CultureInfo]::InvariantCulture)) | Add-Content -LiteralPath $timingFile
        if (-not $passedCheck) {
            $reason = if ($timedOut) { 'timed out after 90 seconds' } else { "exit=$($process.ExitCode), expected '$($check.Marker)'" }
            throw "$($check.Name) failed ($reason). See $log"
        }
        $passed++
        Write-Output ("PASS {0} ({1:N2}s)" -f $check.Name, $timer.Elapsed.TotalSeconds)
    } finally {
        $process.Dispose()
    }
}
Write-Output ("PASS desktop Hero regression: {0}/{1} checks ({2:N2}s); logs: {3}" -f $passed, $checks.Count, $runStarted.Elapsed.TotalSeconds, $logRoot)
