"""160 m hybrid scaling probe: one extended route, same saved core and assets."""
from __future__ import annotations

import copy
import json
import math
import random
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parents[1]
parent = json.loads((EXP / "variants/E/world_spec.json").read_text())
world = copy.deepcopy(parent)
world["variant"] = "E-scale"
world["method"] = "hybrid E extended to 160m with deterministic outer orchard rules"
world["bounds_m"] = [160, 160]
world["seed"] = 2026092801
world["spawn_xz"] = [-65, 65]
world["goal_xz"] = [65, -65]
world["path_xz"] = [[-65,65],[-55,55],[-43,43]] + parent["path_xz"] + [[36,-38],[50,-51],[65,-65]]
world["stream"]["points_xz"] = [[-82,-11],[-70,-7],[-56,-3],[-44,-5]] + parent["stream"]["points_xz"] + [[45,5],[58,4],[70,6],[82,12]]
world["landmark"]["position_xz"] = [65,-65]
world["terrain"]["hills"] += [
    {"center_xz": p, "radius_m": 18, "amplitude_m": a}
    for p,a in [([-61,-58],0.8),([-52,41],0.7),([57,55],0.9),([62,-60],0.6),([48,-45],0.5)]
]
world["regions"] += [
    {"name":"outer_west_orchard","surface":"grass","polygon_xz":[[-80,-80],[-40,-80],[-40,80],[-80,80]],"tree_density":0.0},
    {"name":"outer_east_orchard","surface":"grass","polygon_xz":[[40,-80],[80,-80],[80,80],[40,80]],"tree_density":0.0},
    {"name":"outer_north_orchard","surface":"grass","polygon_xz":[[-40,-80],[40,-80],[40,-40],[-40,-40]],"tree_density":0.0},
    {"name":"outer_south_orchard","surface":"grass","polygon_xz":[[-40,40],[40,40],[40,80],[-40,80]],"tree_density":0.0},
]
world["exclusions"] = [x for x in parent["exclusions"]]
world["exclusions"] += [
    {"kind":"circle","name":"scale_spawn","center_xz":world["spawn_xz"],"radius_m":4.0},
    {"kind":"circle","name":"scale_goal","center_xz":world["goal_xz"],"radius_m":4.0},
]

# The extended route cuts through a handful of props that were clear of the
# original 80 m route. Clear them explicitly before generating the outer ring.
core_count = len(world["objects"])
route_cleared = []


def distance_poly(p, points):
    closest = float("inf")
    for a,b in zip(points,points[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/max(dx*dx+dz*dz,1e-9)))
        closest=min(closest,math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz))
    return closest


kept = []
for obj in world["objects"]:
    pos = obj["position_xyz"]
    if distance_poly((pos[0], pos[2]), world["path_xz"]) < 2.2:
        route_cleared.append({"asset_id":obj["asset_id"], "position_xz":[pos[0],pos[2]]})
    else:
        kept.append(obj)
world["objects"] = kept


def height(p):
    h=world["terrain"].get("base_y", world["terrain"].get("base_height_m", 0.0))
    coeff=world["terrain"].get("gaussian_coefficient",0.5)
    for hill in world["terrain"]["hills"]:
        dx,dz=p[0]-hill["center_xz"][0],p[1]-hill["center_xz"][1]
        h+=hill["amplitude_m"]*math.exp(-coeff*(dx*dx+dz*dz)/hill["radius_m"]**2)
    return h


rng=random.Random(world["seed"])
names=["apple_tree_mature","apple_tree_mature_b","apple_tree_young","apple_tree_mature_autumn","rock_mossy","shrub_flowering"]
weights=[23,22,24,5,14,12]
counts=Counter()
placed=[(o["position_xyz"][0],o["position_xyz"][2]) for o in world["objects"]]
for x0 in range(-76,77,5):
    for z0 in range(-76,77,5):
        # Preserve the image-derived centre so its origin remains identifiable.
        if -39 <= x0 <= 39 and -39 <= z0 <= 39:
            continue
        if rng.random()>0.69:
            continue
        p=(x0+rng.uniform(-1.7,1.7),z0+rng.uniform(-1.7,1.7))
        if max(abs(p[0]),abs(p[1]))>77:
            continue
        if distance_poly(p,world["path_xz"])<4.2:
            continue
        if distance_poly(p,world["stream"]["points_xz"])<4.2:
            continue
        if math.dist(p,world["goal_xz"])<8 or math.dist(p,world["spawn_xz"])<6:
            continue
        if any(math.dist(p,q)<3.2 for q in placed):
            continue
        asset=rng.choices(names,weights)[0]
        world["objects"].append({"asset_id":asset,"position_xyz":[round(p[0],3),round(height(p),3),round(p[1],3)],
                                 "yaw_rad":round(rng.uniform(0,math.tau),4),"scale":round(rng.uniform(0.85,1.25),3),
                                 "interactive":False,"provenance_variant":"scale_rules"})
        placed.append(p)
        counts[asset]+=1
world["scale_probe"]={"parent":"variants/E/world_spec.json","bounds_m":[160,160],
                      "parent_object_count":core_count,"route_cleared_count":len(route_cleared),
                      "route_cleared":route_cleared,"new_object_count":sum(counts.values()),
                      "new_assets":dict(counts),"purpose":"layout/repetition/route/performance scaling"}
world["provenance"]["source_plan"]="variants/E/world_spec.json + deterministic outer orchard rules"
out=HERE/"world_spec.json"
out.write_text(json.dumps(world,indent=2)+"\n")
print(f"SCALE 160m objects={len(world['objects'])} new={sum(counts.values())} route_vertices={len(world['path_xz'])}")
