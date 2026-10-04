"""Emberwing phoenix arrow with variants -- deterministic Blender (bpy) builder.

Run:  python3.11 arrow_builder.py -- --out ABS_DIR        (bpy module; `blender -b --python arrow_builder.py -- --out DIR` also works)
Authored in FINAL glTF coordinates (+Y up, arrow flies -Z, nock at origin, tip at z = -0.78) and converted with B().

GLB contract (all meshes are direct children of the root 'Arrow', identity transforms):
  ArrowNock (0,0,0), ArrowTip (0,0,-0.78)          sockets (unchanged)
  Shaft                                            shared: ash shaft + phoenix nock + spiral gold whipping + ember runes
  Head_0  leaf blade          steel leaf, gold ferrule, ember midrib inlay
  Head_1  phoenix beak        hooked barbed beak, crest fin on the ferrule, glowing ember eyes
  Head_2  flame-tongue bodkin slim twisted four-flanged bodkin, ember in the twisted grooves
  Fletch_0 swept flame (crimson -> orange)   Fletch_1 notched + barred (amber)
  Fletch_2 long tapered (gold)               Fletch_3 curled tip (crimson, sapphire tip)
Exactly one Head_* and one Fletch_* should be visible per arrow (the runtime toggles .visible by arrow id).
Every head's point is the vertex (0, 0, -0.78) == ArrowTip.  Every fletching lies in z [-0.20, -0.03].
"""
import bpy, sys, math, os, json, struct
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath(".")
os.makedirs(OUT, exist_ok=True)

V = Vector
def B(p): return (p[0], -p[2], p[1])                     # glTF -> Blender
def norm(v):
    v = V(v); return v.normalized() if v.length > 1e-9 else v
def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0); return t * t * (3 - 2 * t)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

TIP_Z = -0.78; R = 0.0037            # shaft radius (unchanged from the original arrow)
X = V((1, 0, 0)); Y = V((0, 1, 0)); Z = V((0, 0, 1))

# ------------------------------------------------------------------ textures (numpy, deterministic)
def fnoise(H, W, seed, cu, cv):
    F = np.fft.fft2(np.random.RandomState(seed).randn(H, W))
    fy = np.fft.fftfreq(H)[:, None] * H; fx = np.fft.fftfreq(W)[None, :] * W
    n = np.fft.ifft2(F * np.exp(-((fx / cu) ** 2 + (fy / cv) ** 2))).real
    return n / max(np.abs(n).max(), 1e-9)
def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def grid(H, W):
    return (np.linspace(0, 1, W, endpoint=False)[None, :] * np.ones((H, 1)), np.linspace(0, 1, H, endpoint=False)[:, None] * np.ones((1, W)))
def ramp(x, keys):
    out = np.zeros(x.shape + (3,)); xs = [k[0] for k in keys]
    for c in range(3): out[..., c] = np.interp(x, xs, [k[1][c] for k in keys])
    return out
def mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]
def make_img(name, rgb, linear=False):
    H, W = rgb.shape[:2]
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((H, W, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = "Non-Color" if linear else "sRGB"
    return img

# Shaft: u = along the shaft (0 = nock end z -0.004, 1 = head end z -0.728), v = around.  1024 x 32.
SH_Z0, SH_Z1 = -0.004, -0.728
def zu(z): return (z - SH_Z0) / (SH_Z1 - SH_Z0)
def shaft_tex():
    H, W = 32, 1024; u, v = grid(H, W)
    streak = fnoise(H, W, 3, 220, 3); fine = fnoise(H, W, 4, 600, 10); blot = 0.5 + 0.5 * fnoise(H, W, 5, 6, 2)
    t = np.clip(0.55 + 0.25 * streak + 0.12 * fine, 0, 1)
    col = mix(np.array((0.075, 0.032, 0.016)), np.array((0.30, 0.14, 0.06)), t) * (0.85 + 0.25 * blot[..., None])   # dark-stained ash
    def band(z0, z1, c, soft=0.0008):
        m = sm(zu(z0) - soft, zu(z0) + soft, u) * (1 - sm(zu(z1) - soft, zu(z1) + soft, u)) if zu(z0) < zu(z1) else 0 * u
        return mix(col, np.array(c), m)
    # charred halo behind the ember runes (z -0.235 .. -0.272), crest rings ahead of it: crimson | gold | crimson
    ch = sm(zu(-0.228), zu(-0.240), u) * (1 - sm(zu(-0.268), zu(-0.282), u))
    col = mix(col, np.array((0.018, 0.010, 0.008)) * (0.8 + 0.4 * blot[..., None]), 0.85 * ch)
    for z0, z1, c in ((-0.284, -0.288, (0.42, 0.04, 0.03)), (-0.2905, -0.2925, (0.85, 0.58, 0.20)), (-0.295, -0.299, (0.42, 0.04, 0.03))):
        col = band(z0, z1, c, 0.0003)
    # fire-darkened tip end under the ferrule and a soft scorch toward the nock
    col = col * (1 - 0.45 * sm(0.93, 1.0, u)[..., None]) * (1 - 0.35 * (1 - sm(0.0, 0.05, u))[..., None])
    return col

# Fletch atlas: 4 rows (v bands of .25); in each band u = along the vane (0 front .. 1 rear), s = radial (0 root .. 1 edge)
def fletch_tex():
    H = W = 256; u, v = grid(H, W)
    out = np.zeros((H, W, 3))
    row = np.minimum((v * 4).astype(int), 3); s = np.clip((v * 4 - row - 0.05) / 0.90, 0, 1)
    barbs = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 34 - s * 4.5 + 0.25 * fnoise(H, W, 11, 10, 10)))
    split = sm(0.86, 1.0, 0.5 + 0.5 * fnoise(H, W, 12, 40, 12)) * sm(0.35, 0.9, s)          # small splits in the vane
    rach = np.exp(-(s / 0.06) ** 2)
    keys = [
        [(0, (0.22, 0.015, 0.015)), (.30, (0.55, 0.04, 0.02)), (.62, (0.95, 0.24, 0.03)), (.86, (1.0, 0.55, 0.10)), (1, (1.0, 0.80, 0.32))],   # crimson -> orange flame
        [(0, (0.30, 0.09, 0.02)), (.35, (0.80, 0.34, 0.05)), (.75, (0.98, 0.56, 0.12)), (1, (1.0, 0.78, 0.30))],                           # amber
        [(0, (0.30, 0.13, 0.03)), (.30, (0.74, 0.40, 0.07)), (.70, (0.95, 0.64, 0.16)), (1, (1.0, 0.82, 0.38))],                            # gold
        [(0, (0.16, 0.01, 0.02)), (.40, (0.42, 0.02, 0.04)), (.80, (0.70, 0.07, 0.05)), (1, (0.85, 0.22, 0.10))],                          # deep crimson
    ]
    for r in range(4):
        m = row == r
        x = np.clip(0.55 * s + 0.45 * u, 0, 1) if r != 2 else np.clip(0.4 * s + 0.6 * u, 0, 1)
        c = ramp(x, keys[r])
        c = c * (0.78 + 0.22 * barbs[..., None])
        if r == 1:   # dark bars across the vane (barred feather)
            bars = sum(np.exp(-((u - b) / 0.035) ** 2) for b in (0.30, 0.52, 0.74))
            c = mix(c, np.array((0.14, 0.035, 0.012)), np.clip(bars, 0, 1) * 0.85 * sm(0.12, 0.3, s))
        if r == 3:   # sapphire tip on the rear outer corner, divided from the crimson by a fine gold line
            d = np.hypot((1 - u) / 0.24, (1 - s) / 0.62)
            c = mix(c, np.array((0.95, 0.70, 0.25)), np.exp(-((d - 1.0) / 0.07) ** 2) * 0.9)
            c = mix(c, ramp(np.clip(1 - d, 0, 1), [(0, (0.03, 0.14, 0.62)), (1, (0.20, 0.55, 1.0))]), sm(0.97, 0.90, d))
        c = mix(c, c * 0.65 + 0.02, split * 0.35)
        c = mix(c, np.array((1.0, 0.86, 0.50)), sm(0.93, 1.0, s) * 0.55)       # bright gilt edge
        c = mix(c, np.array((0.95, 0.80, 0.45)), rach * 0.7)                   # rachis along the shaft
        out[m] = c[m]
    return out

