# Forge Yard grounds kit - deterministic Blender 4.5 builder.
# Run: blender.exe -b -P build_forge_grounds.py   (writes into ./output)
import bpy, bmesh, math, random, json, os, time, struct
import numpy as np
from mathutils import Vector, Matrix, Euler

T0 = time.time()
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "output")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- textures
def fbm(n, seed, octs=5, base=4):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for o in range(octs):
        g = base * 2 ** o
        grid = rng.random((g, g))
        xs = np.linspace(0, g, n, endpoint=False)
        i0 = np.floor(xs).astype(int); f = xs - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % g
        top = grid[i0][:, i0] * (1 - f) + grid[i0][:, i1] * f
        bot = grid[i1][:, i0] * (1 - f) + grid[i1][:, i1] * f
        out += amp * (top * (1 - f[:, None]) + bot * f[:, None]); tot += amp; amp *= 0.5
    return out / tot

def voronoi(n, cells, seed):
    rng = np.random.default_rng(seed)
    pts = (rng.random((cells, cells, 2)) + np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1)) / cells
    pts = pts.reshape(-1, 2)
    xs = (np.arange(n) + 0.5) / n
    X, Y = np.meshgrid(xs, xs)
    f1 = np.full((n, n), 9.0); f2 = np.full((n, n), 9.0); cid = np.zeros((n, n), int)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(X - px); dx = np.minimum(dx, 1 - dx)
        dy = np.abs(Y - py); dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        m = d < f1
        f2 = np.where(m, f1, np.minimum(f2, d)); cid = np.where(m, k, cid); f1 = np.minimum(f1, d)
    return f1, f2, cid, rng.random(len(pts))

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

N = 256
def tex_stone():
    f = fbm(N, 1); f1, f2, cid, rr = voronoi(N, 7, 2)
    crack = sstep(0.0, 0.05, f2 - f1)
    lum = 0.72 * (0.72 + 0.3 * rr[cid]) * (0.82 + 0.3 * f) * (0.55 + 0.45 * crack)
    col = np.stack([lum * 0.98, lum * 0.93, lum * 0.84], -1); return np.clip(col, 0, 1)
def tex_wood():
    f = fbm(N, 3, 4, 3); x = (np.arange(N) + 0.5) / N
    grain = 0.5 + 0.5 * np.sin((x[None, :] * 26 + f * 5) * math.pi)
    lum = 0.62 + 0.28 * grain * (0.6 + 0.4 * f) + 0.1 * fbm(N, 4, 3, 16)
    return np.clip(np.stack([lum * 0.78, lum * 0.55, lum * 0.34], -1), 0, 1)
def tex_leaf():
    f = fbm(N, 5); f1, f2, cid, rr = voronoi(N, 12, 6)
    lum = (0.62 + 0.38 * rr[cid]) * (0.75 + 0.35 * f) * (0.7 + 0.3 * sstep(0, 0.07, f2 - f1))
    return np.clip(np.stack([lum * 0.9, lum * 1.0, lum * 0.82], -1), 0, 1)
def tex_soil():
    f = fbm(N, 7, 6); sp = fbm(N, 8, 3, 32)
    lum = 0.55 + 0.6 * f * 0.7 + 0.25 * (sp > 0.62)
    return np.clip(np.stack([lum * 0.62, lum * 0.42, lum * 0.27], -1), 0, 1)
def tex_ridge():
    f = fbm(N, 9); y = (np.arange(N) + 0.5) / N
    strata = 0.5 + 0.5 * np.sin((y[:, None] * 9 + f * 3) * math.pi * 2)
    lum = 0.6 + 0.4 * f + 0.05 * strata
    return np.clip(np.stack([lum * 0.96, lum * 0.93, lum * 0.9], -1), 0, 1)

