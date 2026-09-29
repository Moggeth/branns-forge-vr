# Run: blender.exe -b -P build_swallow_line.py   (outputs next to this script)
import bpy, bmesh, math, random, json, os
from mathutils import Vector as V, Matrix
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- procedural textures ----------
def tex(name, fn, n=256):
    img = bpy.data.images.new(name, n, n, alpha=False)
    px = []
    for y in range(n):
        for x in range(n):
            r, g, b = fn(x / n, y / n)
            px += [min(1, max(0, r)), min(1, max(0, g)), min(1, max(0, b)), 1]
    img.pixels.foreach_set(px)
    img.pack()
    return img


def noise(u, v, s):
    return (math.sin(u * s * 6.28 + math.sin(v * s * 3.1) * 2) * math.sin(v * s * 6.28 + 1.3) + 1) / 2


def brass(u, v):
    n = noise(u, v, 9) * .12 + random.random() * .05
    r, g, b = .78 + n, .58 + n * .8, .2 + n * .3
    if abs(v * 3 % 1 - abs(u * 2 % 1 - .5) * .9) < .05:  # swallow-wing feather chevrons
        r, g, b = r * .45, g * .4, b * .3
    if (u * 16) % 1 < .07:
        r, g, b = r * .6, g * .55, b * .5
    return r, g, b


def steel(u, v):
    n = .1 + noise(u, v, 14) * .08 + random.random() * .04
    if (v * 20) % 1 < .04:
        n -= .04
    return n * .9, n * .95, n * 1.1


def rope(u, v):
    t = (u * 6 + v * 3) % 1
    c = .55 + (.5 + .5 * math.sin(t * 6.283)) * .3 + random.random() * .05
    return c * .85, c * .72, c * .48


def leather(u, v):
    n = .2 + random.random() * .05 + noise(u, v, 20) * .04
    if abs((u * 8) % 1 - .5) < .03:
        n *= .6
    return n * 1.5, n * .85, n * .5


def wood(u, v):
    g = .5 + .5 * math.sin((v * 22 + noise(u, v, 3) * 3) * 6.28)
    n = .32 + g * .12 + random.random() * .03
    return n * 1.1, n * .72, n * .4


def mat(name, fn, rough, metal):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = tex(name + '_tex', fn)
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


M = dict(brass=mat('Brass', brass, .35, .9), steel=mat('DarkSteel', steel, .45, .85),
         rope=mat('Rope', rope, .9, 0), leather=mat('Leather', leather, .7, 0), wood=mat('Wood', wood, .6, 0))


# ---------- builders (Blender Z-up, +Y forward -> Godot Y-up, -Z forward) ----------
def ring_mesh(name, rings, seg, caps=True, uscale=1.0):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    n = len(rings)
    grid = []
    for c, a, b, rx, ry in rings:
        grid.append([bm.verts.new(c + a * rx * math.cos(2 * math.pi * k / seg) + b * ry * math.sin(2 * math.pi * k / seg))
                     for k in range(seg)])
    for i in range(n - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            f = bm.faces.new((grid[i][k], grid[i][k2], grid[i + 1][k2], grid[i + 1][k]))
            uvs = [(i / (n - 1), k / seg), (i / (n - 1), (k + 1) / seg),
                   ((i + 1) / (n - 1), (k + 1) / seg), ((i + 1) / (n - 1), k / seg)]
            for l, (uu, vv) in zip(f.loops, uvs):
                l[uv].uv = (uu * uscale, vv)
    if caps:
        for row in (grid[0], grid[-1][::-1]):
            f = bm.faces.new(row)
            for j, l in enumerate(f.loops):
                l[uv].uv = (.5 + .4 * math.cos(2 * math.pi * j / seg), .5 + .4 * math.sin(2 * math.pi * j / seg))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def lathe(name, prof, axis, origin, seg=16, uscale=1.0):
    a = axis.normalized()
    ref = V((0, 0, 1)) if abs(a.z) < .9 else V((1, 0, 0))
    r1 = a.cross(ref).normalized()
    r2 = a.cross(r1)
    return ring_mesh(name, [(origin + a * t, r1, r2, r, r) for t, r in prof], seg, uscale=uscale)


def tube(name, pts, rad, seg=8, uscale=1.0):
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        ref = V((0, 0, 1)) if abs(t.z) < .9 else V((1, 0, 0))
        r1 = t.cross(ref).normalized()
        r2 = t.cross(r1)
        r = rad(i / (len(pts) - 1))
        rings.append((p, r1, r2, r, r))
    return ring_mesh(name, rings, seg, True, uscale)


def box(name, size, loc):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=loc)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def join(name, meshes, material, parent):
    bm = bmesh.new()
    for m in meshes:
        bm.from_mesh(m)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.empty_display_type = 'PLAIN_AXES'
    bpy.context.scene.collection.objects.link(e)
    return e


