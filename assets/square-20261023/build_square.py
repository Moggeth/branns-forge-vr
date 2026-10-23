"""Brann's Forge - town square kit (training ring, bakery cart, bard's stage, welcome board, string-light pole),
2026-10-23. Deterministic Blender (bpy 4.5).

Run (no Blender install needed):
  pip install bpy==4.5.*
  python3 build_square.py                # writes square_kit.glb, textures/, build_report.json here
  cp square_kit.glb ../../multiplayer/public/assets/square_kit.glb
  python3 render_square.py               # Cycles turnarounds of every piece in renders/

Same conventions as ../backtown-20261008/build_backtown.py (whose crates, sacks and shell helpers this imports) and
../town-20261007/build_town.py (materials, AO bake, face culling): every piece is modelled at the origin, foot centre on
the ground, FRONT facing Blender -Y (three.js +Z), D_ for Dawnhold (party), G_ for Grumblekeep (rivals), true size.
The game places them round the keep's heart from multiplayer/shared/town-square.js; their solids match SQUARE_SOLIDS.
Positions below are three.js (x right, y up, z toward the front):
  *_Trainer    training ring 5 x 3.4: sanded floor, rope ring on posts round the back, weapon rack (0, -1.35),
               talent board on an easel (-1.75, -0.95), banner, lantern post (2.15, -1.25), stool and bucket
               anchors *_Trainer_Dummy0 (-1.25, 0, 0.35)  *_Trainer_Dummy1 (1.25, 0, 0.45)  *_Trainer_Coach (0.2, 0, -0.45)
  *_Dummy      a straw practice dummy on a sprung post, origin at its foot (the game rocks it about there when struck)
  *_Bakery     a baker's cart under a striped awning beside a little domed bread oven (-2.0, -0.5) r 0.75; cart bed
               3 x 1.5 centred (0.4, -0.1), counter front z = 0.75 at 1.0 m; toffee apples on sticks in a block
               anchors *_Bakery_Counter (0.4, 1.0, 0.75)  *_Bakery_Baker (0.4, 0, -1.25)  *_Bakery_Oven (-2.0, 0.55, 0.15)
  *_Stage      the bard's round stage r 1.6, 0.4 high, two steps at the front, an arched frame with bunting and lanterns
               anchor  *_Stage_Bard (0, 0.4, -0.25)  *_Stage_Hat (0.95, 0, 1.75)
  *_Board      welcome board: two posts, a shingle roof, a painted valley map and notices, a signpost with arrows
               anchor  *_Board_Face (0, 1.35, 0.12)
  *_LightPole  a 4.3 m ribboned pole with a brass finial; string lights are drawn by the game from its top
               anchor  *_LightPole_Top (0, 4.1, 0)
"""
import math, os, sys, json, time
import numpy as np

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backtown-20261008"))
sys.path.insert(0, os.path.join(HERE, "..", "town-20261007"))
import build_backtown as BT  # noqa: E402  (imports the town kit as BT.K, the bases kit as BT.B, landmarks as BT.L)
K, L, B = BT.K, BT.L, BT.B
L.TEXDIR = os.path.join(HERE, "textures"); os.makedirs(L.TEXDIR, exist_ok=True)
from build_town import (obj, lathe, torus, bbox, beam, rodr, tube2, blob, slab, cyl, prism, sheet, grp, col, STYLES,  # noqa: E402
                        WOOD_T, DARKWOOD_T, BRASS_T, IRON_T, BONE_T, PLANK_T, T, R, bipyramid, anchor, side_stone,
                        keg, lantern, flag, sign_board, sun_disc, skull, coin_stack, coin_pile, awning, bunting, piece,
                        basalt_tone, STONE_T, Matrix, TAU)
import bpy  # noqa: E402

GOLD = [0.95, 0.78, 0.36]; CREAM = [0.98, 0.94, 0.84]; RED = [0.86, 0.2, 0.16]; APPLE = [0.88, 0.16, 0.12]
STRAW = lambda p, n: np.clip(np.stack([0.9 + 0.1 * np.sin(p[:, 2] * 70 + p[:, 0] * 25) + 0.05 * np.sin(p[:, 1] * 41)] * 3, -1) * np.array([0.96, 0.8, 0.44]), 0, 1)
SAND = lambda p, n: np.clip(np.stack([0.86 + 0.06 * np.sin(p[:, 0] * 9.1 + p[:, 1] * 4.3) + 0.04 * np.sin(p[:, 1] * 17)] * 3, -1) * np.array([0.93, 0.84, 0.66]), 0, 1)

# Per side: Dawnhold is blue, cream and brass with sun sigils; Grumblekeep purple, toad green, iron and bone.
SIDE = {
    "D": dict(metal="Brass", mt=BRASS_T, wood=WOOD_T, dark=DARKWOOD_T, cloth=[0.16, 0.32, 0.78], sigil=GOLD, stripes=[[0.86, 0.22, 0.2], CREAM],
              stage_stripes=[[0.16, 0.32, 0.78], CREAM, GOLD], lamp="Glass", gem="Crystal", base="Stone", base_t=STONE_T(7001),
              bunt=[[0.16, 0.32, 0.78], GOLD, [1.0, 1.0, 1.0], [0.86, 0.22, 0.2], [0.31, 0.6, 0.33]], ribbon=[[0.16, 0.32, 0.78], GOLD]),
    "G": dict(metal="Iron", mt=IRON_T, wood=DARKWOOD_T, dark=DARKWOOD_T, cloth=[0.3, 0.11, 0.44], sigil=[0.62, 0.95, 0.35], stripes=[[0.42, 0.8, 0.26], [0.42, 0.18, 0.56]],
              stage_stripes=[[0.42, 0.18, 0.56], [0.42, 0.8, 0.26], [0.2, 0.18, 0.2]], lamp="GlassOoze", gem="Ooze", base="Basalt", base_t=basalt_tone(7101),
              bunt=[[0.42, 0.18, 0.56], [0.56, 0.9, 0.3], [0.25, 0.2, 0.24], [0.95, 0.6, 0.2]], ribbon=[[0.42, 0.18, 0.56], [0.56, 0.9, 0.3]]),
}

def post(x, y, h, s, r=0.07, cap=True):
    p = [(cyl(r, h, "Wood", s["wood"], seg=7), T(x, y, 0))]
    if cap: p.append((blob(r * 1.4, r * 1.4, r * 1.2, s["metal"], s["mt"], 6, 4), T(x, y, h + 0.02)))
    return p

def rope(a, b, sag, seed):
    a, b = np.array(a, float), np.array(b, float)
    pts = [tuple(a + (b - a) * t + np.array([0, 0, -sag * math.sin(t * math.pi)])) for t in np.linspace(0, 1, 6)]
    return tube2(pts, 0.025, 0.025, "Cloth", col([0.82, 0.68, 0.45], seed, 0.05), 5, 2)

