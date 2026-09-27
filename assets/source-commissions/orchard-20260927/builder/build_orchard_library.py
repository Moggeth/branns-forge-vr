"""Brann's Forge VR - orchard environment asset library builder.

Deterministic: every asset is generated from a fixed seed with random.Random and
mathutils.noise (seeded by coordinate offsets), in a factory-startup scene.

Run (from the commission folder):
  blender --factory-startup -b --python output/builder/build_orchard_library.py -- [--no-render]

Writes output/glb/*.glb, output/source/orchard_library.blend, output/renders/*.png
and output/build_report.json (bounds, triangles, materials per asset).

Conventions: metres, +Y up in GLB (Blender +Z up, exporter converts), origin at
ground contact centre. Colour lives in vertex colours (COLOR_0, sRGB authored);
each material slot is white base colour x vertex colour, one slot per role so Godot
can override bark / leaf / stone / moss independently.
"""
import bpy, bmesh, math, random, json, os, sys
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
GLB_DIR = os.path.join(OUT, "glb")
SRC_DIR = os.path.join(OUT, "source")
RENDER_DIR = os.path.join(OUT, "renders")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS

# ---------------------------------------------------------------- palette
def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

PAL = {
    "bark": [hx("7f5236"), hx("6a432c"), hx("946543")], "bark_dark": hx("4e3222"), "heartwood": hx("d7b27a"),
    "bark_moss": hx("7c8b47"),
    "leaf": [hx("5f8f3a"), hx("73a142"), hx("86b048"), hx("4f7d38")], "leaf_light": hx("c9d863"), "leaf_dark": hx("2f5230"),
    "leaf_autumn": [hx("d08a33"), hx("c4632b"), hx("e0a943"), hx("b5552a")], "leaf_autumn_light": hx("f3d06a"), "leaf_autumn_dark": hx("6e3322"),
    "hedge": [hx("3f6b35"), hx("4a7a3a"), hx("567f3c")], "hedge_light": hx("9fbf5a"), "hedge_dark": hx("22402a"),
    "fruit": [hx("c8372a"), hx("d9472f"), hx("b8302a")], "fruit_light": hx("f28a4a"),
    "blossom": [hx("f6dbe2"), hx("fbeff1"), hx("eaa7bb")], "blossom_eye": hx("f2cf5b"),
    "stone": [hx("8b877c"), hx("7a766c"), hx("979282"), hx("86796a")], "stone_dark": hx("524d46"),
    "moss": [hx("5d7a35"), hx("6b8740"), hx("536f31")],
    "soil": [hx("8a6a48"), hx("7a5c3e"), hx("957352")], "soil_rut": hx("5f462f"), "soil_edge": hx("7f7447"),
    "strata": [hx("8c7f70"), hx("a39580"), hx("76695d"), hx("b3a58e"), hx("988874")], "strata_dark": hx("5e554d"),
    "alpine": hx("6f8c46"), "snow": hx("eef0ea"),
}

def lerp3(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def mul3(a, k):
    return tuple(max(0.0, min(1.0, c * k)) for c in a)

# ---------------------------------------------------------------- materials
MATS = {}
def material(name):
    """White base x vertex colour; roughness chosen per role."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    attr.location = (-300, 200)
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6 if name.endswith("fruit") else 0.92
    bsdf.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = name != "orchard_blossom"  # every mesh is closed; petals are thin
    MATS[name] = m
    return m

# ---------------------------------------------------------------- mesh builder
class MB:
    def __init__(self):
        self.v, self.f, self.fm, self.fc, self.fs = [], [], [], [], []

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, mat, col, smooth=False):
        """col: one rgb for the face, or a list with one rgb per corner."""
        self.f.append(list(idx))
        self.fm.append(mat)
        self.fc.append(col if isinstance(col, list) else [col] * len(idx))
        self.fs.append(smooth)

    def normal(self, idx):
        a, b, c = (self.v[i] for i in idx[:3])
        n = (b - a).cross(c - a)
        return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))

    def append_hull(self, verts, faces, mat, colfn, smooth=False):
        base = len(self.v)
        self.v.extend(Vector(p) for p in verts)
        for fc in faces:
            idx = [base + i for i in fc]
            n = self.normal(idx)
            centre = sum((self.v[i] for i in idx), Vector()) / len(idx)
            m, c = colfn(n, centre)
            self.face(idx, m, c, smooth)

    def to_object(self, name, mat_names, coll):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        me.update()
        for mn in mat_names:
            me.materials.append(material(mn))
        attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        li = 0
        for pi, poly in enumerate(me.polygons):
            poly.material_index = self.fm[pi]
            poly.use_smooth = self.fs[pi]
            cols = self.fc[pi]
            for k, loop_index in enumerate(poly.loop_indices):
                c = cols[k % len(cols)]
                attr.data[loop_index].color_srgb = (c[0], c[1], c[2], 1.0)
        me.color_attributes.active_color = attr
        me.validate()
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob

# Blender is Z-up; we author in Y-up and swap at the end (x, y, z) -> (x, -z, y).
def yup(p):
    return Vector((p[0], -p[2], p[1]))

def finish(mb):
    mb.v = [yup(p) for p in mb.v]
    return mb

# ---------------------------------------------------------------- primitives
_ICO = {}
def ico(level):
    if level not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=level, radius=1.0)
        verts = [v.co.copy() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        bm.free()
        _ICO[level] = (verts, faces)
    return _ICO[level]

def hull(points):
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts, use_existing_faces=False)
    for g in res.get("geom_interior", []) + res.get("geom_unused", []):
        if isinstance(g, bmesh.types.BMVert) and g.is_valid:
            bm.verts.remove(g)
    bmesh.ops.triangulate(bm, faces=bm.faces)  # predictable triangle count
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces

def nz(p, seed, scale=1.0):
    return noise.noise(Vector(p) * scale + Vector((seed * 7.31, seed * 3.17, seed * 5.53)))

def rot_y(v, a):
    c, s = math.cos(a), math.sin(a)
    return Vector((v.x * c + v.z * s, v.y, -v.x * s + v.z * c))

def dir_from(az, el):
    return Vector((math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az)))

def tube(mb, pts, radii, sides, mat, colfn, cap=True, seed=0):
    """Generalised cylinder along pts with parallel-transported frames, smooth shaded."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tangents = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tangents.append(t.normalized())
    ref = Vector((1, 0, 0)) if abs(tangents[0].x) < 0.9 else Vector((0, 0, 1))
    nrm = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bin_ = t.cross(nrm)
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            wob = 1.0 + 0.1 * nz(pts[i] + Vector((math.cos(a), 0, math.sin(a))), seed, 2.3)
            off = (nrm * math.cos(a) + bin_ * math.sin(a)) * radii[i] * wob
            ring.append(mb.vert(pts[i] + off))
        rings.append(ring)
    for i in range(n - 1):
        for s in range(sides):
            s1 = (s + 1) % sides
            q = [rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]]
            cols = [colfn(mb.v[k], i + (k in rings[i + 1])) for k in q]
            mb.face(q, mat, cols, True)
    if cap:
        tip = mb.vert(pts[-1] + tangents[-1] * radii[-1] * 0.6)
        for s in range(sides):
            s1 = (s + 1) % sides
            q = [rings[-1][s], rings[-1][s1], tip]
            mb.face(q, mat, [colfn(mb.v[k], n) for k in q], True)
    return rings

