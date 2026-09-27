"""Expand the compiler smoke fixture without changing its source plan."""
import argparse
import copy
import json
import math
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("sample_world_spec.json"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--width", type=float, default=160.0)
    parser.add_argument("--depth", type=float, default=160.0)
    args = parser.parse_args()
    spec = copy.deepcopy(json.loads(args.source.read_text(encoding="utf-8")))
    sx, sz = args.width / 80.0, args.depth / 80.0

    def xz(point: list[float]) -> list[float]:
        return [round(point[0] * sx, 4), round(point[1] * sz, 4)]

    spec["variant"] = f"scale_{int(args.width)}x{int(args.depth)}"
    spec["method"] = "synthetic bounds scaling fixture"
    spec["bounds_m"] = [args.width, args.depth]
    spec["spawn_xz"] = xz(spec["spawn_xz"])
    spec["goal_xz"] = xz(spec["goal_xz"])
    spec["path_xz"] = [xz(p) for p in spec["path_xz"]]
    spec["stream"]["points_xz"] = [xz(p) for p in spec["stream"]["points_xz"]]
    spec["crossing"]["center_xz"] = xz(spec["crossing"]["center_xz"])
    for hill in spec["terrain"]["hills"]:
        hill["center_xz"] = xz(hill["center_xz"])
        hill["radius_m"] = round(hill["radius_m"] * math.sqrt(sx * sz), 4)
    for region in spec["regions"]:
        region["polygon_xz"] = [xz(p) for p in region["polygon_xz"]]
    for item in spec["objects"]:
        key = "position_xyz" if "position_xyz" in item else "center_xyz"
        position = item[key]
        item[key] = [round(position[0] * sx, 4), position[1], round(position[2] * sz, 4)]
    for exclusion in spec["exclusions"]:
        if "center_xz" in exclusion:
            exclusion["center_xz"] = xz(exclusion["center_xz"])
            exclusion["radius_m"] = round(exclusion["radius_m"] * math.sqrt(sx * sz), 4)
        if "polygon_xz" in exclusion:
            exclusion["polygon_xz"] = [xz(p) for p in exclusion["polygon_xz"]]
    spec["provenance"] = {"source_plan": str(args.source), "tools": ["make_scale_fixture.py"], "model": None, "measured_time_s": None, "source_image": None}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
