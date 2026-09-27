"""Deterministic build of the stylised orchard brook footbridge.

Run:  blender.exe -b --factory-startup --python build_bridge.py -- [--no-render]
Blender is Z-up; the glTF exporter converts to Y-up, so Blender +Z -> glTF +Y and
Blender -Y -> glTF +Z. The bridge is symmetric along its long axis, so the long axis
is modelled on Blender Y and becomes glTF/Godot Z. Origin = centre of walking deck top.
"""
import bpy, bmesh, math, random, json, os, sys, time
from mathutils import Matrix, Vector

T0 = time.perf_counter()
OUT = os.path.dirname(os.path.abspath(__file__))
RENDER = "--no-render" not in sys.argv
rng = random.Random(20260928)

# ---------------- dimensions (metres) ----------------
DECK_LEN = 5.0          # along Y (glTF Z)
WALK_W = 3.4            # clear walkway, x in [-1.7, 1.7]
HALF_W = WALK_W / 2
PLANK_T = 0.08
DECK_EDGE = 1.86        # plank ends overhang the walkway slightly
STRINGER_H = 0.36
STRINGER_TOP = -PLANK_T
ABUT_INNER = 2.0        # stream-side face of each abutment (clear span 4.0 m)
ABUT_OUTER = 2.62
ABUT_HALF_X = 2.25
BED_Z = -1.45           # stream bed below deck top
RAIL_X = 1.84           # rail centreline; inner faces stay >= 1.77
RAIL_TOP = 1.0
PILLAR_X, PILLAR_Y, PILLAR_S = 1.98, 2.32, 0.42

# ---------------- reset ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m

M = {
    "wood_a": mat("Timber_Warm", (0.46, 0.25, 0.11)),
    "wood_b": mat("Timber_Honey", (0.56, 0.33, 0.15)),
    "wood_c": mat("Timber_Weathered", (0.38, 0.24, 0.14)),
    "beam": mat("Timber_Dark", (0.24, 0.13, 0.06)),
    "stone": mat("Stone_Grey", (0.36, 0.36, 0.34), 0.9),
    "stone_b": mat("Stone_Cool", (0.29, 0.31, 0.32), 0.9),
    "moss": mat("Moss", (0.16, 0.30, 0.07), 0.95),
    "iron": mat("Iron_Black", (0.05, 0.05, 0.05), 0.5, 0.8),
}

# parts: name -> list of (bmesh-geometry build calls); each part becomes one object
parts = {}

def box(part, m, center, size, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    R = (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y')
         @ Matrix.Rotation(rot[0], 4, 'X'))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ R, verts=bm.verts)
    parts.setdefault(part, []).append((bm, m))

def j(a):  # symmetric jitter
    return rng.uniform(-a, a)

# ---------------- 1. usable structure ----------------
# Deck planks run across the bridge (along X), 20 boards with small gaps.
n_planks = 20
pitch = DECK_LEN / n_planks
woods = ["wood_a", "wood_b", "wood_c"]
for i in range(n_planks):
    y = -DECK_LEN / 2 + pitch * (i + 0.5)
    w = pitch - 0.022
    ext_l, ext_r = rng.uniform(0, 0.05), rng.uniform(0, 0.05)
    x0, x1 = -DECK_EDGE - ext_l, DECK_EDGE + ext_r
    sink = rng.uniform(0.0, 0.008)  # tops stay at or just below Y=0
    box("Deck", rng.choice(woods), ((x0 + x1) / 2, y, -PLANK_T / 2 - sink),
        (x1 - x0, w, PLANK_T), rot=(0, 0, j(0.006)), bevel=0.012)

# Stringers: 3 inner + 2 edge fascia beams, resting on abutment seats.
s_len = 2 * (ABUT_INNER + 0.42)
for x in (-1.15, 0.0, 1.15):
    box("Frame", M["beam"], (x, 0, STRINGER_TOP - STRINGER_H / 2),
        (0.22, s_len, STRINGER_H), bevel=0.02)
for x in (-1.72, 1.72):
    box("Frame", M["beam"], (x, 0, STRINGER_TOP - 0.2), (0.18, DECK_LEN - 0.1, 0.4), bevel=0.02)

