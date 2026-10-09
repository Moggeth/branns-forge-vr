"""Brann's Forge - town kit (taverns, quartermasters, gold mills), 2026-10-07. Deterministic Blender 4.5 builder.

Run (no Blender install needed):
  pip install bpy==4.5.*
  python3 build_town.py                # writes town_kit.glb, textures/, build_report.json here
  cp town_kit.glb ../../multiplayer/public/assets/town_kit.glb
  python3 render_town.py               # Cycles turnarounds of every piece in renders/

Same conventions as ../home-bases-20261004/build_bases.py (whose texture, mesh and masonry helpers this reuses):
every piece is modelled at the origin, foot centre on the ground, FRONT facing Blender -Y (three.js +Z). Prefix D_
is Dawnhold (party), G_ is Grumblekeep (rivals), N_ is the shared neutral ground. Animated parts are separate
top-level nodes whose origin is their pivot; the piece that carries them has a child empty marking where that pivot
sits in the piece's own frame. Positions below are three.js (x right, y up, z toward the front):
  *_Tavern          open-fronted hall, 8 x 6 (N: 11 x 8), back wall z = -3 (N -4), side walls x = +-4 (N +-5.5),
                    front corner posts at (+-3.8, 2.8) (N (+-5.3, 3.8)), a safe zone players walk into
                    anchors *_Tavern_Bar     counter top, front centre   (0, 1.1, -1.75)   N (0, 1.1, -2.55)
                            *_Tavern_Hearth  on the hearth fire's bed    (-3.8, 0.1, -0.8) N (5.3, 0.1, 0)
  *_Quartermaster   market stall, 5 x 3.5, counter front face z = +1.75, top 1.1
                    anchor  *_Quartermaster_Counter                     (0, 1.1, 1.6)
  *_Mill            gold mill tower, base r 2.6 -> 2.0, cap and finial above
                    anchors *_Mill_Hub (0, 7.2, 2.3)  *_Mill_Hopper (0, 1.4, 3.3)  *_Mill_Chute (1.3, 0.5, 3.0)
                            *_Mill_Crank (-2.0, 0, 3.0)
  *_MillSails       sails, origin at the hub, in the XY plane, spin about local Z (9 m across)
  *_MillCrank       capstan, origin at the foot of its axle, turns about local Y (wheel 1.4 m across)
Materials: Stone Plaster Slate Wood Brass Cloth Iron Basalt Bone + emissive Crystal Amethyst Ember Ooze (the bases
kit's set and names). COLOR_0 (packed to normalized uint8) multiplies the base colour and carries per-part tints,
weathering and an ambient occlusion bake (ray cast against the piece itself and the ground plane).
"""
import bpy, bmesh, math, os, sys, json, time
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "home-bases-20261004"))
import build_bases as B  # noqa: E402  (imports ../landmarks-20261004/build_landmarks.py as B.L)
L = B.L
L.TEXDIR = os.path.join(HERE, "textures"); os.makedirs(L.TEXDIR, exist_ok=True)
MATS = L.MATS
from build_bases import (obj as _obj, boxv, T, R, bipyramid, join, anchor,  # noqa: E402
                         tint, banner, basalt_tone, course_tone, STONE_T, BRASS_T, IRON_T, BONE_T, WOOD_T, DARKWOOD_T,
                         side_stone, GLOWS)
fbm = L.fbm
TAU = 2 * math.pi

def obj(name, V, F, mat, tone=None, tile=1.2, sa=40, dec=None, planar=None):
    """The bases kit's obj(); small props get one seamless planar UV projection so the exporter does not split their
    vertices at every change of box-projection axis (vertex count is what fills the kit's bytes)."""
    ext = np.ptp(np.asarray(V, float), axis=0) if len(V) else np.zeros(3)
    if ext.max() < 0.8 and mat not in GLOWS: sa = max(sa, 75)  # small props: smooth facets, keep right-angle edges crisp
    ob = _obj(name, V, F, mat, tone, tile, sa, dec, planar)
    if ext.max() < 0.8 or mat in GLOWS:
        me = ob.data; co = np.array([v.co[:] for v in me.vertices]); lv = np.array([l.vertex_index for l in me.loops])
        t = min(tile, 0.5); uv = np.stack([(co[lv, 0] + 0.6 * co[lv, 1]) / t, (co[lv, 2] + 0.4 * co[lv, 1]) / t], -1)
        me.uv_layers["UVMap"].data.foreach_set("uv", uv.astype(np.float32).ravel())
    return ob

def lathe(profile, seg):
    """Revolve [(r, z)] (bottom -> top) round Z. End points on the axis become a single apex (a triangle fan) rather
    than a ring of degenerate quads."""
    prof = list(profile); a0 = prof[0][0] < 1e-9; a1 = prof[-1][0] < 1e-9
    ring = prof[1 if a0 else 0: len(prof) - 1 if a1 else len(prof)]; n = len(ring); V, F = [], []
    for k in range(seg):
        a = k / seg * TAU
        for r, z in ring: V.append((r * math.cos(a), r * math.sin(a), z))
    for k in range(seg):
        k2 = (k + 1) % seg
        for j in range(n - 1): F.append([k * n + j, k2 * n + j, k2 * n + j + 1, k * n + j + 1])
    if a0:
        V.append((0.0, 0.0, prof[0][1])); c = len(V) - 1
        for k in range(seg): F.append([(k + 1) % seg * n, k * n, c])
    if a1:
        V.append((0.0, 0.0, prof[-1][1])); c = len(V) - 1
        for k in range(seg): F.append([k * n + n - 1, (k + 1) % seg * n + n - 1, c])
    return np.array(V, float), F

def disc_lathe(r0, r1, z0, z1, seg):
    """Closed frustum with n-gon caps."""
    V = [(r0 * math.cos(k / seg * TAU), r0 * math.sin(k / seg * TAU), z0) for k in range(seg)] + [(r1 * math.cos(k / seg * TAU), r1 * math.sin(k / seg * TAU), z1) for k in range(seg)]
    F = [list(range(seg))[::-1], list(range(seg, 2 * seg))] + [[k, (k + 1) % seg, seg + (k + 1) % seg, seg + k] for k in range(seg)]
    return np.array(V, float), F

def ellipsoid(rx, ry, rz, seg=16, rings=10):
    prof = [(math.sin(t), -math.cos(t)) for t in np.linspace(0, math.pi, rings + 1)]
    prof[0] = (0.0, -1.0); prof[-1] = (0.0, 1.0)
    V, F = lathe(prof, seg); return V * np.array([rx, ry, rz]), F

def torus(R_, r, seg=24, rs=6):
    prof = [(R_ + r * math.cos(t), r * math.sin(t)) for t in np.linspace(0, TAU, rs + 1)][:-1]
    V, F = [], []
    for k in range(seg):
        a = k / seg * TAU
        for rr_, z in prof: V.append((rr_ * math.cos(a), rr_ * math.sin(a), z))
    n = len(prof)
    for k in range(seg):
        k2 = (k + 1) % seg
        for j in range(n): F.append([k * n + j, k2 * n + j, k2 * n + (j + 1) % n, k * n + (j + 1) % n])
    return np.array(V, float), F

def B3(x, y, z):
    """three.js (x right, y up, z front) -> Blender (x, -z, y)."""
    return (x, -z, y)

