# Portal frames – handoff

## Rebuild
```
& "<blender 4.5.13>/blender.exe" -b --factory-startup --python output/build_portals.py            # all 12 GLBs + previews
... -- --no-preview            # GLBs only (~20 s)
... -- --no-preview --only=gloamfen,forge_yard
```
Deterministic (fixed seeds). Writes `<zone_id>.glb`, `textures/*.png` (256² basecolor + roughness per material), `apertures.json`, `build_report.json` (bounds/tri counts per run; `--only` overwrites it with just those IDs) and `preview_front.png` / `preview_oblique.png`.
Each theme is one `th_*` function in the builder. Edit it, then rerun.

## Orientation / scale
Units are metres and the files load at identity. Godot axes: Y up, **+Z = aperture/front side** (Blender −Y, converted by the exporter), and the origin is on the floor at the centre of the opening. Frame sides sit at about x ±0.9. Height ranges from 2.85 to 3.34. Depth stays within ±0.62.

## Nodes (identical in every GLB)
| Node | Contents |
|---|---|
| `Frame` | Merged static frame, beveled (10 mm, angle-limited), multi-material |
| `Frame_Detail` | Rivets, chains, gills, mycelium, chime cords and cages. Small far detail you can hide by distance. |
| `Veil` | **Delivered approach: a Veil mesh in each GLB.** Arched fan mesh at z=0 that meets the frame opening exactly. UV 0..1 is laid out in the top-left convention (v=0 at the opening top). `COLOR.r` runs 0 at the rim to 1 at the centre (smoothstep). It carries a placeholder `M_Veil` material; assign `portal_surface.gdshader`. |

`apertures.json` also gives the opening bounds per ID (shape, center_x, bottom_y, top_y, half_width, spring_y, rise/radius) and the theme index, in case you want to build the surface at runtime.

## Materials
`M_Copper`, `M_Verdigris` (tarnished copper), `M_Oak`, `M_Iron` (blue-black, with rust flecks), `M_Sandstone`, `M_Stone`, `M_Leaf`, `M_Cap`, `M_Stem`, `M_Pale`, `M_Geode`, `M_Apple`, `M_Reed`. All are textured PBR (basecolor + roughness, constant metallic).
Emissive: `M_Hearth` (hearthlight orange), `M_Crystal`, `M_BogLight`, `M_StarLight`. These glow in-engine with no lights needed.

## Themes (shader `theme` int)
0 pinewood_ruins: twisted triple-strand trunks, copper bands, broken stone lintel · 1 sandstone_quarry: stepped block jambs, crane beam, hanging stepped counterweights, brass quadrant · 2 enchanted_kitchen: copper stove arch, fireboxes, riveted pots, steam hood + flue · 3 mushroom_glade: asymmetric caps with gills, mycelium · 4 crystal_hollow: split jagged geode, prism blades · 5 sky_garden: feather wings, wind chimes · 6 ember_foundry: furnace jambs with glowing heat channels, twin stacks · 7 forge_yard (home): oak and iron arch, strap hinges, shield crest with crossed hammers · 8 orchard_highlands: lattice trellis, apple bough · 9 gloamfen: reed bundle arch, verdigris loops, caged bog lights · 10 starfall_ridge: armillary crown, star fragments · 11 cloudbreak_keep: crenellated towers, voussoirs, heraldic fins and shield.

## Shader `portal_surface.gdshader`
- **Uniforms:** keeps every uniform from the reference shader, plus `theme` (0–11), `destination_view` (source_color, filter_linear_mipmap, repeat_disable), `view_strength`, `parallax_depth` and `refract_amount`.
- **Destination view:** shows clearly at the centre, under a soft veil. Bounded view parallax (≤0.06 UV) and field refraction (≤0.018 UV). The view is zoomed 6% so the parallax never shows the image edges.
- **Front vs rear:** the front shows the full destination. The rear shows it mirrored, at reduced strength, cooler and denser.
- **Rim:** sculpted, with a bright lip, a dark undercut and a soft halo.
- **Entrance and exit:** `swell` bulges the surface toward +Z and clears and brightens the centre. `release` sends one soft ring outward.
- **Distance detail:** `lod_detail` 0 turns off the noise and refraction and keeps only the analytic pattern.
- **Comfort:** no strobing; all motion is slow.

## Known limits (honest)
- The shader is compiled and reviewed in the native Godot 4.7.2 mobile renderer with fourteen baked destination views.
- The integrated builder keeps root strands and gill edges outside ±0.608 m below 2.05 m. The rebuilt Pinewood and Mooncap frames each report zero intruding vertices.
- The outer Starfall trail tapers to ±1.546 m, inside the 1.55 m envelope.
- No normal maps or baked AO; wear comes from the textures and the bevels. The UVs are procedural box and sweep projections.
- The preview renders use flat emissive veils, not the game shader.
