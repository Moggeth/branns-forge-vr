# Brann's Forge hub - sheltered mountain meadow landscape.
# Run: blender.exe -b --factory-startup --python build_valley.py
# All authoring is in Godot coords (X right, Y up, Z toward portal garden); converted to Blender (X,-Z,Y)
# and exported with +Y up so the GLB lands at identity world coordinates in Godot.
import bpy, math, random, os, sys
from mathutils import Vector, noise

OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7)
RX0, RX1, RZ0, RZ1 = -15.0, 35.0, -15.0, 15.0   # playable yard
CX, CZ = 10.0, 0.0                               # landscape centre

def clamp(t, a=0.0, b=1.0): return a if t < a else b if t > b else t
def ss(a, b, t):
    t = clamp((t - a) / (b - a)); return t * t * (3 - 2 * t)
def rect_d(x, z):
    dx = max(RX0 - x, 0.0, x - RX1); dz = max(RZ0 - z, 0.0, z - RZ1)
    return math.hypot(dx, dz)
def n2(x, z, s, o=0.0): return noise.noise(Vector((x / s + o, z / s - o, 0.37 + o)))
def fbm(x, z, s, octs=4, o=0.0):
    v, a, f, tot = 0.0, 1.0, 1.0, 0.0
    for _ in range(octs):
        v += a * n2(x * f, z * f, s, o); tot += a; a *= 0.5; f *= 2.03
    return v / tot
def ridged(x, z, s, octs=5):
    v, a, f, tot = 0.0, 1.0, 1.0, 0.0
    for i in range(octs):
        r = 1.0 - abs(n2(x * f, z * f, s, 3.1 + i)); v += a * r * r; tot += a; a *= 0.5; f *= 2.1
    return v / tot
def ang_noise(a, seed, freq=1.3):
    return noise.noise(Vector((math.cos(a) * freq + seed, math.sin(a) * freq - seed, seed * 0.7)))
def gauss_ang(a, c, w):
    d = math.atan2(math.sin(a - c), math.cos(a - c)); return math.exp(-(d / w) ** 2)

# Stream polyline on the west side (Godot x,z)
STREAM = [(-150, -95), (-105, -70), (-72, -48), (-48, -36), (-34, -18), (-31, 2), (-36, 22), (-55, 44), (-85, 66), (-125, 92)]
def stream_dist(x, z):
    best = 1e9
    for (ax, az), (bx, bz) in zip(STREAM, STREAM[1:]):
        vx, vz = bx - ax, bz - az; t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))
        best = min(best, math.hypot(x - ax - vx * t, z - az - vz * t))
    return best

def height(x, z):
    d = rect_d(x, z)
    a = math.atan2(z - CZ, x - CX)
    h = -0.32 + 3.0 * ss(3.0, 42.0, d) ** 1.4 + 0.9 * fbm(x, z, 24) * ss(6, 26, d)
    # near/mid ridges 38-90m: bumps with saddles, lowered behind portals (+Z) and in two sightline gaps
    hillA = 17 + 13 * ang_noise(a, 1.7)
    hillA *= (1 - 0.72 * gauss_ang(a, math.pi / 2, 0.42)) * (1 - 0.6 * gauss_ang(a, -2.35, 0.25)) * (1 - 0.55 * gauss_ang(a, 0.25, 0.2))
    s = 44 + 14 * ang_noise(a, 4.2, 1.9)
    prof = ss(s - 10, s + 20, d) * (1 - 0.55 * ss(s + 28, s + 55, d))
    h += hillA * prof * (0.55 + 0.6 * fbm(x, z, 48, 4, 2.0))
    # second softer layer 70-100m
    s2 = 82 + 10 * ang_noise(a, 7.3)
    h += (10 + 9 * ang_noise(a, 2.9, 2.2)) * ss(s2 - 15, s2 + 15, d) * (0.6 + 0.5 * fbm(x, z, 60, 3, 5.0))
    # distant rocky mountains 120-190m
    m0 = 118 + 12 * ang_noise(a, 9.1)
    mA = (52 + 40 * ang_noise(a, 6.6, 1.6)) * (1 - 0.35 * gauss_ang(a, math.pi / 2, 0.5))
    h += mA * ss(m0 - 5, m0 + 62, d) ** 1.3 * (0.4 + 0.8 * ridged(x, z, 85))
    # stream carve
    sd = stream_dist(x, z)
    h -= 0.9 * ss(6.0, 1.0, sd) * ss(3, 10, d)
    return h

