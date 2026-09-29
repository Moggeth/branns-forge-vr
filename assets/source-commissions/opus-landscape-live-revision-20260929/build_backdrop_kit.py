"""Deterministic Blender 4.5 builder: Orchard backdrop massifs (drop-in for the stepped mountains).

Run:  blender --background --factory-startup --python build_backdrop_kit.py -- --out ABS_DIR
Emits ABS_DIR/mountain_cliff_chunk.glb, ABS_DIR/mountain_peak_snow.glb and backdrop_kit.blend.

Source of the stepped pale mountains in real captures: godot/orchard_art.gd places
  8 x mountain_cliff_chunk at r=226 m and 3 x mountain_peak_snow at r=395 m
from res://assets/orchard/<id>.glb (MultiMesh, no shadows, no collision, yaw varies per placement).
These GLBs keep the originals' footprint/pivot (base at y=-4, cliff ~86x52 m tall, peak ~122x105 m),
so the swap is a file replacement only. Because yaw is not consistently facing the Orchard, each
massif reads from every side (no billboard front).

Look: ridged, gullied, flat-faceted massifs on a jittered (non-lattice) grid; no terraces.
Vertex colour is sRGB-authored -> linear. Values stay mid/dark so the scene's own fog provides
aerial perspective (the old near-white stone ignored atmospheric scale). Forested lower slopes,
scree fans, cool rock on steep faces, snow only on gentle high faces of the far peak.
orchard_art.gd restores vertex-colour albedo via Finish.apply_mesh, so no material work is needed.
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("backdrop_out")
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(c):
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(max(0.0, min(1.0, v))) for v in c)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


ROCK = (0.40, 0.40, 0.43)
ROCK_WARM = (0.46, 0.42, 0.38)
ROCK_DARK = (0.27, 0.28, 0.31)
SCREE = (0.52, 0.50, 0.47)
FOREST = (0.15, 0.25, 0.13)
FOREST_B = (0.20, 0.30, 0.14)
MEADOW = (0.36, 0.44, 0.22)
SNOW = (0.86, 0.89, 0.92)


def massif(name, half_x, half_z, height, seed, cells_x, cells_z, snow_line=None):
    r = random.Random(seed)
    so = Vector((seed * 3.1, seed * 1.7, 0))
    bm = bmesh.new()
    grid = []
    # main ridge axis: a bent line so the crest is not a cone apex
    bend = r.uniform(-0.35, 0.35)
    for iz in range(cells_z + 1):
        row = []
        for ix in range(cells_x + 1):
            u = ix / cells_x * 2 - 1
            v = iz / cells_z * 2 - 1
            if 0 < ix < cells_x and 0 < iz < cells_z:
                u += r.uniform(-0.35, 0.35) / cells_x * 2
                v += r.uniform(-0.35, 0.35) / cells_z * 2
            x, z = u * half_x, v * half_z
            # elliptical footprint with ragged edge
            edge = 1.0 + noise.noise(Vector((u * 2.0, v * 2.0, 0)) + so) * 0.18
            rr = math.sqrt(u * u + v * v) / edge
            env = max(0.0, 1.0 - rr * rr) ** 1.15
            # distance to bent ridge line -> ridge-dominant crest, secondary spurs
            ridge_v = v - bend * u * u
            spine = math.exp(-(ridge_v * ridge_v) * 5.0)
            p = Vector((x / half_x * 1.6, z / half_z * 1.6, 0)) + so
            ridged = 1.0 - abs(noise.noise(p))
            ridged2 = 1.0 - abs(noise.noise(p * 2.3 + Vector((5, 1, 0))))
            gully = abs(noise.noise(Vector((u * 5.0, v * 1.4, 0)) + so))   # downslope gullies
            h = env * (0.45 + 0.55 * spine) * (0.55 + 0.3 * ridged + 0.15 * ridged2)
            h *= 0.82 + 0.18 * min(1.0, gully * 3.0)
            y = -4.0 + (height + 4.0) * h if rr < 1.0 else -4.0 - (rr - 1.0) * 6.0
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for iz in range(cells_z):
        for ix in range(cells_x):
            a, b, c, d = grid[iz][ix], grid[iz][ix + 1], grid[iz + 1][ix + 1], grid[iz + 1][ix]
            # alternate diagonal by noise, avoids a visible triangulation grain
            if (ix * 7 + iz * 3 + seed) % 3:
                bm.faces.new([a, d, c]); bm.faces.new([a, c, b])
            else:
                bm.faces.new([a, d, b]); bm.faces.new([b, d, c])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.y < 0:
            f.normal_flip()
    bm.normal_update()
    layer = bm.loops.layers.float_color.new("Col")
    for f in bm.faces:
        c = f.calc_center_median()
        h = (c.y + 4.0) / (height + 4.0)
        up = f.normal.y
        k = r.uniform(0.9, 1.08)
        if up < 0.55:                                  # steep: cliff rock, cool and darker in gullies
            col = mix(ROCK, ROCK_DARK, 0.4 + r.random() * 0.5) if up < 0.35 else mix(ROCK_WARM, ROCK, r.random())
        elif h < 0.38 + noise.noise(c * 0.05) * 0.12:  # forested skirts in clumps
            col = FOREST if r.random() < 0.6 else FOREST_B
        elif h < 0.6:
            col = mix(MEADOW, SCREE, r.random() * 0.6) if r.random() < 0.55 else mix(FOREST_B, MEADOW, 0.5)
        else:
            col = mix(SCREE, ROCK, r.random())
        if snow_line is not None and h > snow_line + noise.noise(c * 0.04) * 0.08 and up > 0.5:
            col = mix(SNOW, ROCK, 0.08 * r.random())
        cl = lin(tuple(v * k for v in col))
        for loop in f.loops:
            loop[layer] = (cl[0], cl[1], cl[2], 1.0)
        f.smooth = False
    for v in bm.verts:                                   # Godot Y-up -> Blender Z-up
        x, y, z = v.co
        v.co = Vector((x, -z, y))
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.color_attributes.active_color = me.color_attributes["Col"]
    mat = bpy.data.materials.new(name + "_Rock")
    mat.use_nodes = True
    vc = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mat.node_tree.links.new(vc.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


pieces = [
    ("mountain_cliff_chunk", massif("mountain_cliff_chunk", 43.0, 26.0, 50.0, 3, 26, 16)),
    ("mountain_peak_snow", massif("mountain_peak_snow", 60.0, 47.0, 104.0, 8, 30, 24, snow_line=0.72)),
]
for name, ob in pieces:
    for o in bpy.data.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + ".glb"), export_format="GLB", use_selection=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_apply=True, export_yup=True)
    print("BACKDROP", name, "tris", tris)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "backdrop_kit.blend"))
print("BACKDROP_OK", out)
