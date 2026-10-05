"""Contract check for the phoenix wings.glb (pure python, no bpy).

python3 verify_glb.py out/wings.glb [out/wings-previous.glb]

Checks what multiplayer/client/combat-view.js relies on:
  * nodes WingLeft / WingRight exist, each with its own mesh child
  * each wing's origin is at its shoulder (on the body side, not inside the feathers)
  * the vertex furthest from each wing origin is the OUTER PINION TIP (contrail emission point)
  * overall bounds, per-node bounds, triangle count, materials, image sizes
"""
import json, struct, sys, os, math

def load(path):
    d = open(path, "rb").read()
    ln = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + ln])
    off = 20 + ln
    while off < len(d):
        bl = struct.unpack("<I", d[off:off + 4])[0]; typ = d[off + 4:off + 8]
        if typ == b"BIN\x00": return j, d[off + 8:off + 8 + bl]
        off += 8 + bl
    return j, b""

CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

def read_accessor(j, bin_, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    fmt, sz = CT[a["componentType"]]; n = NC[a["type"]]
    stride = bv.get("byteStride") or sz * n
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    out = []
    for k in range(a["count"]):
        o = base + k * stride
        out.append(struct.unpack_from("<" + fmt * n, bin_, o))
    return out

def node_mesh_points(j, bin_, ni, xform=(0, 0, 0)):
    """Return every POSITION of this node's subtree, in THIS node's local frame (translations only)."""
    n = j["nodes"][ni]; tr = n.get("translation", [0, 0, 0])
    w = [xform[k] + tr[k] for k in range(3)]
    pts = []
    if "mesh" in n:
        for p in j["meshes"][n["mesh"]]["primitives"]:
            for v in read_accessor(j, bin_, p["attributes"]["POSITION"]):
                pts.append((v[0] + w[0], v[1] + w[1], v[2] + w[2]))
    for c in n.get("children", []): pts += node_mesh_points(j, bin_, c, w)
    return pts

def box(pts):
    return [[min(p[k] for p in pts) for k in range(3)], [max(p[k] for p in pts) for k in range(3)]]

def fmtbox(b):
    return (f"x[{b[0][0]:+.4f},{b[1][0]:+.4f}] y[{b[0][1]:+.4f},{b[1][1]:+.4f}] z[{b[0][2]:+.4f},{b[1][2]:+.4f}]"
            f"  size=({b[1][0]-b[0][0]:.4f}, {b[1][1]-b[0][1]:.4f}, {b[1][2]-b[0][2]:.4f})")

def report(path):
    j, bin_ = load(path)
    print(f"\n=== {path}  ({os.path.getsize(path):,} bytes)")
    byname = {n.get("name"): i for i, n in enumerate(j["nodes"])}
    tris = sum(j["accessors"][p["indices"]]["count"] // 3 for m in j["meshes"] for p in m["primitives"])
    prims = sum(len(m["primitives"]) for m in j["meshes"])
    print(f"triangles = {tris:,}   primitives = {prims}   materials = {[m['name'] for m in j.get('materials', [])]}"
          f"   images = {len(j.get('images', []))}")
    roots = j["scenes"][j.get("scene", 0)]["nodes"]
    allpts = [p for r in roots for p in node_mesh_points(j, bin_, r)]
    whole = box(allpts)
    print(f"whole asset   {fmtbox(whole)}")
    print("nodes:")
    def walk(i, d, w):
        n = j["nodes"][i]; tr = n.get("translation", [0, 0, 0]); ww = [w[k] + tr[k] for k in range(3)]
        print("  " * (d + 1) + f"- {n.get('name')}  world=({ww[0]:+.4f},{ww[1]:+.4f},{ww[2]:+.4f})"
              + (f"  rot={n['rotation']}" if "rotation" in n else "") + (f"  scale={n['scale']}" if "scale" in n else ""))
        for c in n.get("children", []): walk(c, d + 1, ww)
    for r in roots: walk(r, 0, [0, 0, 0])

    ok = True
    for name in ("WingLeft", "WingRight"):
        if name not in byname:
            print(f"FAIL: node {name} missing"); ok = False; continue
        ni = byname[name]
        n = j["nodes"][ni]
        if "rotation" in n or "scale" in n:
            print(f"NOTE: {name} carries a rotation/scale; the client overwrites its quaternion from userData.rest.")
        tr = n.get("translation", [0, 0, 0])
        pts = node_mesh_points(j, bin_, ni, [-tr[0], -tr[1], -tr[2]])   # the wing node's OWN frame
        b = box(pts)
        print(f"\n{name}: origin (world) = {tuple(round(x, 4) for x in n.get('translation', [0,0,0]))}")
        print(f"  local bounds  {fmtbox(b)}")
        far = sorted(pts, key=lambda p: -(p[0]**2 + p[1]**2 + p[2]**2))
        d0 = math.dist(far[0], (0, 0, 0))
        print(f"  furthest vertex from the pivot: ({far[0][0]:+.4f},{far[0][1]:+.4f},{far[0][2]:+.4f})  |d| = {d0:.4f}")
        print("  next 4: " + ", ".join(f"({p[0]:+.3f},{p[1]:+.3f},{p[2]:+.3f})|{math.dist(p,(0,0,0)):.4f}" for p in far[1:5]))
        sgn = -1 if name == "WingLeft" else 1
        outboard = sgn * far[0][0]
        span = max(sgn * p[0] for p in pts)
        print(f"  tip outboard X = {outboard:+.4f} ({100*outboard/span:.1f}% of the wing's own span {span:.4f})")
        if outboard < 0.80 * span:
            print("  FAIL: the furthest vertex is not out at the wing tip"); ok = False
        # the pivot should sit at the inboard/root end of the wing, not in the middle of it
        inboard = min(sgn * p[0] for p in pts)
        print(f"  most inboard X = {inboard:+.4f}  (pivot at 0: the wing root)")
        if inboard < -0.06 * span:
            print("  FAIL: the pivot is not at the shoulder"); ok = False
    print("\nCONTRACT " + ("OK" if ok else "BROKEN"))
    return whole

if __name__ == "__main__":
    boxes = [report(p) for p in sys.argv[1:]]
    if len(boxes) == 2:
        new, old = boxes
        print("\n=== new vs old bounding box")
        for k, ax in enumerate("xyz"):
            sn = new[1][k] - new[0][k]; so = old[1][k] - old[0][k]
            print(f"  {ax}: new {sn:.4f}  old {so:.4f}  ({100*(sn-so)/so:+.1f}%)   "
                  f"min {new[0][k]:+.4f}/{old[0][k]:+.4f}  max {new[1][k]:+.4f}/{old[1][k]:+.4f}")
