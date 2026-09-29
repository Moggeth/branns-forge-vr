"""Starfall Ridge authored environment kit - deterministic Blender 4.5 builder.

Rebuild (from the output/ folder):
  blender.exe -b --factory-startup -P build_starfall.py -- [--no-render]

Authoring space is Blender Z-up with the asset FRONT facing -Y.  The glTF
exporter converts (x,y,z)_blender -> (x,z,-y)_gltf, so in Godot an asset's
front faces +Z (toward the arrival) and Godot Z = -Blender Y.
Every asset origin is the centre of its ground contact.
"""
import bpy, bmesh, math, random, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sf_collision
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TEX_DIR = os.path.join(HERE, "textures")
PREV_DIR = os.path.join(HERE, "previews")
SEED = 20260930
TAU = math.tau
NO_RENDER = "--no-render" in sys.argv
for d in (TEX_DIR, PREV_DIR):
    os.makedirs(d, exist_ok=True)
T0 = time.time()

# ---------------------------------------------------------------- utilities
def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def lerp(a, b, t): return a + (b - a) * t
def lerpc(a, b, t): return tuple(lerp(a[i], b[i], t) for i in range(3))
def smooth(a, b, x):
    t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t)
def hash01(k, s=0):
    return (math.sin(k * 12.9898 + s * 78.233 + 1.7) * 43758.5453) % 1.0
def fbm(p, seed=0, octaves=3, lac=2.03, gain=0.5):
    off = Vector((seed * 17.13 + 3.1, seed * 31.7 + 5.3, seed * 7.9 + 1.9))
    a, f, s, n = 1.0, 1.0, 0.0, 0.0
    for _ in range(octaves):
        s += a * noise.noise(p * f + off); n += a; a *= gain; f *= lac
    return s / n * 1.6
def lin(c): return tuple(max(0.0, min(1.0, x)) ** 2.2 for x in c)
def G2B(x, y, z): return Vector((x, -z, y))          # godot -> blender
def B2G(v): return (v.x, v.z, -v.y)

MATS = ["SF_Strata", "SF_Worked", "SF_Scar", "SF_Growth", "SF_Crystal_Cyan", "SF_Crystal_Violet"]
M_STRATA, M_WORKED, M_SCAR, M_GROWTH, M_CYAN, M_VIOLET = range(6)
LAYERS = ("cav", "par", "tone", "jit")

# ---------------------------------------------------------------- textures
def tile_noise(rng, n, slope, aniso=(1.0, 1.0)):
    f = np.fft.fftfreq(n) * n
    FX, FY = np.meshgrid(f * aniso[0], f * aniso[1])
    r = np.sqrt(FX ** 2 + FY ** 2); r[0, 0] = 1.0
    amp = r ** (-slope); amp[0, 0] = 0.0
    h = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * amp))
    return (h - h.min()) / (h.max() - h.min() + 1e-9)

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def make_image(name, rgb, srgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    px = np.ones((h, w, 4), np.float32); px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.filepath_raw = os.path.join(TEX_DIR, name + ".png")
    img.file_format = "PNG"; img.save()
    img.pack()
    return img

def build_texture_set(key, n, rng):
    """Returns (base, normal, orm) images. Albedo is mostly neutral detail;
    hue and strata banding come from vertex colour, so instances differ."""
    if key == "strata":
        big = tile_noise(rng, n, 1.7); mid = tile_noise(rng, n, 1.1); fine = tile_noise(rng, n, 0.55)
        crack = 1 - np.abs(tile_noise(rng, n, 1.5) - 0.5) * 2
        crack = np.clip((crack - 0.86) * 7, 0, 1)
        h = 0.5 * big + 0.3 * mid + 0.2 * fine - 0.25 * crack
        alb = 0.62 + 0.30 * (mid - 0.5) + 0.12 * (fine - 0.5) - 0.35 * crack
        rough = 0.80 + 0.14 * (fine - 0.5) - 0.10 * (big - 0.5)
        ao = 1 - 0.55 * crack; ns = 5.0
    elif key == "worked":
        g = tile_noise(rng, n, 0.9, (1.0, 0.18)); fine = tile_noise(rng, n, 0.5); big = tile_noise(rng, n, 1.8)
        chisel = 0.5 + 0.5 * np.sin(np.linspace(0, TAU * 46, n))[None, :] * 0.4 * (big > 0.5)
        h = 0.55 * fine + 0.3 * g + 0.15 * chisel
        alb = 0.72 + 0.20 * (big - 0.5) + 0.10 * (fine - 0.5)
        rough = 0.66 + 0.16 * (fine - 0.5) + 0.12 * (big - 0.5)
        ao = 0.92 + 0.08 * fine; crack = np.zeros_like(h); ns = 3.5
    elif key == "scar":
        big = tile_noise(rng, n, 1.5); fine = tile_noise(rng, n, 0.6)
        ridge = 1 - np.abs(tile_noise(rng, n, 1.3) - 0.5) * 2
        crack = np.clip((ridge - 0.80) * 5, 0, 1)
        h = 0.5 * big + 0.3 * fine - 0.4 * crack
        glass = np.clip((tile_noise(rng, n, 1.9) - 0.62) * 6, 0, 1)
        alb = 0.55 + 0.35 * (big - 0.5) - 0.3 * crack
        rough = 0.86 - 0.5 * glass + 0.08 * (fine - 0.5)
        ao = 1 - 0.7 * crack; ns = 6.5
    elif key == "growth":
        a = tile_noise(rng, n, 1.0, (0.35, 1.0)); b = tile_noise(rng, n, 1.2)
        h = 0.6 * a + 0.4 * b
        alb = 0.75 + 0.30 * (b - 0.5) + 0.2 * (a - 0.5)
        rough = 0.84 + 0.1 * (a - 0.5); ao = 0.9 + 0.1 * a; crack = np.zeros_like(h); ns = 1.6
    else:  # crystal
        s = tile_noise(rng, n, 1.0, (0.2, 1.0)); f2 = tile_noise(rng, n, 1.4)
        h = 0.5 * s + 0.5 * f2
        alb = 0.82 + 0.28 * (s - 0.5)
        rough = 0.18 + 0.20 * f2 - 0.10 * (s - 0.5); ao = 0.95 + 0.05 * f2
        crack = np.zeros_like(h); ns = 1.2
    rgb = np.clip(np.stack([alb, alb * 0.985, alb * 0.97], -1), 0, 1)
    orm = np.stack([np.clip(ao, 0, 1), np.clip(rough, 0.05, 1), np.zeros_like(h)], -1)
    return (make_image(f"sf_{key}_base", rgb, True),
            make_image(f"sf_{key}_normal", normal_from_height(h, ns * 0.9), False),
            make_image(f"sf_{key}_orm", orm, False))

def get_glTF_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng: return ng
    ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng

def make_material(name, tex, emit=None, base_tint=(1, 1, 1), double_sided=False, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (900, 0)
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled"); bs.location = (600, 0)
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    base, nrm, orm = tex
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Color"; vc.location = (-200, 300)
    tb = nt.nodes.new("ShaderNodeTexImage"); tb.image = base; tb.location = (-200, 50)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.location = (200, 250)
    mix.inputs[0].default_value = 1.0
    nt.links.new(vc.outputs["Color"], mix.inputs[6]); nt.links.new(tb.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nrm; tn.location = (-200, -250)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (200, -250); nm.inputs["Strength"].default_value = 1.0
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    to = nt.nodes.new("ShaderNodeTexImage"); to.image = orm; to.location = (-200, -550)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (100, -550)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    grp = nt.nodes.new("ShaderNodeGroup"); grp.node_tree = get_glTF_group(); grp.location = (400, -650)
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    bs.inputs["Specular IOR Level"].default_value = spec
    if emit:
        bs.inputs["Emission Color"].default_value = (*lin(emit), 1); bs.inputs["Emission Strength"].default_value = 1.0
    m.use_backface_culling = not double_sided
    return m

# ---------------------------------------------------------------- mesh core
class Asset:
    def __init__(self, name, seed):
        self.name, self.seed = name, seed
        self.bm = bmesh.new()
        for l in LAYERS: self.bm.verts.layers.float.new(l)
        self.rng = random.Random(SEED + seed)

def new_tmp(a):
    t = bmesh.new()
    for l in LAYERS: t.verts.layers.float.new(l)
    return t

def merge(a, t, mat, M=None, par=None, tone=None):
    """Copy temp bmesh into asset, transformed by M."""
    bm = a.bm; vmap = {}
    for v in t.verts:
        co = M @ v.co if M is not None else v.co.copy()
        nv = bm.verts.new(co); vmap[v] = nv
        for l in LAYERS:
            nv[bm.verts.layers.float[l]] = v[t.verts.layers.float[l]]
        if tone is not None: nv[bm.verts.layers.float["tone"]] = tone
        if par is not None: nv[bm.verts.layers.float["par"]] = par
    for f in t.faces:
        try:
            nf = bm.faces.new([vmap[v] for v in f.verts]); nf.material_index = mat
        except ValueError:
            pass

def setl(t, v, **kw):
    for k, val in kw.items(): v[t.verts.layers.float[k]] = val

def basis_from_axis(axis):
    axis = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    ux = axis.cross(ref).normalized(); uy = axis.cross(ux).normalized()
    return ux, uy, axis

def add_blob(a, c, size, subdiv=3, seed=1, nexp=2.4, sf=0.0, sa=0.0, na=0.22, nf=1.4, cuts=3,
             clip=-0.25, mat=M_STRATA, tone=0.5, fissure=0, taper=0.0, lean=(0, 0), yaw=0.0):
    """Superellipsoid rock with strata ledges, planar fracture cuts, fissures.  Origin at base."""
    t = new_tmp(a)
    bmesh.ops.create_icosphere(t, subdivisions=subdiv, radius=1.0)
    rng = random.Random(seed * 101 + a.seed)
    planes = []
    for _ in range(cuts):
        ang = rng.uniform(0, TAU); el = rng.uniform(-0.15, 0.75)
        n = Vector((math.cos(ang) * math.cos(el), math.sin(ang) * math.cos(el), math.sin(el))).normalized()
        planes.append((n, rng.uniform(0.60, 0.84)))
    cracks = []
    for _ in range(fissure):
        ang = rng.uniform(0, TAU)
        cracks.append((Vector((math.cos(ang), math.sin(ang), 0)), rng.uniform(-0.4, 0.4), rng.uniform(0.05, 0.10)))
    for v in t.verts:
        d = v.co.copy()
        s = (abs(d.x) ** nexp + abs(d.y) ** nexp + abs(d.z) ** nexp) ** (1.0 / nexp)
        d /= s
        r = 1 + na * fbm(d * nf, seed + a.seed, 3)
        cav = 0.0
        if sf > 0:
            h = (d.z + 1) * 0.5 * size[2]
            w = h * sf + 0.6 * fbm(d * 1.1, seed + 3 + a.seed, 2)
            k = math.floor(w); fr = w - k; hd = hash01(k, seed + a.seed)
            ledge = sa * ((hd - 0.5) + 0.6 * (fr * fr - 0.33))
            r *= 1 + ledge
        p = d * r
        for n_c, o, wd in cracks:
            dd = abs(p.dot(n_c) - o)
            if dd < wd and p.z > -0.5:
                g = 1 - dd / wd
                p.x *= 1 - 0.22 * g; p.y *= 1 - 0.22 * g; cav += g
        for n, off in planes:
            dd = p.dot(n) - off
            if dd > 0: p -= n * dd
        if taper:
            k = 1 - taper * (p.z + 1) * 0.5; p.x *= k; p.y *= k
        cav += clamp(0.5 - 2.5 * (r - 1), 0, 1) * 0.8
        q = Vector((p.x * size[0] * 0.5, p.y * size[1] * 0.5, (p.z + 1) * 0.5 * size[2]))
        q.x += lean[0] * q.z / max(size[2], 0.01); q.y += lean[1] * q.z / max(size[2], 0.01)
        if q.z < clip + 0.25 + 0.0: q.z = max(q.z, clip)
        v.co = q
        setl(t, v, cav=clamp(cav), tone=tone + rng.uniform(-0.05, 0.05), jit=hash01(v.index, seed))
    M = Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, "Z")
    merge(a, t, mat, M); t.free()

def add_crystal(a, base, axis, r, L, mat=M_CYAN, sides=6, tipfrac=0.24, taper=0.86, tone=0.5):
    t = new_tmp(a); rng = a.rng
    ux, uy, ax = basis_from_axis(axis)
    r0 = rng.uniform(0, TAU); ring0 = []; ring1 = []
    for i in range(sides):
        ang = r0 + i * TAU / sides
        dv = ux * math.cos(ang) + uy * math.sin(ang)
        rr = r * (1 + 0.14 * math.sin(3 * ang + a.seed))
        v0 = t.verts.new(Vector(base) + dv * rr); setl(t, v0, par=0.0, tone=tone, jit=rng.random())
        v1 = t.verts.new(Vector(base) + ax * L * (1 - tipfrac) + dv * rr * taper)
        setl(t, v1, par=1 - tipfrac, tone=tone, jit=rng.random())
        ring0.append(v0); ring1.append(v1)
    apex = t.verts.new(Vector(base) + ax * L + ux * 0.12 * r); setl(t, apex, par=1.0, tone=tone, jit=rng.random())
    for i in range(sides):
        j = (i + 1) % sides
        t.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        t.faces.new((ring1[i], ring1[j], apex))
    merge(a, t, mat); t.free()

def add_cluster(a, c, n, spread, lmin, lmax, radius, mat_fn, tilt=0.5, up=(0, 0, 1), face=(0, 0), tone=0.5):
    rng = a.rng
    for i in range(n):
        ang = rng.uniform(0, TAU); dist = spread * math.sqrt(rng.random()) * (0.4 if i < 3 else 1.0)
        pos = Vector(c) + Vector((math.cos(ang) * dist, math.sin(ang) * dist, 0))
        tl = tilt * (dist / max(spread, 0.01)) + rng.uniform(0, 0.25)
        ax = Vector(up) + Vector((math.cos(ang) * tl + face[0], math.sin(ang) * tl + face[1], 0))
        L = rng.uniform(lmin, lmax) * (1.35 if i == 0 else 1.0) * (1 - 0.35 * dist / max(spread, 0.01))
        add_crystal(a, pos, ax, radius * rng.uniform(0.7, 1.25) * (L / lmax) ** 0.4, L, mat=mat_fn(i), tone=tone)

def add_box(a, c, size, yaw=0.0, tilt=(0, 0), bevel=0.03, mat=M_WORKED, tone=0.5, wear=0.02, seed=0, taper=0.0):
    t = new_tmp(a)
    bmesh.ops.create_cube(t, size=1.0)
    for v in t.verts:
        k = 1 - taper * (v.co.z + 0.5)
        v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, (v.co.z + 0.5) * size[2]))
    if bevel > 0:
        bmesh.ops.bevel(t, geom=list(t.verts) + list(t.edges) + list(t.faces), offset=bevel, segments=1, affect="EDGES")
    for v in t.verts:
        v.co += Vector((noise.noise(v.co * 3.1 + Vector((seed, 1, 2))), noise.noise(v.co * 3.1 + Vector((3, seed, 2))),
                         noise.noise(v.co * 3.1 + Vector((4, 5, seed))))) * wear
        setl(t, v, tone=tone + hash01(seed, 3) * 0.16 - 0.08, jit=hash01(v.index, seed),
             cav=clamp(0.5 - v.co.z / max(size[2], 0.2)) * 0.5 * 0.0)
    M = (Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(tilt[0], 4, "X") @ Matrix.Rotation(tilt[1], 4, "Y"))
    merge(a, t, mat, M); t.free()

