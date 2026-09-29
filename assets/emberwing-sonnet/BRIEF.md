# Emberwing visual revision from the actual game

Work only here, on the supplied builder.py and source.blend/GLBs. Keep all game coordinates, marker/pivot names, metre scale and budgets in HANDOFF.md. You are the 3D artist, Codex owns logic. Personal subscription model Sonnet 5.5. No live checkout changes or external services. Blender ../../tools/blender-4.5.13-windows-x64/blender.exe. 8-minute time cap; export before final render; preserve deterministic builder -- --out ABS_DIR, editable source.blend and HANDOFF.

Review game-first.png (actual Godot Mobile renderer) and reference.png. Bow is functional now. First result has fine metal feathers, but is a regular fern/leaf frond with mirrored feather ladders. It lacks the original's powerful phoenix identity and dark-to-fire material contrast. Please make a substantial artistic improvement, within the exact mechanical contract:

- Much stronger swept, recurved wing silhouette for each limb. Fewer, layered feather clusters with varied lengths and curving primaries; avoid the current regularly repeated upward/downward ladder. Keep slim real bow cores and string tips where they belong. Remember vertical bow orientation unlike the horizontal concept art.
- A legible phoenix head/bust around the upper grip, pointing towards -Z, a visible eye/beak, and a glowing heart. Current tiny splayed fan is not a readable bird. More distinctive but leave arrow port and fingers absolutely clear.
- Richer dark wood with baked grain and leather grip, nuanced brass roughness, deeper orange ember interiors framed by gold edges, a few azure tip accents. Reference has bright orange fire and deep shadows, not mostly beige leaves. Keep metal believable and emissive cost bounded. Do not whitewash the wood. No local lights/large particle systems.
- Wings in flight need to feel ethereal, swept and tapered; some azure-gold flame tips. You may refine them within 2800 tris/3 surfaces. Arrow remains conventional with normal shaft and steel tip.

Preserve required markers, arrow line, 3.5cm grip, 1.25m height, 22k bow triangle cap, 14 surfaces. Exact final Godot coords +Y up/-Z forwards. No fixed string: runtime creates it. String tips should coincide with real mechanical bow tips at y=+/-0.60,z=0.10. Code rotates UpperLimb/LowerLimb about their grip-origin pivots for modest elastic flex.

Export bow.glb, arrow.glb and wings.glb, update builder.py, source.blend, HANDOFF.md. Render three-quarter and wings only after exports, use existing render.py. Report actual budgets and significant visual changes. The next review will be in the real game again.
