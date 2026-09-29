"""Deterministic Blender 4.5.13 builder for the Sky Garden / Cloudbreak Keep art family.
Run:  blender.exe -b --factory-startup --python build_skylands.py -- [--no-render] [--only name,name]
Outputs (next to this file): *.glb, skylands.blend, placement_*.json, stats.json, previews/*.png, textures/*.png"""
import sys, os, math, json, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
import skl_core as C
import skl_assets as A
import skl_collision as K

HERE = C.HERE
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
NO_RENDER = '--no-render' in ARGV
ONLY = None
for i, a_ in enumerate(ARGV):
    if a_ == '--only':
        ONLY = set(ARGV[i + 1].split(','))

# ------------------------------------------------------------------ registry
REG = {}   # name -> (zone, builder, collision_note)
def reg(name, zone, fn, note='none'):
    REG[name] = (zone, fn, note)

# --- Sky Garden
reg('island_under_sky_main', 'sky', lambda: A.island_under('island_under_sky_main', 22, 18, 10.5, 'sky', N=72, spur_count=5, spur_amp=0.12), 'none (visual underside; top slab authoritative)')
reg('island_under_sky_small', 'sky', lambda: A.island_under('island_under_sky_small', 10, 10, 6.8, 'sky', N=48, spur_count=4, spur_amp=0.14), 'none')
reg('hanging_crag_sky_a', 'sky', lambda: A.hanging_crag('hanging_crag_sky_a', 'sky', 6.5, 2.0, 0.3), 'none')
reg('hanging_crag_sky_b', 'sky', lambda: A.hanging_crag('hanging_crag_sky_b', 'sky', 4.5, 1.4, -0.2), 'none')
reg('root_cascade_sky_a', 'sky', lambda: A.root_cascade('root_cascade_sky_a', 'sky', 6, 2.4, (2.5, 5.5)), 'none')
reg('root_cascade_sky_b', 'sky', lambda: A.root_cascade('root_cascade_sky_b', 'sky', 9, 3.6, (1.5, 3.6)), 'none')
reg('root_cascade_sky_c', 'sky', lambda: A.root_cascade('root_cascade_sky_c', 'sky', 4, 1.6, (4.0, 7.0)), 'none')
for i, v in enumerate(('a', 'b', 'c')):
    reg(f'rim_rock_sky_{v}', 'sky', (lambda i=i, v=v: A.rim_rock(f'rim_rock_sky_{v}', 'sky', 1.0 + 0.15 * i, i)), 'optional convex proxy ~1.4x1.0x1.2 m')
reg('tree_sky_a', 'sky', lambda: A.tree('tree_sky_a', 'sky', 3.8, 0.12, 1.0, True), 'trunk capsule r0.2 h2.2 only')
reg('tree_sky_b', 'sky', lambda: A.tree('tree_sky_b', 'sky', 2.6, 0.08, 1.15, True), 'trunk capsule r0.15 h1.6')
reg('tree_sky_c', 'sky', lambda: A.tree('tree_sky_c', 'sky', 5.2, 0.18, 1.0, True), 'trunk capsule r0.25 h3')
reg('shrub_bloom_sky_a', 'sky', lambda: A.shrub_bloom('shrub_bloom_sky_a', 'sky', 0.75, True, 0), 'none (walk-through)')
reg('shrub_bloom_sky_b', 'sky', lambda: A.shrub_bloom('shrub_bloom_sky_b', 'sky', 0.55, True, 2), 'none')
reg('flower_bed_sky_a', 'sky', lambda: A.flower_bed('flower_bed_sky_a', 'sky', 3.2, 1.2), 'none / optional low box 3.2x0.2x1.2')
reg('turf_patch_sky_a', 'sky', lambda: A.turf_patch('turf_patch_sky_a', 'sky', 3.4, 0), 'none (3-8 cm relief)')
reg('turf_patch_sky_b', 'sky', lambda: A.turf_patch('turf_patch_sky_b', 'sky', 2.6, 1), 'none')
reg('meadow_patch_sky_a', 'sky', lambda: A.meadow_patch('meadow_patch_sky_a', 'sky', 1.6, False), 'none')
reg('meadow_patch_sky_b', 'sky', lambda: A.meadow_patch('meadow_patch_sky_b', 'sky', 1.2, True), 'none')
reg('bell_flower_sky', 'sky', lambda: A.bell_flower('bell_flower_sky', 'sky', 1.4), 'none')
reg('sky_falls_a', 'sky', lambda: A.sky_falls('sky_falls_a', 1.8, 13.0), 'none')
reg('sky_falls_b', 'sky', lambda: A.sky_falls('sky_falls_b', 1.0, 8.0), 'none')
reg('windmill_tower', 'sky', lambda: A.windmill_tower('windmill_tower'), 'cylinder r1.45 h6.3 (door faces +Z)')
reg('windmill_rotor', 'sky', lambda: A.windmill_rotor('windmill_rotor'), 'none; spin around local Z')
reg('garden_arch_sky', 'sky', lambda: A.garden_arch('garden_arch_sky'), 'two column proxies r0.3 h2.2 at x=+-1.55; opening stays free')
reg('balustrade_span_sky', 'sky', lambda: A.balustrade_span('balustrade_span_sky', 'sky'), 'box 0.36x1.1x3.0')
reg('pillar_lantern_sky', 'sky', lambda: A.pillar_lantern('pillar_lantern_sky', 'sky'), 'cylinder r0.3 h1.5')
reg('gazebo_sky', 'sky', lambda: A.gazebo('gazebo_sky'), 'ring of 8 post capsules r0.15 at radius 2.0; entrance gap free')
reg('spring_pool_sky', 'sky', lambda: A.spring_pool('spring_pool_sky'), 'none (decor); optional low ring')
reg('path_slab_sky_a', 'sky', lambda: A.path_slab('path_slab_sky_a', 'sky', 0), 'none (7 cm above floor)')
reg('path_slab_sky_b', 'sky', lambda: A.path_slab('path_slab_sky_b', 'sky', 1), 'none')
reg('waymark_sky', 'sky', lambda: A.waymark('waymark_sky', 'sky'), 'cylinder r0.35 h1.0')
reg('grapple_post_sky', 'sky', lambda: A.grapple_post('grapple_post_sky', 'sky'), 'post capsule r0.2 h4.3 only; ring at (1.8,3.5,0) stays free')
reg('islet_garden_a', 'sky', lambda: A.islet('islet_garden_a', 'sky', 4.8, 8.0, True, 3.4, False), 'none (backdrop)')
reg('islet_garden_b', 'sky', lambda: A.islet('islet_garden_b', 'sky', 3.2, 6.0, True, 2.6, False), 'none (backdrop)')
reg('islet_garden_falls', 'sky', lambda: A.islet('islet_garden_falls', 'sky', 6.0, 9.5, True, 4.0, True), 'none (backdrop)')
reg('cloud_bank_a', 'shared', lambda: A.cloud_bank('cloud_bank_a', 16.0, 9), 'none')
reg('cloud_bank_b', 'shared', lambda: A.cloud_bank('cloud_bank_b', 10.0, 6), 'none')
# --- Cloudbreak Keep
reg('island_under_cloud_main', 'cloud', lambda: A.island_under('island_under_cloud_main', 28, 24, 13.5, 'cloud', N=96, spur_count=7, spur_amp=0.24, jag=0.17), 'none')
reg('island_under_cloud_small', 'cloud', lambda: A.island_under('island_under_cloud_small', 13, 12, 9.0, 'cloud', N=56, spur_count=4, spur_amp=0.3, jag=0.18), 'none')
reg('hanging_crag_cloud_a', 'cloud', lambda: A.hanging_crag('hanging_crag_cloud_a', 'cloud', 8.0, 2.2, 0.4), 'none')
reg('hanging_crag_cloud_b', 'cloud', lambda: A.hanging_crag('hanging_crag_cloud_b', 'cloud', 5.0, 1.5, -0.3), 'none')
reg('root_cascade_cloud_a', 'cloud', lambda: A.root_cascade('root_cascade_cloud_a', 'cloud', 5, 2.4, (2.0, 5.0), True, 0.28), 'none')
reg('root_cascade_cloud_b', 'cloud', lambda: A.root_cascade('root_cascade_cloud_b', 'cloud', 3, 1.4, (3.5, 6.5), False, 0.35), 'none')
for i, v in enumerate(('a', 'b', 'c')):
    reg(f'rim_rock_cloud_{v}', 'cloud', (lambda i=i, v=v: A.rim_rock(f'rim_rock_cloud_{v}', 'cloud', 1.1 + 0.2 * i, i)), 'optional convex proxy')
