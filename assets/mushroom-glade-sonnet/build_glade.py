"""Mushroom Glade kit builder. Run: blender --background --python build_glade.py"""
import bpy, bmesh, math, os, sys, json, random
import numpy as np
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
TEX = os.path.join(OUT, "textures")
os.makedirs(TEX, exist_ok=True)
STAGE = os.environ.get("GLADE_STAGE", "all")

# ---------------------------------------------------------------- textures
def fbm(size, seed, octaves=5, base=4):
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size)); amp = 1.0; tot = 0
    for o in range(octaves):
        g = base * 2 ** o
        grid = rng.random((g, g))
        xs = np.linspace(0, g, size, endpoint=False)
        i0 = xs.astype(int); f = xs - i0; i1 = (i0 + 1) % g
        f = f * f * (3 - 2 * f)
        rows = grid[i0][:, :] * (1 - f)[:, None] + grid[i1][:, :] * f[:, None]
        cols = rows[:, i0] * (1 - f)[None, :] + rows[:, i1] * f[None, :]
        acc += cols * amp; tot += amp; amp *= 0.5
    return acc / tot

def save_tex(name, rgb, size=512):
    rgb = np.clip(rgb, 0, 1)
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = np.ones((size, size, 4)); px[..., :3] = rgb
    img.pixels = px[::-1].ravel().tolist()
    img.filepath_raw = os.path.join(TEX, name + ".png")
    img.file_format = "PNG"; img.save()
    img.pack()
    return img

def mix(a, b, t):
    return np.array(a)[None, None, :] * (1 - t[..., None]) + np.array(b)[None, None, :] * t[..., None]

def make_textures():
    S = 512
    n1, n2, n3 = fbm(S, 1), fbm(S, 2, 6, 8), fbm(S, 3, 4, 2)
    yy, xx = np.mgrid[0:S, 0:S] / S
    T = {}
    # violet cap with cream spots and a warm-to-deep gradient
    cap = mix((0.34, 0.12, 0.55), (0.62, 0.30, 0.82), n1)
    rng = np.random.default_rng(7)
    for _ in range(46):
        cx, cy, r = rng.random(), rng.random(), rng.uniform(0.008, 0.028)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                d = np.hypot(xx - cx + ox, yy - cy + oy)
                m = np.clip((r - d) / (r * 0.35), 0, 1)
                cap = cap * (1 - m[..., None] * 0.9) + np.array([0.98, 0.9, 0.78]) * m[..., None] * 0.9
    cap *= (0.85 + 0.3 * n2[..., None])
    T["cap"] = save_tex("tex_cap", cap)
    # stem/gill cream with vertical fibres
    fib = fbm(S, 5, 4, 3); streak = np.sin(xx * 220 + fib * 8) * 0.5 + 0.5
    stem = mix((0.78, 0.68, 0.55), (0.95, 0.88, 0.76), 0.6 * streak * 0.5 + 0.5 * n3)
    T["stem"] = save_tex("tex_stem", stem)
    # mossy stone
    moss = np.clip((n1 - 0.45) * 4, 0, 1) * np.clip(n2 * 1.6 - 0.2, 0, 1)
    stone = mix((0.36, 0.38, 0.40), (0.55, 0.55, 0.52), n2)
    crack = (np.abs(fbm(S, 9, 4, 6) - 0.5) < 0.012).astype(float)
    stone = stone * (1 - crack[..., None] * 0.5)
    stone = stone * (1 - moss[..., None]) + mix((0.16, 0.36, 0.14), (0.35, 0.58, 0.2), n3) * moss[..., None]
    T["stone"] = save_tex("tex_stone", stone)
    # bark / roots
    st = np.sin(xx * 60 + n1 * 10) * 0.5 + 0.5
    bark = mix((0.20, 0.12, 0.07), (0.42, 0.28, 0.16), st * 0.6 + n2 * 0.4)
    mo = np.clip((n3 - 0.55) * 4, 0, 1)
    bark = bark * (1 - mo[..., None] * 0.6) + np.array([0.2, 0.42, 0.16]) * mo[..., None] * 0.6
    T["bark"] = save_tex("tex_bark", bark)
    # water
    rip = np.sin((xx * 14 + n1 * 3) * math.tau) * np.sin((yy * 14 + n2 * 3) * math.tau)
    water = mix((0.05, 0.28, 0.38), (0.25, 0.75, 0.75), np.clip(0.5 + 0.35 * rip, 0, 1) * 0.6 + n1 * 0.4)
    T["water"] = save_tex("tex_water", water)
    # glow: soft dots on dim teal, used as emissive + base
    g = np.zeros((S, S)); rng = np.random.default_rng(11)
    for _ in range(60):
        cx, cy, r = rng.random(), rng.random(), rng.uniform(0.02, 0.05)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                d = np.hypot(xx - cx + ox, yy - cy + oy)
                g = np.maximum(g, np.clip(1 - d / r, 0, 1) ** 1.5)
    glow = mix((0.5, 0.9, 0.85), (1.0, 0.96, 0.6), np.clip(n1 * 0.7 + g * 0.5, 0, 1))
    T["glow"] = save_tex("tex_glow", glow)
    return T

