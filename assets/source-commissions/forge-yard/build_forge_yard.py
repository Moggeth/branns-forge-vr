"""Forge Yard architecture kit builder (Blender 4.5, deterministic).

Run:  blender --background --factory-startup --python build_forge_yard.py -- --out ABS_DIR

All geometry is authored in GAME coordinates (metres, +Y up, front +Z, ground y=0)
and converted to Blender Z-up on write, so the glTF exporter (+Y up) round-trips
back to exactly the numbers below.  Outputs:
  forge_shelter.glb        open building shell (frame, roof, rear wall, chimney)
  forge_detail_kit.glb     every decorative module placed at its layout position
  kit_modules/<name>.glb   the same modules, one per file, origin at their anchor
  forge_yard_source.blend  editable combined source
  layout.json              placements + recommended simple collision boxes
"""
import bpy, bmesh, json, math, os, random, sys
import numpy as np
from mathutils import Matrix, Vector, Euler

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[ARGV.index("--out") + 1]) if "--out" in ARGV else os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(os.path.join(OUT, "kit_modules"), exist_ok=True)
RNG = random.Random(1492)
TO_BL = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game -> blender

# ---------------------------------------------------------------- textures
TEX = 512

def _vnoise(grid, seed, n=TEX):
    r = np.random.default_rng(seed).random((grid, grid))
    c = np.arange(n) * grid / n
    i0 = np.floor(c).astype(int); f = c - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % grid
    a = r[i0][:, i0]; b = r[i0][:, i1]; cc = r[i1][:, i0]; d = r[i1][:, i1]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy

def fbm(seed, base=4, octaves=4):
    out = np.zeros((TEX, TEX)); amp = 1.0; tot = 0
    for o in range(octaves):
        out += _vnoise(base * 2 ** o, seed + o) * amp; tot += amp; amp *= 0.5
    return out / tot

def lerp3(c0, c1, t):
    c0 = np.array(c0); c1 = np.array(c1)
    return c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]

def tex_timber(seed, dark, light):
    v = np.linspace(0, 1, TEX, endpoint=False)[:, None] * np.ones((1, TEX))
    warp = fbm(seed, 2, 3)
    rings = 0.5 + 0.5 * np.sin((v * 14 + warp * 2.2) * 2 * np.pi)
    fine = fbm(seed + 9, 8, 3)
    t = np.clip(rings ** 3 * 0.55 + fine * 0.45, 0, 1)
    img = lerp3(dark, light, t)
    img *= (0.9 + 0.2 * fbm(seed + 20, 3, 2))[..., None]
    return img

def tex_stone(seed):
    rng = np.random.default_rng(seed)
    pts = rng.random((34, 2)); cols = rng.random(34)
    y, x = np.mgrid[0:TEX, 0:TEX] / TEX
    d1 = np.full((TEX, TEX), 9.0); d2 = np.full((TEX, TEX), 9.0); idx = np.zeros((TEX, TEX), int)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(x - px); dx = np.minimum(dx, 1 - dx) * 1.35  # wider blocks along u
        dy = np.abs(y - py); dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d)); idx = np.where(closer, k, idx); d1 = np.where(closer, d, d1)
    edge = np.clip((d2 - d1) / 0.018, 0, 1)
    cv = cols[idx]
    base = lerp3((0.56, 0.49, 0.41), (0.72, 0.64, 0.52), cv)
    warm = lerp3((1, 1, 1), (1.03, 0.97, 0.9), (cv > 0.75).astype(float))
    img = base * warm * (0.85 + 0.25 * fbm(seed + 3, 6, 4))[..., None]
    mortar = np.array((0.33, 0.30, 0.26))
    return img * edge[..., None] + mortar * (1 - edge[..., None])

def tex_roof(seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:TEX, 0:TEX] / TEX
    rows = 3; cols = 5
    ry = y * rows; row = np.floor(ry).astype(int); fy = ry - row
    rx = x * cols + (row % 2) * 0.5; col = np.floor(rx).astype(int) % cols; fx = rx - np.floor(rx)
    tone = rng.random((rows, cols))[row % rows, col]
    img = lerp3((0.58, 0.25, 0.15), (0.78, 0.40, 0.23), tone)
    shade = 0.62 + 0.38 * np.clip(fy * 1.6, 0, 1)          # overlap shadow at course top
    groove = np.clip(np.minimum(fx, 1 - fx) / 0.05, 0.55, 1)
    img *= (shade * groove)[..., None]
    weather = fbm(seed + 5, 3, 4)
    moss = np.clip((weather - 0.62) * 4, 0, 0.45)
    img = img * (1 - moss[..., None]) + np.array((0.36, 0.40, 0.22)) * moss[..., None]
    img *= (0.88 + 0.2 * fbm(seed + 7, 16, 2))[..., None]
    return img

def tex_flat(seed, c0, c1, base=6, amp=1.0):
    return lerp3(c0, c1, np.clip(fbm(seed, base, 4) * amp, 0, 1))

def tex_cloth(seed):
    y, x = np.mgrid[0:TEX, 0:TEX] / TEX
    weave = 0.5 + 0.5 * np.sin(x * TEX * np.pi / 2) * np.sin(y * TEX * np.pi / 2)
    img = lerp3((0.42, 0.08, 0.07), (0.62, 0.15, 0.10), fbm(seed, 3, 3))
    return img * (0.9 + 0.1 * weave)[..., None]

def make_image(name, arr):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), np.float32); rgba[..., :3] = np.clip(arr, 0, 1) ** 2.2  # author in sRGB
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"; img.pack()
    return img

# ---------------------------------------------------------------- materials (9 slots)
MATS = {}
TILE = {}  # metres per UV unit

