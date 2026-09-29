# Deterministic Pinewood Ruins builder. Run:
#   blender.exe -b -P build_pinewood.py -- [--only arch] [--no-render]
# Blender coords: Godot (x,y,z) == Blender (x,-z,y). Godot +Z entrance == Blender -Y.
import bpy, bmesh, math, json, os, sys, random
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else None
OUT = os.path.abspath(ARGS[ARGS.index('--out') + 1]) if '--out' in ARGS else HERE
MATS = ['stone', 'bark', 'needles', 'ground', 'flora', 'moss']
TILE = {'stone': 2.0, 'bark': 1.6, 'needles': 1.8, 'ground': 30.0, 'flora': 1.0, 'moss': 1.4}

# ---------------- procedural textures (tileable) ----------------
def vnoise(n, size, rng):
    g = rng.random((n, n)).astype(np.float32)
    x = np.linspace(0, n, size, endpoint=False)
    i0 = np.floor(x).astype(int) % n; i1 = (i0 + 1) % n
    f = (x - np.floor(x)).astype(np.float32); s = f * f * (3 - 2 * f)
    u = s[:, None]; v = s[None, :]
    a = g[np.ix_(i0, i0)]; b = g[np.ix_(i0, i1)]; c = g[np.ix_(i1, i0)]; d = g[np.ix_(i1, i1)]
    return a * (1 - u) * (1 - v) + b * (1 - u) * v + c * u * (1 - v) + d * u * v

def fbm(size, seed, base=4, octs=5):
    rng = np.random.default_rng(seed); out = 0; amp = 1.0; tot = 0.0
    for o in range(octs):
        n = base * 2 ** o
        if n > size: break
        out = out + amp * vnoise(n, size, rng); tot += amp; amp *= 0.5
    return out / tot

def mix(c0, c1, t):
    return np.array(c0, np.float32)[None, None, :] * (1 - t[..., None]) + np.array(c1, np.float32)[None, None, :] * t[..., None]

def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def gen_stone(S=512):
    f1 = fbm(S, 1, 4, 6); f2 = fbm(S, 2, 8, 5); f3 = fbm(S, 3, 3, 3)
    col = mix((0.58, 0.53, 0.46), (0.78, 0.72, 0.62), f1)
    ridge = 1 - np.abs(2 * f2 - 1); crack = ss(0.93, 0.995, ridge)
    col = col * (1 - 0.3 * crack[..., None])
    moss = ss(0.56, 0.66, f3) * ss(0.35, 0.6, f1)
    mc = mix((0.28, 0.46, 0.13), (0.48, 0.66, 0.2), f2)
    col = col * (1 - moss[..., None]) + mc * moss[..., None]
    return col, f1 * 0.6 + f2 * 0.4 - crack * 0.5 + moss * 0.15

def gen_bark(S=512):
    rng = np.random.default_rng(7)
    g = rng.random(48).astype(np.float32); x = np.linspace(0, 48, S, endpoint=False)
    i0 = np.floor(x).astype(int) % 48; f = x - np.floor(x); s = f * f * (3 - 2 * f)
    streak = (g[i0] * (1 - s) + g[(i0 + 1) % 48] * s)[None, :].repeat(S, 0)
    t = streak * 0.6 + fbm(S, 8, 8, 5) * 0.4
    col = mix((0.30, 0.19, 0.11), (0.55, 0.37, 0.21), t)
    return col, t

def gen_needles(S=512):
    f = fbm(S, 5, 8, 6)
    col = mix((0.09, 0.28, 0.13), (0.30, 0.56, 0.21), f)
    hi = ss(0.62, 0.8, fbm(S, 6, 32, 4))
    col = col + hi[..., None] * np.array([0.12, 0.14, 0.03], np.float32)
    return col, f

def gen_moss(S=512):
    f = fbm(S, 9, 12, 5)
    col = mix((0.30, 0.48, 0.12), (0.58, 0.74, 0.24), f)
    return col, f

