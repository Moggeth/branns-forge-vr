"""Procedural clutter geometry (NumPy) -> merged meshes with atlas UVs. Units: metres, +Y up, contact at y=0."""
import json
import struct
import numpy as np
from ktex import atlas_uv

C_STONE, C_RIVER, C_MOSS, C_SAND, C_BARK, C_WOOD, C_LEAF, C_AUTUMN, C_GRASS, C_FERN, C_FLOWER, C_MUSH, C_CONE, C_ACORN, C_FROST, C_CHAR = range(16)
# cell sub-rects
FRESH, STRAW, DAISY, LILAC = (0, 0, .5, .5), (.5, 0, 1, .5), (0, .5, .5, 1), (.5, .5, 1, 1)
FL_WHITE, FL_LILAC, FL_YELLOW, FL_RED = (0, 0, .5, .5), (.5, 0, 1, .5), (0, .5, .5, 1), (.5, .5, 1, 1)
MU_CAP, MU_GILL, MU_STEM, MU_RED = (0, 0, .5, .5), (.5, 0, 1, .5), (0, .5, .5, 1), (.5, .5, 1, 1)
AC_NUT, AC_CAP = (0, 0, .5, 1), (.5, 0, 1, 1)


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def basis_from(fwd, up):
    x = unit(fwd)
    z = unit(np.cross(x, up))
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def face_normals(P, T):
    return np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])


def smooth_normals(P, T):
    n = np.zeros_like(P)
    f = face_normals(P, T)
    for k in range(3):
        np.add.at(n, T[:, k], f)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def outward(P, T, center):
    """Flip triangles whose normal points toward `center` (per-triangle; for star-shaped solids)."""
    T = T.copy()
    f = face_normals(P, T)
    cen = P[T].mean(1)
    ref = center(cen) if callable(center) else cen - np.asarray(center)
    bad = (f * ref).sum(1) < 0
    T[bad] = T[bad][:, ::-1]
    return T


def fix_dir(P, T, d):
    f = face_normals(P, T).sum(0)
    return T[:, ::-1] if f @ np.asarray(d) < 0 else T


class Mesh:
    def __init__(self):
        self.p, self.n, self.u = [], [], []

    def add(self, P, T, UV, flat=False, N=None):
        P = np.asarray(P, float)
        T = np.asarray(T, int)
        UV = np.asarray(UV, float)
        f = face_normals(P, T)
        keep = np.linalg.norm(f, axis=1) > 2e-9
        if flat:
            Nc = np.repeat((f / np.maximum(np.linalg.norm(f, axis=1, keepdims=True), 1e-12))[:, None, :], 3, 1)
        else:
            Nc = (smooth_normals(P, T) if N is None else N)[T]
        self.p.append(P[T][keep])
        self.n.append(Nc[keep])
        self.u.append(UV[keep])

    def shift(self, d):
        self.p = [p + np.asarray(d) for p in self.p]

    def ground(self):
        allp = np.concatenate(self.p)
        c = allp.reshape(-1, 3)
        lo, hi = c.min(0), c.max(0)
        self.shift([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])

    def finish(self):
        P = np.concatenate(self.p).reshape(-1, 3)
        N = np.concatenate(self.n).reshape(-1, 3)
        U = np.concatenate(self.u).reshape(-1, 2)
        key = np.concatenate([np.round(P * 1e5), np.round(N * 1e3), np.round(U * 1e5)], 1).astype(np.int64)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1)
        return P[first].astype(np.float32), N[first].astype(np.float32), U[first].astype(np.float32), inv.astype(np.uint32).reshape(-1, 3)


# ------------------------------------------------------------------ primitives
def uvsphere(nu, nv):
    P = [[0, 1, 0]]
    for i in range(1, nv):
        th = np.pi * i / nv
        for j in range(nu):
            ph = 2 * np.pi * j / nu
            P.append([np.sin(th) * np.cos(ph), np.cos(th), np.sin(th) * np.sin(ph)])
    P.append([0, -1, 0])
    P = np.array(P)
    T = []
    for j in range(nu):
        T.append([0, 1 + j, 1 + (j + 1) % nu])
    for i in range(nv - 2):
        for j in range(nu):
            a, b = 1 + i * nu + j, 1 + i * nu + (j + 1) % nu
            c, d = a + nu, b + nu
            T += [[a, c, b], [b, c, d]]
    last = len(P) - 1
    for j in range(nu):
        T.append([last, 1 + (nv - 2) * nu + (j + 1) % nu, 1 + (nv - 2) * nu + j])
    return P, outward(P, np.array(T), np.zeros(3))


def noise3(P, rng, octs=5, base=1.4):
    out = np.zeros(len(P))
    tot = 0
    for i in range(octs):
        k = rng.normal(size=3)
        k = unit(k) * base * 1.7 ** i
        a = 0.62 ** i
        out += a * np.sin(P @ k + rng.random() * 6.28)
        tot += a
    return out / tot


def box_uv(P, T, ext, cells, rects=None, rng=None, jitter=0.05):
    """Per-triangle dominant-axis planar projection into atlas cell(s)."""
    f = face_normals(P, T)
    ax = np.abs(f).argmax(1)
    c = P[T].mean(1)
    k = 0.42 / max(ext, 1e-6)
    off = (rng.random(2) - 0.5) * 2 * jitter if rng is not None else np.zeros(2)
    UV = np.zeros((len(T), 3, 2))
    cells = np.broadcast_to(np.asarray(cells), (len(T),))
    cen = P.mean(0)
    for i in range(len(T)):
        q = P[T[i]] - cen
        a = ax[i]
        uv = np.stack([q[:, 2], q[:, 1]], 1) if a == 0 else np.stack([q[:, 0], q[:, 2]], 1) if a == 1 else np.stack([q[:, 0], q[:, 1]], 1)
        u = 0.5 + uv * k + off
        UV[i] = atlas_uv(int(cells[i]), u, (0, 0, 1, 1) if rects is None else rects[i])
    return UV