def B(x, y, z): return (x, -z, y)   # Godot -> Blender

def make_obj(name, verts, faces, cols, mat, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata([B(*v) for v in verts], [], faces); me.update()
    ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    flat = []
    for c in cols: flat += [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1.0]
    ca.data.foreach_set("color", flat)
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob

def make_mat(name, rough, metal=0.0, spec=0.3, double=False, alpha=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough; bsdf.inputs["Metallic"].default_value = metal
    m.use_backface_culling = not double
    return m

def mix(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
HAZE = (0.62, 0.70, 0.80)

# ---------------- terrain ----------------
def build_terrain(mat):
    rings = [0.0, 6.0, 11.0]
    r = 13.0
    while r < 62: rings.append(r); r += 2.0
    while r < 206: rings.append(r); r *= 1.075
    rings.append(206.0)
    SEG = 256
    verts, cols, faces = [], [], []
    verts.append((CX, height(CX, CZ), CZ))
    for r in rings[1:]:
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            x, z = CX + r * math.cos(a), CZ + r * math.sin(a)
            verts.append((x, height(x, z), z))
    for i in range(SEG): faces.append((0, 1 + (i + 1) % SEG, 1 + i))
    for k in range(len(rings) - 2):
        b0, b1 = 1 + k * SEG, 1 + (k + 1) * SEG
        for i in range(SEG):
            j = (i + 1) % SEG
            faces.append((b0 + i, b0 + j, b1 + j, b1 + i))
    # colours from slope (finite differences)
    for (x, y, z) in verts:
        e = 1.5
        gx = (height(x + e, z) - height(x - e, z)) / (2 * e); gz = (height(x, z + e) - height(x, z - e)) / (2 * e)
        slope = clamp(math.hypot(gx, gz) / 1.4)
        d = rect_d(x, z)
        lush = (0.31, 0.43, 0.15); dry = (0.58, 0.54, 0.25); moss = (0.22, 0.33, 0.13)
        c = mix(lush, dry, clamp(0.5 + 0.9 * fbm(x, z, 30, 3, 8.0)))
        c = mix(c, moss, clamp(0.4 + fbm(x, z, 11, 2, 1.3)) * 0.5)
        c = mix(c, (0.40, 0.46, 0.22), ss(50, 100, d) * 0.5)          # forested shoulders slightly darker/olive
        rock = mix((0.45, 0.43, 0.40), (0.56, 0.53, 0.49), clamp(0.5 + fbm(x, z, 9, 2, 4.0)))
        rockiness = ss(0.45, 0.85, slope + 0.25 * fbm(x, z, 14, 2, 6.0)) + ss(105, 150, d) * 0.55
        c = mix(c, rock, clamp(rockiness))
        snow = ss(88, 108, y + 10 * fbm(x, z, 12, 2, 3.0)) * (1 - ss(0.75, 1.0, slope))
        c = mix(c, (0.92, 0.93, 0.95), snow)
        sd = stream_dist(x, z)
        c = mix(c, (0.38, 0.36, 0.30), ss(4.0, 1.0, sd) * ss(3, 10, d) * 0.7)   # gravel bed
        c = mix(c, HAZE, ss(85, 195, d) * 0.62)                                    # aerial perspective
        if d < 2.0: c = mix(c, (0.30, 0.28, 0.20), 0.4)                          # under-yard staging
        cols.append(c)
    return make_obj("Valley_Terrain", verts, faces, cols, mat, smooth=True)

# ---------------- props helpers ----------------
class Batch:
    def __init__(self): self.v, self.f, self.c = [], [], []
    def add(self, verts, faces, col):
        o = len(self.v); self.v += verts; self.f += [tuple(i + o for i in f) for f in faces]
        self.c += [col(v) if callable(col) else col for v in verts]
    def tris(self): return sum(len(f) - 2 for f in self.f)

def cone(bt, x, y, z, rad, hgt, sides, col, rot):
    verts = [(x, y + hgt, z)] + [(x + rad * math.cos(rot + 2 * math.pi * i / sides), y, z + rad * math.sin(rot + 2 * math.pi * i / sides)) for i in range(sides)]
    faces = [(0, 1 + (i + 1) % sides, 1 + i) for i in range(sides)] + [tuple(1 + i for i in range(sides))]
    bt.add(verts, faces, col)

def blob(bt, x, y, z, rx, ry, rz, col_fn, subd_seed):
    # low icosahedron-ish blob (octa subdiv 1 = 32 tris)
    base = [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
    tri = [(0,2,4),(4,2,1),(1,2,5),(5,2,0),(0,4,3),(4,1,3),(1,5,3),(5,0,3)]
    vs = [Vector(p) for p in base]; fs = []; cache = {}
    def mid(a, b):
        k = (min(a, b), max(a, b))
        if k not in cache: vs.append(((vs[a] + vs[b]) / 2).normalized()); cache[k] = len(vs) - 1
        return cache[k]
    for a, b, c in tri:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        fs += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
    out = []
    for p in vs:
        j = 1 + 0.28 * noise.noise(p * 1.7 + Vector((subd_seed, subd_seed * 0.3, 0)))
        out.append((x + p.x * rx * j, y + p.y * ry * j, z + p.z * rz * j))
    bt.add(out, [(f[0], f[2], f[1]) for f in fs], col_fn)

KEEP = 3.0
def ok_spot(x, z, radius):
    return rect_d(x, z) > KEEP + radius + 0.3

# ---------------- trees ----------------
def build_trees(mat):
    bt = Batch(); placed = []
    centres = []
    while len(centres) < 34:
        a = random.uniform(-math.pi, math.pi); r = random.uniform(32, 105)
        x, z = CX + r * math.cos(a), CZ + r * math.sin(a)
        d = rect_d(x, z)
        if d < 9 or stream_dist(x, z) < 6: continue
        if gauss_ang(a, math.pi / 2, 0.3) > 0.6 and d < 60: continue   # keep portal sightline open
        centres.append((x, z, random.randint(3, 11), random.uniform(4, 11)))
    # lone sentinel trees in the meadow
    for _ in range(14):
        a = random.uniform(-math.pi, math.pi); r = random.uniform(30, 55)
        centres.append((CX + r * math.cos(a), CZ + r * math.sin(a), 1, 1.0))
    for (cx, cz, n, spread) in centres:
        for _ in range(n):
            x, z = cx + random.gauss(0, spread), cz + random.gauss(0, spread)
            H = random.uniform(4.5, 11.0) * (1.0 if rect_d(x, z) > 25 else 0.75)
            R = H * random.uniform(0.24, 0.3)
            if not ok_spot(x, z, R) or stream_dist(x, z) < 4: continue
            if any(math.hypot(x - px, z - pz) < (R + pr) * 0.7 for px, pz, pr in placed): continue
            placed.append((x, z, R)); y = height(x, z) - 0.25
            d = rect_d(x, z); haze = ss(70, 130, d) * 0.35
            broad = random.random() < 0.18 and d < 60
            tint = random.uniform(-0.03, 0.03)
            cone(bt, x, y, z, H * 0.045, H * 0.45, 5, mix((0.33, 0.24, 0.16), HAZE, haze), random.random())
            if broad:   # rounded alder/birch copse member
                blob(bt, x, y + H * 0.55, z, R * 1.15, H * 0.36, R * 1.15,
                     lambda v, t=tint: mix((0.36 + t, 0.50 + t, 0.18), HAZE, haze), random.random() * 10)
            else:
                rot = random.random() * 6
                for k, (fy, fr, fh) in enumerate([(0.18, 1.0, 0.46), (0.40, 0.78, 0.40), (0.62, 0.52, 0.38)]):
                    g = (0.13 + tint + 0.025 * k, 0.25 + tint + 0.035 * k, 0.13 + 0.01 * k)
                    cone(bt, x, y + H * fy, z, R * fr, H * fh, 7, mix(g, HAZE, haze), rot + k)
    print("trees", len(placed), "tris", bt.tris())
    return make_obj("Valley_Trees", bt.v, bt.f, bt.c, mat), placed

# ---------------- rocks ----------------
def build_rocks(mat, trees):
    bt = Batch(); n = 0
    def add_rock(x, z, s):
        nonlocal n
        if not ok_spot(x, z, s * 1.4) or stream_dist(x, z) < 2.5 + s: return
        if any(math.hypot(x - px, z - pz) < pr + s for px, pz, pr in trees): return
        y = height(x, z) - s * 0.35; d = rect_d(x, z)
        base = mix((0.50, 0.48, 0.44), (0.60, 0.57, 0.51), random.random())
        haze = ss(80, 150, d) * 0.45
        def col(v, base=base, y0=y, s=s):
            moss = ss(0.2, 0.9, (v[1] - y0) / (s * 1.4)) * 0.45 * (0.5 + 0.5 * n2(v[0], v[2], 3))
            return mix(mix(base, (0.33, 0.40, 0.18), moss), HAZE, haze)
        blob(bt, x, y, z, s * random.uniform(1.0, 1.6), s * random.uniform(0.55, 0.9), s * random.uniform(0.9, 1.4), col, random.random() * 20)
        n += 1
    # scree fans at feet of slopes + meadow boulders
    for _ in range(26):
        a = random.uniform(-math.pi, math.pi); r = random.uniform(38, 120)
        cx, cz = CX + r * math.cos(a), CZ + r * math.sin(a)
        for _ in range(random.randint(3, 9)):
            add_rock(cx + random.gauss(0, 5), cz + random.gauss(0, 5), random.uniform(0.5, 2.4) * (1 + r / 120))
    for _ in range(40):
        a = random.uniform(-math.pi, math.pi); r = random.uniform(24, 60)
        add_rock(CX + r * math.cos(a), CZ + r * math.sin(a), random.uniform(0.4, 1.5))
    # stream-side stones
    for (ax, az), (bx, bz) in zip(STREAM[2:7], STREAM[3:8]):
        for _ in range(5):
            t = random.random(); x, z = ax + (bx - ax) * t, az + (bz - az) * t
            add_rock(x + random.choice((-1, 1)) * random.uniform(3.5, 5), z + random.uniform(-2, 2), random.uniform(0.35, 0.8))
    print("rocks", n, "tris", bt.tris())
    return make_obj("Valley_Rocks", bt.v, bt.f, bt.c, mat)

# ---------------- flora (wildflowers + grass tufts) ----------------
FLOWER_COLS = [(0.95, 0.93, 0.85), (0.98, 0.82, 0.30), (0.70, 0.62, 0.86), (0.90, 0.42, 0.28), (0.96, 0.70, 0.75)]
def build_flora(mat):
    bt = Batch()
    for _ in range(110):
        a = random.uniform(-math.pi, math.pi); r = random.uniform(18, 60)
        cx, cz = CX + r * math.cos(a), CZ + r * math.sin(a)
        col = random.choice(FLOWER_COLS); kind = random.random()
        for _ in range(random.randint(10, 26)):
            x, z = cx + random.gauss(0, 3.5), cz + random.gauss(0, 3.5)
            if rect_d(x, z) < KEEP + 0.5 or stream_dist(x, z) < 2: continue
            y = height(x, z) - 0.05; h = random.uniform(0.25, 0.5); w = random.uniform(0.08, 0.14); rot = random.random() * 3
            dx, dz = math.cos(rot) * w, math.sin(rot) * w
            if kind < 0.45:   # flower head on a stem pair
                bt.add([(x - dx * 0.2, y, z - dz * 0.2), (x + dx * 0.2, y, z + dz * 0.2), (x, y + h, z)], [(0, 1, 2)], (0.30, 0.42, 0.16))
                bt.add([(x - dx, y + h, z - dz), (x + dz, y + h + w * 0.4, z - dx), (x + dx, y + h, z + dz), (x - dz, y + h + w * 0.4, z + dx)], [(0, 1, 2, 3)], col)
            else:             # grass tuft with flower tips
                for k in range(3):
                    rr = rot + k * 2.1; ex, ez = math.cos(rr) * 0.12, math.sin(rr) * 0.12
                    tipc = col if k == 0 else (0.52, 0.55, 0.24)
                    bt.add([(x - ez * 0.5, y, z + ex * 0.5), (x + ez * 0.5, y, z - ex * 0.5), (x + ex * 1.8, y + h * 1.2, z + ez * 1.8)], [(0, 1, 2)],
                           lambda v, y0=y, tc=tipc: mix((0.30, 0.42, 0.15), tc, ss(y0, y0 + h * 1.2, v[1]) * 0.9))
    print("flora tris", bt.tris())
    return make_obj("Valley_Wildflowers", bt.v, bt.f, bt.c, mat)

# ---------------- stream water ribbon ----------------
def build_water(mat):
    pts = []
    for (ax, az), (bx, bz) in zip(STREAM, STREAM[1:]):
        for k in range(8):
            t = k / 8; pts.append((ax + (bx - ax) * t, az + (bz - az) * t))
    pts.append(STREAM[-1])
    verts, faces, cols = [], [], []
    for i, (x, z) in enumerate(pts):
        j = min(i + 1, len(pts) - 1); k = max(i - 1, 0)
        tx, tz = pts[j][0] - pts[k][0], pts[j][1] - pts[k][1]; l = math.hypot(tx, tz) or 1
        nx, nz = -tz / l, tx / l; w = 1.6 + 0.5 * n2(x, z, 9)
        y = max(height(x + nx * w, z + nz * w), height(x - nx * w, z - nz * w), height(x, z)) + 0.12
        d = rect_d(x, z)
        c = mix(mix((0.55, 0.70, 0.80), (0.82, 0.90, 0.94), 0.5 + 0.5 * n2(x, z, 5)), HAZE, ss(80, 160, d) * 0.5)
        verts += [(x + nx * w, y, z + nz * w), (x - nx * w, y, z - nz * w)]; cols += [c, c]
        if i: o = 2 * i; faces.append((o - 2, o - 1, o + 1, o))
    return make_obj("Valley_Stream", verts, faces, cols, mat, smooth=True)

# ---------------- meadow_edge prop ----------------
def build_edge_prop(mat):
    bt = Batch(); rnd = random.Random(11)
    for _ in range(46):
        x, z = rnd.uniform(-0.62, 0.62), rnd.uniform(-0.3, 0.3); h = rnd.uniform(0.22, 0.6); rr = rnd.random() * 6
        ex, ez = math.cos(rr), math.sin(rr); w = 0.03
        lean = rnd.uniform(-0.07, 0.07)
        tip = (clamp(x + ex * 0.08 + lean, -0.69, 0.69), h, clamp(z + ez * 0.08, -0.37, 0.37))
        bt.add([(x - ez * w, 0, z + ex * w), (x + ez * w, 0, z - ex * w), tip], [(0, 1, 2)],
               lambda v, hh=h: mix((0.24, 0.36, 0.12), (0.62, 0.62, 0.30), v[1] / 0.65))
    for _ in range(9):
        x, z = rnd.uniform(-0.55, 0.55), rnd.uniform(-0.25, 0.25); h = rnd.uniform(0.35, 0.6); col = rnd.choice(FLOWER_COLS); w = 0.06
        bt.add([(x - 0.008, 0, z), (x + 0.008, 0, z), (x, h, z)], [(0, 1, 2)], (0.28, 0.40, 0.15))
        bt.add([(x - w, h, z), (x, h + 0.025, z - w), (x + w, h, z), (x, h + 0.025, z + w)], [(0, 1, 2, 3)], col)
    return make_obj("MeadowEdge", bt.v, bt.f, bt.c, mat)

# ======================================================
bpy.ops.wm.read_factory_settings(use_empty=True)
mT = make_mat("M_Terrain", 0.92); mR = make_mat("M_Rock", 0.85); mP = make_mat("M_Foliage", 0.8)
mW_ = None
mF = make_mat("M_Wildflower", 0.75, double=True); mW = make_mat("M_Stream", 0.12, double=True)
terrain = build_terrain(mT)
trees, placed = build_trees(mP)
rocks = build_rocks(mR, placed)
flora = build_flora(mF)
water = build_water(mW)
valley = [terrain, trees, rocks, flora, water]

# ---- validation ----
tot = 0
for o in valley:
    t = sum(len(p.vertices) - 2 for p in o.data.polygons); tot += t; print(o.name, t)
print("TOTAL TRIS", tot)
mx = -99
for v in terrain.data.vertices:
    x, y, z = v.co.x, v.co.z, -v.co.y
    if -16 <= x <= 36 and -16 <= z <= 16: mx = max(mx, y)
print("max terrain y in staging box", round(mx, 3))
for o in (trees, rocks):
    bad = 0
    for v in o.data.vertices:
        x, y, z = v.co.x, v.co.z, -v.co.y
        if y > 0 and RX0 - 3 < x < RX1 + 3 and RZ0 - 3 < z < RZ1 + 3: bad += 1
    print(o.name, "verts above 0 inside rect+3:", bad)

bpy.ops.object.select_all(action='DESELECT')
for o in valley: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "forge_valley.glb"), export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
print("EXPORTED forge_valley.glb")

edge = build_edge_prop(mF); edge.location = (0, 0, 0)
bpy.ops.object.select_all(action='DESELECT'); edge.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "meadow_edge.glb"), export_format='GLB', use_selection=True, export_yup=True)
bpy.data.objects.remove(edge)
print("EXPORTED meadow_edge.glb")

if "--no-render" in sys.argv: sys.exit(0)
# ---------------- preview renders (context proxies are NOT exported) ----------------
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except Exception: pass
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
try: sc.eevee.taa_render_samples = 16
except Exception: pass
sc.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("Sky"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.42, 0.58, 0.82, 1); bg.inputs[1].default_value = 0.9
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 4.0; sun.data.color = (1.0, 0.93, 0.80); sun.rotation_euler = (math.radians(50), 0, math.radians(35))
proxy = make_mat("M_Proxy", 0.9)
def box(x0, x1, y0, y1, z0, z1, c):
    vs = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return make_obj("proxy", vs, fs, [c] * 8, proxy)
box(-15, 35, -0.05, 0, -15, 15, (0.52, 0.47, 0.36))                      # yard
box(-3, 3, 0, 3.5, -6, -2, (0.35, 0.22, 0.15))                            # smithy stand-in
for i in range(5):                                                         # portal fan stand-ins
    a = math.radians(-50 + 25 * i); px, pz = 10 * math.sin(a), 7 + 5 * math.cos(a) * 1.2
    box(px - 0.9, px + 0.9, 0, 3.0, pz - 0.15, pz + 0.15, (0.75, 0.55, 0.25))
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_end = 1000
def shoot(pos, tgt, lens, name):
    p, t = Vector(B(*pos)), Vector(B(*tgt)); cam.location = p
    cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = lens
    sc.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True); print("rendered", name)
shoot((-55, 38, -62), (12, 4, 10), 24, "preview_oblique.png")
shoot((0, 1.7, 2), (0, 2.6, 40), 18, "preview_gates_+Z.png")
shoot((10, 70, -150), (10, 0, 20), 30, "preview_high_south.png")
