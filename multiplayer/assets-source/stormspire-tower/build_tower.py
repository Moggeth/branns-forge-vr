"""Stormspire tower and Stormreel reel pack: reproducible Blender (bpy 4.5+/5.x) builder, level 2 + level 3 polish.

Run (from this folder):
    python3.11 build_tower.py -- [--part tower|pack|all] [--out DIR]        (pip install bpy numpy pillow)
Writes DIR/stormspire.glb, DIR/reel_pack.glb, DIR/textures/*.jpg (review copies) and out/build_report.json.
The last line printed is STORMSPIRE_BUILD_OK (Blender can exit 0 after a traceback, so check for it).

Design (see README.md): a cheerful wizard's lightning tower that the Voltnewt crew lives on. Big shapes first:
  1. one tall stone shaft on a chunky faceted plinth, with a battered skirt and a corbelled crown,
  2. a floppy, crooked indigo felt wizard hat with gold stars and a stitched patch (the far silhouette),
  3. the copper torus brim and a Tesla coil winding up the shaft (the circuit you can follow by eye),
then medium shapes (hopper, charge column, red/blue terminals and hooks, a newt-sized door and ladder) and small
accents only where the eye goes (gold buckle, gauge rings, rivets in the texture).
The reel pack is a pedlar's backboard carrying a big brass cable drum with lightning-bolt spokes, a crank, a ratchet
pawl that clicks as the drum turns, a glass "live" lamp on top and leather straps.

Surfaces: one 1024 px trim-sheet atlas for the tower and one 512 px atlas for the pack (base colour, normal, ORM),
UV mapped per strip (U tiles round the shaft; V maps inside the strip), plus baked ambient occlusion and a ground
grime gradient in vertex colours. Emissive parts (charge core, crystals, windows, lamp) are untextured glow materials
the runtime animates; the coil, brim and hat get small shader patches in client/stormspire-art.js.

Frame: Blender X right, Y forward, Z up, metres. glTF turns +Y forward into -Z forward.
"""
import bpy, bmesh, math, json, os, sys, time, random, struct
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import texlib as TX

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
PART = arg('--part', 'all')
OUT = os.path.abspath(arg('--out', os.path.join(HERE, 'out')))
TAU = math.tau
V3 = lambda *a: Vector(a if len(a) == 3 else a[0])

# ================================================================== atlases
def tower_layout():
    R = lambda s: np.random.default_rng(s)
    return [
        ('stone',   256, lambda h, w: TX.stone(h, w, 3.0, 1.2, .30, (.42, .78), ['bfae93', 'b3a186', 'c9b79a', 'a99981', 'b8a993', 'a08f76', 'c2a98a'], '665c50', 11, moss=0.0)),
        ('plinth',  176, lambda h, w: TX.stone(h, w, 4.0, .84, .28, (.6, 1.15), ['9b8d78', '8f816c', 'a4957e', '857865', '96866c'], '51493f', 12, moss=.55, bevel=.04)),
        ('hat',     256, lambda h, w: TX.hat_cloth(h, w, 6.0, 1.6, R(13))),
        ('wood',     64, lambda h, w: TX.wood(h, w, 1.6, .16, '9a6236', R(14))),
        ('copper',   48, lambda h, w: TX.metal(h, w, 'd9804e', .30, R(15), patina='63b89c', dark=.12)),
        ('brass',    48, lambda h, w: TX.metal(h, w, 'dcae4a', .30, R(16))),
        ('iron',     40, lambda h, w: TX.metal(h, w, '4b505c', .55, R(17), streak=False, dent=.3, metal_v=.85, dark=.3)),
        ('white',    32, lambda h, w: TX.ceramic(h, w, 'f1e9d8', R(18))),
        ('red',      32, lambda h, w: TX.ceramic(h, w, 'dd4a3a', R(19))),
        ('blue',     32, lambda h, w: TX.ceramic(h, w, '4e82d6', R(20))),
        ('gold',     32, lambda h, w: TX.metal(h, w, 'f5c84a', .2, R(21), dark=.1)),
    ]
def pack_layout():
    R = lambda s: np.random.default_rng(s)
    return [
        ('board',   96, lambda h, w: TX.wood_h(h, w, 4, 'a8703e', R(31))),
        ('leather', 56, lambda h, w: TX.leather(h, w, '8a5430', R(32))),
        ('brass',   48, lambda h, w: TX.metal(h, w, 'dcae4a', .28, R(33))),
        ('iron',    48, lambda h, w: TX.metal(h, w, '4a505d', .5, R(34), streak=False, dent=.3, metal_v=.85, dark=.3)),
        ('copper',  40, lambda h, w: TX.metal(h, w, 'd9804e', .3, R(35), patina='63b89c')),
        ('braid',   64, lambda h, w: TX.braid(h, w, R(36))),
        ('tintc',   32, lambda h, w: TX.ceramic(h, w, 'f4f2ee', R(37))),
        ('white',   32, lambda h, w: TX.ceramic(h, w, 'f1e9d8', R(38))),
        ('rubber',  32, lambda h, w: TX.rubber(h, w, R(39))),
        ('gold',    32, lambda h, w: TX.metal(h, w, 'f5c84a', .2, R(40), dark=.1)),
        ('wood',    32, lambda h, w: TX.wood(h, w, 1.0, .25, '7a4a26', R(41))),
    ]
ROWS = {}; ATLAS_H = 1024
def strip_v(name, t):
    """Blender v for parameter t (0 bottom .. 1 top of the strip's inner area)."""
    y0, y1 = ROWS[name]; y = y1 - t * (y1 - y0)
    return 1 - y / ATLAS_H

# ================================================================== geometry with UVs
class Geo:
    """Polygon soup with per-corner UV0, optional per-corner UV1 and a smooth flag per face."""
    def __init__(s): s.v = []; s.f = []; s.uv = []; s.uv1 = []; s.sm = []
    def face(s, idx, uvs, smooth=True, uv1=None):
        s.f.append(tuple(idx)); s.uv.append(tuple(uvs)); s.sm.append(smooth); s.uv1.append(tuple(uv1) if uv1 else tuple((0.0, 0.0) for _ in idx))
    def vert(s, p): s.v.append(Vector(p)); return len(s.v) - 1
    def extend(s, o):
        off = len(s.v); s.v += [p.copy() for p in o.v]
        for f, uv, sm, u1 in zip(o.f, o.uv, o.sm, o.uv1): s.f.append(tuple(i + off for i in f)); s.uv.append(uv); s.sm.append(sm); s.uv1.append(u1)
        return s
    def xform(s, M):
        M = Matrix(M); s.v = [M @ p for p in s.v]; return s
    def set_uv1(s, fn):
        s.uv1 = [tuple(fn(s.v[i]) for i in f) for f in s.f]; return s

def revolve(profile, segs, strip, reps=1, vmode=('stretch',), phase=0.0, smooth=True, cap0=False, cap1=False, wobble=None):
    """Profile [(r, z)] about +Z. U: reps repeats round the full turn. V: 'stretch' over the profile's arc length, or
    ('tile', metres) restarting the strip every tile (rings are inserted at tile boundaries)."""
    pts = list(profile)
    s_acc = [0.0]
    for a, b in zip(pts, pts[1:]): s_acc.append(s_acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    if vmode[0] == 'tile':   # insert tile-boundary rings
        tile = vmode[1]; npts = [pts[0]]; ns = [0.0]
        for i in range(1, len(pts)):
            s0, s1 = s_acc[i - 1], s_acc[i]; k = math.floor(s0 / tile) + 1
            while k * tile < s1 - 1e-4:
                f = (k * tile - s0) / (s1 - s0); a, b = pts[i - 1], pts[i]
                npts.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)); ns.append(k * tile); k += 1
            npts.append(pts[i]); ns.append(s1)
        pts, s_acc = npts, ns
    g = Geo(); rings = []
    for (r, z) in pts:
        ring = []
        for k in range(segs):
            a = phase + TAU * k / segs; rr = r * (wobble(a, z) if wobble else 1)
            ring.append(g.vert((math.cos(a) * rr, math.sin(a) * rr, z)))
        rings.append(ring)
    stot = s_acc[-1] or 1
    for i in range(len(pts) - 1):
        if vmode[0] == 'tile':
            band = math.floor((s_acc[i] + s_acc[i + 1]) * .5 / vmode[1])
            t0 = (s_acc[i] - band * vmode[1]) / vmode[1]; t1 = (s_acc[i + 1] - band * vmode[1]) / vmode[1]
        else: t0, t1 = s_acc[i] / stot, s_acc[i + 1] / stot
        if pts[i][0] < 1e-6 and pts[i + 1][0] < 1e-6: continue
        for k in range(segs):
            j = (k + 1) % segs; u0, u1 = reps * k / segs, reps * (k + 1) / segs
            g.face((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]),
                   ((u0, strip_v(strip, t0)), (u1, strip_v(strip, t0)), (u1, strip_v(strip, t1)), (u0, strip_v(strip, t1))), smooth)
    for cap, ring, flip in ((cap0, rings[0], True), (cap1, rings[-1], False)):
        if not cap: continue
        r = max(pts[0 if flip else -1][0], 1e-3)
        idx = ring[::-1] if flip else ring
        g.face(idx, [(.5 + g.v[i].x / (4 * r), strip_v(strip, .5 + g.v[i].y / (2.2 * r))) for i in idx], smooth=False)
    return g

