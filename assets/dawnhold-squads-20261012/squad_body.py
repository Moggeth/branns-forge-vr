"""Dawnhold squads: the shared Forgeling Mk II body every unit is built from (bpy, headless, deterministic).

Modelled from scratch for the RTS roster (2026-10-12), on the same 18-joint rig as the skeleton warband and the
first Forgeling, so the game's procedural walk, hit parts and dismemberment keep working.

Look: a warm sandstone "kettle" body with brass banding, a brass face mask with big crystal eyes and brass eyelids
(the lids carry each unit's expression), a smiling grille jaw, cog ears, a Dawnhold sun medallion round the crystal
heart, a firebox hatch glowing on the back, articulated brass gauntlets, hobnailed boots and a blue livery tabard.
Authored Z-up facing -Y; the glTF exporter maps that to +Y up, facing +Z (asset-pose.js contract).
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'skeleton-warband-20261004'))
import build_skeleton as SK  # noqa: E402  (rig, Part, UVs, AO, outlines)
TX = SK.TX
V = Vector
J = SK.J
HC = V((0, 0.02, 1.53))  # head centre before the bobble scale
BLUE = (0.16, 0.34, 0.8)
GOLD = (1.0, 0.86, 0.52)
CREAM = (0.95, 0.9, 0.78)


# ------------------------------------------------------------------ materials
def stone_tex(n=512):
    low = TX.fbm(n, 3, 3, 311); mid = TX.fbm(n, 14, 3, 323); fleck = TX.value_noise(n, 170, 329)
    chisel = TX.stretched(n, 90, 6, 331)
    base = np.array([0.93, 0.85, 0.7], np.float32); cool = np.array([0.8, 0.74, 0.64], np.float32)
    c = TX.mix(np.broadcast_to(base, (n, n, 3)), np.broadcast_to(cool, (n, n, 3)), TX.smooth(0.3, 0.8, low) * 0.5)
    c = c * (0.92 + 0.1 * mid[..., None]) * (1 - 0.1 * TX.smooth(0.82, 0.95, fleck)[..., None]) * (0.97 + 0.04 * chisel[..., None])
    return np.clip(c, 0, 1), TX.normal_from_height(low * 0.4 + mid * 0.5 + chisel * 0.35 - fleck * 0.2, 3.2)


def brass_tex(n=256):
    low = TX.fbm(n, 5, 4, 341); dents = TX.fbm(n, 12, 2, 351); speck = TX.value_noise(n, 80, 357)
    bright = np.array([0.97, 0.77, 0.42], np.float32); worn = np.array([0.74, 0.54, 0.28], np.float32)
    c = TX.mix(np.broadcast_to(bright, (n, n, 3)), np.broadcast_to(worn, (n, n, 3)), TX.smooth(0.45, 0.8, low) * 0.55)
    c = c * (0.92 + 0.1 * dents[..., None])
    rough = 0.26 + 0.22 * TX.smooth(0.45, 0.8, low) + 0.08 * speck
    orm = np.stack([np.ones_like(rough), rough, np.full_like(rough, 0.95)], -1)
    return np.clip(c, 0, 1), TX.normal_from_height(dents * 0.5 + speck * 0.2, 3.0), np.clip(orm, 0, 1)


def steel_tex(n=256):
    low = TX.fbm(n, 4, 4, 381); dents = TX.fbm(n, 10, 2, 391); speck = TX.value_noise(n, 90, 397)
    metal = np.array([0.6, 0.62, 0.68], np.float32); blue = np.array([0.5, 0.52, 0.58], np.float32)
    c = TX.mix(np.broadcast_to(metal, (n, n, 3)), np.broadcast_to(blue, (n, n, 3)), TX.smooth(0.4, 0.75, low) * 0.6) * (0.9 + 0.14 * dents[..., None])
    rough = 0.3 + 0.18 * low + 0.08 * speck
    orm = np.stack([np.ones_like(rough), rough, np.full_like(rough, 0.92)], -1)
    return np.clip(c, 0, 1), TX.normal_from_height(dents * 0.6 + speck * 0.15, 3.0), np.clip(orm, 0, 1)


def make_materials():
    s_alb, s_nrm = stone_tex(); b_alb, b_nrm, b_orm = brass_tex(); f_alb, f_nrm = TX.fabric(); w_alb, w_nrm = TX.wood()
    i_alb, i_nrm, i_orm = steel_tex()
    I = SK.image
    M = {}
    M['stone'] = SK.material('Stone', {'albedo': I('stone_albedo', s_alb), 'normal': I('stone_normal', s_nrm, 'Non-Color')}, rough=0.84)
    M['brass'] = SK.material('Brass', {'albedo': I('brass_albedo', b_alb), 'normal': I('brass_normal', b_nrm, 'Non-Color'),
                                       'orm': I('brass_orm', b_orm, 'Non-Color')}, rough=1, metal=1)
    M['iron'] = SK.material('Iron', {'albedo': I('iron_albedo', i_alb), 'normal': I('iron_normal', i_nrm, 'Non-Color'),
                                     'orm': I('iron_orm', i_orm, 'Non-Color')}, rough=1, metal=1)
    M['cloth'] = SK.material('Cloth', {'albedo': I('cloth_albedo', f_alb), 'normal': I('cloth_normal', f_nrm, 'Non-Color')}, rough=0.9)
    M['fabric'] = SK.material('Strap', {'albedo': bpy.data.images['cloth_albedo'], 'normal': bpy.data.images['cloth_normal']}, rough=0.75)
    M['leather'] = SK.material('Leather', {'albedo': bpy.data.images['cloth_albedo'], 'normal': bpy.data.images['cloth_normal']}, rough=0.7)
    M['wood'] = SK.material('Wood', {'albedo': I('wood_albedo', w_alb), 'normal': I('wood_normal', w_nrm, 'Non-Color')}, rough=0.74)
    M['glow'] = SK.material('Crystal', {}, rough=0.15, color=(0.25, 0.55, 1.0), emit=(0.12, 0.42, 1.0), vcol=False)
    M['ember'] = SK.material('Ember', {}, rough=0.5, color=(1.0, 0.45, 0.12), emit=(1.0, 0.42, 0.08), vcol=False)
    M['hearth'] = SK.material('Hearth', {}, rough=0.3, color=(1.0, 0.78, 0.4), emit=(1.0, 0.7, 0.3), vcol=False)
    M['dark'] = SK.material('Socket', {}, rough=0.9, color=(0.04, 0.035, 0.04), vcol=False)
    M['white'] = SK.material('Catchlight', {}, rough=0.2, color=(1, 1, 1), emit=(1, 1, 1), vcol=False)
    return M


SK.DENSITY.update({'Stone': 3.0, 'Brass': 3.5, 'Iron': 3.5, 'Cloth': 3.4, 'Leather': 4.5, 'Strap': 4.5, 'Wood': 2.6,
                   'Crystal': 1.0, 'Ember': 1.0, 'Hearth': 1.0, 'Socket': 1.0, 'Catchlight': 1.0})
LEATHER_T = (0.5, 0.32, 0.19)


# ------------------------------------------------------------------ small helpers
def rot(axis, a):
    return Matrix.Rotation(a, 4, axis)


def ring(P, c, r, tube, axis='Z', seg=24, flat=(1, 1), ry=None, **k):
    """A closed band round an axis; ry gives an elliptical ring (round a barrel that is flattened front to back)."""
    ry = ry or r
    pts = []
    for i in range(seg):
        a = i / seg * math.tau
        if axis == 'Z': pts.append(V(c) + V((math.cos(a) * r, math.sin(a) * ry, 0)))
        elif axis == 'Y': pts.append(V(c) + V((math.cos(a) * r, 0, math.sin(a) * ry)))
        else: pts.append(V(c) + V((0, math.cos(a) * r, math.sin(a) * ry)))
    P.tube(pts, tube, seg=6, closed=True, flat=flat, **k)


def rivets(P, c, r, n, size=0.007, arc=(0, math.tau), ry=None, z=0.0, **k):
    ry = ry or r
    for i in range(n):
        a = arc[0] + (arc[1] - arc[0]) * (i + 0.5) / n
        P.sphere(V(c) + V((math.cos(a) * r, math.sin(a) * ry, z)), size, seg=6, rings=4, **k)


def cog(P, c, r, width, teeth=8, axis='X', **k):
    """A little brass cog: hub disc plus square teeth, its axle along axis."""
    c = V(c)
    d = {'X': V((1, 0, 0)), 'Y': V((0, 1, 0)), 'Z': V((0, 0, 1))}[axis]
    P.cyl(c - d * width / 2, c + d * width / 2, r, r, seg=16, **k)
    u = d.orthogonal().normalized(); w = d.cross(u)
    for i in range(teeth):
        a = i * math.tau / teeth
        p = c + (u * math.cos(a) + w * math.sin(a)) * (r + 0.008)
        m = Matrix((u * math.cos(a) + w * math.sin(a), d, (u * math.cos(a) + w * math.sin(a)).cross(d))).transposed().to_4x4()
        P.box(p, (0.016, width * 0.9, 0.014), rot=m, bevel=0.002, **k)


def superellipse(w, h, n=32, e=2.6):
    pts = []
    for i in range(n):
        a = i * math.tau / n
        ca, sa = math.cos(a), math.sin(a)
        pts.append((w * math.copysign(abs(ca) ** (2 / e), ca), h * math.copysign(abs(sa) ** (2 / e), sa)))
    return SK.ccw(pts)


def scale_verts(P, centre, k):
    """Scale everything built so far in a part about a centre (vector k per axis or a scalar)."""
    k = V(k) if not isinstance(k, (int, float)) else V((k, k, k))
    c = V(centre)
    for v in P.bm.verts:
        d = v.co - c
        v.co = c + V((d.x * k.x, d.y * k.y, d.z * k.z))


# ------------------------------------------------------------------ head
# lids: per eye (left, right) -> (open, tilt). open = height of the lid edge above the eye centre in eye radii
# (-1 shut, 0 half, 0.7 wide open); tilt > 0 drops the inner corner (determined), < 0 lifts it (worried/kind).
MOODS = {
    'eager': ((0.5, -0.12), (0.5, -0.12)),
    'stern': ((0.02, 0.32), (0.02, 0.32)),
    'focused': ((0.32, 0.18), (-0.18, 0.35)),
    'kind': ((0.18, -0.25), (0.18, -0.25)),
    'alarmed': ((0.8, -0.35), (0.8, -0.35)),
}


def lid_outline(r, open_, tilt, side):
    """Circle of radius r clipped to the part above a tilted line: the visible brass eyelid, eye-local (u right, v up)."""
    pts = []
    for i in range(64):
        a = i * math.tau / 64
        u, v = r * math.cos(a), r * math.sin(a)
        # line: v = open*r + slope*u, inner corner (towards the nose) lower when tilt > 0
        line = open_ * r + (-side) * -tilt * u * 1.0
        if v >= line: pts.append((u, v))
    return SK.ccw(pts) if len(pts) >= 3 else None


def build_head(P, mood='eager', look=(0.0, 0.0)):
    P.use(bone='Head', mat='stone', tint=(1, 1, 1))
    # kettle cranium: revolved profile, a touch wider than deep
    prof = [(-0.13, 0.11), (-0.11, 0.15), (-0.06, 0.172), (0.0, 0.178), (0.06, 0.172), (0.11, 0.15), (0.145, 0.11), (0.165, 0.055), (0.172, 0.0)]
    P.tube([HC + V((0, 0.015, z)) for z, _ in prof], [r for _, r in prof], seg=28, flat=(1.0, 0.9), up=(1, 0, 0))
    # brow ridge: carved stone shelf over the mask, one per eye so it can frown or lift
    lids = MOODS[mood]
    for i, s in enumerate((-1, 1)):
        o, t = lids[i]
        lift = 0.012 * (o - 0.3) - 0.0
        inner = HC + V((s * 0.02, -0.15, 0.085 + lift - 0.012 * t))
        outer = HC + V((s * 0.14, -0.1, 0.09 + lift + 0.01 * t))
        mid = (inner + outer) / 2 + V((0, -0.022, 0.012))
        P.tube([inner, mid, outer], [0.017, 0.022, 0.014], seg=10, flat=(1.0, 0.6), up=(0, -1, 0.4))
    # brass face mask with a gentle curve
    xf = Matrix.Translation(HC + V((0, -0.148, 0.002)))
    mask = superellipse(0.155, 0.075, 40, 3.0)
    P.slab(mask, -0.008, 0.03, xf=xf, bulge=0.018, rings=3, mat='brass')
    SK.rim(P, mask, -0.02, 0.012, mat='brass', width=0.012, xf=xf)
    rivets_pts = [(-0.14, 0.04), (0.14, 0.04), (-0.14, -0.045), (0.14, -0.045)]
    for u, v in rivets_pts: P.sphere(xf @ V((u, -0.025, v)), 0.008, seg=6, rings=4, mat='brass')
    # crystal eyes in deep bezels, with brass lids that carry the mood
    for i, s in enumerate((-1, 1)):
        e = HC + V((s * 0.068, -0.17, 0.006))
        P.cyl(e + V((0, 0.03, 0)), e + V((0, -0.018, 0)), 0.06, 0.057, seg=24, mat='brass')
        ring(P, e + V((0, -0.018, 0)), 0.057, 0.007, axis='Y', mat='brass')
        P.cyl(e + V((0, -0.008, 0)), e + V((0, -0.02, 0)), 0.048, 0.048, seg=24, mat='dark')
        P.sphere(e + V((0, -0.018, 0)), 0.044, scale=(1, 0.62, 1), seg=18, rings=10, mat='glow')
        lx, lz = look
        P.sphere(e + V((lx * 0.018, -0.044, lz * 0.018 - 0.002)), 0.014, scale=(1, 0.4, 1.15), seg=10, rings=6, mat='dark')
        P.sphere(e + V((-s * 0.016 + 0.012, -0.046, 0.018)), 0.0075, seg=6, rings=4, mat='white')
        o, t = lids[i]
        out = lid_outline(0.054, o, t, s)
        if out:
            lx_ = Matrix.Translation(e + V((0, -0.053, 0)))
            P.slab(out, -0.006, 0.006, xf=lx_, bulge=0.004, rings=1, mat='brass')
    # cheek vents
    for s in (-1, 1):
        for k in range(3):
            c = HC + V((s * 0.152, -0.075, -0.035 - k * 0.024))
            P.box(c, (0.012, 0.05, 0.012), rot=rot('Z', s * 0.75), bevel=0.003, mat='dark')
        # cog ears
        cog(P, HC + V((s * 0.18, 0.01, -0.005)), 0.034, 0.03, teeth=9, axis='X', mat='brass')
        P.sphere(HC + V((s * 0.198, 0.01, -0.005)), 0.016, seg=8, rings=5, mat='glow')
    # crown cap: a brass ring and rivets round the top of the kettle
    ring(P, HC + V((0, 0.015, 0.155)), 0.1, 0.012, ry=0.09, mat='brass')
    rivets(P, HC + V((0, 0.015, 0.155)), 0.1, 10, ry=0.09, size=0.007, mat='brass')


def build_jaw(P, smile=1.0):
    """Brass grille jaw on the HeadJaw hinge, bars set on a smile."""
    P.use(bone='HeadJaw', mat='brass')
    c = HC + V((0, -0.112, -0.115))
    P.box(c + V((0, 0.012, 0)), (0.2, 0.09, 0.07), bevel=0.025, smooth=True)
    P.box(c + V((0, -0.03, 0.012)), (0.15, 0.02, 0.035), mat='dark', bevel=0.006)
    for k in range(7):
        x = -0.06 + k * 0.02
        lift = smile * 0.012 * (x / 0.06) ** 2
        P.box(c + V((x, -0.042, 0.012 + lift / 2)), (0.008, 0.008, 0.036 + lift), bevel=0.002)
    P.tube([c + V((-0.085, -0.04, -0.02 + 0.01 * smile)), c + V((0, -0.05, -0.03)), c + V((0.085, -0.04, -0.02 + 0.01 * smile))], 0.01, seg=6)
    P.sphere(c + V((0, -0.05, -0.03)), 0.012, seg=8, rings=5, mat='glow')  # chin crystal


def bobble(P, k=1.18):
    scale_verts(P, HC, k)


# ------------------------------------------------------------------ body
TORSO_PROF = [(0.98, 0.15), (1.04, 0.19), (1.12, 0.222), (1.22, 0.236), (1.3, 0.228), (1.36, 0.2), (1.405, 0.15)]
FLAT = 0.88


def barrel_r(z):
    for (z0, r0), (z1, r1) in zip(TORSO_PROF, TORSO_PROF[1:]):
        if z0 <= z <= z1: return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return TORSO_PROF[0][1] if z < TORSO_PROF[0][0] else TORSO_PROF[-1][1]


def on_barrel(a, z, out=0.0):
    """Point on the barrel surface at angle a (0 = +X, -pi/2 = front)."""
    r = barrel_r(z) + out
    return V((math.cos(a) * r, 0.03 + math.sin(a) * r * FLAT, z))


def build_torso(P, medallion=True):
    P.use(bone='Torso', mat='stone')
    P.tube([V((0, 0.03, z)) for z, _ in TORSO_PROF], [r for _, r in TORSO_PROF], seg=28, flat=(1.0, FLAT), up=(1, 0, 0))
    # stone course lines (shallow dark grooves) between the bands
    for z in (1.16, 1.25):
        ring(P, (0, 0.03, z), barrel_r(z) + 0.001, 0.0035, ry=(barrel_r(z) + 0.001) * FLAT, mat='stone', tint=(0.55, 0.5, 0.44), seg=32)
    # brass bands with rivets, and vertical straps tying them
    for z in (1.06, 1.33):
        r = barrel_r(z) + 0.004
        ring(P, (0, 0.03, z), r, 0.017, ry=r * FLAT, mat='brass', flat=(0.7, 1.3), seg=32)
        for i in range(14):
            a = (i + 0.5) / 14 * math.tau
            P.sphere(on_barrel(a, z, 0.02), 0.0075, seg=6, rings=4, mat='brass')
    for a in (-math.pi / 2 - 0.62, -math.pi / 2 + 0.62, math.pi / 2 - 0.5, math.pi / 2 + 0.5):
        pts = [on_barrel(a, z, 0.006) for z in np.linspace(1.06, 1.33, 7)]
        P.tube(pts, 0.011, seg=6, flat=(0.45, 1.3), mat='brass')
        for z in (1.12, 1.27): P.sphere(on_barrel(a, z, 0.014), 0.007, seg=6, rings=4, mat='brass')
    if medallion:
        # Dawnhold sun round the crystal heart
        hc = on_barrel(-math.pi / 2, 1.2, 0.0) + V((0, -0.004, 0))
        P.cyl(hc + V((0, 0.03, 0)), hc + V((0, -0.016, 0)), 0.072, 0.07, seg=28, mat='brass')
        P.cyl(hc + V((0, 0.0, 0)), hc + V((0, -0.02, 0)), 0.056, 0.056, seg=28, mat='dark')
        P.sphere(hc + V((0, -0.016, 0)), 0.048, scale=(1, 0.55, 1.12), seg=12, rings=8, mat='glow')
        for k in range(12):
            a = k * math.tau / 12
            ln = 0.06 if k % 2 == 0 else 0.038
            tri = SK.ccw([(-0.013, 0.0), (0.013, 0.0), (0.0, ln)])
            xf = Matrix.Translation(hc + V((0, 0.006, 0))) @ rot('Y', -a) @ Matrix.Translation((0, 0, 0.074))
            P.prism(tri, -0.012, 0.012, xf=xf, mat='brass')
    # collar: a brass gorget and the neck socket
    ring(P, (0, 0.03, 1.405), 0.13, 0.024, ry=0.12, mat='brass')
    P.cyl((0, 0.03, 1.38), (0, 0.03, 1.45), 0.085, 0.075, seg=16, mat='dark')
    # shoulders: rolled brass pauldron domes over stone sockets
    for s in (-1, 1):
        c = V((s * 0.19, 0.035, 1.355))
        P.sphere(c + V((0, 0, 0.01)), 0.078, scale=(1.05, 1, 0.82), seg=16, rings=10, mat='brass')
        ring(P, c + V((0, 0, -0.012)), 0.074, 0.012, mat='brass', seg=20)
        P.sphere(c + V((s * 0.05, 0, 0.045)), 0.012, seg=6, rings=4, mat='brass')
    # firebox hatch on the back, ember glow through a grille, a stubby flue
    back = on_barrel(math.pi / 2, 1.2, 0.0)
    xf = Matrix.Translation(back + V((0, 0.004, 0))) @ rot('Z', math.pi)
    hatch = SK.rounded_rect(0.075, 0.07, 0.025, 4)
    P.prism(SK.rounded_rect(0.062, 0.057, 0.02, 4), -0.004, 0.02, xf=xf, mat='ember')
    SK.rim(P, hatch, -0.022, 0.016, mat='brass', width=0.016, xf=xf)
    for k in range(4):
        u = -0.042 + k * 0.028
        P.box(xf @ V((u, -0.012, 0)), (0.009, 0.01, 0.11), rot=xf.to_3x3().to_4x4(), mat='brass', bevel=0.002)
    P.cyl(on_barrel(math.pi / 2, 1.33, 0.0), on_barrel(math.pi / 2, 1.33, 0.0) + V((0, 0.03, 0.1)), 0.03, 0.026, seg=12, mat='brass')
    P.cyl(on_barrel(math.pi / 2, 1.33, 0.0) + V((0, 0.028, 0.095)), on_barrel(math.pi / 2, 1.33, 0.0) + V((0, 0.032, 0.125)), 0.038, 0.038, seg=12, mat='brass')
    # hips: stone pelvis drum and a leather belt with a sun buckle
    P.use(bone='Root', mat='stone')
    P.tube([V((0, 0.03, 0.87)), V((0, 0.03, 0.93)), V((0, 0.03, 1.0))], [0.15, 0.168, 0.15], seg=24, flat=(1, 0.86), up=(1, 0, 0))
    ring(P, (0, 0.03, 0.955), 0.172, 0.022, ry=0.15, mat='leather', tint=LEATHER_T, flat=(0.6, 1.4), seg=32)
    bc = V((0, -0.125, 0.955))
    P.cyl(bc + V((0, 0.01, 0)), bc + V((0, -0.012, 0)), 0.04, 0.038, seg=20, mat='brass')
    P.sphere(bc + V((0, -0.012, 0)), 0.018, scale=(1, 0.5, 1), seg=10, rings=6, mat='glow')
    for k in range(8):
        a = k * math.tau / 8
        P.box(bc + V((math.cos(a) * 0.047, -0.004, math.sin(a) * 0.047)), (0.014, 0.012, 0.014), rot=rot('Y', -a), mat='brass', bevel=0.003)


def build_tabard(P, color=BLUE, trim=GOLD, length=0.3, emblem=True, back=True):
    """Livery tabard hanging from the belt, front (and a shorter back flap). Skinned to Root."""
    P.use(bone='Root', mat='cloth', tint=color)
    for face, ln in ((-1, length), (1, length * 0.7) if back else (None, None)):
        if face is None: continue
        w = 0.105
        out = SK.ccw([(-w, 0.0), (w, 0.0), (w * 0.95, -ln * 0.8), (0.0, -ln), (-w * 0.95, -ln * 0.8)])
        y = 0.03 + face * 0.162
        xf = Matrix.Translation((0, y, 0.95)) @ (rot('Z', math.pi) if face > 0 else Matrix.Identity(4)) @ rot('X', -0.09)
        P.slab(out, -0.006, 0.004, xf=xf, bulge=0.012, rings=2, tint=color)
        SK.rim(P, out, -0.01, 0.006, mat='cloth', width=0.014, xf=xf, tint=trim)
        if emblem and face < 0:
            c = xf @ V((0, -0.026, -ln * 0.42))
            P.cyl(c + V((0, 0.012, 0)), c + V((0, -0.002, 0)), 0.034, 0.034, seg=20, mat='cloth', tint=trim)
            for k in range(8):
                a = k * math.tau / 8
                tri = SK.ccw([(-0.008, 0.0), (0.008, 0.0), (0.0, 0.022)])
                x2 = Matrix.Translation(c + V((0, 0.004, 0))) @ rot('Y', -a) @ Matrix.Translation((0, 0, 0.036))
                P.prism(tri, -0.005, 0.005, xf=x2, mat='cloth', tint=trim)


def build_arm(P, side, gauntlet=True):
    s = -1 if side == 'Left' else 1
    sh, el, wr = J[side + 'Arm'], J[side + 'Forearm'], J[side + 'Hand']
    P.use(bone=side + 'Arm', mat='stone')
    P.cyl(sh + V((0, 0, -0.04)), el + V((0, 0, 0.035)), 0.07, 0.062, seg=16)
    ring(P, sh + (el - sh) * 0.55, 0.07, 0.011, mat='brass', seg=20)
    P.use(bone=side + 'Forearm')
    cog(P, el, 0.06, 0.1, teeth=10, axis='X', mat='brass')
    P.sphere(el + V((s * 0.052, 0, 0)), 0.02, seg=8, rings=5, mat='glow')
    # stone vambrace flaring to the wrist with a brass edge
    P.cyl(el + V((0, 0, -0.035)), wr + V((0, 0, 0.03)), 0.06, 0.078, seg=16)
    ring(P, wr + V((0, 0, 0.04)), 0.08, 0.013, mat='brass', seg=20)
    ring(P, el + (wr - el) * 0.4, 0.068, 0.008, mat='brass', seg=18)
    if gauntlet: build_hand(P, side)


def build_hand(P, side, curl=None):
    s = -1 if side == 'Left' else 1
    wr = J[side + 'Hand']
    P.use(bone=side + 'Hand', mat='brass')
    P.cyl(wr + V((0, 0, 0.03)), wr + V((0, 0, -0.01)), 0.066, 0.06, seg=14)  # cuff
    P.box(wr + V((s * 0.004, 0, -0.048)), (0.085, 0.1, 0.075), bevel=0.024, smooth=True)
    P.box(wr + V((s * 0.044, 0, -0.045)), (0.012, 0.08, 0.05), bevel=0.004, mat='leather', tint=LEATHER_T)
    curl = (1.2 if side == 'Left' else 1.0) if curl is None else curl
    for f in range(4):
        y = -0.039 + f * 0.026
        p = wr + V((s * 0.006, y, -0.082)); ang = 0.0
        for k, ln in enumerate((0.03, 0.026, 0.02)):
            ang += curl * (0.45 + 0.2 * k)
            q = p + V((0, -math.sin(ang), -math.cos(ang))) * ln
            P.cyl(p, q, 0.0135, 0.012, seg=8); P.sphere(q, 0.0128, seg=8, rings=5); p = q
    t0 = wr + V((s * 0.03, -0.04, -0.04)); t1 = t0 + V((s * 0.012, -0.03, -0.022)); t2 = t1 + V((0, -0.02, -0.018))
    P.tube([t0, t1, t2], 0.014, seg=8); P.sphere(t2, 0.013, seg=8, rings=5)


def build_leg(P, side):
    s = -1 if side == 'Left' else 1
    hip, kn, an = J[side + 'Leg'], J[side + 'Knee'], J[side + 'Foot']
    P.use(bone=side + 'Leg', mat='stone')
    P.sphere(hip, 0.078, seg=14, rings=9, mat='brass')
    P.cyl(hip + V((0, 0, -0.03)), kn + V((0, 0, 0.045)), 0.095, 0.08, seg=18)
    ring(P, hip + (kn - hip) * 0.5, 0.092, 0.012, mat='brass', seg=22)
    P.use(bone=side + 'Knee')
    # brass knee cop with a crystal stud
    P.sphere(kn, 0.074, seg=16, rings=10, mat='brass')
    P.sphere(kn + V((0, -0.066, 0.01)), 0.03, scale=(1, 0.5, 1), seg=10, rings=6, mat='brass')
    P.sphere(kn + V((0, -0.079, 0.01)), 0.014, scale=(1, 0.5, 1), seg=8, rings=5, mat='glow')
    P.cyl(kn + V((0, 0, -0.03)), an + V((0, 0, 0.06)), 0.07, 0.084, seg=18)
    P.use(bone=side + 'Foot', mat='leather', tint=LEATHER_T)
    # hobnailed boot: leather upper with a rolled cuff, brass toe cap, wooden sole
    P.cyl(an + V((0, 0, 0.085)), an + V((0, 0, 0.0)), 0.098, 0.096, seg=18)
    ring(P, an + V((0, 0, 0.083)), 0.1, 0.014, mat='leather', tint=(0.42, 0.26, 0.15), seg=20)
    P.box(an + V((0, -0.04, -0.04)), (0.16, 0.25, 0.09), bevel=0.035, smooth=True)
    P.sphere(an + V((0, -0.14, -0.04)), 0.078, scale=(1.02, 0.85, 0.64), seg=14, rings=8, mat='brass')
    P.box(an + V((0, -0.05, -0.083)), (0.17, 0.28, 0.022), mat='wood', tint=(0.6, 0.45, 0.32), bevel=0.007)
    for k in range(6):
        P.sphere(an + V((math.cos(k * 1.05) * 0.06, -0.05 + math.sin(k * 1.05) * 0.11, -0.095)), 0.008, seg=6, rings=4, mat='iron')
    # laces: three brass hooks up the front
    for k in range(3):
        P.sphere(an + V((0, -0.098, 0.0 + k * 0.025)), 0.008, seg=6, rings=4, mat='brass')


def tilt(P, n0, pivot, deg, axis='X'):
    """Rotate the verts a part gained since n0 about a pivot: author held items for the pose they are carried in."""
    P.bm.verts.ensure_lookup_table()
    r = Matrix.Rotation(math.radians(deg), 4, axis)
    for v in P.bm.verts[n0:]:
        v.co = V(pivot) + r @ (v.co - V(pivot))


def scale_verts_from(P, n0, centre, k):
    P.bm.verts.ensure_lookup_table()
    for v in P.bm.verts[n0:]: v.co = V(centre) + (v.co - V(centre)) * k


def scale_unit(parts, k):
    """Unit proportions: scale every mesh part and (via SK.JOINTS) the rig about the ground origin."""
    for P in parts: scale_verts(P, (0, 0, 0), k)


def scale_rig(k):
    k = V(k)
    for name, (h, t, p, d) in list(SK.JOINTS.items()):
        SK.JOINTS[name] = (tuple(V((h[0] * k.x, h[1] * k.y, h[2] * k.z))), tuple(V((t[0] * k.x, t[1] * k.y, t[2] * k.z))), p, d)
