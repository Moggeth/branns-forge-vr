"""Brann's Forge quarry golem - deterministic Blender 4.5 builder.

Run from anywhere:
  blender.exe --background --factory-startup --python-exit-code 2 --python output/build_golem.py

Writes (next to this file): golem.glb, golem_source.blend, textures/*.png, build_report.json
Blender space is Z-up with the golem FACING -Y; the glTF exporter's Y-up conversion turns that into
+Z forward for Godot/glTF.  Left side = +X (the golem's own left when it faces +Z).
Every coordinate below is written for the LEFT side; Part(side=-1) mirrors it.
"""
import bpy, math, os, sys, struct, zlib, json, time
import numpy as np
from mathutils import Euler, Vector

T0 = time.time()
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.path.dirname(os.path.abspath(sys.argv[sys.argv.index("--python") + 1]))
TEXDIR = os.path.join(HERE, "textures")
os.makedirs(TEXDIR, exist_ok=True)

# ----------------------------------------------------------------------------------------------
# procedural tileable textures (numpy; written as real PNGs, loaded, embedded by the glTF exporter)
# ----------------------------------------------------------------------------------------------
def fnoise(n, beta, seed, lo=0.0, hi=None, ax=1.0, ay=1.0):
    rng = np.random.default_rng(seed)
    F = np.fft.rfft2(rng.standard_normal((n, n)))
    fy = np.fft.fftfreq(n)[:, None] * n * ay
    fx = np.fft.rfftfreq(n)[None, :] * n * ax
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    filt = 1.0 / f ** beta
    filt[0, 0] = 0.0
    if hi:
        filt = filt * np.exp(-(f / hi) ** 2)
    if lo:
        filt = filt * (1 - np.exp(-(f / lo) ** 2))
    a = np.fft.irfft2(F * filt, s=(n, n))
    a = (a - a.mean()) / (a.std() * 3 + 1e-9)
    return np.clip(a, -1, 1)


def blur(a, s):
    n = a.shape[0]
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.rfftfreq(n)[None, :]
    filt = np.exp(-2 * (np.pi * s) ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * filt, s=(n, n))


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    return a * (1 - t[..., None]) + b * t[..., None]


def normal_from_height(h, strength):
    n = h.shape[0]
    hs = (h - h.mean()) / (h.std() + 1e-9)
    k = strength * n / 512.0
    dx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5
    dr = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
    nx, ny, nz = -dx * k, dr * k, np.ones_like(hs)
    L = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5


def u8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def write_png(path, arr):
    h, w, c = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, {3: 2, 4: 6}[c], 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


def save_set(name, base, height, rough, metal, nstrength, ao=None, emis=None):
    """Write <name>_bc/_n/_orm(/_em).png. ORM: R=ambient occlusion, G=roughness, B=metallic."""
    lum = float(base.mean())
    assert lum > 0.08, f"{name}: base colour too dark ({lum:.3f}) - would read as black"
    write_png(os.path.join(TEXDIR, f"{name}_bc.png"), u8(base))
    write_png(os.path.join(TEXDIR, f"{name}_n.png"), u8(normal_from_height(height, nstrength)))
    orm = np.stack([np.ones_like(rough) if ao is None else ao, rough, metal], -1)
    write_png(os.path.join(TEXDIR, f"{name}_orm.png"), u8(orm))
    if emis is not None:
        write_png(os.path.join(TEXDIR, f"{name}_em.png"), u8(emis))
    return lum


def tex_stone(name, n, seed, lo, hi, moss_col, strata=6, crack_w=0.022, moss=0.8, nstr=2.4):
    big = fnoise(n, 1.3, seed, hi=n / 24)
    mid = fnoise(n, 1.0, seed + 1, lo=4)
    fine = fnoise(n, 0.3, seed + 2)
    grit = fnoise(n, 0.0, seed + 9)
    warp = fnoise(n, 2.0, seed + 3, hi=10)
    yy = (np.arange(n) / n)[:, None] * np.ones((1, n))
    phase = strata * yy + 0.8 * warp
    frac = phase % 1.0
    ledge = frac ** 1.5
    tone = np.random.default_rng(seed + 7).random(strata)[np.floor(phase).astype(int) % strata]
    c1 = fnoise(n, 1.5, seed + 4, hi=n / 10)
    c2 = fnoise(n, 1.2, seed + 5, lo=6, hi=n / 5)
    crack = np.maximum(np.exp(-(c1 / crack_w) ** 2), 0.7 * np.exp(-(c2 / (crack_w * 1.4)) ** 2) * (fine > -0.15))
    cb = blur(crack, 1.3)
    h = 0.30 * big + 0.10 * mid + 0.035 * fine + 0.10 * ledge + 0.03 * grit - 0.40 * cb
    hn = (h - h.min()) / (h.max() - h.min())
    t = sm(-0.7, 0.7, 0.6 * big + 0.5 * mid)
    base = mix(lo, hi, t)
    base = base * (0.88 + 0.24 * tone)[..., None]
    base = base * (1 + 0.10 * fine + 0.05 * grit)[..., None]
    base = base + (0.08 * sm(0.45, 0.85, hn))[..., None] * np.array([1.0, 0.95, 0.8])
    base = base * (1 - 0.75 * crack)[..., None]
    ao = 0.72 + 0.28 * sm(0.05, 0.6, hn) - 0.3 * crack
    base = base * (0.78 + 0.22 * ao)[..., None]
    wide = blur(crack, 7.0)
    wide = wide / wide.max()
    mm = sm(0.25, 0.75, wide * 1.15 + 0.35 * mid - 0.05) * moss
    mcol = np.asarray(moss_col) * (0.7 + 0.45 * fine + 0.2 * grit)[..., None]
    base = mix(base, mcol, mm * 0.92)
    rough = 0.80 + 0.10 * fine - 0.12 * sm(0.45, 0.95, hn)
    rough = mix(rough[..., None] * np.ones(3), np.full(3, 0.96), mm)[..., 0]
    lum = save_set(name, base, h + 0.6 * mm * fine * 0.3, rough, np.zeros_like(rough), nstr, ao=np.clip(ao, 0, 1))
    return lum, float((mm > 0.3).mean())


