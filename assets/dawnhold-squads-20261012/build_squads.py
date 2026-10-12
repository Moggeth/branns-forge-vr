"""Dawnhold squads builder: six RTS units on the Forgeling Mk II body (bpy, headless, deterministic).

    python3 build_squads.py --unit forgeling      # writes <unit>.glb + report in out/
    python3 build_squads.py --unit all --render   # also renders turnaround and close-up sheets to renders/

Units: forgeling (line), anvilback (heavy), glintshot (ranged), mender (support), fusewick (sapper), cart (siege + crew).
Every unit shares the rig and joint names of the skeleton warband, so the game's procedural motion works on all of them.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import squad_body as B  # noqa: E402
SK, V, J, HC, rot = B.SK, B.V, B.J, B.HC, B.rot
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)


def fist(side):
    """Centre of a closed gauntlet, rest pose."""
    s = -1 if side == 'Left' else 1
    return J[side + 'Hand'] + V((s * 0.006, -0.012, -0.072))


def frame(origin, x, y):
    """Matrix with columns x, y, z=x*y at origin (for placing local shapes)."""
    x = V(x).normalized(); y = (V(y) - x * V(y).dot(x)).normalized(); z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4(); m.translation = V(origin)
    return m


# ================================================================== FORGELING (line)
def forgeling_helm(P):
    """Brass sallet with a fan crest: the line soldier's sunburst comb."""
    P.use(bone='Head', mat='brass')
    top = HC + V((0, 0.015, 0.0))
    P.sphere(top + V((0, 0.0, 0.06)), 0.19, scale=(1.0, 0.94, 0.62), seg=28, rings=10, mat='brass')
    B.ring(P, top + V((0, 0.0, 0.06)), 0.19, 0.012, ry=0.178, mat='brass')
    # crest: seven fins fanning front to back
    for k in range(7):
        a = math.radians(-60 + k * 20)
        base = top + V((0, math.sin(a) * 0.08, 0.17 + math.cos(a) * 0.02))
        tip = top + V((0, math.sin(a) * 0.16, 0.17 + math.cos(a) * 0.12))
        fin = SK.ccw([(-0.035, 0.0), (0.035, 0.0), (0.012, 0.11), (-0.012, 0.11)])
        xf = frame(base, (0, math.cos(a), -math.sin(a)) if False else (0, 1, 0), (0, 0, 1))
        xf = Matrix.Translation(base) @ rot('X', -a) @ rot('Z', math.pi / 2)
        P.prism(fin, -0.006, 0.006, xf=xf, mat='brass')
    P.sphere(top + V((0, -0.17, 0.115)), 0.022, scale=(1, 0.6, 1), seg=10, rings=6, mat='glow')
    P.cyl(top + V((0, -0.155, 0.115)), top + V((0, -0.172, 0.115)), 0.03, 0.03, seg=14, mat='brass')


def forgeling_shield(P):
    P.use(bone='LeftHand', mat='stone')
    xf = SK.shield_frame()
    o = SK.circle(0.23, 36)
    P.slab(o, -0.014, 0.016, xf=xf, bulge=0.03, rings=4)
    SK.rim(P, o, -0.024, 0.024, mat='brass', width=0.026, xf=xf)
    for k in range(16):
        a = k * math.tau / 16
        P.sphere(xf @ V((math.cos(a) * 0.205, -0.03, math.sin(a) * 0.205)), 0.009, seg=6, rings=4, mat='brass')
    # raised sunburst with a crystal boss
    for k in range(12):
        a = k * math.tau / 12
        ln = 0.13 if k % 2 == 0 else 0.09
        tri = SK.ccw([(-0.022, 0.0), (0.022, 0.0), (0.0, ln)])
        x2 = xf @ Matrix.Translation((0, -0.045, 0)) @ rot('Y', -a) @ Matrix.Translation((0, 0, 0.05))
        P.prism(tri, -0.008, 0.008, xf=x2, mat='brass')
    P.sphere(xf @ V((0, -0.05, 0)), 0.06, scale=(1, 0.55, 1), seg=16, rings=10, mat='brass')
    P.sphere(xf @ V((0, -0.078, 0)), 0.034, scale=(1, 0.6, 1), seg=12, rings=8, mat='glow')
    SK.shield_back(P, xf, 0.016)


def forge_hammer(P, side='Right', length=0.62, head=(0.17, 0.08, 0.09)):
    """Forge hammer carried head-forward: leather-wrapped haft, stone head bound in brass, a glowing rune slot."""
    P.use(bone=side + 'Hand', mat='wood', tint=(0.85, 0.75, 0.62))
    f = fist(side)
    back, front = f + V((0, 0.13, 0.01)), f + V((0, -length + 0.13, -0.02))
    P.cyl(back, front, 0.019, 0.022, seg=10)
    P.sphere(back, 0.026, seg=10, rings=6, mat='brass')
    for t in np.linspace(0.0, 0.3, 6):
        P.cyl(back + (front - back) * t, back + (front - back) * (t + 0.035), 0.024, 0.024, seg=10, mat='leather', tint=B.LEATHER_T)
    hc = front + V((0, -0.02, 0.0))
    P.box(hc, (head[1], head[2], head[0] * 2), bevel=0.012, smooth=True, mat='stone')
    for dz in (-head[0] * 0.75, head[0] * 0.75):
        P.box(hc + V((0, 0, dz)), (head[1] + 0.014, head[2] + 0.014, 0.03), bevel=0.006, mat='brass')
    P.box(hc + V((0, -head[2] / 2 - 0.002, 0)), (0.014, 0.006, head[0] * 0.9), mat='glow')
    P.box(hc + V((0, head[2] / 2 + 0.002, 0)), (0.014, 0.006, head[0] * 0.9), mat='glow')
    P.cyl(hc + V((0, 0, head[0])), hc + V((0, 0, head[0] + 0.02)), 0.04, 0.035, seg=12, mat='brass')


# ================================================================== ANVILBACK (heavy)
def anvil_pauldrons(P):
    """Stacked brass lames over each shoulder, the top one a thick rolled plate."""
    P.use(bone='Torso', mat='brass')
    for s in (-1, 1):
        c = V((s * 0.2, 0.035, 1.37))
        for k in range(3):
            P.sphere(c + V((s * 0.02 * k, 0, -0.03 * k)), 0.11 - 0.012 * k, scale=(1.15, 1.08, 0.45), seg=20, rings=8, mat='brass' if k == 0 else 'iron')
        B.ring(P, c + V((0, 0, -0.01)), 0.12, 0.014, ry=0.115, mat='brass')
        for k in range(5):
            a = -0.5 + k * 0.5
            P.sphere(c + V((s * 0.11 * math.cos(a), 0.1 * math.sin(a), 0.02)), 0.008, seg=6, rings=4, mat='brass')
    # stone breastplate slab bolted over the medallion's sides
    for s in (-1, 1):
        a = -math.pi / 2 + s * 0.55
        c = B.on_barrel(a, 1.2, 0.02)
        P.box(c, (0.09, 0.03, 0.17), rot=rot('Z', s * 0.55), bevel=0.012, smooth=True, mat='iron')
        P.sphere(c + V((s * 0.02, -0.02, 0.06)), 0.008, seg=6, rings=4, mat='brass')
        P.sphere(c + V((s * 0.02, -0.02, -0.06)), 0.008, seg=6, rings=4, mat='brass')


