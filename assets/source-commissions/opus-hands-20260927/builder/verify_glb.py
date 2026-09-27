"""Re-import each exported GLB and check the runtime contract.

Run: blender -b --factory-startup -P builder/verify_glb.py
Checks are made in the Godot frame (x, y, z) = (bx, bz, -by).
"""
import bpy, json, os, struct, sys
from mathutils import Matrix, Vector

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output")
FINGERS = ("Index", "Middle", "Ring", "Pinky")
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def godot(v):
    return Vector((v.x, v.z, -v.y))


def glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + n])


report = {}
for side, tag in ((1, "L"), (-1, "R")):
    path = os.path.join(OUT, f"pocket_thunder_hand_{tag}.glb")
    js = glb_json(path)
    check(all("uri" not in b for b in js.get("buffers", [])) and not js.get("images"), f"{tag} GLB self-contained")
    tris = 0
    for m in js["meshes"]:
        for p in m["primitives"]:
            tris += js["accessors"][p["indices"]]["count"] // 3
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = bpy.data.objects
    need = [f"{tag}_HandRoot", f"{tag}_Thumb_Root", f"{tag}_Thumb_1", f"{tag}_Thumb_2", f"{tag}_Thumb_Tip"]
    need += [f"{tag}_{f}_{s}" for f in FINGERS for s in (1, 2, 3)] + [f"{tag}_{f}_Tip" for f in FINGERS]
    missing = [n for n in need if n not in obs]
    check(not missing, f"{tag} joint nodes present {missing or ''}")
    if missing:
        continue
    for n in need[2:]:
        if not n.endswith("Tip") and not n.endswith("Root"):
            q = obs[n].matrix_basis.to_quaternion()
            check(abs(abs(q.w) - 1) < 1e-5, f"{tag} {n} rest rotation is identity")
    bpy.context.view_layer.update()
    pts = [godot(o.matrix_world @ Vector(c)) for o in obs if o.type == "MESH" for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    tip = lambda n: godot(obs[f"{tag}_{n}"].matrix_world.translation)
    knuckle_to_tip = tip("Middle_1").z - tip("Middle_Tip").z
    palm_mesh = obs[f"{tag}_Palm"]
    pv = [godot(palm_mesh.matrix_world @ v.co) for v in palm_mesh.data.vertices]
    palm_w = max(p.x for p in pv if -0.04 < p.z < 0.0) - min(p.x for p in pv if -0.04 < p.z < 0.0)
    thumb_x = tip("Thumb_Tip").x
    check(0.08 <= palm_w <= 0.10, f"{tag} palm width {palm_w * 100:.1f} cm")
    check(0.10 <= knuckle_to_tip <= 0.12, f"{tag} middle knuckle->tip {knuckle_to_tip * 100:.1f} cm")
    check(thumb_x * side > 0.03, f"{tag} thumb on {'+' if side > 0 else '-'}X side (x={thumb_x:.3f})")
    check(tip("Index_1").x * side > tip("Pinky_1").x * side, f"{tag} index is thumb-side of pinky")
    check(tip("Middle_Tip").z < -0.1, f"{tag} fingers extend -Z")
    # Runtime applies rotation=(-angle,0,0); curl must move tips toward palm (-Y) and back toward wrist.
    before = {f: tip(f"{f}_Tip") for f in FINGERS + ("Thumb",)}
    for f in FINGERS:
        for s in (1, 2, 3):
            obs[f"{tag}_{f}_{s}"].matrix_basis = Matrix.Rotation(-0.95, 4, "X")
    for s in (1, 2):
        obs[f"{tag}_Thumb_{s}"].matrix_basis = Matrix.Rotation(-0.95, 4, "X")
    bpy.context.view_layer.update()
    for f in FINGERS:
        a = tip(f"{f}_Tip")
        dy, dz = before[f].y - a.y, a.z - before[f].z
        check(dy > 0.02 and dz > 0.02, f"{tag} {f} curls toward palm (down {dy * 100:.1f} cm, back {dz * 100:.1f} cm)")
    t = tip("Thumb_Tip")
    check((before["Thumb"].x - t.x) * side > 0.01 and t.y < before["Thumb"].y, f"{tag} thumb curls across palm")
    report[tag] = dict(triangles=tris, nodes=len(js["nodes"]), meshes=len(js["meshes"]),
                       bounds_min=[round(v, 4) for v in lo], bounds_max=[round(v, 4) for v in hi],
                       palm_width_cm=round(palm_w * 100, 2), middle_knuckle_to_tip_cm=round(knuckle_to_tip * 100, 2),
                       bytes=os.path.getsize(path))

with open(os.path.join(OUT, "verify.json"), "w") as f:
    json.dump(dict(fails=fails, hands=report), f, indent=2)
print("VERIFY", "OK" if not fails else f"{len(fails)} FAIL", json.dumps(report))
sys.exit(1 if fails else 0)
