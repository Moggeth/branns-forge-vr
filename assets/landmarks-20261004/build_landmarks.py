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

ASHLAR_SPAN = 2.4  # metres covered by one Ashlar texture tile: six 0.4 m courses

def tex_ashlar(name, n, seed):
    """Dressed sandstone ashlar in running bond: six courses per tile, blocks of varied length with softened, chipped
    arrises, recessed lime mortar, per-block tone, tooling and lichen. Tiles in both directions."""
    r = np.random.default_rng(seed); courses = 6; ch = n // courses; S = ASHLAR_SPAN
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    edge = np.zeros((n, n)); tone = np.zeros((n, n)); warm = np.zeros((n, n))
    for c in range(courses):
        lens = r.uniform(0.55, 1.15, 8); cuts = np.cumsum(lens); k = np.searchsorted(cuts, S); lens = lens[:k + 1]
        lens = lens / lens.sum() * n; bounds = np.concatenate([[0], np.cumsum(lens)]) + r.uniform(0, n)
        row = slice(c * ch, (c + 1) * ch if c < courses - 1 else n); x = xx[row]; y = yy[row] - c * ch; h = (ch if c < courses - 1 else n - c * ch)
        xs = (x - bounds[0]) % n; idx = np.searchsorted(bounds[1:] - bounds[0], xs, side="right")
        left = xs - (bounds[idx] - bounds[0]); right = (bounds[idx + 1] - bounds[0]) - xs
        edge[row] = np.minimum(np.minimum(left, right), np.minimum(y, h - 1 - y))
        t = r.uniform(0.84, 1.1, len(bounds)); w = r.uniform(0, 1, len(bounds)); tone[row] = t[idx % len(t)]; warm[row] = w[idx % len(w)]
    px = n / S; joint = 0.012 * px; bevel = 0.03 * px
    chip = fnoise(n, 1.0, seed + 1, hi=n / 12) * 0.035 * px
    e = edge - joint + chip
    face = sm(0, bevel, e)                                     # 0 in the joint, 1 on the block face
    big = fnoise(n, 1.2, seed + 2, hi=n / 10); fine = fnoise(n, 0.35, seed + 3); tool = fnoise(n, 0.8, seed + 4, ay=0.25, hi=n / 3)
    h = face * (0.75 + 0.15 * big + 0.05 * tool + 0.03 * fine) + (1 - face) * (0.1 + 0.05 * fine)
    base = np.stack([0.66 + 0.05 * warm, 0.60 + 0.02 * warm, 0.50 - 0.03 * warm], -1) * tone[..., None]
    base = base * (0.9 + 0.12 * big + 0.06 * fine + 0.04 * tool)[..., None]
    lich = sm(0.35, 0.7, fnoise(n, 1.4, seed + 5, hi=n / 14)) * face
    base = mix(base, [0.60, 0.64, 0.46], lich * 0.45)
    base = mix(base, [0.68, 0.58, 0.36], sm(0.55, 0.85, fnoise(n, 1.3, seed + 6, hi=n / 16)) * face * 0.35)
    mortar = np.array([0.52, 0.49, 0.43]) * (0.85 + 0.2 * fine)[..., None]
    base = base * face[..., None] + mortar * (1 - face)[..., None]
    ao = np.clip(0.72 + 0.28 * sm(-bevel, bevel * 2.0, e), 0, 1)
    rough = np.clip(0.86 + 0.08 * fine - 0.06 * face * tool, 0, 1)
    return save_set(name, base, h, rough, np.zeros((n, n)), 2.6, ao=ao)

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

def finalize(ob, tone_fn=None, tile=1.6, smooth_angle=50, decimate=None, planar=None, uv_fn=None):
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
        if uv_fn is not None:
            li = list(p.loop_indices); uvs[li] = uv_fn(co[lv[li]], np.array(p.normal[:])); continue
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

# ---- Ruined Watch-Arch ----------------------------------------------------------------------------
def ashlar_tone(seed, top=None):
    """Dressed sandstone: a warm per-block tone, darker weathered arrises, soot on a broken top, grass stain at the foot."""
    r = np.random.default_rng(seed); tone = 0.86 + 0.18 * r.random(); warm = r.random()
    def f(p, n):
        g = fbm(p, seed, 2.2, 3); v = tone * (0.86 + 0.3 * g)
        c = np.stack([v * (1.1 + 0.05 * warm), v * (0.98 + 0.01 * warm), v * (0.8 - 0.04 * warm)], -1)  # warm to sit with the Ashlar piers
        up = np.clip(n[:, 2], 0, 1)[:, None]; lich = sm(0.12, 0.3, fbm(p, seed + 4, 1.4, 2))[:, None] * up
        c = c * (1 - 0.5 * lich) + 0.5 * lich * np.array([0.55, 0.62, 0.38])
        return np.clip(c, 0, 1)
    return f

