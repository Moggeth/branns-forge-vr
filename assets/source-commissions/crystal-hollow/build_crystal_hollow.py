"""Crystal Hollow environment kit builder (Blender 4.5, deterministic).

Run:  blender --background --factory-startup --python build_crystal_hollow.py -- --out ABS_DIR [--no-render]

All geometry is authored in GAME coordinates (metres, +Y up, front +Z, ground y=0)
and converted to Blender Z-up on write; the glTF exporter (+Y up) round-trips to
exactly these numbers.  Placements in layout.json are relative to the zone centre
(52,0,52).  Outputs (in --out):
  glb/<piece>.glb                 one self-contained GLB per logical piece
  crystal_hollow_source.blend     editable kit + assembled layout + context proxies
  layout.json                     placements, collision proxies, clearance report
  inspection.json                 re-imported GLB stats (tris, materials, images, bounds)
  renders/*.png                   overview / eye-height / per-piece views
"""
import bpy, bmesh, json, math, os, random, sys, time
import numpy as np
from mathutils import Matrix, Vector, noise

T0 = time.time()
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(ARGV[ARGV.index("--out") + 1]) if "--out" in ARGV else os.path.join(HERE, "output")
RENDER = "--no-render" not in ARGV
for d in ("glb", "renders"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

def g2b(p):  # game -> blender
    return (p[0], -p[2], p[1])

# ------------------------------------------------------------------ textures
def _vnoise(grid, seed, n):
    r = np.random.default_rng(seed).random((grid, grid))
    c = np.arange(n) * grid / n
    i0 = np.floor(c).astype(int); f = c - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % grid
    a = r[i0][:, i0]; b = r[i0][:, i1]; cc = r[i1][:, i0]; d = r[i1][:, i1]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy

def fbm(seed, n, base=4, octaves=4):
    out = np.zeros((n, n)); amp = 1.0; tot = 0
    for o in range(octaves):
        out += _vnoise(base * 2 ** o, seed + o, n) * amp; tot += amp; amp *= 0.5
    return out / tot

def lerp3(c0, c1, t):
    return np.array(c0)[None, None, :] * (1 - t[..., None]) + np.array(c1)[None, None, :] * t[..., None]

def tex_strata(n=512):
    # rows = v (texture y).  8 sedimentary bands per tile with warped edges.
    y = np.linspace(0, 1, n, endpoint=False)[:, None] * np.ones((1, n))
    warp = (fbm(11, n, 2, 3) - 0.5) * 0.09
    vv = (y + warp) * 8
    band = np.floor(vv).astype(int) % 8; fb = vv - np.floor(vv)
    pal = np.array([(0.13, 0.13, 0.19), (0.20, 0.21, 0.28), (0.16, 0.14, 0.20), (0.27, 0.22, 0.24),
                    (0.11, 0.12, 0.17), (0.22, 0.24, 0.31), (0.18, 0.16, 0.23), (0.25, 0.26, 0.33)])
    img = pal[band]
    grain = fbm(23, n, 8, 4)
    img = img * (0.72 + 0.55 * grain)[..., None]
    seam = np.exp(-((fb - 0.03) / 0.018) ** 2)  # pale mineral seam at each band base
    img = img * (1 - 0.6 * seam[..., None]) + np.array((0.42, 0.46, 0.55)) * 0.6 * seam[..., None]
    crack = np.abs(fbm(31, n, 6, 3) - 0.5) < 0.012
    img[crack] *= 0.45
    spk = np.random.default_rng(5).random((n, n)) > 0.9975  # rare cyan mineral glints
    img[spk] = (0.35, 0.75, 0.85)
    return img

def tex_worked(n=512):
    y, x = np.mgrid[0:n, 0:n] / n
    rows = 4; ry = y * rows; row = np.floor(ry); fy = ry - row
    rx = x * 3 + (row % 2) * 0.5; fx = rx - np.floor(rx)
    tone = np.random.default_rng(7).random((rows, 4))[row.astype(int) % rows, np.floor(rx).astype(int) % 4]
    img = lerp3((0.30, 0.30, 0.37), (0.42, 0.41, 0.49), tone)
    img *= (0.8 + 0.35 * fbm(41, n, 8, 4))[..., None]
    chisel = 0.5 + 0.5 * np.sin((x * 40 + y * 25 + fbm(43, n, 4, 2) * 3) * 6.283)
    img *= (0.93 + 0.07 * chisel)[..., None]
    joint = (np.minimum(fy, 1 - fy) < 0.025) | (np.minimum(fx, 1 - fx) < 0.018)
    img[joint] = (0.10, 0.10, 0.14)
    return img

def tex_crystal(deep, mid, tip, n=256):
    v, u = np.mgrid[0:n, 0:n] / n  # v: 0 base -> 1 tip
    img = np.where((v < 0.55)[..., None], lerp3(deep, mid, np.clip(v / 0.55, 0, 1)),
                   lerp3(mid, tip, np.clip((v - 0.55) / 0.45, 0, 1)))
    facet = np.abs(((u * 6) % 1.0) - 0.5) * 2  # 1 at facet edges
    edge = np.clip((facet - 0.82) / 0.18, 0, 1) ** 2
    img = img * (1 - 0.5 * edge[..., None]) + np.array(tip) * 0.5 * edge[..., None]
    streak = fbm(61, n, 3, 3)
    img *= (0.82 + 0.3 * streak)[..., None]
    return np.clip(img, 0, 1)

def tex_timber(n=256):
    u = np.linspace(0, 1, n, endpoint=False)[None, :] * np.ones((n, 1))
    rings = 0.5 + 0.5 * np.sin((u * 12 + fbm(71, n, 2, 3) * 2) * 6.283)
    t = np.clip(rings ** 3 * 0.5 + fbm(73, n, 8, 3) * 0.5, 0, 1)
    return lerp3((0.20, 0.13, 0.08), (0.42, 0.30, 0.19), t)

def tex_glow(col, n=128):
    y, x = np.mgrid[0:n, 0:n] / (n - 1)
    r = np.clip(np.hypot(x - 0.5, y - 0.5) * 2, 0, 1)
    a = (1 - r) ** 2.2 * 0.75
    rgb = np.ones((n, n, 3)) * np.array(col)[None, None, :]
    return rgb, a

def make_image(name, rgb, alpha=None):
    n = rgb.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=alpha is not None)
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1) ** 1.0
    if alpha is not None:
        rgba[..., 3] = alpha
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img

# ------------------------------------------------------------------ materials
MATS = {}

