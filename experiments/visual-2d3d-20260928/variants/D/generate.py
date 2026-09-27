"""Deterministic, procedural-only Orchard Brook world_spec v1 generator."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BENCHMARK = json.loads((ROOT / "benchmark.json").read_text(encoding="utf-8"))


def distance_to_segment(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0]-a[0])*dx + (p[1]-a[1])*dz) / (dx*dx + dz*dz)))
    return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dz)


def distance_to_polyline(p, points):
    return min(distance_to_segment(p, a, b) for a, b in zip(points, points[1:]))


def stream_z(x, phase):
    # The crossing is anchored to the resulting channel rather than guessed.
    return 1.2 * math.sin(x / 9 + phase) + 0.45 * math.sin(x / 4.2 - phase)


def terrain_height(x, z, hills):
    return round(sum(h["amplitude_m"] * math.exp(-0.5 * (((x-h["center_xz"][0]) / h["radius_m"])**2 + ((z-h["center_xz"][1]) / h["radius_m"])**2)) for h in hills), 4)


def stable_rng(seed, label):
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def make_spec(seed=20260928, clearing_radius=6.0, crossing_x=0.0):
    started = time.perf_counter()
    phase = stable_rng(seed, "stream").uniform(-0.2, 0.2)
    stream = [[round(x, 3), round(stream_z(x, phase), 3)] for x in range(-40, 41, 2)]
    cz = round(stream_z(crossing_x, phase), 3)
    spawn, goal = BENCHMARK["fixed_gameplay"]["spawn_xz"], BENCHMARK["fixed_gameplay"]["goal_xz"]
    path = [spawn, [-22, 23], [-13, 14], [-6, 8], [crossing_x, round(cz+3.8, 3)], [crossing_x, round(cz-3.8, 3)], [7, -9], [16, -18], goal]
    hills = [
        {"center_xz": [-25, -15], "radius_m": 16, "amplitude_m": 1.2},
        {"center_xz": [25, 15], "radius_m": 20, "amplitude_m": 1.4},
        {"center_xz": [-18, 26], "radius_m": 15, "amplitude_m": 0.35},
    ]
    objects = []
    def add(identifier, asset, x, z, radius, interactive=False):
        yaw = round(stable_rng(seed, identifier+":yaw").uniform(-math.pi, math.pi), 4)
        objects.append({"id": identifier, "asset_id": asset, "position_xyz": [round(x, 3), terrain_height(x, z, hills), round(z, 3)], "yaw_rad": yaw, "scale": 1.0, "radius_m": radius, "interactive": interactive})

    # Stable cell-local randomness means a small clearing edit only removes local objects.
    tree_assets = ["apple_tree_mature", "apple_tree_mature_b", "apple_tree_young", "apple_tree_mature_autumn"]
    for ix in range(-5, 6):
        for iz in range(-5, 6):
            rng = stable_rng(seed, f"tree:{ix}:{iz}")
            if rng.random() > 0.67:
                continue
            x, z = ix * 7 + rng.uniform(-2.0, 2.0), iz * 7 + rng.uniform(-2.0, 2.0)
            asset = rng.choice(tree_assets)
            radius = 1.1 if asset == "apple_tree_young" else 1.55
            if abs(x) > 38-radius or abs(z) > 38-radius:
                continue
            if distance_to_polyline([x, z], path) < radius + 1.8:
                continue
            if distance_to_polyline([x, z], stream) < radius + 3.0:
                continue
            if math.hypot(x-goal[0], z-goal[1]) < clearing_radius + radius:
                continue
            if any(math.hypot(x-o["position_xyz"][0], z-o["position_xyz"][2]) < radius+o["radius_m"]+0.3 for o in objects):
                continue
            add(f"tree_{ix}_{iz}", asset, x, z, radius)

    for i, (x, z) in enumerate([(goal[0]-4, goal[1]-3), (goal[0]+4, goal[1]-3), (goal[0]+4, goal[1]+3)]):
        # Ruin pieces are decorative scene objects; footprints are conservative proxies.
        add(f"ruin_{i}", ["wall_end_broken", "wall_corner_broken", "wall_straight"][i], x, z, 0.8)
    for i, (x, z) in enumerate([(-30, -24), (-19, -25), (31, 20), (27, 11)]):
        add(f"rock_{i}", "rock_mossy_small", x, z, 0.65)
    objects.sort(key=lambda o: o["id"])

    return {
        "version": 1, "variant": "D", "method": "seeded procedural rules; no generated imagery",
        "seed": seed, "bounds_m": [80, 80], "spawn_xz": spawn, "goal_xz": goal,
        "path_xz": path, "stream": {"points_xz": stream, "width_m": 3.2},
        "crossing": {"center_xz": [crossing_x, cz], "width_m": 3.6, "length_m": 6.8, "yaw_rad": 0.0},
        "terrain": {"base_y": 0.0, "hills": hills},
        "regions": [
            {"name": "south_orchard", "polygon_xz": [[-40, 40], [40, 40], [40, 3], [-40, 3]], "surface": "grass", "tree_density": 0.18},
            {"name": "north_orchard", "polygon_xz": [[-40, -3], [40, -3], [40, -40], [-40, -40]], "surface": "grass", "tree_density": 0.18},
            {"name": "ruin_clearing", "polygon_xz": [[goal[0]-clearing_radius,goal[1]-clearing_radius],[goal[0]+clearing_radius,goal[1]-clearing_radius],[goal[0]+clearing_radius,goal[1]+clearing_radius],[goal[0]-clearing_radius,goal[1]+clearing_radius]], "surface": "earth", "tree_density": 0.0},
        ],
        "objects": objects,
        "exclusions": [
            {"name": "spawn_clearance", "kind": "circle", "center_xz": spawn, "radius_m": 2.0},
            {"name": "bridge_approach", "kind": "circle", "center_xz": [crossing_x, cz], "radius_m": 2.0},
        ],
        "procedural": {"phase": round(phase, 6), "clearing_radius_m": clearing_radius, "crossing_x_m": crossing_x, "object_footprint_note": "Declared trunk/stone/wall proxies, not measured GLB collider bounds"},
        "provenance": {"source_image": None, "source_plan": "authored rules in variants/D/generate.py", "tools": ["Python 3 standard library"], "model": "GPT-6 Sol", "measured_time_s": round(time.perf_counter()-started, 6)},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260928)
    ap.add_argument("--clearing-radius", type=float, default=6.0)
    ap.add_argument("--crossing-x", type=float, default=0.0)
    ap.add_argument("--output", type=Path, default=HERE / "world_spec.json")
    args = ap.parse_args()
    if args.clearing_radius < 4 or args.clearing_radius > 12 or abs(args.crossing_x) > 6:
        ap.error("clearing radius must be 4–12 m and crossing x within ±6 m")
    spec = make_spec(args.seed, args.clearing_radius, args.crossing_x)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    print(f"{args.output}: {len(spec['objects'])} objects; generation {spec['provenance']['measured_time_s']:.4f}s")


if __name__ == "__main__":
    main()
