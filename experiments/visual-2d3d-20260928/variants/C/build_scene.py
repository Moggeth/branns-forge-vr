"""Variant C: 2D-reference-guided orchard brook builder (deterministic).

Run:  blender -b --factory-startup -P output/build_scene.py -- [--render] [--fast]
Coordinates in this file are Godot/world coordinates (x, y-up, z-south); they are
converted to Blender (x, -z, y) only when objects are created.
Writes output/world_spec.json, scene.blend, scene.glb and renders/*.png.
"""
import bpy, bmesh, json, math, os, random, sys, time
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ASSETS = os.path.join(REPO, "godot", "assets", "orchard")
BENCH = json.load(open(os.path.join(REPO, "experiments", "visual-2d3d-20260928", "benchmark.json")))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SEED = 20260928
rng = random.Random(SEED)

# ---------------------------------------------------------------------------
# 1. Plan (read by eye from input/generated-map-source.png, 1254px -> 80 m)
# ---------------------------------------------------------------------------
SPAWN = tuple(BENCH["fixed_gameplay"]["spawn_xz"])
GOAL = tuple(BENCH["fixed_gameplay"]["goal_xz"])

# Stream centreline sampled from the blue band, west edge to east edge.
STREAM_PTS = [(-41, -5.2), (-32, -3.3), (-24, -1.2), (-16.4, -2.4), (-9.4, -3.4),
              (-4.3, -2.4), (0.0, -0.3), (5.9, 1.15), (11, 1.5), (16.1, 0.2),
              (20.6, -0.45), (28.9, 0.8), (41, 2.75)]
STREAM_W = 4.5          # nominal water width (visible water ~4.9 m where banks meet)
WATER_Y = -0.9
CROSS_C = (0.1, -0.35)
# Path direction at the white crossing tile in the map: (560,720)->(700,520) px.
_d = Vector((9.0, -12.8)).normalized()
BRIDGE_DIR = (_d.x, _d.y)
BRIDGE_YAW = math.atan2(BRIDGE_DIR[0], BRIDGE_DIR[1])   # yaw 0 = +Z, long axis
BRIDGE_LEN = 10.0
BRIDGE_WALK_W = 3.4     # clear width between parapets
BRIDGE_OUT_W = 4.4
B_START = (CROSS_C[0] - BRIDGE_DIR[0] * BRIDGE_LEN / 2, CROSS_C[1] - BRIDGE_DIR[1] * BRIDGE_LEN / 2)
B_END = (CROSS_C[0] + BRIDGE_DIR[0] * BRIDGE_LEN / 2, CROSS_C[1] + BRIDGE_DIR[1] * BRIDGE_LEN / 2)

# Route: map's S-curve, then the NE section compressed to the benchmark goal.
PATH_PRE = [SPAWN, (-26.5, 25.6), (-21.5, 22.3), (-16.5, 19.0), (-13.8, 14.5),
            (-10.6, 10.4), (-6.6, 8.2), (-4.4, 7.0)]
PATH_POST = [(4.6, -7.2), (7.6, -10.8), (11.2, -14.4), (15.6, -17.4),
             (19.6, -19.6), (21.9, -22.6), GOAL]
PATH = PATH_PRE + [B_START, B_END] + PATH_POST
PATH_HALF_W = 1.8

# Hills: h(d) = amp * exp(-(d/radius)^2)  (see spec terrain.c_falloff)
HILLS = [
    # sandy clearings of the map (dirt mounds)
    ((-15.0, -17.0), 8.5, 1.4), ((-1.0, -21.8), 4.5, 0.6),
    ((15.0, 15.5), 8.5, 1.3), ((28.3, 13.6), 3.5, 0.5),
    # ravine shoulders: woodland rises at the map edges
    ((-40.0, -40.0), 16.0, 4.0), ((-44.0, 16.0), 9.0, 2.5), ((8.0, -44.0), 12.0, 3.0),
    ((46.0, 22.0), 12.0, 3.2), ((40.0, 42.0), 16.0, 4.0), ((-6.0, 44.0), 11.0, 2.6),
    ((43.0, -17.0), 8.0, 2.0),
    # gentle rolls under the route (keeps grade < 0.24)
    ((-22.0, 14.0), 9.0, 0.8), ((10.0, -20.0), 8.0, 0.7), ((-12.0, 26.0), 8.0, 0.9),
    # beacon knoll
    ((26.0, -29.0), 9.0, 1.2),
]


def _resample(pts, step):
    """Points every `step` metres of arc length along a polyline."""
    out = [pts[0]]; carry = 0.0
    for (a, b) in zip(pts, pts[1:]):
        L = math.dist(a, b); s = step - carry
        while s <= L:
            t = s / L
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); s += step
        carry = L - (s - step)
    if math.dist(out[-1], pts[-1]) > step * 0.3: out.append(pts[-1])
    return out


