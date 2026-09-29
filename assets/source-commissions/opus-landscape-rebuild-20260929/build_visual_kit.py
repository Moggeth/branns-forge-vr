"""Brann's Forge VR - Orchard visual kit builder (deterministic, Blender 4.5).

Run:
  blender --background --factory-startup --python build_visual_kit.py -- --out ABS_DIR [--no-render] [--samples N]
or  python build_visual_kit.py -- --out ABS_DIR      (re-launches itself inside Blender from ../../tools or PATH)

Produces: GLBs (one shared opaque vertex-colour material per family), source.blend,
review scene renders (ground_view.png, elevated_view.png, before_*.png), manifest.json.
All geometry is metres, +Y up in Godot (Blender Z-up is converted by the glTF exporter),
origin grounded at y=0 with a buried skirt so modules sit on 0-35 degree slopes.
"""
import json, math, os, subprocess, sys

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

def _arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default

try:
    import bpy, bmesh
    from mathutils import Vector, noise, Matrix
except ImportError:  # launched with plain python: find Blender and re-run
    here = os.path.dirname(os.path.abspath(__file__))
    cands = []
    d = here
    for _ in range(6):
        tools = os.path.join(d, "tools")
        if os.path.isdir(tools):
            for n in sorted(os.listdir(tools)):
                p = os.path.join(tools, n, "blender.exe")
                if n.startswith("blender-4") and os.path.exists(p): cands.append(p)
        d = os.path.dirname(d)
    import shutil
    exe = cands[0] if cands else shutil.which("blender")
    if not exe: sys.exit("Blender 4.5 not found in parent tools/ or PATH")
    sys.exit(subprocess.call([exe, "--background", "--factory-startup", "--python", os.path.abspath(__file__), "--"] + ARGS))

OUT = os.path.abspath(_arg("--out", os.path.dirname(os.path.abspath(__file__))))
RENDER = "--no-render" not in ARGS
SAMPLES = int(_arg("--samples", "48"))
os.makedirs(os.path.join(OUT, "glb"), exist_ok=True)
noise.seed_set(7331)

# ---------------------------------------------------------------- palette (linear-ish sRGB authored values)
PAL = {
    "grass_lush": (0.40, 0.58, 0.20), "grass_warm": (0.62, 0.64, 0.26), "grass_cool": (0.27, 0.45, 0.22),
    "meadow_dry": (0.66, 0.60, 0.33), "soil": (0.42, 0.29, 0.18), "soil_dark": (0.24, 0.16, 0.10),
    "bank_wet": (0.20, 0.17, 0.12), "gravel": (0.55, 0.50, 0.42), "bed": (0.30, 0.27, 0.20),
    "rock_cap": (0.74, 0.70, 0.62), "rock_mid": (0.58, 0.52, 0.47), "rock_warm": (0.62, 0.52, 0.42),
    "rock_dark": (0.33, 0.31, 0.33), "rock_band": (0.50, 0.46, 0.47), "moss": (0.34, 0.47, 0.16),
    "bark": (0.34, 0.22, 0.14), "leaf_a": (0.38, 0.58, 0.20), "leaf_b": (0.58, 0.70, 0.26),
    "leaf_c": (0.22, 0.40, 0.19), "reed": (0.50, 0.58, 0.26), "reed_tip": (0.72, 0.62, 0.34),
}

def srgb2lin(c): return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)
def mix(a, b, t): t = max(0.0, min(1.0, t)); return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
def smooth(e0, e1, x): t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
def n2(x, y, s=1.0): return noise.noise(Vector((x * s, y * s, 0.37)))  # ~[-1,1]
def fbm(x, y, s, o=4):
    v, a, f = 0.0, 0.5, s
    for _ in range(o): v += a * noise.noise(Vector((x * f, y * f, 1.7))); a *= 0.5; f *= 2.03
    return v

# ---------------------------------------------------------------- scene / materials
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def vc_material(name, rough=0.9, spec=0.3):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    col = nt.nodes.new("ShaderNodeVertexColor"); col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Specular IOR Level"].default_value = spec
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def water_material():
    m = vc_material("OrchardWater_Preview", 0.22, 0.45)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Specular IOR Level"].default_value = 0.6
    return m

