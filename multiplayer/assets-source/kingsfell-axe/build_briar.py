"""Kingsfell, Briar Scout look (stage 1 / L1 proof) - reproducible Blender (bpy 4.5/5.0) builder.

Mitch's 2026-10-17 reference: a scout's bearded hatchet, rebuilt (round 3, 2026-10-18) so every part could be made and
assembled by a smith: one forged head whose eye flows into the cheeks, with lugs riveted down the haft and a square
hammer poll behind it (for driving tent stakes and wedges); a long hooked beard; a brass-framed olive enamel plate
riveted to the cheek, inlaid with a gold briar bramble (thorns, rose leaves, red enamel hips) and an amber acorn held
in a brass cap and claws; a ground edge with a hand-ground grind line and faint temper colours; a hickory haft with a
gentle forward bow, a swell at the throat, an olive woven grip, a leather keeper and an amber acorn pommel.
Same runtime contract as build_kingsfell.py (node and material names), so the luminance, Timberfall and grips carry
over. This is the L1 shape-and-material proof.
Previous look (kept for comparison):

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
OUT = arg('--out', os.path.join(HERE, 'out', 'axe-briar.glb'))
RENDER = arg('--render')
TAU = math.tau
rng = np.random.default_rng(7)

# ------------------------------------------------------------------ dimensions (shared with the runtime)
EDGE_C = (-0.070, 0.685)      # edge arc centre (x, z): a bearded axe, the edge runs long and fairly flat, the beard drops low
EDGE_R = 0.350                # edge arc radius (apex)
A_HI = math.asin((0.925 - EDGE_C[1]) / EDGE_R)     # arc angle up to the horn tip (z .925)
A_LO = math.asin((EDGE_C[1] - 0.440) / EDGE_R)     # arc angle down to the beard tip (z .44), a hand's width below the eye
EDGE_SPAN = max(A_LO, A_HI)
EYE_X = 0.022                 # inner boundary of the blade (inside the eye)
EYE_Z = (0.692, 0.828)        # blade root on the eye, bottom and top
HEART = (0.080, 0.774)        # the amber acorn, low in the panel's swoop by the eye
HEART_R = 0.0155
SB = 0.885                    # where the cheek ends and the honed bevel begins (blade parameter s)
HAFT = (-0.020, 0.878)        # haft z range (it stands proud of the eye, wedged and banded)
GRIP = (0.030, 0.236)         # woven wrap z range
EYE = (0.672, 0.842)          # eye (socket) z range
POLL_Z = 0.757

def edge_point(t):
    a = -A_LO + (A_LO + A_HI) * t
    return np.array([EDGE_C[0] + EDGE_R * math.cos(a), EDGE_C[1] + EDGE_R * math.sin(a)])
def bezier(p0, p1, p2, p3, u):
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3)); w = 1 - u
    return w**3 * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u**3 * p3
A_B, A_T = np.array([EYE_X, EYE_Z[0]]), np.array([EYE_X, EYE_Z[1]])
B_TIP, H_TIP = edge_point(0), edge_point(1)
TOP_C = ((0.070, 0.842), (0.130, 0.878))      # the spine rises to a sharp horn
BOT_C = ((0.080, 0.684), (0.150, 0.615))      # a long beard, scooped deep so it hooks
def top(s): return bezier(A_T, *TOP_C, H_TIP, s)
def bottom(s): return bezier(A_B, *BOT_C, B_TIP, s)
def left(t): return A_B + (A_T - A_B) * t
def blade(s, t):
    """Coons patch over the four boundary curves: s = 0 eye .. 1 edge, t = 0 beard .. 1 horn."""
    return ((1 - s) * left(t) + s * edge_point(t) + (1 - t) * bottom(s) + t * top(s)
            - ((1 - s) * (1 - t) * A_B + s * (1 - t) * B_TIP + (1 - s) * t * A_T + s * t * H_TIP))
def chamfer(t):
    k = min(t, 1 - t) / 0.055
    return 0.5 + 0.5 * min(1.0, k)
def cheek_thickness(s, t):
    base = 0.0150 + (0.0045 - 0.0150) * (s / SB) ** 0.8
    base += (.0245 - base) * math.exp(-(s / .085) ** 2)     # the cheeks swell into the eye: one forging, not a plate on a tube
    th = base * chamfer(t) * (1 + .14 * math.sin(math.pi * t) * (1 - s))
    # the heartstone sits on a low forged boss, and a shallow hollow grind runs just inside the bevel: both catch light
    x, z = blade(s, t); d = math.hypot(x - HEART[0], (z - HEART[1]) * 1.12)
    boss = .0018 * math.exp(-(d / .030) ** 2)
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
    # Data maps are authored at 6 bits, colour at 7 (steps of 4/255): invisible on relief and roughness, and it lets the PNGs (and
    # the lossless WebP the delivery build makes from them) compress about 2x. Nothing is lossily re-encoded later.
    if not colour: px[..., :3] = np.round(px[..., :3] * 255 / 4) * 4 / 255
    else: px[..., :3] = np.round(px[..., :3] * 255 / 2) * 2 / 255      # colour at 7 bits: still finer than the noise in it
    img.pixels.foreach_set(px.ravel())    # row 0 = v 0 (Blender rows run bottom-up, like UV v)
    img.pack(); return img
def srgb(c): return np.asarray(c, np.float32)
def normal_map(name, hgt, strength):
    """Tangent-space normal map from a height field (rows = v, cols = u)."""
    gy_, gx_ = np.gradient(hgt.astype(np.float64))
    n = np.stack([-gx_ * strength, -gy_ * strength, np.ones_like(hgt)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return image(name, n * .5 + .5, colour=False)

# Cheek UV: planar over the head, u = x / CU, v = (z - CZ) / CV.
CU, CV, CZ = 0.30, 0.53, 0.42
def cheek_uv(x, z): return x / CU, (z - CZ) / CV
def bez_vec(p0, p1, p2, p3, u):
    w = 1 - u
    return [w**3 * p0[k] + 3 * w * w * u * p1[k] + 3 * w * u * u * p2[k] + u**3 * p3[k] for k in (0, 1)]
def blade_vec(S, T):
    """Vectorised blade(s, t) -> (x, z)."""
    a = -A_LO + (A_LO + A_HI) * T
    ex, ez = EDGE_C[0] + EDGE_R * np.cos(a), EDGE_C[1] + EDGE_R * np.sin(a)
    tx, tz = bez_vec(A_T, *TOP_C, H_TIP, S)
    bx, bz = bez_vec(A_B, *BOT_C, B_TIP, S)
    lx, lz = A_B[0] + (A_T[0] - A_B[0]) * T, A_B[1] + (A_T[1] - A_B[1]) * T
    cx = (1 - S) * (1 - T) * A_B[0] + S * (1 - T) * B_TIP[0] + (1 - S) * T * A_T[0] + S * T * H_TIP[0]
    cz = (1 - S) * (1 - T) * A_B[1] + S * (1 - T) * B_TIP[1] + (1 - S) * T * A_T[1] + S * T * H_TIP[1]
    return (1 - S) * lx + S * ex + (1 - T) * bx + T * tx - cx, (1 - S) * lz + S * ez + (1 - T) * bz + T * tz - cz
def st_raster(nw, nh):
    """Blade parameters (s, t) per cheek-texture pixel (nan off the blade)."""
    S, T = np.meshgrid(np.linspace(0, 1, 3200), np.linspace(0, 1, 3200))
    x, z = blade_vec(S, T)
    px = np.clip(np.round(x / CU * (nw - 1)).astype(int), 0, nw - 1); pz = np.clip(np.round((z - CZ) / CV * (nh - 1)).astype(int), 0, nh - 1)
    sm = np.full((nh, nw), np.nan); tm = np.full((nh, nw), np.nan); sm[pz, px] = S; tm[pz, px] = T
    return sm, tm
def erode(mask, k):
    m = mask.copy()
    for _ in range(k):
        m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    return m
# The enamel plate, in blade (s, t): a banner along the spine that swells round the acorn by the eye and ends in a rounded
# nose well short of the bevel (nothing is inlaid where the edge will be ground). The plate mesh and the texture share it.
PS0, PS1, PSN, PT_HI = .035, .78, .60, .925
def panel_lo(s):
    s = np.asarray(s, np.float64)
    lo = .78 - .36 * np.exp(-((s - .22) / .20) ** 2)
    k = np.clip((s - PSN) / (PS1 - PSN), 0, 1)
    return PT_HI - (PT_HI - lo) * np.sqrt(np.clip(1 - k ** 2, 0, 1))
def panel_st(p, q):
    s = PS0 + (PS1 - PS0) * p; return s, panel_lo(s) + (PT_HI - panel_lo(s)) * q
def panel_mask(sm, tm):
    sm = np.nan_to_num(sm, nan=-1); tm = np.nan_to_num(tm, nan=-1)
    return (sm > PS0) & (sm < PS1) & (tm > panel_lo(sm)) & (tm < PT_HI)
PLATE = .0011                 # the plate stands this proud of the cheek
# The briar: one bramble cane, cut by the eye, arching over the acorn's stalk and then running out along the banner. Its stem is the vein mesh (it carries the acorn's light); thorns, rose leaves and hips are inlaid round it.
BRIAR_ST = [(.07, .66), (.09, .76), (.15, .825), (.24, .84), (.32, .81), (.40, .84), (.48, .885), (.56, .862), (.64, .892), (.72, .878)]
def catmull(pts, n):
    P = [np.array(pts[0]) * 2 - np.array(pts[1])] + [np.array(p) for p in pts] + [np.array(pts[-1]) * 2 - np.array(pts[-2])]
    out = []
    for i in range(1, len(P) - 2):
        for k in range(n):
            u = k / n; p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
            out.append(.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    out.append(np.array(pts[-1])); return out
BRIAR = catmull(BRIAR_ST, 8)                                    # (s, t) along the cane
BRIAR_XZ = np.array([blade(s_, t_) for s_, t_ in BRIAR])
_seg = np.linalg.norm(np.diff(BRIAR_XZ, axis=0), axis=1); BRIAR_LEN = np.concatenate([[0], np.cumsum(_seg)])
def briar_at(f):
    """Point and unit tangent (world x, z) at arc-length fraction f of the cane."""
    L = f * BRIAR_LEN[-1]; i = int(np.clip(np.searchsorted(BRIAR_LEN, L) - 1, 0, len(_seg) - 1))
    w = (L - BRIAR_LEN[i]) / max(_seg[i], 1e-9); d = BRIAR_XZ[i + 1] - BRIAR_XZ[i]
    return BRIAR_XZ[i] + d * w, d / np.linalg.norm(d)
BRIAR_HIPS = ((.47, 1, .0050), (.74, -1, .0044), (1.0, 0, .0056))       # (fraction, side, radius): red enamel rose hips
BRIAR_LEAVES = ((.20, -1), (.60, 1), (.88, 1))                           # three-leaflet rose leaves
def seg_dist(x, z, pts):
    """Distance from every pixel to a polyline (world x, z)."""
    best = np.full(x.shape, 9.0)
    for a, b in zip(pts, pts[1:]):
        d = b - a; L2 = max(d @ d, 1e-12)
        h = np.clip(((x - a[0]) * d[0] + (z - a[1]) * d[1]) / L2, 0, 1)
        best = np.minimum(best, np.hypot(x - a[0] - h * d[0], z - a[1] - h * d[1]))
    return best
def local(x, z, p, ang):
    ca, sa = math.cos(ang), math.sin(ang); dx, dz = x - p[0], z - p[1]
    return dx * ca + dz * sa, -dx * sa + dz * ca
def briar_masks(x, z):
    """(stem outline, thorns, leaves, leaf veins, hips, hip crowns) as boolean / float masks."""
    stem = seg_dist(x, z, BRIAR_XZ) < .0036                   # the dark keyline round the raised stem
    thorns = np.zeros_like(x, bool)
    n = int(BRIAR_LEN[-1] / .0105)
    for k in range(1, n):
        f = k / n; p, d = briar_at(f); side = 1 if k % 2 else -1
        nrm = np.array([-d[1], d[0]]) * side
        base = p + nrm * .0018; ang = math.atan2(nrm[1] - d[1] * .9, nrm[0] - d[0] * .9)   # hooked back along the cane
        a, b = local(x, z, base, ang)
        thorns |= (a > 0) & (a < .0060) & (np.abs(b) < .0022 * np.clip(1 - a / .0060, 0, 1) ** 1.3)
    leaves = np.zeros_like(x, bool); veins = np.zeros_like(x, bool)
    for f, side in BRIAR_LEAVES:
        p, d = briar_at(f); nrm = np.array([-d[1], d[0]]) * side
        stalk_dir = nrm * .8 + d * .6; stalk_dir /= np.linalg.norm(stalk_dir)
        tip = p + stalk_dir * .0095; ang0 = math.atan2(stalk_dir[1], stalk_dir[0])
        a, b = local(x, z, p, ang0); veins |= (a > 0) & (a < .0095) & (np.abs(b) < .0006)
        for pos, da, L in ((tip, 0.0, .0140), (p + stalk_dir * .005, .95, .0115), (p + stalk_dir * .005, -.95, .0115)):
            a, b = local(x, z, pos, ang0 + da)
            tt = np.clip(a / L, 0, 1); w = .40 * L * np.sin(np.pi * tt ** .85) * (.86 + .14 * np.abs(np.sin(tt * np.pi * 6)))  # serrated
            leaf = (a > 0) & (a < L) & (np.abs(b) < w); leaves |= leaf
            veins |= leaf & (np.abs(b) < .00035)
            for j in (.3, .55, .78):   # side veins
                veins |= leaf & (np.abs(np.abs(b) - (a - j * L) * .9) < .0003) & (a > j * L)
    hips = np.zeros_like(x); crowns = np.zeros_like(x, bool)
    for f, side, r in BRIAR_HIPS:
        p, d = briar_at(f)
        dirv = d if side == 0 else (np.array([-d[1], d[0]]) * side * .85 + d * .5)
        dirv = dirv / np.linalg.norm(dirv); c = p + dirv * (r * 1.35 + (.002 if side else .0008))
        a, b = local(x, z, c, math.atan2(dirv[1], dirv[0]))
        e = (a / (r * 1.3)) ** 2 + (b / r) ** 2
        hips = np.maximum(hips, np.clip(1 - e, 0, 1))
        a2, b2 = local(x, z, c + dirv * r * 1.3, math.atan2(dirv[1], dirv[0]))     # the dried sepals at the tip
        crowns |= (np.hypot(a2, b2) < r * .55) & (np.abs(np.sin(np.arctan2(b2, a2) * 2.5)) > .45)
        if side:
            a, b = local(x, z, p, math.atan2(dirv[1], dirv[0])); stem |= (a > 0) & (a < r * .6 + .002) & (np.abs(b) < .0006)
    return stem, thorns, leaves, veins, hips, crowns
def ring_textures(nw=1024, nh=1808):
    v, u = np.mgrid[0:nh, 0:nw] / np.array([nh - 1, nw - 1])[:, None, None]
    x, z = u * CU, v * CV + CZ
    sm, tm = st_raster(nw, nh)
    panel = panel_mask(sm, tm); inner = erode(panel, 6); rim = panel & ~inner; field = erode(panel, 9)
    stem, thorns, leaves, lveins, hips, crowns = briar_masks(x, z)
    gold = (thorns | leaves | lveins) & field; keyline = stem & field & ~gold
    hipm = (hips > 0) & field; hipr = hipm & (hips < .28)            # each hip sits in a thin brass cell
    # --- steel: one forging. Planished (the hammer marks read faintly) from the eye out to a hand-ground grind line;
    # beyond it the bevel's run-up is ground bright with fine strokes along the edge. A faint temper rainbow sits just
    # inside the grind line, forge scale lingers dark by the eye and along the spine, and use rubs the high spots bright.
    sa, sr, sh = forged_parts(u * 1.3, v * 2.2)
    sa = sa * .20 + srgb((.46, .465, .48)) * .80; sr = sr * .25 + .30 * .75
    smv = np.nan_to_num(sm, nan=0); tmv = np.nan_to_num(tm, nan=.5)
    wob = .012 * fbm(x * 30, z * 30, 3, 81)
    gl = .70 + wob
    ground = np.clip((smv - gl) / .006, 0, 1)
    rad = np.hypot(x - EDGE_C[0], z - EDGE_C[1]); ang = np.arctan2(z - EDGE_C[1], x - EDGE_C[0])
    strokes = .5 + .5 * np.sin(rad * 700 + fbm(ang * 40, rad * 30, 2, 82) * 4)
    galb = srgb((.60, .61, .63)) * (.92 + .08 * strokes[..., None])
    sa = sa * (1 - ground[..., None]) + galb * ground[..., None]
    sr = sr * (1 - ground) + (.20 + .05 * strokes) * ground
    sh = sh * (1 - ground) + strokes * .08 * ground
    band = smv - gl
    temper = [((.70, .58, .34), -.035, .012), ((.55, .38, .32), -.020, .010), ((.34, .40, .58), -.008, .008)]   # straw, bronze, blue
    for col, c, w in temper:
        k = np.exp(-((band - c) / w) ** 2)[..., None] * .16
        sa = sa * (1 - k) + srgb(col) * sa.mean(-1, keepdims=True) / .47 * k
    scale = np.clip(1 - smv / .22, 0, 1) * .30 + np.clip((tmv - .82) / .15, 0, 1) * .18
    sa = sa * (1 - scale[..., None]); sr = sr + scale * .18
    # --- the plate: olive enamel in a brass frame; the gold briar inlay stands proud, the hips are red enamel in brass cells
    olive = srgb((.22, .29, .13)) * (.90 + .10 * fbm(x * 120, z * 120, 3, 71)[..., None])
    olive = olive * (1 - .25 * np.clip(1 - np.abs(np.nan_to_num(tm, nan=0) - .5), 0, 1)[..., None] * 0)
    brass = srgb((.78, .60, .30)); goldc = srgb((.88, .67, .29)); keyc = srgb((.10, .12, .05))
    hipc = srgb((.66, .13, .05)) * (.75 + .45 * hips[..., None])
    alb = np.where(inner[..., None], olive, sa); alb = np.where(rim[..., None], brass, alb)
    alb = np.where(keyline[..., None], keyc, alb); alb = np.where(gold[..., None], goldc, alb)
    alb = np.where((lveins & leaves & field)[..., None], goldc * .62, alb)
    alb = np.where(hipm[..., None], hipc, alb); alb = np.where(hipr[..., None], brass, alb)
    alb = np.where((crowns & field)[..., None], srgb((.22, .10, .04)), alb)
    rough = np.where(inner, .30, sr); rough = np.where(rim | gold | hipr, .28, rough); rough = np.where(hipm & ~hipr, .18, rough)
    metal = np.where(panel & ~(rim | gold | hipr), 0.0, 1.0)
    mr = np.stack([np.zeros_like(rough), np.clip(rough, .12, .9), metal], -1)
    relief = rim * .9 + gold * .7 - (lveins & leaves) * .35 + hips * 1.4 + keyline * -.3
    hgt = sh * .03 * (~panel) + relief * .55
    return image('KF_Ring_Albedo', alb), image('KF_Ring_MR', mr, colour=False), normal_map('KF_Ring_Normal', hgt, 3.0)
def edge_textures(n=512):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    x, z = u * CU, v * CV + CZ
    rad = np.hypot(x - EDGE_C[0], z - EDGE_C[1]); ang = np.arctan2(z - EDGE_C[1], x - EDGE_C[0])
    grind = fbm(rad * 900, ang * 4, 3, 21) * .5 + 0.5
    alb = srgb((.66, .67, .69)) * (0.84 + 0.16 * grind[..., None])
    apex = np.clip((rad - (EDGE_R - 0.006)) / 0.006, 0, 1)
    alb = alb * (1 - apex[..., None] * .0) + srgb((.92, .93, .95)) * apex[..., None] * .25
    rough = np.clip(0.26 - 0.12 * apex + 0.08 * (grind - .5), .06, .5)
    mr = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    # hone scratches run along the edge (tangential), finer toward the apex
    hgt = np.sin(rad * 5200 + fbm(ang * 30, rad * 40, 2, 22) * 3) * .5 * (1 - apex) + grind * .2
    # only the bevel band is ever sampled: leave the rest flat so it costs nothing to download
    band = (rad > EDGE_R - .05)[..., None]
    alb = np.where(band, alb, srgb((.66, .67, .69))); mr = np.where(band, mr, np.array([0, .26, 1])); hgt = np.where(band[..., 0], hgt, 0)
    return image('KF_Edge_Albedo', alb), image('KF_Edge_MR', mr, colour=False), normal_map('KF_Edge_Normal', hgt, 1.2)
def forged_textures(n=512):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    alb, rough, hgt = forged_parts(u, v)
    mr = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    return image('KF_Forged_Albedo', alb), image('KF_Forged_MR', mr, colour=False), normal_map('KF_Forged_Normal', hgt, 3.5)
def forged_parts(u, v):
    """Hammer-forged bright steel: (albedo, roughness, height)."""
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
    # hammered bright steel: each blow leaves a slightly darker, rougher hollow, the ridges between them polished
    alb = srgb((.42, .425, .44)) * (0.88 + 0.12 * dimple[..., None] + 0.10 * noise[..., None])
    rub = np.clip((dimple - .72) / .28, 0, 1) ** 2 * np.clip(noise * 2 + .6, 0, 1)
    alb = alb + (srgb((.80, .80, .81)) - alb) * rub[..., None] * .45
    rough = np.clip(.46 - .14 * dimple + .05 * noise - .16 * rub, .18, .8)
    return alb, rough, dimple ** 2
def socket_textures(n=512):
    """Blackened forged steel with a gold-inlaid interlace: two vines braided round the eye, an oak leaf at each crossing."""
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    fa, fm_, fn = forged_parts(u * 1.4, v * 1.4)
    fa = fa * .25 + srgb((.47, .475, .49)) * .75; fm_ = fm_ * .30 + .34 * .70; fn = fn * .30   # planished like the cheeks: one forging
    a = v - .5 - .26 * np.sin(TAU * u); b = v - .5 + .26 * np.sin(TAU * u)
    over = np.sin(TAU * u) > 0                                    # which vine passes over at each crossing
    ga = np.exp(-(a / .032) ** 6); gb = np.exp(-(b / .032) ** 6)
    gb = gb * np.clip(1 - (~over) * np.exp(-(a / .10) ** 2) * 1.0, 0, 1); ga = ga * np.clip(1 - over * np.exp(-(b / .10) ** 2), 0, 1)
    # leaves: a little almond at each peak/trough
    lx = ((u * 2 + .25) % 1) - .5; ly = np.where(np.sin(TAU * u) > 0, v - .5 - .26, v - .5 + .26)
    leaf = (np.clip(1 - ((lx / .13) ** 2 + (ly / .065) ** 2), 0, 1) > 0) * 1.0 * (np.abs(np.sin(TAU * u)) > .85)
    gold = np.zeros_like(u)   # Briar: plain hammered socket
    goldc = srgb((.78, .52, .19)) * (0.85 + .15 * fbm(u * 40, v * 40, 2, 61)[..., None])
    alb = fa * (1 - gold[..., None]) + goldc * gold[..., None]
    rough = fm_ * (1 - gold) + .24 * gold; metal = np.ones_like(gold)
    mr = np.stack([np.zeros_like(rough), rough, metal], -1)
    hgt = fn - gold * .35 + np.clip(gold * 1.2, 0, 1) * .0                          # inlay sits just below the steel
    return image('KF_Socket_Albedo', alb), image('KF_Socket_MR', mr, colour=False), normal_map('KF_Socket_Normal', hgt, 1.8)
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
    """Oiled hickory: honey sapwood with long, slightly wandering darker grain, a few cathedral arches where the
    growth rings break the surface, fine pores, and the oil darkened and polished where the hands work."""
    v, u = np.mgrid[0:h, 0:w].astype(np.float64); v /= h - 1; u /= w - 1
    wander = fbm(u * 2.5, v * 1.6, 4, 41) * 1.1 + .55 * np.sin(v * TAU * 1.3 + u * TAU)          # rings sliced at a shallow angle
    ring = (u * 14 + wander + fbm(u * 24, v * 30, 2, 43) * .10) % 1
    late = np.clip((ring - .62) / .10, 0, 1) * np.clip((1 - ring) / .06, 0, 1)        # hard dark latewood, soft light earlywood
    pores = (fbm(u * 90, v * 900, 2, 47) > .42) * (ring < .62) * .5
    fine = fbm(u * 60, v * 420, 2, 49)
    light, dark = srgb((.62, .39, .21)), srgb((.37, .19, .085))
    alb = light + (dark - light) * (late * .85 + pores * .25)[..., None]
    alb *= (0.93 + 0.07 * fine[..., None])
    alb *= (0.94 + .06 * fbm(u * 4, v * 3, 3, 45)[..., None])          # the odd darker streak of heartwood
    rough = np.clip(.52 - .10 * late + .05 * fine, .3, .85)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    hgt = late * .6 - pores * .5
    return image('KF_Wood_Albedo', alb), image('KF_Wood_MR', mr, colour=False), normal_map('KF_Wood_Normal', hgt[::2, ::2], 1.6)   # half-res relief is plenty on a 3 cm haft
def leather_textures(n=256):
    v, u = np.mgrid[0:n, 0:n] / (n - 1)
    # olive cord woven in a diagonal basket weave
    pebble = fbm(u * 30, v * 30, 3, 51)
    a, b = (u * 6 + v * 6) % 1, (u * 6 - v * 6) % 1
    over = ((np.floor(u * 6 + v * 6) + np.floor(u * 6 - v * 6)) % 2) < 1
    strand = np.where(over, np.sin(np.pi * a), np.sin(np.pi * b)) ** .6
    alb = srgb((.30, .36, .17)) * (0.62 + 0.38 * strand[..., None] + 0.06 * pebble[..., None])
    rough = np.clip(.72 + .1 * pebble, .4, .9)
    mr = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    hgt = strand + pebble * .1
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
    'KF_Gold': pbr('KF_Gold', colour=(.80, .58, .26), metal=1.0, rough=.30),   # brass
    'KF_Strap': pbr('KF_Strap', colour=(.22, .11, .05), metal=0.0, rough=.7),
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
def build_veins():
    """The briar cane: a raised gold stem on the plate. Its uv.x runs 0 at the cut end by the eye .. 1 at the tip hip."""
    core = bmesh.new(); uv_of = {}
    for side in (-1, 1):
        rows = []
        for k, (s_, t_) in enumerate(BRIAR):
            u = BRIAR_LEN[k] / BRIAR_LEN[-1]
            q = BRIAR_XZ[min(k + 1, len(BRIAR) - 1)] - BRIAR_XZ[max(k - 1, 0)]; nrm = np.array([-q[1], q[0]]) / np.linalg.norm(q)
            w = .0044 + (.0028 - .0044) * u; base = half_thickness(s_, t_) + PLATE
            row = []
            for a, lift in ((-1, .0001), (-.5, .00075), (0, .0010), (.5, .00075), (1, .0001)):
                c = BRIAR_XZ[k] + nrm * a * w * .5
                v = core.verts.new((c[0], side * (base + lift), c[1])); row.append(v); uv_of[v] = (u, (a + 1) / 2)
            rows.append(row)
        for r0, r1 in zip(rows, rows[1:]):
            for a in range(len(r0) - 1): core.faces.new((r0[a], r1[a], r1[a + 1], r0[a + 1]))
    layer = core.loops.layers.uv.verify()
    for f in core.faces:
        for l in f.loops: l[layer].uv = uv_of[l.vert]
    return mesh_obj('Veins_Gold', core, 'KF_Vein', smooth_angle=50)

# ------------------------------------------------------------------ the enamel plate: a separate riveted part on each cheek
def panel_plate():
    bm = bmesh.new(); NP, NQ = 30, 6
    for side in (-1, 1):
        top, low = [], []
        for i in range(NP + 1):
            p = min(i / NP, .996); tr, lr = [], []
            for j in range(NQ + 1):
                s_, t_ = panel_st(p, j / NQ); s_, t_ = float(s_), float(t_); x, z = blade(s_, t_); h = half_thickness(s_, t_)
                tr.append(bm.verts.new((x, side * (h + PLATE), z))); lr.append(bm.verts.new((x, side * (h - .0004), z)))
            top.append(tr); low.append(lr)
        for i in range(NP):
            for j in range(NQ):
                f = (top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]); bm.faces.new(f if side < 0 else tuple(reversed(f)))
        ring = [(i, 0) for i in range(NP)] + [(NP, j) for j in range(NQ)] + [(i, NQ) for i in range(NP, 0, -1)] + [(0, j) for j in range(NQ, 0, -1)]
        for (i0, j0), (i1, j1) in zip(ring, ring[1:] + ring[:1]):      # the plate's edge: a little wall down into the cheek
            f = (top[i0][j0], low[i0][j0], low[i1][j1], top[i1][j1]); bm.faces.new(f if side < 0 else tuple(reversed(f)))
    set_uvs(bm, lambda l: cheek_uv(l.vert.co.x, l.vert.co.z))
    return mesh_obj('Panel_Plate', bm, 'KF_Steel_Ring', smooth_angle=40)
panel_plate()
build_veins()

# ------------------------------------------------------------------ heartstone: an amber acorn held in a brass cap and three claws
GEM_R, GEM_RZ, GEM_H = .0165, .0205, .0095
def gem_lift(x, z):
    rho = math.sqrt(((x - HEART[0]) / GEM_R) ** 2 + ((z - HEART[1]) / GEM_RZ) ** 2)
    return .0006 + GEM_H * math.sqrt(max(0.0, 1 - min(rho, 1) ** 2)) ** 1.15
def heartstone():
    gem = bmesh.new(); brass = bmesh.new()
    for side in (-1, 1):
        y0 = half_thickness(HS, HT) + PLATE
        def P(x, z, extra=0.0): return (x, side * (y0 + gem_lift(x, z) + extra), z)
        # the amber: a smooth oval cabochon
        rings = []
        for rho in (1.0, .92, .76, .54, .26):
            rings.append([gem.verts.new(P(HEART[0] + math.cos(a) * GEM_R * rho, HEART[1] + math.sin(a) * GEM_RZ * rho)) for a in np.linspace(0, TAU, 17)[:-1]])
        loft(gem, rings, cap_start=True)
        apex = gem.verts.new(P(*HEART)); last = rings[-1]
        for k in range(16): gem.faces.new((last[k], last[(k + 1) % 16], apex))
        # the setting's collar, seated in the plate
        rings = []
        for rho, lift in ((1.22, -.0015), (1.22, .0012), (1.12, .0024), (1.0, .0020), (.98, .0004)):
            rings.append([brass.verts.new((HEART[0] + math.cos(a) * GEM_R * rho, side * (y0 + lift), HEART[1] + math.sin(a) * GEM_RZ * rho)) for a in np.linspace(0, TAU, 21)[:-1]])
        loft(brass, rings)
        # the acorn's cup: a brass cap over the top third, its scales chased in as rows, a stalk standing off it
        z_cut = HEART[1] + GEM_RZ * .30; rows = []
        for j, zf in enumerate(np.linspace(0, 1, 7)):
            z = z_cut + (HEART[1] + GEM_RZ * 1.06 - z_cut) * zf
            half = GEM_R * 1.07 * math.sqrt(max(0.0, 1 - ((z - HEART[1]) / (GEM_RZ * 1.07)) ** 2)) + 1e-4
            scale = .0005 * (j % 2)
            rows.append([brass.verts.new(P(HEART[0] + half * xf, min(z, HEART[1] + GEM_RZ * .995), .0010 + scale - .0008 * zf)) for xf in np.linspace(-1, 1, 11)])
        for r0, r1 in zip(rows, rows[1:]):
            for a in range(10):
                f = (r0[a], r0[a + 1], r1[a + 1], r1[a]); brass.faces.new(f if side < 0 else tuple(reversed(f)))
        lip = [brass.verts.new((v.co.x, side * (y0 - .0002), v.co.z)) for v in rows[0]]   # the cup's lower lip
        for a in range(10):
            f = (rows[0][a], lip[a], lip[a + 1], rows[0][a + 1]); brass.faces.new(f if side < 0 else tuple(reversed(f)))
        st0 = Vector(P(HEART[0] + .002, HEART[1] + GEM_RZ * .9, .0012))
        stalk = [brass.verts.new((st0.x + .0048 + math.cos(a) * .0011, st0.y, st0.z + .0060 + math.sin(a) * .0011)) for a in np.linspace(0, TAU, 7)[:-1]]
        base = [brass.verts.new((st0.x + math.cos(a) * .0016, st0.y - side * .0008, st0.z + math.sin(a) * .0016)) for a in np.linspace(0, TAU, 7)[:-1]]
        loft(brass, [base, stalk], cap_end=True)
        # three claws round the bottom, folded over the amber
        for ang in (-math.pi * .22, -math.pi * .5, -math.pi * .78):
            ca, sa = math.cos(ang), math.sin(ang); prof = []
            for rho, w, extra in ((1.20, .0030, .0008), (1.03, .0026, .0016), (.90, .0019, .0011), (.80, .0012, .0007)):
                x, z = HEART[0] + ca * GEM_R * rho, HEART[1] + sa * GEM_RZ * rho
                lift = (gem_lift(x, z) if rho < 1 else .0006 + (1.22 - rho) * .01) + extra
                pr = []
                for o, dy in ((-1, 0), (1, 0), (1, .0011), (-1, .0011)):
                    pr.append(brass.verts.new((x - sa * o * w * .5, side * (y0 + lift + dy - .0011), z + ca * o * w * .5)))
                prof.append(pr)
            loft(brass, prof, True, True)
    set_uvs(gem, lambda l: (0.5 + (l.vert.co.x - HEART[0]) / (GEM_R * 2), 0.5 + (l.vert.co.z - HEART[1]) / (GEM_R * 2)))
    mesh_obj('Heart_Amber', gem, 'KF_Amber', smooth_angle=60)
    mesh_obj('Heart_Bezel', brass, 'KF_Gold', smooth_angle=35)
heartstone()

# ------------------------------------------------------------------ eye (socket), poll and fittings
def oct_profile_obj(name, mat, profile, rx_scale=1.0, cx=0.0, flat=False, smooth=30, uvbox=True):
    bm = bmesh.new(); rings = []
    for z, rx, ry in profile:
        rings.append(ring_section(bm, (cx, 0, z), rx * rx_scale, ry, 8, math.pi / 8))
    loft(bm, rings, True, True)
    if uvbox: set_uvs(bm, lambda l: ((l.vert.co.x + l.vert.co.y) * 4.0, l.vert.co.z * 4.0))
    return mesh_obj(name, bm, mat, smooth, flat)
# the eye: forged from the same bar as the cheeks, a waisted teardrop that runs forward into them, flared top and bottom
def forged_eye(name, profile, cx=.004, sides=16):
    bm = bmesh.new(); rings = []
    for z, rx, ry in profile:
        ring = []
        for k in range(sides):
            a = TAU * k / sides; c = math.cos(a)
            ring.append(bm.verts.new((cx + c * rx * (1 + .20 * max(0.0, c)), math.sin(a) * ry, z)))
        rings.append(ring)
    loft(bm, rings, True, True)
    return mesh_obj(name, bm, 'KF_Steel_Socket', smooth_angle=50)
sock = forged_eye('Head_Socket', [
    (EYE[0], .029, .0262), (EYE[0] + .006, .0335, .0298), (EYE[0] + .020, .0325, .0284), (POLL_Z, .0305, .0270),
    (EYE[1] - .020, .0325, .0284), (EYE[1] - .006, .0335, .0298), (EYE[1], .029, .0262)])
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
# gold poll cap band and eye bands
def band(name, z, r, ry, h, cx=0.0, mat='KF_Gold', sides=8):
    return oct_profile_obj(name, mat, [(z - h / 2, r, ry), (z - h / 2 + .001, r + .002, ry + .002), (z + h / 2 - .001, r + .002, ry + .002), (z + h / 2, r, ry)], cx=cx, uvbox=False)
band('Band_Eye_Top', EYE[1] + .004, .028, .028, .007, cx=.003)
def poll_cap():
    bm = bmesh.new(); rings = []
    for x, hz, hy in ((-.089, .046, .031), (-.097, .046, .031)):
        rings.append([bm.verts.new((x, math.sin(math.pi / 8 + TAU * k / 8) * hy, POLL_Z + math.cos(math.pi / 8 + TAU * k / 8) * hz)) for k in range(8)])
    loft(bm, rings, True, True)
    return mesh_obj('Poll_Band', bm, 'KF_Gold', smooth_angle=30)
# wedge cap on top of the haft
oct_profile_obj('Cap_Wedge', 'KF_Gold', [(HAFT[1] - .016, .019, .016), (HAFT[1] - .004, .021, .018), (HAFT[1] + .004, .014, .012), (HAFT[1] + .007, .006, .005)], uvbox=False)

# ------------------------------------------------------------------ haft, langets, grip, pommel
def haft():
    bm = bmesh.new(); rings = []
    zs = np.linspace(HAFT[0], HAFT[1], 30)
    for z in zs:
        knob = max(0.0, (0.06 - z) / 0.12) ** 2           # swells toward the knob
        neck = math.exp(-((z - 0.36) / 0.10) ** 2) * -.0020 # slimmer just above the grip
        throat = math.exp(-((z - 0.56) / 0.07) ** 2) * .0022 # a swell under the head for the choked-up hand
        rx = .0232 * (1 + .24 * knob) + neck + throat; ry = .0196 * (1 + .24 * knob) + neck + throat * .8
        rings.append(ring_section(bm, (0, 0, z), rx, ry, 12, math.pi / 12))
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
def pommel():
    return oct_profile_obj('Pommel', 'KF_Steel_Forged', [
        (HAFT[0] - .030, .016, .016), (HAFT[0] - .024, .027, .025), (HAFT[0] - .012, .030, .028),
        (HAFT[0] - .002, .026, .024), (HAFT[0] + .004, .025, .022)])
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

# ------------------------------------------------------------------ Briar Scout fittings
def chamfer_square(bm, x, hz, hy, c):
    pts = [(hy, hz - c), (hy - c, hz), (-hy + c, hz), (-hy, hz - c), (-hy, -hz + c), (-hy + c, -hz), (hy - c, -hz), (hy, -hz + c)]
    return [bm.verts.new((x, y, POLL_Z + z)) for y, z in pts]
def hammer_poll():
    """The poll is a square hammer face, forged out of the back of the eye: for driving tent stakes, wedges and pegs."""
    bm = bmesh.new()
    rings = [chamfer_square(bm, x, hz, hy, c) for x, hz, hy, c in (
        (-.016, .040, .0262, .011), (-.034, .0285, .0215, .006), (-.050, .0285, .0225, .006),
        (-.061, .0305, .0245, .0065), (-.0705, .0318, .0256, .0065), (-.0745, .0296, .0236, .0075))]
    loft(bm, rings, True, True)
    # the striking face is ground flat and bright: it samples one smooth texel, not the hammer marks
    set_uvs(bm, lambda l: (.5, .5) if l.face.normal.x < -.9 else ((l.vert.co.y + l.vert.co.x) * 5 + .5, (l.vert.co.z - POLL_Z) * 5 + .5))
    mesh_obj('Head_Poll', bm, 'KF_Steel_Socket', smooth_angle=33)
hammer_poll()
def eye_lugs():
    """Two lugs drawn down from the eye along the haft's cheeks (one forging with the eye), riveted through the haft."""
    bm = bmesh.new()
    pts = [(-.0215, EYE[0] + .006), (.0235, EYE[0] + .006), (.016, EYE[0] - .026), (.005, EYE[0] - .046), (-.007, EYE[0] - .036), (-.019, EYE[0] - .012)]
    for side in (-1, 1):
        th = lambda z: .0019 + .0058 * max(0.0, min(1.0, (z - (EYE[0] - .046)) / .052)) ** 1.4
        outer = [bm.verts.new((x, side * (.0192 + th(z)), z)) for x, z in pts]
        inner = [bm.verts.new((x * .96, side * .0186, z)) for x, z in pts]
        bm.faces.new(outer); bm.faces.new(list(reversed(inner)))
        for k in range(len(pts)):
            bm.faces.new((outer[k], inner[k], inner[(k + 1) % len(pts)], outer[(k + 1) % len(pts)]))
        c = Vector((.003, side * (.0192 + th(EYE[0] - .024)), EYE[0] - .024))     # a domed rivet through lug, haft and lug
        ring = [bm.verts.new((c.x + math.cos(a) * .0034, c.y, c.z + math.sin(a) * .0034)) for a in np.linspace(0, TAU, 11)[:-1]]
        mid = [bm.verts.new((c.x + math.cos(a) * .0024, c.y + side * .0012, c.z + math.sin(a) * .0024)) for a in np.linspace(0, TAU, 11)[:-1]]
        top = bm.verts.new((c.x, c.y + side * .0017, c.z))
        loft(bm, [ring, mid])
        for k in range(10): bm.faces.new((mid[k], mid[(k + 1) % 10], top))
    set_uvs(bm, lambda l: (l.vert.co.x * 5 + .5, (l.vert.co.z - EYE[0]) * 5 + .5))
    return mesh_obj('Eye_Lugs', bm, 'KF_Steel_Socket', smooth_angle=40)
