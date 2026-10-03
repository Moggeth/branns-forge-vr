# Invention art handoff (2026-10-03)

`invention-art.js` — only dependency `three`. Procedural, +Y up, -Z forward, metres, base at y=0.

## API
- `createInventionModel(type)` → `THREE.Group` (`userData.parts`, `userData.state`, plus `launchHeight` 1.3 for timberline/launcher, `hopperHeight` 1.2 for forgeRefinery, `deckHeight` 3 for watchtower).
- `animateInventionModel(root, {time, fireAge, damage, progress, active, yaw, open, charge, armed})` — call each frame with monotonic `time` (seconds). `fireAge` = seconds since last shot (omit/Infinity = idle). Stateful smoothing (gate, trap) uses `time` deltas.
- `disposeInventionArt()` — disposes shared materials/geometries; models created afterwards rebuild them.
- Extras: `INVENTION_TYPES`, `countInventionMeshes(root)`.

## Mesh counts (measured with smoke.mjs, three from multiplayer/node_modules)
| type | meshes | notes |
|---|---|---|
| storehouse | 26 | open shelter, strapped crate stacks, barrels, sacks |
| loggingYard | 30 | rollers, moving log, spinning saw, flywheel |
| prospector | 22 | survey desk, tripod scope (sweeps), ore bench |
| sanctuary | 24 | basin, water, floating crystal, 6 columns + lintels |
| barracks | 26 | timber hall, door, shield, spear rack |
| watchtower | 27 | deck top y=3, 2.3 m square; ramp x=0, z 1.15→5.2; rear rail gap ±0.55 |
| palisade | 27 | gate on -Z, two leaves hinge by `open` (0..1) |
| launcher | 24 | arm pivot y=1.3; `charge` winds, `fireAge` swings toward -Z, stone hidden in flight |
| ward | 14 | crystal + rotating brass rings |
| trap | 23 | `armed=false` snaps closed fast, rearms slowly |
| influence | 15 | obelisk, floating crystal |
| forgeRefinery | 15 | hopper lip y=1.2, ember door, ingot tray (ingots by `progress`) |
| timberline | 61 | swivel (`yaw`), twin bolts on load rails, flexing limbs, live strings, recoil kick, windlass, filament between bolt tips |

## Timberline contract
`yaw` rotates the carriage; launch line ~y=1.3, bolts point -Z. On `fireAge` 0–0.6 bolts hidden and cradle recoils (damped spring), 0.6–1.2 bolts slide back in as limbs redraw scaled by `progress`.

## Caveats
- Not visually reviewed in a renderer; only executed in Node (bounds/counts). Inspect in the game before accepting.
- Transparency used only on the timberline filament; emissive on crystals/ember. No lights.
- Minor sub-ground extents: watchtower ramp end (-0.09), loggingYard flywheel (-0.04).
