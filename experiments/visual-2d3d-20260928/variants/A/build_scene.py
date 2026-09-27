"""Variant A - Orchard Brook direct 3D baseline (written brief only).

Deterministic builder. Run from the repository root:
  blender -b --factory-startup -P experiments/visual-2d3d-20260928/variants/A/build_scene.py
  blender -b --factory-startup -P experiments/visual-2d3d-20260928/variants/A/validate_glb.py

Layout is authored in Godot coordinates (x, y-up, z; north = -Z) and converted to
Blender (x, -z, y) only when creating objects.  world_spec.json is written from the
same layout lists, so the Godot compiler reconstructs the identical plan.
"""
import bpy, bmesh, json, math, os, random, sys, time
from mathutils import Vector

T0 = time.perf_counter()
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ASSETS = os.path.join(REPO, "godot", "assets", "orchard")
SEED = 20260928

# ---------------------------------------------------------------- written plan
SPAWN = (-30.0, 29.0)
GOAL = (24.0, -27.0)
BASE_Y = 0.0
# Gaussian hills: h = amplitude * exp(-(d / radius)^2)
HILLS = [
    ((-31.0, -31.0), 15.0, 5.5),   # NW ravine shoulder
    ((-12.0, -36.0), 10.0, 3.0),
    ((-38.0, 6.0), 11.0, 3.0),     # west flank
    ((33.0, 33.0), 15.0, 5.0),     # SE ravine shoulder
    ((13.0, 34.0), 10.0, 2.6),
    ((38.0, -8.0), 11.0, 3.0),     # east flank
    ((-29.0, 30.0), 9.0, 0.9),     # spawn knoll (looks down the route)
    ((26.0, -29.0), 8.0, 1.2),     # beacon knoll
]
# stream centreline, west edge -> east edge, square to the route at the origin
STREAM = [(-42, -26), (-32, -22), (-24, -15.5), (-16, -12), (-9, -8), (-4.5, -4.2), (0, 0),
          (4.5, 4.3), (9, 8.5), (15, 11), (22, 16), (28, 23), (34, 30), (42, 34)]
STREAM_IN = STREAM[1:-1]
VALLEY_DEPTH, VALLEY_R = 1.0, 12.0          # broad ravine trough along the stream
CH_DEPTH, CH_IN, CH_OUT = 1.9, 1.2, 4.5     # channel carve profile (smoothstep in->out)
WATER_BELOW = 1.35                          # water surface below un-carved ground
BRIDGE_HALF = 6.0                           # abutments sit 6 m from centreline (outside carve)
BRIDGE_A = (-BRIDGE_HALF / math.sqrt(2), BRIDGE_HALF / math.sqrt(2))
BRIDGE_B = (BRIDGE_HALF / math.sqrt(2), -BRIDGE_HALF / math.sqrt(2))
PATH_WEST = [SPAWN, (-26.5, 25.0), (-23.5, 20.5), (-18.5, 16.8), (-12.5, 13.6), (-8.2, 9.2), BRIDGE_A]
PATH_EAST = [BRIDGE_B, (6.8, -8.4), (9.2, -13.0), (13.2, -17.0), (17.5, -20.2), (21.0, -23.6), GOAL]
BEACON = (26.6, -29.8)
RUIN_C, RUIN_HALF = (25.0, -28.0), 7.5

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def seg_dist(p, a, b):
    ax, az = a; bx, bz = b; px, pz = p
    dx, dz = bx - ax, bz - az
    L = dx * dx + dz * dz
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)

def poly_dist(p, pts):
    return min(seg_dist(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))

ROUTE = PATH_WEST + PATH_EAST  # bridge segment joins A->B
def d_stream(x, z): return poly_dist((x, z), STREAM)
def d_route(x, z): return poly_dist((x, z), ROUTE)

def ground(x, z):
    """Un-carved ground (hills + ravine trough)."""
    h = BASE_Y
    for (cx, cz), r, a in HILLS:
        h += a * math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r))
    ds = d_stream(x, z)
    return h - VALLEY_DEPTH * math.exp(-(ds / VALLEY_R) ** 2), ds

def height(x, z):
    g, ds = ground(x, z)
    return g - CH_DEPTH * (1 - smoothstep(CH_IN, CH_OUT, ds))

def water_level(x, z):
    return ground(x, z)[0] - WATER_BELOW

def channel_width():
    # distance where carved ground crosses water surface
    target = 1 - WATER_BELOW / CH_DEPTH  # smoothstep value
    lo, hi = CH_IN, CH_OUT
    for _ in range(40):
        mid = (lo + hi) / 2
        if smoothstep(CH_IN, CH_OUT, mid) < target: lo = mid
        else: hi = mid
    return 2 * lo

