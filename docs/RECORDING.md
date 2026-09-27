# VR recording with OBS

Hold **right B for one second** to start or stop. Release before holding again.
A short tap does not record (it may recall the fairy or vent Wyrmspout); left B opens the toolbelt. You can also press
left B and choose **Quick > Start video / Stop video**. A red REC
timer and haptic confirmation acknowledge recording; stopping shows the saved name.
The indicator reflects OBS status, not a guessed local toggle. If OBS disconnects,
the game displays status unknown rather than falsely claiming recording stopped.

**Ctrl+Shift+F9** is the global OBS desktop fallback. It works without the game
hotkey. In OBS, the ordinary Start/Stop Recording button works too.

## Everyday use

Open **Brann's Forge Launcher**, select Adventure and VR headset, then press Start Game. OBS starts in its tray if not already running.
No recording starts until you request one. If OBS was closed later, the first VR
hold opens it; hold again after it connects. Files are saved automatically in
`recordings/` as `Branns-Forge-YYYY-MM-DD-hh-mm-ss.mp4`.

The dedicated **Branns Forge Silent** profile / **Branns Forge** scene collection
uses only the game's client area via Windows Graphics Capture: no desktop, webcam,
microphone or game audio source. OBS writes an empty silent audio track alongside
1280x800, 30 fps H.264 video. NVIDIA NVENC does the encoding. Hybrid MP4 is directly
shareable and recoverable if interrupted. Keep the game window restored (not
minimized); occlusion is supported. Do not rename the game window or capture source.

OBS stays open after closing the game. **Stop your recording before exiting VR**;
if you forget, use Ctrl+Shift+F9 or OBS Stop Recording. Close OBS normally from its
tray when finished. The game never stops another profile's recording or streaming.
If another OBS profile is open, select Branns Forge Silent and collection Branns
Forge manually; existing personal OBS profiles and scenes are preserved.

## Setup / recovery

OBS Studio 32.2.2 is already installed at `C:/Program Files/obs-studio`.
No extra plugin, subscription, AI call or Python video-processing loop is needed.
To recreate the dedicated setup:

1. Close OBS; leave one game window open.
2. `python scripts/setup_obs.py` (backs up existing affected config into work/).
3. `& scripts/Start-OBS.ps1`
4. `node scripts/configure_obs.cjs`

This enables OBS's authenticated WebSocket server using its existing password.
The native client reads it locally from `%APPDATA%/obs-studio/plugin_config/obs-websocket/config.json`,
connects to 127.0.0.1, and never logs credentials. Existing configured port is reused.
Do not expose this server publicly. OBS configuration lives in AppData; video and
runtime logs stay outside source. `scripts/record_game.py` now only opens OBS and
prints controls, preserving the old command without running the old capture loop.

If the recorder reports a missing source, run step 4 again with the game open.
If OBS is unavailable, gameplay continues normally. Restart OBS for authentication
or connection failures; inspect its latest log in `%APPDATA%/obs-studio/logs/` and
`logs/game-*.log` lines beginning RECORDING. No unconfirmed operation is auto-retried.
You can inspect recorder state with `node scripts/obs_rpc.cjs GetRecordStatus`.

2026-09-27 recovery: OBS was running but its log stopped at `Crash or unclean shutdown detected`, with no WebSocket listener. The recovery modal was hidden by background startup. OBS 32 removed `--disable-shutdown-check`; trying that obsolete flag did not help. The dedicated launcher now preserves a stale `%APPDATA%/obs-studio/.sentinel` directory under `logs/obs-sentinel-*` only when no OBS process is running, then starts normally. Recovery is recorded in `logs/obs-startup.log`; existing running OBS sessions are never stopped by this script. If OBS is already stuck at the prompt, close that specific instance before rerunning the launcher. Do not delete profiles, scenes or crash reports.

Verification after recovery: native controller latch and live OBS start/timer/stop checks passed (`RECORDING_CHECK []`, 5.380 s). The saved test MP4 was decoded and visually inspected: actual game view, H.264 1280x800, 2.833 seconds. The running VR game received OBS's recording event without restart. Physical pressing of the controller still requires the player; tests exercised the same hold latch and native recording path.

## Verification

Offline controller latch checks (no OBS recording):
`tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://recording_checks.gd`

Append `-- --live-obs-check` for the explicit 3-second capture test. This invokes the
real native start/stop code against OBS, refuses to interrupt an existing recording,
and records the output path in logs/obs-test-output.txt. Require RECORDING_CHECK []
and no script errors; exit code alone is insufficient for Godot parse errors.
Use ffprobe on that file and inspect a decoded frame for capture verification.

The original GDI capture returned blank Vulkan frames. WGC in OBS works and captures
without the title bar. Use it directly; don't repeat GDI or build a per-frame Python
copy/encode pipeline. OBS API reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
Launch parameters: https://obsproject.com/kb/launch-parameters
