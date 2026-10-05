"""Brann's Forge - home bases kit (Dawnhold and Grumblekeep), 2026-10-04. Deterministic Blender 4.5 builder.

Run (no Blender install needed):
  pip install bpy==4.5.*
  python3 build_bases.py               # writes bases_kit.glb, textures/, build_report.json here
  cp bases_kit.glb ../../multiplayer/public/assets/bases_kit.glb

Every piece is modelled at the origin, foot centre on the ground, FRONT facing Blender -Y (three.js +Z, out of
the gate). client/home-base-art.js places them with shared/home-bases.js HOME_LAYOUT. Prefix D_ is Dawnhold
(party), G_ is Grumblekeep (rivals). Animated parts are separate top-level nodes whose origin is their pivot; the
piece that carries them has a child empty <node>_At marking where that pivot sits in the piece's own frame:
  *_Heart          plinth + forge          *_HeartCrystal, *_HeartRingA, *_HeartRingB   (anchor *_Heart_Core)
  *_Barracks       hall, 6.4 x 4.4 footprint, door at the front                         *_Bell (anchor *_Barracks_Bell)
  *_Fountain       basin                    *_FountainWater (origin = fountain foot), *_FountainCrystal (anchor)
  *_Pylon          shield pylon             *_PylonCrystal (anchor *_Pylon_Crystal)
  *_Spire          crystal spire turret     *_SpireCrystal (anchor *_Spire_Crystal)
  *_BallistaBase   fixed drum               *_BallistaYoke (yaw, anchor *_BallistaBase_Yoke)
  *_BallistaYoke   turntable, cheeks, seat, crank      *_BallistaBow (pitch, anchor *_BallistaYoke_Bow)
  *_BallistaBow    stock, limbs, string    *_BallistaBolt (anchor *_BallistaBow_Bolt; bolt points -Y)
  *_Gate           the gate arch (passage along Y, pillars at x = +-2.6)
  *_Ward           a boundary stone the client rings round the dome
Materials: Stone Plaster Slate Wood Brass Cloth Iron Basalt Bone + emissive Crystal Amethyst Ember Ooze.
COLOR_0 multiplies the base colour (side tints, weathering, painted sockets).
"""
import bpy, math, os, sys, json, time
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "landmarks-20261004"))
import build_landmarks as L  # noqa: E402  (shared texture, mesh and masonry helpers)
L.TEXDIR = os.path.join(HERE, "textures"); os.makedirs(L.TEXDIR, exist_ok=True)
MATS = L.MATS
fnoise, sm, mix, blur, fbm, save_set = L.fnoise, L.sm, L.mix, L.blur, L.fbm, L.save_set
TAU = 2 * math.pi

# ----------------------------------------------------------------------------------------------
# textures
# ----------------------------------------------------------------------------------------------
def tex_basalt(name, n, seed):
    big = fnoise(n, 1.3, seed, hi=n / 18); mid = fnoise(n, 1.0, seed + 1, lo=4); fine = fnoise(n, 0.35, seed + 2)
    pits = sm(0.58, 0.9, fnoise(n, 0.15, seed + 6)); c1 = fnoise(n, 1.5, seed + 4, hi=n / 9); crack = np.exp(-(c1 / 0.02) ** 2)
    base = mix([0.11, 0.10, 0.13], [0.30, 0.28, 0.34], sm(-0.7, 0.7, 0.6 * big + 0.5 * mid))
    base = mix(base, [0.30, 0.20, 0.38], sm(0.2, 0.8, fnoise(n, 1.2, seed + 11, hi=n / 12)) * 0.4)
    base = base * (1 + 0.14 * fine - 0.55 * pits - 0.5 * crack)[..., None]
    h = 0.3 * big + 0.12 * mid + 0.06 * fine - 0.3 * pits - 0.4 * blur(crack, 1.0)
    rough = np.clip(0.78 + 0.1 * fine - 0.12 * sm(0.3, 0.9, big), 0, 1)
    return save_set(name, base, h, rough, np.zeros_like(rough), 3.2, ao=np.clip(0.8 - 0.3 * pits - 0.3 * crack + 0.15 * big, 0, 1))

def tex_plaster(name, n, seed):
    a = fnoise(n, 1.4, seed, hi=n / 10); b = fnoise(n, 0.5, seed + 1); trowel = fnoise(n, 1.0, seed + 2, ax=0.25, hi=n / 6)
    dirt = sm(0.3, 0.9, fnoise(n, 1.6, seed + 3, hi=n / 16))
    base = mix([0.78, 0.73, 0.62], [0.92, 0.88, 0.79], sm(-0.6, 0.6, 0.6 * a + 0.4 * trowel)) * (1 + 0.05 * b)[..., None]
    base = mix(base, [0.62, 0.55, 0.44], dirt * 0.35)
    return save_set(name, base, 0.4 * a + 0.3 * trowel + 0.1 * b, 0.9 + 0.05 * b, np.zeros((n, n)), 1.4)

def tex_slate(name, n, seed, rows=12, cols=10):
    y, x = np.mgrid[0:n, 0:n] / n
    row = np.floor(y * rows); fy = y * rows - row
    xs = x * cols + 0.5 * (row % 2); col = np.floor(xs); fx = xs - col
    hsh = np.sin(row * 12.9898 + col * 78.233) * 43758.5453; hsh = hsh - np.floor(hsh)
    edge = np.minimum(sm(0.0, 0.06, fx), sm(1.0, 0.94, fx)) * sm(0.0, 0.08, fy)
    fine = fnoise(n, 0.4, seed); chips = sm(0.75, 0.95, fnoise(n, 0.6, seed + 1)) * sm(0.0, 0.3, 1 - fy)
    tone = 0.9 + 0.15 * hsh
    base = mix([0.24, 0.28, 0.36], [0.33, 0.38, 0.47], sm(0.2, 1.0, hsh)) * (tone * (0.55 + 0.45 * edge) * (1 + 0.06 * fine))[..., None]
    base = mix(base, [0.46, 0.52, 0.40], sm(0.55, 0.8, fnoise(n, 1.4, seed + 3, hi=n / 10)) * 0.3)  # a little lichen
    h = 0.5 * fy + 0.6 * edge - 0.3 * chips + 0.05 * fine
    return save_set(name, base, h, np.clip(0.62 + 0.15 * fine + 0.2 * chips, 0, 1), np.zeros((n, n)), 3.0, ao=0.65 + 0.35 * edge)

def tex_cloth(name, n, seed):
    y, x = np.mgrid[0:n, 0:n] / n
    weave = 0.5 + 0.25 * np.sin(x * n * 0.9) * np.sign(np.sin(y * n * 0.45)) + 0.25 * np.sin(y * n * 0.9) * np.sign(np.sin(x * n * 0.45))
    a = fnoise(n, 1.2, seed, hi=n / 8); fray = fnoise(n, 0.3, seed + 1)
    base = mix([0.70, 0.68, 0.64], [0.92, 0.90, 0.86], sm(-0.6, 0.6, a)) * (0.88 + 0.12 * weave)[..., None] * (1 + 0.05 * fray)[..., None]
    return save_set(name, base, weave * 0.6 + 0.3 * a, 0.95 + 0.0 * a, np.zeros((n, n)), 1.2)

def tex_bone(name, n, seed):
    a = fnoise(n, 1.3, seed, hi=n / 12); fib = fnoise(n, 0.8, seed + 1, ax=0.15); pore = sm(0.7, 0.95, fnoise(n, 0.1, seed + 2))
    crk = np.exp(-(fnoise(n, 1.5, seed + 3, hi=n / 8) / 0.015) ** 2)
    stain = sm(0.2, 0.8, fnoise(n, 1.6, seed + 4, hi=n / 14))
    base = mix([0.74, 0.68, 0.54], [0.95, 0.91, 0.80], sm(-0.6, 0.6, 0.6 * a + 0.3 * fib))
    base = mix(base, [0.60, 0.50, 0.34], stain * 0.35) * (1 - 0.35 * pore - 0.5 * crk)[..., None]
    return save_set(name, base, 0.4 * a + 0.2 * fib - 0.3 * pore - 0.4 * crk, np.clip(0.55 + 0.15 * fib + 0.2 * pore, 0, 1), np.zeros((n, n)), 1.6)

def tex_iron(name, n, seed):
    ham = fnoise(n, 0.7, seed + 1, lo=8, hi=n / 6); blot = fnoise(n, 1.4, seed + 2, hi=n / 10); scr = fnoise(n, 0.4, seed + 3, ax=0.08)
    rust = sm(0.25, 0.75, blot * 0.9 - 0.25 * ham)
    base = mix([0.10, 0.10, 0.11], [0.30, 0.29, 0.30], sm(-0.8, 0.8, 0.5 * ham + 0.3 * scr))
    base = mix(base, [0.42, 0.20, 0.09], rust * 0.7)
    return save_set(name, base, 0.6 * ham + 0.2 * scr + 0.25 * rust, np.clip(0.42 + 0.12 * scr + 0.45 * rust, 0.2, 1), 0.55 - 0.45 * rust, 0.8,
                    ao=0.8 + 0.2 * sm(-0.6, 0.6, ham))

def tex_brass(name, n, seed):
    ham = fnoise(n, 0.7, seed + 1, lo=8, hi=n / 6); blot = fnoise(n, 1.4, seed + 2, hi=n / 10); scr = fnoise(n, 0.4, seed + 3, ax=0.08)
    vg = sm(0.45, 0.85, blot * 0.9 - 0.3 * ham)
    base = mix([0.50, 0.36, 0.16], [0.90, 0.72, 0.40], sm(-0.8, 0.8, 0.4 * ham + 0.25 * scr))
    base = mix(base, [0.32, 0.58, 0.50], vg * 0.45)
    return save_set(name, base, 0.6 * ham + 0.2 * scr + 0.3 * vg, np.clip(0.24 + 0.1 * scr + 0.4 * vg, 0.15, 1), 0.75 - 0.45 * vg, 0.6,
                    ao=0.85 + 0.15 * sm(-0.6, 0.6, ham))