def _chaikin(pts, it=2):
    for _ in range(it):
        q = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            q += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]),
                  (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        q.append(pts[-1])
        pts = q
    return pts


STREAM_SMOOTH = _chaikin(STREAM_PTS, 3)
# trench: chain of negative hills (~-1.3 m bed) along the stream
for (x, z) in _resample(STREAM_SMOOTH, 3.0):
    if -44 < x < 44:
        HILLS.append(((round(x, 2), round(z, 2)), 3.5, -0.63))


def height(x, z):
    h = 0.0
    for (c, r, a) in HILLS:
        d2 = (x - c[0]) ** 2 + (z - c[1]) ** 2
        if d2 < (4 * r) ** 2:
            h += a * math.exp(-d2 / (r * r))
    return h


def seg_dist(p, a, b):
    ax, az = a; bx, bz = b
    vx, vz = bx - ax, bz - az
    L2 = vx * vx + vz * vz or 1e-9
    t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - az) * vz) / L2))
    return math.hypot(p[0] - ax - vx * t, p[1] - az - vz * t)


def poly_dist(p, pts):
    return min(seg_dist(p, a, b) for a, b in zip(pts, pts[1:]))


PATH_SMOOTH = _chaikin(PATH_PRE, 2)[:-1] + [PATH_PRE[-1], B_START, B_END, PATH_POST[0]] + _chaikin(PATH_POST, 2)[1:]


# ---------------------------------------------------------------------------
# 2. Object placement plan (world coords)
# ---------------------------------------------------------------------------
objects = []


def place(asset, x, z, yaw=0.0, scale=1.0, y=None, **extra):
    o = {"asset_id": asset, "position_xyz": [round(x, 3), round(height(x, z) if y is None else y, 3), round(z, 3)],
         "yaw_rad": round(yaw, 4), "scale": round(scale, 3), "interactive": False}
    o.update(extra)
    objects.append(o)
    return o


def clear_of(x, z, r):
    """Keep r metres free around route, stream and beacon."""
    if poly_dist((x, z), PATH_SMOOTH) < PATH_HALF_W + r: return False
    if poly_dist((x, z), STREAM_SMOOTH) < 2.9 + r * 0.5: return False
    if math.dist((x, z), GOAL) < 8.0 + r: return False
    if math.dist((x, z), SPAWN) < 3.5 + r: return False
    return abs(x) < 39.3 and abs(z) < 39.3


# Tree clusters read from the map's dark-green discs (centre_xz, radius, density 0..1)
CLUSTERS = [
    ("woods_northwest", (-31, -30), 11, 0.85), ("woods_northwest_b", (-20, -35), 7, 0.8),
    ("woods_north", (12, -33), 7, 0.75), ("woods_east", (35, -8), 6, 0.7),
    ("woods_east_b", (35, 5), 5, 0.6),
    ("woods_southeast", (28, 30), 12, 0.9), ("woods_southeast_b", (14, 34), 6, 0.8),
    ("woods_southwest", (-34, 12), 7, 0.8), ("woods_south", (-16, 35), 8, 0.85),
    ("woods_west", (-36, -12), 5, 0.6),
]
LONE_TREES = [(-3.0, -14.5), (17.7, -11.9), (-25.3, -8.7), (-17.4, 10.7), (5.3, 23.5),
              (-0.4, 30.8), (-6.2, 29.3), (-13.5, 26.0), (19.7, -15.3), (-16.4, -30.5),
              (1.1, -35.1), (6.0, 12.0), (-8.0, -8.5), (24.5, -5.5), (-28.0, 3.5)]
TREE_KIND = ["apple_tree_mature"] * 4 + ["apple_tree_mature_b"] * 4 + ["apple_tree_young"] * 3 + ["apple_tree_mature_autumn"]
trees = []


def try_tree(x, z, spacing, kind=None):
    kind = kind or rng.choice(TREE_KIND)
    r = 1.6 if "young" in kind else 2.6
    if not clear_of(x, z, r): return False
    if any(math.dist((x, z), t) < spacing for t in trees): return False
    trees.append((x, z))
    place(kind, x, z, rng.uniform(0, math.tau), rng.uniform(0.85, 1.2), role="tree")
    return True


for (x, z) in LONE_TREES:
    try_tree(x, z, 3.0, rng.choice(["apple_tree_mature", "apple_tree_mature_b", "apple_tree_young"]))
for name, c, rad, dens in CLUSTERS:
    want = int(dens * rad * rad * math.pi / 10.0)
    got = tries = 0
    while got < want and tries < want * 30:
        tries += 1
        a = rng.uniform(0, math.tau); d = rad * math.sqrt(rng.random())
        if try_tree(c[0] + math.cos(a) * d, c[1] + math.sin(a) * d, 3.4): got += 1

