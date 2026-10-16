"""Kingsfell, the woodsman-king's axe - reproducible Blender (bpy 4.5/5.0) builder.

Run:  python3.11 build_kingsfell.py -- [--out path.glb] [--render dir] [--samples 48] [--views a,b]

Identity: a big, sleek bearded war axe for felling whole groves. The blade is ringsteel: steel folded so its pattern
reads like the growth rings of a great tree, radiating from an amber heartstone set in the cheek (the tree's heart,
sealed in steel). Gold sap-veins branch from the heartstone to the honed edge like roots, and carry its light there.
A hooked horn rises above the eye, the beard drops below it, and a blackened octagonal eye and hammer poll make it
sturdy. A dark stained ash haft with long steel langets, an oxblood leather wrap and a faceted pommel.

Frame: Blender X = edge forward, Z = up the haft, Y = blade thickness, metres. glTF export makes that +X forward,
+Y up, Z thickness (the same contract as the axe it replaces, so grips, holsters and sockets carry over).
Runtime node contract (client/asset-pose.js, weapon-readiness.js, kingsfell-luminance.js):
  Grip_Center, CuttingEdge_Top / _Mid / _Bottom (on the edge arc), Head_Center, Poll_Face, Heartstone,
  meshes Head_Blade (cheek), Head_CuttingEdge (honed bevel), Heart_Amber, Veins_Gold.
Materials: KF_Steel_Ring, KF_Steel_Edge, KF_Steel_Forged, KF_Wood_Haft, KF_Leather, KF_Gold, KF_Amber, KF_Vein.
Vein meshes carry their path in UV: u = 0 at the heartstone .. 1 at the edge, v = across the vein.
"""
import bpy, bmesh, math, json, os, sys, time
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'axe.glb'))
RENDER = arg('--render')
TAU = math.tau
rng = np.random.default_rng(7)

# ------------------------------------------------------------------ dimensions (shared with the runtime)
EDGE_C = (0.1226, 0.635)      # edge arc centre (x, z)
EDGE_R = 0.3674               # edge arc radius (apex)
EDGE_SPAN = math.atan2(0.235, 0.405 - EDGE_C[0])   # half the arc's angle
EYE_X = 0.022                 # inner boundary of the blade (inside the eye)
EYE_Z = (0.615, 0.800)        # blade root on the eye, bottom and top
HEART = (0.168, 0.668)        # heartstone centre (x, z)
HEART_R = 0.030
SB = 0.885                    # where the cheek ends and the honed bevel begins (blade parameter s)
HAFT = (-0.058, 0.832)        # haft z range
GRIP = (0.004, 0.250)         # leather wrap z range
EYE = (0.596, 0.816)          # eye (socket) z range
POLL_Z = 0.708

def edge_point(t):
    a = -EDGE_SPAN + 2 * EDGE_SPAN * t
    return np.array([EDGE_C[0] + EDGE_R * math.cos(a), EDGE_C[1] + EDGE_R * math.sin(a)])
def bezier(p0, p1, p2, p3, u):
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3)); w = 1 - u
    return w**3 * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u**3 * p3
A_B, A_T = np.array([EYE_X, EYE_Z[0]]), np.array([EYE_X, EYE_Z[1]])
B_TIP, H_TIP = edge_point(0), edge_point(1)
def top(s): return bezier(A_T, (0.20, 0.792), (0.355, 0.795), H_TIP, s)        # rising spine to the hooked horn
def bottom(s): return bezier(A_B, (0.16, 0.606), (0.315, 0.560), B_TIP, s)    # the beard sweeps down
def left(t): return A_B + (A_T - A_B) * t
def blade(s, t):
    """Coons patch over the four boundary curves: s = 0 eye .. 1 edge, t = 0 beard .. 1 horn."""
    return ((1 - s) * left(t) + s * edge_point(t) + (1 - t) * bottom(s) + t * top(s)
            - ((1 - s) * (1 - t) * A_B + s * (1 - t) * B_TIP + (1 - s) * t * A_T + s * t * H_TIP))
def chamfer(t):
    k = min(t, 1 - t) / 0.055
    return 0.5 + 0.5 * min(1.0, k)
def cheek_thickness(s, t):
    base = 0.0215 + (0.0062 - 0.0215) * (s / SB) ** 0.8
    return base * chamfer(t) * (1 + .14 * math.sin(math.pi * t) * (1 - s))