# ================================================================ TREES
def bark_col(rng_seed):
    def f(p, ring):
        k = nz(p, rng_seed, 3.0)
        base = PAL["bark"][int((p.y * 3.1 + ring) * 1.7) % 3]
        c = lerp3(base, PAL["bark_dark"], 0.35 + 0.35 * k)
        # moss on low, north-ish (-Z) side of trunk and roots
        if p.y < 0.9 and (p.z < -0.02 or p.y < 0.12) and k > -0.15:
            c = lerp3(c, PAL["bark_moss"], 0.55)
        return c
    return f

def curve_points(rng, start, d, length, segs, up_bias, droop=0.0):
    pts = [Vector(start)]
    d = Vector(d).normalized()
    step = length / segs
    for i in range(segs):
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-0.5, 0.5), rng.uniform(-1, 1))) * 0.28
        d = (d + jitter + Vector((0, up_bias - droop * i, 0))).normalized()
        pts.append(pts[-1] + d * step)
    return pts, d

def canopy_blob(mb, rng, centre, radii, pal, tree_axis_y, level=2, seed=0):
    verts, faces = ico(level)
    leaves = pal["leaf"]
    base = leaves[rng.randrange(len(leaves))]
    idx = []
    local = []
    for v in verts:
        d = v.normalized()
        bump = 1.0 + 0.16 * nz(d * 1.6, seed) + 0.07 * nz(d * 4.2, seed + 11)
        p = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * bump
        if p.y < -radii[1] * 0.45:  # flattened, slightly lifted underside
            p.y = -radii[1] * 0.45 + (p.y + radii[1] * 0.45) * 0.3
        local.append((d, p))
        idx.append(mb.vert(centre + p))
    cols = []
    for (d, p) in local:
        world = centre + p
        outward = Vector((world.x, 0, world.z))
        outward = outward.normalized() if outward.length > 1e-4 else Vector((0, 0, 0))
        side = Vector((d.x, 0, d.z))
        ao = 0.5 + 0.5 * (side.dot(outward) if side.length > 1e-4 else 0.0)
        up = d.y * 0.5 + 0.5
        c = lerp3(pal["leaf_dark"], base, 0.35 + 0.65 * min(1.0, up * 1.3) * (0.55 + 0.45 * ao))
        if d.y > 0.55:
            c = lerp3(c, pal["leaf_light"], (d.y - 0.55) * 0.55 * (0.6 + 0.4 * nz(world, seed, 1.3)))
        cols.append(c)
    for fc in faces:
        mb.face([idx[i] for i in fc], 0, [cols[i] for i in fc], True)
    return local

APPLE_PROFILE = [(0.0, -0.07), (0.075, -0.045), (0.088, 0.015), (0.06, 0.06), (0.0, 0.045)]
def apple(mb, rng, pos, scale=1.0):
    sides = 6
    base = PAL["fruit"][rng.randrange(3)]
    rings = []
    yaw = rng.uniform(0, math.pi)
    for (r, y) in APPLE_PROFILE[1:-1]:
        ring = []
        for s in range(sides):
            a = yaw + 2 * math.pi * s / sides
            ring.append(mb.vert(pos + Vector((math.cos(a) * r, y, math.sin(a) * r)) * scale))
        rings.append(ring)
    bot = mb.vert(pos + Vector((0, APPLE_PROFILE[0][1], 0)) * scale)
    top = mb.vert(pos + Vector((0, APPLE_PROFILE[-1][1], 0)) * scale)
    lit = lerp3(base, PAL["fruit_light"], 0.45)
    first = len(mb.f)
    for s in range(sides):
        s1 = (s + 1) % sides
        mb.face([rings[0][s1], rings[0][s], bot], 0, mul3(base, 0.8), True)
        for i in range(len(rings) - 1):
            mb.face([rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]], 0, [base, base, lit, lit], True)
        mb.face([rings[-1][s], rings[-1][s1], top], 0, lit, True)
    for k in range(first, len(mb.f)):  # profile rings run clockwise from above: flip to face outward
        mb.f[k].reverse()
        mb.fc[k].reverse()

