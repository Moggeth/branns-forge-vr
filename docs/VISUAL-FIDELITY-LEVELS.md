# Visual fidelity levels

Mitch asked for a shared bar to build visuals to (2026-10-06, after the first kill-streak dragon read as a bare proof of
concept). Every visible asset, creature and effect names the level it is at, and a thread says which level it is building
to before it starts. A level is reached only when its checks pass in the running game, not in a source render.

Levels describe finish, not effort. A level 1 asset is the right call while the gameplay is still moving; a level 3 asset
on a feature nobody has played yet is wasted work.

## Level 1: proof of concept

The thing is recognisable and does its job, so the gameplay can be tested and changed quickly.

- **Form:** the silhouette reads at gameplay distance (you can tell a dragon from a bird). Primitive or blockout shapes
  are fine, as long as the scale, pivots, anchors (mouth, grip, seat, muzzle) and collision match the final contract.
- **Surface:** flat colours from the palette. No texture work.
- **Motion:** simple procedural motion (sine flaps, sway) that is smooth on the presentation clock.
- **Effects:** plain particles or sprites in roughly the right colours, with the right timing and size, so hits are readable.
- **Sound and feel:** placeholder sound and rumble that land on the right frames.
- **Checks:** works in the game on desktop and phone sizes; no page errors; inside the performance budget.
- **Typical cost:** hours. Replace freely.

## Level 2: art-directed (the shipping bar)

The thing has a designed shape, a personality and a clear look that belongs to Brann's Forge. This is the default bar for
anything players will see a lot of, and the bar for anything called "done".

- **Form:** shape language is deliberate, with clear large, medium and small forms (one big readable mass, a few
  secondary shapes, small accents only where the eye goes). Organic things are modelled with smooth, flowing surfaces
  and proper topology (a Blender builder with subdivision and sculpt-style displacement), not stacked spheres and cones.
  Hard things keep crisp bevels where Mitch likes them faceted. The silhouette is checked from the angles players
  actually see it (from the saddle, from the ground, from far away).
- **Surface:** materials carry value and colour breakdown: gradients (dark back, light belly), baked ambient occlusion
  in the creases, scale or grain pattern at a size that reads at gameplay distance, a rim or fresnel light so it separates
  from the sky. Usually one texture atlas or vertex colours plus a small shared material set.
- **Character:** one or two signature features that the design leans into (the Wyrmspout's jade wyrm head, the pick's
  faceted claws). Faces have expression. Goofy and charming, never spooky.
- **Motion:** a real rig with authored clips (for a creature: idle or glide, flap, attack, hit or special), with weight,
  anticipation and follow-through. Secondary motion (tail, ears, cloth) lags and settles instead of moving in lock-step.
- **Effects:** shaped with noise and texture, not plain dots. Fire, for example, has a hot white-yellow core, an orange
  body, red edges, dark smoke, embers and heat; it billows, curls and breaks up; it leaves a mark (scorch, glow, smoke)
  where it lands; impacts have a flash, a shock ring and debris. Timing has a wind-up, a hit and a tail.
- **Sound and feel:** layered sound matched to the motion; rumble and camera shake on big moments, gentle on phones.
- **Checks:** turnaround renders of the source, then in-game captures at gameplay distance on desktop and phone sizes,
  before and after, side by side. Draw calls, triangles and particle counts are recorded against the budget below.
- **Typical cost:** one to three focused iterations, each reviewed in the game.

## Level 3: polish

The extra mile. Only for things that are already level 2 and that players love or see constantly.

- **Form and surface:** fine detail (normal maps, wear, decals, small accessories), LODs for distance.
- **Motion:** surplus animation: idle variations, reactions to being hit or fed, take-off and landing sequences, emotes,
  physics-driven secondary chains, small cinematic moments.
- **Effects:** extra layers (heat haze, light shafts, lingering embers, ground decals that fade), and device-tier
  post-processing (bloom or colour grading on desktop only; never a cost on Quest).
- **Accessibility:** reduced-motion and reduced-flash variants.
- **Checks:** verified on a real phone and a real headset, not just simulated sizes.

## Budgets (Quest-safe, per feature)

| | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Hero creature or large prop | under 2k triangles | under 12k triangles, 1 skinned mesh, at most 3 materials | adds LODs, at most 20k up close |
| Held tool | under 1.5k | under 6k | under 8k plus normal map |
| One effect | under 500 particles | under 1,500 particles in at most 3 draws | same draws, extra layers on desktop only |
| Lights | none | none (fake glow in shaders) | one shared light on desktop only |

## Techniques available in this project

- **Blender in the cloud** (`python3.11 -m pip install bpy==4.5.*`): deterministic Python builders that model with
  subdivision, displacement, skin and curve modifiers, bake ambient occlusion and colour into vertex colours or a
  texture atlas, build armatures with weighted skinning and authored actions, and export a self-contained GLB plus
  turnaround renders. See `multiplayer/assets-source/wyrmspout-v2` for the pattern.
- **Three.js shaders:** custom materials with noise, gradients, fresnel rim, dissolve and flow; GPU particles with
  procedurally generated sprite textures; instanced decals.
- **Procedural textures** with Python (numpy, Pillow) or a canvas at start-up, so nothing needs a download.
- **In-game capture** through Playwright with Chromium (software rendering, slow but faithful) and the lab pages.
- Not available here: hand sculpting, photogrammetry, motion capture or image-generation models. Hand-made reference
  from Mitch (a sketch, a screenshot of something he likes) is the fastest way to steer a level 2 pass.

## Current levels

| Asset | Level | Notes |
|---|---|---|
| Kill-streak dragon ("Slay Thee, Sun Birdy Above") | 2 | Round two (2026-10-10) Blender builder in multiplayer/assets-source/skyfire-dragon: leaner body, 23 m cambered wings with finger bones and backlit membranes, cupped downstroke and swept upstroke, wingbeat gusts. 11.5k triangles, 1 skinned mesh, 3 materials, 39 bones, 396 KB. Checked in game on desktop (chase and saddle). Level 3 left: portrait-phone chase framing, take-off and landing clips, LODs, real device checks. |
| Kill-streak fire | 2 | client/dragon-fire.js: velocity-stretched flame tongues, ballistic fire globs that splash where they land, fading scorch, smoke, sparks, wing gust dust, fireballs and shock rings. Level 3 left: heat haze, device-tier extras. |
