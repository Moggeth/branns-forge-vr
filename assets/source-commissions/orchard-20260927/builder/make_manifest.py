"""Merge build_report.json + validation.json into output/manifest.json (system Python).
  python output/builder/make_manifest.py
"""
import json, os, math

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
build = json.load(open(os.path.join(OUT, "build_report.json")))
valid = {a["id"]: a for a in json.load(open(os.path.join(OUT, "validation.json")))["assets"]}

R = 4.0 / math.radians(30)
exit_x, exit_z = R - R * math.cos(math.radians(30)), -2.0 + R * math.sin(math.radians(30))
JOINS = {
    "orchard_wall_straight": {"module_m": 4.0, "ends": "flat faces at local x=-2 and x=+2, centreline z=0, height 1.05 + coping"},
    "orchard_wall_corner_broken": {"module_m": 4.0, "ends": "arm ends at local (+2,0,0) facing +X and (0,0,+2) facing +Z; corner block at origin. "
                                   "A straight piece continues at (4,0,0) yaw 0 or (0,0,4) yaw 90deg"},
    "orchard_wall_end_broken": {"module_m": 4.0, "ends": "full-height flat face at local x=-2; collapses toward +X into rubble (terminator)"},
    "orchard_path_straight": {"module_m": 4.0, "ends": "local z=-2 and z=+2, identical periodic edge outline so any number tile"},
    "orchard_path_curve30": {"module_m": 4.0, "ends": "enters at z=-2 heading +Z; exits at local (%.3f, 0, %.3f) heading yaw +30deg (+Z rotated toward +X). "
                             "Use orchard_path_curve30_left for the other hand (do not mirror)" % (exit_x, exit_z),
                             "exit_transform": {"position": [round(exit_x, 4), 0.0, round(exit_z, 4)], "yaw_deg": 30.0}},
    "orchard_path_curve30_left": {"module_m": 4.0, "ends": "enters at z=-2 heading +Z; exits at local (%.3f, 0, %.3f) heading yaw -30deg" % (-exit_x, exit_z),
                                  "exit_transform": {"position": [round(-exit_x, 4), 0.0, round(exit_z, 4)], "yaw_deg": -30.0}},
    "orchard_hedge_dense": {"module_m": 3.0, "ends": "rounded foliage ends inside x=+-1.7; place runs at 2.9-3.0 m spacing (slight overlap hides the join)"},
}
assets = []
for a in build["assets"]:
    v = valid.get(a["id"], {})
    e = {
        "id": a["id"], "category": a["category"], "glb": a["glb"],
        "nodes": a["nodes"], "material_slots": a["materials"], "triangles": a["triangles"],
        "bounds_min_m": a["bounds_min"], "bounds_max_m": a["bounds_max"], "size_m": a["size"],
        "origin": "ground-contact centre" if not a["id"].startswith("mountain") else "footprint centre at ground level; base skirt extends to y=-4 for uneven terrain",
        "collision": a["collision"], "lod": a["lod"],
        "glb_bytes": v.get("bytes"), "reimport_triangles": v.get("triangles"), "vertex_colours": v.get("vertex_colours"),
        "renders": a.get("renders", {}),
    }
    if a["id"] in JOINS:
        e["joins"] = JOINS[a["id"]]
    assets.append(e)
manifest = {
    "library": "Brann's Forge VR orchard environment library",
    "version": 1, "units": "metres", "up": "+Y", "forward_note": "authored so 'front' faces +Z",
    "generator": build["generator"], "blender": build["blender"], "godot_target": "4.7.2 Mobile / OpenXR",
    "colour": "all albedo in COLOR_0 (sRGB authored); materials are white; see HANDOFF.md 'Import' for the required albedo-from-vertex-colour step",
    "godot_import_script": "godot/orchard_post_import.gd", "godot_runtime_helper": "godot/orchard_finish.gd",
    "contact_sheet": "renders/contact_sheet.png", "review_renders": build.get("review_renders", []),
    "assets": assets,
}
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print("manifest", len(assets))