def build_tree(coll, name, seed, young=False, autumn=False, lod=0):
    rng = random.Random(seed)
    pal = {"leaf": PAL["leaf_autumn"] if autumn else PAL["leaf"],
           "leaf_light": PAL["leaf_autumn_light"] if autumn else PAL["leaf_light"],
           "leaf_dark": PAL["leaf_autumn_dark"] if autumn else PAL["leaf_dark"]}
    wood, leaf, fruit = MB(), MB(), MB()
    bc = bark_col(seed)
    S = 0.62 if young else 1.0
    tsides = (8 if lod == 0 else 5)
    skip = MB()  # LOD1 consumes the same random stream so its skeleton matches LOD0
    bsides = (5 if lod == 0 else 4)
    # trunk: short, slightly leaning, S-curved (orchard trees are pruned open-centre)
    lean_az = rng.uniform(0, 2 * math.pi)
    lean = Vector((math.sin(lean_az), 0, math.cos(lean_az))) * 0.12 * S
    trunk_h = (1.0 if young else 1.55)
    trunk_r = (0.09 if young else 0.22)
    tp = [Vector((0, -0.05, 0)), Vector((0, trunk_h * 0.35, 0)) + lean * 0.3 + Vector((0.03, 0, -0.02)),
          Vector((0, trunk_h * 0.7, 0)) + lean * 0.8, Vector((0, trunk_h, 0)) + lean]
    tube(wood, tp, [trunk_r * 1.25, trunk_r * 1.02, trunk_r * 0.95, trunk_r * 0.88], tsides, 0, bc, cap=True, seed=seed)
    # root flares
    if True:
        for i in range(5 if not young else 3):
            az = lean_az + i * 2 * math.pi / (5 if not young else 3) + rng.uniform(-0.3, 0.3)
            out = Vector((math.sin(az), 0, math.cos(az)))
            p0 = Vector((0, trunk_h * 0.2, 0)) + out * trunk_r * 0.5
            pts = [p0, p0 + out * trunk_r * 1.6 + Vector((0, -trunk_h * 0.14, 0)), p0 + out * trunk_r * 3.2 + Vector((0, -trunk_h * 0.24, 0))]
            tube(wood if lod == 0 or not young else skip, pts, [trunk_r * 0.55, trunk_r * 0.35, trunk_r * 0.12], 4, 0, bc, cap=True, seed=seed + i)
    top = tp[-1]
    blobs = []
    n_scaffold = 3 if young else 4
    ends = []
    for i in range(n_scaffold):
        az = lean_az + (i + 0.5) * 2 * math.pi / n_scaffold + rng.uniform(-0.35, 0.35)
        el = math.radians(rng.uniform(32, 50))
        start = top + Vector((0, -rng.uniform(0.0, 0.25) * S, 0))
        L = rng.uniform(1.8, 2.3) * S
        pts, d = curve_points(rng, start, dir_from(az, el), L, 3, 0.12)
        r0 = trunk_r * 0.62
        tube(wood, pts, [r0, r0 * 0.78, r0 * 0.55, r0 * 0.35], bsides, 0, bc, seed=seed + 20 + i)
        ends.append((pts[-1], 1.0))
        # secondary limbs
        for j in range(1 if young else 2):
            t = rng.uniform(0.45, 0.75)
            k = int(t * 3)
            base = pts[k].lerp(pts[k + 1], t * 3 - k)
            sd = (d + Vector((rng.uniform(-1, 1), rng.uniform(0.3, 0.9), rng.uniform(-1, 1)))).normalized()
            sp, sdd = curve_points(rng, base, sd, rng.uniform(0.9, 1.3) * S, 2, 0.2)
            tube(wood, sp, [r0 * 0.5, r0 * 0.34, r0 * 0.2], 4, 0, bc, seed=seed + 40 + i * 3 + j)
            ends.append((sp[-1], 0.72))
            tw, _ = curve_points(rng, sp[1], Vector((sdd.x, -0.4, sdd.z)), 0.45 * S, 1, 0.0)
            if True:  # twiggy spur poking out of the canopy underside
                tube(wood if lod == 0 else skip, tw, [r0 * 0.16, r0 * 0.06], 3, 0, bc, cap=True, seed=seed + 60 + i * 3 + j)
    # a leader for the crown
    lp, _ = curve_points(rng, top, Vector((rng.uniform(-0.2, 0.2), 1, rng.uniform(-0.2, 0.2))), 1.7 * S, 3, 0.1)
    tube(wood, lp, [trunk_r * 0.5, trunk_r * 0.38, trunk_r * 0.26, trunk_r * 0.14], bsides, 0, bc, seed=seed + 90)
    ends.append((lp[-1] + Vector((0, 0.1 * S, 0)), 1.1))
    min_bottom = 1.25 if young else 2.05  # keep head clearance under mature canopies
    level = 3 if lod == 0 else 2
    for i, (p, scale) in enumerate(ends):
        rx = rng.uniform(0.85, 1.15) * scale * S
        radii = (rx * rng.uniform(1.0, 1.2), rx * rng.uniform(0.72, 0.88), rx * rng.uniform(0.95, 1.15))
        c = Vector(p) + Vector((0, radii[1] * 0.25, 0))
        c.y = max(c.y, min_bottom + radii[1] * 0.45)
        blobs.append((c, radii))
        canopy_blob(leaf, rng, c, radii, pal, 0, level, seed + 100 + i)
    if lod == 0:
        n_fruit = 0
        for i, (c, radii) in enumerate(blobs):
            for k in range(rng.randint(2, 4) if young else rng.randint(3, 6)):
                d = dir_from(rng.uniform(0, 2 * math.pi), math.radians(rng.uniform(-40, 15)))
                p = c + Vector((d.x * radii[0], max(d.y * radii[1], -radii[1] * 0.45), d.z * radii[2])) * 0.93
                apple(fruit, rng, p + Vector((0, -0.05, 0)), rng.uniform(0.85, 1.05))
                n_fruit += 1
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    parts = [finish(wood).to_object(name + "_Trunk", ["orchard_bark"], coll),
             finish(leaf).to_object(name + "_Canopy", ["orchard_leaf_autumn" if autumn else "orchard_leaf"], coll)]
    if lod == 0:
        parts.append(finish(fruit).to_object(name + "_Fruit", ["orchard_fruit"], coll))
    for p in parts:
        p.parent = root
    return root

def build_stump(coll, name, seed):
    rng = random.Random(seed)
    wood = MB()
    bc = bark_col(seed)
    r = 0.2
    tp = [Vector((0, -0.05, 0)), Vector((0.01, 0.2, 0)), Vector((0.0, 0.42, 0.01))]
    rings = tube(wood, tp, [r * 1.3, r * 1.05, r], 9, 0, bc, cap=False, seed=seed)
    # sawn top: slanted face with concentric rings (heartwood slot)
    centre = wood.vert(Vector((0, 0.44, 0)))
    top = rings[-1]
    for s in range(len(top)):
        wood.v[top[s]].y += 0.04 * wood.v[top[s]].x / r
    mid = []
    for s in range(len(top)):
        p = wood.v[top[s]].lerp(wood.v[centre], 0.25)
        mid.append(wood.vert(p + Vector((0, 0.004, 0))))
    wood.v[centre].y += 0.0
    for s in range(len(top)):
        s1 = (s + 1) % len(top)
        wood.face([top[s1], top[s], mid[s], mid[s1]], 1, PAL["bark_dark"], False)
        wood.face([mid[s1], mid[s], centre], 1, [PAL["heartwood"], PAL["heartwood"], mul3(PAL["heartwood"], 0.8)], False)
    for i in range(5):
        az = i * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3)
        out = Vector((math.sin(az), 0, math.cos(az)))
        p0 = Vector((0, 0.12, 0)) + out * r * 0.6
        tube(wood, [p0, p0 + out * 0.3 + Vector((0, -0.1, 0)), p0 + out * 0.55 + Vector((0, -0.17, 0))],
             [0.11, 0.07, 0.025], 5, 0, bc, seed=seed + i)
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(wood).to_object(name + "_Wood", ["orchard_bark", "orchard_heartwood"], coll).parent = root
    return root

# ================================================================ SHRUBS
def build_hedge(coll, name, seed, length=3.0, lod=0):
    rng = random.Random(seed)
    leaf, wood = MB(), MB()
    pal = {"leaf": PAL["hedge"], "leaf_light": PAL["hedge_light"], "leaf_dark": PAL["hedge_dark"]}
    bc = bark_col(seed)
    n = 4
    for i in range(n):
        x = -length / 2 + (i + 0.5) * length / n + rng.uniform(-0.1, 0.1)
        tube(wood, [Vector((x, -0.05, rng.uniform(-0.1, 0.1))), Vector((x + rng.uniform(-0.1, 0.1), 0.35, 0))],
             [0.06, 0.045], 5, 0, bc, seed=seed + i)
    level = 3 if lod == 0 else 2
    k = 0
    # lower mass: blobs whose ends stay inside +-length/2 so runs butt together
    for row, (y, ry, cnt) in enumerate([(0.62, 0.5, 4), (1.02, 0.42, 3)]):
        for i in range(cnt):
            x = -length / 2 + (i + 0.5) * length / cnt + rng.uniform(-0.08, 0.08)
            rx = length / cnt * 0.62
            radii = (min(rx, length / 2 - abs(x) + rx * 0.35), ry * rng.uniform(0.95, 1.1), rng.uniform(0.5, 0.6) - row * 0.08)
            canopy_blob(leaf, rng, Vector((x, y + rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05))), radii, pal, 0, level, seed + 30 + k)
            k += 1
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(wood).to_object(name + "_Stems", ["orchard_bark"], coll).parent = root
    finish(leaf).to_object(name + "_Foliage", ["orchard_hedge"], coll).parent = root
    return root

