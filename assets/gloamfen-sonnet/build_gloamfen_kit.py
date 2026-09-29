"""Gloamfen environment kit builder (Blender 4.5.13, deterministic).

Run:  blender.exe --background --python build_gloamfen_kit.py [-- --no-render]
Everything is written next to this script (GLBs, placement.json, .blend, previews, HANDOFF.md).

Authoring space is Blender (x right, y forward, z up). GLB export uses +Y up, so an asset's
Blender (x, y, z) becomes game (x, z, -y). Placement positions/yaws are in GAME local
coordinates (metres, zone root); yaw_degrees is rotation about game +Y.
"""
import bpy, bmesh, math, random, json, os, sys, time
import numpy as np
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
NO_RENDER = "--no-render" in sys.argv
T0 = time.time()

BARK, MOSS, STONE, FOLIAGE, GLOW = 0, 1, 2, 3, 4
MAT_NAMES = ["gf_bark", "gf_moss_mud", "gf_stone", "gf_foliage", "gf_glow"]
CY, VI, AM, PG = 0, 1, 2, 3  # glow swatches: cyan, violet, amber, pale green


# ------------------------------------------------------------------ colour helpers
def srgb(h):
    h = h.lstrip("#")
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


class G:
    """Gradient along an axis (default z) between two hex colours."""
    def __init__(s, a, b, lo, hi, axis=2):
        s.a, s.b, s.lo, s.hi, s.axis = srgb(a), srgb(b), lo, hi, axis

    def __call__(s, co):
        t = max(0.0, min(1.0, (co[s.axis] - s.lo) / (s.hi - s.lo)))
        return tuple(s.a[i] * (1 - t) + s.b[i] * t for i in range(4))


# ------------------------------------------------------------------ textures / materials
def vnoise(rng, size, grid):
    g = rng.random((grid, grid))
    xs = np.linspace(0, grid, size, endpoint=False)
    i0 = np.floor(xs).astype(int)
    f = xs - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % grid
    gx = g[:, i0] * (1 - f) + g[:, i1] * f
    return gx[i0, :] * (1 - f)[:, None] + gx[i1, :] * f[:, None]


def fbm(rng, size, base, octaves=4):
    out = np.zeros((size, size)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        out += amp * vnoise(rng, size, base * 2 ** o); tot += amp; amp *= 0.5
    return out / tot


def make_textures():
    rng = np.random.default_rng(93)
    S = 128
    tex = {}
    # bark: vertical streaks + knots, near-grey (hue comes from vertex colour)
    n = vnoise(rng, S, 3)[:, :]
    st = np.repeat(vnoise(rng, S, 24)[:1, :], S, axis=0) * 0.5 + fbm(rng, S, 4) * 0.5
    v = 0.55 + 0.45 * st
    v[(fbm(rng, S, 10) > 0.62)] *= 0.7
    tex[BARK] = v
    # moss / mud: blotchy
    b = fbm(rng, S, 4, 5)
    tex[MOSS] = 0.6 + 0.4 * b
    # stone: blocky cells + speckle + cracks
    cell = np.kron(rng.random((8, 8)), np.ones((S // 8, S // 8)))
    sp = rng.random((S, S))
    v = 0.62 + 0.2 * cell + 0.1 * fbm(rng, S, 6) + 0.05 * sp
    v[::16, :] *= 0.72; v[:, ::16] *= 0.72
    tex[STONE] = v
    # foliage: soft leafy
    tex[FOLIAGE] = 0.66 + 0.34 * fbm(rng, S, 8, 4)
    imgs = {}
    for k, v in tex.items():
        v = np.clip(v, 0, 1)
        rgba = np.dstack([v, v, v, np.ones_like(v)]).astype(np.float32)
        img = bpy.data.images.new(f"{MAT_NAMES[k]}_albedo", S, S, alpha=False)
        img.pixels.foreach_set(rgba.ravel()); img.pack(); imgs[k] = img
    sw = np.array([(0.32, 0.95, 0.85), (0.72, 0.5, 1.0), (1.0, 0.68, 0.28), (0.66, 1.0, 0.55)])
    row = np.repeat(sw, 16, axis=0)  # 64 wide
    rgba = np.zeros((8, 64, 4), np.float32); rgba[:, :, :3] = row[None]; rgba[:, :, 3] = 1
    img = bpy.data.images.new("gf_glow_swatches", 64, 8, alpha=False)
    img.pixels.foreach_set(rgba.ravel()); img.pack(); imgs[GLOW] = img
    return imgs


def make_materials():
    imgs = make_textures()
    mats = []
    spec = {BARK: 0.95, MOSS: 0.9, STONE: 0.8, FOLIAGE: 0.85, GLOW: 0.5}
    for k, name in enumerate(MAT_NAMES):
        m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
        ti = nt.nodes.new("ShaderNodeTexImage"); ti.image = imgs[k]
        bs.inputs["Roughness"].default_value = spec[k]
        bs.inputs["Specular IOR Level"].default_value = 0.15
        nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
        if k == GLOW:
            ti.interpolation = "Closest"
            nt.links.new(ti.outputs["Color"], bs.inputs["Base Color"])
            nt.links.new(ti.outputs["Color"], bs.inputs["Emission Color"])
            bs.inputs["Emission Strength"].default_value = 1.0
        else:
            va = nt.nodes.new("ShaderNodeVertexColor"); va.layer_name = "Col"
            mx = nt.nodes.new("ShaderNodeMixRGB"); mx.blend_type = "MULTIPLY"
            mx.inputs["Fac"].default_value = 1.0
            nt.links.new(ti.outputs["Color"], mx.inputs["Color1"])
            nt.links.new(va.outputs["Color"], mx.inputs["Color2"])
            nt.links.new(mx.outputs["Color"], bs.inputs["Base Color"])
        mats.append(m)
    return mats


# ------------------------------------------------------------------ mesh builder
class MB:
    def __init__(s, seed):
        s.bm = bmesh.new(); s.rng = random.Random(seed)
        s.lcol = s.bm.verts.layers.float_vector.new("vc"); s.lsw = s.bm.verts.layers.int.new("sw")

    def R(s, a=0.0, b=1.0):
        return a + (b - a) * s.rng.random()

    def _fin(s, verts, col, mat, sw=0, closed=True, jit=0.05):
        faces = {f for v in verts for f in v.link_faces}
        if closed:
            bmesh.ops.recalc_face_normals(s.bm, faces=list(faces))
        for f in faces:
            f.material_index = mat
        for v in verts:
            if mat == GLOW:
                v[s.lcol] = Vector((1, 1, 1)); v[s.lsw] = sw
            else:
                c = col(v.co) if callable(col) else col
                j = 1 + (s.rng.random() - 0.5) * 2 * jit
                v[s.lcol] = Vector((c[0] * j, c[1] * j, c[2] * j))

    def blob(s, c, radii, sub=2, noise=0.14, col=None, mat=FOLIAGE, rot=0.0, tilt=(0, 0), sw=0):
        r = bmesh.ops.create_icosphere(s.bm, subdivisions=sub, radius=1.0)
        vs = r["verts"]
        eu = Euler((tilt[0], tilt[1], rot))
        rx = radii if not isinstance(radii, (int, float)) else (radii,) * 3
        for v in vs:
            k = 1 + noise * (s.rng.random() * 2 - 1)
            p = Vector((v.co.x * rx[0] * k, v.co.y * rx[1] * k, v.co.z * rx[2] * k))
            p.rotate(eu)
            v.co = p + Vector(c)
        s._fin(vs, col, mat, sw)
        return vs

    def slab(s, c, size, rot=0.0, tilt=(0, 0), jit=0.05, taper=1.0, col=None, mat=STONE, sw=0):
        r = bmesh.ops.create_cube(s.bm, size=1.0)
        vs = r["verts"]
        eu = Euler((tilt[0], tilt[1], rot))
        for v in vs:
            top = v.co.z > 0
            sx = taper if top else 1.0
            p = Vector((v.co.x * size[0] * sx, v.co.y * size[1] * sx, v.co.z * size[2]))
            if jit:
                p += Vector((s.R(-jit, jit) * size[0], s.R(-jit, jit) * size[1], s.R(-jit, jit) * size[2]))
            p.rotate(eu)
            v.co = p + Vector(c)
        s._fin(vs, col, mat, sw)
        return vs

    def tube(s, pts, radii, sides=6, col=None, mat=BARK, caps=(True, True), squash=1.0,
             jit=0.0, rot0=0.0, sw=0, jit_col=0.05):
        bm = s.bm
        pts = [Vector(p) for p in pts]; n = len(pts)
        T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
        ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
        nrm = (ref - T[0] * ref.dot(T[0])).normalized()
        rings = []; allv = []
        for i in range(n):
            if i > 0:
                nrm = nrm - T[i] * nrm.dot(T[i])
                nrm = T[i].orthogonal() if nrm.length < 1e-6 else nrm
                nrm.normalize()
            bn = T[i].cross(nrm)
            r = radii[i]
            if i == n - 1 and r <= 1e-4:
                v = bm.verts.new(pts[i]); rings.append([v]); allv.append(v); continue
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides + rot0
                off = nrm * math.cos(a) * r + bn * math.sin(a) * r * squash
                if jit:
                    off *= 1 + (s.rng.random() - 0.5) * jit
                ring.append(bm.verts.new(pts[i] + off))
            rings.append(ring); allv += ring
        for i in range(n - 1):
            A, B = rings[i], rings[i + 1]
            for k in range(sides):
                k2 = (k + 1) % sides
                if len(B) == 1:
                    bm.faces.new((A[k], A[k2], B[0]))
                else:
                    bm.faces.new((A[k], A[k2], B[k2], B[k]))
        if caps[0] and len(rings[0]) > 2:
            bm.faces.new(rings[0])
        if caps[1] and len(rings[-1]) > 2:
            bm.faces.new(rings[-1])
        s._fin(allv, col, mat, sw, jit=jit_col)
        return allv

    def flat_poly(s, center, ring_specs, cols, mat=MOSS):
        """Open, upward-facing disc: ring_specs = [(radii_list_per_angle)], first ring may be a point."""
        bm = s.bm
        cv = bm.verts.new(center); allv = [cv]
        rings = []
        for spec in ring_specs:
            ring = [bm.verts.new((center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, center[2])) for a, r in spec]
            rings.append(ring); allv += ring
        n = len(rings[0])
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((cv, rings[0][k], rings[0][k2])[::-1])
        for i in range(len(rings) - 1):
            for k in range(n):
                k2 = (k + 1) % n
                bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2])[::-1])
        for f in {f for v in allv for f in v.link_faces}:
            f.material_index = mat
        # winding check: make sure normals face +z
        for f in {f for v in allv for f in v.link_faces}:
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
        for v in allv:
            c = cols(v.co) if callable(cols) else cols
            v[s.lcol] = Vector(c[:3]); v[s.lsw] = 0
        return allv

    def build(s, name, mats):
        bm = s.bm
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        cl = bm.loops.layers.float_color.new("Col")
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            nx, ny, nz = abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)
            for l in f.loops:
                v = l.vert; co = v.co
                c3 = v[s.lcol]
                l[cl] = (c3[0], c3[1], c3[2], 1.0)
                if f.material_index == GLOW:
                    l[uv].uv = ((v[s.lsw] + 0.5) / 4.0, 0.5)
                elif nz >= nx and nz >= ny:
                    l[uv].uv = (co.x * 0.4, co.y * 0.4)
                elif nx >= ny:
                    l[uv].uv = (co.y * 0.4, co.z * 0.4)
                else:
                    l[uv].uv = (co.x * 0.4, co.z * 0.4)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for m in mats:
            me.materials.append(m)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = 0
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        me.update()
        ob = bpy.data.objects.new(name, me)
        return ob


