"""Brann's Forge ordinary mineable BOULDER v2 (fractured silhouette). Standalone fork of reference/build_geology.py that
builds ONLY boulder.glb (meteor and other kit assets untouched). Blender 4.5, deterministic, headless CPU.
blender --background --factory-startup --python-exit-code 2 --python build_boulder.py -- --out ABS_DIR [--no-render] [--samples N] [--threads 2] [--before ABS_GLB]
v2 changes: horizontal concentric strata terraces (the "stacked pancakes") replaced by bold planar fracture cuts, low-frequency
asymmetric lobes, a base-anchored lean, sparse tilted weathered strata, and one diagonal recessed ore seam tinted warm iron.
Authoring in glTF space (x right, +y up, -z front); B() converts to Blender Z-up.
Every rock is ONE closed, star-shaped (radially single-valued) icosphere shell: plane cuts, strata ledges and recessed
seams are all radial edits, so the shell can never fold, open or flip. Crystals are separate closed star-section prisms.
Shared maps: geo_albedo (1024: meteor crust | deposit stone / star-gem | worked interior) and geo_normal (512, same layout).
Materials (<=4 per asset, shared): GeoRock, GeoInterior, GeoStarGem, GeoSeam. All single-sided, opaque.
"""
import bpy, bmesh, sys, os, json, math, random, zlib, struct, time
import numpy as np
from mathutils import Vector, noise as mnoise

T0 = time.time(); TIMES = {}
def log(*a): print('[geo %.1fs]' % (time.time() - T0), *a, flush=True)

def parse_args():
    argv = sys.argv; argv = argv[argv.index('--') + 1:] if '--' in argv else []
    o = dict(out=None, render=True, samples=16, threads=2, before=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'boulder.glb')); i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--out': o['out'] = argv[i + 1]; i += 2
        elif a == '--no-render': o['render'] = False; i += 1
        elif a == '--samples': o['samples'] = int(argv[i + 1]); i += 2
        elif a == '--threads': o['threads'] = int(argv[i + 1]); i += 2
        elif a == '--before': o['before'] = argv[i + 1]; i += 2
        else: i += 1
    if not o['out'] or not os.path.isabs(o['out']): raise SystemExit('--out ABS_PATH required')
    return o

def B(p): return Vector((p[0], -p[2], p[1]))
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def lerp(a, b, t): return a + (b - a) * t
def mixc(a, b, t): return tuple(lerp(a[i], b[i], t) for i in range(3))
def N3(p, s=1.0, o=0.0): return mnoise.noise(Vector((p[0] * s + o, p[1] * s + o * 1.7, p[2] * s - o * 0.6)))
def smooth(t): t = clamp(t); return t * t * (3 - 2 * t)

# ================================================================ textures (numpy, tileable, fixed seeds)
def vnoise(rng, size, fx, fy):
    g = rng.random((fy, fx)); xs = np.arange(size) / size * fx; ys = np.arange(size) / size * fy
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    a = xs - x0; b = ys - y0; a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b)
    x1 = (x0 + 1) % fx; y1 = (y0 + 1) % fy; x0 %= fx; y0 %= fy
    top = g[y0][:, x0] * (1 - a)[None, :] + g[y0][:, x1] * a[None, :]
    bot = g[y1][:, x0] * (1 - a)[None, :] + g[y1][:, x1] * a[None, :]
    return top * (1 - b)[:, None] + bot * b[:, None]

def fbm(rng, size, f, octv=4):
    tot = 0; amp = 1; nrm = 0
    for o in range(octv):
        tot = tot + amp * vnoise(rng, size, f * 2 ** o, f * 2 ** o); nrm += amp; amp *= 0.5
    return tot / nrm

def voronoi(rng, size, n):
    """Tileable F1/F2 distances (in cells of 1/size)."""
    pts = rng.random((n, 2)); ys, xs = np.mgrid[0:size, 0:size] / size
    f1 = np.full((size, size), 9.0); f2 = np.full((size, size), 9.0); VOR_ID[0] = np.zeros((size, size), int)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xs - px); dx = np.minimum(dx, 1 - dx); dy = np.abs(ys - py); dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy); f2 = np.where(d < f1, f1, np.minimum(f2, d)); VOR_ID[0] = np.where(d < f1, k, VOR_ID[0]); f1 = np.minimum(f1, d)
    return f1, f2
VOR_ID = [None]

def write_png(path, arr):
    h, w, _ = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