def tex_glow(name, n, seed, lo, hi, vein, dark, light, em_scale=0.55):
    veins = np.clip(1 - np.abs(fnoise(n, 1.1, seed, lo=3, hi=n / 6) * 2.4), 0, 1) ** 6 * 0.6
    cells = fnoise(n, 0.9, seed + 1, hi=n / 8) * 0.5; fine = fnoise(n, 0.4, seed + 2)
    em = np.clip(mix(lo, hi, sm(-0.5, 0.6, cells)) + veins[..., None] * np.array(vein) + (0.05 * fine)[..., None], 0, 1)
    base = mix(dark, light, sm(-0.5, 0.6, cells))
    return save_set(name, base, 0.5 * veins + 0.3 * cells, 0.15 + 0.1 * fine, np.zeros((n, n)), 1.0, emis=em * em_scale)

def build_materials():
    lum = {"Stone": L.tex_stone("Stone", 512, 41), "Wood": L.tex_wood("Wood", 512, 85), "Basalt": tex_basalt("Basalt", 512, 501),
           "Plaster": tex_plaster("Plaster", 512, 511), "Slate": tex_slate("Slate", 512, 521), "Cloth": tex_cloth("Cloth", 256, 531),
           "Bone": tex_bone("Bone", 512, 541), "Iron": tex_iron("Iron", 512, 551), "Brass": tex_brass("Brass", 512, 561),
           "Crystal": tex_glow("Crystal", 256, 74, [0.22, 0.58, 1.0], [0.55, 0.85, 1.0], [0.25, 0.2, 0.0], [0.12, 0.30, 0.62], [0.40, 0.68, 0.95], 0.6),
           "Amethyst": tex_glow("Amethyst", 256, 571, [0.40, 0.10, 0.85], [0.80, 0.45, 1.0], [0.3, 0.3, 0.1], [0.25, 0.08, 0.40], [0.62, 0.35, 0.85]),
           "Ember": tex_glow("Ember", 256, 581, [0.95, 0.30, 0.04], [1.0, 0.78, 0.30], [0.1, 0.2, 0.1], [0.35, 0.08, 0.02], [0.85, 0.45, 0.15], 0.8),
           "Ooze": tex_glow("Ooze", 256, 591, [0.30, 0.85, 0.08], [0.70, 1.0, 0.35], [0.2, 0.1, 0.2], [0.12, 0.35, 0.04], [0.45, 0.85, 0.25], 0.7)}
    for nm in ("Stone", "Wood", "Basalt", "Plaster", "Slate", "Cloth", "Bone", "Iron", "Brass"): MATS[nm] = L.make_material(nm)
    for nm in ("Crystal", "Amethyst", "Ember", "Ooze"): MATS[nm] = L.make_material(nm, emissive=True)
    MATS["Bronze"] = MATS["Brass"]  # the landmark helpers (wheel bands) ask for Bronze
    return lum

# ----------------------------------------------------------------------------------------------
# small geometry kit (numpy V,F in Blender space; Z up, front -Y)
# ----------------------------------------------------------------------------------------------
def tint(rgb, seed=1, var=0.12, freq=1.5):
    rgb = np.array(rgb, float)
    return lambda p, n: np.clip(rgb[None, :] * (1 + var * fbm(p, seed, freq, 2))[:, None], 0, 1)

GLOWS = ("Crystal", "Amethyst", "Ember", "Ooze")

def obj(name, V, F, mat, tone=None, tile=1.2, sa=40, dec=None, planar=None):
    if mat in GLOWS: tile = min(tile, 0.35)
    ob = L.make_mesh(name, V, F, MATS[mat]); return L.finalize(ob, tone, tile=tile, smooth_angle=sa, decimate=dec, planar=planar)

def lathe(profile, seg):
    return L.lathe(profile, seg)

def disc_lathe(r0, r1, z0, z1, seg):
    return lathe([(0.0, z0), (r0, z0), (r1, z1), (0.0, z1)], seg)

def torus(R, r, seg=24, rs=6):
    prof = [(R + r * math.cos(t), r * math.sin(t)) for t in np.linspace(0, TAU, rs + 1)]
    return lathe(prof, seg)

def boxv(w, d, h, chip=0.02, seg=(2, 2, 2), wob=0.0, seed=0):
    V, F = L.grid_box(*seg); P = V * np.array([w / 2, d / 2, h / 2])
    edges = (np.abs(V) > 0.999).sum(1)
    P -= np.sign(V) * (chip * (edges >= 2) * (1 + 0.4 * (edges == 3)))[:, None]
    if wob: P += wob * np.stack([fbm(P, seed + k, 3.0, 2) for k in range(3)], -1)
    return P, F

def xf(V, M):
    """Apply a 4x4 Matrix to an (n,3) array."""
    A = np.array(M); return V @ A[:3, :3].T + A[:3, 3]

def T(x, y, z): return Matrix.Translation((x, y, z))
def R(a, ax): return Matrix.Rotation(a, 4, ax)

def ellipsoid(rx, ry, rz, seg=16, rings=10):
    prof = [(math.sin(t), -math.cos(t)) for t in np.linspace(0, math.pi, rings + 1)]
    V, F = lathe(prof, seg); return V * np.array([rx, ry, rz]), F

def bipyramid(up, down, r, sides=6):
    v1, f1 = L.crystal_point(up, r, sides); v2, f2 = L.crystal_point(down, r, sides)
    v2 = v2 * np.array([1, 1, -1]); f2 = [q[::-1] for q in f2]
    return L.merge([(v1, f1), (v2, f2)])

def join(name, parts):
    """parts: [(finalized object, Matrix)] -> one mesh object, one material slot per distinct material."""
    import bmesh
    bm = bmesh.new(); slots = []
    for ob, M in parts:
        mat = ob.data.materials[0]
        if mat not in slots: slots.append(mat)
        me = ob.data.copy(); me.transform(M)
        n0 = len(bm.faces); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        for i in range(n0, len(bm.faces)): bm.faces[i].material_index = slots.index(mat)
        bpy.data.meshes.remove(me); bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in slots: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob

def anchor(name, loc, parent):
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.15; bpy.context.scene.collection.objects.link(e)
    e.parent = parent; e.location = loc; return e

def tube(pts, r0, r1, mat, sides=7, tone=None, seed=0, tile=0.6):
    ob = L.tube(f"tube{seed}", pts, r0, r1, mat, sides=sides, seed=seed)
    return L.finalize(ob, tone, tile=tile, smooth_angle=60)

def rod(a, b, r, mat, seg=6, tone=None):
    ln = (Vector(b) - Vector(a)).length; V, F = lathe([(0.0, 0.0), (r, 0.0), (r, ln), (0.0, ln)], seg)
    return obj("rod", V, F, mat, tone or tint([0.9, 0.9, 0.9], 3, 0.08), tile=0.4, sa=50), L.between(a, b)

class side_stone:
    """Temporarily make the landmark masonry helpers (block, pier, voussoir) cut a different stone."""
    def __init__(self, mat): self.mat = mat
    def __enter__(self): self.old = MATS["Stone"]; MATS["Stone"] = MATS[self.mat]
    def __exit__(self, *a): MATS["Stone"] = self.old

def basalt_tone(seed):
    return lambda p, n: np.clip(np.stack([0.95 + 0.25 * fbm(p, seed, 1.8, 2)] * 3, -1) * np.array([1.0, 0.97, 1.03]), 0, 1)

def course_tone(seed, base_tone, course=0.45):
    """Ashlar courses painted on a lathe: dark mortar lines every `course` metres and a tone per course."""
    def f(p, n):
        c = base_tone(p, n); z = p[:, 2] / course; fz = z - np.floor(z)
        line = np.exp(-((np.minimum(fz, 1 - fz)) / 0.05) ** 2)
        per = 0.9 + 0.2 * (np.sin(np.floor(z) * 12.9898 + seed) * 0.5 + 0.5)
        return np.clip(c * (per * (1 - 0.45 * line))[:, None], 0, 1)
    return f

def claw(base, top, bend, r0, r1, mat, tone, seed, n=6):
    """Curved prong from base to top, bowed by `bend` (a vector)."""
    pts = [tuple(np.array(base) + (np.array(top) - np.array(base)) * t + np.array(bend) * math.sin(t * math.pi)) for t in np.linspace(0, 1, n)]
    return tube(pts, r0, r1, mat, sides=6, tone=tone, seed=seed)

STONE_T = lambda s: L.ashlar_tone(s)

def solid_pier(w, d, h, mat, tone, seed, taper=0.92, course=0.5, cap=True):
    """A dressed, chamfered, gently tapering pier with painted courses, a plinth and a projecting cap."""
    V, F = boxv(w, d, h, 0.05, seg=(3, 3, max(2, int(h / 0.5))))
    t = (V[:, 2] + 1) / 2; V[:, 0] *= 1 - (1 - taper) * t; V[:, 1] *= 1 - (1 - taper) * t; V[:, 2] += h / 2
    ridge, f1 = L.cellular(V, seed, 2.4); V[:, :2] += np.sign(V[:, :2]) * (0.012 * np.clip(ridge * 2, 0, 1))[:, None]
    out = [(obj("shaft", V, F, mat, course_tone(seed, tone, course), tile=1.2, sa=30), Matrix())]
    v, f = boxv(w * 1.22, d * 1.22, 0.36, 0.05); out.append((obj("plinth", v, f, mat, tone, tile=1.2, sa=30), T(0, 0, 0.18)))
    if cap:
        v, f = boxv(w * taper * 1.25, d * taper * 1.25, 0.26, 0.05); out.append((obj("cap", v, f, mat, tone, tile=1.2, sa=30), T(0, 0, h + 0.13)))
    return out
