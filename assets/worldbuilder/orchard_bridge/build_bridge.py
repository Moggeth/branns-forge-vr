"""Deterministic build of the stylised orchard brook footbridge.

Run:  blender.exe --background --factory-startup --python build_bridge.py -- [--no-render]
Blender frame: X = width, Y = long axis, Z = up.  glTF export (+Y up) maps
Blender Y -> glTF -Z, so the long axis is glTF/Godot Z (bridge is symmetric).
Walking surface top is Z=0 (glTF Y=0), origin is the deck centre.
"""
import bpy, bmesh, math, random, json, os, sys, time
from mathutils import Vector, Matrix

T0 = time.perf_counter()
OUT = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--no-render" not in ARGS
RNG = random.Random(20260928)

# ---------------- key dimensions (metres) ----------------
DECK_LEN = 5.0            # along Y
CLEAR_W = 3.4             # walkway, |x| <= 1.7
HW = CLEAR_W / 2
WALL_T = 0.40             # parapet/spandrel wall thickness, x 1.70..2.10
WALL_OUT = HW + WALL_T
PARAPET_H = 0.90          # top of coping above deck
COPE_H = 0.12
POST = 0.55               # end post footprint, x 1.70..2.25
POST_TOP = 1.05
CAP_H = 0.18
PLANK_T = 0.08
SILL_T = 0.20             # timber sill band z -0.20..0
SPAN_HALF = 2.30          # clear span 4.6 m between abutment faces
ABUT_BACK = 2.95
FOOT_Z = -1.60            # stream bank / bed level for footings
SPRING_Z = -1.15
CROWN_Z = -0.62           # arch intrados crown
RING = 0.40               # voussoir ring depth (extrados crown meets the timber sill)
STRINGER_Z = (-0.40, -PLANK_T)

rise = CROWN_Z - SPRING_Z
R = (SPAN_HALF ** 2 + rise ** 2) / (2 * rise)
ARC_CZ = CROWN_Z - R


def intrados(y):
    return ARC_CZ + math.sqrt(max(R * R - y * y, 0.0))


def extrados(y):
    return ARC_CZ + math.sqrt(max((R + RING) ** 2 - y * y, 0.0))


# ---------------- scene reset ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'


def mat(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1)
    return m


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


MATS = {
    "stone": mat("stone_grey", srgb("a39d92")),
    "stone_warm": mat("stone_warm", srgb("8f887c")),
    "moss": mat("moss", srgb("7d9426"), 0.95),
    "wood": mat("wood_plank", srgb("9a6a42"), 0.8),
    "wood_alt": mat("wood_plank_alt", srgb("86593a"), 0.8),
    "wood_dark": mat("wood_beam", srgb("5e3e27"), 0.85),
    "iron": mat("iron_nail", srgb("3a3634"), 0.5, 0.7),
}
BM = {k: bmesh.new() for k in MATS}   # one merged mesh per material


def add_verts_faces(bm, verts, faces):
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    return vs


def box(key, x0, x1, y0, y1, z0, z1, bevel=0.035):
    """Axis box with a single-segment chamfer (stylised rounded stone/timber)."""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0),
                       (y0 + y1) / 2 + v.co.y * (y1 - y0),
                       (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    b = min(bevel, (x1 - x0) * 0.3, (y1 - y0) * 0.3, (z1 - z0) * 0.3)
    if b > 0.004:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=b, segments=1, affect='EDGES')
    merge(key, tmp)


def prism(key, quad_yz, x0, x1, bevel=0.03):
    """Extrude a YZ quad (4 (y,z) points, CCW seen from +X) between x0..x1."""
    tmp = bmesh.new()
    vs = [(x0, y, z) for y, z in quad_yz] + [(x1, y, z) for y, z in quad_yz]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    add_verts_faces(tmp, vs, faces)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=1, affect='EDGES')
    merge(key, tmp)


def merge(key, tmp):
    me = bpy.data.meshes.new("tmp")
    tmp.to_mesh(me)
    tmp.free()
    BM[key].from_mesh(me)
    bpy.data.meshes.remove(me)


