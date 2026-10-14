"""Shellbright, the larimar turtle - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_larimar_turtle.py -- --out ../../public/assets/larimar-turtle.glb
      python3.11 build_larimar_turtle.py -- --out out/larimar-turtle.glb --render out/review   (Cycles turnaround)
      (pip install bpy==4.5.* numpy pillow)
Prints TURTLE_BUILD_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

Inspired by a sterling-silver sea-turtle pendant with a larimar cabochon shell. The pendant's signature reads are kept
and brought to life:
  1. The shell is a pear-shaped larimar cabochon (point at the tail): milky sky-blue with white "turtle-back" veining,
     glassy and domed, set in a notched silver crown bezel. At night it glows softly from within.
  2. The flippers and head are covered in pebbled, hammered-silver scales outlined by dark engraved grooves, exactly the
     pendant's pattern, on a living, gently pearlescent silver skin.

Everything is authored in the game frame (X lateral (+X = the turtle's left), Y up, Z forward, metres) and converted to
Blender's Z-up on the way in, so the numbers here match client/larimar-turtle-art.js.
One skinned mesh, three materials (TurtleShell, TurtleSkin, TurtleEye), 19 bones weighted analytically.
TEXCOORD_0: shell = top projection into the larimar map; skin = scale-tile coordinates.
TEXCOORD_1: x = how much of the scale tile shows (0 smooth, 1 full pebbles), y = polish (1 = mirror-bright bezel/claws).
Vertex colours carry the tint (dark back, pale belly) with baked ambient occlusion.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
import bpy, math, json, time
import numpy as np
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'larimar-turtle.glb'))
RENDER = arg('--render')
TAU = math.tau
RNG = np.random.default_rng(20261010)

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def lin(h): return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))
def mix(c1, c2, t): return tuple(a + (b - a) * t for a, b in zip(c1, c2))
def mul(c, k): return tuple(a * k for a in c)
def to_b(p): return Vector((p[0], -p[2], p[1]))   # game (x, y up, z fwd) -> Blender (x, y back, z up)
def V(*a): return Vector(a)

C = {k: lin(v) for k, v in dict(
    silver_top='c3c8cc', silver_mid='d6dadd', silver_belly='ece8de', beak='8c9298', bezel='f4f5f6', claw='dfe4ea',
    mouth='6e3a3e', tongue='a2585e', plastron='ece6d6', plastron_seam='bdb4a0', lid='9ea8b1').items()}

# ===================================================================== textures (numpy)
def value_noise(x, y, seed):
    """Smooth value noise at arbitrary float coordinates (arrays)."""
    r = np.random.default_rng(seed); tab = r.random(256 * 256).astype(np.float32).reshape(256, 256)
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64); xf, yf = x - xi, y - yi
    u, v = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    def at(i, j): return tab[(j & 255), (i & 255)]
    a, b, c, d = at(xi, yi), at(xi + 1, yi), at(xi, yi + 1), at(xi + 1, yi + 1)
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v
def fbm(x, y, seed, oct=5, lac=2.03, gain=.5):
    s, amp, tot = 0, 1, 0
    for o in range(oct):
        s = s + amp * value_noise(x * lac ** o, y * lac ** o, seed + o * 17); tot += amp; amp *= gain
    return s / tot
def voronoi(x, y, seed, jitter=.85):
    """F1, F2 distances to jittered-grid feature points (cell size 1)."""
    r = np.random.default_rng(seed); tab = r.random((2, 256, 256)).astype(np.float32)
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    f1 = np.full(x.shape, 9.0, np.float32); f2 = np.full(x.shape, 9.0, np.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx, cy = xi + di, yi + dj
            px = cx + .5 + (tab[0, cy & 255, cx & 255] - .5) * jitter; py = cy + .5 + (tab[1, cy & 255, cx & 255] - .5) * jitter
            d = np.hypot(x - px, y - py)
            f2 = np.where(d < f1, f1, np.minimum(f2, d)); f1 = np.minimum(f1, d)
    return f1, f2

def larimar_texture(size=1024):
    """Top-down larimar: milky sky-blue with deeper pools and the white web ("turtle back") veining larimar is known
    for. Returns (rgb sRGB float, glow mask) - the glow mask is where the stone glows brightest at night."""
    yy, xx = (np.mgrid[0:size, 0:size].astype(np.float32) + .5) / size
    x, y = xx * 5.0, yy * 5.0
    wx = fbm(x * .7 + 3.1, y * .7 + 1.7, 11, 4) - .5; wy = fbm(x * .7 - 2.3, y * .7 + 5.2, 23, 4) - .5
    cloud = fbm(x + wx * 2.2, y + wy * 2.2, 31, 6)
    deep = np.clip((cloud - .38) / .3, 0, 1) ** 1.3
    # the web: warped voronoi borders, patchy, thin and soft
    vx, vy = x * 1.55 + wx * 1.4, y * 1.55 + wy * 1.4
    f1, f2 = voronoi(vx, vy, 41)
    web = np.exp(-((f2 - f1) / .045) ** 2)
    f1b, f2b = voronoi(vx * 2.3 + 7, vy * 2.3 + 3, 43)
    web2 = np.exp(-((f2b - f1b) / .04) ** 2) * .4
    patch = np.clip((fbm(x * .9 + 9, y * .9 - 4, 51, 4) - .35) / .3, 0, 1)
    veins = np.clip((web + web2) * (.35 + .65 * patch), 0, 1)
    wisp = np.clip((fbm(x * 2.2 + wx * 3, y * 2.2 + wy * 3, 61, 5) - .52) / .2, 0, 1) * .6
    pale = np.array([.64, .85, .92], np.float32); base = np.array([.45, .75, .87], np.float32)
    deepc = np.array([.26, .56, .76], np.float32); white = np.array([.93, .98, 1.0], np.float32)
    col = pale[None, None] * (1 - deep[..., None]) + base[None, None] * deep[..., None]
    col = col * (1 - .45 * (deep ** 2)[..., None]) + deepc[None, None] * (.45 * deep ** 2)[..., None]
    col = col * (1 - wisp[..., None]) + white[None, None] * wisp[..., None]
    col = col * (1 - veins[..., None] * .62) + white[None, None] * (veins[..., None] * .62)
    glow = np.clip(.35 + .65 * veins + .3 * wisp - .25 * deep, 0, 1)
    return np.clip(col, 0, 1), glow

def scale_tiles(size=512, n=8):
    """Tileable pebbled-silver scales: rounded domes with a faint hammered dimpling, outlined by engraved grooves.
    Returns (albedo factor sRGB float, tangent-space normal map rgb)."""
    yy, xx = (np.mgrid[0:size, 0:size].astype(np.float32) + .5) / size * n
    r = np.random.default_rng(77); pts = []
    for j in range(n):
        for i in range(n):
            pts.append((i + .5 + (j % 2) * .5 + (r.random() - .5) * .62, j + .5 + (r.random() - .5) * .55, r.random()))
    f1 = np.full(xx.shape, 9.0, np.float32); f2 = np.full(xx.shape, 9.0, np.float32); cid = np.zeros(xx.shape, np.float32)
    for px, py, rv in pts:
        for oy in (-n, 0, n):
            for ox in (-n, 0, n):
                d = np.hypot((xx - px - ox) * 1.0, (yy - py - oy) * 1.0)
                closer = d < f1
                f2 = np.where(closer, f1, np.minimum(f2, d)); cid = np.where(closer, rv, cid); f1 = np.minimum(f1, d)
    edge = (f2 - f1) * .5                        # distance to the cell border (cells ~1 across)
    groove = .036
    rho = np.clip(f1 / np.maximum(f1 + edge - groove, 1e-4), 0, 1)   # 0 at the pebble's centre, 1 at its groove
    dome = np.clip(1 - rho ** 2, 0, 1) ** .7                          # a puffy, polished pebble
    dent = (value_noise(xx * 7.0, yy * 7.0, 91) - .5) * .07 * dome    # hammered dimples
    h = dome * (.42 + .1 * cid) + dent
    h = np.where(edge < groove, -.04 * (1 - edge / groove), h)
    # normal from height (periodic gradients)
    k = 2.0
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * size / n * .5 / k
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * size / n * .5 / k
    nx, ny, nz = -gx, -gy, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz); nmap = np.stack([nx / ln, ny / ln, nz / ln], -1) * .5 + .5
    # image rows run top->bottom while v runs bottom->top: flip green so the normal map is OpenGL (+Y up in v)
    nmap[..., 1] = 1 - nmap[..., 1]
    alb = np.clip(np.where(edge < groove, .30 + 4.0 * edge, .78 + .22 * dome + .07 * (cid - .5)), 0, 1)
    alb = alb ** (1 / 2.2)
    return np.stack([alb, alb, alb], -1), nmap

def make_image(name, rgb, colourspace='sRGB'):
    """Write the array as a PNG under out/textures (rows top->bottom) and load it packed, so Cycles and the exporter see it."""
    from PIL import Image
    folder = os.path.join(HERE, 'out', 'textures'); os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name + '.png')
    Image.fromarray(np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8), 'RGB').save(path)
    img = bpy.data.images.load(path); img.name = name
    img.colorspace_settings.name = colourspace
    img.pack()
    return img

LARIMAR_RGB, LARIMAR_GLOW = larimar_texture()
SCALE_ALB, SCALE_NRM = scale_tiles()

# ===================================================================== geometry accumulator
class Geo:
    def __init__(self):
        self.P, self.col, self.W, self.uv1, self.aok, self.part = [], [], [], [], [], []
        self.F, self.FM, self.FUV = [], [], []
    def v(self, p, col, w, mask=(0., 0.), aok=1.0, part=''):
        self.P.append(Vector(p)); self.col.append(col); self.W.append(w); self.uv1.append(mask); self.aok.append(aok); self.part.append(part)
        return len(self.P) - 1
    def f(self, idx, mat, uvs):
        self.F.append(list(idx)); self.FM.append(mat); self.FUV.append(uvs)
G = Geo()
SHELL, SKIN, EYE = 0, 1, 2

def orient_part(face_start, ref_fn):
    """Flip the faces added since face_start so they face away from ref_fn(face centre) (a point inside the part)."""
    score = 0.0
    for fi in range(face_start, len(G.F)):
        f = G.F[fi]; ps = [G.P[i] for i in f]
        n = (ps[1] - ps[0]).cross(ps[2] - ps[0]) if len(ps) == 3 else (ps[2] - ps[0]).cross(ps[3] - ps[1])
        c = sum(ps, Vector()) / len(ps); score += n.dot(c - ref_fn(c))
    if score < 0:
        for fi in range(face_start, len(G.F)):
            G.F[fi] = G.F[fi][::-1]; G.FUV[fi] = G.FUV[fi][::-1]

def grid_faces(idx, uv, mat, wrap_u=True, wrap_v=False):
    """idx[i][j] vertex ids over rings i and around j; uv[i][j] matching UVs."""
    ni, nj = len(idx), len(idx[0])
    for i in range(ni - (0 if wrap_v else 1)):
        i2 = (i + 1) % ni
        for j in range(nj - (0 if wrap_u else 1)):
            j2 = (j + 1) % nj
            uvs = [uv[i][j], uv[i][j2], uv[i2][j2], uv[i2][j]]
            if wrap_u and j2 == 0:   # seam: extrapolate past the last column so the texture does not smear back
                ext = lambda r: tuple(2 * a - b for a, b in zip(uv[r][j], uv[r][j - 1]))
                uvs[1], uvs[2] = ext(i), ext(i2)
            G.f([idx[i][j], idx[i][j2], idx[i2][j2], idx[i2][j]], mat, uvs)

# ===================================================================== bones (game frame)
BONES = {}  # name: (head, tail, parent)
EYE_C = {'L': V(.121, .112, .80), 'R': V(-.121, .112, .80)}
EYE_DIR = {'L': V(.78, .14, .62).normalized(), 'R': V(-.78, .14, .62).normalized()}
FIN_F = [V(.24, .0, .30), V(.46, .0, .335), V(.63, -.012, .31), V(.81, -.022, .21), V(.98, -.027, .06), V(1.13, -.03, -.12)]
FIN_B = [V(.18, -.025, -.33), V(.29, -.032, -.43), V(.39, -.036, -.51), V(.47, -.036, -.585)]
BONES['Body'] = (V(0, 0, -.25), V(0, 0, .2), None)
BONES['Neck'] = (V(0, .0, .36), V(0, .05, .64), 'Body')
BONES['Head'] = (V(0, .05, .64), V(0, .08, .93), 'Neck')
BONES['Jaw'] = (V(0, .052, .69), V(0, .03, .95), 'Head')
for s, sg in (('L', 1), ('R', -1)):
    m = lambda p: V(p.x * sg, p.y, p.z)
    BONES['Eye' + s] = (EYE_C[s], EYE_C[s] + EYE_DIR[s] * .05, 'Head')
    BONES['Lid' + s] = (EYE_C[s], EYE_C[s] + V(0, .05, 0), 'Head')
    BONES['FinF1' + s] = (m(FIN_F[0]), m(FIN_F[2]), 'Body')
    BONES['FinF2' + s] = (m(FIN_F[2]), m(FIN_F[3]), 'FinF1' + s)
    BONES['FinF3' + s] = (m(FIN_F[3]), m(FIN_F[5]), 'FinF2' + s)
    BONES['FinB1' + s] = (m(FIN_B[0]), m(FIN_B[2]), 'Body')
    BONES['FinB2' + s] = (m(FIN_B[2]), m(FIN_B[3]), 'FinB1' + s)
BONES['Tail'] = (V(0, -.03, -.46), V(0, -.045, -.71), 'Body')

# ===================================================================== shell: pear-shaped larimar cabochon
SHELL_L, SHELL_HW, SHELL_ZC = 1.20, .48, -.02
SHELL_YB, SHELL_H = .055, .225
A_TEAR = SHELL_HW / .76980
APEX = (0.0, SHELL_ZC + .07)
def outline(t):
    """Teardrop outline, t in [0, 2pi): t = 0 is the tail point, pi the rounded front. Returns (x, z)."""
    x = A_TEAR * math.sin(t) * math.sin(t / 2)
    z = SHELL_ZC - SHELL_L / 2 * math.cos(t)
    # soften the very point a touch so it reads as a polished stone, not a blade
    k = math.exp(-((min(t, TAU - t)) / .32) ** 2) * .018
    return x, z + k
def outline_normal(t, e=1e-3):
    x0, z0 = outline((t - e) % TAU); x1, z1 = outline((t + e) % TAU)
    tx, tz = x1 - x0, z1 - z0; nx, nz = tz, -tx
    l = math.hypot(nx, nz); nx, nz = nx / l, nz / l
    x, z = outline(t)
    if nx * (x - APEX[0]) + nz * (z - APEX[1]) < 0: nx, nz = -nx, -nz
    return nx, nz
def shell_profile(r): return (1 - r ** 2.35) ** .58
def shell_point(r, t):
    ox, oz = outline(t); x = APEX[0] + r * (ox - APEX[0]); z = APEX[1] + r * (oz - APEX[1])
    return V(x, SHELL_YB + SHELL_H * shell_profile(min(r, 1)), z)
def shell_uv(p):   # top projection over the stone's bounding box
    return ((p.x / (SHELL_HW * 2.1)) + .5, (p.z - (SHELL_ZC - SHELL_L / 2)) / (SHELL_L * 1.05))

N_AROUND = 112
TS = [TAU * (j + .5) / N_AROUND for j in range(N_AROUND)]
def build_shell():
    fs = len(G.F)
    rings = [.0, .07, .16, .26, .37, .48, .58, .67, .75, .82, .875, .92, .955, .978, .993, 1.0]
    idx, uv = [], []
    for r in rings[1:]:
        row, urow = [], []
        for t in TS:
            p = shell_point(r, t); row.append(G.v(p, (1, 1, 1), {'Body': 1}, (0, 0), 1, 'shell')); urow.append(shell_uv(p))
        idx.append(row); uv.append(urow)
    # the stone's skirt: straight down a little under the bezel lip, so no gap shows
    row, urow = [], []
    for t in TS:
        p = shell_point(1, t); p.y = SHELL_YB - .012; row.append(G.v(p, (1, 1, 1), {'Body': 1}, (0, 0), 1, 'shell')); urow.append(shell_uv(p))
    idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SHELL)
    top = G.v(shell_point(0, 0), (1, 1, 1), {'Body': 1}, (0, 0), 1, 'shell')
    for j in range(N_AROUND):
        j2 = (j + 1) % N_AROUND
        G.f([top, idx[0][j2], idx[0][j]], SHELL, [shell_uv(G.P[top]), uv[0][j2], uv[0][j]])
    orient_part(fs, lambda c: V(APEX[0], SHELL_YB - .1, APEX[1]))

# ===================================================================== bezel: notched silver crown around the stone
N_NOTCH = 34
def build_bezel():
    """The pendant's frame: a thin lip gripping the stone, then a broad band of raised silver blocks (a crenellated
    crown) separated by engraved notches, rolling over the edge and tucking under the body."""
    fs = len(G.F)
    per = 5; n = N_NOTCH * per
    ts = [TAU * (j + .5) / n for j in range(n)]
    # profile (outward, up) from the stone's edge at SHELL_YB; `block` marks the band points the notches cut through
    prof = [(-.011, .018, 0), (-.005, .033, 0), (.002, .038, 0), (.009, .032, 0), (.015, .039, 1), (.030, .041, 1),
            (.048, .039, 1), (.062, .034, 1), (.074, .022, .6), (.080, .002, 0), (.077, -.022, 0), (.058, -.044, 0), (.034, -.054, 0)]
    idx, uv = [], []
    for k, (o, h, block) in enumerate(prof):
        row, urow = [], []
        for j, t in enumerate(ts):
            phase = j % per
            groove = 1.0 if phase == 0 else (.3 if phase in (1, per - 1) else 0.0)   # a square-ish notch between blocks
            hh = h - block * groove * .016
            ox, oz = outline(t); nx, nz = outline_normal(t)
            p = V(ox + nx * o, SHELL_YB + hh, oz + nz * o)
            col = C['bezel'] if k < 10 else mix(C['bezel'], C['silver_mid'], .6)
            row.append(G.v(p, col, {'Body': 1}, (0, 1.0 if k < 10 else .6), 1, 'bezel')); urow.append((.02, .02))
        idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SKIN)
    orient_part(fs, lambda c: V(APEX[0], SHELL_YB - .03, APEX[1]) + (V(c.x, SHELL_YB - .03, c.z) - V(APEX[0], SHELL_YB - .03, APEX[1])) * .9)

# ===================================================================== body under the shell (plastron)
def build_plastron():
    fs = len(G.F)
    rings = [1.0, .985, .95, .9, .82, .72, .6, .47, .33, .2, .08]
    idx, uv = [], []
    for r in rings:
        row, urow = [], []
        for t in TS[::2]:
            ox, oz = outline(t)
            sc = .965 * r
            x = APEX[0] + sc * (ox - APEX[0]); z = APEX[1] - .02 + sc * (oz - APEX[1])
            y = SHELL_YB - .05 - .13 * (1 - r ** 2.2) ** .5
            # three faint seams across the plastron, like the pendant's underside casting
            col = mix(C['plastron'], C['silver_belly'], .5 + .5 * r)
            row.append(G.v(V(x, y, z), col, {'Body': 1}, (0, .15), 1, 'plastron')); urow.append((.02, .02))
        idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SKIN)
    c = G.v(V(APEX[0], SHELL_YB - .05 - .13, APEX[1] - .02), C['plastron'], {'Body': 1}, (0, .15), 1, 'plastron')
    m = len(idx[-1])
    for j in range(m):
        G.f([idx[-1][j], idx[-1][(j + 1) % m], c], SKIN, [(.02, .02)] * 3)
    orient_part(fs, lambda c: V(APEX[0], SHELL_YB - .08, APEX[1]))

# ===================================================================== lofts along a centre line
def superellipse_ring(centre, side, up, w, top, bot, n_pts, nt=2.4, nb=2.6, phase=0.0):
    pts = []
    for k in range(n_pts):
        a = TAU * k / n_pts + phase
        ca, sa = math.cos(a), math.sin(a)
        x = w * math.copysign(abs(ca) ** (2 / (nt if sa >= 0 else nb)), ca)
        y = (top if sa >= 0 else bot) * math.copysign(abs(sa) ** (2 / (nt if sa >= 0 else nb)), sa)
        pts.append((centre + side * x + up * y, a))
    return pts

def neck_weights(z):
    if z < .30: return {'Body': 1}
    if z < .46: t = smoothstep(.30, .46, z); return {'Body': 1 - t, 'Neck': t}
    if z < .60: return {'Neck': 1}
    if z < .70: t = smoothstep(.60, .70, z); return {'Neck': 1 - t, 'Head': t}
    return {'Head': 1}

HEAD_CL = [(.26, -.005), (.40, .01), (.52, .03), (.62, .052), (.70, .07), (.78, .082), (.85, .083), (.91, .072), (.955, .058), (.975, .05)]
def head_cl(z):
    zs = [a for a, _ in HEAD_CL]; ys = [b for _, b in HEAD_CL]
    return float(np.interp(z, zs, ys))
# z, half width, top, bottom
HEAD_SEC = [(.26, .13, .075, .072), (.40, .123, .075, .07), (.52, .112, .074, .067), (.60, .106, .073, .065),
            (.655, .116, .086, .07), (.72, .128, .096, .075), (.78, .128, .098, .076), (.84, .117, .092, .072),
            (.89, .088, .078, .062), (.93, .062, .062, .049), (.957, .038, .045, .035), (.975, .02, .026, .018), (.986, .004, .008, .004)]
HEAD_K = 1.12   # the pendant's head is big and friendly; widen the head (not the neck) by this much
def head_sec(z, i):
    zs = [s[0] for s in HEAD_SEC]; vs = [s[i] for s in HEAD_SEC]
    return float(np.interp(z, zs, vs)) * lerp(1, HEAD_K, smoothstep(.60, .70, z))

NECK_N = 22
def build_neck():
    """Neck from inside the body to just inside the head plates; fine wrinkled scales."""
    fs = len(G.F)
    zs = list(np.linspace(.26, .70, 16))
    idx, uv = [], []
    for z in zs:
        y = head_cl(z); w, top, bot = head_sec(z, 1), head_sec(z, 2), head_sec(z, 3)
        if z > .62: k = .9; w, top, bot = w * k, top * k, bot * k
        ring = superellipse_ring(V(0, y, z), V(1, 0, 0), V(0, 1, 0), w, top, bot, NECK_N)
        row, urow = [], []
        for p, a in ring:
            under = max(0, -math.sin(a))
            col = mix(C['silver_top'], C['silver_belly'], smoothstep(-.2, .7, -math.sin(a)))
            # neck skin folds: rings of slightly darker creases
            fold = .5 + .5 * math.cos(z * 115)
            col = mul(col, 1 - .08 * fold)
            row.append(G.v(p, col, neck_weights(z), (.55, 0), 1, 'neck'))
            urow.append((z / .16, (a / TAU) * (TAU * .1) / .16))
        idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SKIN)
    orient_part(fs, lambda c: V(0, head_cl(c.z), c.z))

MOUTH_Y = lambda z: head_cl(z) - .018 - .012 * smoothstep(.93, .70, z)   # a gentle upturned smile toward the corners
def build_head():
    """Upper head and lower jaw as two closed lofts meeting at the mouth line, so the jaw can open for a breath."""
    for part in ('upper', 'jaw'):
        fs = len(G.F)
        z0 = .655 if part == 'upper' else .70
        zs = list(np.linspace(z0, .986 if part == 'upper' else .962, 22))
        n_arc, n_flat = 22, 7
        idx, uv = [], []
        for zi, z in enumerate(zs):
            cy = head_cl(z); ym = MOUTH_Y(z)
            w, top, bot = head_sec(z, 1), head_sec(z, 2), head_sec(z, 3)
            row, urow = [], []
            pts = []
            if part == 'upper':
                hgt = cy + top - ym
                for k in range(n_arc + 1):
                    a = math.pi * k / n_arc   # 0 = right corner (x>0 side... we use +x first), pi = other corner
                    ca, sa = math.cos(a), math.sin(a)
                    x = w * 1.012 * math.copysign(abs(ca) ** (2 / 2.4), ca); y = ym - .004 + (hgt + .004) * abs(sa) ** (2 / 2.4)   # overbite
                    # beak: the upper jaw overhangs a hair at the tip
                    pts.append((V(x, y, z), 'skin', a))
                for k in range(1, n_flat):
                    x = w * .92 * (1 - 2 * k / n_flat) * -1
                    pts.append((V(x, ym - .004, z - .002), "mouth", None))
            else:
                hgt = ym - (cy - bot)
                for k in range(n_arc + 1):
                    a = math.pi + math.pi * k / n_arc
                    ca, sa = math.cos(a), math.sin(a)
                    x = w * math.copysign(abs(ca) ** (2 / 2.6), ca); y = ym - hgt * abs(sa) ** (2 / 2.6)
                    pts.append((V(x, y, z), 'skin', a))
                for k in range(1, n_flat):
                    x = w * .9 * (1 - 2 * k / n_flat) * -1 * -1
                    pts.append((V(x, ym - .002, z - .006), 'mouth', None))
            for p, kind, a in pts:
                if kind == 'mouth':
                    col = mix(C['mouth'] if part == 'upper' else C['tongue'], C['beak'], smoothstep(.90, .95, z)); wt = {'Head': 1} if part == 'upper' else {'Jaw': 1}
                    mask = (0, 0); u = (.02, .02)
                else:
                    sa = math.sin(a)
                    up = sa if part == 'upper' else 0
                    tip = smoothstep(.88, .965, z)
                    col = mix(C['silver_mid'], C['silver_top'], smoothstep(.2, 1, up))
                    if part == 'jaw': col = mix(C['silver_belly'], C['silver_mid'], .25)
                    col = mix(col, C['beak'], tip * .8)
                    if part == 'upper':
                        wt = neck_weights(z)
                    else:
                        t = smoothstep(.70, .76, z); wt = {'Head': 1 - t, 'Jaw': t} if t < 1 else {'Jaw': 1}
                    scales = (1 - tip) * (.95 if part == 'upper' else .6)
                    mask = (scales, .25 * tip)
                    # head plates: bigger cells than the flippers (tile = 0.30 m), projected from above / below
                    u = (p.x / .42 + .5, p.z / .42) if part == 'upper' else (p.x / .26 + .25, p.z / .26)
                    if part == 'upper':
                        # a soft orbital mound round each eye, smooth-skinned so the eye sits in a socket
                        for sname in ('L', 'R'):
                            dv = p - EYE_C[sname]; dl = dv.length
                            if dl < .075:
                                f = (1 - (dl / .075) ** 2) ** 2
                                out = V(math.copysign(1, EYE_C[sname].x), .35, .1).normalized()
                                p += out * .013 * f
                                mask = (mask[0] * (1 - .8 * f), mask[1])
                row.append(G.v(p, col, wt, mask, 0 if kind == 'mouth' else 1, 'head')); urow.append(u)
            idx.append(row); uv.append(urow)
        grid_faces(idx, uv, SKIN)
        # caps: back (hidden in the neck) and the very tip
        for ring, rev in ((idx[0], True), (idx[-1], False)):
            cpos = sum((G.P[i] for i in ring), Vector()) / len(ring)
            c = G.v(cpos, G.col[ring[0]], G.W[ring[0]], (0, 0), 1, 'head')
            for j in range(len(ring)):
                a, b = ring[j], ring[(j + 1) % len(ring)]
                G.f([c, b, a] if rev else [c, a, b], SKIN, [(.02, .02)] * 3)
        orient_part(fs, lambda c: V(0, MOUTH_Y(c.z) + (.03 if part == 'upper' else -.025), c.z))

def build_eyes():
    for s in ('L', 'R'):
        c, d = EYE_C[s], EYE_DIR[s]
        up = (V(0, 1, 0) - d * d.y).normalized(); side = d.cross(up).normalized()
        # eyeball: lat/long around the look direction; pupil, deep amber iris, tiny bit of white
        fs = len(G.F)
        R = .036; nl, na = 10, 16
        idx = []
        for i in range(nl + 1):
            th = math.pi * i / nl; row = []
            for k in range(na):
                ph = TAU * k / na
                dirv = d * math.cos(th) + (up * math.cos(ph) + side * math.sin(ph)) * math.sin(th)
                ang = th
                if ang < .36: col = lin('060507')
                elif ang < .58: col = mix(lin('1c120c'), lin('8a5520'), smoothstep(.40, .58, ang))   # a thin warm amber ring
                elif ang < .72: col = lin('1a120d')
                else: col = lin('3b342e')
                row.append(G.v(c + dirv * R, col, {'Eye' + s: 1}, (0, 0), 0, 'eye'))
            idx.append(row)
        for i in range(nl):
            for k in range(na):
                k2 = (k + 1) % na
                G.f([idx[i][k], idx[i][k2], idx[i + 1][k2], idx[i + 1][k]], EYE, [(.5, .5)] * 4)
        orient_part(fs, lambda p, c=c: c)
        # lids: an upper lid (blinks, Lid bone) and a lower lid (static), both shells just outside the eye
        for which in ('upper', 'lower'):
            fs = len(G.F)
            Rl = .0392 if which == 'upper' else .0388
            idx = []
            nl2, na2 = 7, 18
            for i in range(nl2 + 1):
                row = []
                for k in range(na2 + 1):
                    # spherical patch: elevation e over the lid's span, azimuth across the eye
                    az = -1.35 + 2.7 * k / na2; q = (az / 1.35) ** 2   # almond opening: the rims meet toward the corners
                    if which == 'upper':
                        el = lerp(1.15, .20 + .42 * q, i / nl2)     # from above the eye down to the lid edge (open: covers the top)
                    else:
                        el = lerp(-1.1, -.44 + .95 * q, i / nl2)
                    dirv = (d * math.cos(az) + side * math.sin(az)) * math.cos(el) + up * math.sin(el)
                    rim = i == nl2
                    p = c + dirv * (Rl - (.0015 if rim else 0))   # the rim rolls in onto the eye
                    col = C['silver_top']
                    wt = {'Lid' + s: 1} if which == 'upper' else {'Head': 1}
                    row.append(G.v(p, col, wt, (0, .15), 1, 'lid'))
                idx.append(row)
            for i in range(nl2):
                for k in range(na2):
                    G.f([idx[i][k], idx[i][k + 1], idx[i + 1][k + 1], idx[i + 1][k]], SKIN, [((k) / 6, i / 6), ((k + 1) / 6, i / 6), ((k + 1) / 6, (i + 1) / 6), (k / 6, (i + 1) / 6)])
            orient_part(fs, lambda p, c=c: c)

# ===================================================================== flippers
def poly_resample(pts, n):
    P = [np.array(p) for p in pts]; seg = [np.linalg.norm(P[i + 1] - P[i]) for i in range(len(P) - 1)]
    L = sum(seg); out, cum = [], np.concatenate([[0], np.cumsum(seg)])
    # Catmull-Rom through the points for a smooth spine
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    dense = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(24):
            t = k / 24
            dense.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    dense.append(P[-1]); dense = np.array(dense)
    dl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))])
    ss = np.linspace(0, dl[-1], n)
    return np.stack([np.interp(ss, dl, dense[:, i]) for i in range(3)], 1), dl[-1]

def airfoil(n):
    """Closed section, (chord position 0 = leading edge .. 1 = trailing, thickness side +1 top / -1 bottom)."""
    pts = []
    half = n // 2
    for k in range(half + 1):          # top: LE -> TE
        x = (1 - math.cos(math.pi * k / half)) / 2; pts.append((x, 1))
    for k in range(half - 1, 0, -1):   # bottom: TE -> LE
        x = (1 - math.cos(math.pi * k / half)) / 2; pts.append((x, -1))
    return pts
def thick_dist(x): return 2.6 * math.sqrt(max(x, 0)) * (1 - x) ** 1.15 / 1.0   # peaks near 25% chord

def build_flipper(sg, spine_pts, chord_fn, thick_fn, bones, joints, tile, name, lead_frac=.32, n_len=34, n_sec=18):
    """Lofted flipper. bones: names root->tip; joints: s values where bone i hands over to i+1."""
    fs = len(G.F)
    pts = [V(p.x * sg, p.y, p.z) for p in spine_pts]
    S, L = poly_resample(pts, n_len)
    sec = airfoil(n_sec)
    idx, uv = [], []
    for i in range(n_len):
        s = i / (n_len - 1); p = Vector(S[i])
        tng = Vector(S[min(i + 1, n_len - 1)]) - Vector(S[max(i - 1, 0)]); tng.y *= .3; tng.normalize()
        across = V(0, 1, 0).cross(tng).normalized()   # horizontal, perpendicular to the spine
        if across.z * 1 < 0: across = -across          # +across = the leading edge, toward the head
        up = tng.cross(across).normalized()
        if up.y < 0: up = -up
        ch = chord_fn(s); th = thick_fn(s)
        # weights along the bones
        wt = {bones[0]: 1.0}
        for bi, js in enumerate(joints):
            h = .07
            if s >= js + h: wt = {bones[bi + 1]: 1.0}
            elif s > js - h:
                t = smoothstep(js - h, js + h, s); wt = {bones[bi]: 1 - t, bones[bi + 1]: t}
        row, urow = [], []
        for cx, side in sec:
            off = (lead_frac - cx) * ch
            tk = th * thick_dist(cx) * .5 * side
            # a little camber: the blade arches up along its middle
            camber = .12 * th * math.sin(math.pi * cx)
            q = p + across * off + up * (tk + camber)
            dark = .5 + .5 * side   # top darker, belly paler
            col = mix(C['silver_belly'], C['silver_top'], dark)
            edge = smoothstep(.75, 1.0, cx)
            col = mix(col, C['silver_mid'], edge * .4)
            scales = smoothstep(.0, .12, s) * (1 - .4 * smoothstep(.85, 1, s))
            row.append(G.v(q, col, wt, (scales, 0), 1, name))
            # scale tile: u along the spine, v across the chord (pebbles a bit longer than wide)
            urow.append((s * L / (tile * 1.35), (off + (.5 if side > 0 else 2.0)) / tile))
        idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SKIN)
    # tip cap
    tip = idx[-1]; cpos = sum((G.P[i] for i in tip), Vector()) / len(tip)
    c = G.v(cpos, G.col[tip[0]], G.W[tip[0]], G.uv1[tip[0]], 1, name)
    for j in range(len(tip)):
        G.f([c, tip[j], tip[(j + 1) % len(tip)]], SKIN, [uv[-1][j], uv[-1][j], uv[-1][(j + 1) % len(tip)]])
    orient_part(fs, lambda q: _flipper_ref(q, S))
    return S
def _flipper_ref(q, S):
    d = np.linalg.norm(S - np.array(q), axis=1); return Vector(S[int(np.argmin(d))])

def front_chord(s):
    c = lerp(.11, .135, smoothstep(0, .3, s))
    c = lerp(c, .195, smoothstep(.3, .62, s))
    if s > .62: c = lerp(.195, .155, smoothstep(.62, .84, s))
    if s > .84: c *= math.sqrt(max(0, 1 - ((s - .84) / .16) ** 2)) * .92 + .08 * (1 - (s - .84) / .16)
    return max(c, .004)
def front_thick(s): return max(.006, lerp(.07, .05, smoothstep(0, .3, s)) * (1 - .62 * smoothstep(.3, 1, s)))
def back_chord(s):
    c = lerp(.09, .165, smoothstep(.05, .62, s))
    if s > .62: c *= math.sqrt(max(0, 1 - ((s - .62) / .38) ** 2)) * .9 + .1 * (1 - (s - .62) / .38)
    return max(c, .004)
def back_thick(s): return max(.006, .05 * (1 - .65 * smoothstep(.1, 1, s)))

def build_claw(sg, at, along, side_dir):
    """A small polished claw on the front flipper's leading edge."""
    fs = len(G.F)
    base = V(at.x * sg, at.y, at.z); ax = V(along.x * sg, along.y, along.z).normalized()
    sd = V(side_dir.x * sg, side_dir.y, side_dir.z).normalized(); up = ax.cross(sd).normalized()
    if up.y < 0: up = -up
    ring = []
    for k in range(6):
        a = TAU * k / 6
        ring.append(G.v(base + (sd * math.cos(a) + up * math.sin(a)) * .011, C['claw'], {'FinF2' + ('L' if sg > 0 else 'R'): 1}, (0, 1), 1, 'claw'))
    tip = G.v(base + ax * .045 + up * .006, C['claw'], {'FinF2' + ('L' if sg > 0 else 'R'): 1}, (0, 1), 1, 'claw')
    for k in range(6):
        G.f([ring[k], ring[(k + 1) % 6], tip], SKIN, [(.02, .02)] * 3)
    orient_part(fs, lambda q, b=base: b)

