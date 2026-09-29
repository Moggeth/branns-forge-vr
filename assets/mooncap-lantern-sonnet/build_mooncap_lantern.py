import bpy, bmesh, math, json, os, random
import numpy as np
from mathutils import Vector
random.seed(7)
OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def noise(x, y, s):
    g = np.random.RandomState(s).rand(16, 16)
    return g[(y * 16).astype(int) % 16, (x * 16).astype(int) % 16]


def tex(name, fn, n=128):
    y, x = np.mgrid[0:n, 0:n] / n
    rgb = np.clip(fn(x, y), 0, 1)
    px = np.ones((n, n, 4))
    px[..., :3] = rgb
    im = bpy.data.images.new(name, n, n)
    im.pixels = px.ravel().tolist()
    im.pack()
    return im


def mat(name, im, rough, metal=0, emit=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = im
    m.node_tree.links.new(t.outputs[0], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        m.node_tree.links.new(t.outputs[0], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emit
    return m


def woodf(x, y):
    grain = np.sin(x * 60 + noise(x * .5, y * .12, 1) * 9)
    root = noise(x * 2, y * .3, 4)
    lt = .5 + .5 * grain
    base = np.stack([.30 + .16 * lt + .05 * root, .18 + .10 * lt + .03 * root, .09 + .05 * lt], -1)
    knot = (np.abs(np.sin(y * 40)) < .05)[..., None] * -.06
    return base + knot


def wrapf(x, y):
    w = .5 + .5 * np.sin(x * 60 + y * 30)
    return np.stack([.62 + .1 * w, .5 + .08 * w, .32 + .06 * w], -1)


def brassf(x, y):
    n = .5 + .25 * np.sin(x * 30 + y * 12) + .25 * np.sin(y * 50)
    leaf = (np.abs(np.sin(x * 40 + np.sin(y * 24) * 2)) > .93) * .18
    dark = .22 * (np.sin(x * 25) * np.sin(y * 31) > .6)
    k = 1.1 - .25 * n - dark - leaf
    return np.stack([.92 * k, .7 * k, .28 * k], -1)


def capf(x, y):
    dx, dy = x - .5, y - .5
    d = np.hypot(dx, dy) * 2
    th = np.arctan2(dy, dx)
    vein = .5 + .5 * np.sin(th * 20 + np.sin(d * 9) * 1.5)
    fine = .5 + .5 * np.sin(th * 60 + d * 8)
    blot = .5 + .25 * np.sin(x * 17 + y * 9) + .25 * np.sin(y * 23 - x * 5)
    spots = (np.sin(x * 45) * np.sin(y * 38 + 1) > .88) * .22
    lit = .55 + .3 * (1 - d) - .16 * vein * d - .04 * fine
    r = lit * (.62 + .2 * blot) + spots * .6 + .1 * d * d
    g = lit * (.42 + .16 * blot) + spots * .5
    b = lit * (.95 - .1 * vein * d) + spots * .3
    return np.stack([r, g, b], -1)


def gillf(x, y):
    r = .10 + .12 * y + .05 * x
    g = .16 + .30 * y + .06 * x
    b = .30 + .40 * y
    return np.stack([r, g, b], -1)


M = {
    'wood': mat('Wood', tex('wood', woodf, 256), .85),
    'wrap': mat('Wrap', tex('wrap', wrapf), .95),
    'brass': mat('Brass', tex('brass', brassf, 256), .5, .85),
    'cap': mat('MooncapGlowMat', tex('cap', capf, 256), .7, 0, .45),
    'gill': mat('GillGlowMat', tex('gill', gillf), .7, 0, .55),
    'stem': mat('Stem', tex('stem', lambda x, y: np.stack([.85 - .1 * noise(x, y, 3), .8 - .1 * noise(x, y, 3), .78 + 0 * x], -1)), .85),
}
objs = []


def planar_uv(bm, sx=.36):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / sx + .5, l.vert.co.y / sx + .5)


def fin(o, name, m):
    o.name = name
    o.data.materials.append(M[m])
    objs.append(o)
    if not o.data.uv_layers:
        bm = bmesh.new(); bm.from_mesh(o.data)
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            for l in f.loops:
                c = l.vert.co
                l[uv].uv = ((math.atan2(c.y, c.x) / (2 * math.pi)) % 1, c.z * 2)
        bm.to_mesh(o.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons:
        p.use_smooth = name.startswith(('Root', 'Brass', 'Moon', 'Stem')) and not name.startswith('MooncapGills')
    return o


def lathe(name, prof, m, seg=16, mod=None, planar=False, zscale=1.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for j, (r, z) in enumerate(prof):
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr, zz = mod(r, z, a) if mod else (r, z)
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), zz)))
        rings.append(row)
    uv = bm.loops.layers.uv.verify()
    n = len(prof)
    for j in range(n - 1):
        for i in range(seg):
            f = bm.faces.new((rings[j][i], rings[j][(i + 1) % seg], rings[j + 1][(i + 1) % seg], rings[j + 1][i]))
            us = [i / seg, (i + 1) / seg, (i + 1) / seg, i / seg]
            vs = [j / (n - 1), j / (n - 1), (j + 1) / (n - 1), (j + 1) / (n - 1)]
            for l, u, v in zip(f.loops, us, vs):
                l[uv].uv = (u, v * zscale)
    c0 = bm.faces.new(rings[0][::-1]); c1 = bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if planar:
        planar_uv(bm)
    else:
        for f in (c0, c1):
            if f.is_valid:
                for l in f.loops:
                    l[uv].uv = (l.vert.co.x * 10 + .5, l.vert.co.y * 10 + .5)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return fin(o, name, m)