X, Y, Z = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
O = V((0, 0, 0))
SP = V((0, 0, .38))
root = empty('SwallowLine', (0, 0, 0))
pivot = empty('SpoolPivot', SP)
pivot.parent = root
hooktip = empty('HookTip', (0, .05, .70))
hooktip.parent = root
bpy.context.view_layer.update()

# grip, wraps
wood_m = [lathe('grip', [(.10, .019), (.13, .024), (.20, .027), (.27, .024), (.305, .02)], Z, O, 14)]
leather_m = [lathe('wrapA', [(.115, .0285), (.165, .0285)], Z, O, 14, 6),
             lathe('wrapB', [(.235, .0285), (.285, .0275)], Z, O, 14, 6),
             lathe('strap', [(.0, .026), (.03, .028), (.06, .026), (.10, .022)], Z, O, 12, 3)]
brass_m = [lathe('pommel', [(0, .012), (.012, .03), (.03, .034), (.05, .028), (.065, .02), (.10, .02)], Z, O, 16, 2),
           lathe('socket', [(.30, .022), (.32, .04), (.345, .042), (.36, .03), (.385, .022)], Z, O, 16, 2),
           lathe('collar', [(.47, .03), (.485, .042), (.51, .04), (.54, .028), (.575, .022)], Z, O, 16, 2),
           lathe('eye', [(0, .012), (.012, .012)], Y, V((0, .05, .585)), 10, 2)]
steel_m = [lathe('stem', [(.56, .018), (.60, .022), (.62, .02)], Z, O, 12),
           box('plateL', (.014, .05, .17), (.068, 0, .385)), box('plateR', (.014, .05, .17), (-.068, 0, .385)),
           box('bridge', (.15, .03, .02), (0, -.005, .47))]
for s in (1, -1):
    brass_m.append(lathe('bolt%d' % s, [(0, .02), (.008, .024), (.014, .014)], X * s, V((s * .074, 0, .38)), 12, 2))


def talon(name, start, plane_dir, th0, th1, length, r0, r1, n=14):
    pts = []
    p = start.copy()
    for i in range(n):
        th = math.radians(th0 + (th1 - th0) * i / (n - 1))
        pts.append(p.copy())
        p = p + (Z * math.cos(th) + plane_dir * math.sin(th)) * (length / (n - 1))
    return tube(name, pts, lambda t: r0 + (r1 - r0) * t ** 1.4, 8), pts


tips = []
for s in (1, -1):
    m, pts = talon('side%d' % s, V((s * .01, 0, .6)), X * s, 100, 10, .30, .017, .0035)
    steel_m.append(m)
    tips.append(pts[-1])
m, pts = talon('front', V((0, .012, .6)), Y, 0, 70, .17, .017, .0035)
steel_m.append(m)
tips.append(pts[-1])