def make_img(name, rgb):
    img = bpy.data.images.new(name, N, N, alpha=False)
    arr = np.ones((N, N, 4), np.float32); arr[..., :3] = rgb
    img.pixels.foreach_set(arr.ravel()); img.update(); img.pack()
    img.colorspace_settings.name = "sRGB"; return img

def mk_mat(name, img, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs[1]); nt.links.new(vc.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = rough; bs.inputs["Metallic"].default_value = 0.0
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"]); return m

MATS = [mk_mat("mat_stone", make_img("tex_stone", tex_stone()), 0.9),
        mk_mat("mat_wood", make_img("tex_wood", tex_wood()), 0.8),
        mk_mat("mat_leaf", make_img("tex_leaf", tex_leaf()), 0.75),
        mk_mat("mat_soil", make_img("tex_soil", tex_soil()), 1.0),
        mk_mat("mat_ridge", make_img("tex_ridge", tex_ridge()), 0.95)]
STONE, WOOD, LEAF, SOIL, RIDGE = range(5)

# ---------------------------------------------------------------- builder
class B:
    def __init__(s, name, seed):
        s.name = name; s.bm = bmesh.new(); s.rng = random.Random(seed)
        s.cl = s.bm.loops.layers.color.new("Col"); s.bm.loops.layers.uv.new("UVMap")
    def prim(s, kind, mat, col=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), jit=0.0,
             cv=0.08, smooth=True, seg=10, r2=0.5, sub=2):
        bm = s.bm; r = s.rng
        if kind == "cube": res = bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
        elif kind == "sphere": res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=0.5, calc_uvs=True)
        else: res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=0.5,
                                          radius2=r2, depth=1.0, calc_uvs=True)
        vs = res["verts"]
        M = Matrix.LocRotScale(Vector(loc), Euler(rot).to_quaternion(), Vector(scale))
        bmesh.ops.transform(bm, matrix=M, verts=vs)
        if jit:
            for v in vs: v.co += Vector((r.uniform(-jit, jit), r.uniform(-jit, jit), r.uniform(-jit, jit)))
        k = 1 + r.uniform(-cv, cv)
        c = (min(col[0] * k, 1), min(col[1] * k, 1), min(col[2] * k, 1), 1)
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mat; f.smooth = smooth
            for l in f.loops: l[s.cl] = c
    def finish(s, coll):
        bm = s.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(s.name); bm.to_mesh(me); bm.free()
        for m in MATS: me.materials.append(m)
        ob = bpy.data.objects.new(s.name, me); coll.objects.link(ob); return ob

def coll_new(name):
    c = bpy.data.collections.new(name); scene.collection.children.link(c); return c

GREEN = (0.30, 0.62, 0.16); GREEN2 = (0.42, 0.72, 0.2); DGREEN = (0.2, 0.46, 0.14)
FLOWERS = [(1.0, 0.45, 0.55), (1.0, 0.85, 0.3), (0.85, 0.55, 1.0), (1.0, 1.0, 0.9)]

def cabbage(b, x, y, s=1.0):
    b.prim("sphere", LEAF, GREEN2, (x, y, 0.42 + 0.08 * s), scale=(0.42 * s, 0.42 * s, 0.3 * s), jit=0.02, sub=2)
    b.prim("sphere", LEAF, DGREEN, (x, y, 0.5 + 0.08 * s), scale=(0.28 * s, 0.28 * s, 0.22 * s), jit=0.015, sub=1)

def flower(b, x, y, h, colr):
    b.prim("cyl", LEAF, GREEN, (x, y, 0.4 + h / 2), scale=(0.025, 0.025, h), seg=5)
    b.prim("sphere", LEAF, colr, (x, y, 0.4 + h), scale=(0.11, 0.11, 0.08), sub=1, cv=0.12)