BRASS_T = tint([0.95, 0.93, 0.9], 7, 0.08)
IRON_T = tint([0.95, 0.95, 0.95], 8, 0.12)
BONE_T = tint([1.0, 0.98, 0.95], 9, 0.1)
WOOD_T = tint([0.95, 0.92, 0.88], 10, 0.15)
DARKWOOD_T = tint([0.42, 0.34, 0.33], 11, 0.15)

# ----------------------------------------------------------------------------------------------
# hearts
# ----------------------------------------------------------------------------------------------
def heart_crystal(name, mat, seed, size=1.0, jag=0.0):
    r = np.random.default_rng(seed); parts = [bipyramid(1.25 * size, 0.85 * size, 0.5 * size, 6)]
    for k in range(7):
        a = k / 7 * TAU + r.random() * 0.4; L_ = (0.35 + 0.25 * r.random()) * size * (1 + jag * r.random())
        v, f = L.crystal_point(L_, L_ * 0.22); axis = (math.cos(a) * (0.8 + jag), math.sin(a) * (0.8 + jag), 0.6 - 0.9 * (k % 2) * jag)
        parts.append((L.place(v, (math.cos(a) * 0.32 * size, math.sin(a) * 0.32 * size, (r.random() - 0.5) * 0.4 * size), axis, spin=k), f))
    V, F = L.merge(parts); return obj(name, V, F, mat, None, tile=1.2, sa=20)

def heart_ring(name, R_, mat, seed, beads=None, spikes=False):
    parts = [(obj("ring", *torus(R_, 0.055, 32, 6), mat, BRASS_T if mat == "Brass" else IRON_T, tile=0.5, sa=60), Matrix())]
    for k in range(8):
        a = k / 8 * TAU
        if beads:
            v, f = bipyramid(0.12, 0.12, 0.06, 4)
            parts.append((obj("bead", v, f, beads, None, tile=0.5, sa=20), T(math.cos(a) * R_, math.sin(a) * R_, 0)))
        if spikes:
            v, f = L.crystal_point(0.28, 0.06, 5)
            parts.append((obj("spk", v, f, mat, IRON_T, tile=0.4, sa=30), T(math.cos(a) * R_, math.sin(a) * R_, 0) @ R(a, "Z") @ R(math.pi / 2, "Y")))
    return join(name, parts)

def plinth(seg, mat, tone, r_lo=3.4, r_hi=2.7):
    prof = [(0.0, -0.25), (r_lo, -0.25), (r_lo, 0.36), (r_lo - 0.18, 0.42), (r_hi, 0.44), (r_hi, 0.84), (r_hi - 0.2, 0.9), (0.0, 0.9)]
    V, F = lathe(prof, seg)
    ridge, f1 = L.cellular(V, 77, 2.0); rr = np.linalg.norm(V[:, :2], axis=1, keepdims=True) + 1e-6
    V[:, :2] += V[:, :2] / rr * (0.03 * np.clip(ridge * 2, 0, 1) - 0.02 * f1)[:, None] * (rr > 0.5)
    return obj("plinth", V, F, mat, course_tone(3, tone, 0.44), tile=1.4, sa=30)

def build_d_heart():
    p = []
    p.append((plinth(8, "Stone", STONE_T(901)), Matrix()))
    # hearth: dressed block body with a glowing mouth framed in brass
    with side_stone("Stone"):
        p.append((L.block(921, 2.3, 1.6, 1.5, 0.05, seg=(4, 3, 3)), T(0, 0.35, 1.65)))
        p.append((L.block(922, 2.6, 1.9, 0.22, 0.04), T(0, 0.35, 2.5)))
    ev, ef = boxv(1.05, 0.12, 0.62, 0.01); p.append((obj("mouth", ev, ef, "Ember", None, tile=0.6, sa=20), T(0, -0.42, 1.48)))
    arch = [(-0.62, -0.5, 0.95), (-0.62, -0.5, 1.6), (-0.4, -0.5, 1.92), (0.0, -0.5, 2.02), (0.4, -0.5, 1.92), (0.62, -0.5, 1.6), (0.62, -0.5, 0.95)]
    p.append((tube(arch, 0.07, 0.07, "Brass", 6, BRASS_T, 1), Matrix()))
    # brass hood and stone chimney behind, leaving the air above clear for the heart
    hv, hf = lathe([(1.25, 0.0), (1.25, 0.08), (0.55, 0.85), (0.4, 0.95), (0.0, 0.95)], 4)
    p.append((obj("hood", hv, hf, "Brass", BRASS_T, tile=0.6, sa=30), T(0, 0.6, 2.6) @ R(math.pi / 4, "Z")))
    cv, cf = lathe([(0.0, 0.0), (0.42, 0.0), (0.36, 1.4), (0.48, 1.5), (0.48, 1.68), (0.3, 1.7), (0.0, 1.6)], 8)
    p.append((obj("chim", cv, cf, "Stone", course_tone(5, STONE_T(925), 0.35), tile=1.0, sa=35), T(0, 0.95, 3.3)))
    # anvil (iron on a wood stump) and a quench trough
    p.append((obj("stump", *disc_lathe(0.42, 0.38, 0, 0.55, 10), "Wood", WOOD_T, tile=0.6), T(-1.45, -1.25, 0.9)))
    av, af = boxv(0.9, 0.36, 0.22, 0.03); p.append((obj("anv", av, af, "Iron", IRON_T, tile=0.4), T(-1.45, -1.25, 1.78)))
    av, af = boxv(0.4, 0.3, 0.3, 0.02); p.append((obj("anv2", av, af, "Iron", IRON_T, tile=0.4), T(-1.45, -1.25, 1.55)))
    hv2, hf2 = L.crystal_point(0.42, 0.12, 4); p.append((obj("horn", hv2, hf2, "Iron", IRON_T, tile=0.4), T(-1.9, -1.25, 1.8) @ R(-math.pi / 2, "Y")))
    tv, tf = boxv(1.1, 0.6, 0.55, 0.03); p.append((obj("trough", tv, tf, "Wood", WOOD_T, tile=0.6), T(1.45, -1.2, 1.17)))
    wv, wf = boxv(0.95, 0.46, 0.04, 0.0); p.append((obj("quench", wv, wf, "Crystal", None, tile=0.6), T(1.45, -1.2, 1.42)))
    for x in (-0.55, 0.55):
        b = rod((1.45 + x, -1.52, 0.92), (1.45 + x, -1.52, 1.46), 0.035, "Brass"); p.append(b)
    # four brass cradle claws reaching for the floating heart
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; c, s = math.cos(a), math.sin(a)
        p.append((obj("post", *disc_lathe(0.22, 0.17, 0, 2.4, 8), "Stone", STONE_T(930 + k), tile=0.8, sa=35), T(2.25 * c, 2.25 * s - 0.25, 0.9)))
        top = (2.25 * c, 2.25 * s - 0.25, 3.42); knee = (1.75 * c, 1.75 * s - 0.35, 4.55); tip = (1.12 * c, 1.12 * s - 0.45, 4.95)
        p.append(rod(top, knee, 0.045, "Brass", 6)); p.append(rod(knee, tip, 0.04, "Brass", 6))
        p.append((obj("cap", *lathe([(0.0, 0.0), (0.27, 0.0), (0.27, 0.08), (0.2, 0.14), (0.08, 0.2), (0.0, 0.22)], 8), "Brass", BRASS_T, tile=0.5), T(2.25 * c, 2.25 * s - 0.25, 3.3)))
        v, f = bipyramid(0.14, 0.1, 0.06, 4); p.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(*knee)))
    p.append((obj("halo", *torus(1.18, 0.05, 32, 6), "Brass", BRASS_T, tile=0.4), T(0, -0.45, 4.97)))
    # leather bellows on the hearth's flank and glowing rune lines round the upper step
    bv, bf = lathe([(0.0, 0.0), (0.42, 0.0), (0.5, 0.25), (0.42, 0.5), (0.0, 0.6)], 8)
    p.append((obj("bellows", bv * np.array([1, 0.55, 1]), bf, "Cloth", tint([0.45, 0.3, 0.2], 5, 0.12), tile=0.5, sa=50), T(1.42, 0.5, 1.2) @ R(math.pi / 2, "Y")))
    p.append(rod((1.75, 0.5, 1.2), (2.05, 0.5, 1.45), 0.05, "Wood", 5, WOOD_T))
    for k in range(8):
        a = k / 8 * TAU + math.pi / 8; c, s_ = math.cos(a), math.sin(a)
        if abs(math.atan2(s_, c) + math.pi / 2) < 0.5: continue
        v, f = boxv(1.1, 0.05, 0.06, 0.0); p.append((obj("rune", v, f, "Crystal", None, tile=0.3, sa=20), T(2.62 * c, 2.62 * s_, 0.64) @ R(a + math.pi / 2, "Z")))
    for x, ln in ((-0.45, 0.9), (-0.2, 0.8)):
        p.append(rod((-1.85 + x, -0.55, 0.92), (-1.85 + x, -0.55, 0.92 + ln), 0.03, "Wood", 5, WOOD_T))
    v, f = boxv(0.32, 0.18, 0.16, 0.02); p.append((obj("hammerhead", v, f, "Iron", IRON_T, tile=0.3), T(-2.3, -0.55, 1.82)))
    ob = join("D_Heart", p); anchor("D_Heart_Core", (0, -0.5, 5.75), ob)
    heart_crystal("D_HeartCrystal", "Crystal", 950)
    heart_ring("D_HeartRingA", 1.25, "Brass", 951, beads="Crystal"); heart_ring("D_HeartRingB", 1.55, "Brass", 952)

