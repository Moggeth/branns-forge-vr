import zlib, bpy, bmesh, math, os, sys, json, random
import numpy as np
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_tex(name, kind, size=256):
    rng = np.random.default_rng(zlib.crc32(name.encode()) % 9999)
    n = rng.random((size, size))
    for k in (4, 8, 16, 32):
        c = rng.random((k, k))
        up = np.kron(c, np.ones((size//k, size//k)))
        n = n*0.6 + up*0.4
    n = (n - n.min())/(n.max()-n.min())
    img = bpy.data.images.new(name, size, size)
    if kind == 'basalt':
        base = np.array([0.10, 0.10, 0.12]); hi = np.array([0.26, 0.25, 0.27])
    elif kind == 'iron':
        base = np.array([0.16, 0.13, 0.11]); hi = np.array([0.42, 0.30, 0.20])
    else:  # slag
        base = np.array([0.07, 0.05, 0.05]); hi = np.array([0.30, 0.12, 0.05])
    col = base[None, None, :] + (hi-base)[None, None, :]*n[:, :, None]
    if kind == 'slag':
        cr = (n > 0.82)[:, :, None]
        col = np.where(cr, np.array([0.9, 0.32, 0.06])[None, None, :], col)
    px = np.concatenate([col, np.ones((size, size, 1))], axis=2).astype(np.float32)
    img.pixels = px.ravel().tolist()
    img.pack()
    return img

MATS = {}
def mat(kind):
    if kind in MATS: return MATS[kind]
    m = bpy.data.materials.new('M_'+kind); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = make_tex('T_'+kind, kind)
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = {'basalt':0.85,'iron':0.55,'slag':0.9,'ember':0.6}.get(kind,0.8)
    if kind == 'iron': b.inputs['Metallic'].default_value = 0.6
    if kind in ('slag','ember'):
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 0.5 if kind=='slag' else 0.9
    MATS[kind] = m; return m

def box(bm, c, s, rot=0, taper=1.0):
    """add beveled-ish box centered c size s (x,y,z), yaw rot"""
    v = bmesh.ops.create_cube(bm, size=1.0)['verts']
    for x in v:
        p = x.co.copy()
        top = p.z > 0
        p.x *= s[0]*(taper if top else 1); p.y *= s[1]*(taper if top else 1); p.z *= s[2]
        cs, sn = math.cos(rot), math.sin(rot)
        x.co = Vector((p.x*cs-p.y*sn+c[0], p.x*sn+p.y*cs+c[1], p.z+c[2]))
    return v

def cyl(bm, c, r, h, seg=8, rot=0):
    r_ = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    for x in r_['verts']: x.co += Vector(c)
    return r_['verts']

def jitter(verts, a):
    for v in verts:
        v.co += Vector((random.uniform(-a,a), random.uniform(-a,a), random.uniform(-a,a)))

def uv_box(bm):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        for l in f.loops:
            l[uv].uv = (l.vert.co[a]*0.5, l.vert.co[b]*0.5)

def make_obj(name, parts):
    """parts: dict kind -> builder fn(bm)"""
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); slots = []
    for i, (kind, fn) in enumerate(parts.items()):
        before = set(bm.faces); fn(bm); me.materials.append(mat(kind))
        for f in bm.faces:
            if f not in before: f.material_index = i
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv_box(bm); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False
    return ob

# ---------------- assets ----------------
def _rim_fn(bm_unused=None):
    def basalt(bm):
        # forged basalt rim module ~4m long, chunky columns
        for i in range(5):
            x = -1.6 + i*0.8
            h = 0.9 + random.uniform(0, 0.5)
            v = box(bm, (x, 0, h/2), (0.7, 0.9, h), taper=0.85); jitter(v, 0.03)
        v = box(bm, (0, 0, 0.2), (4.2, 1.2, 0.4)); jitter(v, 0.02)
    def iron(bm):
        box(bm, (0, -0.47, 0.6), (4.0, 0.08, 0.14))
        for i in range(5):
            box(bm, (-1.6+i*0.8, -0.47, 0.6), (0.14, 0.12, 0.5))
    return make_obj('rim', {'basalt': basalt, 'iron': iron})


def a_rail():
    def iron(bm):
        for i in range(3):
            box(bm, (-1.5 + i*1.5, 0, 0.3), (0.16, 0.16, 0.6))
        box(bm, (-0.75, 0, 0.55), (1.5, 0.1, 0.12))
        b = box(bm, (1.05, 0, 0.45), (1.3, 0.1, 0.12))
        for v in b:
            if v.co.x > 1.4 and v.co.z > 0.4: v.co.z -= 0.28
        box(bm, (2.1, 0.25, 0.05), (0.6, 0.1, 0.1), rot=0.7)
    def basalt(bm):
        for i in range(3):
            box(bm, (-1.5 + i*1.5, 0, 0.06), (0.4, 0.4, 0.12))
    return make_obj('rail', {'iron': iron, 'basalt': basalt})

def a_slag():
    def slag(bm):
        for (x, y, r, h) in [(0,0,1.2,0.5),(0.9,0.4,0.7,0.8),(-0.8,-0.5,0.8,0.6),(0.2,-0.9,0.5,0.35),(-0.3,0.7,0.6,0.7)]:
            v = bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=r, radius2=r*0.5, depth=h)['verts']
            for p in v: p.co += Vector((x + random.uniform(-.07, .07), y + random.uniform(-.07, .07), h/2))
    def basalt(bm):
        v = box(bm, (0.2, 0.1, 0.5), (0.5, 0.5, 1.0), rot=0.4, taper=0.6); jitter(v, 0.04)
    def ember(bm):
        box(bm, (0, 0, 0.51), (0.5, 0.08, 0.04), rot=0.5)
    return make_obj('slag', {'slag': slag, 'basalt': basalt, 'ember': ember})

def a_gate():
    def basalt(bm):
        for sx in (-1, 1):
            v = box(bm, (sx*3.6, 0, 3.0), (2.0, 2.2, 6.0), taper=0.8); jitter(v, 0.05)
            v = box(bm, (sx*3.6, 0, 6.3), (2.4, 2.6, 0.7)); jitter(v, 0.04)
            for k in range(3):
                box(bm, (sx*(2.4 + k*1.5), 0.0, 6.9 + (k == 1)*0.2), (0.7, 1.0, 0.9 + 0.35*(k == 1)), taper=0.3)
        box(bm, (0, 0, 6.35), (5.4, 1.8, 1.1))
        for x in (-2.4, 0, 2.4):
            box(bm, (x, -0.2, 5.5), (0.5, 0.5, 0.9), taper=0.15)
        box(bm, (0, 1.2, 0.15), (8.5, 3.2, 0.3))
        for sx in (-1, 1):
            for j in range(3):
                v = box(bm, (sx*(6.0 + j*0.9), 0.3, 1.0 - j*0.25 + 0.0), (1.2, 1.4, 2.0 - j*0.5), taper=0.7); jitter(v, 0.05)
    def iron(bm):
        for sx in (-1, 1):
            for z in (1.5, 3.5, 5.3):
                box(bm, (sx*3.6, -1.15, z), (2.15, 0.12, 0.2))
            box(bm, (sx*2.65, -1.15, 3.0), (0.18, 0.14, 5.4))
        box(bm, (0, -0.95, 6.9), (5.0, 0.14, 0.18))
        for x in (-2.0, -1.0, 0, 1.0, 2.0):
            box(bm, (x, -0.1, 4.5), (0.08, 0.08, 2.4))
    def ember(bm):
        box(bm, (0, 0.75, 2.6), (4.6, 0.08, 5.2))
        for sx in (-1, 1):
            box(bm, (sx*3.6, -1.12, 4.4), (0.12, 0.05, 0.9))
    return make_obj('gate', {'basalt': basalt, 'iron': iron, 'ember': ember})

def a_chain():
    def iron(bm):
        box(bm, (0, 0, -0.05), (0.5, 0.15, 0.12))
        n = 10
        for i in range(n):
            z = -0.25 - i*0.26
            if i % 2 == 0:
                box(bm, (0.09, 0, z), (0.05, 0.05, 0.26)); box(bm, (-0.09, 0, z), (0.05, 0.05, 0.26))
                box(bm, (0, 0, z+0.11), (0.23, 0.05, 0.05)); box(bm, (0, 0, z-0.11), (0.23, 0.05, 0.05))
            else:
                box(bm, (0, 0.09, z), (0.05, 0.05, 0.26)); box(bm, (0, -0.09, z), (0.05, 0.05, 0.26))
                box(bm, (0, 0, z+0.11), (0.05, 0.23, 0.05)); box(bm, (0, 0, z-0.11), (0.05, 0.23, 0.05))
        box(bm, (0, 0, -0.25 - n*0.26 - 0.15), (0.4, 0.25, 0.4), taper=0.5)
    return make_obj('chain', {'iron': iron})

def a_conduit():
    def iron(bm):
        for x in (-1.5, 0, 1.5):
            box(bm, (x, 0, 0.14), (0.3, 0.5, 0.28), taper=0.9)
        box(bm, (0, 0, 0.3), (3.4, 0.22, 0.05))
    def ember(bm):
        box(bm, (0, 0, 0.26), (3.0, 0.14, 0.09))
    def basalt(bm):
        box(bm, (0, 0, 0.03), (3.6, 0.7, 0.06))
    return make_obj('conduit', {'iron': iron, 'ember': ember, 'basalt': basalt})

def a_inlay():
    def iron(bm):
        box(bm, (0, 0, 0), (1.96, 1.96, 0.05))
    def ember(bm):
        box(bm, (0, 0, 0.001), (0.16, 1.5, 0.052))
        box(bm, (0, 0, 0.001), (1.5, 0.16, 0.052))
    def basalt(bm):
        for sx in (-1, 1):
            for sy in (-1, 1):
                box(bm, (sx*0.7, sy*0.7, 0.002), (0.42, 0.42, 0.054))
    return make_obj('inlay', {'iron': iron, 'basalt': basalt, 'ember': ember})

def render(fn, loc, target, res=(800,600)):
    sc = bpy.context.scene
    for o in [o for o in sc.objects if o.type in ('CAMERA','LIGHT')]: bpy.data.objects.remove(o)
    ld = bpy.data.lights.new('sun','SUN'); ld.energy = 4
    lo = bpy.data.objects.new('sun', ld); sc.collection.objects.link(lo); lo.rotation_euler = (0.9,0.2,0.6)
    cd = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co)
    co.location = loc; d = Vector(target)-Vector(loc); co.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    sc.camera = co; sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = res
    w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.05,0.03,0.03,1)
    sc.world = w; sc.render.filepath = os.path.join(OUT, fn); bpy.ops.render.render(write_still=True)

