[CmdletBinding()]
param([switch]$Validate,[switch]$SmokeTest,[switch]$SmokeLaunchDesktop)

$ErrorActionPreference = 'Stop'
$script:root = Split-Path $PSScriptRoot -Parent
$script:logs = Join-Path $script:root 'logs'
$script:engine = Join-Path $script:root 'tools/godot/Godot_v4.7.2-stable_win64.exe'
$script:powerShell = Join-Path $PSHOME 'powershell.exe'
$script:task = $null
$script:taskOut = ''
$script:taskErr = ''
$script:taskLabel = ''

# These are deliberately explicit. Nothing typed into the UI becomes a shell command.
$script:experimentCatalog = @(
  [pscustomobject]@{id='animation'; title='Animation Lab'; summary='Inspect characters and motion in an offline desktop stage.'; detail='A separate testing stage. Opening it safely stops a managed Brann game first; any active conversation or commission must finish.'; kind='script'; file='Start Animation Lab.ps1'; arguments=@(); vr=$false},
  [pscustomobject]@{id='animation-vr'; title='Animation Lab - VR'; summary='Inspect animation at headset scale.'; detail='Needs a ready SteamVR headset. This stage is offline and safely replaces the managed game after active forge work is finished.'; kind='script'; file='Start Animation Lab.ps1'; arguments=@('-VR'); vr=$true},
  [pscustomobject]@{id='visual'; title='Visual Lab'; summary='Compare workshop lighting and visual styles on desktop.'; detail='A separate scene with no inventory, voice, or saved player progress. Close its window to leave.'; kind='script'; file='Visual Lab.ps1'; arguments=@(); vr=$false},
  [pscustomobject]@{id='weather'; title='Weather Lab'; summary='Try day, night, snow, rain, and spreading fire on desktop.'; detail='A separate playground. It does not change the main adventure or your saves.'; kind='script'; file='Weather Lab.ps1'; arguments=@(); vr=$false},
  [pscustomobject]@{id='bellworks'; title='Bellworks'; summary='Practice Sunskipper and the bells in an offline desktop demo.'; detail='A quick isolated demo. Progress resets when you close it.'; kind='godot'; file=''; arguments=@('--playful-demo'); vr=$false},
  [pscustomobject]@{id='bellworks-persistent'; title='Bellworks - Persistent'; summary='Play the Bellworks demo with its own saved progress.'; detail='This isolated demo remembers its challenges without modifying the main adventure save.'; kind='godot'; file=''; arguments=@('--playful-demo','--demo-persistent'); vr=$false},
  [pscustomobject]@{id='ember-desktop'; title='Ember Gallery - Desktop'; summary='Play the exported fire-and-Bellworks gallery on the monitor.'; detail='An older self-contained build; new source changes do not automatically appear here.'; kind='export'; file='outputs/ember-gallery-build/EmberGallery.exe'; arguments=@('--xr-mode','off'); vr=$false},
  [pscustomobject]@{id='ember-vr'; title='Ember Gallery - VR'; summary='Play the exported gallery through SteamVR.'; detail='Needs a ready headset. This is an older self-contained build, separate from the current adventure.'; kind='export'; file='outputs/ember-gallery-build/EmberGallery.exe'; arguments=@('--xr-mode','on'); vr=$true}
)

function Assert-LauncherConfiguration {
  $ids = @{}
  foreach ($item in $script:experimentCatalog) {
    if ($ids.ContainsKey($item.id)) { throw "Duplicate experiment id: $($item.id)" }
    $ids[$item.id] = $true
    if ($item.kind -notin @('script','godot','export')) { throw "Unknown experiment kind: $($item.kind)" }
    if ($item.kind -eq 'script' -and !(Test-Path -LiteralPath (Join-Path $script:root $item.file))) { throw "Missing script: $($item.file)" }
    if ($item.kind -eq 'export' -and !(Test-Path -LiteralPath (Join-Path $script:root $item.file))) { throw "Missing export: $($item.file)" }
  }
  foreach ($file in @('start.ps1','stop.ps1')) {
    if (!(Test-Path -LiteralPath (Join-Path $script:root $file))) { throw "Missing launcher backend: $file" }
  }
  if (!(Test-Path -LiteralPath $script:engine)) { throw 'Bundled Godot executable is missing.' }
}

