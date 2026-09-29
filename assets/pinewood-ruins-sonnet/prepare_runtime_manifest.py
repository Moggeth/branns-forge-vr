"""Convert the editable Pinewood layout into conservative gameplay collision."""

import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[1] / "godot/assets/zone_art/pinewood_ruins"


def box(size, offset):
    return {"shape": "box", "size": size, "offset": offset}


def cylinder(radius, height):
    return {"shape": "cylinder", "radius": radius, "height": height,
            "offset": [0, height / 2, 0]}


# These touch only the major solid silhouettes. The portal/gathering route and
# small roots, leaves, stones and ground texture stay deliberately walkable.
COLLISION = {
    "arch": [
        box([1.6, 5.6, 1.35], [-3.0, 2.8, 0]),
        box([1.6, 3.1, 1.35], [3.0, 1.55, 0]),
    ],
    "ruin_wall": [box([5.5, 1.4, 0.95], [2.75, 0.7, 0])],
    "conifer_pine": [cylinder(0.3, 1.7)],
    "conifer_spruce": [cylinder(0.3, 1.7)],
    "conifer_fir": [cylinder(0.3, 1.7)],
}


def main():
    data = json.loads((HERE / "placement_pinewood_ruins.json").read_text(encoding="utf-8"))
    data["assets"] = {name: Path(path).name for name, path in data["assets"].items()}
    data["asset_meta"] = {name: {"collision": specs} for name, specs in COLLISION.items()}
    for placement in data["placements"]:
        if placement["asset"] in COLLISION:
            placement["collision"] = "asset_default"
    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "placement.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"PINEWOOD_RUNTIME_MANIFEST placements={len(data['placements'])} "
          f"collidable={sum('collision' in p for p in data['placements'])}")


if __name__ == "__main__":
    main()