reg('tree_cloud_a', 'cloud', lambda: A.tree('tree_cloud_a', 'cloud', 4.6, 0.55, 1.0, False), 'trunk capsule r0.2 h2.0')
reg('tree_cloud_b', 'cloud', lambda: A.tree('tree_cloud_b', 'cloud', 2.8, 0.7, 1.0, False), 'trunk capsule r0.15 h1.4')
reg('tree_cloud_c', 'cloud', lambda: A.tree('tree_cloud_c', 'cloud', 6.0, 0.4, 0.95, False), 'trunk capsule r0.25 h3')
reg('meadow_patch_cloud_a', 'cloud', lambda: A.meadow_patch('meadow_patch_cloud_a', 'cloud', 1.6, False), 'none')
reg('turf_patch_cloud_a', 'cloud', lambda: A.turf_patch('turf_patch_cloud_a', 'cloud', 3.0, 0), 'none')
reg('turf_patch_cloud_b', 'cloud', lambda: A.turf_patch('turf_patch_cloud_b', 'cloud', 2.2, 1), 'none')
reg('crystal_cluster_a', 'cloud', lambda: A.crystal_cluster('crystal_cluster_a', 1.6), 'optional cylinder r0.5 h1.0')
reg('crystal_cluster_b', 'cloud', lambda: A.crystal_cluster('crystal_cluster_b', 1.0), 'none')
reg('wind_banner_pole_a', 'cloud', lambda: A.wind_banner_pole('wind_banner_pole_a', 4.2), 'pole capsule r0.15 h4.2')
reg('wind_banner_pole_b', 'cloud', lambda: A.wind_banner_pole('wind_banner_pole_b', 3.0), 'pole capsule r0.15 h3.0')
reg('cairn_stack', 'cloud', lambda: A.cairn('cairn_stack'), 'cylinder r0.45 h1.5')
reg('watch_shelter', 'cloud', lambda: A.watch_shelter('watch_shelter', False), 'plinth box 4.9x0.4x3.9; wall boxes at back (-Z) and -X sides; posts r0.15. Front (+Z) and roof volume clear')
reg('shelter_hall', 'cloud', lambda: A.watch_shelter('shelter_hall', True), 'plinth box 7.9x0.4x3.9; back wall + -X wall; posts r0.15')
reg('keep_wall_span', 'cloud', lambda: A.keep_wall('keep_wall_span'), 'box 0.6x2.0x3.0')
reg('keep_tower', 'cloud', lambda: A.keep_tower('keep_tower'), 'cylinder r1.85 h5.4')
reg('pillar_lantern_cloud', 'cloud', lambda: A.pillar_lantern('pillar_lantern_cloud', 'cloud'), 'cylinder r0.3 h1.5')
reg('path_slab_cloud_a', 'cloud', lambda: A.path_slab('path_slab_cloud_a', 'cloud', 0), 'none')
reg('path_slab_cloud_b', 'cloud', lambda: A.path_slab('path_slab_cloud_b', 'cloud', 1), 'none')
reg('waymark_cloud', 'cloud', lambda: A.waymark('waymark_cloud', 'cloud'), 'cylinder r0.35 h1.0')
reg('grapple_post_cloud', 'cloud', lambda: A.grapple_post('grapple_post_cloud', 'cloud'), 'post capsule r0.3 h5.2 only; ring at (1.55,4.5,0) stays free')
reg('islet_crag_a', 'cloud', lambda: A.islet('islet_crag_a', 'cloud', 4.6, 9.5, True, 3.0, False), 'none (backdrop)')
reg('islet_crag_b', 'cloud', lambda: A.islet('islet_crag_b', 'cloud', 3.0, 7.0, True, 2.2, False), 'none (backdrop)')