# Undergrowth: hedges on wood margins, flowering shrubs near the route, stumps.
for name, c, rad, dens in CLUSTERS:
    for i in range(int(rad * 0.9)):
        a = rng.uniform(0, math.tau); d = rad * rng.uniform(0.85, 1.15)
        x, z = c[0] + math.cos(a) * d, c[1] + math.sin(a) * d
        if clear_of(x, z, 1.2):
            place("hedge_dense", x, z, a + math.pi / 2, rng.uniform(0.9, 1.3), role="undergrowth")
for i, (x, z) in enumerate(_resample(PATH_SMOOTH, 2.2)):
    side = 1 if rng.random() < 0.5 else -1
    if rng.random() < 0.55:
        # offset perpendicular to route
        j = min(range(len(PATH_SMOOTH) - 1), key=lambda k: seg_dist((x, z), PATH_SMOOTH[k], PATH_SMOOTH[k + 1]))
        a, b = PATH_SMOOTH[j], PATH_SMOOTH[j + 1]
        t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        off = rng.uniform(3.0, 5.5) * side
        px, pz = x - t.y * off, z + t.x * off
        if clear_of(px, pz, 0.8):
            kind = "shrub_flowering" if rng.random() < 0.7 else "rock_mossy_small"
            place(kind, px, pz, rng.uniform(0, math.tau), rng.uniform(0.9, 1.5), role="undergrowth")

# Boulders along the brook banks (board: rounded mossy stones lining both banks)
for (x, z) in _resample(STREAM_SMOOTH, 2.6):
    for side in (-1, 1):
        if rng.random() < 0.55: continue
        j = min(range(len(STREAM_SMOOTH) - 1), key=lambda k: seg_dist((x, z), STREAM_SMOOTH[k], STREAM_SMOOTH[k + 1]))
        a, b = STREAM_SMOOTH[j], STREAM_SMOOTH[j + 1]
        t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        off = side * rng.uniform(2.3, 3.4)
        px, pz = x - t.y * off, z + t.x * off
        if abs(px) > 39.5 or poly_dist((px, pz), PATH_SMOOTH) < PATH_HALF_W + 1.0: continue
        big = rng.random() < 0.45
        place("rock_mossy" if big else "rock_mossy_small", px, pz, rng.uniform(0, math.tau),
              rng.uniform(1.1, 1.8) if big else rng.uniform(1.0, 1.6), role="boulder",
              y=height(px, pz) - 0.15)

# Scattered boulders on the slopes / clearing rims
for (x, z, s) in [(-9, -20, 1.8), (-20, -12, 1.5), (7, 18, 1.6), (22, 20, 1.9), (-24, 6, 1.4),
                  (12, -26, 1.5), (-32, 22, 1.3), (30, -16, 1.6), (4, 9.5, 1.2), (-8, 14, 1.3)]:
    if clear_of(x, z, 1.2):
        place("rock_mossy", x, z, rng.uniform(0, math.tau), s, role="boulder")

# Fallen field walls (approach view: low broken walls beside the lane)
WALL_RUNS = [((-19.5, 13.0), 0.9, 3), ((-9.0, 2.8), 0.25, 2), ((7.0, -3.6), 0.2, 2), ((12.0, -8.0), -0.9, 3),
             ((-24.0, 30.5), 1.4, 2)]
for (sx, sz), yaw, n in WALL_RUNS:
    ax, az = math.cos(yaw), -math.sin(yaw)       # wall local +X in world
    for i in range(n):
        x, z = sx + ax * 4.0 * i, sz + az * 4.0 * i
        kind = "wall_end_broken" if i == n - 1 else ("wall_straight" if i % 2 == 0 else "wall_end_broken")
        if clear_of(x, z, 1.3):
            place(kind, x, z, yaw + rng.uniform(-0.08, 0.08), 1.0, role="fallen_wall")
    ex, ez = sx + ax * 4.0 * n + 1.2, sz + az * 4.0 * n
    if clear_of(ex, ez, 1.1):
        place("rubble_split", ex, ez, rng.uniform(0, math.tau), 1.0, role="rubble")

# Ruined beacon enclosure: broken ring of walls, open to the SW where the lane arrives
RING_R = 6.8
entry = math.atan2(PATH_POST[-2][1] - GOAL[1], PATH_POST[-2][0] - GOAL[0])
for k in range(11):
    phi = entry + math.radians(45 + k * 27)
    if k in (4, 8) or -58 < ((math.degrees(phi) + 180) % 360) - 180 < -2: continue   # breaches + reverse-view gap
    x, z = GOAL[0] + math.cos(phi) * RING_R, GOAL[1] + math.sin(phi) * RING_R
    yaw = math.atan2(-math.cos(phi), -math.sin(phi))
    kind = ["wall_straight", "wall_end_broken", "wall_corner_broken"][k % 3]
    place(kind, x, z, yaw, 1.0, role="ruin_wall")
