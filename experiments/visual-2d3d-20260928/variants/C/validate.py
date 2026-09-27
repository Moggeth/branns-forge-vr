"""Reimport validation: blender -b --factory-startup -P experiments/visual-2d3d-20260928/variants/C/validate.py
Re-imports scene.glb into an empty scene and checks it plus world_spec.json against
the benchmark. Writes validation.json beside this script."""
import bpy, json, math, os, time
from mathutils import Vector

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
bench = json.load(open(os.path.join(REPO, "experiments", "visual-2d3d-20260928", "benchmark.json")))
spec = json.load(open(os.path.join(HERE, "world_spec.json")))
fg = bench["fixed_gameplay"]
res = {"checks": {}, "notes": []}


def chk(name, ok, val):
    res["checks"][name] = {"ok": bool(ok), "value": val}


# --- contract fields ---
req = ["version", "variant", "method", "seed", "bounds_m", "spawn_xz", "goal_xz", "path_xz", "stream", "crossing",
       "terrain", "regions", "objects", "exclusions", "provenance"]
chk("required_fields", all(k in spec for k in req), [k for k in req if k not in spec])
chk("hill_fields", all(set(h) >= {"center_xz", "radius_m", "amplitude_m"} for h in spec["terrain"]["hills"]) and "base_y" in spec["terrain"], len(spec["terrain"]["hills"]))
chk("region_fields", all(set(r) >= {"name", "surface", "polygon_xz", "tree_density"} for r in spec["regions"]), len(spec["regions"]))
allowed = set(bench["allowed_asset_ids"])
bad = [o["asset_id"] for o in spec["objects"] if o["asset_id"] not in allowed or "position_xyz" not in o]
chk("objects_allowed_ids", not bad, bad[:5])
surf_bad = [o for o in spec["objects"] if o["asset_id"].startswith("path_") and not (o.get("role") == "surface" and o["interactive"] is False)]
chk("path_tiles_marked_surface", not surf_bad, len(surf_bad))


def height(x, z):
    h = spec["terrain"]["base_y"]
    for hl in spec["terrain"]["hills"]:
        c = hl["center_xz"]; r = hl["radius_m"]
        h += hl["amplitude_m"] * math.exp(-((x - c[0]) ** 2 + (z - c[1]) ** 2) / (r * r))
    return h


def seg_dist(p, a, b):
    vx, vz = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vz * vz or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2))
    return math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t), t


def inter(a, b, c, d):
    def cr(o, p, q): return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    return cr(a, b, c) * cr(a, b, d) < 0 and cr(c, d, a) * cr(c, d, b) < 0


path = spec["path_xz"]; stream = spec["stream"]["points_xz"]; cr = spec["crossing"]
chk("spawn_goal", path[0] == fg["spawn_xz"] and path[-1] == fg["goal_xz"], [path[0], path[-1]])
n_x = sum(inter(a, b, c, d) for a, b in zip(path, path[1:]) for c, d in zip(stream, stream[1:]))
chk("single_stream_crossing", n_x == 1, n_x)
chk("crossing_within_8m", math.hypot(*cr["center_xz"]) <= 8, round(math.hypot(*cr["center_xz"]), 2))
chk("bridge_width", cr["width_m"] >= fg["bridge_min_walkable_width_m"], cr["width_m"])
chk("stream_width", 3.0 <= spec["stream"]["width_m"] <= 5.0, spec["stream"]["width_m"])
# bridge yaw agrees with the path segment that crosses the water
ends = cr["c_ends_xz"]
seg_yaw = math.atan2(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1])
chk("bridge_yaw_long_axis", abs(math.remainder(seg_yaw - cr["yaw_rad"], math.pi)) < 0.02, [round(seg_yaw, 3), cr["yaw_rad"]])
bridge_on_path = any(e in [[round(v, 3) for v in p] for p in path] for e in ends)
chk("bridge_on_path", bridge_on_path, ends)

# grade along route (excluding the bridge span itself, which is a structure)
worst = 0; worst_at = None
for a, b in zip(path, path[1:]):
    if [a, b] == ends: continue
    L = math.dist(a, b); n = max(2, int(L / 0.5))
    for i in range(n):
        p = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]
        q = [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n]
        g = abs(height(*q) - height(*p)) / (L / n)
        if g > worst: worst, worst_at = g, p
