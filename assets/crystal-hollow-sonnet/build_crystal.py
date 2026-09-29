"""Deterministic Crystal Hollow kit builder.
Run: blender.exe -b --python build_crystal.py            (full)
     set CRYSTAL_STAGE=first before running for a one-asset smoke test.
Assets are modelled in Godot axes (Y up, +Z entrance) and rotated into Blender Z-up at finalisation.
"""
import bpy, bmesh, math, random, json, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
STAGE = os.environ.get("CRYSTAL_STAGE", "full")
V = Vector
R2B = Matrix.Rotation(math.pi / 2, 4, 'X')  # godot (x,y,z) -> blender (x,-z,y)

# ---------------------------------------------------------------- textures
def vnoise(n, r, rng):
    g = rng.random((r, r))
    x = np.arange(n) * r / n
    i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f); i1 = (i + 1) % r
    a = g[np.ix_(i, i)]; b = g[np.ix_(i, i1)]; c = g[np.ix_(i1, i)]; d = g[np.ix_(i1, i1)]
    fx = f[:, None]; fy = f[None, :]
    return (a * (1 - fy) + b * fy) * (1 - fx) + (c * (1 - fy) + d * fy) * fx

def fbm(n, rng, r0=4, octs=4):
    out = np.zeros((n, n)); amp = 1.0; tot = 0
    for o in range(octs):
        out += amp * vnoise(n, r0 * 2 ** o, rng); tot += amp; amp *= 0.5
    return out / tot

def lerp(a, b, t):
    return np.array(a)[None, None, :] * (1 - t[..., None]) + np.array(b)[None, None, :] * t[..., None]

def make_image(name, arr):
    n = arr.shape[0]
    im = bpy.data.images.new(name, n, n, alpha=False)
    rgba = np.concatenate([np.clip(arr, 0, 1), np.ones((n, n, 1))], axis=2)
    im.pixels.foreach_set(rgba.astype(np.float32).ravel())
    im.pack()
    return im

def tex_rock(rng, n=256):
    v = np.linspace(0, 1, n)[:, None] * np.ones((1, n))
    f = fbm(n, rng)
    band = 0.5 + 0.5 * np.sin(v * 2 * math.pi * 4 + f * 5.0)
    t = np.clip(band * 0.6 + f * 0.5, 0, 1)
    col = lerp((0.22, 0.21, 0.32), (0.50, 0.47, 0.62), t)
    teal = np.clip(np.sin(v * 2 * math.pi * 8 + f * 3) * 2 - 1.2, 0, 1)
    col = col * (1 - 0.35 * teal[..., None]) + np.array((0.10, 0.30, 0.34))[None, None, :] * 0.35 * teal[..., None]
    grain = fbm(n, rng, 32, 2)
    return col * (0.85 + 0.3 * grain[..., None])

def tex_ore(rng, n=256):
    base = tex_rock(rng, n) * 0.85
    f = fbm(n, rng, 3, 4)
    ridge = np.abs(f - 0.5) * 2
    vein = np.clip(1 - ridge / 0.07, 0, 1)
    f2 = fbm(n, rng, 5, 3); vein2 = np.clip(1 - np.abs(f2 - 0.5) * 2 / 0.05, 0, 1)
    gold = np.array((1.0, 0.68, 0.22))[None, None, :]; cy = np.array((0.4, 0.95, 1.0))[None, None, :]
    col = base * (1 - vein[..., None]) + gold * vein[..., None]
    col = col * (1 - vein2[..., None]) + cy * vein2[..., None]
    emit = np.clip(vein[..., None] * gold * 0.9 + vein2[..., None] * cy * 0.9, 0, 1)
    return col, emit

def tex_crystal(rng, lo, hi, n=256):
    v = np.linspace(0, 1, n)[:, None] * np.ones((1, n))
    u = np.ones((n, 1)) * np.linspace(0, 1, n)[None, :]
    f = fbm(n, rng, 4, 3)
    streak = 0.5 + 0.5 * np.sin(u * 2 * math.pi * 9 + f * 6)
    t = np.clip(0.25 + 0.55 * v + 0.35 * streak * f, 0, 1)
    return lerp(lo, hi, t)

