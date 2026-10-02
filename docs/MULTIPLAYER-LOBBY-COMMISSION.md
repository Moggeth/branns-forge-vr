# Opus 5.5 lobby commission

## Current commission — 2026-10-02

Personal sign-in is now verified: `fauxgrady@gmail.com`, `claude.ai`, Pro,
no API key source, in the scrubbed child environment. Explicit
`claude-opus-5-5` session metadata verified. Isolated commission:
`work/opus-welcoming-lobby-20261002/BRIEF.md`; ownership is only index.html,
lobby.css, lobby.js and HANDOFF.md. Codex owns integration/testing/deployment.
The brief supersedes the older dedicated-server brief below: eight players,
WorldSession peer transport, eight-digit invitations, icon role cards and no
visible connection endpoint. Budget: 480 seconds, 24 turns, high effort.

Sign-in lesson: `claude auth login --claudeai --email fauxgrady@gmail.com`
prints a fresh authorization URL. Verify the authorization page visibly shows
the personal email; finish that current flow and recheck CLI auth in the cleaned
environment. A prior browser success page or login hint alone is not verification.

## Accepted deliverable and integration

Commission finished successfully in **348.176 seconds**, high effort. Metadata
verified requested, actual and canonical `claude-opus-5-5`. The account was the
personal Pro subscription above; no API billing or model substitution was used.
Output: `work/opus-welcoming-lobby-20261002/{index.html,lobby.css,lobby.js,HANDOFF.md}`.
Integrated source lives under `multiplayer/`. Codex fixed short-screen layout,
formatted-code paste, menu focus/inert state, snapshot timeout and health bars.
The result uses original inline SVG role icons, charcoal/brass styling, clear
create/join actions and secondary save/menu controls. It has no endpoint input.

Tests: eight session/save/simulation regressions and peer protocol checks passed;
browser create/invite join showed two players, role switching and copy feedback.
Desktop 1280x720 and narrow 360px layout inspected. Physical phone/headset input
and separate-household connectivity remain unverified. See PEER-PLAYTEST.md for
public deployment verification. Do not mistake successful authentication for a
completed commission: retain metadata verification on every future generation.

## Historical brief (superseded)

2026-10-02 status: NOT SUBMITTED. Clean-environment Claude CLI reported signed
out, authMethod none and no subscription. No generation or API spend occurred.
Vercel connector returned UNAUTHORIZED; browser also showed its login page.
Do not repeatedly retry those operations without new sign-in evidence.

Use the user's personal fauxgrady@gmail.com Claude.ai subscription, scrub
Anthropic/provider/OAuth environment overrides, verify subscription, and invoke
explicit claude-opus-5-5. Verify the actual session model before accepting output.
No model or metered-billing fallback. See scripts/claude_commission.py.

Prepare an isolated work folder containing only multiplayer/CONTRACT.md,
client/network.js, client/game.js API documentation, and this brief. Do not copy
native saves, environment files, credentials or logs. Time cap: 15 minutes. Own
only index.html, client/lobby.js and client/lobby.css; no backend edits, deployment,
account changes or installs. Deliver source plus responsive layout/state decisions
and written handoff. Codex reviews, integrates and verifies behaviour.

Design a polished but compact Brann's Forge browser multiplayer lobby and in-game
overlay, using the existing warm brass/charcoal fantasy palette. Mobile-first room
selection and spectator/God controls; desktop mouse controls and headset WebXR.
No new 3D assets are needed. Keep world space dominant after joining.

Required states and behaviours:

- Name, create room, join room via code/link. Guest access, not misleading account
  sign-in. Many Heroes/Gods can choose either role in the same room.
- Hero (desktop or Enter VR), God; show supported/unsupported VR and actionable
  errors. Enter VR must be a direct user gesture; never imply all browsers work.
- Compact health/mana/participant count, four spell controls with readable costs,
  cursor release, role switching, share-room link, reconnect status and leave.
- Share only room code in URL; never token. Explicit fresh join after invalid_token;
  no hidden retry loops. Server snapshot owns actual role after role rejection.
- Loading, empty, unavailable backend, WebGL failure, room full, cooldown, denied
  VR permission, reconnect and session-replaced states. Text via textContent.
- Keyboard controls displayed succinctly; no movement while typing in forms.
- Accessible labels, focus, 44px touch targets, safe areas and readable narrow
  390px layout. Do not claim touchscreen Hero controls unless implemented.
- Use VITE_GAME_WS_URL if configured, otherwise same-origin /ws; require wss on
  https. Never expose the local native service. Keep external links/trackers out.
- Lazy-load game.js after join intent; disable combat input on lobby/menu focus.

Integrate the exact network/renderer APIs. game.js takes canvas and onAction,
onCast, onInput, onStatus callbacks; exposes applySnapshot, setRole, setSpell,
setActive, canVR, enterVR and dispose. RoomConnection events are welcome, status,
snapshot, error, event. Its identity token must never reach DOM/logs/URL.

Acceptance: desktop and 390px captures, keyboard focus test, two independent tabs
sharing room/edits/enemies, fresh guest recovery, no console errors, production
bundle and remote deployment check. Physical headset test is a separate required
acceptance item. The diagnostic harness under multiplayer/tests is engineering
scaffolding, not the intended visual design.
