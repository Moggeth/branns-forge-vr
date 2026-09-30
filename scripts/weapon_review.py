"""One offline Godot batch -> deterministic weapon diagrams and alignment evidence.

No asset generation, service calls, XR session, player-save writes or live-game
control. Cached input hashes skip both rendering and packaging on repeat runs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
CATALOG = PROJECT / "godot/weapon_inspection_catalog.json"
ENGINE = PROJECT / "tools/godot/Godot_v4.7.2-stable_win64_console.exe"
VERSION = 1
# Same-device GPU rasterization can differ at a few reflective texture samples.
# Keep exact pose/source comparisons, plus a strict, disclosed pixel noise budget.
PIXEL_LIMITS = {"max_channel_delta": 8, "changed_fraction": 0.002, "max_rms": 0.08}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def fingerprints() -> tuple[str, dict]:
    """Hash content, with a stat-validated local digest index for a cheap cache hit.

    Source and imported asset families are authoritative. Exclude .godot/cache,
    runtime logs and timestamps from the fingerprint itself.
    """
    index_path = PROJECT / "logs/weapon-review-hashes.json"
    try:
        old = json.loads(index_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        old = {}
    paths = {Path(__file__), CATALOG, ENGINE}
    source_extensions = {".gd", ".gdshader", ".json", ".tscn", ".tres", ".godot"}
    for directory, children, files in os.walk(PROJECT / "godot"):
        children[:] = [name for name in children if name not in {".godot", ".git"}]
        for name in files:
            path = Path(directory) / name
            if path.suffix in source_extensions:
                paths.add(path)
    # Include textures as well as meshes; a material-only edit must invalidate.
    for relative in ("godot/weapons", "godot/guardians/assets", "godot/assets"):
        for directory, children, files in os.walk(PROJECT / relative):
            children[:] = [name for name in children if name != ".godot"]
            for name in files:
                path = Path(directory) / name
                if path.suffix.lower() in {".glb", ".gltf", ".bin", ".png", ".jpg", ".webp"}:
                    paths.add(path)
    index, digest = {}, hashlib.sha256()
    for path in sorted(paths):
        key = path.relative_to(PROJECT).as_posix()
        stat = path.stat()
        signature = [stat.st_size, stat.st_mtime_ns]
        previous = old.get(key, {})
        sha = previous.get("sha256") if previous.get("stat") == signature else None
        if sha is None:
            with path.open("rb") as handle:
                sha = hashlib.file_digest(handle, "sha256").hexdigest()
        index[key] = {"stat": signature, "sha256": sha}
        digest.update((key + "\0" + sha + "\n").encode())
    write_json(index_path, index)
    return digest.hexdigest(), {key: value["sha256"] for key, value in index.items()}


def package(folder: Path, report: dict) -> list[str]:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    font_path = Path("C:/Windows/Fonts/segoeui.ttf")
    def font(size):
        return ImageFont.truetype(str(font_path) if font_path.exists() else "DejaVuSans.ttf", size)
    titles = {"model": "Installed model", "left_hand": "Left VR hand", "right_hand": "Right VR hand",
              "desktop": "FPS pose", "holster-left": "Left holster", "holster-right": "Right holster"}
    products = []
    card, footer, header = 400, 64, 140
    for item in report["subjects"]:
        rows = math.ceil(len(item["views"]) / 4)
        sheet = Image.new("RGB", (card * 4, header + rows * (card + footer)), "#151b20")
        draw = ImageDraw.Draw(sheet)
        draw.text((24, 16), item["name"] + " / ORIENTATION REVIEW", font=font(32), fill="#f2eee4")
        draw.text((24, 65), "Actual game models and attachment paths · fixed cameras · neutral light", font=font(22), fill="#b6c0c8")
        draw.text((24, 101), "Orange: working axis   Cyan: pointing ray   |   Synthetic poses; headset comfort requires playtesting", font=font(18), fill="#b6c0c8")
        for n, view in enumerate(item["views"]):
            x, y = (n % 4) * card, header + (n // 4) * (card + footer)
            with Image.open(folder / view["file"]) as image:
                if image.size != tuple(view["resolution"]):
                    raise ValueError(f"Unexpected screenshot size: {view['file']} {image.size}")
                sheet.paste(ImageOps.pad(image.convert("RGB"), (card, card), method=Image.Resampling.LANCZOS, color="#363c43"), (x, y))
            draw.text((x + 12, y + card + 5), f"{n+1:02d} {titles.get(view['mode'], view['mode'])} · {view['view']}", font=font(17), fill="#f2eee4")
            if "forward_dot" in view:
                detail = f"Aim {view['forward_dot']:.3f} · Up {view['up_dot']:.3f}"
            elif "span_m" in view:
                detail = f"Orthographic span {view['span_m']:.2f} m"
            else:
                detail = f"Perspective FOV {view['fov_degrees']:.1f}° · actual FPS rest offset"
            draw.text((x + 12, y + card + 32), detail, font=font(15), fill="#aeb8c0")
        name = item["id"] + "/review-sheet.png"
        sheet.save(folder / name)
        products.append(name)
    small, rows = 440, math.ceil(len(report["subjects"]) / 4)
    overview = Image.new("RGB", (small * 4, 116 + rows * (small + 48)), "#151b20")
    draw = ImageDraw.Draw(overview)
    draw.text((24, 15), "BRANN'S FORGE / WEAPON GRIP AUDIT", font=font(36), fill="#f2eee4")
    draw.text((24, 70), f"{len(report['subjects'])} actual items · {report['pose_checks']} pose checks · {report['capture_checks']} captures · open individual sheets for all views", font=font(21), fill="#b6c0c8")
    for n, item in enumerate(report["subjects"]):
        x, y = (n % 4) * small, 116 + (n // 4) * (small + 48)
        view = next(v for v in item["views"] if v["mode"] == "right_hand" and v["view"] == "quarter")
        with Image.open(folder / view["file"]) as image:
            overview.paste(image.convert("RGB").resize((small, small), Image.Resampling.LANCZOS), (x, y))
        bad = any(f.startswith(item["id"] + " ") or f.startswith(item["id"] + ":") for f in report["failures"])
        draw.text((x + 12, y + small + 8), item["name"] + (" · CHECK" if bad else ""), font=font(19), fill="#ffbe66" if bad else "#f2eee4")
    overview.save(folder / "overview.png"); products.append("overview.png")
    (folder / "START-HERE.md").write_text(
        "# Actual-engine weapon review\n\nOpen overview.png, then each item's review-sheet.png. Original square PNGs are included. "
        "Model front is -Z, back +Z, left -X, right +X, top +Y and bottom -Y. Cameras are fixed; spans are recorded. "
        "VR fixtures use the actual articulated gloves and calibrated sockets, in a thumb-up, index-forward power grip. "
        "Orange is the independently declared working axis; cyan is the controller pointing ray. FPS/player uses the actual "
        "camera FOV and hand rest offset without reframing. Holsters use the actual scabbards and runtime transforms. "
        "The installed model alone does not establish interaction or headset comfort. See report.json for checks, limitations "
        "and source fingerprints. Saved user calibrations are deliberately excluded. No game saves were read or written.\n",
        encoding="utf-8")
    products.extend(["START-HERE.md", "report.json"])
    members = sorted(set(products + [v["file"] for item in report["subjects"] for v in item["views"]]))
    write_archive(folder, members)
    products = sorted(set(products + members + ["weapon-review.zip"]))
    return products


def write_archive(folder: Path, members: list[str]) -> None:
    with zipfile.ZipFile(folder / "weapon-review.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for member in members:
            archive.write(folder / member, member)
    with zipfile.ZipFile(folder / "weapon-review.zip") as archive:
        if archive.testzip(): raise ValueError("Review archive CRC failed")


def compare_pixels(before: bytes, after: bytes) -> dict:
    """Disclose byte equality separately from tightly bounded renderer noise."""
    from PIL import Image, ImageChops, ImageStat
    if before == after:
        return {"byte_identical": True, "within_tolerance": True}
    with Image.open(io.BytesIO(before)) as first, Image.open(io.BytesIO(after)) as second:
        if first.size != second.size:
            return {"byte_identical": False, "within_tolerance": False, "reason": "resolution changed"}
        difference = ImageChops.difference(first.convert("RGB"), second.convert("RGB"))
        channels = difference.split()
        maximum = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
        fraction = 1 - maximum.histogram()[0] / (first.width * first.height)
        delta = max(pair[1] for pair in difference.getextrema())
        rms = max(ImageStat.Stat(difference).rms)
        return {"byte_identical": False,
                "within_tolerance": delta <= PIXEL_LIMITS["max_channel_delta"]
                    and fraction <= PIXEL_LIMITS["changed_fraction"] and rms <= PIXEL_LIMITS["max_rms"],
                "changed_fraction": fraction, "max_channel_delta": delta, "max_rms": rms,
                "bounds": difference.getbbox()}


def verify_repeat(args, folder: Path, report: dict) -> dict:
    """Force a fresh engine run and compare pixels and semantic poses, not timers."""
    def snapshot(value):
        return {item["id"]: item["views"] for item in value["subjects"]}
    before = snapshot(report)
    images = {v["file"]: (folder / v["file"]).read_bytes()
              for item in report["subjects"] for v in item["views"]} if not args.check_only else {}
    command = [sys.executable, str(Path(__file__).resolve()), "--weapons", args.weapons,
               "--out", str(folder), "--size", str(args.size), "--timeout", str(args.timeout), "--force"]
    if args.check_only: command.append("--check-only")
    child = subprocess.run(command, cwd=PROJECT, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=args.timeout + 60,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    log = PROJECT / "logs" / ("weapon-review-repeat-" + time.strftime("%Y%m%d-%H%M%S") + ".log")
    log.write_text(child.stdout + child.stderr, encoding="utf-8")
    if child.returncode != 0: raise RuntimeError(f"Repeat run failed: {log}")
    after = json.loads((folder / "report.json").read_text(encoding="utf-8"))
    changed = [name for name, content in images.items() if hashlib.sha256((folder / name).read_bytes()).digest() != hashlib.sha256(content).digest()]
    differences = {name: compare_pixels(images[name], (folder / name).read_bytes()) for name in changed}
    for name in changed:
        reference = folder / "repeat-differences" / (name.removesuffix(".png") + "-before.png")
        reference.parent.mkdir(parents=True, exist_ok=True)
        reference.write_bytes(images[name])
        reference.with_name(reference.name.replace("-before", "-after")).write_bytes((folder / name).read_bytes())
    result = {"images": len(images), "changed_images": changed, "poses_identical": before == snapshot(after),
              "byte_identical": not changed, "source_sha256": report["source_sha256"],
              "sources_identical": report["source_sha256"] == after["source_sha256"],
              "pixel_limits": PIXEL_LIMITS, "differences": differences,
              "within_render_tolerance": all(value["within_tolerance"] for value in differences.values()),
              "scope": "same engine, renderer, machine and inputs"}
    result["passed"] = result["poses_identical"] and result["sources_identical"] and result["within_render_tolerance"]
    write_json(folder / "repeat.json", result)
    if not result["passed"]: raise RuntimeError(f"Non-deterministic inspection: {folder / 'repeat.json'}")
    return result


def main() -> int:
    started = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weapons", "--items", default="all", help="all, or comma-separated catalogue IDs")
    parser.add_argument("--out", "--output", type=Path, default=PROJECT / "outputs/weapon-review/latest")
    parser.add_argument("--size", type=int, default=768, choices=(512, 768, 1024, 1536))
    parser.add_argument("--check-only", action="store_true", help="Headless pose checks; no GPU images")
    parser.add_argument("--force", action="store_true", help="Ignore the output cache")
    parser.add_argument("--verify-repeat", action="store_true", help="Render twice; require identical poses/sources and images within disclosed GPU noise limits")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    if args.list:
        for item in catalog["subjects"]: print(item["id"] + "  " + item["name"])
        return 0
    wanted = set(args.weapons.split(","))
    subjects = catalog["subjects"] if wanted == {"all"} else [s for s in catalog["subjects"] if s["id"] in wanted]
    if wanted != {"all"} and wanted - {s["id"] for s in subjects}:
        parser.error("Unknown item IDs: " + ", ".join(sorted(wanted - {s['id'] for s in subjects})))
    if not ENGINE.is_file(): parser.error(f"Bundled Godot executable missing: {ENGINE}")
    folder = args.out.resolve(); folder.mkdir(parents=True, exist_ok=True)
    source_hash, sources = fingerprints()
    settings = {"version": VERSION, "size": args.size, "render": not args.check_only,
                "subjects": subjects, "source_sha256": source_hash, "engine": ENGINE.name}
    cache_key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
    report_path = folder / "report.json"
    manifest_path = folder / "cache.json"
    try: cache = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError): cache = {}
    if not args.force and not args.verify_repeat and cache.get("key") == cache_key and report_path.is_file() and all((folder / f).is_file() for f in cache.get("products", [])):
        report = json.loads(report_path.read_text(encoding="utf-8"))
        print(json.dumps({"cached": True, "seconds": round(time.perf_counter()-started, 3), "report": str(report_path), "failures": report["failures"]}))
        return 1 if report["failures"] else 0
    config = {"output": folder.as_posix(), "size": args.size, "render": not args.check_only,
              "subjects": subjects, "special_cases": catalog["special_cases"]}
    write_json(folder / "config.json", config)
    # No stale report may accidentally turn a crashed engine into a passing run.
    report_path.unlink(missing_ok=True); manifest_path.unlink(missing_ok=True)
    (folder / "repeat.json").unlink(missing_ok=True)
    log = PROJECT / "logs" / ("weapon-review-" + time.strftime("%Y%m%d-%H%M%S") + ".log")
    command = [str(ENGINE), "--xr-mode", "off", "--audio-driver", "Dummy", "--path", str(PROJECT / "godot")]
    command += ["--headless"] if args.check_only else ["--position", "-32000,-32000", "--resolution", "64x64", "--no-focus"]
    command += ["--script", "res://weapon_inspection.gd", "--", "--weapon-inspection", "--inspection-config=" + (folder / "config.json").as_posix()]
    with log.open("w", encoding="utf-8") as output:
        output.write(json.dumps({"command": command, "settings": settings}) + "\n"); output.flush()
        result = subprocess.run(command, cwd=PROJECT, stdout=output, stderr=subprocess.STDOUT,
                                timeout=args.timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    text = log.read_text(encoding="utf-8", errors="replace")
    if "WEAPON_INSPECTION_RESULT " not in text or not report_path.is_file() or "SCRIPT ERROR:" in text or "\nERROR:" in text:
        raise RuntimeError(f"Inspection engine failed; see {log}\n" + text[-2400:])
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report.update(size=args.size, source_sha256=source_hash, source_files=len(sources), engine=ENGINE.name)
    write_json(report_path, report)
    products = ["report.json"] if args.check_only else package(folder, report)
    repeated = None
    if args.verify_repeat:
        try:
            repeated = verify_repeat(args, folder, report)
        except Exception:
            manifest_path.unlink(missing_ok=True)
            raise
        products.append("repeat.json")
        if not args.check_only:
            write_archive(folder, [name for name in products if name != "weapon-review.zip"])
    write_json(manifest_path, {"key": cache_key, "products": products})
    seconds = round(time.perf_counter() - started, 3)
    with (PROJECT / "logs/work-timing.csv").open("a", encoding="utf-8", newline="") as output:
        csv.writer(output).writerow(["Deterministic weapon review", f"{len(report['subjects'])} items; {report['checks']} checks; {len(report['failures'])} failures; render={not args.check_only}", seconds])
    print(json.dumps({"cached": False, "seconds": seconds, "items": len(report["subjects"]), "checks": report["checks"], "failures": report["failures"], "report": str(report_path), "overview": str(folder / "overview.png") if not args.check_only else None, "repeat": repeated, "log": str(log)}))
    return 1 if report["failures"] else (0 if result.returncode == 0 else 2)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        import traceback
        crash = PROJECT / "logs" / ("weapon-review-error-" + time.strftime("%Y%m%d-%H%M%S") + ".log")
        crash.parent.mkdir(parents=True, exist_ok=True)
        crash.write_text(traceback.format_exc(), encoding="utf-8")
        print(f"WEAPON_REVIEW_ERROR {type(error).__name__}: {error}\nCrash log: {crash}", file=sys.stderr)
        sys.exit(2)
