# Physical invention and conflict pass — 2026-10-03

Active implementation of the user's permanent-forge direction. All twelve structure roles, storage, refining, Timberline and counterplay are the intended acceptance scope; this document records verified increments, not a blanket completion claim.

## Foundation
- Shared terrain protects the forge's four-metre apron with a smooth outer blend; terrain beyond seven metres remains deformable.
- Forge no longer takes melee damage or remains disabled. New buildings will carry siege risk instead.
- Wood stays one resource. Added Iron, Mithril, Star metal and raw ore; legacy gems is the Crystal wire key. Starting seams, characteristic skeleton scrap and geological emergence supply materials.
- Meteor drops retain Crystal needed by existing Expedition quests alongside Star ore; awakened creatures pay triple both. No existing quest is stranded by the new vocabulary.
- Inventory and deposit/pickup recovery validate the new finite types and preserve older saves. New ore is collectible and visually tinted with its material colour.

## Measured steps
- Initial repository/status inspection: 0.210 s; fetch/divergence and source discovery: 2.124 s, main synchronized to private origin.
- First two Opus attempts: OAuth refresh contention, 8.827 s / 8.397 s. No account/billing fallback. Sequential retry after independent work succeeded; reuse existing retry path, never kill unrelated Claude sessions.
- Opus workshop design: 254.796 s, fauxgrady@gmail.com claude.ai Pro, actual and final claude-opus-5-5 verified. Isolated source work/opus-invention-workshop-20261003.
- Material/forge foundation tests and syntax: 0.261 s, passed.

## Remaining integration/acceptance
Structure authority, authored views, workshop controls, VR wrist mapping, physical refining, host/save parity, browser mobile/desktop and hosted verification. Physical phone and HMD acceptance cannot be inferred from emulation.

## Authority milestone
Implemented the twelve structure jobs plus destructible God Influence. Side-owned stores auto-pay affordable recipes; quick ore jobs produce owned physical tray metal. VR ore holding/hopper release and convenient collect-output use the same saved jobs. Timberline pays Wood/Iron, has turning/loading limits, bounded paired-shot corridors and delayed tree cascades, severs golem arms, and stops at terrain/rocks/structures. Launcher reserves deformation capacity alongside pending meteors. Sanctuary rally, tower ramp, gate, wards, traps, logging collection, defenders, distant returning camps and quiet-interval assaults run on the host. New ore worker assignments give solo Gods an economic route. Shared collection cues reject the opposing side's metal.

Verification: 14 authority integration regressions passed (0.187 s test body, 0.552 s command bundle), including all placeable types, saved refining/held ore, Timberline limbs/logs, God-only structure combat and solo ore workers. Existing enemy behaviour 10 tests passed; worst tested 8-player/64-enemy/64-edit simulation 2.764 ms/tick (whole batch 2.017 s including portable save tests).

Art: first replacement Opus high-effort attempt timed out after 720.376 s, with ~66k reported thinking tokens but no output. Narrowed brief requiring the first file immediately, low effort, explicit model unchanged: delivered 13 models in 210.619 s. Personal claude.ai Pro account and init/final claude-opus-5-5 verified. Mesh counts 14–30 ordinary models, 61 Timberline; runtime renderer gallery reviewed. UI commission previously passed 254.796 s. Source contracts will be retained with integration.

Learning: Windows Python writes must always specify UTF-8, and read/modify/write via text rather than raw bytes retaining CRLF. A cp1252 encode failure truncated the owned lobby file; recovered from HEAD and reapplied only this task's integration, then syntax checked. Never mix repo-relative paths with multiplayer cwd: use repo cwd for edits and npm --prefix multiplayer for builds. Two failed runs repeated this mistake (0.960 s build bundle plus earlier 0.216 s); no files changed in those failed edits. Browser tests must use visible touch menu [data-touch-action="menu"], not the hidden desktop #menuButton. Workshop is Menu > Manage the forge on phones; the palette's forge control is intentionally hidden until opened. Timed-out selector checks were harness errors, not permission bypasses; actual user flow is now tested.

## Integrated presentation and controls
Opus runtime art is in client/invention-art.js; workshop design in invention-panel.js/css. Briefs, handoffs and verified account/model/duration metadata are retained in assets/source/physical-inventions. Actual gallery review and phone sheet review completed. Mesh counts are budgeted; no extra asset downloads. Root supplies authoritative progress, gate/trap states, finite ward ground ring, launched paired bolts/stone, existing material audio, and destruction state. Existing quiet HUD is unchanged; workshop is modal only.

Local actual-UI browser run passed in 11.720 s: imported a disclosed stocked QA world, clicked Refine, waited for real metal, collected output, placed Storehouse by ground tap, checked phone workshop and console. First site was correctly rejected near trees; a clear site succeeded. Two independent browser clients shared the world, expedition start and a God terrain cast in 12.246 s. Responsive sheet/gallery tests took 2.608 s combined. Production build plus dependency check passed in 1.281 s (119 modules; existing bundle-size warning remains).

Existing interaction text tests needed new Wood/resource-purpose expectations; VR source-wiring assertion needed the new placement/aim interception while preserving ordinary quest callbacks. 21 VR panel and 24 interaction cue checks passed in the 0.734 s command bundle; no behavioural test removed. UI automation initially selected a desktop Forge button behind the mobile menu; use #menu [data-open-forge] after [data-touch-action="menu"]. Never force-click obscured controls. Root README contains historical non-UTF-8 bytes; preserve its body as bytes when adding a short current handoff, rather than assuming UTF-8 and rewriting unrelated text.

Practical limits: physical HMD/phone comfort and separate-network acceptance still require playtesting. Procedural buildings are intentionally modest in mesh count; damage is readable tilt/collapse rather than fully simulated debris. Machine targeting is a ground aim with bounded turning actions, not a seated articulated gunner rig. Balance and art detail remain iterative. Saves from older versions gain the new economy; refresh all peers together for changed host rules. Legacy forge upgrade buttons are replaced by physical structures; older test scenarios expecting destructible central forge/legacy stock are superseded by the new authority tests.

## Hosting and reconnect checkpoint (2026-10-03 05:22 UTC)
- Source 9f0405d deployed to the public Vercel alias; deployment took 15.522 s. The hosted build loaded, but public room creation failed because the previous Quick Tunnel hostname no longer resolves. No original peer on 8789 or cloudflared process was present. This is a hosting outage, not a successful multiplayer acceptance.
- Replacement peer/tunnel launch was rejected by automatic approval review (`blocked by policy`), including after the user explicitly approved restoring multiplayer hosting. Do not retry through an alternate execution mechanism to bypass this boundary. Recovery instructions remain in multiplayer/PEER-PLAYTEST.md; a permitted environment must start the service/tunnel and rebuild with its new URL.
- Found and fixed the reconnect pack whitelist: it now uses all nine material keys. Full pickup-cap regression verifies metals and ores remain parked and restore without loss or duplication. Eight real WorldSession reload/migration/codec checks passed (112.068 ms test duration; edit/check command 0.362 s).
- Local two-client and touch workshop verification passed before deployment. Physical phone, headset, separate-network connectivity, and public multiplayer with the repaired tunnel remain unverified.