def sweep(path, radius, sides, strip, u_m=.5, smooth=True, cap=True, squash=1.0, up=None, twist=0.0):
    path = [Vector(p) for p in path]; g = Geo(); rings = []; prev_n = None; s = [0.0]
    for a, b in zip(path, path[1:]): s.append(s[-1] + (b - a).length)
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        if up is not None:
            b = (Vector(up) - t * t.dot(Vector(up))).normalized(); n = b.cross(t).normalized()
        else:
            if prev_n is None:
                ref = Vector((0, 0, 1)) if abs(t.z) < .9 else Vector((1, 0, 0)); n = t.cross(ref).normalized()
            else: n = (prev_n - t * t.dot(prev_n)).normalized()
            b = t.cross(n).normalized()
        prev_n = n; r = radius[i] if isinstance(radius, (list, tuple)) else radius
        ring = []
        for k in range(sides):
            a = TAU * k / sides + twist
            ring.append(g.vert(p + n * math.cos(a) * r + b * math.sin(a) * r * squash))
        rings.append(ring)
    for i in range(len(path) - 1):
        for k in range(sides):
            j = (k + 1) % sides
            g.face((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]),
                   ((s[i] / u_m, strip_v(strip, k / sides)), (s[i] / u_m, strip_v(strip, (k + 1) / sides)),
                    (s[i + 1] / u_m, strip_v(strip, (k + 1) / sides)), (s[i + 1] / u_m, strip_v(strip, k / sides))), smooth)
    if cap:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            idx = ring[::-1] if flip else ring
            g.face(idx, [(.1 * k, strip_v(strip, .5)) for k in range(len(idx))], smooth=False)
    return g

def prism(section, z0, z1, strip, u_m=.5, smooth=False, caps=True, taper=1.0):
    """Extrude a CCW 2D section (x, y) from z0 to z1 (the top scaled by taper). U along the perimeter, V up the side."""
    g = Geo(); n = len(section)
    A = [g.vert((x, y, z0)) for x, y in section]; B = [g.vert((x * taper, y * taper, z1)) for x, y in section]
    per = [0.0]
    for i in range(n): per.append(per[-1] + math.hypot(section[(i + 1) % n][0] - section[i][0], section[(i + 1) % n][1] - section[i][1]))
    for i in range(n):
        j = (i + 1) % n; u0, u1 = per[i] / u_m, per[i + 1] / u_m
        g.face((A[i], A[j], B[j], B[i]), ((u0, strip_v(strip, 0)), (u1, strip_v(strip, 0)), (u1, strip_v(strip, 1)), (u0, strip_v(strip, 1))), smooth)
    if caps:
        span = max(max(abs(x), abs(y)) for x, y in section) * 2 or 1
        g.face(A[::-1], [(g.v[i].x / u_m, strip_v(strip, .5 + g.v[i].y / span)) for i in A[::-1]], False)
        g.face(B, [(g.v[i].x / u_m, strip_v(strip, .5 + g.v[i].y / span)) for i in B], False)
    return g

def box(c, s, strip, u_m=.5, chamfer=0.0):
    w, d, h = s[0] / 2, s[1] / 2, s[2] / 2; c = Vector(c)
    if chamfer:
        k = min(chamfer, w * .9, d * .9)
        sec = [(w, -d + k), (w, d - k), (w - k, d), (-w + k, d), (-w, d - k), (-w, -d + k), (-w + k, -d), (w - k, -d)]
    else: sec = [(w, -d), (w, d), (-w, d), (-w, -d)]
    return prism(sec, -h, h, strip, u_m).xform(Matrix.Translation(c))

def poly(points, strip, ax_u, ax_v, u_m=1.0, v_span=1.0, v0=0.0, smooth=False, solid=0.0, normal=None):
    """Flat polygon (optionally solidified by `solid` along -normal) with planar UVs."""
    g = Geo(); P = [Vector(p) for p in points]; ax_u, ax_v = Vector(ax_u), Vector(ax_v)
    uvf = lambda p: (p.dot(ax_u) / u_m, strip_v(strip, min(1, max(0, (p.dot(ax_v) - v0) / v_span))))
    A = [g.vert(p) for p in P]; g.face(A, [uvf(p) for p in P], smooth)
    if solid:
        nrm = Vector(normal) if normal else ax_u.cross(ax_v).normalized()
        B = [g.vert(p - nrm * solid) for p in P]; g.face(B[::-1], [uvf(p) for p in P[::-1]], smooth)
        n = len(P)
        for i in range(n):
            j = (i + 1) % n; L = (P[j] - P[i]).length
            g.face((A[j], A[i], B[i], B[j]), ((0, strip_v(strip, 0)), (L / u_m, strip_v(strip, 0)), (L / u_m, strip_v(strip, .2)), (0, strip_v(strip, .2))), False)
    return g

def crystal(base, axis, length, r, sides=6, roll=0.0):
    axis = Vector(axis).normalized(); ref = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 0, 1))
    n = axis.cross(ref).normalized(); b = axis.cross(n); base = Vector(base); g = Geo()
    A = [g.vert(base + (n * math.cos(roll + TAU * k / sides) + b * math.sin(roll + TAU * k / sides)) * r * .78) for k in range(sides)]
    B = [g.vert(g.v[a] + axis * length * .7 + (g.v[a] - base).normalized() * r * .22) for a in A]
    tip = g.vert(base + axis * length); z = ((0, 0),) * 4
    for k in range(sides):
        j = (k + 1) % sides
        g.face((A[k], A[j], B[j], B[k]), z, False); g.face((B[k], B[j], tip), z[:3], False)
    g.face(A[::-1], z[:1] * sides, False)
    return g

def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def torus(R, r, seg, sides, strip, u_m=.5):
    path = [Vector((math.cos(TAU * k / seg) * R, math.sin(TAU * k / seg) * R, 0)) for k in range(seg + 1)]
    g = sweep(path, r, sides, strip, u_m=u_m, cap=False, up=(0, 0, 1))
    return g   # first and last ring coincide; welded in to_object

def zigzag(size, thick, strip):
    pts = [(-.30, .50), (.20, .50), (-.02, .08), (.32, .08), (-.22, -.55), (.02, -.06), (-.30, -.06)]
    return poly([(0, x * size, z * size) for x, z in pts][::-1], strip, (0, 1, 0), (0, 0, 1), u_m=.2, v_span=size, v0=-size * .55, solid=thick, normal=(1, 0, 0))

def rotZ(a): return Matrix.Rotation(a, 4, 'Z')
def rotX(a): return Matrix.Rotation(a, 4, 'X')
def rotY(a): return Matrix.Rotation(a, 4, 'Y')
def T(*p): return Matrix.Translation(Vector(p if len(p) == 3 else p[0]))
def align_z(d):
    """Matrix turning +Z onto direction d."""
    return Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()

# ================================================================== scene
SC = None; ROOT = None; PARTS = {}   # (node name, material) -> Geo
NODES = {}
def new_scene(root_name):
    global SC, ROOT
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SC = bpy.context.scene; PARTS.clear(); NODES.clear()
    ROOT = bpy.data.objects.new(root_name, None); SC.collection.objects.link(ROOT); NODES[root_name] = ROOT
    return ROOT
def node(name, loc=(0, 0, 0), parent=None, rot=None):
    """Empty in the parent's frame (loc given in world coordinates when the parent has no rotation)."""
    parent = NODES[parent] if isinstance(parent, str) else (parent or ROOT)
    o = bpy.data.objects.new(name, None); o.empty_display_size = .03; SC.collection.objects.link(o)
    o.parent = parent; bpy.context.view_layer.update()
    o.matrix_world = Matrix.Translation(Vector(loc)) @ (rot.to_4x4() if rot is not None else Matrix())
    NODES[name] = o; return o
def add(g, mat, at=None, name=None):
    """Queue geometry (world coordinates) for node `at` (default root), merged per material; `name` makes its own mesh."""
    key = (at or ROOT.name, mat, name)
    PARTS.setdefault(key, Geo()).extend(g)
MATERIALS = {}
def material(name):
    if name not in MATERIALS: MATERIALS[name] = bpy.data.materials.new(name)
    return MATERIALS[name]
def build_objects():
    objs = []
    for (at, mat, name), g in PARTS.items():
        parent = NODES[at]; bpy.context.view_layer.update(); inv = parent.matrix_world.inverted()
        oname = name or f'{at}_{mat}'
        me = bpy.data.meshes.new(oname)
        me.from_pydata([tuple(inv @ p) for p in g.v], [], [list(f) for f in g.f])
        uv = me.uv_layers.new(name='UVMap'); k = 0
        for poly_, uvs in zip(me.polygons, g.uv):
            for li, (u, v) in zip(poly_.loop_indices, uvs): uv.data[li].uv = (u, v)
        if any(any(c != (0.0, 0.0) for c in f) for f in g.uv1):
            uv1 = me.uv_layers.new(name='UV1')
            for poly_, uvs in zip(me.polygons, g.uv1):
                for li, (u, v) in zip(poly_.loop_indices, uvs): uv1.data[li].uv = (u, v)
        for poly_, sm in zip(me.polygons, g.sm): poly_.use_smooth = sm
        me.materials.append(material(mat))
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me); bm.free()
        me.update()
        o = bpy.data.objects.new(oname, me); SC.collection.objects.link(o); o.parent = parent; o.matrix_parent_inverse = Matrix()
        o.matrix_basis = Matrix(); objs.append(o)
    bpy.context.view_layer.update()
    return objs

