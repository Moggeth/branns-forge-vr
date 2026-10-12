"""Emberwing phoenix bird -- deterministic Blender (bpy) builder for multiplayer/public/assets/wings.glb.

Run:  python3.11 phoenix_builder.py -- --out ABS_DIR
      (bpy as a module; `blender -b --python phoenix_builder.py -- --out DIR` also works)

Authored in FINAL glTF coordinates: metres, +Y up, the bird flies -Z (nose forward), origin at the
arrow shaft under the bird's belly, between the shoulders.

GLB contract (the game's combat-view.js poses this):
  root 'Wings'
    Body        head + beak + crest + body + tail streamers + tail flame   (one mesh)
    WingLeft    empty AT THE LEFT SHOULDER  -> WingLeftMesh   (verts local, wing runs local -X)
    WingRight   empty AT THE RIGHT SHOULDER -> WingRightMesh  (verts local, wing runs local +X)
  The client flaps each wing about its LOCAL Z (+-1.05 rad), so the furthest vertex from each wing
  origin must be its outer pinion tip (contrails stream from there).
Materials: 'Ember' (one 256x256 atlas used as base colour AND emission) and 'EmberFlame' (solid emissive).
"""
import bpy, sys, math, os
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
def lerp(a, b, t): return V(a) * (1 - t) + V(b) * t

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
X = V((1, 0, 0)); Y = V((0, 1, 0)); Z = V((0, 0, 1))

# ------------------------------------------------------------------ texture atlas (numpy, deterministic)
ROWS = 8                                   # eight v-bands of 1/8
def row_uv(row, u, s):                     # u along the part, s across it (0..1) -> atlas uv
    return (min(max(u, 0.004), 0.996), (row + 0.03 + 0.94 * min(max(s, 0.0), 1.0)) / ROWS)

def fnoise(H, W, seed, cu, cv):
    F = np.fft.fft2(np.random.RandomState(seed).randn(H, W))
    fy = np.fft.fftfreq(H)[:, None] * H; fx = np.fft.fftfreq(W)[None, :] * W
    n = np.fft.ifft2(F * np.exp(-((fx / cu) ** 2 + (fy / cv) ** 2))).real
    return n / max(np.abs(n).max(), 1e-9)
def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def grid(H, W):
    return (np.linspace(0, 1, W, endpoint=False)[None, :] * np.ones((H, 1)),
            np.linspace(0, 1, H, endpoint=False)[:, None] * np.ones((1, W)))
def ramp(x, keys):
    out = np.zeros(x.shape + (3,)); xs = [k[0] for k in keys]
    for c in range(3): out[..., c] = np.interp(x, xs, [k[1][c] for k in keys])
    return out
def mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]

# A living ember: crimson roots, scarlet/orange body, gold highlights, white-hot cores.
EMBERDARK = (0.26, 0.012, 0.010); CRIMSON = (0.62, 0.035, 0.015); SCARLET = (0.96, 0.15, 0.015)
ORANGE = (1.0, 0.40, 0.035); AMBER = (1.0, 0.62, 0.11); GOLD = (1.0, 0.80, 0.30); HOT = (1.0, 0.95, 0.74)