# Steel: dark fire-blued pattern-welded steel with bright worked edges (any UV works; u along the head, v across)
def steel_tex():
    H = W = 128; u, v = grid(H, W)
    wav = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 11 + 0.9 * fnoise(H, W, 31, 4, 4) + 0.5 * v))
    grain = 0.5 + 0.5 * fnoise(H, W, 32, 30, 60)
    c = mix(np.array((0.34, 0.34, 0.37)), np.array((0.47, 0.47, 0.50)), 0.55 * wav + 0.45 * grain)
    c = mix(c, c * np.array((0.75, 0.62, 0.95)), 0.35 * (1 - u))               # heat-blued toward the ferrule
    edge = sm(0.80, 0.98, np.abs(v - 0.5) * 2)
    return mix(c, np.array((0.86, 0.86, 0.88)), edge * 0.7)

def make_mat(name, color=(1, 1, 1), metal=0.0, rough=0.5, emit=None, estr=1.0, tex=None, emit_tex=False):
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
    return m

M = {
    "AshShaft": make_mat("AshShaft", rough=0.62, tex=make_img("arrow_shaft_bc", shaft_tex())),
    "Fletch": make_mat("Fletch", rough=0.78, tex=make_img("arrow_fletch_bc", fletch_tex()), emit_tex=True, estr=0.16),
    "Steel": make_mat("Steel", metal=1.0, rough=0.30, tex=make_img("arrow_steel_bc", steel_tex())),
    "Brass": make_mat("Brass", (0.86, 0.60, 0.22), 1.0, 0.28),
    "ArrowEmber": make_mat("ArrowEmber", (0.55, 0.10, 0.01), 0.0, 0.45, emit=(1.0, 0.36, 0.05), estr=1.0),
}

# ------------------------------------------------------------------ mesh builder
class MB:
    def __init__(self): self.v, self.uv, self.f, self.fm = [], [], [], []
    def vert(self, p, uv=(0.5, 0.5)):
        self.v.append(V(p)); self.uv.append(uv); return len(self.v) - 1
    def face(self, idx, mat): self.f.append(tuple(idx)); self.fm.append(mat)
    def face_dir(self, q, mat, want):
        a, b, c = (self.v[k] for k in q[:3]); n = (b - a).cross(c - a)
        if n.length < 1e-14 and len(q) == 4: a, b, c = (self.v[k] for k in (q[0], q[2], q[3])); n = (b - a).cross(c - a)
        self.face(q if n.dot(V(want)) >= 0 else q[::-1], mat)
    def tris(self): return sum(len(f) - 2 for f in self.f)
    def build(self, name, parent):
        me = bpy.data.meshes.new(name)
        me.from_pydata([B(p) for p in self.v], [], self.f)
        order = []
        for n in self.fm:
            if n not in order: order.append(n)
        for s in order: me.materials.append(M[s])
        me.polygons.foreach_set("material_index", [order.index(n) for n in self.fm])
        me.polygons.foreach_set("use_smooth", [True] * len(self.f))
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            uvs = [self.uv[vi] for vi in poly.vertices]
            wrap = max(t[1] for t in uvs) - min(t[1] for t in uvs) > 0.6
            for li, uv in zip(poly.loop_indices, uvs):
                uvl.data[li].uv = (uv[0], uv[1] + 1.0 if wrap and uv[1] < 0.5 else uv[1])
        me.update()
        me.set_sharp_from_angle(angle=math.radians(42))      # crisp ferrule beads, blade bevels, fin edges
        ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); ob.parent = parent
        print(f"  {name}: tris={self.tris()} " + ", ".join(f"{s}={sum(len(f) - 2 for f, n in zip(self.f, self.fm) if n == s)}" for s in order))
        return ob

def empty(name, p, parent=None):
    e = bpy.data.objects.new(name, None); e.empty_display_type = "PLAIN_AXES"; e.empty_display_size = 0.01
    scene.collection.objects.link(e); e.parent = parent; e.location = B(V(p)); return e