def gen_flora(S=256):
    cols = [(0.98, 0.80, 0.18), (0.96, 0.95, 0.88), (0.82, 0.22, 0.22), (0.82, 0.74, 0.55)]
    img = np.zeros((S, S, 3), np.float32); n = fbm(S, 10, 8, 3)
    for k, c in enumerate(cols):
        img[:, k * S // 4:(k + 1) * S // 4] = np.array(c, np.float32)
    return img * (0.9 + 0.2 * n[..., None]), None

def gen_ground(S=2048):
    u = (np.arange(S) + 0.5) / S
    X = ((u - 0.5) * 30)[None, :].repeat(S, 0)
    Z = (-(u - 0.5) * 30)[:, None].repeat(S, 1)  # godot z per row
    f1 = fbm(S, 21, 4, 7); f2 = fbm(S, 22, 10, 5)
    grass = mix((0.22, 0.40, 0.14), (0.36, 0.55, 0.20), f1)
    dirt = mix((0.36, 0.27, 0.16), (0.50, 0.39, 0.24), f2)
    patch = ss(0.58, 0.7, fbm(S, 23, 5, 4))
    col = grass * (1 - patch[..., None] * 0.7) + dirt * (patch[..., None] * 0.7)
    xc = 0.35 * np.sin(Z * 0.4)
    hw = 1.55 + 0.6 * (fbm(S, 24, 8, 3) - 0.5)
    path = ss(hw + 0.5, hw - 0.25, np.abs(X - xc)) * ss(-12.8, -9.5, Z)
    plaza = ss(1.0, 0.0, np.hypot(X / 5.5, (Z + 6.0) / 3.2))
    path = np.maximum(path, plaza * 0.85)
    pd = mix((0.44, 0.35, 0.22), (0.58, 0.48, 0.31), fbm(S, 25, 16, 5))
    peb = ss(0.70, 0.78, vnoise(400, S, np.random.default_rng(26)))
    pd = pd * (1 - 0.35 * peb[..., None]) + peb[..., None] * np.array([0.5, 0.5, 0.47], np.float32) * 0.35
    col = col * (1 - path[..., None]) + pd * path[..., None]
    lit = ss(0.56, 0.72, fbm(S, 27, 12, 4)); dk = ss(0.42, 0.28, fbm(S, 28, 7, 4))
    col = col * (1 + 0.32 * lit[..., None] * np.array([1.0, 0.95, 0.6], np.float32)) * (1 - 0.28 * dk[..., None])
    sp = ss(0.72, 0.8, vnoise(512, S, np.random.default_rng(29))) * (1 - path)
    col = col * (1 - sp[..., None] * 0.6) + sp[..., None] * 0.6 * np.array([0.55, 0.5, 0.15], np.float32)
    return col, f1 * 0.7 + f2 * 0.3

def normal_from(h, k):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * k; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * k
    n = np.stack([-dx, -dy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def make_image(name, rgb, data=False):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    a = np.ones((h, w, 4), np.float32); a[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(a.ravel())
    if data: img.colorspace_settings.name = 'Non-Color'
    img.pack()
    return img

MAT = {}
def build_materials():
    gens = {'stone': (gen_stone, 4.0, 0.9), 'bark': (gen_bark, 5.0, 0.95), 'needles': (gen_needles, 2.0, 0.8),
            'ground': (gen_ground, 3.0, 1.0), 'flora': (gen_flora, 0, 0.7), 'moss': (gen_moss, 2.5, 0.95)}
    for k in MATS:
        if ONLY and k == 'ground' and ONLY != 'ground': gens[k] = (lambda: gen_ground(256), 3.0, 1.0)
        fn, nk, rough = gens[k]; col, h = fn()
        m = bpy.data.materials.new('pw_' + k); m.use_nodes = True
        nt = m.node_tree; b = nt.nodes['Principled BSDF']
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = make_image(k + '_basecolor', col)
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = rough
        if h is not None and nk:
            n = nt.nodes.new('ShaderNodeTexImage'); n.image = make_image(k + '_normal', normal_from(h, nk), True)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        MAT[k] = m

# ---------------- mesh building ----------------
def rz(a): return Matrix.Rotation(a, 3, 'Z')
def ry(a): return Matrix.Rotation(a, 3, 'Y')
def rx(a): return Matrix.Rotation(a, 3, 'X')

class Asset:
    def __init__(s, name, seed):
        s.name = name; s.bm = bmesh.new(); s.R = random.Random(seed); s.fuv = {}; s.recalc = True
    def tag(s, verts, mat, u=None):
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = MATS.index(mat)
            if u is not None: s.fuv[f] = u
    def box(s, c, sz, rot=None, jit=0.0, chip=0.0, mat='stone', taper=0.0):
        vs = bmesh.ops.create_cube(s.bm, size=1.0)['verts']
        tops = [v for v in vs if v.co.z > 0]; chipv = s.R.choice(tops) if chip else None
        for v in vs:
            p = Vector((v.co.x * sz[0], v.co.y * sz[1], v.co.z * sz[2]))
            p.z *= (1 + taper) if v.co.x > 0 else (1 - taper)
            p += Vector((s.R.uniform(-jit, jit), s.R.uniform(-jit, jit), s.R.uniform(-jit, jit)))
            if v is chipv: p *= (1 - chip)
            if rot is not None: p = rot @ p
            v.co = p + Vector(c)
        s.tag(vs, mat); return vs
    def blob(s, c, r, mat='stone', jit=0.15, flat=0.0, rot=None):
        vs = bmesh.ops.create_icosphere(s.bm, subdivisions=1, radius=1.0)['verts']
        for v in vs:
            p = v.co.copy() * (1 + s.R.uniform(-jit, jit))
            p = Vector((p.x * r[0], p.y * r[1], p.z * r[2]))
            if flat: p.z = max(p.z, -flat * r[2])
            if rot is not None: p = rot @ p
            v.co = p + Vector(c)
        s.tag(vs, mat); return vs
    def tube(s, p0, p1, r0, r1, seg=6, mat='bark'):
        p0 = Vector(p0); p1 = Vector(p1); d = p1 - p0
        vs = bmesh.ops.create_cone(s.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=d.length)['verts']
        q = Vector((0, 0, 1)).rotation_difference(d)
        for v in vs: v.co = q @ v.co + (p0 + p1) / 2
        s.tag(vs, mat); return vs
    def chain(s, pts, r0, r1, seg=6, mat='bark'):
        n = len(pts) - 1
        for i in range(n):
            a = r0 + (r1 - r0) * i / n; b = r0 + (r1 - r0) * (i + 1) / n
            p0 = Vector(pts[i]); p1 = Vector(pts[i + 1]); e = (p1 - p0).normalized() * 0.05
            s.tube(p0 - (e if i else Vector()), p1 + e, a, b, seg, mat)
    def tier(s, c, z0, r, h, n=10, mat='needles', lean=(0, 0)):
        bm = s.bm; off = s.R.uniform(0, 6.28); ring = []
        for i in range(n):
            a = off + 2 * math.pi * i / n; rr = r * (1 if i % 2 == 0 else 0.72) * (0.92 + 0.16 * s.R.random())
            ring.append(bm.verts.new((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), z0 + (0 if i % 2 == 0 else 0.14 * h))))
        ap = bm.verts.new((c[0] + lean[0], c[1] + lean[1], z0 + h)); ct = bm.verts.new((c[0], c[1], z0 + 0.05 * h))
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            for f in (bm.faces.new((a, b, ap)), bm.faces.new((ct, b, a))): f.material_index = MATS.index(mat)
    def blade(s, base, yaw, tilt, L, w, mat='needles'):
        vs = bmesh.ops.create_cone(s.bm, cap_ends=True, cap_tris=True, segments=4, radius1=w, radius2=0.0, depth=L)['verts']
        M = rz(yaw) @ ry(tilt)
        for v in vs:
            p = Vector((v.co.x, v.co.y * 0.3, v.co.z + L / 2)); v.co = M @ p + Vector(base)
        s.tag(vs, mat); return vs
    def finish(s):
        bm = s.bm
        if s.recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        uv = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            f.normal_update(); m = MATS[f.material_index]
            for l in f.loops:
                p = l.vert.co
                if m == 'flora':
                    l[uv].uv = ((s.fuv.get(f, 0) + 0.5) / 4, 0.5); continue
                if m == 'ground':
                    l[uv].uv = (p.x / 30 + 0.5, p.y / 30 + 0.5); continue
                n = f.normal; t = TILE[m]
                if abs(n.z) >= abs(n.x) and abs(n.z) >= abs(n.y): l[uv].uv = (p.x / t, p.y / t)
                elif abs(n.x) >= abs(n.y): l[uv].uv = (p.y / t, p.z / t)
                else: l[uv].uv = (p.x / t, p.z / t)
        mesh = bpy.data.meshes.new(s.name); bm.to_mesh(mesh); bm.free()
        for k in MATS: mesh.materials.append(MAT[k])
        for p in mesh.polygons: p.use_smooth = False
        obj = bpy.data.objects.new(s.name, mesh); bpy.data.collections['ASSETS'].objects.link(obj)
        return obj

# ---------------- assets ----------------
def build_arch():
    A = Asset('arch', 11); R = A.R
    px, depth, zc, Rr = 3.0, 1.35, 3.6, 3.0
    for side, top in ((-1, 5.6), (1, 3.1)):
        z = -0.2
        while z < top - 0.4:
            h = R.uniform(0.45, 0.78); w = R.uniform(1.4, 1.62) - (0.25 if z > zc else 0)
            A.box((side * px + R.uniform(-.06, .06), R.uniform(-.06, .06), z + h / 2), (w, depth * R.uniform(.92, 1.0), h),
                  rz(R.uniform(-.05, .05)), jit=.04, chip=R.choice([0, 0, .25]))
            z += h
        A.box((side * px + side * 0.05, 0, z + 0.25), (1.2, 1.1, 0.5), rz(R.uniform(-.2, .2)) @ rx(side * .15), jit=.1, chip=.35)
        A.blob((side * px, 0, z + 0.55), (0.7, 0.62, 0.22), 'moss', 0.2, flat=0.4)
    for th in [171, 153, 135, 116.6, 98.4]:  # left ring
        t = math.radians(th); c = (Rr * math.cos(t), 0, zc + Rr * math.sin(t))
        A.box(c, (0.75, depth, 0.98), ry(-t), jit=.03, chip=R.choice([0, .2]), taper=0.06)
    for th in [9, 27, 45]:  # right ring stub
        t = math.radians(th); c = (Rr * math.cos(t), 0, zc + Rr * math.sin(t))
        A.box(c, (0.75, depth, 0.98), ry(-t), jit=.03, chip=R.choice([0, .2]), taper=0.06)
    A.blob((-1.35, 0, zc + 3.05), (0.7, 0.6, 0.2), 'moss', 0.2, flat=0.4)
    A.box((-2.6, 0.0, 6.6), (0.7, 0.9, 1.6), rz(0.1) @ ry(0.12), jit=.05, chip=.3)  # tooth on left pillar
    A.box((4.9, 1.7, 0.35), (1.1, 0.9, 0.7), rz(0.6) @ rx(0.1), jit=.05, chip=.25)  # fallen keystone
    A.box((5.3, -1.2, 0.25), (0.9, 0.8, 0.5), rz(-0.5), jit=.05, chip=.3)
    A.box((-5.0, 1.8, 0.22), (0.8, 0.7, 0.45), rz(0.3), jit=.05, chip=.3)
    A.blob((4.9, 1.7, 0.7), (0.55, 0.45, 0.15), 'moss', 0.2, flat=0.5)
    for pts in [[(-3.4, 0.7, 2.6), (-3.9, 1.0, 1.2), (-4.7, 1.3, 0.2), (-5.7, 1.5, 0.03)],
                [(-2.55, 0.8, 1.2), (-2.9, 1.3, 0.5), (-3.2, 2.0, 0.1), (-3.5, 2.8, 0.02)],
                [(3.7, 0.8, 1.8), (4.1, 1.0, 0.8), (4.9, 1.0, 0.15), (5.9, 0.6, 0.02)],
                [(3.3, -0.85, 0.9), (3.8, -1.3, 0.3), (4.5, -1.9, 0.05)]]:
        A.chain(pts, 0.17, 0.05)
    return A.finish()

def build_wall():
    A = Asset('ruin_wall', 21); R = A.R
    L = 5.5; row = 0; z = -0.15
    def cap(x): return 2.4 - 0.32 * x + 0.5 * math.sin(x * 2.1) + (0.0 if x < 4.2 else -0.9)
    while z < 2.6:
        h = R.uniform(0.42, 0.6); x = -R.uniform(0.0, 0.7) if row % 2 else 0.0
        while x < L:
            w = R.uniform(0.85, 1.6); cx = x + w / 2
            if cx > 0.3 and z + h < cap(cx) + 0.2:
                A.box((cx, R.uniform(-.05, .05), z + h / 2), (w * .97, R.uniform(.85, 1.0), h * .97),
                      rz(R.uniform(-.04, .04)), jit=.035, chip=R.choice([0, .2, .3]))
            x += w
        z += h; row += 1
    for cx in (1.0, 2.6):
        A.blob((cx, 0, cap(cx) + 0.2), (0.8, 0.5, 0.2), 'moss', .2, flat=.4)
    A.blob((4.4, 0, 0.7), (0.9, 0.5, 0.2), 'moss', .2, flat=.4)
    for i in range(4):
        A.box((L + 0.3 + i * 0.7, R.uniform(-.7, .7), 0.2 + 0.05 * i), (R.uniform(.5, .9), R.uniform(.5, .8), R.uniform(.3, .5)), rz(R.uniform(0, 3)), jit=.05, chip=.3)
    A.chain([(0.2, 0.55, 1.8), (0.5, 0.75, 0.9), (1.2, 1.0, 0.1), (2.2, 1.4, 0.02)], 0.1, 0.03, 5)
    return A.finish()

def build_rubble():
    A = Asset('rubble_pile', 31); R = A.R
    for i in range(9):
        a = R.uniform(0, 6.28); d = R.uniform(0, 1.1) * (1 - i / 14)
        r = R.uniform(0.28, 0.6) * (1.2 - d * 0.4)
        A.blob((d * math.cos(a), d * math.sin(a), r * 0.35), (r * 1.15, r, r * 0.8), 'stone', .28, flat=.35, rot=rz(R.uniform(0, 6)))
    for i in range(4):
        a = R.uniform(0, 6.28); d = R.uniform(0.2, 1.0)
        A.box((d * math.cos(a), d * math.sin(a), 0.25 + 0.2 * (i % 2)), (R.uniform(.5, .9), R.uniform(.45, .7), R.uniform(.4, .6)),
              rz(R.uniform(0, 6)) @ rx(R.uniform(-.3, .3)), jit=.05, chip=.35)
    for i in range(3):
        A.blob((R.uniform(-.6, .6), R.uniform(-.6, .6), 0.65), (.4, .35, .12), 'moss', .25, flat=.5)
    for i in range(6):
        a = R.uniform(0, 6.28); d = R.uniform(1.2, 1.8); r = R.uniform(.1, .2)
        A.blob((d * math.cos(a), d * math.sin(a), r * .3), (r, r, r * .7), 'stone', .3, flat=.3)
    return A.finish()

def build_timber():
    A = Asset('timber_roots', 41); R = A.R
    A.tube((-1.9, 0, 0.34), (0.9, 0.1, 0.4), 0.36, 0.3, 8)
    A.tube((0.9, 0.1, 0.4), (1.7, 0.15, 0.5), 0.3, 0.13, 6)
    A.tube((-0.6, 0.2, 0.55), (-0.4, 0.75, 1.0), 0.07, 0.03, 5); A.tube((0.3, 0.1, 0.62), (0.6, -0.5, 1.15), 0.07, 0.03, 5)
    A.blob((-0.5, 0.1, 0.72), (0.9, 0.3, 0.14), 'moss', .2, flat=.4)
    A.tube((-3.6, 0.4, 0.0), (-3.6, 0.4, 0.55), 0.5, 0.42, 8)
    A.blob((-3.6, 0.4, 0.58), (0.5, 0.5, 0.1), 'moss', .1, flat=.3)
    for a in (0.3, 1.9, 3.6, 5.0):
        dx, dy = math.cos(a), math.sin(a)
        A.chain([(-3.6 + dx * .3, .4 + dy * .3, .35), (-3.6 + dx * .75, .4 + dy * .75, .12), (-3.6 + dx * 1.3, .4 + dy * 1.3, .02)], .17, .05, 5)
    A.box((0.5, -1.7, 0.2), (0.8, 0.6, 0.4), rz(.3), jit=.05, chip=.3)
    return A.finish()

def build_conifer(name, seed, trunk, tiers, r0, r1, th):
    A = Asset(name, seed); R = A.R
    top = trunk + tiers * th * 0.62
    A.tube((0, 0, -0.05), (0, 0, top), 0.24 * r0 / 1.5 + 0.05, 0.06, 7)
    for i in range(tiers):
        t = i / max(tiers - 1, 1)
        A.tier((R.uniform(-.06, .06), R.uniform(-.06, .06), 0), trunk + i * th * 0.62 - 0.1, r0 + (r1 - r0) * t, th * (1.05 - 0.15 * t), 10,
               lean=(R.uniform(-.08, .08), R.uniform(-.08, .08)))
    for i in range(3):
        a = i * 2.1 + R.uniform(0, 1)
        A.chain([(math.cos(a) * .15, math.sin(a) * .15, .55), (math.cos(a) * .45, math.sin(a) * .45, .12), (math.cos(a) * .85, math.sin(a) * .85, .0)], .1, .03, 5)
    return A.finish()

FIXED = [(-6, 4), (5, 2), (-7, -4), (0, -8.7), (5, -8.5), (-5, -9)]

def build_ground():
    A = Asset('ground_patch', 51); A.recalc = False
    N = 24; bm = A.bm; h0 = fbm(64, 4, 4, 4); vs = {}
    for i in range(N + 1):
        for j in range(N + 1):
            x = -15 + 30 * i / N; y = -15 + 30 * j / N; gz = -y
            m = float(ss(3.5, 6.0, abs(x)))
            for tx, tz in FIXED: m = min(m, float(ss(1.8, 3.4, math.hypot(x - tx, gz - tz))))
            m = min(m, float(ss(1.0, 4.0, abs(gz + 6))) if abs(x) < 6 else m)
            hgt = 0.22 * (h0[int(i / N * 63), int(j / N * 63)] - 0.5) * 2 * m
            vs[i, j] = bm.verts.new((x, y, hgt))
    for i in range(N):
        for j in range(N):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1])); f.material_index = MATS.index('ground')
    return A.finish()