def to_u8(c): return (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
Q = 512

def col(*c): return np.array(c, dtype=np.float64)
def ramp(t, stops):
    t = np.clip(t, 0, 1); out = np.zeros(t.shape + (3,))
    for (a, ca), (b, cb) in zip(stops[:-1], stops[1:]):
        m = (t >= a) & (t <= b); k = ((t - a) / max(b - a, 1e-6))[..., None]
        out = np.where(m[..., None], col(*ca) * (1 - k) + col(*cb) * k, out)
    return out

def q_crust():
    """Meteor fusion crust: regmaglypt thumbprints, scorched black-brown iron, rust bloom, silver flecks on ridges."""
    r = np.random.default_rng(11); f1, f2 = voronoi(r, Q, 46); cell = np.clip((f2 - f1) * 9, 0, 1)
    pit = np.clip(f1 * 7.5, 0, 1) ** 0.7; n = fbm(r, Q, 6); fine = fbm(r, Q, 48, 3)
    h = 0.55 * pit + 0.25 * n + 0.2 * fine - 0.35 * (1 - cell) ** 6
    c = ramp(0.25 + 0.7 * pit * (0.6 + 0.6 * n), [(0, (0.035, 0.03, 0.032)), (0.5, (0.11, 0.085, 0.07)), (0.8, (0.22, 0.16, 0.11)), (1, (0.30, 0.25, 0.22))])
    rust = np.clip((fbm(r, Q, 4) - 0.52) * 4, 0, 1)[..., None]; c = c * (1 - rust * 0.55) + col(0.36, 0.14, 0.05) * rust * 0.55
    fl = (fine > 0.74) & (pit > 0.6); c[fl] = c[fl] * 0.4 + col(0.55, 0.58, 0.62) * 0.6
    return c * (0.8 + 0.3 * fine[..., None]), h

def q_stone():
    """Deposit stone: warm grey/ochre sedimentary strata with grit, iron staining and hairline fractures."""
    r = np.random.default_rng(12); ys, xs = np.mgrid[0:Q, 0:Q] / Q; warp = fbm(r, Q, 3) * 0.22
    bandc = ys * 4 + xs * 1 + warp * 6   # v2: fewer, tilted (still tileable: integer x/y frequencies), more warped bands
    band = bandc % 1.0; bi = np.floor(bandc) % 7
    tone = (bi * 0.41) % 1.0 * 0.85 + 0.15 * band; n = fbm(r, Q, 8); grit = fbm(r, Q, 64, 2)
    c = ramp(0.2 + 0.6 * tone + 0.25 * (n - 0.5), [(0, (0.20, 0.20, 0.21)), (0.35, (0.38, 0.37, 0.35)), (0.65, (0.55, 0.47, 0.35)), (1, (0.68, 0.64, 0.57))])
    edge = np.clip(1 - np.minimum(band, 1 - band) * 28, 0, 1)
    c = c * (1 - 0.45 * edge[..., None]); stain = np.clip((fbm(r, Q, 5) - 0.55) * 3, 0, 1)[..., None]
    c = c * (1 - stain * 0.4) + col(0.45, 0.24, 0.10) * stain * 0.4
    f1, f2 = voronoi(r, Q, 9); crack = np.clip(1 - (f2 - f1) * 140, 0, 1) * (fbm(r, Q, 4) > 0.58)   # v2: sparser hairline fractures
    c = c * (1 - 0.35 * crack[..., None]) * (0.85 + 0.3 * grit[..., None])
    h = 0.5 * (1 - edge) + 0.3 * n + 0.2 * grit - 0.6 * crack
    return c, h

def q_gem():
    """Star-gem: s = around the crystal, t = base(0)->tip(1). Deep violet core -> ice cyan -> gold fire tip,
    internal fracture planes and four-point star glints so the gem reads as cut treasure, not a glowing ball."""
    r = np.random.default_rng(13); ys, xs = np.mgrid[0:Q, 0:Q] / Q; t = 1 - ys
    n = fbm(r, Q, 5)
    c = ramp(t + 0.12 * (n - 0.5), [(0, (0.16, 0.05, 0.32)), (0.35, (0.36, 0.20, 0.80)), (0.62, (0.30, 0.78, 0.95)), (0.86, (0.85, 0.95, 1.0)), (1, (1.0, 0.80, 0.38))])
    facet = np.abs(((xs * 10) % 1.0) - 0.5) * 2; c = c * (0.78 + 0.32 * facet[..., None] ** 3)
    frac = np.clip(1 - np.abs(((xs * 3 + ys * 5 + n * 0.8) % 1.0) - 0.5) * 30, 0, 1)
    c = c + col(0.5, 0.6, 0.7) * frac[..., None] * 0.35 * t[..., None]
    for _ in range(70):
        cx, cy, s = r.random() * Q, r.random() * Q, 2 + r.random() * 5
        y0, y1, x0, x1 = int(max(cy - 14, 0)), int(min(cy + 14, Q)), int(max(cx - 14, 0)), int(min(cx + 14, Q))
        yy, xx = np.mgrid[y0:y1, x0:x1]; dx = np.abs(xx - cx); dy = np.abs(yy - cy)
        star = np.clip(1 - dx * dy / (s * 1.5) - (dx + dy) / (s * 6), 0, 1) ** 2
        c[y0:y1, x0:x1] += star[..., None] * col(1.0, 0.95, 0.85)
    return c, 0.6 * facet + 0.4 * n

def q_interior():
    """Worked/struck interior: fresh conchoidal fracture, pale blue-grey with bright star-iron flecks and pick scores."""
    r = np.random.default_rng(14); ys, xs = np.mgrid[0:Q, 0:Q] / Q; n = fbm(r, Q, 6); fine = fbm(r, Q, 40, 3)
    f1, f2 = voronoi(r, Q, 34); cid = VOR_ID[0]; cr = np.random.default_rng(41).random((34, 3))
    ripple = cr[cid, 0] * 0.8 + (xs * (cr[cid, 1] - .5) + ys * (cr[cid, 2] - .5)) * 6   # tilted conchoidal facets per cell
    c = ramp(0.2 + 0.55 * cr[cid, 0] + 0.2 * n, [(0, (0.12, 0.13, 0.17)), (0.45, (0.27, 0.29, 0.36)), (0.8, (0.45, 0.47, 0.56)), (1, (0.66, 0.68, 0.78))])
    score = np.clip(1 - np.abs(((xs * 0.6 + ys * 1.0 + 0.05 * n) * 9) % 1.0 - 0.5) * 40, 0, 1) * (fbm(r, Q, 3) > 0.5)
    c = c * (1 - 0.35 * score[..., None]) + 0.12 * score[..., None]
    fl = fine > 0.76; c[fl] = col(0.80, 0.82, 0.90)
    gl = (fine < 0.24) & (n > 0.55); c[gl] = col(0.55, 0.42, 0.95)
    edge = np.clip(1 - (f2 - f1) * 50, 0, 1); c = c * (1 - 0.4 * edge[..., None])
    return c, 0.5 * ripple + 0.2 * n + 0.1 * fine - 0.6 * edge - 0.3 * score

def atlas(qs):
    top = np.concatenate([qs[0], qs[1]], 1); bot = np.concatenate([qs[2], qs[3]], 1); return np.concatenate([top, bot], 0)

def normal_from(h, k):
    gy, gx = np.gradient(h); n = np.stack([-gx * k, gy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True); return n * 0.5 + 0.5

# ================================================================ mesh builder
QUAD = dict(crust=0, stone=1, gem=2, interior=3)
def quv(q, s, t):
    s = clamp(s, 0.01, 0.99); t = clamp(t, 0.01, 0.99); r, c = divmod(q, 2)
    return ((c + s) * 0.5, 1 - (r + t) * 0.5)

class MB:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.float_color.new('Color')
    def tri_box(self, pts, cols, q, mat, scale):
        """Flat facet with per-face box projection, wrapped into its quadrant (all maps are tileable)."""
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0]); ax = max(range(3), key=lambda a: abs(n[a]))
        ab = [((p[2], p[1]) if ax == 0 else (p[0], p[2]) if ax == 1 else (p[0], p[1])) for p in pts]
        ab = [(a / scale, b / scale) for a, b in ab]; oa = math.floor(sum(a for a, _ in ab) / 3); ob = math.floor(sum(b for _, b in ab) / 3)
        uvs = [quv(q, a - oa, 1 - (b - ob)) for a, b in ab]; self.add(pts, uvs, cols, mat)
    def add(self, pts, uvs, cols, mat):
        vs = [self.bm.verts.new(B(p)) for p in pts]
        f = self.bm.faces.new(vs); f.smooth = False; f.material_index = mat
        for lp, uv, c in zip(f.loops, uvs, cols): lp[self.uv].uv = uv; lp[self.col] = (clamp(c[0]), clamp(c[1]), clamp(c[2]), 1.0)   # glTF COLOR_0 must stay in [0,1]
    def build(self, name, mats, parent):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        for m in mats: me.materials.append(m)
        me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = parent
        return ob