def build_tail():
    fs = len(G.F)
    zs = np.linspace(-.42, -.67, 9); idx, uv = [], []
    for z in zs:
        t = (-.42 - z) / .25
        y = lerp(-.03, -.05, t); r = lerp(.065, .012, t ** 1.2)
        ring = superellipse_ring(V(0, y, z), V(1, 0, 0), V(0, 1, 0), r, r * .7, r * .7, 10)
        row, urow = [], []
        for p, a in ring:
            wt = {'Body': 1} if t < .2 else ({'Body': 1 - smoothstep(.2, .45, t), 'Tail': smoothstep(.2, .45, t)})
            row.append(G.v(p, mix(C['silver_top'], C['silver_belly'], .5 - .5 * math.sin(a)), wt, (.6, 0), 1, 'tail'))
            urow.append((z / .12, a / TAU))
        idx.append(row); uv.append(urow)
    grid_faces(idx, uv, SKIN)
    orient_part(fs, lambda q: V(0, lerp(-.03, -.05, (-.42 - q.z) / .25), q.z))

build_shell()
build_bezel()
build_plastron()
build_neck()
build_head()
build_eyes()
FRONT_S = {}
for sg, s in ((1, 'L'), (-1, 'R')):
    FRONT_S[s] = build_flipper(sg, FIN_F, front_chord, front_thick, ['Body', 'FinF1' + s, 'FinF2' + s, 'FinF3' + s], [.08, .36, .58], .56, 'finF', lead_frac=.30)
    build_flipper(sg, FIN_B, back_chord, back_thick, ['Body', 'FinB1' + s, 'FinB2' + s], [.10, .55], .44, 'finB', lead_frac=.40, n_len=20, n_sec=16)
