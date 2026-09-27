"""Measure whether a targeted world_spec edit changes unrelated objects."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from evaluate import evaluate, semantic_hash


def compare(before, after):
    old = {o["id"]: o for o in before["objects"]}
    new = {o["id"]: o for o in after["objects"]}
    changed = sorted(k for k in old.keys() & new.keys() if old[k] != new[k])
    removed = sorted(old.keys()-new.keys())
    added = sorted(new.keys()-old.keys())
    goal = before["goal_xz"]
    edit_radius = after.get("procedural", {}).get("clearing_radius_m", 0)
    outside_changes = [k for k in changed+removed+added if math.dist((old.get(k) or new[k])["position_xyz"][::2], goal) > edit_radius+2]
    unchanged_path = before["path_xz"] == after["path_xz"]
    valid_before, valid_after = evaluate(before), evaluate(after)
    return {
        "edit": "expand ruin clearing", "old_radius_m": before.get("procedural", {}).get("clearing_radius_m"),
        "new_radius_m": edit_radius, "removed_object_ids": removed, "added_object_ids": added,
        "changed_object_ids": changed, "unrelated_object_changes": outside_changes,
        "unchanged_object_count": len(old.keys() & new.keys())-len(changed),
        "route_unchanged": unchanged_path, "before_pass": valid_before["pass"], "after_pass": valid_after["pass"],
        "before_sha256": semantic_hash(before), "after_sha256": semantic_hash(after),
        "targeted_edit_pass": bool(edit_radius > before.get("procedural", {}).get("clearing_radius_m", 0) and not outside_changes and unchanged_path and valid_before["pass"] and valid_after["pass"]),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("before", type=Path)
    ap.add_argument("after", type=Path)
    ap.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "edit-metrics.json")
    args = ap.parse_args()
    result = compare(json.loads(args.before.read_text(encoding="utf-8")), json.loads(args.after.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["targeted_edit_pass"] else 1)


if __name__ == "__main__": main()