def blossom(mb, rng, pos, normal, size):
    """5-petal star, opaque, double-sided by construction (top and bottom faces)."""
    n = normal.normalized()
    t = n.cross(Vector((0, 1, 0.01))).normalized()
    b = n.cross(t)
    col = PAL["blossom"][rng.randrange(3)]
    ring = []
    rot = rng.uniform(0, 2 * math.pi)
    for i in range(10):
        a = rot + i * math.pi / 5
        r = size if i % 2 == 0 else size * 0.45
        ring.append(mb.vert(pos + (t * math.cos(a) + b * math.sin(a)) * r + n * (0.0 if i % 2 == 0 else 0.012)))
    c = mb.vert(pos + n * 0.018)
    under = mb.vert(pos - n * 0.02)
    for i in range(10):
        i1 = (i + 1) % 10
        mb.face([ring[i], ring[i1], c], 0, [col, col, PAL["blossom_eye"]], False)
        mb.face([ring[i1], ring[i], under], 0, mul3(col, 0.78), False)

def build_flowering_shrub(coll, name, seed):
    rng = random.Random(seed)
    leaf, flow = MB(), MB()
    pal = {"leaf": [hx("5a8a3c"), hx("689a42")], "leaf_light": hx("b8d067"), "leaf_dark": hx("2f5230")}
    blobs = [(Vector((0, 0.36, 0)), (0.5, 0.36, 0.46))]
    for i in range(4):
        az = i * math.pi / 2 + rng.uniform(-0.4, 0.4)
        d = Vector((math.sin(az), 0, math.cos(az)))
        blobs.append((d * rng.uniform(0.3, 0.42) + Vector((0, rng.uniform(0.22, 0.3), 0)), (rng.uniform(0.28, 0.36),) * 1 + (rng.uniform(0.22, 0.28), rng.uniform(0.28, 0.34))))
    for i, (c, r) in enumerate(blobs):
        c.y = r[1] * 0.3
        local = canopy_blob(leaf, rng, c, r, pal, 0, 3, seed + i)
        # blossoms on the upper hemisphere, facing out
        picks = [p for (d, p) in local if d.y > 0.05]
        rng.shuffle(picks)
        for p in picks[:12 if i == 0 else 7]:
            blossom(flow, rng, c + p * 1.01, p.normalized(), rng.uniform(0.045, 0.065))
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(leaf).to_object(name + "_Foliage", ["orchard_leaf"], coll).parent = root
    finish(flow).to_object(name + "_Blossom", ["orchard_blossom"], coll).parent = root
    return root

# ================================================================ STONE
def faceted_rock(rng, radii, planes=9, level=2, seed=0, bottom=0.0):
    verts, faces = ico(level)
    cuts = []
    for i in range(planes):
        n = dir_from(rng.uniform(0, 2 * math.pi), math.radians(rng.uniform(-10, 70)))
        extent = Vector((n.x * radii[0], n.y * radii[1], n.z * radii[2])).length
        cuts.append((n, extent * rng.uniform(0.56, 0.84)))
    out = []
    for v in verts:
        d = v.normalized()
        p = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * (1 + 0.07 * nz(d * 2.0, seed))
        for (n, dist) in cuts:
            k = p.dot(n)
            if k > dist:
                p -= n * (k - dist)
        out.append(p)
    ymin = min(p.y for p in out)
    cut = ymin + (radii[1] * 2) * bottom
    for p in out:
        if p.y < cut:
            p.y = cut + (p.y - cut) * 0.05
    ymin = min(p.y for p in out)
    return [p - Vector((0, ymin + 0.03, 0)) for p in out], faces

def stone_colfn(rng, moss_amount, seed, moss_mat=1, dark=0.0):
    def f(n, centre):
        # tone keyed to the (quantised) facet normal so a planar facet reads as one stone face
        key = hash((round(n.x * 3), round(n.y * 3), round(n.z * 3), round(centre.x * 2), round(centre.z * 2), seed)) & 0xffff
        base = PAL["stone"][key % 4]
        rng.random()  # keep stream length stable
        k = nz(centre, seed, 1.7)
        c = lerp3(base, PAL["stone_dark"], dark + 0.3 * (0.5 - 0.5 * n.y) + 0.08 * k)
        if n.y > 0.72 - moss_amount and k + moss_amount > 0.12:
            return moss_mat, lerp3(PAL["moss"][key % 3], c, 0.25 * (1 - n.y))
        return 0, c
    return f

def weld(mb, verts, faces):
    return verts, faces

def build_mossy_rock(coll, name, seed, radii=(0.75, 0.55, 0.62)):
    rng = random.Random(seed)
    mb = MB()
    v, f = faceted_rock(rng, radii, 11, 3, seed, bottom=0.14)
    mb.append_hull(v, f, 0, stone_colfn(rng, 0.25, seed))
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(mb).to_object(name + "_Stone", ["orchard_stone", "orchard_moss"], coll).parent = root
    return root

def split_rock(rng, radii, seed, n, gap):
    v, f = faceted_rock(rng, radii, 9, 3, seed, bottom=0.12)
    halves = []
    for sign in (1, -1):
        pts = []
        for p in v:
            k = p.dot(n) * sign
            q = p - n * sign * k if k < 0 else p.copy()
            pts.append(q + n * sign * gap)
        halves.append(hull(pts))
    return halves

def build_rubble(coll, name, seed):
    rng = random.Random(seed)
    mb = MB()
    cf = stone_colfn(rng, 0.12, seed)
    n = Vector((1, 0.15, 0.35)).normalized()
    for (hv, hf) in split_rock(rng, (0.55, 0.42, 0.45), seed, n, 0.07):
        mb.append_hull(hv, hf, 0, cf)
    for i in range(6):
        az = rng.uniform(0, 2 * math.pi)
        d = Vector((math.sin(az), 0, math.cos(az))) * rng.uniform(0.62, 1.05)
        r = rng.uniform(0.12, 0.26)
        v, f = faceted_rock(rng, (r * rng.uniform(1, 1.5), r * rng.uniform(0.55, 0.8), r), 6, 1, seed + i, bottom=0.2)
        a = rng.uniform(0, 2 * math.pi)
        v = [rot_y(p, a) + d for p in v]
        hv, hf = hull(v)
        mb.append_hull(hv, hf, 0, cf)
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(mb).to_object(name + "_Stone", ["orchard_stone", "orchard_moss"], coll).parent = root
    return root

# ---------------------------------------------------------------- walls
WALL_H = 1.05
WALL_D = 0.62