build_tail()

# ===================================================================== baked ambient occlusion into vertex colours
tris = []
for f in G.F:
    for k in range(1, len(f) - 1): tris.append((f[0], f[k], f[k + 1]))
bvh = BVHTree.FromPolygons([tuple(p) for p in G.P], tris, all_triangles=True)
vn = [Vector() for _ in G.P]
for a, b, c in tris:
    n = (G.P[b] - G.P[a]).cross(G.P[c] - G.P[a])
    for i in (a, b, c): vn[i] += n
DIRS = []
for i in range(36):
    u1, u2 = (i + .5) / 36, (i * .618033988749) % 1
    r, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u1))))
def ao_at(p, n, reach=.35):
    if n.length < 1e-9: return 1.0
    n = n.normalized(); ref = Vector((1, 0, 0)) if abs(n.x) < .9 else Vector((0, 1, 0))
    u = n.cross(ref).normalized(); v = n.cross(u); occ = 0.0
    for d in DIRS:
        dw = u * d.x + v * d.y + n * d.z
        hit = bvh.ray_cast(p + n * .003, dw, reach)
        if hit[0] is not None: occ += 1 - (hit[3] / reach) ** .6
    return 1 - occ / len(DIRS)
for i, p in enumerate(G.P):
    if G.aok[i] <= 0: continue
    ao = ao_at(p, vn[i])
    G.col[i] = mul(G.col[i], lerp(.30, 1, ao ** 1.2))