def anvil_bellows(P):
    """Bellows boiler on the back: leather pleats between oak boards, a chimney stack puffing ember light."""
    P.use(bone='Torso', mat='wood', tint=(0.78, 0.62, 0.48))
    c = V((0, 0.29, 1.2))
    P.box(c + V((0, -0.03, 0)), (0.3, 0.03, 0.32), bevel=0.01, smooth=True)
    P.box(c + V((0, 0.11, 0)), (0.28, 0.03, 0.3), bevel=0.01, smooth=True)
    for k in range(4):
        y = -0.01 + k * 0.03
        P.box(c + V((0, y, 0)), (0.29 - 0.012 * (k % 2), 0.022, 0.31 - 0.012 * (k % 2)), bevel=0.008, smooth=True, mat='leather', tint=(0.42, 0.26, 0.15))
    for dz in (-0.12, 0.12):
        P.box(c + V((0, 0.13, dz)), (0.3, 0.012, 0.03), bevel=0.004, mat='brass')
    P.cyl(c + V((0, -0.06, -0.1)), c + V((0, 0.0, -0.13)), 0.02, 0.02, seg=8, mat='brass')
    # twin chimney stacks with caps and ember mouths
    for s, h in ((-1, 0.38), (1, 0.3)):
        base = c + V((s * 0.09, 0.13, 0.12))
        top = base + V((s * 0.02, 0.03, h))
        P.cyl(base, top, 0.035, 0.03, seg=14, mat='brass')
        P.cyl(top, top + V((0, 0, 0.035)), 0.048, 0.048, seg=14, mat='iron')
        P.cyl(top + V((0, 0, 0.034)), top + V((0, 0, 0.037)), 0.036, 0.036, seg=14, mat='ember')
        B.ring(P, base + (top - base) * 0.5, 0.036, 0.007, mat='iron', seg=14)


def anvil_shield(P):
    """Anvil tower shield: an iron slab shaped like an anvil stood on end, horn up, brass-riveted, sun boss."""
    P.use(bone='LeftHand', mat='iron')
    xf = SK.shield_frame(yaw=10) @ Matrix.Translation((0.0, -0.02, 0.06))
    w, top, bot = 0.24, 0.42, -0.5
    o = SK.ccw([(-w, bot), (w, bot), (w, bot + 0.08), (w * 0.82, bot + 0.16), (w * 0.82, top - 0.12), (w * 1.05, top - 0.05),
                (w * 1.05, top), (-w * 0.5, top), (-w * 1.0, top + 0.05), (-w * 1.35, top + 0.02), (-w * 1.0, top - 0.06),
                (-w * 0.82, top - 0.12), (-w * 0.82, bot + 0.16), (-w, bot + 0.08)])
    P.slab(o, -0.03, 0.03, xf=xf, bulge=0.025, rings=3)
    SK.rim(P, o, -0.045, 0.034, mat='brass', width=0.03, xf=xf)
    for (u, v) in SK.offset_poly(o, 0.045)[::1]:
        P.sphere(xf @ V((u, -0.052, v)), 0.011, scale=(1, 0.6, 1), seg=6, rings=4, mat='brass')
    # face (the anvil's striking face) as a polished steel band across the top
    P.box(xf @ V((0.0, -0.05, top - 0.05)), (w * 1.6, 0.012, 0.06), rot=xf.to_3x3().to_4x4(), bevel=0.004, mat='iron', tint=(1.3, 1.3, 1.35))
    c = xf @ V((0, -0.06, -0.03))
    P.sphere(c, 0.1, scale=(1, 0.42, 1), seg=20, rings=10, mat='brass')
    for k in range(12):
        a = k * math.tau / 12
        tri = SK.ccw([(-0.025, 0.0), (0.025, 0.0), (0.0, 0.08 if k % 2 == 0 else 0.055)])
        x2 = xf @ Matrix.Translation((0, -0.06, -0.03)) @ rot('Y', -a) @ Matrix.Translation((0, 0, 0.09))
        P.prism(tri, -0.008, 0.008, xf=x2, mat='brass')
    P.sphere(xf @ V((0, -0.1, -0.03)), 0.045, scale=(1, 0.55, 1), seg=12, rings=8, mat='glow')
    SK.shield_back(P, xf, 0.03, h=0.16)


def anvil_maul(P):
    P.use(bone='RightHand', mat='wood', tint=(0.7, 0.58, 0.45))
    f = fist('Right')
    a, b = f + V((0, 0.08, 0.32)), f + V((0, -0.03, -0.55))
    P.cyl(a, b, 0.026, 0.028, seg=12)
    for t in (0.3, 0.42):
        P.cyl(a + (b - a) * t, a + (b - a) * (t + 0.05), 0.031, 0.031, seg=12, mat='leather', tint=B.LEATHER_T)
    hc = a + V((0, 0, 0.05))
    P.box(hc, (0.12, 0.3, 0.13), bevel=0.02, smooth=True, mat='iron')
    for dy in (-0.11, 0.0, 0.11):
        P.box(hc + V((0, dy, 0)), (0.135, 0.025, 0.145), bevel=0.006, mat='brass')
    for dy in (-0.16, 0.16):
        P.box(hc + V((0, dy, 0)), (0.1, 0.03, 0.11), bevel=0.012, smooth=True, mat='iron', tint=(1.25, 1.25, 1.3))
    P.box(hc + V((0.062, 0, 0)), (0.004, 0.18, 0.02), mat='ember')
    P.box(hc + V((-0.062, 0, 0)), (0.004, 0.18, 0.02), mat='ember')
    P.sphere(b, 0.035, seg=10, rings=6, mat='brass')


# ================================================================== GLINTSHOT (ranged)
def glint_spyglass(P):
    """A telescoping brass spyglass over the right eye on a hinged arm, crystal lens glinting."""
    P.use(bone='Head', mat='brass')
    e = HC + V((0.068, -0.17, 0.006))
    a0 = e + V((0, -0.03, 0))
    segs = [(0.05, 0.045, 0.04), (0.044, 0.04, 0.035), (0.037, 0.033, 0.03)]
    p = a0
    for r1, r2, ln in segs:
        q = p + V((0, -ln, 0))
        P.cyl(p, q, r1, r2, seg=18); B.ring(P, q, r2 + 0.002, 0.005, axis='Y', mat='brass', seg=16); p = q + V((0, 0.004, 0))
    P.sphere(p + V((0, -0.002, 0)), 0.03, scale=(1, 0.4, 1), seg=14, rings=8, mat='glow')
    # hinge arm to the ear cog
    P.tube([e + V((0.05, -0.04, 0.02)), e + V((0.1, -0.02, 0.02)), HC + V((0.19, 0.0, 0.0))], 0.008, seg=6)
    P.sphere(e + V((0.05, -0.04, 0.02)), 0.014, seg=8, rings=5)