eye_lugs()
band('Band_Below_Eye', EYE[0] - .060, .0236, .0236, .010)
band('Band_Grip_Base', GRIP[0] - .006, .0262, .0226, .010)
band('Band_Low_A', -.004, .0268, .0234, .007)
def strap():
    """A leather keeper buckled round the haft above the wrap, its tab hanging on the poll side with a brass stud."""
    oct_profile_obj('Strap_Loop', 'KF_Strap', [(.262, .0242, .0206), (.264, .0256, .0220), (.284, .0256, .0220), (.286, .0242, .0206)], uvbox=False)
    bm = bmesh.new(); x0, x1, y = -.027, -.031, .009
    pts = [(.288, -y), (.288, y), (.236, y * .8), (.226, 0), (.236, -y * .8)]
    a = [bm.verts.new((x0, yy, z)) for z, yy in pts]; b = [bm.verts.new((x1, yy, z)) for z, yy in pts]
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for k in range(len(pts)):
        bm.faces.new((a[k], b[k], b[(k + 1) % len(pts)], a[(k + 1) % len(pts)]))
    mesh_obj('Strap_Tab', bm, 'KF_Strap', flat=True)
    lathe('Strap_Stud', 'KF_Gold', [(0, .0042), (.0016, .0040), (.0028, .0022), (.0033, 0.0)], 10, smooth=60)
    st = bpy.data.objects['Strap_Stud']; st.rotation_euler = (0, -math.pi / 2, 0); st.location = (-.031, 0, .246)