def wall_stone(rng, u0, u1, y0, y1, w0, w1, chamfer=0.035, clip=(None, None)):
    pts = []
    for (u, su) in ((u0, 1), (u1, -1)):
        for (y, sy) in ((y0, 1), (y1, -1)):
            for (w, sw) in ((w0, 1), (w1, -1)):
                j = lambda: rng.uniform(-0.012, 0.012)
                cu = 0.0 if (clip[0] is not None and abs(u - clip[0]) < 1e-6) or (clip[1] is not None and abs(u - clip[1]) < 1e-6) else chamfer
                uu = u if cu == 0 else u + j()
                pts.append(Vector((uu + su * cu, y + j(), w + j())))
                pts.append(Vector((uu, y + sy * chamfer + j(), w + j())))
                pts.append(Vector((uu, y + j(), w + sw * chamfer + j())))
    return hull(pts)

def wall_run(mb, rng, seed, L, height_fn, to_world, caps=True, cap_min=0.98):
    """Dry-stone run in local (u along 0..L, y up, w across). Stones clip flat at u=0 and u=L."""
    cf = stone_colfn(rng, 0.0, seed)
    def colfn(n, c):
        m, col = cf(n, c)
        if n.y > 0.8 and rng.random() < 0.35:
            return 1, lerp3(PAL["moss"][rng.randrange(3)], col, 0.2)
        return 0, col
    y = 0.0
    course = 0
    top = {}
    while y < WALL_H - 0.12:
        ch = rng.uniform(0.17, 0.24) if course else 0.26
        u = -rng.uniform(0.0, 0.35) if course % 2 else 0.0
        while u < L - 1e-6:
            sl = rng.uniform(0.36, 0.7)
            a, b = max(u, 0.0), min(u + sl, L)
            if L - b < 0.15:
                b = L
            mid = (a + b) / 2
            if b - a > 0.08 and y + ch <= height_fn(mid) + 0.04:
                t = y / WALL_H
                d = WALL_D * (1 - 0.18 * t) / 2
                g = 0.012
                v, f = wall_stone(rng, a + (0 if a <= 0 else g), b - (0 if b >= L else g), y + 0.006, y + ch - 0.006,
                                  -d + rng.uniform(-0.02, 0.025), d + rng.uniform(-0.025, 0.02), clip=(0.0, L))
                mb.append_hull([to_world(p) for p in v], f, 0, colfn)
                top[round(mid, 3)] = y + ch
            u = b
        y += ch
        course += 1
    # coping: upright slabs on top of intact stretches
    if caps:
        u = 0.0
        while u < L - 1e-6:
            sl = rng.uniform(0.13, 0.2)
            a, b = u, min(u + sl, L)
            if L - b < 0.06:
                b = L
            if height_fn((a + b) / 2) >= cap_min * WALL_H and b - a > 0.05:
                d = WALL_D * 0.82 / 2
                hgt = rng.uniform(0.17, 0.26)
                tilt = rng.uniform(-0.035, 0.035)
                v, f = wall_stone(rng, a + (0 if a <= 0 else 0.01), b - (0 if b >= L else 0.01), y - 0.01, y + hgt,
                                  -d, d, chamfer=0.03, clip=(0.0, L))
                v = [p + Vector((tilt * (p.y - y) / hgt, 0, 0)) if 0 < p.x < L else p for p in v]
                mb.append_hull([to_world(p) for p in v], f, 0, colfn)
            u = b
    # hidden rubble core so hairline joints never show daylight
    steps = max(1, int(L / 0.5))
    for i in range(steps):
        a, b = i * L / steps, (i + 1) * L / steps
        h = min(height_fn(a), height_fn(b), y) - 0.08
        if h < 0.1:
            continue
        d = WALL_D * 0.36
        core = [Vector((uu, yy, ww)) for uu in (a, b) for yy in (0.0, h) for ww in (-d, d)]
        v, f = hull(core)
        mb.append_hull([to_world(p) for p in v], f, 0, lambda n, c: (0, PAL["stone_dark"]))

def fallen_stones(mb, rng, seed, area, count):
    cf = stone_colfn(rng, 0.3, seed)
    for i in range(count):
        x = rng.uniform(*area[0]); z = rng.uniform(*area[1])
        sx, sy, sz = rng.uniform(0.28, 0.5), rng.uniform(0.14, 0.22), rng.uniform(0.25, 0.4)
        v, f = wall_stone(rng, 0, sx, 0, sy, 0, sz)
        a = rng.uniform(0, 2 * math.pi)
        tilt = rng.uniform(-0.25, 0.25)
        vv = []
        for p in v:
            q = p - Vector((sx / 2, 0, sz / 2))
            q = Vector((q.x, q.y + q.x * tilt, q.z))
            vv.append(rot_y(q, a) + Vector((x, -0.03, z)))
        mb.append_hull(vv, f, 0, cf)

def wall_object(coll, name, mb):
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(mb).to_object(name + "_Stone", ["orchard_stone", "orchard_moss"], coll).parent = root
    return root

def build_wall_straight(coll, name, seed):
    rng = random.Random(seed)
    mb = MB()
    wall_run(mb, rng, seed, 4.0, lambda u: WALL_H, lambda p: Vector((p.x - 2.0, p.y, p.z)))
    return wall_object(coll, name, mb)

def build_wall_corner_broken(coll, name, seed):
    rng = random.Random(seed)
    mb = MB()
    half = WALL_D / 2
    # X arm owns the corner block: x in [-half, 2]
    wall_run(mb, rng, seed, 2.0 + half, lambda u: WALL_H, lambda p: Vector((p.x - half, p.y, p.z)))
    # Z arm from z=+half to 2 with a collapsed notch; both ends full height so runs join
    def hz(u):
        L = 2.0 - half
        c = L * 0.5
        return WALL_H - 0.62 * max(0.0, 1 - abs(u - c) / 0.5) ** 0.7
    # proper 90-degree rotation (u -> +Z, w -> -X); a swizzle would mirror and flip the winding
    wall_run(mb, rng, seed + 1, 2.0 - half, hz, lambda p: Vector((-p.z, p.y, p.x + half)))
    fallen_stones(mb, rng, seed, ((0.5, 1.1), (0.7, 1.5)), 4)
    fallen_stones(mb, rng, seed + 3, ((-0.9, -0.5), (0.7, 1.4)), 2)
    return wall_object(coll, name, mb)

def build_wall_end_broken(coll, name, seed):
    rng = random.Random(seed)
    mb = MB()
    def h(u):
        if u < 1.4:
            return WALL_H
        t = (u - 1.4) / 2.6
        return WALL_H - (WALL_H - 0.24) * (t ** 0.8) + 0.08 * math.sin(u * 7.0)
    wall_run(mb, rng, seed, 4.0, h, lambda p: Vector((p.x - 2.0, p.y, p.z)))
    fallen_stones(mb, rng, seed, ((1.1, 2.4), (0.45, 1.0)), 4)
    fallen_stones(mb, rng, seed + 5, ((1.5, 2.3), (-1.0, -0.45)), 3)
    return wall_object(coll, name, mb)

# ================================================================ PATH
PATH_L = 4.0
def path_halfwidth(z, seed):
    ph = seed * 0.37
    return 0.78 + 0.1 * math.sin(2 * math.pi * z / PATH_L + ph) + 0.05 * math.sin(4 * math.pi * z / PATH_L + ph * 2.3)