ICO = {}
def ico(sub):
    if sub not in ICO:
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); bm.verts.ensure_lookup_table()
        # outward winding guaranteed by construction; verified below via signed volume
        ICO[sub] = ([Vector(v.co) for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces]); bm.free()
    return ICO[sub]

M_ROCK, M_INT, M_GEM, M_SEAM = 0, 1, 2, 3

def rock_shell(spec, sub):
    """Star-shaped shell r(u). spec keys: seed, radii, cuts, base, strata, seams, worked, bump, regma, skin.
    Returns world points, faces, per-vertex tags (seam weight, worked plane index), unit dirs."""
    rng = random.Random(spec['seed']); U, F = ico(sub); rx, ry, rz = spec['radii']
    planes = [(Vector(n).normalized(), d) for n, d in spec.get('cuts', [])]
    for _ in range(spec.get('rand_cuts', 0)):
        planes.append((Vector((rng.uniform(-1, 1), rng.uniform(-0.5, 1), rng.uniform(-1, 1))).normalized(), rng.uniform(0.70, 0.9)))
    worked = [(Vector(n).normalized(), d) for n, d in spec.get('worked', [])]
    seams = [(Vector(n).normalized(), w, dep) for n, w, dep in spec.get('seams', [])]
    P = []; SW = []; WK = []; S = spec.get('seed', 0) * 0.37
    for u in U:
        g = Vector((u.x, u.z, -u.y))   # bmesh z-up -> authoring y-up (proper rotation keeps outward winding)
        r = 1 + spec.get('bump', 0.06) * N3(g, 1.9, S) + spec.get('bump', 0.06) * 0.4 * N3(g, 4.7, S + 3)
        if spec.get('chunk'): r += spec['chunk'] * N3(g, 1.05, S + 11)   # big asymmetric lobes
        if spec.get('regma'): r += spec['regma'] * (abs(N3(g, 7.0, S + 9)) - 0.25)
        st = spec.get('strata')
        if st:  # terraces: radius shrinks inside each band then jumps back -> overhanging ledges
            ax = Vector(st['axis']).normalized(); y = g.dot(ax) * st['freq'] + 0.35 * N3(g, 1.3, S + 5)
            f = y % 1.0; bk = math.floor(y); hk = (math.sin(bk * 12.9898 + spec['seed']) * 43758.5453) % 1.0
            ak = st['amp'] * (0.35 + 1.1 * hk) * (1.0 if hk >= st.get('sparse', 0.0) else 0.0)   # irregular ledge per band; 'sparse' drops weak bands
            r *= 1 - ak * (smooth(f / 0.85) if f < 0.85 else 1 - smooth((f - 0.85) / 0.15))
        sw = 0.0
        for n, w, dep in seams:
            s = g.dot(n) + spec.get('seam_wobble', 0.16) * N3(g, 2.6, S + 7) + 0.05 * N3(g, 9, S + 2)
            if abs(s) < w and g.y > -0.55: k = 1 - (abs(s) / w) ** 2; r *= 1 - dep * k; sw = max(sw, k)
        q = Vector((g.x * rx, g.y * ry, g.z * rz)) * r
        wi = -1
        for i, (n, d) in enumerate(planes + worked):
            dd = d * (rx + ry + rz) / 3; e = q.dot(n)
            if e > dd: q = q * (dd / e); wi = i - len(planes) if i >= len(planes) else -1
        base = spec.get('base', 0.62) * ry
        if q.y < -base: q = q * (-base / q.y); sw = 0.0
        if spec.get('lean'): q = Vector((q.x + spec['lean'][0] * (q.y + base), q.y, q.z + spec['lean'][1] * (q.y + base)))   # shear, det=1: base stays flat & centred, winding kept
        P.append(q); SW.append(sw); WK.append(wi)
    miny = min(p.y for p in P)
    P = [Vector((p.x, p.y - miny, p.z)) for p in P]
    return P, F, SW, WK