def goofy_skull(seed, rx, ry, rz, eye_big=1.25, eyes_mat="Ooze", teeth=True):
    """Cartoon bone skull facing -Y: big round cranium, sunken sockets (one bigger), glowing pupils, a stubby muzzle
    with a painted nose and two buck teeth. Goofy, never grim."""
    V, F = ellipsoid(rx, ry, rz, 20, 14)
    eyes = [(-0.36 * rx, 0.06 * rz, 1.0), (0.37 * rx, 0.1 * rz, eye_big)]
    front = V[:, 1] < -0.15 * ry
    for ex, ez, k in eyes:
        d = np.hypot((V[:, 0] - ex) / (0.27 * rx * k), (V[:, 2] - ez) / (0.3 * rz * k))
        V[:, 1] += np.clip(1 - d, 0, 1) ** 0.6 * 0.38 * ry * front
    def tone(p_, n_):
        c = BONE_T(p_, n_)
        for ex, ez, k in eyes:
            d = np.hypot((p_[:, 0] - ex) / (0.27 * rx * k), (p_[:, 2] - ez) / (0.3 * rz * k))
            c[(d < 1.06) & (p_[:, 1] < -0.1 * ry)] = [0.07, 0.04, 0.09]
        return c
    parts = [(obj("skull", V, F, "Bone", tone, tile=0.8, sa=60), Matrix())]
    mv, mf = ellipsoid(0.62 * rx, 0.78 * ry, 0.42 * rz, 16, 10); mz = -0.6 * rz
    def mtone(p_, n_):
        c = BONE_T(p_, n_); x, z = p_[:, 0], p_[:, 2] - 0.2 * rz
        nose = (np.abs(x) < 0.14 * rx * (1 - z / (0.22 * rz)) ** 0.8) & (z > -0.12 * rz) & (z < 0.2 * rz) & (p_[:, 1] < -0.5 * ry)
        c[nose] = [0.08, 0.05, 0.09]; return c
    parts.append((obj("muzzle", mv, mf, "Bone", mtone, tile=0.8, sa=60), T(0, -0.14 * ry, mz)))
    for ex, ez, k in eyes:
        pv, pf = ellipsoid(0.12 * rx * k, 0.08 * ry, 0.13 * rz * k, 10, 6)
        parts.append((obj("pupil", pv, pf, eyes_mat, None, tile=0.4, sa=60), T(ex + 0.04 * rx * k, -0.66 * ry, ez - 0.05 * rz)))
    if teeth:
        for x in (-0.1 * rx, 0.1 * rx):
            tv, tf = boxv(0.17 * rx, 0.1 * ry, 0.26 * rz, 0.015); parts.append((obj("tooth", tv, tf, "Bone", tint([1, 1, 0.97], 9, 0.05), tile=0.4), T(x, -0.88 * ry, mz - 0.36 * rz)))
    return parts

def build_g_heart():
    p = [(plinth(6, "Basalt", basalt_tone(961)), Matrix())]
    # the cauldron forge, brimming with ooze
    cv, cf = lathe([(0.0, 0.0), (0.9, 0.0), (1.35, 0.32), (1.55, 0.85), (1.48, 1.3), (1.62, 1.4), (1.58, 1.52), (1.38, 1.48), (1.32, 1.2), (0.0, 1.05)], 16)
    p.append((obj("cauldron", cv, cf, "Iron", IRON_T, tile=0.8, sa=40), T(0, 0.45, 0.9)))
    p.append((obj("ooze", *disc_lathe(1.36, 1.36, 0, 0.02, 16), "Ooze", None, tile=0.8), T(0, 0.45, 2.28)))
    for k in range(3):  # stubby claw feet
        a = k / 3 * TAU + math.pi / 2; p.append((claw((0.95 * math.cos(a), 0.45 + 0.95 * math.sin(a), 1.15), (1.6 * math.cos(a), 0.45 + 1.6 * math.sin(a), 0.92), (0, 0, 0.2), 0.16, 0.06, "Bone", BONE_T, 60 + k), Matrix()))
    for prt, M in goofy_skull(964, 0.85, 0.62, 0.78): p.append((prt, T(0, -1.18, 1.95) @ M))
    # crooked chimney of iron drums at the back
    z = 0.9; x = 0.0
    for i in range(6):
        dv, df = lathe([(0.0, 0.0), (0.36, 0.0), (0.4, 0.05), (0.4, 0.55), (0.36, 0.62), (0.0, 0.62)], 10)
        tilt = (0.12 if i % 2 else -0.1); p.append((obj("drum", dv, df, "Iron", IRON_T, tile=0.6), T(x, 2.3, z) @ R(tilt, "Y")))
        x += math.sin(tilt) * 0.62; z += 0.6
    # four bone ribs curling up to cradle the heart
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; c, s = math.cos(a), math.sin(a)
        p.append((claw((2.35 * c, 2.35 * s, 0.85), (0.85 * c, 0.85 * s + 0.25, 5.25), (0.7 * c, 0.7 * s, 0.3), 0.12, 0.04, "Bone", BONE_T, 70 + k, 8), Matrix()))
        p.append((obj("knuckle", *ellipsoid(0.2, 0.2, 0.16, 8, 5), "Bone", BONE_T, tile=0.3), T(2.35 * c, 2.35 * s, 0.92)))
    ob = join("G_Heart", p); anchor("G_Heart_Core", (0, 0.25, 5.75), ob)
    heart_crystal("G_HeartCrystal", "Amethyst", 970, 1.0, jag=0.6)
    heart_ring("G_HeartRingA", 1.3, "Iron", 971, spikes=True); heart_ring("G_HeartRingB", 1.6, "Iron", 972, beads="Amethyst")

# ----------------------------------------------------------------------------------------------
# barracks
# ----------------------------------------------------------------------------------------------
def banner(w, h, rgb, sigil, seed, tatter=0.0):
    V, F = L.grid_box(4, 1, 8); P = V * np.array([w / 2, 0.02, h / 2])
    bot = V[:, 2] < -0.99; P[bot, 2] -= h * 0.14 * (1 - np.abs(V[bot, 0]))                # pointed pennant
    P[:, 1] += 0.05 * np.sin(P[:, 2] * 3 + seed) * (0.5 - P[:, 2] / h)                    # hangs in a soft wave
    if tatter: P[V[:, 2] < -0.99, 2] += tatter * np.abs(np.sin(P[V[:, 2] < -0.99, 0] * 17 + seed))
    rgb = np.array(rgb); sig = np.array(sigil)
    def tone(p, n):
        c = np.tile(rgb, (len(p), 1)) * (1 + 0.1 * fbm(p, seed, 2.0, 2))[:, None]
        d = np.abs(p[:, 0]) / (w * 0.22) + np.abs(p[:, 2] - h * 0.1) / (h * 0.16)
        c[d < 1] = sig; c[(d > 1) & (d < 1.18)] = sig * 0.75
        c[np.abs(p[:, 0]) > w * 0.42] *= 0.7  # hemmed edges
        return np.clip(c, 0, 1)
    return obj("banner", P, F, "Cloth", tone, tile=0.5, sa=60)

def timber_frame(w, d, z0, z1, beams, seed):
    """Posts and beams just proud of a w x d wall box (wood, as joined parts)."""
    out = []; t = 0.22
    for x in (-w / 2, w / 2):
        for y in (-d / 2, d / 2):
            v, f = boxv(t, t, z1 - z0, 0.02); out.append((obj("post", v, f, "Wood", WOOD_T, tile=0.8), T(x, y, (z0 + z1) / 2)))
    for z in beams:
        for y in (-d / 2, d / 2):
            v, f = boxv(w + t, t * 0.9, t * 0.9, 0.02); out.append((obj("beam", v, f, "Wood", WOOD_T, tile=0.8), T(0, y, z)))
        for x in (-w / 2, w / 2):
            v, f = boxv(t * 0.9, d + t, t * 0.9, 0.02); out.append((obj("beam", v, f, "Wood", WOOD_T, tile=0.8), T(x, 0, z)))
    return out

