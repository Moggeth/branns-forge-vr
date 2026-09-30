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
def fold(t):  # mirrored v around a ring: seamless (no wrap seam) and keeps atlas regions valid
    return 1 - abs(2 * t - 1)
def norm(v):
    v = V(v); return v.normalized() if v.length > 1e-9 else v
def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0); return t * t * (3 - 2 * t)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ textures / materials
# All textures are deterministic numpy arrays (tileable FFT noise, no external files).  Array axes are (v rows, u cols).
def fnoise(H, W, seed, cu, cv):
    """Tileable smooth noise in [-1, 1]; cu / cv = low-pass cutoff in cycles across the image along u / v."""
    F = np.fft.fft2(np.random.RandomState(seed).randn(H, W))
    fy = np.fft.fftfreq(H)[:, None] * H; fx = np.fft.fftfreq(W)[None, :] * W
    n = np.fft.ifft2(F * np.exp(-((fx / cu) ** 2 + (fy / cv) ** 2))).real
    return n / max(np.abs(n).max(), 1e-9)

def smooth_np(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def grid(H, W):
    return np.linspace(0, 1, W, endpoint=False)[None, :] * np.ones((H, 1)), np.linspace(0, 1, H, endpoint=False)[:, None] * np.ones((1, W))

def ramp(u, keys):
    out = np.zeros(u.shape + (3,)); xs = [k[0] for k in keys]
    for c in range(3): out[..., c] = np.interp(u, xs, [k[1][c] for k in keys])
    return out

def mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]