def bake_ao(objs, max_dist, rays=32, ground=None, tint=None, skip=()):
    """Ambient occlusion per vertex (BVH ray casts against the whole asset, and an optional ground plane) into COLOR_0,
    multiplied by tint(world_pos, obj) (grime, gradients). Deterministic."""
    verts, tris = [], []
    for o in objs:
        M = o.matrix_world; base = len(verts)
        verts += [M @ v.co for v in o.data.vertices]
        for p in o.data.polygons:
            for k in range(1, len(p.vertices) - 1): tris.append((base + p.vertices[0], base + p.vertices[k], base + p.vertices[k + 1]))
    if ground is not None:
        b = len(verts); verts += [Vector((-30, -30, ground)), Vector((30, -30, ground)), Vector((30, 30, ground)), Vector((-30, 30, ground))]
        tris += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    bvh = BVHTree.FromPolygons(verts, tris, epsilon=0.0)
    gold = math.pi * (3 - math.sqrt(5)); dirs = []
    for i in range(rays):
        z = (i + .5) / rays; r = math.sqrt(1 - z); a = gold * i   # cosine-weighted hemisphere
        dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(z))))
    for o in objs:
        me = o.data; M = o.matrix_world; N3 = M.to_3x3().inverted().transposed()
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        if o.name in skip or me.materials[0].name in skip:
            for i in range(len(me.vertices)): col.data[i].color = (1, 1, 1, 1)
            continue
        for i, v in enumerate(me.vertices):
            p = M @ v.co; n = (N3 @ v.normal).normalized()
            ref = Vector((1, 0, 0)) if abs(n.x) < .9 else Vector((0, 1, 0)); t = n.cross(ref).normalized(); b = n.cross(t)
            occ = 0.0; org = p + n * max_dist * .004
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(org, w, max_dist)
                if hit[0] is not None: occ += (1 - hit[3] / max_dist) ** .7
            ao = 1 - occ / rays
            ao = .28 + .72 * ao
            c = tint(p, o) if tint else (1, 1, 1)
            col.data[i].color = (ao * c[0], ao * c[1], ao * c[2], 1)
        me.color_attributes.active_color = col

def tri_count(objs): return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)

# ================================================================== TOWER
# Gameplay contract (shared/stormreel.js STORMSPIRE, shared colliders r 1.45) and the lizard stage
# (client/stormspire-lizards.js TW) are kept exactly: shaft radius .95 -> .68 from z .85 to 5.0; the coil winds
# 9 turns from z 1.2 to 4.65, .09 proud of that radius, phase pi/2 + .25; the torus brim (R 1.12, tube .14) at z 5.35;
# the hopper bowl rim (r ~.41) at z ~1.07 around (0, 1.62); terminals at (+-1.34, 0, 1.85), hooks at (+-1.25, 0, 1.40).
TWR = dict(r0=.95, r1=.68, z0=.85, z1=5.0, coil0=1.2, coil1=4.65, turns=9, phase=math.pi / 2 + .25, brim_z=5.35, brim_R=1.12, brim_r=.14)
def shaftR(z): return TWR['r0'] + (TWR['r1'] - TWR['r0']) * (z - TWR['z0']) / (TWR['z1'] - TWR['z0'])
COS8 = math.cos(math.pi / 8)
def apo(z): return shaftR(z) * COS8   # the octagonal shaft's faces (centred every 45 degrees from +X)
COURSES = [TWR['z0'] + (TWR['z1'] - TWR['z0']) * (i + 1) / 8 for i in range(7)]   # proud block courses (the newts' footing)
def stone_r(a, z):
    f = a - round(a / (math.pi / 4)) * (math.pi / 4); return apo(z) / math.cos(f)