def material(name, color=(0.5, 0.5, 0.5), image=None, rough=0.9, metal=0.0, emit=None, emit_img=False,
             strength=0.0, blend=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Base Color"].default_value = (*color, 1)
    if image is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = image; t.location = (-400, 200)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if emit_img:
            nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        if blend:
            nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    if emit is not None:
        if not emit_img:
            b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if blend:
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
        try: m.blend_method = "BLEND"
        except Exception: pass
        m.use_backface_culling = True
    MATS[name] = m
    return m

def build_materials():
    material("CH_RockStrata", image=make_image("ch_rock_strata", tex_strata()), rough=0.93)
    material("CH_RockWorked", image=make_image("ch_rock_worked", tex_worked()), rough=0.85)
    material("CH_CrystalCyan", image=make_image("ch_crystal_cyan", tex_crystal((0.02, 0.16, 0.26), (0.16, 0.72, 0.90), (0.85, 1.0, 1.0))),
             rough=0.18, emit=(1, 1, 1), emit_img=True, strength=2.2)
    material("CH_CrystalOrchid", image=make_image("ch_crystal_orchid", tex_crystal((0.16, 0.03, 0.22), (0.78, 0.36, 0.86), (1.0, 0.90, 1.0))),
             rough=0.18, emit=(1, 1, 1), emit_img=True, strength=2.2)
    material("CH_RuneCore", color=(0.7, 0.95, 1.0), rough=0.3, emit=(0.55, 0.95, 1.0), strength=4.0)
    material("CH_Timber", image=make_image("ch_timber", tex_timber()), rough=0.9)
    material("CH_Iron", color=(0.09, 0.09, 0.11), rough=0.55, metal=0.8)
    rgb, a = tex_glow((0.35, 0.85, 1.0))
    material("CH_GlowCyan", color=(0.35, 0.85, 1.0), image=make_image("ch_glow_cyan", rgb, a), rough=1.0,
             emit=(1, 1, 1), emit_img=True, strength=1.5, blend=True)
    rgb, a = tex_glow((0.9, 0.5, 1.0))
    material("CH_GlowOrchid", color=(0.9, 0.5, 1.0), image=make_image("ch_glow_orchid", rgb, a), rough=1.0,
             emit=(1, 1, 1), emit_img=True, strength=1.5, blend=True)

UV_SCALE = {"CH_RockStrata": 4.0, "CH_RockWorked": 2.0, "CH_Timber": 1.2, "CH_Iron": 1.0}

# ------------------------------------------------------------------ mesh builder
class MB:
    """Accumulates faces in game coordinates; one Blender object per piece."""
    def __init__(self, name):
        self.name = name; self.v = []; self.f = []; self.m = []; self.uv = []

    def face(self, pts, mat, uvs=None, ref=None, want=None, inward=False):
        pts = [Vector(p) for p in pts]
        c = sum(pts, Vector()) / len(pts)
        nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if nrm.length < 1e-10 and len(pts) > 3:
            nrm = (pts[2] - pts[0]).cross(pts[3] - pts[0])
        flip = False
        if ref is not None and (nrm.dot(c - Vector(ref)) < 0) != inward: flip = True
        if want is not None and nrm.dot(Vector(want)) < 0: flip = True
        if flip:
            pts = pts[::-1]; uvs = uvs[::-1] if uvs else None; nrm = -nrm
        if uvs is None:  # box projection in piece space
            s = UV_SCALE.get(mat, 2.0); a = [abs(nrm.x), abs(nrm.y), abs(nrm.z)]
            if a[1] >= a[0] and a[1] >= a[2]: uvs = [(p.x / s, p.z / s) for p in pts]
            elif a[0] >= a[2]: uvs = [(p.z / s, p.y / s) for p in pts]
            else: uvs = [(p.x / s, p.y / s) for p in pts]
        base = len(self.v); self.v.extend(pts)
        self.f.append(tuple(range(base, base + len(pts)))); self.m.append(mat); self.uv.append(uvs)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def to_object(self, coll):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([g2b(p) for p in self.v], [], self.f)
        names = []
        for mn in self.m:
            if mn not in names: names.append(mn)
        for mn in names: me.materials.append(MATS[mn])
        me.polygons.foreach_set("material_index", [names.index(mn) for mn in self.m])
        uvl = me.uv_layers.new(name="UVMap")
        flat = [c for uvs in self.uv for uv in uvs for c in uv]
        uvl.data.foreach_set("uv", flat)
        me.validate(); me.update()
        # weld coincident verts per material/uv seam is unnecessary: flat-shaded facets are the style
        ob = bpy.data.objects.new(self.name, me); coll.objects.link(ob)
        return ob

# ------------------------------------------------------------------ primitives (M = game-space Matrix)
def xf(M, p): return M @ Vector(p)

def basis(d):
    d = Vector(d).normalized()
    u = Vector((0, 1, 0)).cross(d) if abs(d.y) < 0.95 else Vector((1, 0, 0)).cross(d)
    u.normalize(); w = d.cross(u)
    return d, u, w

def shard(mb, M, base, direction, length, radius, mat, sides=6, twist=0.0, shoulder=0.72, bury=0.12, uvmode="crystal"):
    d, u, w = basis(direction); base = Vector(base)
    ring0 = []; ring1 = []
    for i in range(sides):
        a = twist + i * 2 * math.pi / sides
        off = u * math.cos(a) + w * math.sin(a)
        ring0.append(base - d * (length * bury) + off * radius)
        ring1.append(base + d * (length * shoulder) + off * radius * 0.92)
    tip = base + d * length
    axis0 = xf(M, base - d * length); axis1 = xf(M, tip)
    def axref(p):
        ax = axis1 - axis0; t = (p - axis0).dot(ax) / ax.length_squared
        return axis0 + ax * t
    for i in range(sides):
        j = (i + 1) % sides
        u0 = i / sides; u1 = (i + 1) / sides
        q = [xf(M, ring0[i]), xf(M, ring0[j]), xf(M, ring1[j]), xf(M, ring1[i])]
        uvq = [(u0, 0), (u1, 0), (u1, shoulder), (u0, shoulder)] if uvmode == "crystal" else None
        c = sum(q, Vector()) / 4
        mb.face(q, mat, uvq, ref=axref(c))
        t = [xf(M, ring1[i]), xf(M, ring1[j]), xf(M, tip)]
        uvt = [(u0, shoulder), (u1, shoulder), ((u0 + u1) / 2, 1.0)] if uvmode == "crystal" else None
        c = sum(t, Vector()) / 3
        mb.face(t, mat, uvt, ref=axref(c))

def box(mb, M, center, size, mat, rot=(0, 0, 0), taper=1.0):
    c = Vector(center); hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    R = (Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z"))
    L = M @ Matrix.Translation(c) @ R
    P = []
    for sy in (-1, 1):
        k = 1.0 if sy < 0 else taper
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            P.append(xf(L, (sx * hx * k, sy * hy, sz * hz * k)))
    cen = xf(L, (0, 0, 0))
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        mb.face([P[i] for i in f], mat, ref=cen)

def prism(mb, M, center, radius, height, sides, mat, rot=(0, 0, 0), top_scale=1.0, phase=0.0, caps=(True, True)):
    c = Vector(center)
    R = Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z")
    L = M @ Matrix.Translation(c) @ R
    lo = [xf(L, (math.cos(phase + i * 2 * math.pi / sides) * radius, -height / 2, math.sin(phase + i * 2 * math.pi / sides) * radius)) for i in range(sides)]
    hi = [xf(L, (math.cos(phase + i * 2 * math.pi / sides) * radius * top_scale, height / 2, math.sin(phase + i * 2 * math.pi / sides) * radius * top_scale)) for i in range(sides)]
    cen = xf(L, (0, 0, 0))
    for i in range(sides):
        j = (i + 1) % sides
        q = [lo[i], lo[j], hi[j], hi[i]]
        mid = sum(q, Vector()) / 4
        axis_pt = xf(L, (0, ((L.inverted() @ mid).y), 0))
        mb.face(q, mat, ref=axis_pt)
    if caps[0]: mb.face(lo, mat, ref=cen)
    if caps[1]: mb.face(hi, mat, ref=cen)

def rock(mb, M, center, size, seed, mat, subdiv=1, flat_bottom=True, rough=0.22):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    L = M @ Matrix.Translation(Vector(center)) @ Matrix.Rotation(seed * 0.9, 4, "Y")
    pos = {}
    for v in bm.verts:
        p = v.co.copy()
        k = 1 + rough * noise.noise(p * 1.3 + off) + 0.5 * rough * noise.noise(p * 3.1 + off)
        q = Vector((p.x * size[0] / 2 * k, p.z * size[1] / 2 * k, p.y * size[2] / 2 * k))
        if flat_bottom and q.y < -size[1] * 0.35: q.y = -size[1] * 0.35 - 0.02 * (q.y + size[1] * 0.35)
        pos[v.index] = xf(L, q)
    cen = xf(L, (0, 0, 0))
    for f in bm.faces:
        mb.face([pos[v.index] for v in f.verts], mat, ref=cen)
    bm.free()

def cluster(mb, M, base, seed, mats, count=5, size=1.0, up=(0, 1, 0), spread=0.55):
    rng = random.Random(seed); up = Vector(up).normalized(); _, u, w = basis(up)
    for i in range(count):
        a = rng.uniform(0, 6.283); r = 0.0 if i == 0 else rng.uniform(0.12, 0.3) * size
        p = Vector(base) + (u * math.cos(a) + w * math.sin(a)) * r
        tilt = 0.0 if i == 0 else rng.uniform(0.25, spread + 0.3)
        d = (up + (u * math.cos(a) + w * math.sin(a)) * math.tan(tilt)).normalized()
        L = size * (1.0 if i == 0 else rng.uniform(0.35, 0.75))
        shard(mb, M, p, d, L, L * rng.uniform(0.13, 0.18), mats[i % len(mats)], twist=rng.uniform(0, 1))

I = Matrix.Identity(4)

# ------------------------------------------------------------------ pieces
def wall_surface(seed, W=7.8, H=11.8):
    rng = random.Random(seed)
    Y = [-0.6]
    while Y[-1] < H: Y.append(Y[-1] + rng.uniform(0.8, 1.7))
    Y[-1] = H + 0.2
    offs = [rng.uniform(-0.45, 0.3) for _ in Y]
    dip = rng.uniform(-0.07, 0.07); nz = Vector((seed * 1.7, seed * 0.3, 2.1))
    def yb(x, k):
        if k == 0 or k == len(Y) - 1: return Y[k]
        return Y[k] + dip * x + 0.16 * noise.noise(Vector((x * 0.6, k * 3.1, seed)))
    def base_z(x, y, k, frac):
        o = offs[k] + 0.2 * noise.noise(Vector((x * 0.7, k * 1.3, seed * 0.5)))
        prof = 0.32 - 0.46 * frac  # lip at the bottom of each band, recess at top
        z = o + prof
        z += 0.52 * (x / (W / 2)) ** 2
        t = max(0.0, min(1.0, (y - 5.5) / (H - 5.5))); z += 3.2 * t * t
        z += 0.45 * noise.noise(Vector((x * 0.25, y * 0.2, 0)) + nz)
        return z
    return Y, yb, base_z

def build_wall(name, seed, variant):
    mb = MB(name); W, H, D = 7.8, 11.8, 2.8
    Y, yb, base_z = wall_surface(seed, W, H)
    recess = (lambda x, y: 0.0)
    if variant == "mine":
        def recess(x, y):
            mx = max(0.0, min(1.0, (1.75 - abs(x)) / 0.4)); my = max(0.0, min(1.0, (3.1 - y) / 0.45))
            return 1.15 * mx * my
    xs = [-W / 2 + W * i / 16 for i in range(17)]
    rows = []  # list of (k, frac)
    for k in range(len(Y) - 1):
        for frac in (0.0, 0.45, 1.0): rows.append((k, frac))
    grid = []
    for (k, frac) in rows:
        line = []
        for x in xs:
            y0 = yb(x, k); y1 = yb(x, k + 1) - 0.07
            y = y0 + (y1 - y0) * frac
            z = base_z(x, y, k, frac) - recess(x, y)
            line.append(Vector((x, y, z)))
        grid.append(line)
    for r in range(len(grid) - 1):
        for c in range(len(xs) - 1):
            mb.face([grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]], "CH_RockStrata", want=(0, 0, 1) if False else None)
    # side flaps back to the rock body so oblique views never see a paper edge
    for side, c in ((-1, 0), (1, len(xs) - 1)):
        for r in range(len(grid) - 1):
            a = grid[r][c]; b = grid[r + 1][c]
            q = [a, b, Vector((b.x, b.y, -D)), Vector((a.x, a.y, -D))]
            mb.face(q, "CH_RockStrata", want=(side, 0, 0))
    def surf(x, y):
        c = max(0, min(len(xs) - 2, int((x + W / 2) / (W / 16))))
        fx = (x - xs[c]) / (xs[c + 1] - xs[c])
        for r in range(len(grid) - 1):
            y0 = grid[r][c].y * (1 - fx) + grid[r][c + 1].y * fx; y1 = grid[r + 1][c].y * (1 - fx) + grid[r + 1][c + 1].y * fx
            if y0 <= y <= y1:
                fy = (y - y0) / max(1e-6, y1 - y0)
                za = grid[r][c].z * (1 - fx) + grid[r][c + 1].z * fx; zb = grid[r + 1][c].z * (1 - fx) + grid[r + 1][c + 1].z * fx
                return za * (1 - fy) + zb * fy
        return 0.0
    rng = random.Random(seed + 100)
    if variant == "mine":
        zf = max(surf(-1.15, 1.2), surf(1.15, 1.2)) + 0.15
        box(mb, I, (0, 1.3, zf - 0.25), (2.3, 2.6, 0.05), "CH_Iron")  # the dark adit mouth
        for sx in (-1, 1):
            box(mb, I, (sx * 1.15, 1.3, zf), (0.24, 2.6, 0.24), "CH_Timber", rot=(0, 0, sx * 0.04))
        box(mb, I, (0, 2.68, zf + 0.02), (2.9, 0.28, 0.3), "CH_Timber", rot=(0, 0, 0.03))
        for i, (y, rz) in enumerate(((0.55, 0.08), (1.25, -0.12), (1.95, 0.05))):
            box(mb, I, (0.05 * i, y, zf + 0.16), (2.4, 0.2, 0.05), "CH_Timber", rot=(0, 0, rz))
        for sx in (-1, 1):  # iron straps where the boards are nailed
            box(mb, I, (sx * 1.15, 1.25, zf + 0.2), (0.3, 0.06, 0.04), "CH_Iron")
        for x, y, L in ((-0.5, 0.9, 0.55), (0.35, 1.62, 0.7), (-0.1, 2.25, 0.45)):  # light leaking through
            shard(mb, I, (x, y, zf - 0.2), (rng.uniform(-0.3, 0.3), 0.25, 1), L, L * 0.17, "CH_CrystalCyan", twist=x)
        for sx in (-0.38, 0.38):
            box(mb, I, (sx, 0.04, zf + 0.9), (0.07, 0.08, 1.9), "CH_Iron")
        for i in range(4):
            box(mb, I, (0, 0.025, zf + 0.2 + i * 0.5), (1.05, 0.05, 0.16), "CH_Timber", rot=(0, rng.uniform(-0.06, 0.06), 0))
        # a hanging crystal lamp on a peg, above head height
        box(mb, I, (1.6, 3.3, surf(1.6, 3.3) + 0.25), (0.08, 0.08, 0.5), "CH_Iron")
        shard(mb, I, (1.6, 3.1, surf(1.6, 3.3) + 0.48), (0, -1, 0), 0.4, 0.09, "CH_CrystalCyan")
        shard(mb, I, (1.6, 3.1, surf(1.6, 3.3) + 0.48), (0, 1, 0), 0.25, 0.09, "CH_CrystalCyan")
    elif variant == "vein":
        for k in range(12):
            t = k / 11
            x = -2.8 + 5.4 * t + rng.uniform(-0.3, 0.3); y = 0.9 + 6.8 * t + rng.uniform(-0.3, 0.3)
            z = surf(x, y) - 0.12
            L = (1.05 - 0.6 * t) * rng.uniform(0.75, 1.2)
            m = "CH_CrystalOrchid" if k % 4 == 1 else "CH_CrystalCyan"
            shard(mb, I, (x, y, z), (rng.uniform(-0.5, 0.5), rng.uniform(-0.1, 0.6), 1), L, L * 0.16, m, twist=k)
        cluster(mb, I, (-2.6, 0.0, surf(-2.6, 0.5) - 0.3), seed + 7, ["CH_CrystalCyan", "CH_CrystalCyan", "CH_CrystalOrchid"], 6, 2.1, up=(0.1, 1, 0.45))
    else:  # strata: small buds glint on two high ledges
        for (x, y) in ((-1.8, 4.3), (2.2, 6.2)):
            cluster(mb, I, (x, y, surf(x, y) - 0.15), seed + int(y * 10), ["CH_CrystalCyan", "CH_CrystalOrchid"], 3, 0.55, up=(0, 1, 0.5))
    return mb

def build_ceiling(name, seed):
    mb = MB(name); rng = random.Random(seed); N = 10; S = 9.6
    off = Vector((seed, 2 * seed, 0.5))
    pts = []
    for i in range(N + 1):
        row = []
        for j in range(N + 1):
            x = -S / 2 + S * j / N; z = -S / 2 + S * i / N
            r = math.hypot(x, z) / (S / 2)
            y = -0.55 - 0.85 * noise.noise(Vector((x * 0.3, z * 0.3, 0)) + off) ** 2 - 0.4 * max(0, 1 - r)
            y += 1.2 * max(0.0, r - 0.8)  # roll edges up into the slab above
            row.append(Vector((x, y, z)))
        pts.append(row)
    for i in range(N):
        for j in range(N):
            mb.face([pts[i][j], pts[i][j + 1], pts[i + 1][j + 1], pts[i + 1][j]], "CH_RockStrata", want=(0, -1, 0))
    for k in range(6):
        a = rng.uniform(0, 6.283); r = rng.uniform(0.5, 3.4)
        x, z = math.cos(a) * r, math.sin(a) * r
        L = rng.uniform(1.1, 2.7)
        shard(mb, I, (x, -0.7, z), (rng.uniform(-0.15, 0.15), -1, rng.uniform(-0.15, 0.15)), L, L * 0.2, "CH_RockStrata",
              sides=5, shoulder=0.35, bury=0.15, uvmode="box")
    for k in range(3):
        a = rng.uniform(0, 6.283); r = rng.uniform(1.0, 3.2)
        cluster(mb, I, (math.cos(a) * r, -0.8, math.sin(a) * r), seed + k, ["CH_CrystalCyan", "CH_CrystalOrchid"] if k % 2 else ["CH_CrystalOrchid", "CH_CrystalCyan"],
                4, rng.uniform(0.8, 1.3), up=(0, -1, 0))
    return mb

def voussoir_arch(mb, span_half, spring_y, radius, thick, z0, z1, n_side, mat, jitter_seed=0):
    rng = random.Random(jitter_seed)
    cx = radius - span_half  # pointed arch: two arcs centred at x=+/-cx on the springline
    th_apex = math.acos(cx / radius)
    for side in (-1, 1):
        for i in range(n_side):
            ta = math.pi - (math.pi - th_apex) * i / n_side; tb = math.pi - (math.pi - th_apex) * (i + 1) / n_side
            gap = 0.012
            ta -= gap; tb += gap if i < n_side - 1 else 0
            def P(t, r, z):
                x = cx + r * math.cos(t)  # left arc (centre +cx) mirrored for right side
                return Vector((x if side < 0 else -x, spring_y + r * math.sin(t), z))
            ri = radius - thick / 2; ro = radius + thick / 2 + rng.uniform(-0.03, 0.05)
            pts = [P(ta, ri, z0), P(tb, ri, z0), P(tb, ro, z0), P(ta, ro, z0), P(ta, ri, z1), P(tb, ri, z1), P(tb, ro, z1), P(ta, ro, z1)]
            cen = sum(pts, Vector()) / 8
            for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                mb.face([pts[k] for k in f], mat, ref=cen)
    return spring_y + radius * math.sin(th_apex)

def build_vault():
    mb = MB("prism_vault"); rng = random.Random(77)
    PZ = -0.85; PX = 1.55
    for sx in (-1, 1):
        box(mb, I, (sx * PX, 0.175, PZ), (0.82, 0.35, 0.82), "CH_RockWorked")
        for k in range(3):
            prism(mb, I, (sx * PX, 0.35 + 0.4 + k * 0.8, PZ), 0.31, 0.78, 8, "CH_RockWorked", phase=rng.uniform(0, 0.4))
        prism(mb, I, (sx * PX, 1.12, PZ), 0.325, 0.07, 8, "CH_RuneCore", caps=(False, False))
        box(mb, I, (sx * PX, 2.9, PZ), (0.86, 0.3, 0.86), "CH_RockWorked", taper=1.08)
    apex = voussoir_arch(mb, PX, 3.05, 2.4, 0.56, PZ - 0.36, PZ + 0.36, 5, "CH_RockWorked", 3)
    box(mb, I, (0, apex + 0.05, PZ), (0.5, 0.85, 0.9), "CH_RockWorked", taper=1.2)
    shard(mb, I, (0, apex + 0.05, PZ + 0.3), (0, 0.15, 1), 0.45, 0.12, "CH_CrystalOrchid")  # keystone jewel
    # half-round apse behind the reward (open to the front), worked stone courses
    ac = Vector((0, 0, PZ)); R = PX; segs = 9
    for i in range(segs):
        a0 = math.pi + math.pi * i / segs; a1 = math.pi + math.pi * (i + 1) / segs
        am = (a0 + a1) / 2
        for c in range(3):
            y0 = 0.02 + c * 1.0; y1 = y0 + 0.98
            ri, ro = R - 0.05, R + 0.3
            P = lambda a, r, y: Vector((math.cos(a) * r, y, PZ + math.sin(a) * r))
            q = [P(a0, ri, y0), P(a1, ri, y0), P(a1, ro, y0), P(a0, ro, y0), P(a0, ri, y1), P(a1, ri, y1), P(a1, ro, y1), P(a0, ro, y1)]
            cen = sum(q, Vector()) / 8
            for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                mb.face([q[k] for k in f], "CH_RockWorked", ref=cen)
        P = lambda a, r, y: Vector((math.cos(a) * r, y, PZ + math.sin(a) * r))
        mb.face([P(a0, R - 0.07, 1.02), P(a1, R - 0.07, 1.02), P(a1, R - 0.07, 1.1), P(a0, R - 0.07, 1.1)], "CH_RuneCore", want=(-math.cos(am), 0, -math.sin(am)))
    # semi-dome (conch) over the apse
    rings = 4
    for i in range(segs):
        for j in range(rings):
            def D(ii, jj):
                a = math.pi + math.pi * ii / segs; e = (math.pi / 2) * jj / rings
                return Vector((math.cos(a) * R * math.cos(e), 3.05 + R * 1.1 * math.sin(e), PZ + math.sin(a) * R * math.cos(e)))
            q = [D(i, j), D(i + 1, j), D(i + 1, j + 1), D(i, j + 1)]
            if (q[2] - q[3]).length < 1e-6: q = q[:3]
            mb.face(q, "CH_RockWorked", ref=(0, 3.05, PZ), inward=True)

    # prism rosette on the apse back wall
    rc = Vector((0, 2.25, PZ - R + 0.12))
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6; d = Vector((math.cos(a), math.sin(a), 0))
        s = Vector((-d.y, d.x, 0))
        m = "CH_CrystalCyan" if k % 2 else "CH_CrystalOrchid"
        p0 = rc + d * 0.14; p1 = rc + d * 0.42 + s * 0.14 + Vector((0, 0, 0.1)); p2 = rc + d * 0.78; p3 = rc + d * 0.42 - s * 0.14 + Vector((0, 0, 0.1))
        mb.face([p0, p1, p2], m, [(0, 0), (1, 0.6), (0.5, 1)], want=(0, 0, 1))
        mb.face([p0, p2, p3], m, [(0, 0), (0.5, 1), (1, 0.6)], want=(0, 0, 1))
    prism(mb, I, rc + Vector((0, 0, 0.05)), 0.16, 0.12, 6, "CH_RuneCore", rot=(math.pi / 2, 0, 0))
    # floor inlay ring marking the reward spot (3 cm, decorative)
    segs2 = 16
    for i in range(segs2):
        a0 = i * 2 * math.pi / segs2; a1 = (i + 1) * 2 * math.pi / segs2
        P = lambda a, r, y: Vector((math.cos(a) * r, y, math.sin(a) * r))
        mb.face([P(a0, 0.95, 0.03), P(a1, 0.95, 0.03), P(a1, 1.18, 0.03), P(a0, 1.18, 0.03)], "CH_RockWorked", want=(0, 1, 0))
        mb.face([P(a0, 1.18, 0.0), P(a1, 1.18, 0.0), P(a1, 1.18, 0.03), P(a0, 1.18, 0.03)], "CH_RockWorked", want=(math.cos(a0), 0, math.sin(a0)))
        if i % 4 == 0:
            box(mb, I, (math.cos(a0 + 0.2) * 1.065, 0.035, math.sin(a0 + 0.2) * 1.065), (0.12, 0.012, 0.05), "CH_RuneCore", rot=(0, -(a0 + 0.2), 0))
    # outer rock shell: silhouette of a crystal-crowned outcrop behind and beside the shrine
    rock(mb, I, (0, 2.8, PZ - 3.55), (6.4, 6.2, 2.6), 11, "CH_RockStrata", subdiv=2)
    for sx in (-1, 1):
        rock(mb, I, (sx * 2.85, 1.9, PZ - 1.35), (1.9, 3.9, 2.3), 12 + sx, "CH_RockStrata", subdiv=2)
        cluster(mb, I, (sx * 2.25, 0.0, PZ - 0.75), 40 + sx, ["CH_CrystalCyan", "CH_CrystalOrchid", "CH_CrystalCyan"], 5, 1.4, up=(sx * 0.5, 1, 0.1))
    rock(mb, I, (0, apex + 0.5, PZ - 2.2), (3.4, 1.8, 1.8), 15, "CH_RockStrata", subdiv=1)
    # crown: fan of great crystals above the keystone
    crown = [(0, 2.4, 0, "CH_CrystalOrchid"), (-0.5, 1.7, 0.45, "CH_CrystalCyan"), (0.55, 1.8, -0.5, "CH_CrystalCyan"),
             (-0.95, 1.2, 0.8, "CH_CrystalOrchid"), (1.0, 1.1, -0.85, "CH_CrystalOrchid"), (-0.2, 1.3, 0.2, "CH_CrystalCyan"), (0.3, 1.0, -0.25, "CH_CrystalCyan")]
    for (dx, L, tilt, m) in crown:
        shard(mb, I, (dx * 0.5, apex + 0.35, PZ - 0.35), (math.sin(tilt) * -1, 1, -0.2), L * 1.4, L * 0.22, m, twist=dx)
    return mb

def build_chasm_arch():
    mb = MB("chasm_arch"); rng = random.Random(9)
    PX = 6.6
    for sx in (-1, 1):  # piers rising from the chasm floor (y=-5.2) past the bridge level
        for k in range(6):
            y = -5.2 + k * 1.05
            box(mb, I, (sx * PX + rng.uniform(-0.05, 0.05), y + 0.52, 0), (1.25 - k * 0.02, 1.02, 1.3 - k * 0.02), "CH_RockWorked", rot=(0, rng.uniform(-0.05, 0.05), 0))
        rock(mb, I, (sx * (PX + 0.9), -0.6, 0.2), (2.2, 3.4, 2.4), 20 + sx, "CH_RockStrata", subdiv=1)
        box(mb, I, (sx * PX, 1.25, 0), (1.5, 0.35, 1.5), "CH_RockWorked")
    SPR, RAD = 1.42, 6.75
    apex = voussoir_arch(mb, PX, SPR, RAD, 0.8, -0.6, 0.6, 11, "CH_RockWorked", 5)
    box(mb, I, (0, apex + 0.1, 0), (0.9, 1.3, 1.5), "CH_RockWorked", taper=1.15)
    cluster(mb, I, (0, apex - 0.45, 0), 91, ["CH_CrystalCyan", "CH_CrystalOrchid"], 5, 1.3, up=(0, -1, 0))
    # old mining tie-beam with hanging crystal lanterns (well above head height)
    for sx in (-1, 1):
        x = sx * 3.2; top = SPR + math.sqrt(max(0, RAD ** 2 - (abs(x) + (RAD - PX)) ** 2)) - 0.4
        box(mb, I, (x, (top + 4.6) / 2, 0), (0.05, top - 4.6, 0.05), "CH_Iron")
        prism(mb, I, (x, 4.55, 0), 0.16, 0.06, 6, "CH_Iron")
        for i in range(4):
            a = i * math.pi / 2 + 0.4
            box(mb, I, (x + math.cos(a) * 0.14, 4.3, math.sin(a) * 0.14), (0.03, 0.5, 0.03), "CH_Iron")
        prism(mb, I, (x, 4.05, 0), 0.16, 0.05, 6, "CH_Iron")
        m = "CH_CrystalOrchid" if sx < 0 else "CH_CrystalCyan"
        shard(mb, I, (x, 4.3, 0), (0, 1, 0), 0.22, 0.08, m, bury=0.0); shard(mb, I, (x, 4.3, 0), (0, -1, 0), 0.22, 0.08, m, bury=0.0)
    return mb

def build_spire(name, mat, alt):
    mb = MB(name)
    rock(mb, I, (0, 0.25, 0), (1.9, 0.8, 1.6), 30, "CH_RockStrata", subdiv=1)
    rock(mb, I, (0.8, 0.15, 0.5), (0.9, 0.5, 0.8), 31, "CH_RockStrata", subdiv=1)
    cluster(mb, I, (0, 0.2, 0), 50 if alt else 51, [mat, mat, alt], 7, 2.6, spread=0.5)
    cluster(mb, I, (0.75, 0.25, 0.55), 52, [mat], 3, 0.9)
    return mb

def build_glow(name, mat):
    mb = MB(name); n = 20
    ring = [Vector((math.cos(i * 2 * math.pi / n), 0.015, math.sin(i * 2 * math.pi / n))) for i in range(n)]
    c = Vector((0, 0.015, 0))
    for i in range(n):
        j = (i + 1) % n
        mb.face([c, ring[i], ring[j]], mat, [(0.5, 0.5), (0.5 + ring[i].x / 2, 0.5 + ring[i].z / 2), (0.5 + ring[j].x / 2, 0.5 + ring[j].z / 2)], want=(0, 1, 0))
    return mb

def build_stud(name, mat):
    mb = MB(name)
    prism(mb, I, (0, 0.02, 0), 0.17, 0.05, 6, "CH_RockWorked", top_scale=0.85, caps=(False, True))
    for k, (dx, dz, L, t) in enumerate(((0, 0, 0.24, 0.0), (0.06, 0.05, 0.14, 0.5), (-0.07, 0.03, 0.12, -0.5))):
        shard(mb, I, (dx, 0.03, dz), (math.sin(t), 1, 0.2), L, L * 0.2, mat, twist=k)
    return mb

def build_waymarker():
    """Lodestone waymarker for control A.  Front (+Z) faces the control."""
    mb = MB("lodestone_waymarker")
    rock(mb, I, (0, 0.2, 0), (0.95, 0.5, 0.85), 60, "CH_RockStrata", subdiv=1)
    tilt = (-0.1, 0, 0.03)
    box(mb, I, (0, 0.95, -0.02), (0.46, 1.25, 0.32), "CH_RockWorked", rot=tilt, taper=0.72)
    L = Matrix.Translation(Vector((0, 0.95, -0.02))) @ Matrix.Rotation(-0.1, 4, "X")
    for (x, y, sx, sy, rz) in ((0, 0.25, 0.04, 0.5, 0), (-0.07, -0.12, 0.035, 0.18, 0.75), (0.07, -0.12, 0.035, 0.18, -0.75), (0, -0.3, 0.12, 0.035, 0)):
        box(mb, L, (x, y, 0.155), (sx, sy, 0.02), "CH_RuneCore", rot=(0, 0, rz))  # chevron pointing down at the control
    top = xf(L, (0, 0.62, 0))
    for i in range(3):
        a = i * 2 * math.pi / 3
        box(mb, I, (top.x + math.cos(a) * 0.1, top.y + 0.12, top.z + math.sin(a) * 0.1), (0.035, 0.3, 0.035), "CH_Iron", rot=(math.sin(a) * 0.35, 0, -math.cos(a) * 0.35))
    ctr = top + Vector((0, 0.36, 0.02)); d = Vector((0, 1, 0.45)).normalized()
    shard(mb, I, ctr, d, 0.36, 0.13, "CH_CrystalCyan", bury=0.0)
    shard(mb, I, ctr, -d, 0.26, 0.13, "CH_CrystalCyan", bury=0.0)
    cluster(mb, I, (0.3, 0.15, 0.3), 61, ["CH_CrystalCyan"], 3, 0.42, up=(0.4, 1, 0.5))
    cluster(mb, I, (-0.35, 0.12, 0.15), 62, ["CH_CrystalCyan", "CH_CrystalOrchid"], 2, 0.3, up=(-0.4, 1, 0.3))
    return mb

def build_lens_post():
    """Miner's lens post for control B.  The bracket arm and lantern reach toward +Z (the control)."""
    mb = MB("miners_lens_post"); rng = random.Random(70)
    for k, (x, z, s) in enumerate(((0, 0, 0.75), (0.32, 0.18, 0.45), (-0.28, 0.22, 0.4))):
        rock(mb, I, (x, s * 0.25, z), (s, s * 0.55, s * 0.9), 71 + k, "CH_RockStrata", subdiv=1)
    box(mb, I, (0, 1.4, -0.05), (0.2, 2.8, 0.2), "CH_Timber", rot=(0, 0.1, 0))
    for y in (0.75, 2.2):
        box(mb, I, (0, y, -0.05), (0.23, 0.07, 0.23), "CH_Iron", rot=(0, 0.1, 0))
    box(mb, I, (0, 2.62, 0.4), (0.14, 0.14, 1.05), "CH_Timber")
    box(mb, I, (0, 2.3, 0.2), (0.09, 0.09, 0.6), "CH_Timber", rot=(-0.8, 0, 0))
    for i in range(3):  # chain
        box(mb, I, (0, 2.48 - i * 0.09, 0.82), (0.05 if i % 2 else 0.015, 0.09, 0.015 if i % 2 else 0.05), "CH_Iron")
    prism(mb, I, (0, 2.2, 0.82), 0.15, 0.05, 6, "CH_Iron")
    prism(mb, I, (0, 1.9, 0.82), 0.15, 0.05, 6, "CH_Iron")
    for i in range(4):
        a = i * math.pi / 2 + 0.3
        box(mb, I, (math.cos(a) * 0.13, 2.05, 0.82 + math.sin(a) * 0.13), (0.025, 0.28, 0.025), "CH_Iron")
    shard(mb, I, (0, 2.05, 0.82), (0, 1, 0), 0.13, 0.075, "CH_CrystalOrchid", bury=0.0)
    shard(mb, I, (0, 2.05, 0.82), (0, -1, 0), 0.13, 0.075, "CH_CrystalOrchid", bury=0.0)
    # waist-height lens ring facing the control
    lc = Vector((0, 1.15, 0.12))
    for i in range(8):
        a = i * math.pi / 4
        box(mb, I, lc + Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, 0)), (0.16, 0.04, 0.05), "CH_Iron", rot=(0, 0, a + math.pi / 2))
    shard(mb, I, lc, (0, 0, 1), 0.1, 0.17, "CH_CrystalOrchid", bury=0.0)
    shard(mb, I, lc, (0, 0, -1), 0.05, 0.17, "CH_CrystalOrchid", bury=0.0)
    # a leaning pick, left behind by the old miners
    box(mb, I, (-0.3, 0.45, 0.2), (0.05, 0.95, 0.05), "CH_Timber", rot=(0.15, 0, 0.3))
    box(mb, I, (-0.44, 0.9, 0.27), (0.55, 0.06, 0.06), "CH_Iron", rot=(0.15, 0, 0.3), taper=0.6)
    return mb

