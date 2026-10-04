"""Brann's Forge - Ancient Stone Sanctuary landmark kit (2026-10-04). Deterministic Blender 4.5 builder.

Run (no Blender install needed):
  pip install bpy==4.5.*
  python3 build_landmarks.py          # writes landmarks_kit.glb, textures/, build_report.json here
  cp landmarks_kit.glb ../../multiplayer/public/assets/landmarks_kit.glb

The game places the pieces itself (client/starting-world.js keeps the layout and the collision footprints in
shared/starting-layout.json), so every piece is modelled at the origin, foot centre on the ground:
  Menhir_A..D   ring stones (width along X, thin along Y, up Z; the rune face is Blender +Y = three.js -Z)
                each has a child empty  <name>_Rune  marking the rune's centre on that face
  Post_A/B      trilithon uprights      Lintel  the cap stone, its crystal seam (Crystal) on the underside
  Altar         stepped drum with an open geode bowl, crystal points inside
  Hoop          bronze resonance hoop (Bronze) with crystal inlay (Crystal), origin at its centre, ring in XZ
  Chain         one hanging chain, top at origin, 1 m long down -Z
  TuneCrystal   the floating tuning crystal (Crystal), origin at its centre
  Moss_A..C     moss cushions (Moss) for stone feet and crowns
  Rubble_A..C   fallen chips for the turf
Materials: Stone, Moss, Bronze, Crystal (four draws once merged). COLOR_0 multiplies base colour (weathering).
"""
import bpy, math, os, sys, struct, zlib, json, time
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.path.dirname(os.path.abspath(sys.argv[sys.argv.index("--python") + 1]))
TEXDIR = os.path.join(HERE, "textures")
os.makedirs(TEXDIR, exist_ok=True)

# ----------------------------------------------------------------------------------------------
# tileable textures (numpy -> PNG, embedded as JPEG by the exporter); same family as the golem's
# ----------------------------------------------------------------------------------------------
def fnoise(n, beta, seed, lo=0.0, hi=None, ax=1.0, ay=1.0):
    rng = np.random.default_rng(seed)
    F = np.fft.rfft2(rng.standard_normal((n, n)))
    fy = np.fft.fftfreq(n)[:, None] * n * ay
    fx = np.fft.rfftfreq(n)[None, :] * n * ax
    f = np.sqrt(fx ** 2 + fy ** 2); f[0, 0] = 1.0
    filt = 1.0 / f ** beta; filt[0, 0] = 0.0
    if hi: filt = filt * np.exp(-(f / hi) ** 2)
    if lo: filt = filt * (1 - np.exp(-(f / lo) ** 2))
    a = np.fft.irfft2(F * filt, s=(n, n))
    a = (a - a.mean()) / (a.std() * 3 + 1e-9)
    return np.clip(a, -1, 1)

def blur(a, s):
    n = a.shape[0]
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.rfftfreq(n)[None, :]
    return np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * (np.pi * s) ** 2 * (fx ** 2 + fy ** 2)), s=(n, n))

def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def mix(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float); return a * (1 - t[..., None]) + b * t[..., None]

def normal_from_height(h, strength):
    n = h.shape[0]; hs = (h - h.mean()) / (h.std() + 1e-9); k = strength * n / 512.0
    dx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5; dr = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
    nx, ny, nz = -dx * k, dr * k, np.ones_like(hs); L = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5

def u8(a): return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)

def write_png(path, arr):
    h, w, c = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, {3: 2, 4: 6}[c], 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as fh: fh.write(png)

def save_set(name, base, height, rough, metal, nstrength, ao=None, emis=None):
    write_png(os.path.join(TEXDIR, f"{name}_bc.png"), u8(base))
    write_png(os.path.join(TEXDIR, f"{name}_n.png"), u8(normal_from_height(height, nstrength)))
    orm = np.stack([np.ones_like(rough) if ao is None else ao, rough, metal], -1)
    write_png(os.path.join(TEXDIR, f"{name}_orm.png"), u8(orm))
    if emis is not None: write_png(os.path.join(TEXDIR, f"{name}_em.png"), u8(emis))
    return float(base.mean())

def tex_stone(name, n, seed):
    """Weathered sandstone-grey megalith: tool-dressed planes, pitting, fine bedding, lichen rosettes."""
    big = fnoise(n, 1.3, seed, hi=n / 20); mid = fnoise(n, 1.0, seed + 1, lo=4); fine = fnoise(n, 0.35, seed + 2); grit = fnoise(n, 0.0, seed + 9)
    warp = fnoise(n, 2.0, seed + 3, hi=10)
    yy = (np.arange(n) / n)[:, None] * np.ones((1, n))
    bed = 0.5 + 0.5 * np.sin(2 * np.pi * (9 * yy + 0.9 * warp))
    pits = sm(0.55, 0.9, fnoise(n, 0.2, seed + 6)) * sm(-0.2, 0.4, mid)
    c1 = fnoise(n, 1.5, seed + 4, hi=n / 9)
    crack = np.exp(-(c1 / 0.018) ** 2) * sm(-0.3, 0.3, big)
    h = 0.30 * big + 0.12 * mid + 0.05 * fine + 0.04 * bed + 0.03 * grit - 0.25 * pits - 0.35 * blur(crack, 1.2)
    hn = (h - h.min()) / (h.max() - h.min())
    base = mix([0.42, 0.40, 0.37], [0.70, 0.67, 0.61], sm(-0.7, 0.7, 0.6 * big + 0.5 * mid))
    base = base * (1 + 0.10 * fine + 0.06 * grit - 0.05 * bed)[..., None]
    base = mix(base, [0.58, 0.47, 0.34], sm(0.3, 0.8, fnoise(n, 1.2, seed + 11, hi=n / 12)) * 0.35)  # iron staining
    base = base * (1 - 0.55 * crack - 0.25 * pits)[..., None]
    # lichen rosettes: pale green-grey crust and a few ochre blooms
    lich = sm(0.45, 0.7, fnoise(n, 1.3, seed + 12, hi=n / 10) + 0.25 * fine)
    ochre = sm(0.62, 0.8, fnoise(n, 1.4, seed + 13, hi=n / 10)) * (1 - lich)
    base = mix(base, np.array([0.70, 0.74, 0.60]) * (0.85 + 0.3 * fine)[..., None], lich * 0.75)
    base = mix(base, [0.74, 0.62, 0.34], ochre * 0.45)
    ao = np.clip(0.75 + 0.25 * sm(0.05, 0.6, hn) - 0.35 * crack - 0.2 * pits, 0, 1)
    rough = np.clip(0.84 + 0.08 * fine - 0.1 * sm(0.5, 0.95, hn) + 0.06 * lich, 0, 1)
    return save_set(name, base, h + 0.04 * lich * fine, rough, np.zeros_like(rough), 3.0, ao=ao)

