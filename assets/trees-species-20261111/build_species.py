# New tree species (Opus 5.5, 2026-11-11): Highland Fir, Emberleaf Maple and Dawnbloom Cherry.
#
# Two stages, both reusing the shipped tree tooling so every species obeys the same cutting contract:
#  1. Trunk + Roots + empties come from the procedural trunk builder in
#     multiplayer/assets-source/trees/canopy-20261003/build_trees.py (regular horizontal 12-gon rings, axis x=z=0
#     below 2 m, linear between rings), so notch carving, felling, logs and stumps work exactly as on the old trees.
#  2. The crown (Branches, Leaves, Fruit) is grown with the alpha-cut leaf-spray method of
#     assets/trees-canopy-20261004/build_trees.py, extended here with a tiered conifer crown for the fir.
#
# Run (Blender as a Python module, e.g. `pip install bpy` under Python 3.11):
#   python build_species.py -- --out <multiplayer/public/assets> [--only tree_fir]
# Writes <species>.glb + <species>_lod.glb, and species_contract.json (trunk rings for shared/trees.js TREE_PROFILES)
# next to this file. Deterministic: every random draw comes from a seeded generator.
import bpy, math, random, sys, os, json, runpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None): return argv[argv.index(name) + 1] if name in argv else default
OUT = arg('--out', os.path.join(ROOT, 'multiplayer', 'public', 'assets')); ONLY = arg('--only')
TMP = os.path.join(bpy.app.tempdir or '/tmp', 'species-trunks'); os.makedirs(TMP, exist_ok=True)

# Stage-1 library (its file ends in an unconditional main(); strip that call and exec the rest).
src03 = open(os.path.join(ROOT, 'multiplayer', 'assets-source', 'trees', 'canopy-20261003', 'build_trees.py')).read()
L03 = {'__name__': 'lib03', '__file__': 'canopy-20261003/build_trees.py'}
exec(compile(src03[:src03.rindex('\nmain()')], 'build_trees_03', 'exec'), L03)
# Stage-2 library (guarded main; module-level argv parsing is harmless).
_argv = sys.argv; sys.argv = ['x']
L04 = runpy.run_path(os.path.join(ROOT, 'assets', 'trees-canopy-20261004', 'build_trees.py'), run_name='lib04')
sys.argv = _argv
Mesh, frame, tube, root_flare, leaf_material, flat_material, fit_glb_materials, to_image, vnoise, smooth = (
    L04[k] for k in ('Mesh', 'frame', 'tube', 'root_flare', 'leaf_material', 'flat_material', 'fit_glb_materials', 'to_image', 'vnoise', 'smooth'))