# fixed lead from drum to head eyelet (rigid, outside pivot)
lead = [V((0, .066, .40)), V((0, .085, .44)), V((0, .075, .5)), V((0, .058, .56)), V((0, .05, .585))]
lead_m = tube('lead', lead, lambda t: .0065, 6, 3)

# spool assembly (children of SpoolPivot)
px = [lathe('spindle', [(-.086, .011), (.086, .011)], X, SP, 12),
      lathe('drum', [(-.045, .052), (.045, .052)], X, SP, 20, 2)]
pb = []
for s in (1, -1):
    pb.append(lathe('flange%d' % s, [(s * .046, .072), (s * .056, .072)], X, SP, 24, 2))
    pb.append(lathe('hub%d' % s, [(s * .046, .03), (s * .07, .03)], X, SP, 12, 2))
pts = []
turns = 7
for i in range(turns * 16 + 1):
    t = i / (turns * 16)
    ang = t * turns * 2 * math.pi
    pts.append(SP + V((-.037 + t * .074, .056 * math.sin(ang), .056 * math.cos(ang))))
rope_m = tube('wound', pts, lambda t: .0085, 6, 60)

join('Brass_body', brass_m, M['brass'], root)
join('Steel_body', steel_m, M['steel'], root)
join('Wood_grip', wood_m, M['wood'], root)
join('Leather_wrap', leather_m, M['leather'], root)
join('Rope_lead', [lead_m], M['rope'], root)
join('Spool_steel', px, M['steel'], pivot)
join('Spool_brass', pb, M['brass'], pivot)
join('Spool_rope', [rope_m], M['rope'], pivot)

# ---------- export ----------
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'swallow_line.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='AUTO', export_cameras=False)

# ---------- stats ----------
dg = bpy.context.evaluated_depsgraph_get()
tris = 0
items = 0
lo = [9, 9, 9]
hi = [-9, -9, -9]
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    items += 1
    e = o.evaluated_get(dg)
    me = e.to_mesh()
    tris += sum(len(p.vertices) - 2 for p in me.polygons)
    for v in me.vertices:
        w = o.matrix_world @ v.co
        for i, val in enumerate((w.x, w.z, -w.y)):
            lo[i] = min(lo[i], val)
            hi[i] = max(hi[i], val)
    e.to_mesh_clear()
stats = dict(triangles=tris, draw_items=items, materials=len(M), bbox_godot_min=lo, bbox_godot_max=hi,
             size_xyz=[h - l for h, l in zip(hi, lo)], spool_pivot=[0, .38, 0], hook_tip_node=[0, .70, -.05],
             talon_tips_godot=[[t.x, t.z, -t.y] for t in tips])
json.dump(stats, open(os.path.join(OUT, 'build_stats.json'), 'w'), indent=1)
print(json.dumps(stats))

# ---------- renders + blend ----------
sc = bpy.context.scene
cam = bpy.data.cameras.new('cam')
cam.lens = 60
co = bpy.data.objects.new('cam', cam)
sc.collection.objects.link(co)
sc.camera = co


def light(t, loc, e):
    l = bpy.data.lights.new(t, 'AREA')
    l.energy = e
    l.size = 1.5
    o = bpy.data.objects.new(t, l)
    o.location = loc
    sc.collection.objects.link(o)
    o.rotation_euler = (V((0, 0, .4)) - V(loc)).to_track_quat('-Z', 'Y').to_euler()


light('key', (1.2, 1.5, 1.4), 220)
light('fill', (-1.5, 1, .5), 80)
light('rim', (0, -1.5, 1.4), 150)
sc.world = bpy.data.worlds.new('w')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .13, .15, 1)
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.render.resolution_x = sc.render.resolution_y = 720
for name, loc in (('front', (0, 1.75, .5)), ('three_quarter', (1.3, 1.2, .62)), ('side', (1.8, 0, .45))):
    co.location = loc
    co.rotation_euler = (V((0, 0, .4)) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, 'renders', name + '.png')
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'swallow_line.blend'))