# ---------------------------------------------------------------- materials
def make_material(name, img, rough=0.8, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit
    return m

MATS = {}
def build_materials():
    T = make_textures()
    MATS["cap"] = make_material("M_MushroomCap", T["cap"], 0.55)
    MATS["stem"] = make_material("M_StemGill", T["stem"], 0.7)
    MATS["stone"] = make_material("M_MossStone", T["stone"], 0.9)
    MATS["bark"] = make_material("M_RootBark", T["bark"], 0.9)
    MATS["water"] = make_material("M_Water", T["water"], 0.15, 0.35)
    MATS["glow"] = make_material("M_Spore", T["glow"], 0.5, 2.5)

# ---------------------------------------------------------------- geometry
class Geo:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []
    def add(self, verts, faces, uvs):
        o = len(self.v); self.v += verts; self.uv += uvs
        self.f += [tuple(i + o for i in f) for f in faces]
    def tris(self):
        return sum(len(f) - 2 for f in self.f)

def lathe(profile, n=16, jitter=0.0, seed=0, wob=None, uvscale=(1, 1)):
    """profile: list of (r, z); axis at r=0 closes the ends. Returns verts, faces, uvs."""
    rng = random.Random(seed); verts, uvs, faces = [], [], []
    m = len(profile)
    for j, (r, z) in enumerate(profile):
        for i in range(n + 1):
            a = math.tau * i / n
            rr = r * (1 + (wob(a) if wob else 0)) if r > 0 else 0
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
            uvs.append((i / n * uvscale[0], j / (m - 1) * uvscale[1]))
    for j in range(m - 1):
        for i in range(n):
            a = j * (n + 1) + i; b = a + 1; c = a + n + 1; d = c + 1
            if profile[j][0] == 0:
                faces.append((a, d, c))      # degenerate start collapses to tri
            elif profile[j + 1][0] == 0:
                faces.append((a, b, c))
            else:
                faces.append((a, b, d, c))
    return verts, faces, uvs

def xform(verts, pos=(0, 0, 0), yaw=0.0, scale=(1, 1, 1), tilt=(0, 0)):
    cy, sy = math.cos(yaw), math.sin(yaw)
    ct, st = math.cos(tilt[0]), math.sin(tilt[0])
    cp, sp = math.cos(tilt[1]), math.sin(tilt[1])
    out = []
    for x, y, z in verts:
        x *= scale[0]; y *= scale[1]; z *= scale[2]
        y, z = y * ct - z * st, y * st + z * ct          # tilt about X
        x, z = x * cp + z * sp, -x * sp + z * cp         # tilt about Y
        out.append((x * cy - y * sy + pos[0], x * sy + y * cy + pos[1], z + pos[2]))
    return out

def mushroom(kind="a", seed=1, cap_r=0.5, height=0.9, lean=0.0, dome=1.0):
    """Returns dict material->Geo, local Z-up (converted on export)."""
    rng = random.Random(seed); G = {"cap": Geo(), "stem": Geo()}
    wob = lambda a, s=rng.uniform(0, 6): 0.06 * math.sin(3 * a + s) + 0.035 * math.sin(5 * a + s * 2)
    sr = cap_r * 0.2
    stem_prof = [(0, 0), (sr * 1.7, 0.0), (sr * 1.45, height * 0.08), (sr * 1.05, height * 0.4),
                 (sr * 0.9, height * 0.7), (sr * 1.0, height * 0.93), (0, height * 0.95)]
    v, f, u = lathe(stem_prof, 14, wob=lambda a: 0.05 * math.sin(2 * a + seed), uvscale=(2, 1))
    # ring (skirt) on the stem
    ring = [(0, height * 0.6), (sr * 1.5, height * 0.62), (sr * 1.55, height * 0.6), (sr * 1.0, height * 0.55), (0, height * 0.55)]
    v2, f2, u2 = lathe(ring, 14, uvscale=(2, .2))
    tilt = (lean, 0)
    G["stem"].add(xform(v, tilt=tilt), f, u)
    G["stem"].add(xform(v2, tilt=tilt), f2, u2)
    capz = height * 0.88
    hc = height * dome
    cap_prof = [(0, capz - 0.02), (cap_r * 0.35, capz - 0.04), (cap_r * 0.85, capz + 0.0),
                (cap_r * 1.0, capz + hc * 0.04), (cap_r * 0.97, capz + hc * 0.12),
                (cap_r * 0.8, capz + hc * 0.3), (cap_r * 0.5, capz + hc * 0.44),
                (cap_r * 0.22, capz + hc * 0.5), (0, capz + hc * 0.52)]
    v, f, u = lathe(cap_prof, 24, wob=wob, uvscale=(1, 1))
    # thicken underside so cap is a closed solid: add underside disc lip offset upward
    G["cap"].add(xform(v, tilt=tilt), f, u)
    # gills: radial fins under the cap, cream material
    nf = 36
    for k in range(nf):
        a = math.tau * k / nf; w = 0.035
        ri, ro = sr * 1.0, cap_r * 0.93 * (1 + wob(a))
        zt_i, zt_o = capz - 0.03, capz + 0.0
        zb_i, zb_o = capz - height * 0.12, capz - height * 0.045
        pts = []
        for s in (-w / 2, w / 2):
            ca, sa = math.cos(a), math.sin(a)
            pn = (-sa * s, ca * s)
            pts += [(ri * ca + pn[0], ri * sa + pn[1], zb_i), (ro * ca + pn[0], ro * sa + pn[1], zb_o),
                    (ro * ca + pn[0], ro * sa + pn[1], zt_o), (ri * ca + pn[0], ri * sa + pn[1], zt_i)]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        uvs = [(0.02 + 0.02 * (i % 2), 0.1 + 0.2 * (i // 2 % 2) + 0.4 * (i // 4)) for i in range(8)]
        G["stem"].add(xform(pts, tilt=tilt), faces, uvs)
    return G

def to_object(name, geo, mat, collection=None, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(geo.v, [], geo.f)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uv.data[li].uv = geo.uv[vi]
    if recalc:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = recalc
    me.materials.append(MATS[mat])
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob

def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_image_format="AUTO")

# ---------------------------------------------------------------- preview
def render_preview(path, loc, target, lens=50, size=(800, 600), sun_energy=3.5, samples=32, ground=None):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = size
    w = bpy.data.worlds.new("W"); w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.55, 0.65, 0.85, 1); bg.inputs[1].default_value = 1.0
    sc.world = w
    for o in [o for o in bpy.data.objects if o.name.startswith("_pv")]:
        bpy.data.objects.remove(o)
    ld = bpy.data.lights.new("_pvsun", "SUN"); ld.energy = sun_energy; ld.color = (1.0, 0.92, 0.8)
    so = bpy.data.objects.new("_pvsun", ld); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    cd = bpy.data.cameras.new("_pvcam"); cd.lens = lens; cd.clip_end = 300
    co = bpy.data.objects.new("_pvcam", cd); sc.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=ground, location=(0, 0, -0.02))
        g = bpy.context.object; g.name = "_pvground"
        gm = bpy.data.materials.new("_pvg"); gm.diffuse_color = (0.1, 0.2, 0.09, 1); gm.use_nodes = True
        gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.26, 0.42, 0.18, 1)
        g.data.materials.append(gm)
    sc.render.filepath = path; sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    for o in [o for o in bpy.data.objects if o.name.startswith("_pv")]:
        bpy.data.objects.remove(o)


# ---------------------------------------------------------------- flat-face primitives
# Builder coordinates are (x, d, h): x sideways, d = Godot Z (depth), h = up. Stored as Blender (x, -d, h).
def cv(p): return (p[0], -p[1], p[2])

def newell(P):
    nx = ny = nz = 0.0
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1])
    return nx, ny, nz