def tube(mb, pts, radii, mat, sides=8, ref=X, caps=(True, True), squash=1.0, uv_u=(0.0, 1.0), twist=0.0, star=None, tip_point=None):
    """Ring tube along pts.  star: per-ring radius multipliers for alternate verts (flanged cross-sections).
    tip_point: replace the last ring by this single vertex (exact point)."""
    n = len(pts); rings = []
    for i, p in enumerate(pts):
        p = V(p); t = norm(V(pts[min(i + 1, n - 1)]) - V(pts[max(i - 1, 0)]))
        a = norm(t.cross(ref)); b = t.cross(a); ring = []
        if tip_point is not None and i == n - 1:
            rings.append([mb.vert(tip_point, (uv_u[1], 0.5))] * sides); continue
        for j in range(sides):
            ang = 2 * math.pi * j / sides + twist * i / max(n - 1, 1)
            rr = radii[i] * (star[i] if (star is not None and j % 2) else 1.0)
            ring.append(mb.vert(p + rr * (math.cos(ang) * a + math.sin(ang) * b * squash), (uv_u[0] + (uv_u[1] - uv_u[0]) * i / max(n - 1, 1), j / sides)))
        rings.append(ring)
    for i in range(n - 1):
        cen = (V(pts[i]) + V(pts[i + 1])) / 2
        for j in range(sides):
            q = (rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j])
            if q[2] == q[3]: q = q[:3]
            out = (sum((mb.v[k] for k in q), V()) / len(q)) - cen
            mb.face_dir(q, mat, out)
    for k, (end, sgn) in enumerate(((0, -1), (n - 1, 1))):
        if not caps[k] or (tip_point is not None and end == n - 1): continue
        c = mb.vert(pts[end], (uv_u[0], 0.5)); r = rings[end]
        tng = norm(V(pts[min(end + 1, n - 1)]) - V(pts[max(end - 1, 0)])) * sgn
        for j in range(sides): mb.face_dir((c, r[j], r[(j + 1) % sides]), mat, tng)
    return rings

def ellipsoid(mb, c, r, mat, seg=6, rings=4, uv=(0.5, 0.5)):
    c = V(c); idx = []
    top = mb.vert(c + V((0, r[1], 0)), uv)
    for i in range(1, rings):
        ph = math.pi * i / rings
        idx.append([mb.vert(c + V((r[0] * math.sin(ph) * math.cos(2 * math.pi * j / seg), r[1] * math.cos(ph), r[2] * math.sin(ph) * math.sin(2 * math.pi * j / seg))), uv) for j in range(seg)])
    bot = mb.vert(c - V((0, r[1], 0)), uv)
    def add(q): mb.face_dir(q, mat, sum((mb.v[k] for k in q), V()) / len(q) - c)
    for j in range(seg):
        add((top, idx[0][(j + 1) % seg], idx[0][j])); add((bot, idx[-1][j], idx[-1][(j + 1) % seg]))
    for i in range(len(idx) - 1):
        for j in range(seg): add((idx[i][j], idx[i][(j + 1) % seg], idx[i + 1][(j + 1) % seg], idx[i + 1][j]))

def ribbon(mb, pts, nrs, w, mat, lift=0.0001, raise_=0.0001, prof=None, uv=(0.5, 0.5)):
    """One-sided strip lying on a surface (normals nrs): edge / raised centre / edge, 4 tris per segment."""
    N = len(pts) - 1; rows = []
    for i, p in enumerate(pts):
        t = norm(V(pts[min(i + 1, N)]) - V(pts[max(i - 1, 0)])); n = norm(V(nrs[i]) - t * V(nrs[i]).dot(t)); s = norm(n.cross(t))
        ww = w * (prof(i / N) if prof else 1.0)
        rows.append([mb.vert(V(p) + n * lift - s * ww, uv), mb.vert(V(p) + n * (lift + raise_), uv), mb.vert(V(p) + n * lift + s * ww, uv)])
    for i in range(N):
        for k in range(2): mb.face_dir((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]), mat, nrs[i])

def onshaft(z, ang, lift=0.0):
    rd = V((math.cos(ang), math.sin(ang), 0)); return V((0, 0, z)) + rd * (R + lift), rd