def export(ob, fn):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fn), export_format='GLB', use_selection=True, export_apply=True)

def P(a, x, z, yaw=0, s=1, y=0): return {"asset": a, "position": [x, y, z], "yaw_degrees": yaw, "scale": s}

def layout():
    L = [P('gate', 0, -12.6)]
    for x in (-13.5, -9.5, -5.5, 5.5, 9.5, 13.5): L.append(P('rim', x, -14.4, 0))
    for z in (-10, -6, -2, 2, 6, 10):
        L.append(P('rim', -14.5, z, 90)); L.append(P('rim', 14.5, z, -90))
    for x in (-13.5, -9.5, -5.5, 11.5, 13.5): L.append(P('rim', x, 14.4, 180))
    L += [P('rail', -10, 12.5, 180), P('rail', 3.5, 13.8, 180), P('rail', 13.3, 4, -90), P('rail', -13.3, -4, 90), P('rail', -8, -13.2, 0)]
    L += [P('slag', -12, -12, 20, 1.3), P('slag', 12.2, -11.5, 200, 1.2), P('slag', 12.5, -1, 90, 0.9), P('slag', -12.5, 6, 0, 1.0), P('slag', -6, 13, 60, 0.8)]
    L += [P('conduit', -5.2, -13.2), P('conduit', 5.2, -13.2), P('conduit', -13.4, -8, 90), P('conduit', 13.4, -8, 90), P('conduit', -13.4, 3, 90)]
    for x in (-2.4, 0.0, 2.4): L.append(P('chain', x, -12.5, 0, 1.0, 5.45))
    L += [P('chain', -6.2, -12.4, 0, 0.8, 5.0), P('chain', 6.2, -12.4, 0, 0.8, 5.0)]
    for z in (12, 10, 8, 6, 4, 2, 0): L.append(P('inlay', 0, z, 0, 1.0, 0.025))
    for (cx, cz, r, n) in [(0, -7, 4.6, 11), (-7, -7, 2.0, 6)]:
        for k in range(n):
            a = 2*math.pi*k/n
            if cx < 0 and math.sin(a) > 0.2: continue
            L.append(P('inlay', round(cx + r*math.sin(a), 3), round(cz + r*math.cos(a), 3), round(math.degrees(a), 1), 1.0, 0.025))
    return L