def face(G, pts, ref, uvs=None, k=0.28, off=(0.0, 0.0), planar=False):
    P = [cv(p) for p in pts]
    n = newell(P); L = math.sqrt(sum(c * c for c in n))
    if L < 1e-9: return
    n = tuple(c / L for c in n)
    if ref[0] == "center":
        c = cv(ref[1]); cen = [sum(p[i] for p in P) / len(P) for i in range(3)]
        dvec = [cen[i] - c[i] for i in range(3)]
    else:
        dvec = cv(ref[1])
    if sum(n[i] * dvec[i] for i in range(3)) < 0:
        P.reverse(); n = tuple(-c for c in n)
        if uvs: uvs = uvs[::-1]
    if uvs is None:
        ax = 2 if planar else max(range(3), key=lambda i: abs(n[i]))
        uvs = []
        for p in P:
            if ax == 2: u, v = p[0], p[1]
            elif ax == 1: u, v = p[0], p[2]
            else: u, v = p[1], p[2]
            uvs.append((u * k + off[0], v * k + off[1]))
    G.add(P, [tuple(range(len(P)))], uvs)

def rot(x, d, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return x * c - d * s, x * s + d * c

def rock(G, x, d, rx, rd, rh, seed, sub=2, yaw=0.0, flatten=0.55):
    rng = random.Random(seed); ph = [rng.uniform(0, 6.28) for _ in range(5)]
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    pos = {}
    for v in bm.verts:
        n = v.co.normalized()
        dd = 1 + 0.18 * math.sin(3.1 * n.x + ph[0]) * math.cos(2.3 * n.y + ph[1]) + 0.1 * math.sin(5.3 * n.z + ph[2]) + 0.06 * math.sin(9 * n.x + 7 * n.y + ph[3])
        lx, ld = rot(n.x * dd * rx, n.y * dd * rd, yaw)
        pos[v.index] = (x + lx, d + ld, max(n.z * dd * rh + rh * flatten, 0.0))
    off = (rng.random(), rng.random())
    for f in bm.faces:
        pts = [pos[v.index] for v in f.verts]
        if all(p[2] <= 0.001 for p in pts): continue
        face(G, pts, ("center", (x, d, rh * 0.4)), off=off)
    bm.free()

def column(G, x, d, r, h, seed, sides=7, taper=0.85):
    rng = random.Random(seed); phi = rng.uniform(0, 6.28); off = (rng.random(), rng.random())
    rings = []
    for lv, rf in ((0.0, 1.08), (0.5, 1.0), (1.0, taper)):
        ring = []
        for i in range(sides):
            a = math.tau * i / sides; rr = r * rf * (1 + rng.uniform(-0.07, 0.07))
            hh = h * lv
            if lv == 1.0: hh = h * (0.86 + 0.14 * math.cos(a - phi))
            ring.append((x + rr * math.cos(a), d + rr * math.sin(a), hh))
        rings.append(ring)
    for j in range(2):
        for i in range(sides):
            i2 = (i + 1) % sides
            face(G, [rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]], ("center", (x, d, h * 0.5)), off=off)
    face(G, rings[2], ("dir", (0, 0, 1)), off=off, planar=True)