def mesh_obj(name, bm, mat, coll=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob

def paint(bm, fn):
    """fn(face_center Vector, face_normal Vector, vert co) -> rgb; flat per-face colour for crisp stylisation."""
    lay = bm.loops.layers.color.get("Col") or bm.loops.layers.color.new("Col")
    for f in bm.faces:
        c = f.calc_center_median(); nrm = f.normal
        rgb = srgb2lin(fn(c, nrm))
        for l in f.loops: l[lay] = (*rgb, 1.0)

# ---------------------------------------------------------------- rock family: stratified cliff modules
def strata_colour(z, h, seed):
    # banded sedimentary layers, warm/cool alternation, lighter weathered cap
    band = math.sin(z * 2.35 + seed) + 0.45 * math.sin(z * 5.1 + seed * 2.0)
    # rev2: halved warm/cool contrast and thinner accent bands -> weathered stone, not sandstone brick
    base = mix(PAL["rock_mid"], PAL["rock_warm"], 0.35 + 0.18 * band)
    base = mix(base, PAL["rock_band"], smooth(0.75, 0.98, math.sin(z * 1.3 + seed * 0.7)) * 0.7)
    base = mix(base, PAL["rock_dark"], smooth(0.25, 0.0, z / max(h, 0.1)) * 0.65)  # damp dark foot
    return base

def build_cliff(name, width, height, depth, seed, mat):
    """Stack of 3-5 offset, bevelled, jittered slabs (ledge silhouettes), moss/soil cap faces."""
    bm = bmesh.new()
    z = -0.6  # buried skirt
    layer = 0
    rnd = lambda k: 0.5 + 0.5 * noise.noise(Vector((seed * 3.1, k * 1.7, 0.2)))
    while z < height - 0.2:
        th = 0.4 + 1.9 * rnd(layer) ** 1.6
        th = min(th, height - z)
        taper = 1.0 - 0.28 * (z / height)
        w = width * taper * (0.86 + 0.18 * rnd(layer + 11))
        d = depth * taper * (0.80 + 0.25 * rnd(layer + 23))
        ox = (rnd(layer + 5) - 0.5) * width * 0.12
        oy = (rnd(layer + 7) - 0.5) * depth * 0.10 + layer * depth * 0.07
        # rev2: each course is split into 1-3 jointed blocks of unequal width, each yawed/tilted a little,
        # so the face reads as fractured bedrock with vertical joints rather than a brick stack
        nblk = 1 + int(rnd(layer + 31) * 2.99)
        cuts = sorted([rnd(layer * 7 + k + 41) for k in range(nblk - 1)])
        edges = [-0.5] + [c - 0.5 for c in cuts] + [0.5]
        for b in range(nblk):
            x0, x1 = edges[b] * w, edges[b + 1] * w
            bw = max(x1 - x0 - 0.15, 0.6)
            bth = th * (0.8 + 0.45 * rnd(layer * 5 + b + 57))
            res = bmesh.ops.create_cube(bm, size=1.0)
            vs = res["verts"]
            bmesh.ops.scale(bm, vec=(bw, d * (0.85 + 0.25 * rnd(b + layer + 63)), bth), verts=vs)
            rot = Matrix.Rotation((rnd(layer + b + 71) - 0.5) * 0.35, 4, "Z") @ Matrix.Rotation((rnd(layer + b + 79) - 0.5) * 0.22, 4, "Y")
            bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=rot)
            bmesh.ops.translate(bm, vec=(ox + (x0 + x1) * 0.5, oy + (rnd(b + layer + 83) - 0.5) * depth * 0.18, z + bth * 0.5), verts=vs)
        z += th * (0.6 + 0.3 * rnd(layer + 91))
        layer += 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.12, segments=1, affect="EDGES", clamp_overlap=True)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=True)
    for v in bm.verts:
        c = v.co
        # chisel: low-frequency bulge + sharp fracture displacement, horizontal bias keeps ledges
        dsp = 0.55 * fbm(c.x + seed, c.z * 0.8 + c.y, 0.35, 3) + 0.22 * noise.noise(Vector((c.x * 1.8, c.y * 1.8, c.z * 0.6 + seed)))
        horiz = Vector((c.x, c.y * 1.4, 0)).normalized() if (c.x or c.y) else Vector()
        v.co += horiz * dsp
        v.co.z += 0.22 * noise.noise(Vector((c.x * 0.9, c.y * 0.9, seed)))
    # tilted strata: shear along X gives a geological dip; re-bury so the foot never floats
    for v in bm.verts: v.co.z += v.co.x * 0.14 + 0.25 * math.sin(v.co.y * 0.9 + seed)
    lo = min(v.co.z for v in bm.verts)
    for v in bm.verts: v.co.z -= lo + 0.6
    bmesh.ops.triangulate(bm, faces=bm.faces)  # stable export topology
    def col(c, nrm):
        if nrm.z > 0.72 and c.z > 0.25:  # ledge tops catch soil + moss
            return mix(PAL["moss"], PAL["grass_lush"], 0.5 + 0.5 * n2(c.x, c.y, 0.9))
        if nrm.z > 0.45: return mix(PAL["rock_cap"], PAL["moss"], 0.45)
        # rev2: bands warped + dipping, vertical weathering streaks, darker overhang undersides
        zw = c.z + 0.6 * n2(c.x, c.y, 0.25) + 0.12 * c.x
        b = strata_colour(zw, height, seed)
        streak = 0.5 + 0.5 * n2(c.x * 3.0, c.y * 3.0 + seed, 0.8)
        b = mix(b, PAL["rock_dark"], smooth(0.55, 0.9, streak) * 0.35 * smooth(height, 0.3 * height, c.z))
        b = mix(b, PAL["rock_dark"], smooth(-0.2, -0.7, nrm.z) * 0.5)
        return mix(b, PAL["rock_cap"], smooth(0.2, 0.7, nrm.z) * 0.6)
    paint(bm, col)
    return mesh_obj(name, bm, mat)