strap()
def acorn_pommel():
    """The pommel is an acorn: a big amber nut in a brass cup of oak leaves, a brass point below."""
    zc = HAFT[0] - .006; K = 1.35
    lathe('Pommel', 'KF_Gold', [(zc - .004, .0285), (zc + .002, .0300), (zc + .010, .0270), (zc + .016, .0220), (zc + .020, .0180)], 16, smooth=40)
    nut = [(zc - .002 * K, .0205 * K), (zc - .012 * K, .0215 * K), (zc - .024 * K, .0198 * K), (zc - .034 * K, .0150 * K), (zc - .041 * K, .0075 * K)]
    bm = bmesh.new(); rings = [ring_section(bm, (0, 0, z), r, r * .92, 12) for z, r in nut]
    loft(bm, rings, True, False); tip = bm.verts.new((0, 0, zc - .044 * K))
    for k in range(12): bm.faces.new((rings[-1][k], rings[-1][(k + 1) % 12], tip))
    set_uvs(bm, lambda l: (.5, .5))
    mesh_obj('Pommel_Amber', bm, 'KF_Amber', smooth_angle=70)
    # four brass oak leaves cupping the nut
    lv = bmesh.new()
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4; ca, sa = math.cos(a), math.sin(a)
        prof = [(zc + .002, .0080, .0222 * K), (zc - .010, .0096, .0228 * K), (zc - .020, .0056, .0214 * K), (zc - .027, .0, .0196 * K)]
        for side in (1,):
            vs = []
            for z, w, r in prof:
                for o in (-w, w):
                    vs.append(lv.verts.new((ca * (r + .0012) - sa * o, sa * (r + .0012) + ca * o, z)))
            for j in range(len(prof) - 1):
                lv.faces.new((vs[2 * j], vs[2 * j + 1], vs[2 * j + 3], vs[2 * j + 2]))
    mesh_obj('Pommel_Leaves', lv, 'KF_Gold', smooth_angle=50)
    lathe('Pommel_Tip', 'KF_Gold', [(zc - .068, .0), (zc - .060, .0065), (zc - .053, .0085), (zc - .050, .0060)], 12, smooth=40)