def add_cyl(a, p0, p1, r0, r1, sides=8, mat=M_WORKED, tone=0.5, caps=(True, True), par0=0.0, par1=1.0, twist=0.0, wob=0.0):
    t = new_tmp(a)
    ux, uy, ax = basis_from_axis(Vector(p1) - Vector(p0))
    L = (Vector(p1) - Vector(p0)).length
    ring0, ring1 = [], []
    for i in range(sides):
        ang = i * TAU / sides
        dv = ux * math.cos(ang) + uy * math.sin(ang)
        w = 1 + wob * math.sin(5 * ang + a.seed)
        v0 = t.verts.new(Vector(p0) + dv * r0 * w); setl(t, v0, par=par0, tone=tone, jit=hash01(i, a.seed))
        v1 = t.verts.new(Vector(p1) + dv * r1 * w); setl(t, v1, par=par1, tone=tone, jit=hash01(i + 9, a.seed))
        ring0.append(v0); ring1.append(v1)
    for i in range(sides):
        j = (i + 1) % sides
        t.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    if caps[0]: t.faces.new(list(reversed(ring0)))
    if caps[1]: t.faces.new(ring1)
    merge(a, t, mat); t.free()

def add_sweep(a, pts, w, h, side_hint, mat=M_WORKED, tone=0.5, taper=1.0, par=None):
    """Rectangular section swept along polyline."""
    t = new_tmp(a); rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        tg = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        sd = (side_hint - tg * side_hint.dot(tg)).normalized()
        up = tg.cross(sd).normalized()
        k = lerp(1.0, taper, i / max(n - 1, 1))
        corners = [p + sd * w * k * 0.5 + up * h * k * 0.5, p - sd * w * k * 0.5 + up * h * k * 0.5,
                   p - sd * w * k * 0.5 - up * h * k * 0.5, p + sd * w * k * 0.5 - up * h * k * 0.5]
        ring = []
        for c in corners:
            v = t.verts.new(c); setl(t, v, tone=tone + 0.04 * hash01(i, a.seed), jit=hash01(i, 5)); ring.append(v)
        rings.append(ring)
    for i in range(n - 1):
        for k in range(4):
            j = (k + 1) % 4
            t.faces.new((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
    t.faces.new(list(reversed(rings[0]))); t.faces.new(rings[-1])
    merge(a, t, mat); t.free()

def add_wedge(a, r0, r1, a0, a1, z0, z1, c=Vector((0, 0, 0)), mat=M_WORKED, tone=0.5, jit=0.02, seed=0):
    t = new_tmp(a)
    P = {}
    for i, r in enumerate((r0, r1)):
        for j, an in enumerate((a0, a1)):
            for k, z in enumerate((z0, z1)):
                q = Vector((r * math.cos(an), r * math.sin(an), z)) + Vector((noise.noise(Vector((seed, i, j + k * 3))),
                     noise.noise(Vector((seed + 2, j, i + k))), noise.noise(Vector((seed + 5, k, i + j)))) ) * jit
                v = t.verts.new(q); setl(t, v, tone=tone, jit=hash01(seed * 8 + i * 4 + j * 2 + k, 1)); P[(i, j, k)] = v
    quads = [((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)), ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),
             ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
             ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0))]
    for q in quads: t.faces.new([P[k] for k in q])
    merge(a, t, mat, Matrix.Translation(c)); t.free()

def add_blade(a, base, height, width, bend, yaw, tone=0, segs=3):
    """Tapered bent blade; double sided material."""
    t = new_tmp(a); prev = None
    d = Vector((math.cos(yaw), math.sin(yaw), 0)); side = Vector((-d.y, d.x, 0))
    for i in range(segs + 1):
        f = i / segs
        p = Vector(base) + d * bend * f * f * height + Vector((0, 0, height * f * (1 - 0.15 * f * bend)))
        w = width * (1 - f * 0.92) * 0.5
        v0 = t.verts.new(p - side * w); v1 = t.verts.new(p + side * w)
        for v in (v0, v1): setl(t, v, par=f, tone=tone, jit=hash01(i, yaw))
        if prev:
            t.faces.new((prev[0], prev[1], v1, v0))
        prev = (v0, v1)
    merge(a, t, M_GROWTH); t.free()

def add_card(a, c, size, yaw, pitch, tone=1, par=0.6):
    t = new_tmp(a)
    pts = [Vector((0, 0, 0)), Vector((size * 0.32, 0, size * 0.4)), Vector((0, 0, size)), Vector((-size * 0.32, 0, size * 0.4))]
    vs = []
    for p in pts:
        v = t.verts.new(p); setl(t, v, par=par * (0.6 + 0.6 * p.z / size), tone=tone, jit=hash01(size * 7, yaw)); vs.append(v)
    t.faces.new(vs)
    M = Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "X")
    merge(a, t, M_GROWTH, M); t.free()

# ---------------------------------------------------------------- vertex colours
STRATA_PAL = [(0.33, 0.37, 0.48), (0.47, 0.43, 0.43), (0.25, 0.27, 0.35), (0.60, 0.56, 0.50), (0.44, 0.34, 0.31), (0.37, 0.41, 0.46)]
GROW = {0: ((0.20, 0.26, 0.13), (0.72, 0.64, 0.36)), 1: ((0.14, 0.23, 0.21), (0.36, 0.54, 0.44)),
        2: ((0.20, 0.18, 0.17), (0.56, 0.53, 0.49)), 3: ((0.18, 0.33, 0.28), (0.50, 0.70, 0.55)),
        4: ((0.30, 0.24, 0.13), (0.62, 0.42, 0.20))}

