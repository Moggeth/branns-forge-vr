"""Asset generators. Every builder returns a finished Blender object; origin conventions are in HANDOFF.md.
Local +Z is 'outward/front' for edge pieces and 'entrance' for buildings. Wind blows toward +X."""
import math
from mathutils import Vector
from skl_core import *

SKY = dict(stone=hx('ebdfc4'), stone2=hx('cdb8a0'), deep=hx('9b93a6'), tip=hx('7f8299'), soil=hx('6a4c34'), turf=hx('b7dc7c'),
           foliage=[hx('e3f2d6'), hx('cfe8c6'), hx('f3f8e2')], bloom=[hx('f6b9c8'), hx('ffffff'), hx('f5d27a'), hx('c9b6f2')])
CLD = dict(stone=hx('c8d0d0'), stone2=hx('9eabb2'), deep=hx('6b7b89'), tip=hx('4d5b6b'), soil=hx('5b5548'), turf=hx('9dbb88'),
           foliage=[hx('cfddd2'), hx('b8cbc0'), hx('e2ece3')], bloom=[hx('ffffff'), hx('d8ecf5'), hx('f5d27a')])
TEAL = hx('3aa6a4'); TEAL_D = hx('2a7f86'); GOLD = hx('e3b657'); TIMBER = hx('c9a072'); TIMBER_D = hx('7a5a3c')
PALE = hx('f2ecdd')
WIND = Vector((1, 0, 0.12)).normalized()


def hn(*vals):
    h = 0
    for v in vals:
        h = (h * 1000003 + int(round(v * 977))) & 0xffffffff
    return (h % 100000) / 100000.0


# ---------------------------------------------------------------- island undersides
def add_underside(a, W, D, depth, style, N=64, rounded=False, spur_count=0, spur_amp=0.0, K=9, margin=0.45, jag=0.12):
    P = SKY if style == 'sky' else CLD
    rng = a.rng
    hw, hd = W / 2, D / 2
    harm = [(h, rng.random() * 6.28, 1.0 / h ** 0.8) for h in (2, 3, 5, 7, 11)]
    sp_ph = rng.random() * 6.28
    step = [rng.uniform(-1, 1) for _ in range(K + 2)]

    def nz(th, k, amp):
        return amp * sum(w * math.sin(h * th + ph + k * 0.9) for h, ph, w in harm) / 2.2

    def rect(th):
        c, s = math.cos(th), math.sin(th)
        kx = hw / abs(c) if abs(c) > 1e-6 else 1e9
        kz = hd / abs(s) if abs(s) > 1e-6 else 1e9
        k = min(kx, kz)
        return Vector((c * k, s * k))

    def ell(th):
        return Vector((hw * math.cos(th), hd * math.sin(th)))

    angs = [2 * math.pi * i / N for i in range(N)]
    dirs = [Vector((math.cos(t), math.sin(t))) for t in angs]
    base = [ell(t) * (1.0 if rounded else 1.0) if rounded else rect(t) for t in angs]
    # top lip rings
    marg = [margin + 0.28 * abs(nz(t, 0, 1.0)) + rng.uniform(0, 0.12) for t in angs]
    def P3(xz, y): return Vector((xz.x, y, xz.y))
    R_in = [P3(base[i] - dirs[i] * 0.3, -0.03) for i in range(N)]
    R0 = [P3(base[i] + dirs[i] * marg[i], 0.035) for i in range(N)]
    R1 = [P3(base[i] + dirs[i] * (marg[i] + 0.06 + rng.uniform(0, 0.1)), -0.28) for i in range(N)]
    R2 = [P3(base[i] + dirs[i] * (marg[i] - 0.06), -0.7 - rng.uniform(0, 0.15)) for i in range(N)]
    def ring_col(c): return lambda p: c
    turf_c = lambda p: mix(P['turf'], mul(P['turf'], 0.8), hn(p.x, p.z) * 0.6)
    soil_c = lambda p: mix(P['soil'], mul(P['soil'], 1.25), hn(p.x, p.y, p.z))
    def band(f, seed=0):
        return lambda p: f(p)
    def loop_strip(A, B, m, col, smooth=False):
        for i in range(N):
            j = (i + 1) % N
            pts = [A[i], A[j], B[j], B[i]]
            a.face(m, pts, col, smooth, out=sum(pts, Vector()) / 4 - Vector((0, sum(v.y for v in pts) / 4 - 0.2, 0)) if False else None)
    # helper to add outward wall quad (A above B) using the angle-increasing convention
    def wall(A, B, m, col, smooth=False):
        for i in range(N):
            j = (i + 1) % N
            pts = [A[i], A[j], B[j], B[i]]
            cen = sum(pts, Vector()) / 4
            a.face(m, pts, col, smooth, out=Vector((cen.x, 0, cen.z)))
    # top annulus (up-facing turf)
    for i in range(N):
        j = (i + 1) % N
        a.face('turf', [R_in[i], R_in[j], R0[j], R0[i]], turf_c, out=(0, 1, 0))
    wall(R0, R1, 'turf', turf_c)
    wall(R1, R2, 'cliff', soil_c)
    # rock rings
    rings = [R2]
    y_start = -0.7
    for k in range(1, K + 1):
        t = k / K
        fr = (1 - t ** 1.35) ** 0.8
        y = y_start - (depth - 0.7) * (1 - (1 - t) ** 1.5)
        cur = []
        for i in range(N):
            th = angs[i]
            b = 0.0 if not rounded else 0.0
            bl = min(1.0, t * 1.6) ** 1.2
            pt = (base[i] + dirs[i] * (marg[i] - 0.2)) * (1 - bl) + ell(th) * 0.96 * bl
            if rounded:
                pt = ell(th) * 0.96 + dirs[i] * (marg[i] - 0.2)
            amp = 0.05 + jag * 1.6 * t
            rf = fr * (1 + nz(th, k, amp) + 0.08 * step[k] + (rng.random() - 0.5) * jag * t)
            yy = y
            if spur_count:
                sp = max(0.0, math.sin(spur_count * th + sp_ph)) ** 3
                rf *= (1 - 0.35 * sp * t)
                yy -= depth * spur_amp * sp * t ** 1.5
            yy += (rng.random() - 0.5) * 0.25 * t
            cur.append(P3(pt * rf, yy))
        rings.append(cur)
    def rock_col(p):
        tt = min(1.0, max(0.0, -p.y / depth))
        c = mix(P['stone'], P['stone2'], min(1.0, tt * 2.2)) if tt < 0.45 else mix(P['stone2'], P['deep'], min(1.0, (tt - 0.45) * 2.4))
        if style == 'cloud':
            c = mul(c, 1.0 + 0.09 * (1 if int(-p.y * 2.3) % 2 else -1))
        return mul(c, 0.94 + 0.12 * hn(p.x * 3, p.y * 3, p.z * 3))
    for k in range(len(rings) - 1):
        wall(rings[k], rings[k + 1], 'cliff', rock_col)
    tip = Vector((rng.uniform(-0.5, 0.5), -depth - 0.3, rng.uniform(-0.5, 0.5)))
    last = rings[-1]
    for i in range(N):
        j = (i + 1) % N
        pts = [last[i], last[j], tip]
        cen = sum(pts, Vector()) / 3
        a.face('cliff', pts, lambda p: mix(P['deep'], P['tip'], 0.6), out=Vector((cen.x, 0, cen.z)) + Vector((0, -0.3, 0)))
    return rings


def island_under(name, W, D, depth, style, N=64, spur_count=0, spur_amp=0.0, jag=0.12):
    a = Asset(name)
    add_underside(a, W, D, depth, style, N=N, spur_count=spur_count, spur_amp=spur_amp, jag=jag)
    return a.finish()


def hanging_crag(name, style, h=6.0, r=2.0, tilt=0.0):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    n = 9; K = 7
    rings = []
    for k in range(K + 1):
        t = k / K
        rr = r * (1 - t ** 1.2) ** 0.85 + 0.03
        y = -h * t
        ph = rng.random() * 6
        rings.append([Vector((math.cos(2 * math.pi * i / n + ph) * rr * (1 + rng.uniform(-0.28, 0.28)) + tilt * t * h,
                              y + rng.uniform(-0.15, 0.15) * (k > 0), math.sin(2 * math.pi * i / n + ph) * rr * (1 + rng.uniform(-0.28, 0.28)))) for i in range(n)])
    def col(p):
        t = min(1, max(0, -p.y / h))
        c = mix(P['stone'], P['stone2'], min(1, t * 2)) if t < .5 else mix(P['stone2'], P['deep'], (t - .5) * 2)
        return mul(c, 0.94 + 0.12 * hn(p.x * 3, p.y * 3, p.z * 3))
    a.loft('cliff', rings, col, False, True, True)
    if rng.random() > 0.5:
        for i in range(3):
            with a.at((rng.uniform(-r, r) * 0.6, -h * rng.uniform(0.25, 0.5), rng.uniform(-r, r) * 0.6)):
                a.lump('cliff', (0, 0, 0), (0.5, 0.35, 0.45), lambda p: mix(P['stone2'], P['deep'], 0.4), jit=0.3)
    return a.finish()