def slab(G, x, d, h0, sx, sd, sh, seed, yaw=0.0, jit=0.06):
    rng = random.Random(seed); off = (rng.random(), rng.random()); c = []
    for hh in (0, 1):
        for cx, cd in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, ld = rot(cx * sx / 2 + rng.uniform(-jit, jit), cd * sd / 2 + rng.uniform(-jit, jit), yaw)
            c.append((x + lx, d + ld, h0 + hh * sh + rng.uniform(-jit, jit) * hh))
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        face(G, [c[i] for i in f], ("center", (x, d, h0 + sh / 2)), off=off)

def tube(G, pts, radii, sides=6, seed=0):
    off = (random.Random(seed).random(), 0.3)
    P = [Vector(p) for p in pts]; rings = []
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        sd = t.cross(Vector((0, 0, 1)))
        if sd.length < 0.2: sd = Vector((1, 0, 0))
        sd.normalize(); up = sd.cross(t)
        rings.append([tuple(p + radii[i] * (math.cos(math.tau * k / sides) * sd + math.sin(math.tau * k / sides) * up)) for k in range(sides)])
    for i in range(len(P) - 1):
        mid = tuple((P[i] + P[i + 1]) / 2)
        for k in range(sides):
            k2 = (k + 1) % sides
            face(G, [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], ("center", mid), off=off)
    face(G, rings[-1], ("center", tuple(P[-2])), off=off)
    face(G, rings[0][::-1], ("center", tuple(P[1])), off=off)

def octa(G, x, d, h, r):
    p = [(x + r, d, h), (x - r, d, h), (x, d + r, h), (x, d - r, h), (x, d, h + r * 1.3), (x, d, h - r * 1.3)]
    for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
        for t in (4, 5):
            face(G, [p[a], p[b], p[t]], ("center", (x, d, h)), k=1.0, off=(0.3, 0.3))

def ribbon(G, pts, widths, facing, side=None, vk=0.25, ukc=0.5):
    L, R = [], []
    for i, p in enumerate(pts):
        if side: s = side
        else:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
            dx, dd = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dd) or 1
            s = (-dd / l, dx / l, 0)
        w = widths[i] / 2
        L.append((p[0] - s[0] * w, p[1] - s[1] * w, p[2])); R.append((p[0] + s[0] * w, p[1] + s[1] * w, p[2]))
    dist = 0.0
    for i in range(len(pts) - 1):
        d0 = dist; dist += math.dist(pts[i], pts[i + 1])
        face(G, [L[i], R[i], R[i + 1], L[i + 1]], ("dir", facing),
             uvs=[(0, d0 * vk), (ukc, d0 * vk), (ukc, dist * vk), (0, dist * vk)])

def blob_disc(G, x, d, h, R, segs=14, seed=0, facing=(0, 0, 1)):
    rng = random.Random(seed); ph = rng.uniform(0, 6)
    ring = [(x + R * (1 + 0.12 * math.sin(3 * math.tau * i / segs + ph)) * math.cos(math.tau * i / segs),
             d + R * (1 + 0.12 * math.sin(3 * math.tau * i / segs + ph)) * math.sin(math.tau * i / segs), h) for i in range(segs)]
    face(G, ring, ("dir", facing), k=0.15, planar=True)

# ---------------------------------------------------------------- assets
PIVOT_POND = (1.0, -3.0)
WISP = (-4.0, -4.0)
def pond_r(t):
    R = 3.2 * (1 + 0.12 * math.sin(2 * t + 0.8) + 0.08 * math.sin(3 * t + 2.0) + 0.05 * math.sin(5 * t + 1.0))
    dt = (t - 3.34 + math.pi) % math.tau - math.pi
    return R * (1 - 0.34 * math.exp(-(dt / 0.9) ** 2))

