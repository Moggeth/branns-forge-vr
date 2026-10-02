param([Parameter(Mandatory=$true)][string]$PeerUrl, [switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$timer = [Diagnostics.Stopwatch]::StartNew()
$uri = [Uri]$PeerUrl
if ($uri.Scheme -ne 'wss' -or $uri.AbsolutePath -ne '/peer/ws') { throw 'Expected wss://host/peer/ws' }
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  $env:VITE_PEER_WS_URL = $PeerUrl
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  $stage = Join-Path ([IO.Path]::GetTempPath()) "branns-forge-peer-preview-$([Guid]::NewGuid().ToString('N'))"
  $static = Join-Path $stage '.vercel/output/static'
  New-Item -ItemType Directory -Force -Path $static | Out-Null
  Copy-Item -LiteralPath '.vercel/project.json' -Destination "$stage/.vercel/project.json"
  Copy-Item -LiteralPath 'dist/index.html' -Destination "$static/index.html"
  Copy-Item -LiteralPath 'dist/manifest.webmanifest' -Destination "$static/manifest.webmanifest"
  # Vite public assets may contain nested sound/material families. Preserve their URL paths.
  Copy-Item -LiteralPath 'dist/assets' -Destination "$static/assets" -Recurse
  $builtAssets = (Resolve-Path 'dist/assets').Path
  foreach ($asset in Get-ChildItem -LiteralPath $builtAssets -File -Recurse) {
    $relative = $asset.FullName.Substring($builtAssets.Length + 1)
    $shipped = Join-Path "$static/assets" $relative
    if (!(Test-Path -LiteralPath $shipped) -or (Get-FileHash -LiteralPath $asset.FullName).Hash -ne (Get-FileHash -LiteralPath $shipped).Hash) { throw "Staged asset mismatch: $relative" }
  }
  '{"version":3,"routes":[{"src":"/.*","headers":{"Permissions-Policy":"xr-spatial-tracking=(self)","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"},"continue":true},{"handle":"filesystem"}]}' | Set-Content -Encoding utf8 -LiteralPath "$stage/.vercel/output/config.json"
  if ($StageOnly) { Write-Host "Verified deployment stage: $stage"; return }
  npx --yes vercel@62.1.0 deploy --prebuilt --prod --yes --scope moggeths-projects --cwd $stage
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed' }
} finally {
  Pop-Location
  Write-Host "Peer preview build/deploy elapsed seconds: $($timer.Elapsed.TotalSeconds)"
}