def tex_metal(name, n, seed, base_c, dark_c, patina_c, patina, rough0, nstr=1.6):
    brush = fnoise(n, 1.0, seed, ax=0.06, ay=1.0)
    dimple = fnoise(n, 0.7, seed + 1, lo=6, hi=n / 5)
    blot = fnoise(n, 1.4, seed + 2, hi=n / 10)
    scr = fnoise(n, 0.4, seed + 3, ax=0.1, ay=1.0)
    pm = sm(0.05, 0.45, blot * 0.9 - 0.3 * dimple + 0.15) * patina
    t = sm(-0.6, 0.6, 0.5 * brush + 0.4 * dimple)
    base = mix(dark_c, base_c, 0.35 + 0.65 * t)
    base = base * (1 + 0.10 * scr)[..., None]
    base = base * (1 - 0.25 * sm(0.3, 0.9, -dimple))[..., None]
    base = mix(base, patina_c, pm)
    rough = rough0 + 0.10 * brush + 0.35 * pm
    metal = 1.0 - 0.85 * pm
    h = 0.6 * dimple + 0.25 * brush + 0.3 * pm * blot
    lum = save_set(name, base, h, np.clip(rough, 0.2, 1), metal, nstr, ao=0.8 + 0.2 * sm(-0.6, 0.6, dimple))
    return lum, float(pm.mean())


def tex_leather(name, n, seed):
    warp = fnoise(n, 1.6, seed, hi=12)
    xx = (np.arange(n) / n)[None, :] * np.ones((n, 1))
    yy = (np.arange(n) / n)[:, None] * np.ones((1, n))
    cord = 0.5 + 0.5 * np.sin(2 * np.pi * (12 * xx + 4 * yy + 0.5 * warp))
    fib = fnoise(n, 0.7, seed + 1, ax=0.3, ay=1.0)
    grime = fnoise(n, 1.3, seed + 2, hi=n / 12)
    base = mix([0.22, 0.12, 0.06], [0.58, 0.39, 0.21], np.clip(0.25 + 0.6 * cord + 0.2 * fib, 0, 1))
    base = base * (1 - 0.3 * sm(0.0, 0.8, grime))[..., None]
    h = cord + 0.3 * fib
    return save_set(name, base, h, 0.78 + 0.1 * fib, np.zeros((n, n)), 2.2, ao=0.75 + 0.25 * cord), 0.0


def tex_moss(name, n, seed):
    a = fnoise(n, 0.8, seed, hi=n / 4)
    b = fnoise(n, 0.3, seed + 1)
    c = fnoise(n, 1.2, seed + 2, hi=n / 14)
    t = np.clip(0.5 + 0.5 * (0.6 * a + 0.5 * b), 0, 1)
    base = mix([0.07, 0.15, 0.03], [0.30, 0.44, 0.09], t)
    base = base + (0.12 * sm(0.4, 0.9, c))[..., None] * np.array([0.6, 0.5, -0.1])
    h = 0.4 * a + 0.5 * b
    return save_set(name, base, h, 0.93 + 0.05 * b, np.zeros((n, n)), 3.0, ao=0.6 + 0.4 * t), 0.0


def tex_glow(name, n, seed):
    veins = 1 - np.abs(fnoise(n, 1.1, seed, lo=3, hi=n / 6) * 2.2)
    veins = np.clip(veins, 0, 1) ** 3
    cells = fnoise(n, 0.9, seed + 1, hi=n / 8)
    fine = fnoise(n, 0.4, seed + 2)
    em = mix([0.95, 0.36, 0.02], [1.0, 0.62, 0.08], sm(-0.5, 0.5, cells))
    em = em + veins[..., None] * np.array([0.05, 0.22, 0.25]) + (0.06 * fine)[..., None]
    em = np.clip(em, 0, 1)
    base = em * 0.65
    rough = 0.35 + 0.15 * fine
    lum = save_set(name, base, 0.5 * veins + 0.3 * cells, rough, np.zeros((n, n)), 1.2, emis=em)
    return lum, 0.0


def make_textures():
    rep = {}
    rep["Stone_Main"] = tex_stone("Stone_Main", 1024, 10, [0.25, 0.22, 0.19], [0.52, 0.45, 0.36], [0.17, 0.27, 0.07], strata=7, moss=0.85)
    rep["Stone_Dark"] = tex_stone("Stone_Dark", 512, 20, [0.14, 0.14, 0.15], [0.33, 0.31, 0.29], [0.14, 0.23, 0.06], strata=5, moss=0.6)
    rep["Stone_Pale"] = tex_stone("Stone_Pale", 512, 30, [0.40, 0.35, 0.28], [0.66, 0.58, 0.46], [0.20, 0.31, 0.08], strata=4, crack_w=0.018, moss=0.5, nstr=2.0)
    rep["Moss"] = tex_moss("Moss", 512, 40)
    rep["Copper"] = tex_metal("Copper", 512, 50, [0.93, 0.50, 0.30], [0.42, 0.20, 0.11], [0.20, 0.47, 0.38], 0.40, 0.36, nstr=0.5)
    rep["Gold"] = tex_metal("Gold", 256, 60, [1.0, 0.80, 0.30], [0.55, 0.38, 0.12], [0.40, 0.30, 0.14], 0.30, 0.30, nstr=0.5)
    rep["Iron"] = tex_metal("Iron", 256, 70, [0.42, 0.43, 0.46], [0.16, 0.16, 0.18], [0.40, 0.22, 0.12], 0.4, 0.45, nstr=0.6)
    rep["Leather"] = tex_leather("Leather", 256, 80)
    rep["Glow"] = tex_glow("Glow", 512, 90)
    return rep


# ----------------------------------------------------------------------------------------------
# Blender materials built around the embedded images
# ----------------------------------------------------------------------------------------------
MAT_NAMES = ["Stone_Main", "Stone_Dark", "Stone_Pale", "Moss", "Copper", "Gold", "Iron", "Leather", "Glow"]
MAIN, DARK, PALE, MOSS, COPPER, GOLD, IRON, LEATHER, GLOW = range(9)
TILE = {MAIN: 0.9, DARK: 0.7, PALE: 0.7, MOSS: 0.3, COPPER: 0.35, GOLD: 0.3, IRON: 0.3, LEATHER: 0.22, GLOW: 0.25}


def load_img(fn, cs):
    img = bpy.data.images.load(os.path.join(TEXDIR, fn))
    img.colorspace_settings.name = cs
    img.pack()
    return img


