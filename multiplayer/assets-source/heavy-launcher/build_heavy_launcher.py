"""Heavy Launcher: one model for the game and for a working 3D-printed catapult.

Run:  python3 build_heavy_launcher.py [--render] [--concept]      (needs the `bpy` module, Blender 4.5+)

Everything is authored at PRINT scale in millimetres. The game model is the same meshes scaled by
GAME_SCALE (1 mm -> 16 mm), so what you print is exactly what stands in the world.

Mechanism (all printed, no hardware):
  * Two spiral MAINSPRINGS (one per side) drive the throwing arm. Each spring is printed as one
    cassette: a brass-look ring, the spiral strip and a D-bored hub keyed to the axle.
  * The ring's two pegs plug into a 12-hole POWER DIAL on the cheek. Turning the ring one hole
    further before plugging it in adds 30 degrees of preload, so power is tunable and the spring
    can be relaxed for storage.
  * A D-shaft AXLE keys arm and both spring hubs together; its head and split snap end hold the
    stack together.
  * The arm is cocked by the COCKING YOKE: a free lever on the same axle. Lift its front handle and
    its finger bar presses the arm down until the nose clicks under the SEAR, a flexure latch printed
    in the base. Let go and the yoke drops back onto its BUFFER leaf (also a flexure).
  * Pull the sear's tail back to loose: the arm whips up 85 degrees and slams into the yoke's
    finger bar, which passes the blow down the handle into the buffer leaf.

Frames: Blender X right, Y forward (the shot flies +Y), Z up; glTF export turns +Y into -Z, the
game's forward. Arm angle psi: 0 = arm pointing straight back, positive = tip rising.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))          # multiplayer/
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.join(HERE, 'out'); PRINT = os.path.join(HERE, 'print'); RENDERS = os.path.join(HERE, 'renders')
for d in (OUT, PRINT, RENDERS): os.makedirs(d, exist_ok=True)

TAU = math.tau; D2R = math.pi / 180
GAME_SCALE = 16 / 1000          # mm -> game metres
H = 81.25                       # axle height (game: 1.30 m, the old launch height)
PSI_COCK, PSI_STOP = -35 * D2R, 50 * D2R
SWING = PSI_STOP - PSI_COCK

# ---------------------------------------------------------------- dimensions (mm)
AXLE_R, AXLE_FLAT = 4.0, 3.0            # D-shaft: radius 4, flat 3 mm from centre
FIT = 0.15                              # sliding clearance per side
BORE_R = AXLE_R + 0.25                  # round running bores
ARM_HALF = 7.0                          # arm hub half width
YOKE_IN, YOKE_OUT = 7.6, 11.4           # yoke plate x span
CHEEK_IN, CHEEK_OUT = 12.0, 19.0
DIAL_T = 0.8                            # brass dial plate on the cheek face
RING_IN_X, RING_OUT_X = 20.2, 33.6      # cassette ring x span
SPRING_X0 = 21.6                        # spiral strip from here to RING_OUT_X (b = 12)
HUB_R, SPR_R0, SPR_R1, RING_R0, RING_R1 = 7.0, 7.6, 19.4, 20.0, 23.6
SPR_T, SPR_PITCH = 1.8, 3.4             # strip thickness, coil pitch (1.6 mm gaps)
DIAL_R, PEG_R, DIAL_N = 21.8, 1.5, 12   # peg circle; 12 holes = 30 degree steps
ARM_UNDER = -7.0                        # flat underside of the arm (print bed)
CUP_R = 100.0                           # bowl centre radius
BALL_R = 9.5
BOWL_R = 10.2
NOSE = (111.0, 118.5)                   # catch nose radial span
FINGER_R, FINGER_BAR = 62.0, 3.2        # yoke finger bar radius and bar radius
HANDLE_R = 72.0
E_PLA = 3500.0                          # N/mm^2 (MPa). Printed in PLA (Mitch's call): stiff, but creeps,
                                        # so springs stay under ~1.1% strain and are only wound while in use.

# ---------------------------------------------------------------- scene / materials
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

MAT_DEF = {
    'Walnut':   dict(c='4b2c19', m=0.0, r=0.42),
    'Heartwood':dict(c='6d391c', m=0.0, r=0.45),
    'Iron':     dict(c='6a6c73', m=0.55, r=0.45),   # half-metal so it reads on phones without reflections
    'Brass':    dict(c='c99a45', m=1.0, r=0.3),
    'Steel':    dict(c='34507a', m=1.0, r=0.3),     # blued spring steel
    'Stone':    dict(c='8d887e', m=0.0, r=0.9),
    'Crystal':  dict(c='7cc4ff', m=0.0, r=0.06, e='2f8fff', es=1.4),
}
MATS = {}
def mats():
    for n, d in MAT_DEF.items():
        m = bpy.data.materials.new(n); m.use_nodes = True
        p = m.node_tree.nodes['Principled BSDF']
        c = [int(d['c'][i:i + 2], 16) / 255 for i in (0, 2, 4)]
        p.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
        p.inputs['Metallic'].default_value = d['m']; p.inputs['Roughness'].default_value = d['r']
        if 'e' in d:
            e = [int(d['e'][i:i + 2], 16) / 255 for i in (0, 2, 4)]
            p.inputs['Emission Color'].default_value = (*[x ** 2.2 for x in e], 1)
            p.inputs['Emission Strength'].default_value = d['es']
        MATS[n] = m

# ---------------------------------------------------------------- mesh helpers
def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    if mat: me.materials.append(MATS[mat])
    return ob

def _place(axis, u, v, w):
    """Map polygon coords (u, v) + extrusion w into xyz for an extrusion along `axis`."""
    if axis == 'x': return (w, u, v)
    if axis == 'y': return (u, w, v)
    return (u, v, w)

def prism(poly, axis, w0, w1, mat, name='p'):
    """Extrude a CCW 2-D polygon (in the two other axes, in order y,z / x,z / x,y) from w0 to w1."""
    bm = bmesh.new()
    a = [bm.verts.new(_place(axis, u, v, w0)) for u, v in poly]
    b = [bm.verts.new(_place(axis, u, v, w1)) for u, v in poly]
    n = len(poly)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, mat)

def ngon(cx, cy, r, n, rot=0.0):
    return [(cx + r * math.cos(rot + TAU * i / n), cy + r * math.sin(rot + TAU * i / n)) for i in range(n)]

def cyl(axis, c, r, w0, w1, mat, n=24, rot=0.0, name='c'):
    return prism(ngon(c[0], c[1], r, n, rot), axis, w0, w1, mat, name)

def chamfer_poly(poly, k):
    """Cut each corner of a convex/concave polygon by distance k (angular chamfer)."""
    out = []
    n = len(poly)
    for i in range(n):
        p = Vector(poly[i]); a = Vector(poly[i - 1]); b = Vector(poly[(i + 1) % n])
        da = (a - p); db = (b - p)
        ka = min(k, da.length * 0.45); kb = min(k, db.length * 0.45)
        out.append(tuple(p + da.normalized() * ka)); out.append(tuple(p + db.normalized() * kb))
    return out

def box(x0, x1, y0, y1, z0, z1, mat, ch=0.0, name='b'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    if ch > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=ch, segments=1, affect='EDGES', profile=0.5)
    return obj_from_bm(bm, name, mat)

def sphere(c, r, mat, sub=3, name='s'):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    return obj_from_bm(bm, name, mat)

def xform(ob, M):
    ob.data.transform(M); ob.data.update(); return ob

def mirror_x(ob):
    xform(ob, Matrix.Scale(-1, 4, (1, 0, 0)))
    ob.data.flip_normals(); return ob

def copy(ob, name=None):
    c = ob.copy(); c.data = ob.data.copy(); c.name = name or ob.name + '.c'
    bpy.context.scene.collection.objects.link(c); return c

def kill(obs):
    for o in obs:
        if o and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)

def boolean(target, others, op):
    """Apply one boolean (UNION / DIFFERENCE / INTERSECT) of `others` into target, materials kept."""
    if not others: return target
    col = bpy.data.collections.new('ops'); bpy.context.scene.collection.children.link(col)
    for o in others:
        for c in o.users_collection: c.objects.unlink(o)
        col.objects.link(o)
    m = target.modifiers.new('bool', 'BOOLEAN'); m.operation = op; m.operand_type = 'COLLECTION'
    m.collection = col; m.solver = 'EXACT'; m.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(target.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    target.modifiers.clear(); old = target.data; target.data = me; bpy.data.meshes.remove(old)
    kill(list(col.objects)); bpy.data.collections.remove(col)
    return target

def solid(name, adds, subs=()):
    base = adds[0]; base.name = name
    boolean(base, list(adds[1:]), 'UNION')
    boolean(base, list(subs), 'DIFFERENCE')
    clean(base); return base

def clean(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def teardrop(axis, c, r, w0, w1, n=20, up=True):
    """Horizontal hole that prints without support: circle with a 45-degree peak on top."""
    pts = [(c[0] + r * math.cos(a), c[1] + r * math.sin(a)) for a in [math.pi / 4 - (1.5 * math.pi) * i / n for i in range(n + 1)]]
    k = r * 1.18                                   # peak truncated flat (prints as a short bridge)
    pts.append((c[0] - (r * math.sqrt(2) - k), c[1] + k)); pts.append((c[0] + (r * math.sqrt(2) - k), c[1] + k))
    poly = pts
    # ensure CCW
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if s < 0: poly = poly[::-1]
    return prism(poly, axis, w0, w1, None, 'td')

def d_bore(axis, w0, w1, rot=0.0, n=28):
    """D-shaped bore matching the axle (flat at -Z in the part's local frame, rotated by rot)."""
    r = AXLE_R + FIT; f = AXLE_FLAT + FIT
    pts = []
    for i in range(n):
        a = TAU * i / n
        x, y = r * math.cos(a), r * math.sin(a)
        if y < -f: y = -f
        if not pts or (abs(pts[-1][0] - x) > 1e-6 or abs(pts[-1][1] - y) > 1e-6): pts.append((x, y))
    c, s = math.cos(rot), math.sin(rot)
    return prism([(x * c - y * s, x * s + y * c) for x, y in pts], axis, w0, w1, None, 'dbore')

def ccw(poly):
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if s > 0 else poly[::-1]

def arm_dir(psi):           # (y, z) unit vector from axle along the arm
    return (-math.cos(psi), math.sin(psi))
def arm_tan(psi):           # direction the arm tip moves as psi increases
    return (math.sin(psi), math.cos(psi))
def rot_yz(p, psi):         # rotate a (y, z) point given in the psi=0 frame to angle psi
    y, z = p; c, s = math.cos(psi), math.sin(psi)
    return (y * c + z * s, -y * s + z * c)        # = rotation by -psi about +X

# ---------------------------------------------------------------- arm (psi = 0 pose, axle at origin)
def arm_top(r):             # top surface height along the arm
    t = min(1, max(0, (r - 9) / 80)); return 9.0 - 4.0 * t
def arm_half_w(r):
    t = min(1, max(0, (r - 9) / 80)); return 6.5 - 1.7 * t

CUP_TILT = 15 * D2R          # bowl axis leans toward the hub so a loaded stone stays put when cocked
CUP_AX = Vector((0, math.sin(CUP_TILT), math.cos(CUP_TILT)))
BOWL_C = Vector((0, -CUP_R, ARM_UNDER + 2.6 + BOWL_R)) + CUP_AX * 0.0
BALL_C = BOWL_C - CUP_AX * (BOWL_R - BALL_R)

def cut_copy(lift=3.0):
    """Half-space above the bowl's rim plane (square to the tilted bowl axis)."""
    cut = box(-40, 40, -CUP_R - 40, -CUP_R + 40, 0, 40, None, 0, 'podcut')
    xform(cut, Matrix.Translation(BOWL_C + CUP_AX * lift) @ Matrix.Rotation(CUP_TILT, 4, 'X'))
    return cut

def build_arm():
    adds, subs = [], []
    # beam: side profile (y, z) flat underside, tapering top; extruded in x with tapering width done by
    # two plan-view cuts (angled side planes) -> keep it faceted: build as a loft of sections
    bm = bmesh.new(); secs = []
    rs = [6, 20, 40, 60, 80, 92]
    for r in rs:
        w = arm_half_w(r); t = arm_top(r); k = 1.4
        sec = [(-w, ARM_UNDER), (w, ARM_UNDER), (w, t - k), (w - k, t), (-w + k, t), (-w, t - k)]
        secs.append([bm.verts.new((x, -r, z)) for x, z in sec])
    bm.faces.new(secs[0][::-1]); bm.faces.new(secs[-1])
    for a, b in zip(secs, secs[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    adds.append(obj_from_bm(bm, 'beam', 'Walnut'))
    # hub: octagon with a flat underside on the print bed
    hub = ccw([(y, max(ARM_UNDER, z)) for y, z in ngon(0, 1.0, 10.2, 8, math.pi / 8)])
    adds.append(prism(hub, 'x', -ARM_HALF, ARM_HALF, 'Walnut', 'hub'))
    # iron cheek plates on the hub (raised 0.6 mm), and two iron bands along the beam
    adds.append(prism(ccw([(y, max(ARM_UNDER, z)) for y, z in ngon(0, 1.0, 8.4, 8, math.pi / 8)]), 'x', -ARM_HALF - 0.3, ARM_HALF + 0.3, 'Iron', 'hubplate'))
    for r in (34, 70):
        w = arm_half_w(r) + 0.6; t = arm_top(r) + 0.6
        adds.append(box(-w, w, -r - 3, -r + 3, ARM_UNDER, t, 'Iron', 0.5, 'band'))
    # brass inlay strips down both sides of the beam (0.3 mm proud; clears the lever plates)
    for sx in (-1, 1):
        for r0, r1 in ((14, 31), (37, 67), (73, 86)):
            q = ccw([(-r0, ARM_UNDER + 2.2), (-r1, ARM_UNDER + 2.2), (-r1, arm_top(r1) - 2.2), (-r0, arm_top(r0) - 2.2)])
            w = arm_half_w(r0)
            x0, x1 = sorted((sx * (arm_half_w(r1) - 0.4), sx * (w + 0.3)))
            adds.append(prism(q, 'x', x0, x1, 'Brass', 'inlay'))
    # cup pod: octagonal, flat bottom on the bed, top cut square to the tilted bowl axis
    pod = prism(ccw(ngon(0, -CUP_R, 13.0, 8, math.pi / 8)), 'z', ARM_UNDER, 22, 'Iron', 'pod')
    boolean(pod, [cut_copy()], 'DIFFERENCE')
    adds.append(pod)
    for i in range(4):                  # four iron tines up the pod's corners hold the bowl like a claw
        a = math.pi / 4 + i * math.pi / 2
        c = (13.4 * math.cos(a), -CUP_R + 13.4 * math.sin(a))
        tine = prism(ccw(ngon(c[0], c[1], 1.9, 6, a)), 'z', ARM_UNDER, 17, 'Iron', 'tine')
        boolean(tine, [cut_copy()], 'DIFFERENCE')
        adds.append(tine)
    rim = prism(ccw(ngon(0, 0, 13.6, 8, math.pi / 8)), 'z', -1.6, 0, 'Brass', 'rim')
    boolean(rim, [cyl('z', (0, 0), BOWL_R + 0.6, -5, 5, None, 32)], 'DIFFERENCE')
    xform(rim, Matrix.Translation(BOWL_C + CUP_AX * 3.0) @ Matrix.Rotation(CUP_TILT, 4, 'X'))
    adds.append(rim)
    # catch nose past the cup: the sear hooks over its top face
    nose = ccw([(-NOSE[1], ARM_UNDER), (-NOSE[0] + 4, ARM_UNDER), (-NOSE[0] + 4, ARM_UNDER + 3.4), (-NOSE[1] + 1.0, ARM_UNDER + 3.4), (-NOSE[1], ARM_UNDER + 2.4)])
    adds.append(prism(nose, 'x', -4.5, 4.5, 'Steel', 'nose'))
    subs.append(sphere(BOWL_C, BOWL_R, None, 3, 'bowl'))
    subs.append(d_bore('x', -20, 20, math.pi))
    return solid('Arm', adds, subs)

# ---------------------------------------------------------------- cocking yoke (psi_f = 0 pose)
def finger_rest():
    """Yoke angle at rest: its finger bar just touches the arm's top at PSI_STOP."""
    top = arm_top(FINGER_R)
    return PSI_STOP + math.atan2(top + FINGER_BAR + 0.2, FINGER_R)

YOKE_Z0, YOKE_Z1 = -7.0, 7.0     # plate depth (print height 12 mm; bed at YOKE_Z0)
def build_yoke():
    """Lever frame lying in its own print plane: finger bar at -y (over the arm), handle at +y."""
    adds, subs = [], []
    for sx in (-1, 1):
        x0, x1 = sorted((sx * YOKE_IN, sx * YOKE_OUT))
        plate = ccw(chamfer_poly([(-FINGER_R - 4, -4.5), (-14, -6), (14, -6), (HANDLE_R + 4, -4.5),
                                  (HANDLE_R + 4, 4.5), (14, 6), (-14, 6), (-FINGER_R - 4, 4.5)], 1.2))
        # plates lie flat (depth in z): polygon in (y, z) extruded along x
        adds.append(prism([(y, z) for y, z in plate], 'x', x0, x1, 'Heartwood', 'plate'))
        adds.append(prism(ccw(ngon(0, 0, 10.5, 8, math.pi / 8)), 'x', x0, x1, 'Iron', 'boss'))
    # finger bar (octagonal) across the arm, and the handle grip
    adds.append(prism(ccw(ngon(-FINGER_R, 0, FINGER_BAR, 8, math.pi / 8)), 'x', -YOKE_OUT, YOKE_OUT, 'Steel', 'finger'))
    adds.append(prism(ccw(ngon(HANDLE_R, 0, 5.0, 8, math.pi / 8)), 'x', -YOKE_OUT - 1.5, YOKE_OUT + 1.5, 'Brass', 'grip'))
    # flatten everything to the print bed / top plane (boss and grip clipped to plate depth)
    clip = box(-40, 40, -120, 120, YOKE_Z0, YOKE_Z1, None, 0, 'clip')
    yoke = solid('Yoke', adds, [teardrop('x', (0, 0), BORE_R, -20, 20)])
    boolean(yoke, [clip], 'INTERSECT')
    # crystal set in the grip (game: glowing, print: a gem-cut boss)
    gem = sphere((0, HANDLE_R, YOKE_Z1), 2.6, 'Crystal', 1, 'gem')
    boolean(gem, [box(-9, 9, HANDLE_R - 9, HANDLE_R + 9, YOKE_Z1 - 9, YOKE_Z1, None)], 'DIFFERENCE')
    boolean(yoke, [gem], 'UNION'); clean(yoke)
    return yoke

# ---------------------------------------------------------------- spring cassette (right side, in place)
SPR_TURNS = (SPR_R1 - SPR_R0) / SPR_PITCH
def spiral_poly(seg_per_turn=72):
    """Strip outline in the (y, z) plane. The coil runs CLOCKWISE seen from +X, so the arm cocking
    (hub turning +X) wraps strip onto the hub and winds the spring."""
    n = max(8, int(SPR_TURNS * seg_per_turn)); outer, inner = [], []
    for i in range(n + 1):
        phi = SPR_TURNS * TAU * i / n; r = SPR_R0 + SPR_PITCH * phi / TAU
        a = -phi
        outer.append(((r + SPR_T / 2) * math.cos(a), (r + SPR_T / 2) * math.sin(a)))
        inner.append(((r - SPR_T / 2) * math.cos(a), (r - SPR_T / 2) * math.sin(a)))
    return ccw(outer + inner[::-1])

def spring_length():
    n = 2000; L = 0; prev = None
    for i in range(n + 1):
        phi = SPR_TURNS * TAU * i / n; r = SPR_R0 + SPR_PITCH * phi / TAU
        p = Vector((r * math.cos(phi), r * math.sin(phi)))
        if prev: L += (p - prev).length
        prev = p
    return L

PEG_ANGLES = (math.pi / 2, -math.pi / 2)
# The arm's D-flat faces its own +Z (prints as a short flat bridge). At the stop angle that flat points
# along world angle 90 - PSI_STOP in the (y, z) plane; the relaxed cassette's hub is cut to match, so
# with zero preload its pegs sit on dial holes. Each hole the ring is turned back adds 30 degrees.
CASSETTE_FLAT = math.pi / 2 - PSI_STOP
PRELOAD_HOLES = 3
def build_cassette():
    adds = []
    adds.append(prism(spiral_poly(), 'x', SPRING_X0, RING_OUT_X, 'Steel', 'spiral'))
    ring = prism(ccw(ngon(0, 0, RING_R1, 24, 0)), 'x', RING_IN_X, RING_OUT_X, 'Brass', 'ring')
    boolean(ring, [cyl('x', (0, 0), RING_R0, RING_IN_X - 1, RING_OUT_X + 1, None, 48)], 'DIFFERENCE')
    adds.append(ring)
    # grip ribs on the ring so you can turn it against the spring by hand
    for i in range(12):
        a = TAU * (i + 0.5) / 12
        rib = box(-1.2, 1.2, RING_R1 - 0.6, RING_R1 + 1.4, -1.0, 1.0, 'Brass', 0, 'rib')
        xform(rib, Matrix.Rotation(a, 4, 'X') @ Matrix.Translation((0, 0, 0)))
        # rib spans the outer half of the ring width
        for v in rib.data.vertices: v.co.x = RING_OUT_X - 6 if v.co.x < 0 else RING_OUT_X
        adds.append(rib)
    for a in PEG_ANGLES:
        c = (DIAL_R * math.cos(a), DIAL_R * math.sin(a))
        adds.append(cyl('x', c, PEG_R, CHEEK_OUT - 3.6, RING_IN_X + 0.5, 'Brass', 12, 0, 'peg'))
        adds.append(cyl('x', c, PEG_R + 0.25, CHEEK_OUT - 3.6, CHEEK_OUT - 3.0, 'Brass', 12, 0, 'pegbarb'))
    adds.append(cyl('x', (0, 0), HUB_R, SPRING_X0, RING_OUT_X, 'Brass', 24, 0, 'hub'))
    adds.append(cyl('x', (0, 0), 5.6, CHEEK_OUT + DIAL_T + 0.25, SPRING_X0 + 0.5, 'Brass', 24, 0, 'collar'))
    return solid('Cassette_R', adds, [d_bore('x', 0, 60, CASSETTE_FLAT + math.pi / 2)])

def build_axle():
    adds = [prism(ccw([(y, z) for y, z in ngon(0, 0, AXLE_R, 32)]), 'x', -RING_OUT_X - 0.3, RING_OUT_X + 3.9, 'Steel', 'shaft')]
    adds.append(prism(ccw(ngon(0, 0, 7.6, 8, math.pi / 8)), 'x', -RING_OUT_X - 4.3, -RING_OUT_X - 0.25, 'Brass', 'head'))
    adds.append(cyl('x', (0, 0), AXLE_R + 0.4, RING_OUT_X + 0.35, RING_OUT_X + 2.6, 'Steel', 24, 0, 'barb'))
    cone = cyl('x', (0, 0), AXLE_R + 0.4, RING_OUT_X + 2.6, RING_OUT_X + 4.6, 'Steel', 24, 0, 'barbcone')
    for v in cone.data.vertices:
        if v.co.x > RING_OUT_X + 3: v.co.y *= 0.82; v.co.z *= 0.82
    cone.data.update(); adds.append(cone)
    gem = prism(ccw(ngon(0, 0, 5.2, 8, math.pi / 8)), 'x', -RING_OUT_X - 6.3, -RING_OUT_X - 4.2, 'Crystal', 'gem')
    for v in gem.data.vertices:
        if v.co.x < -RING_OUT_X - 5: v.co.y *= 0.45; v.co.z *= 0.45
    gem.data.update(); adds.append(gem)
    flat = box(-60, 60, -20, 20, -20, -AXLE_FLAT, None)                     # D flat (also the print bed)
    slot = box(RING_OUT_X - 2.5, RING_OUT_X + 9, -0.8, 0.8, -20, 20, None)  # split snap end
    return solid('Axle', adds, [flat, slot])

def build_ball():
    b = sphere((0, 0, 0), BALL_R, 'Stone', 2, 'Ball')
    rng = [0.0]
    for i, v in enumerate(b.data.vertices):     # a little hand-knapped irregularity, deterministic
        k = 1 + 0.025 * math.sin(i * 12.9898) * math.cos(i * 78.233)
        v.co *= k
    boolean(b, [box(-20, 20, -20, 20, -30, -BALL_R + 0.8, None)], 'DIFFERENCE')
    b.name = 'Ball'; return b

# ---------------------------------------------------------------- base (world frame, ground z = 0)
def cocked(p):              # arm-frame (y, z) -> world (y, z) at the cocked angle
    y, z = rot_yz(p, PSI_COCK); return (y, z + H)

BASE_T = 7.0
Y_FRONT0, Y_FRONT1 = 28.0, 44.0
Y_REAR0, Y_REAR1 = -138.0, -128.0
SEAR_X0, SEAR_T = 5.2, 1.5
def handle_rest():
    y, z = rot_yz((HANDLE_R, 0), finger_rest()); return (y, z + H)

def build_sear():
    """Flexure latch: a leaf standing on edge, rooted in the rear beam, free end hooks over the nose.
    Flick the trigger tab outward (+X) and the hook slides off the nose."""
    adds = []
    # hook: in the cocked arm frame it sits on the nose top, over its outer 3.2 mm
    top = ARM_UNDER + 3.4
    hook_arm = [(-NOSE[1] - 0.6, top), (-NOSE[1] + 3.6, top), (-NOSE[1] + 3.6, top + 2.2), (-NOSE[1] + 1.0, top + 4.2), (-NOSE[1] - 0.6, top + 4.2)]
    hook = ccw([cocked(p) for p in hook_arm])
    hy = [p[0] for p in hook]; hz = [p[1] for p in hook]
    h = prism(hook, 'x', 1.4, SEAR_X0 + SEAR_T, 'Steel', 'hook')
    # ramp: the top inner edge is bevelled so the descending nose pushes the hook aside
    ramp = box(-1, SEAR_X0 - 0.2, min(hy) - 5, max(hy) + 5, 0, 40, None)
    xform(ramp, Matrix.Translation((1.4, 0, max(hz) - 1.2)) @ Matrix.Rotation(-40 * D2R, 4, 'Y') @ Matrix.Translation((-1.4, 0, 0)))
    boolean(h, [ramp], 'DIFFERENCE')
    adds.append(h)
    y_end = max(hy) + 0.5
    leaf = box(SEAR_X0, SEAR_X0 + SEAR_T, Y_REAR1 - 1, y_end, 0, max(hz), 'Steel', 0, 'leaf')
    adds.append(leaf)
    # trigger: an L arm along the bed out past the cup's sweep, ending in an upright tab
    adds.append(box(SEAR_X0, 24.0, y_end - 6, y_end, 0, 4.0, 'Steel', 0.4, 'L'))
    adds.append(box(21.0, 24.0, y_end - 6, y_end, 0, 15.0, 'Brass', 0.6, 'tab'))
    return solid('Sear', adds)

def build_buffer():
    """Pointed-arch flexure on the front beam; the yoke's grip lands on its apex."""
    gy, gz = handle_rest(); apex = gz - 5.0 * math.cos(math.pi / 8) - 0.1
    t = 2.0; legs = []
    for s in (-1, 1):
        foot = (s * 8.5, BASE_T - 0.5); top = (0.0, apex)
        d = Vector((top[0] - foot[0], top[1] - foot[1])).normalized(); nrm = Vector((-d.y, d.x)) * (t / 2)
        q = [Vector(foot) - nrm, Vector(foot) + nrm, Vector(top) + nrm, Vector(top) - nrm]
        legs.append(prism(ccw([(v.x, v.y) for v in q]), 'y', gy - 5, gy + 5, 'Steel', 'leg'))
    pad = prism(ccw([(-3, apex - 1.6), (3, apex - 1.6), (2, apex), (-2, apex)]), 'y', gy - 5, gy + 5, 'Steel', 'pad')
    return solid('Buffer', legs + [pad])

def build_base():
    adds, subs = [], []
    W = 48.0
    adds.append(box(-W, W, Y_FRONT0, Y_FRONT1, 0, BASE_T, 'Iron', 1.2, 'front'))
    adds.append(box(-W, W, Y_REAR0, Y_REAR1, 0, BASE_T, 'Iron', 1.2, 'rear'))
    for sx in (-1, 1):
        for y0, y1 in ((Y_REAR0 - 0.6, Y_REAR1 + 0.6), (Y_FRONT0 - 0.6, Y_FRONT1 + 0.6)):
            x0, x1 = sorted((sx * (W - 7.6), sx * (W + 0.6)))
            adds.append(box(x0, x1, y0, y1, 0, BASE_T + 0.6, 'Brass', 0.8, 'cap'))
    for s in (-1, 1):
        x0, x1 = sorted((s * (W - 7), s * W))
        adds.append(box(x0, x1, Y_REAR0, Y_FRONT1, 0, BASE_T - 1, 'Walnut', 1.0, 'outer'))
        x0, x1 = sorted((s * CHEEK_IN, s * CHEEK_OUT))
        adds.append(box(x0, x1, -56, Y_FRONT1, 0, BASE_T, 'Walnut', 1.0, 'inner'))
        # diagonal brace: inner rail's rear end -> outer rail
        a = Vector((s * (CHEEK_IN + CHEEK_OUT) / 2, -52)); b = Vector((s * (W - 3.5), -100))
        d = (b - a).normalized(); nrm = Vector((-d.y, d.x)) * 3.5
        q = [a - nrm, a + nrm, b + nrm, b - nrm]
        adds.append(prism(ccw([(v.x, v.y) for v in q]), 'z', 0, BASE_T - 1, 'Walnut', 'brace'))
        # cheek: A-frame plate with a 12-sided dial boss round the axle
        boss = ngon(0, H, 27.0, 12, math.pi / 12)
        rear_leg = [(-60, 0), (-40, 0), (-6, H - 12), (-14, H + 4)]
        front_leg = [(14, 0), (34, 0), (12, H + 4), (4, H - 12)]
        tie = [(-60, 0), (34, 0), (34, BASE_T + 4), (-60, BASE_T + 4)]
        for poly, nm in ((boss, 'boss'), (rear_leg, 'rleg'), (front_leg, 'fleg'), (tie, 'tie')):
            adds.append(prism(ccw(chamfer_poly(poly, 2.0)), 'x', x0, x1, 'Walnut', nm))
        # iron shoes on the cheek feet and brass rivets down both legs
        xo = s * CHEEK_OUT
        for y0, y1 in ((-62, -38), (12, 36)):
            adds.append(box(*sorted((xo - s * 0.5, xo + s * 0.6)), y0, y1, 0, 11.5, 'Iron', 0.4, 'shoe'))
        for (ya, za), (yb, zb) in (((-50, 4), (-10, H - 8)), ((24, 4), (8, H - 8))):
            for k in range(1, 4):
                t = k / 4.0; y = ya + (yb - ya) * t; z = za + (zb - za) * t
                if math.hypot(y, z - H) < 29: continue
                adds.append(prism(ccw(ngon(y, z, 1.3, 8)), 'x', *sorted((xo - s * 0.2, xo + s * 0.7)), 'Brass', 'rivet'))
        # brass dial plate with its twelve peg holes
        xo = s * CHEEK_OUT
        dp = prism(ccw(ngon(0, H, 25.5, 12, math.pi / 12)), 'x', *sorted((xo, xo + s * 0.8)), 'Brass', 'dial')
        adds.append(dp)
        adds.append(prism(ccw(ngon(0, H, 15.0, 12, math.pi / 12)), 'x', *sorted((s * (CHEEK_IN - 0.35), s * CHEEK_IN)), 'Iron', 'wash'))
        for i in range(DIAL_N):
            a = TAU * i / DIAL_N
            subs.append(teardrop('x', (DIAL_R * math.cos(a), H + DIAL_R * math.sin(a)), PEG_R + 0.18, *sorted((s * (CHEEK_OUT - 5), s * (CHEEK_OUT + 2)))))
        subs.append(teardrop('x', (0, H), BORE_R, *sorted((s * (CHEEK_IN - 2), s * (CHEEK_OUT + 2)))))
    base = solid('Base', adds, subs)
    return base

# ---------------------------------------------------------------- assembly
def node(ob, loc=(0, 0, 0), rx=0.0, parent=None):
    ob.location = loc; ob.rotation_euler = (rx, 0, 0)
    if parent: ob.parent = parent
    return ob

def assemble():
    P = {}
    P['Base'] = build_base(); P['Sear'] = build_sear(); P['Buffer'] = build_buffer()
    P['Arm'] = node(build_arm(), (0, 0, H))
    ax = build_axle(); xform(ax, Matrix.Rotation(math.pi, 4, 'X')); P['Axle'] = node(ax, (0, 0, 0), 0, P['Arm'])
    P['Ball'] = node(build_ball(), tuple(BALL_C), 0, P['Arm'])
    P['Yoke'] = node(build_yoke(), (0, 0, H))
    cr = build_cassette(); cl = mirror_x(copy(cr, 'Cassette_L'))
    P['Cassette_R'] = node(cr, (0, 0, H)); P['Cassette_L'] = node(cl, (0, 0, H))
    return P

def pose(P, psi, yoke=None, ball=True):
    P['Arm'].rotation_euler.x = -psi
    P['Yoke'].rotation_euler.x = -(finger_rest() if yoke is None else yoke)
    P['Ball'].hide_viewport = not ball; P['Ball'].hide_render = not ball

def bvh(ob, dg):
    e = ob.evaluated_get(dg); M = ob.matrix_world
    verts = [M @ v.co for v in e.data.vertices]; polys = [tuple(p.vertices) for p in e.data.polygons]
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)

def sweep(P, steps=48):
    """Drive the real mechanism through cock + fire and look for any part passing through another.
    Contacts that ARE the mechanism are allowed only where they belong: finger bar on the arm (yoke
    driving / stopping the arm), the sear hook riding over the nose near the cocked angle, the grip
    on the buffer at rest."""
    fixed = ['Base', 'Sear', 'Buffer', 'Cassette_R', 'Cassette_L']
    moving = ['Arm', 'Axle', 'Ball', 'Yoke']
    rep = dict(states=0, hits=[], contacts={})
    off = finger_rest() - PSI_STOP
    def check(psi, yoke, phase):
        pose(P, psi, yoke)
        dg = bpy.context.evaluated_depsgraph_get(); dg.update()
        T = {n: bvh(P[n], dg) for n in fixed + moving}
        pairs = [(a, b) for a in moving for b in fixed] + [('Arm', 'Yoke'), ('Ball', 'Yoke'), ('Axle', 'Yoke'), ('Cassette_R', 'Base'), ('Cassette_L', 'Base'), ('Axle', 'Base')]
        for a, b in pairs:
            hits = T[a].overlap(T[b])
            if not hits: continue
            key = '%s/%s' % (a, b)
            if a.startswith('Cassette'):        # only the peg barbs may bite into the dial holes (snap fit)
                me, M = P[a].data, P[a].matrix_world
                tips = all(abs((M @ me.polygons[i].center).x) < CHEEK_OUT - 2.4 for i, _ in hits)
                if tips: rep['contacts']['peg-barbs'] = rep['contacts'].get('peg-barbs', 0) + 1; continue
            allowed = (key == 'Axle/Cassette_R' or key == 'Axle/Cassette_L'      # keyed: the hub rides the shaft
                       or (key == 'Arm/Sear' and psi < PSI_COCK + 9 * D2R)
                       or (key == 'Yoke/Buffer' and abs(yoke - finger_rest()) < 1e-6))
            if allowed: rep['contacts'][key] = rep['contacts'].get(key, 0) + 1
            else: rep['hits'].append(dict(phase=phase, psi=round(psi / D2R, 2), yoke=round(yoke / D2R, 2), pair=key, n=len(hits)))
        rep['states'] += 1
    for i in range(steps + 1):          # cocking: the yoke finger rides on the arm (0.2 mm off)
        psi = PSI_STOP - SWING * i / steps; check(psi, psi + off, 'cock')
    for i in range(steps + 1):          # yoke falls back while the arm stays latched
        check(PSI_COCK, PSI_COCK + off + (finger_rest() - PSI_COCK - off) * i / steps, 'yoke-return')
    for i in range(steps + 1):          # loose: arm swings to the stop under the resting yoke
        check(PSI_COCK + SWING * i / steps, finger_rest(), 'fire')
    pose(P, PSI_STOP)
    return rep

# ---------------------------------------------------------------- renders
def look_at(cam, target):
    d = Vector(target) - cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render_setup(res=(1400, 900), samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = res; sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = 0.35
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.42, 0.55, 0.72, 1); bg.inputs['Strength'].default_value = 0.55
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = 0.06
    so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (52 * D2R, 8 * D2R, -38 * D2R)
    fill = bpy.data.lights.new('fill', 'AREA'); fill.energy = 2.2e6; fill.size = 400
    fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo); fo.location = (-260, 160, 260); look_at(fo, (0, -30, 60))
    g = bpy.data.meshes.new('ground'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2000); bm.to_mesh(g)
    gm = bpy.data.materials.new('groundmat'); gm.use_nodes = True
    gp = gm.node_tree.nodes['Principled BSDF']; gp.inputs['Base Color'].default_value = (0.19, 0.24, 0.12, 1); gp.inputs['Roughness'].default_value = 0.95
    g.materials.append(gm); go = bpy.data.objects.new('ground', g); sc.collection.objects.link(go); go.location.z = -0.05
    cam = bpy.data.cameras.new('cam'); cam.lens = 50; cam.clip_start = 5; cam.clip_end = 20000
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    return co

def shot(cam, loc, target, path, lens=50):
    cam.location = loc; cam.data.lens = lens; look_at(cam, target)
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

def renders(P, tag='concept'):
    cam = render_setup()
    pose(P, PSI_COCK)
    shot(cam, (330, 300, 210), (0, -40, 55), os.path.join(RENDERS, f'{tag}-1-cocked.png'))
    pose(P, PSI_STOP, ball=False)
    shot(cam, (-340, 250, 190), (0, -30, 70), os.path.join(RENDERS, f'{tag}-2-loosed.png'))
    pose(P, PSI_COCK)
    shot(cam, (520, -40, 80), (0, -40, 60), os.path.join(RENDERS, f'{tag}-3-side.png'), 45)
    pose(P, PSI_STOP)
    shot(cam, (150, -10, 130), (25, -10, 80), os.path.join(RENDERS, f'{tag}-4-spring.png'), 60)

# ---------------------------------------------------------------- print export
def non_manifold(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    n = sum(1 for e in bm.edges if not e.is_manifold); bm.free(); return n

def volume(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); v = bm.calc_volume(signed=True); bm.free(); return abs(v)

def export_stl(ob, path):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, apply_modifiers=True, global_scale=1.0, ascii_format=False)

def to_bed(ob, M=Matrix.Identity(4)):
    xform(ob, M)
    zmin = min(v.co.z for v in ob.data.vertices)
    xs = [v.co.x for v in ob.data.vertices]; ys = [v.co.y for v in ob.data.vertices]
    xform(ob, Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -zmin)))
    ob.location = (0, 0, 0); ob.rotation_euler = (0, 0, 0); ob.parent = None
    return ob

