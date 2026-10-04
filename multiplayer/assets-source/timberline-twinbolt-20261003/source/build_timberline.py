"""Timberline twin-bolt ballista: deterministic Blender 4.5 builder.

Usage (either form):
  blender --background --factory-startup --python-exit-code 2 \
      --python build_timberline.py -- --out <abs dir>
  python build_timberline.py --out <abs dir>      # with the `bpy` 4.5 module

Builds, in metres:
  timberline_ballista.glb   machine, LOD0+LOD1 meshes on shared pivots, clips
  timberline_bolts.glb      left + right bolt (mirrored by construction), clips
  timberline_collision.glb  simple proxies on the same pivot names
  timberline_source.blend   editable scene
  build_report.json         triangles, materials, textures, sizes, events

Blender axes: +X right, +Y forward, +Z up. glTF/Three: +X right, -Z forward,
+Y up. All mechanism math below is in Blender axes.
"""
import json
import math
import os
import sys

import bpy  # noqa: I001 (bpy must load before bmesh/mathutils as a module)
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import textures  # noqa: E402

# ---------------------------------------------------------------------------
# Machine dimensions (Blender axes, metres). Launch-assembly values are in the
# Recoil frame, whose origin is the elevation trunnion.
# ---------------------------------------------------------------------------
TRAVERSE_Z = 0.62          # turntable top: Traverse pivot height (vertical axis)
TRUNNION_Z = 1.05          # Elevation pivot height above ground (axis +X)
RX = 0.50                  # rail centreline |x|
RAIL_W, RAIL_H = 0.15, 0.15
RAIL_TOP = 0.04
RIB_W, RIB_H = 0.032, 0.055   # raised, mithril-capped bolt track on each rail
RIB_Y1 = 0.64              # track ends before the folded vanes (collar - 0.075 .. - 0.255)
RAIL_Y0, RAIL_Y1 = -0.62, 0.80
BOLT_Z = RAIL_TOP + RIB_H + 0.027   # bolt axis height (rides on the rib)
PROD_Y, PROD_Z = 0.60, 0.0
LIMB_ROOT = 0.07           # limb root offset from rail centre
LIMB_LEN = 0.40
LIMB_SWEEP = 0.15          # braced limb belly sits this far behind the prod
LIMB_CURL = 0.05           # recurve: tips curl forward again by this much
THETA_DRAW = math.radians(13.0)
LATCH_Y = 0.02             # claw hook / nock position when cocked
STRING_Z = RAIL_TOP + RIB_H + 0.01   # string rides on the rib top
BOLT_LEN_FWD = 0.20        # collar station -> tip
BOLT_LEN_AFT = 0.90        # collar station -> nock
COLLAR_Y = LATCH_Y + BOLT_LEN_AFT   # loaded bolt origin (collar station)
EYE_OFF = 0.050            # eyelet centre offset inboard from shaft axis
FILAMENT_LEN = 1.12        # taut eye-to-eye filament length
DRUM_Y, DRUM_Z, DRUM_R = -0.56, 0.15, 0.072
GEAR_R, PINION_R = 0.11, 0.045
GEAR_TEETH, PINION_TEETH = 22, 9
GEAR_RATIO = GEAR_TEETH / PINION_TEETH
CRANK_Y = DRUM_Y - (GEAR_R + PINION_R) * math.sqrt(0.5)
CRANK_Z = DRUM_Z - (GEAR_R + PINION_R) * math.sqrt(0.5)
TRIGGER_Y, TRIGGER_Z = -0.05, -0.145
KEEL_W = 0.18              # central stock body width (fits between the trunnion cheeks)
CHEEK_X = 0.17             # trunnion cheek centre |x|


def limb_curve(s):
    """Limb centreline in limb space (x outward, y forward), s in 0..1."""
    y = -LIMB_SWEEP * (s ** 1.4)
    if s > 0.72:
        y += LIMB_CURL * ((s - 0.72) / 0.28) ** 2
    return LIMB_LEN * s, y


FPS = 60


BRACE_Y = PROD_Y + limb_curve(1.0)[1]   # braced string line (tips) when uncocked


def limb_tip(side_x, inner, theta):
    """Limb tip in Recoil frame. side_x = rail x (+RX/-RX); inner limbs point
    toward the centre. theta = draw rotation (0 braced, THETA_DRAW cocked)."""
    dirx = -math.copysign(1, side_x) if inner else math.copysign(1, side_x)
    root = Vector((side_x + dirx * LIMB_ROOT, PROD_Y, PROD_Z))
    lx, ly = limb_curve(1.0)
    local = Vector((dirx * lx, ly, 0))
    a = -dirx * theta
    rot = Matrix.Rotation(a, 3, 'Z')
    return root, root + rot @ local, a


def horn_tip():
    half = RX - EYE_OFF
    seg = FILAMENT_LEN / 2
    d = math.sqrt(seg * seg - half * half)
    # Split the drape offset into forward and downward parts (ratio 0.33:0.155)
    k = d / math.hypot(0.33, 0.155)
    return Vector((0.0, COLLAR_Y + 0.33 * k, BOLT_Z - 0.155 * k))


HORN = horn_tip()

# ---------------------------------------------------------------------------
# Small mesh library: convex hulls, lofts, box-projected wood UVs
# ---------------------------------------------------------------------------


class Acc:
    def __init__(self):
        self.verts, self.faces, self.uvs, self.mats, self.smooth = [], [], [], [], []

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


ACCS = {}            # (node, lod) -> Acc
MAT_ORDER = ["TL_Wood", "TL_WoodDark", "TL_Iron", "TL_Brass", "TL_Mithril", "TL_Rope", "TL_Resonance"]
UV_SCALE = {"TL_Wood": 1 / 0.75, "TL_WoodDark": 1 / 0.75, "TL_Iron": 1 / 0.6,
            "TL_Brass": 1 / 0.25, "TL_Mithril": 1 / 0.3, "TL_Rope": 1 / 0.10, "TL_Resonance": 1.0}
_uvseed = [0]


def acc(node, lod):
    return ACCS.setdefault((node, lod), Acc())


def _next_offset():
    _uvseed[0] += 1
    n = _uvseed[0]
    return ((n * 0.6180339) % 1.0, (n * 0.3819660 + 0.17) % 1.0)


def _box_uv(p, n, s, off):
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 0:      # end grain: compress so it reads as rings/streaks
        u, v = p[1] * s * 0.35, p[2] * s
    elif ax == 1:
        u, v = p[0] * s, p[2] * s
    else:
        u, v = p[0] * s, p[1] * s
    return (u + off[0], v + off[1])


def emit(a, faces_local, mat, xf, smooth, uv_mode="box", uv_per_loop=None):
    """faces_local: list of lists of Vector (local). Grain runs along local X."""
    s = UV_SCALE[mat]
    off = _next_offset()
    nrm3 = xf.to_3x3()
    for fi, f in enumerate(faces_local):
        n = (f[1] - f[0]).cross(f[2] - f[0])
        if n.length < 1e-12 and len(f) > 3:
            n = (f[2] - f[0]).cross(f[3] - f[0])
        n = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
        idx = []
        uvl = []
        for li, p in enumerate(f):
            a.verts.append(tuple(xf @ p))
            idx.append(len(a.verts) - 1)
            if uv_per_loop is not None:
                uu = uv_per_loop[fi][li]
                uvl.append((uu[0] * s + off[0], uu[1] * s + off[1]))
            else:
                uvl.append(_box_uv(p, n, s, off))
        a.faces.append(idx)
        a.uvs.append(uvl)
        a.mats.append(MAT_ORDER.index(mat))
        a.smooth.append(smooth)


def hull(points):
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    bmesh.ops.delete(bm, geom=list(set(res["geom_interior"]) | set(res["geom_unused"])), context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=list(bm.verts), edges=list(bm.edges))
    faces = [[v.co.copy() for v in f.verts] for f in bm.faces]
    bm.free()
    return faces


def chamfer_box_pts(sx, sy, sz, c):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    c = min(c, hx * 0.45, hy * 0.45, hz * 0.45)
    pts = []
    for a in (-1, 1):
        for b in (-1, 1):
            for d in (-1, 1):
                pts += [Vector((a * hx, b * (hy - c), d * (hz - c))),
                        Vector((a * (hx - c), b * hy, d * (hz - c))),
                        Vector((a * (hx - c), b * (hy - c), d * hz))]
    return pts


def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    m = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    if scale:
        m = m @ Matrix.Diagonal((*scale, 1))
    return m


def box(node, mat, size, xf, bevel=0.012, lods=(0, 1), smooth=False):
    """Box with grain along local X. LOD1 drops the chamfer."""
    for lod in lods:
        c = bevel if lod == 0 else 0.0
        pts = chamfer_box_pts(*size, c) if c > 0 else [
            Vector((a * size[0] / 2, b * size[1] / 2, d * size[2] / 2))
            for a in (-1, 1) for b in (-1, 1) for d in (-1, 1)]
        emit(acc(node, lod), hull(pts), mat, xf, smooth)


