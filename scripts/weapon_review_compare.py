"""Assemble selected before/after poses from existing actual-engine reports."""
import argparse
import json
from pathlib import Path
import time

from PIL import Image, ImageDraw, ImageFont, ImageOps


def main():
    started = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--views", required=True, help="Comma-separated item:mode:view entries")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    reports = [json.loads((root / "report.json").read_text()) for root in (args.before, args.after)]
    selections = [value.split(":") for value in args.views.split(",")]
    if any(len(value) != 3 for value in selections):
        parser.error("Each view must be item:mode:view")
    font = lambda size: ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", size)
    width, height, caption, header = 640, 512, 74, 132
    sheet = Image.new("RGB", (width * 2, header + len(selections) * (height + caption)), "#151b20")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 12), "BRANN'S FORGE / ORIENTATION CORRECTIONS", font=font(31), fill="#f2eee4")
    draw.text((24, 58), "Same actual models and neutral light · automatic framing · synthetic hand fixture", font=font(21), fill="#b6c0c8")
    draw.text((24, 96), "BEFORE", font=font(22), fill="#ffbe66")
    draw.text((width + 24, 96), "AFTER", font=font(22), fill="#69d3eb")
    evidence = []
    for row, (identifier, mode, view) in enumerate(selections):
        pair = []
        for column, (root, report) in enumerate(zip((args.before, args.after), reports)):
            item = next(s for s in report["subjects"] if s["id"] == identifier)
            pose = next(v for v in item["views"] if v["mode"] == mode and v["view"] == view)
            x, y = column * width, header + row * (height + caption)
            with Image.open(root / pose["file"]) as image:
                sheet.paste(ImageOps.pad(image.convert("RGB"), (width, height), color="#363c43"), (x, y))
            draw.text((x + 20, y + height + 6), item["name"] + " · " + mode.replace("_", " "), font=font(22), fill="#f2eee4")
            if "forward_dot" in pose:
                detail = f"Aim {pose['forward_dot']:.3f} · Up {pose['up_dot']:.3f}"
            elif "span_m" in pose:
                detail = f"Orthographic span {pose['span_m']:.2f} m"
            else:
                detail = f"Perspective FOV {pose['fov_degrees']:.1f}°"
            draw.text((x + 20, y + height + 37), view + " · " + detail, font=font(18), fill="#b6c0c8")
            pair.append(pose)
        evidence.append({"id": identifier, "before": pair[0], "after": pair[1]})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    seconds = round(time.perf_counter() - started, 3)
    args.out.with_suffix(".json").write_text(json.dumps({"poses": evidence, "seconds": seconds}, indent=2) + "\n")
    print(json.dumps({"output": str(args.out.resolve()), "poses": len(evidence), "seconds": seconds}))


if __name__ == "__main__":
    main()