def stone_key():
    return "stone" if RNG.random() < 0.6 else "stone_warm"


def moss_blob(cx, cy, cz, sx, sy, sz, spin=True):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=1.0)
    # spin only flat (top) patches; wall patches must keep their thin axis on X
    rot = Matrix.Rotation(RNG.uniform(0, math.tau) if spin else 0.0, 3, 'Z')
    for v in tmp.verts:
        j = 1 + RNG.uniform(-0.18, 0.18)
        p = rot @ Vector((v.co.x * sx * j, v.co.y * sy * j, v.co.z * sz))
        v.co = p + Vector((cx, cy, cz))
    merge("moss", tmp)


def course_blocks(y0, y1, lengths=(0.42, 0.62), offset=0.0):
    """Split [y0,y1] into staggered block extents."""
    out, y = [], y0
    first = True
    while y < y1 - 1e-4:
        L = RNG.uniform(*lengths)
        if first and offset:
            L = offset
        first = False
        ye = min(y + L, y1)
        if y1 - ye < lengths[0] * 0.5:
            ye = y1
        out.append((y, ye))
        y = ye
    return out


GAP = 0.018  # mortar joint (visible as the chamfer groove)

# ================= STRUCTURE =================
# --- abutments (full width, buried in each bank; carry stringers + arch springing)
for s in (-1, 1):
    ya, yb = sorted((s * SPAN_HALF, s * ABUT_BACK))
    z = FOOT_Z
    for zi, zt in enumerate((-1.15, -0.72, STRINGER_Z[0])):
        for xa, xb in course_blocks(-WALL_OUT - 0.15, WALL_OUT + 0.15, (0.5, 0.8), 0.35 if zi % 2 else 0):
            box(stone_key(), xa + GAP / 2, xb - GAP / 2, ya + GAP / 2, yb - GAP / 2, z + GAP / 2, zt - GAP / 2)
        z = zt
    # threshold landing: stone kerb flush with the deck top behind each deck end,
    # so the walk surface meets the bank without a hole over the abutment
    la, lb = sorted((s * DECK_LEN / 2, s * ABUT_BACK))
    for xa, xb in course_blocks(-HW - POST, HW + POST, (0.55, 0.8)):
        box(stone_key(), xa + GAP / 2, xb - GAP / 2, la + GAP / 2, lb - GAP / 2, STRINGER_Z[0] + GAP / 2, -0.004, 0.03)

