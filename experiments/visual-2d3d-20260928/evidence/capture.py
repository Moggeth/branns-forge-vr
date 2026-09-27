"""Freeze matched Godot evidence from ignored smoke runs into portable files."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

EXP = Path(__file__).resolve().parents[1]
REPO = EXP.parents[1]
RUNS = REPO / "godot/experiments/visual_2d3d"
VIEWS = ("overhead", "approach", "crossing", "landmark", "reverse")

for variant in "ABCDE":
    source = RUNS / f"{variant.lower()}_smoke"
    if not source.exists():
        print(f"SKIP {variant}: no Godot run")
        continue
    missing = [v for v in VIEWS if not (source / f"{v}.png").is_file()]
    if missing:
        raise RuntimeError(f"{variant} missing fixed renders: {missing}")
    data = json.loads((source / "metrics.json").read_text())
    if not data.get("valid") or data.get("render_status") != "complete":
        raise RuntimeError(f"{variant} render or validation incomplete")
    target = EXP / "evidence" / variant
    target.mkdir(parents=True, exist_ok=True)
    for view in VIEWS:
        shutil.copy2(source / f"{view}.png", target / f"{view}.png")
    data["spec_path"] = f"variants/{variant}/world_spec.json" if variant != "B" else "planning/artifacts/B/world_spec.json"
    data["scene_path"] = f"godot/experiments/visual_2d3d/{variant.lower()}_smoke/world.tscn (rebuildable)"
    data["captures"] = [f"evidence/{variant}/{view}.png" for view in VIEWS]
    data["benchmark_path"] = "benchmark.json"
    (target / "metrics.json").write_text(json.dumps(data, indent=2) + "\n")
    print(f"CAPTURED {variant} {len(VIEWS)} views; build={data['build_s']:.3f}s render={data['render_s']:.3f}s")