acorn_pommel()

# ------------------------------------------------------------------ the haft's curve
# Like a Leviathan-style handle: straight through the eye, then a gentle ergonomic bow that brings the butt forward,
# under the beard. Everything below the eye follows it (haft, wrap, bands, keeper, pommel).
def haft_bend(z):
    w = min(1.0, max(0.0, (EYE[0] - .02 - z) / (EYE[0] - .02 - HAFT[0])))
    return .024 * w ** 1.6
def bend_lower():
    head = ('Head_', 'Heart_', 'Veins_', 'Panel_', 'Eye_', 'Band_Eye', 'Cap_')   # the head is forged straight; only the haft bows
    for o in [o for o in SC.objects if o.type == 'MESH' and not o.name.startswith(head)]:
        if o.name == 'Strap_Stud':
            o.location.x += haft_bend(o.location.z); continue
        me = o.data; co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        co[:, 0] += [haft_bend(z) for z in co[:, 2]]
        me.vertices.foreach_set('co', co.ravel()); me.update()
bend_lower()
def panel_rivets():
    """The enamel is a separate plate: four brass rivets pin it to the cheek, through both faces."""
    bm = bmesh.new()
    for p_, q_ in ((.02, .80), (.02, .22), (.52, .62), (.88, .50)):
        s_, t_ = (float(v) for v in panel_st(p_, q_))
        for side in (-1, 1):
            c = on_cheek(s_, t_, PLATE, side)
            ring = [bm.verts.new((c.x + math.cos(a) * .0028, c.y, c.z + math.sin(a) * .0028)) for a in np.linspace(0, TAU, 9)[:-1]]
            top = bm.verts.new((c.x, c.y + side * .0016, c.z))
            for k in range(8):
                f = (ring[k], ring[(k + 1) % 8], top); bm.faces.new(f if side > 0 else tuple(reversed(f)))
    mesh_obj('Panel_Rivets', bm, 'KF_Gold', smooth_angle=70)
