param(
  [Parameter(Mandatory = $true)][string]$CommissionDir,
  [ValidateRange(1, 80)][int]$MaxTurns = 24,
  [ValidateSet('low', 'medium', 'high')][string]$Effort = 'low'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$commission = [IO.Path]::GetFullPath((Join-Path $repo $CommissionDir))
$workRoot = [IO.Path]::GetFullPath((Join-Path $repo 'work')) + [IO.Path]::DirectorySeparatorChar
if (!$commission.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Commission must be inside this project work/ folder.'
}
$brief = Join-Path $commission 'BRIEF.md'
if (!(Test-Path -LiteralPath $brief)) { throw "Missing brief: $brief" }
$output = Join-Path $commission 'commission.jsonl'
$timer = [Diagnostics.Stopwatch]::StartNew()
$name = Split-Path $commission -Leaf
$outcome = 'failed'

# These removals affect only this PowerShell child and the Claude CLI it starts.
Get-ChildItem Env: | Where-Object {
  $_.Name -like 'ANTHROPIC_*' -or $_.Name -like 'CLAUDE_CODE_USE_*' -or $_.Name -eq 'CLAUDE_CODE_OAUTH_TOKEN'
} | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$auth = (& claude auth status | ConvertFrom-Json)
if (!$auth.loggedIn -or $auth.authMethod -ne 'claude.ai' -or $auth.email -ne 'fauxgrady@gmail.com' -or $auth.subscriptionType -ne 'pro' -or $auth.apiKeySource -notin @($null, '', 'none')) {
  throw 'Personal Claude.ai Pro subscription identity not verified. No generation submitted.'
}

Push-Location $commission
try {
  Get-Content -LiteralPath $brief -Raw | & claude --print --model 'claude-sonnet-5-5' --effort $Effort --permission-mode acceptEdits --allowedTools 'Read,Write,Edit,Glob,Grep,Bash,PowerShell' --strict-mcp-config --output-format stream-json --verbose --max-turns $MaxTurns *> $output
  $exit = $LASTEXITCODE
  $events = @(Get-Content -LiteralPath $output | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -ne $null })
  $init = $events | Where-Object { $_.type -eq 'system' -and $_.subtype -eq 'init' } | Select-Object -First 1
  $final = $events | Where-Object { $_.type -eq 'result' } | Select-Object -Last 1
  $model = if ($init) { [string]$init.model } else { '' }
  $verified = $model -eq 'claude-sonnet-5-5' -and $final -and !$final.is_error -and $final.modelUsage.'claude-sonnet-5-5'.canonicalModel -eq 'claude-sonnet-5-5'
  if ($exit -ne 0 -or !$verified) {
    $reason = if ($final) { [string]$final.result } else { 'No final session result' }
    throw "Sonnet commission did not complete with verified model (exit=$exit model=$model): $reason"
  }
  $outcome = 'passed'
  Write-Output "SONNET_COMMISSION_OK name=$name model=$model seconds=$([math]::Round($timer.Elapsed.TotalSeconds, 3))"
} finally {
  Pop-Location
  "sonnet-commission-$name,$outcome,$([math]::Round($timer.Elapsed.TotalSeconds, 3))" | Add-Content -LiteralPath (Join-Path $repo 'logs/work-timing.csv')
}