# ---------------------------------------------------------------- species
# trunk: stage-1 PARAMS (rb base radius, r2 radius at 2 m, fork = Trunk mesh top, H = contract height).
# crown: stage-2 spec in Blender space (Z up). 'form' picks the crown grower.
SPECIES = {
    'tree_fir': dict(  # Highland Fir: a tall straight spire of drooping, layered boughs; blue-green with bright new tips
        trunk=dict(seed=71, rb=.36, r2=.2, fork=3.6, top=5.0, limbs=5, first=2.4, hi=3.2, reach=1.0, limb_r=.05, lean=(.04, .02), wig=.03, leaf=.8, asym=0, asym_az=0, az0=.3, H=8.4),
        form='conifer', first_limb=2.85, tiers=8, tier_radius=(2.0, .42), boughs=(11, 6), droop=.38, cards=300,
        card=(.95, 1.25), leader=2.25, seed=71, roots=(6, .5, .75, .18), bark='fir', fruit=10, fruit_style='cone'),
    'tree_maple': dict(  # Emberleaf Maple: a big rounded dome of ember orange, scarlet and gold; smooth grey bark
        trunk=dict(seed=83, rb=.4, r2=.215, fork=3.0, top=5.0, limbs=6, first=2.3, hi=3.9, reach=2.2, limb_r=.11, lean=(.12, .05), wig=.08, leaf=1, asym=0, asym_az=0, az0=.9, H=6.8),
        form='broad', first_limb=2.3, limbs=6, limb_elev=(30, 48), limb_len=(2.0, 2.6), limb_radius=.105, upturn=.45, droop=0.0,
        child=(3, 4), child_len=(.45, .62), twigs=(3, 5), twig_len=(.3, .45), leader=.6,
        crown=(2.65, 2.65, 1.85), crown_center=(.1, -.05, 4.55), clusters=360, card=(.88, 1.12), fruit=34, fruit_style='samara',
        seed=83, bark='maple', roots=(6, .58, .8, .2)),
    'tree_blossom': dict(  # Dawnbloom Cherry: low spreading umbrella of pink blossom on dark banded bark
        trunk=dict(seed=97, rb=.34, r2=.2, fork=2.9, top=4.2, limbs=5, first=2.2, hi=3.0, reach=1.8, limb_r=.08, lean=(.3, -.12), wig=.12, leaf=.9, asym=.3, asym_az=1.2, az0=1.7, H=5.2),
        form='broad', first_limb=2.2, limbs=5, limb_elev=(20, 36), limb_len=(2.0, 2.5), limb_radius=.085, upturn=.15, droop=.25,
        child=(3, 4), child_len=(.42, .58), twigs=(3, 5), twig_len=(.28, .4), leader=.35,
        crown=(2.6, 2.6, 1.15), crown_center=(.3, -.1, 3.75), clusters=320, card=(.82, 1.05), fruit=0,
        seed=97, bark='cherry', roots=(5, .45, .7, .16)),
}
LOD = dict(cluster_scale=.34, card_scale=1.55, sides=4)

