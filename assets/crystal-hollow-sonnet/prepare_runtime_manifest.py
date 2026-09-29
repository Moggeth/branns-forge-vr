"""Keep Crystal Hollow gameplay landmarks while installing Sonnet cave dressing."""

import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[1] / "godot/assets/zone_art/crystal_hollow"


def cylinder(radius, height):
    return {"shape": "cylinder", "radius": radius, "height": height,
            "offset": [0, height / 2, 0]}


def box(size, offset):
    return {"shape": "box", "size": size, "offset": offset}


COLLISION = {
    "cliff_strata": [box([3.8, 3.4, 1.2], [0, 1.7, -0.8])],
    "ore_wall": [box([3.6, 3.0, 1.1], [0, 1.5, -0.65])],
    "cluster_large": [cylinder(0.82, 0.7)],
    "boulders": [cylinder(0.7, 0.55)],
}


def main():
    data = json.loads((HERE / "placement_crystal_hollow.json").read_text(encoding="utf-8"))
    # The existing Prism Vault is a playable invention challenge at the back
    # of the cave. Sonnet's tall central spire occupies its interaction space,
    # so retain the spire as a reusable asset without placing it here.
    data["placements"] = [placement for placement in data["placements"]
                          if placement["asset"] != "landmark_spire"]
    data["assets"] = {name: Path(path).name for name, path in data["assets"].items()}
    data["asset_meta"] = {name: {"collision": specs} for name, specs in COLLISION.items()}
    for placement in data["placements"]:
        if placement["asset"] in ("cliff_strata", "ore_wall"):
            # The existing cave wall stays as the high enclosing backdrop.
            # Bring Sonnet's textured lower strata forward so they read from
            # eye level, without narrowing the centre route.
            at = placement["position"]
            if abs(at[0]) >= 12.0:
                at[0] = round(at[0] - (1.25 if at[0] > 0 else -1.25), 3)
            elif at[2] <= -12.0:
                at[2] = round(at[2] + 1.1, 3)
        if placement["asset"] in COLLISION:
            placement["collision"] = "asset_default"
    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "placement.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"CRYSTAL_RUNTIME_MANIFEST placements={len(data['placements'])} "
          f"collidable={sum('collision' in p for p in data['placements'])}")


if __name__ == "__main__":
    main()