def tuft(b, x, y, z, s, colr=GREEN, n=5):
    s = s * 0.7
    for i in range(n):
        a = i / n * 6.283 + b.rng.uniform(0, 1); l = s * b.rng.uniform(0.7, 1.2)
        b.prim("cyl", LEAF, colr, (x + math.cos(a) * s * 0.18, y + math.sin(a) * s * 0.18, z + l * 0.45),
               rot=(math.sin(a) * 0.35, -math.cos(a) * 0.35, 0), scale=(0.06 * s, 0.03 * s, l), r2=0.0, seg=4)

def wall_block(b, x, y, z, w, d, h, rz, c=(0.95, 0.93, 0.88)):
    b.prim("cube", STONE, c, (x, y, z), rot=(0, 0, rz), scale=(w, d, h), jit=0.03, smooth=False, cv=0.1)

# ---- garden bed A: rectangular herb/cabbage bed with low dry-stone wall
def build_bed_a(coll):
    b = B("garden_bed_a", 11); L, Wd = 4.0, 1.4
    for course, (z, h) in enumerate([(0.15, 0.3), (0.38, 0.2)]):
        off = 0.25 * course
        n = int(L / 0.5)
        for i in range(n):
            x = -L / 2 + 0.25 + i * (L - 0.5) / (n - 1) + off * 0.3 * (1 if i % 2 else -1)
            for sy in (-1, 1):
                wall_block(b, x, sy * (Wd / 2 - 0.02), z, b.rng.uniform(0.44, 0.52), 0.34, h, b.rng.uniform(-0.08, 0.08))
        m = int(Wd / 0.45)
        for i in range(m):
            y = -Wd / 2 + 0.3 + i * (Wd - 0.6) / max(1, m - 1)
            for sx in (-1, 1):
                wall_block(b, sx * (L / 2 - 0.02), y, z, 0.34, 0.44, h, b.rng.uniform(-0.08, 0.08))
    b.prim("cube", SOIL, (1, 1, 1), (0, 0, 0.18), scale=(L - 0.3, Wd - 0.3, 0.34), jit=0.01, smooth=False)
    for i in range(5): cabbage(b, -1.5 + i * 0.75 + b.rng.uniform(-.06, .06), -0.32 + 0.07 * (i % 2), b.rng.uniform(.85, 1.1))
    for i in range(6):
        x = -1.75 + i * 0.7
        tuft(b, x, 0.32 + b.rng.uniform(-.05, .05), 0.33, 1.1, GREEN2, 7)
        flower(b, x + 0.2, 0.18, b.rng.uniform(0.35, 0.6), FLOWERS[i % 4])
    for x in (-1.95, 1.95): tuft(b, x, 0.0, 0.33, 1.3, DGREEN, 8)
    return b.finish(coll)

# ---- planter B: round stone planter with a little tree and flowers
def build_planter_b(coll):
    b = B("garden_planter_b", 22); R = 1.15
    for course, (z, h, n) in enumerate([(0.14, 0.28, 14), (0.36, 0.2, 13)]):
        for i in range(n):
            a = (i + 0.5 * course) / n * 6.283
            wall_block(b, math.cos(a) * R, math.sin(a) * R, z, 0.58, 0.36, h, a + math.pi / 2 + b.rng.uniform(-.06, .06),
                       (0.9, 0.9, 0.86))
    b.prim("cyl", SOIL, (1, 1, 1), (0, 0, 0.2), scale=(2.05, 2.05, 0.3), seg=14, smooth=False)
    b.prim("cyl", WOOD, (0.9, 0.85, 0.8), (0, 0, 0.9), rot=(0.04, -0.03, 0), scale=(0.2, 0.2, 1.6), r2=0.3, seg=8)
    for (x, y, z, s) in [(0, 0, 1.9, 1.45), (0.55, 0.2, 1.65, 0.95), (-0.5, 0.25, 1.6, 1.0), (0.1, -0.55, 1.65, 0.9), (-0.15, 0.5, 2.15, 0.8)]:
        b.prim("sphere", LEAF, (0.28 + 0.1 * b.rng.random(), 0.6, 0.16), (x, y, z), scale=(s, s, s * 0.85), jit=0.06, sub=2, cv=0.1)
    for i in range(9):
        a = i / 9 * 6.283 + 0.3; rr = 0.75 + 0.15 * (i % 2)
        x, y = math.cos(a) * rr, math.sin(a) * rr
        if i % 3 == 0: tuft(b, x, y, 0.32, 1.1, GREEN2, 6)
        else: flower(b, x, y, b.rng.uniform(0.3, 0.55), FLOWERS[i % 4])
    b.prim("sphere", LEAF, (0.85, 0.3, 0.3), (0.35, -0.2, 0.85), scale=(0.1, 0.1, 0.1), sub=1)
    return b.finish(coll)