def material(name, img=None, color=(1, 1, 1), rough=0.8, metal=0.0, emit=None, tile=1.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    if img:
        t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
        m.node_tree.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    MATS[name] = m; TILE[name] = tile
    return m

def build_materials():
    srgb = lambda c: tuple(v ** 2.2 for v in c)
    material("Timber_Oak", make_image("tex_timber_oak", tex_timber(11, (0.30, 0.18, 0.10), (0.52, 0.34, 0.20))), rough=0.82, tile=1.6)
    material("Timber_Pine", make_image("tex_timber_pine", tex_timber(23, (0.60, 0.41, 0.24), (0.80, 0.60, 0.38))), rough=0.75, tile=1.4)
    material("Stone_Warm", make_image("tex_stone", tex_stone(31)), rough=0.9, tile=1.25)
    material("Roof_Terracotta", make_image("tex_roof", tex_roof(41)), rough=0.78, tile=1.1)
    material("Plaster_Lime", make_image("tex_plaster", tex_flat(51, (0.80, 0.72, 0.58), (0.92, 0.86, 0.72), 5)), rough=0.92, tile=2.5)
    material("Iron_Wrought", make_image("tex_iron", tex_flat(61, (0.09, 0.08, 0.08), (0.22, 0.19, 0.17), 10)), rough=0.55, metal=0.6, tile=0.8)
    material("Cloth_Banner", make_image("tex_cloth", tex_cloth(71)), rough=0.95, tile=1.0)
    material("Brass_Trim", color=srgb((0.80, 0.58, 0.28)), rough=0.35, metal=0.85)
    material("Lantern_Glow", color=srgb((1.0, 0.80, 0.50)), rough=0.5, emit=srgb((1.0, 0.62, 0.26)))

# ---------------------------------------------------------------- geometry accumulation
class Group:
    def __init__(self, name, origin=(0, 0, 0)):
        self.name = name; self.origin = Vector(origin)
        self.v = []; self.f = []; self.uv = []; self.m = []; self.mats = []

    def _mi(self, mat):
        if mat not in self.mats: self.mats.append(mat)
        return self.mats.index(mat)

    def add_bm(self, bm, mat, M, uv_off=None):
        """bm is in local, scaled space; M rotates+translates into game space."""
        mi = self._mi(mat); tile = TILE.get(mat, 1.0)
        off = uv_off if uv_off else (RNG.random() * 4, RNG.random() * 4)
        dims = [max(v.co[a] for v in bm.verts) - min(v.co[a] for v in bm.verts) for a in range(3)]
        L = dims.index(max(dims))
        bm.normal_update()
        base = len(self.v)
        for v in bm.verts:
            self.v.append(M @ v.co - self.origin)
        for f in bm.faces:
            n = f.normal; na = max(range(3), key=lambda a: abs(n[a]))
            others = [a for a in range(3) if a != na]
            if L in others: ua, va = L, [a for a in others if a != L][0]
            else: ua, va = others
            self.f.append([base + v.index for v in f.verts])
            self.uv.append([(v.co[ua] / tile + off[0], v.co[va] / tile + off[1]) for v in f.verts])
            self.m.append(mi)
        bm.free()

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def build(self, collection):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(TO_BL @ v) for v in self.v], [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        li = 0
        for p, uvs in zip(me.polygons, self.uv):
            for k in range(p.loop_total): uvl.data[p.loop_start + k].uv = uvs[k]
        for p, mi in zip(me.polygons, self.m): p.material_index = mi
        for mat in self.mats: me.materials.append(MATS[mat])
        me.validate(); me.update()
        ob = bpy.data.objects.new(self.name, me)
        ob.location = TO_BL @ self.origin
        collection.objects.link(ob)
        return ob

def _bevel(bm, amt):
    if amt > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=amt, offset_type="OFFSET", segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)

def box(g, mat, c, s, rot=(0, 0, 0), bevel=0.0, uv_off=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
    _bevel(bm, min(bevel, min(s) * 0.3))
    M = Matrix.Translation(c) @ Euler(rot, "XYZ").to_matrix().to_4x4()
    g.add_bm(bm, mat, M, uv_off)

def _basis(d, hint=None):
    z = d.normalized()
    hint = Vector(hint) if hint else (Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 0, 1)))
    x = hint - z * hint.dot(z)
    if x.length < 1e-4: x = Vector((0, 1, 0)) - z * z.y
    x.normalize(); y = z.cross(x)
    m = Matrix((x, y, z)).transposed()
    return m

def beam(g, mat, a, b, w, h, bevel=0.03, hint=None, ext=0.0):
    a = Vector(a); b = Vector(b); d = b - a; L = d.length + 2 * ext
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * w, v.co.y * h, v.co.z * L))
    _bevel(bm, min(bevel, min(w, h) * 0.3))
    M = Matrix.Translation((a + b) / 2) @ _basis(d, hint).to_4x4()
    g.add_bm(bm, mat, M)

def cyl(g, mat, a, b, r1, r2=None, segs=8, hint=None, rot_z=0.0):
    a = Vector(a); b = Vector(b); d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r1 if r2 is None else r2, depth=d.length,
                          matrix=Matrix.Rotation(rot_z, 4, "Z"))
    M = Matrix.Translation((a + b) / 2) @ _basis(d, hint).to_4x4()
    g.add_bm(bm, mat, M)