# ----------------------------------------------------------------------------------------------
# materials (the bases kit's set at smaller sizes: this kit leans on vertex colour)
# ----------------------------------------------------------------------------------------------
_save_set = L.save_set
def save_set_lean(name, base, height, rough, metal, nstrength, ao=None, emis=None):
    """Base colour at full size; normal, occlusion-roughness-metal and emission maps at half (min 64): the kit's
    surface detail lives mostly in vertex colour, and the bytes are better spent on shape."""
    k = 2 if base.shape[0] > 64 else 1
    half = lambda a: None if a is None else a.reshape(a.shape[0] // k, k, a.shape[1] // k, k, *a.shape[2:]).mean(axis=(1, 3))
    import struct as _st, zlib as _z
    L.write_png(os.path.join(L.TEXDIR, f"{name}_bc.png"), L.u8(base))
    L.write_png(os.path.join(L.TEXDIR, f"{name}_n.png"), L.u8(L.normal_from_height(half(height), nstrength * k)))
    orm = np.stack([np.ones_like(half(rough)) if ao is None else half(ao), half(rough), half(metal)], -1)
    L.write_png(os.path.join(L.TEXDIR, f"{name}_orm.png"), L.u8(orm))
    if emis is not None: L.write_png(os.path.join(L.TEXDIR, f"{name}_em.png"), L.u8(half(emis)))
    return float(base.mean())
L.save_set = save_set_lean; B.save_set = save_set_lean

# leaded window glass (2026-10-09 tavern glow-up): diamond quarries of honey-coloured glass held in dark lead came,
# each pane a slightly different warmth, so windows and lanterns read as lamplit glass rather than molten rock.
B.GLOWS = GLOWS = GLOWS + ("Glass", "GlassOoze")

def tex_window(name, n, seed, warm, cool, base_rgb):
    y, x = np.mgrid[0:n, 0:n] / n
    u, v = (x + y) * 4, (x - y) * 4 + 8
    du, dv = np.abs(u - np.round(u)), np.abs(v - np.round(v)); d = np.minimum(du, dv)
    lead = L.sm(0.05, 0.022, d)
    pid = (np.floor(u).astype(int) * 7 + np.floor(v).astype(int) * 13 + seed) % 11 / 10.0
    fine = L.fnoise(n, 0.6, seed + 3); swirl = L.fnoise(n, 1.0, seed + 4, hi=n / 6)
    glow = (0.72 + 0.28 * pid + 0.1 * fine + 0.12 * swirl) * (1 - lead)
    centre = 1 - np.minimum(du, dv) * 0  # (quarries are flat-lit; the client flickers the intensity)
    em = L.mix(cool, warm, L.sm(0.2, 1.0, glow)) * glow[..., None] * centre[..., None]
    base = L.mix(base_rgb, [0.08, 0.07, 0.06], lead)
    return save_set_lean(name, base, lead, 0.1 + 0.5 * lead, 0.6 * lead, 1.2, emis=np.clip(em, 0, 1))

def build_materials(n=256, g=128):
    lum = {"Stone": L.tex_stone("Stone", n, 41), "Wood": L.tex_wood("Wood", n, 85), "Basalt": B.tex_basalt("Basalt", n, 501),
           "Plaster": B.tex_plaster("Plaster", n, 511), "Slate": B.tex_slate("Slate", n, 521, rows=8, cols=6), "Cloth": B.tex_cloth("Cloth", g, 531),
           "Bone": B.tex_bone("Bone", g, 541), "Iron": B.tex_iron("Iron", g, 551), "Brass": B.tex_brass("Brass", g, 561),
           "Crystal": B.tex_glow("Crystal", g, 74, [0.22, 0.58, 1.0], [0.55, 0.85, 1.0], [0.25, 0.2, 0.0], [0.12, 0.30, 0.62], [0.40, 0.68, 0.95], 0.6),
           "Amethyst": B.tex_glow("Amethyst", g, 571, [0.40, 0.10, 0.85], [0.80, 0.45, 1.0], [0.3, 0.3, 0.1], [0.25, 0.08, 0.40], [0.62, 0.35, 0.85]),
           "Ember": B.tex_glow("Ember", g, 581, [0.95, 0.30, 0.04], [1.0, 0.78, 0.30], [0.1, 0.2, 0.1], [0.35, 0.08, 0.02], [0.85, 0.45, 0.15], 0.8),
           "Ooze": B.tex_glow("Ooze", g, 591, [0.30, 0.85, 0.08], [0.70, 1.0, 0.35], [0.2, 0.1, 0.2], [0.12, 0.35, 0.04], [0.45, 0.85, 0.25], 0.7),
           "Glass": tex_window("Glass", g, 601, [1.0, 0.68, 0.3], [0.92, 0.36, 0.08], [0.85, 0.55, 0.25]),
           "GlassOoze": tex_window("GlassOoze", g, 611, [0.72, 1.0, 0.45], [0.3, 0.75, 0.2], [0.45, 0.7, 0.3])}
    for nm in ("Stone", "Wood", "Basalt", "Plaster", "Slate", "Cloth", "Bone", "Iron", "Brass"): MATS[nm] = L.make_material(nm)
    for nm in GLOWS: MATS[nm] = L.make_material(nm, emissive=True)
    MATS["Bronze"] = MATS["Brass"]
    return lum

# ----------------------------------------------------------------------------------------------
# geometry kit (cheap on purpose: the whole kit has to fit 2.5 MB)
# ----------------------------------------------------------------------------------------------
def E(rx=0.0, ry=0.0, rz=0.0): return Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4()
def grp(parts, M): return [(o, M @ m) for o, m in parts]
def col(rgb, seed=1, var=0.1, freq=1.5): return tint(rgb, seed, var, freq)

PLANK_T = lambda p, n: np.clip(np.stack([0.42 + 0.12 * np.sin(np.floor((p[:, 0] + p[:, 1]) / 0.3) * 7.1) + 0.06 * fbm(p, 3, 2, 2)] * 3, -1) * np.array([1.0, 0.84, 0.8]), 0, 1)
FOAM_T = col([1.0, 0.98, 0.92], 21, 0.05)
LEATHER_T = col([0.5, 0.3, 0.17], 22, 0.1)

def bbox(w, d, h, mat, tone=None, bev=0.0, tile=0.8):
    """Box centred on the origin. Chunky ones (all sides >= 0.12) get crisp one-segment chamfers."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    b = min(bev, 0.3 * min(w, d, h))
    if b > 0.004 and min(w, d, h) >= 0.2:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=b, segments=1, affect="EDGES", profile=0.5, clamp_overlap=True)
    bm.verts.index_update(); V = np.array([v.co[:] for v in bm.verts]); F = [[v.index for v in f.verts] for f in bm.faces]; bm.free()
    return obj("bx", V, F, mat, tone, tile=tile, sa=30)

def beam(a, b, w, mat, tone=None, h=None, bev=0.0):
    """Square timber from a to b."""
    ln = (Vector(b) - Vector(a)).length
    return (bbox(w, h or w, ln, mat, tone, bev=bev), L.between(a, b) @ T(0, 0, ln / 2))

def rodr(a, b, r, mat, tone=None, seg=5):
    """Open round rod a -> b (ends are always buried in something)."""
    ln = (Vector(b) - Vector(a)).length; V, F = lathe([(r, 0.0), (r, ln)], seg)
    return (obj("rod", V, F, mat, tone or tint([0.92] * 3, 3, 0.06), tile=0.4, sa=max(60, 360 / seg + 5)), L.between(a, b))

def tube2(pts, r0, r1, mat, tone=None, sides=5, sub=1, wob=0.0):
    """Catmull-Rom tube with `sub` samples per span (open ends)."""
    P = np.array(pts, float); S = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for t in np.linspace(0, 1, sub + 1)[:-1]:
            S.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    S.append(P[-1]); S = np.array(S); n = len(S); V, F = [], []
    for i in range(n):
        tg = S[min(i + 1, n - 1)] - S[max(i - 1, 0)]; tg /= np.linalg.norm(tg)
        a = np.cross(tg, [0, 0, 1.0]); a = a if np.linalg.norm(a) > 1e-3 else np.cross(tg, [1.0, 0, 0]); a /= np.linalg.norm(a); b = np.cross(tg, a)
        rr = r0 + (r1 - r0) * i / (n - 1)
        for k in range(sides):
            ang = k / sides * TAU; V.append(S[i] + rr * (1 + wob * math.sin(ang * 3 + i)) * (math.cos(ang) * a + math.sin(ang) * b))
    for i in range(n - 1):
        for k in range(sides): k2 = (k + 1) % sides; F.append([i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k])
    return (obj("tube", np.array(V), F, mat, tone, tile=0.6, sa=max(60, 360 / sides + 5)), Matrix())

def blob(rx, ry, rz, mat, tone=None, seg=6, rings=4):
    return obj("blob", *ellipsoid(rx, ry, rz, seg, rings), mat, tone, tile=0.3, sa=70)

def slab(x0, x1, y0, y1, z0, z1, mat, tone=None, chip=0.03, step=0.9, wob=0.0, seed=0, tile=1.2):
    """Axis-aligned block between two corners, subdivided about every `step` metres (room for the AO bake)."""
    if z0 <= 0.001 and chip > 0: z0 -= chip * 1.4  # chamfered feet: sink the chamfer so the face meets the ground
    w, d, h = x1 - x0, y1 - y0, z1 - z0
    seg = tuple(max(1, int(round(s / step))) for s in (w, d, h))
    V, F = boxv(w, d, h, chip, seg=seg, wob=wob, seed=seed)
    return (obj("slab", V, F, mat, tone, tile=tile, sa=35), T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

def cyl(r, h, mat, tone=None, seg=8, r1=None, tile=0.6, sa=40):
    return obj("cyl", *disc_lathe(r, r if r1 is None else r1, 0, h, seg), mat, tone, tile=tile, sa=max(sa, 360 / seg + 5))

def prism(pts2d, y0, y1, mat, tone=None, tile=1.2):
    """Extrude a convex polygon given in XZ along Y from y0 to y1 (gable triangles)."""
    n = len(pts2d); V = [(x, y0, z) for x, z in pts2d] + [(x, y1, z) for x, z in pts2d]
    F = [list(range(n))[::-1], list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    return obj("prism", np.array(V, float), F, mat, tone, tile=tile, sa=30)

def sheet(nx, ny, fn, mat, tone, tile=0.6, sa=70):
    """Single-sided grid sheet; fn(u, v) -> Blender point for u, v in 0..1 (the exporter keeps materials double sided)."""
    V = [fn(i / nx, j / ny) for j in range(ny + 1) for i in range(nx + 1)]
    F = [[j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i] for j in range(ny) for i in range(nx)]
    return (obj("sheet", np.array(V, float), F, mat, tone, tile=tile, sa=sa), Matrix())

def skull(seed, rx, ry, rz, eye_big=1.25, eyes="Ooze", teeth=True, mat="Bone", tone=None, seg=11, rings=7):
    """The bases kit's goofy skull (big cranium, one bigger socket, glowing pupils, stubby muzzle, two buck teeth),
    facing -Y, at a fraction of the triangles."""
    tone0 = tone or BONE_T
    V, F = ellipsoid(rx, ry, rz, seg, rings)
    sockets = [(-0.36 * rx, 0.06 * rz, 1.0), (0.37 * rx, 0.1 * rz, eye_big)]
    front = V[:, 1] < -0.15 * ry
    for ex, ez, k in sockets:
        d = np.hypot((V[:, 0] - ex) / (0.27 * rx * k), (V[:, 2] - ez) / (0.3 * rz * k))
        V[:, 1] += np.clip(1 - d, 0, 1) ** 0.6 * 0.38 * ry * front
    def tn(p_, n_):
        c = tone0(p_, n_)
        for ex, ez, k in sockets:
            d = np.hypot((p_[:, 0] - ex) / (0.27 * rx * k), (p_[:, 2] - ez) / (0.3 * rz * k))
            c[(d < 1.1) & (p_[:, 1] < -0.1 * ry)] = [0.07, 0.04, 0.09]
        return c
    out = [(obj("skull", V, F, mat, tn, tile=0.8, sa=60), Matrix())]
    mz = -0.6 * rz
    out.append((blob(0.62 * rx, 0.78 * ry, 0.42 * rz, mat, tone0, 8, 5), T(0, -0.14 * ry, mz)))
    out.append((blob(0.12 * rx, 0.05 * ry, 0.1 * rz, "Iron", col([0.08, 0.05, 0.09], 1, 0.02), 6, 3), T(0, -0.92 * ry, mz + 0.18 * rz)))  # nose
    for ex, ez, k in sockets:
        out.append((blob(0.12 * rx * k, 0.08 * ry, 0.13 * rz * k, eyes, None, 6, 4), T(ex + 0.04 * rx * k, -0.66 * ry, ez - 0.05 * rz)))
    if teeth:
        for x in (-0.1 * rx, 0.1 * rx):
            out.append((bbox(0.17 * rx, 0.1 * ry, 0.26 * rz, mat, tint([1, 1, 0.97], 9, 0.05), bev=0.01), T(x, -0.88 * ry, mz - 0.36 * rz)))
    return out

def keg(r=0.27, h=0.62, wood="Wood", wtone=WOOD_T, hoop="Iron", htone=IRON_T, seg=7):
    prof = [(0.0, 0.0), (r * 0.82, 0.0), (r * 0.94, h * 0.2), (r, h * 0.5), (r * 0.94, h * 0.8), (r * 0.82, h), (0.0, h)]
    V, F = lathe(prof, seg)
    stave = lambda p, n: np.clip(wtone(p, n) * (0.9 + 0.1 * np.cos(np.arctan2(p[:, 1], p[:, 0]) * seg)) [:, None], 0, 1)
    out = [(obj("keg", V, F, wood, stave, tile=0.6, sa=60), Matrix())]
    for z in (0.16, h - 0.16):
        rr = r * (0.84 + 0.16 * math.sin(z / h * math.pi)) + 0.004
        out.append((obj("hoop", *lathe([(rr + 0.01, -0.025), (rr + 0.01, 0.025)], seg), hoop, htone, tile=0.3, sa=50), T(0, 0, z)))
    return out

def mug(r=0.055, h=0.13, body="Wood", btone=WOOD_T, band=None, foam=True, seg=6, foam_mat="Plaster", foam_tone=FOAM_T):
    prof = [(0.0, 0.0), (r * 0.95, 0.0), (r * 1.04, h), (r * 0.82, h), (r * 0.82, h * 0.85), (0.0, h * 0.85)]
    out = [(obj("mug", *lathe(prof, seg), body, btone, tile=0.3, sa=50), Matrix())]
    if band: out.append((obj("band", *lathe([(r * 0.99, h * 0.25), (r * 1.05, h * 0.3), (r * 1.06, h * 0.42), (r * 1.0, h * 0.47)], seg), band, BRASS_T if band == "Brass" else IRON_T, tile=0.3), Matrix()))
    if foam: out.append((blob(r * 0.98, r * 0.98, r * 0.6, foam_mat, foam_tone, seg, 4), T(0, 0, h * 0.95)))
    out.append(tube2([(r * 0.9, 0, h * 0.82), (r * 1.7, 0, h * 0.62), (r * 1.6, 0, h * 0.3), (r * 0.9, 0, h * 0.22)], r * 0.17, r * 0.17, body, btone, 4, 1))
    return out

def lantern(metal="Brass", mtone=BRASS_T, glow="Ember", s=1.0):
    """Hanging lantern, origin at the hook (top); body hangs below."""
    out = [(bbox(0.2 * s, 0.2 * s, 0.26 * s, glow, None, bev=0.0), T(0, 0, -0.27 * s))]
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        out.append(beam((dx * 0.105 * s, dy * 0.105 * s, -0.42 * s), (dx * 0.105 * s, dy * 0.105 * s, -0.13 * s), 0.025 * s, metal, mtone))
    cv, cf = lathe([(0.0, 0.0), (0.16 * s, 0.0), (0.16 * s, 0.02 * s), (0.04 * s, 0.11 * s), (0.0, 0.12 * s)], 4)
    out.append((obj("cap", cv, cf, metal, mtone, tile=0.3, sa=30), T(0, 0, -0.14 * s) @ R(math.pi / 4, "Z")))
    out.append((bbox(0.24 * s, 0.24 * s, 0.04 * s, metal, mtone), T(0, 0, -0.42 * s)))
    return out

def flames(seed, s=1.0):
    """A little fire: an ember bed, licking tongues and three logs, origin on the bed."""
    r = np.random.default_rng(seed); out = [(blob(0.32 * s, 0.24 * s, 0.06 * s, "Ember", None, 8, 4), T(0, 0, 0.03 * s))]
    for k in range(5):
        a = k / 5 * TAU + r.random() * 0.5; d = 0.0 if k == 0 else (0.08 + 0.12 * r.random()) * s; h = (0.35 + 0.3 * r.random()) * s * (1.4 if k == 0 else 1.0)
        V, F = lathe([(0.0, 0.0), (0.1 * s, 0.08 * h), (0.11 * s, 0.3 * h), (0.06 * s, 0.65 * h), (0.0, h)], 5)
        V[:, 0] += 0.06 * s * np.sin(V[:, 2] / h * 3 + k) * (V[:, 2] / h); V[:, 1] *= 0.7
        out.append((obj("tongue", V, F, "Ember", None, tile=0.3, sa=60), T(math.cos(a) * d, math.sin(a) * d * 0.7, 0.02) @ R(r.random() - 0.5, "Z") @ R((r.random() - 0.5) * 0.3, "X")))
    for k in range(3):
        a = k / 3 * TAU + 0.4
        out.append(rodr((math.cos(a) * 0.36 * s, math.sin(a) * 0.25 * s, 0.03), (-math.cos(a) * 0.1 * s, -math.sin(a) * 0.07 * s, 0.12 * s), 0.055 * s, "Wood", DARKWOOD_T, 6))
    return out

def coin(r=0.045, t=0.01):
    return cyl(r, t, "Brass", BRASS_T, seg=6, tile=0.2)

def coin_stack(n, r=0.05, seed=0):
    """A stack of n coins as one lathe with a groove every few coins."""
    h = n * 0.0125
    return [(cyl(r, h * 0.55, "Brass", BRASS_T, seg=8), R(seed, "Z")), (cyl(r * 0.98, h * 0.45, "Brass", BRASS_T, seg=8), T(0.006, 0.004, h * 0.55) @ R(seed + 0.3, "Z"))]

def coin_pile(r0, h, seed, count=10):
    """A heap of coins: a lumpy mound plus loose coins tumbling down its sides."""
    rr = np.random.default_rng(seed)
    V, F = lathe([(0.0, 0.0), (r0, 0.0)] + [(r0 * (1 - t) ** 1.3, h * math.sin(t * math.pi / 2)) for t in np.linspace(0.2, 1, 4)], 9)
    V[:, :2] *= (1 + 0.08 * np.sin(np.arctan2(V[:, 1], V[:, 0]) * 3 + seed))[:, None]
    out = [(obj("heap", V, F, "Brass", col([1.0, 0.86, 0.5], seed, 0.12), tile=0.25, sa=50), Matrix())]
    for k in range(count):
        a = rr.random() * TAU; d = rr.random() * r0 * 0.95; z = h * (1 - (d / r0)) ** 1.1 + 0.004
        out.append((coin(), T(math.cos(a) * d, math.sin(a) * d, z) @ R((rr.random() - 0.5) * 1.2, "X") @ R((rr.random() - 0.5) * 1.2, "Y")))
    return out

def bunting(a, b, sag, n, colours, seed, size=0.26):
    """A cord with triangular pennants hanging from it (a -> b, Blender coords)."""
    a, b = np.array(a, float), np.array(b, float); pts = [tuple(a + (b - a) * t + np.array([0, 0, -sag * math.sin(t * math.pi)])) for t in np.linspace(0, 1, 5)]
    out = [tube2(pts, 0.012, 0.012, "Cloth", col([0.85, 0.8, 0.7], 3, 0.05), 3, 2)]
    d = (b - a) / np.linalg.norm(b - a); yaw = math.atan2(d[1], d[0])
    for i in range(n):
        t = (i + 0.5) / n; p = a + (b - a) * t + np.array([0, 0, -sag * math.sin(t * math.pi)])
        V = np.array([[-size / 2, 0, 0], [size / 2, 0, 0], [0, 0.0, -size * 1.2]])
        out.append((obj("flag", V, [[0, 2, 1]], "Cloth", col(colours[i % len(colours)], seed + i, 0.06), tile=0.3, sa=80), T(*p) @ R(yaw, "Z") @ R(0.15 * math.sin(i * 2.1), "X")))
    return out

def sun_disc(r, metal="Brass", tone=BRASS_T, gem="Crystal", rays=10):
    """A Dawnhold sunburst, axis along -Y (faces the front)."""
    p = [(obj("disc", *lathe([(0.0, 0.0), (r, 0.0), (r, 0.05), (r * 0.8, 0.09), (0.0, 0.1)], 12), metal, tone, tile=0.3, sa=40), R(math.pi / 2, "X"))]
    for k in range(rays):
        a = k / rays * TAU; ln = r * (0.6 if k % 2 else 0.95); hw_ = r * 0.2
        p.append((prism([(-hw_, 0.0), (hw_, 0.0), (0.0, ln)], -0.03, 0.03, metal, tone, tile=0.3), T(math.cos(a) * r * 0.85, 0, math.sin(a) * r * 0.85) @ R(-a + math.pi / 2, "Y")))
    if gem:
        v, f = bipyramid(r * 0.4, r * 0.4, r * 0.38, 6); p.append((obj("gem", v, f, gem, None, tile=0.3, sa=20), T(0, -0.08, 0) @ R(math.pi / 2, "X")))
    return p

# ----------------------------------------------------------------------------------------------
# finishing pass: weathering and an ambient occlusion bake into the corner colours
# ----------------------------------------------------------------------------------------------
def _hemi(rays):
    k = np.arange(rays) + 0.5; rr = np.sqrt(k / rays); th = k * 2.399963
    return np.stack([rr * np.cos(th), rr * np.sin(th), np.sqrt(np.maximum(0.0, 1 - rr * rr))], -1)

def finish(ob, dist=1.3, strength=0.85, rays=22, foot=0.55):
    """Multiply COLOR_0 by a ray-cast ambient occlusion term (the piece and the ground plane occlude) and darken
    the damp feet of stone, plaster, wood and basalt walls. Glow materials only get a whisper of it."""
    me = ob.data; nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3).astype(float)
    vn = np.empty(nv * 3, np.float32); me.vertices.foreach_get("normal", vn); vn = vn.reshape(-1, 3).astype(float)
    bvh = BVHTree.FromPolygons([tuple(c) for c in co], [tuple(p.vertices) for p in me.polygons], epsilon=0.0)
    loc = _hemi(rays); ao = np.ones(nv)
    for i in range(nv):
        n = vn[i]; ln = np.linalg.norm(n)
        if ln < 1e-6: continue
        n = n / ln; a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
        t1 = np.cross(n, a); t1 /= np.linalg.norm(t1); t2 = np.cross(n, t1)
        dirs = loc[:, :1] * t1 + loc[:, 1:2] * t2 + loc[:, 2:] * n
        p = co[i] + n * 0.02; pv = Vector(p); occ = 0.0
        for d in dirs:
            hit = bvh.ray_cast(pv, Vector(d), dist); t = dist if hit[0] is None else hit[3]
            if d[2] < -0.05 and p[2] > -0.02: t = min(t, p[2] / -d[2])
            occ += max(0.0, 1 - t / dist) ** 0.7
        ao[i] = max(0.3, 1 - strength * occ / rays)
    nl = len(me.loops); lv = np.empty(nl, np.int64); me.loops.foreach_get("vertex_index", lv)
    npoly = len(me.polygons); mi = np.empty(npoly, np.int64); me.polygons.foreach_get("material_index", mi)
    pn = np.empty(npoly * 3, np.float32); me.polygons.foreach_get("normal", pn); pn = pn.reshape(-1, 3)
    ls = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_start", ls); lt = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_total", lt)
    lp = np.repeat(np.arange(npoly), lt)
    names = [m.name for m in me.materials]; glow = np.array([names[m] in GLOWS for m in mi])[lp]
    damp = np.array([names[m] in ("Stone", "Plaster", "Wood", "Basalt") for m in mi])[lp]
    c = np.empty(nl * 4, np.float32); attr = me.color_attributes["Col"]; attr.data.foreach_get("color", c); c = c.reshape(-1, 4)
    a = ao[lv]; a = np.where(glow, 1 - 0.2 * (1 - a), a)
    c[:, :3] *= a[:, None]
    z = co[lv, 2]; f = np.clip(1 - z / foot, 0, 1) * (np.abs(pn[lp, 2]) < 0.5) * damp
    c[:, :3] = c[:, :3] * (1 - 0.3 * f)[:, None] + (f * 0.3)[:, None] * np.array([0.30, 0.34, 0.22]) * c[:, :3]
    attr.data.foreach_set("color", np.clip(c, 0, 1).ravel())
    return ob

_CULL = _hemi(7)
def cull_hidden(ob, dist=0.4):
    """Delete faces nobody can see: from the face centre and from just inside each corner, every probe ray (along the
    normal and round its hemisphere) is blocked within `dist` by the piece or the ground. Buried beam ends, bottoms
    resting on floors and backs pressed against walls go; cloth sheets (seen from both sides) are never touched."""
    me = ob.data; nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3).astype(float)
    bvh = BVHTree.FromPolygons([tuple(c) for c in co], [tuple(p.vertices) for p in me.polygons], epsilon=0.0)
    names = [m.name for m in me.materials]; dead = []
    for poly in me.polygons:
        if names[poly.material_index] == "Cloth": continue
        n = np.array(poly.normal[:]); c = np.array(poly.center[:])
        a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0]); t1 = np.cross(n, a); t1 /= np.linalg.norm(t1); t2 = np.cross(n, t1)
        dirs = _CULL[:, :1] * t1 + _CULL[:, 1:2] * t2 + _CULL[:, 2:] * n
        pts = [c] + [co[v] * 0.85 + c * 0.15 for v in poly.vertices]
        seen = False
        for q in pts:
            q = q + n * 0.006; qv = Vector(q)
            for d in [n] + list(dirs):
                hit = bvh.ray_cast(qv, Vector(d), dist)
                if hit[0] is not None: continue
                if d[2] < -0.05 and q[2] > -0.02 and q[2] / -d[2] < dist: continue
                seen = True; break
            if seen: break
        if not seen: dead.append(poly.index)
    if dead:
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in dead], context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(me); bm.free(); me.update()
    return len(dead)

def piece(name, parts):
    ob = join(name, parts); n = cull_hidden(ob); print("  culled", n, "hidden faces", flush=True); return finish(ob)

# ----------------------------------------------------------------------------------------------
# taverns
# ----------------------------------------------------------------------------------------------
STYLES = {
    "D": dict(lo="Stone", lo_t=STONE_T(3001), hi="Plaster", hi_t=col([1.0, 0.95, 0.86], 31, 0.08), frame="Wood", frame_t=WOOD_T,
              roof="Slate", roof_t=col([0.92, 1.0, 1.0], 32, 0.08), metal="Brass", metal_t=BRASS_T, lamp="Glass",
              cloth=[0.16, 0.32, 0.78], sigil=[0.95, 0.78, 0.36], table_t=WOOD_T, wall_top=3.3, ridge=6.5),
    "G": dict(lo="Basalt", lo_t=basalt_tone(3101), hi="Wood", hi_t=lambda p, n: np.clip(PLANK_T(p, n) * np.array([1.75, 1.3, 1.95]), 0, 1), frame="Wood", frame_t=DARKWOOD_T,
              roof="Slate", roof_t=col([0.66, 0.54, 0.78], 33, 0.1), metal="Iron", metal_t=IRON_T, lamp="GlassOoze",
              cloth=[0.36, 0.14, 0.48], sigil=[0.62, 0.95, 0.35], table_t=DARKWOOD_T, wall_top=3.2, ridge=6.6),
    "N": dict(lo="Stone", lo_t=STONE_T(3201), hi="Plaster", hi_t=col([1.0, 0.88, 0.68], 34, 0.08), frame="Wood", frame_t=WOOD_T,
              roof="Slate", roof_t=None, metal="Iron", metal_t=IRON_T, lamp="Glass",
              cloth=[0.55, 0.45, 0.3], sigil=[0.95, 0.78, 0.36], table_t=WOOD_T, wall_top=3.5, ridge=7.7),
}

def moss_slate(p, n):
    """Neutral roof: weathered grey-green slate with moss cushions creeping over it."""
    g = fbm(p, 35, 0.9, 3); m = np.clip((g - 0.02) * 6, 0, 1) * (0.55 + 0.45 * np.clip(n[:, 2], 0, 1))
    base = np.stack([0.95 + 0.15 * g] * 3, -1) * np.array([1.0, 0.94, 0.8])
    moss = np.array([0.62, 0.95, 0.42]) * (0.9 + 0.3 * fbm(p, 36, 3.0, 2))[:, None]
    return np.clip(base * (1 - m[:, None]) + moss * m[:, None], 0, 1)

def tavern_shell(pre, W, D, st, hearth_side, hearth_y, wins=None):
    """Floor, walls, timber frame, front posts and gable, roof, and the hearth. Front (open) at -Y."""
    p = []; hw, hd = W / 2, D / 2; top = st["wall_top"]; ridge = st["ridge"]; s = (ridge - top) / hw; ang = math.atan(s)
    lo, lo_t, hi, hi_t, fr, fr_t = st["lo"], st["lo_t"], st["hi"], st["hi_t"], st["frame"], st["frame_t"]
    evil = pre == "G"; htile = 1.6 if hi == "Plaster" else 0.9; lot = course_tone(5, lo_t, 0.38) if lo == "Stone" else lo_t
    # floor: a stone curb under raised planks (top at 0.1)
    p.append(slab(-hw, hw, -hd, hd, 0.0, 0.06, lo, lo_t, chip=0.03, step=2.0))
    # planks: one dark sub-floor slab, each board a single top quad a hair above it (the gaps read as seams)
    p.append(slab(-hw + 0.4, hw - 0.4, -hd + 0.06, hd - 0.4, 0.06, 0.098, "Wood", col([0.3, 0.22, 0.18], 39, 0.1), chip=0.0, step=1.6, tile=0.8))
    rr = np.random.default_rng(len(pre) + int(W * 10)); x = -hw + 0.4; i = 0
    while x < hw - 0.41:
        w = min(0.42, hw - 0.4 - x); y0 = -hd + 0.06
        tone = col([0.95 - 0.15 * rr.random(), 0.88 - 0.12 * rr.random(), 0.8], 40 + i, 0.12) if not evil else col([0.75 - 0.12 * rr.random(), 0.6, 0.62], 40 + i, 0.15)
        nseg = max(1, int(round((D - 0.46) / 1.6))); z0 = 0.1 + 0.003 * rr.random()
        p.append(sheet(1, nseg, lambda u, v, x=x, w=w, z0=z0: (x + 0.012 + (w - 0.024) * u, y0 + (D - 0.46) * v, z0), "Wood", tone, tile=0.8, sa=30))
        x += w; i += 1
    with side_stone(lo):
        p.append((L.block(3301 + len(pre), W + 0.1, 0.5, 0.12, 0.03, seg=(5, 1, 1), tone=lo_t), T(0, -hd + 0.2, 0.02)))  # front sill
    # back wall: base course, upper wall, gable
    zb = 0.75
    p.append(slab(-hw, hw, hd - 0.42, hd + 0.02, 0, zb, lo, lot, chip=0.04, step=1.7))
    p.append(slab(-hw + 0.02, hw - 0.02, hd - 0.4, hd, zb, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
    p.append((prism([(-hw + 0.02, top), (hw - 0.02, top), (0.0, ridge - 0.02)], hd - 0.4, hd, hi, hi_t, tile=htile), Matrix()))
    # side walls (a gap for the hearth on one side)
    yf = -hd + 0.4
    for sx in (-1, 1):
        xa, xb = sorted((sx * (hw - 0.42), sx * (hw + 0.02))); xa2, xb2 = sorted((sx * (hw - 0.4), sx * hw))
        if sx == hearth_side:
            spans = [(yf, hearth_y - 0.7), (hearth_y + 0.7, hd - 0.4)]
            p.append(slab(xa2, xb2, hearth_y - 0.7, hearth_y + 0.7, 1.35, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
        else: spans = [(yf, hd - 0.4)]
        for y0, y1 in spans:
            p.append(slab(xa, xb, y0, y1, 0, zb, lo, lot, chip=0.04, step=1.7))
            p.append(slab(xa2, xb2, y0, y1, zb, top, hi, hi_t, chip=0.0, step=1.7, tile=htile))
        # timber frame on the outside face: plates, studs and a pair of braces
        xo = sx * (hw + 0.05)
        for z in (zb + 0.06, 1.95, top - 0.08):
            p.append((bbox(0.12, D - 0.4, 0.16, fr, fr_t), T(xo, 0.2, z)))
        ys = np.linspace(yf + 0.1, hd - 0.1, 5)
        for y in ys: p.append((bbox(0.12, 0.18, top - zb, fr, fr_t), T(xo, y, (top + zb) / 2)))
        mine = (wins or {}).get(sx, [])
        for y in mine: p += window(pre, sx, hw, y, 2.55, st)
        for k in (0, 3):
            if sx == hearth_side and min(abs(ys[k] - hearth_y), abs(ys[k + 1] - hearth_y)) < 1.0: continue
            if any(ys[k] < y < ys[k + 1] for y in mine): continue
            a, b = ((ys[k], 1.95), (ys[k + 1], top - 0.1)) if k == 0 else ((ys[k + 1], 1.95), (ys[k], top - 0.1))
            p.append(beam((xo, a[0], a[1]), (xo, b[0], b[1]), 0.11, fr, fr_t))
    for z in (zb + 0.06, 1.95, top - 0.08):
        p.append((bbox(W - 0.1, 0.12, 0.16, fr, fr_t), T(0, hd + 0.05, z)))
    for x in np.linspace(-hw + 0.1, hw - 0.1, 5):
        p.append((bbox(0.18, 0.12, top - zb, fr, fr_t), T(x, hd + 0.05, (top + zb) / 2)))
    zr = top + (ridge - top) * 0.42  # round window in the back gable, king post above it
    p.append((bbox(0.2, 0.14, ridge - 0.3 - zr - 0.45, fr, fr_t), T(0, hd + 0.06, (zr + 0.45 + ridge - 0.3) / 2)))
    p.append((obj("ocul", *disc_lathe(0.36, 0.36, 0, 0.06, 10), "Glass" if not evil else "GlassOoze", None, tile=0.4), T(0, hd + 0.02, zr) @ R(-math.pi / 2, "X")))
    p.append((obj("ofr", *torus(0.4, 0.07, 10, 4), fr, fr_t, tile=0.4), T(0, hd + 0.1, zr) @ R(math.pi / 2, "X")))
    for a in (0, math.pi / 2): p.append((bbox(0.8, 0.06, 0.06, fr, fr_t), T(0, hd + 0.1, zr) @ R(a, "Y")))
    # front corner posts with knee braces, tie beam and the front gable
    for sx in (-1, 1):
        px, py = sx * (hw - 0.2), -hd + 0.2
        p.append((cyl(0.2, top - 0.05, fr, fr_t, seg=8, r1=0.18), T(px, py, 0.06) @ R(math.pi / 8, "Z")))
        with side_stone(lo): p.append((L.block(3310 + sx, 0.56, 0.56, 0.3, 0.04, seg=(1, 1, 1), tone=lo_t), T(px, py, 0.1)))
        p.append(beam((px - sx * 0.12, py, top - 1.0), (px - sx * 0.95, py, top - 0.12), 0.13, fr, fr_t))
        p.append(beam((px, py + 0.12, top - 1.0), (px, py + 0.95, top - 0.12), 0.13, fr, fr_t))
    p.append((bbox(W + 0.2, 0.34, 0.34, fr, fr_t, bev=0.04), T(0, -hd + 0.2, top - 0.05)))
    p.append((prism([(-hw + 0.1, top + 0.12), (hw - 0.1, top + 0.12), (0.0, ridge - 0.05)], -hd + 0.12, -hd + 0.3, hi, hi_t, tile=htile), Matrix()))
    p.append((bbox(0.2, 0.12, ridge - top - 0.5, fr, fr_t), T(0, -hd + 0.08, (top + ridge - 0.3) / 2)))
    for sx in (-1, 1):
        p.append(beam((sx * (hw * 0.62), -hd + 0.08, top + 0.2), (sx * 0.12, -hd + 0.08, top + (ridge - top) * 0.62), 0.13, fr, fr_t))
    # interior tie beams (lantern hangers) and the ridge beam
    for y in tie_ys(D):
        p.append((bbox(W - 0.7, 0.24, 0.26, fr, fr_t), T(0, y, top - 0.15)))
        p.append((bbox(0.18, 0.18, ridge - top - (0.7 if not evil else 1.0), fr, fr_t), T(0, y, (top + ridge - (0.6 if not evil else 0.9)) / 2)))
    p.append((bbox(0.22, D + 0.6, 0.26, fr, fr_t), T(0, -0.3, ridge - (0.4 if not evil else 0.7))))
    # roof: two slabs, overhanging 1.0 at the front, 0.45 at the back, 0.55 at the eaves; bargeboards and fascia
    ov = 0.55; run = hw + ov; zeave = top - s * ov; yb0, yb1 = -hd - 1.0, hd + 0.45; th = 0.2
    hyp = math.hypot(run, run * s) + 0.12; rt = st["roof_t"] or moss_slate
    for sx in (-1, 1):
        V, F = boxv(hyp, yb1 - yb0, th, 0.03, seg=(5, 6, 1), wob=0.025 if not evil else 0.05, seed=40 + sx)
        if evil:  # Grumblekeep's ridge sags in the middle like an old mattress
            V[:, 2] -= 0.24 * np.sin(np.pi * (V[:, 1] / (yb1 - yb0) + 0.5)) * (0.35 + 0.65 * (V[:, 0] * -sx / hyp + 0.5))
        cx = sx * (run / 2 - 0.03); cz = zeave + s * run / 2 + th / 2 / math.cos(ang)
        p.append((obj("roof", V, F, st["roof"], rt, tile=1.6, sa=30), T(cx, (yb0 + yb1) / 2, cz) @ R(sx * ang, "Y")))
        p.append((bbox(hyp, 0.08, 0.34, fr, fr_t), T(sx * (run / 2), yb0 - 0.04, zeave + s * run / 2 + 0.02) @ R(sx * ang, "Y")))
        p.append((bbox(0.1, yb1 - yb0, 0.2, fr, fr_t), T(sx * (run + 0.02), (yb0 + yb1) / 2, zeave - 0.02)))
    p += hearth(pre, hearth_side, hearth_y, hw, top, ridge, s, st)
    return p

def window(pre, sx, hw, y, z, st, w=0.8, h=0.9):
    """A glowing window through a side wall: glass, sill, lintel, mullion and two shutters swung open."""
    p = []; fr, fr_t = st["frame"], st["frame_t"]; glass = "Glass" if pre != "G" else "GlassOoze"
    xa, xb = sorted((sx * (hw - 0.43), sx * (hw + 0.04)))
    p.append(slab(xa, xb, y - w / 2, y + w / 2, z - h / 2, z + h / 2, glass, None, chip=0.0, step=2.0, tile=0.5))
    p.append((bbox(0.2, w + 0.3, 0.12, fr, fr_t), T(sx * (hw + 0.1), y, z - h / 2 - 0.04)))
    p.append((bbox(0.14, w + 0.2, 0.12, fr, fr_t), T(sx * (hw + 0.08), y, z + h / 2 + 0.04)))
    p.append((bbox(0.1, 0.06, h, fr, fr_t), T(sx * (hw + 0.07), y, z)))
    p.append((bbox(0.1, w, 0.06, fr, fr_t), T(sx * (hw + 0.07), y, z + 0.1)))
    paint = {"D": [0.32, 0.5, 0.85], "N": [0.45, 0.62, 0.35], "G": [0.45, 0.25, 0.55]}[pre]
    for sy in (-1, 1):
        p.append((bbox(0.05, w / 2, h, "Wood", col(paint, 3960 + sy, 0.1)), T(sx * (hw + 0.1) + sx * 0.15, y + sy * (w / 2 + 0.17), z) @ R(sx * sy * 1.1, "Z")))
    return p

def flag(w, h, rgb, sigil, seed, tatter=0.0, metal="Brass", mt=BRASS_T):
    """Hanging banner, origin at the top centre, face toward -Y: a soft-waved sheet with a pointed (or tattered) tail
    and a raised sigil."""
    rr = np.random.default_rng(seed)
    def f(u, v):
        x = (u - 0.5) * w; z = -v * h
        if v > 0.999: z -= h * 0.18 * (1 - abs(2 * u - 1)) + (tatter * h * 0.25 * abs(math.sin(u * 9 + seed)) if tatter else 0)
        return (x, -0.04 * math.sin(v * 3 + seed) * v - 0.02 * math.sin(u * math.pi), z)
    p = [sheet(2, 5, f, "Cloth", col(rgb, seed, 0.08), tile=0.5, sa=80)]
    p.append((obj("sig", *lathe([(0.0, 0.0), (w * 0.22, 0.0), (w * 0.2, 0.025), (0.0, 0.03)], 6 if not tatter else 4), "Cloth", col(sigil, seed + 1, 0.05), tile=0.3, sa=30), T(0, -0.06, -h * 0.42) @ R(math.pi / 2, "X")))
    p.append(rodr((-w * 0.6, -0.01, 0.0), (w * 0.6, -0.01, 0.0), 0.025, metal, mt, 5))
    return p

def tie_ys(D): return [D / 2 - 1.5, -0.4] if D < 7 else [D / 2 - 1.8, 0.4, -2.0]

def hearth(pre, side, yh, hw, top, ridge, s, st):
    p = []; lo, lo_t = st["lo"], st["lo_t"]; evil = pre == "G"; lot = course_tone(51, lo_t, 0.42) if lo == "Stone" else lo_t
    soot = col([0.25, 0.22, 0.2], 50, 0.15)
    # chimney breast outside, and the stack through the eave
    xa, xb = sorted((side * (hw - 0.02), side * (hw + 0.55)))
    p.append(slab(xa, xb, yh - 0.95, yh + 0.95, 0, top + 0.1, lo, lot, chip=0.05, step=0.9))
    zt = ridge - s * (hw + 0.27) + 1.4
    xa, xb = sorted((side * (hw - 0.06), side * (hw + 0.5)))
    p.append(slab(xa, xb, yh - 0.48, yh + 0.48, top + 0.05, zt, lo, lot, chip=0.05, step=0.9))
    xa, xb = sorted((side * (hw - 0.13), side * (hw + 0.57)))
    p.append(slab(xa, xb, yh - 0.56, yh + 0.56, zt, zt + 0.16, lo, lo_t, chip=0.04, step=1.2))
    if evil:  # crooked iron drum pots
        p.append((cyl(0.16, 0.5, "Iron", IRON_T, seg=7), T(side * (hw + 0.22), yh - 0.15, zt + 0.12) @ R(0.15, "X")))
        p.append((cyl(0.13, 0.4, "Iron", IRON_T, seg=7), T(side * (hw + 0.22), yh + 0.18, zt + 0.12) @ R(-0.2, "X")))
    else:
        p.append((cyl(0.14, 0.42, st["metal"] if pre == "D" else "Stone", BRASS_T if pre == "D" else lo_t, seg=7, r1=0.17), T(side * (hw + 0.22), yh, zt + 0.12)))
    # firebox: sooty back and cheeks; surround jambs, lintel, mantel, hearthstone
    xa, xb = sorted((side * (hw - 0.03), side * (hw - 0.06)))
    p.append(slab(xa, xb, yh - 0.7, yh + 0.7, 0.06, 1.36, "Stone", soot, chip=0.0, step=0.7))
    for sy in (-1, 1):
        xa, xb = sorted((side * (hw - 0.03), side * (hw - 0.4)))
        p.append(slab(xa, xb, yh + sy * 0.7 - 0.06, yh + sy * 0.7 + 0.06, 0.06, 1.36, "Stone", soot, chip=0.0, step=0.7))
    with side_stone(lo):
        for sy in (-1, 1):
            p.append((L.block(3401 + sy + len(pre), 0.36, 0.34, 1.4, 0.04, seg=(1, 1, 2), tone=lo_t), T(side * (hw - 0.5), yh + sy * 0.86, 0.75)))
        p.append((L.block(3405 + len(pre), 0.42, 2.1, 0.3, 0.04, seg=(1, 3, 1), tone=lo_t), T(side * (hw - 0.5), yh, 1.55)))
        p.append((L.block(3406 + len(pre), 0.75, 2.1, 0.06, 0.02, seg=(1, 3, 1), tone=lo_t), T(side * (hw - 0.75), yh, 0.12)))
    p.append((bbox(0.44, 2.3, 0.12, "Wood", st["frame_t"], bev=0.03), T(side * (hw - 0.55), yh, 1.76)))  # mantel shelf
    p += grp(flames(60 + len(pre)), T(side * (hw - 0.2), yh, 0.1) @ R(math.pi / 2, "Z"))
    for sy in (-1, 1):  # firedogs
        p.append(rodr((side * (hw - 0.45), yh + sy * 0.4, 0.1), (side * (hw - 0.45), yh + sy * 0.4, 0.42), 0.025, "Iron", IRON_T, 5))
        p.append((blob(0.05, 0.05, 0.05, st["metal"], st["metal_t"], 6, 3), T(side * (hw - 0.45), yh + sy * 0.4, 0.45)))
    if pre == "D":
        for k, y in enumerate((-0.75,)):
            p += grp(mug(foam=False, band="Brass"), T(side * (hw - 0.55), yh + y, 1.82) @ R(k * 1.3, "Z"))
        v, f = bipyramid(0.2, 0.2, 0.1, 6); p.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(side * (hw - 0.55), yh, 2.06)))
        p.append((obj("stand", *lathe([(0.0, 0.0), (0.1, 0.0), (0.06, 0.06), (0.08, 0.1), (0.0, 0.1)], 6), "Brass", BRASS_T, tile=0.3), T(side * (hw - 0.55), yh, 1.82)))
        # kettle on a swing crane
        p.append(rodr((side * (hw - 0.12), yh - 0.6, 0.3), (side * (hw - 0.12), yh - 0.6, 1.2), 0.025, "Iron", IRON_T, 4))
        p.append(rodr((side * (hw - 0.12), yh - 0.6, 1.15), (side * (hw - 0.25), yh - 0.05, 1.15), 0.022, "Iron", IRON_T, 4))
        p.append(rodr((side * (hw - 0.25), yh - 0.05, 1.15), (side * (hw - 0.25), yh - 0.05, 0.9), 0.01, "Iron", IRON_T, 3))
        kv, kf = lathe([(0.0, 0.0), (0.12, 0.0), (0.16, 0.08), (0.14, 0.18), (0.06, 0.22), (0.0, 0.23)], 8)
        p.append((obj("kettle", kv, kf, "Brass", col([0.8, 0.6, 0.45], 61, 0.1), tile=0.3, sa=50), T(side * (hw - 0.25), yh - 0.05, 0.68)))
    elif pre == "G":
        p += grp(skull(3420, 0.26, 0.2, 0.24, eye_big=1.35), T(side * (hw - 0.55), yh, 2.04) @ R(-side * math.pi / 2, "Z"))
        for k, y in enumerate((-0.8,)):
            p += grp(mug(body="Bone", btone=BONE_T, band="Iron", foam_mat="Ooze", foam_tone=None), T(side * (hw - 0.55), yh + y, 1.82) @ R(k * 1.7, "Z"))
        cv, cf = lathe([(0.0, 0.0), (0.18, 0.0), (0.26, 0.12), (0.27, 0.26), (0.22, 0.32), (0.0, 0.3)], 9)  # ooze cauldron on the fire
        p.append((obj("caul", cv, cf, "Iron", IRON_T, tile=0.4, sa=40), T(side * (hw - 0.22), yh, 0.42)))
        p.append((obj("ooz", *disc_lathe(0.22, 0.22, 0, 0.02, 9), "Ooze", None, tile=0.4), T(side * (hw - 0.22), yh, 0.73)))
        for k in range(3): p.append((blob(0.05, 0.05, 0.04, "Ooze", None, 6, 3), T(side * (hw - 0.22) + 0.08 * math.cos(k * 2.1), yh + 0.08 * math.sin(k * 2.1), 0.76)))
        for sy in (-1, 1): p.append(rodr((side * (hw - 0.22), yh + sy * 0.25, 0.1), (side * (hw - 0.22), yh + sy * 0.25, 0.5), 0.02, "Iron", IRON_T, 4))
    else:
        for k, y in enumerate((-0.8,)):
            p += grp(mug(foam=False, band="Iron"), T(side * (hw - 0.55), yh + y, 1.82) @ R(k * 1.1, "Z"))
        p += grp(keg(0.12, 0.26), T(side * (hw - 0.55), yh - 0.3, 1.82))
        p += grp(sun_disc(0.18, gem="Crystal", rays=8), T(side * (hw - 0.48), yh + 0.2, 2.15) @ R(0, "Z") @ R(side * math.pi / 2, "Z"))
        p += grp(skull(3430, 0.15, 0.12, 0.14, eye_big=1.3), T(side * (hw - 0.55), yh + 0.5, 1.98) @ R(-side * math.pi / 2 + 0.3, "Z"))
    return p

def bar(pre, cy, length, st, depth=0.7):
    """Counter (front face at cy - depth/2, top at 1.1), foot rail, pumps, mugs; keg stillage and bottle shelf on the
    back wall, standing kegs at the ends."""
    p = []; fr, fr_t = st["frame"], st["frame_t"]; metal, mt = st["metal"], st["metal_t"]; evil = pre == "G"
    yf = cy - depth / 2; kmetal, kmt = ("Iron", IRON_T) if evil else (metal, mt); kw = DARKWOOD_T if evil else WOOD_T
    p.append(slab(-length / 2, length / 2, yf + 0.05, cy + depth / 2, 0.1, 1.04, "Wood", col([0.62, 0.48, 0.38], 69, 0.1) if not evil else col([0.38, 0.3, 0.3], 69, 0.1), chip=0.0, step=1.0, tile=0.8))
    n = int(round(length / 0.8))  # panelled front: muntins and rails proud of a darker body
    for k in range(n + 1):
        p.append((bbox(0.12, 0.07, 0.86, fr, fr_t), T(-length / 2 + k * length / n, yf + 0.03, 0.57)))
    for z in (0.17, 0.98):
        p.append((bbox(length + 0.05, 0.08, 0.12, fr, fr_t), T(0, yf + 0.03, z)))
    p.append((bbox(length + 0.16, depth + 0.12, 0.07, "Wood", col([0.82, 0.6, 0.42], 70, 0.08) if not evil else DARKWOOD_T, bev=0.025), T(0, cy, 1.065)))
    p.append(rodr((-length / 2 + 0.1, yf - 0.16, 0.28), (length / 2 - 0.1, yf - 0.16, 0.28), 0.03, metal, mt, 6))
    for x in np.linspace(-length / 2 + 0.3, length / 2 - 0.3, 4):
        p.append(rodr((x, yf, 0.28), (x, yf - 0.16, 0.28), 0.02, metal, mt, 4))
    if evil:  # bone trim along the counter's front edge
        p.append(tube2([(-length / 2 - 0.05, yf - 0.03, 1.02), (length / 2 + 0.05, yf - 0.03, 1.02)], 0.05, 0.05, "Bone", BONE_T, 6, 1))
        for x in (-length / 2 - 0.05, length / 2 + 0.05): p.append((blob(0.09, 0.09, 0.08, "Bone", BONE_T), T(x, yf - 0.03, 1.02)))
    for x in (-1.25, -0.7, 0.7, 1.25):  # beer pumps at the back edge of the counter, clear of the centre
        p.append((cyl(0.045, 0.3, metal, mt, seg=6), T(x, cy + 0.18, 1.1)))
        p.append(rodr((x, cy + 0.18, 1.36), (x, cy + 0.04, 1.36), 0.02, metal, mt, 4))
        hand = "Bone" if evil else "Wood"
        p.append((obj("handle", *lathe([(0.0, 0.0), (0.03, 0.0), (0.045, 0.12), (0.035, 0.24), (0.0, 0.26)], 5), hand, BONE_T if evil else col([0.7, 0.32, 0.22], 72, 0.1), tile=0.3), T(x, cy + 0.18, 1.39) @ R(0.25, "X")))
    for k, x in enumerate((-1.9, 1.75)):
        body, bt = ("Bone", BONE_T) if evil else ("Wood", WOOD_T)
        p += grp(mug(body=body, btone=bt, band=metal, foam_mat="Ooze" if evil else "Plaster", foam_tone=None if evil else FOAM_T), T(x, yf + 0.3, 1.1) @ R(k * 1.7, "Z"))
    # back bar: keg stillage with taps facing the room, bottle shelf above
    zk = 1.62; back = cy + depth / 2 + 0.15
    p.append((bbox(length - 0.6, 0.6, 0.08, "Wood", fr_t), T(0, back - 0.3, zk - 0.32)))
    for x in (-(length / 2 - 0.4), length / 2 - 0.4):
        p.append(beam((x, back - 0.55, zk - 0.38), (x, back - 0.02, zk - 0.85), 0.08, "Wood", fr_t))
    nk = 3 if length < 6 else 4
    for k, x in enumerate(np.linspace(-(length / 2 - 1.1), length / 2 - 1.1, nk)):
        wt = col([0.85, 0.65, 0.45], 80 + k, 0.1) if not evil else DARKWOOD_T
        p += grp(keg(0.27, 0.56, "Wood", wt, kmetal, kmt), T(x, back - 0.02, zk) @ R(math.pi / 2, "X"))
        p.append((cyl(0.03, 0.1, metal, mt, seg=5), T(x, back - 0.58, zk - 0.08) @ R(math.pi / 2, "X")))
        p.append(rodr((x, back - 0.66, zk - 0.06), (x, back - 0.66, zk - 0.2), 0.018, metal, mt, 4))
        p.append((bbox(0.62, 0.08, 0.08, "Wood", fr_t), T(x, back - 0.3, zk - 0.3)))
        if evil: p += grp(skull(3500 + k, 0.11, 0.08, 0.1, eye_big=1.3, seg=8, rings=6), T(x, back - 0.6, zk + 0.07))
        elif pre == "D" and k == 1: p += grp(sun_disc(0.1, rays=8, gem=None), T(x, back - 0.6, zk + 0.07))
    zs = 2.45
    p.append((bbox(length - 0.2, 0.32, 0.06, "Wood", fr_t), T(0, back - 0.16, zs)))
    for x in (-(length / 2 - 0.3), 0.0, length / 2 - 0.3):
        p.append(beam((x, back - 0.02, zs - 0.35), (x, back - 0.28, zs - 0.03), 0.05, "Wood", fr_t))
    rr = np.random.default_rng(len(pre) * 7 + int(length)); glows = ["Crystal", "Ember", "Ooze", "Amethyst"]
    for k, x in enumerate(np.linspace(-(length / 2 - 0.4), length / 2 - 0.4, 9 if length < 6 else 11)):
        if k % 4 == 3:
            p += grp(mug(foam=False, body="Bone" if evil else "Wood", btone=BONE_T if evil else WOOD_T), T(x, back - 0.16, zs + 0.03) @ R(k, "Z"))
            continue
        h = 0.2 + 0.1 * rr.random(); g = glows[(k + len(pre)) % 4]
        bv, bf = lathe([(0.0, 0.0), (0.055, 0.0), (0.055, h * 0.6), (0.02, h * 0.8), (0.02, h), (0.0, h)], 5)
        p.append((obj("bottle", bv, bf, g, None, tile=0.3, sa=50), T(x, back - 0.16, zs + 0.03)))
    # standing kegs at the ends of the counter
    xe = length / 2 + 0.55
    for sx in (-1, 1):
        if sx == -1 and pre != "N":  # the hearth wall is on this side: one keg tucked in the corner
            p += grp(keg(0.24, 0.55, "Wood", kw, kmetal, kmt), T(-xe - 0.05, cy + 0.15, 0.1))
            continue
        p += grp(keg(0.27, 0.62, "Wood", kw, kmetal, kmt), T(sx * xe, cy - 0.12, 0.1))
        p += grp(keg(0.27, 0.62, "Wood", kw, kmetal, kmt), T(sx * (xe + 0.05), cy + 0.42, 0.1) @ R(0.4, "Z"))
        if pre == "N": p += grp(keg(0.24, 0.55, "Wood", kw, kmetal, kmt), T(sx * xe, cy + 0.15, 0.72) @ R(0.9, "Z"))
    return p

def table_set(pre, x, y, st, seed, bench_side=1):
    """Round table (r 0.7) with a bench toward the bar and three stools; mugs and a candle on top."""
    p = []; rr = np.random.default_rng(seed); evil = pre == "G"; tt = st["table_t"]
    top_t = col([0.85, 0.65, 0.48], seed, 0.12) if not evil else col([0.45, 0.36, 0.36], seed, 0.12)
    p.append((obj("top", *lathe([(0.0, 0.0), (0.66, 0.0), (0.7, 0.045), (0.66, 0.09), (0.0, 0.09)], 12), "Wood", top_t, tile=0.6, sa=40), T(x, y, 0.7)))
    p.append((cyl(0.09, 0.62, "Wood", tt, seg=6), T(x, y, 0.1)))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4; e = (x + math.cos(a) * 0.48, y + math.sin(a) * 0.48, 0.12)
        if evil: p.append(tube2([(x, y, 0.38), (x + math.cos(a) * 0.3, y + math.sin(a) * 0.3, 0.3), e], 0.06, 0.04, "Bone", BONE_T, 5, 1))
        else: p.append(beam((x, y, 0.3), e, 0.08, "Wood", tt))
    by = y + bench_side * 1.05
    p.append((bbox(1.5, 0.36, 0.07, "Wood", tt), T(x, by, 0.47)))
    for sx in (-1, 1):
        if evil:
            p.append(tube2([(x + sx * 0.6, by, 0.1), (x + sx * 0.56, by, 0.3), (x + sx * 0.6, by, 0.45)], 0.05, 0.05, "Bone", BONE_T, 5, 1))
            p.append((blob(0.08, 0.08, 0.05, "Bone", BONE_T, 6, 3), T(x + sx * 0.6, by, 0.12)))
        else: p.append((bbox(0.08, 0.3, 0.37, "Wood", tt), T(x + sx * 0.6, by, 0.285)))
    for k, a in enumerate((-math.pi / 2 * bench_side, -math.pi / 2 * bench_side - 1.2, -math.pi / 2 * bench_side + 1.2)):
        sx_, sy_ = x + math.cos(a) * 1.0, y + math.sin(a) * 1.0
        p.append((cyl(0.2, 0.06, "Wood", top_t, seg=7, r1=0.18), T(sx_, sy_, 0.43)))
        for j in range(3):
            b = j / 3 * TAU + a
            p.append(rodr((sx_ + math.cos(b) * 0.1, sy_ + math.sin(b) * 0.1, 0.44), (sx_ + math.cos(b) * 0.17, sy_ + math.sin(b) * 0.17, 0.0), 0.03, "Bone" if evil else "Wood", BONE_T if evil else tt, 3))
    for k in range(1):
        a = rr.random() * TAU; d = 0.3 + 0.2 * rr.random()
        body, bt = ("Bone", BONE_T) if evil else ("Wood", WOOD_T)
        p += grp(mug(body=body, btone=bt, band=st["metal"] if k == 0 else None, foam_mat="Ooze" if evil else "Plaster", foam_tone=None if evil else FOAM_T), T(x + math.cos(a) * d, y + math.sin(a) * d, 0.79) @ R(rr.random() * TAU, "Z"))
    p.append((obj("dish", *disc_lathe(0.09, 0.1, 0, 0.02, 6), st["metal"], st["metal_t"], tile=0.3), T(x, y, 0.79)))
    p.append((cyl(0.035, 0.1, "Plaster", col([1.0, 0.95, 0.8], 5, 0.04), seg=5), T(x, y, 0.81)))
    v, f = L.crystal_point(0.08, 0.022, 4); p.append((obj("flame", v, f, "Ember", None, tile=0.2, sa=20), T(x, y, 0.91)))
    return p

def hanging_lanterns(points, st, drop=0.5):
    p = []
    for (x, y, z) in points:
        p.append(rodr((x, y, z), (x, y, z - drop), 0.012, "Iron", IRON_T, 3))
        p += grp(lantern(st["metal"], st["metal_t"], st["lamp"], 1.1), T(x, y, z - drop))
    return p

def post_lanterns(hw, hd, top, st):
    p = []
    for sx in (-1, 1):
        px, py = sx * (hw - 0.2), -hd + 0.2
        p.append(rodr((px, py - 0.15, top - 0.6), (px, py - 0.7, top - 0.6), 0.03, st["metal"], st["metal_t"], 5))
        p.append(rodr((px, py - 0.15, top - 0.95), (px, py - 0.6, top - 0.62), 0.02, st["metal"], st["metal_t"], 4))
        p += grp(lantern(st["metal"], st["metal_t"], st["lamp"], 1.2), T(px, py - 0.68, top - 0.62))
    return p

def sign_arm(hd, st, z, drop=0.3, reach=0.7):
    """Arm out of the front gable from which a sign hangs. Returns parts and the hang point."""
    y0, y1 = -hd + 0.1, -hd - reach; m, mt = st["metal"], st["metal_t"]
    p = [rodr((0, y0, z), (0, y1, z), 0.045, m, mt, 6), rodr((0, y0, z - 0.6), (0, y1 + 0.25, z - 0.02), 0.025, m, mt, 5)]
    p.append((obj("curl", *torus(0.12, 0.02, 8, 4), m, mt, tile=0.3), T(0, y0 - 0.25, z - 0.25) @ R(math.pi / 2, "Y")))
    p.append((blob(0.06, 0.06, 0.06, m, mt, 6, 4), T(0, y1 - 0.05, z)))
    for sx in (-1, 1): p.append(rodr((sx * 0.5, y1 + 0.1, z), (sx * 0.5, y1 + 0.1, z - drop), 0.012, "Iron", IRON_T, 3))
    return p, (0, y1 + 0.1, z - drop)

def sign_board(w, h, board_t, frame, frame_t, thick=0.08):
    """Hanging board, origin at its top centre, face toward -Y."""
    p = [(bbox(w, thick, h, "Wood", board_t, bev=0.03), T(0, 0, -h / 2))]
    for z in (-0.02, -h + 0.02): p.append((bbox(w + 0.06, thick + 0.04, 0.07, frame, frame_t), T(0, 0, z)))
    for x in (-w / 2, w / 2): p.append((bbox(0.07, thick + 0.04, h, frame, frame_t), T(x, 0, -h / 2)))
    return p

def d_sign():
    """Dawnhold: a foaming mug crossed with a brass hammer on a blue board."""
    p = sign_board(1.5, 1.15, col([0.22, 0.36, 0.72], 90, 0.1), "Brass", BRASS_T)
    M = T(0.05, -0.08, -0.6) @ R(-0.75, "Y")  # hammer behind the mug
    p.append((cyl(0.035, 0.95, "Wood", WOOD_T, seg=6), M @ T(0, 0, -0.5)))
    p.append((bbox(0.4, 0.14, 0.2, "Brass", BRASS_T, bev=0.03), M @ T(0, 0, 0.5)))
    p += grp(mug(r=0.24, h=0.5, body="Wood", btone=col([0.85, 0.62, 0.4], 91, 0.08), band="Brass", seg=10), T(-0.08, -0.14, -1.02))
    for k in range(5):  # foam overflowing
        a = k / 5 * TAU; p.append((blob(0.11, 0.1, 0.09, "Plaster", FOAM_T, 7, 4), T(-0.08 + math.cos(a) * 0.17, -0.2 + math.sin(a) * 0.05, -0.47 + 0.04 * math.sin(a * 2))))
    p.append((blob(0.06, 0.05, 0.16, "Plaster", FOAM_T, 6, 4), T(0.14, -0.36, -0.64)))
    for x in (-0.58, 0.58):
        v, f = bipyramid(0.08, 0.08, 0.05, 4); p.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(x, -0.06, -0.22) @ R(math.pi / 2, "X")))
    return p

def skull_mug(s=1.0, seed=3600):
    """A mug shaped like a goofy skull, ooze foam frothing over the crown and a bone handle."""
    p = grp(skull(seed, 0.26 * s, 0.24 * s, 0.3 * s, eye_big=1.35), T(0, 0, 0.3 * s))
    for k in range(5):
        a = k / 5 * TAU; p.append((blob(0.12 * s, 0.11 * s, 0.09 * s, "Ooze", None, 7, 4), T(math.cos(a) * 0.15 * s, math.sin(a) * 0.12 * s, 0.57 * s + 0.03 * s * math.sin(a * 3))))
    p.append((blob(0.13 * s, 0.12 * s, 0.12 * s, "Ooze", None, 7, 4), T(0, 0, 0.66 * s)))
    p.append((blob(0.05 * s, 0.05 * s, 0.17 * s, "Ooze", None, 6, 4), T(0.16 * s, -0.17 * s, 0.45 * s)))
    p.append(tube2([(0.24 * s, 0, 0.5 * s), (0.44 * s, 0, 0.44 * s), (0.42 * s, 0, 0.2 * s), (0.24 * s, 0, 0.14 * s)], 0.045 * s, 0.045 * s, "Bone", BONE_T, 5, 2))
    return p

def g_sign():
    """Grumblekeep: a goofy skull mug frothing ooze, on a purple board with bone spikes."""
    p = sign_board(1.5, 1.15, col([0.4, 0.2, 0.5], 92, 0.12), "Iron", IRON_T)
    p += grp(skull_mug(1.15), T(-0.05, -0.22, -1.08))
    for x in (-0.75, 0.75):
        p.append((blob(0.08, 0.08, 0.07, "Bone", BONE_T, 6, 4), T(x, 0, -1.15)))
        v, f = L.crystal_point(0.28, 0.05, 4); p.append((obj("spike", v, f, "Bone", BONE_T, tile=0.3), T(x, 0, -0.02) @ R(x * 0.6, "Y")))
    return p

def n_sign():
    """The Muddled Mug: a tipsy, cross-eyed mug with foam sloshing over, on a big cream board."""
    p = sign_board(1.8, 1.35, col([0.88, 0.75, 0.52], 93, 0.1), "Iron", IRON_T)
    M = T(0.02, -0.15, -1.24) @ R(0.22, "Y")
    p += grp(mug(r=0.3, h=0.62, body="Wood", btone=col([0.9, 0.62, 0.38], 94, 0.08), band="Brass", seg=10), M)
    for k in range(6):
        a = k / 6 * TAU; p.append((blob(0.13, 0.12, 0.1, "Plaster", FOAM_T, 7, 4), M @ T(math.cos(a) * 0.22, math.sin(a) * 0.08 - 0.06, 0.62 + 0.05 * math.sin(a * 2))))
    p.append((blob(0.1, 0.08, 0.22, "Plaster", FOAM_T, 7, 4), M @ T(-0.32, -0.12, 0.5) @ R(0.4, "Y")))
    for sx, look in ((-1, 1), (1, -1)):  # googly, cross-eyed eyes
        e = M @ T(sx * 0.13, -0.3, 0.38)
        p.append((blob(0.11, 0.06, 0.12, "Bone", col([1.0, 1.0, 0.97], 95, 0.03), 8, 5), e))
        p.append((blob(0.045, 0.03, 0.05, "Iron", col([0.25, 0.25, 0.25], 96, 0.05), 6, 4), e @ T(look * 0.05, -0.045, -0.01 * sx)))
    gp = [M @ Vector(q) for q in ((-0.15, -0.32, 0.21), (-0.06, -0.335, 0.15), (0.04, -0.335, 0.2), (0.13, -0.32, 0.14))]
    p.append(tube2([tuple(v) for v in gp], 0.022, 0.022, "Iron", col([0.3, 0.16, 0.12], 97, 0.05), 4, 2))
    for k, (x, z) in enumerate(((-0.75, -0.3), (0.72, -1.1), (0.62, -0.28))):  # hiccup bubbles
        p.append((blob(0.05 + 0.02 * k, 0.03, 0.05 + 0.02 * k, "Plaster", FOAM_T, 7, 4), T(x, -0.08, z)))
    return p

def handshake(seed):
    """Neutral emblem: a blue Dawnhold sleeve and a purple Grumblekeep sleeve clasping hands. Faces -Y."""
    p = []
    for sx, cloth, cuff in ((-1, [0.16, 0.32, 0.78], "Brass"), (1, [0.4, 0.16, 0.52], "Bone")):
        p.append(tube2([(sx * 1.05, 0, -0.32), (sx * 0.7, 0, -0.12), (sx * 0.32, 0, -0.02)], 0.17, 0.14, "Cloth", col(cloth, seed + sx, 0.08), 7, 2))
        p.append((obj("cuff", *torus(0.16, 0.045, 8, 4), cuff, BRASS_T if cuff == "Brass" else BONE_T, tile=0.3), T(sx * 0.32, 0, -0.02) @ R(math.pi / 2, "Y")))
        skin = col([0.95, 0.75, 0.6] if sx < 0 else [0.72, 0.85, 0.58], seed, 0.05)
        p.append((blob(0.2, 0.13, 0.13, "Plaster", skin, 8, 5), T(sx * 0.12, -0.02 * sx, 0.02) @ R(0.3 * sx, "Y")))
        p.append((blob(0.05, 0.05, 0.1, "Plaster", skin, 6, 4), T(sx * 0.05, -0.12, 0.13) @ R(-0.4 * sx, "Y")))
    return p


# ---- lived-in dressing (2026-10-09 tavern glow-up): everything hugs the walls or hangs from the beams, so the floor,
# the bar front and the tables the townsfolk use stay clear, and nothing changes the footprint or the anchors.
def chandelier(x, y, z_beam, st, r=0.55, drop=0.85, n=6):
    """Wagon-wheel candle chandelier hung on three chains from a tie beam: iron-shod rim, spokes, dripping candles."""
    p = []; z = z_beam - drop; m, mt = st["metal"], st["metal_t"]; evil = st["lamp"] == "GlassOoze"
    p.append((obj("rim", *torus(r, 0.045, 14, 4), "Wood", st["frame_t"], tile=0.4), T(x, y, z)))
    p.append((obj("tyre", *torus(r + 0.03, 0.018, 14, 3), "Iron", IRON_T, tile=0.4), T(x, y, z)))
    p.append((cyl(0.09, 0.14, "Wood", st["frame_t"], seg=8), T(x, y, z - 0.07)))
    for k in range(n):
        a = k / n * TAU
        p.append(beam((x + math.cos(a) * 0.08, y + math.sin(a) * 0.08, z), (x + math.cos(a) * (r - 0.03), y + math.sin(a) * (r - 0.03), z), 0.035, "Wood", st["frame_t"]))
        cx, cy = x + math.cos(a + TAU / n / 2) * r, y + math.sin(a + TAU / n / 2) * r
        p.append((obj("cup", *disc_lathe(0.045, 0.06, 0, 0.03, 5), m, mt, tile=0.3), T(cx, cy, z + 0.03)))
        h = 0.12 + 0.05 * ((k * 7) % 3) / 2
        p.append((cyl(0.028, h, "Bone" if evil else "Plaster", BONE_T if evil else col([1.0, 0.95, 0.82], 4000 + k, 0.04), seg=5), T(cx, cy, z + 0.055)))
        v, f = L.crystal_point(0.075, 0.02, 4); p.append((obj("flame", v, f, "Ooze" if evil else "Ember", None, tile=0.2, sa=20), T(cx, cy, z + 0.06 + h)))
    for k in range(3):
        a = k / 3 * TAU + 0.3
        p.append(rodr((x + math.cos(a) * r * 0.92, y + math.sin(a) * r * 0.92, z + 0.02), (x, y, z_beam - 0.12), 0.012, "Iron", IRON_T, 3))
    p.append(rodr((x, y, z_beam - 0.12), (x, y, z_beam + 0.02), 0.02, "Iron", IRON_T, 4))
    if evil:  # a goofy skull nailed to the hub, ooze candles
        p += grp(skull(4020, 0.11, 0.09, 0.1, eye_big=1.3, seg=8, rings=6), T(x, y, z - 0.2))
    return p

def plate_shelf(sx, hw, y0, y1, z, st, seed, plates="Plaster", plate_t=None):
    """A plate rail on an inside wall: shelf on brackets, painted plates leaning on the wall, tankards and a jug."""
    p = []; xi = sx * (hw - 0.42); d = 0.22; xc = xi - sx * d / 2; evil = st["lamp"] == "GlassOoze"
    p.append((bbox(d, y1 - y0, 0.05, "Wood", st["frame_t"], bev=0.015), T(xc, (y0 + y1) / 2, z)))
    p.append((bbox(0.03, y1 - y0, 0.06, "Wood", st["frame_t"]), T(xi - sx * (d - 0.02), (y0 + y1) / 2, z + 0.05)))  # lip
    for y in np.linspace(y0 + 0.2, y1 - 0.2, max(2, int((y1 - y0) / 1.0) + 1)):
        p.append(beam((xi - sx * 0.02, y, z - 0.25), (xi - sx * (d - 0.03), y, z - 0.03), 0.04, "Wood", st["frame_t"]))
    rr = np.random.default_rng(seed); y = y0 + 0.2; k = 0
    while y < y1 - 0.18:
        kind = k % 4
        if kind in (0, 2):  # plate leaning on the wall, a painted ring round the rim
            r = 0.15 + 0.02 * rr.random()
            pt = plate_t or col([0.95, 0.93, 0.86], seed + k, 0.04)
            M = T(xi - sx * 0.05, y + r * 0.5, z + 0.03 + r) @ R(math.pi / 2, "Y") @ R(sx * 0.2, "Y" if False else "X")
            M = T(xi - sx * 0.06, y + r * 0.6, z + 0.03 + r) @ R(-sx * (math.pi / 2 - 0.22), "Y")
            p.append((obj("plate", *lathe([(0.0, 0.0), (r, 0.025), (r * 0.9, 0.034), (0.0, 0.016)], 10), plates, pt, tile=0.3, sa=50), M))
            ring = {"D": [0.2, 0.35, 0.8], "N": [0.35, 0.55, 0.3], "G": [0.45, 0.2, 0.55]}[st["pre"]]
            p.append((obj("ring", *torus(r * 0.78, 0.012, 10, 3), "Cloth", col(ring, seed + k, 0.05), tile=0.3), M @ T(0, 0, 0.022)))
            y += r * 2 + 0.06
        elif kind == 1:
            body, bt = ("Bone", BONE_T) if evil else ("Wood", col([0.85, 0.62, 0.42], seed + k, 0.1))
            p += grp(mug(r=0.06, h=0.14, body=body, btone=bt, band=st["metal"], foam=False, seg=7), T(xc, y + 0.06, z + 0.025) @ R(rr.random() * TAU, "Z"))
            y += 0.24
        else:  # glazed jug
            jt = col([0.55, 0.38, 0.25] if not evil else [0.35, 0.45, 0.3], seed + k, 0.08)
            p.append((obj("jug", *lathe([(0.0, 0.0), (0.08, 0.0), (0.1, 0.08), (0.085, 0.17), (0.05, 0.22), (0.06, 0.25), (0.0, 0.25)], 7), "Stone", jt, tile=0.3, sa=50), T(xc, y + 0.1, z + 0.025)))
            p.append(tube2([(xc, y + 0.17, z + 0.22), (xc, y + 0.24, z + 0.2), (xc, y + 0.24, z + 0.1), (xc, y + 0.18, z + 0.08)], 0.015, 0.015, "Stone", jt, 4, 1))
            y += 0.34
        k += 1
    return p

def notice_board(sx, hw, y, z, st, seed, w=0.95, h=0.75):
    """Cork notice board by the door: bounties, a lost-cat poster, a menu; brass pins."""
    p = []; xi = sx * (hw - 0.42)
    p.append((bbox(0.05, w, h, "Wood", col([0.72, 0.52, 0.32], seed, 0.12)), T(xi - sx * 0.025, y, z)))
    for dz in (-h / 2, h / 2): p.append((bbox(0.07, w + 0.08, 0.06, "Wood", st["frame_t"]), T(xi - sx * 0.04, y, z + dz)))
    for dy in (-w / 2, w / 2): p.append((bbox(0.07, 0.06, h + 0.06, "Wood", st["frame_t"]), T(xi - sx * 0.04, y + dy, z)))
    rr = np.random.default_rng(seed); papers = [(-0.25, 0.12, 0.3, 0.36, [0.97, 0.92, 0.78]), (0.12, 0.15, 0.34, 0.26, [0.95, 0.88, 0.7]),
                                                 (0.28, -0.16, 0.26, 0.3, [0.98, 0.95, 0.88]), (-0.18, -0.2, 0.32, 0.22, [0.93, 0.85, 0.65])]
    for k, (dy, dz, pw, ph, c) in enumerate(papers):
        a = (rr.random() - 0.5) * 0.25; M = T(xi - sx * 0.055, y + dy, z + dz) @ R(a, "X")
        p.append((bbox(0.008, pw, ph, "Plaster", col(c, seed + k, 0.04)), M))
        if k == 0:  # WANTED: a red band and a scowling sketch box
            p.append((bbox(0.004, pw * 0.8, 0.05, "Cloth", col([0.75, 0.18, 0.12], seed, 0.05)), M @ T(-sx * 0.006, 0, ph / 2 - 0.06)))
            p.append((bbox(0.004, pw * 0.55, ph * 0.38, "Slate", col([0.45, 0.4, 0.36], seed + 9, 0.05)), M @ T(-sx * 0.006, 0, 0.0)))
        for j in range(3):
            p.append((bbox(0.004, pw * (0.7 - 0.15 * j), 0.012, "Slate", col([0.3, 0.28, 0.26], seed + 20 + j, 0.05)), M @ T(-sx * 0.006, 0, -ph / 2 + 0.05 + 0.035 * j)))
        p.append((blob(0.018, 0.018, 0.018, st["metal"], st["metal_t"], 5, 3), M @ T(-sx * 0.012, 0, ph / 2 - 0.025)))
    return p

def herbs(points, seed):
    """Bunches of drying herbs, garlic and a string of onions hung from the beams by the bar."""
    p = []; rr = np.random.default_rng(seed)
    for k, (x, y, z) in enumerate(points):
        drop = 0.18 + 0.12 * rr.random()
        p.append(rodr((x, y, z), (x, y, z - drop), 0.006, "Cloth", col([0.85, 0.75, 0.55], seed + k, 0.05), 3))
        if k % 3 == 2:  # garlic and onion string
            for j in range(5):
                p.append((blob(0.05, 0.05, 0.055, "Plaster" if j % 2 else "Cloth", col([0.98, 0.95, 0.88] if j % 2 else [0.8, 0.5, 0.25], seed + j, 0.06), 5, 3),
                          T(x + 0.03 * math.sin(j * 2.1), y + 0.03 * math.cos(j * 2.1), z - drop - 0.05 - j * 0.08)))
        else:
            g = [[0.36, 0.48, 0.2], [0.5, 0.55, 0.28], [0.55, 0.42, 0.25]][k % 3]
            V, F = lathe([(0.0, 0.0), (0.09, 0.1), (0.07, 0.26), (0.015, 0.36)], 5)
            a_ = np.arctan2(V[:, 1], V[:, 0]); V[:, :2] *= (1 + 0.35 * np.sin(a_ * 2 + k))[:, None]  # a loose, lopsided bunch
            p.append((obj("herb", V, F, "Cloth", col(g, seed + k, 0.15), tile=0.3, sa=70), T(x, y, z - drop - 0.38)))
            p.append((obj("tie", *torus(0.03, 0.01, 6, 3), "Cloth", col([0.75, 0.25, 0.2], seed + k, 0.05), tile=0.3), T(x, y, z - drop - 0.02)))
            for j in range(4):  # stalks poking out of the tie, leaf tips curling out of the bottom
                a_ = j / 4 * TAU + k; p.append(rodr((x, y, z - drop - 0.03), (x + 0.06 * math.cos(a_), y + 0.06 * math.sin(a_), z - drop + 0.07), 0.008, "Wood", col([0.55, 0.5, 0.3], seed + j, 0.1), 3))
                p.append((blob(0.04, 0.025, 0.07, "Cloth", col(g, seed + k + j, 0.2), 4, 3), T(x + 0.08 * math.cos(a_), y + 0.08 * math.sin(a_), z - drop - 0.36) @ R(0.5 * math.cos(a_), "Y")))
    return p

def rug(x, y, rx, ry, colours, seed, rings=5):
    """Oval braided rag rug: concentric bands of colour, a little wobble, flat on the planks."""
    cols = [np.array(c) for c in colours]
    def tone(pp, n):
        r = np.sqrt(((pp[:, 0] - x) / rx) ** 2 + ((pp[:, 1] - y) / ry) ** 2)
        k = rings - 1 - np.clip((r * rings - 0.01).astype(int), 0, rings - 1); c = np.stack([cols[i % len(cols)] for i in k])  # border first
        return np.clip(c * (1 + 0.12 * fbm(pp, seed, 6.0, 2))[:, None], 0, 1)
    nr, na = rings * 2, 18
    V = [(x, y, 0.108)] + [(x + rx * (i / nr) * math.cos(a) * (1 + 0.02 * math.sin(a * 5 + i)), y + ry * (i / nr) * math.sin(a), 0.108) for i in range(1, nr + 1) for a in np.linspace(0, TAU, na, endpoint=False)]
    F = [[0, 1 + (j + 1) % na, 1 + j] for j in range(na)][::-1]
    F = [[0, 1 + j, 1 + (j + 1) % na] for j in range(na)]
    for i in range(nr - 1):
        a0, a1 = 1 + i * na, 1 + (i + 1) * na
        for j in range(na): F.append([a0 + j, a1 + j, a1 + (j + 1) % na, a0 + (j + 1) % na])
    return [(obj("rug", np.array(V), F, "Cloth", tone, tile=0.5, sa=80), Matrix())]

def trophy(pre, sx, hw, y, z, st):
    """Something mounted over the hearth with a story: Dawnhold's battered first-siege shield and crossed hammers,
    Grumblekeep's crossed bone cleavers, and The Muddled Mug's enormous trout (the one that did not get away)."""
    p = []; xi = sx * (hw - 0.42); m, mt = st["metal"], st["metal_t"]
    face = lambda M: T(xi - sx * 0.06, y, z) @ R(-sx * math.pi / 2, "Z") @ M  # local: x along the wall, -y out of it
    if pre in ("D", "G"):
        for a in (0.75, -0.75):  # crossed hammers / cleavers behind the shield
            Mh = face(R(a, "Y"))
            p.append((cyl(0.03, 1.15, "Wood" if pre == "D" else "Bone", st["frame_t"] if pre == "D" else BONE_T, seg=6), Mh @ T(0, 0.03, -0.55)))
            if pre == "D": p.append((bbox(0.32, 0.12, 0.17, "Brass", BRASS_T, bev=0.03), Mh @ T(0, 0.03, 0.6)))
            else:
                v = np.array([(0, -0.03, 0), (0.28, -0.03, 0.05), (0.32, -0.03, -0.2), (0.05, -0.03, -0.15), (0, 0.03, 0), (0.28, 0.03, 0.05), (0.32, 0.03, -0.2), (0.05, 0.03, -0.15)])
                p.append((obj("cleaver", v, [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], "Iron", IRON_T, tile=0.3, sa=20), Mh @ T(0, 0, 0.62)))
        shield_t = col([0.2, 0.36, 0.8], 4100, 0.08) if pre == "D" else col([0.4, 0.18, 0.5], 4101, 0.1)
        p.append((obj("shield", *lathe([(0.0, 0.0), (0.38, 0.0), (0.4, 0.03), (0.36, 0.07), (0.0, 0.1)], 14), "Wood", shield_t, tile=0.4, sa=40), face(R(math.pi / 2, "X"))))
        p.append((obj("srim", *torus(0.39, 0.03, 14, 4), m, mt, tile=0.3), face(R(math.pi / 2, "X") @ T(0, 0, 0.03))))
        if pre == "D":
            p += grp(sun_disc(0.17, rays=8, gem="Crystal"), face(T(0, -0.1, 0)))
            p.append((blob(0.07, 0.03, 0.05, m, mt, 6, 3), face(T(0.2, -0.09, 0.18))))  # the famous dent, patched
        else:
            p += grp(skull(4102, 0.14, 0.1, 0.13, eye_big=1.35, seg=9, rings=6), face(T(0, -0.14, 0.02) @ R(math.pi, "Z")))
    else:  # N: the big trout on its plaque
        p.append((bbox(1.3, 0.05, 0.55, "Wood", col([0.55, 0.36, 0.22], 4110, 0.1), bev=0.02), face(T(0, 0.0, 0))))
        p.append((bbox(0.5, 0.02, 0.09, "Brass", BRASS_T), face(T(0, -0.035, -0.2))))
        V, F = L.ellipsoid(0.48, 0.12, 0.17, 14, 8) if hasattr(L, "ellipsoid") else ellipsoid(0.48, 0.12, 0.17, 14, 8)
        V[:, 2] += 0.05 * np.sin(V[:, 0] * 4); V[:, 0] *= 1 + 0.0
        fish_t = lambda pp, n: np.clip(np.where((pp[:, 2] > 0.02)[:, None], [0.35, 0.45, 0.32], [0.9, 0.82, 0.62]) * (1 + 0.15 * fbm(pp, 4111, 12.0, 2))[:, None]
                                       + np.where((np.abs(pp[:, 2]) < 0.04)[:, None], [0.35, 0.05, 0.08], [0, 0, 0]), 0, 1)
        p.append((obj("trout", V, F, "Bone", fish_t, tile=0.4, sa=60), face(T(-0.05, -0.12, 0.02) @ R(0.12, "Y"))))
        tail = np.array([(0, -0.02, 0), (0.25, -0.02, 0.18), (0.22, -0.02, -0.16), (0, 0.02, 0), (0.25, 0.02, 0.18), (0.22, 0.02, -0.16)])
        p.append((obj("tail", tail, [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]], "Bone", col([0.4, 0.48, 0.35], 4112, 0.1), tile=0.3, sa=20), face(T(0.47, -0.12, 0.06) @ R(0.12, "Y"))))
        for dz in (0.15, -0.14):
            fin = np.array([(0, -0.015, 0), (0.15, -0.015, dz * 0.4), (0.06, -0.015, dz), (0, 0.015, 0), (0.15, 0.015, dz * 0.4), (0.06, 0.015, dz)])
            p.append((obj("fin", fin, [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]], "Bone", col([0.4, 0.48, 0.35], 4113, 0.1), tile=0.3, sa=20), face(T(-0.02, -0.12, dz * 0.6))))
        p.append((blob(0.045, 0.02, 0.045, "Bone", col([1, 1, 0.95], 4114, 0.02), 6, 4), face(T(-0.36, -0.22, 0.06))))  # eye
        p.append((blob(0.022, 0.012, 0.022, "Iron", col([0.15, 0.15, 0.15], 4115, 0.02), 5, 3), face(T(-0.365, -0.235, 0.06))))
        p.append(tube2([(-0.5, -0.2, -0.01), (-0.42, -0.21, -0.04), (-0.34, -0.2, -0.03)], 0.012, 0.012, "Iron", col([0.3, 0.15, 0.12], 4116, 0.05), 4, 1))
        p.append(tube2([(-0.48, -0.2, 0.0), (-0.6, -0.25, 0.12), (-0.62, -0.25, 0.3)], 0.004, 0.004, "Iron", IRON_T, 3, 1))  # the line still in its lip
    return p

def woodpile(x, y, along, n_rows=3, length=1.1, seed=0):
    """Split logs stacked against an outside wall, a little roof of shakes over them."""
    p = []; rr = np.random.default_rng(seed)
    for row in range(n_rows):
        k = n_rows + 1 - row
        for j in range(k):
            o = (j - (k - 1) / 2) * 0.2 + (0.1 if row % 2 else 0)
            q = (x, y + o, 0.11 + row * 0.17) if along == "x" else (x + o, y, 0.11 + row * 0.17)
            a = (q[0] - length / 2, q[1], q[2]) if along == "x" else (q[0], q[1] - length / 2, q[2])
            b = (q[0] + length / 2, q[1], q[2]) if along == "x" else (q[0], q[1] + length / 2, q[2])
            p.append(rodr(a, b, 0.085 + 0.015 * rr.random(), "Wood", col([0.75, 0.55, 0.38], seed + row * 7 + j, 0.15), 6))
            ends = [a, b]
            for e in ends: p.append((obj("end", *disc_lathe(0.09, 0.09, 0, 0.01, 6), "Wood", col([0.95, 0.78, 0.55], seed + j, 0.08), tile=0.2),
                                     T(*e) @ (R(math.pi / 2, "Y") if along == "x" else R(math.pi / 2, "X"))))
    return p

def climber(px, py, z0, z1, seed, leaf, flower, n=10, r=0.24, blooms=True):
    """A rose (or ivy) vine spiralling up a post: a woody stem, clumps of leaves, flowers on the sunny side."""
    p = []; rr = np.random.default_rng(seed)
    pts = [(px + r * math.cos(t), py + r * math.sin(t), z0 + (z1 - z0) * k / (n * 2)) for k, t in enumerate(np.linspace(0, 2.2 * TAU, n * 2 + 1))]
    p.append(tube2(pts[::2], 0.025, 0.012, "Wood", col([0.45, 0.35, 0.22], seed, 0.1), 4, 1))
    for k in range(0, len(pts), 2):
        q = np.array(pts[k]); out = q - np.array([px, py, q[2]]); out[2] = 0; out = out / (np.linalg.norm(out) + 1e-6)
        p.append((blob(0.17, 0.12, 0.1, "Cloth", col(leaf, seed + k, 0.15), 5, 3), T(*(q + out * 0.05)) @ R(rr.random() * TAU, "Z") @ R(0.4, "X")))
        if blooms and k % 4 == 0:
            p.append((blob(0.07, 0.07, 0.06, "Cloth", col(flower, seed + k + 50, 0.1), 5, 3), T(*(q + out * 0.15 + np.array([0, 0, 0.05])))))
    return p

def glowshrooms(points, seed):
    """Grumblekeep's goofy glowing toadstools sprouting from the damp foot of the walls."""
    p = []; rr = np.random.default_rng(seed)
    for k, (x, y, s) in enumerate(points):
        for j in range(3):
            h = (0.18 + 0.15 * rr.random()) * s; cr = (0.08 + 0.06 * rr.random()) * s
            dx, dy = (rr.random() - 0.5) * 0.3 * s, (rr.random() - 0.5) * 0.3 * s
            p.append((cyl(0.025 * s, h, "Bone", BONE_T, seg=4), T(x + dx, y + dy, 0.0) @ R((rr.random() - 0.5) * 0.3, "X")))
            p.append((obj("cap", *lathe([(0.0, -0.01), (cr, 0.0), (cr * 0.9, cr * 0.35), (0.0, cr * 0.75)], 7), "Ooze" if j % 2 == 0 else "Amethyst", None, tile=0.3, sa=50), T(x + dx, y + dy, h)))
    return p

def build_tavern(pre):
    st = dict(STYLES[pre], pre=pre)
    if pre == "N": W, D, cy, blen, tables, hs, hy = 11.0, 8.0, 2.9, 6.5, [(-3, -1.6), (3, -1.6), (-3, 0.6), (3, 0.6)], 1, 0.0
    else: W, D, cy, blen, tables, hs, hy = 8.0, 6.0, 2.1, 5.0, [(-2.2, -0.6), (2.2, -0.6)], -1, 0.8
    hw, hd = W / 2, D / 2; top = st["wall_top"]; ridge = st["ridge"]
    wins = {"D": {-1: [-1.875], 1: [-1.875, 0.625, 1.875]}, "N": {-1: [-2.575, -0.725, 1.125, 2.975], 1: [-2.575, 2.975]}, "G": {}}[pre]
    p = tavern_shell(pre, W, D, st, hs, hy, wins)
    p += bar(pre, cy, blen, st)
    for k, (x, y) in enumerate(tables):
        p += table_set(pre, x, y, st, 3700 + k * 11 + len(pre), bench_side=1 if (pre != "N" or y > 0) else -1)
    ties = tie_ys(D)
    lamps = [(x, ties[-1], top - 0.28) for x in ((-2.2, 2.2) if pre != "N" else (-3.0, 3.0))] + [(0.0, ties[0], top - 0.28)]
    p += hanging_lanterns(lamps, st, drop=0.45)
    p += post_lanterns(hw, hd, top, st)
    arm, hang = sign_arm(hd, st, top + (1.45 if pre == "N" else 1.2), drop=0.22, reach=1.3)
    p += arm
    p += grp({"D": d_sign, "G": g_sign, "N": n_sign}[pre](), T(*hang))
    zg = top + (ridge - top) * 0.62
    if pre == "D":
        p += grp(sun_disc(0.45), T(0, -hd - 0.02, zg + 0.45))
        for x in (-2.6, 2.6):
            p += grp(flag(0.6, 1.3, st["cloth"], st["sigil"], 3801 + int(x)), T(x, -hd - 0.03, top - 0.25))
        p += bunting((-hw + 0.2, -hd - 0.08, top - 0.25), (hw - 0.2, -hd - 0.08, top - 0.25), 0.35, 11, [[0.18, 0.35, 0.8], [0.95, 0.88, 0.65], [0.95, 0.72, 0.28]], 3810)
        for yy in (-hd - 1.0, hd + 0.4):  # crystal finials at the gable apexes, brass ridge
            v, f = L.crystal_point(0.7, 0.13); p.append((obj("fin", v, f, "Crystal", None, tile=0.4, sa=20), T(0, yy, ridge + 0.15)))
        p.append(rodr((0, -hd - 1.05, ridge + 0.18), (0, hd + 0.5, ridge + 0.18), 0.09, "Brass", BRASS_T, 7))
        for sx in (-1, 1):  # flower boxes
            p.append((bbox(0.3, 1.0, 0.24, "Wood", col([0.3, 0.45, 0.8], 3820 + sx, 0.08), bev=0.02), T(sx * (hw + 0.24), -1.875, 1.9)))
            for k in range(3):
                p.append((blob(0.16, 0.14, 0.1, "Cloth", col([0.98, 0.82, 0.3] if k % 2 else [0.95, 0.45, 0.4], 3830 + k, 0.08), 6, 4), T(sx * (hw + 0.24), -2.2 + k * 0.32, 2.05)))
    elif pre == "G":
        p += grp(skull(3850, 0.62, 0.4, 0.56, eye_big=1.3), T(0, -hd - 0.12, zg + 0.3))
        for sx in (-1, 1):
            v, f = L.crystal_point(0.6, 0.1, 5); p.append((obj("horn", v, f, "Bone", BONE_T, tile=0.3), T(sx * 0.42, -hd - 0.1, zg + 0.75) @ R(sx * 0.5, "Y")))
        for x in (-2.6, 2.6):
            p += grp(flag(0.65, 1.4, st["cloth"], st["sigil"], 3851 + int(x), tatter=0.4, metal="Iron", mt=IRON_T), T(x, -hd - 0.03, top - 0.25))
        p += bunting((-hw + 0.2, -hd - 0.08, top - 0.25), (hw - 0.2, -hd - 0.08, top - 0.25), 0.4, 11, [[0.4, 0.16, 0.52], [0.55, 0.9, 0.3]], 3860)
        ridge_pts = [(0, y, ridge + 0.12 - 0.22 * math.sin(math.pi * (y + hd + 1.05) / (D + 1.55))) for y in np.linspace(-hd - 1.05, hd + 0.5, 5)]
        p.append(tube2(ridge_pts, 0.13, 0.13, "Bone", BONE_T, 6, 2, wob=0.1))
        for q in (ridge_pts[0], ridge_pts[-1]): p.append((blob(0.2, 0.2, 0.17, "Bone", BONE_T), T(*q)))
        for k, y in enumerate(np.linspace(-hd - 0.3, hd, 4)):
            v, f = L.crystal_point(0.45, 0.08, 4); p.append((obj("spk", v, f, "Bone", BONE_T, tile=0.3), T(0, y, ridge + 0.2 - 0.22 * math.sin(math.pi * (y + hd + 1.05) / (D + 1.55))) @ R(0.3 * (k % 2 - 0.5), "Y")))
        for sx in (-1, 1):  # goofy ooze-glow windows with bone frames in the side walls
            for y in ((-1.4, 1.9) if sx > 0 else (-1.6,)):
                p.append((bbox(0.08, 0.7, 0.6, "GlassOoze", None, bev=0.0), T(sx * (hw + 0.03), y, 2.2)))
                p.append(tube2([(sx * (hw + 0.09), y - 0.42, 1.85), (sx * (hw + 0.09), y - 0.42, 2.5), (sx * (hw + 0.09), y, 2.75), (sx * (hw + 0.09), y + 0.42, 2.5), (sx * (hw + 0.09), y + 0.42, 1.85)], 0.05, 0.05, "Bone", BONE_T, 5, 1))
    else:
        p += grp(handshake(3900), T(0, -hd - 0.12, zg + 0.1))
        p += grp(flag(0.8, 1.7, [0.16, 0.32, 0.78], [0.95, 0.78, 0.36], 3901), T(-1.2, -hd - 0.03, top - 0.22) @ R(-0.1, "Y"))
        p += grp(flag(0.8, 1.7, [0.36, 0.14, 0.48], [0.62, 0.95, 0.35], 3902, tatter=0.3, metal="Iron", mt=IRON_T), T(1.2, -hd - 0.03, top - 0.22) @ R(0.1, "Y"))
        p += bunting((-hw + 0.2, -hd - 0.08, top - 0.25), (-2.0, -hd - 0.08, top - 0.25), 0.3, 6, [[0.18, 0.35, 0.8], [0.4, 0.16, 0.52], [0.55, 0.9, 0.3], [0.95, 0.8, 0.4]], 3910)
        p += bunting((2.0, -hd - 0.08, top - 0.25), (hw - 0.2, -hd - 0.08, top - 0.25), 0.3, 6, [[0.4, 0.16, 0.52], [0.18, 0.35, 0.8], [0.95, 0.8, 0.4], [0.55, 0.9, 0.3]], 3911)
        p.append((bbox(0.3, D + 1.6, 0.3, "Wood", WOOD_T, bev=0.05), T(0, -0.28, ridge + 0.1)))
        for sx in (-1, 1):  # moss cushions spilling over the eaves, flower boxes
            for k in range(4):
                p.append((blob(0.45, 0.35, 0.12, "Cloth", col([0.38, 0.55, 0.22], 3920 + k, 0.12), 7, 4), T(sx * (hw + 0.35), -hd + 1.2 + k * 2.0, top - 0.25) @ R(sx * 0.65, "Y")))
            p.append((bbox(0.3, 1.0, 0.24, "Wood", col([0.85, 0.65, 0.4], 3930 + sx, 0.08), bev=0.02), T(sx * (hw + 0.24), -2.575, 1.9)))
            for k in range(4):
                p.append((blob(0.15, 0.14, 0.1, "Cloth", col([0.3, 0.45, 0.85] if k % 2 else [0.62, 0.3, 0.75], 3940 + k, 0.08), 6, 4), T(sx * (hw + 0.24), -2.98 + k * 0.27, 2.05)))
        # a chalk board of today's brews inside the left post
        p.append((bbox(0.7, 0.06, 0.9, "Slate", col([0.45, 0.45, 0.45], 3950, 0.05)), T(-hw + 0.75, -hd + 0.55, 1.25) @ R(-0.1, "X")))
        for k in range(4): p.append((bbox(0.4 - 0.08 * k, 0.01, 0.03, "Plaster", FOAM_T), T(-hw + 0.75, -hd + 0.51, 1.5 - k * 0.15) @ R(-0.1, "X")))
        p.append((bbox(0.8, 0.08, 0.06, "Wood", WOOD_T), T(-hw + 0.75, -hd + 0.55, 1.73)))
    # lived-in dressing (2026-10-09): chandelier, plate rail, notice board, a trophy over the hearth, herbs, rug, and
    # outside a log pile by the chimney and climbers on the front posts
    evil = pre == "G"
    p += chandelier(0.0, ties[-1] if pre != "N" else ties[1], top - 0.02, st, r=0.55 if pre != "N" else 0.7, drop=0.8 if pre != "N" else 0.95)
    sh = -hs  # the wall opposite the hearth carries the plate rail and the notice board
    if pre == "N":
        p += plate_shelf(sh, hw, -3.4, -1.3, 1.75, st, 4200, plates="Plaster")
        p += plate_shelf(sh, hw, 1.7, 3.5, 1.75, st, 4201, plates="Plaster")
        p += notice_board(sh, hw, 0.2, 1.45, st, 4210)
    else:
        p += plate_shelf(sh, hw, -0.2, 2.5, 1.75, st, 4200, plates="Bone" if evil else "Plaster", plate_t=BONE_T if evil else None)
        p += notice_board(sh, hw, -1.5, 1.35, st, 4210)
        p += plate_shelf(hs, hw, -2.55, -0.55, 1.85, st, 4202, plates="Bone" if evil else "Plaster", plate_t=BONE_T if evil else None)
    p += trophy(pre, hs, hw, hy, 2.75 if pre != "N" else 2.95, st)
    hz = top - 0.15 - 0.13
    if pre == "N": p += herbs([(-2.4, ties[0], hz), (-1.6, ties[0], hz), (-0.9, ties[0], hz), (1.0, ties[0], hz), (1.7, ties[0], hz), (2.5, ties[0], hz)], 4300)
    else: p += herbs([(-1.7, ties[0], hz), (-1.1, ties[0], hz), (-0.5, ties[0], hz), (0.6, ties[0], hz), (1.2, ties[0], hz), (1.8, ties[0], hz)], 4300)
    rug_cols = {"D": [[0.78, 0.6, 0.3], [0.85, 0.78, 0.6], [0.3, 0.42, 0.72], [0.85, 0.78, 0.6], [0.3, 0.42, 0.72]],
                "G": [[0.5, 0.75, 0.3], [0.36, 0.3, 0.3], [0.45, 0.24, 0.5], [0.36, 0.3, 0.3], [0.45, 0.24, 0.5]],
                "N": [[0.62, 0.45, 0.25], [0.85, 0.78, 0.6], [0.6, 0.32, 0.2], [0.85, 0.78, 0.6], [0.38, 0.5, 0.3]]}[pre]
    p += rug(0.0, -0.9 if pre != "N" else -0.9, 1.15 if pre != "N" else 1.7, 0.85 if pre != "N" else 1.15, rug_cols, 4400)
    p += woodpile(hs * (hw + 0.45), hy - 1.55, "y", n_rows=3, length=0.9, seed=4500)
    if pre == "D":
        for sx in (-1, 1): p += climber(sx * (hw - 0.2), -hd + 0.2, 0.3, top - 0.3, 4600 + sx, [0.3, 0.55, 0.22], [0.95, 0.45, 0.5])
    elif pre == "N":
        for sx in (-1, 1): p += climber(sx * (hw - 0.2), -hd + 0.2, 0.3, top - 0.3, 4610 + sx, [0.28, 0.5, 0.2], [0.98, 0.85, 0.35], blooms=sx > 0)
    else:
        p += glowshrooms([(-hw + 0.1, -hd + 0.75, 1.0), (hw + 0.05, -hd + 0.9, 1.2), (hw + 0.05, hd - 0.6, 0.9), (-hw - 0.1, hd - 0.4, 1.1)], 4700)
    ob = piece(f"{pre}_Tavern", p)
    anchor(f"{pre}_Tavern_Bar", (0, cy - 0.35, 1.1), ob)
    anchor(f"{pre}_Tavern_Hearth", (hs * (hw - 0.2), hy, 0.1), ob)
    s_ = (ridge - top) / hw; anchor(f"{pre}_Tavern_Chimney", (hs * (hw + 0.22), hy, ridge - s_ * (hw + 0.27) + 1.4 + 0.58), ob)  # top of the chimney pot
    return ob

# ----------------------------------------------------------------------------------------------
# quartermasters
# ----------------------------------------------------------------------------------------------
def breastplate(metal, mt):
    V, F = ellipsoid(0.21, 0.13, 0.27, 10, 8)
    V[:, 1] = np.minimum(V[:, 1], 0.0); V[:, 2] = np.minimum(V[:, 2], 0.2)
    V[:, 0] *= 1 + 0.25 * np.clip(V[:, 2] / 0.2, 0, 1)  # broad chest, nipped waist
    V[:, 1] -= 0.03 * np.exp(-(V[:, 0] / 0.04) ** 2)    # keel down the front
    p = [(obj("plate", V, F, metal, mt, tile=0.3, sa=35), T(0, 0, 0.29))]
    for sx in (-1, 1):
        v, f = ellipsoid(0.11, 0.1, 0.07, 8, 4); v[:, 2] = np.maximum(v[:, 2], 0)
        p.append((obj("paul", v, f, metal, mt, tile=0.3, sa=35), T(sx * 0.24, -0.02, 0.46) @ R(sx * 0.5, "Y")))
        p.append((blob(0.018, 0.012, 0.018, "Iron", IRON_T, 5, 3), T(sx * 0.1, -0.12, 0.41)))
    p.append((cyl(0.025, 0.2, "Wood", WOOD_T, seg=5), T(0, 0.02, 0.0)))
    p.append((bbox(0.22, 0.14, 0.03, "Wood", WOOD_T), T(0, 0.02, 0.015)))
    return p

def springy_boots(seed):
    p = []
    for sx in (-1, 1):
        x = sx * 0.11
        pts = [(x + 0.055 * math.cos(t), 0.055 * math.sin(t), 0.012 + 0.11 * t / (6 * math.pi)) for t in np.linspace(0, 6 * math.pi, 15)]
        p.append(tube2(pts, 0.012, 0.012, "Iron", col([0.85, 0.85, 0.9], seed, 0.05), 4, 1))
        p.append((cyl(0.06, 0.01, "Iron", IRON_T, seg=6), T(x, 0, 0.0)))
        p.append((blob(0.075, 0.14, 0.06, "Cloth", LEATHER_T, 8, 5), T(x, -0.05, 0.16)))
        p.append((cyl(0.068, 0.2, "Cloth", LEATHER_T, seg=7, r1=0.075), T(x, 0.02, 0.16)))
        p.append((obj("cuff", *torus(0.078, 0.018, 7, 4), "Brass", BRASS_T, tile=0.3), T(x, 0.02, 0.36)))
    return p

def whetstone():
    p = [(bbox(0.36, 0.15, 0.05, "Wood", WOOD_T), T(0, 0, 0.025))]
    V, F = boxv(0.32, 0.1, 0.08, 0.015, seg=(3, 1, 1)); V[:, 2] -= 0.015 * (V[:, 0] / 0.16) ** 2 * (V[:, 2] > 0)  # worn dip
    p.append((obj("stone", V, F, "Stone", col([0.7, 0.75, 0.82], 11, 0.08), tile=0.3, sa=35), T(0, 0, 0.09)))
    v, f = bipyramid(0.04, 0.04, 0.02, 4); p.append((obj("glint", v, f, "Crystal", None, tile=0.2, sa=20), T(0.06, -0.06, 0.14) @ R(0.6, "Y")))
    return p

def pocket_kettle(metal, mt):
    kv, kf = lathe([(0.0, 0.0), (0.09, 0.0), (0.12, 0.05), (0.11, 0.13), (0.05, 0.17), (0.0, 0.18)], 8)
    p = [(obj("kettle", kv, kf, metal, mt, tile=0.3, sa=50), Matrix())]
    p.append(tube2([(0.08, 0, 0.06), (0.15, 0, 0.1), (0.2, 0, 0.18)], 0.025, 0.014, metal, mt, 5, 1))
    p.append(tube2([(-0.08, 0, 0.14), (-0.08, 0, 0.24), (0.0, 0, 0.28), (0.08, 0, 0.24), (0.08, 0, 0.14)], 0.012, 0.012, "Wood", WOOD_T, 4, 1))
    p.append((blob(0.025, 0.025, 0.02, "Wood", WOOD_T, 5, 3), T(0, 0, 0.19)))
    return p

def leech_jar(seed):
    p = [(obj("jar", *lathe([(0.0, 0.0), (0.1, 0.0), (0.11, 0.02), (0.11, 0.2), (0.08, 0.24), (0.0, 0.24)], 8), "Ooze", None, tile=0.3, sa=50), Matrix())]
    p.append((cyl(0.065, 0.06, "Wood", col([0.8, 0.62, 0.42], seed, 0.06), seg=6), T(0, 0, 0.23)))
    p.append((obj("ring", *torus(0.112, 0.01, 8, 3), "Brass", BRASS_T, tile=0.3), T(0, 0, 0.19)))
    pts = [(-0.07, -0.098, 0.05), (-0.03, -0.112, 0.09), (0.02, -0.112, 0.12), (0.05, -0.105, 0.17)]
    p.append(tube2(pts, 0.026, 0.02, "Cloth", col([0.2, 0.18, 0.12], seed, 0.05), 5, 2))
    for sx in (-1, 1): p.append((blob(0.012, 0.008, 0.012, "Bone", col([1, 1, 1], 1, 0.0), 5, 3), T(0.05 + sx * 0.012, -0.124, 0.185)))
    p.append((bbox(0.08, 0.005, 0.05, "Plaster", col([0.95, 0.9, 0.75], seed, 0.03)), T(0, -0.112, 0.06)))
    return p

def tricorn(tone, seed):
    V, F = lathe([(0.0, 0.0), (0.24, 0.0), (0.24, 0.025), (0.0, 0.025)], 18)
    ang = np.arctan2(V[:, 1], V[:, 0]); rad = np.hypot(V[:, 0], V[:, 1])
    V[:, 2] += 0.1 * (0.5 + 0.5 * np.cos(3 * (ang + math.pi / 2))) ** 1.5 * np.clip((rad - 0.1) / 0.14, 0, 1)
    p = [(obj("brim", V, F, "Cloth", tone, tile=0.3, sa=50), Matrix())]
    p.append((blob(0.13, 0.13, 0.1, "Cloth", tone, 10, 5), T(0, 0, 0.03)))
    p.append((blob(0.03, 0.01, 0.03, "Brass", BRASS_T, 6, 3), T(0, -0.21, 0.1)))
    p.append((blob(0.03, 0.12, 0.02, "Cloth", col([0.98, 0.95, 0.9], seed, 0.03), 6, 3), T(0.1, 0.03, 0.14) @ R(0.6, "X") @ R(0.4, "Z")))
    return p

def coin_purse(seed):
    p = [(blob(0.13, 0.11, 0.12, "Cloth", LEATHER_T, 9, 6), T(0, 0, 0.11))]
    p.append((cyl(0.05, 0.06, "Cloth", LEATHER_T, seg=6, r1=0.07), T(0, 0, 0.2)))
    p.append((obj("tie", *torus(0.055, 0.01, 7, 3), "Cloth", col([0.85, 0.75, 0.4], seed, 0.05), tile=0.3), T(0, 0, 0.215)))
    for k, (x, z) in enumerate(((0.14, 0.005), (0.19, 0.005), (0.16, 0.017))):
        p.append((coin(0.03, 0.008), T(x, -0.05 + 0.02 * k, z) @ R(0.2 * k, "X")))
    return p

def potion(glow, h=0.22, r=0.07, seed=0):
    bv, bf = lathe([(0.0, 0.0), (r * 0.6, 0.0), (r, h * 0.25), (r * 0.9, h * 0.55), (r * 0.32, h * 0.72), (r * 0.3, h), (0.0, h)], 7)
    return [(obj("potion", bv, bf, glow, None, tile=0.3, sa=50), Matrix()), (cyl(r * 0.34, 0.05, "Wood", col([0.8, 0.62, 0.42], seed, 0.06), seg=5), T(0, 0, h - 0.01))]

def price_tag(x, y, z, seed):
    return (bbox(0.09, 0.008, 0.06, "Plaster", col([0.98, 0.93, 0.78], seed, 0.03)), T(x, y, z) @ R(-0.25, "X"))

def awning(x0, x1, yb, zb, yf, zf, n, cols, seed, tatter=0.0, drop=0.32):
    """Striped canopy from the back edge (yb, zb) down to the front edge (yf, zf), with a scalloped valance."""
    p = []; rr = np.random.default_rng(seed); w = (x1 - x0) / n
    for i in range(n):
        xa, xb = x0 + i * w, x0 + (i + 1) * w; c = col(cols[i % len(cols)], seed + i, 0.06)
        def f(u, v, xa=xa, xb=xb):
            x = xa + (xb - xa) * u; t = v
            sag = 0.12 * math.sin(math.pi * (x - x0) / (x1 - x0)) * math.sin(math.pi * t) + 0.04 * math.sin(math.pi * u) * math.sin(math.pi * t)
            return (x, yb + (yf - yb) * t, zb + (zf - zb) * t - sag)
        p.append(sheet(2, 4, f, "Cloth", c))
        dz = drop * (1 + tatter * (rr.random() - 0.5) * 1.5)
        def g(u, v, xa=xa, xb=xb, dz=dz):
            x = xa + (xb - xa) * u; scal = 1 - 0.35 * (1 - math.sin(math.pi * u)) if not tatter else 1 - tatter * abs(math.sin(u * 7 + i))
            return (x, yf - 0.01, zf - dz * v * scal)
        p.append(sheet(2, 1, g, "Cloth", c))
    return p

QM = {"D": dict(base="Stone", base_t=STONE_T(5001), wood_t=WOOD_T, pole="Brass", pole_t=BRASS_T, metal="Brass", metal_t=BRASS_T,
                stripes=[[0.18, 0.36, 0.82], [0.97, 0.93, 0.82]], hat=col([0.16, 0.2, 0.42], 5002, 0.05)),
      "G": dict(base="Basalt", base_t=basalt_tone(5101), wood_t=DARKWOOD_T, pole="Bone", pole_t=BONE_T, metal="Iron", metal_t=IRON_T,
                stripes=[[0.42, 0.8, 0.26], [0.42, 0.18, 0.56]], hat=col([0.3, 0.12, 0.36], 5102, 0.05))}

def build_quartermaster(pre):
    st = QM[pre]; evil = pre == "G"; p = []; wt = st["wood_t"]; m, mt = st["metal"], st["metal_t"]
    # dais and counter (front face y = -1.75, top 1.1)
    with side_stone(st["base"]): p.append((L.block(5200 + len(pre), 5.0, 3.5, 0.2, 0.04, seg=(4, 3, 1), tone=st["base_t"]), T(0, 0, 0.05)))
    p.append(slab(-2.3, 2.3, -1.69, -1.15, 0.15, 1.04, "Wood", col([0.62, 0.48, 0.38], 5201, 0.1) if not evil else col([0.38, 0.3, 0.3], 5201, 0.1), chip=0.0, step=1.2))
    for k in range(6): p.append((bbox(0.12, 0.07, 0.8, "Wood", wt), T(-2.3 + k * 0.92, -1.71, 0.6)))
    for z in (0.22, 0.98): p.append((bbox(4.65, 0.08, 0.12, "Wood", wt), T(0, -1.71, z)))
    p.append((bbox(4.8, 0.62, 0.07, "Wood", col([0.85, 0.62, 0.42], 5202, 0.08) if not evil else DARKWOOD_T, bev=0.025), T(0, -1.44, 1.065)))
    if evil:
        p.append(tube2([(-2.4, -1.74, 1.04), (2.4, -1.74, 1.04)], 0.045, 0.045, "Bone", BONE_T, 6, 1))
        p += grp(skull(5210, 0.22, 0.15, 0.2, eye_big=1.3, seg=10, rings=7), T(0, -1.78, 0.6))
    else:
        p += grp(sun_disc(0.2, rays=10), T(0, -1.79, 0.6))
    # side half walls and back wall with three shelves
    for sx in (-1, 1): p.append(slab(sx * 2.42 - 0.06, sx * 2.42 + 0.06, -1.15, 1.55, 0.15, 1.04, "Wood", PLANK_T if evil else col([0.75, 0.55, 0.4], 5203, 0.1), chip=0.0, step=1.0))
    p.append(slab(-2.45, 2.45, 1.55, 1.7, 0.15, 3.05, "Wood", PLANK_T if evil else col([0.72, 0.52, 0.38], 5204, 0.1), chip=0.0, step=0.8))
    for k, x in enumerate(np.linspace(-2.25, 2.25, 4)): p.append((bbox(0.14, 0.1, 2.9, "Wood", wt), T(x, 1.5, 1.6)))
    for k, x in enumerate((-2.25, -0.75, 0.75, 2.25)): p.append((bbox(0.14, 0.08, 2.9, "Wood", wt), T(x, 1.74, 1.6)))
    for z in (0.5, 2.9): p.append((bbox(4.9, 0.08, 0.14, "Wood", wt), T(0, 1.74, z)))
    p += grp(flag(0.8, 1.5, [0.16, 0.32, 0.78] if not evil else [0.36, 0.14, 0.48], [0.95, 0.78, 0.36] if not evil else [0.62, 0.95, 0.35], 5205, tatter=0.3 if evil else 0.0, metal=m, mt=mt), T(1.5, 1.82, 2.66) @ R(math.pi, "Z"))
    shelves = (1.25, 1.9, 2.55)
    p.append(slab(-2.36, 2.36, 1.53, 1.55, 1.0, 2.95, "Plaster", col([0.98, 0.9, 0.72] if not evil else [0.62, 0.78, 0.5], 5206, 0.08), chip=0.0, step=1.2, tile=1.2))
    for z in shelves:
        p.append((bbox(4.6, 0.46, 0.06, "Wood", wt), T(0, 1.3, z - 0.03)))
        for x in (-1.6, 0.0, 1.6): p.append(beam((x, 1.52, z - 0.32), (x, 1.12, z - 0.06), 0.05, "Wood", wt))
    # posts: front poles on the counter ends, taller back poles, and the sign mast
    for sx in (-1, 1):
        for (y, h) in ((-1.62, 2.8), (1.62, 3.3)):
            if evil:
                p.append(tube2([(sx * 2.42, y, 0.15), (sx * 2.38, y, h * 0.5), (sx * 2.44, y, h)], 0.08, 0.06, "Bone", BONE_T, 6, 2, wob=0.08))
                p.append((blob(0.12, 0.12, 0.1, "Bone", BONE_T, 7, 4), T(sx * 2.44, y, h + 0.05)))
            else:
                p.append((cyl(0.06, h - 0.15, "Brass", BRASS_T, seg=7), T(sx * 2.42, y, 0.15)))
                p.append((blob(0.1, 0.1, 0.1, "Brass", BRASS_T, 7, 4), T(sx * 2.42, y, h + 0.04)))
    # striped awning (back 3.3 -> front 2.6), valance hanging past the counter
    p += awning(-2.62, 2.62, 1.7, 3.32, -2.05, 2.62, 10, st["stripes"], 5220 + len(pre), tatter=0.6 if evil else 0.0)
    p.append(rodr((-2.65, -2.05, 2.6), (2.65, -2.05, 2.6), 0.035, st["pole"], st["pole_t"], 6))
    # sign mast: up from the back wall, arm forward, a big gold coin hanging over the awning
    mast_x = 0.0
    p.append((cyl(0.08, 4.45 - 1.6, "Wood", wt, seg=6), T(mast_x, 1.75, 1.6)))
    p.append(rodr((mast_x, 1.75, 4.3), (mast_x, -0.6, 4.3), 0.05, m, mt, 6))
    p.append(rodr((mast_x, 1.75, 3.7), (mast_x, 0.6, 4.28), 0.03, m, mt, 5))
    for sx in (-1, 1): p.append(rodr((sx * 0.35, -0.3, 4.3), (sx * 0.35, -0.3, 4.12), 0.012, "Iron", IRON_T, 3))
    cz = 3.56; cv, cf = lathe([(0.0, -0.07), (0.56, -0.07), (0.6, -0.03), (0.6, 0.03), (0.56, 0.07), (0.48, 0.07), (0.46, 0.05), (0.0, 0.05)], 20)
    p.append((obj("coin", cv, cf, "Brass", col([1.0, 0.88, 0.5], 5230, 0.08), tile=0.4, sa=40), T(0, -0.3, cz) @ R(math.pi / 2, "X")))
    p.append((blob(0.06, 0.06, 0.06, "Brass", BRASS_T, 6, 4), T(0, -0.3, cz + 0.6)))
    if evil:
        p += grp(skull(5231, 0.3, 0.1, 0.3, eye_big=1.35, eyes="Ooze", seg=10, rings=7), T(0, -0.38, cz + 0.04))
        p.append((obj("ring2", *torus(0.5, 0.035, 16, 4), "Iron", IRON_T, tile=0.3), T(0, -0.36, cz) @ R(math.pi / 2, "X")))
        for sx in (-1, 1): p.append((blob(0.05, 0.05, 0.05, "Amethyst", None, 6, 3), T(sx * 0.42, -0.37, cz + 0.3)))
    else:
        crown = col([1.0, 0.8, 0.35], 5233, 0.06)  # a raised crown with crystal studs, in a ring
        for k in range(5):
            v, f = L.crystal_point(0.3 if k == 2 else (0.22 if k % 2 == 0 else 0.15), 0.07, 4)
            p.append((obj("pt", v * np.array([1, 0.6, 1]), f, "Brass", crown, tile=0.2, sa=30), T((k - 2) * 0.13, -0.38, cz - 0.08)))
        p.append((bbox(0.62, 0.08, 0.16, "Brass", crown), T(0, -0.38, cz - 0.16)))
        for k in range(3):
            v, f = bipyramid(0.06, 0.06, 0.045, 4); p.append((obj("gem", v, f, "Crystal", None, tile=0.2, sa=20), T((k - 1) * 0.2, -0.43, cz - 0.16) @ R(math.pi / 2, "X")))
        p.append((obj("ring2", *torus(0.5, 0.03, 16, 4), "Brass", BRASS_T, tile=0.3), T(0, -0.36, cz) @ R(math.pi / 2, "X")))
    # coins on the counter, a balance scale, a ledger
    for k, (x, y) in enumerate(((-1.55, -1.4), (1.5, -1.38))): p += grp(coin_pile(0.22, 0.12, 5240 + k, 8), T(x, y, 1.1))
    for k, (x, y, n) in enumerate(((-1.05, -1.5, 6), (-0.95, -1.32, 9), (1.0, -1.5, 5), (1.12, -1.3, 8))): p += grp(coin_stack(n, 0.045, 5250 + k), T(x, y, 1.1))
    if not evil:
        p.append((cyl(0.08, 0.03, "Brass", BRASS_T, seg=6), T(-2.0, -1.35, 1.1)))
        p.append(rodr((-2.0, -1.35, 1.12), (-2.0, -1.35, 1.48), 0.015, "Brass", BRASS_T, 4))
        p.append(rodr((-2.18, -1.35, 1.46), (-1.82, -1.35, 1.46), 0.012, "Brass", BRASS_T, 4))
        for sx in (-1, 1): p.append((obj("pan", *lathe([(0.0, 0.0), (0.08, 0.03), (0.0, 0.025)], 7), "Brass", BRASS_T, tile=0.2), T(-2.0 + sx * 0.18, -1.35, 1.3 + 0.02 * sx)))
    else:
        p.append((cyl(0.06, 0.12, "Plaster", col([0.75, 0.95, 0.6], 5260, 0.05), seg=5), T(-2.0, -1.35, 1.1)))
        p += grp(skull(5261, 0.09, 0.07, 0.08, seg=8, rings=6), T(-2.0, -1.35, 1.04))
        v, f = L.crystal_point(0.08, 0.02, 4); p.append((obj("flame", v, f, "Ooze", None, tile=0.2, sa=20), T(-2.0, -1.35, 1.23)))
    p.append((bbox(0.36, 0.26, 0.06, "Cloth", col([0.55, 0.2, 0.15] if not evil else [0.3, 0.45, 0.2], 5262, 0.05)), T(2.0, -1.38, 1.13) @ R(0.15, "Z")))
    p.append((bbox(0.34, 0.24, 0.02, "Plaster", col([0.95, 0.9, 0.78], 5263, 0.03)), T(2.0, -1.38, 1.17) @ R(0.15, "Z")))
    # wares on the shelves (y ~ 1.3, faces -Y), slightly oversized so they read across the courtyard
    z1, z2, z3 = shelves
    S = Matrix.Scale(1.3, 4)
    p += grp(breastplate(st["metal"] if not evil else "Brass", BRASS_T), T(-1.75, 1.3, z1) @ Matrix.Scale(1.05, 4))
    p += grp(springy_boots(5270), T(-0.75, 1.25, z1) @ S)
    p += grp(whetstone(), T(0.15, 1.25, z1) @ S)
    p += grp(pocket_kettle("Brass" if not evil else "Iron", BRASS_T if not evil else IRON_T), T(0.95, 1.3, z1) @ S)
    p += grp(coin_purse(5271), T(1.8, 1.28, z1) @ S)
    p += grp(leech_jar(5272), T(-1.75, 1.25, z2) @ S)
    p += grp(tricorn(st["hat"], 5273), T(-0.75, 1.3, z2 + 0.01) @ R(0.15, "Z") @ S)
    for k, g in enumerate(("Crystal", "Ember", "Ooze", "Amethyst")):
        p += grp(potion(g, 0.2 + 0.04 * (k % 2), 0.065 + 0.01 * (k % 2), 5274 + k), T(0.25 + k * 0.42, 1.3 - 0.04 * (k % 2), z2) @ S)
    for k, x in enumerate((-1.75, -0.75, 0.15, 0.95, 1.8)): p.append(price_tag(x + 0.12, 1.07, z1 + 0.02, 5280 + k))
    for k, x in enumerate((-1.75, -0.75, 0.5, 1.35)): p.append(price_tag(x + 0.12, 1.07, z2 + 0.02, 5290 + k))
    # top shelf: spare hats, kegs of gubbins, a lantern
    p += grp(keg(0.14, 0.3, "Wood", wt, m, mt, 7), T(-1.9, 1.3, z3))
    p += grp(keg(0.14, 0.3, "Wood", wt, m, mt, 7), T(-1.55, 1.32, z3))
    p += grp(tricorn(st["hat"], 5295), T(0.6, 1.3, z3 + 0.01) @ R(-0.2, "Z"))
    p += grp(potion("Crystal" if not evil else "Ooze", 0.3, 0.1, 5296), T(1.6, 1.3, z3))
    for sx in (-1, 1): p += grp(lantern(m, mt, "Glass" if not evil else "GlassOoze", 1.0), T(sx * 2.15, -1.95, 2.55))
    # crates by the side walls (inside the footprint)
    p.append((bbox(0.6, 0.6, 0.55, "Wood", wt, bev=0.03), T(-2.0, 0.35, 0.425)))
    p.append((bbox(0.5, 0.5, 0.45, "Wood", wt, bev=0.03), T(-1.95, 0.3, 0.925) @ R(0.3, "Z")))
    p += grp(keg(0.28, 0.65, "Wood", wt, m, mt), T(2.0, 0.3, 0.15))
    for k in range(4): p.append(beam((2.0 + 0.1 * math.cos(k * 1.6), 0.3 + 0.1 * math.sin(k * 1.6), 0.7), (2.0 + 0.2 * math.cos(k * 1.6), 0.3 + 0.2 * math.sin(k * 1.6), 1.45), 0.035, "Wood", wt))
    ob = piece(f"{pre}_Quartermaster", p)
    anchor(f"{pre}_Quartermaster_Counter", (0, -1.6, 1.1), ob)
    return ob

# ----------------------------------------------------------------------------------------------
# gold mills
# ----------------------------------------------------------------------------------------------
MILL = {"D": dict(lo="Stone", lo_t=STONE_T(6001), hi="Plaster", hi_t=col([1.0, 0.96, 0.88], 6002, 0.06), wood_t=WOOD_T, metal="Brass", metal_t=BRASS_T,
                  cap="Slate", cap_t=col([0.9, 1.0, 1.0], 6003, 0.06), glow="Crystal", trim=col([0.3, 0.45, 0.82], 6004, 0.06)),
        "G": dict(lo="Basalt", lo_t=basalt_tone(6101), hi="Wood", hi_t=PLANK_T, wood_t=DARKWOOD_T, metal="Iron", metal_t=IRON_T,
                  cap="Slate", cap_t=col([0.62, 0.5, 0.75], 6103, 0.08), glow="Ooze", trim=col([0.4, 0.75, 0.25], 6104, 0.06))}
TOWER_H = 6.9

def tower_r(z): return 2.6 - 0.6 * min(max(z / TOWER_H, 0), 1)

def tower_shell(seed, lo, lo_t, hi, hi_t, seg, door_a, door_w, door_h, evil):
    """Tapered tower as two lathes (masonry below 2.4 m, the upper wall above), with a doorway gap cut at angle
    door_a, an inner room seen through it, and stone reveals."""
    p = []; zs_lo = list(np.linspace(0, 2.4, 7)); zs_hi = list(np.linspace(2.4, TOWER_H, 9))
    a0 = door_a - door_w / 2; a1 = door_a + door_w / 2
    for zs, mat, tone, cut in ((zs_lo, lo, lo_t, True), (zs_hi, hi, hi_t, False)):
        V, F = [], []
        angs = [k / seg * TAU for k in range(seg)]
        if cut: angs = sorted(set(angs + [a0 % TAU, a1 % TAU]))
        na = len(angs)
        for a in angs:
            for z in zs:
                r = tower_r(z) * (1 + (0.025 * math.sin(a * 3 + z * 1.7) if evil else 0.0))
                V.append((r * math.cos(a), r * math.sin(a), z))
        nz = len(zs)
        for i in range(na):
            i2 = (i + 1) % na; am = (angs[i] + ((angs[i2] - angs[i]) % TAU) / 2) % TAU
            dd = abs((am - door_a + math.pi) % TAU - math.pi)
            for j in range(nz - 1):
                if cut and dd < door_w / 2 and zs[j + 1] <= door_h + 1e-6: continue
                F.append([i * nz + j, i2 * nz + j, i2 * nz + j + 1, i * nz + j + 1])
        tn = course_tone(seed, tone, 0.4) if mat == "Stone" else tone
        p.append((obj("tower", np.array(V), F, mat, tn, tile=1.4, sa=40), Matrix()))
    # inner room: inverted lathe, floor and ceiling
    ri = 2.1; V, F = lathe([(ri, door_h + 0.15), (ri, 0.0)], 12)
    p.append((obj("inner", V, F, lo, col([0.45, 0.4, 0.36], seed, 0.1), tile=1.2, sa=40), Matrix()))
    p.append((obj("floor", *disc_lathe(ri, ri, 0.0, 0.04, 12), "Wood", col([0.5, 0.4, 0.32], seed, 0.1), tile=0.8), Matrix()))
    p.append((obj("ceil", *disc_lathe(ri, ri, door_h + 0.1, door_h + 0.15, 12), "Wood", col([0.35, 0.28, 0.24], seed, 0.1), tile=0.8), Matrix()))
    # reveals at the jambs and a lintel arch
    for a in (a0, a1):
        c, s_ = math.cos(a), math.sin(a)
        p.append((bbox(0.62, 0.22, door_h + 0.1, lo, lo_t, bev=0.03), T(2.3 * c, 2.3 * s_, door_h / 2) @ R(a, "Z")))
    c, s_ = math.cos(door_a), math.sin(door_a); r0 = tower_r(door_h) + 0.05
    nrm = Vector((c, s_, 0)); tg = Vector((-s_, c, 0)); up = Vector((0, 0, 1)); Rr = 0.86; zc = door_h - 0.12
    with side_stone(lo):
        for k, th in enumerate(np.linspace(0.12, math.pi - 0.12, 7)):  # voussoirs over the doorway, a keystone on top
            pos = nrm * (r0 + 0.02) + tg * (Rr * math.cos(th)) + up * (zc + Rr * math.sin(th) * 0.75)
            xa = (tg * -math.sin(th) + up * math.cos(th) * 0.75).normalized(); za = xa.cross(nrm)
            M = Matrix((xa, nrm, za)).transposed().to_4x4(); M.translation = pos
            p.append((L.block(seed + 40 + k, 0.36, 0.3, 0.3 if k != 3 else 0.42, 0.04, seg=(1, 1, 1), tone=lo_t), M @ T(0, 0, -0.12)))
    return p

def millstones(seed, metal, mt, glow):
    p = [(obj("bed", *disc_lathe(0.85, 0.82, 0, 0.28, 12), "Stone", col([0.75, 0.72, 0.68], seed, 0.1), tile=0.6, sa=40), Matrix())]
    p.append((obj("runner", *disc_lathe(0.78, 0.74, 0, 0.26, 12), "Stone", col([0.85, 0.8, 0.72], seed + 1, 0.1), tile=0.6, sa=40), T(0, 0, 0.31)))
    p.append((obj("glow", *torus(0.77, 0.04, 12, 3), "Ember", None, tile=0.3), T(0, 0, 0.295)))
    p.append((cyl(0.08, 2.1, "Wood", WOOD_T, seg=6), T(0, 0, 0.5)))
    p.append((obj("gear", *disc_lathe(0.55, 0.55, 0, 0.1, 12), metal, mt, tile=0.3), T(0, 0, 2.0)))
    for k in range(8):
        a = k / 8 * TAU; p.append((bbox(0.1, 0.08, 0.1, metal, mt), T(0.58 * math.cos(a), 0.58 * math.sin(a), 2.12) @ R(a, "Z")))
    p += grp(coin_pile(0.45, 0.2, seed + 3, 6), T(0.9, -0.85, 0.04))
    p.append(slab(-1.05, -0.65, -0.3, 0.3, 0.04, 0.5, "Wood", WOOD_T, chip=0.02, step=1.0))
    return p

def build_mill(pre):
    st = MILL[pre]; evil = pre == "G"; p = []; m, mt = st["metal"], st["metal_t"]; wt = st["wood_t"]
    door_a = -0.35  # opening on the +X side, a touch to the front
    p += tower_shell(6200 + len(pre), st["lo"], st["lo_t"], st["hi"], st["hi_t"], 16, door_a, 0.62, 2.0, evil)
    p += grp(millstones(6210 + len(pre), m, mt, st["glow"]), Matrix())
    # plinth flare, banding, curb, windows
    with side_stone(st["lo"]):
        p.append((obj("plinth", *lathe([(2.7, 0.0), (2.7, 0.3), (2.6, 0.38)], 16), st["lo"], st["lo_t"], tile=1.2, sa=40), Matrix()))
    for z in (2.4, 4.7):
        r = tower_r(z) + 0.02
        p.append((obj("band", *lathe([(r, -0.07), (r + 0.06, -0.05), (r + 0.06, 0.05), (r, 0.07)], 16), m if not evil else "Wood", mt if not evil else wt, tile=0.5), T(0, 0, z)))
    r = tower_r(TOWER_H)
    p.append((obj("curb", *lathe([(r - 0.05, TOWER_H - 0.05), (r + 0.22, TOWER_H), (r + 0.25, TOWER_H + 0.18), (0.0, TOWER_H + 0.18)], 16), "Wood", wt, tile=0.7, sa=40), Matrix()))
    for (a, z) in ((math.pi / 2 + 0.6, 3.6), (math.pi / 2 - 0.7, 5.4), (math.pi + 0.3, 4.2), (-0.35, 5.0), (math.pi * 1.5 - 0.9, 3.9)):
        r = tower_r(z); c, s_ = math.cos(a), math.sin(a)
        M = T(r * c, r * s_, z) @ R(a, "Z")
        p.append((bbox(0.1, 0.5, 0.7, st["glow"], None, bev=0.0), M))
        p.append((bbox(0.14, 0.64, 0.1, "Wood", wt), M @ T(0.02, 0, -0.38)))
        if evil: p.append(tube2([tuple(M @ Vector(q)) for q in ((0.05, -0.3, -0.35), (0.05, -0.32, 0.25), (0.05, 0, 0.45), (0.05, 0.32, 0.25), (0.05, 0.3, -0.35))], 0.04, 0.04, "Bone", BONE_T, 4, 1))
        else:
            p.append((bbox(0.12, 0.62, 0.08, "Wood", wt), M @ T(0.02, 0, 0.38)))
            for sy in (-1, 1): p.append((bbox(0.06, 0.26, 0.74, "Wood", st["trim"]), M @ T(0.03, sy * 0.42, 0) @ R(sy * 0.5, "Z")))
    # cap (dome, a hood over the windshaft), finial
    cb = TOWER_H + 0.15
    if evil:  # tall, crooked witch-hat cap with a bone horn tip
        prof = [(0.0, 0.0), (2.42, 0.0), (2.42, 0.25), (2.1, 0.55)] + [(2.0 * (1 - t) ** 1.25 + 0.06, 0.55 + 2.9 * t) for t in np.linspace(0.15, 1, 7)]
        V, F = lathe(prof, 14); t_ = np.clip((V[:, 2] - 0.6) / 2.9, 0, 1); V[:, 0] += 0.8 * t_ ** 2.2; V[:, 2] -= 0.35 * t_ ** 2.5
        p.append((obj("cap", V, F, st["cap"], st["cap_t"], tile=1.2, sa=40), T(0, 0.15, cb)))
        p.append(tube2([(0.85, 0.15, cb + 3.05), (1.05, 0.15, cb + 3.3), (1.3, 0.15, cb + 3.33)], 0.1, 0.03, "Bone", BONE_T, 5, 2))
        for k in range(8):
            a = k / 8 * TAU; p.append((blob(0.09, 0.09, 0.07, "Bone", BONE_T, 6, 3), T(2.4 * math.cos(a), 0.15 + 2.4 * math.sin(a), cb + 0.12)))
        p += grp(skull(6250, 0.55, 0.36, 0.5, eye_big=1.35, seg=12, rings=8), T(0, -2.0, cb + 1.25) @ R(0.15, "X"))
    else:  # ogee dome in blue slate with a brass collar and crystal finial
        prof = [(0.0, 0.0), (2.42, 0.0), (2.45, 0.2), (2.36, 0.45), (2.05, 0.85), (1.5, 1.25), (0.85, 1.6), (0.42, 1.85), (0.22, 2.05), (0.0, 2.1)]
        V, F = lathe(prof, 16); p.append((obj("cap", V, F, st["cap"], st["cap_t"], tile=1.2, sa=40), T(0, 0.12, cb)))
        p.append((obj("collar", *torus(2.44, 0.06, 16, 4), "Brass", BRASS_T, tile=0.4), T(0, 0.12, cb + 0.22)))
        p.append((cyl(0.08, 0.5, "Brass", BRASS_T, seg=6), T(0, 0.12, cb + 2.0)))
        p.append((blob(0.13, 0.13, 0.1, "Brass", BRASS_T), T(0, 0.12, cb + 2.5)))
        v, f = bipyramid(0.42, 0.22, 0.15, 6); p.append((obj("fin", v, f, "Crystal", None, tile=0.3, sa=20), T(0, 0.12, cb + 2.85)))
        p += grp(sun_disc(0.4, rays=10, gem=None), T(0, -2.1, cb + 1.25) @ R(-0.45, "X"))
    # windshaft hood and bearing at the hub
    hy, hz = -2.3, 7.2
    p.append((bbox(0.9, 0.9, 0.85, "Wood", wt, bev=0.04), T(0, -1.95, hz)))
    p.append((obj("bearing", *disc_lathe(0.28, 0.28, 0, 0.12, 10), m, mt, tile=0.3), T(0, hy + 0.1, hz) @ R(math.pi / 2, "X")))
    # hopper on its stand (rim centre at (0, -3.3, 1.4)); feed trough into the tower
    hx, hyy = 0.0, -3.3
    with side_stone(st["lo"]): p.append((L.block(6260 + len(pre), 1.5, 1.3, 0.22, 0.04, seg=(1, 1, 1), tone=st["lo_t"]), T(hx, hyy + 0.05, 0.055)))
    for sx in (-1, 1):
        for sy in (-1, 1): p.append(beam((hx + sx * 0.45, hyy + sy * 0.45, 0.12), (hx + sx * 0.36, hyy + sy * 0.36, 1.1), 0.09, "Wood", wt))
    hv, hf = lathe([(0.15, 0.0), (0.62, 0.55), (0.7, 0.58), (0.7, 0.66), (0.55, 0.62), (0.08, 0.06)], 4)
    hv[:, :2] *= 1.0
    p.append((obj("hopper", hv, hf, "Wood" if not evil else "Iron", col([0.8, 0.6, 0.42], 6270, 0.1) if not evil else IRON_T, tile=0.5, sa=30), T(hx, hyy, 0.8) @ R(math.pi / 4, "Z")))
    if not evil:
        for z in (1.0, 1.25): p.append((obj("hb", *lathe([(0.42 * (z - 0.8) / 0.55 * 1.18 + 0.12, -0.03), (0.42 * (z - 0.8) / 0.55 * 1.18 + 0.15, 0.0), (0.42 * (z - 0.8) / 0.55 * 1.18 + 0.12, 0.03)], 4), "Brass", BRASS_T, tile=0.3), T(hx, hyy, z) @ R(math.pi / 4, "Z")))
    else:
        for k in range(8):
            a = k / 8 * TAU + math.pi / 8; v, f = L.crystal_point(0.22, 0.05, 4)
            p.append((obj("tooth", v, f, "Bone", BONE_T, tile=0.3), T(hx + 0.62 * math.cos(a), hyy + 0.62 * math.sin(a), 1.42) @ R(0.35, "Y" if False else "X")))
    rr = np.random.default_rng(6271 + len(pre))
    for k in range(5):  # ore lumps heaped in the hopper
        a = rr.random() * TAU; d = rr.random() * 0.3; v, f = ellipsoid(0.09 + 0.05 * rr.random(), 0.08, 0.07, 6, 4)
        p.append((obj("ore", v, f, "Basalt", col([0.75, 0.68, 0.6], 6272 + k, 0.1), tile=0.3, sa=30), T(hx + math.cos(a) * d, hyy + math.sin(a) * d, 1.28 + 0.04 * rr.random()) @ R(rr.random() * 3, "Z")))
        if k % 3 == 0:
            vv, ff = bipyramid(0.05, 0.03, 0.03, 4); p.append((obj("fleck", vv, ff, "Brass", BRASS_T, tile=0.2, sa=20), T(hx + math.cos(a) * d, hyy + math.sin(a) * d - 0.05, 1.33)))
    p.append(beam((hx, hyy + 0.1, 0.85), (hx, -2.35, 0.62), 0.22, "Wood", wt, h=0.12))
    # coin chute from the tower wall into a brass tray (tray top centre at (1.3, -3.0, 0.5))
    tx, ty, tz = 1.3, -3.0, 0.5
    p.append((bbox(0.1, 0.1, 0.42, "Wood", wt), T(tx - 0.25, ty, 0.2)))
    p.append((bbox(0.1, 0.1, 0.42, "Wood", wt), T(tx + 0.25, ty, 0.2)))
    p.append((bbox(0.72, 0.5, 0.06, "Brass", BRASS_T), T(tx, ty, tz - 0.03)))
    for sy in (-1, 1): p.append((bbox(0.72, 0.04, 0.12, "Brass", BRASS_T), T(tx, ty + sy * 0.25, tz + 0.03)))
    for sx in (-1, 1): p.append((bbox(0.04, 0.5, 0.12, "Brass", BRASS_T), T(tx + sx * 0.36, ty, tz + 0.03)))
    p += grp(coin_pile(0.22, 0.09, 6280 + len(pre), 8), T(tx, ty, tz))
    a_w = math.atan2(-2.0, 1.2); wx, wy = tower_r(1.3) * math.cos(a_w), tower_r(1.3) * math.sin(a_w)
    a_, b_ = Vector((wx + 0.05, wy - 0.05, 1.32)), Vector((tx, ty + 0.12, tz + 0.38)); dz = (b_ - a_).normalized()
    sd = dz.cross(Vector((0, 0, 1))).normalized(); upv = sd.cross(dz); ln = (b_ - a_).length
    Mc = Matrix((sd, upv, dz)).transposed().to_4x4(); Mc.translation = a_
    p.append((bbox(0.28, 0.03, ln, "Brass", BRASS_T), Mc @ T(0, -0.05, ln / 2)))  # a U-channel chute
    for sx in (-1, 1): p.append((bbox(0.03, 0.12, ln, "Brass", BRASS_T), Mc @ T(sx * 0.14, 0.0, ln / 2)))
    for k in range(4):  # coins mid-tumble out of the spout
        p.append((coin(), T(tx - 0.02 * k, ty + 0.1 - 0.03 * k, tz + 0.32 - 0.07 * k) @ R(0.7 * k, "X") @ R(0.4 * k, "Y")))
    for k, (dx, dy) in enumerate(((0.45, -0.3), (-0.42, -0.38), (0.2, -0.5))):
        p.append((coin(), T(tx + dx, ty + dy, 0.005) @ R(0.05 * k, "X")))
    if evil:
        p += grp(skull(6290, 0.36, 0.26, 0.32, eye_big=1.35, seg=12, rings=8), T(wx + 0.1, wy - 0.22, 1.5) @ R(a_w + math.pi / 2, "Z"))
    else:
        p += grp(sun_disc(0.36, rays=10), T(wx + 0.02, wy - 0.06, 1.55) @ R(a_w + math.pi / 2, "Z"))
    # capstan bed and drive shaft to the tower (the turning capstan itself is *_MillCrank)
    cx, cy_ = -2.0, -3.0
    with side_stone(st["lo"]): p.append((obj("pad", *disc_lathe(0.5, 0.45, 0, 0.14, 10), st["lo"], st["lo_t"], tile=0.6, sa=40), T(cx, cy_, 0)))
    p.append((obj("collar", *disc_lathe(0.16, 0.16, 0, 0.12, 8), "Iron", IRON_T, tile=0.3), T(cx, cy_, 0.14)))
    a_c = math.atan2(cy_, cx); ex, ey = tower_r(0.3) * math.cos(a_c), tower_r(0.3) * math.sin(a_c)
    p.append(rodr((cx + 0.15 * math.cos(a_c + math.pi), cy_ + 0.15 * math.sin(a_c + math.pi), 0.24), (ex, ey, 0.24), 0.06, "Wood", wt, 6))
    p.append((bbox(0.36, 0.36, 0.34, "Wood", wt), T(ex * 1.02, ey * 1.02, 0.17) @ R(a_c, "Z")))
    p.append((bbox(0.16, 0.36, 0.26, m, mt), T(cx + 0.25 * math.cos(a_c + math.pi), cy_ + 0.25 * math.sin(a_c + math.pi), 0.24) @ R(a_c, "Z")))
    # a little welcome: a sack of ore and a brass bell pull by the hopper
    p.append((blob(0.25, 0.22, 0.3, "Cloth", col([0.75, 0.62, 0.42], 6295, 0.08), 8, 5), T(0.9, -3.35, 0.3)))
    p.append((cyl(0.08, 0.1, "Cloth", col([0.75, 0.62, 0.42], 6296, 0.08), seg=6), T(0.9, -3.35, 0.55)))
    ob = piece(f"{pre}_Mill", p)
    anchor(f"{pre}_Mill_Hub", (0, hy, hz), ob)
    anchor(f"{pre}_Mill_Hopper", (hx, hyy, 1.4), ob)
    anchor(f"{pre}_Mill_Chute", (tx, ty, tz), ob)
    anchor(f"{pre}_Mill_Crank", (cx, cy_, 0.0), ob)
    build_sails(pre); build_crank(pre)
    return ob

def build_sails(pre):
    """Four sails in the XZ plane (three.js XY) set 0.5 forward of the hub (origin), turning about Y (three.js Z)."""
    evil = pre == "G"; p = []; yo = -0.5
    p.append((cyl(0.14, 0.75, "Wood", WOOD_T if not evil else DARKWOOD_T, seg=8), T(0, 0.25, 0) @ R(math.pi / 2, "X")))
    for k in range(4):
        a = k / 4 * TAU + math.pi / 4; c, s = math.cos(a), math.sin(a)
        rot = lambda q, c=c, s=s: (q[0] * c - q[2] * s, q[1], q[0] * s + q[2] * c)  # (along, y, across) -> XZ
        Mrot = Matrix(((c, 0, -s, 0), (0, 1, 0, 0), (s, 0, c, 0), (0, 0, 0, 1)))
        if not evil:
            p.append((bbox(4.3, 0.16, 0.18, "Wood", WOOD_T, bev=0.025), Mrot @ T(2.4, yo, 0)))
            for t in np.linspace(1.1, 4.4, 8):  # sail bars
                p.append((bbox(0.05, 0.05, 1.25, "Wood", WOOD_T), Mrot @ T(t, yo - 0.05, 0.5)))
            for z_ in (0.05, 1.1):
                p.append((bbox(3.4, 0.05, 0.06, "Wood", WOOD_T), Mrot @ T(2.75, yo - 0.08, z_)))
            def f(u, v, k=k):
                along = 1.15 + 3.2 * u; across = 0.12 + 0.95 * v
                return rot((along, yo - 0.12 - 0.12 * math.sin(math.pi * u) * math.sin(math.pi * v), across))
            stripe = lambda q, n_: np.where((np.abs(np.hypot(q[:, 0], q[:, 2]) - 2.75) < 0.6)[:, None], np.array([0.3, 0.45, 0.85]), np.array([0.97, 0.93, 0.84]))
            p.append(sheet(4, 2, f, "Cloth", lambda q, n_: np.clip(stripe(q, n_) * (1 + 0.05 * fbm(q, 6300 + k, 2.0, 2))[:, None], 0, 1)))
            p.append((bbox(0.12, 0.06, 0.12, "Brass", BRASS_T), Mrot @ T(4.5, yo, 0)))
        else:  # bat wings: a bone arm out to a knuckle, three finger bones, a scalloped membrane between them
            knuckle = (2.1, yo, 0.25); tip = (4.3, yo, 0.0)
            p.append(tube2([rot(q) for q in ((0.2, yo, 0.0), (1.2, yo, 0.18), knuckle)], 0.11, 0.08, "Bone", BONE_T, 6, 2))
            p.append((blob(0.15, 0.15, 0.14, "Bone", BONE_T, 7, 4), Mrot @ T(*knuckle)))
            fingers = [tip, (3.9, yo, 1.2), (2.9, yo, 1.55)]
            for j, fp in enumerate(fingers):
                mid = ((knuckle[0] + fp[0]) / 2, yo, (knuckle[2] + fp[2]) / 2 + 0.12)
                p.append(tube2([rot(q) for q in (knuckle, mid, fp)], 0.07, 0.03, "Bone", BONE_T, 5, 1))
                v, f_ = L.crystal_point(0.25, 0.05, 4); p.append((obj("claw", v, f_, "Bone", BONE_T, tile=0.3), Mrot @ T(*fp) @ R(math.atan2(fp[0] - knuckle[0], fp[2] - knuckle[2]), "Y")))
            edge = [tip, (4.0, yo, 0.85), fingers[1], (3.2, yo, 1.15), fingers[2], (2.0, yo, 1.15), (0.6, yo, 0.55)]
            root = [(0.6, yo, 0.12), (1.2, yo, 0.2), knuckle, (3.0, yo, 0.15), tip]
            def f(u, v, k=k):
                e = np.array(edge); r_ = np.array(root)
                ie = u * (len(e) - 1); i0 = min(int(ie), len(e) - 2); pe = e[i0] + (e[i0 + 1] - e[i0]) * (ie - i0)
                ir = (1 - u) * (len(r_) - 1); j0 = min(int(ir), len(r_) - 2); pr = r_[j0] + (r_[j0 + 1] - r_[j0]) * (ir - j0)
                q = pr + (pe - pr) * v; q[1] = yo - 0.03 - 0.1 * math.sin(math.pi * v) * math.sin(math.pi * u)
                return rot(tuple(q))
            p.append(sheet(6, 3, f, "Cloth", col([0.42, 0.18, 0.55], 6310 + k, 0.12)))
    if not evil:
        p.append((obj("hub", *lathe([(0.0, 0.0), (0.42, 0.0), (0.45, 0.12), (0.32, 0.3), (0.0, 0.32)], 12), "Brass", BRASS_T, tile=0.3, sa=40), T(0, yo + 0.12, 0) @ R(math.pi / 2, "X")))
        v, f = bipyramid(0.36, 0.1, 0.22, 6); p.append((obj("boss", v, f, "Crystal", None, tile=0.3, sa=20), T(0, yo - 0.18, 0) @ R(math.pi / 2, "X")))
    else:
        p.append((obj("hub", *lathe([(0.0, 0.0), (0.4, 0.0), (0.44, 0.15), (0.3, 0.3), (0.0, 0.32)], 9), "Iron", IRON_T, tile=0.3, sa=40), T(0, yo + 0.12, 0) @ R(math.pi / 2, "X")))
        p.append((blob(0.28, 0.24, 0.28, "Ooze", None, 9, 6), T(0, yo - 0.25, 0)))
        for k in range(6):
            a = k / 6 * TAU; v, f = L.crystal_point(0.2, 0.05, 4)
            p.append((obj("spk", v, f, "Bone", BONE_T, tile=0.3), T(0.36 * math.cos(a), yo - 0.12, 0.36 * math.sin(a)) @ R(math.pi / 2, "X")))
    piece(f"{pre}_MillSails", p)

def build_crank(pre):
    """Capstan: axle up local Z (three.js Y) from the origin, spoked wheel r 0.7 at 0.92, upright handles."""
    evil = pre == "G"; p = []; wt = DARKWOOD_T if evil else WOOD_T; m, mt = ("Iron", IRON_T) if evil else ("Brass", BRASS_T)
    p.append((cyl(0.1, 1.2, "Wood", wt, seg=8), T(0, 0, 0.12)))
    for z in (0.3, 1.25): p.append((obj("band", *torus(0.105, 0.025, 8, 4), m, mt, tile=0.3), T(0, 0, z)))
    p.append((obj("hub", *disc_lathe(0.2, 0.2, 0, 0.18, 8), m, mt, tile=0.3), T(0, 0, 0.83)))
    p.append((obj("rim", *lathe([(0.66, -0.05), (0.74, -0.05), (0.74, 0.05), (0.66, 0.05), (0.66, -0.05)], 16), "Wood", wt, tile=0.5, sa=40), T(0, 0, 0.92)))
    p.append((obj("tyre", *torus(0.745, 0.018, 16, 3), m, mt, tile=0.3), T(0, 0, 0.92)))
    for k in range(6):
        a = k / 6 * TAU; c, s = math.cos(a), math.sin(a)
        p.append(beam((0.15 * c, 0.15 * s, 0.92), (0.68 * c, 0.68 * s, 0.92), 0.07, "Wood", wt))
        if evil:
            p.append(tube2([(0.7 * c, 0.7 * s, 0.93), (0.72 * c, 0.72 * s, 1.08), (0.7 * c, 0.7 * s, 1.18)], 0.035, 0.035, "Bone", BONE_T, 5, 1))
            p.append((blob(0.055, 0.055, 0.05, "Bone", BONE_T, 6, 3), T(0.7 * c, 0.7 * s, 1.2)))
        else:
            p.append((cyl(0.03, 0.26, "Wood", col([0.7, 0.35, 0.22], 6400 + k, 0.08), seg=6), T(0.7 * c, 0.7 * s, 0.94)))
            p.append((blob(0.045, 0.045, 0.04, "Brass", BRASS_T, 6, 3), T(0.7 * c, 0.7 * s, 1.21)))
    p.append((obj("crown", *disc_lathe(0.3, 0.3, 0, 0.08, 10), m, mt, tile=0.3), T(0, 0, 0.18)))
    for k in range(8):
        a = k / 8 * TAU; p.append((bbox(0.08, 0.06, 0.08, m, mt), T(0.31 * math.cos(a), 0.31 * math.sin(a), 0.3) @ R(a, "Z")))
    if evil: p.append((blob(0.12, 0.12, 0.1, "Ooze", None, 8, 4), T(0, 0, 1.33)))
    else:
        v, f = bipyramid(0.18, 0.06, 0.1, 6); p.append((obj("gem", v, f, "Crystal", None, tile=0.3, sa=20), T(0, 0, 1.34)))
    piece(f"{pre}_MillCrank", p)

# ----------------------------------------------------------------------------------------------
BUILDERS = {"D_Tavern": lambda: build_tavern("D"), "G_Tavern": lambda: build_tavern("G"), "N_Tavern": lambda: build_tavern("N"),
            "D_Quartermaster": lambda: build_quartermaster("D"), "G_Quartermaster": lambda: build_quartermaster("G"),
            "D_Mill": lambda: build_mill("D"), "G_Mill": lambda: build_mill("G")}

def build(which=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lum = build_materials()
    for k, f in BUILDERS.items():
        if which and k not in which: continue
        t = time.time(); f(); print(k, round(time.time() - t, 1), "s", flush=True)
    for ob in list(bpy.data.objects):  # stray helper objects never reach the kit
        if ob.type == "MESH" and ob.parent is None and ob.name[:2] not in ("D_", "G_", "N_"): bpy.data.objects.remove(ob)
    return lum

def anchors_report(path):
    import struct as st
    d = open(path, "rb").read(); jl = st.unpack("<I", d[12:16])[0]; j = json.loads(d[20:20 + jl])
    return {n["name"]: [round(v, 3) for v in n.get("translation", [0, 0, 0])] for n in j["nodes"] if "mesh" not in n}

if __name__ == "__main__":
    which = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    lum = build(which)
    glb = os.path.join(HERE, "town_kit.glb"); B.export_glb(glb); B.pack_colors(glb)
    rep = L.inspect(glb); rep["anchors"] = anchors_report(glb); rep["texture_luminance"] = {k: round(v, 3) for k, v in lum.items()}; rep["seconds"] = round(time.time() - T0, 1)
    json.dump(rep, open(os.path.join(HERE, "build_report.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("bytes", "images", "total_triangles", "seconds")}), json.dumps(rep["triangles"]), json.dumps(rep["anchors"]))
