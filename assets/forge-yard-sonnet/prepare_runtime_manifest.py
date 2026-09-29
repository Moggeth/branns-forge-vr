"""Convert Sonnet's editable Forge Yard layout into the game's zone-kit schema."""

from __future__ import annotations

import json
from pathlib import Path


SOURCE = Path(__file__).resolve().parent
RUNTIME = SOURCE.parent.parent / "godot" / "assets" / "zone_art" / "forge_yard"
SOLIDS = {"garden_bed_a", "garden_planter_b", "cordwood_ore_rack"}
COLLISION = {
    "garden_bed_a": [{"shape": "box", "size": [4.0, 0.5, 1.4], "offset": [0, 0.25, 0]}],
    "garden_planter_b": [{"shape": "cylinder", "radius": 1.2, "height": 0.5, "offset": [0, 0.25, 0]}],
    "cordwood_ore_rack": [{"shape": "box", "size": [2.6, 1.5, 0.8], "offset": [0, 0.75, 0]}],
}


def build() -> dict:
    source = json.loads((SOURCE / "placement_forge_yard.json").read_text(encoding="utf-8"))
    assert source["schema"] == 1 and source["zone"] == "forge_yard"
    assets = {entry["id"]: entry["file"] for entry in source["assets"]}
    placements = []
    for entry in source["placements"]:
        asset = entry["asset"]
        assert asset in assets
        scale = [float(component) for component in entry["scale"]]
        assert len(scale) == 3 and all(0 < component <= 8 for component in scale)
        position = [float(component) for component in entry["position"]]
        assert len(position) == 3
        placement = {
            "asset": asset,
            "position": position,
            "yaw_degrees": float(entry["rotation_y_deg"]),
            "scale": scale,
            "collision": "asset_default" if asset in SOLIDS else "none",
        }
        placements.append(placement)
    assert len(placements) == 34 and len(assets) == 7
    return {
        "schema": 1,
        "zone": "forge_yard",
        "visibility_metres": 210,
        "vertex_color_multiply": True,
        "assets": assets,
        "asset_meta": {name: {"collision": specs} for name, specs in COLLISION.items()},
        "placements": placements,
    }


if __name__ == "__main__":
    RUNTIME.mkdir(parents=True, exist_ok=True)
    path = RUNTIME / "placement.json"
    path.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"FORGE_YARD_MANIFEST_OK {path}")
