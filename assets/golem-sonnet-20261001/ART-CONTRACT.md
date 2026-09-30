# Quarry Golem — art contract (golem.glb)

Units: metres. Origin: ground centre between the feet. Forward: **+Z** (glTF/Godot). Up: +Y. The golem's **left side is +X** (ArmL/LegL).
Measured bounds (glTF space): X ±1.04, Y -0.01…2.34 (body ≈2.26; the last ~0.08 is moss tufts/crest), Z -0.53 (back) … +0.60 (front, hands/toes).

## Node tree (pivots are plain Node3D siblings under `Golem`; no parenting between body parts)
Positions are glTF/Godot coordinates (x, y, z) relative to `Golem`.

| Node | Pivot (x, y, z) | Natural articulation | Mesh children |
|---|---|---|---|
| `BodyCore` | (0, 1.05, 0) | waist/bob/lean; rotate about X to lean | `BodyCoreMesh`, `ChestPlate`*, `CoreGlow`* |
| `Head` | (0, 1.81, 0.07) | neck: nod (X), turn (Y), tilt (Z) | `HeadMesh` |
| `ArmL` / `ArmR` | (±0.70, 1.62, 0) | shoulder | `UpperArmL/R`, `ShoulderL/R`*, child pivot `ElbowL/R` |
| `ElbowL` / `ElbowR` (child of Arm) | (±0.80, 1.10, 0.10) world; local to Arm (±0.10, -0.52, 0.10) | elbow, optional | `ForearmHandL/R` (forearm + chisel hand), `ForearmL/R`* (bracer) |
| `LegL` / `LegR` | (±0.31, 0.95, -0.02) | hip | `LegLMesh` / `LegRMesh` (thigh, knee, shin, foot) |

\* independently removable armour/emitter meshes: `ChestPlate`, `CoreGlow`, `ShoulderL`, `ShoulderR`, `ForearmL`, `ForearmR`. Removing them leaves closed stone underneath (see `preview_breakdown.png`).
`ElbowL/R` are extra nested pivots; ignore them and the whole arm simply rotates rigidly at the shoulder.
Every mesh's vertices are authored in its owning pivot's local space, and every mesh node sits at identity under its pivot, so rotating a pivot swings the part around its natural joint.

Rotation signs (Godot, rest = 0): rotating `ArmL/R` about **+X by a negative angle** swings the hands forward/up (-165° ≈ hands overhead); `LegL/R` likewise negative = leg forward. Positive X rotation on `BodyCore` tips the chest forward.

## Budget (measured from golem.glb — see `build_report.json`)
- Triangles: **20,006** (target < 22k). Per mesh: BodyCoreMesh 4112, HeadMesh 2990, LegMesh 2082×2, ChestPlate 1312, ForearmHand 1308×2, ShoulderL/R 946×2, ForearmL/R 644×2, UpperArm 600×2, CoreGlow 432.
- Materials: **9** shared (limit 12): Stone_Main, Stone_Dark, Stone_Pale, Moss, Copper, Gold, Iron, Leather, Glow. 14 mesh nodes.
- Textures: 28 embedded PNGs (base colour, normal, ORM per material; `Glow_em` emissive). Stone_Main 1024², Glow/Stone_Dark/Stone_Pale/Moss/Copper 512², Gold/Iron/Leather 256². The GLB is 17.1 MB because PNG is embedded; let Godot VRAM-compress on import.
- ORM convention: R = ambient occlusion (not exported to the glTF occlusion slot), G = roughness, B = metallic. The exporter packs G/B as metallicRoughness.
- Glow: emissive texture on `Glow` (CoreGlow sphere + 8-spike corona, eyes, forehead gem, chest rune bars). No lights, no transparency; it reads from distance by the corona silhouette and saturation. Suggested Godot emission energy 1.5–3.0 with glow enabled; raise to ~4 for telegraph pulses.
- Only UV0 is used; UVs are box-projected per chunk onto seamless tiling textures (no atlas). No vertex colours are exported.

## Animation guidance (also shipped as glTF clips `Idle`, `Walk`, `Slam` @30 fps, keyed on pivots only)
- **Idle** (60 f loop): BodyCore ±1.2 cm breathing, Head nod 2.5°, arms drift 2°.
- **Walk** (32 f loop): legs ±26°/±20° about hip, arms counter-swing ≈70%, body bob 3.5 cm twice per cycle, 3° forward lean.
- **Slam** (72 f): frames 1→26 raise both arms to -165° with elbows -32°, body leans back 9° and dips 5 cm; hold/shake 26→32 (-172°) is the telegraph window — pulse `Glow` emission there; strike 32→36 arms to -28°, body pitches forward 16° and drops 12 cm (**impact = frame 36**); recoil 36→44; recover to rest at 72. Runtime may play the clips or drive the same pivots procedurally with these numbers.
- VFX anchors: iron hand tips (local to ElbowL/R ≈ (±0.05, -0.40, -0.85) in Blender axes; check in Godot), CoreGlow ≈ (0, 1.46, 0.39).

## Damage-stage recommendations (surface contact/damage is Codex-owned)
1. 100–70%: intact.
2. <70%: hide/scale `ShoulderL` or `ShoulderR` on the side that was hit; darken `Stone_Pale` with a material override; slight Head tilt.
3. <40%: remove `ChestPlate` (exposes stone chest and the bare `CoreGlow` with its corona) and the bracers `ForearmL/R`; raise Glow emission energy and flicker.
4. <15%: scale down the Head crest/moss, add dust/grit particles at pivots, shorten walk amplitude, add a lean on one leg pivot.
5. Death: turn off `CoreGlow` first, tween arm/head pivots down, then dissolve into rubble particles. Avoid alpha blending; change emissive energy instead.
