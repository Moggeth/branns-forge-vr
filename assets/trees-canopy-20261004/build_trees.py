# Orchard tree species rebuild (Opus 5.5, 2026-10-04): stylized-but-textured crowns for the browser game's tree kits.
#
# Keeps the shared tree contract untouched: each source GLB's Tree root, Trunk, Roots and empties (Crown, CutGuide,
# FallTip, Ground) are imported and re-exported as-is, so trunk rings, notch carving and felling stay exact. Only the
# crown is rebuilt: Branches (tapered limb tubes grown from the trunk top), Leaves (alpha-cut leaf-spray cards with
# crown-rounded normals and baked ambient occlusion) and Fruit (apples, on the apple tree only).
#
# Run (Blender 4.5 as a Python module, or blender --background --python):
#   python build_trees.py -- --src <multiplayer/public/assets> --out <dir> [--only tree]
# Deterministic: every random draw comes from a seeded generator.
import bpy, bmesh, math, random, sys, os, json, struct
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
SRC = arg('--src', os.path.join(os.path.dirname(__file__), '../../multiplayer/public/assets'))
OUT = arg('--out', SRC)
ONLY = arg('--only')

# ---------------------------------------------------------------- species
# Blender space (Z up): crown radii are (x, y, z=vertical). Heights are in authored tree metres; the crown is fitted to the contract height afterwards.
SPECIES = {
    'tree': dict(  # Orchard apple: low, broad, rounded crown on a few spreading scaffold limbs, apples on the shell
        leaf_cell=0, limbs=5, limb_elev=(24, 40), limb_len=(2.1, 2.6), limb_radius=.11, upturn=.3, droop=0.0,
        child=(3, 4), child_len=(.45, .6), twigs=(3, 5), twig_len=(.32, .45), leader=.35,
        crown=(2.55, 2.45, 1.5), crown_center=(.17, -.14, 4.1), clusters=330, card=(.82, 1.08), fruit=26,
        leaf_tint=(1.0, 1.0, 1.0), seed=11, roots=(6, .55, .75, .2)),
    'tree_b': dict(  # English oak: broader, irregular, layered; heavy horizontal limbs
        leaf_cell=1, limbs=6, limb_elev=(18, 38), limb_len=(2.4, 3.1), limb_radius=.12, upturn=.4, droop=0.0,
        child=(3, 5), child_len=(.42, .58), twigs=(3, 5), twig_len=(.3, .45), leader=.7,
        crown=(2.7, 2.7, 1.8), crown_center=(.09, -.3, 4.35), clusters=380, card=(.9, 1.15), fruit=34, fruit_style='acorn',
        leaf_tint=(1.0, 1.0, 1.0), seed=23, roots=(7, .62, .85, .21)),
    'tree_young': dict(  # Silver birch: slender, upright, airy with gently drooping tips
        leaf_cell=2, limbs=7, limb_elev=(48, 66), limb_len=(1.2, 1.7), limb_radius=.05, upturn=.1, droop=.35,
        child=(2, 3), child_len=(.4, .55), twigs=(2, 4), twig_len=(.28, .38), leader=.9,
        crown=(1.3, 1.3, 1.25), crown_center=(.02, -.1, 3.05), clusters=210, card=(.6, .8), fruit=44, fruit_style='catkin',
        leaf_tint=(1.0, 1.0, 1.0), seed=37, bark='birch', roots=(5, .3, .42, .09)),
}
LOD = dict(cluster_scale=.34, card_scale=1.55, sides=4, twigs=False)

