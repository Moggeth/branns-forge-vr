"""Siegebird IV - "War Songbird" redesign. Reproducible Blender (bpy 4.5) builder.

Run:  <python with bpy> build_siegebird_v4.py [--no-check] [--out path.glb]

Identity: a songbird armoured for a siege. Seen from the side the crossbow is a bird in level flight:
a carved walnut body with a deep keel chest, a fanned walnut tail that is the shoulder stock, a
helmeted head that holds the bolt in its beak, and swept wings whose primaries are layered,
iron-tipped feathers on a blued leaf spring. Forged iron bands, a riveted breastplate and an iron
windlass frame around the brass gear train make it a siege engine; blue resonance crystal (eyes,
pommel, bolt tips) is the magic.

Function is fixed by the shared contract (assets/siegebird-opus/contract/assembly.json and the
browser runtime): rail and bolt axis, sled travel, winch centres, limb tip path, string and cable
endpoints, BoltSeat and GripAnchor. Geometry helpers, the winch gear train, the pose replica, the
clearance sweep and the exporter come from the Opus builder (imported as B); everything you see
outside the gear train is authored here.

Frame: Godot/native item space (X right, Y forward, Z up), metres.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'assets', 'siegebird-opus'))
import build_siegebird_opus as B  # noqa: E402  (module code only loads the contract)
from build_siegebird_opus import MB, lathe, prism, rbox, tube, loft, catmull, resample, superellipse, lerp, smoothstep, TAU, G2B  # noqa

T0 = time.time()
DRAW_FRONT, DRAW_REAR, RAIL_Z = B.DRAW_FRONT, B.DRAW_REAR, B.RAIL_Z
GEAR_C, PINION_C, CRANK_C = B.GEAR_C, B.PINION_C, B.CRANK_C
CABLE_X, GUIDE_C, LATCH_PIVOT, TRIGGER_PIVOT = B.CABLE_X, B.GUIDE_C, B.LATCH_PIVOT, B.TRIGGER_PIVOT
# Sight (client/siegebird-sight.js): rear peep ring centre and front moon hood centre, native.
SIGHT_REAR = Vector((0.0, 0.425, 0.2524)); SIGHT_FRONT = Vector((0.0, 0.900, 0.239)); HOOD_R = 0.038

# ---------------------------------------------------------------- materials
MAT_DEF = {
    "Walnut":    dict(c="4a2a18", m=0.0, r=0.45),
    "Heartwood": dict(c="6a3419", m=0.0, r=0.40),
    "Iron":      dict(c="2a2b2e", m=1.0, r=0.55),
    "Brass":     dict(c="c9963f", m=1.0, r=0.30),
    "Bronze":    dict(c="7a4a2a", m=1.0, r=0.42),
    "Steel":     dict(c="1d2838", m=1.0, r=0.36),
    "Leather":   dict(c="3a1712", m=0.0, r=0.55),
    "Horn":      dict(c="241913", m=0.0, r=0.32),
    "Ivory":     dict(c="e8dcc0", m=0.0, r=0.38),
    "Kingfisher":dict(c="0b6377", m=0.0, r=0.24),
    "Ember":     dict(c="c9542a", m=0.0, r=0.32),
    "Crystal":   dict(c="7cc4ff", m=0.0, r=0.05, e="2f8fff", es=1.3),
    "Cord":      dict(c="d8c49a", m=0.0, r=0.70),
    "Feather":   dict(c="ffffff", m=0.0, r=0.48),
    "Ash":       dict(c="c9a477", m=0.0, r=0.50),
}

def feather_image(size=512):
    """Feather atlas, five rows of songbird primaries. U runs root -> tip, V across the vane (row band,
    -1 trailing edge .. +1 leading edge). Blue-jay colouring: slate root, cobalt-teal vane with fine dark
    barring, a white tip spot on alternate rows, a dusk tip; slanted barbs; ivory rachis with a faint
    resonance-blue vein beside it."""
    import numpy as np
    u = np.linspace(0, 1, size)[None, :]; v = np.linspace(0, 1, size)[:, None]
    rows = 5; band = (v * rows) % 1.0; row = np.floor(v * rows)
    across = band * 2 - 1; a = np.abs(across)
    C = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    slate, cobalt, teal, deep, ivory, dusk = C("5d6a78"), C("1f5fa8"), C("1f8fa0"), C("16336b"), C("efe6d2"), C("141a26")
    t = np.clip((u - 0.10) / 0.22, 0, 1)[..., None]
    hue = ((row * 0.37) % 1.0)[..., None]
    vane = teal * (1 - hue) + cobalt * hue
    vane = vane * (1 - 0.45 * np.clip((u - 0.55) / 0.4, 0, 1)[..., None]) + deep * 0.45 * np.clip((u - 0.55) / 0.4, 0, 1)[..., None]
    col = slate * (1 - t) + vane * t
    bars = (0.5 + 0.5 * np.cos(TAU * (u * 9.0 + 0.10 * a))) ** 18 * (u > 0.30) * (u < 0.86)          # blue-jay barring
    col *= (1 - 0.55 * bars[..., None])
    spot = (row % 2 == 0) * np.exp(-(((u - 0.80) / 0.05) ** 2 + ((across + 0.35) / 0.35) ** 2))     # white spot on the trailing vane
    col = col * (1 - spot[..., None]) + ivory * spot[..., None]
    tipk = np.clip((u - 0.90) / 0.08, 0, 1)[..., None]; col = col * (1 - tipk) + dusk * tipk
    barb = (0.5 + 0.5 * np.sin(TAU * (u * 46 - a * 15))) ** 3                                         # barbs slant out toward the tip
    col *= (1 - 0.16 * barb[..., None])
    col *= (1 - 0.30 * np.clip((a - 0.85) / 0.15, 0, 1))[..., None]                                   # soft vane edge
    rach = np.exp(-(across / 0.045) ** 2)[..., None]
    vein = (np.exp(-((a - 0.10) / 0.025) ** 2) * np.clip((u - 0.3) / 0.2, 0, 1) * (1 - tipk[..., 0]))[..., None]
    col = col * (1 - rach) + ivory * rach
    col = col * (1 - 0.55 * vein) + np.array([0.45, 0.85, 1.0]) * 0.55 * vein
    img = bpy.data.images.new("SB_FeatherAtlas", size, size, alpha=False)
    px = np.ones((size, size, 4), dtype=np.float32); px[..., :3] = np.clip(col, 0, 1)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = 'sRGB'
    return img

def wood_image(name, size, light, dark, rings, seed):
    """The Opus grain field, stored correctly: the image is sRGB, so the colours stay sRGB (the Opus builder
    linearised them first, which darkened the wood twice)."""
    img = B.wood_image(name, size, light, dark, rings, seed)
    import numpy as np
    px = np.empty(size * size * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
    px[:, :3] = np.clip(px[:, :3], 0, 1) ** (1 / 2.4) * 1.055 - 0.055
    img.pixels.foreach_set(px.ravel()); img.pack()
    return img

def make_materials():
    for name, d in MAT_DEF.items():
        m = bpy.data.materials.new("SB_" + name); m.use_nodes = True
        p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = B.srgb(d["c"])
        p.inputs["Metallic"].default_value = d["m"]; p.inputs["Roughness"].default_value = d["r"]
        if "e" in d:
            p.inputs["Emission Color"].default_value = B.srgb(d["e"]); p.inputs["Emission Strength"].default_value = d["es"]
        if name in ("Kingfisher", "Ember", "Horn"):
            p.inputs["Coat Weight"].default_value = 0.6; p.inputs["Coat Roughness"].default_value = 0.08
        B.MATS[name] = m
    B.textured(B.MATS["Walnut"], wood_image("SB_WalnutGrain", 1024, "5e3a23", "462919", 70, 7))
    B.textured(B.MATS["Heartwood"], wood_image("SB_HeartwoodGrain", 512, "9a5630", "52260f", 40, 11))
    B.textured(B.MATS["Ash"], wood_image("SB_AshGrain", 256, "dcc196", "a07c50", 30, 5))
    B.textured(B.MATS["Feather"], feather_image())
B.make_materials = make_materials

# ---------------------------------------------------------------- shape helpers
def ring(n, w, top, bot, et=2.4, eb=2.4, x0=0.0):
    """Closed section in (x, z): half-width w, top/bottom heights, separate superellipse exponents."""
    mid = (top + bot) / 2; h = (top - bot) / 2; out = []
    for k in range(n):
        t = -math.pi / 2 + TAU * k / n; c, s = math.cos(t), math.sin(t)
        e = et if s >= 0 else eb
        out.append((x0 + w * math.copysign(abs(c) ** (2 / e), c), mid + h * math.copysign(abs(s) ** (2 / e), s)))
    return out

def section_loft(mb, secs, mat, n=36, dense=6, cap=True, flat=False):
    """secs: (y, w, top, bot, et, eb) keys, Catmull-Rom interpolated -> lofted rings."""
    keys = [Vector(s) for s in secs]
    # mathutils Vector supports arbitrary length; catmull works component-wise
    rings_ = []
    for q in catmull(keys, dense):
        y, w, t, b, et, eb = q
        rings_.append([(x, y, z) for x, z in ring(n, w, t, b, max(1.2, et), max(1.2, eb))])
    return loft(mb, rings_, mat, cap=cap, flat=flat), rings_

def band(mb, ring_pts, y, mat, grow=0.0035, width=0.010, n=None):
    """A strap hugging a body ring at station y: outer surface offset by grow, width along Y."""
    pts = [Vector((x, y, z)) for x, y_, z in ring_pts]
    c = sum(pts, Vector()) / len(pts)
    rings_ = []
    for dy, g in ((-width / 2, grow * 0.55), (-width / 2 + 0.0015, grow), (width / 2 - 0.0015, grow), (width / 2, grow * 0.55)):
        r = []
        for p in pts:
            d = Vector((p.x - c.x, 0, p.z - c.z)); L = d.length or 1
            q = p + d / L * g; r.append((q.x, y + dy, q.z))
        rings_.append(r)
    return loft(mb, rings_, mat, cap=False)

def rivet(mb, at, normal, r=0.0026, mat="Brass", segs=6):
    n = Vector(normal).normalized()
    U = n.orthogonal().normalized(); V = n.cross(U)
    return lathe(mb, [(0, r), (r * 0.55, r * 0.8), (r, 0)], tuple(at), (tuple(n), tuple(U), tuple(V)), mat, segs, flat=False)

def feather_outline(L, w, notch=0.12):
    """Songbird primary in (along, across): narrow leading vane (+), broad trailing vane (-), a rounded
    tip with an emarginated (notched) step on the leading edge."""
    pts = []
    for k in range(8):               # trailing edge, root -> tip
        t = k / 7
        width = w * (0.45 + 0.55 * math.sin(math.pi / 2 * min(1, t / 0.30))) * (1 - 0.92 * smoothstep(0.80, 1.0, t) ** 1.4)
        pts.append((L * t, -width))
    for k in range(4):               # rounded tip
        a = math.pi * (k + 1) / 5; pts.append((L * (1.0 - 0.012 * (1 - math.sin(a))), -w * 0.08 * math.cos(a)))
    for k in range(7, -1, -1):       # leading edge, tip -> root, with the notch at 70%
        t = k / 7
        width = w * 0.40 * (0.55 + 0.45 * math.sin(math.pi / 2 * min(1, t / 0.30))) * (1 - 0.9 * smoothstep(0.84, 1.0, t))
        if t > 0.7: width *= (1 - notch)
        pts.append((L * t, width))
    return pts

FEATHER_UV = []   # (object name, face range, root, U, V, length, width, row)

def feather(mb, root, U, V, N, L, w, z0, thick, row, mat="Feather", s=None, edge="Iron", camber=0.006, droop=0.010):
    """Feather blade with UV record, cambered across and drooping toward the tip, an ivory quill and an
    optional forged-iron tip cap (siege-hardened)."""
    root = Vector(root); U = Vector(U).normalized(); V = Vector(V).normalized(); N = Vector(N).normalized()
    f0 = len(mb.f); v0 = len(mb.v)
    prism(mb, feather_outline(L, w), root, U, V, N, z0, z0 + thick, mat, 0.0, 1, s=s)
    def bend(p):
        q = p - root; al = q.dot(U) / L; ac = q.dot(V) / w
        return p - N * (camber * ac * ac + droop * al * al)
    for j in range(v0, len(mb.v)): mb.v[j] = bend(mb.v[j])
    FEATHER_UV.append((mb, f0, len(mb.f), root.copy(), U.copy(), V.copy(), L, w, row, N.copy(), z0))
    v1 = len(mb.v)
    tube(mb, [root + N * (z0 + thick + 0.0004) - U * 0.004 + U * (L * f) for f in (0.0, 0.3, 0.6, 0.9)], 0.0016, "Ivory", 6,
         s=s, rfun=lambda t: 0.0019 * (1 - 0.75 * t))
    for j in range(v1, len(mb.v)): mb.v[j] = bend(mb.v[j])
    if edge:
        v2 = len(mb.v)
        cap = [(L * 0.885, -w * 0.30), (L * 0.95, -w * 0.20), (L * 0.995, -w * 0.06), (L * 1.002, 0.0), (L * 0.995, w * 0.03), (L * 0.95, w * 0.035), (L * 0.90, 0.0)]
        prism(mb, cap, root, U, V, N, z0 - 0.0005, z0 + thick + 0.0005, edge, 0.0004, 1, s=s)
        for j in range(v2, len(mb.v)): mb.v[j] = bend(mb.v[j])
    return mb

def assign_feather_uvs(ob, mb_ref, offset_faces=0, mirror=False):
    uv = ob.data.uv_layers.active.data
    for mb, f0, f1, root, U, V, L, w, row, N, z0 in FEATHER_UV:
        if mb is not mb_ref: continue
        for fi in range(f0, f1):
            face = ob.data.polygons[fi + offset_faces]
            for vi, li in zip(mb.f[fi], face.loop_indices):
                p = mb.v[vi].copy()
                along = max(0.0, min(1.0, (p - root).dot(U) / L)); across = max(-1.0, min(1.0, (p - root).dot(V) / w))
                uv[li].uv = (along, (row % 5 + 0.5 + 0.5 * across * 0.96) / 5.0)

def shell(mb, rings_, a0, a1, grow, thick, mat, i0=0, i1=None, bev=0.0):
    """Armour plate: the part of lofted rings between ring-angle fractions a0..a1 (0 = bottom centre,
    counter-clockwise seen from the front), pushed out by grow and given thickness."""
    i1 = len(rings_) if i1 is None else i1
    outer = []; inner = []
    for r in rings_[i0:i1]:
        pts = [Vector(p) for p in r]; n = len(pts); c = sum(pts, Vector()) / n
        k0 = int(round(a0 * n)); k1 = int(round(a1 * n))
        sel = [pts[k % n] for k in range(k0, k1 + 1)]
        o = []; ii = []
        for p in sel:
            d = Vector((p.x - c.x, 0, p.z - c.z)).normalized()
            o.append(p + d * (grow + thick)); ii.append(p + d * grow)
        outer.append(o); inner.append(ii)
    m = len(outer[0]); verts = []; faces = []
    for r in outer: verts += r
    base = len(verts)
    for r in inner: verts += r
    R = len(outer)
    for i in range(R - 1):
        for k in range(m - 1):
            faces.append((i * m + k, i * m + k + 1, (i + 1) * m + k + 1, (i + 1) * m + k))
            faces.append((base + (i + 1) * m + k, base + (i + 1) * m + k + 1, base + i * m + k + 1, base + i * m + k))
    for i in range(R - 1):   # side edges
        for k in (0, m - 1):
            a, b = i * m + k, (i + 1) * m + k
            faces.append((a, b, base + b, base + a) if k == 0 else (b, a, base + a, base + b))
    for i in (0, R - 1):     # front/back edges
        for k in range(m - 1):
            a, b = i * m + k, i * m + k + 1
            faces.append((b, a, base + a, base + b) if i == 0 else (a, b, base + b, base + a))
    bm = B.bm_from(verts, faces)
    if bev: B.bevel_sharp(bm, bev, 1, 0.7)
    return mb.add_bm(bm, mat)

def head_ring(n, w, top, bot, ch=0.0098, floor=0.1665, et=2.2, eb=2.0):
    """Head section with an open bolt groove on top: half-outline from the chin round the cheek to the
    groove lip, down into the groove, mirrored."""
    half = []; m = n // 2 - 3
    mid = (top + bot) / 2; h = (top - bot) / 2
    for k in range(m + 1):
        t = -math.pi / 2 + math.pi * k / m * 0.94
        c, s = math.cos(t), math.sin(t); e = et if s >= 0 else eb
        x = max(ch + 0.0015, w * math.copysign(abs(c) ** (2 / e), c)) if s > 0.6 else w * math.copysign(abs(c) ** (2 / e), c)
        half.append((x, mid + h * math.copysign(abs(s) ** (2 / e), s)))
    lip = half[-1]
    half += [(ch + 0.0006, lip[1] - 0.002), (ch, floor + 0.004), (ch * 0.55, floor)]
    right = half
    left = [(-x, z) for x, z in reversed(right[1:])]
    pts = right + [(0.0, floor - 0.0006)] + left
    return pts

def head_loft(mb, secs, mat, n=32, dense=4):
    keys = [Vector(s) for s in secs]; rings_ = []
    for q in catmull(keys, dense):
        y, w, t, b = q
        pts = head_ring(n, w, t, b)
        rings_.append([(x, y, z) for x, z in pts])
    L = len(rings_[0]); assert all(len(r) == L for r in rings_)
    return loft(mb, rings_, mat), rings_

def ring_curve(rings_, frac, grow, i0=0, i1=None):
    """Points following one ring-angle fraction across lofted rings, pushed out by grow (for rims/edges)."""
    out = []
    for r in rings_[i0:i1]:
        pts = [Vector(p) for p in r]; n = len(pts); c = sum(pts, Vector()) / n
        p = pts[int(round(frac * n)) % n]; d = Vector((p.x - c.x, 0, p.z - c.z)).normalized(); out.append(p + d * grow)
    return out

# ---------------------------------------------------------------- body: faceted raptor hull
# Key sections (y, wt, top, ws, zs, wl, zl, wk, bot): flat top half-width/height, shoulder edge, belly edge,
# keel. Eight hard-edged facets (keel, bellies, flanks, blued-steel shoulder strakes, top) lofted from the
# butt to the shoulders; the smoothing angle keeps every facet edge crisp.
HULL = [
    (0.052, 0.011, 0.101, 0.019, 0.088, 0.019, 0.058, 0.007, 0.044),
    (0.120, 0.012, 0.104, 0.021, 0.090, 0.021, 0.056, 0.008, 0.040),
    (0.200, 0.013, 0.107, 0.023, 0.092, 0.023, 0.050, 0.008, 0.030),
    (0.255, 0.014, 0.109, 0.025, 0.092, 0.024, 0.030, 0.009, -0.004),
    (0.300, 0.015, 0.110, 0.026, 0.092, 0.024, 0.008, 0.009, -0.034),
    (0.370, 0.016, 0.112, 0.025, 0.094, 0.023, 0.012, 0.009, -0.030),
    (0.450, 0.018, 0.114, 0.030, 0.094, 0.028, -0.008, 0.010, -0.060),
    (0.580, 0.020, 0.116, 0.036, 0.094, 0.034, -0.020, 0.011, -0.064),
    (0.700, 0.022, 0.116, 0.042, 0.094, 0.040, -0.026, 0.012, -0.066),
    (0.800, 0.024, 0.117, 0.050, 0.095, 0.048, -0.030, 0.012, -0.068),
    (0.860, 0.030, 0.136, 0.084, 0.100, 0.080, -0.020, 0.014, -0.064),
    (0.900, 0.032, 0.144, 0.096, 0.104, 0.090, -0.004, 0.014, -0.054),
    (0.940, 0.030, 0.148, 0.082, 0.110, 0.074, 0.022, 0.012, -0.030),
    (0.972, 0.026, 0.150, 0.056, 0.114, 0.050, 0.052, 0.010, 0.020),
]
HEAD_KEYS = [(0.950, 0.056, 0.180, 0.044), (0.974, 0.062, 0.197, 0.058), (0.998, 0.058, 0.2010, 0.080),
             (1.020, 0.044, 0.1990, 0.104), (1.034, 0.031, 0.1955, 0.120)]
BEAK_KEYS = [(1.028, 0.031, 0.1960, 0.121), (1.048, 0.021, 0.1930, 0.138), (1.068, 0.014, 0.1905, 0.150),
             (1.086, 0.0085, 0.1870, 0.157), (1.100, 0.0040, 0.1810, 0.160)]

def hull_ring(wt, top, ws, zs, wl, zl, wk, bot):
    """Keel, belly, lower and upper flank (a sculpted crease between them), shoulder strake, flat top."""
    zc = zl + (zs - zl) * 0.58; wc = max(wl, ws) + 0.0045
    half = [(wk, bot), (wl, zl), (wc, zc), (ws, zs), (wt, top)]
    return half + [(-x, z) for x, z in reversed(half)]

def loft_mat(mb, rings_, edge_mat, cap=None):
    """Loft with a material per ring edge (edge k runs from point k to k+1). edge_mat(k, y) -> name."""
    n = len(rings_[0]); verts = []; faces = []; mats = []
    for r in rings_: verts += [Vector(p) for p in r]
    for i in range(len(rings_) - 1):
        y = (rings_[i][0][1] + rings_[i + 1][0][1]) / 2
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k)); mats.append(edge_mat(k, y))
    if cap:
        faces.append(tuple(reversed(range(n)))); mats.append(cap)
        faces.append(tuple(range((len(rings_) - 1) * n, len(rings_) * n))); mats.append(cap)
    mb.add(verts, faces, mats)
    return rings_

def falcon_ring(w, top, bot, ch=0.0098, floor=0.1665, beak=False):
    """Hard-edged head section with the open bolt groove on top (chin, jaw, cheek, brow, lip, groove)."""
    h = top - bot
    right = [(0.0, bot), (w * 0.62, bot + h * 0.08), (w * 0.94, bot + h * 0.36), (w, bot + h * 0.62), (w * 0.80, bot + h * 0.88),
             (w * 0.42, top)]
    right = [(max(x, ch + 0.0035) if z > floor - 0.004 else x, z) for x, z in right]
    right += [(ch + 0.0006, top - 0.002), (ch, floor + 0.004), (ch * 0.55, floor)]
    left = [(-x, z) for x, z in reversed(right[1:])]
    return right + [(0.0, floor - 0.0006)] + left

def keyed_rings(keys, fn, dense):
    return [[(x, q[0], z) for x, z in fn(*q[1:])] for q in catmull([Vector(k) for k in keys], dense)]

def plate(mb, pts, normal, thick, mat, bev=0.0005):
    """Thin plate from a planar outline given in 3D, extruded along normal."""
    n = Vector(normal).normalized(); bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in pts]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for e in ext["geom"]:
        if isinstance(e, bmesh.types.BMVert): e.co += n * thick
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bev: B.bevel_sharp(bm, bev, 1)
    return mb.add_bm(bm, mat)

def build_body():
    st = MB()
    # --- hull: walnut flanks and belly, blued-steel shoulder strakes, iron keel
    def hull_mat(k, y):
        if k in (3, 5): return "Steel"
        if k == 9 or (k in (0, 8) and 0.42 < y < 0.84): return "Iron"
        return "Walnut"
    hull = loft_mat(st, keyed_rings(HULL, hull_ring, 4), hull_mat, cap="Walnut")
    ys = [r[0][1] for r in hull]
    def at(y):
        i = min(range(len(ys) - 1), key=lambda j: abs((ys[j] + ys[j + 1]) / 2 - y)); return hull[i]
    # speed lines: brass inlay along each shoulder edge, butt to shoulder; top edges behind the rail
    for idx in (3, 6):
        line = [Vector(r[idx]) + Vector((0.0006 * (1 if idx == 3 else -1), 0, 0.0004)) for r in hull[1:-6]]
        tube(st, line[::2], 0.0014, "Brass", 6)
    for idx in (4, 5):
        line = [Vector(r[idx]) + Vector((0, 0, 0.0005)) for r in hull[1:] if r[0][1] < 0.43]
        tube(st, line, 0.0012, "Brass", 6)
    for y in (0.16, 0.26, 0.50, 0.62, 0.74):                                 # rivets down the shoulder strakes
        r = at(y)
        for a, b in ((3, 4), (6, 5)):
            p = (Vector(r[a]) * 0.55 + Vector(r[b]) * 0.45); d = Vector((p.x, 0, 0.6 * abs(p.x))).normalized()
            rivet(st, p + d * 0.0006, d, 0.0021)
    # breast: overlapping steel lamellae over the keel and bellies, front rows on top (as feathers lie)
    for j, (y0, y1) in enumerate(((0.905, 0.950), (0.870, 0.915), (0.835, 0.880), (0.800, 0.845))):
        rows = [r for r in hull if y0 <= r[0][1] <= y1]
        if len(rows) < 2: continue
        shell(st, rows, 0.8, 1.1, 0.0040 - 0.0007 * j, 0.0022, "Steel", bev=0.0006)
    # stock: skeleton stock. The comb above, the tail-feather strut below from the butt toe to the grip,
    # open between them; an iron butt plate on a leather pad joins the two
    def sweep(path, sec, mat_fn, cap):
        pts = catmull([Vector(p) for p in path], 4); rings_ = []
        for i, p in enumerate(pts):
            T = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized(); X = Vector((1, 0, 0)); Nn = X.cross(T).normalized()
            rings_.append([tuple(p + X * u + Nn * v) for u, v in sec(i / (len(pts) - 1))])
        return loft_mat(st, rings_, mat_fn, cap=cap)
    def blade_sec(w, h): return [(w * 0.5, -h), (w, -h * 0.3), (w, h * 0.3), (w * 0.5, h), (-w * 0.5, h), (-w, h * 0.3), (-w, -h * 0.3), (-w * 0.5, -h)]
    strut = [(0, 0.050, -0.080), (0, 0.120, -0.104), (0, 0.200, -0.122), (0, 0.268, -0.132), (0, 0.290, -0.134)]
    sweep(strut, lambda t: blade_sec(lerp(0.0130, 0.0115, t), lerp(0.0150, 0.0105, t)),
          lambda k, y: "Steel" if k in (3, 7) else "Walnut", "Iron")
    for sx in (-1, 1):                                                       # brass rachis down each side of the tail feather
        tube(st, [Vector((sx * 0.0134, y, z + 0.0005)) for _, y, z in catmull([Vector(p) for p in strut[:-1]], 3)], 0.0012, "Brass", 6)
    prism(st, [(0.040, 0.106), (0.056, 0.106), (0.060, 0.050), (0.060, -0.040), (0.066, -0.090), (0.052, -0.096), (0.040, -0.090), (0.036, 0.000)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0225, 0.0225, "Iron", 0.0016, 2)
    prism(st, [(0.030, 0.100), (0.041, 0.104), (0.037, 0.000), (0.041, -0.088), (0.030, -0.084), (0.027, 0.000)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0200, 0.0200, "Leather", 0.0030, 2)
    for z in (0.080, -0.060):
        for sx in (-1, 1): rivet(st, (sx * 0.0225, 0.050, z), (sx, 0, 0), 0.0024)
    # --- head: faceted falcon skull with the bolt groove, steel brow ridges, a hooked brass beak
    loft_mat(st, keyed_rings(HEAD_KEYS, falcon_ring, 4), lambda k, y: "Walnut", cap=None)
    beak = keyed_rings(BEAK_KEYS, falcon_ring, 3)
    loft_mat(st, beak, lambda k, y: "Brass", cap="Brass")
    # neck gorget: a steel collar where the head meets the shoulders
    gor = keyed_rings([(0.946, 0.060, 0.181, 0.040), (0.958, 0.062, 0.191, 0.048)], falcon_ring, 1)
    gor = [[(x * 1.06, y, z + 0.001) for x, y, z in r] for r in gor]
    loft_mat(st, gor, lambda k, y: "Steel", cap="Steel")
    # hooked tip of the upper mandible
    prism(st, [(1.094, 0.1895), (1.108, 0.1880), (1.117, 0.1800), (1.116, 0.1720), (1.110, 0.1760), (1.100, 0.1830)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0118, 0.0118, "Brass", 0.0008, 1)
    for sx in (-1, 1):
        # tomial edge: an iron line along the jaw
        jaw = [Vector((sx * (w * 0.97 if w * 0.97 > 0.011 else 0.0112), y, bot + (top - bot) * 0.40)) for y, w, top, bot in BEAK_KEYS[:-1]]
        tube(st, catmull(jaw, 3), 0.0010, "Iron", 5)
        # deep-set crystal eye under a blued-steel brow
        eye = Vector((sx * 0.0520, 0.990, 0.160)); n = Vector((sx * 0.92, 0.24, 0.20)).normalized()
        U = n.orthogonal().normalized(); V = n.cross(U); ax = (tuple(n), tuple(U), tuple(V))
        lathe(st, [(-0.003, 0.0), (-0.003, 0.0102), (0.0008, 0.0106), (0.0024, 0.0088), (0.0024, 0.0)], tuple(eye), ax, "Brass", 20)
        lathe(st, [(0.0, 0.0080), (0.0030, 0.0066), (0.0052, 0.0032), (0.0060, 0.0)], tuple(eye + n * 0.0012), ax, "Crystal", 16)
        lathe(st, [(0.0, 0.0034), (0.0010, 0.0028), (0.0015, 0.0)], tuple(eye + n * 0.0066), ax, "Horn", 10)
        prism(st, [(0.958, 0.1835), (0.998, 0.1840), (1.016, 0.1765), (1.002, 0.1790), (0.962, 0.1900)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.040, sx * 0.0585, "Steel", 0.0008, 1)
        # swept steel crest blades, kept under the moon hood's view
        for k, (dz, L) in enumerate(((0.0, 0.056), (-0.007, 0.046))):
            Uc = Vector((sx * 0.30, -0.95, 0.02)).normalized(); Nc = Vector((sx * 0.45, 0.0, 1.0)).normalized(); Vc = Nc.cross(Uc).normalized()
            root = Vector((sx * (0.022 + 0.010 * k), 0.992, 0.1975 + dz))
            prism(st, [(0.0, -0.0042), (L * 0.6, -0.0034), (L, 0.0), (L * 0.6, 0.0030), (0.0, 0.0042)], tuple(root), tuple(Uc), tuple(Vc), tuple(Nc),
                  -0.0011, 0.0011, "Steel", 0.0005, 1)
    # --- rail: blued steel T-rail on a heartwood spine, iron end cap
    groove = [(-0.0058, 0.1736), (-0.0042, 0.1726), (-0.0022, 0.1720), (0.0, 0.1718), (0.0022, 0.1720), (0.0042, 0.1726), (0.0058, 0.1736)]
    prof = [(-0.0065, 0.100), (0.0065, 0.100), (0.0065, 0.1515), (0.0155, 0.1515), (0.0155, 0.1700), (0.0142, 0.1716), (0.0100, 0.1730)] + \
           list(reversed(groove)) + [(-0.0100, 0.1730), (-0.0142, 0.1716), (-0.0155, 0.1700), (-0.0155, 0.1515), (-0.0065, 0.1515)]
    prism(st, prof, (0, 0.43, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.535, "Steel", bev=0.0006, segs=1)
    prism(st, superellipse(20, 0.0158, 0.016, 3.0, 0, 0.112), (0, 0.44, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.40, "Heartwood", 0.0, 1)
    rbox(st, (-0.021, 0.414, 0.098), (0.021, 0.432, 0.168), "Iron", 0.003)
    for sx in (-1, 1):
        rivet(st, (sx * 0.021, 0.423, 0.150), (sx, 0, 0), 0.0024)
    # --- grips: faceted, leather-sided with iron front and back straps
    def grip_ring(w, d):
        return [(w * 0.45, -d), (w, -d * 0.45), (w, d * 0.35), (w * 0.5, d), (-w * 0.5, d), (-w, d * 0.35), (-w, -d * 0.45), (-w * 0.45, -d)]
    def grip_mat(k, y): return "Leather" if k in (1, 5) else ("Iron" if k in (3, 7) else "Walnut")
    def grip(axis, ws, ds):
        rings_ = []
        for q in catmull([Vector((a.x, a.y, w_, d_)) for a, w_, d_ in zip(axis, ws, ds)], 3):
            y, z, w_, d_ = q
            rings_.append([(x, y + dy, z) for x, dy in grip_ring(w_, d_)])
        return loft_mat(st, rings_, grip_mat, cap="Iron")
    axis = [Vector((0.318, -0.026)), Vector((0.306, -0.10)), Vector((0.296, -0.155)), Vector((0.285, -0.205)), Vector((0.277, -0.236))]
    grip(axis, (0.0150, 0.0160, 0.0168, 0.0160, 0.0146), (0.0230, 0.0235, 0.0245, 0.0232, 0.0205))
    ferrule = [[(x * 1.10, 0.315 + dy * 1.08, z) for x, dy in grip_ring(0.0152, 0.0232)] for z in (-0.036, -0.046)]
    loft_mat(st, ferrule, lambda k, y: "Brass", cap="Brass")
    fore = [Vector((0.705, -0.070)), Vector((0.712, -0.115)), Vector((0.722, -0.160)), Vector((0.726, -0.176))]
    grip(fore, (0.0125, 0.0135, 0.0130, 0.0118), (0.0190, 0.0200, 0.0195, 0.0170))
    spur = [[(x * s_, 0.726 + dy * s_, z) for x, dy in grip_ring(0.0118, 0.0170)] for s_, z in ((1.08, -0.172), (1.10, -0.182), (0.5, -0.192))]
    loft_mat(st, spur, lambda k, y: "Iron", cap="Iron")
    # talon pommel: iron claws round a resonance crystal
    orb = Vector((0.0, 0.282, -0.262))
    lathe(st, [(0.0, 0.0), (0.0, 0.020), (0.008, 0.024), (0.016, 0.018), (0.018, 0.0)], (0, 0.277, -0.244), ((0, 0.18, -1), (1, 0, 0), (0, 1, 0.18)), "Iron", 16)
    lathe(st, [(-0.0175, 0.0), (-0.012, 0.0125), (0.0, 0.0175), (0.012, 0.0125), (0.0175, 0.0)], tuple(orb), 'z', "Crystal", 16, flat=True)
    for k, a in enumerate((-0.75, 0.0, 0.75, math.pi)):
        d = Vector((math.sin(a), math.cos(a), 0))
        toe = catmull([orb + Vector((0, 0, 0.022)) + d * 0.004, orb + d * 0.019 + Vector((0, 0, 0.011)), orb + d * 0.022 + Vector((0, 0, -0.006)), orb + d * 0.013 + Vector((0, 0, -0.019))], 3)
        tube(st, toe, 0.0045, "Iron", 6, rfun=lambda t: 0.0050 - 0.0035 * t)
    # --- trigger housing + talon guard
    for sx in (-1, 1):
        prism(st, [(0.326, -0.058), (0.366, -0.058), (0.364, -0.080), (0.352, -0.094), (0.334, -0.092), (0.326, -0.080)],
              (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), sx * 0.0056, sx * 0.0108, "Iron", 0.0012, 2)
        lathe(st, [(0, 0), (0, 0.0035), (0.002, 0.003), (0.003, 0)], (sx * 0.0108, TRIGGER_PIVOT.y, TRIGGER_PIVOT.z), ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Brass", 10)
    guard = catmull([(0, 0.366, -0.066), (0, 0.394, -0.098), (0, 0.396, -0.140), (0, 0.374, -0.170), (0, 0.338, -0.178), (0, 0.318, -0.168)], 6)
    tube(st, guard, 0.0055, "Brass", 12, rfun=lambda t: 0.0045 + 0.003 * math.sin(math.pi * t))
    tube(st, catmull([(0, 0.394, -0.120), (0, 0.410, -0.124), (0, 0.418, -0.136)], 4), 0.003, "Iron", 8, rfun=lambda t: 0.003 * (1 - 0.8 * t))
    build_winch_frame(st)
    return st

def build_winch_frame(st):
    """Static winch: forged iron cheek ring with spokes and brass bosses, iron frame bars, bearing
    bosses, the grooved cable guide and the pawl bracket (positions from the shared contract)."""
    gy, gz = GEAR_C.y, 0.0
    B.annulus(st, [(TAU * k / 64, 0.094) for k in range(64)], 0.085, (0.211, gy, gz), 'x', 0.0, 0.008, "Iron")
    for k in range(6):
        a = TAU * k / 6 + 0.3; d = Vector((0, math.cos(a), math.sin(a)))
        tube(st, [Vector((0.215, gy, gz)) + d * 0.016, Vector((0.215, gy, gz)) + d * 0.086], 0.0034, "Iron", 8)
        rivet(st, Vector((0.219, gy, gz)) + d * 0.0895, (1, 0, 0), 0.0022)
    B.annulus(st, [(TAU * k / 32, 0.017) for k in range(32)], 0.0085, (0.211, gy, gz), 'x', 0.0, 0.0135, "Brass")
    B.annulus(st, [(TAU * k / 32, 0.018) for k in range(32)], 0.0085, (0.211, PINION_C.y, 0), 'x', 0.0, 0.0135, "Brass")
    rbox(st, (0.211, PINION_C.y + 0.012, -0.007), (0.219, gy - 0.088, 0.007), "Iron", 0.0015)
    for (py, pz) in [(0.585, -0.085), (0.745, -0.045), (0.492, -0.062)]:
        rbox(st, (0.004, py - 0.005, pz - 0.005), (0.214, py + 0.005, pz + 0.005), "Iron", 0.0016)
        lathe(st, [(0, 0), (0, 0.009), (0.004, 0.0085), (0.006, 0)], (0.219, py, pz), 'x', "Brass", 6, flat=True)
    tube(st, [(0.215, 0.585, -0.085), (0.215, 0.600, -0.075)], 0.006, "Iron", 10)
    tube(st, [(0.215, 0.745, -0.045), (0.215, 0.735, -0.045)], 0.006, "Iron", 10)
    tube(st, [(0.215, 0.492, -0.062), (0.215, 0.525, -0.018)], 0.005, "Iron", 10)
    for (y, z, x1) in [(PINION_C.y, 0.0, 0.070), (gy, 0.0, 0.080)]:
        lathe(st, [(0.030, 0.0086), (0.030, 0.015), (x1 - 0.004, 0.015), (x1, 0.012), (x1, 0.0086)], (0, y, z), 'x', "Brass", 24, closed=True)
    gyc, gzc = GUIDE_C
    lathe(st, [(-0.011, 0.0), (-0.011, 0.029), (-0.008, 0.031), (-0.005, 0.030), (-0.0042, 0.0225), (-0.0026, 0.0208), (0.0, 0.0203), (0.0026, 0.0208),
               (0.0042, 0.0225), (0.005, 0.030), (0.008, 0.031), (0.011, 0.029), (0.011, 0.0)], (CABLE_X, gyc, gzc), 'x', "Brass", 40)
    tube(st, [(0.030, gyc, gzc), (0.157, gyc, gzc)], 0.0048, "Steel", 12)
    lathe(st, [(0, 0), (0, 0.0075), (0.004, 0.007), (0.006, 0)], (0.157, gyc, gzc), 'x', "Iron", 6, flat=True)
    talon = catmull([(0.14, 0.47, 0.030), (0.14, 0.44, 0.028), (0.14, 0.422, 0.052)], 6)
    for dx in (-0.0145, 0.0145):
        tube(st, [p + Vector((dx, 0, 0)) for p in talon], 0.0028, "Iron", 8, rfun=lambda t: 0.0034 - 0.0022 * t)
        tube(st, [(0.14 + dx, gyc, gzc), (0.14 + dx, 0.47, 0.030)], 0.0028, "Iron", 8)
    rbox(st, (0.012, 0.628, -0.100), (0.030, 0.668, -0.076), "Iron", 0.003)
    for yy in (0.6305, 0.6605):
        rbox(st, (0.030, yy - 0.0025, -0.098), (0.086, yy + 0.0025, -0.078), "Iron", 0.0012)
    tube(st, [(LATCH_PIVOT.x, 0.626, LATCH_PIVOT.z), (LATCH_PIVOT.x, 0.6345, LATCH_PIVOT.z)], 0.0032, "Brass", 10)
    tube(st, [(LATCH_PIVOT.x, 0.6615, LATCH_PIVOT.z), (LATCH_PIVOT.x, 0.670, LATCH_PIVOT.z)], 0.0032, "Brass", 10)

# ---------------------------------------------------------------- wings (prod)
def build_wings():
    """Swept wings on the contract limb path. Each limb is a blued-steel leaf spring laminated with horn,
    armoured along the top by overlapping brass covert scales; layered songbird primaries with iron tips
    hang behind it below the string plane, coverts over their roots. Drawn/Narrow shape keys bend
    everything with the limb (per-vertex limb parameter, as in the Opus builder)."""
    NS = B.NS
    C, L = B.limb_centerline(); P, phis, AB = B.solve_bend(C)
    T = [(C[min(i + 1, NS - 1)] - C[max(i - 1, 0)]).normalized() for i in range(NS)]
    Nb = [Vector((t.y, -t.x)) for t in T]
    zc = 0.105; right = MB()
    def th(s): return lerp(0.0120, 0.0060, s ** 0.9)
    def hh(s): return lerp(0.0280, 0.0120, s ** 1.1)
    sec_n = 20; verts = []; faces = []; fmat = []; svals = []
    stations = list(range(0, NS - 2, 2)) + ([NS - 3] if (NS - 3) % 2 else [])     # every other bend station (phone budget)
    for i in stations:
        s = i / (NS - 1)
        for k in range(sec_n):
            t = TAU * k / sec_n; c, sn = math.cos(t), math.sin(t)
            u = th(s) * math.copysign(abs(c) ** 0.55, c); v = hh(s) * math.copysign(abs(sn) ** 0.75, sn)
            p = C[i] + Nb[i] * u; verts.append((p.x, p.y, zc + v)); svals.append(i)
    rows = len(stations)
    for i in range(rows - 1):
        for k in range(sec_n):
            k1 = (k + 1) % sec_n
            faces.append((i * sec_n + k, (i + 1) * sec_n + k, (i + 1) * sec_n + k1, i * sec_n + k1))
            a = TAU * (k + 0.5) / sec_n; sa = math.sin(a); ca = math.cos(a)
            fmat.append("Steel" if abs(sa) > 0.78 else ("Horn" if ca > 0 else "Kingfisher"))
    faces.append(tuple(reversed(range(sec_n)))); fmat.append("Horn")
    faces.append(tuple(range((rows - 1) * sec_n, rows * sec_n))); fmat.append("Horn")
    right.add(verts, faces, fmat, None); right.s[-len(verts):] = svals
    def at(s): i = int(s * (NS - 1)); return i, C[i], Vector((T[i].x, T[i].y, 0)), Vector((Nb[i].x, Nb[i].y, 0))
    # brass covert scales: overlapping lamellae over the top of the limb, smaller toward the tip
    for j in range(12):
        s = 0.07 + 0.072 * j; i, c, t3, n3 = at(s)
        Lp = lerp(0.060, 0.034, s); w = th(s) + 0.006
        plate = [(0.0, -w), (Lp * 0.75, -w * 0.95), (Lp, -w * 0.4), (Lp * 1.04, 0.0), (Lp, w * 0.4), (Lp * 0.75, w * 0.95), (0.0, w)]
        k0 = len(right.v)
        prism(right, plate, (c.x, c.y, zc + hh(s) - 0.0012), tuple(t3), tuple(n3), (0, 0, 1), 0.0, 0.0024, "Brass", 0.0007, 1)
        rivet(right, Vector((c.x, c.y, zc + hh(s) + 0.0016)) + t3 * 0.006, (0, 0, 1), 0.0017)
        for q in range(k0, len(right.v)): right.s[q] = i
    # root pauldron where the limb enters the shoulder
    k0 = len(right.v)
    lathe(right, [(-0.006, 0.0), (-0.006, 0.036), (-0.002, 0.040), (0.012, 0.040), (0.018, 0.035), (0.018, 0.0)], (0.100, 0.884, zc), ((1, 0, 0), (0, 1, 0), (0, 0, 1)), "Iron", 28)
    for q in range(k0, len(right.v)): right.s[q] = 0
    # tip nock spool (groove centre on the runtime string endpoint) and an iron alula claw finial
    tip = C[-1]; k0 = len(right.v)
    lathe(right, [(-0.016, 0), (-0.016, 0.0075), (-0.012, 0.0092), (-0.0055, 0.0092), (-0.0040, 0.0058), (0.0, 0.0050),
                  (0.0040, 0.0058), (0.0055, 0.0092), (0.012, 0.0092), (0.018, 0.0060), (0.022, 0)], (tip.x, tip.y, zc), 'z', "Brass", 24)
    tube(right, catmull([(tip.x + 0.004, tip.y + 0.004, zc + 0.020), (tip.x + 0.022, tip.y + 0.024, zc + 0.026), (tip.x + 0.040, tip.y + 0.030, zc + 0.020),
                         (tip.x + 0.050, tip.y + 0.020, zc + 0.010)], 5), 0.0034, "Iron", 8, rfun=lambda t: 0.0038 * (1 - 0.85 * t))
    for q in range(k0, len(right.v)): right.s[q] = NS - 1
    # primaries (iron-tipped) and coverts; all hang behind the limb under the string plane
    for n_ in range(13):
        s = 0.22 + 0.06 * n_; i, c, t3, n3 = at(min(0.985, s))
        Lf = lerp(0.105, 0.200, math.sin(math.pi * min(1.0, n_ / 9.0) * 0.5)) if n_ < 10 else lerp(0.20, 0.16, (n_ - 9) / 3.0)
        ang = lerp(0.10, 1.05, n_ / 12.0)
        dirv = Vector((math.sin(ang), -math.cos(ang), 0)); V = Vector((-dirv.y, dirv.x, 0))
        root = Vector((c.x, c.y, 0)) + n3 * 0.002
        z0 = 0.0640 + 0.0022 * n_; w = 0.024 + 0.006 * min(1, n_ / 6)
        k0 = len(right.v)
        feather(right, root, dirv, V, (0, 0, 1), Lf, w, z0, 0.0018, n_ % 5)
        tube(right, [root + Vector((0, 0, z0)), root + Vector((0, 0, zc - hh(s) + 0.004))], 0.0026, "Brass", 8)
        for q in range(k0, len(right.v)): right.s[q] = i
    for n_ in range(9):
        s = 0.20 + 0.085 * n_; i, c, t3, n3 = at(min(0.95, s))
        Lf = lerp(0.060, 0.085, n_ / 8.0); ang = lerp(0.25, 0.95, n_ / 8.0)
        dirv = Vector((math.sin(ang), -math.cos(ang), 0)); V = Vector((-dirv.y, dirv.x, 0))
        root = Vector((c.x, c.y, 0)) + n3 * 0.004
        k0 = len(right.v)
        feather(right, root, dirv, V, (0, 0, 1), Lf, 0.020, 0.0935 - 0.0012 * n_, 0.0016, (n_ + 2) % 5, edge=None)
        for q in range(k0, len(right.v)): right.s[q] = i
    # mirror to the left wing
    wings = MB(); wings.extend(right)
    left = MB(); left.v = [Vector((-p.x, p.y, p.z)) for p in right.v]; left.s = list(right.s)
    left.f = [tuple(reversed(f)) for f in right.f]; left.m = list(right.m); left.flat = list(right.flat)
    wings.extend(left); nR = len(right.v)
    dD = []; dN = []
    for j, p in enumerate(wings.v):
        i = wings.s[j]; sx = 1 if j < nR else -1
        q = Vector((p.x * sx, p.y)); o = q - C[i]; ph = phis[i]
        q2 = P[i] + Vector((o.x * math.cos(ph) - o.y * math.sin(ph), o.x * math.sin(ph) + o.y * math.cos(ph)))
        d = q2 - q; dN.append(Vector((d.x * sx, 0, 0))); dD.append(Vector((0, d.y, 0)))
    ob = wings.to_object("Wings", (0, 0, 0))
    assign_feather_uvs(ob, right, 0)
    # left side: same faces offset, sampled with mirrored positions
    uv = ob.data.uv_layers.active.data; off = len(right.f)
    for mb, f0, f1, root, U, V, Lr, w, row, N, z0 in FEATHER_UV:
        if mb is not right: continue
        for fi in range(f0, f1):
            face = ob.data.polygons[fi + off]
            for vi, li in zip(wings.f[fi + off], face.loop_indices):
                p = wings.v[vi].copy(); p.x = -p.x
                along = max(0.0, min(1.0, (p - root).dot(U) / Lr)); across = max(-1.0, min(1.0, (p - root).dot(V) / w))
                uv[li].uv = (along, (row % 5 + 0.5 + 0.5 * across * 0.96) / 5.0)
    ob.shape_key_add(name="Basis", from_mix=False)
    for nm, disp in (("Drawn", dD), ("Narrow", dN)):
        sk = ob.shape_key_add(name=nm, from_mix=False)
        for j, d in enumerate(disp): sk.data[j].co = ob.data.vertices[j].co + G2B(d)
        sk.slider_max = 1.0
    return ob

# ---------------------------------------------------------------- sight art (static; the runtime adds the reticle)
def build_sight():
    s = MB(); r0 = SIGHT_REAR; f0 = SIGHT_FRONT
    # rear: hawk ghost-ring peep with swept brass wings on a forked iron post clamped to the rail cap
    lathe(s, [(-0.004, 0.0170), (-0.004, 0.0205), (-0.0015, 0.0222), (0.0015, 0.0222), (0.004, 0.0205), (0.004, 0.0170)], tuple(r0), 'y', "Brass", 40, closed=True)
    lathe(s, [(-0.0045, 0.0166), (-0.0045, 0.0172), (0.0045, 0.0172), (0.0045, 0.0166)], tuple(r0), 'y', "Ivory", 40, closed=True)
    for sx in (-1, 1):
        wing = [(0.0, -0.004), (0.016, -0.007), (0.034, -0.004), (0.046, 0.004), (0.036, 0.004), (0.020, 0.003), (0.006, 0.005), (0.0, 0.004)]
        prism(s, wing, tuple(r0 + Vector((sx * 0.020, 0, 0.002))), (sx * 0.96, -0.05, 0.28), (0, 0, 1), (0, 1, 0), -0.0016, 0.0016, "Brass", 0.0006, 1)
        tube(s, catmull([r0 + Vector((sx * 0.0125, 0, -0.016)), r0 + Vector((sx * 0.013, 0, -0.06)), Vector((sx * 0.016, 0.425, 0.168))], 5), 0.0026, "Iron", 8)
    lathe(s, [(0, 0), (0, 0.0042), (0.0028, 0.0034), (0.004, 0)], tuple(r0 + Vector((0, 0, 0.0222))), 'z', "Crystal", 10)
    # front: moon hood ring with an ivory crescent, a crystal star and raked legs to the shoulders
    lathe(s, [(-0.006, HOOD_R - 0.0010), (-0.006, HOOD_R + 0.0030), (-0.003, HOOD_R + 0.0046), (0.004, HOOD_R + 0.0046), (0.007, HOOD_R + 0.0030), (0.007, HOOD_R - 0.0010)],
          tuple(f0), 'y', "Brass", 56, closed=True)
    crescent = []
    for k in range(17):
        a = math.radians(40 + 100 * k / 16); crescent.append(f0 + Vector((math.cos(a) * (HOOD_R + 0.0085), 0.002, math.sin(a) * (HOOD_R + 0.0085))))
    tube(s, crescent, 0.0034, "Ivory", 8, rfun=lambda t: 0.0010 + 0.0036 * math.sin(math.pi * t))
    lathe(s, [(0, 0), (0, 0.0048), (0.003, 0.0040), (0.005, 0)], tuple(f0 + Vector((0, -0.001, HOOD_R + 0.0060))), 'z', "Crystal", 10)
    for sx in (-1, 1):
        a = -math.pi / 2 + sx * math.pi / 4.2; top = f0 + Vector((math.cos(a) * HOOD_R, 0, math.sin(a) * HOOD_R))
        foot = Vector((sx * 0.058, 0.904, 0.129))
        tube(s, [top, (top + foot) / 2 + Vector((sx * 0.004, 0, 0)), foot], 0.0028, "Brass", 8, rfun=lambda t: 0.0024 + 0.0012 * t)
        rbox(s, (sx * 0.058 - 0.009, 0.896, 0.125), (sx * 0.058 + 0.009, 0.912, 0.131), "Iron", 0.0012)
    return s

def build_moving():
    """The Opus gear train (pinion, reduction, drum, clutch, crank, latch) stays; the sled, bolt, knob and
    trigger are rebuilt; Godot-only art (reel socket, selector, rear optic) is dropped."""
    B.build_moving()
    for nm in ("ReelSocketArt", "SelectorArt", "OpticRear", "Bolt", "Sled", "CrankKnob", "Trigger"):
        ob = B.OBJ.pop(nm, None)
        if ob: bpy.data.objects.remove(ob, do_unlink=True)
    build_bolt(); build_sled(); build_knob_trigger()
    crank = B.OBJ["Crank"].data                                               # forged iron crank arm, brass bosses
    for i, m in enumerate(crank.materials):
        if m.name in (B.MATS["Bronze"].name,): crank.materials[i] = B.MATS["Iron"]

def build_knob_trigger():
    """Crank knob: a walnut grip carved as a perched songbird (leather-wrapped belly, brass head with a hooked
    iron beak and crystal eyes; counter-rotation keeps the beak forward). Trigger: a forged iron talon on a
    brass pin. Both keep the Opus envelopes, so the clearance sweep and VR grab reach are unchanged."""
    kn = MB()
    lathe(kn, [(0.0, 0), (0.0, 0.0045), (0.002, 0.0045), (0.002, 0)], (0, 0, 0), 'x', "Steel", 12)
    lathe(kn, [(0.002, 0), (0.002, 0.0110), (0.008, 0.0126), (0.022, 0.0150), (0.040, 0.0156), (0.058, 0.0144), (0.068, 0.0118), (0.070, 0)],
          (0, 0, 0), 'x', "Walnut", 28)
    lathe(kn, [(0.020, 0), (0.020, 0.0153), (0.052, 0.0153), (0.052, 0)], (0, 0, 0), 'x', "Leather", 28)
    for xx in (0.019, 0.053):
        lathe(kn, [(xx - 0.0015, 0), (xx - 0.0015, 0.0160), (xx + 0.0015, 0.0160), (xx + 0.0015, 0)], (0, 0, 0), 'x', "Brass", 28)
    lathe(kn, [(0.067, 0), (0.067, 0.0128), (0.075, 0.0138), (0.084, 0.0118), (0.089, 0.0070), (0.091, 0)], (0, 0, 0), 'x', "Brass", 28)
    prism(kn, [(0.008, -0.004), (0.020, -0.0015), (0.027, -0.0050), (0.016, 0.004), (0.006, 0.006)], (0.080, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
          -0.0026, 0.0026, "Iron", 0.0008, 1)
    for sz in (-1, 1):
        lathe(kn, [(0, 0), (0.0, 0.0024), (0.0016, 0)], (0.083, 0.004, sz * 0.0105), ((0, 0, sz), (1, 0, 0), (0, 1, 0)), "Crystal", 8, flat=True)
    ob = kn.to_object("CrankKnob", (0, 0, 0)); ob.parent = B.OBJ["Crank"]; ob.location = G2B(B.KNOB_OFS); B.OBJ["CrankKnob"] = ob
    t = MB()
    talon = [(-0.0070, 0.0040), (0.0045, 0.0068), (0.0120, -0.0080), (0.0170, -0.0260), (0.0200, -0.0440), (0.0190, -0.0560),
             (0.0120, -0.0660), (0.0040, -0.0660), (0.0085, -0.0560), (0.0105, -0.0440), (0.0080, -0.0280), (0.0010, -0.0140), (-0.0070, -0.0040)]
    prism(t, talon, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0042, 0.0042, "Iron", 0.0014, 2)
    for zz in (-0.022, -0.036):                                                                         # brass scutes on the talon
        prism(t, [(0.0, -0.003), (0.006, -0.003), (0.007, 0.0), (0.006, 0.003), (0.0, 0.003)], (0, 0.0075 + 0.0045 * (zz + 0.022) / -0.014, zz),
              (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0046, 0.0046, "Brass", 0.0006, 1)
    lathe(t, [(-0.0048, 0), (-0.0048, 0.0052), (0.0048, 0.0052), (0.0048, 0)], (0, 0, 0), 'x', "Brass", 16)
    ob = t.to_object("Trigger", (0, 0, 0)); ob.location = G2B(B.TRIGGER_PIVOT); B.OBJ["Trigger"] = ob

def build_bolt():
    """Songbird bolt (local: nock at 0, tip at +0.526 along +Y, axis at the origin): a brass swallow-tail nock,
    a barrelled ash shaft with a kingfisher cresting, three cambered songbird-feather fletches (the cock
    feather up), a brass ferrule and four-sided bodkin, and a resonance-crystal point. The bodkin stays four
    sided at 45 degrees so it clears the head's bolt groove when seated."""
    b = MB()
    lathe(b, [(0.0, 0.0), (0.0, 0.0050), (0.0035, 0.0068), (0.0150, 0.0066), (0.0165, 0.0058), (0.0165, 0.0)], (0, 0, 0), 'y', "Brass", 16)
    for sx in (-1, 1):                                                       # swallow-tail horns either side of the string slot
        prism(b, [(-0.0015, 0.0), (0.006, 0.0), (0.004, 0.0040), (-0.0030, 0.0062)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.0020, sx * 0.0058, "Brass", 0.0004, 1)
    lathe(b, [(0.0160, 0.0), (0.0160, 0.0056), (0.12, 0.0060), (0.28, 0.0063), (0.4420, 0.0057), (0.4420, 0.0)], (0, 0, 0), 'y', "Ash", 14)
    for y0, y1, m in ((0.136, 0.150, "Kingfisher"), (0.153, 0.156, "Brass"), (0.160, 0.163, "Ember"), (0.024, 0.028, "Brass")):
        lathe(b, [(y0, 0.0), (y0, 0.0064), (y1, 0.0064), (y1, 0.0)], (0, 0, 0), 'y', m, 14)
    for k, a in enumerate((math.pi / 2, math.pi / 6, 5 * math.pi / 6)):
        R = Vector((math.cos(a), 0, math.sin(a))); U = Vector((0, -1, 0)); V = -R; N = U.cross(V)
        feather(b, Vector((0, 0.132, 0)) + R * 0.0058, U, V, N, 0.100, 0.0128, -0.0005, 0.0010, 2 if k == 0 else 4,
                edge=None, camber=0.0, droop=0.0)
    lathe(b, [(0.440, 0.0), (0.440, 0.0068), (0.446, 0.0080), (0.452, 0.0070), (0.458, 0.0080), (0.464, 0.0064), (0.464, 0.0)], (0, 0, 0), 'y', "Brass", 16)
    lathe(b, [(0.462, 0.0), (0.462, 0.0062), (0.478, 0.0118), (0.492, 0.0100), (0.502, 0.0060), (0.502, 0.0)], (0, 0, 0), 'y', "Brass", 4, flat=True, phase=math.pi / 4)
    lathe(b, [(0.498, 0.0), (0.498, 0.0058), (0.506, 0.0066), (0.526, 0.0)], (0, 0, 0), 'y', "Crystal", 6, flat=True)
    ob = b.to_object("Bolt"); ob.location = G2B((0, DRAW_REAR, RAIL_Z)); B.OBJ["Bolt"] = ob
    assign_feather_uvs(ob, b, 0)

def build_sled():
    """Talon carriage (local, pivot at (0, draw, 0)): a brass hawk crouched on the rail. Folded-wing cheeks
    straddle the rail, forged iron talons hook the string, a crested brass head with a crystal eye looks down
    the rail, and an iron outrigger carries the cable anchor out to the winch guide."""
    s = MB()
    for sx in (-1, 1):
        prism(s, [(-0.056, 0.141), (-0.046, 0.134), (0.008, 0.134), (0.013, 0.140), (0.013, 0.1655), (-0.0048, 0.1675),
                  (-0.0048, 0.1905), (-0.020, 0.1960), (-0.042, 0.1945), (-0.055, 0.183)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.0172, sx * 0.0262, "Bronze", 0.0022, 2)
        for k, (y0, L, z) in enumerate(((0.010, 0.050, 0.170), (0.004, 0.052, 0.158), (-0.002, 0.050, 0.146))):   # folded primaries
            prism(s, [(0.0, -0.0055), (-L * 0.75, -0.0062), (-L, -0.0018), (-L * 0.97, 0.0030), (-L * 0.6, 0.0058), (0.0, 0.0055)],
                  (0, y0, z), (0, 1, 0), (0, 0, 1), (1, 0, 0), sx * (0.0262 + 0.0009 * k), sx * (0.0282 + 0.0009 * k), "Brass", 0.0007, 1)
        lathe(s, [(0, 0), (0, 0.0042), (0.0015, 0.0038), (0.0024, 0)], (sx * 0.0290, -0.030, 0.152), ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Iron", 10)
        rbox(s, (min(sx * 0.0078, sx * 0.0175), -0.050, 0.1355), (max(sx * 0.0078, sx * 0.0175), 0.012, 0.1500), "Iron", 0.0008)
        prism(s, [(-0.030, 0.1756), (-0.0048, 0.1756), (-0.0048, 0.1845), (0.0035, 0.1845), (0.0065, 0.1880),
                  (0.0050, 0.1935), (-0.010, 0.1965), (-0.030, 0.1950)], (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0),
              sx * 0.0086, sx * 0.0210, "Iron", 0.0012, 2)
        tube(s, catmull([(sx * 0.0148, 0.0035, 0.1925), (sx * 0.0148, 0.0090, 0.1890), (sx * 0.0148, 0.0098, 0.1810), (sx * 0.0148, 0.0060, 0.1772)], 4),
             0.0022, "Iron", 6, rfun=lambda t: 0.0026 * (1 - 0.7 * t))                               # claw hooks curling over the string
    prism(s, [(-0.054, 0.1756), (-0.0048, 0.1756), (-0.0048, 0.1900), (-0.020, 0.1950), (-0.042, 0.1935), (-0.054, 0.184)],
          (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.0175, 0.0175, "Brass", 0.002, 2)
    # crouched head at the back of the carriage, looking down the rail over the nock
    lathe(s, [(0.0, 0.0), (0.0, 0.0072), (0.007, 0.0080), (0.016, 0.0066), (0.022, 0.0036), (0.024, 0.0)], (0, -0.056, 0.2000), ((0, -1, 0), (1, 0, 0), (0, 0, 1)), "Brass", 14)
    lathe(s, [(0.0, 0.0), (0.0, 0.0040), (0.010, 0.0016), (0.014, 0.0)], (0, -0.050, 0.2015), ((0, 1, 0), (1, 0, 0), (0, 0, 1)), "Iron", 8)   # hooked beak, forward
    for sx in (-1, 1):
        lathe(s, [(0.0, 0.0), (0.0, 0.0030), (0.0012, 0.0024), (0.0018, 0.0)], (sx * 0.0078, -0.058, 0.2045), ((sx, 0, 0), (0, 1, 0), (0, 0, 1)), "Crystal", 8)
    for sx in (-1, 1):                                                                                 # swept ear tufts
        U = Vector((sx * 0.45, -0.75, 0.48)).normalized(); V = Vector((0, 0.54, 0.84)).normalized(); N = U.cross(V).normalized()
        prism(s, [(0.0, -0.0028), (0.012, -0.0022), (0.024, 0.0), (0.012, 0.0030), (0.0, 0.0028)], (sx * 0.0040, -0.060, 0.2055), U, V, N,
              -0.0009, 0.0009, "Kingfisher", 0.0004, 1)
    arm = [(0.026, 0.001), (0.026, 0.022), (0.080, 0.020), (0.128, 0.016), (0.153, 0.012), (0.156, 0.004), (0.153, 0.0005), (0.080, 0.001)]
    prism(s, arm, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.126, 0.146, "Iron", 0.002, 2)
    for xx in (0.055, 0.090):
        rivet(s, (xx, 0.011, 0.146), (0, 0, 1), 0.0022)
    lathe(s, [(0.0, 0.0), (0.0, 0.0065), (-0.004, 0.0062), (-0.006, 0.0)], (B.CABLE_X, 0.0005, 0.137), 'y', "Brass", 16)
    prism(s, [(-0.026, 0.001), (-0.026, 0.020), (-0.060, 0.016), (-0.082, 0.008), (-0.078, 0.001)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1),
          0.128, 0.142, "Bronze", 0.002, 2)
    B.OBJ["Sled"] = s.to_object("Sled", (0, 0, 0)); B.OBJ["Sled"].location = G2B((0, DRAW_REAR, 0))

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(HERE, '..', 'out', 'siegebird-v4.glb')
    B.setup_scene()
    body = build_body(); body.extend(build_sight())
    B.OBJ["Body"] = body.to_object("Body", (0, 0, 0))
    B.OBJ["Wings"] = build_wings()
    build_moving()
    # marker: the peep and moon hood are modelled into Body, so client/siegebird-sight.js keeps only its reticle
    e = bpy.data.objects.new("SightArt", None); e.empty_display_size = 0.02; e.location = G2B((0.0, 0.900, 0.239)); B.ASSET.objects.link(e); B.OBJ["SightArt"] = e
    rep = {"build_seconds": round(time.time() - T0, 2)}
    if "--no-check" not in argv:
        B.clearance_sweep.__globals__["OBJ"] = B.OBJ
        old = B.clearance_sweep
        rep["clearance"] = clearance_sweep()
        print("CLEARANCE unexpected=%d allowed=%d states=%d" % (len(rep["clearance"]["unexpected"]), rep["clearance"]["allowed_contacts"], rep["clearance"]["states"]))
        seen = set()
        for u in rep["clearance"]["unexpected"]:
            key = (u["a"], u["b"])
            if key in seen: continue
            seen.add(key); print("  HIT", u["a"], u["b"], "n=%d" % u["n"], "draw=%.3f rel=%s" % (u["state"]["draw"], u["state"]["release"]))
    rep["stats"] = B.stats()
    print("TRIANGLES", rep["stats"]["triangles"], json.dumps({k: v for k, v in rep["stats"]["per_object"].items() if not k.startswith("LiveCord")}))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    B.export(os.path.abspath(out))
    json.dump(rep, open(os.path.join(HERE, '..', 'out', 'build_report.json'), 'w'), indent=1, default=str)
    print("DONE %.1fs -> %s" % (time.time() - T0, out))

def clearance_sweep():
    """Opus sweep without the dropped Godot-only art."""
    src = B.clearance_sweep
    statics_patch = src.__code__.co_consts
    # run the Opus sweep with ReelSocketArt/SelectorArt/OpticRear missing: give it stand-in empties it skips
    for nm in ("ReelSocketArt", "SelectorArt", "OpticRear"):
        if nm not in bpy.data.objects:
            me = bpy.data.meshes.new(nm + "_none"); me.from_pydata([(9, 9, 9), (9.001, 9, 9), (9, 9.001, 9)], [], [(0, 1, 2)])
            ob = bpy.data.objects.new(nm, me); B.ASSET.objects.link(ob); TEMP.append(ob)
    try: return src()
    finally:
        for ob in TEMP: bpy.data.objects.remove(ob, do_unlink=True)
        TEMP.clear()
TEMP = []

if __name__ == "__main__":
    main()
