# Forge Yard rework — layout decision study

These are **concept images, not screenshots or implemented geometry**. The current source-game baseline is [`../work/home-yard-rework-20260926/current-forge-yard.png`](../work/home-yard-rework-20260926/current-forge-yard.png). The two generated views are [`Hearth Court`](../work/home-yard-rework-20260926/concepts/hearth-court.png) and [`Maker's Village`](../work/home-yard-rework-20260926/concepts/makers-village.png).

## Recommendation: Maker's Village

Use the broad path and separate destinations in Maker's Village as the spatial plan, translating its detail back into Brann's charming, readable low-poly language. Brann and the forge remain the first landmark. The workshop/tinker/donation functions form one adjacent work area; an expandable collection hall holds every unlocked invention; a quieter portal garden sits off the path; and the training court has safe throwing room. The path itself leads toward a walkable Pinewood transition. Keep the forge visible from the arrival point and from the collection hall.

Hearth Court is an attractive alternate if a denser, theatrical hub is preferred. Its ring of seven foreground portals and monumental court, however, would keep fast travel visually dominant and make ordinary walking out of the yard harder to read.

This is a **layout choice before an asset commission**. The images are mood and massing studies, not exact scale, item counts, portal placement, or a commitment to their higher-detail rendering style. For a headset-first build, measure sight lines, walking distances, clearance for two-handed weapons, readable text distance, and frame time in a greybox before final art.

## Existing interaction constraints

- `godot/workshop_scene.gd` positions Brann, the forge, anvil, retrieval bench, and boards with absolute coordinates. `godot/workshop_suite.gd` adds the material buckets, lever, and tinker functions. Rework these as named layout anchors rather than ad hoc coordinate replacements.
- `godot/collection_runtime.gd` currently describes and builds a collection porch, with display slots extending in rows. Move that persistent collection contract into modular hall bays, preserving each item's predictable home and retrieval behavior.
- `godot/world_zones.gd` gives the Forge Yard a roughly 30 m square floor and lines seven portals at its front edge. Pinewood and other zones are already instantiated nearby in the same scene.
- `godot/adventure_runtime.gd` currently teleports on portal use and shows only the active zone group. A seamless world needs walkable terrain between zones and concurrent visibility of nearby content; simply removing portals or hiding the backdrop will not provide it. Retain the portals as optional fast travel.
- `godot/horizon.gd` already supplies inexpensive distant scenery. Improve the near-field terrain and treeline behind the portal area; preserve the distant horizon rather than replacing it with another opaque wall.

## First playable slice

1. **Spatial greybox:** Expand the Forge Yard; create reusable anchors for Brann/forge, work area, collection bays, travel garden, and training court. Move current interactions intact. Make the dirt/stone path and the first walkable connection toward Pinewood. Preserve save identifiers, portal behavior, item retrieval, donation persistence, and current quest targets.
2. **Art kit:** Commission Opus 5.5 in an isolated folder for a modular low-poly terrain/grass/stone/path kit and for the forge building. Use opaque geometry and clustered detail, a collision surface separate from decorative foliage, and clear standing/throwing areas. Implement, inspect in game, and measure draw calls and headset frame time before multiplying variants.
3. **Brann v2:** Commission a Blender/GLB model and rig with characterful proportions and restrained animation, plus source files. Require stable named anchors for head/eyes, beard or mouth, hammer grip, strike point, both hands, item handoff, and feet. Initial clips: idle, greet/listen/talk, hammer, receive materials, and finished-item reveal. Game logic, timing, dialogue, collision, and delivery remain owned by the Godot integration.
4. **Seamless route:** Make Forge Yard–Pinewood the first physically traversable, simultaneously visible pair. Keep the portal working as a shortcut. Verify combat, dropped objects, weather, save/load, and return travel across the boundary before extending to quarry, kitchen, and later zones.

## Expansion rules

Leave new bays for generated inventions; extend the gallery physically in modules rather than spilling plinths into a walking route. Let workshop tiers add visible rooms/devices without moving Brann or the retrieval point unpredictably. Keep menus near the physical thing they control: commissions at Brann, materials at the workshop, item history in the hall, travel at portals. Limit standing sign text; tactile objects, short labels, and responsive interaction should carry the information.

The terrain should feel rich at eye level through varied earth/stone material tones, readable path edges, a few shaped grass clusters, flowers, and orchard edges. Keep grass out of collision and dense transparency out of the main view. Lighting and atmospheric depth can add much of the uplift while retaining simple forms.

## Image-generation record

Generated with Codex's built-in image-generation tool. The **Hearth Court** prompt requested a high-angle plan view of a central warm forge courtyard, work/donation wing, large invention gallery, training court, and distinct portal ring with expansion space. The **Maker's Village** prompt requested a broad through-path with Brann's forge and work wing left, expandable collection hall right, separate portal garden and training yard, walkable pine/orchard continuation, warm lighting, and simple material language. The resulting images are intentionally inspirational, not game-ready asset specifications.

## Work timing and validation

See `logs/work-timing.csv` for measured step timings. Baseline Godot capture completed in 7.63 s at 1280×800 with the Mobile renderer; reported 603 draw calls and 615 objects at a desktop 120 fps cap. These are a baseline for comparison, **not VR performance evidence**. No runtime source, save data, or released game was changed in this study. This project has no Git repository, so no commit was created.
