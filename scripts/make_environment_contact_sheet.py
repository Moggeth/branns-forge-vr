"""Arrange actual-game zone captures for visual commissioning.

Run after environment_art_review.gd:
    python scripts/make_environment_contact_sheet.py

Pillow is optional for running the game; only this review utility needs it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--review-dir",
        type=Path,
        default=ROOT / "outputs/environment-art-review",
        help="Directory containing the capture result.json and PNGs",
    )
    parser.add_argument("--out", type=Path, help="JPEG output; defaults to review-dir/contact-sheet.jpg")
    args = parser.parse_args()

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise SystemExit("Install Pillow to generate a contact sheet: python -m pip install Pillow") from exc

    review_dir = args.review_dir.resolve()
    report = json.loads((review_dir / "result.json").read_text(encoding="utf-8"))
    if report.get("failures") or report.get("capture_count", len(report.get("captures", []))) != 24:
        raise SystemExit("Capture report is incomplete or failed; inspect result.json first")
    capture_index = {(c["zone"], c["view"]): c for c in report["captures"]}

    tile_width, tile_height, caption_height, gutter = 380, 238, 29, 12
    rows = (len(report["zones"]) + 1) // 2
    sheet = Image.new(
        "RGB",
        (4 * tile_width + 5 * gutter, rows * (tile_height + caption_height) + (rows + 1) * gutter),
        "#1f2634",
    )
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    for index, zone in enumerate(report["zones"]):
        row, pair = divmod(index, 2)
        for view_index, view in enumerate(("ground-eye", "elevated-rts")):
            capture = capture_index.get((zone["id"], view))
            if capture is None:
                raise SystemExit(f"Missing {zone['id']} {view} capture")
            path = Path(capture["path"])
            if not path.is_file():
                path = review_dir / f"{zone['id']}-{view}.png"
            with Image.open(path) as source:
                thumb = source.convert("RGB")
                thumb.thumbnail((tile_width, tile_height), Image.Resampling.LANCZOS)
                x = gutter + (pair * 2 + view_index) * (tile_width + gutter)
                y = gutter + row * (tile_height + caption_height + gutter)
                sheet.paste(thumb, (x + (tile_width - thumb.width) // 2, y + (tile_height - thumb.height) // 2))
                draw.text((x, y + tile_height + 5), f"{zone['name']}  |  {view}", fill="#f7ecdb", font=font)

    output = (args.out or review_dir / "contact-sheet.jpg").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "JPEG", quality=88, optimize=True)
    print(f"ENVIRONMENT_CONTACT_SHEET {output} zones={len(report['zones'])} size={sheet.width}x{sheet.height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