def build_tower():
    new_scene('Stormspire')
    rnd = random.Random(7)
    # --- plinth: chunky faceted 12-sided base (collider r 1.45), a deck step, a battered skirt into the shaft
    # octagons throughout (Mitch likes the faceted look); plinth corners at r 1.5 so the faces sit on the r 1.45 collider
    plinth = [(1.52, 0), (1.50, .06), (1.48, .34), (1.42, .40), (1.35, .43), (1.20, .43), (1.17, .47), (1.16, .72), (1.12, .78), (1.06, .80)]
    add(revolve(plinth, 8, 'plinth', reps=2, vmode=('tile', .84), phase=math.pi / 8, smooth=False), 'Stormspire')
    # battered skirt (plinth stone) into the octagonal shaft; the shaft's stone courses tile every two block courses
    # (1.0375 m, starting at z .85) so the joints line up with the proud courses
    add(revolve([(1.06, .80), (1.02, .815), (.99, .835), (shaftR(.85) + .005, .85)], 8, 'plinth', reps=2, phase=math.pi / 8, smooth=False), 'Stormspire')
    tile = (TWR['z1'] - TWR['z0']) / 4
    shaft = [(shaftR(z), z) for z in [TWR['z0'] + tile * k / 2 for k in range(9)]]
    add(revolve(shaft, 8, 'stone', reps=2, vmode=('tile', tile * (shaft[-1][1] - shaft[0][1]) / math.dist(shaft[0], shaft[-1])), phase=math.pi / 8, smooth=False), 'Stormspire')
    for zc in COURSES:   # proud courses, .032 off the faces (matches courseBump in stormspire-lizards.js)
        r0, r1 = shaftR(zc - .064), shaftR(zc + .064); rp = shaftR(zc) + .035
        add(revolve([(r0, zc - .064), (rp, zc - .046), (rp, zc + .046), (r1, zc + .064)], 8, 'plinth', reps=2, phase=math.pi / 8, smooth=False), 'Stormspire')
    # corbelled crown: three stepped rings carrying the brim insulators and the hat
    crown = [(shaftR(4.95), 4.95), (.74, 4.97), (.78, 5.02), (.80, 5.02), (.84, 5.07), (.88, 5.07), (.90, 5.10), (.90, 5.17), (.87, 5.20), (.80, 5.20)]
    add(revolve(crown, 16, 'plinth', reps=3, smooth=False), 'Stormspire')

    # --- Tesla coil (material Coil: the runtime lights it from the bottom up with the charge; UV1.x = 0..1 along it)
    turns, n = TWR['turns'], TWR['turns'] * 22
    coil = []
    for i in range(n + 1):
        t = i / n; zc = TWR['coil0'] + (TWR['coil1'] - TWR['coil0']) * t; a = TAU * turns * t + TWR['phase']
        coil.append(Vector((math.cos(a) * (shaftR(zc) + .09), math.sin(a) * (shaftR(zc) + .09), zc)))
    g = sweep(coil, .032, 6, 'copper', u_m=.25, cap=True)
    zr = (TWR['coil0'], TWR['coil1'])
    g.set_uv1(lambda p: (.06 + .9 * (p.z - zr[0]) / (zr[1] - zr[0]), 0.0))
    add(g, 'Coil')
    # ceramic stand-offs every half turn, and the leads: bottom end down to a junction box, top end up to the brim
    for i in range(0, n + 1, 11):
        p = coil[i]; d = Vector((p.x, p.y, 0)).normalized(); gap = Vector((p.x, p.y, 0)).length - stone_r(math.atan2(p.y, p.x), p.z) + .005
        sg = revolve([(.022, 0), (.03, gap * .25), (.022, gap * .45), (.03, gap * .7), (.02, gap - .02)], 6, 'white', smooth=True)
        add(sg.xform(T(p - d * gap) @ align_z(d)), 'Stormspire')
    a0 = TWR['phase']; d0 = Vector((math.cos(a0), math.sin(a0), 0))
    jb = d0 * 1.08 + Vector((0, 0, .80))
    add(box(jb + Vector((0, 0, .09)), (.16, .16, .18), 'iron', chamfer=.03).xform(T(jb) @ rotZ(a0) @ T(-jb)), 'Stormspire')
    add(revolve([(.04, 0), (.055, .03), (.035, .05), (.05, .08), (.03, .10), (0, .11)], 8, 'white').xform(T(jb + Vector((0, 0, .18)))), 'Stormspire')
    lead = bezier(coil[0], coil[0] + Vector((0, 0, -.12)) + d0 * .05, jb + Vector((0, 0, .45)), jb + Vector((0, 0, .27)), 8)
    g = sweep(lead, .022, 6, 'copper', u_m=.25); g.set_uv1(lambda p: (.03, 0.0)); add(g, 'Coil')
    aT = TAU * turns + TWR['phase']; dT = Vector((math.cos(aT), math.sin(aT), 0))
    top = bezier(coil[-1], coil[-1] + Vector((0, 0, .25)), dT * (TWR['brim_R'] - .15) + Vector((0, 0, 5.05)), dT * (TWR['brim_R'] - .08) + Vector((0, 0, TWR['brim_z'] - .1)), 8)
    g = sweep(top, .026, 6, 'copper', u_m=.25); g.set_uv1(lambda p: (.97, 0.0)); add(g, 'Coil')

    # --- torus brim (material Coil, UV1.x = 1 marks the brim; UV1.y = angle 0..1 for the crackle)
    g = torus(TWR['brim_R'], TWR['brim_r'], 40, 9, 'copper', u_m=1.2)
    g.set_uv1(lambda p: (1.0, (math.atan2(p.y, p.x) / TAU) % 1.0))
    add(g.xform(T(0, 0, TWR['brim_z'])), 'Coil')
    node('TopLoad', (0, 0, TWR['brim_z']))
    # six blue insulators on the crown ledge, copper arms out to the inside of the torus
    for k in range(6):
        a = TAU * k / 6 + .2; d = Vector((math.cos(a), math.sin(a), 0)); base = d * .82 + Vector((0, 0, 5.07))
        prof = [(0, 0), (.06, 0), (.085, .04), (.05, .07), (.08, .11), (.045, .14), (.07, .18), (.04, .21), (0, .22)]
        add(revolve(prof, 8, 'blue').xform(T(base)), 'Stormspire')
        arm = [base + Vector((0, 0, .2)), d * .92 + Vector((0, 0, 5.30)), d * (TWR['brim_R'] - .12) + Vector((0, 0, TWR['brim_z']))]
        g = sweep(arm, .022, 6, 'copper', u_m=.25); g.set_uv1(lambda p: (1.0, .5)); add(g, 'Coil')

    # --- the wizard hat: floppy, crooked felt with soft folds; tip droops back-right; stars twinkle with the charge
    hat_path = bezier((0, 0, 5.16), (0, .02, 6.75), (.08, -.18, 7.75), (.78, -.46, 8.32), 22)
    hat_path += bezier(hat_path[-1], hat_path[-1] + Vector((.12, -.07, .02)), hat_path[-1] + Vector((.24, -.13, -.05)), hat_path[-1] + Vector((.32, -.17, -.14)), 5)[1:]
    tile = 1.6   # the felt tile repeats every 1.6 m up the hat: put a ring exactly on each tile edge
    tt_of = [i / (len(hat_path) - 1) for i in range(len(hat_path))]
    s_acc = [0.0]
    for a_, b_ in zip(hat_path, hat_path[1:]): s_acc.append(s_acc[-1] + (b_ - a_).length)
    k = 1
    while k * tile < s_acc[-1]:
        i = next(j for j in range(1, len(s_acc)) if s_acc[j] >= k * tile)
        if s_acc[i] - k * tile > 1e-4 and k * tile - s_acc[i - 1] > 1e-4:
            f = (k * tile - s_acc[i - 1]) / (s_acc[i] - s_acc[i - 1])
            hat_path.insert(i, hat_path[i - 1].lerp(hat_path[i], f)); s_acc.insert(i, k * tile); tt_of.insert(i, tt_of[i - 1] + (tt_of[i] - tt_of[i - 1]) * f)
        k += 1
    m = len(hat_path); sides = 24; rings = []; g = Geo()
    prev_n = None
    for i, p in enumerate(hat_path):
        tt = tt_of[i]
        t = (hat_path[min(i + 1, m - 1)] - hat_path[max(i - 1, 0)]).normalized()
        if prev_n is None: n_ = t.cross(Vector((1, 0, 0))).normalized()
        else: n_ = (prev_n - t * t.dot(prev_n)).normalized()
        b = t.cross(n_).normalized(); prev_n = n_
        r = .965 * (1 - tt) ** 1.18 + .035
        if i == 0: r = .90
        ring = []
        for k in range(sides):
            a = TAU * k / sides
            fold = 1 + .045 * math.sin(5 * a + tt * 4) * math.sin(math.pi * min(1, tt * 1.6)) + .03 * math.sin(3 * a - 1.0) * tt
            crumple = 1 - .07 * math.exp(-((tt - .70) / .05) ** 2) * (1 + .5 * math.sin(2 * a))
            rr = r * fold * crumple
            ring.append(g.vert(p + (n_ * math.cos(a) + b * math.sin(a)) * rr))
        rings.append(ring)
    for i in range(m - 1):
        band = math.floor((s_acc[i] + s_acc[i + 1]) * .5 / tile)
        t0 = (s_acc[i] - band * tile) / tile; t1 = (s_acc[i + 1] - band * tile) / tile
        for k in range(sides):
            j = (k + 1) % sides; u0, u1 = k / sides, (k + 1) / sides
            g.face((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]),
                   ((u0, strip_v('hat', t0)), (u1, strip_v('hat', t0)), (u1, strip_v('hat', t1)), (u0, strip_v('hat', t1))), True)
    tipv = g.vert(hat_path[-1] + (hat_path[-1] - hat_path[-2]).normalized() * .02)
    for k in range(sides):
        j = (k + 1) % sides; g.face((rings[-1][k], rings[-1][j], tipv), ((0, strip_v('hat', .9)),) * 3, True)
    add(g, 'Hat')
    # hatband (copper, the bonding strap) with a gold lightning buckle on the front over the charge column
    hb = hat_path[3]; rb = .965 * (1 - tt_of[3]) ** 1.18 + .035
    add(revolve([(rb - .02, hb.z - .11), (rb + .022, hb.z - .095), (rb + .03, hb.z), (rb + .018, hb.z + .095), (rb - .025, hb.z + .11)], 24, 'brass', reps=4), 'Stormspire')
    add(zigzag(.42, .04, 'gold').xform(T(0, rb + .055, hb.z + .01) @ rotZ(math.pi / 2)), 'Stormspire')
    # the capacitor: copper collar and prongs holding a crystal cluster at the hat tip, with a lightning rod
    tip = hat_path[-1]; tdir = (hat_path[-1] - hat_path[-2]).normalized()
    cdir = (tdir + Vector((0, 0, 1.6))).normalized()
    capM = T(tip - tdir * .03) @ align_z(cdir)
    node('Capacitor', tip - tdir * .03, rot=align_z(cdir).to_3x3())
    add(revolve([(.05, -.04), (.11, .02), (.12, .10), (.08, .14)], 8, 'copper', smooth=True).xform(capM), 'Stormspire', at='Capacitor')
    cc = Geo()
    for k, (ax, ln, r) in enumerate((((0, 0, 1), .60, .14), ((.5, .2, 1), .36, .085), ((-.4, .3, 1), .32, .075), ((.1, -.5, 1), .28, .065))):
        cc.extend(crystal((0, 0, .08), ax, ln, r, roll=k))
    add(cc.xform(capM), 'CrystalCore', at='Capacitor', name='Capacitor_Crystal')
    for k in range(3):
        a = TAU * k / 3
        pr = bezier((math.cos(a) * .09, math.sin(a) * .09, .1), (math.cos(a) * .19, math.sin(a) * .19, .28), (math.cos(a) * .15, math.sin(a) * .15, .48), (math.cos(a) * .05, math.sin(a) * .05, .6), 7)
        add(sweep(pr, .018, 5, 'copper', u_m=.2).xform(capM), 'Stormspire', at='Capacitor')
    add(revolve([(.02, .55), (.016, .8), (.006, 1.0), (0, 1.04)], 6, 'copper').xform(capM), 'Stormspire', at='Capacitor')
    add(revolve([(0, .78), (.035, .80), (.035, .84), (0, .86)], 8, 'gold').xform(capM), 'Stormspire', at='Capacitor')

    # --- charge column: glass tube on brass brackets in front of the coil (front face, +Y). Core origin at its floor.
    def col_at(z): return Vector((0, shaftR(z) + .27, z))
    c0, c1 = 1.25, 4.45
    a = col_at(c0); b = col_at(c1); axis = (b - a).normalized(); L = (b - a).length
    colM = T(a) @ align_z(axis)
    add(revolve([(.105, .02), (.105, L - .02)], 16, 'white', smooth=True).xform(colM), 'Glass', name='ChargeColumn_Glass')
    core_o = a + axis * .06
    node('ChargeColumn', core_o, rot=align_z(axis).to_3x3())
    core = revolve([(0, 0), (.05, 0), (.068, .03), (.068, L - .16), (.05, L - .12), (0, L - .12)], 10, 'white', smooth=True)
    add(core.xform(T(core_o) @ align_z(axis)), 'Charge', at='ChargeColumn', name='ChargeColumn_Core')
    for zz, flip in ((0, 1), (L, -1)):   # brass end caps, a little bell-shaped
        prof = [(0, -.10 * flip), (.10, -.10 * flip), (.15, -.07 * flip), (.155, -.03 * flip), (.13, 0), (.12, .03 * flip)]
        if flip < 0: prof = prof[::-1]
        add(revolve(prof, 14, 'brass', reps=2).xform(colM @ T(0, 0, zz)), 'Stormspire')
    add(revolve([(0, -.10), (.05, -.10), (.03, -.2), (0, -.22)], 8, 'brass').xform(colM), 'Stormspire')   # drip finial
    add(revolve([(0, L + .1), (.04, L + .1), (.025, L + .26), (0, L + .28)], 8, 'brass').xform(colM), 'Stormspire')
    for k in range(1, 6):   # gauge rings
        zz = L * k / 6
        add(torus(.11, .009, 18, 4, 'brass').xform(colM @ T(0, 0, zz)), 'Stormspire')
    for zb in (1.76, 2.91, 4.06):   # brackets between coil turns
        p = col_at(zb); q = Vector((0, shaftR(zb) - .01, zb))
        add(sweep([q, p - Vector((0, .1, 0))], .025, 6, 'brass', u_m=.2), 'Stormspire')
        add(torus(.118, .016, 18, 5, 'brass').xform(T(p) @ align_z(axis)), 'Stormspire')
    # lead from the column top up the shaft to the hatband (the charge goes on to the capacitor)
    lt = bezier(b + axis * .28, b + axis * .45 + Vector((0, -.05, 0)), Vector((.0, shaftR(4.95) + .14, 5.05)), Vector((0, .86, 5.12)), 8)
    add(sweep(lt, .02, 6, 'copper', u_m=.25), 'Stormspire')

    # --- crystal hopper: round stone pedestal, brass funnel with a rolled rim (newt perch), glowing crystal heap
    hp = Vector((0, 1.62, 0))
    # (the bowl keeps the lizard stage's HOPPER profile: rim r .40 at y 1.08, top 1.10)
    ped = [(.34, 0), (.34, .06), (.30, .10), (.25, .60), (.27, .66), (.31, .70), (.31, .76), (.25, .78)]
    add(revolve(ped, 8, 'plinth', reps=1, phase=math.pi / 8, smooth=False).xform(T(hp)), 'Stormspire')
    bowl = [(.09, .76), (.12, .78), (.30, .98), (.36, 1.04), (.395, 1.07), (.40, 1.08), (.385, 1.098), (.37, 1.10), (.345, 1.085), (.26, .99), (.14, .84), (0, .84)]
    add(revolve(bowl, 18, 'brass', reps=2, smooth=True).xform(T(hp)), 'Stormspire')
    add(revolve([(.392, 1.035), (.402, 1.045), (.404, 1.06), (.398, 1.068)], 18, 'copper', reps=3).xform(T(hp)), 'Stormspire')
    crys = Geo(); keeper = Vector((.382, 1.60, 1.054))   # the keeper's perch on the rim (stormspire-lizards.js)
    for k in range(9):
        for _ in range(50):
            a = rnd.uniform(0, TAU); rr = rnd.uniform(.0, .24)
            base = Vector((math.cos(a) * rr, hp.y + math.sin(a) * rr, 1.0 + .06 * (rr / .24)))
            if (base - keeper).length > .22: break
        ax = Vector((math.cos(a) * .55 * rr / .24, math.sin(a) * .55 * rr / .24, 1))
        crys.extend(crystal(base, ax, rnd.uniform(.22, .40), rnd.uniform(.06, .095), roll=rnd.random()))
    add(crys, 'Crystal', name='Hopper_Crystals')
    node('Hopper', (0, hp.y, 1.05))
    # feed pipe from the funnel throat into the foot of the charge column (crystals -> column -> hat)
    a_col = col_at(c0) - axis * .2
    feed = bezier(hp + Vector((0, -.04, .80)), hp + Vector((0, -.30, .76)), a_col + Vector((0, .25, -.25)), a_col + Vector((0, 0, -.02)), 10)
    add(sweep(feed, .05, 8, 'brass', u_m=.3), 'Stormspire')
    for t in (.25, .7):
        i = int(t * 9); d = (feed[i + 1] - feed[i]).normalized()
        add(revolve([(.05, -.02), (.075, -.015), (.075, .015), (.05, .02)], 10, 'copper').xform(T(feed[i]) @ align_z(d)), 'Stormspire')

    # --- earth bonding: four copper straps down the plinth to stakes in the grass (the return path)
    for k in range(4):
        a = math.pi / 4 + TAU * k / 4; d = Vector((math.cos(a), math.sin(a), 0)); zf = lambda h: Vector((0, 0, h))
        strap = [d * (apo(1.05) + .012) + zf(1.05), d * 1.0 + zf(.84), d * 1.08 + zf(.80), d * 1.14 + zf(.77), d * 1.14 + zf(.47), d * 1.2 + zf(.445), d * 1.42 + zf(.445),
                 d * 1.47 + zf(.38), d * 1.47 + zf(.06), d * 1.53 + zf(.015), d * 1.80 + zf(.015), d * 1.9 + zf(.05)]
        add(sweep(strap, .05, 6, 'copper', u_m=1.5, squash=.2, up=tuple(d), smooth=True), 'Stormspire')
        stake = d * 1.95
        add(revolve([(.03, -.1), (.03, .14), (.022, .17), (0, .18)], 8, 'copper').xform(T(stake)), 'Stormspire')
        add(revolve([(.05, 0), (.058, .01), (.058, .07), (.05, .08)], 8, 'brass').xform(T(stake + Vector((0, 0, .02)))), 'Stormspire')
        node(f'Earth_{k}', stake + Vector((0, 0, .18)))

    # --- newt-sized door at the back (below the first coil turn) with a stone arch, brass ring and a tiny lamp
    dz0, dw, dh = .80, .26, .50
    dpts = [(-dw, dz0), (dw, dz0)] + [(math.cos(math.pi * i / 10) * dw, dz0 + dh - dw + math.sin(math.pi * i / 10) * dw) for i in range(11)]
    ry = -apo(1.05) - .005
    door3 = [(x, ry, zz) for x, zz in dpts]
    add(poly(door3[::-1], 'wood', (1, 0, 0), (0, 0, 1), u_m=1.6, v_span=dh, v0=dz0, solid=.04, normal=(0, -1, 0)), 'Stormspire')
    arch = [Vector((math.cos(math.pi * i / 12) * (dw + .05), ry - .01, dz0 + dh - dw + math.sin(math.pi * i / 12) * (dw + .05))) for i in range(13)]
    arch = [Vector((dw + .05, ry - .01, dz0))] + arch + [Vector((-dw - .05, ry - .01, dz0))]
    add(sweep(arch, .055, 4, 'plinth', u_m=.5, twist=math.pi / 4, smooth=False), 'Stormspire')
    for zb in (.14, .34):   # iron door straps
        add(box((0, ry - .03, dz0 + zb), (.44, .012, .025), 'iron'), 'Stormspire')
    add(torus(.03, .006, 10, 4, 'brass').xform(T(.12, ry - .05, dz0 + .26) @ rotX(math.pi / 2)), 'Stormspire')
    lamp = Vector((-dw - .14, ry - .05, dz0 + .48))
    add(sweep([lamp + Vector((.09, .05, .05)), lamp + Vector((.0, .0, .07))], .008, 4, 'iron'), 'Stormspire')
    add(revolve([(0, -.06), (.03, -.05), (.04, -.02), (.04, .03), (.02, .06), (0, .07)], 8, 'brass').xform(T(lamp)), 'Stormspire')
    add(revolve([(0, -.04), (.03, -.03), (.03, .03), (0, .04)], 8, 'white').xform(T(lamp)), 'Window', name='Door_Lamp')
    # a little wooden ladder from the grass to the deck (the newts' front path)
    lx = -.42; ly0, ly1 = -1.62, -1.12
    for sx in (-.1, .1):
        rail = [Vector((lx + sx, ly0, 0)), Vector((lx + sx, ly1, .82))]
        add(sweep(rail, .022, 5, 'wood', u_m=.5, twist=.3, smooth=False), 'Stormspire')
    for k in range(5):
        t = (k + .7) / 5.7; p = Vector((lx, ly0 + (ly1 - ly0) * t, .82 * t))
        add(sweep([p + Vector((-.1, 0, 0)), p + Vector((.1, 0, 0))], .014, 5, 'wood', u_m=.5, smooth=False), 'Stormspire')

    # --- windows: two arched lit windows and three round portholes under the crown (warm lamp light inside)
    def window(a, zc, w, h, round_=False, name=None):
        r = apo(zc) + .01; d = Vector((math.cos(a), math.sin(a), 0)); side = Vector((-d.y, d.x, 0)); up = Vector((0, 0, 1))
        if round_:
            ring = [side * math.cos(TAU * i / 14) * w + up * math.sin(TAU * i / 14) * w for i in range(14)]
        else:
            ring = [side * -w - up * h * .5, side * w - up * h * .5] + [side * math.cos(math.pi * i / 8) * w + up * (h * .5 - w + math.sin(math.pi * i / 8) * w) for i in range(9)]
        c = d * (r - .01) + up * zc
        pts = [c + q for q in ring]
        g = poly(pts, 'white', side, up, u_m=1, v_span=1)
        add(g, 'Window', name=name)
        frame = [c + d * .02 + q * 1.18 for q in (ring + ring[:1])] if round_ else [c + d * .02 + q * 1.15 for q in ring[1:] + [ring[0]]]
        add(sweep(frame, .035, 4, 'plinth', u_m=.4, twist=math.pi / 4, smooth=False), 'Stormspire')
        if not round_:
            add(sweep([c + d * .005 - up * h * .5, c + d * .005 + up * (h * .5)], .012, 4, 'iron'), 'Stormspire')
            add(sweep([c + d * .005 - side * w, c + d * .005 + side * w], .012, 4, 'iron'), 'Stormspire')
            add(box(c + d * .06 - up * (h * .5 + .03), (.06, w * 2.6, .05), 'plinth').xform(T(c) @ rotZ(a) @ T(-c)), 'Stormspire')
        else:
            add(sweep([c + d * .005 - side * w, c + d * .005 + side * w], .01, 4, 'iron'), 'Stormspire')
    window(math.radians(225), 3.185, .15, .40, name='Window_Glow')
    window(math.radians(-45), 3.185, .15, .40, name='Window_Glow_E')
    for k, a in enumerate((math.radians(45), math.radians(135), math.radians(270))):
        window(a, 4.72, .085, 0, round_=True)

    # --- the two circuits' ends: red (+) on the east face, blue (-) on the west. Each terminal is a ceramic bushing
    # threaded between two coil turns; each pack hangs on a brass shepherd's hook under it.
    for sgn, tag, cer in ((1, '', 'red'), (-1, '_B', 'blue')):
        lug = Vector((sgn * 1.34, 0, 1.85))
        wall = Vector((sgn * (apo(1.66) - .01), 0, 1.66)) if sgn > 0 else Vector((sgn * (apo(1.855) - .01), 0, 1.855))
        ax = (lug - wall).normalized(); L = (lug - wall).length
        M = T(wall) @ align_z(ax)
        add(revolve([(0, 0), (.08, 0), (.085, .02), (.06, .04)], 10, 'iron').xform(M), 'Stormspire')   # wall flange
        prof = [(.05, .03), (.06, .05), (.10, .09), (.06, .12), (.095, .16), (.055, .19), (.085, .23), (.05, .26), (.045, L - .10)]
        add(revolve(prof, 10, cer, smooth=True).xform(M), 'Stormspire')
        add(revolve([(0, L - .12), (.05, L - .12), (.055, L - .04), (.035, L - .02), (.035, L + .02), (0, L + .03)], 8, 'brass').xform(M), 'Stormspire')
        add(revolve([(.0, L - .085), (.075, L - .08), (.075, L - .06), (0, L - .055)], 6, 'brass', smooth=False).xform(M), 'Stormspire')  # wing nut
        node(f'CableTerminal{tag}', lug)
        # hook: iron back plate with a red/blue enamel shield, brass arm, curled tip with a ball
        hz = 1.31 if sgn > 0 else 1.42; hw = apo(hz) + .03
        RM = T(sgn * (hw - .03), 0, hz) @ rotY(sgn * math.pi / 2)   # round iron rosette with a red/blue enamel boss
        add(revolve([(0, 0), (.13, 0), (.13, .025), (.10, .045), (0, .045)], 12, 'iron', smooth=False).xform(RM), 'Stormspire')
        add(revolve([(0, .04), (.075, .04), (.07, .065), (0, .075)], 12, cer, smooth=True).xform(RM), 'Stormspire')
        sad = Vector((sgn * 1.25, 0, 1.375))
        hk = [Vector((sgn * (hw + .02), 0, hz)), Vector((sgn * (hw + .12), 0, hz - .005)), Vector((sgn * 1.18, 0, 1.36)), sad + Vector((0, 0, -.01)),
              Vector((sgn * 1.31, 0, 1.39)), Vector((sgn * 1.335, 0, 1.44)), Vector((sgn * 1.325, 0, 1.49))]
        add(sweep(hk, .024, 6, 'brass', u_m=.25), 'Stormspire')
        add(revolve([(0, -.035), (.035, -.02), (.035, .02), (0, .035)], 8, 'brass').xform(T(hk[-1])), 'Stormspire')
        node(f'PackHook{tag}', (sgn * 1.25, 0, 1.40))

    objs = build_objects()
    def tint(p, o):
        m = o.data.materials[0].name
        if m == 'Hat':
            k = .82 + .18 * min(1, max(0, (p.z - 5.2) / 2.6)); return (k, k, k * 1.02)
        g_ = .72 + .28 * min(1, max(0, p.z / 1.3))
        return (g_ * 1.0, g_ * .97, g_ * .93)
    bake_ao(objs, .9, 32, ground=0.0, tint=tint, skip=('Glass', 'Charge', 'Crystal', 'CrystalCore', 'Window'))
    return objs