# ------------------------------------------------------------------ shared pieces
BARK_D = G("#2a2f2b", "#5b5347", 0, 6)          # cool wet trunk
BARK_ROOT = G("#2a2a25", "#4e4a3c", -0.2, 1.2)
WOOD_W = srgb("#9a7550")                        # warm boardwalk plank
WOOD_W2 = srgb("#82603f")
WOOD_DARK = srgb("#4a3626")
MOSS_TOP = srgb("#6f9a52")
MOSS_MID = srgb("#4d6b45")
MUD_DK = srgb("#2f3d38")
STONE_P = G("#7f8f88", "#c4d0c0", 0, 3)         # pale stone catches fairy light
STONE_D = srgb("#5c6d6a")
LEAF = G("#22443f", "#6fa585", 0, 1)


def curtains(mb, rng, centers_r, z_start, n, z_floor, glow_frac=0.22, seed_ang=0.0, span=None, cx=0.0, cy=0.0):
    """Hanging root strands starting on a ring (cx,cy,radius) at z_start; end no lower than z_floor."""
    for i in range(n):
        a = seed_ang + 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
        rr = centers_r * rng.uniform(0.55, 1.0)
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.8
        zs = z_start(x, y) if callable(z_start) else z_start
        L = min(rng.uniform(1.4, 3.0), zs - z_floor)
        if L < 0.6:
            continue
        sway = rng.uniform(-0.25, 0.25)
        pts = [(x + sway * t * t, y + sway * 0.6 * t, zs - L * t) for t in (0, 0.35, 0.7, 1.0)]
        mb.tube(pts, [0.06, 0.05, 0.035, 0.0], sides=3, col=G("#4a3d2e", "#2f5049", zs - L, zs), mat=BARK,
                caps=(False, False), jit_col=0.1)
        if rng.random() < glow_frac:
            mb.blob(pts[-1], 0.085, sub=1, noise=0.0, mat=GLOW, sw=rng.choice([CY, CY, PG, AM]))


def buttress_roots(mb, rng, n, r_trunk, size, cx=0.0, cy=0.0, base_z=1.0, a0=0.0, out_bias=None):
    for k in range(n):
        a = a0 + 2 * math.pi * (k + rng.uniform(-0.2, 0.2)) / n
        dx, dy = math.cos(a), math.sin(a)
        L = size * rng.uniform(1.2, 1.9)
        w = size * rng.uniform(0.28, 0.38)
        sw = rng.uniform(-0.3, 0.3)
        px = lambda d: (cx + dx * d - dy * sw * d * 0.4, cy + dy * d + dx * sw * d * 0.4)
        pts = [(*px(r_trunk * 0.5), base_z), (*px(r_trunk * 0.9 + L * 0.25), base_z * 0.55),
               (*px(r_trunk + L * 0.6), base_z * 0.16), (*px(r_trunk + L), -0.15)]
        mb.tube(pts, [w, w * 0.78, w * 0.5, w * 0.2], sides=5, col=BARK_ROOT, mat=BARK, jit=0.2)


def bracket(mb, x, y, z, r, sw=VI, rot=0.0):
    mb.blob((x, y, z), (r, r, r * 0.22), sub=1, noise=0.08, mat=GLOW, sw=sw, rot=rot)


def moss_cap(mb, c, r, sub=1):
    mb.blob(c, (r, r * 0.9, r * 0.32), sub=sub, noise=0.15, col=G("#557c47", "#7fa85a", c[2] - 0.1, c[2] + 0.3), mat=MOSS)


# ------------------------------------------------------------------ assets
def a_fen_tree(mb, variant):
    rng = mb.rng
    h = {"a": 5.6, "b": 6.6}[variant]
    lean = {"a": 1.5, "b": 2.2}[variant]
    tr = {"a": 0.5, "b": 0.42}[variant]
    ph = rng.uniform(0, 6)
    pts, rad = [], []
    N = 9
    for i in range(N):
        t = i / (N - 1)
        pts.append((lean * t ** 1.7 + 0.28 * math.sin(t * 5 + ph), 0.32 * math.sin(t * 4 + ph * 1.3), h * t - 0.1))
        rad.append(tr * (1 - 0.68 * t) * (1 + 0.8 * max(0, 1 - t * 4.5) ** 2))
    mb.tube(pts, rad, sides=7, col=BARK_D, mat=BARK, jit=0.12)
    buttress_roots(mb, rng, 6, tr, tr * 1.6, base_z=1.0, a0=ph)
    # limbs to canopy
    top = Vector(pts[-1])
    cbl = []
    for k, a in enumerate((0.3, 2.4, 4.3)):
        t = rng.uniform(0.52, 0.72)
        i = int(t * (N - 1)); p0 = Vector(pts[i])
        ext = rng.uniform(1.5, 2.1)
        p2 = Vector((top.x + math.cos(a) * ext, top.y + math.sin(a) * ext, top.z + rng.uniform(-0.5, 0.2)))
        p1 = (p0 + p2) * 0.5 + Vector((0, 0, 0.5))
        mb.tube([p0, p1, p2], [rad[i] * 0.55, rad[i] * 0.4, rad[i] * 0.22], sides=5, col=BARK_D, mat=BARK, jit=0.15)
        cbl.append(p2)
    # canopy: layered flattened domes (willow-like drape)
    cz = top.z + 0.2
    blobs = [(top.x, top.y, cz + 0.5, 2.2, 0.85)]
    for p in cbl:
        blobs.append((p.x, p.y, p.z + 0.35, rng.uniform(1.6, 2.0), 0.7))
    blobs.append((top.x + rng.uniform(-1, 1), top.y + rng.uniform(-1, 1), cz + 1.35, 1.4, 0.8))
    for (x, y, z, r, zf) in blobs:
        mb.blob((x, y, z), (r, r * 0.92, r * zf * 0.62), sub=2, noise=0.16, col=G("#1f3f3b", "#71a888", z - r * 0.5, z + r * 0.45),
                mat=FOLIAGE, rot=rng.uniform(0, 3))
    curtains(mb, rng, 2.0, cz - 0.15, 11, 2.3, cx=top.x, cy=top.y, seed_ang=ph)
    # shelf fungi on trunk
    for k in range(3):
        t = 0.16 + k * 0.13 + rng.uniform(0, 0.05); i = int(t * (N - 1)); p = pts[i]
        a = ph + k * 2.1
        r = rad[i]
        bracket(mb, p[0] + math.cos(a) * r * 0.95, p[1] + math.sin(a) * r * 0.95, p[2] + 0.2, rng.uniform(0.22, 0.34),
                sw=(VI, CY, VI)[k], rot=a)
    moss_cap(mb, (pts[0][0] + 0.2, pts[0][1] - 0.2, 0.05), 0.9)


def a_fen_tree_dead(mb):
    rng = mb.rng
    N = 7
    pts = [(0.35 * math.sin(i * 1.3), 0.25 * math.sin(i * 0.9 + 1), 4.2 * i / (N - 1) - 0.1) for i in range(N)]
    rad = [0.42 * (1 - 0.7 * i / (N - 1)) * (1 + 0.7 * max(0, 1 - i / 1.4) ** 2) for i in range(N)]
    mb.tube(pts, rad, sides=6, col=G("#3b3a34", "#75736a", 0, 4.4), mat=BARK, jit=0.18)
    buttress_roots(mb, rng, 5, 0.42, 0.55, base_z=0.8)
    for k, (t, a, ln) in enumerate([(0.5, 0.4, 1.7), (0.68, 2.6, 1.5), (0.82, 4.6, 1.2)]):
        i = int(t * (N - 1)); p0 = Vector(pts[i])
        d = Vector((math.cos(a), math.sin(a), 0.0))
        p1 = p0 + d * ln * 0.5 + Vector((0, 0, 0.5)); p2 = p0 + d * ln + Vector((0, 0, 0.8 + 0.3 * k))
        p3 = p2 + d * 0.5 + Vector((0, 0, 0.3))
        mb.tube([p0, p1, p2, p3], [rad[i] * 0.4, rad[i] * 0.3, rad[i] * 0.18, 0.0], sides=4,
                col=G("#3b3a34", "#75736a", 0, 6), mat=BARK, jit=0.2)
    for k in range(3):
        a = k * 2.2 + 0.5
        bracket(mb, 0.3 * math.cos(a) + pts[2][0], 0.3 * math.sin(a), 1.0 + k * 0.6, 0.24, sw=(AM, CY, PG)[k], rot=a)
    curtains(mb, rng, 0.6, 3.6, 4, 1.6, glow_frac=0.5, cx=pts[-2][0], cy=pts[-2][1])
    moss_cap(mb, (0.1, 0.1, 0.05), 0.85)


def a_heart_arch_tree(mb):
    rng = mb.rng
    H = 10.0; SPAN = 4.8
    apex = None
    for side in (-1, 1):
        pts, rad = [], []
        N = 15
        ph = 0.9 if side < 0 else 3.4
        for i in range(N):
            s = i / (N - 1)
            x = side * SPAN * (1 - s ** 1.9) + 0.32 * math.sin(s * 9 + ph) * (1 - s * 0.3)
            y = 0.55 * math.sin(s * 6.3 + ph) * (1 - s * 0.5)
            z = H * s ** 0.9 - 0.2
            pts.append((x, y, z))
            rad.append((1.2 * (1 - 0.6 * s)) * (1 + 0.95 * max(0, 1 - s * 4.5) ** 2))
        mb.tube(pts, rad, sides=8, col=BARK_D, mat=BARK, jit=0.12)
        # rope-like coil vine wrapping the trunk (readable twist silhouette)
        cp, cr = [], []
        for i in range(N):
            s = i / (N - 1); p = Vector(pts[i]); a = s * 9.5 + ph
            off = rad[i] * 0.85
            cp.append((p.x + math.cos(a) * off, p.y + math.sin(a) * off, p.z))
            cr.append(0.2 * (1 - 0.6 * s))
        mb.tube(cp, cr, sides=5, col=G("#3a4434", "#5f7a4e", 0, 10), mat=BARK, jit=0.2)
        buttress_roots(mb, rng, 5, rad[0] * 0.9, 1.35, cx=pts[0][0], cy=pts[0][1], base_z=1.6,
                       a0=(0.0 if side > 0 else math.pi) + 0.6)
        moss_cap(mb, (pts[0][0], pts[0][1], 0.05), 2.3)
        moss_cap(mb, (pts[0][0] + side * 0.7, pts[0][1] - 0.8, 0.9), 1.0)
        # stair of glow brackets up the trunk
        for k in range(6):
            i = 2 + k * 1; p = pts[i]; a = math.pi * 0.5 + k * 1.3 * side
            r = rad[i]
            bracket(mb, p[0] + math.cos(a) * r * 0.95, p[1] + math.sin(a) * r * 0.95 - 0.05, p[2] + 0.1,
                    rng.uniform(0.3, 0.5), sw=(CY, VI, CY, AM, VI, CY)[k], rot=a)
        apex = Vector(pts[-1])
    # crown knot + canopy
    mb.blob((0, 0, H - 0.3), (1.6, 1.1, 1.0), sub=2, noise=0.2, col=BARK_D, mat=BARK)
    for k in range(11):
        a = 2 * math.pi * k / 11 + rng.uniform(-0.2, 0.2)
        rr = rng.uniform(4.2, 7.0)
        x, y = math.cos(a) * rr * 1.25, math.sin(a) * rr * 0.75
        z = H + rng.uniform(-0.6, 1.6)
        r = rng.uniform(2.6, 3.6)
        mb.blob((x, y, z), (r, r * 0.9, r * 0.5), sub=2, noise=0.16, col=G("#1c3936", "#6ea184", z - 1.6, z + 1.6),
                mat=FOLIAGE, rot=rng.uniform(0, 3))
    mb.blob((0, 0, H + 1.6), (3.4, 2.6, 1.7), sub=2, noise=0.15, col=G("#20403b", "#78ae8b", H, H + 3), mat=FOLIAGE)
    # hanging roots: keep the corridor (|x|<3.5) high so it never reads as a wall
    curtains(mb, rng, 6.0, lambda x, y: H + 0.4 - 0.1 * abs(x), 24, 5.0, cx=0, cy=0, seed_ang=0.3, glow_frac=0.45)
    # the heart: glowing bulb in a root cage, hung from the crown
    zc = 6.9
    mb.blob((0, 0.1, zc), 0.6, sub=2, noise=0.02, mat=GLOW, sw=CY)
    for k in range(2):
        ring = []
        for j in range(17):
            a = 2 * math.pi * j / 16
            p = Vector((math.cos(a) * 1.05, math.sin(a) * 1.05, 0.0))
            p.rotate(Euler((0.55 if k else -0.55, 0.9 * k, 0.0)))
            ring.append((p.x, p.y + 0.1, p.z + zc))
        mb.tube(ring, [0.05] * 17, sides=4, col=BARK_D, mat=BARK, caps=(False, False))
    for k in range(3):
        a = k * 2.09 + 0.3
        mb.tube([(0, 0.1, zc + 0.8), (math.cos(a) * 0.4, math.sin(a) * 0.4 + 0.1, zc + 2.4), (0, 0, H - 0.8)],
                [0.04, 0.05, 0.08], sides=4, col=BARK_D, mat=BARK, caps=(False, False))