def build_undergrowth():
    A = Asset('undergrowth_clump', 61); R = A.R
    for i in range(8):
        A.blade((R.uniform(-.1, .1), R.uniform(-.1, .1), 0), i * 0.785 + R.uniform(-.2, .2), R.uniform(0.9, 1.2), R.uniform(.5, .75), .09)
    for i in range(6):
        A.blade((R.uniform(-.3, .3), R.uniform(-.3, .3), 0), R.uniform(0, 6.28), R.uniform(.15, .45), R.uniform(.3, .55), .04, 'moss')
    for dx, dy, hh, u in [(0.45, 0.2, 0.42, 0), (-0.4, 0.3, 0.36, 1), (0.1, -0.5, 0.4, 0)]:
        A.tube((dx, dy, 0), (dx, dy, hh), .018, .012, 4, 'moss')
        vs = A.blob((dx, dy, hh), (.07, .07, .05), 'flora', .05); A.tag(vs, 'flora', u)
    A.tube((.55, -.3, 0), (.55, -.3, .12), .03, .03, 5, 'flora')
    vs = A.tube((.55, -.3, .12), (.55, -.3, .2), .1, .02, 7, 'flora'); A.tag(vs, 'flora', 2)
    return A.finish()

BUILDERS = {'arch': build_arch, 'ruin_wall': build_wall, 'rubble_pile': build_rubble, 'timber_roots': build_timber,
            'conifer_pine': lambda: build_conifer('conifer_pine', 71, 1.6, 6, 1.5, 0.45, 1.5),
            'conifer_spruce': lambda: build_conifer('conifer_spruce', 72, 0.9, 7, 1.35, 0.3, 1.25),
            'conifer_fir': lambda: build_conifer('conifer_fir', 73, 0.7, 4, 1.7, 0.6, 1.5),
            'ground_patch': build_ground, 'undergrowth_clump': build_undergrowth}