def rim_rock(name, style, size=1.0, variant=0):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    stone = lambda p: mul(mix(P['stone'], P['stone2'], hn(p.x * 4, p.z * 4)), 0.92 + 0.15 * p.y / max(size, .1))
    a.lump('cliff', (0, 0.42 * size, 0), (0.95 * size, 0.62 * size, 0.8 * size), stone, jit=0.22, sub=1, squash_bottom=-0.0)
    if variant != 1:
        a.lump('cliff', (0.75 * size, 0.28 * size, 0.35 * size), (0.5 * size, 0.38 * size, 0.45 * size), stone, jit=0.22, sub=1, squash_bottom=0)
    if variant == 2:
        a.lump('cliff', (-0.6 * size, 0.55 * size, -0.2 * size), (0.42 * size, 0.7 * size, 0.4 * size), stone, jit=0.25, sub=1, squash_bottom=0)
    # turf cap
    a.lump('turf', (0.05 * size, 0.82 * size, 0), (0.7 * size, 0.2 * size, 0.6 * size), lambda p: P['turf'], jit=0.15, sub=1, squash_bottom=0.72 * size)
    for i in range(4 + variant * 2):
        ang = rng.random() * 6.28; rr = rng.uniform(0.15, 0.6) * size
        base = Vector((math.cos(ang) * rr, 0.86 * size, math.sin(ang) * rr * 0.8))
        a.blade('leaf', base, base + Vector((0.16 * size, 0.42 * size, 0.05)), 0.06 * size, lambda p: mix(P['turf'], hx('e8f5c8'), 0.4))
    return a.finish()


# ---------------------------------------------------------------- vegetation
def add_tree(a, style, h, lean, pos=(0, 0, 0), yaw=0.0, canopy=1.0, seed=0, blossoms=False):
    P = SKY if style == 'sky' else CLD
    rng = a.rng
    with a.at(pos, yaw):
        n = 9
        pts = []; rad = []
        r0 = 0.11 * h / 3.0 + 0.06
        ph = rng.random() * 6
        for i in range(n + 1):
            t = i / n
            off = lean * h * t ** 1.8
            pts.append(Vector((WIND.x * off + 0.1 * h * math.sin(t * 4 + ph) * 0.3, h * t * (1 - 0.1 * lean * t), WIND.z * off + 0.12 * h * math.sin(t * 3 + ph) * t)))
            rad.append(r0 * (1 - t) ** 0.75 + 0.03)
        pts.insert(0, Vector((0, -0.12, 0))); rad.insert(0, r0 * 1.7)
        bark = lambda p: mix(hx('cfc7b6'), hx('e8e2d2'), min(1, max(0, p.y / h))) if p.y > 0.3 else hx('8d8069')
        a.tube('timber', pts, rad, 7, bark, smooth=True, cap_b=True)
        for k in range(3):
            ang = 6.28 * k / 3 + ph
            d = Vector((math.cos(ang), 0, math.sin(ang)))
            a.tube('timber', [Vector((0, 0.25, 0)) + d * 0.05, d * r0 * 2.2 + Vector((0, 0.05, 0)), d * r0 * 4 + Vector((0, -0.08, 0))],
                   [r0 * 0.75, r0 * 0.5, r0 * 0.12], 5, lambda p: hx('8d8069'), smooth=True, cap_b=True)
        tips = [pts[-1]]
        for k in range(3):
            t = 0.55 + 0.14 * k
            base = pts[int(t * n)]
            d = WIND * (0.55 + 0.25 * k) * (1.0 if style == 'cloud' else 0.7) + Vector((0, 0.5 + 0.2 * (k % 2), (k - 1) * 0.5))
            d.normalize()
            L = h * (0.22 + 0.06 * k)
            tip = base + d * L
            mid = base + d * L * 0.5 + Vector((0, 0.15, 0))
            a.tube('timber', [base, mid, tip], [0.05 * h / 3 + .02, 0.035 * h / 3 + .01, 0.012], 5, bark, smooth=True, cap_b=True)
            tips.append(tip)
        cs = canopy * h * 0.27
        cols = P['foliage']
        for ti, tp in enumerate(tips):
            for j in range(2):
                off = Vector((rng.uniform(-.3, .3), rng.uniform(-.1, .35), rng.uniform(-.3, .3))) * cs
                if style == 'cloud':
                    rad3 = (cs * 1.45, cs * 0.6, cs * 0.95)
                    off += WIND * cs * 0.5
                else:
                    rad3 = (cs * 1.15, cs * 0.78, cs * 1.05)
                cc = tp + off + Vector((0, cs * 0.3, 0))
                c0 = cols[(ti + j) % 3]
                a.lump('leaf', cc, rad3, (lambda cc_, rr_, c_: (lambda p: mix(mul(c_, 0.78), mul(c_, 1.08), min(1, max(0, (p.y - (cc_.y - rr_)) / (2 * rr_)))))) (cc, rad3[1], c0),
                       jit=0.18, sub=1, smooth=False)
                if blossoms and j == 0:
                    for q in range(3):
                        ang = rng.random() * 6.28
                        bp = cc + Vector((math.cos(ang) * rad3[0] * 0.8, rng.uniform(0, 1) * rad3[1] * 0.9, math.sin(ang) * rad3[2] * 0.8))
                        a.bloom(bp, 0.13 * canopy, P['bloom'][(q + ti) % len(P['bloom'])], facing=(bp - cc + Vector((0, 0.5, 0))))
        if style == 'cloud':
            for k in range(3):
                base = pts[-1] + Vector((0, -0.2 * k, 0))
                a.tube('timber', [base, base + WIND * (0.8 + 0.3 * k) + Vector((0, 0.15, 0.2 * (k - 1))), base + WIND * (1.5 + 0.3 * k)], [0.04, 0.03, 0.01], 4, bark, cap_b=True)


def tree(name, style, h, lean, canopy=1.0, blossoms=False):
    a = Asset(name)
    add_tree(a, style, h, lean, canopy=canopy, blossoms=blossoms)
    return a.finish()


def shrub_bloom(name, style, r=0.7, flowers=True, variant=0):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    for i in range(4 + variant):
        ang = 6.28 * i / (4 + variant) + rng.random()
        rr = r * (0.35 if i else 0)
        c = Vector((math.cos(ang) * rr, r * 0.45, math.sin(ang) * rr))
        col = P['foliage'][i % 3]
        a.lump('leaf', c, (r * 0.62, r * 0.5, r * 0.6), (lambda c_: lambda p: mix(mul(c_, 0.72), mul(c_, 1.05), min(1, max(0, p.y / (r * 0.95)))))(col),
               jit=0.2, sub=1, squash_bottom=0.0)
    if flowers:
        for i in range(9 + variant * 3):
            ang = rng.random() * 6.28; el = rng.uniform(0.25, 1.15)
            p = Vector((math.cos(ang) * math.cos(el) * r * 0.9, 0.35 * r + math.sin(el) * r * 0.62, math.sin(ang) * math.cos(el) * r * 0.9))
            a.bloom(p, 0.11 * r + 0.03, P['bloom'][rng.randrange(len(P['bloom']))], facing=Vector((p.x, p.y - 0.2, p.z)))
    return a.finish()


def flower_bed(name, style, L=3.2, Wd=1.2):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    n = 14
    outline = [(math.cos(2 * math.pi * i / n) * L / 2 * (1 + 0.06 * math.sin(i * 2.1)), math.sin(2 * math.pi * i / n) * Wd / 2) for i in range(n)]
    a.slab_poly('ashlar', outline, 0.0, 0.16, lambda p: mul(PALE, 0.96))
    inner = [(x * 0.86, z * 0.78) for x, z in outline]
    a.slab_poly('cliff', inner, 0.1, 0.19, lambda p: P['soil'])
    for i in range(24):
        x = rng.uniform(-L * 0.4, L * 0.4); z = rng.uniform(-Wd * 0.3, Wd * 0.3)
        hgt = rng.uniform(0.25, 0.7)
        a.tube('leaf', [(x, 0.15, z), (x + rng.uniform(-.05, .05), 0.15 + hgt * .5, z), (x + rng.uniform(-.1, .1), 0.15 + hgt, z)], [0.014, 0.011, 0.008], 3, lambda p: hx('7fb069'), cap_b=True)
        a.bloom((x, 0.17 + hgt, z), rng.uniform(0.09, 0.15), P['bloom'][rng.randrange(len(P['bloom']))], facing=(rng.uniform(-.3, .3), 1, rng.uniform(-.3, .3)))
    for i in range(6):
        a.lump('leaf', (rng.uniform(-L * .4, L * .4), 0.2, rng.uniform(-Wd * .3, Wd * .3)), (0.22, 0.14, 0.2), lambda p: hx('8fc478'), jit=0.2, squash_bottom=0.12)
    return a.finish()