Assert-LauncherConfiguration
if ($Validate) {
  Write-Output "PASS launcher configuration: $($script:experimentCatalog.Count) experiments, managed game and stop actions"
  exit 0
}
$created = $false
$script:launcherMutex = [Threading.Mutex]::new($true, 'Local\BrannsForgeLauncher', [ref]$created)
if (!$created) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BrannLauncherFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }'
  $open = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "Brann's Forge - Launcher" } | Select-Object -First 1
  if ($open) {
    [void][BrannLauncherFocus]::ShowWindow($open.MainWindowHandle, 9)
    [void][BrannLauncherFocus]::SetForegroundWindow($open.MainWindowHandle)
  }
  $script:launcherMutex.Dispose()
  exit 0
}
New-Item -ItemType Directory -Force -Path $script:logs | Out-Null
("{0:o} opened launcher pid={1} experiments={2}" -f (Get-Date),$PID,$script:experimentCatalog.Count) | Add-Content (Join-Path $script:logs 'launcher-events.log')

Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Brann's Forge - Launcher" Width="950" Height="710" MinWidth="740" MinHeight="600" WindowStartupLocation="CenterScreen" Background="#141C20" Foreground="#EEE7D9" FontFamily="Segoe UI" FontSize="15">
 <Window.Resources>
  <Style TargetType="Button">
   <Setter Property="Background" Value="#B77733"/><Setter Property="Foreground" Value="#FFF9E9"/><Setter Property="BorderBrush" Value="#D7A15A"/><Setter Property="BorderThickness" Value="1"/><Setter Property="Padding" Value="16,10"/><Setter Property="Margin" Value="0,0,10,0"/><Setter Property="Cursor" Value="Hand"/><Setter Property="FontWeight" Value="SemiBold"/>
   <Style.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter Property="Background" Value="#D18B3B"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger></Style.Triggers>
  </Style>
  <Style TargetType="TextBlock"><Setter Property="TextWrapping" Value="Wrap"/></Style>
  <Style TargetType="RadioButton"><Setter Property="Margin" Value="0,6,24,8"/><Setter Property="Cursor" Value="Hand"/><Setter Property="Foreground" Value="#EEE7D9"/></Style>
  <Style TargetType="CheckBox"><Setter Property="Margin" Value="0,8,0,3"/><Setter Property="Cursor" Value="Hand"/><Setter Property="Foreground" Value="#EEE7D9"/></Style>
  <Style TargetType="TabItem"><Setter Property="Background" Value="#344342"/><Setter Property="Foreground" Value="#EEE7D9"/><Setter Property="Padding" Value="12,6"/><Style.Triggers><Trigger Property="IsSelected" Value="True"><Setter Property="Foreground" Value="#172124"/></Trigger></Style.Triggers></Style>
 </Window.Resources>
 <Grid Margin="26,22,26,18">
  <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <StackPanel Grid.Row="0" Margin="0,0,0,16">
   <TextBlock Text="BRANN'S FORGE" FontFamily="Georgia" FontSize="36" Foreground="#F6CA86"/>
   <TextBlock Text="Choose your way into the same world." Foreground="#A9C5C4" Margin="2,3,0,0"/>
  </StackPanel>
  <TabControl x:Name="Tabs" Grid.Row="1" Background="#202B2E" BorderBrush="#54625C" Foreground="#EEE7D9" Padding="4">
   <TabItem Header="THE ADVENTURE">
    <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="22,20,22,15">
     <TextBlock Text="WHO IS PLAYING?" FontSize="12" FontWeight="Bold" Foreground="#EBC68E"/>
     <ComboBox x:Name="Role" Margin="0,8,0,5" Height="36" ToolTip="Adventure is the normal game. Director adds a second strategic player. Fairy opens the local companion window."/>
     <TextBlock x:Name="RoleHelp" Foreground="#B9D1CA" Margin="2,3,0,12"/>
     <TextBlock Text="WHERE WILL THE HERO PLAY?" FontSize="12" FontWeight="Bold" Foreground="#EBC68E"/>
     <StackPanel Orientation="Horizontal" Margin="2,5,0,7">
      <RadioButton x:Name="VR" Content="VR headset" IsChecked="True" GroupName="Display" ToolTip="Starts SteamVR if needed, waits for it to initialise, then opens the game in the headset."/>
      <RadioButton x:Name="Desktop" Content="Monitor / projector" GroupName="Display" ToolTip="Mouse and keyboard Hero controls; useful for rehearsing without a headset."/>
     </StackPanel>
     <StackPanel x:Name="DirectorOptions" Visibility="Collapsed" Margin="0,4,0,7">
      <TextBlock Text="DIRECTOR'S VIEW" FontSize="12" FontWeight="Bold" Foreground="#EBC68E"/>
      <ComboBox x:Name="DirectorView" Margin="0,7,0,4" Height="36" ToolTip="The native window is the fast same-PC option. The browser view is the older, slower fallback."/>
      <TextBlock Text="The second player sees and changes the Hero's live world. Move their window to the projector; F11 makes it fullscreen." Foreground="#B9D1CA" Margin="2,2,0,0"/>
     </StackPanel>
     <Border Background="#293638" BorderBrush="#4B6360" BorderThickness="1" Padding="15" Margin="0,10,0,9">
      <StackPanel>
       <TextBlock Text="OPTIONAL EXTRAS" FontSize="12" FontWeight="Bold" Foreground="#EBC68E"/>
       <CheckBox x:Name="Fairy" Content="Open Little Wing for another local player" ToolTip="Adds a mouse/controller fairy companion. The Hero can also open it with F8 while playing."/>
       <CheckBox x:Name="Fuel" Content="Experimental spreading-fire combat" ToolTip="Try the newer fuel-and-fire mechanics. This is an experimental variant of the main game."/>
      </StackPanel>
     </Border>
     <TextBlock x:Name="GameSummary" Foreground="#B9D1CA" FontSize="14" Margin="2,3,0,13"/>
     <Button x:Name="LaunchGame" Content="START GAME" HorizontalAlignment="Left" MinWidth="180" ToolTip="Starts the selected game mode. A running game must be closed before changing modes."/>
    </StackPanel></ScrollViewer>
   </TabItem>
   <TabItem Header="LABS &amp; DEMOS">
    <Grid Margin="20"><Grid.ColumnDefinitions><ColumnDefinition Width="290"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
     <ListBox x:Name="Experiments" Grid.Column="0" Background="#172124" Foreground="#EFE6D5" BorderBrush="#51615A" FontSize="15" Padding="5"/>
     <StackPanel Grid.Column="1" Margin="24,8,4,0">
      <TextBlock x:Name="ExperimentTitle" FontFamily="Georgia" FontSize="28" Foreground="#F6CA86"/>
      <TextBlock x:Name="ExperimentSummary" Margin="0,10,0,8" Foreground="#D7E6DE"/>
      <TextBlock x:Name="ExperimentDetail" Foreground="#AFCAC3" Margin="0,0,0,24"/>
      <Button x:Name="LaunchExperiment" Content="OPEN SELECTED" HorizontalAlignment="Left" MinWidth="180" ToolTip="Opens only the selected lab or demo. Experiments are separate from the current adventure unless their description says otherwise."/>
     </StackPanel>
    </Grid>
   </TabItem>
  </TabControl>
  <Border Grid.Row="2" Background="#233036" BorderBrush="#52645F" BorderThickness="1" Padding="12" Margin="0,15,0,12"><TextBlock x:Name="Status" Text="Checking the forge..." Foreground="#BEE3D2"/></Border>
  <DockPanel Grid.Row="3">
   <Button x:Name="StopGame" Content="Stop managed session" Background="#4A3B38" BorderBrush="#9A7060" ToolTip="Closes only this project's recorded game, voice helper, and service. Active commissions are safely cancelled/refunded."/>
   <Button x:Name="OpenLogs" Content="Open logs" Background="#324044" BorderBrush="#657875" ToolTip="Opens timestamped game, service, audio, and launcher diagnostics."/>
   <TextBlock Text="The launcher stays open after the game starts." VerticalAlignment="Center" HorizontalAlignment="Right" Foreground="#8FA7A3" FontSize="12"/>
  </DockPanel>
 </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$script:window = [Windows.Markup.XamlReader]::Load($reader)