# ===================================================================== Blender objects
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
IMG_LARIMAR = make_image('TurtleLarimar', LARIMAR_RGB)
IMG_SCALE = make_image('TurtleScales', SCALE_ALB)
IMG_NORMAL = make_image('TurtleScalesNormal', SCALE_NRM, 'Non-Color')

def principled(m):
    m.use_nodes = True; return m.node_tree, m.node_tree.nodes['Principled BSDF']
def tex(nt, img, uvname='UVMap'):
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uvname; nt.links.new(u.outputs['UV'], t.inputs['Vector'])
    return t
M_SHELL = bpy.data.materials.new('TurtleShell'); nt, b = principled(M_SHELL)
t = tex(nt, IMG_LARIMAR); nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = .12; b.inputs['Metallic'].default_value = 0
M_SKIN = bpy.data.materials.new('TurtleSkin'); nt, b = principled(M_SKIN)
t = tex(nt, IMG_SCALE); nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
tn = tex(nt, IMG_NORMAL); nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
b.inputs['Roughness'].default_value = .36; b.inputs['Metallic'].default_value = .62
M_EYE = bpy.data.materials.new('TurtleEye'); nt, b = principled(M_EYE)
vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'; nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = .06
MATS = [M_SHELL, M_SKIN, M_EYE]
for m in MATS: m.use_backface_culling = True

