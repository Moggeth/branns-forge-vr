"""Brann's Forge - the Armoury (Dawnhold style), 2026-10-18. Deterministic Blender (bpy 4.5 / 5.0).

Run (no Blender install needed):
  pip install bpy
  python3 build_armoury.py               # writes armoury.glb, textures/, build_report.json here
  cp armoury.glb ../../multiplayer/public/assets/armoury.glb
  python3 render_armoury.py              # Cycles views in renders/

Same conventions as ../backtown-20261008/build_backtown.py (whose house shell, crates, kegs and helpers this imports):
modelled at the origin, foot centre on the ground, FRONT facing Blender -Y (three.js +Z), true size (placed at scale 1).
The game places it from multiplayer/shared/home-bases.js ARMOURY; walls match TOWN_SOLIDS.armoury (three.js x, z):
  D_Armoury   open-fronted hall 7 x 5.4: back wall z = -2.5, side walls x = +-3.4, front posts (+-3.35, 2.45);
              weapon stand (0, -0.35) r 0.55, practice butt (4.85, 1.6) r 0.65, bolt barrel (-4.25, 1.9) r 0.4
              anchor D_Armoury_Stand (0, 1.2, -0.35): where the game seats a real Flockwright on the stand's cradle
A story in the dressing: this is where Dawnhold's crossbows are strung and mended, and where the Flockwright's six
goggled birds roost (the dovecote loft on the ridge, the perch rail over the stand, a weathervane bird).
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
from build_town import (obj, lathe, torus, bbox, beam, rodr, tube2, blob, slab, cyl, prism, grp, col, STYLES,  # noqa: E402
                        WOOD_T, DARKWOOD_T, BRASS_T, IRON_T, T, R, bipyramid, anchor, side_stone, course_tone,
                        keg, lantern, flag, sign_board, sun_disc, piece, Matrix, TAU)
import bpy  # noqa: E402

BLUE = [0.2, 0.36, 0.8]; GOLD = [0.95, 0.78, 0.36]; TEAL = [0.07, 0.42, 0.47]; TURQ = [0.19, 0.73, 0.76]; IVORY = [0.97, 0.95, 0.9]

# ----------------------------------------------------------------------------------------------
# props
# ----------------------------------------------------------------------------------------------
def mini_crossbow(seed, stock_t=WOOD_T, s=1.0):
    """A plain Dawnhold crossbow for the racks: tiller along +Z (hangs nose-up), prod across X at the top, string,
    stirrup. Origin at the butt."""
    p = [(bbox(0.07 * s, 0.06 * s, 0.72 * s, "Wood", stock_t, bev=0.012), T(0, 0, 0.36 * s))]
    p.append((bbox(0.05 * s, 0.1 * s, 0.16 * s, "Wood", stock_t, bev=0.01), T(0, 0.06 * s, 0.25 * s) @ R(0.35, "X")))  # grip
    p.append((bbox(0.03 * s, 0.07 * s, 0.5 * s, "Brass", BRASS_T), T(0, -0.035 * s, 0.47 * s)))                         # rail inlay
    pts = [(-0.34 * s, -0.04 * s, 0.6 * s), (-0.17 * s, -0.01 * s, 0.7 * s), (0, 0, 0.72 * s), (0.17 * s, -0.01 * s, 0.7 * s), (0.34 * s, -0.04 * s, 0.6 * s)]
    p.append(tube2(pts, 0.022 * s, 0.014 * s, "Iron", IRON_T, 5, 2))
    p.append(rodr((-0.34 * s, -0.045 * s, 0.6 * s), (0, -0.05 * s, 0.38 * s), 0.006 * s, "Cloth", col([0.85, 0.75, 0.55], seed, 0.05), 3))
    p.append(rodr((0.34 * s, -0.045 * s, 0.6 * s), (0, -0.05 * s, 0.38 * s), 0.006 * s, "Cloth", col([0.85, 0.75, 0.55], seed, 0.05), 3))
    p.append((obj("stirrup", *torus(0.06 * s, 0.01 * s, 8, 3), "Iron", IRON_T, tile=0.2), T(0, 0, 0.8 * s) @ R(math.pi / 2, "Y")))
    return p

def shield(r, field, seed, metal="Brass", mt=BRASS_T, boss="sun"):
    """Round Dawnhold shield facing -Y, origin at its centre: dished boards, a brass rim, a boss."""
    p = [(obj("shield", *lathe([(0.0, 0.0), (r * 0.95, 0.0), (r, 0.03), (r * 0.9, 0.07), (0.0, 0.1)], 14), "Wood", col(field, seed, 0.08), tile=0.4, sa=40), R(math.pi / 2, "X"))]
    p.append((obj("srim", *torus(r * 0.98, 0.028, 14, 4), metal, mt, tile=0.3), R(math.pi / 2, "X") @ T(0, 0, 0.03)))
    for a in (-0.5, 0.5): p.append((bbox(0.03, 0.02, r * 1.7, "Iron", IRON_T), T(a * r * 0.9, -0.06, 0) @ R(0, "Y")))  # board battens
    if boss == "sun": p += grp(sun_disc(r * 0.42, rays=8, gem="Crystal"), T(0, -0.1, 0))
    else: p.append((blob(r * 0.25, 0.08, r * 0.25, metal, mt, 8, 4), T(0, -0.08, 0)))
    return p

def bolt(length, seed, fletch=TEAL):
    """A crossbow bolt along +Z, origin at the nock: ash shaft, iron bodkin, two-colour fletching."""
    p = [(cyl(0.012, length, "Wood", col([0.85, 0.7, 0.5], seed, 0.06), seg=5), Matrix())]
    p.append((obj("tip", *lathe([(0.0, 0.0), (0.022, 0.0), (0.0, 0.08)], 4), "Iron", IRON_T, tile=0.2, sa=20), T(0, 0, length)))
    for k in range(3):
        a = k / 3 * TAU
        p.append((bbox(0.004, 0.035, 0.1, "Cloth", col(fletch if k else IVORY, seed + k, 0.05)), T(0.02 * math.cos(a), 0.02 * math.sin(a), 0.07) @ R(a, "Z")))
    return p

def songbird(seed, body=TEAL, s=1.0, goggles=True):
    """One of the Flockwright crew, roosting: a round teal bird with a cream breast, coral beak and brass goggles.
    Faces -Y, origin at its feet."""
    p = [(blob(0.06 * s, 0.07 * s, 0.065 * s, "Cloth", col(body, seed, 0.06), 8, 5), T(0, 0, 0.07 * s))]
    p.append((blob(0.045 * s, 0.03 * s, 0.05 * s, "Cloth", col(IVORY, seed + 1, 0.03), 7, 4), T(0, -0.045 * s, 0.065 * s)))
    p.append((blob(0.045 * s, 0.045 * s, 0.045 * s, "Cloth", col(body, seed + 2, 0.06), 7, 4), T(0, -0.02 * s, 0.15 * s)))
    p.append((obj("beak", *lathe([(0.0, 0.0), (0.014 * s, 0.0), (0.0, 0.035 * s)], 5), "Cloth", col([0.98, 0.5, 0.2], seed + 3, 0.04), tile=0.2), T(0, -0.06 * s, 0.145 * s) @ R(math.pi / 2, "X")))
    p.append((bbox(0.02 * s, 0.09 * s, 0.015 * s, "Cloth", col(body, seed + 4, 0.08)), T(0, 0.08 * s, 0.06 * s) @ R(-0.5, "X")))   # tail
    if goggles:
        for sx in (-1, 1): p.append((obj("lens", *torus(0.014 * s, 0.005 * s, 8, 3), "Brass", BRASS_T, tile=0.2), T(sx * 0.018 * s, -0.045 * s, 0.168 * s) @ R(math.pi / 2, "X")))
        p.append((bbox(0.1 * s, 0.01 * s, 0.008 * s, "Cloth", col([0.35, 0.22, 0.14], seed + 5, 0.05)), T(0, -0.01 * s, 0.168 * s)))
    for sx in (-1, 1): p.append(rodr((sx * 0.015 * s, -0.005 * s, 0.02 * s), (sx * 0.015 * s, -0.01 * s, 0.0), 0.004 * s, "Cloth", col([0.98, 0.5, 0.2], seed + 6, 0.04), 3))
    return p

def butt(seed):
    """Practice butt: a bound straw drum with painted rings on a timber A-frame, two bolts in it. Origin at its feet,
    face toward -Y."""
    p = []; zc = 1.05; r = 0.62
    for sx in (-1, 1):
        p.append(beam((sx * 0.55, 0.25, 0.0), (sx * 0.3, 0.05, 1.5), 0.08, "Wood", WOOD_T))
        p.append(beam((sx * 0.5, -0.2, 0.0), (sx * 0.32, 0.0, 1.45), 0.07, "Wood", WOOD_T))
    p.append((bbox(1.0, 0.07, 0.08, "Wood", WOOD_T), T(0, 0.12, 0.45)))
    straw = lambda pp, n: np.clip(np.stack([0.92 + 0.08 * np.sin(pp[:, 2] * 90 + pp[:, 0] * 30)] * 3, -1) * np.array([0.95, 0.8, 0.45]), 0, 1)
    p.append((cyl(r, 0.32, "Cloth", straw, seg=16), T(0, -0.1, zc) @ R(math.pi / 2, "X")))
    rings = [(0.6, [0.97, 0.95, 0.88]), (0.46, BLUE), (0.31, [0.97, 0.95, 0.88]), (0.17, GOLD)]
    for k, (rr, c) in enumerate(rings):
        p.append((obj("ring", *lathe([(0.0, 0.0), (rr, 0.0), (rr, 0.01), (0.0, 0.01)], 16), "Plaster", col(c, seed + k, 0.03), tile=0.3), T(0, -0.42 - 0.004 * k, zc) @ R(math.pi / 2, "X")))
    for z in (-0.12, 0.12): p.append((obj("band", *torus(r + 0.01, 0.02, 16, 3), "Cloth", col([0.55, 0.35, 0.2], seed + 9, 0.05), tile=0.3), T(0, -0.1 + z, zc) @ R(math.pi / 2, "X")))
    for k, (x, z, a) in enumerate(((0.08, 0.1, 0.12), (-0.22, -0.18, -0.2))):  # two bolts that found the gold and the blue
        p += grp(bolt(0.42, seed + 20 + k), T(x, -0.3, zc + z) @ R(-math.pi / 2 + 0.1, "X") @ R(a, "Y") @ T(0, 0, -0.3))
    return p

def bolt_barrel(seed):
    p = grp(keg(0.34, 0.8, "Wood", WOOD_T, "Brass", BRASS_T, 9), Matrix())
    rr = np.random.default_rng(seed)
    for k in range(9):
        a = k / 9 * TAU + rr.random() * 0.3; d = 0.08 + 0.14 * rr.random()
        p += grp(bolt(0.55, seed + k, TEAL if k % 2 else TURQ), T(d * math.cos(a), d * math.sin(a), 0.35) @ R((rr.random() - 0.5) * 0.35, "X") @ R((rr.random() - 0.5) * 0.35, "Y") @ R(math.pi, "X") @ T(0, 0, -0.62))
    return p

def stand(seed):
    """The Flockwright's stand, origin at its feet in the middle of the floor: a stone plinth, an oak trestle with a
    brass cradle (the game seats the real crossbow at the anchor above it), a perch rail where the crew waits, a
    brass plaque and a little seed tray."""
    st = STYLES["D"]; p = []
    with side_stone("Stone"): p.append((L.block(seed, 1.1, 0.8, 0.35, 0.04, seg=(2, 1, 1), tone=st["lo_t"]), T(0, 0, 0.0)))
    p.append(slab(-0.6, 0.6, -0.45, 0.45, 0.35, 0.42, "Wood", DARKWOOD_T, chip=0.01, step=1.0))
    for sx in (-1, 1):  # trestle legs and cradle arms: brass forks the crossbow rests in
        p.append(beam((sx * 0.4, -0.18, 0.42), (sx * 0.3, 0.0, 1.05), 0.07, "Wood", WOOD_T))
        p.append(beam((sx * 0.4, 0.18, 0.42), (sx * 0.3, 0.0, 1.05), 0.07, "Wood", WOOD_T))
        p.append((bbox(0.1, 0.12, 0.06, "Brass", BRASS_T, bev=0.01), T(sx * 0.3, 0.0, 1.08)))
        for sy in (-1, 1): p.append(rodr((sx * 0.3, sy * 0.05, 1.1), (sx * 0.3, sy * 0.07, 1.2), 0.012, "Brass", BRASS_T, 5))
    p.append(beam((-0.36, 0.0, 0.75), (0.36, 0.0, 0.75), 0.06, "Wood", WOOD_T))
    # perch rail behind the cradle: a crossbar on a post with six worn pegs, two crew birds keeping it warm
    p.append((cyl(0.045, 1.7, "Wood", WOOD_T, seg=7), T(0, 0.42, 0.42)))
    p.append(rodr((-0.62, 0.42, 1.95), (0.62, 0.42, 1.95), 0.035, "Wood", WOOD_T, 7))
    for k in range(6):
        x = -0.5 + k * 0.2; p.append(rodr((x, 0.42, 1.95), (x, 0.3, 1.97), 0.012, "Brass", BRASS_T, 4))
    for k, x in enumerate((-0.42, 0.38)): p += grp(songbird(seed + 30 + k, TEAL if k else TURQ, 1.0), T(x, 0.42, 1.98) @ R(0.4 * (1 - 2 * k), "Z"))
    p.append((bbox(0.36, 0.25, 0.04, "Wood", WOOD_T, bev=0.01), T(0.0, 0.42, 1.35)))  # seed tray on the post
    for k in range(7): p.append((blob(0.02, 0.02, 0.012, "Cloth", col([0.85, 0.7, 0.4], seed + 40 + k, 0.1), 4, 3), T(-0.12 + 0.04 * k, 0.4 + 0.03 * math.sin(k * 2), 1.385)))
    p.append((bbox(0.42, 0.02, 0.16, "Brass", BRASS_T, bev=0.01), T(0, -0.46, 0.25) @ R(-0.25, "X")))  # plaque
    v, f = bipyramid(0.05, 0.05, 0.03, 4); p.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(0, -0.48, 0.32) @ R(math.pi / 2, "X")))
    return p

def dovecote(st, seed):
    """The crew's loft on the ridge: a little plastered box with arched doorways, landing ledges, a pyramid roof and a
    brass weathervane bird. Origin at its foot (on the ridge line)."""
    p = []; w = 1.1; h = 0.8; fr, fr_t = st["frame"], st["frame_t"]
    p.append(slab(-w / 2, w / 2, -w / 2, w / 2, 0.0, h, "Plaster", col([0.98, 0.94, 0.84], seed, 0.06), chip=0.0, step=1.0, tile=1.0))
    for sx in (-1, 1):
        for sy in (-1, 1): p.append((bbox(0.08, 0.08, h, fr, fr_t), T(sx * w / 2, sy * w / 2, h / 2)))
    for a in range(4):  # an arched hole and a ledge on each face
        M = R(a * math.pi / 2, "Z")
        p.append((obj("hole", *lathe([(0.0, 0.0), (0.11, 0.0), (0.11, 0.01), (0.0, 0.01)], 10), "Iron", col([0.12, 0.1, 0.1], seed + a, 0.02), tile=0.3), M @ T(0, -w / 2 - 0.005, 0.42) @ R(math.pi / 2, "X")))
        p.append((bbox(0.5, 0.16, 0.04, "Wood", WOOD_T), M @ T(0, -w / 2 - 0.08, 0.22)))
    p.append((obj("cap", *lathe([(0.0, 0.0), (0.86, 0.0), (0.0, 0.55)], 4), "Slate", st["roof_t"] or K.moss_slate, tile=0.8, sa=30), T(0, 0, h) @ R(math.pi / 4, "Z")))
    p.append((cyl(0.025, 0.6, "Brass", BRASS_T, seg=5), T(0, 0, h + 0.5)))
    p.append(rodr((-0.22, 0, h + 0.85), (0.22, 0, h + 0.85), 0.012, "Brass", BRASS_T, 4))  # the arrow of the vane
    p.append((obj("vtip", *lathe([(0.0, 0.0), (0.04, 0.0), (0.0, 0.1)], 4), "Brass", BRASS_T, tile=0.2), T(0.22, 0, h + 0.85) @ R(math.pi / 2, "Y")))
    p += grp(songbird(seed + 50, GOLD, 1.6, goggles=True), T(-0.05, 0, h + 0.9) @ R(math.pi / 2, "Z"))   # the gilded vane bird
    for k, (x, y, a) in enumerate(((0.2, -w / 2 - 0.1, 0.0), (-0.32, w / 2 + 0.1, math.pi))):  # two birds on the ledges
        p += grp(songbird(seed + 60 + k, TEAL if k else TURQ, 1.1), T(x, y, 0.24) @ R(a, "Z"))
    return p

def wall_rack(st, x0, x1, y, z, seed):
    """Pegged board along the back wall with crossbows hung nose-up between Dawnhold shields."""
    p = [(bbox(x1 - x0, 0.06, 0.12, "Wood", st["frame_t"]), T((x0 + x1) / 2, y, z + 1.0)), (bbox(x1 - x0, 0.06, 0.12, "Wood", st["frame_t"]), T((x0 + x1) / 2, y, z))]
    n = 4; xs = np.linspace(x0 + 0.45, x1 - 0.45, n)
    for k, x in enumerate(xs):
        p += grp(mini_crossbow(seed + k, WOOD_T if k % 2 else DARKWOOD_T), T(x, y - 0.1, z - 0.25) @ R(0.05 * (k - 1.5), "Y"))
        p.append(rodr((x - 0.12, y, z + 0.95), (x - 0.12, y - 0.12, z + 0.97), 0.015, "Brass", BRASS_T, 4))
        p.append(rodr((x + 0.12, y, z + 0.95), (x + 0.12, y - 0.12, z + 0.97), 0.015, "Brass", BRASS_T, 4))
    for k, x in enumerate((xs[0] + xs[1]) / 2 + np.array([0.0, (xs[2] - xs[0])])):
        p += grp(shield(0.36, BLUE if k == 0 else [0.85, 0.3, 0.25], seed + 10 + k, boss="sun" if k == 0 else "boss"), T(x, y - 0.12, z + 1.55))
    return p

def spear_rack(st, x, y0, y1, seed):
    """A floor rack of spears and a pike against the left wall (spears stand along Y)."""
    p = [(bbox(0.25, y1 - y0, 0.08, "Wood", st["frame_t"]), T(x, (y0 + y1) / 2, 0.55)), (bbox(0.25, y1 - y0, 0.08, "Wood", st["frame_t"]), T(x, (y0 + y1) / 2, 0.15))]
    for y in (y0, y1): p.append((bbox(0.25, 0.08, 0.6, "Wood", st["frame_t"]), T(x, y, 0.35)))
    for k, y in enumerate(np.linspace(y0 + 0.15, y1 - 0.15, 5)):
        h = 2.1 + 0.25 * (k % 2)
        p.append((cyl(0.022, h, "Wood", col([0.75, 0.58, 0.4], seed + k, 0.08), seg=5), T(x, y, 0.12) @ R(0.06 * (k - 2), "X")))
        p.append((obj("tip", *lathe([(0.0, 0.0), (0.04, 0.0), (0.035, 0.08), (0.0, 0.24)], 4), "Iron", IRON_T, tile=0.2, sa=20), T(x, y + 0.06 * (k - 2) * 0.0 + (h + 0.12) * math.sin(0.06 * (k - 2)) * -1, 0.12 + h * math.cos(0.06 * (k - 2)))))
        p.append((obj("tie", *torus(0.03, 0.012, 6, 3), "Cloth", col(BLUE if k % 2 else GOLD, seed + 10 + k, 0.04), tile=0.2), T(x, y - (h - 0.1) * math.sin(0.06 * (k - 2)), 0.12 + (h - 0.1) * math.cos(0.06 * (k - 2)))))
    return p

def bench(st, seed):
    """Fletcher's bench against the right wall: a thick oak top, a vise holding a half-strung crossbow, a fletching
    jig, feathers in a pot, a lamp. Origin at its feet centre, long side along Y."""
    p = [slab(-0.4, 0.4, -0.9, 0.9, 0.8, 0.9, "Wood", DARKWOOD_T, chip=0.01, step=1.0)]
    for sy in (-1, 1):
        for sx in (-1, 1): p.append((bbox(0.1, 0.1, 0.8, "Wood", WOOD_T), T(sx * 0.32, sy * 0.8, 0.4)))
    p.append(slab(-0.35, 0.35, -0.8, 0.8, 0.22, 0.27, "Wood", WOOD_T, chip=0.01, step=1.0))
    p.append((bbox(0.16, 0.2, 0.2, "Iron", IRON_T, bev=0.01), T(-0.1, -0.55, 1.0)))   # vise
    p += grp(mini_crossbow(seed, WOOD_T, 0.9), T(-0.1, -0.2, 1.02) @ R(math.pi / 2, "X") @ R(0.4, "Y"))
    p.append((obj("pot", *lathe([(0.0, 0.0), (0.09, 0.0), (0.1, 0.16), (0.08, 0.18), (0.0, 0.18)], 8), "Plaster", col([0.75, 0.45, 0.3], seed + 1, 0.06), tile=0.3), T(0.15, 0.55, 0.9)))
    for k in range(6):
        a = k / 6 * TAU; p.append((bbox(0.01, 0.05, 0.2, "Cloth", col(TEAL if k % 2 else IVORY, seed + 5 + k, 0.05)), T(0.15 + 0.03 * math.cos(a), 0.55 + 0.03 * math.sin(a), 1.17) @ R(0.25 * math.cos(a), "X") @ R(0.25 * math.sin(a), "Y")))
    for k in range(4): p += grp(bolt(0.45, seed + 20 + k), T(0.1, 0.05 + k * 0.08, 0.92) @ R(-math.pi / 2, "X") @ T(0, 0, -0.22))
    p += grp(lantern(STYLES["D"]["metal"], STYLES["D"]["metal_t"], STYLES["D"]["lamp"], 0.7), T(0.2, 0.15, 0.9))
    return p

# ----------------------------------------------------------------------------------------------
def build_armoury(pre="D"):
    st = dict(STYLES[pre]); W, D, top, ridge = 7.0, 5.4, 3.0, 5.2; hw, hd = W / 2, D / 2
    m, mt = st["metal"], st["metal_t"]; fr, fr_t = st["frame"], st["frame_t"]
    p = BT.house_shell(pre, W, D, st, top, ridge, open_front=True, wins={-1: [0.6], 1: [1.0]}, seed=7)
    # floor: flagstones under the stand and a woven runner up to it
    p += K.rug(0.0, -0.9, 0.8, 1.5, [BLUE, GOLD, [0.97, 0.95, 0.88], BLUE], 5100, rings=4)
    # the Flockwright's stand at three (0, -0.35) -> Blender (0, 0.35)
    p += grp(stand(5200), T(0.0, 0.35, 0.1))
    # two lanterns on chains from the tie beam light the stand so the crossbow reads from the doorway
    for sx in (-1, 1):
        p.append(rodr((sx * 0.85, 0.35, 3.0), (sx * 0.85, 0.35, 2.55), 0.012, m, mt, 4))
        p += grp(lantern(m, mt, st["lamp"], 1.0), T(sx * 0.85, 0.35, 2.55))
    # back wall: crossbows and shields
    p += wall_rack(st, -2.6, 2.6, hd - 0.48, 1.25, 5300)
    # left wall: spears; right wall: the fletcher's bench
    p += spear_rack(st, -hw + 0.62, -0.9, 0.9, 5400)
    p += grp(bench(st, 5500), T(hw - 0.82, 0.5, 0.1))
    # bolt crates stacked in the back-right corner
    for k, (x, y, z, w) in enumerate(((2.55, 1.85, 0.1, 0.55), (2.6, 1.85, 0.65, 0.45), (2.0, 1.95, 0.1, 0.5))):
        p += grp(BT.crate(w, 5600 + k, WOOD_T, "Brass", BRASS_T), T(x, y, z) @ R(0.12 * k, "Z"))
    # front: sign board under the tie beam, lanterns on the posts, Dawnhold flags
    board = col([0.22, 0.36, 0.72], 5700, 0.1)
    sb = sign_board(1.5, 0.66, board, m, mt)
    for a in (0.7, -0.7): sb += grp(bolt(0.9, 5710 + int(a * 10), TURQ), T(0, -0.09, -0.33) @ R(a, "Y") @ T(0, 0, -0.5))
    sb += grp(shield(0.2, [0.95, 0.88, 0.7], 5720, boss="boss"), T(0, -0.14, -0.33))
    sb += grp(songbird(5730, TEAL, 1.5), T(0.52, -0.12, -0.6))
    p += grp(sb, T(0, -hd + 0.02, top + 0.66))
    for sx in (-1, 1): p += grp(lantern(m, mt, st["lamp"], 0.9), T(sx * (hw - 0.2), -hd - 0.1, top - 0.4))
    for sx in (-1, 1): p += grp(flag(0.5, 1.0, st["cloth"], st["sigil"], 5740 + sx, emblem_kind="D"), T(sx * (hw - 0.8), -hd + 0.12, top - 0.22))
    # the crew's loft on the ridge, just behind the front gable
    p += grp(dovecote(st, 5800), T(0, 0.3, ridge - 0.42))
    # outside: practice butt (front right) and a barrel of bolts (front left)
    p += grp(butt(5900), T(4.85, -1.6, 0.0) @ R(-0.35, "Z"))
    p += grp(bolt_barrel(5950), T(-4.25, -1.9, 0.0))
    ob = piece(f"{pre}_Armoury", p)
    anchor(f"{pre}_Armoury_Stand", (0.0, 0.35, 1.2), ob)
    return ob

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = K.build_materials()
    t = time.time(); build_armoury("D"); print("D_Armoury", round(time.time() - t, 1), "s", flush=True)
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None and ob.name[:2] != "D_": bpy.data.objects.remove(ob)
    return lum

if __name__ == "__main__":
    lum = build()
    glb = os.path.join(HERE, "armoury.glb"); B.export_glb(glb); B.pack_colors(glb)
    rep = L.inspect(glb); rep["anchors"] = K.anchors_report(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]), json.dumps(rep["anchors"]))
