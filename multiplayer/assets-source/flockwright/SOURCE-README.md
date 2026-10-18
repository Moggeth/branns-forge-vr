# Siegebird — Handheld Crossbow 3D Asset Documentation (`siegebird.glb`)

**Project**: *Brann’s Forge*  
**Asset Name**: `Siegebird` (Handheld Fantasy Crossbow with 6-Bird Mechanical Reload Crew)  
**Format**: Standard glTF 2.0 Binary (`siegebird.glb`) with embedded 2048×2048 PNG PBR textures  
**Target Platforms**: Three.js / WebXR, Meta Quest (Quest 2 / 3 / Pro), and Mobile GPUs  

---

## 1. Coordinate System, Units & Physical Dimensions

| Property | Specification | Notes |
| :--- | :--- | :--- |
| **Linear Units** | `1.0 unit = 1.0 metre` | Standard glTF 2.0 & WebXR real-world scale |
| **Up Axis** | `+Y` | World & local up |
| **Forward (Firing) Axis** | `-Z` | Bolts launch along `-Z`; sights align down `-Z` |
| **Right Axis** | `+X` | Right-handed coordinate system (`+X` right, `-X` left) |
| **World Origin `(0, 0, 0)`** | Receiver Balance Point | Centered on X, directly above the trigger housing for natural VR hand pivot |
| **Overall Bounding Box (Min)** | `[-0.282, -0.152, -0.448] m` | Front iron stirrup tip at `Z = -0.448 m`, grip pommel at `Y = -0.152 m` |
| **Overall Bounding Box (Max)** | `[+0.282, +0.100, +0.299] m` | Rear stock & bowstring geometry |
| **Overall Span / Width (`X`)** | `0.564 m` (`56.4 cm`) | Across the twin recurve forged-iron & hardwood prod limbs |
| **Overall Height (`Y`)** | `0.252 m` (`25.2 cm`) | Pistol grip pommel to top of rear aperture sight & bird crests |
| **Overall Length (`Z`)** | `0.680 m` body (`0.747 m` max) | Front foot stirrup (`-0.448 m`) to buttplate (`+0.240 m`) |

---

## 2. Geometry, Mesh, Material & Texture Budgets

Designed specifically for standalone VR (Meta Quest) and mobile WebGL/WebXR frame-rate budgets:

| Metric | Count / Spec | Details |
| :--- | :--- | :--- |
| **Total Scene Nodes** | `44` | `1` root + `5` empty attachment sockets + `14` weapon/mechanism nodes + `24` bird crew nodes (`6` birds × `4` articulated nodes each) |
| **Total Mesh Groups** | `38` | Indexed triangle primitives (`POSITION`, `NORMAL`, `TEXCOORD_0`) |
| **Total Vertices** | `12,100` | Clean UV-unwrapped vertices (`uint16` index buffers) |
| **Total Triangles** | `14,144` | Mobile & Quest VR hero weapon budget |
| **Shared PBR Materials** | `4` | All referencing the shared 2048×2048 PBR texture atlas to minimize draw calls |
| **Embedded Textures** | `3` (`2048 × 2048` PNG) | `Siegebird_BaseColor_2048` (sRGB), `Siegebird_ORM_2048` (Linear R=AO, G=Roughness, B=Metallic), `Siegebird_Normal_2048` (Tangent Normal) |

