# Brann Copperpot + forging hammer builder. Blender 4.5, run:
#   blender.exe -b -P build_brann.py
# All authoring is done in GODOT coordinates via G(); Blender space = (x, -z, y).
import bpy, math, os, json, struct
import numpy as np
from mathutils import Vector, Quaternion

OUT = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

def G(x, y, z):  # Godot -> Blender
    return Vector((x, -z, y))

def GS(sx, sy, sz):  # Godot scale -> Blender scale
    return (sx, sz, sy)

AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- textures
def up(a, size):
    n = a.shape[0]
    x = np.linspace(0, n - 1, size)
    i0 = np.floor(x).astype(int); i1 = np.minimum(i0 + 1, n - 1); f = x - i0
    f = f * f * (3 - 2 * f)
    r = a[i0] * (1 - f)[:, None] + a[i1] * f[:, None]
    r = r[:, i0] * (1 - f)[None, :] + r[:, i1] * f[None, :]
    return r

def fbm(size, octs=(4, 8, 16, 32, 64), p=0.55):
    t = np.zeros((size, size)); amp = 1; tot = 0
    for o in octs:
        t += up(rng.random((o + 1, o + 1)), size) * amp; tot += amp; amp *= p
    return t / tot

def dash(arr, p0, p1, col, on=5, off=4, w=1):
    h, wd = arr.shape[:2]
    x0, y0 = p0[0] * wd, p0[1] * h; x1, y1 = p1[0] * wd, p1[1] * h
    L = max(1, int(math.hypot(x1 - x0, y1 - y0)))
    for i in range(L):
        if (i % (on + off)) >= on: continue
        x = int(x0 + (x1 - x0) * i / L); y = int(y0 + (y1 - y0) * i / L)
        arr[max(0, y - w + 1):y + w, max(0, x - w + 1):x + w, :3] = col

def make_img(name, arr):
    s = arr.shape[0]
    img = bpy.data.images.new(name, s, s, alpha=False)
    a = np.ones((s, s, 4), dtype=np.float32); a[..., :3] = np.clip(arr[..., :3], 0, 1)
    img.pixels.foreach_set(a.ravel())
    img.file_format = 'PNG'; img.pack()
    return img