# ------------------------------------------------------------------ placement helpers
def yaw_for(local_dir, world_dir):
    return math.degrees(math.atan2(local_dir[1], local_dir[0]) - math.atan2(world_dir[1], world_dir[0]))

def yaw_out(nx, nz):
    return math.degrees(math.atan2(nx, nz))

class Zone:
    def __init__(s, key, seed):
        s.key = key; s.items = []; s.rng = random.Random(seed); s.keep = []; s.rects = []
    def add(s, asset, x, y, z, yaw=0.0, scale=1.0):
        s.items.append({"asset": asset, "position": [round(x, 3), round(y, 3), round(z, 3)], "yaw_degrees": round(yaw, 2), "scale": round(scale, 3)})
    def keepout(s, x, z, r):
        s.keep.append((x, z, r))
    def free(s, x, z, r=0.0):
        return all((x - kx) ** 2 + (z - kz) ** 2 > (kr + r) ** 2 for kx, kz, kr in s.keep)
    def edge_points(s, cx, cy, cz, W, D, step, jitter=0.35):
        pts = []
        hw, hd = W / 2, D / 2
        for (a0, a1, fixed, axis, n) in ((-hw, hw, cz + hd, 'x', (0, 1)), (-hw, hw, cz - hd, 'x', (0, -1)), (-hd, hd, cx + hw, 'z', (1, 0)), (-hd, hd, cx - hw, 'z', (-1, 0))):
            t = a0 + step * 0.5 + s.rng.random() * jitter
            while t < a1 - step * 0.4:
                if axis == 'x': pts.append((cx + t, cy, fixed, n))
                else: pts.append((fixed, cy, cz + t, n))
                t += step * (0.8 + s.rng.random() * 0.5)
        return pts


def dress_island(Z, style, cx, cy, cz, W, D, root_kinds, rock_kinds, root_step=3.4, rock_step=5.2, root_skip=None, rock_skip=None, root_scale=(0.8, 1.2)):
    rng = Z.rng
    for (x, y, z, n) in Z.edge_points(cx, cy, cz, W, D, root_step):
        if root_skip and root_skip(x, z, n): continue
        k = root_kinds[rng.randrange(len(root_kinds))]
        Z.add(k, x + n[0] * 0.5, y - 0.3, z + n[1] * 0.5, yaw_out(*n) + rng.uniform(-12, 12), rng.uniform(*root_scale))
    for (x, y, z, n) in Z.edge_points(cx, cy, cz, W, D, rock_step):
        if rock_skip and rock_skip(x, z, n): continue
        k = rock_kinds[rng.randrange(len(rock_kinds))]
        Z.add(k, x + n[0] * 0.62, y - 0.05, z + n[1] * 0.62, rng.uniform(0, 360), rng.uniform(0.7, 1.15))
    # corner rocks hide the square corners of the authoritative top slab
    for sx in (-1, 1):
        for sz in (-1, 1):
            k = rock_kinds[rng.randrange(len(rock_kinds))]
            Z.add(k, cx + sx * (W / 2 + 0.35), cy - 0.05, cz + sz * (D / 2 + 0.35), rng.uniform(0, 360), rng.uniform(0.9, 1.25))


def slabs(Z, poly, style, spacing=1.15, jitter=0.1, glow_every=0, y=0.0, skip=None):
    rng = Z.rng
    pts = [Vector((p[0], p[1])) for p in poly]
    i = 0
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length; d = (b - a).normalized(); nrm = Vector((-d.y, d.x))
        t = 0.0
        while t < L:
            p = a + d * t + nrm * rng.uniform(-jitter, jitter)
            if not (skip and skip(p.x, p.y)):
                var = 'b' if (glow_every and i % glow_every == glow_every - 1) else 'a'
                Z.add(f'path_slab_{style}_{var}', p.x, y, p.y, math.degrees(-math.atan2(d.y, d.x)) + 90 + rng.uniform(-14, 14), rng.uniform(0.9, 1.1))
            t += spacing * rng.uniform(0.92, 1.1); i += 1