def glint_cap(P):
    """Soft ranger cap with a turned-up brim and a long blue-and-gold plume."""
    P.use(bone='Head', mat='cloth', tint=(0.2, 0.36, 0.72))
    top = HC + V((0, 0.03, 0.09))
    P.sphere(top, 0.175, scale=(1.0, 1.05, 0.55), seg=24, rings=10)
    brim = [top + V((math.cos(a) * 0.2, math.sin(a) * 0.205, -0.03 + (0.03 if math.sin(a) > 0 else 0.0) * abs(math.sin(a)))) for a in np.linspace(0, math.tau, 30, endpoint=False)]
    P.tube(brim, 0.022, seg=8, closed=True, flat=(0.5, 1.2), tint=(0.16, 0.3, 0.62))
    P.cyl(top + V((-0.15, 0.03, 0.0)), top + V((-0.175, 0.04, 0.02)), 0.022, 0.022, seg=12, mat='brass')
    pts = [top + V((-0.17, 0.05, 0.02)), top + V((-0.24, 0.13, 0.12)), top + V((-0.27, 0.25, 0.22)), top + V((-0.25, 0.38, 0.26))]
    P.tube(pts, [0.006, 0.03, 0.03, 0.004], seg=8, flat=(0.25, 1.0), mat='cloth', tint=(0.25, 0.5, 0.95))
    pts2 = [p + V((0.012, 0.0, 0.01)) for p in pts]
    P.tube(pts2, [0.004, 0.018, 0.018, 0.003], seg=8, flat=(0.25, 1.0), mat='cloth', tint=B.GOLD)


def glint_repeater(P):
    """Crystal repeater: oak stock, recurved brass prod, a glowing shard magazine and crank, held level forward."""
    P.use(bone='RightHand', mat='wood', tint=(0.82, 0.62, 0.45))
    f = fist('Right'); n0 = len(P.bm.verts)
    o = f + V((0, -0.0, 0.02))
    # stock and fore-end
    P.box(o + V((0, 0.12, 0.0)), (0.05, 0.22, 0.07), bevel=0.012, smooth=True)
    P.box(o + V((0, -0.2, 0.03)), (0.045, 0.5, 0.045), bevel=0.01, smooth=True)
    P.box(o + V((0, -0.2, 0.06)), (0.05, 0.5, 0.012), bevel=0.003, mat='brass')
    # prod: recurved brass arms
    pc = o + V((0, -0.42, 0.05))
    for s in (-1, 1):
        pts = [pc + V((s * 0.02, 0, 0)), pc + V((s * 0.14, 0.03, 0)), pc + V((s * 0.23, 0.09, 0)), pc + V((s * 0.27, 0.07, 0))]
        P.tube(pts, [0.016, 0.013, 0.01, 0.008], seg=8, flat=(1, 0.6), mat='brass', up=(0, 0, 1))
        P.sphere(pts[-1], 0.012, seg=8, rings=5, mat='glow')
    P.box(pc, (0.07, 0.05, 0.05), bevel=0.01, smooth=True, mat='brass')
    # string
    P.tube([pc + V((-0.27, 0.07, 0)), pc + V((0, 0.2, 0.0)), pc + V((0.27, 0.07, 0))], 0.0035, seg=4, mat='cloth', tint=B.CREAM)
    # loaded crystal bolt
    P.cyl(pc + V((0, 0.2, 0.012)), pc + V((0, -0.06, 0.012)), 0.007, 0.007, seg=6, mat='glow')
    P.sphere(pc + V((0, -0.08, 0.012)), 0.018, scale=(0.7, 2.2, 0.7), seg=8, rings=6, mat='glow')
    # magazine box with shards
    mc = o + V((0, -0.1, 0.12))
    P.box(mc, (0.07, 0.12, 0.1), bevel=0.01, smooth=True, mat='brass')
    for k in range(3):
        P.sphere(mc + V((-0.018 + k * 0.018, 0, 0.07)), 0.012, scale=(0.7, 0.7, 2.2), seg=6, rings=5, mat='glow')
    P.box(mc + V((0, -0.061, 0)), (0.05, 0.004, 0.06), mat='glow')
    # crank on the side
    P.cyl(mc + V((0.036, 0, 0)), mc + V((0.07, 0, 0)), 0.012, 0.012, seg=8, mat='brass')
    P.tube([mc + V((0.07, 0, 0)), mc + V((0.075, 0.05, -0.03))], 0.007, seg=6, mat='brass')
    P.sphere(mc + V((0.075, 0.05, -0.03)), 0.014, seg=8, rings=5, mat='wood')
    B.scale_verts_from(P, n0, f, 1.25)
    B.tilt(P, n0, f, 84)  # carried shouldered: authored level, turned to suit the raised aim pose


def glint_reload(P):
    """A fresh crystal shard in the off hand, ready to slot into the magazine."""
    P.use(bone='LeftHand', mat='glow')
    f = fist('Left')
    P.sphere(f + V((0, -0.03, 0.06)), 0.022, scale=(0.75, 0.75, 2.6), seg=8, rings=6)
    P.cyl(f + V((0, -0.03, -0.02)), f + V((0, -0.03, 0.02)), 0.012, 0.012, seg=8, mat='brass')


def glint_quiver(P):
    """Brass bolt case across the back with crystal-headed bolts, and a bandolier of glowing vials."""
    P.use(bone='Torso', mat='leather', tint=B.LEATHER_T)
    a, b = V((0.12, 0.27, 1.02)), V((-0.06, 0.27, 1.42))
    P.cyl(a, b, 0.055, 0.06, seg=16)
    B.ring(P, a + (b - a) * 0.1, 0.058, 0.01, mat='brass', seg=16)
    B.ring(P, a + (b - a) * 0.9, 0.062, 0.01, mat='brass', seg=16)
    d = (b - a).normalized()
    for k, off in enumerate([(-0.02, 0.0), (0.02, -0.015), (0.0, 0.02), (0.025, 0.018)]):
        tip = b + d * (0.06 + 0.02 * k) + V((off[0], off[1], 0))
        P.cyl(b + V((off[0], off[1], 0)) - d * 0.05, tip, 0.006, 0.006, seg=6, mat='wood')
        P.sphere(tip + d * 0.02, 0.016, scale=(0.7, 0.7, 2.0), rot=None, seg=8, rings=5, mat='glow')
    # bandolier: strap from right shoulder to left hip with vials
    pts = [B.on_barrel(-math.pi / 2 + 0.95, 1.36, 0.015), B.on_barrel(-math.pi / 2 + 0.3, 1.24, 0.02),
           B.on_barrel(-math.pi / 2 - 0.35, 1.1, 0.02), B.on_barrel(-math.pi / 2 - 0.95, 1.0, 0.015)]
    P.tube(pts, 0.012, seg=6, flat=(0.5, 1.4))
    for t, p in enumerate([B.on_barrel(-math.pi / 2 + 0.55, 1.29, 0.035), B.on_barrel(-math.pi / 2 + 0.1, 1.2, 0.04)]):
        P.cyl(p + V((0, 0, -0.025)), p + V((0, 0, 0.025)), 0.014, 0.014, seg=10, mat='glow')
        P.cyl(p + V((0, 0, 0.025)), p + V((0, 0, 0.035)), 0.009, 0.009, seg=8, mat='brass')