# Blender is Z-up; the glTF exporter converts to Y-up, -Z forward.
lathe('RootGrip', [(.013, -.02), (.021, 0), (.024, .05), (.02, .09), (.0205, .16), (.026, .2), (.022, .26), (.03, .3), (.018, .33)], 'wood', 20, zscale=3)
wp = []
z = .065
while z < .175:
    wp += [(.0215, z), (.0245, z + .004), (.0215, z + .008)]
    z += .0145
lathe("RootWrap", wp, "wrap", 12, zscale=2)
lathe('BrassBase', [(.03, .3), (.05, .312), (.062, .322), (.075, .345), (.068, .355), (.06, .365), (.04, .372), (.03, .375)], 'brass', 20,
      mod=lambda r, z, a: (r * (1 + .05 * math.cos(a * 10)) if r > .04 else r, z))
lathe('MooncapStem', [(.03, .37), (.02, .42), (.024, .47), (.035, .51)], 'stem')

R = .165


def capmod(r, z, a):
    w = min(1, (r / R)) ** 3
    rr = r * (1 + .07 * w * math.sin(a * 6) + .012 * min(1, r / R) * math.sin(a * 18))
    zz = z - .012 * w * math.sin(a * 6 + 1)
    return rr, zz


cap = [(.0, .49), (.165, .49)] + [(.165 * math.cos(math.pi / 2 * i / 10), .49 + .14 * math.sin(math.pi / 2 * i / 10)) for i in range(1, 11)]
lathe('MooncapGlow', cap, 'cap', 54, mod=capmod, planar=True)

me = bpy.data.meshes.new('MooncapGills'); bm = bmesh.new(); uv = bm.loops.layers.uv.verify()
prof = [(.038, .49), (.16, .49), (.153, .472), (.12, .455), (.075, .452), (.045, .462)]
NF, T = 40, .0028


def face(vs, uvs, flip=False):
    f = bm.faces.new(vs[::-1] if flip else vs)
    mp = {v: u for v, u in zip(vs, uvs)}
    for l in f.loops:
        l[uv].uv = mp[l.vert]


