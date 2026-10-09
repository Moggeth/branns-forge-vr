"""Brann's Forge - back town kit (workshop, stores, cottages, well, pass lanterns), 2026-10-08. Deterministic Blender 4.5.

Run (no Blender install needed):
  pip install bpy==4.5.*
  python3 build_backtown.py              # writes backtown_kit.glb, textures/, build_report.json here
  cp backtown_kit.glb ../../multiplayer/public/assets/backtown_kit.glb
  python3 render_backtown.py             # Cycles turnarounds of every piece in renders/

Same conventions as ../town-20261007/build_town.py, whose materials, mesh helpers, AO bake and face culling this
imports: every piece is modelled at the origin, foot centre on the ground, FRONT facing Blender -Y (three.js +Z),
prefix D_ for Dawnhold (party) and G_ for Grumblekeep (rivals). Built at true size (the game places them at scale 1).
Footprints match shared/home-workshop.js BACK_TOWN_SOLIDS; positions below are three.js (x right, y up, z front):
  *_Workshop   open-fronted smithy 6 x 5: back wall z = -2.3, side walls x = +-2.8, front posts at (+-2.8, 2.3);
               furnace (-1.3, -1.2) r 1, anvil (0.4, 1.3), ore bin (1.9, 1.4), bar rack (-2.15, 1.2)
               anchors *_Workshop_Anvil (0.4, 0.86, 1.3)  *_Workshop_Furnace (-1.3, 0.55, -0.45)  *_Workshop_Rack (-2.15, 1.0, 1.2)
  *_Stores     closed storehouse 5 x 3.5, wide doorway in the front wall, doors swung open, barrels out front to z 2.15
               anchor  *_Stores_Door (0, 0, 1.75)
  *_Cottage    cottage 4.5 x 4, door and windows, chimney on the left; *_CottageB the same house dressed differently
  *_Well       well r 1: stone ring, posts, little roof, windlass and bucket
  *_Lantern    a lantern on a 2.6 m post with an arm (pass and yard)
"""
import math, os, sys, json, time
import numpy as np

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "town-20261007"))
import build_town as K  # noqa: E402  (imports the bases kit as K.B and the landmarks kit as K.L)
L, B = K.L, K.B
L.TEXDIR = os.path.join(HERE, "textures"); os.makedirs(L.TEXDIR, exist_ok=True)
from build_town import (obj, lathe, disc_lathe, torus, ellipsoid, bbox, beam, rodr, tube2, blob, slab, cyl, prism, sheet,  # noqa: E402
                        skull, keg, lantern, flames, coin_stack, flag, sign_board, sun_disc, piece, grp, col, E, STYLES,
                        PLANK_T, WOOD_T, DARKWOOD_T, STONE_T, BRASS_T, IRON_T, BONE_T, T, R, bipyramid, anchor, side_stone,
                        course_tone, basalt_tone, Matrix, TAU)
import bpy  # noqa: E402