def shell_into(mb, P, F, SW, WK, q_rock, uvscale, colfn, seam_mat=M_SEAM):
    for f in F:
        pts = [P[i] for i in f]; sw = min(SW[i] for i in f); wk = [WK[i] for i in f]
        if wk[0] >= 0 and wk.count(wk[0]) == 3: mat, q = M_INT, QUAD['interior']
        elif sw > 0.05: mat, q = seam_mat, (QUAD['gem'] if seam_mat == M_SEAM else QUAD['interior'])
        else: mat, q = M_ROCK, q_rock
        cols = [colfn(P[i], SW[i], mat) for i in f]
        mb.tri_box(pts, cols, q, mat, uvscale)

def star_crystal(mb, base, d, L, r, seed, points=5, inner=0.55, bury=0.35, tipcol=(1.0, 0.85, 0.5)):
    """Closed star-section bipyramid-prism. Base buried inside the host rock so it is visibly embedded."""
    rng = random.Random(seed); d = d.normalized(); a = d.cross(Vector((0.31, 0.95, 0.07))).normalized(); b = d.cross(a)
    rot = rng.uniform(0, math.tau); k = 2 * points
    def ring(c, rad):
        out = []
        for i in range(k):
            ang = rot + i * math.tau / k; rr = rad * (1.0 if i % 2 == 0 else inner)
            out.append(c + (a * math.cos(ang) + b * math.sin(ang)) * rr)
        return out
    p0 = base - d * (L * bury); p1 = base + d * (L * 0.62); tip = base + d * L + a * rng.uniform(-0.1, 0.1) * r
    r0 = ring(p0, r * 0.82); r1 = ring(p1, r); bot = p0 - d * (r * 0.4)
    def uvp(i, t): return quv(QUAD['gem'], (i / k) * 0.9 + 0.05, 1 - t)
    lo, mid, hi = (0.42, 0.2, 0.62), (0.55, 0.85, 1.0), tipcol
    for i in range(k):
        j = (i + 1) % k
        mb.add([r0[i], r0[j], r1[j]], [uvp(i, 0), uvp(i + 1, 0), uvp(i + 1, .62)], [lo, lo, mid], M_GEM)
        mb.add([r0[i], r1[j], r1[i]], [uvp(i, 0), uvp(i + 1, .62), uvp(i, .62)], [lo, mid, mid], M_GEM)
        mb.add([r1[i], r1[j], tip], [uvp(i, .62), uvp(i + 1, .62), uvp(i + .5, 1)], [mid, mid, hi], M_GEM)
        mb.add([r0[j], r0[i], bot], [uvp(i + 1, 0), uvp(i, 0), uvp(i + .5, 0)], [lo, lo, lo], M_GEM)

def fix_winding(ob):
    """Belt-and-braces: recalc outward normals per connected closed piece (all pieces are closed by construction)."""
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()

# ---------------------------------------------------------------- colour (COLOR_0 multiplier: AO, burn, wear)
def crust_col(p, sw, mat, top):
    h = clamp(p.y / top)
    if mat == M_ROCK: v = 0.55 + 0.45 * h + 0.08 * N3(p, 3, 1); return (v * 1.02, v, v * 0.97) if sw <= 0 else (v * 1.2, v * 0.9, v * 0.6)
    if mat == M_SEAM: return (1.0, 0.92, 0.75)
    return (0.95, 0.95, 1.0)
def stone_col(p, sw, mat, top):
    h = clamp(p.y / top); v = 0.5 + 0.5 * h + 0.1 * N3(p, 2.5, 4)
    if mat == M_INT and sw > 0.05: k = 0.75 + 0.25 * sw; return (1.0 * k, 0.70 * k, 0.36 * k)   # v2 ore seam: warm iron/bronze vein
    if mat == M_INT: return (0.95, 0.93, 0.9)
    if sw > 0: return (v * 0.62, v * 0.55, v * 0.5)   # seam lip: rust-dark staining either side of the vein
    if mat == M_SEAM: return (0.9, 0.85, 0.8)
    moss = clamp((h - 0.8) * 3) * clamp(N3(p, 3, 8) + 0.3)
    return (v * (1 - 0.45 * moss), v * (1 - 0.1 * moss), v * (1 - 0.55 * moss))

