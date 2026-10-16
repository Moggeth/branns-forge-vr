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
    th = base * chamfer(t) * (1 + .14 * math.sin(math.pi * t) * (1 - s))
    # the heartstone sits on a low forged boss, and a shallow hollow grind runs just inside the bevel: both catch light
    x, z = blade(s, t); d = math.hypot(x - HEART[0], (z - HEART[1]) * 1.12)
    boss = .0032 * math.exp(-(d / .058) ** 2)
    hollow = -.0011 * math.exp(-((s - .79) / .055) ** 2) * math.sin(math.pi * t) ** .5
    return th + boss + hollow
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
    img = bpy.data.images.new(name, w, h, alpha=False, is_data=not colour)
    if not colour: img.colorspace_settings.name = 'Non-Color'   # before the pixels: changing it afterwards drops them
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())    # row 0 = v 0 (Blender rows run bottom-up, like UV v)
    img.pack(); return img
def srgb(c): return np.asarray(c, np.float32)
def normal_map(name, hgt, strength):
    """Tangent-space normal map from a height field (rows = v, cols = u)."""
    gy_, gx_ = np.gradient(hgt.astype(np.float64))
    n = np.stack([-gx_ * strength, -gy_ * strength, np.ones_like(hgt)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return image(name, n * .5 + .5, colour=False)

# Cheek UV: planar over the head, u = x / 0.52, v = (z - 0.36) / 0.56.
def cheek_uv(x, z): return x / 0.52, (z - 0.36) / 0.56
def ring_textures(n=1024):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    x, z = u * 0.52, v * 0.56 + 0.36
    dx, dz = x - HEART[0], (z - HEART[1]) * 1.12
    r = np.hypot(dx, dz)
    warp = fbm(x * 9, z * 9, 5, 3) * .012 + fbm(x * 31, z * 31, 3, 4) * .003
    phase = (r + warp) * 34.0                                   # ~2.9 mm growth rings in steel
    ring_id = np.floor(phase); f = phase - ring_id
    late = np.exp(-((f - .78) / .07) ** 2)                      # thin bright 'latewood' line in each ring
    vary = 0.75 + 0.25 * np.sin(ring_id * 12.9898) ** 2
    layer = np.clip(late * vary + 0.18 * (1 - f), 0, 1)
    knots = np.clip(fbm(x * 14, z * 14, 3, 9) * 1.6, 0, 1)
    dark, light = srgb((.15, .155, .17)), srgb((.54, .55, .58))   # etched-dark and bright layers of polished steel
    alb = dark + (light - dark) * layer[..., None] * (0.82 + 0.18 * knots[..., None])
    # a cool blued temper toward the bevel and a faint warm bloom round the heartstone
    edge_d = EDGE_R - np.hypot(x - EDGE_C[0], z - EDGE_C[1])
    blue = np.clip(1 - edge_d / 0.09, 0, 1) ** 2
    alb = alb * (1 - .35 * blue[..., None]) + srgb((.035, .055, .10)) * (.55 * blue[..., None])
    warm = np.exp(-(r / 0.05) ** 2)
    alb = alb + srgb((.10, .045, .01)) * warm[..., None] * .6
    rough = 0.50 - 0.20 * layer + 0.05 * fbm(x * 60, z * 60, 2, 11)
    mr = np.stack([np.zeros_like(rough), np.clip(rough, .12, .9), np.ones_like(rough)], -1)
    # relief: each latewood line stands a hair proud (acid-etched damascus), knots swell, so the rings catch the light
    folds = np.exp(-((((phase * 3) % 1) - .5) / .12) ** 2) * .18          # the fold lines inside each ring
    hgt = late * vary * .6 + folds + knots * .08
    return image('KF_Ring_Albedo', alb), image('KF_Ring_MR', mr, colour=False), normal_map('KF_Ring_Normal', hgt, 2.4)
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
    # hone scratches run along the edge (tangential), finer toward the apex
    hgt = np.sin(rad * 5200 + fbm(ang * 30, rad * 40, 2, 22) * 3) * .5 * (1 - apex) + grind * .2
    return image('KF_Edge_Albedo', alb), image('KF_Edge_MR', mr, colour=False), normal_map('KF_Edge_Normal', hgt, 1.2)
def forged_textures(n=512):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    alb, rough, hgt = forged_parts(u, v)
    mr = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    return image('KF_Forged_Albedo', alb), image('KF_Forged_MR', mr, colour=False), normal_map('KF_Forged_Normal', hgt, 7)
def forged_parts(u, v):
    """Blackened hammer-forged steel: (albedo, roughness, height)."""
    # hammer dimples: soft cells from a jittered grid
    cells = 28; gx, gy = u * cells, v * cells
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
    # blackened, with the high spots rubbed back to bright steel by use
    alb = srgb((.12, .108, .10)) * (0.80 + 0.30 * dimple[..., None] + 0.12 * noise[..., None])
    rub = np.clip((dimple - .72) / .28, 0, 1) ** 2 * np.clip(noise * 2 + .6, 0, 1)
    alb = alb + (srgb((.42, .42, .43)) - alb) * rub[..., None] * .55
    rough = np.clip(.62 - .16 * dimple + .06 * noise - .25 * rub, .25, .85)
    return alb, rough, dimple ** 2
def socket_textures(n=512):
    """Blackened forged steel with a gold-inlaid interlace: two vines braided round the eye, an oak leaf at each crossing."""
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    fa, fm_, fn = forged_parts(u, v)
    a = v - .5 - .26 * np.sin(TAU * u); b = v - .5 + .26 * np.sin(TAU * u)
    over = np.sin(TAU * u) > 0                                    # which vine passes over at each crossing
    ga = np.exp(-(a / .032) ** 6); gb = np.exp(-(b / .032) ** 6)
    gb = gb * np.clip(1 - (~over) * np.exp(-(a / .10) ** 2) * 1.0, 0, 1); ga = ga * np.clip(1 - over * np.exp(-(b / .10) ** 2), 0, 1)
    # leaves: a little almond at each peak/trough
    lx = ((u * 2 + .25) % 1) - .5; ly = np.where(np.sin(TAU * u) > 0, v - .5 - .26, v - .5 + .26)
    leaf = (np.clip(1 - ((lx / .13) ** 2 + (ly / .065) ** 2), 0, 1) > 0) * 1.0 * (np.abs(np.sin(TAU * u)) > .85)
    gold = np.clip(np.maximum(np.maximum(ga, gb), leaf), 0, 1)
    goldc = srgb((.78, .52, .19)) * (0.85 + .15 * fbm(u * 40, v * 40, 2, 61)[..., None])
    alb = fa * (1 - gold[..., None]) + goldc * gold[..., None]
    rough = fm_ * (1 - gold) + .24 * gold; metal = gold * 1.0 + (1 - gold) * 0.0
    mr = np.stack([np.zeros_like(rough), rough, metal], -1)
    hgt = fn - gold * .35 + np.clip(gold * 1.2, 0, 1) * .0                          # inlay sits just below the steel
    return image('KF_Socket_Albedo', alb), image('KF_Socket_MR', mr, colour=False), normal_map('KF_Socket_Normal', hgt, 7)
def stamp_textures(n=256):
    """The smith's mark punched into the poll: a crowned tree in a ring."""
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    fa, fm_, fn = forged_parts(u * 2.2, v * 2.2)
    x, y = u - .5, v - .5; r = np.hypot(x, y)
    ring = np.exp(-((r - .36) / .022) ** 2)
    trunk = (np.abs(x) < .028) & (y > -.24) & (y < .02)
    tiers = np.zeros_like(r, bool)
    for cy, w in ((-.02, .19), (.07, .15), (.15, .10)):
        tiers |= (y > cy) & (y < cy + .11) & (np.abs(x) < w * (1 - (y - cy) / .11))
    crown = (y > .24) & (y < .30) & (np.abs(x) < .12) & ((np.abs(x) % .06) < .035)
    mark = np.clip(ring + trunk + tiers + crown, 0, 1)
    alb = fa * (1 - .55 * mark[..., None])
    rough = np.clip(fm_ + .15 * mark, .3, .9); mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    return image('KF_Stamp_Albedo', alb), image('KF_Stamp_MR', mr, colour=False), normal_map('KF_Stamp_Normal', fn * .5 - mark * .9, 8)
def wood_textures(w=256, h=1024):
    v, u = np.mgrid[0:h, 0:w].astype(np.float64); v /= h - 1; u /= w - 1
    grain = np.sin((u * 26 + fbm(u * 3, v * 2, 4, 41) * 1.8 + fbm(u * 20, v * 40, 2, 43) * .15) * TAU)
    fine = fbm(u * 60, v * 400, 2, 47)
    t = 0.5 + 0.5 * np.tanh(grain * 1.8)
    alb = srgb((.105, .055, .030)) + (srgb((.215, .120, .062)) - srgb((.105, .055, .030))) * t[..., None]
    alb *= (0.92 + 0.08 * fine[..., None])
    rough = np.clip(.62 - .12 * t + .04 * fine, .3, .85)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    # open-pored ash: the soft earlywood sinks between the hard grain lines; years of hands polish the ridges
    hgt = t * .8 + fine * .2
    return image('KF_Wood_Albedo', alb), image('KF_Wood_MR', mr, colour=False), normal_map('KF_Wood_Normal', hgt, 4)
def leather_textures(n=256):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    pebble = fbm(u * 30, v * 30, 3, 51); crease = np.abs(fbm(u * 7, v * 7, 3, 53))
    alb = srgb((.205, .062, .045)) * (0.85 + 0.12 * pebble[..., None] - 0.18 * crease[..., None])
    rough = np.clip(.66 + .12 * pebble, .4, .9)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    hgt = pebble * .5 - crease * .8
    return image('KF_Leather_Albedo', alb), image('KF_Leather_MR', mr, colour=False), normal_map('KF_Leather_Normal', hgt, 6)

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
ring_a, ring_mr, ring_n = ring_textures(); edge_a, edge_mr, edge_n = edge_textures(); forged_a, forged_mr, forged_n = forged_textures()
wood_a, wood_mr, wood_n = wood_textures(); leather_a, leather_mr, leather_n = leather_textures()
sock_a, sock_mr, sock_n = socket_textures(); stamp_a, stamp_mr, stamp_n = stamp_textures()
MATS = {
    'KF_Steel_Ring': pbr('KF_Steel_Ring', ring_a, ring_mr, ring_n),
    'KF_Steel_Edge': pbr('KF_Steel_Edge', edge_a, edge_mr, edge_n),
    'KF_Steel_Forged': pbr('KF_Steel_Forged', forged_a, forged_mr, forged_n),
    'KF_Steel_Socket': pbr('KF_Steel_Socket', sock_a, sock_mr, sock_n),
    'KF_Steel_Stamp': pbr('KF_Steel_Stamp', stamp_a, stamp_mr, stamp_n),
    'KF_Wood_Haft': pbr('KF_Wood_Haft', wood_a, wood_mr, wood_n),
    'KF_Leather': pbr('KF_Leather', leather_a, leather_mr, leather_n),
    'KF_Gold': pbr('KF_Gold', colour=(.93, .62, .22), metal=1.0, rough=.26),
    'KF_Cord': pbr('KF_Cord', colour=(.30, .16, .08), metal=0.0, rough=.8),
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
S_CHEEK = [0, .03, .07, .10, .13, .16, .19, .22, .25, .29, .33, .37, .41, .45, .49, .53, .57, .61, .65, .69, .72, .75, .78, .81, .84, SB]
S_BEVEL = [SB, SB + .02, SB + .045, SB + .07, SB + .09, 1.0]
T_ROWS = sorted(set([0, .025, .055, .945, .975, 1] + [round(.055 + .89 * k / 34, 4) for k in range(35)]))
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
sock = oct_profile_obj('Head_Socket', 'KF_Steel_Socket', [
    (EYE[0], .030, .030), (EYE[0] + .010, .036, .033), (EYE[0] + .020, .033, .0305),
    (EYE[1] - .022, .033, .0305), (EYE[1] - .010, .037, .034), (EYE[1], .031, .031)], cx=.004, uvbox=False)
def socket_uv():
    me = sock.data; uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        a0 = None
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.y, co.x - .004) / TAU + .5
            if a0 is None: a0 = a
            if a - a0 > .5: a -= 1
            if a0 - a > .5: a += 1
            uvl.data[li].uv = (a * 2, (co.z - EYE[0]) / (EYE[1] - EYE[0]) * .9 + .05)
socket_uv()
# the crown: eight gold points rising from the top band of the eye (Kingsfell, the forester-king's axe)
def crown():
    bm = bmesh.new(); z0 = EYE[1] + .0075
    for k in range(8):
        a = math.pi / 8 + TAU * k / 8; a1 = a - TAU / 16 * .62; a2 = a + TAU / 16 * .62
        r = .0285
        p1 = bm.verts.new((.003 + math.cos(a1) * r, math.sin(a1) * r, z0)); p2 = bm.verts.new((.003 + math.cos(a2) * r, math.sin(a2) * r, z0))
        tip = bm.verts.new((.003 + math.cos(a) * (r - .003), math.sin(a) * (r - .003), z0 + .016))
        q1 = bm.verts.new((.003 + math.cos(a1) * (r - .004), math.sin(a1) * (r - .004), z0)); q2 = bm.verts.new((.003 + math.cos(a2) * (r - .004), math.sin(a2) * (r - .004), z0))
        bm.faces.new((p1, p2, tip)); bm.faces.new((q2, q1, tip)); bm.faces.new((p1, tip, q1)); bm.faces.new((p2, q2, tip))
        bead = bm.verts.new((.003 + math.cos(a) * (r - .003), math.sin(a) * (r - .003), z0 + .0185))
        bm.faces.new((tip, bead, p2))
    return mesh_obj('Crown_Gold', bm, 'KF_Gold', smooth_angle=20)
crown()
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
    def uv(l):
        n = l.face.normal; co = l.vert.co
        if abs(n.y) > .5: return ((co.x + .055) / .085 + .5, (co.z - POLL_Z) / .085 + .5)    # the stamp, both flats
        return (co.x * 4.0 + .3, (co.z + co.y) * 4.0)
    set_uvs(bm, uv)
    return mesh_obj('Head_Poll', bm, 'KF_Steel_Stamp', smooth_angle=30)
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
# tally: every great tree Kingsfell has felled is a gold-filled notch on the haft, four strokes and a slash, twice
def tally():
    bm = bmesh.new()
    def bar(side, x0, z0, x1, z1, w=.0011):
        dx, dz = x1 - x0, z1 - z0; L = math.hypot(dx, dz); nx, nz = -dz / L * w, dx / L * w
        y = side * (.0196 * math.cos(math.pi / 8) + .0003)   # on the haft's flat
        q = [bm.verts.new((x0 + nx, y, z0 + nz)), bm.verts.new((x1 + nx, y, z1 + nz)), bm.verts.new((x1 - nx, y, z1 - nz)), bm.verts.new((x0 - nx, y, z0 - nz))]
        bm.faces.new(q if side < 0 else list(reversed(q)))
    for side in (-1, 1):
        for g, z in enumerate((.272, .306)):
            for k in range(4): bar(side, -.0060 + k * .0040, z, -.0060 + k * .0040, z + .016)
            bar(side, -.0080, z + .0025, .0075, z + .0135)
    return mesh_obj('Tally_Gold', bm, 'KF_Gold', flat=True)
tally()
# a charm on a short braided cord from the pommel: an amber acorn, the seed the heartstone came from
def charm():
    cord = bmesh.new(); z0 = HAFT[0] - .012
    pts = [Vector((.029, 0, z0)), Vector((.034, 0, z0 - .012)), Vector((.036, 0, z0 - .026)), Vector((.036, 0, z0 - .040))]
    rings = []
    for k, p in enumerate(pts):
        rings.append([cord.verts.new((p.x + math.cos(a) * .0019, p.y + math.sin(a) * .0019, p.z)) for a in np.linspace(0, TAU, 7)[:-1] + k * .5])
    loft(cord, rings, True, True)
    set_uvs(cord, lambda l: (.5, .5))
    mesh_obj('Charm_Cord', cord, 'KF_Cord', smooth_angle=80)
    ring = bmesh.new()   # a little gold eyelet on the pommel collar
    c = Vector((.029, 0, z0)); rr = []
    for a in np.linspace(0, TAU, 9)[:-1]:
        rr.append([ring.verts.new((c.x + math.cos(a) * (.0042 + math.cos(b) * .0012), math.sin(b) * .0012, c.z + math.sin(a) * (.0042 + math.cos(b) * .0012))) for b in np.linspace(0, TAU, 5)[:-1]])
    for i in range(8):
        for j in range(4):
            ring.faces.new((rr[i][j], rr[(i + 1) % 8][j], rr[(i + 1) % 8][(j + 1) % 4], rr[i][(j + 1) % 4]))
    mesh_obj('Charm_Eyelet', ring, 'KF_Gold', smooth_angle=60)
    # acorn: amber nut under a gold cup with a tiny stalk
    zc = z0 - .040; nut = []
    for z, r in ((zc - .001, .0050), (zc - .006, .0066), (zc - .012, .0062), (zc - .017, .0044), (zc - .0205, .0018)):
        nut.append((z, r))
    a_bm = bmesh.new(); rings = [ring_section(a_bm, (.036, 0, z), r, r, 10) for z, r in nut]
    loft(a_bm, rings, True, False); tip = a_bm.verts.new((.036, 0, zc - .0225))
    for k in range(10): a_bm.faces.new((rings[-1][k], rings[-1][(k + 1) % 10], tip))
    set_uvs(a_bm, lambda l: (.5, .5))
    mesh_obj('Charm_Acorn', a_bm, 'KF_Amber', smooth_angle=70)
    lathe('Charm_Cup', 'KF_Gold', [(zc - .004, .0071), (zc - .0005, .0074), (zc + .0025, .0058), (zc + .004, .0026), (zc + .0065, .0012)], 10, center=(.036, 0), smooth=40)
charm()

# ------------------------------------------------------------------ sockets
empty('Grip_Center', (0.0075, 0, 0.120))
for name, t in (('CuttingEdge_Bottom', .08), ('CuttingEdge_Mid', .5), ('CuttingEdge_Top', .92)):
    x, z = edge_point(t); empty(name, (float(x), 0, float(z)))
empty('Head_Center', (0.205, 0, 0.650))
empty('Poll_Face', (-0.104, 0, POLL_Z))
empty('Heartstone', (HEART[0], 0, HEART[1]))

# ------------------------------------------------------------------ baked contact shading
# Ambient occlusion baked into a colour attribute on every mesh (Cycles, short distance, so it darkens joints and
# crevices - the crown in its band, the eye's flares, the veins' grooves - not whole faces). Materials multiply it
# into the base colour; glTF carries it as COLOR_0.
def bake_ao(samples=96, distance=.035):
    SC.render.engine = 'CYCLES'; SC.cycles.device = 'CPU'; SC.cycles.samples = samples
    SC.world = SC.world or bpy.data.worlds.new('bake'); SC.world.light_settings.distance = distance
    meshes = [o for o in SC.objects if o.type == 'MESH']
    for o in meshes:
        if 'AO' not in o.data.color_attributes: o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        o.data.color_attributes.active_color = o.data.color_attributes['AO']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    # soften: keep the contact darkening, never crush a whole part (parts that sit inside others see a lot of occluder)
    for o in meshes:
        a = o.data.color_attributes['AO']; d = np.zeros(len(a.data) * 4); a.data.foreach_get('color', d); d = d.reshape(-1, 4)
        d[:, :3] = np.clip(1 - (1 - d[:, :3]) * .62, .42, 1); d[:, 3] = 1; a.data.foreach_set('color', d.ravel())
    for m in bpy.data.materials:
        if not m.use_nodes or not m.name.startswith('KF_'): continue
        nt = m.node_tree; b = nt.nodes['Principled BSDF']; inp = b.inputs['Base Color']
        ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'AO'
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        sock = lambda socks, ident: next(x for x in socks if x.identifier == ident)
        a_in, b_in, out = sock(mix.inputs, 'A_Color'), sock(mix.inputs, 'B_Color'), sock(mix.outputs, 'Result_Color')
        sock(mix.inputs, 'Factor_Float').default_value = 1.0
        if inp.is_linked: nt.links.new(inp.links[0].from_socket, a_in)
        else: a_in.default_value = inp.default_value
        nt.links.new(ca.outputs['Color'], b_in); nt.links.new(out, inp)
if '--no-ao' not in ARGS: bake_ao()

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
assert REPORT['triangles'] < 12000, REPORT
for name in ('Grip_Center', 'CuttingEdge_Mid', 'CuttingEdge_Top', 'CuttingEdge_Bottom', 'Head_Center', 'Poll_Face', 'Heartstone',
             'Head_Blade', 'Head_CuttingEdge', 'Heart_Amber', 'Veins_Gold'):
    assert name in bpy.data.objects, name

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_materials='EXPORT', export_normals=True, export_texcoords=True, export_extras=False,
                          export_image_format='WEBP', export_image_quality=90)  # WebP (EXT_texture_webp): ~4x smaller than PNG for noisy relief maps
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
             'first-person': ((-.30, -.36, .30), (.15, .05, .66), 30),
             'socket': ((-.05, -.42, .80), (-.01, 0, .72), 55), 'pommel': ((.10, -.32, -.02), (.02, 0, -.08), 55)}
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
