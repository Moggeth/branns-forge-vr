"""Brann's Forge VR - Pocket Thunder hands builder (deterministic).

Run:  blender -b --factory-startup -P builder/build_hands.py -- [--no-render]

All geometry is authored in the Godot hand frame (metres): palm centred at the
origin, fingers toward -Z, back of hand +Y, wrist +Z. gv()/gmat() convert to
Blender's Z-up frame; the glTF exporter's +Y-up conversion restores the Godot
frame exactly, so node transforms in the GLB match the authored values.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "output")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGV
os.makedirs(os.path.join(OUT, "renders"), exist_ok=True)

M3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # Godot -> Blender
M4 = M3.to_4x4()
M4I = M4.inverted()


def gv(v):
    return M3 @ Vector(v)


def gmat(g):
    return M4 @ g @ M4I


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def R(a, axis):
    return Matrix.Rotation(a, 4, axis)


# ---------------------------------------------------------------- materials
def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def material(name, hexc, rough, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexc)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission"].default_value = srgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    return m


# ---------------------------------------------------------------- geometry
def revolve(rows, u=16, sx=1.0, sy=1.0, cx=0.0, cy=0.0):
    """Surface of revolution about local Z. rows=[(z, r)], r==0 rows are poles."""
    verts, faces, idx = [], [], []
    for z, r in rows:
        if r < 1e-9:
            idx.append([len(verts)])
            verts.append((cx, cy, z))
        else:
            ring = []
            for k in range(u):
                a = 2 * math.pi * k / u
                ring.append(len(verts))
                verts.append((cx + r * sx * math.cos(a), cy + r * sy * math.sin(a), z))
            idx.append(ring)
    for A, B in zip(idx, idx[1:]):
        if len(A) == 1:
            faces += [(A[0], B[(k + 1) % u], B[k]) for k in range(u)]
        elif len(B) == 1:
            faces += [(A[k], A[(k + 1) % u], B[0]) for k in range(u)]
        else:
            faces += [(A[k], A[(k + 1) % u], B[(k + 1) % u], B[k]) for k in range(u)]
    return verts, faces


def capsule(z0, z1, r0, r1, sy=0.9, u=14, half=4, sx=1.0, cy=0.0):
    """Tapered capsule: sphere r0 at z0 (base), sphere r1 at z1 (tip, z1<z0)."""
    rows = []
    for i in range(half + 1):
        p = (math.pi / 2) * i / half
        rows.append((z1 - r1 * math.cos(p), r1 * math.sin(p)))
    for i in range(half + 1):
        p = math.pi / 2 + (math.pi / 2) * i / half
        rows.append((z0 - r0 * math.cos(p), r0 * math.sin(p)))
    return revolve(rows, u, sx, sy, 0.0, cy)


def ellipsoid(c, r, u=12, v=8):
    rows = [(c[2] - r[2] * math.cos(math.pi * i / v), math.sin(math.pi * i / v)) for i in range(v + 1)]
    rows[0] = (rows[0][0], 0.0)
    rows[-1] = (rows[-1][0], 0.0)
    return revolve(rows, u, r[0], r[1], c[0], c[1])


def xform(mesh, m):
    verts, faces = mesh
    return [tuple(m @ Vector(p)) for p in verts], faces


def sp(v, e):
    return math.copysign(abs(v) ** (2.0 / e), v)


def section(p, t, e):
    z, cx, cy, hw, ht, hb = p
    s = math.sin(t)
    return (cx + hw * sp(math.cos(t), e), cy + (ht if s >= 0 else hb) * sp(s, e), z)


def loft(profiles, n=28, e=2.4, t_range=None, caps=True):
    """Superellipse loft along Z. profiles=[(z, cx, cy, halfW, halfTop, halfBottom)]."""
    closed = t_range is None
    verts, faces, rings = [], [], []
    for p in profiles:
        ring = []
        for k in range(n):
            t = 2 * math.pi * k / n if closed else t_range[0] + (t_range[1] - t_range[0]) * k / (n - 1)
            ring.append(len(verts))
            verts.append(section(p, t, e))
        rings.append(ring)
    span = n if closed else n - 1
    for A, B in zip(rings, rings[1:]):
        faces += [(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]) for k in range(span)]
    if caps and closed:
        for ring, p, flip in ((rings[0], profiles[0], False), (rings[-1], profiles[-1], True)):
            c = len(verts)
            verts.append((p[1], p[2], p[0]))
            for k in range(n):
                f = (ring[(k + 1) % n], ring[k], c)
                faces.append(f[::-1] if flip else f)
    return verts, faces


def sweep(path, radius, closed=True, u=8, ref=(0, 0, 1)):
    """Round tube along a polyline of Godot points."""
    verts, faces, n = [], [], len(path)
    for i, p in enumerate(path):
        a = Vector(path[(i - 1) % n] if (closed or i > 0) else p)
        b = Vector(path[(i + 1) % n] if (closed or i < n - 1) else p)
        t = (b - a).normalized()
        nr = Vector(ref) - Vector(ref).dot(t) * t
        nr.normalize()
        bn = t.cross(nr)
        for k in range(u):
            a2 = 2 * math.pi * k / u
            verts.append(tuple(Vector(p) + radius * (math.cos(a2) * nr + math.sin(a2) * bn)))
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        faces += [(i * u + k, i * u + (k + 1) % u, j * u + (k + 1) % u, j * u + k) for k in range(u)]
    return verts, faces


def ring_path(p, e=2.4, n=40, grow=0.0):
    z, cx, cy, hw, ht, hb = p
    return [section((z, cx, cy, hw + grow, ht + grow, hb + grow), 2 * math.pi * k / n, e) for k in range(n)]


def interp_profile(profiles, z):
    for a, b in zip(profiles, profiles[1:]):
        if a[0] <= z <= b[0]:
            f = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * f for i in range(6))
    return profiles[-1] if z > profiles[-1][0] else profiles[0]


def prism(poly_xz, y0, h):
    """Extrude an XZ polygon upward (+Y) - used for the thunderbolt inlay."""
    n = len(poly_xz)
    verts = [(x, y0, z) for x, z in poly_xz] + [(x, y0 + h, z) for x, z in poly_xz]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        faces.append((i, n + i, n + (i + 1) % n, (i + 1) % n))
    return verts, faces


# ---------------------------------------------------------------- scene objects
STATS = {}


def link(ob, coll):
    coll.objects.link(ob)
    return ob


def empty(name, parent, g, coll):
    ob = link(bpy.data.objects.new(name, None), coll)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.006
    ob.parent = parent
    ob.matrix_basis = gmat(g)
    return ob


def mesh_obj(name, mesh, mat, parent, coll, smooth=True, subsurf=0, solidify=0.0, flat=False):
    verts, faces = mesh
    me = bpy.data.meshes.new(name)
    me.from_pydata([gv(v) for v in verts], [], faces)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth and not flat
    ob = link(bpy.data.objects.new(name, me), coll)
    ob.parent = parent
    if solidify:
        s = ob.modifiers.new("solid", "SOLIDIFY")
        s.thickness = solidify
        s.offset = 0.0
    if subsurf:
        s = ob.modifiers.new("subd", "SUBSURF")
        s.levels = s.render_levels = subsurf
    if ob.modifiers:
        dg = bpy.context.evaluated_depsgraph_get()
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        old = ob.data
        ob.modifiers.clear()
        ob.data = new
        bpy.data.meshes.remove(old)
        new.name = name
    return ob


# ---------------------------------------------------------------- hand design
# (name, x, y, knuckle z, segment lengths, radius scale, splay)
FINGERS = [
    ("Index", 0.0315, -0.0010, -0.046, (0.044, 0.028, 0.022), 1.00, 0.045),
    ("Middle", 0.0110, -0.0005, -0.049, (0.048, 0.030, 0.024), 1.03, 0.0),
    ("Ring", -0.0090, -0.0010, -0.047, (0.045, 0.029, 0.023), 0.97, -0.040),
    ("Pinky", -0.0280, -0.0025, -0.041, (0.036, 0.022, 0.020), 0.86, -0.090),
]
SEG_R = ((0.0092, 0.0085), (0.0085, 0.0078), (0.0078, 0.0070))
REST_CURL = (-0.10, -0.16, -0.12)  # relaxed pose baked into static *_Rest nodes
THUMB = dict(meta=0.038, lengths=(0.031, 0.024), radii=((0.0108, 0.0098), (0.0098, 0.0086)), rest=(-0.12, -0.15))


def palm_profiles(s):
    return [
        (-0.053, 0.0, -0.002, 0.030, 0.005, 0.005),
        (-0.049, 0.0, -0.002, 0.041, 0.010, 0.011),
        (-0.040, 0.0, -0.002, 0.0455, 0.013, 0.014),
        (-0.020, 0.001 * s, -0.002, 0.0465, 0.015, 0.016),
        (0.000, 0.002 * s, -0.002, 0.0460, 0.015, 0.018),
        (0.020, 0.002 * s, -0.002, 0.0420, 0.014, 0.018),
        (0.036, 0.001 * s, -0.001, 0.0345, 0.013, 0.015),
        (0.050, 0.0, 0.0, 0.0300, 0.0125, 0.0125),
        (0.080, 0.0, 0.0, 0.0300, 0.0130, 0.0130),
        (0.118, 0.0, 0.0, 0.0320, 0.0140, 0.0140),
    ]


CUFF = [
    (0.046, 0.0, 0.0, 0.0345, 0.0175, 0.0175),
    (0.060, 0.0, 0.0, 0.0350, 0.0180, 0.0180),
    (0.100, 0.0, 0.0, 0.0360, 0.0190, 0.0190),
    (0.124, 0.0, 0.0, 0.0400, 0.0225, 0.0225),
]


def nail(L, r1):
    return ellipsoid((0.0, r1 * 0.80, -L - 0.0012), (r1 * 0.60, 0.0012, 0.0050), 12, 6)


def build_hand(side, tag, M, coll):
    root = empty(f"{tag}_HandRoot", None, Matrix(), coll)
    joints = {}
    pp = palm_profiles(side)
    mesh_obj(f"{tag}_Palm", loft(pp, 28), M["skin"], root, coll, subsurf=1)

    # Pocket Thunder glove: back panel, cuff, brass bands, copper coil, thunder cell.
    panel = [(-0.043, 0.0, -0.002, 0.0445, 0.0125, 0.013)] + pp[3:9]
    panel = [(z, cx, cy, hw + 0.0022, ht + 0.0022, hb + 0.0022) for z, cx, cy, hw, ht, hb in panel]
    mesh_obj(f"{tag}_GloveBack", loft(panel, 26, t_range=(-0.40, math.pi + 0.40), caps=False),
             M["leather"], root, coll, subsurf=1, solidify=0.0018)
    mesh_obj(f"{tag}_Cuff", loft(CUFF, 28, 2.2, caps=False), M["leather_dark"], root, coll,
             subsurf=1, solidify=0.0026)
    for i, z in enumerate((0.051, 0.116)):
        p = interp_profile(CUFF, z)
        mesh_obj(f"{tag}_CuffBand{i + 1}", sweep(ring_path(p, 2.2, 40, 0.0018), 0.0022, u=6),
                 M["brass"], root, coll)
    coil, turns, n = [], 4, 4 * 24
    for k in range(n + 1):
        z = 0.064 + 0.040 * k / n
        p = interp_profile(CUFF, z)
        coil.append(section((z, 0, 0, p[3] + 0.0018, p[4] + 0.0018, p[5] + 0.0018), 2 * math.pi * turns * k / n, 2.2))
    mesh_obj(f"{tag}_ThunderCoil", sweep(coil, 0.0011, closed=False, u=5), M["copper"], root, coll)
    cell = xform(capsule(0.011, -0.011, 0.0052, 0.0052, sy=1.0, u=14, half=4), T(0, 0.0228, 0.084) @ R(math.pi / 2, "Y"))
    mesh_obj(f"{tag}_ThunderCell", cell, M["thunder"], root, coll)
    for i, x in enumerate((-0.0125, 0.0125)):
        cap = revolve([(-0.0022, 0), (-0.0022, 0.0060), (0.0022, 0.0060), (0.0022, 0)], 14)
        mesh_obj(f"{tag}_CellCap{i + 1}", xform(cap, T(x, 0.0228, 0.084) @ R(math.pi / 2, "Y")), M["brass"], root, coll)
    # Medallion with glowing thunderbolt on the back of the hand.
    my, mz = 0.0150, -0.012
    disc = revolve([(0, 0), (0, 0.0115), (0.0008, 0.0125), (0.0030, 0.0125), (0.0038, 0.0112), (0.0038, 0)], 28)
    mesh_obj(f"{tag}_Medallion", xform(disc, T(0, my, mz) @ R(-math.pi / 2, "X")), M["brass"], root, coll)
    bolt = [(0.0030, -0.0095), (-0.0045, 0.0010), (0.0000, 0.0010), (-0.0030, 0.0095),
            (0.0048, -0.0020), (0.0005, -0.0020)]
    mesh_obj(f"{tag}_ThunderBolt", prism([(x, mz + z) for x, z in bolt], my + 0.0034, 0.0012),
             M["thunder"], root, coll, flat=True)
    # Saddle stitching along the glove's knuckle edge.
    hw, ht = 0.0445 + 0.0022, 0.0125 + 0.0022
    for i in range(9):
        x = -0.034 + i * 0.0085
        y = -0.002 + ht * (1 - abs(x / hw) ** 2.4) ** (1 / 2.4) + 0.0010
        mesh_obj(f"{tag}_Stitch{i + 1:02d}", ellipsoid((x, y, -0.0395), (0.0024, 0.0006, 0.0008), 6, 3),
                 M["thread"], root, coll)

    for fi, (name, x, y, kz, lengths, rs, splay) in enumerate(FINGERS):
        parent = root
        for s in range(3):
            pos = (side * x, y, kz) if s == 0 else (0.0, 0.0, -lengths[s - 1])
            g = T(*pos) @ (R(-side * splay, "Y") if s == 0 else Matrix()) @ R(REST_CURL[s], "X")
            rest = empty(f"{tag}_{name}_{s + 1}_Rest", parent, g, coll)
            j = empty(f"{tag}_{name}_{s + 1}", rest, Matrix(), coll)
            joints[f"{name}_{s + 1}"] = j
            L = lengths[s]
            r0, r1 = SEG_R[s][0] * rs, SEG_R[s][1] * rs
            mesh_obj(f"{tag}_{name}_{s + 1}_Skin", capsule(0.0, -L, r0, r1), M["skin"], j, coll)
            if s == 0:
                sl = -L * 0.45
                mesh_obj(f"{tag}_{name}_Sleeve", capsule(0.002, sl, r0 * 1.15, r0 * 1.10, sy=0.92),
                         M["leather"], j, coll)
                rr = r0 * 1.10 + 0.0004
                ring = [(rr * math.cos(a), rr * 0.92 * math.sin(a), sl)
                        for a in (2 * math.pi * k / 24 for k in range(24))]
                mesh_obj(f"{tag}_{name}_SleeveRing", sweep(ring, 0.0011, u=6), M["brass"], j, coll)
                mesh_obj(f"{tag}_{name}_Stud", ellipsoid((0, r0 * 1.15 * 0.92 + 0.0004, -0.005), (0.0032, 0.0015, 0.0032), 10, 6),
                         M["brass"], j, coll)
            if s == 2:
                mesh_obj(f"{tag}_{name}_Nail", nail(L, r1), M["nail"], j, coll)
                empty(f"{tag}_{name}_Tip", j, T(0, 0, -L - r1), coll)
            parent = j

    g = T(side * 0.035, -0.010, 0.002) @ R(-side * 0.42, "Y") @ R(-0.38, "X") @ R(-side * 0.70, "Z")
    troot = empty(f"{tag}_Thumb_Root", root, g, coll)
    mesh_obj(f"{tag}_Thumb_Meta_Skin", capsule(0.006, -THUMB["meta"], 0.0135, 0.0112), M["skin"], troot, coll)
    mesh_obj(f"{tag}_Thumb_Sleeve", capsule(0.008, -0.029, 0.0150, 0.0125, sy=0.92), M["leather"], troot, coll)
    ring = [(0.0129 * math.cos(a), 0.0129 * 0.92 * math.sin(a), -0.029) for a in (2 * math.pi * k / 24 for k in range(24))]
    mesh_obj(f"{tag}_Thumb_SleeveRing", sweep(ring, 0.0012, u=6), M["brass"], troot, coll)
    parent, prev = troot, THUMB["meta"]
    for s in range(2):
        rest = empty(f"{tag}_Thumb_{s + 1}_Rest", parent, T(0, 0, -prev) @ R(THUMB["rest"][s], "X"), coll)
        j = empty(f"{tag}_Thumb_{s + 1}", rest, Matrix(), coll)
        joints[f"Thumb_{s + 1}"] = j
        L = THUMB["lengths"][s]
        r0, r1 = THUMB["radii"][s]
        mesh_obj(f"{tag}_Thumb_{s + 1}_Skin", capsule(0.0, -L, r0, r1), M["skin"], j, coll)
        if s == 1:
            mesh_obj(f"{tag}_Thumb_Nail", nail(L, r1), M["nail"], j, coll)
            empty(f"{tag}_Thumb_Tip", j, T(0, 0, -L - r1), coll)
        parent, prev = j, L
    return root, joints


# ---------------------------------------------------------------- demo animation
GRIP = 0.95  # matches the runtime's held-tool angle


def animate(joints, stagger):
    for key, j in joints.items():
        f = key.split("_")[0]
        d = stagger.get(f, 0)
        for frame, a in ((1, 0.0), (18 + d, GRIP), (40, GRIP), (60 + d, 0.0), (72, 0.0)):
            j.rotation_euler[0] = -a
            j.keyframe_insert("rotation_euler", index=0, frame=frame)


# ---------------------------------------------------------------- main
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    M = dict(
        skin=material("Skin", "d4b087", 0.72),
        leather=material("GloveLeather", "4b626a", 0.82),
        leather_dark=material("CuffLeather", "3b4f57", 0.80),
        brass=material("Brass", "d3b275", 0.38, 0.85),
        thread=material("Thread", "b69b74", 0.70),
        copper=material("Copper", "c0784a", 0.35, 0.9),
        nail=material("Nail", "efd9bd", 0.45),
        thunder=material("PocketThunder", "8fe3ff", 0.15, 0.0, "5fd2ff", 3.0),
    )
    hands = {}
    for side, tag in ((1, "L"), (-1, "R")):
        coll = bpy.data.collections.new(f"Hand_{tag}")
        scn.collection.children.link(coll)
        hands[tag] = (coll,) + build_hand(side, tag, M, coll)

    stagger = {"Pinky": 0, "Ring": 2, "Middle": 4, "Index": 6, "Thumb": 8}
    for tag in hands:
        animate(hands[tag][2], stagger)
    scn.frame_start, scn.frame_end = 1, 72
    scn.render.fps = 24

    # Stats + export (rest pose, roots at origin).
    scn.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    stats = {}
    for tag, (coll, root, joints) in hands.items():
        tris = 0
        for ob in coll.objects:
            if ob.type == "MESH":
                me = ob.evaluated_get(dg).data
                me.calc_loop_triangles()
                tris += len(me.loop_triangles)
        stats[tag] = dict(triangles=tris, objects=len(coll.objects),
                          meshes=sum(o.type == "MESH" for o in coll.objects))
        bpy.ops.object.select_all(action="DESELECT")
        for ob in coll.objects:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = root
        path = os.path.join(OUT, f"pocket_thunder_hand_{tag}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                                  export_apply=True, export_yup=True, export_animations=False,
                                  export_cameras=False, export_lights=False)
        stats[tag]["glb_bytes"] = os.path.getsize(path)

    # Display layout inside the .blend: left hand on the viewer's left.
    hands["L"][1].location.x = -0.075
    hands["R"][1].location.x = 0.075
    setup_render(scn)
    scn.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "pocket_thunder_hands.blend"))
    if DO_RENDER:
        render_all(scn, hands)
        scn.frame_set(1)
    with open(os.path.join(OUT, "stats.json"), "w") as f:
        json.dump(stats, f, indent=2)
    print("BUILD_STATS", json.dumps(stats))


def setup_render(scn):
    scn.render.engine = "BLENDER_EEVEE"
    scn.eevee.taa_render_samples = 48
    scn.eevee.use_bloom = True
    scn.eevee.bloom_intensity = 0.04
    scn.eevee.use_gtao = True
    scn.eevee.gtao_distance = 0.02
    scn.eevee.use_soft_shadows = True
    scn.eevee.shadow_cube_size = "1024"
    scn.eevee.shadow_cascade_size = "2048"
    scn.render.resolution_x = scn.render.resolution_y = 900
    w = bpy.data.worlds.new("World")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.06, 0.05, 0.045, 1)
    bg.inputs[1].default_value = 1.0
    scn.world = w
    lights = bpy.data.collections.new("Stage")
    scn.collection.children.link(lights)
    for name, kind, energy, rot, loc, size in (
            ("Key", "SUN", 3.5, (0.7, 0.2, 0.6), (0, 0, 1), 0.1),
            ("Fill", "SUN", 1.0, (-0.9, -0.3, -2.4), (0, 0, 1), 0.3),
            ("Under", "SUN", 0.7, (2.8, 0.0, 0.0), (0, 0, -1), 0.3)):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.angle = size
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        lights.objects.link(lo)
    cd = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cd)
    lights.objects.link(cam)
    scn.camera = cam


def aim(cam, loc, target, up="Y"):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", up).to_euler()


def render_all(scn, hands):
    cam = scn.camera
    joints = [j for t in hands for j in hands[t][2].values()]
    views = [  # name, frame, camera loc, target, up, ortho scale or None, hide L
        ("back", 1, (0, 0.0, 0.6), (0, 0.0, 0), "Y", 0.34, False),
        ("palm", 1, (0, 0.0, -0.6), (0, 0.0, 0), "Y", 0.34, False),
        ("front", 1, (0, 0.6, 0.0), (0, 0, 0), "Z", 0.34, False),
        ("side", 1, (0.6, 0.0, 0.0), (0.075, 0.0, 0), "Z", 0.26, True),
        ("three_quarter_open", 1, (0.30, 0.34, 0.26), (0, 0.0, 0), "Z", None, False),
        ("grip", 40, (0.30, 0.34, 0.26), (0, 0.0, 0), "Z", None, False),
        ("grip_side", 40, (0.6, 0.0, 0.0), (0.075, 0.0, 0), "Z", 0.26, True),
        ("grip_front", 40, (0, 0.6, 0.0), (0, 0, 0), "Z", 0.34, False),
    ]
    for name, frame, loc, tgt, up, ortho, hide_l in views:
        scn.frame_set(frame)
        bpy.data.collections["Hand_L"].hide_render = hide_l
        cam.data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam.data.ortho_scale = ortho
        else:
            cam.data.lens = 60
        aim(cam, loc, tgt, up)
        cam.data.clip_start, cam.data.clip_end = 0.01, 5
        scn.render.filepath = os.path.join(OUT, "renders", f"{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.collections["Hand_L"].hide_render = False
    # Animation strip: open -> grip -> open.
    cam.data.type = "PERSP"
    aim(cam, (0.30, 0.34, 0.26), (0, 0, 0), "Z")
    scn.render.resolution_x = scn.render.resolution_y = 450
    for frame in (1, 12, 22, 40, 52, 66):
        scn.frame_set(frame)
        scn.render.filepath = os.path.join(OUT, "renders", "anim", f"frame_{frame:03d}.png")
        bpy.ops.render.render(write_still=True)
    scn.render.resolution_x = scn.render.resolution_y = 900


main()