def add_stone(m, rng, half, cell, pos=(0, 0, 0), yaw=0.0, nu=12, nv=8, lump=0.16, flat=0.4, moss=False, cell_side=None):
    P, T = uvsphere(nu, nv)
    r = 1 + lump * noise3(P, rng) + 0.035 * noise3(P, rng, 4, 4.5)
    P = P * r[:, None] * np.asarray(half)
    fl = -flat * half[1]
    P[:, 1] = np.maximum(P[:, 1], fl) - fl
    if moss:
        nm = smooth_normals(P, T)
        up = nm[:, 1]
        bump = 0.010 * np.clip(up, 0, 1) * (0.6 + 0.4 * np.sin(P[:, 0] * 31 + P[:, 2] * 23))
        P = P + nm * bump[:, None]
    P = P @ rot_y(yaw).T + np.asarray(pos)
    f = face_normals(P, T)
    fn = f / np.maximum(np.linalg.norm(f, axis=1, keepdims=True), 1e-12)
    if moss:
        cl = P.mean(0)
        score = fn[:, 1] + 0.35 * np.sin(P[T].mean(1)[:, 0] * 13.0 + 2 * P[T].mean(1)[:, 2] * 9.0) + 0.0
        cells = np.where(score > 0.42, C_MOSS, cell)
    else:
        cells = np.full(len(T), cell)
    UV = box_uv(P, T, max(half), cells, rng=rng)
    m.add(P, T, UV)
    return P


def tube(path, radii, sides=8, vs=None, uspan=1.0, vspan=1.0):
    path = np.asarray(path, float)
    k = len(path)
    tang = np.gradient(path, axis=0)
    tang = tang / np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-12)
    ref = np.array([0, 1.0, 0]) if abs(tang[0][1]) < 0.9 else np.array([1.0, 0, 0])
    nrm = unit(np.cross(tang[0], ref))
    ring = []
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    for i in range(k):
        nrm = nrm - tang[i] * (nrm @ tang[i])
        nrm = unit(nrm)
        b = np.cross(tang[i], nrm)
        ring.append(path[i] + np.asarray(radii[i]) * (np.cos(ang)[:, None] * nrm + np.sin(ang)[:, None] * b))
    P = np.concatenate(ring)
    if vs is None:
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
        vs = seg / max(seg[-1], 1e-9)
    T, UV = [], []
    for i in range(k - 1):
        for j in range(sides):
            j1 = (j + 1) % sides
            a, b, c, d = i * sides + j, i * sides + j1, (i + 1) * sides + j1, (i + 1) * sides + j
            T += [[a, b, c], [a, c, d]]
            ua, ub = j / sides * uspan, (j + 1) / sides * uspan
            va, vb = vs[i] * vspan, vs[i + 1] * vspan
            UV += [[[ua, va], [ub, va], [ub, vb]], [[ua, va], [ub, vb], [ua, vb]]]
    return P, np.array(T), np.array(UV), tang


def cap_disc(P_ring, center, outdir, cell=C_WOOD, rad=0.34):
    """Flat cap fan with end-grain disc UVs."""
    sides = len(P_ring)
    Pc = np.vstack([P_ring, center])
    T = np.array([[sides, j, (j + 1) % sides] for j in range(sides)])
    T = fix_dir(Pc, T, outdir)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    uv_v = np.vstack([0.5 + rad * np.stack([np.cos(ang), np.sin(ang)], 1), [[0.5, 0.5]]])
    return Pc, T, atlas_uv(cell, uv_v[T])


def add_tube(m, path, radii, sides=8, cell=C_BARK, rect=(0, 0, 1, 1), caps=(False, False), uspan=1.0, vspan=1.0, vs=None):
    P, T, UV, tang = tube(path, radii, sides, vs=vs, uspan=uspan, vspan=vspan)
    m.add(P, T, atlas_uv(cell, UV, rect))
    k = len(path)
    if caps[0]:
        Pc, Tc, Uc = cap_disc(P[:sides], path[0], -tang[0])
        m.add(Pc, Tc, Uc)
    if caps[1]:
        Pc, Tc, Uc = cap_disc(P[(k - 1) * sides:], path[-1], tang[-1])
        m.add(Pc, Tc, Uc)
    return P


def sheet(basis, pos, length, width, rows=6, cols=3, pitch=0.0, droop=0.0, cup=0.0, roll=0.0, ripple=0.0, prof=None, cell=C_LEAF, rect=(0, 0, 1, 1), phase=0.0, base_w=0.0):
    """Thin bent leaf/blade/petal sheet. Local +x = heading, +y = up, +z = side. Winding faces +y."""
    t = np.linspace(0, 1, rows)
    s = np.linspace(-1, 1, cols)
    a = pitch + droop * t
    seg = length / (rows - 1)
    cx = np.r_[0, np.cumsum(np.cos(a[:-1]) * seg)]
    cy = np.r_[0, np.cumsum(np.sin(a[:-1]) * seg)]
    if prof is None:
        w = (np.sin(np.pi * t ** 0.8) ** 0.9 + base_w * (1 - t) ** 3) * width / 2
    else:
        w = prof(t) * width / 2
    P = np.zeros((rows, cols, 3))
    for i in range(rows):
        hd = np.array([np.cos(a[i]), np.sin(a[i]), 0])
        upn = np.array([-np.sin(a[i]), np.cos(a[i]), 0])
        side = np.array([0, 0, 1.0])
        sd = side * np.cos(roll) + upn * np.sin(roll)
        up2 = upn * np.cos(roll) - side * np.sin(roll)
        off = s * w[i]
        lift = cup * (s ** 2) * (w[i] + 1e-9) + ripple * np.sin(t[i] * 9 + phase) * np.abs(s) * width * 0.5
        P[i] = np.array([cx[i], cy[i], 0]) + off[:, None] * sd + lift[:, None] * up2
    Pf = (P.reshape(-1, 3) @ np.asarray(basis).T) + np.asarray(pos)
    T, UV = [], []
    uu = 0.5 + 0.5 * s
    for i in range(rows - 1):
        for j in range(cols - 1):
            a_, b_, c_, d_ = i * cols + j, i * cols + j + 1, (i + 1) * cols + j + 1, (i + 1) * cols + j
            T += [[a_, b_, c_], [a_, c_, d_]]
            va, vb = 1 - t[i], 1 - t[i + 1]
            UV += [[[uu[j], va], [uu[j + 1], va], [uu[j + 1], vb]], [[uu[j], va], [uu[j + 1], vb], [uu[j], vb]]]
    return Pf, np.array(T), atlas_uv(cell, np.array(UV), rect)


def add_sheet(m, *a, **k):
    P, T, UV = sheet(*a, **k)
    m.add(P, T, UV)


def lathe_pts(profile, sides, cell, rect, planar=None):
    """profile: list of (radius, y). Returns P,T,UV (cylindrical uv, or planar xz if planar=(R,))."""
    prof = np.asarray(profile, float)
    path = np.stack([np.zeros(len(prof)), prof[:, 1], np.zeros(len(prof))], 1)
    P, T, UV, _ = tube(path, np.maximum(prof[:, 0], 1e-5), sides)
    if planar:
        R = planar
        UV = np.stack([0.5 + P[T][..., 0] / (2 * R) * 0.94, 0.5 + P[T][..., 2] / (2 * R) * 0.94], -1)
    return P, T, atlas_uv(cell, UV, rect)


