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
        th = (thick[0] + (thick[1] - thick[0]) * t) if isinstance(thick, (tuple, list)) else thick
        top, bot = [], []
        for k, s in enumerate(ss):
            lat = s * w * (1.0 if s > 0 else 1 - asym)
            cupv = cup * w * s * s
            h = th * (1 - 0.55 * abs(s)) if abs(s) < 1 else 0.0
            top.append(mb.vert(p + wv * lat + n * (h + cupv), (u, (s + 1) / 2)))
        for k, s in enumerate(ss):
            if abs(s) >= 1: bot.append(top[k]); continue
            lat = s * w * (1.0 if s > 0 else 1 - asym)
            bot.append(mb.vert(p + wv * lat + n * (-th * 0.5 * (1 - 0.5 * abs(s)) + cup * w * s * s), (u, (s + 1) / 2)))
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

# ------------------------------------------------------------------ BOW  (structural revision 3)
def bez(p0, p1, p2, p3, u):
    a = 1 - u
    return a**3 * p0 + 3 * a * a * u * p1 + 3 * a * u * u * p2 + u**3 * p3
def bezt(p0, p1, p2, p3, u):
    a = 1 - u
    return norm(3 * a * a * (p1 - p0) + 6 * a * u * (p2 - p1) + 3 * u * u * (p3 - p2))

import random
X = V((1, 0, 0)); YV = V((0, 1, 0)); ZV = V((0, 0, 1))
YMAX = 0.625
ARROW_Y = 0.115           # arrow line height (string nock point); ArrowRest = (0, ARROW_Y, 0.10)
def prof_blade(t):
    return min(1.0, t * 4.5) ** 0.6 * (1 - t ** 1.7) ** 0.85

class Spine:
    """Limb centreline in AUTHORING space (positive y; the lower limb is mirrored in y by its MB)."""
    def __init__(self, pts): self.P = [V(p) for p in pts]
    def p(self, u): return bez(*self.P, u)
    def t(self, u): return bezt(*self.P, u)
    def n(self, u):
        t = self.t(u); return norm(V((0, -t.z, t.y)))

SP_UP = Spine([(0, 0.170, -0.040), (0, 0.340, -0.140), (0, 0.550, -0.020), (0, 0.600, 0.100)])
SP_LO = Spine([(0, 0.100, -0.022), (0, 0.340, -0.150), (0, 0.550, -0.020), (0, 0.600, 0.100)])
PIV_UP = (0, 0.180, -0.045); PIV_LO = (0, -0.100, -0.022)

def cr(pts, n=4):
    """Catmull-Rom resample of a control polyline (n samples per span)."""
    P = [V(p) for p in pts]; out = []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]; p1 = P[i]; p2 = P[i + 1]; p3 = P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1]); return out

def face_out(mb, q, mat, c):
    vs = [mb.v[k] for k in q[:3]]
    cen = sum((mb.v[k] for k in q), V()) / len(q)
    nn = (vs[1] - vs[0]).cross(vs[2] - vs[0])
    mb.face(q if nn.dot(cen - c) > 0 else q[::-1], mat)

def loft(mb, rings, mats, sides=20, n_exp=2.4, uu=0.5, caps=(True, True), cap_mat=None):
    """Superellipse loft along +y.  rings: (y, cx, cz, rx, rz).  mats: str or per-segment list."""
    R = []
    ex = 2.0 / n_exp
    for i, (y, cx, cz, rx, rz) in enumerate(rings):
        row = []
        for j in range(sides):
            a = 2 * math.pi * j / sides; c, s = math.cos(a), math.sin(a)
            row.append(mb.vert(V((cx + rx * math.copysign(abs(c) ** ex, c), y, cz + rz * math.copysign(abs(s) ** ex, s))),
                               (uu[i] if isinstance(uu, (list, tuple)) else uu, j / sides)))
        R.append(row)
    for i in range(len(rings) - 1):
        m = mats if isinstance(mats, str) else mats[i]
        cc = V((rings[i][1] + rings[i + 1][1], rings[i][0] + rings[i + 1][0], rings[i][2] + rings[i + 1][2])) / 2
        for j in range(sides):
            face_out(mb, (R[i][j], R[i][(j + 1) % sides], R[i + 1][(j + 1) % sides], R[i + 1][j]), m, cc)
    for k, e in enumerate((0, len(rings) - 1)):
        if not caps[k]: continue
        y, cx, cz, rx, rz = rings[e]
        m = cap_mat or (mats if isinstance(mats, str) else mats[min(e, len(rings) - 2)])
        cen = V((cx, y, cz)); c = mb.vert(cen, (0.5, 0.5))
        inward = V((0, 1 if e == 0 else -1, 0))     # caps face away from the loft body
        for j in range(sides):
            q = (c, R[e][j], R[e][(j + 1) % sides])
            face_out(mb, q, m, cen + inward)
    return R