def make_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    def tex(fn, cs, x, y):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = load_img(fn, cs)
        t.location = (x, y)
        return t

    bc = tex(f"{name}_bc.png", "sRGB", -700, 300)
    nt.links.new(bc.outputs["Color"], bsdf.inputs["Base Color"])
    nm = tex(f"{name}_n.png", "Non-Color", -700, -100)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    orm = tex(f"{name}_orm.png", "Non-Color", -700, -500)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if name == "Glow":
        em = tex("Glow_em.png", "sRGB", -700, 700)
        nt.links.new(em.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


# ----------------------------------------------------------------------------------------------
# geometry primitives: pure numpy, emitted as per-part vertex/face/UV lists
# ----------------------------------------------------------------------------------------------
_GRID = {}


def cube_grid(n):
    if n in _GRID:
        return _GRID[n]
    idx, verts, faces = {}, [], []

    def vid(c):
        if c not in idx:
            idx[c] = len(verts)
            verts.append(c)
        return idx[c]

    for axis in range(3):
        for side in (0, n):
            for a in range(n):
                for b in range(n):
                    def P(aa, bb):
                        c = [0, 0, 0]
                        c[axis] = side
                        c[(axis + 1) % 3] = aa
                        c[(axis + 2) % 3] = bb
                        return vid(tuple(c))
                    q = [P(a, b), P(a + 1, b), P(a + 1, b + 1), P(a, b + 1)]
                    faces.append(q if side == n else q[::-1])
    _GRID[n] = (np.array(verts, float) / n * 2 - 1, faces)
    return _GRID[n]


def rot_matrix(deg):
    return np.array(Euler([math.radians(d) for d in deg], "XYZ").to_matrix())


def basis_z(a, b):
    zv = np.asarray(b, float) - np.asarray(a, float)
    L = np.linalg.norm(zv)
    zv = zv / L
    xv = np.array([1.0, 0, 0]) - zv * zv[0]
    if np.linalg.norm(xv) < 1e-3:
        xv = np.array([0, 1.0, 0]) - zv * zv[1]
    xv /= np.linalg.norm(xv)
    yv = np.cross(zv, xv)
    return np.stack([xv, yv, zv], 1), L


class Part:
    def __init__(self, name, pivot, side=1, shift=(0, 0, 0)):
        self.shift = np.asarray(shift, float)
        self.name, self.side = name, side
        self.M = np.diag([side, 1.0, 1.0])
        self.world_pivot = self.M @ np.asarray(pivot, float)       # node that owns the vertices
        self.V, self.F, self.UV, self.MT = [], [], [], []
        self.rng = np.random.default_rng(zlib.crc32(name.encode()))
        self.nv = 0

    def loc(self, p):
        return self.M @ (np.asarray(p, float) + self.shift) - self.world_pivot

    def _emit(self, V, F, mat, uvs=None, uvscale=1.0):
        V = np.asarray(V, float)
        c = V.mean(0)
        tot = 0.0
        for f in F:
            p = V[f]
            tot += float(np.dot(np.cross(p[1] - p[0], p[2] - p[0]), p.mean(0) - c))
        if tot < 0:
            F = [f[::-1] for f in F]
            if uvs is not None:
                uvs = [u[::-1] for u in uvs]
        off = self.rng.random(2) * 4
        tile = TILE[mat] * uvscale
        for i, f in enumerate(F):
            if uvs is None:
                p = V[f]
                nn = np.cross(p[1] - p[0], p[2] - p[0])
                ax = int(np.argmax(np.abs(nn)))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                uv = [(q[a] / tile + off[0], q[b] / tile + off[1]) for q in p]
            else:
                uv = [(u[0] * uvscale * 2.0, u[1]) for u in uvs[i]] if mat == MOSS else uvs[i]
            self.F.append([v + self.nv for v in f])
            self.UV.append(uv)
            self.MT.append(mat)
        self.V.append(V)
        self.nv += len(V)

    # -- rounded, chipped, slightly lumpy stone block -------------------------------------------
    def chunk(self, c, half, rot=(0, 0, 0), r=0.26, mat=MAIN, cuts=None, noise=None, chips=None, taper=None, R=None):
        half = np.asarray(half, float)
        if cuts is None:
            m = half.max()
            cuts = 3 if m > 0.28 else (2 if m > 0.085 else 1)
        if chips is None:
            chips = 2 if half.max() > 0.12 else 0
        G, F = cube_grid(cuts + 1)
        P = G.copy()
        inner = np.clip(P, -(1 - r), 1 - r)
        d = P - inner
        L = np.linalg.norm(d, axis=1, keepdims=True)
        nrm = d / L
        P = inner + nrm * r
        for _ in range(chips):
            nv = self.rng.choice([-1, 1], 3) * (0.6 + 0.4 * self.rng.random(3))
            nv = nv / np.linalg.norm(nv)
            off = 1.0 + 0.3 * self.rng.random()
            s = np.maximum(P @ nv - off, 0)
            P = P - s[:, None] * nv
        if taper is not None:
            t = (P[:, 2] + 1) * 0.5
            P[:, 0] *= taper[0] + (taper[2] - taper[0]) * t
            P[:, 1] *= taper[1] + (taper[3] - taper[1]) * t
        S = P * half
        amp = noise if noise is not None else min(0.014, 0.16 * half.min())
        ph = self.rng.random((3, 4)) * 6.28
        kk = self.rng.normal(0, 9, (3, 3))
        w = sum(np.sin(S @ kk[i] + ph[i, 0]) for i in range(3)) / 3.0
        S = S + nrm * half.max() * 0 + (nrm * amp) * w[:, None]
        Rm = R if R is not None else rot_matrix(rot)
        Rm = self.M @ Rm @ self.M
        W = S @ Rm.T + self.loc(c)
        self._emit(W, F, mat)

    def limb(self, a, b, w0, w1, d0=None, d1=None, mat=MAIN, r=0.26, **kw):
        d0 = w0 if d0 is None else d0
        d1 = w1 if d1 is None else d1
        Rm, L = basis_z(a, b)
        c = (np.asarray(a, float) + np.asarray(b, float)) * 0.5
        self.chunk(c, (w0 / 2, d0 / 2, L / 2), r=r, mat=mat, R=Rm, taper=(1, 1, w1 / w0, d1 / d0), **kw)

    def band(self, a, b, t, w, d, h, mat=COPPER, r=0.4):
        a, b = np.asarray(a, float), np.asarray(b, float)
        dirv = (b - a) / np.linalg.norm(b - a)
        c = a + (b - a) * t
        self.limb(c - dirv * h / 2, c + dirv * h / 2, w, w, d, d, mat=mat, r=r, cuts=2, noise=0.004, chips=0)

    def sphere(self, c, radii, mat=GLOW, seg=12, rings=8, rot=(0, 0, 0)):
        radii = np.asarray(radii, float)
        V = [[0, 0, 1.0]]
        for j in range(1, rings):
            th = math.pi * j / rings
            for i in range(seg):
                ph = 2 * math.pi * i / seg
                V.append([math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)])
        V.append([0, 0, -1.0])
        V = np.array(V)
        F, UV = [], []
        ring = lambda j, i: 1 + (j - 1) * seg + (i % seg)
        for i in range(seg):
            F.append([0, ring(1, i + 1), ring(1, i)])
            UV.append([((i + .5) / seg, 1.0), ((i + 1) / seg, 1 - 1 / rings), (i / seg, 1 - 1 / rings)])
        for j in range(1, rings - 1):
            for i in range(seg):
                F.append([ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)])
                UV.append([(i / seg, 1 - j / rings), ((i + 1) / seg, 1 - j / rings), ((i + 1) / seg, 1 - (j + 1) / rings), (i / seg, 1 - (j + 1) / rings)])
        last = len(V) - 1
        for i in range(seg):
            F.append([last, ring(rings - 1, i), ring(rings - 1, i + 1)])
            UV.append([((i + .5) / seg, 0.0), (i / seg, 1 / rings), ((i + 1) / seg, 1 / rings)])
        Rm = self.M @ rot_matrix(rot) @ self.M
        W = (V * radii) @ Rm.T + self.loc(c)
        self._emit(W, F, mat, uvs=UV)

    def frustum(self, a, b, r0, r1, seg=8, mat=IRON, cap_a=True, cap_b=True):
        Rm, L = basis_z(a, b)
        Rm = self.M @ Rm @ self.M if False else Rm
        V, F = [], []
        ang = [2 * math.pi * i / seg for i in range(seg)]
        for i in range(seg):
            V.append([math.cos(ang[i]) * r0, math.sin(ang[i]) * r0, 0])
        for i in range(seg):
            V.append([math.cos(ang[i]) * max(r1, 1e-4), math.sin(ang[i]) * max(r1, 1e-4), L])
        for i in range(seg):
            j = (i + 1) % seg
            F.append([i, j, seg + j, seg + i])
        if cap_a:
            V.append([0, 0, 0])
            F += [[len(V) - 1, (i + 1) % seg, i] for i in range(seg)]
        if cap_b:
            V.append([0, 0, L])
            F += [[len(V) - 1, seg + i, seg + (i + 1) % seg] for i in range(seg)]
        V = np.array(V, float)
        Wl = V @ Rm.T + np.asarray(a, float)
        W = (Wl + self.shift) @ self.M.T - self.world_pivot
        self._emit(W, F, mat)

    def torus(self, c, R, r, rot=(90, 0, 0), mat=COPPER, maj=22, mnr=6):
        V, F, UV = [], [], []
        for i in range(maj):
            for j in range(mnr):
                u, v = 2 * math.pi * i / maj, 2 * math.pi * j / mnr
                V.append([(R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v)])
        for i in range(maj):
            for j in range(mnr):
                i2, j2 = (i + 1) % maj, (j + 1) % mnr
                F.append([i * mnr + j, i2 * mnr + j, i2 * mnr + j2, i * mnr + j2])
                UV.append([(i / maj * 3, j / mnr), ((i + 1) / maj * 3, j / mnr), ((i + 1) / maj * 3, (j + 1) / mnr), (i / maj * 3, (j + 1) / mnr)])
        Rm = self.M @ rot_matrix(rot) @ self.M
        W = np.array(V) @ Rm.T + self.loc(c)
        self._emit(W, F, mat, uvs=UV)

    def tuft(self, c, r, n=3):
        c = np.asarray(c, float)
        for _ in range(n):
            o = (self.rng.random(3) - 0.5) * r * 1.4
            o[2] = abs(o[2]) * 0.4
            rr = r * (0.55 + 0.45 * self.rng.random())
            self.sphere(c + o, (rr, rr * 0.9, rr * 0.6), mat=MOSS, seg=7, rings=4, rot=(0, 0, self.rng.random() * 360))

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