def print_parts(P):
    """Each printable part, as its own manifold solid, in its print orientation (mm, Z up)."""
    rep = {}
    base = copy(P['Base'], 'print_base'); base.location = (0, 0, 0)
    s = copy(P['Sear'], 'ps'); b = copy(P['Buffer'], 'pb')
    for o, src in ((s, P['Sear']), (b, P['Buffer'])): xform(o, Matrix.Translation(src.location)); o.location = (0, 0, 0)
    boolean(base, [s, b], 'UNION'); clean(base)
    parts = {
        'base': to_bed(base),
        'arm': to_bed(copy(P['Arm'], 'print_arm')),                       # flat underside down
        'yoke': to_bed(copy(P['Yoke'], 'print_yoke')),                    # lies in its own swing plane
        'spring-right': to_bed(copy(P['Cassette_R'], 'print_cr'), Matrix.Rotation(math.pi / 2, 4, 'Y')),   # outer face down
        'spring-left': to_bed(copy(P['Cassette_L'], 'print_cl'), Matrix.Rotation(-math.pi / 2, 4, 'Y')),
        'axle': to_bed(copy(P['Axle'], 'print_axle'), Matrix.Rotation(math.pi, 4, 'X')),   # D flat down
        'stone': to_bed(copy(P['Ball'], 'print_stone')),                  # flat spot down
    }
    for name, ob in parts.items():
        export_stl(ob, os.path.join(PRINT, f'heavy-launcher-{name}.stl'))
        dims = [round(max(v.co[i] for v in ob.data.vertices) - min(v.co[i] for v in ob.data.vertices), 1) for i in range(3)]
        rep[name] = dict(non_manifold_edges=non_manifold(ob), volume_mm3=round(volume(ob)), mass_pla_g=round(volume(ob) * 1.24e-3, 1), size_mm=dims)
        kill([ob])
    return rep