# ------------------------------------------------------------------ Sky Garden layout
def layout_sky():
    Z = Zone('sky_garden', 1701)
    rng = Z.rng
    isl = {'main': (0, 0, 6, 22, 18), 'west': (-10, 1.8, -11, 10, 10), 'east': (10, 3.2, -10, 9, 9)}
    # gameplay keep-outs (portals, pickups, grapple posts/landings, spawn)
    for kx, kz, kr in [(7.5, 9.5, 2.4), (-8.5, 9.5, 2.4), (0, 8, 1.6), (-4, 0, 1.6), (-3, 0.7, 1.4), (-7, -8, 1.6), (-6, -7.3, 1.4), (8, -8, 1.6), (9, -7.3, 1.4),
                       (9, -10, 1.3), (10, -8.8, 1.3), (9, -7.6, 1.3)]:
        Z.keepout(kx, kz, kr)
    # undersides
    Z.add('island_under_sky_main', 0, 0, 6)
    Z.add('island_under_sky_small', -10, 1.8, -11)
    Z.add('island_under_sky_small', 10, 3.2, -10, 0, 0.9)
    for (x, y, z, s_) in [(-5, -5.0, 8.5, 1.0), (4.5, -5.5, 4.5, 0.9), (0.5, -4.0, 12.5, 0.75)]:
        Z.add('hanging_crag_sky_a' if s_ > 0.8 else 'hanging_crag_sky_b', x, y, z, rng.uniform(0, 360), s_)
    Z.add('hanging_crag_sky_b', -10.5, 1.8 - 3.2, -11, 30, 0.9)
    Z.add('hanging_crag_sky_b', 10.2, 3.2 - 2.8, -10, 200, 0.7)
    for k, v in isl.items():
        cx, cy, cz, W, D = v
        skip_edge = (lambda x, z, n: False)
        dress_island(Z, 'sky', cx, cy, cz, W, D, ['root_cascade_sky_a', 'root_cascade_sky_b', 'root_cascade_sky_c'], ['rim_rock_sky_a', 'rim_rock_sky_b', 'rim_rock_sky_c'],
                     root_step=4.6 if k == 'main' else 4.0, rock_step=5.0 if k == 'main' else 3.6)
    # waterfalls
    Z.add('sky_falls_a', 5.0, 0.0, 15.5, 0, 1.0)
    Z.add('sky_falls_b', -15.4, 1.75, -9.0, yaw_out(-1, 0), 1.0)
    Z.add('sky_falls_b', 14.9, 3.15, -12.2, yaw_out(1, 0), 0.9)
    # ---- main island tops
    for i, (x, z, s_) in enumerate([(-7.5, 2.0, 1.15), (7.6, 3.0, 1.0), (0, 13.0, 1.2), (-6, 8.5, 0.95), (6.2, 7.6, 0.85), (-1.5, -0.3, 0.8), (2.2, 4.5, 0.6), (-8, 12.5, 0.7), (9, 12, 0.6)]):
        Z.add('turf_patch_sky_a' if i % 2 == 0 else 'turf_patch_sky_b', x, 0.002 * i, z, rng.uniform(0, 360), s_)
    Z.add('gazebo_sky', -4.6, 0, 12.4, yaw_for((-0.92, 0.39), (0.79, -0.61)))
    Z.add('spring_pool_sky', 5.0, 0, 12.3, 180)
    # arrival path + arches
    path = [(0.4, 13.8), (0.1, 10.5), (-0.9, 6.5), (-1.9, 2.2), (-3.0, 0.9)]
    slabs(Z, path, 'sky', 1.15, 0.12, 0, 0.0, skip=lambda x, z: (x - 0.0) ** 2 + (z - 8) ** 2 < 0.5)
    slabs(Z, [(-2.2, 2.8), (-4.8, 0.6), (-6.6, -1.8)], 'sky', 1.15, 0.1, 4)
    slabs(Z, [(-0.4, 5.2), (3.0, 3.8), (5.5, 1.5), (7.5, -1.7)], 'sky', 1.15, 0.1, 4)
    for (x, z, tx, tz) in [(0.2, 11.4, -0.3, -3.0), (-0.8, 5.6, -0.6, -4.0), (-2.4, 1.6, -0.6, -1.0)]:
        Z.add('garden_arch_sky', x, 0, z, yaw_for((0, 1), (tx, tz)) * 0 + math.degrees(math.atan2(-tx * 0.0 + 0.0, 1.0)) + yaw_for((0, 1), (tx * 0.2, -1.0)) * 0 + 0)
    # waymark beacons flank each exit
    for (x, z) in [(-7.8, -2.3), (-5.4, -2.3), (6.3, -2.3), (8.7, -2.3)]:
        Z.add('waymark_sky', x, 0, z, rng.uniform(0, 360))
    # balustrades and pillars along both sides
    for side in (-1, 1):
        for zc in (1.5, 4.5, 7.5):
            Z.add('balustrade_span_sky', side * 10.0, 0, zc, 0)
        for zc in (0, 3, 6, 9):
            Z.add('pillar_lantern_sky', side * 10.0, 0, zc)
        Z.add('flower_bed_sky_a', side * 8.4, 0, 4.5, 90)
    Z.add('grapple_post_sky', -4, 0, 0)
    for (x, z, k, s_) in [(-9.5, 13.3, 'tree_sky_a', 1.0), (9.4, 13.6, 'tree_sky_c', 1.0), (-10.0, 11.0, 'tree_sky_b', 1.0), (10.0, 6.7, 'tree_sky_b', 0.95), (9.6, 0.4, 'tree_sky_b', 0.9)]:
        Z.add(k, x, 0, z, rng.uniform(0, 360), s_)
    for (x, z, k, s_) in [(-9.6, 9.6, 'shrub_bloom_sky_a', 1.0), (-7.7, 14.0, 'shrub_bloom_sky_b', 1.0), (8.6, 14.2, 'shrub_bloom_sky_a', 1.05), (-3.0, 14.4, 'shrub_bloom_sky_b', 1.0),
                          (2.8, 14.5, 'shrub_bloom_sky_a', 0.9), (10, 10.2, 'shrub_bloom_sky_b', 1.1), (-10, 2.6, 'shrub_bloom_sky_b', 1.0), (10, 2.2, 'shrub_bloom_sky_a', 0.9), (-2.4, -1.6, 'shrub_bloom_sky_b', 0.8)]:
        if Z.free(x, z, 0.6): Z.add(k, x, 0, z, rng.uniform(0, 360), s_)
    for (x, z, k, s_) in [(-9.0, 7.0, 'meadow_patch_sky_b', 1.0), (9.0, 7.4, 'meadow_patch_sky_a', 1.0), (-8.2, 0.8, 'meadow_patch_sky_a', 0.9), (8.4, 1.3, 'meadow_patch_sky_b', 1.0),
                          (-1.5, 12.7, 'meadow_patch_sky_a', 1.0), (3.5, 8.4, 'meadow_patch_sky_a', 0.9), (-6.0, 5.8, 'meadow_patch_sky_b', 0.9), (5.8, 5.0, 'meadow_patch_sky_a', 0.9)]:
        if Z.free(x, z, 1.4): Z.add(k, x, 0, z, rng.uniform(0, 360), s_)
    for (x, z) in [(-6.4, 12.0), (7.3, 6.0), (-1.9, 8.6), (2.2, 10.6)]:
        Z.add('bell_flower_sky', x, 0, z, rng.uniform(0, 360), rng.uniform(0.9, 1.2))
    # ---- west island (windmill)
    Z.add('windmill_tower', -10, 1.8, -11, 0)
    Z.add('windmill_rotor', -10, 6.6, -9.45, 0)
    Z.add('grapple_post_sky', -7, 1.8, -8)
    slabs(Z, [(-6.0, -7.3), (-7.6, -8.8), (-9.0, -9.6)], 'sky', 0.95, 0.08, 0, 1.8)
    for (x, z, k, s_) in [(-13.4, 14.4 * 0 - 14.3, 'tree_sky_a', 1.0), (-6.5, -14.4, 'tree_sky_b', 1.0), (-13.6, -7.6, 'tree_sky_b', 1.0)]:
        Z.add(k, x, 1.8, z, rng.uniform(0, 360), s_)
    for (x, z, k) in [(-12.6, -13.0, 'shrub_bloom_sky_a'), (-7.8, -13.6, 'shrub_bloom_sky_b'), (-13.2, -9.3, 'shrub_bloom_sky_b'), (-6.4, -10.8, 'shrub_bloom_sky_a')]:
        Z.add(k, x, 1.8, z, rng.uniform(0, 360), 1.0)
    Z.add('flower_bed_sky_a', -12.2, 1.8, -11.5, 90, 0.9)
    Z.add('flower_bed_sky_a', -10.0, 1.8, -14.2, 0, 0.9)
    for i, (x, z, s_) in enumerate([(-11, -8, 0.9), (-8.2, -12.6, 0.8), (-13, -12.5, 0.6)]):
        Z.add('turf_patch_sky_a' if i % 2 == 0 else 'turf_patch_sky_b', x, 1.8 + 0.002 * i, z, rng.uniform(0, 360), s_)
    Z.add('meadow_patch_sky_a', -13.4, 1.8, -10.6, 0, 0.8)
    Z.add('waymark_sky', -6.0, 1.8, -6.4, 0)
    # ---- east island (bloom terrace)
    Z.add('grapple_post_sky', 8, 3.2, -8)
    Z.add('tree_sky_c', 13.2, 3.2, -13.2, 40, 0.9)
    Z.add('tree_sky_b', 6.5, 3.2, -13.2, 200, 0.9)
    for (x, z, k) in [(13.3, -6.7, 'shrub_bloom_sky_a'), (12.4, -11.0, 'shrub_bloom_sky_b'), (7.0, -6.6, 'shrub_bloom_sky_b')]:
        Z.add(k, x, 3.2, z, rng.uniform(0, 360), 1.0)
    Z.add('flower_bed_sky_a', 12.9, 3.2, -9.0, 90, 0.9)
    Z.add('turf_patch_sky_b', 10, 3.202, -10.5, 40, 1.3)
    Z.add('turf_patch_sky_a', 12, 3.204, -7.4, 10, 0.55)
    Z.add('meadow_patch_sky_b', 7.2, 3.2, -11.6, 0, 0.9)
    Z.add('waymark_sky', 6.4, 3.2, -6.3, 0)
    for (x, z) in [(11.4, -12.2)]:
        Z.add('bell_flower_sky', x, 3.2, z, 20, 1.0)
    # ---- backdrop archipelago (outside the play bounds; old rocks at z<-28 retire)
    bd = [('islet_garden_a', -40, -3, -31, 1.0), ('islet_garden_b', -30, 2, -42, 1.0), ('islet_garden_falls', -12, -7, -36, 1.0), ('islet_garden_b', 4, -1, -46, 1.1),
          ('islet_garden_a', 20, -4, -38, 0.9), ('islet_garden_falls', 34, 1, -30, 0.85), ('islet_garden_b', -34, -6, 6, 0.9), ('islet_garden_a', 34, -5, 8, 0.8)]
    for (k, x, y, z, s_) in bd:
        Z.add(k, x, y, z, rng.uniform(0, 360), s_)
    for i in range(9):
        ang = 2 * math.pi * i / 9 + 0.3; r = 42 + (i % 3) * 9
        Z.add('cloud_bank_a' if i % 2 == 0 else 'cloud_bank_b', math.cos(ang) * r, -20 - (i % 4) * 3, math.sin(ang) * r - 8, rng.uniform(0, 360), rng.uniform(1.2, 2.0))
    return Z