# ----------------------------------------------------------------------------------------------
# golem design (left-side coordinates, metres, Z up, facing -Y)
# ----------------------------------------------------------------------------------------------
PIV = {
    "BodyCore": (0, 0.0, 1.05), "Head": (0, -0.07, 1.81),
    "Arm": (0.70, 0.0, 1.62), "Elbow": (0.80, -0.10, 1.10), "Leg": (0.31, 0.02, 0.95),
}
WRIST = np.array([0.84, -0.22, 0.70])


def build_body():
    p = Part("BodyCoreMesh", PIV["BodyCore"])
    p.chunk((0, 0.03, 0.96), (0.40, 0.27, 0.17), mat=DARK)                     # pelvis
    p.chunk((0, 0.0, 1.16), (0.36, 0.26, 0.10), rot=(0, 0, 3), mat=MAIN)       # abdomen strata
    p.chunk((0, -0.01, 1.32), (0.41, 0.28, 0.10), rot=(0, 0, -3), mat=DARK)
    p.chunk((0, 0.0, 1.54), (0.50, 0.32, 0.24), mat=MAIN)                      # chest mass
    p.chunk((0, 0.06, 1.705), (0.56, 0.25, 0.07), mat=DARK)                     # shoulder yoke
    p.chunk((0, 0.30, 1.56), (0.36, 0.16, 0.30), mat=DARK)                     # backpack hump
    for k, z in enumerate((1.36, 1.54, 1.72)):                                 # spine plates
        p.chunk((0, 0.48, z), (0.12 - 0.015 * k, 0.04, 0.07), rot=(8 - 6 * k, 0, 0), mat=PALE)
    for sx in (1, -1):
        p.chunk((sx * 0.47, 0.0, 1.30), (0.12, 0.25, 0.06), rot=(0, sx * 10, 0), mat=PALE)   # flank ledges
        p.chunk((sx * 0.50, 0.03, 1.47), (0.08, 0.22, 0.14), rot=(0, 0, sx * 6), mat=DARK)
        p.chunk((sx * 0.27, -0.27, 0.93), (0.09, 0.035, 0.11), rot=(0, 0, sx * 7), mat=DARK)  # front tassets
        p.chunk((sx * 0.27, 0.33, 0.93), (0.10, 0.035, 0.11), rot=(0, 0, sx * -7), mat=DARK)
    p.chunk((0, -0.29, 0.90), (0.12, 0.035, 0.14), mat=PALE)
    p.chunk((0, 0.35, 0.88), (0.13, 0.035, 0.15), mat=PALE)
    # belt and buckle
    p.chunk((0, 0.01, 1.07), (0.42, 0.30, 0.045), mat=LEATHER, r=0.4, cuts=3, noise=0.004)
    p.chunk((0, -0.305, 1.07), (0.11, 0.03, 0.07), mat=GOLD, r=0.4, cuts=2, noise=0.003)
    p.chunk((0, -0.335, 1.07), (0.055, 0.012, 0.035), mat=IRON, r=0.4, cuts=1, noise=0.0)
    # back harness: crossed straps + copper ring
    p.limb((0.33, 0.475, 1.88), (-0.30, 0.475, 1.12), 0.075, 0.075, 0.03, 0.03, mat=LEATHER, r=0.4, cuts=2, noise=0.002, chips=0)
    p.limb((-0.33, 0.475, 1.88), (0.30, 0.475, 1.12), 0.075, 0.075, 0.03, 0.03, mat=LEATHER, r=0.4, cuts=2, noise=0.002, chips=0)
    p.torus((0, 0.50, 1.50), 0.07, 0.022, rot=(90, 0, 0), mat=COPPER, maj=14, mnr=5)
    # quarry chisel and mallet hanging at the hip
    p.limb((0.44, 0.17, 1.10), (0.49, 0.19, 0.84), 0.05, 0.045, 0.05, 0.045, mat=LEATHER, r=0.45, cuts=1, noise=0.002, chips=0)
    p.chunk((0.44, 0.17, 1.14), (0.055, 0.035, 0.065), mat=IRON, r=0.3, cuts=1, noise=0.002)
    # moss in protected recesses
    for c, r in (((0.30, 0.33, 1.91), 0.08), ((-0.25, 0.34, 1.90), 0.07), ((0.0, 0.12, 1.92), 0.07),
                 ((0.40, -0.05, 1.42), 0.05), ((-0.36, 0.30, 1.29), 0.05), ((0.12, 0.45, 1.06), 0.05)):
        p.tuft(c, r, n=3)
    return p