def a_ruin_gate(mb):
    rng = mb.rng
    X = 4.2
    hts = {-1: 3.9, 1: 2.7}
    for side in (-1, 1):
        # plinth + stacked drums
        mb.slab((side * X, 0, 0.18), (1.9, 1.9, 0.36), rot=rng.uniform(-0.1, 0.1), jit=0.03, col=STONE_D)
        z = 0.36; ht = hts[side]
        while z < ht - 0.3:
            hh = rng.uniform(0.7, 0.95)
            mb.slab((side * X + rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), z + hh / 2), (1.15, 1.15, hh),
                    rot=rng.uniform(-0.3, 0.3), jit=0.035, col=STONE_P, taper=0.97)
            z += hh
        # jagged broken top
        mb.blob((side * X, 0, z + 0.05), (0.62, 0.6, 0.35), sub=1, noise=0.22, col=STONE_P, mat=STONE)
        moss_cap(mb, (side * X, 0, z + 0.3), 0.55)
        # arch springers follow the ellipse tangent; each side springs from its own pillar top
        zc = hts[side] - 0.3
        Rr = X
        n_ = 8 if side < 0 else 3
        for k in range(n_):
            ang = math.radians(6 + k * (9.5 if side < 0 else 8.5))
            px = side * Rr * math.cos(ang)
            pz = zc + Rr * math.sin(ang) * 0.62
            tx, tz = math.sin(ang), (0.62 * math.cos(ang)) * (1 if side < 0 else -1)
            beta = -math.atan2(tz, tx)
            mb.slab((px, rng.uniform(-0.04, 0.04), pz), (0.95, 1.0, 0.55), tilt=(0, beta), jit=0.04, col=STONE_P)
    # fallen keystone + blocks on the flanks (never in the route)
    mb.slab((-5.9, -0.8, 0.35), (1.6, 1.0, 0.7), rot=0.5, tilt=(0.1, 0.05), jit=0.05, col=STONE_P)
    mb.slab((6.0, 0.9, 0.3), (1.3, 0.9, 0.6), rot=-0.4, tilt=(0.05, -0.1), jit=0.05, col=STONE_D)
    mb.slab((5.4, -0.6, 0.15), (0.9, 0.7, 0.3), rot=1.1, jit=0.05, col=STONE_P)
    for c in ((-5.9, -0.8, 0.75), (6.0, 0.9, 0.62)):
        moss_cap(mb, c, 0.6)
    # roots drooping over the higher pillar, glow moss at the foot
    for k in range(3):
        x0 = -X + rng.uniform(-0.5, 0.6)
        mb.tube([(x0, -0.5, 3.8), (x0 + 0.1, -0.7, 2.6), (x0 - 0.1, -0.6, 1.5), (x0 + 0.05, -0.55, 0.3)],
                [0.11, 0.09, 0.07, 0.03], sides=4, col=G("#3c352b", "#516a48", 0, 4), mat=BARK, jit=0.25)
    for k in range(4):
        a = k * 1.7
        bracket(mb, -X + math.cos(a) * 0.62, -0.62 + math.sin(a) * 0.1, 0.5 + k * 0.28, 0.16, sw=(CY, PG, CY, AM)[k], rot=a)
    bracket(mb, X + 0.55, -0.4, 0.5, 0.2, sw=CY)
    curtains(mb, rng, 0.9, 3.4, 5, 2.4, cx=-3.0, cy=0.0, glow_frac=0.6)


def a_ruin_pillar(mb, variant):
    rng = mb.rng
    hh = {"a": 2.2, "b": 1.3}[variant]
    mb.slab((0, 0, 0.15), (1.5, 1.5, 0.3), rot=rng.uniform(-0.2, 0.2), jit=0.04, col=STONE_D)
    z = 0.3
    while z < hh:
        d = rng.uniform(0.55, 0.8)
        mb.tube([(rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z), (0, 0, z + d)], [0.5, 0.5],
                sides=8, col=STONE_P, mat=STONE, jit=0.06, rot0=rng.uniform(0, 1))
        z += d
    mb.blob((0, 0, z + 0.05), (0.5, 0.5, 0.26), sub=1, noise=0.3, col=STONE_P, mat=STONE)
    mb.slab((0.95, 0.4, 0.25), (0.7, 0.6, 0.5), rot=0.7, tilt=(0.1, 0.1), col=STONE_D)
    mb.tube([(0.5, 0.1, 0.3), (0.55, -0.35, 0.9), (-0.4, -0.5, 1.4), (-0.6, 0.1, 1.0)], [0.07, 0.06, 0.05, 0.02], sides=4,
            col=G("#3c352b", "#5b7a4c", 0, 1.6), mat=BARK, caps=(False, False), jit=0.2)
    moss_cap(mb, (0.15, 0.0, z + 0.22), 0.5)
    bracket(mb, 0.5, -0.1, 0.65, 0.17, sw=CY)


def a_ruin_block_pile(mb):
    rng = mb.rng
    for i, (x, y, z, sz, col) in enumerate([(0, 0, 0.3, (1.3, 1.0, 0.6), STONE_P), (1.0, 0.5, 0.25, (1.0, 0.8, 0.5), STONE_D),
                                             (-0.7, -0.6, 0.22, (0.9, 0.9, 0.45), STONE_P), (0.2, 0.15, 0.78, (0.9, 0.7, 0.42), STONE_P),
                                             (-1.1, 0.5, 0.15, (0.6, 0.5, 0.3), STONE_D)]):
        mb.slab((x, y, z), sz, rot=rng.uniform(0, 3), tilt=(rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12)), jit=0.06, col=col)
    moss_cap(mb, (0.2, 0.15, 1.0), 0.65)
    moss_cap(mb, (-0.7, -0.6, 0.46), 0.5)
    bracket(mb, 1.05, -0.05, 0.3, 0.15, sw=PG)


def a_standing_stone(mb, variant):
    rng = mb.rng
    hh = {"a": 2.6, "b": 1.9}[variant]
    mb.slab((0, 0, hh / 2 - 0.1), (0.95, 0.65, hh), rot=0.0, tilt=(0.04, 0.05 if variant == "a" else -0.07), jit=0.07,
            taper=0.62, col=STONE_P)
    mb.blob((0, 0, 0.1), (0.85, 0.7, 0.2), sub=1, noise=0.25, col=STONE_D, mat=STONE)
    moss_cap(mb, (0.05, 0.05, hh - 0.35), 0.4)
    # restrained rune bars on the route-facing side (-y)
    for k in range(3):
        w = (0.28, 0.16, 0.22)[k]
        mb.slab((0.0, -0.36 + 0.02 * k * 0, 0.7 + k * 0.42), (w, 0.03, 0.06), jit=0.0, mat=GLOW, sw=CY)
    mb.slab((0, -0.365, 1.05), (0.05, 0.03, 0.9), jit=0.0, mat=GLOW, sw=CY)


def a_pale_stone(mb, variant):
    rng = mb.rng
    n = 10 if variant == "a" else 9
    sx, sy = (1.0, 1.0) if variant == "a" else (1.15, 0.72)
    ring = [rng.uniform(0.82, 1.08) for _ in range(n)]
    for zz, sc in ((0.0, 1.0), (0.13, 0.9)):
        pass
    pts = []
    for zz, sc in ((0.0, 1.0), (0.12, 0.92)):
        pts.append([(math.cos(2 * math.pi * k / n) * ring[k] * sx * sc, math.sin(2 * math.pi * k / n) * ring[k] * sy * sc, zz)
                    for k in range(n)])
    bm = mb.bm
    rings = [[bm.verts.new(p) for p in ringp] for ringp in pts]
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]))
    bm.faces.new(rings[1])
    bm.faces.new(rings[0])
    vs = rings[0] + rings[1]
    mb._fin(vs, G("#98a89c", "#d6e2d2", 0.0, 0.13), STONE, jit=0.06)
    if variant == "b":
        mb.slab((0.1, 0, 0.125), (0.5, 0.05, 0.02), jit=0.0, mat=GLOW, sw=CY)
    else:
        mb.blob((0.6, 0.35, 0.09), (0.28, 0.22, 0.09), sub=1, noise=0.1, col=MOSS_TOP, mat=MOSS)


def a_boardwalk_slab(mb):
    rng = mb.rng
    W, Ln, top = 4.3, 2.8, 0.33
    n = 7
    pw = Ln / n
    for i in range(n):
        y = -Ln / 2 + pw * (i + 0.5)
        c = WOOD_W if i % 2 == 0 else WOOD_W2
        mb.slab((rng.uniform(-0.04, 0.04), y, top - 0.05), (W + rng.uniform(-0.08, 0.05), pw - 0.05, 0.1),
                rot=rng.uniform(-0.012, 0.012), jit=0.008, col=c)
    for sx in (-1.55, 1.55):
        mb.slab((sx, 0, 0.16), (0.24, Ln + 0.3, 0.16), jit=0.01, col=WOOD_DARK)
    for sx, sy in ((-1.9, -1.15), (1.9, -1.15), (-1.9, 1.15), (1.9, 1.15)):
        mb.tube([(sx, sy, -0.6), (sx, sy, 0.86)], [0.13, 0.11], sides=6, col=G("#3a3126", "#7d6448", -0.6, 0.9), mat=BARK, jit=0.12)
        mb.blob((sx, sy, 0.9), (0.15, 0.15, 0.1), sub=1, noise=0.1, col=WOOD_W, mat=BARK)
    # rope rails with a sag
    for sx in (-1.9, 1.9):
        pts = [(sx, -1.15 + 2.3 * t, 0.74 - 0.14 * 4 * t * (1 - t)) for t in (0, 0.25, 0.5, 0.75, 1.0)]
        mb.tube(pts, [0.035] * 5, sides=4, col=srgb("#a08a63"), mat=BARK, caps=(False, False))
    # moss on plank ends + a glow fungus at a corner
    for k in range(4):
        sx = (-1, 1)[k % 2]
        mb.blob((sx * 2.12, rng.uniform(-1.2, 1.2), top - 0.02), (0.32, 0.28, 0.06), sub=1, noise=0.15, col=MOSS_TOP, mat=MOSS)
    bracket(mb, -1.7, 1.05, 0.1, 0.16, sw=CY)


