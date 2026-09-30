# Brann's Forge tree-cutting kit. Run:
# blender --background --factory-startup --python-exit-code 1 --python build_kit.py -- --out ABS_DIR
import bpy, sys, os, math, random, json
import numpy as np
from math import sin, cos, pi, sqrt
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.abspath('output')
TEX = os.path.join(OUT, 'textures'); os.makedirs(TEX, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- procedural textures ----------
def noise(gw, gh, seed, N=512):
    r = np.random.RandomState(seed).rand(gh, gw)
    ys = np.arange(N) * gh / N; xs = np.arange(N) * gw / N
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = ys - y0; fx = xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]; fx = (fx * fx * (3 - 2 * fx))[None, :]
    y1 = (y0 + 1) % gh; x1 = (x0 + 1) % gw
    a = r[np.ix_(y0, x0)]; b = r[np.ix_(y0, x1)]; c = r[np.ix_(y1, x0)]; d = r[np.ix_(y1, x1)]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def lerp(c0, c1, t):
    return np.array(c0)[None, None, :] * (1 - t[..., None]) + np.array(c1)[None, None, :] * t[..., None]

def bark_tex():
    n = noise(48, 4, 1) * .5 + noise(96, 12, 2) * .3 + noise(12, 2, 3) * .2   # vertical furrows
    ridge = np.abs(noise(24, 3, 4) - .5) * 2
    t = np.clip(n * .8 + (1 - ridge) * .35, 0, 1)
    col = lerp((.17, .10, .06), (.47, .31, .18), t)
    col *= (0.85 + 0.3 * noise(200, 200, 5))[..., None]
    return np.clip(col, 0, 1)

def end_tex():
    N = 512; Y, X = np.mgrid[0:N, 0:N] / N - .5
    ang = np.arctan2(Y, X); wob = noise(8, 8, 6)
    d = np.sqrt(X * X + Y * Y) * (1 + .10 * (wob - .5)) + .012 * (noise(64, 64, 7) - .5)
    ring = (d * 52 + 1.5 * noise(6, 6, 8)) % 1.0
    late = np.clip((ring - .55) / .4, 0, 1) ** 1.5
    col = lerp((.90, .74, .50), (.66, .45, .24), late)
    col = col * (1 - .25 * np.clip(1 - d / .12, 0, 1))[..., None] * (0.94 + .1 * noise(150, 150, 9))[..., None]
    col *= np.array([1, .97, .92])
    rng = random.Random(11)
    for a0 in (0.6, 2.4, 4.3):   # irregular radial cracks
        da = (ang - a0 + pi) % (2 * pi) - pi
        da = da + .2 * (noise(24, 2, int(a0 * 10)) - .5)
        w = .006 + .005 * (d > .3)
        crack = (np.abs(da) < w / np.maximum(d, .05)) & (d > .09) & (d < .3 + rng.random() * .15)
        col[crack] *= .35
    return np.clip(col, 0, 1)

def wicker_tex():
    N = 512; cells = 6; Y, X = np.mgrid[0:N, 0:N] / N * cells
    cx = X.astype(int); cy = Y.astype(int); fx = X % 1; fy = Y % 1
    h = ((cx + cy) % 2 == 0)
    prof = np.where(h, 1 - np.abs(fy - .5) * 1.5, 1 - np.abs(fx - .5) * 1.5)
    edge = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    grain = np.where(h, noise(2, 64, 12), noise(64, 2, 13))
    t = np.clip(.35 + .5 * prof + .3 * (grain - .5), 0, 1)
    col = lerp((.34, .20, .10), (.80, .58, .32), t)
    col *= np.clip(edge * 9, .35, 1)[..., None]
    return np.clip(col, 0, 1)

def make_image(name, arr):
    N = arr.shape[0]
    img = bpy.data.images.new(name, N, N, alpha=False)
    rgba = np.concatenate([arr, np.ones((N, N, 1))], axis=2)[::-1]   # numpy row0 = top
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TEX, name + '.png'); img.file_format = 'PNG'; img.save()
    return img