def build_chest():
    p = Part("ChestPlate", PIV["BodyCore"], shift=(0, 0.035, -0.11))
    p.chunk((0, -0.335, 1.58), (0.40, 0.07, 0.22), mat=PALE, r=0.4, chips=3)
    for sx in (1, -1):
        for z in (1.77, 1.39):
            p.sphere((sx * 0.33, -0.41, z), (0.032, 0.022, 0.032), mat=GOLD, seg=8, rings=5)
        p.chunk((sx * 0.27, -0.405, 1.70), (0.07, 0.012, 0.014), mat=GLOW, r=0.4, cuts=1, noise=0.0, chips=0)
        p.chunk((sx * 0.29, -0.405, 1.46), (0.06, 0.012, 0.014), mat=GLOW, r=0.4, cuts=1, noise=0.0, chips=0)
    p.torus((0, -0.43, 1.575), 0.205, 0.03, rot=(90, 0, 0), mat=COPPER, maj=28, mnr=6)
    for k in range(8):                                                         # gold claw-set between ring and core
        a = math.radians(45 * k + 22.5)
        p.sphere((0.178 * math.cos(a), -0.435, 1.575 + 0.178 * math.sin(a)), (0.02, 0.02, 0.02), mat=GOLD, seg=7, rings=4)
    return p


def build_core():
    p = Part("CoreGlow", PIV["BodyCore"], shift=(0, 0.035, -0.11))
    cz, cy = 1.575, -0.43
    p.sphere((0, cy - 0.01, cz), (0.125, 0.115, 0.125), mat=GLOW, seg=16, rings=10)
    for k in range(8):                                                         # sun-spike corona = silhouette glow without light
        a = math.radians(45 * k)
        d = np.array([math.cos(a), 0.0, math.sin(a)])
        p.frustum(np.array([0, cy + 0.0, cz]) + d * 0.09, np.array([0, cy - 0.01, cz]) + d * 0.175, 0.036, 0.0, seg=6, mat=GLOW, cap_a=True, cap_b=False)
    return p


def build_head():
    p = Part("HeadMesh", PIV["Head"], shift=(0, -0.05, -0.05))
    p.chunk((0, -0.02, 1.86), (0.17, 0.15, 0.09), mat=DARK)                    # neck plug
    p.chunk((0, -0.03, 1.99), (0.27, 0.23, 0.19), mat=MAIN, r=0.3)             # skull
    p.chunk((0, -0.055, 1.80), (0.22, 0.21, 0.095), mat=MAIN, r=0.3)           # jaw
    p.chunk((0, 0.04, 2.21), (0.035, 0.17, 0.06), rot=(-10, 0, 0), mat=DARK)   # crest fin
    p.chunk((0, -0.04, 2.12), (0.285, 0.245, 0.022), mat=GOLD, r=0.5, cuts=3, noise=0.003, chips=0)   # circlet
    p.sphere((0, -0.29, 2.12), (0.032, 0.02, 0.04), mat=GLOW, seg=10, rings=6)
    # brows: left inner-down (frown), right raised (quizzical)
    p.chunk((0.13, -0.235, 2.07), (0.125, 0.06, 0.042), rot=(0, -14, 0), mat=DARK, chips=1)
    p.chunk((-0.13, -0.235, 2.095), (0.12, 0.06, 0.04), rot=(0, -8, 0), mat=DARK, chips=1)
    # eyes: stone sockets, amber eyeballs, iron slit pupils
    p.chunk((0.115, -0.225, 1.985), (0.085, 0.045, 0.075), mat=DARK, r=0.4, cuts=2)
    p.chunk((-0.115, -0.225, 1.985), (0.075, 0.045, 0.068), mat=DARK, r=0.4, cuts=2)
    p.sphere((0.115, -0.255, 1.985), (0.062, 0.03, 0.068), mat=GLOW, seg=12, rings=7)
    p.sphere((-0.115, -0.255, 1.98), (0.052, 0.03, 0.056), mat=GLOW, seg=12, rings=7)
    p.sphere((0.105, -0.282, 1.985), (0.018, 0.014, 0.042), mat=IRON, seg=8, rings=5)
    p.sphere((-0.105, -0.282, 1.98), (0.016, 0.014, 0.036), mat=IRON, seg=8, rings=5)
    # nose, cheeks
    p.chunk((0.0, -0.28, 1.925), (0.05, 0.06, 0.075), rot=(-14, 0, 0), mat=MAIN, r=0.3, cuts=2)
    for sx in (1, -1):
        p.chunk((sx * 0.205, -0.225, 1.905), (0.07, 0.05, 0.055), rot=(0, 0, sx * 10), mat=PALE, cuts=2, chips=1)
    # mouth: dark band, a row of uneven stone teeth, two underbite tusks
    p.chunk((0, -0.255, 1.855), (0.165, 0.02, 0.04), mat=DARK, r=0.4, cuts=2, noise=0.002, chips=0)
    for k, (x, hh) in enumerate(((-0.12, 0.028), (-0.065, 0.034), (0.0, 0.03), (0.06, 0.036), (0.12, 0.026))):
        p.chunk((x, -0.272, 1.87 + 0.01 * (k % 2)), (0.024, 0.018, hh), mat=PALE, r=0.35, cuts=1, noise=0.001, chips=0)
    for sx in (1, -1):
        p.limb((sx * 0.10, -0.272, 1.80), (sx * 0.105, -0.292, 1.915), 0.05, 0.018, 0.05, 0.018, mat=PALE, r=0.35, cuts=1, noise=0.001, chips=0)
        # copper ear-discs with gold studs
        p.frustum((sx * 0.27, -0.03, 1.985), (sx * 0.335, -0.03, 1.985), 0.085, 0.085, seg=14, mat=COPPER)
        p.frustum((sx * 0.335, -0.03, 1.985), (sx * 0.355, -0.03, 1.985), 0.03, 0.03, seg=8, mat=GOLD)
        p.chunk((sx * 0.26, -0.12, 2.17), (0.05, 0.05, 0.03), mat=PALE, cuts=1, chips=0)
    # moss: hair tuft and chin beard
    p.tuft((0.0, 0.10, 2.27), 0.085, n=4)
    p.tuft((0.0, -0.22, 1.71), 0.06, n=3)
    p.tuft((0.20, -0.12, 2.20), 0.05, n=2)
    p.V = [v * 1.12 for v in p.V]                                              # cute oversized head, scaled about the neck pivot
    return p