def prism(g, mat, pts, depth, c, rot=(0, 0, 0), bevel=0.0):
    """Extrude a 2D outline (x,y) along local z (centred)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y, depth / 2)) for x, y in pts]
    back = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    bm.faces.new(front); bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i]))
    bm.normal_update(); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _bevel(bm, bevel)
    M = Matrix.Translation(c) @ Euler(rot, "XYZ").to_matrix().to_4x4()
    g.add_bm(bm, mat, M)

def sphere(g, mat, c, r, segs=8, rings=5, scale=(1, 1, 1)):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    g.add_bm(bm, mat, Matrix.Translation(c))

def scroll(g, c, r, turns, thick, plane_rot=(0, 0, 0), steps=10, start=0.0):
    """Wrought-iron spiral curl as a chain of short bars in the local XY plane."""
    R = Euler(plane_rot, "XYZ").to_matrix()
    pts = []
    for i in range(steps + 1):
        t = start + turns * 2 * math.pi * i / steps
        rr = r * (1 - 0.75 * i / steps)
        pts.append(Vector(c) + R @ Vector((math.cos(t) * rr, math.sin(t) * rr, 0)))
    for p, q in zip(pts, pts[1:]):
        beam(g, "Iron_Wrought", p, q, thick, thick, bevel=0, ext=thick * 0.4)

# ---------------------------------------------------------------- dimensions (game space)
FRONT_Z, REAR_Z = -0.45, -7.35        # post lines
RIDGE_Z = -3.9
POST_X = [-8.3, -4.6, 4.6, 8.3]
PLATE_Y = 4.2                          # wall plate centre
TIE_Y = 4.55
TAN = math.tan(math.radians(29.5))
RAFTER_Y0 = 4.48                       # rafter centreline at plate lines
RIDGE_Y = RAFTER_Y0 + (FRONT_Z - RIDGE_Z) * TAN
EAVE_X = 8.75
GATE_HALF = 1.5                        # 3.0 m clear aperture
GATE_SPRING = 2.95
CHIM = Vector((-3.1, 0, -4.9))

def rafter_y(z):
    return RIDGE_Y - abs(z - RIDGE_Z) * TAN

def sag(x):
    return -0.07 * (1 - (x / EAVE_X) ** 2)

# ---------------------------------------------------------------- shell
def build_shell():
    G = {k: Group(k) for k in ["Shell_Posts", "Shell_Plates_Ties", "Shell_Braces_Joinery", "Shell_Trusses",
                               "Shell_Rafters_Purlins", "Shell_Roof_Tiles", "Shell_Ridge_Finials", "Shell_FrontGable",
                               "Shell_RearWall_Stone", "Shell_RearWall_Frame", "Shell_GableEnds", "Shell_Chimney", "Shell_Ironwork"]}
    P, T, B, TR, R, RT, RD, FG, RS, RF, GE, CH, IR = G.values()
    oak, pine, stone, iron = "Timber_Oak", "Timber_Pine", "Stone_Warm", "Iron_Wrought"

    # Posts on stone pads with carved bolster caps.
    posts = [(x, FRONT_Z) for x in POST_X] + [(x, REAR_Z) for x in POST_X] + [(-8.3, RIDGE_Z), (8.3, RIDGE_Z)]
    for x, z in posts:
        box(P, stone, (x, 0.14, z), (0.62, 0.28, 0.62), rot=(0, RNG.uniform(-0.08, 0.08), 0), bevel=0.05)
        box(P, oak, (x, 2.14, z), (0.36, 3.72, 0.36), rot=(0, RNG.uniform(-0.02, 0.02), 0), bevel=0.04)
        along_x = z != RIDGE_Z
        cap = (1.15, 0.2, 0.38) if along_x else (0.38, 0.2, 1.15)
        box(P, oak, (x, 3.92, z), cap, bevel=0.04)
        # iron strap + bolts on the visible face
        face = Vector((0, 0, 0.19)) if along_x else Vector((0.19 * (1 if x > 0 else -1), 0, 0))
        box(IR, iron, Vector((x, 3.55, z)) + face, (0.2 if along_x else 0.03, 0.55, 0.03 if along_x else 0.2))
        for yy in (3.38, 3.72):
            sphere(IR, iron, Vector((x, yy, z)) + face * 1.12, 0.035, 6, 3)

    # Wall plates (front, rear, sides) with proud, chamfered ends.
    for z in (FRONT_Z, REAR_Z):
        box(T, oak, (0, PLATE_Y, z), (EAVE_X * 2 - 0.2, 0.36, 0.36), bevel=0.04)
    for x in (-8.3, 8.3):
        box(T, oak, (x, PLATE_Y, RIDGE_Z), (0.36, 0.36, 7.6), bevel=0.04)
    # Tie beams across the span at each truss, resting on plates.
    for x in [-8.3, -4.6, 0.0, 4.6, 8.3]:
        box(T, oak, (x, TIE_Y, RIDGE_Z), (0.32, 0.34, 7.9), bevel=0.04)

    # Knee braces from posts up to plates/ties (lowest point 3.15 m).
    for x, z in posts:
        dirs = []
        if z != RIDGE_Z:
            dirs += [Vector((s, 0, 0)) for s in (-1, 1) if abs(x + s * 0.9) < 8.6]
            dirs.append(Vector((0, 0, 1 if z == REAR_Z else -1)))
        else:
            dirs += [Vector((0, 0, -1)), Vector((0, 0, 1))]
        for d in dirs:
            a = Vector((x, 3.15, z)) + d * 0.16; b = Vector((x, 4.02, z)) + d * 0.95
            beam(B, oak, a, b, 0.16, 0.2, hint=(0, 0, 1) if d.x else (1, 0, 0))
    # Peg heads on plate joints (tactile timber-frame detail).
    for x, z in posts:
        for off in (-0.12, 0.12):
            if z != RIDGE_Z:
                cyl(B, pine, (x + off, PLATE_Y, z + 0.17), (x + off, PLATE_Y, z + 0.21), 0.035, segs=6)

    # Trusses: principal rafters, king posts, raking struts, collar.
    for x in [-8.3, -4.6, 0.0, 4.6, 8.3]:
        for s in (-1, 1):
            zp = RIDGE_Z + s * 3.9
            beam(TR, oak, (x, rafter_y(zp) - 0.02, zp), (x, RIDGE_Y - 0.05, RIDGE_Z), 0.22, 0.28, ext=0.05)
            zs = RIDGE_Z + s * 1.75
            beam(TR, oak, (x, TIE_Y + 0.55, RIDGE_Z + s * 0.12), (x, rafter_y(zs) - 0.14, zs), 0.14, 0.16)
        beam(TR, oak, (x, TIE_Y + 0.15, RIDGE_Z), (x, RIDGE_Y - 0.1, RIDGE_Z), 0.24, 0.24, hint=(1, 0, 0))
        box(TR, oak, (x, RIDGE_Y - 0.62, RIDGE_Z), (0.16, 0.16, 2.1), bevel=0.02)
        box(IR, iron, (x + 0.13, TIE_Y + 0.02, RIDGE_Z), (0.03, 0.42, 0.36))  # king-post stirrup

    # Ridge beam (gently sagging) + purlins + common rafters.
    segs = 6
    for i in range(segs):
        x0 = -EAVE_X + i * 2 * EAVE_X / segs; x1 = x0 + 2 * EAVE_X / segs
        beam(R, oak, (x0, RIDGE_Y + sag(x0), RIDGE_Z), (x1, RIDGE_Y + sag(x1), RIDGE_Z), 0.26, 0.3, bevel=0.02, hint=(0, 0, 1))
    for s in (-1, 1):
        for frac in (0.36, 0.72):
            z = RIDGE_Z + s * 3.45 * frac
            box(R, oak, (0, rafter_y(z) + 0.02, z), (EAVE_X * 2 - 0.1, 0.18, 0.16), rot=(s * math.radians(29.5), 0, 0), bevel=0.02)
        n = 17
        for i in range(n):
            x = -8.35 + i * 16.7 / (n - 1)
            if any(abs(x - tx) < 0.3 for tx in [-8.3, -4.6, 0.0, 4.6, 8.3]): continue
            zt = RIDGE_Z + s * 3.8
            beam(R, pine, (x, rafter_y(zt) + 0.1, zt), (x, RIDGE_Y + 0.06 + sag(x), RIDGE_Z + s * 0.1), 0.1, 0.14, bevel=0.015)

    # Roof: overlapping tile courses split into slightly uneven runs.
    ang = math.atan(TAN)
    def course_row(g, z_of_t, y_of_t, t, x0, x1, s, lift):
        x = x0
        while x < x1 - 0.05:
            L = min(RNG.uniform(1.6, 3.1), x1 - x)
            if x1 - (x + L) < 0.6: L = x1 - x
            cx = x + L / 2
            jitter = RNG.uniform(-0.018, 0.018)
            box(g, "Roof_Terracotta", (cx, y_of_t(t) + sag(cx) + jitter, z_of_t(t)), (L - 0.015, 0.075, 0.78),
                rot=(s * (ang - math.radians(4.5 + lift)), RNG.uniform(-0.006, 0.006), RNG.uniform(-0.01, 0.01)), bevel=0.015)
            x += L
    for s in (-1, 1):  # sarking boards under the tiles: closes sky gaps seen from inside
        tm = 2.2
        box(RT, pine, (0, RIDGE_Y + 0.13 - tm * math.sin(ang), RIDGE_Z + s * tm * math.cos(ang)), (EAVE_X * 2, 0.03, 4.45), rot=(s * ang, 0, 0))
    for s in (-1, 1):
        t_max = 4.28
        n = 7
        for i in range(n):
            t = t_max - 0.36 - i * (t_max - 0.55) / (n - 1)
            zf = lambda t, s=s: RIDGE_Z + s * t * math.cos(ang)
            yf = lambda t: RIDGE_Y + 0.26 - t * math.sin(ang) + 0.06
            course_row(RT, zf, yf, t, -EAVE_X, EAVE_X, s, RNG.uniform(-0.8, 0.8))
    # Ridge: row of rounded capping tiles.
    for i in range(14):
        x0 = -EAVE_X + i * 2 * EAVE_X / 14; x1 = x0 + 2 * EAVE_X / 14
        y = RIDGE_Y + 0.43 + sag((x0 + x1) / 2)
        cyl(RD, "Roof_Terracotta", (x0 - 0.03, y, RIDGE_Z), (x1 + 0.03, y + RNG.uniform(-0.015, 0.015), RIDGE_Z), 0.19, 0.17, segs=8, hint=(0, 1, 0))
    # Iron ridge finials: spike + twin curls (strong silhouette at both gable peaks).
    for sx in (-1, 1):
        base = Vector((sx * (EAVE_X - 0.1), RIDGE_Y + 0.55, RIDGE_Z))
        cyl(RD, iron, base, base + Vector((0, 0.95, 0)), 0.045, 0.02, segs=6)
        sphere(RD, iron, base + Vector((0, 0.38, 0)), 0.08, 8, 4)
        for sz in (-1, 1):
            scroll(RD, base + Vector((0, 0.3, sz * 0.2)), 0.2, 0.85, 0.035, plane_rot=(0, math.pi / 2, 0), steps=9, start=math.pi if sz > 0 else 0)

    # Front cross gable over the entry (layered silhouette, frames the crest).
    CG_HALF, CG_Z0, CG_Z1 = 3.05, -3.3, 0.18
    CG_RIDGE = 6.05
    cg_ang = math.atan((CG_RIDGE - 4.55) / CG_HALF)
    for zt in (-0.3,):
        box(FG, oak, (0, TIE_Y + 0.05, zt), (CG_HALF * 2 + 0.3, 0.34, 0.32), bevel=0.04)
        for s in (-1, 1):
            beam(FG, oak, (s * (CG_HALF + 0.15), 4.5, zt), (0, CG_RIDGE + 0.02, zt), 0.26, 0.24, hint=(0, 0, 1), ext=0.05)
            beam(FG, oak, (s * 1.25, 4.72, zt), (s * 0.55, CG_RIDGE - 0.45, zt), 0.14, 0.14, hint=(0, 0, 1))
        beam(FG, oak, (0, 4.72, zt), (0, CG_RIDGE - 0.05, zt), 0.22, 0.22, hint=(0, 0, 1))
        box(FG, oak, (0, 5.45, zt), (1.9, 0.16, 0.16), bevel=0.02)
    beam(FG, oak, (0, CG_RIDGE, CG_Z0), (0, CG_RIDGE, CG_Z1 - 0.1), 0.22, 0.24, hint=(1, 0, 0))
    for s in (-1, 1):
        box(FG, pine, (s * 1.55 * math.cos(cg_ang), CG_RIDGE + 0.14 - 1.55 * math.sin(cg_ang), (CG_Z0 + CG_Z1) / 2), (3.3, 0.03, CG_Z1 - CG_Z0 - 0.05), rot=(0, 0, -s * cg_ang))
        n = 5
        for i in range(n):
            t = 3.2 - 0.3 - i * 2.9 / (n - 1)
            x = s * t * math.cos(cg_ang); y = CG_RIDGE + 0.27 - t * math.sin(cg_ang) + 0.06
            box(FG, "Roof_Terracotta", (x, y + RNG.uniform(-0.015, 0.015), (CG_Z0 + CG_Z1) / 2), (0.78, 0.075, CG_Z1 - CG_Z0),
                rot=(0, 0, -s * (cg_ang - math.radians(4.5))), bevel=0.015)
        for i in range(4):  # common rafters under the cross gable
            z = CG_Z0 + 0.6 + i * 0.85
            beam(FG, pine, (s * (CG_HALF + 0.1), 4.62, z), (0, CG_RIDGE - 0.02, z), 0.1, 0.14, bevel=0.015, hint=(0, 0, 1))
        # Scalloped barge board with notched tail
        a = Vector((s * (CG_HALF + 0.25), 4.48, CG_Z1 + 0.02)); b = Vector((0, CG_RIDGE + 0.36, CG_Z1 + 0.02))
        beam(FG, pine, a, b, 0.3, 0.07, hint=(0, 0, 1), bevel=0.02)
        for k in range(1, 6):
            p = a.lerp(b, k / 6.2) + Vector((0, -0.17, 0.02))
            sphere(FG, pine, p, 0.075, 6, 3, scale=(1, 1, 0.45))
    for i in range(6):
        z0 = CG_Z0 + i * (CG_Z1 - CG_Z0) / 6; z1 = z0 + (CG_Z1 - CG_Z0) / 6
        cyl(FG, "Roof_Terracotta", (0, CG_RIDGE + 0.43, z0 - 0.02), (0, CG_RIDGE + 0.43, z1 + 0.02), 0.17, 0.16, segs=8, hint=(0, 1, 0))
    tip = Vector((0, CG_RIDGE + 0.55, CG_Z1 - 0.05))
    cyl(FG, iron, tip, tip + Vector((0, 0.75, 0)), 0.04, 0.018, segs=6)
    for s in (-1, 1):
        scroll(FG, tip + Vector((s * 0.17, 0.26, 0)), 0.17, 0.85, 0.03, steps=9, start=0 if s > 0 else math.pi)

    # Side gable ends: half-timbered plaster triangles (above the tie beam only).
    for sx in (-1, 1):
        x = sx * 8.3
        h = RIDGE_Y - (TIE_Y + 0.17)
        tri = [(-3.6, 0), (3.6, 0), (0, h - 0.05)]
        prism(GE, "Plaster_Lime", tri, 0.12, (x - sx * 0.04, TIE_Y + 0.17, RIDGE_Z), rot=(0, math.pi / 2, 0))
        for zz in (-1.6, 1.6):
            y_top = rafter_y(RIDGE_Z + zz) - 0.12
            beam(GE, oak, (x + sx * 0.05, TIE_Y + 0.17, RIDGE_Z + zz), (x + sx * 0.05, y_top, RIDGE_Z + zz), 0.14, 0.14)
            beam(GE, oak, (x + sx * 0.05, TIE_Y + 0.2, RIDGE_Z + zz * 0.15), (x + sx * 0.05, y_top - 0.05, RIDGE_Z + zz), 0.12, 0.12)
        # barge boards following the tile edge
        for s in (-1, 1):
            a = Vector((sx * (EAVE_X + 0.02), rafter_y(RIDGE_Z + s * 4.0) + 0.22, RIDGE_Z + s * 4.05))
            b = Vector((sx * (EAVE_X + 0.02), RIDGE_Y + 0.52, RIDGE_Z))
            beam(GE, pine, a, b, 0.07, 0.32, bevel=0.02, hint=(1, 0, 0))
        # round vent / owl hole trimmed in iron
        cyl(GE, iron, (x + sx * 0.02, 5.45, RIDGE_Z), (x + sx * 0.13, 5.45, RIDGE_Z), 0.3, segs=12)
        cyl(GE, "Timber_Pine", (x + sx * 0.02, 5.45, RIDGE_Z), (x + sx * 0.16, 5.45, RIDGE_Z), 0.24, segs=12)

    # Rear wall: coursed stone plinth, quoined jambs, segmental arch, framed plaster.
    WZ = -7.58
    for sx in (-1, 1):
        for row in range(3):
            y0 = row * 0.38
            x = GATE_HALF + 0.55 + (0.3 if row % 2 else 0)
            while x < 8.5:
                L = min(RNG.uniform(0.55, 0.95), 8.5 - x)
                box(RS, stone, (sx * (x + L / 2), y0 + 0.19, WZ + RNG.uniform(-0.02, 0.02)), (L - 0.03, 0.36, 0.5), bevel=0.04)
                x += L
        # jamb quoins, alternating long/short
        y = 0.0; k = 0
        while y < GATE_SPRING - 0.05:
            hgt = 0.42 if k % 2 == 0 else 0.34
            hgt = min(hgt, GATE_SPRING - y)
            w = 0.7 if k % 2 == 0 else 0.5
            box(RS, stone, (sx * (GATE_HALF + w / 2), y + hgt / 2, WZ), (w - 0.03, hgt - 0.03, 0.56), bevel=0.04)
            y += hgt; k += 1
    rise = 0.45
    Rr = (GATE_HALF ** 2 + rise ** 2) / (2 * rise); cy = GATE_SPRING + rise - Rr
    a0 = math.asin(GATE_HALF / Rr)
    nv = 9
    for i in range(nv):
        t0 = -a0 + 2 * a0 * i / nv; t1 = t0 + 2 * a0 / nv; tm = (t0 + t1) / 2
        depth = 0.62 if i == nv // 2 else 0.48
        r_mid = Rr + depth / 2
        c = (math.sin(tm) * r_mid, cy + math.cos(tm) * r_mid, WZ)
        width = 2 * Rr * math.sin((t1 - t0) / 2)
        box(RS, stone, c, (width - 0.03, depth, 0.58 if i == nv // 2 else 0.54), rot=(0, 0, -tm), bevel=0.035)
    # tympanum above the gate leaf + plaster panels above the plinth
    box(RF, "Plaster_Lime", (0, (GATE_SPRING + 4.05) / 2 + 0.02, WZ - 0.06), (GATE_HALF * 2 + 0.6, 4.05 - GATE_SPRING, 0.16))
    for sx in (-1, 1):
        box(RF, "Plaster_Lime", (sx * (GATE_HALF + 0.55 + 8.45) / 2 + sx * 0.0, (1.14 + 4.1) / 2, WZ), ((8.45 - GATE_HALF - 0.55), 4.1 - 1.14, 0.22))
        box(RF, "Plaster_Lime", (sx * (GATE_HALF + 0.35), (GATE_SPRING + 4.1) / 2, WZ), (0.75, 4.1 - GATE_SPRING, 0.22))
    # timber framing on the yard face
    FZ = WZ + 0.16
    box(RF, oak, (0, 1.2, FZ), (16.9, 0.16, 0.14), bevel=0.02)  # sill on plinth
    for sx in (-1, 1):
        box(RF, oak, (sx * (GATE_HALF + 0.55 + 8.3) / 2, 2.55, FZ), (8.3 - GATE_HALF - 0.55, 0.14, 0.12), bevel=0.02)
        for x in (2.25, 3.4, 6.45):
            box(RF, oak, (sx * x, 2.65, FZ), (0.14, 2.9, 0.12), bevel=0.02)
        for (xa, xb) in ((4.6, 6.45), (8.3, 6.45)):
            beam(RF, oak, (sx * xa, 1.28, FZ), (sx * xb, 2.48, FZ), 0.12, 0.1, hint=(0, 0, 1))
            beam(RF, oak, (sx * xb, 2.62, FZ), (sx * xa, 4.0, FZ), 0.12, 0.1, hint=(0, 0, 1))
        # cross (St Andrew) panel between 2.25 and 3.4 above the rail — a friendly forge motif
        beam(RF, oak, (sx * 2.3, 2.65, FZ), (sx * 3.35, 4.0, FZ), 0.1, 0.1, hint=(0, 0, 1))
        beam(RF, oak, (sx * 3.35, 2.65, FZ), (sx * 2.3, 4.0, FZ), 0.1, 0.1, hint=(0, 0, 1))
        # iron wall hooks for hanging gear/workshop upgrades
        for x in (5.2, 7.3):
            cyl(IR, iron, (sx * x, 2.75, FZ + 0.05), (sx * x, 2.75, FZ + 0.22), 0.025, segs=6)
            cyl(IR, iron, (sx * x, 2.75, FZ + 0.22), (sx * x, 2.9, FZ + 0.26), 0.022, segs=6)
    # iron strap hinges pins on the jambs (gate leaf itself stays runtime)
    for sx in (-1, 1):
        for y in (0.6, 2.2):
            cyl(IR, iron, (sx * (GATE_HALF + 0.05), y - 0.12, WZ + 0.2), (sx * (GATE_HALF + 0.05), y + 0.12, WZ + 0.2), 0.04, segs=6)

    # Chimney stack rising from the runtime hearth hood (y 3.25) through the rear slope.
    y = 3.25
    hood = bmesh.new()
    bmesh.ops.create_cone(hood, cap_ends=True, segments=4, radius1=0.98, radius2=0.78, depth=0.6, matrix=Matrix.Rotation(math.pi / 4, 4, "Z"))
    for v in hood.verts: v.co.y *= 0.82
    CH.add_bm(hood, stone, Matrix.Translation(CHIM + Vector((0, y + 0.3, 0))) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    y += 0.6
    k = 0
    while y < 7.25:
        h = 0.42 + (0.04 if k % 2 else 0)
        w = 1.12 - 0.012 * k + RNG.uniform(-0.02, 0.02)
        box(CH, stone, CHIM + Vector((RNG.uniform(-0.015, 0.015), y + h / 2, 0)), (w, h - 0.02, 0.92 - 0.01 * k), bevel=0.05, rot=(0, RNG.uniform(-0.02, 0.02), 0))
        y += h; k += 1
    box(CH, stone, CHIM + Vector((0, y + 0.1, 0)), (1.26, 0.2, 1.06), bevel=0.05)
    box(CH, stone, CHIM + Vector((0, y + 0.35, 0)), (1.08, 0.3, 0.9), bevel=0.05)
    box(CH, stone, CHIM + Vector((0, y + 0.56, 0)), (1.2, 0.12, 1.0), bevel=0.03)
    for dx, hh in ((-0.24, 0.5), (0.26, 0.36)):
        b0 = CHIM + Vector((dx, y + 0.62, 0))
        cyl(CH, "Roof_Terracotta", b0, b0 + Vector((0, hh, 0)), 0.16, 0.13, segs=8)
        cyl(CH, "Roof_Terracotta", b0 + Vector((0, hh, 0)), b0 + Vector((0, hh + 0.06, 0)), 0.17, segs=8)
    for by in (4.3, 5.6):
        box(IR, iron, CHIM + Vector((0, by, 0)), (1.2, 0.07, 1.0))
    json_extra = {"chimney_top_y": round(y + 0.62, 3)}
    return G, json_extra

# ---------------------------------------------------------------- detail kit modules
def kit_crest():
    g = Group("Kit_ForgeCrest", origin=(0, 5.05, 0.1))
    o = g.origin
    cyl(g, "Timber_Oak", o + Vector((0, 0, -0.07)), o + Vector((0, 0, 0.05)), 0.62, segs=20, hint=(1, 0, 0))
    cyl(g, "Brass_Trim", o + Vector((0, 0, -0.06)), o + Vector((0, 0, 0.07)), 0.67, segs=20, hint=(1, 0, 0))
    cyl(g, "Cloth_Banner", o + Vector((0, 0, 0.07)), o + Vector((0, 0, 0.09)), 0.54, segs=20, hint=(1, 0, 0))
    anvil = [(-0.34, 0.06), (0.36, 0.06), (0.36, 0.0), (0.2, -0.04), (0.12, -0.14), (0.2, -0.24), (-0.2, -0.24),
             (-0.12, -0.14), (-0.2, -0.04), (-0.3, 0.0), (-0.44, 0.03)]
    prism(g, "Iron_Wrought", anvil, 0.06, o + Vector((0, -0.05, 0.12)), bevel=0.01)
    # crossed hammers above the anvil
    for s in (-1, 1):
        R = (0, 0, s * 0.62)
        box(g, "Timber_Pine", o + Vector((s * 0.02, 0.22, 0.13)), (0.05, 0.56, 0.04), rot=R)
        hx = o + Vector((0, 0.22, 0.14)) + Euler(R).to_matrix() @ Vector((0, 0.26, 0))
        box(g, "Iron_Wrought", hx, (0.2, 0.09, 0.07), rot=R, bevel=0.01)
    # ember gem
    sphere(g, "Lantern_Glow", o + Vector((0, -0.38, 0.12)), 0.07, 8, 4, scale=(1, 1, 0.5))
    # iron chains to the gable collar
    for s in (-1, 1):
        for k in range(4):
            box(g, "Iron_Wrought", o + Vector((s * 0.38, 0.62 + k * 0.1, 0.0)), (0.03, 0.09, 0.05 if k % 2 else 0.02))
    # scroll wings
    for s in (-1, 1):
        scroll(g, o + Vector((s * 0.82, 0.05, 0.02)), 0.2, 0.9, 0.035, steps=10, start=0 if s > 0 else math.pi)
    return g, {"attach": "front gable collar, hangs in front of truss", "clearance_bottom_y": 4.38}

def kit_banner(side):
    x = side * 6.45
    g = Group(f"Kit_Banner_{'East' if side > 0 else 'West'}", origin=(x, 4.0, FRONT_Z + 0.24))
    o = g.origin
    cyl(g, "Brass_Trim", o + Vector((-0.55, 0, 0)), o + Vector((0.55, 0, 0)), 0.03, segs=6)
    for s in (-1, 1):
        sphere(g, "Brass_Trim", o + Vector((s * 0.58, 0, 0)), 0.05, 6, 4)
    outline = [(-0.45, 0), (0.45, 0), (0.45, -1.15), (0.0, -0.9), (-0.45, -1.15)]
    prism(g, "Cloth_Banner", outline, 0.03, o + Vector((0, -0.04, 0)))
    trim = [(-0.45, -0.02), (0.45, -0.02), (0.45, -0.1), (-0.45, -0.1)]
    prism(g, "Brass_Trim", trim, 0.035, o + Vector((0, -0.06, 0.003)))
    # emblem: hammer silhouette + ember
    for s in (-1, 1):  # crossed hammers, like the crest
        R = (0, 0, s * 0.7)
        box(g, "Brass_Trim", o + Vector((0, -0.45, 0.025)), (0.05, 0.5, 0.02), rot=R)
        box(g, "Brass_Trim", o + Vector((0, -0.45, 0.028)) + Euler(R).to_matrix() @ Vector((0, 0.24, 0)), (0.2, 0.08, 0.02), rot=R)
    sphere(g, "Lantern_Glow", o + Vector((0, -0.74, 0.03)), 0.05, 6, 4, scale=(1, 1, 0.4))
    return g, {"attach": "hangs from front wall plate between posts", "clearance_bottom_y": 2.85}

def kit_lantern(x, name):
    z = FRONT_Z + 0.18
    g = Group(name, origin=(x, 3.1, z))
    o = g.origin
    box(g, "Iron_Wrought", o + Vector((0, 0, 0.02)), (0.16, 0.34, 0.04))  # wall plate
    arm_end = o + Vector((0, 0.05, 0.55))
    beam(g, "Iron_Wrought", o + Vector((0, 0.08, 0.02)), arm_end, 0.04, 0.04, bevel=0)
    beam(g, "Iron_Wrought", o + Vector((0, -0.14, 0.03)), o + Vector((0, 0.05, 0.36)), 0.03, 0.03, bevel=0)
    scroll(g, o + Vector((0, -0.02, 0.22)), 0.1, 0.9, 0.022, plane_rot=(0, -math.pi / 2, 0), steps=8)
    hang = arm_end + Vector((0, -0.12, 0))
    cyl(g, "Iron_Wrought", arm_end, hang, 0.012, segs=4)
    cyl(g, "Iron_Wrought", hang, hang + Vector((0, -0.12, 0)), 0.03, 0.14, segs=6)  # cap
    body_c = hang + Vector((0, -0.3, 0))
    cyl(g, "Lantern_Glow", body_c + Vector((0, -0.17, 0)), body_c + Vector((0, 0.17, 0)), 0.1, 0.11, segs=6)
    for k in range(6):
        a = k * math.pi / 3
        p = body_c + Vector((math.cos(a) * 0.12, 0, math.sin(a) * 0.12))
        box(g, "Iron_Wrought", p, (0.022, 0.36, 0.022))
    cyl(g, "Iron_Wrought", body_c + Vector((0, -0.2, 0)), body_c + Vector((0, -0.16, 0)), 0.14, segs=6)
    sphere(g, "Brass_Trim", body_c + Vector((0, -0.25, 0)), 0.035, 6, 3)
    return g, {"attach": "front face of post, lantern bottom ~2.55 m", "light_socket": [round(v, 3) for v in body_c], "clearance_bottom_y": 2.55}

def kit_tool_rack(side):
    x = side * 6.4
    g = Group(f"Kit_ToolRack_{'East' if side > 0 else 'West'}", origin=(x, 0.0, -7.34))
    o = g.origin
    box(g, "Timber_Oak", o + Vector((0, 2.05, 0.04)), (1.9, 0.14, 0.08), bevel=0.02)
    box(g, "Timber_Oak", o + Vector((0, 1.45, 0.04)), (1.9, 0.12, 0.08), bevel=0.02)
    for k in range(7):
        px = -0.8 + k * 0.27
        cyl(g, "Timber_Pine", o + Vector((px, 2.05, 0.08)), o + Vector((px, 2.08, 0.26)), 0.022, segs=6)
    # hanging tools: tongs, hammers, files (chunky, readable silhouettes)
    for k, kind in enumerate(["tongs", "hammer", "tongs", "file", "hammer", "hammer", "tongs"]):
        px = -0.8 + k * 0.27
        top = o + Vector((px, 2.02, 0.22))
        if kind == "tongs":
            for s in (-1, 1):
                beam(g, "Iron_Wrought", top, top + Vector((s * 0.05, -0.62, 0)), 0.022, 0.022, bevel=0)
            box(g, "Iron_Wrought", top + Vector((0, -0.04, 0)), (0.06, 0.08, 0.04))
        elif kind == "hammer":
            beam(g, "Timber_Pine", top, top + Vector((0, -0.46, 0)), 0.04, 0.04, bevel=0.008)
            box(g, "Iron_Wrought", top + Vector((0, -0.5, 0)), (0.18, 0.07, 0.07), bevel=0.012)
        else:
            beam(g, "Iron_Wrought", top, top + Vector((0, -0.5, 0)), 0.035, 0.012, bevel=0)
            beam(g, "Timber_Pine", top, top + Vector((0, -0.14, 0)), 0.04, 0.04, bevel=0.008)
    # lower shelf with stoneware pots and a coal scuttle
    box(g, "Timber_Oak", o + Vector((0, 1.0, 0.2)), (1.8, 0.07, 0.36), bevel=0.015)
    for s in (-1, 1):
        beam(g, "Iron_Wrought", o + Vector((s * 0.75, 0.75, 0.02)), o + Vector((s * 0.75, 0.97, 0.36)), 0.03, 0.03, bevel=0)
    for k, px in enumerate((-0.6, -0.3, 0.45)):
        cyl(g, "Roof_Terracotta", o + Vector((px, 1.04, 0.2)), o + Vector((px, 1.24 + 0.06 * k, 0.2)), 0.1, 0.08, segs=8)
    cyl(g, "Iron_Wrought", o + Vector((0.1, 1.04, 0.2)), o + Vector((0.1, 1.2, 0.2)), 0.12, 0.14, segs=8)
    return g, {"attach": "yard face of rear wall, behind the interaction table", "depth_m": 0.4}

def kit_entry_arch():
    g = Group("Kit_EntryArch", origin=(0, 0, 2.7))
    o = g.origin
    for s in (-1, 1):
        base = o + Vector((s * 1.3, 0, 0))
        box(g, "Stone_Warm", base + Vector((0, 0.3, 0)), (0.5, 0.6, 0.5), bevel=0.05, rot=(0, s * 0.06, 0))
        box(g, "Timber_Oak", base + Vector((0, 1.9, 0)), (0.24, 2.6, 0.24), bevel=0.03)
        for k in range(3):
            box(g, "Iron_Wrought", base + Vector((0, 0.9 + k * 0.9, 0)), (0.26, 0.05, 0.26))
        beam(g, "Timber_Oak", base + Vector((0, 2.6, 0)), base + Vector((-s * 0.55, 3.15, 0)), 0.12, 0.14, hint=(0, 0, 1))
    box(g, "Timber_Oak", o + Vector((0, 3.3, 0)), (3.4, 0.24, 0.28), bevel=0.03)
    box(g, "Timber_Pine", o + Vector((0, 3.52, 0)), (2.9, 0.2, 0.34), bevel=0.03)
    for s in (-1, 1):
        box(g, "Roof_Terracotta", o + Vector((s * 0.6, 3.68, 0)), (1.35, 0.06, 0.52), rot=(0, 0, -s * 0.18), bevel=0.01)
    # hanging hoop with tiny anvil icon — no text
    ring_c = o + Vector((0, 2.95, 0))
    for k in range(12):
        a0 = k * math.pi / 6; a1 = a0 + math.pi / 6
        beam(g, "Iron_Wrought", ring_c + Vector((math.cos(a0) * 0.2, math.sin(a0) * 0.2, 0)), ring_c + Vector((math.cos(a1) * 0.2, math.sin(a1) * 0.2, 0)), 0.03, 0.03, bevel=0, ext=0.012)
    cyl(g, "Iron_Wrought", ring_c + Vector((0, 0.2, 0)), o + Vector((0, 3.18, 0)), 0.012, segs=4)
    sphere(g, "Lantern_Glow", ring_c, 0.07, 8, 4)
    return g, {"attach": "stands over the flagstone path; 2.36 m clear between post faces, 2.95 m under hoop",
               "clearance_bottom_y": 2.88}

def kit_expansion_stub(side):
    """Skeletal lean-to on the open side: says 'the workshop grows here'."""
    g = Group(f"Kit_ExpansionFrame_{'East' if side > 0 else 'West'}", origin=(side * 9.6, 0, -3.9))
    o = g.origin
    xo = side * 10.7
    for z in (-6.4, -1.4):
        box(g, "Stone_Warm", (xo, 0.12, z), (0.5, 0.24, 0.5), bevel=0.04)
        box(g, "Timber_Pine", (xo, 1.62, z), (0.26, 3.0, 0.26), bevel=0.03)
        beam(g, "Timber_Pine", (xo, 2.3, z), (xo - side * 0.7, 3.05, z), 0.12, 0.14, hint=(0, 0, 1))
    box(g, "Timber_Pine", (xo, 3.2, -3.9), (0.28, 0.28, 5.6), bevel=0.03)
    for z in (-6.2, -4.6, -3.2, -1.6):
        beam(g, "Timber_Pine", (side * 8.45, 4.02, z), (side * 11.0, 3.08, z), 0.1, 0.14, hint=(0, 0, 1))
    # a partly laid batten row + stacked fresh planks and a lashed tarp bundle on the ground
    for k, yy in enumerate((3.72, 3.4)):
        xx = side * (9.0 + k * 0.85)
        box(g, "Timber_Pine", (xx, yy + 0.09, -3.9), (0.16, 0.06, 5.4), rot=(0, 0, side * 0.35))
    for k in range(4):
        box(g, "Timber_Pine", (side * 9.7, 0.08 + k * 0.1, -3.9 + RNG.uniform(-0.1, 0.1)), (0.36, 0.08, 3.2), rot=(0, RNG.uniform(-0.05, 0.05), 0), bevel=0.01)
    box(g, "Cloth_Banner", (side * 9.7, 0.55, -2.8), (0.5, 0.3, 0.9), bevel=0.08)
    for dz in (-0.25, 0.25):
        box(g, "Iron_Wrought", (side * 9.7, 0.55, -2.8 + dz), (0.52, 0.32, 0.03))
    return g, {"attach": "outside the open side bay; posts at x=+/-10.7 (trees at x=+/-11,z=-9 and x=+/-12,z=3 stay clear)"}

# ---------------------------------------------------------------- main
def main():
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
    build_materials()
    scene = bpy.context.scene
    col_shell = bpy.data.collections.new("forge_shelter"); scene.collection.children.link(col_shell)
    col_kit = bpy.data.collections.new("forge_detail_kit"); scene.collection.children.link(col_kit)

    shell, extra = build_shell()
    shell_objs = [g.build(col_shell) for g in shell.values()]

    kit_defs = [kit_crest(), kit_banner(-1), kit_banner(1)]
    for x in POST_X:
        kit_defs.append(kit_lantern(x, f"Kit_Lantern_{'W' if x < 0 else 'E'}{abs(x):.1f}".replace(".", "_")))
    kit_defs += [kit_tool_rack(-1), kit_tool_rack(1), kit_entry_arch(), kit_expansion_stub(-1), kit_expansion_stub(1)]
    kit_objs = []
    for g, meta in kit_defs:
        kit_objs.append((g.build(col_kit), g, meta))

    def export(objs, path):
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs: ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                                  export_apply=True, export_image_format="AUTO", export_materials="EXPORT")

    export(shell_objs, os.path.join(OUT, "forge_shelter.glb"))
    export([o for o, _, _ in kit_objs], os.path.join(OUT, "forge_detail_kit.glb"))
    # per-module GLBs with origin at the anchor (move temporarily to world origin)
    for ob, g, _ in kit_objs:
        loc = ob.location.copy(); ob.location = (0, 0, 0)
        export([ob], os.path.join(OUT, "kit_modules", ob.name + ".glb"))
        ob.location = loc

    # ---- layout + collision recommendations (game coordinates)
    def cbox(name, c, s, note=""):
        return {"name": name, "center": [round(v, 3) for v in c], "size": [round(v, 3) for v in s], **({"note": note} if note else {})}
    coll = []
    for x in POST_X:
        for z in (FRONT_Z, REAR_Z):
            coll.append(cbox(f"Post_{x:+.1f}_{z:+.2f}", (x, 1.95, z), (0.45, 3.9, 0.45)))
    for x in (-8.3, 8.3):
        coll.append(cbox(f"Post_{x:+.1f}_mid", (x, 1.95, RIDGE_Z), (0.45, 3.9, 0.45)))
    for sx in (-1, 1):
        c_x = sx * (GATE_HALF + 8.5) / 2
        coll.append(cbox(f"RearWall_{'E' if sx > 0 else 'W'}", (c_x, 2.1, -7.55), (8.5 - GATE_HALF, 4.2, 0.6)))
    coll.append(cbox("RearWall_OverGate", (0, (GATE_SPRING + 4.2) / 2, -7.55), (GATE_HALF * 2, 4.2 - GATE_SPRING, 0.6),
                     "above the gate aperture only; FoundryGate keeps its own runtime body"))
    kit_coll = {
        "Kit_EntryArch": [cbox("EntryPost_W", (-1.3, 1.6, 2.7), (0.5, 3.2, 0.5)), cbox("EntryPost_E", (1.3, 1.6, 2.7), (0.5, 3.2, 0.5))],
        "Kit_ToolRack_West": [cbox("ToolRack_W", (-6.4, 1.5, -7.14), (1.9, 1.3, 0.4), "optional; rear wall box already covers most")],
        "Kit_ToolRack_East": [cbox("ToolRack_E", (6.4, 1.5, -7.14), (1.9, 1.3, 0.4), "optional; rear wall box already covers most")],
        "Kit_ExpansionFrame_West": [cbox("WingPost_W_rear", (-10.7, 1.6, -6.4), (0.4, 3.2, 0.4)), cbox("WingPost_W_front", (-10.7, 1.6, -1.4), (0.4, 3.2, 0.4)),
                                    cbox("PlankStack_W", (-9.7, 0.35, -3.9), (0.6, 0.7, 3.3))],
        "Kit_ExpansionFrame_East": [cbox("WingPost_E_rear", (10.7, 1.6, -6.4), (0.4, 3.2, 0.4)), cbox("WingPost_E_front", (10.7, 1.6, -1.4), (0.4, 3.2, 0.4)),
                                    cbox("PlankStack_E", (9.7, 0.35, -3.9), (0.6, 0.7, 3.3))],
    }
    def bounds(g):
        xs = [v.x + g.origin.x for v in g.v]; ys = [v.y + g.origin.y for v in g.v]; zs = [v.z + g.origin.z for v in g.v]
        return {"min": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)], "max": [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]}
    layout = {
        "coordinate_system": "Godot: metres, +Y up, front +Z, ground y=0. All positions are world positions in the forge_yard zone root.",
        "forge_shelter": {"file": "forge_shelter.glb", "position": [0, 0, 0], "rotation_deg": [0, 0, 0],
                          "groups": {g.name: {"triangles": g.tris(), "materials": g.mats, "bounds": bounds(g)} for g in shell.values()},
                          "chimney_smoke_socket": [CHIM.x, extra["chimney_top_y"], CHIM.z],
                          "collision_boxes": coll},
        "forge_detail_kit": {"file": "forge_detail_kit.glb", "note": "modules are pre-placed in this file; kit_modules/*.glb are the same meshes with origin at 'position'",
                             "modules": {g.name: {"file": f"kit_modules/{g.name}.glb", "position": [round(v, 3) for v in g.origin], "rotation_deg": [0, 0, 0],
                                                  "triangles": g.tris(), "materials": g.mats, "bounds": bounds(g), **meta,
                                                  "collision_boxes": kit_coll.get(g.name, [])} for _, g, meta in kit_objs}},
        "anchors_respected": {"brann": [0, 0, -4], "tables": [[-5.4, 0, -4.7], [5.4, 0, -4.7]], "foundry_gate": [0, 1.4, -7.6],
                              "gate_clear_aperture_m": [GATE_HALF * 2, GATE_SPRING], "roof_eave_x": EAVE_X, "roof_z": [-7.75, 0.2],
                              "min_head_clearance_inside_m": 3.15, "approach_view_from": [0, 1.6, 8]},
    }
    with open(os.path.join(OUT, "layout.json"), "w") as fh: json.dump(layout, fh, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "forge_yard_source.blend"), compress=True)
    tot_s = sum(g.tris() for g in shell.values()); tot_k = sum(g.tris() for _, g, _ in kit_objs)
    print(f"BUILD_OK shell_tris={tot_s} kit_tris={tot_k} total={tot_s + tot_k} materials={len(MATS)}")

main()