# ---- path edge cobbles: 3m strip along local X
def build_path_edge(coll):
    b = B("path_edge_stones", 33); L = 3.0; n = 13
    for i in range(n):
        x = -L / 2 + 0.12 + i * (L - 0.24) / (n - 1) + b.rng.uniform(-.04, .04)
        y = b.rng.uniform(-0.05, 0.05)
        b.prim("sphere", STONE, (0.95, 0.93, 0.88), (x, y, 0.03), rot=(0, 0, b.rng.uniform(0, 3)),
               scale=(b.rng.uniform(0.28, 0.4), b.rng.uniform(0.26, 0.34), b.rng.uniform(0.2, 0.3)), jit=0.015, cv=0.12)
    for i in range(9):
        x = -L / 2 + 0.2 + i * (L - 0.4) / 8 + b.rng.uniform(-.05, .05)
        b.prim("sphere", STONE, (0.85, 0.83, 0.78), (x, 0.3 + b.rng.uniform(-.05, .08), 0.0), scale=(0.16, 0.14, 0.1), sub=1, cv=0.15)
    for x, sy in [(-1.15, 1), (-0.1, -1), (0.85, 1), (1.3, -1)]:
        tuft(b, x, sy * 0.28, 0.0, 0.85, GREEN2, 6)
    for x, sy, k in [(-0.55, -1, 1), (0.45, 1, 3), (1.15, -1, 0)]:
        flower(b, x, sy * 0.33, 0.22, FLOWERS[k]);
    return b.finish(coll)