# ----------------------------------------------------------------------------------------------
# training ring
# ----------------------------------------------------------------------------------------------
def dummy(pre, seed):
    """A straw practice dummy, origin at its foot: a stout post in an iron shoe, cross arms, a bound straw body, a sack
    head with a painted goofy face (D: a pot helmet; G: floppy goblin ears and a dented pail), a little target shield
    on one arm. Faces -Y."""
    s = SIDE[pre]; p = []
    p.append((cyl(0.2, 0.12, s["metal"], s["mt"], seg=8, r1=0.16), Matrix()))
    p.append((cyl(0.065, 1.5, "Wood", s["wood"], seg=7), T(0, 0, 0.1)))
    p.append((cyl(0.24, 0.62, "Cloth", STRAW, seg=10, r1=0.2), T(0, 0, 0.72)))                 # straw body
    for z in (0.82, 1.18): p.append((K.obj("band", *torus(0.235, 0.022, 10, 3), "Cloth", col([0.55, 0.35, 0.2], seed, 0.05), tile=0.3), T(0, 0, z)))
    for k in range(9):  # straw tufts poking out at the bottom
        a = k / 9 * TAU; p.append((K.obj("tuft", *lathe([(0.0, 0.0), (0.03, 0.0), (0.0, 0.14)], 4), "Cloth", STRAW, tile=0.2), T(0.22 * math.cos(a), 0.22 * math.sin(a), 0.74) @ R(math.pi, "X") @ R(0.4 * math.cos(a), "Y") @ R(-0.4 * math.sin(a), "X")))
    p.append(beam((-0.55, 0, 1.2), (0.55, 0, 1.2), 0.07, "Wood", s["wood"]))                 # arms
    for sx in (-1, 1): p.append((blob(0.09, 0.08, 0.08, "Cloth", STRAW, 6, 4), T(sx * 0.58, 0, 1.2)))
    hz = 1.52
    p.append((blob(0.2, 0.18, 0.22, "Cloth", col([0.84, 0.72, 0.5], seed + 1, 0.06), 10, 7), T(0, 0, hz)))  # sack head
    p.append(tube2([(-0.13, -0.06, hz - 0.18), (0.0, -0.1, hz - 0.21), (0.13, -0.06, hz - 0.18)], 0.025, 0.025, "Cloth", col([0.55, 0.35, 0.2], seed + 2, 0.05), 4, 1))  # neck tie
    for sx, big in ((-1, 1.0), (1, 1.35)):  # painted eyes, one bigger: goofy
        p.append((blob(0.04 * big, 0.012, 0.045 * big, "Plaster", col([0.98, 0.97, 0.94], seed + 3, 0.02), 7, 4), T(sx * 0.075, -0.175, hz + 0.04)))
        p.append((blob(0.018 * big, 0.01, 0.02 * big, "Iron", col([0.12, 0.1, 0.1], seed + 4, 0.02), 6, 3), T(sx * 0.075 + 0.006, -0.186, hz + 0.035)))
    p.append(tube2([(-0.07, -0.17, hz - 0.07), (0.0, -0.185, hz - 0.1), (0.07, -0.17, hz - 0.06)], 0.012, 0.012, "Cloth", col([0.75, 0.2, 0.15], seed + 5, 0.04), 4, 2))  # grin
    p.append((blob(0.03, 0.02, 0.03, "Cloth", col([0.95, 0.55, 0.45], seed + 6, 0.04), 5, 3), T(-0.12, -0.16, hz - 0.03)))
    for k, (dx, dz) in enumerate(((0.07, 0.06), (-0.05, 0.13))):  # stitched patch
        p.append((bbox(0.05, 0.01, 0.006, "Cloth", col([0.3, 0.2, 0.12], seed + 7, 0.03)), T(0.11 + dx * 0.2, -0.155, hz + 0.12 + dz * 0.2) @ R(0.5 + k, "Y")))
    if pre == "D":  # an upturned cooking pot for a helmet, with a ladle-handle plume
        p.append((K.obj("pot", *lathe([(0.0, 0.2), (0.17, 0.2), (0.215, 0.12), (0.225, 0.0), (0.24, -0.01), (0.0, -0.01)], 12), "Iron", col([0.38, 0.38, 0.42], seed + 8, 0.06), tile=0.3), T(0, 0, hz + 0.1) @ R(0.12, "X")))
        p.append(rodr((0.18, 0, hz + 0.22), (0.4, 0, hz + 0.32), 0.016, "Iron", IRON_T, 5))
        p.append((K.obj("feather", np.array([[0, 0, 0], [0.05, 0.0, 0.2], [0.0, 0.0, 0.42], [-0.05, 0.0, 0.2]], float), [[0, 1, 2, 3]], "Cloth", col([0.86, 0.22, 0.2], seed + 9, 0.04), tile=0.2), T(0, 0.05, hz + 0.28) @ R(-0.35, "X")))
    else:  # floppy goblin ears and a dented pail
        for sx in (-1, 1): p.append((K.obj("ear", *lathe([(0.0, 0.0), (0.07, 0.0), (0.05, 0.12), (0.0, 0.3)], 6), "Cloth", col([0.55, 0.8, 0.3], seed + 10, 0.06), tile=0.2), T(sx * 0.18, 0, hz + 0.02) @ R(-sx * 1.9, "Y")))
        p.append((K.obj("pail", *lathe([(0.0, 0.16), (0.14, 0.16), (0.2, -0.01), (0.0, -0.01)], 9), "Iron", col([0.4, 0.38, 0.36], seed + 11, 0.08), tile=0.3), T(0.02, 0, hz + 0.12) @ R(-0.2, "Y")))
    # a target shield tied on the left arm
    p.append((K.obj("tgt", *lathe([(0.0, 0.0), (0.22, 0.0), (0.24, 0.03), (0.0, 0.05)], 12), "Wood", col(s["cloth"], seed + 12, 0.06), tile=0.3), T(-0.52, -0.08, 1.08) @ R(math.pi / 2, "X")))
    for k, (rr, c) in enumerate(((0.16, CREAM), (0.08, RED if pre == "D" else s["sigil"]))):
        p.append((K.obj("ring", *lathe([(0.0, 0.0), (rr, 0.0), (rr, 0.008), (0.0, 0.008)], 12), "Plaster", col(c, seed + 13 + k, 0.03), tile=0.3), T(-0.52, -0.13 - 0.003 * k, 1.08) @ R(math.pi / 2, "X")))
    return p