# ================================================================ assets
def gem_cluster(mb, centre, normal, rng, n, L, r, seed):
    for i in range(n):
        d = (normal * 1.4 + Vector((0, 0.35, 0)) + Vector((rng.uniform(-.5, .5), rng.uniform(-.2, .4), rng.uniform(-.5, .5)))).normalized()
        off = Vector((rng.uniform(-1, 1), rng.uniform(-.6, .6), rng.uniform(-1, 1))) * r * 2.2
        k = 1.0 if i == 0 else rng.uniform(0.45, 0.8)
        star_crystal(mb, centre + off, d, L * k, r * (0.9 if i == 0 else rng.uniform(0.5, 0.8)), seed + i)

def surface_point(P, U_dir):
    best = max(range(len(P)), key=lambda i: (P[i] - CEN[0]).normalized().dot(U_dir)); return P[best]
CEN = [Vector()]

def build_meteor(root, M, lod=False, stage=0):
    """Hero meteor (template 'meteor', 1.5 m tall at runtime). Opaque iron fusion crust with regmaglypt thumbprints,
    three recessed glowing star-seams, a pick-struck front facet exposing crystalline interior and a star-gem cluster."""
    sub = 4 if lod else 5
    worked = [((0.15, 0.55, -1.0), 0.76)] + ([((-0.85, 0.25, -0.55), 0.70)] if stage >= 1 else []) + ([((0.9, 0.5, 0.2), 0.70)] if stage >= 2 else [])
    spec = dict(seed=101, radii=(1.0, 0.95, 0.92), rand_cuts=7, bump=0.09, regma=0.05, base=0.58,
                seams=[((0.75, 0.2, 0.55), 0.10, 0.08), ((-0.4, 0.9, 0.2), 0.095, 0.075), ((0.3, -0.2, 0.9), 0.085, 0.07)], worked=worked)
    P, F, SW, WK = rock_shell(spec, sub); top = max(p.y for p in P); CEN[0] = Vector((0, top * 0.5, 0))
    mb = MB(); shell_into(mb, P, F, SW, WK, QUAD['crust'], 0.85, lambda p, sw, m: crust_col(p, sw, m, top))
    rng = random.Random(7 + stage)
    # hero cluster bursting from the struck face, smaller clusters erupting from seams
    for wi, (n, _) in enumerate(worked):
        idx = [i for i in range(len(P)) if WK[i] == wi]
        if not idx: continue
        c = sum((P[i] for i in idx), Vector()) / len(idx)
        gem_cluster(mb, c, Vector(n).normalized(), rng, (3 if lod else 6) if wi == 0 else 2, 0.55 if wi == 0 else 0.34, 0.09, 300 + wi * 20)
    seam_pts = [i for i in range(len(P)) if SW[i] > 0.9 and P[i].y > top * 0.25]
    seam_pts.sort(key=lambda i: (round(P[i].x, 4), round(P[i].y, 4), round(P[i].z, 4)))
    chosen = []
    for i in random.Random(9).sample(seam_pts, min(len(seam_pts), 60)):
        if all((P[i] - P[j]).length > 0.45 for j in chosen): chosen.append(i)
        if len(chosen) >= (2 if lod else 5): break
    for k, i in enumerate(chosen):
        nrm = (P[i] - CEN[0]).normalized(); star_crystal(mb, P[i] - nrm * 0.03, (nrm + Vector((0, 0.3, 0))).normalized(), rng.uniform(0.2, 0.3), 0.055, 400 + k)
    if not lod:  # ejecta crumbs at the base: closed mini shells, inside the 1.5 m mining radius
        for k, (x, z, s) in enumerate([(-0.95, -0.55, 0.16), (0.9, -0.62, 0.12), (0.2, 0.95, 0.14)]):
            p2, f2, s2, w2 = rock_shell(dict(seed=150 + k, radii=(s, s * 0.7, s * 0.9), rand_cuts=3, bump=0.1, base=0.5), 2)
            p2 = [p + Vector((x, 0, z)) for p in p2]; shell_into(mb, p2, f2, s2, w2, QUAD['crust'], 0.85, lambda p, sw, m: crust_col(p, sw, m, top))
    return mb.build('MeteorMesh' + ('LOD' if lod else ''), M, root)

