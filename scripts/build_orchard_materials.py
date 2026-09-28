"""Deterministic, tileable stylised terrain maps and authored Orchard masks.

The macro mask is world-scale; the other maps repeat every few metres. Keeping
those frequencies separate prevents the same obvious patch repeating to the
horizon while retaining close-range texture in the headset.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "godot" / "assets" / "atmosphere"
SIZE = 512
RNG = np.random.default_rng(290929)


def periodic(cells: int) -> np.ndarray:
    grid = RNG.random((cells, cells), dtype=np.float32)
    image = Image.fromarray(np.uint8(grid * 255), "L")
    tiled = Image.fromarray(np.tile(np.asarray(image), (3, 3)), "L")
    enlarged = tiled.resize((SIZE * 3, SIZE * 3), Image.Resampling.BICUBIC)
    return np.asarray(enlarged.crop((SIZE, SIZE, SIZE * 2, SIZE * 2)), dtype=np.float32) / 255.0


def save_rgb(name: str, values: np.ndarray) -> None:
    Image.fromarray(np.uint8(np.clip(values, 0, 1) * 255), "RGB").save(OUT / name, optimize=True)


def terrain_maps() -> None:
    broad, middle, fine, grain = periodic(5), periodic(19), periodic(67), periodic(166)
    organic = (broad - .5) * .16 + (middle - .5) * .11 + (fine - .5) * .048 + (grain - .5) * .018
    grass = np.empty((SIZE, SIZE, 3), dtype=np.float32)
    soil = np.empty_like(grass)
    grass[:] = (.34, .42, .20)
    soil[:] = (.43, .33, .21)
    grass += organic[..., None] * np.array((.82, .92, .45), dtype=np.float32)
    soil += organic[..., None] * np.array((.85, .66, .38), dtype=np.float32)
    # Tiny warm leaf/seed flecks carry material identity at eye height. Their
    # density is low enough that the tile never becomes a recognisable stamp.
    fleck = (fine > .79) & (grain > .54)
    grass[fleck] = grass[fleck] * .78 + np.array((.76, .60, .25), dtype=np.float32) * .22
    pebble = (fine < .20) & (grain > .70)
    soil[pebble] = soil[pebble] * .70 + np.array((.62, .57, .44), dtype=np.float32) * .30
    save_rgb("grass_albedo.png", grass)
    save_rgb("soil_albedo.png", soil)
    height = broad * .40 + middle * .32 + fine * .20 + grain * .08
    slope_y, slope_x = np.gradient(height)
    normal = np.stack((-slope_x * 4, np.ones_like(height), -slope_y * 4), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Tangent-space normal map: x/y tangent axes, z points out of the surface.
    tangent = np.stack((normal[..., 0], normal[..., 2], normal[..., 1]), axis=-1)
    save_rgb("micro_normal.png", tangent * .5 + .5)


def orchard_trail() -> list[tuple[float, float]]:
    source = (ROOT / "godot" / "orchard_expansion.gd").read_text(encoding="utf-8")
    trail = source.split("const TRAIL := [", 1)[1].split("]", 1)[0]
    return [(float(x), float(z)) for x, z in re.findall(r"Vector3\((-?\d+),0,(-?\d+)\)", trail)]


def macro_mask() -> None:
    px = (np.arange(SIZE, dtype=np.float32) + .5) * 320 / SIZE - 160
    x, z = np.meshgrid(px, px)
    distance = np.full_like(x, 10000)
    path = orchard_trail()
    for (ax, az), (bx, bz) in zip(path, path[1:]):
        dx, dz = bx - ax, bz - az
        t = np.clip(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1)
        distance = np.minimum(distance, np.hypot(x - (ax + t * dx), z - (az + t * dz)))
    route = 1 - np.clip((distance - 2.0) / 3.2, 0, 1)
    route = route * route * (3 - 2 * route)
    # Windfall Brook's position follows the real gameplay geometry. Its damp
    # bank remains visible even when rain has stopped.
    bank_center = -48 + np.sin(x * .078) * 1.1 + np.sin(x * .18) * .25
    bank = (1 - np.clip((np.abs(z - bank_center) - 2.5) / 7.0, 0, 1)) * ((x >= -31) & (x <= 96))
    patch = periodic(7)
    fine = periodic(29)
    leaf = np.clip((patch - .37) * 2.3 + (fine - .5) * .28, 0, 1) * (1 - route * .75)
    stone = np.clip((periodic(11) - .64) * 2.6, 0, 1) * (1 - route * .8)
    mask = np.stack((route, leaf, bank, stone), axis=-1)
    Image.fromarray(np.uint8(np.clip(mask, 0, 1) * 255), "RGBA").save(OUT / "orchard_masks.png", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    terrain_maps()
    macro_mask()
    for image in sorted(OUT.glob("*.png")):
        print(f"ORCHARD_MATERIAL {image.name} {image.stat().st_size} bytes")