# Abutments: coursed stone, full block depth, stepping out slightly toward the base.
seat_z = STRINGER_TOP - STRINGER_H  # top of abutment under stringers
for s in (-1, 1):
    z = BED_Z - 0.15
    course = 0
    while z < seat_z - 0.01:
        h = min(rng.uniform(0.24, 0.32), seat_z - z)
        batter = 0.08 * (1 - course / 5) if course < 5 else 0
        x = -ABUT_HALF_X - batter
        stagger = 0.3 if course % 2 else 0.0
        x_end = ABUT_HALF_X + batter
        first = True
        while x < x_end - 0.01:
            w = rng.uniform(0.45, 0.75) if not first else rng.uniform(0.3, 0.5) + stagger
            first = False
            w = min(w, x_end - x)
            y_in = ABUT_INNER - batter + j(0.02)
            box("Abutments", rng.choice(["stone", "stone", "stone_b"]),
                (x + w / 2, s * (y_in + ABUT_OUTER) / 2, z + h / 2),
                (w - 0.02, ABUT_OUTER - y_in, h - 0.02),
                rot=(j(0.02), j(0.02), 0), bevel=0.035)
            x += w
        z += h
        course += 1
    # timber end header closes the stringer void at each approach (was a stone slab
    # that clipped through the stringer ends - see HANDOFF defects)
    box("Frame", M["beam"], (0, s * (DECK_LEN / 2 - 0.06), STRINGER_TOP - STRINGER_H / 2),
        (2 * 1.81, 0.1, STRINGER_H), bevel=0.015)

# Collision / clearance helpers (Godot "-colonly" suffix => static collider only)
def col_box(name, center, size):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return me

# ---------------- 2. railings & pillars ----------------
for sx in (-1, 1):
    for sy in (-1, 1):
        px, py = sx * PILLAR_X, sy * PILLAR_Y
        zb = seat_z - 0.05
        z = zb
        k = 0
        while z < 0.9:  # stacked pillar stones
            h = rng.uniform(0.26, 0.34)
            h = min(h, 0.9 - z)
            box("Pillars", rng.choice([M["stone"], M["stone_b"]]),
                (px + j(0.015), py + j(0.015), z + h / 2),
                (PILLAR_S + j(0.03), PILLAR_S + j(0.03), h - 0.015),
                rot=(0, 0, j(0.05)), bevel=0.03)
            z += h; k += 1
        box("Pillars", M["stone_b"], (px, py, 0.97), (PILLAR_S + 0.1, PILLAR_S + 0.1, 0.14), bevel=0.035)
        box("Pillars", M["stone"], (px, py, 1.09), (0.26, 0.26, 0.12), rot=(0, 0, 0.785), bevel=0.03)
        box("Moss", M["moss"], (px + sx * 0.05, py - sy * 0.04, 1.045),
            (0.36, 0.3, 0.035), rot=(0, 0, j(0.3)), bevel=0.012)

# Posts, rails and a timber X brace per bay (parapet stays outside |x| 1.7).
post_y = [-1.25, 0.0, 1.25]
rail_y0, rail_y1 = -(PILLAR_Y - PILLAR_S / 2), PILLAR_Y - PILLAR_S / 2
for sx in (-1, 1):
    x = sx * RAIL_X
    for py in post_y:
        box("Railings", M["wood_c"], (x, py, (RAIL_TOP - 0.05 - 0.42) / 2),
            (0.13, 0.13, RAIL_TOP - 0.05 + 0.42), bevel=0.015)
        box("Railings", M["wood_b"], (x, py, RAIL_TOP + 0.02), (0.17, 0.17, 0.05), bevel=0.012)
        for dz in (-0.3, -0.16):  # bolts on fascia side
            box("Ironwork", M["iron"], (x + sx * 0.07, py, dz), (0.02, 0.05, 0.05))
    box("Railings", M["wood_a"], (x, 0, RAIL_TOP - 0.045), (0.15, rail_y1 - rail_y0, 0.1),
        bevel=0.02)
    box("Railings", M["wood_b"], (x, 0, 0.42), (0.1, rail_y1 - rail_y0, 0.08), bevel=0.015)
    # X braces between mid and top rail in each bay
    bays = [rail_y0, *post_y, rail_y1]
    for a, b in zip(bays[:-1], bays[1:]):
        cy, L, H = (a + b) / 2, b - a - 0.14, 0.9 - 0.47
        ang = math.atan2(H, L)
        for sgn, off in ((1, 0.025), (-1, -0.025)):
            box("Railings", M["wood_c"], (x + sx * off, cy, 0.46 + H / 2),
                (0.06, math.hypot(L, H), 0.07), rot=(sgn * ang, 0, 0), bevel=0.01)
    # iron straps where the top rail meets the pillars
    for sy in (-1, 1):
        box("Ironwork", M["iron"], (x, sy * (rail_y1 - 0.08), RAIL_TOP - 0.045), (0.17, 0.04, 0.12))