# ================================================================== MENDER (support)
def mender_mantle(P):
    """Cream wool mantle over the shoulders with gold trim, clasped with a little hearth-glow brooch."""
    P.use(bone='Torso', mat='cloth', tint=B.CREAM)
    prof = [(1.44, 0.14), (1.4, 0.22), (1.34, 0.27), (1.26, 0.285), (1.22, 0.288)]
    P.tube([V((0, 0.035, z)) for z, _ in prof], [r for _, r in prof], seg=32, flat=(1.0, 0.86), up=(1, 0, 0), cap=False)
    # scalloped hem
    for k in range(18):
        a = k * math.tau / 18
        P.sphere(V((math.cos(a) * 0.285, 0.035 + math.sin(a) * 0.245, 1.215)), 0.032, scale=(1, 1, 0.6), seg=8, rings=5, tint=B.CREAM)
    B.ring(P, (0, 0.035, 1.225), 0.29, 0.009, ry=0.25, mat='cloth', tint=B.GOLD, seg=36)
    P.cyl(V((0, -0.115, 1.42)), V((0, -0.14, 1.42)), 0.03, 0.03, seg=16, mat='brass')
    P.sphere(V((0, -0.14, 1.42)), 0.02, scale=(1, 0.5, 1), seg=10, rings=6, mat='hearth')


def mender_spectacles(P):
    P.use(bone='Head', mat='brass')
    for s in (-1, 1):
        e = HC + V((s * 0.068, -0.235, -0.01))
        out = [e + V((math.cos(a) * 0.04, 0, math.sin(a) * 0.04 * 0.7 - 0.006)) for a in np.linspace(math.pi, math.tau, 12)]
        P.tube(out + [e + V((0.04, 0, -0.006))], 0.0045, seg=5, mat='brass')
        P.tube([e + V((s * 0.04, 0, -0.006)), e + V((s * 0.09, 0.08, 0.0)), HC + V((s * 0.17, -0.02, 0.0))], 0.004, seg=5)
    P.tube([HC + V((-0.028, -0.235, -0.012)), HC + V((0, -0.24, -0.002)), HC + V((0.028, -0.235, -0.012))], 0.004, seg=5)


def mender_apron(P):
    """Leather work apron over the tabard: bib, a pocket of tools, an oil can on the hip."""
    P.use(bone='Root', mat='leather', tint=(0.56, 0.38, 0.24))
    out = SK.ccw([(-0.12, 0.0), (0.12, 0.0), (0.13, -0.3), (-0.13, -0.3)])
    xf = Matrix.Translation((0, -0.165, 0.97)) @ rot('X', -0.08)
    P.slab(out, -0.006, 0.004, xf=xf, bulge=0.02, rings=2)
    pk = SK.ccw([(-0.09, 0.0), (0.09, 0.0), (0.09, -0.08), (-0.09, -0.08)])
    P.prism(pk, -0.03, -0.012, xf=xf @ Matrix.Translation((0, 0, -0.1)), tint=(0.46, 0.3, 0.18))
    P.use(mat='brass')
    for k, x in enumerate((-0.05, 0.0, 0.05)):
        P.cyl(xf @ V((x, -0.024, -0.1)), xf @ V((x + 0.006 * k, -0.024, -0.02 + 0.01 * k)), 0.007, 0.007, seg=6, mat='brass' if k != 1 else 'wood')
    P.box(xf @ V((0.05, -0.024, -0.01)), (0.03, 0.01, 0.015), bevel=0.003)
    # oil can on the right hip
    c = V((0.2, -0.02, 0.87))
    P.cyl(c + V((0, 0, -0.05)), c + V((0, 0, 0.03)), 0.045, 0.04, seg=16)
    P.cyl(c + V((0, 0, 0.03)), c + V((0, 0, 0.05)), 0.03, 0.012, seg=14)
    P.tube([c + V((0, -0.02, 0.04)), c + V((0, -0.08, 0.07)), c + V((0, -0.12, 0.12))], [0.008, 0.006, 0.004], seg=6)
    # satchel on the left hip
    P.use(mat='leather', tint=(0.5, 0.33, 0.2))
    s = V((-0.21, 0.02, 0.86))
    P.box(s, (0.06, 0.14, 0.12), bevel=0.02, smooth=True)
    P.box(s + V((-0.002, 0, 0.045)), (0.065, 0.145, 0.04), bevel=0.01, smooth=True, tint=(0.42, 0.27, 0.16))
    P.sphere(s + V((-0.033, 0, 0.03)), 0.01, seg=6, rings=4, mat='brass')


def mender_lantern_crook(P):
    """The Hearthfire lantern on a shepherd's crook: oak staff, brass crook, a caged ember of Dawnhold's forge."""
    P.use(bone='RightHand', mat='wood', tint=(0.86, 0.68, 0.5))
    f = fist('Right'); n0 = len(P.bm.verts)
    bot, top = f + V((0.02, -0.06, -0.72)), f + V((0.0, -0.06, 0.98))
    P.cyl(bot, top, 0.022, 0.024, seg=10)
    P.cyl(bot, bot + V((0, 0, 0.05)), 0.026, 0.026, seg=10, mat='brass')
    for t in (0.42, 0.47):
        B.ring(P, bot + (top - bot) * t, 0.026, 0.006, mat='brass', seg=12)
    # crook curl
    c = top + V((0.1, 0, 0.04))
    curl = [top + V((0, 0, -0.02))] + [c + V((-math.cos(a) * 0.1 * (1 - 0.25 * a / math.pi), 0, math.sin(a) * 0.1 * (1 - 0.25 * a / math.pi))) for a in np.linspace(0, math.pi * 1.25, 14)]
    P.tube(curl, 0.016, seg=8, mat='brass')
    P.sphere(curl[-1], 0.02, seg=8, rings=5, mat='brass')
    hook = c + V((0.1, 0, -0.03))
    # lantern hanging from the crook tip on a chain
    lc = hook + V((0, 0, -0.17))
    for k in range(4):
        P.tube([hook + V((0, 0, -0.025 * k)), hook + V((0, 0, -0.025 * k - 0.02))], 0.004, seg=4, mat='iron')
    P.cyl(lc + V((0, 0, 0.09)), lc + V((0, 0, 0.11)), 0.02, 0.008, seg=10, mat='brass')
    P.cyl(lc + V((0, 0, 0.07)), lc + V((0, 0, 0.09)), 0.065, 0.03, seg=6, mat='brass')
    P.cyl(lc + V((0, 0, -0.07)), lc + V((0, 0, 0.07)), 0.05, 0.05, seg=6, mat='hearth')
    for k in range(6):
        a = k * math.tau / 6
        P.cyl(lc + V((math.cos(a) * 0.055, math.sin(a) * 0.055, -0.075)), lc + V((math.cos(a) * 0.055, math.sin(a) * 0.055, 0.075)), 0.006, 0.006, seg=5, mat='brass')
    P.cyl(lc + V((0, 0, -0.09)), lc + V((0, 0, -0.07)), 0.045, 0.065, seg=6, mat='brass')
    P.sphere(lc + V((0, 0, -0.1)), 0.015, seg=8, rings=5, mat='brass')
    B.tilt(P, n0, f, 72)  # upright when the forearm is raised to hold the lantern high