def turf_patch(name, style, R=2.5, variant=0):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    n = 18
    ph = rng.random() * 6
    def outline(f):
        return [(math.cos(2 * math.pi * i / n) * R * f * (1 + 0.18 * math.sin(3 * (2 * math.pi * i / n) + ph) + 0.1 * math.sin(5 * (2 * math.pi * i / n))),
                 math.sin(2 * math.pi * i / n) * R * f * 0.8 * (1 + 0.18 * math.sin(3 * (2 * math.pi * i / n) + ph + 1) + 0.1 * math.cos(4 * (2 * math.pi * i / n)))) for i in range(n)]
    o1 = outline(1.0); o2 = outline(0.68); o3 = outline(0.32)
    rings = [[Vector((x, 0.012, z)) for x, z in o1], [Vector((x, 0.045, z)) for x, z in o2], [Vector((x, 0.07, z)) for x, z in o3]]
    base = P['turf']
    tints = [mul(base, 0.85), mul(base, 1.0), mul(base, 1.12)]
    for k in range(2):
        for i in range(n):
            j = (i + 1) % n
            pts = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            a.face('turf', pts, mix(tints[k], tints[k + 1], 0.5), out=(0, 1, 0))
    for i in range(n):
        j = (i + 1) % n
        a.face('turf', [rings[2][i], rings[2][j], Vector((0, 0.08, 0))], tints[2], out=(0, 1, 0))
    for i in range(int(R * 10)):
        ang = rng.random() * 6.28; rr = math.sqrt(rng.random()) * R * 0.8
        b = Vector((math.cos(ang) * rr, 0.07, math.sin(ang) * rr * 0.75))
        hgt = rng.uniform(0.18, 0.4)
        lean = WIND * (0.08 if style == 'sky' else 0.22) * hgt * 2
        a.blade('leaf', b, b + Vector((0, hgt, 0)) + lean, 0.05, lambda p: mix(hx('7fb85a'), hx('e2f2a8'), rng.random()))
    for i in range(int(R * 3)):
        ang = rng.random() * 6.28; rr = math.sqrt(rng.random()) * R * 0.75
        p = Vector((math.cos(ang) * rr, 0.13, math.sin(ang) * rr * 0.75))
        a.bloom(p, rng.uniform(0.06, 0.1), P['bloom'][rng.randrange(len(P['bloom']))], facing=(0, 1, 0.1))
    return a.finish()


def root_cascade(name, style, strands=6, span=2.4, drop=(2.5, 5.5), flowers=True, wind=0.0):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    a.lump('cliff', (0, -0.05, 0.05), (span * 0.55, 0.28, 0.45), lambda p: mix(P['soil'], mul(P['soil'], 1.3), hn(p.x * 4, p.z * 4)), jit=0.25, sub=1)
    for s_ in range(strands):
        x0 = -span / 2 + span * (s_ + rng.uniform(-0.2, 0.2)) / max(1, strands - 1)
        L = rng.uniform(*drop)
        n = 6
        pts = []; rad = []
        sw = rng.uniform(0.15, 0.5) * (1 if rng.random() > .5 else -1)
        for i in range(n + 1):
            t = i / n
            pts.append(Vector((x0 + sw * math.sin(t * 3 + s_) * t + wind * L * t ** 1.6, -0.15 - L * t, 0.1 + 0.45 * math.sin(t * 2.2) + 0.15 * t)))
            rad.append(0.075 * (1 - t) ** 0.8 + 0.008)
        a.tube('timber', pts, rad, 4, lambda p: mix(hx('6a5642'), hx('8b7355'), hn(p.x * 5, p.y * 5)), smooth=True, cap_b=True)
        for i in range(2, n + 1, 2):
            p = pts[i]
            a.lump('leaf', p + Vector((0.04, 0.02, 0.08)), (0.16, 0.1, 0.13), lambda q: mix(hx('87b97c'), hx('c5e29a'), hn(q.x * 6, q.y * 6)), jit=0.25, sub=0)
            if flowers and (i + s_) % 2 == 0:
                a.bloom(p + Vector((0.05, -0.02, 0.15)), rng.uniform(0.09, 0.16), P['bloom'][rng.randrange(len(P['bloom']))], facing=(0.1, -0.2, 1), droop=0.5)
    return a.finish()


def meadow_patch(name, style, R=1.6, tall=False):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    for i in range(int(R * 22)):
        ang = rng.random() * 6.28; rr = math.sqrt(rng.random()) * R
        b = Vector((math.cos(ang) * rr, 0.0, math.sin(ang) * rr))
        hgt = rng.uniform(0.25, 0.7 if tall else 0.5)
        lean = WIND * hgt * (0.22 if style == 'sky' else 0.55) + Vector((rng.uniform(-.06, .06), 0, rng.uniform(-.06, .06)))
        a.blade('leaf', b, b + Vector((0, hgt, 0)) + lean, 0.06, lambda p: mix(hx('6fb056'), hx('dff0a4'), min(1, p.y / 0.5)), bend=Vector((0, 0.02, 0)))
    for i in range(int(R * 5)):
        ang = rng.random() * 6.28; rr = math.sqrt(rng.random()) * R * 0.95
        h = rng.uniform(0.3, 0.75)
        b = Vector((math.cos(ang) * rr, 0.0, math.sin(ang) * rr))
        a.tube('leaf', [b, b + Vector((0.02, h * .5, 0)), b + Vector((0.05, h, 0.02))], [0.012, 0.01, 0.008], 3, lambda p: hx('79ad5c'), cap_b=True)
        a.bloom(b + Vector((0.05, h + 0.02, 0.02)), rng.uniform(0.08, 0.13), P['bloom'][rng.randrange(len(P['bloom']))], facing=(0, 1, 0.1))
    return a.finish()


def bell_flower(name, style, h=1.4):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    a.tube('leaf', [(0, 0, 0), (0.06, h * .5, 0), (0.2, h * .9, 0.05)], [0.03, 0.02, 0.015], 5, lambda p: hx('6fae60'), cap_b=True)
    for i, (bx, by) in enumerate([(0.2, h * .95), (0.05, h * .62), (0.1, h * .78)]):
        c = P['bloom'][i % len(P['bloom'])]
        a.column('petal', (bx, 0.02 * i), by - 0.2, by, 0.02, 0.15, 7, c, caps=(False, False), smooth=True)
        a.lump('glow' if False else 'petal', (bx, by - 0.2, 0.02 * i), 0.03, GOLD, jit=0)
    for i in range(3):
        ang = 2.09 * i
        a.blade('leaf', (0, 0, 0), (math.cos(ang) * 0.5, 0.35, math.sin(ang) * 0.5), 0.1, lambda p: hx('79b463'))
    return a.finish()


def crystal_cluster(name, h=1.6):
    a = Asset(name); rng = a.rng
    for i in range(6):
        ang = 6.28 * i / 6 + rng.random() * .4; rr = 0.0 if i == 0 else rng.uniform(0.2, 0.45)
        hh = h * (1.0 if i == 0 else rng.uniform(0.4, 0.75)); r = 0.14 * (1.0 if i == 0 else rng.uniform(0.6, 0.9))
        bx, bz = math.cos(ang) * rr, math.sin(ang) * rr
        lean = Vector((rng.uniform(-.25, .25), 0, rng.uniform(-.25, .25))) if i else Vector()
        base = Vector((bx, 0, bz))
        rings = [a.ring((bx, bz), r, 0, 6), [p + Vector((lean.x * hh * .6, hh * .75, lean.z * hh * .6)) for p in a.ring((bx, bz), r * 0.95, 0, 6)],
                 [Vector((bx + lean.x * hh, hh, bz + lean.z * hh))] * 6]
        a.loft('glow', rings, lambda p: mix(hx('7fe0d2'), hx('d8fbf5'), min(1, p.y / h)), False, True, False)
    a.lump('cliff', (0, 0.05, 0), (0.55, 0.16, 0.5), lambda p: hx('aab6bd'), jit=0.2, squash_bottom=0.0)
    return a.finish()