# ---- cordwood + ore rack
def build_rack(coll):
    b = B("cordwood_ore_rack", 44); W = 2.6; D = 0.8; H = 1.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.prim("cube", WOOD, (0.7, 0.55, 0.42), (sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), H / 2), scale=(0.12, 0.12, H), smooth=False, jit=0.008)
    for z in (0.2, 0.62):
        for sy in (-1, 1): b.prim("cube", WOOD, (0.8, 0.6, 0.45), (0, sy * (D / 2 - 0.06), z), scale=(W, 0.09, 0.09), smooth=False)
    b.prim("cube", WOOD, (0.75, 0.6, 0.45), (0, 0, 0.14), scale=(W - 0.2, D - 0.15, 0.06), smooth=False)
    for sy in (-1, 1): b.prim("cube", WOOD, (0.7, 0.55, 0.42), (0, sy * (D / 2 - 0.06), H), scale=(W + 0.1, 0.12, 0.12), smooth=False)
    rows = 5; cols = 9
    for r in range(rows):
        for c in range(cols):
            x = -W / 2 + 0.24 + c * 0.155 + (0.078 if r % 2 else 0)
            if x > 0.6: continue
            rad = b.rng.uniform(0.06, 0.078)
            b.prim("cyl", WOOD, (0.95, 0.75, 0.55) if (r + c) % 3 else (1, 0.9, 0.75),
                   (x, b.rng.uniform(-0.04, 0.04), 0.3 + r * 0.14), rot=(math.pi / 2, 0, 0),
                   scale=(rad * 2, rad * 2, b.rng.uniform(0.68, 0.76)), seg=8, cv=0.12)
    # sloped plank roof, higher at the back (+Y), shedding toward the front
    for i in range(5):
        b.prim("cube", WOOD, (0.55, 0.42, 0.34), (-W / 2 + 0.28 + i * 0.5, 0, H + 0.13), rot=(-0.16, 0, 0),
               scale=(0.5, D + 0.4, 0.06), smooth=False, jit=0.008, cv=0.12)
    # ore bin with glowing-blue-tinted lumps
    bx = 0.95
    for sx in (-1, 1): b.prim("cube", WOOD, (0.85, 0.7, 0.55), (bx + sx * 0.36, 0, 0.35), scale=(0.07, D - 0.1, 0.5), smooth=False)
    b.prim("cube", WOOD, (0.85, 0.7, 0.55), (bx, D / 2 - 0.12, 0.35), scale=(0.75, 0.06, 0.5), smooth=False)
    b.prim("cube", WOOD, (0.85, 0.7, 0.55), (bx, -D / 2 + 0.12, 0.35), scale=(0.75, 0.06, 0.5), smooth=False)
    for i, (x, y, z, s) in enumerate([(-0.15, 0, 0.62, .24), (0.12, 0.12, 0.6, .27), (0.1, -0.15, 0.6, .22), (-0.02, -0.02, 0.8, .22), (0.22, 0.0, 0.78, .16), (-0.22, 0.14, 0.74, .16)]):
        b.prim("sphere", STONE, (0.45, 0.7, 1.0) if i % 2 == 0 else (0.85, 0.6, 0.45), (bx + x, y, z), rot=(i, i * 2, 0),
               scale=(s, s * 0.9, s * 0.8), jit=0.04, sub=1, smooth=False)
    return b.finish(coll)