# ------------------------------------------------------------------ SHAFT (shared)
def build_shaft(root):
    mb = MB()
    zs = [-0.004, -0.030, -0.20, -0.30, -0.50, -0.722]   # ends inside every ferrule
    # explicit per-ring u so the shaft texture maps 1:1 to z
    n = len(zs); rings = []
    for z in zs:
        rings.append([mb.vert(V((R * math.cos(2 * math.pi * j / 10), R * math.sin(2 * math.pi * j / 10), z)), (zu(z), j / 10)) for j in range(10)])
    for i in range(n - 1):
        for j in range(10):
            q = (rings[i][j], rings[i][(j + 1) % 10], rings[i + 1][(j + 1) % 10], rings[i + 1][j])
            mb.face_dir(q, "AshShaft", V((math.cos(2 * math.pi * (j + .5) / 10), math.sin(2 * math.pi * (j + .5) / 10), 0)))
    c = mb.vert(V((0, 0, zs[-1])), (1.0, 0.5))
    for j in range(10): mb.face_dir((c, rings[-1][j], rings[-1][(j + 1) % 10]), "AshShaft", V((0, 0, -1)))
    # phoenix nock: a brass collar that swells into two prongs around the string slot (slot along Y, string rides at the origin)
    tube(mb, [V((0, 0, z)) for z in (-0.034, -0.026, -0.018, -0.010, -0.0065)], [R * 1.03, R * 1.22, R * 1.32, R * 1.38, R * 1.42], "Brass", sides=10, caps=(False, True))
    for s in (-1, 1):
        prong = [V((s * 0.0030, 0, -0.0068)), V((s * 0.0031, 0, -0.0035)), V((s * 0.0026, 0, 0.0008))]
        tube(mb, prong, [0.0021, 0.0019, 0.0011], "Brass", sides=6, ref=Y, squash=2.1, caps=(False, True))
    tube(mb, [V((0, 0, z)) for z in (-0.0225, -0.0215, -0.0205)], [R * 1.30, R * 1.36, R * 1.30], "ArrowEmber", sides=10, caps=(False, False))   # ember ring
    # spiral gold whipping just ahead of the fletching: 3.5 turns, fine wire
    nturn, per = 3.5, 9; zs0, zs1 = -0.205, -0.226; pts = []
    for i in range(int(nturn * per) + 1):
        f = i / (nturn * per); a = 2 * math.pi * nturn * f
        pts.append(V((math.cos(a) * (R + 0.0004), math.sin(a) * (R + 0.0004), zs0 + (zs1 - zs0) * f)))
    tube(mb, pts, [0.00055] * len(pts), "Brass", sides=4, ref=Z, caps=(True, True))
    # ember-filled runes burnt into the charred band: four phoenix-tail glyphs around the shaft
    for g in range(4):
        a0 = math.pi / 4 + g * math.pi / 2
        zc = -0.254 + (0.004 if g % 2 else -0.004)
        def P(da, dz): return onshaft(zc + dz, a0 + da / R, 0.00008)
        strokes = [[(0.0, 0.009), (0.0, -0.009)],                                   # stem
                   [(0.0, -0.002), (-0.0028, -0.0085)], [(0.0, -0.002), (0.0028, -0.0085)],   # tail flare toward the nock
                   [(0.0, 0.004), (-0.0022, 0.0085)] if g % 2 else [(0.0, 0.004), (0.0022, 0.0085)]]
        for st in strokes:
            pp, nn = [], []
            for k in range(3):
                f = k / 2; da = st[0][0] + (st[1][0] - st[0][0]) * f; dz = st[0][1] + (st[1][1] - st[0][1]) * f
                p, rd = P(da, dz); pp.append(p); nn.append(rd)
            ribbon(mb, pp, nn, 0.00042, "ArrowEmber", lift=0.00005, raise_=0.00006)
    return mb.build("Shaft", root)

# ------------------------------------------------------------------ HEADS
def ferrule(mb, z0, z1, r0, r1, bead=True):
    zs = [z0, z0 - 0.0015, z0 - 0.003, (z0 + z1) / 2, z1]
    rs = [R * 1.05, r0 * 1.12 if bead else r0, r0, (r0 + r1) / 2, r1]
    tube(mb, [V((0, 0, z)) for z in zs], rs, "Brass", sides=10, caps=(True, True))