def build_boulder(name, radius, squash, seed, mat, moss=0.6):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    for v in bm.verts:
        c = v.co
        d = 0.22 * noise.noise(Vector((c.x * 1.1 / radius + seed, c.y * 1.1 / radius, c.z * 1.1 / radius)))
        v.co *= 1.0 + d
        v.co.z *= squash
        if v.co.z < 0: v.co.z *= 0.35  # flattened, buried base
        # planar facet cut: clamp one side to create fractured face
        if v.co.x > radius * 0.55: v.co.x = radius * 0.55 + (v.co.x - radius * 0.55) * 0.15
    bmesh.ops.translate(bm, vec=(0, 0, -radius * 0.12), verts=bm.verts)
    def col(c, nrm):
        top = smooth(0.35, 0.85, nrm.z) * moss
        base = mix(PAL["rock_mid"], PAL["rock_cap"], 0.5 + 0.5 * n2(c.x, c.z, 1.7))
        base = mix(base, PAL["rock_dark"], smooth(0.2, -0.1, c.z / radius) * 0.7)
        return mix(base, PAL["moss"], top)
    paint(bm, col)
    return mesh_obj(name, bm, mat)

def build_bank_stones(name, length, seed, mat):
    """Linear riverbank lip: gravel wedge + half-buried rounded stones, spans X [-L/2, L/2], water on -Y side."""
    bm = bmesh.new()
    # gravel wedge (sloped strip from bank top y=+1.2 to bed y=-1.6)
    segs = 8
    rows = [(1.4, 0.05), (0.2, 0.0), (-0.9, -0.35), (-1.8, -0.75)]
    grid = []
    for i in range(segs + 1):
        x = -length / 2 + length * i / segs
        row = []
        for (y, z) in rows:
            jitter = 0.18 * noise.noise(Vector((x * 0.7 + seed, y, 0.5)))
            row.append(bm.verts.new((x, y + jitter, z + jitter * 0.4)))
        grid.append(row)
    for i in range(segs):
        for j in range(len(rows) - 1):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    k = 0
    for i in range(int(length * 1.6)):
        t = (i + 0.5) / (length * 1.6)
        x = -length / 2 + length * t + 0.3 * noise.noise(Vector((i * 0.9, seed, 1)))
        y = -0.3 + 1.1 * noise.noise(Vector((i * 1.3, seed, 2)))
        r = 0.22 + 0.25 * (0.5 + 0.5 * noise.noise(Vector((i * 2.1, seed, 3))))
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        vs = res["verts"]
        for v in vs: v.co.z *= 0.55; v.co *= 1 + 0.15 * noise.noise(v.co * 3 + Vector((i, 0, 0)))
        zb = -0.35 * max(0, -y) - 0.05
        bmesh.ops.translate(bm, vec=(x, y, zb), verts=vs)
        k += 1
    bmesh.ops.triangulate(bm, faces=bm.faces)
    def col(c, nrm):
        wet = smooth(0.0, -0.6, c.z)
        if nrm.z > 0.93 and abs(c.z) < 0.08 and c.y > 0.6: return PAL["soil"]
        g = mix(PAL["gravel"], PAL["rock_cap"], 0.5 + 0.5 * n2(c.x, c.y, 3.0))
        return mix(g, PAL["bank_wet"], wet * 0.8)
    paint(bm, col)
    return mesh_obj(name, bm, mat)