def box(mb, c, h, mat):
    c = V(c); idx = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                idx.append(mb.vert(c + V((sx * h[0], sy * h[1], sz * h[2])), (0.5, 0.5)))
    def vi(a, b, d): return idx[a * 4 + b * 2 + d]
    for q in (((0,0,0),(0,1,0),(0,1,1),(0,0,1)), ((1,0,0),(1,1,0),(1,1,1),(1,0,1)),
              ((0,0,0),(1,0,0),(1,0,1),(0,0,1)), ((0,1,0),(1,1,0),(1,1,1),(0,1,1)),
              ((0,0,0),(1,0,0),(1,1,0),(0,1,0)), ((0,0,1),(1,0,1),(1,1,1),(0,1,1))):
        face_out(mb, tuple(vi(*t) for t in q), mat, c)

# ---- limb feathers ---------------------------------------------------------------------------
def limb_feather(sp, mbL, side, u, ang, L, w, zo=0.0, curl=0.03, azure=False, ember=True, N=8,
                 thick=(0.0075, 0.0016), cup=0.20, gss=(-1, -0.5, 0, 0.5, 1), ulen=0.10):
    """One cambered swept feather: thick bronze-gold body (+ ember inlay on the player-facing face)."""
    root = sp.p(u) + X * side * 0.010 + sp.n(u) * zo
    pts, nrs = [root], [sp.n(u)]
    p = root
    for k in range(N):
        tk = (k + 0.5) / N; uu = min(u + tk * ulen, 1.0)
        a = ang * (1 - 0.50 * tk ** 1.4)
        d = norm(sp.t(uu) * math.cos(a) + X * side * math.sin(a))
        p = p + d * (L / N)
        nn = sp.n(uu)
        pts.append(p - nn * curl * tk * tk); nrs.append(nn)
    ym = max(q.y for q in pts)
    if ym > YMAX:
        k = (YMAX - root.y) / (ym - root.y); pts = [root + (q - root) * k for q in pts]
    feather(mbL, pts, nrs, w, thick, cup, "FeatherGold", ss=gss, prof=prof_blade, uvrange=(0.0, 1.0))
    if ember:
        t0, t1 = thick
        pin = [q + n * (t0 + (t1 - t0) * i / N + 0.0005) for i, (q, n) in enumerate(zip(pts, nrs))][1:]
        feather(mbL, pin, nrs[1:], w * 0.56, (0.0012, 0.0008), cup, "FeatherEmber", ss=(-1, 0, 1),
                prof=lambda t: prof_blade(0.06 + 0.9 * t), asym=0.15, uvrange=(0.0, 1.0 if azure else 0.82))

def limb_feathers(sp, mbL, rg, side, scale):
    """Three readable masses: shoulder, mid, tip.  (u, angle, length, width)"""
    j = lambda: rg.uniform(-1, 1)
    A = [(0.10, 1.48, 0.17, 0.052), (0.155, 1.38, 0.23, 0.060), (0.215, 1.26, 0.27, 0.062), (0.275, 1.13, 0.25, 0.054)]
    Bm = [(0.42, 1.02, 0.31, 0.058), (0.49, 0.92, 0.335, 0.058), (0.56, 0.82, 0.29, 0.050)]
    C = [(0.72, 0.62, 0.17, 0.040), (0.785, 0.52, 0.15, 0.034)]
    cov = [(0.13, 1.42, 0.12, 0.050), (0.20, 1.30, 0.14, 0.050), (0.46, 0.98, 0.15, 0.046), (0.53, 0.88, 0.15, 0.044), (0.75, 0.58, 0.09, 0.032)]
    back = [(0.12, 1.56, 0.20, 0.040), (0.36, 1.24, 0.19, 0.036), (0.64, 0.74, 0.12, 0.030)]
    spur = [(0.20, 0.95, 0.075, 0.024), (0.45, 0.80, 0.085, 0.024)]
    for grp in (A, Bm, C):
        for i, (u, a, L, w) in enumerate(grp):
            limb_feather(sp, mbL, side, u, a + 0.04 * j(), L * scale * (1 + 0.05 * j()), w, zo=-0.004, curl=0.045,
                         azure=(grp is C and i == len(grp) - 1), N=9)
    for u, a, L, w in cov:
        limb_feather(sp, mbL, side, u, a + 0.03 * j(), L * scale * (1 + 0.06 * j()), w, zo=0.011, curl=0.02, ember=False, N=6,
                     thick=(0.0055, 0.0014), cup=0.26)
    for u, a, L, w in back:   # layered underside feathers behind the main face
        limb_feather(sp, mbL, side, u, a + 0.03 * j(), L * scale, w, zo=-0.014, curl=0.03, ember=False, N=6,
                     thick=(0.0055, 0.0014), cup=0.12)
    for u, a, L, w in spur:   # short leading-edge spurs on the other side
        limb_feather(sp, mbL, -side, u, a, L, w, zo=0.0, curl=0.01, ember=False, N=5, thick=(0.0045, 0.0012))
    limb_feather(sp, mbL, side, 0.865, 0.14, 0.055, 0.010, zo=0.0, curl=0.0, azure=True, N=5, thick=(0.0035, 0.0012))