# ---- distant ridges
def build_ridge(coll, name, seed, H, haze, W=22.0, D=14.0):
    rng = np.random.default_rng(seed); ph = rng.uniform(0, 6.283, 8)
    nx, nt = 48, 18; me = bpy.data.meshes.new(name); bm = bmesh.new(); cl = bm.loops.layers.color.new("Col"); uv = bm.loops.layers.uv.new("UVMap")
    def ss(a, b_, x): t = min(max((x - a) / (b_ - a), 0), 1); return t * t * (3 - 2 * t)
    def hf(x, t):
        u = x / (W / 2)
        env = 0.1 + 0.9 * max(0.0, 1 - abs(u) ** 2.6)
        crest = 0.35 + 0.35 * ss(0.2, 0.6, t) + 0.3 * ss(0.55, 0.85, t)
        tt = t - 0.05 * math.sin(u * 4 + ph[5])
        prof = ss(0.02, 0.32, tt) * (0.45 * math.exp(-((tt - 0.4) / 0.2) ** 2) + math.exp(-((tt - 0.8) / 0.22) ** 2))
        p = 0.6 + 0.22 * math.sin(u * 5.1 + ph[0]) + 0.13 * math.sin(u * 11 + ph[1])
        r = 0.8 + 0.2 * (1 - abs(math.sin(u * 7 + ph[2]) * 0.6 + math.sin(u * 15 + ph[3]) * 0.4))
        return H * env * prof * (0.5 + 0.5 * p) * r + 0.08 * H * env * math.sin(x * 1.7 + t * 9 + ph[4]) * ss(0.05, 0.3, t)
    grid = []
    for j in range(nt + 1):
        row = []
        for i in range(nx + 1):
            x = -W / 2 + W * i / nx + (rng.uniform(-0.18, 0.18) if 0 < i < nx else 0)
            t = j / nt; y = -D / 2 + D * t + (rng.uniform(-0.2, 0.2) if 0 < j < nt else 0)
            row.append(bm.verts.new((x, y, hf(x, t) - 0.3)))
        grid.append(row)
    faces = [bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])) for j in range(nt) for i in range(nx)]
    bm.normal_update()
    hz = Vector((0.5, 0.62, 0.85))
    def vcol(v):
        z = v.co.z; nz = v.normal.z
        gr = ss(0.5, 0.8, nz) * (1 - ss(0.45, 0.85, z / H))
        rock = Vector((0.62, 0.55, 0.5)); grass = Vector((0.42, 0.78, 0.26)).lerp(Vector((0.36, 0.64, 0.24)), ss(0, 0.3, z / H))
        c = rock.lerp(grass, gr)
        tdepth = (v.co.y + D / 2) / D
        c = c.lerp(hz, min(0.85, haze + 0.15 * tdepth))
        return (c.x, c.y, c.z, 1)
    for f in faces:
        f.smooth = True
        for l in f.loops:
            l[cl] = vcol(l.vert); l[uv].uv = (l.vert.co.x / 6, (l.vert.co.y + l.vert.co.z * 0.8) / 6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if faces[0].normal.z < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    for m in MATS: me.materials.append(m)
    for p in me.polygons: p.material_index = RIDGE
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

ASSETS = {}
def reg(fn, *a, **k):
    name = a[0] if fn is build_ridge and False else None
c_bed = coll_new("A_garden_bed_a"); c_pl = coll_new("A_garden_planter_b"); c_pe = coll_new("A_path_edge_stones")
c_rk = coll_new("A_cordwood_ore_rack"); c_ra = coll_new("A_ridge_a"); c_rb = coll_new("A_ridge_b"); c_rf = coll_new("A_ridge_far")
OBJS = {
    "ridge_a": (build_ridge(c_ra, "ridge_a", 101, 10.0, 0.06), c_ra),
    "ridge_b": (build_ridge(c_rb, "ridge_b", 202, 12.5, 0.1), c_rb),
    "ridge_far": (build_ridge(c_rf, "ridge_far", 303, 11.0, 0.5, W=26.0, D=12.0), c_rf),
    "garden_bed_a": (build_bed_a(c_bed), c_bed),
    "garden_planter_b": (build_planter_b(c_pl), c_pl),
    "path_edge_stones": (build_path_edge(c_pe), c_pe),
    "cordwood_ore_rack": (build_rack(c_rk), c_rk),
}

# ---------------------------------------------------------------- export
def export(name, ob):
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    try: ob.data.color_attributes.active_color_name = "Col"
    except Exception: pass
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_materials="EXPORT",
                              export_vertex_color="ACTIVE", export_image_format="AUTO")
    # Blender 4.5 exports a default white COLOR_0 plus the authored "Col" layer
    # as COLOR_1. Godot only uses COLOR_0 for StandardMaterial3D vertex tint.
    # Promote the authored accessor without touching geometry or texture data.
    path = os.path.join(OUT, name + ".glb")
    payload = open(path, "rb").read()
    assert payload[:4] == b"glTF"
    json_size = struct.unpack_from("<I", payload, 12)[0]
    document = json.loads(payload[20:20 + json_size])
    promoted = 0
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            attributes = primitive["attributes"]
            if "COLOR_1" in attributes:
                attributes["COLOR_0"] = attributes.pop("COLOR_1")
                promoted += 1
    assert promoted > 0, f"{name}: missing authored colour accessor"
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    bin_chunk = payload[20 + json_size:]
    repaired = struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(bin_chunk))
    repaired += struct.pack("<I4s", len(encoded), b"JSON") + encoded + bin_chunk
    open(path, "wb").write(repaired)
for n, (ob, c) in OBJS.items(): export(n, ob)

# ---------------------------------------------------------------- placements (Godot coords)
P = []
def place(asset, x, y, z, rot=0.0, s=(1, 1, 1)):
    P.append({"id": f"{asset}_{len([p for p in P if p['asset'] == asset]):02d}", "asset": asset,
              "position": [round(x, 3), round(y, 3), round(z, 3)], "rotation_y_deg": round(rot, 2), "scale": [round(v, 3) for v in s]})