def mender_mallet(P):
    """Small mending mallet in the left hand, brass head with a felt face."""
    P.use(bone='LeftHand', mat='wood', tint=(0.86, 0.68, 0.5))
    f = fist('Left')
    a, b = f + V((0, 0.08, 0.0)), f + V((0, -0.24, -0.02))
    P.cyl(a, b, 0.014, 0.016, seg=8)
    P.cyl(b + V((0, 0, -0.06)), b + V((0, 0, 0.06)), 0.035, 0.035, seg=14, mat='brass')
    P.cyl(b + V((0, 0, 0.06)), b + V((0, 0, 0.075)), 0.033, 0.033, seg=14, mat='cloth', tint=(0.85, 0.3, 0.25))


# ================================================================== FUSEWICK (sapper)
def fuse_cap(P):
    """Scorched leather aviator cap with ear flaps and brass goggles pushed up, lenses glowing ember."""
    P.use(bone='Head', mat='leather', tint=(0.45, 0.3, 0.2))
    top = HC + V((0, 0.02, 0.05))
    P.sphere(top, 0.195, scale=(1.0, 0.98, 0.72), seg=26, rings=12)
    for s in (-1, 1):
        P.box(HC + V((s * 0.19, 0.0, -0.04)), (0.03, 0.1, 0.12), bevel=0.02, smooth=True, tint=(0.42, 0.28, 0.18))
        P.tube([HC + V((s * 0.19, 0.0, -0.1)), HC + V((s * 0.18, -0.05, -0.17)), HC + V((s * 0.15, -0.1, -0.2))], 0.008, seg=5, tint=(0.4, 0.26, 0.16))
    for s in (-1, 1):
        g = HC + V((s * 0.07, -0.12, 0.15))
        P.cyl(g + V((0, 0.03, -0.02)), g + V((0, -0.02, 0.01)), 0.048, 0.044, seg=18, mat='brass')
        P.sphere(g + V((0, -0.02, 0.01)), 0.038, scale=(1, 0.4, 1), seg=12, rings=6, mat='ember')
    P.tube([HC + V((-0.04, -0.13, 0.155)), HC + V((0.04, -0.13, 0.155))], 0.009, seg=6, mat='brass')
    # soot smudges: a few dark flecks on the cap
    for (x, y, z) in ((0.08, -0.08, 0.17), (-0.11, -0.05, 0.15), (0.0, 0.05, 0.2)):
        P.sphere(HC + V((x, y, z)), 0.03, scale=(1, 1, 0.3), seg=8, rings=4, tint=(0.18, 0.14, 0.12))


def fuse_jerkin(P):
    """Quilted padded jerkin (blast padding) and a bandolier of little ember grenades."""
    P.use(bone='Torso', mat='cloth', tint=(0.72, 0.6, 0.42))
    for z in np.linspace(1.05, 1.33, 6):
        r = B.barrel_r(z) + 0.022
        B.ring(P, (0, 0.03, z), r, 0.022, ry=r * B.FLAT, mat='cloth', tint=(0.72, 0.6, 0.42), seg=32, flat=(1.0, 0.9))
    pts = [B.on_barrel(-math.pi / 2 - 0.95, 1.37, 0.04), B.on_barrel(-math.pi / 2 - 0.3, 1.25, 0.05),
           B.on_barrel(-math.pi / 2 + 0.35, 1.12, 0.05), B.on_barrel(-math.pi / 2 + 0.95, 1.02, 0.04)]
    P.tube(pts, 0.014, seg=6, flat=(0.5, 1.4), mat='leather', tint=B.LEATHER_T)
    for t in (0.2, 0.45, 0.7):
        i = int(t * 3); p = pts[i] + (pts[i + 1] - pts[i]) * (t * 3 - i) + V((0, -0.03, 0))
        P.sphere(p, 0.026, seg=12, rings=8, mat='iron')
        P.cyl(p + V((0, 0, 0.02)), p + V((0, 0, 0.035)), 0.008, 0.008, seg=6, mat='brass')
        P.sphere(p + V((0, -0.018, 0.0)), 0.008, seg=6, rings=4, mat='ember')


def fuse_keg(P):
    """Emberdew keg strapped high on the back, ember light leaking from the staves, a fizzing fuse on top."""
    P.use(bone='Torso', mat='wood', tint=(0.78, 0.55, 0.36))
    c = V((0, 0.36, 1.28))
    prof = [(-0.2, 0.13), (-0.1, 0.16), (0.0, 0.17), (0.1, 0.16), (0.2, 0.13)]
    P.tube([c + V((0, 0, z)) for z, _ in prof], [r for _, r in prof], seg=16, up=(1, 0, 0), smooth=False)
    for k in range(16):
        a = (k + 0.5) * math.tau / 16
        if k % 3 == 0:
            P.box(c + V((math.cos(a) * 0.168, math.sin(a) * 0.168, 0)), (0.006, 0.006, 0.28), rot=rot('Z', a), mat='ember')
    for z in (-0.16, -0.07, 0.07, 0.16):
        r = 0.13 + 0.04 * (1 - (abs(z) / 0.2) ** 2)
        B.ring(P, c + V((0, 0, z)), r + 0.006, 0.011, mat='brass', seg=24)
    P.cyl(c + V((0, 0, 0.2)), c + V((0, 0, 0.21)), 0.125, 0.12, seg=16, mat='wood', tint=(0.6, 0.42, 0.28))
    P.cyl(c + V((0.04, 0, 0.21)), c + V((0.04, 0, 0.24)), 0.025, 0.022, seg=10, mat='brass')
    fuse = [c + V((0.04, 0, 0.24)), c + V((0.06, -0.02, 0.32)), c + V((0.03, -0.05, 0.4)), c + V((0.06, -0.06, 0.46))]
    P.tube(fuse, 0.007, seg=5, mat='cloth', tint=(0.3, 0.24, 0.18))
    P.sphere(fuse[-1], 0.022, seg=10, rings=6, mat='ember')
    for k in range(6):
        a = k * math.tau / 6
        P.cyl(fuse[-1], fuse[-1] + V((math.cos(a) * 0.05, math.sin(a) * 0.05, 0.03 + 0.02 * (k % 2))), 0.004, 0.001, seg=4, mat='hearth')
    # straps over the shoulders
    for s in (-1, 1):
        P.tube([c + V((s * 0.1, -0.13, 0.12)), V((s * 0.13, 0.08, 1.43)), V((s * 0.14, -0.12, 1.38)), V((s * 0.13, -0.19, 1.2))], 0.012, seg=6, flat=(0.5, 1.5), mat='leather', tint=B.LEATHER_T)