def build_d_barracks():
    p = []; W, D, Z0, Z1 = 5.9, 3.9, 0.6, 3.4
    with side_stone("Stone"):
        p.append((L.block(1001, 6.6, 4.6, 0.62, 0.05, seg=(6, 4, 2)), T(0, 0, 0.31)))
        p.append((L.block(1002, 2.0, 0.6, 0.3, 0.04), T(0, -2.55, 0.15)))
    v, f = boxv(W, D, Z1 - Z0, 0.0, seg=(6, 4, 3)); p.append((obj("walls", v, f, "Plaster", None, tile=1.6), T(0, 0, (Z0 + Z1) / 2)))
    p += timber_frame(W, D, Z0, Z1 + 0.1, (Z0 + 0.1, 1.85, Z1), 1003)
    for sx in (-1, 1):  # side braces
        for y in (-1, 1):
            a, b = (sx * W / 2 + sx * 0.02, y * 0.4, 1.95), (sx * W / 2 + sx * 0.02, y * 1.8, 2.9)
            p.append(rod(a, b, 0.08, "Wood", 4, WOOD_T))
    # gable roof (ridge along X), slate on purlins, plaster gables
    zr, ov = 5.5, 0.45; run = D / 2 + ov; rise = zr - (Z1 - 0.25); ang = math.atan2(rise, run); ln = math.hypot(run, rise) + 0.15
    for s in (-1, 1):
        v, f = boxv(W + 1.0, ln, 0.16, 0.02, seg=(6, 4, 1))
        p.append((obj("roof", v, f, "Slate", tint([0.95, 0.97, 1.0], 12, 0.06), tile=2.4, sa=30), T(0, s * run / 2, Z1 - 0.25 + rise / 2 + 0.08) @ R(-s * ang, "X")))
    gv = np.array([[-D / 2, Z1], [D / 2, Z1], [0, zr - 0.15]]); P, F = [], []
    for x in (-W / 2 + 0.05, W / 2 - 0.05):
        for (y, z) in gv: P.append((x, y, z))
    F = [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]]
    p.append((obj("gable", np.array(P, float), F, "Plaster", None, tile=1.6), Matrix()))
    p.append(rod((-W / 2 - 0.5, 0, zr + 0.12), (W / 2 + 0.5, 0, zr + 0.12), 0.1, "Brass", 8))
    for x in (-W / 2 - 0.5, W / 2 + 0.5):
        v, f = L.crystal_point(0.6, 0.12); p.append((obj("fin", v, f, "Crystal", None, tile=0.5, sa=20), T(x, 0, zr + 0.15)))
    # front: double door, lintel with a crystal sigil, glowing windows, banners
    for x in (-0.82, 0.82):
        v, f = boxv(0.22, 0.24, 2.2, 0.03); p.append((obj("jamb", v, f, "Wood", tint([0.7, 0.62, 0.55], 4, 0.1), tile=0.7), T(x, -D / 2 - 0.08, Z0 + 1.1)))
    v, f = boxv(1.45, 0.12, 2.0, 0.02, seg=(4, 1, 3)); door_tone = lambda p_, n: np.clip(np.stack([0.55 + 0.25 * (np.sin(p_[:, 0] * 14) > 0.9) * -1 + 0.1 * fbm(p_, 5, 2, 2)] * 3, -1) * np.array([1, 0.92, 0.85]) + 0.25, 0, 1)
    p.append((obj("door", v, f, "Wood", door_tone, tile=0.7), T(0, -D / 2 - 0.05, Z0 + 1.0)))
    for x in (-0.35, 0.35): p.append((obj("ring", *torus(0.13, 0.025, 12, 5), "Brass", BRASS_T, tile=0.3), T(x, -D / 2 - 0.13, Z0 + 1.1) @ R(math.pi / 2, "X")))
    with side_stone("Stone"): p.append((L.block(1004, 1.9, 0.3, 0.26, 0.04), T(0, -D / 2 - 0.1, Z0 + 2.33)))
    v, f = bipyramid(0.16, 0.16, 0.09, 4); p.append((obj("sig", v, f, "Crystal", None, tile=0.4, sa=20), T(0, -D / 2 - 0.3, Z0 + 2.33) @ R(math.pi / 2, "X")))
    for x in (-1.95, 1.95):
        v, f = boxv(0.8, 0.06, 0.9, 0.0); p.append((obj("pane", v, f, "Crystal", None, tile=0.5, sa=20), T(x, -D / 2 - 0.02, 2.15)))
        for (a, b) in [((-0.45, 1.68), (0.45, 1.68)), ((-0.45, 2.62), (0.45, 2.62)), ((-0.45, 1.68), (-0.45, 2.62)), ((0.45, 1.68), (0.45, 2.62)), ((0, 1.68), (0, 2.62)), ((-0.45, 2.15), (0.45, 2.15))]:
            p.append(rod((x + a[0], -D / 2 - 0.08, a[1]), (x + b[0], -D / 2 - 0.08, b[1]), 0.035, "Brass", 5))
        v, f = boxv(1.15, 0.16, 0.14, 0.02); p.append((obj("sill", v, f, "Wood", WOOD_T, tile=0.6), T(x, -D / 2 - 0.12, 1.63)))
        for sx in (-1, 1):
            v, f = boxv(0.42, 0.06, 1.0, 0.01); p.append((obj("shutter", v, f, "Wood", tint([0.38, 0.5, 0.75], 6, 0.12), tile=0.6), T(x + sx * 0.68, -D / 2 - 0.06, 2.15)))
    for x in (-1.0, 1.0):
        p.append((banner(0.5, 1.4, [0.16, 0.32, 0.78], [0.95, 0.78, 0.36], 1005 + int(x)), T(x * 1.17, -D / 2 - 0.2, 2.3)))
        p.append(rod((x * 1.17 - 0.33, -D / 2 - 0.2, 3.02), (x * 1.17 + 0.33, -D / 2 - 0.2, 3.02), 0.03, "Brass", 5))
    # chimney through the back slope
    with side_stone("Stone"): p.append((L.block(1006, 0.7, 0.7, 2.6, 0.04, seg=(2, 2, 4)), T(-2.0, 0.95, 4.9)))
    p.append((obj("pot", *disc_lathe(0.18, 0.2, 0, 0.35, 8), "Brass", BRASS_T, tile=0.4), T(-2.0, 0.95, 6.2)))
    # bell post by the door (the bell itself is D_Bell)
    p.append((obj("bpost", *disc_lathe(0.13, 0.11, 0, 2.95, 8), "Wood", WOOD_T, tile=0.6), T(2.95, -2.75, 0)))
    p.append((obj("bfoot", *disc_lathe(0.3, 0.22, 0, 0.3, 8), "Stone", STONE_T(1007), tile=0.6), T(2.95, -2.75, 0)))
    p.append(rod((3.05, -2.75, 2.8), (2.1, -2.75, 2.8), 0.07, "Wood", 6, WOOD_T)); p.append(rod((2.95, -2.75, 2.2), (2.45, -2.75, 2.78), 0.05, "Wood", 5, WOOD_T))
    ob = join("D_Barracks", p); anchor("D_Barracks_Bell", (2.25, -2.75, 2.72), ob)
    bv, bf = lathe([(0.0, 0.0), (0.07, 0.0), (0.14, -0.04), (0.19, -0.18), (0.22, -0.42), (0.31, -0.56), (0.34, -0.62), (0.3, -0.62), (0.0, -0.6)], 16)
    parts = [(obj("bell", bv, bf, "Brass", BRASS_T, tile=0.4, sa=40), Matrix()), (obj("clap", *ellipsoid(0.06, 0.06, 0.08, 8, 5), "Iron", IRON_T, tile=0.3), T(0, 0, -0.6))]
    parts.append(rod((0, 0, -0.05), (0, 0, -0.55), 0.015, "Iron", 4)); join("D_Bell", parts)

def build_g_barracks():
    p = []; W, D, Z0, Z1 = 5.9, 3.9, 0.6, 2.9
    with side_stone("Basalt"):
        p.append((L.block(1101, 6.6, 4.6, 0.62, 0.06, seg=(6, 4, 2), tone=basalt_tone(1101)), T(0, 0, 0.31)))
        for x in (-W / 2, W / 2):
            for y in (-D / 2, D / 2): p.append((L.block(1102 + int(x + y), 0.6, 0.6, Z1 - Z0 + 0.3, 0.05, seg=(2, 2, 3), tone=basalt_tone(1103)), T(x, y, (Z0 + Z1 + 0.3) / 2)))
    plank = lambda p_, n: np.clip(np.stack([0.38 + 0.12 * np.sin(np.floor((p_[:, 0] + p_[:, 1]) / 0.32) * 7.1) + 0.06 * fbm(p_, 3, 2, 2)] * 3, -1) * np.array([1.0, 0.82, 0.78]), 0, 1)
    v, f = boxv(W, D, Z1 - Z0, 0.0, seg=(6, 4, 3)); p.append((obj("walls", v, f, "Wood", plank, tile=0.9), T(0, 0, (Z0 + Z1) / 2)))
    for z in (1.15, 2.35):
        for y in (-D / 2 - 0.03, D / 2 + 0.03):
            v, f = boxv(W, 0.05, 0.12, 0.01); p.append((obj("strap", v, f, "Iron", IRON_T, tile=0.5), T(0, y, z)))
        for x in (-W / 2 - 0.03, W / 2 + 0.03):
            v, f = boxv(0.05, D, 0.12, 0.01); p.append((obj("strap", v, f, "Iron", IRON_T, tile=0.5), T(x, 0, z)))
    # rib-bone roof with sagging, patched purple cloth between the ribs
    ribs = np.linspace(-W / 2 - 0.2, W / 2 + 0.2, 6)
    arch = lambda t, rr: (math.cos(t) * (D / 2 + 0.35) * rr, Z1 - 0.1 + math.sin(t) * 2.3 * rr)
    for i, x in enumerate(ribs):
        pts = [(x, *arch(t, 1.04)) for t in np.linspace(0.0, math.pi, 9)]
        p.append((tube(pts, 0.17, 0.17, "Bone", 7, BONE_T, 1110 + i), Matrix()))
        for s in (0, -1):
            knob = pts[s]
            if s == -1 and abs(x) < 1.8: continue  # the skull facade sits here
            p.append((obj("knob", *ellipsoid(0.24, 0.24, 0.2, 10, 6), "Bone", BONE_T, tile=0.4), T(*knob)))
    nu, nv = 40, 16; P, F = [], []
    for i in range(nu + 1):
        u = i / nu; x = ribs[0] + (ribs[-1] - ribs[0]) * u; fr = (u * (len(ribs) - 1)) % 1.0; sag = 1 - 0.07 * math.sin(fr * math.pi)
        for j in range(nv + 1):
            t = j / nv * math.pi; y, z = arch(t, sag)
            if j in (0, nv): z -= 0.25 * abs(math.sin(i * 1.7))  # tattered hem
            P.append((x, y, z))
    for i in range(nu):
        for j in range(nv): a = i * (nv + 1) + j; F.append([a, a + nv + 1, a + nv + 2, a + 1])
    def cloth_tone(p_, n):
        c = np.tile([0.40, 0.22, 0.52], (len(p_), 1)) * (1 + 0.12 * fbm(p_, 7, 1.5, 2))[:, None]
        patch = (np.abs(((p_[:, 0] + 1.3) % 2.1) - 1.05) < 0.3) & (np.abs(p_[:, 2] - 4.0) < 0.35)
        c[patch] = [0.55, 0.42, 0.25]  # goofy sack-cloth patches
        return np.clip(c, 0, 1)
    p.append((obj("cloth", np.array(P), F, "Cloth", cloth_tone, tile=0.8, sa=70), Matrix()))
    # back gable: dark planks
    gv = []; GF = []
    for t in np.linspace(0, math.pi, 9): gv.append(arch(t, 0.98))
    for y_ in (D / 2 + 0.01,):
        pass
    P = [(x_, y, z) for x_ in (-W / 2 + 0.05, W / 2 - 0.05) for (y, z) in gv]; n = len(gv)
    F = [list(range(n))[::-1], list(range(n, 2 * n))]
    p.append((obj("gables", np.array(P, float), F, "Wood", plank, tile=0.9), Matrix()))
    # the goofy skull facade, its open jaw the door
    for prt, M in goofy_skull(1120, 1.35, 0.7, 1.15): p.append((prt, T(0, -D / 2 - 0.35, 2.8) @ M))
    v, f = boxv(1.35, 0.12, 1.55, 0.02, seg=(4, 1, 3)); p.append((obj("door", v, f, "Wood", plank, tile=0.7), T(0, -D / 2 - 0.08, Z0 + 0.78)))
    for i, x in enumerate(np.linspace(-0.55, 0.55, 5)):
        tv, tf = L.crystal_point(0.32 + 0.12 * (i % 2), 0.1, 4)
        p.append((obj("fang", tv, tf, "Bone", BONE_T, tile=0.4), T(x, -D / 2 - 0.2, Z0 + 1.6) @ R(math.pi, "X")))
    for x in (-1.6, 1.6):
        v, f = L.crystal_point(0.7, 0.12, 5); p.append((obj("spike", v, f, "Iron", IRON_T, tile=0.4), T(x * 0.4, -D / 2 - 0.4, 3.75) @ R(-0.4, "X") @ R(x * 0.25, "Y")))
    for x in (-1.0, 1.0):
        p.append((banner(0.75, 1.6, [0.36, 0.14, 0.48], [0.62, 0.95, 0.35], 1130 + int(x), tatter=0.25), T(x * 2.1, -D / 2 - 0.36, 2.0)))
    # gong frame by the door (the gong itself is G_Bell)
    for x in (2.35, 3.25):
        p.append((tube([(x, -2.75, 0.0), (x, -2.75, 1.4), (x + (0.05 if x > 3 else -0.05), -2.75, 2.85)], 0.09, 0.07, "Bone", 6, BONE_T, 1140 + int(x)), Matrix()))
        p.append((obj("knob", *ellipsoid(0.15, 0.15, 0.13, 8, 5), "Bone", BONE_T, tile=0.4), T(x, -2.75, 2.95)))
    p.append(rod((2.2, -2.75, 2.75), (3.4, -2.75, 2.75), 0.06, "Iron", 6))
    ob = join("G_Barracks", p); anchor("G_Barracks_Bell", (2.8, -2.75, 2.7), ob)
    gv_, gf_ = lathe([(0.0, -0.03), (0.48, -0.03), (0.52, 0.0), (0.52, 0.05), (0.46, 0.06), (0.1, 0.02), (0.0, 0.05)], 20)
    gong = obj("gong", gv_, gf_, "Brass", tint([0.75, 0.62, 0.5], 9, 0.15), tile=0.4, sa=40)
    parts = [(gong, T(0, 0, -0.62) @ R(math.pi / 2, "X"))]
    for x in (-0.35, 0.35): parts.append(rod((x, 0, 0.0), (x * 0.7, 0, -0.2), 0.012, "Iron", 4))
    join("G_Bell", parts)

