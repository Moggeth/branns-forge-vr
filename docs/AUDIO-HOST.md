# Managed native voice audio host

`audio-host/` contains a small, hidden Electron renderer for the existing local
voice companion. The native game's Talk/Stop controls remain the conversation
authority. The helper loads only `http://127.0.0.1:8787/voice/?managed=1`; no
ordinary browser window or autoplay click is needed.

Electron is pinned to **44.3.0**, including `package-lock.json`. Restore it with:

```powershell
& 'C:/Program Files/nodejs/npm.cmd' ci --prefix audio-host --no-audit --no-fund
& 'C:/Program Files/nodejs/node.exe' audio-host/node_modules/electron/install.js
```

Electron 44's npm package does not include an automatic postinstall download.
The explicit second command installs its pinned platform executable; this is
also available through the package's `npm run setup` script.

## Launch, stop and recover

Executable: `audio-host/node_modules/electron/dist/electron.exe`.
Arguments: the absolute `audio-host` folder path. The root game's start/stop
scripts own launching and stopping this process. A normal launch creates one
hidden, non-taskbar window and enforces a single instance using Electron's lock.
A duplicate launch exits or is ignored without bringing anything onscreen.

The helper checks the exact loopback service's `/health` every two seconds.
When its process identity changes or the service returns after an outage, it
reloads the companion to obtain a fresh session configuration. Missing service
or page-load failures are retried. The managed page supplies the root service's
`/api/vr/voice-client` heartbeat, keeping native status and ordinary-browser
suppression in the existing application layer.

Logs are timestamped JSON lines in `audio-host/logs/`. Browser profile state is
under `audio-host/state/chromium`; normal process identity is recorded in
`audio-host/state/host.json`. These directories and `node_modules` are ignored.
Logs contain lifecycle, permission outcomes, service identity changes and
bounded exception frames; they do not copy conversations, renderer console
messages, tokens or credentials. The helper never reads API keys.

If voice is unavailable, inspect the latest host log and the native status.
The helper automatically permits the local page's microphone request, but OS
microphone privacy restrictions and unavailable headset devices still apply.
Microphone/output selection remains the application's device configuration and
Windows audio routing; this helper does not change system settings.

## Scope of renderer access

The BrowserWindow uses `show: false`, background throttling disabled and
`autoplayPolicy: no-user-gesture-required`. It enables sandboxing and context
isolation, disables Node integration, webviews, developer tools and downloads,
and blocks new windows and external navigation. HTTP resource requests remain
on the exact loopback origin; the established WebRTC media transport is the
existing voice protocol.

Both Electron permission checking and permission request handlers are set.
Only an audio-only `media` request from the main frame of the exact loopback
voice page is granted. Camera, mixed audio/video, screen capture, subframes and
all other permissions are denied. Unknown or missing media types fail closed.
The implementation follows the official [session permission documentation](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler)
and [media request structure](https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request).

## Verification without a paid call

```powershell
& 'C:/Program Files/nodejs/node.exe' audio-host/check.cjs
& 'C:/Program Files/nodejs/node.exe' --test audio-host/policy-test.cjs
```

`check.cjs` launches the real hidden Chromium helper with `--check` and waits
for its exit. That mode owns a fresh random-port loopback diagnostic server,
uses a separate test profile and Chromium's fake media device, mutes diagnostic
output, and never contacts the normal 8787 service. It verifies real microphone
permission handling, camera/mixed capture rejection, both WebAudio resume and
audio-element playback without a gesture, renderer Node isolation, popup
blocking, a managed heartbeat, and an invisible single BrowserWindow.

The final check passed all assertions in **0.256 seconds** inside Electron;
paired runner/policy tests completed in **0.619 seconds**. Two policy tests also
cover alternate origins, credentials in URLs, malformed paths, non-audio
permissions, and subframe denial. No normal voice helper or paid voice session
was launched for these checks. This confirms the browser permission/autoplay
path using synthetic audio, not an actual headset conversation.

## Timing and recovery lessons

- Discovery/npm version query: 4.709 seconds.
- Pinned npm dependency installation: 3.584 seconds.
- Explicit Electron binary installation: 7.616 seconds.
- Initial policy/syntax checks: 0.356 seconds.
- First direct GUI diagnostic launch returned before the process completed.
  Its detached stdout pipe raised `EPIPE`; the exception logger also wrote to
  that pipe, causing recursion. Only that verified diagnostic process and its
  own children were stopped, and the first failure records were retained.
  Recovery took 0.980 seconds. The host now logs only to files; the Node check
  runner waits on Electron with hidden windows and ignored stdio, then reads
  the bounded diagnostic result. Do not invoke the GUI exe directly from a
  shell and infer success from the shell's immediate exit code.
- Recovered real diagnostic: 0.837 seconds including runner, then the expanded
  playback diagnostic and policy rerun: 0.619 seconds.

Work began at 2026-09-12 20:56:43.527 +10:00. Total authoring and verification
duration is recorded below.
Total inclusive work: 460.922 seconds.