def build_upper_arm(side):
    n = "L" if side == 1 else "R"
    p = Part(f"UpperArm{n}", PIV["Arm"], side)
    S, E = np.array(PIV["Arm"]), np.array(PIV["Elbow"])
    p.chunk(S + (0.0, 0, -0.02), (0.18, 0.18, 0.16), mat=DARK)                 # shoulder ball
    p.limb(S + (0.02, 0, -0.04), E + (0, 0, 0.03), 0.33, 0.30, 0.31, 0.28, mat=MAIN, cuts=3)
    p.band(S, E, 0.42, 0.335, 0.315, 0.07, mat=DARK, r=0.3)
    p.band(S, E, 0.86, 0.305, 0.285, 0.05, mat=COPPER)
    p.tuft(S + (0.04, 0.12, -0.42), 0.05, n=2)
    return p


def build_shoulder(side):
    n = "L" if side == 1 else "R"
    p = Part(f"Shoulder{n}", PIV["Arm"], side)
    p.chunk((0.72, 0.0, 1.74), (0.25, 0.31, 0.16), rot=(0, 14, 0), mat=MAIN, cuts=3, chips=3)
    p.chunk((0.70, 0.0, 1.89), (0.20, 0.26, 0.075), rot=(0, 10, 0), mat=PALE, cuts=2)
    p.chunk((0.72, 0.0, 1.595), (0.255, 0.315, 0.03), rot=(0, 14, 0), mat=COPPER, r=0.4, cuts=3, noise=0.004, chips=0)
    for z, x in ((1.66, 0.58), (1.63, 0.72), (1.60, 0.86)):
        p.sphere((x, -0.335, z), (0.032, 0.022, 0.032), mat=GOLD, seg=8, rings=5)
    p.frustum((0.90, 0.0, 1.78), (1.04, 0.0, 1.80), 0.075, 0.012, seg=7, mat=IRON)
    p.frustum((0.78, 0.22, 1.98), (0.84, 0.30, 2.10), 0.045, 0.008, seg=6, mat=IRON)
    p.tuft((0.66, 0.06, 1.98), 0.085, n=3)
    p.tuft((0.92, -0.18, 1.70), 0.04, n=2)
    return p


def build_forearm(side):
    n = "L" if side == 1 else "R"
    E = np.array(PIV["Elbow"])
    p = Part(f"ForearmHand{n}", PIV["Elbow"], side)
    p.chunk(E, (0.175, 0.17, 0.15), mat=DARK)                                  # elbow knob
    p.limb(E + (0, 0, 0.0), WRIST + (0, 0, 0.04), 0.31, 0.27, 0.29, 0.26, mat=MAIN, cuts=3)
    # palm + chisel fingers
    p.chunk((0.86, -0.27, 0.60), (0.165, 0.12, 0.13), mat=MAIN, r=0.3, cuts=3)
    p.chunk((0.86, -0.20, 0.68), (0.15, 0.07, 0.06), mat=DARK, r=0.3, cuts=2)  # knuckle rim
    for k, x in enumerate((0.77, 0.865, 0.955)):
        ln = 0.29 - 0.03 * (k == 2)
        p.limb((x, -0.33, 0.56), (x, -0.40, 0.56 - ln + 0.0), 0.085, 0.072, 0.08, 0.03, mat=MAIN, r=0.2, cuts=2, noise=0.004)
        p.chunk((x, -0.405, 0.56 - ln + 0.01), (0.04, 0.02, 0.027), rot=(-18, 0, 0), mat=IRON, r=0.2, cuts=1, noise=0.0, chips=0)
    p.limb((0.70, -0.26, 0.65), (0.655, -0.35, 0.47), 0.09, 0.06, 0.09, 0.05, mat=MAIN, r=0.25, cuts=2, noise=0.004)
    p.chunk((0.652, -0.355, 0.465), (0.03, 0.02, 0.025), rot=(-18, 0, 0), mat=IRON, r=0.2, cuts=1, noise=0.0, chips=0)
    p.tuft((0.95, -0.10, 0.76), 0.045, n=2)
    return p


def build_bracer(side):
    n = "L" if side == 1 else "R"
    p = Part(f"Forearm{n}", PIV["Elbow"], side)
    E = np.array(PIV["Elbow"])
    a, b = E + (0.0, 0.0, -0.06), WRIST + (0, 0, 0.0)
    p.limb(a + (b - a) * 0.12, a + (b - a) * 0.78, 0.375, 0.345, 0.345, 0.32, mat=DARK, cuts=3, r=0.28, chips=3)
    p.band(a, b, 0.11, 0.39, 0.36, 0.04, mat=COPPER)
    p.band(a, b, 0.79, 0.36, 0.335, 0.04, mat=COPPER)
    p.band(a, b, 0.45, 0.36, 0.34, 0.035, mat=LEATHER, r=0.45)
    for t in (0.26, 0.64):
        c = a + (b - a) * t
        p.sphere(c + (0.0, -0.17, 0.0), (0.03, 0.02, 0.03), mat=GOLD, seg=8, rings=5)
    return p