def a_boardwalk_link(mb):
    rng = mb.rng
    W, Ln, top = 4.3, 1.5, 0.30
    for i in range(4):
        y = -Ln / 2 + Ln / 4 * (i + 0.5)
        mb.slab((rng.uniform(-0.05, 0.05), y, top - 0.045), (W - 0.15, Ln / 4 - 0.05, 0.09), rot=rng.uniform(-0.02, 0.02), jit=0.01,
                col=WOOD_W2 if i % 2 else WOOD_W)
    for sx in (-1.5, 1.5):
        mb.slab((sx, 0, 0.14), (0.22, Ln + 0.5, 0.14), jit=0.01, col=WOOD_DARK)
    mb.slab((0.5, 0.2, 0.06), (0.9, 0.6, 0.06), col=MOSS_MID, mat=MOSS, jit=0.1)


def a_lantern_post(mb):
    rng = mb.rng
    mb.slab((0, 0, 0.1), (0.85, 0.8, 0.2), rot=0.4, jit=0.06, col=STONE_D)
    mb.slab((0.25, 0.2, 0.18), (0.4, 0.35, 0.3), rot=1.0, jit=0.06, col=STONE_P)
    pts = [(0, 0, 0.1), (0.06, 0.03, 0.9), (-0.03, 0.05, 1.7), (0.05, 0, 2.45)]
    mb.tube(pts, [0.13, 0.11, 0.1, 0.085], sides=6, col=G("#3a3126", "#7d6448", 0, 2.5), mat=BARK, jit=0.12)
    mb.tube([(0.05, 0, 2.3), (0.35, 0, 2.55), (0.75, 0, 2.5)], [0.05, 0.045, 0.04], sides=4, col=WOOD_DARK, mat=BARK, caps=(False, True))
    mb.tube([(0.7, 0, 2.5), (0.7, 0, 2.3)], [0.015, 0.015], sides=3, col=WOOD_DARK, mat=BARK)
    mb.blob((0.7, 0, 2.1), (0.15, 0.15, 0.2), sub=2, noise=0.03, mat=GLOW, sw=AM)
    mb.blob((0.7, 0, 2.32), (0.11, 0.11, 0.05), sub=1, noise=0.0, col=WOOD_DARK, mat=BARK)
    moss_cap(mb, (0.0, -0.05, 0.28), 0.45)
    bracket(mb, 0.14, -0.05, 1.0, 0.13, sw=CY, rot=0.3)


def a_root_curtain(mb):
    rng = mb.rng
    mb.tube([(-0.9, 0, 0.05), (0, 0, 0.15), (0.9, 0, 0.05)], [0.07, 0.09, 0.07], sides=5, col=BARK_D, mat=BARK)
    for i in range(9):
        x = -0.9 + 1.8 * i / 8 + rng.uniform(-0.08, 0.08)
        L = rng.uniform(1.6, 3.0)
        s = rng.uniform(-0.25, 0.25)
        pts = [(x + s * t * t, rng.uniform(-0.05, 0.05), -L * t) for t in (0, 0.35, 0.7, 1.0)]
        mb.tube(pts, [0.06, 0.05, 0.035, 0.0], sides=3, col=G("#4a3d2e", "#2f5049", -L, 0), mat=BARK, caps=(False, False), jit_col=0.1)
        if i % 3 == 1:
            mb.blob(pts[-1], 0.09, sub=1, noise=0.0, mat=GLOW, sw=(CY, PG, VI)[i % 3])


def a_mud_bank(mb, variant):
    rng = mb.rng
    L, curve = {"a": (7.0, 0.0), "b": (5.0, 1.1), "c": (3.4, 0.0)}[variant]
    nseg = {"a": 4, "b": 3, "c": 2}[variant]
    layers = [(0.42, 1.5, 0.36, G("#26352f", "#3c4a3a", 0, 0.4)),
              (0.32, 1.1, 0.5, G("#3b4a35", "#587045", 0.1, 0.6)),
              (0.22, 0.75, 0.62, G("#54703f", "#86a95c", 0.3, 0.75))]
    for li, (zh, wid, zc, colr) in enumerate(layers):
        m = nseg if li < 2 else max(2, nseg - 1)
        for i in range(m):
            t = (i + 0.5) / m - 0.5
            x = t * L * (0.95 - 0.12 * li)
            y = curve * (t * t * 4 - 0.6) + rng.uniform(-0.15, 0.15) * (li + 1) * 0.4
            r = L / m * 0.62 * (0.95 - 0.1 * li)
            mb.blob((x, y, 0.02 + zh * (0.35 + li * 0.45)), (r, wid * rng.uniform(0.85, 1.15) + 0.3, zh + 0.05),
                    sub=2, noise=0.13, col=colr, mat=MOSS, rot=rng.uniform(-0.3, 0.3))
    for k in range(3):
        x = rng.uniform(-L * 0.35, L * 0.35)
        mb.slab((x, rng.uniform(-0.5, 0.5) + curve * 0.3, 0.7), (0.5, 0.4, 0.3), rot=rng.uniform(0, 3), col=STONE_D, jit=0.1)
    if variant != "c":
        bracket(mb, L * 0.18, 0.4, 0.82, 0.15, sw=AM)


def a_mossy_island(mb, variant):
    rng = mb.rng
    R = {"a": 2.7, "b": 1.7}[variant]
    n = 12
    def ringp(scale, z):
        return [(math.cos(2 * math.pi * k / n) * R * scale * rr[k], math.sin(2 * math.pi * k / n) * R * scale * rr[k] * 0.86, z)
                for k in range(n)]
    rr = [rng.uniform(0.86, 1.1) for _ in range(n)]
    bm = mb.bm
    layout = [(0.78, -0.25, "#1e2c2a"), (1.0, 0.0, "#2f3b34"), (1.0, 0.32, "#4a5a3a"), (0.84, 0.5, "#66864b")]
    rings = [[bm.verts.new(p) for p in ringp(s, z)] for s, z, _ in layout]
    allv = [v for r_ in rings for v in r_]
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    top = rings[-1]
    cv = bm.verts.new((0, 0, 0.62)); allv.append(cv)
    for k in range(n):
        bm.faces.new((top[k], top[(k + 1) % n], cv))
    bm.faces.new(rings[0])
    mb._fin(allv, G("#20302c", "#7ea055", -0.25, 0.62), MOSS, jit=0.07)
    for k in range(3 if variant == "a" else 2):
        a = rng.uniform(0, 6.28)
        mb.slab((math.cos(a) * R * 0.55, math.sin(a) * R * 0.5, 0.75), (0.6, 0.5, 0.45), rot=a, tilt=(0.1, 0.1), col=STONE_P if k else STONE_D, jit=0.08)
    for k in range(3 if variant == "a" else 2):
        a = k * 2.4 + 0.7
        mb.blob((math.cos(a) * R * 0.45, math.sin(a) * R * 0.4, 0.66), (0.5, 0.45, 0.2), sub=1, noise=0.18,
                col=G("#4d7a45", "#93bb63", 0.6, 0.85), mat=MOSS)
    bracket(mb, R * 0.3, -R * 0.3, 0.72, 0.18, sw=VI)
    bracket(mb, -R * 0.2, R * 0.35, 0.74, 0.14, sw=CY)


def a_water_pool(mb):
    rng = mb.rng
    ph = rng.uniform(0, 6)
    n = 20
    def spec(f):
        return [(2 * math.pi * k / n, f * (1 + 0.2 * math.sin(3 * (2 * math.pi * k / n) + ph) + 0.09 * math.sin(5 * (2 * math.pi * k / n) + 1.3)))
                for k in range(n)]
    mb.flat_poly((0, 0, 0.03), [spec(0.52), spec(1.0)],
                 lambda co: srgb("#0f2a2a") if math.hypot(co[0], co[1]) < 0.5 else srgb("#2e6058"), mat=MOSS)
    # algae fringe ring slightly higher
    mb.flat_poly((0, 0, 0.045), [spec(1.0), spec(1.28)], lambda co: srgb("#3f7c5e"), mat=MOSS)


def a_reed_clump(mb, variant):
    rng = mb.rng
    nb = {"a": 11, "b": 9, "c": 8}[variant]
    hmax = {"a": 1.5, "b": 1.1, "c": 2.0}[variant]
    for i in range(nb):
        a = rng.uniform(0, 6.28); d = rng.uniform(0.02, 0.32)
        x0, y0 = math.cos(a) * d, math.sin(a) * d
        h = hmax * rng.uniform(0.6, 1.0)
        bend = rng.uniform(0.12, 0.42) * h
        ba = a + rng.uniform(-0.5, 0.5)
        bx, by = math.cos(ba) * bend, math.sin(ba) * bend
        pts = [(x0, y0, -0.05), (x0 + bx * 0.15, y0 + by * 0.15, h * 0.4), (x0 + bx * 0.5, y0 + by * 0.5, h * 0.78), (x0 + bx, y0 + by, h)]
        mb.tube(pts, [0.045, 0.04, 0.032, 0.0], sides=3, col=G("#a08a4c", "#4f8a58", 0, h), mat=FOLIAGE, caps=(False, False), squash=0.5, jit_col=0.1)
    if variant == "c":
        for i in range(3):
            a = rng.uniform(0, 6.28); d = rng.uniform(0.05, 0.3); h = rng.uniform(1.6, 2.1)
            x0, y0 = math.cos(a) * d, math.sin(a) * d
            mb.tube([(x0, y0, 0), (x0 + 0.05, y0, h * 0.5), (x0 + 0.12, y0 + 0.03, h)], [0.03, 0.025, 0.02], sides=4, col=srgb("#6b6b3c"), mat=FOLIAGE)
            mb.tube([(x0 + 0.1, y0 + 0.03, h - 0.28), (x0 + 0.12, y0 + 0.03, h + 0.1)], [0.065, 0.055], sides=5, col=srgb("#4a3626"), mat=BARK, jit=0.15)


def a_fungi_cluster(mb, variant):
    rng = mb.rng
    n = {"a": 6, "b": 5}[variant]
    cap_cols = [srgb("#8f7fae"), srgb("#9fb7a2"), srgb("#c9b48a"), srgb("#7ea6a0")]
    for i in range(n):
        a = i * 2.4 + rng.uniform(0, 0.5); d = 0.08 + 0.28 * (i / n) * 2
        x, y = math.cos(a) * d, math.sin(a) * d
        h = rng.uniform(0.3, 0.85) * (1.0 if i < 3 else 0.55)
        cr = rng.uniform(0.2, 0.4) * (1.0 if i < 3 else 0.7)
        mb.tube([(x, y, -0.05), (x + 0.03, y, h * 0.55), (x + 0.02, y + 0.02, h)], [0.05, 0.04, 0.035], sides=5, col=G("#b8c4a8", "#dfe5cf", 0, h), mat=MOSS, jit=0.1)
        glow = (i == 0 or (i == 3 and variant == "a"))
        if glow:
            mb.blob((x + 0.02, y, h + 0.02), (cr, cr, cr * 0.5), sub=2, noise=0.05, mat=GLOW, sw=(CY, VI)[i % 2])
        else:
            mb.blob((x + 0.02, y, h + 0.02), (cr, cr, cr * 0.5), sub=2, noise=0.06, col=cap_cols[i % 4], mat=MOSS)
    moss_cap(mb, (0, 0, 0.0), 0.5)


def a_glow_mushroom_tall(mb):
    rng = mb.rng
    mb.tube([(0, 0, -0.05), (0.08, 0.04, 0.9), (0.02, 0.1, 1.8)], [0.17, 0.11, 0.09], sides=7, col=G("#a9b79e", "#e3e8d2", 0, 1.8), mat=MOSS, jit=0.1)
    mb.blob((0.02, 0.1, 1.85), (0.85, 0.85, 0.34), sub=2, noise=0.05, mat=GLOW, sw=CY)
    mb.blob((0.02, 0.1, 1.72), (0.6, 0.6, 0.1), sub=1, noise=0.05, col=srgb("#7c6d9c"), mat=MOSS)
    moss_cap(mb, (0, 0, 0.0), 0.6)
    for k in range(3):
        a = k * 2.1
        mb.blob((math.cos(a) * 0.5, math.sin(a) * 0.5, 0.12), (0.16, 0.16, 0.1), sub=1, noise=0.1, mat=GLOW, sw=PG)