def asset_pond():
    G = {"water": Geo(), "stone": Geo(), "glow": Geo()}
    N = 44; rings = [0.0, 0.4, 0.75, 1.0]
    def pt(i, f, h):
        t = math.tau * i / N; r = pond_r(t) * f
        return (r * math.cos(t), r * math.sin(t), h)
    for j in range(len(rings) - 1):
        for i in range(N):
            quad = [pt(i, rings[j], .06), pt(i + 1, rings[j], .06), pt(i + 1, rings[j + 1], .06), pt(i, rings[j + 1], .06)]
            if j == 0: quad = [quad[0], quad[2], quad[3]]
            uv = [(p[0] * 0.14, p[1] * 0.14) for p in quad]
            face(G["water"], quad, ("dir", (0, 0, 1)), uvs=uv)
    prof = [(0.97, -0.02), (1.02, 0.12), (1.12, 0.24), (1.3, 0.13), (1.52, 0.0)]
    def q(ii, jj):
        t = math.tau * ii / N; r = pond_r(t) * prof[jj][0] * (1 + 0.05 * math.sin(7 * t + jj))
        return (r * math.cos(t), r * math.sin(t), prof[jj][1] * (1 + 0.3 * math.sin(4 * t)))
    for i in range(N):
        for j in range(len(prof) - 1):
            face(G["stone"], [q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)], ("dir", (0, 0, 1)), planar=True, k=0.3)
    rng = random.Random(21); placed = 0; tries = 0
    while placed < 16 and tries < 400:
        tries += 1; t = rng.uniform(0, math.tau); r = pond_r(t) * 1.33
        wx, wz = PIVOT_POND[0] + r * math.cos(t), PIVOT_POND[1] + r * math.sin(t)
        if abs(wx) < 2.2 or math.dist((wx, wz), WISP) < 3.2 or abs((t - 5.11 + math.pi) % math.tau - math.pi) < 0.45: continue
        s = rng.uniform(0.25, 0.7)
        rock(G["stone"], r * math.cos(t), r * math.sin(t), s * 1.2, s, s * 0.8, 50 + placed, sub=1, yaw=t)
        placed += 1
    for k in range(7):
        t = rng.uniform(0, math.tau); r = pond_r(t) * rng.uniform(0.2, 0.75)
        x, d = r * math.cos(t), r * math.sin(t)
        if abs(PIVOT_POND[0] + x) < 1.6: continue
        octa(G["glow"], x, d, 0.28, 0.11)
        tube(G["stone"], [(x, d, 0.05), (x, d, 0.28)], [0.02, 0.02], sides=3, seed=k)
    return G

def asset_stones():
    G = {"stone": Geo()}
    for k in range(8):
        x = 0.35 * math.sin(k * 1.15 + 0.4); d = -0.8 * k
        rock(G["stone"], x, d, 0.55 + 0.06 * (k % 3), 0.5, 0.2, 90 + k, sub=1, yaw=k, flatten=0.3)
    return G

def asset_rock(rx, rd, rh, seed, sub=2):
    def f():
        G = {"stone": Geo()}; rock(G["stone"], 0, 0, rx, rd, rh, seed, sub=sub); return G
    return f

def asset_rock_cluster():
    G = {"stone": Geo()}
    for k, (x, d, s) in enumerate(((0, 0, 0.7), (0.9, 0.4, 0.45), (-0.5, 0.8, 0.35), (0.4, -0.7, 0.3))):
        rock(G["stone"], x, d, s * 1.2, s, s * 0.9, 120 + k, sub=1, yaw=k)
    return G

def asset_root_sprawl():
    G = {"bark": Geo()}; rng = random.Random(4)
    for k in range(6):
        a = math.tau * k / 6 + rng.uniform(-0.2, 0.2); L = rng.uniform(1.3, 2.0)
        pts = []
        for i in range(6):
            t = i / 5; aa = a + 0.35 * math.sin(t * 4 + k)
            pts.append((t * L * math.cos(aa), t * L * math.sin(aa), 0.28 * (1 - t) ** 1.5 + 0.03 - 0.02 * t))
        tube(G["bark"], pts, [0.16 * (1 - i / 6) + 0.025 for i in range(6)], sides=5, seed=k)
    return G

def asset_root_arch():
    G = {"bark": Geo()}
    pts = [(-1.2, 0, -0.05), (-1.1, 0.1, 0.5), (-0.6, 0.15, 1.05), (0.0, 0.1, 1.25), (0.6, 0.0, 1.0), (1.1, -0.1, 0.45), (1.25, -0.1, -0.05)]
    tube(G["bark"], pts, [0.2, 0.17, 0.14, 0.12, 0.14, 0.17, 0.21], sides=6, seed=2)
    tube(G["bark"], [(-0.9, 0.5, -0.05), (-0.4, 0.4, 0.5), (0.1, 0.25, 0.8)], [0.1, 0.08, 0.06], sides=5, seed=5)
    return G

def asset_spores():
    G = {"glow": Geo()}; rng = random.Random(8)
    for _ in range(42):
        octa(G["glow"], rng.uniform(-2.5, 2.5), rng.uniform(-2.5, 2.5), rng.uniform(0.2, 2.8), rng.uniform(0.03, 0.075))
    return G

def asset_sprouts():
    G = {"stem": Geo(), "glow": Geo()}; rng = random.Random(9)
    for k in range(6):
        x, d, h = rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0.3, 0.6)
        tube(G["stem"], [(x, d, 0), (x + 0.04, d, h * 0.6), (x + 0.1, d, h)], [0.03, 0.022, 0.02], sides=4, seed=k)
        octa(G["glow"], x + 0.1, d, h + 0.07, 0.09)
    return G