# ------------------------------------------------------------------ layout (relative to zone centre)
R_WALL = 14.6
WALL_PATTERN = ["cave_wall_strata", "cave_wall_vein", "cave_wall_strata", "cave_wall_mine", "cave_wall_strata", "cave_wall_vein", "cave_wall_strata",
                "cave_wall_mine", "cave_wall_vein", "cave_wall_strata", "cave_wall_vein", "cave_wall_strata", "cave_wall_mine", "cave_wall_vein"]

def facing_center(x, z):
    return math.degrees(math.atan2(-x, -z))

def facing(fx, fz, tx, tz):
    return math.degrees(math.atan2(tx - fx, tz - fz))

def layout():
    P = []
    for i, name in enumerate(WALL_PATTERN):
        a = math.radians(i * 360 / 14 + 6.4)
        x, z = math.cos(a) * R_WALL, math.sin(a) * R_WALL
        P.append(dict(piece=name, position=[round(x, 3), 0.0, round(z, 3)], rotation_y_deg=round(facing_center(x, z), 2), scale=1.0))
    P.append(dict(piece="cave_ceiling_cluster", position=[0.0, 10.35, 0.5], rotation_y_deg=0.0, scale=1.0))
    for i in range(6):
        a = math.radians(i * 60 + 30)
        P.append(dict(piece="cave_ceiling_cluster", position=[round(math.cos(a) * 8.2, 3), 10.2, round(math.sin(a) * 8.2, 3)], rotation_y_deg=float(i * 67 % 360), scale=1.0))
    P.append(dict(piece="chasm_arch", position=[0.0, 0.0, -3.6], rotation_y_deg=0.0, scale=1.0))
    P.append(dict(piece="prism_vault", position=[0.0, 0.0, -10.5], rotation_y_deg=0.0, scale=1.0))
    for i, adeg in enumerate((15, 125, 165, 200, 250, 320)):
        a = math.radians(adeg); x, z = math.cos(a) * 12.4, math.sin(a) * 12.4
        piece = "crystal_spire_cyan" if i % 2 == 0 else "crystal_spire_orchid"
        P.append(dict(piece=piece, position=[round(x, 3), 0.0, round(z, 3)], rotation_y_deg=float(adeg * 3 % 360), scale=1.0))
        P.append(dict(piece="glow_pool_cyan" if i % 2 == 0 else "glow_pool_orchid", position=[round(x, 3), 0.0, round(z, 3)], rotation_y_deg=0.0, scale=2.6))
    A = (-2.3, 2.8); B = (2.3, -7.0)
    wa = (-3.45, 3.25); wb = (4.2, -6.6)
    P.append(dict(piece="lodestone_waymarker", position=[wa[0], 0.0, wa[1]], rotation_y_deg=round(facing(*wa, *A), 2), scale=1.0, guides="control_A"))
    P.append(dict(piece="miners_lens_post", position=[wb[0], 0.0, wb[1]], rotation_y_deg=round(facing(*wb, *B), 2), scale=1.0, guides="control_B"))
    P.append(dict(piece="glow_pool_cyan", position=[A[0] - 0.6, 0.0, A[1] + 0.2], rotation_y_deg=0.0, scale=1.6))
    P.append(dict(piece="glow_pool_orchid", position=[B[0] + 0.6, 0.0, B[1] + 0.1], rotation_y_deg=0.0, scale=1.6))
    P.append(dict(piece="glow_pool_orchid", position=[0.0, 0.0, -10.5], rotation_y_deg=0.0, scale=2.2))
    for (x, z) in ((1.9, 7.6), (1.9, 6.1), (-1.9, 5.0), (-3.3, 4.4)):  # cyan trail: entry -> control A (corridor edges)
        P.append(dict(piece="trail_stud_cyan", position=[x, 0.0, z], rotation_y_deg=float(int(x * 97 + z * 31) % 360), scale=1.0))
    for (x, z) in ((1.75, -6.35), (3.2, -7.9), (1.8, -8.6)):  # orchid trail: bridge end -> control B
        P.append(dict(piece="trail_stud_orchid", position=[x, 0.0, z], rotation_y_deg=float(int(x * 97 + z * 31) % 360), scale=1.0))
    for x in (-1.5, 1.5):  # vault approach markers
        P.append(dict(piece="trail_stud_cyan", position=[x, 0.0, -9.0], rotation_y_deg=0.0, scale=1.0))
    return P