def a_fallen_log(mb):
    rng = mb.rng
    pts = [(-1.9 + 3.8 * t, 0.2 * math.sin(t * 3), 0.33 + 0.08 * math.sin(t * 5)) for t in np.linspace(0, 1, 6)]
    mb.tube(pts, [0.28, 0.34, 0.36, 0.34, 0.32, 0.25], sides=7, col=G("#2e332e", "#5a5346", 0, 0.7), mat=BARK, jit=0.15)
    for k in range(4):
        x = -1.2 + k * 0.8
        moss_cap(mb, (x, 0.05 * k, 0.66), 0.4 + 0.1 * (k % 2))
    bracket(mb, 0.2, -0.3, 0.42, 0.22, sw=VI, rot=0.5)
    bracket(mb, 0.65, -0.28, 0.52, 0.16, sw=CY, rot=1.0)
    mb.tube([(-1.5, 0.1, 0.6), (-1.8, 0.4, 1.0), (-1.7, 0.7, 1.4)], [0.07, 0.05, 0.0], sides=4, col=BARK_D, mat=BARK, caps=(False, False))


def a_marker_none(mb):
    pass


ASSETS = [
    # name, builder, seed, category, collision/meta
    ("heart_arch_tree", lambda mb: a_heart_arch_tree(mb), 11, "major"),
    ("ruin_gate", lambda mb: a_ruin_gate(mb), 12, "major"),
    ("fen_tree_a", lambda mb: a_fen_tree(mb, "a"), 13, "major"),
    ("fen_tree_b", lambda mb: a_fen_tree(mb, "b"), 14, "major"),
    ("fen_tree_dead", lambda mb: a_fen_tree_dead(mb), 15, "major"),
    ("mossy_island_a", lambda mb: a_mossy_island(mb, "a"), 21, "terrain"),
    ("mossy_island_b", lambda mb: a_mossy_island(mb, "b"), 22, "terrain"),
    ("mud_bank_a", lambda mb: a_mud_bank(mb, "a"), 23, "terrain"),
    ("mud_bank_b", lambda mb: a_mud_bank(mb, "b"), 24, "terrain"),
    ("mud_bank_c", lambda mb: a_mud_bank(mb, "c"), 25, "terrain"),
    ("water_pool", lambda mb: a_water_pool(mb), 26, "terrain"),
    ("boardwalk_slab", lambda mb: a_boardwalk_slab(mb), 31, "modular"),
    ("boardwalk_link", lambda mb: a_boardwalk_link(mb), 32, "modular"),
    ("lantern_post", lambda mb: a_lantern_post(mb), 33, "modular"),
    ("root_curtain", lambda mb: a_root_curtain(mb), 34, "modular"),
    ("pale_stone_a", lambda mb: a_pale_stone(mb, "a"), 35, "modular"),
    ("pale_stone_b", lambda mb: a_pale_stone(mb, "b"), 36, "modular"),
    ("ruin_pillar_a", lambda mb: a_ruin_pillar(mb, "a"), 41, "ruin"),
    ("ruin_pillar_b", lambda mb: a_ruin_pillar(mb, "b"), 42, "ruin"),
    ("ruin_block_pile", lambda mb: a_ruin_block_pile(mb), 43, "ruin"),
    ("standing_stone_a", lambda mb: a_standing_stone(mb, "a"), 44, "ruin"),
    ("standing_stone_b", lambda mb: a_standing_stone(mb, "b"), 45, "ruin"),
    ("fallen_log", lambda mb: a_fallen_log(mb), 51, "flora"),
    ("reed_clump_a", lambda mb: a_reed_clump(mb, "a"), 52, "flora"),
    ("reed_clump_b", lambda mb: a_reed_clump(mb, "b"), 53, "flora"),
    ("reed_clump_c", lambda mb: a_reed_clump(mb, "c"), 54, "flora"),
    ("fungi_cluster_a", lambda mb: a_fungi_cluster(mb, "a"), 55, "flora"),
    ("fungi_cluster_b", lambda mb: a_fungi_cluster(mb, "b"), 56, "flora"),
    ("glow_mushroom_tall", lambda mb: a_glow_mushroom_tall(mb), 57, "flora"),
]

# Footprints are game-space circles (x, z, radius) in the asset's local frame, used for exclusion/spacing checks.
# Collision intent is advisory: Codex adds these as StaticBody shapes; the source zone's own collision is untouched.
META = {
    "heart_arch_tree": dict(fp=[[-4.8, 0, 2.4], [4.8, 0, 2.4]], lod=[60, 140], col=[
        {"shape": "cylinder", "radius": 1.7, "height": 4.0, "offset": [-4.8, 2.0, 0]},
        {"shape": "cylinder", "radius": 1.7, "height": 4.0, "offset": [4.8, 2.0, 0]}],
        note="Twin trunks form a 7 m+ clear arch on the route axis; nothing hangs below 5 m inside |x|<3.5."),
    "ruin_gate": dict(fp=[[-4.2, 0, 0.9], [4.2, 0, 0.9]], lod=[45, 110], col=[
        {"shape": "box", "size": [1.2, 3.9, 1.2], "offset": [-4.2, 1.95, 0]},
        {"shape": "box", "size": [1.2, 2.7, 1.2], "offset": [4.2, 1.35, 0]}],
        note="Pillars at x=+-4.2 (inner edge 3.6). Wider than the source arch (+-3.3) to honour the 7 m corridor; arch is deliberately broken/open."),
    "fen_tree_a": dict(fp=[[0, 0, 1.0]], lod=[40, 100], col=[{"shape": "cylinder", "radius": 0.55, "height": 3.0, "offset": [0, 1.5, 0]}]),
    "fen_tree_b": dict(fp=[[0, 0, 1.0]], lod=[40, 100], col=[{"shape": "cylinder", "radius": 0.5, "height": 3.0, "offset": [0, 1.5, 0]}]),
    "fen_tree_dead": dict(fp=[[0, 0, 0.9]], lod=[35, 90], col=[{"shape": "cylinder", "radius": 0.45, "height": 3.0, "offset": [0, 1.5, 0]}]),
    "mossy_island_a": dict(fp=[[0, 0, 2.5]], lod=[35, 90], col=[], note="Visual only; ground-level lump 0.6 m high, walkable."),
    "mossy_island_b": dict(fp=[[0, 0, 1.6]], lod=[30, 80], col=[], note="Visual only."),
    "mud_bank_a": dict(fp=[[-2.5, 0, 1.4], [0, 0, 1.4], [2.5, 0, 1.4]], lod=[35, 90], col=[], note="Visual only; 0.7 m high."),
    "mud_bank_b": dict(fp=[[-1.6, -0.3, 1.3], [1.6, -0.3, 1.3]], lod=[30, 80], col=[]),
    "mud_bank_c": dict(fp=[[0, 0, 1.4]], lod=[25, 70], col=[]),
    "water_pool": dict(fp=[[0, 0, 1.1]], lod=[30, 70], col=[], soft=True, note="Flat decal-like disc at y=0.03-0.045; nudge y or use depth bias if it z-fights."),
    "boardwalk_slab": dict(fp=[[0, 0, 2.0]], lod=[50, 120], col=[], on_route=True,
                           note="Visual overlay, top at y=0.33; matches source 4.3x0.16x2.8 boxes at y=0.25. Source collision stays."),
    "boardwalk_link": dict(fp=[[0, 0, 1.0]], lod=[40, 100], col=[], on_route=True,
                           note="Fills the 1.5 m gaps between source slabs (top y=0.30). Walkable; give it a matching collider only if the player should not fall between."),
    "lantern_post": dict(fp=[[0, 0, 0.35]], lod=[40, 100], col=[{"shape": "cylinder", "radius": 0.15, "height": 2.4, "offset": [0, 1.2, 0]}],
                         edge=True, note="Arm points +x; yaw 180 to face -x. Lantern is emissive mesh; optionally add ONE shared no-shadow OmniLight per 2 posts."),
    "root_curtain": dict(fp=[[0, 0, 0.2]], lod=[30, 70], col=[], soft=True, hang=True, note="Origin is the TOP attachment; hangs 3 m down. Place at height."),
    "pale_stone_a": dict(fp=[[0, 0, 0.9]], lod=[30, 70], col=[], soft=True, on_route=True),
    "pale_stone_b": dict(fp=[[0, 0, 0.9]], lod=[30, 70], col=[], soft=True, on_route=True),
    "ruin_pillar_a": dict(fp=[[0, 0, 0.8]], lod=[35, 90], col=[{"shape": "cylinder", "radius": 0.55, "height": 2.2, "offset": [0, 1.1, 0]}]),
    "ruin_pillar_b": dict(fp=[[0, 0, 0.8]], lod=[35, 90], col=[{"shape": "cylinder", "radius": 0.55, "height": 1.3, "offset": [0, 0.65, 0]}]),
    "ruin_block_pile": dict(fp=[[0, 0, 1.1]], lod=[35, 90], col=[{"shape": "box", "size": [2.4, 1.0, 1.8], "offset": [0, 0.5, 0]}]),
    "standing_stone_a": dict(fp=[[0, 0, 0.6]], lod=[35, 90], col=[{"shape": "box", "size": [0.9, 2.5, 0.65], "offset": [0, 1.25, 0]}],
                             note="Rune bars face local -Z(game +z) i.e. toward the entrance at yaw 0."),
    "standing_stone_b": dict(fp=[[0, 0, 0.6]], lod=[35, 90], col=[{"shape": "box", "size": [0.9, 1.8, 0.65], "offset": [0, 0.9, 0]}]),
    "fallen_log": dict(fp=[[-1.2, 0, 0.6], [0, 0, 0.6], [1.2, 0, 0.6]], lod=[30, 80], col=[{"shape": "box", "size": [3.8, 0.7, 0.7], "offset": [0, 0.35, 0]}]),
    "reed_clump_a": dict(fp=[[0, 0, 0.35]], lod=[25, 60], col=[], soft=True),
    "reed_clump_b": dict(fp=[[0, 0, 0.35]], lod=[25, 60], col=[], soft=True),
    "reed_clump_c": dict(fp=[[0, 0, 0.35]], lod=[25, 60], col=[], soft=True),
    "fungi_cluster_a": dict(fp=[[0, 0, 0.5]], lod=[25, 60], col=[], soft=True),
    "fungi_cluster_b": dict(fp=[[0, 0, 0.5]], lod=[25, 60], col=[], soft=True),
    "glow_mushroom_tall": dict(fp=[[0, 0, 0.5]], lod=[35, 80], col=[{"shape": "cylinder", "radius": 0.2, "height": 1.8, "offset": [0, 0.9, 0]}]),
}

# Gameplay anchors copied from the source zone (game local, metres).
RESOURCES = [(-16 + 8 * i, -11 + (i % 2) * 7) for i in range(5)]
ENEMIES = [(-10 + 10 * i, -8 - (i % 2) * 7) for i in range(3)]
CORRIDOR = dict(x_min=-3.5, x_max=3.5, z_min=-28.0, z_max=28.0)
RES_R, ENEMY_R = 2.4, 2.8
ZONE_HALF = 27.4