def build_path(coll, name, seed, bend_deg=0.0):
    rng = random.Random(seed)
    mb = MB()
    nx, nzs = 10, 20
    Y = 0.006
    R = PATH_L / math.radians(bend_deg) if bend_deg else None
    def place(x, y, z):
        if R is None:
            return Vector((x, y, z))
        th = (z + PATH_L / 2) / R
        return Vector((R - (R - x) * math.cos(th), y, -PATH_L / 2 + (R - x) * math.sin(th)))
    grid = []
    for j in range(nzs + 1):
        z = -PATH_L / 2 + PATH_L * j / nzs
        hw = path_halfwidth(z, seed)
        row = []
        for i in range(nx + 1):
            s = -1 + 2 * i / nx
            x = s * hw
            edge = abs(s)
            row.append((mb.vert(place(x, Y - 0.004 * edge ** 4, z)), x, z, s))
        grid.append(row)
    def col(x, z, s):
        k = 0.5 + 0.5 * math.sin(x * 9.1 + z * 3.7 + seed) * math.cos(z * 5.3 - x * 2.1)
        c = lerp3(PAL["soil"][0], PAL["soil"][2], k)
        rut = max(0.0, 1 - abs(abs(x) - 0.38) / 0.12)
        c = lerp3(c, PAL["soil_rut"], rut * 0.55)
        return lerp3(c, PAL["soil_edge"], max(0.0, (abs(s) - 0.72) / 0.28) * 0.8)
    for j in range(nzs):
        for i in range(nx):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            mb.face([e[0] for e in q][::-1] if False else [q[0][0], q[3][0], q[2][0], q[1][0]], 0,
                    [col(e[1], e[2], e[3]) for e in (q[0], q[3], q[2], q[1])], False)
    # embedded flagstones and pebbles: tops 1.5-3 cm, hand-safe, no trip geometry
    cf = stone_colfn(rng, -1.0, seed, dark=0.05)
    for i in range(9):
        z = rng.uniform(-PATH_L / 2 + 0.3, PATH_L / 2 - 0.3)
        x = rng.uniform(-0.5, 0.5) * path_halfwidth(z, seed)
        r = rng.uniform(0.09, 0.2) if i < 5 else rng.uniform(0.04, 0.07)
        v, f = faceted_rock(rng, (r * rng.uniform(1, 1.4), r * 0.35, r), 6, 1, seed + i, bottom=0.45)
        top, bot = max(p.y for p in v), min(p.y for p in v)
        target = rng.uniform(0.016, 0.03)
        a = rng.uniform(0, math.pi)
        v = [rot_y(Vector((p.x, -0.01 + (p.y - bot) / max(top - bot, 1e-4) * (target + 0.01), p.z)), a) for p in v]
        v = [place(p.x + x, p.y, p.z + z) for p in v]
        hv, hf = hull(v)
        mb.append_hull(hv, hf, 0, lambda n, c: (0, lerp3(cf(n, c)[1], PAL["soil"][1], 0.2)))
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(mb).to_object(name + "_Ground", ["orchard_soil"], coll).parent = root
    return root

# ================================================================ MOUNTAINS
def build_mountain(coll, name, seed, rx, rz, height, layers, snow=False, sides=26):
    rng = random.Random(seed)
    mb = MB()
    base_r = []
    cliff_az = rng.uniform(0, 2 * math.pi)
    for s in range(sides):
        a = 2 * math.pi * s / sides
        n = 1 + 0.22 * nz((math.cos(a) * 2, 0, math.sin(a) * 2), seed) + 0.08 * math.sin(a * 5 + seed)
        base_r.append(n)
    ys = [-4.0]
    for k in range(layers):
        ys.append(ys[-1] + (height + 4) / layers * rng.uniform(0.8, 1.2))
    scale = (height - ys[0]) / (ys[-1] - ys[0])
    ys = [ys[0] + (y - ys[0]) * scale for y in ys]
    rings = []
    drift = [Vector((0, 0, 0))]
    for k in range(layers + 1):  # strata step sideways a little, so the massif leans and ledges vary
        drift.append(drift[-1] + Vector((rng.uniform(-0.05, 0.05) * rx, 0, rng.uniform(-0.05, 0.05) * rz)))
    top_frac = 0.97 if snow else 0.9
    def ring_at(y, frac, inset, jit, k):
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            steep = 0.5 + 0.5 * math.cos(a - cliff_az)  # one steep cliff face
            shrink = (1 - frac) ** (1.35 - 0.8 * steep)
            gully = 1 - 0.1 * max(0.0, math.sin(a * 7 + seed)) ** 6  # erosion notches run down the face
            r = base_r[s] * shrink * inset * gully * (1 + jit * nz((math.cos(a) * 3, k * 1.7, math.sin(a) * 3), seed + 9))
            ring.append(mb.vert(Vector((math.sin(a) * rx * r, y, math.cos(a) * rz * r)) + drift[k] * (1 - frac * 0.5)))
        return ring
    for k in range(layers):
        frac0 = (ys[k] - ys[0]) / (ys[-1] - ys[0])
        frac1 = (ys[k + 1] - ys[0]) / (ys[-1] - ys[0])
        ledge = rng.uniform(0.15, 0.45)
        lower = ring_at(ys[k], frac0 * top_frac, 1.0, 0.1, k)
        upper = ring_at(ys[k + 1] - (ys[k + 1] - ys[k]) * rng.uniform(0.04, 0.14),
                        (frac0 + (frac1 - frac0) * ledge) * top_frac, 0.98, 0.16, k)
        rings.append((k, lower, upper))
    strata = PAL["strata"]
    def colour(k, n, y):
        base = strata[(k * 2 + seed) % len(strata)]
        c = lerp3(base, PAL["strata_dark"], 0.35 * (1 - max(0.0, n.y)))
        if n.y > 0.55:
            c = lerp3(c, PAL["alpine"], 0.85)
            if snow and y > height * 0.55:
                c = PAL["snow"]
        elif snow and y > height * 0.8 and n.y > 0.2:
            c = lerp3(c, PAL["snow"], 0.8)
        return c
    def quad(q, k):
        n = mb.normal(q)
        y = sum(mb.v[i].y for i in q) / len(q)
        mb.face(q, 0, colour(k, n, y), False)
    for idx, (k, lower, upper) in enumerate(rings):
        for s in range(sides):
            s1 = (s + 1) % sides
            quad([lower[s], lower[s1], upper[s1]], k)
            quad([lower[s], upper[s1], upper[s]], k)
        if idx + 1 < len(rings):
            nxt = rings[idx + 1][1]
            for s in range(sides):
                s1 = (s + 1) % sides
                quad([upper[s], upper[s1], nxt[s1]], k)
                quad([upper[s], nxt[s1], nxt[s]], k)
    last = rings[-1][2]
    cy = sum(mb.v[i].y for i in last) / sides
    peak = mb.vert((rng.uniform(-0.05, 0.05) * rx, height if snow else cy + height * 0.02, 0))
    for s in range(sides):
        quad([last[s], last[(s + 1) % sides], peak], layers)
    bottom = rings[0][1]
    c0 = mb.vert((0, ys[0], 0))
    for s in range(sides):
        mb.face([bottom[(s + 1) % sides], bottom[s], c0], 0, PAL["strata_dark"], False)
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    finish(mb).to_object(name + "_Rock", ["orchard_strata"], coll).parent = root
    return root

