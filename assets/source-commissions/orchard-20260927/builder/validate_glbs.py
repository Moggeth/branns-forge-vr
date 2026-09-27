"""Re-import every output/glb/*.glb independently into an empty scene and measure it.

  blender --factory-startup -b --python output/builder/validate_glbs.py
Writes output/validation.json. Fails (exit 1) on missing colours, empty meshes,
non-flush paths or non-grounded origins.
"""
import bpy, os, json, sys, glob
from mathutils import Vector

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results, problems = [], []
for path in sorted(glob.glob(os.path.join(OUT, "glb", "*.glb"))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    aid = os.path.splitext(os.path.basename(path))[0]
    tris, mats, cols, lo, hi, meshes = 0, set(), True, Vector((1e9,) * 3), Vector((-1e9,) * 3), 0
    bpy.context.view_layer.update()
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        meshes += 1
        me = ob.data
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        mats.update(m.name for m in me.materials if m)
        cols = cols and len(me.color_attributes) > 0
        # winding check: closed meshes need positive signed volume, the flat path must face up
        mw = ob.matrix_world
        vol, up = 0.0, 0.0
        for poly in me.polygons:
            vs = [mw @ me.vertices[i].co for i in poly.vertices]
            for k in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
            up += (mw.to_3x3() @ poly.normal).z * poly.area
        winding_ok = (up > 0) if aid.startswith("orchard_path") else (vol > 0)
        if not winding_ok:
            problems.append(f"{aid}/{ob.name}: inverted winding (vol {vol:.3f}, up {up:.3f})")
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            y = Vector((w.x, w.z, -w.y))
            lo = Vector(map(min, lo, y)); hi = Vector(map(max, hi, y))
    r = {"id": aid, "bytes": os.path.getsize(path), "meshes": meshes, "triangles": tris,
         "materials": sorted(mats), "vertex_colours": cols,
         "bounds_min": [round(c, 3) for c in lo], "bounds_max": [round(c, 3) for c in hi]}
    if meshes == 0 or tris == 0: problems.append(aid + ": empty")
    if not cols: problems.append(aid + ": no vertex colours")
    if aid.startswith("orchard_path") and (hi.y > 0.04 or lo.y < -0.02):
        problems.append(f"{aid}: not flush y[{lo.y:.3f},{hi.y:.3f}]")
    if not aid.startswith("mountain") and not (-0.12 <= lo.y <= 0.01):
        problems.append(f"{aid}: base not at ground (min y {lo.y:.3f})")
    results.append(r)
    print("VALID", aid, tris, sorted(mats), r["bounds_min"], r["bounds_max"])
with open(os.path.join(OUT, "validation.json"), "w") as fh:
    json.dump({"assets": results, "problems": problems}, fh, indent=1)
print("PROBLEMS", problems)
sys.exit(1 if problems else 0)