def physics():
    k = E_PLA * (RING_OUT_X - SPRING_X0) * SPR_T ** 3 / (12 * spring_length())
    out = {}
    for holes in range(1, 6):
        th0 = holes * TAU / DIAL_N; th1 = th0 + SWING
        out[holes] = dict(energy_J=round(2 * k * (th1 ** 2 - th0 ** 2) / 2 / 1000, 2), strain_pct=round(SPR_T / 2 * th1 / spring_length() * 100, 2),
                          cocking_force_N=round(2 * k * th1 / HANDLE_R, 1), sear_force_N=round(2 * k * th1 / NOSE[1], 1))
    return dict(spring_length_mm=round(spring_length(), 1), k_Nmm_per_rad_each=round(k, 1), turns=round(SPR_TURNS, 2), by_preload_holes=out)

# ---------------------------------------------------------------- game export
WIND_KEYS = 4
def warp(co, delta):
    """Spiral wind: hub turns by delta, ring stays, coils in between share it by arc length."""
    y, z = co.y, co.z; r = math.hypot(y, z)
    u = min(1, max(0, (r * r - SPR_R0 ** 2) / (SPR_R1 ** 2 - SPR_R0 ** 2)))
    a = delta * (1 - u); c, s = math.cos(a), math.sin(a)
    return Vector((co.x, y * c - z * s, y * s + z * c))

