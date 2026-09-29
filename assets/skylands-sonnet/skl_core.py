"""Core helpers for the Skylands builder: textures, materials, Asset geometry API.
All geometry is authored in Godot coordinates (X sideways, Y up, Z length) and converted
to Blender (x, -z, y) at vertex creation; the glTF exporter (+Y up) then round-trips it exactly."""
import bpy, bmesh, math, os, zlib, random
import numpy as np
from mathutils import Vector, Matrix
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
TEX_DIR = os.path.join(HERE, "textures")


# ---------------------------------------------------------------- colour
def hx(s):
    s = s.lstrip('#')
    if len(s) == 3:
        s = ''.join(ch * 2 for ch in s)
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def mul(a, f):
    return tuple(min(1.0, max(0.0, a[i] * f)) for i in range(3))

def lin(c):
    return tuple(max(0.0, x) ** 2.2 for x in c)


# ---------------------------------------------------------------- textures
def pnoise(n, fx, fy, rng):
    g = rng.random((fy, fx))
    x = np.arange(n) / n * fx
    y = np.arange(n) / n * fy
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    tx = x - x0; ty = y - y0
    sx = tx * tx * (3 - 2 * tx); sy = ty * ty * (3 - 2 * ty)
    x0m = x0 % fx; x1 = (x0 + 1) % fx; y0m = y0 % fy; y1 = (y0 + 1) % fy
    a = g[y0m][:, x0m]; b = g[y0m][:, x1]; c = g[y1][:, x0m]; d = g[y1][:, x1]
    top = a * (1 - sx)[None, :] + b * sx[None, :]
    bot = c * (1 - sx)[None, :] + d * sx[None, :]
    return top * (1 - sy)[:, None] + bot * sy[:, None]