for k, (dx, dz) in enumerate([(-6.5, 5.8), (-8.2, 1.5), (4.5, 7.5), (8.6, -2.0), (-2.5, -8.8)]):
    x, z = GOAL[0] + dx, GOAL[1] + dz
    if clear_of(x, z, 0.0) or math.dist((x, z), GOAL) > 7:
        if poly_dist((x, z), PATH_SMOOTH) > PATH_HALF_W + 1.0:
            place("rubble_split", x, z, rng.uniform(0, math.tau), rng.uniform(0.9, 1.3), role="ruin_rubble")

# Ravine outcrops in two far corners (scaled cliff chunk)
place("mountain_cliff_chunk", -34.0, -34.5, 0.6, 0.1, role="outcrop", y=height(-34.0, -34.5) - 0.6)
place("mountain_cliff_chunk", 34.5, 35.0, 3.6, 0.1, role="outcrop", y=height(34.5, 35.0) - 0.6)

# Decorative path tiles: walkable surface, not obstacles
for a, b in zip(PATH, PATH[1:]):
    if (a, b) == (B_START, B_END): continue   # the bridge deck is the surface here
    L = math.dist(a, b)
    n = max(1, math.ceil(L / 3.7))
    yaw = math.atan2(b[0] - a[0], b[1] - a[1])
    for i in range(n):
        t = (i + 0.5) / n
        x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        if min(math.dist((x, z), B_START), math.dist((x, z), B_END)) < 2.6 or math.dist((x, z), GOAL) < 4.2: continue
        place("path_straight", x, z, yaw, 1.0, y=height(x, z) + 0.03, role="surface")

# Procedural (non-library) structures, recorded in the spec's namespaced block
BEACON = {"center_xz": list(GOAL), "dais_radius_m": 3.4, "dais_top_y": round(height(*GOAL) + 0.55, 3),
          "orb_height_m": 2.4, "orb_color": "#d060bb",
          "monoliths": [{"angle_deg": a, "height_m": h} for a, h in [(175, 4.6), (225, 3.2), (272, 5.4), (50, 3.6)]]}

# ---------------------------------------------------------------------------
# 3. world_spec.json
# ---------------------------------------------------------------------------
def buffer_poly(pts, w):
    left, right = [], []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        left.append([round(p[0] - t.y * w, 2), round(p[1] + t.x * w, 2)])
        right.append([round(p[0] + t.y * w, 2), round(p[1] - t.x * w, 2)])
    return left + right[::-1]


def circle_poly(c, r, n=12, squash=1.0):
    return [[round(c[0] + math.cos(i * math.tau / n) * r, 2), round(c[1] + math.sin(i * math.tau / n) * r * squash, 2)] for i in range(n)]


regions = [{"name": "meadow", "surface": "grass", "polygon_xz": [[-40, -40], [40, -40], [40, 40], [-40, 40]], "tree_density": 0.02}]
for name, c, rad, dens in CLUSTERS:
    regions.append({"name": name, "surface": "grass_woodland", "polygon_xz": circle_poly(c, rad), "tree_density": dens})
regions += [
    {"name": "clearing_northwest", "surface": "dirt", "polygon_xz": circle_poly((-15, -17), 7, 10, 0.8), "tree_density": 0.0},
    {"name": "clearing_north_small", "surface": "dirt", "polygon_xz": circle_poly((-1, -21.8), 3.2, 8, 0.7), "tree_density": 0.0},
    {"name": "clearing_southeast", "surface": "dirt", "polygon_xz": circle_poly((15, 15.5), 7, 10, 0.75), "tree_density": 0.0},
    {"name": "brook", "surface": "water", "polygon_xz": buffer_poly(_resample(STREAM_PTS, 4.0), STREAM_W / 2), "tree_density": 0.0},
    {"name": "lane", "surface": "dirt_path", "polygon_xz": buffer_poly(_resample(PATH, 3.0), PATH_HALF_W), "tree_density": 0.0},
    {"name": "beacon_ruin", "surface": "stone", "polygon_xz": circle_poly(GOAL, 7.5, 14), "tree_density": 0.0},
]