# ---------------------------------------------------------------- waterfall
def sky_falls(name, w=1.8, L=13.0):
    a = Asset(name); rng = a.rng
    n = 16
    for k in range(n):
        t0 = k / n; t1 = (k + 1) / n
        def pos(t):
            return Vector((math.sin(t * 5) * 0.08, -L * t ** 1.05 - 0.05 * 0, 0.25 + 0.0 * t + 0.55 * t))
        p0, p1 = pos(t0), pos(t1)
        w0 = w * (0.85 + 0.35 * t0); w1 = w * (0.85 + 0.35 * t1)
        c = lambda p: mix(hx('c8f1f0'), hx('ffffff'), hn(p.y * 2, p.x)) if True else None
        a.face('water', [p0 + Vector((-w0 / 2, 0, 0)), p0 + Vector((w0 / 2, 0, 0)), p1 + Vector((w1 / 2, 0, 0)), p1 + Vector((-w1 / 2, 0, 0))], c, out=(0, 0, 1), double=True)
    a.lump('leaf', (0, 0.02, 0.05), (w * 0.62, 0.15, 0.3), lambda p: hx('bfe6d8'), jit=0.15, squash_bottom=-0.05)
    for i in range(7):
        ang = 6.28 * i / 7
        a.lump('cloud', (math.cos(ang) * w * 0.7, -L * 0.98 + rng.uniform(-0.2, 0.3), 0.8 + 0.9 * math.sin(ang)), (0.9, 0.55, 0.8), lambda p: mix(hx('e8f4f7'), hx('ffffff'), hn(p.x * 3, p.z * 3)), jit=0.15, sub=1, smooth=True)
    return a.finish()


# ---------------------------------------------------------------- structures
def roof_hip(a, m, cx, cy, cz, hx_, hz, H, lift, rx=1.0, rz=1.0, nx=10, nz=8, col=None, thick=0.14, eave_col=None, under_col=None):
    col = col or hx('e0f3ee')
    def h(x, z):
        u = abs(x) / hx_; v = abs(z) / hz
        hh = min((1 - u) / rx, (1 - v) / rz, 1.0)
        hh = max(hh, 0)
        return cy + H * hh ** 1.15 + lift * (u ** 3) * (v ** 3)
    xs = [-hx_ + 2 * hx_ * i / nx for i in range(nx + 1)]
    zs = [-hz + 2 * hz * j / nz for j in range(nz + 1)]
    for i in range(nx):
        for j in range(nz):
            q = [Vector((cx + xs[i], h(xs[i], zs[j]), cz + zs[j])), Vector((cx + xs[i + 1], h(xs[i + 1], zs[j]), cz + zs[j])),
                 Vector((cx + xs[i + 1], h(xs[i + 1], zs[j + 1]), cz + zs[j + 1])), Vector((cx + xs[i], h(xs[i], zs[j + 1]), cz + zs[j + 1]))]
            a.face(m, q, col, out=(0, 1, 0.0) if False else (q[0] + q[2]) / 2 * 0 + Vector((0, 1, 0)))
    for i in range(nx):
        for j in range(nz):
            if 0 < i < nx - 1 and 0 < j < nz - 1:
                continue
            q = [Vector((cx + xs[i], h(xs[i], zs[j]) - thick, cz + zs[j])), Vector((cx + xs[i + 1], h(xs[i + 1], zs[j]) - thick, cz + zs[j])),
                 Vector((cx + xs[i + 1], h(xs[i + 1], zs[j + 1]) - thick, cz + zs[j + 1])), Vector((cx + xs[i], h(xs[i], zs[j + 1]) - thick, cz + zs[j + 1]))]
            a.face('timber', q, under_col or TIMBER_D, out=(0, -1, 0))
    # eave fascia (gold trim) around the perimeter
    per = []
    for i in range(nx): per.append((xs[i], -hz))
    for j in range(nz): per.append((hx_, zs[j]))
    for i in range(nx, 0, -1): per.append((xs[i], hz))
    for j in range(nz, 0, -1): per.append((-hx_, zs[j]))
    for k in range(len(per)):
        x0, z0 = per[k]; x1, z1 = per[(k + 1) % len(per)]
        q = [Vector((cx + x0, h(x0, z0), cz + z0)), Vector((cx + x1, h(x1, z1), cz + z1)), Vector((cx + x1, h(x1, z1) - thick, cz + z1)), Vector((cx + x0, h(x0, z0) - thick, cz + z0))]
        a.face('gold', q, hx('e8c26a'), out=Vector((x0 + x1, 0, z0 + z1)))
    return h


def finial(a, pos, hgt=0.7, r=0.09):
    x, y, z = pos
    a.column('gold', (x, z), y, y + 0.12, r * 1.8, r * 1.3, 8, hx('f0c96a'))
    a.lump('gold', (x, y + 0.28, z), r * 1.5, hx('f5d37a'), jit=0.0, sub=1, smooth=True)
    a.column('gold', (x, z), y + 0.3, y + hgt, r * 0.7, 0.005, 6, hx('f0c96a'))


def grapple_post(name, style):
    a = Asset(name); P = SKY if style == 'sky' else CLD
    if style == 'sky':
        H = 4.3; armY = 4.0; ax = 1.8; ay = 3.5
        a.column('ashlar', (0, 0), 0, 0.55, 0.42, 0.34, 8, lambda p: PALE)
        a.column('ashlar', (0, 0), 0.55, 0.62, 0.42, 0.42, 8, lambda p: hx('e8c26a'), caps=(False, True))
        a.box('timber', (0, H / 2 + 0.3, 0), (0.26, H - 0.3, 0.26), lambda p: TIMBER, taper=0.86)
        for yy in (1.2, 2.6):
            a.box('gold', (0, yy, 0), (0.32, 0.07, 0.32), hx('e8c26a'))
        a.box('timber', (ax / 2 - 0.05, armY, 0), (ax + 0.35, 0.2, 0.18), lambda p: TIMBER, taper=1.0)
        a.tube('timber', [(0, 3.1, 0), (0.5, 3.55, 0), (1.0, armY - 0.1, 0)], [0.07, 0.065, 0.06], 5, lambda p: TIMBER_D)
        a.lump('gold', (ax + 0.18, armY, 0), (0.16, 0.13, 0.13), hx('f0c96a'), jit=0.0, sub=1, smooth=True)
        a.lump('glow', (0.0, H + 0.42, 0), 0.14, hx('bff'), jit=0.0, sub=1, smooth=True)
        a.tube('gold', [(ax, armY - 0.05, 0), (ax, ay + 0.3, 0)], [0.012, 0.012], 4, hx('e8c26a'), cap_b=True)
    else:
        H = 5.2; armY = 5.0; ax = 1.55; ay = 4.5
        a.column('ashlar', (0, 0), 0, 0.5, 0.55, 0.46, 8, lambda p: mix(CLD['stone'], PALE, 0.4))
        a.column('ashlar', (0, 0), 0.5, H, 0.36, 0.26, 8, lambda p: mix(CLD['stone'], PALE, 0.5), caps=(False, True))
        for yy in (1.4, 3.0, 4.6):
            a.column('gold', (0, 0), yy, yy + 0.09, 0.4 if yy < 2 else 0.33, 0.4 if yy < 2 else 0.33, 8, hx('e8c26a'), caps=(False, False))
        a.box('timber', (ax / 2 - 0.05, armY, 0), (ax + 0.6, 0.2, 0.2), lambda p: TIMBER_D)
        a.tube('timber', [(0.2, 4.1, 0), (0.7, 4.55, 0), (1.1, armY - 0.1, 0)], [0.07, 0.065, 0.06], 5, lambda p: TIMBER_D)
        a.lump('gold', (ax + 0.2, armY, 0), (0.16, 0.13, 0.13), hx('f0c96a'), jit=0, sub=1, smooth=True)
        a.tube('gold', [(ax, armY - 0.05, 0), (ax, ay + 0.3, 0)], [0.012, 0.012], 4, hx('e8c26a'), cap_b=True)
        # streaming teal pennant, wind-bent toward +X
        pts = [Vector((0.0, H - 0.1, 0.0)), Vector((0.5, H - 0.08, 0.02)), Vector((1.0, H - 0.22, 0.05)), Vector((1.5, H - 0.4, 0.1))]
        for i in range(3):
            w0 = 0.34 * (1 - i / 3.0); w1 = 0.34 * (1 - (i + 1) / 3.0)
            q = [pts[i] + Vector((0, w0 / 2, 0)), pts[i + 1] + Vector((0, w1 / 2, 0)), pts[i + 1] - Vector((0, w1 / 2, 0)), pts[i] - Vector((0, w0 / 2, 0))]
            a.face('cloth', q, TEAL_D if i % 2 else TEAL, double=True, out=(0, 0, 1))
        a.lump('gold', (0, H + 0.1, 0), 0.13, hx('f0c96a'), jit=0.0, sub=1, smooth=True)
    # ring: vertical torus in the XY plane, ring centre = anchor point
    ring_pts = 14
    for k in range(ring_pts):
        th0 = 2 * math.pi * k / ring_pts; th1 = 2 * math.pi * (k + 1) / ring_pts
        c0 = Vector((ax + 0.3 * math.cos(th0), ay + 0.3 * math.sin(th0), 0)); c1 = Vector((ax + 0.3 * math.cos(th1), ay + 0.3 * math.sin(th1), 0))
        r0 = [c0 + Vector((math.cos(th0), math.sin(th0), 0)) * 0.05 * math.cos(q) + Vector((0, 0, 0.05 * math.sin(q))) for q in [2 * math.pi * i / 5 for i in range(5)]]
        r1 = [c1 + Vector((math.cos(th1), math.sin(th1), 0)) * 0.05 * math.cos(q) + Vector((0, 0, 0.05 * math.sin(q))) for q in [2 * math.pi * i / 5 for i in range(5)]]
        a.loft('gold', [r0, r1], hx('f0c96a'), True, False, False)
    return a.finish()