def beam(node, mat, p0, p1, w, h, bevel=0.012, lods=(0, 1), up=Vector((0, 0, 1)), taper=1.0):
    """Rectangular timber from p0 to p1 (grain along the beam)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    x = d.normalized()
    upv = Vector(up)
    if abs(x.dot(upv)) > 0.95:
        upv = Vector((0, 1, 0)) if abs(x.y) < 0.9 else Vector((1, 0, 0))
    y = upv.cross(x).normalized()
    z = x.cross(y).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = (p0 + p1) / 2
    if taper == 1.0:
        box(node, mat, (L, w, h), m, bevel, lods)
    else:
        for lod in lods:
            c = bevel if lod == 0 else 0
            pts = []
            for sx, k in ((-1, 1.0), (1, taper)):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        pts.append(Vector((sx * L / 2, sy * (w / 2 * k - c * 0.5), sz * (h / 2 * k))))
                        if c:
                            pts.append(Vector((sx * (L / 2 - c * 0.7), sy * w / 2 * k, sz * (h / 2 * k - c))))
            emit(acc(node, lod), hull(pts), mat, m, False)


def cyl_pts(r, length, seg, r2=None, axis='X'):
    r2 = r if r2 is None else r2
    pts = []
    for i in range(seg):
        a = 2 * math.pi * (i + 0.5) / seg
        for t, rr in ((-length / 2, r), (length / 2, r2)):
            c, s = math.cos(a) * rr, math.sin(a) * rr
            if axis == 'X':
                pts.append(Vector((t, c, s)))
            elif axis == 'Y':
                pts.append(Vector((c, t, s)))
            else:
                pts.append(Vector((c, s, t)))
    return pts


def cyl(node, mat, r, length, xf, seg=(12, 8), axis='X', r2=None, lods=(0, 1), smooth=True):
    for lod in lods:
        sg = seg[0] if lod == 0 else seg[1]
        emit(acc(node, lod), hull(cyl_pts(r, length, sg, r2, axis)), mat, xf, smooth)


def stud(node, mat, xf, s=0.022, h=0.012):
    """Brass pyramidal rivet head, LOD0 only."""
    pts = [Vector((a * s / 2, b * s / 2, 0)) for a in (-1, 1) for b in (-1, 1)] + [Vector((0, 0, h))]
    emit(acc(node, 0), hull(pts), mat, xf, False)


def loft(node, mat, sections, lod, closed_ring=True, caps=True, smooth=True, u_len=None):
    """sections: list of rings (list of Vector). Quads between rings."""
    a = acc(node, lod)
    faces, uvl = [], []
    n = len(sections[0])
    # accumulate path length for U
    cent = [sum(r, Vector()) / len(r) for r in sections]
    us = [0.0]
    for i in range(1, len(cent)):
        us.append(us[-1] + (cent[i] - cent[i - 1]).length)
    circ = sum(((sections[0][(j + 1) % n] - sections[0][j]).length for j in range(n)))
    for i in range(len(sections) - 1):
        r0, r1 = sections[i], sections[i + 1]
        rng = n if closed_ring else n - 1
        for j in range(rng):
            k = (j + 1) % n
            faces.append([r0[j], r0[k], r1[k], r1[j]])
            uvl.append([(us[i], j / n * circ), (us[i], (j + 1) / n * circ),
                        (us[i + 1], (j + 1) / n * circ), (us[i + 1], j / n * circ)])
    emit(a, faces, mat, Matrix.Identity(4), smooth, uv_per_loop=uvl)
    if caps and closed_ring:
        emit(a, [list(reversed(sections[0]))], mat, Matrix.Identity(4), False)
        emit(a, [list(sections[-1])], mat, Matrix.Identity(4), False)


def ring_section(center, x_axis, y_axis, rx, ry, seg, phase=0.0):
    return [center + x_axis * (math.cos(2 * math.pi * (i + phase) / seg) * rx)
            + y_axis * (math.sin(2 * math.pi * (i + phase) / seg) * ry) for i in range(seg)]


def tube_along(node, mat, pts, radius, seg, lod, caps=True, rect=None):
    """Sweep circle (or rect=(w,h) chamfered octagon) along polyline pts."""
    secs = []
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        xa = ref.cross(t).normalized()
        ya = t.cross(xa).normalized()
        if rect:
            w, h = rect
            secs.append(ring_section(p, xa, ya, w / 2, h / 2, seg, 0.5))
        else:
            secs.append(ring_section(p, xa, ya, radius, radius, seg))
    loft(node, mat, secs, lod, caps=caps)


def torus(node, mat, xf, R, r, seg, sseg, lod):
    secs = []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        radial = Vector((math.cos(a), math.sin(a), 0))
        ring = [xf @ (c + radial * math.cos(2 * math.pi * j / sseg) * r + Vector((0, 0, math.sin(2 * math.pi * j / sseg) * r)))
                for j in range(sseg)]
        secs.append(ring)
    loft(node, mat, secs, lod, caps=False)


def gear(node, mat, xf, r, teeth, width, lod, tooth_h=0.022):
    """Spur gear around local X axis."""
    seg = max(teeth, 12) if lod == 0 else 10
    emit(acc(node, lod), hull(cyl_pts(r - tooth_h * 0.4, width, seg)), mat, xf, True)
    if lod == 0:
        for i in range(teeth):
            a = 2 * math.pi * i / teeth
            tw = 2 * math.pi * r / teeth * 0.45
            m = xf @ Matrix.Rotation(a, 4, 'X') @ Matrix.Translation((0, 0, r))
            pts = [Vector((sx * width / 2, sy * tw / 2 * (0.6 if sz > 0 else 1.0), sz * tooth_h / 2 - tooth_h * 0.15))
                   for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
            emit(acc(node, 0), hull(pts), mat, m, False)
    else:
        emit(acc(node, 1), hull(cyl_pts(r, width * 0.98, 10)), mat, xf, True)


# ---------------------------------------------------------------------------
# Machine geometry
# ---------------------------------------------------------------------------

def strap(node, xf, size, studs=((0, 0),), stud_axis='Z', bevel=0.006, lods=(0, 1)):
    """Iron strap with brass rivets on its +Z face (local)."""
    box(node, "TL_Iron", size, xf, bevel=bevel, lods=lods)
    for (u, v) in studs:
        stud(node, "TL_Brass", xf @ T((u, v, size[2] / 2)), s=0.02, h=0.01)


def build_pedestal():
    N = "Pedestal"
    col_r, col_top = 0.23, TRAVERSE_Z - 0.07
    # Octagonal staved column, slightly tapered, iron bands.
    cyl(N, "TL_Wood", col_r, col_top - 0.12, T((0, 0, (col_top + 0.12) / 2), (0, 0, math.pi / 8)), seg=(8, 8), axis='Z',
        r2=col_r * 0.88, smooth=False)
    for z, h, r in ((0.17, 0.07, col_r + 0.012), (col_top - 0.05, 0.06, col_r * 0.88 + 0.014)):
        cyl(N, "TL_Iron", r, h, T((0, 0, z), (0, 0, math.pi / 8)), seg=(8, 8), axis='Z', smooth=False)
    # Base plinth and bearing ring under the turntable.
    cyl(N, "TL_Iron", 0.33, 0.07, T((0, 0, col_top + 0.035)), seg=(24, 12), axis='Z')
    cyl(N, "TL_Brass", 0.335, 0.012, T((0, 0, col_top + 0.07)), seg=(24, 12), axis='Z', lods=(0,))
    cyl(N, "TL_Wood", 0.36, 0.10, T((0, 0, 0.07), (0, 0, math.pi / 8)), seg=(8, 8), axis='Z', smooth=False, r2=0.32)
    cyl(N, "TL_Iron", 0.37, 0.03, T((0, 0, 0.02), (0, 0, math.pi / 8)), seg=(8, 8), axis='Z', smooth=False)
    # Four braced feet at 45 degrees: heavy timbers, iron toe shoes, knee braces.
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        up = Vector((0, 0, 1))
        beam(N, "TL_Wood", d * 0.20 + up * 0.085, d * 1.0 + up * 0.075, 0.17, 0.15, bevel=0.02)
        m = Matrix((d, side, up)).transposed().to_4x4()
        m.translation = d * 0.95 + up * 0.085
        box(N, "TL_Iron", (0.17, 0.205, 0.175), m, bevel=0.025)
        stud(N, "TL_Brass", m @ T((0.0, 0, 0.0875)), s=0.045, h=0.022)
        for sgn in (-1, 1):
            stud(N, "TL_Brass", m @ T((0, sgn * 0.1025, 0.02), (-sgn * math.pi / 2, 0, 0)), s=0.03, h=0.014, )
        # Knee brace from the foot up to the column, with iron straps at both ends.
        beam(N, "TL_Wood", d * 0.68 + up * 0.14, d * 0.20 + up * (col_top - 0.10), 0.11, 0.10, bevel=0.014)
        m2 = Matrix((d, side, up)).transposed().to_4x4()
        m2.translation = d * 0.66 + up * 0.085
        box(N, "TL_Iron", (0.07, 0.19, 0.17), m2, bevel=0.008)
        stud(N, "TL_Brass", m2 @ T((0, 0.095, 0), (-math.pi / 2, 0, 0)), s=0.024)
        stud(N, "TL_Brass", m2 @ T((0, -0.095, 0), (math.pi / 2, 0, 0)), s=0.024)
    # Brass maker's plate on the operator side (-Y).
    box(N, "TL_Brass", (0.12, 0.16, 0.012), T((0, -col_r * 0.95, 0.33), (math.pi / 2 + 0.06, 0, 0)), bevel=0.004)


def build_carriage():
    """Upper carriage (turret): turntable deck and trunnion cheeks. Origin = Traverse pivot."""
    N = "Carriage"
    tz = TRUNNION_Z - TRAVERSE_Z
    QR = 0.20
    cyl(N, "TL_Wood", 0.36, 0.07, T((0, 0, 0.035)), seg=(20, 12), axis='Z')
    cyl(N, "TL_Iron", 0.37, 0.03, T((0, 0, 0.055)), seg=(20, 12), axis='Z')
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        stud(N, "TL_Brass", T((math.cos(a) * 0.37, math.sin(a) * 0.37, 0.055), (0, math.pi / 2, a)), s=0.02)
    # Sill timbers under each cheek.
    for sx in (-1, 1):
        x = sx * CHEEK_X
        beam(N, "TL_Wood", (x, -0.34, 0.11), (x, 0.34, 0.11), 0.10, 0.08, bevel=0.012)
        # A-frame cheek: two raking legs meeting at the trunnion boss.
        for sy in (-1, 1):
            beam(N, "TL_Wood", (x, sy * 0.30, 0.13), (x, sy * 0.05, tz - 0.02), 0.085, 0.09, bevel=0.014)
        # Trunnion boss: wooden block with an iron cap and brass bush.
        box(N, "TL_Wood", (0.10, 0.20, 0.14), T((x, 0, tz - 0.03)), bevel=0.016)
        strap(N, T((x, 0, tz + 0.045)), (0.112, 0.21, 0.025), studs=((0, -0.07), (0, 0.07)))
        cyl(N, "TL_Iron", 0.062, 0.115, T((x, 0, tz)), seg=(14, 8))
        cyl(N, "TL_Brass", 0.036, 0.13, T((x + sx * 0.01, 0, tz)), seg=(12, 8))
        # Iron knee plates where the legs meet the sill.
        for sy in (-1, 1):
            box(N, "TL_Iron", (0.11, 0.06, 0.10), T((x, sy * 0.26, 0.16)), bevel=0.008)
    # Elevation quadrant on the right cheek: toothed iron arc around the trunnion.
    arc = []
    for i in range(13):
        a = math.radians(-70 + 50 * i / 12)
        arc.append(Vector((CHEEK_X + 0.065, -math.cos(a) * QR, tz + math.sin(a) * QR)))
    for lod in (0, 1):
        tube_along(N, "TL_Iron", arc, 0.0, 6, lod, rect=(0.018, 0.035))
    if True:
        for i in range(1, 12):
            a = math.radians(-70 + 50 * i / 12)
            p = Vector((CHEEK_X + 0.065, -math.cos(a) * QR, tz + math.sin(a) * QR))
            n = Vector((0, -math.cos(a), math.sin(a)))
            emit(acc(N, 0), hull([p + n * 0.018 + Vector((dx, 0, 0)) + n.cross(Vector((1, 0, 0))) * dt
                                  for dx in (-0.009, 0.009) for dt in (-0.006, 0.006)] +
                                 [p + n * 0.032 + Vector((dx, 0, 0)) for dx in (-0.009, 0.009)]), "TL_Iron", Matrix.Identity(4), False)
    a0 = math.radians(-70)
    beam(N, "TL_Iron", (CHEEK_X + 0.065, -math.cos(a0) * QR, tz + math.sin(a0) * QR), (CHEEK_X + 0.065, -0.02, 0.14), 0.018, 0.03,
         bevel=0.004)
    a1 = math.radians(-20)
    beam(N, "TL_Iron", (CHEEK_X + 0.065, -math.cos(a1) * QR, tz + math.sin(a1) * QR), (CHEEK_X + 0.02, -0.12, tz - 0.05), 0.018, 0.03,
         bevel=0.004)


SCOPE_Z = 0.42                  # sight line above the trunnion (Elevation frame), parallel to the rails
SCOPE_EYE_Y, SCOPE_LENS_Y = -0.36, 0.47


def build_scope():
    """Brass sighting telescope on two iron standards over the keel (Elevation frame, so it pitches with the
    rails but stays still under the firing recoil). The objective holds a resonance lens that glows blue."""
    N = "Scope"
    for yy in (-0.16, 0.28):
        beam(N, "TL_Iron", (0, yy, 0.0), (0, yy, SCOPE_Z - 0.03), 0.035, 0.03, bevel=0.006, up=Vector((0, 1, 0)))
        for lod in (0, 1):
            torus(N, "TL_Iron", T((0, yy, SCOPE_Z), (math.pi / 2, 0, 0)), 0.034, 0.007, 14 if lod == 0 else 8, 5 if lod == 0 else 4, lod)
        box(N, "TL_Iron", (0.07, 0.04, 0.012), T((0, yy, 0.006)), bevel=0.003)
        stud(N, "TL_Brass", T((0.026, yy, 0.012)), s=0.012, h=0.006)
        stud(N, "TL_Brass", T((-0.026, yy, 0.012)), s=0.012, h=0.006)
    # Tube: eyepiece, draw tube, main body, objective bell.
    cyl(N, "TL_WoodDark", 0.036, 0.075, T((0, SCOPE_EYE_Y + 0.0375, SCOPE_Z)), seg=(14, 8), axis='Y')
    cyl(N, "TL_Brass", 0.040, 0.012, T((0, SCOPE_EYE_Y + 0.006, SCOPE_Z)), seg=(14, 8), axis='Y')
    cyl(N, "TL_Brass", 0.026, 0.12, T((0, SCOPE_EYE_Y + 0.135, SCOPE_Z)), seg=(14, 8), axis='Y')
    cyl(N, "TL_Brass", 0.031, 0.50, T((0, 0.10, SCOPE_Z)), seg=(16, 8), axis='Y')
    cyl(N, "TL_Brass", 0.031, 0.06, T((0, 0.38, SCOPE_Z)), seg=(16, 8), axis='Y', r2=0.044)
    cyl(N, "TL_Brass", 0.046, 0.05, T((0, 0.435, SCOPE_Z)), seg=(16, 8), axis='Y')
    for yy in (-0.12, 0.02, 0.32):
        cyl(N, "TL_Brass", 0.035, 0.012, T((0, yy, SCOPE_Z)), seg=(16, 8), axis='Y', lods=(0,))
    # Resonance lens and a crystal range dial on the left of the body.
    cyl(N, "TL_Resonance", 0.040, 0.006, T((0, SCOPE_LENS_Y - 0.005, SCOPE_Z)), seg=(16, 8), axis='Y')
    cyl(N, "TL_Brass", 0.022, 0.03, T((-0.045, 0.12, SCOPE_Z)), seg=(12, 6), axis='X')
    cyl(N, "TL_Resonance", 0.016, 0.004, T((-0.061, 0.12, SCOPE_Z)), seg=(12, 6), axis='X')


def build_launch_frame():
    """Static part of the elevating launch assembly (Recoil frame)."""
    N = "LaunchFrame"
    for sx in (-1, 1):
        x = sx * RX
        zc = RAIL_TOP - RAIL_H / 2
        # Rail stock with a chamfered underside nose.
        beam(N, "TL_Wood", (x, RAIL_Y0, zc), (x, RAIL_Y1, zc), RAIL_W, RAIL_H, bevel=0.018)
        beam(N, "TL_Wood", (x, RAIL_Y1 - 0.30, RAIL_TOP - RAIL_H - 0.025), (x, RAIL_Y0 + 0.30, RAIL_TOP - RAIL_H - 0.025), 0.10, 0.05,
             bevel=0.012)
        # Raised bolt track (rib) with a mithril wear cap.
        # It stops short of the folded vanes so they never touch the track.
        beam(N, "TL_WoodDark", (x, RAIL_Y0 + 0.50, RAIL_TOP + RIB_H / 2 - 0.005), (x, RIB_Y1, RAIL_TOP + RIB_H / 2 - 0.005), RIB_W,
             RIB_H - 0.01, bevel=0.006)
        beam(N, "TL_Mithril", (x, RAIL_Y0 + 0.50, RAIL_TOP + RIB_H - 0.004), (x, RIB_Y1 - 0.005, RAIL_TOP + RIB_H - 0.004),
             RIB_W + 0.004, 0.009, bevel=0.003)
        box(N, "TL_Brass", (RIB_W + 0.012, 0.02, RIB_H + 0.006), T((x, RIB_Y1, RAIL_TOP + RIB_H / 2 - 0.002)), bevel=0.004)
        # Iron bands with rivets on both faces.
        for yb in (-0.48, -0.10, 0.30):
            box(N, "TL_Iron", (RAIL_W + 0.018, 0.055, RAIL_H + 0.018), T((x, yb, zc)), bevel=0.007)
            for gx in (-1, 1):
                stud(N, "TL_Brass", T((x + gx * (RAIL_W / 2 + 0.009), yb, zc), (0, gx * math.pi / 2, 0)), s=0.022)
        # Prod housing: iron cheeks either side of the rail where the prod passes through (open on top).
        for gx in (-1, 1):
            box(N, "TL_Iron", (0.022, 0.14, RAIL_H + 0.05), T((x + gx * (RAIL_W / 2 + 0.011), PROD_Y, zc - 0.01)), bevel=0.008)
            stud(N, "TL_Brass", T((x + gx * (RAIL_W / 2 + 0.022), PROD_Y + 0.035, zc), (0, gx * math.pi / 2, 0)), s=0.026)
            stud(N, "TL_Brass", T((x + gx * (RAIL_W / 2 + 0.022), PROD_Y - 0.035, zc), (0, gx * math.pi / 2, 0)), s=0.026)
        box(N, "TL_Iron", (RAIL_W + 0.06, 0.14, 0.03), T((x, PROD_Y, RAIL_TOP - RAIL_H - 0.02)), bevel=0.008)
        # Prod centre block (laminate) the limbs root into.
        box(N, "TL_WoodDark", (2 * LIMB_ROOT + 0.05, 0.10, 0.10), T((x, PROD_Y, PROD_Z)), bevel=0.014)
        for gx in (-1, 1):
            box(N, "TL_Brass", (0.02, 0.105, 0.105), T((x + gx * (LIMB_ROOT + 0.02), PROD_Y, PROD_Z)), bevel=0.004)
        # Iron-shod muzzle end with a brass rivet pair.
        box(N, "TL_Iron", (RAIL_W + 0.014, 0.04, RAIL_H + 0.014), T((x, RAIL_Y1 - 0.018, zc)), bevel=0.008)
        for gx in (-1, 1):
            stud(N, "TL_Brass", T((x + gx * 0.04, RAIL_Y1 + 0.002, zc), (-math.pi / 2, 0, 0)), s=0.026, h=0.012)
        # Windlass cheeks on the rail tail.
        for gx in (-1, 1):
            cx = x + gx * 0.072
            pts = [Vector((cx + dx, yy, RAIL_TOP - 0.005)) for dx in (-0.017, 0.017) for yy in (DRUM_Y - 0.11, DRUM_Y + 0.11)]
            pts += [Vector((cx + dx, yy, DRUM_Z + 0.055)) for dx in (-0.017, 0.017) for yy in (DRUM_Y - 0.055, DRUM_Y + 0.055)]
            for lod in (0, 1):
                emit(acc(N, lod), hull(pts), "TL_Wood", Matrix.Identity(4), False)
            cyl(N, "TL_Iron", 0.032, 0.042, T((cx, DRUM_Y, DRUM_Z)), seg=(10, 8))
        # Crank-shaft bearing bracket hanging behind the rail end.
        bx = x + sx * 0.03
        beam(N, "TL_Iron", (bx, RAIL_Y0 + 0.02, RAIL_TOP - 0.02), (bx, CRANK_Y, CRANK_Z), 0.03, 0.05, bevel=0.006)
        cyl(N, "TL_Iron", 0.03, 0.05, T((bx, CRANK_Y, CRANK_Z)), seg=(10, 8))
    # Central stock body (keel) between the trunnion cheeks.
    beam(N, "TL_Wood", (0, RAIL_Y0 + 0.02, -0.06), (0, 0.82, -0.06), KEEL_W, 0.12, bevel=0.018)
    strap(N, T((0, 0.30, 0.002)), (KEEL_W + 0.012, 0.05, 0.012), studs=((-0.05, 0), (0.05, 0)))
    strap(N, T((0, -0.30, 0.002)), (KEEL_W + 0.012, 0.05, 0.012), studs=((-0.05, 0), (0.05, 0)))
    # Trunnion pin with iron straps around the keel.
    cyl(N, "TL_Iron", 0.034, 2 * CHEEK_X + 0.10, T((0, 0, 0)), seg=(12, 8))
    for gx in (-1, 1):
        box(N, "TL_Iron", (0.03, 0.16, 0.15), T((gx * (KEEL_W / 2 + 0.012), 0, -0.05)), bevel=0.006)
        stud(N, "TL_Brass", T((gx * (KEEL_W / 2 + 0.027), 0, -0.05), (0, gx * math.pi / 2, 0)), s=0.03, h=0.014)
    # Elevation pointer riding over the quadrant on the right cheek.
    beam(N, "TL_Iron", (KEEL_W / 2 + 0.02, -0.02, -0.06), (CHEEK_X + 0.075, -0.17, -0.10), 0.016, 0.022, bevel=0.004)
    stud(N, "TL_Brass", T((CHEEK_X + 0.085, -0.17, -0.10), (0, math.pi / 2, 0)), s=0.024)
    # Transoms linking the rails to the keel (clear of the cheeks over the elevation range).
    for yy, w, h in ((0.70, 0.10, 0.08), (0.32, 0.09, 0.07), (RAIL_Y0 + 0.05, 0.10, 0.09)):
        beam(N, "TL_Wood", (-RX, yy, -0.07), (RX, yy, -0.07), w, h, bevel=0.014)
    # Corner brackets where the front and rear transoms meet the rails.
    for sx in (-1, 1):
        for yy in (0.70, RAIL_Y0 + 0.05):
            box(N, "TL_Iron", (0.09, 0.13, 0.02), T((sx * (RX - RAIL_W / 2 - 0.04), yy, -0.025)), bevel=0.006)
            stud(N, "TL_Brass", T((sx * (RX - RAIL_W / 2 - 0.04), yy, -0.015)), s=0.022)
    # Filament rest: a forged spur forward of the keel ending in an open fork.
    keel_front = Vector((0, 0.82, -0.06))
    spur = [keel_front, Vector((0, 0.98, -0.065)), Vector((0, HORN.y - 0.12, HORN.z - 0.05)), Vector((0, HORN.y - 0.03, HORN.z - 0.035))]
    for lod in (0, 1):
        tube_along(N, "TL_Iron", spur, 0.0, 8 if lod == 0 else 6, lod, rect=(0.04, 0.034))
    box(N, "TL_Iron", (KEEL_W + 0.01, 0.06, 0.13), T((0, 0.80, -0.06)), bevel=0.01)
    for gx in (-1, 1):
        pr = [Vector((gx * 0.024, HORN.y - 0.05, HORN.z - 0.04)), Vector((gx * 0.024, HORN.y + 0.005, HORN.z - 0.012)),
              Vector((gx * 0.024, HORN.y + 0.035, HORN.z + 0.035))]
        for lod in (0, 1):
            tube_along(N, "TL_Iron", pr, 0.0095, 8 if lod == 0 else 5, lod)
    cyl(N, "TL_Brass", 0.013, 0.056, T((0, HORN.y, HORN.z - 0.014)), seg=(10, 6))
    # Ratchet/gear support plates either side of the centre gear.
    for gx in (-1, 1):
        pts = [Vector((gx * 0.075 + dx, yy, -0.005)) for dx in (-0.012, 0.012) for yy in (DRUM_Y - 0.12, DRUM_Y + 0.10)]
        pts += [Vector((gx * 0.075 + dx, yy, DRUM_Z + 0.04)) for dx in (-0.012, 0.012) for yy in (DRUM_Y - 0.05, DRUM_Y + 0.05)]
        for lod in (0, 1):
            emit(acc(N, lod), hull(pts), "TL_Iron", Matrix.Identity(4), False)
    # Trigger shaft hangers.
    for sx in (-1, 1):
        box(N, "TL_Iron", (0.03, 0.05, 0.09), T((sx * (RX - 0.04), TRIGGER_Y, TRIGGER_Z + 0.045)), bevel=0.005)
    # Operator tiller grips at the rear corners, angled down and back.
    for sx in (-1, 1):
        hx = sx * 0.30
        p0 = Vector((hx, RAIL_Y0 + 0.08, -0.07))
        p1 = Vector((hx, RAIL_Y0 - 0.12, -0.12))
        p2 = Vector((hx, RAIL_Y0 - 0.36, -0.20))
        for lod in (0, 1):
            tube_along(N, "TL_Iron", [p0, p1], 0.0, 6, lod, rect=(0.04, 0.035))
            tube_along(N, "TL_WoodDark", [p1 + (p2 - p1) * 0.08, p2], 0.028, 10 if lod == 0 else 6, lod)
        cyl(N, "TL_Brass", 0.032, 0.03, T(tuple(p1 + (p2 - p1) * 0.06), (math.atan2(p2.z - p1.z, p2.y - p1.y) - math.pi / 2, 0, 0)),
            seg=(10, 6), axis='Z')
        cyl(N, "TL_Brass", 0.031, 0.03, T(tuple(p2), (math.atan2(p2.z - p1.z, p2.y - p1.y) - math.pi / 2, 0, 0)), seg=(10, 6),
            axis='Z')


def build_limb(node, side_x, inner):
    """Laminated recurve prod limb, origin at its root."""
    dirx = -math.copysign(1, side_x) if inner else math.copysign(1, side_x)

    def cl(s):
        x, y = limb_curve(min(max(s, 0.0), 1.0))
        return Vector((dirx * x, y, 0))

    for lod in (0, 1):
        n = 12 if lod == 0 else 5
        secs = []
        for i in range(n + 1):
            s = i / n
            c = cl(s)
            t = (cl(s + 0.01) - cl(s - 0.01)).normalized()
            ya = Vector((0, 0, 1))
            xa = t.cross(ya).normalized()
            w = 0.064 * (1 - 0.5 * s)    # depth along the bend
            h = 0.11 * (1 - 0.42 * s)    # height
            secs.append(ring_section(c, xa, ya, w / 2, h / 2, 8 if lod == 0 else 6, 0.5))
        loft(node, "TL_WoodDark", secs, lod)
    # Brass wraps (lashing bands) along the limb.
    for s in (0.20, 0.62):
        c = cl(s)
        t = (cl(s + 0.01) - cl(s - 0.01)).normalized()
        ang = math.atan2(t.y, t.x)
        w = 0.064 * (1 - 0.5 * s) + 0.008
        h = 0.11 * (1 - 0.42 * s) + 0.008
        box(node, "TL_Brass", (0.016, w, h), T(tuple(c), (0, 0, ang)), bevel=0.003, lods=(0,))
    # Forged iron tip cap with a string nock.
    tip = cl(1.0)
    t = (cl(1.0) - cl(0.97)).normalized()
    ang = math.atan2(t.y, t.x)
    box(node, "TL_Iron", (0.06, 0.04, 0.072), T(tuple(tip - t * 0.02), (0, 0, ang)), bevel=0.008)
    cyl(node, "TL_Brass", 0.014, 0.09, T(tuple(tip)), seg=(8, 6), axis='Z')


def build_string(node, radius=0.0085):
    """Unit-length cord along local +Y; animated via scale.y."""
    for lod, seg in ((0, 6), (1, 4)):
        pts = cyl_pts(radius, 1.0, seg, axis='Y')
        faces = hull([p + Vector((0, 0.5, 0)) for p in pts])
        emit(acc(node, lod), faces, "TL_Rope", Matrix.Identity(4), True)


def build_sled(side_x):
    N = "Sled_" + ("L" if side_x < 0 else "R")
    rib_top = RAIL_TOP + RIB_H - STRING_Z   # local z of the rib top
    # Saddle over the rail and rib, behind the hook point (origin = hook point).
    box(N, "TL_Iron", (RAIL_W + 0.07, 0.15, 0.03), T((0, -0.09, rib_top + 0.022)), bevel=0.008)
    for gx in (-1, 1):
        box(N, "TL_Iron", (0.018, 0.15, 0.12), T((gx * (RAIL_W / 2 + 0.03), -0.09, rib_top - 0.035)), bevel=0.005)
        stud(N, "TL_Brass", T((gx * (RAIL_W / 2 + 0.039), -0.09, rib_top - 0.035), (0, gx * math.pi / 2, 0)), s=0.022)
    box(N, "TL_WoodDark", (0.08, 0.10, 0.045), T((0, -0.10, rib_top + 0.058)), bevel=0.01)
    stud(N, "TL_Brass", T((0, -0.10, rib_top + 0.08)), s=0.028)
    # Cable eye at the rear.
    cyl(N, "TL_Brass", 0.017, 0.035, T((0, -0.175, rib_top + 0.03)), seg=(8, 6), axis='Z')
    # Claw: two iron fingers either side of the nock (separate node, pivots on X).
    C = "Claw_" + ("L" if side_x < 0 else "R")
    for gx in (-1, 1):
        for lod in (0, 1):
            pts = [Vector((gx * 0.026, -0.05, -0.012)), Vector((gx * 0.026, 0.014, -0.004)), Vector((gx * 0.026, 0.006, 0.032)),
                   Vector((gx * 0.026, -0.05, 0.022))]
            ptsw = [p + Vector((d, 0, 0)) for p in pts for d in (-0.009, 0.009)]
            emit(acc(C, lod), hull(ptsw), "TL_Iron", Matrix.Identity(4), False)
    cyl(C, "TL_Brass", 0.011, 0.08, T((0, -0.045, 0.0)), seg=(8, 6))


def build_cable(node):
    build_string(node, radius=0.010)


GEAR_X, RATCHET_X = 0.02, -0.032


def build_windlass():
    N = "Drum"
    cyl(N, "TL_Iron", 0.022, 2 * RX + 0.18, T((0, 0, 0)), seg=(10, 8))
    for sx in (-1, 1):
        x = sx * RX
        cyl(N, "TL_Wood", DRUM_R, 0.11, T((x, 0, 0)), seg=(14, 10))
        for gx in (-1, 1):
            cyl(N, "TL_Iron", DRUM_R + 0.022, 0.016, T((x + gx * 0.056, 0, 0)), seg=(14, 10))
        pts = []
        turns, n = 3.2, 64
        for i in range(n + 1):
            a = 2 * math.pi * turns * i / n
            pts.append(Vector((x - 0.042 + 0.084 * i / n, math.cos(a) * (DRUM_R + 0.009), math.sin(a) * (DRUM_R + 0.009))))
        tube_along(N, "TL_Rope", pts, 0.010, 6, 0)
        cyl(N, "TL_Rope", DRUM_R + 0.012, 0.09, T((x, 0, 0)), seg=(10, 10), lods=(1,))
    for lod in (0, 1):
        gear(N, "TL_Iron", T((GEAR_X, 0, 0)), GEAR_R, GEAR_TEETH, 0.032, lod, tooth_h=0.02)
    cyl(N, "TL_Brass", 0.045, 0.04, T((GEAR_X, 0, 0)), seg=(12, 8))
    # Spokes read the rotation even when the teeth blur.
    for k in range(4):
        m = T((GEAR_X, 0, 0)) @ Matrix.Rotation(k * math.pi / 2, 4, 'X')
        box(N, "TL_Brass", (0.036, 0.016, GEAR_R * 1.5), m, bevel=0.003, lods=(0,))
    # Ratchet wheel.
    emit(acc(N, 0), hull(cyl_pts(0.062, 0.026, 12)), "TL_Iron", T((RATCHET_X, 0, 0)), True)
    for i in range(12):
        a = 2 * math.pi * i / 12
        m = T((RATCHET_X, 0, 0)) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Translation((0, 0, 0.062))
        pts = [Vector((dx, dy, dz)) for dx in (-0.013, 0.013) for (dy, dz) in ((-0.016, 0), (0.011, 0), (0.011, 0.018))]
        emit(acc(N, 0), hull(pts), "TL_Iron", m, False)
    emit(acc(N, 1), hull(cyl_pts(0.072, 0.026, 10)), "TL_Iron", T((RATCHET_X, 0, 0)), True)


def build_crank():
    N = "Crank"
    L = 2 * RX + 0.36
    cyl(N, "TL_Iron", 0.02, L, T((0, 0, 0)), seg=(10, 8))
    for lod in (0, 1):
        gear(N, "TL_Iron", T((GEAR_X, 0, 0)), PINION_R, PINION_TEETH, 0.036, lod, tooth_h=0.017)
    for sx in (-1, 1):
        x = sx * (L / 2)
        beam(N, "TL_Iron", (x, 0, 0.02), (x, 0, -0.19), 0.04, 0.03, bevel=0.007)
        cyl(N, "TL_WoodDark", 0.025, 0.13, T((x + sx * 0.08, 0, -0.18)), seg=(10, 6), r2=0.021)
        cyl(N, "TL_Brass", 0.03, 0.02, T((x + sx * 0.02, 0, -0.18)), seg=(10, 6))
        cyl(N, "TL_Brass", 0.023, 0.016, T((x + sx * 0.148, 0, -0.18)), seg=(10, 6), lods=(0,))
        cyl(N, "TL_Brass", 0.032, 0.03, T((x, 0, 0)), seg=(10, 6))


PAWL_POS = (RATCHET_X, DRUM_Y - 0.085, DRUM_Z + 0.075)


def build_pawl():
    N = "Pawl"
    # Pivot origin; the dog reaches forward and down onto the ratchet teeth.
    beam(N, "TL_Iron", (0, 0, 0), (0, 0.07, -0.012), 0.02, 0.022, bevel=0.004)
    cyl(N, "TL_Brass", 0.014, 0.045, T((0, 0, 0)), seg=(8, 6))
    # Release tab the operator flips.
    beam(N, "TL_Iron", (0, 0, 0), (0, -0.045, 0.06), 0.018, 0.016, bevel=0.003)
    cyl(N, "TL_WoodDark", 0.013, 0.032, T((0, -0.048, 0.068)), seg=(8, 6), axis='Z')


def build_trigger():
    N = "Trigger"
    cyl(N, "TL_Iron", 0.018, 2 * RX - 0.02, T((0, 0, 0)), seg=(10, 6))
    # Sear arms rising into each rail under the claw.
    for sx in (-1, 1):
        beam(N, "TL_Iron", (sx * RX, 0, 0), (sx * RX, 0.06, 0.05), 0.024, 0.02, bevel=0.004)
    # Long trigger bar back between the operator grips, brass knob at the end.
    lev = [Vector((0, 0, 0)), Vector((0, -0.40, -0.005)), Vector((0, -0.72, 0.0)), Vector((0, -0.84, -0.045))]
    for lod in (0, 1):
        tube_along(N, "TL_Iron", lev, 0.0, 6, lod, rect=(0.026, 0.022))
    cyl(N, "TL_Brass", 0.03, 0.06, T(tuple(lev[-1])), seg=(10, 6), axis='Z')
    cyl(N, "TL_Brass", 0.028, 0.05, T((0, 0, 0)), seg=(10, 6))


# ---------------------------------------------------------------------------
# Bolt geometry (shared by the projectile asset and the loaded bolts)
# ---------------------------------------------------------------------------
SHAFT_R = 0.027
VANE_Y0, VANE_Y1 = -0.075, -0.255     # hinge (front) and trailing edge stations
VANE_W = 0.052
VANE_ANG = (math.radians(45), math.radians(-45))   # around the inboard direction


def vane_frame(side, ang):
    """Hinge frame for a vane. side=+1: inboard is +X (left bolt)."""
    radial = Vector((side * math.cos(ang), 0, math.sin(ang)))
    tangent = Vector((0, 1, 0)).cross(radial).normalized()
    origin = Vector((0, VANE_Y0, 0)) + radial * (SHAFT_R / math.cos(math.radians(22.5)) * 0.97 + 0.004)
    # local X = tangent (hinge axis), local Y = +Y (towards tip), local Z = radial
    m = Matrix((tangent, Vector((0, 1, 0)), radial)).transposed().to_4x4()
    m.translation = origin
    return m


def shaft_radius(y):
    """Barrelled ash shaft: true to SHAFT_R under the folded vanes, swelling mid-length, slimming to the nock."""
    if y >= -0.30:
        return SHAFT_R
    if y >= -0.48:
        return SHAFT_R + 0.0025 * math.sin((y + 0.30) / -0.18 * math.pi / 2)
    return SHAFT_R + 0.0025 - 0.0065 * ((y + 0.48) / -(BOLT_LEN_AFT - 0.48)) ** 1.4


def build_bolt(prefix, side, lods=(0, 1)):
    """Timberline bolt (second pass, 2026-10-04). prefix: node prefix, side: +1 for the left bolt (eye toward +X).
    Leaf broadhead with a glowing rune fuller and swept barbs, barrelled ash shaft with brass wire binding,
    a resonance crystal in the collar, feathered iron fins edged in blue light and a tracer glow in the nock."""
    B = prefix
    X, Z = Vector((1, 0, 0)), Vector((0, 0, 1))
    for lod in lods:
        seg = 10 if lod == 0 else 6
        # Shaft: lofted rings so the profile can barrel and taper.
        ys = [-BOLT_LEN_AFT + 0.025 + (BOLT_LEN_AFT - 0.045) * k / (12 if lod == 0 else 4) for k in range((12 if lod == 0 else 4) + 1)]
        loft(B, "TL_WoodDark", [ring_section(Vector((0, y, 0)), X, Z, shaft_radius(y), shaft_radius(y), seg, 0.5) for y in ys], lod)
        # Broadhead: socket neck, then a leaf blade with a raised spine (cutting edges along X).
        emit(acc(B, lod), hull(cyl_pts(0.021, 0.04, 8 if lod == 0 else 6, r2=0.014, axis='Y')), "TL_Mithril", T((0, 0.045, 0)), lod == 0)
        outline = [(0, BOLT_LEN_FWD), (0.030, 0.160), (0.058, 0.100), (0.050, 0.074), (0.020, 0.060)]
        pts = [Vector((sx * x, y, 0)) for (x, y) in outline for sx in (-1, 1)]
        pts += [Vector((0, y, sz * 0.0105)) for y in (0.066, 0.172) for sz in (-1, 1)]
        emit(acc(B, lod), hull(pts), "TL_Mithril", Matrix.Identity(4), False)
        if lod == 0:
            # Swept-back barbs at the blade shoulders.
            for sx in (-1, 1):
                bp = [Vector((sx * 0.050, 0.076, 0)), Vector((sx * 0.069, 0.032, 0)), Vector((sx * 0.036, 0.064, 0)),
                      Vector((sx * 0.044, 0.068, 0.004)), Vector((sx * 0.044, 0.068, -0.004))]
                emit(acc(B, lod), hull(bp), "TL_Mithril", Matrix.Identity(4), False)
            # Rune fuller: a glowing inlay down the spine on both faces, plus two rune lozenges at the shoulders.
            for sz in (-1, 1):
                fp = [Vector((0, 0.078, sz * 0.0104)), Vector((0, 0.166, sz * 0.0104)), Vector((0.0045, 0.12, sz * 0.0099)),
                      Vector((-0.0045, 0.12, sz * 0.0099)), Vector((0, 0.078, sz * 0.0118)), Vector((0, 0.166, sz * 0.0118)),
                      Vector((0.0045, 0.12, sz * 0.0113)), Vector((-0.0045, 0.12, sz * 0.0113))]
                emit(acc(B, lod), hull(fp), "TL_Resonance", Matrix.Identity(4), False)
                for sx in (-1, 1):
                    c = Vector((sx * 0.026, 0.088, sz * 0.0066))
                    lp = [c + Vector((0.006, 0, 0)), c - Vector((0.006, 0, 0)), c + Vector((0, 0.009, 0)), c - Vector((0, 0.009, 0)),
                          c + Vector((0, 0, sz * 0.0016))]
                    emit(acc(B, lod), hull(lp), "TL_Resonance", Matrix.Identity(4), False)
        # Collar (brass ferrule) with raised rims, and a resonance crystal set in its crown.
        emit(acc(B, lod), hull(cyl_pts(0.036, 0.05, 10 if lod == 0 else 6, axis='Y')), "TL_Brass", T((0, 0.005, 0)), lod == 0)
        if lod == 0:
            for yy in (-0.021, 0.031):
                cyl(B, "TL_Brass", 0.039, 0.007, T((0, yy, 0)), seg=(12, 6), axis='Y', lods=(0,))
        gem = [Vector((0, 0.005, 0.036 + 0.017)), Vector((0.010, 0.005, 0.040)), Vector((-0.010, 0.005, 0.040)),
               Vector((0, 0.019, 0.040)), Vector((0, -0.009, 0.040)), Vector((0, 0.005, 0.033))]
        emit(acc(B, lod), hull(gem), "TL_Resonance", Matrix.Identity(4), False)
        if lod == 0:
            torus(B, "TL_Brass", T((0, 0.005, 0.041), (0, 0, 0)), 0.0115, 0.0028, 10, 4, 0)
        # Feathered iron fins in an X (clears the rib and lets the string pass between them), edged in blue light.
        for k in range(4):
            a = math.pi / 4 + math.pi / 2 * k
            m = T((0, 0, 0), (0, a, 0))
            prof = [(-0.615, SHAFT_R * 0.75), (-0.665, 0.070), (-0.745, 0.090), (-0.835, 0.094), (-0.874, 0.086), (-0.884, SHAFT_R * 0.75)]
            ptsw = [Vector((d, y, r)) for (y, r) in prof for d in (-0.0032, 0.0032)]
            emit(acc(B, lod), hull(ptsw), "TL_Iron", m, False)
            if lod == 0:
                edge = [Vector((d, y, r + 0.0045)) for (y, r) in prof[1:5] for d in (-0.0022, 0.0022)] + \
                       [Vector((d, y, r + 0.0005)) for (y, r) in prof[1:5] for d in (-0.0022, 0.0022)]
                emit(acc(B, lod), hull(edge), "TL_Resonance", m, False)
                for dz in (-1, 1):
                    stud(B, "TL_Brass", m @ T((dz * 0.0034, -0.80, 0.058), (0, dz * math.pi / 2, 0)), s=0.009, h=0.004)
        # Nock: flared brass cap with a tracer glow facing aft, so the pair reads in flight from the operator's seat.
        emit(acc(B, lod), hull(cyl_pts(0.030, 0.042, 8 if lod == 0 else 6, r2=0.035, axis='Y')), "TL_Brass", T((0, -BOLT_LEN_AFT + 0.02, 0)), lod == 0)
        emit(acc(B, lod), hull(cyl_pts(0.017, 0.006, 8 if lod == 0 else 6, axis='Y')), "TL_Resonance", T((0, -BOLT_LEN_AFT - 0.0025, 0)), False)
    if 0 in lods:
        # Brass wire binding: tight turns behind the folded vanes, and a pair ahead of the fins.
        for yy in [-0.315 - 0.0062 * k for k in range(7)] + [-0.585, -0.5975]:
            torus(B, "TL_Brass", T((0, yy, 0), (math.pi / 2, 0, 0)), shaft_radius(yy) + 0.0012, 0.0029, 10, 3, 0)
        # Eyelet ring: hole axis along X so the filament passes laterally.
        torus(B, "TL_Mithril", T((side * EYE_OFF, 0.005, 0), (0, math.pi / 2, 0)), 0.016, 0.0055, 12, 6, 0)
    if 1 in lods:
        torus(B, "TL_Mithril", T((side * EYE_OFF, 0.005, 0), (0, math.pi / 2, 0)), 0.016, 0.006, 6, 4, 1)
    # Vanes: separate hinge nodes. Mithril leaves with a glowing spine on the outer face.
    for vi, ang in enumerate(VANE_ANG):
        V = f"{prefix}_Vane{'Upper' if vi == 0 else 'Lower'}"
        for lod in lods:
            L = VANE_Y0 - VANE_Y1
            pts = [Vector((0, 0.0, 0)), Vector((VANE_W / 2, -0.03, 0)), Vector((VANE_W / 2, -L * 0.8, 0)),
                   Vector((0.0, -L, 0)), Vector((-VANE_W / 2, -L * 0.8, 0)), Vector((-VANE_W / 2, -0.03, 0))]
            ptsw = [p + Vector((0, 0, dz)) for p in pts for dz in (0.0, 0.004)]
            emit(acc(V, lod), hull(ptsw), "TL_Mithril", Matrix.Identity(4), False)
            if lod == 0:
                sp = [Vector((dx, y, z)) for y in (-0.025, -L * 0.86) for dx in (-0.0026, 0.0026) for z in (0.0041, 0.0056)]
                emit(acc(V, lod), hull(sp), "TL_Resonance", Matrix.Identity(4), False)
        cyl(V, "TL_Brass", 0.006, VANE_W * 0.9, T((0, 0, 0.002)), seg=(6, 4), lods=lods)


# ---------------------------------------------------------------------------
# Scene assembly
# ---------------------------------------------------------------------------

def make_materials(tex_dir):
    mats = {}

    def img(name, srgb=True):
        im = bpy.data.images.load(os.path.join(tex_dir, name), check_existing=True)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        return im

    # Second texture pass (2026-10-04): every surface has a normal map, and wood, iron and brass carry packed
    # occlusion/roughness/metal maps so rust, tarnish, wax and scratches catch light differently.
    spec = {
        "TL_Wood": dict(tex="tl_wood_basecolor.jpg", nrm="tl_wood_normal.jpg", orm="tl_wood_orm.jpg", tint=(1, 1, 1), metal=0.0, rough=0.62, nstr=0.9),
        "TL_WoodDark": dict(tex="tl_wood_basecolor.jpg", nrm="tl_wood_normal.jpg", orm="tl_wood_orm.jpg", tint=(0.46, 0.36, 0.31), metal=0.0, rough=0.48, nstr=0.7),
        "TL_Iron": dict(tex="tl_iron_basecolor.jpg", nrm="tl_iron_normal.jpg", orm="tl_iron_orm.jpg", tint=(1, 1, 1), metal=0.85, rough=0.5, nstr=0.9),
        "TL_Brass": dict(tex="tl_brass_basecolor.jpg", nrm="tl_brass_normal.jpg", orm="tl_brass_orm.jpg", tint=(1, 1, 1), metal=1.0, rough=0.34, nstr=0.5),
        "TL_Mithril": dict(tex="tl_mithril_basecolor.jpg", nrm="tl_mithril_normal.jpg", tint=(1, 1, 1), metal=1.0, rough=0.18, nstr=0.4),
        "TL_Rope": dict(tex="tl_rope_basecolor.jpg", nrm="tl_rope_normal.jpg", tint=(1, 1, 1), metal=0.0, rough=0.92, nstr=1.0),
        # Blue resonance light: rune inlays, crystals and edge lines. Emissive, so it reads at dusk and at range.
        "TL_Resonance": dict(col=(0.04, 0.22, 0.55), metal=0.0, rough=0.25, emit=(0.06, 0.48, 1.0), emit_strength=1.0),
    }
    for name in MAT_ORDER:
        sp = spec[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Metallic"].default_value = sp["metal"]
        bsdf.inputs["Roughness"].default_value = sp["rough"]
        if "tex" in sp:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img(sp["tex"])
            if sp["tint"] != (1, 1, 1):
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs["Factor"].default_value = 1.0
                nt.links.new(t.outputs["Color"], mix.inputs[6])
                mix.inputs[7].default_value = (*sp["tint"], 1)
                nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
            else:
                nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            bsdf.inputs["Base Color"].default_value = (*sp["col"], 1)
        if "nrm" in sp:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img(sp["nrm"], srgb=False)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = sp["nstr"]
            nt.links.new(t.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        if "orm" in sp:
            # glTF packing: G roughness, B metalness. The exporter keeps the image as one metallicRoughness texture.
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img(sp["orm"], srgb=False)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(t.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        if "emit" in sp:
            bsdf.inputs["Emission Color"].default_value = (*sp["emit"], 1)
            bsdf.inputs["Emission Strength"].default_value = sp["emit_strength"]
        mats[name] = m
    return mats


def mesh_object(name, a, mats, parent):
    used = sorted(set(a.mats))
    remap = {old: new for new, old in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata(a.verts, [], a.faces)
    for u in used:
        me.materials.append(mats[MAT_ORDER[u]])
    uv = me.uv_layers.new(name="UVMap")
    for pi, poly in enumerate(me.polygons):
        for k, loop_index in enumerate(poly.loop_indices):
            uv.data[loop_index].uv = a.uvs[pi][k]
        poly.material_index = remap[a.mats[pi]]
        poly.use_smooth = a.smooth[pi]
    # Weld coincident verts so smooth shading works across hull faces.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    me.set_sharp_from_angle(angle=math.radians(40))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def empty(name, parent=None, loc=(0, 0, 0), kind='PLAIN_AXES', size=0.05):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    ob.rotation_mode = 'QUATERNION'
    return ob


def attach_meshes(node_name, pivot, mats, lods=(0, 1)):
    out = []
    for lod in lods:
        a = ACCS.get((node_name, lod))
        if a is None or not a.faces:
            continue
        out.append(mesh_object(f"{node_name}__LOD{lod}", a, mats, pivot))
    return out


def quat_y_to(d):
    return Vector((0, 1, 0)).rotation_difference(d.normalized())


# ---------------------------------------------------------------------------
# Mechanism state: one function, sampled into every clip.
# ---------------------------------------------------------------------------

def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def ease_in(t):
    t = min(max(t, 0.0), 1.0)
    return t * t


def alpha_pulse(tau, tp):
    if tau <= 0:
        return 0.0
    return (tau / tp) * math.exp(1 - tau / tp)


def damped(tau, amp, freq, decay):
    if tau <= 0:
        return 0.0
    return amp * math.exp(-tau / decay) * math.cos(2 * math.pi * freq * tau)


EVENTS = {
    "Fire": [("trigger_pull", 0.0), ("release", 0.05), ("recoil_peak", 0.085), ("settled", 0.70)],
    "Reload": [("reload_start", 0.0), ("pawl_release", 0.12), ("strings_caught", 0.62), ("winding_start", 0.75),
               ("strings_latched", 2.20), ("bolts_seat", 2.62), ("filament_reset", 2.80), ("reload_complete", 3.15)],
    "Idle_Loaded": [("pawl_tick", 1.2)],
}
CLIP_LEN = {"Fire": 0.75, "Reload": 3.15, "Idle_Loaded": 3.0, "Unloaded": 0.5}


def state_loaded(t_idle=0.0):
    w = 2 * math.pi * t_idle / 3.0
    return dict(theta=THETA_DRAW * (1 + 0.012 * math.sin(w)), sled=LATCH_Y, slap=0.0, claw=0.0, trigger=0.0,
                drum=0.0, crank=0.0, pawl=math.radians(3.0) * max(0.0, 1 - abs(t_idle - 1.2) / 0.08) if t_idle else 0.0,
                recoil_y=0.0012 * math.sin(w), recoil_rx=math.radians(0.04) * math.sin(w + 0.7), shake_z=0.0, shake_y=0.0,
                bolt_vis=1.0, bolt_dz=0.0, bolt_dy=0.0)


def state_fire(t):
    s = state_loaded()
    tR = EVENTS["Fire"][1][1]
    s["trigger"] = -math.radians(14) * ease((t) / tR)
    s["claw"] = -math.radians(55) * ease((t - 0.03) / 0.03)
    tau = t - tR
    if tau >= 0:
        # String snaps forward to brace and slaps past it, limbs ring down.
        f = ease_in(tau / 0.022)
        s["sled"] = LATCH_Y
        s["string_free"] = True
        brace_y = BRACE_Y
        s["slap"] = (1 - f) * (LATCH_Y - brace_y) + (damped(tau - 0.022, 0.045, 13.0, 0.07) if tau > 0.022 else 0.0)
        s["theta"] = THETA_DRAW * (1 - f) + (damped(tau - 0.022, -0.22 * THETA_DRAW, 13.0, 0.07) if tau > 0.022 else 0.0)
        s["recoil_y"] = -0.065 * alpha_pulse(tau, 0.035) + damped(tau, 0.006, 9.0, 0.10) * (1 if tau > 0.06 else 0)
        s["recoil_rx"] = math.radians(1.4) * alpha_pulse(tau, 0.05)
        s["shake_z"] = math.radians(0.55) * math.exp(-tau / 0.12) * math.sin(2 * math.pi * 11 * tau)
        s["shake_y"] = math.radians(0.35) * math.exp(-tau / 0.10) * math.sin(2 * math.pi * 15 * tau + 1.0)
        s["bolt_vis"] = 0.0   # the projectile asset takes over on the release frame
        s["bolt_dy"] = 0.0
    return s


def state_unloaded():
    s = state_fire(10.0)
    s.update(recoil_y=0.0, recoil_rx=0.0, shake_z=0.0, shake_y=0.0, slap=0.0, theta=0.0)
    return s


def state_reload(t):
    s = state_unloaded()
    brace_y = BRACE_Y
    catch_y = brace_y - 0.004
    pay = 6.0 * 0.45 / 0.45  # drum radians paid out for the full stroke
    # Pawl lifts, drum pays out, sleds run forward to the strings.
    s["pawl"] = math.radians(32) * (ease(t / 0.12) - ease((t - 0.60) / 0.10))
    run = ease((t - 0.15) / 0.40)
    s["sled"] = LATCH_Y + (catch_y - LATCH_Y) * run
    s["drum"] = pay * run
    # Claws snap shut on the strings, trigger resets.
    if t >= 0.55:
        k = ease((t - 0.55) / 0.07)
        s["claw"] = -math.radians(55) * (1 - k) + (damped(t - 0.62, math.radians(5), 9, 0.04) if t > 0.62 else 0)
        s["trigger"] = -math.radians(14) * (1 - ease((t - 0.56) / 0.10))
    # Wind back: crank turns GEAR_RATIO x the drum.
    if t >= 0.75:
        w = ease((t - 0.75) / (2.20 - 0.75))
        s["sled"] = catch_y + (LATCH_Y - catch_y) * w
        s["drum"] = pay * (1 - w)
        s["string_free"] = False
        s["theta"] = THETA_DRAW * w
        # Pawl clicks over the ratchet (12 teeth => every 30 deg of drum).
        ph = (s["drum"] / (2 * math.pi / 12)) % 1.0
        s["pawl"] = math.radians(9) * (ph ** 3) * (1 if t < 2.2 else 0)
    elif t >= 0.55:
        s["string_free"] = False
        s["theta"] = 0.0
    s["crank"] = -GEAR_RATIO * (s["drum"] - pay) if t >= 0.75 else 0.0
    # Bolts are lowered into the grooves and bump into the nocks.
    if t < 2.25:
        s["bolt_vis"] = 0.0
    else:
        s["bolt_vis"] = 1.0
        k = ease((t - 2.25) / 0.37)
        s["bolt_dz"] = 0.30 * (1 - k) + (damped(t - 2.62, 0.006, 8, 0.05) if t > 2.62 else 0)
        s["bolt_dy"] = -0.05 * (1 - k)
    if t >= 2.20:
        # Latch: a small settle of the whole launch assembly.
        s["recoil_y"] = damped(t - 2.20, -0.004, 6, 0.08)
    if t >= 2.62:
        s["recoil_rx"] = damped(t - 2.62, math.radians(-0.25), 5, 0.08)
    if t >= 3.15 - 1e-6:
        s = state_loaded()
    return s


def apply_state(nodes, s):
    # Limbs and strings
    for side_x, tag in ((-RX, "L"), (RX, "R")):
        tips = {}
        for inner, lt in ((False, "Outer"), (True, "Inner")):
            root, tip, a = limb_tip(side_x, inner, s["theta"])
            ob = nodes[f"Limb_{tag}_{lt}"]
            ob.location = root
            ob.rotation_quaternion = Quaternion((0, 0, 1), a)
            tips[lt] = tip
        if s.get("string_free"):
            ny = (tips["Outer"].y + tips["Inner"].y) / 2 + s["slap"]
            nock = Vector((side_x, ny, STRING_Z))
        else:
            nock = Vector((side_x, s["sled"], STRING_Z))
        for lt in ("Outer", "Inner"):
            ob = nodes[f"String_{tag}_{lt}"]
            d = nock - tips[lt]
            ob.location = tips[lt]
            ob.rotation_quaternion = quat_y_to(d)
            ob.scale = (1, max(d.length, 1e-4), 1)
        sled = nodes[f"Sled_{tag}"]
        sled.location = (side_x, s["sled"], STRING_Z)
        claw = nodes[f"Claw_{tag}"]
        claw.rotation_quaternion = Quaternion((1, 0, 0), s["claw"])
        # Cable from drum bottom to sled rear eye.
        start = Vector((side_x, DRUM_Y + 0.012, DRUM_Z - DRUM_R - 0.008))
        end = Vector((side_x, s["sled"] - 0.175, RAIL_TOP + RIB_H + 0.03))
        cab = nodes[f"Cable_{tag}"]
        d = end - start
        cab.location = start
        cab.rotation_quaternion = quat_y_to(d)
        cab.scale = (1, d.length, 1)
        bolt = nodes[f"LoadedBolt_{tag}"]
        bolt.location = (side_x, COLLAR_Y + s["bolt_dy"], BOLT_Z + s["bolt_dz"])
        v = s["bolt_vis"]
        bolt.scale = (v, v, v)
    nodes["Drum"].rotation_quaternion = Quaternion((1, 0, 0), s["drum"])
    nodes["Crank"].rotation_quaternion = Quaternion((1, 0, 0), s["crank"])
    nodes["Pawl"].rotation_quaternion = Quaternion((1, 0, 0), s["pawl"])
    nodes["Trigger"].rotation_quaternion = Quaternion((1, 0, 0), s["trigger"])
    nodes["Recoil"].location = (0, s["recoil_y"], 0)
    nodes["Recoil"].rotation_quaternion = Quaternion((1, 0, 0), s["recoil_rx"])
    nodes["CarriageShake"].rotation_quaternion = Quaternion((0, 0, 1), s["shake_z"]) @ Quaternion((0, 1, 0), s["shake_y"])


ANIMATED = None  # filled in build()


def bake_clip(nodes, clip, fn, length, step_scale_nodes=()):
    frames = int(round(length * FPS))
    prevq = {}
    for name in ANIMATED:
        ob = nodes[name]
        ob.animation_data_create()
        act = bpy.data.actions.new(f"{clip}__{name}")
        ob.animation_data.action = act
    for f in range(frames + 1):
        t = f / FPS
        s = fn(t)
        apply_state(nodes, s)
        for name in ANIMATED:
            ob = nodes[name]
            q = ob.rotation_quaternion.copy()
            if name in prevq and prevq[name].dot(q) < 0:
                q.negate()
                ob.rotation_quaternion = q
            prevq[name] = q
            ob.keyframe_insert("location", frame=f + 1)
            ob.keyframe_insert("rotation_quaternion", frame=f + 1)
            ob.keyframe_insert("scale", frame=f + 1)
    for name in ANIMATED:
        ob = nodes[name]
        act = ob.animation_data.action
        if name in step_scale_nodes:
            for fc in _fcurves(act):
                if fc.data_path == "scale":
                    for kp in fc.keyframe_points:
                        kp.interpolation = 'CONSTANT'
        tr = ob.animation_data.nla_tracks.new()
        tr.name = clip
        st = tr.strips.new(clip, 1, act)
        if hasattr(st, "action_slot") and len(getattr(act, "slots", [])):
            st.action_slot = act.slots[0]
        ob.animation_data.action = None


def _fcurves(act):
    if hasattr(act, "layers") and len(act.layers):
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
        return out
    return list(act.fcurves)


def build_ballista(mats):
    root = empty("TimberlineBallista", None, (0, 0, 0), 'ARROWS', 0.3)
    nodes = {"TimberlineBallista": root}
    build_pedestal()
    build_carriage()
    build_launch_frame()
    ped = empty("Pedestal", root)
    attach_meshes("Pedestal", ped, mats)
    trav = empty("Traverse", root, (0, 0, TRAVERSE_Z), 'SINGLE_ARROW', 0.4)
    shake = empty("CarriageShake", trav)
    nodes.update(Traverse=trav, CarriageShake=shake)
    car = empty("Carriage", shake)
    attach_meshes("Carriage", car, mats)
    elev = empty("Elevation", shake, (0, 0, TRUNNION_Z - TRAVERSE_Z), 'ARROWS', 0.3)
    rec = empty("Recoil", elev)
    nodes.update(Elevation=elev, Recoil=rec)
    lf = empty("LaunchFrame", rec)
    attach_meshes("LaunchFrame", lf, mats)
    build_scope()
    sc = empty("Scope", elev)
    attach_meshes("Scope", sc, mats)
    nodes["Scope"] = sc
    for tag, sx in (("L", -RX), ("R", RX)):
        for inner, lt in ((False, "Outer"), (True, "Inner")):
            n = f"Limb_{tag}_{lt}"
            ob = empty(n, rec)
            build_limb(n, sx, inner)
            attach_meshes(n, ob, mats)
            nodes[n] = ob
            sn = f"String_{tag}_{lt}"
            so = empty(sn, rec)
            build_string(sn)
            attach_meshes(sn, so, mats)
            nodes[sn] = so
        build_sled(sx)
        sl = empty(f"Sled_{tag}", rec)
        attach_meshes(f"Sled_{tag}", sl, mats)
        cl = empty(f"Claw_{tag}", sl, (0, -0.012, 0.0))
        attach_meshes(f"Claw_{tag}", cl, mats)
        cn = f"Cable_{tag}"
        co = empty(cn, rec)
        build_cable(cn)
        attach_meshes(cn, co, mats)
        bn = f"LoadedBolt_{tag}"
        bo = empty(bn, rec)
        side = 1 if tag == "L" else -1
        build_bolt(bn, side)
        attach_meshes(bn, bo, mats)
        for vi in ("Upper", "Lower"):
            vn = f"{bn}_Vane{vi}"
            ang = VANE_ANG[0 if vi == "Upper" else 1]
            vf = vane_frame(side, ang)
            vo = empty(vn, bo)
            vo.location = vf.translation
            vo.rotation_quaternion = vf.to_quaternion()
            attach_meshes(vn, vo, mats)
        nodes.update({f"Sled_{tag}": sl, f"Claw_{tag}": cl, cn: co, bn: bo})
    build_windlass()
    dr = empty("Drum", rec, (0, DRUM_Y, DRUM_Z))
    attach_meshes("Drum", dr, mats)
    build_crank()
    cr = empty("Crank", rec, (0, CRANK_Y, CRANK_Z))
    attach_meshes("Crank", cr, mats)
    build_pawl()
    pw = empty("Pawl", rec, PAWL_POS)
    attach_meshes("Pawl", pw, mats)
    build_trigger()
    tg = empty("Trigger", rec, (0, TRIGGER_Y, TRIGGER_Z))
    attach_meshes("Trigger", tg, mats)
    nodes.update(Drum=dr, Crank=cr, Pawl=pw, Trigger=tg)

    # Sockets (empties, no meshes). Names are stable API.
    def sock(name, parent, loc, quat=None):
        s = empty(name, parent, loc, 'SPHERE', 0.03)
        if quat is not None:
            s.rotation_quaternion = quat
        nodes[name] = s
        return s

    for tag, sx in (("L", -RX), ("R", RX)):
        inward = 1 if tag == "L" else -1
        sock(f"Socket_Muzzle_{tag}", rec, (sx, COLLAR_Y, BOLT_Z))
        sock(f"Socket_LoadedEye_{tag}", rec, (sx + inward * EYE_OFF, COLLAR_Y + 0.005, BOLT_Z))
        sock(f"Socket_AimGrip_{tag}", rec, (sx * 0.30, RAIL_Y0 - 0.25, -0.165))
        sock(f"Socket_CrankGrip_{tag}", nodes["Crank"], (sx * (RX + 0.18 + 0.08), 0, -0.18))
        sock(f"FX_StringSnap_{tag}", rec, (sx, BRACE_Y, STRING_Z))
        sock(f"FX_Muzzle_{tag}", rec, (sx, RAIL_Y1 + 0.02, BOLT_Z))
    sock("Socket_FilamentHorn", rec, tuple(HORN))
    sock("Socket_Trigger", nodes["Trigger"], (0, -0.84, -0.045))
    sock("Socket_OperatorEye", root, (0, -1.25, 1.62))
    sock("Socket_ScopeEye", elev, (0, SCOPE_EYE_Y - 0.03, SCOPE_Z))
    sock("Socket_ScopeLens", elev, (0, SCOPE_LENS_Y, SCOPE_Z))
    sock("Socket_RTSAnchor", root, (0, 0, 1.4))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        sock(f"FX_FootDust_{k}", ped, (math.cos(a) * 0.95, math.sin(a) * 0.95, 0.0))
    return root, nodes


def build_bolt_pair(mats):
    root = empty("TimberlineBoltPair", None, (0, 0, 0), 'ARROWS', 0.2)
    nodes = {}
    for tag, side, x in (("L", 1, -RX), ("R", -1, RX)):
        bn = f"Bolt_{tag}"
        bo = empty(bn, root, (x, 0, 0), 'ARROWS', 0.1)
        build_bolt(bn, side)
        attach_meshes(bn, bo, mats)
        nodes[bn] = bo
        for vi in ("Upper", "Lower"):
            vn = f"{bn}_Vane{vi}"
            ang = VANE_ANG[0 if vi == "Upper" else 1]
            vf = vane_frame(side, ang)
            vo = empty(vn, bo)
            vo.location = vf.translation
            vo.rotation_quaternion = vf.to_quaternion()
            attach_meshes(vn, vo, mats)
            nodes[vn] = vo
        s = empty(f"{bn}_FilamentEye", bo, (side * EYE_OFF, 0.005, 0), 'SPHERE', 0.02)
        s = empty(f"{bn}_Tip", bo, (0, BOLT_LEN_FWD, 0), 'SPHERE', 0.02)
        s = empty(f"{bn}_Nock", bo, (0, -BOLT_LEN_AFT, 0), 'SPHERE', 0.02)
        s = empty(f"{bn}_FX_Head", bo, (0, 0.10, 0), 'SPHERE', 0.02)
    return root, nodes


VANE_OPEN = math.radians(40)
BOLT_EVENTS = {"Deploy": [("fins_open", 0.0), ("fins_settled", 0.22)], "Impact": [("impact", 0.0)]}


def bake_bolts(nodes):
    vane_names = [n for n in nodes if "_Vane" in n]
    rest = {n: nodes[n].rotation_quaternion.copy() for n in vane_names}

    def vane_angle(clip, t):
        if clip == "Folded":
            return 0.0
        if clip == "Deploy":
            # Flick open in ~2 frames, overshoot, settle.
            k = ease(t / 0.035)
            return VANE_OPEN * k + (damped(t - 0.035, math.radians(9), 11, 0.06) if t > 0.035 else 0)
        if clip == "Impact":
            return VANE_OPEN + damped(t, math.radians(-12), 14, 0.08) * (1 if t > 0 else 0)
        return 0.0

    for clip, length in (("Deploy", 0.4), ("Impact", 0.4), ("Folded", 0.2)):
        acts = {}
        for n in vane_names:
            ob = nodes[n]
            ob.animation_data_create()
            act = bpy.data.actions.new(f"{clip}__{n}")
            ob.animation_data.action = act
            acts[n] = act
        frames = int(round(length * FPS))
        for f in range(frames + 1):
            t = f / FPS
            a = vane_angle(clip, t)
            for n in vane_names:
                ob = nodes[n]
                # Rotate about the hinge (local X): trailing edge lifts outward (+local Z).
                ob.rotation_quaternion = rest[n] @ Quaternion((1, 0, 0), -a)
                ob.keyframe_insert("rotation_quaternion", frame=f + 1)
        for n in vane_names:
            ob = nodes[n]
            tr = ob.animation_data.nla_tracks.new()
            tr.name = clip
            st = tr.strips.new(clip, 1, acts[n])
            if hasattr(st, "action_slot") and len(getattr(acts[n], "slots", [])):
                st.action_slot = acts[n].slots[0]
            ob.animation_data.action = None
            ob.rotation_quaternion = rest[n]


def build_collision():
    """Proxies on the same pivot names. Boxes and cylinders only."""
    root = empty("TimberlineCollision", None)
    out = []

    def cbox(name, parent, size, loc, rot=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = loc
        ob.rotation_euler = rot
        ob.scale = size
        out.append(dict(name=name, shape="box", parent=parent.name, size_blender=list(size), loc_blender=list(loc), rot_blender=list(rot)))
        return ob

    def ccyl(name, parent, r, h, loc):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r, depth=h)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = loc
        out.append(dict(name=name, shape="cylinder_y", parent=parent.name, radius=r, height=h, loc_blender=list(loc)))
        return ob

    ped = empty("Pedestal", root)
    ccyl("COL_Column", ped, 0.34, TRAVERSE_Z, (0, 0, TRAVERSE_Z / 2))
    cbox("COL_Feet_A", ped, (2.04, 0.21, 0.175), (0, 0, 0.0875), (0, 0, math.radians(45)))
    cbox("COL_Feet_B", ped, (2.04, 0.21, 0.175), (0, 0, 0.0875), (0, 0, math.radians(-45)))
    trav = empty("Traverse", root, (0, 0, TRAVERSE_Z))
    ccyl("COL_Carriage", trav, 0.37, 0.08, (0, 0, 0.04))
    cbox("COL_Fork", trav, (2 * CHEEK_X + 0.12, 0.66, TRUNNION_Z - TRAVERSE_Z + 0.06), (0, 0, (TRUNNION_Z - TRAVERSE_Z) / 2 + 0.03))
    elev = empty("Elevation", trav, (0, 0, TRUNNION_Z - TRAVERSE_Z))
    rec = empty("Recoil", elev)
    for tag, sx in (("L", -RX), ("R", RX)):
        cbox(f"COL_Rail_{tag}", rec, (RAIL_W + 0.03, RAIL_Y1 - RAIL_Y0, RAIL_H + RIB_H + 0.02),
             (sx, (RAIL_Y0 + RAIL_Y1) / 2, RAIL_TOP - (RAIL_H - RIB_H) / 2))
        cbox(f"COL_Prod_{tag}", rec, (2 * (LIMB_ROOT + LIMB_LEN), 0.20, 0.12), (sx, PROD_Y - 0.08, PROD_Z))
    cbox("COL_Keel", rec, (KEEL_W, 0.82 - RAIL_Y0, 0.14), (0, (0.82 + RAIL_Y0) / 2, -0.06))
    cbox("COL_Windlass", rec, (2 * RX + 0.50, 0.30, 0.32), (0, (DRUM_Y + CRANK_Y) / 2, 0.06))
    cbox("COL_Horn", rec, (0.08, HORN.y - 0.80, 0.12), (0, (HORN.y + 0.80) / 2, (HORN.z - 0.06) / 2))
    return root, out


def export(path, roots, anims=True):
    bpy.ops.object.select_all(action='DESELECT')
    for r in roots:
        for ob in [r] + list(r.children_recursive):
            ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=anims, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_frame_range=False, export_extras=True, export_cameras=False, export_lights=False,
        export_image_format='AUTO', export_materials='EXPORT', export_normals=True, export_texcoords=True,
        export_tangents=False, export_attributes=False, export_skins=False, export_morph=False,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_object=True, export_anim_single_armature=False)


def repack_images(path, tex_dir, json_fix=None):
    """The glTF exporter re-encodes images (bigger PNG/JPEG). Swap the
    original deterministic texture files back in and re-lay the buffer.
    json_fix(j) may edit the glTF JSON (e.g. names) in the same pass."""
    import struct
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    if json_fix:
        json_fix(j)
    j.setdefault("images", [])
    bin_off = 20 + jlen + 8
    blob = data[bin_off:]
    files = {os.path.splitext(n)[0]: n for n in os.listdir(tex_dir)}
    views = j["bufferViews"]
    replace = {}
    for im in j["images"]:
        fn = files.get(im.get("name"))
        if fn:
            with open(os.path.join(tex_dir, fn), "rb") as f:
                replace[im["bufferView"]] = f.read()
            im["mimeType"] = "image/png" if fn.endswith(".png") else "image/jpeg"
    out = bytearray()
    for i, bv in enumerate(views):
        chunk = replace.get(i)
        if chunk is None:
            o = bv.get("byteOffset", 0)
            chunk = blob[o:o + bv["byteLength"]]
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(chunk)
        out += chunk
    while len(out) % 4:
        out.append(0)
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(out), 0x004E4942) + bytes(out))


def glb_stats(path):
    import struct
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    tris = {"LOD0": 0, "LOD1": 0, "other": 0}
    for node in j.get("nodes", []):
        if "mesh" not in node:
            continue
        mesh = j["meshes"][node["mesh"]]
        n = 0
        for p in mesh["primitives"]:
            acc_ = j["accessors"][p["indices"]]
            n += acc_["count"] // 3
        key = "LOD0" if node["name"].endswith("__LOD0") else "LOD1" if node["name"].endswith("__LOD1") else "other"
        tris[key] += n
    imgs = []
    for im in j.get("images", []):
        bv = j["bufferViews"][im["bufferView"]]
        imgs.append(dict(name=im.get("name"), mime=im.get("mimeType"), bytes=bv["byteLength"]))
    return dict(bytes=len(data), triangles=tris, materials=len(j.get("materials", [])),
                animations=[(a["name"], len(a["channels"])) for a in j.get("animations", [])],
                images=imgs, nodes=len(j.get("nodes", [])))


def build(out_dir, render_dir=None):
    bpy.context.preferences.filepaths.save_version = 0
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    tex_dir = os.path.join(out_dir, "textures")
    textures.build(tex_dir)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = FPS
    scn.unit_settings.system = 'METRIC'
    mats = make_materials(tex_dir)

    global ANIMATED
    ballista, bn = build_ballista(mats)
    ANIMATED = ["Recoil", "CarriageShake", "Drum", "Crank", "Pawl", "Trigger"] + [
        f"{p}_{t}" for t in ("L", "R") for p in ("Sled", "Claw", "Cable", "LoadedBolt")] + [
        f"{p}_{t}_{lt}" for t in ("L", "R") for p in ("Limb", "String") for lt in ("Outer", "Inner")]
    for name in ANIMATED:
        bn[name].rotation_mode = 'QUATERNION'
    steps = [f"LoadedBolt_{t}" for t in ("L", "R")]
    # NLA evaluates bottom-to-top and the exporter samples the scene at frame 1
    # for rest transforms, so the loaded idle track is baked last (on top).
    bake_clip(bn, "Fire", state_fire, CLIP_LEN["Fire"], steps)
    bake_clip(bn, "Reload", state_reload, CLIP_LEN["Reload"], steps)
    bake_clip(bn, "Unloaded", lambda t: state_unloaded(), CLIP_LEN["Unloaded"], steps)
    bake_clip(bn, "Idle_Loaded", state_loaded, CLIP_LEN["Idle_Loaded"])
    apply_state(bn, state_loaded())   # rest pose = loaded
    contract = make_contract()
    ballista["timberline"] = json.dumps(contract["ballista"])

    bolts, bnodes = build_bolt_pair(mats)
    bake_bolts(bnodes)
    bolts["timberline"] = json.dumps(contract["bolts"])
    bolts.location = (0, 0, 0)
    # Keep the pair beside the machine in the .blend for editing only.
    col_root, col_list = build_collision()

    scn.frame_set(1)
    p_ball = os.path.join(out_dir, "timberline_ballista.glb")
    p_bolt = os.path.join(out_dir, "timberline_bolts.glb")
    p_col = os.path.join(out_dir, "timberline_collision.glb")
    export(p_ball, [ballista])
    export(p_bolt, [bolts])
    export(p_col, [col_root], anims=False)
    repack_images(p_ball, tex_dir)
    repack_images(p_bolt, tex_dir)

    def strip_dup_suffix(j):
        # Blender suffixes duplicate names (Pedestal.001); the proxies must carry
        # the exact pivot names of the ballista so they can be re-parented.
        import re
        for n in j["nodes"]:
            n["name"] = re.sub(r"\.\d{3}$", "", n["name"])
    repack_images(p_col, tex_dir, strip_dup_suffix)
    bolts.location = (2.2, 0, 0)
    col_root.location = (-2.4, 0, 0)
    for ob in col_root.children_recursive:
        ob.display_type = 'WIRE'
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "timberline_source.blend"), compress=True)

    report = dict(
        builder="build_timberline.py", blender=bpy.app.version_string,
        ballista=glb_stats(p_ball), bolts=glb_stats(p_bolt), collision=glb_stats(p_col),
        texture_files={f: os.path.getsize(os.path.join(tex_dir, f)) for f in sorted(os.listdir(tex_dir))},
        contract=contract, collision_proxies=col_list)
    with open(os.path.join(out_dir, "build_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    with open(os.path.join(out_dir, "timberline_contract.json"), "w", encoding="utf-8") as f:
        json.dump(contract, f, indent=1)
    return report


def b2g(v):
    """Blender (x, y, z) -> glTF/Three (x, z, -y)."""
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]


def make_contract():
    return {
        "version": 1,
        "units": "metre", "up": "+Y", "forward": "-Z", "right": "+X",
        "ballista": {
            "origin": "ground centre under the traverse axis",
            "pivots": {
                "Traverse": {"pos": b2g((0, 0, TRAVERSE_Z)), "axis": "+Y (yaw)", "range_deg": None},
                "Elevation": {"pos_in_traverse": b2g((0, 0, TRUNNION_Z - TRAVERSE_Z)), "axis": "+X (pitch, positive = muzzle up in Three)",
                              "range_deg": [-8, 25]},
                "Recoil": {"note": "animated by clips: translation along local +Z (backwards) and small pitch"},
                "Drum": {"axis": "local X", "pos_in_recoil": b2g((0, DRUM_Y, DRUM_Z))},
                "Crank": {"axis": "local X", "gear_ratio": GEAR_RATIO, "pos_in_recoil": b2g((0, CRANK_Y, CRANK_Z))},
                "Trigger": {"axis": "local X", "pos_in_recoil": b2g((0, TRIGGER_Y, TRIGGER_Z))},
                "Limb_*": {"axis": "local Y (Three)", "note": "rotate at limb root"},
                "String_*": {"note": "unit cord along local +Y, scaled on Y to span tip -> nock"},
                "Claw_*": {"axis": "local X"},
                "Vanes": {"axis": "local X at hinge", "open_deg": math.degrees(VANE_OPEN)},
            },
            "rail_centres_x": [-RX, RX],
            "loaded_eye_spacing": round(2 * (RX - EYE_OFF), 4),
            "filament_taut_length": FILAMENT_LEN,
            "filament_horn": b2g(HORN),
            "events": EVENTS, "clip_lengths": CLIP_LEN,
            "cooldown_fit": {"fire_plus_reload_s": CLIP_LEN["Fire"] + CLIP_LEN["Reload"], "budget_s": 4.0},
        },
        "bolts": {
            "origin": "collar station on the shaft axis (filament eye is offset inboard)",
            "tip_offset": b2g((0, BOLT_LEN_FWD, 0)), "nock_offset": b2g((0, -BOLT_LEN_AFT, 0)),
            "eye_offset_left": b2g((EYE_OFF, 0.005, 0)), "eye_offset_right": b2g((-EYE_OFF, 0.005, 0)),
            "shaft_radius": SHAFT_R, "length": BOLT_LEN_FWD + BOLT_LEN_AFT,
            "collision_capsule": {"radius": 0.045, "from": b2g((0, BOLT_LEN_FWD, 0)), "to": b2g((0, -BOLT_LEN_AFT, 0))},
            "events": BOLT_EVENTS, "vane_open_deg": math.degrees(VANE_OPEN),
        },
    }


def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    out = os.path.join(os.path.dirname(HERE), "out")
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    rep = build(out)
    print(json.dumps({k: rep[k] for k in ("ballista", "bolts", "collision")}, indent=1))


if __name__ == "__main__":
    main()