DEPOSITS = {
    # A: layered sedimentary outcrop with a pick-worked face
    # v2: bold fractured asymmetric slab: explicit planar fracture faces, lean, sparse tilted strata, one diagonal ore seam
    'boulder': dict(seed=201, radii=(0.92, 0.86, 0.76), rand_cuts=2, bump=0.05, chunk=0.16, base=0.52, lean=(0.16, 0.05),
                    cuts=[((0.45, 1.0, 0.2), 0.70), ((-1.0, 0.35, 0.25), 0.80), ((0.95, 0.15, 0.5), 0.80),
                          ((-0.35, 0.25, 1.0), 0.74), ((0.75, 0.65, -0.55), 0.80), ((-0.7, 0.9, -0.35), 0.72)],
                    strata=dict(axis=(0.45, 1, 0.3), freq=2.6, amp=0.05, sparse=0.45), worked=[((0.2, 0.35, -1.0), 0.80)],
                    seams=[((0.7, 0.7, 0.06), 0.13, 0.065)], seam_wobble=0.07),
    # B: jagged tilted columnar outcrop, sharp facets, quartz-iron veins
    'boulder_b': dict(seed=233, radii=(0.75, 0.75, 0.70), rand_cuts=12, bump=0.05, base=0.6,
                      strata=dict(axis=(0.55, 1, -0.2), freq=3.5, amp=0.10), worked=[((-0.3, 0.3, -1.0), 0.80)],
                      seams=[((0.9, 0.3, 0.2), 0.055, 0.05), ((-0.2, 0.4, 0.9), 0.05, 0.04)]),
    # C: cleaved boulder: deep vertical cleft (recessed vein) splitting two lobes, low and wide
    'boulder_c': dict(seed=271, radii=(1.0, 0.78, 0.85), rand_cuts=6, bump=0.07, base=0.5,
                      strata=dict(axis=(0, 1, 0.1), freq=5.0, amp=0.09), worked=[((0.6, 0.6, -0.8), 0.80)],
                      seams=[((1.0, 0.0, 0.15), 0.07, 0.16)]),
}

def build_deposit(name, root, M, lod=False, stage=0):
    spec = dict(DEPOSITS[name]); sub = 4 if lod else 5
    if stage: spec['worked'] = spec['worked'] + [((-0.9, 0.4, -0.3), 0.74)] + ([((0.8, 0.5, 0.4), 0.74)] if stage >= 2 else [])
    P, F, SW, WK = rock_shell(spec, sub); top = max(p.y for p in P)
    mb = MB(); shell_into(mb, P, F, SW, WK, QUAD['stone'], 0.7, lambda p, sw, m: stone_col(p, sw, m, top), seam_mat=M_INT)
    return mb.build(name.title().replace('_', '') + 'Mesh' + ('LOD' if lod else ''), M, root)

def build_star_gem_meteoric(root, M, lod=False):
    """Harvested meteoric star-gem (pickup 'gems' alternative, 0.25 m tall): a single cut-looking five-point star crystal
    with two satellites, still gripped by a shard of fusion crust and a glowing seam lip."""
    P, F, SW, WK = rock_shell(dict(seed=501, radii=(0.11, 0.06, 0.09), rand_cuts=4, bump=0.1, regma=0.04, base=0.45,
                                   seams=[((0.2, 1.0, 0.1), 0.2, 0.08)]), 2 if lod else 3)
    top = max(p.y for p in P); mb = MB(); shell_into(mb, P, F, SW, WK, QUAD['crust'], 0.25, lambda p, sw, m: crust_col(p, sw, m, top))
    c = Vector((0.0, top * 0.7, 0.0))
    star_crystal(mb, c, Vector((0.05, 1, -0.12)), 0.20, 0.048, 511, bury=0.3)
    star_crystal(mb, c + Vector((0.035, 0, 0.02)), Vector((0.8, 0.9, 0.2)), 0.11, 0.026, 512)
    if not lod: star_crystal(mb, c + Vector((-0.03, 0, -0.01)), Vector((-0.7, 0.8, -0.4)), 0.085, 0.022, 513)
    return mb.build('StarGemMeteoricMesh' + ('LOD' if lod else ''), M, root)

def build_star_iron_ore(root, M, lod=False):
    """Harvested star-iron ore (0.22 m): dense struck metal lump, half crust, half bright worked iron, glowing seam."""
    P, F, SW, WK = rock_shell(dict(seed=601, radii=(0.11, 0.075, 0.09), rand_cuts=6, bump=0.08, regma=0.05, base=0.5,
                                   worked=[((0.3, 0.8, -0.6), 0.72), ((-0.8, 0.3, 0.2), 0.74)],
                                   seams=[((0.7, 0.1, 0.7), 0.12, 0.08)]), 3 if lod else 4)
    top = max(p.y for p in P); mb = MB(); shell_into(mb, P, F, SW, WK, QUAD['crust'], 0.25, lambda p, sw, m: crust_col(p, sw, m, top))
    return mb.build('StarIronOreMesh' + ('LOD' if lod else ''), M, root)

def build_stone_chips(root, M, lod=False):
    """Optional small stone chips for pick-impact debris (spell/VFX lane owns spawning). Three closed shards in one mesh."""
    mb = MB()
    for k, (x, z, s) in enumerate([(0, 0, 0.05), (0.07, 0.03, 0.035), (-0.05, 0.05, 0.03)]):
        P, F, SW, WK = rock_shell(dict(seed=700 + k, radii=(s, s * 0.6, s * 0.8), rand_cuts=4, bump=0.1, base=0.5, worked=[((0.2, 1, 0.1), 0.7)]), 2)
        P = [p + Vector((x, 0, z)) for p in P]; top = max(p.y for p in P)
        shell_into(mb, P, F, SW, WK, QUAD['stone'], 0.3, lambda p, sw, m: stone_col(p, sw, m, top))
    return mb.build('StoneChipsMesh', M, root)

# ================================================================ materials / export / stats
def make_mat(name, alb, nrm, rough, metal, emit=0.0, nstrength=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); m.use_backface_culling = True
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs[0])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Color'
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = alb
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
    nt.links.new(tx.outputs['Color'], mx.inputs[6]); nt.links.new(ca.outputs['Color'], mx.inputs[7]); nt.links.new(mx.outputs[2], bs.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm; nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstrength
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    if emit:
        nt.links.new(tx.outputs['Color'], bs.inputs['Emission Color']); bs.inputs['Emission Strength'].default_value = emit
    return m

def export(root, path):
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for c in root.children_recursive: c.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_cameras=False,
                              export_lights=False, export_image_format='JPEG', export_jpeg_quality=86, export_extras=True, export_vertex_color='ACTIVE', export_tangents=True)