spec = {
    "version": 1, "variant": "C", "method": "2d_reference_guided_opus_3d", "seed": SEED,
    "bounds_m": [80, 80], "spawn_xz": list(SPAWN), "goal_xz": list(GOAL),
    "path_xz": [[round(p[0], 3), round(p[1], 3)] for p in PATH],
    "stream": {"points_xz": [list(p) for p in STREAM_PTS], "width_m": STREAM_W, "c_water_y": WATER_Y},
    "crossing": {"center_xz": list(CROSS_C), "width_m": BRIDGE_WALK_W, "length_m": BRIDGE_LEN,
                 "yaw_rad": round(BRIDGE_YAW, 4), "c_outer_width_m": BRIDGE_OUT_W,
                 "c_type": "stone-parapet timber-deck arch (procedural)",
                 "c_ends_xz": [[round(v, 3) for v in B_START], [round(v, 3) for v in B_END]]},
    "terrain": {"base_y": 0.0, "gaussian_coefficient": 1.0, "stream_carve": {"kind": "none"},
                "hills": [{"center_xz": [round(c[0], 2), round(c[1], 2)], "radius_m": r, "amplitude_m": a} for c, r, a in HILLS],
                "c_falloff": "amplitude_m * exp(-(d/radius_m)^2), summed; negative hills carve the brook trench"},
    "regions": regions,
    "objects": objects,
    "exclusions": [
        {"kind": "polygon", "name": "route_corridor", "polygon_xz": buffer_poly(_resample(PATH, 3.0), PATH_HALF_W + 0.6)},
        {"kind": "polygon", "name": "brook", "polygon_xz": buffer_poly(_resample(STREAM_PTS, 4.0), 2.9),
         "except_roles": ["boulder"]},  # shoreline rocks are intentional; trees remain excluded
        {"kind": "circle", "name": "beacon_dais", "center_xz": list(GOAL), "radius_m": 4.0},
        {"kind": "circle", "name": "spawn", "center_xz": list(SPAWN), "radius_m": 3.5},
    ],
    "c_procedural": {"beacon": BEACON, "bridge": "see crossing", "terrain_mesh": "0.5 m grid of terrain.hills", "water": "ribbon along stream.points_xz (Chaikin x3)"},
    "provenance": {"source_image": "input/generated-map-source.png", "reference_board": "input/environment-board.png",
                   "source_plan": "coordinates read visually from the map by Opus (no extracted JSON consulted)",
                   "tools": ["Blender 4.5.13"], "model": "claude-opus-5-5", "measured_time_s": None},
}

# ---------------------------------------------------------------------------
# 4. Blender scene
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene


def B(x, y, z):
    return Vector((x, -z, y))