def wind_keys(ob):
    pre = PRELOAD_HOLES * TAU / DIAL_N
    base = [warp(v.co, pre) for v in ob.data.vertices]
    R = Matrix.Rotation(-pre, 3, 'X')                               # ring turned back `pre` holes; hub lands where it started
    for v, b in zip(ob.data.vertices, base): v.co = R @ b
    ob.shape_key_add(name='Basis', from_mix=False)
    for k in range(1, WIND_KEYS + 1):
        sk = ob.shape_key_add(name=f'Wind{k}', from_mix=False)
        d = SWING * k / WIND_KEYS
        for i, b in enumerate(base): sk.data[i].co = R @ warp(Vector(b), 0) if False else R @ warp_from(b, pre, d)

def warp_from(b, pre, d):
    # b is already wound by `pre`; winding further means the same law with pre + d from the printed shape
    return b if d == 0 else _rewind(b, pre, d)

def _rewind(b, pre, d):
    y, z = b.y, b.z; r = math.hypot(y, z)
    u = min(1, max(0, (r * r - SPR_R0 ** 2) / (SPR_R1 ** 2 - SPR_R0 ** 2)))
    a = d * (1 - u); c, s = math.cos(a), math.sin(a)
    return Vector((b.x, y * c - z * s, y * s + z * c))

