"""Build the Wayfarer's Forge landmark with Blender 4.5.13.

    blender --background --factory-startup --python-exit-code 2 \
      --python build_forge.py -- --out ABS_PATH

Authored in Blender Z-up with the working face toward Blender +Y. The glTF
exporter's Y-up conversion maps Blender (x, y, z) to Godot (x, z, -y), so the
front faces Godot -Z and the origin is the ground centre.
Only the joined art meshes and socket empties are exported; the studio
(ground, lights, camera) stays in the .blend for review renders.
"""

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

T0 = time.time()


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--no-render", action="store_true")
    args = parser.parse_args(tail)
    if not args.out.is_absolute():
        parser.error("--out must be an absolute directory")
    return args


ARGS = arguments()
OUT = ARGS.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "sockets").mkdir(exist_ok=True)
RNG = random.Random(1307)

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for mesh in list(bpy.data.meshes):
    bpy.data.meshes.remove(mesh)
scene = bpy.context.scene


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


ART = collection("Art_Parts")
SOCKETS = collection("Sockets")
STUDIO = collection("Studio")


# --------------------------------------------------------------------------
# Embedded painted textures (sRGB byte images, packed into the GLB).
# --------------------------------------------------------------------------
SIZE = 256


def noise(seed, cells, octaves=4):
    """Tileable value noise in 0..1."""
    rs = np.random.RandomState(seed)
    out = np.zeros((SIZE, SIZE))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = cells * (2 ** o)
        grid = rs.rand(n, n)
        rep = SIZE // n
        up = np.kron(grid, np.ones((rep, rep)))
        for _ in range(2):  # wrap-around box blur keeps it tileable
            k = max(1, rep // 2)
            up = sum(np.roll(np.roll(up, dx, 0), dy, 1)
                     for dx in (-k, 0, k) for dy in (-k, 0, k)) / 9.0
        out += up * amp
        total += amp
        amp *= 0.5
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-9)