def fuse_taper(P):
    """A long lit taper in the right fist, held up and away from the keg (nervously)."""
    P.use(bone='RightHand', mat='wood', tint=(0.85, 0.7, 0.52))
    f = fist('Right')
    a, b = f + V((0, 0.05, -0.06)), f + V((0, -0.05, 0.3))
    P.cyl(a, b, 0.009, 0.007, seg=8)
    P.sphere(b + V((0, 0, 0.02)), 0.02, scale=(0.8, 0.8, 1.6), seg=10, rings=6, mat='hearth')
    P.sphere(b + V((0, 0, 0.05)), 0.012, scale=(0.7, 0.7, 1.8), seg=8, rings=5, mat='ember')


# ================================================================== CART CREW
def crew_cap(P):
    """Flat cap with a brass badge, and goggles on the brow: the cart's driver-gunner."""
    P.use(bone='Head', mat='cloth', tint=(0.22, 0.34, 0.66))
    top = HC + V((0, 0.03, 0.11))
    P.sphere(top, 0.18, scale=(1.05, 1.1, 0.45), seg=24, rings=10)
    peak = SK.ccw([(-0.13, 0.0), (0.13, 0.0), (0.1, -0.08), (-0.1, -0.08)])
    P.slab([(u, v) for u, v in peak], -0.006, 0.006, xf=Matrix.Translation(top + V((0, -0.15, -0.03))) @ rot('X', -math.pi / 2 + 0.25), bulge=0.0, rings=1, tint=(0.16, 0.26, 0.52))
    P.cyl(top + V((0, -0.17, 0.0)), top + V((0, -0.19, 0.0)), 0.025, 0.025, seg=12, mat='brass')


# ================================================================== SUNLANCE CART (siege)
def static_finish(P, col, name):
    """A non-skinned mesh from a Part (the cart is a prop: wheels and turret are separate nodes the game can spin)."""
    import bmesh
    bm = P.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for layer in (P.lb, P.lb2): bm.verts.layers.int.remove(layer)
    bm.verts.layers.float.remove(P.lw)
    me = bpy.data.meshes.new(name); bm.to_mesh(me)
    for m in P.mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); col.objects.link(ob); bm.free()
    return ob


CY = -1.5   # cart centre (in front of the crewman, who pushes from the origin)


def cart_frame(P):
    P.use(mat='wood', tint=(0.86, 0.66, 0.46))
    for s in (-1, 1):
        P.box((s * 0.33, CY + 0.05, 0.64), (0.08, 1.45, 0.11), bevel=0.015, smooth=True)
        for y in (CY - 0.65, CY + 0.75):
            P.box((s * 0.33, y, 0.64), (0.095, 0.05, 0.125), bevel=0.008, mat='brass')
    for k in range(9):
        y = CY - 0.6 + k * 0.15
        P.box((0, y, 0.7), (0.62, 0.13, 0.03), bevel=0.006, tint=(0.86, 0.66, 0.46) if k % 2 else (0.74, 0.55, 0.38))
    for y in (CY - 0.55, CY + 0.55):
        P.box((0, y, 0.6), (0.6, 0.06, 0.06), bevel=0.01, smooth=True, tint=(0.7, 0.52, 0.36))
    # axle and leaf-spring brackets
    P.cyl((-0.5, CY + 0.05, 0.55), (0.5, CY + 0.05, 0.55), 0.035, 0.035, seg=12, mat='iron')
    for s in (-1, 1):
        P.box((s * 0.33, CY + 0.05, 0.58), (0.06, 0.18, 0.05), bevel=0.01, smooth=True, mat='iron')
    # push handles back to the crewman
    for s in (-1, 1):
        a, b = V((s * 0.3, CY + 0.7, 0.66)), V((s * 0.25, -0.5, 1.0))
        P.cyl(a, b, 0.028, 0.026, seg=10)
        P.cyl(b + (a - b).normalized() * 0.18, b, 0.033, 0.033, seg=10, mat='leather', tint=B.LEATHER_T)
        P.sphere(b, 0.035, seg=10, rings=6, mat='brass')
    P.cyl((-0.26, -0.68, 0.95), (0.26, -0.68, 0.95), 0.018, 0.018, seg=8, mat='brass')
    # ammo rack on the left with three spare sun-bolts
    for k in range(3):
        y0, y1 = CY + 0.55, CY - 0.55
        z = 0.74 + k * 0.045
        P.cyl((-0.42, y0, z), (-0.42, y1, z), 0.012, 0.012, seg=6, mat='wood')
        P.sphere((-0.42, y1 - 0.04, z), 0.022, scale=(0.7, 2.2, 0.7), seg=8, rings=5, mat='hearth')
    for y in (CY + 0.4, CY - 0.4):
        P.box((-0.42, y, 0.79), (0.04, 0.03, 0.16), bevel=0.005, mat='brass')
    # folded bracing stakes under the front
    for s in (-1, 1):
        P.cyl((s * 0.25, CY - 0.62, 0.58), (s * 0.3, CY - 1.0, 0.3), 0.022, 0.012, seg=8, mat='iron')
        P.cyl((s * 0.25, CY - 0.62, 0.58), (s * 0.25, CY - 0.62, 0.66), 0.035, 0.035, seg=10, mat='brass')
    # banner pole with the Dawnhold pennant, and a road lantern on the front
    pole0, pole1 = V((0.36, CY + 0.72, 0.7)), V((0.36, CY + 0.72, 1.75))
    P.cyl(pole0, pole1, 0.016, 0.014, seg=8, tint=(0.8, 0.6, 0.42))
    P.sphere(pole1, 0.03, seg=10, rings=6, mat='brass')
    pen = SK.ccw([(0.0, 0.0), (0.0, -0.26), (-0.42, -0.17), (-0.32, -0.12), (-0.42, -0.07)])
    xf = Matrix.Translation(pole1 + V((0, 0, -0.04))) @ rot('Z', -math.pi / 2)
    P.slab(pen, -0.005, 0.005, xf=xf, bulge=0.01, rings=1, mat='cloth', tint=B.BLUE)
    P.sphere(xf @ V((-0.12, -0.012, -0.13)), 0.045, scale=(1, 0.2, 1), seg=12, rings=6, mat='cloth', tint=B.GOLD)
    lc = V((0.0, CY - 0.8, 0.62))
    P.cyl(lc + V((0, 0, 0.07)), lc + V((0, 0, 0.09)), 0.05, 0.02, seg=6, mat='brass')
    P.cyl(lc + V((0, 0, -0.05)), lc + V((0, 0, 0.07)), 0.04, 0.04, seg=6, mat='hearth')
    P.cyl(lc + V((0, 0, -0.07)), lc + V((0, 0, -0.05)), 0.03, 0.05, seg=6, mat='brass')
    P.cyl(lc + V((0, 0, 0.09)), lc + V((0, 0.15, 0.09)), 0.008, 0.008, seg=5, mat='iron')