def placements():
    R0 = random.Random(2026); P = []
    def add(a, x, z, yaw=0, sc=1.0): P.append({'asset': a, 'position': [round(x, 3), 0.0, round(z, 3)], 'yaw_degrees': round(yaw, 2), 'scale': round(sc, 3)})
    add('ground_patch', 0, 0); add('arch', 0, -6)
    add('ruin_wall', 3.7, -6.1, 0, 1.0); add('ruin_wall', -3.7, -6.4, 180, 0.9)
    for x, z, s in [(4.4, -4.4, 1.0), (-6.6, -7.0, .85), (6.8, -5.2, .8), (-4.5, -3.0, .6), (2.8, -11.2, .8), (-2.8, -11.8, .7)]:
        add('rubble_pile', x, z, R0.uniform(0, 360), s)
    for x, z, yw, s in [(-3.8, 8.0, 70, 1.0), (7.0, 7.0, -20, .9), (-10.0, -1.5, 100, .85), (9.0, -3.5, 30, .75), (3.6, 10.8, 200, .7)]:
        add('timber_roots', x, z, yw, s)
    kinds = ['conifer_pine', 'conifer_spruce', 'conifer_fir']; ring = []
    for i in range(9): ring.append((-13.5 + i * 3.4 + R0.uniform(-.8, .8), 13.6 + R0.uniform(-.8, .5)))
    for i in range(9): ring.append((-13.5 + i * 3.4 + R0.uniform(-.8, .8), -13.6 + R0.uniform(-.5, .8)))
    for i in range(1, 8): ring.append((-13.8 + R0.uniform(-.4, .5), -13.5 + i * 3.4 + R0.uniform(-.8, .8)))
    for i in range(1, 8): ring.append((13.8 + R0.uniform(-.5, .4), -13.5 + i * 3.4 + R0.uniform(-.8, .8)))
    ring += [(8.2, 9.2), (-9.5, 8.2), (9.6, -9.5), (-9.2, -10.0), (10.4, 0.5), (-11, 3.5)]
    k = 0
    for x, z in ring:
        if abs(x) < 3.4 and z > 11: continue
        if abs(x) < 3.0 and z < -12: continue
        if min(math.hypot(x - a, z - b) for a, b in FIXED) < 3.2: continue
        add(kinds[k % 3], x, z, R0.uniform(0, 360), R0.uniform(0.85, 1.3)); k += 1
    n = 0; tries = 0
    while n < 48 and tries < 3000:
        tries += 1; x = R0.uniform(-13.5, 13.5); z = R0.uniform(-13, 13)
        if abs(x) < 2.6 and -10 < z < 13: continue
        if abs(z + 6) < 2.0 and abs(x) < 4.6: continue
        if min(math.hypot(x - a, z - b) for a, b in FIXED) < 2.0: continue
        add('undergrowth_clump', x, z, R0.uniform(0, 360), R0.uniform(0.8, 1.4)); n += 1
    return P