def tex_moss(name, n, seed):
    a = fnoise(n, 0.8, seed, hi=n / 4); b = fnoise(n, 0.25, seed + 1); c = fnoise(n, 1.2, seed + 2, hi=n / 14)
    tuft = sm(0.2, 0.8, fnoise(n, 0.5, seed + 3, lo=20))
    t = np.clip(0.5 + 0.5 * (0.6 * a + 0.5 * b), 0, 1)
    base = mix([0.10, 0.20, 0.04], [0.36, 0.52, 0.12], t)
    base = base + (0.14 * sm(0.4, 0.9, c))[..., None] * np.array([0.7, 0.55, -0.05]) + (0.08 * tuft)[..., None] * np.array([0.6, 0.7, 0.2])
    return save_set(name, base, 0.4 * a + 0.5 * b + 0.3 * tuft, 0.94 + 0.05 * b, np.zeros((n, n)), 4.0, ao=0.6 + 0.4 * t)

def tex_bronze(name, n, seed):
    # Dielectric-leaning, like the golem's iron: the game's environment is dim, so pure metal reads black.
    ham = fnoise(n, 0.7, seed + 1, lo=8, hi=n / 6); blot = fnoise(n, 1.4, seed + 2, hi=n / 10); scr = fnoise(n, 0.4, seed + 3, ax=0.08)
    vg = sm(0.25, 0.7, blot * 0.9 - 0.3 * ham)  # verdigris in hollows
    base = mix([0.34, 0.24, 0.13], [0.70, 0.52, 0.30], sm(-0.8, 0.8, 0.4 * ham + 0.2 * scr))
    base = mix(base, [0.30, 0.62, 0.52], vg * 0.6)
    rough = 0.38 + 0.12 * scr + 0.45 * vg
    metal = 0.55 - 0.45 * vg
    return save_set(name, base, 0.6 * ham + 0.2 * scr + 0.3 * vg, np.clip(rough, 0.2, 1), metal, 0.6, ao=0.8 + 0.2 * sm(-0.6, 0.6, ham))

def tex_wood(name, n, seed):
    """Weathered mine timber: grain streaks running along V, a few knots, silvered where the sun hits."""
    grain = fnoise(n, 1.1, seed, ay=0.05, hi=n / 3); streak = fnoise(n, 0.5, seed + 1, ay=0.03); big = fnoise(n, 1.6, seed + 2, hi=8)
    knot = sm(0.72, 0.92, fnoise(n, 1.8, seed + 3, hi=14)); checks = np.exp(-(fnoise(n, 1.0, seed + 4, ay=0.04, hi=n / 4) / 0.02) ** 2)
    base = mix([0.27, 0.18, 0.11], [0.55, 0.40, 0.25], sm(-0.7, 0.7, 0.7 * grain + 0.4 * streak))
    base = mix(base, [0.52, 0.50, 0.46], sm(-0.2, 0.7, big) * 0.35)  # sun-silvered
    base = base * (1 - 0.45 * knot - 0.5 * checks)[..., None]
    h = 0.5 * grain + 0.3 * streak - 0.4 * knot - 0.6 * checks
    return save_set(name, base, h, 0.78 + 0.1 * streak, np.zeros((n, n)), 2.2, ao=1 - 0.3 * checks)

def tex_crystal(name, n, seed):
    veins = np.clip(1 - np.abs(fnoise(n, 1.1, seed, lo=3, hi=n / 6) * 2.4), 0, 1) ** 4
    cells = fnoise(n, 0.9, seed + 1, hi=n / 8); fine = fnoise(n, 0.4, seed + 2)
    em = mix([0.05, 0.32, 0.95], [0.30, 0.72, 1.0], sm(-0.5, 0.6, cells))
    em = np.clip(em + veins[..., None] * np.array([0.55, 0.35, 0.05]) + (0.05 * fine)[..., None], 0, 1)
    base = mix([0.10, 0.25, 0.55], [0.35, 0.60, 0.90], sm(-0.5, 0.6, cells))
    return save_set(name, base, 0.5 * veins + 0.3 * cells, 0.15 + 0.1 * fine, np.zeros((n, n)), 1.0, emis=em * 0.55)

# ----------------------------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------------------------
def load_img(fn, cs):
    img = bpy.data.images.load(os.path.join(TEXDIR, fn)); img.colorspace_settings.name = cs; img.pack(); return img

