"""Extract, validate, and preview Orchard Brook plans. Python + Pillow + NumPy."""
from __future__ import annotations

import argparse
import heapq
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = json.loads((ROOT / "benchmark.json").read_text(encoding="utf-8"))
SIZE = 512
METRES = 80.0
PALETTE = {
    "grass": (0x91, 0xAD, 0x70),
    "path": (0xB9, 0x88, 0x58),
    "water": (0x3F, 0x91, 0xB8),
    "stone": (0x77, 0x7F, 0x83),
    "trees": (0x34, 0x6B, 0x3B),
    "clear": (0xF2, 0xE8, 0xB9),
    "spawn": (0xF7, 0xD5, 0x4A),
    "goal": (0xD0, 0x60, 0xBB),
    "crossing": (0xF7, 0xF7, 0xF2),
}
SURFACE_COLOURS = {**PALETTE, "earth": (0xBC, 0xA5, 0x68)}
NAMES = tuple(PALETTE)
RGB = np.asarray(tuple(PALETTE.values()), dtype=np.int16)


def pixel_to_world(u: float, v: float) -> list[float]:
    return [round(-40 + 80 * (u + .5) / SIZE, 4), round(-40 + 80 * (v + .5) / SIZE, 4)]


def world_to_pixel(x: float, z: float) -> tuple[float, float]:
    return ((x + 40) * SIZE / 80 - .5, (z + 40) * SIZE / 80 - .5)


def save_mask(mask: np.ndarray, path: Path) -> None:
    Image.fromarray((mask.astype(np.uint8) * 255), "L").save(path)


def component_polygon(comp: np.ndarray) -> list[list[float]]:
    """Eight directional support points give a compact, stable region outline."""
    xy = comp[:, ::-1]
    points = []
    for theta in np.linspace(0, 2 * math.pi, 8, endpoint=False):
        direction = np.array([math.cos(theta), math.sin(theta)])
        point = xy[np.argmax(xy @ direction)]
        points.append(pixel_to_world(float(point[0]), float(point[1])))
    return points


def source_details(label: np.ndarray, spec: dict, out: Path) -> None:
    """Add objects, terrain and registered raster layers from the same map."""
    px_per_m = SIZE / METRES
    hills = []
    for i, comp in enumerate(components(label == NAMES.index("path"), 400)):
        xy = comp[:, ::-1].astype(float)
        major, minor = np.linalg.svd(xy - xy.mean(axis=0), compute_uv=False)[:2]
        # Long path halves are separated by the bridge; compact earth patches are hills.
        if major / max(minor, 1) > 4:
            continue
        u, v = xy.mean(axis=0)
        radius = math.sqrt(len(comp) / math.pi) / px_per_m
        hills.append({"center_xz": pixel_to_world(u, v), "radius_m": round(radius * 1.45, 3),
                      "amplitude_m": round(min(2.4, .35 + radius * .16), 3)})
        spec["regions"].append({"name": f"earth_hill_{i+1}", "polygon_xz": component_polygon(comp),
                                "surface": "earth", "tree_density": 0})
    spec["terrain"]["hills"] = hills
    for i, comp in enumerate(components(label == NAMES.index("stone"), 20)):
        u, v = comp[:, ::-1].mean(axis=0)
        xy = comp[:, ::-1].astype(float)
        _, _, axes = np.linalg.svd(xy - xy.mean(axis=0), full_matrices=False)
        axis = axes[0]
        extent = np.ptp(xy @ axis) / px_per_m
        asset = "wall_straight" if len(comp) >= 80 and extent >= 2 else "rubble_split"
        x, z = pixel_to_world(u, v)
        spec["objects"].append({"asset_id": asset, "position_xyz": [x, 0, z],
                                "yaw_rad": round(math.atan2(axis[1],axis[0]), 4),
                                "scale": round(max(.6,min(2.5,extent/3)),3), "interactive": False,
                                "source": "stone mask"})
        spec["regions"].append({"name": f"stone_{i+1}", "polygon_xz": component_polygon(comp),
                                "surface": "stone", "tree_density": 0})
    for i, comp in enumerate(components(label == NAMES.index("trees"), 35)):
        u, v = comp[:, ::-1].mean(axis=0)
        radius_m = math.sqrt(len(comp) / math.pi) / px_per_m
        x, z = pixel_to_world(u, v)
        spec["objects"].append({"asset_id": "apple_tree_mature" if radius_m > 1.8 else "apple_tree_young",
                                "position_xyz": [x, 0, z], "yaw_rad": round((i * 2.399963) % (2 * math.pi), 4),
                                "scale": round(max(.65,min(1.8,radius_m/2.5)),3), "interactive": False,
                                "source": "tree canopy mask"})
    # Raster layers have identical dimensions/orientation to the semantic mask.
    yy, xx = np.mgrid[:SIZE, :SIZE]
    height = np.zeros((SIZE, SIZE), dtype=np.float32)
    for hill in hills:
        u, v = world_to_pixel(*hill["center_xz"])
        sigma = hill["radius_m"] * px_per_m
        height += hill["amplitude_m"] * np.exp(-((xx-u)**2+(yy-v)**2)/(2*sigma*sigma))
    Image.fromarray(np.uint8(np.clip(height/3 * 255, 0, 255)), "L").save(out / "mask_height.png")
    density = Image.fromarray(np.uint8((label == NAMES.index("trees"))*255), "L").filter(ImageFilter.GaussianBlur(18))
    density.save(out / "mask_density.png")
    spec["planning"]["height_encoding"] = "greyscale 0=0m, 255=3m; derived from source hill patches"
    spec["planning"]["density_encoding"] = "blurred tree canopy occupancy, 0..255; source-aligned"
    for obj in spec["objects"]:
        xyz = obj["position_xyz"]
        xyz[1] = round(terrain_height(spec, (xyz[0], xyz[2])), 4)
    heights = [o["position_xyz"][1] for o in spec["objects"]]
    spec["planning"]["grounding_delta_m"] = {"object_count": len(heights),
        "min": min(heights, default=0), "max": max(heights, default=0),
        "mean": round(sum(heights)/len(heights),4) if heights else 0}