# ---------------------------------------------------------------- painted textures
def spray_texture(species, size=512, seed=1):
    """One leaf-spray card (RGBA, straight alpha): a twig with this species' foliage, for alpha-cut crown cards."""
    S = size; yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S; rng = random.Random(seed)
    out = np.zeros((S, S, 4), np.float32)
    def stamp(alpha, col):
        m = np.clip(alpha, 0, 1)[..., None]; out[..., :3] = out[..., :3] * (1 - m) + np.asarray(col, np.float32) * m
        out[..., 3] = np.maximum(out[..., 3], m[..., 0])
    def stroke(p0, p1, w, col):
        d = np.asarray(p1) - np.asarray(p0); L2 = max(1e-9, float(d @ d))
        t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / L2, 0, 1)
        dist = np.hypot(xx - (p0[0] + t * d[0]), yy - (p0[1] + t * d[1]))
        stamp(smooth(w, w * .45, dist), col)
    stem = [(.5 + .035 * math.sin(t * 2.2 + seed), .97 - .9 * t) for t in np.linspace(0, 1, 30)]
    if species == 'fir':
        # flat frond: a twig with dense paired needles, side twiglets, bright new growth at the tips
        for i in range(len(stem) - 1): stroke(stem[i], stem[i + 1], .012, (.2, .13, .07))
        twigs = [(stem[k], math.radians(s * rng.uniform(38, 52)), .3 * (1 - k / 34)) for k in range(4, 26, 4) for s in (-1, 1)]
        for base, ang, L in twigs:
            tip = (base[0] + math.sin(ang) * L, base[1] - math.cos(ang) * L); stroke(base, tip, .008, (.18, .12, .06))
            for j in range(9):
                t = (j + 1) / 10; p = (base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t)
                for s in (-1, 1):
                    a = ang + s * math.radians(rng.uniform(55, 75)); n = .055 * (1.05 - .4 * t)
                    q = (p[0] + math.sin(a) * n, p[1] - math.cos(a) * n)
                    new = t > .62
                    col = (.3, .52, .18) if new else (.07, .23, .14) if rng.random() < .5 else (.1, .29, .17)
                    stroke(p, q, .0085, [c * rng.uniform(.88, 1.1) for c in col])
        for k in range(1, 29):
            p = stem[k]; t = k / 29
            for s in (-1, 1):
                a = math.radians(s * rng.uniform(60, 80)); n = .06 * (1.1 - .5 * t); q = (p[0] + math.sin(a) * n, p[1] - math.cos(a) * n)
                stroke(p, q, .009, (.32, .55, .2) if t > .75 else (.09, .27, .16))
    else:
        for i in range(len(stem) - 1): stroke(stem[i], stem[i + 1], .011, (.24, .15, .1) if species == 'maple' else (.2, .1, .08))
        def leaf(base, ang, length, width, col, lobes=0):
            dx, dy = math.sin(ang), -math.cos(ang); px, py = xx - base[0], yy - base[1]
            u = (px * dx + py * dy) / length; v = (px * -dy + py * dx) / length
            if lobes:  # palmate maple leaf: five pointed lobes on a polar outline around the leaf centre
                cu, r = u - .5, None; ang2 = np.arctan2(v, cu); rad = np.hypot(cu, v)
                lobe = .5 * (.55 + .45 * np.abs(np.cos(ang2 * 2.5)) ** .6) * (1 - .25 * (np.abs(ang2) > 2.3))
                a = np.clip((lobe - rad) * length * S / 1.2, 0, 1)
                vein = (np.abs(np.sin(ang2 * 2.5)) < .06) * (rad < lobe * .9) * .18
                tone = (.85 + .3 * np.clip(1 - rad * 2, 0, 1))[..., None]
                stamp(a, np.asarray(col) * tone[..., 0:1].mean() * 0 + np.asarray(col) * 1.0)
                out[..., :3] *= (1 - vein * a)[..., None]
                return
            half = width * .5 * np.clip(np.sin(np.clip(u, 0, 1) * math.pi), 0, 1) ** .8
            inside = (u > 0) & (u < 1); a = np.clip((half - np.abs(v)) * length * S / 1.3, 0, 1) * inside
            stamp(a, col)
        if species == 'maple':
            pal = [(.8, .27, .04), (.88, .44, .06), (.68, .12, .05), (.93, .62, .12), (.75, .35, .05)]
            for i in range(12):
                t = .12 + .82 * (i / 11); side = -1 if i % 2 else 1; base = stem[min(29, int(t * 29))]
                ang = math.radians(side * rng.uniform(35, 70)) * (1 - .7 * (i == 11)); L = .34 * rng.uniform(.85, 1.1) * (1 - .25 * t)
                stroke(base, (base[0] + math.sin(ang) * L * .25, base[1] - math.cos(ang) * L * .25), .006, (.45, .18, .06))
                leaf((base[0] + math.sin(ang) * L * .2, base[1] - math.cos(ang) * L * .2), ang, L, .9, [c * rng.uniform(.88, 1.08) for c in pal[rng.randrange(5)]], lobes=5)
        else:  # blossom: clusters of five-petal flowers, a few fresh leaves
            for i in range(5):
                t = .2 + .7 * i / 4; side = -1 if i % 2 else 1; base = stem[min(29, int(t * 29))]
                leaf(base, math.radians(side * rng.uniform(45, 70)), .2, .42, (.3, .5, .16))
            for i in range(44):
                t = rng.uniform(.04, 1.0); base = stem[min(29, int(t * 29))]
                c = (base[0] + rng.gauss(0, .1), base[1] + rng.gauss(0, .06)); r = rng.uniform(.045, .062); spin = rng.uniform(0, 6.28)
                pink = [(.98, .5, .68), (.96, .62, .78), (1.0, .76, .86), (.92, .42, .62)][rng.randrange(4)]
                for k in range(5):
                    a = spin + k * 1.2566; pc = (c[0] + math.cos(a) * r * .55, c[1] + math.sin(a) * r * .55)
                    d = np.hypot(xx - pc[0], yy - pc[1]); stamp(smooth(r * .55, r * .4, d), [x * rng.uniform(.93, 1.03) for x in pink])
                stamp(smooth(r * .22, r * .12, np.hypot(xx - c[0], yy - c[1])), (.95, .72, .2))
    rgb, a = out[..., :3], out[..., 3:4]; mean = (rgb * a).sum((0, 1)) / max(1e-6, a.sum())
    out[..., :3] = np.where(a > .02, rgb, mean)  # bleed colour into clear texels so mipmaps don't fringe dark
    return out

