"""Count bow vertices inside the arrow-pass corridor: |(x, y-.115)| < 14 mm for z in [-0.06, 0.10] (world, glTF coords)."""
import json, struct, sys, numpy as np
def verts(path):
    d = open(path, "rb").read(); ln = struct.unpack("<I", d[12:16])[0]; j = json.loads(d[20:20 + ln]); bin_ = d[20 + ln + 8:]
    out = {}
    def walk(i, off):
        n = j["nodes"][i]; t = n.get("translation", [0, 0, 0]); w = [off[k] + t[k] for k in range(3)]
        if "mesh" in n:
            for p in j["meshes"][n["mesh"]]["primitives"]:
                a = j["accessors"][p["attributes"]["POSITION"]]; bv = j["bufferViews"][a["bufferView"]]
                arr = np.frombuffer(bin_, np.float32, a["count"] * 3, bv.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(-1, 3) + np.array(w)
                out.setdefault(n["name"], []).append(arr)
        for c in n.get("children", []): walk(c, w)
    for r in j["scenes"][0]["nodes"]: walk(r, [0, 0, 0])
    return {k: np.concatenate(v) for k, v in out.items()}
for path in sys.argv[1:]:
    print(path)
    for name, v in verts(path).items():
        r = np.hypot(v[:, 0], v[:, 1] - 0.115); m = (r < 0.014) & (v[:, 2] > -0.06) & (v[:, 2] < 0.10)
        if m.any(): print(f"  {name}: {m.sum()} verts in corridor, y {v[m,1].min():.4f}..{v[m,1].max():.4f}, nearest {r[m].min()*1000:.2f} mm")