def weapon_rack(s, seed):
    """A-frame rack at the back of the ring, the five practice weapons a Hero trains with, faces -Y."""
    p = []
    for sx in (-1, 1):
        p.append(beam((sx * 1.0, -0.25, 0.0), (sx * 0.95, 0.0, 1.45), 0.08, "Wood", s["wood"]))
        p.append(beam((sx * 1.0, 0.25, 0.0), (sx * 0.95, 0.0, 1.45), 0.08, "Wood", s["wood"]))
    p.append(beam((-1.05, 0.0, 1.42), (1.05, 0.0, 1.42), 0.09, "Wood", s["dark"]))
    p.append(beam((-1.0, -0.12, 0.35), (1.0, -0.12, 0.35), 0.06, "Wood", s["wood"]))
    xs = np.linspace(-0.72, 0.72, 5)
    for k, x in enumerate(xs):
        p.append(rodr((x, -0.04, 1.42), (x, -0.16, 1.44), 0.018, s["metal"], s["mt"], 4))
        h = 1.05; top = 1.38
        p.append((cyl(0.026, h, "Wood", col([0.75, 0.55, 0.36], seed + k, 0.08), seg=6), T(x, -0.14, top - h) @ R(0.05 * (k - 2), "Y")))
        hx = x + 0.05 * (k - 2) * 0.0
        if k == 0:   # axe
            p.append((K.obj("axe", *lathe([(0.0, 0.0), (0.04, 0.0), (0.04, 0.24), (0.0, 0.24)], 4), "Iron", IRON_T, tile=0.2), T(hx + 0.02, -0.16, top - 0.28)))
            p.append((prism([(0.0, 0.0), (0.2, -0.06), (0.22, 0.3), (0.0, 0.24)], -0.01, 0.01, "Iron", col([0.72, 0.74, 0.78], seed + 20, 0.05)), T(hx + 0.03, -0.16, top - 0.3)))
        elif k == 1:  # pick
            p.append(tube2([(hx - 0.3, -0.16, top - 0.1), (hx, -0.16, top - 0.02), (hx + 0.3, -0.16, top - 0.1)], 0.03, 0.012, "Iron", col([0.72, 0.74, 0.78], seed + 21, 0.05), 5, 2))
        elif k == 2:  # hammer
            p.append((bbox(0.3, 0.14, 0.14, "Iron", col([0.6, 0.6, 0.64], seed + 22, 0.05), bev=0.02), T(hx, -0.16, top - 0.06)))
        elif k == 3:  # a little crossbow
            p.append(tube2([(hx - 0.25, -0.16, top - 0.15), (hx, -0.16, top - 0.06), (hx + 0.25, -0.16, top - 0.15)], 0.02, 0.012, s["metal"], s["mt"], 5, 2))
            p.append(rodr((hx - 0.25, -0.17, top - 0.15), (hx + 0.25, -0.17, top - 0.15), 0.005, "Cloth", col([0.85, 0.75, 0.55], seed + 23, 0.04), 3))
        else:        # a staff with a crystal
            v, f = bipyramid(0.05, 0.05, 0.09, 5); p.append((K.obj("gem", v, f, s["gem"], None, tile=0.2, sa=20), T(hx, -0.14, top + 0.04)))
            p.append((K.obj("claw", *torus(0.045, 0.012, 8, 3), s["metal"], s["mt"], tile=0.2), T(hx, -0.14, top - 0.03)))
    return p

def talent_board(s, seed, evil):
    """The trainer's talent tree, chalked on a slate on an easel: three branches of star pips (the first few lit with
    crystal), linked by chalk lines; a chalk stub and a duster on the ledge. Faces -Y, origin at the easel's feet."""
    p = []
    for sx in (-1, 1): p.append(beam((sx * 0.42, 0.12, 0.0), (sx * 0.34, 0.0, 1.75), 0.055, "Wood", s["wood"]))
    p.append(beam((0.0, 0.2, 0.0), (0.0, 0.05, 1.55), 0.05, "Wood", s["wood"]))
    p.append((bbox(0.95, 0.06, 0.05, "Wood", s["dark"]), T(0, -0.06, 0.72)))                   # ledge
    p.append((bbox(0.9, 0.04, 0.95, "Slate", col([0.2, 0.24, 0.22] if not evil else [0.2, 0.17, 0.22], seed, 0.05), bev=0.0), T(0, -0.02, 1.22)))
    for z in (0.74, 1.7): p.append((bbox(0.98, 0.07, 0.06, "Wood", s["wood"]), T(0, -0.03, z)))
    for x in (-0.47, 0.47): p.append((bbox(0.06, 0.07, 1.0, "Wood", s["wood"]), T(x, -0.03, 1.22)))
    chalk = col([0.95, 0.95, 0.9], seed + 1, 0.03)
    cols = (-0.28, 0.0, 0.28)
    for c, x in enumerate(cols):
        zs = (0.88, 1.12, 1.36, 1.58)
        for r, z in enumerate(zs):
            lit = r <= (2 - c)  # some branches further along than others
            v, f = bipyramid(0.045, 0.045, 0.02, 5)
            p.append((K.obj("pip", v, f, s["gem"] if lit else "Plaster", None if lit else chalk, tile=0.2, sa=20), T(x, -0.06, z) @ R(math.pi / 2, "X")))
            if r: p.append((bbox(0.012, 0.004, zs[r] - zs[r - 1] - 0.09, "Plaster", chalk), T(x, -0.045, (z + zs[r - 1]) / 2)))
    p.append((bbox(0.6, 0.004, 0.012, "Plaster", chalk), T(0, -0.045, 0.8)))
    p.append((bbox(0.06, 0.03, 0.025, "Plaster", chalk), T(-0.25, -0.08, 0.76)))
    p.append((bbox(0.14, 0.06, 0.05, "Cloth", col([0.6, 0.45, 0.3], seed + 2, 0.05)), T(0.25, -0.08, 0.77)))
    return p