rj = random.Random(7)
for k in range(10):
    th = -162 + 36 * k; front = abs(th) < 60
    R = 22.5 + rj.uniform(0, 2.5); hs = (0.55 + rj.uniform(0, .12)) if front else rj.uniform(0.85, 1.15)
    ws = rj.uniform(1.0, 1.15)
    a = math.radians(th)
    place("ridge_a" if k % 2 == 0 else "ridge_b", R * math.sin(a), -0.2, R * math.cos(a), th + 180 + rj.uniform(-9, 9), (ws, ws, hs) if False else (ws, hs, ws))
for k in range(7):
    th = -150 + 50 * k; a = math.radians(th)
    place("ridge_far", 38 * math.sin(a), -0.5, 38 * math.cos(a), th + 180 + rj.uniform(-6, 6), (1.35, 1.35 + rj.uniform(0, .25), 1.35))
for sx in (-1, 1):
    place("garden_bed_a", sx * 12.4, 0, 3.2, 90)
    place("garden_planter_b", sx * 12.9, 0, -3.5)
    place("garden_planter_b", sx * 14.2, 0, 7.2, 40 * sx)
    place("garden_bed_a", sx * 5.8, 0, -10.6, 0)
    place("cordwood_ore_rack", sx * 9.75, 0, -4.2 if sx < 0 else -2.6, -90 if sx < 0 else 90)
    for zc in (1.6, 4.6, 7.6):
        place("path_edge_stones", sx * 3.05, 0, zc, 90, (1, 1, 1))
place("garden_planter_b", 0, 0, -11.6, 15)
place("garden_bed_a", -12.4, 0, 8.6 - 0, 90) if False else None

# ---------------------------------------------------------------- layout scene + render
lay = coll_new("Layout_instances")
for p in P:
    ob0 = OBJS[p["asset"]][0]; o = bpy.data.objects.new(p["id"], ob0.data); lay.objects.link(o)
    x, y, z = p["position"]; o.location = (x, -z, y); o.rotation_euler = (0, 0, math.radians(p["rotation_y_deg"]))
    sx, sy, sz = p["scale"]; o.scale = (sx, sz, sy)   # godot (x,y,z) -> blender (x,z,y)
for n, (ob, c) in OBJS.items(): ob.hide_render = True; ob.hide_viewport = True

prox = coll_new("RenderProxies_not_exported")
pb = B("proxy_env", 5)
pb.prim("cube", LEAF, (0.3, 0.58, 0.18), (0, 0, -0.1), scale=(160, 160, 0.2), cv=0, smooth=False)
pb.prim("cube", STONE, (1.0, 0.85, 0.6), (0, -4.5, 0.03), scale=(5, 9, 0.06), cv=0, smooth=False)  # visitor path
pb.prim("cube", WOOD, (0.9, 0.75, 0.6), (0, 4, 2.0), scale=(17, 8, 4), cv=0, smooth=False)          # workshop proxy
pb.prim("cube", WOOD, (0.55, 0.28, 0.2), (0, 4, 4.5), scale=(18.4, 8.8, 1.0), cv=0, smooth=False)
for px in (-10.5, -7, -3.5, 0, 3.5, 7, 10.5):
    for s in (-1, 1): pb.prim("cube", STONE, (0.55, 0.7, 1.0), (px + s * 0.9, -10.8, 1.5), scale=(0.35, 0.35, 3.0), cv=0, smooth=False)
    pb.prim("cube", STONE, (0.55, 0.7, 1.0), (px, -10.8, 3.2), scale=(2.2, 0.4, 0.4), cv=0, smooth=False)