foreach ($name in @('Tabs','Role','RoleHelp','VR','Desktop','DirectorOptions','DirectorView','Fairy','Fuel','GameSummary','LaunchGame','Experiments','ExperimentTitle','ExperimentSummary','ExperimentDetail','LaunchExperiment','Status','StopGame','OpenLogs')) {
  Set-Variable -Name $name -Scope Script -Value $script:window.FindName($name)
}

@('Adventure - one Hero','Director - Hero + game master','Fairy - Hero + companion','World Builder - develop the orchard') | ForEach-Object { [void]$script:Role.Items.Add($_) }
@('Native window - recommended','Browser view - older fallback') | ForEach-Object { [void]$script:DirectorView.Items.Add($_) }
$script:Role.SelectedIndex = 0
$script:DirectorView.SelectedIndex = 0
foreach ($item in $script:experimentCatalog) {
  $entry = New-Object System.Windows.Controls.ListBoxItem
  $entry.Content = $item.title
  $entry.Tag = $item.id
  $entry.ToolTip = $item.summary
  $entry.Padding = '9,8'
  [void]$script:Experiments.Items.Add($entry)
}
$script:Experiments.SelectedIndex = 0

function Get-GameArguments {
  $arguments = @()
  if ($script:Desktop.IsChecked) { $arguments += '-Desktop' }
  if ($script:Role.SelectedIndex -eq 1) {
    if ($script:DirectorView.SelectedIndex -eq 0) { $arguments += '-DirectorLocal' }
    else { $arguments += '-DirectorMode' }
  }
  if ($script:Role.SelectedIndex -eq 2 -or $script:Fairy.IsChecked) { $arguments += '-FairyCoop' }
  if ($script:Role.SelectedIndex -eq 3) { $arguments += '-WorldBuilder' }
  if ($script:Fuel.IsChecked) { $arguments += '-ExperimentalFuelCombat' }
  return $arguments
}