COLLISION = [
    dict(shape="box", for_piece="prism_vault", position=[-1.55, 1.52, -11.35], size=[0.82, 3.05, 0.82], note="left pillar"),
    dict(shape="box", for_piece="prism_vault", position=[1.55, 1.52, -11.35], size=[0.82, 3.05, 0.82], note="right pillar"),
    dict(shape="box", for_piece="prism_vault", position=[0.0, 1.6, -12.85], size=[3.6, 3.2, 0.6], note="apse back wall; leaves reward at (0,0,-10.5) open"),
    dict(shape="box", for_piece="prism_vault", position=[-2.85, 1.6, -12.7], size=[1.7, 3.2, 1.9], note="left shell rock"),
    dict(shape="box", for_piece="prism_vault", position=[2.85, 1.6, -12.7], size=[1.7, 3.2, 1.9], note="right shell rock"),
    dict(shape="box", for_piece="chasm_arch", position=[-6.6, -1.8, -3.6], size=[1.4, 6.8, 1.4], note="left pier (from chasm floor)"),
    dict(shape="box", for_piece="chasm_arch", position=[6.6, -1.8, -3.6], size=[1.4, 6.8, 1.4], note="right pier"),
    dict(shape="cylinder", for_piece="lodestone_waymarker", position=[-3.45, 0.8, 3.25], radius=0.4, height=1.6, note="waymarker body"),
    dict(shape="cylinder", for_piece="miners_lens_post", position=[4.2, 0.9, -6.6], radius=0.35, height=1.8, note="post + footing; the arm/lantern above 1.8 m needs no collision"),
    dict(shape="ring_of_boxes", for_piece="cave_wall_*", note="keep the existing 16 box walls at radius 14.5 as collision (make their meshes invisible) OR one box per wall placement: local centre (0,5.9,-1.2), size (7.4,11.8,2.6), rotated with the placement"),
]
for adeg in (15, 125, 165, 200, 250, 320):
    a = math.radians(adeg)
    COLLISION.append(dict(shape="cylinder", for_piece="crystal_spire_*", position=[round(math.cos(a) * 12.4, 3), 1.0, round(math.sin(a) * 12.4, 3)], radius=0.9, height=2.0, note="spire base"))