# ------------------------------------------------------------ layout planning
rng = random.Random(SEED)
OBJECTS = []  # dicts: asset, pos(x,y,z Godot), yaw, scale, interactive
FOOT = {"apple_tree_mature": 1.0, "apple_tree_mature_b": 1.0, "apple_tree_mature_autumn": 1.0,
        "apple_tree_young": 0.6, "hedge_dense": 1.7, "shrub_flowering": 0.75, "rock_mossy": 0.8,
        "rock_mossy_small": 0.45, "rubble_split": 1.05, "wall_straight": 2.0, "wall_corner_broken": 2.0,
        "wall_end_broken": 2.3, "path_straight": 0.0, "path_curve30": 0.0, "path_curve30_left": 0.0,
        "mountain_cliff_chunk": 14.0}

def add(asset, x, z, yaw=0.0, scale=1.0, dy=0.0, interactive=False):
    OBJECTS.append({"asset_id": asset, "position_xyz": [round(x, 3), round(height(x, z) + dy, 3), round(z, 3)],
                    "yaw_rad": round(yaw, 4), "scale": round(scale, 3), "interactive": interactive})

def resample(pts, step):
    out = []
    for i in range(len(pts) - 1):
        (ax, az), (bx, bz) = pts[i], pts[i + 1]
        L = math.hypot(bx - ax, bz - az); n = max(1, round(L / step))
        for k in range(n):
            t = (k + 0.5) / n
            out.append((ax + (bx - ax) * t, az + (bz - az) * t, math.atan2(bx - ax, bz - az)))
    return out

# 1. path pieces (scaled 1.35 -> 2.4 m wide dirt tread), not on the bridge
PATH_SCALE = 1.35
for part in (PATH_WEST, PATH_EAST):
    for x, z, yaw in resample(part, 3.9):
        add("path_straight", x, z, yaw, PATH_SCALE, dy=-0.04)

# 2. ruin enclosure around the beacon: broken square, open on the SW (route) corner
cx, cz = RUIN_C; H = RUIN_HALF
walls = [  # (asset, x, z, yaw)
    ("wall_end_broken", cx - 2.0, cz + H, 0.0), ("wall_straight", cx + 2.5, cz + H, 0.0),
    ("rubble_split", cx + 6.0, cz + H + 0.4, 0.7),
    ("wall_corner_broken", cx + H, cz + H - 0.5, math.pi / 2), ("wall_straight", cx + H, cz + 1.5, math.pi / 2),
    ("wall_end_broken", cx + H, cz - 3.0, -math.pi / 2),
    ("wall_straight", cx + 3.0, cz - H, 0.0), ("wall_straight", cx - 1.0, cz - H, 0.0),
    ("wall_corner_broken", cx - H + 0.5, cz - H, math.pi), ("rubble_split", cx - H, cz - 2.5, 2.1),
    ("wall_end_broken", cx - H, cz + 1.0, math.pi / 2), ("rubble_split", cx - H - 1.2, cz + 3.4, 1.2),
    ("wall_straight", cx - 18.0, cz + 8.0, 0.9),        # stray fallen field wall beside the route
    ("wall_end_broken", cx - 21.0, cz + 11.2, 0.9 + math.pi),
    ("rubble_split", -12.0, 16.8, 0.3), ("wall_end_broken", -15.5, 20.0, -0.6),  # west-bank ruin hint
]
for a, x, z, yaw in walls:
    add(a, x, z, yaw)

# procedural anchors (not library assets, recorded as exclusions / optional fields)
def clear_of_features(x, z, r):
    if d_route(x, z) < 1.2 + r + 0.4: return False
    if math.hypot(x - BEACON[0], z - BEACON[1]) < 3.6 + r: return False
    if math.hypot(x - GOAL[0], z - GOAL[1]) < 3.5 + r: return False
    for o in OBJECTS:
        if o["asset_id"].startswith("path"): continue
        if math.hypot(x - o["position_xyz"][0], z - o["position_xyz"][2]) < r + FOOT[o["asset_id"]] * 0.8:
            return False
    return True

TREE_ROUTE_CLEAR = 4.2  # canopy (~2.7 m radius) stays off the 2.4 m walking corridor
# 3. ruined orchard rows around the enclosure (gaps = lost trees)
for ix in range(-3, 4):
    for iz in range(-3, 4):
        x, z = cx + ix * 5.2 + rng.uniform(-0.4, 0.4), cz + iz * 5.2 + rng.uniform(-0.4, 0.4)
        if abs(ix) <= 1 and abs(iz) <= 1: continue
        if not (-39 < x < 39 and -39 < z < 39): continue
        if rng.random() < 0.3:
            if rng.random() < 0.5 and clear_of_features(x, z, 1.0): add("rubble_split", x, z, rng.uniform(0, 6.28), 0.7)
            continue
        if d_stream(x, z) < 5 or d_route(x, z) < TREE_ROUTE_CLEAR or not clear_of_features(x, z, 1.4): continue
        a = rng.choice(["apple_tree_mature_autumn", "apple_tree_mature", "apple_tree_mature_b", "apple_tree_young"])
        add(a, x, z, rng.uniform(0, 6.28), rng.uniform(0.9, 1.1))