def vcolor(mat, co, n, cav, par, tone, jit, seed):
    if mat == M_STRATA:
        idx = math.floor(co.z / 0.55 + 0.7 * fbm(co * 0.45, seed, 2))
        h = hash01(idx, seed)
        c = STRATA_PAL[int(h * 6) % 6]
        c = tuple(x * (0.86 + 0.28 * (tone - 0.5) + 0.22 * (jit - 0.5)) for x in c)
        top = clamp(n.z) ** 1.5
        c = lerpc(c, (0.60, 0.61, 0.68), 0.45 * top)
        lich = smooth(0.15, 0.5, fbm(co * 1.7, seed + 9, 2)) * clamp(n.z + 0.35) * smooth(0.5, 1.2, co.z)
        c = lerpc(c, (0.52, 0.52, 0.30), 0.55 * lich)
        c = tuple(x * (1 - 0.5 * cav) for x in c)
        ao = 0.62 + 0.38 * smooth(0.0, 1.0, co.z)
        return tuple(x * ao for x in c)
    if mat == M_WORKED:
        c = (0.70, 0.68, 0.63); c = lerpc(c, (0.60, 0.64, 0.68), 0.5 * (1 - tone))
        c = tuple(x * (0.82 + 0.34 * tone + 0.16 * (jit - 0.5)) for x in c)
        st = smooth(0.0, 0.55, fbm(co * 2.1, seed + 4, 2))
        c = lerpc(c, (0.36, 0.34, 0.33), 0.4 * st * (1 - clamp(n.z)))
        lich = smooth(0.2, 0.6, fbm(co * 1.3, seed + 8, 2)) * clamp(n.z + 0.3)
        c = lerpc(c, (0.50, 0.53, 0.30), 0.35 * lich)
        c = lerpc(c, (0.42, 0.24, 0.16), 0.25 * smooth(0.55, 0.85, fbm(co * 1.9 + Vector((5, 0, 0)), seed, 2)) * (1 - clamp(n.z)))
        return tuple(x * (1 - 0.35 * cav) * (0.7 + 0.3 * smooth(0, 0.9, co.z)) for x in c)
    if mat == M_SCAR:
        c = (0.13, 0.12, 0.14)
        rust = smooth(0.05, 0.42, fbm(co * 1.35, seed + 1, 3))
        c = lerpc(c, (0.46, 0.21, 0.10), 0.85 * rust)
        c = lerpc(c, (0.05, 0.05, 0.06), 0.65 * cav)
        c = lerpc(c, (0.30, 0.30, 0.34), 0.25 * clamp(n.z) * (1 - rust))
        return tuple(x * (0.8 + 0.4 * (jit - 0.5) + 0.2) for x in c)
    if mat == M_GROWTH:
        a, b = GROW[int(round(tone))]
        c = lerpc(a, b, clamp(par ** 1.1 + 0.25 * (jit - 0.5)))
        return tuple(x * (0.55 + 0.45 * smooth(-0.1, 0.6, par)) for x in c)
    # crystals
    if mat == M_CYAN: dark, mid, tip = (0.05, 0.20, 0.32), (0.16, 0.55, 0.72), (0.62, 0.93, 1.0)
    else: dark, mid, tip = (0.14, 0.06, 0.28), (0.45, 0.24, 0.72), (0.86, 0.66, 1.0)
    p = clamp(par + 0.16 * (jit - 0.5))
    c = lerpc(dark, mid, smooth(0, 0.55, p)); c = lerpc(c, tip, smooth(0.55, 1.0, p) ** 1.4)
    return tuple(x * (0.85 + 0.3 * tone) for x in c)

TILE = {M_STRATA: 3.0, M_WORKED: 2.2, M_SCAR: 2.4, M_GROWTH: 1.4, M_CYAN: 1.2, M_VIOLET: 1.2}

def finish(a, mats, smooth_deg=48):
    bm = a.bm; bm.normal_update()
    uvl = bm.loops.layers.uv.new("UVMap"); col = bm.loops.layers.float_color.new("Color")
    l_cav, l_par, l_tone, l_jit = [bm.verts.layers.float[l] for l in LAYERS]
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        tile = TILE[f.material_index]; off = a.seed * 0.37
        for lp in f.loops:
            co = lp.vert.co
            if ax == 0: uv = (co.y, co.z)
            elif ax == 1: uv = (co.x, co.z)
            else: uv = (co.x, co.y)
            lp[uvl].uv = (uv[0] / tile + off, uv[1] / tile + off * 0.7)
            v = lp.vert
            c = vcolor(f.material_index, co, n, v[l_cav], v[l_par], v[l_tone], v[l_jit], a.seed)
            lc = lin(c); lp[col] = (lc[0], lc[1], lc[2], 1.0)
    mesh = bpy.data.meshes.new(a.name)
    bm.to_mesh(mesh); bm.free()
    for m in mats: mesh.materials.append(m)
    mesh.color_attributes.active_color = mesh.color_attributes["Color"]
    mesh.color_attributes.render_color_index = 0
    for p in mesh.polygons: p.use_smooth = True
    mesh.update()
    return mesh

# ---------------------------------------------------------------- asset builders
def scatter_mats(cy=1.0):
    rng = random.Random(4)
    return lambda i: M_CYAN if hash01(i, 77) < cy else M_VIOLET

def build_cliff(name, seed, size, mode):
    a = Asset(name, seed); W, D, H = size
    rng = a.rng
    add_blob(a, Vector((0, 0.15, 0)), (W, D, H), 4, seed, nexp=3.6, sf=1.5, sa=0.16, na=0.20, cuts=5, fissure=3, taper=0.12, tone=0.5)
    if mode == "a":
        add_blob(a, Vector((-W * 0.33, -D * 0.25, 0)), (W * 0.42, D * 0.6, H * 0.62), 3, seed + 1, nexp=3.2, sf=1.9, sa=0.15, na=0.22, cuts=4, tone=0.42)
        add_blob(a, Vector((W * 0.3, -D * 0.3, 0)), (W * 0.36, D * 0.55, H * 0.4), 3, seed + 2, nexp=3.0, sf=2.4, sa=0.14, cuts=4, tone=0.6)
    elif mode == "b":
        add_blob(a, Vector((W * 0.30, -D * 0.2, 0)), (W * 0.45, D * 0.7, H * 0.75), 3, seed + 1, nexp=3.6, sf=1.8, sa=0.15, cuts=5, tone=0.55, lean=(0.6, 0))
        add_blob(a, Vector((-W * 0.32, -D * 0.32, 0)), (W * 0.3, D * 0.4, H * 0.35), 3, seed + 2, nexp=3.0, sf=2.6, sa=0.12, cuts=4, tone=0.38)
    elif mode == "c":  # tall spire buttress
        add_blob(a, Vector((W * 0.05, -D * 0.1, H * 0.35)), (W * 0.5, D * 0.6, H * 0.7), 3, seed + 1, nexp=3.4, sf=1.3, sa=0.14, cuts=5, taper=0.4, tone=0.6, lean=(0.5, 0.3))
        add_blob(a, Vector((-W * 0.34, -D * 0.3, 0)), (W * 0.36, D * 0.5, H * 0.5), 3, seed + 3, nexp=3.2, sf=2.0, sa=0.14, cuts=4, tone=0.4)
    else:  # low shelf
        add_blob(a, Vector((-W * 0.25, -D * 0.1, 0)), (W * 0.55, D * 0.9, H * 0.9), 3, seed + 1, nexp=4.0, sf=3.0, sa=0.12, cuts=5, tone=0.5)
        add_blob(a, Vector((W * 0.3, -D * 0.15, 0)), (W * 0.42, D * 0.8, H * 0.6), 3, seed + 2, nexp=4.0, sf=3.5, sa=0.12, cuts=4, tone=0.62)
    # talus at the foot
    for i in range(4):
        x = rng.uniform(-W * 0.45, W * 0.45)
        add_blob(a, Vector((x, -D * rng.uniform(0.42, 0.62), 0)), (rng.uniform(0.8, 1.6),) * 2 + (rng.uniform(0.5, 1.0),), 2, seed + 10 + i,
                 nexp=2.6, na=0.3, cuts=3, tone=rng.uniform(0.35, 0.65))
    return a

def build_boulder(name, seed, size, kind="strata"):
    a = Asset(name, seed)
    add_blob(a, Vector((0, 0, 0)), size, 3, seed, nexp=2.6, sf=1.8 / max(size[2], 1) * 1.2, sa=0.14, na=0.28, cuts=4, tone=0.5, clip=-0.15)
    if kind == "mossy":
        for i in range(5):
            ang = a.rng.uniform(0, TAU)
            add_blob(a, Vector((math.cos(ang) * size[0] * 0.3, math.sin(ang) * size[1] * 0.3, size[2] * 0.75)), (0.5, 0.5, 0.2), 1, seed + i, mat=M_GROWTH, tone=3, na=0.3, cuts=0, clip=-1)
    return a

def build_scree(name, seed):
    a = Asset(name, seed); rng = a.rng
    for i in range(7):
        ang = rng.uniform(0, TAU); d = rng.uniform(0.0, 1.5) * (1 if i else 0)
        s = rng.uniform(0.35, 0.9) * (1.6 if i == 0 else 1)
        add_blob(a, Vector((math.cos(ang) * d, math.sin(ang) * d, 0)), (s, s * rng.uniform(0.7, 1.2), s * 0.6), 2, seed + i, nexp=2.6, na=0.3, cuts=3,
                 tone=rng.uniform(0.3, 0.7), clip=-0.05, mat=M_STRATA)
    return a

def crystal_mats(mix): return lambda i: M_CYAN if hash01(i, 5 + mix * 3) > (0.85 if mix else 0.0) else M_VIOLET

def build_crystal_cluster(name, seed, kind):
    a = Asset(name, seed)
    add_blob(a, Vector((0, 0, 0)), (2.6, 2.4, 0.7), 3, seed, nexp=2.8, sf=3.0, sa=0.12, na=0.25, cuts=3, tone=0.5, clip=-0.1)
    if kind == "cyan":
        add_cluster(a, Vector((0, 0, 0.25)), 20, 1.1, 0.7, 2.6, 0.16, lambda i: M_CYAN, tilt=0.65)
    elif kind == "violet":
        add_cluster(a, Vector((0, 0, 0.25)), 18, 1.0, 0.6, 2.2, 0.15, lambda i: M_VIOLET if i % 5 else M_CYAN, tilt=0.6)
    else:  # spire: one big lance with satellites
        add_cluster(a, Vector((0, 0, 0.2)), 14, 0.7, 1.2, 3.8, 0.24, lambda i: M_CYAN if i % 4 else M_VIOLET, tilt=0.28)
    return a

def build_geode(name, seed, mode):
    a = Asset(name, seed); rng = a.rng
    if mode == "a":   # boulder split open, crystal-lined pocket and vein
        add_blob(a, Vector((0, 0.3, 0)), (6.4, 4.4, 3.6), 4, seed, nexp=2.8, sf=1.4, sa=0.13, na=0.2, cuts=5, fissure=2, tone=0.5)
        add_blob(a, Vector((2.7, -0.3, 0)), (2.6, 2.8, 2.0), 3, seed + 1, nexp=2.8, sf=1.8, sa=0.13, cuts=4, tone=0.42)
        bm_ = a.bm; bm_.verts.ensure_lookup_table(); bvh = BVHTree.FromBMesh(bm_)
        # dark hollow + lining
        add_blob(a, Vector((-0.5, -1.6, 0.6)), (2.4, 1.4, 1.9), 3, seed + 5, nexp=2.2, na=0.16, cuts=0, mat=M_SCAR, tone=0.5, clip=0.2)
        add_cluster(a, Vector((-0.5, -1.7, 0.7)), 26, 1.0, 0.8, 2.5, 0.15, lambda i: M_CYAN if i % 6 else M_VIOLET, tilt=0.9, face=(0, -0.55))
        # vein of crystals across the front face, oriented to the surface normal
        for i in range(11):
            f = i / 10
            o = Vector((lerp(-3.0, 2.5, f), -6, lerp(0.7, 2.7, f)))
            hit, nrm, _, _ = bvh.ray_cast(o, Vector((0, 1, 0)))
            if hit is None: continue
            L = 0.5 + 1.4 * math.sin(f * math.pi) + rng.uniform(0, 0.4)
            add_crystal(a, hit - nrm * 0.15, nrm * 0.8 + Vector((0, 0, 0.5)), 0.13 * (0.7 + L * 0.3), L, mat=M_CYAN if i % 4 else M_VIOLET)
        add_cluster(a, Vector((-1.6, 0.6, 3.2)), 8, 0.5, 0.6, 1.5, 0.12, lambda i: M_CYAN, tilt=0.5)
    else:   # slab with a vertical crystalline seam
        add_blob(a, Vector((0, 0, 0)), (5.0, 2.6, 5.4), 4, seed, nexp=3.6, sf=1.3, sa=0.14, na=0.2, cuts=5, fissure=2, taper=0.2, tone=0.55, lean=(0.5, 0))
        add_blob(a, Vector((-2.3, -0.5, 0)), (2.4, 2.0, 2.4), 3, seed + 1, nexp=3.0, sf=2, sa=0.13, cuts=3, tone=0.4)
        a.bm.verts.ensure_lookup_table(); bvh = BVHTree.FromBMesh(a.bm)
        for i in range(16):
            f = i / 15
            o = Vector((0.4 + 0.3 * math.sin(f * 4), -5, lerp(0.5, 4.6, f)))
            hit, nrm, _, _ = bvh.ray_cast(o, Vector((0, 1, 0)))
            if hit is None: continue
            L = 0.5 + 1.6 * math.sin(f * math.pi) ** 1.2 + rng.uniform(0, 0.35)
            add_crystal(a, hit - nrm * 0.15, nrm + Vector((0, 0, 0.25 * (f - 0.5))), 0.12 + 0.05 * L, L, mat=M_VIOLET if i % 5 == 2 else M_CYAN)
        add_cluster(a, Vector((0.6, -1.4, 0.1)), 9, 0.5, 0.5, 1.3, 0.11, lambda i: M_CYAN, tilt=0.6, face=(0, -0.35))
    return a