# ------------------------------------------------------------------ placement generator
def gen_placements():
    rng = random.Random(4242)
    P = []
    solids = []  # (x, z, r) world circles of placed solid things

    def world_fp(asset, x, z, yaw, sc):
        c, s_ = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        out = []
        for fx, fz, fr in META[asset]["fp"]:
            out.append((x + (fx * c + fz * s_) * sc, z + (-fx * s_ + fz * c) * sc, fr * sc))
        return out

    def ok(asset, x, z, yaw, sc, check_solids=True):
        m = META[asset]
        for (wx, wz, wr) in world_fp(asset, x, z, yaw, sc):
            if abs(wx) + wr > ZONE_HALF or abs(wz) + wr > ZONE_HALF:
                return False
            if not m.get("on_route"):
                if m.get("edge"):
                    pass
                else:
                    cx = min(max(wx, CORRIDOR["x_min"]), CORRIDOR["x_max"])
                    if math.hypot(wx - cx, 0) < wr and wr > 0 and abs(wx) - wr < CORRIDOR["x_max"]:
                        return False
            for (rx, rz) in RESOURCES:
                if math.hypot(wx - rx, wz - rz) < wr + RES_R:
                    return False
            for (ex, ez) in ENEMIES:
                if math.hypot(wx - ex, wz - ez) < wr + ENEMY_R:
                    return False
            if check_solids and not m.get("soft") and not m.get("on_route"):
                for (sx, sz, sr) in solids:
                    if math.hypot(wx - sx, wz - sz) < wr + sr + 0.35:
                        return False
        return True

    def add(asset, x, z, yaw=0.0, sc=1.0, y=0.0, group="", force=False, tag=None):
        if not force and not ok(asset, x, z, yaw, sc):
            return False
        m = META[asset]
        e = {"asset": asset, "position": [round(x, 3), round(y, 3), round(z, 3)], "yaw_degrees": round(yaw, 2), "scale": round(sc, 3),
             "group": group}
        if m["col"]:
            e["collision"] = "asset_default"
        else:
            e["collision"] = "none"
        P.append(e)
        if not m.get("soft") and not m.get("on_route"):
            solids.extend(world_fp(asset, x, z, yaw, sc))
        return True

    # 1. route: boardwalk overlay, links, lanterns, stones
    for i in range(9):
        add("boardwalk_slab", 0, 19 - 4.3 * i, 0, 1.0, group="boardwalk", force=True)
    for i in range(8):
        add("boardwalk_link", 0, 19 - 4.3 * i - 2.15, 0, 1.0, group="boardwalk", force=True)
    for zz in (21.5, 13.0, 4.5, -4.0, -12.5):
        add("lantern_post", -3.95, zz, 0, 1.0, group="lanterns", force=True)
        add("lantern_post", 3.95, zz, 180, 1.0, group="lanterns", force=True)
    for i in range(18):
        x = -5 + (i % 3) * 4; z = 18 - (i // 3) * 6
        if x == -1:
            continue
        add("pale_stone_a" if i % 2 else "pale_stone_b", x + rng.uniform(-0.3, 0.3), z + rng.uniform(-0.4, 0.4), rng.uniform(0, 360),
            rng.uniform(1.0, 1.35), group="pale_stones", force=True)
    for k in range(10):  # winding pale stones from the last plank through the gate to the heart tree
        z = -18.2 - k * 0.95
        x = 1.5 * math.sin(k * 0.8)
        add("pale_stone_a" if k % 2 == 0 else "pale_stone_b", x, z, rng.uniform(0, 360), rng.uniform(0.85, 1.15), group="route_back", force=True)
    for (x, z) in ((-1.4, 24.0), (1.3, 25.8)):
        add("pale_stone_b", x, z, rng.uniform(0, 360), 1.1, group="entrance", force=True)

    # 2. focal architecture
    add("ruin_gate", 0, -20, 0, 1.0, group="landmark", force=True)
    add("heart_arch_tree", 0, -24.6, 0, 1.0, group="landmark", force=True)
    add("fen_tree_a", -8.8, 21.5, 0, 1.0, group="entrance_frame", force=True)
    add("fen_tree_b", 9.4, 23.0, 180, 1.0, group="entrance_frame", force=True)
    add("mossy_island_b", -6.6, 25.0, 30, 1.0, group="entrance", force=True)
    add("mossy_island_b", 7.0, 26.0, 200, 0.9, group="entrance", force=True)
    for k, (a, sc) in enumerate(((10, 1.1), (80, 1.0), (150, 1.15), (215, 0.95), (290, 1.05))):  # standing stone ring
        cx, cz, rr = 12.6, 3.0, 3.3
        ang = math.radians(a)
        add("standing_stone_a" if k % 2 == 0 else "standing_stone_b", cx + math.cos(ang) * rr, cz + math.sin(ang) * rr,
            -a + 90 + rng.uniform(-10, 10), sc, group="stone_ring", force=True)
    add("ruin_block_pile", 12.6, 3.0, 40, 1.0, group="stone_ring", force=True)
    add("ruin_pillar_a", -13.2, -14.5, 20, 1.0, group="ruins")
    add("ruin_pillar_b", 14.2, -15.5, 200, 1.0, group="ruins")
    add("ruin_block_pile", -12.0, 12.6, 110, 1.0, group="ruins")
    add("ruin_pillar_b", -18.5, 1.5, 70, 1.0, group="ruins")

    # 3. terrain masses that shape the shoreline flanking the route
    banks = ["mud_bank_a", "mud_bank_b", "mud_bank_c"]
    tries = 0
    nb = 0
    while nb < 9 and tries < 400:
        tries += 1
        side = -1 if nb % 2 == 0 else 1
        x = side * rng.uniform(6.2, 13.0); z = rng.uniform(-18, 20)
        yaw = 90 + rng.uniform(-25, 25) + (0 if rng.random() < 0.5 else 180)
        b = banks[nb % 3]
        if add(b, x, z, yaw, rng.uniform(0.9, 1.25), group="banks"):
            nb += 1
    ni = 0; tries = 0
    while ni < 7 and tries < 400:
        tries += 1
        side = rng.choice([-1, 1])
        x = side * rng.uniform(7, 22); z = rng.uniform(-20, 20)
        if add("mossy_island_a" if ni % 3 == 0 else "mossy_island_b", x, z, rng.uniform(0, 360), rng.uniform(0.85, 1.2), group="islands"):
            ni += 1

    # 4. fen trees ringing the zone, leaning toward the route
    tries = 0; nt = 0
    kinds = ["fen_tree_a", "fen_tree_b", "fen_tree_dead", "fen_tree_b", "fen_tree_a"]
    while nt < 15 and tries < 800:
        tries += 1
        x = rng.uniform(-26, 26); z = rng.uniform(-26, 24)
        if abs(x) < 7.5:
            continue
        yaw = (0 if x < 0 else 180) + rng.uniform(-30, 30)
        if add(kinds[nt % len(kinds)], x, z, yaw, rng.uniform(0.9, 1.3), group="trees"):
            nt += 1
    nl = 0; tries = 0
    while nl < 3 and tries < 200:
        tries += 1
        x = rng.choice([-1, 1]) * rng.uniform(5.5, 20); z = rng.uniform(-18, 18)
        if add("fallen_log", x, z, rng.uniform(0, 360), rng.uniform(0.9, 1.2), group="logs"):
            nl += 1
    nt2 = 0; tries = 0
    while nt2 < 2 and tries < 100:
        tries += 1
        x = rng.choice([-1, 1]) * rng.uniform(11, 22); z = rng.uniform(-18, 18)
        if add("glow_mushroom_tall", x, z, rng.uniform(0, 360), rng.uniform(0.9, 1.3), group="mushrooms"):
            nt2 += 1

    # 5. soft dressing
    tries = 0; npool = 0
    while npool < 9 and tries < 400:
        tries += 1
        x = rng.uniform(-24, 24); z = rng.uniform(-24, 24)
        if abs(x) < 4.8:
            continue
        if add("water_pool", x, z, rng.uniform(0, 360), rng.uniform(1.8, 3.6), y=0.0, group="pools"):
            npool += 1
    anchors = [(p["position"][0], p["position"][2], 2.2 if "island" in p["asset"] else 1.6) for p in P if p["group"] in ("islands", "banks")]
    tree_anchors = [(p["position"][0], p["position"][2]) for p in P if p["group"] in ("trees", "entrance_frame", "ruins")]
    reeds = ["reed_clump_a", "reed_clump_b", "reed_clump_c"]
    nr = 0; tries = 0
    while nr < 62 and tries < 3000:
        tries += 1
        ax, az, ar = rng.choice(anchors)
        a = rng.uniform(0, 6.283); d = ar + rng.uniform(0.2, 1.8)
        x, z = ax + math.cos(a) * d, az + math.sin(a) * d
        if abs(x) < 3.9:
            continue
        if any(math.hypot(x - q["position"][0], z - q["position"][2]) < 1.1 for q in P if q["asset"].startswith("reed")):
            continue
        if add(reeds[nr % 3], x, z, rng.uniform(0, 360), rng.uniform(0.85, 1.4), group="reeds"):
            nr += 1
    # entrance reeds framing the approach
    for (x, z) in ((-4.9, 23.2), (5.1, 24.0), (-5.4, 17.0), (5.6, 16.6), (-5.6, -17.5), (5.9, -17.2), (-6.3, -23), (6.4, -23.6)):
        add(reeds[int(abs(x * 7 + z)) % 3], x, z, rng.uniform(0, 360), rng.uniform(1.1, 1.5), group="reeds")
    nf = 0; tries = 0
    while nf < 22 and tries < 1500:
        tries += 1
        ax, az = rng.choice(tree_anchors + [(a_[0], a_[1]) for a_ in anchors])
        a = rng.uniform(0, 6.283); d = rng.uniform(1.5, 3.2)
        x, z = ax + math.cos(a) * d, az + math.sin(a) * d
        if abs(x) < 4.0:
            continue
        if add("fungi_cluster_a" if nf % 2 else "fungi_cluster_b", x, z, rng.uniform(0, 360), rng.uniform(0.9, 1.4), group="fungi"):
            nf += 1
    # fungi lining the back route for the fairy
    for k, (x, z) in enumerate(((-4.6, -21.5), (4.7, -22.3), (-5.0, -16.6), (5.2, -16.0))):
        add("fungi_cluster_a" if k % 2 else "fungi_cluster_b", x, z, rng.uniform(0, 360), 1.2, group="fungi")

    # 6. hanging root curtains from the gate arch
    add("root_curtain", -3.0, -20.0, 90, 0.8, y=5.3, group="hanging", force=True)
    add("root_curtain", -3.75, -20.0, 90, 0.75, y=4.65, group="hanging", force=True)
    return P


def validate(P):
    issues = []
    for p in P:
        x, y, z = p["position"]
        m = META[p["asset"]]
        for (rx, rz) in RESOURCES:
            if math.hypot(x - rx, z - rz) < RES_R * 0.8 and not m.get("on_route"):
                issues.append(f"{p['asset']} at {x},{z} on resource")
        if not m.get("on_route") and not m.get("edge") and not m.get("hang"):
            c, s_ = math.cos(math.radians(p["yaw_degrees"])), math.sin(math.radians(p["yaw_degrees"]))
            for fx, fz, fr in m["fp"]:
                wx = x + (fx * c + fz * s_) * p["scale"]; wr = fr * p["scale"]
                if abs(wx) - wr < 3.5 and p["group"] not in ("landmark",):
                    issues.append(f"{p['asset']} at {x},{z} intrudes into corridor (fp x={wx:.2f} r={wr:.2f})")
    return issues


# ------------------------------------------------------------------ build / export
def rebuild_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    kit = bpy.data.collections.new("GF_Kit"); bpy.context.scene.collection.children.link(kit)
    objs = {}
    for name, fn, seed, cat in ASSETS:
        mb = MB(seed); fn(mb)
        ob = mb.build(name, mats); ob["category"] = cat
        kit.objects.link(ob); objs[name] = ob
    return mats, kit, objs


def glb_export(ob, path):
    for o in bpy.data.objects:
        o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
              export_image_format="AUTO", export_materials="EXPORT", export_cameras=False, export_lights=False,
              export_texcoords=True, export_normals=True)
    try:
        bpy.ops.export_scene.gltf(export_vertex_color="ACTIVE", **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def glb_info(path):
    import struct
    with open(path, "rb") as f:
        f.read(12)
        ln, ty = struct.unpack("<II", f.read(8))
        j = json.loads(f.read(ln))
    return j


def game_dims(ob):
    xs = [v.co for v in ob.data.vertices]
    mn = [min(c[i] for c in xs) for i in range(3)]; mx = [max(c[i] for c in xs) for i in range(3)]
    return dict(min=[round(mn[0], 2), round(mn[2], 2), round(-mx[1], 2)], max=[round(mx[0], 2), round(mx[2], 2), round(-mn[1], 2)],
                size=[round(mx[0] - mn[0], 2), round(mx[2] - mn[2], 2), round(mx[1] - mn[1], 2)])


def main():
    t = time.time()
    mats, kit, objs = rebuild_all()
    stats = {}
    for name, ob in objs.items():
        path = os.path.join(HERE, name + ".glb")
        glb_export(ob, path)
        j = glb_info(path)
        prim_attrs = set()
        for me in j.get("meshes", []):
            for p in me["primitives"]:
                prim_attrs |= set(p["attributes"].keys())
        stats[name] = dict(tris=len(ob.data.polygons), dims=game_dims(ob), glb_bytes=os.path.getsize(path),
                           attrs=sorted(prim_attrs), materials=[m["name"] for m in j.get("materials", [])],
                           category=ob["category"])
    total = sum(s["tris"] for s in stats.values())
    print(f"[build] {len(objs)} assets, {total} tris, exported in {time.time() - t:.1f}s")

    P = gen_placements()
    issues = validate(P)
    print("[placement]", len(P), "instances;", "issues:", issues if issues else "none")
    manifest = {"schema": 1, "assets": {n: n + ".glb" for n in objs}, "placements": P,
                "exclusion_zones": [
                    dict(name="route_corridor", type="rect", x=[CORRIDOR["x_min"], CORRIDOR["x_max"]], z=[-28, 28],
                         rule="No solid/opaque piece; only on_route pieces (boardwalk, links, pale stones, lantern post arms) and hanging roots above 5 m."),
                    *[dict(name=f"resource_{i}", type="circle", center=list(c), radius=RES_R) for i, c in enumerate(RESOURCES)],
                    *[dict(name=f"enemy_{i}", type="circle", center=list(c), radius=ENEMY_R) for i, c in enumerate(ENEMIES)]],
                "asset_meta": {n: dict(footprints=META[n]["fp"], lod_distances_m=META[n]["lod"], collision=META[n]["col"],
                                       note=META[n].get("note", ""), tris=stats[n]["tris"], size_m=stats[n]["dims"]["size"])
                               for n in objs}}
    with open(os.path.join(HERE, "placement.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    minimal = {"schema": 1, "assets": manifest["assets"],
               "placements": [{k: p[k] for k in ("asset", "position", "yaw_degrees", "scale")} for p in P]}
    with open(os.path.join(HERE, "placement_minimal.json"), "w") as f:
        json.dump(minimal, f)
    with open(os.path.join(HERE, "kit_stats.json"), "w") as f:
        json.dump(dict(stats=stats, total_tris=total, instances=len(P), issues=issues), f, indent=1)

    setup_scene(objs, P, stats)
    write_handoff(stats, total, P, issues)
    print(f"[done] total {time.time() - T0:.1f}s")


# ------------------------------------------------------------------ mock scene + renders
def G2B(x, y, z):
    return (x, -z, y)


def look_at(cam, eye, target):
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler(); cam.location = eye


def setup_scene(objs, P, stats):
    sc = bpy.context.scene
    kit = bpy.data.collections["GF_Kit"]
    mock = bpy.data.collections.new("GF_MockZone"); sc.collection.children.link(mock)
    # lay the kit out on a shelf far outside the zone
    rows = {"major": [], "terrain": [], "modular": [], "ruin": [], "flora": []}
    for n, ob in objs.items():
        rows[ob["category"]].append(n)
    layout = {"major": (0, 0), "terrain": (0, 1), "modular": (0, 2), "ruin": (0, 3), "flora": (0, 4)}
    kit_pos = {}
    for cat, names in rows.items():
        cur = 0.0; yrow = 200 + layout[cat][1] * 22
        for n in names:
            d = stats[n]["dims"]["size"]
            w = max(d[0], d[2]) + 1.5
            if n == "root_curtain":
                objs[n].location = (cur + w / 2, yrow, 3.2)
            else:
                objs[n].location = (cur + w / 2, yrow, 0)
            cur += w + 0.6
        kit_pos[cat] = (cur, yrow)
    # mock zone instances share mesh data with the kit
    for i, p in enumerate(P):
        o = bpy.data.objects.new(f"{p['asset']}.{i:03d}", objs[p["asset"]].data)
        x, y, z = p["position"]
        o.location = G2B(x, y, z); o.rotation_euler = (0, 0, math.radians(p["yaw_degrees"]))
        o.scale = (p["scale"],) * 3
        mock.objects.link(o)
    # ground + water plane stand-ins
    gm = bpy.data.materials.new("mock_ground"); gm.use_nodes = True
    b = gm.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = srgb("#35524c"); b.inputs["Roughness"].default_value = 0.55
    bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, -0.01))
    g = bpy.context.active_object; g.name = "mock_ground"; g.data.materials.append(gm)
    for c in g.users_collection:
        c.objects.unlink(g)
    mock.objects.link(g)
    # gameplay markers: resources (violet), enemies (amber), only for the mock renders
    mk_r = bpy.data.materials.new("mk_res"); mk_r.use_nodes = True
    bb = mk_r.node_tree.nodes["Principled BSDF"]; bb.inputs["Base Color"].default_value = srgb("#a78fc4")
    mk_e = bpy.data.materials.new("mk_en"); mk_e.use_nodes = True
    bb = mk_e.node_tree.nodes["Principled BSDF"]; bb.inputs["Base Color"].default_value = srgb("#ffd27a")
    bb.inputs["Emission Color"].default_value = srgb("#ffc25a"); bb.inputs["Emission Strength"].default_value = 3.0
    markers = []
    for (x, z) in RESOURCES:
        for j in range(4):
            bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.16, depth=0.5, location=G2B(x + (j - 1.5) * 0.3, 0.25, z))
            o = bpy.context.active_object; o.data.materials.append(mk_r); markers.append(o)
    for (x, z) in ENEMIES:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.35, location=G2B(x, 1.0, z))
        o = bpy.context.active_object; o.data.materials.append(mk_e); markers.append(o)
    for o in markers:
        for c in o.users_collection:
            c.objects.unlink(o)
        mock.objects.link(o)
    # debug exclusion discs
    dbg = bpy.data.collections.new("GF_Debug"); sc.collection.children.link(dbg)
    dm = bpy.data.materials.new("dbg_route"); dm.use_nodes = True
    bd = dm.node_tree.nodes["Principled BSDF"]; bd.inputs["Base Color"].default_value = srgb("#ff3b3b")
    bd.inputs["Emission Color"].default_value = srgb("#ff3b3b"); bd.inputs["Emission Strength"].default_value = 1.0; bd.inputs["Alpha"].default_value = 0.35
    dm.blend_method = "BLEND" if hasattr(dm, "blend_method") else None
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.06))
    o = bpy.context.active_object; o.scale = (7.0, 56.0, 1); o.name = "dbg_corridor"; o.data.materials.append(dm)
    for c in o.users_collection:
        c.objects.unlink(o)
    dbg.objects.link(o)
    for i, (x, z) in enumerate(RESOURCES + ENEMIES):
        r_ = RES_R if i < len(RESOURCES) else ENEMY_R
        bpy.ops.mesh.primitive_circle_add(vertices=32, radius=r_, fill_type="NGON", location=(x, -z, 0.07))
        o = bpy.context.active_object; o.data.materials.append(dm)
        for c in o.users_collection:
            c.objects.unlink(o)
        dbg.objects.link(o)
    dbg.hide_render = True

    blend_path = os.path.join(HERE, "gloamfen_kit.blend")
    if NO_RENDER:
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        return
    render_all(sc, kit, mock, dbg, kit_pos, objs)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)


