"""Reproducible, non-destructive asset build and import gate for Brann's Forge.

Usage: python scripts/asset_lab.py build assets/asset-lab/pilot/asset.json
       python scripts/asset_lab.py inspect assets/asset-lab/pilot/asset.json path/to/model.glb
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_BLENDER = ROOT / "tools/blender-4.5.13-windows-x64/blender.exe"
DEFAULT_GODOT = ROOT / "tools/godot/Godot_v4.7.2-stable_win64_console.exe"
IMPORT_SCRIPT = ROOT / "scripts/asset_lab_import.gd"
VALIDATOR = ROOT / "assets/asset-lab/validate-gltf.cjs"
VALIDATOR_MODULE = ROOT / "assets/asset-lab/node_modules/gltf-validator"


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def repo_path(value: str) -> pathlib.Path:
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"Path must stay in project: {value}")
    return path


def load_spec(path: pathlib.Path) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if spec.get("schema_version") != 1:
        raise ValueError("Asset spec must have schema_version: 1")
    asset_id = spec.get("asset_id", "")
    if not asset_id or not all(c.isalnum() or c in "_-" for c in asset_id):
        raise ValueError("asset_id must use letters, digits, underscore or hyphen")
    if spec.get("kind") not in {"prop", "weapon", "character", "environment"}:
        raise ValueError("kind must be prop, weapon, character or environment")
    if not isinstance(spec.get("limits"), dict):
        raise ValueError("limits object is required")
    if not isinstance(spec.get("required_nodes", []), list):
        raise ValueError("required_nodes must be a list")
    return spec


def inspect_glb(path: pathlib.Path, spec: dict) -> tuple[dict, list[str]]:
    """Check the packed container and game-facing structure without third-party deps."""
    data = path.read_bytes()
    errors: list[str] = []
    if len(data) < 20:
        raise ValueError("GLB is shorter than the header and first chunk")
    magic, version, length = struct.unpack_from("<III", data)
    if (magic, version, length) != (0x46546C67, 2, len(data)):
        raise ValueError("Invalid GLB magic, version or declared length")
    offset = 12
    chunks: list[tuple[int, bytes]] = []
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated GLB chunk header")
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + size > len(data):
            raise ValueError("Truncated GLB chunk")
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ValueError("GLB has no leading JSON chunk")
    doc = json.loads(chunks[0][1].decode("utf-8"))
    buffers = doc.get("buffers", [])
    images = doc.get("images", [])
    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    accessors = doc.get("accessors", [])
    materials = doc.get("materials", [])
    scenes = doc.get("scenes", [])
    if not scenes:
        errors.append("no scene")
    if any("uri" in buffer for buffer in buffers):
        errors.append("external buffer dependency")
    if any("uri" in image and not image["uri"].startswith("data:") for image in images):
        errors.append("external image dependency")
    names = [node.get("name", "") for node in nodes]
    for name in spec.get("required_nodes", []):
        if name not in names:
            errors.append(f"missing required node: {name}")
        elif names.count(name) > 1:
            errors.append(f"ambiguous required node: {name}")
    triangles = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                errors.append(f"non-triangle primitive in {mesh.get('name', 'unnamed mesh')}")
                continue
            index = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
            if not isinstance(index, int) or index >= len(accessors) or index < 0:
                errors.append("primitive has invalid index/POSITION accessor")
                continue
            count = accessors[index].get("count", 0)
            if count % 3:
                errors.append("triangle accessor count is not divisible by three")
            triangles += count // 3
    limits = spec["limits"]
    metrics = {"bytes": len(data), "triangles": triangles, "meshes": len(meshes),
               "materials": len(materials), "nodes": len(nodes), "images": len(images),
               "animations": len(doc.get("animations", []))}
    for key, actual in metrics.items():
        limit = limits.get("max_" + key)
        if limit is not None and actual > limit:
            errors.append(f"{key} {actual} exceeds limit {limit}")
    if not meshes or not triangles:
        errors.append("GLB has no triangle meshes")
    return {"metrics": metrics, "node_names": names, "sha256": sha256(path)}, errors


def run_logged(argv: list[str], log: pathlib.Path, timeout: int) -> tuple[int, float]:
    started = time.monotonic()
    with log.open("w", encoding="utf-8", errors="replace") as stream:
        stream.write("COMMAND: " + " ".join(argv) + "\n")
        stream.flush()
        try:
            result = subprocess.run(argv, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                    timeout=timeout, check=False)
            code = result.returncode
        except subprocess.TimeoutExpired:
            stream.write(f"\nTimed out after {timeout} s\n")
            code = 124
    return code, round(time.monotonic() - started, 3)


def godot_import(glb: pathlib.Path, output: pathlib.Path, godot: pathlib.Path) -> tuple[dict, list[str], dict]:
    scratch = output / "_godot_import"
    scratch.mkdir(parents=True, exist_ok=True)
    shutil.copy2(glb, scratch / "model.glb")
    shutil.copy2(IMPORT_SCRIPT, scratch / "check.gd")
    (scratch / "project.godot").write_text('config_version=5\n[application]\nconfig/name="Asset Lab Import"\n', encoding="utf-8")
    timing = {}
    import_argv = [str(godot), "--headless", "--xr-mode", "off", "--path", str(scratch), "--editor", "--import"]
    code, timing["godot_import_seconds"] = run_logged(import_argv, output / "godot-import.log", 90)
    import_log = (output / "godot-import.log").read_text(encoding="utf-8", errors="replace")
    if code or re.search(r"(?m)^(?:SCRIPT ERROR:|ERROR:)", import_log):
        return {}, [f"Godot import failed ({code}); see godot-import.log"], timing
    check_argv = [str(godot), "--headless", "--xr-mode", "off", "--path", str(scratch),
                  "--script", "res://check.gd"]
    code, timing["godot_check_seconds"] = run_logged(check_argv, output / "godot-check.log", 90)
    log = (output / "godot-check.log").read_text(encoding="utf-8", errors="replace")
    marker = "ASSET_LAB_IMPORT_RESULT "
    results = [line[len(marker):] for line in log.splitlines() if line.startswith(marker)]
    errors = []
    if code or not results or re.search(r"(?m)^(?:SCRIPT ERROR:|ERROR:)", log):
        errors.append(f"Godot scene check failed ({code}); see godot-check.log")
        return {}, errors, timing
    result = json.loads(results[-1])
    if result.get("errors"):
        errors.extend(result["errors"])
    return result, errors, timing


def khronos_validate(glb: pathlib.Path, output: pathlib.Path) -> tuple[dict, list[str], float]:
    node = shutil.which("node")
    if not node or not VALIDATOR_MODULE.is_dir():
        return {}, ["Khronos validator unavailable; run npm ci --prefix assets/asset-lab"], 0.0
    report_path = output / "khronos-report.json"
    code, seconds = run_logged([node, str(VALIDATOR), str(glb), str(report_path)],
                               output / "khronos-validator.log", 90)
    if not report_path.is_file():
        return {}, [f"Khronos validator failed ({code}); see khronos-validator.log"], seconds
    report = json.loads(report_path.read_text(encoding="utf-8"))
    issues = report.get("issues", {})
    summary = {key: issues.get(key, 0) for key in ("numErrors", "numWarnings", "numInfos", "numHints")}
    return summary, ([f"Khronos validator reported {summary['numErrors']} errors"] if code or summary["numErrors"] else []), seconds


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "inspect"])
    parser.add_argument("spec", type=pathlib.Path, help="Versioned asset spec JSON")
    parser.add_argument("glb", nargs="?", type=pathlib.Path, help="Existing GLB for inspect")
    parser.add_argument("--out", type=pathlib.Path, help="Review bundle directory (never the live game)")
    parser.add_argument("--blender", type=pathlib.Path, default=pathlib.Path(os.getenv("BRANN_BLENDER", DEFAULT_BLENDER)))
    parser.add_argument("--godot", type=pathlib.Path, default=pathlib.Path(os.getenv("BRANN_GODOT", DEFAULT_GODOT)))
    args = parser.parse_args()
    spec_path = args.spec.resolve()
    spec = load_spec(spec_path)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = (args.out or ROOT / "outputs/asset-lab" / spec["asset_id"] / stamp).resolve()
    if output == ROOT or output.is_relative_to(ROOT / "godot"):
        raise ValueError("Review output may not overwrite the playable game")
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    report: dict = {"schema_version": 1, "asset_id": spec["asset_id"], "kind": spec["kind"],
                    "spec": str(spec_path), "spec_sha256": sha256(spec_path),
                    "created_utc": datetime.now(timezone.utc).isoformat(), "output": str(output),
                    "checks": {}, "timings_seconds": {}, "errors": []}
    try:
        if not args.godot.is_file():
            raise FileNotFoundError(f"Godot missing: {args.godot}")
        if args.action == "build":
            if not args.blender.is_file():
                raise FileNotFoundError(f"Blender missing: {args.blender}")
            if not spec.get("builder"):
                raise ValueError("This spec has no builder; use inspect with an existing GLB")
            builder = repo_path(spec["builder"])
            if not builder.is_file():
                raise FileNotFoundError(f"Builder missing: {builder}")
            report["builder_sha256"] = sha256(builder)
            argv = [str(args.blender), "--background", "--factory-startup", "--python-exit-code", "2",
                    "--python", str(builder), "--", "--out", str(output)]
            code, elapsed = run_logged(argv, output / "blender-build.log", 300)
            report["timings_seconds"]["blender_build"] = elapsed
            if code:
                raise RuntimeError(f"Blender build failed ({code}); see blender-build.log")
            glb = output / "model.glb"
        else:
            if args.glb is None:
                parser.error("inspect requires a GLB path")
            glb = args.glb.resolve()
        if not glb.is_file():
            raise FileNotFoundError(f"GLB missing: {glb}")
        report["asset_file"] = str(glb)
        info, errors = inspect_glb(glb, spec)
        report["checks"]["glb"] = info
        report["errors"].extend(errors)
        if not errors:
            validated, errors, seconds = khronos_validate(glb, output)
            report["checks"]["khronos"] = validated
            report["timings_seconds"]["khronos_validation"] = seconds
            report["errors"].extend(errors)
        if not report["errors"]:
            imported, errors, timing = godot_import(glb, output, args.godot)
            report["checks"]["godot"] = imported
            report["timings_seconds"].update(timing)
            report["errors"].extend(errors)
            imported_names = imported.get("node_names", [])
            for name in spec.get("required_nodes", []):
                if name not in imported_names:
                    report["errors"].append(f"Godot lost required node: {name}")
            maximum = spec.get("max_dimensions_m")
            if maximum is not None:
                lo, hi = imported.get("bounds_min", []), imported.get("bounds_max", [])
                if len(maximum) != 3 or len(lo) != 3 or len(hi) != 3:
                    report["errors"].append("invalid or missing Godot dimensions")
                else:
                    for axis, size, limit in zip("XYZ", (hi[i] - lo[i] for i in range(3)), maximum):
                        if size > limit:
                            report["errors"].append(f"Godot {axis} size {size:.3f} m exceeds {limit} m")
        if args.action == "build":
            report["deliverables"] = {}
            for name in ["model.glb", *spec.get("review_files", [])]:
                deliverable = (output / name).resolve()
                if not deliverable.is_relative_to(output):
                    report["errors"].append(f"review deliverable escapes output: {name}")
                elif not deliverable.is_file():
                    report["errors"].append(f"missing review deliverable: {name}")
                else:
                    report["deliverables"][name] = {"bytes": deliverable.stat().st_size,
                                                     "sha256": sha256(deliverable)}
    except Exception as exc:
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        (output / "exception.log").write_text(traceback.format_exc(), encoding="utf-8")
    report["timings_seconds"]["total"] = round(time.monotonic() - started, 3)
    report["passed"] = not report["errors"]
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "output": str(output),
                      "metrics": report["checks"].get("glb", {}).get("metrics"),
                      "errors": report["errors"], "seconds": report["timings_seconds"]["total"]}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