# ------------------------------------------------------------------ props
def R(seed):
    return np.random.default_rng(seed)


def p_pebbles():
    rng, m = R(11), Mesh()
    spec = [(0.0, 0.0, 0.050, C_STONE), (0.115, 0.045, 0.031, C_RIVER), (-0.10, 0.075, 0.037, C_SAND), (0.03, -0.105, 0.026, C_STONE),
            (-0.075, -0.09, 0.022, C_RIVER), (0.20, -0.06, 0.020, C_STONE), (0.14, 0.13, 0.017, C_SAND)]
    for x, z, s, c in spec:
        big = s > 0.03
        add_stone(m, rng, (s * 1.15, s * 0.72, s * 0.95), c, (x, 0, z), rng.random() * 6.28, 12 if big else 9, 8 if big else 6, lump=0.14, flat=0.36)
    m.ground()
    return m


def p_river():
    rng, m = R(12), Mesh()
    for x, z, sx, sz, yaw in [(0, 0, 0.15, 0.105, 0.3), (0.21, 0.13, 0.085, 0.06, 1.1), (-0.17, 0.12, 0.10, 0.07, -0.5), (0.02, -0.17, 0.075, 0.055, 2.0), (0.24, -0.09, 0.05, 0.04, 0.7)]:
        add_stone(m, rng, (sx, sx * 0.27, sz), C_RIVER, (x, 0, z), yaw, 14 if sx > 0.09 else 10, 8 if sx > 0.09 else 6, lump=0.06, flat=0.28)
    m.ground()
    return m


def p_mossy_rock():
    rng, m = R(13), Mesh()
    add_stone(m, rng, (0.32, 0.20, 0.25), C_STONE, (0, 0, 0), 0.4, 18, 12, lump=0.24, flat=0.35, moss=True)
    add_stone(m, rng, (0.10, 0.065, 0.085), C_STONE, (0.36, 0, 0.14), 1.0, 12, 8, lump=0.2, flat=0.3, moss=True)
    add_stone(m, rng, (0.06, 0.04, 0.05), C_STONE, (-0.33, 0, -0.16), 2.0, 9, 6, lump=0.2, flat=0.3)
    m.ground()
    return m


def p_sandstone():
    rng, m = R(14), Mesh()
    add_stone(m, rng, (0.21, 0.075, 0.15), C_SAND, (0, 0, 0), 0.5, 16, 10, lump=0.18, flat=0.5)
    add_stone(m, rng, (0.075, 0.035, 0.06), C_SAND, (0.23, 0, -0.07), 1.7, 10, 7, lump=0.2, flat=0.4)
    add_stone(m, rng, (0.05, 0.03, 0.04), C_SAND, (-0.17, 0, 0.16), 0.2, 9, 6, lump=0.2, flat=0.4)
    m.ground()
    return m


def bendy(rng, p0, p1, k, wob):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    t = np.linspace(0, 1, k)[:, None]
    d = unit(p1 - p0)
    a = unit(np.cross(d, [0, 1, 0.3]))
    b = np.cross(d, a)
    ph = rng.random(4) * 6.28
    off = wob * (np.sin(t * 3.1 + ph[0]) * a + np.sin(t * 4.3 + ph[1]) * b) * np.sin(np.pi * t)
    return p0 + (p1 - p0) * t + off


def limb(m, rng, p0, p1, r0, r1, k=8, sides=8, wob=0.02, caps=(False, False), tipcut=True):
    path = bendy(rng, p0, p1, k, wob)
    t = np.linspace(0, 1, k)
    rr = (r0 + (r1 - r0) * t) * (1 + 0.10 * np.sin(t * 17 + rng.random() * 6))
    return add_tube(m, path, rr, sides, C_BARK, caps=caps), path


def p_twig_fork():
    rng, m = R(15), Mesh()
    limb(m, rng, (-0.22, 0.012, 0), (0.06, 0.02, 0.02), 0.011, 0.0085, 8, 8, 0.012, (True, False))
    limb(m, rng, (0.06, 0.02, 0.02), (0.25, 0.03, 0.13), 0.0085, 0.004, 7, 7, 0.012, (False, True))
    limb(m, rng, (0.06, 0.02, 0.02), (0.22, 0.02, -0.09), 0.0085, 0.0035, 7, 7, 0.012, (False, True))
    limb(m, rng, (-0.08, 0.014, 0.0), (-0.04, 0.03, 0.07), 0.005, 0.0022, 5, 6, 0.004, (False, True))
    limb(m, rng, (0.17, 0.028, 0.093), (0.2, 0.035, 0.145), 0.0035, 0.0015, 4, 5, 0.003, (False, True))
    # knot at the fork
    P, T = uvsphere(9, 6)
    m.add(P * np.array([0.0125, 0.010, 0.0125]) + [0.06, 0.02, 0.02], T, atlas_uv(C_BARK, np.stack([P[T][..., 0] * 0.45 + 0.5, P[T][..., 1] * 0.45 + 0.5], -1)))
    m.ground()
    return m


def p_fallen_branch():
    rng, m = R(16), Mesh()
    k = 14
    t = np.linspace(0, 1, k)
    path = np.stack([t * 1.0 - 0.5, 0.03 + 0.025 * np.sin(np.pi * t) + 0.01 * np.sin(t * 12), 0.07 * np.sin(2 * np.pi * t + 0.6)], 1)
    rr = 0.026 * (1 - 0.45 * t) * (1 + 0.14 * np.sin(t * 23) * np.cos(t * 7))
    rr[-1] *= 0.55
    add_tube(m, path, rr, 10, C_BARK, caps=(True, True))
    for ti, dz, ln, rad in [(0.32, 1, 0.17, 0.010), (0.66, -1, 0.14, 0.008), (0.82, 1, 0.08, 0.005)]:
        i = int(ti * (k - 1))
        p0 = path[i] + [0, rr[i] * 0.3, 0]
        d = unit([0.35, 0.7, 0.5 * dz])
        limb(m, rng, p0, p0 + d * ln, rad, rad * 0.35, 6, 6, 0.006, (False, True))
    # bough knot swellings
    for ti in (0.32, 0.66):
        i = int(ti * (k - 1))
        P, T = uvsphere(9, 6)
        m.add(P * [0.026, 0.024, 0.026] + path[i], T, atlas_uv(C_BARK, np.stack([P[T][..., 0] * 0.45 + 0.5, P[T][..., 1] * 0.45 + 0.5], -1)))
    m.ground()
    return m


