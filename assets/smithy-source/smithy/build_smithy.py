# Brann's Forge VR smithy kit builder. Blender 4.5 headless:
#   blender --background --factory-startup --python build_smithy.py
# All placement below is authored in GODOT coordinates (x right, y up, +z toward viewer)
# and converted to Blender (x, -z, y). glTF export (+Y up) then restores Godot axes exactly.
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Matrix, Vector, Euler

OUT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(OUT, 'textures'); os.makedirs(TEX, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
RNG = np.random.default_rng(7); R = random.Random(11)

M = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # godot -> blender
def g2b(p): return Vector((p[0], -p[2], p[1]))
def grot(rx=0, ry=0, rz=0): return M @ Euler((rx, ry, rz), 'XYZ').to_matrix() @ M.transposed()

# ---------------------------------------------------------------- textures (tileable, numpy)
def vnoise(n, cu, cv):
    g = RNG.random((cv, cu))
    u = np.arange(n) * cu / n; v = np.arange(n) * cv / n
    iu = np.floor(u).astype(int); fu = u - iu; fu = fu * fu * (3 - 2 * fu)
    iv = np.floor(v).astype(int); fv = v - iv; fv = fv * fv * (3 - 2 * fv)
    iu1 = (iu + 1) % cu; iv1 = (iv + 1) % cv
    a = g[np.ix_(iv, iu)]; b = g[np.ix_(iv, iu1)]; c = g[np.ix_(iv1, iu)]; d = g[np.ix_(iv1, iu1)]
    fu = fu[None, :]; fv = fv[:, None]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
def fbm(n, cu, cv, octs=4):
    s = 0; a = 1; t = 0
    for o in range(octs):
        s = s + a * vnoise(n, cu * 2 ** o, cv * 2 ** o); t += a; a *= 0.5
    return s / t
def C(*c): return np.array(c, np.float32)
def mix(a, b, t): t = np.clip(t, 0, 1)[..., None]; return a * (1 - t) + b * t
def ss(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def save_img(name, rgb, data=False):
    n = rgb.shape[0]; img = bpy.data.images.new(name, n, n, alpha=False)
    px = np.ones((n, n, 4), np.float32); px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(TEX, name + '.png'); img.file_format = 'PNG'; img.save()
    if data: img.colorspace_settings.name = 'Non-Color'
    return img
def nrm(h, s):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * s; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * s
    n = np.dstack([-dx, -dy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5
N = 512; uu, vv = np.meshgrid(np.arange(N) / N, np.arange(N) / N)

def tex_oak(name, light, dark, seed_warp=1.0):
    warp = fbm(N, 2, 6) * 3.0 * seed_warp
    rings = np.abs(np.sin((vv * 9 + warp) * math.pi))
    pores = fbm(N, 8, 96, 3)
    t = 0.55 * ss(0.2, 0.95, rings) + 0.45 * pores
    wear = ss(0.55, 0.8, fbm(N, 3, 3))
    col = mix(C(*dark), C(*light), t); col = mix(col, col * 0.75 + 0.08, wear * 0.35)
    h = 0.6 * (1 - rings) * 0.5 + 0.5 * pores
    return save_img(name, col), save_img(name + '_n', nrm(h, 2.5), True)
oakA = tex_oak('T_Oak_Worn', (0.62, 0.40, 0.22), (0.33, 0.19, 0.09))
oakB = tex_oak('T_Oak_Carved', (0.45, 0.25, 0.12), (0.20, 0.10, 0.05), 1.4)

def tex_metal(name, base, var, spec=0.0, hammer=0.0, patina=None):
    f = fbm(N, 6, 6); fine = fbm(N, 48, 48, 2)
    h = f * 0.4 + fine * 0.3
    if hammer:
        dimp = 1 - np.abs(vnoise(N, 24, 24) * 2 - 1); h = h + dimp * hammer
    col = mix(C(*base) * 0.75, C(*base) * 1.15, f * 0.7 + fine * 0.3) + C(*var) * ((fine - 0.5) * 0.2)[..., None]
    if patina is not None: col = mix(col, C(*patina), ss(0.62, 0.8, fbm(N, 4, 4)) * 0.6)
    return save_img(name, col), save_img(name + '_n', nrm(h, 3.0), True)
iron = tex_metal('T_Iron_BlueBlack', (0.11, 0.12, 0.15), (0.1, 0.06, 0.02))
steel = tex_metal('T_Steel_Trim', (0.48, 0.50, 0.54), (0.1, 0.1, 0.12))
copper = tex_metal('T_Copper_Worked', (0.78, 0.40, 0.20), (0.2, 0.1, 0.0), hammer=0.6, patina=(0.30, 0.42, 0.33))
bronze = tex_metal('T_Bronze_Lamp', (0.55, 0.38, 0.17), (0.1, 0.1, 0.0), hammer=0.3, patina=(0.25, 0.33, 0.24))

# slate roof: 8 staggered courses x 8 slates per 2m tile, understated colour drift
rows = 8; row = np.floor(vv * rows).astype(int); fr = vv * rows - row
col_i = np.floor(uu * 8 + 0.5 * (row % 2)).astype(int) % 8
tint = RNG.random((rows, 8)); slate_c = mix(C(0.20, 0.22, 0.27), C(0.28, 0.27, 0.31), tint[row, col_i])
slate_c = mix(slate_c, C(0.24, 0.27, 0.25), (RNG.random((rows, 8))[row, col_i] > 0.8) * 0.6)
grain = fbm(N, 4, 32, 3); slate_c = slate_c * (0.85 + 0.3 * grain)[..., None]
fu = (uu * 8 + 0.5 * (row % 2)) % 1.0
gap = ss(0.0, 0.03, fu) * ss(1.0, 0.97, fu)
hgt = (1 - fr) * 0.6 * gap + grain * 0.2
slate_c = slate_c * (0.55 + 0.45 * gap * ss(0.0, 0.06, fr))[..., None]
slate = (save_img('T_Slate_Roof', slate_c), save_img('T_Slate_Roof_n', nrm(hgt, 4.0), True))
slate2 = (save_img('T_Slate_Roof_Dark', slate_c * C(0.8, 0.8, 0.85)), slate[1])

# blackened block stone (furnace) 4 courses / m
rows = 4; row = np.floor(vv * rows).astype(int); fr = vv * rows - row
bx = (uu * 2.5 + 0.5 * (row % 2)); bi = np.floor(bx).astype(int) % 3; fb = bx % 1.0
mort = ss(0.0, 0.05, fr) * ss(1.0, 0.95, fr) * ss(0.0, 0.03, fb) * ss(1.0, 0.97, fb)
sf = fbm(N, 8, 8)
stc = mix(C(0.10, 0.09, 0.09), C(0.30, 0.28, 0.27), RNG.random((rows, 3))[row, bi] * 0.6 + sf * 0.4)
stc = mix(C(0.05, 0.045, 0.04), stc, mort)
stone = (save_img('T_Stone_Blackened', stc), save_img('T_Stone_Blackened_n', nrm(mort * 0.7 + sf * 0.4, 3.0), True))

# flagstones: wrapped voronoi, 9 slabs per 2m tile
pts = RNG.random((9, 2)); d1 = np.full(uu.shape, 9.0); d2 = np.full(uu.shape, 9.0); idx = np.zeros(uu.shape, int)
for i, (px, py) in enumerate(pts):
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            d = np.hypot(uu - px - ox, vv - py - oy)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d)); idx = np.where(closer, i, idx); d1 = np.minimum(d1, d)
edge = ss(0.004, 0.02, d2 - d1); ff = fbm(N, 8, 8)
fc = mix(C(0.42, 0.40, 0.37), C(0.62, 0.57, 0.50), RNG.random(9)[idx] * 0.5 + ff * 0.5)
fc = mix(C(0.18, 0.16, 0.13), fc, edge)
flag = (save_img('T_Flagstone', fc), save_img('T_Flagstone_n', nrm(edge * 0.8 + ff * 0.3, 3.0), True))

def tex_fiber(name, a, b, cu, cv):
    f = fbm(N, cu, cv, 3); return save_img(name, mix(C(*a), C(*b), f)), save_img(name + '_n', nrm(f, 2.0), True)
straw = tex_fiber('T_Straw', (0.42, 0.30, 0.12), (0.86, 0.70, 0.36), 3, 64)
rope = tex_fiber('T_Rope', (0.35, 0.26, 0.15), (0.62, 0.50, 0.32), 32, 4)
ox = tex_fiber('T_Oxblood_Lining', (0.20, 0.03, 0.04), (0.42, 0.08, 0.08), 64, 64)
# faded canvas target, rings radial about centre
r = np.hypot(uu - 0.5, vv - 0.5) * 2; ring = (np.floor(r * 5) % 2)
tc = mix(C(0.80, 0.72, 0.58), C(0.55, 0.20, 0.15), ring * (r < 0.98)); tc = mix(tc, C(0.62, 0.52, 0.40), fbm(N, 6, 6) * 0.5)
tc = mix(tc, C(0.25, 0.18, 0.12), ss(0.93, 0.99, r))
canvas = (save_img('T_Canvas_Target', tc), None)
# fire: heat gradient along U (0 = root, white-gold; 1 = tip, deep red), braided streaks
fn = fbm(N, 2, 8, 3); heat = np.clip(1 - uu + (fn - 0.5) * 0.35, 0, 1)
fire_c = mix(mix(C(0.45, 0.04, 0.0), C(1.0, 0.45, 0.05), ss(0.1, 0.55, heat)), C(1.0, 0.92, 0.6), ss(0.6, 0.95, heat))
fire = save_img('T_Fire_Heat', fire_c)
cr = ss(0.45, 0.55, fbm(N, 10, 10)); coal_e = save_img('T_Coal_Emit', mix(C(0.02, 0.01, 0.0), C(1.0, 0.35, 0.05), cr * fbm(N, 4, 4)))

# ---------------------------------------------------------------- materials
def mat(name, base, rough=0.6, metal=0.0, nmap=None, nstr=1.0, emit=None, estr=0.0, ecol=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    if isinstance(base, bpy.types.Image):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = base; nt.links.new(t.outputs[0], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if nmap is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = nmap
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstr
        nt.links.new(t.outputs[0], nm.inputs['Color']); nt.links.new(nm.outputs[0], b.inputs['Normal'])
    if emit is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = emit
        nt.links.new(t.outputs[0], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = estr
    elif ecol is not None:
        b.inputs['Emission Color'].default_value = (*ecol, 1); b.inputs['Emission Strength'].default_value = estr
    return m
OAK = mat('M_Oak_Worn', *oakA[:1], 0.72, 0, oakA[1], 0.6)
OAKD = mat('M_Oak_Carved', *oakB[:1], 0.6, 0, oakB[1], 0.8)
IRON = mat('M_Iron_BlueBlack', iron[0], 0.55, 0.85, iron[1], 0.5)
STEEL = mat('M_Steel_Trim', steel[0], 0.32, 1.0, steel[1], 0.3)
COP = mat('M_Copper_Worked', copper[0], 0.35, 1.0, copper[1], 0.7)
BRZ = mat('M_Bronze_Lamp', bronze[0], 0.4, 1.0, bronze[1], 0.5)
OXB = mat('M_Oxblood_Lining', ox[0], 0.9, 0, ox[1], 0.4)
SLATE = mat('M_Slate_Roof', slate[0], 0.7, 0, slate[1], 1.0)
SLATED = mat('M_Slate_Roof_Band', slate2[0], 0.65, 0, slate2[1], 1.0)
STONE = mat('M_Stone_Blackened', stone[0], 0.85, 0, stone[1], 1.0)
SOOT = mat('M_Soot', (0.012, 0.010, 0.009), 0.95)
FLAG = mat('M_Flagstone', flag[0], 0.85, 0, flag[1], 1.0)
MORT = mat('M_Mortar', (0.06, 0.05, 0.04), 0.95)
STRAW = mat('M_Straw_Stitched', straw[0], 0.9, 0, straw[1], 0.8)
ROPE = mat('M_Rope', rope[0], 0.9, 0, rope[1], 0.8)
CANV = mat('M_Canvas_Target', canvas[0], 0.85)
FIRE = mat('M_Fire_Luminous', fire, 1.0, 0, None, 0, fire, 6.0)
COAL = mat('M_Coal_Embers', (0.02, 0.018, 0.016), 0.9, 0, None, 0, coal_e, 4.0)
GLOW = mat('M_Glass_Hearthlight', (1.0, 0.7, 0.35), 0.2, 0, None, 0, None, 5.0, (1.0, 0.62, 0.25))
SLATEF = mat('M_Slate_Field', (0.035, 0.04, 0.05), 0.55, 0, slate[1], 0.4)

# ---------------------------------------------------------------- geometry accumulator
class Asset:
    def __init__(s, name): s.name = name; s.groups = {}
    def emit(s, bm, m, group, tile, uvoff, Rm, t):
        bm.normal_update(); bm.verts.index_update()
        co = [v.co.copy() for v in bm.verts]
        ext = [max(c[i] for c in co) - min(c[i] for c in co) for i in range(3)]
        if uvoff is None: uvoff = (R.random(), R.random())
        G = s.groups.setdefault(group or s.name + '_Body', {'v': [], 'f': [], 'uv': [], 'mi': [], 'mats': []})
        if m not in G['mats']: G['mats'].append(m)
        mi = G['mats'].index(m); base = len(G['v'])
        for c in co: G['v'].append(Rm @ c + t)
        for f in bm.faces:
            n = f.normal; k = max(range(3), key=lambda i: abs(n[i])); ax = [i for i in range(3) if i != k]
            if ext[ax[0]] < ext[ax[1]]: ax = ax[::-1]
            G['f'].append([base + v.index for v in f.verts]); G['mi'].append(mi)
            for l in f.loops: G['uv'].append((l.vert.co[ax[0]] / tile + uvoff[0], l.vert.co[ax[1]] / tile + uvoff[1]))
        bm.free()
    def build(s):
        root = bpy.data.objects.new(s.name, None); bpy.context.scene.collection.objects.link(root)
        for gname, G in s.groups.items():
            me = bpy.data.meshes.new(gname); me.from_pydata([tuple(v) for v in G['v']], [], G['f'])
            uvl = me.uv_layers.new(name='UVMap')
            uvl.data.foreach_set('uv', [c for uv in G['uv'] for c in uv])
            for m in G['mats']: me.materials.append(m)
            me.polygons.foreach_set('material_index', G['mi'])
            me.validate(); me.update()
            me.shade_smooth()
            try: me.set_sharp_from_angle(angle=math.radians(40))
            except Exception: pass
            ob = bpy.data.objects.new(gname, me); bpy.context.scene.collection.objects.link(ob); ob.parent = root
        s.root = root; return root

def _bevel(bm, w, seg):
    if w <= 0: return
    bm.normal_update()
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0].normal.dot(e.link_faces[1].normal) < 0.5]
    if edges: bmesh.ops.bevel(bm, geom=edges, offset=w, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)

def box(A, size, pos, m, rot=(0, 0, 0), bev=0.012, seg=2, group=None, tile=1.0, uvoff=None):
    sx, sy, sz = size; bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    _bevel(bm, min(bev, min(size) * 0.4), seg)
    A.emit(bm, m, group, tile, uvoff, grot(*rot), g2b(pos))

AX = {'y': (0, 0, 0), 'x': (0, 0, -math.pi / 2), 'z': (math.pi / 2, 0, 0)}
def cyl(A, r, h, pos, m, axis='y', r2=None, segs=16, rot=(0, 0, 0), bev=0.0, seg=1, group=None, tile=1.0,
        uvoff=None, sx=1.0, sz=1.0, spin=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    cs, sn = math.cos(spin), math.sin(spin)
    for v in bm.verts:
        x, y = v.co.x * cs - v.co.y * sn, v.co.x * sn + v.co.y * cs
        v.co = Vector((x * sx, y * sz, v.co.z))
    _bevel(bm, bev, seg)
    A.emit(bm, m, group, tile, uvoff, grot(*rot) @ grot(*AX[axis]), g2b(pos))

def sph(A, r, pos, m, scale=(1, 1, 1), segs=8, rings=6, rot=(0, 0, 0), group=None, tile=1.0, uvoff=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
    A.emit(bm, m, group, tile, uvoff, grot(*rot), g2b(pos))

def rivet(A, pos, axis='z', r=0.011, m=None, group=None):
    s = {'x': (0.5, 1, 1), 'y': (1, 0.5, 1), 'z': (1, 1, 0.5)}[axis]
    sph(A, r, pos, m or IRON, s, 6, 4, group=group, tile=0.1)

def arc(A, c, rad, a0, a1, n, th, dep, m, plane='xy', fixed=0.0, group=None):
    for i in range(n):
        a = a0 + (a1 - a0) * (i + 0.5) / n; da = (a1 - a0) / n
        L = 2 * rad * abs(math.sin(da / 2)) + 0.02; p = (c[0] + rad * math.cos(a), c[1] + rad * math.sin(a))
        phi = a + math.pi / 2
        if plane == 'xy': box(A, (L, th, dep), (p[0], p[1], fixed), m, (0, 0, phi), 0.01, group=group)
        else: box(A, (dep, th, L), (fixed, p[1], p[0]), m, (-phi, 0, 0), 0.01, group=group)

ASSETS = []
# ================================================================ CRADLE
A = Asset('Cradle'); ASSETS.append(A)
for x in (-0.66, 0.66):
    for z in (-0.27, 0.27): cyl(A, 0.065, 0.10, (x, 0.05, z), OAKD, segs=12, r2=0.055, bev=0.01)
box(A, (1.44, 0.06, 0.64), (0, 0.11, -0.01), OAKD)                      # plinth
box(A, (1.40, 0.72, 0.62), (0, 0.48, -0.02), OAK, bev=0.02)              # carcass (front z .29)
box(A, (1.40, 0.08, 0.05), (0, 0.18, 0.305), OAKD)                       # bottom rail
box(A, (1.40, 0.04, 0.05), (0, 0.58, 0.305), OAKD)                       # mid rail
box(A, (1.40, 0.08, 0.05), (0, 0.80, 0.305), OAKD)                       # top apron
for x in (-0.66, 0, 0.66): box(A, (0.08, 0.40, 0.05), (x, 0.38, 0.305), OAKD)
for x in (-0.33, 0.33):                                                   # carved fielded panels
    box(A, (0.50, 0.34, 0.03), (x, 0.38, 0.30), OAK, bev=0.02)
    box(A, (0.38, 0.24, 0.03), (x, 0.38, 0.315), OAKD, bev=0.03, seg=3)
    box(A, (0.06, 0.06, 0.02), (x, 0.38, 0.335), COP, rot=(0, 0, math.pi / 4), bev=0.01)
    rivet(A, (x, 0.38, 0.345), r=0.012, m=COP)
for x in (-0.47, 0.47):                                                   # blind drawer-row panels w/ rosettes
    box(A, (0.30, 0.13, 0.03), (x, 0.68, 0.31), OAK, bev=0.015)
    cyl(A, 0.03, 0.015, (x, 0.68, 0.33), COP, axis='z', segs=12, bev=0.005)
# drawer (separate node for slide motion)
box(A, (0.52, 0.14, 0.05), (0, 0.68, 0.33), OAKD, bev=0.015, group='Cradle_Drawer')
box(A, (0.10, 0.05, 0.008), (0, 0.69, 0.358), IRON, bev=0.003, group='Cradle_Drawer')
cyl(A, 0.032, 0.012, (0, 0.665, 0.365), IRON, axis='z', r2=0.032, segs=12, group='Cradle_Drawer')
cyl(A, 0.022, 0.014, (0, 0.665, 0.366), OAKD, axis='z', segs=12, group='Cradle_Drawer')
for x in (-0.2, 0.2): rivet(A, (x, 0.68, 0.357), group='Cradle_Drawer')
# nameplate (face z = 0.38) with steel border
box(A, (0.56, 0.075, 0.02), (0, 0.80, 0.355), STEEL, bev=0.006)
box(A, (0.50, 0.055, 0.02), (0, 0.80, 0.370), COP, bev=0.008, group='Cradle_Nameplate')
for x in (-0.265, 0.265): rivet(A, (x, 0.80, 0.367), m=STEEL)
# top slab + steel nosing + oxblood bed + low saddles
box(A, (1.55, 0.05, 0.72), (0, 0.865, 0.0), OAKD, bev=0.015)
box(A, (1.40, 0.022, 0.014), (0, 0.862, 0.364), STEEL, bev=0.005)
for i in range(9): rivet(A, (-0.64 + i * 0.16, 0.862, 0.372), m=STEEL, r=0.008)
box(A, (1.26, 0.02, 0.46), (0, 0.90, 0.02), OXB, bev=0.008)
for x in (-0.45, 0.45):
    box(A, (0.10, 0.02, 0.44), (x, 0.90, 0.02), OAKD, bev=0.006)
    for sgn in (-1, 1):
        box(A, (0.09, 0.03, 0.16), (x, 0.918, 0.02 + sgn * 0.11), OAKD, rot=(sgn * 0.25, 0, 0), bev=0.008)
        box(A, (0.07, 0.006, 0.12), (x, 0.935, 0.02 + sgn * 0.10), OXB, rot=(sgn * 0.25, 0, 0), bev=0.002)
box(A, (1.36, 0.035, 0.06), (0, 0.907, -0.30), OAK, bev=0.01)           # back peg rail
for i in range(10): cyl(A, 0.011, 0.006, (-0.585 + i * 0.13, 0.9245, -0.30), SOOT, segs=8)
# chased copper ends
for sgn in (-1, 1):
    x = sgn * 0.7375
    box(A, (0.075, 0.80, 0.70), (x, 0.44, 0.0), COP, bev=0.012)
    for z in (-0.22, 0.0, 0.22): box(A, (0.012, 0.70, 0.03), (x + sgn * 0.037, 0.44, z), COP, bev=0.005)
    for y in (0.12, 0.78): box(A, (0.012, 0.04, 0.70), (x + sgn * 0.037, y, 0), IRON, bev=0.004)
    for z in (-0.3, -0.11, 0.11, 0.3):
        for y in (0.12, 0.78): rivet(A, (x + sgn * 0.045, y, z), 'x')
    box(A, (0.08, 0.80, 0.03), (x, 0.44, 0.34), STEEL, bev=0.006)
    for y in (0.15, 0.35, 0.55, 0.75): rivet(A, (x, y, 0.357), m=STEEL)
A.build()

# ================================================================ HALL BAY
A = Asset('HallBay'); ASSETS.append(A)
P = 2.85; TOP = 3.30
for x in (-P, P):
    for z in (-P, P):
        box(A, (0.44, 0.36, 0.44), (x, 0.18, z), STONE, bev=0.04)
        box(A, (0.36, 0.06, 0.36), (x, 0.39, z), STONE, bev=0.02)
        box(A, (0.26, TOP - 0.42, 0.26), (x, 0.42 + (TOP - 0.42) / 2, z), OAK, bev=0.025)
        for y in (0.55, 3.05):
            box(A, (0.29, 0.07, 0.29), (x, y, z), IRON, bev=0.006)
            for sx, sz in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                rivet(A, (x + sx * 0.147, y, z + sz * 0.147), 'z' if sz else 'x', 0.013)
        ix, iz = -math.copysign(1, x), -math.copysign(1, z)   # arched braces toward bay interior
        arc(A, (x + ix * 0.68, TOP - 0.55), 0.55, (0 if ix < 0 else math.pi / 2), (math.pi / 2 if ix < 0 else math.pi), 6, 0.11, 0.15, OAK, 'xy', z)
        arc(A, (z + iz * 0.68, TOP - 0.55), 0.55, (0 if iz < 0 else math.pi / 2), (math.pi / 2 if iz < 0 else math.pi), 6, 0.11, 0.15, OAK, 'zy', x)
for z in (-P, P):
    box(A, (6.0, 0.28, 0.24), (0, TOP + 0.14, z), OAK, bev=0.03)
    box(A, (6.0, 0.05, 0.27), (0, TOP + 0.30, z), OAKD, bev=0.01)
    for x in np.arange(-2.625, 2.7, 0.75): box(A, (0.05, 0.05, 0.02), (x, TOP + 0.14, z + math.copysign(0.13, z)), IRON, (0, 0, math.pi / 4), 0.005)
RIDGE = 5.45; run = 3.0; rise = RIDGE - (TOP + 0.30); th = math.atan2(rise, P); L = math.hypot(rise, P) + 0.18
for x in (-P, P):     # open trusses at x ends (no walls; copies pair into twin trusses)
    box(A, (0.24, 0.26, 6.0), (x, TOP + 0.13, 0), OAK, bev=0.03)
    box(A, (0.20, RIDGE - TOP - 0.2, 0.20), (x, (RIDGE + TOP + 0.1) / 2, 0), OAKD, bev=0.02)
    box(A, (0.18, 0.18, 2.6), (x, 4.65, 0), OAK, bev=0.02)
    for sg in (-1, 1):
        zc = sg * P / 2; yc = TOP + 0.30 + rise / 2 + 0.06
        box(A, (0.22, 0.24, L), (x, yc, zc), OAK, (sg * th, 0, 0), 0.025)
        arc(A, (sg * 0.68, 4.65 - 0.55), 0.5, (math.pi / 2 if sg > 0 else 0), (math.pi if sg > 0 else math.pi / 2), 5, 0.09, 0.12, OAKD, 'zy', x)
    for sg in (-1, 1): box(A, (0.26, 0.26, 0.04), (x, TOP + 0.13, sg * 1.2), IRON, bev=0.006)
box(A, (6.0, 0.26, 0.22), (0, RIDGE - 0.12, 0), OAK, bev=0.03)
for sg in (-1, 1):
    for k in (0.33, 0.66):
        box(A, (6.0, 0.14, 0.14), (0, TOP + 0.30 + rise * k - 0.02, sg * P * (1 - k)), OAK, (sg * th, 0, 0), 0.015)
    for x in np.arange(-2.625, 2.7, 0.75):
        box(A, (0.09, 0.14, L), (x, TOP + 0.30 + rise / 2 + 0.10, sg * P / 2), OAK, (sg * th, 0, 0), 0.012)
    dn = Vector((0, -math.sin(th), math.cos(th)))  # down-slope direction in (x,y,z) godot for +z side
    # board deck then 9 stepped slate courses; lowest course individual slates (fancy scalloped eave)
    for i in range(9):
        t0 = 0.12 + i * 0.355; zz = sg * min(t0 * math.cos(th), 3.0 - 0.12)
        yy = RIDGE + 0.12 - t0 * math.sin(th)
        if i < 8:
            box(A, (6.0, 0.035, 0.42), (0, yy, sg * t0 * math.cos(th)), SLATED if i == 5 else SLATE,
                (sg * (th + 0.05 + R.uniform(-0.006, 0.006)), 0, 0), 0.008, tile=2.0, uvoff=(0, 0))
    t0 = 0.12 + 8 * 0.355
    for j in range(24):
        x = -2.875 + j * 0.25; ln = 0.40 + R.uniform(-0.02, 0.02); tl = t0 + ln / 2 - 0.21
        zc = sg * min(tl * math.cos(th), 3.0 - (ln / 2) * math.cos(th)); yc = RIDGE + 0.12 - tl * math.sin(th)
        box(A, (0.235, 0.04, ln), (x, yc, zc), SLATE, (sg * (th + 0.05 + R.uniform(-0.02, 0.02)), 0, R.uniform(-0.01, 0.01)), 0.012, tile=2.0)
        sph(A, 0.012, (x, yc - 0.01, zc + sg * 0.03), COP, (1, 0.5, 1), 6, 4)
    box(A, (6.0, 0.03, L - 0.05), (0, TOP + 0.30 + rise / 2 + 0.06, sg * P / 2), OAKD, (sg * th, 0, 0), 0.005)
    box(A, (6.0, 0.012, 0.22), (0, RIDGE + 0.14 - 0.08 * math.sin(th), sg * 0.08), COP, (sg * th, 0, 0), 0.004)
cyl(A, 0.085, 6.0, (0, RIDGE + 0.17, 0), COP, axis='x', segs=12)
for x in np.arange(-2.75, 2.8, 0.5):
    cyl(A, 0.03, 0.16, (x, RIDGE + 0.32, 0), COP, r2=0.002, segs=6)
    sph(A, 0.035, (x, RIDGE + 0.27, 0), COP, segs=8, rings=5)
# clerestory ridge lantern (louvred vent), x -1..1
for x in (-0.95, 0.95):
    for z in (-0.35, 0.35): box(A, (0.10, 0.62, 0.10), (x, RIDGE + 0.45, z), OAKD, bev=0.012)
for sg in (-1, 1):
    for k in range(4): box(A, (1.82, 0.025, 0.14), (0, RIDGE + 0.28 + k * 0.12, sg * 0.36), OAK, (sg * 0.7, 0, 0), 0.005)
    box(A, (2.2, 0.03, 0.58), (0, RIDGE + 0.88, sg * 0.25), SLATE, (sg * 0.6, 0, 0), 0.01, tile=2.0)
cyl(A, 0.05, 2.2, (0, RIDGE + 1.05, 0), COP, axis='x', segs=10)
for x in (-1.1, 1.1): cyl(A, 0.06, 0.22, (x, RIDGE + 1.15, 0), COP, r2=0.005, segs=8)
# suspended bronze lamp (node HallBay_Lamp; pivot at chain top for sway)
G = 'HallBay_Lamp'; yb = 3.18
for k in range(int((RIDGE - 0.25 - 3.80) / 0.07)):
    y = RIDGE - 0.28 - k * 0.07
    box(A, (0.035, 0.075, 0.008), (0, y, 0), IRON, (0, (k % 2) * math.pi / 2, 0), 0.003, 1, group=G)
cyl(A, 0.20, 0.14, (0, 3.73, 0), BRZ, r2=0.04, segs=8, group=G)
cyl(A, 0.17, 0.03, (0, 3.64, 0), BRZ, segs=8, group=G)
cyl(A, 0.15, 0.03, (0, 3.30, 0), BRZ, segs=8, group=G)
cyl(A, 0.11, 0.32, (0, 3.47, 0), GLOW, r2=0.12, segs=8, group=G)
for a in range(8): cyl(A, 0.012, 0.36, (0.16 * math.cos(a * math.pi / 4), 3.47, 0.16 * math.sin(a * math.pi / 4)), BRZ, segs=6, group=G)
cyl(A, 0.05, 0.12, (0, yb + 0.06, 0), BRZ, r2=0.0, rot=(math.pi, 0, 0), segs=8, group=G)
HB = A.build()
loc = bpy.data.objects.new('HallBay_LampLight_Socket', None); loc.location = g2b((0, 3.47, 0)); bpy.context.scene.collection.objects.link(loc); loc.parent = HB

# ================================================================ FURNACE
A = Asset('Furnace'); ASSETS.append(A)
box(A, (2.0, 0.18, 1.25), (0, 0.09, 0), STONE, bev=0.03)
box(A, (1.86, 1.42, 0.85), (0, 0.89, -0.15), STONE, bev=0.03)                 # back mass (recess back z=.275)
FZ = 0.575; fd = FZ - 0.275; fzc = 0.275 + fd / 2
box(A, (0.55, 1.42, fd), (-0.655, 0.89, fzc), STONE, bev=0.03)
box(A, (0.55, 1.42, fd), (0.655, 0.89, fzc), STONE, bev=0.03)
box(A, (0.76, 0.76, fd), (0, 0.56, fzc), STONE, bev=0.02)
box(A, (0.76, 0.24, fd), (0, 1.48, fzc), STONE, bev=0.02)
box(A, (0.76, 0.42, 0.02), (0, 1.15, 0.28), SOOT, bev=0)
for y in np.arange(0.30, 1.6, 0.24):                                            # quoins
    for sgx in (-1, 1):
        w = 0.24 if int(y * 10) % 2 else 0.15
        box(A, (w, 0.21, 0.06), (sgx * (0.93 - w / 2 + 0.02), y, FZ + 0.02), STONE, bev=0.025)
        box(A, (0.06, 0.21, w), (sgx * 0.95, y, FZ - w / 2 + 0.02), STONE, bev=0.025)
arc(A, (0, 1.15), 0.50, 0.15, math.pi - 0.15, 9, 0.13, 0.08, STONE, 'xy', FZ + 0.03)
box(A, (0.13, 0.15, 0.09), (0, 1.66, FZ + 0.04), STONE, bev=0.03)               # keystone
box(A, (0.86, 0.06, 0.06), (0, 1.385, FZ + 0.035), IRON, bev=0.01)
for x in (-0.38, -0.19, 0, 0.19, 0.38): rivet(A, (x, 1.385, FZ + 0.068), r=0.013)
box(A, (0.86, 0.04, 0.10), (0, 0.94, FZ + 0.02), COP, bev=0.01)
# fire (node Furnace_Fire): coal bed + braided flame tongues, heat gradient along U
box(A, (0.72, 0.07, 0.27), (0, 0.975, 0.42), COAL, bev=0.02, group='Furnace_Fire')
for i in range(9): sph(A, 0.05, (-0.30 + i * 0.075, 1.0, 0.40 + R.uniform(-0.08, 0.08)), COAL, (1, 0.6, 1), 6, 4, group='Furnace_Fire')
for i, (x, h, rr) in enumerate(((-0.24, 0.20, 0.06), (-0.12, 0.30, 0.08), (0.0, 0.34, 0.09), (0.12, 0.28, 0.08), (0.24, 0.19, 0.06))):
    for b, tw in ((-1, 0.18), (1, -0.18)):
        cyl(A, rr * 0.8, h, (x + b * 0.02, 1.0 + h / 2, 0.42), FIRE, r2=0.004, segs=7, rot=(0.05, 0, tw), group='Furnace_Fire', tile=h, uvoff=(0.5, 0.5))
box(A, (0.70, 0.36, 0.01), (0, 1.16, 0.29), FIRE, group='Furnace_Fire', tile=0.40, uvoff=(0.5, 0.5))
# copper hood, iron bands, chimney collar to 3.1
cyl(A, 0.95 * math.sqrt(2), 0.95, (0, 2.075, -0.03), COP, r2=0.30 * math.sqrt(2), segs=4, spin=math.pi / 4, sz=1.15 / 1.9, bev=0.015)
box(A, (1.94, 0.08, 1.20), (0, 1.64, -0.03), IRON, bev=0.01)
for x in np.arange(-0.9, 0.95, 0.15): rivet(A, (x, 1.64, 0.575), r=0.013)
for k in range(1, 4):
    f = k / 4; w = 1.9 - (1.9 - 0.6) * f; d = 1.15 - (1.15 - 0.36) * f
    box(A, (w + 0.02, 0.025, 0.03), (0, 1.60 + 0.95 * f, -0.03 + d / 2 - 0.01), COP, (-0.62, 0, 0), 0.006)
box(A, (0.62, 0.06, 0.40), (0, 2.58, -0.03), IRON, bev=0.01)
box(A, (0.56, 0.42, 0.50), (0, 2.82, -0.03), STONE, bev=0.025)
box(A, (0.70, 0.08, 0.64), (0, 3.06, -0.03), COP, bev=0.012)
box(A, (0.44, 0.01, 0.38), (0, 3.101, -0.03), SOOT, bev=0)
for x in (-0.3, -0.1, 0.1, 0.3): rivet(A, (x, 3.06, 0.29), r=0.012)
box(A, (1.5, 0.035, 0.035), (0, 1.74, 0.56), IRON, bev=0.006)               # tool rail + hooks
for x in (-0.55, -0.2, 0.2, 0.55):
    box(A, (0.02, 0.12, 0.02), (x, 1.68, 0.60), IRON, bev=0.004)
    box(A, (0.02, 0.02, 0.06), (x, 1.63, 0.62), IRON, bev=0.004)
A.build()

# ================================================================ ANVIL
A = Asset('Anvil'); ASSETS.append(A)
cyl(A, 0.36, 0.80, (0, 0.40, 0), OAKD, r2=0.33, segs=16, bev=0.02, seg=2)
cyl(A, 0.32, 0.01, (0, 0.80, 0), OAK, segs=16)
for y, rr in ((0.14, 0.358), (0.66, 0.343)):
    cyl(A, rr + 0.008, 0.05, (0, y, 0), IRON, segs=16)
    for a in range(8): rivet(A, ((rr + 0.012) * math.cos(a * math.pi / 4), y, (rr + 0.012) * math.sin(a * math.pi / 4)), 'x' if a % 4 == 0 else 'z', 0.012)
for a in range(4): box(A, (0.12, 0.10, 0.16), (0.36 * math.cos(a * 1.57 + 0.4), 0.05, 0.36 * math.sin(a * 1.57 + 0.4)), OAKD, (0, -(a * 1.57 + 0.4), 0), 0.03)
box(A, (0.62, 0.08, 0.40), (0, 0.84, 0), IRON, bev=0.02)
cyl(A, 0.26 * math.sqrt(2), 0.20, (0, 0.98, 0), IRON, r2=0.15 * math.sqrt(2), segs=4, spin=math.pi / 4, sz=0.62, bev=0.015)
box(A, (0.86, 0.10, 0.40), (0, 1.11, 0), IRON, bev=0.02)
box(A, (0.90, 0.06, 0.45), (0, 1.19, 0), STEEL, bev=0.012, seg=3)                # working face top y=1.22
cyl(A, 0.10, 0.42, (0.66, 1.12, 0), IRON, axis='x', r2=0.012, segs=12)          # horn -> +X
box(A, (0.05, 0.004, 0.05), (-0.33, 1.2205, 0), SOOT, bev=0)                     # hardy
cyl(A, 0.014, 0.004, (-0.24, 1.2205, 0), SOOT, segs=8)                           # pritchel
for sz in (-1, 1):
    box(A, (0.06, 0.14, 0.012), (-0.18, 0.80, sz * 0.21), IRON, bev=0.004)
    box(A, (0.06, 0.14, 0.012), (0.18, 0.80, sz * 0.21), IRON, bev=0.004)
    for x in (-0.18, 0.18): rivet(A, (x, 0.76, sz * 0.218), 'z', 0.01)
A.build()

# ================================================================ DUMMY
A = Asset('Dummy'); ASSETS.append(A)
box(A, (1.1, 0.12, 0.14), (0, 0.06, 0), OAK, bev=0.02)
box(A, (0.14, 0.12, 1.1), (0, 0.06, 0), OAK, bev=0.02)
for sx, sz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    box(A, (0.06, 0.40, 0.06), (sx * 0.16, 0.26, sz * 0.16), OAKD, (sz * -0.65, 0, sx * 0.65), 0.01)
    cyl(A, 0.016, 0.02, (sx * 0.45, 0.125, sz * 0.45), OAKD, segs=8)
box(A, (0.12, 1.75, 0.12), (0, 0.995, 0), OAK, bev=0.015)
box(A, (1.25, 0.11, 0.11), (0, 1.50, 0), OAK, bev=0.015)
cyl(A, 0.018, 0.16, (0, 1.50, 0), OAKD, axis='z', segs=8)
for sx in (-1, 1):
    cyl(A, 0.075, 0.26, (sx * 0.48, 1.50, 0), STRAW, axis='x', segs=10, tile=0.5)
    for d in (-0.1, 0.1): cyl(A, 0.08, 0.025, (sx * 0.48 + d, 1.50, 0), ROPE, axis='x', segs=10)
cyl(A, 0.27, 0.66, (0, 1.27, 0), STRAW, r2=0.31, segs=18, sz=0.6, bev=0.05, seg=2, tile=0.6)
for y, rr in ((1.02, 0.275), (1.56, 0.305)): cyl(A, rr, 0.03, (0, y, 0), ROPE, segs=18, sz=0.6)
for sx in (-1, 1):                                                    # side seam stitches
    for k in range(9):
        y = 1.0 + k * 0.065; rr = 0.27 + (y - 0.94) / 0.66 * 0.04
        box(A, (0.008, 0.04, 0.025), (sx * rr, y, 0), ROPE, (0, 0, sx * 0.4 * (1 if k % 2 else -1)), 0.002)
box(A, (0.16, 0.14, 0.01), (-0.17, 1.12, 0.165), CANV, (0, -0.5, 0.06), 0.003)   # repair patch
for k in range(6): box(A, (0.006, 0.03, 0.006), (-0.24 + k * 0.028, 1.19, 0.20), ROPE, (0, -0.5, 0), 0.001)
cyl(A, 0.20, 0.02, (0, 1.32, 0.195), CANV, axis='z', segs=24, tile=0.4, uvoff=(0.5, 0.5), group='Dummy_Target')
for a in range(16):
    ang = a * math.pi / 8; box(A, (0.008, 0.03, 0.008), (0.2 * math.cos(ang), 1.32 + 0.2 * math.sin(ang), 0.207), ROPE, (0, 0, ang), 0.001, group='Dummy_Target')
cyl(A, 0.06, 0.05, (0, 1.65, 0), ROPE, segs=10)
sph(A, 0.15, (0, 1.8775, 0), STRAW, (1, 1.15, 0.9), 12, 8, tile=0.4)
cyl(A, 0.13, 0.025, (0, 1.78, 0), ROPE, segs=12, sz=0.9)
cyl(A, 0.02, 0.06, (0, 2.03, 0), ROPE, r2=0.005, segs=6)
A.build()

# ================================================================ BENCH
A = Asset('Bench'); ASSETS.append(A)
for i, z in enumerate((-0.2875, 0.0, 0.2875)):
    box(A, (1.55, 0.07, 0.268), (0, 0.915 + R.uniform(-0.002, 0.0), z), OAK, (R.uniform(-0.004, 0.004), 0, 0), 0.012)
for x in (-0.66, 0.66):
    for z in (-0.33, 0.33):
        box(A, (0.10, 0.88, 0.10), (x, 0.44, z), OAKD, bev=0.015)
        for y in (0.20, 0.80): cyl(A, 0.012, 0.11, (x, y, z), OAK, axis='z', segs=8)
    box(A, (0.05, 0.10, 0.56), (x, 0.80, 0), OAKD, bev=0.01)
    box(A, (0.06, 0.07, 0.56), (x, 0.20, 0), OAKD, bev=0.01)
for z in (-0.33, 0.33): box(A, (1.22, 0.10, 0.04), (0, 0.80, z), OAKD, bev=0.01)
box(A, (1.26, 0.03, 0.56), (0, 0.25, 0), OAK, bev=0.008)
box(A, (1.26, 0.05, 0.025), (0, 0.285, 0.27), OAK, bev=0.006)
for x in (-0.25, 0.25): cyl(A, 0.010, 0.008, (x, 0.285, 0.284), OAKD, axis='z', segs=8)
for sx in (-1, 1):
    box(A, (0.14, 0.006, 0.14), (sx * 0.70, 0.951, 0.36), IRON, bev=0.002)
    box(A, (0.14, 0.06, 0.006), (sx * 0.70, 0.92, 0.428), IRON, bev=0.002)
    for d in (0.03, 0.10): rivet(A, (sx * (0.70 - 0.065 + d), 0.92, 0.432), r=0.009); rivet(A, (sx * (0.70 - 0.065 + d), 0.955, 0.33), 'y', 0.009)
box(A, (0.9, 0.03, 0.03), (0, 0.76, 0.365), IRON, bev=0.005)
for x in (-0.3, 0, 0.3): box(A, (0.015, 0.06, 0.04), (x, 0.725, 0.38), IRON, bev=0.003)
A.build()

# ================================================================ SIGN (centred on origin, 1 x 1 x 0.08)
A = Asset('Sign'); ASSETS.append(A)
for (w, h, x, y) in ((1, 0.09, 0, 0.455), (1, 0.09, 0, -0.455), (0.09, 0.82, -0.455, 0), (0.09, 0.82, 0.455, 0)):
    box(A, (w, h, 0.08), (x, y, 0), OAKD, bev=0.015)
box(A, (0.84, 0.84, 0.05), (0, 0, -0.005), OAK, bev=0)
box(A, (0.80, 0.80, 0.02), (0, 0, 0.025), SLATEF, bev=0.006, group='Sign_LetterField')
for sx in (-1, 1):
    for sy in (-1, 1):
        box(A, (0.16, 0.035, 0.006), (sx * 0.41, sy * 0.4825, 0.037), IRON, bev=0.002)
        box(A, (0.035, 0.16, 0.006), (sx * 0.4825, sy * 0.41, 0.037), IRON, bev=0.002)
        rivet(A, (sx * 0.4825, sy * 0.4825, 0.040), r=0.01); rivet(A, (sx * 0.38, sy * 0.4825, 0.040), r=0.008); rivet(A, (sx * 0.4825, sy * 0.38, 0.040), r=0.008)
box(A, (0.10, 0.03, 0.006), (0, 0.455, 0.037), COP, bev=0.002)
A.build()

# ================================================================ COURT TILE (2 x 2 m, top ~0.028)
A = Asset('CourtTile'); ASSETS.append(A)
box(A, (2.0, 0.01, 2.0), (0, 0.005, 0), MORT, bev=0)
z0 = -1.0
for rh, widths in ((0.62, (0.7, 0.55, 0.75)), (0.70, (0.95, 1.05)), (0.68, (0.5, 0.8, 0.7))):
    x0 = -1.0
    for w in widths:
        h = R.uniform(0.022, 0.03)
        box(A, (w - 0.02, h, rh - 0.02), (x0 + w / 2, 0.006 + h / 2, z0 + rh / 2), FLAG, (R.uniform(-0.006, 0.006), 0, R.uniform(-0.006, 0.006)), 0.01, tile=2.0)
        x0 += w
    z0 += rh
A.build()

# ---------------------------------------------------------------- export
def select_tree(root):
    bpy.ops.object.select_all(action='DESELECT')
    def rec(o):
        o.select_set(True); [rec(c) for c in o.children]
    rec(root); bpy.context.view_layer.objects.active = root
FILES = {'Cradle': 'cradle', 'HallBay': 'hall_bay', 'Furnace': 'furnace', 'Anvil': 'anvil', 'Dummy': 'dummy',
         'Bench': 'bench', 'Sign': 'sign', 'CourtTile': 'court_tile'}
for a in ASSETS:
    select_tree(a.root)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, FILES[a.name] + '.glb'), export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
    print('EXPORTED', FILES[a.name])

# ---------------------------------------------------------------- preview layout (not exported)
if os.environ.get('SMITHY_NO_PREVIEW'): raise SystemExit
roots = {a.name: a.root for a in ASSETS}
def place(name, p, ry=0.0, s=1.0):
    o = roots[name]; o.location = g2b(p); o.rotation_euler = (0, 0, ry); o.scale = (s, s, s)
place('Furnace', (-1.7, 0, -2.1)); place('Anvil', (-0.9, 0, -0.3), 0.3); place('Bench', (1.5, 0, -2.2))
place('Cradle', (1.4, 0, 0.9), -0.25); place('Dummy', (-2.2, 0, 1.6), 0.5); place('Sign', (0.0, 2.65, 2.75), 0, 0.55)
tile = roots['CourtTile']
def dup_tree(root, off):
    e = bpy.data.objects.new(root.name + '_copy', None); bpy.context.scene.collection.objects.link(e); e.location = off
    for c in root.children:
        if c.type == 'MESH':
            o = bpy.data.objects.new(c.name + '_c', c.data); bpy.context.scene.collection.objects.link(o); o.parent = e
dup_tree(HB, g2b((6, 0, 0))); dup_tree(HB, g2b((-6, 0, 0)))
for i in range(-4, 5):
    for j in range(-2, 2):
        if (i, j) != (0, 0): dup_tree(tile, g2b((i * 2.0, 0, j * 2.0 + 1.0)))
tile.location = g2b((0, 0, 1.0))
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try: sc.render.engine = eng; break
    except Exception: pass
sc.render.resolution_x, sc.render.resolution_y = 1000, 640
try:
    sc.eevee.taa_render_samples = 32; sc.eevee.use_shadows = True
except Exception: pass
try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Punchy'
except Exception: pass
w = bpy.data.worlds.new('W'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.55, 0.75, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.6; sc.world = w
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sun.data.energy = 3.5; sun.data.color = (1.0, 0.8, 0.6)
sun.rotation_euler = (math.radians(55), 0, math.radians(-35)); sc.collection.objects.link(sun)
for nm, p, e, c in (('FireL', (-1.7, 1.2, -1.2), 250, (1, 0.45, 0.12)), ('LampL', (0, 3.4, 0), 120, (1, 0.65, 0.3)), ('LampL2', (6, 3.4, 0), 120, (1, 0.65, 0.3))):
    l = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'POINT')); l.data.energy = e; l.data.color = c; l.location = g2b(p); sc.collection.objects.link(l)
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
shots = []
for nm, p, tgt, lens in (('front', (0, 1.7, 8.8), (0, 1.9, 0), 26), ('oblique', (6.0, 2.6, 6.2), (-0.4, 1.2, -0.6), 24)):
    cam.location = g2b(p); cam.data.lens = lens
    cam.rotation_euler = (g2b(tgt) - g2b(p)).to_track_quat('-Z', 'Y').to_euler()
    f = os.path.join(OUT, '_preview_%s.png' % nm); sc.render.filepath = f; bpy.ops.render.render(write_still=True); shots.append(f)
ims = [bpy.data.images.load(f) for f in shots]
arr = [np.array(i.pixels[:], np.float32).reshape(i.size[1], i.size[0], 4) for i in ims]
comb = np.concatenate(arr, axis=1); H, W = comb.shape[:2]
out = bpy.data.images.new('preview', W, H, alpha=False); out.pixels.foreach_set(comb.ravel())
out.filepath_raw = os.path.join(OUT, 'preview.png'); out.file_format = 'PNG'; out.save()
for f in shots: os.remove(f)
print('PREVIEW DONE')