# ---------------- 3. substructure detail ----------------
# Knee braces from abutment face up to stringers under each inner stringer.
for s in (-1, 1):
    for x in (-1.15, 0.0, 1.15):
        y0, z0 = s * (ABUT_INNER - 0.02), -1.0
        y1, z1 = s * 1.15, seat_z + 0.02
        mid = Vector((x, (y0 + y1) / 2, (z0 + z1) / 2))
        d = Vector((0, y1 - y0, z1 - z0))
        ang = math.atan2(d.z, d.y)
        box("Frame", M["beam"], mid, (0.16, d.length, 0.16), rot=(ang, 0, 0), bevel=0.015)
        box("Ironwork", M["iron"], (x, y1 + s * 0.05, seat_z - 0.02), (0.2, 0.22, 0.03))
    # cross beam (bearing sill) on each abutment seat
    box("Frame", M["beam"], (0, s * (ABUT_INNER + 0.22), seat_z + 0.0), (3.6, 0.26, 0.1), bevel=0.015)
# mid-span cross tie between stringers
box("Frame", M["beam"], (0, 0, seat_z + 0.12), (3.3, 0.14, 0.16), bevel=0.015)

# Moss on abutment ledges and along the stream-side lower courses
for s in (-1, 1):
    for i in range(7):
        x = rng.uniform(-2.0, 2.0)
        z = rng.uniform(BED_Z, BED_Z + 0.5)
        box("Moss", M["moss"], (x, s * (ABUT_INNER - 0.1), z),
            (rng.uniform(0.25, 0.6), 0.05, rng.uniform(0.1, 0.22)), rot=(0, j(0.2), 0), bevel=0.012)
    for sx in (-1, 1):
        box("Moss", M["moss"], (sx * 2.12, s * (ABUT_INNER + 0.3), seat_z + 0.02),
            (0.2, 0.5, 0.04), bevel=0.01)

# ---------------- assemble objects ----------------
col_vis = bpy.data.collections.new("Bridge"); scene.collection.children.link(col_vis)
col_col = bpy.data.collections.new("Collision"); scene.collection.children.link(col_col)
root = bpy.data.objects.new("OrchardBrookFootbridge", None)
col_vis.objects.link(root)

for pname, items in parts.items():
    bm = bmesh.new()
    mats = []
    for sub, m in items:
        m = M[m] if isinstance(m, str) else m
        if m not in mats: mats.append(m)
        idx = mats.index(m)
        for f in sub.faces: f.material_index = idx
        me_tmp = bpy.data.meshes.new("tmp"); sub.to_mesh(me_tmp); sub.free()
        bm.from_mesh(me_tmp); bpy.data.meshes.remove(me_tmp)
    me = bpy.data.meshes.new(pname)
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for p in me.polygons: p.use_smooth = False
    ob = bpy.data.objects.new(pname, me); ob.parent = root
    col_vis.objects.link(ob)

colliders = {
    "COL_Deck-colonly": ((0, 0, -0.06), (2 * DECK_EDGE, DECK_LEN, 0.12)),
    "COL_RailL-colonly": ((-RAIL_X, 0, 0.5), (0.14, 2 * PILLAR_Y + PILLAR_S, 1.0)),
    "COL_RailR-colonly": ((RAIL_X, 0, 0.5), (0.14, 2 * PILLAR_Y + PILLAR_S, 1.0)),
    "COL_AbutN-colonly": ((0, (ABUT_INNER + ABUT_OUTER) / 2, (BED_Z + seat_z) / 2),
                          (2 * ABUT_HALF_X, ABUT_OUTER - ABUT_INNER, seat_z - BED_Z)),
    "COL_AbutS-colonly": ((0, -(ABUT_INNER + ABUT_OUTER) / 2, (BED_Z + seat_z) / 2),
                          (2 * ABUT_HALF_X, ABUT_OUTER - ABUT_INNER, seat_z - BED_Z)),
}
for sx in (-1, 1):
    for sy in (-1, 1):
        colliders[f"COL_Pillar{'LR'[sx>0]}{'SN'[sy>0]}-colonly"] = (
            (sx * PILLAR_X, sy * PILLAR_Y, (seat_z + 1.15) / 2), (0.52, 0.52, 1.15 - seat_z))
for n, (c, sz) in colliders.items():
    ob = bpy.data.objects.new(n, col_box(n, c, sz)); ob.parent = root
    ob.display_type = 'WIRE'; ob.hide_render = True
    col_col.objects.link(ob)

# ---------------- measurements & self checks ----------------
def world_bounds(obs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in obs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

vis = [o for o in col_vis.objects if o.type == 'MESH']
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in vis)
lo, hi = world_bounds(vis)
deck_lo, deck_hi = world_bounds([bpy.data.objects["Deck"]])
# walkway intrusion: any rail/pillar vertex above deck with |x| < 1.7 ?
intrude = 0.0
for o in (bpy.data.objects["Railings"], bpy.data.objects["Pillars"]):
    for v in o.data.vertices:
        if v.co.z > 0.0 and abs(v.co.y) < DECK_LEN / 2:
            intrude = max(intrude, HALF_W - abs(v.co.x))
