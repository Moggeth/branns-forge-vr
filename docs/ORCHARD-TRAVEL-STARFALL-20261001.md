# Travel, living Orchard and Starfall — 2026-10-01

This pass implements the navigation, terrain-safety, resource-clarity, crystal,
Starfall and idle-creature playtest request. Use the ordinary **Brann's Forge
Launcher** and relaunch when ready. The existing game, SteamVR and forge service
were left running; diagnostic scenes used the offline save-isolated paths.

## Navigation and resources

- **F** selects the next destination and updates an explicit target in the Hero
  HUD. **G** travels to that selected destination. Selection alone never travels.
- **M** opens a Map folio with a direct destination list, selected-region details
  and a Travel action. **I** opens its Supplies page; Escape closes the folio.
- Hero, Little Wing and the World Builder have view-owned folios. A companion's
  Map does not stop the Hero. A Hero-primary Map blocks Hero motion, melee,
  bow drawing and flamethrower firing until it closes.
- In VR, **B → Supplies** provides a physical paginated wallet, item and cost
  guide. The checked scene produced 13 pages and 74 rows. Its labels refresh
  from live state without rebuilding interaction colliders.
- Supplies explains item purposes, actual primary/alternate controls, equipment
  state, costs and availability. It distinguishes cost, cooldown, phase, locked
  tier and placement restrictions. Geometry-dependent construction costs remain
  estimates until the placement preview resolves the actual length.

Balances retain their existing authorities:

| Ledger | Shared with | Distinctions shown |
| --- | --- | --- |
| Hero pouch / Brann workshop | FPS and VR Hero; service player state | All resource counts, plus separately located reserved/loose/held workshop pieces. These locations must not be added as independent wallets. |
| Orchard settlement | Hero mining/gathering interactions and World Builder | Mana, stockpile lumber, star gems, star iron and seeds. Hero lumber and ordinary crystal are different resources. |
| Little Wing | Fairy controls | Health and ability timers; no invented money wallet. Carrying a prop uses the actual shared object. |
| Director round | War Director | Sparks, phase and independent card cooldowns; separate from settlement Mana. |

The guide samples the installed game and service snapshot at no more than 5 Hz.
It makes no purchases or additional service requests. Offline Hero balances show
an unavailable state rather than fictional zeroes. Siegebird bolts and Emberwing
arrows remain unlimited; the crossbow's loaded chamber is still a physical state.
The legacy bolt rack's stock counter is not presented as consumable ammunition.
See [the source economy audit](RESOURCE-AUDIT-20261001.md).

## Terrain-aware arrival and movement

Travel and recovery sample the current Orchard heightfield and require a matching
physics surface plus capsule clearance, including the real HMD X/Z offset.
A collider more than 0.22 m from the authoritative terrain cannot certify an old
floor. Travel retries the asynchronous collider handoff and leaves the original
zone and pose intact if no supported clear landing exists.

Desktop walking supports a 0.42 m step and a 0.68 upward normal, about 47 degrees.
Small terrain engulfments use a bounded supported escape; genuine ravines still
drop the player under gravity. Walking remains constrained by steps, while
teleport/grapple destinations use landing clearance without applying the walk
step limit. Equipment recovery preserves held objects and moves obstructing loose
tools away from the chosen spawn.

The checks cover raised arrival (+7.5 m), a 40-degree incline, a pending stale
collider, a real crater drop, unsupported travel, equipment and an HMD-offset
obstacle. See [terrain safety](TERRAIN-SAFETY-20261001.md) and
[travel ownership checks](TRAVEL-NAVIGATION-CHECKS-20261001.md). Physical room-scale
comfort and headset legibility still need a playtest.

## Crystals and Starfall

Sonnet 5.5 authored and refined asymmetric bevelled crystal families and the
event presentation. Meteor gems and Crystal Fault spires use faceted cyan/violet
materials, darker interiors, thin luminous veins, edge highlights and warm heat
response. Internal depth is a shader approximation: the crystals are opaque,
avoiding transparent sorting and expensive scene refraction.

The shared art cache contains four meteor and six fault meshes, each a single
surface with 308–812 triangles, two materials and one crystal shader. It warms
at world setup. Three nearest shadowless crystal lights illuminate nearby terrain;
there is no light per crystal. Fault dressing retains its terrain anchoring,
growth animation and undo path, and meteor decoration preserves vein IDs and
saved mining rewards.

Starfall has a moving entry light/trail, contact flash, directional spall, earth
chips, irregular dust and a crystal reveal/settling phase. The generic impact
sphere is removed. Two pooled temporary lights, four particle MultiMeshes and
six reusable event slots bound the visual cost. Entry, impact and crystal chime
have spatial sound and six shared audio voices. Nearby VR controllers receive
bounded haptics; there is no forced camera shake.

On contact the authoritative crater and affected terrain mesh/collider are
assigned in the same callback. Godot exposes the new collider to physics queries
by the next physics frame. The meteor settles against the actual crater bed,
not a guessed fixed sink distance. Reload preserves its resting height, remaining
vein rewards and mining scar. The authored effect source consumes visual-event
signals; it never changes terrain, damage, resources or collision itself.