def build_trainer(pre):
    s = SIDE[pre]; evil = pre == "G"; p = []
    # sanded practice floor, edged with a low curb of timbers
    p.append((K.obj("floor", *lathe([(0.0, 0.0), (2.35, 0.0), (2.35, 0.04), (0.0, 0.05)], 28), "Plaster", SAND, tile=1.2, sa=30), Matrix.Scale(1.05, 4) @ Matrix.Diagonal((1.0, 0.72, 1.0, 1.0))))
    n = 14
    for k in range(n):
        a0, a1 = k / n * TAU, (k + 1) / n * TAU
        p.append(beam((2.42 * math.cos(a0), 1.75 * math.sin(a0), 0.06), (2.42 * math.cos(a1), 1.75 * math.sin(a1), 0.06), 0.12, "Wood", s["dark"], h=0.12))
    # rope ring round the back on short posts
    ring = [(-2.3, 0.25), (-1.85, 1.1), (-0.65, 1.65), (0.65, 1.65), (1.85, 1.1), (2.3, 0.25)]
    for x, y in ring: p += post(x, y, 0.95, s, 0.06)
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]): p.append(rope((x0, y0, 0.88), (x1, y1, 0.88), 0.12, 7100))
    p += grp(weapon_rack(s, 7110), T(0.0, 1.35, 0.0))
    p += grp(talent_board(s, 7120, evil), T(-1.75, 0.95, 0.0) @ R(-0.35, "Z"))
    # banner on a pole by the rack, lantern post on the right
    p.append((cyl(0.05, 2.9, "Wood", s["wood"], seg=6), T(1.1, 1.7, 0.0)))
    p += grp(flag(0.6, 1.1, s["cloth"], s["sigil"], 7130, tatter=0.3 if evil else 0.0, metal=s["metal"], mt=s["mt"], emblem_kind=pre), T(1.1, 1.66, 2.8))
    p += post(2.15, 1.25, 2.2, s, 0.06)
    p.append(rodr((2.15, 1.25, 2.1), (2.15, 0.85, 2.1), 0.025, s["metal"], s["mt"], 5))
    p += grp(lantern(s["metal"], s["mt"], s["lamp"], 1.0), T(2.15, 0.85, 2.05))
    # the coach's stool, a water bucket with a dipper, a towel
    for k in range(3):
        a = k / 3 * TAU + 0.3; p.append(beam((0.55 + 0.17 * math.cos(a), 0.75 + 0.17 * math.sin(a), 0.0), (0.55 + 0.1 * math.cos(a), 0.75 + 0.1 * math.sin(a), 0.48), 0.04, "Wood", s["wood"]))
    p.append((cyl(0.2, 0.06, "Wood", s["dark"], seg=10), T(0.55, 0.75, 0.48)))
    p.append((bbox(0.36, 0.22, 0.02, "Cloth", col(s["cloth"], 7140, 0.04)), T(0.55, 0.75, 0.55) @ R(0.3, "Z")))
    p += grp(keg(0.17, 0.32, "Wood", s["wood"], s["metal"], s["mt"], 8), T(1.6, 0.55, 0.0))
    p.append((cyl(0.15, 0.01, "Plaster", col([0.45, 0.65, 0.8], 7141, 0.05), seg=8), T(1.6, 0.55, 0.3)))
    p.append(rodr((1.55, 0.5, 0.3), (1.45, 0.38, 0.55), 0.012, "Wood", s["wood"], 4))
    ob = piece(f"{pre}_Trainer", p)
    anchor(f"{pre}_Trainer_Dummy0", (-1.25, -0.35, 0.0), ob)
    anchor(f"{pre}_Trainer_Dummy1", (1.25, -0.45, 0.0), ob)
    anchor(f"{pre}_Trainer_Coach", (0.2, 0.45, 0.0), ob)
    return ob

def build_dummy(pre):
    return piece(f"{pre}_Dummy", dummy(pre, 7200 + (pre == "G")))

# ----------------------------------------------------------------------------------------------
# bakery cart
# ----------------------------------------------------------------------------------------------
def apple(seed, r=0.075, stick=False, s=None, glaze=False):
    """A shiny red apple (toffee-glazed and on a stick when asked), origin at its base."""
    c = col([0.72, 0.18, 0.08] if glaze else APPLE, seed, 0.08)
    p = [(K.obj("apple", *lathe([(0.0, 0.0), (r * 0.55, 0.0), (r, r * 0.6), (r * 0.92, r * 1.35), (r * 0.4, r * 1.62), (0.0, r * 1.5)], 9), "Plaster", c, tile=0.2, sa=60), Matrix())]
    p.append(rodr((0, 0, r * 1.45), (0.01, 0.005, r * 1.85), r * 0.08, "Wood", DARKWOOD_T, 4))
    if not glaze: p.append((K.obj("leaf", np.array([[0, 0, 0], [r * 0.4, 0.0, r * 0.12], [r * 0.7, 0.0, 0.0], [r * 0.4, 0.0, -r * 0.1]], float), [[0, 1, 2, 3]], "Cloth", col([0.3, 0.62, 0.2], seed + 1, 0.06), tile=0.2), T(0.01, 0.0, r * 1.75) @ R(0.4, "Y")))
    if stick: p.append(rodr((0, 0, -0.32), (0, 0, r * 0.4), 0.012, "Wood", col([0.92, 0.82, 0.62], seed + 2, 0.05), 4))
    return p

def loaf(seed, l=0.32):
    p = [(blob(l / 2, 0.11, 0.08, "Plaster", col([0.86, 0.6, 0.3], seed, 0.06), 9, 5), T(0, 0, 0.06))]
    for k in range(3): p.append((bbox(0.02, 0.18, 0.012, "Plaster", col([0.98, 0.9, 0.7], seed + 1, 0.03)), T(-l * 0.28 + k * l * 0.28, 0, 0.135) @ R(0.5, "Z")))
    return p

def pie(seed, r=0.16, evil=False):
    p = [(K.obj("dish", *lathe([(0.0, 0.0), (r * 0.85, 0.0), (r, 0.05), (r * 1.06, 0.055), (0.0, 0.05)], 12), "Plaster", col([0.88, 0.62, 0.32], seed, 0.05), tile=0.3), Matrix())]
    p.append((K.obj("fill", *lathe([(0.0, 0.0), (r * 0.95, 0.0), (r * 0.85, 0.035), (0.0, 0.045)], 12), "Plaster", col([0.5, 0.82, 0.3] if evil else [0.75, 0.2, 0.15], seed + 1, 0.05), tile=0.3), T(0, 0, 0.04)))
    for k in range(-2, 3):  # lattice
        p.append((bbox(0.02, r * 1.8 * math.sqrt(max(0.1, 1 - (k * 0.32) ** 2)), 0.012, "Plaster", col([0.95, 0.75, 0.42], seed + 2, 0.04)), T(k * r * 0.32, 0, 0.085)))
        p.append((bbox(r * 1.8 * math.sqrt(max(0.1, 1 - (k * 0.32) ** 2)), 0.02, 0.012, "Plaster", col([0.95, 0.75, 0.42], seed + 3, 0.04)), T(0, k * r * 0.32, 0.09)))
    return p

def wheel(r, s, seed):
    p = [(K.obj("rim", *torus(r, 0.045, 18, 5), "Wood", s["wood"], tile=0.4), R(math.pi / 2, "Y"))]
    p.append((K.obj("tyre", *torus(r + 0.03, 0.02, 18, 4), "Iron", IRON_T, tile=0.4), R(math.pi / 2, "Y")))
    p.append((cyl(0.09, 0.2, s["metal"], s["mt"], seg=8), T(-0.1, 0, 0) @ R(math.pi / 2, "Y")))
    for k in range(8):
        a = k / 8 * TAU; p.append(rodr((0, 0, 0), (0, r * math.cos(a), r * math.sin(a)), 0.022, "Wood", s["wood"], 5))
    return p