def build_leg(side):
    n = "L" if side == 1 else "R"
    p = Part(f"Leg{n}Mesh", PIV["Leg"], side)
    H = np.array(PIV["Leg"])
    K, A = np.array([0.33, -0.20, 0.55]), np.array([0.34, 0.0, 0.20])
    p.chunk(H, (0.19, 0.19, 0.16), mat=DARK)                                   # hip ball
    p.limb(H + (0, 0, 0.02), K, 0.38, 0.33, 0.37, 0.34, mat=MAIN, cuts=3)
    p.band(H, K, 0.45, 0.42, 0.40, 0.06, mat=DARK, r=0.3)
    p.band(H, K, 0.72, 0.345, 0.345, 0.045, mat=LEATHER, r=0.45)
    p.chunk(K + (0, -0.09, 0.02), (0.165, 0.085, 0.135), mat=PALE, cuts=2)     # kneecap
    p.torus(K + (0, -0.02, 0.0), 0.175, 0.03, rot=(0, 90, 0), mat=COPPER, maj=18, mnr=5) if False else None
    p.band(K, A, 0.12, 0.34, 0.32, 0.05, mat=COPPER)
    p.limb(K + (0, 0, 0.04), A + (0, 0.0, 0.02), 0.32, 0.36, 0.32, 0.34, mat=MAIN, cuts=3)
    p.band(K, A, 0.55, 0.335, 0.335, 0.04, mat=COPPER)
    p.chunk((0.34, -0.14, 0.40), (0.15, 0.03, 0.10), rot=(-10, 0, 0), mat=DARK, cuts=2, chips=1)  # shin guard
    # foot: heel, sole block, three toes
    p.chunk((0.34, -0.12, 0.10), (0.235, 0.30, 0.10), mat=DARK, r=0.3, cuts=3)
    p.chunk((0.34, 0.13, 0.12), (0.18, 0.10, 0.12), mat=MAIN, cuts=2)
    p.chunk((0.34, -0.06, 0.22), (0.19, 0.14, 0.04), mat=MAIN, cuts=2, chips=1)
    for dx, ln in ((-0.145, 0.09), (0.0, 0.11), (0.145, 0.09)):
        p.chunk((0.34 + dx, -0.47 - ln * 0.1, 0.085), (0.07, ln, 0.08), mat=MAIN, r=0.35, cuts=2)
    p.tuft(K + (0.03, -0.08, 0.16), 0.06, n=3)
    p.tuft((0.44, -0.30, 0.22), 0.045, n=2)
    return p


# ----------------------------------------------------------------------------------------------
# scene assembly
# ----------------------------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_from_part(part, mats):
    used = sorted(set(part.MT))
    slot = {m: i for i, m in enumerate(used)}
    V = np.concatenate(part.V)
    me = bpy.data.meshes.new(part.name)
    me.from_pydata([tuple(v) for v in V], [], [list(f) for f in part.F])
    for m in used:
        me.materials.append(mats[m])
    me.polygons.foreach_set("material_index", [slot[m] for m in part.MT])
    uv = me.uv_layers.new(name="UVMap")
    flat = []
    for f in part.UV:
        for u in f:
            flat += [u[0], u[1]]
    uv.data.foreach_set("uv", flat)
    me.validate(clean_customdata=False)
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(62))
    ob = bpy.data.objects.new(part.name, me)
    return ob