# ------------------------------------------------------------------ Cloudbreak layout
def layout_cloud():
    Z = Zone('cloudbreak_keep', 2202)
    rng = Z.rng
    isl = {'main': (0, 0, 10, 28, 24, 'island_under_cloud_main', 1.0), 'west': (-16, 2.2, -8, 13, 12, 'island_under_cloud_small', 1.0),
           'east': (15, 4.2, -15, 12, 12, 'island_under_cloud_small', 0.96), 'north': (-3, 6.0, -25, 14, 12, 'island_under_cloud_small', 1.08)}
    for kx, kz, kr in [(7.5, 19.5, 2.6), (0, 10, 1.8), (0, 4, 1.8), (-13, -7, 1.7), (13, -13, 1.7), (-2, -24, 1.7), (-5, -25, 1.3), (-2.5, -25, 1.3), (0, -25, 1.3), (9.2, 9, 1.0), (-9.2, 9, 1.0)]:
        Z.keepout(kx, kz, kr)
    for k, (cx, cy, cz, W, D, ua, sc) in isl.items():
        Z.add(ua, cx, cy, cz, 0, sc)
    for (x, y, z, s_, k) in [(-7, -6.5, 14, 1.1, 'a'), (6, -7.5, 8, 1.0, 'a'), (0, -5.5, 19, 0.8, 'b'), (-16, 2.2 - 4.5, -8, 0.9, 'b'), (16, 4.2 - 4.5, -14, 0.9, 'a'), (-3, 6 - 5, -25, 0.9, 'b')]:
        Z.add(f'hanging_crag_cloud_{k}', x, y, z, rng.uniform(0, 360), s_)
    for k, (cx, cy, cz, W, D, ua, sc) in isl.items():
        dress_island(Z, 'cloud', cx, cy, cz, W, D, ['root_cascade_cloud_a', 'root_cascade_cloud_b'], ['rim_rock_cloud_a', 'rim_rock_cloud_b', 'rim_rock_cloud_c'],
                     root_step=5.4 if k == 'main' else 4.2, rock_step=4.2 if k == 'main' else 3.4, root_scale=(0.85, 1.25))
    # ---- main island: keep frontage
    for sx in (-1, 1):
        for zc in (15.5, 18.5):
            Z.add('keep_wall_span', sx * 13.4, 0, zc, 0)
        Z.add('keep_tower', sx * 12.1, 0, 20.5, rng.uniform(0, 360))
        Z.add('pillar_lantern_cloud', sx * 9.2, 0, 9)
        Z.add('crystal_cluster_a', sx * 12.5, 0, 4.0, rng.uniform(0, 360), 1.0)
        Z.add('crystal_cluster_b', sx * 12.0, 0, 6.5, rng.uniform(0, 360), 0.9)
    # banner poles set back from the approach axis; heights alternate for rhythm
    for i, z in enumerate((17.5, 14.0, 10.5, 7.0)):
        for sx in (-1, 1):
            Z.add('wind_banner_pole_a' if (i + (sx > 0)) % 2 == 0 else 'wind_banner_pole_b', sx * 3.8, 0, z, 0)
    slabs(Z, [(5.6, 18.6), (2.0, 15.0), (0.4, 10.6), (0.0, 6.4)], 'cloud', 1.2, 0.1, 4, skip=lambda x, z: (x) ** 2 + (z - 8) ** 2 < 0.4)
    slabs(Z, [(0.0, 2.6), (0.0, -0.9)], 'cloud', 1.0, 0.05, 0)
    Z.add('grapple_post_cloud', 0, 0, 4)
    for (x, z, k, s_) in [(-12.6, 12.6, 'tree_cloud_c', 1.0), (12.6, 12.0, 'tree_cloud_a', 1.0), (-12.8, 8.0, 'tree_cloud_b', 1.0), (12.7, 8.2, 'tree_cloud_b', 1.0), (-6.5, 20.8, 'tree_cloud_b', 0.9)]:
        Z.add(k, x, 0, z, rng.uniform(0, 360), s_)
    for i, (x, z, s_) in enumerate([(-8, 15, 1.1), (7.5, 14, 1.0), (-5, 8.5, 0.9), (6.5, 6, 0.8), (0.5, 19.5, 1.0), (-9.5, 3, 0.9), (9.4, 2.5, 0.8)]):
        if Z.free(x, z, 1.8): Z.add('turf_patch_cloud_a' if i % 2 == 0 else 'turf_patch_cloud_b', x, 0.002 * i, z, rng.uniform(0, 360), s_)
    for (x, z) in [(-10.6, 6.0), (10.8, 5.6), (-5.8, 19.3), (3.6, 20.4), (-6.5, 1.0), (7.0, 0.6), (-10.5, 12.5), (10.6, 14.2)]:
        if Z.free(x, z, 1.5): Z.add('meadow_patch_cloud_a', x, 0, z, rng.uniform(0, 360), rng.uniform(0.8, 1.2))
    for (x, z) in [(-11.0, 1.4), (11.2, 1.0), (-4.3, 20.9), (11.0, 17.0)]:
        Z.add('cairn_stack', x, 0, z, rng.uniform(0, 360), rng.uniform(0.9, 1.15))
    for (x, z) in [(-1.6, -1.2), (1.6, -1.2), (-7.0, -1.4), (7.0, -1.4)]:
        Z.add('waymark_cloud', x, 0, z, rng.uniform(0, 360))
    # ---- west island: shelter at the far (windward/back) side; landing + line stay clear
    Z.add('grapple_post_cloud', -13, 2.2, -7)
    Z.add('watch_shelter', -19.1, 2.2, -11.0, 0)
    Z.add('tree_cloud_a', -21.4, 2.2, -4.0, 20, 1.0)
    Z.add('tree_cloud_b', -14.5, 2.2, -13.0, 200, 1.0)
    Z.add('cairn_stack', -10.8, 2.2, -3.2, 40, 0.9)
    Z.add('crystal_cluster_a', -21.6, 2.2, -7.0, 10, 0.9)
    Z.add('meadow_patch_cloud_a', -17.0, 2.2, -4.6, 0, 1.0)
    Z.add('turf_patch_cloud_a', -17.4, 2.2, -6.0, 30, 0.8)
    Z.add('waymark_cloud', -11.6, 2.2, -4.0, 0)
    Z.add('wind_banner_pole_b', -21.6, 2.2, -13.2, 0)
    slabs(Z, [(-13.0, -8.1), (-15.5, -9.6), (-17.0, -10.2)], 'cloud', 1.1, 0.06, 0, 2.2)
    # ---- east island
    Z.add('grapple_post_cloud', 13, 4.2, -13)
    Z.add('watch_shelter', 17.6, 4.2, -18.4, 0)
    Z.add('tree_cloud_c', 19.8, 4.2, -10.6, 30, 0.9)
    Z.add('tree_cloud_b', 10.2, 4.2, -19.6, 90, 1.0)
    Z.add('cairn_stack', 10.0, 4.2, -10.2, 0, 0.9)
    Z.add('crystal_cluster_b', 20.4, 4.2, -14.6, 0, 1.1)
    Z.add('meadow_patch_cloud_a', 16.2, 4.2, -12.0, 0, 0.9)
    Z.add('turf_patch_cloud_b', 14.6, 4.2, -18.0, 0, 0.9)
    Z.add('wind_banner_pole_a', 20.4, 4.2, -20.4, 0)
    Z.add('waymark_cloud', 11.3, 4.2, -11.4, 0)
    slabs(Z, [(13.0, -13.8), (15.0, -16.0), (16.0, -17.6)], 'cloud', 1.1, 0.06, 0, 4.2)
    # ---- north island: summit hall
    Z.add('grapple_post_cloud', -2, 6, -24)
    Z.add('shelter_hall', -3.0, 6.0, -28.6, 0)
    Z.add('tree_cloud_a', -8.6, 6.0, -21.0, 200, 1.0)
    Z.add('tree_cloud_c', 2.6, 6.0, -21.4, 80, 0.9)
    Z.add('cairn_stack', 2.4, 6.0, -29.8, 0, 1.0)
    Z.add('crystal_cluster_a', -8.8, 6.0, -29.0, 0, 1.0)
    Z.add('meadow_patch_cloud_a', -7.2, 6.0, -24.5, 0, 1.0)
    Z.add('turf_patch_cloud_a', -4.0, 6.0, -25.5, 30, 0.9)
    Z.add('wind_banner_pole_a', 3.0, 6.0, -26.6, 0)
    Z.add('waymark_cloud', 0.7, 6.0, -22.4, 0)
    slabs(Z, [(-2.0, -23.0), (-3.0, -26.4)], 'cloud', 1.1, 0.06, 0, 6.0)
    # ---- far islets (replace the old pale rocks) and cloud floor
    for i in range(9):
        x = -38 + i * 9.0 + rng.uniform(-2, 2); y = -6 + (i % 3) * 3.0 + rng.uniform(-1, 2); z = -40 - (i % 2) * 8 - rng.uniform(0, 3)
        Z.add('islet_crag_a' if i % 2 == 0 else 'islet_crag_b', x, y, z, rng.uniform(0, 360), rng.uniform(0.8, 1.2))
    for (x, y, z, s_) in [(-42, -2, -12, 1.0), (42, 0, -26, 1.1), (44, -6, 4, 0.9), (-44, -8, 18, 1.0), (30, 8, -38, 0.7)]:
        Z.add('islet_crag_a', x, y, z, rng.uniform(0, 360), s_)
    for i in range(10):
        ang = 2 * math.pi * i / 10 + 0.15; r = 45 + (i % 3) * 10
        Z.add('cloud_bank_a' if i % 2 == 0 else 'cloud_bank_b', math.cos(ang) * r, -22 - (i % 4) * 3, math.sin(ang) * r - 10, rng.uniform(0, 360), rng.uniform(1.3, 2.1))
    return Z