# ================================================================ catalogue
CATALOGUE = [
    # id, category, builder, collision, lod
    ("orchard_apple_tree_mature", "tree", lambda c, n: build_tree(c, n, 4101), "capsule trunk r0.22 h1.6 + optional convex limbs; canopy no collision", "LOD1 GLB provided (_lod1); swap at 35 m, cull or impostor past 140 m"),
    ("orchard_apple_tree_mature_autumn", "tree", lambda c, n: build_tree(c, n, 4101, autumn=True), "as mature", "as mature"),
    ("orchard_apple_tree_mature_b", "tree", lambda c, n: build_tree(c, n, 4177), "as mature", "LOD1 GLB provided (_lod1)"),
    ("orchard_apple_tree_young", "tree", lambda c, n: build_tree(c, n, 5230, young=True), "capsule trunk r0.1 h1.0", "LOD1 GLB provided (_lod1); swap at 25 m"),
    ("orchard_apple_tree_young_autumn", "tree", lambda c, n: build_tree(c, n, 5230, young=True, autumn=True), "as young", "as young"),
    ("orchard_apple_tree_mature_lod1", "tree_lod", lambda c, n: build_tree(c, n, 4101, lod=1), "none (LOD)", "is LOD1 of orchard_apple_tree_mature (+_autumn via material swap)"),
    ("orchard_apple_tree_mature_b_lod1", "tree_lod", lambda c, n: build_tree(c, n, 4177, lod=1), "none (LOD)", "is LOD1 of orchard_apple_tree_mature_b"),
    ("orchard_apple_tree_young_lod1", "tree_lod", lambda c, n: build_tree(c, n, 5230, young=True, lod=1), "none (LOD)", "is LOD1 of orchard_apple_tree_young"),
    ("orchard_apple_stump", "tree", lambda c, n: build_stump(c, n, 6301), "cylinder r0.26 h0.45", "none needed"),
    ("orchard_hedge_dense", "shrub", lambda c, n: build_hedge(c, n, 7102), "box 3.0 x 1.35 x 1.1 (centre y 0.67)", "LOD1 GLB provided (_lod1); swap at 30 m"),
    ("orchard_hedge_dense_lod1", "shrub_lod", lambda c, n: build_hedge(c, n, 7102, lod=1), "none (LOD)", "is LOD1 of orchard_hedge_dense"),
    ("orchard_shrub_flowering", "shrub", lambda c, n: build_flowering_shrub(c, n, 7310), "none (walk-through) or small cylinder r0.5", "Godot auto-LOD; cull beyond 60 m"),
    ("orchard_rock_mossy", "rock", lambda c, n: build_mossy_rock(c, n, 8120), "convex hull or box 1.4 x 1.05 x 1.2", "none; Godot auto-LOD"),
    ("orchard_rock_mossy_small", "rock", lambda c, n: build_mossy_rock(c, n, 8155, (0.42, 0.3, 0.36)), "box or none", "none"),
    ("orchard_rubble_split", "rock", lambda c, n: build_rubble(c, n, 8240), "one convex per split half; shards none", "none; cull beyond 80 m"),
    ("orchard_wall_straight", "wall", lambda c, n: build_wall_straight(c, n, 9100), "box 4.0 x 1.3 x 0.62 (centre y 0.65)", "Godot auto-LOD; ~2.9k tris"),
    ("orchard_wall_corner_broken", "wall", lambda c, n: build_wall_corner_broken(c, n, 9200), "two boxes along arms (see HANDOFF)", "Godot auto-LOD"),
    ("orchard_wall_end_broken", "wall", lambda c, n: build_wall_end_broken(c, n, 9300), "box x[-2,1.4] full height + ramped box for rubble", "Godot auto-LOD"),
    ("orchard_path_straight", "ground", lambda c, n: build_path(c, n, 9400), "none (flat ground carries physics)", "none; cast_shadow off"),
    ("orchard_path_curve30", "ground", lambda c, n: build_path(c, n, 9400, bend_deg=30.0), "none", "none; cast_shadow off"),
    ("orchard_path_curve30_left", "ground", lambda c, n: build_path(c, n, 9400, bend_deg=-30.0), "none", "none; cast_shadow off"),
    ("mountain_cliff_chunk", "backdrop", lambda c, n: build_mountain(c, n, 1301, 46, 24, 52, 8), "none (out of bounds) or coarse box", "single LOD, reads at 100-300 m"),
    ("mountain_peak_snow", "backdrop", lambda c, n: build_mountain(c, n, 1377, 58, 44, 105, 10, snow=True), "none", "single LOD, reads at 150-600 m"),
]

# ================================================================ run
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()

def objects_of(root):
    return [root] + list(root.children_recursive)

def stats(root):
    tris, mats, lo, hi = 0, [], Vector((1e9,) * 3), Vector((-1e9,) * 3)
    nodes = []
    for ob in objects_of(root):
        if ob.type != "MESH":
            continue
        nodes.append(ob.name)
        me = ob.data
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        for m in me.materials:
            if m.name not in mats:
                mats.append(m.name)
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            yu = Vector((w.x, w.z, -w.y))  # report in glTF Y-up
            lo = Vector(map(min, lo, yu)); hi = Vector(map(max, hi, yu))
    return {"triangles": tris, "materials": mats, "nodes": nodes,
            "bounds_min": [round(c, 3) for c in lo], "bounds_max": [round(c, 3) for c in hi],
            "size": [round(c, 3) for c in hi - lo]}

def export(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects_of(root):
        ob.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_animations=False, export_cameras=False, export_lights=False, export_materials="EXPORT")
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="MATERIAL")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)