function Update-GameSummary {
  $role = $script:Role.SelectedIndex
  $script:DirectorOptions.Visibility = if ($role -eq 1) { 'Visible' } else { 'Collapsed' }
  $script:RoleHelp.Text = @(
    'Explore, craft, and fight in the main adventure.',
    'A second person directs encounters from the same live world.',
    'The Hero plays normally while Little Wing flies alongside them.',
    'Shape the same Orchard Highlands with helpers, paths, trees, and a bridge. Return to walk your work in VR.'
  )[$role]
  $display = if ($script:Desktop.IsChecked) { 'desktop' } else { 'VR' }
  $description = if ($role -eq 1) {
    if ($script:DirectorView.SelectedIndex -eq 0) { "The Hero plays in $display; the Director gets a fast native tactical window. Best for the projector." }
    else { "The Hero plays in $display; the Director gets the older browser view. This view is much slower." }
  } elseif ($role -eq 2) { "The Hero plays in $display and Little Wing joins locally." }
  elseif ($role -eq 3) { "The Hero plays in $display while a second native window surveys and develops the Orchard Highlands." }
  else { "The ordinary $display adventure." }
  if ($script:Fairy.IsChecked -and $role -ne 2) { $description += ' Little Wing can join too.' }
  if ($script:Fuel.IsChecked) { $description += ' Experimental fuel combat is enabled.' }
  $script:GameSummary.Text = $description
}