def oven(s, seed, evil):
    """A little domed bread oven on a stone base: an arched mouth glowing with embers, a stubby chimney, a peel."""
    p = []
    with side_stone(s["base"]): p.append((L.block(seed, 1.3, 1.3, 0.55, 0.05, seg=(2, 2, 1), tone=s["base_t"]), T(0, 0, 0.0)))
    p.append((K.obj("dome", *lathe([(0.66, 0.0), (0.64, 0.25), (0.52, 0.55), (0.3, 0.75), (0.0, 0.82)], 14), "Plaster", col([0.82, 0.5, 0.32] if not evil else [0.45, 0.38, 0.36], seed + 1, 0.08), tile=0.6, sa=40), T(0, 0, 0.55)))
    p.append((K.obj("mouth", *lathe([(0.0, 0.0), (0.26, 0.0), (0.26, 0.2), (0.0, 0.34)], 10), "Ember" if not evil else "Ooze", None, tile=0.3), T(0, -0.58, 0.58) @ R(math.pi / 2, "X") @ Matrix.Diagonal((1.0, 1.0, 0.25, 1.0))))
    p.append((K.obj("arch", *torus(0.3, 0.05, 12, 4), "Stone" if not evil else "Basalt", s["base_t"], tile=0.3), T(0, -0.6, 0.6) @ R(math.pi / 2, "X")))
    p.append((cyl(0.12, 0.55, "Stone" if not evil else "Basalt", s["base_t"], seg=8, r1=0.09), T(0.2, 0.25, 1.15)))
    p.append(rodr((0.55, -0.55, 0.0), (0.7, -0.3, 1.3), 0.02, "Wood", s["wood"], 4))
    p.append((bbox(0.26, 0.02, 0.3, "Wood", s["wood"]), T(0.71, -0.28, 1.4) @ R(0.2, "X")))
    for k in range(3): p += grp(loaf(seed + 10 + k, 0.24), T(-0.35 + 0.1 * k, -0.42, 0.55) @ R(0.5 * k, "Z"))
    return p