# 4. woodland scatter (jittered grid, density by region)
def region_density(x, z):
    if math.hypot(x - SPAWN[0], z - SPAWN[1]) < 9: return 0.15   # open spawn meadow
    if d_stream(x, z) < 10: return 0.55                           # ravine banks
    if x - z < -8 and z < 20: return 0.75                          # west woodland
    if x - z > 8 and z > -10: return 0.7                           # east woodland
    return 0.4
for gx in range(-38, 39, 5):
    for gz in range(-38, 39, 5):
        x, z = gx + rng.uniform(-1.8, 1.8), gz + rng.uniform(-1.8, 1.8)
        roll = rng.random()
        if roll > region_density(x, z): continue
        if math.hypot(x - RUIN_C[0], z - RUIN_C[1]) < 19: continue
        if d_stream(x, z) < 3.4 or d_route(x, z) < TREE_ROUTE_CLEAR or not clear_of_features(x, z, 1.0): continue
        a = rng.choices(["apple_tree_mature", "apple_tree_mature_b", "apple_tree_young", "apple_tree_mature_autumn"],
                        [4, 4, 3, 1])[0]
        add(a, x, z, rng.uniform(0, 6.28), rng.uniform(0.85, 1.2))

# 5. route-side undergrowth: shrubs + hedges just outside clearance, alternating sides
for i, (x, z, yaw) in enumerate(resample(ROUTE[:7], 3.1) + resample(ROUTE[7:], 3.1)):
    side = 1 if (i * 7 + 3) % 5 < 2 else -1
    off = rng.uniform(2.3, 3.4)
    px, pz = x + side * math.cos(yaw) * off, z - side * math.sin(yaw) * off
    if math.hypot(x, z) < 8: continue
    r = rng.random()
    if r < 0.45 and clear_of_features(px, pz, 0.75): add("shrub_flowering", px, pz, rng.uniform(0, 6.28), rng.uniform(0.9, 1.3))
    elif r < 0.62:
        px2, pz2 = x + side * math.cos(yaw) * (off + 0.6), z - side * math.sin(yaw) * (off + 0.6)
        if clear_of_features(px2, pz2, 1.0): add("hedge_dense", px2, pz2, yaw + math.pi / 2, 1.0)
    elif r < 0.8 and clear_of_features(px, pz, 0.5): add("rock_mossy_small", px, pz, rng.uniform(0, 6.28), rng.uniform(0.9, 1.5))

# 6. boulders along the banks and scattered
for x, z, yaw in resample(STREAM_IN, 3.4):
    for side in (-1, 1):
        if rng.random() < 0.45: continue
        off = rng.uniform(3.0, 4.6)
        px, pz = x + side * math.cos(yaw) * off, z - side * math.sin(yaw) * off
        if not (-39 < px < 39 and -39 < pz < 39): continue
        if abs(px) < 7 and abs(pz) < 7 and d_route(px, pz) < 4: continue
        a = "rock_mossy" if rng.random() < 0.55 else "rock_mossy_small"
        if clear_of_features(px, pz, FOOT[a] * 1.3): add(a, px, pz, rng.uniform(0, 6.28), rng.uniform(1.0, 1.9), dy=-0.1)
for _ in range(26):
    x, z = rng.uniform(-37, 37), rng.uniform(-37, 37)
    if d_stream(x, z) > 5 and clear_of_features(x, z, 1.4):
        add("rock_mossy", x, z, rng.uniform(0, 6.28), rng.uniform(1.3, 2.4), dy=-0.15)
# bank shrubs
for x, z, yaw in resample(STREAM, 5.0):
    px, pz = x + rng.uniform(-6, 6), z + rng.uniform(-6, 6)
    if -39 < px < 39 and -39 < pz < 39 and d_stream(px, pz) > 3.6 and clear_of_features(px, pz, 0.8):
        add(rng.choice(["shrub_flowering", "hedge_dense"]), px, pz, rng.uniform(0, 6.28), rng.uniform(0.9, 1.2))

# 7. backdrop cliffs (ravine walls, kept in corners well away from the route)
add("mountain_cliff_chunk", -35.0, -37.5, 0.35, 0.26, dy=-2.0)
add("mountain_cliff_chunk", 34.0, 37.0, 3.6, 0.22, dy=-2.0)