def build_meteor(name, seed, big):
    a = Asset(name, seed); rng = a.rng
    if big:
        add_blob(a, Vector((0, 0, 0)), (4.2, 3.4, 2.4), 4, seed, nexp=2.2, na=0.28, nf=1.7, cuts=8, fissure=3, tone=0.5, mat=M_SCAR, clip=-0.4)
        add_blob(a, Vector((1.8, -1.2, 0)), (1.8, 1.5, 1.2), 3, seed + 1, nexp=2.4, na=0.3, cuts=6, tone=0.6, mat=M_SCAR, clip=-0.2)
        add_blob(a, Vector((-2.0, 1.1, 0)), (1.6, 1.4, 1.0), 3, seed + 2, nexp=2.4, na=0.3, cuts=6, tone=0.4, mat=M_SCAR, clip=-0.2)
        add_cluster(a, Vector((0.3, -0.2, 1.7)), 7, 0.5, 0.35, 0.9, 0.08, lambda i: M_CYAN, tilt=0.5, tone=0.3)  # star-crystal in the fissure
        n = 6
    else:
        add_blob(a, Vector((0, 0, 0)), (1.5, 1.2, 0.9), 3, seed, nexp=2.2, na=0.32, cuts=7, fissure=1, tone=0.5, mat=M_SCAR, clip=-0.1)
        n = 4
    for i in range(n):  # splash debris in the same fused rock
        ang = rng.uniform(0, TAU); d = (2.6 if big else 1.0) * rng.uniform(0.8, 1.4); s = rng.uniform(0.25, 0.6) * (1.6 if big else 0.9)
        add_blob(a, Vector((math.cos(ang) * d, math.sin(ang) * d, 0)), (s, s * 0.8, s * 0.6), 2, seed + 20 + i, nexp=2.2, na=0.3, cuts=4, tone=rng.random(), mat=M_SCAR, clip=-0.05)
    return a

def build_crater(name, seed):
    a = Asset(name, seed); rng = a.rng
    prof = [(8.4, 0.0, 0.0), (7.4, 0.14, 0.15), (6.5, 0.5, 0.5), (5.9, 0.78, 0.75), (5.2, 0.5, 0.55), (4.2, 0.0, 0.85), (3.0, -0.26, 1.0), (1.5, -0.32, 1.0), (0.0, -0.33, 1.0)]
    N = 40; t = new_tmp(a); rings = []
    for pi_, (r, h, cv) in enumerate(prof):
        ring = []
        for i in range(N):
            ang = i * TAU / N
            nz = fbm(Vector((math.cos(ang) * 2, math.sin(ang) * 2, pi_ * 0.3)), seed, 3)
            rr = r * (1 + 0.10 * nz) if r > 0 else 0.0
            hh = h * (1 + 0.5 * nz) + 0.06 * fbm(Vector((math.cos(ang) * 5, math.sin(ang) * 5, pi_)), seed + 2, 2)
            if pi_ == 0: hh = 0.0
            if r == 0:
                v = t.verts.new(Vector((0, 0, hh))) if i == 0 else ring[0]
            else:
                v = t.verts.new(Vector((math.cos(ang) * rr, math.sin(ang) * rr, hh)))
            setl(t, v, cav=cv * 0.7, tone=0.5, jit=hash01(i + pi_ * 40, seed))
            ring.append(v)
        rings.append(ring)
    for k in range(len(prof) - 1):
        for i in range(N):
            j = (i + 1) % N
            try:
                if prof[k + 1][0] == 0: t.faces.new((rings[k][j], rings[k][i], rings[k + 1][0]))
                else: t.faces.new((rings[k][j], rings[k][i], rings[k + 1][i], rings[k + 1][j]))
            except ValueError: pass
    merge(a, t, M_SCAR); t.free()
    for i in range(12):   # ejecta blocks on the rim
        ang = TAU * i / 12 + rng.uniform(-0.2, 0.2); d = rng.uniform(5.6, 7.0); s = rng.uniform(0.6, 1.5)
        add_blob(a, Vector((math.cos(ang) * d, math.sin(ang) * d, 0.2)), (s, s * 0.85, s * 0.7), 2, seed + i, nexp=2.4, sf=2, sa=0.1, na=0.3, cuts=4,
                 mat=M_SCAR if i % 3 else M_STRATA, tone=rng.random(), clip=-0.2)
    return a

def build_mined_face(name, seed):
    a = Asset(name, seed); rng = a.rng
    add_blob(a, Vector((0, 0.5, 0)), (7.6, 4.6, 5.2), 4, seed, nexp=4.2, sf=1.4, sa=0.12, na=0.16, cuts=3, tone=0.5)
    for i in range(4):     # quarried steps: worked-stone benches cut into the face
        w = 5.4 - i * 0.4; z = i * 0.62
        add_box(a, Vector((0.0, -2.2 + i * 0.35, z)), (w, 1.4, 0.62), bevel=0.05, wear=0.03, seed=seed + i, tone=0.35 + i * 0.1)
    for i in range(3):
        add_box(a, Vector((-3.0 + i * 3.0, -1.8, 2.5)), (2.4, 0.9, 1.4), bevel=0.06, wear=0.04, seed=seed + 10 + i, tone=0.7)
    for i in range(22):   # feather-and-wedge drill holes
        row = i // 11; k = i % 11
        p = Vector((-2.4 + k * 0.5, -2.18 + 0.3 * row * 0, 2.2 + row * 1.05 + 0.0))
        add_cyl(a, p + Vector((0, -0.02, 0)), p + Vector((0, 0.15, 0)), 0.045, 0.045, 6, mat=M_SCAR, tone=0.3, caps=(True, False))
    return a

def build_block_pile(name, seed):
    a = Asset(name, seed); rng = a.rng
    for i in range(9):
        x = rng.uniform(-1.6, 1.6); y = rng.uniform(-1.0, 1.0); layer = 0 if i < 5 else 1 if i < 8 else 2
        s = (rng.uniform(0.7, 1.2), rng.uniform(0.6, 0.9), rng.uniform(0.45, 0.7))
        add_box(a, Vector((x * (0.7 if layer else 1), y * (0.7 if layer else 1), layer * 0.55)), s, yaw=rng.uniform(-0.7, 0.7),
                tilt=(rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)), bevel=0.05, wear=0.04, seed=seed + i, tone=rng.random())
    for i in range(6):
        ang = rng.uniform(0, TAU)
        add_blob(a, Vector((math.cos(ang) * 1.9, math.sin(ang) * 1.5, 0)), (0.5, 0.45, 0.3), 2, seed + 30 + i, cuts=3, tone=rng.random(), clip=-0.05)
    # a single cyan ore chip in the spoil
    add_crystal(a, Vector((0.4, 0.5, 0.6)), Vector((0.3, 0.2, 1)), 0.09, 0.5, mat=M_CYAN)
    return a

def build_paving(name, seed):
    a = Asset(name, seed); rng = a.rng
    cols = [(-1.05, 0.9), (0.15, 1.0), (1.2, 0.8)]   # 3 lanes of irregular flags
    for lane, (x, w) in enumerate(cols):
        z = -2.0
        while z < 2.0 - 0.3:
            L = rng.uniform(0.75, 1.3); L = min(L, 2.0 - z)
            if rng.random() > 0.12:   # occasional missing flag
                add_box(a, Vector((x + rng.uniform(-0.05, 0.05), -(z + L / 2), 0)), (w * rng.uniform(0.86, 1.0), 0, 0) if False else (w * rng.uniform(0.86, 0.98), L * 0.93, 0.09),
                        yaw=rng.uniform(-0.05, 0.05), tilt=(rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02)), bevel=0.028, wear=0.012,
                        seed=seed * 5 + int(z * 7) + lane, tone=rng.random())
            z += L + 0.05
    return a

def build_waystone(name, seed):
    a = Asset(name, seed)
    add_box(a, Vector((0, 0, 0)), (1.1, 1.1, 0.32), bevel=0.04, wear=0.03, seed=seed, tone=0.45)
    add_box(a, Vector((0, 0, 0.3)), (0.7, 0.7, 1.9), bevel=0.05, wear=0.025, seed=seed + 1, tone=0.6, taper=0.22)
    add_box(a, Vector((0.03, 0, 2.1)), (0.62, 0.62, 0.22), bevel=0.04, wear=0.02, seed=seed + 2, tone=0.5, yaw=0.3)
    add_crystal(a, Vector((0, -0.34, 1.35)), Vector((0, -0.7, 0.55)), 0.09, 0.55, mat=M_CYAN)   # inset lantern shard on the route-facing side
    add_crystal(a, Vector((0, 0, 2.3)), Vector((0.1, 0, 1)), 0.1, 0.55, mat=M_CYAN)
    return a

def build_column(name, seed, fallen):
    a = Asset(name, seed); rng = a.rng
    if not fallen:
        add_box(a, Vector((0, 0, 0)), (1.5, 1.5, 0.4), bevel=0.05, wear=0.03, seed=seed, tone=0.5)
        z = 0.4
        for i in range(3):
            h = 1.0 if i < 2 else 0.7
            add_cyl(a, Vector((rng.uniform(-0.03, 0.03), 0, z)), Vector((rng.uniform(-0.03, 0.03), 0, z + h)), 0.5 - i * 0.03, 0.48 - i * 0.03, 12, tone=0.4 + i * 0.1, wob=0.03)
            z += h + 0.02
        add_cyl(a, Vector((0.05, 0, z)), Vector((0.1, 0, z + 0.35)), 0.42, 0.36, 12, tone=0.5, wob=0.09)
        add_box(a, Vector((1.4, 0.3, 0)), (0.9, 0.7, 0.5), yaw=0.5, bevel=0.05, seed=seed + 4, tone=0.5)
    else:
        for i in range(4):
            x = -2.2 + i * 1.25 + rng.uniform(-0.1, 0.1)
            add_cyl(a, Vector((x, 0.25 * i, 0.5)), Vector((x + 1.05, 0.25 * i + 0.1, 0.52)), 0.5 - i * 0.02, 0.5 - i * 0.02, 12, tone=0.35 + 0.12 * i, wob=0.03)
        add_box(a, Vector((-2.8, 0.3, 0)), (1.3, 1.3, 0.35), yaw=0.2, bevel=0.05, seed=seed, tone=0.5)
        for i in range(5):
            add_blob(a, Vector((rng.uniform(-2.5, 2.5), rng.uniform(-1, 1.6), 0)), (0.4, 0.35, 0.25), 2, seed + i, cuts=3, tone=rng.random(), clip=-0.05)
    return a