clear_inner = min(abs(v.co.x) for o in (bpy.data.objects["Railings"], bpy.data.objects["Pillars"])
                  for v in o.data.vertices if v.co.z > 0.0)
assert intrude <= 0.0, f"parapet intrudes walkway by {intrude:.3f} m"
assert abs(deck_hi.z) < 0.001, deck_hi.z
assert 4.9 < deck_hi.y - deck_lo.y < 5.2

gl = lambda v: [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]  # Blender -> glTF axes
info = {
    "asset": "orchard_brook_footbridge",
    "units": "metres", "up_axis": "+Y (glTF)", "long_axis": "+Z (glTF)",
    "origin": "centre of walking deck top surface",
    "deck": {"length_m": DECK_LEN, "top_y": 0.0, "plank_thickness_m": PLANK_T,
             "clear_walkway_width_m": WALK_W, "walkway_x_range": [-HALF_W, HALF_W],
             "min_parapet_inner_x_m": round(clear_inner, 3),
             "min_clearance_margin_m": round(clear_inner - HALF_W, 3),
             "headroom": "unobstructed (no overhead members)"},
    "span": {"abutment_inner_faces_z": [-ABUT_INNER, ABUT_INNER], "clear_span_m": 2 * ABUT_INNER,
             "stream_bed_y": BED_Z, "clear_height_under_stringers_m": round(seat_z - BED_Z, 3),
             "suits_stream_width_m": [3.0, 4.0]},
    "parapet_height_above_deck_m": RAIL_TOP, "pillar_cap_top_m": 1.15,
    "bounds_gltf": {"min": gl(Vector((lo.x, hi.y, lo.z))), "max": gl(Vector((hi.x, lo.y, hi.z)))},
    "collision": {n: {"center_gltf": gl(Vector(c)), "size_gltf": [sz[0], sz[2], sz[1]]}
                  for n, (c, sz) in colliders.items()},
    "collision_note": "Nodes ending -colonly import in Godot as StaticBody3D shapes only; "
                      "walkable surface is COL_Deck (top y=0). Approaches meet the deck at y=0 at z=+-2.5.",
    "render_meshes": [o.name for o in vis], "render_triangles": tris,
    "materials": [m.name for m in M.values()],
}
T_BUILD = time.perf_counter() - T0

# ---------------- save & export ----------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "bridge.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "bridge.glb"), export_format='GLB',
                          export_apply=True, export_yup=True)
T_EXPORT = time.perf_counter() - T0 - T_BUILD

# ---------------- review renders ----------------
T_RENDER = 0.0
if RENDER:
    t = time.perf_counter()
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 1280, 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.7, 0.78, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
    sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), math.radians(15), math.radians(35))
    scene.collection.objects.link(sun)
    # neutral review ground/water plane at stream bed so underside reads
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=9)
    bmesh.ops.translate(bm, vec=Vector((0, 0, BED_Z - 0.02)), verts=bm.verts)
    gme = bpy.data.meshes.new("ReviewGround"); bm.to_mesh(gme); bm.free()
    gme.materials.append(mat("ReviewGround", (0.2, 0.28, 0.3), 0.6))
    ground = bpy.data.objects.new("ReviewGround", gme); scene.collection.objects.link(ground)
    col_col.hide_render = True
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, -0.3))
    views = {  # name: (location, ortho scale or None, hide ground)
        "front": (Vector((0, -14, -0.2)), 7.0, False),        # looking along the deck
        "side": (Vector((14, 0, -0.2)), 7.5, False),
        "top": (Vector((0, 0, 14)), 7.5, False),
        "three_quarter": (Vector((7.5, -7.5, 4.5)), None, False),
        "back_underside": (Vector((-6.0, 6.5, -3.2)), None, True),
    }
    for name, (loc, ortho, hide_g) in views.items():
        ground.hide_render = hide_g
        cam.location = loc
        cam.data.type = 'ORTHO' if ortho else 'PERSP'
        if ortho: cam.data.ortho_scale = ortho
        else: cam.data.lens = 35
        tgt = target if name != "top" else Vector((0, 0.001, 0))
        cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, f"review_{name}.png")
        bpy.ops.render.render(write_still=True)
    T_RENDER = time.perf_counter() - t

info["timing_s"] = {"build": round(T_BUILD, 2), "save_export": round(T_EXPORT, 2),
                    "render_5_views": round(T_RENDER, 2)}
with open(os.path.join(OUT, "asset.json"), "w") as f:
    json.dump(info, f, indent=2)
print("BUILD_OK", json.dumps(info["timing_s"]), "tris", tris, "clear_margin", info["deck"]["min_clearance_margin_m"])