def classify(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Colour distance in RGB, then local majority for antialias fringes."""
    flat = rgb.astype(np.int16)
    # Perceptual-ish weighting; broad uncertainty is reported, not hidden.
    delta = (flat[:, :, None, :] - RGB[None, None, :, :]).astype(np.float32)
    distance = np.sqrt((delta * delta * [0.3, 0.59, 0.11]).sum(axis=3))
    label = distance.argmin(axis=2).astype(np.uint8)
    confidence = distance.min(axis=2)
    # Semantic regions may be ragged, but tiny one-pixel islands are usually JPEG/AA noise.
    label = np.asarray(Image.fromarray(label, "L").filter(ImageFilter.ModeFilter(3)))
    return label, confidence


def components(mask: np.ndarray, min_area: int = 1) -> list[np.ndarray]:
    """Connected components as arrays of (v,u); 8-neighbour islands."""
    seen = np.zeros(mask.shape, bool)
    found: list[np.ndarray] = []
    height, width = mask.shape
    for v, u in np.argwhere(mask):
        if seen[v, u]:
            continue
        stack = [(int(v), int(u))]
        seen[v, u] = True
        coords = []
        while stack:
            y, x = stack.pop()
            coords.append((y, x))
            for yy in range(max(0, y - 1), min(height, y + 2)):
                for xx in range(max(0, x - 1), min(width, x + 2)):
                    if mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
        if len(coords) >= min_area:
            found.append(np.asarray(coords))
    return sorted(found, key=len, reverse=True)


def anchor(label: np.ndarray, name: str, expected: tuple[float, float], warnings: list[str]) -> tuple[float, float]:
    bits = label == NAMES.index(name)
    # Marker isolation prevents a large patch elsewhere winning over the expected anchor.
    comps = components(bits, min_area=8)
    eu, ev = world_to_pixel(*expected)
    if comps:
        comp = min(comps, key=lambda c: ((c[:, 1].mean() - eu) ** 2 + (c[:, 0].mean() - ev) ** 2) / max(1, math.sqrt(len(c))))
        v, u = comp.mean(axis=0)
        if math.hypot(u - eu, v - ev) > 90:
            warnings.append(f"{name} marker is far from benchmark anchor: {math.hypot(u-eu,v-ev):.1f} px")
        return (float(u), float(v))
    warnings.append(f"{name} marker absent; benchmark anchor substituted and provenance marks fallback")
    return (eu, ev)


def trace_stream(water: np.ndarray, warnings: list[str]) -> tuple[list[list[float]], float]:
    comp = components(water, min_area=100)
    if not comp:
        raise ValueError("No substantial water component; cannot extract stream")
    # A bridge painted over the stream splits the water mask. Keep substantial
    # arms; short isolated blue patches remain excluded as pond candidates.
    largest = len(comp[0])
    coords = np.concatenate([c for c in comp if len(c) >= largest * .2])[:, ::-1].astype(float)  # u,v
    centre = coords.mean(axis=0)
    _, _, vh = np.linalg.svd(coords - centre, full_matrices=False)
    axis = vh[0]
    if axis[1] < 0:
        axis = -axis
    projection = (coords - centre) @ axis
    lo, hi = np.quantile(projection, [0.015, 0.985])
    points = []
    widths = []
    for t in np.arange(lo, hi + 1, 20):
        segment = coords[np.abs(projection - t) <= 11]
        if len(segment) < 8:
            continue
        # Median suppresses side ponds, bank raggedness and antialias fringes.
        xy = np.median(segment, axis=0)
        across = (segment - xy) @ np.array([-axis[1], axis[0]])
        widths.append(float(np.quantile(across, .9) - np.quantile(across, .1)))
        points.append(pixel_to_world(*xy))
    if len(points) < 3:
        raise ValueError("Water component is too short to identify a stream")
    width_m = max(BENCHMARK["fixed_gameplay"]["stream_min_width_m"], float(np.median(widths)) * METRES / SIZE)
    if max(widths) > 3 * np.median(widths):
        warnings.append("Stream width varies sharply; inspect water mask for ponds or branching")
    return points, round(width_m, 3)


def route(label: np.ndarray, start: tuple[float, float], goal: tuple[float, float], bridge: tuple[float, float], warnings: list[str]) -> list[list[float]]:
    """Least-cost walk on downsampled semantic map, forced through bridge."""
    step = 4
    h = SIZE // step
    small = np.asarray(Image.fromarray(label, "L").resize((h, h), Image.Resampling.NEAREST))
    def cell(pt):
        return (max(0, min(h - 1, round(pt[1] / step))), max(0, min(h - 1, round(pt[0] / step))))
    s, b, g = cell(start), cell(bridge), cell(goal)
    path_id = NAMES.index("path")
    water_id = NAMES.index("water")
    trees_id = NAMES.index("trees")
    stone_id = NAMES.index("stone")
    crossing_id = NAMES.index("crossing")
    def search(a, target):
        q = [(0.0, a)]
        best = {a: 0.0}
        previous = {}
        while q:
            cost, p = heapq.heappop(q)
            if p == target:
                out = [p]
                while p != a:
                    p = previous[p]
                    out.append(p)
                return out[::-1]
            if cost != best[p]:
                continue
            for dy, dx in ((0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)):
                y, x = p[0] + dy, p[1] + dx
                if not (0 <= y < h and 0 <= x < h):
                    continue
                label_id = small[y, x]
                if label_id == water_id and math.hypot(y - b[0], x - b[1]) > 3:
                    continue
                multiplier = {path_id: 1, crossing_id: 1, stone_id: 2, trees_id: 15, water_id: 2}.get(label_id, 5)
                nc = cost + multiplier * math.hypot(dx, dy)
                np_ = (y, x)
                if nc < best.get(np_, float("inf")):
                    best[np_] = nc
                    previous[np_] = p
                    heapq.heappush(q, (nc, np_))
        raise ValueError("No route around water through crossing")
    cells = search(s, b)[:-1] + search(b, g)
    off_path = sum(small[y, x] != path_id for y, x in cells) / len(cells)
    if off_path > .3:
        warnings.append(f"Extracted route has {off_path:.0%} off-path cells; drawn path may be disconnected")
    # Keep changes in bearing; preserve crossing and endpoints.
    reduced = [cells[0]]
    previous_heading = None
    for i in range(1, len(cells)):
        heading = (cells[i][0] - cells[i-1][0], cells[i][1] - cells[i-1][1])
        if previous_heading is not None and heading != previous_heading:
            reduced.append(cells[i-1])
        elif math.dist(cells[i], reduced[-1]) * step * METRES / SIZE >= 8:
            reduced.append(cells[i])
        previous_heading = heading
    reduced.append(cells[-1])
    return [pixel_to_world(x * step + step / 2 - .5, y * step + step / 2 - .5) for y, x in reduced]


def extract(image_path: Path, out: Path, model: str = "unknown") -> dict:
    t0 = time.perf_counter()
    out.mkdir(parents=True, exist_ok=True)
    source = Image.open(image_path).convert("RGB")
    original_size = source.size
    if source.size != (SIZE, SIZE):
        source = source.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    source.save(out / "source_map.png")
    label, confidence = classify(np.asarray(source))
    warnings = []
    uncertain = float((confidence > 65).mean())
    if uncertain > .05:
        warnings.append(f"{uncertain:.1%} pixels differ strongly from semantic palette")
    for name in NAMES:
        save_mask(label == NAMES.index(name), out / f"mask_{name}.png")
    spawn = anchor(label, "spawn", tuple(BENCHMARK["fixed_gameplay"]["spawn_xz"]), warnings)
    goal = anchor(label, "goal", tuple(BENCHMARK["fixed_gameplay"]["goal_xz"]), warnings)
    bridge = anchor(label, "crossing", (0, 0), warnings)
    stream, width = trace_stream(label == NAMES.index("water"), warnings)
    path = route(label, spawn, goal, bridge, warnings)
    extracted_spawn = pixel_to_world(*spawn)
    extracted_goal = pixel_to_world(*goal)
    fixed_spawn = BENCHMARK["fixed_gameplay"]["spawn_xz"]
    fixed_goal = BENCHMARK["fixed_gameplay"]["goal_xz"]
    path[0] = fixed_spawn[:]
    path[-1] = fixed_goal[:]
    center = pixel_to_world(*bridge)
    # Approximate stream tangent at nearest centreline point, then orient bridge perpendicular.
    n = min(range(len(stream)), key=lambda i: math.dist(center, stream[i]))
    p0, p1 = stream[max(0, n-1)], stream[min(len(stream)-1, n+1)]
    # Godot deck length is local Z: yaw=0 has X/Z axis (0,1).
    # A stream tangent (dx,dz) needs the perpendicular (-dz,dx).
    yaw = math.atan2(-(p1[1]-p0[1]), p1[0]-p0[0])
    spec = {
        "version": 1, "variant": "B", "method": "image-led palette extraction", "seed": 0,
        "bounds_m": [80, 80], "spawn_xz": fixed_spawn[:], "goal_xz": fixed_goal[:],
        "path_xz": path, "stream": {"points_xz": stream, "width_m": width},
        "crossing": {"center_xz": center, "width_m": 3.5, "length_m": round(width + 2.0, 3), "yaw_rad": round(yaw, 5)},
        "terrain": {"base_height_m": 0, "hills": []},
        "regions": [], "objects": [],
        "exclusions": [{"type": "circle", "center_xz": center, "radius_m": 3.5, "reason": "bridge clearance"}],
        "provenance": {"source_image": str(image_path.resolve()), "source_plan": "source_map.png",
                       "tools": ["Pillow", "NumPy", "planning/plan.py"], "model": model,
                       "measured_time_s": round(time.perf_counter()-t0, 3),
                       "source_dimensions_px": list(original_size), "registered_dimensions_px": [SIZE, SIZE],
                       "registration": "full-frame Lanczos resize to 512x512; no crop or transform",
                       "anchor_fallbacks": [w.split()[0] for w in warnings if "marker absent" in w]},
        "planning": {"mask_prefix": "mask_", "coordinate_mapping": BENCHMARK["raster"]["mapping"],
                     "uncertain_pixel_fraction": round(uncertain, 4), "warnings": warnings,
                     "anchor_snap": {"spawn_extracted_xz": extracted_spawn, "goal_extracted_xz": extracted_goal,
                                     "spawn_delta_m": round(math.dist(extracted_spawn,fixed_spawn),4),
                                     "goal_delta_m": round(math.dist(extracted_goal,fixed_goal),4)}},
    }
    source_details(label, spec, out)
    (out / "world_spec.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    preview(spec, out / "plan_preview.png")
    (out / "extraction_report.json").write_text(json.dumps({"warnings": warnings, "palette_fraction": round(1-uncertain,4)}, indent=2), encoding="utf-8")
    return spec


def preview(spec: dict, path: Path) -> None:
    """Structure-led preview drawn solely from saved world_spec fields."""
    im = Image.new("RGB", (SIZE, SIZE), PALETTE["grass"])
    d = ImageDraw.Draw(im)
    def coords(points):
        return [world_to_pixel(*p) for p in points]
    for region in spec.get("regions", []):
        if region.get("polygon_xz"):
            d.polygon(coords(region["polygon_xz"]), fill=SURFACE_COLOURS.get(region.get("surface"), PALETTE["clear"]))
    stream = spec["stream"]
    d.line(coords(stream["points_xz"]), fill=PALETTE["water"], width=max(1, round(stream["width_m"]*SIZE/METRES)))
    d.line(coords(spec["path_xz"]), fill=PALETTE["path"], width=round(3*SIZE/METRES), joint="curve")
    cross = spec["crossing"]
    x, y = world_to_pixel(*cross["center_xz"])
    half_w = cross["width_m"]*SIZE/METRES/2
    half_l = cross["length_m"]*SIZE/METRES/2
    angle = cross["yaw_rad"]
    ux, uy = math.sin(angle), math.cos(angle)
    vx, vy = -uy, ux
    quad = [(x+a*ux*half_l+b*vx*half_w, y+a*uy*half_l+b*vy*half_w) for a,b in ((-1,-1),(1,-1),(1,1),(-1,1))]
    d.polygon(quad, fill=PALETTE["crossing"], outline=PALETTE["stone"])
    for key in ("spawn", "goal"):
        x, y = world_to_pixel(*spec[f"{key}_xz"])
        d.ellipse((x-9,y-9,x+9,y+9), fill=PALETTE[key], outline=(0,0,0), width=2)
    for obj in spec.get("objects", []):
        x, y = world_to_pixel(obj["position_xyz"][0], obj["position_xyz"][2])
        colour = PALETTE["trees"] if "tree" in obj["asset_id"] else PALETTE["stone"]
        radius = 3 * obj.get("scale",1)
        d.ellipse((x-radius,y-radius,x+radius,y+radius), fill=colour)
    im.save(path)


def distance_point_segment(p, a, b):
    ax, az = a; bx, bz = b
    length2 = (bx-ax)**2 + (bz-az)**2
    t = max(0, min(1, ((p[0]-ax)*(bx-ax)+(p[1]-az)*(bz-az))/length2)) if length2 else 0
    return math.dist(p, (ax+t*(bx-ax), az+t*(bz-az)))


def terrain_height(spec: dict, point: tuple[float, float]) -> float:
    value = spec["terrain"].get("base_height_m", 0)
    for hill in spec["terrain"].get("hills", []):
        radius = hill["radius_m"]
        d = math.dist(point, hill["center_xz"])
        value += hill["amplitude_m"] * math.exp(-.5 * (d/radius)**2)
    return value


def validate(spec: dict) -> list[str]:
    errors = []
    required = ("version","variant","method","seed","bounds_m","spawn_xz","goal_xz","path_xz","stream","crossing","terrain","regions","objects","exclusions","provenance")
    for key in required:
        if key not in spec:
            errors.append(f"Missing required field: {key}")
    if errors:
        return errors
    if spec["version"] != 1 or spec["bounds_m"] != [80,80]:
        errors.append("Version or bounds differ from v1 benchmark")
    points = spec["path_xz"]
    if len(points) < 2:
        errors.append("Route has fewer than two vertices")
        return errors
    if math.dist(points[0], spec["spawn_xz"]) > 3 or math.dist(points[-1], spec["goal_xz"]) > 3:
        errors.append("Route endpoints do not connect spawn and goal within 3 m")
    for p in points + spec["stream"]["points_xz"] + [spec["crossing"]["center_xz"]]:
        if not (-40 <= p[0] <= 40 and -40 <= p[1] <= 40):
            errors.append(f"Plan vertex outside bounds: {p}")
            break
    crossing = spec["crossing"]
    if math.dist(crossing["center_xz"], (0,0)) > 8:
        errors.append("Crossing is beyond 8 m benchmark neighbourhood")
    if crossing["width_m"] < 3:
        errors.append("Bridge walkable width below 3 m")
    if crossing["length_m"] < spec["stream"]["width_m"] + 1:
        errors.append("Bridge length does not span stream with 0.5 m banks")
    if min(distance_point_segment(crossing["center_xz"], a, b) for a,b in zip(points,points[1:])) > 2:
        errors.append("Route misses bridge centre by over 2 m")
    bridge_axis = (math.sin(crossing["yaw_rad"]), math.cos(crossing["yaw_rad"]))
    near_a, near_b = min(zip(points,points[1:]), key=lambda ab: math.dist(crossing["center_xz"], [(ab[0][j]+ab[1][j])/2 for j in (0,1)]))
    segment_len = math.dist(near_a, near_b)
    alignment = abs(sum(bridge_axis[j] * (near_b[j]-near_a[j]) / segment_len for j in (0,1))) if segment_len else 0
    if alignment < .7:
        errors.append(f"Bridge deck is misaligned with route ({alignment:.3f} < 0.7)")
    if min(distance_point_segment(crossing["center_xz"], a, b) for a,b in zip(spec["stream"]["points_xz"],spec["stream"]["points_xz"][1:])) > spec["stream"]["width_m"]/2 + 1:
        errors.append("Bridge does not intersect stream")
    for a,b in zip(points, points[1:]):
        if math.dist(a,b) > 12:
            errors.append("Route segment exceeds 12 m; likely lost path continuity")
            break
    stream = spec["stream"]
    water_runs = 0
    inside = False
    max_grade = 0.0
    for a,b in zip(points,points[1:]):
        length = math.dist(a,b)
        samples = max(1, math.ceil(length/.4))
        for i in range(samples+1):
            t = i/samples
            p = (a[0]*(1-t)+b[0]*t, a[1]*(1-t)+b[1]*t)
            distance = min(distance_point_segment(p, c, d) for c,d in zip(stream["points_xz"],stream["points_xz"][1:]))
            wet = distance < stream["width_m"]/2
            if wet and not inside:
                water_runs += 1
            inside = wet
            if wet and math.dist(p,crossing["center_xz"]) > crossing["length_m"]/2 + 1:
                errors.append("Route enters non-fordable stream outside bridge")
                break
            if i:
                prev = (a[0]*(1-(i-1)/samples)+b[0]*(i-1)/samples,
                        a[1]*(1-(i-1)/samples)+b[1]*(i-1)/samples)
                max_grade = max(max_grade, abs(terrain_height(spec,p)-terrain_height(spec,prev)) / max(.001,math.dist(p,prev)))
        if any("non-fordable" in e for e in errors):
            break
    if water_runs != 1:
        errors.append(f"Route intersects stream {water_runs} times; exactly one bridge crossing required")
    if max_grade > BENCHMARK["fixed_gameplay"]["terrain_max_route_grade"]:
        errors.append(f"Route grade {max_grade:.2f} exceeds benchmark 0.24")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("extract")
    p.add_argument("image", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--model", default="unknown")
    p = sub.add_parser("validate")
    p.add_argument("spec", type=Path)
    p = sub.add_parser("preview")
    p.add_argument("spec", type=Path)
    p.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "extract":
        spec = extract(args.image, args.output, args.model)
        print(json.dumps({"spec":str(args.output / "world_spec.json"), "errors":validate(spec), "warnings":spec["planning"]["warnings"]}, indent=2))
    elif args.command == "validate":
        errors = validate(json.loads(args.spec.read_text(encoding="utf-8")))
        print(json.dumps({"valid":not errors,"errors":errors},indent=2))
        raise SystemExit(bool(errors))
    else:
        preview(json.loads(args.spec.read_text(encoding="utf-8")), args.output)
        print(args.output)


if __name__ == "__main__":
    main()
