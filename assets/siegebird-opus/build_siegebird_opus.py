"""Siegebird (Opus commission) - reproducible Blender builder.

Run:  blender -b --factory-startup --python build_siegebird_opus.py --python-exit-code 2

Everything is authored in Godot item-local coordinates (X across, Y forward,
Z up) and converted once to Blender as (x, -z, y).  The glTF exporter's +Y-up
conversion then restores the Godot frame exactly.

Identity: "Kingfisher Siegebird" - a walnut-bodied raptor whose laminated
horn-and-enamel wings are the prod.  Drawing the string folds the wings back
like a stooping falcon.  Brass talons hold the string, a crystal eye sights it.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ASM = json.load(open(os.path.join(HERE, "contract", "assembly.json"), encoding="utf-8-sig"))
TAU = math.tau
TRAVEL = ASM["travel"]; DRAW_FRONT = ASM["draw_front"]; DRAW_REAR = ASM["draw_rear"]
RAIL_Z = ASM["rail_height"]
CRANK_C = Vector(ASM["crank_center"]); PINION_C = Vector(ASM["pinion_center"]); GEAR_C = Vector(ASM["gear_center"])
PIN_R = ASM["pinion_radius"]; GEAR_R = ASM["gear_radius"]; CRANK_R = ASM["crank_radius"]
BOLT_SEAT = Vector(ASM["bolt_seat"]); OPTIC_REAR = Vector(ASM["optic_rear"])
DRUM_RC = TRAVEL / TAU + 0.001          # cable centre radius on the drum (runtime)
GUIDE_C = (0.455, DRUM_RC + 0.024)       # (y,z) of the cable guide (runtime)
CABLE_X = 0.14
STRING_R = 0.0038; CABLE_R = 0.0032
GRIP_ANCHOR = Vector((0.0, 0.30, -0.155))
TRIGGER_PIVOT = Vector((0.0, 0.345, -0.078))
LATCH_PIVOT = Vector((0.078, 0.648, -0.088))
CLUTCH_X = 0.243
KNOB_OFS = Vector((0.024, CRANK_R, 0.0))

def G2B(v):
    return Vector((v[0], -v[2], v[1]))

def lerp(a, b, t): return a + (b - a) * t
def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

MAT_DEF = {
    "Walnut":   dict(c="3f2214", m=0.0, r=0.42),
    "Heartwood":dict(c="6a3419", m=0.0, r=0.38),
    "Horn":     dict(c="1d1512", m=0.0, r=0.30),
    "Ivory":    dict(c="e6dcc0", m=0.0, r=0.36),
    "Kingfisher":dict(c="0a5d6e", m=0.0, r=0.22),
    "Ember":    dict(c="d4642a", m=0.0, r=0.30),
    "Brass":    dict(c="d9a54f", m=1.0, r=0.24),
    "Bronze":   dict(c="8c5a36", m=1.0, r=0.34),
    "Steel":    dict(c="6d7885", m=1.0, r=0.32),
    "Leather":  dict(c="3a1410", m=0.0, r=0.58),
    "Crystal":  dict(c="8ff0e6", m=0.0, r=0.04, e="3fe0d0", es=1.6),
    "Cord":     dict(c="d8c49a", m=0.0, r=0.75),
}
MATS = {}
def wood_image(name, size, light, dark, rings, seed):
    """Tileable procedural wood grain (grain runs along U = item forward axis). Packed into the GLB."""
    import numpy as np
    rng = np.random.default_rng(seed)
    u = np.linspace(0, 1, size, endpoint=False)[None, :]; v = np.linspace(0, 1, size, endpoint=False)[:, None]
    warp = np.zeros((size, size))
    for k in range(6):
        fu, fv = int(rng.integers(1, 4)), int(rng.integers(1, 5)); ph = rng.uniform(0, TAU)
        warp += rng.uniform(0.004, 0.018) * np.sin(TAU * (fu * u + fv * v) + ph)
    V = v + warp
    g = 0.5 + 0.5 * np.sin(TAU * (rings * V + 0.35 * np.sin(TAU * (2 * u + 3 * V))))
    g = g ** 2.2
    streak = rng.normal(0, 1, (size, size))
    kern = np.ones(41) / 41
    streak = np.apply_along_axis(lambda r: np.convolve(np.concatenate([r[-20:], r, r[:20]]), kern, 'valid'), 1, streak)
    t = np.clip(0.62 * g + 0.12 * streak * 3 + 0.18, 0, 1)
    L = np.array(srgb(light)[:3]); D = np.array(srgb(dark)[:3])
    col = D[None, None, :] + (L - D)[None, None, :] * t[..., None]
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = np.ones((size, size, 4), dtype=np.float32); px[..., :3] = col
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = 'sRGB'
    return img

def textured(m, img):
    nt = m.node_tree; tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])

def make_materials():
    for name, d in MAT_DEF.items():
        m = bpy.data.materials.new("SB_" + name); m.use_nodes = True
        p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = srgb(d["c"])
        p.inputs["Metallic"].default_value = d["m"]
        p.inputs["Roughness"].default_value = d["r"]
        if "e" in d:
            p.inputs["Emission Color"].default_value = srgb(d["e"])
            p.inputs["Emission Strength"].default_value = d["es"]
        if name in ("Kingfisher", "Ember"):
            p.inputs["Coat Weight"].default_value = 0.6
            p.inputs["Coat Roughness"].default_value = 0.08
        MATS[name] = m
    textured(MATS["Walnut"], wood_image("SB_WalnutGrain", 1024, "5a3420", "24120a", 26, 7))
    textured(MATS["Heartwood"], wood_image("SB_HeartwoodGrain", 512, "8a4a26", "4a2210", 18, 11))
    # Generated feather enamel is confined to selected primary feathers.  The
    # normal map is derived from the same source art; the fine metal outline
    # stays part of the lacquer rather than adding collision geometry.
    art_dir = os.path.normpath(os.path.join(HERE, "textures"))
    enamel = bpy.data.materials.new("SB_FeatherEnamel")
    enamel.use_nodes = True
    surface = enamel.node_tree.nodes["Principled BSDF"]
    surface.inputs["Roughness"].default_value = 0.28
    surface.inputs["Coat Weight"].default_value = 0.45
    surface.inputs["Coat Roughness"].default_value = 0.13
    colour = enamel.node_tree.nodes.new("ShaderNodeTexImage")
    colour.image = bpy.data.images.load(os.path.join(art_dir, "sb_enamel_albedo.png"), check_existing=True)
    colour.image.pack()
    enamel.node_tree.links.new(colour.outputs["Color"], surface.inputs["Base Color"])
    normal_image = enamel.node_tree.nodes.new("ShaderNodeTexImage")
    normal_image.image = bpy.data.images.load(os.path.join(art_dir, "sb_enamel_normal.png"), check_existing=True)
    normal_image.image.colorspace_settings.name = "Non-Color"
    normal_image.image.pack()
    normal = enamel.node_tree.nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.24
    enamel.node_tree.links.new(normal_image.outputs["Color"], normal.inputs["Color"])
    enamel.node_tree.links.new(normal.outputs["Normal"], surface.inputs["Normal"])
    MATS["FeatherEnamel"] = enamel

# ---------------------------------------------------------------- mesh builder
class MB:
    """Accumulates geometry in Godot coordinates.  svals: optional per-vertex limb param."""
    def __init__(self):
        self.v = []; self.f = []; self.m = []; self.s = []; self.flat = []
    def add(self, verts, faces, mat, s=None, flat=False):
        o = len(self.v)
        self.v += [Vector(p) for p in verts]
        self.s += [s if not callable(s) else s(Vector(p)) for p in verts] if s is not None else [None] * len(verts)
        for i, fc in enumerate(faces):
            self.f.append(tuple(i2 + o for i2 in fc))
            self.m.append(mat[i] if isinstance(mat, list) else mat)
            self.flat.append(flat)
        return self
    def add_bm(self, bm, mat, s=None, flat=False):
        bm.verts.index_update()
        verts = [v.co.copy() for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        mats = [mat[f.material_index] if isinstance(mat, list) else mat for f in bm.faces]
        bm.free()
        return self.add(verts, faces, mats, s, flat)
    def extend(self, other):
        o = len(self.v); self.v += other.v; self.s += other.s
        self.f += [tuple(i + o for i in fc) for fc in other.f]; self.m += other.m; self.flat += other.flat
        return self
    def to_object(self, name, pivot=(0, 0, 0), coll=None, smooth_angle=38):
        pivot = Vector(pivot)
        me = bpy.data.meshes.new(name)
        mats = []
        for mn in self.m:
            if mn not in mats: mats.append(mn)
        me.from_pydata([G2B(p - pivot) for p in self.v], [], self.f)
        for mn in mats: me.materials.append(MATS[mn])
        for poly, mn, fl in zip(me.polygons, self.m, self.flat):
            poly.material_index = mats.index(mn); poly.use_smooth = not fl
        me.validate(clean_customdata=False); me.update()
        if smooth_angle: me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        uv = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            n = poly.normal; gn = (abs(n.x), abs(n.z), abs(n.y))   # godot (x, y, z) magnitudes
            for li in poly.loop_indices:
                b = me.vertices[me.loops[li].vertex_index].co + G2B(pivot); gx, gy, gz = b.x, b.z, -b.y
                if gn[2] >= gn[0] and gn[2] >= gn[1]: uv.data[li].uv = (gy * 3.0, gx * 3.0 + 0.37)
                elif gn[0] >= gn[1]: uv.data[li].uv = (gy * 3.0, gz * 3.0)
                else: uv.data[li].uv = (gx * 3.0, gz * 3.0 + 0.61)
        ob = bpy.data.objects.new(name, me); ob.location = G2B(pivot)
        (coll or ASSET).objects.link(ob)
        return ob

def bm_from(verts, faces):
    bm = bmesh.new(); vv = [bm.verts.new(p) for p in verts]
    for fc in faces:
        try: bm.faces.new([vv[i] for i in fc])
        except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def bevel_sharp(bm, off, segs=2, ang=0.6):
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > ang]
    if edges and off > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=off, offset_type='OFFSET', segments=segs,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm

# ---------------------------------------------------------------- primitives
AX = {'x': (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
      'y': (Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))),
      'z': (Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0)))}

def lathe(mb, prof, origin, axis, mat, segs=32, closed=False, flat=False, phase=0.0, s=None):
    """prof: list of (axial, radius). closed=True revolves a closed 2D loop (tube walls)."""
    A, U, V = AX[axis] if isinstance(axis, str) else [Vector(a) for a in axis]
    o = Vector(origin); verts = []; faces = []; rings = []
    for a, r in prof:
        if r < 1e-6 and not closed:
            rings.append([len(verts)]); verts.append(o + A * a); continue
        ring = []
        for k in range(segs):
            t = phase + TAU * k / segs
            ring.append(len(verts)); verts.append(o + A * a + (U * math.cos(t) + V * math.sin(t)) * r)
        rings.append(ring)
    n = len(rings); last = n if closed else n - 1
    for i in range(last):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            k1 = (k + 1) % segs
            if len(r0) == 1: faces.append((r0[0], r1[k1], r1[k]))
            elif len(r1) == 1: faces.append((r0[k], r0[k1], r1[0]))
            else: faces.append((r0[k], r0[k1], r1[k1], r1[k]))
    if not closed:
        if len(rings[0]) > 1: faces.append(tuple(reversed(rings[0])))
        if len(rings[-1]) > 1: faces.append(tuple(rings[-1]))
    bm = bm_from(verts, faces)
    return mb.add_bm(bm, mat, s, flat)

def prism(mb, poly, origin, U, V, N, d0, d1, mat, bev=0.0015, segs=2, s=None, flat=False):
    o = Vector(origin); U = Vector(U); V = Vector(V); N = Vector(N)
    bm = bmesh.new()
    vs = [bm.verts.new(o + U * u + V * v + N * d0) for u, v in poly]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for e in ext["geom"]:
        if isinstance(e, bmesh.types.BMVert): e.co += N * (d1 - d0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bevel_sharp(bm, bev, segs)
    return mb.add_bm(bm, mat, s, flat)

def rbox(mb, lo, hi, mat, bev=0.0015, segs=2, s=None):
    lo = Vector(lo); hi = Vector(hi)
    return prism(mb, [(lo.x, lo.y), (hi.x, lo.y), (hi.x, hi.y), (lo.x, hi.y)], (0, 0, 0),
                 (1, 0, 0), (0, 1, 0), (0, 0, 1), lo.z, hi.z, mat, bev, segs, s)

def annulus(mb, outline, rin, center, axis, a0, a1, mat, bev=0.0008, s=None):
    """Star-shaped outline (list of (angle, radius)) plate with a round bore, extruded along axis."""
    A, U, V = AX[axis]; c = Vector(center); n = len(outline); verts = []; faces = []
    for a in (a0, a1):
        for ang, R in outline: verts.append(c + A * a + (U * math.cos(ang) + V * math.sin(ang)) * R)
        for ang, R in outline: verts.append(c + A * a + (U * math.cos(ang) + V * math.sin(ang)) * rin)
    O0, I0, O1, I1 = 0, n, 2 * n, 3 * n
    for k in range(n):
        k1 = (k + 1) % n
        faces += [(O0 + k1, O0 + k, I0 + k, I0 + k1), (O1 + k, O1 + k1, I1 + k1, I1 + k),
                  (O0 + k, O0 + k1, O1 + k1, O1 + k), (I0 + k1, I0 + k, I1 + k, I1 + k1)]
    bm = bm_from(verts, faces); bevel_sharp(bm, bev, 1, 0.9)
    return mb.add_bm(bm, mat, s)

def frames(pts):
    pts = [Vector(p) for p in pts]; n = len(pts); T = []
    for i in range(n):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, n - 1)]; T.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [(ref - T[0] * ref.dot(T[0])).normalized()]
    for i in range(1, n):
        v = N[-1] - T[i] * N[-1].dot(T[i]); N.append(v.normalized())
    return pts, T, N

def tube(mb, pts, radius, mat, segs=12, cap=True, s=None, rfun=None):
    pts, T, N = frames(pts); verts = []; faces = []
    for i, p in enumerate(pts):
        B = T[i].cross(N[i]); r = rfun(i / (len(pts) - 1)) if rfun else radius
        for k in range(segs):
            t = TAU * k / segs
            verts.append(p + (N[i] * math.cos(t) + B * math.sin(t)) * r)
    for i in range(len(pts) - 1):
        for k in range(segs):
            k1 = (k + 1) % segs
            faces.append((i * segs + k, i * segs + k1, (i + 1) * segs + k1, (i + 1) * segs + k))
    if cap:
        faces.append(tuple(reversed(range(segs))))
        faces.append(tuple(range((len(pts) - 1) * segs, len(pts) * segs)))
    return mb.add_bm(bm_from(verts, faces), mat, s)

def loft(mb, rings, mat, cap=True, s=None, flat=False):
    verts = []; faces = []; n = len(rings[0])
    for r in rings: verts += [Vector(p) for p in r]
    for i in range(len(rings) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    if cap:
        faces.append(tuple(reversed(range(n)))); faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return mb.add_bm(bm_from(verts, faces), mat, s, flat)

def superellipse(n, a, b, e=2.6, cx=0, cz=0, phase=0):
    pts = []
    for k in range(n):
        t = TAU * k / n + phase; c, s_ = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / e), c), cz + b * math.copysign(abs(s_) ** (2 / e), s_)))
    return pts

def catmull(pts, n):
    pts = [Vector(p) for p in pts]; P = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(P) - 2):
        for k in range(n):
            t = k / n; p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1]); return out

def resample(pts, n):
    pts = [Vector(p) for p in pts]; L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    out = []; j = 0
    for k in range(n):
        d = L[-1] * k / (n - 1)
        while j < len(L) - 2 and L[j + 1] < d: j += 1
        t = (d - L[j]) / max(1e-9, L[j + 1] - L[j]); out.append(pts[j].lerp(pts[j + 1], t))
    return out, L[-1]

def body_rings(sections, n=28, e=2.6, dense=6):
    """sections: (y, halfwidth, ztop, zbottom[, exponent]) -> smooth rings."""
    keys = [Vector((s[0], s[1], s[2], s[3])) for s in sections]
    rings = []
    for q in catmull(keys, dense):
        y, w, t, b = q
        rings.append([(x, y, z) for x, z in superellipse(n, w, (t - b) / 2, e, 0, (t + b) / 2, -math.pi / 2)])
    return rings

# ---------------------------------------------------------------- gears
def involute_outline(N, module, rpitch, phase, backlash=0.0006, per_flank=6):
    ra = rpitch + module; rf = rpitch - 1.25 * module; rb = rpitch * math.cos(math.radians(20))
    inv = lambda a: math.tan(a) - a
    ap = math.acos(rb / rpitch)
    half = (math.pi / N) / 2 - backlash / (2 * rpitch)
    def theta(r):
        r = max(r, rb); return half + inv(ap) - inv(math.acos(min(1, rb / r)))
    out = []
    for i in range(N):
        c = phase + TAU * i / N
        rs = [rf] + [lerp(max(rf, rb), ra, k / (per_flank - 1)) for k in range(per_flank)]
        out.append((c - math.pi / N, rf)); out.append((c - math.pi / N * 0.6, rf))
        for r in rs: out.append((c - theta(r), r))
        out.append((c, ra))
        for r in reversed(rs): out.append((c + theta(r), r))
        out.append((c + math.pi / N * 0.6, rf))
    return out

# ================================================================ BUILD
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global ASSET
    ASSET = bpy.data.collections.new("Siegebird_Asset"); bpy.context.scene.collection.children.link(ASSET)
    make_materials()

OBJ = {}

def build_body():
    st = MB()
    # --- main stock: tail -> riser, a tapering bird body
    secs = [(0.112, 0.016, 0.074, 0.046), (0.130, 0.027, 0.084, 0.024), (0.17, 0.031, 0.094, -0.004),
            (0.23, 0.029, 0.106, -0.036), (0.32, 0.031, 0.114, -0.060), (0.41, 0.037, 0.116, -0.064),
            (0.50, 0.043, 0.114, -0.058), (0.62, 0.045, 0.112, -0.055), (0.74, 0.045, 0.112, -0.050),
            (0.83, 0.052, 0.116, -0.030)]
    loft(st, body_rings(secs, 32, 2.8), "Walnut")
    for sx in (-1, 1):
        gw = []
        for q in catmull([Vector(x[:4]) for x in secs[1:]], 6):
            y, w, t, b = q
            gw.append((sx * (0.80 * w + 0.0012), y, (t + b) / 2 + 0.765 * (t - b) / 2))
        tube(st, gw, 0.0017, "Brass", 8)
    # inlaid kingfisher stripe along the flank (thin raised strip, both sides)
    for sx in (-1, 1):
        pts = [(sx * (w + 0.0004), y, lerp(b, t, 0.62)) for y, w, t, b in
               [(0.15, 0.0296, 0.089, 0.010), (0.20, 0.0302, 0.100, -0.020), (0.26, 0.0289, 0.108, -0.045), (0.30, 0.0300, 0.112, -0.055)]]
        tube(st, catmull(pts, 6), 0.0022, "Kingfisher", 8)
    # --- rail (blued steel T-rail with bolt groove), y 0.43 -> 0.965
    # crowned head: the bow string (r 3.8 mm, sloping outward) skims just above it
    groove = [(-0.0058, 0.1736), (-0.0042, 0.1726), (-0.0022, 0.1720), (0.0, 0.1718), (0.0022, 0.1720), (0.0042, 0.1726), (0.0058, 0.1736)]
    prof = [(-0.0065, 0.100), (0.0065, 0.100), (0.0065, 0.1515), (0.0155, 0.1515), (0.0155, 0.1700), (0.0142, 0.1716), (0.0100, 0.1730)] + \
           list(reversed(groove)) + [(-0.0100, 0.1730), (-0.0142, 0.1716), (-0.0155, 0.1700), (-0.0155, 0.1515), (-0.0065, 0.1515)]
    # prof is in (x,z); extrude along y
    prism(st, prof, (0, 0.43, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.535, "Steel", bev=0.0006, segs=1)
    prism(st, superellipse(20, 0.0158, 0.016, 3.0, 0, 0.112), (0, 0.44, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.40, "Heartwood", 0.0, 1)
    for y in (0.47, 0.56, 0.65, 0.74, 0.83):
        lathe(st, [(-0.003, 0.0), (-0.003, 0.0175), (0.003, 0.0175), (0.003, 0.0)], (0, y, 0.113), 'y', "Brass", 20)
    # rear rail cap and string stop
    rbox(st, (-0.020, 0.418, 0.100), (0.020, 0.432, 0.170), "Brass", 0.003)
    # rivets along the rail web
    for y in [0.46, 0.53, 0.60, 0.67, 0.74, 0.81]:
        lathe(st, [(0, 0.003), (0.0012, 0.0028), (0.0022, 0.0015), (0.0026, 0)], (0.0065, y, 0.125), 'x', "Brass", 10)
        lathe(st, [(0, 0.003), (0.0012, 0.0028), (0.0022, 0.0015), (0.0026, 0)], (-0.0065, y, 0.125), ((-1, 0, 0), (0, 1, 0), (0, 0, 1)), "Brass", 10)

    # --- riser / breast where the wings are seated
    rsec = [(0.815, 0.060, 0.148, 0.050), (0.845, 0.100, 0.150, 0.040), (0.90, 0.104, 0.150, 0.042),
            (0.940, 0.070, 0.150, 0.058), (0.966, 0.030, 0.150, 0.085)]
    loft(st, body_rings(rsec, 32, 3.2, 5), "Walnut")
    # brass shoulder bands where limbs enter
    for sx in (-1, 1):
        lathe(st, [(-0.004, 0.0), (-0.004, 0.034), (0.0, 0.037), (0.012, 0.037), (0.016, 0.033), (0.016, 0.0)],
              (sx * 0.100, 0.884, 0.105), ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Brass", 28)
    # breast plate (ember enamel, kingfisher belly)
    tube(st, catmull([(0, 0.93, 0.05), (0, 0.955, 0.075), (0, 0.968, 0.11)], 6), 0.012, "Ember", 14,
         rfun=lambda t: 0.013 * (1 - 0.4 * t))
    # beak (brass hooked muzzle under the bolt)
    bsec = [(0.960, 0.030, 0.160, 0.080), (0.990, 0.022, 0.160, 0.092), (1.018, 0.014, 0.156, 0.104),
            (1.040, 0.007, 0.142, 0.112), (1.052, 0.002, 0.124, 0.113)]
    loft(st, body_rings(bsec, 24, 2.4, 4), "Brass")
    # crystal eyes on the head
    for sx in (-1, 1):
        lathe(st, [(0, 0), (0.002, 0.0072), (0.006, 0.0062), (0.008, 0)], (sx * 0.024, 0.972, 0.132),
              ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Crystal", 8, flat=True)
        lathe(st, [(-0.001, 0.0), (-0.001, 0.0095), (0.0025, 0.0095), (0.0025, 0.0074), (0.0, 0.0074)], (sx * 0.024, 0.972, 0.132),
              ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Brass", 20)

    # --- bolt hold-down feather spring (clear of bolt by ~1 mm)
    tube(st, catmull([(0, 0.905, 0.200), (0, 0.925, 0.1905), (0, 0.945, 0.1895)], 6), 0.0022, "Brass", 10)

    # --- optic: forked swan neck from the breast to a crystal-eyed sight
    necl = catmull([Vector((0.872, 0.138, 0)), Vector((0.868, 0.19, 0)), Vector((0.855, 0.236, 0)), Vector((0.828, 0.270, 0)),
                    Vector((0.796, 0.287, 0)), Vector((0.774, 0.291, 0))], 6)
    half = lambda t: lerp(0.0125, 0.0055, t)
    L_, R_ = [], []
    for i, q in enumerate(necl):
        tng = (necl[min(i + 1, len(necl) - 1)] - necl[max(i - 1, 0)]).normalized(); nrm = Vector((-tng.y, tng.x, 0))
        h = half(i / (len(necl) - 1)); L_.append(q + nrm * h); R_.append(q - nrm * h)
    neck_poly = [(q.x, q.y) for q in L_] + [(q.x, q.y) for q in reversed(R_)]
    for sx in (-1, 1):
        prism(st, neck_poly, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), sx * 0.0170, sx * 0.0215, "Bronze", 0.0014, 2)
        tube(st, [Vector((sx * 0.0222, q.x, q.y)) for q in necl[2:-3]], 0.0012, "Brass", 6)
    rbox(st, (-0.0172, 0.838, 0.244), (0.0172, 0.852, 0.254), "Brass", 0.002)
    rbox(st, (-0.0172, 0.800, 0.276), (0.0172, 0.812, 0.284), "Brass", 0.002)
    fr = Vector((0, 0.770, OPTIC_REAR.z))
    lathe(st, [(-0.006, 0.0215), (-0.006, 0.0275), (-0.002, 0.030), (0.004, 0.030), (0.007, 0.027), (0.007, 0.0215)],
          fr, 'y', "Brass", 36, closed=True)
    # crystal bead front sight on four fine wires
    lathe(st, [(-0.007, 0), (-0.002, 0.0048), (0.002, 0.0048), (0.008, 0)], fr, 'y', "Crystal", 8, flat=True)
    for a in (0.785, 2.356, 3.927, 5.498):
        d = Vector((math.cos(a), 0, math.sin(a)))
        tube(st, [fr + d * 0.004, fr + d * 0.0222], 0.0007, "Steel", 6)
    # three rods to the rear eyepiece
    for a in (math.pi / 2, math.pi / 2 + TAU / 3, math.pi / 2 + 2 * TAU / 3):
        d = Vector((math.cos(a), 0, math.sin(a))) * 0.0255
        tube(st, [OPTIC_REAR + d + Vector((0, 0.006, 0)), fr + d - Vector((0, 0.006, 0))], 0.0021, "Brass", 8)
    # crest feather above the optic (bird identity, above sight line)
    crest = [(0.0, 0.0), (0.03, 0.006), (0.075, 0.012), (0.11, 0.022), (0.118, 0.028), (0.09, 0.024), (0.05, 0.018), (0.012, 0.012)]
    prism(st, [(0.775 - u, 0.34 + v) for u, v in crest], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0018, 0.0018, "Kingfisher", 0.0008, 1)

    # --- right gearbox cheek (bronze openwork) at x 0.211..0.219
    gy, gz = GEAR_C.y, 0.0
    ring = [(TAU * k / 64, 0.094) for k in range(64)]
    annulus(st, ring, 0.086, (0.211, gy, gz), 'x', 0.0, 0.008, "Bronze")
    for k in range(5):
        a = TAU * k / 5 + 0.3
        d = Vector((0, math.cos(a), math.sin(a)))
        tube(st, [Vector((0.215, gy, gz)) + d * 0.016, Vector((0.215, gy, gz)) + d * 0.087], 0.0034, "Bronze", 8)
    annulus(st, [(TAU * k / 32, 0.017) for k in range(32)], 0.0085, (0.211, gy, gz), 'x', 0.0, 0.0135, "Brass")
    annulus(st, [(TAU * k / 32, 0.018) for k in range(32)], 0.0085, (0.211, PINION_C.y, 0), 'x', 0.0, 0.0135, "Brass")
    # bridge bar joining pinion boss to ring
    rbox(st, (0.211, PINION_C.y + 0.012, -0.007), (0.219, gy - 0.088, 0.007), "Bronze", 0.0015)
    for (py, pz) in [(0.585, -0.085), (0.745, -0.045), (0.492, -0.062)]:
        tube(st, [(0.030, py, pz), (0.214, py, pz)], 0.0065, "Steel", 12)
        lathe(st, [(0, 0), (0, 0.009), (0.004, 0.0085), (0.006, 0)], (0.219, py, pz), 'x', "Brass", 6, flat=True)
    # the lower posts meet the ring via small lugs
    tube(st, [(0.215, 0.585, -0.085), (0.215, 0.600, -0.075)], 0.006, "Bronze", 10)
    tube(st, [(0.215, 0.745, -0.045), (0.215, 0.735, -0.045)], 0.006, "Bronze", 10)
    tube(st, [(0.215, 0.492, -0.062), (0.215, 0.525, -0.018)], 0.005, "Bronze", 10)
    # inboard bearing bosses on the flank
    for (y, z, x1) in [(PINION_C.y, 0.0, 0.070), (gy, 0.0, 0.080)]:
        lathe(st, [(0.030, 0.0086), (0.030, 0.015), (x1 - 0.004, 0.015), (x1, 0.012), (x1, 0.0086)], (0, y, z), 'x', "Brass", 24, closed=True)
    # cable guide (grooved talon sheave) at runtime guide centre
    gyc, gzc = GUIDE_C
    lathe(st, [(-0.011, 0.0), (-0.011, 0.029), (-0.008, 0.031), (-0.005, 0.030), (-0.0042, 0.0225),
               (-0.0026, 0.0208 - 0.0), (0.0, 0.0203), (0.0026, 0.0208), (0.0042, 0.0225), (0.005, 0.030),
               (0.008, 0.031), (0.011, 0.029), (0.011, 0.0)], (CABLE_X, gyc, gzc), 'x', "Brass", 40)
    tube(st, [(0.030, gyc, gzc), (0.157, gyc, gzc)], 0.0048, "Steel", 12)
    lathe(st, [(0, 0), (0, 0.0075), (0.004, 0.007), (0.006, 0)], (0.157, gyc, gzc), 'x', "Steel", 6, flat=True)
    # talon bracket cradling the sheave from below-rear
    talon = catmull([(0.14 + 0.0, 0.47, 0.030), (0.14, 0.44, 0.028), (0.14, 0.422, 0.052)], 6)
    for dx in (-0.0145, 0.0145):
        tube(st, [p + Vector((dx, 0, 0)) for p in talon], 0.0028, "Bronze", 8,
             rfun=lambda t: 0.0034 - 0.0022 * t)
        tube(st, [(0.14 + dx, gyc, gzc), (0.14 + dx, 0.47, 0.030)], 0.0028, "Bronze", 8)

    # --- latch bracket (holds the pawl pin under the drum)
    rbox(st, (0.012, 0.628, -0.100), (0.030, 0.668, -0.076), "Steel", 0.003)
    for yy in (0.6305, 0.6605):
        rbox(st, (0.030, yy - 0.0025, -0.098), (0.086, yy + 0.0025, -0.078), "Steel", 0.0012)
    tube(st, [(LATCH_PIVOT.x, 0.626, LATCH_PIVOT.z), (LATCH_PIVOT.x, 0.6345, LATCH_PIVOT.z)], 0.0032, "Brass", 10)
    tube(st, [(LATCH_PIVOT.x, 0.6615, LATCH_PIVOT.z), (LATCH_PIVOT.x, 0.670, LATCH_PIVOT.z)], 0.0032, "Brass", 10)

    # --- left reel mount (mirrors the gearbox cheek) + socket spindle to runtime socket
    ly, lz = 0.53, 0.02
    annulus(st, [(TAU * k / 48, 0.060) for k in range(48)], 0.052, (-0.148, ly, lz), 'x', 0.0, 0.008, "Bronze")
    for k in range(6):
        a = TAU * k / 6 + 0.26; d = Vector((0, math.cos(a), math.sin(a)))
        tube(st, [Vector((-0.144, ly, lz)) + d * 0.014, Vector((-0.144, ly, lz)) + d * 0.054], 0.003, "Bronze", 8)
    lathe(st, [(-0.2125, 0.0), (-0.2125, 0.016), (-0.206, 0.016), (-0.203, 0.0105), (-0.150, 0.0105), (-0.146, 0.016), (-0.139, 0.016), (-0.139, 0)],
          (0, ly, lz), 'x', "Steel", 24)
    for (py, pz) in [(0.49, -0.035), (0.575, -0.030), (0.53, 0.068)]:
        tube(st, [(-0.030, py, pz), (-0.144, py, pz)], 0.0055, "Steel", 12)
    # selector tab bracket (runtime tab box at (-0.20,0.42,0.08))
    tube(st, catmull([(-0.142, 0.487, 0.052), (-0.150, 0.445, 0.072), (-0.1625, 0.42, 0.08)], 5), 0.0045, "Bronze", 10)
    rbox(st, (-0.166, 0.404, 0.066), (-0.1625, 0.436, 0.094), "Brass", 0.0012)
    # status lamp bezel (runtime lamp ball at (-0.075,0.40,0.105))
    lathe(st, [(0.0, 0.0), (0.0, 0.019), (0.006, 0.0225), (0.010, 0.0225), (0.010, 0.019), (0.004, 0.0165), (0.004, 0.0)],
          (-0.075, 0.40, 0.086), 'z', "Brass", 32)
    tube(st, catmull([(-0.030, 0.40, 0.096), (-0.050, 0.40, 0.092), (-0.062, 0.40, 0.089)], 4), 0.005, "Bronze", 10)

    # --- trigger housing + guard
    for sx in (-1, 1):
        prism(st, [(0.326, -0.058), (0.366, -0.058), (0.364, -0.080), (0.352, -0.094), (0.334, -0.092), (0.326, -0.080)],
              (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), sx * 0.0056, sx * 0.0108, "Brass", 0.0012, 2)
        lathe(st, [(0, 0), (0, 0.0035), (0.002, 0.003), (0.003, 0)], (sx * 0.0108, TRIGGER_PIVOT.y, TRIGGER_PIVOT.z),
              ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Steel", 10)
    guard = catmull([(0, 0.366, -0.070), (0, 0.392, -0.100), (0, 0.392, -0.140), (0, 0.370, -0.168),
                     (0, 0.335, -0.174), (0, 0.318, -0.166)], 6)
    tube(st, guard, 0.0055, "Brass", 12, rfun=lambda t: 0.0052 + 0.0018 * math.sin(math.pi * t))

    # --- pistol grip (leather over walnut, raked) around GripAnchor
    gring = []
    for q in catmull([Vector((0.318, -0.045, 0.020)), Vector((0.306, -0.10, 0.024)), Vector((0.296, -0.155, 0.025)),
                      Vector((0.284, -0.205, 0.024)), Vector((0.276, -0.236, 0.022))], 5):
        y, z, r = q
        gring.append([(x, y + yy, z) for x, yy in superellipse(24, 0.0175 * r / 0.024, r, 2.3)])
    loft(st, gring, "Leather")
    # stitched ridges (brass wire wraps)
    for zz in (-0.085, -0.125, -0.165, -0.205):
        yc = lerp(0.318, 0.276, (-0.045 - zz) / 0.191)
        tube(st, [(x, yc + yy, zz) for x, yy in superellipse(24, 0.0184, 0.0255, 2.3)] + [(0.0184 * 1.0, yc, zz)], 0.0011, "Brass", 6, cap=False)
    lathe(st, [(0.0, 0.0), (0.0, 0.030), (-0.010, 0.028), (-0.018, 0.018), (-0.022, 0.0)], (0, 0.274, -0.236), 'z', "Brass", 28)

    # --- keel fore-grip (bird breastbone): walnut web + leather bar
    bar = catmull([(0, 0.50, -0.140), (0, 0.54, -0.156), (0, 0.70, -0.162), (0, 0.86, -0.156), (0, 0.905, -0.138)], 8)
    tube(st, bar, 0.024, "Leather", 22, rfun=lambda t: 0.0145 + 0.0085 * math.sin(math.pi * min(1, max(0, t))) ** 0.35)
    for p_ in (bar[0], bar[-1]):
        lathe(st, [(-0.0155, 0), (-0.0135, 0.008), (-0.006, 0.0148), (0.0, 0.0158), (0.006, 0.0148), (0.0135, 0.008), (0.0155, 0)], p_, 'y', "Brass", 24)
    for yy, zz in [(0.56, -0.1575), (0.84, -0.1575)]:
        lathe(st, [(-0.005, 0), (-0.005, 0.0238), (0.005, 0.0238), (0.005, 0)], (0, yy, zz), 'y', "Brass", 28)
    for (y0, z0, y1, z1) in [(0.50, -0.055, 0.51, -0.13), (0.70, -0.052, 0.70, -0.14), (0.83, -0.046, 0.87, -0.14), (0.93, 0.045, 0.905, -0.125)]:
        pts_ = catmull([(0, y0, z0), (0, lerp(y0, y1, 0.5) - 0.01, lerp(z0, z1, 0.5)), (0, y1, z1)], 6)
        tube(st, pts_, 0.009, "Walnut", 14, rfun=lambda t: 0.0105 - 0.004 * math.sin(math.pi * t))
        lathe(st, [(-0.004, 0), (-0.004, 0.0098), (0.004, 0.0098), (0.004, 0)], pts_[len(pts_) // 2], 'z', "Brass", 18)
    # --- tail fan (five layered tail feathers behind the grip)
    for i, a in enumerate([-0.50, -0.25, 0.0, 0.25, 0.50]):
        L = 0.17 - 0.012 * abs(a) / 0.25
        feather = [(0.0, -0.011), (L * 0.45, -0.023), (L * 0.88, -0.022), (L, -0.008), (L * 0.96, 0.0), (L, 0.008),
                   (L * 0.88, 0.022), (L * 0.45, 0.023), (0.0, 0.011)]
        c, s_ = math.cos(math.pi / 2 + math.pi + a), math.sin(math.pi / 2 + math.pi + a)
        U = (c, s_, 0.0); V = (-s_, c, 0.0)
        z0 = 0.058 + 0.005 * (2 - abs(i - 2))
        prism(st, feather, (0, 0.150, 0), U, V, (0, 0, 1), z0, z0 + 0.0045,
              "Kingfisher" if i % 2 == 0 else "Ivory", 0.0012, 2)
        tube(st, [Vector((0, 0.150, z0 + 0.0048)) + Vector(U) * 0.01, Vector((0, 0.150, z0 + 0.0048)) + Vector(U) * (L * 0.9)],
             0.0016, "Brass", 6, rfun=lambda t: 0.0018 * (1 - 0.6 * t))
    lathe(st, [(-0.030, 0.0), (-0.030, 0.012), (-0.020, 0.024), (0.0, 0.029), (0.010, 0.027), (0.016, 0.018), (0.019, 0.0)], (0, 0.132, 0.058), 'z', "Brass", 32)
    lathe(st, [(0.0, 0.0), (0.0, 0.0065), (0.003, 0.006), (0.005, 0.0)], (0, 0.132, 0.077), 'z', "Crystal", 8, flat=True)
    # brass collar bands on the stock
    for y in (0.20, 0.44):
        rr = [(x, y, z) for x, z in superellipse(32, 0.0015, 0.0015)]
    return st

# ---------------------------------------------------------------- wings (prod)
LIMB_CTRL = [(0.040, 0.872), (0.120, 0.898), (0.240, 0.930), (0.350, 0.946), (0.440, 0.933),
             (0.505, 0.895), (0.540, 0.847), (0.551, 0.800)]
NS = 140
def limb_centerline():
    pts = catmull([Vector((x, y, 0)) for x, y in LIMB_CTRL], 16)
    pts, L = resample(pts, NS)
    return [Vector((p.x, p.y)) for p in pts], L

def solve_bend(C):
    s = [i / (NS - 1) for i in range(NS)]
    w1 = [smoothstep(0.10, 0.60, t) for t in s]; w2 = [smoothstep(0.50, 0.90, t) for t in s]
    def bent(A, B):
        P = [C[0].copy()]; phis = [A * w1[i] + B * w2[i] for i in range(NS)]
        for i in range(NS - 1):
            ph = 0.5 * (phis[i] + phis[i + 1]); d = C[i + 1] - C[i]
            P.append(P[-1] + Vector((d.x * math.cos(ph) - d.y * math.sin(ph), d.x * math.sin(ph) + d.y * math.cos(ph))))
        return P, phis
    target = C[-1] + Vector((-0.053, -0.030)); A, B = -0.05, -0.2
    for _ in range(30):
        P, _ph = bent(A, B); r = P[-1] - target
        if r.length < 1e-7: break
        h = 1e-5
        Pa, _ = bent(A + h, B); Pb, _ = bent(A, B + h)
        ja = (Pa[-1] - P[-1]) / h; jb = (Pb[-1] - P[-1]) / h
        det = ja.x * jb.y - ja.y * jb.x
        dA = (r.x * jb.y - r.y * jb.x) / det; dB = (ja.x * r.y - ja.y * r.x) / det
        A -= dA; B -= dB
    P, phis = bent(A, B)
    return P, phis, (A, B)

def build_wings():
    C, L = limb_centerline()
    P, phis, AB = solve_bend(C)
    right = MB()
    # plan normals (pointing backward/towards shooter)
    T = [(C[min(i + 1, NS - 1)] - C[max(i - 1, 0)]).normalized() for i in range(NS)]
    Nb = [Vector((t.y, -t.x)) for t in T]   # right-hand normal: for a limb heading +x this is -y (back)
    zc = 0.105
    # laminated limb: section loop with material bands
    sec_n = 20; verts = []; faces = []; fmat = []; svals = []
    def th(s): return lerp(0.0115, 0.0058, s ** 0.9)
    def hh(s): return lerp(0.027, 0.0115, s ** 1.1)
    for i in range(NS - 2):   # stop short; tip nock covers the end
        s = i / (NS - 1)
        for k in range(sec_n):
            t = TAU * k / sec_n; c, sn = math.cos(t), math.sin(t)
            u = th(s) * math.copysign(abs(c) ** 0.55, c); v = hh(s) * math.copysign(abs(sn) ** 0.75, sn)
            p = C[i] + Nb[i] * u
            verts.append((p.x, p.y, zc + v)); svals.append(i)
    rows = NS - 2
    for i in range(rows - 1):
        for k in range(sec_n):
            k1 = (k + 1) % sec_n
            faces.append((i * sec_n + k, (i + 1) * sec_n + k, (i + 1) * sec_n + k1, i * sec_n + k1))
            a = TAU * (k + 0.5) / sec_n
            sa = math.sin(a); ca = math.cos(a)
            if abs(sa) > 0.80: fmat.append("Ivory")            # top/bottom lamination edges
            elif ca < 0: fmat.append("Kingfisher")               # front (back of bow) enamel
            else: fmat.append("Horn")                            # belly horn
    faces.append(tuple(reversed(range(sec_n)))); fmat.append("Horn")
    faces.append(tuple(range((rows - 1) * sec_n, rows * sec_n))); fmat.append("Horn")
    right.add(verts, faces, fmat, None)
    right.s[-len(verts):] = svals
    # brass wraps along the limb
    for s in (0.16, 0.40, 0.66, 0.86):
        i = int(s * (NS - 1)); c = C[i]; t3 = Vector((T[i].x, T[i].y, 0))
        u3 = Vector((Nb[i].x, Nb[i].y, 0))
        k0 = len(right.v)
        lathe(right, [(-0.004, 0), (-0.004, 1.0), (0.004, 1.0), (0.004, 0)], (0, 0, 0), 'y', "Brass", 16)
        # reshape unit ring into a rounded band hugging the limb
        for j in range(k0, len(right.v)):
            p = right.v[j]; a = math.atan2(p.z, p.x); rr = math.hypot(p.x, p.z)
            u = (th(s) + 0.0014) * math.copysign(abs(math.cos(a)) ** 0.55, math.cos(a)) * rr
            v = (hh(s) + 0.0014) * math.copysign(abs(math.sin(a)) ** 0.75, math.sin(a)) * rr
            q = Vector((c.x, c.y, zc)) + u3 * u + t3 * p.y + Vector((0, 0, v))
            right.v[j] = q; right.s[j] = i
    # tip nock spool: groove centre at the runtime string endpoint (0.551, 0.80, 0.105)
    tip = C[-1]
    k0 = len(right.v)
    lathe(right, [(-0.016, 0), (-0.016, 0.0075), (-0.012, 0.0092), (-0.0055, 0.0092), (-0.0040, 0.0058), (0.0, 0.0050),
                  (0.0040, 0.0058), (0.0055, 0.0092), (0.012, 0.0092), (0.018, 0.0060), (0.022, 0)],
          (tip.x, tip.y, zc), 'z', "Brass", 24)
    for j in range(k0, len(right.v)): right.s[j] = NS - 1
    # tip finial: a small swept brass primary beyond the nock
    k0 = len(right.v)
    tube(right, catmull([(tip.x + 0.004, tip.y + 0.006, zc + 0.016), (tip.x + 0.02, tip.y + 0.03, zc + 0.022), (tip.x + 0.045, tip.y + 0.045, zc + 0.024)], 5),
         0.003, "Brass", 8, rfun=lambda t: 0.0034 * (1 - 0.8 * t))
    for j in range(k0, len(right.v)): right.s[j] = NS - 1
    # layered primaries hanging behind/below the limb (below the string plane)
    fdefs = [(0.30 + 0.062 * n, lerp(0.10, 0.16, math.sin(math.pi * min(1.0, n / 12.0)) ** 0.7) if n < 8 else lerp(0.16, 0.12, (n - 8) / 3.0),
              lerp(0.05, 1.12, n / 10.0)) for n in range(11)]
    enamel_faces = []
    for n_, (s, Lf, ang) in enumerate(fdefs):
        i = int(s * (NS - 1)); c = C[i]
        z0 = 0.0655 + 0.0024 * n_
        dirv = Vector((math.sin(ang), -math.cos(ang))).normalized()   # back, swinging outward
        U = Vector((dirv.x, dirv.y, 0)); V = Vector((-dirv.y, dirv.x, 0))
        root = Vector((c.x, c.y, 0)) + Vector((Nb[i].x, Nb[i].y, 0)) * 0.002
        w = 0.026 + 0.006 * s
        outline = [(-0.004, -w * 0.45), (Lf * 0.35, -w), (Lf * 0.80, -w * 0.85), (Lf, -w * 0.25), (Lf * 0.95, 0.0),
                   (Lf * 1.02, w * 0.2), (Lf * 0.86, w * 0.8), (Lf * 0.4, w * 0.95), (-0.004, w * 0.5)]
        k0 = len(right.v)
        face_start = len(right.f)
        prism(right, outline, root, U, V, (0, 0, 1), z0, z0 + 0.0022, "FeatherEnamel" if n_ % 2 == 0 else "Ivory", 0.0007, 1)
        if n_ % 2 == 0:
            enamel_faces.append((face_start, len(right.f), root.copy(), U.copy(), V.copy(), Lf, w, n_))
        tube(right, [root + U * 0.004 + Vector((0, 0, z0 + 0.0033)), root + U * (Lf * 0.88) + Vector((0, 0, z0 + 0.0033))],
             0.0015, "Brass" if n_ % 2 == 0 else "Horn", 6, rfun=lambda t: 0.0017 * (1 - 0.7 * t))
        # rivet post tying the feather up into the limb
        tube(right, [root + Vector((0, 0, z0)), root + Vector((0, 0, zc - hh(s) + 0.004))], 0.0028, "Brass", 8)
        for j in range(k0, len(right.v)): right.s[j] = i
    # mirror to left
    wings = MB(); wings.extend(right)
    left = MB()
    left.v = [Vector((-p.x, p.y, p.z)) for p in right.v]; left.s = list(right.s)
    left.f = [tuple(reversed(f)) for f in right.f]; left.m = list(right.m); left.flat = list(right.flat)
    wings.extend(left)
    nR = len(right.v)
    # displacement fields
    dD = []; dN = []
    for j, p in enumerate(wings.v):
        i = wings.s[j]; sx = 1 if j < nR else -1
        q = Vector((p.x * sx, p.y))
        o = q - C[i]; ph = phis[i]
        q2 = P[i] + Vector((o.x * math.cos(ph) - o.y * math.sin(ph), o.x * math.sin(ph) + o.y * math.cos(ph)))
        d = q2 - q
        dN.append(Vector((d.x * sx, 0, 0))); dD.append(Vector((0, d.y, 0)))
    ob = wings.to_object("Wings", (0, 0, 0))
    # Explicit local-space UVs make the source feather field run root-to-tip on
    # each authored feather. Mirrored wing geometry receives a mirrored sample.
    face_offset = len(right.f)
    for first, last, root, u_axis, v_axis, length, width, feather_index in enamel_faces:
        for side in (0, 1):
            for face_index in range(first + side * face_offset, last + side * face_offset):
                face = ob.data.polygons[face_index]
                for vertex_index, loop_index in zip(wings.f[face_index], face.loop_indices):
                    p = wings.v[vertex_index].copy()
                    if side: p.x = -p.x
                    along = max(0.0, min(1.0, (p - root).dot(u_axis) / length))
                    across = max(-1.0, min(1.0, (p - root).dot(v_axis) / width))
                    ob.data.uv_layers.active.data[loop_index].uv = (along, 0.34 + (feather_index % 5) * 0.085 + across * 0.085)
    ob.shape_key_add(name="Basis", from_mix=False)
    for nm, disp in (("Drawn", dD), ("Narrow", dN)):
        sk = ob.shape_key_add(name=nm, from_mix=False)
        for j, d in enumerate(disp):
            sk.data[j].co = ob.data.vertices[j].co + G2B(d)
        sk.slider_max = 1.0
    print("WINGS bend params", AB, "tip rest", tuple(C[-1]), "tip drawn", tuple(P[-1]), "limb length", L)
    return ob

# ---------------------------------------------------------------- moving parts
def build_moving():
    # ---- Bolt (local: nock at 0, tip at +0.526)
    b = MB()
    lathe(b, [(0.0045, 0), (0.0045, 0.0050), (0.0060, 0.0066), (0.0150, 0.0066), (0.0165, 0.0058), (0.0165, 0)], (0, 0, 0), 'y', "Brass", 16)
    lathe(b, [(0.0160, 0), (0.0160, 0.0060), (0.4420, 0.0060), (0.4420, 0)], (0, 0, 0), 'y', "Ivory", 14)
    lathe(b, [(0.132, 0), (0.132, 0.0064), (0.150, 0.0064), (0.150, 0)], (0, 0, 0), 'y', "Kingfisher", 14)
    lathe(b, [(0.156, 0), (0.156, 0.0064), (0.162, 0.0064), (0.162, 0)], (0, 0, 0), 'y', "Ember", 14)
    lathe(b, [(0.440, 0), (0.440, 0.0068), (0.446, 0.0078), (0.460, 0.0074), (0.464, 0.0060), (0.464, 0)], (0, 0, 0), 'y', "Brass", 16)
    lathe(b, [(0.462, 0), (0.462, 0.0060), (0.478, 0.0120), (0.494, 0.0098), (0.526, 0)], (0, 0, 0), 'y', "Steel", 4, flat=True, phase=math.pi / 4)
    for k, a in enumerate((math.pi / 2, math.pi / 6, 5 * math.pi / 6)):
        R = Vector((math.cos(a), 0, math.sin(a)))
        vane = [(0.030, 0.0), (0.034, 0.010), (0.060, 0.0135), (0.105, 0.0125), (0.122, 0.0060), (0.124, 0.0)]
        prism(b, [(y, 0.0055 + h) for y, h in vane], (0, 0, 0), (0, 1, 0), tuple(R), tuple(Vector((0, 1, 0)).cross(R)),
              -0.0006, 0.0006, "Kingfisher" if k == 0 else "Ember", 0.0003, 1)
    OBJ["Bolt"] = b.to_object("Bolt"); OBJ["Bolt"].location = G2B((0, DRAW_REAR, RAIL_Z))
    # re-centre: vertices were authored in local coords, so shift them by pivot

    # ---- Sled (local, pivot at (0, draw, 0))
    s = MB()
    for sx in (-1, 1):
        prism(s, [(-0.056, 0.141), (-0.046, 0.134), (0.008, 0.134), (0.013, 0.140), (0.013, 0.1655), (-0.0048, 0.1675),
                  (-0.0048, 0.1905), (-0.020, 0.1960), (-0.042, 0.1945), (-0.055, 0.183)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.0172, sx * 0.028, "Bronze", 0.0022, 2)
        lathe(s, [(0, 0), (0, 0.0042), (0.0015, 0.0038), (0.0024, 0)], (sx * 0.028, -0.030, 0.152), ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Brass", 10)
        rbox(s, (min(sx * 0.0078, sx * 0.0175), -0.050, 0.1355), (max(sx * 0.0078, sx * 0.0175), 0.012, 0.1500), "Bronze", 0.0008)
        # talon claws over the string
        prism(s, [(-0.030, 0.1756), (-0.0048, 0.1756), (-0.0048, 0.1845), (0.0035, 0.1845), (0.0065, 0.1880),
                  (0.0050, 0.1935), (-0.010, 0.1965), (-0.030, 0.1950)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.0086, sx * 0.0210, "Brass", 0.0012, 2)
    prism(s, [(-0.054, 0.1756), (-0.0048, 0.1756), (-0.0048, 0.1900), (-0.020, 0.1950), (-0.042, 0.1935), (-0.054, 0.184)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0175, 0.0175, "Brass", 0.002, 2)
    # crest on the carriage
    prism(s, [(-0.046, 0.189), (-0.012, 0.189), (-0.018, 0.200), (-0.034, 0.212), (-0.050, 0.216), (-0.044, 0.203)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0022, 0.0022, "Kingfisher", 0.0008, 1)
    # outrigger arm to the cable anchor at (0.14, 0, 0.137)
    arm = [(0.026, 0.001), (0.026, 0.022), (0.080, 0.020), (0.128, 0.016), (0.153, 0.012), (0.156, 0.004), (0.153, 0.0005), (0.080, 0.001)]
    prism(s, arm, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.126, 0.146, "Bronze", 0.002, 2)
    lathe(s, [(0.0, 0.0), (0.0, 0.0065), (-0.004, 0.0062), (-0.006, 0.0)], (CABLE_X, 0.0005, 0.137), 'y', "Brass", 16)
    # left balancing fin
    prism(s, [(-0.026, 0.001), (-0.026, 0.020), (-0.060, 0.016), (-0.082, 0.008), (-0.078, 0.001)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1),
          0.128, 0.142, "Bronze", 0.002, 2)
    OBJ["Sled"] = s.to_object("Sled", (0, 0, 0)); OBJ["Sled"].location = G2B((0, DRAW_REAR, 0))

    # ---- Pinion (local pivot at pinion centre)
    p = MB()
    phase_p = math.pi / 2 * 0  # tooth centred at +Y (psi=0) -> 'x' axis U=Y
    ol = involute_outline(10, 0.007, PIN_R, 0.0)
    annulus(p, ol, 0.0075, (0, 0, 0), 'x', -0.008 - 0.0, 0.008, "Brass", 0.0006)
    lathe(p, [(-0.145, 0), (-0.145, 0.0075), (0.0335, 0.0075), (0.0335, 0)], (0, 0, 0), 'x', "Steel", 16)
    lathe(p, [(-0.013, 0), (-0.013, 0.013), (-0.008, 0.015), (-0.008, 0)], (0, 0, 0), 'x', "Brass", 24)
    # female cone cup for the clutch (x 0.2255..0.238 abs)
    cx0 = 0.2255 - PINION_C.x
    lathe(p, [(cx0, 0.0074), (cx0, 0.0215), (cx0 + 0.0125, 0.0215), (cx0 + 0.0125, 0.0165), (cx0 + 0.0035, 0.0125), (cx0 + 0.0035, 0.0074)],
          (0, 0, 0), 'x', "Brass", 32, closed=True)
    OBJ["Pinion"] = p.to_object("Pinion"); OBJ["Pinion"].location = G2B(PINION_C)

    # ---- Reduction (20T), authored with a tooth at psi=pi (towards pinion); runtime adds pi/20
    r = MB()
    ol = involute_outline(20, 0.007, GEAR_R, math.pi)
    rx0 = 0.187 - GEAR_C.x
    annulus(r, ol, 0.052, (0, 0, 0), 'x', rx0, rx0 + 0.016, "Brass", 0.0006)
    annulus(r, [(TAU * k / 32, 0.021) for k in range(32)], 0.0082, (0, 0, 0), 'x', rx0 - 0.004, rx0 + 0.020, "Brass")
    for k in range(5):
        a = TAU * k / 5 + 0.2
        c_, s_ = math.cos(a), math.sin(a)
        spoke = [(0.018, -0.006), (0.036, -0.010), (0.054, -0.0075), (0.054, 0.0075), (0.036, 0.004), (0.018, 0.006)]
        prism(r, [(u * c_ - v * s_, u * s_ + v * c_) for u, v in spoke], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              rx0 + 0.003, rx0 + 0.013, "Brass", 0.0012, 1)
    OBJ["Reduction"] = r.to_object("Reduction"); OBJ["Reduction"].location = G2B(GEAR_C)

    # ---- Drum (cable barrel, helical wraps, crown ratchet for the latch)
    d = MB()
    lathe(d, [(0.112, 0), (0.112, 0.050), (0.1145, 0.0530), (0.117, 0.049), (0.1185, 0.0384), (0.1615, 0.0384),
              (0.163, 0.049), (0.1655, 0.053), (0.168, 0.050), (0.168, 0)], (0, 0, 0), 'x', "Heartwood", 48)
    lathe(d, [(0.075, 0), (0.075, 0.0075), (0.2235, 0.0075), (0.2235, 0)], (0, 0, 0), 'x', "Steel", 16)
    for xx in (0.1115, 0.1685):
        lathe(d, [(-0.0015, 0.0385), (-0.0015, 0.0545), (0.0015, 0.0545), (0.0015, 0.0385)], (xx, 0, 0), 'x', "Brass", 48, closed=True)
    helix = []
    turns = 3.4; x0h, x1h = 0.1285, 0.1515
    for k in range(int(turns * 36) + 1):
        t = k / 36.0; a = math.pi / 2 + TAU * t
        helix.append((lerp(x0h, x1h, t / turns), DRUM_RC * math.cos(a), DRUM_RC * math.sin(a)))
    tube(d, helix, CABLE_R, "Cord", 8)
    # crown ratchet teeth on the inboard face (x 0.106..0.112)
    for k in range(18):
        a0 = TAU * k / 18; a1 = a0 + TAU / 18 * 0.82
        verts = []
        for (a, dx) in ((a0, 0.0), (a1, 0.0055)):
            for rr in (0.030, 0.0475):
                verts.append((0.112 - dx, rr * math.cos(a), rr * math.sin(a)))
        verts += [(0.112, 0.030 * math.cos(a1), 0.030 * math.sin(a1)), (0.112, 0.0475 * math.cos(a1), 0.0475 * math.sin(a1))]
        faces = [(0, 1, 3, 2), (2, 3, 5, 4), (0, 2, 4), (1, 5, 3), (0, 4, 5, 1)]
        d.add_bm(bm_from(verts, faces), "Steel", None, True)
    OBJ["Drum"] = d.to_object("Drum", (GEAR_C.x, 0, 0)); OBJ["Drum"].location = G2B(GEAR_C)
    # drum geometry authored with x absolute and y,z relative -> shift x only

    # ---- Clutch (sliding cone collar; rotationally symmetric so it may stay still)
    c = MB()
    lathe(c, [(-0.013, 0.0077), (-0.013, 0.0112), (-0.0035, 0.0152), (-0.0035, 0.0205), (-0.002, 0.0215), (0.002, 0.0215),
              (0.0035, 0.0175), (0.0055, 0.0175), (0.007, 0.0215), (0.0095, 0.0215), (0.011, 0.020), (0.011, 0.0077)],
          (0, 0, 0), 'x', "Bronze", 40, closed=True)
    OBJ["Clutch"] = c.to_object("Clutch"); OBJ["Clutch"].location = G2B((CLUTCH_X, CRANK_C.y, CRANK_C.z))

    # ---- Crank (pivot at crank centre, knob counter-rotates)
    k = MB()
    lathe(k, [(-0.0405, 0), (-0.0405, 0.0055), (0.004, 0.0055), (0.004, 0)], (0, 0, 0), 'x', "Steel", 6, flat=True)
    lathe(k, [(0.003, 0), (0.003, 0.016), (0.006, 0.019), (0.020, 0.019), (0.023, 0.015), (0.027, 0.009), (0.029, 0)], (0, 0, 0), 'x', "Brass", 32)
    armo = [(-0.045, -0.013), (-0.030, -0.017), (0.000, -0.016), (0.060, -0.011), (0.120, -0.0085), (0.150, -0.0105),
            (0.163, 0.0), (0.150, 0.0105), (0.120, 0.0085), (0.060, 0.011), (0.000, 0.016), (-0.030, 0.017), (-0.045, 0.013), (-0.050, 0.0)]
    prism(k, armo, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0.008, 0.018, "Bronze", 0.0025, 2)
    lathe(k, [(0, 0), (0, 0.012), (0.004, 0.012), (0.004, 0)], (0.018, 0.150, 0), 'x', "Brass", 24)
    lathe(k, [(0, 0), (0, 0.009), (0.003, 0.009), (0.003, 0)], (0.018, -0.040, 0), 'x', "Brass", 20)
    OBJ["Crank"] = k.to_object("Crank"); OBJ["Crank"].location = G2B(CRANK_C)
    kn = MB()
    lathe(kn, [(0.0, 0), (0.0, 0.0045), (0.002, 0.0045), (0.002, 0)], (0, 0, 0), 'x', "Steel", 12)
    lathe(kn, [(0.002, 0), (0.002, 0.0115), (0.010, 0.0135), (0.035, 0.0158), (0.058, 0.0148), (0.070, 0.0128), (0.070, 0)],
          (0, 0, 0), 'x', "Heartwood", 28)
    lathe(kn, [(0.069, 0), (0.069, 0.0134), (0.076, 0.0140), (0.084, 0.0118), (0.089, 0.0070), (0.091, 0)], (0, 0, 0), 'x', "Brass", 28)
    # bird-head cap: little beak points forward and stays forward thanks to counter-rotation
    prism(kn, [(0.008, -0.004), (0.020, -0.0015), (0.026, -0.004), (0.016, 0.004), (0.006, 0.006)], (0.080, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
          -0.0028, 0.0028, "Ember", 0.0008, 1)
    for sz in (-1, 1):
        lathe(kn, [(0, 0), (0.0, 0.0022), (0.0015, 0)], (0.083, 0.004, sz * 0.0105), ((0, 0, sz), (1, 0, 0), (0, 1, 0)), "Crystal", 8, flat=True)
    OBJ["CrankKnob"] = kn.to_object("CrankKnob", (0, 0, 0))
    OBJ["CrankKnob"].parent = OBJ["Crank"]; OBJ["CrankKnob"].location = G2B(KNOB_OFS)

    # ---- Latch (ratchet pawl on a Y-axis pin)
    l = MB()
    pawl = [(-0.0075, -0.004), (-0.004, -0.0085), (0.004, -0.0085), (0.0085, -0.002), (0.020, 0.024), (0.0232, 0.039),
            (0.0265, 0.043), (0.0265, 0.050), (0.019, 0.053), (0.0135, 0.046), (0.006, 0.020), (-0.0075, 0.004)]
    prism(l, pawl, (0, 0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), -0.0058, 0.0058, "Brass", 0.0012, 2)
    lathe(l, [(0, 0), (0, 0.0055), (0.0025, 0.0050), (0.0035, 0)], (0, 0.0058, 0), 'y', "Steel", 12)
    OBJ["Latch"] = l.to_object("Latch", (0, 0, 0)); OBJ["Latch"].location = G2B(LATCH_PIVOT)

    # ---- Trigger (talon blade; finger pad at local (0,0.018,-0.046))
    t = MB()
    talon = [(-0.0070, 0.0040), (0.0045, 0.0068), (0.0120, -0.0080), (0.0170, -0.0260), (0.0200, -0.0440), (0.0190, -0.0560),
             (0.0120, -0.0660), (0.0040, -0.0660), (0.0085, -0.0560), (0.0105, -0.0440), (0.0080, -0.0280), (0.0010, -0.0140), (-0.0070, -0.0040)]
    prism(t, talon, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0042, 0.0042, "Brass", 0.0014, 2)
    lathe(t, [(-0.0045, 0), (-0.0045, 0.0052), (0.0045, 0.0052), (0.0045, 0)], (0, 0, 0), 'x', "Steel", 16)
    OBJ["Trigger"] = t.to_object("Trigger", (0, 0, 0)); OBJ["Trigger"].location = G2B(TRIGGER_PIVOT)

    # ---- OpticRear: brass eyepiece ring (aperture open for the eye / truesight dots)
    o = MB()
    lathe(o, [(-0.010, 0.0180), (-0.010, 0.0290), (-0.004, 0.0315), (0.004, 0.0315), (0.008, 0.028), (0.008, 0.0180), (0.0, 0.0165)],
          (0, 0, 0), 'y', "Brass", 40, closed=True)
    lathe(o, [(-0.0112, 0.0160), (-0.0112, 0.0182), (-0.0098, 0.0182), (-0.0098, 0.0160)], (0, 0, 0), 'y', "Crystal", 40, closed=True)
    OBJ["OpticRear"] = o.to_object("OpticRear", (0, 0, 0)); OBJ["OpticRear"].location = G2B(OPTIC_REAR)

    # ---- ReelSocketArt: crafted brass/teal docking collar on the reel spindle (runtime socket point)
    ra = MB()
    lathe(ra, [(0.0175, 0.0), (0.0175, 0.0165), (0.0135, 0.0205), (0.006, 0.0215), (0.004, 0.0185), (-0.004, 0.0185),
               (-0.006, 0.0215), (-0.0135, 0.0205), (-0.0175, 0.017), (-0.0175, 0.0)], (0, 0, 0), 'x', "Brass", 32)
    lathe(ra, [(0.0035, 0.0184), (0.0035, 0.0200), (-0.0035, 0.0200), (-0.0035, 0.0184)], (0, 0, 0), 'x', "Kingfisher", 32, closed=True)
    for k in range(4):   # bayonet key lugs = readable "dock here" surface
        a = TAU * k / 4 + math.pi / 4; d = Vector((0, math.cos(a), math.sin(a)))
        rbox_pts = [d * 0.0195 + Vector((x, 0, 0)) for x in (-0.017, -0.009)]
        tube(ra, rbox_pts, 0.0032, "Brass", 8)
    lathe(ra, [(-0.0175, 0.0), (-0.0175, 0.009), (-0.021, 0.0065), (-0.023, 0.0)], (0, 0, 0), 'x', "Crystal", 8, flat=True)
    OBJ["ReelSocketArt"] = ra.to_object("ReelSocketArt"); OBJ["ReelSocketArt"].location = G2B((-0.23, 0.53, 0.02))

    # ---- SelectorArt: feather-shaped brass flip tab with teal enamel, hinged on the body bracket
    sa = MB()
    tube(sa, [(0.0375, 0, 0), (0.010, 0, 0)], 0.0065, "Steel", 14)
    for xx in (0.033, 0.013):
        lathe(sa, [(-0.0025, 0), (-0.0025, 0.0085), (0.0025, 0.0085), (0.0025, 0)], (xx, 0, 0), 'x', "Brass", 16)
    paddle = [(0.030, -0.009), (0.000, -0.018), (-0.026, -0.016), (-0.037, -0.006), (-0.033, 0.0), (-0.037, 0.006),
              (-0.026, 0.016), (0.000, 0.018), (0.030, 0.009)]
    prism(sa, paddle, (0, 0, 0.004), (1, 0, 0), (0, 1, 0), (0, 0, 1), -0.004, 0.004, "Brass", 0.0015, 2)
    prism(sa, [(u * 0.8, v * 0.62) for u, v in paddle], (0, 0, 0.004), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.004, 0.0058, "Kingfisher", 0.0006, 1)
    tube(sa, [(0.022, 0, 0.0085), (-0.030, 0, 0.0085)], 0.0011, "Ivory", 6)
    for yy in (-0.008, 0.0, 0.008):
        tube(sa, [(-0.004, yy, 0.0085), (-0.020, yy * 1.6, 0.0085)], 0.0008, "Ivory", 5)
    OBJ["SelectorArt"] = sa.to_object("SelectorArt"); OBJ["SelectorArt"].location = G2B((-0.20, 0.42, 0.08))

    # ---- markers
    for nm, pos in (("BoltSeat", BOLT_SEAT), ("GripAnchor", GRIP_ANCHOR)):
        e = bpy.data.objects.new(nm, None); e.empty_display_size = 0.02; e.location = G2B(pos); ASSET.objects.link(e); OBJ[nm] = e

    # ---- LiveCord: 20 unit-Y cylinders (Blender Z)
    root = bpy.data.objects.new("LiveCord", None); root.empty_display_size = 0.01; ASSET.objects.link(root); OBJ["LiveCord"] = root
    OBJ["cords"] = []
    for i in range(20):
        rad = STRING_R if i < 2 else CABLE_R
        me = bpy.data.meshes.new("LiveCordMesh%02d" % i)
        segs = 10; vs = []; fs = []
        for zz in (-0.5, 0.5):
            for kk in range(segs):
                a = TAU * kk / segs; vs.append((rad * math.cos(a), rad * math.sin(a), zz))
        for kk in range(segs):
            k1 = (kk + 1) % segs; fs.append((kk, k1, segs + k1, segs + kk))
        fs.append(tuple(reversed(range(segs)))); fs.append(tuple(range(segs, 2 * segs)))
        me.from_pydata(vs, [], fs); me.materials.append(MATS["Cord"])
        for pl in me.polygons: pl.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(50))
        ob = bpy.data.objects.new("LiveCord_%02d" % i, me); ob.parent = root; ASSET.objects.link(ob)
        OBJ["cords"].append(ob)

def shift_local(ob, pivot):
    """Geometry was authored in local coordinates already; nothing to shift (kept for clarity)."""
    return ob

# ---------------------------------------------------------------- runtime replica
def cable_path(draw_y):
    r = 0.024; z = TRAVEL / TAU + 0.001 + r
    dy = draw_y - 0.455; dz = 0.137 - z
    d2 = dy * dy + dz * dz; h = math.sqrt(d2 - r * r)
    angle = math.atan2((r * dz + dy * h) / d2, (r * dy - dz * h) / d2) - TAU
    path = [Vector((0.14, 0.648, TRAVEL / TAU + 0.001))]
    for i in range(17):
        a = lerp(-math.pi / 2, angle, i / 16)
        path.append(Vector((0.14, 0.455 + r * math.cos(a), z + r * math.sin(a))))
    path.append(Vector((0.14, draw_y, 0.137)))
    return path

def set_segment(ob, a, b):
    a = Vector(a); b = Vector(b); d = b - a
    ob.location = G2B((a + b) * 0.5)
    q = Vector((0, 0, 1)).rotation_difference(G2B(d).normalized())
    ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = q
    ob.scale = (1, 1, max(1e-4, d.length))

def pose(draw=1.0, angle=0.0, release=False, trigger=0.0, zero_rot=False):
    draw_y = lerp(DRAW_FRONT, DRAW_REAR, draw)
    tip_y = 0.80 - 0.03 * draw
    tip_x = math.sqrt(0.551 ** 2 + 0.01 ** 2 - (tip_y - draw_y) ** 2)
    wk = OBJ["Wings"].data.shape_keys.key_blocks
    wk["Drawn"].value = draw; wk["Narrow"].value = (0.551 - tip_x) / 0.053
    R = (lambda v: 0.0) if zero_rot else (lambda v: v)
    OBJ["Crank"].rotation_euler = (R(angle), 0, 0)
    OBJ["CrankKnob"].rotation_euler = (R(-angle), 0, 0)
    OBJ["Pinion"].rotation_euler = (R(draw * TAU * 2), 0, 0)
    OBJ["Reduction"].rotation_euler = (R(-draw * TAU + math.pi / 20), 0, 0)
    OBJ["Drum"].rotation_euler = (R(-draw * TAU), 0, 0)
    OBJ["Clutch"].location = G2B((CLUTCH_X + (0.027 if release else 0), CRANK_C.y, 0))
    OBJ["Latch"].rotation_euler = (0, 0, R(-0.8 if release else 0.0))
    OBJ["Trigger"].rotation_euler = (R(-0.32 if release else -0.26 * trigger), 0, 0)
    OBJ["Sled"].location = G2B((0, draw_y, 0))
    cords = OBJ["cords"]
    for i in range(2):
        set_segment(cords[i], ((-1 if i == 0 else 1) * tip_x, tip_y, 0.105), (0, draw_y, 0.179))
    path = cable_path(draw_y)
    for i in range(18): set_segment(cords[i + 2], path[i], path[i + 1])
    OBJ["Bolt"].hide_render = False
    bpy.context.view_layer.update()
    return dict(draw_y=draw_y, tip=(tip_x, tip_y))

# ---------------------------------------------------------------- clearance
def world_bvh(ob, dg):
    ev = ob.evaluated_get(dg); me = ev.to_mesh()
    mw = ob.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    cents = [[verts[i] for i in p] + [sum((verts[i] for i in p), Vector()) / len(p)] for p in polys]
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0), cents

def contact_zones(name, stt):
    """Godot-space spheres where a cord may legitimately touch `name` in this state."""
    draw_y = lerp(DRAW_FRONT, DRAW_REAR, stt["draw"]); tip_y = 0.80 - 0.03 * stt["draw"]
    tip_x = math.sqrt(0.551 ** 2 + 0.01 ** 2 - (tip_y - draw_y) ** 2)
    return {"Wings": [((tip_x, tip_y, 0.105), 0.03), ((-tip_x, tip_y, 0.105), 0.03)],
            "Sled": [((0, draw_y, 0.179), 0.035), ((CABLE_X, draw_y, 0.137), 0.02)],
            "Bolt": [((0, draw_y, 0.179), 0.03)],
            "Body": [((CABLE_X, GUIDE_C[0], GUIDE_C[1]), 0.04)],          # grooved guide sheave only
            "Drum": [((CABLE_X, GEAR_C.y - 0.008, DRUM_RC), 0.026)]}.get(name, [])

def clearance_sweep(samples=33):
    moving = ["Sled", "Crank", "CrankKnob", "Clutch", "Pinion", "Reduction", "Drum", "Latch", "Trigger", "Bolt"]
    statics = ["Body", "Wings", "OpticRear"]
    cords = [o.name for o in OBJ["cords"]]
    allowed = set()
    for c in cords[:2]:
        for o in ("Sled", "Wings", "Bolt"): allowed.add((c, o))
    for c in cords[2:]:
        for o in ("Drum", "Body", "Sled"): allowed.add((c, o))
    for i in range(len(cords) - 1): allowed.add((cords[i], cords[i + 1]))
    allowed.add((cords[0], cords[1]))
    statics += ["ReelSocketArt", "SelectorArt"]
    names = moving + statics + cords
    pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:]
             if not (a in statics and b in statics) and not (a in cords and b in cords and (a, b) in allowed and False)]
    report = {"unexpected": [], "allowed_contacts": 0, "states": 0}
    dg = bpy.context.evaluated_depsgraph_get()
    states = []
    for k in range(samples):
        dr = k / (samples - 1)
        states.append(dict(draw=dr, angle=dr * TAU * 2 + 0.37, release=False, trigger=0.0))
    for k in range(9):
        dr = 1 - k / 8
        states.append(dict(draw=dr, angle=0.37, release=True, trigger=0.0))
    states.append(dict(draw=1.0, angle=1.9, release=False, trigger=1.0))
    for stt in states:
        pose(**stt); dg = bpy.context.evaluated_depsgraph_get(); dg.update()
        loaded = stt["draw"] >= 0.999 and not stt["release"]
        data = {n: world_bvh(bpy.data.objects[n], dg) for n in names if n != "Bolt" or loaded}
        trees = {n: d[0] for n, d in data.items()}
        for a, b in pairs:
            if a not in trees or b not in trees: continue
            if a == "Crank" and b == "CrankKnob": continue
            hits = trees[a].overlap(trees[b])
            if hits:
                if (a, b) in allowed or (b, a) in allowed:
                    if a in cords and b in cords: report["allowed_contacts"] += 1; continue
                    other, oi = (b, 1) if a in cords else (a, 0)
                    zones = [(G2B(c), r) for c, r in contact_zones(other, stt)]
                    stray = [h for h in hits if not any(min((q - c).length for q in data[other][1][h[oi]]) < r for c, r in zones)]
                    if stray: report["unexpected"].append(dict(state=stt, a=a, b=b, n=len(stray), note="outside intended contact zone"))
                    else: report["allowed_contacts"] += 1
                else: report["unexpected"].append(dict(state=stt, a=a, b=b, n=len(hits)))
        report["states"] += 1
    return report

# ---------------------------------------------------------------- stats / export
def stats():
    tri = {}; total = 0; mats = set()
    for ob in ASSET.objects:
        if ob.type != 'MESH': continue
        me = ob.data; me.calc_loop_triangles(); n = len(me.loop_triangles)
        tri[ob.name] = n; total += n
        for m in me.materials: mats.add(m.name)
    return dict(triangles=total, per_object=tri, materials=sorted(mats), material_count=len(mats))

def export(path):
    pose(1.0, 0.0, False, 0.0, zero_rot=True)
    for ob in ASSET.objects:
        if ob.name in OBJ and ob.name not in ("cords",) and ob.name != "LiveCord" and not ob.name.startswith("LiveCord_"):
            assert tuple(ob.rotation_euler) == (0, 0, 0) and tuple(ob.scale) == (1, 1, 1), ob.name
    bpy.ops.object.select_all(action='DESELECT')
    for ob in ASSET.objects: ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=False, export_morph=True, export_morph_normal=True,
                              export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False, export_skins=False, export_materials='EXPORT',
                              export_image_format='JPEG', export_jpeg_quality=90)

def main():
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    setup_scene()
    body = build_body().to_object("Body", (0, 0, 0))
    OBJ["Body"] = body
    OBJ["Wings"] = build_wings()
    build_moving()
    t_build = time.time() - T0
    rep = {"build_seconds": round(t_build, 2)}
    if "--no-check" not in argv:
        t1 = time.time(); rep["clearance"] = clearance_sweep(); rep["clearance_seconds"] = round(time.time() - t1, 2)
        print("CLEARANCE unexpected=%d allowed=%d states=%d" % (len(rep["clearance"]["unexpected"]), rep["clearance"]["allowed_contacts"], rep["clearance"]["states"]))
        seen = set()
        for u in rep["clearance"]["unexpected"]:
            key = (u["a"], u["b"])
            if key in seen: continue
            seen.add(key); print("  HIT", u["a"], u["b"], "n=%d" % u["n"], "draw=%.3f rel=%s" % (u["state"]["draw"], u["state"]["release"]))
        if rep["clearance"]["unexpected"]:
            json.dump(rep, open(os.path.join(HERE, "logs", "build_report.json"), "w"), indent=1, default=str)
            print("EXPORT ABORTED: unexpected intersections; previous GLB kept"); sys.exit(4)
    rep["stats"] = stats()
    print("TRIANGLES", rep["stats"]["triangles"], "MATERIALS", rep["stats"]["material_count"])
    export(os.path.join(HERE, "siegebird-opus.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "Siegebird-Opus.blend"), compress=True)
    rep["total_seconds"] = round(time.time() - T0, 2)
    json.dump(rep, open(os.path.join(HERE, "logs", "build_report.json"), "w"), indent=1, default=str)
    print("DONE in %.1fs" % rep["total_seconds"])

if __name__ == "__main__":
    main()

