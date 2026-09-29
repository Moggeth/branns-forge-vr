"""Game-scale collision proxies for the authored Starfall Ridge scenery.

The floor, mineable ore, bomb barrier, enemies and grapple targets remain
authoritative gameplay bodies in Godot. These opt-in proxies only make large
rocks and architecture feel solid; small crystals and route paving stay visual.
"""

import json
import sys
from pathlib import Path


def box(size, offset):
    return {"shape": "box", "size": list(size), "offset": list(offset)}


def cylinder(radius, height, y):
    return {"shape": "cylinder", "radius": radius, "height": height,
            "offset": [0, y, 0]}


SOLIDS = {
    "cliff_a": [box((6.8, 8.7, 4.4), (0, 4.35, 0))],
    "cliff_b": [box((6.1, 7.7, 4.0), (0, 3.85, 0))],
    "cliff_c": [box((5.2, 14.5, 4.2), (0, 7.25, 0))],
    "cliff_shelf": [box((7.0, 3.6, 4.9), (0, 1.8, 0))],
    "boulder_a": [box((2.55, 1.8, 2.1), (0, 0.9, 0))],
    "boulder_b": [box((1.55, 1.4, 1.4), (0, 0.7, 0))],
    "geode_seam_a": [box((6.0, 3.5, 3.9), (0.15, 1.75, 0.2))],
    "geode_seam_b": [box((4.8, 4.6, 2.7), (-0.5, 2.3, 0.3))],
    "meteor_fragment_large": [box((4.4, 2.1, 3.8), (0.3, 1.05, -0.5))],
    "mined_face": [box((6.7, 4.7, 4.4), (0, 2.35, 0))],
    "mined_block_pile": [box((3.2, 1.35, 2.6), (0, 0.675, 0))],
    # A five-piece drum leaves the +Z doorway and front steps clear.
    "observatory": [
        box((0.55, 3.4, 5.2), (-3.1, 2.05, 0)),
        box((0.55, 3.4, 5.2), (3.1, 2.05, 0)),
        box((6.7, 3.4, 0.55), (0, 2.05, -2.6)),
        box((1.55, 3.4, 0.55), (-2.35, 2.05, 2.6)),
        box((1.55, 3.4, 0.55), (2.35, 2.05, 2.6)),
    ],
    "ruin_column": [cylinder(0.55, 3.25, 1.625)],
    "ruin_column_fallen": [box((4.6, 0.78, 1.45), (-0.35, 0.39, -0.1))],
    "waystone": [box((0.75, 2.5, 0.82), (0, 1.25, 0))],
    "deadpine": [cylinder(0.24, 3.25, 1.625)],
}


def apply_collision_intent(manifest):
    used = set(manifest["assets"])
    manifest["asset_meta"] = {
        name: {"collision": shapes}
        for name, shapes in SOLIDS.items() if name in used
    }
    for placement in manifest["placements"]:
        if placement["asset"] in SOLIDS:
            placement["collision"] = "asset_default"
        else:
            placement.pop("collision", None)
    return manifest


def update_manifest(path):
    path = Path(path)
    original = path.read_text(encoding="utf-8-sig")
    doc = apply_collision_intent(json.loads(original))
    indent = len(original.splitlines()[1]) - len(original.splitlines()[1].lstrip())
    path.write_text(json.dumps(doc, indent=indent or 1) + "\n", encoding="utf-8")
    return sum(p.get("collision") == "asset_default" for p in doc["placements"])


if __name__ == "__main__":
    for filename in sys.argv[1:]:
        print(filename, update_manifest(filename), "solid placements")