def make_world(sc, kind):
    w = bpy.data.worlds.new("gf_world_" + kind); w.use_nodes = True; sc.world = w
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if kind == "zone":
        bg.inputs["Color"].default_value = srgb("#5d8a83"); bg.inputs["Strength"].default_value = 0.75
        w.mist_settings.start = 4.0; w.mist_settings.depth = 62.0; w.mist_settings.falloff = "QUADRATIC"
    else:
        bg.inputs["Color"].default_value = srgb("#4d6663"); bg.inputs["Strength"].default_value = 1.0


def set_fog(sc, on, color="#79a89e", strength=0.9):
    sc.use_nodes = True
    nt = sc.node_tree; nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    out = nt.nodes.new("CompositorNodeComposite")
    if not on:
        nt.links.new(rl.outputs["Image"], out.inputs["Image"]); return
    sc.view_layers[0].use_pass_mist = True
    cl = nt.nodes.new("CompositorNodeMath"); cl.operation = "MULTIPLY"; cl.inputs[1].default_value = strength; cl.use_clamp = True
    nt.links.new(rl.outputs["Mist"], cl.inputs[0])
    mx = nt.nodes.new("CompositorNodeMixRGB"); mx.blend_type = "MIX"
    mx.inputs[2].default_value = srgb(color)
    nt.links.new(cl.outputs[0], mx.inputs[0])
    nt.links.new(rl.outputs["Image"], mx.inputs[1])
    nt.links.new(mx.outputs[0], out.inputs["Image"])


def clear_lights():
    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o)


def add_light(kind, loc, energy, color, rot=None, size=0.3, shadow=True):
    ld = bpy.data.lights.new("l", kind); ld.energy = energy; ld.color = color
    if kind == "POINT":
        ld.shadow_soft_size = size
    ld.use_shadow = shadow
    o = bpy.data.objects.new("l", ld); bpy.context.scene.collection.objects.link(o); o.location = loc
    if rot:
        o.rotation_euler = rot
    return o


def render_to(sc, cam_o, path, res=(1280, 720)):
    sc.camera = cam_o
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"[render] {os.path.basename(path)} {time.time() - t:.1f}s")