# ---------------------------------------------------------------- painted textures (numpy, no external libs)
import numpy as np

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def vnoise(shape, scale, seed):
    rng = np.random.default_rng(seed); h, w = shape
    gh, gw = int(h / scale) + 2, int(w / scale) + 2; g = rng.random((gh, gw))
    y = np.arange(h)[:, None] / scale; x = np.arange(w)[None, :] / scale
    yi, xi = y.astype(int), x.astype(int); fy, fx = smooth(0, 1, y - yi), smooth(0, 1, x - xi)
    a, b, c, d = g[yi, xi], g[yi, xi + 1], g[yi + 1, xi], g[yi + 1, xi + 1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy

def paint_leaf_atlas(size=1024):
    """2x2 atlas of leaf sprays (apple, oak, birch, spare blossom-apple). RGBA float, premultiplied-free."""
    img = np.zeros((size, size, 4), np.float32); cell = size // 2
    yy, xx = np.mgrid[0:cell, 0:cell].astype(np.float32) / cell  # 0..1 inside a cell, y down
    def spray(cx, cy, species, seed):
        rng = random.Random(seed); out = np.zeros((cell, cell, 4), np.float32)
        palette = {
            'apple': [(.20, .42, .11), (.29, .55, .15), (.36, .62, .2)],
            'oak':   [(.14, .32, .09), (.21, .41, .12), (.27, .47, .14)],
            'birch': [(.36, .56, .12), (.46, .66, .17), (.55, .72, .22)],
        }[species]
        # Twig: a gently curved stem from the bottom centre toward the top.
        stem = [(.5 + .04 * math.sin(t * 2.4 + seed), .96 - .84 * t) for t in np.linspace(0, 1, 40)]
        for (sx, sy) in [(.5 + .04 * math.sin(t * 2.4 + seed), .96 - .84 * t) for t in np.linspace(0, 1, 220)]:  # dense: a solid stem, not beads
            d = np.hypot(xx - sx, yy - sy); a = smooth(.012, .006, d)
            out[..., :3] = np.where(a[..., None] > out[..., 3:4], np.array([.28, .2, .12]), out[..., :3])
            out[..., 3] = np.maximum(out[..., 3], a)
        n = {'apple': 13, 'oak': 11, 'birch': 17}[species]
        leaves = []
        for i in range(n):
            t = .12 + .86 * (i / (n - 1)); side = -1 if i % 2 else 1
            base = stem[min(39, int(t * 39))]
            ang = math.radians(side * rng.uniform(32, 62) + (0 if i < n - 1 else rng.uniform(-8, 8))) * (1 - .6 * (i == n - 1))
            length = {'apple': .3, 'oak': .3, 'birch': .2}[species] * rng.uniform(.82, 1.12) * (1 - .25 * t)
            width = {'apple': .4, 'oak': .42, 'birch': .55}[species]
            leaves.append((base, ang, length, width, rng.random(), rng.randrange(3)))
        leaves.sort(key=lambda l: l[4])  # random overlap order; later leaves draw on top
        for k, (base, ang, length, width, depth, shade) in enumerate(leaves):
            dirx, diry = math.sin(ang), -math.cos(ang)
            px, py = xx - base[0], yy - base[1]
            u = (px * dirx + py * diry) / length; v = (px * -diry + py * dirx) / length
            half = width * .5 * np.clip(np.sin(np.clip(u, 0, 1) * math.pi), 0, 1) ** .75
            if species == 'oak':  # rounded lobes
                half = half * (1 + .32 * np.sin(np.clip(u, 0, 1) * math.pi * 5.0 + 1.2)) * (u > .05)
            if species == 'birch':  # pointed triangular, serrated
                half = width * .5 * np.clip(np.where(u < .35, u / .35, 1 - (u - .35) / .65), 0, 1) ** .9 * (1 + .06 * np.sin(u * 60))
            inside = (u > 0) & (u < 1)
            edge = (half - np.abs(v)) * length * cell  # pixels to the edge
            a = np.clip(edge / 1.3, 0, 1) * inside
            col = np.array(palette[shade], np.float32)
            # light tip, darker base, midrib, faint veins, slight edge rim
            tone = (.82 + .3 * np.clip(u, 0, 1))[..., None]
            rib = smooth(.035, .0, np.abs(v)) * inside
            veins = (np.sin((u * 9 - np.abs(v) * 6) * math.pi) > .82) * (np.abs(v) < half * .85) * .1
            rim = smooth(2.2, .4, edge) * inside
            c = col * tone * (1 + .25 * rib[..., None] - veins[..., None]) * (1 - .18 * rim[..., None])
            c = c * (.86 + .14 * depth)
            m = a[..., None]
            out[..., :3] = out[..., :3] * (1 - m) + c * m
            out[..., 3] = np.maximum(out[..., 3], a)
        return out
    cells = [('apple', 0, 0), ('oak', 1, 0), ('birch', 0, 1), ('apple', 1, 1)]
    for s, (species, cx, cy) in enumerate(cells):
        img[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell] = spray(cx, cy, species, 101 + s * 17)
    # bleed colour into transparent texels so mipmaps don't fringe dark
    rgb, a = img[..., :3], img[..., 3:4]
    mean = (rgb * a).sum((0, 1)) / max(1e-6, a.sum())
    img[..., :3] = np.where(a > .02, rgb, mean)
    return img

def paint_birch_bark(size=512):
    h = w = size; n1 = vnoise((h, w), 24, 5); n2 = vnoise((h, w), 6, 6); n3 = vnoise((h, w), 70, 7)
    y = np.arange(h)[:, None] / h + np.zeros((1, w))
    base = np.stack([.86 + .06 * n1, .85 + .05 * n1, .8 + .04 * n1], -1)
    # horizontal lenticels: thin dark dashes; and black fissure patches lower down
    rng = np.random.default_rng(9); img = base.copy()
    for _ in range(170):
        cy, cx, L = rng.integers(0, h), rng.integers(0, w), rng.integers(8, 46)
        img[cy:cy + 2, cx:cx + L] *= .35
    patches = smooth(.62, .7, n3 * .7 + n2 * .3) * (1 - y * .3)
    img = img * (1 - .85 * patches[..., None])
    img = np.clip(img * (.92 + .1 * n2[..., None]), 0, 1)
    return np.concatenate([img, np.ones((h, w, 1))], -1).astype(np.float32)

def to_image(name, arr):
    h, w = arr.shape[:2]; im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel()); im.alpha_mode = 'STRAIGHT'
    path = os.path.join(bpy.app.tempdir or '/tmp', name + '.png'); im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    im.pack(); return im

