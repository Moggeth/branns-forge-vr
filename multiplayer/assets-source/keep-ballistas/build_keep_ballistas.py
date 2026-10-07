"""Keep ballistas: Sunlance (Dawnhold) and Gnashjaw (Grumblekeep). Deterministic bpy builder.

    pip install bpy==5.1.*        (4.5 also works)
    python3 build_keep_ballistas.py [--out DIR]       -> keep_ballistas.glb + build_report.json
    cp keep_ballistas.glb ../../public/assets/

Blender axes: +X right, +Y forward (out of the muzzle), +Z up. glTF/three: +X right, -Z forward, +Y up.
Everything is flat-shaded, chamfered and coloured per vertex over a handful of shared materials so each moving
node is one or two draws.

Node tree (prefix S = Sunlance, G = Gnashjaw):
  S_Root
    S_Base                fixed octagonal plinth
    S_Turret              yaw pivot (Z axis) on the plinth top
      S_Crank             winding wheel (spins about X)
      S_Cradle            elevation trunnion (pitch about X)
        S_WingL / S_WingR golden wing limbs, flex about Z at the root; S_WingL_Tip / S_WingR_Tip hold the string
        S_Nock            empty: where the loaded bolt's nock and the drawn string sit
        S_Muzzle          empty: the sun crest's centre, where bolts leave
        S_Sight           empty: the operator's sighting eye over the stock
  S_Bolt                  Sunlance bolt, origin at the nock, points +Y
  G_Root
    G_Base
    G_Turret
      G_Drum              chain drum and crank (spins about X)
      G_Cradle            the iron beam with the big skull on the front
        G_Jaw             the skull's lower jaw (hinges about X)
        G_HornL / G_HornR horn limbs, flex about Z; G_HornL_Tip / G_HornR_Tip hold the string
        G_Nock, G_Muzzle, G_Sight
  G_Harpoon               barbed harpoon, origin at the chain ring, points +Y
"""
import json
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------------------------------------------
# Colours and materials
# ---------------------------------------------------------------------------------------------------------------
def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    """sRGB hex to linear RGBA: vertex colours are stored and exported linear (glTF COLOR_0 is linear)."""
    return (lin((h >> 16 & 255) / 255), lin((h >> 8 & 255) / 255), lin((h & 255) / 255), 1.0)


C = {
    # Dawnhold: ivory stone, polished brass, walnut, royal enamel, blue resonance light, a gold sun glow.
    'ivory': hexc(0xEDE5D2), 'ivory2': hexc(0xD4C7AA), 'brass': hexc(0xE0AE4C), 'bronze': hexc(0x9A6A34),
    'walnut': hexc(0x6E4526), 'enamel': hexc(0x2C66C8), 'leather': hexc(0x5A3420),
    # Grumblekeep: slate, blackened iron, bone, horn, socket black.
    'slate': hexc(0x4C4456), 'slate2': hexc(0x342D3B), 'iron': hexc(0x4A4452), 'iron2': hexc(0x2E2A34),
    'rust': hexc(0x6A4048), 'bone': hexc(0xEDE0C2), 'bone2': hexc(0xC9B993), 'horn': hexc(0x3A3040), 'horn2': hexc(0x5E5066),
    'socket': hexc(0x1A0F1E), 'gum': hexc(0x7A3046),
    'white': (1, 1, 1, 1),
}

MATS = {}


def material(name, metal, rough, emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:  # Blender 5 materials always use nodes
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        bsdf.inputs['Base Color'].default_value = emit
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = strength
    else:
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    MATS[name] = m
    return m


def make_materials():
    material('KBMetal', 1.0, 0.32)
    material('KBMatte', 0.0, 0.72)
    material('KBGlowBlue', 0.0, 0.3, hexc(0x5FB4FF), 3.0)
    material('KBSun', 0.0, 0.3, hexc(0xFFC65A), 2.0)        # the Sunlance charge glow (the view drives its strength)
    material('KBGlowPurple', 0.0, 0.3, hexc(0xB46CFF), 3.0)
    material('KBOoze', 0.0, 0.35, hexc(0x8CFF4A), 2.5)      # Gnashjaw's eyes and barb glow (the view pulses it)


METAL = {'brass', 'bronze', 'iron', 'iron2', 'rust'}
GLOWS = {'blue': 'KBGlowBlue', 'sun': 'KBSun', 'purple': 'KBGlowPurple', 'ooze': 'KBOoze'}


def mat_for(col):
    if col in GLOWS:
        return GLOWS[col]
    return 'KBMetal' if col in METAL else 'KBMatte'


# ---------------------------------------------------------------------------------------------------------------
# Geometry: everything is built in machine space as bmesh pieces, then emitted into a node's builder.
# ---------------------------------------------------------------------------------------------------------------
class Node:
    def __init__(self, name, pivot=(0, 0, 0), parent=None):
        self.name, self.pivot, self.parent = name, Vector(pivot), parent
        self.verts, self.faces, self.empties = [], [], {}

    def emit(self, bm, col):
        bm.verts.ensure_lookup_table()
        base = len(self.verts)
        for v in bm.verts:
            self.verts.append(v.co - self.pivot)
        for f in bm.faces:
            self.faces.append(([base + v.index for v in f.verts], mat_for(col), C.get(col, C['white'])))
        bm.free()

    def anchor(self, name, at):
        self.empties[name] = Vector(at)


def bm_from(verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(v)) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm.normal_update()
    return bm


def chamfer(bm, amount, angle=0.6):
    if amount <= 0:
        return bm
    edges = [e for e in bm.edges if e.is_manifold and len(e.link_faces) == 2 and e.calc_face_angle(0) > angle]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=amount, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def xform(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def T(x=0, y=0, z=0):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1))


