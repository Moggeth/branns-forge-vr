# Brann's Forge VR - portal frame builder (Blender 4.5, deterministic).
# Run:  blender -b --factory-startup --python output/build_portals.py -- [--no-preview] [--only id,id]
# Blender space: Z up, viewer/front side = -Y (exports to glTF/Godot +Z), origin on floor centre.
import bpy, math, os, sys, json, random
import numpy as np
from mathutils import Vector, Matrix

OUT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(OUT, "textures")
os.makedirs(TEX, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
V = Vector
IDS = ["pinewood_ruins", "sandstone_quarry", "enchanted_kitchen", "mushroom_glade", "crystal_hollow",
       "sky_garden", "ember_foundry", "forge_yard", "orchard_highlands", "gloamfen", "starfall_ridge",
       "cloudbreak_keep"]

# ---------------------------------------------------------------- textures
TN = 256
def vnoise(rng, sx, sy):
    g = rng.random((sy, sx))
    def ax(s):
        x = np.arange(TN) * s / TN; i0 = np.floor(x).astype(int); f = x - i0
        return i0, (i0 + 1) % s, f * f * (3 - 2 * f)
    x0, x1, fx = ax(sx); y0, y1, fy = ax(sy)
    fx = fx[None, :]; fy = fy[:, None]
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(rng, sx=4, sy=4, octs=5):
    o = np.zeros((TN, TN)); amp = 1; tot = 0
    for i in range(octs):
        o += vnoise(rng, sx * 2 ** i, sy * 2 ** i) * amp; tot += amp; amp *= 0.5
    return o / tot

def lerp3(a, b, t):
    a = np.array(a)[None, None, :]; b = np.array(b)[None, None, :]
    return a * (1 - t[..., None]) + b * t[..., None]

def recipe(kind, seed):
    rng = np.random.default_rng(seed)
    n = fbm(rng); n2 = fbm(rng, 16, 16, 3)
    if kind in ("copper", "verdigris"):
        dimp = fbm(rng, 24, 24, 2)
        col = lerp3((0.30, 0.12, 0.06), (0.80, 0.45, 0.24), np.clip(n * 1.4 - 0.2 + (dimp - 0.5) * 0.6, 0, 1))
        vt = np.clip((0.42 - n) * (6 if kind == "copper" else 2.5) + (0.1 if kind == "verdigris" else 0), 0, 1) ** 1.2
        col = col * (1 - vt[..., None]) + np.array((0.27, 0.52, 0.42)) * vt[..., None]
        rough = 0.28 + 0.25 * (1 - dimp) + 0.4 * vt
    elif kind == "oak":
        y = np.linspace(0, 1, TN)[:, None]
        rings = 0.5 + 0.5 * np.sin((y * 38 + fbm(rng, 2, 8, 4) * 7) * math.pi)
        streak = vnoise(rng, 64, 3)
        t = np.clip(rings * 0.45 + streak * 0.35 + n * 0.3, 0, 1)
        col = lerp3((0.20, 0.12, 0.065), (0.50, 0.33, 0.18), t)
        rough = 0.62 + 0.25 * (1 - t)
    elif kind == "iron":
        t = np.clip(n * 1.3 - 0.15, 0, 1)
        col = lerp3((0.045, 0.05, 0.065), (0.20, 0.22, 0.27), t)
        rust = np.clip((n2 - 0.68) * 5, 0, 1)
        col = col * (1 - rust[..., None]) + np.array((0.26, 0.12, 0.06)) * rust[..., None]
        rough = 0.42 + 0.3 * (1 - t) + 0.25 * rust
    elif kind == "sandstone":
        y = np.linspace(0, 1, TN)[:, None]
        strata = 0.5 + 0.5 * np.sin((y * 14 + n * 3) * math.pi)
        col = lerp3((0.50, 0.35, 0.22), (0.80, 0.66, 0.47), np.clip(strata * 0.5 + n2 * 0.5, 0, 1))
        rough = 0.85 + 0.1 * n2
    elif kind == "stone":
        col = lerp3((0.26, 0.26, 0.25), (0.55, 0.54, 0.50), np.clip(n * 1.2 + n2 * 0.3 - 0.2, 0, 1))
        moss = np.clip((n2 - 0.6) * 4, 0, 1)
        col = col * (1 - moss[..., None]) + np.array((0.20, 0.30, 0.12)) * moss[..., None]
        rough = 0.85 + 0.1 * n
    else:  # tinted organic: kind = (r,g,b) tuple string
        base = np.array(kind)
        t = np.clip(n * 1.2 + n2 * 0.25 - 0.25, 0, 1)
        col = base[None, None, :] * (0.65 + 0.6 * t[..., None])
        rough = 0.55 + 0.35 * n2
    return np.clip(col, 0, 1), np.clip(rough, 0, 1)

def save_img(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4)); rgba[..., :3] = arr
    img.pixels = rgba.ravel().tolist()
    img.filepath_raw = os.path.join(TEX, name + ".png"); img.file_format = "PNG"; img.save()
    return img