# ---------------- scene / export / render ----------------
def export_glb(obj, path):
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_apply=True,
                              export_yup=True, export_materials='EXPORT', export_image_format='AUTO')

def setup_render(scene, w=1280, h=720):
    scene.render.resolution_x = w; scene.render.resolution_y = h
    try: scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception: scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.2; sun.data.color = (1.0, 0.9, 0.75); sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(-35)); scene.collection.objects.link(sun)
    wd = bpy.data.worlds.new('W'); wd.use_nodes = True; scene.world = wd
    bg = wd.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.55, 0.68, 0.85, 1); bg.inputs[1].default_value = 1.0

def camera_shot(scene, name, loc, target, lens, path):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); cam.data.lens = lens; cam.location = loc
    scene.collection.objects.link(cam)
    tg = bpy.data.objects.new(name + '_t', None); tg.location = target; scene.collection.objects.link(tg)
    c = cam.constraints.new('TRACK_TO'); c.target = tg; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    scene.camera = cam; scene.render.filepath = path; bpy.ops.render.render(write_still=True)

def main():
    scene = bpy.context.scene
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    col = bpy.data.collections.new('ASSETS'); scene.collection.children.link(col)
    build_materials()
    out = OUT
    os.makedirs(out, exist_ok=True)
    names = [ONLY] if ONLY else list(BUILDERS)
    objs = {n: BUILDERS[n]() for n in names}
    for n, o in objs.items(): export_glb(o, os.path.join(out, n + '.glb'))
    setup_render(scene)
    for o in objs.values(): o.hide_render = True; o.hide_viewport = True
    if ONLY:
        objs[ONLY].hide_render = False; objs[ONLY].hide_viewport = False
        camera_shot(scene, 'cam', (0, -14.5, 1.8), (0, 6, 3.0), 28, os.path.join(out, 'first_arch.png')); return
    P = placements(); stats = {'assets': {}, 'placements': len(P)}
    tot = 0
    for n, o in objs.items():
        o.data.calc_loop_triangles(); t = len(o.data.loop_triangles)
        stats['assets'][n] = {'triangles': t, 'glb_bytes': os.path.getsize(os.path.join(out, n + '.glb'))}; tot += t
    inst = 0
    for i, p in enumerate(P):
        src = objs[p['asset']]; ob = bpy.data.objects.new('%s_%d' % (p['asset'], i), src.data)
        x, y, z = p['position']; ob.location = (x, -z, y); ob.rotation_euler = (0, 0, math.radians(p['yaw_degrees']))
        ob.scale = (p['scale'],) * 3; scene.collection.objects.link(ob)
        inst += len(src.data.loop_triangles)
    stats['unique_triangles'] = tot; stats['instanced_triangles'] = inst; stats['material_families'] = MATS
    json.dump({'schema': 1, 'assets': {n: n + '.glb' for n in objs}, 'placements': P}, open(os.path.join(out, 'placement_pinewood_ruins.json'), 'w'), indent=1)
    json.dump(stats, open(os.path.join(out, 'stats.json'), 'w'), indent=1)
    camera_shot(scene, 'cam_ground', (0, -14.5, 1.7), (0, 6, 2.6), 28, os.path.join(out, 'pinewood_ground.png'))
    camera_shot(scene, 'cam_rts', (0, -21, 21), (0, 1.5, 0), 30, os.path.join(out, 'pinewood_rts.png'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'pinewood.blend'))

main()
print('PINEWOOD_BUILD_OK')