chk("route_grade", worst <= fg["terrain_max_route_grade"], [round(worst, 3), [round(v, 1) for v in worst_at]])

# route clearance: non-surface objects must not intrude on a 2.4 m corridor (1.2 m either side + footprint)
FOOT = {"apple_tree_mature": 0.5, "apple_tree_mature_b": 0.5, "apple_tree_mature_autumn": 0.5, "apple_tree_young": 0.35,
        "hedge_dense": 1.7, "shrub_flowering": 0.75, "rock_mossy": 0.75, "rock_mossy_small": 0.4, "rubble_split": 1.05,
        "wall_straight": 2.0, "wall_end_broken": 2.6, "wall_corner_broken": 2.0, "mountain_cliff_chunk": 5.0}
viol = []
for o in spec["objects"]:
    if o.get("role") == "surface": continue
    x, _, z = o["position_xyz"]
    d = min(seg_dist((x, z), a, b)[0] for a, b in zip(path, path[1:]))
    need = fg["route_min_clearance_m"] / 2 + FOOT.get(o["asset_id"], 1) * o["scale"]
    if d < need: viol.append([o["asset_id"], round(d, 2), round(need, 2)])
chk("route_clearance_2.4m", not viol, viol[:8])
# canopy headroom: mature tree canopies (r~2.7*scale) must not overhang the lane below 2.4 m (canopy base ~1.8 m)
over = []
for o in spec["objects"]:
    if "tree" in o["asset_id"] and "young" not in o["asset_id"]:
        x, _, z = o["position_xyz"]
        d = min(seg_dist((x, z), a, b)[0] for a, b in zip(path, path[1:]))
        if d < 1.2 + 2.7 * o["scale"] * 0.85: over.append([o["asset_id"], round(d, 2)])
chk("canopy_overhang", not over, over[:5])
inb = [o["asset_id"] for o in spec["objects"] if max(abs(o["position_xyz"][0]), abs(o["position_xyz"][2])) > 40]
chk("objects_in_bounds", not inb, inb)

# --- reimport the GLB ---
bpy.ops.wm.read_factory_settings(use_empty=True)
t = time.time()
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "scene.glb"))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = [round(min(p[i] for p in pts), 2) for i in range(3)]; mx = [round(max(p[i] for p in pts), 2) for i in range(3)]
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
res["reimport"] = {"seconds": round(time.time() - t, 2), "objects": len(bpy.data.objects), "mesh_objects": len(meshes),
                   "unique_meshes": len({o.data.name for o in meshes}), "triangles": tris,
                   "materials": len(bpy.data.materials), "bounds_blender_min": mn, "bounds_blender_max": mx,
                   "glb_bytes": os.path.getsize(os.path.join(HERE, "scene.glb"))}
chk("glb_footprint_80m_plus_canopy", -43 <= mn[0] and mx[0] <= 43 and -43 <= mn[1] and mx[1] <= 43, [mn, mx])  # edge canopies/water may overhang <=3 m
roots = [o for o in bpy.data.objects if o.parent is None and o.type == "EMPTY"]
chk("glb_prop_count_matches_spec", len(roots) == len(spec["objects"]), [len(roots), len(spec["objects"])])
for name in ["Terrain", "Brook_Water", "BeaconOrb"]:
    chk("glb_has_" + name, name in bpy.data.objects, name in bpy.data.objects)
# prop heights vs terrain function
worst = 0
for o in roots:
    sid = int(o.name.split("_")[-1].split(".")[0])
    so = spec["objects"][sid]
    worst = max(worst, abs(o.location.z - so["position_xyz"][1]), abs(o.location.x - so["position_xyz"][0]), abs(-o.location.y - so["position_xyz"][2]))
chk("glb_positions_match_spec", worst < 0.01, round(worst, 4))
res["all_ok"] = all(c["ok"] for c in res["checks"].values())
res["seconds"] = round(time.time() - T0, 2)
json.dump(res, open(os.path.join(HERE, "validation.json"), "w"), indent=1)
print("VALIDATION", res["all_ok"], json.dumps({k: v for k, v in res["checks"].items() if not v["ok"]}))