# ================================================================== REEL PACK
# Contract (glTF -Z forward = the wearer's facing, +Y up, origin = PackAnchor between the shoulder blades):
#   Sway (new: everything below hangs from it; the runtime swings it with inertia, pivot at the carry handle),
#   Reel (spins about X; stormreel-view sets rotation.x from the paid-out length), Reel_Windings (child of Reel; the
#   runtime shrinks it radially as cable pays out), Crank + CrankKnob, Pawl (ratchet click), CableExit, CordAnchor,
#   Lamp + Lamp_Glow (tinted, pulsing), HangPoint (on the hook), ArcGap_A/B, PackAnchor.
PK = dict(C=Vector((0, -.19, -.15)), FR=.205, HW=.13, core=.07, wound=.158)
def build_pack():
    new_scene('ReelPack')
    C, FR, HW = PK['C'], PK['FR'], PK['HW']
    hang = Vector((0, -.045, .155))
    node('Sway', hang)
    node('PackAnchor', (0, 0, 0))
    S = 'Sway'
    # backboard: curved wooden planks, brass corner caps, a quilted leather pad against the wearer
    sec = []
    for i in range(9):
        x = -.16 + .32 * i / 8; sec.append((x, -.02 - .025 * (x / .16) ** 2))
    board = Geo(); zt, zb = .11, -.40
    A = [board.vert((x, y, zb)) for x, y in sec]; B = [board.vert((x, y, zt - .03 * (abs(x) > .12))) for x, y in sec]
    Af = [board.vert((x, y - .026, zb)) for x, y in sec]; Bf = [board.vert((x, y - .026, zt - .03 * (abs(x) > .12))) for x, y in sec]
    for i in range(8):
        u0, u1 = i / 8 * .9, (i + 1) / 8 * .9
        uvq = ((u0, strip_v('board', 0)), (u1, strip_v('board', 0)), (u1, strip_v('board', 1)), (u0, strip_v('board', 1)))
        board.face((A[i + 1], A[i], B[i], B[i + 1]), uvq, False)
        board.face((Af[i], Af[i + 1], Bf[i + 1], Bf[i]), uvq, False)
        board.face((B[i], Bf[i], Bf[i + 1], B[i + 1]), ((u0, strip_v('board', .95)), (u0, strip_v('board', 1)), (u1, strip_v('board', 1)), (u1, strip_v('board', .95))), False)
        board.face((A[i + 1], Af[i + 1], Af[i], A[i]), ((u0, strip_v('board', 0)), (u0, strip_v('board', .05)), (u1, strip_v('board', .05)), (u1, strip_v('board', 0))), False)
    for (a0, b0, a1, b1) in ((A[0], B[0], Af[0], Bf[0]), (A[-1], B[-1], Af[-1], Bf[-1])):
        board.face((a0, b0, b1, a1), ((0, strip_v('board', 0)), (0, strip_v('board', 1)), (.03, strip_v('board', 1)), (.03, strip_v('board', 0))), False)
    add(board, 'PackAtlas', at=S)
    add(box((0, -.01, -.14), (.24, .022, .40), 'leather', u_m=.3, chamfer=.01), 'PackAtlas', at=S)
    for zq in (-.03, -.14, -.25):
        add(box((0, .002, zq), (.245, .004, .012), 'leather', u_m=.3), 'PackAtlas', at=S)
    for x in (-.155, .155):
        for zc in (zt - .02, zb + .015):
            add(box((x, -.033, zc), (.03, .034, .035), 'brass', chamfer=.008), 'PackAtlas', at=S)
    # iron J-frame: two side rails, kicked back at the foot so the pack can lie on its back or stand
    for s in (-1, 1):
        rail = bezier((s * .17, -.04, .12), (s * .18, -.06, -.05), (s * .18, -.06, -.32), (s * .17, -.05, -.42), 8)
        rail += [Vector((s * .17, -.12, -.45)), Vector((s * .17, -.22, -.44))]
        add(sweep(rail, .012, 6, 'iron', u_m=.3), 'PackAtlas', at=S)
        add(revolve([(0, -.012), (.016, -.012), (.018, 0), (.016, .012), (0, .012)], 6, 'rubber').xform(T(s * .17, -.225, -.44) @ rotX(math.pi / 2)), 'PackAtlas', at=S)
        # bearing arm out to the drum axle
        arm = bezier((s * .175, -.05, -.06), (s * .18, -.10, -.08), (s * .175, C.y + .02, C.z + .05), (s * .17, C.y, C.z), 6)
        add(sweep(arm, .013, 6, 'iron', u_m=.3, squash=.7), 'PackAtlas', at=S)
        add(revolve([(0, -.02), (.03, -.02), (.034, -.01), (.034, .01), (.03, .02), (0, .02)], 10, 'brass').xform(T(s * .165, C.y, C.z) @ rotY(math.pi / 2)), 'PackAtlas', at=S)
    add(sweep([Vector((-.17, -.045, .12)), Vector((.17, -.045, .12))], .012, 6, 'iron', u_m=.3), 'PackAtlas', at=S)
    add(sweep([Vector((-.17, -.05, -.42)), Vector((.17, -.05, -.42))], .011, 6, 'iron', u_m=.3), 'PackAtlas', at=S)
    # carry handle (the tower hook goes through it): HangPoint at its inside top
    hd = bezier((-.06, -.045, .12), (-.06, -.045, .19), (.06, -.045, .19), (.06, -.045, .12), 8)
    add(sweep(hd, .011, 6, 'brass', u_m=.2), 'PackAtlas', at=S)
    add(sweep(bezier((-.035, -.045, .165), (-.03, -.045, .178), (.03, -.045, .178), (.035, -.045, .165), 5), .016, 6, 'rubber', u_m=.2), 'PackAtlas', at=S)
    node('HangPoint', hang, parent=S)
    # shoulder straps: padded leather over the shoulders, brass buckles; short lower straps
    for s in (-1, 1):
        st = bezier((s * .1, -.03, .09), (s * .1, .06, .17), (s * .12, .15, .11), (s * .125, .165, -.03), 10)
        add(sweep(st, .026, 6, 'leather', u_m=.25, squash=.32, up=(1, 0, 0), twist=0), 'PackAtlas', at=S)
        p = st[6]; add(box(p + Vector((0, .006, 0)), (.05, .012, .034), 'brass', chamfer=.006).xform(T(p) @ rotX(-.7) @ T(-p)), 'PackAtlas', at=S)
        lo = bezier((s * .13, -.03, -.36), (s * .14, .05, -.37), (s * .15, .12, -.3), (s * .14, .15, -.2), 6)
        add(sweep(lo, .02, 6, 'leather', u_m=.25, squash=.3, up=(1, 0, 0)), 'PackAtlas', at=S)

    # --- the drum (Reel): brass rims, five lightning-bolt spokes per flange, domed hubs, windings on a copper core
    node('Reel', C, parent=S)
    R = 'Reel'
    def onX(g, x): return g.xform(T(x, C.y, C.z) @ rotY(math.pi / 2))
    for s in (-1, 1):
        x = s * HW
        rim = revolve([(FR - .018, -.012), (FR, -.01), (FR + .006, 0), (FR, .01), (FR - .018, .012), (FR - .022, 0)], 30, 'brass', reps=3, smooth=True)
        add(onX(rim, x), 'PackAtlas', at=R)
        for k in range(5):
            a = TAU * k / 5 + (.3 if s > 0 else .9)
            zz = [(.045, 0), (.10, .025), (.115, -.012), (FR - .02, .015)]
            pts = [Vector((math.cos(a) * r + -math.sin(a) * o, math.sin(a) * r + math.cos(a) * o, 0)) for r, o in zz]
            g = sweep(pts, .011, 4, 'brass', u_m=.2, squash=.45, up=(0, 0, 1), smooth=False)
            add(onX(g, x), 'PackAtlas', at=R)
        hub = revolve([(0, -.03 * s), (.05, -.03 * s), (.058, -.015 * s), (.058, .01 * s), (.045, .02 * s), (0, .03 * s)][::(1 if s > 0 else -1)], 12, 'brass', reps=2)
        add(onX(hub, x), 'PackAtlas', at=R)
        add(onX(revolve([(0, .03 * s), (.03, .03 * s), (.03, .036 * s), (0, .04 * s)][::(1 if s > 0 else -1)], 10, 'tintc'), x), 'Cable', at=R)
    add(onX(revolve([(PK['core'], -HW), (PK['core'], HW)], 14, 'copper', reps=2, smooth=True), 0), 'PackAtlas', at=R)
    # ratchet ring (12 teeth) inside the right flange
    teeth = Geo(); nt = 12
    pr = []
    for k in range(nt):
        a0 = TAU * k / nt; a1 = TAU * (k + .85) / nt
        pr += [(math.cos(a0) * .062, math.sin(a0) * .062), (math.cos(a1) * .08, math.sin(a1) * .08)]
    g = prism(pr, -.008, .008, 'iron', u_m=.1, smooth=False)
    add(g.xform(T(HW - .03, C.y, C.z) @ rotY(math.pi / 2)), 'PackAtlas', at=R)
    # windings: one bumpy lathe (12 wraps), braided jacket, tinted by pole; child of Reel so it spins
    node('Reel_Windings', C, parent=R)
    wraps = 12; prof = []
    for i in range(wraps * 2 + 1):
        x = -HW + .006 + (2 * HW - .012) * i / (wraps * 2)
        prof.append((PK['wound'] if i % 2 else PK['wound'] - .005, x))
    prof = [(PK['core'] + .002, -HW + .006)] + prof + [(PK['core'] + .002, HW - .006)]
    g = revolve(prof, 15, 'braid', reps=3, vmode=('stretch',), smooth=True)
    add(g.xform(T(C) @ rotY(math.pi / 2)), 'Cable', at='Reel_Windings', name='Reel_Windings_Cable')

    # --- crank on the left hub (geared 1:1 with the drum), wooden knob
    node('Crank', (-HW - .05, C.y, C.z), parent=S)
    cx = -HW - .055
    arm = [Vector((cx, C.y, C.z)), Vector((cx - .004, C.y + .05, C.z + .03)), Vector((cx - .006, C.y + .1, C.z + .02))]
    add(sweep(arm, .011, 6, 'iron', u_m=.2, squash=.6, up=(1, 0, 0)), 'PackAtlas', at='Crank')
    add(revolve([(0, 0), (.02, 0), (.022, .01), (0, .012)], 10, 'brass').xform(T(cx + .006, C.y, C.z) @ rotY(-math.pi / 2)), 'PackAtlas', at='Crank')
    kp = arm[-1]
    node('CrankKnob', kp, parent='Crank')
    add(revolve([(0, 0), (.012, 0), (.016, .02), (.014, .045), (.009, .055), (0, .056)], 10, 'wood').xform(T(kp) @ rotY(-math.pi / 2)), 'PackAtlas', at='CrankKnob')
    # ratchet pawl on the right bearing arm (rides the teeth; the runtime clicks it as the drum turns)
    pv = Vector((HW + .01, C.y + .03, C.z + .10))
    node('Pawl', pv, parent=S)
    add(prism([(y, z) for y, z in [(.008, 0), (-.008, 0), (-.012, -.032), (-.002, -.05), (.006, -.03)]], -.005, .005, 'iron', u_m=.1).xform(T(pv) @ rotY(math.pi / 2) @ rotZ(math.pi / 2)), 'PackAtlas', at='Pawl')
    add(revolve([(0, -.008), (.008, -.008), (.008, .008), (0, .008)], 8, 'brass').xform(T(pv) @ rotY(math.pi / 2)), 'PackAtlas', at=S)

    # --- slip-ring housing on the right hub and the coiled cord to the crossbow
    sx = HW + .045
    add(revolve([(0, 0), (.032, 0), (.034, .01), (.034, .045), (.03, .05), (0, .05)], 12, 'brass', reps=2).xform(T(sx, C.y, C.z) @ rotY(math.pi / 2)), 'PackAtlas', at=S)
    for k in range(2):
        add(revolve([(.0345, 0), (.037, .004), (.037, .01), (.0345, .014)], 12, 'tintc').xform(T(sx + .012 + k * .018, C.y, C.z) @ rotY(math.pi / 2)), 'Cable', at=S)
    cs = Vector((sx + .05, C.y, C.z))
    cord = [cs + Vector((.004 + .05 * t, math.cos(TAU * 5 * t) * .013 + .05 * t, math.sin(TAU * 5 * t) * .013 - .07 * t)) for t in (i / 50 for i in range(51))]
    add(sweep(cord, .0055, 4, 'braid', u_m=.08), 'Cable', at=S)
    node('CordAnchor', cord[-1], parent=S)

    # --- top shelf: glass "live" lamp (left) and a knife switch between two tinted insulators (right)
    lp = Vector((-.1, -.085, .135))
    add(revolve([(0, 0), (.032, 0), (.036, .012), (.026, .02), (0, .02)], 12, 'brass').xform(T(lp)), 'PackAtlas', at=S)
    add(box(lp + Vector((.04, .03, -.012)), (.11, .07, .014), 'iron', chamfer=.01), 'PackAtlas', at=S)
    gl = lp + Vector((0, 0, .055))
    add(revolve([(0, -.035), (.026, -.03), (.03, -.005), (.024, .02), (.012, .034), (0, .037)], 12, 'tintc', smooth=True).xform(T(gl)), 'Lamp', at=S, name='Lamp_Glow')
    node('Lamp', gl, parent=S)
    for k in range(4):
        a = TAU * k / 4 + .4
        wire = [gl + Vector((math.cos(a) * .028, math.sin(a) * .028, -.035)), gl + Vector((math.cos(a) * .034, math.sin(a) * .034, 0)), gl + Vector((0, 0, .045))]
        add(sweep(bezier(wire[0], wire[1], wire[1] + Vector((0, 0, .03)), wire[2], 5), .0025, 4, 'brass', u_m=.1), 'PackAtlas', at=S)
    add(revolve([(0, 0), (.008, 0), (.006, .012), (0, .014)], 6, 'brass').xform(T(gl + Vector((0, 0, .045)))), 'PackAtlas', at=S)
    sb = Vector((.075, -.09, .13))
    add(box(sb, (.12, .06, .03), 'iron', chamfer=.008), 'PackAtlas', at=S)
    for s, nm in ((-1, 'A'), (1, 'B')):
        ins = sb + Vector((s * .035, 0, .015))
        add(revolve([(0, 0), (.011, 0), (.014, .008), (.009, .015), (.012, .022), (.007, .03), (0, .032)], 8, 'tintc').xform(T(ins)), 'Cable', at=S)
        node(f'ArcGap_{nm}', ins + Vector((0, 0, .036)), parent=S)
    lev = bezier(sb + Vector((-.035, 0, .05)), sb + Vector((-.01, 0, .07)), sb + Vector((.02, -.01, .08)), sb + Vector((.045, -.02, .085)), 5)
    add(sweep(lev, .004, 5, 'copper', u_m=.1), 'PackAtlas', at=S)
    add(revolve([(0, -.012), (.009, -.008), (.009, .008), (0, .012)], 8, 'rubber').xform(T(lev[-1]) @ rotY(math.pi / 2)), 'PackAtlas', at=S)
    add(zigzag(.05, .004, 'gold').xform(T(0, -.075, -.36) @ rotZ(-math.pi / 2)), 'PackAtlas', at=S)

    # --- fairlead under the drum: two ceramic rollers between iron cheeks; the tower cable leaves here
    fl = Vector((0, C.y - .06, C.z - FR - .06))
    for dz in (-.017, .017):
        add(revolve([(0, -.05), (.011, -.05), (.013, -.04), (.013, .04), (.011, .05), (0, .05)], 10, 'white').xform(T(fl + Vector((0, 0, dz))) @ rotY(math.pi / 2)), 'PackAtlas', at=S)
    for s in (-1, 1):
        add(box((s * .058, fl.y, fl.z), (.01, .05, .07), 'iron', chamfer=.012), 'PackAtlas', at=S)
        add(sweep([Vector((s * .058, fl.y + .02, fl.z + .03)), Vector((s * .17, C.y + .1, C.z - .14)), Vector((s * .175, -.06, -.36))], .007, 5, 'iron', u_m=.2), 'PackAtlas', at=S)
    lead = bezier(C + Vector((0, -.05, -PK['wound'] + .02)), C + Vector((0, -.07, -PK['wound'] - .02)), fl + Vector((0, .005, .03)), fl, 6)
    add(sweep(lead, .0095, 8, 'braid', u_m=.1), 'Cable', at=S)
    tail = bezier(fl, fl + Vector((0, -.02, -.03)), fl + Vector((0, -.05, -.06)), fl + Vector((0, -.055, -.10)), 5)
    add(sweep(tail, .0095, 8, 'braid', u_m=.1), 'Cable', at=S)
    add(revolve([(.0095, 0), (.014, .004), (.014, .02), (.0095, .024)], 10, 'rubber').xform(T(tail[-2]) @ align_z(tail[-1] - tail[-2])), 'PackAtlas', at=S)
    node('CableExit', tail[-1], parent=S)

    objs = build_objects()
    bake_ao(objs, .12, 32, ground=None, skip=('Lamp',))
    return objs