def bark_texture(kind, size=512):
    h = w = size; n1 = vnoise((h, w), 24, 11); n2 = vnoise((h, w), 6, 12); n3 = vnoise((h, w), 60, 13)
    y = np.arange(h)[:, None] / h + np.zeros((1, w)); x = np.zeros((h, 1)) + np.arange(w)[None, :] / w
    if kind == 'fir':  # reddish grey scaly plates
        ph = x * 7 + .8 * n1; fr = ph - np.floor(ph); edge = np.abs(fr - .5) * 2
        fy = (y * 11 + np.floor(ph) * .37 + .4 * n2) % 1; brk = np.clip((np.abs(fy - .5) * 2 - .86) / .08, 0, 1)
        base = np.stack([.42 + .1 * n3, .3 + .06 * n3, .25 + .05 * n3], -1)
        img = base * (1 - .55 * np.clip((edge - .78) / .15, 0, 1))[..., None] * (1 - .45 * brk)[..., None]
        img = img + (np.array([.6, .55, .5]) - img) * (.25 * np.clip(1 - np.abs(fr - .35) * 5, 0, 1))[..., None]
    elif kind == 'maple':  # smooth grey-brown with fine shallow vertical fissures
        ph = x * 12 + 1.4 * n1; fr = ph - np.floor(ph)
        base = np.stack([.5 + .07 * n3, .46 + .06 * n3, .41 + .05 * n3], -1)
        img = base * (1 - .32 * smooth(.08, .0, np.abs(fr - .5) - .42 + .05 * n2))[..., None]
    else:  # cherry: dark glossy red-brown with pale horizontal lenticel bands
        base = np.stack([.3 + .06 * n1, .14 + .03 * n1, .11 + .02 * n1], -1); img = base.copy()
        rng = np.random.default_rng(31)
        for _ in range(140):
            cy, cx, L = rng.integers(0, h), rng.integers(0, w), rng.integers(10, 60)
            img[cy:cy + 3, cx:cx + L] = img[cy:cy + 3, cx:cx + L] * .4 + np.array([.62, .5, .42]) * .6
        img *= (.85 + .2 * smooth(.3, .7, n3))[..., None]
    img = np.clip(img * (.92 + .1 * n2[..., None]), 0, 1)
    return np.concatenate([img, np.ones((h, w, 1))], -1).astype(np.float32)

# ---------------------------------------------------------------- stage 1: trunk source GLBs
def build_trunks(name, spec):
    P = dict(spec['trunk']); pl = L03['restyle_canopy'](L03['plan_tree'](P)); report = {}
    for lod in (False, True):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        imgs = {k: None for k in ('bark',)}
        mats = dict(bark=L03['make_mat']('Bark', None, .88), leaf=L03['make_mat']('Leaves', None, .72), fruit=L03['make_mat']('Fruit', None, .35))
        root = bpy.data.objects.new('Tree', None); bpy.context.scene.collection.objects.link(root)
        objs, ex = L03['emit_tree'](pl, lod, root, mats)
        # Branches/Leaves/Fruit are rebuilt in stage 2; keep Trunk, Roots and the empties.
        for k in ('Branches', 'Leaves', 'Fruit'):
            if k in objs: bpy.data.objects.remove(objs[k], do_unlink=True)
        path = os.path.join(TMP, name + ('_lod' if lod else '') + '.glb'); L03['export'](root, path)
        if not lod: report = dict(samples=ex['samples'], contour_dev=round(ex['contour_dev'], 4), fall=ex['empties']['FallTip'])
    return report