def plate(m, rng, cx, cz, l, w, th, curv, yaw, tilt):
    nx, ny = 7, 4
    gu = np.linspace(0, 1, nx)
    gv = np.linspace(0, 1, ny)
    top = []
    for u in gu:
        wt = w * (0.55 + 0.45 * np.sin(np.pi * (0.06 + 0.88 * u)) ** 0.7) * (1 + 0.1 * np.sin(u * 15 + cx * 50))
        for v in gv:
            z = (v - 0.5) * wt
            y = -curv * (2 * (v - 0.5)) ** 2 + 0.12 * curv * np.sin(u * 7)
            top.append([(u - 0.5) * l * (1 + 0.04 * np.sin(v * 9)), y, z])
    top = np.array(top)
    bot = top - [0, th, 0] + np.c_[rng.normal(0, 0.0015, len(top)), np.zeros(len(top)), rng.normal(0, 0.0015, len(top))] * 0
    n = len(top)
    P = np.vstack([top, bot])
    T, kind = [], []
    idx = lambda i, j: i * ny + j
    for i in range(nx - 1):
        for j in range(ny - 1):
            a, b, c, d = idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)
            T += [[a, b, c], [a, c, d]]; kind += [0, 0]
            T += [[n + a, n + c, n + b], [n + a, n + d, n + c]]; kind += [1, 1]
    edge = [(idx(i, 0), idx(i + 1, 0)) for i in range(nx - 1)] + [(idx(i, ny - 1), idx(i + 1, ny - 1)) for i in range(nx - 1)] + \
           [(idx(0, j), idx(0, j + 1)) for j in range(ny - 1)] + [(idx(nx - 1, j), idx(nx - 1, j + 1)) for j in range(ny - 1)]
    for a, b in edge:
        T += [[a, b, n + b], [a, n + b, n + a]]; kind += [1, 1]
    T = np.array(T)
    kind = np.array(kind)
    Rm = rot_y(yaw) @ rot_z(tilt[0]) @ rot_x(tilt[1])
    P = P @ Rm.T + [cx, 0.0, cz]
    cen = P.mean(0)
    T = outward(P, T, lambda c: c - cen + np.array([0, 0.0, 0]))
    uvg = np.vstack([np.stack([np.repeat(gu, ny), np.tile(gv, nx)], 1)] * 2)
    UV = np.zeros((len(T), 3, 2))
    for i in range(len(T)):
        ok = kind[i] == 0
        g = uvg[T[i]]
        UV[i] = atlas_uv(C_BARK, g, (0, 0, 1, 1)) if ok else atlas_uv(C_WOOD, 0.15 + 0.7 * g, (0, 0, 1, 1))
    m.add(P, T, UV)
    return P


def p_bark_shards():
    rng, m = R(17), Mesh()
    spec = [(0, 0, 0.26, 0.11, 0.010, 0.020, 0.3, (0.05, 0.03)), (0.22, 0.11, 0.17, 0.075, 0.008, 0.014, 1.7, (-0.08, 0.06)),
            (-0.20, 0.10, 0.19, 0.08, 0.009, 0.016, -0.6, (0.06, -0.05)), (0.05, -0.15, 0.15, 0.06, 0.007, 0.012, 2.4, (0.03, 0.09)),
            (-0.15, -0.12, 0.12, 0.05, 0.006, 0.011, 0.9, (-0.05, -0.04)), (0.28, -0.09, 0.09, 0.04, 0.005, 0.009, 0.1, (0.1, 0.0))]
    for cx, cz, l, w, th, cv, yaw, tilt in spec:
        plate(m, rng, cx, cz, l, w, th, cv, yaw, tilt)
    m.ground()
    return m


def p_leaf_litter():
    rng, m = R(18), Mesh()
    n = 12
    for i in range(n):
        r = 0.27 * np.sqrt(rng.random())
        a = rng.random() * 6.28
        pos = np.array([r * np.cos(a), 0.003 + 0.0035 * i, r * np.sin(a)])
        yaw = rng.random() * 6.28
        B = rot_y(yaw)
        L = rng.uniform(0.09, 0.15)
        cell = C_AUTUMN if rng.random() < 0.66 else C_LEAF
        add_sheet(m, B, pos, L, L * rng.uniform(0.5, 0.65), rows=7, cols=5, pitch=rng.uniform(-0.05, 0.12), droop=rng.uniform(-0.25, 0.1),
                  cup=rng.uniform(0.15, 0.6), roll=rng.uniform(-0.12, 0.12), ripple=rng.uniform(0.01, 0.05), cell=cell, phase=rng.random() * 6, base_w=0.08)
    limb(m, rng, (-0.14, 0.012, 0.12), (0.10, 0.014, 0.18), 0.0055, 0.0032, 6, 6, 0.01, (True, True))
    m.ground()
    return m


def blade(m, rng, pos, height, az, lean, bend, width, cell=C_GRASS, rect=FRESH):
    B = basis_from([np.cos(az), 0, np.sin(az)], [0, 1, 0])
    add_sheet(m, B, pos, height, width, rows=5, cols=3, pitch=np.pi / 2 - lean, droop=-bend, cup=0.28, cell=cell, rect=rect,
              prof=lambda t: (1 - t ** 1.7) * (0.85 + 0.15 * np.sin(np.pi * np.clip(t * 3, 0, 1))) + 0.0)


def p_grass_tuft():
    rng, m = R(19), Mesh()
    for i in range(34):
        r = 0.028 * np.sqrt(rng.random())
        a = rng.random() * 6.28
        az = a + rng.normal(0, 0.45)
        h = rng.uniform(0.13, 0.30) * (1.15 - 1.5 * r)
        blade(m, rng, (r * np.cos(a), 0, r * np.sin(a)), h, az, rng.uniform(0.1, 0.55) + 6 * r, rng.uniform(0.3, 1.1), rng.uniform(0.007, 0.012),
              rect=STRAW if i % 6 == 0 else FRESH)
    m.ground()
    return m