def asset_mush(kind):
    def f():
        if kind == "cluster":
            G = {"cap": Geo(), "stem": Geo()}
            for i, (dx, dy, yw, s) in enumerate(((0, 0, 0, 1.0), (0.75, 0.35, 1.2, 0.6), (-0.6, 0.5, 2.5, 0.45), (0.2, -0.7, 4.0, 0.5))):
                M = mushroom(seed=10 + i, cap_r=0.42 * s, height=0.7 * s, lean=0.08 * i)
                for m in G: G[m].add(xform(M[m].v, pos=(dx, dy, 0), yaw=yw), M[m].f, M[m].uv)
            return G
        if kind == "a": return mushroom(seed=3)
        if kind == "b": return mushroom(seed=5, cap_r=0.62, height=0.62, dome=0.7)
        return mushroom(seed=7, cap_r=0.45, height=1.0, lean=0.16)
    return f

def asset_ruin_falls():
    G = {"stone": Geo(), "bark": Geo(), "water": Geo()}; S = G["stone"]
    xs = [-14, -10, -6, -2.5, 1.5, 4.5, 7.5, 11, 14.5]
    hs = [3.9, 4.6, 3.8, 3.5, 4.4, 3.2, 4.6, 4.1, 4.5]
    for i, (x, h) in enumerate(zip(xs, hs)):
        rock(S, x, -4.0, 3.3, 1.7, h, 200 + i, sub=2, yaw=0.3 * i)
    sheet = [(4.5, -3.2, 3.3), (4.5, -2.5, 3.25), (4.5, -2.2, 2.7), (4.5, -2.05, 1.8), (4.5, -1.95, 0.9), (4.5, -1.7, 0.3), (4.5, -1.3, 0.1)]
    ribbon(G["water"], sheet, [1.6, 1.8, 1.9, 1.9, 2.0, 2.1, 2.2], (0, 1, 0.3), side=(1, 0, 0), vk=0.3)
    blob_disc(G["water"], 4.5, -0.9, 0.07, 1.5, seed=3)
    stream = [(4.5, -1.0, 0.06), (4.6, 0.8, 0.06), (3.9, 2.8, 0.06), (3.0, 4.6, 0.06), (2.3, 6.4, 0.06)]
    ribbon(G["water"], stream, [1.2, 1.1, 1.1, 1.3, 1.5], (0, 0, 1), vk=0.3)
    for k, (x, d, s) in enumerate(((6.4, 0.6, .5), (2.4, -0.3, .6), (5.9, 3.4, .35), (1.6, 3.2, .4), (3.2, 0.2, .3))):
        rock(S, x, d, s * 1.2, s, s * 0.8, 230 + k, sub=1)
    column(S, -8.6, -1.6, 0.45, 3.6, 301); column(S, -5.2, -1.6, 0.45, 3.0, 302)
    slab(S, -7.4, -1.6, 3.6, 3.6, 0.8, 0.5, 303, yaw=0.06)
    slab(S, -11.6, -1.4, 0, 3.0, 0.7, 1.5, 304, yaw=0.35); slab(S, -12.4, 1.0, 0, 2.4, 0.7, 0.9, 305, yaw=-0.2)
    slab(S, -6.8, 0.5, 0, 3.2, 1.0, 0.28, 306); slab(S, -6.8, 1.3, 0, 2.4, 0.9, 0.16, 307)
    for k, (x, d) in enumerate(((-9.6, 1.0), (-3.7, 0.4), (-10.3, 3.2))):
        column(S, x, d, 0.4, 0.55, 310 + k, sides=8, taper=1.0)
    slab(S, 9.6, -1.2, 0, 3.2, 0.7, 2.2, 320, yaw=-0.18); column(S, 12.2, -0.6, 0.42, 2.4, 321); column(S, 8.0, 1.0, 0.4, 0.8, 322, sides=8)
    slab(S, 11.2, 1.2, 0, 2.0, 0.7, 0.7, 323, yaw=0.5)
    for k, x in enumerate((-4.8, -1.9, 2.3, 7.0, 10.5)):
        tube(G["bark"], [(x, -2.9, 4.1), (x + 0.3, -2.3, 2.8), (x + 0.1, -2.2, 1.3), (x + 0.5, -1.5, 0.05)], [0.2, 0.13, 0.1, 0.18], sides=5, seed=k)
    return G

ASSETS = {
    "mushroom_violet_tall": asset_mush("a"), "mushroom_violet_squat": asset_mush("b"),
    "mushroom_violet_lean": asset_mush("c"), "mushroom_cluster": asset_mush("cluster"),
    "pond_bank": asset_pond, "stepping_stones": asset_stones,
    "boulder_mossy_a": asset_rock(1.6, 1.4, 1.7, 401), "boulder_mossy_b": asset_rock(1.8, 1.2, 1.3, 402),
    "rock_cluster": asset_rock_cluster, "root_sprawl": asset_root_sprawl, "root_arch": asset_root_arch,
    "spore_cloud": asset_spores, "glow_sprouts": asset_sprouts, "ruin_waterfall": asset_ruin_falls,
}
FLAT = {k for k in ASSETS if not k.startswith("mushroom")}