def make_mat(name, img, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    m.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = 0
    return m

MATS = [make_mat('bark', make_image('bark', bark_tex()), .9),
        make_mat('endgrain', make_image('endgrain', end_tex()), .72),
        make_mat('wicker', make_image('wicker', wicker_tex()), .85)]
BARK, END, WICK = 0, 1, 2

# ---------- mesh builder (authored in glTF space: Y up) ----------
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

class B:
    def __init__(s, name, mats):
        s.name = name; s.mats = mats; s.v = []; s.key = {}; s.f = []
    def vid(s, p, m, sm):
        k = (round(p[0], 5), round(p[1], 5), round(p[2], 5), m, sm)
        if k not in s.key: s.key[k] = len(s.v); s.v.append(p)
        return s.key[k]
    def add(s, pts, uvs, mat, dirfn=None, smooth=True):
        pts = list(pts); uvs = list(uvs)
        c = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
        n = (0, 0, 0)
        for i in range(1, len(pts) - 1):
            n2 = cross(sub(pts[i], pts[0]), sub(pts[i+1], pts[0])); n = tuple(n[j] + n2[j] for j in range(3))
        if dot(n, n) < 1e-14: return
        if dirfn and dot(n, dirfn(c)) < 0: pts.reverse(); uvs.reverse()
        idx, uu = [], []
        for p, u in zip(pts, uvs):
            i = s.vid(p, mat, smooth)
            if i not in idx: idx.append(i); uu.append(u)
        if len(idx) >= 3: s.f.append((idx, uu, mat, smooth))
    def tris(s): return sum(len(f[0]) - 2 for f in s.f)
    def build(s):
        me = bpy.data.meshes.new(s.name)
        me.from_pydata([(p[0], -p[2], p[1]) for p in s.v], [], [f[0] for f in s.f])
        used = sorted(set(f[2] for f in s.f)); remap = {m: i for i, m in enumerate(used)}
        for m in used: me.materials.append(MATS[m])
        uv = me.uv_layers.new(name='UVMap')
        for pi_, poly in enumerate(me.polygons):
            idx, uu, mat, sm = s.f[pi_]
            poly.material_index = remap[mat]; poly.use_smooth = sm
            for li, l in enumerate(poly.loop_indices): uv.data[l].uv = uu[li]
        me.update()
        ob = bpy.data.objects.new(s.name, me); bpy.context.scene.collection.objects.link(ob)
        return ob

radial = lambda c: (c[0], 0, c[2])

# ---------- log ----------
def log_y():
    b = B('log_y', MATS); n = 28
    def R(th, y): return .18 * (1 + .05*sin(3*th+1.3) + .03*sin(5*th+y*7) + .03*sin(y*9+th))
    stack = [(-.44, .88)] + [(-.42 + .84 * k / 10, 1.0) for k in range(11)] + [(.44, .88)]
    def pt(i, y, sc):
        th = 2*pi*i/n; r = R(th, y) * sc; return (r*cos(th), y, r*sin(th))
    for j in range(len(stack) - 1):
        for i in range(n):
            (y0, s0), (y1, s1) = stack[j], stack[j+1]
            b.add([pt(i, y0, s0), pt(i+1, y0, s0), pt(i+1, y1, s1), pt(i, y1, s1)],
                  [(i/n*3, y0*2.6), ((i+1)/n*3, y0*2.6), ((i+1)/n*3, y1*2.6), (i/n*3, y1*2.6)], BARK, radial)
    for sg in (-1, 1):
        ye = .44 * sg
        uvf = lambda p: (.5 + p[0]/.4, .5 + p[2]/.4)
        cen = (0, ye - .008*sg, 0)
        mid = [(pt(i, ye - .004*sg, .5)) for i in range(n)]
        edge = [pt(i, ye, .88) for i in range(n)]
        up = lambda c, sg=sg: (0, sg, 0)
        for i in range(n):
            k = (i+1) % n
            b.add([cen, mid[i], mid[k]], [uvf(cen), uvf(mid[i]), uvf(mid[k])], END, up, False)
            b.add([mid[i], edge[i], edge[k], mid[k]], [uvf(mid[i]), uvf(edge[i]), uvf(edge[k]), uvf(mid[k])], END, up, False)
        rng = random.Random(5 + sg)   # small chips/splinters on the end face
        for q in range(4):
            th = (q + rng.random()*.5) * pi/2 + .3; rr = .09 + rng.random()*.03
            p0 = (rr*cos(th), ye, rr*sin(th)); w = .018
            t = (cos(th+pi/2)*w, 0, sin(th+pi/2)*w)
            p1 = (p0[0]+t[0], ye, p0[2]+t[2]); p2 = (p0[0]-t[0], ye, p0[2]-t[2])
            tip = (p0[0]*1.25, ye + sg*.011, p0[2]*1.25)
            cc = (p0[0], ye - sg*.02, p0[2])
            for tri in ([p1, p2, tip], [p0, p1, tip], [p2, p0, tip]):
                b.add(tri, [uvf(x) for x in tri], END, lambda c, cc=cc: sub(c, cc), False)
    return b

# ---------- cut wedges (trunk r=1, axis at x=-1, cut centre at origin) ----------
def wedge(stage):
    hh, hw, dp = {1: (.12, .20, .05), 2: (.24, .40, .10), 3: (.36, .54, .17)}[stage]  # dp = lip build-up above trunk surface
    b = B('cut_wedge_%d' % stage, MATS); rng = random.Random(30 + stage); N = 8
    surf = lambda z: sqrt(max(1 - z*z, 0)) - 1
    cols = []
    for i in range(N + 1):
        zn = -1 + 2*i/N; z = zn*hw; sh = max(1 - zn*zn, 0) ** .7
        s = max(1 - zn*zn, 0)
        T = (surf(z) + dp, hh*sh, z); Bt = (surf(z) + dp*.8, -.55*hh*sh, z)
        az = zn*.75*hw; ax = surf(az) + .012 + .01*s
        A = (ax, -.25*hh*s, az)
        def mid(P):
            q = tuple((P[k] + A[k]) / 2 for k in range(3)); e = .06*dp*(rng.random() - .5)
            return (q[0] + e, q[1] + e*.6, q[2] + e*.4)
        cols.append((T, mid(T), Bt, mid(Bt), A))
    toward = lambda c: (1.5 - c[0], -c[1]*.2, -c[2]*.2)
    fuv = lambda p: (p[2]*.9 + .5, p[1]*.9 + p[0]*.5 + .5)
    for i in range(N):
        a, c = cols[i], cols[i+1]
        for (r0, r1) in ((0, 1), (1, 4), (2, 3), (3, 4)):
            q = [a[r0], c[r0], c[r1], a[r1]]; b.add(q, [fuv(x) for x in q], END, toward, False)
    rim = [cols[i][0] for i in range(N + 1)] + [cols[i][2] for i in range(N - 1, 0, -1)]
    L = len(rim); outer = []
    for p in rim:
        z = max(min(p[2]*1.25, .99), -.99); y = p[1]*1.3
        outer.append((surf(z) - .004, y, z))
    for j in range(L):
        k = (j + 1) % L
        q = [outer[j], outer[k], rim[k], rim[j]]
        b.add(q, [(x[2]*.8, x[1]*.8) for x in q], BARK, lambda c: (1, 0, 0), True)
    if stage == 3:   # splinter hinge rising from the lower facet
        for i in range(1, N - 1):
            M0, M1 = cols[i][3], cols[i+1][3]
            base2 = (M0[0] + .03, M0[1] + .02, M0[2])
            tip = ((M0[0]+M1[0])/2 + .05 + rng.random()*.03, (M0[1]+M1[1])/2 + .17 + rng.random()*.08, (M0[2]+M1[2])/2)
            cc = tuple((M0[k] + M1[k] + base2[k] + tip[k]) / 4 for k in range(3))
            for tri in ([M0, M1, tip], [M1, base2, tip], [base2, M0, tip], [M0, base2, M1]):
                b.add(tri, [fuv(x) for x in tri], END, lambda c, cc=cc: sub(c, cc), False)
    return b

# ---------- end cap ----------
def endcap():
    b = B('cut_endcap', MATS); n = 32; rng = random.Random(9)
    jit = [1 + .02*(rng.random() - .5)*2 for _ in range(n)]
    def P(i, r, y): th = 2*pi*i/n; r = r*jit[i % n]; return (r*cos(th), y, r*sin(th))
    uvf = lambda p: (.5 + p[0]*.5, .5 + p[2]*.5); up = lambda c: (0, 1, 0)
    cen = (0, .032, 0)
    for i in range(n):
        k = i + 1
        a, a2 = P(i, .45, .03 + .003*sin(i*1.7)), P(k, .45, .03 + .003*sin(k*1.7))
        m, m2 = P(i, .93, .03), P(k, .93, .03)
        b.add([cen, a, a2], [uvf(cen), uvf(a), uvf(a2)], END, up, False)
        b.add([a, m, m2, a2], [uvf(a), uvf(m), uvf(m2), uvf(a2)], END, up, False)
        o, o2 = P(i, 1.0, 0), P(k, 1.0, 0); d, d2 = P(i, 1.0, -.05), P(k, 1.0, -.05)
        b.add([m, o, o2, m2], [(i/n*4, .0), (i/n*4, .1), (k/n*4, .1), (k/n*4, .0)], BARK, lambda c: (c[0], 1, c[2]), True)
        b.add([o, d, d2, o2], [(i/n*4, .1), (i/n*4, .2), (k/n*4, .2), (k/n*4, .1)], BARK, radial, True)
    return b

# ---------- chips ----------
def chip(name, seed, sides):
    b = B(name, MATS); rng = random.Random(seed)
    def ring(y, a, bb, tw):
        pts = []
        for i in range(sides):
            th = 2*pi*i/sides + tw; r = 1 + .2*(rng.random() - .5)
            pts.append((a*r*cos(th) + .012*(y/.05)**2, y, bb*r*sin(th)))
        return pts
    r0 = ring(-.05, .007, .004, 0); r1 = ring(.005, .014, .006, .3); tip = (.006, .05, 0)
    ax = lambda c: (c[0], 0, c[2])
    for i in range(sides):
        k = (i + 1) % sides; m = END if i % 2 == 0 else BARK
        b.add([r0[i], r0[k], r1[k], r1[i]], [(i/sides, 0), ((i+1)/sides, 0), ((i+1)/sides, .5), (i/sides, .5)], m, ax, False)
        b.add([r1[i], r1[k], tip], [(i/sides, .5), ((i+1)/sides, .5), (.5, 1)], m, ax, False)
    b.add(r0, [(.5 + p[0]*20, .5 + p[2]*20) for p in r0], END, lambda c: (0, -1, 0), False)
    return b

# ---------- basket ----------
def basket():
    b = B('skull_basket', MATS); N = 48
    prof = [(.80,0),(.86,.012),(.88,.045),(.915,.08),(.945,.115),(.97,.15),(.99,.185),
            (1.0,.205),(.99,.222),(.968,.228),(.946,.222),(.936,.205),
            (.94,.185),(.92,.15),(.905,.11),(.89,.07),(.875,.035),(.865,.02)]
    A_, B_ = .27, .20
    def pt(i, j):
        s, y = prof[j]
        if 1 <= j <= 6: s += .008 * (1 if (i + j) % 2 == 0 else -1)
        th = 2*pi*i/N; c, sn = cos(th), sin(th)
        x = A_ * (1 if c >= 0 else -1) * abs(c) ** .5 * s; z = B_ * (1 if sn >= 0 else -1) * abs(sn) ** .5 * s
        return (x, y, z)
    for j in range(len(prof) - 1):
        ds = prof[j+1][0] - prof[j][0]; dy = prof[j+1][1] - prof[j][1]
        f = lambda c, ds=ds, dy=dy: (c[0]*dy, -ds, c[2]*dy)
        for i in range(N):
            q = [pt(i, j), pt(i+1, j), pt(i+1, j+1), pt(i, j+1)]
            v0 = prof[j][1]/.21; v1 = prof[j+1][1]/.21
            b.add(q, [(i/N*8, v0), ((i+1)/N*8, v0), ((i+1)/N*8, v1), (i/N*8, v1)], WICK, f, True)
    for i in range(N):
        a, c = pt(i, 0), pt(i+1, 0)
        b.add([(0, 0, 0), a, c], [(.5, .5), (.5 + a[0], .5 + a[2]), (.5 + c[0], .5 + c[2])], WICK, lambda q: (0, -1, 0), False)
        a, c = pt(i, len(prof) - 1), pt(i+1, len(prof) - 1)
        b.add([(0, .02, 0), a, c], [(.5, .5), (.5 + a[0], .5 + a[2]), (.5 + c[0], .5 + c[2])], WICK, lambda q: (0, 1, 0), False)
    for sg in (-1, 1):   # raised woven side handles on the short ends
        rr = .012; M = 12; sides = 6
        rings = []
        for m in range(M + 1):
            t = pi*m/M; p = (sg*.278, .19 + .078*sin(t), -.1*cos(t))
            L_ = sqrt((.078*cos(t))**2 + (.1*sin(t))**2); d = (0, .078*cos(t)/L_, .1*sin(t)/L_)
            nn = (1, 0, 0); bb = cross(d, nn)
            pts = []
            for k in range(sides):
                a = 2*pi*k/sides
                pts.append(tuple(p[j] + rr*(cos(a)*nn[j] + sin(a)*bb[j]) for j in range(3)))
            rings.append((pts, p))
        for m in range(M):
            for k in range(sides):
                k2 = (k + 1) % sides; cc = rings[m][1]
                q = [rings[m][0][k], rings[m][0][k2], rings[m+1][0][k2], rings[m+1][0][k]]
                b.add(q, [(k/sides, m/M*2), ((k+1)/sides, m/M*2), ((k+1)/sides, (m+1)/M*2), (k/sides, (m+1)/M*2)],
                      WICK, lambda c, cc=cc: sub(c, cc), True)
    return b

# ---------- build + export ----------
builders = [log_y(), wedge(1), wedge(2), wedge(3), endcap(), chip('chip_a', 21, 5), chip('chip_b', 22, 6), basket()]
objs = {}; stats = {}
for bd in builders:
    ob = bd.build(); objs[bd.name] = ob
    lo = [min(p[i] for p in bd.v) for i in range(3)]; hi = [max(p[i] for p in bd.v) for i in range(3)]
    path = os.path.join(OUT, bd.name + '.glb')
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False)
    stats[bd.name] = dict(tris=bd.tris(), verts=len(bd.v), mats=len(ob.data.materials), bytes=os.path.getsize(path),
                          min=[round(v, 3) for v in lo], max=[round(v, 3) for v in hi],
                          size=[round(hi[i] - lo[i], 3) for i in range(3)])
