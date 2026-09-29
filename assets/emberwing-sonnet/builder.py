"""Emberwing phoenix bow / arrow / wings -- deterministic Blender builder.

Run: blender --background --python-exit-code 2 --python builder.py -- --out ABS_DIR
All geometry is authored in FINAL glTF/Godot coordinates (+Y up, arrow fires -Z) and
converted to Blender (x, -z, y) on creation; the glTF exporter converts it back.
"""
import bpy, bmesh, sys, math, os, json, struct
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath(".")
os.makedirs(OUT, exist_ok=True)

V = Vector
def B(p):  # glTF -> Blender
    return (p[0], -p[2], p[1])
def norm(v):
    v = V(v); return v.normalized() if v.length > 1e-9 else v
def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0); return t * t * (3 - 2 * t)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ textures / materials
def make_tex(name, fn, W=256, H=128):
    us = np.linspace(0, 1, W)[None, :].repeat(H, 0)
    vs = np.linspace(0, 1, H)[:, None].repeat(W, 1)
    rgb = fn(us, vs)
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((H, W, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = "sRGB"
    return img

def ramp(u, keys):
    out = np.zeros(u.shape + (3,))
    xs = [k[0] for k in keys]
    for c in range(3):
        out[..., c] = np.interp(u, xs, [k[1][c] for k in keys])
    return out

def tnoise(u, v, seed, n=7, fmax=9):
    rg = np.random.RandomState(seed); out = np.zeros(u.shape)
    for k in range(n):
        fx = rg.randint(0, fmax); fy = rg.randint(1, fmax)
        out += rg.uniform(0.4, 1.0) / (1 + 0.25 * (fx + fy)) * np.sin(2 * math.pi * (fx * u + fy * v) + rg.uniform(0, 6.28))
    return out / max(np.abs(out).max(), 1e-6)

def feather_detail(u, v, col, edge_tint):
    e = np.abs(v - 0.5) * 2
    col = col * (1 - 0.35 * e[..., None] ** 3)
    col = col * (0.88 + 0.12 * (0.5 + 0.5 * np.sin(v * 70 + u * 9))[..., None])
    m = smooth_np(0.78, 1.0, e)[..., None]
    col = col * (1 - m) + np.array(edge_tint) * m
    rach = (np.abs(v - 0.5) < 0.018)[..., None]
    col = np.where(rach, np.clip(col * 1.25 + 0.06, 0, 1), col)
    return col

def smooth_np(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def gold_fn(u, v):
    c = ramp(u, [(0, (0.22, 0.10, 0.03)), (.25, (0.75, 0.45, 0.10)), (.7, (1.0, 0.76, 0.26)), (1, (1.0, 0.9, 0.55))])
    return feather_detail(u, v, c, (1.0, 0.72, 0.18))
def ember_fn(u, v):
    # dark ember root -> deep orange -> hot gold (u~.78, also the heart) -> azure tip (u>.93, also the eyes)
    c = ramp(u, [(0, (0.16, 0.035, 0.02)), (.25, (0.55, 0.10, 0.02)), (.5, (1.0, 0.34, 0.03)), (.7, (1.0, 0.6, 0.1)),
                 (.78, (1.0, 0.88, 0.5)), (.88, (1.0, 0.6, 0.2)), (.93, (0.12, 0.5, 1.0)), (1, (0.55, 0.88, 1.0))])
    return feather_detail(u, v, c, (1.0, 0.72, 0.18))
def wing_fn(u, v):
    c = ramp(u, [(0, (0.4, 0.08, 0.02)), (.3, (1, 0.36, 0.05)), (.65, (1, 0.6, 0.14)), (.85, (1, 0.82, 0.4)), (.93, (0.15, 0.55, 1.0)), (1, (0.6, 0.9, 1.0))])
    return feather_detail(u, v, c, (1.0, 0.72, 0.2))
def wood_fn(u, v):
    warp = 0.07 * np.sin(2 * math.pi * (u * 2)) + 0.04 * tnoise(u, v * 0 + 0.3, 3, 4, 6)
    g = 0.5 + 0.5 * np.sin(2 * math.pi * (v * 6 + warp * 3) + 4 * tnoise(u, v, 5, 5, 4))
    fine = 0.5 + 0.5 * np.sin(2 * math.pi * (v * 31) + 6 * tnoise(u, v, 8, 5, 5))
    n = 0.5 + 0.5 * tnoise(u, v, 11, 8, 12)
    t = np.clip(0.30 * g + 0.35 * fine * n + 0.15 * n, 0, 1)[..., None]
    dark = np.array((0.035, 0.018, 0.010)); light = np.array((0.155, 0.078, 0.036))
    return dark * (1 - t) + light * t
def leather_fn(u, v):
    d = np.abs(np.sin(math.pi * (u * 2 + v * 4))) < 0.10
    d |= np.abs(np.sin(math.pi * (u * 2 - v * 4))) < 0.10
    n = 0.5 + 0.5 * tnoise(u, v, 21, 9, 14)
    base = np.array((0.15, 0.07, 0.04)) * (0.65 + 0.5 * n[..., None])
    return np.where(d[..., None], base * 0.45, base)
def brass_fn(u, v):
    n = 0.5 + 0.5 * tnoise(u, v, 31, 9, 10)
    pat = smooth_np(0.55, 0.9, n)[..., None]
    gold = np.array((0.86, 0.60, 0.22)) * (0.8 + 0.3 * n[..., None])
    return gold * (1 - pat) + np.array((0.36, 0.20, 0.07)) * pat
def brass_orm(u, v):
    n = 0.5 + 0.5 * tnoise(u, v, 31, 9, 10)
    pat = smooth_np(0.55, 0.9, n)
    r = 0.26 + 0.14 * n + 0.22 * pat
    m = 1.0 - 0.30 * pat
    return np.stack([np.ones_like(r), r, m], axis=-1)

def make_mat(name, color=(0.5, 0.5, 0.5), metal=0.0, rough=0.5, emit=None, estr=1.0, tex=None, emit_tex=False, orm=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = tex
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if emit_tex:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = estr
    elif emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = estr
    if orm is not None:  # glTF metallicRoughness: G = roughness, B = metallic
        o = nt.nodes.new("ShaderNodeTexImage"); o.image = orm; orm.colorspace_settings.name = "Non-Color"
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(o.outputs["Color"], sp.inputs["Color"])
        nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
    return m

TEX_GOLD = make_tex("tex_gold", gold_fn)
TEX_EMBER = make_tex("tex_ember", ember_fn)
TEX_WING = make_tex("tex_wing", wing_fn)
TEX_WOOD = make_tex("tex_wood", wood_fn, 512, 256)
TEX_LEATHER = make_tex("tex_leather", leather_fn, 256, 128)
TEX_BRASS = make_tex("tex_brass", brass_fn, 256, 128)
TEX_BRASS_ORM = make_tex("tex_brass_orm", brass_orm, 256, 128); TEX_BRASS_ORM.colorspace_settings.name = "Non-Color"
M = {
    "Wood": make_mat("Wood", (1, 1, 1), 0.0, 0.62, tex=TEX_WOOD),
    "Leather": make_mat("Leather", (1, 1, 1), 0.0, 0.7, tex=TEX_LEATHER),
    "Brass": make_mat("Brass", (1, 1, 1), 1.0, 0.3, tex=TEX_BRASS, orm=TEX_BRASS_ORM),
    "FeatherGold": make_mat("FeatherGold", (1, 1, 1), 0.85, 0.34, tex=TEX_GOLD),
    "FeatherEmber": make_mat("FeatherEmber", (0.45, 0.32, 0.28), 0.0, 0.5, tex=TEX_EMBER, emit_tex=True, estr=0.85),
    "Steel": make_mat("Steel", (0.66, 0.69, 0.74), 1.0, 0.27),
    "AshShaft": make_mat("AshShaft", (0.46, 0.30, 0.15), 0.0, 0.55),
    "Fletch": make_mat("Fletch", (0.88, 0.80, 0.66), 0.0, 0.8),
    "WingFeather": make_mat("WingFeather", (0.5, 0.36, 0.3), 0.0, 0.5, tex=TEX_WING, emit_tex=True, estr=1.0),
    "WingFlame": make_mat("WingFlame", (1.0, 0.45, 0.08), 0.0, 0.6, emit=(1.0, 0.5, 0.1), estr=3.0),
}
UV_HOT = (0.78, 0.5); UV_AZURE = (0.975, 0.5)  # special spots of the ember texture (heart / eyes / gems)

# ------------------------------------------------------------------ mesh builder
class MB:
    def __init__(self, mirror=False):
        self.v, self.uv, self.f, self.fm, self.fuv = [], [], [], [], []
        self.slots = []; self.mirror = mirror
    def vert(self, p, uv=(0.5, 0.5)):
        p = V(p)
        if self.mirror: p = V((p.x, -p.y, p.z))
        self.v.append(p); self.uv.append(uv); return len(self.v) - 1
    def face(self, idx, mat):
        if self.mirror: idx = idx[::-1]
        if mat not in self.slots: self.slots.append(mat)
        self.f.append(tuple(idx)); self.fm.append(self.slots.index(mat))
    def scale_x(self, k):
        for p in self.v: p.x *= k
    def tris(self):
        return sum(len(f) - 2 for f in self.f)
    def build(self, name, parent=None, origin=(0, 0, 0), slots=None):
        me = bpy.data.meshes.new(name)
        o = V(origin)
        verts = [B(p - o) for p in self.v]
        me.from_pydata(verts, [], self.f)
        for s in (slots or self.slots): me.materials.append(M[s])
        me.polygons.foreach_set("material_index", self.fm)
        me.polygons.foreach_set("use_smooth", [True] * len(self.f))
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            uvs = [self.uv[vi] for vi in poly.vertices]
            wrap = max(t[1] for t in uvs) - min(t[1] for t in uvs) > 0.6  # tube seam: unwrap v across the seam
            for li, uv in zip(poly.loop_indices, uvs):
                uvl.data[li].uv = (uv[0], uv[1] + 1.0 if wrap and uv[1] < 0.5 else uv[1])
        me.update()
        ob = bpy.data.objects.new(name, me)
        scene.collection.objects.link(ob)
        ob.location = B(o); ob.parent = parent
        if parent is not None: ob.location = B(o - V(parent.get("gpos", (0, 0, 0))))
        return ob

def empty(name, p, parent=None):
    e = bpy.data.objects.new(name, None); e.empty_display_type = "PLAIN_AXES"; e.empty_display_size = 0.02
    scene.collection.objects.link(e); e.parent = parent
    e["gpos"] = tuple(p)
    pp = V(parent.get("gpos", (0, 0, 0))) if parent else V((0, 0, 0))
    e.location = B(V(p) - pp)
    return e

def orient(mb_vs, idx, want):
    a, b, c = (mb_vs[i] for i in idx[:3])
    return (b - a).cross(c - a).dot(want) >= 0

def tube(mb, pts, radii, mats, sides=8, ref=V((1, 0, 0)), caps=(True, True), squash=1.0, uscale=1.0, cap_mat=None):
    """Ring tube. mats: str or per-segment list. Returns start ring index."""
    n = len(pts); rings = []
    for i, p in enumerate(pts):
        p = V(p); t = norm(V(pts[min(i + 1, n - 1)]) - V(pts[max(i - 1, 0)]))
        a = norm(t.cross(ref)); b = t.cross(a)
        ring = []
        for j in range(sides):
            ang = 2 * math.pi * j / sides
            ring.append(mb.vert(p + radii[i] * (math.cos(ang) * a + math.sin(ang) * b * squash), (uscale * i / max(n - 1, 1), j / sides)))
        rings.append(ring)
    flip = None
    for i in range(n - 1):
        m = mats if isinstance(mats, str) else mats[i]
        for j in range(sides):
            q = (rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j])
            if flip is None:
                # raw (pre-mirror) positions are what mb.v holds only when not mirrored; compensate
                vs = [mb.v[k] for k in q]
                if mb.mirror: vs = [V((p.x, -p.y, p.z)) for p in vs]
                cen = sum((V(pts[i]) for _ in [0]), V())
                c = (vs[0] - V(pts[i]))
                nrm = (vs[1] - vs[0]).cross(vs[3] - vs[0])
                flip = nrm.dot(c) < 0
            mb.face(q[::-1] if flip else q, m)
    for k, (end, sgn) in enumerate(((0, -1), (n - 1, 1))):
        if not caps[k]: continue
        m = cap_mat or (mats if isinstance(mats, str) else mats[min(end, n - 2)])
        c = mb.vert(pts[end]); r = rings[end]
        for j in range(sides):
            q = (c, r[j], r[(j + 1) % sides])
            vs = [mb.v[x] for x in q]
            if mb.mirror: vs = [V((p.x, -p.y, p.z)) for p in vs]
            tng = norm(V(pts[min(end + 1, n - 1)]) - V(pts[max(end - 1, 0)])) * sgn
            mb.face(q if (vs[1] - vs[0]).cross(vs[2] - vs[0]).dot(tng) > 0 else q[::-1], m)
    return rings

def ellipsoid(mb, c, r, mat, seg=10, rings=6, uv=(0.5, 0.5)):
    c = V(c); idx = []
    top = mb.vert(c + V((0, r[1], 0)), uv)
    for i in range(1, rings):
        ph = math.pi * i / rings; row = []
        for j in range(seg):
            th = 2 * math.pi * j / seg
            row.append(mb.vert(c + V((r[0] * math.sin(ph) * math.cos(th), r[1] * math.cos(ph), r[2] * math.sin(ph) * math.sin(th))), uv))
        idx.append(row)
    bot = mb.vert(c - V((0, r[1], 0)), uv)
    def add(q):
        vs = [mb.v[k] for k in q]
        if mb.mirror: vs = [V((p.x, -p.y, p.z)) for p in vs]
        nn = (vs[1] - vs[0]).cross(vs[2] - vs[0])
        mb.face(q if nn.dot(sum(vs, V()) / len(vs) - c) > 0 else q[::-1], mat)
    for j in range(seg):
        add((top, idx[0][(j + 1) % seg], idx[0][j]))
        add((bot, idx[-1][j], idx[-1][(j + 1) % seg]))
    for i in range(len(idx) - 1):
        for j in range(seg):
            add((idx[i][j], idx[i][(j + 1) % seg], idx[i + 1][(j + 1) % seg], idx[i + 1][j]))

def cone(mb, base, tip, r, mat, sides=8):
    base, tip = V(base), V(tip); t = norm(tip - base)
    ref = V((1, 0, 0)) if abs(t.x) < 0.9 else V((0, 1, 0))
    tube(mb, [base, tip], [r, 0.0002], mat, sides=sides, ref=ref, caps=(True, False))

def prof_default(t):
    return math.sin(math.pi * min(t ** 0.72, 1.0)) ** 0.75 * (1 - 0.12 * t)

def feather(mb, pts, nrefs, wmax, thick, cup, mat, ss=(-1, -0.5, 0, 0.5, 1), prof=prof_default, asym=0.25, uvrange=(0, 1)):
    """Thin two-sided feather strip along centreline pts; flat face normal ~ nrefs."""
    N = len(pts) - 1; ns = len(ss); T, Bt = [], []
    mid = ns // 2
    for i, p in enumerate(pts):
        t = i / N; p = V(p)
        tan = norm(V(pts[min(i + 1, N)]) - V(pts[max(i - 1, 0)]))
        n = norm(V(nrefs[i]) - tan * V(nrefs[i]).dot(tan))
        wv = norm(n.cross(tan)); w = wmax * prof(t)
        u = uvrange[0] + (uvrange[1] - uvrange[0]) * t
        top, bot = [], []
        for k, s in enumerate(ss):
            lat = s * w * (1.0 if s > 0 else 1 - asym)
            cupv = cup * w * s * s
            h = thick * (1 - 0.55 * abs(s)) if abs(s) < 1 else 0.0
            top.append(mb.vert(p + wv * lat + n * (h + cupv), (u, (s + 1) / 2)))
        for k, s in enumerate(ss):
            if abs(s) >= 1: bot.append(top[k]); continue
            lat = s * w * (1.0 if s > 0 else 1 - asym)
            bot.append(mb.vert(p + wv * lat + n * (-thick * 0.5 * (1 - 0.5 * abs(s)) + cup * w * s * s), (u, (s + 1) / 2)))
        T.append(top); Bt.append(bot)
    # orientation: top face normal should point to nref
    nr = V(nrefs[N // 2])
    def fq(a, b, c, d, want, mat=mat):
        vs = [mb.v[k] for k in (a, b, c)]
        if mb.mirror: vs = [V((p.x, -p.y, p.z)) for p in vs]
        w = want
        mb.face((a, b, c, d) if (vs[1] - vs[0]).cross(vs[2] - vs[0]).dot(w) > 0 else (d, c, b, a), mat)
    for i in range(N):
        for k in range(ns - 1):
            fq(T[i][k], T[i][k + 1], T[i + 1][k + 1], T[i + 1][k], nr)
            if Bt[i][k] == T[i][k] and Bt[i][k + 1] == T[i][k + 1]: continue
            fq(Bt[i][k], Bt[i][k + 1], Bt[i + 1][k + 1], Bt[i + 1][k], -nr)

# ------------------------------------------------------------------ BOW
def bez(p0, p1, p2, p3, u):
    a = 1 - u
    return a**3 * p0 + 3 * a * a * u * p1 + 3 * a * u * u * p2 + u**3 * p3
def bezt(p0, p1, p2, p3, u):
    a = 1 - u
    return norm(3 * a * a * (p1 - p0) + 6 * a * u * (p2 - p1) + 3 * u * u * (p3 - p2))

SP = [V((0, 0.075, -0.004)), V((0, 0.32, -0.17)), V((0, 0.55, -0.01)), V((0, 0.60, 0.10))]
def spine(u): return bez(*SP, u)
def stan(u): return bezt(*SP, u)
def snorm(u):
    t = stan(u); return norm(V((0, -t.z, t.y)))
X = V((1, 0, 0))

import random
YMAX = 0.625
def prof_blade(t):
    return min(1.0, t * 4.5) ** 0.6 * (1 - t ** 1.7) ** 0.85

def limb_feather(mbG, mbE, side, u, ang, L, w, zo=0.0, curl=0.03, azure=False, ember=True, N=8, gss=(-1, -0.5, 0, 0.5, 1)):
    """One swept feather: gold frame (+ ember interior on the player-facing side)."""
    root = spine(u) + X * side * 0.010 + snorm(u) * zo
    pts, nrs = [root], [snorm(u)]
    p = root
    for k in range(N):
        tk = (k + 0.5) / N; uu = min(u + tk * 0.10, 1.0)
        a = ang * (1 - 0.50 * tk ** 1.4)
        d = norm(stan(uu) * math.cos(a) + X * side * math.sin(a))
        p = p + d * (L / N)
        nn = snorm(uu)
        pts.append(p - nn * curl * tk * tk); nrs.append(nn)
    ym = max(q.y for q in pts)
    if ym > YMAX:
        k = (YMAX - root.y) / (ym - root.y); pts = [root + (q - root) * k for q in pts]
    feather(mbG, pts, nrs, w, 0.0016, 0.10, "FeatherGold", ss=gss, prof=prof_blade, uvrange=(0.0, 1.0))
    if ember:
        pin = [q + n * 0.0021 for q, n in zip(pts, nrs)][1:]
        feather(mbE, pin, nrs[1:], w * 0.56, 0.0012, 0.10, "FeatherEmber", ss=(-1, 0, 1), prof=lambda t: prof_blade(0.06 + 0.9 * t),
                asym=0.15, uvrange=(0.0, 1.0 if azure else 0.82))

def limb_feathers(mbG, mbE, rg, side):
    #        u     ang   len   width      clusters of three, a lone long primary, then a tip pair
    prim = [(0.10, 1.50, 0.16, 0.040), (0.19, 1.42, 0.24, 0.046), (0.28, 1.30, 0.30, 0.050), (0.40, 1.14, 0.34, 0.052),
            (0.52, 1.00, 0.31, 0.048), (0.64, 0.84, 0.24, 0.040), (0.78, 0.60, 0.15, 0.030)]
    sec = [(0.16, 1.45, 0.12, 0.040), (0.30, 1.32, 0.17, 0.042), (0.44, 1.18, 0.17, 0.040), (0.58, 1.02, 0.13, 0.034), (0.72, 0.80, 0.09, 0.026)]
    cov = [(0.12, 1.50, 0.060, 0.034), (0.26, 1.40, 0.075, 0.034), (0.42, 1.28, 0.070, 0.032), (0.58, 1.12, 0.060, 0.028)]
    spur = [(0.20, 0.90, 0.070, 0.022), (0.40, 0.75, 0.085, 0.024), (0.62, 0.60, 0.060, 0.018)]
    j = lambda: rg.uniform(-1, 1)
    for i, (u, a, L, w) in enumerate(prim):   # the wing proper: all on this limb's dominant side (rotationally symmetric bow)
        limb_feather(mbG, mbE, side, u, a + 0.05 * j(), 0.84 * L * (1 + 0.07 * j()), w, zo=-0.006, curl=0.04, azure=i >= len(prim) - 2, N=10)
    for u, a, L, w in sec:
        limb_feather(mbG, mbE, side, u, a + 0.05 * j(), 0.84 * L * (1 + 0.08 * j()), w, zo=0.004, curl=0.025, N=8)
    for u, a, L, w in cov:
        limb_feather(mbG, mbE, side, u, a + 0.04 * j(), 0.84 * L * (1 + 0.08 * j()), w, zo=0.010, curl=0.012, ember=False, N=6)
    for u, a, L, w in spur:                   # short leading-edge spurs on the other side
        limb_feather(mbG, mbE, -side, u, a, L, w, zo=0.002, curl=0.01, ember=False, N=5)
    # azure-gold tip blade running along the limb to its nock
    limb_feather(mbG, mbE, side, 0.87, 0.14, 0.055, 0.0085, zo=0.0, curl=0.0, azure=True, N=5)

def build_limb(root, sign, name):
    lim = empty(name, (0, 0, 0), root)
    rg = random.Random(11 if sign > 0 else 23)
    mbC = MB(mirror=sign < 0); mbG = MB(mirror=sign < 0); mbE = MB(mirror=sign < 0)
    us = [i / 18 for i in range(19)]
    pts = [spine(u) for u in us]
    rad = [0.0125 - 0.0058 * u for u in us]
    tube(mbC, pts, rad, "Wood", sides=8, ref=X, squash=0.85, caps=(False, False))
    for ub, w in ((0.10, 0.030), (0.42, 0.024), (0.74, 0.024), (0.955, 0.030)):
        seg = [ub - w / 2, ub - w / 3, ub + w / 3, ub + w / 2]
        ps = [spine(u) for u in seg]; r0 = 0.0125 - 0.0058 * ub
        tube(mbC, ps, [r0 * 1.05, r0 * 1.42, r0 * 1.42, r0 * 1.05], "Brass", sides=10, ref=X, squash=0.88, caps=(True, True))
    # tip nock cap + azure gem (gem samples the azure spot of the ember texture -> no extra surface)
    tp = spine(1.0); tt = stan(1.0)
    tube(mbC, [tp - tt * 0.02, tp, tp + tt * 0.010], [0.0072, 0.0085, 0.0045], "Brass", sides=10, ref=X, caps=(False, True))
    ellipsoid(mbE, tp - tt * 0.030 - snorm(1.0) * 0.008, (0.0065, 0.011, 0.0065), "FeatherEmber", seg=8, rings=5, uv=UV_AZURE)
    limb_feathers(mbG, mbE, rg, sign)
    parts = []
    for nm, mb in ((f"{name}Core", mbC), (f"{name}Feathers_Gold", mbG), (f"{name}Feathers_Ember", mbE)):
        parts.append(mb.build(nm, lim)); print(nm, "tris", mb.tris())
    return [lim] + parts

def build_core(root):
    mbE, mbB, mbG = MB(), MB(), MB()
    Zn = V((0, 0, 1)); Y = V((0, 1, 0))
    # chest + glowing heart (front, -Z), neck, head with eyes and hooked beak, all above the grip window (y >= 0.09)
    ellipsoid(mbE, V((0, 0.124, -0.046)), (0.027, 0.031, 0.021), "FeatherEmber", seg=14, rings=7, uv=(0.30, 0.5))
    ellipsoid(mbE, V((0, 0.118, -0.064)), (0.0105, 0.0125, 0.0075), "FeatherEmber", seg=10, rings=6, uv=UV_HOT)   # heart
    tube(mbB, [V((0, 0.108, -0.070)), V((0, 0.118, -0.0715)), V((0, 0.130, -0.068))], [0.0125, 0.0135, 0.010], "Brass", sides=12, caps=(False, False), ref=X, squash=0.55)  # heart cage
    neck = [V((0, 0.135, -0.050)), V((0, 0.165, -0.088)), V((0, 0.192, -0.124))]
    tube(mbE, neck, [0.0165, 0.0135, 0.012], "FeatherEmber", sides=10, ref=X, caps=(False, False))
    hc = V((0, 0.207, -0.148))
    ellipsoid(mbE, hc, (0.022, 0.021, 0.027), "FeatherEmber", seg=12, rings=7, uv=(0.40, 0.5))
    for s in (-1, 1):
        ellipsoid(mbE, hc + V((s * 0.0175, 0.005, -0.010)), (0.0055, 0.006, 0.007), "FeatherEmber", seg=8, rings=5, uv=UV_AZURE)  # eye
        pts = [hc + V((s * 0.0155, 0.015, -0.004)), hc + V((s * 0.0175, 0.0155, -0.020)), hc + V((s * 0.008, 0.014, -0.034))]
        feather(mbB, pts, [Y] * 3, 0.0045, 0.0010, 0.0, "Brass", ss=(-1, 0, 1), asym=0)  # brow ridge -> fierce look
    beak = [hc + V((0, -0.002, -0.018)), hc + V((0, -0.003, -0.044)), hc + V((0, -0.018, -0.066)), hc + V((0, -0.036, -0.070))]
    tube(mbB, beak, [0.0115, 0.0090, 0.0055, 0.0004], "Brass", sides=8, ref=X, caps=(True, False), squash=1.15)
    tube(mbB, [hc + V((0, -0.012, -0.018)), hc + V((0, -0.016, -0.046)), hc + V((0, -0.026, -0.058))], [0.0068, 0.0048, 0.0004], "Brass", sides=6, ref=X, caps=(True, False))
    # swept crest: plumes sweeping back (+Z) and up
    for k, a in enumerate((-0.55, -0.25, 0.0, 0.25, 0.55)):
        L = (0.055, 0.075, 0.095, 0.075, 0.055)[k]
        st = hc + V((0, 0.018, 0.006)); d = norm(V((math.sin(a) * 0.9, 0.75, 0.55)))
        pts = [st + d * L * i / 7 + V((0, -0.030 * (i / 7) ** 2 * L / 0.09, 0.03 * (i / 7) ** 2)) for i in range(8)]
        gold = k % 2 == 0
        feather(mbG if gold else mbE, pts, [V((math.sin(a), 0.4, 0.9))] * 8, 0.0085, 0.0011, 0.1,
                "FeatherGold" if gold else "FeatherEmber", prof=prof_blade, uvrange=(0, 1.0) if (gold or k == 2) else (0, 0.82))
    # mantle: shoulder feathers sweeping outward and up behind the head
    for side in (-1, 1):
        for k in range(5):
            f = k / 4; ang = 0.30 + f * 0.95
            d = norm(V((side * math.cos(ang), 0.20 + 0.75 * math.sin(ang), 0.20)))
            L = (0.070, 0.092, 0.105, 0.088, 0.062)[k]
            st = V((side * 0.020, 0.122 + 0.006 * k, -0.040))
            pts = [st + d * L * i / 7 + V((0, 0, 0.022 * (i / 7) ** 2)) for i in range(8)]
            nr = [norm(V((0, 0.2, 1.0))) for _ in pts]
            feather(mbG, pts, nr, 0.0155, 0.0013, 0.1, "FeatherGold", ss=(-1, 0, 1), prof=prof_blade)
            feather(mbE, [q + V((0, 0, 0.0021)) for q in pts[1:]], nr[1:], 0.0086, 0.0010, 0.1, "FeatherEmber", ss=(-1, 0, 1),
                    prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0, 0.82 if k < 4 else 1.0))
    # tail fan below the grip window, forward of the lower limb core, clear of the hand
    for k in range(5):
        a = (k - 2) * 0.30
        st = V((0, -0.098, -0.052)); d = norm(V((math.sin(a) * 0.9, -1, -0.10)))
        L = 0.115 - 0.018 * abs(k - 2)
        pts = [st + d * L * i / 7 + V((0, 0, -0.008 * (i / 7) ** 2)) for i in range(8)]
        nr = [Zn] * 8
        feather(mbG, pts, nr, 0.0105, 0.0012, 0.12, "FeatherGold", prof=prof_blade)
        feather(mbE, [q + V((0, 0, 0.002)) for q in pts[1:]], nr[1:], 0.0056, 0.001, 0.1, "FeatherEmber", ss=(-1, 0, 1),
                prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0, 0.82 if k != 2 else 1.0))
    tube(mbB, [V((0, 0.052, -0.010)), V((0, 0.070, -0.010))], [0.0195, 0.0140], "Brass", sides=14, caps=(False, False))
    ob = MB()
    for src in (mbE, mbB, mbG):
        base = len(ob.v)
        ob.v += [p.copy() for p in src.v]; ob.uv += src.uv
        for f, m in zip(src.f, src.fm):
            ob.face(tuple(i + base for i in f), src.slots[m])
    print("PhoenixCore tris", ob.tris())
    return ob.build("PhoenixCore", root)


def build_grip(root):
    mb = MB()
    ys = [-0.08 + 0.16 * i / 62 for i in range(63)]
    pts = [V((0, y, 0)) for y in ys]; rad = []; mats = []
    for i, y in enumerate(ys):
        e = min(y + 0.08, 0.08 - y)
        r = 0.0173 * (1 + 0.022 * math.cos(2 * math.pi * y / 0.0104))
        r *= 1 + 0.12 * max(0, 1 - e / 0.006) ** 1.5  # flared brass collars
        rad.append(r); mats.append("Brass" if e < 0.0065 else "Leather")
    tube(mb, pts, rad, mats[:-1], sides=18, ref=V((0, 0, 1)), caps=(True, True), cap_mat="Brass", uscale=6.0)
    grip = mb.build("GripMesh", root, slots=["Leather", "Brass"])
    # arrow port bored through the grip on the arrow line (boolean, brass-lined)
    cut = MB(); tube(cut, [V((0, 0, -0.06)), V((0, 0, 0.06))], [0.0105, 0.0105], "Brass", sides=20, ref=X, caps=(True, True))
    co = cut.build("cutter", root, slots=["Leather", "Brass"])
    co.data.polygons.foreach_set("material_index", [1] * len(co.data.polygons))
    md = grip.modifiers.new("port", "BOOLEAN"); md.object = co; md.operation = "DIFFERENCE"; md.solver = "EXACT"
    try: md.material_mode = "INDEX"
    except Exception: pass
    bpy.context.view_layer.objects.active = grip
    for o in bpy.context.selected_objects: o.select_set(False)
    grip.select_set(True)
    bpy.ops.object.modifier_apply(modifier="port")
    bpy.data.objects.remove(co, do_unlink=True)
    print("GripMesh tris", sum(len(p.vertices) - 2 for p in grip.data.polygons))
    return grip

def build_bow():
    root = empty("Bow", (0, 0, 0))
    objs = [root]
    for n, p in (("Grip", (0, 0, 0)), ("ArrowRest", (0, 0, 0.10)), ("StringTop", (0, 0.60, 0.10)), ("StringBottom", (0, -0.60, 0.10))):
        objs.append(empty(n, p, root))
    objs.append(build_grip(root))
    objs += build_limb(root, 1, "UpperLimb")
    objs += build_limb(root, -1, "LowerLimb")
    objs.append(build_core(root))
    return objs

# ------------------------------------------------------------------ ARROW
def build_arrow():
    root = empty("Arrow", (0, 0, 0)); objs = [root]
    objs.append(empty("ArrowNock", (0, 0, 0), root)); objs.append(empty("ArrowTip", (0, 0, -0.78), root))
    Zd = V((0, 0, -1)); R = 0.0037
    shaft = MB()
    zs = [-0.02 + (-0.72) * i / 5 for i in range(6)]
    tube(shaft, [V((0, 0, z)) for z in zs], [R * (1.0 if i > 0 else 0.98) for i in range(6)], "AshShaft", sides=12, ref=X, caps=(False, False))
    objs.append(shaft.build("Shaft", root))
    nock = MB()
    tube(nock, [V((0, 0, 0.0)), V((0, 0, -0.006)), V((0, 0, -0.016)), V((0, 0, -0.03))], [0.0052, 0.0058, 0.0050, R], "Brass", sides=10, ref=X, caps=(True, False))
    objs.append(nock.build("Nock", root))
    head = MB()
    tube(head, [V((0, 0, -0.722)), V((0, 0, -0.734)), V((0, 0, -0.742))], [0.0056, 0.0056, 0.0046], "Steel", sides=10, ref=X, caps=(True, False))
    cone(head, V((0, 0, -0.742)), V((0, 0, -0.78)), 0.0046, "Steel", 10)
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 6; rd = V((math.cos(a), math.sin(a), 0)); tg = V((-math.sin(a), math.cos(a), 0))
        pts = [rd * 0.0035 + V((0, 0, -0.736 - 0.030 * i / 5)) for i in range(6)]
        prof = lambda t: math.sin(math.pi * (0.1 + 0.8 * t)) ** 0.9 * 1.0
        feather(head, pts, [tg] * 6, 0.0085, 0.0007, 0.0, "Steel", ss=(-1, 0, 1), prof=lambda t: 0.5 * math.sin(math.pi * t) ** 0.8 + 0.25, asym=0)
    objs.append(head.build("Head", root))
    fl = MB()
    for k in range(3):
        a0 = k * 2 * math.pi / 3 + math.pi / 2; pts, nrs = [], []
        for i in range(9):
            t = i / 8; a = a0 + 0.5 * t
            rd = V((math.cos(a), math.sin(a), 0)); tg = V((-math.sin(a), math.cos(a), 0))
            pts.append(rd * (R + 0.0075) + V((0, 0, -0.040 - 0.125 * t))); nrs.append(tg)
        pr = lambda t: 0.30 + 0.70 * math.sin(math.pi * min(0.15 + 0.85 * t, 1)) ** 0.5 * (1 - 0.35 * t)
        feather(fl, pts, nrs, 0.0078, 0.0008, 0.35, "Fletch", ss=(-1, -0.3, 0.3, 1), prof=pr, asym=0)
    objs.append(fl.build("Fletching", root))
    bd = MB()
    for zc, w in ((-0.032, 0.008), (-0.172, 0.010), (-0.715, 0.008)):
        tube(bd, [V((0, 0, zc + w / 2)), V((0, 0, zc + w / 3)), V((0, 0, zc - w / 3)), V((0, 0, zc - w / 2))], [R * 1.02, R * 1.16, R * 1.16, R * 1.02], "Brass", sides=12, ref=X, caps=(False, False))
    # tiny inlaid phoenix on the shaft (top), z ~ -0.20..-0.245
    zc = -0.215
    for side in (-1, 1):
        for k in range(4):
            phi0 = 0.05 + 0.10 * k; pts, nrs = [], []
            for i in range(6):
                t = i / 5; phi = phi0 + 0.85 * t * (0.6 + 0.15 * k)
                z = zc + 0.004 * k * -1 + (-0.022 - 0.004 * k) * t * -1 * -1
                z = zc - 0.006 - 0.003 * k - (0.014 + 0.003 * k) * t
                pts.append(V((side * R * 1.01 * math.sin(phi), R * 1.01 * math.cos(phi), z)))
                nrs.append(V((side * math.sin(phi), math.cos(phi), 0)))
            feather(bd, pts, nrs, 0.0009, 0.0003, 0.0, "Brass", ss=(-1, 0, 1))
    ellipsoid(bd, V((0, R * 1.0, zc + 0.002)), (0.0016, 0.0009, 0.006), "Brass", seg=6, rings=4)
    objs.append(bd.build("Bindings", root))
    return objs

# ------------------------------------------------------------------ WINGS
def prof_wing(t):
    return min(1.0, t * 3.5) ** 0.55 * (1 - t ** 2.0) ** 0.8
def prof_wing2(t):
    return math.sin(math.pi * min(t ** 0.7, 1.0)) ** 0.7

def build_wings():
    root = empty("Wings", (0, 0, 0)); objs = [root]
    rg = random.Random(5)
    # (u along the arm, angle from +Z toward outward, length, width)
    prim = [(0.24, 0.04, 0.130, 0.017), (0.33, 0.08, 0.175, 0.019), (0.43, 0.13, 0.220, 0.020), (0.53, 0.19, 0.260, 0.021),
            (0.63, 0.27, 0.285, 0.021), (0.73, 0.37, 0.290, 0.020), (0.83, 0.50, 0.255, 0.018), (0.92, 0.66, 0.200, 0.016), (1.0, 0.86, 0.130, 0.013)]
    sec = [(0.10, 0.00, 0.085, 0.016), (0.18, 0.05, 0.115, 0.017), (0.28, 0.10, 0.135, 0.018), (0.40, 0.17, 0.150, 0.018),
           (0.52, 0.25, 0.155, 0.017), (0.66, 0.36, 0.140, 0.016), (0.80, 0.50, 0.105, 0.014)]
    cov = [(0.15, 0.08, 0.060, 0.013), (0.30, 0.16, 0.080, 0.014), (0.45, 0.25, 0.085, 0.014), (0.60, 0.36, 0.080, 0.013), (0.75, 0.50, 0.062, 0.012), (0.90, 0.66, 0.050, 0.010)]
    for side, nm in ((-1, "WingLeft"), (1, "WingRight")):
        pv = V((side * 0.035, 0, 0))
        piv = empty(nm, tuple(pv), root); objs.append(piv)
        mb = MB()
        P = [pv, V((side * 0.09, 0.040, -0.080)), V((side * 0.17, 0.085, -0.085)), V((side * 0.215, 0.050, 0.000))]
        for layer, (rows, N, yo) in enumerate(((prim, 7, 0.0), (sec, 6, 0.007), (cov, 6, 0.014))):
            for (u, th, L, w) in rows:
                th += 0.04 * rg.uniform(-1, 1); L *= 1 + 0.06 * rg.uniform(-1, 1)
                root_p = bez(*P, u) + V((0, yo, 0.0))
                pts = [root_p]; p = root_p
                for k in range(N):
                    tk = (k + 0.5) / N
                    ang = th * (1 - 0.30 * tk) + 0.12 * tk * tk * (1 if layer == 0 else 0.4)  # tips flick outward
                    d = norm(V((side * math.sin(ang), 0.10 * tk, math.cos(ang))))
                    p = p + d * (L / N); pts.append(p + V((0, 0.030 * tk * tk * (1.3 if layer == 0 else 0.7), 0)))
                nrs = [norm(V((-side * 0.18, 1, 0.05))) for _ in pts]
                feather(mb, pts, nrs, w, 0.0012, 0.15, "WingFeather", ss=(-1, 0, 1), prof=prof_wing if layer == 0 else prof_wing2,
                        asym=0.2, uvrange=(0.0, 1.0 if layer == 0 else 0.86))
        k = 0.272 / max(abs(p.x) for p in mb.v)
        for p in mb.v: p.x *= k  # keep the 0.544 m span contract
        objs.append(mb.build(nm + "Mesh", piv, origin=pv))
        print(nm, "tris", mb.tris(), "xmax", max(abs(p.x) for p in mb.v))
    fm = MB()
    for k, a in enumerate((-0.16, 0.0, 0.16)):
        d = norm(V((math.sin(a), 0.03, 1))); L = 0.13 - 0.03 * abs(k - 1)
        pts = [d * L * i / 6 for i in range(7)]
        feather(fm, pts, [V((0, 1, 0))] * 7, 0.008, 0.001, 0.2, "WingFlame", ss=(-1, 0, 1), prof=lambda t: (1 - t) ** 0.8 * math.sin(math.pi * min(t * 2.2 + 0.05, 1)) ** 0.5 + 0.05)
    objs.append(fm.build("EmberTrail", root))
    print("EmberTrail tris", fm.tris())
    return objs


# ------------------------------------------------------------------ export
def export(objs, fname):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT",
                              export_image_format="AUTO", export_extras=False)

def glb_report(fname):
    d = open(os.path.join(OUT, fname), "rb").read()
    ln = struct.unpack("<I", d[12:16])[0]; j = json.loads(d[20:20 + ln])
    tris = 0
    for m in j["meshes"]:
        for p in m["primitives"]:
            tris += j["accessors"][p["indices"]]["count"] // 3
    nodes = {n["name"]: n.get("translation") for n in j["nodes"]}
    prims = sum(len(m["primitives"]) for m in j["meshes"])
    print(f"REPORT {fname}: tris={tris} surfaces={prims} materials={len(j['materials'])} bytes={len(d)}")
    for n in ("Grip", "ArrowRest", "StringTop", "StringBottom", "ArrowNock", "ArrowTip", "WingLeft", "WingRight"):
        if n in nodes: print("   ", n, nodes[n])
    # world bounds from POSITION accessor mins/maxs (nodes at origin except wing meshes, informational)
    mn = [9e9] * 3; mx = [-9e9] * 3
    for m in j["meshes"]:
        for p in m["primitives"]:
            a = j["accessors"][p["attributes"]["POSITION"]]
            for k in range(3): mn[k] = min(mn[k], a["min"][k]); mx[k] = max(mx[k], a["max"][k])
    print("    local bounds min", [round(x, 3) for x in mn], "max", [round(x, 3) for x in mx])

if __name__ == "__main__":
    bow = build_bow(); arrow = build_arrow(); wings = build_wings()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "source.blend"))
    for objs, fn in ((bow, "bow.glb"), (arrow, "arrow.glb"), (wings, "wings.glb")):
        export(objs, fn); glb_report(fn)