me = bpy.data.meshes.new('Shellbright')
me.from_pydata([tuple(to_b(p)) for p in G.P], [], G.F)
for m in MATS: me.materials.append(m)
me.polygons.foreach_set('material_index', G.FM)
me.polygons.foreach_set('use_smooth', [True] * len(G.F))
uv0 = me.uv_layers.new(name='UVMap'); uv1 = me.uv_layers.new(name='Mask')
li = 0
for fi, poly in enumerate(me.polygons):
    for k, loop_index in enumerate(poly.loop_indices):
        vi = me.loops[loop_index].vertex_index
        uv0.data[loop_index].uv = G.FUV[fi][k]
        uv1.data[loop_index].uv = G.uv1[vi]
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.array([(*c, 1.0) for c in G.col], np.float32).ravel())
me.color_attributes.active_color = ca
me.validate(); me.update()
try: me.set_sharp_from_angle(angle=math.radians(70))
except Exception: pass
body = bpy.data.objects.new('Shellbright', me); SC.collection.objects.link(body)

arm_data = bpy.data.armatures.new('ShellbrightRig'); rig = bpy.data.objects.new('ShellbrightRig', arm_data); SC.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
order = list(BONES)
for name in order:
    h, tl, _p = BONES[name]; eb = arm_data.edit_bones.new(name); eb.head = to_b(h); eb.tail = to_b(tl); eb.roll = 0