PROXY = {
    "mushroom_violet_tall": [("cyl", 0, 0, 0.19)], "mushroom_violet_squat": [("cyl", 0, 0, 0.24)],
    "mushroom_violet_lean": [("cyl", 0, 0, 0.17)],
    "mushroom_cluster": [("cyl", 0, 0, 0.18), ("cyl", 0.75, -0.35, 0.1), ("cyl", -0.6, -0.5, 0.08)],
    "boulder_mossy_a": [("cyl", 0, 0, 1.3)], "boulder_mossy_b": [("cyl", 0, 0, 1.4)], "rock_cluster": [("cyl", 0, 0, 0.75)],
}
# ruin_waterfall placed at world (0,-12): world-space solids (x0,z0,x1,z1) or (x,z,r)
RUIN_PROXY = [("box", -15.5, -17.6, 15.5, -14.3), ("cyl", -8.6, -13.6, 0.5), ("cyl", -5.2, -13.6, 0.5),
              ("box", -13.3, -13.8, -9.9, -13.0), ("box", -13.6, -11.7, -11.2, -10.9),
              ("box", 8.0, -13.3, 11.2, -12.7), ("cyl", 12.2, -12.6, 0.48), ("box", 10.2, -11.5, 12.2, -10.5)]

def P(asset, x, z, yaw=0, s=1.0): return {"asset": asset, "position": [x, 0.0, z], "yaw_degrees": yaw, "scale": s}
PLACE = [P("ruin_waterfall", 0, -12), P("pond_bank", 1.0, -3.0, 0), P("stepping_stones", 0.4, -0.3, 0)]
PLACE += [P("mushroom_violet_tall", -11.5, -3.0, 30, 3.4), P("mushroom_violet_tall", 9.5, -8.5, 140, 3.0),
          P("mushroom_violet_tall", -12.8, 6.5, 260, 3.6), P("mushroom_violet_tall", 12.8, 3.0, 75, 2.8),
          P("mushroom_violet_squat", 7.6, -6.0, 200, 2.6), P("mushroom_violet_squat", -7.0, -7.5, 100, 2.2),
          P("mushroom_violet_squat", 13.0, -9.0, 10, 3.2), P("mushroom_violet_squat", 12.6, 10.5, 300, 3.0),
          P("mushroom_violet_lean", -10.8, 1.5, 60, 2.5), P("mushroom_violet_lean", 6.6, -1.5, 210, 2.2),
          P("mushroom_violet_lean", 11.5, -0.5, 330, 2.6), P("mushroom_violet_lean", -13.0, -9.5, 90, 3.0),
          P("mushroom_cluster", -6.0, -9.8, 20, 1.9), P("mushroom_cluster", 5.5, -9.0, 130, 1.8),
          P("mushroom_cluster", -9.0, -5.6, 200, 1.6), P("mushroom_cluster", 8.8, 2.0, 40, 1.5),
          P("mushroom_cluster", -11.6, 10.6, 300, 1.8), P("mushroom_cluster", 11.8, 7.8, 90, 1.5)]
PLACE += [P("boulder_mossy_a", -14.2, 9.5, 20, 1.9), P("boulder_mossy_b", 14.2, 8.0, 100, 2.1), P("boulder_mossy_a", 14.2, 14.0, 200, 1.6),
          P("boulder_mossy_b", -14.3, 14.2, 40, 1.8), P("boulder_mossy_a", -14.5, -7.5, 150, 1.4), P("boulder_mossy_b", 14.5, -4.5, 300, 1.3),
          P("rock_cluster", -6.5, -1.6, 30, 1.0), P("rock_cluster", 7.0, -3.0, 200, 1.1), P("rock_cluster", 3.5, -8.8, 90, 0.9),
          P("rock_cluster", -10.8, 5.6, 10, 0.9)]
PLACE += [P("root_sprawl", -11.5, -3.0, 0, 1.6), P("root_sprawl", 9.5, -8.5, 70, 1.5), P("root_sprawl", -12.8, 6.5, 30, 1.7),
          P("root_sprawl", 12.8, 3.0, 200, 1.4), P("root_sprawl", 13.0, -9.0, 100, 1.5), P("root_sprawl", -13.0, -9.5, 0, 1.4),
          P("root_arch", -3.6, -12.6, 10, 1.5), P("root_arch", 6.8, -11.0, 200, 1.2), P("root_arch", -12.0, -5.8, 80, 1.6),
          P("root_arch", 11.0, 5.0, 300, 1.4)]
PLACE += [P("spore_cloud", 2, -3, 0, 1.2), P("spore_cloud", 7, -6, 30, 1.0), P("spore_cloud", -10, -4, 90, 1.1), P("spore_cloud", 10, -2, 10, 1.0),
          P("spore_cloud", -3, -11, 60, 1.0), P("spore_cloud", 6, -11, 120, 0.9), P("spore_cloud", -9, 7, 200, 1.0),
          P("spore_cloud", 9, 6, 300, 1.0), P("spore_cloud", -5, 0, 0, 0.8), P("spore_cloud", 4, 3, 40, 0.8)]
PLACE += [P("glow_sprouts", -9, -2, 0, 1.2), P("glow_sprouts", 8, -4.5, 90, 1.2), P("glow_sprouts", 5.6, -9, 20, 1.3), P("glow_sprouts", -7.5, -8.4, 200, 1.2),
          P("glow_sprouts", -12, 4, 50, 1.2), P("glow_sprouts", 10.5, 6, 130, 1.2), P("glow_sprouts", 3.5, -8.6, 70, 1.0), P("glow_sprouts", -2.8, -6.6, 15, 1.0)]