pbo = pb.finish(prox)
pbo.data.uv_layers.active.data.foreach_set("uv", [v * (30 if False else 1) for v in [c for l in pbo.data.uv_layers.active.data for c in l.uv]]) if False else None
# tile the ground texture: scale UVs of the biggest slab
for poly in pbo.data.polygons:
    if poly.material_index == LEAF and abs(sum(pbo.data.vertices[v].co.x for v in poly.vertices)) < 1e3 and max(abs(pbo.data.vertices[v].co.x) for v in poly.vertices) > 50:
        for li in poly.loop_indices:
            uvd = pbo.data.uv_layers.active.data[li]; uvd.uv = (uvd.uv.x * 40, uvd.uv.y * 40)

world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.55, 0.72, 0.95, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
sun.data.energy = 2.2; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
scene.view_settings.view_transform = "Standard"
r = scene.render
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try: r.engine = eng; break
    except Exception: continue
if r.engine == "CYCLES": scene.cycles.samples = 24
r.resolution_x, r.resolution_y = 1280, 720; r.image_settings.file_format = "PNG"

def shoot(name, loc_g, tgt_g, lens):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); scene.collection.objects.link(cam)
    cam.data.lens = lens; cam.data.clip_end = 300
    loc = Vector((loc_g[0], -loc_g[2], loc_g[1])); tgt = Vector((tgt_g[0], -tgt_g[2], tgt_g[1]))
    cam.location = loc; cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam; r.filepath = os.path.join(OUT, name + ".png"); bpy.ops.render.render(write_still=True)
shoot("render_ground", (10.5, 1.7, 9.0), (-14, 4.0, -14), 20)
shoot("render_ground_side", (-2, 1.7, 5.0), (-22, 3.5, 2), 20)
shoot("render_rts", (0, 27, 22), (0, 0, -2), 32)

# ---------------------------------------------------------------- stats / json / blend
stats = {"builder": "build_forge_grounds.py", "blender": bpy.app.version_string, "assets": {}, "material_families": [m.name for m in MATS]}
tot = 0
for n, (ob, c) in OBJS.items():
    me = ob.data; me.calc_loop_triangles(); t = len(me.loop_triangles); tot += t
    d = ob.dimensions
    stats["assets"][n] = {"triangles": t, "vertices": len(me.vertices), "size_godot_m": [round(d.x, 2), round(d.z, 2), round(d.y, 2)],
                          "glb_bytes": os.path.getsize(os.path.join(OUT, n + ".glb"))}
stats["unique_triangles_total"] = tot
stats["placement_count"] = len(P)
stats["placement_triangles_total"] = sum(stats["assets"][p["asset"]]["triangles"] * 1 for p in P)
stats["textures"] = {i.name: [i.size[0], i.size[1]] for i in bpy.data.images if i.name.startswith("tex_")}
stats["build_seconds"] = round(time.time() - T0, 1)
json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), indent=2)

COLL = {"ridge_a": "aabb", "ridge_b": "aabb", "ridge_far": "none (decor, unreachable)", "garden_bed_a": "box 4.0x0.5x1.4 (wall only)",
        "garden_planter_b": "cylinder r1.4 h0.5 (tree canopy no collision)", "path_edge_stones": "none (or 3.0x0.2x0.5 box)", "cordwood_ore_rack": "box 2.6x1.5x0.8"}
json.dump({"schema": 1, "zone": "forge_yard", "coordinate_system": "godot, y-up meters; rotation_y_deg is Basis(Vector3.UP, deg2rad(v)); asset local +Z is its 'front' facing the hub",
           "assets": [{"id": n, "file": n + ".glb", "triangles": stats["assets"][n]["triangles"], "size_m": stats["assets"][n]["size_godot_m"],
                       "origin": "ground-level center", "suggested_collision": COLL[n], "instance": True} for n in OBJS],
           "placements": P}, open(os.path.join(OUT, "placement_forge_yard.json"), "w"), indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "forge_grounds.blend"))
print("DONE", stats["unique_triangles_total"], "tris", round(time.time() - T0, 1), "s")