for name in order:
    p = BONES[name][2]
    if p: arm_data.edit_bones[name].parent = arm_data.edit_bones[p]; arm_data.edit_bones[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
groups = {n: body.vertex_groups.new(name=n) for n in order}
for i, w in enumerate(G.W):
    tot = sum(w.values())
    items = sorted(((k, v / tot) for k, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:4]
    tot = sum(v for _, v in items)
    for k, v in items: groups[k].add([i], v / tot, 'REPLACE')
body.parent = rig; mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# ===================================================================== GLB repack: quantized attributes
def quantize_glb(path):
    import struct
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour'; conv[at['WEIGHTS_0']] = 'weights'
            if 'TEXCOORD_1' in at: conv[at['TEXCOORD_1']] = 'mask'
    out = bytearray(); views = []
    def push(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    img_views = {im['bufferView'] for im in doc.get('images', [])}
    remap = {}
    for vi in sorted(img_views):
        bv = doc['bufferViews'][vi]; o = bv.get('byteOffset', 0); remap[vi] = push(bin0[o:o + bv['byteLength']])
    for im in doc.get('images', []): im['bufferView'] = remap[im['bufferView']]
    for ai, a in enumerate(doc['accessors']):
        data = read(ai); kind = conv.get(ai); target = doc['bufferViews'][a['bufferView']].get('target'); a.pop('byteOffset', None)
        if kind == 'normal':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], 1)
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'colour':
            q = np.clip(np.round(data[:, :3] * 255), 0, 255).astype(np.uint8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.uint8)], 1)
            a.update(componentType=5121, normalized=True, type='VEC3'); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'weights':
            q = np.round(data / data.sum(1, keepdims=True) * 255).astype(np.int32)
            fix = 255 - q.sum(1); q[np.arange(len(q)), q.argmax(1)] += fix
            a.update(componentType=5121, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.astype(np.uint8).tobytes(), target)
        elif kind == 'mask':
            q = np.clip(np.round(data * 65535), 0, 65535).astype(np.uint16)
            a.update(componentType=5123, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target)
        else:
            a['bufferView'] = push(data.astype(CT[a['componentType']]).tobytes(), target)
    doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(out)}]
    for k in ('extensionsUsed', 'extensionsRequired'): doc[k] = sorted(set(doc.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(out) % 4: out.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob)

tri_count = sum(len(p.vertices) - 2 for p in me.polygons)
REPORT = {'triangles': tri_count, 'vertices': len(me.vertices), 'materials': [m.name for m in me.materials], 'bones': len(order),
          'parts': {k: G.part.count(k) for k in sorted(set(G.part))}}
assert tri_count < 20000, REPORT
assert all(abs(sum(g.weight for g in v.groups) - 1) < 1e-3 for v in me.vertices), 'every vertex fully weighted'
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=False, export_morph=False, export_materials='EXPORT', export_normals=True,
                          export_texcoords=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                          export_extras=False, export_image_format='JPEG', export_image_quality=88)
