"""Independent GLB inspector: parses output/bow.glb with plain JSON/struct/numpy and writes output/structure-report.json.
Run: blender --background --python report.py -- --out ABS_DIR   (or any python with numpy)"""
import sys, os, json, struct, math
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("output")
path = os.path.join(OUT, "bow.glb")
raw = open(path, "rb").read()
jl = struct.unpack("<I", raw[12:16])[0]; J = json.loads(raw[20:20 + jl])
bo = 20 + jl + 8; BIN = raw[bo:]

def acc(i):
    a = J["accessors"][i]; bv = J["bufferViews"][a["bufferView"]]
    ct = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride")
    if stride and stride != np.dtype(ct).itemsize * nc:
        arr = np.ndarray((a["count"], stride // np.dtype(ct).itemsize), ct, BIN, off, (stride,))[:, :nc]
    else:
        arr = np.frombuffer(BIN, ct, a["count"] * nc, off).reshape(a["count"], nc)
    return arr

def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)]])
def local(n):
    M = np.eye(4)
    if "matrix" in n: return np.array(n["matrix"]).reshape(4, 4).T
    S = np.diag(list(n.get("scale", [1, 1, 1])))
    M[:3, :3] = qmat(n.get("rotation", [0, 0, 0, 1])) @ S
    M[:3, 3] = n.get("translation", [0, 0, 0]); return M
nodes = J["nodes"]; parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []): parent[c] = i
def world(i):
    M = local(nodes[i])
    while i in parent:
        i = parent[i]; M = local(nodes[i]) @ M
    return M
name = {n["name"]: i for i, n in enumerate(nodes)}
markers = {k: [round(float(v), 5) for v in world(name[k])[:3, 3]] for k in
           ("Bow", "Grip", "ArrowRest", "ArrowGuide", "StringTop", "StringBottom", "UpperLimb", "LowerLimb", "PhoenixCore", "GripMesh") if k in name}
hier = {k: (nodes[parent[name[k]]]["name"] if name[k] in parent else None) for k in name}

tot_tris = 0; surfaces = 0; mn = np.array([9e9] * 3); mx = -mn; per = {}
allv = []
vol_bad = []
for i, n in enumerate(nodes):
    if "mesh" not in n: continue
    W = world(i)
    for p in J["meshes"][n["mesh"]]["primitives"]:
        pos = acc(p["attributes"]["POSITION"]).astype(np.float64); idx = acc(p["indices"]).reshape(-1).astype(np.int64)
        wp = (W[:3, :3] @ pos.T).T + W[:3, 3]
        allv.append(wp); surfaces += 1; t = len(idx) // 3; tot_tris += t
        tri = wp[idx.reshape(-1, 3)]
        vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6)
        per[f"{n['name']}/{J['materials'][p['material']]['name']}"] = {"tris": t, "signed_volume_cm3": round(vol * 1e6, 3)}
        if vol < 0: vol_bad.append(f"{n['name']}/{J['materials'][p['material']]['name']}")
allv = np.concatenate(allv); mn = allv.min(0); mx = allv.max(0)

# arrow corridor: any vertex within 14 mm of the line x=0,y=.115 for z in [-.68,.10] ?
sel = allv[(allv[:, 2] >= -0.68) & (allv[:, 2] <= 0.10)]
d = np.hypot(sel[:, 0], sel[:, 1] - 0.115)
inside = sel[d < 0.014]
close = sel[d < 0.020]
# per-mesh verts in corridor (identify which parts intrude)
intr = {}
for i, n in enumerate(nodes):
    if "mesh" not in n: continue
    W = world(i)
    for p in J["meshes"][n["mesh"]]["primitives"]:
        pos = acc(p["attributes"]["POSITION"]).astype(np.float64); wp = (W[:3, :3] @ pos.T).T + W[:3, 3]
        m = (wp[:, 2] >= -0.68) & (wp[:, 2] <= 0.10) & (np.hypot(wp[:, 0], wp[:, 1] - 0.115) < 0.014)
        if m.any(): intr[f"{n['name']}/{J['materials'][p['material']]['name']}"] = {"verts_in_14mm": int(m.sum()), "min_dist_mm": round(float(np.hypot(wp[m, 0], wp[m, 1] - 0.115).min() * 1000), 2), "y_range": [round(float(wp[m, 1].min()), 4), round(float(wp[m, 1].max()), 4)]}
guide_top = 0.115 - 0.0037 - 0.0045

rep = {
    "file": "bow.glb", "bytes": len(raw), "triangles": tot_tris, "surfaces": surfaces, "materials": len(J["materials"]),
    "material_names": [m["name"] for m in J["materials"]], "embedded_textures": len(J.get("images", [])),
    "dimensions_m": {"x": round(float(mx[0] - mn[0]), 4), "y": round(float(mx[1] - mn[1]), 4), "z": round(float(mx[2] - mn[2]), 4)},
    "bounds_min": [round(float(v), 4) for v in mn], "bounds_max": [round(float(v), 4) for v in mx],
    "marker_world_positions": markers, "parents": {k: hier[k] for k in ("Grip", "GripMesh", "ArrowRest", "ArrowGuide", "StringTop", "StringBottom", "UpperLimb", "LowerLimb", "PhoenixCore") if k in hier},
    "limbs": {"UpperLimb_pivot": markers.get("UpperLimb"), "LowerLimb_pivot": markers.get("LowerLimb")},
    "arrow_corridor_check": {"radius_m": 0.014, "z_range": [-0.68, 0.10], "centre": [0, 0.115],
                             "vertices_inside": int(len(inside)), "intruding_primitives": intr,
                             "guide_shelf_top_y": round(guide_top, 5), "note": "only the ArrowGuide shelf (brass, RiserMesh) is expected inside the corridor, below the shaft"},
    "negative_signed_volume_primitives": vol_bad, "per_primitive": per,
    "budgets": {"tris<=22000": tot_tris <= 22000, "surfaces<=14": surfaces <= 14, "materials<=8": len(J["materials"]) <= 8,
                "textures<=8": len(J.get("images", [])) <= 8, "bytes<3MB": len(raw) < 3e6,
                "dims<=.60x1.35x.40": bool(mx[0] - mn[0] <= 0.60 and mx[1] - mn[1] <= 1.35 and mx[2] - mn[2] <= 0.40)},
}
json.dump(rep, open(os.path.join(OUT, "structure-report.json"), "w"), indent=2)
print(json.dumps({k: rep[k] for k in ("triangles", "surfaces", "materials", "embedded_textures", "bytes", "dimensions_m", "marker_world_positions", "parents", "arrow_corridor_check", "negative_signed_volume_primitives", "budgets")}, indent=1))