def windmill_tower(name):
    a = Asset(name)
    stone = lambda p: mix(PALE, hx('e3d5b8'), hn(p.x * 2, p.y * 2))
    a.column('ashlar', (0, 0), 0, 0.55, 1.62, 1.5, 12, lambda p: mix(SKY['stone2'], PALE, 0.6), caps=(True, False))
    a.column('ashlar', (0, 0), 0.55, 6.2, 1.5, 1.0, 12, stone, caps=(False, True), smooth=False)
    for yy in (1.5, 3.4, 5.4):
        r = 1.5 - (yy - 0.55) / 5.65 * 0.5 + 0.03
        a.column('timber', (0, 0), yy, yy + 0.16, r, r, 12, lambda p: TIMBER_D, caps=(False, False))
    # cap: teal shingled cone with sweeping eave
    rings = [a.ring((0, 0), 1.32, 6.15, 12), a.ring((0, 0), 1.22, 6.3, 12), a.ring((0, 0), 0.75, 7.4, 12), a.ring((0, 0), 0.32, 8.4, 12), a.ring((0, 0), 0.03, 8.75, 12)]
    a.loft('roof', rings, lambda p: hx('e0f3ee'), False, False, False)
    a.loft('gold', [a.ring((0, 0), 1.33, 6.1, 12), a.ring((0, 0), 1.33, 6.2, 12)], hx('e8c26a'), False, False, False)
    finial(a, (0, 8.7, 0), 0.9, 0.08)
    # door with arch at +Z, gold frame
    a.box('timber', (0, 0.95, 1.5), (1.0, 1.9, 0.22), lambda p: TIMBER_D)
    for sx in (-1, 1):
        a.box('gold', (sx * 0.55, 1.0, 1.52), (0.09, 2.0, 0.16), hx('e8c26a'))
    a.box('gold', (0, 2.05, 1.52), (1.2, 0.09, 0.16), hx('e8c26a'))
    # windows / slits
    for ang, yy in ((60, 3.2), (-60, 3.2), (120, 3.9), (-120, 3.9), (180, 2.4), (0, 2.4)):
        with a.at((0, yy, 0), ang):
            a.box('timber', (0, 0, 1.42 - 0.13 * (yy - 2.4) / 3), (0.36, 0.7, 0.14), lambda p: hx('2a7f86'))
            a.box('gold', (0, -0.38, 1.42 - 0.13 * (yy - 2.4) / 3), (0.5, 0.06, 0.2), hx('e8c26a'))
    # axle mount: hub sits at (0, 4.8, 1.55)
    a.box('timber', (0, 4.8, 1.2), (0.5, 0.5, 0.45), lambda p: TIMBER_D)
    a.column('gold', (0, 1.45), 4.55, 4.75, 0.2, 0.2, 8, hx('e8c26a'), rot=0)
    with a.at((0, 4.8, 1.3), 0, 1, 90, 0):
        a.column('timber', (0, 0), 0, 0.5, 0.1, 0.1, 8, lambda p: TIMBER_D)
    # base flower boxes
    for ang in (35, -35, 150, -150, 210):
        with a.at((0, 0, 0), ang):
            a.box('timber', (0, 0.3, 1.78), (1.0, 0.36, 0.3), lambda p: TIMBER_D)
            for i in range(4):
                a.bloom((-0.35 + i * 0.23, 0.6, 1.8), 0.13, SKY['bloom'][i % 4], facing=(0, 1, 0.3))
    return a.finish()


def windmill_rotor(name):
    a = Asset(name)
    a.column('gold', (0, 0), -0.08, 0.28, 0.2, 0.16, 10, hx('e8c26a'), rot=0)
    with a.at((0, 0, 0), 0, 1, 90, 0):
        a.column('gold', (0, 0), -0.1, 0.3, 0.2, 0.15, 10, hx('e8c26a'))
    a.lump('gold', (0, 0, 0.32), 0.2, hx('f0c96a'), jit=0, sub=1, smooth=True)
    for i in range(4):
        with a.at((0, 0, 0), 0, 1, 0, 90 * i + 22):
            a.box('timber', (1.75, 0, 0), (3.3, 0.14, 0.1), lambda p: TIMBER_D)
            a.box('timber', (1.75, -0.32, -0.02), (3.0, 0.06, 0.06), lambda p: TIMBER)
            a.box('timber', (1.75, 0.32, -0.02), (3.0, 0.06, 0.06), lambda p: TIMBER)
            for j in range(6):
                a.box('timber', (0.7 + j * 0.5, 0, -0.02), (0.05, 0.7, 0.05), lambda p: TIMBER)
            for j in range(5):
                x0 = 0.95 + j * 0.5
                c = SKY['bloom'][1] if j % 2 == 0 else TEAL
                q = [Vector((x0, -0.32, 0.03)), Vector((x0 + 0.46, -0.32, 0.03)), Vector((x0 + 0.46, 0.32, 0.03)), Vector((x0, 0.32, 0.03))]
                a.face('cloth', q, c, double=True, out=(0, 0, 1))
    return a.finish()