def build_bakery(pre):
    s = SIDE[pre]; evil = pre == "G"; p = []
    cx, cy = 0.4, 0.1   # cart bed centre (Blender y; three z = -0.1)
    # cart: plank bed with side boards, two big wheels, shafts propped on a trestle
    p.append(slab(cx - 1.5, cx + 1.5, cy - 0.75, cy + 0.75, 0.62, 0.72, "Wood", s["wood"], chip=0.0, step=1.0))
    for sy in (-1, 1): p.append((bbox(3.0, 0.06, 0.28, "Wood", PLANK_T if evil else col([0.82, 0.6, 0.4], 7301, 0.08)), T(cx, cy + sy * 0.75, 0.86)))
    for sx in (-1, 1): p.append((bbox(0.06, 1.5, 0.28, "Wood", s["wood"]), T(cx + sx * 1.5, cy, 0.86)))
    p.append((bbox(3.1, 0.12, 0.1, "Wood", s["dark"]), T(cx, cy - 0.81, 1.02)))                 # counter rail on the front
    for k in range(5): p.append((bbox(0.08, 0.05, 0.3, "Wood", s["dark"]), T(cx - 1.4 + k * 0.7, cy - 0.79, 0.86)))
    for sx in (-1, 1): p += grp(wheel(0.55, s, 7310 + sx), T(cx + sx * 0.7, cy + 0.85, 0.55) @ R(math.pi / 2, "Z"))
    for sx in (-1, 1): p.append(beam((cx + 1.45, cy + sx * 0.5, 0.66), (cx + 2.4, cy + sx * 0.45, 0.25), 0.07, "Wood", s["wood"]))
    p.append(beam((cx + 2.3, cy - 0.55, 0.22), (cx + 2.3, cy + 0.55, 0.22), 0.07, "Wood", s["wood"]))
    for sy in (-1, 1): p.append(beam((cx + 2.3, cy + sy * 0.5, 0.0), (cx + 2.3, cy + sy * 0.5, 0.25), 0.06, "Wood", s["wood"]))
    p.append(beam((cx - 1.4, cy - 0.6, 0.0), (cx - 1.4, cy - 0.6, 0.62), 0.07, "Wood", s["wood"]))   # front prop legs
    p.append(beam((cx - 1.4, cy + 0.6, 0.0), (cx - 1.4, cy + 0.6, 0.62), 0.07, "Wood", s["wood"]))
    # wares on the bed: a crate of apples, toffee apples on sticks in a block, loaves, pies, a jar of honey
    p += grp(BT.crate(0.5, 7320, s["wood"], s["metal"], s["mt"]), T(cx - 0.95, cy + 0.2, 0.72))
    rr = np.random.default_rng(7321)
    for k in range(10):
        a = rr.random() * TAU; d = rr.random() * 0.17
        p += grp(apple(7330 + k, 0.07), T(cx - 0.95 + d * math.cos(a), cy + 0.2 + d * math.sin(a), 1.2 + 0.03 * (k % 3)) @ R(rr.random() * 6, "Z"))
    p.append((bbox(0.5, 0.26, 0.14, "Wood", s["dark"], bev=0.02), T(cx - 0.15, cy - 0.38, 0.79)))  # the toffee-apple block
    for k in range(6):
        x = cx - 0.35 + (k % 3) * 0.2; y = cy - 0.44 + (k // 3) * 0.12
        p += grp(apple(7340 + k, 0.065, stick=True, glaze=True), T(x, y, 1.18) @ R((k - 2.5) * 0.06, "Y"))
    for k in range(3): p += grp(loaf(7350 + k), T(cx + 0.55, cy - 0.45 + k * 0.33, 0.72) @ R(0.2 * k, "Z"))
    for k in range(2): p += grp(pie(7360 + k, evil=evil), T(cx + 1.05, cy - 0.35 + k * 0.45, 0.72))
    p.append((K.obj("jar", *lathe([(0.0, 0.0), (0.08, 0.0), (0.09, 0.12), (0.06, 0.16), (0.065, 0.19), (0.0, 0.19)], 8), "Plaster", col([0.95, 0.68, 0.18] if not evil else [0.55, 0.9, 0.3], 7370, 0.05), tile=0.2), T(cx + 0.15, cy + 0.45, 0.72)))
    p += grp(BT.sack(7371, (0.92, 0.86, 0.72), 0.9), T(cx + 1.15, cy + 0.42, 0.72))
    # striped awning on four poles over the cart (front edge z 2.3, back 2.75), a chalk menu board hanging on the front
    for sx in (-1, 1):
        p.append((cyl(0.045, 1.8, "Wood", s["wood"], seg=6), T(cx + sx * 1.55, cy - 0.8, 0.62)))
        p.append((cyl(0.045, 2.2, "Wood", s["wood"], seg=6), T(cx + sx * 1.55, cy + 0.8, 0.62)))
    p += awning(cx - 1.7, cx + 1.7, cy + 0.85, 2.8, cy - 1.15, 2.4, 7, s["stripes"], 7380, tatter=0.5 if evil else 0.0, drop=0.28)
    sb = sign_board(0.9, 0.5, col([0.2, 0.22, 0.2], 7390, 0.05), "Wood", s["wood"])
    chalk = col([0.95, 0.95, 0.9], 7391, 0.03)
    sb += grp(apple(7392, 0.09), T(-0.25, -0.06, -0.38) @ R(math.pi / 2, "X") @ Matrix.Diagonal((1, 1, 0.3, 1)))
    for k in range(3): sb.append((bbox(0.38 - 0.08 * k, 0.004, 0.025, "Plaster", chalk), T(0.15, -0.045, -0.15 - 0.1 * k)))
    p += grp(sb, T(cx, cy - 1.2, 2.25))
    for sx in (-1, 1): p.append(rodr((cx + sx * 0.42, cy - 1.18, 2.38), (cx + sx * 0.42, cy - 1.18, 2.25), 0.01, "Iron", IRON_T, 3))
    p += grp(lantern(s["metal"], s["mt"], s["lamp"], 0.9), T(cx + 1.4, cy - 0.95, 2.3))
    # the bread oven on the left, warm and glowing
    p += grp(oven(s, 7400, evil), T(-2.0, 0.5, 0.0))
    # barrels and a basket of apples by the wheel
    p += grp(keg(0.26, 0.6, "Wood", s["wood"], s["metal"], s["mt"]), T(cx + 1.95, cy + 0.9, 0.0))
    p.append((K.obj("basket", *lathe([(0.0, 0.0), (0.2, 0.0), (0.26, 0.24), (0.0, 0.22)], 10), "Cloth", STRAW, tile=0.3), T(-1.05, -0.95, 0.0)))
    for k in range(6): p += grp(apple(7410 + k, 0.065), T(-1.05 + 0.1 * math.cos(k), -0.95 + 0.1 * math.sin(k), 0.2 + 0.03 * (k % 2)))
    ob = piece(f"{pre}_Bakery", p)
    anchor(f"{pre}_Bakery_Counter", (cx, -0.85, 1.0), ob)
    anchor(f"{pre}_Bakery_Baker", (cx, 1.25 - 0.1, 0.0), ob)
    anchor(f"{pre}_Bakery_Oven", (-2.0, -0.15 + 0.5 - 0.5, 0.55), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# bard's stage
# ----------------------------------------------------------------------------------------------
def build_stage(pre):
    s = SIDE[pre]; evil = pre == "G"; p = []; R0, H = 1.6, 0.4
    with side_stone(s["base"]): p.append((K.obj("skirt", *lathe([(R0 + 0.06, 0.0), (R0 + 0.02, H - 0.08), (0.0, H - 0.08)], 24), s["base"], s["base_t"], tile=0.8), Matrix()))
    p.append((K.obj("deck", *lathe([(0.0, 0.0), (R0 + 0.05, 0.0), (R0 + 0.05, 0.08), (0.0, 0.08)], 24), "Wood", PLANK_T, tile=0.8), T(0, 0, H - 0.08)))
    p.append((K.obj("rim", *torus(R0 + 0.05, 0.04, 24, 4), "Wood", s["dark"], tile=0.4), T(0, 0, H)))
    for k in range(2):  # two steps at the front
        p.append(slab(-0.6, 0.6, -R0 - 0.35 - 0.3 * (1 - k), -R0 + 0.2, 0.0, H * (k + 1) / 3 + 0.02, "Wood", s["wood"], chip=0.0, step=1.0))
    # arched frame across the back: two posts and a bent timber, bunting swagged off it, three hanging lanterns
    for sx in (-1, 1): p.append((cyl(0.08, 2.55, "Wood", s["wood"], seg=7), T(sx * 1.3, 0.85, H)))
    arch = [(-1.3, 0.85, H + 2.5), (-0.7, 0.85, H + 2.95), (0.0, 0.85, H + 3.1), (0.7, 0.85, H + 2.95), (1.3, 0.85, H + 2.5)]
    p.append(tube2(arch, 0.09, 0.09, "Wood", s["dark"], 6, 3))
    p += bunting((-1.3, 0.78, H + 2.45), (1.3, 0.78, H + 2.45), 0.45, 9, s["bunt"], 7500, size=0.24)
    p += bunting((-1.3, 0.8, H + 1.9), (-2.4, -0.5, H + 0.1), 0.3, 6, s["bunt"], 7510, size=0.22)
    p += bunting((1.3, 0.8, H + 1.9), (2.4, -0.5, H + 0.1), 0.3, 6, s["bunt"], 7520, size=0.22)
    for sx in (-1, 1): p += post(sx * 2.4, -0.5, 0.55, s, 0.05)
    for x in (-0.7, 0.0, 0.7):
        z = H + (3.0 if x == 0 else 2.85)
        p.append(rodr((x, 0.85, z), (x, 0.85, z - 0.35), 0.01, "Iron", IRON_T, 3))
        p += grp(lantern(s["metal"], s["mt"], s["lamp"], 0.85), T(x, 0.85, z - 0.35))
    # backdrop: a painted cloth hung between the posts (D sun over hills, G a grinning moon)
    def f(u, v):
        x = -1.22 + 2.44 * u; z = H + 2.35 - 2.0 * v
        return (x, 0.92 + 0.04 * math.sin(u * 9) * v, z)
    p.append(sheet(8, 6, f, "Cloth", col(s["cloth"], 7530, 0.05), tile=0.5))
    if not evil: p += grp(sun_disc(0.42, rays=12), T(0, 0.88, H + 1.55))
    else: p += grp(skull(7531, 0.32, 0.12, 0.3, eye_big=1.3, eyes="Ooze", seg=10, rings=7), T(0, 0.86, H + 1.5))
    for k, (x, h) in enumerate(((-0.8, 0.35), (-0.3, 0.55), (0.3, 0.42), (0.85, 0.3))):  # rolling hills
        p.append((K.obj("hill", *lathe([(0.0, 0.0), (0.45, 0.0), (0.0, h)], 10), "Cloth", col([0.3, 0.62, 0.28] if not evil else [0.36, 0.28, 0.4], 7540 + k, 0.06), tile=0.3), T(x, 0.9, H + 0.4) @ R(math.pi / 2, "X") @ Matrix.Diagonal((1.0, 1.0, 0.04, 1.0))))
    # instruments and furniture: a drum, a stool, a music stand, a horn on a hook; the hat for tips at the foot of the steps
    p.append((cyl(0.24, 0.32, "Cloth", col([0.86, 0.22, 0.2] if not evil else [0.42, 0.18, 0.56], 7550, 0.05), seg=12), T(0.85, 0.25, H)))
    for z in (H + 0.02, H + 0.3): p.append((K.obj("hoop", *torus(0.245, 0.02, 12, 3), s["metal"], s["mt"], tile=0.3), T(0.85, 0.25, z)))
    p.append((cyl(0.235, 0.01, "Plaster", col(CREAM, 7551, 0.03), seg=12), T(0.85, 0.25, H + 0.32)))
    for k in range(2): p.append(rodr((0.75 + 0.2 * k, 0.1, H + 0.33), (0.7 + 0.35 * k, -0.05, H + 0.45), 0.012, "Wood", s["wood"], 4))
    for k in range(3):
        a = k / 3 * TAU; p.append(beam((-0.35 + 0.15 * math.cos(a), 0.15 + 0.15 * math.sin(a), H), (-0.35 + 0.08 * math.cos(a), 0.15 + 0.08 * math.sin(a), H + 0.5), 0.035, "Wood", s["wood"]))
    p.append((cyl(0.17, 0.05, "Wood", s["dark"], seg=10), T(-0.35, 0.15, H + 0.5)))
    p.append(rodr((-0.95, 0.3, H), (-0.95, 0.3, H + 1.05), 0.015, s["metal"], s["mt"], 4))
    p.append((bbox(0.36, 0.02, 0.26, s["metal"], s["mt"]), T(-0.95, 0.28, H + 1.1) @ R(-0.4, "X")))
    p.append((bbox(0.3, 0.005, 0.2, "Plaster", col(CREAM, 7552, 0.03)), T(-0.95, 0.265, H + 1.11) @ R(-0.4, "X")))
    p.append(tube2([(1.3, 0.75, H + 1.6), (1.15, 0.7, H + 1.45), (1.2, 0.66, H + 1.25), (1.4, 0.64, H + 1.18)], 0.02, 0.08, s["metal"], s["mt"], 8, 2))
    hat = (0.95, -1.75)
    p.append((K.obj("hat", *lathe([(0.0, 0.0), (0.26, 0.0), (0.27, 0.02), (0.16, 0.03), (0.15, 0.14), (0.0, 0.15)], 12), "Cloth", col([0.3, 0.2, 0.42] if not evil else [0.25, 0.4, 0.2], 7560, 0.05), tile=0.3), T(hat[0], -hat[1] * -1, 0.0) @ R(math.pi, "X") @ T(0, 0, -0.15)))
    p += grp(coin_pile(0.12, 0.05, 7561, 6), T(hat[0], -hat[1] * -1, 0.0))
    ob = piece(f"{pre}_Stage", p)
    anchor(f"{pre}_Stage_Bard", (0.0, 0.25, H), ob)
    anchor(f"{pre}_Stage_Hat", (hat[0], hat[1], 0.0), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# welcome board and signpost
# ----------------------------------------------------------------------------------------------
def arrow(w, h, board, s, seed, text_rgb):
    """A signpost arrow pointing +X, origin where it meets the post, faces -Y (readable from both sides)."""
    V = np.array([[0.0, -0.03, -h / 2], [w - h * 0.5, -0.03, -h / 2], [w, -0.03, 0.0], [w - h * 0.5, -0.03, h / 2], [0.0, -0.03, h / 2]], float)
    V = np.concatenate([V, V * np.array([1, -1, 1])]); n = 5
    F = [list(range(n)), list(range(n, 2 * n))[::-1]] + [[i, n + i, n + (i + 1) % n, (i + 1) % n] for i in range(n)]
    p = [(K.obj("arrow", V, F, "Wood", board, tile=0.4, sa=30), T(0.08, 0, 0))]
    for k in range(2): p.append((bbox(w * (0.55 - 0.15 * k), 0.07, 0.03, "Plaster", col(text_rgb, seed + k, 0.03)), T(0.08 + w * 0.42, 0, 0.04 - 0.08 * k)))
    p.append((blob(0.025, 0.04, 0.025, s["metal"], s["mt"], 5, 3), T(0.14, 0, 0)))
    return p

def build_board(pre):
    s = SIDE[pre]; evil = pre == "G"; p = []; W, Hb = 1.9, 1.25
    for sx in (-1, 1): p += post(sx * (W / 2 + 0.08), 0.0, 2.5, s, 0.09, cap=False)
    # shingle roof
    for sy in (-1, 1):
        V = np.array([[-W / 2 - 0.35, 0.0, 2.95], [W / 2 + 0.35, 0.0, 2.95], [W / 2 + 0.35, sy * 0.55, 2.55], [-W / 2 - 0.35, sy * 0.55, 2.55]], float)
        p.append((K.obj("roof", V, [[0, 1, 2, 3] if sy < 0 else [3, 2, 1, 0]], "Slate", K.moss_slate if not evil else col([0.62, 0.5, 0.75], 7601, 0.08), tile=0.6), Matrix()))
        for k in range(3): p.append((bbox(W + 0.75, 0.04, 0.03, "Slate", col([0.5, 0.55, 0.6] if not evil else [0.4, 0.3, 0.45], 7602 + k, 0.05)), T(0, sy * (0.12 + 0.15 * k), 2.88 - 0.12 * k)))
    p.append(rodr((-W / 2 - 0.35, 0.0, 2.96), (W / 2 + 0.35, 0.0, 2.96), 0.05, "Wood", s["dark"], 6))
    p.append(beam((-W / 2 - 0.08, 0.0, 2.5), (W / 2 + 0.08, 0.0, 2.5), 0.12, "Wood", s["wood"]))
    # the board: framed cork, a painted map of the valley (two keeps, the forge, the river) and pinned notices
    zc = 1.45
    p.append((bbox(W, 0.08, Hb, "Wood", col([0.72, 0.52, 0.32], 7610, 0.12)), T(0, 0.0, zc)))
    for dz in (-Hb / 2, Hb / 2): p.append((bbox(W + 0.12, 0.12, 0.08, "Wood", s["dark"]), T(0, 0, zc + dz)))
    for dx in (-W / 2, W / 2): p.append((bbox(0.08, 0.12, Hb + 0.08, "Wood", s["dark"]), T(dx, 0, zc)))
    mx, mz = -0.38, zc + 0.05
    p.append((bbox(0.95, 0.01, 0.8, "Plaster", col([0.95, 0.88, 0.68], 7611, 0.05)), T(mx, -0.05, mz)))
    p.append(tube2([(mx - 0.4, -0.058, mz + 0.3), (mx - 0.1, -0.058, mz + 0.1), (mx + 0.1, -0.058, mz - 0.05), (mx + 0.38, -0.058, mz - 0.3)], 0.018, 0.018, "Plaster", col([0.35, 0.6, 0.85], 7612, 0.04), 4, 2))
    for k, (x, z, c) in enumerate(((mx - 0.3, mz - 0.25, s["cloth"]), (mx + 0.3, mz + 0.25, [0.42, 0.18, 0.56] if not evil else [0.16, 0.32, 0.78]))):
        p.append((K.obj("keep", *lathe([(0.0, 0.0), (0.06, 0.0), (0.06, 0.012), (0.0, 0.012)], 8), "Plaster", col(c, 7613 + k, 0.03), tile=0.2), T(x, -0.058, z) @ R(math.pi / 2, "X")))
    v, f = bipyramid(0.04, 0.04, 0.025, 4); p.append((K.obj("forge", v, f, "Ember", None, tile=0.2), T(mx, -0.066, mz) @ R(math.pi / 2, "X")))
    for k in range(5): p.append((K.obj("tree", *lathe([(0.0, 0.0), (0.03, 0.0), (0.0, 0.07)], 5), "Plaster", col([0.3, 0.55, 0.25], 7615 + k, 0.06), tile=0.2), T(mx - 0.35 + 0.17 * k, -0.06, mz + 0.3 - 0.13 * (k % 2)) @ R(math.pi / 2, "X") @ Matrix.Diagonal((1, 1, 0.2, 1)) @ R(-math.pi / 2, "X")))
    notes = [(0.55, zc + 0.28, 0.42, 0.42, [0.98, 0.95, 0.86], 0.08), (0.52, zc - 0.25, 0.48, 0.38, [0.95, 0.9, 0.75], -0.06)]
    for k, (x, z, w, h, c, a) in enumerate(notes):
        M = T(x, -0.05, z) @ R(a, "Y")
        p.append((bbox(w, 0.008, h, "Plaster", col(c, 7620 + k, 0.04)), M))
        for j in range(4): p.append((bbox(w * (0.75 - 0.12 * j), 0.004, 0.018, "Slate", col([0.3, 0.28, 0.26], 7630 + j, 0.05)), M @ T(0, -0.006, h / 2 - 0.1 - 0.07 * j)))
        if k == 0:  # a wanted poster: a sketched goblin (or a sketched Dawnholder in Grumblekeep)
            p.append((blob(0.07, 0.006, 0.08, "Plaster", col([0.55, 0.8, 0.3] if not evil else [0.95, 0.78, 0.6], 7640, 0.04), 7, 4), M @ T(0, -0.008, -0.08)))
            if not evil:
                for sx in (-1, 1): p.append((K.obj("ear", *lathe([(0.0, 0.0), (0.02, 0.0), (0.0, 0.07)], 4), "Plaster", col([0.55, 0.8, 0.3], 7641, 0.04), tile=0.2), M @ T(sx * 0.07, -0.008, -0.06) @ R(-sx * 1.3, "Y")))
        p.append((blob(0.02, 0.02, 0.02, "Plaster", col([0.86, 0.22, 0.2], 7650 + k, 0.03), 5, 3), M @ T(0, -0.012, h / 2 - 0.03)))  # wax seal pin
    # a glowing "new!" crystal pinned on top, so the board reads from across the square
    v, f = bipyramid(0.09, 0.09, 0.06, 5); p.append((K.obj("new", v, f, s["gem"], None, tile=0.2, sa=20), T(W / 2 - 0.12, -0.09, zc + Hb / 2 - 0.05) @ R(math.pi / 2, "X")))
    # signpost behind the right post, arrows angled every which way
    sx0 = W / 2 + 0.55
    p.append((cyl(0.07, 3.3, "Wood", s["wood"], seg=7), T(sx0, 0.2, 0.0)))
    p.append((K.obj("cap", *lathe([(0.0, 0.0), (0.1, 0.0), (0.0, 0.18)], 6), s["metal"], s["mt"], tile=0.2), T(sx0, 0.2, 3.3)))
    for k, (z, yaw, flip, c) in enumerate(((3.0, 0.4, 1, s["cloth"]), (2.62, -0.9, -1, [0.86, 0.22, 0.2]), (2.25, 2.3, 1, [0.31, 0.6, 0.33]), (1.9, -2.5, -1, GOLD))):
        board = col(c, 7660 + k, 0.06)
        p += grp(arrow(0.75, 0.2, board, s, 7670 + k, CREAM), T(sx0, 0.2, z) @ R(yaw, "Z") @ (R(math.pi, "Z") if flip < 0 else Matrix()))
    # a lantern on an arm off the left post, flowers at the feet
    p.append(rodr((-W / 2 - 0.08, 0.0, 2.3), (-W / 2 - 0.55, 0.0, 2.3), 0.025, s["metal"], s["mt"], 5))
    p += grp(lantern(s["metal"], s["mt"], s["lamp"], 1.0), T(-W / 2 - 0.55, 0.0, 2.25))
    for k in range(8):
        x = -W / 2 + 0.1 + k * 0.25; c = [[1.0, 0.43, 0.56], [1.0, 0.82, 0.29], [1.0, 1.0, 1.0], [0.6, 0.48, 1.0]][k % 4]
        p.append((blob(0.1, 0.1, 0.09, "Cloth", col([0.31, 0.56, 0.23], 7680 + k, 0.06), 6, 4), T(x, -0.2, 0.08)))
        p.append((blob(0.05, 0.05, 0.045, "Cloth", col(c, 7690 + k, 0.04), 6, 3), T(x + 0.02, -0.25, 0.17 + 0.03 * (k % 3))))
    ob = piece(f"{pre}_Board", p)
    anchor(f"{pre}_Board_Face", (0.0, -0.12, zc), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# string-light pole
# ----------------------------------------------------------------------------------------------
def build_lightpole(pre):
    s = SIDE[pre]; p = []; h = 4.3
    with side_stone(s["base"]): p.append((L.block(7701, 0.5, 0.5, 0.3, 0.04, seg=(1, 1, 1), tone=s["base_t"]), Matrix()))
    p.append((cyl(0.075, h, "Wood", s["wood"], seg=8, r1=0.06), T(0, 0, 0.25)))
    # a ribbon spiralling up the pole in the side's two colours
    for c, off in ((s["ribbon"][0], 0.0), (s["ribbon"][1], math.pi)):
        pts = [(0.085 * math.cos(off + t * 9), 0.085 * math.sin(off + t * 9), 0.5 + t * (h - 0.9)) for t in np.linspace(0, 1, 26)]
        p.append(tube2(pts, 0.022, 0.022, "Cloth", col(c, 7710 + int(off), 0.04), 4, 1))
    p.append((K.obj("collar", *torus(0.1, 0.03, 10, 4), s["metal"], s["mt"], tile=0.2), T(0, 0, h + 0.05)))
    p.append((K.obj("fin", *lathe([(0.0, 0.0), (0.08, 0.05), (0.1, 0.15), (0.0, 0.32)], 8), s["metal"], s["mt"], tile=0.2), T(0, 0, h + 0.2)))
    for k in range(4):  # four hooks the light strings hang from
        a = k / 4 * TAU; p.append(rodr((0.06 * math.cos(a), 0.06 * math.sin(a), h - 0.05), (0.2 * math.cos(a), 0.2 * math.sin(a), h + 0.02), 0.012, s["metal"], s["mt"], 4))
    ob = piece(f"{pre}_LightPole", p)
    anchor(f"{pre}_LightPole_Top", (0.0, 0.0, h - 0.05), ob)
    return ob

BUILDERS = {f"{pre}_{name}": (lambda pre=pre, fn=fn: fn(pre)) for pre in ("D", "G") for name, fn in
            (("Trainer", build_trainer), ("Dummy", build_dummy), ("Bakery", build_bakery), ("Stage", build_stage), ("Board", build_board), ("LightPole", build_lightpole))}

def build(which=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = K.build_materials()
    for name, fn in BUILDERS.items():
        if which and name not in which: continue
        t = time.time(); fn(); print(name, round(time.time() - t, 1), "s", flush=True)
    keep = set(BUILDERS)
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None and ob.name not in keep: bpy.data.objects.remove(ob)
    return lum

if __name__ == "__main__":
    which = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    lum = build(which)
    glb = os.path.join(HERE, "square_kit.glb"); B.export_glb(glb); B.pack_colors(glb)
    rep = L.inspect(glb); rep["anchors"] = K.anchors_report(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]), json.dumps(rep["anchors"]))