# ---------------------------------------------------------------- stage 2 crowns
def grow_conifer(spec, top, trunk_r, lod, rng):
    """Whorled boughs on a straight leader. Each tier is a ring of drooping limbs; returns the tube mesh, the bough
    polylines (for the cards) and tips (for cones)."""
    sides = LOD['sides'] if lod else 6; branches = Mesh(); boughs = []; tips = []
    H = spec['trunk']['H']; z0 = spec['first_limb']; n = spec['tiers']; r0, r1 = spec['tier_radius']
    lead = [Vector((top.x, top.y, top.z - .05))]
    for i in range(1, 9): lead.append(Vector((top.x + .02 * math.sin(i), top.y, top.z + (H - .25 - top.z) * i / 8)))
    tube(branches, lead, [trunk_r * .95 * (1 - i / 9) ** 1.1 + .015 for i in range(9)], sides + 2)
    for t in range(n):
        k = t / (n - 1); z = z0 + (H - .9 - z0) * k ** .92; R = r0 + (r1 - r0) * k ** .85
        count = round(spec['boughs'][0] + (spec['boughs'][1] - spec['boughs'][0]) * k); spin = rng.uniform(0, 6.28)
        for b in range(count):
            az = spin + (b + rng.uniform(-.2, .2)) / count * math.tau; L = R * rng.uniform(.88, 1.08)
            el = math.radians(rng.uniform(4, 14) + 12 * k); m = 5; L *= .82
            cx = top.x * min(1, z / top.z); p = Vector((cx, top.y, z)); pts = [p.copy()]
            for s in range(m):
                q = (s + 1) / m; e = el - math.radians(spec['droop'] * 60) * q * q
                p = p + Vector((math.cos(az) * math.cos(e), math.sin(az) * math.cos(e), math.sin(e))) * (L / m); pts.append(p.copy())
            rad = [max(.012, .06 * (1 - .4 * k) * (1 - .85 * s / m)) for s in range(m + 1)]
            if not lod or b % 2 == 0: tube(branches, pts, rad, max(3, sides - 2))
            boughs.append((pts, az, k)); tips.append((pts[-1], (pts[-1] - pts[-2]).normalized(), 1))
    return branches, boughs, tips, lead

def needle_field(h=512, w=256, seed=5):
    """Opaque, horizontally tileable carpet of short needles (left half of the fir texture; the skirts use it)."""
    rng = np.random.default_rng(seed); img = np.zeros((h, w, 3), np.float32)
    img[:] = np.array([.05, .16, .1]) * (.85 + .3 * vnoise((h, w), 40, seed)[..., None])
    pal = np.array([[.06, .2, .12], [.09, .27, .15], [.12, .33, .17], [.2, .43, .2], [.3, .55, .22]], np.float32)
    for _ in range(5200):
        cy, cx = rng.uniform(0, h), rng.uniform(0, w); ang = rng.uniform(-.6, .6) + (math.pi / 2 if rng.random() < .5 else 0) * .0
        L = rng.uniform(7, 13); dx, dy = math.sin(ang) * L, math.cos(ang) * L
        lit = min(4, int(rng.uniform(0, 3.2) + 1.2 * (1 - cy / h)))
        col = pal[lit] * rng.uniform(.85, 1.12)
        y0, y1 = int(cy - 15), int(cy + 15); x0, x1 = int(cx - 15), int(cx + 15)
        ys = np.arange(y0, y1)[:, None]; xs = np.arange(x0, x1)[None, :]
        t = np.clip(((xs - cx) * dx + (ys - cy) * dy) / (L * L), 0, 1)
        d = np.hypot(xs - (cx + t * dx), ys - (cy + t * dy)); a = np.clip(1.6 - d, 0, 1) * (.75 + .25 * t)
        yi = ys % h; xi = xs % w; sub = img[yi, xi]; img[yi, xi] = sub * (1 - a[..., None]) + col * a[..., None]
    return img

def conifer_texture(seed):
    frond = spray_texture('fir', 512, seed); out = np.zeros((512, 512, 4), np.float32)
    out[:, :256, :3] = needle_field(512, 256, seed); out[:, :256, 3] = 1
    out[:, 256:] = frond.reshape(512, 256, 2, 4).mean(axis=2)   # frond squeezed into the right half (cards undo it)
    return out