# ----------------------------------------------------------------------------------------------
# a plain house shell: floor, walls (stone course below, plaster or planks above), timber frame, gables, roof
# ----------------------------------------------------------------------------------------------
def house_shell(pre, W, D, st, top, ridge, door=None, open_front=False, wins=None, front_wins=(), seed=0):
    """door: (x, width, height) of a doorway in the front wall (Blender -Y), or None. open_front leaves the front open
    behind two corner posts and a tie beam. wins: {sx: [y, ...]} windows in the side walls; front_wins: [x, ...]."""
    p = []; hw, hd = W / 2, D / 2; s = (ridge - top) / hw; ang = math.atan(s)
    lo, lo_t, hi, hi_t, fr, fr_t = st["lo"], st["lo_t"], st["hi"], st["hi_t"], st["frame"], st["frame_t"]
    evil = pre == "G"; htile = 1.6 if hi == "Plaster" else 0.9; lot = course_tone(5 + seed, lo_t, 0.38) if lo == "Stone" else lo_t
    zb = 0.75
    p.append(slab(-hw, hw, -hd, hd, 0.0, 0.1, lo, lo_t, chip=0.03, step=2.0))
    # back wall + gable
    p.append(slab(-hw, hw, hd - 0.42, hd + 0.02, 0, zb, lo, lot, chip=0.04, step=1.7))
    p.append(slab(-hw + 0.02, hw - 0.02, hd - 0.4, hd, zb, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
    p.append((prism([(-hw + 0.02, top), (hw - 0.02, top), (0.0, ridge - 0.02)], hd - 0.4, hd, hi, hi_t, tile=htile), Matrix()))
    yf = -hd if not open_front else -hd + 0.4
    for sx in (-1, 1):
        xa, xb = sorted((sx * (hw - 0.42), sx * (hw + 0.02))); xa2, xb2 = sorted((sx * (hw - 0.4), sx * hw))
        p.append(slab(xa, xb, yf, hd - 0.4, 0, zb, lo, lot, chip=0.04, step=1.7))
        p.append(slab(xa2, xb2, yf, hd - 0.4, zb, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
        xo = sx * (hw + 0.05)
        for z in (zb + 0.06, top - 0.08): p.append((bbox(0.12, hd - yf + hd - 0.3, 0.16, fr, fr_t), T(xo, (yf + hd) / 2, z)))
        for y in np.linspace(yf + 0.1, hd - 0.1, 4): p.append((bbox(0.12, 0.18, top - zb, fr, fr_t), T(xo, y, (top + zb) / 2)))
        for y in (wins or {}).get(sx, []): p += K.window(pre, sx, hw, y, 2.0 if top < 3 else 2.2, st, w=0.7, h=0.75)
    for z in (zb + 0.06, top - 0.08): p.append((bbox(W - 0.1, 0.12, 0.16, fr, fr_t), T(0, hd + 0.05, z)))
    for x in np.linspace(-hw + 0.1, hw - 0.1, 4): p.append((bbox(0.18, 0.12, top - zb, fr, fr_t), T(x, hd + 0.05, (top + zb) / 2)))
    if open_front:
        for sx in (-1, 1):
            px, py = sx * (hw - 0.2), -hd + 0.2
            p.append((cyl(0.2, top - 0.05, fr, fr_t, seg=8, r1=0.18), T(px, py, 0.06) @ R(math.pi / 8, "Z")))
            with side_stone(lo): p.append((L.block(4310 + sx + seed, 0.56, 0.56, 0.3, 0.04, seg=(1, 1, 1), tone=lo_t), T(px, py, 0.1)))
            p.append(beam((px - sx * 0.12, py, top - 0.9), (px - sx * 0.85, py, top - 0.12), 0.13, fr, fr_t))
            p.append(beam((px, py + 0.12, top - 0.9), (px, py + 0.85, top - 0.12), 0.13, fr, fr_t))
        p.append((bbox(W + 0.2, 0.32, 0.32, fr, fr_t, bev=0.04), T(0, -hd + 0.2, top - 0.05)))
        p.append((prism([(-hw + 0.1, top + 0.11), (hw - 0.1, top + 0.11), (0.0, ridge - 0.05)], -hd + 0.12, -hd + 0.3, hi, hi_t, tile=htile), Matrix()))
    else:
        # front wall with a doorway and windows
        dx, dw, dh = door if door else (0.0, 0.0, 0.0)
        spans = [(-hw, dx - dw / 2), (dx + dw / 2, hw)] if door else [(-hw, hw)]
        for x0, x1 in spans:
            if x1 - x0 < 0.05: continue
            p.append(slab(x0, x1, -hd - 0.02, -hd + 0.4, 0, zb, lo, lot, chip=0.04, step=1.7))
            p.append(slab(x0 + 0.02, x1 - 0.02, -hd, -hd + 0.4, zb, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
        if door:  # wall over the door, lintel, jambs and the threshold
            p.append(slab(dx - dw / 2, dx + dw / 2, -hd, -hd + 0.4, dh, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
            p.append((bbox(dw + 0.5, 0.2, 0.22, fr, fr_t, bev=0.03), T(dx, -hd - 0.06, dh + 0.1)))
            for sxx in (-1, 1): p.append((bbox(0.16, 0.2, dh, fr, fr_t), T(dx + sxx * (dw / 2 + 0.06), -hd - 0.04, dh / 2)))
            with side_stone(lo): p.append((L.block(4320 + seed, dw + 0.3, 0.5, 0.12, 0.03, seg=(2, 1, 1), tone=lo_t), T(dx, -hd - 0.12, 0.05)))
        for x in front_wins:
            p.append(slab(x - 0.35, x + 0.35, -hd - 0.04, -hd + 0.42, 1.6, 2.35, "Ember" if not evil else "Ooze", None, chip=0.0, step=2.0, tile=0.5))
            p.append((bbox(0.95, 0.22, 0.12, fr, fr_t), T(x, -hd - 0.1, 1.56)))
            p.append((bbox(0.85, 0.18, 0.12, fr, fr_t), T(x, -hd - 0.08, 2.4)))
            p.append((bbox(0.06, 0.1, 0.75, fr, fr_t), T(x, -hd - 0.06, 1.98)))
            paint = [0.32, 0.5, 0.85] if not evil else [0.45, 0.25, 0.55]
            for sxx in (-1, 1): p.append((bbox(0.36, 0.05, 0.78, "Wood", col(paint, 4330 + int(x * 10) + sxx, 0.1)), T(x + sxx * 0.58, -hd - 0.2, 1.98) @ R(sxx * 0.5, "Z")))
        for z in (zb + 0.06, top - 0.08): p.append((bbox(W - 0.1, 0.12, 0.16, fr, fr_t), T(0, -hd - 0.05, z)))
        for x in (-hw + 0.1, hw - 0.1): p.append((bbox(0.18, 0.12, top - zb, fr, fr_t), T(x, -hd - 0.05, (top + zb) / 2)))
        p.append((prism([(-hw + 0.02, top), (hw - 0.02, top), (0.0, ridge - 0.02)], -hd, -hd + 0.4, hi, hi_t, tile=htile), Matrix()))
        p.append((bbox(0.16, 0.12, ridge - top - 0.45, fr, fr_t), T(0, -hd - 0.05, (top + ridge - 0.35) / 2)))
    # roof: two slabs with overhangs, bargeboards, fascia and a ridge
    ov = 0.45; run = hw + ov; zeave = top - s * ov; yb0, yb1 = -hd - (0.7 if open_front else 0.4), hd + 0.4; th = 0.18
    hyp = math.hypot(run, run * s) + 0.1; rt = st["roof_t"] or K.moss_slate
    for sx in (-1, 1):
        V, F = B.boxv(hyp, yb1 - yb0, th, 0.03, seg=(4, 5, 1), wob=0.025 if not evil else 0.05, seed=4400 + sx + seed)
        if evil: V[:, 2] -= 0.16 * np.sin(np.pi * (V[:, 1] / (yb1 - yb0) + 0.5)) * (0.35 + 0.65 * (V[:, 0] * -sx / hyp + 0.5))
        cx = sx * (run / 2 - 0.03); cz = zeave + s * run / 2 + th / 2 / math.cos(ang)
        p.append((obj("roof", V, F, st["roof"], rt, tile=1.6, sa=30), T(cx, (yb0 + yb1) / 2, cz) @ R(sx * ang, "Y")))
        p.append((bbox(hyp, 0.08, 0.3, fr, fr_t), T(sx * (run / 2), yb0 - 0.04, zeave + s * run / 2 + 0.02) @ R(sx * ang, "Y")))
        p.append((bbox(0.1, yb1 - yb0, 0.18, fr, fr_t), T(sx * (run + 0.02), (yb0 + yb1) / 2, zeave - 0.02)))
    p.append((bbox(0.2, D + 0.4, 0.22, fr, fr_t), T(0, 0, ridge - 0.35)))
    return p

def chimney(st, x, y, z0, z1, seed):
    lo, lo_t = st["lo"], st["lo_t"]; lot = course_tone(51 + seed, lo_t, 0.42) if lo == "Stone" else lo_t
    p = [slab(x - 0.42, x + 0.42, y - 0.42, y + 0.42, z0, z1, lo, lot, chip=0.05, step=0.9),
         slab(x - 0.5, x + 0.5, y - 0.5, y + 0.5, z1, z1 + 0.16, lo, lo_t, chip=0.04, step=1.2)]
    p.append((cyl(0.13, 0.4, "Iron" if st["lo"] == "Basalt" else "Brass", IRON_T if st["lo"] == "Basalt" else BRASS_T, seg=7, r1=0.16), T(x, y, z1 + 0.14)))
    return p

def crate(w, seed, wood_t=WOOD_T, metal="Iron", mt=IRON_T):
    p = [(bbox(w, w, w, "Wood", col([0.9, 0.78, 0.6], seed, 0.1), bev=0.02), T(0, 0, w / 2))]
    for a in (0, math.pi / 2):
        for sx in (-1, 1): p.append((bbox(w + 0.02, 0.06, 0.08, "Wood", wood_t), R(a, "Z") @ T(0, sx * (w / 2 + 0.005), w * 0.18)))
    p.append((bbox(0.06, w + 0.02, w * 1.25, "Wood", wood_t), T(-w / 2 - 0.005, 0, w / 2) @ R(0.78, "X")))
    p.append((bbox(w * 0.9, w * 0.9, 0.04, metal, mt), T(0, 0, w + 0.005)))
    return p

def sack(seed, rgb=(0.82, 0.7, 0.5), s=1.0):
    return [(blob(0.24 * s, 0.2 * s, 0.3 * s, "Cloth", col(list(rgb), seed, 0.08), 8, 5), T(0, 0, 0.29 * s)),
            (cyl(0.08 * s, 0.1 * s, "Cloth", col(list(rgb), seed + 1, 0.08), seg=6), T(0, 0, 0.55 * s))]

def ingot(metal_rgb, seed):
    """A trapezoid bar of metal, three.js-sized 0.3 x 0.12 x 0.08."""
    V = np.array([[-0.15, -0.06, 0], [0.15, -0.06, 0], [0.15, 0.06, 0], [-0.15, 0.06, 0],
                  [-0.12, -0.04, 0.08], [0.12, -0.04, 0.08], [0.12, 0.04, 0.08], [-0.12, 0.04, 0.08]], float)
    F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return obj("ingot", V, F, "Brass", col(list(metal_rgb), seed, 0.06), tile=0.2, sa=20)

# ----------------------------------------------------------------------------------------------
# workshop
# ----------------------------------------------------------------------------------------------
def anvil(metal="Iron", mt=IRON_T):
    """Anvil on an oak stump, top at 0.86, horn toward +X."""
    p = [(cyl(0.34, 0.5, "Wood", DARKWOOD_T, seg=9, r1=0.3), Matrix())]
    for k in range(3): p.append((obj("ring", *torus(0.32 - 0.006 * k, 0.012, 9, 3), "Wood", col([0.55, 0.42, 0.3], 4500 + k, 0.1), tile=0.3), T(0, 0, 0.5)))
    p.append((bbox(0.34, 0.24, 0.12, metal, mt, bev=0.02), T(0, 0, 0.56)))   # foot
    p.append((bbox(0.18, 0.16, 0.14, metal, mt), T(0, 0, 0.68)))             # waist
    p.append((bbox(0.5, 0.2, 0.12, metal, mt, bev=0.02), T(-0.04, 0, 0.8)))  # face
    hv, hf = lathe([(0.075, 0.0), (0.06, 0.12), (0.035, 0.22), (0.0, 0.3)], 7)
    p.append((obj("horn", hv, hf, metal, mt, tile=0.3, sa=40), T(0.2, 0, 0.8) @ R(math.pi / 2, "Y")))
    p.append((bbox(0.1, 0.14, 0.1, metal, mt), T(-0.32, 0, 0.8)))            # heel
    return p

def hammer(metal, mt, s=1.0):
    return [(cyl(0.022 * s, 0.42 * s, "Wood", WOOD_T, seg=6), Matrix()), (bbox(0.16 * s, 0.07 * s, 0.07 * s, metal, mt, bev=0.01), T(0, 0, 0.44 * s))]

def furnace(pre, st, top, ridge, seed):
    """A chunky stone furnace with a glowing arched mouth to the front, bellows on its flank and a hood and stack
    up through the roof. Origin at the furnace's foot centre."""
    evil = pre == "G"; lo, lo_t = st["lo"], st["lo_t"]; glow = "Ember" if not evil else "Ooze"
    lot = course_tone(61 + seed, lo_t, 0.4) if lo == "Stone" else lo_t; soot = col([0.25, 0.22, 0.2], 4600, 0.15)
    p = [slab(-0.85, 0.85, -0.7, 0.7, 0, 1.1, lo, lot, chip=0.06, step=0.7)]
    p.append(slab(-0.75, 0.75, -0.6, 0.6, 1.1, 1.45, lo, lot, chip=0.06, step=0.7))
    # mouth: soot frame, glowing bed and coals, an arch of voussoirs
    p.append(slab(-0.42, 0.42, -0.74, -0.68, 0.25, 0.85, "Stone", soot, chip=0.0, step=1.0))
    p.append(slab(-0.36, 0.36, -0.76, -0.7, 0.3, 0.72, glow, None, chip=0.0, step=1.0, tile=0.5))
    p += grp(flames(4610 + seed, 0.7), T(0, -0.55, 0.3))
    with side_stone(lo):
        p.append((L.block(4620 + seed, 1.1, 0.26, 0.2, 0.03, seg=(2, 1, 1), tone=lo_t), T(0, -0.8, 0.95)))  # lintel
        for sx in (-1, 1): p.append((L.block(4621 + sx + seed, 0.2, 0.24, 0.72, 0.03, seg=(1, 1, 1), tone=lo_t), T(sx * 0.5, -0.8, 0.55)))
        p.append((L.block(4630 + seed, 1.0, 0.3, 0.12, 0.03, seg=(2, 1, 1), tone=lo_t), T(0, -0.84, 0.22)))
    # hood and stack (up past the ridge)
    hv, hf = lathe([(0.0, 0.0), (0.7, 0.0), (0.62, 0.05), (0.32, 0.55), (0.0, 0.55)], 4)
    m, mt = ("Brass", BRASS_T) if not evil else ("Iron", IRON_T)
    p.append((obj("hood", hv, hf, m, mt, tile=0.4, sa=30), T(0, 0, 1.45) @ R(math.pi / 4, "Z")))
    p.append((cyl(0.24, ridge + 0.9 - 2.0, m, mt, seg=8), T(0, 0, 2.0)))
    for z in (2.6, ridge - 0.2, ridge + 0.6): p.append((obj("band", *torus(0.255, 0.03, 8, 4), "Iron", IRON_T, tile=0.3), T(0, 0, z)))
    if evil:
        p += grp(skull(4640 + seed, 0.3, 0.24, 0.28, eye_big=1.35, eyes="Ooze"), T(0, -0.62, 1.32))
        p.append((cyl(0.3, 0.12, "Iron", IRON_T, seg=8, r1=0.18), T(0, 0, ridge + 0.9)))
        for k in range(3): p.append((blob(0.12, 0.12, 0.1, "Ooze", None, 6, 3), T(0.08 * math.cos(k * 2.1), 0.08 * math.sin(k * 2.1), ridge + 1.05 + 0.08 * k)))
    else:
        p += grp(sun_disc(0.28, rays=10), T(0, -0.63, 1.3) @ R(0, "Z"))
        p.append((obj("cap", *lathe([(0.0, 0.0), (0.4, 0.0), (0.0, 0.3)], 8), "Brass", BRASS_T, tile=0.3), T(0, 0, ridge + 1.05)))
        for k in range(4): p.append(rodr((0.2 * math.cos(k * math.pi / 2), 0.2 * math.sin(k * math.pi / 2), ridge + 0.85), (0.3 * math.cos(k * math.pi / 2), 0.3 * math.sin(k * math.pi / 2), ridge + 1.08), 0.02, "Brass", BRASS_T, 4))
    # bellows on the right flank, nozzle into the side
    bx = 1.05
    p.append((bbox(0.5, 0.9, 0.08, "Wood", st["frame_t"], bev=0.01), T(bx, 0.0, 0.45)))
    p.append((bbox(0.5, 0.9, 0.08, "Wood", st["frame_t"], bev=0.01), T(bx, 0.0, 0.78) @ R(-0.12, "X")))
    bv, bf = ellipsoid(0.24, 0.42, 0.14, 8, 5)
    p.append((obj("bag", bv, bf, "Cloth", col([0.55, 0.35, 0.22] if not evil else [0.4, 0.22, 0.42], 4650, 0.1), tile=0.3, sa=60), T(bx, 0.0, 0.6)))
    p.append(rodr((bx, -0.45, 0.5), (0.86, -0.3, 0.45), 0.04, "Iron", IRON_T, 5))
    p.append(rodr((bx, 0.45, 0.82), (bx, 0.95, 1.05), 0.025, "Wood", st["frame_t"], 5))
    p.append((cyl(0.07, 0.36, "Wood", st["frame_t"], seg=6), T(bx, 0.95, 0.42)))
    return p

def build_workshop(pre):
    st = dict(STYLES[pre]); evil = pre == "G"; W, D, top, ridge = 6.0, 5.0, 3.0, 5.0; hw, hd = W / 2, D / 2
    m, mt = (st["metal"], st["metal_t"]); fr, fr_t = st["frame"], st["frame_t"]
    p = house_shell(pre, W, D, st, top, ridge, open_front=True, wins={1: [0.4]}, seed=1)
    # furnace at three (-1.3, -1.2) -> Blender (-1.3, 1.2)
    p += grp(furnace(pre, st, top, ridge, 0), T(-1.3, 1.2, 0.1))
    # anvil at three (0.4, 1.3) -> Blender (0.4, -1.3), with a hammer on its face and tongs at its foot
    p += grp(anvil("Iron", IRON_T), T(0.4, -1.3, 0.1) @ R(0.35, "Z"))
    p += grp(hammer(m, mt), T(0.32, -1.36, 0.97) @ R(0.35, "Z") @ R(math.pi / 2, "Y"))
    p.append(rodr((0.82, -1.0, 0.12), (0.62, -0.62, 0.72), 0.018, "Iron", IRON_T, 4))
    p.append(rodr((0.9, -1.02, 0.12), (0.66, -0.6, 0.72), 0.018, "Iron", IRON_T, 4))
    # a glowing bar half-worked on the anvil
    p.append((bbox(0.42, 0.06, 0.05, "Ember" if not evil else "Ooze", None), T(0.32, -1.25, 0.93) @ R(0.35, "Z")))
    # quench trough against the right wall, three (2.1, -1.3) -> Blender (2.1, 1.3)
    p.append(slab(1.8, 2.42, 0.7, 1.9, 0.1, 0.62, "Wood", st["frame_t"], chip=0.02, step=1.0))
    p.append(slab(1.86, 2.36, 0.76, 1.84, 0.5, 0.58, "Crystal" if not evil else "Ooze", None, chip=0.0, step=2.0, tile=0.5))
    for y in (0.75, 1.85): p.append((bbox(0.7, 0.06, 0.08, "Iron", IRON_T), T(2.11, y, 0.4)))
    # ore bin at three (1.9, 1.4) -> Blender (1.9, -1.4): a slatted crib heaped with ore
    p.append(slab(1.45, 2.35, -1.85, -0.95, 0.1, 0.72, "Wood", st["frame_t"], chip=0.02, step=1.0))
    rr = np.random.default_rng(4700 + len(pre)); ores = [[0.7, 0.42, 0.3], [0.45, 0.78, 0.82], [0.95, 0.7, 0.32], [0.35, 0.62, 0.45]]
    for k in range(10):  # faceted lumps of ore, each a squashed, tumbled bipyramid
        x = 1.55 + rr.random() * 0.7; y = -1.8 + rr.random() * 0.75; r = 0.1 + 0.05 * rr.random()
        v, f = bipyramid(r, r * 0.8, r * 0.7, 5)
        p.append((obj("ore", v, f, "Stone", col(ores[k % 4], 4710 + k, 0.1), tile=0.3, sa=20), T(x, y, 0.74 + 0.05 * rr.random()) @ R(rr.random() * 3, "Z") @ R(rr.random() - 0.5, "X")))
    v, f = bipyramid(0.14, 0.14, 0.07, 5); p.append((obj("gem", v, f, "Crystal" if not evil else "Amethyst", None, tile=0.3, sa=20), T(1.95, -1.45, 0.92) @ R(0.4, "X")))
    p.append((bbox(0.95, 0.06, 0.14, "Wood", st["frame_t"]), T(1.9, -1.88, 0.58)))
    # bar rack at three (-2.15, 1.2) -> Blender (-2.15, -1.2): a two-shelf rack with finished bars
    for x in (-2.45, -1.85):
        for y in (-1.5, -0.9): p.append((bbox(0.07, 0.07, 1.25, "Wood", st["frame_t"]), T(x, y, 0.72)))
    metals = [[0.85, 0.84, 0.86], [0.55, 0.85, 0.95], [1.0, 0.75, 0.4], [0.95, 0.6, 0.35], [1.0, 0.85, 0.35]]
    for z, row in ((0.55, 0), (1.05, 1)):
        p.append((bbox(0.72, 0.7, 0.05, "Wood", st["frame_t"]), T(-2.15, -1.2, z)))
        for k in range(4):
            p.append((ingot(metals[(k + row * 2) % 5], 4720 + k + row * 4), T(-2.15, -1.45 + k * 0.16, z + 0.03) @ R(math.pi / 2, "Z")))
            if k % 2 == 0: p.append((ingot(metals[(k + row * 2 + 1) % 5], 4730 + k + row * 4), T(-2.15, -1.37 + k * 0.16, z + 0.11) @ R(math.pi / 2, "Z")))
    # tools on the back wall: tongs, hammers, a horseshoe
    for k, x in enumerate((0.0, 0.45, 0.9)):
        p += grp(hammer(m if k % 2 else "Iron", mt if k % 2 else IRON_T, 0.9), T(x + 0.3, hd - 0.48, 1.35) @ R(0.08 * (k - 1), "Y"))
    p.append((bbox(1.5, 0.06, 0.08, "Wood", st["frame_t"]), T(0.75, hd - 0.44, 1.8)))
    p.append((obj("shoe", *torus(0.14, 0.03, 10, 4), m, mt, tile=0.3), T(1.65, hd - 0.46, 1.95) @ R(math.pi / 2, "X")))
    # sign over the front: crossed hammer and tongs on the house colours
    board = col([0.22, 0.36, 0.72], 4740, 0.1) if not evil else col([0.4, 0.2, 0.5], 4741, 0.12)
    sb = sign_board(1.3, 0.62, board, m, mt)
    # emblem on the board face: an anvil in profile under a hammer
    for w, h, x, z in ((0.5, 0.11, -0.02, -0.26), (0.15, 0.12, 0.0, -0.37), (0.34, 0.07, 0.0, -0.47)):
        sb.append((bbox(w, 0.05, h, "Iron", IRON_T), T(x, -0.07, z)))
    hv, hf = lathe([(0.055, 0.0), (0.04, 0.09), (0.0, 0.16)], 5); sb.append((obj("horn", hv, hf, "Iron", IRON_T, tile=0.3), T(0.22, -0.07, -0.26) @ R(math.pi / 2, "Y")))
    sb += grp(hammer(m, mt, 0.75), T(-0.05, -0.1, -0.33) @ R(0.9, "Y") @ T(0, 0, -0.05))
    if evil: sb += grp(skull(4742, 0.16, 0.12, 0.15, eye_big=1.35), T(0.48, -0.12, -0.32))
    else:
        v, f = bipyramid(0.1, 0.1, 0.05, 4); sb.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(0.52, -0.08, -0.3) @ R(math.pi / 2, "X")))
    p += grp(sb, T(0, -hd + 0.02, top + 0.62))
    # lanterns on the front posts
    for sx in (-1, 1): p += grp(lantern(m, mt, st["lamp"], 0.9), T(sx * (hw - 0.2), -hd - 0.1, top - 0.4))
    if not evil:
        for sx in (-1, 1): p += grp(flag(0.5, 1.0, st["cloth"], st["sigil"], 4750 + sx), T(sx * (hw - 0.75), -hd + 0.12, top - 0.22))
    else:
        ridge_pts = [(0, y, ridge + 0.1 - 0.15 * math.sin(math.pi * (y + hd + 0.7) / (D + 1.1))) for y in np.linspace(-hd - 0.7, hd + 0.4, 4)]
        p.append(tube2(ridge_pts, 0.11, 0.11, "Bone", BONE_T, 6, 2, wob=0.1))
        for sx in (-1, 1): p += grp(flag(0.5, 1.0, st["cloth"], st["sigil"], 4760 + sx, tatter=0.4, metal="Iron", mt=IRON_T), T(sx * (hw - 0.75), -hd + 0.12, top - 0.22))
    ob = piece(f"{pre}_Workshop", p)
    anchor(f"{pre}_Workshop_Anvil", (0.4, -1.3, 0.96), ob)
    anchor(f"{pre}_Workshop_Furnace", (-1.3, 0.45, 0.65), ob)
    anchor(f"{pre}_Workshop_Rack", (-2.15, -1.2, 1.0), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# stores
# ----------------------------------------------------------------------------------------------
def barrel_pair(seed, wood_t, metal, mt):
    return grp(keg(0.3, 0.75, "Wood", wood_t, metal, mt, 8), T(0, 0, 0)) + grp(keg(0.26, 0.62, "Wood", wood_t, metal, mt, 8), T(0.08, 0.02, 0.75) @ R(0.4, "Z"))

def build_stores(pre):
    st = dict(STYLES[pre]); evil = pre == "G"; W, D, top, ridge = 5.0, 3.5, 2.9, 4.6; hw, hd = W / 2, D / 2
    m, mt = st["metal"], st["metal_t"]; fr, fr_t = st["frame"], st["frame_t"]; wt = DARKWOOD_T if evil else WOOD_T
    p = house_shell(pre, W, D, st, top, ridge, door=(0.0, 1.9, 2.15), wins={-1: [0.2], 1: [0.2]}, seed=2)
    # dark interior back so the doorway reads deep, stacked crates and sacks inside
    p.append(slab(-1.0, 1.0, hd - 0.44, hd - 0.42, 0.1, 2.1, "Wood", col([0.2, 0.16, 0.14], 4800, 0.1), chip=0.0, step=2.0))
    for k, (x, y, z, w) in enumerate(((-0.75, 1.0, 0.1, 0.6), (-0.75, 1.0, 0.7, 0.5), (0.1, 1.05, 0.1, 0.55), (0.7, 0.95, 0.1, 0.62))):
        p += grp(crate(w, 4810 + k, wt, "Iron", IRON_T), T(x, y, z) @ R(0.15 * k, "Z"))
    p += grp(sack(4820), T(0.15, 0.5, 0.1)); p += grp(sack(4822, s=0.85), T(-0.35, 0.35, 0.1) @ R(0.4, "X"))
    # the doors: two leaves swung right back against the front wall
    for sx in (-1, 1):
        leaf = [(bbox(0.92, 0.07, 2.08, "Wood", col([0.32, 0.5, 0.85] if not evil else [0.42, 0.24, 0.52], 4830 + sx, 0.08)), T(0, 0, 1.04))]
        for z in (0.35, 1.75): leaf.append((bbox(0.95, 0.04, 0.12, m, mt), T(0, -0.05, z)))
        leaf.append((bbox(0.08, 0.04, 1.6, "Wood", wt), T(0, -0.05, 1.05) @ R(0.55, "Y")))
        p += grp(leaf, T(sx * 0.95, -hd - 0.06, 0.08) @ R(sx * 2.8, "Z") @ T(-sx * 0.46, 0, 0))
    # out front: barrels, a crate and a tally board (all inside z <= 2.15)
    p += grp(barrel_pair(4840, wt, m, mt), T(-1.75, -hd - 0.35, 0.0))
    p += grp(keg(0.3, 0.75, "Wood", wt, m, mt, 8), T(1.85, -hd - 0.38, 0.0))
    p += grp(crate(0.5, 4845, wt, m, mt), T(1.75, -hd - 0.3, 0.75) @ R(0.3, "Z"))
    p += grp(sack(4846, (0.75, 0.62, 0.42), 0.8), T(1.25, -hd - 0.25, 0.0) @ R(-0.2, "Y"))
    p.append((bbox(0.6, 0.05, 0.8, "Slate", col([0.4, 0.42, 0.45], 4850, 0.05)), T(-1.25, -hd - 0.08, 1.55)))
    for k in range(4): p.append((bbox(0.36 - 0.06 * k, 0.01, 0.03, "Plaster", K.FOAM_T), T(-1.25, -hd - 0.11, 1.75 - k * 0.13)))
    # sign: a big key over a coin purse (Dawnhold) / a skull padlock (Grumblekeep)
    board = col([0.22, 0.36, 0.72], 4860, 0.1) if not evil else col([0.4, 0.2, 0.5], 4861, 0.12)
    sb = sign_board(1.0, 0.5, board, m, mt)
    kv, kf = lathe([(0.0, 0.0), (0.03, 0.0), (0.03, 0.42), (0.0, 0.42)], 6)
    sb.append((obj("shaft", kv, kf, m, mt, tile=0.3), T(-0.22, -0.08, -0.25) @ R(math.pi / 2, "Y")))
    sb.append((obj("bow", *torus(0.09, 0.025, 10, 4), m, mt, tile=0.3), T(-0.3, -0.08, -0.25) @ R(math.pi / 2, "X")))
    for x in (0.12, 0.18): sb.append((bbox(0.03, 0.03, 0.09, m, mt), T(x, -0.08, -0.3)))
    if evil: sb += grp(skull(4862, 0.11, 0.08, 0.1, eye_big=1.3), T(0.32, -0.1, -0.24))
    else: sb.append((blob(0.1, 0.06, 0.1, "Cloth", col([0.55, 0.35, 0.22], 4863, 0.1), 6, 4), T(0.33, -0.08, -0.27)))
    p += grp(sb, T(0, -hd - 0.2, 2.75))
    p += grp(lantern(m, mt, st["lamp"], 0.85), T(1.15, -hd - 0.25, 2.6))
    ob = piece(f"{pre}_Stores", p)
    anchor(f"{pre}_Stores_Door", (0.0, -hd, 0.0), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# cottages
# ----------------------------------------------------------------------------------------------
def build_cottage(pre, variant):
    st = dict(STYLES[pre]); evil = pre == "G"; W, D, top, ridge = 4.5, 4.0, 2.7, 4.5; hw, hd = W / 2, D / 2
    m, mt = st["metal"], st["metal_t"]; wt = DARKWOOD_T if evil else WOOD_T
    alt = variant == "B"; dx = 0.6 if not alt else -0.6; wx = -1.1 if not alt else 1.1
    if alt and not evil: st["hi_t"] = col([0.96, 0.9, 0.78], 4900, 0.08); st["roof_t"] = col([0.78, 0.9, 1.0], 4901, 0.1)
    if alt and evil: st["roof_t"] = col([0.58, 0.5, 0.72], 4902, 0.1)
    p = house_shell(pre, W, D, st, top, ridge, door=(dx, 0.95, 1.95), front_wins=(wx,), wins={-1 if not alt else 1: [0.4]}, seed=3 + alt)
    door_c = [0.85, 0.32, 0.25] if not evil else [0.3, 0.5, 0.25]
    if alt: door_c = [0.25, 0.55, 0.45] if not evil else [0.5, 0.22, 0.45]
    p.append((bbox(0.92, 0.08, 1.9, "Wood", col(door_c, 4910 + alt, 0.08)), T(dx, -hd + 0.06, 1.02)))
    p.append((blob(0.05, 0.05, 0.05, m, mt, 6, 3), T(dx + 0.3, -hd - 0.02, 1.05)))
    for z in (0.5, 1.5): p.append((bbox(0.95, 0.03, 0.08, "Iron", IRON_T), T(dx, -hd, z)))
    csx = -1 if not alt else 1
    s = (ridge - top) / hw; zt = ridge - s * (hw - 0.6) + 1.0
    p += chimney(st, csx * (hw - 0.6), 0.9, top - 0.3, zt, 3 + alt)
    if not evil:  # flower box under the front window, a bench by the door, a wreath
        p.append((bbox(0.95, 0.28, 0.22, "Wood", col([0.3, 0.45, 0.8] if not alt else [0.85, 0.6, 0.3], 4920 + alt, 0.08), bev=0.02), T(wx, -hd - 0.24, 1.45)))
        for k in range(4): p.append((blob(0.14, 0.12, 0.1, "Cloth", col([0.98, 0.82, 0.3] if k % 2 else [0.95, 0.45, 0.5], 4930 + k + alt * 5, 0.08), 6, 4), T(wx - 0.36 + k * 0.24, -hd - 0.24, 1.6)))
        p.append((obj("wreath", *torus(0.2, 0.06, 10, 4), "Cloth", col([0.35, 0.6, 0.3], 4940 + alt, 0.1), tile=0.3), T(dx, -hd - 0.08, 1.55) @ R(math.pi / 2, "X")))
        if alt:  # a little woodpile against the side
            for k in range(6): p.append((cyl(0.09, 0.9, "Wood", WOOD_T, seg=6), T(hw + 0.18, -1.0 + 0.0 * k, 0.1 + 0.16 * (k // 3) + 0.09) @ T(0, (k % 3) * 0.18 - 0.18, 0) @ R(math.pi / 2, "X") @ T(0, 0, -0.45)))
        else:
            p.append((bbox(1.0, 0.3, 0.06, "Wood", WOOD_T), T(-0.2 + dx - 1.2, -hd - 0.35, 0.48)))
            for x in (-0.6, 0.3): p.append((bbox(0.08, 0.26, 0.45, "Wood", WOOD_T), T(x + dx - 1.2 + 0.15, -hd - 0.35, 0.24)))
    else:  # glowing mushrooms by the door, a skull over it, crooked bone trim
        rr = np.random.default_rng(4950 + alt)
        for k in range(4):
            x = dx + (0.75 if not alt else -0.75) + (rr.random() - 0.5) * 0.4; y = -hd - 0.25 - rr.random() * 0.15; h = 0.15 + 0.15 * rr.random()
            p.append((cyl(0.03, h, "Bone", BONE_T, seg=5), T(x, y, 0.08)))
            p.append((blob(0.1, 0.1, 0.06, "Ooze", None, 7, 3), T(x, y, 0.08 + h)))
        p += grp(skull(4960 + alt, 0.17, 0.13, 0.16, eye_big=1.35), T(dx, -hd - 0.12, 2.15))
        p.append((bbox(0.95, 0.28, 0.2, "Wood", DARKWOOD_T, bev=0.02), T(wx, -hd - 0.24, 1.45)))
        for k in range(3): p.append((blob(0.12, 0.1, 0.08, "Ooze" if k == 1 else "Cloth", None if k == 1 else col([0.4, 0.6, 0.25], 4970 + k, 0.1), 6, 3), T(wx - 0.3 + k * 0.3, -hd - 0.24, 1.6)))
    p += grp(lantern(m, mt, st["lamp"], 0.75), T(dx + (-0.7 if not alt else 0.7), -hd - 0.2, 2.35))
    ob = piece(f"{pre}_Cottage{'B' if alt else ''}", p)
    return ob

# ----------------------------------------------------------------------------------------------
# well and lantern post
# ----------------------------------------------------------------------------------------------
def build_well(pre):
    st = STYLES[pre]; evil = pre == "G"; lo, lo_t = st["lo"], st["lo_t"]; m, mt = st["metal"], st["metal_t"]; wt = DARKWOOD_T if evil else WOOD_T
    p = []
    rv, rf = lathe([(0.7, 0.0), (0.95, 0.0), (0.98, 0.1), (0.95, 0.7), (1.0, 0.75), (1.0, 0.85), (0.7, 0.85), (0.7, 0.0)], 12)
    p.append((obj("ring", rv, rf, lo, course_tone(4990, lo_t, 0.35) if lo == "Stone" else lo_t, tile=0.8, sa=35), Matrix()))
    p.append((obj("water", *disc_lathe(0.7, 0.7, 0, 0.02, 12), "Crystal" if not evil else "Ooze", None, tile=0.4), T(0, 0, 0.45)))
    for sx in (-1, 1):
        if evil: p.append(tube2([(sx * 0.82, 0, 0.8), (sx * 0.86, 0, 1.6), (sx * 0.8, 0, 2.2)], 0.08, 0.06, "Bone", BONE_T, 6, 2, wob=0.1))
        else: p.append((bbox(0.14, 0.14, 1.5, "Wood", wt), T(sx * 0.82, 0, 1.55)))
    s = 0.55; hw = 0.9; zr = 2.2; ang = math.atan(s)
    for sx in (-1, 1):
        V, F = B.boxv(math.hypot(hw, hw * s) + 0.1, 1.3, 0.08, 0.02, seg=(2, 2, 1), wob=0.02 if not evil else 0.04, seed=4995 + sx)
        p.append((obj("roof", V, F, st["roof"], st["roof_t"] or K.moss_slate, tile=1.2, sa=30), T(sx * hw / 2, 0, zr + hw * s / 2 + 0.04) @ R(sx * ang, "Y")))
    p.append((bbox(0.1, 1.4, 0.12, "Wood", wt), T(0, 0, zr + hw * s + 0.04)))
    # windlass, crank, rope and bucket
    p.append(rodr((-0.85, 0, 1.55), (0.95, 0, 1.55), 0.07, "Wood", wt, 8))
    p.append(rodr((0.95, 0, 1.55), (0.95, -0.25, 1.55), 0.02, m, mt, 4))
    p.append(rodr((0.95, -0.25, 1.55), (1.15, -0.25, 1.55), 0.025, "Wood", WOOD_T, 5))
    p.append((obj("rope", *torus(0.085, 0.025, 8, 3), "Cloth", col([0.75, 0.62, 0.42], 4996, 0.06), tile=0.3), T(0, 0, 1.55) @ R(math.pi / 2, "Y")))
    p.append(rodr((0.0, -0.08, 1.48), (0.0, -0.08, 1.0), 0.012, "Cloth", col([0.75, 0.62, 0.42], 4997, 0.06), 4))
    bv, bf = lathe([(0.0, 0.0), (0.13, 0.0), (0.16, 0.22), (0.13, 0.22), (0.11, 0.03), (0.0, 0.03)], 8)
    p.append((obj("bucket", bv, bf, "Wood", wt, tile=0.3, sa=50), T(0.0, -0.08, 0.76)))
    p.append((obj("bail", *torus(0.15, 0.012, 8, 3), m, mt, tile=0.2), T(0.0, -0.08, 0.98) @ R(math.pi / 2, "X")))
    if evil: p += grp(skull(4998, 0.18, 0.14, 0.17, eye_big=1.35), T(0, -0.72, 2.25) @ R(0, "Z"))
    else:
        v, f = L.crystal_point(0.45, 0.09); p.append((obj("fin", v, f, "Crystal", None, tile=0.4, sa=20), T(0, 0, zr + hw * s + 0.1)))
    piece(f"{pre}_Well", p)

def build_lantern(pre):
    st = STYLES[pre]; evil = pre == "G"; m, mt = st["metal"], st["metal_t"]; wt = DARKWOOD_T if evil else WOOD_T
    p = []
    with side_stone(st["lo"]): p.append((L.block(5001, 0.4, 0.4, 0.25, 0.03, seg=(1, 1, 1), tone=st["lo_t"]), T(0, 0, 0.1)))
    if evil: p.append(tube2([(0, 0, 0.2), (0.04, 0, 1.3), (-0.03, 0, 2.6)], 0.075, 0.055, "Bone", BONE_T, 6, 2, wob=0.12))
    else: p.append((cyl(0.07, 2.45, "Wood", wt, seg=7, r1=0.055), T(0, 0, 0.2)))
    p.append(beam((0, 0, 2.45), (0, -0.62, 2.45), 0.07, "Wood" if not evil else "Bone", wt if not evil else BONE_T))
    p.append(beam((0, 0, 2.05), (0, -0.4, 2.45), 0.05, "Wood" if not evil else "Bone", wt if not evil else BONE_T))
    p += grp(lantern(m, mt, st["lamp"], 1.0), T(0, -0.55, 2.42))
    if evil: p += grp(skull(5002, 0.1, 0.08, 0.1, eye_big=1.3), T(0, 0, 2.66))
    else: p.append((obj("top", *lathe([(0.0, 0.0), (0.09, 0.0), (0.0, 0.16)], 6), m, mt, tile=0.2), T(0, 0, 2.62)))
    ob = piece(f"{pre}_Lantern", p)
    anchor(f"{pre}_Lantern_Light", (0.0, -0.55, 2.15), ob)

# ----------------------------------------------------------------------------------------------
BUILDERS = {}
for _pre in ("D", "G"):
    BUILDERS[f"{_pre}_Workshop"] = (lambda q: (lambda: build_workshop(q)))(_pre)
    BUILDERS[f"{_pre}_Stores"] = (lambda q: (lambda: build_stores(q)))(_pre)
    BUILDERS[f"{_pre}_Cottage"] = (lambda q: (lambda: build_cottage(q, "A")))(_pre)
    BUILDERS[f"{_pre}_CottageB"] = (lambda q: (lambda: build_cottage(q, "B")))(_pre)
    BUILDERS[f"{_pre}_Well"] = (lambda q: (lambda: build_well(q)))(_pre)
    BUILDERS[f"{_pre}_Lantern"] = (lambda q: (lambda: build_lantern(q)))(_pre)

def build(which=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = K.build_materials()
    for k, f in BUILDERS.items():
        if which and k not in which: continue
        t = time.time(); f(); print(k, round(time.time() - t, 1), "s", flush=True)
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None and ob.name[:2] not in ("D_", "G_"): bpy.data.objects.remove(ob)
    return lum

if __name__ == "__main__":
    which = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    lum = build(which)
    glb = os.path.join(HERE, "backtown_kit.glb"); B.export_glb(glb); B.pack_colors(glb)
    rep = L.inspect(glb); rep["anchors"] = K.anchors_report(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]), json.dumps(rep["anchors"]))
