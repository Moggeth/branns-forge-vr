$ErrorActionPreference='Stop'
$timer=[Diagnostics.Stopwatch]::StartNew()
$projectRoot=$PSScriptRoot
New-Item -ItemType Directory -Force "$projectRoot\work","$projectRoot\tools","$projectRoot\logs" | Out-Null
if(!(Test-Path "$projectRoot\tools\godot\Godot_v4.7.2-stable_win64.exe")){
  Invoke-WebRequest 'https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_win64.exe.zip' -OutFile "$projectRoot\work\godot.zip"
  Expand-Archive -LiteralPath "$projectRoot\work\godot.zip" -DestinationPath "$projectRoot\tools\godot" -Force
}
$env:PATH='C:\Program Files\nodejs;'+$env:PATH
& 'C:\Program Files\nodejs\npm.cmd' ci --prefix "$projectRoot\service" --no-audit --no-fund
if($LASTEXITCODE -ne 0){throw 'Dependency setup failed.'}
& 'C:\Program Files\nodejs\npm.cmd' ci --prefix "$projectRoot\audio-host" --no-audit --no-fund
if($LASTEXITCODE -ne 0){throw 'Audio helper dependency setup failed.'}
& 'C:\Program Files\nodejs\node.exe' "$projectRoot\audio-host\node_modules\electron\install.js"
if($LASTEXITCODE -ne 0){throw 'Audio helper runtime download failed.'}
"setup,completed,$($timer.Elapsed.TotalSeconds)" | Add-Content "$projectRoot\logs\work-timing.csv"