def make_img(name, rgb, linear=False):
    H, W = rgb.shape[:2]
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((H, W, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = "Non-Color" if linear else "sRGB"
    return img

def orm(rough, metal=None, ao=None):
    z = np.zeros_like(rough)
    return np.stack([np.ones_like(rough) if ao is None else ao, rough, z if metal is None else metal], axis=-1)

def wood_maps():
    H, W = 256, 512; u, v = grid(H, W)
    rings = 0.5 + 0.5 * np.sin(2 * math.pi * (v * 7 + 0.35 * fnoise(H, W, 3, 2, 3) + 0.10 * fnoise(H, W, 5, 3, 8)))
    fibre = fnoise(H, W, 8, 5, 110); pores = np.clip(fnoise(H, W, 9, 40, 150) - 0.35, 0, 1)
    t = np.clip(0.42 * rings + 0.34 * (0.5 + 0.5 * fibre) + 0.12 * (0.5 + 0.5 * fnoise(H, W, 11, 3, 5)), 0, 1)
    col = mix(np.array((0.040, 0.019, 0.010)), np.array((0.205, 0.100, 0.044)), t) * (1 - 0.55 * pores[..., None])
    rough = np.clip(0.50 + 0.22 * (1 - t) + 0.10 * fibre + 0.25 * pores, 0.3, 0.9)
    return col, orm(rough, ao=1 - 0.5 * pores)

def leather_maps():
    H, W = 512, 256; u, v = grid(H, W)          # u tiles 6x along the grip, v is the half-circumference (mirrored)
    cell = smooth_np(0.55, 1.0, 1 - np.abs(fnoise(H, W, 21, 30, 22)))                       # pebbled hide, slightly stretched around the grip
    fibre = fnoise(H, W, 22, 6, 90)                                                        # fine creases running along the grip
    wear = smooth_np(0.1, 0.7, 0.5 + 0.5 * fnoise(H, W, 23, 3, 3))
    p = (u + 0.5 * v) % 1.0; d = np.abs(((p + 0.5) % 1.0) - 0.5)                            # distance to the helical wrap seam (one per tile)
    g = np.exp(-(d / 0.011) ** 2)                                                          # seam groove
    st = np.exp(-((d - 0.036) / 0.007) ** 2) * (np.sin(2 * math.pi * v * 26) > 0.35)       # stitch pits beside the seam
    ridge = np.exp(-((d - 0.028) / 0.010) ** 2)                                            # raised lip of the wrap
    h = 0.42 * cell + 0.12 * fibre + 0.10 * ridge - 0.75 * g - 0.35 * st + 0.10 * wear
    nx = -(np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 11.0; ny = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 11.0
    nn = np.sqrt(nx * nx + ny * ny + 1); nrm = np.stack([nx / nn, ny / nn, 1 / nn], -1) * 0.5 + 0.5
    raised = np.clip(0.35 + 0.55 * cell + 0.3 * wear - 0.7 * g - 0.3 * st, 0, 1)
    col = mix(np.array((0.042, 0.020, 0.010)), np.array((0.165, 0.084, 0.040)), raised) * (0.92 + 0.08 * fibre[..., None])
    col = mix(col, col * 0.55, np.clip(g + 0.5 * st, 0, 1))
    rough = np.clip(0.86 - 0.30 * raised * (0.5 + 0.5 * wear) + 0.12 * g, 0.4, 1.0)
    return col, orm(rough), nrm

def metal_maps():
    """One 512^2 atlas, three regions.  Gold feathers v .55-.95 (u = along the feather); brass fittings v .05-.45, u 0-.8; dark bronze v .05-.45, u .82-1."""
    H = W = 512; col = np.zeros((H, W, 3)) + np.array((0.2, 0.13, 0.06)); rough = np.full((H, W), 0.5); metal = np.full((H, W), 0.9)
    def put(y0, x0, c, r, m):
        h, w = r.shape; col[y0:y0 + h, x0:x0 + w] = c; rough[y0:y0 + h, x0:x0 + w] = r; metal[y0:y0 + h, x0:x0 + w] = m
    h, w = int(.4 * H), W; u, v = grid(h, w); vc = np.abs(v - 0.5) * 2
    base = ramp(u, [(0, (0.24, 0.13, 0.04)), (.14, (0.55, 0.33, 0.08)), (.45, (0.86, 0.60, 0.20)), (.85, (0.97, 0.75, 0.30)), (1, (1.0, 0.82, 0.42))])
    barb = 0.5 + 0.5 * np.sin(2 * math.pi * (u * 44 - vc * 8 + 0.30 * fnoise(h, w, 41, 8, 6)))
    blot = 0.5 + 0.5 * fnoise(h, w, 42, 7, 5); pat = smooth_np(0.55, 0.95, blot) * (1 - smooth_np(0.0, 0.7, u) * 0.4)
    c = base * (0.92 + 0.08 * barb[..., None]) * (0.90 + 0.18 * blot[..., None])
    c = mix(c, np.array((0.32, 0.20, 0.07)), 0.40 * pat)
    c = np.where((np.abs(v - 0.5) < 0.022)[..., None], np.clip(c * 1.18 + 0.03, 0, 1), c)          # rachis
    c = mix(c, np.clip(c * 1.16 + 0.02, 0, 1), smooth_np(0.86, 0.97, vc))                          # bright border
    c = mix(c, c * 0.5, np.exp(-((vc - 0.80) / 0.028) ** 2))                                       # engraved line inside the border
    put(int(.55 * H), 0, c, np.clip(0.36 + 0.10 * (1 - barb) + 0.20 * pat + 0.08 * blot, 0.25, 0.85), np.clip(0.85 - 0.30 * pat, 0.4, 1.0))
    h, w = int(.4 * H), int(.8 * W); u, v = grid(h, w)
    n1 = 0.5 + 0.5 * fnoise(h, w, 51, 6, 6); n2 = 0.5 + 0.5 * fnoise(h, w, 52, 18, 18)
    pat = smooth_np(0.50, 0.85, 0.6 * n1 + 0.4 * n2); scr = np.clip(fnoise(h, w, 53, 6, 120) - 0.45, 0, 1) * 3
    c = mix(np.array((0.74, 0.52, 0.19)) * (0.90 + 0.16 * n2[..., None]), np.array((0.30, 0.21, 0.08)), 0.75 * pat)
    put(int(.05 * H), 0, np.clip(c + scr[..., None] * 0.10, 0, 1), np.clip(0.26 + 0.38 * pat + 0.10 * n2 - 0.06 * scr, 0.18, 0.9), np.clip(0.92 - 0.40 * pat, 0.4, 1.0))
    h, w = int(.4 * H), W - int(.82 * W); u, v = grid(h, w)
    n1 = 0.5 + 0.5 * fnoise(h, w, 61, 5, 8); n2 = 0.5 + 0.5 * fnoise(h, w, 62, 14, 22)
    c = mix(np.array((0.115, 0.075, 0.040)), np.array((0.245, 0.165, 0.080)), 0.6 * n1 * n2 + 0.2)
    c = mix(c, np.array((0.06, 0.04, 0.025)), smooth_np(0.65, 0.95, n2) * 0.7)
    put(int(.05 * H), int(.82 * W), c, 0.36 + 0.28 * n2, np.full((h, w), 0.85))
    return col, orm(rough, metal)

def ember_map():
    H = W = 256; u, v = grid(H, W); vc = np.abs(v - 0.5) * 2
    c = ramp(u, [(0, (0.10, 0.020, 0.012)), (.22, (0.40, 0.060, 0.010)), (.50, (0.78, 0.21, 0.012)), (.70, (0.96, 0.40, 0.02)),
                 (.78, (1.0, 0.52, 0.08)), (.88, (0.80, 0.24, 0.02)), (.915, (0.22, 0.09, 0.03)), (.935, (0.03, 0.17, 0.80)), (1, (0.30, 0.62, 1.0))])
    barb = 0.5 + 0.5 * np.sin(2 * math.pi * (u * 32 - vc * 6 + 0.3 * fnoise(H, W, 71, 6, 5)))
    c = c * (0.80 + 0.20 * barb[..., None]) * (0.88 + 0.16 * (0.5 + 0.5 * fnoise(H, W, 72, 8, 6))[..., None])
    c = mix(c, c * np.array((0.55, 0.32, 0.15)), smooth_np(0.55, 0.98, vc) * (u < 0.9))     # dark rim -> reads as a recess
    return np.where((np.abs(v - 0.5) < 0.02)[..., None] & (u[..., None] < 0.9), np.clip(c * 1.25 + 0.03, 0, 1), c)

def make_mat(name, color=(1, 1, 1), metal=0.0, rough=0.5, emit=None, estr=1.0, tex=None, emit_tex=False, orm_img=None, normal=None):
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
    if orm_img is not None:  # glTF metallicRoughness: G = roughness, B = metallic
        o = nt.nodes.new("ShaderNodeTexImage"); o.image = orm_img
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(o.outputs["Color"], sp.inputs["Color"])
        nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
    if normal is not None:
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m

# 8 embedded images: wood bc+orm, leather bc+orm+normal, metal bc+orm (gold feathers, brass, dark bronze share one atlas), ember bc
_wc, _wo = wood_maps(); _lc, _lo, _ln = leather_maps(); _mc, _mo = metal_maps()
M = {
    "Wood": make_mat("Wood", tex=make_img("wood_bc", _wc), orm_img=make_img("wood_orm", _wo, True)),
    "Leather": make_mat("Leather", tex=make_img("leather_bc", _lc), orm_img=make_img("leather_orm", _lo, True), normal=make_img("leather_n", _ln, True)),
    "Brass": make_mat("Brass", tex=make_img("metal_bc", _mc), orm_img=make_img("metal_orm", _mo, True)),
    "Ember": make_mat("Ember", rough=0.55, tex=make_img("ember_bc", ember_map()), emit_tex=True, estr=0.5),
    "Eye": make_mat("EmberEye", (0.02, 0.16, 0.85), 0.0, 0.16, emit=(0.08, 0.42, 1.0), estr=0.6),
    "Steel": make_mat("Steel", (0.66, 0.69, 0.74), 1.0, 0.27),
    "AshShaft": make_mat("AshShaft", (0.46, 0.30, 0.15), 0.0, 0.55),
    "Fletch": make_mat("Fletch", (0.88, 0.80, 0.66), 0.0, 0.8),
}
if "--all" in argv:   # wings keep their original (unchanged) look
    def _wing(u, v):
        e = np.abs(v - 0.5) * 2
        c = ramp(u, [(0, (0.4, 0.08, 0.02)), (.3, (1, 0.36, 0.05)), (.65, (1, 0.6, 0.14)), (.85, (1, 0.82, 0.4)), (.93, (0.15, 0.55, 1.0)), (1, (0.6, 0.9, 1.0))])
        c = c * (1 - 0.35 * e[..., None] ** 3); c = c * (0.88 + 0.12 * (0.5 + 0.5 * np.sin(v * 70 + u * 9))[..., None])
        m = smooth_np(0.78, 1.0, e)[..., None]; c = c * (1 - m) + np.array((1.0, 0.72, 0.2)) * m
        return np.where((np.abs(v - 0.5) < 0.018)[..., None], np.clip(c * 1.25 + 0.06, 0, 1), c)
    _u, _v = grid(128, 256)
    M["WingFeather"] = make_mat("WingFeather", (0.5, 0.36, 0.3), 0.0, 0.5, tex=make_img("tex_wing", _wing(_u, _v)), emit_tex=True, estr=1.0)
    M["WingFlame"] = make_mat("WingFlame", (1.0, 0.45, 0.08), 0.0, 0.6, emit=(1.0, 0.5, 0.1), estr=3.0)
UV_HOT = (0.78, 0.5); UV_AZURE = (0.975, 0.5)  # special spots of the ember texture (heart / tip gems)

# Logical material names -> (real material, u scale, u offset, v scale, v offset): Gold / Brass / Bronze are regions of ONE metal atlas.
ALIAS = {"Gold": ("Brass", 1.0, 0.0, 0.4, 0.55), "Brass": ("Brass", 0.8, 0.0, 0.4, 0.05), "Bronze": ("Brass", 0.16, 0.82, 0.4, 0.05)}
def real_mat(n): return ALIAS[n][0] if n in ALIAS else n

# ------------------------------------------------------------------ mesh builder
class MB:
    def __init__(self, mirror=False):
        self.v, self.uv, self.f, self.fm = [], [], [], []
        self.mirror = mirror
    def vert(self, p, uv=(0.5, 0.5)):
        p = V(p)
        if self.mirror: p = V((p.x, -p.y, p.z))
        self.v.append(p); self.uv.append(uv); return len(self.v) - 1
    def face(self, idx, mat):
        if self.mirror: idx = idx[::-1]
        self.f.append(tuple(idx)); self.fm.append(mat)          # logical material NAME; slot index is resolved in build()
    def scale_x(self, k):
        for p in self.v: p.x *= k
    def tris(self):
        return sum(len(f) - 2 for f in self.f)
    def slot_order(self, slots=None):
        if slots: return list(slots)
        out = []
        for n in self.fm:
            if real_mat(n) not in out: out.append(real_mat(n))
        return out
    def build(self, name, parent=None, origin=(0, 0, 0), slots=None):
        me = bpy.data.meshes.new(name)
        o = V(origin)
        verts = [B(p - o) for p in self.v]
        me.from_pydata(verts, [], self.f)
        order = self.slot_order(slots)
        for s in order: me.materials.append(M[s])
        for n in self.fm:
            if real_mat(n) not in order: raise RuntimeError(f"{name}: face material {n} not in slots {order}")
        me.polygons.foreach_set("material_index", [order.index(real_mat(n)) for n in self.fm])   # FIX: each face's NAMED material -> OUTPUT slot
        me.polygons.foreach_set("use_smooth", [True] * len(self.f))
        uvl = me.uv_layers.new(name="UVMap")
        for poly, mname in zip(me.polygons, self.fm):
            uvs = [self.uv[vi] for vi in poly.vertices]
            wrap = max(t[1] for t in uvs) - min(t[1] for t in uvs) > 0.6  # tube seam: unwrap v across the seam
            uvs = [(t[0], t[1] + 1.0 if wrap and t[1] < 0.5 else t[1]) for t in uvs]
            if mname in ALIAS:
                _, ua, ub, va, vb = ALIAS[mname]; sh = math.floor(min(t[0] for t in uvs) + 1e-6)
                uvs = [((t[0] - sh) * ua + ub, min(max(t[1], 0.0), 1.0) * va + vb) for t in uvs]
            for li, uv in zip(poly.loop_indices, uvs): uvl.data[li].uv = uv
        me.update()
        print(f"  {name}: " + ", ".join(f"{s}={sum(len(f) - 2 for f, n in zip(self.f, self.fm) if real_mat(n) == s)}" for s in order))
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
            ring.append(mb.vert(p + radii[i] * (math.cos(ang) * a + math.sin(ang) * b * squash), (uscale * i / max(n - 1, 1), fold(j / sides))))
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
                               (uu[i] if isinstance(uu, (list, tuple)) else uu, fold(j / sides))))
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
                 thick=(0.0075, 0.0016), cup=0.20, gss=(-1, -0.5, 0, 0.5, 1), ulen=0.10, sweep=0.50):
    """One cambered swept feather: thick bronze-gold body (+ ember inlay on the player-facing face)."""
    root = sp.p(u) + X * side * 0.010 + sp.n(u) * zo
    pts, nrs = [root], [sp.n(u)]
    p = root
    for k in range(N):
        tk = (k + 0.5) / N; uu = min(u + tk * ulen, 1.0)
        a = ang * (1 - sweep * tk ** 1.4)
        d = norm(sp.t(uu) * math.cos(a) + X * side * math.sin(a))
        p = p + d * (L / N)
        nn = sp.n(uu)
        pts.append(p - nn * curl * tk * tk); nrs.append(nn)
    ym = max(q.y for q in pts)
    if ym > YMAX:
        k = (YMAX - root.y) / (ym - root.y); pts = [root + (q - root) * k for q in pts]
    feather(mbL, pts, nrs, w, thick, cup, "Gold", ss=gss, prof=prof_blade, uvrange=(0.0, 1.0))
    if ember:
        t0, t1 = thick
        pin = [q + n * (t0 + (t1 - t0) * i / N + 0.0005) for i, (q, n) in enumerate(zip(pts, nrs))][1:]
        feather(mbL, pin, nrs[1:], w * 0.56, (0.0012, 0.0008), cup, "Ember", ss=(-1, 0, 1),
                prof=lambda t: prof_blade(0.06 + 0.9 * t), asym=0.15, uvrange=(0.0, 1.0 if azure else 0.82))