def head_leaf(root):
    mb = MB(); ferrule(mb, -0.709, -0.733, 0.0048, 0.0041)
    z0, L = -0.731, TIP_Z + 0.731     # blade from z0 to the tip (L negative)
    N = 11; rows = []
    for i in range(N + 1):
        t = i / N; z = z0 + L * t
        w = 0.0090 * math.sin(math.pi * min(0.10 + t ** 0.85 * 0.95, 1.0)) ** 0.85 * (1 - t ** 4) + 0.0026 * (1 - smooth(0.0, 0.25, t))
        th = 0.0019 * (1 - t ** 1.5) + 0.0002; bev = 0.55
        if i == N:
            rows.append([mb.vert(V((0, 0, TIP_Z)), (1.0, 0.5))] * 8); continue
        ring = [V((w, 0, z)), V((w * bev, th * 0.55, z)), V((0, th, z)), V((-w * bev, th * 0.55, z)), V((-w, 0, z)),
                V((-w * bev, -th * 0.55, z)), V((0, -th, z)), V((w * bev, -th * 0.55, z))]
        vs = [0.0, 0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25]
        rows.append([mb.vert(p, (t, vv)) for p, vv in zip(ring, vs)])
    for i in range(N):
        a, b = rows[i], rows[i + 1]
        for j in range(8):
            q = (a[j], a[(j + 1) % 8], b[(j + 1) % 8], b[j])
            if q[2] == q[3]: q = q[:3]
            out = sum((mb.v[k] for k in q), V()) / len(q) - V((0, 0, mb.v[q[0]].z))
            mb.face_dir(q, "Steel", out)
    c = mb.vert(V((0, 0, z0)), (0, 0.5))
    for j in range(8): mb.face_dir((c, rows[0][j], rows[0][(j + 1) % 8]), "Steel", V((0, 0, 1)))
    # ember midrib inlay on both faces + a tiny ember diamond on the ferrule
    for s in (1, -1):
        pts = []; nrs = []
        for k in range(7):
            t = 0.08 + 0.62 * k / 6; z = z0 + L * t; th = 0.0019 * (1 - t ** 1.5) + 0.0002
            pts.append(V((0, s * th, z))); nrs.append(V((0, s, 0)))
        ribbon(mb, pts, nrs, 0.0007, "ArrowEmber", lift=0.00015, raise_=0.00005, prof=lambda t: 1 - 0.8 * t)
    for s in (1, -1):
        ellipsoid(mb, V((0, s * 0.0046, -0.7225)), (0.0011, 0.0006, 0.0018), "ArrowEmber", seg=4, rings=3)
    return mb.build("Head_0", root)

def fin(mb, rf, rr, tip, th, mat, up, n=3, bow=0.0):
    """Closed thick triangular plate (root-front rf, root-rear rr, tip), thickness th at the root tapering to the tip, along `up`.
    bow: sideways bulge of the leading edge (swept, curved barbs)."""
    up = norm(up); rows = []
    for i in range(n + 1):
        f = i / n; k = th * (1 - f) + 0.00012
        lead = rf + (tip - rf) * f + norm(tip - rr) * 0 + (tip - rr).normalized().cross(up) * 0 + V((0, 0, -bow * math.sin(math.pi * f)))
        trail = rr + (tip - rr) * f
        rows.append([mb.vert(lead + up * k * 0.5, (f, 0)), mb.vert(trail + up * k * 0.5, (f, 1)), mb.vert(trail - up * k * 0.5, (f, 1)), mb.vert(lead - up * k * 0.5, (f, 0))])
    cen = (rf + rr + tip) / 3
    for i in range(n):
        for j in range(4):
            q = (rows[i][j], rows[i][(j + 1) % 4], rows[i + 1][(j + 1) % 4], rows[i + 1][j])
            mb.face_dir(q, mat, sum((mb.v[x] for x in q), V()) / 4 - cen)
    mb.face_dir(tuple(rows[0]), mat, rf + rr - 2 * tip)