# -------------------------------------------------------------- verification
def route_samples(step=0.5):
    pts = []
    for i in range(len(ROUTE) - 1):
        (ax, az), (bx, bz) = ROUTE[i], ROUTE[i + 1]
        n = max(1, int(math.hypot(bx - ax, bz - az) / step))
        pts += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n, i) for k in range(n)]
    return pts
BRIDGE_SEG = len(PATH_WEST) - 1

def seg_intersect(p1, p2, q1, q2):
    def cr(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    return cr(p1, p2, q1) * cr(p1, p2, q2) <= 0 and cr(q1, q2, p1) * cr(q1, q2, p2) <= 0
crossings = [(i, j) for i in range(len(ROUTE) - 1) for j in range(len(STREAM) - 1)
             if seg_intersect(ROUTE[i], ROUTE[i + 1], STREAM[j], STREAM[j + 1])]
max_grade, prev = 0.0, None
for x, z, i in route_samples():
    if i == BRIDGE_SEG: prev = None; continue
    h = height(x, z)
    if prev: max_grade = max(max_grade, abs(h - prev[2]) / max(1e-6, math.hypot(x - prev[0], z - prev[1])))
    prev = (x, z, h)
min_clear = min(poly_dist((o["position_xyz"][0], o["position_xyz"][2]), ROUTE) - FOOT[o["asset_id"]] * 0.8
                for o in OBJECTS if not o["asset_id"].startswith("path"))
route_len = sum(math.hypot(ROUTE[i + 1][0] - ROUTE[i][0], ROUTE[i + 1][1] - ROUTE[i][1]) for i in range(len(ROUTE) - 1))
CHECKS = {"route_stream_crossings": len({c[0] for c in crossings}), "crossing_segment_is_bridge": all(c[0] == BRIDGE_SEG for c in crossings),
          "route_max_grade_off_bridge": round(max_grade, 3), "route_length_m": round(route_len, 1),
          "min_object_edge_to_route_centre_m": round(min_clear, 2), "stream_water_width_m": round(channel_width(), 2),
          "bridge_end_stream_distance_m": [round(d_stream(*BRIDGE_A), 2), round(d_stream(*BRIDGE_B), 2)]}
for o in OBJECTS:
    if not o["asset_id"].startswith("path") and poly_dist((o["position_xyz"][0], o["position_xyz"][2]), ROUTE) - FOOT[o["asset_id"]] * 0.8 < 1.2:
        print("CLEARANCE_FAIL", o)
print("CHECKS", json.dumps(CHECKS))

# ---------------------------------------------------------------- world_spec
def buffer_poly(pts, w):
    """Closed polygon offset around an open polyline (mitred, simple)."""
    left, right = [], []
    for i, (x, z) in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        nx, nz = -dz / L, dx / L
        left.append([round(x + nx * w, 2), round(z + nz * w, 2)]); right.append([round(x - nx * w, 2), round(z - nz * w, 2)])
    return left + right[::-1]

BRIDGE_W, BRIDGE_WALK = 4.4, 3.4
BRIDGE_LEN = math.hypot(BRIDGE_B[0] - BRIDGE_A[0], BRIDGE_B[1] - BRIDGE_A[1]) + 1.6
BRIDGE_YAW = math.atan2(BRIDGE_B[0] - BRIDGE_A[0], BRIDGE_B[1] - BRIDGE_A[1])
bridge_axis = ((BRIDGE_B[0] - BRIDGE_A[0]) / 12.0, (BRIDGE_B[1] - BRIDGE_A[1]) / 12.0)
bridge_bounds = buffer_poly([
    [BRIDGE_A[0] - bridge_axis[0] * 0.8, BRIDGE_A[1] - bridge_axis[1] * 0.8],
    [BRIDGE_B[0] + bridge_axis[0] * 0.8, BRIDGE_B[1] + bridge_axis[1] * 0.8],
], BRIDGE_W / 2 + 0.4)
spec = {
    "version": 1, "variant": "A", "method": "Opus written-brief direct 3D baseline (no 2D reference)", "seed": SEED,
    "bounds_m": [80, 80], "spawn_xz": list(SPAWN), "goal_xz": list(GOAL),
    "path_xz": [list(p) for p in ROUTE],
    "stream": {"points_xz": [list(p) for p in STREAM], "width_m": CHECKS["stream_water_width_m"]},
    "crossing": {"center_xz": [0.0, 0.0], "width_m": BRIDGE_W, "length_m": round(BRIDGE_LEN, 2), "yaw_rad": round(BRIDGE_YAW, 4)},
    "terrain": {"base_y": BASE_Y, "gaussian_coefficient": 1.0,
                "stream_carve": {"kind": "valley_channel", "valley_depth_m": VALLEY_DEPTH,
                                  "valley_radius_m": VALLEY_R, "channel_depth_m": CH_DEPTH,
                                  "channel_smoothstep_m": [CH_IN, CH_OUT], "water_below_ground_m": WATER_BELOW},
                "hills": [{"center_xz": list(c), "radius_m": r, "amplitude_m": a} for c, r, a in HILLS]},
    "regions": [
        {"name": "spawn_meadow", "surface": "grass", "polygon_xz": [[-40, 20], [-22, 20], [-22, 40], [-40, 40]], "tree_density": 0.15},
        {"name": "west_woodland", "surface": "grass", "polygon_xz": [[-40, -40], [-4, -40], [-40, 30]], "tree_density": 0.75},
        {"name": "east_woodland", "surface": "grass", "polygon_xz": [[40, 40], [40, -10], [8, 40]], "tree_density": 0.7},
        {"name": "ravine_stream", "surface": "water", "polygon_xz": buffer_poly(STREAM, CHECKS["stream_water_width_m"] / 2), "tree_density": 0.0},
        {"name": "ravine_banks", "surface": "grass", "polygon_xz": buffer_poly(STREAM, 10.0), "tree_density": 0.55},
        {"name": "route", "surface": "dirt_path", "polygon_xz": buffer_poly(ROUTE, 1.2), "tree_density": 0.0},
        {"name": "ruined_orchard", "surface": "grass", "polygon_xz": [[9, -12], [40, -12], [40, -40], [9, -40]], "tree_density": 0.5},
        {"name": "beacon_court", "surface": "stone", "polygon_xz": [[cx - H, cz - H], [cx + H, cz - H], [cx + H, cz + H], [cx - H, cz + H]], "tree_density": 0.0},
    ],
    "objects": OBJECTS,
    "exclusions": [
        {"kind": "polygon", "name": "route_clearance", "polygon_xz": buffer_poly(ROUTE, 1.2)},
        {"kind": "polygon", "name": "stream_water", "polygon_xz": buffer_poly(STREAM, CHECKS["stream_water_width_m"] / 2)},
        {"kind": "polygon", "name": "bridge", "polygon_xz": bridge_bounds},
        {"kind": "circle", "name": "beacon", "center_xz": list(BEACON), "radius_m": 3.2},
        {"kind": "circle", "name": "goal_plaza", "center_xz": list(GOAL), "radius_m": 3.0},
        {"kind": "circle", "name": "spawn", "center_xz": list(SPAWN), "radius_m": 3.0},
    ],
    "provenance": {"source_image": None, "source_plan": "input/benchmark.json + input/CONTRACT.md + written task brief",
                   "tools": ["Blender 4.5.13", "output/build_scene.py"], "model": "claude-opus-5-5",
                   "measured_time_s": None},
    "a_procedural": {
        "hill_formula": "amplitude_m * exp(-(d/radius_m)^2)",
        "ravine": {"valley_depth_m": VALLEY_DEPTH, "valley_radius_m": VALLEY_R, "channel_depth_m": CH_DEPTH,
                   "channel_smoothstep_m": [CH_IN, CH_OUT], "water_below_ground_m": WATER_BELOW},
        "bridge": {"end_a_xz": [round(v, 3) for v in BRIDGE_A], "end_b_xz": [round(v, 3) for v in BRIDGE_B],
                   "walkable_width_m": BRIDGE_WALK, "arch_rise_m": 0.7, "material": "stone"},
        "beacon": {"center_xz": list(BEACON), "height_m": 8.6, "plinth_m": 4.0},
        "path_piece_scale": PATH_SCALE, "checks": CHECKS},
}

# ------------------------------------------------------------ Blender scene
def B(x, y, z): return Vector((x, -z, y))  # Godot -> Blender

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

def mat(name, rgb, rough=0.85, emit=None, alpha=None, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (*rgb, 1); bs.inputs["Roughness"].default_value = rough
    if vcol:
        n = m.node_tree.nodes.new("ShaderNodeVertexColor"); n.layer_name = "Col"
        m.node_tree.links.new(n.outputs["Color"], bs.inputs["Base Color"])
    if emit:
        bs.inputs["Emission Color"].default_value = (*emit, 1); bs.inputs["Emission Strength"].default_value = 6.0
    if alpha is not None:
        bs.inputs["Alpha"].default_value = alpha; m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
        bs.inputs["Metallic"].default_value = 0.0; bs.inputs["Roughness"].default_value = 0.08
    return m

def mesh_obj(name, verts, faces, material, cols=None):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    for p in me.polygons: p.use_smooth = False
    if cols:
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
        for i, c in enumerate(cols): ca.data[i].color = (*c, 1)
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me); scn.collection.objects.link(ob); return ob

# terrain (0.5 m grid, vertex-coloured)
N, S = 161, 0.5
def lerp3(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
def hash01(x, z): return (math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1.0
GRASS, GRASS2, DIRT, MUD, MOSS = (0.32, 0.47, 0.18), (0.42, 0.55, 0.22), (0.55, 0.37, 0.2), (0.3, 0.25, 0.18), (0.22, 0.36, 0.16)
verts, cols = [], []
for j in range(N):
    for i in range(N):
        x, z = -40 + i * S, -40 + j * S
        h = height(x, z); verts.append(B(x, h, z))
        c = lerp3(GRASS, GRASS2, 0.5 * hash01(round(x), round(z)) + 0.5 * smoothstep(-1, 3, h) * 0.6)
        if region_density(x, z) >= 0.7: c = lerp3(c, MOSS, 0.45)
        c = lerp3(c, MUD, 1 - smoothstep(2.0, 3.6, d_stream(x, z)))
        c = lerp3(c, DIRT, 1 - smoothstep(1.1, 1.9, d_route(x, z)))
        if math.hypot(x - GOAL[0], z - GOAL[1]) < 3.0 or math.hypot(x - BEACON[0], z - BEACON[1]) < 4: c = lerp3(c, (0.45, 0.43, 0.38), 0.7)
        cols.append(tuple(v ** 2.2 for v in c))
faces = [(j * N + i, j * N + i + 1, (j + 1) * N + i + 1, (j + 1) * N + i) for j in range(N - 1) for i in range(N - 1)]
m_terrain = mat("terrain", (1, 1, 1), 0.95, vcol=True)
terrain = mesh_obj("Terrain", verts, faces, m_terrain, cols)

# water ribbon
m_water = mat("water", (0.13, 0.42, 0.55), alpha=0.82)
wv, wf, ww = [], [], channel_width() / 2 + 0.9
pts = []
for i in range(len(STREAM) - 1):
    (ax, az), (bx, bz) = STREAM[i], STREAM[i + 1]
    n = max(1, int(math.hypot(bx - ax, bz - az) / 1.0))
    pts += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(n)]
pts = [p for p in pts if -40 <= p[0] <= 40 and -40 <= p[1] <= 40]
for k, (x, z) in enumerate(pts):
    a = pts[max(0, k - 1)]; b = pts[min(len(pts) - 1, k + 1)]
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz); nx, nz = -dz / L, dx / L
    y = water_level(x, z)
    wv += [B(x + nx * ww, y, z + nz * ww), B(x - nx * ww, y, z - nz * ww)]
    if k: wf.append((2 * k - 2, 2 * k - 1, 2 * k + 1, 2 * k))
mesh_obj("Stream_Water", wv, wf, m_water)

# bridge: arched stone slab, parapets, abutments
m_stone = mat("bridge_stone", (0.3, 0.28, 0.25), 0.9)
m_dark = mat("stone_dark", (0.17, 0.16, 0.15), 0.95)
m_wood = mat("beam_wood", (0.36, 0.23, 0.13), 0.8)
m_fire = mat("beacon_fire", (1.0, 0.55, 0.15), 0.5, emit=(1.0, 0.45, 0.1))
m_cloth = mat("banner_cloth", (0.62, 0.12, 0.1), 0.9)

def box(bm, cx_, cy_, cz_, sx, sy, sz, yaw=0.0, tilt=0.0):
    """Box in Godot space, centre + half sizes, yaw around Y then built into bmesh (Blender coords)."""
    r = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in r:
        lx, ly, lz = v.co.x * 2 * sx, v.co.z * 2 * sy, -v.co.y * 2 * sz  # local godot
        ly2 = ly * math.cos(tilt) - lz * math.sin(tilt); lz2 = ly * math.sin(tilt) + lz * math.cos(tilt)
        gx = lx * math.cos(yaw) + lz2 * math.sin(yaw); gz = -lx * math.sin(yaw) + lz2 * math.cos(yaw)
        v.co = B(cx_ + gx, cy_ + ly2, cz_ + gz)

def bm_obj(name, bm, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(material)
    ob = bpy.data.objects.new(name, me); scn.collection.objects.link(ob); return ob

ya, yb = height(*BRIDGE_A), height(*BRIDGE_B)
fx, fz = math.sin(BRIDGE_YAW), math.cos(BRIDGE_YAW)       # forward along route
SEGS, RISE = 12, 0.7
def deck_y(t): return ya + (yb - ya) * t + RISE * math.sin(math.pi * t) + 0.08
L0 = BRIDGE_LEN
bm = bmesh.new()
for k in range(SEGS):
    t0, t1 = k / SEGS, (k + 1) / SEGS
    s0, s1 = -0.8 + t0 * L0, -0.8 + t1 * L0
    tm = (t0 + t1) / 2; sm = (s0 + s1) / 2
    y0, y1 = deck_y(max(0, min(1, (s0 + 0.0) / (L0 - 1.6)))), deck_y(max(0, min(1, s1 / (L0 - 1.6))))
    ym = (y0 + y1) / 2; tilt = math.atan2(y1 - y0, s1 - s0)
    px, pz = BRIDGE_A[0] + fx * sm, BRIDGE_A[1] + fz * sm
    box(bm, px, ym - 0.22, pz, BRIDGE_W / 2, 0.24, (s1 - s0) / 2 + 0.03, BRIDGE_YAW, -tilt)       # deck slab
    for side in (-1, 1):   # parapets (inner face at walkable half-width)
        ox, oz = math.cos(BRIDGE_YAW) * side * (BRIDGE_WALK / 2 + 0.25), -math.sin(BRIDGE_YAW) * side * (BRIDGE_WALK / 2 + 0.25)
        box(bm, px + ox, ym + 0.35, pz + oz, 0.25, 0.37, (s1 - s0) / 2 + 0.02, BRIDGE_YAW, -tilt)
bridge = bm_obj("Bridge_Deck", bm, m_stone)
bm = bmesh.new()
for (ex, ez), yy, sgn in ((BRIDGE_A, ya, -1), (BRIDGE_B, yb, 1)):  # abutments + end posts
    box(bm, ex - fx * sgn * 0.2, yy - 1.3, ez - fz * sgn * 0.2, BRIDGE_W / 2 + 0.3, 1.2, 1.1, BRIDGE_YAW)
    for side in (-1, 1):
        ox, oz = math.cos(BRIDGE_YAW) * side * (BRIDGE_WALK / 2 + 0.3), -math.sin(BRIDGE_YAW) * side * (BRIDGE_WALK / 2 + 0.3)
        box(bm, ex + ox - fx * sgn * 0.6, yy + 0.6, ez + oz - fz * sgn * 0.6, 0.35, 0.65, 0.35, BRIDGE_YAW)
# arch ribs under the deck (visible from the banks)
for k in range(SEGS):
    t0, t1 = (k + 0.5) / SEGS, (k + 1.5) / SEGS
    if t1 > 1: break
    yy = deck_y(t0) - 0.55 - 0.25 * math.sin(math.pi * t0)
    s = -0.8 + t0 * L0
    box(bm, BRIDGE_A[0] + fx * s, yy, BRIDGE_A[1] + fz * s, BRIDGE_W / 2 - 0.1, 0.12, L0 / SEGS / 2, BRIDGE_YAW)
bm_obj("Bridge_Abutments", bm, m_dark)

# beacon: stepped plinth, tapered octagonal tower, broken crown, brazier, banner
bx_, bz_ = BEACON; by = height(bx_, bz_) - 0.2
bm = bmesh.new()
box(bm, bx_, by + 0.3, bz_, 2.0, 0.35, 2.0, 0.3); box(bm, bx_, by + 0.85, bz_, 1.6, 0.25, 1.6, 0.3)
r = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=1.35, radius2=0.95, depth=6.4)["verts"]
for v in r: v.co = Vector((v.co.x + bx_, v.co.y - bz_, v.co.z + by + 1.1 + 3.2))
top = by + 7.5
for k in range(8):
    a = k * math.pi / 4 + 0.2
    hgt = [0.9, 0.5, 1.1, 0.0, 0.8, 0.3, 1.2, 0.6][k]
    if hgt: box(bm, bx_ + math.cos(a) * 1.05, top + hgt / 2, bz_ + math.sin(a) * 1.05, 0.28, hgt / 2, 0.28, -a)
box(bm, bx_, top + 0.1, bz_, 1.25, 0.12, 1.25, 0.2)
bm_obj("Beacon_Tower", bm, m_stone)
bm = bmesh.new()
r = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.35, radius2=0.8, depth=0.6)["verts"]
for v in r: v.co = Vector((v.co.x + bx_, v.co.y - bz_, v.co.z + top + 0.55))
box(bm, bx_ - 1.45, by + 5.6, bz_, 0.07, 1.4, 0.07)   # banner pole
bm_obj("Beacon_Brazier", bm, m_dark)
bm = bmesh.new(); r = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.55)["verts"]
for v in r: v.co = Vector((v.co.x * 0.9 + bx_, v.co.y * 0.9 - bz_, v.co.z * 1.6 + top + 1.2))
bm_obj("Beacon_Flame", bm, m_fire)
bm = bmesh.new(); box(bm, bx_ - 1.45, by + 5.9, bz_ + 0.55, 0.03, 0.9, 0.5); bm_obj("Beacon_Banner", bm, m_cloth)
light = bpy.data.lights.new("Beacon_Light", "POINT"); light.energy = 600; light.color = (1, 0.6, 0.25); light.shadow_soft_size = 0.5
lo = bpy.data.objects.new("Beacon_Light", light); lo.location = B(bx_, top + 1.3, bz_); scn.collection.objects.link(lo)
# goal plaza + spawn marker stones
bm = bmesh.new()
for k in range(10):
    a = k * math.tau / 10
    box(bm, GOAL[0] + math.cos(a) * 2.4, height(GOAL[0] + math.cos(a) * 2.4, GOAL[1] + math.sin(a) * 2.4) + 0.05,
        GOAL[1] + math.sin(a) * 2.4, 0.55, 0.08, 0.35, -a)