KEEPOUT = [  # (name, kind, params) in zone-relative game coords; checked below head/hand height
    ("bridge_and_corridor", "box", (-1.35, 1.35, -6.4, -0.8), 2.4),
    ("main_corridor_entry_to_far", "box", (-1.3, 1.3, -10.0, 8.5), 2.4),
    ("control_A", "circle", (-2.3, 2.8, 0.75), 2.2),
    ("control_B", "circle", (2.3, -7.0, 0.75), 2.2),
    ("reward_vault", "box", (-1.2, 1.2, -11.2, -9.2), 3.0),
    ("return_portal", "circle", (7.5, 9.5, 1.6), 3.0),
    ("enemy_golem", "circle", (3.0, -8.0, 0.9), 2.2),
    ("enemy_prismwatch", "circle", (-5.0, -7.5, 0.9), 2.2),
] + [("ore_%d" % i, "circle", (-7 + i * 4.5, -10.0, 0.6), 1.5) for i in range(4)]
DECOR_ONLY = {"trail_stud_cyan", "trail_stud_orchid", "glow_pool_cyan", "glow_pool_orchid"}

def clearance(P, verts):
    issues = []
    for pl in P:
        if pl["piece"] in DECOR_ONLY: continue
        a = math.radians(pl["rotation_y_deg"]); ca, sa = math.cos(a), math.sin(a); s = pl["scale"]
        px, py, pz = pl["position"]
        for (name, kind, prm, hmax) in KEEPOUT:
            hits = 0
            for v in verts[pl["piece"]]:
                x = px + s * (v.x * ca + v.z * sa); z = pz + s * (-v.x * sa + v.z * ca); y = py + s * v.y
                if y < 0.05 or y > hmax: continue
                if kind == "box": inside = prm[0] <= x <= prm[1] and prm[2] <= z <= prm[3]
                else: inside = math.hypot(x - prm[0], z - prm[1]) <= prm[2]
                if inside: hits += 1
            if hits:
                # the vault is *meant* to surround the reward; only its interior volume matters
                if pl["piece"] == "prism_vault" and name == "reward_vault":
                    continue
                issues.append(dict(piece=pl["piece"], position=pl["position"], keepout=name, vertices=hits))
    return issues