# ----------------------------------------------------------------------------------------------
# fountains
# ----------------------------------------------------------------------------------------------
def build_d_fountain():
    p = []
    bv, bf = lathe([(0.0, 0.3), (1.82, 0.3), (1.82, 0.68), (1.9, 0.74), (2.1, 0.72), (2.1, 0.64), (2.0, 0.58), (2.05, 0.08), (2.0, 0.0), (0.0, 0.0)][::-1], 20)
    p.append((obj("basin", bv, bf, "Stone", course_tone(3, STONE_T(1201), 0.3), tile=1.2, sa=35), Matrix()))
    pv, pf = lathe([(0.0, 0.3), (0.55, 0.3), (0.42, 0.5), (0.3, 0.66), (0.27, 1.25), (0.42, 1.38), (0.9, 1.5), (0.96, 1.6), (0.86, 1.66), (0.8, 1.58), (0.0, 1.5)][::-1], 14)
    p.append((obj("ped", pv, pf, "Stone", STONE_T(1202), tile=1.0, sa=35), Matrix()))
    fv, ff = lathe([(0.0, 1.5), (0.16, 1.5), (0.1, 1.72), (0.2, 1.84), (0.0, 1.95)][::-1], 10)
    p.append((obj("fin", fv, ff, "Brass", BRASS_T, tile=0.4, sa=40), Matrix()))
    p.append((obj("band", *torus(2.07, 0.05, 32, 5), "Brass", BRASS_T, tile=0.4), T(0, 0, 0.66)))
    for k in range(4):
        a = k / 4 * TAU + math.pi / 4; c, s = math.cos(a), math.sin(a)
        p.append((claw((0.3 * c, 0.3 * s, 1.05), (0.8 * c, 0.8 * s, 0.98), (0, 0, 0.2), 0.07, 0.045, "Brass", BRASS_T, 1210 + k, 5), Matrix()))
    ob = join("D_Fountain", p); anchor("D_Fountain_Crystal", (0, 0, 2.45), ob)
    w1 = obj("w1", *disc_lathe(1.84, 1.84, 0, 0.0, 28), "Crystal", None, tile=1.0); w2 = obj("w2", *disc_lathe(0.82, 0.82, 0, 0.0, 16), "Crystal", None, tile=1.0)
    join("D_FountainWater", [(w1, T(0, 0, 0.62)), (w2, T(0, 0, 1.58))])
    v, f = bipyramid(0.35, 0.28, 0.16, 6); obj("D_FountainCrystal", v, f, "Crystal", None, tile=0.6, sa=20)

def build_g_fountain():
    p = []
    cv, cf = lathe([(0.0, 0.42), (0.85, 0.42), (1.35, 0.62), (1.55, 1.0), (1.5, 1.32), (1.64, 1.42), (1.6, 1.52), (1.42, 1.5), (1.38, 1.3), (1.28, 0.85), (0.85, 0.6), (0.0, 0.55)], 16)
    p.append((obj("pot", cv, cf, "Iron", IRON_T, tile=0.8, sa=40), Matrix()))
    for k in range(3):
        a = k / 3 * TAU + 0.5; c, s = math.cos(a), math.sin(a)
        p.append((claw((0.85 * c, 0.85 * s, 0.6), (1.35 * c, 1.35 * s, 0.05), (0.2 * c, 0.2 * s, 0.1), 0.17, 0.1, "Bone", BONE_T, 1300 + k), Matrix()))
        for t in (-0.4, 0, 0.4):
            v, f = L.crystal_point(0.28, 0.06, 4); p.append((obj("toe", v, f, "Bone", BONE_T, tile=0.3), T(1.35 * c, 1.35 * s, 0.05) @ R(a + t, "Z") @ R(math.pi / 2, "Y")))
    p.append((tube([(0.3, -0.4, 1.0), (0.9, -0.9, 1.6), (1.3, -1.35, 2.05)], 0.06, 0.05, "Bone", 6, BONE_T, 1310), Matrix()))
    p.append((obj("ladle", *ellipsoid(0.22, 0.22, 0.12, 10, 6), "Bone", BONE_T, tile=0.3), T(1.35, -1.4, 2.08)))
    for k, a in enumerate((-math.pi / 2 - 0.5, -math.pi / 2 + 0.55)):
        for prt, M in goofy_skull(1320 + k, 0.24, 0.2, 0.22, eye_big=1.3, teeth=False):
            p.append((prt, T(1.55 * math.cos(a), 1.55 * math.sin(a), 1.62) @ R(a + math.pi / 2, "Z") @ M))
    ob = join("G_Fountain", p); anchor("G_Fountain_Crystal", (0, 0, 2.3), ob)
    obj("G_FountainWater", *disc_lathe(1.42, 1.42, 1.38, 1.38, 24), "Ooze", None, tile=1.0)
    v, f = bipyramid(0.3, 0.24, 0.14, 5); obj("G_FountainCrystal", v, f, "Amethyst", None, tile=0.6, sa=20)

# ----------------------------------------------------------------------------------------------
# pylons, spires
# ----------------------------------------------------------------------------------------------
def build_d_pylon():
    p = [(obj("base", *lathe([(0.0, 0.0), (0.95, 0.0), (0.95, 0.3), (0.8, 0.36), (0.8, 0.5), (0.0, 0.5)], 8), "Stone", STONE_T(1401), tile=1.0, sa=30), Matrix())]
    for prt, M in solid_pier(0.74, 0.74, 3.62, "Stone", STONE_T(1402), 1402, taper=0.8, course=0.46): p.append((prt, T(0, 0, 0.5) @ M))
    for z in (1.4, 2.8):
        p.append((obj("band", *lathe([(0.39, -0.06), (0.43, -0.06), (0.43, 0.06), (0.39, 0.06), (0.39, -0.06)], 4), "Brass", BRASS_T, tile=0.4), T(0, 0, z) @ R(math.pi / 4, "Z")))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; c, s = math.cos(a), math.sin(a)
        p.append((claw((0.38 * c, 0.38 * s, 4.38), (0.3 * c, 0.3 * s, 5.35), (0.25 * c, 0.25 * s, 0.1), 0.07, 0.025, "Brass", BRASS_T, 1410 + k), Matrix()))
    v, f = boxv(0.3, 0.06, 0.3, 0.0); p.append((obj("rune", v, f, "Crystal", None, tile=0.4, sa=20), T(0, -0.37, 3.6) @ R(math.pi / 4, "Y")))
    ob = join("D_Pylon", p); anchor("D_Pylon_Crystal", (0, 0, 5.0), ob)
    heart_crystal("D_PylonCrystal", "Crystal", 1420, 0.5)

