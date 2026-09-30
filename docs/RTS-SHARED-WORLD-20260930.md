# Shared-world RTS integration — 2026-09-30

This implements the firm early priorities of the September 30 shared-world brief: Mana/casting, manually placed traversal structures, existing-tree Ents and bounded encounter progression. It incorporates the later outpost/golem/weather/talent directions without presenting them as completed features. Meteor Menagerie creatures remain candidates for review.

[Controls and current behavior](WORLD-BUILDER.md) and [ordered development direction](RTS-SHARED-WORLD-DIRECTION.md) are the current handoff. Select World Builder in the persistent launcher and relaunch normally. No live game, SteamVR session, service or player save was changed during verification.

## Division of work and preserved sources

Three GPT-6 Sol streams owned disjoint Mana/save/catalogue, construction/navigation, and Ent/encounter systems. Codex integrated native UI, shared heat/combat, seed handling, runtime state, diagnostics and visual review. Claude commissions ran serially in isolated work folders with Anthropic/API overrides removed from the child environment.

Every commission verified personal `fauxgrady@gmail.com`, `authMethod: claude.ai`, active Pro subscription and explicit actual model metadata. No metered API fallback or alternate account was used.

| Commission | Actual model | Measured process seconds | Outcome |
| --- | --- | ---: | --- |
| Native command panel | claude-opus-5-5 | 192.946 | Integrated; illustrated atlas supplied separately |
| First Ent presentation | claude-sonnet-5-5 | 142.676 | Reviewed; replaced by the refined version |
| Timber construction presentation | claude-sonnet-5-5 | 136.245 | Integrated with winding/support corrections |
| Ent visual refinement | claude-sonnet-5-5 | 347.360 | Final source independently verified; runner deadline failed |

Editable briefs, deliverables, handoffs, review references and verification metadata are preserved in `assets/source-commissions/rts-20260930/`. Production files in `godot/` contain integration fixes beyond those original drafts. Full Claude streams and launcher scripts remain ignored. The integrated icon atlas is a 4×6, 1024×1536 image generated through the built-in image tool in 59.5 seconds; calm/seed reuse existing category silhouettes.

The refinement runner reported a timeout because terminating `claude.cmd` did not terminate its descendant Node process. The actual session finished and produced valid source, which was parsed, rendered, reviewed and tested. This is **not** a clean deadline-controlled runner result. Future bounded commissions must terminate the specifically identified process tree or use a Windows Job Object; do not reuse that wrapper timeout as proof the child stopped.

## Verification evidence

All final engine checks reported empty failure arrays and no script/engine errors. Logs and measured material steps remain in ignored `logs/work-timing.csv` and `logs/rts-final-*.log`.

| Check | Result | Process seconds |
| --- | --- | ---: |
| Full shared-world scene/save/worker/patrol integration | WORLD_BUILDER_RESULT failures=[] | 7.782 |
| Panel, 25-entry catalogue, palettes, seed shortcut, costs, repeat/cancel, native layout, avatar culling | COMMAND_PANEL_RESULT failures=[] | 6.969 |
| Ent activation/combat, calm fruit healing, physical log, seed pickup/planting, shared fire/water, bounded persistence | WORLD_BUILDER_ENTS_RESULT failures=[] | 7.503 |
| Shared fairy flame contacts and liquid ignition | 18 checks, failures=[] | 7.233 |
| Mana/legacy file migration/spell state | failures=[]; deliberately malformed save preserved | 0.611 earlier final fixture |
| Encounter whole-number JSON restore/reward replay | focused/full builder fixtures pass | 0.252 / 6.923 |
| Free construction collision, grounded support, mesh budget and true worker crossing | focused/live fixtures pass | 0.455 / 7.679 |
| Native imported-atlas panel captures at 960×620, 1920×1080, 3840×2160 | Three PNGs inspected, failures=[] | 1.813 |
| Native installed Ent/bridge/stairs art review with live -Z facing | Seven PNGs inspected, failures=[] | 2.000 |
| Godot editor import of new resources/UIDs | Clean import | 4.447 |
| Service and tuning tests | 15 tests pass | 0.282 |