def fbm(n, f, octs, rng, aniso=(1, 1)):
    tot = np.zeros((n, n)); amp = 1.0; norm = 0.0
    for o in range(octs):
        tot += amp * pnoise(n, max(1, int(f * aniso[0] * 2 ** o)), max(1, int(f * aniso[1] * 2 ** o)), rng)
        norm += amp; amp *= 0.5
    return tot / norm

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    return np.stack([-dx / ln * 0.5 + 0.5, -dy / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)

def tex_cliff(n, rng):
    v = (np.arange(n) / n)[:, None] * np.ones((1, n))
    warp = fbm(n, 3, 4, rng) * 0.9
    bands = 0.5 + 0.5 * np.sin(2 * np.pi * (6 * v + warp))
    fine = fbm(n, 12, 4, rng)
    crack = np.abs(fbm(n, 5, 4, rng, aniso=(1, 3)) - 0.5) * 2
    crack = np.clip(1 - crack * 9, 0, 1)
    h = 0.5 * fine + 0.3 * bands + 0.2 * warp - 0.25 * crack
    warm = np.array(hx('e2d6bf')); cool = np.array(hx('b7b8b6')); dark = np.array(hx('8c8478'))
    t = (0.55 * bands + 0.45 * fine)[..., None]
    alb = warm * (1 - t) + cool * t
    alb = alb * (1 - 0.35 * crack[..., None]) + dark * 0.35 * crack[..., None]
    alb *= (0.9 + 0.2 * fbm(n, 20, 2, rng))[..., None]
    return np.clip(alb, 0, 1), h

def tex_ashlar(n, rng):
    rows, cols = 8, 4
    y, x = np.mgrid[0:n, 0:n] / n
    r = np.floor(y * rows).astype(int)
    xs = x * cols + (r % 2) * 0.5
    c = np.floor(xs).astype(int) % cols
    fy = (y * rows) % 1; fx = xs % 1
    edge = np.minimum(np.minimum(fy, 1 - fy) * 1.0, np.minimum(fx, 1 - fx) * 0.5)
    mortar = np.clip(1 - edge / 0.045, 0, 1)
    block_id = (r * 7 + c * 13) % 11 / 11.0
    fine = fbm(n, 16, 4, rng)
    base = np.array(hx('e9e4d6'))
    var = (0.9 + 0.16 * block_id + 0.12 * fine)[..., None]
    alb = base * var
    alb = alb * (1 - 0.55 * mortar[..., None]) + np.array(hx('7d786c')) * 0.55 * mortar[..., None]
    h = 0.6 * fine + 0.5 * (1 - mortar) + 0.1 * block_id
    return np.clip(alb, 0, 1), h

def tex_turf(n, rng):
    f1 = fbm(n, 6, 5, rng); f2 = fbm(n, 40, 2, rng, aniso=(1, 3))
    a = np.array(hx('a6c866')); b = np.array(hx('6fa050')); c = np.array(hx('c9dc84'))
    t = f1[..., None]
    alb = a * (1 - t) + b * t
    s = np.clip((f2 - 0.55) * 4, 0, 1)[..., None]
    alb = alb * (1 - 0.5 * s) + c * 0.5 * s
    return np.clip(alb, 0, 1), 0.5 * f1 + 0.5 * f2

def tex_timber(n, rng):
    grain = fbm(n, 3, 5, rng, aniso=(1, 14))
    ring = 0.5 + 0.5 * np.sin(2 * np.pi * (10 * grain))
    y = (np.arange(n) / n)[:, None] * np.ones((1, n))
    seam = np.clip(1 - np.abs(((y * 4) % 1) - 0.0) / 0.012, 0, 1) + np.clip(1 - np.abs(((y * 4) % 1) - 1) / 0.012, 0, 1)
    a = np.array(hx('c99a62')); b = np.array(hx('8a5f38'))
    t = (0.6 * ring + 0.4 * grain)[..., None]
    alb = a * (1 - t) + b * t
    alb = alb * (1 - 0.5 * seam[..., None])
    return np.clip(alb, 0, 1), 0.6 * grain + 0.3 * ring - 0.4 * seam

def tex_roof(n, rng):
    rows, cols = 8, 8
    y, x = np.mgrid[0:n, 0:n] / n
    r = np.floor(y * rows).astype(int)
    xs = x * cols + (r % 2) * 0.5
    fy = (y * rows) % 1; fx = xs % 1
    arc = np.sqrt((fx - 0.5) ** 2 + (fy - 1.0) ** 2 * 0.9)
    tile = np.clip(1 - arc * 1.15, 0, 1)
    cell = ((np.floor(xs).astype(int) * 3 + r * 5) % 7) / 7.0
    base = np.array(hx('3aa6a4')); dark = np.array(hx('1f6f74')); hi = np.array(hx('7fd3c6'))
    t = (0.5 * cell + 0.5 * (1 - tile))[..., None]
    alb = base * (1 - t) + dark * t
    alb = alb + (hi - alb) * (np.clip(fy - 0.55, 0, 1) * 0.6)[..., None] * (tile[..., None] > 0.1)
    alb *= (0.92 + 0.12 * fbm(n, 10, 3, rng))[..., None]
    return np.clip(alb, 0, 1), tile * 0.8 + 0.2 * cell

def tex_leaf(n, rng):
    f = fbm(n, 10, 5, rng)
    g = fbm(n, 28, 2, rng)
    a = np.array(hx('e5f0d4')); b = np.array(hx('b9d6b4')); c = np.array(hx('f8fbe9'))
    t = f[..., None]
    alb = a * (1 - t) + b * t
    s = np.clip((g - 0.6) * 3, 0, 1)[..., None]
    alb = alb * (1 - 0.6 * s) + c * 0.6 * s
    return np.clip(alb, 0, 1), 0.7 * f + 0.3 * g

TEXTURES = {'cliff': (tex_cliff, 512, 0.9, 2), 'ashlar': (tex_ashlar, 512, 0.7, 3), 'turf': (tex_turf, 512, 0.6, 4),
            'timber': (tex_timber, 256, 0.8, 5), 'roof': (tex_roof, 256, 1.6, 6), 'leaf': (tex_leaf, 256, 0.9, 7)}
MAT_SPECS = {
    'cliff': dict(tex='cliff', tile=4.0, rough=0.93),
    'ashlar': dict(tex='ashlar', tile=2.4, rough=0.85),
    'turf': dict(tex='turf', tile=3.0, rough=0.95),
    'timber': dict(tex='timber', tile=2.0, rough=0.8),
    'roof': dict(tex='roof', tile=1.6, rough=0.5),
    'leaf': dict(tex='leaf', tile=1.5, rough=0.85),
    'gold': dict(base=(0.95, 0.72, 0.28), metal=1.0, rough=0.3),
    'glow': dict(base=(0.6, 0.95, 0.92), emit=(0.35, 0.95, 0.88), emit_strength=3.0, rough=0.4),
    'water': dict(base=(0.45, 0.85, 0.88), rough=0.08, alpha=0.62, emit=(0.25, 0.7, 0.75), emit_strength=0.6),
    'cloud': dict(base=(1, 1, 1), rough=1.0),
    'petal': dict(base=(1, 1, 1), rough=0.7),
    'cloth': dict(base=(1, 1, 1), rough=0.9),
}
MATS = {}
IMAGES = {}

def make_textures():
    for name, (fn, n, tile, seed) in TEXTURES.items():
        rng = np.random.default_rng(seed)
        alb, h = fn(n, rng)
        nm = normal_from_height(h if n <= 256 else h, 3.0 if name != 'turf' else 1.6)
        # normal maps are stored at 256 px to keep the embedded footprint small
        if n > 256:
            step = n // 256
            nm = normal_from_height(h.reshape(256, step, 256, step).mean((1, 3)), 3.0 if name != 'turf' else 1.6)
        for kind, arr, cs in (('albedo', alb, 'sRGB'), ('normal', nm, 'Non-Color')):
            sz = arr.shape[0]
            img = bpy.data.images.new(f"tex_{name}_{kind}", sz, sz, alpha=False)
            img.colorspace_settings.name = cs
            data = np.power(np.clip(arr, 0, 1), 2.2).transpose(2, 0, 1) if kind == 'albedo' else arr.transpose(2, 0, 1)
            data = np.asarray(data)
            rgba = np.ones((sz, sz, 4), dtype=np.float32)
            rgba[..., :3] = np.transpose(data, (1, 2, 0))
            img.pixels.foreach_set(rgba.ravel())
            os.makedirs(TEX_DIR, exist_ok=True)
            img.filepath_raw = os.path.join(TEX_DIR, f"{name}_{kind}.png")
            img.file_format = 'PNG'
            img.save()
            img.pack()
            IMAGES[(name, kind)] = img

def make_materials():
    for name, sp in MAT_SPECS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        bsdf.inputs['Roughness'].default_value = sp.get('rough', 0.8)
        bsdf.inputs['Metallic'].default_value = sp.get('metal', 0.0)
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        if 'tex' in sp:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = IMAGES[(sp['tex'], 'albedo')]
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
            mx.inputs['Factor'].default_value = 1.0
            nt.links.new(t.outputs['Color'], mx.inputs['A'])
            nt.links.new(vc.outputs['Color'], mx.inputs['B'])
            nt.links.new(mx.outputs['Result'], bsdf.inputs['Base Color'])
            nimg = nt.nodes.new('ShaderNodeTexImage'); nimg.image = IMAGES[(sp['tex'], 'normal')]
            nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.8
            nt.links.new(nimg.outputs['Color'], nmap.inputs['Color'])
            nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        elif sp.get('metal'):
            bsdf.inputs['Base Color'].default_value = (*lin(sp['base']), 1)
        else:
            nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        if 'emit' in sp:
            bsdf.inputs['Emission Color'].default_value = (*lin(sp['emit']), 1)
            bsdf.inputs['Emission Strength'].default_value = sp['emit_strength']
            if 'tex' not in sp and not sp.get('metal'):
                pass
        if 'alpha' in sp:
            bsdf.inputs['Alpha'].default_value = sp['alpha']
            m.surface_render_method = 'BLENDED'
            m.blend_method = 'BLEND'
        m.use_backface_culling = True
        MATS[name] = m


# ---------------------------------------------------------------- geometry
MAT_ORDER = list(MAT_SPECS.keys())

class Asset:
    def __init__(s, name, tile_offset=None):
        s.name = name
        s.rng = random.Random(zlib.crc32(name.encode()))
        s.bm = bmesh.new()
        s.uv = s.bm.loops.layers.uv.new("UVMap")
        s.cl = s.bm.loops.layers.float_color.new("Col")
        s.used = []
        s.cache = {}
        s.stack = [Matrix.Identity(4)]
        s.off = (s.rng.random() * 8, s.rng.random() * 8)

    def mat_index(s, m):
        if m not in s.used:
            s.used.append(m)
        return s.used.index(m)

    @contextmanager
    def at(s, pos=(0, 0, 0), yaw=0.0, scale=1.0, pitch=0.0, roll=0.0):
        sc = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        M = (Matrix.Translation(Vector(pos)) @ Matrix.Rotation(math.radians(yaw), 4, 'Y')
             @ Matrix.Rotation(math.radians(pitch), 4, 'X') @ Matrix.Rotation(math.radians(roll), 4, 'Z')
             @ Matrix.Diagonal(Vector((*sc, 1.0))))
        s.stack.append(s.stack[-1] @ M)
        try:
            yield
        finally:
            s.stack.pop()

    def face(s, m, pts, col, smooth=False, out=None, double=False):
        M = s.stack[-1]
        L = [Vector(p) for p in pts]
        if out is not None:
            n = (L[1] - L[0]).cross(L[2] - L[0])
            if n.dot(Vector(out)) < 0:
                L.reverse()
        P = [M @ p for p in L]
        n = (P[1] - P[0]).cross(P[2] - P[0])
        if n.length < 1e-10:
            return
        n.normalize()
        mi = s.mat_index(m)
        spec = MAT_SPECS[m]
        tile = spec.get('tile', 2.0)
        ax = (abs(n.x), abs(n.y), abs(n.z))
        for pass_ in range(2 if double else 1):
            PP = P if pass_ == 0 else P[::-1]
            LL = L if pass_ == 0 else L[::-1]
            verts = []
            for p in PP:
                key = (mi, round(p.x, 4), round(p.y, 4), round(p.z, 4))
                if smooth and key in s.cache:
                    verts.append(s.cache[key])
                else:
                    v = s.bm.verts.new((p.x, -p.z, p.y))
                    verts.append(v)
                    if smooth:
                        s.cache[key] = v
            if len(set(verts)) != len(verts):
                continue
            try:
                f = s.bm.faces.new(verts)
            except ValueError:
                continue
            f.material_index = mi
            f.smooth = smooth
            for lp, p, l in zip(f.loops, PP, LL):
                if ax[1] >= ax[0] and ax[1] >= ax[2]:
                    u, v = p.x, p.z
                elif ax[0] >= ax[2]:
                    u, v = p.z, p.y
                else:
                    u, v = p.x, p.y
                lp[s.uv].uv = ((u + s.off[0]) / tile, (v + s.off[1]) / tile)
                c = col(l) if callable(col) else col
                lp[s.cl] = (*lin(c), 1.0)

    # --- primitives ------------------------------------------------------
    def box(s, m, c, sz, col, taper=1.0, smooth=False):
        cx, cy, cz = c; hx_, hy, hz = sz[0] / 2, sz[1] / 2, sz[2] / 2
        t = taper
        B = [Vector((cx - hx_, cy - hy, cz - hz)), Vector((cx + hx_, cy - hy, cz - hz)),
             Vector((cx + hx_, cy - hy, cz + hz)), Vector((cx - hx_, cy - hy, cz + hz))]
        T = [Vector((cx - hx_ * t, cy + hy, cz - hz * t)), Vector((cx + hx_ * t, cy + hy, cz - hz * t)),
             Vector((cx + hx_ * t, cy + hy, cz + hz * t)), Vector((cx - hx_ * t, cy + hy, cz + hz * t))]
        ctr = Vector(c)
        for i in range(4):
            j = (i + 1) % 4
            pts = [B[i], B[j], T[j], T[i]]
            s.face(m, pts, col, smooth, out=sum(pts, Vector()) / 4 - ctr)
        s.face(m, T, col, smooth, out=(0, 1, 0))
        s.face(m, B, col, smooth, out=(0, -1, 0))

    def loft(s, m, rings, col, smooth=False, cap_a=True, cap_b=True, closed=True):
        n = len(rings[0])
        cen = [sum(r, Vector()) / len(r) for r in rings]
        for k in range(len(rings) - 1):
            mid = (cen[k] + cen[k + 1]) / 2
            for i in range(n):
                j = (i + 1) % n
                if not closed and j == 0:
                    continue
                pts = [Vector(rings[k][i]), Vector(rings[k][j]), Vector(rings[k + 1][j]), Vector(rings[k + 1][i])]
                if (pts[0] - pts[3]).length < 1e-6:
                    pts = [pts[0], pts[1], pts[2]]
                elif (pts[1] - pts[2]).length < 1e-6:
                    pts = [pts[0], pts[1], pts[3]]
                s.face(m, pts, col, smooth, out=sum(pts, Vector()) / len(pts) - mid)
        if closed and cap_a:
            c0 = cen[0]
            for i in range(n):
                j = (i + 1) % n
                s.face(m, [c0, Vector(rings[0][i]), Vector(rings[0][j])], col, smooth, out=cen[0] - cen[1])
        if closed and cap_b:
            c1 = cen[-1]
            for i in range(n):
                j = (i + 1) % n
                s.face(m, [c1, Vector(rings[-1][i]), Vector(rings[-1][j])], col, smooth, out=cen[-1] - cen[-2])

    def ring(s, c, r, y, n, rot=0.0, rz=None):
        rz = r if rz is None else rz
        return [Vector((c[0] + r * math.cos(rot + 2 * math.pi * i / n), y, c[1] + rz * math.sin(rot + 2 * math.pi * i / n))) for i in range(n)]

    def column(s, m, c, y0, y1, r0, r1, sides, col, rot=0.0, caps=(True, True), smooth=False):
        s.loft(m, [s.ring(c, r0, y0, sides, rot), s.ring(c, max(r1, 1e-4), y1, sides, rot)], col, smooth, caps[0], caps[1])

    def tube(s, m, pts, radii, sides, col, smooth=True, cap_a=False, cap_b=True):
        pts = [Vector(p) for p in pts]
        rings = []
        ref = Vector((0, 0, 1))
        prev_u = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev_u is None:
                r0 = ref if abs(t.dot(ref)) < 0.9 else Vector((1, 0, 0))
                u = (r0 - t * r0.dot(t)).normalized()
            else:
                u = (prev_u - t * prev_u.dot(t)).normalized()
            w = t.cross(u)
            prev_u = u
            r = radii[i]
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
        s.loft(m, rings, col, smooth, cap_a, cap_b)

    def lump(s, m, c, radii, col, jit=0.15, sub=1, smooth=False, rng=None, squash_bottom=None):
        rng = rng or s.rng
        tb = bmesh.new()
        bmesh.ops.create_icosphere(tb, subdivisions=sub, radius=1.0)
        jitter = {v.index: 1.0 + jit * (rng.random() * 2 - 1) for v in tb.verts}
        tb.verts.ensure_lookup_table()
        cv = Vector(c)
        rx, ry, rz = radii if isinstance(radii, (tuple, list)) else (radii,) * 3
        for f in tb.faces:
            pts = []
            for v in f.verts:
                d = Vector(v.co)
                q = Vector((d.x * rx, d.y * ry, d.z * rz)) * jitter[v.index]
                if squash_bottom is not None and q.y < squash_bottom:
                    q.y = squash_bottom
                pts.append(cv + q)
            s.face(m, pts, col, smooth, out=sum(pts, Vector()) / 3 - cv)
        tb.free()

    def slab_poly(s, m, pts_xz, y0, y1, col, smooth=False):
        rt = [Vector((x, y1, z)) for x, z in pts_xz]
        rb = [Vector((x, y0, z)) for x, z in pts_xz]
        n = len(pts_xz)
        cen = sum(rt, Vector()) / n
        for i in range(n):
            j = (i + 1) % n
            quad = [rb[i], rb[j], rt[j], rt[i]]
            s.face(m, quad, col, smooth, out=sum(quad, Vector()) / 4 - (cen - Vector((0, (y1 - y0) / 2, 0))))
        for i in range(n):
            j = (i + 1) % n
            s.face(m, [cen, rt[i], rt[j]], col, smooth, out=(0, 1, 0))
            s.face(m, [rb[i], rb[j], Vector((cen.x, y0, cen.z))], col, smooth, out=(0, -1, 0))

    def bloom(s, c, r, col, centre_col=(0.95, 0.75, 0.25), petals=5, facing=(0, 1, 0), droop=0.3):
        f = Vector(facing).normalized()
        u = f.cross(Vector((0, 0, 1)))
        if u.length < 0.1:
            u = f.cross(Vector((1, 0, 0)))
        u.normalize(); w = f.cross(u)
        cc = Vector(c)
        for k in range(petals):
            a0 = 2 * math.pi * k / petals; a1 = 2 * math.pi * (k + 1) / petals; am = (a0 + a1) / 2
            d0 = u * math.cos(a0) + w * math.sin(a0); d1 = u * math.cos(a1) + w * math.sin(a1); dm = u * math.cos(am) + w * math.sin(am)
            p0 = cc + d0 * r * 0.55 + f * r * 0.15
            p1 = cc + d1 * r * 0.55 + f * r * 0.15
            tip = cc + dm * r - f * r * droop
            s.face('petal', [cc + f * r * 0.22, p0, tip, p1], col, out=f, double=True)
        s.lump('petal', cc + f * r * 0.2, r * 0.22, centre_col, jit=0.0, sub=1)

    def blade(s, m, base, tip, width, col, bend=None):
        b = Vector(base); t = Vector(tip)
        d = (t - b)
        side = d.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side = side.normalized() * width / 2
        mid = b + d * 0.5 + (Vector(bend) if bend else Vector())
        s.face(m, [b - side, b + side, mid + side * 0.6, mid - side * 0.6], col, double=True, out=None)
        s.face(m, [mid - side * 0.6, mid + side * 0.6, t], col, double=True)

    # --- finishing -----------------------------------------------------
    def finish(s):
        me = bpy.data.meshes.new(s.name)
        s.bm.to_mesh(me)
        s.bm.free()
        for mn in s.used:
            me.materials.append(MATS[mn])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = list(me.color_attributes.keys()).index('Col')
        ob = bpy.data.objects.new(s.name, me)
        return ob


def to_godot(v):
    return (v[0], v[2], -v[1])