box(bm, SPAWN[0] - 1.8, height(SPAWN[0] - 1.8, SPAWN[1] + 1.2) + 0.6, SPAWN[1] + 1.2, 0.3, 0.7, 0.3, 0.4)  # waystone
bm_obj("Plaza_Stones", bm, m_dark)

# library import: join each GLB into one mesh, then linked copies
lib = {}
for aid in sorted({o["asset_id"] for o in OBJECTS}):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, aid + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    new_names = [o.name for o in new]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.data.name = aid
    lib[aid] = ob.data
    for nm in new_names:
        if nm in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)
coll = bpy.data.collections.new("Library_Instances"); scn.collection.children.link(coll)
for n, o in enumerate(OBJECTS):
    x, y, z = o["position_xyz"]
    ob = bpy.data.objects.new(f"{o['asset_id']}_{n:03d}", lib[o["asset_id"]])
    ob.location = B(x, y, z); ob.rotation_euler = (0, 0, o["yaw_rad"]); ob.scale = (o["scale"],) * 3
    coll.objects.link(ob)

# lighting / world / cameras
sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 3.2; sun.color = (1.0, 0.93, 0.8); sun.angle = 0.03
so = bpy.data.objects.new("Sun", sun); so.rotation_euler = (math.radians(52), 0, math.radians(-35)); scn.collection.objects.link(so)
world = bpy.data.worlds.new("Sky"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.33, 0.55, 0.92, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
scn.world = world

tris = sum(len(p.vertices) - 2 for ob in scn.objects if ob.type == "MESH" for p in ob.data.polygons)
spec["a_procedural"]["stats"] = {"instances": len(OBJECTS), "scene_triangles": tris,
                                  "asset_counts": {a: sum(1 for o in OBJECTS if o["asset_id"] == a) for a in lib}}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "scene.blend"), check_existing=False)
