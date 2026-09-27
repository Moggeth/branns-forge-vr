"""Build a self-contained local index with relative links to experiment evidence."""

from __future__ import annotations

import argparse
import html
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
REPO = EXP.parent.parent
CAMERAS = ("overhead", "approach", "crossing", "landmark", "reverse")
LABELS = {
    "A": "Direct 3D / written brief",
    "B": "Generated map → structured scene",
    "C": "2D references → specialist 3D",
    "D": "Seeded procedural baseline",
    "E": "Hybrid construction and correction",
}
RENDER_ROOTS = (
    "evidence/{variant}",
    "variants/{variant}/renders",
    "variants/{variant}/render",
    "variants/{variant}/evidence/renders",
    "renders/{variant}",
    "../../godot/experiments/visual_2d3d/renders/{variant}",
)
IMAGE_EXTS = (".png", ".webp", ".jpg", ".jpeg")


def link(path: Path | None) -> str | None:
    if path is None or not path.is_file():
        return None
    return Path(os.path.relpath(path, HERE)).as_posix()


def first_file(paths: list[Path]) -> Path | None:
    return next((path for path in paths if path.is_file()), None)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def find_render(variant: str, camera: str) -> Path | None:
    roots = [EXP / root.format(variant=variant) for root in RENDER_ROOTS]
    candidates = [root / (camera + ext) for root in roots for ext in IMAGE_EXTS]
    return first_file(candidates)


def build_data() -> dict:
    benchmark = read_json(EXP / "benchmark.json")
    if not isinstance(benchmark, dict):
        raise FileNotFoundError("Missing benchmark.json")
    camera_ids = [camera["id"] for camera in benchmark["evaluation_cameras"]]
    if camera_ids != list(CAMERAS):
        raise ValueError(f"Benchmark camera IDs changed: {camera_ids}")

    raw_metrics = read_json(EXP / "evaluation/metrics.json") or []
    if not isinstance(raw_metrics, list):
        raise ValueError("evaluation/metrics.json must be a list")
    metrics = {}
    for entry in raw_metrics:
        if not isinstance(entry, dict) or entry.get("variant") not in LABELS:
            continue
        source = str(entry.get("source", "")).replace("\\", "/")
        if source.endswith("/world_spec.json"):
            metrics[entry["variant"]] = entry

    source_paths = {
        "A": [("World specification", "variants/A/world_spec.json"), ("Specialist handoff", "variants/A/HANDOFF.md"), ("GLB validation", "variants/A/validation.json")],
        "B": [("Generated source map", "planning/artifacts/B/source_map.png"), ("Extracted plan preview", "planning/artifacts/B/plan_preview.png"), ("World specification", "planning/artifacts/B/world_spec.json"), ("Extraction report", "planning/artifacts/B/extraction_report.json")],
        "C": [("Environment reference board", "references/environment-board.png"), ("Bridge model sheet", "references/bridge-model-sheet.png"), ("Reference check", "references/REFERENCE-CHECK.md"), ("World specification", "variants/C/world_spec.json")],
        "D": [("World specification", "variants/D/world_spec.json"), ("Generator", "variants/D/generate.py"), ("Clearing edit", "variants/D/clearing-edit.json"), ("Edit metrics", "evaluation/edit-metrics.json")],
        "E": [("World specification", "variants/E/world_spec.json"), ("Correction notes", "variants/E/correction.md")],
    }
    variants = []
    for variant, label in LABELS.items():
        sources = [{"label": name, "href": link(EXP / rel), "kind": Path(rel).suffix.lower()} for name, rel in source_paths[variant]]
        renders = {camera: link(find_render(variant, camera)) for camera in CAMERAS}
        spec = first_file([EXP / f"variants/{variant}/world_spec.json", EXP / f"planning/artifacts/{variant}/world_spec.json"])
        variants.append({"id": variant, "label": label, "renders": renders, "sources": sources, "spec": link(spec), "metrics": metrics.get(variant)})

    return {
        "title": "Orchard Brook · 2D ↔ 3D evidence",
        "benchmark": {"id": benchmark["id"], "world": benchmark["world"], "cameras": benchmark["evaluation_cameras"]},
        "variants": variants,
        "edit_metrics": read_json(EXP / "evaluation/edit-metrics.json"),
        "a_glb_validation": read_json(EXP / "variants/A/validation.json"),
        "links": [{"label": name, "href": link(EXP / rel)} for name, rel in [
            ("Benchmark", "benchmark.json"), ("Shared contract", "CONTRACT.md"), ("Planning method", "planning/README.md"), ("Evaluation method", "evaluation/README.md"),
            ("Results and recommendations", "reports/RESULTS.md"), ("Reference-assisted bridge", "asset_trial/with_ref/review_three_quarter.png"),
            ("No-reference bridge", "asset_trial/no_ref/review_three_quarter.png"), ("2.5D probes", "probes/README.md"),
            ("160 m scaling capture", "evidence/scale/overhead.png")]],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate inputs and report coverage without writing HTML")
    args = parser.parse_args()
    started = time.perf_counter()
    data = build_data()
    coverage = {v["id"]: sum(bool(path) for path in v["renders"].values()) for v in data["variants"]}
    if not args.check:
        template = (HERE / "template.html").read_text(encoding="utf-8")
        payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
        output = template.replace("/*__DATA__*/", payload).replace("__TITLE__", html.escape(data["title"]))
        (HERE / "index.html").write_text(output, encoding="utf-8")
    print(json.dumps({"camera_coverage": coverage, "elapsed_seconds": round(time.perf_counter() - started, 3), "output": None if args.check else str(HERE / "index.html")}, indent=2))


if __name__ == "__main__":
    main()