def half_thickness(s, t):
    if s <= SB: return cheek_thickness(s, t)
    f = ((s - SB) / (1 - SB)) ** 0.9            # the honed bevel starts exactly where the cheek ends
    return cheek_thickness(SB, t) * (1 - f) + 0.0005 * f

# ------------------------------------------------------------------ textures (numpy, deterministic)
def fbm(x, y, octaves=5, seed=0):
    out = np.zeros_like(x); amp = 0.5; f = 1.0
    g = np.random.default_rng(seed)
    for _ in range(octaves):
        ph = g.uniform(0, TAU, 4); fx, fy = g.uniform(.7, 1.3, 2)
        out += amp * (np.sin(x * f * 6.1 * fx + ph[0] + np.sin(y * f * 4.3 + ph[1]) * 1.3)
                      * np.cos(y * f * 5.7 * fy + ph[2] + np.cos(x * f * 3.9 + ph[3]) * 1.1))
        amp *= .5; f *= 2.03
    return out
def image(name, rgb, alpha=None, colour=True):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())    # row 0 = v 0 (Blender rows run bottom-up, like UV v)
    if not colour: img.colorspace_settings.name = 'Non-Color'
    img.pack(); return img
def srgb(c): return np.asarray(c, np.float32)

# Cheek UV: planar over the head, u = x / 0.52, v = (z - 0.36) / 0.56.
def cheek_uv(x, z): return x / 0.52, (z - 0.36) / 0.56
def ring_textures(n=1024):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    x, z = u * 0.52, v * 0.56 + 0.36
    dx, dz = x - HEART[0], (z - HEART[1]) * 1.12
    r = np.hypot(dx, dz)
    warp = fbm(x * 9, z * 9, 5, 3) * .012 + fbm(x * 31, z * 31, 3, 4) * .003
    phase = (r + warp) * 26.0                                   # ~3.8 mm growth rings in steel
    ring_id = np.floor(phase); f = phase - ring_id
    late = np.exp(-((f - .78) / .07) ** 2)                      # thin bright 'latewood' line in each ring
    vary = 0.75 + 0.25 * np.sin(ring_id * 12.9898) ** 2
    layer = np.clip(late * vary + 0.18 * (1 - f), 0, 1)
    knots = np.clip(fbm(x * 14, z * 14, 3, 9) * 1.6, 0, 1)
    dark, light = srgb((.070, .074, .084)), srgb((.36, .37, .39))
    alb = dark + (light - dark) * layer[..., None] * (0.82 + 0.18 * knots[..., None])
    # a cool blued temper toward the bevel and a faint warm bloom round the heartstone
    edge_d = EDGE_R - np.hypot(x - EDGE_C[0], z - EDGE_C[1])
    blue = np.clip(1 - edge_d / 0.09, 0, 1) ** 2
    alb = alb * (1 - .35 * blue[..., None]) + srgb((.035, .055, .10)) * (.55 * blue[..., None])
    warm = np.exp(-(r / 0.05) ** 2)
    alb = alb + srgb((.10, .045, .01)) * warm[..., None] * .6
    rough = 0.50 - 0.20 * layer + 0.05 * fbm(x * 60, z * 60, 2, 11)
    mr = np.stack([np.zeros_like(rough), np.clip(rough, .12, .9), np.ones_like(rough)], -1)
    return image('KF_Ring_Albedo', alb), image('KF_Ring_MR', mr, colour=False)
def edge_textures(n=512):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    x, z = u * 0.52, v * 0.56 + 0.36
    rad = np.hypot(x - EDGE_C[0], z - EDGE_C[1]); ang = np.arctan2(z - EDGE_C[1], x - EDGE_C[0])
    grind = fbm(rad * 900, ang * 4, 3, 21) * .5 + 0.5
    alb = srgb((.46, .48, .51)) * (0.80 + 0.20 * grind[..., None])
    apex = np.clip((rad - (EDGE_R - 0.006)) / 0.006, 0, 1)
    alb = alb * (1 - apex[..., None] * .0) + srgb((.92, .93, .95)) * apex[..., None] * .25
    rough = np.clip(0.26 - 0.12 * apex + 0.08 * (grind - .5), .06, .5)
    mr = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    return image('KF_Edge_Albedo', alb), image('KF_Edge_MR', mr, colour=False)