def p_seedhead_grass():
    rng, m = R(20), Mesh()
    for i in range(14):
        r = 0.02 * np.sqrt(rng.random())
        a = rng.random() * 6.28
        blade(m, rng, (r * np.cos(a), 0, r * np.sin(a)), rng.uniform(0.18, 0.38), a + rng.normal(0, 0.4), rng.uniform(0.15, 0.5), rng.uniform(0.5, 1.2), rng.uniform(0.004, 0.007),
              rect=STRAW if i % 4 == 0 else FRESH)
    for i in range(8):
        a = i / 8 * 6.28 + rng.normal(0, 0.3)
        H = rng.uniform(0.42, 0.72)
        lean = rng.uniform(0.1, 0.42)
        top = np.array([np.cos(a) * np.sin(lean) * H * 0.9, H * np.cos(lean), np.sin(a) * np.sin(lean) * H * 0.9])
        top = top + [0, 0, 0]
        path = np.array([[0, 0, 0], top * 0.35 + [0, 0, 0], top * 0.7, top])
        path[1] += [0, 0.0, 0]
        path[3][1] -= 0.02
        add_tube(m, path, [0.0022, 0.0018, 0.0015, 0.0011], 3, C_GRASS, STRAW)
        d = unit(path[3] - path[2])
        prof = [(0.0012, 0), (0.0055, 0.012), (0.0068, 0.028), (0.0055, 0.045), (0.0026, 0.058), (0.0004, 0.066)]
        P, T, UV = lathe_pts(prof, 5, C_GRASS, STRAW)
        Bm = basis_from(np.cross(d, [0.3, 0.1, 1.0]), d)  # y-axis lathe -> d
        Rm = np.stack([unit(np.cross(d, [0.3, 0.1, 1.0])), d, np.cross(unit(np.cross(d, [0.3, 0.1, 1.0])), d)], 1)
        m.add(P @ Rm.T + path[3], T, UV)
        # awns: tiny tapering hairs
        for j in range(3):
            blade(m, rng, path[3] + d * 0.05, 0.03, a + j * 2.1, 0.25 + lean, 0.0, 0.0022, rect=STRAW)
    m.ground()
    return m


def p_broadleaf():
    rng, m = R(21), Mesh()
    n = 8
    for i in range(n):
        az = i / n * 6.28 + rng.normal(0, 0.18)
        lift = rng.uniform(0.6, 1.0)
        d = np.array([np.cos(az) * np.cos(lift), np.sin(lift), np.sin(az) * np.cos(lift)])
        L = rng.uniform(0.09, 0.13)
        p0 = np.array([np.cos(az) * 0.008, 0, np.sin(az) * 0.008])
        p1 = p0 + d * L
        add_tube(m, [p0, (p0 + p1) / 2 + [0, 0.008, 0], p1], [0.0055, 0.0042, 0.0035], 4, C_GRASS, FRESH)
        B = basis_from([np.cos(az), 0, np.sin(az)], [0, 1, 0])
        add_sheet(m, B, p1 - [0, 0.003, 0], rng.uniform(0.17, 0.24), rng.uniform(0.10, 0.13), rows=7, cols=5, pitch=rng.uniform(0.25, 0.5), droop=-rng.uniform(0.7, 1.2),
                  cup=rng.uniform(0.25, 0.5), roll=rng.normal(0, 0.1), ripple=0.03, cell=C_LEAF, phase=i, base_w=0.12)
    for a, H in ((0.7, 0.34), (3.6, 0.27)):
        tip = np.array([np.cos(a) * 0.05, H, np.sin(a) * 0.05])
        add_tube(m, [[0, 0, 0], tip * 0.5, tip], [0.0028, 0.0022, 0.002], 4, C_GRASS, FRESH)
        P, T, UV = lathe_pts([(0.001, 0), (0.005, 0.01), (0.0065, 0.05), (0.005, 0.10), (0.0015, 0.13)], 6, C_GRASS, STRAW)
        m.add(P + tip, T, UV)
    m.ground()
    return m


def p_fern():
    rng, m = R(22), Mesh()
    nf = 6
    for f in range(nf):
        az = f / nf * 6.28 + rng.normal(0, 0.2)
        Lf = rng.uniform(0.30, 0.42) * (0.75 if f == nf - 1 else 1)
        rows = 8
        # arched rachis in vertical plane
        a0, a1 = rng.uniform(0.9, 1.15), rng.uniform(-0.55, -0.15)
        ang = a0 + (a1 - a0) * np.linspace(0, 1, rows) ** 1.1
        seg = Lf / (rows - 1)
        h = np.array([np.cos(az), 0, np.sin(az)])
        pts = [np.array([0.0, 0, 0])]
        for i in range(rows - 1):
            pts.append(pts[-1] + seg * (np.cos(ang[i]) * h + np.array([0, np.sin(ang[i]), 0])))
        pts = np.array(pts)
        add_tube(m, pts, np.linspace(0.0032, 0.0008, rows), 3, C_FERN, (0, 0, 1, 1), uspan=0.3)
        side = np.array([-np.sin(az), 0, np.cos(az)])
        for i in range(1, rows - 1):
            s = i / (rows - 1)
            tan = unit(pts[i + 1] - pts[i - 1])
            upn = np.cross(side, tan)
            l = (0.062 * np.sin(np.pi * (0.12 + 0.85 * (1 - s))) ** 0.8 + 0.006) * (Lf / 0.36)
            for sg in (1, -1):
                d = unit(np.cos(0.95) * side * sg + np.sin(0.95) * tan + upn * -0.22)
                B = basis_from(d, upn)
                add_sheet(m, B, pts[i], l, l * 0.36, rows=3, cols=3, pitch=0.12, droop=-0.35, cup=0.35, cell=C_FERN, prof=lambda t: np.sin(np.pi * t ** 0.75) ** 0.9)
        # terminal leaflet
        tan = unit(pts[-1] - pts[-2])
        B = basis_from(tan, np.cross(side, tan))
        add_sheet(m, B, pts[-1], 0.05, 0.022, rows=3, cols=3, pitch=0, droop=-0.3, cup=0.3, cell=C_FERN)
    m.ground()
    return m


