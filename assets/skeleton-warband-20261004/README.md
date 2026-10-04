# Skeleton warband (2026-10-04)

Source for `multiplayer/public/assets/skeleton.glb`. Fully procedural (bmesh + numpy textures), no source art needed.

Build (a few seconds, no Blender install needed):

```sh
pip install bpy==4.5.*          # or inside Blender 4.5: blender --background --python build_skeleton.py
python3 build_skeleton.py       # writes skeleton.glb and build_report.json here (--blend also saves the .blend)
cp skeleton.glb ../../multiplayer/public/assets/skeleton.glb
```

What is in the file
- One shared body (about 16.7k triangles): a round cartoon skull (big dark eye sockets with a small glow, soft brows,
  heart nose, chunky grinning teeth) with a hinged jaw (`HeadJaw`) whose dark mouth shows when it opens,
  ribs, sternum, pelvis, two-bone arms with elbows (`LeftForearm`/`RightForearm`), two-bone legs, loincloth.
- Six warband looks, each a set of optional nodes the game keeps or drops (`multiplayer/client/skeleton-look.js`):

  | Variant | Gear | Shield |
  |---|---|---|
  | Mossward | `Gear_MossCap`, `Gear_MossRag` | `Shield_Kite` (oak leaf) |
  | Rustguard | `Gear_IronHelm`, `Gear_Pauldron` | `Shield_Round` (iron boss) |
  | Thornhood | `Gear_Hood` | `Shield_Heater` (chevron) |
  | Old Bones | `Gear_Cracks` | `Shield_Buckler` (split, lashed) |
  | Bloomcaller | `Gear_FlowerCrown` | `Shield_Living` (bark, leaves, moss) |
  | Antlerbound | `Gear_Antlers` | `Shield_Tower` (skull trophy) |

  A dressed skeleton draws 17.5k to 20.6k triangles (the old one drew 17.1k).
- The variant is picked from the enemy id, so every peer sees the same look with no network or save change.
  Bone, cloth and eye tints plus a small size and shade jitter are applied per variant.
- Materials: `Bone`, `Cloth` (tinted in JS), `Fabric` (vertex coloured moss, leather, petals), `Wood`, `Iron`,
  `EyeGlow` (emissive). Tileable JPEG textures (`textures.py`) and baked vertex AO.
- Shields sit at the shield hand in a relaxed carry, angled out and forward, skinned to `LeftHand`.
  Any node named `Shield_*` stays a shield contact surface for arrows.
- No animation clips. The game poses skeletons procedurally (`multiplayer/client/skeleton-motion.js`): stride-locked
  walk with foot IK, relaxed shield swing that comes up square to block when a hero is close or after a hit,
  claw swipe timed to the gameplay strike tick, jaw chatter, limps and crawls when limbs are lost.

Review pages (run `npm run dev` in `multiplayer/`): `tests/skeleton-studio.html` (`?variant=N`, `?lineup`, `?close`,
`?dusk`), `tests/skeleton-motion-studio.html` (timeline of idle, walk, guard, swipe, hit, turn, lost limbs;
`?cam=side|front|threeq|follow`, `?variant=N`, `?play`).