def build_observatory(name, seed):
    a = Asset(name, seed); rng = a.rng
    # plinth: two worn tiers plus a staircase on the -Y (front) side
    add_box(a, Vector((0, 0, 0)), (15.0, 6.4, 0.5), bevel=0.06, wear=0.05, seed=seed, tone=0.35)
    add_box(a, Vector((0, 0.2, 0.5)), (12.6, 5.4, 0.42), bevel=0.06, wear=0.05, seed=seed + 1, tone=0.5)
    for i in range(6):
        add_box(a, Vector((0, -3.3 - i * 0.28 + 0.0, 0)), (4.2 - i * 0.08, 0.55, 0.92 - i * 0.16), bevel=0.04, wear=0.02, seed=seed + 5 + i, tone=0.4 + 0.05 * i)
    z0 = 0.92; cy = 0.5
    # drum of individually chipped ashlar blocks with door and windows and a broken crown
    NB, NC, RI, RO, CH = 22, 9, 2.9, 3.6, 0.62
    for c in range(NC):
        for b in range(NB):
            ang = b * TAU / NB; dang = TAU / NB
            azf = math.degrees(math.atan2(math.sin(ang), math.cos(ang)))   # -90 = front
            fr = abs(((azf + 90 + 180) % 360) - 180)
            if fr < 17 and c < 5: continue                        # doorway
            if (abs(((azf) + 180) % 360 - 180) < 12 or abs((azf - 180 + 180) % 360 - 180) < 12 or abs(azf - 180) < 12 or abs(azf + 180) < 12 or abs(azf) < 12) and c in (3, 4): continue   # slit windows
            tall = 0.5 + 0.5 * math.sin(ang + 2.3)                 # highest to the back-left
            lim = 4 + int(tall * 5.5 + 0.9 * fbm(Vector((b * 0.4, 0, 3)), seed, 1))
            if c >= min(NC, lim): continue
            if c == NC - 1 and hash01(b, seed) < 0.45: continue
            add_wedge(a, RI, RO, ang + 0.006, ang + dang - 0.006, z0 + c * CH + 0.01, z0 + (c + 1) * CH - 0.01, Vector((0, cy, 0)),
                      tone=0.25 + 0.55 * hash01(b * 13 + c, seed), jit=0.02, seed=b * 9 + c)
    # lintel over the door
    add_box(a, Vector((0, cy - 3.25, z0 + 5 * CH)), (1.9, 0.9, 0.45), bevel=0.05, wear=0.03, seed=seed + 60, tone=0.55)
    # dome ribs and ring beam (only fragments survive)
    zt = z0 + NC * CH - 0.15; R = 3.25
    front = -90
    for k, phi_d in enumerate([-90 + 34, -90 + 68, -90 + 105, -90 + 140, 90, -90 - 34, -90 - 68, -90 - 105, -90 - 140]):
        phi = math.radians(phi_d)
        t_end = math.radians(rng.choice([46, 58, 66, 74, 82]) if k not in (4, 3) else 86)
        pts = []
        steps = 9
        for s in range(steps + 1):
            tt = t_end * s / steps
            pts.append(Vector((R * math.cos(tt) * math.cos(phi), cy + R * math.cos(tt) * math.sin(phi), zt + R * math.sin(tt) * 1.08)))
        add_sweep(a, pts, 0.26, 0.36, Vector((-math.sin(phi), math.cos(phi), 0)), tone=0.3 + 0.4 * rng.random(), taper=0.7)
    for arc0, arc1 in ((-90 + 30, -90 + 150), (-90 - 30, -90 - 120)):
        pts = []
        for s in range(11):
            an = math.radians(lerp(arc0, arc1, s / 10)); tt = math.radians(30)
            pts.append(Vector((R * math.cos(tt) * math.cos(an), cy + R * math.cos(tt) * math.sin(an), zt + R * math.sin(tt) * 1.08)))
        add_sweep(a, pts, 0.3, 0.22, Vector((0, 0, 1)), tone=0.5)
    # the great telescope thrust through the dome slit, on a cradle
    p0 = Vector((0, cy + 0.6, zt - 0.6)); p1 = Vector((0, cy - 4.4, zt + 4.6))
    add_cyl(a, p0, p1, 0.5, 0.36, 12, tone=0.12, wob=0.02)
    for i in range(3):
        m = lerp(0.25, 0.85, i / 2); q = p0.lerp(p1, m)
        add_cyl(a, q - (p1 - p0).normalized() * 0.08, q + (p1 - p0).normalized() * 0.08, 0.6 - i * 0.05, 0.6 - i * 0.05, 12, tone=0.7)
    add_cyl(a, p1 - (p1 - p0).normalized() * 0.02, p1 + (p1 - p0).normalized() * 0.4, 0.38, 0.42, 12, tone=0.3, caps=(False, True))
    add_box(a, Vector((-1.0, cy + 0.5, z0)), (0.35, 0.35, 2.6), tone=0.5, bevel=0.03, seed=seed + 70)
    add_box(a, Vector((1.0, cy + 0.5, z0)), (0.35, 0.35, 2.6), tone=0.5, bevel=0.03, seed=seed + 71)
    # flanking colonnade stubs of varied height and a fallen lintel
    for i, (x, y, h) in enumerate([(-6.2, -1.6, 3.9), (-6.2, 1.3, 2.4), (6.2, -1.6, 4.6), (6.2, 1.3, 1.5), (-4.4, -2.2, 3.0), (4.4, -2.2, 2.0)]):
        add_box(a, Vector((x, y, 0.92)), (0.95, 0.95, 0.28), bevel=0.04, wear=0.02, seed=seed + 80 + i, tone=0.5)
        add_cyl(a, Vector((x, y, 1.2)), Vector((x + 0.04 * i, y, 1.2 + h)), 0.36, 0.33, 10, tone=0.35 + 0.08 * i, wob=0.04)
        if h > 3: add_box(a, Vector((x, y, 1.2 + h)), (0.95, 0.95, 0.24), bevel=0.04, seed=seed + 90 + i, tone=0.5, yaw=0.2)
    add_box(a, Vector((-3.7, -1.9, 1.0)), (3.4, 0.6, 0.5), yaw=0.35, tilt=(0.0, 0.12), bevel=0.05, wear=0.04, seed=seed + 100, tone=0.55)
    for i in range(10):   # rubble on the platform
        add_box(a, Vector((rng.uniform(-6.0, 6.0), rng.uniform(-2.4, 2.2), 0.92)), (rng.uniform(0.3, 0.8), rng.uniform(0.3, 0.6), rng.uniform(0.2, 0.4)), yaw=rng.uniform(0, 3),
                bevel=0.03, wear=0.04, seed=seed + 110 + i, tone=rng.random())
    # nature reclaiming it: crystal seams bursting through the plinth and ring
    add_cluster(a, Vector((5.0, 2.0, 0.85)), 16, 0.9, 1.2, 4.2, 0.22, lambda i: M_CYAN if i % 4 else M_VIOLET, tilt=0.55, face=(0.15, -0.15))
    add_cluster(a, Vector((-5.7, 2.3, 0.85)), 11, 0.8, 0.8, 2.8, 0.18, lambda i: M_CYAN, tilt=0.6)
    add_cluster(a, Vector((cy, cy + 3.1, z0 + 0.4)), 10, 0.6, 0.7, 2.2, 0.15, lambda i: M_CYAN if i % 3 else M_VIOLET, tilt=0.5, face=(0, -0.2))
    # impact scar: fused meteor splash near the plinth foot
    add_blob(a, Vector((7.3, -2.2, 0)), (2.0, 1.8, 1.1), 3, seed + 130, nexp=2.2, na=0.3, cuts=6, mat=M_SCAR, tone=0.5, clip=-0.1)
    return a

# vegetation ----------------------------------------------------------
def build_tussock(name, seed):
    a = Asset(name, seed); rng = a.rng
    for i in range(22):
        ang = rng.uniform(0, TAU); d = rng.uniform(0, 0.16)
        add_blade(a, Vector((math.cos(ang) * d, math.sin(ang) * d, 0)), rng.uniform(0.35, 0.85), rng.uniform(0.035, 0.06), rng.uniform(0.2, 0.7), ang + rng.uniform(-0.5, 0.5), tone=0 if i % 6 else 4)
    return a

def build_shrub(name, seed):
    a = Asset(name, seed); rng = a.rng
    for i in range(5):
        ang = TAU * i / 5 + rng.uniform(-0.3, 0.3)
        p1 = Vector((math.cos(ang) * 0.5, math.sin(ang) * 0.5, rng.uniform(0.5, 0.9)))
        add_cyl(a, Vector((0, 0, 0)), p1, 0.05, 0.02, 5, mat=M_GROWTH, tone=2, caps=(False, False), par0=0.1, par1=0.6)
        for k in range(6):
            q = p1 * rng.uniform(0.5, 1.0) + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0))
            add_card(a, q, rng.uniform(0.28, 0.42), rng.uniform(0, TAU), rng.uniform(0.9, 1.5), tone=1, par=rng.uniform(0.3, 0.9))
        add_card(a, p1, 0.32, ang, 1.2, tone=4 if i == 2 else 1, par=0.9)
    return a

def build_cushion(name, seed):
    a = Asset(name, seed)
    add_blob(a, Vector((0, 0, 0)), (1.0, 0.9, 0.36), 2, seed, nexp=2.2, na=0.35, nf=3.0, cuts=0, mat=M_GROWTH, tone=3, clip=-0.05)
    add_blob(a, Vector((0.55, 0.3, 0)), (0.6, 0.55, 0.26), 2, seed + 1, nexp=2.2, na=0.3, nf=3.0, cuts=0, mat=M_GROWTH, tone=3, clip=-0.05)
    for i in range(6):
        add_crystal(a, Vector((a.rng.uniform(-0.3, 0.3), a.rng.uniform(-0.3, 0.3), 0.3)), Vector((0.1, 0, 1)), 0.02, 0.14, mat=M_CYAN, sides=5, tone=0.9)
    return a

def build_deadpine(name, seed):
    a = Asset(name, seed); rng = a.rng
    pts = []
    for i in range(9):
        f = i / 8
        pts.append(Vector((1.3 * f * f + 0.15 * math.sin(f * 7), 0.2 * math.sin(f * 5), 4.4 * f)))
    for i in range(8):
        r0 = 0.28 * (1 - i / 8) ** 0.8 + 0.05; r1 = 0.28 * (1 - (i + 1) / 8) ** 0.8 + 0.05
        add_cyl(a, pts[i], pts[i + 1], r0, r1, 7, mat=M_GROWTH, tone=2, caps=(i == 0, i == 7), par0=i / 8 * 0.5, par1=(i + 1) / 8 * 0.5 + 0.05, wob=0.18)
    for i in range(3):    # exposed roots gripping the rock
        ang = TAU * i / 3 + 0.4
        add_cyl(a, Vector((0, 0, 0.35)), Vector((math.cos(ang) * 0.9, math.sin(ang) * 0.9, 0.0)), 0.12, 0.04, 5, mat=M_GROWTH, tone=2, caps=(False, False), par0=0.2, par1=0.4)
    for i in range(6):    # wind-swept branches (all trailing downwind = +X)
        s = 0.35 + 0.1 * i; q = pts[min(8, 2 + i)]
        e = q + Vector((1.5 + rng.uniform(0, 0.5), rng.uniform(-0.4, 0.4), rng.uniform(-0.1, 0.4)))
        add_cyl(a, q, e, 0.045, 0.012, 5, mat=M_GROWTH, tone=2, caps=(False, False), par0=0.2, par1=0.55)
        for k in range(5):
            add_card(a, q.lerp(e, 0.4 + 0.12 * k), 0.34, math.atan2(e.y - q.y, e.x - q.x) - math.pi / 2 + rng.uniform(-0.6, 0.6), rng.uniform(0.7, 1.4), tone=1, par=rng.uniform(0.25, 0.7))
    return a

