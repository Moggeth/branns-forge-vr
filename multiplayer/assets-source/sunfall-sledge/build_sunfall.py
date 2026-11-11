"""The Sunfall Sledge (2026-11-11) - reproducible Blender (bpy 5.x or 4.5) builder.

Run (from this folder):
  python ../pick-refinement-20261004/paint_textures.py textures      # once; the shared hero-kit textures (ignored)
  python build_sunfall.py -- --out ../../public/assets/hammer.glb
  python build_sunfall.py -- --out out/hammer.glb --render out/review [--samples 48] [--views hero,head]

Story. Dawnhold's wall-raisers drove footing stones with sledges, and the Sunfall was the one they kept for the last
stone of a wall: the stone that has to go down true or the wall leans for a hundred years. Its head is one octagonal
billet of blackened iron, cast hollow around a sunstone heart that a smith caught in the forge at noon on midsummer.
Heat that goes into the head comes out again as light: through four slotted vents on the crown of the head, and
through a rose-cut sunstone set in each cheek, ringed by twelve gold rays hammered into the iron. Two hammered-steel
bands shrink-fitted round the head keep the casting from splitting; their rivets stand proud. The front is a broad,
dead-flat striking face of bright steel (it is the face that lays stones true), the back a smaller drift face for
setting wedges. The ash haft is octagonal so it never turns in the hand; steel langets riveted down it keep a missed
blow from snapping it under the head, and a gold wedge-cap on the crown locks it in the eye. Oxblood leather grip,
a brass collar, and a faceted brass pommel with a chip of the same sunstone.

When the Sunfall comes down on purpose (the slam), the heat in the heart goes out all at once: the vents flare, the
cheek stones flash white-gold, and the ground takes the light as a ring of cracks. The heart then has to warm again,
which is why the slam has a cooldown and why the vents and stones visibly fill back up (client/sunfall-sledge.js).

Frame: Blender X = along the head (+X is the striking face), Y = through the cheeks, Z = up the haft. glTF export
turns that into +Y up; asset-pose.js reads the sledge as forward +X, up +Y, pivot [0, .205, 0] (the middle of the
grip), native scale. The head centre is at z .83 and the face at x .345, the same frame as the 2026-10-05 model.

Runtime contract (names other code relies on):
  meshes  SledgeHead (body + drift face, Iron_Forged), StrikeFace + Bands (Steel_Face), SunInlay (rays, cap, bezels,
          rivets, collars; Gold_Inlay), Sunstone (cheek stones + pommel chip, Sunstone), Vents (glowing vent glass,
          Vent_Glow), Haft (Wood_Ash), GripWrap (Leather_Wrap), Langets (Steel_Face), Pommel (Brass_Trim)
  empties Grip, Heart (centre of the head), HitCentre (middle of the striking face), FaceFront (+Z of it = out of the
          face), SunLeft / SunRight (cheek stone centres, +Z out of the cheek), Vent0..Vent3 (vent centres),
          SunStud0..11 (long-ray studs, left 0..5 then right 6..11, clockwise from the top; +Z out of the cheek)
Every mesh is untransformed in the root's space.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Quaternion

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'hammer.glb'))
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
        n = len(rows[0]); cols = n if closed else n - 1
        for r in range(len(rows) - 1):
            for c in range(cols):
                c2 = (c + 1) % n
                q = [(rows[r][c], uv(r, c)), (rows[r][c2], uv(r, c + 1)), (rows[r + 1][c2], uv(r + 1, c + 1)), (rows[r + 1][c], uv(r + 1, c))]
                self.face(q[::-1] if flip else q)
    def cap(self, row, center=None, uvc=(.5, .5), flip=False, uvs=None):
        if center is None:
            q = [(i, uvs[k] if uvs else uvc) for k, i in enumerate(row)]; self.face(q[::-1] if flip else q); return
        ci = self.vert(center)
        for k in range(len(row)):
            q = [(row[k], uvc), (row[(k + 1) % len(row)], uvc), (ci, uvc)]
            self.face(q[::-1] if flip else q)
    def extend(self, other):
        base = len(self.v); self.v += other.v
        self.f += [[(i + base, uv) for i, uv in face] for face in other.f]
        return self

def loft(sections, uv=None, cap0=True, cap1=True, closed=True, tip0=None, tip1=None, flatcap=False):
    m = M(); rows = [[m.vert(p) for p in s] for s in sections]
    n = len(sections[0])
    m.grid(rows, uv or (lambda r, c: (c / n, r / max(1, len(rows) - 1))), closed)
    def capuv(sec):  # planar UVs for flat caps so textures don't smear
        c = sum(sec, Vector()) / len(sec); a = (sec[0] - c).normalized(); nn = (sec[1] - sec[0]).cross(sec[2] - sec[0]).normalized(); b = nn.cross(a)
        return [((p - c).dot(a) / .2 + .5, (p - c).dot(b) / .2 + .5) for p in sec]
    if cap0: m.cap(rows[0], tip0, flip=False, uvs=capuv(sections[0]) if flatcap and tip0 is None else None)
    if cap1: m.cap(rows[-1], tip1, flip=True, uvs=capuv(sections[-1]) if flatcap and tip1 is None else None)
    return m

def lathe(profile, segs=16, axis=Vector((0, 0, 1)), origin=Vector(), phase=0.0, ellipse=(1.0, 1.0), uvscale=(1.0, 1.0), ref=None):
    U = Vector(axis).normalized(); X = ref or (Vector((1, 0, 0)) if abs(U.x) < .9 else Vector((0, 1, 0)))
    X = (X - U * X.dot(U)).normalized(); Y = U.cross(X)
    secs = [[Vector(origin) + U * h + X * (r * ellipse[0] * math.cos(phase + TAU * k / segs)) + Y * (r * ellipse[1] * math.sin(phase + TAU * k / segs)) for k in range(segs)] for r, h in profile]
    m = M(); rows = [[m.vert(p) for p in s] for s in secs]
    m.grid(rows, lambda r, c: (c / segs * uvscale[0], profile[r][1] * uvscale[1]))
    if profile[0][0] > 1e-6: m.cap(rows[0], Vector(origin) + U * profile[0][1])
    if profile[-1][0] > 1e-6: m.cap(rows[-1], Vector(origin) + U * profile[-1][1], flip=True)
    return m

def tube(path, radius, sides=8, cap=True):
    secs = []; prev = None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        ref = prev if prev is not None else (Vector((0, 0, 1)) if abs(t.z) < .9 else Vector((1, 0, 0)))
        n = (ref - t * ref.dot(t)).normalized(); b = t.cross(n); prev = n
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        secs.append([p + n * math.cos(TAU * k / sides) * r + b * math.sin(TAU * k / sides) * r for k in range(sides)])
    L = [0.0]
    for a, b in zip(path, path[1:]): L.append(L[-1] + (b - a).length)
    return loft(secs, lambda r, c: (c / sides, L[r] / .05), cap, cap)

def chamfer(points, bevel):
    """Every corner of a closed 2D polygon becomes two points on a narrow bevel (crisp highlights on smooth shading)."""
    out = []; n = len(points)
    for i in range(n):
        p, a, b = Vector(points[i]), Vector(points[i - 1]), Vector(points[(i + 1) % n])
        out.append(p + (a - p).normalized() * min(bevel, (a - p).length * .3))
        out.append(p + (b - p).normalized() * min(bevel, (b - p).length * .3))
    return out

def box(c, half, bevel=.0012):
    """Bevelled box: an octagon-free chamfered cuboid as a loft of two chamfered rectangles (+ bevel rows)."""
    hx, hy, hz = half; c = Vector(c)
    rect = lambda s: [Vector(p) for p in chamfer([(hy * s, hz * s), (-hy * s, hz * s), (-hy * s, -hz * s), (hy * s, -hz * s)], bevel)]
    k = 1 - bevel / max(min(hy, hz), 1e-6)
    secs = []
    for x, s in ((-hx, k), (-hx + bevel, 1), (hx - bevel, 1), (hx, k)):
        secs.append([c + Vector((x, p.x, p.y)) for p in rect(s)])
    return loft(secs, flatcap=True)

# ------------------------------------------------------------------ the head
HEAD_Z = .83               # head centre (== the old model's tipPoint height)
H, D, CH = .150, .125, .052   # half height (Z), half depth (Y), corner chamfer of the octagon
FACE_X, BODY_X = .345, .300   # striking face, end of the cast body
DRIFT_X = -.392               # drift (back) face
BAND_X, BAND_W = .222, .016   # shrink bands
def octo(s_h=1.0, s_d=1.0, bevel=.0026):
    h, d, c = H * s_h, D * s_d, CH * min(s_h, s_d)
    pts = [(d, h - c), (d - c, h), (-d + c, h), (-d, h - c), (-d, -h + c), (-d + c, -h), (d - c, -h), (d, -h + c)]
    return chamfer(pts, bevel)
def ring_at(x, s_h=1.0, s_d=1.0, bevel=.0026):
    return [Vector((x, p[0], HEAD_Z + p[1])) for p in octo(s_h, s_d, bevel)]
def waist(x):  # the casting narrows a touch at the eye and swells into the faces (forged bolsters)
    return 1 - .085 * math.exp(-(x / .14) ** 2) + .03 * smooth((abs(x) - .19) / .1)

def perim_uv(secs, xs, scale=.33):
    n = len(secs[0])
    acc = []
    for s in secs:
        L = [0.0]
        for k in range(n): L.append(L[-1] + (s[(k + 1) % n] - s[k]).length)
        acc.append(L)
    return lambda r, c: (xs[r] / scale, acc[r][c] / scale)

def build_head():
    xs = [-.296 + .592 * i / 36 for i in range(37)]
    secs = [ring_at(x, waist(x), waist(x)) for x in xs]
    body = loft(secs, perim_uv(secs, xs), cap0=False, cap1=False)
    # Drift face: a tapered octagonal frustum, then a small flat face with a bevel.
    dx = [-.296, -.300, -.312, -.372, -.386, DRIFT_X]
    ds = [waist(-.296), 1.012, 1.0, .70, .69, .655]
    secs2 = [ring_at(x, s, s, .0022) for x, s in zip(dx, ds)]
    drift = loft(secs2, perim_uv(secs2, dx), cap0=False, cap1=True, flatcap=True)
    return body.extend(drift)

def build_face():
    # Front: the steel face is a cap forged onto the body: a collar step, then the broad flat face with a bevel.
    fx = [.292, .296, .300, .309, .336, .341, FACE_X]
    fs = [1.0 * waist(.292), 1.07, 1.10, 1.10, 1.085, 1.06, 1.025]
    secs = [ring_at(x, s, s, .002) for x, s in zip(fx, fs)]
    face = loft(secs, perim_uv(secs, fx), cap0=True, cap1=True, flatcap=True)
    secs_b = [ring_at(x, s, s, .002) for x, s in zip([-.306, -.302, -.296, -.290], [1.0, 1.03, 1.03, 1.0])]
    face.extend(loft(secs_b, perim_uv(secs_b, [-.306, -.302, -.296, -.290]), cap0=False, cap1=False))   # drift collar
    return face

def build_bands():
    m = M()
    for sx in (-1, 1):
        x0 = sx * BAND_X
        xs = [x0 - BAND_W, x0 - BAND_W + .002, x0 + BAND_W - .002, x0 + BAND_W]
        ss = [waist(x0) * 1.0, waist(x0) * 1.032, waist(x0) * 1.032, waist(x0) * 1.0]
        secs = [ring_at(x, s, s, .0016) for x, s in zip(xs, ss)]
        m.extend(loft(secs, perim_uv(secs, xs, .1), cap0=False, cap1=False))
    return m

def rivet(p, n, r=.0058, h=.0034, segs=8):
    return lathe([(r * 1.02, -.002), (r, 0), (r * .86, h * .7), (r * .45, h), (0, h * 1.05)], segs=segs, axis=n, origin=p)

def cheek_frame(side):
    """Point on the cheek facet (y = +-D at the head's waist) and its basis (u along X, v up)."""
    return lambda x, z, lift=0.0: Vector((x, side * (D * waist(x) + lift), HEAD_Z + z))

SUN_R = .046
STUDS = []   # (side, angle, position) of the six long-ray studs on each cheek
def build_sun(side):
    """Gold bezel, rays and studs on one cheek; returns (gold mesh, sunstone mesh)."""
    P = cheek_frame(side); n = Vector((0, side, 0))
    gold, stone = M(), M()
    base = P(0, 0)
    gold.extend(lathe([(SUN_R + .0105, -.002), (SUN_R + .0105, .0018), (SUN_R + .008, .0052), (SUN_R + .002, .0062), (SUN_R - .001, .0045)],
                      segs=24, axis=n, origin=base, phase=math.pi / 24, ref=Vector((1, 0, 0))))
    # Rose-cut sunstone: a low crown of 12 facets over a flat girdle (reads faceted; refraction at runtime).
    rings = [(SUN_R, .0035), (SUN_R * .86, .0105), (SUN_R * .52, .0172), (0, .0198)]
    for r0, r1 in zip(rings, rings[1:]):
        pass
    st = lathe([(SUN_R * 1.0, .0), (SUN_R, .0035), (SUN_R * .84, .0108), (SUN_R * .5, .0176), (0, .0205)], segs=12, axis=n, origin=base,
               phase=0.0, ref=Vector((1, 0, 0)))
    stone.extend(st)
    # Twelve rays inlaid in the facet, clipped to the facet (between the bands, inside the chamfers).
    zmax = (H - CH) * .94 - .004; xmax = BAND_X - BAND_W - .012
    for k in range(12):
        a = TAU * k / 12 + (TAU / 24 if side < 0 else 0) * 0
        d = Vector((math.cos(a), 0, math.sin(a)))
        long = k % 2 == 0
        L = .16 if long else .085
        # clip to the facet rectangle
        tmax = min(xmax / abs(d.x) if abs(d.x) > 1e-6 else 9, zmax / abs(d.z) if abs(d.z) > 1e-6 else 9)
        r0 = SUN_R + .0135; r1 = min(r0 + L, tmax)
        if r1 - r0 < .012: continue
        w0 = .0105 if long else .0072
        perp = Vector((-d.z, 0, d.x))
        steps = 6; secs = []
        for i in range(steps + 1):
            t = i / steps; r = lerp(r0, r1, t); w = w0 * (1 - t) ** .9 + .0007
            cx, cz = d.x * r, d.z * r
            secs.append([P(cx + perp.x * w, cz + perp.z * w, .0016), P(cx - perp.x * w, cz - perp.z * w, .0016),
                         P(cx - perp.x * w * .7, cz - perp.z * w * .7, -.0012), P(cx + perp.x * w * .7, cz + perp.z * w * .7, -.0012)])
        ray = loft(secs, lambda r, c: (r / steps, c / 4))
        if side < 0: ray.f = [f[::-1] for f in ray.f]
        gold.extend(ray)
        if long:  # a gold stud where each long ray ends; the readiness lamps sit on these (weapon-readiness.js)
            gold.extend(rivet(P(d.x * (r1 + .006), d.z * (r1 + .006), -.001), n, r=.0042, h=.0026, segs=8))
            STUDS.append((side, a, P(d.x * (r1 + .006), d.z * (r1 + .006), .0012)))
    return gold, stone

VENTS = [(-.150, 'Vent0'), (-.082, 'Vent1'), (.082, 'Vent2'), (.150, 'Vent3')]
def build_vents():
    """Four slots on the crown: a glowing pane set just under a raised iron frame with a cross-bar."""
    glow, frame = M(), M()
    top = lambda x: HEAD_Z + H * waist(x)
    for x, _ in VENTS:
        z = top(x); hx, hy = .016, .052
        g = box((x, 0, z + .0012), (hx + .001, hy + .001, .0018), bevel=.0006)
        glow.extend(g)
        # raised frame: four bevelled bars round the pane, and one bar across it
        t = .0052
        frame.extend(box((x, hy + t / 2, z + .003), (hx + t, t / 2, .0035)))
        frame.extend(box((x, -hy - t / 2, z + .003), (hx + t, t / 2, .0035)))
        frame.extend(box((x + hx + t / 2, 0, z + .003), (t / 2, hy, .0035)))
        frame.extend(box((x - hx - t / 2, 0, z + .003), (t / 2, hy, .0035)))
        frame.extend(box((x, 0, z + .0028), (hx, .0028, .0026)))
    return glow, frame

def build_cap():
    """Gold wedge-cap on the crown where the haft is locked in the eye: a faceted diamond plate with a sun-stamp."""
    z = HEAD_Z + H * waist(0)
    pts = [(.044, 0), (0, .036), (-.044, 0), (0, -.036)]
    secs = [[Vector((p[0] * s, p[1] * s, z + h)) for p in chamfer(pts, .003)] for s, h in ((1.0, -.002), (1.0, .004), (.82, .0085))]
    cap = loft(secs, cap0=False, cap1=True, flatcap=True)
    cap.extend(rivet(Vector((0, 0, z + .0085)), Vector((0, 0, 1)), r=.010, h=.005, segs=12))
    return cap

def build_inlay_lines():
    """Thin gold lines along the four diagonal chamfer facets, band to band: the sun's threads."""
    m = M()
    for ys, zs in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        xs = [-.196 + .392 * i / 30 for i in range(31)]
        secs = []
        for x in xs:
            s = waist(x); h, d, c = H * s, D * s, CH * s
            a = Vector((x, ys * d, HEAD_Z + zs * (h - c))); b = Vector((x, ys * (d - c), HEAD_Z + zs * h))
            mid = (a + b) / 2; along = (b - a).normalized(); nrm = Vector((0, ys, zs)).normalized()
            w = .0024
            secs.append([mid + along * w + nrm * .0010, mid - along * w + nrm * .0010, mid - along * w * .6 - nrm * .0012, mid + along * w * .6 - nrm * .0012])
        line = loft(secs, lambda r, c: (r / 30, c / 4))
        if ys * zs < 0: line.f = [f[::-1] for f in line.f]
        m.extend(line)
    return m

def band_rivets():
    m = M()
    for sx in (-1, 1):
        x = sx * BAND_X; s = waist(x) * 1.032
        for side in (-1, 1):
            for z in (-.06, .06):
                m.extend(rivet(Vector((x, side * D * s, HEAD_Z + z)), Vector((0, side, 0)), r=.0055))
        m.extend(rivet(Vector((x, 0, HEAD_Z + H * s)), Vector((0, 0, 1)), r=.0055))
        m.extend(rivet(Vector((x, 0, HEAD_Z - H * s)), Vector((0, 0, -1)), r=.0055))
    return m

# ------------------------------------------------------------------ haft, langets, grip, pommel
HAFT_TOP = HEAD_Z + H * waist(0) - .001
def haft_r(z):
    return .0300 + .0034 * smooth((z - .03) / .36) + .0052 * smooth((z - .40) / .26)
def build_haft():
    zs = [0.0, .02, .05] + [.05 + (HAFT_TOP - .05) * i / 30 for i in range(1, 31)]
    secs = []
    for z in zs:
        r = haft_r(z)
        pts = chamfer([(r * math.cos(TAU * k / 8 + TAU / 16), r * math.sin(TAU * k / 8 + TAU / 16)) for k in range(8)], .0018)
        secs.append([Vector((p[0], p[1], z)) for p in pts])
    n = len(secs[0])
    return loft(secs, lambda r, c: (c / n * .55, zs[r] * 1.3), cap0=True, cap1=True, flatcap=True)

def build_langets():
    m = M(); z0, z1 = .455, HEAD_Z - H * waist(0) + .004
    for sx in (-1, 1):
        zs = [z0 + (z1 - z0) * i / 16 for i in range(17)]
        secs = []
        for i, z in enumerate(zs):
            r = haft_r(z) * math.cos(TAU / 16) + .0002; w = .0105 * (.55 + .45 * smooth(i / 3)); t = .0042
            tipr = lerp(.6, 1.0, smooth(i / 2))
            secs.append([Vector((sx * (r + t), w * tipr, z)), Vector((sx * (r + t), -w * tipr, z)), Vector((sx * r, -w * tipr - .0012, z)), Vector((sx * r, w * tipr + .0012, z))])
        L = loft(secs, lambda r, c: (r / 16, c / 4), flatcap=True)
        if sx < 0: L.f = [f[::-1] for f in L.f]
        m.extend(L)
    return m
def langet_rivets():
    m = M()
    for sx in (-1, 1):
        for z in (.49, .55, .61):
            r = haft_r(z) * math.cos(TAU / 16) + .0044
            m.extend(rivet(Vector((sx * r, 0, z)), Vector((sx, 0, 0)), r=.0048, h=.0028))
    return m

def build_socket():
    """Steel collar where the haft enters the underside of the head: an octagonal boss with a bevelled lip."""
    zb = HEAD_Z - H * waist(0)
    prof = [(.050, zb + .003), (.050, zb - .010), (.046, zb - .016), (.041, zb - .019), (haft_r(zb - .02) + .003, zb - .021)]
    return lathe([(r, z) for r, z in prof], segs=8, phase=TAU / 16)

def build_grip():
    """Oxblood leather strip wound from .03 to .385: a spiral with a raised overlap edge, plus brass collars."""
    m = M(); z0, z1 = .032, .385; turns = 11; steps = turns * 16
    rows = []
    for i in range(steps + 1):
        t = i / steps; z = lerp(z0, z1, t); a = TAU * turns * t
        ring = []
        for k in range(16):
            b = TAU * k / 16
            phase = ((b - a) / TAU) % 1.0     # where this point sits within the strip at this height
            ridge = .0016 * math.exp(-((phase - .06) / .05) ** 2) + .0005 * math.sin(phase * TAU)
            r = haft_r(z) * 1.03 + .0022 + ridge
            ring.append(Vector((r * math.cos(b), r * math.sin(b), z)))
        rows.append(ring)
    vi = [[m.vert(p) for p in ring] for ring in rows]
    m.grid(vi, lambda r, c: (c / 16 * 4.0, r / steps * turns * .5))
    return m

def build_collars():
    m = M()
    for z, h in ((.028, .009), (.392, .011), (.44, .006)):
        r = haft_r(z) * 1.03 + .0045
        m.extend(lathe([(r - .002, z - h), (r, z - h + .0015), (r + .0012, z), (r, z + h - .0015), (r - .002, z + h)], segs=16))
    return m

def build_pommel():
    prof = [(.0, -.046), (.012, -.046), (.024, -.040), (.034, -.026), (.036, -.008), (.033, .006), (.029, .018), (haft_r(.02) + .003, .024)]
    return lathe(prof, segs=8, phase=TAU / 16)
def pommel_stone():
    return lathe([(.0125, -.0455), (.0125, -.049), (.0085, -.0535), (0, -.056)], segs=8, phase=TAU / 16)

# ------------------------------------------------------------------ assemble parts
gold_l, stone_l = build_sun(1); gold_r, stone_r = build_sun(-1)
vent_glow, vent_frame = build_vents()
PARTS = {
    'SledgeHead': build_head().extend(vent_frame),
    'StrikeFace': build_face(),
    'Bands': build_bands(),
    'SunInlay': gold_l.extend(gold_r).extend(build_cap()).extend(build_inlay_lines()).extend(band_rivets()).extend(build_collars()).extend(langet_rivets()),
    'Sunstone': stone_l.extend(stone_r).extend(pommel_stone()),
    'Vents': vent_glow,
    'Haft': build_haft(),
    'Langets': build_langets().extend(build_socket()),
    'GripWrap': build_grip(),
    'Pommel': build_pommel(),
}

# ------------------------------------------------------------------ materials
def hexc(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def lin(h): return tuple(c ** 2.2 for c in hexc(h)) + (1,)
MAT = {
    'Iron_Forged':  dict(c='4a505e', m=.85, r=.46, tex='steel', ns=.55),
    'Steel_Face':   dict(c='f4f6fa', m=.9, r=.3, tex='steel', ns=.25),
    'Gold_Inlay':   dict(c='ffc95a', m=1.0, r=.22, tex='brass', ns=.12),
    'Brass_Trim':   dict(c='e0a94a', m=1.0, r=.3, tex='brass', ns=.2),
    'Sunstone':     dict(c='ff7008', m=0.0, r=.08, e='ff8a1e', es=1.6),
    'Vent_Glow':    dict(c='ff7a1a', m=0.0, r=.6, e='ff8a2a', es=2.2),
    'Wood_Ash':     dict(c='9a7a5c', m=0.0, r=.6, tex='wood', ns=.7),
    'Leather_Wrap': dict(c='8a3a34', m=0.0, r=.74, tex='leather', ns=.9),
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
    if 'e' in d:
        b.inputs['Emission Color'].default_value = lin(d['e']); b.inputs['Emission Strength'].default_value = d['es']
    if 'tex' in d:
        ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = image(f"{d['tex']}_color.jpg")
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
        nt.links.new(ti.outputs['Color'], mul.inputs[6]); mul.inputs[7].default_value = lin(d['c'])
        nt.links.new(mul.outputs[2], b.inputs['Base Color'])
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = image(f"{d['tex']}_normal.jpg"); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = d['ns']
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    MATS[name] = m; return m
OBJ_MAT = {'SledgeHead': 'Iron_Forged', 'StrikeFace': 'Steel_Face', 'Bands': 'Steel_Face', 'SunInlay': 'Gold_Inlay', 'Sunstone': 'Sunstone',
           'Vents': 'Vent_Glow', 'Haft': 'Wood_Ash', 'Langets': 'Steel_Face', 'GripWrap': 'Leather_Wrap', 'Pommel': 'Brass_Trim'}
FLAT = {'Sunstone'}
SHARP = {'SledgeHead': 30, 'StrikeFace': 30, 'Bands': 30, 'SunInlay': 40, 'Haft': 30, 'Langets': 35, 'GripWrap': 80, 'Pommel': 30, 'Vents': 80}

# ------------------------------------------------------------------ to Blender
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
ROOT = bpy.data.objects.new('SunfallSledge', None); SC.collection.objects.link(ROOT)
def to_object(name, m, mat, parent=ROOT, sharp=32, flat=False):
    bm = bmesh.new(); verts = [bm.verts.new(p) for p in m.v]; uvl = bm.loops.layers.uv.new('UVMap')
    for face in m.f:
        idx = [i for i, _ in face]
        if len(set(idx)) < 3: continue
        try: f = bm.faces.new([verts[i] for i in idx])
        except ValueError: continue
        for loop, (_, uv) in zip(f.loops, face): loop[uvl].uv = uv
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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
for name, m in PARTS.items():
    to_object(name, m, OBJ_MAT[name], sharp=SHARP.get(name, 32), flat=name in FLAT)
up = Vector((0, 0, 1))
empty('Grip', Vector((0, 0, .205)))
empty('Heart', Vector((0, 0, HEAD_Z)))
empty('HitCentre', Vector((FACE_X, 0, HEAD_Z)))
empty('FaceFront', Vector((FACE_X, 0, HEAD_Z)), rot=up.rotation_difference(Vector((1, 0, 0))))
empty('SunLeft', Vector((0, D * waist(0) + .02, HEAD_Z)), rot=up.rotation_difference(Vector((0, 1, 0))))
empty('SunRight', Vector((0, -D * waist(0) - .02, HEAD_Z)), rot=up.rotation_difference(Vector((0, -1, 0))))
# SunStud0..11: the long-ray studs, lit clockwise from the top as the slam recharges (+Z of each = out of the cheek).
# Index = side (left 0..5, right 6..11) x step; step 0 is the top ray, then clockwise as seen from that cheek.
for si, side in enumerate((1, -1)):
    studs = sorted([s for s in STUDS if s[0] == side], key=lambda s: ((math.pi / 2 - s[1]) * (1 if side > 0 else -1)) % TAU)
    for k, (_, a, pos) in enumerate(studs):
        empty(f'SunStud{si * 6 + k}', pos, rot=up.rotation_difference(Vector((0, side, 0))))
for x, name in VENTS: empty(name, Vector((x, 0, HEAD_Z + H * waist(x) + .002)))

# ------------------------------------------------------------------ checks + export
bpy.context.view_layer.update()
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
meshes = [o for o in SC.objects if o.type == 'MESH']
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
REPORT = {'triangles': sum(tris(o) for o in meshes), 'per_mesh': {o.name: tris(o) for o in meshes},
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi]}
assert REPORT['triangles'] < 24000, REPORT['triangles']
for n in ('SunStud0', 'SunStud11', 'Grip', 'Heart', 'HitCentre', 'FaceFront', 'SunLeft', 'SunRight', 'Vent0', 'Vent3', *PARTS):
    assert n in bpy.data.objects, n
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                          export_normals=True, export_texcoords=True, export_extras=False, export_image_format='AUTO')
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ------------------------------------------------------------------ review renders (Cycles, for judging the model)
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    SC.cycles.use_denoising = True; SC.cycles.max_bounces = 8
    SC.view_settings.view_transform = 'AgX'; SC.view_settings.look = 'AgX - Medium High Contrast'
    sb = MATS['Sunstone'].node_tree.nodes['Principled BSDF']
    sb.inputs['Transmission Weight'].default_value = .6; sb.inputs['IOR'].default_value = 1.54; sb.inputs['Coat Weight'].default_value = 1.0
    sb.inputs['Emission Strength'].default_value = float(arg('--glow', .5))
    MATS['Vent_Glow'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = float(arg('--vent', .8))
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.06, .07, .09, 1); bg.inputs[1].default_value = 1.0
    def light(loc, e, s=.5, col=(1, 1, 1), at=(0, 0, .7)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((1.6, -1.8, 1.9), 420, col=(1, .9, .76)); light((-1.8, .5, 1.2), 200, col=(.55, .72, 1.0)); light((0, 1.8, 2.0), 220, s=1.2); light((.3, -.5, -.6), 50, col=(1, .85, .6))
    heart = bpy.data.lights.new('heart', 'POINT'); heart.energy = float(arg('--heart', 2.0)); heart.color = (1.0, .6, .25); heart.shadow_soft_size = .02
    ho = bpy.data.objects.new('heart', heart); ho.location = (0, 0, HEAD_Z + .2); SC.collection.objects.link(ho)
    floor = bpy.data.meshes.new('floor'); bmf = bmesh.new(); bmesh.ops.create_grid(bmf, x_segments=1, y_segments=1, size=4); bmf.to_mesh(floor); bmf.free()
    fo = bpy.data.objects.new('floor', floor); fo.location = (0, 0, -.06); SC.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.035, .038, .045, 1)
    floor.materials.append(fm)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {
        'hero':    ((1.55, -2.0, 1.25), (0, 0, .62), 42, (1100, 1400)),
        'head':    ((.55, -.95, 1.12), (0, 0, .83), 50, (1600, 1100)),
        'cheek':   ((0.02, -.70, .86), (0, 0, .83), 50, (1600, 1100)),
        'face':    ((.95, -.25, .95), (.2, 0, .83), 50, (1400, 1100)),
        'crown':   ((.25, -.45, 1.35), (0, 0, .9), 50, (1600, 1100)),
        'grip':    ((.32, -.55, .30), (0, 0, .25), 50, (1000, 1200)),
    }
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens, res) in views.items():
        SC.render.resolution_x, SC.render.resolution_y = res; SC.render.resolution_percentage = 50
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
        print('rendered', name, round(time.time() - T0, 1))