def foliage_conifer(spec, boughs, lead, lod, rng):
    """Each whorl is a solid, scalloped needle skirt (opaque half of the texture: reads as a dense layered fir from
    every angle and costs no overdraw), fringed by alpha-cut fronds that droop off every bough tip so the silhouette
    stays feathery. Vertex shade: dark under and inside, sunlit yellow-green new growth on the rim."""
    leaves = Mesh(); H = spec['trunk']['H']
    tiers = {}
    for pts, az, k in boughs: tiers.setdefault(round(k, 4), []).append((pts, az))
    seg = 18 if lod else 30; rad_steps = 2 if lod else 4
    for k, list_ in sorted(tiers.items()):
        top = list_[0][0][0]; azs = [az for _, az in list_]; R = sum((p[-1] - p[0]).length for p, _ in list_) / len(list_)
        lift = .38 * R + .25; hang = min(.5 * R + .15, top.z - 2.05)   # skirt rises above the whorl and droops below it (never into the 0.4-1.6 m cut band)
        def rim(th):
            g = max(math.cos((th - a) % math.tau if False else 0) for a in [0])
            d = min(abs(((th - a + math.pi) % math.tau) - math.pi) for a in azs) / (math.pi / len(azs))
            return .64 + .42 * (1 - d) ** 2
        ring_top, ring_bot = [], []
        for i in range(seg + 1):
            th = i / seg * math.tau; rr = R * rim(th); row_t, row_b = [], []
            for j in range(rad_steps + 1):
                f = j / rad_steps; r = .12 + (rr - .12) * f
                zt = top.z + lift * (1 - f) ** 1.3 - hang * f ** 1.8 * (.7 + .3 * rim(th))
                zb = top.z - hang * .35 * f - .04
                row_t.append(Vector((top.x + math.cos(th) * r, top.y + math.sin(th) * r, zt)))
                row_b.append(Vector((top.x + math.cos(th) * r * .97, top.y + math.sin(th) * r * .97, zb if j < rad_steps else zt - .03)))
            ring_top.append(row_t); ring_bot.append(row_b)
        for side, rings in (('top', ring_top), ('bot', ring_bot)):
            verts, uvs, cols, nrms, faces = [], [], [], [], []
            for i, row in enumerate(rings):
                th = i / seg * math.tau
                for j, p in enumerate(row):
                    f = j / rad_steps; verts.append(p)
                    uvs.append((.02 + .46 * ((i / seg * 3) % 1.0), .02 + .96 * f))   # u wraps 3x round the tier
                    if side == 'top':
                        g = .72 + .5 * f ** .8 + .1 * (1 - k); col = (g * (1 + .22 * f), g * (1 + .12 * f), g * (.95 - .1 * f), 1)
                        n = Vector((math.cos(th) * (.35 + .55 * f), math.sin(th) * (.35 + .55 * f), 1 - .4 * f)).normalized()
                    else:
                        g = .38 + .2 * f; col = (g, g, g, 1)
                        n = Vector((math.cos(th) * .5, math.sin(th) * .5, -.3)).normalized()
                    cols.append(col); nrms.append(tuple(n))
            w = rad_steps + 1
            for i in range(seg):
                for j in range(rad_steps):
                    a0, b0 = i * w + j, (i + 1) * w + j
                    faces.append((a0, b0, b0 + 1, a0 + 1) if side == 'top' else (a0, a0 + 1, b0 + 1, b0))
            leaves.add(verts, faces, uvs, cols, nrms)
        # fronds: one or two drooping alpha cards off each bough tip, continuing the skirt
        for pts, az in list_:
            out = Vector((math.cos(az), math.sin(az), 0)); side = Vector((-out.y, out.x, 0))
            for q in range(1 if lod else 2):
                s = (1.25 + .35 * rng.random()) * (1 - .35 * k) * (1.2 if lod else 1)
                drop = max(0.0, min(1.0, (top.z - hang * .55 - 2.0) / max(.1, s * .62)))
                base = top + out * (R * rim(az) * (.72 + .1 * q)) + Vector((0, 0, -hang * .55))
                el = (.6 + .2 * q) * drop; d = (out * math.cos(el) + Vector((0, 0, -math.sin(el)))).normalized()
                sp = (side * math.cos(.5 * (q - .5)) + Vector((0, 0, .15))).normalized()
                c0 = base - sp * s * .5; c1 = base + sp * s * .5
                corners = [c0, c1, c1 + d * s, c0 + d * s]
                lift_up = max(0.0, 2.0 - min(p.z for p in corners)); corners = [p + Vector((0, 0, lift_up)) for p in corners]  # keep the fringe above head height
                uvs = [(.52, .02), (.98, .02), (.98, .98), (.52, .98)]
                n = (out * .5 + Vector((0, 0, .85))).normalized()
                leaves.add(corners, [(0, 1, 2, 3)], uvs, [(.95, .97, .9, 1)] * 4, [tuple(n)] * 4)
    # crown tip: a slim cone of needles up the leader
    tip = lead[-1]; base_z = tip.z - 1.35; verts, uvs, cols, nrms, faces = [], [], [], [], []
    for i in range(13):
        th = i / 12 * math.tau
        for j, (r, z) in enumerate(((.42, base_z), (.2, base_z + .7), (.02, tip.z + .25))):
            verts.append(Vector((tip.x + math.cos(th) * r, tip.y + math.sin(th) * r, z))); uvs.append((.02 + .46 * (i / 12 * 2 % 1), .1 + .4 * j))
            cols.append((.95, 1, .9, 1)); nrms.append(tuple(Vector((math.cos(th), math.sin(th), .7)).normalized()))
    for i in range(12):
        for j in range(2): a0 = i * 3 + j; faces.append((a0, a0 + 3, a0 + 4, a0 + 1))
    leaves.add(verts, faces, uvs, cols, nrms)
    return leaves