def tex(name, col, kind='noise', size=256, var=0.18):
    n = fbm(size)
    c = np.array(col)[None, None, :] * (1 - var + 2 * var * n[..., None])
    yy, xx = np.mgrid[0:size, 0:size] / size
    if kind == 'wood':
        g = np.sin((xx * 60 + fbm(size) * 9) * 2) * 0.5 + 0.5
        c *= (0.82 + 0.25 * g[..., None])
    elif kind == 'fabric':
        wv = 0.9 + 0.1 * (np.sin(xx * size * 1.6) * np.sin(yy * size * 1.6))
        c *= wv[..., None]
        fade = fbm(size, (3, 6, 12))
        c = c * (1 - 0.25 * fade[..., None]) + 0.25 * fade[..., None] * np.array([0.45, 0.52, 0.5])
    elif kind == 'leather':
        soot = np.clip((fbm(size, (3, 6, 12, 24)) - 0.55) * 4, 0, 1)
        c *= (1 - 0.6 * soot[..., None])
        scuff = np.clip((fbm(size, (8, 16, 48)) - 0.62) * 5, 0, 1)
        c += scuff[..., None] * 0.08
        grain = 0.94 + 0.06 * up(rng.random((size // 2, size // 2)), size)
        c *= grain[..., None]
    elif kind == 'metal':
        for _ in range(140):
            x0, y0 = rng.random(2); a = rng.random() * math.pi; L = rng.random() * 0.12
            dash(c, (x0, y0), (min(1, max(0, x0 + math.cos(a) * L)), min(1, max(0, y0 + math.sin(a) * L))),
                 np.array(col) * 1.6 + 0.05, on=99, off=0)
        cav = np.clip((fbm(size) - 0.6) * 4, 0, 1)
        c *= (1 - 0.45 * cav[..., None])
    elif kind == 'copper':
        brush = up(rng.random((size, 8)), size).T if False else np.repeat(rng.random((size, 1)), size, 1)
        c *= (0.9 + 0.18 * brush[..., None])
        pat = np.clip((fbm(size, (4, 8, 16)) - 0.6) * 3, 0, 1)  # verdigris in crevices
        c = c * (1 - 0.5 * pat[..., None]) + pat[..., None] * 0.5 * np.array([0.25, 0.45, 0.38])
    elif kind == 'skin':
        red = fbm(size, (3, 6))
        c += red[..., None] * np.array([0.08, -0.02, -0.02])
        fr = (rng.random((size, size)) > 0.993)
        frk = up(fr.astype(float)[::2, ::2], size) if False else fr.astype(float)
        c[frk > 0] *= np.array([0.78, 0.6, 0.48])
    elif kind == 'hair':
        st = np.repeat(rng.random((1, size)), size, 0)
        st = up(st[:64, :64], size) if False else st
        c *= (0.75 + 0.45 * st[..., None]) * (0.9 + 0.2 * n[..., None])
    return make_img(name, c)

MATS = {}
def mat(name, col, kind='noise', rough=0.6, metal=0.0, emit=None, size=256, var=0.18, img=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img or tex('T_' + name, col, kind, size, var)
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 3.0
    MATS[name] = m
    return m

# ---- apron texture with seams, pocket, mend and soot (UV u=(x+0.3)/0.6, v=(y-0.38)/0.96)
def apron_tex():
    s = 512
    n = fbm(s)
    c = np.array([0.30, 0.15, 0.075])[None, None, :] * (0.82 + 0.36 * n[..., None])
    soot = np.clip((fbm(s, (3, 6, 12, 24)) - 0.5) * 3, 0, 1)
    yy = np.mgrid[0:s, 0:s][0] / s
    soot = np.clip(soot + (0.35 - yy) * 1.2, 0, 1) * 0.75
    c *= (1 - soot[..., None] * 0.7)
    scuff = np.clip((fbm(s, (8, 16, 48)) - 0.6) * 5, 0, 1); c += scuff[..., None] * 0.09
    for _ in range(25):  # spark burn pits
        x, y = rng.integers(10, s - 10, 2); r = rng.integers(1, 4)
        c[y - r:y + r, x - r:x + r] *= 0.25
    U = lambda x: (x + 0.3) / 0.6; V = lambda y: (y - 0.38) / 0.96
    thread = np.array([0.78, 0.66, 0.45])
    hw = [(0.40, 0.27), (0.75, 0.27), (0.85, 0.22), (0.95, 0.17), (1.32, 0.15)]
    def w(y): return float(np.interp(y, [a for a, _ in hw], [b for _, b in hw]))
    ys = np.linspace(0.41, 1.30, 40)
    for sgn in (-1, 1):
        for i in range(len(ys) - 1):
            dash(c, (U(sgn * (w(ys[i]) - 0.018)), V(ys[i])), (U(sgn * (w(ys[i + 1]) - 0.018)), V(ys[i + 1])), thread, 4, 3)
    dash(c, (U(-0.25), V(0.41)), (U(0.25), V(0.41)), thread, 4, 3)
    dash(c, (U(-0.14), V(1.29)), (U(0.14), V(1.29)), thread, 4, 3)
    dash(c, (U(-0.26), V(0.80)), (U(0.26), V(0.80)), thread, 4, 3)  # waist seam
    dash(c, (U(-0.26), V(0.765)), (U(0.26), V(0.765)), thread, 4, 3)
    # mended patch
    px0, px1, py0, py1 = U(0.06), U(0.17), V(1.0), V(1.10)
    c[int(py0 * s):int(py1 * s), int(px0 * s):int(px1 * s)] = c[int(py0 * s):int(py1 * s), int(px0 * s):int(px1 * s)] * 0.6 + np.array([0.22, 0.13, 0.06]) * 0.4
    for i in range(7):
        t = i / 6
        for (a, b) in [((px0, py0 + t * (py1 - py0)), (px0 + 0.012, py0 + t * (py1 - py0) + 0.01))]:
            dash(c, a, b, np.array([0.85, 0.3, 0.2]), 99, 0)
            dash(c, (px1, a[1]), (px1 - 0.012, b[1]), np.array([0.85, 0.3, 0.2]), 99, 0)
    return make_img('T_Apron', c)

# ---------------------------------------------------------------- geometry helpers
def _place(o, mat_, rots):
    if rots:
        q = Quaternion()
        for ax, ang in rots:
            q = Quaternion(AX[ax], ang) @ q
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = q @ o.rotation_quaternion
    if mat_: o.data.materials.append(MATS[mat_])
    return o

def sph(c, s, m, seg=20, ring=12, rots=None, sub=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=G(*c))
    o = bpy.context.object; o.scale = GS(*s)
    if sub: o.modifiers.new('s', 'SUBSURF').levels = sub
    return _place(o, m, rots)

def box(c, s, m, bev=0.006, rots=None, segs=2):
    bpy.ops.mesh.primitive_cube_add(size=2, location=G(*c))
    o = bpy.context.object; o.scale = GS(*s)
    bpy.ops.object.transform_apply(scale=True)
    if bev:
        b = o.modifiers.new('b', 'BEVEL'); b.width = bev; b.segments = segs
    return _place(o, m, rots)

def cyl(p1, p2, r1, r2, m, v=16, bev=0.0, sx=1.0):
    a, b = G(*p1), G(*p2); d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r1, radius2=r2, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object
    if sx != 1.0:
        o.scale = (1, sx, 1); bpy.ops.object.transform_apply(scale=True)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    if bev:
        bm = o.modifiers.new('b', 'BEVEL'); bm.width = bev; bm.segments = 2; bm.limit_method = 'ANGLE'
    o.data.materials.append(MATS[m])
    return o

def tor(c, R, r, m, rots=None, s=(1, 1, 1), seg=24, mseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=mseg, location=G(*c))
    o = bpy.context.object; o.scale = GS(*s)
    # torus default axis = Blender Z = Godot Y (horizontal ring)
    return _place(o, m, rots)

def pydata(name, verts_g, faces, m, uvfun=None, solid=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([G(*v) for v in verts_g], [], faces); me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vg = verts_g[me.loops[li].vertex_index]
            uv.data[li].uv = uvfun(vg) if uvfun else (vg[0] + vg[2], vg[1])
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    me.materials.append(MATS[m])
    if solid:
        so = o.modifiers.new('so', 'SOLIDIFY'); so.thickness = solid; so.offset = -1
    return o

def ribbon(name, pts, width, m, thick=0.008, side=(1, 0, 0)):
    pts = [Vector(p) for p in pts]; sd = Vector(side)
    vs, fs, L = [], [], 0.0
    lens = [0.0]
    for i in range(1, len(pts)): lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        sv = (sd - t * sd.dot(t)).normalized() * width / 2
        vs += [tuple(p - sv), tuple(p + sv)]
    for i in range(len(pts) - 1):
        fs.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    o = pydata(name, vs, fs, m, solid=thick)
    uv = o.data.uv_layers[0]
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            vi = o.data.loops[li].vertex_index
            uv.data[li].uv = (vi % 2, lens[vi // 2] * 4)
    return o

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.object; o.name = name; o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    return o

def lock(pts, r0, r1, m, v=10, sx=1.0):
    """Tapered curved strand/finger: chain of cones + joint spheres along pts."""
    out = []; n = len(pts)
    rr = [r0 + (r1 - r0) * i / (n - 1) for i in range(n)]
    for i in range(n - 1):
        out.append(cyl(pts[i], pts[i + 1], rr[i], rr[i + 1], m, v, sx=sx))
        if 0 < i:
            out.append(sph(pts[i], (rr[i], rr[i], rr[i]), m, v, max(4, v // 2)))
    return out

def empty(name, g, parent=None):
    e = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(e)
    e.empty_display_size = 0.05
    w = G(*g)
    if parent:
        e.parent = parent; e.location = w - parent.matrix_world.translation
    else:
        e.location = w
    bpy.context.view_layer.update()
    return e

def attach(o, piv):
    pw = piv.matrix_world.translation.copy()
    o.data.transform(__import__('mathutils').Matrix.Translation(-pw))
    o.location = (0, 0, 0); o.parent = piv

# ---------------------------------------------------------------- materials
mat('M_Skin', (0.80, 0.50, 0.38), 'skin', rough=0.55, var=0.08)
mat('M_Cheek', (0.86, 0.45, 0.36), 'skin', rough=0.5, var=0.08)
mat('M_Beard', (0.56, 0.20, 0.06), 'hair', rough=0.7, var=0.22)
mat('M_BeardShade', (0.30, 0.10, 0.04), 'hair', rough=0.8, var=0.2)
mat('M_Hair', (0.40, 0.13, 0.05), 'hair', rough=0.72, var=0.22)
mat('M_Lip', (0.62, 0.30, 0.24), 'skin', rough=0.4, var=0.06)
mat('M_Brass', (0.78, 0.60, 0.26), 'copper', rough=0.3, metal=1.0, var=0.08)
mat('M_Lens', (0.20, 0.32, 0.30), rough=0.05, metal=0.3, var=0.05)
mat('M_Brow', (0.30, 0.10, 0.04), 'hair', rough=0.8, var=0.2)
mat('M_Teal', (0.09, 0.30, 0.28), 'fabric', rough=0.85)
mat('M_TealDark', (0.06, 0.21, 0.20), 'fabric', rough=0.85)
mat('M_Wool', (0.17, 0.12, 0.08), 'fabric', rough=0.9)
mat('M_Leather', (0.33, 0.17, 0.08), 'leather', rough=0.6)
mat('M_LeatherDark', (0.16, 0.08, 0.04), 'leather', rough=0.55)
mat('M_Apron', None, rough=0.6, img=apron_tex())
mat('M_Copper', (0.85, 0.42, 0.22), 'copper', rough=0.32, metal=1.0, var=0.1)
mat('M_Iron', (0.10, 0.11, 0.14), 'metal', rough=0.45, metal=0.9, var=0.2)
mat('M_Sole', (0.07, 0.05, 0.04), 'leather', rough=0.8)
mat('M_EyeWhite', (0.93, 0.89, 0.84), rough=0.15, var=0.03)
mat('M_Iris', (0.26, 0.38, 0.48), rough=0.1, var=0.25)
mat('M_Pupil', (0.01, 0.01, 0.01), rough=0.05, var=0.0)
mat('M_Glint', (1, 1, 1), rough=0.0, emit=(1, 0.96, 0.9), var=0.0)
mat('M_Mouth', (0.25, 0.06, 0.05), rough=0.4, var=0.1)
mat('M_Teeth', (0.93, 0.88, 0.78), rough=0.3, var=0.04)
mat('M_Linen', (0.82, 0.76, 0.62), 'fabric', rough=0.9)
mat('M_Hearth', (1.0, 0.55, 0.15), rough=0.3, emit=(1.0, 0.45, 0.1), var=0.1)
# hammer
mat('M_Ash', (0.62, 0.47, 0.30), 'wood', rough=0.6, var=0.12)
mat('M_Steel', (0.13, 0.14, 0.17), 'metal', rough=0.38, metal=1.0, var=0.18)
mat('M_SteelBright', (0.55, 0.56, 0.58), 'metal', rough=0.22, metal=1.0, var=0.08)
mat('M_Wrap', (0.28, 0.14, 0.07), 'leather', rough=0.55)

# ================================================================= BRANN
col_b = bpy.data.collections.new('Brann'); bpy.context.scene.collection.children.link(col_b)
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children['Brann']

root = empty('Brann', (0, 0, 0))
P = []  # body parts
for s in (-1, 1):
    x = s * 0.15
    P.append(sph((x, 0.085, 0.04), (0.10, 0.085, 0.155), 'M_Leather', sub=1))
    P.append(box((x, 0.022, 0.035), (0.105, 0.022, 0.165), 'M_Sole', bev=0.015, segs=3))
    P.append(sph((x, 0.075, 0.135), (0.08, 0.06, 0.07), 'M_Copper'))  # copper toe cap
    for k in range(5):  # toe cap rivets
        a = -1.0 + k * 0.5
        P.append(sph((x + 0.078 * math.sin(a), 0.07, 0.135 + 0.068 * math.cos(a)), (0.009, 0.009, 0.009), 'M_Iron', 8, 6))
    P.append(cyl((x, 0.13, 0.0), (x, 0.26, 0.0), 0.095, 0.088, 'M_Leather', 20, bev=0.01))
    P.append(tor((x, 0.255, 0.0), 0.093, 0.022, 'M_LeatherDark'))  # folded cuff
    P.append(tor((x, 0.16, 0.01), 0.098, 0.009, 'M_Iron', s=(1, 1, 1.05)))  # ankle strap
    P.append(box((x + s * 0.0, 0.16, 0.112), (0.022, 0.018, 0.008), 'M_Copper', bev=0.003))  # buckle
    P.append(cyl((x, 0.26, 0.0), (x * 0.95, 0.66, 0.0), 0.085, 0.12, 'M_Wool', 18))
P.append(sph((0, 0.72, 0.0), (0.27, 0.17, 0.21), 'M_Wool', sub=1))
P.append(sph((0, 1.04, -0.01), (0.33, 0.40, 0.255), 'M_Teal', sub=1))
P.append(sph((0, 0.90, 0.05), (0.29, 0.26, 0.25), 'M_Teal', sub=1))
P.append(sph((0, 1.27, -0.015), (0.40, 0.17, 0.235), 'M_Teal', sub=1))
P.append(cyl((0, 1.34, -0.01), (0, 1.52, 0.0), 0.10, 0.085, 'M_Skin', 16))
P.append(tor((0, 1.37, 0.0), 0.11, 0.02, 'M_TealDark'))  # collar
# belt
P.append(tor((0, 0.79, 0.03), 0.30, 0.035, 'M_LeatherDark', s=(1, 1.2, 0.92), seg=36))
P.append(box((0, 0.79, 0.315), (0.055, 0.045, 0.012), 'M_Copper', bev=0.008))
P.append(box((0, 0.79, 0.326), (0.035, 0.028, 0.006), 'M_LeatherDark', bev=0.003))
for k in range(-6, 7):
    if abs(k) < 2: continue
    a = k * 0.2
    P.append(sph((0.30 * math.sin(a) * 1.0, 0.79, 0.03 + 0.285 * math.cos(a)), (0.008, 0.008, 0.008), 'M_Copper', 8, 6))
# hip ring + rag (left hip)
P.append(tor((0.27, 0.73, 0.14), 0.03, 0.006, 'M_Iron', rots=[('z', math.pi / 2), ('y', -0.5)]))
P.append(ribbon('Rag', [(0.27, 0.72, 0.16), (0.285, 0.60, 0.17), (0.29, 0.48, 0.16)], 0.10, 'M_Linen', 0.006, side=(0.5, 0, 0.87)))

# apron
hw = [(0.40, 0.27), (0.75, 0.27), (0.85, 0.22), (0.95, 0.17), (1.32, 0.15)]
zf = [(0.40, 0.29), (0.6, 0.30), (0.78, 0.33), (0.9, 0.335), (1.05, 0.30), (1.2, 0.265), (1.32, 0.225)]
def iw(y): return float(np.interp(y, *zip(*hw)))
def iz(y): return float(np.interp(y, *zip(*zf)))
rows = np.linspace(0.40, 1.32, 24); cols = 12
av, af = [], []
for j, y in enumerate(rows):
    for i in range(cols + 1):
        x = (i / cols * 2 - 1) * iw(y)
        rx = 0.62 if y < 0.8 else 0.40
        z = iz(y) * math.sqrt(max(0.05, 1 - (x / rx) ** 2)) + (0.012 * math.sin(i * 1.3 + j) if y < 0.75 else 0)
        av.append((x, y, z))
for j in range(len(rows) - 1):
    for i in range(cols):
        a = j * (cols + 1) + i
        af.append((a, a + 1, a + cols + 2, a + cols + 1))
apron = pydata('Apron', av, af, 'M_Apron', uvfun=lambda v: ((v[0] + 0.3) / 0.6, (v[1] - 0.38) / 0.96), solid=0.01)
P.append(apron)
# pocket + rivets
pk = [(x, y, iz(y) * math.sqrt(1 - (x / 0.62) ** 2) + 0.012) for y in (0.52, 0.68) for x in (-0.13, 0.0, 0.13)]
pocket = pydata('Pocket', pk, [(0, 1, 4, 3), (1, 2, 5, 4)], 'M_Leather', solid=0.006)
P.append(pocket)
for (x, y) in [(-0.125, 0.675), (0.125, 0.675), (0.0, 0.675), (-0.125, 0.53), (0.125, 0.53)]:
    P.append(sph((x, y, iz(y) * math.sqrt(1 - (x / 0.62) ** 2) + 0.02), (0.009, 0.009, 0.006), 'M_Copper', 8, 6))
# straps (with mended section on right)
for s in (-1, 1):
    pts = [(s * 0.13, 1.30, 0.235), (s * 0.165, 1.385, 0.17), (s * 0.19, 1.425, 0.03),
           (s * 0.185, 1.39, -0.12), (s * 0.16, 1.25, -0.24), (s * 0.13, 1.0, -0.27), (s * 0.06, 0.82, -0.25)]
    P.append(ribbon('Strap', pts, 0.055, 'M_Leather', 0.01))
    P.append(tor((s * 0.13, 1.315, 0.245), 0.025, 0.006, 'M_Iron', rots=[('x', math.pi / 2 - 0.5)]))  # D-ring
    for dy in (0.0, 0.03):
        P.append(sph((s * 0.13 + 0.015 * (1 if dy else -1), 1.28 - dy, 0.245), (0.009, 0.009, 0.006), 'M_Copper', 8, 6))
# mend: wrapped patch with stitch rivets on smith's right strap back
P.append(box((-0.185, 1.33, -0.17), (0.04, 0.045, 0.02), 'M_LeatherDark', bev=0.006, rots=[('x', 0.7)]))
for k in range(3):
    P.append(sph((-0.16 - k * 0.025, 1.34, -0.19 + 0.0), (0.007, 0.007, 0.007), 'M_Copper', 8, 6))
body = join(P, 'Body')
attach(body, root)

# ---------------------------------------------------------------- arms
def arm(side, piv_g, hand_g, name):
    s = side; X = piv_g[0]
    A = []
    # tailored shoulder: flattened deltoid cap that slopes into the torso, plus sleeve seam
    A.append(sph((X - s * 0.045, 1.20, -0.01), (0.125, 0.105, 0.125), 'M_Teal', 24, 14, rots=[('z', s * 0.35)], sub=1))
    A.append(tor((X - s * 0.02, 1.155, -0.008), 0.105, 0.007, 'M_TealDark', rots=[('z', s * 0.55)], seg=28, mseg=6))
    elbow = (X + s * 0.02, 0.93, 0.02)
    A.append(cyl((X, 1.17, -0.005), elbow, 0.088, 0.066, 'M_Teal', 18, sx=0.9))
    # compressed rolled sleeve: three stacked folds of decreasing size, slightly tilted
    for k, (dy, r, rm, mt) in enumerate(((0.03, 0.068, 0.020, 'M_TealDark'), (0.008, 0.070, 0.022, 'M_Teal'), (-0.012, 0.064, 0.018, 'M_TealDark'))):
        A.append(tor((elbow[0], elbow[1] + dy, elbow[2]), r, rm, mt, rots=[('x', 0.2 + 0.05 * k), ('z', s * 0.08 * (k - 1))], s=(1, 1, 0.92), seg=28, mseg=8))
    wrist = (hand_g[0] + s * 0.0, hand_g[1] + 0.05, hand_g[2] - 0.035)
    # shaped forearm: thick muscle belly near elbow tapering to a slim wrist
    mid = ((elbow[0] * 0.6 + wrist[0] * 0.4), (elbow[1] * 0.6 + wrist[1] * 0.4), (elbow[2] * 0.6 + wrist[2] * 0.4))
    A.append(cyl((elbow[0], elbow[1] - 0.01, elbow[2]), mid, 0.064, 0.072, 'M_Skin', 18, sx=0.85))
    A.append(sph(mid, (0.072, 0.012, 0.062), 'M_Skin', 18, 8))
    A.append(cyl(mid, wrist, 0.072, 0.044, 'M_Skin', 18, sx=0.8))
    A.append(sph(((elbow[0] + mid[0]) / 2 + s * 0.035, (elbow[1] + mid[1]) / 2, (elbow[2] + mid[2]) / 2),
                 (0.03, 0.08, 0.04), 'M_Skin', rots=[('x', 0.5)], sub=1))  # brachioradialis bulge
    A.append(cyl((wrist[0], wrist[1] + 0.035, wrist[2] - 0.02), (wrist[0], wrist[1] - 0.005, wrist[2] + 0.005), 0.058, 0.056, 'M_Copper', 20, bev=0.004))
    for k in range(8):
        a = k / 8 * 2 * math.pi
        A.append(sph((wrist[0] + 0.058 * math.cos(a), wrist[1] + 0.015, wrist[2] - 0.008 + 0.058 * math.sin(a)), (0.006, 0.006, 0.006), 'M_Iron', 6, 4))
    hx, hy, hz = hand_g
    # gripping fist: curled finger rolls around a vertical channel (haft r~0.017) at hand centre
    # back of hand / palm block wrapping the outer side of the haft channel
    A.append(sph((hx + s * 0.032, hy + 0.0, hz - 0.006), (0.024, 0.05, 0.04), 'M_Skin', 16, 10, sub=1))
    def P_(th, R, y):  # point on a circle around the vertical haft axis (th=0 outer/back of hand)
        return (hx + s * R * math.cos(th), y, hz + R * math.sin(th))
    # four individual curled fingers (3 phalanges each) wrapping the haft, little finger smallest
    for k, (fy, fr, ln) in enumerate(((0.028, 0.0115, 1.0), (0.008, 0.012, 1.0), (-0.012, 0.0112, 0.95), (-0.03, 0.0098, 0.85))):
        y = hy + fy
        th = [0.35, 1.25, 2.15, 2.75 * ln]
        Rs = [0.036, 0.034, 0.031, 0.028]
        pts = [P_(t, r, y + (0.002 * i if k == 3 else 0)) for i, (t, r) in enumerate(zip(th, Rs))]
        A += lock(pts, fr, fr * 0.8, 'M_Skin', 10)
        A.append(sph(P_(1.25, 0.036, y), (fr * 1.15, fr * 0.95, fr * 1.15), 'M_Skin', 10, 6))  # knuckle
        A.append(sph(P_(th[-1], Rs[-1] + 0.004, y), (0.004, 0.006, 0.004), 'M_Lip', 6, 4))  # nail hint
    # opposed thumb: from palm heel, over the index finger on the front side
    A += lock([P_(-0.4, 0.036, hy + 0.012), P_(0.4, 0.04, hy + 0.04), P_(1.2, 0.036, hy + 0.047), P_(1.85, 0.03, hy + 0.045)],
              0.0135, 0.0105, 'M_Skin', 10)
    o = join(A, name)
    return o

strike = empty('StrikePivot', (-0.43, 1.12, 0), root)
rest = empty('RestPivot', (0.43, 1.12, 0), root)
rarm = arm(-1, (-0.43, 1.12, 0), (-0.43, 0.67, 0.18), 'RightArm'); attach(rarm, strike)
larm = arm(1, (0.43, 1.12, 0), (0.44, 0.68, 0.10), 'LeftArm'); attach(larm, rest)

# ---------------------------------------------------------------- head
head = empty('HeadPivot', (0, 1.48, 0), root)
H = []
H.append(sph((0, 1.625, 0.0), (0.135, 0.15, 0.14), 'M_Skin', 28, 18, sub=1))
H.append(sph((0, 1.585, 0.045), (0.12, 0.09, 0.10), 'M_Skin', sub=1))  # jaw
for s in (-1, 1):
    # full, smile-lifted apple cheeks with a soft flush (skin-toned, not a separate pink blob)
    H.append(sph((s * 0.068, 1.598, 0.108), (0.034, 0.026, 0.028), 'M_Cheek', 18, 10, rots=[('z', s * 0.35)], sub=1))
    H.append(sph((s * 0.095, 1.625, 0.075), (0.03, 0.035, 0.035), 'M_Skin', sub=1))  # cheekbone plane
    # ear: outer rim + bowl + lobe
    H.append(sph((s * 0.138, 1.62, -0.005), (0.016, 0.044, 0.03), 'M_Skin', 14, 10, rots=[('y', -s * 0.35)], sub=1))
    H.append(tor((s * 0.147, 1.622, -0.005), 0.024, 0.006, 'M_Skin', rots=[('z', math.pi / 2), ('y', -s * 0.35)], s=(1, 1.6, 1), seg=16, mseg=6))
    # craggy brow ledge overhanging the socket (sits ABOVE the eye: eye top ~1.666)
    H.append(sph((s * 0.052, 1.683, 0.118), (0.042, 0.014, 0.026), 'M_Skin', 18, 8, rots=[('z', -s * 0.18)], sub=1))
    # bushy eyebrow as 3 tapered tufts sweeping outward and slightly up
    A_ = [(s * 0.018, 1.688, 0.137), (s * 0.05, 1.697, 0.138), (s * 0.08, 1.696, 0.126), (s * 0.103, 1.688, 0.105)]
    H += lock(A_, 0.011, 0.006, 'M_Brow', 8)
    # fixed upper eyelid fold / crease and puffy lower lid (do not cover the iris)
    H.append(tor((s * 0.05, 1.651, 0.112), 0.0245, 0.0045, 'M_Skin', rots=[('x', math.pi / 2 - 0.35)], s=(1.05, 1, 1), seg=20, mseg=6))
    H.append(sph((s * 0.05, 1.626, 0.122), (0.021, 0.0055, 0.011), 'M_Skin', 14, 8, sub=1))  # lower lid
    H.append(sph((s * 0.083, 1.632, 0.11), (0.006, 0.003, 0.006), 'M_Skin', 6, 4))  # crow's foot
    H.append(sph((s * 0.024, 1.599, 0.162), (0.013, 0.012, 0.013), 'M_Cheek', 14, 8, sub=1))  # nostril wing
    # forehead furrow
    H.append(cyl((s * 0.005, 1.718, 0.128), (s * 0.06, 1.722, 0.118), 0.0035, 0.002, 'M_Skin', 6))
H.append(tor((0.145, 1.588, -0.0), 0.009, 0.0025, 'M_Copper', rots=[('z', math.pi / 2)]))  # earring
# soft, broad, slightly bulbous weathered nose: bridge -> ball tip -> septum
H.append(sph((0, 1.648, 0.142), (0.017, 0.03, 0.02), 'M_Skin', 14, 10, rots=[('x', -0.35)], sub=1))
H.append(sph((0, 1.608, 0.163), (0.03, 0.027, 0.027), 'M_Cheek', 20, 12, sub=1))
H.append(sph((0, 1.592, 0.162), (0.012, 0.01, 0.012), 'M_Skin', 10, 6))
# smile: curved dark mouth, upper teeth, full lower lip, corners lifted
smile = [(-0.034, 1.562, 0.128), (-0.02, 1.552, 0.138), (0, 1.549, 0.141), (0.02, 1.552, 0.138), (0.034, 1.562, 0.128)]
H += lock(smile, 0.008, 0.008, 'M_Mouth', 8)
H.append(sph((0, 1.556, 0.140), (0.022, 0.005, 0.006), 'M_Teeth', 12, 6))
H += lock([(-0.03, 1.548, 0.128), (-0.012, 1.539, 0.139), (0.012, 1.539, 0.139), (0.03, 1.548, 0.128)], 0.0065, 0.0065, 'M_Lip', 8)
for s in (-1, 1):
    H.append(sph((s * 0.04, 1.567, 0.125), (0.007, 0.007, 0.007), 'M_Cheek', 8, 6))  # smile corner bulge
# hair: close-cropped crown mass + low swept locks (no tall tuft)
H.append(sph((0, 1.675, -0.03), (0.15, 0.115, 0.14), 'M_Hair', 24, 14, sub=1))
for k in range(9):
    a = -1.7 + k * 0.425
    base = (0.12 * math.sin(a), 1.735, 0.10 * math.cos(a) - 0.04)
    tip = (0.15 * math.sin(a) * 1.05, 1.60 - 0.02 * (k % 3), 0.115 * math.cos(a) - 0.075)
    H += lock([base, ((base[0] + tip[0]) / 2 * 1.1, 1.69, (base[2] + tip[2]) / 2), tip], 0.032, 0.008,
              'M_Hair' if k % 2 else 'M_BeardShade', 10)
for s in (-1, 1):
    H += lock([(s * 0.122, 1.67, 0.04), (s * 0.13, 1.625, 0.055), (s * 0.122, 1.585, 0.07)], 0.022, 0.016, 'M_Hair', 10)  # sideburn
H.append(sph((0, 1.775, -0.03), (0.09, 0.03, 0.08), 'M_Hair', sub=1))  # low swept crown, ~6cm lower than old crest
# sturdy leather brow band + brass smithing goggles parked on the forehead
H.append(tor((0, 1.735, -0.02), 0.142, 0.012, 'M_LeatherDark', rots=[('x', -0.12)], s=(1.0, 1, 1.03), seg=40, mseg=6))
for s in (-1, 1):
    gc = (s * 0.044, 1.752, 0.125)
    rot = [('x', math.pi / 2 - 0.55), ('y', s * 0.28)]
    H.append(cyl((gc[0] - s * 0.003, gc[1] - 0.006, gc[2] - 0.016), gc, 0.025, 0.027, 'M_Brass', 18, bev=0.002))  # cup
    H.append(tor(gc, 0.026, 0.0045, 'M_Brass', rots=rot, seg=22, mseg=6))  # rim
    H.append(sph(gc, (0.022, 0.006, 0.022), 'M_Lens', 16, 8, rots=rot))  # domed lens
    H.append(sph((gc[0] - s * 0.007, gc[1] + 0.008, gc[2] + 0.004), (0.004, 0.001, 0.004), 'M_Glint', 6, 4, rots=rot))
    H.append(cyl((s * 0.072, 1.755, 0.10), (s * 0.135, 1.74, 0.0), 0.006, 0.006, 'M_Leather', 6, sx=2.2))  # strap to band
H.append(cyl((-0.02, 1.758, 0.133), (0.02, 1.758, 0.133), 0.005, 0.005, 'M_Brass', 8))  # nose bridge
headm = join(H, 'HeadMesh'); attach(headm, head)

for nm, s in (('EyeL', 1), ('EyeR', -1)):
    c = (s * 0.05, 1.645, 0.112)
    e = empty(nm, c, head)
    E = [sph(c, (0.021, 0.021, 0.021), 'M_EyeWhite', 16, 12),
         sph((c[0], c[1], c[2] + 0.0155), (0.0135, 0.0135, 0.006), 'M_Iris', 18, 8),
         sph((c[0], c[1], c[2] + 0.0195), (0.006, 0.006, 0.0028), 'M_Pupil', 12, 6),
         sph((c[0] + 0.0045, c[1] + 0.0055, c[2] + 0.0215), (0.0026, 0.0026, 0.0012), 'M_Glint', 8, 4)]
    em = join(E, nm + '_Mesh'); attach(em, e)
    lid = empty('Lid' + nm[-1], c, head)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.0235, location=G(*c))
    lo = bpy.context.object
    import bmesh
    bm = bmesh.new(); bm.from_mesh(lo.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.013], context='VERTS')
    bm.to_mesh(lo.data); bm.free()
    lo.data.materials.append(MATS['M_Skin'])
    so = lo.modifiers.new('so', 'SOLIDIFY'); so.thickness = 0.003
    lo = join([lo], 'Lid' + nm[-1] + '_Mesh'); attach(lo, lid)

beard = empty('BeardPivot', (0, 1.53, 0.10), head)
B = []
# core volume kept BEHIND the locks (dark shade material = recognizable shadow plane)
B.append(sph((0, 1.50, 0.045), (0.125, 0.11, 0.075), 'M_BeardShade', 20, 12, sub=1))
# layered, irregular face-framing locks: 3 rings (outer/long, mid, front/short) of tapered curved strands
rr = np.random.default_rng(11)
for layer, (n, a0, a1, top, drop, R, rad) in enumerate(((12, -1.75, 1.75, 1.60, 0.22, 0.125, 0.040),
                                                       (9, -1.3, 1.3, 1.565, 0.17, 0.125, 0.036),
                                                       (6, -0.75, 0.75, 1.535, 0.11, 0.135, 0.032))):
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1) + rr.uniform(-0.06, 0.06)
        d = drop * (1.0 - 0.35 * abs(a) / 1.8) * rr.uniform(0.85, 1.15)
        x0, z0 = R * math.sin(a), R * math.cos(a) * 0.95 - 0.02
        curl = rr.uniform(-0.02, 0.02)
        pts = [(x0 * 0.95, top, z0), (x0 * 1.06, top - d * 0.35, z0 + 0.03),
               (x0 * 1.0 + curl, top - d * 0.7, z0 + 0.045), (x0 * 0.8 - curl, top - d, z0 + 0.03)]
        B += lock(pts, rad * rr.uniform(0.9, 1.15), 0.009, ('M_Beard', 'M_Beard', 'M_Hair')[i % 3] if layer < 2 else 'M_Beard', 10)
for s in (-1, 1):
    # moustache: three tapered locks per side sweeping out & curling up past the smile
    for k, (dy, dz, ln) in enumerate(((0.0, 0.0, 1.0), (-0.008, -0.004, 0.85), (0.006, -0.008, 0.7))):
        pts = [(s * 0.012, 1.578 + dy, 0.163 + dz), (s * 0.045, 1.566 + dy, 0.158 + dz),
               (s * 0.08 * ln + s * 0.01, 1.552 + dy, 0.138 + dz), (s * (0.105 * ln + 0.02), 1.565 + dy, 0.112 + dz),
               (s * (0.118 * ln + 0.025), 1.588 + dy, 0.095 + dz)]
        B += lock(pts, 0.021 - k * 0.004, 0.004, 'M_Beard' if k != 1 else 'M_Hair', 10)
    # forked braid
    n = 7
    for k in range(n):
        t = k / (n - 1)
        x = s * (0.045 + 0.035 * t) + (0.008 if k % 2 else -0.008) * s
        y = 1.43 - 0.25 * t; z = 0.15 + 0.13 * t; r = 0.033 - 0.012 * t
        B.append(sph((x, y, z), (r, r * 1.25, r * 0.9), 'M_Beard', 12, 8, rots=[('z', 0.5 if k % 2 else -0.5)]))
    cx = s * 0.08
    for (yy, zz, rr) in ((1.33, 0.235, 0.025), (1.205, 0.272, 0.02)):
        B.append(cyl((cx, yy + 0.025, zz - 0.012), (cx, yy - 0.012, zz + 0.006), rr, rr * 0.96, 'M_Copper', 20, bev=0.003))
        B.append(tor((cx, yy + 0.02, zz - 0.01), rr, 0.0035, 'M_Copper', rots=[('x', 0.4)]))
        B.append(tor((cx, yy - 0.008, zz + 0.004), rr, 0.0035, 'M_Copper', rots=[('x', 0.4)]))
    B.append(cyl((cx, 1.19, 0.28), (cx + s * 0.01, 1.13, 0.30), 0.02, 0.004, 'M_Beard', 10))
beardm = join(B, 'BeardMesh'); attach(beardm, beard)

pres = empty('PresenceAnchor', (0, 2.02, 0), root)
pm = join([sph((0, 2.02, 0), (0.035, 0.05, 0.035), 'M_Hearth', 8, 6),
           tor((0, 2.02, 0), 0.05, 0.005, 'M_Copper')], 'PresenceIndicator')
attach(pm, pres)

# ================================================================= HAMMER
col_h = bpy.data.collections.new('Hammer'); bpy.context.scene.collection.children.link(col_h)
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children['Hammer']
hroot = empty('Hammer', (0, 0, 0))
Q = []
Q.append(cyl((0, 0.012, 0), (0, 0.50, 0), 0.0175, 0.0145, 'M_Ash', 16, sx=0.8))
Q.append(cyl((0, 0.0, 0), (0, 0.024, 0), 0.0195, 0.019, 'M_Copper', 16, bev=0.003))
Q.append(sph((0, 0.0, 0), (0.012, 0.004, 0.012), 'M_Copper', 10, 6))
Q.append(cyl((0, 0.026, 0), (0, 0.235, 0), 0.0192, 0.0182, 'M_Wrap', 16, sx=0.82))
for k in range(12):
    Q.append(tor((0, 0.04 + k * 0.0165, 0), 0.0187, 0.0028, 'M_Wrap', s=(1, 1, 0.82), rots=[('x', 0.18)], seg=16, mseg=6))
Q.append(tor((0, 0.238, 0), 0.0183, 0.0035, 'M_Copper', s=(1, 1, 0.82), seg=16, mseg=6))
HY = 0.48
Q.append(box((-0.075, HY, 0), (0.09, 0.026, 0.0235), 'M_Steel', bev=0.006))
Q.append(box((0, HY, 0), (0.03, 0.031, 0.028), 'M_Steel', bev=0.008))  # eye boss
Q.append(cyl((-0.205, HY, 0), (-0.165, HY, 0), 0.034, 0.028, 'M_Steel', 8, bev=0.004))
Q.append(cyl((-0.2285, HY, 0), (-0.205, HY, 0), 0.036, 0.036, 'M_SteelBright', 8, bev=0.005))
Q.append(tor((-0.165, HY, 0), 0.029, 0.004, 'M_Copper', rots=[('z', math.pi / 2)], s=(1, 1, 1)))
# cross peen wedge (edge horizontal along Z)
pv = [(0.025, HY - 0.026, -0.0235), (0.025, HY + 0.026, -0.0235), (0.025, HY + 0.026, 0.0235), (0.025, HY - 0.026, 0.0235),
      (0.125, HY - 0.004, -0.027), (0.125, HY + 0.004, -0.027), (0.125, HY + 0.004, 0.027), (0.125, HY - 0.004, 0.027)]
pe = pydata('Peen', pv, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'M_Steel')
bv = pe.modifiers.new('b', 'BEVEL'); bv.width = 0.003; bv.segments = 2
Q.append(pe)
Q.append(box((0, HY + 0.032, 0), (0.0145, 0.002, 0.011), 'M_Ash', bev=0.002))
Q.append(box((0, HY + 0.0345, 0), (0.016, 0.0025, 0.0025), 'M_Copper', bev=0.001))  # copper wedge
for s in (-1, 1):  # engraved copper inlay chevrons + border
    z = s * 0.0238
    for (a, b) in [((-0.155, 0.015), (-0.12, 0.0)), ((-0.12, 0.0), (-0.155, -0.015)),
                   ((-0.135, 0.015), (-0.10, 0.0)), ((-0.10, 0.0), (-0.135, -0.015)),
                   ((-0.16, 0.019), (-0.04, 0.019)), ((-0.16, -0.019), (-0.04, -0.019))]:
        Q.append(cyl((a[0], HY + a[1], z), (b[0], HY + b[1], z), 0.0012, 0.0012, 'M_Copper', 4))
    Q.append(sph((-0.07, HY, z), (0.006, 0.006, 0.0015), 'M_Copper', 10, 6))
hm = join(Q, 'HammerMesh'); attach(hm, hroot)

# ================================================================= export
def export(col, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_image_format='AUTO')

export(col_b, os.path.join(OUT, 'brann.glb'))
# hammer.glb intentionally NOT re-exported (hammer layout unchanged); the hammer is still built for the
# report/contact check and preview only.
if os.environ.get('BRANN_EXPORT_HAMMER'):
    export(col_h, os.path.join(OUT, 'hammer.glb'))

def glb_nodes(path):
    with open(path, 'rb') as f:
        d = f.read()
    ln = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + ln])
    return j
report = {}
for nm in ('brann', 'hammer'):
    j = glb_nodes(os.path.join(OUT, nm + '.glb'))
    report[nm] = {n['name']: {k: n.get(k) for k in ('translation', 'rotation', 'scale', 'children', 'mesh') if k in n} for n in j['nodes']}
    report[nm]['_meshes'] = [(m['name'], len(m['primitives'])) for m in j['meshes']]
# check hammer face extreme x
hv = [ (o.matrix_world @ v.co) for v in hm.data.vertices for o in [hm]]
report['hammer_min_x'] = min(v.x for v in hv)
report['hammer_face_center_godot'] = [-0.2285, 0.48, 0.0]
rv = [(rarm.matrix_world @ v.co) for v in rarm.data.vertices]
report['brann_height'] = max((o.matrix_world @ v.co).z for o in col_b.objects if o.type == 'MESH' and o.name != 'PresenceIndicator' for v in o.data.vertices)
with open(os.path.join(OUT, 'export_report.json'), 'w') as f:
    json.dump(report, f, indent=1)
print('EXPORT OK', report['hammer_min_x'], report['brann_height'])

# ================================================================= preview render
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        sc.render.engine = eng; break
    except Exception:
        pass
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy' if 'AgX - Punchy' in [l for l in ['AgX - Punchy']] else 'None'
hroot.location = G(0.62, 0, 0.25)
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.035, 0.03, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
def light(name, kind, loc, energy, color, size=1.0):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == 'AREA': ld.size = size
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.location = G(*loc)
    lo.rotation_mode = 'QUATERNION'
    lo.rotation_quaternion = (G(0, 1.0, 0) - lo.location).to_track_quat('-Z', 'Y')
light('Key', 'AREA', (-1.6, 2.4, 2.2), 420, (1.0, 0.72, 0.48), 1.5)
light('Fill', 'AREA', (2.2, 1.4, 1.6), 140, (0.55, 0.7, 1.0), 2.0)
light('Rim', 'AREA', (0.8, 2.2, -2.0), 380, (1.0, 0.55, 0.25), 1.0)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
fl = bpy.context.object; fl.data.materials.append(mat('M_Floor', (0.22, 0.18, 0.15), 'noise', rough=0.9, var=0.3))
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
shots = [((0, 1.05, 4.2), (0, 0.98, 0), 34), ((-2.4, 1.5, 3.0), (0.05, 1.0, 0), 34),
         ((0, 1.64, 0.85), (0, 1.62, 0.08), 50), ((-0.5, 1.68, 0.62), (0, 1.60, 0.08), 45)]
sc.render.resolution_x = 640; sc.render.resolution_y = 900
try: sc.eevee.taa_render_samples = 24
except Exception: pass
imgs = []
for i, (cp, tp, lens) in enumerate(shots):
    cam.location = G(*cp); cam.data.lens = lens
    cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = (G(*tp) - cam.location).to_track_quat('-Z', 'Y')
    p = os.path.join(OUT, f'_shot{i}.png'); sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(p); a = np.array(im.pixels[:], dtype=np.float32).reshape(900, 640, 4); imgs.append(a)
strip = np.concatenate(imgs, axis=1)
out = bpy.data.images.new('preview', strip.shape[1], strip.shape[0], alpha=True)
out.pixels.foreach_set(strip.ravel()); out.filepath_raw = os.path.join(OUT, 'preview.png'); out.file_format = 'PNG'; out.save()
for i in range(2):
    os.remove(os.path.join(OUT, f'_shot{i}.png'))
os.replace(os.path.join(OUT, '_shot2.png'), os.path.join(OUT, 'render_face_front.png'))
os.replace(os.path.join(OUT, '_shot3.png'), os.path.join(OUT, 'render_face_34.png'))
print('PREVIEW OK')
