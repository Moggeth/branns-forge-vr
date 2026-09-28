"""Deterministic builder for the Brann's Forge woodland environment kit.

Run (from this directory):
  python ../../../scripts/rebuild_woodland_kit.py

Outputs: source/woodland_kit.blend, glb/*.glb, textures/*.png, manifest.json.
Blender is Z-up; every asset sits on z=0 with its origin at the ground contact
centre and its authored "front" facing Blender -Y (glTF/Godot +Z, MODEL_FRONT).
"""
import bpy, bmesh, json, math, os, random, hashlib
import numpy as np
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(HERE, "glb")
OUT_TEX = os.path.join(HERE, "textures")
OUT_SRC = os.path.join(HERE, "source")
for d in (OUT_GLB, OUT_TEX, OUT_SRC):
    os.makedirs(d, exist_ok=True)

# ---------------------------------------------------------------- palette ---
def hexrgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

# name: (dark sRGB, light sRGB, roughness). Each swatch is a horizontal ramp.
SWATCHES = [
    ("fern",        "#2F5A27", "#8DBB52", 0.70),
    ("grass",       "#3B6528", "#AAC962", 0.75),
    ("bracken",     "#4A7630", "#B8C35A", 0.70),
    ("stem",        "#4A4520", "#86803E", 0.80),
    ("petal_cream", "#D9CCA2", "#FFF7E0", 0.55),
    ("petal_lilac", "#5E4B98", "#B9A6E4", 0.55),
    ("flower_eye",  "#B7862A", "#F2CC55", 0.60),
    ("bark",        "#3A271A", "#7C5436", 0.90),
    ("wood_end",    "#9E7245", "#DDB67E", 0.85),
    ("rock_dry",    "#6C6A5C", "#ABA893", 0.92),
    ("rock_wet",    "#353C37", "#5A625A", 0.30),
    ("moss",        "#2F5522", "#6E9A3C", 0.80),
    ("leaf_ochre",  "#94601F", "#DCA846", 0.62),
    ("leaf_rust",   "#72321D", "#C26433", 0.62),
    ("leaf_olive",  "#5E6028", "#A8A652", 0.68),
    ("fungus",      "#A88C62", "#EEDAB0", 0.55),
]
SW = {n: i for i, (n, *_r) in enumerate(SWATCHES)}
GRID, CELL = 4, 64
TEX = GRID * CELL
RAMP_IN = 0.14  # inset of the ramp inside each cell (texel bleed guard)


def swatch_uv(sw, g):
    g = min(1.0, max(0.0, g))
    i = SW[sw]
    col, row = i % GRID, i // GRID
    u = (col + RAMP_IN + (1 - 2 * RAMP_IN) * g) / GRID
    v = (row + 0.5) / GRID
    return (u, v)