# ------------------------------------------------------------------ export, stats, preview
def gltf_export(ob, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_image_format='AUTO', export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False)


def mesh_stats(ob):
    me = ob.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    xs = [(v.co.x, v.co.z, -v.co.y) for v in me.vertices]
    mn = [min(v[i] for v in xs) for i in range(3)]; mx = [max(v[i] for v in xs) for i in range(3)]
    return {"triangles": tris, "vertices": len(me.vertices), "materials": [m.name for m in me.materials],
            "bounds_min": [round(v, 3) for v in mn], "bounds_max": [round(v, 3) for v in mx],
            "size": [round(mx[i] - mn[i], 3) for i in range(3)]}


def ref_objects(zone, coll):
    """Preview-only stand-ins for the authoritative top slabs, anchors, portals and pickups (never exported)."""
    tops = {'sky': [(0, 0, 6, 22, 18), (-10, 1.8, -11, 10, 10), (10, 3.2, -10, 9, 9)],
            'cloud': [(0, 0, 10, 28, 24), (-16, 2.2, -8, 13, 12), (15, 4.2, -15, 12, 12), (-3, 6.0, -25, 14, 12)]}[zone]
    a = C.Asset('REF_tops')
    for (cx, cy, cz, W, D) in tops:
        a.slab_poly('turf', [(cx - W / 2, cz - D / 2), (cx + W / 2, cz - D / 2), (cx + W / 2, cz + D / 2), (cx - W / 2, cz + D / 2)][::-1], cy - 0.04, cy, (0.62, 0.78, 0.42))
    ports = {'sky': [(7.5, 0, 9.5), (-8.5, 0, 9.5)], 'cloud': [(7.5, 0, 19.5)]}[zone]
    for (x, y, z) in ports:
        rings = []
        for k in range(2):
            rings.append(a.ring((x, z), 1.3 + 0.0 * k, y + 1.4, 16, rz=0.05))
        # vertical ring facing +Z
        pts = [Vector((x + 1.25 * math.cos(2 * math.pi * i / 16), y + 1.4 + 1.5 * math.sin(2 * math.pi * i / 16), z)) for i in range(16)]
        for i in range(16):
            j = (i + 1) % 16
            a.face('glow', [pts[i], pts[j], Vector((pts[j].x, pts[j].y, pts[j].z + 0.1)), Vector((pts[i].x, pts[i].y, pts[i].z + 0.1))], (0.4, 0.8, 1.0), double=True)
    pick = {'sky': [(9, 3.2, -10), (10, 3.2, -8.8), (9, 3.2, -7.6)], 'cloud': [(-5, 6, -25), (-2.5, 6, -25), (0, 6, -25)]}[zone]
    for (x, y, z) in pick:
        a.lump('petal', (x, y + 0.9, z), 0.28, (1.0, 0.45, 0.75), jit=0, sub=1)
    ob = a.finish(); ob.name = 'REF_tops_ports_pickups'
    coll.objects.link(ob)
    return ob