def mk_mat(name, img, rough, metal=0.0, emit_img=None, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit_img is not None:
        e = nt.nodes.new('ShaderNodeTexImage'); e.image = emit_img
        nt.links.new(e.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emit
    return m

def build_materials():
    rng = np.random.default_rng(7)
    rock = make_image("rock_strata", tex_rock(rng))
    ore_c, ore_e = tex_ore(rng)
    ore = make_image("ore_vein", ore_c); ore_em = make_image("ore_vein_emit", ore_e)
    cy = make_image("crystal_cyan", tex_crystal(rng, (0.12, 0.62, 0.78), (0.7, 1.0, 1.0)))
    vi = make_image("crystal_violet", tex_crystal(rng, (0.42, 0.20, 0.78), (0.95, 0.72, 1.0)))
    return [
        mk_mat("HollowRock", rock, 0.92),
        mk_mat("HollowOre", ore, 0.5, 0.35, ore_em, 1.4),
        mk_mat("CrystalCyan", cy, 0.22),
        mk_mat("CrystalCyanGlow", cy, 0.2, 0.0, cy, 2.2),
        mk_mat("CrystalViolet", vi, 0.22),
        mk_mat("CrystalVioletGlow", vi, 0.2, 0.0, vi, 2.2),
    ]
ROCK, ORE, CYAN, CYAN_G, VIO, VIO_G = range(6)

# ---------------------------------------------------------------- geometry
def blob(bm, c, size, rng, mat=ROCK, sub=2, rough=0.22, yaw=0.0, sink=0.35):
    ret = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    vs = ret['verts']
    for v in vs:
        v.co *= rng.uniform(1 - rough, 1 + rough)
        v.co.y = max(v.co.y, -sink)
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(yaw, 3, 'Y'))
    bmesh.ops.translate(bm, verts=vs, vec=c)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat

def slab(bm, c, size, rng, mat=ROCK, jit=0.09, cuts=2):
    n0 = len(bm.verts)
    ret = bmesh.ops.create_cube(bm, size=1.0)
    bm.edges.ensure_lookup_table()
    new_edges = list({e for v in ret['verts'] for e in v.link_edges})
    bmesh.ops.subdivide_edges(bm, edges=new_edges, cuts=cuts, use_grid_fill=True)
    bm.verts.index_update(); nv = [v for v in bm.verts if v.index >= n0]
    for v in nv:
        v.co = V((c[0] + v.co.x * size[0] + rng.uniform(-jit, jit),
                  c[1] + v.co.y * size[1] + rng.uniform(-jit, jit) * 0.6,
                  c[2] + v.co.z * size[2] + rng.uniform(-jit, jit)))
    for f in {f for v in nv for f in v.link_faces}:
        f.material_index = mat

def crystal(bm, base, d, r, L, mat, rng, sides=6, tip=0.22, taper=0.78):
    base = V(base); d = V(d).normalized()
    a = d.cross(V((0, 1, 0)) if abs(d.y) < 0.9 else V((1, 0, 0))).normalized(); b = d.cross(a)
    a0 = rng.uniform(0, 6.28)
    def ring(p, rr):
        return [bm.verts.new(p + (a * math.cos(a0 + 6.2832 * i / sides) + b * math.sin(a0 + 6.2832 * i / sides)) * rr * rng.uniform(0.9, 1.1)) for i in range(sides)]
    r0 = ring(base, r); r1 = ring(base + d * L * (1 - tip), r * taper)
    ap = bm.verts.new(base + d * L)
    fs = []
    for i in range(sides):
        j = (i + 1) % sides
        fs += [bm.faces.new((r0[i], r0[j], r1[j], r1[i])), bm.faces.new((r1[i], r1[j], ap))]
    fs.append(bm.faces.new(r0[::-1]))
    for f in fs: f.material_index = mat

def pick_crystal_mat(rng, glow=0.4):
    violet = rng.random() < 0.45
    g = rng.random() < glow
    return (VIO_G if g else VIO) if violet else (CYAN_G if g else CYAN)

def cluster(bm, c, rng, n, scale=1.0, lean=0.55, rock=True, base_r=0.8):
    c = V(c)
    if rock:
        blob(bm, c, (base_r * scale, 0.5 * scale, base_r * scale), rng, sub=2)
        for _ in range(2):
            ang = rng.uniform(0, 6.28); rr = base_r * scale * 0.8
            blob(bm, c + V((math.cos(ang) * rr, 0, math.sin(ang) * rr)), (0.4 * scale, 0.28 * scale, 0.4 * scale), rng, sub=1)
    for i in range(n):
        if i == 0:
            d = V((rng.uniform(-.1, .1), 1, rng.uniform(-.1, .1))); r = 0.2 * scale; L = 1.9 * scale; off = V((0, 0.2 * scale, 0))
        else:
            ang = i * 2.4 + rng.uniform(-.4, .4); tilt = lean * rng.uniform(0.5, 1.4)
            d = V((math.cos(ang) * tilt, 1, math.sin(ang) * tilt)); r = rng.uniform(0.09, 0.17) * scale; L = rng.uniform(0.6, 1.5) * scale
            off = V((math.cos(ang), 0, math.sin(ang))) * base_r * scale * rng.uniform(0.2, 0.6) + V((0, 0.15 * scale, 0))
        crystal(bm, c + off + V((0, -0.05, 0)), d, r, L, pick_crystal_mat(rng), rng)

# ---------------------------------------------------------------- assets
def a_cluster_small(bm, rng): cluster(bm, (0, 0, 0), rng, 5, 0.85)
def a_cluster_large(bm, rng):
    cluster(bm, (0, 0, 0), rng, 10, 1.5, base_r=1.0)
    blob(bm, (1.6, 0, 0.5), (0.5, 0.4, 0.5), rng); blob(bm, (-1.5, 0, -0.4), (0.6, 0.35, 0.5), rng)
    blob(bm, (0.9, 0.05, -1.0), (0.35, 0.5, 0.3), rng, mat=ORE)

def a_boulders(bm, rng):
    for c, s in [((0, 0, 0), (1.1, 0.9, 1.0)), ((1.3, 0, 0.7), (0.7, 0.6, 0.65)), ((-1.1, 0, 0.6), (0.6, 0.5, 0.55)), ((0.4, 0, -1.0), (0.55, 0.45, 0.6))]:
        blob(bm, c, s, rng, yaw=rng.uniform(0, 3))
    blob(bm, (0.2, 0.7, 0.2), (0.4, 0.35, 0.3), rng, mat=ORE, sub=1)
    for i in range(3):
        crystal(bm, (-0.4 + i * 0.35, 0.55, 0.1), (rng.uniform(-.4, .4), 1, rng.uniform(-.2, .5)), 0.09, rng.uniform(0.5, 0.9), pick_crystal_mat(rng), rng)

def a_cliff(bm, rng):
    y = 0.0; W = 4.4
    for k in range(6):
        h = rng.uniform(0.55, 0.85); front = -0.15 - 0.0 * k + rng.uniform(-0.35, 0.3) + (0.25 if k % 2 else 0)
        w = W - k * 0.15 + rng.uniform(-0.2, 0.2)
        slab(bm, (rng.uniform(-0.1, 0.1), y + h / 2 - 0.05, front - 0.9), (w, h + 0.1, 1.8), rng, jit=0.1)
        y += h
    for x in (-1.8, -0.5, 1.2, 2.0):
        blob(bm, (x, 0, 0.35 + rng.uniform(-.1, .3)), (rng.uniform(.35, .6), rng.uniform(.3, .55), rng.uniform(.35, .55)), rng, sub=1)
    slab(bm, (0.6, 2.0, -0.3), (1.2, 0.18, 0.12), rng, mat=ORE, jit=0.03, cuts=1)
    cluster(bm, (-1.3, 1.5, -0.4), rng, 3, 0.45, rock=False)

def a_edge(bm, rng):
    for k in range(5):
        top = 0.1 - 0.62 * k; h = 0.75
        front = 0.05 + rng.uniform(0.0, 0.32) + (0.12 if k == 0 else 0)
        w = 3.0 - 0.12 * k + rng.uniform(-.1, .1)
        slab(bm, (0, top - h / 2, front - 0.7), (w, h, 1.4), rng, jit=0.09)
    for x in (-1.1, 0.4, 1.3):
        blob(bm, (x, 0.02, 0.05), (rng.uniform(.22, .4), rng.uniform(.14, .25), rng.uniform(.2, .32)), rng, sub=1, sink=0.5)
    slab(bm, (0.2, -1.5, 0.35), (0.9, 0.12, 0.1), rng, mat=ORE, jit=0.02, cuts=1)
    for x, y in ((-0.9, -1.3), (1.0, -2.2)):
        for i in range(3):
            crystal(bm, (x + i * 0.13, y, 0.35), (rng.uniform(-.4, .4), 0.35 - 0.2 * i, 1), 0.08 + 0.02 * (i % 2), rng.uniform(0.55, 1.0), (CYAN_G, VIO_G, CYAN)[(i + int(x > 0)) % 3], rng)

def a_landmark(bm, rng):
    for k, (rw, h) in enumerate([(2.6, 0.7), (2.1, 0.7), (1.6, 0.6)]):
        y = sum(z[1] for z in [(0, .7), (0, .7), (0, .6)][:k])
        for j in range(6):
            ang = j * 1.05 + rng.uniform(-.2, .2) + k * .5
            blob(bm, (math.cos(ang) * rw * 0.5, y + h * 0.4, math.sin(ang) * rw * 0.5), (rw * 0.55, h * 0.8, rw * 0.5), rng, sub=2, sink=0.2, yaw=ang)
        blob(bm, (0, y + h * 0.4, 0), (rw * 0.75, h * 0.8, rw * 0.75), rng, sub=2, sink=0.2)
    top = 1.9
    crystal(bm, (0, top - 0.3, 0), (0.06, 1, 0.03), 0.85, 6.4, CYAN_G, rng, sides=7, tip=0.3, taper=0.72)
    crystal(bm, (0.9, top - 0.3, 0.3), (0.55, 1, 0.15), 0.5, 4.2, VIO_G, rng, sides=6, tip=0.28)
    crystal(bm, (-0.8, top - 0.3, -0.3), (-0.5, 1, -0.1), 0.45, 3.7, CYAN, rng, sides=6, tip=0.28)
    crystal(bm, (0.2, top - 0.3, -0.9), (0.1, 1, -0.6), 0.4, 3.0, VIO, rng, sides=6, tip=0.28)
    for i in range(9):
        ang = i * 0.7 + 0.3; rr = rng.uniform(1.2, 2.0)
        crystal(bm, (math.cos(ang) * rr, 1.0 + rng.uniform(-.3, .3), math.sin(ang) * rr), (math.cos(ang) * 0.6, 1, math.sin(ang) * 0.6), rng.uniform(.14, .26), rng.uniform(1.0, 2.2), pick_crystal_mat(rng, 0.5), rng)
    for i in range(5):
        ang = i * 1.3 + 0.5
        slab(bm, (math.cos(ang) * 1.75, 0.6 + 0.3 * (i % 2), math.sin(ang) * 1.75), (0.9, 0.09, 0.14), rng, mat=ORE, jit=0.03, cuts=1)
        bm.verts.ensure_lookup_table()
    for x, z in ((2.6, 0.5), (-2.4, 1.0), (1.5, 2.3)):
        cluster(bm, (x, 0, z), rng, 4, 0.7, rock=True, base_r=0.6)

def a_ore_wall(bm, rng):
    for k in range(4):
        h = 0.85
        slab(bm, (rng.uniform(-.1, .1), h * k + h / 2 - 0.05, -0.7 + rng.uniform(-.2, .2)), (3.8 - k * 0.15, h + 0.1, 1.4), rng, jit=0.1)
    for i in range(6):
        x = -1.4 + i * 0.55 + rng.uniform(-.1, .1); y = rng.uniform(0.5, 3.0)
        blob(bm, (x, y, 0.0), (rng.uniform(.25, .45), rng.uniform(.18, .4), rng.uniform(.12, .2)), rng, mat=ORE, sub=1, rough=0.3, sink=0.9)
    slab(bm, (0, 1.6, 0.06), (2.6, 0.08, 0.06), rng, mat=ORE, jit=0.02, cuts=2)
    slab(bm, (0.4, 2.3, 0.05), (1.6, 0.07, 0.06), rng, mat=ORE, jit=0.02, cuts=2)
    cluster(bm, (-1.4, 0, 0.5), rng, 4, 0.6, base_r=0.6)

def a_stalactites(bm, rng):
    slab(bm, (0, 0.2, -0.2), (3.4, 0.7, 2.2), rng, jit=0.12)
    for i in range(8):
        x = -1.3 + i * 0.37 + rng.uniform(-.1, .1); z = rng.uniform(-.7, .3)
        crystal(bm, (x, -0.1, z), (rng.uniform(-.1, .1), -1, rng.uniform(-.1, .1)), rng.uniform(.14, .26), rng.uniform(0.7, 2.0), ROCK, rng, sides=5, tip=0.5, taper=0.55)
    for x, z, m in ((-0.5, 0.2, CYAN_G), (0.6, -0.4, VIO_G)):
        crystal(bm, (x, -0.1, z), (0.1, -1, 0.05), 0.13, 1.1, m, rng, sides=6, tip=0.3)

ASSETS = {
    "cluster_small": a_cluster_small, "cluster_large": a_cluster_large, "boulders": a_boulders,
    "cliff_strata": a_cliff, "chasm_edge": a_edge, "landmark_spire": a_landmark,
    "ore_wall": a_ore_wall, "stalactites": a_stalactites,
}

# ---------------------------------------------------------------- finalise / export
def tri_uv(bm):
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        ore = f.material_index in (CYAN, CYAN_G, VIO, VIO_G)
        sx, sy = (1.5, 1.5) if ore else (2.5, 2.0)
        for l in f.loops:
            p = l.vert.co
            if ax == 1: u, v = p.x / sx, p.z / sx
            elif ax == 0: u, v = p.z / sx, p.y / sy
            else: u, v = p.x / sx, p.y / sy
            l[uv].uv = (u, v)

def make_asset(name, fn, mats, seed):
    rng = random.Random(seed)
    bm = bmesh.new(); fn(bm, rng)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update(); tri_uv(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    me.transform(R2B)
    for p in me.polygons: p.use_smooth = False
    me.update()
    ob = bpy.data.objects.new(name, me)
    return ob

def export(ob, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_image_format='AUTO')

# ---------------------------------------------------------------- render
def setup_render(scene, w=1280, h=720, samples=48):
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = eng; break
        except TypeError:
            pass
    scene.render.resolution_x = w; scene.render.resolution_y = h
    scene.render.image_settings.file_format = 'PNG'
    try: scene.eevee.taa_render_samples = samples
    except Exception: pass
    scene.view_settings.view_transform = 'Standard'
    wd = bpy.data.worlds.new("W"); wd.use_nodes = True
    bg = wd.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.03, 0.04, 0.08, 1); bg.inputs[1].default_value = 1.0
    scene.world = wd

def g2b(p): return V((p[0], -p[2], p[1]))

def add_light(coll, kind, gpos, energy, color, size=1.0):
    ld = bpy.data.lights.new("L", kind); ld.energy = energy; ld.color = color
    if kind == 'AREA': ld.size = size
    if kind == 'POINT': ld.shadow_soft_size = size
    ob = bpy.data.objects.new("L", ld); ob.location = g2b(gpos); coll.objects.link(ob); return ob

def add_cam(scene, coll, gpos, gtarget, lens):
    cd = bpy.data.cameras.new("C"); cd.lens = lens; cd.clip_end = 200
    ob = bpy.data.objects.new("C", cd); ob.location = g2b(gpos); coll.objects.link(ob)
    ob.rotation_euler = (g2b(gtarget) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = ob; return ob

def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def flat_mat(name, col, rough=0.9):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = col; b.inputs['Roughness'].default_value = rough
    return m

def box(coll, name, gc, gs, mat):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = V((v.co.x * gs[0], v.co.y * gs[2], v.co.z * gs[1]))  # gs given in godot x,y,z; blender y=depth
    bm.to_mesh(me); bm.free(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); ob.location = g2b(gc); coll.objects.link(ob); return ob

# ---------------------------------------------------------------- layout (godot coords)
KEEP = [(-7, -10, 1.3), (-2.5, -10, 1.3), (2, -10, 1.3), (6.5, -10, 1.3), (3, -8, 1.6), (-5, -7.5, 1.4), (4, -8, 1.2)]
CORRIDOR = [(0, 11), (0, 7), (0, 3), (0, -1), (0, -3), (0, -5), (0, -8)]
CORR_HALF = 1.7

def seg_dist(p, a, b):
    ax, az = a; bx, bz = b; px, pz = p
    dx, dz = bx - ax, bz - az; t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)

def clear(x, z, r):
    for kx, kz, kr in KEEP:
        if math.hypot(x - kx, z - kz) < r + kr: return False
    for a, b in zip(CORRIDOR, CORRIDOR[1:]):
        if seg_dist((x, z), a, b) < r + CORR_HALF: return False
    return True

def build_layout():
    P = []
    def add(a, x, y, z, yaw=0, s=1.0, r=1.0, check=True):
        if check and not clear(x, z, r * s):
            print("SKIP keepout", a, x, z); return
        P.append({"asset": a, "position": [round(x, 3), round(y, 3), round(z, 3)], "yaw_degrees": yaw, "scale": s})
    rng = random.Random(11)
    # side and back cliffs
    zs = [11.5 - 4.1 * i for i in range(7)]
    for i, z in enumerate(zs):
        add("cliff_strata", -14.3, 0, z, 90, 1.0 + 0.08 * (i % 3), 1.5)
        add("cliff_strata", 14.3, 0, z + 1.0, -90, 1.0 + 0.08 * ((i + 1) % 3), 1.5)
    for i, x in enumerate([-11.5, -7.3, -3.1, 3.1, 7.3, 11.5]):
        add("cliff_strata" if i % 2 else "ore_wall", x, 0, -14.4, 0, 1.0, 1.5)
    # chasm rims
    for x in (3.4, 6.4, 9.4, 12.4):
        for sx in (1, -1):
            add("chasm_edge", sx * x, 0, -1.0, 180, 1.0, 1.5)
            add("chasm_edge", sx * x, 0, -6.0, 0, 1.0, 0.7)
    add("landmark_spire", 0, 0, -13.4, 0, 1.0, 2.6)
    for x, z in ((-11, -11), (11.2, -11.5), (-12.3, 4.5), (12.2, 6.5), (-10.5, -3.2), (10.8, -3.4)):
        add("cluster_large", x, 0, z, rng.choice([0, 60, 130, 200, 290]), rng.uniform(0.9, 1.1), 1.6)
    for x, z in ((-8.5, -13), (8.8, -13.2), (-12.5, 9), (12.6, 11), (-9.2, 1.5), (9.0, 2.2), (-13, -8.5), (13, -8), (5.5, 12.5), (-5.5, 12.8)):
        add("cluster_small", x, 0, z, rng.randrange(0, 360, 15), rng.uniform(0.85, 1.2), 0.9)
    for x, z in ((-12.3, -13), (12.3, -13), (-12.6, 0.5), (12.7, 0.3), (-13, 7.5), (13, 3), (-9.8, 12.5), (9.9, 12.8), (-6.5, -13.5)):
        add("boulders", x, 0, z, rng.randrange(0, 360, 15), rng.uniform(0.9, 1.3), 1.4)
    for z in (9.0, 3.0, -3.0, -9.5):
        add("stalactites", -13.0, 4.6, z, 90, 1.1, 1.5, check=False)
        add("stalactites", 13.0, 4.6, z + 1.5, -90, 1.1, 1.5, check=False)
    return P

def build_scene_from_layout(scene, coll, assets, placements):
    for i, p in enumerate(placements):
        ob = bpy.data.objects.new(f"{p['asset']}_{i}", assets[p['asset']].data)
        ob.location = g2b(p['position']); ob.rotation_euler = (0, 0, math.radians(p['yaw_degrees']))
        ob.scale = (p['scale'],) * 3; coll.objects.link(ob)

def build_stage_props(coll):
    fl = flat_mat("Floor", (0.10, 0.09, 0.12, 1)); pl = flat_mat("Plank", (0.35, 0.22, 0.10, 1))
    gold = flat_mat("Gold", (0.9, 0.7, 0.2, 1)); gol = flat_mat("Golem", (0.6, 0.25, 0.2, 1)); sk = flat_mat("Skel", (0.85, 0.85, 0.8, 1))
    box(coll, "FloorN", (0, -0.15, 7), (30, 0.3, 16), fl)
    box(coll, "FloorS", (0, -0.15, -10.5), (30, 0.3, 9), fl)
    for i in range(6): box(coll, "Plank", (0, -0.05, -1.5 - i * 0.9 ), (2.2, 0.12, 0.8), pl)
    for x in (-7, -2.5, 2, 6.5): box(coll, "OreSite", (x, 0.4, -10), (0.9, 0.8, 0.9), gold)
    box(coll, "Golem", (3, 1.0, -8), (1.2, 2.0, 1.2), gol); box(coll, "Skeleton", (-5, 0.9, -7.5), (0.6, 1.8, 0.4), sk)
    box(coll, "Anchor", (4, 2.2, -8.4), (0.3, 0.3, 0.3), gold)

# ---------------------------------------------------------------- main
def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = os.path.abspath(args[1]) if len(args) == 2 and args[0] == '--out' else HERE
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mats = build_materials()
    lib = bpy.data.collections.new("AssetLibrary"); scene.collection.children.link(lib)
    live = bpy.data.collections.new("Layout"); scene.collection.children.link(live)
    names = ["cluster_small"] if STAGE == "first" else list(ASSETS)
    assets = {}; stats = {"assets": {}}
    for i, n in enumerate(names):
        ob = make_asset(n, ASSETS[n], mats, 100 + i)
        lib.objects.link(ob)
        export(ob, os.path.join(out, f"{n}.glb"))
        me = ob.data; me.calc_loop_triangles()
        ws = [R2B.inverted() @ V(c) for c in ob.bound_box]
        stats["assets"][n] = {"triangles": len(me.loop_triangles),
                              "bounds_godot_min": [round(min(w[k] for w in ws), 2) for k in range(3)],
                              "bounds_godot_max": [round(max(w[k] for w in ws), 2) for k in range(3)]}
        assets[n] = ob
        ob.location = (60 + i * 8, 0, 0)
        ob.hide_render = True
    if STAGE == "first":
        for k in (0,):
            o = bpy.data.objects.new("inst", assets["cluster_small"].data); live.objects.link(o)
            o.scale = (2, 2, 2)
        box(live, "F", (0, -0.1, 0), (8, 0.2, 8), flat_mat("F", (0.1, 0.1, 0.12, 1)))
        setup_render(scene, 960, 540, 24)
        add_light(live, 'AREA', (2, 5, 5), 500, (1, 0.9, 0.8), 3)
        add_cam(scene, live, (3, 2.5, 5), (0, 0.9, 0), 40)
        render(scene, os.path.join(out, "first_render.png"))
        return
    placements = build_layout()
    manifest = {"schema": 1, "assets": {n: f"{n}.glb" for n in ASSETS}, "placements": placements}
    with open(os.path.join(out, "placement_crystal_hollow.json"), "w") as f: json.dump(manifest, f, indent=1)
    build_scene_from_layout(scene, live, assets, placements)
    build_stage_props(live)
    setup_render(scene)
    add_light(live, 'AREA', (0, 14, 16), 2500, (0.75, 0.8, 1.0), 12)
    add_light(live, 'AREA', (0, 12, -6), 1500, (0.6, 0.55, 1.0), 14)
    for x, z, c in ((0, -12, (0.3, 0.9, 1)), (-9, -8, (0.6, 0.4, 1)), (9, -8, (0.3, 0.9, 1)), (0, 2, (1, 0.85, 0.7)), (-9, 5, (0.4, 0.8, 1)), (9, 5, (0.6, 0.4, 1))):
        add_light(live, 'POINT', (x, 3.5, z), 900, c, 0.5)
    cam = add_cam(scene, live, (0, 1.7, 14.5), (0, 1.8, -8), 32)
    render(scene, os.path.join(out, "render_ground.png"))
    scene.camera.data.lens = 34
    cam.location = g2b((0, 21, 20)); cam.rotation_euler = (g2b((0, 0, -5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    render(scene, os.path.join(out, "render_rts.png"))
    tot = sum(a["triangles"] for a in stats["assets"].values())
    inst = sum(stats["assets"][p["asset"]]["triangles"] for p in placements)
    stats.update({"unique_triangles": tot, "instanced_triangles": inst, "placements": len(placements),
                  "materials": [m.name for m in mats], "texture_size": 256})
    with open(os.path.join(out, "stats.json"), "w") as f: json.dump(stats, f, indent=1)
    # library objects go back to hidden; save editable blend
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "crystal.blend"))
    print("DONE", tot, inst)
    print("CRYSTAL_BUILD_OK")

main()
