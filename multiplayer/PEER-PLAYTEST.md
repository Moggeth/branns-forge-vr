# Peer playtest handoff — 2026-10-02

Public page: https://branns-forge-multiplayer.vercel.app

Current temporary signaling URL:
`wss://blackjack-meals-mia-meals.trycloudflare.com/peer/ws`.
It changes when the Quick Tunnel restarts. Do not promise this endpoint is permanent.

## Start, inspect and recover

From `multiplayer/`, run `npm ci` once. Start:

```powershell
$env:PEER_ORIGINS='http://127.0.0.1:5178,http://localhost:5178,https://branns-forge-multiplayer.vercel.app'
node peer/server.mjs
```

In another terminal run the verified cloudflared executable:

```powershell
../work/hosting-tools/cloudflared-2026.9.3/cloudflared.exe tunnel --url http://127.0.0.1:8789 --no-autoupdate
```

Use hidden windows for background launchers. Stop only these owned processes
with Ctrl+C, never all Node/Godot processes. Signaling logs:
`multiplayer/peer/logs/server.jsonl`. Health: `/peer/health` on either local or
tunnel HTTP origin. Server restart removes room membership; resume a local or
downloaded save into a new room. A stopped tunnel leaves the Vercel page visible
but prevents joining. Recover it, rebuild with the new `VITE_PEER_WS_URL` and
redeploy. The player-facing lobby deliberately has no endpoint field.

Next durable hosting step is a named tunnel/stable hostname plus a managed
signaling process and optional TURN. This deployment did not purchase anything.

## Build and deploy only public output

`scripts/deploy-peer-preview.ps1 -PeerUrl wss://NEW-HOST/peer/ws` builds the
designed lobby and publishes an isolated Vercel Build Output API directory in
the system temporary folder, outside all Git checkouts.
It requires the existing ignored `.vercel/project.json` and authenticated
Moggeth Vercel CLI. It uploads only compiled browser JS/CSS, the three GLBs and HTML;
no native saves, source, environment files, credentials or local services.
`npm run build` builds the lobby; `build:check` retains the diagnostic harnesses.

Lobby uplift: personal Claude.ai Pro identity verified before generation,
actual/canonical model `claude-opus-5-5`, high effort, 348.176 s. Source commission
was isolated under work/opus-welcoming-lobby-20261002. Codex refined short-screen
spacing, preserved leading-zero room codes, fixed formatted paste, added menu
focus containment and ensured join timeout covers the first actual world state.
Node regression+protocol checks passed in 2.0457 s. Browser checks covered create,
invite join, 2/8 players, role switching, copy feedback, and narrow 360px rendering.
Narrow rendering is not physical phone gameplay acceptance. The browser's isolated
DOM inspection cannot access iframe contentDocument; use visual evidence rather
than retrying that unsupported inspection surface.

## Verification and measured evidence

- Public alias returned HTTP 200 without login; two browser tabs connected via
  public HTTPS/WSS and WebRTC, one God and one Hero, showing 2/8 players.
- God Raise replicated to the Hero with one shared edit.
- Host disconnected, Hero accepted Continue world after the grace period;
  simulation advanced again with one player and the terrain edit preserved.
- Former host rejoined as a guest; 2/8 players and the edit remained synchronized.
  Resume last saved world then created a new room with the same edit preserved.
- Protocol tests cover eight-player cap, ninth-player rejection, origins,
  host epochs, offer expiry/retry. Simulation/save/session tests pass.
- Eight-player / 64-enemy / 64-edit / 64-grove CPU benchmark: 3,600 ticks plus
  20 Hz snapshots in 548.6992 ms; step+snapshot p95 0.2852 ms, p99 0.3913 ms,
  maximum 1.6759 ms; max JSON snapshot 14,589 bytes. This excludes GPU, network
  latency, headset rendering and asset loading. It is not a headset capacity claim.
- Latest regression run: eight Node tests in 74.3862 ms; compiled build and peer
  protocol check together 2.5691 s; public deployment 9.6304 s.
- Physical Vive/Quest, separate-household connectivity and sustained eight
  rendered clients remain unverified. No TURN relay is configured.

## Lessons to preserve

- Test disconnections with a compiled Vite preview, not a hot-reloading server.
  Two earlier migration checks were invalidated by source edits causing reloads.
- The original 20-second takeover offer expired during inspection (`no_offer`).
  Offers now last two minutes and explicitly support expiry and retry.
- Checkpoint revisions must increase across Reset; simulation tick returns to
  zero, but using it as revision makes peers reject the new world. Regression added.
- Fresh world autosave must bypass the previous world's ten-second save timer;
  otherwise Reset stores the old world but delays the new one. Regression added.
- Fresh connection clears prior room checkpoint/revision; socket reconnection
  retains them. Otherwise a high old-room revision could suppress a new world.
- Run npm commands inside `multiplayer/`; the repo root has no package.json.
- Claude profile/email-hint login still reported the work identity. Do not repeat
  generation or assume desktop personal login changes CLI subscription identity.
- An attempted detached Start-Process service launch was rejected by automatic
  approval review (policy block without a more specific reason). The existing
  foreground Node launch was restored and public health rechecked. Current
  owned session/tunnel metadata is in ignored `logs/peer-live-processes.json`;
  do not claim an installed background/autostart service.

## Lobby production verification — 2026-10-02

Production deployment `dpl_AvhS3ymbV9LKjj2SzGGas1dbLxtH` is READY at the public
alias. Compiled build + publication: 6.0569715 s. Anonymous HTTP 200 + signaling
health check: 0.6333366 s. Public create returned an eight-digit room, and an
invite joined as Hero while the host was God: both public tabs showed 2 of 8
players and 100/100 health. The old engineering toolbar is gone.

Deployment learning: staging beneath the Git worktree let the CLI infer commit
author metadata, and Vercel blocked publication with "commit author doesn't have
permission" despite CLI and GitHub both identifying Moggeth. The CLI waited
without surfacing the block; `vercel inspect <deployment>` exposed the reason.
Publish the compiled artifact from a fresh system-temporary directory using the
existing authenticated project owner, not a folder nested inside the repository.
No project access protections, billing plan or Git author settings were changed.
Browser Vercel login was a different personal account from CLI; do not alter its
GitHub connections to solve a CLI deployment issue. `gh api user/emails` also
lacks scope here; do not repeatedly request it or broaden scopes unnecessarily.


Mobile update: see MOBILE-CONTROLS.md. Production deployment
`dpl_5bdMqbqC6aezrWR5zEhyh2w2Nszb` adds Hero/God twin-thumb controls, all browser
MVP actions, fullscreen and standalone metadata. Twelve Node regressions and
thirteen synthetic real-renderer input assertions passed; physical phones remain
pending. No signaling restart was needed. The compiled-only deploy now includes
manifest.webmanifest, and still excludes tests/mobile-playtest.html.