# ------------------------------------------------------------------ scene + export
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def export_glb(ob, path):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_image_format="AUTO", export_materials="EXPORT",
                              export_extras=False, export_cameras=False, export_lights=False)

def main():
    reset()
    build_materials()
    kit = bpy.data.collections.new("KIT_pieces"); bpy.context.scene.collection.children.link(kit)
    lay = bpy.data.collections.new("LAYOUT_crystal_hollow"); bpy.context.scene.collection.children.link(lay)
    ctx = bpy.data.collections.new("CONTEXT_not_exported"); bpy.context.scene.collection.children.link(ctx)
    builders = [
        build_wall("cave_wall_strata", 101, "strata"), build_wall("cave_wall_vein", 202, "vein"), build_wall("cave_wall_mine", 303, "mine"),
        build_ceiling("cave_ceiling_cluster", 404), build_chasm_arch(), build_vault(),
        build_waymarker(), build_lens_post(),
        build_spire("crystal_spire_cyan", "CH_CrystalCyan", "CH_CrystalOrchid"), build_spire("crystal_spire_orchid", "CH_CrystalOrchid", "CH_CrystalCyan"),
        build_stud("trail_stud_cyan", "CH_CrystalCyan"), build_stud("trail_stud_orchid", "CH_CrystalOrchid"),
        build_glow("glow_pool_cyan", "CH_GlowCyan"), build_glow("glow_pool_orchid", "CH_GlowOrchid"),
    ]
    objs = {}; verts = {}; stats = {}
    for mb in builders:
        ob = mb.to_object(kit); objs[mb.name] = ob; verts[mb.name] = mb.v
        xs = [v.x for v in mb.v]; ys = [v.y for v in mb.v]; zs = [v.z for v in mb.v]
        stats[mb.name] = dict(triangles=mb.tris(), materials=sorted(set(mb.m)),
                              bounds_min=[round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
                              bounds_max=[round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)])
    for name, ob in objs.items():
        export_glb(ob, os.path.join(OUT, "glb", name + ".glb"))
    P = layout()
    for i, pl in enumerate(P):
        src = objs[pl["piece"]]
        inst = bpy.data.objects.new("%s.%02d" % (pl["piece"], i), src.data); lay.objects.link(inst)
        inst.location = g2b(pl["position"]); inst.rotation_euler = (0, 0, math.radians(pl["rotation_y_deg"])); inst.scale = (pl["scale"],) * 3
    kit.hide_render = True
    for ob in kit.objects: ob.hide_set(True)
    issues = clearance(P, verts)
    placed_tris = sum(stats[p["piece"]]["triangles"] for p in P)
    used_mats = sorted(set(m for p in P for m in stats[p["piece"]]["materials"]))
    data = dict(
        schema="brann.crystal_hollow.layout/1", zone="crystal_hollow", zone_center_world=[52, 0, 52],
        coordinates="positions relative to zone centre; metres; +Y up; rotation_y_deg is Godot rotation.y (degrees) with piece front = local +Z",
        pieces={k: dict(file="glb/%s.glb" % k, **v) for k, v in stats.items()},
        placements=P, collision_proxies=COLLISION,
        preserved_anchors=dict(entry=[0, 0, 8], far_platform=[0, 0, -10.5], bridge_z=[-1, -6], control_A=[-2.3, 0, 2.8], control_B=[2.3, 0, -7],
                               reward_vault=[0, 0, -10.5], return_portal=[7.5, 0, 9.5], enemies=[[-5, 0, -7.5], [3, 0, -8]], ore_z=-10, ore_x=[-7, -2.5, 2, 6.5]),
        keepout_zones=[dict(name=n, kind=k, params=list(p), checked_up_to_y=h) for (n, k, p, h) in KEEPOUT],
        clearance_issues=issues, placed_triangles=placed_tris, placed_material_slots=used_mats,
    )
    with open(os.path.join(OUT, "layout.json"), "w") as f: json.dump(data, f, indent=1)
    build_context(ctx)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "crystal_hollow_source.blend"), compress=True)
    print("BUILD placed_tris=%d mats=%d issues=%d t=%.1fs" % (placed_tris, len(used_mats), len(issues), time.time() - T0))
    for it in issues: print("CLEARANCE", it)
    if RENDER: render_all(objs)
    inspect_glbs(stats)
    print("DONE t=%.1fs" % (time.time() - T0))