### Shared PBR Material Definitions
1. **`Mat_WarmHardwood`**: Oiled walnut/cherry stock, sculpted off-hand foregrip, ergonomic pistol grip, laminated inner prod limb cores, hardwood perch dowels, and crossbow bolt shafts (`Roughness ~0.42–0.55`, `Metallic 0.02`).
2. **`Mat_ForgedIron`**: Planished blackened forged-iron prod block, recurve outer limbs, grooved bolt rail cheeks, front foot stirrup, trigger guard, side magazine racks, bodkin bolt point, and miniature bird goggle lenses (`Roughness ~0.36–0.48`, `Metallic 0.86`).
3. **`Mat_RestrainedBrass`**: Antique brushed brass rear aperture ring sight, front post bead, twin treaded ratchet windlass wheels, curved trigger, rotating string-catch nut, sliding string carrier claws, bolt ferrules, bird perches, and miniature bird aviator goggle frames (`Roughness ~0.25–0.34`, `Metallic 0.92`).
4. **`Mat_FeathersAndCord`**: Deep forge-teal (`#12616E`), bright turquoise (`#30BAC2`), and warm cream-ivory (`#F8F2E6`) plumage for the 6 birds and 3-vane bolt fletching, warm coral-amber beaks/legs, and braided hemp bowstring (`doubleSided: true`, `Roughness ~0.50–0.72`, `Metallic 0.01–0.06`).

---

## 3. Named Empty Attachment Sockets (Three.js / WebXR Ready)

All 5 required attachment points are exported as empty transform nodes directly parented to `Siegebird_Root` with `-Z` forward and `+Y` up:

| Empty Node Name | Local Position `(X, Y, Z)` [m] | Local Rotation (Quat `[x, y, z, w]`) | Intended Game / WebXR Usage |
| :--- | :--- | :--- | :--- |
| **`GripMain`** | `[0.000, -0.075, +0.065]` | `[-0.121869, 0.0, 0.0, 0.992546]` (`-14°` X pitch) | Dominant hand VR controller snap socket & trigger finger index |
| **`GripSupport`** | `[0.000, -0.042, -0.185]` | `[0.0, 0.0, 0.0, 1.0]` | Off-hand support foregrip snap socket for two-handed WebXR aiming |
| **`Muzzle`** | `[0.000, +0.038, -0.420]` | `[0.0, 0.0, 0.0, 1.0]` | Runtime projectile spawn transform & firing VFX origin (oriented down `-Z`) |
| **`BoltRest`** | `[0.000, +0.038, -0.120]` | `[0.0, 0.0, 0.0, 1.0]` | Seated bolt groove reference along the brass-inlaid rail |
| **`Sight`** | `[0.000, +0.068, +0.085]` | `[0.0, 0.0, 0.0, 1.0]` | Camera/eye alignment node looking through the rear ring sight (`Z = +0.095 m`) and front sight bead (`Z = -0.350 m`) along `X = 0.0, Y = +0.068 m` |

---

## 4. Complete Scene Node Hierarchy & Mechanical Parts

Every functional part of the weapon and each of the six birds is an independently named, animatable glTF node:

```text
Siegebird_Root
├── GripMain                  (Empty Attachment Node)
├── GripSupport               (Empty Attachment Node)
├── Muzzle                    (Empty Attachment Node)
├── BoltRest                  (Empty Attachment Node)
├── Sight                     (Empty Attachment Node)
├── WeaponFrame               (Hardwood stock, grips, iron prod head, stirrup, reserve bolts & 6 outboard perches)
├── BoltRail                  (Grooved iron/brass bolt track + unobstructed rear ring & front bead sights)
├── ProdLimb_L                (Left recurve bow limb — pivots at [-0.055, +0.036, -0.320])
├── ProdLimb_R                (Right recurve bow limb — pivots at [+0.055, +0.036, -0.320])
├── BowString                 (Center string nock at [0.0, +0.038, +0.045] when cocked; slides to Z = -0.260 on fire)
│   ├── BowString_L           (Left braided hemp string limb segment)
│   └── BowString_R           (Right braided hemp string limb segment)
├── Bolt                      (Active crossbow bolt with iron bodkin tip & ivory-teal 3-vane feather fletching)
├── Trigger                   (Articulated curved brass trigger — pivots at [0.0, -0.008, +0.030])
├── StringCatch               (Rotating brass sear/nut latch at [0.0, +0.030, +0.045])
├── StringCarrierSled         (Sliding brass/iron claw carriage that fetches the bowstring during Reload)
├── RatchetWheel_L            (Left brass treaded windlass ratchet wheel at [-0.048, +0.018, +0.065])
├── RatchetWheel_R            (Right brass treaded windlass ratchet wheel at [+0.048, +0.018, +0.065])
├── BoltLifterArms            (Hinged brass elevator arms at [0.0, +0.008, -0.110] that lift reserve bolts onto rail)
├── Bird_01_Spotter           (Front-Left Perch [-0.068, +0.042, -0.250] — hooks left side of string into sled)
│   ├── Bird_01_Spotter_Head
│   ├── Bird_01_Spotter_Wing_L
│   └── Bird_01_Spotter_Wing_R
├── Bird_02_Hooker            (Front-Right Perch [+0.068, +0.042, -0.250] — hooks right side of string into sled)
│   ├── Bird_02_Hooker_Head
│   ├── Bird_02_Hooker_Wing_L
│   └── Bird_02_Hooker_Wing_R
├── Bird_03_WinchLeft         (Rear-Left Perch [-0.064, +0.036, +0.065] — treadmills left ratchet windlass wheel)
│   ├── Bird_03_WinchLeft_Head
│   ├── Bird_03_WinchLeft_Wing_L
│   └── Bird_03_WinchLeft_Wing_R
├── Bird_04_WinchRight        (Rear-Right Perch [+0.064, +0.036, +0.065] — treadmills right ratchet windlass wheel)
│   ├── Bird_04_WinchRight_Head
│   ├── Bird_04_WinchRight_Wing_L
│   └── Bird_04_WinchRight_Wing_R
├── Bird_05_LoaderLeft        (Mid-Left Perch [-0.058, +0.004, -0.095] — lifts front bolt shaft onto rail)
│   ├── Bird_05_LoaderLeft_Head
│   ├── Bird_05_LoaderLeft_Wing_L
│   └── Bird_05_LoaderLeft_Wing_R
└── Bird_06_LoaderRight       (Mid-Right Perch [+0.058, +0.004, -0.095] — lifts rear fletched bolt nock onto rail)
    ├── Bird_06_LoaderRight_Head
    ├── Bird_06_LoaderRight_Wing_L
    └── Bird_06_LoaderRight_Wing_R
```

---

## 5. Animation Clips & Mechanical Timing Specification

All animations are authored as pure visual glTF keyframe clips (no gameplay state logic baked in) so the game engine can trigger, blend, or speed-scale them freely.

### Clip 1: `Idle` (`0.00 s – 2.40 s`, Looping)
- **Weapon State**: Cocked and loaded (`BowString` drawn to `Z = +0.045 m`, `ProdLimb_L/R` flexed to `±0.26 rad`, `Bolt` seated at `BoltRest`).
- **Bird Crew Behavior**: Staggered, organic breathing bobs (`±2.5 mm`), curious head tilts (`±10°` pitch, `±10°` yaw) inspecting the bolt rail and target direction, and intermittent wing flutters. All 6 birds remain on their outboard perches so the central sight corridor (`X = 0, Y = +0.068 m`) stays 100% clear.

### Clip 2: `Fire` (`0.00 s – 0.80 s`, One-Shot)
- **`0.00 s – 0.08 s` (Trigger & Sear Release)**: `Trigger` rotates backward (`+24°`); `StringCatch` drops (`-35°`) to release the bowstring nock.
- **`0.08 s – 0.16 s` (Limb Snap & Bolt Launch)**: `ProdLimb_L` and `ProdLimb_R` snap forward from flexed (`±0.26 rad`) to brace (`0.00 rad`) with natural harmonic rebound; `BowString` surges forward (`Z = +0.045 m → -0.260 m`); `Bolt` accelerates down `-Z` through `Muzzle` (`Z = -0.120 m → -0.520 m`), scaling down at exit so Three.js can spawn a physics projectile at `Muzzle`.
- **`0.10 s – 0.35 s` (Crew Recoil Reaction)**: All 6 birds react to the launch impulse with a synchronized startled hop (`+18 mm` Y), wing flare (`±60°`), and forward head peek, settling back onto their perches by `0.80 s`.