def glb_info(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); tris = 0
    for me in j['meshes']:
        for p in me['primitives']: tris += j['accessors'][p['indices']]['count'] // 3
    return dict(file_bytes=len(d), triangles=tris, materials=len(j.get('materials', [])), material_names=[m.get('name') for m in j.get('materials', [])],
                images=len(j.get('images', [])), nodes=[n.get('name') for n in j['nodes']], extensions_used=j.get('extensionsUsed', []))

def bbox_game(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; g = Vector((w.x, w.z, -w.y)); lo = Vector(map(min, lo, g)); hi = Vector(map(max, hi, g))
    return lo, hi

def empty(name, parent, loc):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); e.parent = parent; e.location = B(loc); e.empty_display_size = 0.05; return e

# runtime template name -> (builder, root node name, stages, sockets)
ASSETS = [('boulder', 'Boulder', lambda r, M, lod, st: build_deposit('boulder', r, M, lod, st), -1)]   # v2: shipped boulder.glb only

def setup_render(samples, threads):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.render.threads_mode = 'FIXED'; sc.render.threads = threads; sc.cycles.max_bounces = 4
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('Studio_World'); w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.42, 0.55, 0.78, 1); bg.inputs[1].default_value = 0.55; sc.world = w
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=40, fill_type='NGON'); gr = bpy.context.active_object; gr.name = 'Studio_Ground'
    gm = bpy.data.materials.new('Studio_Meadow'); gm.use_nodes = True; b = gm.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.13, 0.22, 0.06, 1); b.inputs['Roughness'].default_value = 0.95; gr.data.materials.append(gm)
    sun = bpy.data.objects.new('Studio_Sun', bpy.data.lights.new('Studio_Sun', 'SUN')); sun.data.energy = 3.2; sun.data.angle = 0.1; sun.data.color = (1.0, 0.9, 0.76)
    sc.collection.objects.link(sun); sun.location = B((-5, 7, -6)); sun.rotation_euler = (B((0, 0, 0)) - sun.location).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('Studio_Cam', bpy.data.cameras.new('Studio_Cam')); sc.collection.objects.link(cam); sc.camera = cam
    return sc, cam

def shoot(sc, cam, path, cp, tp, lens, rx, ry, clip=0.05):
    sc.render.resolution_x = rx; sc.render.resolution_y = ry; sc.render.resolution_percentage = 100; cam.data.lens = lens; cam.data.clip_start = clip
    cam.location = B(cp); cam.rotation_euler = (B(tp) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path; t = time.time(); bpy.ops.render.render(write_still=True); log('render', os.path.basename(path), '%.1fs' % (time.time() - t))
    im = bpy.data.images.load(path); a = np.array(im.pixels[:]).reshape(ry, rx, 4)[::-1, :, :3]; bpy.data.images.remove(im); return a

def validate_mesh(ob):
    """Closed/outward checks on the exported mesh: every edge has exactly two faces, no degenerate faces,
    one connected shell with positive signed volume, and the fraction of faces whose normal faces away from the shell centre."""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
    nonman = sum(1 for e in bm.edges if len(e.link_faces) != 2); degen = sum(1 for f in bm.faces if f.calc_area() < 1e-9)
    vol = sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) for f in bm.faces) / 6.0
    c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
    outward = sum(1 for f in bm.faces if f.normal.dot(f.calc_center_median() - c) > 0) / len(bm.faces)
    seen = set(); shells = 0
    for v0 in bm.verts:
        if v0.index in seen: continue
        shells += 1; st = [v0]; seen.add(v0.index)
        while st:
            v = st.pop()
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen: seen.add(w.index); st.append(w)
    bm.free()
    return dict(non_manifold_edges=nonman, degenerate_faces=degen, signed_volume_m3=round(vol, 4), shells=shells, outward_face_fraction=round(outward, 4),
                passed=bool(nonman == 0 and degen == 0 and vol > 0 and shells == 1))

def render_all(out, samples, threads, roots, stats, before):
    """Paired BEFORE (reference shipped boulder.glb, left) / AFTER (v2, right) at native GLB scale, ground eye + elevated."""
    sc, cam = setup_render(samples, threads); rdir = os.path.join(out, 'renders'); os.makedirs(rdir, exist_ok=True)
    keep = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=before); imp = [o for o in bpy.data.objects if o not in keep]
    holder = bpy.data.objects.new('BEFORE_reference', None); sc.collection.objects.link(holder)
    for o in imp:
        if o.parent is None: o.parent = holder
    holder.location = B((-1.3, 0, 0)); roots['boulder'].location = B((1.3, 0, 0)); bpy.context.view_layer.update(); TT = time.time()
    shots = [('pair_ground.png', (0, 1.65, -4.4), (0, 0.55, 0), 30), ('pair_elevated.png', (0, 4.6, -3.4), (0, 0.35, 0), 30),
             ('pair_ground_back.png', (0, 1.65, 4.4), (0, 0.55, 0), 30)]
    ims = [shoot(sc, cam, os.path.join(rdir, f), cp, tp, lens, 960, 440) for f, cp, tp, lens in shots]
    write_png(os.path.join(out, 'before_after_sheet.png'), to_u8(np.concatenate(ims, 0)))
    TIMES['render_s'] = round(time.time() - TT, 1)
    for o in imp + [holder]: bpy.data.objects.remove(o)
    roots['boulder'].location = (0, 0, 0)