# --- arch rings + spandrels under each side wall
N_VOUS = 13
for sx in (-1, 1):
    x0, x1 = sorted((sx * HW, sx * WALL_OUT))
    a0 = math.asin(SPAN_HALF / R)
    for i in range(N_VOUS):
        ta = -a0 + 2 * a0 * i / N_VOUS + 0.004
        tb = -a0 + 2 * a0 * (i + 1) / N_VOUS - 0.004
        q = []
        for t, rr in ((ta, R), (tb, R), (tb, R + RING), (ta, R + RING)):
            q.append((rr * math.sin(t), ARC_CZ + rr * math.cos(t)))
        prism(stone_key(), q, x0 - 0.02 * sx, x1 + 0.02 * sx, 0.03)
    # spandrel masonry: columns whose bottom follows the extrados
    ystops = [y for y, _ in course_blocks(-SPAN_HALF, SPAN_HALF, (0.5, 0.7))] + [SPAN_HALF]
    for ya, yb in zip(ystops[:-1], ystops[1:]):
        za, zb = extrados(ya) + GAP, extrados(yb) + GAP
        top = -SILL_T - GAP / 2
        if max(za, zb) > top - 0.06:
            continue
        mid = max(za, zb) + (top - max(za, zb)) * 0.55
        if top - max(za, zb) > 0.45:   # two courses where there is room
            prism(stone_key(), [(ya + GAP / 2, za), (yb - GAP / 2, zb), (yb - GAP / 2, mid - GAP / 2), (ya + GAP / 2, mid - GAP / 2)], x0, x1)
            box(stone_key(), x0, x1, ya + GAP / 2, yb - GAP / 2, mid + GAP / 2, top)
        else:
            prism(stone_key(), [(ya + GAP / 2, za), (yb - GAP / 2, zb), (yb - GAP / 2, top), (ya + GAP / 2, top)], x0, x1)
    # spandrel end fill between arch springing and the posts over the abutment
    # (handled by posts which extend to the footing)

    # timber sill band carried by the side wall (the wooden stripe on the sheet)
    box("wood_dark", x0 + 0.02, x1 - 0.02, -(DECK_LEN / 2 - POST), DECK_LEN / 2 - POST, -SILL_T, -0.005, 0.02)

    # --- parapet above the deck: 2 coursed rows + coping
    wy0, wy1 = -(DECK_LEN / 2 - POST), DECK_LEN / 2 - POST
    z = 0.0
    for ci, zt in enumerate((0.40, PARAPET_H - COPE_H)):
        for ya, yb in course_blocks(wy0, wy1, (0.42, 0.62), 0.28 if ci % 2 else 0):
            box(stone_key(), x0, x1, ya + GAP / 2, yb - GAP / 2, z + GAP / 2, zt - GAP / 2)
        z = zt
    for ya, yb in course_blocks(wy0, wy1, (0.5, 0.75)):
        # coping: overhangs OUTWARD only; inner face stays at |x| = 1.7
        cx0, cx1 = (x0, x1 + 0.05) if sx > 0 else (x0 - 0.05, x1)
        box(stone_key(), cx0, cx1, ya + GAP / 2, yb - GAP / 2, PARAPET_H - COPE_H + GAP / 2, PARAPET_H, 0.04)
        if RNG.random() < 0.55:
            r = min(RNG.uniform(0.13, 0.2), (yb - ya) * 0.4)   # circular so spin keeps it off the walkway
            moss_blob(sx * (HW + 0.21), (ya + yb) / 2, PARAPET_H, r * 0.8, r * 0.8, 0.035)

    # --- end posts: full height from footing, large blocks + cap
    for sy in (-1, 1):
        ya, yb = sorted((sy * (DECK_LEN / 2 - POST), sy * DECK_LEN / 2))
        px0, px1 = sorted((sx * HW, sx * (HW + POST)))
        levels = [FOOT_Z, -1.05, -0.45, 0.12, 0.60, POST_TOP]
        for za, zb in zip(levels[:-1], levels[1:]):
            grow = 0.04 if za == FOOT_Z else 0.0      # plinth course
            gx0 = px0 if sx > 0 else px0 - grow
            gx1 = px1 + grow if sx > 0 else px1
            box(stone_key(), gx0, gx1, ya - grow + GAP / 2, yb + grow - GAP / 2, za + GAP / 2, zb - GAP / 2, 0.045)
        # cap: overhangs outward and along Y only, never into the walkway
        cx0, cx1 = (px0, px1 + 0.06) if sx > 0 else (px0 - 0.06, px1)
        box(stone_key(), cx0, cx1, ya - 0.05, yb + 0.05, POST_TOP + GAP / 2, POST_TOP + CAP_H, 0.05)
        moss_blob((cx0 + cx1) / 2 + sx * 0.03, (ya + yb) / 2, POST_TOP + CAP_H, 0.23, 0.23, 0.05)
        # moss creeping down the outer face and plinth
        moss_blob(px1 + 0.01 if sx > 0 else px0 - 0.01, (ya + yb) / 2 + RNG.uniform(-0.1, 0.1),
                  RNG.uniform(0.2, 0.7), 0.03, 0.16, 0.14, spin=False)
        moss_blob((px0 + px1) / 2, yb + 0.06 if sy > 0 else ya - 0.06, FOOT_Z + 0.05, 0.25, 0.12, 0.07)

    # moss tufts on wall faces / arch
    for _ in range(7):
        y = RNG.uniform(-1.3, 1.3)
        z = RNG.uniform(-0.9, 0.7)
        if z < extrados(y) and z > intrados(y) - 0.02:
            pass
        elif z < intrados(y):
            continue
        moss_blob(x1 + 0.005 if sx > 0 else x0 - 0.005, y, z, 0.03, RNG.uniform(0.12, 0.2), RNG.uniform(0.07, 0.12), spin=False)

