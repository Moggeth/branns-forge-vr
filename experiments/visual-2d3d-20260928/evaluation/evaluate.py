"""Engine-independent, structured world_spec v1 checks and CSV/JSON metrics.

This validates declared geometry. Visual quality, actual GLB colliders and VR cost
require separate render/engine/headset evidence.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = json.loads((ROOT / "benchmark.json").read_text(encoding="utf-8"))
G = BENCHMARK["fixed_gameplay"]


def distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])


def segment_distance(p, a, b):
    dx, dz = b[0]-a[0], b[1]-a[1]
    q = dx*dx + dz*dz
    t = max(0., min(1., ((p[0]-a[0])*dx+(p[1]-a[1])*dz)/q)) if q else 0.
    return distance(p, [a[0]+t*dx, a[1]+t*dz])


def polyline_distance(p, line):
    return min(segment_distance(p, a, b) for a, b in zip(line, line[1:]))


def point_in_polygon(p, vertices):
    inside = False
    j = len(vertices)-1
    for i in range(len(vertices)):
        xi, zi = vertices[i]
        xj, zj = vertices[j]
        if (zi > p[1]) != (zj > p[1]) and p[0] < (xj-xi)*(p[1]-zi)/(zj-zi)+xi:
            inside = not inside
        j = i
    return inside


def intersects(a, b, c, d):
    def cross(u, v): return u[0]*v[1]-u[1]*v[0]
    r, s = [b[0]-a[0], b[1]-a[1]], [d[0]-c[0], d[1]-c[1]]
    den = cross(r, s)
    if abs(den) < 1e-9: return None
    ca = [c[0]-a[0], c[1]-a[1]]
    t, u = cross(ca, s)/den, cross(ca, r)/den
    if -1e-9 <= t <= 1+1e-9 and -1e-9 <= u <= 1+1e-9:
        return [a[0]+t*r[0], a[1]+t*r[1]]
    return None


def terrain_height(spec, x, z):
    terrain = spec["terrain"]
    height = terrain.get("base_y", terrain.get("base_height_m", 0.0))
    coefficient = terrain.get("gaussian_coefficient")
    if coefficient is None:
        declared_formula = spec.get("a_procedural", {}).get("hill_formula") or terrain.get("c_falloff")
        if declared_formula:
            if "exp(-(d/r" not in declared_formula.replace(" ", ""):
                return None
            coefficient = 1.0
        else:
            coefficient = 0.5
    if not isinstance(coefficient, (int, float)) or coefficient <= 0:
        return None
    for h in terrain.get("hills", []):
        radius = h["radius_m"]
        height += h["amplitude_m"] * math.exp(-coefficient * (((x-h["center_xz"][0])/radius)**2 + ((z-h["center_xz"][1])/radius)**2))
    ravine = spec.get("a_procedural", {}).get("ravine")
    if ravine:
        if not all(k in ravine for k in ("valley_depth_m", "valley_radius_m", "channel_depth_m", "channel_smoothstep_m")):
            return None
        ds = polyline_distance([x, z], spec["stream"]["points_xz"])
        height -= ravine["valley_depth_m"] * math.exp(-(ds / ravine["valley_radius_m"])**2)
        inner, outer = ravine["channel_smoothstep_m"]
        t = max(0.0, min(1.0, (ds-inner)/(outer-inner)))
        height -= ravine["channel_depth_m"] * (1-(t*t*(3-2*t)))
    return height


def object_role(obj):
    """Explicit role wins; orchard path assets have a narrow, safe inference."""
    if obj.get("role") == "surface" and obj["asset_id"] in ("path_straight", "path_curve30", "path_curve30_left"):
        return "path_surface", "declared"
    if obj.get("role") == "outcrop" and obj["asset_id"] == "mountain_cliff_chunk":
        return "terrain_feature", "declared"
    if obj.get("role"):
        return obj["role"], "declared"
    if obj["asset_id"] in ("path_straight", "path_curve30", "path_curve30_left"):
        return "path_surface", "asset_id_inferred"
    if obj["asset_id"] == "mountain_cliff_chunk":
        return "terrain_feature", "asset_id_inferred"
    return "obstacle", "default_inferred"


def semantic_hash(spec):
    clean = json.loads(json.dumps(spec))
    clean.get("provenance", {}).pop("measured_time_s", None)
    return hashlib.sha256(json.dumps(clean, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def evaluate(spec, source="<memory>"):
    failures, warnings = [], []
    required = ["version", "variant", "method", "seed", "bounds_m", "spawn_xz", "goal_xz", "path_xz", "stream", "crossing", "terrain", "regions", "objects", "exclusions", "provenance"]
    missing = [key for key in required if key not in spec]
    if missing:
        return {"source": source, "variant": spec.get("variant"), "pass": False, "failures": ["missing fields: " + ", ".join(missing)], "warnings": [], "metrics": {}}
    if spec["version"] != 1: failures.append("world_spec version is not 1")
    if spec["bounds_m"] != [80, 80]: failures.append("bounds differ from fixed benchmark")
    path = spec["path_xz"]
    stream = spec["stream"]["points_xz"]
    bridge = spec["crossing"]
    objects = spec["objects"]
    if len(path) < 2 or len(stream) < 2:
        return {"source": source, "variant": spec["variant"], "pass": False, "failures": ["path or stream has fewer than two points"], "warnings": [], "metrics": {}}
    if distance(path[0], spec["spawn_xz"]) > 0.01 or distance(path[-1], spec["goal_xz"]) > 0.01:
        failures.append("route endpoints do not match spawn/goal")
    if distance(spec["spawn_xz"], G["spawn_xz"]) > 0.01 or distance(spec["goal_xz"], G["goal_xz"]) > 0.01:
        failures.append("spawn/goal differ from benchmark")
    discontinuities = [i for i, (a, b) in enumerate(zip(path, path[1:])) if distance(a, b) < 0.01 or distance(a, b) > 20]
    if discontinuities: failures.append(f"degenerate or excessive path segment(s): {discontinuities}")
    out_of_bounds = [i for i, p in enumerate(path) if abs(p[0]) > 40 or abs(p[1]) > 40]
    if out_of_bounds: failures.append(f"path points outside bounds: {out_of_bounds}")
    crossings = []
    for a, b in zip(path, path[1:]):
        for c, d in zip(stream, stream[1:]):
            hit = intersects(a, b, c, d)
            if hit and not any(distance(hit, old) < 0.05 for old in crossings): crossings.append(hit)
    if len(crossings) != 1: failures.append(f"route crosses stream {len(crossings)} times; expected one")
    bridge_error = min((distance(p, bridge["center_xz"]) for p in crossings), default=None)
    if bridge_error is None or bridge_error > min(bridge["width_m"], bridge["length_m"])/2:
        failures.append("route/stream crossing is outside bridge footprint")
    if distance(bridge["center_xz"], G["crossing_neighbourhood_xz"]) > 8:
        failures.append("bridge outside allowed 8 m neighbourhood")
    if spec["stream"]["width_m"] < G["stream_min_width_m"]: failures.append("stream too narrow")
    if bridge["width_m"] < G["bridge_min_walkable_width_m"]: failures.append("bridge too narrow")
    if bridge["length_m"] < spec["stream"]["width_m"] + 1.5: failures.append("bridge does not span stream with bank overlap")
    # The path over the channel must run approximately with the long bridge axis.
    crossing_segment = min(zip(path, path[1:]), key=lambda ab: segment_distance(bridge["center_xz"], *ab))
    segment_angle = math.atan2(crossing_segment[1][0]-crossing_segment[0][0], crossing_segment[1][1]-crossing_segment[0][1])
    angle_error = abs(math.atan2(math.sin(segment_angle-bridge["yaw_rad"]), math.cos(segment_angle-bridge["yaw_rad"])))
    angle_error = min(angle_error, abs(math.pi-angle_error))
    if angle_error > math.radians(25): failures.append("bridge long axis misaligned with traversing route")
    terrain_known = terrain_height(spec, *path[0]) is not None
    if not terrain_known: warnings.append("terrain modifier/formula unsupported; grounding and grade unknown")
    max_grade = 0.0 if terrain_known else None
    for a, b in zip(path, path[1:]):
        # A bridge deck is a separate structure; the terrain below it is not
        # the walking surface. Grade here means terrain grade off the bridge.
        if (a, b) == crossing_segment and bridge_error is not None and bridge_error < bridge["width_m"]/2:
            continue
        for n in range(10):
            t0, t1 = n/10, (n+1)/10
            p = [a[j]+t0*(b[j]-a[j]) for j in (0,1)]
            q = [a[j]+t1*(b[j]-a[j]) for j in (0,1)]
            if terrain_known:
                grade = abs(terrain_height(spec, *q)-terrain_height(spec, *p))/max(distance(p,q), 1e-9)
                max_grade = max(max_grade, grade)
    if max_grade is not None and max_grade > G["terrain_max_route_grade"]: failures.append("route terrain grade exceeds benchmark")
    actual_clearance = float("inf")
    placement_failures = 0
    ground_failures = 0
    inferred_path_surfaces = 0
    inferred_terrain_features = 0
    ground_contact_unknown = 0
    water_region_intrusions = 0
    water_buffer_conflicts = 0
    exclusion_role_exemptions = 0
    water_edge_contact_unverified = 0
    path_surfaces = 0
    known_radii = all("radius_m" in o for o in objects)
    if not known_radii: warnings.append("object radii absent; full clearance/collision checks unavailable")
    ids = [o.get("id") for o in objects if o.get("id") is not None]
    if len(ids) != len(set(ids)): failures.append("duplicate object IDs")
    for i, o in enumerate(objects):
        x, y, z = o["position_xyz"]
        r = o.get("radius_m", 0)
        role, role_source = object_role(o)
        if role == "path_surface": path_surfaces += 1
        if role == "path_surface" and role_source == "asset_id_inferred": inferred_path_surfaces += 1
        if role == "terrain_feature" and role_source == "asset_id_inferred": inferred_terrain_features += 1
        if o["asset_id"] not in BENCHMARK["allowed_asset_ids"]:
            failures.append(f"unsupported asset: {o['asset_id']}")
        if abs(x)+r > 40 or abs(z)+r > 40:
            placement_failures += 1
            failures.append(f"{o.get('id', i)} outside world bounds")
        # Cliff chunks are meshes deliberately sunk into terrain; their centre
        # Y is not a ground-contact point. A mesh/collider inspection is needed.
        if role == "terrain_feature":
            ground_contact_unknown += 1
        elif terrain_known and abs(y-terrain_height(spec, x, z)) > 0.2:
            placement_failures += 1
            ground_failures += 1
            failures.append(f"{o.get('id', i)} not grounded on declared terrain")
        clearance = polyline_distance([x,z], path)-r
        actual_clearance = min(actual_clearance, clearance)
        if known_radii and clearance < G["route_min_clearance_m"]/2:
            placement_failures += 1
            failures.append(f"{o.get('id', i)} intrudes into playable route")
        if known_radii and polyline_distance([x,z], stream) < spec["stream"]["width_m"]/2+r:
            placement_failures += 1
            failures.append(f"{o.get('id', i)} intersects water")
        for exclusion in spec["exclusions"]:
            kind = exclusion.get("kind", exclusion.get("type"))
            name = exclusion.get("name", exclusion.get("reason", "?"))
            if o.get("role") in exclusion.get("except_roles", []):
                overlaps = (kind == "circle" and distance([x,z], exclusion["center_xz"]) < exclusion["radius_m"]+r) or (kind == "polygon" and point_in_polygon([x,z], exclusion["polygon_xz"]))
                if overlaps:
                    exclusion_role_exemptions += 1
                    if any(region.get("name") == name and region.get("surface") == "water" for region in spec["regions"]):
                        water_edge_contact_unverified += 1
                continue
            # These named zones reserve a walkable route, so path surfacing
            # belongs there. All other exclusions still apply to path assets.
            if role == "path_surface" and name in ("route_clearance", "route_corridor", "spawn", "goal_plaza", "bridge"):
                continue
            if kind == "circle" and distance([x,z], exclusion["center_xz"]) < exclusion["radius_m"]+r:
                placement_failures += 1
                failures.append(f"{o.get('id', i)} intersects exclusion {name}")
            elif kind == "polygon" and point_in_polygon([x,z], exclusion["polygon_xz"]):
                placement_failures += 1
                water_region = next((region for region in spec["regions"] if region.get("name") == name and region.get("surface") == "water" and "polygon_xz" in region), None)
                if water_region:
                    if point_in_polygon([x,z], water_region["polygon_xz"]):
                        water_region_intrusions += 1
                        failures.append(f"{o.get('id', i)} inside exclusion {name} (inside declared water region)")
                    else:
                        water_buffer_conflicts += 1
                        failures.append(f"{o.get('id', i)} inside exclusion {name} (bank buffer, outside declared water region)")
                else:
                    failures.append(f"{o.get('id', i)} inside exclusion {name}")
            elif kind not in ("circle", "polygon"):
                warnings.append(f"unknown exclusion kind {kind}; not evaluated")
        for other in objects[:i]:
            if known_radii and distance([x,z], [other["position_xyz"][0], other["position_xyz"][2]]) < r+other["radius_m"]-0.05:
                placement_failures += 1
                failures.append(f"{o.get('id', i)} overlaps {other.get('id', '?')}")
    if ground_contact_unknown:
        warnings.append(f"{ground_contact_unknown} terrain feature centres embedded in ground; mesh contact unknown")
    if water_edge_contact_unverified:
        warnings.append(f"{water_edge_contact_unverified} declared role exemptions near water; mesh-water contact unverified")
    metrics = {
        "object_count": len(objects), "path_length_m": round(sum(distance(a,b) for a,b in zip(path,path[1:])), 3),
        "stream_crossing_count": len(crossings), "bridge_crossing_error_m": round(bridge_error, 3) if bridge_error is not None else None,
        "max_route_grade": round(max_grade, 4) if max_grade is not None else None, "min_object_route_clearance_m": round(actual_clearance, 3) if objects and known_radii else None,
        "placement_failure_count": placement_failures, "grounding_failure_count": ground_failures,
        "ground_contact_unknown_count": ground_contact_unknown,
        "water_region_intrusion_count": water_region_intrusions, "water_buffer_conflict_count": water_buffer_conflicts,
        "exclusion_role_exemption_count": exclusion_role_exemptions, "water_edge_contact_unverified_count": water_edge_contact_unverified,
        "terrain_height_evaluated": terrain_known, "terrain_gaussian_coefficient": spec["terrain"].get("gaussian_coefficient", 1.0 if spec.get("a_procedural", {}).get("hill_formula") or spec["terrain"].get("c_falloff") else 0.5),
        "terrain_model": "declared ravine carve and hills" if spec.get("a_procedural", {}).get("ravine") else "Gaussian hills",
        "path_surface_count": path_surfaces, "inferred_path_surface_count": inferred_path_surfaces, "inferred_terrain_feature_count": inferred_terrain_features,
        "object_radii_declared": known_radii,
        "semantic_sha256": semantic_hash(spec), "engine_collision_verified": False, "visual_quality_verified": False, "vr_performance_verified": False,
    }
    return {"source": source, "variant": spec["variant"], "seed": spec["seed"], "pass": not failures, "failures": failures, "warnings": warnings, "metrics": metrics}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("specs", nargs="+", type=Path)
    ap.add_argument("--json", type=Path, default=ROOT / "evaluation" / "metrics.json")
    ap.add_argument("--csv", type=Path, default=ROOT / "evaluation" / "metrics.csv")
    args = ap.parse_args()
    results = [evaluate(json.loads(p.read_text(encoding="utf-8")), str(p)) for p in args.specs]
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(results, indent=2)+"\n", encoding="utf-8")
    fields = ["source", "variant", "seed", "pass", "failure_count", "warning_count", "object_count", "path_length_m", "stream_crossing_count", "bridge_crossing_error_m", "max_route_grade", "min_object_route_clearance_m", "placement_failure_count", "grounding_failure_count", "ground_contact_unknown_count", "water_region_intrusion_count", "water_buffer_conflict_count", "exclusion_role_exemption_count", "water_edge_contact_unverified_count", "terrain_height_evaluated", "terrain_gaussian_coefficient", "terrain_model", "path_surface_count", "inferred_path_surface_count", "inferred_terrain_feature_count", "object_radii_declared", "semantic_sha256", "engine_collision_verified", "visual_quality_verified", "vr_performance_verified"]
    with args.csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in results:
            writer.writerow({**{k: row.get(k) for k in fields}, **row["metrics"], "failure_count": len(row["failures"]), "warning_count": len(row["warnings"])})
    for row in results:
        print(f"{'PASS' if row['pass'] else 'FAIL'} {row['source']}: {len(row['failures'])} failures")
        for failure in row["failures"]: print("  " + failure)
    raise SystemExit(0 if all(r["pass"] for r in results) else 1)


if __name__ == "__main__": main()