The headless scene checks instantiate the actual Main/World Builder and use disposable state. The seven art captures use the production visual modules and a deterministic choppable TreeKit tree, but an isolated stage rather than the full Orchard. They prove mesh/material/facing fit, not landscape composition or HMD comfort.

Ent art adds 1,314 triangles, 14 surfaces and a bounded 30-particle emitter per reference creature; original tree geometry is additional. Live Ent cap is eight. Free construction uses six surfaces per structure, with 6,924 triangles for a maximum-length boardwalk; structures cap at 32. The panel uses the existing capped secondary viewport. These are measured geometry/cap bounds, **not** a VR performance benchmark. The renderer review used Godot's Forward Mobile/Vulkan on the RTX 3080 Ti.

Captures: `outputs/worldbuilder-panel/panel-*.png`; `outputs/worldbuilder-art/apple-ent-*.png`, `timber-bridge-*.png` and `timber-stairs.png`. They are generated outputs, not committed binary fixtures. Rebuild commands are in WORLD-BUILDER.md.

## Failed strategies and faster paths

- Procedural face winding initially opposed stored normals. Compare triangle cross products against normals before rendering; Godot's visible-front winding is clockwise.
- The first Ent review tree lacked `choppable:true`, so it had no production `Trunk`. The presentation used its large Crown fallback and appeared disconnected. Match the actual TreeAdapter fixture, and convert Trunk coordinates into presentation space when the live layer is rotated PI.
- The first face treatment had floating-looking pieces. Sonnet's second pass uses trunk-fitted relief, recessed eyes, joint knots and connected limbs. Burning eye tint takes priority over calm tint; only eye materials are per-instance.
- The first broad fire regression used `--world-builder-check` without enabling fluid. It failed on a nil field and lacked a watchdog; only its verified diagnostic processes were stopped after 151.553 seconds. The fixture now fails fast and has a 45-second watchdog. Correct command:
  `Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://fairy_heat_checks.gd -- --world-builder-check --experimental-fuel-combat`.
- JSON parses saved integers as floats. Persistence validators must accept finite integral values of either numeric type while rejecting fractions/nonfinite/out-of-range values. Encounter kill order and reward history now test the actual JSON round trip.
- Keep every palette at nine or fewer cards. Moving Hire Helper to Life prevents an unreachable tenth Construction action.
- Import/preload the icon texture normally; direct `Image.load_from_file(res://...)` is unsuitable for exported resource packaging.
- Search `rg --files` before naming modules. Actual paths include `adventure_runtime.gd`, `landscape_operations.gd` and `docs/CONSTRUCTION-VERIFICATION.md`. Repeated guessed-path failures in this run did not provide useful evidence.
- Wait for ownership handoffs before compiling dependent scripts. Headless return-to-Hero closes immediately; a frozen diagnostic should not wait on a presentation animation.

## Remaining acceptance and next work

1. Play simultaneous VR + builder on Vive Pro 2: crossing collision, avatar readability, Ent melee/fruit/seed handling, repeated commands and frame time. Automated checks do not establish physical comfort.
2. Supply outposts with explicit delivery/storage/pickup/recovery, then towers/platforms/gates/barricades. Never turn these into map-only decorations.
3. Component golem assembly from recognisable physical timber/stone/metal/heart, with composition and both-player repair/ride roles.
4. Purposeful weather bottles: rain for water/fire/soil, sunlight for a ruin or expedition, frost for a crossing/machinery problem. Shared rules already quench Ents; these objective loops are not implemented.
5. Review Orbit Wisp / Starmaw first; Geode Hopper / Cinder Tortoise remain alternatives. No meteor creature is claimed playable.
6. Talents and remote sessions after the current local-world interactions are solid.

Known limits: later terraforming can bury/expose fixed-height decks; navigation stops using inaccessible routes but construction does not repair itself. Ground navigation is terrain/deck grid steering, not a full scenery navmesh. Ordinary skeleton XP/loot still repeat. Loose physics fruit/logs/seeds are session objects; claimed seed state and planted trees persist. Newly planted apple trees need fuller fruit-runtime registration. Wider forest combustion and charred regrowth are future persistence work.