def setup_render(scene):
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 1280; scene.render.resolution_y = 720
    scene.eevee.taa_render_samples = 48
    scene.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('sky'); scene.world = w; w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector']); nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].position = 0.15; ramp.color_ramp.elements[0].color = (0.72, 0.84, 0.95, 1)
    ramp.color_ramp.elements[1].position = 0.85; ramp.color_ramp.elements[1].color = (0.10, 0.33, 0.80, 1)
    e = ramp.color_ramp.elements.new(0.5); e.color = (0.60, 0.78, 0.92, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.4; sun.angle = math.radians(1.5); sun.color = (1.0, 0.95, 0.86)
    so = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(-38))


def add_camera(scene, name, pos, target, lens=22):
    cam = bpy.data.cameras.new(name); cam.lens = lens; cam.clip_end = 600
    co = bpy.data.objects.new(name, cam); scene.collection.objects.link(co)
    p = Vector(C.Vector((pos[0], -pos[2], pos[1]))); t = Vector((target[0], -target[2], target[1]))
    co.location = p
    co.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    return co


def render_view(scene, cam, path):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def inst(name, mesh, coll, item, off=(0, 0, 0)):
    ob = bpy.data.objects.new(name, mesh)
    x, y, z = item["position"]
    ob.location = (x + off[0], -(z + off[2]), y + off[1])
    ob.rotation_euler = (0, 0, math.radians(item["yaw_degrees"]))
    s_ = item["scale"]; ob.scale = (s_, s_, s_)
    coll.objects.link(ob)
    return ob


