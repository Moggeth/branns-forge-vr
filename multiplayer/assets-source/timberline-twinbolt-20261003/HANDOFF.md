# Timberline twin-bolt ballista: integration handoff

This is a self-contained asset kit, not yet wired into the game. Nothing under `godot/`, `service/`, `multiplayer/` gameplay, networking or production assets was touched. It was built from the brief and the three reference images only; the existing in-game Timberline was not examined.

## What is here

| Path | Contents |
|---|---|
| `out/timberline_ballista.glb` | Machine: textured, LOD0 and LOD1, clips `Idle_Loaded`, `Fire`, `Reload`, `Unloaded`; sockets; contract in root extras |
| `out/timberline_bolts.glb` | Projectile pair `Bolt_L` and `Bolt_R` (mirrored), clips `Folded`, `Deploy`, `Impact`. No filament is baked in. |
| `out/timberline_collision.glb` | Box and cylinder proxies named `COL_*`, parented to pivots with the same names as the visual ones |
| `out/timberline_contract.json` | Axes, pivots, sockets, event times, offsets (the same JSON is in the ballista root's `extras.timberline`) |
| `out/timberline_source.blend` | Editable Blender 4.5 scene produced by the build |
| `source/build_timberline.py`, `source/textures.py` | The whole model, rig, clips and textures as code |
| `runtime/*.js` | Three.js presentation controllers plus pure gameplay logic (see below) |
| `preview/` | Standalone preview: load, aim, fire, deploy, reload, camera views, sockets and collision overlay |
| `tests/timberline-check.mjs` | 9 mechanical checks of the GLBs, contract, flight model and sim |
| `renders/` | Front, side, overhead, 3/4, back, unloaded, aimed, gameplay distances, contact sheets, `timberline_fire_preview.gif` and `.webp` |

## Conventions

- **Units and axes.** Metres, +Y up, **−Z forward**, +X right. This is the three.js and glTF convention. Blender source uses +Y forward and +Z up, and the exporter converts.
- **Ballista origin.** Ground centre under the traverse axis. The footprint is about 2.1 × 2.1 m, and the machine is about 1.4 m tall at rest.
- **Rest pose is loaded.** If you skip the mixer, the machine still shows bolts on the rails.

### Pivots (animate these procedurally; no clip touches them)

| Node | Axis | Range |
|---|---|---|
| `Traverse` | local +Y (yaw) | unlimited |
| `Elevation` | local +X (pitch, positive = muzzle up) | −8° to +25° |

### Pivots driven by clips

`CarriageShake`, `Recoil`, `Limb_*`, `String_*` (unit cord, scaled on Y), `Sled_*`/`Claw_*`, `Cable_*`, `Drum`, `Crank` (22:9 gear, ratio 2.44), `Pawl`, `Trigger`, `LoadedBolt_*` (and their vanes).

### Sockets (empties)

| Socket | Purpose |
|---|---|
| `Socket_Muzzle_L/R` | Bolt heads, forward ends of the rails |
| `Socket_LoadedEye_L/R` | Filament eyes on the loaded bolts |
| `Socket_FilamentHorn` | The spur the loaded filament drapes over |
| `Socket_AimGrip_L/R` | Rear tiller handles (VR hand targets) |
| `Socket_CrankGrip_L/R` | Windlass crank handles |
| `Socket_Trigger` | Trigger bar knob |
| `Socket_OperatorEye` | Suggested first-person camera |
| `Socket_RTSAnchor` | Selection ring and health bar anchor |

### FX points (empties; no particles are baked into meshes)

`FX_Muzzle_L/R`, `FX_StringSnap_L/R`, `FX_FootDust_0..3`, and on each bolt `Bolt_*_FX_Head`.

Bolt nodes: `Bolt_*_Tip`, `Bolt_*_Nock`, `Bolt_*_FilamentEye`, `Bolt_*_VaneUpper/Lower`.

## Timing and events (fits the 4 s cooldown)

| Clip | Length | Events (s) |
|---|---|---|
| `Fire` | 0.75 | `trigger_pull` 0, **`release` 0.05**, `recoil_peak` 0.085, `settled` 0.70 |
| `Reload` | 3.15 | `reload_start` 0, `pawl_release` 0.12, `strings_caught` 0.62, `winding_start` 0.75, `strings_latched` 2.20, `bolts_seat` 2.62, `filament_reset` 2.80, **`reload_complete` 3.15** |
| `Idle_Loaded` | 3.0 (loop) | `pawl_tick` 1.2 |

Projectile timing, measured from release (`runtime/timberline-flight.js`):

| Time | What happens |
|---|---|
| 0.035 s | **fins_deploy**: the vanes flick open (`Deploy` clip; the left vane opens left, the right vane opens right) |
| 0.035–0.26 s | The pair spreads from 0.90 m to 1.12 m between eyes, with an outward yaw of up to 7° |
| 0.26 s | **filament_taut**: a tension spike and a small inward rebound |

Fire (0.75 s) followed by Reload (3.15 s) takes 3.90 s, which is inside the 4.0 s cooldown.

## Runtime modules

Each Three.js module imports only `three` and its siblings. The two pure modules use no Three.js and no DOM, so a server can run them.

- **`timberline-ballista.js`** provides `createTimberlineBallista(gltf, {lodDistance=18, autoReload=true})`.
  - Call `setAim(yaw, pitch)` every frame. It uses a critically damped spring with slew limits; `aimImmediate` snaps.
  - `fire()` returns false unless the machine is loaded. `reload()` is also available.
  - `update(dt, camera, viewportH)` advances the clips, picks the LOD by camera distance and keeps the loaded filament draped over the horn.
  - Events via `on()`:
    - `release` with `{muzzles, eyes, launch: {origin, forward, right, up}}`
    - `empty`, `filament_reset`, `reload_complete`
    - every named clip marker
  - Also provides `socketWorld(name)` and `forceLod`.
- **`timberline-bolts.js`** provides `createTimberlineBoltPair(gltf, {sharedMaterials})`. It runs in one of two modes:
  1. **Self-running:** call `launch(releasePayload)`, then `update(dt, camera, vh)`. Call `impact({point, resistance})` when gameplay reports a hit.
  2. **Gameplay-driven:** call `setState({eyeL, eyeR, forward, up, yawOutDeg, pitchDeg, tension, vaneOpen, bow})` every tick from replicated positions.

  It emits `fins_deploy`, `filament_taut`, `impact` and `expired`. Beyond 14 m the bolts scale up to 2.4× by 42 m (`TIMBERLINE_READABILITY`), so the pair still reads from the RTS camera.
- **`timberline-filament.js`** provides `TimberlineFilament`, a dynamic tube rewritten in place.
  - Setters: `setEndpoints`, `setTension` (0 sags, 1 is straight, values above 1 are tighter), `setLength`, `setVia` (drape point), `setBow(point, depth, dir)`, `pluck()`.
  - It keeps a minimum on-screen width, so the wire never vanishes to sub-pixel.
- **`timberline-fx.js`**: instanced wood chips and dust (`chips(point, normal)`, `dust(point)`), driven from the FX sockets and impact events.
- **`timberline-flight.js`** (pure) contains the pair kinematics.
  - `timberlinePairState(t, launch, cfg, impact)` returns both eye positions, the half spacing, tension, bow, speed scale, vane gate, yaw and pitch.
  - Speed never increases after release, and there is no thrust.
  - `timberlineImpactResponse` covers impacts: the filament bows, the bolts are drawn inward and swing toward the obstruction, and the pair slows hard. It then either cuts through at a reduced speed or stops if resistance is 1.
- **`timberline-sim.js`** (pure) holds the authority-side rules.
  - `createTimberlineMount()` gives `tryFire(now)`, `phase(now)` for late joiners and `restore`.
  - `createTimberlineVolley(launch)` gives `step(dt)` and `strike(resistance)`.
  - `sweepFilament(prevL, prevR, curL, curR, {centre, radius, height})` tests the moving wire against tree cylinders or creature capsules and returns the contact fraction, point and part (`filament`, `bolt_L` or `bolt_R`).
  - `timberlineResistance({kind, radius})` gives default resistances.

## Installing it later (suggested steps)

1. Copy `out/*.glb` and `runtime/` next to the game's other weapon assets. Load them with the plain `GLTFLoader`; no Draco or KTX2 is needed.
2. Authority side: hold one `createTimberlineMount()` per placed ballista. On a fire request, call `tryFire(now)`. If it fires, schedule a volley at `releaseAt` from the mount's launch frame.
   - Step the volley at your tick rate.
   - Each tick, call `sweepFilament` against nearby trees and creatures.
   - On a contact, call `volley.strike(resistance)` and apply your damage or felling rule.
   - Replicate `{lastFire, aim}` for the mount and `{launch, impact}` for each volley.
3. Client side: `createTimberlineBallista(gltf)`.
   - Feed it the replicated aim, and call `fire()` when the authority's fire arrives. Late joiners use `mount.phase(now)` together with `setLoadedImmediate` or `setEmptyImmediate`.
   - On `release`, create a bolt pair (or take one from a pool) with `sharedMaterials: collectMaterials(ballista.object)` and `launch()` it. Forward the authority's impact with `pair.impact({point, resistance, time})`.
   - Spawn chips and dust with `timberline-fx.js` at the returned point.
4. VR: attach hand targets to `Socket_AimGrip_L/R` and map grip yaw and pitch into `setAim`. The crank sockets are there if the game later wants manual cranking.
5. RTS: use `Socket_RTSAnchor` for selection. LOD1 switches in beyond 18 m.
6. Collision: load `timberline_collision.glb`, then re-parent each `COL_*` mesh under the visual node of the same name (as `preview.js` does) so the proxies follow traverse and elevation.

## Budgets (from `out/build_report.json` and `renders/renderer_info.json`)

| Asset | Triangles LOD0 / LOD1 | Materials | GLB |
|---|---|---|---|
| Ballista | 12,118 / 4,104 | 6 shared (`TL_Wood`, `TL_WoodDark`, `TL_Iron`, `TL_Brass`, `TL_Mithril`, `TL_Rope`) | 1.46 MB |
| Bolt pair | 868 / 468 | 4 of the same 6 | 0.40 MB |
| Collision | 208 | none | 17 KB |
| Filament | 28 × 5-sided tube, about 280 triangles, rewritten in place | 1 | none |

- **Textures.** There are five tileable JPEGs:
  - wood base colour, 1024²
  - wood normal, 512²
  - iron base colour, 512²
  - iron normal, 512²
  - rope base colour, 256²

  They take 297 KB on disk. In GPU memory they use about **9.7 MiB** (RGBA8 with mips), loaded once when materials are shared.
- **Preview scene.** The whole scene (ballista, a pair in flight and trees, with shadows) draws 139 calls and 25.8k triangles. The ballista alone is about 60–70 draw calls at LOD0, because the GLTFLoader splits meshes per material.

## Rebuild and verify (measured on this cloud container)

```
BPY_PYTHON=<python with bpy 4.5> tools/build.sh      # 8.8 s, writes out/
node tests/timberline-check.mjs                     # <1 s, 9 checks
node tools/capture.mjs stills renders               # 15 s (headless Chromium, SwiftShader)
node tools/capture.mjs all <dir>                    # 4 min 7 s, includes 416 firing frames
python tools/assemble.py <dir> renders/timberline_fire_preview.gif 480   # 20 s, Pillow
```

`BLENDER=<blender executable>` works in place of `BPY_PYTHON`. The capture tool serves `three` from `multiplayer/node_modules` (`npm ci --ignore-scripts` in `multiplayer/`) and needs Playwright with Chromium.

## Known limitations

- **No headset or in-game testing.** All review is offline renders. Grip comfort, scale in the HMD and actual in-game readability are unverified. The operator view is crowded by the two windlass drums.
- **Readability at distance.**
  - The spread is subtle by design (0.90 m to 1.12 m). The flight model exaggerates yaw for readability, but the spread is easiest to see from the chase camera.
  - From the RTS camera the pair reads as two small marks. The filament is barely visible, even with the minimum-pixel rule.
  - A brighter trail or decal from the FX sockets is the recommended next step if RTS readability matters.
- **Performance.** At about 60–70 draw calls, the ballista is the heaviest part. Merging static LOD0 parts per material is the obvious optimisation if many ballistas are on screen.
- **Physics.** Flight and impact are presentation kinematics, not physics. The impact response is tuned visually: the filament bows, the bolts are drawn inward and the pair loses speed monotonically. It is not physically validated.
- **Preview environment.** The preview's trees and felling are fixtures only.
- **Lighting.** The left vane catches less light under the default sun.
- **Loaded filament.** It hangs from the horn, which relies on the contract's drape length matching the taut length (1.12 m). The test checks this.
