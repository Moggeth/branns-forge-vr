"""Convert Sonnet's editable Glade layout to safe Godot placement/collision data."""

import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[1] / "godot/assets/zone_art/mushroom_glade"


def cylinder(radius, height, x=0, z=0):
    return {"shape": "cylinder", "radius": radius, "height": height,
            "offset": [x, height / 2, z]}


COLLISION = {
    "mushroom_violet_tall": [cylinder(0.19, 0.8)],
    "mushroom_violet_squat": [cylinder(0.24, 0.5)],
    "mushroom_violet_lean": [cylinder(0.17, 0.8)],
    "mushroom_cluster": [cylinder(0.18, 0.65)],
    "boulder_mossy_a": [cylinder(1.3, 1.2)],
    "boulder_mossy_b": [cylinder(1.4, 1.0)],
    "ruin_waterfall": [{"shape": "box", "size": [31.0, 5.0, 3.3],
                        "offset": [0, 2.5, -4.0]}],
}


def main():
    source = HERE / "placement_mushroom_glade.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    stats = json.loads((HERE / "stats.json").read_text(encoding="utf-8"))
    if stats.get("keepout_violations"):
        raise ValueError("Sonnet Glade layout intersects protected gameplay space")
    data["assets"] = {name: Path(path).name for name, path in data["assets"].items()}
    data["asset_meta"] = {name: {"collision": specs} for name, specs in COLLISION.items()}
    for placement in data["placements"]:
        if placement["asset"] in COLLISION:
            placement["collision"] = "asset_default"
        if placement["asset"] == "spore_cloud":
            # Keep the authored distribution, but let players read through it
            # at eye height instead of filling the view with white motes.
            placement["scale"] = round(placement["scale"] * 0.72, 3)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "placement.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"GLADE_RUNTIME_MANIFEST placements={len(data['placements'])} collidable={sum('collision' in p for p in data['placements'])}")


if __name__ == "__main__":
    main()