def setup_render_stage():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    sc.render.resolution_x = sc.render.resolution_y = 720
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("Stage")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.72, 0.85, 1)
    bg.inputs[1].default_value = 0.5
    sc.world = world
    stage = bpy.data.collections.new("RenderStage")
    sc.collection.children.link(stage)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    stage.objects.link(sun)
    gm = bpy.data.meshes.new("StageGround")
    gm.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    gmat = bpy.data.materials.new("stage_ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.3, 0.12, 1)
    gmat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    gm.materials.append(gmat)
    ground = bpy.data.objects.new("StageGround", gm)
    stage.objects.link(ground)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50
    stage.objects.link(cam)
    sc.camera = cam
    return ground, cam

def render_asset(aid, root, ground, cam, all_roots):
    for r in all_roots:
        for ob in objects_of(r):
            ob.hide_render = r is not root
    s = stats(root)
    lo, hi = Vector(s["bounds_min"]), Vector(s["bounds_max"])
    # glTF Y-up -> Blender Z-up
    centre = Vector(((lo.x + hi.x) / 2, -(lo.z + hi.z) / 2, (lo.y + hi.y) / 2))
    radius = (hi - lo).length / 2
    ground.scale = (radius * 6, radius * 6, 1)
    ground.location = (centre.x, centre.y, -0.002 if "path" not in aid else -0.001)
    out = {}
    for view, d in (("front", Vector((0, -1, 0.18))), ("threequarter", Vector((0.85, -1.0, 0.55)))):
        d.normalize()
        dist = radius / math.tan(cam.data.angle / 2) * 1.08
        cam.location = centre + d * dist
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_end = dist * 10
        cam.data.clip_start = max(0.01, dist * 0.01)
        path = os.path.join(RENDER_DIR, f"{aid}_{view}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        out[view] = os.path.relpath(path, OUT).replace("\\", "/")
    return out


def dup(root, coll, loc, yaw=0.0):
    """Linked duplicate of an asset hierarchy for review scenes (glTF Y-up loc -> Blender)."""
    r = root.copy()
    coll.objects.link(r)
    for ch in root.children:
        c = ch.copy()
        coll.objects.link(c)
        c.parent = r
        c.hide_render = False
    r.hide_render = False
    r.location = (loc[0], -loc[2], loc[1])
    r.rotation_euler = (0, 0, yaw)
    return r

def review_scenes(byid, ground, cam, all_roots):
    """Scale lineup with a 1.75 m player marker, and a wall/path tiling-join test."""
    coll = bpy.data.collections.new("ReviewScenes")
    bpy.context.scene.collection.children.link(coll)
    for r in all_roots:
        for ob in objects_of(r):
            ob.hide_render = True
    pm = MB()
    v, f = hull([Vector((math.cos(a) * 0.22, y, math.sin(a) * 0.22)) for a in [i * math.pi / 5 for i in range(10)] for y in (0.0, 1.75)])
    pm.append_hull(v, f, 0, lambda n, c: (0, hx("3a6fd0")))
    marker = finish(pm).to_object("review_player_1m75", ["review_marker"], coll)
    made = [marker]
    x = 0.0
    for aid in ("orchard_apple_tree_mature", "orchard_apple_tree_young", "orchard_hedge_dense", "orchard_shrub_flowering",
                "orchard_rock_mossy", "orchard_rubble_split", "orchard_wall_straight", "orchard_apple_stump"):
        made.append(dup(byid[aid], coll, (x, 0, 0)))
        x += {"orchard_apple_tree_mature": 5.2, "orchard_apple_tree_young": 3.4, "orchard_hedge_dense": 2.8}.get(aid, 2.4)
    marker.location = (-2.2, 0, 0)
    def shoot(name, centre, d, dist):
        d = Vector(d).normalized()
        cam.location = Vector(centre) + d * dist
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_end = dist * 10
        bpy.context.scene.render.filepath = os.path.join(RENDER_DIR, name)
        bpy.ops.render.render(write_still=True)
    ground.scale = (60, 60, 1); ground.location = (x / 2, 0, -0.002)
    shoot("review_scale_lineup.png", (x / 2 - 2.0, 0, 1.4), (0.1, -1, 0.22), 31)
    for ob in made:
        for o in objects_of(ob):
            o.hide_render = True
    # tiling: straight, straight, corner(at x=10) turning +Z, straight along +Z, broken end; path run with curve
    t = []
    t.append(dup(byid["orchard_wall_straight"], coll, (2, 0, 0)))
    t.append(dup(byid["orchard_wall_straight"], coll, (6, 0, 0)))
    t.append(dup(byid["orchard_wall_corner_broken"], coll, (10, 0, 0), math.pi))
    t.append(dup(byid["orchard_wall_end_broken"], coll, (-2, 0, 0), math.pi))
    t.append(dup(byid["orchard_wall_straight"], coll, (10, 0, -4), math.pi / 2))
    for i in range(3):
        t.append(dup(byid["orchard_path_straight"], coll, (4, 0, 3 + 4 * i), 0))
    t.append(dup(byid["orchard_path_curve30"], coll, (4, 0, 15), 0))
    ground.location = (4, -4, -0.002)
    shoot("review_tiling_joins.png", (4.0, -5.0, 0.0), (-0.45, -1, 1.15), 24)
    for ob in t:
        for o in objects_of(ob):
            o.hide_render = True
    return ["renders/review_scale_lineup.png", "renders/review_tiling_joins.png"]

def main():
    for d in (GLB_DIR, SRC_DIR, RENDER_DIR):
        os.makedirs(d, exist_ok=True)
    reset()
    sc = bpy.context.scene
    report = {"generator": "output/builder/build_orchard_library.py", "blender": bpy.app.version_string, "assets": []}
    roots = []
    spacing = 0.0
    for aid, cat, fn, collision, lod in CATALOGUE:
        coll = bpy.data.collections.new(aid)
        sc.collection.children.link(coll)
        root = fn(coll, aid)
        roots.append((aid, cat, collision, lod, root))
    for aid, cat, collision, lod, root in roots:
        export(root, os.path.join(GLB_DIR, aid + ".glb"))
        entry = {"id": aid, "category": cat, "glb": f"glb/{aid}.glb", "collision": collision, "lod": lod}
        entry.update(stats(root))
        report["assets"].append(entry)
        print("BUILT", aid, entry["triangles"], entry["size"])
    # lay out the source file for editing: spread collections along X (roots only, GLBs already exported)
    x = 0.0
    for aid, cat, collision, lod, root in roots:
        if cat == "backdrop":
            continue
        w = max(2.0, report["assets"][[a["id"] for a in report["assets"]].index(aid)]["size"][0])
        root.location.x = x + w / 2
        x += w + 1.5
    for aid, cat, collision, lod, root in roots:
        if cat == "backdrop":
            root.location = (x + 60 if aid.startswith("mountain_cliff") else x + 200, 150, 0)
    if DO_RENDER:
        for aid, cat, collision, lod, root in roots:
            root.location = (0, 0, 0)
        ground, cam = setup_render_stage()
        allr = [r[4] for r in roots]
        for (aid, cat, collision, lod, root), entry in zip(roots, report["assets"]):
            if cat.endswith("_lod") and aid not in ("orchard_apple_tree_mature_lod1",):
                continue
            entry["renders"] = render_asset(aid, root, ground, cam, allr)
        report["review_renders"] = review_scenes({r[0]: r[4] for r in roots}, ground, cam, allr)
        for r in allr:
            for ob in objects_of(r):
                ob.hide_render = False
        # restore editing layout
        x = 0.0
        for (aid, cat, collision, lod, root), entry in zip(roots, report["assets"]):
            if cat == "backdrop":
                continue
            w = max(2.0, entry["size"][0])
            root.location.x = x + w / 2
            x += w + 1.5
        for aid, cat, collision, lod, root in roots:
            if cat == "backdrop":
                root.location = (x + 60 if aid.startswith("mountain_cliff") else x + 200, 150, 0)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC_DIR, "orchard_library.blend"), compress=True)
    with open(os.path.join(OUT, "build_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    print("DONE", len(report["assets"]))

main()