panel_rivets()

# ------------------------------------------------------------------ sockets
empty('Grip_Center', (0.0075 + haft_bend(0.120), 0, 0.120))
for name, a in (('CuttingEdge_Bottom', -.9 * A_HI), ('CuttingEdge_Mid', 0.0), ('CuttingEdge_Top', .9 * A_HI)):   # symmetric about the arc's middle
    empty(name, (EDGE_C[0] + EDGE_R * math.cos(a), 0, EDGE_C[1] + EDGE_R * math.sin(a)))
empty('Head_Center', (0.140, 0, 0.700))
empty('Poll_Face', (-0.0745, 0, POLL_Z))
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
                          export_image_format='AUTO')  # PNG source art: the delivery build converts it losslessly (AGENTS.md)
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'briar_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
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
    light((1.0, -1.3, 1.5), 200, col=(1, .93, .82)); light((-1.2, .9, .9), 110, col=(.72, .84, 1)); light((0.3, 1.5, 1.4), 70)
    glow = bpy.data.lights.new('heart', 'POINT'); glow.energy = .35; glow.color = (1, .55, .15); glow.shadow_soft_size = .01
    for side in (-1, 1):
        go = bpy.data.objects.new('heart', glow); go.location = (HEART[0], side * .03, HEART[1]); SC.collection.objects.link(go)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {'full': ((.10, -1.55, .42), (.08, 0, .42), 42), 'three-quarter': ((1.0, -1.45, .95), (.07, 0, .45), 45),
             'head': ((.10, -.86, .68), (.10, 0, .68), 50), 'poll': ((-.40, -.34, .86), (-.03, 0, .74), 55), 'edge-on': ((1.0, -.05, .76), (.12, 0, .75), 60),
             'heart': ((.08, -.26, .76), (.08, 0, .75), 55), 'back': ((-.9, 1.6, .75), (.06, 0, .45), 45),
             'first-person': ((-.30, -.36, .34), (.10, .05, .74), 30),
             'socket': ((-.12, -.40, .82), (-.02, 0, .76), 55), 'pommel': ((.08, -.30, .02), (0, 0, -.03), 55)}
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