# ---------------------------------------------------------------- vegetation family (opaque geometry, no alpha cards)
def build_reeds(name, seed, mat, count=26, spread=1.1):
    bm = bmesh.new()
    for i in range(count):
        a = i * 2.39996 + seed
        r = spread * math.sqrt((i + 0.5) / count)
        bx, by = math.cos(a) * r, math.sin(a) * r
        h = 0.7 + 0.8 * (0.5 + 0.5 * noise.noise(Vector((i * 1.7, seed, 0))))
        lean = Vector((bx, by, 0)) * 0.35
        w = 0.05
        yaw = a * 1.3
        d = Vector((math.cos(yaw), math.sin(yaw), 0)) * w
        v0 = bm.verts.new((bx - d.x, by - d.y, -0.05)); v1 = bm.verts.new((bx + d.x, by + d.y, -0.05))
        mid = Vector((bx, by, h * 0.55)) + lean * 0.4
        v2 = bm.verts.new(mid + d * 0.7); v3 = bm.verts.new(mid - d * 0.7)
        tip = bm.verts.new(Vector((bx, by, h)) + lean)
        bm.faces.new((v0, v1, v2, v3)); bm.faces.new((v3, v2, tip))
    def col(c, nrm):
        return mix(mix(PAL["grass_cool"], PAL["reed"], smooth(0.0, 0.6, c.z)), PAL["reed_tip"], smooth(0.8, 1.4, c.z))
    paint(bm, col)
    ob = mesh_obj(name, bm, mat)
    return ob

def build_tuft(name, seed, mat, count=14, h=0.45):
    return build_reeds(name, seed, mat, count=count, spread=0.35) if h > 0.5 else _scaled(build_reeds(name, seed, mat, count, 0.35), h / 1.1)

def _scaled(ob, s):
    ob.data.transform(Matrix.Scale(s, 4)); return ob

def build_tree(name, seed, mat, height=7.0):
    bm = bmesh.new()
    # trunk: tapered 6-sided with a root flare, slight bend
    ring_n = 6; rings = []
    for k in range(6):
        t = k / 5; z = -0.3 + t * height * 0.6
        r = (0.38 * (1 - t) + 0.12) * (1.5 if k == 0 else 1.0)
        off = Vector((0.4 * math.sin(t * 2.2 + seed), 0.25 * math.sin(t * 1.7 + seed * 2), 0)) * t
        rings.append([bm.verts.new(Vector((math.cos(j / ring_n * math.tau) * r, math.sin(j / ring_n * math.tau) * r, z)) + off) for j in range(ring_n)])
    for k in range(5):
        for j in range(ring_n):
            bm.faces.new((rings[k][j], rings[k][(j + 1) % ring_n], rings[k + 1][(j + 1) % ring_n], rings[k + 1][j]))
    top = rings[-1][0].co.copy()
    # canopy: 5-7 lumpy clusters -> readable stylised silhouette with light/dark masses
    n = 6
    for i in range(n):
        a = i * 2.39996 + seed
        rr = 1.4 + 0.5 * math.sin(i * 1.9 + seed)
        c = Vector((math.cos(a) * rr * 0.9, math.sin(a) * rr * 0.9, height * 0.62 + 0.9 * math.sin(i * 1.3 + seed) + (1.2 if i == 0 else 0)))
        if i == 0: c.x = c.y = 0; c.z = height * 0.8
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.5 + 0.4 * math.cos(i + seed))
        for v in res["verts"]:
            v.co *= 1 + 0.18 * noise.noise(v.co * 1.3 + Vector((seed, i, 0)))
            v.co.z *= 0.78
        bmesh.ops.translate(bm, vec=c, verts=res["verts"])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    def col(c, nrm):
        if c.z < height * 0.5 and Vector((c.x, c.y, 0)).length < 0.9: return PAL["bark"]
        light = 0.5 + 0.5 * nrm.z
        base = mix(PAL["leaf_c"], PAL["leaf_a"], light)
        return mix(base, PAL["leaf_b"], smooth(0.75, 1.0, nrm.z + 0.2 * n2(c.x, c.y, 1.3)))
    paint(bm, col)
    return mesh_obj(name, bm, mat)

