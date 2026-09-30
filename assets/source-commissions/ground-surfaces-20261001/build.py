"""Brann's Forge ground-surface kit builder (deterministic). Usage:
  python build.py --out <absolute dir> [--only tiles|atlas|props] [--skip-blender]
Writes <out>/materials, <out>/props, <out>/manifest.json, then runs Blender for the .blend/renders."""
import argparse, json, os, subprocess, sys, time
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ktex, kgeo

BLENDER = "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="all")
    ap.add_argument("--skip-blender", action="store_true")
    ap.add_argument("--blender", default=BLENDER)
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    mat, props = os.path.join(out, "materials"), os.path.join(out, "props")
    os.makedirs(mat, exist_ok=True); os.makedirs(props, exist_ok=True)
    t0 = time.time()
    if a.only in ("all", "tiles"):
        for k, fn in ktex.TILES.items():
            rng = np.random.default_rng(3 + list(ktex.TILES).index(k))
            alb, h, ro, bump, aos = fn(rng, 1024)
            ims = ktex.save_set(k, np.clip(alb, 0, 1), h, ro, bump, aos)
            for suf, im in ims.items():
                im.save(os.path.join(mat, f"{k}_{suf}.png"), optimize=True)
            print("tile", k, round(time.time() - t0, 1), flush=True)
    if a.only in ("all", "atlas"):
        alb, nrm, orm = ktex.build_atlas()
        for suf, arr in (("albedo", alb), ("normal", nrm), ("orm", orm)):
            Image.fromarray(ktex.to_u8(arr)).save(os.path.join(mat, f"prop_atlas_{suf}.png"), optimize=True)
        print("atlas", round(time.time() - t0, 1), flush=True)
    stats = {}
    if a.only in ("all", "props"):
        uris = [f"../materials/prop_atlas_{s}.png" for s in ("albedo", "normal", "orm")]
        manifest = {"schema": 1, "normal_convention": "OpenGL +Y", "orm_channels": "R AO / G roughness / B metallic", "props": []}
        for pid, fn, kind, zones, w, sc, md in kgeo.PROPS:
            m = fn()
            st = kgeo.write_glb(os.path.join(props, pid + ".glb"), pid, m, uris)
            stats[pid] = st
            manifest["props"].append({"id": pid, "asset": f"props/{pid}.glb", "kind": kind, "zones": zones, "weight": w, "scale": sc, "max_distance": md})
            print(pid, st["tris"], "tris", st["extent_m"], flush=True)
        json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1)
        json.dump(stats, open(os.path.join(out, "prop_stats.json"), "w"), indent=1)
    if not a.skip_blender and a.only == "all":
        subprocess.run([a.blender, "--background", "--python", os.path.join(HERE, "blender_scene.py"), "--", out], check=True)
    print("done", round(time.time() - t0, 1), "s")

if __name__ == "__main__":
    main()