def fruit_extra(spec, tips, rng, count):
    """Fir cones (hanging, scaled) and maple samaras (paired keys); apples/acorns/catkins live in stage 2."""
    import bmesh
    fruit = Mesh(); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    base_v = [v.co.copy() for v in bm.verts]; base_f = [[v.index for v in f.verts] for f in bm.faces]; bm.free()
    style = spec['fruit_style']; placed = 0; tries = 0
    while placed < count and tries < count * 40:
        tries += 1; p, d, _ = tips[rng.randrange(len(tips))]
        if style == 'cone':
            c = p + Vector((0, 0, -.12)); r = rng.uniform(.06, .075)
            verts = [c + Vector((v.x * r, v.y * r, v.z * r * 2.4 - r * .6)) for v in base_v]
            cols = [(.36 + .08 * (v.z > 0), .2 + .04 * (v.z > 0), .1, 1) for v in base_v]
        else:  # samara pair: two flattened wings
            c = p + Vector((rng.gauss(0, .25), rng.gauss(0, .25), -rng.uniform(.05, .25))); r = .05
            verts = [c + Vector((v.x * r * 2.2, v.y * r * .5, v.z * r * 1.0)) for v in base_v]
            cols = [(.75, .42, .12, 1)] * len(base_v)
        fruit.add(verts, base_f, None, cols); placed += 1
    return fruit