def make_material(name, emissive=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    def tex(fn, cs):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = load_img(fn, cs); return t
    bc = tex(f"{name}_bc.png", "sRGB"); vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
    nt.links.new(bc.outputs["Color"], mul.inputs[6]); nt.links.new(vc.outputs["Color"], mul.inputs[7]); nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    nm = tex(f"{name}_n.png", "Non-Color"); nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    orm = tex(f"{name}_orm.png", "Non-Color"); sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if emissive:
        em = tex(f"{name}_em.png", "sRGB"); nt.links.new(em.outputs["Color"], bsdf.inputs["Emission Color"]); bsdf.inputs["Emission Strength"].default_value = 1.0
    return m

# ----------------------------------------------------------------------------------------------
# geometry helpers (numpy).  Meshes are built as quads, displaced, then decimated by Blender.
# ----------------------------------------------------------------------------------------------
def vnoise3(p, seed, freq):
    """Smooth value noise in 3D (vectorised), roughly -0.5..0.5."""
    p = np.asarray(p, float) * freq
    i = np.floor(p).astype(np.int64); f = p - i; u = f * f * (3 - 2 * f)
    def h(dx, dy, dz):
        q = (i[:, 0] + dx) * 73856093 ^ (i[:, 1] + dy) * 19349663 ^ (i[:, 2] + dz) * 83492791 ^ seed * 2654435761
        q = (q ^ (q >> 13)) * 1274126177; q = q ^ (q >> 16)
        return (q & 0xFFFF) / 65535.0
    l = lambda a, b, t: a + (b - a) * t
    x0 = l(l(h(0, 0, 0), h(1, 0, 0), u[:, 0]), l(h(0, 1, 0), h(1, 1, 0), u[:, 0]), u[:, 1])
    x1 = l(l(h(0, 0, 1), h(1, 0, 1), u[:, 0]), l(h(0, 1, 1), h(1, 1, 1), u[:, 0]), u[:, 1])
    return l(x0, x1, u[:, 2]) - 0.5

def fbm(p, seed, freq, octaves=4):
    s, a, f = 0, 1.0, freq
    for o in range(octaves): s = s + a * vnoise3(p, seed + o * 17, f); a *= 0.5; f *= 2.03
    return s

def cellular(p, seed, freq):
    """Voronoi F2-F1 (0 on cell borders): chisel facet ridges."""
    p = np.asarray(p, float) * freq; base = np.floor(p).astype(np.int64)
    d1 = np.full(len(p), 9.0); d2 = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = base + np.array([dx, dy, dz])
                q = (c[:, 0] * 73856093 ^ c[:, 1] * 19349663 ^ c[:, 2] * 83492791 ^ seed * 2654435761)
                q = (q ^ (q >> 13)) * 1274126177
                j = np.stack([((q >> s) & 0x3FF) / 1023.0 for s in (0, 10, 20)], -1)
                d = np.linalg.norm(c + j - p, axis=1)
                d2 = np.where(d < d1, d1, np.minimum(d2, d)); d1 = np.minimum(d1, d)
    return d2 - d1, d1

def grid_box(nx, ny, nz):
    """Closed quad box on [-1,1]^3 with nx,ny,nz segments per axis (shared vertices)."""
    idx, verts, faces = {}, [], []
    def vid(c):
        if c not in idx: idx[c] = len(verts); verts.append(c)
        return idx[c]
    N = (nx, ny, nz)
    for axis in range(3):
        a1, a2 = (axis + 1) % 3, (axis + 2) % 3
        for side in (0, N[axis]):
            for a in range(N[a1]):
                for b in range(N[a2]):
                    def P(aa, bb):
                        c = [0, 0, 0]; c[axis] = side; c[a1] = aa; c[a2] = bb; return vid(tuple(c))
                    q = [P(a, b), P(a + 1, b), P(a + 1, b + 1), P(a, b + 1)]
                    faces.append(q if side == N[axis] else q[::-1])
    V = np.array(verts, float) / np.array(N, float) * 2 - 1
    return V, faces

def lathe(profile, seg, closed_top=False):
    """Revolve [(r, z)] around Z into a quad mesh (profile bottom -> top)."""
    V, F = [], []
    for k in range(seg):
        a = k / seg * 2 * math.pi
        for r, z in profile: V.append((r * math.cos(a), r * math.sin(a), z))
    n = len(profile)
    for k in range(seg):
        k2 = (k + 1) % seg
        for j in range(n - 1): F.append([k * n + j, k2 * n + j, k2 * n + j + 1, k * n + j + 1])
    return np.array(V, float), F

def make_mesh(name, V, F, mat, tone_fn=None, tile=0.9, smooth_angle=48, mats=None):
    """Mesh object with box-projected UVs (texel density 1/tile per metre) and a COLOR_0 tone per corner."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [list(f) for f in F])
    me.validate(); me.update()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob

def finalize(ob, tone_fn=None, tile=1.6, smooth_angle=50, decimate=None, planar=None):
    """Optional decimation (keeps the silhouette, drops flat detail), then UVs, colours and sharp edges."""
    if decimate or planar:
        if planar:
            m = ob.modifiers.new("planar", "DECIMATE"); m.decimate_type = "DISSOLVE"; m.angle_limit = math.radians(planar)
        if decimate:
            m = ob.modifiers.new("dec", "DECIMATE"); m.ratio = decimate; m.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev); old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
    me = ob.data
    # triangulate n-gons left by dissolve so the exporter and the tone pass agree
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4]); bm.to_mesh(me); bm.free()
    me.update()
    uv = me.uv_layers.new(name="UVMap"); col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    co = np.array([v.co[:] for v in me.vertices]); nrm_v = None
    me.calc_loop_triangles() if hasattr(me, "calc_loop_triangles") else None
    uvs = np.zeros((len(me.loops), 2)); cols = np.ones((len(me.loops), 4))
    lv = np.array([l.vertex_index for l in me.loops])
    for p in me.polygons:
        n = np.abs(np.array(p.normal[:])); ax = int(np.argmax(n))
        for li in p.loop_indices:
            c = co[lv[li]]
            u, v = {0: (c[1], c[2]), 1: (c[0], c[2]), 2: (c[0], c[1])}[ax]
            uvs[li] = (u / tile, v / tile)
    if tone_fn is not None:
        pn = np.array([me.polygons[i].normal[:] for i in range(len(me.polygons))])
        lp = np.zeros(len(me.loops), int)
        for p in me.polygons: lp[list(p.loop_indices)] = p.index
        cols[:, :3] = tone_fn(co[lv], pn[lp])
    me.uv_layers["UVMap"].data.foreach_set("uv", uvs.astype(np.float32).ravel()); me.color_attributes["Col"].data.foreach_set("color", cols.astype(np.float32).ravel())  # re-fetch: adding a layer invalidates older references
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return ob

def stone_tone(seed, height, moss_foot=0.35):
    """Weathering multiply: damp dark foot with a moss-green band, paler wind-scoured crown, darker hollows."""
    def f(p, n):
        z = p[:, 2]; t = np.clip(z / max(height, 1e-3), 0, 1)
        g = fbm(p, seed, 1.3, 3)
        v = 0.80 + 0.16 * t + 0.25 * g
        c = np.stack([v * 1.0, v * 0.985, v * 0.96], -1)
        foot = np.clip(1 - z / max(moss_foot, 1e-3), 0, 1)[:, None]
        c = c * (1 - foot) + foot * np.array([0.42, 0.52, 0.30])
        up = np.clip(n[:, 2], 0, 1)[:, None]
        c = c * (1 - 0.12 * up * (g[:, None] > 0.05))
        return np.clip(c, 0, 1)
    return f

# ----------------------------------------------------------------------------------------------
# pieces
# ----------------------------------------------------------------------------------------------
def menhir(name, seed, w, h, d, taper=0.7, crown=0.25, bend=0.1, twist=0.18):
    V, F = grid_box(10, 6, 28)
    x, y, z = V[:, 0], V[:, 1], (V[:, 2] + 1) / 2              # z 0..1
    # rounded-box cross section that narrows to the crown, then a weathered domed tip
    s = 1 - (1 - taper) * z ** 1.3
    r = np.random.default_rng(seed)
    ex, ey = 2.6, 2.2
    rad = (np.abs(x) ** ex + np.abs(y) ** ey) ** (1 / max(ex, ey))
    k = np.where(rad > 1e-6, 1 / np.maximum(rad, 1e-6), 0) * np.maximum(np.abs(x), np.abs(y))
    x2, y2 = x * (0.75 + 0.25 * k), y * (0.75 + 0.25 * k)
    tip = 1 - crown * np.clip((z - 0.82) / 0.18, 0, 1) ** 2 * (1 - 0.6 * x2 * (r.random() - 0.5))
    P = np.stack([x2 * w / 2 * s, y2 * d / 2 * s, z * h * tip], -1)
    a = (z - 0.5) * twist; ca, sa = np.cos(a), np.sin(a)
    P[:, 0], P[:, 1] = P[:, 0] * ca - P[:, 1] * sa, P[:, 0] * sa + P[:, 1] * ca
    P[:, 0] += bend * h * (z ** 2) * (r.random() - 0.5) * 2
    # chisel facets + weathering: cellular ridges and fbm, never at the buried foot
    nrm = P - np.stack([np.zeros_like(z), np.zeros_like(z), P[:, 2]], -1); nl = np.linalg.norm(nrm[:, :2], axis=1, keepdims=True) + 1e-6
    outward = np.concatenate([nrm[:, :2] / nl, np.zeros((len(P), 1))], 1)
    ridge, f1 = cellular(P, seed, 2.2)
    disp = 0.05 * np.clip(ridge * 2, 0, 1) - 0.045 * f1 + 0.07 * fbm(P, seed + 3, 1.4) + 0.025 * fbm(P, seed + 4, 6.0)
    P += outward * disp[:, None] * np.clip(z * 6, 0.3, 1)[:, None]
    ob = make_mesh(name, P, F, MATS["Stone"])
    ob["rune"] = (0.0, d / 2 * (1 - (1 - taper) * 0.55 ** 1.3) + 0.0, h * 0.55)
    return finalize(ob, stone_tone(seed, h), decimate=0.5)

def subdivide(ob, levels=2):
    m = ob.modifiers.new("sub", "SUBSURF"); m.levels = levels; m.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)

def displace_obj(ob, fn):
    me = ob.data; co = np.array([v.co[:] for v in me.vertices]); co = fn(co)
    me.vertices.foreach_set("co", co.astype(np.float32).ravel()); me.update()

def lintel(name, seed, length, depth, height):
    V, F = grid_box(28, 8, 6)
    P = V * np.array([length / 2, depth / 2, height / 2])
    P[:, 2] += height / 2
    P[:, 2] -= 0.05 * (P[:, 0] / (length / 2)) ** 2  # sag
    ridge, f1 = cellular(P, seed, 2.0)
    n = np.sign(V) * (np.abs(V) > 0.999)
    disp = 0.04 * np.clip(ridge * 2, 0, 1) - 0.035 * f1 + 0.05 * fbm(P, seed + 3, 1.6) + 0.02 * fbm(P, seed + 4, 6.0)
    P += n * disp[:, None]
    # the geode seam: a wedge split up the middle of the underside
    seam = np.exp(-(P[:, 0] / 0.22) ** 2) * (V[:, 2] < -0.99)
    P[:, 2] += seam * 0.16
    ob = make_mesh(name, P, F, MATS["Stone"])
    return finalize(ob, stone_tone(seed, height * 3, 0.0), decimate=0.5)

def crystal_point(length, radius, sides=6):
    prof = [(radius * 0.9, 0), (radius, length * 0.08), (radius, length * 0.72), (0.0, length)]
    V, F = lathe(prof, sides)
    return V, F

def place(V, origin, axis, spin=0.0, scale=1.0):
    """Orient a +Z-up part along axis, around origin."""
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis)
    zc = Vector((0, 0, 1)); q = zc.rotation_difference(Vector(axis))
    R = np.array(q.to_matrix()) @ np.array(Matrix.Rotation(spin, 3, "Z"))
    return (V * scale) @ R.T + np.asarray(origin)

def merge(parts):
    V, F, off = [], [], 0
    for v, f in parts: V.append(v); F += [[i + off for i in q] for q in f]; off += len(v)
    return np.concatenate(V), F

def crystal_cluster(name, seed, base_r, count, length, lift=0.0, spread=0.55, up_bias=1.0):
    r = np.random.default_rng(seed); parts = []
    for k in range(count):
        a = r.random() * 2 * math.pi; d = base_r * math.sqrt(r.random())
        tilt = spread * (0.3 + r.random()) * (0 if k == 0 else 1)
        axis = (math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt) * up_bias + 0.0001)
        L = length * (1.0 if k == 0 else 0.45 + 0.5 * r.random()); rad = L * (0.13 + 0.05 * r.random())
        v, f = crystal_point(L, rad); parts.append((place(v, (math.cos(a) * d, math.sin(a) * d, lift - 0.04), axis, spin=r.random() * 3), f))
    V, F = merge(parts)
    ob = make_mesh(name, V, F, MATS["Crystal"])
    return finalize(ob, None, tile=1.4, smooth_angle=20)

def altar(name, seed):
    # three stepped, chamfered drums
    prof = [(1.38, -0.15), (1.42, 0.0), (1.40, 0.24), (1.30, 0.30), (1.10, 0.31), (1.08, 0.33), (1.06, 0.56), (0.96, 0.62),
            (0.86, 0.63), (0.84, 0.66), (0.82, 0.86), (0.74, 0.92), (0.70, 0.98)]
    V, F = lathe(prof, 36)
    P = V.copy(); rr = np.linalg.norm(P[:, :2], axis=1, keepdims=True) + 1e-6
    out = np.concatenate([P[:, :2] / rr, np.zeros((len(P), 1))], 1)
    ridge, f1 = cellular(P, seed, 2.5)
    P += out * (0.03 * np.clip(ridge * 2, 0, 1) - 0.025 * f1 + 0.04 * fbm(P, seed + 1, 2.0))[:, None]
    # the geode bowl: open, jagged rim, crystal-lined hollow
    bowl_out = [(0.70, 0.98), (0.80, 1.06), (0.86, 1.18), (0.84, 1.30)]
    bowl_in = [(0.84, 1.30), (0.70, 1.24), (0.60, 1.10), (0.42, 0.98), (0.0, 0.95)]
    Vb, Fb = lathe(bowl_out + bowl_in[1:], 36)
    rim = np.isclose(Vb[:, 2], 1.30)
    ang = np.arctan2(Vb[:, 1], Vb[:, 0])
    Vb[rim, 2] += 0.10 * np.abs(np.sin(ang[rim] * 4.5)) + 0.06 * fbm(Vb[rim], seed + 5, 3.0)
    V2, F2 = merge([(P, F), (Vb, Fb)])
    ob = make_mesh(name, V2, F2, MATS["Stone"])
    def tone(p, n):
        c = stone_tone(seed, 1.2, 0.12)(p, n)
        inner = (np.linalg.norm(p[:, :2], axis=1) < 0.80) & (p[:, 2] > 0.94)
        c[inner] = c[inner] * 0.0 + np.array([0.32, 0.30, 0.62])  # amethyst-dark geode lining
        return c
    return finalize(ob, tone, planar=4, decimate=0.7)

def hoop(name, R=0.62):
    # rectangular-section bronze ring with raised edges, notched every 30 degrees
    prof = [(R - 0.07, -0.05), (R - 0.07, 0.05), (R - 0.05, 0.065), (R + 0.05, 0.065), (R + 0.07, 0.05), (R + 0.07, -0.05), (R + 0.05, -0.065), (R - 0.05, -0.065), (R - 0.07, -0.05)]
    V, F = lathe(prof, 64)
    ang = np.arctan2(V[:, 1], V[:, 0]); notch = np.exp(-((np.mod(ang, math.pi / 6) - math.pi / 12) / 0.02) ** 2)
    rr = np.linalg.norm(V[:, :2], axis=1, keepdims=True); V[:, :2] *= (1 + 0.02 * notch[:, None] * (rr > R))
    # four bosses where the chains hold it
    parts = [(V, F)]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4; bv, bf = lathe([(0.0, -0.09), (0.06, -0.08), (0.08, 0.0), (0.06, 0.08), (0.0, 0.09)], 10)
        parts.append((place(bv, (math.cos(a) * (R + 0.07), math.sin(a) * (R + 0.07), 0), (math.cos(a), math.sin(a), 0)), bf))
    V2, F2 = merge(parts)
    ob = make_mesh(name, V2, F2, MATS["Bronze"])
    ob = finalize(ob, lambda p, n: np.full((len(p), 3), 1.0), tile=0.9, smooth_angle=35)
    inlay_v, inlay_f = lathe([(R - 0.02, -0.07), (R - 0.02, 0.07), (R + 0.02, 0.07), (R + 0.02, -0.07), (R - 0.02, -0.07)], 64)
    gi = make_mesh(name + "Inlay", inlay_v * np.array([1, 1, 1.08]), inlay_f, MATS["Crystal"])
    finalize(gi, None, tile=0.3, smooth_angle=20); gi.parent = ob
    # glTF: ring lies in Blender XY = three.js XZ; the game turns it upright in the gateway
    return ob

def chain(name, links=16, length=1.0):
    parts = []; step = length / links
    for k in range(links):
        v, f = lathe([(0.018, -0.009), (0.028, -0.009), (0.028, 0.009), (0.018, 0.009), (0.018, -0.009)], 10)
        v = v * np.array([1.0, 1.75, 1.0])  # oval link in XY, long along Y
        R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]]) if k % 2 else np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]])
        v = v @ R.T + np.array([0, 0, -step * (k + 0.5)])  # long axis down Z; alternate links turned a quarter
        parts.append((v, f))
    V, F = merge(parts)
    ob = make_mesh(name, V, F, MATS["Bronze"])
    return finalize(ob, lambda p, n: np.full((len(p), 3), 0.8), tile=0.2, smooth_angle=60)

def moss_cushion(name, seed, rx, ry, h):
    V, F = grid_box(8, 8, 2)
    P = V.copy(); P[:, 2] = (P[:, 2] + 1) / 2
    d = np.clip(1 - (P[:, 0] ** 2 + P[:, 1] ** 2) * 0.5, 0, 1)
    P = np.stack([P[:, 0] * rx, P[:, 1] * ry, P[:, 2] * h * (0.2 + 0.8 * d) - 0.02], -1)
    P[:, 2] += 0.03 * fbm(P, seed, 6.0) * (P[:, 2] > 0)
    rr = np.sqrt((P[:, 0] / rx) ** 2 + (P[:, 1] / ry) ** 2)
    P[:, :2] *= (1 + 0.18 * fbm(P, seed + 1, 3.0))[:, None]
    ob = make_mesh(name, P, F, MATS["Moss"])
    return finalize(ob, lambda p, n: np.clip(np.stack([0.85 + 0.2 * fbm(p, seed, 2)] * 3, -1), 0, 1), tile=0.5, smooth_angle=80, decimate=0.7)

def rubble(name, seed, s):
    V, F = grid_box(3, 3, 3); P = V * np.array([s, s * 0.8, s * 0.55])
    P += np.sign(V) * (0.25 * s * fbm(P, seed, 2.0 / s))[:, None]
    P[:, 2] += s * 0.4
    ob = make_mesh(name, P, F, MATS["Stone"])
    return finalize(ob, stone_tone(seed, s, 0.1), planar=8)

# ---- Crystal Outcrop ------------------------------------------------------------------------------
def geode_boulder(name, seed, window=(0.6, -0.5, 0.3)):
    """Crust boulder around the origin (radius ~1, flat base at z = -0.35) with a broken-open geode window lined with
    dark amethyst and a cluster of crystal points (child <name>_Crystals) growing out of it."""
    V, F = grid_box(14, 14, 14)
    d = V / np.linalg.norm(V, axis=1, keepdims=True)
    P = d * (1 + 0.32 * fbm(d, seed, 1.1, 3) + 0.08 * fbm(d, seed + 1, 3.5, 2))[:, None]
    ridge, f1 = cellular(P, seed + 2, 2.4)
    P += d * (0.05 * np.clip(ridge * 2, 0, 1) - 0.04 * f1)[:, None]
    w = np.asarray(window, float); w /= np.linalg.norm(w)
    cosang = d @ w; cav = sm(0.80, 0.93, cosang)
    jag = 0.06 * fbm(d, seed + 3, 6.0)
    P -= d * (cav * (0.42 + jag))[:, None]
    P[:, 2] = np.maximum(P[:, 2], -0.35)
    ob = make_mesh(name, P, F, MATS["Stone"])
    def tone(p, n):
        c = stone_tone(seed, 1.2, 0.0)(p + np.array([0, 0, 0.35]), n)
        dd = p / (np.linalg.norm(p, axis=1, keepdims=True) + 1e-6); inside = sm(0.84, 0.95, dd @ w)[:, None]
        rim = np.exp(-((dd @ w - 0.82) / 0.03) ** 2)[:, None]
        c = c * (1 - inside) + inside * np.array([0.30, 0.24, 0.55])
        c = c * (1 - 0.6 * rim) + 0.6 * rim * np.array([0.92, 0.90, 0.86])  # pale banded agate rim
        foot = np.clip((-0.15 - p[:, 2]) / 0.2, 0, 1)[:, None]
        return np.clip(c * (1 - 0.5 * foot) + 0.5 * foot * np.array([0.40, 0.48, 0.28]), 0, 1)
    finalize(ob, tone, decimate=0.42)
    # crystals in the window: origin at the window (child offset), so the game can keep them in proportion on a
    # stretched boulder
    cl = crystal_cluster(name + "_Crystals", seed + 9, 0.26, 11, 0.55, spread=0.45, lift=-0.08)
    cl.data.transform(Vector((0, 0, 1)).rotation_difference(Vector(w)).to_matrix().to_4x4())
    cl.parent = ob; cl.location = Vector(w * 0.6)
    return ob

def geode_cup(name, seed):
    """Broken crust cup that stays when a cluster is mined out: radius 1, rim ~0.25 up, base -0.25 (game scales it)."""
    out = [(0.70, -0.25), (0.95, -0.12), (1.04, 0.08), (1.0, 0.24)]
    inn = [(0.86, 0.22), (0.80, 0.02), (0.55, -0.12), (0.0, -0.16)]
    V, F = lathe(out + inn, 28)
    ang = np.arctan2(V[:, 1], V[:, 0]); top = V[:, 2] > 0.2
    V[top, 2] += 0.16 * np.abs(np.sin(ang[top] * 3.5 + seed)) + 0.06 * fbm(V[top], seed, 4.0) - 0.08
    V += (V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-6)) * (0.05 * fbm(V, seed + 1, 3.0))[:, None]
    ob = make_mesh(name, V, F, MATS["Stone"])
    def tone(p, n):
        c = stone_tone(seed, 0.5, 0.0)(p + np.array([0, 0, 0.25]), n); r = np.linalg.norm(p[:, :2], axis=1)
        inside = ((r < 0.9) & (p[:, 2] > -0.2))[:, None] * 1.0
        return c * (1 - inside) + inside * np.array([0.30, 0.27, 0.56])
    return finalize(ob, tone, planar=3)

def timber(seed, w, d, L, bevel=0.22):
    """Vertical squared beam, foot at the origin, grain up its length (UVs are fixed before it is moved)."""
    V, F = grid_box(2, 2, max(2, int(L / 0.3)))
    P = V * np.array([w / 2, d / 2, L / 2]); P[:, 2] += L / 2
    corner = (np.abs(V[:, 0]) > 0.99) & (np.abs(V[:, 1]) > 0.99)
    P[corner, :2] *= 1 - bevel * 0.5
    P[:, :2] += 0.012 * np.stack([fbm(P, seed, 2.0), fbm(P, seed + 1, 2.0)], -1)
    ob = make_mesh(f"t{seed}", P, F, MATS["Wood"])
    return finalize(ob, lambda p, n: np.clip(np.stack([0.9 + 0.25 * fbm(p, seed, 0.8, 2)] * 3, -1), 0, 1), tile=1.1, smooth_angle=30)

def between(a, b):
    """Matrix taking a vertical part (foot at origin, up Z, length |b-a|) onto the segment a -> b."""
    a, b = Vector(a), Vector(b)
    return Matrix.Translation(a) @ Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()

def assemble(name, parts, mat):
    """Join finalized parts (object, matrix) into one mesh object; UVs and colours ride along."""
    import bmesh
    bm = bmesh.new()
    for ob, M in parts:
        me = ob.data.copy(); me.transform(M); bm.from_mesh(me); bpy.data.meshes.remove(me); bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.clear(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob

def bronze_band(seed, r, h, t=0.02, seg=20):
    V, F = lathe([(r, 0), (r + t, 0.0), (r + t, h), (r, h), (r, 0)], seg)
    return finalize(make_mesh(f"b{seed}", V, F, MATS["Bronze"]), lambda p, n: np.full((len(p), 3), 0.85), tile=0.4, smooth_angle=40)

def wheel(seed, radius, width, spokes=6):
    """Wood wheel (rim segments, hub, spokes) round the Z axis; returns (wood parts, iron parts) with matrices."""
    wood, iron = [], []
    for k in range(spokes):
        a = k / spokes * 2 * math.pi
        wood.append((timber(seed + k, radius * 0.1, width * 0.45, radius * 0.86), Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(-math.pi / 2, 4, "X")))
    rim, rf = lathe([(radius * 0.80, -width / 2), (radius * 0.97, -width / 2), (radius * 0.97, width / 2), (radius * 0.80, width / 2), (radius * 0.80, -width / 2)], 16)
    wood.append((finalize(make_mesh(f"r{seed}", rim, rf, MATS["Wood"]), lambda p, n: np.full((len(p), 3), 0.85), tile=0.7, smooth_angle=30), Matrix()))
    hub, hf = lathe([(0.0, -width * 0.7), (radius * 0.2, -width * 0.7), (radius * 0.2, width * 0.7), (0.0, width * 0.7)], 10)
    wood.append((finalize(make_mesh(f"h{seed}", hub, hf, MATS["Wood"]), None, tile=0.5, smooth_angle=30), Matrix()))
    iron.append((bronze_band(seed, radius * 0.97, width * 1.05, 0.025, 16), Matrix.Translation((0, 0, -width * 0.525))))
    iron.append((bronze_band(seed + 1, radius * 0.2, width * 1.5, 0.02, 10), Matrix.Translation((0, 0, -width * 0.75))))
    return wood, iron

def build_outcrop():
    for i, w in enumerate([(0.6, -0.55, 0.35), (-0.4, -0.7, 0.45), (0.75, 0.3, 0.4)]): geode_boulder(f"GeodeBoulder_{'ABC'[i]}", 300 + i * 13, w)
    geode_cup("Cup", 41)
    # Mine head: two posts, a cap beam along Y, knee braces, iron straps, a pulley wheel on an iron yoke, a rope down to a
    # bronze pail, and a square timber collar round the shaft. Origin at the shaft centre on the ground.
    wood, iron = [], []
    for s in (-1, 1):
        wood.append((timber(500 + s, 0.3, 0.3, 2.9), Matrix.Translation((0, s, -0.15))))
        wood.append((timber(510 + s, 0.15, 0.15, 1.15), between((0, s * 0.98, 1.85), (0, s * 0.3, 2.67))))
        for z in (2.45, 1.0): iron.append((bronze_band(520 + s, 0.16, 0.12, 0.018, 4), Matrix.Translation((0, s, z)) @ Matrix.Rotation(math.pi / 4, 4, "Z") @ Matrix.Scale(1.33, 4)))
    wood.append((timber(530, 0.34, 0.3, 2.7), between((0, -1.35, 2.82), (0, 1.35, 2.82)) @ Matrix.Rotation(math.pi / 2, 4, "Z")))
    for k, (ox, oy, ry) in enumerate([(0, -0.64, 0), (0, 0.64, 0), (-0.64, 0, 1), (0.64, 0, 1)]):
        a, b = ((-0.75, oy, 0.1), (0.75, oy, 0.1)) if not ry else ((ox, -0.75, 0.1), (ox, 0.75, 0.1))
        wood.append((timber(540 + k, 0.22, 0.22, 1.5), between(a, b)))
    pw, pi = wheel(560, 0.34, 0.1, 6); spin = Matrix.Translation((0, 0, 2.2)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    wood += [(o, spin @ M) for o, M in pw]; iron += [(o, spin @ M) for o, M in pi]
    for s in (-1, 1): iron.append((timber(570 + s, 0.035, 0.08, 0.5), Matrix.Translation((s * 0.09, 0, 2.2))))  # yoke straps up to the beam
    rope = timber(580, 0.03, 0.03, 1.6); rope.data.materials[0] = MATS["Wood"]; wood.append((rope, Matrix.Translation((0, -0.34, 0.58))))
    pail, pf = lathe([(0.0, 0.0), (0.12, 0.0), (0.16, 0.28), (0.15, 0.29), (0.11, 0.02), (0.0, 0.02)], 14)
    iron.append((finalize(make_mesh("pail", pail, pf, MATS["Bronze"]), lambda p, n: np.full((len(p), 3), 0.9), tile=0.4, smooth_angle=40), Matrix.Translation((0, -0.34, 0.3))))
    assemble("MineHead", wood, MATS["Wood"]); ir = assemble("MineHead_Iron", iron, MATS["Bronze"]); ir.parent = bpy.data.objects["MineHead"]
    # Ore cart: plank tub (length X, width Y), four spoked wheels on iron tyres, corner straps, heaped with crystal.
    wood, iron = [], []
    for k in range(4): wood.append((timber(600 + k, 0.2, 0.06, 1.3), between((-0.65, -0.315 + k * 0.21, 0.42), (0.65, -0.315 + k * 0.21, 0.42))))
    for s in (-1, 1):
        for k in range(2): wood.append((timber(610 + k + s, 0.06, 0.24, 1.36), between((-0.68, s * 0.42, 0.52 + k * 0.25), (0.68, s * 0.42, 0.52 + k * 0.25))))
        for k in range(2): wood.append((timber(620 + k + s, 0.24, 0.06, 0.84), between((s * 0.66, -0.42, 0.52 + k * 0.25), (s * 0.66, 0.42, 0.52 + k * 0.25))))
        for t in (-1, 1): iron.append((timber(630 + s + t, 0.05, 0.05, 0.56), Matrix.Translation((s * 0.68, t * 0.44, 0.38))))
    for sx in (-0.42, 0.42):
        for sy in (-0.47, 0.47):
            ww, wi = wheel(640 + int(sx * 10 + sy * 100), 0.27, 0.08, 6); M = Matrix.Translation((sx, sy, 0.27)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            wood += [(o, M @ m) for o, m in ww]; iron += [(o, M @ m) for o, m in wi]
    cart = assemble("OreCart", wood, MATS["Wood"]); ir = assemble("OreCart_Iron", iron, MATS["Bronze"]); ir.parent = cart
    heap = crystal_cluster("OreCart_Crystals", 650, 0.36, 10, 0.42, lift=0.5, spread=0.9); heap.data.transform(Matrix.Scale(1.0, 4)); heap.parent = cart

def empty(name, loc, parent):
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.1; bpy.context.scene.collection.objects.link(e)
    e.parent = parent; e.location = loc; return e

# ----------------------------------------------------------------------------------------------
MATS = {}

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = {"Stone": tex_stone("Stone", 1024, 41), "Moss": tex_moss("Moss", 512, 52), "Bronze": tex_bronze("Bronze", 512, 63), "Crystal": tex_crystal("Crystal", 256, 74),
           "Wood": tex_wood("Wood", 512, 85)}
    for n in ("Stone", "Moss", "Bronze", "Wood"): MATS[n] = make_material(n)
    MATS["Crystal"] = make_material("Crystal", emissive=True)
    objs = []
    for i, (h, w, d, tp) in enumerate([(3.0, 0.98, 0.62, 0.66), (3.5, 0.92, 0.58, 0.70), (3.9, 1.0, 0.64, 0.62), (4.3, 0.95, 0.6, 0.72)]):
        ob = menhir(f"Menhir_{'ABCD'[i]}", 900 + i * 17, w, h, d, taper=tp)
        empty(f"Menhir_{'ABCD'[i]}_Rune", Vector(ob["rune"]), ob); objs.append(ob)
    objs.append(menhir("Post_A", 611, 0.82, 4.3, 0.74, taper=0.9, crown=0.04, bend=0.02, twist=0.05))
    objs.append(menhir("Post_B", 612, 0.82, 4.3, 0.74, taper=0.88, crown=0.05, bend=0.02, twist=0.06))
    li = lintel("Lintel", 613, 3.6, 1.0, 0.64); objs.append(li)
    seam = crystal_cluster("LintelSeam", 614, 0.12, 7, 0.42, up_bias=-1.0, spread=0.5); seam.parent = li
    seam.location = (0, 0, 0.12)
    al = altar("Altar", 321); objs.append(al)
    bowl = crystal_cluster("AltarCrystals", 322, 0.45, 11, 0.55, lift=0.96, spread=0.6); bowl.parent = al
    objs.append(hoop("Hoop")); objs.append(chain("Chain"))
    tc = crystal_cluster("TuneCrystal", 330, 0.0, 1, 0.9, lift=-0.45, spread=0.0); objs.append(tc)
    for i, (rx, ry, h) in enumerate([(0.7, 0.5, 0.16), (0.55, 0.42, 0.12), (0.9, 0.6, 0.2)]): objs.append(moss_cushion(f"Moss_{'ABC'[i]}", 40 + i, rx, ry, h))
    for i, s in enumerate([0.35, 0.25, 0.45]): objs.append(rubble(f"Rubble_{'ABC'[i]}", 70 + i, s))
    build_outcrop()
    # spread pieces out in the .blend for inspection (the game reads each piece's own geometry, not this offset)
    for k, ob in enumerate([o for o in bpy.data.objects if o.parent is None and o.type == "MESH"]):
        ob.location = ((k % 6) * 3.0, (k // 6) * 3.0, 0)
    return lum

def export_glb(path):
    for ob in bpy.data.objects:
        if ob.parent is None: ob.location = (0, 0, 0)
    kw = dict(filepath=path, export_format="GLB", export_materials="EXPORT", export_apply=False, export_cameras=False, export_lights=False,
              export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False, export_vertex_color="ACTIVE",
              export_image_format="JPEG", export_image_quality=86)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})

def inspect(path):
    data = open(path, "rb").read(); jl = struct.unpack("<I", data[12:16])[0]; j = json.loads(data[20:20 + jl])
    per = {}
    for nd in j["nodes"]:
        if "mesh" in nd:
            m = j["meshes"][nd["mesh"]]; per[nd["name"]] = sum(j["accessors"][p["indices"]]["count"] // 3 for p in m["primitives"])
    return dict(bytes=len(data), nodes=[n["name"] for n in j["nodes"]], materials=[m["name"] for m in j["materials"]], images=len(j.get("images", [])),
                triangles=per, total_triangles=sum(per.values()))

if __name__ == "__main__":
    lum = build()
    glb = os.path.join(HERE, "landmarks_kit.glb"); export_glb(glb)
    rep = inspect(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]))