def atlas():
    H = W = 256; u, s_all = grid(H, W)
    out = np.zeros((H, W, 3))
    row = np.minimum((s_all * ROWS).astype(int), ROWS - 1)
    s = np.clip((s_all * ROWS - row - 0.03) / 0.94, 0, 1)
    barb = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 26 - s * 3.2 + 0.3 * fnoise(H, W, 11, 12, 12)))
    fleck = 0.5 + 0.5 * fnoise(H, W, 13, 26, 26)
    rach = np.exp(-((s - 0.5) / 0.055) ** 2)
    def put(r, c):
        m = row == r; out[m] = c[m]
    # 0  primary pinions: crimson root -> scarlet -> orange -> gold -> white-hot tip, gold shaft
    c = ramp(u, [(0, EMBERDARK), (.22, CRIMSON), (.46, SCARLET), (.68, ORANGE), (.86, AMBER), (.96, GOLD), (1, HOT)])
    c = c * (0.76 + 0.30 * barb[..., None])
    c = mix(c, np.array(AMBER), rach * 0.55 * sm(0.0, 0.5, u))
    c = mix(c, np.array(HOT), sm(0.945, 1.0, u) * 0.85)                      # glowing tips
    c = mix(c, c * 0.45, sm(0.68, 1.0, np.abs(s - 0.5) * 2) * 0.60)          # dark vane edges -> feathers separate
    put(0, c)
    # 1  secondaries / coverts: scarlet root -> orange -> amber, bright gilt edge
    c = ramp(u, [(0, (0.22, 0.012, 0.010)), (.26, CRIMSON), (.56, SCARLET), (.80, ORANGE), (.94, AMBER), (1, GOLD)])
    c = c * (0.78 + 0.28 * barb[..., None])
    c = mix(c, np.array(AMBER), rach * 0.40 * sm(0.1, 0.6, u) + sm(0.90, 1.0, u) * 0.55)
    c = mix(c, c * 0.45, sm(0.70, 1.0, np.abs(s - 0.5) * 2) * 0.55)
    put(1, c)
    # 2  body plumage: u = nose(0) -> tail(1), s = spine(0) -> belly(1).  Hot belly, deeper back.
    back = ramp(u, [(0, (1.0, 0.50, 0.07)), (.34, (0.98, 0.30, 0.03)), (.70, (0.72, 0.07, 0.015)), (1, (0.34, 0.015, 0.01))])
    belly = ramp(u, [(0, (1.0, 0.86, 0.46)), (.34, (1.0, 0.66, 0.16)), (.72, ORANGE), (1, (0.80, 0.09, 0.02))])
    c = mix(back, belly, sm(0.14, 0.88, s))
    scal = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 22 + s * 9))
    c = c * (0.90 + 0.14 * scal[..., None]) * (0.92 + 0.16 * fleck[..., None])
    c = mix(c, np.array((1.0, 0.92, 0.62)), np.exp(-((s - 0.82) / 0.12) ** 2) * sm(0.30, 0.04, u) * 0.80)  # glowing throat
    put(2, c)
    # 3  head + crest: white-gold crown, orange edges
    c = ramp(u, [(0, (1.0, 0.84, 0.40)), (.30, AMBER), (.58, (1.0, 0.46, 0.05)), (.82, SCARLET), (1, CRIMSON)])
    c = mix(c, np.array(HOT), np.exp(-((s - 0.5) / 0.26) ** 2) * sm(0.34, 0.0, u) * 0.60)
    c = c * (0.86 + 0.20 * barb[..., None])
    c = mix(c, c * 0.5, sm(0.74, 1.0, np.abs(s - 0.5) * 2) * 0.45)
    put(3, c)
    # 4  beak / talons: polished brass, darker toward the hook
    c = ramp(u, [(0, (1.0, 0.74, 0.26)), (.48, (0.88, 0.50, 0.12)), (1, (0.40, 0.17, 0.035))])
    c = c * (0.94 + 0.10 * fleck[..., None])
    put(4, c)
    # 5  tail streamers: crimson root -> scarlet -> orange -> gold -> white tip, gold shaft
    c = ramp(u, [(0, (0.34, 0.015, 0.01)), (.18, CRIMSON), (.44, SCARLET), (.66, ORANGE), (.84, AMBER), (.95, GOLD), (1, HOT)])
    c = c * (0.78 + 0.28 * barb[..., None])
    c = mix(c, np.array(AMBER), rach * 0.55)
    c = mix(c, np.array(HOT), sm(0.955, 1.0, u) * 0.45)
    c = mix(c, c * 0.5, sm(0.60, 1.0, np.abs(s - 0.5) * 2) * 0.55)
    put(5, c)
    # 6  eye: dark sapphire bead, gold rim, white catchlight
    d = np.hypot((u - 0.5) / 0.42, (s - 0.5) / 0.42)
    c = mix(np.array((0.04, 0.08, 0.20)), np.array((0.18, 0.44, 0.95)), np.clip(1 - d, 0, 1) * 0.6)
    c = mix(c, np.array((1.0, 0.98, 0.92)), np.exp(-(np.hypot((u - 0.36) / 0.13, (s - 0.36) / 0.13)) ** 2) * 0.95)
    c = mix(c, np.array((1.0, 0.78, 0.30)), sm(0.86, 1.02, d) * 0.95)
    put(6, c)
    # 7  underglow / flame cores: white-hot
    c = ramp(u, [(0, (1.0, 0.97, 0.86)), (.50, (1.0, 0.82, 0.36)), (1, (1.0, 0.52, 0.08))])
    put(7, c)
    return np.clip(out, 0, 1)