def box(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    xform(bm, S(sx, sy, sz))
    return chamfer(bm, bevel)


def cyl(r1, r2, h, n=8, bevel=0.0, cap=True):
    """Upright cylinder/cone from z=0 to z=h."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=n, radius1=r1, radius2=r2, depth=h)
    xform(bm, T(0, 0, h / 2))
    return chamfer(bm, bevel)


def ico(r, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    return bm


def crystal(r, h_up, h_down, n=6):
    """Faceted bipyramid gem along +Z."""
    verts = [(math.cos(a) * r, math.sin(a) * r, 0) for a in (i / n * math.tau for i in range(n))]
    verts += [(0, 0, h_up), (0, 0, -h_down)]
    faces = [(i, (i + 1) % n, n) for i in range(n)] + [((i + 1) % n, i, n + 1) for i in range(n)]
    return bm_from(verts, faces)


def prism(poly, depth, axis='X', bevel=0.0):
    """Extrude a 2D polygon (counter-clockwise) by depth, centred. axis X: poly is (y, z); axis Z: poly is (x, y); axis Y: (x, z)."""
    n, h = len(poly), depth / 2
    pts = []
    for s in (-h, h):
        for a, b in poly:
            pts.append({'X': (s, a, b), 'Y': (a, s, b), 'Z': (a, b, s)}[axis])
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    bm = bm_from(pts, faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return chamfer(bm, bevel)


def loft(rings, cap0=True, cap1=True):
    """Quads between consecutive rings (lists of equal-length point lists)."""
    n = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = []
    for r in range(len(rings) - 1):
        a, b = r * n, (r + 1) * n
        faces += [(a + i, a + (i + 1) % n, b + (i + 1) % n, b + i) for i in range(n)]
    if cap0:
        faces.append(tuple(range(n))[::-1])
    if cap1:
        last = (len(rings) - 1) * n
        faces.append(tuple(range(last, last + n)))
    bm = bm_from(verts, faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def sweep(path, section, up=(0, 0, 1)):
    """Sweep a section along a polyline. section(i, t) -> list of (u, v) in the (side, up) frame at path point i."""
    rings, upv = [], Vector(up)
    for i, p in enumerate(path):
        p = Vector(p)
        a = Vector(path[max(0, i - 1)])
        b = Vector(path[min(len(path) - 1, i + 1)])
        tan = (b - a).normalized()
        side = tan.cross(upv)
        if side.length < 1e-6:
            side = tan.cross(Vector((0, 1, 0)))
        side.normalize()
        u = side.cross(tan).normalized()
        t = i / (len(path) - 1)
        rings.append([p + side * su + u * sv for su, sv in section(i, t)])
    return loft(rings)


def ngon(n, rx, ry=None, rot=0.0):
    ry = rx if ry is None else ry
    return [(math.cos(rot + i / n * math.tau) * rx, math.sin(rot + i / n * math.tau) * ry) for i in range(n)]


def ring(R_, r_w, r_h, n=16, axis='Y'):
    """Faceted square-section ring of radius R_, lying in the plane normal to axis."""
    rings = []
    for i in range(n):
        a = i / n * math.tau
        c, s = math.cos(a), math.sin(a)
        pts = []
        for dr, dz in ((-r_w, -r_h), (r_w, -r_h), (r_w, r_h), (-r_w, r_h)):
            rr = R_ + dr
            if axis == 'Y':
                pts.append((c * rr, dz, s * rr))
            elif axis == 'Z':
                pts.append((c * rr, s * rr, dz))
            else:
                pts.append((dz, c * rr, s * rr))
        rings.append(pts)
    verts = [p for r in rings for p in r]
    faces = []
    for i in range(n):
        a, b = i * 4, ((i + 1) % n) * 4
        faces += [(a + k, b + k, b + (k + 1) % 4, a + (k + 1) % 4) for k in range(4)]
    bm = bm_from(verts, faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mirror_x(bm):
    xform(bm, S(-1, 1, 1))
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def dup(bm):
    return bm.copy()


# ---------------------------------------------------------------------------------------------------------------
# Sunlance (Dawnhold): an ivory and brass sun-crested ballista with golden wing limbs.
# ---------------------------------------------------------------------------------------------------------------
S_TURRET_Z = 0.62
S_TRUNNION = (0, 0, 1.52)
S_BOLT_Z = 0.13          # bolt axis above the trunnion (cradle local)
S_NOCK_Y = -0.62         # drawn string / loaded nock (cradle local)
S_CREST_Y = 1.22
S_WING_ROOT = (0.2, 0.98, S_BOLT_Z)


def sun_wing(side):
    """One wing limb in machine space, root at the origin, reaching out along +X (side=1): a fan of faceted feathers."""
    out = []

    def blade(chord, thick, ridge):
        def sec(i, t):
            c = chord * (1 - 0.75 * t ** 1.2) + 0.025
            h = thick * (1 - 0.6 * t) + 0.008
            r = ridge * (1 - 0.7 * t)
            # a lozenge: sharp leading edge, raised keel on top
            return [(c * 0.55, 0), (c * 0.15, h + r), (-c * 0.45, h * 0.6), (-c * 0.5, -h * 0.5), (c * 0.1, -h)]
        return sec

    def feather(length, sweep_deg, lift, bow):
        a = math.radians(sweep_deg)
        pts = []
        for k in range(6):
            t = k / 5
            x, y = length * t, -bow * math.sin(t * math.pi) * 0.5 - (length * t) * 0.08 * t
            z = lift * t ** 1.5
            pts.append((x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a), z))
        return pts

    # The leading primary is polished brass; the trailing feathers fan back in ivory with brass tips.
    fan = ((1.78, 14, 0.42, 0.1, 0.32, 'brass'), (1.6, 24, 0.34, 0.09, 0.26, 'ivory'), (1.38, 34, 0.26, 0.08, 0.22, 'ivory'),
           (1.12, 45, 0.18, 0.06, 0.19, 'ivory'), (0.84, 57, 0.1, 0.05, 0.16, 'ivory'))
    tip = None
    for n, (L, sw, lift, bow, chord, col) in enumerate(fan):
        pts = feather(L, sw, lift, bow)
        pts = [(x, y, z - n * 0.022) for x, y, z in pts]
        out.append((sweep(pts, blade(chord, 0.05 if n == 0 else 0.035, 0.035 if n == 0 else 0.018)), col))
        end = Vector(pts[-1])
        if n == 0:
            tip = end
            inlay = [(x, y + 0.03, z + 0.055 * (1 - k / 5)) for k, (x, y, z) in enumerate(pts[:-1])]
            out.append((sweep(inlay, lambda i, t: [(0.022, 0), (0, 0.012), (-0.022, 0), (0, -0.004)]), 'blue'))
        else:
            d = (end - Vector(pts[-2])).normalized()
            out.append((xform(cyl(0.035, 0.0, 0.14, 4), T(*end) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()), 'brass'))
    # Root collar, a brass covert plate over the feather roots, and the blue crystal nock at the primary's tip.
    out.append((xform(cyl(0.09, 0.09, 0.18, 8, 0.01), T(0, 0, -0.09)), 'bronze'))
    out.append((xform(prism([(0.0, 0.1), (0.42, 0.04), (0.5, -0.12), (0.3, -0.3), (0.0, -0.12)], 0.06, 'Z', 0.01), T(0, 0, 0.02)), 'brass'))
    d = (tip - Vector(feather(*fan[0][:4])[-2])).normalized()
    out.append((xform(crystal(0.05, 0.12, 0.05, 6), T(*tip) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()), 'blue'))
    if side < 0:
        for bm, _ in out:
            mirror_x(bm)
    return out, Vector((tip.x * side, tip.y, tip.z))


def build_sunlance(nodes):
    root = Node('S_Root')
    base = Node('S_Base', (0, 0, 0), root)
    turret = Node('S_Turret', (0, 0, S_TURRET_Z), root)
    crank = Node('S_Crank', (0.56, -0.12, S_TURRET_Z + 0.52), turret)
    tz = S_TRUNNION[2]
    cradle = Node('S_Cradle', S_TRUNNION, turret)
    wl = Node('S_WingL', (-S_WING_ROOT[0], S_WING_ROOT[1], tz + S_WING_ROOT[2]), cradle)
    wr = Node('S_WingR', (S_WING_ROOT[0], S_WING_ROOT[1], tz + S_WING_ROOT[2]), cradle)

    # --- plinth: stepped octagonal ivory drum with a brass band and blue studs
    base.emit(xform(cyl(1.16, 1.12, 0.12, 8, 0.02), R('Z', 22.5)), 'ivory2')
    base.emit(xform(cyl(1.02, 0.94, 0.46, 8, 0.025), T(0, 0, 0.1) @ R('Z', 22.5)), 'ivory')
    base.emit(xform(cyl(0.985, 0.975, 0.08, 8, 0.008), T(0, 0, 0.4) @ R('Z', 22.5)), 'brass')
    base.emit(xform(cyl(0.93, 0.9, 0.06, 8, 0.01), T(0, 0, 0.56) @ R('Z', 22.5)), 'bronze')
    for i in range(8):
        a = math.radians(i * 45)
        c, s = math.cos(a), math.sin(a)
        base.emit(xform(crystal(0.05, 0.08, 0.08, 4), T(c * 0.99, s * 0.99, 0.44) @ R('Z', i * 45) @ R('Y', 90)), 'blue')
        # carved fins down each face
        base.emit(xform(box(0.05, 0.08, 0.26, 0.01), T(math.cos(a + 0.39) * 0.97, math.sin(a + 0.39) * 0.97, 0.24) @ R('Z', math.degrees(a + 0.39))), 'ivory2')

    # --- turret: bronze turntable, angular ivory cheeks with brass trims, trunnion caps and the winding wheel
    z0 = S_TURRET_Z
    turret.emit(xform(cyl(0.82, 0.8, 0.1, 16, 0.012), T(0, 0, z0)), 'bronze')
    turret.emit(xform(cyl(0.6, 0.56, 0.06, 16, 0.01), T(0, 0, z0 + 0.1)), 'brass')
    cheek = [(-0.5, 0.12), (0.42, 0.12), (0.34, 0.5), (0.16, 1.02), (-0.06, 1.1), (-0.28, 0.98), (-0.52, 0.48)]
    for sx in (-1, 1):
        turret.emit(xform(prism(cheek, 0.11, 'X', 0.02), T(sx * 0.36, 0, z0)), 'ivory')
        trim = [(y, z) for y, z in cheek[2:6]]
        path = [(sx * 0.36, y, z0 + z + 0.035) for y, z in trim]
        turret.emit(sweep(path, lambda i, t: [(0.07, -0.02), (0.07, 0.02), (-0.07, 0.02), (-0.07, -0.02)], up=(1, 0, 0)), 'brass')
        turret.emit(xform(cyl(0.15, 0.15, 0.1, 8, 0.015), T(sx * 0.47, 0, tz) @ R('Y', 90) @ T(0, 0, -0.05)), 'brass')
        turret.emit(xform(crystal(0.07, 0.06, 0.02, 8), T(sx * 0.525, 0, tz) @ R('Y', 90 * sx)), 'blue')
        # an enamel shield inlay on the outer face
        turret.emit(xform(prism([(-0.2, 0.3), (0.16, 0.3), (0.06, 0.74), (-0.08, 0.8), (-0.24, 0.6)], 0.02, 'X'), T(sx * 0.42, 0, z0)), 'enamel')
    # winding wheel on the right cheek, gearbox behind it
    turret.emit(xform(box(0.12, 0.26, 0.22, 0.02), T(0.48, -0.12, z0 + 0.52)), 'bronze')
    crank.emit(xform(ring(0.27, 0.025, 0.03, 16, 'X'), T(*crank.pivot) @ T(0.05, 0, 0)), 'brass')
    crank.emit(xform(cyl(0.06, 0.06, 0.1, 8, 0.01), T(*crank.pivot) @ R('Y', 90) @ T(0, 0, -0.0)), 'bronze')
    for i in range(6):
        crank.emit(xform(box(0.02, 0.04, 0.5, 0.005), T(*crank.pivot) @ T(0.05, 0, 0) @ R('X', i * 30)), 'brass')
    crank.emit(xform(cyl(0.022, 0.022, 0.16, 6), T(*crank.pivot) @ T(0.05, 0, 0.26) @ R('Y', 90)), 'walnut')

    # --- cradle: walnut keel with a brass track, the sun crest at the front, spade grips at the back
    keel = []
    for y, w, h in ((-1.18, 0.12, 0.1), (-0.9, 0.2, 0.17), (0.2, 0.22, 0.19), (0.95, 0.2, 0.16), (1.36, 0.12, 0.1)):
        keel.append([(sx_ * w / 2, y, tz + sz_ * h / 2 + 0.02) for sx_, sz_ in ((-1, -0.6), (1, -0.6), (1.2, 0.3), (0.5, 1), (-0.5, 1), (-1.2, 0.3))])
    cradle.emit(chamfer(loft(keel), 0.012), 'walnut')
    cradle.emit(xform(box(0.07, 2.1, 0.03, 0.006), T(0, 0.2, tz + S_BOLT_Z - 0.045)), 'brass')
    for sx in (-1, 1):
        side_plate = [(sx * 0.118, y, tz + z) for y, z in ((-0.85, 0.05), (0.2, 0.06), (0.95, 0.05))]
        cradle.emit(sweep(side_plate, lambda i, t: [(0.0, -0.06), (0.012, -0.06), (0.012, 0.05), (0.0, 0.05)], up=(0, 0, 1)), 'brass')
        cradle.emit(xform(box(0.012, 1.5, 0.018), T(sx * 0.126, 0.05, tz + 0.055)), 'blue')
        # wing mounts
        cradle.emit(xform(box(0.12, 0.2, 0.14, 0.015), T(sx * 0.15, S_WING_ROOT[1], tz + S_BOLT_Z)), 'bronze')
        # trunnion stubs
        cradle.emit(xform(cyl(0.07, 0.07, 0.2, 8, 0.01), T(sx * 0.2, 0, tz) @ R('Y', 90) @ T(0, 0, -0.1)), 'bronze')
    # latch block and trigger
    cradle.emit(xform(box(0.16, 0.18, 0.1, 0.015), T(0, S_NOCK_Y - 0.12, tz + S_BOLT_Z - 0.07)), 'bronze')
    cradle.emit(xform(prism([(-0.04, 0), (0.04, 0), (0.0, -0.16)], 0.03, 'X'), T(0, S_NOCK_Y - 0.1, tz + S_BOLT_Z - 0.12)), 'brass')
    # spade grips: a crossbar and two walnut handles, angled out for a two-handed stance
    gy = -1.16
    cradle.emit(xform(cyl(0.032, 0.032, 0.62, 8), T(-0.31, gy, tz + 0.02) @ R('Y', 90)), 'brass')
    for sx in (-1, 1):
        cradle.emit(xform(cyl(0.04, 0.036, 0.26, 8, 0.006), T(sx * 0.31, gy, tz + 0.02) @ R('Z', sx * 25) @ R('X', 100)), 'leather')
        cradle.emit(xform(ico(0.045, 1), T(sx * 0.31 + sx * 0.11, gy - 0.25, tz - 0.03)), 'brass')
    # the sun crest: an enamel sun shield ringed in brass, sixteen flame rays, a blue keystone; the inner ring is the charge glow
    cy, cz = S_CREST_Y, tz + S_BOLT_Z
    disc = []
    for k, (r, dy) in enumerate(((0.12, 0.03), (0.4, 0.0))):
        disc.append([(math.cos(a) * r, cy + dy, cz + math.sin(a) * r) for a in (i / 16 * math.tau for i in range(16))])
    shield = []
    for i in range(16):
        a0, a1 = i / 16 * math.tau, (i + 1) / 16 * math.tau
        for r0, r1 in ((0.27, 0.4),):
            pts = [(math.cos(a0) * r0, math.sin(a0) * r0), (math.cos(a1) * r0, math.sin(a1) * r0), (math.cos(a1) * r1, math.sin(a1) * r1), (math.cos(a0) * r1, math.sin(a0) * r1)]
            shield.append(pts)
    for pts in shield:
        cradle.emit(xform(prism([(x, z) for x, z in pts], 0.04, 'Y'), T(0, cy - 0.03, cz)), 'enamel')
    cradle.emit(xform(ring(0.42, 0.05, 0.06, 16, 'Y'), T(0, cy, cz)), 'brass')
    # the open centre is the operator's ring sight: the target sits inside the sun
    cradle.emit(xform(ring(0.27, 0.025, 0.05, 20, 'Y'), T(0, cy, cz)), 'brass')
    cradle.emit(xform(ring(0.32, 0.016, 0.012, 24, 'Y'), T(0, cy + 0.025, cz)), 'sun')
    for i in range(16):
        a = i / 16 * math.tau + math.pi / 2
        L = 0.36 if i % 2 == 0 else 0.2
        w = 0.085 if i % 2 == 0 else 0.06
        # a flame ray: leans a little round the disc so the crest reads as turning
        ray = prism([(-w, 0), (w, 0), (w * 0.35, L * 0.6), (-w * 0.15, L)], 0.04, 'Y', 0.004)
        cradle.emit(xform(ray, T(0, cy - 0.005, cz) @ R('Y', -math.degrees(a) + 90) @ T(0, 0, 0.44)), 'brass' if i % 2 == 0 else 'bronze')
    cradle.emit(xform(crystal(0.08, 0.18, 0.06, 6), T(0, cy, cz + 0.84)), 'blue')
    for sx in (-1, 1):
        cradle.emit(xform(crystal(0.04, 0.08, 0.03, 6), T(sx * 0.335, cy + 0.03, cz) @ R('X', -90)), 'blue')
    # a forked brass mount under the disc, clear of the bolt line
    for sx in (-1, 1):
        cradle.emit(xform(box(0.05, 0.08, 0.44, 0.008), T(sx * 0.15, cy - 0.06, cz - 0.24) @ R('Y', sx * 28)), 'bronze')
    cradle.emit(xform(box(0.16, 0.14, 0.07, 0.012), T(0, cy, cz - 0.08)), 'bronze')
    cradle.anchor('S_Nock', (0, S_NOCK_Y, cz))
    cradle.anchor('S_Muzzle', (0, cy + 0.05, cz))
    cradle.anchor('S_Sight', (0, -1.55, tz + 0.38))

    # --- wings
    for node, side in ((wl, -1), (wr, 1)):
        pieces, tip = sun_wing(side)
        for bm, col in pieces:
            node.emit(xform(bm, T(*node.pivot)), col)
        node.anchor(f'{node.name}_Tip', node.pivot + tip)

    # --- bolt (its own top-level node; origin at the nock, points +Y)
    bolt = Node('S_Bolt')
    bolt.emit(xform(cyl(0.032, 0.03, 1.36, 6, 0.004), R('X', -90)), 'ivory')
    for y in (0.08, 0.7, 1.32):
        bolt.emit(xform(cyl(0.04, 0.04, 0.05, 6, 0.006), T(0, y, 0) @ R('X', -90)), 'brass')
    bolt.emit(xform(crystal(0.07, 0.36, 0.08, 6), T(0, 1.44, 0) @ R('X', -90)), 'blue')
    for i in range(3):
        bolt.emit(xform(prism([(0.0, 0.0), (0.3, 0.0), (0.04, 0.09)], 0.008, 'X'), R('Y', i * 120) @ T(0, 0.03, 0.025)), 'brass')
    bolt.emit(xform(box(0.05, 0.03, 0.05, 0.008), T(0, 0.0, 0)), 'bronze')
    nodes += [root, base, turret, crank, cradle, wl, wr, bolt]


# ---------------------------------------------------------------------------------------------------------------
# Gnashjaw (Grumblekeep): a big goofy riveted skull that spits a chained harpoon from its mouth.
# ---------------------------------------------------------------------------------------------------------------
G_TURRET_Z = 0.58
G_TRUNNION = (0, 0, 1.46)
G_BOLT_Z = -0.16
G_NOCK_Y = -0.66
G_SKULL = (0, 0.92, 0.22)     # cranium centre, cradle local
G_HINGE = (0, 0.72, -0.12)    # jaw hinge, cradle local
G_HORN_ROOT = (0.44, 0.62, 0.3)


def horn(side):
    path = [(0, 0, 0), (0.3, -0.02, 0.14), (0.66, -0.12, 0.2), (0.98, -0.3, 0.14), (1.18, -0.52, 0.0), (1.24, -0.72, -0.16), (1.18, -0.84, -0.3)]
    n = 8

    def sec(i, t):
        r = 0.13 * (1 - t) ** 0.9 + 0.025
        bump = 1.0 + (0.12 if i % 2 == 1 else 0)
        return [(math.cos(a) * r * bump, math.sin(a) * r * bump * 0.9) for a in (k / n * math.tau for k in range(n))]
    # dense path for ridges
    dense = []
    for i in range(len(path) - 1):
        a, b = Vector(path[i]), Vector(path[i + 1])
        for k in range(3):
            dense.append(tuple(a.lerp(b, k / 3)))
    dense.append(path[-1])
    pieces = []
    body = sweep(dense, sec)
    pieces.append((body, 'horn'))
    # bone tip cap and iron bands
    tipv = Vector(path[-1])
    prev = Vector(path[-2])
    d = (tipv - prev).normalized()
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    pieces.append((xform(cyl(0.05, 0.0, 0.2, 6), T(*tipv) @ rot), 'bone'))
    for j in (2, 5, 9):
        p = Vector(dense[j])
        dd = (Vector(dense[j + 1]) - Vector(dense[j - 1])).normalized()
        rr = dd.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        rad = 0.13 * (1 - j / (len(dense) - 1)) ** 0.9 + 0.045
        pieces.append((xform(cyl(rad, rad, 0.05, 8, 0.005), T(*p) @ rr @ T(0, 0, -0.025)), 'iron'))
    if side < 0:
        for bm, _ in pieces:
            mirror_x(bm)
    return pieces, Vector((tipv.x * side, tipv.y, tipv.z))


def build_gnashjaw(nodes):
    root = Node('G_Root')
    base = Node('G_Base', (0, 0, 0), root)
    turret = Node('G_Turret', (0, 0, G_TURRET_Z), root)
    drum = Node('G_Drum', (0.6, -0.2, G_TURRET_Z + 0.42), turret)
    tz = G_TRUNNION[2]
    cradle = Node('G_Cradle', G_TRUNNION, turret)
    jaw = Node('G_Jaw', (G_HINGE[0], G_HINGE[1], tz + G_HINGE[2]), cradle)
    hl = Node('G_HornL', (-G_HORN_ROOT[0], G_HORN_ROOT[1], tz + G_HORN_ROOT[2]), cradle)
    hr = Node('G_HornR', (G_HORN_ROOT[0], G_HORN_ROOT[1], tz + G_HORN_ROOT[2]), cradle)

    # --- plinth: hexagonal slate drum, riveted iron band, a crown of bone fangs and ooze seeping from the cracks
    base.emit(cyl(1.18, 1.1, 0.12, 6, 0.02), 'slate2')
    base.emit(xform(cyl(1.02, 0.92, 0.44, 6, 0.025), T(0, 0, 0.1)), 'slate')
    base.emit(xform(cyl(0.98, 0.96, 0.1, 6, 0.008), T(0, 0, 0.42)), 'iron')
    base.emit(xform(cyl(0.9, 0.86, 0.06, 6, 0.01), T(0, 0, 0.52)), 'iron2')
    for i in range(6):
        a = i / 6 * math.tau + math.pi / 6
        c, s = math.cos(a), math.sin(a)
        for k in (-1, 0, 1):
            aa = a + k * 0.28
            base.emit(xform(box(0.035, 0.035, 0.035, 0.006), T(math.cos(aa) * 0.97, math.sin(aa) * 0.97, 0.47)), 'iron2')
        # a bone fang leaning out at each corner
        corner = i / 6 * math.tau
        base.emit(xform(cyl(0.07, 0.0, 0.3, 5), T(math.cos(corner) * 0.92, math.sin(corner) * 0.92, 0.5) @ R('Z', math.degrees(corner)) @ R('Y', 28)), 'bone')
        # ooze crack zig-zag down the face
        zz = [(c * 0.985, s * 0.985, 0.38), (c * 0.99 + -s * 0.08, s * 0.99 + c * 0.08, 0.3), (c * 1.0 - -s * 0.05, s * 1.0 - c * 0.05, 0.22), (c * 1.01, s * 1.01, 0.14)]
        base.emit(sweep(zz, lambda j, t: [(0.018, 0), (0, 0.012), (-0.018, 0), (0, -0.012)], up=(c, s, 0)), 'ooze')

    # --- turret: blackened iron turntable, claw brackets, purple-gem bosses, the chain drum
    z0 = G_TURRET_Z
    turret.emit(xform(cyl(0.84, 0.8, 0.1, 6, 0.012), T(0, 0, z0) @ R('Z', 30)), 'iron2')
    turret.emit(xform(cyl(0.6, 0.55, 0.06, 6, 0.01), T(0, 0, z0 + 0.1) @ R('Z', 30)), 'iron')
    claw = [(-0.5, 0.12), (0.38, 0.12), (0.28, 0.52), (0.12, 0.98), (-0.12, 1.04), (-0.34, 0.86), (-0.54, 0.44)]
    for sx in (-1, 1):
        turret.emit(xform(prism(claw, 0.12, 'X', 0.018), T(sx * 0.37, 0, z0)), 'iron')
        # three bone claws curling up off each bracket
        for k, (y, z, L) in enumerate(((-0.36, 0.78, 0.3), (-0.12, 1.0, 0.36), (0.18, 0.86, 0.28))):
            path = [(sx * 0.37, y, z0 + z), (sx * 0.43, y - 0.06, z0 + z + L * 0.55), (sx * 0.4, y - 0.18, z0 + z + L)]
            turret.emit(sweep(path, lambda i, t: [(math.cos(a) * 0.05 * (1 - t * 0.85), math.sin(a) * 0.05 * (1 - t * 0.85)) for a in (j / 5 * math.tau for j in range(5))]), 'bone')
        turret.emit(xform(cyl(0.15, 0.15, 0.1, 6, 0.015), T(sx * 0.48, 0, tz) @ R('Y', 90) @ T(0, 0, -0.05)), 'iron2')
        turret.emit(xform(crystal(0.07, 0.06, 0.02, 6), T(sx * 0.535, 0, tz) @ R('Y', 90 * sx)), 'purple')
    # the chain drum: iron spool with bone flanges, coils of chain and a bone-handled crank
    dp = drum.pivot
    turret.emit(xform(box(0.12, 0.3, 0.2, 0.02), T(0.47, -0.2, z0 + 0.42)), 'iron2')
    drum.emit(xform(cyl(0.17, 0.17, 0.28, 10, 0.01), T(*dp) @ R('Y', 90) @ T(0, 0, -0.06)), 'iron')
    for dx in (-0.06, 0.22):
        drum.emit(xform(cyl(0.26, 0.26, 0.04, 10, 0.008), T(*dp) @ T(dx, 0, 0) @ R('Y', 90)), 'bone2')
    for k in range(5):
        drum.emit(xform(ring(0.19, 0.012, 0.03, 12, 'X'), T(*dp) @ T(0.0 + k * 0.045, 0, 0) @ R('X', k * 17)), 'iron2')
    drum.emit(xform(box(0.04, 0.05, 0.36, 0.008), T(*dp) @ T(0.3, 0, 0.14)), 'iron')
    drum.emit(xform(cyl(0.035, 0.035, 0.18, 6, 0.006), T(*dp) @ T(0.3, 0, 0.32) @ R('Y', 90)), 'bone')

    # --- cradle: riveted iron beam, grips, and the skull
    beam = []
    for y, w, h in ((-1.15, 0.16, 0.12), (-0.85, 0.24, 0.2), (0.35, 0.26, 0.22), (0.7, 0.2, 0.18)):
        beam.append([(sx_ * w / 2, y, tz + sz_ * h / 2 - 0.04) for sx_, sz_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    cradle.emit(chamfer(loft(beam), 0.015), 'iron')
    cradle.emit(xform(box(0.07, 1.4, 0.03, 0.006), T(0, -0.25, tz + 0.075)), 'rust')
    for y in (-0.8, -0.5, -0.2, 0.1, 0.4):
        for sx in (-1, 1):
            cradle.emit(xform(box(0.03, 0.03, 0.03, 0.005), T(sx * 0.13, y, tz + 0.04)), 'iron2')
        cradle.emit(xform(cyl(0.035, 0.0, 0.12, 4), T(0, y, tz + 0.07) @ R('X', -20)), 'iron2')
    for sx in (-1, 1):
        cradle.emit(xform(cyl(0.07, 0.07, 0.2, 6, 0.01), T(sx * 0.2, 0, tz) @ R('Y', 90) @ T(0, 0, -0.1)), 'iron2')
    cradle.emit(xform(box(0.16, 0.16, 0.1, 0.015), T(0, G_NOCK_Y - 0.12, tz - 0.08)), 'iron2')
    gy = -1.12
    cradle.emit(xform(cyl(0.032, 0.032, 0.64, 6), T(-0.32, gy, tz) @ R('Y', 90)), 'iron2')
    for sx in (-1, 1):
        cradle.emit(xform(cyl(0.042, 0.036, 0.26, 6, 0.006), T(sx * 0.32, gy, tz) @ R('Z', sx * 25) @ R('X', 100)), 'bone')
        cradle.emit(xform(cyl(0.05, 0.0, 0.1, 4), T(sx * 0.43, gy - 0.25, tz - 0.05) @ R('X', 110)), 'iron')

    # the skull: a squashed faceted cranium, brow, cheekbones, sockets with glowing eyes, nose, upper teeth
    sx0, sy0, sz0 = G_SKULL[0], G_SKULL[1], tz + G_SKULL[2]
    cr = ico(0.5, 2)
    for v in cr.verts:
        x, y, z = v.co
        # flatten the face, swell the cranium at the back-top, pinch the sides near the jaw
        k = 1.0 + 0.12 * max(0.0, z) - 0.1 * max(0.0, -z)
        v.co = Vector((x * 1.02 * k, y * 1.0 * (0.9 if y > 0.25 else 1.0), z * 0.86))
    cradle.emit(xform(cr, T(sx0, sy0, sz0)), 'bone')
    # cheekbones / maxilla block the upper teeth sit in
    maxilla = loft([
        [(x * 0.38, sy0 + 0.12, sz0 + z) for x, z in ((-1, -0.36), (1, -0.36), (1.05, -0.18), (-1.05, -0.18))],
        [(x * 0.36, sy0 + 0.42, sz0 + z) for x, z in ((-1, -0.36), (1, -0.36), (1.05, -0.12), (-1.05, -0.12))],
        [(x * 0.28, sy0 + 0.52, sz0 + z) for x, z in ((-1, -0.34), (1, -0.34), (1, -0.14), (-1, -0.14))],
    ])
    cradle.emit(chamfer(maxilla, 0.02), 'bone')
    # brow ridge
    brow = [(-0.36, sy0 + 0.4, sz0 + 0.2), (-0.12, sy0 + 0.47, sz0 + 0.26), (0.12, sy0 + 0.47, sz0 + 0.26), (0.36, sy0 + 0.4, sz0 + 0.2)]
    cradle.emit(sweep(brow, lambda i, t: [(0.0, -0.05), (0.07, 0.0), (0.0, 0.05), (-0.05, 0.0)], up=(0, 0, 1)), 'bone2')
    for sx in (-1, 1):
        # big dark eye sockets with glowing ooze eyes (goofy, a little uneven)
        socket = ico(0.135 if sx < 0 else 0.15, 1)
        xform(socket, T(sx * 0.19, sy0 + 0.39, sz0 + 0.05) @ S(1, 0.55, 1.05))
        cradle.emit(socket, 'socket')
        cradle.emit(xform(ico(0.05 if sx < 0 else 0.058, 1), T(sx * 0.19, sy0 + 0.46, sz0 + 0.06)), 'ooze')
        # cheekbone bulge
        cradle.emit(xform(ico(0.12, 1), T(sx * 0.33, sy0 + 0.3, sz0 - 0.12) @ S(1, 1.2, 0.7)), 'bone')
        # iron temple bosses where the horns bolt on
        cradle.emit(xform(cyl(0.13, 0.11, 0.12, 6, 0.012), T(sx * 0.42, G_HORN_ROOT[1], tz + G_HORN_ROOT[2]) @ R('Y', 90 * sx) @ T(0, 0, -0.06)), 'iron')
    # nose: an upside-down heart of shadow
    nose = prism([(-0.07, 0.0), (0.0, -0.1), (0.07, 0.0), (0.04, 0.05), (0.0, 0.02), (-0.04, 0.05)], 0.06, 'Y')
    cradle.emit(xform(nose, T(0, sy0 + 0.49, sz0 - 0.08)), 'socket')
    # upper teeth: chunky, slightly crooked, with a gap at the middle for the harpoon
    mouth_y, mouth_z = sy0 + 0.47, sz0 - 0.36
    cradle.emit(xform(box(0.62, 0.3, 0.06, 0.01), T(0, mouth_y - 0.12, mouth_z + 0.03)), 'gum')
    for i, x in enumerate((-0.27, -0.19, -0.11, 0.11, 0.19, 0.27)):
        ang = math.atan2(x, 0.25)
        ty = mouth_y - abs(x) * 0.35
        tooth = box(0.07, 0.06, 0.12, 0.012)
        cradle.emit(xform(tooth, T(x, ty, mouth_z - 0.04) @ R('Z', -math.degrees(ang) * 0.6) @ R('Y', (i % 3 - 1) * 5)), 'bone')
    # iron helmet strap over the crown with a three-spike crest
    strap = [(math.sin(a) * 0.53, sy0 - 0.02, sz0 + math.cos(a) * 0.47) for a in [math.radians(d) for d in range(-80, 81, 20)]]
    cradle.emit(sweep(strap, lambda i, t: [(0.06, -0.02), (0.06, 0.03), (-0.06, 0.03), (-0.06, -0.02)], up=(0, 1, 0)), 'iron')
    for k, d in enumerate((-22, 0, 22)):
        a = math.radians(d)
        cradle.emit(xform(cyl(0.06, 0.0, 0.24 if d == 0 else 0.17, 4), T(math.sin(a) * 0.5, sy0 - 0.02, sz0 + math.cos(a) * 0.45) @ R('Y', d)), 'iron2')
    for d in (-60, -40, 40, 60):
        a = math.radians(d)
        cradle.emit(xform(box(0.035, 0.035, 0.035, 0.006), T(math.sin(a) * 0.55, sy0 + 0.03, sz0 + math.cos(a) * 0.48)), 'iron2')
    # the skull sits on an iron saddle bolted to the beam
    cradle.emit(xform(box(0.42, 0.42, 0.16, 0.02), T(0, sy0 - 0.25, tz - 0.08)), 'iron2')
    cradle.anchor('G_Nock', (0, G_NOCK_Y, tz + G_BOLT_Z))
    cradle.anchor('G_Muzzle', (0, mouth_y + 0.1, tz + G_BOLT_Z))
    cradle.anchor('G_Sight', (0, -1.5, tz + 1.29))
    cradle.anchor('G_EyeL', (-0.19, sy0 + 0.46, sz0 + 0.06))
    cradle.anchor('G_EyeR', (0.19, sy0 + 0.46, sz0 + 0.06))

    # --- jaw: a U of bone with a row of lower teeth, hinged under the cheekbones
    hy, hz = jaw.pivot.y, jaw.pivot.z
    jaw_path = []
    for d in range(-90, 91, 18):
        a = math.radians(d)
        jaw_path.append((math.sin(a) * 0.34, hy + 0.18 + math.cos(a) * 0.36, hz - 0.12 - 0.04 * math.cos(a)))
    jaw_path = [(-0.36, hy - 0.04, hz - 0.02)] + jaw_path + [(0.36, hy - 0.04, hz - 0.02)]
    jaw.emit(sweep(jaw_path, lambda i, t: [(0.06, -0.07), (0.06, 0.06), (-0.06, 0.06), (-0.06, -0.09)], up=(0, 0, 1)), 'bone')
    jaw.emit(xform(ico(0.1, 1), T(0, hy + 0.55, hz - 0.17) @ S(1.4, 0.8, 0.8)), 'bone2')  # chin
    for i, x in enumerate((-0.25, -0.16, -0.07, 0.07, 0.16, 0.25)):
        ty = hy + 0.18 + math.sqrt(max(0.0, 0.36 ** 2 - (x / 0.34 * 0.36) ** 2)) * 0.98 - 0.02
        jaw.emit(xform(box(0.065, 0.055, 0.1, 0.01), T(x, ty, hz - 0.02) @ R('Y', (i % 2) * 6 - 3)), 'bone')
    jaw.emit(xform(box(0.5, 0.26, 0.04, 0.01), T(0, hy + 0.36, hz - 0.1)), 'gum')

    # --- horns
    for node, side in ((hl, -1), (hr, 1)):
        pieces, tip = horn(side)
        for bm, col in pieces:
            node.emit(xform(bm, T(*node.pivot)), col)
        node.anchor(f'{node.name}_Tip', node.pivot + tip)

    # --- harpoon (top-level node; origin at the chain ring, points +Y)
    hp = Node('G_Harpoon')
    hp.emit(xform(cyl(0.035, 0.035, 2.2, 6, 0.004), R('X', -90)), 'iron')
    hp.emit(xform(ring(0.06, 0.015, 0.015, 10, 'Z'), T(0, -0.05, 0)), 'bone')
    for y in (0.3, 1.0, 1.7):
        hp.emit(xform(cyl(0.045, 0.045, 0.06, 6, 0.006), T(0, y, 0) @ R('X', -90)), 'rust')
    head = prism([(0.0, 0.0), (0.12, -0.04), (0.16, -0.24), (0.06, -0.12), (0.0, -0.08), (-0.06, -0.12), (-0.16, -0.24), (-0.12, -0.04)], 0.04, 'Z', 0.006)
    hp.emit(xform(head, T(0, 2.56, 0)), 'iron')
    hp.emit(xform(prism([(0.0, 0.0), (0.08, -0.06), (0.0, -0.05), (-0.08, -0.06)], 0.046, 'Z'), T(0, 2.57, 0)), 'ooze')
    hp.emit(xform(cyl(0.05, 0.035, 0.14, 6, 0.006), T(0, 2.2, 0) @ R('X', -90)), 'iron2')
    for i in range(3):
        hp.emit(xform(prism([(0.0, 0.0), (0.22, 0.0), (0.04, 0.07)], 0.01, 'X'), R('Y', i * 120 + 60) @ T(0, 0.02, 0.03)), 'bone2')
    nodes += [root, base, turret, drum, cradle, jaw, hl, hr, hp]


# ---------------------------------------------------------------------------------------------------------------
# Scene assembly and export
# ---------------------------------------------------------------------------------------------------------------
def realise(nodes):
    objs, tris = {}, {}
    for n in nodes:
        if not n.verts:
            ob = bpy.data.objects.new(n.name, None)
            ob.empty_display_size = 0.2
        else:
            me = bpy.data.meshes.new(n.name)
            slots = []
            for _, m, _ in n.faces:
                if m not in slots:
                    slots.append(m)
            me.from_pydata([tuple(v) for v in n.verts], [], [f for f, _, _ in n.faces])
            for m in slots:
                me.materials.append(MATS[m])
            col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
            for poly, (_, m, c) in zip(me.polygons, n.faces):
                poly.material_index = slots.index(m)
                poly.use_smooth = False
                for li in poly.loop_indices:
                    col.data[li].color = c
            me.color_attributes.active_color = col
            me.validate()
            me.update()
            ob = bpy.data.objects.new(n.name, me)
            tris[n.name] = sum(len(p.vertices) - 2 for p in me.polygons)
        bpy.context.scene.collection.objects.link(ob)
        objs[n.name] = ob
    for n in nodes:
        ob = objs[n.name]
        if n.parent:
            ob.parent = objs[n.parent.name]
            ob.location = n.pivot - n.parent.pivot
        else:
            ob.location = n.pivot
        for name, at in n.empties.items():
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.05
            bpy.context.scene.collection.objects.link(e)
            e.parent = ob
            e.location = at - n.pivot
            objs[name] = e
    return objs, tris


def build(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    nodes = []
    build_sunlance(nodes)
    build_gnashjaw(nodes)
    objs, tris = realise(nodes)
    # The Gnashjaw sits beside the Sunlance only in the .blend; the glTF keeps each at its own origin.
    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, 'keep_ballistas.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_vertex_color='ACTIVE', export_normals=True, export_materials='EXPORT', export_extras=False,
                              export_animations=False)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, 'keep_ballistas.blend'))
    report = {'triangles': tris, 'total': {'sunlance': sum(v for k, v in tris.items() if k.startswith('S_')),
                                           'gnashjaw': sum(v for k, v in tris.items() if k.startswith('G_'))},
              'bytes': os.path.getsize(glb), 'materials': sorted(MATS)}
    with open(os.path.join(HERE, 'build_report.json'), 'w') as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps(report['total']), report['bytes'])
    return objs


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    out = HERE
    if '--out' in argv:
        out = os.path.abspath(argv[argv.index('--out') + 1])
    build(out)