# --- timber stringers (carry the deck; bear on abutments)
for x in (-1.40, -0.70, 0.0, 0.70, 1.40):
    box("wood_dark", x - 0.11, x + 0.11, -2.5, 2.5, STRINGER_Z[0], STRINGER_Z[1] - 0.004, 0.02)
# cross braces between stringers at third points (stop stringers rolling)
for y in (-0.8, 0.8):
    box("wood_dark", -1.40, 1.40, y - 0.07, y + 0.07, -0.34, -0.14, 0.015)

# --- deck planks across the width (the sheet's top view: planks run across)
N_PL = 17
pw = DECK_LEN / N_PL
for i in range(N_PL):
    y0 = -DECK_LEN / 2 + i * pw
    key = "wood" if i % 3 else "wood_alt"
    dz = RNG.uniform(-0.006, 0.0)
    box(key, -HW - 0.02, HW + 0.02, y0 + 0.008, y0 + pw - 0.008, -PLANK_T, dz, 0.012)
    for x in (-1.40, 0.0, 1.40):   # nail heads over stringers
        for yy in (y0 + pw * 0.3, y0 + pw * 0.7):
            box("iron", x - 0.012, x + 0.012, yy - 0.012, yy + 0.012, dz - 0.001, dz + 0.004, 0.0)

# ================= OBJECTS =================
col_vis = bpy.data.collections.new("bridge_visual")
col_col = bpy.data.collections.new("bridge_collision")
scene.collection.children.link(col_vis)
scene.collection.children.link(col_col)
root = bpy.data.objects.new("orchard_brook_bridge", None)
col_vis.objects.link(root)

for key, bm in BM.items():
    if not bm.verts:
        continue
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    me = bpy.data.meshes.new(f"bridge_{key}")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[key])
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(f"bridge_{key}", me)
    ob.parent = root
    col_vis.objects.link(ob)

# collision proxies (Godot: "-colonly" suffix -> StaticBody3D + convex/trimesh shape)
COLL = {
    "walkway": (-HW, HW, -ABUT_BACK, ABUT_BACK, -0.20, 0.0),   # deck + stone landings
    "parapet_L": (-(HW + POST + 0.06), -HW, -DECK_LEN / 2 - 0.05, DECK_LEN / 2 + 0.05, -0.20, POST_TOP + CAP_H),
    "parapet_R": (HW, HW + POST + 0.06, -DECK_LEN / 2 - 0.05, DECK_LEN / 2 + 0.05, -0.20, POST_TOP + CAP_H),
}
for name, (x0, x1, y0, y1, z0, z1) in COLL.items():
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    me = bpy.data.meshes.new(f"col_{name}")
    tmp.to_mesh(me)
    tmp.free()
    ob = bpy.data.objects.new(f"col_{name}-colonly", me)
    ob.parent = root
    ob.display_type = 'WIRE'
    ob.hide_render = True
    col_col.objects.link(ob)

build_s = time.perf_counter() - T0

# ================= STATS / EXPORT =================
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

vis = [o for o in col_vis.objects if o.type == 'MESH']
mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
for o in vis:
    for v in o.data.vertices:
        mins = Vector(map(min, mins, v.co)); maxs = Vector(map(max, maxs, v.co))
# walkway intrusion check: any visual vertex with |x| < 1.7 above deck top?
intrude = [o.name for o in vis for v in o.data.vertices if abs(v.co.x) < HW - 1e-4 and v.co.z > 0.0055]
stats = {
    "visual_meshes": len(vis),
    "visual_triangles": sum(tri_count(o) for o in vis),
    "per_mesh_triangles": {o.name: tri_count(o) for o in vis},
    "bounds_blender_min": [round(c, 4) for c in mins],
    "bounds_blender_max": [round(c, 4) for c in maxs],
    "walkway_intrusions": intrude,
    "build_seconds": round(build_s, 3),
}

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "bridge.blend"))
t = time.perf_counter()
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "bridge.glb"), export_format='GLB',
                          export_yup=True, export_apply=True, export_extras=False)
