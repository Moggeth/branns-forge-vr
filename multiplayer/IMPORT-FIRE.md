# Browser fire import — functional handoff (2026-10-03)

Wyrmspout is slot7; hold Attack/right trigger to fire, Q/right mouse/left trigger to vent after release. Emberdew is slot8; Attack tosses a fuel bottle, Special toggles its wick. Touch uses the existing Attack/Special buttons. VR left squeeze now cycles all seven equipment items (held bone excluded).

The authoritative shared field has at most256 half-metre fuel cells and32 surface patches. Packets use the existing host-validated swept triangle contacts, so flame never becomes an embedded arrow or damages an enemy through a guessed whole-body box. Liquid flows conservatively between already wetted downhill cells. Burning neighbours, forge hearth, Wyrmspout, lightning and Starfall ignite the same fuel. Healing Rain/Frost quench and impose5s wetness. Damage is capped per actor per half-second, independent of overlapping cells. Wyrmspout overheats after roughly8s continuous firing and recovers after3s. Checkpoints validate and preserve all new fields.

Sonnet's fire presentation uses at most4 draws,768 instances and3 pooled shadowless lights following fire groups. The imported native Wyrmspout keeps its grip/Muzzle sockets, -Z forward, original geometry and five embedded maps (repacked512px,2,091,464bytes). Its native88KB flame loop is reused; deployment copies wav assets. The source Emberdew builder remains portable Three.js geometry, not yet a separately exported GLB.

## Verification

- `node tests/fire.mjs`: passed0.014s. Ignition/spread, quench wetness, fire input rate, overheating/recovery/vent, contact authority, one damage application per actor, caps, corrupt checkpoint rejection, old-save compatibility, deterministic replay, input release/cancellation.
- `node tests/fire-presentation.mjs`: passed0.100s. 96 packets +256 burning cells produce633 of768 instances,4 draws,3 lights;600 updates average0.0575ms CPU (no GPU claim). Unchanged snapshots avoid fuel rebuilds; terrain invalidation rebuilds. Disposal removes all visual objects. Khronos Wyrmspout validation: zero errors.
- Existing combat0.026s, weapon-controller, simulation, combat-session and asset-pose tests passed. Build243ms; only existing bundle-size advisory.
- Actual `tests/fire-playtest.html` browser renderer:15 accepted swept flame contacts,37 ignited cells,3 moving illumination groups. Lit bottle produced16 burning cells; quench removed all flames, leaving liquid. No page errors or shader compile errors (favicon404 only). Ground/RTS screenshots in ignored `logs/fire-ground-reviewed.png` and `logs/fire-rts-reviewed.png`.
- Browser interaction/capture batch5.039s; bottle/quench/build/cleanup batch6.272s. Initial Playwright help2.858s returned help but exited with Node24 UV assertion; subsequent CLI browser commands worked. Stale refs after Vite HMR require fresh snapshot, not repeated clicks. Initial test runner `tests/run.mjs` failed fast because gateway8090 was intentionally absent; isolated simulation/combat-session suites are the correct bounded checks here.

## Visual follow-up / limitations

Opus refinement is underway separately. Current fire is functionally accepted, not final art acceptance: bright overlapping tongues/fuel need better colour balance. Fixed sparse fuel mesh border coverage so interpolation reaches zero rather than ending at square simulation-cell edges; preserved shader-driven irregular edge. Added soft flame-base alpha to hide horizontal sprite cutoff. Fuel participates in renderer tone mapping. Do not lose these fixes when integrating refinement.

No physical headset/phone acceptance or internet two-player trial in this subtask. Terrain fields use shared ground height; no general volumetric fluid, burning-tree propagation or multiplayer spatial fire audio. Flame audio is a single local held-weapon loop. Remote weapons are still existing generic hero representation. Keep public deployment held until artist refinement review if quality requires it.

Tree integration hooks added at coordinator request: all held-item VR checks accept `looseLogs`; grab first consults optional `content.grabTarget`; content.tick receives snapshot.tick as second argument. No changes to tree source/world-content or shared simulation were made by this worker.