def build_limb(root, sign, name, sp, pivot, scale):
    lim = empty(name, pivot, root)
    rg = random.Random(11 if sign > 0 else 23)
    mb = MB(mirror=sign < 0)
    sq = 1.85
    U1 = 0.975
    us = [i / 18 * U1 for i in range(19)]
    rad = lambda u: 0.0115 - 0.0068 * u ** 0.85
    tube(mb, [sp.p(u) for u in us], [rad(u) for u in us], "Wood", sides=10, ref=X, squash=sq, caps=(True, True), uscale=3.0)
    # root sleeve: overlaps the riser socket 16 mm beyond the pivot so the joint never opens under +/-0.09 rad draw
    r0 = rad(0)
    ps = [sp.p(0) - sp.t(0) * 0.016, sp.p(0.0), sp.p(0.05), sp.p(0.10)]
    tube(mb, ps, [r0 * 1.26, r0 * 1.36, r0 * 1.36, r0 * 1.10], "Brass", sides=12, ref=X, squash=1.65, caps=(True, True))
    for ub in (0.45, 0.75):
        seg = [ub - 0.015, ub - 0.008, ub + 0.008, ub + 0.015]; r = rad(ub)
        tube(mb, [sp.p(u) for u in seg], [r * 1.05, r * 1.22, r * 1.22, r * 1.05], "Brass", sides=12, ref=X, squash=sq, caps=(True, True))
    # seated string nock: grooved bronze fitting whose groove centre IS the StringTop/Bottom marker (spine end)
    pe, te = sp.p(1.0), sp.t(1.0)
    offs = [-0.024, -0.014, -0.006, 0.0, 0.006, 0.013, 0.019]
    rr = [0.0064, 0.0088, 0.0088, 0.0058, 0.0088, 0.0090, 0.0056]
    tube(mb, [pe + te * o for o in offs], rr, "Brass", sides=12, ref=X, squash=1.5, caps=(True, True))
    ellipsoid(mb, pe + te * 0.0195, (0.0048, 0.0048, 0.0048), "FeatherEmber", seg=8, rings=5, uv=UV_AZURE)
    limb_feathers(sp, mb, rg, sign, scale)
    ob = mb.build(name + "Mesh", lim)
    print(name + "Mesh", "tris", mb.tris())
    return lim, ob

# ---- riser / grip ------------------------------------------------------------------------------
def build_grip(root):
    mb = MB()
    N = 36; rings, mats = [], []
    for i in range(N + 1):
        t = i / N; y = -0.0725 + 0.145 * t
        rx = 0.0150 + 0.0012 * math.sin(math.pi * t) + 0.0028 * smooth(0.80, 1.0, t) + 0.0016 * (1 - smooth(0.0, 0.14, t))
        rz = 0.0172 * (1 + 0.010 * math.cos(2 * math.pi * t * 3)) + 0.0016 * smooth(0.80, 1.0, t)
        cz = 0.0014 * math.sin(math.pi * t) ** 1.5 + 0.0010 * smooth(0.75, 1.0, t)     # palm swell towards the archer
        e = min(t, 1 - t)
        col = 1.0 + 0.11 * max(0.0, 1 - e / 0.03) ** 1.4 if e < 0.03 else 1.0
        rings.append((y, 0.0, cz, rx * col, rz * col)); mats.append("Brass" if e < 0.024 else "Leather")
    loft(mb, rings, mats[:-1], sides=22, n_exp=2.3, uu=[k / N * 6 for k in range(N + 1)], cap_mat="Brass")
    return mb.build("GripMesh", root, slots=["Leather", "Brass"])