# name: (recipe, metallic, emission rgb or None, emission strength)
MATS = {
    "M_Copper": ("copper", 0.9, None, 0), "M_Verdigris": ("verdigris", 0.75, None, 0),
    "M_Oak": ("oak", 0.0, None, 0), "M_Iron": ("iron", 0.85, None, 0),
    "M_Sandstone": ("sandstone", 0.0, None, 0), "M_Stone": ("stone", 0.0, None, 0),
    "M_Leaf": ((0.13, 0.24, 0.10), 0.0, None, 0), "M_Cap": ((0.55, 0.20, 0.10), 0.0, None, 0),
    "M_Stem": ((0.78, 0.72, 0.60), 0.0, None, 0), "M_Pale": ((0.86, 0.85, 0.80), 0.0, None, 0),
    "M_Geode": ((0.11, 0.10, 0.13), 0.1, None, 0), "M_Apple": ((0.62, 0.10, 0.05), 0.0, None, 0),
    "M_Reed": ((0.42, 0.37, 0.20), 0.0, None, 0),
    "M_Hearth": ((1.0, 0.45, 0.12), 0.0, (1.0, 0.42, 0.10), 6.0),
    "M_Crystal": ((0.55, 0.42, 0.95), 0.1, (0.50, 0.35, 1.0), 2.5),
    "M_BogLight": ((0.55, 0.95, 0.65), 0.0, (0.45, 1.0, 0.55), 5.0),
    "M_StarLight": ((0.85, 0.90, 1.0), 0.0, (0.75, 0.85, 1.0), 6.0),
}
_matcache = {}
def mat(name):
    if name in _matcache: return _matcache[name]
    rec, metal, em, es = MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    col, rough = recipe(rec, abs(hash(name)) % 9999 if False else sum(map(ord, name)))
    ti = nt.nodes.new("ShaderNodeTexImage"); ti.image = save_img("T_" + name[2:] + "_basecolor", col)
    nt.links.new(ti.outputs["Color"], b.inputs["Base Color"])
    tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = save_img("T_" + name[2:] + "_rough", np.repeat(rough[..., None], 3, 2))
    tr.image.colorspace_settings.name = "Non-Color"
    nt.links.new(tr.outputs["Color"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = metal
    if em:
        b.inputs["Emission Color"].default_value = (*em, 1); b.inputs["Emission Strength"].default_value = es
    _matcache[name] = m
    return m

# ---------------------------------------------------------------- mesh accumulator
class Acc:
    def __init__(s): s.v = []; s.f = []; s.uv = []; s.mi = []; s.sm = []; s.mats = []
    def mid(s, name):
        if name not in s.mats: s.mats.append(name)
        return s.mats.index(name)
    def add_face(s, idx, uvs, m, smooth):
        s.f.append(idx); s.uv.extend(uvs); s.mi.append(s.mid(m)); s.sm.append(smooth)
    def vert(s, p):
        s.v.append(tuple(p)); return len(s.v) - 1

def tp_uv(p, n, k=1.6):
    a = max(range(3), key=lambda i: abs(n[i]))
    o = [i for i in range(3) if i != a]
    return (p[o[0]] * k, p[o[1]] * k)

def box(A, c, size, m, rot=None, smooth=False):
    c = V(c); R = rot or Matrix.Identity(3)
    hx, hy, hz = [x / 2 for x in size]
    corners = [c + R @ V((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    ids = [A.vert(p) for p in corners]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for q in quads:
        pts = [corners[i] for i in q]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        A.add_face([ids[i] for i in q], [tp_uv(p, n) for p in pts], m, smooth)

def rotz(a): return Matrix.Rotation(a, 3, "Z")
def roty(a): return Matrix.Rotation(a, 3, "Y")
def rotx(a): return Matrix.Rotation(a, 3, "X")

def circle_sec(n, r=1.0, ph=0.0, sx=1.0, sy=1.0):
    return [(math.cos(ph + 2 * math.pi * i / n) * r * sx, math.sin(ph + 2 * math.pi * i / n) * r * sy) for i in range(n)]

def rect_sec(w, d): return [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]

def sweep(A, pts, sec, m, scales=None, up=None, smooth=True, caps=True, twist=0.0, k=1.6):
    pts = [V(p) for p in pts]; n = len(pts)
    scales = scales or [1.0] * n
    if not isinstance(scales, list): scales = [scales] * n
    tans = []
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]); tans.append(t.normalized())
    frames = []
    if up is not None:
        for t in tans:
            nn = t.cross(V(up)).normalized(); frames.append((nn, t.cross(nn).normalized()))
    else:
        ref = V((0, 1, 0)) if abs(tans[0].y) < 0.9 else V((1, 0, 0))
        nn = tans[0].cross(ref).normalized()
        for t in tans:
            nn = (nn - t * nn.dot(t)).normalized(); frames.append((nn, t.cross(nn)))
    rings = []; L = 0.0
    for i, p in enumerate(pts):
        if i: L += (pts[i] - pts[i - 1]).length
        nn, bb = frames[i]; a = twist * i / max(n - 1, 1)
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for (x, y) in sec:
            x2, y2 = x * ca - y * sa, x * sa + y * ca
            ring.append((A.vert(p + nn * x2 * scales[i] + bb * y2 * scales[i]), L))
        rings.append(ring)
    ns = len(sec); per = sum((V(sec[j]) - V(sec[(j + 1) % ns])).length for j in range(ns))
    for i in range(n - 1):
        for j in range(ns):
            j2 = (j + 1) % ns
            a, b, c, d = rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]
            u0 = j / ns * per * k; u1 = (j + 1) / ns * per * k
            A.add_face([a[0], b[0], c[0], d[0]], [(u0, a[1] * k), (u1, b[1] * k), (u1, c[1] * k), (u0, d[1] * k)], m, smooth)
    if caps:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            ids = [r[0] for r in ring]
            if rev: ids = ids[::-1]
            if scales[0 if rev else -1] > 1e-4:
                A.add_face(ids, [(A.v[i][0] * k, A.v[i][2] * k) for i in ids], m, smooth and False)

def tube(A, pts, r, m, sides=8, smooth=True, caps=True, twist=0.0):
    rs = r if isinstance(r, list) else [r] * len(pts)
    sweep(A, pts, circle_sec(sides), m, scales=rs, smooth=smooth, caps=caps, twist=twist)

def sphere(A, c, r, m, seg=10, rings=6, scale=(1, 1, 1), rot=None, smooth=True, lower=0.0):
    c = V(c); R = rot or Matrix.Identity(3); ids = []
    for i in range(rings + 1):
        th = math.pi * (lower + (1 - lower) * i / rings) if lower else math.pi * i / rings
        row = []
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            p = V((math.sin(th) * math.cos(ph) * r * scale[0], math.sin(th) * math.sin(ph) * r * scale[1], math.cos(th) * r * scale[2]))
            row.append(A.vert(c + R @ p))
        ids.append(row)
    for i in range(rings):
        for j in range(seg):
            j2 = (j + 1) % seg
            q = [ids[i][j], ids[i + 1][j], ids[i + 1][j2], ids[i][j2]]
            A.add_face(q, [(j / seg * 3, i / rings), (j / seg * 3, (i + 1) / rings), ((j + 1) / seg * 3, (i + 1) / rings), ((j + 1) / seg * 3, i / rings)], m, smooth)

def rivet(D, p, m="M_Copper", r=0.016, face=-1):
    # domed rivet, flat side against surface; face=-1 front (-Y), +1 back
    sphere(D, p, r, m, seg=8, rings=3, scale=(1, 0.55, 1), rot=rotx(math.pi / 2 * (1 if face < 0 else -1)), lower=0.0)

def prism(A, base, tip_dir, r, length, m, sides=6, tip=0.28):
    base = V(base); d = V(tip_dir).normalized()
    pts = [base - d * 0.05, base + d * length * (1 - tip), base + d * length]
    sweep(A, pts, circle_sec(sides, ph=0.3), m, scales=[r, r * 1.05, 0.0], smooth=False)

def fin(A, pts2d, y, thick, m):
    """Extruded flat plate from a 2D (x,z) polygon, thickness along Y."""
    top = [A.vert((x, y - thick / 2, z)) for x, z in pts2d]
    bot = [A.vert((x, y + thick / 2, z)) for x, z in pts2d]
    uvs = [(x * 1.6, z * 1.6) for x, z in pts2d]
    A.add_face(top[::-1], uvs[::-1], m, False); A.add_face(bot, uvs, m, False)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        A.add_face([top[i], top[j], bot[j], bot[i]], [(0, 0), (0.2, 0), (0.2, 0.1), (0, 0.1)], m, False)

# ---------------------------------------------------------------- apertures
SPECS = {
    "pinewood_ruins": dict(kind="ellipse", hw=0.72, spring=1.70, rise=0.78),
    "sandstone_quarry": dict(kind="flat", hw=0.70, spring=1.60, rise=0.62),
    "enchanted_kitchen": dict(kind="round", hw=0.70, spring=1.80),
    "mushroom_glade": dict(kind="ellipse", hw=0.74, spring=1.60, rise=0.90),
    "crystal_hollow": dict(kind="pointed", hw=0.70, spring=1.75, R=1.05),
    "sky_garden": dict(kind="round", hw=0.68, spring=1.85),
    "ember_foundry": dict(kind="flat", hw=0.70, spring=1.70, rise=0.50),
    "forge_yard": dict(kind="round", hw=0.72, spring=1.80),
    "orchard_highlands": dict(kind="ellipse", hw=0.72, spring=1.75, rise=0.70),
    "gloamfen": dict(kind="pointed", hw=0.68, spring=1.70, R=1.10),
    "starfall_ridge": dict(kind="round", hw=0.70, spring=1.80),
    "cloudbreak_keep": dict(kind="round", hw=0.70, spring=1.75),
}

def outline(sp, n=28):
    hw, s, k = sp["hw"], sp["spring"], sp["kind"]
    P = [(-hw, 0.0), (-hw, s * 0.5)]
    if k in ("round", "ellipse"):
        rise = hw if k == "round" else sp["rise"]
        for i in range(n + 1):
            a = math.pi - math.pi * i / n; P.append((hw * math.cos(a), s + rise * math.sin(a)))
    elif k == "pointed":
        R = sp["R"]; a1 = math.acos((hw - R) / R); h = n // 2
        L = [(-hw + R + R * math.cos(math.pi - (math.pi - a1) * i / h), s + R * math.sin(math.pi - (math.pi - a1) * i / h)) for i in range(h + 1)]
        P += L + [(-x, z) for x, z in L[::-1][1:]]
    elif k == "flat":
        top = s + sp["rise"]; c = 0.12
        P.append((-hw, s))
        for i in range(5):
            a = math.pi - math.pi / 2 * i / 4; P.append((-hw + c + c * math.cos(a), top - c + c * math.sin(a)))
        for i in range(5):
            a = math.pi / 2 - math.pi / 2 * i / 4; P.append((hw - c + c * math.cos(a), top - c + c * math.sin(a)))
        P.append((hw, s))
    P += [(hw, s * 0.5), (hw, 0.0)]
    return P

def ap_top(sp):
    return max(z for _, z in outline(sp))

def offset_path(P, sp, d):
    cx, cz = 0.0, sp["spring"] * 0.55
    out = []
    for i, (x, z) in enumerate(P):
        a = V(P[max(i - 1, 0)]); b = V(P[min(i + 1, len(P) - 1)])
        t = (b - a).normalized(); nrm = V((-t.y, t.x))
        if nrm.dot(V((x - cx, z - cz))) < 0: nrm = -nrm
        if i in (0, len(P) - 1): nrm = V((-1, 0)) if x < 0 else V((1, 0))
        out.append((x + nrm.x * d, z + nrm.y * d))
    return out

def trim(A, sp, w, d, m, y=0.0, inset=0.0):
    P = offset_path(outline(sp), sp, w / 2 + inset)
    sweep(A, [(x, y, z) for x, z in P], rect_sec(w, d), m, up=(0, 1, 0), smooth=False)
    return P

def rivets_along(D, P2, y, step=0.16, m="M_Copper", r=0.016, both=True, skip_low=0.12):
    acc = 0.0; last = None
    for x, z in P2:
        if last is not None: acc += math.dist(last, (x, z))
        last = (x, z)
        if acc >= step and z > skip_low:
            acc = 0.0
            rivet(D, (x, -y, z), m, r, -1)
            if both: rivet(D, (x, y, z), m, r, 1)

# ---------------------------------------------------------------- themes
def wobble(seed, n, amp):
    r = random.Random(seed); return [r.uniform(-amp, amp) for _ in range(n)]

def th_pinewood(A, D, sp):
    r = random.Random(1)
    for side in (-1, 1):
        # three twisted strands spiral round each trunk core
        for k in range(3):
            pts = []
            for i in range(19):
                t = i / 18; z = -0.02 + t * 2.95
                bend = side * (0.88 - 0.62 * max(0, t - 0.62) ** 1.4 * 2.2)
                ang = k * 2.094 + t * 5.2 * side
                rad = 0.10 * (1.0 - 0.45 * t) + (0.10 if t < 0.08 else 0)
                pts.append((bend + math.cos(ang) * rad, math.sin(ang) * rad * 0.9, z))
            tube(A, pts, [0.11 * (1 - 0.6 * i / 18) + (0.05 if i == 0 else 0) for i in range(19)], "M_Oak", sides=7)
        # roots
        for k in range(4):
            a = k * 1.4 + 0.3
            tube(A, [(side * 0.88, 0, 0.35), (side * 0.88 + side * abs(math.cos(a)) * 0.25, math.sin(a) * 0.3, 0.08), (side * 0.9 + side * abs(math.cos(a)) * 0.48, math.sin(a) * 0.5, -0.02)], [0.07, 0.05, 0.02], "M_Oak", sides=6)
        # copper bands with rivets
        for z in (0.9, 1.75):
            sweep(A, [(side * 0.86, -0.0, z - 0.04), (side * 0.86, 0, z + 0.04)], circle_sec(10, 0.19), "M_Copper", smooth=True)
            for j in range(6):
                a = j * math.pi / 3; rivet(D, (side * 0.86 + math.cos(a) * 0.195, math.sin(a) * 0.195, z), r=0.013)
        # needle tufts
        for j in range(5):
            cx = side * (0.7 + r.uniform(-0.15, 0.35)); cz = 2.55 + r.uniform(0, 0.5)
            for q in range(5):
                a = q * 1.25 + r.random()
                sweep(A, [(cx, 0, cz), (cx + math.cos(a) * 0.3, r.uniform(-0.2, 0.2), cz + math.sin(a) * 0.18)], circle_sec(4, 0.05), "M_Leaf", scales=[1, 0.05], smooth=False)
    # ruined lintel: broken stone slab, left half fallen-tilted
    box(A, (0.30, 0, 2.86), (1.25, 0.42, 0.26), "M_Stone", rot=roty(-0.05))
    box(A, (-0.62, 0.02, 2.80), (0.62, 0.40, 0.24), "M_Stone", rot=roty(0.22) @ rotz(0.08))
    box(A, (-0.08, -0.05, 3.03), (0.32, 0.3, 0.16), "M_Stone", rot=roty(0.4))
    trim(A, sp, 0.06, 0.12, "M_Copper", inset=0.0)

def th_quarry(A, D, sp):
    P = trim(A, sp, 0.08, 0.30, "M_Iron")
    rivets_along(D, P, 0.155, 0.18, "M_Copper")
    # stepped quarried block jambs
    for side in (-1, 1):
        z = 0.0
        for i, (w, h) in enumerate([(0.36, 0.42), (0.32, 0.48), (0.30, 0.44), (0.27, 0.46), (0.25, 0.42)]):
            box(A, (side * (0.78 + w / 2 - 0.02), 0, z + h / 2), (w, 0.42 - i * 0.03, h - 0.015), "M_Sandstone")
            z += h
        # counterweight: stepped stack hanging on chain from beam end
        cx = side * 1.32
        for i, (w, h) in enumerate([(0.30, 0.12), (0.24, 0.12), (0.18, 0.12)]):
            box(A, (cx, 0, 0.95 + i * 0.12), (w, 0.26 - i * 0.03, h - 0.01), "M_Sandstone")
        box(A, (cx, 0, 1.33), (0.06, 0.06, 0.06), "M_Iron")
        for j in range(9):
            sweep(D, [(cx, 0, 1.38 + j * 0.135), (cx, 0, 1.49 + j * 0.135)], circle_sec(6, 0.03, sx=1.0, sy=0.45 if j % 2 else 1), "M_Iron", scales=[1, 1])
            pass
        # pulley wheel
        sweep(A, [(cx, -0.04, 2.66), (cx, 0.04, 2.66)], circle_sec(14, 0.13), "M_Copper", smooth=True)
        sweep(A, [(cx, -0.07, 2.66), (cx, 0.07, 2.66)], circle_sec(8, 0.03), "M_Iron")
    # oak crane beam / lintel + iron straps
    box(A, (0, 0, 2.53), (3.0, 0.30, 0.24), "M_Oak")
    box(A, (0, 0, 2.30), (1.95, 0.40, 0.22), "M_Sandstone")
    for x in (-1.0, -0.45, 0.45, 1.0):
        box(A, (x, 0, 2.53), (0.07, 0.33, 0.27), "M_Iron")
        rivet(D, (x, -0.17, 2.53), r=0.014); rivet(D, (x, 0.17, 2.53), r=0.014, face=1)
    # survey brass: quadrant arc + sighting tube + plumb bob
    q = [(math.cos(a) * 0.36, 0, 2.66 + math.sin(a) * 0.36) for a in np.linspace(0.15, math.pi - 0.15, 16)]
    sweep(A, q, rect_sec(0.04, 0.05), "M_Copper", up=(0, 1, 0), smooth=False)
    for a in np.linspace(0.3, math.pi - 0.3, 9):
        box(D, (math.cos(a) * 0.40, 0, 2.66 + math.sin(a) * 0.40), (0.012, 0.03, 0.06), "M_Copper", rot=roty(-a + math.pi / 2))
    tube(A, [(-0.30, 0, 2.86), (0.34, 0, 3.10)], [0.035, 0.045], "M_Copper", sides=10)
    tube(A, [(0, 0, 2.66), (0.0, 0, 3.02)], 0.014, "M_Iron", sides=6)
    sphere(A, (0, 0, 2.66), 0.05, "M_Copper", seg=10, rings=6)
    box(A, (0, 0, 2.70), (0.28, 0.22, 0.05), "M_Oak")

def th_kitchen(A, D, sp):
    P = trim(A, sp, 0.26, 0.40, "M_Copper")
    P2 = trim(A, sp, 0.04, 0.44, "M_Iron", inset=0.0)
    Po = offset_path(outline(sp), sp, 0.27)
    sweep(A, [(x, 0, z) for x, z in Po], rect_sec(0.05, 0.44), "M_Iron", up=(0, 1, 0), smooth=False)
    rivets_along(D, offset_path(outline(sp), sp, 0.13), 0.205, 0.13)
    for side in (-1, 1):
        # squat stove body with glowing firebox
        box(A, (side * 1.12, 0, 0.42), (0.46, 0.52, 0.84), "M_Iron")
        box(A, (side * 1.12, 0, 0.88), (0.52, 0.58, 0.07), "M_Copper")
        box(A, (side * 1.12, -0.262, 0.36), (0.26, 0.02, 0.18), "M_Hearth")
        box(A, (side * 1.12, 0.262, 0.36), (0.26, 0.02, 0.18), "M_Hearth")
        for gx in (-0.07, 0.0, 0.07):
            box(D, (side * 1.12 + gx, -0.275, 0.36), (0.02, 0.02, 0.2), "M_Iron")
            box(D, (side * 1.12 + gx, 0.275, 0.36), (0.02, 0.02, 0.2), "M_Iron")
        for cz in (0.1, 0.78):
            for cx in (-0.19, 0.19):
                rivet(D, (side * 1.12 + cx, -0.265, cz)); rivet(D, (side * 1.12 + cx, 0.265, cz), face=1)
        # riveted pots on the stove top
        for (px, r, h) in ((side * 1.02, 0.15, 0.22), (side * 1.27, 0.10, 0.16)):
            sweep(A, [(px, 0, 0.92), (px, 0, 0.92 + h * 0.15), (px, 0, 0.92 + h)], circle_sec(14, 1.0), "M_Copper", scales=[r * 0.85, r, r * 0.95])
            sweep(A, [(px, 0, 0.92 + h), (px, 0, 0.94 + h), (px, 0, 0.99 + h)], circle_sec(14, 1.0), "M_Iron", scales=[r * 1.02, r * 0.7, 0.02])
            tube(A, [(px - r, 0, 0.92 + h * 0.7), (px - r - 0.05, 0, 0.92 + h * 0.75)], 0.012, "M_Iron")
            for j in range(8):
                a = j * math.pi / 4; rivet(D, (px + math.cos(a) * r * 1.0, math.sin(a) * r * 1.0, 0.92 + h * 0.3), r=0.01)
    # steam hood: tapered copper hood over the arch with chimney
    hz = ap_top(sp) + 0.26
    sweep(A, [(0, 0, hz), (0, 0, hz + 0.32)], [(-1, -1), (1, -1), (1, 1), (-1, 1)], "M_Copper", scales=[0.62, 0.22], smooth=False)
    box(A, (0, 0, hz - 0.02), (1.36, 0.70, 0.06), "M_Iron")
    tube(A, [(0, 0, hz + 0.30), (0, 0, 3.12)], 0.13, "M_Iron", sides=12)
    sweep(A, [(0, 0, 3.1), (0, 0, 3.18), (0, 0, 3.3)], circle_sec(12, 1), "M_Copper", scales=[0.19, 0.2, 0.12])
    for x in np.linspace(-0.55, 0.55, 7):
        rivet(D, (x, -0.355, hz - 0.02), r=0.012); rivet(D, (x, 0.355, hz - 0.02), r=0.012, face=1)

def th_mushroom(A, D, sp):
    r = random.Random(4)
    trim(A, sp, 0.10, 0.18, "M_Stem")
    def mush(x, zt, rad, tilt, lean):
        stem = [(x + lean * t * t, 0, zt * t) for t in np.linspace(0, 1, 8)]
        tube(A, stem, [rad * 0.42 * (1.3 - 0.4 * t) for t in np.linspace(0, 1, 8)], "M_Stem", sides=9)
        c = V((x + lean, 0, zt)); R = roty(tilt)
        sphere(A, c, rad, "M_Cap", seg=16, rings=6, scale=(1, 0.85, 0.42), rot=R, lower=0.0)
        # gills: radial thin fins under the cap
        for j in range(18):
            a = j * 2 * math.pi / 18
            p0 = c + R @ V((math.cos(a) * rad * 0.25, math.sin(a) * rad * 0.22, -0.02))
            p1 = c + R @ V((math.cos(a) * rad * 0.92, math.sin(a) * rad * 0.8, -0.03))
            sweep(D, [p0, p1], rect_sec(0.008, 0.06), "M_Stem", smooth=False)
        # pale spots
        for j in range(6):
            a = r.uniform(0, 6.28); e = r.uniform(0.3, 0.8)
            sphere(D, c + R @ V((math.cos(a) * rad * math.sin(e), math.sin(a) * rad * 0.85 * math.sin(e), rad * 0.42 * math.cos(e))), rad * 0.09, "M_Pale", seg=6, rings=3)
    mush(-1.02, 2.55, 0.56, 0.18, 0.1)     # big asymmetric cap, left
    mush(1.0, 1.95, 0.36, -0.25, 0.05)
    mush(1.28, 1.05, 0.22, -0.3, 0.06)
    mush(-1.30, 0.75, 0.18, 0.25, -0.03)
    mush(0.62, 2.70, 0.24, -0.1, -0.1)
    # mycelium threads crawling over the arch and floor
    P = offset_path(outline(sp), sp, 0.11)
    for k in range(4):
        rr = random.Random(10 + k)
        pts = [(x + rr.uniform(-0.05, 0.05), rr.uniform(-0.12, 0.12) * (1 if k % 2 else -1), z + rr.uniform(-0.04, 0.04)) for x, z in P[::3]]
        tube(D, pts, 0.012, "M_Pale", sides=5)
    for k in range(10):
        a = r.uniform(0, 6.28); sx = r.choice((-1, 1)) * 0.95
        tube(D, [(sx, 0, 0.02), (sx + math.copysign(abs(math.cos(a)), sx) * 0.3, math.sin(a) * 0.35, 0.01), (sx + math.copysign(abs(math.cos(a)), sx) * 0.55, math.sin(a) * 0.55, 0.005)], 0.01, "M_Pale", sides=4)
    for k in range(9):
        sphere(A, (r.choice((-1, 1)) * r.uniform(0.85, 1.4), r.uniform(-0.2, 0.2), r.uniform(0.05, 1.4)), 0.03, "M_BogLight", seg=6, rings=4)

def th_crystal(A, D, sp):
    r = random.Random(5)
    P = offset_path(outline(sp), sp, 0.0)
    # split geode shell: jagged, thick halves with a dark crack at the apex
    for side in (-1, 1):
        half = [(x, z) for x, z in P if x * side >= -0.001]
        for i in range(len(half) - 1):
            (x0, z0), (x1, z1) = half[i], half[i + 1]
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            ang = math.atan2(z1 - z0, x1 - x0)
            depth = 0.30 + r.uniform(0, 0.22)
            nx, nz = -math.sin(ang), math.cos(ang)
            if nx * side < 0 and abs(nx) > 0.2: nx, nz = -nx, -nz
            if abs(nx) <= 0.2 and nz < 0: nx, nz = -nx, -nz
            if mz < 0.1: continue
            box(A, (mx + nx * depth / 2, 0, mz + nz * depth / 2), (math.hypot(x1 - x0, z1 - z0) + 0.06, 0.5 + r.uniform(0, 0.12), depth), "M_Geode", rot=roty(-ang) @ rotz(r.uniform(-0.1, 0.1)))
        box(A, (side * 0.95, 0, 0.45), (0.38, 0.55, 0.9), "M_Geode", rot=roty(side * 0.08))
        # inner crystal lining pointing toward the opening (kept outside the passage)
        for i in range(10):
            z = 0.25 + i * 0.22
            if z > sp["spring"]: break
            prism(D, (side * 0.80, r.uniform(-0.15, 0.15), z), (-side * 0.8, r.uniform(-0.3, 0.3), r.uniform(-0.2, 0.4)), 0.035, 0.13, "M_Crystal")
        # big prismatic blades
        for k, (a, L, rad) in enumerate([(0.35, 0.9, 0.09), (0.7, 0.65, 0.07), (0.05, 0.55, 0.06)]):
            base = (side * (0.55 + 0.18 * k), r.uniform(-0.1, 0.1), 2.25 + 0.2 * k)
            prism(A, base, (side * math.sin(a), 0, math.cos(a)), rad, L, "M_Crystal")
        prism(A, (side * 1.1, 0, 0.0), (side * 0.5, 0, 1), 0.07, 0.6, "M_Crystal")
    prism(A, (0.05, 0, 2.6), (0.05, 0, 1), 0.10, 0.62, "M_Crystal")
    trim(A, sp, 0.05, 0.56, "M_Iron")

def th_sky(A, D, sp):
    P = trim(A, sp, 0.14, 0.18, "M_Pale")
    trim(A, sp, 0.035, 0.22, "M_Copper", inset=0.14)
    rivets_along(D, offset_path(outline(sp), sp, 0.07), 0.095, 0.2, r=0.012)
    # curved wings of feather blades
    for side in (-1, 1):
        for i in range(9):
            t = i / 8
            root = V((side * (0.85 + 0.05 * t), 0, 1.0 + 1.45 * t))
            a = math.radians(70 - 75 * t)  # fan angle from horizontal
            L = 0.42 + 0.22 * math.sin(t * math.pi)
            tip = root + V((side * math.cos(a) * L, 0.03 * i, math.sin(a) * L))
            mid = root.lerp(tip, 0.5) + V((0, 0, 0.08))
            sweep(A, [root, mid, tip], [(-0.5, 0), (0, -0.12), (0.5, 0), (0, 0.12)], "M_Pale", scales=[0.12, 0.13, 0.01], up=(0, 1, 0), smooth=True)
            sweep(D, [root, tip], circle_sec(4, 0.012), "M_Copper", scales=[1, 0.2])
    # crown bar and wind chimes
    top = ap_top(sp)
    tube(A, [(-0.6, 0, top + 0.32), (0, 0, top + 0.40), (0.6, 0, top + 0.32)], 0.025, "M_Copper", sides=8)
    tube(A, [(0, 0, top + 0.08), (0, 0, top + 0.55)], 0.03, "M_Copper", sides=8)
    sphere(A, (0, 0, top + 0.6), 0.06, "M_Copper")
    for j, x in enumerate(np.linspace(-0.55, 0.55, 7)):
        zt = top + 0.34 + 0.06 * (1 - abs(x) / 0.6)
        L = 0.25 + 0.12 * ((j * 3) % 4)
        tube(D, [(x, 0, zt), (x, 0, zt - 0.08)], 0.004, "M_Iron", sides=4)
        if j % 2:
            tube(A, [(x, 0, zt - 0.08), (x, 0, zt - 0.08 - L)], 0.016, "M_Copper", sides=8)
        else:  # feather plate chime
            fin(A, [(x, zt - 0.08), (x + 0.04, zt - 0.2), (x + 0.02, zt - 0.08 - L), (x - 0.03, zt - 0.2)], 0, 0.01, "M_Pale")
    for side in (-1, 1):
        box(A, (side * 0.85, 0, 0.09), (0.36, 0.30, 0.18), "M_Pale")

def th_ember(A, D, sp):
    # massive tapered cinder-iron furnace with open glowing heat channels
    for side in (-1, 1):
        sweep(A, [(side * 1.0, 0, 0.0), (side * 0.98, 0, 2.2)], rect_sec(1, 1), "M_Iron", scales=[1, 1], up=None, smooth=False) if False else None
        for (x, z, w, h, d) in ((side * 1.02, 1.1, 0.62, 2.2, 0.62), (side * 0.98, 2.35, 0.54, 0.3, 0.58)):
            box(A, (x, 0, z), (w, d, h), "M_Iron")
        for k in range(3):
            cx = side * (0.86 + k * 0.16)
            box(A, (cx, -0.30, 1.0), (0.05, 0.04, 1.5), "M_Hearth")
            box(A, (cx, 0.30, 1.0), (0.05, 0.04, 1.5), "M_Hearth")
        for z in (0.12, 0.6, 1.1, 1.6, 2.05):
            box(A, (side * 1.02, 0, z), (0.66, 0.66, 0.06), "M_Copper" if z in (0.12, 2.05) else "M_Iron")
            for x in (0.8, 1.02, 1.24):
                rivet(D, (side * x, -0.335, z)); rivet(D, (side * x, 0.335, z), face=1)
        # buttress foot
        sweep(A, [(side * 1.25, 0, 0), (side * 1.25, 0, 0.9)], rect_sec(0.24, 0.5), "M_Iron", scales=[1, 0.4], up=(1, 0, 0), smooth=False)
    trim(A, sp, 0.14, 0.62, "M_Iron")
    rivets_along(D, offset_path(outline(sp), sp, 0.07), 0.315, 0.15)
    # firebox lintel with grate, crucible hood and twin stacks
    top = ap_top(sp)
    box(A, (0, 0, top + 0.28), (2.1, 0.66, 0.42), "M_Iron")
    for x in np.linspace(-0.6, 0.6, 9):
        box(A, (x, -0.33, top + 0.28), (0.06, 0.03, 0.26), "M_Hearth")
        box(A, (x, 0.33, top + 0.28), (0.06, 0.03, 0.26), "M_Hearth")
    box(A, (0, -0.335, top + 0.28), (1.4, 0.02, 0.04), "M_Iron")
    sweep(A, [(0, 0, top + 0.49), (0, 0, top + 0.78)], circle_sec(12, 1), "M_Copper", scales=[0.5, 0.3])
    for x in (-0.65, 0.65):
        tube(A, [(x, 0, top + 0.49), (x, 0, 3.15)], 0.11, "M_Iron", sides=10)
        sweep(A, [(x, 0, 3.12), (x, 0, 3.2)], circle_sec(10, 0.14), "M_Copper")
        box(A, (x, 0, 3.16), (0.2, 0.2, 0.01), "M_Hearth")

def th_forge(A, D, sp):
    # oak jambs + iron arch band, hinged straps, smith's crest
    for side in (-1, 1):
        box(A, (side * 0.84, 0, sp["spring"] / 2), (0.26, 0.34, sp["spring"]), "M_Oak")
        box(A, (side * 0.84, 0, 0.06), (0.34, 0.40, 0.12), "M_Iron")
        for z in (0.45, 1.05, 1.6):
            # strap hinge: bar + knuckle + spear tip, front and back
            for fy in (-1, 1):
                box(A, (side * 0.88, fy * 0.18, z), (0.40, 0.02, 0.07), "M_Iron")
                fin(A, [(side * 1.08, z - 0.06), (side * 1.18, z), (side * 1.08, z + 0.06)], fy * 0.18, 0.02, "M_Iron")
                rivet(D, (side * 0.78, fy * 0.195, z), "M_Iron", 0.014, fy); rivet(D, (side * 0.95, fy * 0.195, z), "M_Iron", 0.014, fy)
            sweep(A, [(side * 0.68, 0, z - 0.06), (side * 0.68, 0, z + 0.06)], circle_sec(8, 0.035), "M_Iron")
    P = trim(A, sp, 0.24, 0.34, "M_Oak")
    Pi = trim(A, sp, 0.08, 0.40, "M_Iron", inset=0.18)
    rivets_along(D, offset_path(outline(sp), sp, 0.22), 0.205, 0.13, "M_Copper")
    # voussoir-like iron bands across arch
    O = offset_path(outline(sp), sp, 0.12)
    for i in range(6, len(O) - 6, 5):
        x, z = O[i]; a = math.atan2(z - sp["spring"], x)
        box(A, (x, 0, z), (0.05, 0.38, 0.3), "M_Iron", rot=roty(-a + math.pi / 2))
    # crest: copper shield, crossed hammer & tongs
    top = ap_top(sp)
    cz = top + 0.36
    shield = [(-0.32, cz + 0.32), (0.32, cz + 0.32), (0.30, cz - 0.05), (0, cz - 0.38), (-0.30, cz - 0.05)]
    fin(A, shield, 0, 0.10, "M_Copper")
    fin(A, [(x * 1.12, cz + (z - cz) * 1.1) for x, z in shield], 0, 0.06, "M_Iron")
    for fy in (-1, 1):
        y = fy * 0.065
        for a in (0.7, -0.7):
            R = roty(a)
            box(A, V((0, y, cz)) + R @ V((0, 0, -0.02)), (0.04, 0.03, 0.5), "M_Oak", rot=R)
            box(A, V((0, y, cz)) + R @ V((0, 0, 0.24)), (0.20, 0.05, 0.09), "M_Iron", rot=R)
        rivet(D, (0, fy * 0.09, cz - 0.22), "M_Iron", 0.02, fy)
    # anvil cap on top
    box(A, (0, 0, cz + 0.42), (0.42, 0.18, 0.08), "M_Iron")
    box(A, (0, 0, cz + 0.36), (0.18, 0.14, 0.06), "M_Iron")

def th_orchard(A, D, sp):
    r = random.Random(8)
    # oak trellis posts + diagonal lattice side panels
    for side in (-1, 1):
        for x in (0.80, 1.38):
            box(A, (side * x, 0, 1.35), (0.10, 0.12, 2.7), "M_Oak")
            sphere(A, (side * x, 0, 2.72), 0.06, "M_Copper", seg=8, rings=4)
        for k in range(-3, 6):
            for d in (1, -1):
                z0 = k * 0.36
                p0 = (side * 0.84, -0.03 * d, z0); p1 = (side * 1.34, -0.03 * d, z0 + 0.5 * d)
                if d < 0: p0, p1 = (side * 0.84, 0.03, z0 + 0.5), (side * 1.34, 0.03, z0)
                (x0, y0, a0), (x1, y1, a1) = p0, p1
                # clip to panel
                lo, hi = 0.25, 2.45
                if min(a0, a1) < lo or max(a0, a1) > hi:
                    ta = max(0, (lo - a0) / (a1 - a0) if a1 != a0 else 0) if a0 < lo else (max(0, (hi - a0) / (a1 - a0)) if a0 > hi else 0)
                    tb = min(1, (hi - a0) / (a1 - a0)) if a1 > hi else (min(1, (lo - a0) / (a1 - a0)) if a1 < lo else 1)
                    if tb <= ta: continue
                    x0, a0, x1, a1 = x0 + (x1 - x0) * ta, a0 + (a1 - a0) * ta, x0 + (x1 - x0) * tb, a0 + (a1 - a0) * tb
                    if a0 < lo - 1e-3 or a1 < lo - 1e-3: continue
                sweep(A, [(x0, y0, a0), (x1, y1, a1)], rect_sec(0.035, 0.02), "M_Oak", smooth=False)
        for z in (0.25, 2.45):
            box(A, (side * 1.09, 0, z), (0.62, 0.08, 0.05), "M_Oak")
    trim(A, sp, 0.10, 0.14, "M_Oak")
    # gnarled laden apple bough arching over
    O = offset_path(outline(sp), sp, 0.2)
    bough = [(x * 1.12 + r.uniform(-0.03, 0.03), r.uniform(-0.05, 0.05), z + 0.12 + 0.12 * math.sin(i * 0.7)) for i, (x, z) in enumerate(O[1:-1:2])]
    tube(A, bough, [0.09 - 0.03 * abs(i / len(bough) - 0.5) for i in range(len(bough))], "M_Oak", sides=8)
    for k in range(14):
        i = r.randrange(2, len(bough) - 2); x, y, z = bough[i]
        if z < 1.5: continue
        tip = (x + r.uniform(-0.35, 0.35), r.uniform(-0.15, 0.15), z + r.uniform(0.05, 0.35))
        tube(A, [(x, y, z), tip], [0.035, 0.012], "M_Oak", sides=5)
        for q in range(4):
            a = r.uniform(0, 6.28); c = V(tip) + V((math.cos(a) * 0.1, r.uniform(-0.08, 0.08), math.sin(a) * 0.08))
            sphere(A, c, 0.09, "M_Leaf", seg=6, rings=3, scale=(1, 0.25, 0.5), rot=rotz(a) @ roty(r.uniform(-1, 1)))
        # hanging apples
        if k % 2 == 0:
            ax_ = tip[0] + r.uniform(-0.12, 0.12)
            if abs(ax_) < 0.7 and tip[2] - 0.16 < 2.2: ax_ = math.copysign(0.75, ax_)
            sphere(A, (ax_, tip[1], tip[2] - 0.14), 0.065, "M_Apple", seg=10, rings=6, scale=(1, 1, 0.9))
            tube(D, [(ax_, tip[1], tip[2] - 0.08), (ax_, tip[1], tip[2] - 0.03)], 0.006, "M_Oak", sides=4)
    for x in (-0.95, 1.18, -1.2, 1.0):
        sphere(A, (x, -0.1, 0.07), 0.065, "M_Apple", seg=10, rings=6, scale=(1, 1, 0.9))

def th_gloamfen(A, D, sp):
    r = random.Random(9)
    # bundled reed jambs and arch (many thin strands)
    O = offset_path(outline(sp), sp, 0.10)
    for k in range(7):
        a = k * 2 * math.pi / 7
        pts = [(x + math.cos(a + i * 0.3) * 0.07, math.sin(a + i * 0.3) * 0.08, z + math.cos(a + i * 0.3) * 0.02) for i, (x, z) in enumerate(O)]
        tube(A, pts, 0.028, "M_Reed", sides=5)
    for z in np.linspace(0.3, 1.5, 4):
        for side in (-1, 1):
            sweep(A, [(side * 0.78, 0, z - 0.03), (side * 0.78, 0, z + 0.03)], circle_sec(10, 0.13), "M_Verdigris")
    # tarnished copper reed loops
    for side in (-1, 1):
        for (cx, cz, rad, tilt) in ((1.12, 1.55, 0.30, 0.3), (1.05, 2.25, 0.22, -0.4), (1.2, 0.75, 0.24, 0.1)):
            loop = [(side * (cx + math.cos(a) * rad), math.sin(a) * rad * math.sin(tilt), cz + math.sin(a) * rad * math.cos(tilt)) for a in np.linspace(0, 2 * math.pi, 19)]
            tube(A, loop, 0.025, "M_Verdigris", sides=6, caps=False)
            tube(A, [(side * 0.86, 0, cz), (side * (cx - rad), 0, cz)], 0.02, "M_Verdigris", sides=6)
        # cattails
        for k in range(5):
            x = side * (0.95 + r.uniform(0, 0.5)); h = r.uniform(1.6, 2.9); lean = side * r.uniform(0, 0.2)
            tube(A, [(x, r.uniform(-0.2, 0.2), 0), (x + lean, 0, h)], [0.016, 0.008], "M_Reed", sides=5)
            tube(A, [(x + lean * 0.88, 0, h * 0.88), (x + lean * 0.96, 0, h * 0.96)], 0.035, "M_Cap", sides=7)
        # crooked iron post with caged bog light
        px = side * 1.42
        tube(A, [(px, 0, 0), (px - side * 0.05, 0, 1.2), (px + side * 0.03, 0, 2.2), (px - side * 0.12, 0, 2.45)], 0.035, "M_Iron", sides=6)
        lz = 2.15
        tube(D, [(px - side * 0.12, 0, 2.45), (px - side * 0.12, 0, lz + 0.12)], 0.006, "M_Iron", sides=4)
        sphere(A, (px - side * 0.12, 0, lz), 0.07, "M_BogLight", seg=10, rings=6)
        for j in range(4):
            a = j * math.pi / 2
            tube(D, [(px - side * 0.12, 0, lz + 0.12), (px - side * 0.12 + math.cos(a) * 0.09, math.sin(a) * 0.09, lz), (px - side * 0.12, 0, lz - 0.11)], 0.007, "M_Iron", sides=4)
    for k in range(6):
        sphere(A, (r.choice((-1, 1)) * r.uniform(0.9, 1.3), r.uniform(-0.3, 0.3), r.uniform(0.5, 2.7)), 0.035, "M_BogLight", seg=6, rings=4)

def th_starfall(A, D, sp):
    P = trim(A, sp, 0.16, 0.26, "M_Iron")
    trim(A, sp, 0.05, 0.30, "M_Copper", inset=0.16)
    rivets_along(D, offset_path(outline(sp), sp, 0.08), 0.135, 0.15)
    for side in (-1, 1):
        box(A, (side * 0.86, 0, 0.12), (0.40, 0.40, 0.24), "M_Iron")
    # armillary sphere crowning the arch
    c = V((0, 0, ap_top(sp) + 0.40)); R0 = 0.34
    for (rot, m, w) in ((Matrix.Identity(3), "M_Copper", 0.035), (rotz(math.pi / 2), "M_Copper", 0.03), (rotx(math.pi / 2) @ roty(0.41), "M_Copper", 0.03), (rotx(math.pi / 2), "M_Iron", 0.025)):
        ring = [c + rot @ V((math.cos(a) * R0, 0, math.sin(a) * R0)) for a in np.linspace(0, 2 * math.pi, 33)]
        sweep(A, ring, rect_sec(w, 0.025), m, smooth=False, caps=False)
        R0 *= 0.94
    tube(A, [c + roty(0.41) @ V((0, 0, -0.42)), c + roty(0.41) @ V((0, 0, 0.42))], 0.015, "M_Iron", sides=6)
    sphere(A, c, 0.09, "M_StarLight", seg=12, rings=8)
    tube(A, [(0, 0, ap_top(sp) + 0.13), c + V((0, 0, -0.34))], 0.04, "M_Iron", sides=8)
    # shooting-star fragments with tapered trails
    def star(p, s, rot):
        pts = [(p[0] + math.cos(rot + i * math.pi / 5) * (s if i % 2 == 0 else s * 0.42), p[2] + math.sin(rot + i * math.pi / 5) * (s if i % 2 == 0 else s * 0.42)) for i in range(10)]
        fin(A, pts[::-1], p[1], 0.04, "M_StarLight")
    for (p, s, trail) in (((-1.12, 0, 2.75), 0.13, (0.55, -0.45)), ((1.2, 0, 2.35), 0.11, (-0.5, -0.4)), ((-1.22, 0, 1.4), 0.08, (0.3, -0.5)), ((1.25, 0, 0.9), 0.07, (-0.25, -0.5))):
        star(p, s, 0.3)
        tube(A, [(p[0], 0, p[2]), (p[0] - trail[0] * 0.5, 0, p[2] - trail[1] * 0.5), (p[0] - trail[0], 0, p[2] - trail[1])], [s * 0.35, s * 0.2, 0.0], "M_Copper", sides=6)
        tube(A, [(p[0] + (math.copysign(0.86, p[0]) - p[0]), 0, p[2] - 0.2), (p[0], 0, p[2])], 0.012, "M_Iron", sides=4)

def th_keep(A, D, sp):
    # crenellated gatehouse: twin towers, voussoir arch, parapet, heraldic fins
    for side in (-1, 1):
        box(A, (side * 1.12, 0, 1.38), (0.66, 0.70, 2.76), "M_Stone")
        for z in np.arange(0.0, 2.7, 0.30):
            box(A, (side * 1.12, 0, z + 0.15), (0.70, 0.74, 0.02), "M_Stone")
        for k, mx in enumerate((0.87, 1.12, 1.37)):
            box(A, (side * mx, 0, 2.86), (0.16, 0.66, 0.20), "M_Stone")
        box(A, (side * 1.12, 0, 2.74), (0.76, 0.80, 0.06), "M_Iron")
        box(A, (side * 1.12, -0.36, 1.8), (0.06, 0.02, 0.30), "M_Hearth")  # arrow-slit glow
        box(A, (side * 1.12, 0.36, 1.8), (0.06, 0.02, 0.30), "M_Hearth")
        # heraldic fin: tall tapered banner plate
        fin(A, [(side * 1.12, 2.95), (side * 1.12, 3.32), (side * (1.12 + 0.36), 3.18), (side * (1.12 + 0.20), 3.10), (side * (1.12 + 0.30), 2.98)], 0, 0.02, "M_Copper")
        tube(A, [(side * 1.12, 0, 2.77), (side * 1.12, 0, 3.34)], 0.02, "M_Iron", sides=6)
    # voussoirs
    O = offset_path(outline(sp), sp, 0.13)
    idx = list(range(2, len(O) - 2, 2))
    for i in idx:
        x, z = O[i]; x2, z2 = O[i + 1]
        if z < sp["spring"] - 0.01: continue
        a = math.atan2(z2 - z, x2 - x)
        box(A, (x, 0, z), (0.11, 0.62, 0.26), "M_Stone", rot=roty(-a))
    trim(A, sp, 0.04, 0.66, "M_Iron")
    top = ap_top(sp)
    box(A, (0, 0, (top + 0.32 + sp["spring"] * 0.0) / 2 + 1.0), (1.6, 0.56, 0.1), "M_Stone") if False else None
    box(A, (0, 0, top + 0.20), (1.6, 0.60, 0.34), "M_Stone")
    for x in np.linspace(-0.6, 0.6, 5):
        box(A, (x, 0, top + 0.47), (0.17, 0.54, 0.20), "M_Stone")
    # heraldic centre shield with fins
    cz = top + 0.18
    fin(A, [(-0.18, cz + 0.16), (0.18, cz + 0.16), (0.16, cz - 0.06), (0, cz - 0.22), (-0.16, cz - 0.06)], -0.32, 0.04, "M_Copper")
    fin(A, [(-0.18, cz + 0.16), (0.18, cz + 0.16), (0.16, cz - 0.06), (0, cz - 0.22), (-0.16, cz - 0.06)], 0.32, 0.04, "M_Copper")
    for side in (-1, 1):
        for fy in (-0.32, 0.32):
            fin(A, [(side * 0.17, cz + 0.12), (side * 0.48, cz + 0.30), (side * 0.38, cz + 0.06), (side * 0.20, cz - 0.04)], fy, 0.025, "M_Iron")
    # portcullis teeth stub (above passage only)
    for x in np.linspace(-0.5, 0.5, 6):
        z0 = top - 0.02
        if math.sqrt(max(0, sp["hw"] ** 2 - x * x)) + sp["spring"] > 2.2:
            sweep(A, [(x, 0.20, sp["spring"] + math.sqrt(max(0, sp["hw"] ** 2 - x * x)) + 0.02), (x, 0.20, sp["spring"] + math.sqrt(max(0, sp["hw"] ** 2 - x * x)) - 0.10)], circle_sec(4, 0.025), "M_Iron", scales=[1, 0.05], smooth=False)

THEMES = dict(zip(IDS, [th_pinewood, th_quarry, th_kitchen, th_mushroom, th_crystal, th_sky, th_ember, th_forge, th_orchard, th_gloamfen, th_starfall, th_keep]))

# ---------------------------------------------------------------- veil
def build_veil(sp, name="Veil", K=7):
    rim = outline(sp, 40)
    hw = sp["hw"]
    bottom = [(hw - 2 * hw * i / 8, 0.0) for i in range(1, 8)]
    rim = rim + bottom  # closed loop CCW-ish
    top = ap_top(sp); C = (0.0, top * 0.48)
    verts = []; cols = []; uvs_v = []
    for k in range(K):
        t = k / K
        for (x, z) in rim:
            verts.append((x + (C[0] - x) * t, 0.0, z + (C[1] - z) * t)); cols.append(t)
    verts.append((C[0], 0.0, C[1])); cols.append(1.0)
    n = len(rim); faces = []
    for k in range(K - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
    ci = len(verts) - 1
    for i in range(n):
        faces.append(((K - 1) * n + i, (K - 1) * n + (i + 1) % n, ci))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    if me.polygons[0].normal.y > 0:
        me.flip_normals()
    uvl = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        x, _, z = verts[loop.vertex_index]
        uvl.data[loop.index].uv = ((x + hw) / (2 * hw), z / top)
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(cols):
        s = c * c * (3 - 2 * c)
        ca.data[i].color = (s, s, s, 1.0)
    me.color_attributes.active_color = ca
    ob = bpy.data.objects.new(name, me)
    vm = bpy.data.materials.get("M_Veil") or bpy.data.materials.new("M_Veil")
    vm.use_nodes = True
    me.materials.append(vm)
    return ob

# ---------------------------------------------------------------- object creation / export
def acc_to_obj(A, name, bevel=True):
    me = bpy.data.meshes.new(name); me.from_pydata(A.v, [], A.f); me.update()
    uvl = me.uv_layers.new(name="UVMap")
    for i, uv in enumerate(A.uv): uvl.data[i].uv = uv
    for i, p in enumerate(me.polygons):
        p.material_index = A.mi[i]; p.use_smooth = A.sm[i]
    for mn in A.mats: me.materials.append(mat(mn))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if bevel:
        b = ob.modifiers.new("Bevel", "BEVEL"); b.width = 0.010; b.segments = 2
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(50); b.harden_normals = False
        b.use_clamp_overlap = True
    return ob

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)

def check(obs, zid, sp):
    bad = 0; mx = [0, 0, 0, 0]
    for ob in obs:
        for v in ob.data.vertices:
            x, y, z = v.co
            if abs(x) < 0.6 and 0.0 < z < 2.05: bad += 1
            mx = [max(mx[0], abs(x)), max(mx[1], abs(y)), max(mx[2], z), min(mx[3], z)]
    return dict(passage_intrusions=bad, max_abs_x=round(mx[0], 3), max_abs_depth=round(mx[1], 3), height=round(mx[2], 3), min_z=round(mx[3], 3))

def export(zid):
    sp = SPECS[zid]; clear()
    A, D = Acc(), Acc()
    THEMES[zid](A, D, sp)
    fr = acc_to_obj(A, "Frame"); de = acc_to_obj(D, "Frame_Detail", bevel=False)
    # Keep the art outside the standing opening and the 3.10 m placement envelope.
    # Move only stray root threads, cap edges and the outer tips of star trails.
    for obj in (fr, de):
        for vertex in obj.data.vertices:
            x, y, z = vertex.co
            if 0.0 < z < 2.05 and abs(x) < 0.608:
                vertex.co.x = math.copysign(0.608, x)
            elif zid == "starfall_ridge" and abs(x) > 1.30:
                vertex.co.x = math.copysign(1.30 + (abs(x)-1.30) * 0.615, x)
    ve = build_veil(sp); bpy.context.scene.collection.objects.link(ve)
    rep = check([fr, de], zid, sp)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (fr, de, ve): o.select_set(True)
    kw = dict(filepath=os.path.join(OUT, zid + ".glb"), export_format="GLB", use_selection=True, export_apply=True,
              export_yup=True, export_animations=False, export_cameras=False, export_lights=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    rep["tris_frame"] = sum(len(p.vertices) - 2 for p in fr.data.polygons) + sum(len(p.vertices) - 2 for p in de.data.polygons)
    return rep

def aperture_entry(sp):
    top = ap_top(sp)
    e = dict(center_x=0.0, bottom_y=0.0, top_y=round(top, 4), half_width=sp["hw"], spring_y=sp["spring"], shape=sp["kind"])
    if sp["kind"] == "ellipse": e["arch_rise"] = sp["rise"]
    if sp["kind"] == "round": e["arch_rise"] = sp["hw"]
    if sp["kind"] == "pointed": e["arc_radius"] = sp["R"]
    if sp["kind"] == "flat": e["corner_radius"] = 0.12
    e["veil_mesh"] = "Veil"
    return e

def main():
    only = None
    for a in ARGS:
        if a.startswith("--only="): only = a.split("=", 1)[1].split(",")
    report = {}
    for zid in IDS:
        if only and zid not in only: continue
        report[zid] = export(zid); print("EXPORTED", zid, report[zid])
    aps = {z: aperture_entry(SPECS[z]) for z in IDS}
    with open(os.path.join(OUT, "apertures.json"), "w") as f:
        json.dump(dict(delivered="veil_mesh_per_glb", units="metres, Godot local (x right, y up, +z toward viewer)",
                       theme_index={z: i for i, z in enumerate(IDS)}, apertures=aps), f, indent=1)
    with open(os.path.join(OUT, "build_report.json"), "w") as f: json.dump(report, f, indent=1)
    if "--no-preview" not in ARGS: preview()

VEIL_PREV = [(0.5, 0.9, 0.5), (0.95, 0.75, 0.45), (1.0, 0.6, 0.3), (0.6, 0.95, 0.75), (0.7, 0.5, 1.0), (0.7, 0.9, 1.0),
             (1.0, 0.4, 0.12), (1.0, 0.75, 0.4), (0.8, 1.0, 0.5), (0.4, 0.9, 0.7), (0.6, 0.7, 1.0), (0.85, 0.9, 1.0)]

def preview():
    clear()
    sc = bpy.context.scene
    for i, zid in enumerate(IDS):
        sp = SPECS[zid]; A, D = Acc(), Acc(); THEMES[zid](A, D, sp)
        ox = (i % 6) * 3.4 - 8.5; oy = (i // 6) * 4.5
        for ob in (acc_to_obj(A, zid + "_F"), acc_to_obj(D, zid + "_D", False)):
            ob.location = (ox, oy, 0)
        ve = build_veil(sp, zid + "_V"); sc.collection.objects.link(ve); ve.location = (ox, oy, 0)
        vm = bpy.data.materials.new("PV" + zid); vm.use_nodes = True
        nt = vm.node_tree; nt.nodes.clear()
        o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission"); tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader"); va = nt.nodes.new("ShaderNodeVertexColor"); va.layer_name = "Color"
        e.inputs["Color"].default_value = (*VEIL_PREV[i], 1); e.inputs["Strength"].default_value = 2.0
        nt.links.new(va.outputs["Color"], mx.inputs["Fac"]); nt.links.new(e.outputs[0], mx.inputs[1]); nt.links.new(tr.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], o.inputs["Surface"])
        ve.data.materials[0] = vm
    # floor
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    fl = bpy.context.object; fm = bpy.data.materials.new("Floor"); fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.07, 0.06, 1); fl.data.materials.append(fm)
    w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.07, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    for (rot, en, col) in (((math.radians(55), 0, math.radians(-30)), 3.5, (1.0, 0.85, 0.7)), ((math.radians(60), 0, math.radians(150)), 1.5, (0.6, 0.7, 1.0))):
        L = bpy.data.lights.new("Sun", "SUN"); L.energy = en; L.color = col
        lo = bpy.data.objects.new("Sun", L); lo.rotation_euler = rot; sc.collection.objects.link(lo)
    try: sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError: sc.render.engine = "BLENDER_EEVEE"
    try: sc.eevee.taa_render_samples = 16
    except Exception: pass
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x, sc.render.resolution_y = 2200, 1100
    cam = bpy.data.cameras.new("Cam"); co = bpy.data.objects.new("Cam", cam); sc.collection.objects.link(co); sc.camera = co
    # front orthographic
    cam.type = "ORTHO"; cam.ortho_scale = 21.0
    co.location = (0, -20, 3.6); co.rotation_euler = (math.radians(90), 0, 0)
    # rows are at y=0 and y=4.5 -> raise back row visually via slight tilt
    co.location = (0, -30, 9.5); co.rotation_euler = (math.radians(78), 0, 0)
    sc.render.filepath = os.path.join(OUT, "preview_front.png"); bpy.ops.render.render(write_still=True)
    cam.type = "PERSP"; cam.lens = 30
    co.location = (-14, -17, 7.5); co.rotation_euler = (math.radians(72), 0, math.radians(-35))
    sc.render.filepath = os.path.join(OUT, "preview_oblique.png"); bpy.ops.render.render(write_still=True)

main()