function Update-ExperimentSummary {
  $entry = $script:Experiments.SelectedItem
  if (!$entry) { return }
  $item = $script:experimentCatalog | Where-Object id -eq $entry.Tag | Select-Object -First 1
  $script:ExperimentTitle.Text = $item.title
  $script:ExperimentSummary.Text = $item.summary
  $script:ExperimentDetail.Text = $item.detail
}

function Get-ManagedStatus {
  $statePath = Join-Path $script:logs 'runtime.json'
  if (!(Test-Path -LiteralPath $statePath)) { return 'No managed game is running. Ready to launch.' }
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (!$state.game) { return 'Forge helper running; no game window recorded.' }
    $game = Get-Process -Id $state.game.pid -ErrorAction SilentlyContinue
    if (!$game) { return 'Previous game is closed. Ready to launch.' }
    if ($game.StartTime.ToUniversalTime().Ticks -ne ([datetime]$state.game.started).ToUniversalTime().Ticks -or $game.Path -ne $state.game.path) { return 'An old process record does not match; it will be left alone.' }
    $mode = if ($state.game.worldBuilder) { 'live Orchard World Builder' } elseif ($state.game.directorLocal) { 'native Director' } elseif ($state.game.directorMode) { 'browser Director' } elseif ($state.game.fairyCoop) { 'Fairy companion' } else { 'adventure' }
    $display = if ($state.game.desktopMode) { 'desktop' } else { 'VR' }
    return "Running: $display $mode (PID $($game.Id)). Close it before switching modes."
  } catch { return 'Could not read the managed session record. Check logs/runtime.json.' }
}

function Set-LauncherStatus([string]$message,[bool]$error = $false) {
  $script:Status.Text = $message
  $script:Status.Foreground = if ($error) { '#FFB4A5' } else { '#BEE3D2' }
}

function Read-LauncherLog([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { return '' }
  try {
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object IO.StreamReader($stream)
      try { return $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
  } catch [IO.IOException] { return $null }
}

function Start-LauncherTask([string]$label,[string]$file,[string[]]$arguments) {
  if ($script:task -and !$script:task.HasExited) { Set-LauncherStatus 'A launch or shutdown is already in progress.' $true; return }
  New-Item -ItemType Directory -Force -Path $script:logs | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $script:taskOut = Join-Path $script:logs "launcher-$stamp.out.log"
  $script:taskErr = Join-Path $script:logs "launcher-$stamp.err.log"
  $script:taskLabel = $label
  $argLine = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$file+'"')) + $arguments
  try {
    $script:task = Start-Process -FilePath $script:powerShell -ArgumentList $argLine -WorkingDirectory $script:root -WindowStyle Hidden -RedirectStandardOutput $script:taskOut -RedirectStandardError $script:taskErr -PassThru
    $script:LaunchGame.IsEnabled = $false
    $script:LaunchExperiment.IsEnabled = $false
    $script:StopGame.IsEnabled = $false
    Set-LauncherStatus "$label is starting. The launcher will stay open."
    ("{0:o} start label={1} pid={2}" -f (Get-Date),$label,$script:task.Id) | Add-Content (Join-Path $script:logs 'launcher-events.log')
  } catch { Set-LauncherStatus "Could not start $label`: $_" $true }
}

function Invoke-GameLaunch {
  $flags = @(Get-GameArguments)
  Start-LauncherTask 'Brann' (Join-Path $script:root 'start.ps1') $flags
  if (!$script:Desktop.IsChecked -and $script:task) {
    Set-LauncherStatus 'Starting SteamVR if needed, then waiting for the VR runtime before opening Brann. This can take about a minute.'
  }
}