def block(seed, w, d, h, chip=0.045, seg=(3, 2, 2), tone=None):
    """Chamfered, lightly weathered block, centred on the origin (w along X, d along Y, h up Z)."""
    V, F = grid_box(*seg); P = V * np.array([w / 2, d / 2, h / 2])
    edges = (np.abs(V) > 0.999).sum(1)
    P -= np.sign(V) * (chip * (edges >= 2) * (1 + 0.4 * (edges == 3)))[:, None]
    P += 0.012 * np.stack([fbm(P, seed + k, 3.0, 2) for k in range(3)], -1)
    ob = make_mesh(f"blk{seed}", P, F, MATS["Stone"])
    return finalize(ob, tone or ashlar_tone(seed), tile=1.2, smooth_angle=35)

def ashlar_uv(Rref=4 * ASHLAR_SPAN / (2 * math.pi)):
    """Cylindrical UVs for round ashlar work: courses run level round the tower (four whole tiles per turn, so no seam
    jump), flat tops take plan UVs, radial faces (merlon cheeks, slit reveals) take radius along U."""
    def f(c, n):
        if abs(n[2]) > 0.7: return c[:, :2] / ASHLAR_SPAN
        a = np.arctan2(c[:, 1], c[:, 0]); a = np.where(a - a[0] > math.pi, a - 2 * math.pi, np.where(a - a[0] < -math.pi, a + 2 * math.pi, a))
        am = a.mean(); tang = abs(-math.sin(am) * n[0] + math.cos(am) * n[1])
        if tang > 0.7: return np.stack([np.linalg.norm(c[:, :2], axis=1) / ASHLAR_SPAN, c[:, 2] / ASHLAR_SPAN], -1)
        return np.stack([a * Rref / ASHLAR_SPAN, c[:, 2] / ASHLAR_SPAN], -1)
    return f

def weather_tone(seed, height, soot_from=None, moss_foot=0.4):
    """Multiply over the Ashlar texture: rain streaks, a mossy damp foot, lichen on ledges, soot near the fire."""
    def f(p, n):
        z = p[:, 2]; g = fbm(p, seed, 1.1, 3)
        streak = fbm(p * np.array([3.2, 3.2, 0.18]), seed + 1, 1.0, 2)
        v = 0.9 + 0.12 * g - 0.12 * sm(0.05, 0.3, streak) * (z / height)
        c = np.stack([v, v * 0.985, v * 0.955], -1)
        foot = (np.clip(1 - z / moss_foot, 0, 1) * (0.7 + 0.3 * sm(-0.2, 0.2, g)))[:, None]
        c = c * (1 - foot) + foot * np.array([0.40, 0.50, 0.27])
        up = np.clip(n[:, 2], 0, 1)[:, None] * sm(-0.05, 0.2, fbm(p, seed + 2, 2.2, 2))[:, None]
        c = c * (1 - 0.55 * up) + 0.55 * up * np.array([0.50, 0.58, 0.32])
        if soot_from is not None:
            s = np.clip((z - soot_from) / max(height - soot_from, 1e-3), 0, 1)[:, None] * (0.75 + 0.25 * g[:, None])
            c = c * (1 - 0.55 * s) + 0.55 * s * np.array([0.16, 0.14, 0.13])
        return np.clip(c, 0, 1)
    return f