def build_g_pylon():
    p = [(obj("base", *lathe([(0.0, 0.0), (0.95, 0.0), (0.95, 0.3), (0.78, 0.38), (0.78, 0.5), (0.0, 0.5)], 6), "Basalt", basalt_tone(1501), tile=1.0, sa=30), Matrix())]
    r = np.random.default_rng(1502); z = 0.5
    with side_stone("Basalt"):
        for i in range(6):
            h = 0.62 - i * 0.02; w = 0.78 - i * 0.05
            p.append((L.block(1503 + i, w, w * 0.9, h, 0.07, tone=basalt_tone(1503 + i)), T((r.random() - 0.5) * 0.08, (r.random() - 0.5) * 0.08, z + h / 2) @ R(r.random() * 1.2, "Z") @ R((r.random() - 0.5) * 0.12, "X")))
            z += h
    for zz in (1.15, 2.4):
        p.append((obj("band", *torus(0.5, 0.05, 6, 4), "Iron", IRON_T, tile=0.4), T(0, 0, zz)))
    for k in range(3):
        a = k / 3 * TAU + 0.3; c, s = math.cos(a), math.sin(a)
        p.append((claw((0.3 * c, 0.3 * s, z - 0.1), (0.36 * c, 0.36 * s, 5.4), (0.35 * c, 0.35 * s, 0.1), 0.12, 0.03, "Bone", BONE_T, 1510 + k), Matrix()))
    ob = join("G_Pylon", p); anchor("G_Pylon_Crystal", (0, 0, 5.0), ob)
    heart_crystal("G_PylonCrystal", "Amethyst", 1520, 0.5, jag=0.6)

def build_d_spire():
    p = [(obj("base", *lathe([(0.0, 0.0), (1.1, 0.0), (1.1, 0.5), (0.92, 0.6), (0.92, 0.8), (0.0, 0.8)], 8), "Stone", STONE_T(1601), tile=1.0, sa=30), Matrix())]
    prof = [(0.0, 0.8), (0.74, 0.8)] + [(0.74 - 0.36 * (t ** 1.2), 0.8 + 4.6 * t) for t in np.linspace(0.05, 1, 10)] + [(0.0, 5.4)]
    V, F = lathe(prof, 8); p.append((obj("shaft", V, F, "Stone", course_tone(9, STONE_T(1602), 0.46), tile=1.0, sa=30), Matrix()))
    rz = lambda z: 0.74 - 0.36 * (((z - 0.8) / 4.6) ** 1.2)
    for z in (1.6, 3.0, 4.4): p.append((obj("ring", *torus(rz(z) + 0.03, 0.06, 8, 5), "Brass", BRASS_T, tile=0.4), T(0, 0, z) @ R(math.pi / 8, "Z")))
    p.append((obj("collar", *lathe([(0.3, 0.0), (0.5, 0.05), (0.52, 0.22), (0.3, 0.25)], 8), "Brass", BRASS_T, tile=0.4), T(0, 0, 5.3)))
    for k in range(4):
        a = k * math.pi / 2; c, s = math.cos(a), math.sin(a)
        p.append((claw((0.45 * c, 0.45 * s, 5.5), (0.22 * c, 0.22 * s, 6.85), (0.35 * c, 0.35 * s, 0.0), 0.06, 0.02, "Brass", BRASS_T, 1610 + k), Matrix()))
    v, f = boxv(0.22, 0.05, 0.42, 0.0)
    for k in range(4):
        a = k * math.pi / 2; p.append((obj("glyph", v, f, "Crystal", None, tile=0.3, sa=20), R(a, "Z") @ T(0, -rz(2.3) - 0.01, 2.3) @ R(-0.07, "X")))
    ob = join("D_Spire", p); anchor("D_Spire_Crystal", (0, 0, 6.15), ob)
    heart_crystal("D_SpireCrystal", "Crystal", 1620, 0.55)

def build_g_spire():
    p = [(obj("base", *lathe([(0.0, 0.0), (1.1, 0.0), (1.1, 0.45), (0.9, 0.55), (0.9, 0.7), (0.0, 0.7)], 6), "Basalt", basalt_tone(1701), tile=1.0, sa=30), Matrix())]
    r = np.random.default_rng(1702)
    for k, (h, rr, lean) in enumerate([(4.2, 0.42, 0.0), (3.3, 0.3, 0.22), (2.7, 0.26, 0.28), (2.2, 0.24, 0.3), (1.8, 0.2, 0.34)]):
        v, f = L.crystal_point(h, rr, 6); ridge, f1 = L.cellular(v, 1703 + k, 2.5)
        rad = np.linalg.norm(v[:, :2], axis=1, keepdims=True) + 1e-6
        v[:, :2] += v[:, :2] / rad * (0.04 * np.clip(ridge * 2, 0, 1) - 0.03 * f1)[:, None] * (rad > 0.05)
        a = k * 1.3 + 0.4; d = 0.0 if k == 0 else 0.4
        p.append((obj("shard", v, f, "Basalt", basalt_tone(1703 + k), tile=1.0, sa=30), T(math.cos(a) * d, math.sin(a) * d, 0.55) @ R(a, "Z") @ R(lean, "Y")))
    p.append((obj("band", *torus(0.62, 0.07, 6, 4), "Iron", IRON_T, tile=0.4), T(0, 0, 1.3)))
    for k in range(3):
        a = k / 3 * TAU; c, s = math.cos(a), math.sin(a)
        v, f = L.crystal_point(0.5, 0.07, 4); p.append((obj("spk", v, f, "Iron", IRON_T, tile=0.3), T(0.62 * c, 0.62 * s, 1.3) @ R(a, "Z") @ R(math.pi / 2 - 0.3, "Y")))
        p.append((claw((0.2 * c, 0.2 * s, 3.6), (0.3 * c, 0.3 * s, 5.2), (0.3 * c, 0.3 * s, 0.0), 0.09, 0.025, "Bone", BONE_T, 1710 + k), Matrix()))
    ob = join("G_Spire", p); anchor("G_Spire_Crystal", (0, 0, 4.75), ob)
    heart_crystal("G_SpireCrystal", "Amethyst", 1720, 0.55, jag=0.6)

# ----------------------------------------------------------------------------------------------
# ballistas: base (fixed) -> yoke (yaw) -> bow (pitch) -> bolt
# ----------------------------------------------------------------------------------------------
def build_ballista(pre, evil):
    stone, stone_t, frame, frame_t, metal, metal_t, limb, limb_t, glow = (
        ("Basalt", basalt_tone(1801), "Wood", DARKWOOD_T, "Iron", IRON_T, "Bone", BONE_T, "Amethyst") if evil else
        ("Stone", STONE_T(1801), "Wood", WOOD_T, "Brass", BRASS_T, "Wood", WOOD_T, "Crystal"))
    seg = 6 if evil else 8
    p = [(obj("drum", *lathe([(0.0, 0.0), (0.95, 0.0), (0.95, 0.5), (0.86, 0.56), (0.86, 0.66), (0.0, 0.66)], seg), stone, stone_t, tile=1.0, sa=30), Matrix()),
         (obj("ring", *torus(0.8, 0.045, 24, 5), metal, metal_t, tile=0.4), T(0, 0, 0.66))]
    for k in range(seg):
        a = k / seg * TAU; p.append((obj("stud", *ellipsoid(0.06, 0.06, 0.05, 6, 4), metal, metal_t, tile=0.3), T(0.9 * math.cos(a), 0.9 * math.sin(a), 0.42)))
    ob = join(f"{pre}_BallistaBase", p); anchor(f"{pre}_BallistaBase_Yoke", (0, 0, 0.68), ob)
    # yoke: turntable, cheeks, operator seat at the back (+Y), crank wheels
    p = [(obj("plate", *disc_lathe(0.72, 0.7, 0, 0.08, 16), metal, metal_t, tile=0.5), Matrix())]
    for x in (-0.36, 0.36):
        v, f = boxv(0.12, 0.62, 0.78, 0.02); p.append((obj("cheek", v, f, frame, frame_t, tile=0.6), T(x, 0.05, 0.47)))
        p.append((obj("boss", *disc_lathe(0.11, 0.11, -0.08, 0.08, 10), metal, metal_t, tile=0.3), T(x * 1.18, 0.0, 0.8) @ R(math.pi / 2, "Y")))
    v, f = boxv(0.52, 0.38, 0.08, 0.02); p.append((obj("seat", v, f, frame, frame_t, tile=0.5), T(0, 0.95, 0.5)))
    p.append(rod((0, 0.55, 0.08), (0, 0.95, 0.46), 0.05, frame, 5, frame_t))
    for x in (-0.55, 0.55):
        M = T(x, 0.5, 0.42) @ R(math.pi / 2, "Y"); wood, iron = L.wheel(1810 + evil + int(x * 10), 0.28, 0.06, 6)
        p += [(o, M @ m) for o, m in wood]
        for o, m in iron: o.data.materials[0] = MATS[metal]; p.append((o, M @ m))
        p.append(rod((x * 1.15, 0.5, 0.42), (x * 1.15, 0.5, 0.72), 0.03, metal, 5))
    p.append(rod((-0.62, 0.5, 0.42), (0.62, 0.5, 0.42), 0.04, metal, 6))
    ob = join(f"{pre}_BallistaYoke", p); anchor(f"{pre}_BallistaYoke_Bow", (0, 0, 0.8), ob)
    # bow: stock along Y (front -Y), recurved limbs, drawn string, winch at the back
    p = []
    v, f = boxv(0.26, 2.55, 0.2, 0.03, seg=(2, 6, 2)); p.append((obj("stock", v, f, frame, frame_t, tile=0.8), T(0, -0.25, 0.0)))
    v, f = boxv(0.08, 2.3, 0.04, 0.0); p.append((obj("groove", v, f, metal, metal_t, tile=0.5), T(0, -0.3, 0.115)))
    p.append((obj("axle", *disc_lathe(0.08, 0.08, -0.36, 0.36, 10), metal, metal_t, tile=0.3), R(math.pi / 2, "Y")))
    for s in (-1, 1):
        pts = [(s * 0.16, -1.2, 0.05), (s * 0.6, -1.3, 0.06), (s * 1.05, -1.18, 0.07), (s * 1.3, -0.95, 0.08), (s * 1.38, -0.78, 0.08)]
        p.append((tube(pts, 0.085, 0.04, limb, 7, limb_t, 1820 + s), Matrix()))
        if not evil: p.append((obj("tip", *disc_lathe(0.055, 0.045, 0, 0.14, 8), metal, metal_t, tile=0.3), T(s * 1.38, -0.78, 0.08) @ R(-math.pi / 2, "X")))
        else:
            for t, (x_, y_) in enumerate([(0.6, -1.3), (1.05, -1.18)]):
                v, f = L.crystal_point(0.22, 0.05, 4); p.append((obj("thorn", v, f, "Bone", BONE_T, tile=0.3), T(s * x_, y_ - 0.06, 0.1) @ R(-math.pi / 2 - 0.3, "X")))
        p.append(rod((s * 1.38, -0.78, 0.08), (0.0, 0.32, 0.1), 0.012, "Cloth", 4, tint([0.85, 0.8, 0.7], 3, 0.05)))
        v, f = boxv(0.24, 0.3, 0.32, 0.03); p.append((obj("torsion", v, f, metal, metal_t, tile=0.4), T(s * 0.2, -1.2, 0.05)))
    p.append((obj("winch", *disc_lathe(0.11, 0.11, -0.22, 0.22, 10), frame, frame_t, tile=0.4), T(0, 0.85, 0.02) @ R(math.pi / 2, "Y")))
    for s in (-1, 1): p.append((obj("winch_end", *disc_lathe(0.16, 0.16, -0.025, 0.025, 10), metal, metal_t, tile=0.3), T(s * 0.24, 0.85, 0.02) @ R(math.pi / 2, "Y")))
    # sight ladder: a small open frame above the back of the stock
    for x in (-0.09, 0.09): p.append(rod((x, 0.6, 0.12), (x, 0.6, 0.42), 0.012, metal, 4))
    for z in (0.22, 0.32, 0.42): p.append(rod((-0.09, 0.6, z), (0.09, 0.6, z), 0.008, metal, 4))
    if evil:
        for prt, M in goofy_skull(1830, 0.24, 0.22, 0.22, eye_big=1.2, teeth=True): p.append((prt, T(0, -1.55, 0.1) @ M))
    else:
        v, f = L.crystal_point(0.36, 0.13, 6); p.append((obj("prow", v, f, metal, metal_t, tile=0.3), T(0, -1.5, 0.0) @ R(math.pi / 2, "X")))
    ob = join(f"{pre}_BallistaBow", p); anchor(f"{pre}_BallistaBow_Bolt", (0, 0.32, 0.17), ob)
    # bolt: nock at the origin, point toward -Y
    p = [rod((0, 0, 0), (0, -1.7, 0), 0.035, frame, 6, frame_t)]
    v, f = L.crystal_point(0.34, 0.07, 6); p.append((obj("head", v, f, glow, None, tile=0.3, sa=20), T(0, -1.68, 0) @ R(math.pi / 2, "X")))
    for k in range(3):
        a = k / 3 * TAU; v, f = boxv(0.012, 0.28, 0.1, 0.0)
        p.append((obj("vane", v, f, metal if not evil else "Bone", metal_t if not evil else BONE_T, tile=0.3), R(a, "Y") @ T(0, -0.2, 0.07)))
    join(f"{pre}_BallistaBolt", p)