def mat(name, rgb, rough=0.85, emit=None, alpha=None, metallic=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metallic
    if emit:
        p.inputs["Emission Color"].default_value = (*emit[0], 1)
        p.inputs["Emission Strength"].default_value = emit[1]
    if alpha is not None:
        p.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


coll = {n: bpy.data.collections.new(n) for n in ["Terrain", "Water", "Bridge", "Beacon", "Props", "Cameras", "Library"]}
for c in coll.values():
    scn.collection.children.link(c)
coll["Library"].hide_render = True; coll["Library"].hide_viewport = True


def link(obj, c):
    coll[c].objects.link(obj)
    return obj


# --- terrain with vertex colours ---
GRASS_A, GRASS_B = srgb("#8fb05a"), srgb("#a9c166")
DIRT, SAND, MUD = srgb("#a8845c"), srgb("#c2aa74"), srgb("#6b6a4a")
N = 160
bm = bmesh.new()
verts = []
for j in range(N + 1):
    for i in range(N + 1):
        x = -40 + 80 * i / N; z = -40 + 80 * j / N
        verts.append(bm.verts.new(B(x, height(x, z), z)))
bm.verts.ensure_lookup_table()
col_layer = bm.loops.layers.color.new("Col")


def ground_col(x, z):
    n = 0.5 + 0.25 * math.sin(x * 0.31 + z * 0.17) + 0.25 * math.sin(x * 0.07 - z * 0.23 + 1.3)
    c = [GRASS_A[k] * (1 - n) + GRASS_B[k] * n for k in range(3)]
    dp = poly_dist((x, z), PATH_SMOOTH)
    ds = poly_dist((x, z), STREAM_SMOOTH)
    for cc, r, w in [((-15, -17), 7.0, 0.8), ((-1, -21.8), 3.2, 0.7), ((15, 15.5), 7.0, 0.75)]:
        dd = math.hypot(x - cc[0], (z - cc[1]) / w) / r
        if dd < 1.15:
            f = min(1, (1.15 - dd) / 0.3)
            c = [c[k] * (1 - f) + SAND[k] * f for k in range(3)]
    if ds < 3.6:
        f = min(1, (3.6 - ds) / 1.2)
        c = [c[k] * (1 - f) + MUD[k] * f for k in range(3)]
    if dp < PATH_HALF_W + 0.5:
        f = min(1, (PATH_HALF_W + 0.5 - dp) / 0.7)
        c = [c[k] * (1 - f) + DIRT[k] * f for k in range(3)]
    dg = math.dist((x, z), GOAL)
    if dg < 8:
        f = min(1, (8 - dg) / 3) * 0.6
        c = [c[k] * (1 - f) + DIRT[k] * f for k in range(3)]
    return (*c, 1)


cols = [ground_col(-40 + 80 * (k % (N + 1)) / N, -40 + 80 * (k // (N + 1)) / N) for k in range(len(verts))]
for j in range(N):
    for i in range(N):
        ids = [j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i + 1, (j + 1) * (N + 1) + i]
        f = bm.faces.new([verts[k] for k in ids][::-1])
        for loop, k in zip(f.loops, ids[::-1]):
            loop[col_layer] = cols[k]
me = bpy.data.meshes.new("terrain"); bm.to_mesh(me); bm.free()
me.shade_flat() if hasattr(me, "shade_flat") else None
tm = bpy.data.materials.new("terrain_vc"); tm.use_nodes = True
nt = tm.node_tree; vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
nt.links.new(vc.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
me.materials.append(tm)
link(bpy.data.objects.new("Terrain", me), "Terrain")

# --- water ribbon ---
M_WATER = mat("water", srgb("#3f91b8"), 0.12, emit=(srgb("#2b7aa6"), 0.15))
wp = _resample(STREAM_SMOOTH, 1.0)
bm = bmesh.new(); rows = []
for i, p in enumerate(wp):
    a = wp[max(0, i - 1)]; b = wp[min(len(wp) - 1, i + 1)]
    t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
    hw = 2.9
    rows.append([bm.verts.new(B(p[0] + t.y * hw * s, WATER_Y, p[1] - t.x * hw * s)) for s in (-1, 0, 1)])
for r0, r1 in zip(rows, rows[1:]):
    for k in range(2):
        bm.faces.new([r0[k], r0[k + 1], r1[k + 1], r1[k]])
me = bpy.data.meshes.new("water"); bm.to_mesh(me); bm.free(); me.materials.append(M_WATER)
link(bpy.data.objects.new("Brook_Water", me), "Water")
# foam flecks near banks and rocks: white small quads
M_FOAM = mat("foam", (0.9, 0.95, 1.0), 0.6, emit=((0.8, 0.9, 1.0), 0.3))


def box(name, c, size, m, rot_z=0.0, collection="Bridge", rot_x=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    for cc in o.users_collection: cc.objects.unlink(o)
    link(o, collection)
    o.name = name; o.scale = size; o.location = c
    o.rotation_euler = (rot_x, 0, rot_z)
    o.data.materials.append(m)
    return o


# --- bridge (board panel 3/4: timber deck between mossy stone parapets, low arch) ---
M_STONE = mat("stone_bridge", srgb("#8d918c"), 0.9)
M_MOSS = mat("moss", srgb("#6f8d3c"), 0.95)
M_WOOD = mat("timber_deck", srgb("#8a5f38"), 0.8)
M_WOOD2 = mat("timber_deck_dark", srgb("#6e4a2b"), 0.85)
bx, bz = CROSS_C
ux, uz = BRIDGE_DIR                    # long axis (world xz)
px_, pz_ = -uz, ux                     # across axis
y0 = height(*B_START) + 0.05; y1 = height(*B_END) + 0.05
RISE = 0.55
blender_rot = math.atan2(ux, uz)       # yaw about Blender Z maps local -Y... use explicit mapping below


def deck_y(t):  # t in [0,1] along bridge
    return y0 + (y1 - y0) * t + RISE * math.sin(math.pi * t)


def wpos(s, a, y):  # s along (m from centre), a across (m)
    return B(bx + ux * s + px_ * a, y, bz + uz * s + pz_ * a)


# Blender yaw that aligns object local X with the across axis
across_rot = math.atan2(-pz_, px_)  # vector (px,-pz) in blender xy
NPL = 22
for i in range(NPL):
    s = -BRIDGE_LEN / 2 + (i + 0.5) * BRIDGE_LEN / NPL
    t = (s + BRIDGE_LEN / 2) / BRIDGE_LEN
    slope = math.atan((deck_y(min(1, t + 0.02)) - deck_y(max(0, t - 0.02))) / (0.04 * BRIDGE_LEN))
    pl = box(f"Plank_{i:02d}", wpos(s, 0, deck_y(t) - 0.08), (BRIDGE_OUT_W - 0.3, BRIDGE_LEN / NPL * 0.92, 0.16),
             M_WOOD if i % 3 else M_WOOD2, rot_z=across_rot)
    pl.rotation_euler = (slope, 0, across_rot)
# stringers + parapets + arch ribs, per side
for side in (-1, 1):
    a = side * (BRIDGE_WALK_W / 2 + 0.28)
    nb = 9
    for i in range(nb):
        s = -BRIDGE_LEN / 2 + (i + 0.5) * BRIDGE_LEN / nb
        t = (s + BRIDGE_LEN / 2) / BRIDGE_LEN
        h = 0.75 + 0.06 * math.sin(i * 2.3 + side)
        rng_off = 0.03 * math.sin(i * 1.7)
        slope = math.atan((deck_y(min(1, t + 0.02)) - deck_y(max(0, t - 0.02))) / (0.04 * BRIDGE_LEN))
        blk = box(f"Parapet_{side}_{i}", wpos(s, a + rng_off, deck_y(t) + h / 2 - 0.05),
                  (0.55, BRIDGE_LEN / nb * 0.94, h), M_STONE, rot_z=across_rot)
        blk.rotation_euler = (slope, 0, across_rot)
        if i % 2 == 0:
            mo = box(f"ParapetMoss_{side}_{i}", wpos(s, a, deck_y(t) + h - 0.02), (0.58, BRIDGE_LEN / nb * 0.6, 0.06), M_MOSS, rot_z=across_rot)
            mo.rotation_euler = (slope, 0, across_rot)
    # arch spandrel: stone blocks from deck down to an arch over the water
    for i in range(14):
        s = -BRIDGE_LEN / 2 + (i + 0.5) * BRIDGE_LEN / 14
        t = (s + BRIDGE_LEN / 2) / BRIDGE_LEN
        arch = WATER_Y + 0.2 + (deck_y(t) - 0.5 - WATER_Y - 0.2) * math.sin(math.pi * t) ** 0.5 if 0.12 < t < 0.88 else WATER_Y - 0.4
        top = deck_y(t) - 0.12
        if top - arch > 0.1:
            box(f"Spandrel_{side}_{i}", wpos(s, a, (top + arch) / 2), (0.5, BRIDGE_LEN / 14 * 0.96, top - arch), M_STONE, rot_z=across_rot)
# abutment end pillars (board detail sheet: square stone posts)
for sgn in (-1, 1):
    for side in (-1, 1):
        s = sgn * (BRIDGE_LEN / 2 + 0.2); t = 0 if sgn < 0 else 1
        box(f"EndPost_{sgn}_{side}", wpos(s, side * (BRIDGE_WALK_W / 2 + 0.3), deck_y(t) + 0.35), (0.7, 0.7, 1.2), M_STONE, rot_z=across_rot)
        box(f"EndPostCap_{sgn}_{side}", wpos(s, side * (BRIDGE_WALK_W / 2 + 0.3), deck_y(t) + 0.98), (0.76, 0.76, 0.08), M_MOSS, rot_z=across_rot)

# --- beacon (board: stone dais, broken monoliths, glowing magenta orb) ---
M_RUIN = mat("ruin_stone", srgb("#8a8f92"), 0.9)
M_RUIN_D = mat("ruin_stone_dark", srgb("#6d7275"), 0.92)
M_ORB = mat("beacon_orb", srgb("#e070d0"), 0.2, emit=(srgb("#e34fd0"), 9.0))
M_GLOW = mat("beacon_glow_ring", srgb("#d060bb"), 0.4, emit=(srgb("#d060bb"), 2.5))
gx, gz = GOAL; gy = height(gx, gz)
for k, (r, h) in enumerate([(3.4, 0.3), (2.5, 0.55), (1.2, 0.75)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=h + 0.6, location=B(gx, gy + h - (h + 0.6) / 2, gz))
    o = bpy.context.active_object; [c.objects.unlink(o) for c in o.users_collection]; link(o, "Beacon")
    o.name = f"Dais_{k}"; o.data.materials.append(M_RUIN if k != 1 else M_RUIN_D)
box("Pedestal", B(gx, gy + 1.25, gz), (0.7, 0.7, 1.0), M_RUIN, collection="Beacon")
bpy.ops.mesh.primitive_torus_add(major_radius=1.05, minor_radius=0.06, location=B(gx, gy + 0.78, gz))
o = bpy.context.active_object; [c.objects.unlink(o) for c in o.users_collection]; link(o, "Beacon"); o.name = "GlowRing"; o.data.materials.append(M_GLOW)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.55, location=B(gx, gy + BEACON["orb_height_m"], gz))
o = bpy.context.active_object; [c.objects.unlink(o) for c in o.users_collection]; link(o, "Beacon"); o.name = "BeaconOrb"; o.data.materials.append(M_ORB)
entry_deg = math.degrees(entry)
for k, m in enumerate(BEACON["monoliths"]):
    ang = math.radians(m["angle_deg"])
    x, z = gx + math.cos(ang) * 3.9, gz + math.sin(ang) * 3.9
    h = m["height_m"]; y = height(x, z)
    b = box(f"Monolith_{k}", B(x, y + h / 2 - 0.3, z), (1.0, 0.8, h + 0.6), M_RUIN, collection="Beacon", rot_z=ang)
    b.rotation_euler = (0.04 * math.sin(k * 3), 0.05 * math.cos(k * 2), ang)
    # broken cap chunk
    box(f"MonolithCap_{k}", B(x + 0.1, y + h + 0.1, z), (0.8, 0.6, 0.35), M_RUIN_D, collection="Beacon", rot_z=ang + 0.4)
light = bpy.data.lights.new("BeaconLight", "POINT"); light.energy = 1500; light.color = srgb("#e080d8"); light.shadow_soft_size = 0.6
lo = bpy.data.objects.new("BeaconLight", light); lo.location = B(gx, gy + 2.6, gz); link(lo, "Beacon")

# --- library assets (import once, instance by linked duplicates) ---
lib = {}
for aid in sorted({o["asset_id"] for o in objects}):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, aid + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        coll["Library"].objects.link(o)
    lib[aid] = [(o.data, o.matrix_world.copy()) for o in new if o.type == "MESH"]

counts = {}
for idx, o in enumerate(objects):
    aid = o["asset_id"]; counts[aid] = counts.get(aid, 0) + 1
    x, y, z = o["position_xyz"]
    root = bpy.data.objects.new(f"{aid}_{idx:03d}", None)
    root.location = B(x, y, z); root.rotation_euler = (0, 0, o["yaw_rad"]); root.scale = (o["scale"],) * 3
    link(root, "Props")
    for k, (data, mw) in enumerate(lib[aid]):
        ch = bpy.data.objects.new(f"{aid}_{idx:03d}_m{k}", data)
        ch.parent = root; ch.matrix_parent_inverse = Matrix.Identity(4); ch.matrix_basis = mw
        link(ch, "Props")

# --- lighting / world (board: warm late-morning sun, blue sky, soft haze) ---
sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 4.2; sun.color = (1.0, 0.95, 0.85); sun.angle = math.radians(3)
so = bpy.data.objects.new("Sun", sun); so.rotation_euler = (math.radians(48), math.radians(12), math.radians(-35)); link(so, "Cameras")
world = bpy.data.worlds.new("Sky"); scn.world = world; world.use_nodes = True
wn = world.node_tree.nodes; bg = wn["Background"]
# vertical gradient: pale haze at horizon -> clear blue zenith
tc = wn.new("ShaderNodeTexCoord"); sep = wn.new("ShaderNodeSeparateXYZ"); ramp = wn.new("ShaderNodeValToRGB")
world.node_tree.links.new(tc.outputs["Generated"], sep.inputs[0])
world.node_tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (*srgb("#dfe9e6"), 1)
ramp.color_ramp.elements[1].position = 0.4; ramp.color_ramp.elements[1].color = (*srgb("#6fa6de"), 1)
world.node_tree.links.new(ramp.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0

# --- cameras ---
cams = BENCH["evaluation_cameras"] + [{"id": "unfamiliar_reverse_low", "position": [-15, 3.6, -18], "target": [8, 0.5, 6], "fov_deg": 70}]
for c in cams:
    cd = bpy.data.cameras.new(c["id"]); cd.sensor_fit = "VERTICAL"; cd.angle = math.radians(c["fov_deg"]); cd.clip_end = 400
    co = bpy.data.objects.new("CAM_" + c["id"], cd); co.location = B(*c["position"]); link(co, "Cameras")
    d = B(*c["target"]) - co.location
    if c.get("north_up"):
        co.rotation_euler = (0, 0, 0)   # looking -Z(blender down), +Y(blender)=north up
    else:
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scn.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
scn.view_settings.look = "None"
try:
    scn.eevee.use_shadows = True
except Exception:
    pass
scn.eevee.taa_render_samples = 16
T_BUILD = time.time() - T0

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "scene.blend"))
coll["Library"].hide_render = False; coll["Library"].hide_viewport = False
# exclude library + cameras from glb export
for o in coll["Library"].objects: o.select_set(False)
for o in list(coll["Terrain"].objects) + list(coll["Water"].objects) + list(coll["Bridge"].objects) + list(coll["Beacon"].objects) + list(coll["Props"].objects):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "scene.glb"), export_format="GLB", use_selection=True, export_yup=True, export_lights=False)
coll["Library"].hide_render = True
T_EXPORT = time.time() - T0 - T_BUILD

renders = {}
if "--render" in ARGS:
    os.makedirs(os.path.join(HERE, "renders"), exist_ok=True)
    fast = "--fast" in ARGS
    for c in cams:
        t = time.time()
        sq = c["id"] == "overhead"
        scn.render.resolution_x = 1024 if sq else 1280
        scn.render.resolution_y = 1024 if sq else 720
        scn.render.resolution_percentage = 50 if fast else 100
        scn.camera = bpy.data.objects["CAM_" + c["id"]]
        scn.render.filepath = os.path.join(HERE, "renders", c["id"] + ".png")
        bpy.ops.render.render(write_still=True)
        renders[c["id"]] = round(time.time() - t, 2)

spec["provenance"]["measured_time_s"] = {"build": round(T_BUILD, 2), "export": round(T_EXPORT, 2), "renders": renders,
                                          "total": round(time.time() - T0, 2)}
spec["c_asset_counts"] = counts
json.dump(spec, open(os.path.join(HERE, "world_spec.json"), "w"), indent=1)
print("BUILD_DONE", json.dumps(spec["provenance"]["measured_time_s"]), json.dumps(counts))
