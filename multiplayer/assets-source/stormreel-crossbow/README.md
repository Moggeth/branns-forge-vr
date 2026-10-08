# Stormreel crossbow and bolt (production pass, 2026-10-07)

The lightning crossbow fed from the cable-reel backpack, and the taser-probe bolt it fires (also the lodged probe and
the bolt lying in the grass). Replaces the crossbow part of `../stormreel/build_stormreel.py`, which stays in place for
history; the tower and pack have their own builders.

## Rebuild

```
python3.11 -m pip install bpy==5.0.* numpy pillow
cd multiplayer/assets-source/stormreel-crossbow
python3.11 build_crossbow.py -- --out ../../public/assets/stormreel.glb             # about two minutes on 4 CPU threads
python3.11 build_crossbow.py -- --out /tmp/x.glb --tex 512 --samples 8             # quick draft (about 40 s)
python3.11 build_crossbow.py -- --out /tmp/x.glb --render out/review               # plus Cycles turnaround renders
```

`out/` (bake intermediates, debug maps, `report.json`, renders) is scratch. The build is deterministic apart from Cycles
sampling noise in the AO and bevel bakes.

## Design

- **Silhouette:** one wedge receiver, deepest over the firing hand, tapering to the stock and to the prod. Every hard
  mass is a chamfered octagon, a lozenge blade or a bevelled plate: crisp facets, nothing soft or boat-like.
- **Big, medium, small:** the receiver and stock plate (big); the recurve prod in steel yokes, the twin capacitor
  tubes, the copper accelerator coil collaring the nose, the grips (medium); arc horns, brass rivets, horn knobs,
  hazard bands, the polarity bezel (small, where the eye goes).
- **Reading the electricity:** cord into the butt socket, copper straps from the tube caps into the receiver, the
  Jacob's-ladder horns between the tube caps, the bolt drawn through the coil, the filament spool on the bolt's tail.
- **Two finishes, one atlas:** red (+) is crimson candy enamel with bone accents; blue (-) is blue-black enamel on
  blackened steel with electric-blue accents. Steel, brass, copper, porcelain and rubber are shared.
- **First person:** the tubes ride the top shoulders, so the shooter watches them fill; the horns rise just right of the
  sight line; the polarity bezel sits between the tubes facing up.

## Budget (this build)

| | |
| --- | --- |
| Triangles | 7,684 in all: body 6,428, limbs 2 x 304, string halves 2 x 12, seated bolt 312, glass 184, cores 2 x 64 (the bolt alone: 312) |
| Draw calls | 9 meshes (body, 2 limbs, 2 string halves, bolt, glass, 2 charge cores), 3 materials |
| Textures | base colour 1024 x 2048 JPEG (both finishes, 382 KB), ORM 512 x 512 JPEG (138 KB), normal 1024 x 1024 JPEG (200 KB) |
| GLB | 990 KB (`out/bake/report.json` after a build) |

Normals are stored as normalized bytes and UVs as normalized shorts (`KHR_mesh_quantization`, core in three.js).

## Runtime contract

glTF frame: metres, -Z forward, +Y up, `GripAnchor` at the origin (centre of the firing hand), native scale
(client/asset-pose.js `stormreel`, height .5).

| Node | Used by | Meaning |
| --- | --- | --- |
| `Stormreel` | stormreel-weapon.js | root; the weapon rotates it about the grip for muzzle climb, tug and hum |
| `GripAnchor` | asset-pose.js | pivot |
| `Muzzle` | game.js, stormreel-view.js, stormreel-weapon.js | bolt nose at rest; shots, filament and aim preview start here |
| `CordAnchor` | stormreel-view.js | end of the cord stub under the butt (planted crossbow's cord to its pack) |
| `Bolt` | stormreel-view.js | the bolt template. **Sits at half the seat position; its mesh child `Bolt_Mesh` carries the other half**, so the view's `clone.position = -template.position` lands the bolt tail on the holder origin, nose `BOLT_LEN` (.33 m) ahead along -Z |
| `Bolt_Mesh` | stormreel-weapon.js | the seated bolt (origin at its tail); hidden on a shot, scaled in when it re-loads |
| `FilamentSpool` | (reserved) | tail of the bolt, where the filament leaves |
| `Charge_L_Core`, `Charge_R_Core` | stormreel-weapon.js, stormreel-view.js | glowing cores, origin at the rear end; `scale.z` 0..1 is the fill |
| `Charge_L`, `Charge_R` | | rear ends of the cores |
| `ArcHorn_L`, `ArcHorn_R`, `Horn_Base` | stormreel-weapon.js | horn tips and the narrow gap at their base (the arc climbs from base to tips) |
| `Prod_L`, `Prod_R` | stormreel-weapon.js | limbs, pivot at the riser; rotation about local Y flexes the tip fore and aft |
| `Prod_L_Tip`, `Prod_R_Tip` | stormreel-weapon.js | where each string half leaves its cam |
| `String_L`, `String_R` | stormreel-weapon.js | string halves; origin at the cam, the wire runs along local -Z; the runtime aims and stretches them |
| `String`, `BoltSeat` | stormreel-weapon.js | the cocked nock (bolt tail) |
| `PolarityBadge_Seat` | stormreel-weapon.js | top of the brass bezel; the glowing + / - badge sits here |
| `ForeGrip`, `Trigger`, `Coil_Center` | (reserved) | support hand, trigger, accelerator coil centre |

Materials: `Stormreel_Body` (atlas; client/stormreel-look.js `finishCrossbow` points a cloned map at the bottom half of
the base colour for the blue pole), `Glass` (fresnel patch in `finishCrossbow`), `Charge` (pole glow; the weapon gives
the hand-held model a private copy to pulse).