def build_riser(root):
    mb = MB()
    # two side rails route the riser AROUND the arrow window; window = x +/-0.0175, y 0.078..0.134
    ctrl = [(0.009, 0.052, -0.003), (0.019, 0.078, -0.008), (0.027, 0.100, -0.013), (0.028, 0.124, -0.018), (0.022, 0.148, -0.028), (0.014, 0.162, -0.036)]
    rr = [0.0080, 0.0092, 0.0095, 0.0095, 0.0090, 0.0085]
    for s in (-1, 1):
        pts = cr([(s * x, y, z) for x, y, z in ctrl], 4)
        n = len(pts) - 1
        rad = [float(np.interp(i / n, [k / (len(rr) - 1) for k in range(len(rr))], rr)) for i in range(n + 1)]
        tube(mb, pts, rad, "Wood", sides=12, ref=ZV, squash=1.6, caps=(True, True), uscale=2.0)
        for a, b in ((0.05, 0.10), (0.82, 0.88)):      # brass rail collars either side of the window
            ia, ib = int(a * n), int(b * n)
            seg = pts[ia:ib + 1]
            rs = [rad[ia + k] * (1.28 if 0 < k < len(seg) - 1 else 1.05) for k in range(len(seg))]
            tube(mb, seg, rs, "Brass", sides=12, ref=ZV, squash=1.6, caps=(True, True))
    # arrow guide: small brass shelf BELOW the shaft (shaft r .0037; top = ARROW_Y - .0037 - .0045), bridging the rails
    top = ARROW_Y - 0.0037 - 0.0045
    box(mb, V((0, top - 0.0020, -0.012)), (0.0215, 0.0020, 0.018), "Brass")
    for s in (-1, 1):   # low lips keep the shaft centred on the shelf
        box(mb, V((s * 0.0075, top + 0.0009, -0.012)), (0.0011, 0.0009, 0.016), "Brass")
    # lower heel: grip -> lower limb socket
    heel = [(-0.128, 0.0, -0.025, 0.0150, 0.0100), (-0.104, 0.0, -0.018, 0.0170, 0.0130), (-0.086, 0.0, -0.006, 0.0178, 0.0170),
            (-0.0725, 0.0, 0.0, 0.0160, 0.0180), (-0.060, 0.0, 0.0, 0.0140, 0.0160)]
    loft(mb, heel, "Wood", sides=18, n_exp=2.3, uu=[0.2 * k for k in range(len(heel))], caps=(True, True))
    return mb.build("RiserMesh", root, slots=["Wood", "Brass"])