# ---------------------------------------------------------------- ground skin
KEEP = [(-12, 3, 1.9, "crystal ore"), (-4, -6, 1.9, "crystal ore"), (4, 3, 1.9, "crystal ore"), (12, -6, 1.9, "crystal ore"),
        (-10, -17, 1.9, "iron ore"), (0, -17, 1.9, "iron ore"), (10, -17, 1.9, "iron ore"),
        (-13, -8, 1.3, "grapple anchor pole"), (0, -8, 1.3, "grapple anchor pole"), (13, -8, 1.3, "grapple anchor pole"),
        (6, -12, 2.4, "golem"), (-7, -21, 2.4, "skeleton"), (0, -19, 1.8, "bomb barrier")]
CRATER = (16.5, 11.0)

def in_corridor(x, z, half=3.6): return abs(x) < half and -23.0 < z < 24.0
def keep_dist(x, z):
    return min(math.hypot(x - kx, z - kz) - kr for kx, kz, kr, _ in KEEP)

def ground_height(x, z):
    d = math.hypot(x - CRATER[0], z - CRATER[1])
    h = 0.0
    ex = smooth(4.5, 10.0, abs(x)) * (0.30 * (fbm(Vector((x / 7, z / 7, 1)), 5, 3) + 0.5))
    h += ex * smooth(1.6, 3.5, keep_dist(x, z)) * (0 if in_corridor(x, z, 4.2) else 1)
    m = max(abs(x), abs(z))
    if m > 23.0: h += (m - 23.0) ** 1.4 * 0.32
    h -= 0.32 * (1 - smooth(1.5, 4.6, d))
    return h

def ground_color(x, z):
    n1 = fbm(Vector((x / 9, z / 9, 0.3)), 11, 3); n2 = fbm(Vector((x / 3.2, z / 3.2, 0.9)), 12, 2); n3 = fbm(Vector((x / 1.4, z / 1.4, 2.0)), 13, 2)
    base = lerpc((0.30, 0.34, 0.45), (0.42, 0.41, 0.42), smooth(-0.3, 0.5, n1))
    base = lerpc(base, (0.52, 0.45, 0.36), 0.35 * smooth(0.1, 0.6, n2))              # ochre iron-stained scree
    base = lerpc(base, (0.20, 0.22, 0.30), 0.4 * smooth(0.2, 0.7, -n1))               # damp shadow hollows
    base = lerpc(base, (0.54, 0.54, 0.60), 0.35 * smooth(0.3, 0.7, n3) * (1 - smooth(-0.1, 0.4, n1)))  # pale gravel flecks
    px = abs(x)
    path = (1 - smooth(1.7, 3.6, px)) * smooth(-21.5, -16, z) * (1 - smooth(22, 26, z)) if z > -20 else 0
    base = lerpc(base, (0.60, 0.58, 0.56), 0.55 * path)                                 # worn dust along the route
    base = lerpc(base, (0.20, 0.19, 0.20), 0.3 * smooth(3.4, 2.4, px) * 0 + 0.25 * smooth(3.4, 4.4, px) * (1 - smooth(4.4, 6.0, px)) * (1 if z > -20 else 0))
    d = math.hypot(x - CRATER[0], z - CRATER[1])
    base = lerpc(base, (0.12, 0.11, 0.12), 0.85 * (1 - smooth(5.0, 11.5, d)))         # scorched blast zone
    base = lerpc(base, (0.36, 0.20, 0.12), 0.35 * smooth(4, 9, d) * (1 - smooth(9, 14, d)) * smooth(0, 0.6, n2))
    # trail of the incoming meteor toward the crater (from north-west, along the +Z side)
    ax, az = (CRATER[0] - 6.0, CRATER[1] + 6.5)
    tx, tz = CRATER[0] - ax, CRATER[1] - az
    tl = math.hypot(tx, tz); tx /= tl; tz /= tl
    proj = (x - ax) * tx + (z - az) * tz; per = abs((x - ax) * -tz + (z - az) * tx)
    if 0 < proj < tl: base = lerpc(base, (0.11, 0.10, 0.11), 0.55 * (1 - smooth(0.4, 1.6, per)) * smooth(0, tl, proj))
    for kx, kz, kr, lab in KEEP[:7]:                                                    # ores glint on a pale, worked pad
        dd = math.hypot(x - kx, z - kz)
        base = lerpc(base, (0.50, 0.52, 0.58), 0.35 * (1 - smooth(1.6, 3.2, dd)))
    edge = smooth(22.0, 27.0, max(abs(x), abs(z)))
    base = lerpc(base, (0.20, 0.22, 0.30), 0.5 * edge)
    return tuple(x_ * (0.93 + 0.14 * n3) for x_ in base)

def build_ground(name, seed):
    a = Asset(name, seed)
    t = new_tmp(a); N = 41; S = 33.0 * 2 / (N - 1)
    vs = []
    for j in range(N):
        row = []
        for i in range(N):
            x = -33 + i * S; z = -33 + j * S
            v = t.verts.new(G2B(x, ground_height(x, z) + 0.0, z))
            setl(t, v, tone=0.5, par=0.0, jit=hash01(i * N + j, 2)); row.append(v)
        vs.append(row)
    for j in range(N - 1):
        for i in range(N - 1):
            # G2B maps increasing Godot Z to negative Blender Y. Reverse the
            # grid winding so its visible face points upward.
            t.faces.new((vs[j][i], vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1]))
    merge(a, t, M_STRATA); t.free()
    return a

# ---------------------------------------------------------------- build all assets
def build_all(mats):
    B = {}
    specs = [
        ("cliff_a", lambda: build_cliff("cliff_a", 11, (9.0, 4.6, 9.5), "a")),
        ("cliff_b", lambda: build_cliff("cliff_b", 12, (8.2, 4.2, 8.0), "b")),
        ("cliff_c", lambda: build_cliff("cliff_c", 13, (7.0, 4.4, 15.0), "c")),
        ("cliff_shelf", lambda: build_cliff("cliff_shelf", 14, (9.5, 5.0, 4.2), "s")),
        ("boulder_a", lambda: build_boulder("boulder_a", 21, (3.0, 2.6, 2.1))),
        ("boulder_b", lambda: build_boulder("boulder_b", 22, (2.0, 1.8, 1.6), "mossy")),
        ("boulder_c", lambda: build_boulder("boulder_c", 23, (1.2, 1.0, 0.8))),
        ("scree", lambda: build_scree("scree", 24)),
        ("geode_seam_a", lambda: build_geode("geode_seam_a", 31, "a")),
        ("geode_seam_b", lambda: build_geode("geode_seam_b", 32, "b")),
        ("crystal_cluster_cyan", lambda: build_crystal_cluster("crystal_cluster_cyan", 41, "cyan")),
        ("crystal_cluster_violet", lambda: build_crystal_cluster("crystal_cluster_violet", 42, "violet")),
        ("crystal_spire", lambda: build_crystal_cluster("crystal_spire", 43, "spire")),
        ("meteor_fragment_large", lambda: build_meteor("meteor_fragment_large", 51, True)),
        ("meteor_fragment_small", lambda: build_meteor("meteor_fragment_small", 52, False)),
        ("crater_rim", lambda: build_crater("crater_rim", 53)),
        ("mined_face", lambda: build_mined_face("mined_face", 61)),
        ("mined_block_pile", lambda: build_block_pile("mined_block_pile", 62)),
        ("observatory", lambda: build_observatory("observatory", 71)),
        ("ruin_column", lambda: build_column("ruin_column", 72, False)),
        ("ruin_column_fallen", lambda: build_column("ruin_column_fallen", 73, True)),
        ("waystone", lambda: build_waystone("waystone", 74)),
        ("paving_a", lambda: build_paving("paving_a", 81)),
        ("paving_b", lambda: build_paving("paving_b", 82)),
        ("tussock", lambda: build_tussock("tussock", 91)),
        ("shrub", lambda: build_shrub("shrub", 92)),
        ("cushion", lambda: build_cushion("cushion", 93)),
        ("deadpine", lambda: build_deadpine("deadpine", 94)),
        ("ground_skin", lambda: build_ground("ground_skin", 99)),
    ]
    for name, fn in specs:
        t1 = time.time(); a = fn(); mesh = finish(a, mats); B[name] = mesh
        print(f"  built {name:24s} tris={sum(len(p.vertices) - 2 for p in mesh.polygons):6d}  {time.time() - t1:.1f}s", flush=True)
    return B