def p_flowers():
    rng, m = R(23), Mesh()
    rects = [FL_WHITE, FL_YELLOW, FL_LILAC, FL_RED, FL_WHITE, FL_YELLOW, FL_LILAC]
    centres = [(0, 0), (0.09, 0.06), (-0.08, 0.08), (0.06, -0.09), (-0.10, -0.06), (0.16, -0.02), (-0.02, 0.14)]
    for i, (rect, (x, z)) in enumerate(zip(rects, centres)):
        H = rng.uniform(0.13, 0.24)
        lean = rng.uniform(0.05, 0.28)
        a = rng.random() * 6.28
        top = np.array([x + np.cos(a) * np.sin(lean) * H, H * np.cos(lean), z + np.sin(a) * np.sin(lean) * H])
        base = np.array([x, 0, z])
        mid = (base + top) / 2 + [0.01 * np.cos(a + 1.5), 0, 0.01 * np.sin(a + 1.5)]
        add_tube(m, [base, mid, top], [0.0024, 0.0019, 0.0017], 4, C_GRASS, FRESH)
        axis = unit([np.cos(a) * 0.35, 1, np.sin(a) * 0.35])
        np_ = 6 if i % 2 == 0 else 5
        pl = 0.028 if rect in (FL_WHITE, FL_LILAC) else 0.022
        for j in range(np_):
            ph = j / np_ * 6.28 + i
            perp1 = unit(np.cross(axis, [0, 0, 1.0]))
            perp2 = np.cross(axis, perp1)
            rad = np.cos(ph) * perp1 + np.sin(ph) * perp2
            fwd = unit(rad * np.cos(0.32) + axis * np.sin(0.32))
            B = basis_from(fwd, axis)
            wid = pl * (0.42 if rect in (FL_WHITE, FL_LILAC) else 0.7)
            add_sheet(m, B, top + rad * 0.003, pl, wid, rows=3, cols=3, pitch=0.1, droop=-0.35, cup=0.25, cell=C_FLOWER, rect=rect,
                      prof=lambda t: np.sin(np.pi * t ** 0.7) ** 0.7)
        P, T = uvsphere(7, 5)
        cr = FL_YELLOW if rect != FL_YELLOW else FL_RED
        m.add(P * [0.0065, 0.0045, 0.0065] + top + axis * 0.003, T, atlas_uv(C_FLOWER, np.stack([P[T][..., 0] * 0.3 + 0.5, P[T][..., 2] * 0.3 + 0.5], -1), FL_YELLOW))
        if i % 2 == 0:
            blade(m, rng, base, 0.09, a + 2, 0.3, 0.6, 0.012, C_GRASS, FRESH)
    for i in range(4):
        a = i * 1.7
        blade(m, rng, (0.03 * np.cos(a), 0, 0.03 * np.sin(a)), 0.12, a, 0.5, 0.9, 0.009)
    m.ground()
    return m


def mushroom(m, rng, x, z, h, Rc, tilt, red=False, tdir=0.0):
    sr = Rc * 0.24
    stem = [(sr * 1.55, 0), (sr * 1.25, h * 0.15), (sr * 1.02, h * 0.5), (sr * 0.92, h * 0.85), (sr * 0.96, h)]
    Hc = Rc * (0.55 if not red else 0.7)
    cap = [(Rc * np.sin(np.radians(th)), h + Hc * np.cos(np.radians(th))) for th in (0, 22, 44, 64, 80, 90)]
    cap.append((Rc * 0.96, h + 0.004))
    Rm = rot_y(tdir) @ rot_x(tilt) @ rot_y(-tdir)
    org = np.array([x, 0, z])
    P, T, UV = lathe_pts(stem, 8, C_MUSH, MU_STEM)
    m.add(P @ Rm.T + org, T, UV)
    cp = np.asarray([[Rc * 0.97, h + 0.003]] + [[r, y] for r, y in reversed(cap[1:-1])] + [[0.0005, h + Hc]])
    P, T, UV = lathe_pts(cp, 10, C_MUSH, MU_RED if red else MU_CAP, planar=Rc)
    m.add(P @ Rm.T + org, T, UV)
    # gill underside: annulus
    ns = 10
    ang = np.linspace(0, 2 * np.pi, ns, endpoint=False)
    inner = np.stack([np.cos(ang) * sr * 0.95, np.full(ns, h - 0.001), np.sin(ang) * sr * 0.95], 1)
    outer = np.stack([np.cos(ang) * Rc * 0.96, np.full(ns, h + 0.002), np.sin(ang) * Rc * 0.96], 1)
    Pg = np.vstack([inner, outer])
    Tg = []
    for j in range(ns):
        j1 = (j + 1) % ns
        Tg += [[j, ns + j1, ns + j], [j, j1, ns + j1]]
    Tg = fix_dir(Pg, np.array(Tg), [0, -1, 0])
    uvg = 0.5 + 0.47 * Pg[:, [0, 2]] / Rc
    m.add(Pg @ Rm.T + org, Tg, atlas_uv(C_MUSH, uvg[Tg], MU_GILL))


def p_mushrooms():
    rng, m = R(24), Mesh()
    for x, z, h, r, tl, red in [(0, 0, 0.055, 0.032, 0.10, False), (0.06, 0.035, 0.036, 0.021, -0.16, True), (-0.045, 0.045, 0.045, 0.026, 0.2, False),
                                (0.02, -0.06, 0.03, 0.018, 0.25, False), (0.095, -0.03, 0.02, 0.013, -0.3, True), (-0.07, -0.03, 0.026, 0.015, 0.2, False)]:
        mushroom(m, rng, x, z, h, r, tl, red, rng.random() * 6)
    for i in range(7):
        blade(m, rng, (0.1 * np.cos(i * 0.9), 0, 0.09 * np.sin(i * 0.9 + 1)), 0.05, i, 0.5, 0.9, 0.008)
    m.ground()
    return m


def p_roots():
    rng, m = R(25), Mesh()
    P, T = uvsphere(10, 6)
    m.add(P * [0.065, 0.06, 0.065] + [0, 0.02, 0], T, atlas_uv(C_BARK, np.stack([P[T][..., 0] * 0.4 + 0.5, P[T][..., 1] * 0.4 + 0.5], -1)))
    n = 5
    for i in range(n):
        az = i / n * 6.28 + rng.normal(0, 0.25)
        reach = rng.uniform(0.32, 0.5)
        k = 10
        s = np.linspace(0, 1, k)
        rad = 0.05 + reach * s
        wob = 0.05 * np.sin(s * 7 + i) * s
        pts = np.stack([np.cos(az) * rad + np.cos(az + 1.57) * wob, 0.075 * (1 - s) ** 1.6 + 0.014 + 0.012 * np.sin(s * 9 + i) * s + 0.0 * s, np.sin(az) * rad + np.sin(az + 1.57) * wob], 1)
        pts[-1, 1] = 0.004
        rr = 0.034 * (1 - s) ** 0.9 + 0.004
        add_tube(m, pts, rr, 7, C_BARK, caps=(False, False))
        if i % 2 == 0:
            j = 6
            d = unit(pts[j + 1] - pts[j])
            side = unit(np.cross(d, [0, 1, 0]))
            q1 = pts[j] + (d * 0.7 + side * 0.7 * (1 if i % 4 == 0 else -1)) * 0.2
            q1[1] = 0.005
            limb(m, rng, pts[j], q1, rr[j] * 0.6, 0.002, 6, 5, 0.008, (False, False))
    m.ground()
    return m


