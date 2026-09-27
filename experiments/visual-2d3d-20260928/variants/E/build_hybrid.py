"""Rebuild E from the saved image extraction and specialist C composition.

The source layout (path, stream, hills, clearings and 113 placed objects) is B.
Only selected C props are added, with repeatable clearance checks. This script
never invokes a model; 2D and Opus work are cached inputs.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parents[1]
B = EXP / "planning/artifacts/B/world_spec.json"
C = EXP / "variants/C/world_spec.json"
OUT = HERE / "world_spec.json"

RADII = {
    "apple_tree_mature": 1.0, "apple_tree_mature_b": 1.0,
    "apple_tree_young": 0.6, "apple_tree_mature_autumn": 1.0,
    "hedge_dense": 1.1, "shrub_flowering": 0.6,
    "rock_mossy": 0.8, "rock_mossy_small": 0.45,
    "rubble_split": 0.7, "wall_straight": 1.4,
    "wall_end_broken": 1.2, "wall_corner_broken": 1.4,
}
QUOTAS = {"tree": 36, "undergrowth": 22, "boulder": 12,
          "fallen_wall": 4, "ruin_wall": 3, "ruin_rubble": 3, "rubble": 2}


def dist_point_segment(p, a, b):
    vx, vz = b[0]-a[0], b[1]-a[1]
    q = max(0.0, min(1.0, ((p[0]-a[0])*vx+(p[1]-a[1])*vz) / max(vx*vx+vz*vz, 1e-9)))
    return math.hypot(p[0]-a[0]-q*vx, p[1]-a[1]-q*vz)


def dist_polyline(p, line):
    return min(dist_point_segment(p, a, b) for a, b in zip(line, line[1:]))


def ground(p, terrain):
    y = float(terrain.get("base_y", 0.0))
    coeff = float(terrain.get("gaussian_coefficient", 0.5))
    for h in terrain["hills"]:
        dx, dz = p[0]-h["center_xz"][0], p[1]-h["center_xz"][1]
        y += h["amplitude_m"]*math.exp(-coeff*(dx*dx+dz*dz)/h["radius_m"]**2)
    return y


def main():
    b_bytes, c_bytes = B.read_bytes(), C.read_bytes()
    b, c = json.loads(b_bytes), json.loads(c_bytes)
    spec = copy.deepcopy(b)
    spec["variant"] = "E"
    spec["method"] = "hybrid image-extracted layout + constrained C props + Opus bridge/beacon"
    spec["seed"] = 20260928
    spec["crossing"]["asset_glb"] = "res://assets/experimental_2d3d/bridge.glb"
    spec["landmark"] = {"asset_glb": "res://assets/experimental_2d3d/beacon.glb",
                        "position_xz": list(spec["goal_xz"]), "kind": "orchard_beacon"}
    spec["terrain"]["gaussian_coefficient"] = 0.5
    spec["hybrid"] = {"parent_plan": str(B.relative_to(EXP)),
                      "specialist_layout": str(C.relative_to(EXP)),
                      "parent_sha256": hashlib.sha256(b_bytes).hexdigest(),
                      "specialist_sha256": hashlib.sha256(c_bytes).hexdigest(),
                      "addition_quotas": QUOTAS, "correction": "frame empty route with compatible undergrowth and C-inspired props"}
    counts = Counter()
    original_count = len(spec["objects"])
    for source in c["objects"]:
        role = source.get("role", "")
        if role not in QUOTAS or counts[role] >= QUOTAS[role]:
            continue
        asset = source["asset_id"]
        if asset not in RADII:
            continue
        p3 = source["position_xyz"]
        p = (float(p3[0]), float(p3[2]))
        r = RADII[asset] * float(source.get("scale", 1.0))
        if max(abs(p[0]), abs(p[1])) > 38.5:
            continue
        if dist_polyline(p, spec["path_xz"]) < 2.4 + r:
            continue
        if dist_polyline(p, spec["stream"]["points_xz"]) < spec["stream"]["width_m"] / 2 + r + 0.6:
            continue
        if math.dist(p, spec["spawn_xz"]) < 4.0 + r or math.dist(p, spec["goal_xz"]) < 4.5 + r:
            continue
        if math.dist(p, spec["crossing"]["center_xz"]) < 3.4 + r:
            continue
        if any(math.dist(p, (o["position_xyz"][0], o["position_xyz"][2])) < r + RADII.get(o["asset_id"], 0.6) * float(o.get("scale", 1.0)) + 0.3
               for o in spec["objects"]):
            continue
        o = copy.deepcopy(source)
        o["position_xyz"][1] = round(ground(p, spec["terrain"]), 4)
        o["provenance_variant"] = "C"
        spec["objects"].append(o)
        counts[role] += 1
    spec["hybrid"]["original_image_derived_objects"] = original_count
    spec["hybrid"]["added_specialist_objects"] = dict(counts)
    spec["provenance"] = {
        "source_image": "planning/input/generated-map-source.png",
        "source_plan": "planning/artifacts/B/world_spec.json",
        "specialist_reference": "variants/C/world_spec.json",
        "specialist_assets": [spec["crossing"]["asset_glb"], spec["landmark"]["asset_glb"]],
        "tools": ["Python deterministic merge", "Godot common builder", "Blender asset extraction"],
        "model": "OpenAI image generation + claude-opus-5-5",
    }
    OUT.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"E_OBJECTS {original_count}+{sum(counts.values())}={len(spec['objects'])} additions={dict(counts)}")


if __name__ == "__main__":
    main()