def pier(name, seed, w=1.1, h=4.6, d=1.0, broken=False):
    """One continuous ashlar pier (the coursing is in the texture, aligned with the tower): softened arrises, a slight
    entasis, a moulded cap on the standing pier, a ragged robbed-out top on the broken one."""
    V, F = grid_box(4, 3, int(h / 0.2)); P = V * np.array([w / 2, d / 2, h / 2]); P[:, 2] += h / 2
    corner = (np.abs(V[:, 0]) > 0.99) & (np.abs(V[:, 1]) > 0.99); P[corner, :2] *= np.array([1 - 0.09 / w, 1 - 0.09 / d])
    P[:, :2] *= (1 + 0.03 * (1 - P[:, 2] / h))[:, None]
    P += 0.014 * np.stack([fbm(P, seed + k, 1.6, 2) for k in range(3)], -1)
    if broken:
        top = V[:, 2] > 0.99; hi = V[:, 2] > 0.6
        jag = np.round((0.45 * (0.5 + 0.5 * np.sin(P[:, 0] * 3.1 + 1.0)) + 0.35 * np.abs(fbm(P, seed + 9, 1.8, 2))) / 0.2) * 0.2
        P[top, 2] -= jag[top]; P[hi & ~top, 2] -= jag[hi & ~top] * (V[hi & ~top, 2] - 0.6) / 0.4
    ob = finalize(make_mesh(name + "_s", P, F, MATS["Ashlar"]), weather_tone(seed, h), tile=ASHLAR_SPAN, smooth_angle=40)
    parts = [(ob, Matrix())]
    if not broken:
        cap, cf = grid_box(3, 3, 2); cp = cap * np.array([w * 0.6, d * 0.6, 0.14]); cp[:, 2] += h + 0.12
        cp[(cap[:, 2] < -0.99), :2] *= 0.88; cp += 0.01 * np.stack([fbm(cp, seed + 20 + k, 3, 2) for k in range(3)], -1)
        parts.append((finalize(make_mesh("cap", cp, cf, MATS["Ashlar"]), weather_tone(seed + 3, h + 0.3), tile=ASHLAR_SPAN * 2, smooth_angle=35), Matrix()))
    else:  # two loose blocks left where they slipped
        for k, (x, y, z, rz) in enumerate([(0.18, 0.05, h - 0.32, 0.22), (-0.35, -0.6, 0.18, -0.4)]):
            b = finalize(make_mesh("lb", *grid_box(3, 2, 2), MATS["Ashlar"]), weather_tone(seed + 30 + k, h), tile=ASHLAR_SPAN * 3)
            b.data.transform(Matrix.Diagonal((0.36, 0.26, 0.2, 1))); parts.append((b, Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z")))
    return assemble(name, parts, MATS["Ashlar"])

def voussoir(name, seed, inner=3.3, outer=4.05, span=math.pi / 15, depth=1.0, centred=False):
    """One arch stone between angles 0..span on a circle round the origin, in Blender XZ (three.js XY), depth along Y."""
    V, F = grid_box(4, 2, 2); gap = 0.012
    a = gap + (span - 2 * gap) * (V[:, 0] + 1) / 2; rad = inner + (outer - inner) * (V[:, 2] + 1) / 2
    P = np.stack([np.cos(a) * rad, V[:, 1] * depth / 2 * (1 - 0.04 * np.abs(V[:, 2])), np.sin(a) * rad], -1)
    edges = (np.abs(V) > 0.999).sum(1)
    P -= (np.stack([np.zeros(len(V)), np.sign(V[:, 1]), np.zeros(len(V))], -1) * 0.03 * (edges >= 2)[:, None])
    P += 0.015 * np.stack([fbm(P, seed + k, 2.5, 2) for k in range(3)], -1)
    if centred: P -= (P.min(0) + P.max(0)) / 2
    ob = make_mesh(name, P, F, MATS["Stone"])
    return finalize(ob, ashlar_tone(seed), tile=1.2, smooth_angle=35)

def rod(seed, a, b, r=0.03, seg=6, mat="Bronze"):
    L = (Vector(b) - Vector(a)).length; V, F = lathe([(0.0, 0.0), (r, 0.0), (r, L), (0.0, L)], seg)
    ob = finalize(make_mesh(f"rod{seed}", V, F, MATS[mat]), lambda p, n: np.full((len(p), 3), 0.85), tile=0.4, smooth_angle=50)
    return ob, between(a, b)

def arc_box(r0, r1, a0, a1, z0, z1, seg=3, chip=0.03, seed=0):
    """Curved block between radii r0..r1 and angles a0..a1, z0..z1 (merlons, string courses, slit surrounds)."""
    V, F = grid_box(seg, 1, 2); a = a0 + (a1 - a0) * (V[:, 0] + 1) / 2; rr = r0 + (r1 - r0) * (V[:, 1] + 1) / 2; z = z0 + (z1 - z0) * (V[:, 2] + 1) / 2
    edges = (np.abs(V) > 0.999).sum(1) >= 2; rr = rr - chip * edges * (V[:, 1] > 0); z = z - chip * edges * np.sign(V[:, 2]) * (np.abs(V[:, 2]) > 0.99)
    P = np.stack([np.cos(a) * rr, np.sin(a) * rr, z], -1); P += 0.008 * np.stack([fbm(P, seed + k, 3, 2) for k in range(3)], -1)
    return P, F

TOWER_R = 1.6           # wall face radius above the battered plinth (collider footprint 3.4 m square)

def tower_r(z):
    """Outer wall radius at height z: a battered plinth to 0.62 m, then plumb, with a string course at 2.2 m."""
    return float(np.interp(z, [-0.05, 0.42, 0.62, 2.18, 2.2, 2.34, 2.36, 9], [1.74, 1.72, TOWER_R, TOWER_R, 1.67, 1.67, TOWER_R, TOWER_R]))

def build_watch_arch():
    pier("Pier_L", 311, h=4.6); pier("Pier_R", 312, h=3.2, broken=True)
    voussoir("Voussoir", 320); voussoir("Voussoir_Loose", 340, centred=True)
    ks = voussoir("Keystone", 349, inner=3.25, outer=4.15, span=math.pi / 13, centred=True)
    cl = crystal_cluster("Keystone_Crystals", 350, 0.12, 4, 0.28, spread=0.5); cl.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((0, 0, -0.02)))
    cl.parent = ks; cl.location = (0, -0.5, 0)
    # Watch-tower: one round ashlar shell (coursing from the Ashlar texture) on a battered plinth, a string course, and a
    # crenellated parapet whose east side has been knocked down. Inside, a fire floor at 2.95 m where the owl brazier
    # stands. Arrow slits north and east, a studded door up two steps on the west, the crystal vein on the arch side
    # (three.js +Z = Blender -Y). Footprint unchanged (shared/starting-layout.json).
    H, WT, FL, RI = 3.07, 0.42, 2.95, TOWER_R - 0.42; seg = 64; uvf = ashlar_uv(); parts = []
    outer = [(tower_r(z), z) for z in (-0.05, 0.42, 0.62, 1.4, 2.18, 2.2, 2.34, 2.36, 2.8, H)]
    prof = outer + [(RI, H), (RI, FL), (0.0, FL)]
    V, F = lathe(prof, seg); ang = np.arctan2(V[:, 1], V[:, 0])
    # broken east parapet: the top ring dips raggedly between -0.5 and 0.9 rad
    east = np.clip(1 - np.abs(np.arctan2(np.sin(ang - 0.2), np.cos(ang - 0.2))) / 0.75, 0, 1)
    top = V[:, 2] > H - 0.01; V[top, 2] -= east[top] * (0.05 + 0.08 * np.abs(np.sin(ang[top] * 9)))
    rr = np.linalg.norm(V[:, :2], axis=1, keepdims=True) + 1e-6; wall = (rr[:, 0] > RI - 0.01)
    V[wall, :2] += V[wall, :2] / rr[wall] * (0.012 * fbm(V[wall], 365, 1.4, 2))[:, None]
    tw_tone = weather_tone(361, H + 0.4, soot_from=2.5)
    def tone(p, n):
        c = tw_tone(p, n); inner = np.linalg.norm(p[:, :2], axis=1) < RI + 0.05
        c[inner] *= 0.55  # smoke-blackened inside the parapet
        return c
    parts.append((finalize(make_mesh("shell", V, F, MATS["Ashlar"]), tone, uv_fn=uvf, smooth_angle=50), Matrix()))
    # merlons: eight round the parapet, the three on the east gone (two stumps)
    for k in range(8):
        a0 = k / 8 * 2 * math.pi + 0.08; a1 = a0 + 2 * math.pi / 8 * 0.56; mid = (a0 + a1) / 2
        e = 1 - min(abs(math.atan2(math.sin(mid - 0.2), math.cos(mid - 0.2))) / 0.75, 1)
        if e > 0.6: continue
        hh = 0.36 * (1 - e * 0.9) + (0.04 if k % 3 == 0 else 0)
        P, Fm = arc_box(RI + 0.02, TOWER_R + 0.015, a0, a1, H - 0.02, H + hh, seg=4, seed=380 + k)
        parts.append((finalize(make_mesh("merlon", P, Fm, MATS["Ashlar"]), weather_tone(380 + k, H + 0.4, soot_from=2.5), uv_fn=uvf, smooth_angle=35), Matrix()))
    # arrow slits (north, east, and one over the door): a proud dressed surround round a dark recess
    for a, zc in ((math.pi / 2, 1.55), (0.05, 1.4), (math.pi * 0.62, 2.7)):
        for (da0, da1, z0, z1) in ((-0.13, -0.045, zc - 0.5, zc + 0.5), (0.045, 0.13, zc - 0.5, zc + 0.5), (-0.13, 0.13, zc + 0.5, zc + 0.64), (-0.15, 0.15, zc - 0.64, zc - 0.5)):
            P, Fs = arc_box(TOWER_R - 0.02, TOWER_R + 0.05, a + da0, a + da1, z0, z1, seg=2, chip=0.02, seed=int(a * 100 + z0 * 10))
            parts.append((finalize(make_mesh("sl", P, Fs, MATS["Ashlar"]), weather_tone(390, H), tile=ASHLAR_SPAN * 4, smooth_angle=35), Matrix()))
        P, Fs = arc_box(TOWER_R - 0.04, TOWER_R + 0.005, a - 0.05, a + 0.05, zc - 0.5, zc + 0.5, seg=1, chip=0.0)
        parts.append((finalize(make_mesh("slit", P, Fs, MATS["Ashlar"]), lambda p, n: np.full((len(p), 3), 0.07), tile=ASHLAR_SPAN), Matrix()))
    # west door: jambs and a round-headed arch of seven voussoirs, two steps up to the threshold
    dz0, dz1, dw = 0.62, 1.62, 0.42
    for sgn in (-1, 1):
        P, Fj = grid_box(2, 2, 4); P = P * np.array([0.1, 0.11, (dz1 - dz0) / 2]) + np.array([-TOWER_R - 0.04, sgn * (dw + 0.1), (dz0 + dz1) / 2])
        parts.append((finalize(make_mesh("jamb", P, Fj, MATS["Ashlar"]), weather_tone(395 + sgn, H), tile=ASHLAR_SPAN * 3, smooth_angle=35), Matrix()))
    for k in range(7):
        b0 = math.pi * k / 7 + 0.012; b1 = math.pi * (k + 1) / 7 - 0.012; V2, F2 = grid_box(2, 2, 1)
        b = b0 + (b1 - b0) * (V2[:, 0] + 1) / 2; rad = dw + 0.02 + (0.2 + (0.04 if k == 3 else 0)) * (V2[:, 1] + 1) / 2
        P = np.stack([-TOWER_R - 0.04 + 0.1 * V2[:, 2], np.cos(b) * rad, dz1 + np.sin(b) * rad], -1)
        parts.append((finalize(make_mesh("dv", P, F2, MATS["Ashlar"]), weather_tone(400 + k, H), tile=ASHLAR_SPAN * 3, smooth_angle=35), Matrix()))
    for k, (x0, x1, zt) in enumerate(((-2.0, -1.74, 0.22), (-1.86, -1.62, 0.44))):
        P, Fs = grid_box(2, 3, 1); P = P * np.array([(x1 - x0) / 2, 0.52, zt / 2 + 0.03]) + np.array([(x0 + x1) / 2, 0, zt / 2 - 0.03])
        P[:, :2] += 0.015 * np.stack([fbm(P, 410 + k, 2, 2), fbm(P, 412 + k, 2, 2)], -1)
        parts.append((finalize(make_mesh("step", P, Fs, MATS["Ashlar"]), weather_tone(410 + k, 1.0, moss_foot=0.3), tile=ASHLAR_SPAN * 2, smooth_angle=35), Matrix()))
    tw = assemble("Tower", parts, MATS["Ashlar"])
    # door leaf: four oak planks under a round head, two dark iron straps with studs (vertex-coloured)
    planks = []
    for k in range(4):
        y0 = -dw + k * dw / 2 + 0.006; y1 = y0 + dw / 2 - 0.012; V2, F2 = grid_box(2, 1, 6)
        y = y0 + (y1 - y0) * (V2[:, 0] + 1) / 2; t = (V2[:, 2] + 1) / 2; topz = dz1 + np.sqrt(np.clip(dw ** 2 - y ** 2, 0, None))
        z = dz0 + (topz - dz0) * t; P = np.stack([-TOWER_R - 0.035 + 0.03 * V2[:, 1], y, z], -1)
        def ptone(p, n, k=k):
            g = 0.82 + 0.16 * fbm(p * np.array([1, 1, 0.25]), 420 + k, 4, 2); c = np.stack([g, g * 0.92, g * 0.82], -1)
            strap = (np.abs(p[:, 2] - 0.9) < 0.045) | (np.abs(p[:, 2] - 1.45) < 0.045)
            c[strap] = np.array([0.2, 0.19, 0.2]); return c
        planks.append((finalize(make_mesh("pl", P, F2, MATS["Wood"]), ptone, tile=1.0, smooth_angle=30), Matrix()))
    for zz in (0.9, 1.45):  # stud heads proud of the straps
        for y in np.linspace(-dw + 0.08, dw - 0.08, 5):
            V2, F2 = lathe([(0.0, 0.0), (0.022, 0.0), (0.016, 0.018), (0.0, 0.022)], 6)
            planks.append((finalize(make_mesh("st", V2, F2, MATS["Wood"]), lambda p, n: np.full((len(p), 3), 0.18), tile=1.0), Matrix.Translation((-TOWER_R - 0.065, y, zz)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")))
    dr = assemble("Tower_Door", planks, MATS["Wood"]); dr.parent = tw
    vein = []
    for k in range(10):
        z = 0.72 + k * 0.27; wob = math.sin(k * 1.7) * 0.18; L = 0.2 + (k % 3) * 0.06
        v, f = crystal_point(L, L * 0.2); axis = (wob * 0.5, -1.0, 0.6 + 0.2 * math.sin(k))
        vein.append((place(v, (wob, -(tower_r(z) + 0.02), z), axis, spin=k), f))
    V, F = merge(vein); vo = finalize(make_mesh("Tower_Vein", V, F, MATS["Crystal"]), None, tile=1.4, smooth_angle=20); vo.parent = tw
    build_owl_brazier()
    # Offering dish on a short plinth at the tower foot.
    pl = block(371, 0.5, 0.5, 0.78, 0.05); pl.data.transform(Matrix.Translation((0, 0, 0.39))); pl.name = "Plinth"; pl.data.name = "Plinth"
    dish, df = lathe([(0.04, 0.0), (0.24, 0.02), (0.36, 0.08), (0.40, 0.12), (0.37, 0.125), (0.33, 0.1), (0.2, 0.05), (0.02, 0.04)], 18)
    do = finalize(make_mesh("Dish", dish, df, MATS["Bronze"]), lambda p, n: np.full((len(p), 3), 0.92), tile=0.5, smooth_angle=40)
    do.data.transform(Matrix.Translation((0, 0, 0.78))); do.parent = pl
    di = crystal_cluster("Dish_Crystal", 372, 0.05, 3, 0.2, lift=0.82, spread=0.5); di.parent = pl

OWL_EYE = (0.115, -0.655, 1.0)   # Blender, basket-local; client/watch-arch-art.js BASKET.eyes is the three.js mirror

def build_owl_brazier():
    """The beacon basket as a bronze owl: a round-bellied bowl with a feathered rim, a heart-shaped face disc on the arch
    side with big ringed eyes (crystal, they glow when the fire is fed), a hooked beak and ear tufts, on three taloned
    legs. Sizes match BASKET in client/watch-arch-art.js (bowl top 0.95, fire 1.05, rim radius 0.62)."""
    Rb, Hb = 0.62, 0.95; z0 = Hb - 0.2; parts = []
    def btone(p, n):  # verdigris in the hollows, worn bright on the high spots
        g = fbm(p, 701, 5.0, 2); up = np.clip(n[:, 2], 0, 1)
        c = np.stack([0.95 + 0.1 * g] * 3, -1); vg = sm(0.1, 0.35, g * 0.6 - up * 0.4)[:, None]
        return np.clip(c * (1 - 0.35 * vg) + 0.35 * vg * np.array([0.5, 0.8, 0.7]), 0, 1)
    bowl, bf = lathe([(0.08, 0.0), (0.34, 0.03), (0.55, 0.13), (Rb, 0.3), (Rb + 0.035, 0.37), (Rb + 0.05, 0.4), (Rb - 0.02, 0.42), (0.52, 0.22), (0.26, 0.08), (0.06, 0.06)], 28)
    a = np.arctan2(bowl[:, 1], bowl[:, 0]); rim = bowl[:, 2] > 0.36   # scalloped feather rim
    bowl[rim, 2] += 0.035 * np.abs(np.sin(a[rim] * 14))
    parts.append((finalize(make_mesh("bowl", bowl, bf, MATS["Bronze"]), btone, tile=0.6, smooth_angle=40), Matrix.Translation((0, 0, z0))))
    # feather ridges on the belly: shallow raised chevrons in rows
    for row, zr in enumerate((0.1, 0.2)):
        for k in range(14):
            aa = (k + 0.5 * row) / 14 * 2 * math.pi
            if abs(math.atan2(math.sin(aa + math.pi / 2), math.cos(aa + math.pi / 2))) < 0.55: continue  # face goes here
            rb = float(np.interp(zr, [0.03, 0.13, 0.3], [0.34, 0.55, Rb]))
            V2, F2 = lathe([(0.0, 0.0), (0.055, 0.0), (0.04, 0.012), (0.0, 0.016)], 6); V2[:, 1] *= 0.6
            parts.append((finalize(make_mesh("fe", V2, F2, MATS["Bronze"]), btone, tile=0.4), Matrix.Translation((rb * math.cos(aa), rb * math.sin(aa), z0 + zr)) @ Matrix.Rotation(aa - math.pi / 2, 4, "Z") @ Matrix.Rotation(-math.pi / 2 + 0.5, 4, "X")))
    # face disc: a heart-shaped dished plate on the -Y side
    fy = -(Rb + 0.0); fz = OWL_EYE[2] - 0.04
    V2, F2 = lathe([(0.0, 0.03), (0.12, 0.025), (0.22, 0.0), (0.26, -0.03), (0.24, -0.05), (0.0, -0.04)], 24)
    an = np.arctan2(V2[:, 1], V2[:, 0]); V2[:, 0] *= 1.15; V2[:, 1] *= 1 + 0.12 * np.sin(an)  # wider than tall, heart notch on top
    V2[:, 1] -= 0.05 * np.exp(-((an - math.pi / 2) ** 2) / 0.05) * (np.linalg.norm(V2[:, :2], axis=1) > 0.15)
    parts.append((finalize(make_mesh("face", V2, F2, MATS["Bronze"]), btone, tile=0.4, smooth_angle=45), Matrix.Translation((0, fy - 0.02, fz)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for sx in (-1, 1):  # eye rings
        V2, F2 = lathe([(0.055, -0.01), (0.07, 0.02), (0.095, 0.03), (0.11, 0.0), (0.09, -0.02), (0.055, -0.01)], 18)
        parts.append((finalize(make_mesh("ring", V2, F2, MATS["Bronze"]), lambda p, n: np.full((len(p), 3), 1.0), tile=0.3, smooth_angle=50), Matrix.Translation((sx * OWL_EYE[0], OWL_EYE[1], OWL_EYE[2])) @ Matrix.Rotation(math.pi / 2, 4, "X")))
        # ear tufts: swept feather blades above the rim
        V2, F2 = lathe([(0.06, 0.0), (0.05, 0.12), (0.025, 0.24), (0.0, 0.3)], 5); V2[:, 1] *= 0.45
        parts.append((finalize(make_mesh("tuft", V2, F2, MATS["Bronze"]), btone, tile=0.4, smooth_angle=60), Matrix.Translation((sx * 0.21, fy - 0.03, z0 + 0.4)) @ Matrix.Rotation(sx * -0.4, 4, "Y") @ Matrix.Rotation(0.12, 4, "X")))
    V2, F2 = lathe([(0.045, 0.0), (0.035, 0.05), (0.015, 0.1), (0.0, 0.12)], 6); V2[:, 0] *= 0.8   # hooked beak, pointing down
    V2[:, 1] -= 0.25 * (V2[:, 2] / 0.12) ** 2 * 0.12 * 0
    parts.append((finalize(make_mesh("beak", V2, F2, MATS["Bronze"]), lambda p, n: np.full((len(p), 3), 1.0), tile=0.3, smooth_angle=50), Matrix.Translation((0, OWL_EYE[1] - 0.02, OWL_EYE[2] - 0.06)) @ Matrix.Rotation(math.pi - 0.35, 4, "X")))
    # three legs ending in talons gripping the floor, a collar ring, and the fire cage straps
    for i in range(3):
        a = i / 3 * 2 * math.pi + math.pi / 6; ca, sa = math.cos(a), math.sin(a)
        parts.append(rod(700 + i, (0.56 * ca, 0.56 * sa, 0.06), (0.2 * ca, 0.2 * sa, z0 + 0.06), 0.045, 7))
        for t in (-0.6, 0.0, 0.6):  # three forward toes and a hind claw
            tx, ty = math.cos(a + t), math.sin(a + t)
            parts.append(rod(705 + i * 4, (0.56 * ca, 0.56 * sa, 0.06), (0.56 * ca + 0.17 * tx, 0.56 * sa + 0.17 * ty, 0.0), 0.028, 5))
        parts.append(rod(709 + i * 4, (0.56 * ca, 0.56 * sa, 0.06), (0.47 * ca, 0.47 * sa, 0.0), 0.024, 5))
    ring, rf = lathe([(0.24, -0.025), (0.28, -0.025), (0.28, 0.025), (0.24, 0.025), (0.24, -0.025)], 16)
    parts.append((finalize(make_mesh("ring", ring, rf, MATS["Bronze"]), None, tile=0.4), Matrix.Translation((0, 0, z0 * 0.5))))
    for i in range(4):
        a = i / 4 * 2 * math.pi + math.pi / 4; ca, sa = math.cos(a), math.sin(a); pts = []
        for t in np.linspace(0, 1, 5): rr = Rb + 0.03 - (Rb - 0.17) * t ** 1.6; pts.append((rr * ca, rr * sa, Hb + 0.18 + 0.5 * math.sin(t * math.pi / 2)))
        for k in range(4): parts.append(rod(720 + i * 5 + k, pts[k], pts[k + 1], 0.024, 5))
    crown, cf = lathe([(0.16, -0.025), (0.2, -0.025), (0.2, 0.025), (0.16, 0.025), (0.16, -0.025)], 14)
    parts.append((finalize(make_mesh("crown", crown, cf, MATS["Bronze"]), None, tile=0.4), Matrix.Translation((0, 0, Hb + 0.68))))
    bk = assemble("Basket", parts, MATS["Bronze"])
    coals = crystal_cluster("Basket_Coals", 730, 0.32, 9, 0.3, lift=Hb - 0.16, spread=0.8); coals.parent = bk
    eyes = []
    for sx in (-1, 1):
        V2, F2 = lathe([(0.0, 0.035), (0.03, 0.03), (0.055, 0.012), (0.06, 0.0), (0.0, 0.0)], 12)
        eyes.append((place(V2, (sx * OWL_EYE[0], OWL_EYE[1] + 0.012, OWL_EYE[2]), (0, -1, 0)), F2))
    V, F = merge(eyes); ey = finalize(make_mesh("Basket_Eyes", V, F, MATS["Crystal"]), None, tile=0.3, smooth_angle=60); ey.parent = bk

# ---- Heartstone (the God side's living geode heart; client/heartstone-art.js) -----------------------
def tube(name, pts, r0, r1, mat, sides=7, seed=0):
    """Tapered tube along a polyline (Catmull-Rom smoothed), radius r0 at the start to r1 at the end."""
    P = np.array(pts, float); S = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for t in np.linspace(0, 1, 5)[:-1]:
            S.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    S.append(P[-1]); S = np.array(S); n = len(S); V, F = [], []
    for i in range(n):
        tg = S[min(i + 1, n - 1)] - S[max(i - 1, 0)]; tg /= np.linalg.norm(tg)
        a = np.cross(tg, [0, 0, 1.0]); a = a if np.linalg.norm(a) > 1e-3 else np.cross(tg, [1.0, 0, 0]); a /= np.linalg.norm(a); b = np.cross(tg, a)
        rr = r0 + (r1 - r0) * i / (n - 1)
        for k in range(sides):
            ang = k / sides * 2 * math.pi; V.append(S[i] + rr * (1 + 0.15 * math.sin(ang * 3 + i)) * (math.cos(ang) * a + math.sin(ang) * b))
    for i in range(n - 1):
        for k in range(sides): k2 = (k + 1) % sides; F.append([i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k])
    return make_mesh(name, np.array(V), F, MATS[mat])

def build_heartstone():
    # Split geode shell: an open egg with a jagged rim (higher at the back), crust outside, dark amethyst lining inside,
    # a floor at 0.35, set 0.22 into the turf. Origin at the foot centre; three.js +Y up after export.
    outer = [(0.70, 0.0), (0.92, 0.22), (1.18, 0.55), (1.26, 0.80), (1.18, 1.10), (1.0, 1.35)]
    inner = [(0.84, 1.31), (0.98, 1.08), (1.04, 0.80), (0.96, 0.56), (0.62, 0.36), (0.0, 0.35)]
    V, F = lathe(outer + inner, 40)
    ang = np.arctan2(V[:, 1], V[:, 0]); d = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-6)
    top = V[:, 2] > 1.3
    V[top, 2] += (np.abs(np.sin(ang[top] * 3.5)) * 0.42 + 0.25 * fbm(V[top], 71, 3.0)) * (0.6 + 0.4 * np.cos(ang[top] - 0.6))
    rad = np.linalg.norm(V[:, :2], axis=1, keepdims=True) + 1e-6
    V[:, :2] += V[:, :2] / rad * (0.07 * fbm(V, 72, 2.2) + 0.03 * fbm(V, 73, 7.0))[:, None] * (rad > 0.3)
    V[:, 2] -= 0.22
    ob = make_mesh("HeartShell", V, F, MATS["Stone"])
    def tone(p, n):
        c = stone_tone(75, 1.4, 0.2)(p + np.array([0, 0, 0.22]), n)
        r = np.linalg.norm(p[:, :2], axis=1); zz = p[:, 2] + 0.22
        # inside the hollow (radius below the wall at that height): amethyst dark, flecked pale blue
        wall = np.interp(zz, [0.35, 0.56, 0.8, 1.08, 1.35], [0.62, 0.96, 1.04, 0.98, 0.84]) - 0.02
        inside = ((r < wall + 0.08) & (zz > 0.3) & (n[:, 2] > -0.95))
        inside &= (r < 0.6) | (np.einsum("ij,ij->i", n[:, :2], p[:, :2] / (r[:, None] + 1e-6)) < 0)
        fleck = sm(0.15, 0.35, fbm(p, 77, 4.0, 2))[:, None]
        c[inside] = (np.array([0.30, 0.25, 0.62]) * (1 - fleck[inside]) + fleck[inside] * np.array([0.55, 0.80, 1.0]))
        seam = np.abs(fbm(p, 76, 1.6, 2)); glow = (seam < 0.025) & (zz > 0.25) & ~inside  # cracks where the heart's light leaks
        c[glow] = np.array([0.62, 1.0, 0.78])
        rim = (zz > 1.28) & ~inside; c[rim] = c[rim] * 0.6 + 0.4 * np.array([0.86, 0.83, 0.77])
        return np.clip(c, 0, 1)
    finalize(ob, tone, decimate=0.6)
    # Old roots gripping the flanks and diving into the turf.
    r = np.random.default_rng(73); parts = []
    for k in range(6):
        # hug the shell from high on its flank down to the turf (drifting sideways as roots do), then splay out and dive
        a = k / 6 * 2 * math.pi + r.random() * 0.5; top = 0.75 + r.random() * 0.35; drift = (r.random() - 0.5) * 0.7; out = 1.75 + r.random() * 0.4
        shell_r = lambda z: np.interp(z + 0.22, [o[1] for o in outer], [o[0] for o in outer]) + 0.1
        pts = []
        for i, z in enumerate(np.linspace(top, 0.05, 5)):
            aa = a + drift * i / 4; rr = shell_r(z); pts.append((rr * math.cos(aa), rr * math.sin(aa), z))
        aa = a + drift; pts += [((out - 0.25) * math.cos(aa + 0.1), (out - 0.25) * math.sin(aa + 0.1), -0.05), (out * math.cos(aa + 0.18), out * math.sin(aa + 0.18), -0.3)]
        t = tube(f"root{k}", pts, 0.08 + r.random() * 0.035, 0.03, "Wood", seed=k)
        parts.append((finalize(t, lambda p, n: np.clip(np.stack([0.62 + 0.2 * fbm(p, 74, 3, 2)] * 3, -1) * np.array([0.9, 0.78, 0.66]), 0, 1), tile=0.6, smooth_angle=60), Matrix()))
    rt = assemble("HeartShell_Roots", parts, MATS["Wood"]); rt.parent = ob
    # Crystal points lining the hollow, leaning inward and up.
    pts = []
    for k in range(16):
        a = k / 16 * 2 * math.pi + r.random() * 0.3; dd = 0.48 + r.random() * 0.22; L = 0.28 + r.random() * 0.36
        v, f = crystal_point(L, L * 0.2); axis = (-math.cos(a) * 0.55, -math.sin(a) * 0.55, 1.0)
        pts.append((place(v, (math.cos(a) * dd, math.sin(a) * dd, 0.16 + r.random() * 0.25), axis, spin=k), f))
    V, F = merge(pts); li = finalize(make_mesh("HeartShell_Lining", V, F, MATS["Crystal"]), None, tile=1.4, smooth_angle=20); li.parent = ob

def empty(name, loc, parent):
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.1; bpy.context.scene.collection.objects.link(e)
    e.parent = parent; e.location = loc; return e

# ----------------------------------------------------------------------------------------------
MATS = {}

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = {"Stone": tex_stone("Stone", 1024, 41), "Moss": tex_moss("Moss", 512, 52), "Bronze": tex_bronze("Bronze", 512, 63), "Crystal": tex_crystal("Crystal", 256, 74),
           "Wood": tex_wood("Wood", 512, 85), "Ashlar": tex_ashlar("Ashlar", 1024, 96)}
    for n in ("Stone", "Moss", "Bronze", "Wood", "Ashlar"): MATS[n] = make_material(n)
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
    build_watch_arch()
    build_heartstone()
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
