"""Package native FPS fixture frames as contact sheets and timed MP4s.

Run the two Godot capture fixtures first; see docs/FPS-SWING-IMPACTS-20261001.md.
Requires Pillow; ffmpeg is optional. Does not launch or alter the live game.
"""
from pathlib import Path
import logging
import shutil
import subprocess
import time

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]


def sheet(rows, destination, fractions=None, width=320, height=200):
    columns = len(fractions) if fractions else 4
    count = len(rows) if fractions else (len(rows) + columns - 1) // columns
    image = Image.new("RGB", (width * columns, (height + 32) * count), "#18252d")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 17)
    except OSError:
        font = ImageFont.load_default()
    for row, (label, frames) in enumerate(rows):
        selected = [(fraction, frames[round(fraction * (len(frames) - 1))]) for fraction in fractions] if fractions else [(None, frames[0])]
        for column, (fraction, path) in enumerate(selected):
            x = (column if fractions else row % columns) * width
            y = (row if fractions else row // columns) * (height + 32)
            with Image.open(path) as source:
                image.paste(source.convert("RGB").resize((width, height), Image.Resampling.LANCZOS), (x, y + 32))
            caption = label + (f" {fraction:.0%}" if fraction is not None else "")
            draw.text((x + 6, y + 6), caption, font=font, fill="white")
    image.save(destination)
    logging.info("Wrote %s", destination)


def main():
    started = time.perf_counter()
    (ROOT / "logs").mkdir(exist_ok=True)
    logging.basicConfig(filename=ROOT / "logs/fps-motion-review.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    try:
        swing = ROOT / "outputs/desktop-swing"
        rows = []
        ffmpeg = shutil.which("ffmpeg")
        for tool in ("woodland_axe", "quarry_pick", "apprentice_hammer"):
            for mode in ("normal", "slow"):
                name = f"{tool}-{mode}"
                frames = sorted((swing / name).glob("frame-*.png"))
                if not frames:
                    raise RuntimeError(f"Missing native swing frames: {name}")
                rows.append((name, frames))
                if ffmpeg:
                    result = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-framerate", "30",
                                             "-i", str(swing / name / "frame-%03d.png"), "-c:v", "libx264",
                                             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(swing / f"{name}.mp4")],
                                            capture_output=True, text=True, timeout=45)
                    if result.returncode:
                        raise RuntimeError(result.stderr)
        sheet(rows, swing / "contact-sheet.png", [0, .10, .20, .35, .50, .65, .80, 1])
        impact = ROOT / "outputs/impact-visual"
        for material in ("stone", "golem"):
            frames = sorted(impact.glob(f"pick-{material}-*.png"))
            if frames:
                sheet([(path.stem, [path]) for path in frames], impact / f"{material}-contact-sheet.png", width=480, height=300)
        elapsed = time.perf_counter() - started
        logging.info("PASS packaged native review in %.3f seconds; ffmpeg=%s", elapsed, bool(ffmpeg))
        print(f"FPS_REVIEW_PACKAGED {elapsed:.3f}s — {swing}")
    except Exception:
        logging.exception("Native FPS review packaging failed")
        raise


if __name__ == "__main__":
    main()