# ================================================================== export + repack (materials, textures, quantization)
def mat_defs(kind):
    tex = {'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 2}, 'metallicFactor': 1, 'roughnessFactor': 1},
           'normalTexture': {'index': 1, 'scale': 1.0}, 'occlusionTexture': {'index': 2, 'strength': .85}}
    glow = lambda base, em, k: {'pbrMetallicRoughness': {'baseColorFactor': base + [1], 'metallicFactor': 0, 'roughnessFactor': .12},
                               'emissiveFactor': em, 'extensions': {'KHR_materials_emissive_strength': {'emissiveStrength': k}}}
    if kind == 'tower':
        return {'Stormspire': tex, 'Coil': tex, 'Hat': tex,
                'Glass': {'pbrMetallicRoughness': {'baseColorFactor': [.82, .94, 1, .16], 'metallicFactor': 0, 'roughnessFactor': .04}, 'alphaMode': 'BLEND'},
                'Charge': glow([.2, .62, 1], [.06, .45, 1], 1.2), 'Crystal': glow([.45, .26, .88], [.5, .22, 1], .9),
                'CrystalCore': glow([.5, .5, 1], [.35, .55, 1], 1.0), 'Window': glow([1, .8, .5], [1, .55, .18], 1.05)}
    return {'PackAtlas': tex, 'Cable': tex, 'Lamp': glow([.85, .92, 1], [.5, .8, 1], 1.6)}