def main():
    o = parse_args(); out = o['out']; os.makedirs(out, exist_ok=True); tdir = os.path.join(out, 'textures'); os.makedirs(tdir, exist_ok=True)
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
    t = time.time(); qs = [q_crust(), q_stone(), q_gem(), q_interior()]
    write_png(os.path.join(tdir, 'geo_albedo.png'), to_u8(atlas([c for c, _ in qs])))
    nrm = atlas([normal_from(h, k) for (_, h), k in zip(qs, (90, 60, 30, 70))])[::2, ::2]
    write_png(os.path.join(tdir, 'geo_normal.png'), to_u8(nrm)); TIMES['textures_s'] = round(time.time() - t, 2); log('textures', TIMES)
    ia = bpy.data.images.load(os.path.join(tdir, 'geo_albedo.png')); ia.name = 'geo_albedo'
    inm = bpy.data.images.load(os.path.join(tdir, 'geo_normal.png')); inm.name = 'geo_normal'; inm.colorspace_settings.name = 'Non-Color'
    M = [make_mat('GeoRock', ia, inm, 0.86, 0.15, nstrength=1.0), make_mat('GeoInterior', ia, inm, 0.42, 0.55, nstrength=0.7),
         make_mat('GeoStarGem', ia, inm, 0.12, 0.0, emit=1.6, nstrength=0.3), make_mat('GeoSeam', ia, inm, 0.3, 0.0, emit=3.2, nstrength=0.3)]
    stats = {}; roots = {}; gdir = os.path.join(out, 'glb'); os.makedirs(gdir, exist_ok=True)
    for name, rootname, fn, stages in ASSETS:
        variants = [(name, False, 0)] + ([(name + '_lod', True, 0)] if stages >= 0 else []) + [('%s_worked%d' % (name, s), False, s) for s in range(1, stages + 1)]
        for fname, lod, st in variants:
            t = time.time(); root = bpy.data.objects.new(rootname if fname == name else rootname + fname[len(name):].title().replace('_', ''), None)
            bpy.context.scene.collection.objects.link(root)
            if fname != name: root.name = fname + '_root' if not lod else name + '_lod_root'
            ob = fn(root, M, lod, st); fix_winding(ob)
            # strip unused material slots so each GLB only exports what it uses
            used = sorted({p.material_index for p in ob.data.polygons})
            if len(used) < len(ob.data.materials):
                remap = {u: i for i, u in enumerate(used)}; mats = [ob.data.materials[u] for u in used]
                idx = [remap[p.material_index] for p in ob.data.polygons]
                ob.data.materials.clear(); [ob.data.materials.append(m) for m in mats]
                ob.data.polygons.foreach_set('material_index', idx); ob.data.update()
            lo, hi = bbox_game([ob])
            if abs(lo.y) > 1e-6:   # buried crystal bases may dip below the shell's flat base: re-seat on y=0
                for v in ob.data.vertices: v.co.z -= lo.y
                lo, hi = bbox_game([ob])
            hgt = hi.y
            empty('ResourcePivot', root, (0, hgt * 0.5, 0)); empty('Grip', root, (0, hgt * 0.45, 0))
            path = os.path.join(gdir, fname + '.glb'); export(root, path); info = glb_info(path)
            for c in root.children:
                if c.type == 'EMPTY': c.name = fname + '_' + c.name   # free 'Grip'/'ResourcePivot' for the next export
            info.update(bbox_min=[round(v, 4) for v in lo], bbox_max=[round(v, 4) for v in hi], dimensions=[round(h - l, 4) for l, h in zip(lo, hi)],
                        lod=lod, stage=st, build_s=round(time.time() - t, 2), validation=validate_mesh(ob))
            stats[fname] = info; log(fname, info['triangles'], 'tris', info['file_bytes'], 'B')
            if fname == name: roots[name] = root
            else:
                for c in [root] + list(root.children_recursive): c.hide_render = True; c.hide_set(True)
    if o['render']: render_all(out, o['samples'], o['threads'], roots, stats, o['before'])
    contract = dict(kit='brann_meteor_geology_kit', version=2, scope='boulder only (v2 fractured silhouette); meteor and other kit assets unchanged', units='metres', up='+Y', front='-Z', origin='bottom centre (rests on y=0)',
                    runtime_templates=dict(meteor='deposit kind meteor, normalised to 1.5 m tall by world-content-view authored()',
                                           boulder='deposit kind stone, normalised to 1.2 m tall', boulder_b='optional variant of boulder', boulder_c='optional variant of boulder'),
                    materials=['GeoRock', 'GeoInterior', 'GeoStarGem', 'GeoSeam'], textures=dict(geo_albedo=1024, geo_normal=512), assets=stats, timings=TIMES)
    json.dump(contract, open(os.path.join(out, 'boulder_contract.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'source_boulder.blend'), compress=True)
    for im in (ia, inm): im.pack()
    bpy.ops.wm.save_mainfile(compress=True)
    log('done', round(time.time() - T0, 1), 's')

main()