def forged_textures(n=512):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    # hammer dimples: soft cells from a jittered grid
    cells = 18; gx, gy = u * cells, v * cells
    best = np.full(u.shape, 9.0); h = np.zeros_like(u)
    jit = rng.uniform(0, 1, (cells + 2, cells + 2, 2))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx = np.floor(gx) + ox; cy = np.floor(gy) + oy
            j = jit[(cy.astype(int) % cells) + 1, (cx.astype(int) % cells) + 1]
            d = np.hypot(gx - (cx + j[..., 0]), gy - (cy + j[..., 1]))
            best = np.minimum(best, d)
    dimple = np.clip(best, 0, .75) / .75                         # 0 in a dimple's centre .. 1 at the ridge
    noise = fbm(u * 8, v * 8, 4, 31)
    alb = srgb((.15, .135, .125)) * (0.80 + 0.30 * dimple[..., None] + 0.12 * noise[..., None])
    rough = np.clip(.66 - .16 * dimple + .06 * noise, .35, .85)
    mr = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    hgt = (dimple ** 2) * 1.0
    gy_, gx_ = np.gradient(hgt)
    nrm = np.stack([-gx_ * 18, -gy_ * 18, np.ones_like(hgt)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return image('KF_Forged_Albedo', alb), image('KF_Forged_MR', mr, colour=False), image('KF_Forged_Normal', nrm * .5 + .5, colour=False)
def wood_textures(w=256, h=1024):
    v, u = np.mgrid[0:h, 0:w].astype(np.float64); v /= h - 1; u /= w - 1
    grain = np.sin((u * 26 + fbm(u * 3, v * 2, 4, 41) * 1.8 + fbm(u * 20, v * 40, 2, 43) * .15) * TAU)
    fine = fbm(u * 60, v * 400, 2, 47)
    t = 0.5 + 0.5 * np.tanh(grain * 1.8)
    alb = srgb((.105, .055, .030)) + (srgb((.215, .120, .062)) - srgb((.105, .055, .030))) * t[..., None]
    alb *= (0.92 + 0.08 * fine[..., None])
    rough = np.clip(.62 - .12 * t + .04 * fine, .3, .85)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    return image('KF_Wood_Albedo', alb), image('KF_Wood_MR', mr, colour=False)
def leather_textures(n=256):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    pebble = fbm(u * 30, v * 30, 3, 51); crease = np.abs(fbm(u * 7, v * 7, 3, 53))
    alb = srgb((.205, .062, .045)) * (0.85 + 0.12 * pebble[..., None] - 0.18 * crease[..., None])
    rough = np.clip(.66 + .12 * pebble, .4, .9)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    return image('KF_Leather_Albedo', alb), image('KF_Leather_MR', mr, colour=False)

# ------------------------------------------------------------------ materials
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
def pbr(name, albedo=None, mr=None, normal=None, colour=(1, 1, 1), metal=0.0, rough=.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if albedo:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = albedo; nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if mr:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = mr
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(t.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = .6
        nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    return m
ring_a, ring_mr = ring_textures(); edge_a, edge_mr = edge_textures(); forged_a, forged_mr, forged_n = forged_textures()
wood_a, wood_mr = wood_textures(); leather_a, leather_mr = leather_textures()
MATS = {
    'KF_Steel_Ring': pbr('KF_Steel_Ring', ring_a, ring_mr),
    'KF_Steel_Edge': pbr('KF_Steel_Edge', edge_a, edge_mr),
    'KF_Steel_Forged': pbr('KF_Steel_Forged', forged_a, forged_mr, forged_n),
    'KF_Wood_Haft': pbr('KF_Wood_Haft', wood_a, wood_mr),
    'KF_Leather': pbr('KF_Leather', leather_a, leather_mr),
    'KF_Gold': pbr('KF_Gold', colour=(.93, .62, .22), metal=1.0, rough=.26),
    'KF_Amber': pbr('KF_Amber', colour=(.85, .30, .02), metal=0.0, rough=.06, emit=(1.0, .34, .02), strength=.8),
    'KF_Vein': pbr('KF_Vein', colour=(.95, .66, .24), metal=1.0, rough=.22, emit=(1.0, .42, .05), strength=0.6),
}

ROOT = bpy.data.objects.new('Kingsfell', None); SC.collection.objects.link(ROOT)
def empty(name, loc):
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o)
    o.parent = ROOT; o.location = Vector(loc); return o
def mesh_obj(name, bm, mat, smooth_angle=None, flat=False):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    me.materials.append(MATS[mat])
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o); o.parent = ROOT
    if smooth_angle is not None and not flat:
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    return o
def set_uvs(bm, fn):
    """fn(BMLoop) -> (u, v)."""
    layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops: l[layer].uv = fn(l)
def ring_section(bm, center, rx, ry, sides, phase=0.0):
    out = []
    for k in range(sides):
        a = phase + TAU * k / sides
        out.append(bm.verts.new((center[0] + math.cos(a) * rx, center[1] + math.sin(a) * ry, center[2])))
    return out
def loft(bm, rings, cap_start=False, cap_end=False):
    n = len(rings[0]); faces = []
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            faces.append(bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
    if cap_start: faces.append(bm.faces.new(list(reversed(rings[0]))))
    if cap_end: faces.append(bm.faces.new(rings[-1]))
    return faces
def lathe(name, mat, profile, sides, center=(0.0, 0.0), squash=1.0, phase=None, smooth=None, flat=False, uvfn=None):
    """profile: [(z, radius)] bottom-up. Octagonal by default (phase puts a flat facing the edge)."""
    bm = bmesh.new(); ph = math.pi / sides if phase is None else phase
    rings = [ring_section(bm, (center[0], center[1], z), r, r * squash, sides, ph) for z, r in profile]
    loft(bm, rings, True, True)
    if uvfn: set_uvs(bm, uvfn)
    return mesh_obj(name, bm, mat, smooth, flat)

# ------------------------------------------------------------------ the blade (cheek + honed bevel)
S_CHEEK = [0, .03, .07, .12, .18, .25, .33, .41, .49, .57, .65, .72, .77, SB]
S_BEVEL = [SB, SB + .02, SB + .045, SB + .07, SB + .09, 1.0]
T_ROWS = sorted(set([0, .025, .055, .945, .975, 1] + [round(.055 + .89 * k / 22, 4) for k in range(23)]))
def blade_mesh(name, s_rows, mat, smooth=26):
    bm = bmesh.new(); front, back = [], []
    for s in s_rows:
        fr, br = [], []
        for t in T_ROWS:
            x, z = blade(s, t); h = half_thickness(s, t)
            fr.append(bm.verts.new((x, -h, z))); br.append(bm.verts.new((x, h, z)))
        front.append(fr); back.append(br)
    ns, nt = len(s_rows), len(T_ROWS)
    for i in range(ns - 1):
        for j in range(nt - 1):
            bm.faces.new((front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1]))
            bm.faces.new((back[i][j], back[i][j + 1], back[i + 1][j + 1], back[i + 1][j]))
    for i in range(ns - 1):   # spine and beard walls
        bm.faces.new((front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]))
        bm.faces.new((front[i][-1], front[i + 1][-1], back[i + 1][-1], back[i][-1]))
    if s_rows[-1] == 1.0:      # the very edge: a hair-thin closing strip
        for j in range(nt - 1):
            bm.faces.new((front[-1][j], back[-1][j], back[-1][j + 1], front[-1][j + 1]))
    set_uvs(bm, lambda l: cheek_uv(l.vert.co.x, l.vert.co.z))
    return mesh_obj(name, bm, mat, smooth_angle=smooth)
blade_mesh('Head_Blade', S_CHEEK, 'KF_Steel_Ring')
blade_mesh('Head_CuttingEdge', S_BEVEL, 'KF_Steel_Edge', smooth=85)

# Blade-space lookup for things that sit on the cheek: (s, t) -> point on the front face (y = -h).
def on_cheek(s, t, lift=0.0, side=-1):
    x, z = blade(s, t); return Vector((x, side * (half_thickness(s, t) + lift), z))

# ------------------------------------------------------------------ sap veins: gold roots from the heartstone to the edge
def heart_st():
    # invert the patch numerically for the heartstone centre
    best = (9, 0, 0)
    for s in np.linspace(0, SB, 120):
        for t in np.linspace(0, 1, 120):
            p = blade(s, t); d = (p[0] - HEART[0]) ** 2 + (p[1] - HEART[1]) ** 2
            if d < best[0]: best = (d, s, t)
    return best[1], best[2]
HS, HT = heart_st()
TRUNKS = [  # (start, c1, c2, fork) in blade (s, t), then the two twig ends at the bevel; widths in metres
    ([(HS + .075, HT - .005), (.40, HT - .02), (.50, HT - .03), (.60, HT - .045)], (SB - .003, .575), (SB - .003, .405), .0105),
    ([(HS + .045, HT + .075), (.30, HT + .15), (.42, .79), (.55, .815)], (SB - .003, .925), (SB - .003, .745), .0090),
    ([(HS + .045, HT - .085), (.29, HT - .20), (.40, .32), (.52, .265)], (SB - .003, .225), (SB - .003, .075), .0090),
]
FORK_U = .58
def path_points(ctrl, n):
    return [(k / n, *bezier(*ctrl, k / n)) for k in range(n + 1)]
def vein_ribbons():
    """Yields (points[(u, s, t)], w0, w1) for every trunk and twig. u is the light's path: 0 heart .. 1 edge."""
    for ctrl, end_a, end_b, w in TRUNKS:
        yield [(FORK_U * u, s_, t_) for u, s_, t_ in path_points(ctrl, 10)], w, w * .62
        fork = np.array(ctrl[-1]); d = fork - np.array(ctrl[-2]); d = d / np.linalg.norm(d)
        for end in (end_a, end_b):
            end = np.array(end); c1 = fork + d * .07; c2 = end - np.array([.06, 0])
            yield [(FORK_U + (1 - FORK_U) * u, s_, t_) for u, s_, t_ in path_points([fork, c1, c2, end], 8)], w * .6, w * .34
def build_veins():
    core = bmesh.new(); groove = bmesh.new(); uv_of = {}
    for side in (-1, 1):
        for pts, w0, w1 in vein_ribbons():
            xz = [Vector((*blade(s_, t_), 0)) for _, s_, t_ in pts]
            for bm, scale, lifts, tag in ((groove, 1.75, ((-1, .0002), (1, .0002)), False), (core, 1.0, ((-1, .00045), (0, .00105), (1, .00045)), True)):
                rows = []
                for k, (u, s_, t_) in enumerate(pts):
                    q = xz[min(k + 1, len(xz) - 1)] - xz[max(k - 1, 0)]; nrm = Vector((-q.y, q.x, 0)).normalized()
                    w = (w0 + (w1 - w0) * (k / (len(pts) - 1))) * scale; base = half_thickness(s_, t_)
                    row = []
                    for a, lift in lifts:
                        c = xz[k] + nrm * a * w * .5
                        v = bm.verts.new((c.x, side * (base + lift), c.y)); row.append(v)
                        if tag: uv_of[v] = (u, (a + 1) / 2)
                    rows.append(row)
                for r0, r1 in zip(rows, rows[1:]):
                    for a in range(len(r0) - 1): bm.faces.new((r0[a], r1[a], r1[a + 1], r0[a + 1]))
    layer = core.loops.layers.uv.verify()
    for f in core.faces:
        for l in f.loops: l[layer].uv = uv_of[l.vert]
    set_uvs(groove, lambda l: (l.vert.co.x * 4, l.vert.co.z * 4))
    mesh_obj('Veins_Groove', groove, 'KF_Steel_Forged', smooth_angle=50)
    return mesh_obj('Veins_Gold', core, 'KF_Vein', smooth_angle=50)
build_veins()

# ------------------------------------------------------------------ heartstone: a faceted amber cabochon in a gold bezel, both cheeks
def heartstone():
    gem = bmesh.new(); bez = bmesh.new()
    for side in (-1, 1):
        base = half_thickness(HS, HT)
        c = Vector((HEART[0], side * base, HEART[1]))
        # bezel: a crisp 10-sided gold ring standing proud of the cheek
        outer = [Vector((c.x + math.cos(a) * (HEART_R + .007), c.y, c.z + math.sin(a) * (HEART_R + .007))) for a in np.linspace(0, TAU, 11)[:-1]]
        rings = []
        for r, lift in ((HEART_R + .0075, -.002), (HEART_R + .0075, .0035), (HEART_R + .002, .0050), (HEART_R - .001, .0030)):
            rings.append([bez.verts.new((c.x + math.cos(a) * r, c.y + side * lift, c.z + math.sin(a) * r)) for a in np.linspace(0, TAU, 11)[:-1] + math.pi / 10])
        loft(bez, rings)
        # amber: a stepped faceted dome (table on top), 10 facets per tier
        tiers = [(HEART_R + .0005, .0010), (HEART_R * .86, .0085), (HEART_R * .55, .0128), (HEART_R * .0, .0140)]
        rings = []
        for r, lift in tiers[:-1]:
            rings.append([gem.verts.new((c.x + math.cos(a) * r, c.y + side * lift, c.z + math.sin(a) * r)) for a in np.linspace(0, TAU, 11)[:-1]])
        loft(gem, rings, cap_start=True)
        apex = gem.verts.new((c.x, c.y + side * tiers[-1][1], c.z))
        last = rings[-1]
        for k in range(10): gem.faces.new((last[k], last[(k + 1) % 10], apex))
    set_uvs(gem, lambda l: (0.5 + (l.vert.co.x - HEART[0]) / (HEART_R * 2), 0.5 + (l.vert.co.z - HEART[1]) / (HEART_R * 2)))
    mesh_obj('Heart_Amber', gem, 'KF_Amber', flat=True)
    mesh_obj('Heart_Bezel', bez, 'KF_Gold', smooth_angle=35)
heartstone()

# ------------------------------------------------------------------ eye (socket), poll and fittings
def oct_profile_obj(name, mat, profile, rx_scale=1.0, cx=0.0, flat=False, smooth=30, uvbox=True):
    bm = bmesh.new(); rings = []
    for z, rx, ry in profile:
        rings.append(ring_section(bm, (cx, 0, z), rx * rx_scale, ry, 8, math.pi / 8))
    loft(bm, rings, True, True)
    if uvbox: set_uvs(bm, lambda l: ((l.vert.co.x + l.vert.co.y) * 4.0, l.vert.co.z * 4.0))
    return mesh_obj(name, bm, mat, smooth, flat)
# the eye: an octagonal collar, flared top and bottom
oct_profile_obj('Head_Socket', 'KF_Steel_Forged', [
    (EYE[0], .030, .030), (EYE[0] + .010, .036, .033), (EYE[0] + .020, .033, .0305),
    (EYE[1] - .022, .033, .0305), (EYE[1] - .010, .037, .034), (EYE[1], .031, .031)], cx=.004)
# the poll: a stout octagonal hammer face behind the eye
def poll():
    bm = bmesh.new(); rings = []
    for x, hz, hy in ((-.010, .046, .028), (-.060, .040, .026), (-.088, .043, .029), (-.100, .039, .025), (-.104, .034, .021)):
        ring = []
        for k in range(8):
            a = math.pi / 8 + TAU * k / 8
            ring.append(bm.verts.new((x, math.sin(a) * hy, POLL_Z + math.cos(a) * hz)))
        rings.append(ring)
    loft(bm, rings, True, True)
    set_uvs(bm, lambda l: (l.vert.co.x * 4.0, (l.vert.co.z + l.vert.co.y) * 4.0))
    return mesh_obj('Head_Poll', bm, 'KF_Steel_Forged', smooth_angle=30)
poll()
# gold poll cap band and eye bands
def band(name, z, r, ry, h, cx=0.0, mat='KF_Gold', sides=8):
    return oct_profile_obj(name, mat, [(z - h / 2, r, ry), (z - h / 2 + .001, r + .002, ry + .002), (z + h / 2 - .001, r + .002, ry + .002), (z + h / 2, r, ry)], cx=cx, uvbox=False)
band('Band_Eye_Top', EYE[1] + .004, .028, .028, .007, cx=.003)
band('Band_Eye_Base', EYE[0] - .004, .027, .027, .007, cx=.003)
def poll_cap():
    bm = bmesh.new(); rings = []
    for x, hz, hy in ((-.089, .046, .031), (-.097, .046, .031)):
        rings.append([bm.verts.new((x, math.sin(math.pi / 8 + TAU * k / 8) * hy, POLL_Z + math.cos(math.pi / 8 + TAU * k / 8) * hz)) for k in range(8)])
    loft(bm, rings, True, True)
    return mesh_obj('Poll_Band', bm, 'KF_Gold', smooth_angle=30)
poll_cap()
# wedge cap on top of the haft
oct_profile_obj('Cap_Wedge', 'KF_Gold', [(HAFT[1] - .016, .019, .016), (HAFT[1] - .004, .021, .018), (HAFT[1] + .004, .014, .012), (HAFT[1] + .007, .006, .005)], uvbox=False)

# ------------------------------------------------------------------ haft, langets, grip, pommel
def haft():
    bm = bmesh.new(); rings = []
    zs = np.linspace(HAFT[0], HAFT[1], 22)
    for z in zs:
        knob = max(0.0, (0.06 - z) / 0.12) ** 2           # swells toward the knob
        neck = math.exp(-((z - 0.40) / 0.12) ** 2) * -.0015 # slimmer just above the grip
        rx = .0232 * (1 + .24 * knob) + neck; ry = .0196 * (1 + .24 * knob) + neck
        rings.append(ring_section(bm, (0, 0, z), rx, ry, 8, math.pi / 8))
    loft(bm, rings, True, True)
    def uv(l):
        a = math.atan2(l.vert.co.y, l.vert.co.x) / TAU + .5
        return (a, (l.vert.co.z - HAFT[0]) / (HAFT[1] - HAFT[0]))
    set_uvs(bm, uv)
    return mesh_obj('Haft_Ironash', bm, 'KF_Wood_Haft', smooth_angle=30)
haft()
def langets():
    bm = bmesh.new()
    for side in (-1, 1):
        # a long steel strap on each flat of the haft, pointed at the bottom, tucked under the eye
        pts = [(-.0065, .372), (0.0, .352), (.0065, .372), (.0075, EYE[0] + .01), (-.0075, EYE[0] + .01)]
        ry = .0200
        outer = [bm.verts.new((x, side * (ry + .0032), z)) for x, z in pts]
        inner = [bm.verts.new((x, side * (ry - .0004), z)) for x, z in pts]
        bm.faces.new(outer if side > 0 else list(reversed(outer)))
        bm.faces.new(list(reversed(inner)) if side > 0 else inner)
        for k in range(len(pts)):
            a, b = k, (k + 1) % len(pts)
            bm.faces.new((outer[a], inner[a], inner[b], outer[b]))
    set_uvs(bm, lambda l: (l.vert.co.x * 4 + .5, l.vert.co.z * 4))
    return mesh_obj('Langets', bm, 'KF_Steel_Forged', flat=True)
langets()
def rivets():
    bm = bmesh.new()
    for side in (-1, 1):
        for z in (.40, .465, .535):
            c = Vector((0, side * (.0200 + .0032), z))
            ring = [bm.verts.new((c.x + math.cos(a) * .0036, c.y, c.z + math.sin(a) * .0036)) for a in np.linspace(0, TAU, 7)[:-1]]
            top = bm.verts.new((c.x, c.y + side * .0022, c.z))
            for k in range(6):
                f = (ring[k], ring[(k + 1) % 6], top); bm.faces.new(f if side > 0 else tuple(reversed(f)))
    return mesh_obj('Rivets_Gold', bm, 'KF_Gold', smooth_angle=60)
rivets()
def grip():
    bm = bmesh.new(); rings = []; sides = 12
    zs = np.linspace(GRIP[0], GRIP[1], 44)
    for z in zs:
        knob = max(0.0, (0.06 - z) / 0.12) ** 2
        ring = []
        for k in range(sides):
            a = TAU * k / sides
            phase = (z - GRIP[0]) / .0165 * TAU - a          # one helical wrap every 16.5 mm
            ridge = .0018 * (0.5 + 0.5 * math.cos(phase)) ** 3
            rx = (.0252 * (1 + .24 * knob)) + ridge; ry = (.0214 * (1 + .24 * knob)) + ridge
            ring.append(bm.verts.new((math.cos(a) * rx, math.sin(a) * ry, z)))
        rings.append(ring)
    # taper the wrap's ends into the haft
    for ring, s in ((rings[0], .93), (rings[-1], .93)):
        for v in ring: v.co.x *= s; v.co.y *= s
    loft(bm, rings)
    set_uvs(bm, lambda l: (math.atan2(l.vert.co.y, l.vert.co.x) / TAU + .5, l.vert.co.z * 5))
    return mesh_obj('Grip_LeatherWrap', bm, 'KF_Leather', smooth_angle=70)
grip()
band('Band_Grip_Top', GRIP[1] + .006, .0242, .0204, .010)
band('Band_Haft_Mid', .318, .0230, .0194, .006)
def pommel():
    return oct_profile_obj('Pommel', 'KF_Steel_Forged', [
        (HAFT[0] - .030, .016, .016), (HAFT[0] - .024, .027, .025), (HAFT[0] - .012, .030, .028),
        (HAFT[0] - .002, .026, .024), (HAFT[0] + .004, .025, .022)])
pommel()
band('Band_Pommel', HAFT[0] + .006, .0300, .0258, .006)
# a small amber pip in the pommel's foot: the same heart, echoed
def pommel_pip():
    bm = bmesh.new(); z = HAFT[0] - .030
    ring = [bm.verts.new((math.cos(a) * .0105, math.sin(a) * .0105, z)) for a in np.linspace(0, TAU, 9)[:-1]]
    mid = [bm.verts.new((math.cos(a) * .0065, math.sin(a) * .0065, z - .0045)) for a in np.linspace(0, TAU, 9)[:-1] + math.pi / 8]
    tip = bm.verts.new((0, 0, z - .0062))
    for k in range(8):
        bm.faces.new((ring[k], mid[k], mid[(k - 1) % 8])); bm.faces.new((ring[k], ring[(k + 1) % 8], mid[k]))
        bm.faces.new((mid[k], tip, mid[(k - 1) % 8]))
    set_uvs(bm, lambda l: (.5, .5))
    return mesh_obj('Pommel_Amber', bm, 'KF_Amber', flat=True)
pommel_pip()

# ------------------------------------------------------------------ sockets
empty('Grip_Center', (0.0075, 0, 0.120))
for name, t in (('CuttingEdge_Bottom', .08), ('CuttingEdge_Mid', .5), ('CuttingEdge_Top', .92)):
    x, z = edge_point(t); empty(name, (float(x), 0, float(z)))
empty('Head_Center', (0.205, 0, 0.650))
empty('Poll_Face', (-0.104, 0, POLL_Z))
empty('Heartstone', (HEART[0], 0, HEART[1]))

# ------------------------------------------------------------------ checks + export
def tri_count():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SC.objects if o.type == 'MESH')
def bounds():
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in SC.objects:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi
bpy.context.view_layer.update()
lo, hi = bounds()
REPORT = {'triangles': tri_count(), 'meshes': sum(1 for o in SC.objects if o.type == 'MESH'), 'nodes': len(SC.objects),
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi],
          'edge': {'center': EDGE_C, 'radius': EDGE_R, 'span': EDGE_SPAN}, 'heart': HEART}