def empty(name, world_loc, parent=None, parent_world=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.12
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = np.asarray(world_loc, float) - np.asarray(parent_world, float)
    e.rotation_mode = "XYZ"
    return e


def build_scene():
    reset_scene()
    mats = [make_material(n) for n in MAT_NAMES]
    sc = bpy.context.scene
    W = lambda key, s=1: np.array(PIV[key]) * np.array([s, 1, 1])
    root = empty("Golem", (0, 0, 0))
    body = empty("BodyCore", W("BodyCore"), root)
    head = empty("Head", W("Head"), root)
    arms, elbows, legs = {}, {}, {}
    for s, n in ((1, "L"), (-1, "R")):
        arms[n] = empty(f"Arm{n}", W("Arm", s), root)
        elbows[n] = empty(f"Elbow{n}", W("Elbow", s), arms[n], W("Arm", s))
        legs[n] = empty(f"Leg{n}", W("Leg", s), root)
    parts = []

    def attach(part, parent):
        ob = mesh_from_part(part, mats)
        sc.collection.objects.link(ob)
        ob.parent = parent
        parts.append(part)
        return ob

    attach(build_body(), body)
    attach(build_chest(), body)
    attach(build_core(), body)
    attach(build_head(), head)
    for s, n in ((1, "L"), (-1, "R")):
        attach(build_upper_arm(s), arms[n])
        attach(build_shoulder(s), arms[n])
        attach(build_forearm(s), elbows[n])
        attach(build_bracer(s), elbows[n])
        attach(build_leg(s), legs[n])
    return root, dict(BodyCore=body, Head=head, ArmL=arms["L"], ArmR=arms["R"], ElbowL=elbows["L"], ElbowR=elbows["R"],
                      LegL=legs["L"], LegR=legs["R"]), parts


# ----------------------------------------------------------------------------------------------
# optional animation clips (NLA tracks named Idle / Walk / Slam; exporter emits one glTF animation each)
# ----------------------------------------------------------------------------------------------
D = math.radians
REST_Z = PIV["BodyCore"][2]


def clip_data():
    """frame -> {node: (loc_dz, rx, ry, rz in degrees)}; rotation about +X tips the top FORWARD (toward -Y)."""
    def K(dz=0, rx=0, ry=0, rz=0):
        return (dz, rx, ry, rz)
    idle = {}
    for f, ph in ((1, 0), (31, 1), (61, 0)):
        idle[f] = {"BodyCore": K(0.012 * ph), "Head": K(rx=-2.5 * ph, rz=1.5 * ph), "ArmL": K(rx=-2 * ph, ry=-1.5 * ph),
                   "ArmR": K(rx=-2 * ph, ry=1.5 * ph), "ElbowL": K(rx=-6 - 2 * ph), "ElbowR": K(rx=-6 - 2 * ph), "LegL": K(), "LegR": K()}
    walk = {}
    sw = {1: (-26, 20), 9: (-2, 2), 17: (22, -26), 25: (2, -2), 33: (-26, 20)}
    for f, (l, r) in sw.items():
        up = 0.035 if f in (9, 25) else 0.0
        side = 3 if f in (9, 25) else 0
        walk[f] = {"BodyCore": K(up, rx=3, ry=(3 if f < 17 else -3) if f in (1, 17, 33) else 0), "Head": K(rx=-2),
                   "ArmL": K(rx=-r * 0.7 - 4), "ArmR": K(rx=-l * 0.7 - 4), "ElbowL": K(rx=-14), "ElbowR": K(rx=-14),
                   "LegL": K(rx=l), "LegR": K(rx=r)}
    slam = {}
    pose = {
        1: dict(BodyCore=K(), Head=K(), ArmL=K(), ArmR=K(), ElbowL=K(rx=-6), ElbowR=K(rx=-6), LegL=K(), LegR=K()),
        26: dict(BodyCore=K(-0.05, rx=-9), Head=K(rx=10), ArmL=K(rx=-165, ry=6), ArmR=K(rx=-165, ry=-6), ElbowL=K(rx=-32), ElbowR=K(rx=-32), LegL=K(rx=-6), LegR=K(rx=-6)),
        32: dict(BodyCore=K(-0.06, rx=-11), Head=K(rx=12), ArmL=K(rx=-172, ry=8), ArmR=K(rx=-172, ry=-8), ElbowL=K(rx=-36), ElbowR=K(rx=-36), LegL=K(rx=-8), LegR=K(rx=-8)),
        36: dict(BodyCore=K(-0.12, rx=16), Head=K(rx=-8), ArmL=K(rx=-28, ry=2), ArmR=K(rx=-28, ry=-2), ElbowL=K(rx=-4), ElbowR=K(rx=-4), LegL=K(rx=-12), LegR=K(rx=-12)),
        44: dict(BodyCore=K(-0.09, rx=12), Head=K(rx=-5), ArmL=K(rx=-30), ArmR=K(rx=-30), ElbowL=K(rx=-5), ElbowR=K(rx=-5), LegL=K(rx=-10), LegR=K(rx=-10)),
        72: dict(BodyCore=K(), Head=K(), ArmL=K(), ArmR=K(), ElbowL=K(rx=-6), ElbowR=K(rx=-6), LegL=K(), LegR=K()),
    }
    return {"Idle": idle, "Walk": walk, "Slam": pose}


def build_animations(nodes):
    sc = bpy.context.scene
    sc.render.fps = 30
    for ob in nodes.values():
        ob.animation_data_create()
    rest_loc = {k: ob.location.copy() for k, ob in nodes.items()}
    for clip, frames in clip_data().items():
        for name, ob in nodes.items():
            ad = ob.animation_data
            act = bpy.data.actions.new(f"{clip}_{name}")
            ad.action = act
            for f, pose in sorted(frames.items()):
                if name not in pose:
                    continue
                dz, rx, ry, rz = pose[name]
                ob.location = rest_loc[name] + Vector((0, 0, dz))
                ob.rotation_euler = (D(rx), D(ry), D(rz))
                ob.keyframe_insert("location", frame=f)
                ob.keyframe_insert("rotation_euler", frame=f)
            tr = ad.nla_tracks.new()
            tr.name = clip
            strip = tr.strips.new(clip, 1, act)
            try:
                strip.action_slot = act.slots[0]
            except Exception:
                pass
            ad.action = None
            ob.location = rest_loc[name]
            ob.rotation_euler = (0, 0, 0)
    sc.frame_start, sc.frame_end = 1, 72


# ----------------------------------------------------------------------------------------------
def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", export_image_format="AUTO", export_materials="EXPORT",
              export_animations=True, export_animation_mode="NLA_TRACKS", export_apply=False, export_cameras=False,
              export_lights=False, export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
              export_vertex_color="NONE", export_force_sampling=True, export_optimize_animation_size=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)


def inspect_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    jl, _ = struct.unpack("<II", data[12:20])
    j = json.loads(data[20:20 + jl])
    tris = 0
    for m in j["meshes"]:
        for pr in m["primitives"]:
            tris += j["accessors"][pr["indices"]]["count"] // 3
    mats = j["materials"]
    tex_ok = all("baseColorTexture" in m["pbrMetallicRoughness"] for m in mats)
    return dict(bytes=len(data), nodes=[n["name"] for n in j["nodes"]], meshes=len(j["meshes"]), materials=[m["name"] for m in mats],
                images=len(j.get("images", [])), textures=len(j.get("textures", [])), animations=[a["name"] for a in j.get("animations", [])],
                triangles=tris, all_materials_have_base_texture=tex_ok,
                emissive_texture=[m["name"] for m in mats if "emissiveTexture" in m],
                mr_texture=[m["name"] for m in mats if "metallicRoughnessTexture" in m["pbrMetallicRoughness"]],
                normal_texture=[m["name"] for m in mats if "normalTexture" in m])


def main():
    tex_rep = make_textures()
    print("textures", {k: (round(v[0], 3), round(v[1], 3)) for k, v in tex_rep.items()}, f"{time.time() - T0:.1f}s")
    root, nodes, parts = build_scene()
    build_animations(nodes)
    # measure world bounds in Blender space
    bpy.context.view_layer.update()
    lo, hi = np.full(3, 1e9), np.full(3, -1e9)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            for v in ob.data.vertices:
                w = np.array(ob.matrix_world @ v.co)
                lo, hi = np.minimum(lo, w), np.maximum(hi, w)
    part_tris = {p.name: p.tris() for p in parts}
    print("bounds lo", lo.round(3), "hi", hi.round(3), "tris", sum(part_tris.values()))
    glb = os.path.join(HERE, "golem.glb")
    export_glb(glb)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "golem_source.blend"), compress=True)
    rep = inspect_glb(glb)
    rep.update(bounds_blender_min=lo.round(3).tolist(), bounds_blender_max=hi.round(3).tolist(), part_triangles=part_tris,
               texture_stats={k: {"mean_base_luminance": round(v[0], 3), "moss_or_patina_coverage": round(v[1], 3)} for k, v in tex_rep.items()},
               build_seconds=round(time.time() - T0, 1))
    with open(os.path.join(HERE, "build_report.json"), "w") as fh:
        json.dump(rep, fh, indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "meshes", "images", "animations", "triangles", "all_materials_have_base_texture", "build_seconds")}))
    assert rep["all_materials_have_base_texture"] and rep["images"] >= 9 and rep["animations"], "export incomplete"


main()