if os.path.exists(os.path.join(HERE, "scene.blend1")): os.remove(os.path.join(HERE, "scene.blend1"))
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "scene.glb"), export_format="GLB", export_lights=True)
t_build = time.perf_counter() - T0
spec["provenance"]["measured_time_s"] = {"build_export": round(t_build, 1)}

CAMS = json.load(open(os.path.join(REPO, "experiments", "visual-2d3d-20260928", "benchmark.json")))["evaluation_cameras"]
CAMS.append({"id": "unfamiliar_northwest", "position": [-22, 7.5, -16], "target": [3, 0.5, 2], "fov_deg": 60})
if "--no-render" not in ARGS:
    scn.render.engine = "BLENDER_EEVEE_NEXT"
    scn.eevee.taa_render_samples = 32
    scn.view_settings.view_transform = "AgX"
    cam_d = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_d); scn.collection.objects.link(cam)
    scn.camera = cam; cam_d.sensor_fit = "VERTICAL"; cam_d.clip_end = 400
    os.makedirs(os.path.join(HERE, "renders"), exist_ok=True)
    for c in CAMS:
        p, t = B(*c["position"]), B(*c["target"])
        cam.location = p
        up = Vector((0, 1, 0)) if c.get("north_up") else Vector((0, 0, 1))
        d = (t - p).normalized()
        cam.rotation_euler = d.to_track_quat("-Z", "Y" if not c.get("north_up") else "Y").to_euler()
        if c.get("north_up"): cam.rotation_euler = (0, 0, 0)  # straight down, north (-Z godot = +Y blender) up
        cam_d.angle = math.radians(c["fov_deg"])
        big = c["id"] == "overhead"
        scn.render.resolution_x, scn.render.resolution_y = (1024, 1024) if big else (1280, 720)
        scn.render.filepath = os.path.join(HERE, "renders", c["id"] + ".png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    spec["provenance"]["measured_time_s"]["renders"] = round(time.perf_counter() - T0 - t_build, 1)
spec["provenance"]["measured_time_s"]["total"] = round(time.perf_counter() - T0, 1)
json.dump(spec, open(os.path.join(HERE, "world_spec.json"), "w"), indent=1)
print("DONE", json.dumps(spec["provenance"]["measured_time_s"]), "tris", tris, "instances", len(OBJECTS))
