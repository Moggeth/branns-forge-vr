# Browser import wave 1 — 2026-10-02

This is an intentional port of a connected harvest/build/fight loop. Existing
native files remain unchanged. The earlier curation register is historical;
this wave expands it at the user's explicit request.

## Imported and connected

- `weapon-motion.js` ports the native `godot/desktop_weapon_pose.gd` axe/pick
  Hermite tip trajectories, anticipation, contact, wrist lag, follow-through,
  recovery and subtle idle motion. Blade/handle planes use the canonical asset
  axes; contact occurs halfway through the swing. Camera is never shaken.
- Stonewhisper GLB, authored grip and striking-tip sockets. Orchard's Edge remains.
- Three authored apple-tree variants. Trees retain their trunk origin rather
  than being recentered on an asymmetric canopy. Three nearby-height axe cuts
  leave staged authored wedges, then the crown hinges at the cut and leaves a
  clipped stump/endcap. Moving to a substantially different height restarts cuts.
- Wood pickups, 3-wood bridges with shared walkable decks, 3-hit stone deposits,
  5-hit Starfall meteorite deposits yielding gems, explicit collection and
  apples restoring 35 HP. Resources, cuts, deposits and bridges survive saves.
- Seven God spells: existing four plus point-targeted Sunder, Wall and Tree Ring.
  Tree Ring grows eight trees. New terrain edits share collision-height logic.
- Contact raycast against rendered enemy/tree/ore meshes; exact misses never
  fall through to a different target's cone. Host validates identity, distance,
  facing, tool, point envelope and cooldown. It is not a server triangle replay.
- Authored skeleton attack/stagger clips; 18-tick attack wind-up, damage at
  contact time if still in reach, and interruptible wind-up when struck.
- Authored impact chips, bounded 96-instance debris pool, short wood/stone audio
  and controller haptic hooks. Audio starts only after a user gesture.
- Meadow albedo/normal/roughness maps, ten instanced clutter families, five
  geological/root formations, shared image-based material lighting. Decorative
  instance matrices rebuild on terrain change rather than every snapshot.

27 new source files (11.93 MB) are enumerated with source paths and SHA256 in
[the asset provenance manifest](public/assets/import-wave-1.json). These are
existing specialist-authored assets, not a new Codex art replacement. Collider-only
GLB nodes are excluded from the bridge presentation; its deck origin is authored Y=0.

## Controls

Hero: WASD, mouse look, Space jump, left click swing. **1 axe / 2 pick**, **E
collect/eat**, **B build bridge (3 wood)**. Esc releases cursor; Menu controls
are unchanged. Touch has corresponding equipment/collect/build buttons plus
Move/Look sticks, Attack and Jump. Standard XR: right trigger strikes along its
pointer, left squeeze switches tool, right squeeze collects/eats, right stick
click builds, A/X jumps and B/Y exits to menu.

God: existing pan/orbit/zoom; 1–7 select spells, click terrain to cast. Touch
spell tray plus Cast; no change to the deliberate aim-then-cast behavior.

## Verification

- `node tests/weapon-motion.mjs`: exact tip contact and endpoints, diagonal
  top-right to bottom-left contact velocity, continuous phase joins.
- `node tests/asset-pose.mjs`: canonical axes, sockets, XR/desktop reattachment.
- `node tests/world-content.mjs`: tools, harvest, resources, saving, invalid
  checkpoints, all new spells and atomic capacity rejection.
- Existing simulation, session/migration, saves, touch-input and signaling tests.
- `tests/import-playtest.html`: real renderer and GLB raycasts, three tree
  strikes -> wood -> bridge, then three pick strikes -> ore -> stone. Passed.
- `tests/mobile-playtest.html`: thirteen synthetic input assertions passed in
  3.891 seconds; inspected 360x640 and 640x360 layouts. Physical phones/VR pending.
- `node tests/import-performance.mjs`: bounded worst-content CPU scenario,
  8 players / 64 enemies / 64 edits / 64 groves / 256 harvested trees /
  80 deposits / 256 pickups / 32 bridges. 3,600 ticks + 20 Hz snapshots:
  836.8383 ms total; p95 .5162 ms, p99 .6268 ms, max 1.9377 ms;
  snapshot 64,512 bytes. This excludes rendering, network and headset performance.

## Deliberate limits

This is not the entire native game. Bows/crossbows and embedded arrows, bone
severing/ragdolls, physical grabbing/throwing, flame propagation, full native
terrain/hydrology/planet, quests, Bran's AI backend and general construction
remain native-only. Gems are collectible but do not yet fuel a browser spell.
Pickups bob for accessible collection; they are not rigid bodies. Falling crowns
are animation, not physics bodies, and trees/rocks do not yet block locomotion.
Sunder/Wall are initial point-targeted short formations, not the full native
freehand spline operators. VR uses pointer-trigger strikes, not velocity-based
physical swing contacts. Imported content saves are compatible with older base
worlds, but all room participants should refresh before playing this release.