# ---------------------------------------------------------------- review terrain (NOT game truth: a 96 m sample for renders)
def river_center(y):  # river runs along +Y, meanders in X
    return 6.0 * math.sin(y * 0.055) + 2.5 * math.sin(y * 0.13 + 1.0)

def river_width(y): return 7.0 + 2.0 * math.sin(y * 0.04 + 0.6)

def terrain_h(x, y):
    base = 1.2 * fbm(x, y, 0.018, 4) + 0.35 * fbm(x, y, 0.09, 2)
    ridge = 7.5 * smooth(11.0 + 1.5 * n2(x, y, 0.05), 18.0, x) + 3.0 * smooth(22.0, 40.0, x) * (0.5 + 0.5 * n2(x, y, 0.04))  # east ridge
    d = abs(x - river_center(y)); w = river_width(y)
    bank = 2.1 * smooth(w * 0.5 + 3.5, w * 0.5 - 0.4, d)   # cut bank 2.1 m
    bed = 0.55 * smooth(w * 0.45, 0.0, d)
    return base + ridge - bank - bed

WATER_Z = -1.35

def build_terrain(mat, size=180.0, res=271, flat=False):
    bm = bmesh.new(); half = size / 2; step = size / (res - 1)
    vs = [[None] * res for _ in range(res)]
    for j in range(res):
        for i in range(res):
            x = -half + i * step; y = -half + j * step
            h = 0.4 * fbm(x, y, 0.02, 2) if flat else terrain_h(x, y)
            if flat and abs(x - river_center(y)) < river_width(y) * 0.5: h = -0.2
            vs[j][i] = bm.verts.new((x, y, h))
    for j in range(res - 1):
        for i in range(res - 1):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    def col(c, nrm):
        if flat: return mix((0.42, 0.52, 0.20), (0.48, 0.55, 0.22), 0.5 + 0.5 * n2(c.x, c.y, 0.08))
        slope = 1.0 - nrm.z
        d = abs(c.x - river_center(c.y)); w = river_width(c.y)
        macro = 0.5 + 0.5 * fbm(c.x, c.y, 0.025, 3)
        g = mix(PAL["grass_cool"], PAL["grass_lush"], macro)
        g = mix(g, PAL["grass_warm"], smooth(0.55, 0.85, 0.5 + 0.5 * n2(c.x, c.y, 0.06)))
        g = mix(g, PAL["meadow_dry"], smooth(0.6, 0.9, macro) * smooth(3.0, 8.0, c.z) * 0.7)
        # micro breakup: per-face value jitter (stylised brush strokes)
        jit = 0.93 + 0.12 * (0.5 + 0.5 * noise.noise(Vector((c.x * 1.9, c.y * 1.9, 4.0))))
        g = tuple(v * jit for v in g)
        soil = mix(PAL["soil"], PAL["soil_dark"], smooth(0.3, 0.7, slope))
        colr = mix(g, soil, smooth(0.28, 0.48, slope + 0.1 * n2(c.x, c.y, 0.3)))
        colr = mix(colr, strata_colour(c.z, 10, 1.0), smooth(0.50, 0.68, slope))
        wetband = smooth(w * 0.5 + 2.2, w * 0.5 + 0.2, d)
        colr = mix(colr, PAL["bank_wet"], wetband * 0.75)
        colr = mix(colr, mix(PAL["bed"], PAL["gravel"], 0.5 + 0.5 * n2(c.x, c.y, 0.8)), smooth(WATER_Z + 0.3, WATER_Z - 0.2, c.z))
        return colr
    paint(bm, col)
    ob = mesh_obj("ReviewTerrain" + ("_Before" if flat else ""), bm, mat)
    for p in ob.data.polygons: p.use_smooth = False
    return ob