def head_beak(root):
    mb = MB(); ferrule(mb, -0.709, -0.736, 0.0050, 0.0046)
    # phoenix crest: a swept brass fin rising off the ferrule, raking back toward the nock
    fin(mb, V((0, 0.0042, -0.733)), V((0, 0.0045, -0.716)), V((0, 0.0105, -0.709)), 0.0011, "Brass", X, n=3)
    # hooked upper mandible: the top line humps and hooks down onto the exact tip point; the cutting line underneath stays straight
    spine = [V((0, 0.0000, -0.735)), V((0, 0.0020, -0.746)), V((0, 0.0034, -0.757)), V((0, 0.0033, -0.766)),
             V((0, 0.0019, -0.7730)), V((0, 0.0007, -0.7775))]
    rad = [0.0050, 0.0057, 0.0051, 0.0039, 0.0024, 0.0010]
    tube(mb, spine + [V((0, 0, TIP_Z))], rad + [0.0], "Steel", sides=8, squash=0.62, caps=(True, False), tip_point=V((0, 0, TIP_Z)))
    # swept barbs flaring from the cheeks back toward the nock (read as the beak's open gape / wing flares)
    for s in (1, -1):
        fin(mb, V((s * 0.0024, -0.0006, -0.7635)), V((s * 0.0028, -0.0010, -0.7480)), V((s * 0.0128, -0.0018, -0.7385)), 0.0016, "Steel", Y, n=4, bow=0.0022)
    # glowing ember eyes set into the beak's sides, each with a swept ember brow line
    for s in (1, -1):
        ellipsoid(mb, V((s * 0.0031, 0.0030, -0.7470)), (0.0011, 0.0011, 0.0017), "ArrowEmber", seg=6, rings=4)
        ribbon(mb, [V((s * 0.0033, 0.0046, -0.7500)), V((s * 0.0036, 0.0048, -0.7445)), V((s * 0.0036, 0.0044, -0.7395))],
               [V((s, 0.5, 0))] * 3, 0.00035, "ArrowEmber", lift=0.0001, raise_=0.00005, prof=lambda t: 1 - 0.7 * t)
    return mb.build("Head_1", root)

def head_bodkin(root):
    mb = MB(); ferrule(mb, -0.711, -0.731, 0.0045, 0.0042, bead=True)
    N = 14; z0 = -0.729; pts, rad, star = [], [], []
    for i in range(N):
        t = i / N; z = z0 + (TIP_Z - z0) * t
        r = (0.0040 + 0.0011 * math.sin(math.pi * min(t / 0.45, 1.0))) * (1 - t) ** 0.9 + 0.0001
        r *= 1 + 0.10 * math.sin(3 * math.pi * t)          # licking-flame waviness of the flanges
        pts.append(V((0, 0, z))); rad.append(r); star.append(0.42 + 0.10 * t)
    pts.append(V((0, 0, TIP_Z))); rad.append(0.0); star.append(1.0)
    tw = 1.5
    tube(mb, pts, rad, "Steel", sides=8, caps=(True, False), twist=tw, star=star, tip_point=V((0, 0, TIP_Z)))
    # ember in two of the four twisted grooves (grooves sit at odd verts: angle (2j+1)*pi/4 + twist)
    for g in (1, 5):
        pp, nn = [], []
        for i in range(1, 11):
            t = i / N; a = 2 * math.pi * g / 8 + tw * i / N; r = rad[i] * star[i]
            rd = V((-math.sin(a), -math.cos(a), 0)); pp.append(pts[i] + rd * r); nn.append(rd)   # tube ring basis for a -Z axis
        ribbon(mb, pp, nn, 0.00045, "ArrowEmber", lift=0.0001, raise_=0.00005, prof=lambda t: 1 - 0.75 * t)
    return mb.build("Head_2", root)

# ------------------------------------------------------------------ FLETCHINGS
def vane(mb, a0, zf, zr, hfun, row, nt=12, ss=(0.0, 0.35, 0.7, 1.0), sweep=0.0, curl=0.0, twist=0.10, th=0.00045):
    """One two-sided feather vane on the shaft at angle a0.  t = 0 front (zf) .. 1 rear (zr); s = 0 root .. 1 edge.
    sweep: rearward (+z) shift of the outer edge;  curl: tangential roll of the rear outer corner (radians)."""
    T, Bt = [], []
    for i in range(nt + 1):
        t = i / nt; z = zf + (zr - zf) * t; h = max(hfun(t), 0.0005)
        top, bot = [], []
        for s in ss:
            r = R + 0.00015 + s * h; zz = z + sweep * s * s * smooth(0.0, 0.4, t)
            ang = a0 + twist * t + curl * s * s * smooth(0.45, 1.0, t)
            rd = V((math.cos(ang), math.sin(ang), 0)); tg = V((-math.sin(ang), math.cos(ang), 0))
            p = V((0, 0, zz)) + rd * r; uv = (t, row * 0.25 + 0.0125 + s * 0.225)
            k = th * (1 - 0.8 * s)
            if s >= 1.0:
                vi = mb.vert(p, uv); top.append(vi); bot.append(vi)
            else:
                top.append(mb.vert(p + tg * k, uv)); bot.append(mb.vert(p - tg * k, uv))
        T.append((top, tg)); Bt.append(bot)
    for i in range(nt):
        tg = T[i][1]
        for k in range(len(ss) - 1):
            mb.face_dir((T[i][0][k], T[i][0][k + 1], T[i + 1][0][k + 1], T[i + 1][0][k]), "Fletch", tg)
            mb.face_dir((Bt[i][k], Bt[i][k + 1], Bt[i + 1][k + 1], Bt[i + 1][k]), "Fletch", -tg)