# ---- phoenix -----------------------------------------------------------------------------------
def build_core(root):
    mb = MB()
    # chest / bridge: closes the top of the arrow window (underside y=0.134, 5 mm above the arrow corridor) and flows into the upper limb socket
    chest = [(0.134, 0.0, -0.018, 0.034, 0.0120), (0.142, 0.0, -0.021, 0.034, 0.0150), (0.156, 0.0, -0.030, 0.027, 0.0185),
             (0.175, 0.0, -0.040, 0.0205, 0.0195), (0.197, 0.0, -0.046, 0.0165, 0.0135)]
    loft(mb, chest, "FeatherEmber", sides=20, n_exp=2.4, uu=0.30, caps=(True, True))
    ellipsoid(mb, V((0, 0.163, -0.060)), (0.0055, 0.0055, 0.0040), "FeatherEmber", seg=8, rings=5, uv=UV_AZURE)   # breast gem
    # neck sweeps forward and up, then blends into the skull
    neck = cr([V((0, 0.170, -0.048)), V((0, 0.190, -0.070)), V((0, 0.208, -0.092)), V((0, 0.220, -0.106))], 3)
    nr = [0.0165 - 0.0035 * math.sin(math.pi * i / (len(neck) - 1)) for i in range(len(neck))]
    tube(mb, neck, nr, "FeatherEmber", sides=12, ref=X, caps=(False, False), uscale=0.4)
    hc = V((0, 0.224, -0.114))
    ellipsoid(mb, hc, (0.0190, 0.0185, 0.0245), "FeatherEmber", seg=14, rings=8, uv=(0.42, 0.5))
    # cheek pads, sunk eyes and brow ridges that flow into the hooked beak
    for s in (-1, 1):
        ellipsoid(mb, hc + V((s * 0.0140, -0.006, -0.008)), (0.0070, 0.0075, 0.0110), "FeatherEmber", seg=8, rings=5, uv=(0.55, 0.5))
        ellipsoid(mb, hc + V((s * 0.0158, 0.0020, -0.0125)), (0.0044, 0.0044, 0.0046), "FeatherEmber", seg=8, rings=5, uv=UV_AZURE)
        brow = cr([hc + V((s * 0.0120, 0.0130, 0.0040)), hc + V((s * 0.0172, 0.0100, -0.0110)), hc + V((s * 0.0120, 0.0080, -0.0260)), hc + V((s * 0.0050, 0.0040, -0.0350))], 3)
        tube(mb, brow, [0.0038 - 0.0012 * i / (len(brow) - 1) for i in range(len(brow))], "FeatherGold", sides=8, ref=YV, caps=(True, True), uscale=1.0)
    beak = cr([hc + V((0, -0.002, -0.018)), hc + V((0, -0.001, -0.040)), hc + V((0, -0.010, -0.058)), hc + V((0, -0.030, -0.066))], 3)
    br = [0.0125 * (1 - i / (len(beak) - 1)) ** 0.8 + 0.0006 for i in range(len(beak))]
    tube(mb, beak, br, "FeatherGold", sides=10, ref=X, caps=(True, True), squash=1.25, uscale=1.0)
    jaw = cr([hc + V((0, -0.011, -0.016)), hc + V((0, -0.014, -0.040)), hc + V((0, -0.022, -0.054))], 3)
    tube(mb, jaw, [0.0070 * (1 - i / (len(jaw) - 1)) ** 0.8 + 0.0005 for i in range(len(jaw))], "FeatherGold", sides=8, ref=X, caps=(True, True), uscale=1.0)
    # crest: three plume pairs sweeping up and back, merging into the limb
    for k, (a, L) in enumerate(((0.28, 0.090), (0.62, 0.072), (1.02, 0.052))):
        for s in (-1, 1):
            st = hc + V((s * 0.005, 0.016, 0.004)); d = norm(V((s * math.sin(a) * 0.95, 0.88, 0.32)))
            pts = [st + d * L * i / 7 + V((0, -0.030 * (i / 7) ** 2 * L / 0.09, 0.034 * (i / 7) ** 2)) for i in range(8)]
            gold = (k + (s > 0)) % 2 == 0
            feather(mb, pts, [V((s * 0.4, 0.3, 1.0))] * 8, 0.0100, (0.0040, 0.0010), 0.22,
                    "FeatherGold" if gold else "FeatherEmber", prof=prof_blade, uvrange=(0, 1.0) if gold or k == 0 else (0, 0.82))
    # mantle: thick cambered shoulder feathers sweeping out over the limb root
    for side in (-1, 1):
        for k in range(3):
            ang = 0.35 + 0.42 * k
            d = norm(V((side * math.cos(ang), 0.25 + 0.70 * math.sin(ang), 0.22)))
            L = (0.085, 0.100, 0.078)[k]
            st = V((side * 0.020, 0.152 + 0.014 * k, -0.040))
            pts = [st + d * L * i / 7 + V((0, 0, 0.020 * (i / 7) ** 2)) for i in range(8)]
            nr2 = [norm(V((0, 0.2, 1.0))) for _ in pts]
            feather(mb, pts, nr2, 0.0170, (0.0060, 0.0012), 0.22, "FeatherGold", prof=prof_blade)
            feather(mb, [q + V((0, 0, 0.0056)) for q in pts[1:]], nr2[1:], 0.0092, (0.0012, 0.0008), 0.22, "FeatherEmber", ss=(-1, 0, 1),
                    prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0, 0.82 if k < 2 else 1.0))
    print("PhoenixCore tris", mb.tris())
    return mb.build("PhoenixCore", root, slots=["FeatherEmber", "FeatherGold"])

def build_bow():
    root = empty("Bow", (0, 0, 0))
    objs = [root]
    for n, p in (("Grip", (0, 0, 0)), ("ArrowRest", (0, ARROW_Y, 0.10)), ("ArrowGuide", (0, ARROW_Y, -0.012))):
        objs.append(empty(n, p, root))
    objs.append(build_grip(root)); objs.append(build_riser(root))
    up, upm = build_limb(root, 1, "UpperLimb", SP_UP, PIV_UP, 0.98)
    lo, lom = build_limb(root, -1, "LowerLimb", SP_LO, PIV_LO, 1.10)
    objs += [up, upm, empty("StringTop", (0, 0.60, 0.10), up), lo, lom, empty("StringBottom", (0, -0.60, 0.10), lo)]
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
    ALL = "--all" in argv     # arrow / wings are unchanged in this pass; only rebuilt with --all
    jobs = [(build_bow(), "bow.glb")]
    if ALL: jobs += [(build_arrow(), "arrow.glb"), (build_wings(), "wings.glb")]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "source.blend"))
    for objs, fn in jobs:
        export(objs, fn); glb_report(fn)
