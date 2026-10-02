"""Offline browser-port inventory. Reads source/GLB headers; never starts the game.

Run: python scripts/web_readiness.py
Output: ignored logs/web-readiness.json plus measured logs/work-timing.csv.
Counts include diagnostics and unused assets; they are not a download manifest.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
import struct
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]


def glb_manifest(path: Path) -> dict:
    with path.open("rb") as stream:
        header = stream.read(12)
        magic, version, length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or length != path.stat().st_size:
            raise ValueError("Invalid GLB 2 header or file length")
        while stream.tell() < length:
            size, kind = struct.unpack("<II", stream.read(8))
            if size > length - stream.tell():
                raise ValueError("GLB chunk exceeds file length")
            if kind == 0x4E4F534A:
                return json.loads(stream.read(size))
            stream.seek(size, 1)
    raise ValueError("No GLB JSON chunk")


def inventory() -> dict:
    source = ROOT / "godot"
    # Exclude imports/cache: only authored source paths participate.
    files = sorted(p for p in source.rglob("*") if p.is_file() and ".godot" not in p.relative_to(source).parts)
    assets, errors = [], []
    for path in files:
        if path.suffix.lower() != ".glb":
            continue
        relative = path.relative_to(ROOT).as_posix()
        try:
            data = glb_manifest(path)
            assets.append({"path": relative, "bytes": path.stat().st_size,
                           "meshes": len(data.get("meshes", [])),
                           "skins": len(data.get("skins", [])),
                           "animation_clips": len(data.get("animations", [])),
                           "required_extensions": data.get("extensionsRequired", [])})
        except (OSError, ValueError, struct.error) as exc:
            errors.append({"path": relative, "error": str(exc)})
    return {
        "scope": "Authored godot/ files; counts include tests/unused content. Not a web-compatibility certification.",
        "source_counts": {ext: sum(p.suffix.lower() == ext for p in files) for ext in (".gd", ".gdshader", ".glb")},
        "glb_bytes": sum(a["bytes"] for a in assets),
        "skinned_glbs": sum(a["skins"] > 0 for a in assets),
        "animated_glbs": sum(a["animation_clips"] > 0 for a in assets),
        "required_extensions": sorted({e for a in assets for e in a["required_extensions"]}),
        "largest_glbs": sorted(assets, key=lambda a: (-a["bytes"], a["path"]))[:10],
        "assets": assets, "errors": errors,
    }


def main() -> int:
    started = time.perf_counter()
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    outcome = "failed"
    try:
        report = inventory()
        (logs / "web-readiness.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        outcome = "passed" if not report["errors"] else "asset-errors"
        print(json.dumps({k: v for k, v in report.items() if k != "assets"}, indent=2))
        return 0 if outcome == "passed" else 1
    except Exception:
        (logs / "web-readiness-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        raise
    finally:
        elapsed = round(time.perf_counter() - started, 6)
        with (logs / "work-timing.csv").open("a", newline="", encoding="utf-8") as target:
            csv.writer(target).writerow(["web-readiness-inventory", outcome, elapsed])
        print(f"WEB_READINESS {outcome} elapsed_seconds={elapsed}")


if __name__ == "__main__":
    raise SystemExit(main())