for i in range(NF):
    a = 2 * math.pi * i / NF
    ca, sa = math.cos(a), math.sin(a)
    side = []
    for s in (-1, 1):
        side.append([bm.verts.new((r * ca - s * T * sa, r * sa + s * T * ca, z)) for r, z in prof])
    uvp = [((r - .038) / .122, (.49 - z) / .038) for r, z in prof]
    face(side[0], uvp, True); face(side[1], uvp)
    n = len(prof)
    for k in range(n):
        k2 = (k + 1) % n
        face([side[0][k], side[0][k2], side[1][k2], side[1][k]], [uvp[k], uvp[k2], uvp[k2], uvp[k]])
random.seed(7)
for i in range(8):
    a = random.uniform(0, 6.28); r = random.uniform(.05, .17); z = random.uniform(.4, .68)
    g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=random.uniform(.006, .011))
    for v in g['verts']:
        v.co += Vector((r * math.cos(a), r * math.sin(a), z))
        for l in v.link_loops:
            l[uv].uv = (.5, 1.0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
o = bpy.data.objects.new('MooncapGills', me); sc.collection.objects.link(o)
fin(o, 'MooncapGills', 'gill')


def tube(name, pts, rad, m, closed=False):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = rad
    cu.bevel_resolution = 1
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1)
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    return fin(bpy.context.active_object, name, m)


for k in range(4):
    a = math.pi / 2 * k + math.pi / 4
    pts = []
    for j in range(13):
        t = j / 12
        r = .035 + .16 * math.sin(math.pi * t ** .8) + .01 * (1 - t)
        r = max(r, .035)
        pts.append((r * math.cos(a), r * math.sin(a), .365 + .355 * t))
    tube('BrassRib_%d' % k, pts, .0085, 'brass')


def ring(name, r, z, rad, n=20):
    tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)], rad, 'brass', True)


ring('BrassRingMid', .19, .535, .007)
ring('BrassRingTop', .04, .72, .011)
lathe('BrassHood', [(.06, .7), (.045, .73), (.03, .765), (.012, .785)], 'brass', 20)
tube('BrassLoop', [(0, .03 * math.sin(2 * math.pi * t / 16), .785 + .025 * (1 - math.cos(2 * math.pi * t / 16))) for t in range(16)], .006, 'brass', True)
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, .55))
e = bpy.context.active_object
e.name = 'LightAnchor'
objs.append(e)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'mooncap_lantern.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'mooncap_lantern.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_lights=False, export_cameras=False)
tris = 0
lo = Vector((9, 9, 9)); hi = Vector((-9, -9, -9))
for o in objs:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            lo = Vector(map(min, lo, v.co)); hi = Vector(map(max, hi, v.co))
d = hi - lo
json.dump({'triangles': tris, 'material_families': list(M), 'width_x_m': d.x, 'depth_m': d.y, 'height_m': d.z,
           'bbox_min_blender_zup': list(lo), 'bbox_max_blender_zup': list(hi)}, open(os.path.join(OUT, 'build_stats.json'), 'w'), indent=1)

w = bpy.data.worlds.new('w'); w.color = (.03, .03, .05); sc.world = w
for loc, en in (((1, -1, 1.2), 3), ((-1, -1, .5), 1.5)):
    l = bpy.data.lights.new('l', 'SUN'); l.energy = en
    lo_ = bpy.data.objects.new('l', l); sc.collection.objects.link(lo_)
    lo_.rotation_euler = Vector(loc).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 700; sc.render.resolution_y = 900
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
for name, loc, tgt in (('preview_front', (0, -1.6, .42), (0, 0, .4)), ('preview_threequarter', (1.0, -1.2, .6), (0, 0, .4)), ('preview_closeup', (.35, -.55, .6), (0, 0, .53))):
    cam.location = loc; cam.data.lens = 60
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