json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
print('EXPORTED', json.dumps({k: (v['tris'], v['size']) for k, v in stats.items()}))

# ---------- kit.blend layout + renders ----------
h = pi / 2
def place(name, loc, rot=(0, 0, 0), sc=1.0):
    o = objs[name]; o.location = loc; o.rotation_euler = rot; o.scale = (sc,) * 3
def clone(name, src, loc, rot, sc=1.0):
    o = bpy.data.objects.new(name, objs[src].data); bpy.context.scene.collection.objects.link(o)
    o.location = loc; o.rotation_euler = rot; o.scale = (sc,) * 3
place('log_y', (-1.0, -.4, .18), (0, h, .3))
clone('log_stand', 'log_y', (-.55, -.05, .44), (0, 0, .5))
place('cut_endcap', (.05, -.85, .04), (0, 0, 0), .22)
place('chip_a', (-.15, -.75, .012), (0, h, .5)); place('chip_b', (-.3, -.9, .012), (0, h, 1.7))
place('skull_basket', (.85, -.3, 0), (0, 0, .15))
bone = bpy.data.materials.new('preview_bone'); bone.diffuse_color = (.85, .82, .72, 1)
for loc, r in (((.75, -.3, .1), .1), ((.98, -.36, .09), .09), ((.9, -.2, .2), .1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=20, ring_count=12)
    bpy.context.object.name = 'preview_skull'; bpy.context.object.data.materials.append(bone)
tm = bpy.data.materials.new('preview_trunk'); tm.use_nodes = True
tn = tm.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images['bark']
tm.node_tree.links.new(tn.outputs['Color'], tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
sc = .3
for k, x in enumerate((-1.0, -.1, .8)):
    bpy.ops.mesh.primitive_cylinder_add(radius=sc, depth=1.4, vertices=48, location=(x, 1.0 + sc, .7))
    bpy.context.object.name = 'preview_trunk'; bpy.context.object.data.materials.append(tm)
    name = 'cut_wedge_%d' % (k + 1)
    if k == 0: place(name, (x, 1.0, .7), (0, 0, -h), sc)
    else: clone(name + '_placed', name, (x, 1.0, .7), (0, 0, -h), sc)
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0)); fl = bpy.context.object; fl.name = 'preview_floor'
fm = bpy.data.materials.new('preview_floor'); fm.diffuse_color = (.55, .5, .44, 1); fl.data.materials.append(fm)
S = bpy.context.scene
w = bpy.data.worlds.new('w'); w.use_nodes = True; S.world = w
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.75, .68, .6, 1); bg.inputs[1].default_value = .9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.2; sun.data.color = (1, .9, .78)
sun.rotation_euler = (.9, .2, .6); S.collection.objects.link(sun)
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'AREA')); fill.data.energy = 120; fill.data.size = 4
fill.location = (-2, -3, 2.5); fill.rotation_euler = (1.0, 0, -.5); S.collection.objects.link(fill)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); S.collection.objects.link(cam); S.camera = cam
S.render.resolution_x, S.render.resolution_y = 1280, 720; S.view_settings.view_transform = 'Standard'
try: S.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception: S.render.engine = 'BLENDER_EEVEE'
def shoot(name, loc, tgt, lens):
    cam.location = loc; cam.data.lens = lens
    cam.rotation_euler = Vector((tgt[0]-loc[0], tgt[1]-loc[1], tgt[2]-loc[2])).to_track_quat('-Z', 'Y').to_euler()
    S.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True)
try:
    shoot('render_kit_contact.png', (.1, -4.2, 2.3), (0, .3, .5), 38)
    shoot('render_closeup_wounds.png', (-.2, -.6, .9), (-.1, 1.0, .68), 50)
    shoot('render_closeup_log.png', (-.9, -2.0, .8), (-.75, -.2, .3), 45)
except Exception as e:
    print('RENDER FAILED', e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'kit.blend'))
