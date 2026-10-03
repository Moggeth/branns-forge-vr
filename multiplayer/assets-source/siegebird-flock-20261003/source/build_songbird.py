"""Siegebird reload songbird: reproducible Blender builder.

Run:  <python with bpy 4.5> build_songbird.py [out.glb]
Writes the GLB, a .blend beside it and prints a JSON report.

One small songbird that every Siegebird reload reuses. Plumage is a palette
texture (8 x 1 texels, nearest filtered); each face samples exactly one texel,
so the runtime recolours the whole flock by swapping that tiny texture.

Palette regions (U texel index):
  0 back / crown     1 breast / belly     2 wing coverts     3 flight + tail feathers
  4 throat / bib     5 beak               6 eye              7 legs, toes, eye ring

Axes: Blender +Y forward, +Z up, +X right. The glTF exporter turns that into
three.js -Z forward, +Y up, +X right. Units are metres.

Nodes (all prefixed so they never collide with the crossbow's own Body/Wings/Bolt lookups):
  Songbird                  root, origin at the talons' grip centre (the carried bolt's axis)
    SongbirdBody            body, head, beak, eyes, tail, legs and toes (one draw)
    SongbirdWingL / R       inner wing, pivot at the shoulder; rotate about local Z (glTF -Z forward) to flap
      SongbirdWingL_Tip / R_Tip   hand + primaries, pivot at the wrist; rotate to fold
    SongbirdTalons          empty at the grip: the carried bolt's axis, shaft along forward
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

TAU = math.tau
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else
                      (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('.glb') else os.path.join(HERE, '..', 'out', 'siegebird_songbird.glb')))
REGIONS = 8
# Default (Kingfisher) plumage baked into the GLB; the runtime supplies the other five + golden.
DEFAULT_PALETTE = ['1f86b3', 'e27a2c', '1a6a95', '123f5e', 'f3eadb', '262220', '0b0b0d', 'c9603a']

# Grip centre: the carried bolt runs along +Y through this point, just under the belly.
GRIP = Vector((0, 0.012, -0.060))


def srgb_to_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


class Builder:
    """Accumulates faces with one palette region each; UVs are per face corner."""
    def __init__(self):
        self.verts, self.faces = [], []

    def v(self, p):
        self.verts.append(Vector(p)); return len(self.verts) - 1

    def f(self, idx, region):
        self.faces.append((tuple(idx), region))

    def mesh(self, name, origin=Vector()):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bv = [bm.verts.new(p - origin) for p in self.verts]
        uv = bm.loops.layers.uv.new('UVMap')
        for idx, region in self.faces:
            try:
                face = bm.faces.new([bv[i] for i in idx])
            except ValueError:
                continue
            for loop in face.loops:
                loop[uv].uv = ((region + .5) / REGIONS, .5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        for p in me.polygons:
            p.use_smooth = True
        return me


def ellipse_ring(b, y, w, h, zc, n, flat=0.0):
    """Ring of n verts; angle 0 = top. `flat` squares off the belly a little."""
    out = []
    for k in range(n):
        a = TAU * k / n
        s, c = math.sin(a), math.cos(a)
        z = c * h
        if c < 0:
            z *= (1 - flat * (1 - abs(s)))
        out.append(b.v((s * w, y, zc + z)))
    return out


def loft_body(b):
    n = 18
    #        y       w      h      zc     region rule
    secs = [(-0.078, 0.012, 0.010, 0.004),
            (-0.064, 0.022, 0.019, 0.003),
            (-0.044, 0.033, 0.031, 0.000),
            (-0.020, 0.041, 0.039, 0.001),
            (0.004, 0.043, 0.041, 0.004),
            (0.026, 0.040, 0.038, 0.009),
            (0.044, 0.032, 0.032, 0.016),
            (0.058, 0.025, 0.026, 0.024),
            (0.071, 0.025, 0.026, 0.031),
            (0.086, 0.027, 0.027, 0.035),
            (0.100, 0.023, 0.023, 0.035),
            (0.111, 0.015, 0.016, 0.033),
            (0.117, 0.008, 0.009, 0.032)]
    rings = [ellipse_ring(b, y, w, h, zc, n, flat=.18 if y < .05 else 0) for y, w, h, zc in secs]
    for i in range(len(rings) - 1):
        y = (secs[i][0] + secs[i + 1][0]) / 2
        for k in range(n):
            a = TAU * (k + .5) / n
            top = math.cos(a)
            side_ = abs(math.sin(a))
            if y > 0.098:          # face: throat colour wraps forward round the beak (mask / cheek)
                region = 0 if top > 0.35 else 4
            elif y > 0.056:        # head: crown on top, throat below
                region = 0 if top > -0.25 else 4
            elif y > 0.040:        # small bib under the throat
                region = 0 if top > 0.25 else (4 if top < -0.75 else 1)
            else:
                region = 0 if top > 0.05 else 1
            b.f([rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]], region)
    # Caps
    tail = b.v((0, secs[0][0] - 0.004, secs[0][3]))
    for k in range(n):
        b.f([rings[0][(k + 1) % n], rings[0][k], tail], 0)
    nose = b.v((0, secs[-1][0] + 0.003, secs[-1][3]))
    for k in range(n):
        b.f([rings[-1][k], rings[-1][(k + 1) % n], nose], 0)


def cone(b, base, tip, rw, rh, n, region, droop=0.0):
    """Beak: tapered elliptical cone with a slight downward curve."""
    rings = []
    steps = 4
    for s in range(steps):
        t = s / steps
        c = base.lerp(tip, t) + Vector((0, 0, -droop * t * t))
        k = (1 - t) ** 0.9
        rings.append([b.v(c + Vector((math.sin(TAU * j / n) * rw * k, 0, math.cos(TAU * j / n) * rh * k))) for j in range(n)])
    for i in range(steps - 1):
        for j in range(n):
            b.f([rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]], region)
    t = b.v(tip + Vector((0, 0, -droop)))
    for j in range(n):
        b.f([rings[-1][j], rings[-1][(j + 1) % n], t], region)


def ball(b, c, r, region, seg=8, rings_n=5, squash=(1, 1, 1)):
    top = b.v(c + Vector((0, 0, r * squash[2])))
    bot = b.v(c - Vector((0, 0, r * squash[2])))
    rings = []
    for i in range(1, rings_n):
        phi = math.pi * i / rings_n
        rings.append([b.v(c + Vector((math.sin(phi) * math.cos(TAU * j / seg) * r * squash[0],
                                      math.sin(phi) * math.sin(TAU * j / seg) * r * squash[1],
                                      math.cos(phi) * r * squash[2]))) for j in range(seg)])
    for j in range(seg):
        b.f([top, rings[0][j], rings[0][(j + 1) % seg]], region)
        b.f([bot, rings[-1][(j + 1) % seg], rings[-1][j]], region)
    for i in range(len(rings) - 1):
        for j in range(seg):
            b.f([rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % seg], rings[i][(j + 1) % seg]], region)


def tube(b, pts, r0, r1, region, n=5):
    rings = []
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized(); c = d.cross(a)
        r = r0 + (r1 - r0) * t
        rings.append([b.v(p + (a * math.cos(TAU * j / n) + c * math.sin(TAU * j / n)) * r) for j in range(n)])
    for i in range(len(rings) - 1):
        for j in range(n):
            b.f([rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]], region)
    end = b.v(pts[-1] + (pts[-1] - pts[-2]).normalized() * r1)
    for j in range(n):
        b.f([rings[-1][j], rings[-1][(j + 1) % n], end], region)


def feather(b, root, direction, side, length, width, region, thick=0.0018, lift=0.0, curl=0.0):
    """A single feather blade: narrow quill root, widest at 65%, rounded tip, with a raised rachis.
    `direction` is the shaft (unit), `side` the in-plane width axis; the blade normal is their cross product."""
    direction = direction.normalized(); side = side.normalized(); up = side.cross(direction).normalized()
    prof = [(0.0, .30), (.18, .62), (.42, .9), (.65, 1.0), (.82, .86), (.93, .58), (1.0, .0)]
    top_l, top_r, bot_l, bot_r, spine_t, spine_b = [], [], [], [], [], []
    for t, wf in prof:
        bend = up * (curl * t * t * length + lift * t * length)
        c = root + direction * (t * length) + bend
        w = width * .5 * wf
        h = thick * (.5 + .5 * (1 - t))
        top_l.append(b.v(c - side * w + up * h * .25)); top_r.append(b.v(c + side * w + up * h * .25))
        bot_l.append(b.v(c - side * w - up * h * .25)); bot_r.append(b.v(c + side * w - up * h * .25))
        spine_t.append(b.v(c + up * h)); spine_b.append(b.v(c - up * h * .6))
    for i in range(len(prof) - 1):
        b.f([top_l[i], top_l[i + 1], spine_t[i + 1], spine_t[i]], region)
        b.f([spine_t[i], spine_t[i + 1], top_r[i + 1], top_r[i]], region)
        b.f([bot_l[i + 1], bot_l[i], spine_b[i], spine_b[i + 1]], region)
        b.f([spine_b[i + 1], spine_b[i], bot_r[i], bot_r[i + 1]], region)
        b.f([top_l[i + 1], top_l[i], bot_l[i], bot_l[i + 1]], region)
        b.f([top_r[i], top_r[i + 1], bot_r[i + 1], bot_r[i]], region)
    b.f([top_l[0], spine_t[0], top_r[0], bot_r[0], spine_b[0], bot_l[0]], region)


def build_body():
    b = Builder()
    loft_body(b)
    # Beak: short, sturdy seed-and-insect beak with a slight droop.
    cone(b, Vector((0, 0.112, 0.031)), Vector((0, 0.140, 0.027)), .0085, .0065, 8, 5, droop=.003)
    # Eyes with a pale ring.
    for s in (-1, 1):
        ball(b, Vector((s * 0.0205, 0.095, 0.041)), .0058, 7, seg=8, rings_n=4, squash=(.55, 1, 1))
        ball(b, Vector((s * 0.0232, 0.0955, 0.0412)), .0046, 6, seg=8, rings_n=4, squash=(.5, 1, 1))
    # Tail: six feathers fanned behind the rump, tipped slightly up.
    for i in range(6):
        a = math.radians(-26 + 52 * i / 5)
        d = Vector((math.sin(a), -math.cos(a), 0.10)).normalized()
        feather(b, Vector((math.sin(a) * .006, -0.066, 0.006 + .0012 * abs(i - 2.5))), d, Vector((math.cos(a), math.sin(a), 0)),
                0.082 - abs(i - 2.5) * .004, 0.022, 3, thick=.0022, curl=.04)
    # Legs and toes, curled round the carried bolt's shaft (axis along +Y through GRIP).
    shaft_r = 0.0105
    for s in (-1, 1):
        hip = Vector((s * 0.013, 0.012, -0.024)); ankle = Vector((s * 0.0105, 0.014, -0.045))
        tube(b, [hip, hip.lerp(ankle, .5) + Vector((s * .002, 0, 0)), ankle], .0042, .0028, 7, n=6)
        # three front toes wrap over the shaft from this side, one hind toe from the other
        # Three front toes reach forward-ish and curl down this side of the shaft (angle in the XZ
        # plane round the shaft axis: 90 deg = top, 0 = this side, negative = underneath).
        R = shaft_r + .0024
        for dy in (-0.010, 0.0, 0.010):
            pts = [ankle + Vector((0, dy * .4, -0.001))]
            for a in (78, 40, 0, -38):
                r = math.radians(a)
                pts.append(GRIP + Vector((s * math.cos(r) * R, dy, math.sin(r) * R)))
            tube(b, pts, .0022, .0012, 7, n=5)
        # Hind toe crosses over the top and grips the far side.
        pts = [ankle + Vector((0, -0.004, -0.001))]
        for a in (100, 135, 170):
            r = math.radians(a)
            pts.append(GRIP + Vector((s * math.cos(r) * R, -0.013, math.sin(r) * R)))
        tube(b, pts, .0019, .0011, 7, n=5)
    return b


def build_inner_wing(side):
    """Arm: covert plate and secondaries, built for the RIGHT side then mirrored. Pivot = shoulder."""
    b = Builder()
    sh = Vector((0, 0, 0))
    # Covert plate: rounded leading edge, 84 mm to the wrist.
    span = 0.084
    lead = lambda t: 0.020 - 0.008 * t
    trail = lambda t: -0.030 + 0.006 * t
    n = 7; top, bot = [], []
    for i in range(n + 1):
        t = i / n; x = span * t
        th = .0055 * (1 - .5 * t)
        for arr, z in ((top, th * .6), (bot, -th * .4)):
            arr.append((b.v((x, lead(t), z + .0012 * math.sin(math.pi * t))), b.v((x, (lead(t) + trail(t)) / 2, z * 1.4)), b.v((x, trail(t), z * .3))))
    for i in range(n):
        for j in range(2):
            b.f([top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]], 2)
            b.f([bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j]], 2)
        b.f([bot[i][0], bot[i + 1][0], top[i + 1][0], top[i][0]], 2)
        b.f([top[i][2], top[i + 1][2], bot[i + 1][2], bot[i][2]], 2)
    b.f([top[0][0], top[0][1], top[0][2], bot[0][2], bot[0][1], bot[0][0]], 2)
    # Secondaries: overlapping blades from under the plate's trailing edge.
    for i in range(6):
        t = (i + .5) / 6
        root = Vector((span * t, trail(t) + .010, -.0012 - .0004 * i))
        d = Vector((0.10 + .25 * t, -1, 0)).normalized()
        feather(b, root, d, Vector((1, .1 + .25 * t, 0)), 0.060 + .006 * t, .021, 3, thick=.0016, curl=-.03)
    return b, Vector((span, 0, 0))


def build_hand(side):
    """Hand and primaries; pivot = wrist (origin)."""
    b = Builder()
    # Small hand covert.
    n = 4; top, bot = [], []
    for i in range(n + 1):
        t = i / n; x = .045 * t
        lead, trail = .012 - .006 * t, -.024 + .010 * t
        for arr, z in ((top, .0035), (bot, -.0018)):
            arr.append((b.v((x, lead, z * (1 - .4 * t))), b.v((x, trail, z * .5 * (1 - .4 * t)))))
    for i in range(n):
        b.f([top[i][0], top[i + 1][0], top[i + 1][1], top[i][1]], 2)
        b.f([bot[i][1], bot[i + 1][1], bot[i + 1][0], bot[i][0]], 2)
        b.f([bot[i][0], bot[i + 1][0], top[i + 1][0], top[i][0]], 2)
        b.f([top[i][1], top[i + 1][1], bot[i + 1][1], bot[i][1]], 2)
    # Seven primaries fanning from straight out (leading) to swept back (inner).
    for i in range(7):
        a = math.radians(-6 - 62 * i / 6)
        d = Vector((math.cos(a), math.sin(a), 0)).normalized()
        root = Vector((.012 + .028 * (1 - i / 6), -.004 - .006 * i / 6, -.0008 * i))
        feather(b, root, d, Vector((-math.sin(a), math.cos(a), 0)), .100 - .006 * i, .018 - .0006 * i, 3, thick=.0015, curl=.03)
    return b


def palette_image(name, hexes):
    img = bpy.data.images.new(name, REGIONS, 1, alpha=False)
    px = []
    for h in hexes:
        r, g, bl = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        px += [r / 255, g / 255, bl / 255, 1.0]   # sRGB-encoded bytes, tagged sRGB below
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(px)
    img.pack()
    return img


def make_material():
    m = bpy.data.materials.new('SB_Plumage'); m.use_nodes = True
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = palette_image('SB_PlumagePalette', DEFAULT_PALETTE)
    tex.interpolation = 'Closest'
    nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = .62
    p.inputs['Metallic'].default_value = 0
    p.inputs['Sheen Weight'].default_value = 0
    return m


def obj(name, me, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if parent:
        o.parent = parent
    o.location = loc
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = make_material()
    root = obj('Songbird', None)
    # Body (origin at the root; the root sits at the grip centre so the bolt hangs naturally).
    body_b = build_body()
    body = obj('SongbirdBody', body_b.mesh('SongbirdBody', GRIP), root); body.data.materials.append(mat)
    report = {'triangles': {}, 'nodes': {}}
    shoulder = Vector((0.030, 0.026, 0.030))
    for side, name in ((1, 'R'), (-1, 'L')):
        wb, wrist = build_inner_wing(side)
        me = wb.mesh('SongbirdWing' + name)
        if side < 0:
            me.transform(Matrix.Scale(-1, 4, (1, 0, 0))); me.flip_normals()
        wing = obj('SongbirdWing' + name, me, root, tuple((Vector((shoulder.x * side, shoulder.y, shoulder.z)) - GRIP)))
        wing.data.materials.append(mat)
        hb = build_hand(side); hm = hb.mesh('SongbirdWing' + name + '_Tip')
        if side < 0:
            hm.transform(Matrix.Scale(-1, 4, (1, 0, 0))); hm.flip_normals()
        tip = obj('SongbirdWing' + name + '_Tip', hm, wing, (wrist.x * side, wrist.y, wrist.z)); tip.data.materials.append(mat)
    talons = obj('SongbirdTalons', None, root, (0, 0, 0))
    talons.empty_display_size = .02
    bpy.context.view_layer.update()
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            t = sum(len(p.vertices) - 2 for p in o.data.polygons)
            report['triangles'][o.name] = t; tris += t
        report['nodes'][o.name] = [round(v, 4) for v in o.matrix_world.translation]
    report['triangles']['total'] = tris
    dims = [Vector(c) for o in bpy.context.scene.objects if o.type == 'MESH' for c in [o.matrix_world @ Vector(v) for v in o.bound_box]]
    lo = Vector((min(v.x for v in dims), min(v.y for v in dims), min(v.z for v in dims)))
    hi = Vector((max(v.x for v in dims), max(v.y for v in dims), max(v.z for v in dims)))
    report['bounds_blender'] = {'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi]}
    report['palette_regions'] = ['back', 'breast', 'coverts', 'flight', 'throat', 'beak', 'eye', 'legs']
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False,
                              export_materials='EXPORT', export_image_format='AUTO', export_animations=False,
                              export_cameras=False, export_lights=False, export_extras=False)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '.blend', compress=True)
    report['glb_bytes'] = os.path.getsize(OUT)
    print('SONGBIRD_REPORT ' + json.dumps(report))


main()