# ---------------------------------------------------------------- layout
def layout(B, bounds):
    P = []; rng = random.Random(SEED + 1)
    def put(asset, x, z, yaw=0.0, scale=1.0, y=0.0):
        P.append({"asset": asset, "position": [round(x, 3), round(y, 3), round(z, 3)], "yaw_degrees": round(yaw, 2), "scale": round(scale, 3)})
    put("ground_skin", 0, 0)
    put("crater_rim", CRATER[0], CRATER[1], 0, 0.85, y=0.0)
    # route: flagstones from the arrival to the barrier
    for i in range(10):
        put("paving_a" if i % 2 == 0 else "paving_b", 0.0, 20.0 - 4.0 * i, 0 if i % 3 else 180, 1.0, y=0.012)
    put("waystone", 4.7, 17.5, 25); put("waystone", -4.7, 10.5, -20); put("waystone", 4.7, -1.5, 15)
    put("waystone", -4.7, -12.5, -10); put("waystone", 4.7, -14.5, 30)
    # rim: west wall (faces +X), east wall (faces -X), north wall (faces +Z), south (arrival) wall (faces -Z)
    types = ["cliff_a", "cliff_b", "cliff_c", "cliff_a", "cliff_b"]
    for i, z in enumerate([20, 10.5, 1, -8.5, -18]):
        put(types[i], -25.5 + rng.uniform(-0.6, 0.6), z, 90 + rng.uniform(-9, 9), rng.uniform(0.95, 1.25))
        put(types[(i + 2) % 5], 25.5 + rng.uniform(-0.6, 0.6), z + 3 * rng.uniform(-1, 1), -90 + rng.uniform(-9, 9), rng.uniform(0.95, 1.25))
    for i, x in enumerate([-24, -17.5, 17.5, 24]):
        put(["cliff_c", "cliff_a", "cliff_b", "cliff_c"][i], x, 27.0 + rng.uniform(-0.5, 0.5), 180 + rng.uniform(-10, 10), rng.uniform(0.9, 1.15))
    for x, t in [(-24.5, "cliff_a"), (-16.5, "cliff_b"), (-11.0, "cliff_shelf"), (11.0, "cliff_shelf"), (16.5, "cliff_a"), (24.5, "cliff_b")]:
        put(t, x, -28.5 + rng.uniform(-0.4, 0.4), rng.uniform(-8, 8), rng.uniform(1.0, 1.3))
    put("cliff_c", -7.0, -34.0, 0, 1.6); put("cliff_c", 8.0, -35.0, 10, 1.7); put("cliff_c", 0.0, -38.0, 0, 1.9)   # skyline behind the observatory
    for x, z, yw in [(-27, -27, 45), (27, -27, -45), (-27, 27, 135), (27, 27, -135)]: put("cliff_c", x, z, yw, 1.1)
    # inner buttress shoulders that funnel the eye to the barrier
    put("cliff_shelf", -13.5, -23.5, 25, 0.75); put("cliff_shelf", 13.5, -23.5, -25, 0.75)
    put("cliff_shelf", -20.5, 21.5, 120, 0.8); put("cliff_shelf", 21.0, 21.5, -120, 0.8)
    # focal ruin
    put("observatory", 0.0, -26.2, 0, 1.0)
    for x, sc in [(-4.2, 1.5), (4.0, 1.8)]: put("crystal_spire", x, -31.0, rng.uniform(0, 360), sc, y=0)
    put("ruin_column", -9.6, -23.0, 40, 1.0); put("ruin_column", 9.2, -23.3, -20, 1.15)
    put("ruin_column_fallen", -8.2, -14.2, 25, 1.0); put("ruin_column_fallen", 8.5, 17.0, -35, 0.9)
    # geode/seam landmarks with sightlines from the path
    put("geode_seam_a", 19.8, -1.5, -90, 1.15); put("geode_seam_b", -20.0, 8.0, 90, 1.15)
    put("geode_seam_b", 20.5, -11.5, -90, 0.85); put("geode_seam_a", -20.5, -9.5, 90, 0.9)
    put("mined_face", -22.0, -1.8, 90, 1.0); put("mined_block_pile", -17.2, -4.0, 40, 1.0); put("mined_block_pile", 15.5, -14.8, -25, 1.0)
    put("mined_block_pile", -9.0, 20.0, 80, 0.9)
    # meteor: fall track leading into the crater
    put("meteor_fragment_large", CRATER[0] + 0.6, CRATER[1] - 0.3, 20, 1.0, y=-0.5)
    tr = [(-0.4, 0.35), (-0.24, 0.55), (-0.08, 0.4), (0.12, 0.6)]
    for k, (f, sc) in enumerate(tr):
        put("meteor_fragment_small", lerp(CRATER[0] - 6.0, CRATER[0] - 1.0, (f + 0.4) / 0.6) + rng.uniform(-0.6, 0.6), lerp(CRATER[1] + 6.5, CRATER[1] + 1.0, (f + 0.4) / 0.6) + rng.uniform(-0.6, 0.6), rng.uniform(0, 360), sc * 1.4, y=-0.05)
    put("meteor_fragment_small", -17.0, -13.5, 70, 1.0); put("meteor_fragment_small", 7.5, 19.5, 20, 0.7)
    # crystals: cyan cradles behind each ore, violet accents, all off the ore pads and corridor
    for ox, oz, side in [(-12, 3, -1), (-4, -6, -1), (4, 3, 1), (12, -6, 1)]:
        put("scree", ox + side * 2.6, oz + 1.0, rng.uniform(0, 360), 0.9)
        put("crystal_cluster_cyan" if ox in (-12, 4) else "crystal_cluster_violet", ox + side * 3.4, oz - 2.6, rng.uniform(0, 360), 0.8 + rng.random() * 0.4)
    for ox in (-10, 0, 10):
        put("scree", ox + (-2.6 if ox < 1 else 2.6) if ox else 2.7, -15.0, rng.uniform(0, 360), 0.8)
    for x, z, t in [(-8.5, 14.0, "crystal_cluster_cyan"), (9.0, 6.5, "crystal_cluster_violet"), (-8.0, -3.0, "crystal_cluster_cyan"), (9.5, -9.5, "crystal_cluster_cyan"),
                    (-16.5, 14.5, "crystal_cluster_violet"), (15.5, -2.5, "crystal_cluster_violet"), (-15.0, -15.0, "crystal_cluster_cyan"), (13.0, 19.5, "crystal_cluster_cyan")]:
        put(t, x, z, rng.uniform(0, 360), rng.uniform(0.9, 1.4))
    # boulders: larger on the flanks, smaller near the route, none in the keep zones
    def ok(x, z, r):
        if in_corridor(x, z, 3.4 + r): return False
        if keep_dist(x, z) < r + 0.6: return False
        if math.hypot(x - CRATER[0], z - CRATER[1]) < 5.0: return False
        if abs(x) < 13 and z < -21.0: return False
        for p in P:
            if p["asset"] in ("ground_skin", "paving_a", "paving_b", "crater_rim") or p["asset"].startswith("cliff"): continue
            q = p["position"]; rr = FOOT.get(p["asset"], 1.0) * p["scale"]
            if math.hypot(x - q[0], z - q[2]) < r + rr * 0.8: return False
        return True
    placed = 0; tries = 0
    while placed < 44 and tries < 4000:
        tries += 1
        x = rng.uniform(-24, 24); z = rng.uniform(-22, 25); big = rng.random() < 0.38
        a_ = "boulder_a" if big else rng.choice(["boulder_b", "boulder_c", "boulder_b"])
        sc = rng.uniform(0.8, 1.5) if big else rng.uniform(0.8, 1.4)
        if abs(x) < 9 and big: continue
        if ok(x, z, FOOT.get(a_, 1) * sc):
            put(a_, x, z, rng.uniform(0, 360), sc, y=-0.05); placed += 1
    # vegetation
    def vsite(r, near_rock=False):
        for _ in range(60):
            x = rng.uniform(-25, 25); z = rng.uniform(-23, 25)
            if in_corridor(x, z, 3.4 + r): continue
            if keep_dist(x, z) < r + 0.5: continue
            if math.hypot(x - CRATER[0], z - CRATER[1]) < 6.0: continue
            if abs(x) < 8 and z < -21.0: continue
            if near_rock and max(abs(x), abs(z)) < 15: continue
            return x, z
        return None
    for c in range(34):   # tussock clumps
        s = vsite(0.5)
        if not s: continue
        for k in range(rng.randint(2, 4)):
            put("tussock", s[0] + rng.uniform(-1.3, 1.3), s[1] + rng.uniform(-1.3, 1.3), rng.uniform(0, 360), rng.uniform(0.8, 1.4))
    for c in range(20):
        s = vsite(0.8, True)
        if s: put("shrub", s[0], s[1], rng.uniform(0, 360), rng.uniform(0.85, 1.4))
    for c in range(26):
        s = vsite(0.5)
        if s: put("cushion", s[0], s[1], rng.uniform(0, 360), rng.uniform(0.8, 1.5))
    for x, z in [(-17.5, 16.0), (18.5, -8.0), (-19.0, -15.0), (13.0, 22.5), (-13.5, 24.0), (20.5, 4.0), (-21.0, -4.0), (22.0, -18.0)]:
        put("deadpine", x, z, rng.uniform(-30, 30) + 180 * (x > 0), rng.uniform(0.9, 1.5))
    return P

FOOT = {}
ASSET_FILES = {}

# ---------------------------------------------------------------- export / render / docs
def tri_count(mesh): return sum(len(p.vertices) - 2 for p in mesh.polygons)

def asset_bounds(mesh):
    xs = [B2G(v.co) for v in mesh.vertices]
    mn = [min(p[i] for p in xs) for i in range(3)]; mx = [max(p[i] for p in xs) for i in range(3)]
    return mn, mx

def export_all(B):
    col = bpy.data.collections.new("_export"); bpy.context.scene.collection.children.link(col)
    for name, mesh in B.items():
        ob = bpy.data.objects.new(name, mesh); col.objects.link(ob)
        # Removing the previous export object can leave a stale null proxy in
        # view_layer.objects until Blender refreshes its depsgraph.
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True); bpy.context.view_layer.objects.active = ob
        path = os.path.join(HERE, name + ".glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                                  export_image_format="JPEG", export_jpeg_quality=90, export_texcoords=True, export_normals=True,
                                  export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
                                  export_vertex_color="MATERIAL", export_all_vertex_colors=False)
        bpy.data.objects.remove(ob)
    bpy.data.collections.remove(col)

def make_scene(name):
    sc = bpy.data.scenes.new(name); return sc