def build_water(mat, flat=False):
    bm = bmesh.new(); prev = None; zz = 0.02 if flat else WATER_Z
    for k in range(181):
        y = -90 + k
        cx = river_center(y); hw = river_width(y) * (0.5 if flat else 0.47)
        row = [bm.verts.new((cx + hw * s, y, zz)) for s in (-1.0, -0.62, 0.0, 0.62, 1.0)]
        if prev:
            for i in range(4): bm.faces.new((prev[i], prev[i + 1], row[i + 1], row[i]))
        prev = row
    if not flat:  # shallow tan/teal margins -> deep centre (preview of godot/river_water.gdshader depth tint)
        lay = bm.loops.layers.color.new("Col")
        for f in bm.faces:
            for l in f.loops:
                y = l.vert.co.y; e = abs(l.vert.co.x - river_center(y)) / (river_width(y) * 0.47)
                c = mix((0.03, 0.12, 0.13), (0.22, 0.36, 0.30), smooth(0.35, 1.0, e))
                l[lay] = (*srgb2lin(c), 1)
    ob = mesh_obj("ReviewWater" + ("_Before" if flat else ""), bm, mat)
    if flat:
        m = bpy.data.materials.new("CyanStrip"); m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb2lin((0.30, 0.62, 0.66)), 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.5
        ob.data.materials[0] = m
    return ob

def link_instance(src, loc, rot=0.0, scale=1.0, name=None, coll=None):
    ob = bpy.data.objects.new(name or src.name + "_inst", src.data)
    ob.location = loc; ob.rotation_euler = (0, 0, rot); ob.scale = (scale,) * 3
    coll.objects.link(ob); return ob

# ---------------------------------------------------------------- export + stats
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def dims(ob):
    xs = [v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in xs), min(v.y for v in xs), min(v.z for v in xs)))
    mx = Vector((max(v.x for v in xs), max(v.y for v in xs), max(v.z for v in xs)))
    # report in Godot axes: X, Y(up)=Blender Z, Z=-Blender Y
    return {"x": round(mx.x - mn.x, 2), "y_up": round(mx.z - mn.z, 2), "z": round(mx.y - mn.y, 2), "min_y_up": round(mn.z, 2)}

def export_glb(ob, path):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False, export_materials="EXPORT")