def limb_feathers(sp, mbL, rg, side, scale):
    """Three masses with breathing room between them: a fanned shoulder (strongest feather at its heart), a looser mid mass whose
    longest primary is the sweep's leading edge, and a slim tip flick.  (u, angle, length, width, sweep)"""
    j = lambda: rg.uniform(-1, 1)
    A = [(0.085, 1.52, 0.150, 0.046, 0.30), (0.135, 1.34, 0.235, 0.058, 0.45), (0.190, 1.18, 0.290, 0.066, 0.62),   # 0.29 = strongest
         (0.245, 1.38, 0.185, 0.048, 0.35), (0.295, 1.06, 0.235, 0.052, 0.55)]
    Bm = [(0.405, 0.98, 0.265, 0.052, 0.60), (0.470, 0.76, 0.340, 0.060, 0.72), (0.545, 0.92, 0.210, 0.044, 0.40)]
    C = [(0.705, 0.66, 0.190, 0.038, 0.55), (0.775, 0.40, 0.135, 0.030, 0.30)]
    cov = [(0.115, 1.44, 0.11, 0.046), (0.215, 1.26, 0.13, 0.048), (0.445, 0.94, 0.14, 0.044), (0.515, 0.86, 0.115, 0.040)]
    back = [(0.12, 1.56, 0.20, 0.040), (0.36, 1.24, 0.19, 0.036), (0.64, 0.74, 0.12, 0.030)]
    spur = [(0.20, 0.95, 0.075, 0.024), (0.45, 0.80, 0.085, 0.024)]
    for grp in (A, Bm, C):
        for i, (u, a, L, w, sw) in enumerate(grp):
            big = L >= 0.285
            limb_feather(sp, mbL, side, u, a + 0.04 * j(), L * scale * (1 + 0.05 * j()), w, zo=-0.004, curl=0.02 + 0.05 * sw, sweep=sw,
                         azure=(grp is C and i == len(grp) - 1), N=9, thick=(0.0088, 0.0018) if big else (0.0075, 0.0016), cup=0.24 if big else 0.20)
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
    ps = [sp.p(0) - sp.t(0) * 0.016, sp.p(0.0), sp.p(0.028), sp.p(0.055)]
    tube(mb, ps, [r0 * 1.20, r0 * 1.26, r0 * 1.26, r0 * 1.04], "Brass", sides=12, ref=X, squash=1.65, caps=(True, True))
    for ub in (0.45, 0.75):
        seg = [ub - 0.015, ub - 0.008, ub + 0.008, ub + 0.015]; r = rad(ub)
        tube(mb, [sp.p(u) for u in seg], [r * 1.05, r * 1.22, r * 1.22, r * 1.05], "Brass", sides=12, ref=X, squash=sq, caps=(True, True))
    # seated string nock: grooved bronze fitting whose groove centre IS the StringTop/Bottom marker (spine end)
    pe, te = sp.p(1.0), sp.t(1.0)
    offs = [-0.024, -0.014, -0.006, 0.0, 0.006, 0.013, 0.019]
    rr = [0.0064, 0.0088, 0.0088, 0.0058, 0.0088, 0.0090, 0.0056]
    tube(mb, [pe + te * o for o in offs], rr, "Brass", sides=12, ref=X, squash=1.5, caps=(True, True))
    ellipsoid(mb, pe + te * 0.0195, (0.0048, 0.0048, 0.0048), "Ember", seg=8, rings=5, uv=UV_AZURE)
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
def ring_path(c, n, R, k=20):
    """Closed circle of radius R about centre c in the plane normal to n (for socket / heart rims)."""
    ax = norm(V(n).cross(YV)); ay = norm(V(n).cross(ax))
    return [V(c) + R * (math.cos(2 * math.pi * i / k) * ax + math.sin(2 * math.pi * i / k) * ay) for i in range(k + 1)]