quantize_glb(OUT)
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ===================================================================== review renders
AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}
def pose(spec):
    """spec: {bone: (pitch_x, yaw_y, roll_z)} radians about the turtle's own (game) axes, as the runtime does."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = Quaternion(); pb.scale = (1, 1, 1)
        if pb.name not in spec: continue
        ax, ay, az = spec[pb.name]
        rw = pb.bone.matrix_local.to_quaternion()
        qm = Quaternion(AX['y'], ay) @ Quaternion(AX['z'], az) @ Quaternion(AX['x'], ax)
        pb.rotation_quaternion = rw.inverted() @ qm @ rw
    bpy.context.view_layer.update()
def side_spec(base):
    out = {}
    for name, (ax, ay, az) in base.items():
        if name.endswith('*'):
            out[name[:-1] + 'L'] = (ax, ay, az); out[name[:-1] + 'R'] = (ax, -ay, -az)
        else: out[name] = (ax, ay, az)
    return out
POSES = {
    'rest': {},
    'downstroke': side_spec({'FinF1*': (.25, -.15, -.55), 'FinF2*': (.1, 0, -.18), 'FinF3*': (.12, .1, -.1), 'FinB1*': (0, .25, 0), 'Head': (.06, 0, 0)}),
    'upstroke': side_spec({'FinF1*': (-.25, .35, .55), 'FinF2*': (-.1, .1, .15), 'FinF3*': (-.1, .15, .2), 'FinB1*': (0, .1, .1), 'Head': (-.04, 0, 0)}),
    'glide': side_spec({'FinF1*': (0, .75, -.05), 'FinF2*': (0, .35, 0), 'FinF3*': (0, .2, 0), 'FinB1*': (0, .3, 0), 'FinB2*': (0, .1, 0)}),
    'breathe': side_spec({'Neck': (-.3, 0, 0), 'Head': (-.15, 0, 0), 'Jaw': (.32, 0, 0), 'FinF1*': (0, .3, .1), 'Lid*': (0, 0, 0)}),
    'bask': side_spec({'Neck': (.12, .22, 0), 'Head': (.1, .12, -.05), 'Lid*': (.0, 0, 0), 'FinB1*': (0, .95, .0), 'FinB2*': (0, .3, 0),
                       'FinF1*': (0, .45, -.1), 'FinF2*': (0, .25, -.05)}),
}
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = int(arg('--w', 1100)), int(arg('--h', 760))
    SC.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True; wn = w.node_tree
    tc = wn.nodes.new('ShaderNodeTexCoord'); sep = wn.nodes.new('ShaderNodeSeparateXYZ'); wn.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    ramp = wn.nodes.new('ShaderNodeValToRGB'); wn.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].position = .44; ramp.color_ramp.elements[0].color = (.18, .22, .16, 1)
    ramp.color_ramp.elements[1].position = .62; ramp.color_ramp.elements[1].color = (.35, .55, .85, 1)
    e = ramp.color_ramp.elements.new(.5); e.color = (.85, .88, .9, 1)
    wn.links.new(ramp.outputs['Color'], wn.nodes['Background'].inputs['Color']); wn.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.4; sun.angle = .15
    so = bpy.data.objects.new('sun', sun); SC.collection.objects.link(so); so.rotation_euler = (math.radians(38), math.radians(-20), math.radians(35))
    # floor: soft warm sand so the silver has something to bounce
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-6, -6, -.2), (6, -6, -.2), (6, 6, -.2), (-6, 6, -.2)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); SC.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fnt, fb = principled(fm); fb.inputs['Base Color'].default_value = (.55, .5, .42, 1); fb.inputs['Roughness'].default_value = .9; fl.materials.append(fm)
    # the game's look: vertex colour x scale tile (by mask), normal map by mask, polish -> mirror silver
    nt = M_SKIN.node_tree; b = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    uvm = nt.nodes.new('ShaderNodeUVMap'); uvm.uv_map = 'Mask'; sp = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uvm.outputs['UV'], sp.inputs['Vector'])
    st = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image == IMG_SCALE][0]
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MIX'
    sock = lambda socks, name: [x for x in socks if x.name == name and x.type == 'RGBA'][0]
    mx.inputs['Factor'].default_value = 1; sock(mx.inputs, 'A').default_value = (1, 1, 1, 1)
    nt.links.new(sp.outputs['X'], mx.inputs['Factor']); nt.links.new(st.outputs['Color'], sock(mx.inputs, 'B'))
    mm = nt.nodes.new('ShaderNodeMix'); mm.data_type = 'RGBA'; mm.blend_type = 'MULTIPLY'; mm.inputs['Factor'].default_value = 1
    nt.links.new(vc.outputs['Color'], sock(mm.inputs, 'A')); nt.links.new(sock(mx.outputs, 'Result'), sock(mm.inputs, 'B'))
    nt.links.new(sock(mm.outputs, 'Result'), b.inputs['Base Color'])
    nmn = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeNormalMap'][0]; nt.links.new(sp.outputs['X'], nmn.inputs['Strength'])
    rr = nt.nodes.new('ShaderNodeMapRange'); nt.links.new(sp.outputs['Y'], rr.inputs['Value']); rr.inputs['To Min'].default_value = .36; rr.inputs['To Max'].default_value = .12
    nt.links.new(rr.outputs['Result'], b.inputs['Roughness'])
    rm = nt.nodes.new('ShaderNodeMapRange'); nt.links.new(sp.outputs['Y'], rm.inputs['Value']); rm.inputs['To Min'].default_value = .62; rm.inputs['To Max'].default_value = .95
    nt.links.new(rm.outputs['Result'], b.inputs['Metallic'])
    # shell: vertex AO multiply + glassy coat + a little subsurface glow
    nt = M_SHELL.node_tree; b = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    t = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage'][0]
    mm = nt.nodes.new('ShaderNodeMix'); mm.data_type = 'RGBA'; mm.blend_type = 'MULTIPLY'; mm.inputs['Factor'].default_value = 1
    nt.links.new(vc.outputs['Color'], sock(mm.inputs, 'A')); nt.links.new(t.outputs['Color'], sock(mm.inputs, 'B'))
    nt.links.new(sock(mm.outputs, 'Result'), b.inputs['Base Color'])
    try: b.inputs['Coat Weight'].default_value = .6; b.inputs['Coat Roughness'].default_value = .05
    except Exception: pass
    nt.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = .08
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    def shot(name, eye, at, lens=50):
        cam.lens = lens; co.location = to_b(eye); co.rotation_euler = (to_b(at) - to_b(eye)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
    only = arg('--only')
    want = lambda n: not only or n in only.split(',')
    pose(POSES['rest'])
    if want('top'): shot('top', (0, 4.2, -.02), (0, 0, .0), 50)
    if want('three-quarter'): shot('three-quarter', (2.1, 1.5, 2.4), (0, .02, .1), 50)
    if want('side'): shot('side', (3.6, .35, .1), (0, .03, .1), 50)
    if want('front'): shot('front', (0, .5, 3.6), (0, .05, 0), 50)
    if want('face'): shot('face', (.75, .3, 1.55), (0, .08, .8), 60)
    if want('below'): fo.hide_render = True; shot('below', (1.2, -2.2, 1.6), (0, 0, 0), 50); fo.hide_render = False
    if want('beak'): shot('beak', (.25, .06, 1.25), (0, .05, .93), 90)
    if want('flipper'): shot('flipper', (1.25, .75, .8), (.8, 0, .1), 70)
    for pn in ('downstroke', 'upstroke', 'glide', 'breathe', 'bask'):
        if want(pn): pose(POSES[pn]); shot(pn, (2.1, 1.5, 2.4), (0, .02, .1), 50)
print('TURTLE_BUILD_OK')