def garden_arch(name, style='sky'):
    a = Asset(name); P = SKY
    for sx in (-1, 1):
        a.column('ashlar', (sx * 1.55, 0), 0, 0.28, 0.34, 0.28, 8, lambda p: PALE, caps=(True, False))
        a.column('ashlar', (sx * 1.55, 0), 0.28, 2.15, 0.25, 0.22, 8, lambda p: PALE, caps=(False, True))
        a.column('gold', (sx * 1.55, 0), 2.1, 2.22, 0.29, 0.29, 8, hx('e8c26a'), caps=(True, True))
    n = 14
    pts = [Vector((1.55 * math.cos(math.pi * i / n), 2.2 + 1.35 * math.sin(math.pi * i / n) * 0.95, 0)) for i in range(n + 1)]
    a.tube('timber', pts, [0.09] * (n + 1), 6, lambda p: TIMBER, smooth=True, cap_a=True, cap_b=True)
    a.tube('gold', [Vector((1.55 * math.cos(math.pi * i / n), 2.2 + 1.35 * math.sin(math.pi * i / n) * 0.95 + 0.0, 0.1)) for i in range(n + 1)], [0.018] * (n + 1), 4, hx('e8c26a'), cap_b=True)
    a.lump('glow', (0, 3.5, 0.0), 0.15, hx('bff'), jit=0, sub=1, smooth=True)
    a.lump('gold', (0, 3.72, 0.0), 0.09, hx('f0c96a'), jit=0, sub=1, smooth=True)
    for i in range(1, n):
        p = pts[i]
        a.lump('leaf', p + Vector((0, 0, 0.05 * (i % 2))), (0.2, 0.13, 0.17), lambda q: mix(hx('7fb85a'), hx('cfe8a4'), hn(q.x * 5, q.y * 5)), jit=0.25, sub=1)
        if i % 2 == 0:
            a.bloom(p + Vector((0.02, 0.05, 0.2)), 0.16, P['bloom'][(i // 2) % 4], facing=(0, 0.3, 1))
    for sx in (-1, 1):
        for k in range(4):
            a.lump('leaf', (sx * 1.6, 0.5 + k * 0.45, 0.12), (0.17, 0.2, 0.17), lambda q: mix(hx('7fb85a'), hx('cfe8a4'), hn(q.x * 5, q.y * 5)), jit=0.25, sub=1)
            a.bloom((sx * 1.62, 0.62 + k * 0.45, 0.28), 0.13, P['bloom'][(k + (sx > 0)) % 4], facing=(0, 0.2, 1))
    return a.finish()


def balustrade_span(name, style):
    a = Asset(name); P = SKY if style == 'sky' else CLD
    col = lambda p: mix(PALE, P['stone'], 0.3)
    a.box('ashlar', (0, 0.12, 0), (0.36, 0.24, 2.9), col)
    a.box('ashlar', (0, 0.98, 0), (0.3, 0.14, 2.95), col)
    a.box('gold', (0, 1.07, 0), (0.12, 0.03, 2.95), hx('e8c26a'))
    for i in range(7):
        z = -1.2 + i * 0.4
        a.column('ashlar', (0, z), 0.24, 0.98, 0.09, 0.075, 8, col, caps=(False, False), smooth=True)
        a.lump('ashlar', (0, 0.6, z), (0.11, 0.13, 0.11), col, jit=0.0, sub=1, smooth=True)
    return a.finish()


def pillar_lantern(name, style):
    a = Asset(name); P = SKY if style == 'sky' else CLD
    col = lambda p: mix(PALE, P['stone'], 0.3 if style == 'sky' else 0.55)
    a.column('ashlar', (0, 0), 0, 0.3, 0.32, 0.26, 8, col, caps=(True, False))
    a.column('ashlar', (0, 0), 0.3, 1.45, 0.24, 0.2, 8, col, caps=(False, False))
    a.column('gold', (0, 0), 1.4, 1.52, 0.29, 0.29, 8, hx('e8c26a'))
    a.lump('glow', (0, 1.78, 0), (0.2, 0.26, 0.2), hx('cffcf3'), jit=0, sub=1, smooth=True)
    for k in range(4):
        ang = k * math.pi / 2 + math.pi / 4
        a.tube('gold', [(math.cos(ang) * 0.2, 1.52, math.sin(ang) * 0.2), (math.cos(ang) * 0.2, 2.05, math.sin(ang) * 0.2)], [0.014, 0.014], 4, hx('e8c26a'), cap_b=True)
    a.column('roof', (0, 0), 2.03, 2.16, 0.32, 0.03, 8, lambda p: hx('e0f3ee'), caps=(True, False))
    a.lump('gold', (0, 2.19, 0), 0.05, hx('f0c96a'), jit=0, sub=1, smooth=True)
    return a.finish()


def gazebo(name):
    a = Asset(name)
    a.column('ashlar', (0, 0), 0, 0.22, 2.7, 2.6, 16, lambda p: mix(PALE, hx('dccaa8'), 0.3), caps=(True, True))
    a.column('ashlar', (0, 0), 0.22, 0.4, 2.4, 2.3, 16, lambda p: PALE, caps=(False, True))
    n = 8
    for i in range(n):
        ang = 2 * math.pi * (i + 0.5) / n
        x, z = math.cos(ang) * 2.0, math.sin(ang) * 2.0
        a.column('ashlar', (x, z), 0.4, 0.62, 0.22, 0.2, 8, lambda p: PALE, caps=(False, True))
        a.column('timber', (x, z), 0.62, 2.85, 0.13, 0.11, 8, lambda p: TIMBER, caps=(False, True), smooth=True)
        a.column('gold', (x, z), 2.6, 2.7, 0.17, 0.17, 8, hx('e8c26a'))
        # swag rail
        ang2 = 2 * math.pi * (i + 1.5) / n
        x2, z2 = math.cos(ang2) * 2.0, math.sin(ang2) * 2.0
        if i not in (2, 3):
            a.tube('timber', [Vector((x, 1.0, z)), Vector(((x + x2) / 2, 0.98, (z + z2) / 2)), Vector((x2, 1.0, z2))], [0.04] * 3, 5, lambda p: TIMBER_D, cap_b=True)
    rings = [a.ring((0, 0), 2.85, 2.82, 16), a.ring((0, 0), 2.7, 2.95, 16), a.ring((0, 0), 2.0, 3.35, 16), a.ring((0, 0), 1.15, 3.95, 16),
             a.ring((0, 0), 0.5, 4.5, 16), a.ring((0, 0), 0.04, 4.8, 16)]
    a.loft('roof', rings, lambda p: hx('e6f7f2'), False, False, False)
    a.loft('gold', [a.ring((0, 0), 2.86, 2.76, 16), a.ring((0, 0), 2.86, 2.86, 16)], hx('e8c26a'), False, False, False)
    finial(a, (0, 4.75, 0), 0.95, 0.09)
    a.lump('glow', (0, 2.55, 0), 0.2, hx('cffcf3'), jit=0, sub=1, smooth=True)
    # bench + hanging blooms
    for i in (2, 3):
        ang = 2 * math.pi * (i + 1.0) / n
        a.box('timber', (math.cos(ang) * 1.75, 0.6, math.sin(ang) * 1.75), (1.4, 0.12, 0.42), lambda p: TIMBER)
    for i in range(n):
        ang = 2 * math.pi * (i + 0.5) / n
        p = Vector((math.cos(ang) * 2.02, 2.15, math.sin(ang) * 2.02))
        a.lump('leaf', p, (0.22, 0.28, 0.22), lambda q: mix(hx('7fb85a'), hx('cfe8a4'), hn(q.x * 5, q.y * 5)), jit=0.25, sub=1)
        a.bloom(p + Vector((0, 0.05, 0)) + Vector((math.cos(ang), 0, math.sin(ang))) * 0.15, 0.15, SKY['bloom'][i % 4], facing=(math.cos(ang), 0.4, math.sin(ang)))
    return a.finish()


def spring_pool(name):
    a = Asset(name); rng = a.rng
    n = 20
    outer = a.ring((0, 0), 1.75, 0.22, n)
    a.loft('ashlar', [a.ring((0, 0), 1.8, 0.0, n), outer], lambda p: PALE, False, False, False)
    a.loft('ashlar', [outer, a.ring((0, 0), 1.5, 0.24, n)], lambda p: PALE, False, False, False)
    a.loft('gold', [a.ring((0, 0), 1.52, 0.245, n), a.ring((0, 0), 1.48, 0.245, n)], hx('e8c26a'), False, False, False)
    for i in range(n):
        j = (i + 1) % n
        a.face('water', [Vector((0, 0.13, 0)), a.ring((0, 0), 1.5, 0.13, n)[i], a.ring((0, 0), 1.5, 0.13, n)[j]], hx('9ee0dc'), out=(0, 1, 0))
    for i in range(3):
        ang = rng.random() * 6.28
        a.lump('leaf', (math.cos(ang) * 0.8, 0.15, math.sin(ang) * 0.8), (0.28, 0.02, 0.28), lambda p: hx('8fc478'), jit=0.1, sub=1)
        a.bloom((math.cos(ang) * 0.8, 0.19, math.sin(ang) * 0.8), 0.13, SKY['bloom'][i % 4], facing=(0, 1, 0))
    # spring stone with spout toward +Z (the falls hang off the island edge in that direction)
    a.lump('cliff', (0, 0.6, -1.7), (1.0, 0.75, 0.7), lambda p: mix(SKY['stone'], SKY['stone2'], hn(p.x * 3, p.y * 3)), jit=0.2, sub=1, squash_bottom=0)
    a.lump('turf', (0, 1.28, -1.7), (0.72, 0.16, 0.5), lambda p: SKY['turf'], jit=0.15, sub=1, squash_bottom=1.2)
    a.tube('gold', [(0, 0.85, -1.15), (0, 0.85, -0.85), (0, 0.65, -0.55)], [0.07, 0.06, 0.05], 6, hx('e8c26a'), cap_b=True)
    a.tube('water', [(0, 0.65, -0.55), (0, 0.4, -0.35), (0, 0.2, -0.2)], [0.05, 0.04, 0.05], 5, hx('c8f1f0'), cap_b=False)
    return a.finish()


def path_slab(name, style, variant=0):
    a = Asset(name); rng = a.rng; P = SKY if style == 'sky' else CLD
    n = 9
    sx, sz = (0.75, 0.55) if variant == 0 else (0.6, 0.6)
    pts = [(math.cos(2 * math.pi * i / n) * sx * rng.uniform(0.9, 1.05), math.sin(2 * math.pi * i / n) * sz * rng.uniform(0.9, 1.05)) for i in range(n)]
    a.slab_poly('ashlar', pts, 0.0, 0.07, lambda p: mix(PALE, P['stone'], 0.35 + 0.3 * hn(p.x * 5, p.z * 5)))
    a.lump('glow' if variant == 1 and style == 'cloud' else 'gold', (0, 0.07, 0), (0.09, 0.02, 0.09), hx('e8c26a'), jit=0.0, sub=1)
    return a.finish()


def waymark(name, style):
    a = Asset(name); P = SKY if style == 'sky' else CLD
    col = lambda p: mix(PALE, P['stone'], 0.3 if style == 'sky' else 0.5)
    a.column('ashlar', (0, 0), 0, 0.2, 0.42, 0.36, 8, col, caps=(True, False))
    a.column('ashlar', (0, 0), 0.2, 0.95, 0.3, 0.22, 8, col, caps=(False, True))
    a.column('gold', (0, 0), 0.9, 0.98, 0.26, 0.26, 8, hx('e8c26a'))
    a.lump('glow', (0, 1.25, 0), 0.19, hx('cffcf3'), jit=0, sub=1, smooth=True)
    for k in range(3):
        ang = 2.09 * k
        a.tube('gold', [(math.cos(ang) * 0.18, 0.98, math.sin(ang) * 0.18), (math.cos(ang) * 0.24, 1.25, math.sin(ang) * 0.24), (0, 1.5, 0)], [0.012] * 3, 4, hx('e8c26a'), cap_b=True)
    return a.finish()


def wind_banner_pole(name, h=4.2):
    a = Asset(name)
    a.column('ashlar', (0, 0), 0, 0.45, 0.38, 0.3, 8, lambda p: mix(CLD['stone'], PALE, 0.4), caps=(True, False))
    a.column('timber', (0, 0), 0.45, h, 0.09, 0.06, 6, lambda p: TIMBER_D, caps=(False, True), smooth=True)
    a.box('timber', (0.45, h - 0.35, 0), (0.9, 0.05, 0.05), lambda p: TIMBER_D)
    a.lump('gold', (0, h + 0.08, 0), 0.1, hx('f0c96a'), jit=0, sub=1, smooth=True)
    pts = [Vector((0.02, h - 0.35, 0)), Vector((0.55, h - 0.38, 0.05)), Vector((1.2, h - 0.5, 0.12)), Vector((1.85, h - 0.68, 0.16)), Vector((2.5, h - 0.98, 0.14))]
    for i in range(4):
        w0 = 0.6 * (1 - i / 4.4); w1 = 0.6 * (1 - (i + 1) / 4.4)
        q = [pts[i] + Vector((0, w0, 0)), pts[i + 1] + Vector((0, w1, 0)), pts[i + 1] - Vector((0, w1 * 0.4, 0)), pts[i] - Vector((0, w0 * 0.4, 0))]
        a.face('cloth', q, TEAL if i % 2 == 0 else mix(TEAL, hx('e8f6f2'), 0.35), double=True, out=(0, 0, 1))
    for k in range(3):
        a.box('gold', (0, 0.9 + k * 1.05, 0), (0.15, 0.06, 0.15), hx('e8c26a'))
    return a.finish()


def cairn(name):
    a = Asset(name); rng = a.rng
    y = 0.0
    for i in range(6):
        r = 0.5 * (1 - i * 0.13)
        a.lump('cliff', (rng.uniform(-.05, .05), y + r * 0.35, rng.uniform(-.05, .05)), (r, r * 0.38, r * 0.9), lambda p: mix(CLD['stone'], CLD['stone2'], hn(p.x * 5, p.y * 5, p.z * 5)), jit=0.12, sub=1, squash_bottom=y)
        y += r * 0.55
    a.lump('gold', (0, y + 0.06, 0), 0.08, hx('f0c96a'), jit=0, sub=1, smooth=True)
    return a.finish()


def watch_shelter(name, hall=False):
    a = Asset(name)
    hxw, hzd = (3.8, 1.8) if hall else (2.3, 1.8)
    stone = lambda p: mix(CLD['stone'], PALE, 0.35 + 0.3 * hn(p.x * 3, p.y * 3, p.z * 3))
    a.box('ashlar', (0, 0.17, 0), (hxw * 2 + 0.3, 0.34, hzd * 2 + 0.3), stone)
    a.box('ashlar', (0, 0.37, 0), (hxw * 2 + 0.05, 0.08, hzd * 2 + 0.05), lambda p: PALE)
    py = 0.4
    post_x = [-hxw + 0.15 + i * (2 * hxw - 0.3) / (4 if hall else 2) for i in range(5 if hall else 3)]
    H = 3.3 if not hall else 3.6
    for x in post_x:
        for z in (-hzd + 0.2, hzd - 0.2):
            a.column('timber', (x, z), py, py + H, 0.14, 0.12, 8, lambda p: TIMBER_D, caps=(True, True), smooth=True)
            a.column('gold', (x, z), py + H - 0.28, py + H - 0.2, 0.17, 0.17, 8, hx('e8c26a'))
    # windbreak walls (back and windward side), open above and in front
    wallh = 1.25
    a.box('ashlar', (0, py + wallh / 2, -hzd + 0.2), (2 * hxw - 0.3, wallh, 0.28), stone)
    for sx in (-1,):
        a.box('ashlar', (sx * (hxw - 0.15), py + wallh / 2, 0), (0.28, wallh, 2 * hzd - 0.3), stone)
    # crenel blocks along the wall top
    n = 8 if hall else 5
    for i in range(n):
        a.box('ashlar', (-hxw + 0.5 + i * (2 * hxw - 1.0) / (n - 1), py + wallh + 0.14, -hzd + 0.2), (0.42, 0.28, 0.32), lambda p: PALE)
    a.box('gold', (0, py + wallh + 0.3, -hzd + 0.2), (2 * hxw - 0.4, 0.05, 0.36), hx('e8c26a'))
    # beam frame under the roof
    for z in (-hzd + 0.2, hzd - 0.2):
        a.box('timber', (0, py + H - 0.05, z), (2 * hxw, 0.16, 0.2), lambda p: TIMBER_D)
    for x in post_x:
        a.box('timber', (x, py + H - 0.05, 0), (0.16, 0.16, 2 * hzd), lambda p: TIMBER_D)
    roof_hip(a, 'roof', 0, py + H, 0, hxw + 0.7, hzd + 0.7, 1.5 if not hall else 1.7, 0.45, rx=0.55 if hall else 1.0, rz=1.0)
    finial(a, (0, py + H + (1.5 if not hall else 1.7), 0), 0.9)
    if hall:
        finial(a, (-2.1, py + H + 0.55, 0), 0.6)
        finial(a, (2.1, py + H + 0.55, 0), 0.6)
    # interior: bench, lantern, banner cloth streaming from the eave
    a.box('timber', (0.3, py + 0.35, -hzd + 0.6), (2.0 if not hall else 3.5, 0.12, 0.42), lambda p: TIMBER)
    a.lump('glow', (0, py + H - 0.6, 0.3), (0.16, 0.22, 0.16), hx('cffcf3'), jit=0, sub=1, smooth=True)
    a.tube('gold', [(0, py + H - 0.2, 0.3), (0, py + H - 0.42, 0.3)], [0.012, 0.012], 4, hx('e8c26a'), cap_b=True)
    x0 = hxw + 0.6
    pts = [Vector((x0, py + H + 0.1, hzd * 0.6)), Vector((x0 + 0.7, py + H + 0.05, hzd * 0.6 + 0.1)), Vector((x0 + 1.4, py + H - 0.15, hzd * 0.6 + 0.2)), Vector((x0 + 2.1, py + H - 0.45, hzd * 0.6 + 0.2))]
    for i in range(3):
        w0 = 0.45 * (1 - i / 3.3); w1 = 0.45 * (1 - (i + 1) / 3.3)
        q = [pts[i] + Vector((0, w0, 0)), pts[i + 1] + Vector((0, w1, 0)), pts[i + 1] - Vector((0, w1, 0)), pts[i] - Vector((0, w0, 0))]
        a.face('cloth', q, TEAL_D if i % 2 else TEAL, double=True, out=(0, 0, 1))
    a.tube('timber', [(x0, py + 0.2, hzd * 0.6), (x0, py + H + 0.35, hzd * 0.6)], [0.05, 0.03], 6, lambda p: TIMBER_D, cap_b=True)
    if hall:
        with a.at((-2.6, py + H + 0.9, -0.6)):
            a.column('ashlar', (0, 0), 0, 1.0, 0.32, 0.26, 8, stone, caps=(True, True))
            a.column('ashlar', (0, 0), 1.0, 1.1, 0.4, 0.36, 8, lambda p: PALE, caps=(False, True))
        for i in range(3):
            a.lump('cloud', (-2.6 + i * 0.3, py + H + 2.3 + i * 0.5, -0.6 - i * 0.05), (0.35 + i * 0.1, 0.25, 0.3 + i * 0.08), lambda p: mix(hx('e8f0f4'), hx('ffffff'), hn(p.x * 3, p.y * 3)), jit=0.15, sub=1, smooth=True)
    # crate + stacked wood for lived-in look
    a.box('timber', (hxw - 0.55, py + 0.28, -hzd + 0.5), (0.55, 0.5, 0.5), lambda p: TIMBER)
    a.box('timber', (hxw - 1.05, py + 0.2, -hzd + 0.45), (0.45, 0.36, 0.42), lambda p: TIMBER)
    return a.finish()


def keep_wall(name):
    a = Asset(name)
    stone = lambda p: mix(CLD['stone'], PALE, 0.35 + 0.3 * hn(p.x * 3, p.y * 3, p.z * 3))
    a.box('ashlar', (0, 0.72, 0), (0.55, 1.44, 2.95), stone, taper=0.92)
    a.box('gold', (0, 1.47, 0), (0.62, 0.06, 3.0), hx('e8c26a'))
    for i in range(3):
        a.box('ashlar', (0, 1.72, -1.0 + i * 1.0), (0.5, 0.5, 0.55), lambda p: PALE)
    a.box('roof', (0, 1.31, 0), (0.6, 0.08, 2.9), lambda p: hx('e0f3ee'))
    return a.finish()


def keep_tower(name):
    a = Asset(name)
    stone = lambda p: mix(CLD['stone'], PALE, 0.35 + 0.3 * hn(p.x * 3, p.y * 3, p.z * 3))
    a.column('ashlar', (0, 0), 0, 0.6, 1.9, 1.75, 12, stone, caps=(True, False))
    a.column('ashlar', (0, 0), 0.6, 5.0, 1.75, 1.45, 12, stone, caps=(False, False))
    a.column('gold', (0, 0), 4.9, 5.0, 1.68, 1.68, 12, hx('e8c26a'), caps=(False, False))
    a.column('ashlar', (0, 0), 5.0, 5.35, 1.75, 1.75, 12, lambda p: PALE, caps=(False, True))
    for i in range(6):
        ang = 2 * math.pi * i / 6 + 0.2
        a.box('ashlar', (math.cos(ang) * 1.65, 5.55, math.sin(ang) * 1.65), (0.5, 0.38, 0.5), lambda p: PALE)
    rings = [a.ring((0, 0), 1.35, 5.3, 12), a.ring((0, 0), 1.2, 5.55, 12), a.ring((0, 0), 0.6, 7.0, 12), a.ring((0, 0), 0.03, 8.1, 12)]
    a.loft('roof', rings, lambda p: hx('e0f3ee'), False, False, False)
    finial(a, (0, 8.05, 0), 1.0, 0.08)
    for ang, yy in ((0, 3.0), (90, 3.0), (180, 3.0), (-90, 3.0), (45, 4.2), (-135, 4.2)):
        with a.at((0, yy, 0), ang):
            a.box('timber', (0, 0, 1.6), (0.28, 0.9, 0.16), lambda p: hx('2a7f86'))
            a.box('gold', (0, -0.5, 1.6), (0.42, 0.06, 0.2), hx('e8c26a'))
    a.lump('glow', (0, 4.2, 1.7), 0.16, hx('cffcf3'), jit=0, sub=1, smooth=True)
    return a.finish()


def islet(name, style, R=5.0, depth=8.0, spurs=True, tree_h=3.4, waterfall=False):
    a = Asset(name); P = SKY if style == 'sky' else CLD; rng = a.rng
    add_underside(a, 2 * R, 2 * R * 0.85, depth, style, N=28, rounded=True, K=6, margin=0.15, spur_count=5 if spurs else 0, spur_amp=0.18 if spurs else 0.0, jag=0.14 if style == 'cloud' else 0.1)
    n = 22
    rings = []
    ph = rng.random() * 6
    for k, (f, y) in enumerate([(1.0, 0.03), (0.86, 0.22), (0.62, 0.42), (0.32, 0.58), (0.001, 0.66)]):
        rings.append([Vector((math.cos(2 * math.pi * i / n) * R * f * (1 + 0.08 * math.sin(3 * 2 * math.pi * i / n + ph)),
                              y + (0.08 * math.sin(2 * math.pi * i * 2 / n + ph) * f), math.sin(2 * math.pi * i / n) * R * 0.85 * f * (1 + 0.08 * math.sin(3 * 2 * math.pi * i / n + ph + 1)))) for i in range(n)])
    a.loft('turf', rings, lambda p: mix(P['turf'], mul(P['turf'], 1.15), hn(p.x * 2, p.z * 2)), False, False, False)
    add_tree(a, style, tree_h, 0.28 if style == 'cloud' else 0.12, pos=(R * 0.15, 0.5, -R * 0.1), yaw=rng.uniform(0, 360), canopy=0.95, blossoms=(style == 'sky'))
    for i in range(4 if style == 'sky' else 3):
        ang = rng.random() * 6.28; rr = rng.uniform(0.4, 0.8) * R
        p = Vector((math.cos(ang) * rr, 0.42, math.sin(ang) * rr * .8))
        if style == 'sky':
            for j in range(4):
                c = p + Vector((rng.uniform(-.3, .3), 0.05, rng.uniform(-.3, .3)))
                a.bloom(c + Vector((0, 0.3, 0)), 0.11, P['bloom'][rng.randrange(4)], facing=(0, 1, 0))
        else:
            a.lump('cliff', p, (0.5, 0.35, 0.45), lambda q: mix(P['stone'], P['stone2'], hn(q.x * 4, q.z * 4)), jit=0.22, sub=1, squash_bottom=0.3)
    if style == 'sky':
        for i in range(6):
            ang = 6.28 * i / 6 + rng.random() * 0.5
            with a.at((math.cos(ang) * R * 0.95, -0.25, math.sin(ang) * R * 0.8 * 0.95), math.degrees(math.atan2(math.cos(ang), math.sin(ang))) + 0):
                pass
        with a.at((R * 0.1, -0.25, R * 0.85 * 0.95), 0):
            for s_ in range(4):
                x0 = -0.9 + s_ * 0.6
                pts = [Vector((x0 + 0.1 * math.sin(t * 3 + s_), -0.2 - 3.5 * t, 0.15 + 0.3 * math.sin(t * 2.2))) for t in [i / 7 for i in range(8)]]
                a.tube('timber', pts, [0.05 * (1 - t) + 0.008 for t in [i / 7 for i in range(8)]], 4, lambda p: hx('7b6249'), cap_b=True)
                for q in (3, 5, 7):
                    a.bloom(pts[q] + Vector((0.03, 0, 0.1)), 0.12, P['bloom'][(q + s_) % 4], facing=(0, -0.2, 1), droop=0.5)
    if waterfall:
        with a.at((-R * 0.35, -0.02, R * 0.85 * 0.98)):
            for t in range(7):
                y0 = -t * 1.3; y1 = -(t + 1) * 1.3
                a.face('water', [Vector((-0.35, y0, 0.15 + 0.06 * t)), Vector((0.35, y0, 0.15 + 0.06 * t)), Vector((0.42, y1, 0.21 + 0.06 * t)), Vector((-0.42, y1, 0.21 + 0.06 * t))],
                       lambda p: mix(hx('c8f1f0'), hx('ffffff'), hn(p.y * 3)), out=(0, 0, 1), double=True)
    return a.finish()


def cloud_bank(name, size=14.0, puffs=9):
    a = Asset(name); rng = a.rng
    for i in range(puffs):
        ang = rng.random() * 6.28; rr = math.sqrt(rng.random()) * size * 0.35
        r = size * rng.uniform(0.14, 0.24) * (1.15 - rr / size)
        c = Vector((math.cos(ang) * rr, rng.uniform(-0.1, 0.2) * size * 0.2, math.sin(ang) * rr * 0.8))
        a.lump('cloud', c, (r * 1.2, r * 0.62, r), lambda p: mix(hx('c4d4e2'), hx('ffffff'), min(1, max(0, (p.y + 1.5) / 3.0))), jit=0.12, sub=2, smooth=True, squash_bottom=-r * 0.35)
    return a.finish()