if __name__ == '__main__':
    reset()
    builders = {'rim': _rim_fn, 'rail': a_rail, 'slag': a_slag, 'gate': a_gate, 'chain': a_chain, 'conduit': a_conduit, 'inlay': a_inlay}
    objs = {k: f() for k, f in builders.items()}
    stats = {"assets": {}, "material_families": sorted(MATS.keys())}
    for k, o in objs.items():
        export(o, k + '.glb')
        me = o.data; me.calc_loop_triangles()
        bb = [Vector(c) for c in o.bound_box]
        stats["assets"][k] = {"triangles": len(me.loop_triangles), "uv_layers": len(me.uv_layers),
            "materials": [m.name for m in me.materials],
            "bbox_blender_xyz(Godot x,z=-y)": [[round(min(v[i] for v in bb), 2), round(max(v[i] for v in bb), 2)] for i in range(3)]}
    stats["unique_triangles"] = sum(a["triangles"] for a in stats["assets"].values())
    stats["textures_nonblack_fraction"] = {}
    for im in bpy.data.images:
        if im.name.startswith('T_'):
            px = np.array(im.pixels[:]).reshape(-1, 4)
            stats["textures_nonblack_fraction"][im.name] = float((px[:, :3].sum(1) > 0.05).mean())
    L = layout()
    collision_path = os.path.join(OUT, 'collision_intent.json')
    collision_meta = json.load(open(collision_path)) if os.path.exists(collision_path) else {}
    runtime_placements = [dict(p, **({'collision':'asset_default'} if p['asset'] in collision_meta else {})) for p in L]
    json.dump({"schema": 1, "assets": {k: k + '.glb' for k in builders},
               "asset_meta": collision_meta, "placements": runtime_placements},
              open(os.path.join(OUT, 'placement_ember_foundry.json'), 'w'), indent=1)
    stats["placements"] = len(L)
    sc = bpy.context.scene
    for p in L:
        o = bpy.data.objects.new(p["asset"], objs[p["asset"]].data); sc.collection.objects.link(o)
        o.location = (p["position"][0], -p["position"][2], p["position"][1])
        o.rotation_euler = (0, 0, math.radians(p["yaw_degrees"]))
        o.scale = (p["scale"],)*3
    for o in objs.values(): o.hide_render = True; o.location = (0, 60, 0)
    fl = bpy.data.meshes.new('floor'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=15); bm.to_mesh(fl)
    fo = bpy.data.objects.new('floor', fl); sc.collection.objects.link(fo)
    fm = bpy.data.materials.new('fl'); fm.diffuse_color = (0.05, 0.05, 0.06, 1); fl.materials.append(fm)
    render('preview_ground.png', loc=(0, -14, 1.7), target=(0, 12, 3.0), res=(1280, 720))
    render('preview_overhead.png', loc=(0, -4, 42), target=(0, 0, 0), res=(1000, 1000))
    render('preview_rts.png', loc=(0, -26, 20), target=(0, 6, 0), res=(1280, 720))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'foundry.blend'))
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