def repack(path, kind, tex_paths):
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            if 'NORMAL' in at: conv[at['NORMAL']] = 'normal'
            if 'COLOR_0' in at: conv[at['COLOR_0']] = 'colour'
            if 'TEXCOORD_1' in at: conv[at['TEXCOORD_1']] = 'uv1'
            if 'TEXCOORD_0' in at: conv[at['TEXCOORD_0']] = 'uv0'
    out = bytearray(); views = []
    def push(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    for ai, a in enumerate(doc['accessors']):
        data = read(ai); kind_ = conv.get(ai); target = doc['bufferViews'][a['bufferView']].get('target'); a.pop('byteOffset', None)
        if kind_ == 'normal':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], 1)
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None); a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind_ == 'colour':
            q = np.clip(np.round(data[:, :3] * 255), 0, 255).astype(np.uint8); q = np.concatenate([q, np.full((len(q), 1), 255, np.uint8)], 1)
            a.update(componentType=5121, normalized=True, type='VEC4'); a.pop('min', None); a.pop('max', None); a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind_ == 'uv1':   # shader parameters in 0..1: 16-bit
            q = np.clip(np.round(data * 65535), 0, 65535).astype(np.uint16)
            a.update(componentType=5123, normalized=True); a.pop('min', None); a.pop('max', None); a['bufferView'] = push(q.tobytes(), target)
        else:
            a['bufferView'] = push(data.astype(CT[a['componentType']]).tobytes(), target)
    # textures: three JPEGs shared by every textured material
    doc['images'] = []; doc['textures'] = []; doc['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    for key in ('base', 'normal', 'orm'):
        data = open(tex_paths[key], 'rb').read()
        doc['images'].append({'bufferView': push(data), 'mimeType': 'image/jpeg', 'name': f'{kind}_{key}'})
        doc['textures'].append({'source': len(doc['images']) - 1, 'sampler': 0})
    defs = mat_defs(kind)
    for m in doc['materials']:
        d = defs[m['name']]; name = m['name']; m.clear(); m.update(json.loads(json.dumps(d))); m['name'] = name
    doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(out)}]
    ext = {'KHR_mesh_quantization', 'KHR_materials_emissive_strength'}
    doc['extensionsUsed'] = sorted(set(doc.get('extensionsUsed', [])) | ext); doc['extensionsRequired'] = ['KHR_mesh_quantization']
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(out) % 4: out.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob)
    return doc