# ---------------------------------------------------------------- geometry helpers
class Mesh:
    def __init__(self): self.v, self.f, self.uv, self.col, self.nrm = [], [], [], [], []
    def add(self, verts, faces, uvs=None, cols=None, nrms=None):
        o = len(self.v); self.v += verts
        for i, f in enumerate(faces):
            self.f.append(tuple(o + k for k in f))
            self.uv.append([uvs[k] for k in f] if uvs else [(0, 0)] * len(f))
            self.col.append([cols[k] for k in f] if cols else [(1, 1, 1, 1)] * len(f))
            self.nrm.append([nrms[k] for k in f] if nrms else None)
    def build(self, name, mat):
        me = bpy.data.meshes.new(name); me.from_pydata([tuple(p) for p in self.v], [], self.f); me.update()
        me.uv_layers.new(name='UVMap'); me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        uvl = me.uv_layers['UVMap']; ca = me.color_attributes['Color']  # re-fetch: adding a layer reallocates the others
        has_custom = any(n is not None for n in self.nrm)
        fixed = []
        for poly, uvs, cols, nrms in zip(me.polygons, self.uv, self.col, self.nrm):
            fn = poly.normal.copy()
            for k, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = uvs[k]; ca.data[li].color = cols[k]
                fixed.append(Vector(nrms[k]).normalized() if nrms else fn)
            poly.use_smooth = True
        me.color_attributes.active_color = me.color_attributes['Color']
        if has_custom: me.normals_split_custom_set(fixed)
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me); return ob

def frame(d):
    d = d.normalized(); a = Vector((0, 0, 1)) if abs(d.z) < .95 else Vector((1, 0, 0))
    x = d.cross(a).normalized(); y = d.cross(x).normalized(); return x, y

def tube(mesh, pts, radii, sides, bark_v=0.0):
    """Tapered tube along a polyline; returns nothing. UV: u around, v along (metres/1.2)."""
    rings = []; v_acc = bark_v
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]); x, y = frame(d)
        ring = []
        for s in range(sides + 1):
            a = s / sides * math.tau; ring.append(p + (x * math.cos(a) + y * math.sin(a)) * r)
        if i: v_acc += (p - pts[i - 1]).length / 1.2
        rings.append((ring, v_acc))
    verts, uvs, faces = [], [], []
    for ring, vv in rings:
        for s, q in enumerate(ring): verts.append(q); uvs.append((s / sides, vv))
    w = sides + 1
    for i in range(len(rings) - 1):
        for s in range(sides): a, b = i * w + s, (i + 1) * w + s; faces.append((a, a + 1, b + 1, b))
    tip = len(verts); verts.append(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1]); uvs.append((.5, rings[-1][1] + .05))
    last = (len(rings) - 1) * w
    for s in range(sides): faces.append((last + s, last + s + 1, tip))
    mesh.add(verts, faces, uvs)