function Start-Experiment {
  if ($script:task -and !$script:task.HasExited) { Set-LauncherStatus 'Please wait for the current launch to finish.' $true; return }
  $entry = $script:Experiments.SelectedItem
  if (!$entry) { return }
  $item = $script:experimentCatalog | Where-Object id -eq $entry.Tag | Select-Object -First 1
  if ($item.id -eq 'ember-vr') {
    Start-LauncherTask $item.title (Join-Path $script:root 'scripts/Start-EmberGalleryVR.ps1') @()
    return
  }
  if ($item.kind -eq 'script') {
    Start-LauncherTask $item.title (Join-Path $script:root $item.file) $item.arguments
    return
  }
  try {
    if ($item.kind -eq 'godot') {
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $args = @('--path',('"'+(Join-Path $script:root 'godot')+'"'),'--xr-mode','off','--log-file',('"'+(Join-Path $script:logs "bellworks-$stamp.log")+'"'),'--') + $item.arguments
      [void](Start-Process -FilePath $script:engine -ArgumentList $args -WorkingDirectory (Join-Path $script:root 'godot') -PassThru)
    } else {
      $exe = Join-Path $script:root $item.file
      if (!(Test-Path -LiteralPath $exe)) { throw "Missing exported build: $exe" }
      $exportRoot = Split-Path $exe -Parent
      $pack = Join-Path $exportRoot 'EmberGallery.pck'
      $exportLogs = Join-Path $exportRoot 'logs'
      New-Item -ItemType Directory -Force -Path $exportLogs | Out-Null
      $exportLog = Join-Path $exportLogs ('game-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log')
      $args = @('--main-pack',('"'+$pack+'"')) + $item.arguments + @('--log-file',('"'+$exportLog+'"'),'--','--playful-demo','--demo-persistent','--ember-gallery-demo')
      [void](Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $exportRoot -PassThru)
    }
    Set-LauncherStatus "$($item.title) opened. Close its own window when finished."
  } catch { Set-LauncherStatus "Could not open $($item.title): $_" $true }
}

$script:Role.Add_SelectionChanged({ Update-GameSummary })
$script:DirectorView.Add_SelectionChanged({ Update-GameSummary })
$script:VR.Add_Checked({ Update-GameSummary })
$script:Desktop.Add_Checked({ Update-GameSummary })
$script:Fairy.Add_Checked({ Update-GameSummary })
$script:Fairy.Add_Unchecked({ Update-GameSummary })
$script:Fuel.Add_Checked({ Update-GameSummary })
$script:Fuel.Add_Unchecked({ Update-GameSummary })
$script:Experiments.Add_SelectionChanged({ Update-ExperimentSummary })
$script:LaunchGame.Add_Click({ Invoke-GameLaunch })
$script:LaunchExperiment.Add_Click({ Start-Experiment })
$script:StopGame.Add_Click({ Start-LauncherTask 'Managed session shutdown' (Join-Path $script:root 'stop.ps1') @() })
$script:OpenLogs.Add_Click({ New-Item -ItemType Directory -Force -Path $script:logs | Out-Null; Start-Process explorer.exe -ArgumentList ('"'+$script:logs+'"') })