# ----------------------------------------------------------------------------------------------
# gates and boundary wards
# ----------------------------------------------------------------------------------------------
def build_d_gate():
    p = []
    for x in (-2.6, 2.6):
        for prt, M in solid_pier(1.2, 1.1, 4.0, "Stone", STONE_T(1901 + int(x)), 1901 + int(x), taper=0.96): p.append((prt, T(x, 0, 0) @ M))
    n = 9
    for k in range(n):
        if k == n // 2: continue
        st = L.voussoir("v", 1910 + k, inner=2.0, outer=2.75, span=math.pi / n, depth=1.0)
        p.append((st, T(0, 0, 4.24) @ R(-k * math.pi / n, "Y")))
    ks = L.voussoir("ks", 1930, inner=1.95, outer=2.95, span=math.pi / n * 1.08, depth=1.1, centred=True)
    p.append((ks, T(0, 0, 4.24 + 2.42)))
    v, f = bipyramid(0.32, 0.32, 0.16, 6); p.append((obj("kc", v, f, "Crystal", None, tile=0.4, sa=20), T(0, -0.62, 4.24 + 2.42) @ R(math.pi / 2, "X")))
    for x in (-2.6, 2.6):
        p.append((banner(0.8, 2.1, [0.16, 0.32, 0.78], [0.95, 0.78, 0.36], 1940 + int(x)), T(x, -0.62, 2.7)))
        v, f = bipyramid(0.3, 0.15, 0.13, 6); p.append((obj("cap", v, f, "Crystal", None, tile=0.4, sa=20), T(x, 0, 4.55)))
    join("D_Gate", p)

def build_g_gate():
    p = []
    with side_stone("Basalt"):
        for x in (-2.6, 2.6):
            for prt, M in solid_pier(1.2, 1.1, 3.6, "Basalt", basalt_tone(2001), 2001 + int(x), taper=0.86, course=0.6): p.append((prt, T(x, 0, 0) @ M))
    for x in (-2.6, 2.6):
        for prt, M in goofy_skull(2010 + int(x), 0.5, 0.45, 0.48): p.append((prt, T(x, -0.1, 4.45) @ M))
    pts = [(math.cos(t) * 2.6, 0.0, 3.9 + math.sin(t) * 2.4) for t in np.linspace(0, math.pi, 11)]
    p.append((tube(pts, 0.32, 0.32, "Bone", 8, BONE_T, 2020), Matrix()))
    for k, t in enumerate(np.linspace(0.25, math.pi - 0.25, 9)):
        v, f = L.crystal_point(0.45 + 0.25 * (k % 2) + (0.3 if k in (3, 5) else 0), 0.11, 5)
        p.append((obj("tooth", v, f, "Bone", BONE_T, tile=0.3), T(math.cos(t) * 2.35, 0.0, 3.9 + math.sin(t) * 2.15) @ R(-(t - math.pi / 2) * 0.6, "Y") @ R(math.pi, "X")))
    p.append((banner(1.1, 2.0, [0.36, 0.14, 0.48], [0.62, 0.95, 0.35], 2030, tatter=0.3), T(0, -0.25, 5.1)))
    join("G_Gate", p)

def build_wards():
    ob = L.menhir("D_WardStone", 2101, 0.72, 1.7, 0.48, taper=0.7)
    v, f = bipyramid(0.2, 0.2, 0.09, 4)
    join("D_Ward", [(ob, Matrix()), (obj("rune", v, f, "Crystal", None, tile=0.3, sa=20), T(0, -0.2, 1.0) @ R(math.pi / 2, "X"))])
    p = []
    with side_stone("Basalt"): p.append((L.block(2110, 0.7, 0.6, 0.5, 0.08, tone=basalt_tone(2110)), T(0, 0, 0.2) @ R(0.4, "Z")))
    p.append((tube([(0, 0, 0.2), (0.05, -0.05, 0.9), (0.2, -0.15, 1.6), (0.42, -0.3, 2.0)], 0.2, 0.03, "Bone", 7, BONE_T, 2111), Matrix()))
    v, f = bipyramid(0.18, 0.12, 0.08, 4); p.append((obj("chip", v, f, "Amethyst", None, tile=0.3, sa=20), T(0, -0.32, 0.45)))
    join("G_Ward", p)

# ----------------------------------------------------------------------------------------------
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = build_materials()
    build_d_heart(); build_g_heart()
    build_d_barracks(); build_g_barracks()
    build_d_fountain(); build_g_fountain()
    build_d_pylon(); build_g_pylon()
    build_d_spire(); build_g_spire()
    build_ballista("D", 0); build_ballista("G", 1)
    build_d_gate(); build_g_gate()
    build_wards()
    for ob in list(bpy.data.objects):  # stray helper objects never reach the kit
        if ob.type == "MESH" and ob.parent is None and not ob.name[:2] in ("D_", "G_"): bpy.data.objects.remove(ob)
    return lum

def export_glb(path):
    for ob in bpy.data.objects:
        if ob.parent is None: ob.location = (0, 0, 0)
    kw = dict(filepath=path, export_format="GLB", export_materials="EXPORT", export_apply=False, export_cameras=False, export_lights=False,
              export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False, export_vertex_color="ACTIVE",
              export_image_format="JPEG", export_image_quality=78)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})

def pack_colors(path):
    """Rewrite COLOR_0 from float RGB to normalized unsigned-byte RGBA (a third of the bytes; the weathering tones
    need no more precision), compacting the binary chunk."""
    import struct as st
    d = open(path, "rb").read(); jl = st.unpack("<I", d[12:16])[0]; j = json.loads(d[20:20 + jl]); b0 = 20 + jl + 8; binary = d[b0:]
    colors = {p["attributes"]["COLOR_0"] for m in j["meshes"] for p in m["primitives"] if "COLOR_0" in p["attributes"]}
    views = {}
    for a in colors:
        A = j["accessors"][a]; assert A["componentType"] == 5126 and A["type"] == "VEC3" and A.get("byteOffset", 0) == 0
        views[A["bufferView"]] = a
    out = bytearray()
    for i, v in enumerate(j["bufferViews"]):
        raw = binary[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]]
        if i in views:
            A = j["accessors"][views[i]]; f = np.frombuffer(raw, dtype="<f4", count=A["count"] * 3).reshape(-1, 3)
            q = np.concatenate([np.clip(np.round(f * 255), 0, 255), np.full((len(f), 1), 255)], 1).astype(np.uint8)
            raw = q.tobytes(); A.update(componentType=5121, normalized=True, type="VEC4"); A.pop("min", None); A.pop("max", None); v.pop("byteStride", None)
        while len(out) % 4: out.append(0)
        v["byteOffset"] = len(out); v["byteLength"] = len(raw); out += raw
    while len(out) % 4: out.append(0)
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    open(path, "wb").write(st.pack("<III", 0x46546C67, 2, total) + st.pack("<II", len(js), 0x4E4F534A) + js + st.pack("<II", len(out), 0x004E4942) + bytes(out))

if __name__ == "__main__":
    lum = build()
    glb = os.path.join(HERE, "bases_kit.glb"); export_glb(glb); pack_colors(glb)
    rep = L.inspect(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]))