# ---------------------------------------------------------------- root flare
def root_flare(spec, base_r, lod, rng, tint=(1, 1, 1)):
    """Rounded buttress roots: each starts buried in the trunk, swells out of it right at the soil line, runs along
    the ground and dives under it, so the trunk spreads into the earth instead of standing on flat wedges."""
    roots = Mesh(); count, h0, reach, thick = spec['roots']; sides = 5 if lod else 8; segs = 6 if lod else 12
    for k in range(count):
        az = (k + rng.uniform(-.3, .3)) / count * math.tau + spec['seed'] * .37
        L = reach * rng.uniform(.75, 1.15); h = h0 * rng.uniform(.8, 1.15); rb = thick * rng.uniform(.85, 1.1)
        pts, radii = [], []
        for i in range(segs + 1):
            t = i / segs; a = az + .2 * math.sin(t * 2.6 + k) * t
            d = base_r * .3 + L * t ** .85
            pts.append(Vector((math.cos(a) * d, math.sin(a) * d, h * (1 - t) ** 3 - .15 * t ** 1.4)))
            radii.append(max(.012, rb * min(1, .5 + 2.2 * t) * (1 - .85 * t ** .9)))
        n0 = len(roots.f); tube(roots, pts, radii, sides)
        for fi in range(n0, len(roots.f)):  # soil contact: darker where the root meets the ground
            roots.col[fi] = [(lambda g: (tint[0] * g, tint[1] * g * .96, tint[2] * g * .9, 1))(.6 + .4 * min(1, max(0, (roots.v[vi].z + .02) / .3))) for vi in roots.f[fi]]
    return roots