def p_pinecone():
    rng, m = R(26), Mesh()
    L, Rb = 0.115, 0.034
    ax_prof = lambda t: Rb * (np.sin(np.pi * (0.06 + 0.9 * t) ** 1.0) ** 0.75)
    core_prof = [(max(ax_prof(t) * 0.8, 0.0006), t * L) for t in np.linspace(0, 1, 9)]
    P, T, UV = lathe_pts(core_prof, 9, C_CONE, (0, 0, 1, 1))
    Rm = rot_z(np.radians(-78)) @ np.eye(3)
    sc = []
    N = 88
    golden = 2.39996
    for i in range(N):
        t = (i + 0.5) / N
        y = 0.008 + t * (L - 0.016)
        r = ax_prof(y / L) * 0.86
        th = i * golden
        tw = 0.020 + 0.022 * np.sin(np.pi * t) ** 0.6
        rad = np.array([np.cos(th), 0, np.sin(th)])
        tang = np.array([-np.sin(th), 0, np.cos(th)])
        ax = np.array([0, 1.0, 0])
        Bk = rad * r * 0.94 + ax * (y - 0.006)
        Lp = rad * r * 1.0 + tang * tw * 0.55 + ax * y
        Rp = rad * r * 1.0 - tang * tw * 0.55 + ax * y
        Fw = rad * (r * 1.02) + ax * (y + 0.014)
        A = rad * (r + 0.011 * (0.7 + 0.5 * np.sin(np.pi * t))) + ax * (y + 0.005)
        Pp = np.array([Bk, Lp, Fw, Rp, A])
        Tt = np.array([[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]])
        axis_pt = np.array([0, y, 0])
        Tt = outward(Pp, Tt, lambda c: c - axis_pt)
        uv = np.array([[0.5, 0.97], [0.05, 0.55], [0.5, 0.08], [0.95, 0.55], [0.5, 0.3]])
        m.add(Pp @ Rm.T, Tt, atlas_uv(C_CONE, uv[Tt]))
    m.add(P @ Rm.T, T, UV)
    # tail stub
    add_tube(m, np.array([[0, -0.001, 0], [0, -0.012, 0]]) @ Rm.T, [0.005, 0.004], 5, C_CONE, (0, 0, 1, 1))
    m.ground()
    return m


def p_acorns():
    rng, m = R(27), Mesh()
    nut = [(0.0004, 0.0), (0.0075, 0.002), (0.0125, 0.010), (0.0138, 0.020), (0.0115, 0.030), (0.0072, 0.038), (0.0028, 0.043), (0.0006, 0.046)]
    cap = [(0.0165, 0.0), (0.0172, 0.0035), (0.0158, 0.008), (0.0110, 0.0125), (0.0050, 0.0150), (0.0006, 0.016)]
    def nutmesh(org, Rm):
        P, T, UV = lathe_pts(nut, 10, C_ACORN, AC_NUT)
        m.add(P @ Rm.T + org, T, UV)
    def capmesh(org, Rm, flip=False):
        P, T, UV = lathe_pts(cap, 10, C_ACORN, AC_CAP)
        m.add(P @ Rm.T + org, T, UV)
        st = np.array([[0, 0.015, 0], [0, 0.0215, 0.0]])
        add_tube(m, st @ Rm.T + org, [0.0026, 0.0019], 5, C_ACORN, AC_CAP)
    # acorn A: whole, lying
    Ra = rot_y(0.5) @ rot_z(np.radians(-84))
    oa = np.array([0.0, 0.0138, 0.0])
    nutmesh(oa, Ra)
    capmesh(oa, Ra)  # cap covers the wide (y=0) end
    # acorn B: nut lying elsewhere, tip up-ish; its cap upside down beside it
    Rb = rot_y(2.2) @ rot_z(np.radians(-78))
    ob = np.array([0.055, 0.0135, 0.062])
    nutmesh(ob, Rb)
    Rc = rot_z(np.pi) @ rot_y(1.0)
    capmesh(np.array([-0.045, 0.016, 0.05]), Rc)
    m.ground()
    return m


def shard(m, rng, cx, cz, size, hgt, frosty, yaw):
    ns = 6
    ang = np.sort(rng.random(ns) * 6.28)
    ang = np.linspace(0, 6.28, ns, endpoint=False) + rng.normal(0, 0.25, ns)
    rad = size * rng.uniform(0.7, 1.15, ns)
    base = np.stack([np.cos(ang) * rad, np.zeros(ns), np.sin(ang) * rad], 1)
    mid = np.stack([np.cos(ang) * rad * 0.8, hgt * 0.62 * rng.uniform(0.8, 1.15, ns), np.sin(ang) * rad * 0.8], 1)
    slant = np.array([rng.normal(0, size * 0.25), 0, rng.normal(0, size * 0.25)])
    top = np.stack([np.cos(ang) * rad * 0.42, hgt * rng.uniform(0.9, 1.15, ns), np.sin(ang) * rad * 0.42], 1) + slant
    ctr = np.array([slant[0], hgt * 1.05, slant[2]])
    P = np.vstack([base, mid, top, ctr]) @ rot_y(yaw).T + [cx, 0, cz]
    T = []
    for j in range(ns):
        j1 = (j + 1) % ns
        T += [[j, j1, ns + j1], [j, ns + j1, ns + j], [ns + j, ns + j1, 2 * ns + j1], [ns + j, 2 * ns + j1, 2 * ns + j]]
        T += [[2 * ns + j, 2 * ns + j1, 3 * ns]]
    T = np.array(T)
    cen = P[:3 * ns].mean(0) * [1, 0, 1] + [0, hgt * 0.4, 0]
    T = outward(P, T, cen)
    f = face_normals(P, T)
    fn = f / np.maximum(np.linalg.norm(f, axis=1, keepdims=True), 1e-12)
    cells = np.where((fn[:, 1] > (0.15 if frosty else 0.7)), C_FROST, C_CHAR)
    UV = box_uv(P, T, size * 1.4, cells, rng=rng)
    m.add(P, T, UV, flat=True)