def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                              export_normals=True, export_texcoords=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_extras=False, export_image_format='NONE', export_animations=False)

REPORT = {}
def run(kind):
    global ROWS, ATLAS_H
    tdir = os.path.join(OUT, 'textures'); os.makedirs(tdir, exist_ok=True)
    if kind == 'tower':
        ATLAS_H = 1024; ROWS, paths = TX.assemble(1024, 1024, tower_layout(), os.path.join(tdir, 'stormspire'))
        objs = build_tower(); out = os.path.join(OUT, 'stormspire.glb')
    else:
        ATLAS_H = 512; ROWS, paths = TX.assemble(512, 512, pack_layout(), os.path.join(tdir, 'reel_pack'))
        objs = build_pack(); out = os.path.join(OUT, 'reel_pack.glb')
    tris = tri_count(objs); mats = sorted({o.data.materials[0].name for o in objs})
    export(out); doc = repack(out, kind, paths)
    nodes = sorted(n['name'] for n in doc['nodes'])
    REPORT[kind] = {'by_object': {o.name: tri_count([o]) for o in objs}, 'triangles': tris, 'materials': mats, 'meshes': len(doc['meshes']), 'primitives': sum(len(m['primitives']) for m in doc['meshes']),
                    'bytes': os.path.getsize(out), 'texture_bytes': {k: os.path.getsize(p) for k, p in paths.items()}, 'nodes': nodes}
    print(kind, json.dumps({k: v for k, v in REPORT[kind].items() if k not in ('nodes',)}))

if PART in ('tower', 'all'): run('tower')
if PART in ('pack', 'all'): run('pack')
REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print('STORMSPIRE_BUILD_OK', REPORT['seconds'])