stats["export_seconds"] = round(time.perf_counter() - t, 3)

asset = {
    "id": "orchard_brook_footbridge",
    "units": "metres",
    "axes_gltf": {"up": "+Y", "long_axis": "Z (symmetric)", "origin": "centre of walking deck, deck top at Y=0"},
    "deck": {"length_m": DECK_LEN, "clear_walk_width_m": CLEAR_W, "walk_top_y": 0.0,
             "walkway_x_range": [-HW, HW], "walkway_z_range": [-DECK_LEN / 2, DECK_LEN / 2],
             "stone_landing_abs_z_range": [DECK_LEN / 2, ABUT_BACK]},
    "parapet": {"inner_face_abs_x": HW, "outer_abs_x": WALL_OUT, "coping_top_y": PARAPET_H,
                "post_top_y": POST_TOP + CAP_H, "post_outer_abs_x": HW + POST + 0.06},
    "span": {"clear_span_between_abutments_m": 2 * SPAN_HALF, "stream_width_supported_m": [3.0, 4.6],
             "arch_springing_y": SPRING_Z, "arch_crown_soffit_y": CROWN_Z,
             "timber_soffit_y": STRINGER_Z[0], "footing_y": FOOT_Z,
             "headroom_above_footing_at_centre_m": round(STRINGER_Z[0] - FOOT_Z, 3)},
    "overall_bounds_gltf": {"x": [round(mins.x, 3), round(maxs.x, 3)], "y": [round(mins.z, 3), round(maxs.z, 3)],
                            "z": [round(-maxs.y, 3), round(-mins.y, 3)]},
    "collision": {
        "nodes": [f"col_{k}-colonly" for k in COLL],
        "boxes_gltf_min_max": {k: {"min": [x0, z0, -y1], "max": [x1, z1, -y0]} for k, (x0, x1, y0, y1, z0, z1) in COLL.items()},
        "note": "Walkway box top at Y=0 is the walk surface; parapet boxes start exactly at |x|=1.7 so they never intrude into the walkway.",
    },
    "stats": stats,
}
with open(os.path.join(OUT, "asset.json"), "w") as f:
    json.dump(asset, f, indent=2)

# ================= RENDERS =================
if RENDER:
    t = time.perf_counter()
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 850
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new("w"); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.78, 0.74, 0.66, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
    sun.data.energy = 5.0
    sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(50), math.radians(12), math.radians(35))
    scene.collection.objects.link(sun)
    # stream-bed hint plane (render only, not exported: created after export)
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, FOOT_Z - 0.01))
    ground = bpy.context.active_object
    ground.data.materials.append(mat("ground", srgb("cfc6b3"), 1.0))

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam); scene.camera = cam
    tgt = Vector((0, 0, -0.2))

    def shot(name, loc, ortho=None, target=tgt):
        cam.location = Vector(loc)
        d = (Vector(target) - cam.location)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        if ortho:
            cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
        else:
            cam.data.type = 'PERSP'; cam.data.lens = 40
        scene.render.filepath = os.path.join(OUT, f"review_{name}.png")
        bpy.ops.render.render(write_still=True)

    shot("front", (0, -12, -0.2), 6.2)                 # down the long axis
    shot("side", (12, 0, -0.2), 7.0)                   # elevation
    cam.data.type = 'ORTHO'
    cam.location = (0, 0, 12); cam.rotation_euler = (0, 0, 0)
    cam.data.ortho_scale = 6.8
    scene.render.filepath = os.path.join(OUT, "review_top.png"); bpy.ops.render.render(write_still=True)
    shot("three_quarter", (7.0, -7.5, 4.6))
    ground.hide_render = True                           # unfamiliar view from below/behind
    shot("back_underside", (-5.5, 6.0, -3.6), target=(0, 0, -0.5))
    stats["render_seconds"] = round(time.perf_counter() - t, 3)
    asset["stats"] = stats
    with open(os.path.join(OUT, "asset.json"), "w") as f:
        json.dump(asset, f, indent=2)

print("BRIDGE_STATS", json.dumps(stats))