def build(name, spec, lod, leaf_arr, bark_arr):
    tag = name + ('_lod' if lod else '')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TMP, tag + '.glb'))
    half = lambda a: a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, a.shape[2]).mean(axis=(1, 3))
    if lod: leaf_arr, bark_arr = half(leaf_arr), half(bark_arr)
    leaf_img = to_image(name + '_leaf', leaf_arr); bark_img = to_image(name + '_bark', bark_arr)
    tree = bpy.data.objects['Tree']; trunk = bpy.data.objects['Trunk']; H = spec['trunk']['H']
    bark = trunk.active_material
    if bark and bark.use_nodes:  # stage 1 exported a vertex-colour-only bark; give it this species' bark map
        nt = bark.node_tree; tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bark_img; bs = nt.nodes['Principled BSDF']
        vc = next((n for n in nt.nodes if n.type == 'VERTEX_COLOR'), None) or nt.nodes.new('ShaderNodeVertexColor')
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        nt.links.new(tx.outputs['Color'], mx.inputs[6]); nt.links.new(vc.outputs['Color'], mx.inputs[7]); nt.links.new(mx.outputs[2], bs.inputs['Base Color'])
    tv = [trunk.matrix_world @ v.co for v in trunk.data.vertices]; top_z = max(v.z for v in tv)
    ring = [v for v in tv if v.z > top_z - .02]; top = Vector((sum(v.x for v in ring) / len(ring), sum(v.y for v in ring) / len(ring), top_z))
    top_r = sum(((v.x - top.x) ** 2 + (v.y - top.y) ** 2) ** .5 for v in ring) / len(ring)
    old_roots = bpy.data.objects['Roots']; roots_mat = old_roots.active_material; bpy.data.objects.remove(old_roots, do_unlink=True)
    base = [v for v in tv if v.z < min(x.z for x in tv) + .02]; base_r = sum((v.x ** 2 + v.y ** 2) ** .5 for v in base) / len(base)
    roots_ob = root_flare(spec, base_r, lod, random.Random(spec['seed'] * 5 + (1 if lod else 0)), (.8, .78, .74)).build('Roots', roots_mat or bark)
    bpy.context.scene.collection.objects.link(roots_ob); roots_ob.parent = tree
    rng = random.Random(spec['seed'] + (1000 if lod else 0)); rng_leaf = random.Random(spec['seed'] * 7 + (1 if lod else 0))
    if spec['form'] == 'conifer':
        branches, boughs, tips, lead = grow_conifer(spec, top, top_r, lod, rng)
        leaves = foliage_conifer(spec, boughs, lead, lod, rng_leaf)
    else:
        spec2 = dict(spec, leaf_cell=0)
        branches, tips = L04['grow'](spec2, top, top_r, spec['first_limb'], lod, rng)
        leaves = L04['foliage'](spec2, tips, lod, rng_leaf)
        for i, uvs in enumerate(leaves.uv): leaves.uv[i] = [((u - .01) / .48 * .96 + .02, (v - .51) / .48 * .96 + .02) for u, v in uvs]  # whole texture, not an atlas cell
    lmat = leaf_material(leaf_img)
    objs = [branches.build('Branches', bark), leaves.build('Leaves', lmat)]
    if spec['fruit'] and not lod:
        objs.append(fruit_extra(spec, tips, random.Random(spec['seed'] * 13), spec['fruit']).build('Fruit', flat_material('Fruit', .55)))
    for o in objs: bpy.context.scene.collection.objects.link(o); o.parent = tree
    crown_top = max(v.co.z for o in objs for v in o.data.vertices); fl = spec['first_limb']
    k = (H - fl) / max(1e-6, crown_top - fl)
    for o in objs:
        for v in o.data.vertices: v.co.z = fl + (v.co.z - fl) * k
        o.data.update()
    tree['authoredFoliage'] = 'species-20261111'
    out = os.path.join(OUT, tag + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_extras=True, export_vertex_color='ACTIVE',
                              export_normals=True, export_texcoords=True, export_materials='EXPORT', export_image_format='AUTO', use_selection=False)
    fit_glb_materials(out)
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'}
    low = {o.name: round(min(v.co.z for v in o.data.vertices), 3) for o in objs}
    return {'file': tag + '.glb', 'height': H, 'crownFit': round(k, 3), 'lowest': low, 'tris': tris, 'kb': os.path.getsize(out) // 1024}

if __name__ == '__main__':
    report = {'trees': {}, 'built': []}
    for name, spec in SPECIES.items():
        if ONLY and name != ONLY: continue
        tr = build_trunks(name, spec)
        P = spec['trunk']; rings = [[-.1, tr['samples'][0]['radius_mean']]] + [[s['y'], s['radius_mean']] for s in tr['samples'][1:]]
        report['trees'][name] = dict(height=P['H'], firstLimb=spec['first_limb'], rings=rings, contour_dev=tr['contour_dev'])
        kind = {'tree_fir': 'fir', 'tree_maple': 'maple', 'tree_blossom': 'blossom'}[name]
        leaf_arr = conifer_texture(spec['seed']) if kind == 'fir' else spray_texture(kind, 512, spec['seed']); bark_arr = bark_texture(spec['bark'])
        for lod in (False, True):
            report['built'].append(build(name, spec, lod, leaf_arr, bark_arr)); print('BUILT', json.dumps(report['built'][-1]), flush=True)
    with open(os.path.join(HERE, 'species_contract.json' if not ONLY else 'species_contract.%s.json' % ONLY), 'w') as f: json.dump(report, f, indent=1)