def shade(ob, angle=32):
    me = ob.data
    for p in me.polygons: p.use_smooth = True
    try: me.set_sharp_from_angle(angle=angle * D2R)
    except Exception: pass

def set_origin(ob, pt):
    pt = Vector(pt); xform(ob, Matrix.Translation(-pt)); ob.location = pt

def export_game(P):
    set_origin(P['Sear'], (SEAR_X0 + SEAR_T / 2, Y_REAR1, 0))
    gy, gz = handle_rest(); set_origin(P['Buffer'], (0, gy, BASE_T))
    for n in ('Cassette_R', 'Cassette_L'): wind_keys(P[n])
    ys = [v.co.y for v in P['Base'].data.vertices]; shift = -(min(ys) + max(ys)) / 2
    root = bpy.data.objects.new('HeavyLauncher', None); bpy.context.scene.collection.objects.link(root)
    for n, ob in P.items():
        shade(ob)
        keys = [[Vector(d.co) for d in kb.data] for kb in ob.data.shape_keys.key_blocks] if ob.data.shape_keys else None
        xform(ob, Matrix.Scale(GAME_SCALE, 4))
        if keys:                                   # mesh.transform leaves shape keys in millimetres
            for kb, cos in zip(ob.data.shape_keys.key_blocks, keys):
                for d, c in zip(kb.data, cos): d.co = c * GAME_SCALE
        ob.location = Vector(ob.location) * GAME_SCALE
        if ob.parent is None:
            ob.location.y += shift * GAME_SCALE; ob.parent = root
    pose(P, PSI_STOP)
    for n in ('Arm', 'Yoke'): P[n].rotation_euler = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [root] + list(P.values()): ob.select_set(True)
    path = os.path.join(ROOT, 'public', 'assets', 'heavy_launcher.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_morph=True, export_morph_normal=True, export_cameras=False, export_lights=False,
                              export_extras=False, export_animations=False, export_skins=False, export_materials='EXPORT')
    tris = 0
    for ob in P.values():
        ob.data.calc_loop_triangles(); tris += len(ob.data.loop_triangles)
    contract = dict(scale=GAME_SCALE, axle=[0, H * GAME_SCALE, -shift * GAME_SCALE], psi_cock=PSI_COCK, psi_stop=PSI_STOP,
                    yoke_rest=finger_rest(), yoke_offset=finger_rest() - PSI_STOP, wind_keys=WIND_KEYS,
                    release=[0, (H + rot_yz((BALL_C.y, BALL_C.z), PSI_STOP)[1]) * GAME_SCALE, -(rot_yz((BALL_C.y, BALL_C.z), PSI_STOP)[0] + shift) * GAME_SCALE],
                    triangles=tris, glb_bytes=os.path.getsize(path))
    json.dump(contract, open(os.path.join(OUT, 'contract.json'), 'w'), indent=1)
    return contract

def main():
    reset(); mats()
    P = assemble()
    rep = dict(build_s=round(time.time() - T0, 1))
    rep['sweep'] = sweep(P)
    print('SWEEP states=%d hits=%d contacts=%s' % (rep['sweep']['states'], len(rep['sweep']['hits']), rep['sweep']['contacts']))
    seen = set()
    for h in rep['sweep']['hits']:
        k = (h['pair'], h['phase'])
        if k in seen: continue
        seen.add(k); print('  HIT', h)
    if rep['sweep']['hits']: print('ABORT: parts collide'); sys.exit(3)
    if '--render' in ARGS: renders(P)
    rep['print'] = print_parts(P); rep['physics'] = physics()
    for n, r in rep['print'].items(): print('PRINT', n, r)
    bad = [n for n, r in rep['print'].items() if r['non_manifold_edges'] or r['volume_mm3'] < 1000]
    if bad: print('ABORT: broken print solids', bad); sys.exit(5)
    rep['game'] = export_game(P); print('GAME', rep['game'])
    json.dump(rep, open(os.path.join(OUT, 'build_report.json'), 'w'), indent=1)
    return P

if __name__ == '__main__':
    main()