def cart_wheel(P, s):
    c = V((s * 0.5, CY + 0.05, 0.55))
    x = V((1, 0, 0))
    B.ring(P, c, 0.52, 0.03, axis='X', mat='iron', seg=36, flat=(1.0, 1.6))
    B.ring(P, c, 0.47, 0.035, axis='X', mat='wood', seg=36, flat=(1.0, 1.4), tint=(0.8, 0.6, 0.42))
    for k in range(12):
        a = k * math.tau / 12
        d = V((0, math.cos(a), math.sin(a)))
        P.cyl(c + d * 0.08, c + d * 0.45, 0.022, 0.016, seg=8, mat='wood', tint=(0.86, 0.66, 0.46))
        P.sphere(c + d * 0.515 + x * s * 0.03, 0.01, seg=6, rings=4, mat='brass')
    P.cyl(c - x * s * 0.06, c + x * s * 0.08, 0.1, 0.08, seg=20, mat='brass')
    P.cyl(c + x * s * 0.08, c + x * s * 0.1, 0.06, 0.05, seg=20, mat='brass')
    P.sphere(c + x * s * 0.1, 0.035, scale=(0.5, 1, 1), seg=12, rings=6, mat='glow')


def cart_ballista(P):
    """Mini Sunlance on a turntable: oak stock, rope torsion springs, recurved stone-and-brass arms, a sun mantlet."""
    z0 = 0.95
    P.use(mat='brass')
    P.cyl((0, CY, 0.72), (0, CY, 0.8), 0.3, 0.28, seg=32)
    B.rivets(P, (0, CY, 0.8), 0.27, 16, size=0.008, mat='brass')
    P.box((0, CY, 0.86), (0.18, 0.3, 0.12), bevel=0.02, smooth=True, mat='iron')
    # stock with brass rails and a winch at the back
    P.box((0, CY - 0.2, z0), (0.14, 1.5, 0.1), bevel=0.02, smooth=True, mat='wood', tint=(0.82, 0.6, 0.42))
    for s in (-1, 1):
        P.box((s * 0.055, CY - 0.2, z0 + 0.055), (0.025, 1.5, 0.02), bevel=0.004)
    wc = V((0, CY + 0.48, z0))
    for s in (-1, 1):
        B.cog(P, wc + V((s * 0.11, 0, 0)), 0.07, 0.03, teeth=10, axis='X', mat='brass')
        P.tube([wc + V((s * 0.13, 0, 0)), wc + V((s * 0.17, 0, 0)), wc + V((s * 0.17, 0.08, -0.08))], 0.01, seg=6)
        P.sphere(wc + V((s * 0.17, 0.08, -0.08)), 0.02, seg=8, rings=5, mat='wood')
    P.cyl(wc + V((-0.1, 0, 0)), wc + V((0.1, 0, 0)), 0.035, 0.035, seg=12, mat='wood', tint=(0.7, 0.55, 0.4))
    # prod: torsion bundles and recurved arms
    pc = V((0, CY - 0.75, z0))
    P.box(pc, (0.42, 0.14, 0.2), bevel=0.02, smooth=True, mat='iron')
    tips = []
    for s in (-1, 1):
        tb = pc + V((s * 0.15, 0, 0))
        P.cyl(tb + V((0, 0, -0.16)), tb + V((0, 0, 0.16)), 0.06, 0.06, seg=16, mat='cloth', tint=(0.85, 0.75, 0.55))
        for dz in (-0.17, 0.17):
            P.cyl(tb + V((0, 0, dz - 0.015)), tb + V((0, 0, dz + 0.015)), 0.075, 0.075, seg=16, mat='brass')
        pts = [tb + V((s * 0.04, 0.0, 0)), tb + V((s * 0.3, 0.1, 0)), tb + V((s * 0.55, 0.28, 0)), tb + V((s * 0.66, 0.24, 0))]
        P.tube(pts, [0.045, 0.038, 0.03, 0.022], seg=10, flat=(1.0, 0.7), mat='stone', up=(0, 0, 1))
        P.tube([p + V((0, 0, 0.0)) for p in pts], [0.05, 0.042, 0.033, 0.025], seg=10, flat=(0.35, 0.8), mat='brass', up=(0, 0, 1))
        P.sphere(pts[-1], 0.03, seg=10, rings=6, mat='hearth')
        tips.append(pts[-1])
    nut = V((0, CY + 0.22, z0 + 0.06))
    P.tube([tips[0], nut, tips[1]], 0.006, seg=4, mat='cloth', tint=B.CREAM)
    P.box(nut, (0.06, 0.05, 0.04), bevel=0.01, smooth=True)
    # sun mantlet shielding the crew
    xf = Matrix.Translation((0, CY - 0.6, z0 + 0.22))
    o = SK.ccw([(math.cos(a) * 0.36, math.sin(a) * 0.22) for a in np.linspace(0, math.pi, 18)])
    P.slab(o, -0.015, 0.015, xf=xf, bulge=0.04, rings=2, mat='brass')
    for k in range(9):
        a = math.pi * (k + 0.5) / 9
        tri = SK.ccw([(-0.025, 0.0), (0.025, 0.0), (0.0, 0.1 if k % 2 == 0 else 0.07)])
        x2 = xf @ rot('Y', -(a - math.pi / 2)) @ Matrix.Translation((0, -0.01, 0.22))
        P.prism(tri, -0.006, 0.006, xf=x2, mat='brass')
    P.sphere(xf @ V((0, -0.05, 0.08)), 0.06, scale=(1, 0.5, 1), seg=14, rings=8, mat='hearth')


