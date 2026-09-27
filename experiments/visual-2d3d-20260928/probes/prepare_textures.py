"""Extract two deterministic textures from the saved generated environment board."""
from pathlib import Path
import json
import time

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "references" / "environment-board.png"
OUT = HERE / "textures"


def main():
    started = time.perf_counter()
    OUT.mkdir(exist_ok=True)
    image = Image.open(SOURCE).convert("RGB")
    # Bottom-right asset vignette: isolate its apple tree, preserving generated pixels.
    box = (697, 696, 939, 969)
    crop = np.asarray(image.crop(box))
    # The studio ground is approximately RGB 207,188,165. Colour-distance
    # matting preserves the foreground's generated pixels but is intentionally
    # imperfect around fine leaves and the baked ground shadow.
    r, g, b = [crop[:, :, i].astype(np.int16) for i in range(3)]
    beige = ((r > 145) & (g > 132) & (b > 108) &
             (r - g > 9) & (r - g < 37) &
             (g - b > 8) & (g - b < 39))
    alpha = np.where(beige, 0, 255).astype(np.uint8)
    rgba = np.dstack((crop, alpha))
    Image.fromarray(rgba, "RGBA").save(OUT / "generated_tree_cutout.png")
    # Top-right player-height concept panel; no repainting or synthesized detail.
    panel_box = (707, 0, 1254, 681)
    image.crop(panel_box).save(OUT / "generated_approach_panel.png")
    info = {
        "source": str(SOURCE.relative_to(HERE.parent)).replace("\\", "/"),
        "source_size_px": image.size,
        "tree_crop_xyxy": box,
        "panel_crop_xyxy": panel_box,
        "tree_alpha_nonzero_fraction": float(np.mean(alpha > 0)),
        "method": "RGB beige-background classifier; generated source pixels unchanged except alpha",
        "measured_seconds": round(time.perf_counter() - started, 3),
    }
    (OUT / "extraction.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