def build_core(root):
    mb = MB()
    # chest / bridge, dark bronze: closes the top of the arrow window (underside y=0.134) and flows into the upper limb socket
    chest = [(0.134, 0.0, -0.018, 0.034, 0.0120), (0.142, 0.0, -0.021, 0.034, 0.0150), (0.156, 0.0, -0.030, 0.027, 0.0185),
             (0.175, 0.0, -0.040, 0.0205, 0.0195), (0.197, 0.0, -0.046, 0.0165, 0.0135)]
    loft(mb, chest, "Bronze", sides=20, n_exp=2.4, uu=0.5, caps=(True, True))
    # ember heart: a small deep-orange recess in a gold rim, low on the breast
    hp = V((0, 0.164, -0.0522)); hn = norm(V((0, -0.5, -0.86)))
    ellipsoid(mb, hp, (0.0072, 0.0090, 0.0030), "Ember", seg=10, rings=6, uv=UV_HOT)
    tube(mb, ring_path(hp + hn * 0.0004, hn, 0.0092), [0.0012] * 21, "Gold", sides=6, ref=X, caps=(False, False), uscale=1.0)
    # neck sweeps forward and up in dark bronze; a throat gorget of three small gold-edged ember scales keeps the ember restrained
    neck = cr([V((0, 0.170, -0.048)), V((0, 0.190, -0.070)), V((0, 0.208, -0.092)), V((0, 0.220, -0.106))], 3)
    nr = [0.0160 - 0.0035 * math.sin(math.pi * i / (len(neck) - 1)) for i in range(len(neck))]
    tube(mb, neck, nr, "Bronze", sides=12, ref=X, caps=(False, False), uscale=0.4)
    tng = norm(neck[-1] - neck[0]); front = norm(V((0, -tng.z, tng.y)) * -1)       # underside / throat direction
    for k, (f, L, w) in enumerate(((0.28, 0.036, 0.0125), (0.52, 0.032, 0.0115), (0.76, 0.028, 0.0100))):
        i = int(f * (len(neck) - 1)); base = neck[i] + front * (nr[i] * 0.90)
        d = norm(-tng * 0.85 + front * 0.30)
        pts = [base + d * L * q / 5 + front * 0.0025 * (q / 5) ** 2 for q in range(6)]
        nrf = [front] * 6
        feather(mb, pts, nrf, w, (0.0034, 0.0010), 0.25, "Gold", prof=prof_blade)
        feather(mb, [q + front * 0.0026 for q in pts[1:]], nrf[1:], w * 0.52, (0.0009, 0.0006), 0.2, "Ember", ss=(-1, 0, 1),
                prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0.15, 0.80))
    hc = V((0, 0.224, -0.114))
    ellipsoid(mb, hc, (0.0190, 0.0185, 0.0245), "Bronze", seg=14, rings=8)
    for s in (-1, 1):
        ellipsoid(mb, hc + V((s * 0.0140, -0.006, -0.008)), (0.0070, 0.0075, 0.0110), "Bronze", seg=8, rings=5)          # cheek volume
        ec = hc + V((s * 0.0150, 0.0020, -0.0125)); en = norm(V((s, 0.0, -0.30)))
        ellipsoid(mb, ec, (0.0042, 0.0042, 0.0044), "Eye", seg=10, rings=6)                                               # sapphire eye, set into a gold socket rim
        tube(mb, ring_path(ec + en * 0.0022, en, 0.0056), [0.0011] * 21, "Gold", sides=6, ref=X, caps=(False, False), uscale=1.0)
        brow = cr([hc + V((s * 0.0120, 0.0130, 0.0040)), hc + V((s * 0.0172, 0.0100, -0.0110)), hc + V((s * 0.0120, 0.0080, -0.0260)), hc + V((s * 0.0050, 0.0040, -0.0350))], 3)
        tube(mb, brow, [0.0038 - 0.0012 * i / (len(brow) - 1) for i in range(len(brow))], "Gold", sides=8, ref=YV, caps=(True, True), uscale=1.0)
        # cheek plumes sweep back along the neck and flow into the mantle
        for q, (dz, dy, L) in enumerate(((0.0, -0.002, 0.070), (0.006, -0.010, 0.052))):
            st = hc + V((s * 0.0160, dy, 0.004 + dz)); tgt = V((s * 0.030, 0.178 - 0.012 * q, -0.052 + 0.010 * q))
            d = norm(tgt - st)
            pts = [st + d * L * i / 6 + V((s * 0.006 * math.sin(math.pi * i / 6), 0.0, 0.0)) for i in range(7)]
            feather(mb, pts, [norm(V((s * 1.0, 0.35, 0.5)))] * 7, 0.0075 - 0.0015 * q, (0.0032, 0.0010), 0.24, "Gold", prof=prof_blade)
    beak = cr([hc + V((0, -0.002, -0.018)), hc + V((0, -0.001, -0.040)), hc + V((0, -0.010, -0.058)), hc + V((0, -0.030, -0.066))], 3)
    br = [0.0125 * (1 - i / (len(beak) - 1)) ** 0.8 + 0.0006 for i in range(len(beak))]
    tube(mb, beak, br, "Gold", sides=10, ref=X, caps=(True, True), squash=1.25, uscale=1.0)
    jaw = cr([hc + V((0, -0.011, -0.016)), hc + V((0, -0.014, -0.040)), hc + V((0, -0.022, -0.054))], 3)
    tube(mb, jaw, [0.0070 * (1 - i / (len(jaw) - 1)) ** 0.8 + 0.0005 for i in range(len(jaw))], "Bronze", sides=8, ref=X, caps=(True, True), uscale=1.0)
    # crest: three plume pairs sweeping up and back into the limb; the longest pair is gold with an ember inlay
    for k, (a, L) in enumerate(((0.28, 0.090), (0.62, 0.072), (1.02, 0.052))):
        for s in (-1, 1):
            st = hc + V((s * 0.005, 0.016, 0.004)); d = norm(V((s * math.sin(a) * 0.95, 0.88, 0.32)))
            pts = [st + d * L * i / 7 + V((0, -0.030 * (i / 7) ** 2 * L / 0.09, 0.034 * (i / 7) ** 2)) for i in range(8)]
            nrs = [V((s * 0.4, 0.3, 1.0))] * 8
            feather(mb, pts, nrs, 0.0100, (0.0040, 0.0010), 0.22, "Bronze" if k == 1 else "Gold", prof=prof_blade)
            if k == 0:
                feather(mb, [q + norm(V((s * 0.4, 0.3, 1.0))) * 0.0045 for q in pts[1:]], nrs[1:], 0.0056, (0.0010, 0.0007), 0.22, "Ember", ss=(-1, 0, 1),
                        prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0.1, 0.80))
    # mantle: thick cambered shoulder feathers sweeping out over the limb root
    for side in (-1, 1):
        for k in range(3):
            ang = 0.35 + 0.42 * k
            d = norm(V((side * math.cos(ang), 0.25 + 0.70 * math.sin(ang), 0.22)))
            L = (0.085, 0.100, 0.078)[k]
            st = V((side * 0.020, 0.152 + 0.014 * k, -0.040))
            pts = [st + d * L * i / 7 + V((0, 0, 0.020 * (i / 7) ** 2)) for i in range(8)]
            nr2 = [norm(V((0, 0.2, 1.0))) for _ in pts]
            feather(mb, pts, nr2, 0.0170, (0.0060, 0.0012), 0.22, "Gold", prof=prof_blade)
            feather(mb, [q + V((0, 0, 0.0056)) for q in pts[1:]], nr2[1:], 0.0092, (0.0012, 0.0008), 0.22, "Ember", ss=(-1, 0, 1),
                    prof=lambda t: prof_blade(0.06 + 0.9 * t), uvrange=(0, 0.82))
    print("PhoenixCore tris", mb.tris())
    return mb.build("PhoenixCore", root)

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
    jobs = [(build_bow(), "bow.glb")]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "source.blend"))
    for objs, fn in jobs:
        export(objs, fn); glb_report(fn)
    if "--all" in argv:
        # Preserve the installed conventional arrow and flight-wing art. They
        # use their frozen original atlas, not this bow's new metal materials.
        import runpy
        runpy.run_path(os.path.join(os.path.dirname(__file__), "flight_builder.py"), run_name="__main__")