def rgb(hex_color):
    return np.array([int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def lerp(a, b, t):
    return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]


def stone_texture():
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    row_h = 64
    row = yy // row_h
    widths = [96, 80, 112, 88]
    offs = [0, 41, 17, 63]
    w = np.choose(row % 4, widths)
    o = np.choose(row % 4, offs)
    col = (xx + o) // w
    bx = (xx + o) % w
    by = yy % row_h
    edge = np.minimum(np.minimum(bx, w - bx), np.minimum(by, row_h - by))
    tint = ((np.sin(row * 12.9898 + col * 78.233) * 43758.5453) % 1.0)
    n = noise(11, 8)
    fine = noise(12, 32, 2)
    base = lerp(rgb("7e766c"), rgb("a39784"), 0.25 + 0.5 * tint)
    base = base * (0.78 + 0.32 * n[..., None]) * (0.92 + 0.12 * fine[..., None])
    grime = np.clip(1.0 - edge / 9.0, 0, 1)
    base = base * (1 - 0.35 * grime[..., None])
    mortar = edge < 3
    base[mortar] = rgb("3c3631") * (0.8 + 0.3 * n[mortar][..., None])
    return base


def iron_texture():
    n = noise(21, 16, 3)
    dimples = noise(22, 32, 1)
    rust = noise(23, 8, 3)
    base = lerp(rgb("3a3735"), rgb("6a635b"), np.clip(dimples * 1.4 - 0.2, 0, 1))
    base *= (0.85 + 0.25 * n[..., None])
    r = np.clip((rust - 0.72) * 5, 0, 1)
    return base * (1 - r[..., None]) + rgb("6e3d22")[None, None, :] * r[..., None]


def copper_texture():
    n = noise(31, 16, 3)
    pat = noise(32, 4, 4)
    base = lerp(rgb("9c5530"), rgb("d58a52"), n)
    p = np.clip((pat - 0.68) * 4, 0, 0.75)
    return base * (1 - p[..., None]) + rgb("4d8c78")[None, None, :] * p[..., None]


def wood_texture():
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    warp = noise(41, 4, 3)
    grain = 0.5 + 0.5 * np.sin((xx / SIZE * 2 * math.pi * 9) + warp * 7.0)
    fine = noise(42, 64, 1)
    base = lerp(rgb("4f3420"), rgb("8a6040"), grain * 0.7 + fine * 0.3)
    planks = (xx % 64) < 2
    base[planks] *= 0.45
    return base


def make_image(name, array):
    img = bpy.data.images.new(name, width=SIZE, height=SIZE, alpha=False)
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(array, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = str(OUT / "textures" / f"{name}.png")
    (OUT / "textures").mkdir(exist_ok=True)
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def linear(hex_color):
    v = rgb(hex_color)
    return [float(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in v] + [1.0]


def material(name, hex_color, metallic, roughness, image=None, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = linear(hex_color)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if image is not None:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.location = (-400, 200)
        mat.node_tree.links.new(node.outputs["Color"], p.inputs["Base Color"])
    if emission:
        p.inputs["Emission Color"].default_value = linear(emission)
        p.inputs["Emission Strength"].default_value = strength
    return mat


STONE = material("Forge_Stone", "a09482", 0.0, 0.88, make_image("forge_stone", stone_texture()))
IRON = material("Hammered_Iron", "7a736c", 0.75, 0.52, make_image("forge_iron", iron_texture()))
COPPER = material("Worn_Copper", "c98050", 0.85, 0.38, make_image("forge_copper", copper_texture()))
WOOD = material("Oiled_Wood", "8a6040", 0.0, 0.78, make_image("forge_wood", wood_texture()))
LEATHER = material("Saddle_Leather", "6a3d22", 0.0, 0.7)
SOOT = material("Soot_Recess", "1a1513", 0.0, 0.95)
EMBER = material("Hearth_Ember", "ff8a3a", 0.0, 0.6, emission="ff4a08", strength=2.6)
ARCANE = material("Arcane_Core", "8a6cff", 0.0, 0.25, emission="7f55ff", strength=3.0)
MATERIALS = [STONE, IRON, COPPER, WOOD, LEATHER, SOOT, EMBER, ARCANE]
UV_SCALE = {STONE.name: 1.4, IRON.name: 0.8, COPPER.name: 0.6, WOOD.name: 0.9,
            LEATHER.name: 1.0, SOOT.name: 1.0, EMBER.name: 0.5, ARCANE.name: 0.5}


# --------------------------------------------------------------------------
# Geometry helpers (sizes baked into mesh so bevels stay uniform).
# --------------------------------------------------------------------------
PARTS = []


def finish(name, bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, segments=1):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    ART.objects.link(obj)
    obj.data.materials.append(mat)
    obj.location = loc
    obj.rotation_euler = Euler([math.radians(a) for a in rot])
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(35)
        mod.harden_normals = False
    PARTS.append(obj)
    return obj


def box(name, size, loc, mat, rot=(0, 0, 0), bevel=0.0, segments=1, taper=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if taper:
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
    return finish(name, bm, mat, loc, rot, bevel, segments)


def cyl(name, r1, r2, depth, loc, mat, segs=12, rot=(0, 0, 0), scale=(1, 1, 1),
        bevel=0.0, segments=1, jitter=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    if jitter:
        for v in bm.verts:
            v.co.x += RNG.uniform(-jitter, jitter)
            v.co.y += RNG.uniform(-jitter, jitter)
    return finish(name, bm, mat, loc, rot, bevel, segments)


def lump(name, radius, loc, mat, squash=(1, 1, 1), jitter=0.25, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    for v in bm.verts:
        v.co *= 1 + RNG.uniform(-jitter, jitter)
    bmesh.ops.scale(bm, vec=squash, verts=bm.verts)
    return finish(name, bm, mat, loc, (RNG.uniform(0, 360), 0, RNG.uniform(0, 360)))


def bar(name, start, end, radius, mat, segs=8, bevel=0.0):
    start, end = Vector(start), Vector(end)
    d = end - start
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius,
                          radius2=radius, depth=d.length)
    obj = finish(name, bm, mat, (start + end) / 2, (0, 0, 0), bevel)
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return obj


def prism(name, pts, thick, mat, plane="XY", loc=(0, 0, 0), rot=(0, 0, 0),
          top_scale=None, bevel=0.0, segments=1):
    bm = bmesh.new()
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    lo, hi = [], []
    for u, v in pts:
        if plane == "XY":
            lo.append(bm.verts.new((u, v, 0.0)))
            tu, tv = u, v
            if top_scale:
                tu = cx + (u - cx) * top_scale[0]
                tv = cy + (v - cy) * top_scale[1]
            hi.append(bm.verts.new((tu, tv, thick)))
        else:  # XZ outline, thickness along Y
            lo.append(bm.verts.new((u, -thick / 2, v)))
            hi.append(bm.verts.new((u, thick / 2, v)))
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    n = len(pts)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    return finish(name, bm, mat, loc, rot, bevel, segments)


def torus(name, major, minor, mat, loc, rot=(0, 0, 0), seg=16, side=6):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = math.tau * i / seg
        ring = []
        for j in range(side):
            b = math.tau * j / side
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(side):
            a, b = rings[i], rings[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % side], a[(j + 1) % side]))
    return finish(name, bm, mat, loc, rot)


def ellipse(rx, ry, n, jitter=0.0, phase=0.0):
    return [((rx + RNG.uniform(-jitter, jitter)) * math.cos(phase + math.tau * i / n),
             (ry + RNG.uniform(-jitter, jitter)) * math.sin(phase + math.tau * i / n))
            for i in range(n)]


def chamfer_rect(x0, x1, y0, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c),
            (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


# --------------------------------------------------------------------------
# The forge. Blender +Y is the open working front.
# --------------------------------------------------------------------------
HX, HY = -0.30, -0.20            # hearth centre
# Settled stone plinth: irregular flag base with a worn front step.
prism("Plinth", ellipse(1.36, 1.08, 14, 0.05, 0.1), 0.18, STONE, bevel=0.045, segments=2)
prism("FrontStep", [(-0.55, 0.0), (0.75, 0.0), (0.62, 0.32), (-0.42, 0.30)], 0.09, STONE,
      loc=(0.0, 0.95, 0.0), bevel=0.03, segments=2)

# Waist-high hearth table with chamfered corners and protruding quoins.
prism("HearthBody", chamfer_rect(-1.0, 0.40, -0.70, 0.30, 0.16), 0.70, STONE,
      loc=(0, 0, 0.18), top_scale=(0.97, 0.97), bevel=0.035, segments=2)
for cx, cy in ((-1.0, 0.30), (0.40, 0.30), (-1.0, -0.70), (0.40, -0.70)):
    for k in range(3):
        wide = (k % 2 == 0)
        sx = 0.30 if wide else 0.20
        sy = 0.20 if wide else 0.30
        box(f"Quoin_{cx}_{cy}_{k}", (sx, sy, 0.21),
            (cx + (0.02 if cx > 0 else -0.02), cy + (0.02 if cy > 0 else -0.02),
             0.29 + k * 0.215), STONE, rot=(0, 0, RNG.uniform(-5, 5)),
            bevel=0.03, segments=2)

# Ash-pit arch: dark recess with voussoir stones and a low ember glow.
AY = 0.305
box("AshPitBack", (0.52, 0.04, 0.34), (HX, AY - 0.01, 0.38), SOOT)
cyl("AshPitArchBack", 0.26, 0.26, 0.04, (HX, AY - 0.01, 0.55), SOOT, segs=12,
    rot=(90, 0, 0))
for i in range(7):
    a = math.pi * i / 6
    x = HX + 0.33 * math.cos(a)
    z = 0.55 + 0.33 * math.sin(a)
    box(f"Voussoir_{i}", (0.15, 0.10, 0.11), (x, AY + 0.02, z), STONE,
        rot=(0, -math.degrees(a) + 90, 0), bevel=0.02, segments=2)
for sx in (-1, 1):
    box(f"ArchJamb_{sx}", (0.13, 0.10, 0.34), (HX + sx * 0.33, AY + 0.02, 0.37), STONE,
        bevel=0.02, segments=2)
for i in range(3):
    lump(f"AshEmber_{i}", 0.05, (HX - 0.12 + i * 0.12, AY - 0.05, 0.24), EMBER,
         squash=(1.2, 1, 0.6))
# Restrained rune glyphs flanking the arch.
for gx in (HX - 0.58, HX + 0.58):
    box(f"RuneA_{gx}", (0.025, 0.012, 0.20), (gx, AY + 0.005, 0.56), ARCANE)
    box(f"RuneB_{gx}", (0.10, 0.012, 0.022), (gx, AY + 0.005, 0.62), ARCANE,
        rot=(0, 30, 0))
    box(f"RuneC_{gx}", (0.08, 0.012, 0.022), (gx, AY + 0.005, 0.49), ARCANE,
        rot=(0, -35, 0))

# Hammered iron hearth pan, coal bed and glowing embers.
prism("HearthPan", chamfer_rect(-0.95, 0.35, -0.65, 0.25, 0.14), 0.08, IRON,
      loc=(0, 0, 0.88), bevel=0.02, segments=2)
cyl("CoalDish", 0.40, 0.44, 0.05, (HX, -0.12, 0.985), SOOT, segs=14, scale=(1.15, 0.85, 1))
for i in range(22):
    a = RNG.uniform(0, math.tau)
    r = math.sqrt(RNG.random()) * 0.38
    x = HX + r * math.cos(a) * 1.15
    y = -0.12 + r * math.sin(a) * 0.80
    hot = r < 0.24 or RNG.random() < 0.3
    lump(f"Coal_{i}", RNG.uniform(0.045, 0.075), (x, y, 1.02), EMBER if hot else SOOT,
         squash=(1, 1, 0.7))
# Pan rivets.
for i in range(10):
    t = i / 10
    x = -0.9 + 1.2 * t
    cyl(f"PanRivet_{i}", 0.018, 0.012, 0.02, (x, 0.255, 0.93), IRON, segs=6, rot=(90, 0, 0))

# Chimney breast behind the coal bed with the magical core set into it.
prism("ChimneyBreast", chamfer_rect(-0.82, 0.12, -0.70, -0.30, 0.08), 0.95, STONE,
      loc=(0, 0, 0.96), top_scale=(0.82, 0.85), bevel=0.03, segments=2)
CORE = Vector((-0.35, -0.21, 1.27))
cyl("CoreBacking", 0.17, 0.17, 0.04, (CORE.x, -0.29, CORE.z), SOOT, segs=14, rot=(90, 0, 0))
torus("CoreRing", 0.17, 0.032, COPPER, (CORE.x, -0.27, CORE.z), rot=(90, 0, 0), seg=18)
lump("CoreCrystal", 1.0, CORE, ARCANE, squash=(0.085, 0.07, 0.13), jitter=0.06)
for i in range(4):
    a = math.pi / 4 + i * math.pi / 2
    bar(f"CoreClaw_{i}", (CORE.x + 0.15 * math.cos(a), -0.27, CORE.z + 0.15 * math.sin(a)),
        (CORE.x + 0.07 * math.cos(a), -0.21, CORE.z + 0.09 * math.sin(a)), 0.014, COPPER, 6)
for i in range(6):
    a = i * math.tau / 6
    box(f"CoreRune_{i}", (0.05, 0.01, 0.018),
        (CORE.x + 0.245 * math.cos(a), -0.295, CORE.z + 0.245 * math.sin(a)), ARCANE,
        rot=(0, -math.degrees(a) + 90, 0))

# Iron smoke hood with copper lip (well above the core sightline).
hood = cyl("SmokeHood", 0.74, 0.30, 0.42, (HX - 0.05, -0.32, 1.78), IRON, segs=4,
           rot=(0, 0, 45), scale=(1, 1, 1), bevel=0.02)
hood.scale = (1.0, 1.0, 1.0)
cyl("HoodLip", 0.77, 0.74, 0.07, (HX - 0.05, -0.32, 1.58), COPPER, segs=4, rot=(0, 0, 45),
    bevel=0.01)
cyl("HoodSoot", 0.70, 0.70, 0.02, (HX - 0.05, -0.32, 1.54), SOOT, segs=4, rot=(0, 0, 45))
for i in range(4):
    a = math.radians(45 + 90 * i)
    bar(f"HoodRib_{i}", (HX - 0.05 + 0.50 * math.cos(a), -0.32 + 0.50 * math.sin(a), 1.60),
        (HX - 0.05 + 0.22 * math.cos(a), -0.32 + 0.22 * math.sin(a), 1.98), 0.018, IRON, 6)

# Squat, leaning, asymmetric chimney stack built from cobbled rings.
sx, sy = HX - 0.12, -0.42
for k in range(3):
    r = 0.36 - k * 0.025
    cyl(f"StackCourse_{k}", r + 0.02, r, 0.25, (sx - k * 0.05, sy - k * 0.015, 2.08 + k * 0.25),
        STONE, segs=7, rot=(0, 0, RNG.uniform(0, 50)), jitter=0.02, bevel=0.025, segments=2)
top = Vector((sx - 3 * 0.05, sy - 0.045, 2.72))
torus("StackBand", 0.335, 0.032, COPPER, (sx - 0.05, sy - 0.015, 2.33), seg=14)
cyl("StackCap", 0.33, 0.28, 0.12, (top.x, top.y, 2.76), IRON, segs=10, bevel=0.01)
cyl("FlueMouth", 0.21, 0.21, 0.02, (top.x, top.y, 2.82), SOOT, segs=10)
for i in range(3):
    a = math.tau * i / 3
    bar(f"HatLeg_{i}", (top.x + 0.18 * math.cos(a), top.y + 0.18 * math.sin(a), 2.81),
        (top.x + 0.18 * math.cos(a), top.y + 0.18 * math.sin(a), 2.94), 0.014, IRON, 5)
cyl("RainHat", 0.38, 0.05, 0.12, (top.x, top.y, 3.00), IRON, segs=10, bevel=0.0)
for i in range(3):
    a = 0.6 + i * 0.5
    box(f"StackRune_{i}", (0.035, 0.012, 0.035),
        (sx - 0.05 + 0.37 * math.cos(a), sy - 0.015 + 0.37 * math.sin(a), 2.33), ARCANE,
        rot=(0, 45, math.degrees(a) + 90))

# Hanging sign on a wrought bracket (blank board for integrator text/decal).
bar("SignArm", (sx + 0.1, sy, 2.50), (0.62, sy, 2.50), 0.022, IRON, 6)
bar("SignBrace", (sx + 0.25, sy, 2.20), (0.40, sy, 2.49), 0.016, IRON, 6)
torus("SignCurl", 0.05, 0.012, IRON, (0.64, sy, 2.54), rot=(90, 0, 0), seg=10, side=4)
SIGN = Vector((0.40, sy, 2.20))
for dx in (-0.18, 0.18):
    bar(f"SignChain_{dx}", (SIGN.x + dx, sy, 2.49), (SIGN.x + dx, sy, 2.34), 0.008, IRON, 4)
box("SignBoard", (0.50, 0.05, 0.28), SIGN, WOOD, bevel=0.015, segments=2)
box("SignHammerHead", (0.14, 0.02, 0.06), (SIGN.x, sy + 0.035, SIGN.z + 0.04), COPPER)
box("SignHammerHaft", (0.025, 0.02, 0.16), (SIGN.x, sy + 0.035, SIGN.z - 0.04), COPPER)

# Anvil on a banded stump - silhouette reads side-on from the front.
AX, AYA = 0.66, 0.40
cyl("AnvilStump", 0.27, 0.25, 0.42, (AX, AYA, 0.39), WOOD, segs=12, jitter=0.01,
    bevel=0.02, segments=1)
for z in (0.26, 0.54):
    torus(f"StumpHoop_{z}", 0.268, 0.016, IRON, (AX, AYA, z), seg=16, side=4)
S = 1.25
anvil_profile = [(-0.22, 0.0), (0.22, 0.0), (0.21, 0.035), (0.11, 0.06), (0.065, 0.10),
                 (0.06, 0.15), (0.12, 0.185), (0.19, 0.205), (0.20, 0.275),
                 (-0.27, 0.275), (-0.28, 0.235), (-0.15, 0.205), (-0.08, 0.17),
                 (-0.065, 0.10), (-0.11, 0.06), (-0.21, 0.035)]
ANVIL_Z = 0.60
anvil = prism("AnvilBody", [(u * S, v * S) for u, v in anvil_profile], 0.15 * S, IRON,
              plane="XZ", loc=(AX, AYA, ANVIL_Z), rot=(0, 0, -8), bevel=0.012, segments=2)
feet = prism("AnvilFeet", [(u * S, v * S) for u, v in anvil_profile[:4] + [(-0.11, 0.06), (-0.21, 0.035)]],
             0.24 * S, IRON, plane="XZ", loc=(AX, AYA, ANVIL_Z), rot=(0, 0, -8), bevel=0.01)
ca, sa = math.cos(math.radians(-8)), math.sin(math.radians(-8))
hx0 = 0.19 * S
horn_root = Vector((AX + hx0 * ca, AYA + hx0 * sa, ANVIL_Z + 0.235 * S))
horn_len = 0.30 * S
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.05 * S, radius2=0.006,
                      depth=horn_len)
bmesh.ops.translate(bm, vec=(0, 0, horn_len / 2), verts=bm.verts)
for v in bm.verts:  # gentle upward sweep of the horn tip
    v.co.x -= 0.25 * (v.co.z / horn_len) ** 2 * 0.06
horn = finish("AnvilHorn", bm, IRON, horn_root, (0, 90, -8))
box("AnvilFace", (0.47 * S, 0.155 * S, 0.012), (AX - 0.035, AYA - 0.005, ANVIL_Z + 0.278 * S),
    IRON, rot=(0, 0, -8))
# Hammer resting on the face; tongs leaning on the stump.
hz = ANVIL_Z + 0.28 * S + 0.03
bar("HammerHandle", (AX - 0.22, AYA + 0.02, hz), (AX + 0.10, AYA + 0.16, hz), 0.017, WOOD, 6)
box("HammerHead", (0.06, 0.15, 0.06), (AX - 0.24, AYA + 0.01, hz + 0.005), IRON,
    rot=(0, 0, 24), bevel=0.008)
bar("TongJawA", (AX + 0.30, AYA + 0.10, 0.05), (AX + 0.24, AYA + 0.06, 0.82), 0.012, IRON, 5)
bar("TongJawB", (AX + 0.34, AYA + 0.06, 0.05), (AX + 0.24, AYA + 0.06, 0.82), 0.012, IRON, 5)
cyl("TongRivet", 0.022, 0.022, 0.03, (AX + 0.27, AYA + 0.07, 0.62), IRON, segs=6)

# Quench barrel with a travelling cart wheel leaning on it.
BX, BY = 1.00, -0.62
cyl("QuenchBarrel", 0.27, 0.30, 0.64, (BX, BY, 0.32), WOOD, segs=14, bevel=0.01)
for z in (0.10, 0.52):
    torus(f"BarrelHoop_{z}", 0.295, 0.014, IRON, (BX, BY, z), seg=16, side=4)
cyl("QuenchWater", 0.25, 0.25, 0.02, (BX, BY, 0.62), SOOT, segs=14)
WX, WY, WZ = 1.40, -0.50, 0.50
wheel_rot = (0, -14, 0)


def wheel_point(r, a):
    p = Vector((0, r * math.cos(a), r * math.sin(a)))
    p.rotate(Euler([math.radians(v) for v in wheel_rot]))
    return Vector((WX, WY, WZ)) + p


torus("WheelRim", 0.47, 0.045, WOOD, (WX, WY, WZ), rot=(0, 90 - 14, 0), seg=20, side=5)
torus("WheelTyre", 0.505, 0.02, IRON, (WX, WY, WZ), rot=(0, 90 - 14, 0), seg=20, side=4)
cyl("WheelHub", 0.08, 0.08, 0.20, (WX, WY, WZ), WOOD, segs=10, rot=(0, 90 - 14, 0), bevel=0.01)
cyl("WheelHubCap", 0.05, 0.035, 0.24, (WX, WY, WZ), IRON, segs=8, rot=(0, 90 - 14, 0))
for i in range(8):
    a = math.tau * i / 8 + 0.2
    bar(f"Spoke_{i}", wheel_point(0.07, a), wheel_point(0.44, a), 0.022, WOOD, 6)

# Draw shafts trailing behind - the forge travels.
for side, x in (("L", -0.82), ("R", 0.18)):
    bar(f"Shaft_{side}", (x, -0.66, 0.30), (x + (0.08 if x < 0 else -0.08), -1.36, 0.06),
        0.045, WOOD, 8)
    torus(f"ShaftRing_{side}", 0.05, 0.012, IRON,
          (x + (0.078 if x < 0 else -0.078), -1.32, 0.07), rot=(90, 0, 0), seg=10, side=4)
bar("ShaftCross", (-0.80, -1.10, 0.16), (0.16, -1.10, 0.16), 0.035, WOOD, 6)

# Teardrop bellows on a timber stand, nozzle into the hearth's side.
BLX, BLY = -1.30, -0.12
drop = []
for i in range(11):
    a = math.pi / 2 + math.pi * i / 10
    drop.append((0.27 * math.cos(a), 0.24 * math.sin(a)))
drop += [(0.22, -0.08), (0.33, -0.02), (0.33, 0.02), (0.22, 0.08)]
prism("BellowsBoardLow", drop, 0.04, WOOD, loc=(BLX, BLY, 0.60), bevel=0.012)
prism("BellowsBoardHigh", drop, 0.04, WOOD, loc=(BLX, BLY, 0.84), rot=(0, -9, 0), bevel=0.012)
prism("BellowsLeather", [(u * 0.93, v * 0.93) for u, v in drop], 0.20, LEATHER,
      loc=(BLX - 0.01, BLY, 0.64), top_scale=(1.0, 1.0))
prism("BellowsPleat", [(u * 1.0, v * 1.04) for u, v in drop], 0.035, LEATHER,
      loc=(BLX - 0.02, BLY, 0.725))
bar("BellowsNozzle", (BLX + 0.30, BLY, 0.70), (-0.98, BLY, 0.72), 0.035, IRON, 8)
cyl("NozzleCollar", 0.05, 0.05, 0.05, (-0.99, BLY, 0.72), COPPER, segs=8, rot=(0, 90, 0))
bar("BellowsHandle", (BLX - 0.20, BLY, 0.90), (BLX - 0.36, BLY, 1.24), 0.025, WOOD, 6)
bar("BellowsGrip", (BLX - 0.36, BLY - 0.14, 1.24), (BLX - 0.36, BLY + 0.14, 1.24), 0.028, WOOD, 6)
for y in (BLY - 0.16, BLY + 0.16):
    bar(f"BellowsLegF_{y}", (BLX + 0.12, y, 0.0), (BLX + 0.12, y, 0.60), 0.035, WOOD, 6)
    bar(f"BellowsLegB_{y}", (BLX - 0.20, y, 0.0), (BLX - 0.20, y, 0.60), 0.035, WOOD, 6)
box("BellowsRail", (0.40, 0.06, 0.06), (BLX - 0.04, BLY, 0.38), WOOD, bevel=0.01)
box("BellowsHinge", (0.06, 0.20, 0.25), (BLX + 0.30, BLY, 0.73), IRON, bevel=0.008)

# Leather apron on a peg, a tool rail with a flatter and tongs.
bar("ApronPeg", (-0.72, -0.72, 1.62), (-0.72, -0.84, 1.62), 0.02, WOOD, 6)
apron = [(-0.12, 0.0), (0.12, 0.0), (0.15, -0.20), (0.24, -0.26), (0.24, -0.62),
         (0.18, -0.70), (-0.18, -0.70), (-0.24, -0.62), (-0.24, -0.26), (-0.15, -0.20)]
prism("Apron", apron, 0.025, LEATHER, plane="XZ", loc=(-0.72, -0.86, 1.62), rot=(-8, 0, 180))
bar("ToolRail", (0.15, -0.66, 1.40), (0.15, -0.34, 1.40), 0.014, IRON, 6)
bar("FlatterHandle", (0.17, -0.42, 1.38), (0.17, -0.42, 1.02), 0.013, WOOD, 6)
box("FlatterHead", (0.05, 0.08, 0.06), (0.17, -0.42, 1.00), IRON, bevel=0.006)
bar("RailTongA", (0.17, -0.58, 1.40), (0.17, -0.62, 0.98), 0.010, IRON, 5)
bar("RailTongB", (0.17, -0.58, 1.40), (0.17, -0.54, 0.98), 0.010, IRON, 5)

print(f"[forge] modelled {len(PARTS)} parts in {time.time() - T0:.1f}s")


# --------------------------------------------------------------------------
# Bake: apply modifiers/transforms, join by material, box-project UVs.
# --------------------------------------------------------------------------
def box_uv(obj, scale):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            if ax == 2:
                u, v = c.x, c.y
            elif ax == 0:
                u, v = c.y, c.z
            else:
                u, v = c.x, c.z
            loop[uv].uv = (u / scale, v / scale)
    bm.to_mesh(obj.data)
    bm.free()


depsgraph = bpy.context.evaluated_depsgraph_get()
art_collection = collection("Art")
groups = {}
for obj in PARTS:
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    groups.setdefault(obj.data.materials[0].name, []).append(mesh)

JOINED = []
for mat in MATERIALS:
    meshes = groups.get(mat.name, [])
    if not meshes:
        continue
    bm = bmesh.new()
    for m in meshes:
        bm.from_mesh(m)
    mesh = bpy.data.meshes.new(f"WF_{mat.name}")
    bm.to_mesh(mesh)
    bm.free()
    for m in meshes:
        bpy.data.meshes.remove(m)
    mesh.materials.clear()
    mesh.materials.append(mat)
    for p in mesh.polygons:
        p.material_index = 0
    obj = bpy.data.objects.new(f"WF_{mat.name}", mesh)
    art_collection.objects.link(obj)
    box_uv(obj, UV_SCALE[mat.name])
    for p in mesh.polygons:
        p.use_smooth = True
    JOINED.append(obj)

# Hide the editable parts collection from renders/exports but keep it in the blend.
ART.hide_render = True
ART.hide_viewport = True
bpy.context.view_layer.layer_collection.children["Art_Parts"].exclude = True

for obj in JOINED:
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))

# Sockets (Blender coords; Godot = (x, z, -y)).
SOCKET_POS = {
    "Ground": (0.0, 0.0, 0.0),
    "WorkPoint": (0.15, 1.35, 0.0),
    "EmberSource": (HX, -0.12, 1.05),
    "CoreTarget": tuple(CORE),
    "SignAnchor": (SIGN.x, SIGN.y + 0.03, SIGN.z),
}
EMPTIES = []
for name, pos in SOCKET_POS.items():
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "SPHERE" if name != "Ground" else "PLAIN_AXES"
    e.empty_display_size = 0.08
    e.location = pos
    SOCKETS.objects.link(e)
    EMPTIES.append(e)


def tri_count(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def export(path, objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs + EMPTIES:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_cameras=False,
                              export_lights=False, export_extras=False,
                              export_image_format="AUTO")


export(OUT / "model.glb", JOINED)

# LOD: decimated copies sharing the same materials and sockets.
lod_collection = collection("LOD")
LOD = []
for obj in JOINED:
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = obj.name + "_LOD"
    copy.data.name = copy.name
    lod_collection.objects.link(copy)
    mod = copy.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = 0.28
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = copy
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    copy.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Decimate")
    copy.data.validate(clean_customdata=False)
    LOD.append(copy)
export(OUT / "lod.glb", LOD)
lod_collection.hide_render = True
bpy.context.view_layer.layer_collection.children["LOD"].hide_viewport = True

# Simple collision boxes, converted to exported Godot +Y-up space.
COLLIDERS = {
    "Plinth": ((-1.36, -1.08, 0.0), (1.36, 1.08, 0.18)),
    "HearthAndBreast": ((-1.02, -0.72, 0.18), (0.42, 0.32, 1.05)),
    "ChimneyBreastUpper": ((-0.82, -0.70, 1.05), (0.12, -0.30, 1.92)),
    "Hood": ((-0.88, -0.75, 1.54), (0.18, 0.12, 2.00)),
    "ChimneyStack": ((-0.95, -0.85, 1.95), (0.05, -0.02, 3.06)),
    "AnvilAndStump": ((0.28, 0.18, 0.18), (1.02, 0.62, 0.98)),
    "BarrelAndWheel": ((0.70, -1.02, 0.0), (1.62, 0.02, 1.0)),
    "Bellows": ((-1.70, -0.38, 0.0), (-0.98, 0.14, 1.28)),
}


def godot_box(lo, hi):
    return {"min": [lo[0], lo[2], round(-hi[1], 4)], "max": [hi[0], hi[2], round(-lo[1], 4)]}


bounds_pts = [Vector(c) for o in JOINED for c in
              [o.matrix_world @ Vector(b) for b in o.bound_box]]
lo = [min(p[i] for p in bounds_pts) for i in range(3)]
hi = [max(p[i] for p in bounds_pts) for i in range(3)]
sockets = {
    "axes": "Godot/glTF metres, +Y up, front faces -Z, origin = ground centre",
    "sockets": {k: [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]
                for k, v in SOCKET_POS.items()},
    "collision_boxes": {k: godot_box(*v) for k, v in COLLIDERS.items()},
}
(OUT / "sockets" / "collision.json").write_text(json.dumps(sockets, indent=2) + "\n",
                                                encoding="utf-8")


# --------------------------------------------------------------------------
# Studio (not exported): ground, warm key, cool fill, three review cameras.
# --------------------------------------------------------------------------
def studio_obj(name, data):
    o = bpy.data.objects.new(name, data)
    STUDIO.objects.link(o)
    return o


ground_mat = bpy.data.materials.new("Studio_Ground")
ground_mat.use_nodes = True
gp = ground_mat.node_tree.nodes["Principled BSDF"]
gp.inputs["Base Color"].default_value = linear("4a5a3a")
gp.inputs["Roughness"].default_value = 1.0
gbm = bmesh.new()
bmesh.ops.create_circle(gbm, cap_ends=True, segments=48, radius=12)
gmesh = bpy.data.meshes.new("Studio_Ground")
gbm.to_mesh(gmesh)
gbm.free()
gmesh.materials.append(ground_mat)
studio_obj("Studio_Ground", gmesh).location = (0, 0, -0.002)

world = bpy.data.worlds.new("Studio_World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.32, 0.38, 0.48, 1)
bg.inputs["Strength"].default_value = 0.55

sun_d = bpy.data.lights.new("Studio_Sun", "SUN")
sun_d.energy = 3.2
sun_d.angle = math.radians(4)
sun_d.color = (1.0, 0.92, 0.82)
sun = studio_obj("Studio_Sun", sun_d)
sun.rotation_euler = Euler((math.radians(50), 0, math.radians(35)))
fill_d = bpy.data.lights.new("Studio_Fill", "AREA")
fill_d.energy = 450
fill_d.size = 4
fill_d.color = (0.75, 0.85, 1.0)
fill = studio_obj("Studio_Fill", fill_d)
fill.location = (-4.5, 4.0, 3.0)
fill.rotation_euler = (Vector((0, 0, 1)) - fill.location).to_track_quat("-Z", "Y").to_euler()

cam_d = bpy.data.cameras.new("Studio_Camera")
cam = studio_obj("Studio_Camera", cam_d)
scene.camera = cam
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
try:
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
    scene.eevee.use_raytracing = False
except AttributeError:
    pass

VIEWS = {
    "front": dict(loc=(0.0, 6.6, 1.55), target=(-0.15, 0.0, 1.5), lens=42, ortho=None),
    "three_quarter": dict(loc=(4.6, 5.0, 3.0), target=(-0.1, -0.1, 1.25), lens=40, ortho=None),
    "overhead": dict(loc=(0.0, 0.0, 12.0), target=None, lens=50, ortho=3.9),
}
render_times = {}
if not ARGS.no_render:
    for name, v in VIEWS.items():
        cam.location = v["loc"]
        if v["ortho"]:
            cam_d.type = "ORTHO"
            cam_d.ortho_scale = v["ortho"]
            cam.rotation_euler = (0, 0, math.pi)
        else:
            cam_d.type = "PERSP"
            cam_d.lens = v["lens"]
            cam.rotation_euler = (Vector(v["target"]) - cam.location).to_track_quat(
                "-Z", "Y").to_euler()
        scene.render.filepath = str(OUT / f"{name}.png")
        t = time.time()
        bpy.ops.render.render(write_still=True)
        render_times[name] = round(time.time() - t, 2)
    # LOD silhouette check from the three-quarter view (review only).
    lod_collection.hide_render = False
    art_collection.hide_render = True
    v = VIEWS["three_quarter"]
    cam_d.type = "PERSP"
    cam_d.lens = v["lens"]
    cam.location = v["loc"]
    cam.rotation_euler = (Vector(v["target"]) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / "lod_three_quarter.png")
    bpy.ops.render.render(write_still=True)
    lod_collection.hide_render = True
    art_collection.hide_render = False

bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "source.blend"), compress=True)

report = {
    "asset": "Wayfarer's Forge",
    "godot_bounds_min": [round(lo[0], 3), round(lo[2], 3), round(-hi[1], 3)],
    "godot_bounds_max": [round(hi[0], 3), round(hi[2], 3), round(-lo[1], 3)],
    "high_triangles": tri_count(JOINED),
    "lod_triangles": tri_count(LOD),
    "high_meshes": [o.name for o in JOINED],
    "materials": [m.name for m in MATERIALS],
    "embedded_images": [i.name for i in bpy.data.images if i.packed_file and i.name.startswith("forge_")],
    "model_glb_bytes": (OUT / "model.glb").stat().st_size,
    "lod_glb_bytes": (OUT / "lod.glb").stat().st_size,
    "parts_modelled": len(PARTS),
    "render_seconds": render_times,
    "total_seconds": round(time.time() - T0, 2),
}
report["lod_ratio"] = round(report["lod_triangles"] / report["high_triangles"], 3)
(OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print("FORGE_RESULT " + json.dumps(report, separators=(",", ":")))