def make_palette_images():
    base = np.zeros((TEX, TEX, 4), np.float32)
    orm = np.zeros((TEX, TEX, 4), np.float32)
    for i, (name, dk, lt, rough) in enumerate(SWATCHES):
        col, row = i % GRID, i // GRID
        a, b = np.array(hexrgb(dk)), np.array(hexrgb(lt))
        for x in range(CELL):
            t = (x / (CELL - 1) - RAMP_IN) / (1 - 2 * RAMP_IN)
            t = min(1.0, max(0.0, t))
            c = a + (b - a) * t
            base[row * CELL:(row + 1) * CELL, col * CELL + x, :3] = c
            # wet swatch gets glossier towards its dark end (puddle line)
            r = rough - (0.12 * (1 - t) if name == "rock_wet" else 0.0)
            orm[row * CELL:(row + 1) * CELL, col * CELL + x, :3] = (1.0, r, 0.0)
    base[..., 3] = 1
    orm[..., 3] = 1
    imgs = {}
    for key, arr, cs in (("kit_palette_albedo", base, "sRGB"), ("kit_palette_orm", orm, "Non-Color")):
        img = bpy.data.images.new(key, TEX, TEX, alpha=False)
        img.colorspace_settings.name = cs
        img.pixels.foreach_set(arr.ravel())
        path = os.path.join(OUT_TEX, key + ".png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.pack()
        imgs[key] = img
    return imgs


def make_material(name, imgs, double_sided):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t1 = nt.nodes.new("ShaderNodeTexImage"); t1.image = imgs["kit_palette_albedo"]; t1.interpolation = "Closest"
    t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = imgs["kit_palette_orm"]; t2.interpolation = "Closest"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t1.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t2.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    t1.location, t2.location, sep.location = (-500, 250), (-500, -100), (-220, -100)
    return m

# ------------------------------------------------------------ mesh builder --
class MB:
    """Collects unshared flat faces with palette UVs."""

    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def face(self, pts, sw, g, hint=None, up=False):
        pts = [Vector(p) for p in pts]
        gs = g if isinstance(g, (list, tuple)) else [g] * len(pts)
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        flip = False
        if hint is not None:
            c = sum(pts, Vector()) / len(pts)
            flip = n.dot(c - Vector(hint)) < 0
        elif up:
            flip = n.z < 0
        if flip:
            pts, gs = pts[::-1], gs[::-1]
        base = len(self.v)
        self.v.extend(pts)
        self.f.append(list(range(base, base + len(pts))))
        self.uv.extend(swatch_uv(sw, x) for x in gs)

    def tri(self, a, b, c, sw, g, **k):
        self.face([a, b, c], sw, g, **k)

    def quad2(self, a, b, c, d, sw, g, **k):
        """Quad emitted as two triangles (stable export, no ngon ambiguity)."""
        ga = g if isinstance(g, (list, tuple)) else [g] * 4
        self.face([a, b, c], sw, [ga[0], ga[1], ga[2]], **k)
        self.face([a, c, d], sw, [ga[0], ga[2], ga[3]], **k)

    def to_object(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        for i, uv in enumerate(self.uv):
            uvl.data[i].uv = uv
        for p in me.polygons:
            p.use_smooth = False
        me.materials.append(mat)
        me.validate()
        ob = bpy.data.objects.new(name, me)
        return ob


def frame(t):
    t = t.normalized()
    s = t.cross(Vector((0, 0, 1)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    n = s.cross(t).normalized()
    return t, s, n


def tube(mb, path, radii, sides, sw, g_along=(0.2, 0.8), cap_sw=None, rot=0.0, jitter=0.0, rng=None, moss=None):
    """Faceted tapered tube along a polyline. moss(center, normal)->bool recolours facets."""
    rings = []
    prev_s = None
    for i, p in enumerate(path):
        tan = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
        t, s, n = frame(tan)
        if prev_s is not None and s.dot(prev_s) < 0:
            s, n = -s, -n
        prev_s = s
        ring = []
        for k in range(sides):
            a = rot + 2 * math.pi * k / sides
            r = radii[i] * (1 + (rng.uniform(-jitter, jitter) if rng else 0))
            ring.append(p + (s * math.cos(a) + n * math.sin(a)) * r)
        rings.append(ring)
    L = len(path)
    for i in range(L - 1):
        g0 = g_along[0] + (g_along[1] - g_along[0]) * i / (L - 1)
        g1 = g_along[0] + (g_along[1] - g_along[0]) * (i + 1) / (L - 1)
        cen = (path[i] + path[i + 1]) / 2
        for k in range(sides):
            a, b = rings[i][k], rings[i][(k + 1) % sides]
            c, d = rings[i + 1][(k + 1) % sides], rings[i + 1][k]
            fc = (a + b + c + d) / 4
            nrm = (fc - cen).normalized()
            use = sw
            gg = [g0, g0, g1, g1]
            # light from above: upward facets a touch lighter
            lift = 0.15 * nrm.z
            gg = [x + lift for x in gg]
            if moss and moss(fc, nrm):
                use, gg = "moss", [0.3 + 0.45 * nrm.z] * 4
            mb.quad2(a, b, c, d, use, gg, hint=cen)
    if cap_sw:
        for idx, inward in ((0, path[1]), (L - 1, path[L - 2])):
            ring, c = rings[idx], path[idx]
            if radii[idx] < 0.004:
                continue
            for k in range(sides):
                mb.tri(c, ring[k], ring[(k + 1) % sides], cap_sw, 0.7 if k % 2 else 0.5, hint=inward)
    return rings


def ico(radius, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    return bm


def bm_to_mb(mb, bm, xf, colour_fn):
    """Transform a closed bmesh into the builder; colour_fn(center, normal)->(sw,g)."""
    bm.verts.ensure_lookup_table()
    for f in bm.faces:
        pts = [xf @ v.co for v in f.verts]
        c = sum(pts, Vector()) / len(pts)
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0]).normalized()
        sw, g = colour_fn(c, n, pts)
        # winding already consistent in bmesh; keep it
        base = len(mb.v)
        mb.v.extend(pts)
        mb.f.append(list(range(base, base + len(pts))))
        gs = g if isinstance(g, list) else [g] * len(pts)
        mb.uv.extend(swatch_uv(sw, x) for x in gs)

# ------------------------------------------------------------- vegetation ---
def spine(base, az, length, elev0, droop, steps, curl=0.0):
    pts, tans = [Vector(base)], []
    p = Vector(base)
    for i in range(steps):
        s = (i + 0.5) / steps
        e = math.radians(elev0 - droop * s ** 1.6)
        a = az + curl * s
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
        p = p + d * (length / steps)
        pts.append(p.copy())
    return pts


def sample(pts, s):
    f = s * (len(pts) - 1)
    i = min(int(f), len(pts) - 2)
    t = f - i
    p = pts[i].lerp(pts[i + 1], t)
    return p, (pts[i + 1] - pts[i]).normalized()


def stem_ribbon(mb, pts, w0, w1, sw="stem", g=(0.2, 0.7)):
    n = len(pts)
    for i in range(n - 1):
        t, s, _ = frame(pts[i + 1] - pts[i])
        wa = w0 + (w1 - w0) * i / (n - 1)
        wb = w0 + (w1 - w0) * (i + 1) / (n - 1)
        ga = g[0] + (g[1] - g[0]) * i / (n - 1)
        gb = g[0] + (g[1] - g[0]) * (i + 1) / (n - 1)
        # two crossed ribbons -> reads as a stalk from any angle
        _, s2, n2 = frame(pts[i + 1] - pts[i])
        for side in (s2, n2):
            mb.quad2(pts[i] - side * wa, pts[i] + side * wa, pts[i + 1] + side * wb, pts[i + 1] - side * wb, sw, [ga, ga, gb, gb])


def leaflet(mb, root, D, N, length, width, sw, g0, g1, lobes=0, fold=0.3):
    """Folded lanceolate pinna. lobes>0 gives a serrated (bipinnate-looking) outline."""
    W = N.cross(D).normalized()
    tip = root + D * length
    if lobes == 0:
        mid = root + D * (length * 0.42)
        l = mid + W * width * 0.5 - N * width * fold
        r = mid - W * width * 0.5 - N * width * fold
        mb.tri(root, l, tip, sw, [g0, (g0 + g1) / 2, g1], up=True)
        mb.tri(root, tip, r, sw, [g0, g1, (g0 + g1) / 2], up=True)
        return
    vein = [root + D * (length * k / lobes) for k in range(lobes + 1)]
    for k in range(lobes):
        a, b = vein[k], vein[k + 1]
        t = (k + 0.6) / lobes
        wk = width * 0.5 * (1.0 - 0.75 * t) * (1.25 if k == 0 else 1.0)
        tipk = a + D * (length / lobes * 1.15)
        g = g0 + (g1 - g0) * t
        for sgn in (1, -1):
            lob = a.lerp(tipk, 0.55) + W * wk * sgn - N * wk * fold
            mb.tri(a, lob, b, sw, [g - 0.05, g + 0.08, g], up=True)


def frond(mb, base, az, length, elev0, droop, pairs, pinna_len, sw, rng, g_base=0.15, g_tip=0.95,
          lobes=0, profile="lance", sweep0=48.0, stalk=0.12, stem_w=0.006, curl=0.0):
    pts = spine(base, az, length, elev0, droop, 10, curl=curl)
    stem_ribbon(mb, pts, stem_w, stem_w * 0.3, "stem")
    for i in range(pairs):
        s = stalk + (1 - stalk) * (i + 0.5) / pairs
        p, T = sample(pts, s)
        _, S, N = frame(T)
        if profile == "lance":
            prof = math.sin(math.pi * min(1.0, (s - stalk) / (1 - stalk)) ** 0.75) ** 0.7
        else:  # deltoid: broadest at base
            q = (s - stalk) / (1 - stalk)
            prof = (1 - q) ** 0.9 * min(1.0, q * 8 + 0.35)
        L = pinna_len * max(0.12, prof) * rng.uniform(0.9, 1.08)
        sweep = math.radians(sweep0 + 22 * s)
        for sgn in (1, -1):
            D = (S * sgn * math.cos(sweep) + T * math.sin(sweep) - N * 0.12).normalized()
            g0 = g_base + (g_tip - g_base) * s - 0.1
            leaflet(mb, p, D, N, L, L * (0.32 if lobes == 0 else 0.55), sw, g0, g0 + 0.25, lobes=lobes)


def fiddlehead(mb, base, az, height, rng):
    """Young coiled crosier: upright stalk ending in a spiral knob."""
    pts = [Vector(base)]
    p = Vector(base)
    d = Vector((math.cos(az), math.sin(az), 0))
    for i in range(6):
        p = p + Vector((0, 0, height / 6)) + d * 0.004 * i
        pts.append(p.copy())
    # spiral curling forward and down
    c = p + d * 0.022
    for k in range(1, 9):
        a = math.pi * 0.5 - k * 0.8
        r = 0.022 * (1 - k / 11)
        pts.append(c + d * (-math.sin(a) * r * -1) * 1.0 + Vector((0, 0, math.sin(a + math.pi / 2) * r)) * 1.0
                   + d * (math.cos(a) * r - r))
    radii = [0.006] * 7 + [0.009 * (1 - k / 10) for k in range(1, 9)]
    tube(mb, pts, radii, 5, "fern", g_along=(0.35, 0.95), rng=rng)


def build_fern_sword(rng):
    mb = MB()
    n = 9
    for i in range(n):
        az = 2 * math.pi * i / n + rng.uniform(-0.25, 0.25)
        length = rng.uniform(0.78, 1.0)
        frond(mb, (math.cos(az) * 0.03, math.sin(az) * 0.03, 0.0), az, length, rng.uniform(68, 78),
              rng.uniform(95, 120), 15, 0.105, "fern", rng, curl=rng.uniform(-0.25, 0.25))
    for k in range(2):
        a = rng.uniform(0, 2 * math.pi)
        fiddlehead(mb, (math.cos(a) * 0.015, math.sin(a) * 0.015, 0), a, rng.uniform(0.16, 0.22), rng)
    return mb


def build_fern_lady(rng):
    mb = MB()
    n = 7
    for i in range(n):
        az = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
        frond(mb, (math.cos(az) * 0.025, math.sin(az) * 0.025, 0.0), az, rng.uniform(0.62, 0.74),
              rng.uniform(78, 84), rng.uniform(55, 75), 12, 0.13, "fern", rng, g_base=0.3, g_tip=1.0,
              lobes=3, sweep0=40, stalk=0.1, curl=rng.uniform(-0.2, 0.2))
    return mb


def build_bracken(rng):
    mb = MB()
    for k in range(3):
        az = 2 * math.pi * k / 3 + rng.uniform(-0.4, 0.4)
        bx, by = math.cos(az) * 0.09 * (k > 0), math.sin(az) * 0.09 * (k > 0)
        h = rng.uniform(0.26, 0.42)
        stalk = [Vector((bx, by, 0)), Vector((bx + 0.01 * math.cos(az), by + 0.01 * math.sin(az), h * 0.55)),
                 Vector((bx + 0.03 * math.cos(az), by + 0.03 * math.sin(az), h))]
        tube(mb, stalk, [0.007, 0.006, 0.005], 4, "stem", g_along=(0.2, 0.6), rng=rng)
        top = stalk[-1]
        frond(mb, top, az + math.pi * 0.15, rng.uniform(0.58, 0.7), 22, 40, 11, 0.27, "bracken", rng,
              g_base=0.2, g_tip=0.9, lobes=4, profile="deltoid", sweep0=58, stalk=0.02, stem_w=0.005)
    return mb


def build_grass(rng):
    mb = MB()
    n = 18
    for i in range(n):
        az = rng.uniform(0, 2 * math.pi)
        r0 = rng.uniform(0.0, 0.06)
        base = Vector((math.cos(az) * r0, math.sin(az) * r0, 0))
        h = rng.uniform(0.22, 0.46) * (1.15 if r0 < 0.03 else 1.0)
        lean = rng.uniform(15, 40) + r0 * 300
        pts = spine(base, az + rng.uniform(-0.4, 0.4), h, 90 - lean * 0.3, lean * 1.5, 4)
        w = rng.uniform(0.009, 0.014)
        for j in range(4):
            a, b = pts[j], pts[j + 1]
            _, S, N = frame(b - a)
            wa, wb = w * (1 - j / 4.3), w * (1 - (j + 1) / 4.3)
            ga, gb = 0.05 + 0.9 * j / 4, 0.05 + 0.9 * (j + 1) / 4
            crease = N * 0.25
            if j < 3:
                mb.quad2(a - S * wa - crease * wa, a, b, b - S * wb - crease * wb, "grass", [ga, ga, gb, gb], up=True)
                mb.quad2(a, a + S * wa - crease * wa, b + S * wb - crease * wb, b, "grass", [ga, ga, gb, gb], up=True)
            else:
                mb.tri(a - S * wa, a + S * wa, b, "grass", [ga, ga, 1.0], up=True)
    return mb


def daisy(mb, c, facing, rng, r=0.028):
    _, S, N = frame(facing)
    T = facing.normalized()
    k = 7
    for i in range(k):
        a = 2 * math.pi * i / k + rng.uniform(-0.1, 0.1)
        d = (S * math.cos(a) + N * math.sin(a))
        e = (S * math.cos(a + 1.5708) + N * math.sin(a + 1.5708))
        tip = c + d * r - T * 0.004
        mid = c + d * r * 0.5
        mb.tri(c, mid + e * r * 0.2 + T * 0.003, tip, "petal_cream", [0.35, 0.8, 1.0], hint=c - T)
        mb.tri(c, tip, mid - e * r * 0.2 + T * 0.003, "petal_cream", [0.35, 1.0, 0.8], hint=c - T)
    tube(mb, [c - T * 0.002, c + T * 0.008], [r * 0.3, r * 0.18], 5, "flower_eye", g_along=(0.4, 1.0), cap_sw="flower_eye")


def bell(mb, c, rng, r=0.013):
    """Nodding lilac bell: 5-sided flared cone opening downward."""
    top = c + Vector((0, 0, 0.004))
    rim = []
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        rim.append(c + Vector((math.cos(a) * r, math.sin(a) * r, -r * 1.6)))
    for i in range(5):
        mid = (rim[i] + rim[(i + 1) % 5]) / 2
        flare = mid + (mid - c).normalized() * r * 0.35 * Vector((1, 1, 0)).length - Vector((0, 0, r * 0.2))
        mb.tri(top, rim[i], rim[(i + 1) % 5], "petal_lilac", [0.9, 0.35, 0.35])
        mb.tri(rim[i], flare, rim[(i + 1) % 5], "petal_lilac", [0.3, 0.6, 0.3])


def build_flowers(rng):
    mb = MB()
    # strap leaves at the base
    for i in range(9):
        az = rng.uniform(0, 2 * math.pi)
        pts = spine((0, 0, 0), az, rng.uniform(0.16, 0.24), 70, 80, 3)
        for j in range(3):
            a, b = pts[j], pts[j + 1]
            _, S, N = frame(b - a)
            w0, w1 = 0.012 * (1 - j / 3.2), 0.012 * (1 - (j + 1) / 3.2)
            if j < 2:
                mb.quad2(a - S * w0, a + S * w0, b + S * w1, b - S * w1, "grass", [0.1 + j * 0.3] * 2 + [0.4 + j * 0.3] * 2, up=True)
            else:
                mb.tri(a - S * w0, a + S * w0, b, "grass", [0.7, 0.7, 0.95], up=True)
    # daisies on wiry stems
    for i in range(5):
        az = 2 * math.pi * i / 5 + rng.uniform(-0.3, 0.3)
        h = rng.uniform(0.2, 0.34)
        pts = spine((math.cos(az) * 0.02, math.sin(az) * 0.02, 0), az, h, 84, 18, 4)
        tube(mb, pts, [0.0035] * 5, 3, "stem", g_along=(0.2, 0.8), rng=rng)
        _, T = sample(pts, 1.0)
        face = (T + Vector((0, 0, 1.2))).normalized()
        daisy(mb, pts[-1], face, rng)
    # lilac bell spikes (distinct nodding silhouette)
    for i in range(3):
        az = 2 * math.pi * (i + 0.5) / 3 + rng.uniform(-0.3, 0.3)
        h = rng.uniform(0.26, 0.36)
        pts = spine((math.cos(az) * 0.035, math.sin(az) * 0.035, 0), az, h, 86, 60, 5)
        tube(mb, pts, [0.003] * 6, 3, "stem", g_along=(0.2, 0.8), rng=rng)
        for j, s in enumerate((0.62, 0.74, 0.85, 0.95)):
            p, T = sample(pts, s)
            _, S, _ = frame(T)
            side = S * (0.014 if j % 2 else -0.014)
            bell(mb, p + side - Vector((0, 0, 0.006)), rng, r=0.011 + 0.002 * (j < 2))
    return mb

# ------------------------------------------------------------------ wood ---
def build_branch(rng):
    mb = MB()
    L = 1.7
    pts, radii = [], []
    for i in range(9):
        s = i / 8
        r = 0.085 * (1 - 0.55 * s)
        pts.append(Vector((-L / 2 + L * s, 0.07 * math.sin(s * 2.6) - 0.03, r + 0.01 * math.sin(s * 5))))
        radii.append(r)

    def moss_top(c, n):
        return n.z > 0.55 and noise.noise(c * 6.0 + Vector((3.1, 7.7, 1.3))) > 0.1

    tube(mb, pts, radii, 7, "bark", g_along=(0.3, 0.7), rng=rng, jitter=0.08, moss=moss_top, rot=0.2)
    # jagged broken end at the thin tip, clean-ish sawn look at the root end
    for idx, sgn in ((0, -1), (8, 1)):
        c, r = pts[idx], radii[idx]
        tip = c + Vector((sgn * r * (1.4 if idx == 8 else 0.4), 0, 0))
        _, S, N = frame(Vector((1, 0, 0)))
        ring = [c + (S * math.cos(2 * math.pi * k / 7 + 0.2) + N * math.sin(2 * math.pi * k / 7 + 0.2)) * r for k in range(7)]
        for k in range(7):
            spike = c.lerp(tip, rng.uniform(0.2, 1.0)) if idx == 8 else tip
            mb.tri(spike, ring[k], ring[(k + 1) % 7], "wood_end", 0.4 + 0.5 * (k % 2), hint=c - Vector((sgn, 0, 0)))
    # side branches: forked twigs lifting off the ground
    for s, az, up, ln in ((0.3, 1.1, 30, 0.55), (0.55, -1.3, 22, 0.45), (0.78, 0.9, 40, 0.35)):
        p, T = sample(pts, s)
        d = Vector((math.cos(az) * 0.7 + 0.4, math.sin(az), 0)).normalized()
        tw = spine(p, math.atan2(d.y, d.x), ln, up, up + 15, 4)
        rr = [0.03 * (1 - k / 5) for k in range(5)]
        tube(mb, tw, rr, 5, "bark", g_along=(0.45, 0.8), rng=rng, cap_sw="wood_end")
        fork = spine(tw[2], math.atan2(d.y, d.x) + 0.7, ln * 0.4, up + 25, 20, 3)
        tube(mb, fork, [0.012, 0.009, 0.006, 0.004], 4, "bark", g_along=(0.5, 0.8), rng=rng, cap_sw="wood_end")
    # moss cushions and shelf fungi (near-eye detail)
    for s in (0.12, 0.4, 0.62):
        p, _ = sample(pts, s)
        r = 0.085 * (1 - 0.55 * s)
        bm = ico(1.0, 1)
        xf = Matrix.Translation(p + Vector((0, 0, r * 0.8))) @ Matrix.Diagonal((r * 1.3, r * 0.9, r * 0.45, 1))
        bm_to_mb(mb, bm, xf, lambda c, n, _p: ("moss", 0.35 + 0.55 * max(0, n.z)))
        bm.free()
    for s, side in ((0.22, -1), (0.28, -1), (0.47, 1)):
        p, _ = sample(pts, s)
        r = 0.085 * (1 - 0.55 * s)
        c = p + Vector((0, side * r * 0.95, rng.uniform(-0.01, 0.02)))
        k = 6
        pts_f = [c + Vector((math.cos(a) * 0.05, side * (0.035 + 0.02 * math.sin(a)), 0)) for a in
                 [math.pi * j / (k - 1) - math.pi / 2 * 0 for j in range(k)]]
        pts_f = [c + Vector((0.055 * math.cos(math.pi * j / (k - 1)), side * 0.045 * math.sin(math.pi * j / (k - 1)), 0)) for j in range(k)]
        topc = c + Vector((0, 0, 0.012))
        for j in range(k - 1):
            mb.tri(topc, pts_f[j], pts_f[j + 1], "fungus", [0.9, 0.55, 0.55], up=True)
            mb.quad2(pts_f[j], pts_f[j + 1], pts_f[j + 1] - Vector((0, 0, 0.012)), pts_f[j] - Vector((0, 0, 0.012)), "fungus", 0.15, hint=c)
    return mb

# ----------------------------------------------------------------- rocks ---
def rock_colour(seed, h_total):
    off = Vector((seed * 1.7, seed * 3.1, seed * 0.7))

    def fn(c, n, pts):
        mossy = n.z > 0.62 and noise.noise(c * 3.5 + off) > -0.05
        if mossy:
            return "moss", 0.25 + 0.55 * n.z
        if c.z < h_total * 0.18 or (n.z < -0.1):
            return "rock_wet", 0.25 + 0.5 * c.z / max(0.01, h_total * 0.18)
        # damp streak: north (+Y) side darker/glossier in a noise band
        if n.y > 0.4 and noise.noise(c * 5 + off) > 0.25:
            return "rock_wet", 0.8
        return "rock_dry", 0.25 + 0.55 * min(1, c.z / h_total) + 0.2 * max(0, n.z)
    return fn


def build_boulder(rng):
    mb = MB()
    bm = ico(1.0, 2)
    off = Vector((11.3, 2.2, 5.9))
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + 0.18 * noise.noise(d * 1.6 + off) + 0.07 * noise.noise(d * 4.0 + off)
        v.co = Vector((d.x * 0.62, d.y * 0.5, d.z * 0.46)) * k
        if v.co.z < -0.12:
            v.co.z = -0.12 + (v.co.z + 0.12) * 0.15
    bmesh.ops.dissolve_degenerate(bm, dist=0.002, edges=bm.edges)
    zmin = min(v.co.z for v in bm.verts)
    zmax = max(v.co.z for v in bm.verts)
    xf = Matrix.Translation((0, 0, -zmin))
    bm_to_mb(mb, bm, xf, rock_colour(1, zmax - zmin))
    bm.free()
    # moss cushions lodged on top
    for (x, y, sx) in ((-0.12, 0.05, 0.17), (0.16, -0.08, 0.12), (0.02, 0.18, 0.1)):
        top = max(v.z for v in sorted(mb.v, key=lambda v: (v.x - x) ** 2 + (v.y - y) ** 2)[:12])
        b2 = ico(1.0, 1)
        xf2 = Matrix.Translation((x, y, top - 0.015)) @ Matrix.Diagonal((sx, sx * 0.8, 0.045, 1))
        bm_to_mb(mb, b2, xf2, lambda c, n, _p: ("moss", 0.3 + 0.65 * max(0, n.z)))
        b2.free()
    return mb


def prism(mb, outline, z0, h, inset, tilt, colour, seed):
    """Stratified stone plate: jittered polygon extruded with a tapered, slightly domed top."""
    n = len(outline)
    top = [Vector((p.x * (1 - inset), p.y * (1 - inset), z0 + h + tilt.dot(p))) for p in outline]
    bot = [Vector((p.x, p.y, z0)) for p in outline]
    cen_top = sum(top, Vector()) / n + Vector((0, 0, h * 0.18))
    cen = Vector((0, 0, z0 + h / 2))
    fn = colour
    for i in range(n):
        j = (i + 1) % n
        for tri in ((bot[i], bot[j], top[j]), (bot[i], top[j], top[i])):
            c = sum(tri, Vector()) / 3
            nn = (tri[1] - tri[0]).cross(tri[2] - tri[0]).normalized()
            if nn.dot(c - cen) < 0:
                nn = -nn
            sw, g = fn(c, nn, tri)
            mb.face(list(tri), sw, g, hint=cen)
        tri = (cen_top, top[i], top[j])
        c = sum(tri, Vector()) / 3
        nn = (tri[1] - tri[0]).cross(tri[2] - tri[0]).normalized()
        if nn.z < 0:
            nn = -nn
        sw, g = fn(c, nn, tri)
        mb.face(list(tri), sw, g, up=True)


def build_slab(rng):
    mb = MB()
    fn = rock_colour(2, 0.5)
    z = 0.0
    specs = [(0.78, 0.55, 0.16, 0.0), (0.6, 0.42, 0.14, 0.35), (0.38, 0.3, 0.12, -0.5)]
    for li, (rx, ry, h, rot) in enumerate(specs):
        n = 8
        outline = []
        for k in range(n):
            a = 2 * math.pi * k / n + rng.uniform(-0.18, 0.18)
            rr = rng.uniform(0.82, 1.08)
            p = Vector((math.cos(a) * rx * rr, math.sin(a) * ry * rr, 0))
            p.rotate(Matrix.Rotation(rot, 3, "Z"))
            outline.append(p + Vector((0.06 * li, -0.04 * li, 0)))
        tilt = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
        prism(mb, outline, z, h, 0.1, tilt, fn, li)
        z += h * 0.92
    # moss creeping along the ledges between strata
    for (x, y, sx, sz) in ((0.35, -0.3, 0.14, 0.13), (-0.42, 0.1, 0.12, 0.13), (-0.05, 0.3, 0.16, 0.27), (0.2, 0.05, 0.11, 0.39)):
        b2 = ico(1.0, 1)
        xf2 = Matrix.Translation((x, y, sz)) @ Matrix.Diagonal((sx, sx * 0.7, 0.04, 1))
        bm_to_mb(mb, b2, xf2, lambda c, n, _p: ("moss", 0.3 + 0.65 * max(0, n.z)))
        b2.free()
    return mb

# ---------------------------------------------------------------- litter ---
def build_litter(rng):
    mb = MB()
    leaves = ("leaf_ochre", "leaf_rust", "leaf_olive", "leaf_ochre")
    for i in range(52):
        r = 0.44 * math.sqrt(rng.random())
        a = rng.uniform(0, 2 * math.pi)
        c = Vector((math.cos(a) * r, math.sin(a) * r * 0.8, 0))
        yaw = rng.uniform(0, 2 * math.pi)
        D = Vector((math.cos(yaw), math.sin(yaw), 0))
        W = Vector((-D.y, D.x, 0))
        ln = rng.uniform(0.06, 0.1)
        wd = ln * rng.uniform(0.42, 0.55)
        z = 0.004 + 0.02 * rng.random() * (1 - r / 0.5)
        curl = rng.uniform(0.004, 0.018)
        sw = leaves[i % 4]
        base = c - D * ln * 0.5 + Vector((0, 0, z))
        v1 = base + D * ln * 0.45 + Vector((0, 0, 0.002))
        tip = base + D * ln + Vector((0, 0, curl))
        L1 = base + D * ln * 0.35 + W * wd * 0.5 + Vector((0, 0, curl * 0.5))
        R1 = base + D * ln * 0.35 - W * wd * 0.5 + Vector((0, 0, curl * 0.3))
        L2 = base + D * ln * 0.72 + W * wd * 0.32 + Vector((0, 0, curl * 0.9))
        R2 = base + D * ln * 0.72 - W * wd * 0.32 + Vector((0, 0, curl * 0.8))
        g = rng.uniform(0.25, 0.75)
        for tri, gg in (((base, L1, v1), [g - 0.2, g, g - 0.05]), ((v1, L1, L2), [g - 0.05, g, g + 0.15]),
                        ((v1, L2, tip), [g - 0.05, g + 0.15, g + 0.25]), ((base, v1, R1), [g - 0.2, g - 0.05, g - 0.1]),
                        ((v1, R2, R1), [g - 0.05, g, g - 0.1]), ((v1, tip, R2), [g - 0.05, g + 0.2, g])):
            mb.tri(*tri, sw, gg, up=True)
        # petiole
        stem_end = base - D * 0.018 + Vector((0, 0, 0.004))
        mb.tri(base + W * 0.0015, base - W * 0.0015, stem_end, "stem", 0.3, up=True)
    for i in range(4):
        a = rng.uniform(0, 2 * math.pi)
        c = Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.25, 0.25), 0.008))
        d = Vector((math.cos(a), math.sin(a), 0))
        ln = rng.uniform(0.18, 0.32)
        pts = [c + d * ln * (k / 3 - 0.5) + Vector((0, 0.01 * math.sin(k * 2.1), 0)) for k in range(4)]
        tube(mb, pts, [0.008, 0.007, 0.006, 0.004], 3, "bark", g_along=(0.4, 0.7), rng=rng, cap_sw="wood_end")
    for i in range(5):
        c = Vector((rng.uniform(-0.38, 0.38), rng.uniform(-0.3, 0.3), 0))
        s = rng.uniform(0.018, 0.035)
        b = ico(1.0, 1)
        xf = Matrix.Translation(c + Vector((0, 0, s * 0.45))) @ Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z") @ Matrix.Diagonal((s * 1.3, s, s * 0.6, 1))
        bm_to_mb(mb, b, xf, lambda cc, n, _p: ("rock_dry", 0.3 + 0.6 * max(0, n.z)))
        b.free()
    # a couple of acorn caps / seed husks for near-eye charm
    for i in range(3):
        c = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2), 0.0))
        b = ico(1.0, 1)
        xf = Matrix.Translation(c + Vector((0, 0, 0.009))) @ Matrix.Diagonal((0.012, 0.012, 0.009, 1))
        bm_to_mb(mb, b, xf, lambda cc, n, _p: ("wood_end", 0.3 + 0.6 * max(0, n.z)))
        b.free()
    return mb