# ------------------------------------------------------------------ context proxies (render only)
def ctx_mat(name, col, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = 0.95
    if emit: b.inputs["Emission Color"].default_value = (*col, 1); b.inputs["Emission Strength"].default_value = emit
    return m

def ctx_box(coll, name, center, size, mat):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    ob.location = g2b(center); ob.scale = (size[0], size[2], size[1]); me.materials.append(mat)
    return ob

def build_context(coll):
    fl = ctx_mat("ctx_floor", (0.20, 0.20, 0.25)); dark = ctx_mat("ctx_abyss", (0.03, 0.05, 0.09)); wood = ctx_mat("ctx_plank", (0.38, 0.26, 0.16))
    red = ctx_mat("ctx_control", (1.0, 0.35, 0.1), 2.0); gold = ctx_mat("ctx_reward", (1.0, 0.8, 0.3), 2.0); ore = ctx_mat("ctx_ore", (0.4, 0.9, 0.9), 1.0)
    enemy = ctx_mat("ctx_enemy", (0.55, 0.15, 0.15)); portal = ctx_mat("ctx_portal", (0.3, 1.0, 0.5), 2.0); slab = ctx_mat("ctx_slab", (0.12, 0.13, 0.18))
    ctx_box(coll, "ctx_floor_front", (0, -0.05, 6.5), (30, 0.1, 17), fl)
    ctx_box(coll, "ctx_floor_back", (0, -0.05, -10.5), (30, 0.1, 9), fl)
    ctx_box(coll, "ctx_chasm_floor", (0, -5, -4), (30, 0.25, 5), dark)
    ctx_box(coll, "ctx_ceiling_slab", (0, 11, 0), (31, 2, 31), slab)
    for i in range(9): ctx_box(coll, "ctx_plank_%d" % i, (0, 0.045, -1.3 - i * 0.57), (2.2, 0.13, 0.53), wood)
    for sx in (-1, 1):
        for z in (-1, -3.5, -6): ctx_box(coll, "ctx_post", (sx * 1.13, 0.6, z), (0.12, 1.2, 0.12), wood)
    for (x, z) in ((-2.3, 2.8), (2.3, -7)): ctx_box(coll, "ctx_control", (x, 0.5, z), (0.3, 1.0, 0.3), red)
    ctx_box(coll, "ctx_reward", (0, 0.45, -10.5), (0.7, 0.9, 0.5), gold)
    for i in range(4): ctx_box(coll, "ctx_ore", (-7 + i * 4.5, 0.4, -10), (0.6, 0.8, 0.6), ore)
    for (x, z) in ((3, -8), (-5, -7.5)): ctx_box(coll, "ctx_enemy", (x, 0.9, z), (0.8, 1.8, 0.8), enemy)
    ctx_box(coll, "ctx_portal", (7.5, 1.2, 9.5), (1.6, 2.4, 0.2), portal)
    # the game's six existing glow_lights (range 10) approximated as point lights
    for i in range(6):
        a = i * 2 * math.pi / 6
        ld = bpy.data.lights.new("ctx_glow_%d" % i, "POINT"); ld.energy = 900; ld.shadow_soft_size = 0.5
        ld.color = (0.41, 0.79, 0.92) if i % 2 else (0.82, 0.52, 0.82)
        lo = bpy.data.objects.new(ld.name, ld); coll.objects.link(lo); lo.location = g2b((math.cos(a) * 8, 2.0, math.sin(a) * 8))

# ------------------------------------------------------------------ renders
def setup_render():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: sc.render.engine = eng; break
        except Exception: pass
    sc.render.resolution_x = 1280; sc.render.resolution_y = 720; sc.render.film_transparent = False
    try: sc.eevee.taa_render_samples = 32
    except Exception: pass
    w = bpy.data.worlds.new("cave"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.006, 0.012, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = w
    try: sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Punchy"
    except Exception: pass
    sc.view_settings.exposure = 0.6
    try:
        sc.use_nodes = True; nt = sc.node_tree
        rl = nt.nodes.get("Render Layers") or nt.nodes.new("CompositorNodeRLayers")
        comp = nt.nodes.get("Composite") or nt.nodes.new("CompositorNodeComposite")
        gl = nt.nodes.new("CompositorNodeGlare")
        try: gl.glare_type = "BLOOM"
        except Exception: gl.glare_type = "FOG_GLOW"
        for key, val in (("Threshold", 1.0), ("Strength", 0.6), ("Size", 0.6)):
            if key in gl.inputs: gl.inputs[key].default_value = val
        try: gl.threshold = 1.0; gl.size = 7
        except Exception: pass
        nt.links.new(rl.outputs["Image"], gl.inputs["Image"]); nt.links.new(gl.outputs["Image"], comp.inputs["Image"])
    except Exception as e:
        print("glare setup skipped:", e)

def cam_shot(name, eye, target, lens=24, ortho=None):
    sc = bpy.context.scene
    cd = bpy.data.cameras.get("cam") or bpy.data.cameras.new("cam")
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", cd)
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    cd.lens = lens; cd.clip_end = 200
    if ortho: cd.type = "ORTHO"; cd.ortho_scale = ortho
    else: cd.type = "PERSP"
    cam.location = g2b(eye)
    d = Vector(g2b(target)) - Vector(g2b(eye)); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, "renders", name + ".png")
    bpy.ops.render.render(write_still=True)
    print("render", name, "%.1fs" % (time.time() - T0))

def render_all(objs):
    setup_render()
    shots = [
        ("01_eye_entry_to_vault", (0, 1.65, 8.0), (0, 2.2, -10.5), 22),
        ("02_overview_front_high", (0, 6.5, 13.0), (0, 1.5, -6), 20),
        ("03_overview_three_quarter", (7.5, 6.0, 7.5), (-2, 1.5, -6), 18),
        ("04_eye_control_A_waymarker", (-0.3, 1.65, 6.3), (-2.6, 1.0, 2.8), 26),
        ("05_eye_bridge_to_vault", (0.2, 1.65, -0.5), (0, 2.0, -10.5), 24),
        ("06_eye_control_B_lens_post", (0.6, 1.65, -5.2), (3.0, 1.2, -7.2), 26),
        ("07_vault_front_close", (0, 1.65, -6.9), (0, 2.3, -11.2), 22),
        ("08_vault_three_quarter", (4.2, 2.2, -6.2), (0, 2.3, -11.0), 22),
        ("09_eye_far_platform_back_to_entry", (0, 1.65, -9.0), (0, 2.5, 8), 20),
        ("10_plan_top_down", (0, 60, 0.001), (0, 0, 0), 50),
    ]
    ceil_hide = [o for o in bpy.data.objects if o.name.startswith("cave_ceiling_cluster.") or o.name == "ctx_ceiling_slab"]
    for (n, e, t, lens) in shots:
        top = n.startswith("10")
        for o in ceil_hide: o.hide_render = top
        cam_shot(n, e, t, lens, ortho=34 if top else None)
    for o in ceil_hide: o.hide_render = False

# ------------------------------------------------------------------ inspection (re-import the exported GLBs)
def inspect_glbs(stats):
    out = {}
    for name in stats:
        path = os.path.join(OUT, "glb", name + ".glb")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        tris = 0; mats = set(); imgs = set(); mn = [1e9] * 3; mx = [-1e9] * 3; meshes = 0
        for ob in bpy.context.scene.objects:
            if ob.type != "MESH": continue
            meshes += 1
            me = ob.data; me.calc_loop_triangles(); tris += len(me.loop_triangles)
            for m in me.materials:
                if m is None: continue
                mats.add(m.name)
                for nd in m.node_tree.nodes:
                    if nd.type == "TEX_IMAGE" and nd.image: imgs.add(nd.image.name)
            for v in me.vertices:
                w = ob.matrix_world @ v.co; g = (w.x, w.z, -w.y)
                for k in range(3): mn[k] = min(mn[k], g[k]); mx[k] = max(mx[k], g[k])
        with open(path, "rb") as f: head = f.read(20)
        out[name] = dict(bytes=os.path.getsize(path), meshes=meshes, triangles=tris, materials=sorted(mats), images=sorted(imgs),
                         dims_m=[round(mx[k] - mn[k], 3) for k in range(3)], bounds_min=[round(c, 3) for c in mn], bounds_max=[round(c, 3) for c in mx],
                         glb_magic=head[:4].decode("latin1"), builder_triangles=stats[name]["triangles"])
    with open(os.path.join(OUT, "inspection.json"), "w") as f: json.dump(out, f, indent=1)
    for k, v in out.items(): print("INSPECT", k, v["triangles"], v["materials"], v["dims_m"], v["bytes"])

main()