def main():
    reset()
    scn = bpy.context.scene
    kit = bpy.data.collections.new("Kit"); scn.collection.children.link(kit)
    rock_m = vc_material("OrchardRock_VC", 0.88, 0.25)
    veg_m = vc_material("OrchardFoliage_VC", 0.8, 0.2)
    ground_m = vc_material("OrchardGround_VC", 0.95, 0.2)

    assets = []
    def reg(ob, family, budget, lod, cull):
        ob.users_collection[0].objects.unlink(ob); kit.objects.link(ob)
        assets.append((ob, family, budget, lod, cull))
    reg(build_cliff("cliff_strata_wide", 9.0, 6.5, 4.0, 1.0, rock_m), "cliff", "<=40 per Orchard", "LOD0 full, LOD1 via Godot auto-LOD at 45 m", 220)
    reg(build_cliff("cliff_strata_tall", 5.5, 9.0, 3.6, 2.7, rock_m), "cliff", "<=24", "auto-LOD", 240)
    reg(build_cliff("cliff_strata_low", 7.0, 3.2, 3.0, 4.2, rock_m), "cliff", "<=60 (bank ledges)", "auto-LOD", 160)
    reg(build_boulder("boulder_large", 1.8, 0.72, 0.3, rock_m, 0.7), "boulder", "<=80 MultiMesh", "auto-LOD", 140)
    reg(build_boulder("boulder_medium", 1.0, 0.62, 1.9, rock_m, 0.5), "boulder", "<=200 MultiMesh", "auto-LOD", 90)
    reg(build_boulder("boulder_small", 0.45, 0.55, 3.3, rock_m, 0.35), "boulder", "<=500 MultiMesh", "none", 50)
    reg(build_bank_stones("bank_stone_lip_8m", 8.0, 5.0, rock_m), "riverbank", "one per ~8 m of bank, both sides (~80)", "none", 90)
    reg(build_reeds("reed_clump", 3.0, veg_m), "vegetation", "<=600 MultiMesh near water", "none", 45)
    reg(_scaled(build_reeds("grass_tuft", 8.0, veg_m, 12, 0.35), 0.45), "vegetation", "<=3000 MultiMesh, per-chunk", "none", 30)
    reg(build_tree("tree_orchard_round", 0.8, veg_m, 7.0), "vegetation", "<=350 MultiMesh", "auto-LOD", 260)
    reg(build_tree("tree_orchard_tall", 2.2, veg_m, 9.5), "vegetation", "<=200 MultiMesh", "auto-LOD", 260)

    manifest = {"generator": "build_visual_kit.py", "blender": bpy.app.version_string, "seed": 7331,
                "units": "metres; Godot +Y up; origin grounded at y=0 with buried skirt",
                "materials": {"OrchardRock_VC": "opaque, vertex-colour albedo (COLOR_0), rough 0.88",
                              "OrchardFoliage_VC": "opaque, vertex-colour albedo, rough 0.8, cull_disabled recommended for reeds/tufts"},
                "textures": "none embedded: all colour is flat-shaded vertex colour (zero texture bandwidth); detail comes from godot/ shaders in output/godot/",
                "assets": []}
    for ob, fam, budget, lod, cull in assets:
        p = os.path.join(OUT, "glb", ob.name + ".glb")
        export_glb(ob, p)
        manifest["assets"].append({"name": ob.name, "file": "glb/" + ob.name + ".glb", "family": fam,
                                   "triangles": tri_count(ob), "dimensions_m": dims(ob),
                                   "material": ob.data.materials[0].name, "instance_budget": budget,
                                   "lod": lod, "visibility_range_end_m": cull})

    # ---------------- review scene (after)
    after = bpy.data.collections.new("Review_After"); scn.collection.children.link(after)
    t = build_terrain(ground_m); scn.collection.objects.unlink(t); after.objects.link(t)
    w = build_water(water_material()); scn.collection.objects.unlink(w); after.objects.link(w)
    K = {ob.name: ob for ob, *_ in assets}
    import random
    rng = random.Random(7331)
    # cliffs along ridge flank x~14..22 where slope is steep
    for k in range(17):  # continuous escarpment: overlapping modules, scree at the foot
        y = -50 + k * 6.2 + rng.uniform(-1.0, 1.0); x = 13.2 + rng.uniform(-0.8, 0.8)
        nm = ["cliff_strata_wide", "cliff_strata_tall", "cliff_strata_low", "cliff_strata_wide"][k % 4]
        for j in range(3):
            bx = x - rng.uniform(2.5, 6.0); by = y + rng.uniform(-3, 3)
            link_instance(K[rng.choice(["boulder_medium", "boulder_small", "boulder_small"])], (bx, by, terrain_h(bx, by)), rng.uniform(0, 6.28), rng.uniform(0.7, 1.4), coll=after)
        link_instance(K[nm], (x, y, terrain_h(x - 2.0, y) - 0.4), rng.uniform(-0.35, 0.35) - math.pi / 2, rng.uniform(0.85, 1.15), coll=after)
    # bank lips + stones follow the river both banks
    for k in range(12):
        y = -44 + k * 8
        for side in (-1, 1):
            cx = river_center(y); hw = river_width(y) * 0.5
            x = cx + side * (hw + 0.4)
            ang = math.atan2(river_center(y + 1) - river_center(y - 1), 2.0)
            link_instance(K["bank_stone_lip_8m"], (x, y, terrain_h(x, y) - 0.1), -ang + (math.pi / 2 if side > 0 else -math.pi / 2) - math.pi / 2, 1.0, coll=after)
    for k in range(70):
        y = rng.uniform(-46, 46); side = rng.choice((-1, 1))
        x = river_center(y) + side * (river_width(y) * 0.5 + rng.uniform(0.3, 2.5))
        link_instance(K["reed_clump"], (x, y, terrain_h(x, y)), rng.uniform(0, 6.28), rng.uniform(0.7, 1.2), coll=after)
    for k in range(40):
        x, y = rng.uniform(-44, 30), rng.uniform(-46, 46)
        if abs(x - river_center(y)) < river_width(y) * 0.5 + 1: continue
        nm = rng.choice(["boulder_large", "boulder_medium", "boulder_small", "boulder_small"])
        link_instance(K[nm], (x, y, terrain_h(x, y)), rng.uniform(0, 6.28), rng.uniform(0.8, 1.3), coll=after)
    for k in range(900):
        x, y = rng.uniform(-48, 40), rng.uniform(-48, 48)
        if abs(x - river_center(y)) < river_width(y) * 0.5 + 0.5: continue
        if n2(x, y, 0.07) < -0.1: continue  # clustered meadows, not uniform sprinkle
        link_instance(K["grass_tuft"], (x, y, terrain_h(x, y)), rng.uniform(0, 6.28), rng.uniform(0.8, 1.6), coll=after)
    # trees: groves (clusters) on the west terrace + scattered on ridge top, keeping river corridor open
    for g, (gx, gy) in enumerate([(-30, 20), (-26, -18), (-38, -38), (30, 10), (34, -30)]):
        for k in range(7):
            x = gx + rng.gauss(0, 5); y = gy + rng.gauss(0, 5)
            if abs(x - river_center(y)) < river_width(y) * 0.5 + 4: continue
            link_instance(K["tree_orchard_round" if k % 3 else "tree_orchard_tall"], (x, y, terrain_h(x, y)), rng.uniform(0, 6.28), rng.uniform(0.8, 1.2), coll=after)

    # ---------------- review scene (before): flat prototype look for comparison
    before = bpy.data.collections.new("Review_Before"); scn.collection.children.link(before)
    tb = build_terrain(ground_m, flat=True); scn.collection.objects.unlink(tb); before.objects.link(tb)
    wb = build_water(None, flat=True); scn.collection.objects.unlink(wb); before.objects.link(wb)
    kit.hide_render = True; kit.hide_viewport = True

    # ---------------- lighting: low warm key sun + cool sky fill + mist
    sun_d = bpy.data.lights.new("Sun", "SUN"); sun_d.energy = 5.5; sun_d.color = (1.0, 0.88, 0.72); sun_d.angle = math.radians(2.5)
    sun = bpy.data.objects.new("Sun", sun_d); sun.rotation_euler = (math.radians(58), 0, math.radians(-128)); scn.collection.objects.link(sun)
    world = bpy.data.worlds.new("World"); scn.world = world; world.use_nodes = True
    wn = world.node_tree.nodes; L = world.node_tree.links
    crd = wn.new("ShaderNodeTexCoord"); sep = wn.new("ShaderNodeSeparateXYZ"); ramp = wn.new("ShaderNodeValToRGB")
    L.new(crd.outputs["Generated"], sep.inputs[0]); L.new(sep.outputs["Z"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (*srgb2lin((0.86, 0.84, 0.76)), 1)
    ramp.color_ramp.elements[1].position = 0.32; ramp.color_ramp.elements[1].color = (*srgb2lin((0.42, 0.62, 0.86)), 1)
    wn["Background"].inputs["Strength"].default_value = 1.1
    L.new(ramp.outputs["Color"], wn["Background"].inputs["Color"])
    # distance mist via volume would be costly; use Eevee-friendly world mist pass composite-free: a large faint box is avoided.

    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: scn.render.engine = eng; break
        except TypeError: continue
    scn.render.resolution_x, scn.render.resolution_y = 1400, 900
    try: scn.eevee.taa_render_samples = SAMPLES
    except Exception: pass
    try: scn.eevee.use_shadows = True
    except Exception: pass
    scn.view_settings.view_transform = "AgX"; scn.view_settings.look = "AgX - Base Contrast"

    cam_d = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_d); scn.collection.objects.link(cam); scn.camera = cam
    views = {
        "ground_view": dict(loc=(-9.5, -40, 0.9), look=(4, 10, -0.2), lens=20),       # VR eye height on west bank
        "elevated_view": dict(loc=(-46, -62, 34), look=(4, 8, 0), lens=24),           # strategic camera
    }
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "source.blend"))
    if RENDER:
        for label, coll_on, coll_off in (("", after, before), ("before_", before, after)):
            coll_on.hide_render = False; coll_off.hide_render = True
            for name, v in views.items():
                vv = dict(v)
                if label:  # before terrain is flat: eye height relative to ~0
                    vv["loc"] = (v["loc"][0], v["loc"][1], v["loc"][2] + (0.8 if name == "ground_view" else 0))
                else:
                    x, y, _ = v["loc"]; vv["loc"] = (x, y, terrain_h(x, y) + (1.7 if name == "ground_view" else v["loc"][2]))
                cam.location = vv["loc"]; cam_d.lens = vv["lens"]
                d = Vector(vv["look"]) - Vector(vv["loc"])
                cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
                scn.render.filepath = os.path.join(OUT, label + name + ".png")
                bpy.ops.render.render(write_still=True)
        after.hide_render = False; before.hide_render = True
    with open(os.path.join(OUT, "manifest.json"), "w") as f: json.dump(manifest, f, indent=2)
    print("VISUAL_KIT_DONE", OUT)

main()