def make_img(name, rgb, linear=False):
    H, W = rgb.shape[:2]
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((H, W, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = "Non-Color" if linear else "sRGB"
    return img

def make_mat(name, color=(1, 1, 1), metal=0.0, rough=0.5, emit=None, estr=1.0, tex=None, emit_tex=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = tex; t.interpolation = "Smart"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if emit_tex:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = estr
    elif emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = estr
    m.use_backface_culling = False
    return m

TEX = make_img("phoenix_atlas", atlas())
M = {
    "Ember": make_mat("Ember", rough=0.66, tex=TEX, emit_tex=True, estr=1.30),
    "EmberFlame": make_mat("EmberFlame", (1.0, 0.30, 0.03), 0.0, 0.62, emit=(1.0, 0.26, 0.03), estr=1.4),
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
    def build(self, name, parent, sharp=46.0):
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
            for li, vi in zip(poly.loop_indices, poly.vertices): uvl.data[li].uv = self.uv[vi]
        me.update()
        me.set_sharp_from_angle(angle=math.radians(sharp))
        ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); ob.parent = parent
        print(f"  {name}: tris={self.tris()} verts={len(self.v)} " +
              ", ".join(f"{s}={sum(len(f) - 2 for f, n in zip(self.f, self.fm) if n == s)}" for s in order))
        return ob

def empty(name, p, parent=None):
    e = bpy.data.objects.new(name, None); e.empty_display_type = "PLAIN_AXES"; e.empty_display_size = 0.02
    scene.collection.objects.link(e); e.parent = parent; e.location = B(V(p)); return e

# ------------------------------------------------------------------ primitives
def tube(mb, pts, radii, mat, row, sides=8, ref=X, caps=(True, True), squash=1.0, u01=(0.0, 1.0), tip_point=None):
    n = len(pts); rings = []
    for i, p in enumerate(pts):
        p = V(p); t = norm(V(pts[min(i + 1, n - 1)]) - V(pts[max(i - 1, 0)]))
        a = norm(t.cross(ref)); b = t.cross(a)
        uu = u01[0] + (u01[1] - u01[0]) * i / max(n - 1, 1)
        if tip_point is not None and i == n - 1:
            rings.append([mb.vert(tip_point, row_uv(row, uu, 0.5))] * sides); continue
        ring = []
        for j in range(sides):
            ang = 2 * math.pi * j / sides
            # s runs 0 on top .. 1 on the belly so body/beak shading follows the silhouette
            ss = 0.5 - 0.5 * math.cos(ang)
            ring.append(mb.vert(p + radii[i] * (math.cos(ang) * a + math.sin(ang) * b * squash), row_uv(row, uu, ss)))
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
        uu = u01[k]
        c = mb.vert(pts[end], row_uv(row, uu, 0.5)); r = rings[end]
        tng = norm(V(pts[min(end + 1, n - 1)]) - V(pts[max(end - 1, 0)])) * sgn
        for j in range(sides): mb.face_dir((c, r[j], r[(j + 1) % sides]), mat, tng)
    return rings

def blob(mb, c, r, mat, row, seg=10, rings=6, uvfn=None):
    """Ellipsoid.  uvfn(ax, ay, az) -> (u, s); default: u along -Z..+Z, s top..belly."""
    c = V(c)
    if uvfn is None: uvfn = lambda ax, ay, az: (0.5 - 0.5 * az, 0.5 - 0.5 * ay)
    def mk(ax, ay, az):
        u, s = uvfn(ax, ay, az)
        return mb.vert(c + V((r[0] * ax, r[1] * ay, r[2] * az)), row_uv(row, u, s))
    top = mk(0, 1, 0); idx = []
    for i in range(1, rings):
        ph = math.pi * i / rings
        idx.append([mk(math.sin(ph) * math.cos(2 * math.pi * j / seg), math.cos(ph), math.sin(ph) * math.sin(2 * math.pi * j / seg)) for j in range(seg)])
    bot = mk(0, -1, 0)
    def add(q): mb.face_dir(q, mat, sum((mb.v[k] for k in q), V()) / len(q) - c)
    for j in range(seg):
        add((top, idx[0][(j + 1) % seg], idx[0][j])); add((bot, idx[-1][j], idx[-1][(j + 1) % seg]))
    for i in range(len(idx) - 1):
        for j in range(seg): add((idx[i][j], idx[i][(j + 1) % seg], idx[i + 1][(j + 1) % seg], idx[i + 1][j]))

def feather(mb, root, dirv, length, width, row, mat="Ember", nseg=9, up=Y, curl=0.0, droop=0.0,
            twist=0.0, prof=None, rise=0.35, tipcut=0.88):
    """Cupped single-surface vane (double-sided material): edge / raised rachis / edge.
    root,dirv in the mesh frame; curl bends in the surface plane, droop out of it.  Returns the tip point."""
    f = norm(dirv); n0 = norm(V(up) - f * V(up).dot(f)); side = norm(f.cross(n0))
    if prof is None:
        prof = lambda t: math.sin(math.pi * min(1.0, 0.10 + 0.90 * t)) ** 0.62 * (1 - 0.72 * smooth(tipcut, 1.0, t))
    rows = []
    for i in range(nseg + 1):
        t = i / nseg
        p = V(root) + f * (length * t) + side * (curl * length * t * t) + n0 * (droop * length * t * t)
        nn = norm(n0 + side * (twist * t))
        ss = norm(f.cross(nn))
        w = width * prof(t)
        rows.append([mb.vert(p - ss * w, row_uv(row, t, 0.03)),
                     mb.vert(p + nn * (w * rise * (0.3 + 0.7 * (1 - t))), row_uv(row, t, 0.5)),
                     mb.vert(p + ss * w, row_uv(row, t, 0.97))])
    for i in range(nseg):
        a, b = rows[i], rows[i + 1]
        for k in (0, 1):
            q = (a[k], a[k + 1], b[k + 1], b[k])
            mb.face_dir(q, mat, n0)
    return mb.v[rows[-1][1]]

def sheet(mb, grid_pts, row, mat="Ember", uvs=None, outward=Y):
    """Quad grid surface (list of rows of points).  uvs parallel structure of (u,s)."""
    idx = []
    for ri, rowp in enumerate(grid_pts):
        line = []
        for ci, p in enumerate(rowp):
            u, s = uvs[ri][ci] if uvs else (ci / (len(rowp) - 1), ri / (len(grid_pts) - 1))
            line.append(mb.vert(p, row_uv(row, u, s)))
        idx.append(line)
    for ri in range(len(idx) - 1):
        for ci in range(len(idx[0]) - 1):
            mb.face_dir((idx[ri][ci], idx[ri][ci + 1], idx[ri + 1][ci + 1], idx[ri + 1][ci]), mat, outward)
    return idx

# ================================================================== the bird
SHOULDER = V((0.030, 0.062, -0.008))     # right shoulder; left is mirrored in X
SPAN = 0.270                             # half-span: outer pinion tip x (old asset: 0.272)

def build_body(parent):
    mb = MB()
    # --- torso: a plump ember body from the breast (z -0.040) to the tail root (z +0.078)
    spine = [(0, 0.049, -0.044), (0, 0.052, -0.022), (0, 0.054, 0.004), (0, 0.050, 0.030),
             (0, 0.045, 0.054), (0, 0.042, 0.072), (0, 0.042, 0.086)]
    rad = [0.0155, 0.0252, 0.0290, 0.0272, 0.0215, 0.0140, 0.0082]
    tube(mb, spine, rad, "Ember", 2, sides=12, ref=X, caps=(True, True), squash=0.88, u01=(0.22, 0.92))
    # breast swell + hot throat patch
    blob(mb, (0, 0.047, -0.036), (0.0188, 0.0196, 0.0210), "Ember", 2, seg=10, rings=6,
         uvfn=lambda ax, ay, az: (0.16 - 0.10 * az, 0.52 - 0.48 * ay))
    blob(mb, (0, 0.038, -0.045), (0.0120, 0.0108, 0.0120), "Ember", 7, seg=8, rings=4,
         uvfn=lambda ax, ay, az: (0.30 - 0.3 * ay, 0.5))
    # --- neck and head: the head is up and forward, the neck a short S
    neck = [(0, 0.058, -0.044), (0, 0.068, -0.052), (0, 0.078, -0.058)]
    tube(mb, neck, [0.0168, 0.0150, 0.0138], "Ember", 2, sides=10, ref=X, caps=(False, False), u01=(0.14, 0.05))
    blob(mb, (0, 0.0845, -0.0655), (0.0168, 0.0170, 0.0184), "Ember", 3, seg=10, rings=6,
         uvfn=lambda ax, ay, az: (0.52 + 0.42 * az, 0.5 - 0.45 * ay))
    # cheek flares: two short ember feathers sweeping back from the jaw
    for sgn in (-1, 1):
        feather(mb, (sgn * 0.0135, 0.0805, -0.0625), (sgn * 0.55, 0.30, 0.78), 0.030, 0.0070, 3,
                nseg=5, up=(sgn * 0.5, 0.86, 0), curl=0.10, rise=0.5)
    # eyes
    for sgn in (-1, 1):
        blob(mb, (sgn * 0.0138, 0.0878, -0.0712), (0.0052, 0.0054, 0.0050), "Ember", 6, seg=8, rings=4,
             uvfn=lambda ax, ay, az: (0.5 + 0.45 * az, 0.5 - 0.45 * ay))
    # beak: short hooked brass beak, upper then lower mandible
    tube(mb, [(0, 0.0845, -0.0755), (0, 0.0842, -0.0860), (0, 0.0820, -0.0930)],
         [0.0106, 0.0070, 0.0034], "Ember", 4, sides=8, ref=X, caps=(False, False), squash=0.76,
         u01=(0.0, 0.70), tip_point=(0, 0.0752, -0.0982))
    tube(mb, [(0, 0.0788, -0.0760), (0, 0.0792, -0.0848)], [0.0086, 0.0046], "Ember", 4, sides=8,
         ref=X, caps=(False, True), squash=0.52, u01=(0.1, 0.6), tip_point=(0, 0.0788, -0.0902))
    # --- crest: five swept flame feathers off the crown, the centre one tallest
    crest = [(-0.62, 0.88, 0.50, 0.032, 0.0092), (-0.26, 1.00, 0.30, 0.045, 0.0132),
             (0.00, 1.02, 0.14, 0.052, 0.0150), (0.26, 1.00, 0.30, 0.045, 0.0132),
             (0.62, 0.88, 0.50, 0.032, 0.0092)]
    for k, (dx, dy, dz, L, w) in enumerate(crest):
        rx = dx * 0.0125
        feather(mb, (rx, 0.0950, -0.0680 + abs(dx) * 0.005), (dx * 0.40, dy, dz), L, w, 3,
                nseg=7, up=(dx * 0.35, 0.18, -0.92), curl=0.08 * (1 if dx >= 0 else -1), droop=-0.42,
                twist=0.22 * (1 if dx >= 0 else -1), rise=0.5,
                prof=lambda t: math.sin(math.pi * min(1.0, 0.16 + 0.84 * t)) ** 0.55 * (1 - 0.80 * smooth(0.80, 1.0, t)))
    # nape ruff: a collar of short feathers where the neck meets the back
    for k in range(7):
        a = math.pi * (-0.5 + k / 6.0)
        rx, ry = math.sin(a), math.cos(a)
        feather(mb, (rx * 0.0150, 0.0640 + ry * 0.0105, -0.0400), (rx * 0.75, 0.28 + 0.25 * ry, 0.62),
                0.026, 0.0062, 1, nseg=5, up=(rx * 0.4, 0.90, -0.1), curl=0.08, droop=-0.06, rise=0.5)
    # scapulars: two rows of feathers laid over the back, breaking up the torso silhouette
    for k in range(5):
        t = k / 4.0
        for sgn in (-1, 1):
            feather(mb, (sgn * (0.0135 + 0.004 * t), 0.0700 - 0.012 * t * t, -0.030 + 0.050 * t),
                    (sgn * 0.30, 0.10 - 0.22 * t, 0.94), 0.054 - 0.010 * t, 0.0125 - 0.002 * t, 1,
                    nseg=5, up=(sgn * 0.42, 0.90, 0), curl=sgn * 0.06, droop=-0.05, rise=0.5)
    # breast feathers: a short bright apron under the throat
    for k in range(3):
        t = k / 2.0
        for sgn in (-1, 1):
            feather(mb, (sgn * (0.010 + 0.007 * t), 0.0340 + 0.0060 * t, -0.046 + 0.019 * t),
                    (sgn * 0.40, -0.20 + 0.08 * t, 0.89), 0.028 - 0.003 * t, 0.0082, 2,
                    nseg=4, up=(sgn * 0.26, -0.06, -0.96), curl=sgn * 0.05, rise=0.55,
                    prof=lambda z: math.sin(math.pi * min(1.0, 0.26 + 0.74 * z)) ** 0.8 * (1 - 0.7 * smooth(0.80, 1.0, z)))
    # --- tail: two long streamers, two mid streamers, four short coverts.  Tail root z = 0.086
    TAILR = V((0, 0.0425, 0.084))
    # banner: a bare glowing shaft that opens into a flaming spade near the tip
    def prof_banner(t):
        shaft = 0.26 + 0.10 * smooth(0.0, 0.30, t)
        spade = smooth(0.46, 0.80, t) * (1 - 0.92 * smooth(0.90, 1.0, t))
        return max(shaft * (1 - smooth(0.60, 0.95, t)), 0.30 + 0.95 * spade) * (1 - 0.92 * smooth(0.94, 1.0, t))
    prof_fan = lambda t: (math.sin(math.pi * min(1.0, 0.10 + 0.90 * t)) ** 0.45) * (0.50 + 0.50 * smooth(0.0, 0.30, t)) * (1 - 0.75 * smooth(0.88, 1.0, t))
    streamers = [  # (dx, dy, dz, length, width, droop, curl, nseg, row, banner)
        (0.210, 0.250, 0.945, 0.148, 0.0168, -0.30, 0.06, 12, 5, 1),   # the long pair of banners, swept apart and up
        (-0.210, 0.250, 0.945, 0.148, 0.0168, -0.30, -0.06, 12, 5, 1),
        (0.075, -0.150, 0.985, 0.134, 0.0150, 0.26, 0.05, 11, 5, 1),   # one long banner trailing low
        (-0.075, -0.150, 0.985, 0.134, 0.0150, 0.26, -0.05, 11, 5, 1),
        (0.000, 0.040, 1.00, 0.097, 0.0115, -0.04, 0.00, 8, 5, 0),    # the fan behind them
        (0.270, 0.060, 0.96, 0.088, 0.0112, -0.04, 0.12, 8, 5, 0),
        (-0.270, 0.060, 0.96, 0.088, 0.0112, -0.04, -0.12, 8, 5, 0),
        (0.470, -0.080, 0.88, 0.068, 0.0100, 0.08, 0.18, 6, 1, 0),
        (-0.470, -0.080, 0.88, 0.068, 0.0100, 0.08, -0.18, 6, 1, 0),
        (0.150, 0.420, 0.89, 0.058, 0.0092, -0.14, 0.06, 5, 1, 0),
        (-0.150, 0.420, 0.89, 0.058, 0.0092, -0.14, -0.06, 5, 1, 0),
    ]
    for dx, dy, dz, L, w, dr, cu, ns, row, ban in streamers:
        feather(mb, TAILR + V((dx * 0.030, dy * 0.012, 0.0)), (dx, dy, dz), L, w, row, nseg=ns,
                up=(dx * 0.25, 1.0, 0), curl=cu, droop=dr, twist=0.16 * (1 if dx >= 0 else -1),
                prof=prof_banner if ban else prof_fan, rise=0.40)
    # tail flame: four short tongues of raw fire where the streamers leave the body
    for k in range(4):
        a = 2 * math.pi * (k + 0.5) / 4
        feather(mb, TAILR + V((0.012 * math.cos(a), 0.010 * math.sin(a), -0.004)),
                (0.30 * math.cos(a), 0.30 * math.sin(a) + 0.10, 0.95), 0.052, 0.0092, 7, mat="EmberFlame",
                nseg=5, up=(math.cos(a) * 0.4, 0.9, 0), curl=0.10, droop=0.0, rise=0.9,
                prof=lambda t: math.sin(math.pi * min(1.0, 0.18 + 0.82 * t)) ** 0.75 * (1 - 0.85 * smooth(0.55, 1.0, t)))
    # --- tucked legs: two tiny talons folded under the belly, gripping the shaft
    for sgn in (-1, 1):
        tube(mb, [(sgn * 0.013, 0.0300, 0.020), (sgn * 0.0155, 0.0245, 0.009), (sgn * 0.0150, 0.0238, -0.002)],
             [0.0052, 0.0038, 0.0030], "Ember", 4, sides=6, ref=Z, caps=(False, True), u01=(0.1, 0.75))
        for j in (-1, 0, 1):
            feather(mb, (sgn * 0.0150, 0.0236, -0.003), (sgn * 0.22 + j * 0.34, -0.52, -0.82), 0.0115, 0.0024, 4,
                    nseg=3, up=(0, 0.45, -0.89), rise=0.8)
    return mb.build("Body", parent)

def wing_mesh(mb, sgn):
    """One wing in its OWN local frame: origin at the shoulder, wing running local sgn*X.
    sgn = -1 for WingLeft, +1 for WingRight.  Returns the furthest vertex distance."""
    xs = lambda x: sgn * x                        # local outward
    # leading-edge spine: shoulder -> elbow -> wrist, arched up, sweeping slightly back
    def LE(s):
        return V((xs(0.218 * s), 0.0128 * math.sin(math.pi * min(1.0, s * 0.80)) + 0.034 * s * s,
                  -0.030 - 0.004 * s + 0.044 * s * s))
    # inner wing (arm + coverts): a cupped sheet from the leading edge back, closed top and bottom
    NS, NC = 8, 4
    def chord(s, c):       # c = 0 leading edge .. 1 trailing edge
        depth = 0.062 * (1 - 0.30 * s)
        p = LE(s) + V((0, 0, depth * c))
        p.y += -0.009 * c * c * (1 - 0.35 * s) - 0.004 * s      # the arm cups gently behind the bone
        p.x += xs(-0.010 * c * (1 - s))                          # trailing edge tucks toward the body at the root
        return p
    def face(off):
        g = [[chord(ri / (NS - 1), ci / (NC - 1)) + V((0, off * (1 - (ci / (NC - 1)) ** 2) * (1 - 0.4 * ri / (NS - 1)), 0)) for ci in range(NC)]
             for ri in range(NS)]
        uv = [[(0.03 + 0.32 * (ci / (NC - 1)), 0.08 + 0.84 * (ri / (NS - 1))) for ci in range(NC)] for ri in range(NS)]
        return g, uv
    gt, uv = face(0.0065); sheet(mb, gt, 1, uvs=uv, outward=Y)
    gb, uv = face(-0.0055); sheet(mb, gb, 1, uvs=uv, outward=-Y)
    # seal the leading edge and the outboard edge so the inner wing has volume
    for ri in range(NS - 1):
        mb.face_dir((mb.vert(gt[ri][0], row_uv(1, 0.03, 0.2)), mb.vert(gt[ri + 1][0], row_uv(1, 0.03, 0.5)),
                     mb.vert(gb[ri + 1][0], row_uv(1, 0.01, 0.5)), mb.vert(gb[ri][0], row_uv(1, 0.01, 0.2))),
                    "Ember", (xs(-0.3), 0, -0.95))
    # shoulder cap, so the wing root reads as a mass of coverts rather than a plate
    for k in range(6):
        t = k / 5.0
        feather(mb, chord(0.03 + 0.34 * t, 0.10 + 0.20 * t) + V((0, 0.0068, 0)),
                (xs(0.58 + 0.24 * t), 0.20 - 0.12 * t, 0.78), 0.060 - 0.012 * t, 0.0150 - 0.002 * t, 1,
                nseg=5, up=(xs(-0.22), 0.95, 0), curl=xs(0.06), droop=-0.04, rise=0.55)
    for k in range(5):
        t = k / 4.0
        feather(mb, chord(0.07 + 0.52 * t, 0.55) + V((0, -0.0062, 0)),
                (xs(0.30 + 0.30 * t), -0.16 + 0.06 * t, 0.92), 0.058 - 0.010 * t, 0.0165 - 0.002 * t, 1,
                nseg=5, up=(xs(0.18), -0.96, 0), curl=xs(-0.06), droop=-0.03, rise=0.5)
    # secondaries: along the trailing edge of the arm, sweeping back and slightly out
    NSEC = 7
    for k in range(NSEC):
        t = k / (NSEC - 1)
        s = 0.08 + 0.64 * t
        root = chord(s, 0.92)
        L = 0.112 - 0.020 * t
        feather(mb, root, (xs(0.24 + 0.36 * t), -0.04 - 0.05 * t, 0.96), L, 0.0205 - 0.0030 * t, 1,
                nseg=7, up=(xs(-0.16), 0.98, 0), curl=xs(0.10), droop=0.07, twist=xs(0.18), rise=0.5)
    # primaries: a fan from the wrist outward; the FIRST ones are longest so the tip is the furthest vertex
    NPRI = 9
    far = 0.0
    for k in range(NPRI):
        t = k / (NPRI - 1)
        root = LE(0.56 + 0.38 * t) + V((0, -0.0015, 0.010 + 0.020 * t))
        ang = math.radians(17 + 58 * (t ** 1.00))                 # 0 deg = straight out along local X
        d = V((xs(math.cos(ang)), 0.11 - 0.17 * t, math.sin(ang)))
        L = 0.124 * (1 - 0.26 * t ** 1.4)
        feather(mb, root, d, L, 0.0200 - 0.0052 * t, 0, nseg=9, up=(xs(-0.10), 0.99, 0),
                curl=xs(0.07 + 0.05 * t), droop=0.04 + 0.05 * t, twist=xs(0.20), rise=0.38,
                prof=lambda z: math.sin(math.pi * min(1.0, 0.11 + 0.89 * z)) ** 0.46 * (1 - 0.92 * smooth(0.82, 1.0, z)))
    for p in mb.v: far = max(far, p.length)
    return far

def build_wings(root):
    objs = []
    for name, sgn in (("WingLeft", -1), ("WingRight", 1)):
        pivot = V((sgn * SHOULDER.x, SHOULDER.y, SHOULDER.z))
        e = empty(name, pivot, root)
        mb = MB(); far = wing_mesh(mb, sgn)
        ob = mb.build(f"{name}Mesh", e)
        # report the furthest vertex (must be the pinion tip)
        best = max(mb.v, key=lambda p: p.length)
        print(f"  {name}: pivot={tuple(round(c, 4) for c in pivot)} furthest={far:.4f} at {tuple(round(c, 4) for c in best)}")
        objs += [e, ob]
    return objs

def build():
    root = empty("Wings", (0, 0, 0))
    objs = [root, build_body(root)] + build_wings(root)
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
    objs = build()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "phoenix-source.blend"))
    export(objs, "wings.glb")
    p = os.path.join(OUT, "wings.glb")
    print("WROTE", p, os.path.getsize(p), "bytes")