The old ten-meteor cap is gone. The durable ledger accepts 256 records within
the existing 256-operation terrain journal and 2 MiB world-save ceiling. Other
terrain operations share that journal, so the practical impact count can be
lower. Unmined value is never evicted to make room. Up to 20 nearest landed rocks
within 52 m have detailed mineable nodes/colliders; far rocks use one batched core
representation. Four meteor descents run concurrently, with later in-flight
records queued. This is a bounded scale architecture, not unlimited full-detail
simulation. See [scaling](STARFALL-SCALING-20261001.md).

## Living creatures

Awakened Ents and living skeletons rest for seeded 12–29 second pauses, then make
short local walks or turns. Hostility immediately interrupts that behaviour.
Orchard routes use its navigation grid and reject blocked/wet destinations;
terrain edits cancel stale routes. Other regions check support and grade.
Hidden zones remain dormant. Ent heading/displacement survives the existing
bounded save record without replacing the original tree or its collision.
See [behaviour and scene checks](CREATURE-IDLE-WANDER-20261001.md).

## Authored source and commissions

Each Claude commission used a cleaned child environment and verified personal
`fauxgrady@gmail.com`, `authMethod: claude.ai`, active Pro subscription, and exact
model metadata. No API billing or extra-usage credential was used. Source and
session handoffs remain in the ignored isolated `work/` folders; integrated
source is versioned under `godot/`.

| Commission | Actual model | Measured seconds | Outcome |
| --- | --- | ---: | --- |
| `work/opus-travel-guide-20261001` | `claude-opus-5-5` initialization verified | 480.338 | Timed out without a deliverable; not accepted as completed design. |
| `work/opus-travel-guide-delivery-20261001` | `claude-opus-5-5` initialization/final verified | 128.105 | Concrete native Map/Supplies implementation and handoff; integrated and corrected responsive fit. |
| `work/sonnet-starfall-crystal-events-20261001` | `claude-sonnet-5-5` initialization/final verified | 642.970 | Crystal mesh/material families and bounded event presentation. |
| `work/sonnet-starfall-crystal-refine-20261001` | `claude-sonnet-5-5` initialization/final verified | 64.285 | Review-driven subtler veins/interiors, broken spall and denser dust. |

The artist owns `starfall_crystal_art.gd` and `starfall_event_art.gd`; the gameplay
adapter is `starfall_presentation.gd`. `starfall_visual_review.gd` provides the
repeatable native render/measurement harness. The deterministic world, save,
physics, navigation and resource authority remain gameplay-owned.

## Verification and measured limits

All named fixture results are empty failure arrays, with no script errors in
their final logs. These timings are measured, not estimates:

| Check | Outcome | Seconds |
| --- | --- | ---: |
| Co-op Map ownership | Hero, Fairy, strategic and Hero-primary gates; cleanup | 8.844 |
| Supplies toolbelt | 13 pages, 74 populated rows | 8.272 |
| Resource guide | Four wallets, 22 items, 35 costs; controls/reasons | 9.700 |
| Creature scene | Actual Ent/skeleton movement, animation and restore | 8.900 |
| Final Starfall presentation | Moving light, pooled budgets, seating, mining/save | 8.938 |
| Final 128-record scale check | Save/reload, near/far swaps, scar and crater | 7.964 |
| Final native dual-view review | 20 ground/survey captures and timed windows | 18.211 |
| Final resource import | Clean completion | 4.397 |

The last scale check measured a 1.312 ms 128-record visibility refresh and
12.489 ms full impact callback (including terrain collision replacement).
That impact can exceed a 120 Hz frame budget; no claim of hitch-free headset
terrain creation is made.

The final native GPU review used two 1280×800 desktop Vulkan views. Idle versus
six simultaneous impact effects measured CPU p95 **0.04 / 1.21 ms**, Hero-view
GPU p95 **1.70 / 1.76 ms**, and survey GPU p95 **0.92 / 0.99 ms**. The fixture
pauses general Main gameplay to isolate presentation; those CPU figures cover
the effects adapter, not full-game frame time. Readbacks run outside the timed
windows. These results do not establish 4K, HMD stereo, overall 120 fps gameplay
or physical-controller feel.

Native captures and their report are under `outputs/starfall-review/`; responsive
Map/Supplies captures at 960×620, 1920×1080 and 3840×2160 are under
`outputs/travel-guide-review/`. Outputs, routine logs and caches remain ignored.

Run focused checks from the repository root:

```powershell
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://travel_navigation_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://resource_guide_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://supplies_toolbelt_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://starfall_presentation_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://starfall_scaling_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://starfall_visual_review.gd -- --world-builder-check --landscape-seed=290929
```

The last command requires native GPU rendering, not headless mode. Its window is
offscreen and unfocusable but remains visible so viewports keep rendering. For
new diagnostic logs, use an absolute `--log-file` path. See
[verification lessons](VERIFICATION.md) before repeating a costly operation.

Runtime state remains under Godot's `user://` directory (normally
`%APPDATA%/Godot/app_userdata/Brann's Forge VR/`). Orchard settlement uses
`world_builder_v1.json`; the terrain modification journal and service-owned
Hero state retain their existing save locations. Start/stop and game/service
logs remain exposed by the [launcher](../launcher/README.md). No new background
service, publishing step or resident-save rewrite was introduced by these checks.
