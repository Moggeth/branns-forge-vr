"""Print node tree (world translations), per-mesh triangles/primitives/bounds, materials, images and size of a GLB.
python3 inspect_glb.py FILE.glb [FILE2.glb ...]   (pure python, no bpy)"""
import json, struct, sys, os

def load(path):
    d = open(path, "rb").read()
    ln = struct.unpack("<I", d[12:16])[0]
    return d, json.loads(d[20:20 + ln])

def report(path):
    d, j = load(path)
    print(f"== {os.path.basename(path)}: {len(d):,} bytes")
    acc = j["accessors"]
    def mesh_info(mi):
        m = j["meshes"][mi]; t = 0; mats = []; mn = [9e9] * 3; mx = [-9e9] * 3
        for p in m["primitives"]:
            t += acc[p["indices"]]["count"] // 3
            mats.append(j["materials"][p["material"]]["name"] if "material" in p else "-")
            a = acc[p["attributes"]["POSITION"]]
            for k in range(3): mn[k] = min(mn[k], a["min"][k]); mx[k] = max(mx[k], a["max"][k])
        return t, mats, mn, mx
    tot = 0; prims = 0
    def walk(i, depth, wpos):
        nonlocal tot, prims
        n = j["nodes"][i]; tr = n.get("translation", [0, 0, 0]); w = [wpos[k] + tr[k] for k in range(3)]
        extra = ""
        if "rotation" in n and any(abs(x) > 1e-6 for x in n["rotation"][:3]): extra += f" rot={[round(x, 4) for x in n['rotation']]}"
        if "scale" in n: extra += f" scale={n['scale']}"
        if "mesh" in n:
            t, mats, mn, mx = mesh_info(n["mesh"]); tot += t; prims += len(mats)
            extra += f"  tris={t:,} prims={len(mats)} {mats} bounds x[{mn[0]:.3f},{mx[0]:.3f}] y[{mn[1]:.3f},{mx[1]:.3f}] z[{mn[2]:.3f},{mx[2]:.3f}]"
        print("  " * depth + f"- {n.get('name')} world=({w[0]:.4f},{w[1]:.4f},{w[2]:.4f}){extra}")
        for c in n.get("children", []): walk(c, depth + 1, w)
    for r in j["scenes"][j.get("scene", 0)]["nodes"]: walk(r, 1, [0, 0, 0])
    print(f"  TOTAL tris={tot:,} primitives={prims} materials={[m['name'] for m in j.get('materials', [])]} images={len(j.get('images', []))}")
    for m in j.get("materials", []):
        print(f"    material {m['name']}: emissiveFactor={m.get('emissiveFactor')} emissiveTex={'emissiveTexture' in m} ext={list(m.get('extensions', {}).keys())}")
    return j

if __name__ == "__main__":
    for p in sys.argv[1:]: report(p)