$script:timer = New-Object Windows.Threading.DispatcherTimer
$script:timer.Interval = [TimeSpan]::FromMilliseconds(450)
$script:timer.Add_Tick({
 try {
  if (!$script:task) { return }
  if (!$script:task.HasExited) { return }
  $script:task.WaitForExit()
  $code = $script:task.ExitCode
  $result = Read-LauncherLog $script:taskOut
  $problem = Read-LauncherLog $script:taskErr
  if ($null -eq $result -or $null -eq $problem) { return } # redirect handles are still closing; retry next tick
  # Windows PowerShell's Start-Process object can report a null ExitCode even after HasExited.
  if ($null -eq $code -or [string]::IsNullOrWhiteSpace([string]$code)) { $code = if ($problem) { 1 } else { 0 } }
  ("{0:o} finish label={1} exit={2}" -f (Get-Date),$script:taskLabel,$code) | Add-Content (Join-Path $script:logs 'launcher-events.log')
  if ($code -eq 0) { Set-LauncherStatus $(if ($result) { $result } else { "$($script:taskLabel) completed. $(Get-ManagedStatus)" }) }
  else {
    $detail = if ($problem) { ($problem -split '\r?\n' | Where-Object { $_ -match 'SteamVR|already running|missing|occupied|Error|Exception|At ' } | Select-Object -First 1) } else { '' }
    if (!$detail) { $detail = if ($problem) { ($problem -split '\r?\n' | Select-Object -First 1) } else { "Exit code $code" } }
    Set-LauncherStatus "$($script:taskLabel) failed: $detail  See logs for details." $true
  }
  $script:LaunchGame.IsEnabled = $true
  $script:LaunchExperiment.IsEnabled = $true
  $script:StopGame.IsEnabled = $true
  $script:task = $null
 } catch {
   ("Status timer: " + $_.InvocationInfo.PositionMessage + " :: " + $_.Exception.Message) | Add-Content (Join-Path $script:logs 'launcher-ui-errors.log')
   Set-LauncherStatus 'Launcher status update failed. See logs/launcher-ui-errors.log.' $true
   $script:task = $null
 }
})
$script:timer.Start()
Update-GameSummary
Update-ExperimentSummary
Set-LauncherStatus (Get-ManagedStatus)

if ($SmokeTest) {
  $smoke = New-Object Windows.Threading.DispatcherTimer
  $smoke.Interval = [TimeSpan]::FromSeconds(2)
  $smoke.Add_Tick({
    $smoke.Stop()
    foreach ($page in @(@{index=0; name='launcher-preview.png'},@{index=1; name='launcher-preview-labs.png'})) {
      $script:Tabs.SelectedIndex = $page.index
      $script:window.UpdateLayout()
      $image = New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$script:window.ActualWidth,[int]$script:window.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
      $image.Render($script:window)
      $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
      $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($image))
      $path = Join-Path $script:root ('outputs/'+$page.name)
      $stream = [IO.File]::Create($path)
      try { $encoder.Save($stream) } finally { $stream.Dispose() }
    }
    $script:window.Close()
  })
  $smoke.Start()
}
if ($SmokeLaunchDesktop) {
  $script:Role.SelectedIndex = 1
  $script:Desktop.IsChecked = $true
  Invoke-GameLaunch
  $deadline = (Get-Date).AddSeconds(30)
  $script:launchProbe = New-Object Windows.Threading.DispatcherTimer
  $script:launchProbe.Interval = [TimeSpan]::FromMilliseconds(500)
  $script:launchProbe.Add_Tick({
    try {
      if (!$script:task -or (Get-Date) -gt $deadline) { $script:launchProbe.Stop(); $script:window.Close() }
    } catch { ("Launch probe: " + $_.InvocationInfo.PositionMessage + " :: " + $_.Exception.Message) | Add-Content (Join-Path $script:logs 'launcher-ui-errors.log'); $script:window.Close() }
  })
  $script:launchProbe.Start()
}
try { [void]$script:window.ShowDialog() }
catch {
  New-Item -ItemType Directory -Force -Path $script:logs | Out-Null
  $_.Exception.ToString() | Add-Content (Join-Path $script:logs 'launcher-ui-errors.log')
  throw
}
$script:launcherMutex.ReleaseMutex()
$script:launcherMutex.Dispose()
if ($SmokeTest) { Write-Output 'PASS launcher window opened and closed' }
if ($SmokeLaunchDesktop) {
  Write-Output $script:Status.Text
  if ($script:Status.Text -notmatch '^Brann is ready') { throw 'Launcher desktop start did not report ready.' }
}