# ------------------------------------------------------------------ main
def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    C.make_textures(); C.make_materials()
    scene = bpy.context.scene
    stats = {"assets": {}, "zones": {}}
    objs = {}
    for name, (zone, fn, note) in REG.items():
        if ONLY and name not in ONLY: continue
        ob = fn()
        scene.collection.objects.link(ob)
        objs[name] = ob
        gltf_export(ob, os.path.join(HERE, f"{name}.glb"))
        st = mesh_stats(ob); st['zone'] = zone; st['collision_intent'] = note
        st['glb_bytes'] = os.path.getsize(os.path.join(HERE, f"{name}.glb"))
        stats['assets'][name] = st
    print("assets built", len(objs), round(time.time() - t0, 1), "s")
    zones = {'sky_garden': layout_sky(), 'cloudbreak_keep': layout_cloud()}
    for zname, Z in zones.items():
        used = sorted({it['asset'] for it in Z.items})
        missing = [u for u in used if u not in objs]
        if missing and not ONLY: raise RuntimeError(f"missing assets {missing}")
        manifest = {"schema": 1, "assets": {u: f"{u}.glb" for u in used}, "placements": Z.items}
        manifest = K.apply_collision_intent(manifest)
        with open(os.path.join(HERE, f"placement_{zname}.json"), 'w') as f:
            json.dump(manifest, f, indent=1)
        tri = sum(stats['assets'][it['asset']]['triangles'] for it in Z.items if it['asset'] in stats['assets'])
        mats = sorted({m for u in used if u in stats['assets'] for m in stats['assets'][u]['materials']})
        lim = 22 if zname == 'sky_garden' else 28
        play = sum(stats['assets'][it['asset']]['triangles'] for it in Z.items if it['asset'] in stats['assets'] and abs(it['position'][0]) <= lim + 1 and it['position'][2] <= lim + 1 and it['position'][2] >= -lim - 12 and it['position'][1] > -12 and not it['asset'].startswith(('islet', 'cloud_bank')))
        stats['zones'][zname] = {"play_area_triangles": play, "backdrop_triangles": tri - play, "placements": len(Z.items), "unique_assets": len(used), "total_triangles": tri, "materials": mats, "material_count": len(mats)}
        for cnt in ('draw_note',):
            pass
    stats['generated_seconds'] = round(time.time() - t0, 1)
    # asset sheet (arranged after export so exported origins stayed at 0)
    sheet = bpy.data.collections.new('asset_sheet'); scene.collection.children.link(sheet)
    for zi, zk in enumerate(('sky', 'cloud', 'shared')):
        row = [n for n, (z, f, no) in REG.items() if z == zk and n in objs]
        x = 0.0
        for n in row:
            ob = objs[n]
            sz = max(stats['assets'][n]['size'][0], stats['assets'][n]['size'][2]) + 2
            ob.location = (x + sz / 2, 40.0 * -zi * 0 - zi * 60.0, 0)
            scene.collection.objects.unlink(ob); sheet.objects.link(ob)
            x += sz
    # preview scenes
    if not NO_RENDER:
        setup_render(scene)
        sheet.hide_render = True
        os.makedirs(os.path.join(HERE, 'previews'), exist_ok=True)
        zc = {}
        for zname, Z in zones.items():
            coll = bpy.data.collections.new('zone_' + zname); scene.collection.children.link(coll); zc[zname] = coll
            for it in Z.items:
                inst(it['asset'], objs[it['asset']].data, coll, it)
            ref_objects('sky' if zname == 'sky_garden' else 'cloud', coll)
        views = {
            'sky_garden': [('sky_garden_ground', (2, 1.8, 8), (-2, 3.0, -9), 20), ('sky_garden_overhead', (0, 40, 34), (0, 1, -1), 24),
                           ('sky_garden_west_isle', (-6.5, 3.5, -4.6), (-11, 4.0, -11), 22), ('sky_garden_underside', (18, -8, 30), (0, -1, 0), 22)],
            'cloudbreak_keep': [('cloudbreak_ground', (1, 1.8, 10), (0, 3.0, -12), 20), ('cloudbreak_overhead', (0, 62, 44), (0, 2, -6), 24),
                                ('cloudbreak_landing_west', (-11.5, 3.9, -3.6), (-19, 4.0, -10.5), 22), ('cloudbreak_underside', (34, -10, 42), (-2, 0, -4), 24)]}
        for zname in zones:
            for k, c in zc.items():
                c.hide_render = (k != zname)
            for (nm, pos, tgt, lens) in views[zname]:
                pos = tuple(Vector(pos) + Vector(zones_center(zname)))
                pass
            for (nm, pos, tgt, lens) in views[zname]:
                cam = add_camera(scene, nm, pos, tgt, lens)
                render_view(scene, cam, os.path.join(HERE, 'previews', nm + '.png'))
        for c in zc.values(): c.hide_render = False; c.hide_viewport = True
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'skylands.blend'))
    with open(os.path.join(HERE, 'stats.json'), 'w') as f:
        json.dump(stats, f, indent=1)
    print("done", round(time.time() - t0, 1), "s")


def zones_center(z):
    return (0, 0, 0)


main()
