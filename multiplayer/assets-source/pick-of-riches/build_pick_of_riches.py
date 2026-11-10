"""The Pick of Riches (2026-11-10) - reproducible Blender (bpy 4.5) builder.

Run (from this folder):
  python3.11 ../pick-refinement-20261004/paint_textures.py textures      # once; shared Stonewhisper textures
  python3.11 build_pick_of_riches.py -- --out ../../public/assets/pick.glb
  python3.11 build_pick_of_riches.py -- --render out/review [--samples 64] [--views hero,head]

Story. Stonewhisper was an assayer's pick before it was a weapon: a dwarf-smith's tool for reading a seam. Its head is
one billet of blued deepsteel, drawn into two arms and differentially hardened, so each point is white, glass-hard
steel that runs back through straw and violet into the blue (the temper colours are drawn at runtime from the arm
position). Down the spine of each arm a channel is cut and gold wire hammered into it: gold carries the resonance, so
when a point bites stone the ring runs home along the seam to the heart. Three sapphire crystals stand in gold
collets that pass right through each arm and are peened over underneath, raked toward the points. Two oval heart
stones are set in the cheeks of the eye; a crown of crystals grows from the gold wedge-cap that locks the haft in the
eye. Steel langets and gold straps are riveted down the hickory, carrying twelve small gauge stones that fill as the
special recharges. Oxblood leather grip, an assayer's wire wound above it, a faceted gold pommel, and on a thong the
assayer's tag: a stamped gold disc with a chip of the first crystal the pick ever cut.

Frame: Blender X = along the arms (+X is the right point), Y = through the cheeks, Z = up the haft. glTF export turns
that into +Y up; asset-pose.js reads the pick as forward +X, up +Y, pivot `Grip`.

Runtime contract (names other code relies on):
  meshes  PickHead (arms, Steel_Blued), HeadSocket (eye block + langets, Steel_Blued), ResonanceCrystal (hearts + arm
          crystals, Resonance_Crystal), Embellish_Crystal_Crown (crown, Resonance_Crystal), Embellish_Gold_Bands (the
          seam and scroll wires, Gold_Inlay), BrassTrim (all other gold, Brass_Trim), Shaft (Wood_Ash),
          GripWrap (Leather_Wrap), CharmTag (Brass_Trim, child of Charm)
  empties Grip, HitCentre, ChargeGlow, PickTipLeft, PickTipRight, Charm (the tag's pivot), Gauge0..Gauge11 (gauge
          stone seats; +Z of each is the face normal; tier = index // 4), Heart (centre of the eye)
Every mesh is untransformed in the root's space (pick-luminance's light spill shares one space).
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Matrix, Quaternion

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'pick.glb'))
RENDER = arg('--render')
TEX = arg('--textures', os.path.join(HERE, 'textures'))
TAU = math.tau
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def lerp(a, b, t): return a + (b - a) * t

# ------------------------------------------------------------------ mesh accumulator with per-corner UVs
class M:
    def __init__(self): self.v = []; self.f = []
    def vert(self, p): self.v.append(Vector(p)); return len(self.v) - 1
    def face(self, corners): self.f.append(corners)
    def grid(self, rows, uv, closed=True, flip=False):
        """rows: list of vertex-index rows (equal length n). uv(r, c) -> (u, v) for c in 0..n (n = wrap column)."""
        n = len(rows[0]); cols = n if closed else n - 1
        for r in range(len(rows) - 1):
            for c in range(cols):
                c2 = (c + 1) % n
                q = [(rows[r][c], uv(r, c)), (rows[r][c2], uv(r, c + 1)), (rows[r + 1][c2], uv(r + 1, c + 1)), (rows[r + 1][c], uv(r + 1, c))]
                self.face(q[::-1] if flip else q)
    def cap(self, row, center=None, uvc=(.5, .5), flip=False):
        if center is None:
            q = [(i, uvc) for i in row]; self.face(q[::-1] if flip else q); return
        ci = self.vert(center)
        for k in range(len(row)):
            q = [(row[k], uvc), (row[(k + 1) % len(row)], uvc), (ci, uvc)]
            self.face(q[::-1] if flip else q)
    def extend(self, other):
        base = len(self.v); self.v += other.v
        self.f += [[(i + base, uv) for i, uv in face] for face in other.f]
        return self

def loft(sections, uv=None, cap0=True, cap1=True, closed=True, tip0=None, tip1=None):
    m = M(); rows = [[m.vert(p) for p in s] for s in sections]
    n = len(sections[0])
    m.grid(rows, uv or (lambda r, c: (c / n, r / max(1, len(rows) - 1))), closed)
    if cap0: m.cap(rows[0], tip0, flip=False)
    if cap1: m.cap(rows[-1], tip1, flip=True)
    return m

def lathe(profile, segs=16, axis=Vector((0, 0, 1)), origin=Vector(), phase=0.0, ellipse=(1.0, 1.0), uvscale=(1.0, 1.0), ref=None):
    """profile [(r, h)] along `axis` from `origin`. A solid of revolution (capped where r > 0)."""
    U = Vector(axis).normalized(); X = ref or (Vector((1, 0, 0)) if abs(U.x) < .9 else Vector((0, 1, 0)))
    X = (X - U * X.dot(U)).normalized(); Y = U.cross(X)
    secs = [[Vector(origin) + U * h + X * (r * ellipse[0] * math.cos(phase + TAU * k / segs)) + Y * (r * ellipse[1] * math.sin(phase + TAU * k / segs)) for k in range(segs)] for r, h in profile]
    m = M(); rows = [[m.vert(p) for p in s] for s in secs]
    m.grid(rows, lambda r, c: (c / segs * uvscale[0], profile[r][1] * uvscale[1]))
    if profile[0][0] > 1e-6: m.cap(rows[0], Vector(origin) + U * profile[0][1])
    if profile[-1][0] > 1e-6: m.cap(rows[-1], Vector(origin) + U * profile[-1][1], flip=True)
    return m

def tube(path, radius, sides=8, cap=True):
    """Round wire along a polyline; radius may be a float or a list."""
    secs = []; prev = None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        ref = prev if prev is not None else (Vector((0, 0, 1)) if abs(t.z) < .9 else Vector((1, 0, 0)))
        n = (ref - t * ref.dot(t)).normalized(); b = t.cross(n); prev = n
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        secs.append([p + n * math.cos(TAU * k / sides) * r + b * math.sin(TAU * k / sides) * r for k in range(sides)])
    L = [0.0]
    for a, b in zip(path, path[1:]): L.append(L[-1] + (b - a).length)
    return loft(secs, lambda r, c: (c / sides, L[r] / .05), cap, cap,
                tip0=path[0] - (path[1] - path[0]).normalized() * (radius[0] if isinstance(radius, list) else radius) * .6 if cap else None,
                tip1=path[-1] + (path[-1] - path[-2]).normalized() * (radius[-1] if isinstance(radius, list) else radius) * .6 if cap else None)

def chamfer(points, bevel):
    """Every corner of a closed 2D polygon becomes two points on a narrow bevel."""
    out = []; n = len(points)
    for i in range(n):
        p, a, b = Vector(points[i]), Vector(points[i - 1]), Vector(points[(i + 1) % n])
        out.append(p + (a - p).normalized() * min(bevel, (a - p).length * .3))
        out.append(p + (b - p).normalized() * min(bevel, (b - p).length * .3))
    return out

# ------------------------------------------------------------------ the head: arm centreline and hex section
REACH = .322          # point to point half span (the PickTip sockets sit at the very points)
EYE_Z = .622          # centre of the eye / heart stones
def arm_t(ax): return clamp(ax / REACH)
def arm_c(t): return EYE_Z + .012 - .118 * t ** 1.85                 # droops harder toward the point
def fillet(t): return 1 + .42 * math.exp(-(t / .115) ** 2)            # the arm swells into the eye like a forged bolster
def arm_h(t): return (.0300 * (1 - t) ** .82 + .0011) * fillet(t)      # half height of the section
def arm_w(t): return (.0232 * (1 - t) ** .72 + .0009) * (1 + .3 * (fillet(t) - 1))  # half width (through the cheeks)
def arm_s(t): return .0031 * (1 - t) ** .6 + .0002                    # half width of the flat spine (the seam lies in it)
def arm_frame(x):
    """Centre, tangent (outward), up-normal of the arm at signed x."""
    side = 1 if x >= 0 else -1; ax = abs(x); t = arm_t(ax)
    c = Vector((x, 0, arm_c(t)))
    e = 1e-4; dz = (arm_c(arm_t(ax + e)) - arm_c(arm_t(max(0, ax - e)))) / (2 * e if ax > e else e)
    T = Vector((side, 0, dz)).normalized(); N = Vector((-T.z * side, 0, T.x * side)).normalized()
    if N.z < 0: N = -N
    return c, T, N
def arm_corners(t):
    """Section corners as (along N, along Y): spine flat (2), upper flank, lower flank, keel, mirrored."""
    h, w, s = arm_h(t), arm_w(t), arm_s(t)
    return [(h, s), (.30 * h, w), (-.46 * h, .80 * w), (-h, 0.0), (-.46 * h, -.80 * w), (.30 * h, -w), (h, -s)]
def arm_point(x, a, b):
    c, T, N = arm_frame(x); return c + N * a + Vector((0, b, 0))

def build_arm(side):
    xs = []
    x = .006
    while x < REACH - .0005:
        xs.append(x); x += .006 if x < .2 else .0035
    xs.append(REACH - .0005)
    secs = []
    for x in xs:
        t = arm_t(x); poly = chamfer(arm_corners(t), .0009 * (1 - t) + .00025)
        secs.append([arm_point(side * x, a, b) for a, b in poly])
    n = len(secs[0])
    perim = [sum((Vector(s[(k + 1) % n]) - Vector(s[k])).length for k in range(n)) for s in secs]
    def uv(r, c):
        return (xs[r] / .33, c / n * perim[r] / .33)
    tip = arm_point(side * REACH, 0, 0)
    m = loft(secs, uv, cap0=True, cap1=True, tip1=tip)
    if side < 0: m.f = [face[::-1] for face in m.f]
    return m

# The seam: a gold strip lying in the spine flat, from inside the eye to just short of the hardened point.
SEAM = (.036, .252)
def build_seam(side):
    xs = [SEAM[0] + (SEAM[1] - SEAM[0]) * i / 60 for i in range(61)]
    secs = []
    for x in xs:
        t = arm_t(x); h, s = arm_h(t), arm_s(t)
        taper = smooth((SEAM[1] - x) / .02); half = s * .72 * taper + .00012
        secs.append([arm_point(side * x, h + .00045, half), arm_point(side * x, h + .00045, -half),
                     arm_point(side * x, h - .0004, -half), arm_point(side * x, h - .0004, half)])
    m = loft(secs, lambda r, c: (xs[r] / .05, c / 4))
    if side < 0: m.f = [face[::-1] for face in m.f]
    return m

# Scroll wires: one hammered line along each upper flank face, ending in a curl where the hardening begins.
def flank_point(x, ySign, u=.5, lift=.0005):
    t = arm_t(abs(x)); k = arm_corners(t)
    a0, b0 = k[0] if ySign > 0 else k[6]; a1, b1 = k[1] if ySign > 0 else k[5]
    a, b = lerp(a0, a1, u), lerp(b0, b1, u)
    p = arm_point(x, a, b)
    q0 = arm_point(x, a0, b0); q1 = arm_point(x, a1, b1); c, T, N = arm_frame(x)
    across = (q1 - q0).normalized(); nrm = T.cross(across).normalized()
    if nrm.dot(p - c) < 0: nrm = -nrm
    return p + nrm * lift, across, nrm, T
def build_scroll(side, ySign):
    pts = [flank_point(side * (.046 + (.232 - .046) * i / 50), ySign, .42)[0] for i in range(51)]
    p0, across, nrm, T = flank_point(side * .232, ySign, .42)
    rho = .0062; center = p0 + across * rho
    for i in range(1, 26):
        th = i / 25 * 1.75 * math.pi; r = rho * (1 - .62 * i / 25)
        pts.append(center - across * r * math.cos(th) + T * r * math.sin(th) + nrm * .0001 * i / 25)
    radii = [.00078 * (.55 + .45 * smooth(i / 6)) * (1 - .35 * max(0, i - 50) / 25) for i in range(len(pts))]
    return tube(pts, radii, sides=6)

# Crystals: hexagonal prisms with a pyramidal termination; slightly irregular so they read as grown, not turned.
def crystal(base, axis, radius, length, ref=Vector((0, 1, 0)), seed=0.0, sink=.003, point=.34):
    U = Vector(axis).normalized(); X = (ref - U * ref.dot(U)).normalized(); Y = U.cross(X)
    jag = [1 + .12 * math.sin(seed * 7.1 + k * 2.3) for k in range(6)]
    ring = lambda h, s: [Vector(base) + U * h + (X * math.cos(TAU * k / 6 + seed) + Y * math.sin(TAU * k / 6 + seed)) * radius * s * jag[k] for k in range(6)]
    secs = [ring(-sink, .92), ring(length * (1 - point) * .55, 1.0), ring(length * (1 - point), .96)]
    tipp = Vector(base) + U * length + X * radius * .08 * math.sin(seed * 3)
    return loft(secs, lambda r, c: (c / 6, r / 2), cap0=True, cap1=True, tip1=tipp)

# Collet: a gold tube through the arm, its rim rising around the crystal, four prongs up its flanks.
def collet(base, axis, radius, height=.0055, prongs=4, ref=Vector((0, 1, 0)), prong_len=.0075):
    U = Vector(axis).normalized()
    m = lathe([(radius * .82, -.004), (radius * 1.22, -.0012), (radius * 1.30, .0008), (radius * 1.24, height * .55), (radius * 1.08, height), (radius * .96, height * .9)],
              segs=16, axis=U, origin=base, uvscale=(2, 40))
    X = (ref - U * ref.dot(U)).normalized(); Y = U.cross(X)
    for k in range(prongs):
        a = TAU * (k + .5) / prongs; d = X * math.cos(a) + Y * math.sin(a)
        p0 = base + U * height * .7 + d * radius * 1.12
        pts = [p0 + U * prong_len * i / 5 + d * (-.24 * radius * (i / 5) ** 1.4) for i in range(6)]
        m.extend(tube(pts, [.0011, .0011, .00105, .001, .0009, .0007], sides=5))
    return m

# ------------------------------------------------------------------ the eye block (HeadSocket)
EYE = dict(halfx=.0355, halfy=.0355, z0=.532, z1=.708)
OCT = chamfer([(EYE['halfx'], .0147), (.0147, EYE['halfy']), (-.0147, EYE['halfy']), (-EYE['halfx'], .0147),
               (-EYE['halfx'], -.0147), (-.0147, -EYE['halfy']), (.0147, -EYE['halfy']), (EYE['halfx'], -.0147)], .0011)
EYE_ROWS = [(.552, .70), (.557, .86), (.5615, .97), (.564, 1.0), (.686, 1.0), (.6885, .97), (.6925, .88), (.6965, .80)]
def oct_ring(z, s, grow=0.0):
    return [Vector((x * s + (grow * x / max(1e-6, math.hypot(x, y))), y * s + (grow * y / max(1e-6, math.hypot(x, y))), z)) for x, y in OCT]
def build_eye():
    secs = [oct_ring(z, s) for z, s in EYE_ROWS]
    return loft(secs, lambda r, c: (c / len(OCT) * .9, EYE_ROWS[r][0] / .33))
def eye_band(z0, z1, grow=.0009):
    zs = [z0, z0 + .0015, z1 - .0015, z1]; g = [grow * .3, grow, grow, grow * .3]
    secs = [oct_ring(z, 1.0, gg) for z, gg in zip(zs, g)]
    return loft(secs, lambda r, c: (c / len(OCT) * 3, r / 3), cap0=False, cap1=False)

# ------------------------------------------------------------------ haft (hickory), langets, straps
HAFT_RX, HAFT_RY = .0205, .0178
HAFT_PROFILE = [(-.030, 1.0), (.010, 1.0), (.10, .99), (.22, 1.0), (.36, 1.03), (.46, 1.06), (.53, 1.08), (.70, 1.0)]
def haft_scale(z):
    P = HAFT_PROFILE
    if z <= P[0][0]: return P[0][1]
    for (z0, s0), (z1, s1) in zip(P, P[1:]):
        if z <= z1: return lerp(s0, s1, smooth((z - z0) / (z1 - z0)))
    return P[-1][1]
def haft_point(z, a, lift=0.0):
    s = haft_scale(z); rx, ry = HAFT_RX * s, HAFT_RY * s
    p = Vector((rx * math.cos(a), ry * math.sin(a), z)); n = Vector((math.cos(a) / rx, math.sin(a) / ry, 0)).normalized()
    return p + n * lift, n
def build_haft():
    zs = [-.006] + [.010 + i * .02 for i in range(35)] + [.70]
    segs = 24
    secs = [[haft_point(z, TAU * k / segs)[0] for k in range(segs)] for z in zs]
    return loft(secs, lambda r, c: (c / segs, (zs[r] + .03) / .14))
def build_grip(z0=.106, z1=.334, pitch=.0165, rows=96, around=24):
    """Overlapping helical oxblood strip: the radius ramps across each strip so every turn laps the one below."""
    m = M(); grid = []; uvs = []
    for i in range(rows + 1):
        z = lerp(z0, z1, i / rows); row = []; urow = []
        for j in range(around):
            s = j / around; a = TAU * s
            phase = ((z - z0 - s * pitch) / pitch % 1 + 1) % 1
            lap = phase / .9 if phase < .9 else 1 - (phase - .9) / .1 * .85
            ends = smooth((z - z0) / .004) * smooth((z1 - z) / .004)
            p, n = haft_point(z, a, .0006 + (.0012 + .0017 * math.sqrt(lap)) * ends)
            row.append(m.vert(p)); urow.append(((s + (z - z0) / pitch) * .5, phase))
        grid.append(row); uvs.append(urow)
    def uv(r, c):
        if c < around: return uvs[r][c]
        u, v = uvs[r][0]; return (u + .5, v)
    m.grid(grid, uv)
    return m
def plate(theta, z_top, z_bot, half_w, thick, point=.012):
    """A strap lying on the haft, centred at angle theta, spear-pointed at the bottom."""
    zs = [z_top - (z_top - z_bot) * i / 24 for i in range(25)]
    secs = []
    for z in zs:
        s = haft_scale(z); r = (HAFT_RX + HAFT_RY) * .5 * s
        wz = half_w * (smooth((z - z_bot) / point) * .92 + .08)
        da = wz / r; across = [-1, -.6, 0, .6, 1]
        top = [haft_point(z, theta + da * k, thick * (1 - .25 * abs(k) ** 3))[0] for k in across]
        bot = [haft_point(z, theta + da * k, -.0003)[0] for k in reversed(across)]
        secs.append(top + bot)
    return loft(secs, lambda r, c: (c / 10, zs[r] / .05))
def rivet(z, theta, lift, r=.0019):
    p, n = haft_point(z, theta, lift)
    return lathe([(r, -.0006), (r * .95, .0004), (r * .7, .0011), (r * .25, .0015)], segs=10, axis=n, origin=p, uvscale=(1, 50))

# ------------------------------------------------------------------ assemble
PARTS = {k: M() for k in ('PickHead', 'HeadSocket', 'ResonanceCrystal', 'Embellish_Crystal_Crown', 'Embellish_Gold_Bands', 'BrassTrim', 'Shaft', 'GripWrap', 'CharmTag')}
P = PARTS
for side in (-1, 1):
    P['PickHead'].extend(build_arm(side))
    P['Embellish_Gold_Bands'].extend(build_seam(side))
    for ySign in (-1, 1): P['Embellish_Gold_Bands'].extend(build_scroll(side, ySign))

# Arm crystals in collets, raked toward the point; peened tails under the keel.
ARM_GEMS = [(.080, .0072, .036, 0.3), (.140, .0060, .029, 1.7), (.194, .0047, .022, 2.9)]
for side in (-1, 1):
    for x, r, L, seed in ARM_GEMS:
        c, T, N = arm_frame(side * x); t = arm_t(x)
        base = c + N * arm_h(t)
        axis = (N * math.cos(math.radians(20)) + T * math.sin(math.radians(20))).normalized()
        P['ResonanceCrystal'].extend(crystal(base + axis * .0012, axis, r, L, seed=seed + (side > 0) * .9))
        P['BrassTrim'].extend(collet(base - axis * .0008, axis, r, height=.0052, prong_len=L * .32))
        keel = c - N * arm_h(t) * .995
        P['BrassTrim'].extend(lathe([(r * .62, .0004), (r * .58, -.0004), (r * .38, -.0011), (r * .08, -.0014)], segs=12, axis=N, origin=keel, uvscale=(1, 40)))

# Eye block with gold rims; heart stones in the cheeks.
P['HeadSocket'].extend(build_eye())
P['BrassTrim'].extend(eye_band(.564, .573)).extend(eye_band(.677, .686))
for k in range(4):   # gold corner straps on the eye's diagonal faces, each with a rivet at both ends
    a = TAU * k / 4 + TAU / 8; d = Vector((math.cos(a), math.sin(a), 0))
    # the diagonal face centre at this octagon: midpoint between its two chamfered corners
    face_pt = Vector((math.copysign(.0251, d.x), math.copysign(.0251, d.y), 0)); side = Vector((-d.y, d.x, 0))
    zs = [.573 + (.677 - .573) * i / 12 for i in range(13)]
    secs = [[face_pt + side * w + d * lift + Vector((0, 0, z)) for w, lift in ((-.0043, -.0003), (-.0040, .0011), (.0040, .0011), (.0043, -.0003))] for z in zs]
    P['BrassTrim'].extend(loft(secs, lambda r, c: (c / 4, zs[r] / .05)))
    for z in (.581, .669):
        P['BrassTrim'].extend(lathe([(.0018, -.0004), (.0017, .0004), (.0012, .0010), (.0004, .0013)], segs=8, axis=d, origin=face_pt + d * .0011 + Vector((0, 0, z)), uvscale=(1, 40)))
for ySign in (-1, 1):
    face = Vector((0, ySign * EYE['halfy'], EYE_Z)); out = Vector((0, ySign, 0))
    rx, rz = .0122, .0205
    # rose-cut oval: girdle, crown facets, table
    def oval(s, lift, n=12, ph=0.0):
        return [face + out * lift + Vector((rx * s * math.cos(TAU * k / n + ph), 0, rz * s * math.sin(TAU * k / n + ph))) for k in range(n)]
    secs = [oval(.92, -.0015), oval(1.0, .0026), oval(.86, .0058, ph=TAU / 24), oval(.52, .0089)]
    stone = loft(secs, lambda r, c: (c / 12, r / 3), cap0=True, cap1=True)
    if ySign < 0: stone.f = [f[::-1] for f in stone.f]
    P['ResonanceCrystal'].extend(stone)
    # bezel: an oval gold wall with a rope rim, and six claws
    ring_pts = lambda s, lift, n=40: [face + out * lift + Vector((rx * s * math.cos(TAU * k / n), 0, rz * s * math.sin(TAU * k / n))) for k in range(n)]
    bez = loft([ring_pts(1.18, -.0004), ring_pts(1.22, .0018), ring_pts(1.13, .0042), ring_pts(1.04, .0040), ring_pts(1.03, .0016)], lambda r, c: (c / 40 * 3, r / 4), cap0=False, cap1=False)
    if ySign < 0: bez.f = [f[::-1] for f in bez.f]
    P['BrassTrim'].extend(bez)
    for k in range(6):
        a = TAU * (k + .5) / 6; d = Vector((rx * math.cos(a), 0, rz * math.sin(a)))
        pts = [face + out * (.0034 + .0022 * i / 4) + d * (1.12 - .2 * (i / 4) ** 1.3) for i in range(5)]
        P['BrassTrim'].extend(tube(pts, [.00125, .0012, .0011, .001, .0009], sides=5))

# Crown: gold wedge-cap riveted on the eye, crystal druse growing from it.
cap = lathe([(.0, .6955), (.0268, .6955), (.0284, .6990), (.0264, .7035), (.0200, .7060), (.0118, .7072)], segs=8, phase=TAU / 16, uvscale=(2, 40))
P['BrassTrim'].extend(cap)
for k in range(4):
    a = TAU * k / 4 + TAU / 8; p = Vector((math.cos(a) * .0205, math.sin(a) * .0205, .7035))
    P['BrassTrim'].extend(lathe([(.0021, -.0006), (.002, .0004), (.0014, .0011), (.0005, .0015)], segs=8, origin=p, uvscale=(1, 40)))
CROWN = Vector((0, 0, .705))
P['BrassTrim'].extend(collet(CROWN - Vector((0, 0, .002)), Vector((0, 0, 1)), .0104, height=.0072, prongs=6, prong_len=.013))
P['Embellish_Crystal_Crown'].extend(crystal(CROWN, Vector((0, 0, 1)), .0098, .052, seed=.4, point=.30))
for k, (ax, ay, lean, r, L) in enumerate([(1, .25, 28, .0058, .030), (-1, -.2, 28, .0058, .030), (.2, 1, 33, .0046, .022), (-.25, -1, 33, .0046, .022), (.7, -.7, 42, .0036, .015), (-.7, .7, 42, .0036, .015)]):
    d = Vector((ax, ay, 0)).normalized(); axis = (Vector((0, 0, 1)) * math.cos(math.radians(lean)) + d * math.sin(math.radians(lean))).normalized()
    P['Embellish_Crystal_Crown'].extend(crystal(CROWN + d * .0074 - Vector((0, 0, .0005)), axis, r, L, seed=1.3 * k + .2, sink=.004))

# Haft, throat, langets, straps, gauge seats, wire, grip, pommel.
P['Shaft'].extend(build_haft())
P['BrassTrim'].extend(lathe([(HAFT_RX * 1.10, .507), (HAFT_RX * 1.25, .510), (HAFT_RX * 1.26, .516), (HAFT_RX * 1.21, .519), (HAFT_RX * 1.23, .530), (HAFT_RX * 1.32, .537),
                             (HAFT_RX * 1.36, .545), (HAFT_RX * 1.2, .553)], segs=24, ellipse=(1, HAFT_RY / HAFT_RX), uvscale=(3, 40)))
for theta in (math.pi / 2, -math.pi / 2):      # blued langets through the cheeks
    P['HeadSocket'].extend(plate(theta, .530, .392, .0088, .0017, point=.016))
    for z in (.432, .405): P['BrassTrim'].extend(rivet(z, theta, .0016))
for theta in (0.0, math.pi):                     # gold side straps
    P['BrassTrim'].extend(plate(theta, .530, .438, .0064, .0013, point=.012))
GAUGES = []
for tier, z in enumerate((.458, .484, .510)):
    for k, theta in enumerate((0.0, math.pi / 2, math.pi, -math.pi / 2)):
        lift = .0016 if k % 2 else .0012
        p, n = haft_point(z, theta, lift)
        P['BrassTrim'].extend(lathe([(.0041, -.0004), (.0050, .0006), (.0049, .0016), (.0040, .0021), (.0034, .0016)], segs=12, axis=n, origin=p, uvscale=(2, 40)))
        GAUGES.append((p + n * .0011, n, tier))
wire = []
for i in range(80):
    z = .348 + (.386 - .348) * i / 79; a = TAU * 1.5 * i / 79 + .3
    wire.append(haft_point(z, a, .0007)[0])
P['BrassTrim'].extend(tube(wire, .00085, sides=6))
P['GripWrap'].extend(build_grip())
for z0, z1 in ((.094, .107), (.333, .346)):
    P['BrassTrim'].extend(lathe([(HAFT_RX * 1.13, z0), (HAFT_RX * 1.25, z0 + .002), (HAFT_RX * 1.27, (z0 + z1) / 2), (HAFT_RX * 1.25, z1 - .002), (HAFT_RX * 1.13, z1)],
                                segs=24, ellipse=(1, HAFT_RY / HAFT_RX), uvscale=(3, 40)))
POMMEL = [(HAFT_RX * 1.16, -.010), (HAFT_RX * 1.24, -.016), (.0262, -.024), (.0270, -.031), (.0232, -.040), (.0150, -.0465), (.0, -.0488)]
P['BrassTrim'].extend(lathe([(HAFT_RX * 1.13, .006), (HAFT_RX * 1.17, .002)] + POMMEL, segs=8, phase=TAU / 16, uvscale=(2, 40)))
# bail ring under the pommel (the charm hangs from it)
bail = [Vector((.0052 * math.cos(TAU * i / 24), 0, -.0545 + .0052 * math.sin(TAU * i / 24))) for i in range(25)]
P['BrassTrim'].extend(tube(bail, .0012, sides=6, cap=False))

# Charm (child of the Charm pivot, in pivot space): leather thong loop + the assayer's tag with a chip of crystal.
CHARM_PIVOT = Vector((0, 0, -.0590))
charm = M()
thong = [Vector((.0016 * math.sin(TAU * i / 32), .0062 * math.cos(TAU * i / 32), -.0085 + .0085 * math.cos(TAU * i / 32) * .98)) for i in range(33)]
charm_leather = tube(thong, .0011, sides=5, cap=False)
tag_c = Vector((0, 0, -.0255))
charm.extend(lathe([(.0, -.0011), (.0112, -.0011), (.0118, -.0005), (.0118, .0005), (.0112, .0011), (.0, .0011)], segs=20, axis=Vector((0, 1, 0)), origin=tag_c, uvscale=(1, 40), ref=Vector((1, 0, 0))))
for ySign in (-1, 1):   # raised rim, a stamped pick mark, and a crystal chip in a tiny bezel on the front
    charm.extend(tube([tag_c + Vector((.0094 * math.cos(TAU * i / 28), ySign * .00115, .0094 * math.sin(TAU * i / 28))) for i in range(29)], .00042, sides=4, cap=False))
    charm.extend(tube([tag_c + Vector((-.0055, ySign * .00118, .0028)), tag_c + Vector((0, ySign * .00118, .0052)), tag_c + Vector((.0055, ySign * .00118, .0028))], .00038, sides=4))
    charm.extend(tube([tag_c + Vector((0, ySign * .00118, .0048)), tag_c + Vector((0, ySign * .00118, -.0062))], .00034, sides=4))
chip = crystal(tag_c + Vector((0, .0011, -.0012)), Vector((0, 1, 0)), .0024, .0032, ref=Vector((0, 0, 1)), seed=4.2, sink=.0006, point=.6)

# ------------------------------------------------------------------ materials
def hexc(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def lin(h): return tuple(c ** 2.2 for c in hexc(h)) + (1,)
MAT = {
    'Steel_Blued':       dict(c='ffffff', m=.88, r=.34, tex='steel', ns=.28),
    'Brass_Trim':        dict(c='f2b84e', m=1.0, r=.27, tex='brass', ns=.14),
    'Gold_Inlay':        dict(c='ffcf63', m=1.0, r=.2, tex='brass', ns=.1),
    'Resonance_Crystal': dict(c='0a2a8c', m=0.0, r=.06),
    'Wood_Ash':          dict(c='8a7058', m=0.0, r=.62, tex='wood', ns=.7),
    'Leather_Wrap':      dict(c='a8605a', m=0.0, r=.78, tex='leather', ns=.9),
    'Leather_Thong':     dict(c='4a1e14', m=0.0, r=.7),
}
IMAGES = {}
def image(name):
    if name not in IMAGES:
        IMAGES[name] = bpy.data.images.load(os.path.join(TEX, name)); IMAGES[name].name = name
    return IMAGES[name]
MATS = {}
def material(name):
    if name in MATS: return MATS[name]
    d = MAT[name]; m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(d['c']); b.inputs['Metallic'].default_value = d['m']; b.inputs['Roughness'].default_value = d['r']
    if 'tex' in d:
        ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = image(f"{d['tex']}_color.jpg")
        if d['c'] != 'ffffff':
            mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
            nt.links.new(ti.outputs['Color'], mul.inputs[6]); mul.inputs[7].default_value = lin(d['c'])
            nt.links.new(mul.outputs[2], b.inputs['Base Color'])
        else:
            nt.links.new(ti.outputs['Color'], b.inputs['Base Color'])
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = image(f"{d['tex']}_normal.jpg"); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = d['ns']
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    MATS[name] = m; return m
OBJ_MAT = {'PickHead': 'Steel_Blued', 'HeadSocket': 'Steel_Blued', 'ResonanceCrystal': 'Resonance_Crystal', 'Embellish_Crystal_Crown': 'Resonance_Crystal',
           'Embellish_Gold_Bands': 'Gold_Inlay', 'BrassTrim': 'Brass_Trim', 'Shaft': 'Wood_Ash', 'GripWrap': 'Leather_Wrap', 'CharmTag': 'Brass_Trim'}
FLAT = {'ResonanceCrystal', 'Embellish_Crystal_Crown', 'CharmChip'}

# ------------------------------------------------------------------ to Blender
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
ROOT = bpy.data.objects.new('StonewhisperPick', None); SC.collection.objects.link(ROOT)
def to_object(name, m, mat, parent=ROOT, sharp=32, flat=False):
    bm = bmesh.new(); verts = [bm.verts.new(p) for p in m.v]; uvl = bm.loops.layers.uv.new('UVMap')
    for face in m.f:
        idx = [i for i, _ in face]
        if len(set(idx)) < 3: continue
        try: f = bm.faces.new([verts[i] for i in idx])
        except ValueError: continue
        for loop, (_, uv) in zip(f.loops, face): loop[uvl].uv = uv
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    if not flat: me.set_sharp_from_angle(angle=math.radians(sharp))
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o); o.parent = parent
    return o
def empty(name, loc, parent=ROOT, rot=None):
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o); o.parent = parent
    o.location = loc
    if rot is not None: o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    return o
SHARP = {'PickHead': 28, 'HeadSocket': 28, 'BrassTrim': 40, 'Embellish_Gold_Bands': 50, 'Shaft': 50, 'GripWrap': 70}
for name, m in PARTS.items():
    if name == 'CharmTag' or not m.f: continue
    to_object(name, m, OBJ_MAT[name], sharp=SHARP.get(name, 32), flat=name in FLAT)
for k, (p, n, tier) in enumerate(GAUGES):
    empty(f'Gauge{k}', p, rot=Vector((0, 0, 1)).rotation_difference(n))
empty('Grip', Vector((0, 0, .22)))
empty('HitCentre', Vector((0, 0, .58)))
empty('ChargeGlow', Vector((0, 0, EYE_Z)))
empty('Heart', Vector((0, 0, EYE_Z)))
empty('Crown', CROWN + Vector((0, 0, .02)))
tipR, tipL = arm_point(REACH, 0, 0), arm_point(-REACH, 0, 0)
empty('PickTipRight', tipR, rot=Quaternion((0, 1, 0), math.radians(90)))
empty('PickTipLeft', tipL, rot=Quaternion((0, 1, 0), math.radians(-90)))
charm_pivot = empty('Charm', CHARM_PIVOT)
to_object('CharmTag', charm, 'Brass_Trim', parent=charm_pivot, sharp=40)
to_object('CharmThong', charm_leather, 'Leather_Thong', parent=charm_pivot, sharp=60)
to_object('CharmChip', chip, 'Resonance_Crystal', parent=charm_pivot, flat=True)

# ------------------------------------------------------------------ checks + export
bpy.context.view_layer.update()
def tri_count(): return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SC.objects if o.type == 'MESH')
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in SC.objects:
    if o.type != 'MESH': continue
    for v in o.data.vertices:
        w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
REPORT = {'triangles': tri_count(), 'per_mesh': {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SC.objects if o.type == 'MESH'},
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi], 'tips': [list(map(lambda v: round(v, 4), tipL)), list(map(lambda v: round(v, 4), tipR))]}
assert REPORT['triangles'] < 36000, REPORT['triangles']
for n in ('Grip', 'HitCentre', 'ChargeGlow', 'PickTipLeft', 'PickTipRight', 'Charm', 'Gauge11', 'ResonanceCrystal', 'Embellish_Crystal_Crown', 'HeadSocket', 'PickHead', 'Shaft', 'GripWrap', 'BrassTrim', 'Embellish_Gold_Bands'):
    assert n in bpy.data.objects, n
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                          export_normals=True, export_texcoords=True, export_extras=False, export_image_format='AUTO')
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps({k: v for k, v in REPORT.items() if k != 'per_mesh'}))

# ------------------------------------------------------------------ review renders (Cycles; real glass + light, for judging the model)
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 64)); SC.cycles.device = 'CPU'
    SC.cycles.use_denoising = True; SC.cycles.max_bounces = 10; SC.cycles.transmission_bounces = 10; SC.cycles.glossy_bounces = 6
    SC.view_settings.view_transform = 'AgX'; SC.view_settings.look = 'AgX - Medium High Contrast'
    # crystals: real sapphire glass + a faint inner glow (the charged state)
    cm = MATS['Resonance_Crystal']; b = cm.node_tree.nodes['Principled BSDF']
    b.inputs['Transmission Weight'].default_value = float(arg('--clear', .0)); b.inputs['IOR'].default_value = 1.77; b.inputs['Roughness'].default_value = .02
    b.inputs['Base Color'].default_value = (.008, .05, .32, 1); b.inputs['Coat Weight'].default_value = 1.0; b.inputs['Coat Roughness'].default_value = .02
    b.inputs['Specular IOR Level'].default_value = .9
    va = cm.node_tree.nodes.new('ShaderNodeVolumeAbsorption'); va.inputs['Color'].default_value = (.04, .22, 1.0, 1); va.inputs['Density'].default_value = float(arg('--depth', 380))
    cm.node_tree.links.new(va.outputs[0], cm.node_tree.nodes['Material Output'].inputs['Volume'])
    b.inputs['Emission Color'].default_value = (.08, .38, 1.0, 1); b.inputs['Emission Strength'].default_value = float(arg('--glow', .7))
    gi = MATS['Gold_Inlay'].node_tree.nodes['Principled BSDF']
    gi.inputs['Emission Color'].default_value = (.25, .62, 1.0, 1); gi.inputs['Emission Strength'].default_value = float(arg('--seam', 0))
    # temper colours on the steel: blue body, violet, straw, then white hardened points (mirrors the runtime shader)
    st = MATS['Steel_Blued']; nt = st.node_tree; sb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; nt.links.new(sep.outputs[0], ab.inputs[0])
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 90; nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    wob = nt.nodes.new('ShaderNodeMath'); wob.operation = 'MULTIPLY_ADD'; nt.links.new(noise.outputs['Fac'], wob.inputs[0]); wob.inputs[1].default_value = .012; wob.inputs[2].default_value = -.006
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'; nt.links.new(ab.outputs[0], add.inputs[0]); nt.links.new(wob.outputs[0], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(add.outputs[0], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements; els[0].position = .0; els[0].color = (1, 1, 1, 1); els[1].position = .228; els[1].color = (1, 1, 1, 1)
    for pos, col in ((.240, (1.25, .62, 1.5, 1)), (.256, (2.1, 1.15, .45, 1)), (.272, (2.6, 2.3, 1.7, 1)), (.29, (3.0, 3.0, 3.0, 1))):
        e = els.new(pos); e.color = col
    rough = nt.nodes.new('ShaderNodeMapRange'); nt.links.new(add.outputs[0], rough.inputs['Value']); rough.inputs['From Min'].default_value = .25; rough.inputs['From Max'].default_value = .29
    rough.inputs['To Min'].default_value = .36; rough.inputs['To Max'].default_value = .16; nt.links.new(rough.outputs[0], sb.inputs['Roughness'])
    tex_link = [l for l in nt.links if l.to_socket == sb.inputs['Base Color']][0]; src = tex_link.from_socket
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    nt.links.new(src, mix.inputs[6]); nt.links.new(ramp.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], sb.inputs['Base Color'])

    for k, (p, n, tier) in enumerate(GAUGES):   # stand-ins for the runtime gauge stones (charged)
        g = crystal(p - n * .0006, n, .0030, .0068, ref=Vector((0, 0, 1)), seed=k, sink=.0005, point=.5)
        to_object(f'GaugeStone{k}', g, 'Resonance_Crystal', flat=True)
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.06, .07, .09, 1); bg.inputs[1].default_value = 1.0
    def light(loc, e, s=.5, col=(1, 1, 1), at=(0, 0, .45)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((1.3, -1.5, 1.4), 300, col=(1, .9, .76)); light((-1.6, .4, .9), 140, col=(.55, .72, 1.0)); light((0, 1.6, 1.6), 160, s=1.2); light((.2, -.4, -1.0), 40, col=(1, .85, .6))
    heart = bpy.data.lights.new('heart', 'POINT'); heart.energy = float(arg('--heart', 1.6)); heart.color = (.3, .6, 1.0); heart.shadow_soft_size = .01
    ho = bpy.data.objects.new('heart', heart); ho.location = (0, 0, .78); SC.collection.objects.link(ho)
    floor = bpy.data.meshes.new('floor'); bmf = bmesh.new(); bmesh.ops.create_grid(bmf, x_segments=1, y_segments=1, size=4); bmf.to_mesh(floor); bmf.free()
    fo = bpy.data.objects.new('floor', floor); fo.location = (0, 0, -.25); SC.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.035, .038, .045, 1)
    fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .5; floor.materials.append(fm)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {
        'hero':    ((.95, -1.35, .78), (0, 0, .36), 42, (1200, 1400)),
        'profile': ((0, -1.9, .36), (0, 0, .36), 40, (1200, 1400)),
        'head':    ((.24, -.42, .76), (0, 0, .62), 50, (1600, 1000)),
        'heart':   ((.07, -.24, .67), (0, 0, .630), 60, (1400, 1000)),
        'point':   ((.40, -.17, .60), (.22, 0, .58), 55, (1400, 1000)),
        'end':     ((1.5, -.05, .4), (0, 0, .38), 40, (700, 1400)),
        'grip':    ((.22, -.36, .02), (0, 0, .08), 55, (1000, 1200)),
        'fp':      ((-.13, -.36, .40), (.10, .05, .62), 30, (1600, 1000)),
    }
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens, res) in views.items():
        SC.render.resolution_x, SC.render.resolution_y = res
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
        print('rendered', name, round(time.time() - T0, 1))
