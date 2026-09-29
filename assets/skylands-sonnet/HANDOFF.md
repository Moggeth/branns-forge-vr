# Skylands art family: Sky Garden + Cloudbreak Keep (Sonnet 5.5 commission, 2026-09-30)

70 self-contained GLBs (12 materials, textures embedded, COLOR_0 vertex tint), two placement manifests, an editable `.blend`, 8 previews.
Nothing here touches gameplay; all art is **visual only**.

## Rebuild
```
blender.exe -b --factory-startup --python build_skylands.py            # everything, ~5 s
blender.exe -b --factory-startup --python build_skylands.py -- --no-render
```
Blender 4.5.13 only. Deterministic (fixed seeds). Modules: `skl_core.py` (textures, materials, mesh kit), `skl_assets.py` (asset generators), `build_skylands.py` (registry, placement layout, export, previews, stats). Outputs land next to the scripts; procedural PNGs are also written to `textures/`. Blender-side scene: `zone_*` collections (hidden), `asset_sheet` collection (one row per zone).

## Orientation / origins
- Godot coordinates, +Y up, 1 unit = 1 m. GLBs exported with Y-up. `yaw_degrees` is rotation about +Y, `scale` uniform. Positions are zone-local (same frame as the zone `.gd` files).
- Origin is the ground contact point (buildings/plants/posts), the island rect centre at top-surface height (undersides, so place at the island centre with y = island y), the windmill hub (rotor), the anchor of the cluster (islets, clouds).
- Edge pieces (root cascades, rim rocks, keep walls, waterfalls) face local **+Z = outward**; buildings' entrance/door faces **+Z** (yaw 0 = facing the player's south).
- Wind blows toward **+X**: pale trees, meadow blades, banners and root strands lean +X.
- Grapple posts keep the old anchor offsets exactly: Sky ring at local (1.8, 3.5, 0), Cloud ring at (1.55, 4.5, 0). Place at the old post positions. Windmill rotor: place at (-10, 6.6, -9.45), spin around local Z. The tower's hub mount is (0, 4.8, 1.55) relative to the tower origin (-10, 1.8, -11).
- Undersides start about 3 cm below the authoritative top rect and overhang it by at least 0.45 m; the visible turf lip is at y -0.03..+0.035, so it does not change walkable height. Keep the existing top slab/collision; the art only dresses edges and undersides.

## Collision intent
Do **not** add colliders from the art meshes. Nothing hangs in the grapple lanes. Every `collision_intent` string is in `stats.json`. Suggested proxies if wanted: windmill tower cylinder r 1.45 h 6.3; keep tower cylinder r 1.85 h 5.4; keep wall box 0.6 x 2.0 x 3.0; pillar lanterns/waymarks/cairns as small cylinders; shelter plinth + back/-X wall boxes only (front and roof volume stay free); tree trunks as thin capsules. Undersides, root cascades, crags, clouds, waterfalls, flowers, turf, path slabs: none. Path slabs are 7 cm proud of the floor and are decoration only. No bridges exist.
Retire: old rect-slab-only islands' bare sides, both zones' old backdrop cloud rocks (z -28..-48 Sky, -39..-46 Cloud), old watch-post shelters, old post/pillar/tower primitives.

## Budgets (see stats.json for per-asset numbers)
| | Sky Garden | Cloudbreak Keep |
|---|---|---|
| Placements | 223 | 262 |
| Unique GLBs | 39 | 33 |
| Materials | 12 | 11 |
| Triangles, play area | 97.7k | 74.2k |
| Triangles, backdrop islets/clouds | 29.6k | 24.0k |
Per-asset: 56 tris (path slab) to 3k (islet); undersides 1.2-2.4k; hero buildings 1.0-1.7k. Textures: cliff/ashlar/turf 512 albedo, others 256, normals 256; each GLB embeds only the textures it uses (about 0.2-1.4 MB each, 72 MB folder including .blend and previews). Import as shared materials in Godot to avoid duplicating the textures per scene. Cloud banks are untextured alpha-free white; islet undersides re-use the cliff material.
Backdrop pieces cost the most per pixel; use distance fade / visibility ranges ~60 m. Root cascades and rim rocks are good MultiMesh candidates (few unique meshes, many instances).

## Placement manifests
`placement_<zone>.json`: `{schema, assets:{name: file}, placements:[{asset, position, yaw_degrees, scale}]}`. Keep-out circles (portals, pickups, grapple landings, spawn) are honoured; no manifest item overlaps a landing top or lane. Backdrop pieces are beyond the bounds (+/-22 Sky, +/-28 Cloud), at y -7..+4 below/around the play space, and cloud banks at y -20..-31.

## Lighting and fog suggestions
- Sky Garden: warm morning. Sun ffe9c8 energy ~1.1 at ~45 deg elevation from -X/+Z; ambient sky 8fb8e6 ~0.55; fog color b9d7ee density 0.0012; teal/gold glow materials want bloom threshold ~0.9. Turf and leaf look best with mild SSAO.
- Cloudbreak Keep: cooler and windier. Sun fff2dc ~1.05 from -X; ambient d6e7e4 0.48; fog bbd7e4 density 0.003 (existing); a subtle lower height-fog in cloud-bank colour (f4f9ff) below y=-8 makes the undersides fade into cloud. Blowing +X wind particles and banner cloth motion suit it.
- Shadow: keep the sun shadow distance ~50 m; undersides are large and read best when sunlit from a low side angle (see `*_underside.png`).

## Previews (`previews/`)
`sky_garden_ground/overhead/west_isle/underside.png`, `cloudbreak_ground/overhead/landing_west/underside.png`. Ground cameras use the Godot capture eyes (Sky (2,1.8,8) toward (-2,3,-9); Cloud (1,1.8,10) toward (0,3,-12)). Green reference slabs, portal rings and pickup dots in previews are stand-ins and are **not** exported.

## Known limits
- Preview lighting is EEVEE with a gradient world, not the Godot environment; colours will shift in-engine.
- Banner flags on the shelters can poke through roof edges slightly; rim rocks on corners may overlap neighbouring rocks. Both are cosmetic.
- Not yet imported into Godot or tested with in-engine grapple runs; the placements avoid old anchor lanes by construction.