def setup_world(sc, sky=(0.42, 0.50, 0.72), strength=1.0):
    w = bpy.data.worlds.new(sc.name + "_world"); w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld"); bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord"); gr = nt.nodes.new("ShaderNodeTexGradient"); ramp = nt.nodes.new("ShaderNodeValToRGB")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Rotation"].default_value = (0, math.radians(-90), 0)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], gr.inputs["Vector"])
    nt.links.new(gr.outputs["Fac"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (*lin((0.62, 0.66, 0.80)), 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (*lin((0.34, 0.45, 0.72)), 1)
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sc.world = w

def add_light_cam(sc, cam_loc, cam_target, lens=28, sun_rot=(math.radians(52), 0, math.radians(-35)), sun_e=3.2, ortho=None):
    sun = bpy.data.lights.new("sun", "SUN"); sun.energy = sun_e; sun.color = (1.0, 0.90, 0.78); sun.angle = math.radians(2.5)
    so = bpy.data.objects.new("sun", sun); so.rotation_euler = sun_rot; sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam"); cam.lens = lens; cam.clip_end = 400
    if ortho: cam.type = "ORTHO"; cam.ortho_scale = ortho
    co = bpy.data.objects.new("cam", cam); co.location = cam_loc; sc.collection.objects.link(co)
    d = Vector(cam_target) - Vector(cam_loc); co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = co; return co

def render(sc, path, w=1400, h=780, samples=48):
    r = sc.render
    r.resolution_x, r.resolution_y = w, h; r.filepath = path; r.image_settings.file_format = "PNG"
    try: r.engine = "BLENDER_EEVEE_NEXT"
    except TypeError: r.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = samples
    sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
    bpy.context.window.scene = sc
    bpy.ops.render.render(write_still=True, scene=sc.name)

def main():
    print("== Starfall Ridge build ==", flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = np.random.default_rng(SEED)
    tex = {k: build_texture_set(k, n, np.random.default_rng(SEED + i)) for i, (k, n) in enumerate(
        [("strata", 512), ("worked", 512), ("scar", 512), ("growth", 256), ("crystal", 256)])}
    mats = [make_material("SF_Strata", tex["strata"]), make_material("SF_Worked", tex["worked"], spec=0.4),
            make_material("SF_Scar", tex["scar"], spec=0.6),
            make_material("SF_Growth", tex["growth"], double_sided=True, spec=0.25),
            make_material("SF_Crystal_Cyan", tex["crystal"], emit=(0.06, 0.24, 0.34), spec=0.9),
            make_material("SF_Crystal_Violet", tex["crystal"], emit=(0.16, 0.06, 0.28), spec=0.9)]
    print(f"textures+materials {time.time() - T0:.1f}s", flush=True)
    B = build_all(mats)
    bounds = {}
    for n, m in B.items():
        mn, mx = asset_bounds(m); bounds[n] = (mn, mx)
        FOOT[n] = max(mx[0] - mn[0], mx[2] - mn[2]) * 0.4
    FOOT["observatory"] = 4.0
    P = layout(B, bounds)
    # ---- validation of gameplay keep-outs
    warn = []
    for p in P:
        a = p["asset"]
        if a in ("ground_skin", "paving_a", "paving_b", "crater_rim", "observatory") or a.startswith("cliff"): continue
        x, _, z = p["position"]; r = FOOT[a] * p["scale"] * 0.6
        kd = keep_dist(x, z)
        if kd < r: warn.append((a, x, z, round(kd, 2)))
        if in_corridor(x, z, 3.2 + r * 0.5) and a not in ("waystone",): warn.append((a, x, z, "corridor"))
    print("keep-out warnings:", warn, flush=True)
    files = {n: n + ".glb" for n in B}
    json.dump({"schema": 1, "assets": files, "placements": P}, open(os.path.join(HERE, "placement.json"), "w"), indent=1)
    # ---- export
    export_all(B)
    print(f"exported {time.time() - T0:.1f}s", flush=True)
    # ---- stats
    from collections import Counter
    cnt = Counter(p["asset"] for p in P)
    stats = {"schema": 1, "seed": SEED, "blender": bpy.app.version_string, "materials": MATS, "assets": {}, "placements_total": len(P)}
    tot = 0; inst = 0
    for n, m in B.items():
        mn, mx = bounds[n]; tc = tri_count(m)
        if n != "ground_skin": tot_add = tc
        tot += tc; inst += tc * cnt[n]
        stats["assets"][n] = {"triangles": tc, "vertices": len(m.vertices), "materials_used": sorted({m.materials[p.material_index].name for p in m.polygons}),
                              "bounds_godot_min": [round(v, 3) for v in mn], "bounds_godot_max": [round(v, 3) for v in mx],
                              "size_m": [round(mx[i] - mn[i], 3) for i in range(3)], "placements": cnt[n],
                              "glb_bytes": os.path.getsize(os.path.join(HERE, n + ".glb"))}
    stats["unique_triangles_total"] = tot; stats["rendered_triangles_all_instances"] = inst
    stats["textures"] = {k: [im.name for im in v] for k, v in tex.items()}
    stats["build_seconds"] = round(time.time() - T0, 1)
    json.dump(stats, open(os.path.join(HERE, "stats.json"), "w"), indent=1)
    sf_collision.update_manifest(os.path.join(HERE, "placement.json"))
    print(f"unique tris {tot}, instanced tris {inst}, placements {len(P)}", flush=True)
    write_collision(P, B, bounds)
    # ---- scenes for the .blend and previews
    build_scenes(B, P, bounds)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "starfall_ridge.blend"))
    print(f"saved blend {time.time() - T0:.1f}s", flush=True)
    if not NO_RENDER: render_previews()
    print(f"done {time.time() - T0:.1f}s", flush=True)

def write_collision(P, B, bounds):
    intent = {
        "schema": 1,
        "note": "Gameplay collision stays Codex-owned. This manifest states art intent only; positions/yaws come from placement.json. Local axes are Godot (X sideways, Y up, Z toward arrival = asset front).",
        "floor": "Keep the existing flat floor collider at y=0. ground_skin is a visual replacement (hide the old uniform floor mesh). Outside |x|>4.2 it rises up to 0.3 m of relief and, beyond 23 m from centre, up to ~2.5 m in the cliff berm, so no collision is required there; the crater bowl dips 0.32 m (visual only).",
        "keep_clear": [{"x": x, "z": z, "radius": r, "reason": lab} for x, z, r, lab in KEEP] + [
            {"aabb_x": [-3.6, 3.6], "aabb_z": [-23.0, 24.0], "reason": "primary travel corridor; nothing solid inside, both sides of the barrier open"}],
        "assets": {
            "cliff_a": {"mode": "convex_box_proxy", "proxy": "one 0.6*W x 0.5*D x 0.9*H box centred on the module; rim only, players never reach it"},
            "cliff_b": {"mode": "convex_box_proxy", "proxy": "as cliff_a"}, "cliff_c": {"mode": "convex_box_proxy", "proxy": "as cliff_a, tall"},
            "cliff_shelf": {"mode": "convex_box_proxy", "proxy": "single low box, top surface ~0.6*H; may be used as a step-up ledge"},
            "boulder_a": {"mode": "convex_hull_single", "proxy": "one convex hull from the mesh (<=64 points)"},
            "boulder_b": {"mode": "convex_hull_single", "proxy": "one convex hull"}, "boulder_c": {"mode": "none_or_hull", "proxy": "small; hull optional, hands may pass"},
            "scree": {"mode": "none", "proxy": "decor only, below ankle-height mostly"},
            "geode_seam_a": {"mode": "box_proxy", "proxy": "body box 6.4x3.6 (Godot X x Y) x 4.4 Z at the rock only, exclude crystal spikes"},
            "geode_seam_b": {"mode": "box_proxy", "proxy": "body box 5.0 x 5.4 x 2.6, exclude crystal spikes"},
            "crystal_cluster_cyan": {"mode": "none", "proxy": "decor; crystals never collide so hands are not trapped. Natural crystal only."},
            "crystal_cluster_violet": {"mode": "none", "proxy": "decor"}, "crystal_spire": {"mode": "none", "proxy": "decor; backdrop skyline, outside playable area"},
            "meteor_fragment_large": {"mode": "convex_hull_single", "proxy": "hull of the main mass (radius ~2.1 m), impact-scarred rock"},
            "meteor_fragment_small": {"mode": "none_or_hull", "proxy": "optional small hull"},
            "crater_rim": {"mode": "none", "proxy": "visual ring lip <=0.8 m; optional low ring of box proxies on the rim only, never in the bowl"},
            "mined_face": {"mode": "box_proxy", "proxy": "back mass box + 4 stepped benches as thin boxes; worked/quarried stone"},
            "mined_block_pile": {"mode": "box_proxy", "proxy": "3 boxes; worked stone spoil"},
            "observatory": {"mode": "compound_simple", "proxy": "plinth = 2 boxes (15x6.4x0.5, 12.6x5.4x0.9 top) with a walkable stair on the +Z front; drum = 8-12 thin box segments 0.7 m thick with the +Z doorway left open (1.9 m wide, 3.1 m high); dome ribs, telescope, colonnade stubs, crystals and rubble = NO collision. Sits behind the barrier centred (0,-26.2)."},
            "ruin_column": {"mode": "cylinder", "proxy": "single cylinder r=0.5 h=3.5"}, "ruin_column_fallen": {"mode": "box_proxy", "proxy": "one box 4.2x1.0x1.0"},
            "waystone": {"mode": "box_proxy", "proxy": "single box 0.7x2.2x0.7; worked stone marker at the corridor edge (|x|=4.7)"},
            "paving_a": {"mode": "none", "proxy": "visual flagstones <=0.09 m proud of the floor"}, "paving_b": {"mode": "none", "proxy": "as paving_a"},
            "tussock": {"mode": "none", "proxy": "decor"}, "shrub": {"mode": "none", "proxy": "decor"}, "cushion": {"mode": "none", "proxy": "decor"},
            "deadpine": {"mode": "capsule", "proxy": "trunk capsule r=0.25 h=3.5 only; branches decor"},
            "ground_skin": {"mode": "none", "proxy": "visual; keep flat collider"}},
        "material_classes": {"SF_Strata": "natural sedimentary rock", "SF_Worked": "cut / mined / ruin stone (pale ashlar, chisel marks)",
                             "SF_Scar": "impact-scarred fused rock (dark, glassy, rust)", "SF_Growth": "weathered highland vegetation (double sided)",
                             "SF_Crystal_Cyan": "naturally occurring crystal (weak emissive)", "SF_Crystal_Violet": "naturally occurring crystal (weak emissive)"}}
    json.dump(intent, open(os.path.join(HERE, "collision_intent.json"), "w"), indent=1)

def build_scenes(B, P, bounds):
    global LAY, KIT, ORDER
    LAY = bpy.data.scenes.new("Layout"); KIT = bpy.data.scenes.new("Kit")
    lc = bpy.data.collections.new("Layout"); LAY.collection.children.link(lc)
    for i, p in enumerate(P):
        ob = bpy.data.objects.new(f"{p['asset']}.{i:03d}", B[p["asset"]])
        ob.location = G2B(*p["position"]); ob.rotation_euler = (0, 0, math.radians(p["yaw_degrees"])); ob.scale = (p["scale"],) * 3
        lc.objects.link(ob)
    setup_world(LAY)
    kc = bpy.data.collections.new("Kit"); KIT.collection.children.link(kc)
    big = ["cliff_a", "cliff_b", "cliff_c", "cliff_shelf", "observatory", "geode_seam_a", "geode_seam_b", "meteor_fragment_large", "mined_face", "crater_rim"]
    small = [n for n in B if n not in big and n != "ground_skin"]
    ORDER = (big, small)
    for grp, sp, cols, off in ((big, 19.0, 5, 0.0), (small, 6.0, 8, 200.0)):
        for i, n in enumerate(grp):
            ob = bpy.data.objects.new("kit_" + n, B[n]); ob.location = ((i % cols) * sp + off, -(i // cols) * sp * 0.9, 0); kc.objects.link(ob)
    gp = bpy.data.objects.new("kit_ground", B["ground_skin"]); gp.location = (0, 0, -0.02); gp.scale = (0.001, 0.001, 0.001)
    setup_world(KIT)

def render_previews():
    sc = LAY
    def cam(loc_g, tgt_g, lens=24, **kw):
        for o in [o for o in sc.objects if o.name in ("cam", "sun")]: bpy.data.objects.remove(o)
        return add_light_cam(sc, G2B(*loc_g), G2B(*tgt_g), lens=lens, **kw)
    jobs = [("preview_ground_arrival", (0.8, 1.7, 24.0), (0, 2.4, -22), 21),
            ("preview_ground_midroute", (2.0, 1.7, 5.0), (-2, 2.8, -20), 22),
            ("preview_overhead", (0.0, 118.0, -2.0), (0, 0, -1.0), 30),
            ("preview_rts_oblique", (0.0, 40.0, 50.0), (0, 0, -8.0), 30),
            ("preview_observatory_focal", (-9, 3.0, -8.0), (0.5, 5.0, -26.0), 34),
            ("preview_geode_and_ore", (12.5, 1.7, 3.0), (-12.0, 1.8, 3.0), 30),
            ("preview_meteor_crater", (5.0, 2.0, 21.0), (17.0, 0.4, 11.0), 30)]
    for name, loc, tgt, lens in jobs:
        cam(loc, tgt, lens=lens, ortho=None); render(sc, os.path.join(PREV_DIR, name + ".png"))
        print("rendered", name, f"{time.time() - T0:.1f}s", flush=True)
    sc = KIT
    for name, (cx, cy, z_, sc_ortho) in (("preview_kit_large", (47.0, -20.0, 0.0, 120), ), ("preview_kit_small", (245.0, -13.0, 0, 62))):
        pass
    for o in [o for o in sc.objects if o.name in ("cam", "sun")]: bpy.data.objects.remove(o)
    add_light_cam(sc, Vector((47.0, -95.0, 32.0)), Vector((47.0, -14.0, 5.0)), lens=32, sun_rot=(math.radians(55), 0, math.radians(-30)))
    render(sc, os.path.join(PREV_DIR, "preview_kit_large.png"), 1600, 800)
    for o in [o for o in sc.objects if o.name in ("cam", "sun")]: bpy.data.objects.remove(o)
    add_light_cam(sc, Vector((242.0, -34.0, 18.0)), Vector((242.0, -6.0, 1.2)), lens=34, sun_rot=(math.radians(55), 0, math.radians(-30)))
    render(sc, os.path.join(PREV_DIR, "preview_kit_small.png"), 1600, 800)

if __name__ == "__main__":
    main()