# ---------------------------------------------------------------- checks
PICKUPS = [(-7, 4), (-4, 6), (-1, 4), (2, 6), (5, 4)]
def solids():
    out = []
    for pl in PLACE:
        s = pl["scale"]; yaw = math.radians(pl["yaw_degrees"]); px, _, pz = pl["position"]
        for pr in PROXY.get(pl["asset"], []):
            lx, lz = rot(pr[1] * s, pr[2] * s, yaw); out.append(("cyl", px + lx, pz + lz, pr[3] * s))
    for pr in RUIN_PROXY:
        out.append(pr if pr[0] == "box" else ("cyl", pr[1], pr[2], pr[3]))
    return out

def dist_pt(o, x, z):
    if o[0] == "cyl": return math.hypot(x - o[1], z - o[2]) - o[3]
    dx = max(o[1] - x, 0, x - o[3]); dz = max(o[2] - z, 0, z - o[4]); return math.hypot(dx, dz)

def rect_hit(o, x0, z0, x1, z1):
    if o[0] == "cyl": return o[1] + o[3] > x0 and o[1] - o[3] < x1 and o[2] + o[3] > z0 and o[2] - o[3] < z1
    return o[3] > x0 and o[1] < x1 and o[4] > z0 and o[2] < z1

def check_keepouts():
    bad = []
    for o in solids():
        for px, pz in PICKUPS:
            if dist_pt(o, px, pz) < 1.3: bad.append(("pickup", o))
        if dist_pt(o, *WISP) < 1.6: bad.append(("wisp", o))
        if rect_hit(o, -1.4, -14.3, 1.4, 15): bad.append(("route x=0", o))
        if rect_hit(o, -10, 7, 10, 15): bad.append(("portal approach", o))
    for t in range(360):
        a = math.radians(t); r = pond_r(a) * 1.52
        if math.hypot(PIVOT_POND[0] + r * math.cos(a) - WISP[0], PIVOT_POND[1] + r * math.sin(a) - WISP[1]) < 1.6: bad.append(("wisp vs bank", t))
    return bad

# ---------------------------------------------------------------- compose + outputs
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    os.makedirs(os.path.join(OUT, "glb"), exist_ok=True)
    stats = {"assets": {}, "materials": sorted(m.name for m in MATS.values())}
    meshes = {}
    for name, fn in ASSETS.items():
        G = fn(); objs = []; meshes[name] = {}; tri = {}
        for mat, g in G.items():
            if not g.f: continue
            ob = to_object(f"{name}__{mat}", g, mat, recalc=name not in FLAT); objs.append(ob)
            meshes[name][mat] = ob.data; tri[mat] = g.tris()
        export_glb(objs, os.path.join(OUT, "glb", name + ".glb"))
        for ob in objs: ob.hide_render = True; ob.hide_viewport = True
        stats["assets"][name] = {"triangles": sum(tri.values()), "by_material": tri}
    stats["unique_triangles"] = sum(a["triangles"] for a in stats["assets"].values())
    stats["material_count"] = len(MATS)
    stats["placement_count"] = len(PLACE)
    stats["texture_mean_rgb"] = {n: [round(float(c), 3) for c in np.array(i.pixels[:]).reshape(-1, 4)[:, :3].mean(0)] for n, i in bpy.data.images.items() if n.startswith("tex_")}
    for k, pl in enumerate(PLACE):
        x, _, z = pl["position"]
        for mat, me in meshes[pl["asset"]].items():
            ob = bpy.data.objects.new(f"{pl['asset']}_{k}__{mat}", me)
            bpy.context.scene.collection.objects.link(ob)
            ob.location = (x, -z, 0); ob.rotation_euler = (0, 0, math.radians(pl["yaw_degrees"])); ob.scale = (pl["scale"],) * 3
    bad = check_keepouts(); stats["keepout_violations"] = [str(b) for b in bad]
    print("KEEPOUT", bad); print("TRIS", stats["unique_triangles"])
    json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), indent=1)
    json.dump({"schema": 1, "assets": {n: f"glb/{n}.glb" for n in ASSETS}, "placements": PLACE},
              open(os.path.join(OUT, "placement_mushroom_glade.json"), "w"), indent=1)
    json.dump({"note": "godot XZ; assets: local to asset before placement yaw/scale (cyl=[x,z,r]); ruin_waterfall_world: world-space solids",
               "assets": PROXY, "ruin_waterfall_world": RUIN_PROXY},
              open(os.path.join(OUT, "collision_proxies.json"), "w"), indent=1)
    render_preview(os.path.join(OUT, "preview_glade_ground.png"), (0, -13, 1.7), (0, 8, 2.0), lens=24, size=(1200, 750), ground=44, sun_energy=3.6)
    render_preview(os.path.join(OUT, "preview_glade_rts.png"), (0, -17, 24), (0, 2, 0), lens=30, size=(1200, 750), ground=44, sun_energy=3.6)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "glade.blend"))

if __name__ == "__main__":
    main()
    print("GLADE_BUILD_OK")