def render_all(sc, kit, mock, dbg, kit_pos, objs):
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = -0.2
    engine = "BLENDER_EEVEE_NEXT"
    try:
        sc.render.engine = engine
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE"
    print("[render] engine", sc.render.engine)
    if hasattr(sc.eevee, "taa_render_samples"):
        sc.eevee.taa_render_samples = 48
    if hasattr(sc.eevee, "volumetric_tile_size"):
        sc.eevee.volumetric_tile_size = "2"
    if hasattr(sc.eevee, "volumetric_samples"):
        sc.eevee.volumetric_samples = 48
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
    cam.data.clip_end = 400

    def zone_shot(name, eye_g, tgt_g, lens, fairy_g, res=(1280, 720), debug=False, fairy_energy=140, fog=0.9):
        clear_lights()
        kit.hide_render = True; mock.hide_render = False; dbg.hide_render = not debug
        make_world(sc, "zone"); set_fog(sc, True, strength=fog)
        add_light("SUN", (0, 0, 30), 1.5, srgb("#a9c2ff")[:3], rot=(math.radians(58), math.radians(8), math.radians(-38)))
        fx, fy, fz = fairy_g
        add_light("POINT", G2B(fx, fy, fz), fairy_energy, srgb("#ffc27a")[:3], size=0.25, shadow=False)
        cam.data.lens = lens
        look_at(cam, G2B(*eye_g), G2B(*tgt_g))
        render_to(sc, cam, os.path.join(HERE, name), res)

    zone_shot("preview_ground_entrance.png", (0.7, 1.7, 26.5), (-0.3, 3.2, -22), 22, (0.3, 1.6, 22.5))
    zone_shot("preview_ground_midroute.png", (0.5, 1.7, 3.0), (0.0, 2.6, -24), 20, (0.2, 1.6, 0.4))
    zone_shot("preview_ground_gate_back.png", (-0.6, 1.7, -14.5), (0.0, 4.2, -26), 24, (0.4, 1.6, -17.5))
    zone_shot("preview_overhead_rts.png", (0, 40, 34), (0, 0, -7), 30, (0.3, 1.6, 10), fairy_energy=260, fog=0.3)
    zone_shot("preview_overhead_debug_zones.png", (0, 46, 14), (0, 0, 1), 32, (0.3, 1.6, 10), debug=True, fairy_energy=260, fog=0.25)

    # kit sheets (neutral studio-ish dusk): orthographic elevated front view per category group
    mock.hide_render = True; dbg.hide_render = True; kit.hide_render = False
    make_world(sc, "kit"); set_fog(sc, False)
    cam.data.type = "ORTHO"

    def sheet(name, cats):
        clear_lights()
        bpy.context.view_layer.update()
        for o in objs.values():
            o.hide_render = o["category"] not in cats
        add_light("SUN", (0, 0, 30), 3.2, (0.9, 0.95, 1.0), rot=(math.radians(52), 0, math.radians(-30)))
        add_light("SUN", (0, 0, 30), 0.9, srgb("#ffc890")[:3], rot=(math.radians(70), 0, math.radians(150)))
        xs, zs, ys = [], [], []
        for c in cats:
            for n in [k for k, v in objs.items() if v["category"] == c]:
                o = objs[n]
                bb = [o.matrix_world @ Vector(v) for v in o.bound_box]
                xs += [b.x for b in bb]; zs += [b.z for b in bb]; ys += [b.y for b in bb]
        cx = (min(xs) + max(xs)) / 2; cyy = sum(ys) / len(ys); cz = (min(zs) + max(zs)) / 2
        W = max(xs) - min(xs); H = max(zs) - min(zs)
        cam.data.ortho_scale = max(W, H * 16 / 9) * 1.08
        cam.location = (cx, cyy - 60, cz + 60 * math.tan(math.radians(20)))
        look_at(cam, cam.location, (cx, cyy, cz))
        render_to(sc, cam, os.path.join(HERE, name), (1600, 800))

    sheet("preview_kit_landmarks.png", ["major"])
    sheet("preview_kit_terrain_modular.png", ["terrain", "modular"])
    sheet("preview_kit_ruins_flora.png", ["ruin", "flora"])


# ------------------------------------------------------------------ handoff
def write_handoff(stats, total, P, issues):
    from collections import Counter
    cnt = Counter(p["asset"] for p in P)
    inst_tris = sum(stats[p["asset"]]["tris"] for p in P)
    rows = "\n".join(
        f"| `{n}` | {s['category']} | {s['dims']['size'][0]} x {s['dims']['size'][1]} x {s['dims']['size'][2]} | {s['tris']} | {cnt.get(n, 0)} | {s['glb_bytes'] // 1024} KB |"
        for n, s in stats.items())
    txt = f"""# Gloamfen environment kit - handoff

Builder: `build_gloamfen_kit.py` (Blender 4.5.13, deterministic: all randomness is seeded). Everything in this folder is generated by it.

## Rebuild
```powershell
& "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe" --background --python build_gloamfen_kit.py
# add `-- --no-render` to skip previews (about 10 s)
```
Outputs: {len(stats)} `*.glb` (one per asset/variant), `gloamfen_kit.blend` (kit shelf at game z=-200..-290 plus the mock zone at the real placements; `GF_Debug` collection shows corridor/anchor exclusions), `placement.json` (rich) and `placement_minimal.json` (strict importer schema), `kit_stats.json`, `preview_*.png`.

## Budget (measured)
* Unique triangles across the reusable kit: **{total}** (target ~25k). Heart tree {stats['heart_arch_tree']['tris']}, gate {stats['ruin_gate']['tris']}, fen trees {stats['fen_tree_a']['tris']}/{stats['fen_tree_b']['tris']}, everything else under ~1.2k each.
* Shared materials: **5** - `gf_bark`, `gf_moss_mud`, `gf_stone`, `gf_foliage`, `gf_glow`. Every GLB embeds the same five names, so import them once and share (all meshes use the same 128 px textures; GLB sizes are small). Godot may dedupe by resource path if you save the materials; if not, that is 5 tiny materials per mesh - merge after import.
* Placed instances in `placement.json`: **{len(P)}**, about {inst_tris // 1000}k triangles if nothing is culled. Use MultiMesh per asset name (all instances of one asset share one mesh/material set) and `visibility_range_end` from `asset_meta.lod_distances_m` [fade start, end]. The whole scene is fog-limited so far instances fade out inside the mist.
* No lights are baked into the GLBs. Emissive glow meshes only. Do not add a shadow light per instance.

## Materials / vertex colour contract
* Albedo = vertex colour (`COLOR_0`) x a neutral 128 px tileable texture (bark streaks, moss blotch, stone blocks, leaf noise). Godot's glTF importer turns on `vertex_color_use_as_albedo` automatically when `COLOR_0` is present; verify it after import (each GLB lists `COLOR_0` in `kit_stats.json`).
* `gf_glow` is emissive with a 4 swatch texture (cyan-teal, violet, amber, pale green), emission energy about 1.6. It needs environment **Glow** enabled (threshold ~0.9) to bloom; without it the accents read as flat pastel shapes. Swatch choice is per face UV, so extra colours only need another cell.
* Flat shading throughout to match the game's faceted look; UVs are box-projected (0.4 tile/m).

## Coordinate conventions
* Origins are at ground contact (y=0) centred on the footprint, except `root_curtain` whose origin is the TOP attachment point (hangs about 3 m down; place at y=3.3+).
* Positions and `yaw_degrees` in `placement.json` are game local (Godot Y-up, zone root), yaw about +Y. `scale` is uniform.
* Trees lean toward +X at yaw 0, so left-side trees use yaw about 0 and right-side about 180 to lean over the route. `lantern_post` arm points +X likewise. Rune faces of `standing_stone_*` face game +Z.
* Extra keys per placement (`group`, `collision`) and top-level `exclusion_zones` / `asset_meta` are ignored by the strict schema; use `placement_minimal.json` if the importer rejects unknown keys.

## Composition (what the zone should read as)
1. **Entrance (z=+19..+27):** twin leaning fen trees frame the approach (x=-8.8 / +9.4), lantern posts pair up every 8.5 m along the boardwalk (warm amber lantern vs cool teal fog = the wayfinding accent), pale stones and reeds funnel to the first plank.
2. **Route:** the boardwalk overlay and `boardwalk_link` pieces close the 1.5 m gaps so it reads as one continuous warm ribbon; mud banks and islands flank it at 6-13 m, leaving the 7 m corridor clear.
3. **Landmarks:** ruin standing-stone ring (x=+12.6, z=+3) with rune bars on the right; a broken ruin gate at z=-20; behind it the **heart arch tree** (z=-24.6): two spiral trunks meeting in a 10 m pointed arch with a caged glowing orb at 7 m. It is the on-axis focal silhouette from the entrance and the entrance to the back of the zone; the clear span is 7.2 m+ and nothing hangs below 5 m across it.
4. **Back route:** winding `pale_stone` path from the last plank, through the gate, under the tree, glow fungi both sides.

## Gameplay integration notes
* All placements avoid the 7 m corridor (|x|<3.5, only boardwalk pieces, pale stones and lantern posts at |x|=3.95 with arms to 3.45 are allowed), resources (r {RES_R} m) and enemies (r {ENEMY_R} m). `validate()` in the builder checks this; result: {'no issues' if not issues else issues}.
* Collision intent lives in `asset_meta[*].collision` (cylinder/box shapes in asset-local metres) and each placement's `collision` is `asset_default` or `none`. Terrain lumps, pools, reeds and fungi are visual only. The source zone's collision was not touched.
* **Replace/hide** the source's spiral of 32 mushroom stems + caps (they carry collision, r~24) and `TreeAdapter.fen_tree` calls where they overlap kit trees. The ruin gate is 8.4 m clear between pillars (source arch is 5.8 m); hide the source arch/pillars and `rock` blocks at (+-7, -19) or the new gate will clip them.
* Ground/water: these assets sit ON the source ground; `water_pool` at y=0.03-0.045 may z-fight with the source ground disc - nudge or raise 1 cm.
* Boardwalk overlay top is y=0.33 and equals the source slab tops; links are 0.30. Codex may raise link colliders if the fall-through gap matters.

## Lighting / fog suggestions (verified in the mock renders, translated from Blender)
* Fog: keep the source zone's moody teal, `fog_density` ~0.012-0.016 with a **cooler** fog colour (#5f8f88) and `fog_light_energy` ~1, sun-inscatter low. The kit relies on value separation rather than more density: banks/foliage are dark green, boardwalk + lanterns + pale stones are the light/warm values.
* Sun: one directional light, dim cool blue (#9db8ff, energy ~0.9-1.2 in Godot), pitched ~55 deg so trunks get a rim. Shadows only from this one light.
* Fairy: warm point light (#ffc27a), range 6-7 m, energy ~2.5-3.5, **no shadow**. Pale stones/planks/gate stone are the brightest albedo in the kit so the fairy pool reveals the route; the amber lantern glow and the warm planks contrast the cool fog.
* Optional: one shared low-energy no-shadow OmniLight (range 5, teal #7fe8d4, energy 0.5) per two `lantern_post`s and one large one at the heart-tree orb (range 12, cyan, energy 1.2). Do not attach lights to fungi/reeds.
* Environment glow ON, intensity ~0.7, bloom 0.1, HDR threshold 0.9. Everything not marked `gf_glow` stays under that threshold.

## Performance budget
* Kit unique tris {total}; placed worst case {inst_tris}. LOD: pieces at 25-60 m fade via visibility range; big pieces (trees, gate, heart) to 100-140 m. No skinned meshes, no alpha-blended materials, no per-instance lights.
* Draw calls: 5 materials x per-asset MultiMesh = at most {len(stats)} MultiMesh draws.

## Assets
| asset | category | size W x H x D (m) | tris | placed | glb |
|---|---|---|---|---|---|
{rows}

## Known limits / ideas not done
* No hand-made LOD meshes; use Godot's automatic LOD on import or visibility ranges.
* Water is not part of the kit (the source ground/water plane is used); `water_pool` is a tinted flat disc only.
* Lantern arms extend 0.75 m; the source glow_light positions (+-6..10, z 14..-16) are left to Codex to retire or keep.
* GLBs list both `COLOR_0` and `COLOR_1` (the Blender exporter writes the same colour set twice); `COLOR_1` is ignored by Godot and can be stripped.
* Not imported into Godot in this commission (no live checkout access): vertex-colour albedo, emission and 5-material sharing need a quick check on first import. Collision shapes are intent only.
* Source gameplay geometry that overlaps kit pieces (spiral mushroom stems, `TreeAdapter` trees, arch/rocks at z=-19) has not been reconciled.
* Previews are Blender Eevee with a volumetric fog stand-in; the Godot look will differ slightly in fog and tonemapping.
"""
    with open(os.path.join(HERE, "HANDOFF.md"), "w", encoding="utf-8") as f:
        f.write(txt)


if __name__ == "__main__":
    main()