# ---------------------------------------------------------------- crown growth
def grow(spec, trunk_top, trunk_r, first_limb, lod, rng):
    sides = LOD['sides'] if lod else 6
    C, R = Vector(spec['crown_center']), Vector(spec['crown'])
    branches, tips = Mesh(), []  # tips: (position, direction, order)
    def limb(start, direction, length, radius, order, seg_len=.28):
        pts, d, p = [start], direction.normalized(), start.copy()
        n = max(3, int(length / seg_len))
        for i in range(n):
            t = (i + 1) / n
            bend = Vector((0, 0, spec['upturn'] * .12 - spec['droop'] * .16 * t * t))
            wob = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-.4, .4))) * .07
            d = (d + bend + wob).normalized(); p = p + d * (length / n)
            rel = Vector(((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z))
            if len(pts) > 1 and rel.length > .9: break  # wood stays inside the leaf envelope: no bare tips poking out
            pts.append(p.copy())
        n = len(pts) - 1
        radii = [max(.012, radius * (1 - .78 * (i / n)) ** 1.1) for i in range(n + 1)]
        tube(branches, pts, radii, sides if order < 1 else max(4, sides - 2 * order))
        return pts, radii
    # leader continues the trunk
    up = Vector((rng.uniform(-.05, .05), rng.uniform(-.05, .05), 1))
    lead_pts, lead_r = limb(trunk_top - Vector((0, 0, .05)), up, spec['leader'] * 2.0, trunk_r * .92, 0)
    tips.append((lead_pts[-1], up, 2))
    scaffolds = []
    for k in range(spec['limbs']):
        az = (k + rng.uniform(-.25, .25)) / spec['limbs'] * math.tau + spec['seed']
        el = math.radians(rng.uniform(*spec['limb_elev']))
        h = first_limb + (trunk_top.z - first_limb) * (k / max(1, spec['limbs'] - 1)) * .9 + rng.uniform(-.06, .06)
        start = Vector((trunk_top.x * (h / trunk_top.z), trunk_top.y * (h / trunk_top.z), h))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        scaffolds.append(limb(start, d, rng.uniform(*spec['limb_len']), spec['limb_radius'] * rng.uniform(.85, 1.1), 0) + (d,))
    for pts, radii, d0 in scaffolds + [(lead_pts, lead_r, up)]:
        tips.append((pts[-1], (pts[-1] - pts[-2]).normalized(), 1))
        for c in range(rng.randint(*spec['child'])):
            t = rng.uniform(.38, .92); i = min(len(pts) - 2, int(t * (len(pts) - 1)))
            base, along = pts[i], (pts[i + 1] - pts[i]).normalized()
            x, y = frame(along); a = rng.uniform(0, math.tau)
            d = (along * .55 + (x * math.cos(a) + y * math.sin(a)) * .8 + Vector((0, 0, .25))).normalized()
            L = (pts[-1] - pts[0]).length * rng.uniform(*spec['child_len'])
            cp, cr = limb(base, d, L, radii[i] * .62, 1, .24)
            tips.append((cp[-1], (cp[-1] - cp[-2]).normalized(), 2))
            if lod: continue
            for tw in range(rng.randint(*spec['twigs'])):
                tt = rng.uniform(.3, .95); j = min(len(cp) - 2, int(tt * (len(cp) - 1)))
                along2 = (cp[j + 1] - cp[j]).normalized(); x2, y2 = frame(along2); a2 = rng.uniform(0, math.tau)
                d2 = (along2 * .5 + (x2 * math.cos(a2) + y2 * math.sin(a2)) * .85 + Vector((0, 0, .2))).normalized()
                tp, _ = limb(cp[j], d2, rng.uniform(*spec['twig_len']) * 1.6, max(.014, cr[j] * .55), 2, .2)
                tips.append((tp[-1], d2, 3))
    return branches, tips

def foliage(spec, tips, lod, rng):
    leaves = Mesh(); C = Vector(spec['crown_center']); R = Vector(spec['crown'])
    cell = spec['leaf_cell']; u0, v0 = (cell % 2) * .5, 1 - (cell // 2 + 1) * .5
    count = int(spec['clusters'] * (LOD['cluster_scale'] if lod else 1.3))  # near kit: more, smaller sprays read finer up close
    card_scale = LOD['card_scale'] if lod else .82
    # cluster centres: around branch tips (most), plus shell fill so the silhouette is full and rounded
    centres = []
    for i in range(count):
        if i % 3 != 2 and tips:
            p, d, order = tips[rng.randrange(len(tips))]
            c = p + Vector((rng.gauss(0, .35), rng.gauss(0, .35), rng.gauss(.05, .25)))
        else:
            while True:
                q = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
                if q.length <= 1: break
            q = q.normalized() * (q.length ** .35)  # bias toward the shell
            c = C + Vector((q.x * R.x, q.y * R.y, q.z * R.z))
        # squash anything outside the crown envelope back onto it (bumpy, not a sphere)
        rel = Vector(((c.x - C.x) / R.x, (c.y - C.y) / R.y, (c.z - C.z) / R.z))
        lim = 1.0 + .16 * math.sin(math.atan2(rel.y, rel.x) * 5 + rel.z * 3)
        if rel.length > lim: rel = rel.normalized() * lim
        if rel.z < -.45: rel.z = -.45 - .08 * rng.random()  # lifted skirt: a Hero walks under the crown, not through it
        c = Vector((C.x + rel.x * R.x, C.y + rel.y * R.y, C.z + rel.z * R.z))
        centres.append((c, rel))
    for c, rel in centres:
        out = Vector((rel.x / R.x, rel.y / R.y, rel.z / R.z)).normalized() if rel.length > 1e-3 else Vector((0, 0, 1))
        depth = min(1.0, rel.length)
        ao = .5 + .5 * depth ** 1.4 + .08 * max(0, rel.z)
        s = rng.uniform(*spec['card']) * card_scale * (.85 + .3 * depth)
        for q in range(3 if not lod else 2):
            # card faces outward-ish; spin around the outward axis; tilt up a little so tops catch the sun
            n = (out * .85 + Vector((rng.uniform(-.6, .6), rng.uniform(-.6, .6), rng.uniform(-.2, .6)))).normalized()
            x, y = frame(n); a = rng.uniform(0, math.tau)
            ax = x * math.cos(a) + y * math.sin(a); ay = n.cross(ax).normalized()
            hw, hh = s * .5, s * .5
            corners = [c - ax * hw - ay * hh, c + ax * hw - ay * hh, c + ax * hw + ay * hh, c - ax * hw + ay * hh]
            uvs = [(u0 + .01, v0 + .01), (u0 + .49, v0 + .01), (u0 + .49, v0 + .49), (u0 + .01, v0 + .49)]
            # rounded-crown normals: blend card normal with the outward crown direction at each corner
            nrms = []
            for p in corners:
                r2 = Vector(((p.x - C.x) / R.x, (p.y - C.y) / R.y, (p.z - C.z) / R.z)).normalized()
                nrms.append(tuple((n * .3 + r2 * .7 + Vector((0, 0, .15))).normalized()))
            g = max(.35, min(1.0, ao)); col = (g, g, g * .97, 1)
            leaves.add(corners, [(0, 1, 2, 3)], uvs, [col] * 4, nrms)
    return leaves

def fruit_set(spec, tips, rng, count):  # apples, acorns or catkins on the crown shell (Ents light these up)
    fruit = Mesh(); C = Vector(spec['crown_center']); R = Vector(spec['crown'])
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2 if spec.get('fruit_style', 'apple') == 'apple' else 1, radius=1.0)
    base_v = [v.co.copy() for v in bm.verts]; base_f = [[v.index for v in f.verts] for f in bm.faces]; bm.free()
    placed = 0; tries = 0
    while placed < count and tries < count * 40:
        tries += 1
        p, d, order = tips[rng.randrange(len(tips))]
        c = p + Vector((rng.gauss(0, .3), rng.gauss(0, .3), -rng.uniform(.1, .35)))
        rel = Vector(((c.x - C.x) / R.x, (c.y - C.y) / R.y, (c.z - C.z) / R.z))
        if rel.length < .62 or rel.length > 1.05 or rel.z > .55: continue  # on the outer shell, mostly mid/low
        style = spec.get('fruit_style', 'apple'); blush = rng.random()
        r = {'apple': rng.uniform(.075, .095), 'acorn': rng.uniform(.042, .052), 'catkin': rng.uniform(.026, .032)}[style]
        verts, cols = [], []
        for v in base_v:
            sun = max(0, (v.normalized() @ Vector((.3, -.3, .9))))
            if style == 'apple':
                q = Vector((v.x, v.y, v.z * .88 - .1 * (1 - abs(v.z)) * (v.z > .6)))  # dimple at the top
                red = (.42 + .2 * sun, .018 + .03 * (1 - blush) + .03 * sun, .012)  # linear: deep apple red
                yel = (.6, .26, .02)
                k = min(1, .78 + .2 * blush + .1 * sun)
                col = (red[0] * k + yel[0] * (1 - k), red[1] * k + yel[1] * (1 - k), red[2] * k + yel[2] * (1 - k), 1)
            elif style == 'acorn':  # glossy nut under a rough scaly cap
                cap = v.z > .25
                q = Vector((v.x * (1.18 if cap else 1), v.y * (1.18 if cap else 1), v.z * (.7 if cap else 1.45) + (.12 if cap else 0)))
                col = (.13 + .05 * sun, .09 + .03 * sun, .045, 1) if cap else (.3 + .14 * sun + .1 * blush, .2 + .08 * sun, .035, 1)
            else:  # birch catkin: a slim hanging tassel
                q = Vector((v.x, v.y, v.z * 3.6 - 2.4))
                t = (v.z + 1) / 2
                col = (.24 + .1 * t + .06 * sun, .19 + .06 * t + .05 * sun, .05, 1)
            verts.append(c + q * r)
            cols.append(col)
        fruit.add(verts, base_f, None, cols)
        placed += 1
    return fruit

# ---------------------------------------------------------------- materials
def leaf_material(atlas):
    m = bpy.data.materials.new('Leaves'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = atlas
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Color'
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    nt.links.new(tex.outputs['Color'], mul.inputs[6]); nt.links.new(vc.outputs['Color'], mul.inputs[7])
    nt.links.new(mul.outputs[2], b.inputs['Base Color']); nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = .82; b.inputs['Metallic'].default_value = 0
    m.use_backface_culling = False
    return m

def flat_material(name, rough=.6):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Color'; nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0; return m

# ---------------------------------------------------------------- per-variant build
def fit_glb_materials(path, cutoff=.42):
    """Post-export: Leaves -> alphaMode MASK (opaque cutout, no sorting), double-sided crown materials."""
    data = open(path, 'rb').read(); jl = struct.unpack('<I', data[12:16])[0]; j = json.loads(data[20:20 + jl])
    for m in j['materials']:
        m['name'] = m.get('name', '').split('.')[0]
        if m['name'] == 'Leaves': m['alphaMode'] = 'MASK'; m['alphaCutoff'] = cutoff
        m['doubleSided'] = True
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    rest = data[20 + jl:]; total = 12 + 8 + len(js) + len(rest)
    open(path, 'wb').write(data[:8] + struct.pack('<I', total) + struct.pack('<I', len(js)) + b'JSON' + js + rest)

def build(variant, lod, atlas_arr, birch_arr):
    spec = SPECIES[variant]; name = variant + ('_lod' if lod else '')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    half = lambda a: a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, a.shape[2]).mean(axis=(1, 3))  # far kits: half-res textures
    if lod: atlas_arr, birch_arr = half(atlas_arr), half(birch_arr)
    atlas = to_image('leaf', atlas_arr); birch_img = to_image('birch_bark', birch_arr)
    tree = bpy.data.objects['Tree']; trunk = bpy.data.objects['Trunk']
    height = max((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices)
    for part in ('Branches', 'Leaves', 'Fruit'):
        o = bpy.data.objects.get(part)
        if o: bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.materials if m.name in ('Leaves', 'Fruit')]: bpy.data.materials.remove(m)
    tv = [trunk.matrix_world @ v.co for v in trunk.data.vertices]; top_z = max(v.z for v in tv)
    ring = [v for v in tv if v.z > top_z - .02]; top = Vector((sum(v.x for v in ring) / len(ring), sum(v.y for v in ring) / len(ring), top_z))
    top_r = sum(((v.x - top.x) ** 2 + (v.y - top.y) ** 2) ** .5 for v in ring) / len(ring)
    first_limb = {'tree': 2.514, 'tree_b': 2.418, 'tree_young': 2.255}[variant]
    rng = random.Random(spec['seed'] + (1000 if lod else 0))
    bark = trunk.active_material
    if spec.get('bark') == 'birch' and bark and bark.use_nodes:
        for n in bark.node_tree.nodes:
            if n.type == 'TEX_IMAGE': n.image = birch_img
    # Roots: replace the flat wedge flares with rounded buttresses (the stump keeps them; the trunk ring is untouched)
    old_roots = bpy.data.objects['Roots']; roots_mat = old_roots.active_material; bpy.data.objects.remove(old_roots, do_unlink=True)
    base = [v for v in tv if v.z < min(x.z for x in tv) + .02]; base_r = sum((v.x ** 2 + v.y ** 2) ** .5 for v in base) / len(base)
    tc = trunk.data.color_attributes[0].data if trunk.data.color_attributes else []
    tint = tuple(sum(c.color[i] for c in tc) / max(1, len(tc)) for i in range(3)) if len(tc) else (1, 1, 1)  # match trunk bark tone
    roots_ob = root_flare(spec, base_r, lod, random.Random(spec['seed'] * 5 + (1 if lod else 0)), tint).build('Roots', roots_mat)
    bpy.context.scene.collection.objects.link(roots_ob); roots_ob.parent = tree
    branches, tips = grow(spec, top, top_r, first_limb, lod, rng)
    rng_leaf = random.Random(spec['seed'] * 7 + (1 if lod else 0))
    leaves = foliage(spec, tips, lod, rng_leaf)
    objs = [branches.build('Branches', bark), leaves.build('Leaves', leaf_material(atlas))]
    if spec['fruit'] and not lod:
        objs.append(fruit_set(spec, tips, random.Random(spec['seed'] * 13), spec['fruit']).build('Fruit', flat_material('Fruit', .45)))
    for o in objs:
        bpy.context.scene.collection.objects.link(o); o.parent = tree
    # fit: the crown's top must equal the contract height (treeScale = height / authored height)
    crown_top = max(v.co.z for o in objs for v in o.data.vertices)
    print('CROWN', variant, lod, round(top.z, 3), {o.name: round(max(v.co.z for v in o.data.vertices), 3) for o in objs})
    k = (height - first_limb) / max(1e-6, crown_top - first_limb)
    for o in objs:
        for v in o.data.vertices: v.co.z = first_limb + (v.co.z - first_limb) * k
        o.data.update()
    tree['authoredFoliage'] = 'canopy-20261004'
    out = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_extras=True, export_vertex_color='ACTIVE',
                              export_normals=True, export_texcoords=True, export_materials='EXPORT', export_image_format='AUTO', use_selection=False)
    fit_glb_materials(out)
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'}
    return {'file': name + '.glb', 'height': round(height, 3), 'crownFit': round(k, 3), 'tris': tris, 'kb': os.path.getsize(out) // 1024}

if __name__ == '__main__':
    atlas_arr = paint_leaf_atlas(); birch_arr = paint_birch_bark()
    report = []
    for variant in SPECIES:
        if ONLY and variant != ONLY: continue
        for lod in (False, True):
            report.append(build(variant, lod, atlas_arr, birch_arr))
            print('BUILT', json.dumps(report[-1]))
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stats.json'), 'w') as f: json.dump(report, f, indent=1)