assert REPORT['triangles'] < 8000, REPORT
for name in ('Grip_Center', 'CuttingEdge_Mid', 'CuttingEdge_Top', 'CuttingEdge_Bottom', 'Head_Center', 'Poll_Face', 'Heartstone',
             'Head_Blade', 'Head_CuttingEdge', 'Heart_Amber', 'Veins_Gold'):
    assert name in bpy.data.objects, name

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_materials='EXPORT', export_normals=True, export_texcoords=True, export_extras=False,
                          export_image_format='AUTO')
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ------------------------------------------------------------------ optional review renders
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    SC.render.resolution_x, SC.render.resolution_y = 1000, 1000
    SC.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    nt = w.node_tree; bg = nt.nodes['Background']; bg.inputs[1].default_value = .9
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], ramp.inputs[0]); nt.links.new(ramp.outputs[0], bg.inputs[0])
    cr = ramp.color_ramp; cr.elements[0].position = .44; cr.elements[0].color = (.16, .13, .09, 1)
    cr.elements[1].position = .62; cr.elements[1].color = (.30, .52, .85, 1)
    e = cr.elements.new(.505); e.color = (.82, .84, .80, 1)
    def light(loc, e, s=.6, col=(1, 1, 1), at=(0.15, 0, .55)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((1.0, -1.3, 1.5), 240, col=(1, .93, .82)); light((-1.2, .9, .9), 110, col=(.72, .84, 1)); light((0.3, 1.5, 1.4), 70)
    glow = bpy.data.lights.new('heart', 'POINT'); glow.energy = .35; glow.color = (1, .55, .15); glow.shadow_soft_size = .01
    for side in (-1, 1):
        go = bpy.data.objects.new('heart', glow); go.location = (HEART[0], side * .03, HEART[1]); SC.collection.objects.link(go)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {'full': ((.15, -1.55, .40), (.17, 0, .39), 42), 'three-quarter': ((1.1, -1.5, .9), (.14, 0, .42), 45),
             'head': ((.24, -.75, .66), (.22, 0, .64), 50), 'edge-on': ((1.3, -.05, .66), (.2, 0, .64), 60),
             'heart': ((.17, -.32, .70), (.17, 0, .67), 55), 'back': ((-.9, 1.6, .7), (.12, 0, .45), 45),
             'first-person': ((-.30, -.36, .30), (.15, .05, .66), 30)}
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