### Clip 3: `Reload` (`0.00 s – 3.20 s`, One-Shot 3-Phase Mechanical Choreography)
- **Phase 1 — Carrier Advance & String Hook (`0.00 s – 0.75 s`)**:
  - `StringCarrierSled` slides forward along the rail tracks from `Z = +0.045 m` to `Z = -0.260 m`.
  - Front crew (`Bird_01_Spotter` and `Bird_02_Hooker`) hop inward from their front perches (`X = ±0.068 m → ±0.032 m`), dip their heads (`+31°` pitch) to hook the `BowString` into the `StringCarrierSled` brass claws with their beaks, and hop back to their perches.
- **Phase 2 — Twin-Bird Windlass Draw (`0.75 s – 2.00 s`)**:
  - Rear winch crew (`Bird_03_WinchLeft` and `Bird_04_WinchRight`) hop onto the paddle treads of `RatchetWheel_L` and `RatchetWheel_R`, flapping and treadmilling as both brass ratchet wheels spin (`360°` rotation).
  - The windlass draws `StringCarrierSled` and `BowString` steadily backward (`Z = -0.260 m → +0.045 m`) while `ProdLimb_L` and `ProdLimb_R` flex back into full tension (`0.00 → ±0.26 rad`). At `2.00 s`, `StringCatch` locks the string.
- **Phase 3 — Dual-Bird Bolt Delivery & Ready Signal (`2.00 s – 3.20 s`)**:
  - Mid-body loaders (`Bird_05_LoaderLeft` at the front shaft `Z = -0.145 m`, `Bird_06_LoaderRight` at the rear fletching `Z = -0.055 m`) swoop down to the side magazine, flap upward in unison with `BoltLifterArms`, and lift a fresh `Bolt` (`Y = -0.012 m → +0.048 m`) before seating it cleanly into `BoltRest` (`Y = +0.038 m, Z = -0.120 m`) at `2.70 s`.
  - `2.70 s – 3.20 s`: `BoltLifterArms` fold down, `Bird_05` and `Bird_06` return to their perches, and the crew performs a synchronized double head-nod ("Ready!"), matching the `Idle` start pose at `3.20 s`.

---

## 6. Three.js / WebXR Integration Quick-Start

```javascript
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('siegebird.glb', (gltf) => {
  const siegebird = gltf.scene;
  scene.add(siegebird);

  // 1. Retrieve named empty attachment sockets
  const gripMain    = siegebird.getObjectByName('GripMain');
  const gripSupport = siegebird.getObjectByName('GripSupport');
  const muzzle      = siegebird.getObjectByName('Muzzle');
  const boltRest    = siegebird.getObjectByName('BoltRest');
  const sight       = siegebird.getObjectByName('Sight');

  // 2. Set up AnimationMixer & clips ('Idle', 'Fire', 'Reload')
  const mixer = new THREE.AnimationMixer(siegebird);
  const clips = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));

  clips.Idle.play();

  // Trigger Fire -> Reload -> Idle cycle on player input
  function fireAndReload() {
    clips.Idle.fadeOut(0.05);
    clips.Fire.reset().setLoop(THREE.LoopOnce, 1).play();
    clips.Fire.clampWhenFinished = true;
    // Spawn runtime projectile from `muzzle.getWorldPosition()` along `muzzle.getWorldDirection()` (-Z)
  }
});
```

---

## 7. Rebuilding From Editable Source

Two self-contained generator scripts are included in `source/`:
1. **`source/build_siegebird_glb.py`**: Pure Python 3 procedural builder (`numpy` + `Pillow`) that synthesizes the 2048×2048 PBR textures, constructs all 38 meshes, rigs the 44-node hierarchy and 3 keyframe animations, and packs `siegebird.glb` directly.
   ```bash
   python3 source/build_siegebird_glb.py
   ```
2. **`source/build_siegebird_blender.py`**: Self-contained Blender 3.6+ / 4.x Python (`bpy`) script that builds the scene hierarchy, Principled BSDF materials, and empty sockets inside Blender and exports `siegebird.glb`.
   ```bash
   blender --background --python source/build_siegebird_blender.py
   ```