# ------------------------------------------------------------------ main ---
ASSETS = [
    # id, builder, seed, double_sided, family, forward note
    ("fern_sword", build_fern_sword, 101, True, "fern", "radial rosette; no front"),
    ("fern_lady", build_fern_lady, 202, True, "fern", "radial vase; no front"),
    ("fern_bracken", build_bracken, 303, True, "fern", "tiered umbrella; primary blade leans +X/-Y"),
    ("grass_tuft", build_grass, 404, True, "grass_flower", "radial; no front"),
    ("flower_clump", build_flowers, 505, True, "grass_flower", "radial; no front"),
    ("branch_fallen_mossy", build_branch, 606, False, "wood", "long axis along X (Godot X); moss faces +Z-up"),
    ("rock_mossy_boulder", build_boulder, 707, False, "rock", "moss on top; damp streak on Blender +Y (Godot -Z) side"),
    ("rock_mossy_slab", build_slab, 808, False, "rock", "stepped strata; top tier offset toward +X/-Y (Godot +X/+Z)"),
    ("litter_leaf_cluster", build_litter, 909, True, "litter", "radial ground decal-mesh; no front"),
]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    imgs = make_palette_images()
    mat2 = make_material("kit_palette_2s", imgs, True)
    mat1 = make_material("kit_palette_1s", imgs, False)
    manifest = {"kit": "branns_forge_woodland_kit", "version": 1, "units": "metres",
                "up": "glTF/Godot +Y (Blender +Z)", "front": "glTF/Godot +Z = Vector3.MODEL_FRONT (Blender -Y)",
                "origin": "ground contact centre; min Y = 0",
                "materials": {"kit_palette_1s": "opaque, backface culled", "kit_palette_2s": "opaque, double-sided"},
                "palette": {"albedo": "textures/kit_palette_albedo.png", "orm": "textures/kit_palette_orm.png",
                            "size": TEX, "swatches": [dict(name=n, dark=d, light=l, roughness=r) for n, d, l, r in SWATCHES]},
                "assets": []}
    coll_x = 0.0
    for aid, fn, seed, ds, fam, fwd in ASSETS:
        rng = random.Random(seed)
        mb = fn(rng)
        # ground exactly at z=0 and origin at footprint centre
        zmin = min(p.z for p in mb.v)
        cx = (min(p.x for p in mb.v) + max(p.x for p in mb.v)) / 2 if aid.startswith(("branch", "litter", "rock")) else 0.0
        cy = (min(p.y for p in mb.v) + max(p.y for p in mb.v)) / 2 if aid.startswith(("branch", "litter", "rock")) else 0.0
        mb.v = [Vector((p.x - cx, p.y - cy, p.z - zmin)) for p in mb.v]
        ob = mb.to_object(aid, mat2 if ds else mat1)
        coll = bpy.data.collections.new(fam) if fam not in bpy.data.collections else bpy.data.collections[fam]
        if coll.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(coll)
        coll.objects.link(ob)
        # export this object alone, at the world origin
        for o in bpy.context.scene.objects:
            o.select_set(False)
        ob.location = (0, 0, 0)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        path = os.path.join(OUT_GLB, aid + ".glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                                  export_yup=True, export_image_format="AUTO", export_materials="EXPORT",
                                  export_texcoords=True, export_normals=True, export_extras=False)
        tris = sum(len(f) - 2 for f in mb.f)
        xs, ys, zs = [p.x for p in mb.v], [p.y for p in mb.v], [p.z for p in mb.v]
        with open(path, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        manifest["assets"].append({
            "id": aid, "family": fam, "file": f"glb/{aid}.glb", "seed": seed,
            "triangles": tris, "material_count": 1, "materials": [ob.data.materials[0].name],
            "double_sided": ds, "orientation": fwd,
            # Godot/glTF axes: X=Bx, Y=Bz, Z=-By
            "bounds_godot_m": {"min": [round(min(xs), 4), round(min(zs), 4), round(-max(ys), 4)],
                               "max": [round(max(xs), 4), round(max(zs), 4), round(-min(ys), 4)]},
            "size_m": [round(max(xs) - min(xs), 3), round(max(zs) - min(zs), 3), round(max(ys) - min(ys), 3)],
            "bytes": os.path.getsize(path), "sha256": sha,
        })
        # lay out in the source scene for browsing
        ob.location = (coll_x, 0, 0)
        coll_x += (max(xs) - min(xs)) + 0.5
        print(f"[kit] {aid}: {tris} tris")
    with open(os.path.join(HERE, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_SRC, "woodland_kit.blend"), compress=True)


main()
