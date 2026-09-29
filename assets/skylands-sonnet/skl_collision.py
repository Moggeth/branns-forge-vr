"""Selective physical proxies for the Skylands art kit.

The same contract is applied to the built manifests and to the installed game
manifests. A tree trunk or tower should feel solid; decorative leaves, cliff
undersides and grapple lanes deliberately remain free of broad hulls.
"""


def cylinder(radius, height, y):
    return {"shape": "cylinder", "radius": radius, "height": height, "offset": [0, y, 0]}


def box(size, offset):
    return {"shape": "box", "size": list(size), "offset": list(offset)}


SKYLANDS_SOLIDS = {
    "windmill_tower": [cylinder(1.36, 6.15, 3.075)],
    "tree_sky_a": [cylinder(0.22, 2.45, 1.225)],
    "tree_sky_b": [cylinder(0.18, 1.85, 0.925)],
    "tree_sky_c": [cylinder(0.27, 3.35, 1.675)],
    "tree_cloud_a": [cylinder(0.25, 2.8, 1.4)],
    "tree_cloud_b": [cylinder(0.18, 1.7, 0.85)],
    "tree_cloud_c": [cylinder(0.30, 3.55, 1.775)],
    "garden_arch_sky": [
        {"shape": "cylinder", "radius": 0.32, "height": 2.5, "offset": [-1.55, 1.25, 0]},
        {"shape": "cylinder", "radius": 0.32, "height": 2.5, "offset": [1.55, 1.25, 0]},
    ],
    "balustrade_span_sky": [box((0.33, 1.05, 2.9), (0, 0.525, 0))],
    "pillar_lantern_sky": [cylinder(0.31, 1.55, 0.775)],
    "pillar_lantern_cloud": [cylinder(0.31, 1.55, 0.775)],
    "grapple_post_sky": [cylinder(0.28, 4.3, 2.15)],
    "grapple_post_cloud": [cylinder(0.35, 5.2, 2.6)],
    "waymark_sky": [cylinder(0.34, 1.0, 0.5)],
    "waymark_cloud": [cylinder(0.34, 1.0, 0.5)],
    "wind_banner_pole_a": [cylinder(0.15, 4.2, 2.1)],
    "wind_banner_pole_b": [cylinder(0.15, 3.0, 1.5)],
    "cairn_stack": [cylinder(0.48, 1.55, 0.775)],
    "crystal_cluster_a": [cylinder(0.38, 1.15, 0.575)],
    "keep_wall_span": [box((0.57, 1.55, 2.95), (0, 0.775, 0))],
    "keep_tower": [cylinder(1.82, 5.35, 2.675)],
    "watch_shelter": [
        box((4.25, 1.25, 0.28), (0, 1.025, -1.6)),
        box((0.28, 1.25, 3.3), (-2.15, 1.025, 0)),
    ],
    "shelter_hall": [
        box((7.25, 1.25, 0.28), (0, 1.025, -1.6)),
        box((0.28, 1.25, 3.3), (-3.65, 1.025, 0)),
    ],
}


def apply_collision_intent(manifest):
    """Mutate a schema-1 placement document with cheap authored solid intent."""
    # The windmill blade is instantiated under the live animated rotor node.
    # Its GLB stays in assets so installers copy it, but never place a static
    # duplicate in the batch.
    manifest["placements"] = [
        placement for placement in manifest["placements"]
        if placement["asset"] != "windmill_rotor"
    ]
    used = set(manifest["assets"])
    manifest["asset_meta"] = {
        name: {"collision": shapes}
        for name, shapes in SKYLANDS_SOLIDS.items()
        if name in used
    }
    for placement in manifest["placements"]:
        if placement["asset"] in SKYLANDS_SOLIDS:
            placement["collision"] = "asset_default"
        else:
            placement.pop("collision", None)
    return manifest


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path

    for filename in sys.argv[1:]:
        path = Path(filename)
        original = path.read_text(encoding="utf-8-sig")
        doc = json.loads(original)
        apply_collision_intent(doc)
        # Preserve the manifest's formatting style on repeated installs.
        indent = len(original.splitlines()[1]) - len(original.splitlines()[1].lstrip())
        path.write_text(json.dumps(doc, indent=indent or 1) + "\n", encoding="utf-8")
        print(f"{path}: {len(doc['asset_meta'])} solid assets")