def wraps(mb, zs):
    for z in zs:
        tube(mb, [V((0, 0, z + 0.0018)), V((0, 0, z)), V((0, 0, z - 0.0018))], [R * 1.03, R * 1.20, R * 1.03], "Brass", sides=10, caps=(False, False))

ANGLES = (math.pi / 2, math.pi / 2 + 2 * math.pi / 3, math.pi / 2 + 4 * math.pi / 3)   # cock feather up (+Y)

def fletch(root, idx):
    mb = MB()
    if idx == 0:    # swept flame: rises to a high rear crest, edge licks back toward the nock in two tongues
        zf, zr = -0.170, -0.048
        hf = lambda t: 0.0138 * smooth(0.0, 0.78, t) ** 0.85 * (1 - 0.80 * smooth(0.84, 1.0, t)) + 0.0017 * math.sin(3 * math.pi * t) * t
        for a in ANGLES: vane(mb, a, zf, zr, hf, 0, nt=14, sweep=0.022, twist=0.12)
    elif idx == 1:  # notched shield cut, barred
        zf, zr = -0.162, -0.052
        def hf(t):
            h = 0.0124 * (0.25 + 0.75 * smooth(0.0, 0.32, t)) * (1 - 0.15 * smooth(0.92, 1.0, t))
            for tn in (0.42, 0.66): h -= 0.0050 * max(0.0, 1 - abs(t - tn) / 0.055)
            return h
        for a in ANGLES: vane(mb, a, zf, zr, hf, 1, nt=16, sweep=0.004, twist=0.08)
    elif idx == 2:  # long, low, tapered
        zf, zr = -0.196, -0.040
        hf = lambda t: 0.0108 * t ** 1.25 * (1 - 0.55 * smooth(0.90, 1.0, t)) + 0.0006
        for a in ANGLES: vane(mb, a, zf, zr, hf, 2, nt=14, sweep=0.010, twist=0.10)
    else:           # curled tip, crimson with a sapphire tip
        zf, zr = -0.166, -0.048
        hf = lambda t: 0.0132 * math.sin(math.pi * min(0.06 + 0.62 * t, 1.0)) ** 0.75 * (1 - 0.25 * smooth(0.9, 1.0, t))
        for a in ANGLES: vane(mb, a, zf, zr, hf, 3, nt=14, sweep=0.012, curl=0.55, twist=0.10)
    wraps(mb, (zf - 0.0030, zr + 0.0030))
    return mb.build(f"Fletch_{idx}", root)

# ------------------------------------------------------------------ assemble / export
def build_arrow():
    root = empty("Arrow", (0, 0, 0)); objs = [root]
    objs.append(empty("ArrowNock", (0, 0, 0), root)); objs.append(empty("ArrowTip", (0, 0, TIP_Z), root))
    objs.append(build_shaft(root))
    objs += [head_leaf(root), head_beak(root), head_bodkin(root)]
    objs += [fletch(root, i) for i in range(4)]
    return objs

def export(objs, fname):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT",
                              export_image_format="AUTO", export_extras=False)

if __name__ == "__main__":
    objs = build_arrow()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "arrow-source.blend"))
    export(objs, "arrow.glb")
    print("WROTE", os.path.join(OUT, "arrow.glb"), os.path.getsize(os.path.join(OUT, "arrow.glb")), "bytes")
