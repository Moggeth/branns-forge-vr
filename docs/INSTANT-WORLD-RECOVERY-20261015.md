# Faster world connection recovery — 2026-10-15

Prepared from remote main `8de545f` in isolated branch `codex/instant-recovery`.
The original main checkout is three commits ahead and 149 behind origin/main;
its asset-browser changes and untracked native files remain untouched.
GitHub reports `Moggeth/branns-forge-vr` is public, despite older private-repository
notes. Publishing this branch and deploying it await user approval.

## Avoidable delays

WebRTC previously had eight seconds before the browser requested its cloud relay.
It now gets a 250 ms head start. Fast direct edges cancel the relay timer. Once relay
wins, the existing transport keeps that ordered stream for the edge; late RTC does
not split commands and deltas. More slow negotiations will use the relay, subject
to existing room budgets. No Worker/protocol deployment is needed.

A welcome naming an offline host or an authoritative host-loss notification now
sends `retry_world` immediately. A newly joining guest previously had no established
edge for the liveness timer and could wait for the coordinator's 15-second grace.
Healthy direct gameplay still ignores signaling-only host-loss notifications.

`autoSave()` returns false both before a checkpoint arrives and on write failure.
Host-loss now distinguishes recovery availability, so the lobby only warns about a
failed backup when it actually had data to save. Real write failures remain visible.

## Local acceptance

- 50 focused assertions pass: fallback deadline/cancellation, edge cleanup, pre-data
  host loss, healthy direct authority, checkpoint/delta correctness, bounded ingress,
  save failures, reload and migration. Focused checks plus patch notes: 1.310 s.
- Real Chromium/local Wrangler with unavailable ICE: two-player recovery and command
  replication in **380 ms**. Full suite: **2.623 s**.
- Actual direct WebRTC, signaling outage with retained simulation, transfer and
  old-host commands pass: **6.063 s**.
- Three browser processes preserve a terrain edit through background handoff
  (**57 ms** maximum snapshot gap), deliberate close (**72 ms**) and abrupt crash
  (**4398 ms**). No observed rewind or session errors. Harness: **17.941 s**.
- Local Worker checks: origins, relay isolation, epochs, reconnect identity,
  32-player cap and host departure pass: **0.774 s** harness.
- Check build (1.792 s command) and production build (1.447 s command) pass,
  including packaged asset validation. Existing bundle-size warning remains.

These are loopback transport measurements, not asset/render startup or physical
phone/headset and separate-network acceptance. Silent crashes still need four seconds
without host traffic to avoid replacing authority on a brief stall. The coordinator
retains its 30-second cooldown for replacing a still-online frozen host. Instantaneous
crash recovery and deployed behavior are not claimed.

## Reproduce and diagnose

From `multiplayer/`:

```powershell
node --test tests/peer-channel-recovery.mjs tests/session-save-recovery.mjs tests/host-handover.mjs tests/session-reload.mjs tests/checkpoint-delta.mjs tests/peer-encoding.mjs tests/frame-inbox.mjs
node tests/patch-notes.mjs
npm run build:check
npm run build
```

Start isolated Vite on 5178 and Wrangler with `--local` on 8791 per the cloud README.
Set `ACCEPT_BASE=http://127.0.0.1:5178`, then run `node tests/cloud-transport.mjs`
with/without `FORCE_RELAY=1`, plus `node tests/browser-host-handover.mjs`.
The stalled-ICE suite now requires recovery/replication within two seconds; handoff
snapshot gaps must stay under two seconds for graceful changes and six for crashes.
No live rooms or paid voice are needed. Results and console logs persist in ignored
`logs/browser-acceptance/`; measured work steps in `logs/work-timing.csv`.
Stop only the owned Vite/Wrangler diagnostics. Refresh after an approved release.

## Recovery lessons

- The app worktree helper uses this chat's staging checkout, which lacks `origin/main`;
  its attempt failed immediately. Use `git worktree add` in the explicitly identified
  real repository. Do not initialize staging Git or implicitly reconcile diverged main.
- Cached Playwright expected missing `chromium_headless_shell-1247`; first launch
  failed before opening a browser (0.290 s). Point `PW_CHROME` at verified installed
  `chromium-1243/chrome-win64/chrome.exe` and `PW_CORE` at the cached module. All
  browser checks then passed without a download. Inspect caches on each machine.
- PowerShell positional globs for `rg` do not expand. Use `rg --files` and `rg -g`
  per AGENTS.md; missing guessed paths/glob searches provided no evidence.
- Legacy README/VERIFICATION contain non-UTF-8 bytes; `apply_patch` rejected the
  multi-file documentation patch before writes. Preserve their bytes and insert
  ASCII link text with byte-based editing, rather than silently recoding old history.