def p_frost_char():
    rng, m = R(28), Mesh()
    spec = [(0, 0, 0.085, 0.10, True, 0.2), (0.15, 0.07, 0.06, 0.07, False, 1.0), (-0.13, 0.08, 0.065, 0.075, True, 2.0), (0.04, -0.14, 0.055, 0.06, False, 0.5),
            (-0.09, -0.11, 0.04, 0.045, True, 1.4), (0.20, -0.07, 0.038, 0.04, False, 2.6), (-0.21, -0.02, 0.032, 0.035, False, 0.3), (0.10, 0.19, 0.03, 0.03, True, 0.9)]
    for cx, cz, s, h, fr, yw in spec:
        shard(m, rng, cx, cz, s, h, fr, yw)
    for p0, p1, r0 in [((-0.20, 0.018, 0.16), (0.06, 0.02, 0.24), 0.017), ((0.11, 0.014, -0.17), (0.28, 0.02, -0.06), 0.013), ((-0.16, 0.012, -0.2), (-0.02, 0.016, -0.24), 0.011)]:
        path = bendy(rng, p0, p1, 6, 0.012)
        rr = r0 * (1 - 0.3 * np.linspace(0, 1, 6)) * (1 + 0.15 * np.sin(np.arange(6) * 2.3))
        P, T, UV, tang = tube(path, rr, 6)
        m.add(P, T, atlas_uv(C_CHAR, UV))
        for e, sg in ((0, -1), (5, 1)):
            Pc, Tc, Uc = cap_disc(P[e * 6:(e + 1) * 6], path[e], tang[e] * sg, cell=C_CHAR, rad=0.3)
            m.add(Pc, Tc, Uc)
    m.ground()
    return m


PROPS = [
    ("pebble_scatter", p_pebbles, "stone", ["orchard_highlands", "sandstone_quarry", "forge_yard", "pinewood_ruins", "gloamfen", "cloudbreak_keep", "starfall_ridge", "sky_garden"], 1.0, [0.7, 1.5], 30),
    ("river_stones", p_river, "stone", ["gloamfen", "mushroom_glade", "orchard_highlands", "pinewood_ruins", "sky_garden"], 0.8, [0.8, 1.6], 35),
    ("mossy_rock", p_mossy_rock, "stone", ["pinewood_ruins", "mushroom_glade", "gloamfen", "orchard_highlands", "sky_garden"], 0.5, [0.7, 1.7], 55),
    ("sandstone_chip", p_sandstone, "stone", ["sandstone_quarry", "forge_yard", "cloudbreak_keep", "ember_foundry", "starfall_ridge"], 1.0, [0.7, 1.5], 40),
    ("twig_fork", p_twig_fork, "wood", ["pinewood_ruins", "mushroom_glade", "gloamfen", "orchard_highlands", "sky_garden"], 1.0, [0.8, 1.4], 25),
    ("fallen_branch", p_fallen_branch, "wood", ["pinewood_ruins", "orchard_highlands", "mushroom_glade", "gloamfen"], 0.45, [0.7, 1.3], 40),
    ("bark_shards", p_bark_shards, "wood", ["pinewood_ruins", "orchard_highlands", "mushroom_glade", "forge_yard", "ember_foundry"], 0.7, [0.7, 1.3], 30),
    ("leaf_litter", p_leaf_litter, "litter", ["orchard_highlands", "pinewood_ruins", "mushroom_glade", "gloamfen", "sky_garden"], 1.2, [0.8, 1.4], 30),
    ("grass_tuft", p_grass_tuft, "grass", ["orchard_highlands", "sky_garden", "pinewood_ruins", "gloamfen", "mushroom_glade", "cloudbreak_keep"], 1.4, [0.8, 1.3], 35),
    ("seedhead_grass", p_seedhead_grass, "grass", ["orchard_highlands", "sky_garden", "sandstone_quarry", "cloudbreak_keep", "starfall_ridge"], 0.9, [0.8, 1.25], 35),
    ("broadleaf_plant", p_broadleaf, "fern", ["orchard_highlands", "mushroom_glade", "gloamfen", "pinewood_ruins", "enchanted_kitchen"], 0.6, [0.8, 1.3], 35),
    ("fern_delicate", p_fern, "fern", ["pinewood_ruins", "mushroom_glade", "gloamfen", "sky_garden", "crystal_hollow"], 0.8, [0.8, 1.3], 40),
    ("meadow_flowers", p_flowers, "grass", ["orchard_highlands", "sky_garden", "cloudbreak_keep", "enchanted_kitchen"], 0.7, [0.8, 1.3], 40),
    ("mushroom_cluster", p_mushrooms, "litter", ["mushroom_glade", "gloamfen", "pinewood_ruins", "crystal_hollow"], 0.6, [0.8, 1.4], 30),
    ("root_tangle", p_roots, "wood", ["pinewood_ruins", "mushroom_glade", "gloamfen", "orchard_highlands"], 0.3, [0.8, 1.5], 45),
    ("pinecone", p_pinecone, "litter", ["pinewood_ruins", "starfall_ridge", "cloudbreak_keep"], 0.8, [0.9, 1.4], 25),
    ("acorn_pair", p_acorns, "litter", ["orchard_highlands", "pinewood_ruins", "mushroom_glade"], 0.6, [0.9, 1.5], 22),
    ("frost_char_debris", p_frost_char, "debris", ["ember_foundry", "forge_yard", "starfall_ridge", "cloudbreak_keep", "crystal_hollow"], 0.8, [0.7, 1.4], 40),
]


def write_glb(path, name, mesh, tex_uris):
    P, N, U, I = mesh.finish()
    idx = I.astype("<u4").reshape(-1)
    blobs = [P.astype("<f4").tobytes(), N.astype("<f4").tobytes(), U.astype("<f4").tobytes(), idx.tobytes()]
    views, off = [], 0
    for i, b in enumerate(blobs):
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": 34963 if i == 3 else 34962})
        off += len(b)
    binblob = b"".join(blobs)
    g = {
        "asset": {"version": "2.0", "generator": "branns-ground-kit build.py (Sonnet 5.5)"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0, "mode": 4}]}],
        "materials": [{"name": "ground_kit_atlas", "doubleSided": True, "alphaMode": "OPAQUE",
                       "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 1.0, "roughnessFactor": 1.0, "metallicRoughnessTexture": {"index": 2}},
                       "normalTexture": {"index": 1}, "occlusionTexture": {"index": 2}}],
        "textures": [{"sampler": 0, "source": i} for i in range(3)],
        "images": [{"uri": u, "name": n} for u, n in zip(tex_uris, ("albedo", "normal", "orm"))],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "buffers": [{"byteLength": len(binblob)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(P), "type": "VEC3", "min": P.min(0).tolist(), "max": P.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(N), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(U), "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
    }
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binblob += b"\0" * (-len(binblob) % 4)
    total = 12 + 8 + len(js) + 8 + len(binblob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binblob), 0x004E4942) + binblob)
    lo, hi = P.min(0), P.max(0)
    return {"tris": int(len(idx) // 3), "verts": int(len(P)), "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
            "extent_m": (hi - lo).round(3).tolist()}