def cart_bolt(P):
    z0 = 0.95 + 0.075
    a, b = V((0, CY + 0.22, z0)), V((0, CY - 1.05, z0))
    P.cyl(a, b, 0.016, 0.016, seg=8, mat='wood', tint=(0.95, 0.82, 0.55))
    for t in (0.2, 0.55, 0.85):
        P.cyl(a + (b - a) * t, a + (b - a) * (t + 0.02), 0.02, 0.02, seg=8, mat='brass')
    P.sphere(b + V((0, -0.08, 0)), 0.045, scale=(0.6, 2.4, 0.6), seg=10, rings=7, mat='hearth')
    P.cyl(b, b + V((0, -0.02, 0)), 0.03, 0.03, seg=10, mat='brass')
    for k in range(3):
        aa = k * math.tau / 3
        fin = SK.ccw([(0.0, 0.0), (0.0, 0.16), (0.05, 0.04)])
        x2 = Matrix.Translation(a + V((0, -0.02, 0))) @ rot('Y', aa) @ rot('X', math.pi / 2)
        P.prism(fin, -0.003, 0.003, xf=x2, mat='cloth', tint=B.GOLD)


def build_cart():
    col = bpy.data.collections['crew']
    M = {m.name: m for m in bpy.data.materials}
    keymap = {'stone': 'Stone', 'brass': 'Brass', 'iron': 'Iron', 'cloth': 'Cloth', 'leather': 'Leather', 'wood': 'Wood',
              'glow': 'Crystal', 'ember': 'Ember', 'hearth': 'Hearth', 'dark': 'Socket', 'white': 'Catchlight', 'fabric': 'Strap'}
    MM = {k: M[v] for k, v in keymap.items()}
    obs = []
    for name, fn in (('Cart_Frame', cart_frame), ('Wheel_L', lambda P: cart_wheel(P, -1)), ('Wheel_R', lambda P: cart_wheel(P, 1)),
                     ('Ballista', cart_ballista), ('Bolt', cart_bolt)):
        P = SK.Part(name, MM); P.use(bone='Root'); fn(P)
        ob = static_finish(P, col, name); SK.box_uvs(ob); obs.append(ob)
    SK.bake_ao(obs, obs, strength=0.45)
    sel = obs
    bpy.ops.object.select_all(action='DESELECT')
    for o in sel: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'sunlance_cart.glb'), export_format='GLB', export_yup=True, use_selection=True,
                              export_image_format='JPEG', export_jpeg_quality=84, export_vertex_color='MATERIAL', export_materials='EXPORT')
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in obs)
    print(json.dumps({'unit': 'sunlance_cart', 'tris': tris}))
    return obs


UNITS = {
    'forgeling': dict(mood='eager', look=(0.0, 0.0), smile=1.0, scale=(1, 1, 1), gear=[forgeling_helm, forgeling_shield, forge_hammer], bobble_gear=[forgeling_helm]),
    'anvilback': dict(mood='stern', look=(0.0, -0.3), smile=0.2, scale=(1.4, 1.3, 1.1), head=0.86, gear=[anvil_pauldrons, anvil_bellows, anvil_shield, anvil_maul], bobble_gear=[]),
    'glintshot': dict(mood='focused', look=(0.0, 0.0), smile=0.6, scale=(0.94, 0.94, 1.02), gear=[glint_cap, glint_spyglass, glint_repeater, glint_reload, glint_quiver], bobble_gear=[glint_cap, glint_spyglass]),
    'mender': dict(mood='kind', look=(0.0, -0.2), smile=1.3, scale=(1, 1, 1), tabard=B.CREAM, gear=[mender_mantle, mender_spectacles, mender_apron, mender_lantern_crook, mender_mallet], bobble_gear=[mender_spectacles]),
    'fusewick': dict(mood='alarmed', look=(0.5, 0.2), smile=-0.6, scale=(0.82, 0.82, 0.82), head=1.08, gear=[fuse_cap, fuse_jerkin, fuse_keg, fuse_taper], bobble_gear=[fuse_cap]),
    'crew': dict(mood='eager', look=(0.0, -0.2), smile=1.0, scale=(1, 1, 1), gear=[crew_cap], bobble_gear=[crew_cap]),
}


def build_unit(name):
    spec = UNITS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(col)
    M = B.make_materials()
    parts = {}
    P = SK.Part('Head', M); B.build_head(P, spec['mood'], spec['look']); B.build_jaw(P, spec['smile']); B.bobble(P)
    if spec.get('head'): B.scale_verts(P, J['Head'], spec['head'])
    parts['Head'] = P
    P = SK.Part('Torso', M); B.build_torso(P); B.build_tabard(P, color=spec.get('tabard', B.BLUE)); parts['Torso'] = P
    for s in ('Left', 'Right'):
        P = SK.Part(s + 'Arm', M); B.build_arm(P, s); parts[s + 'Arm'] = P
        P = SK.Part(s + 'Leg', M); B.build_leg(P, s); parts[s + 'Leg'] = P
    gear = {}
    for fn in spec['gear']:
        P = SK.Part('Gear_' + fn.__name__, M); fn(P)
        if fn in spec['bobble_gear']:
            B.bobble(P)
            if spec.get('head'): B.scale_verts(P, J['Head'], spec['head'])
        gear[P.name] = P
    B.scale_unit(list(parts.values()) + list(gear.values()), spec['scale'])
    B.scale_rig(spec['scale'])
    ad = bpy.data.armatures.new('SkeletonRig'); arm = bpy.data.objects.new('SkeletonRig', ad); col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bn, (h, t, parent, deform) in SK.JOINTS.items():
        b = ad.edit_bones.new(bn); b.head = h; b.tail = t; b.use_deform = deform; b.roll = 0
        if parent: b.parent = eb[parent]
        eb[bn] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    objs = {n: p.finish(col, arm) for n, p in parts.items()}
    gobs = {n: p.finish(col, arm) for n, p in gear.items()}
    for ob in list(objs.values()) + list(gobs.values()): SK.box_uvs(ob)
    body = list(objs.values())
    SK.bake_ao(body, body + list(gobs.values()), strength=0.5)
    SK.bake_ao(list(gobs.values()), body, strength=0.4)
    tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in list(objs.values()) + list(gobs.values())}
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                              export_animations=False, export_image_format='JPEG', export_jpeg_quality=84,
                              export_vertex_color='MATERIAL', export_normals=True, export_tangents=False,
                              export_def_bones=False, export_materials='EXPORT', use_selection=False, export_extras=True)
    rep = {'unit': name, 'tris': sum(tris.values()), 'parts': tris, 'bytes': os.path.getsize(path)}
    with open(os.path.join(OUT, name + '_report.json'), 'w') as f: json.dump(rep, f, indent=1)
    print(json.dumps({k: rep[k] for k in ('unit', 'tris', 'bytes')}))
    return arm


if __name__ == '__main__':
    import importlib
    unit = sys.argv[sys.argv.index('--unit') + 1] if '--unit' in sys.argv else 'forgeling'
    names = [n for n in UNITS] if unit == 'all' else [unit]
    for n in names:
        importlib.reload(SK); B.SK = SK
        arm = build_unit(n)
        if n == 'crew': build_cart()
        if '--render' in sys.argv:
            import render_squads as R
            R.render_unit(n, arm, quick='--quick' in sys.argv)
