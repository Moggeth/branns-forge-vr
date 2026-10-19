#!/usr/bin/env python3
"""
Siegebird — Game-Ready 3D Handheld Crossbow Generator (glTF 2.0 Binary .glb)
For Brann's Forge (Three.js / WebXR / Meta Quest / Mobile Target)

Generates:
1. 2048x2048 Embedded PBR Texture Maps (BaseColor sRGB, OcclusionRoughnessMetallic Linear, Tangent Normal Map)
2. Articulated, Multi-Node 3D Geometry with Y-up, -Z Firing Forward, and 1.0 Metre Units
3. Named Empty Attachment Nodes: GripMain, GripSupport, Muzzle, BoltRest, Sight
4. Independently Named & Animatable Weapon Parts and 6-Bird Reload Crew (with child Wing & Head nodes)
5. Three Keyframe Animation Clips: Idle (2.4s), Fire (0.8s), Reload (3.2s)
6. Spec-compliant glTF 2.0 Binary (.glb) + Metadata Summary JSON for Validation & Rendering
"""

import io
import json
import math
import os
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------------------
# 1. PROCEDURAL 2048x2048 PBR TEXTURE ATLAS GENERATOR
# ---------------------------------------------------------------------------
# UV Atlas Quadrants (2048 x 2048):
# - [0.00, 0.00] -> [0.50, 0.50] : Warm Oiled Hardwood (Stock, Foregrip, Grip, Limb Core, Bolt Shaft)
# - [0.50, 0.00] -> [1.00, 0.50] : Forged Blackened Iron & Steel (Receiver, Limbs, Rail, Stirrup, Sled, Bodkin)
# - [0.00, 0.50] -> [0.50, 1.00] : Restrained Brushed Brass (Sights, Ratchet Gears, Perches, Trigger, Trim)
# - [0.50, 0.50] -> [1.00, 1.00] : Ivory & Teal Feathers, Coral Beaks, Braided Hemp String
#   - [0.50, 0.50] -> [0.75, 0.75] : Deep Forge-Teal & Iridescent Turquoise Plumage
#   - [0.75, 0.50] -> [1.00, 0.75] : Warm Cream-Ivory Breast Plumage & Feather Barbs
#   - [0.50, 0.75] -> [0.75, 1.00] : Braided Hemp Bowstring & Dark Leather Wrap
#   - [0.75, 0.75] -> [1.00, 1.00] : Warm Coral-Amber Beak/Leg & Goggle Lens Highlights

def generate_pbr_textures(res=2048):
    print(f"Generating {res}x{res} PBR texture maps (BaseColor, ORM, Normal)...")
    rng = np.random.default_rng(42)
    half = res // 2
    quarter = res // 4

    base = np.zeros((res, res, 3), dtype=np.float32)
    orm = np.zeros((res, res, 3), dtype=np.float32)   # R=Occlusion, G=Roughness, B=Metallic
    height = np.zeros((res, res), dtype=np.float32)

    y_idx, x_idx = np.mgrid[0:half, 0:half].astype(np.float32)
    u = x_idx / float(half)
    v = y_idx / float(half)

    # --- QUADRANT 1 (Top-Left in image space: y=0..half, x=0..half): WARM HARDWOOD ---
    # Rich walnut/cherry grain along U with subtle knots and pores
    grain_wave = (
        np.sin(v * 38.0 + 1.8 * np.sin(u * 6.0 + v * 4.0)) * 0.5
        + np.sin(v * 95.0 + 0.8 * np.cos(u * 14.0)) * 0.3
        + np.sin(v * 240.0 + u * 18.0) * 0.2
    )
    fine_pores = rng.normal(0.0, 0.08, (half, half)).astype(np.float32)
    wood_factor = np.clip(0.5 + 0.38 * grain_wave + fine_pores, 0.0, 1.0)
    # Warm chestnut/walnut colors: dark (#4A2512) to warm honey-mahogany (#8E4B26)
    c_dark = np.array([0.29, 0.145, 0.075], dtype=np.float32)
    c_light = np.array([0.58, 0.31, 0.155], dtype=np.float32)
    wood_rgb = c_dark[None, None, :] * (1.0 - wood_factor[:, :, None]) + c_light[None, None, :] * wood_factor[:, :, None]
    # Subtle carved border / panel lines
    border_mask = (np.minimum(np.minimum(u, 1.0 - u), np.minimum(v, 1.0 - v)) < 0.025).astype(np.float32)
    wood_rgb *= (1.0 - 0.22 * border_mask[:, :, None])

    base[0:half, 0:half] = wood_rgb
    orm[0:half, 0:half, 0] = 0.92 - 0.12 * (1.0 - wood_factor) - 0.18 * border_mask  # AO
    orm[0:half, 0:half, 1] = 0.42 + 0.14 * (1.0 - wood_factor)                       # Roughness
    orm[0:half, 0:half, 2] = 0.02                                                    # Metallic
    height[0:half, 0:half] = 0.5 + 0.25 * wood_factor - 0.2 * border_mask

    # --- QUADRANT 2 (Top-Right: y=0..half, x=half..res): FORGED IRON & STEEL ---
    # Hammered planishing dimples + brushed steel micro-scratches
    hammer_x = np.sin(u * 48.0) * np.cos(v * 48.0) + 0.5 * np.sin((u + v) * 85.0)
    iron_noise = rng.normal(0.0, 0.06, (half, half)).astype(np.float32)
    iron_val = np.clip(0.5 + 0.22 * hammer_x + iron_noise, 0.0, 1.0)
    # Cool gunmetal forged iron (#262B32 to #464E59)
    iron_dark = np.array([0.16, 0.18, 0.21], dtype=np.float32)
    iron_light = np.array([0.32, 0.35, 0.40], dtype=np.float32)
    iron_rgb = iron_dark[None, None, :] * (1.0 - iron_val[:, :, None]) + iron_light[None, None, :] * iron_val[:, :, None]

    base[0:half, half:res] = iron_rgb
    orm[0:half, half:res, 0] = 0.88 + 0.10 * iron_val
    orm[0:half, half:res, 1] = 0.36 + 0.12 * (1.0 - iron_val)
    orm[0:half, half:res, 2] = 0.86
    height[0:half, half:res] = 0.5 + 0.22 * iron_val

    # --- QUADRANT 3 (Bottom-Left: y=half..res, x=0..half): RESTRAINED BRUSHED BRASS ---
    brass_brush = np.sin(u * 180.0 + 0.4 * np.sin(v * 30.0)) * 0.25 + np.cos(v * 40.0) * 0.15
    brass_noise = rng.normal(0.0, 0.04, (half, half)).astype(np.float32)
    brass_val = np.clip(0.55 + 0.25 * brass_brush + brass_noise, 0.0, 1.0)
    # Warm restrained antique brass (#9A7432 to #DFB664)
    brass_dark = np.array([0.60, 0.44, 0.18], dtype=np.float32)
    brass_light = np.array([0.88, 0.72, 0.39], dtype=np.float32)
    brass_rgb = brass_dark[None, None, :] * (1.0 - brass_val[:, :, None]) + brass_light[None, None, :] * brass_val[:, :, None]

    base[half:res, 0:half] = brass_rgb
    orm[half:res, 0:half, 0] = 0.94
    orm[half:res, 0:half, 1] = 0.25 + 0.10 * (1.0 - brass_val)
    orm[half:res, 0:half, 2] = 0.92
    height[half:res, 0:half] = 0.5 + 0.15 * brass_val

    # --- QUADRANT 4 (Bottom-Right: y=half..res, x=half..res): FEATHERS, CORDAGE & ACCENTS ---
    qy, qx = np.mgrid[0:quarter, 0:quarter].astype(np.float32)
    qu = qx / float(quarter)
    qv = qy / float(quarter)

    # Sub-quad 4A (y=half..half+quarter, x=half..half+quarter): Deep Forge-Teal & Iridescent Feather Barbs
    barb = np.sin((qv * 60.0) - np.abs(qu - 0.5) * 45.0) * 0.5 + 0.5
    scallop = np.sin(qu * 24.0) * np.sin(qv * 18.0) * 0.5 + 0.5
    teal_mix = np.clip(0.55 * barb + 0.45 * scallop, 0.0, 1.0)
    teal_deep = np.array([0.07, 0.38, 0.43], dtype=np.float32)   # #12616E
    teal_bright = np.array([0.19, 0.73, 0.76], dtype=np.float32) # #30BAC2
    teal_rgb = teal_deep[None, None, :] * (1.0 - teal_mix[:, :, None]) + teal_bright[None, None, :] * teal_mix[:, :, None]
    base[half:half+quarter, half:half+quarter] = teal_rgb
    orm[half:half+quarter, half:half+quarter, 0] = 0.90 + 0.08 * teal_mix
    orm[half:half+quarter, half:half+quarter, 1] = 0.52 - 0.12 * teal_mix
    orm[half:half+quarter, half:half+quarter, 2] = 0.06
    height[half:half+quarter, half:half+quarter] = 0.45 + 0.30 * teal_mix

    # Sub-quad 4B (y=half..half+quarter, x=half+quarter..res): Warm Cream-Ivory Feather Plumage
    ivory_dark = np.array([0.85, 0.80, 0.71], dtype=np.float32)  # #D9CCBA
    ivory_light = np.array([0.97, 0.95, 0.90], dtype=np.float32) # #F8F2E6
    ivory_rgb = ivory_dark[None, None, :] * (1.0 - teal_mix[:, :, None]) + ivory_light[None, None, :] * teal_mix[:, :, None]
    base[half:half+quarter, half+quarter:res] = ivory_rgb
    orm[half:half+quarter, half+quarter:res, 0] = 0.92 + 0.06 * teal_mix
    orm[half:half+quarter, half+quarter:res, 1] = 0.60 - 0.08 * teal_mix
    orm[half:half+quarter, half+quarter:res, 2] = 0.01
    height[half:half+quarter, half+quarter:res] = 0.48 + 0.25 * teal_mix

    # Sub-quad 4C (y=half+quarter..res, x=half..half+quarter): Braided Hemp Bowstring & Dark Grip Leather
    braid = np.sin((qu + qv * 2.5) * 90.0) * 0.5 + 0.5
    hemp_dark = np.array([0.48, 0.40, 0.29], dtype=np.float32)
    hemp_light = np.array([0.74, 0.65, 0.50], dtype=np.float32)
    hemp_rgb = hemp_dark[None, None, :] * (1.0 - braid[:, :, None]) + hemp_light[None, None, :] * braid[:, :, None]
    base[half+quarter:res, half:half+quarter] = hemp_rgb
    orm[half+quarter:res, half:half+quarter, 0] = 0.85 + 0.12 * braid
    orm[half+quarter:res, half:half+quarter, 1] = 0.72
    orm[half+quarter:res, half:half+quarter, 2] = 0.00
    height[half+quarter:res, half:half+quarter] = 0.40 + 0.35 * braid

    # Sub-quad 4D (y=half+quarter..res, x=half+quarter..res): Warm Amber-Coral Beak/Legs & Glossy Eye/Goggle Accent
    # Left half of 4D: Warm Amber-Gold Beak (#E88D2A), Right half of 4D: Deep Charcoal-Obsidian Eye (#181B20)
    beak_rgb = np.zeros((quarter, quarter, 3), dtype=np.float32)
    beak_rgb[:, :quarter//2] = np.array([0.91, 0.55, 0.16], dtype=np.float32)[None, None, :] * (0.9 + 0.1 * qu[:, :quarter//2, None])
    beak_rgb[:, quarter//2:] = np.array([0.10, 0.12, 0.15], dtype=np.float32)[None, None, :]
    base[half+quarter:res, half+quarter:res] = beak_rgb
    orm[half+quarter:res, half+quarter:res, 0] = 0.96
    orm[half+quarter:res, half+quarter:res, 1] = 0.22
    orm[half+quarter:res, half+quarter:res, 2] = 0.04
    height[half+quarter:res, half+quarter:res] = 0.55

    # Compute Tangent-Space Normal Map from heightfield via Sobel-like finite differences
    strength = 3.2
    dh_dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dh_dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    nx = -dh_dx * strength
    ny = -dh_dy * strength
    nz = np.ones_like(height)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    norm_map = np.stack([
        (nx * inv_len) * 0.5 + 0.5,
        (ny * inv_len) * 0.5 + 0.5,
        (nz * inv_len) * 0.5 + 0.5
    ], axis=-1)

    def to_png_bytes(arr):
        img = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8), mode="RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88, optimize=True)  # Brann's Forge: JPEG like the other hero weapons
        return buf.getvalue(), img

    base_bytes, base_img = to_png_bytes(base)
    orm_bytes, orm_img = to_png_bytes(orm)
    norm_bytes, norm_img = to_png_bytes(norm_map)
    return (base_bytes, orm_bytes, norm_bytes), (base_img, orm_img, norm_img)


# ---------------------------------------------------------------------------
# 2. GEOMETRY PRIMITIVES & MESH BUILDER (Y-UP, -Z FORWARD, METRES)
# ---------------------------------------------------------------------------
# UV Region Helper Constants (note glTF V=0 is top of image):
UV_WOOD   = (0.04, 0.04, 0.46, 0.46)
UV_IRON   = (0.54, 0.04, 0.96, 0.46)
UV_BRASS  = (0.04, 0.54, 0.46, 0.96)
UV_TEAL   = (0.52, 0.52, 0.73, 0.73)
UV_IVORY  = (0.77, 0.52, 0.98, 0.73)
UV_HEMP   = (0.52, 0.77, 0.73, 0.98)
UV_BEAK   = (0.77, 0.77, 0.86, 0.98)
UV_EYE    = (0.89, 0.77, 0.98, 0.98)


class MeshBuilder:
    def __init__(self, name, material_idx):
        self.name = name
        self.material_idx = material_idx
        self.positions = []
        self.normals = []
        self.uvs = []
        self.indices = []

    def add_raw(self, pos, norm, uv, idx):
        offset = len(self.positions)
        self.positions.extend(pos)
        self.normals.extend(norm)
        self.uvs.extend(uv)
        self.indices.extend([offset + i for i in idx])

    def add_box(self, center, size, uv_rect, rot_euler=(0.0, 0.0, 0.0), taper_top=1.0, taper_front=1.0):
        cx, cy, cz = center
        sx, sy, sz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
        u0, v0, u1, v1 = uv_rect
        R = euler_to_matrix(*rot_euler)

        # 6 faces, each 4 vertices with outward normal
        faces = [
            # +X Right
            ([ (sx, -sy,  sz), (sx, -sy, -sz), (sx*taper_top,  sy, -sz), (sx*taper_top,  sy,  sz) ], ( 1,  0,  0)),
            # -X Left
            ([ (-sx, -sy, -sz), (-sx, -sy,  sz), (-sx*taper_top,  sy,  sz), (-sx*taper_top,  sy, -sz) ], (-1,  0,  0)),
            # +Y Top
            ([ (-sx*taper_top,  sy,  sz), ( sx*taper_top,  sy,  sz), ( sx*taper_top*taper_front,  sy, -sz), (-sx*taper_top*taper_front,  sy, -sz) ], ( 0,  1,  0)),
            # -Y Bottom
            ([ (-sx, -sy, -sz), ( sx, -sy, -sz), ( sx, -sy,  sz), (-sx, -sy,  sz) ], ( 0, -1,  0)),
            # +Z Rear
            ([ (-sx, -sy,  sz), ( sx, -sy,  sz), ( sx*taper_top,  sy,  sz), (-sx*taper_top,  sy,  sz) ], ( 0,  0,  1)),
            # -Z Front
            ([ ( sx*taper_front, -sy, -sz), (-sx*taper_front, -sy, -sz), (-sx*taper_top*taper_front,  sy, -sz), ( sx*taper_top*taper_front,  sy, -sz) ], ( 0,  0, -1)),
        ]
        face_uvs = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
        for verts, n in faces:
            p_list = []
            # compute actual face normal from transformed vertices
            tv = [R @ np.array(v, dtype=np.float64) + np.array([cx, cy, cz]) for v in verts]
            fn = np.cross(tv[1] - tv[0], tv[2] - tv[0])
            fn_len = np.linalg.norm(fn)
            fn = fn / fn_len if fn_len > 1e-9 else R @ np.array(n, dtype=np.float64)
            n_list = [fn.tolist() for _ in range(4)]
            for tv_i in tv:
                p_list.append(tv_i.tolist())
            self.add_raw(p_list, n_list, face_uvs, [0, 1, 2, 0, 2, 3])

    def add_cylinder(self, p0, p1, r0, r1, segments, uv_rect, cap_ends=True):
        p0 = np.array(p0, dtype=np.float64)
        p1 = np.array(p1, dtype=np.float64)
        axis = p1 - p0
        length = np.linalg.norm(axis)
        if length < 1e-8:
            return
        d = axis / length
        up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        tangent = np.cross(up, d)
        tangent /= np.linalg.norm(tangent)
        bitangent = np.cross(d, tangent)

        u0, v0, u1, v1 = uv_rect
        pos, norm, uvs, idx = [], [], [], []
        for i in range(segments + 1):
            frac = i / float(segments)
            ang = frac * 2.0 * math.pi
            ca, sa = math.cos(ang), math.sin(ang)
            radial = ca * tangent + sa * bitangent
            v_bot = p0 + r0 * radial
            v_top = p1 + r1 * radial
            pos.append(v_bot.tolist())
            pos.append(v_top.tolist())
            norm.append(radial.tolist())
            norm.append(radial.tolist())
            u = u0 + frac * (u1 - u0)
            uvs.append((u, v1))
            uvs.append((u, v0))

        for i in range(segments):
            b0 = 2 * i
            t0 = 2 * i + 1
            b1 = 2 * (i + 1)
            t1 = 2 * (i + 1) + 1
            idx.extend([b0, b1, t1, b0, t1, t0])
        self.add_raw(pos, norm, uvs, idx)

        if cap_ends:
            um, vm = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
            du, dv = 0.45 * (u1 - u0), 0.45 * (v1 - v0)
            if r0 > 1e-6:
                c_pos = [p0.tolist()]
                c_norm = [(-d).tolist()]
                c_uv = [(um, vm)]
                c_idx = []
                for i in range(segments):
                    ang = (i / float(segments)) * 2.0 * math.pi
                    radial = math.cos(ang) * tangent + math.sin(ang) * bitangent
                    c_pos.append((p0 + r0 * radial).tolist())
                    c_norm.append((-d).tolist())
                    c_uv.append((um + math.cos(ang) * du, vm + math.sin(ang) * dv))
                for i in range(segments):
                    c_idx.extend([0, 1 + ((i + 1) % segments), 1 + i])
                self.add_raw(c_pos, c_norm, c_uv, c_idx)
            if r1 > 1e-6:
                c_pos = [p1.tolist()]
                c_norm = [d.tolist()]
                c_uv = [(um, vm)]
                c_idx = []
                for i in range(segments):
                    ang = (i / float(segments)) * 2.0 * math.pi
                    radial = math.cos(ang) * tangent + math.sin(ang) * bitangent
                    c_pos.append((p1 + r1 * radial).tolist())
                    c_norm.append(d.tolist())
                    c_uv.append((um + math.cos(ang) * du, vm + math.sin(ang) * dv))
                for i in range(segments):
                    c_idx.extend([0, 1 + i, 1 + ((i + 1) % segments)])
                self.add_raw(c_pos, c_norm, c_uv, c_idx)

    def add_ellipsoid(self, center, radii, rings, sectors, uv_rect, rot_euler=(0.0, 0.0, 0.0)):
        cx, cy, cz = center
        rx, ry, rz = radii
        R = euler_to_matrix(*rot_euler)
        u0, v0, u1, v1 = uv_rect
        pos, norm, uvs, idx = [], [], [], []
        for r in range(rings + 1):
            v_frac = r / float(rings)
            phi = v_frac * math.pi
            sp, cp = math.sin(phi), math.cos(phi)
            for s in range(sectors + 1):
                u_frac = s / float(sectors)
                theta = u_frac * 2.0 * math.pi
                st, ct = math.sin(theta), math.cos(theta)
                lp = np.array([rx * sp * ct, ry * cp, rz * sp * st], dtype=np.float64)
                ln = np.array([sp * ct / max(rx, 1e-6), cp / max(ry, 1e-6), sp * st / max(rz, 1e-6)], dtype=np.float64)
                ln /= max(np.linalg.norm(ln), 1e-9)
                wp = R @ lp + np.array([cx, cy, cz])
                wn = R @ ln
                pos.append(wp.tolist())
                norm.append(wn.tolist())
                uvs.append((u0 + u_frac * (u1 - u0), v0 + v_frac * (v1 - v0)))
        for r in range(rings):
            for s in range(sectors):
                i0 = r * (sectors + 1) + s
                i1 = i0 + 1
                i2 = (r + 1) * (sectors + 1) + s
                i3 = i2 + 1
                idx.extend([i0, i1, i2, i1, i3, i2])  # Brann's Forge: wound outward (the original faced inward)
        self.add_raw(pos, norm, uvs, idx)

    def add_lofted_tube(self, spine_pts, radii_xy, segments, uv_rect, cap_ends=True):
        """Lofts an elliptical cross-section along a 3D spine curve."""
        u0, v0, u1, v1 = uv_rect
        n_spine = len(spine_pts)
        pts = [np.array(p, dtype=np.float64) for p in spine_pts]
        pos, norm, uvs, idx = [], [], [], []

        frames_t = []
        frames_b = []
        frames_d = []
        for i in range(n_spine):
            if i == 0:
                d = pts[1] - pts[0]
            elif i == n_spine - 1:
                d = pts[-1] - pts[-2]
            else:
                d = pts[i + 1] - pts[i - 1]
            d /= max(np.linalg.norm(d), 1e-9)
            up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
            t = np.cross(up, d)
            t /= max(np.linalg.norm(t), 1e-9)
            b = np.cross(d, t)
            frames_t.append(t)
            frames_b.append(b)
            frames_d.append(d)

        for i in range(n_spine):
            v_frac = i / float(max(n_spine - 1, 1))
            rx, ry = radii_xy[i]
            t, b = frames_t[i], frames_b[i]
            for s in range(segments + 1):
                u_frac = s / float(segments)
                ang = u_frac * 2.0 * math.pi
                ca, sa = math.cos(ang), math.sin(ang)
                offset = (rx * ca) * t + (ry * sa) * b
                n_vec = (ca / max(rx, 1e-6)) * t + (sa / max(ry, 1e-6)) * b
                n_vec /= max(np.linalg.norm(n_vec), 1e-9)
                pos.append((pts[i] + offset).tolist())
                norm.append(n_vec.tolist())
                uvs.append((u0 + u_frac * (u1 - u0), v0 + v_frac * (v1 - v0)))

        for i in range(n_spine - 1):
            for s in range(segments):
                i0 = i * (segments + 1) + s
                i1 = i0 + 1
                i2 = (i + 1) * (segments + 1) + s
                i3 = i2 + 1
                idx.extend([i0, i1, i3, i0, i3, i2])
        self.add_raw(pos, norm, uvs, idx)

        if cap_ends:
            for end_idx, flip in [(0, True), (n_spine - 1, False)]:
                rx, ry = radii_xy[end_idx]
                if rx < 1e-6 or ry < 1e-6:
                    continue
                t, b, d = frames_t[end_idx], frames_b[end_idx], frames_d[end_idx]
                cn = (-d if flip else d).tolist()
                um, vm = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
                c_pos = [pts[end_idx].tolist()]
                c_norm = [cn]
                c_uv = [(um, vm)]
                c_idx = []
                for s in range(segments):
                    ang = (s / float(segments)) * 2.0 * math.pi
                    ca, sa = math.cos(ang), math.sin(ang)
                    c_pos.append((pts[end_idx] + (rx * ca) * t + (ry * sa) * b).tolist())
                    c_norm.append(cn)
                    c_uv.append((um, vm))
                for s in range(segments):
                    if flip:
                        c_idx.extend([0, 1 + ((s + 1) % segments), 1 + s])
                    else:
                        c_idx.extend([0, 1 + s, 1 + ((s + 1) % segments)])
                self.add_raw(c_pos, c_norm, c_uv, c_idx)


def euler_to_matrix(rx, ry, rz):
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float64)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float64)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float64)
    return Rz @ Ry @ Rx


def euler_to_quat(rx, ry, rz):
    """Returns glTF quaternion [x, y, z, w] from XYZ Euler angles (radians)."""
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)
    qx = sx * cy * cz - cx * sy * sz
    qy = cx * sy * cz + sx * cy * sz
    qz = cx * cy * sz - sx * sy * cz
    qw = cx * cy * cz + sx * sy * sz
    return [round(float(qx), 6), round(float(qy), 6), round(float(qz), 6), round(float(qw), 6)]


# ---------------------------------------------------------------------------
# 3. BUILD SIEGEBIRD WEAPON, MECHANISM & 6 CHARMING BIRDS
# ---------------------------------------------------------------------------
# Material Indices:
# 0: Mat_WarmHardwood
# 1: Mat_ForgedIron
# 2: Mat_RestrainedBrass
# 3: Mat_FeathersAndCord

def build_weapon_frame_meshes():
    """Builds WeaponFrame node meshes (Wood stock/grips, Iron prod housing/stirrup/quiver, Brass perches/trim)."""
    m_wood = MeshBuilder("WeaponFrame_Wood", 0)
    m_iron = MeshBuilder("WeaponFrame_Iron", 1)
    m_brass = MeshBuilder("WeaponFrame_Brass", 2)

    # 1. Warm Hardwood Main Tiller / Stock Body (Z from -0.32m front prod block to +0.23m buttstock)
    stock_spine = [
        (0.0,  0.008, -0.320),
        (0.0,  0.010, -0.220),
        (0.0,  0.006, -0.080),
        (0.0,  0.004,  0.050),
        (0.0, -0.006,  0.140),
        (0.0, -0.014,  0.225),
    ]
    stock_radii = [
        (0.024, 0.022),
        (0.028, 0.026),
        (0.026, 0.028),
        (0.025, 0.027),
        (0.022, 0.032),
        (0.018, 0.036),
    ]
    m_wood.add_lofted_tube(stock_spine, stock_radii, 12, UV_WOOD)

    # Upper Hardwood Cheek-Piece & Decorative Fluted Side Panels
    m_wood.add_box((0.0, 0.012, 0.165), (0.042, 0.030, 0.130), UV_WOOD, taper_top=0.82)
    m_wood.add_box((0.0, 0.014, -0.120), (0.050, 0.026, 0.340), UV_WOOD, taper_top=0.88, taper_front=0.82)

    # Ergonomic Main Pistol Grip (aligned with GripMain at [0, -0.075, +0.065])
    grip_spine = [
        (0.0, -0.010, 0.048),
        (0.0, -0.045, 0.058),
        (0.0, -0.085, 0.070),
        (0.0, -0.125, 0.082),
        (0.0, -0.140, 0.088),
    ]
    grip_radii = [
        (0.020, 0.026),
        (0.018, 0.024),
        (0.019, 0.025),
        (0.021, 0.027),
        (0.024, 0.030),
    ]
    m_wood.add_lofted_tube(grip_spine, grip_radii, 12, UV_WOOD)

    # Sculpted Off-Hand Support Foregrip (aligned with GripSupport at [0, -0.042, -0.185])
    fore_spine = [
        (0.0, -0.012, -0.255),
        (0.0, -0.038, -0.220),
        (0.0, -0.046, -0.185),
        (0.0, -0.038, -0.145),
        (0.0, -0.014, -0.115),
    ]
    fore_radii = [
        (0.018, 0.016),
        (0.022, 0.022),
        (0.024, 0.026),
        (0.022, 0.022),
        (0.018, 0.016),
    ]
    m_wood.add_lofted_tube(fore_spine, fore_radii, 10, UV_WOOD)

    # 2. Forged Iron Prod Block, Trigger Guard, Side Straps & Foot Stirrup
    # Heavy forged prod head block at Z = -0.320m
    m_iron.add_box((0.0, 0.022, -0.320), (0.125, 0.046, 0.064), UV_IRON, taper_top=0.92, taper_front=0.86)
    # Left & Right Limb Socket Collars
    m_iron.add_box((-0.055, 0.032, -0.320), (0.034, 0.042, 0.054), UV_IRON, rot_euler=(0.0,  0.18, 0.0))
    m_iron.add_box(( 0.055, 0.032, -0.320), (0.034, 0.042, 0.054), UV_IRON, rot_euler=(0.0, -0.18, 0.0))

    # Front Foot Stirrup (Forged Iron Arch extending to Z = -0.440m)
    stirrup_pts = [
        (-0.034, 0.016, -0.340),
        (-0.048, 0.010, -0.395),
        (-0.032, 0.006, -0.436),
        ( 0.000, 0.005, -0.442),
        ( 0.032, 0.006, -0.436),
        ( 0.048, 0.010, -0.395),
        ( 0.034, 0.016, -0.340),
    ]
    m_iron.add_lofted_tube(stirrup_pts, [(0.006, 0.008)] * len(stirrup_pts), 8, UV_IRON)

    # Forged Trigger Guard Loop
    tguard_pts = [
        (0.0, -0.012, -0.025),
        (0.0, -0.048, -0.010),
        (0.0, -0.058,  0.025),
        (0.0, -0.050,  0.055),
    ]
    m_iron.add_lofted_tube(tguard_pts, [(0.008, 0.005)] * len(tguard_pts), 8, UV_IRON)

    # Receiver Iron Side Plates & Under-Rail Quiver Brackets
    m_iron.add_box((0.0, 0.018, 0.055), (0.062, 0.038, 0.110), UV_IRON)
    for side in (-1.0, 1.0):
        # Side quiver clips holding reserve bolts
        m_iron.add_cylinder((side * 0.024, -0.008, -0.180), (side * 0.038, -0.016, -0.180), 0.005, 0.005, 8, UV_IRON)
        m_iron.add_cylinder((side * 0.024, -0.008, -0.040), (side * 0.038, -0.016, -0.040), 0.005, 0.005, 8, UV_IRON)
        # Reserve Bolt Shafts in side magazine racks (giving clear mechanical origin for Bird_05 & Bird_06)
        m_wood.add_cylinder((side * 0.038, -0.016, -0.240), (side * 0.038, -0.016, -0.010), 0.004, 0.004, 8, UV_WOOD)
        m_iron.add_cylinder((side * 0.038, -0.016, -0.240), (side * 0.038, -0.016, -0.275), 0.006, 0.001, 8, UV_IRON)

    # 3. Restrained Brass Trim, Pommel Cap & 6 Dedicated Bird Perches
    # Pistol Grip Brass Pommel Cap & Buttplate
    m_brass.add_ellipsoid((0.0, -0.142, 0.090), (0.025, 0.010, 0.031), 6, 10, UV_BRASS)
    m_brass.add_box((0.0, -0.008, 0.232), (0.038, 0.068, 0.016), UV_BRASS, taper_top=0.85)
    # Decorative Brass Side Rosettes on Prod & Receiver
    for side in (-1.0, 1.0):
        m_brass.add_cylinder((side * 0.062, 0.024, -0.320), (side * 0.068, 0.024, -0.320), 0.014, 0.012, 10, UV_BRASS)
        m_brass.add_cylinder((side * 0.030, 0.018,  0.065), (side * 0.056, 0.018,  0.065), 0.006, 0.006, 10, UV_BRASS)

    # 6 Outboard Bird Perch Assemblies (Brass Scroll Arms + Warm Hardwood Dowel Perches)
    # Kept completely outside X = ±0.045m so the central sight line (X = 0) is 100% unobstructed!
    perch_specs = [
        # (attach_xyz, perch_center_xyz)
        ((-0.032, 0.026, -0.250), (-0.068, 0.040, -0.250)), # Perch 1: Bird_01_Spotter (Front Left)
        (( 0.032, 0.026, -0.250), ( 0.068, 0.040, -0.250)), # Perch 2: Bird_02_Hooker  (Front Right)
        ((-0.030, 0.022,  0.065), (-0.064, 0.034,  0.065)), # Perch 3: Bird_03_WinchLeft (Rear Left)
        (( 0.030, 0.022,  0.065), ( 0.064, 0.034,  0.065)), # Perch 4: Bird_04_WinchRight (Rear Right)
        ((-0.026, 0.002, -0.095), (-0.058, 0.002, -0.095)), # Perch 5: Bird_05_LoaderLeft (Mid Left)
        (( 0.026, 0.002, -0.095), ( 0.058, 0.002, -0.095)), # Perch 6: Bird_06_LoaderRight (Mid Right)
    ]
    for p_base, p_tip in perch_specs:
        sign = -1.0 if p_tip[0] < 0 else 1.0
        mid = (0.5 * (p_base[0] + p_tip[0]), min(p_base[1], p_tip[1]) - 0.012, p_base[2])
        m_brass.add_lofted_tube([p_base, mid, p_tip], [(0.004, 0.004)] * 3, 8, UV_BRASS)
        # Hardwood perch dowel along X with brass end finials
        d0 = (p_tip[0] - sign * 0.014, p_tip[1], p_tip[2])
        d1 = (p_tip[0] + sign * 0.018, p_tip[1], p_tip[2])
        m_wood.add_cylinder(d0, d1, 0.0045, 0.0045, 8, UV_WOOD)
        m_brass.add_ellipsoid(d1, (0.006, 0.006, 0.006), 5, 8, UV_BRASS)

    return [m_wood, m_iron, m_brass]


def build_bolt_rail_meshes():
    """Builds BoltRail & Unobstructed Aiming Sights (Central Sight Corridor along X=0, Y=+0.068m)."""
    m_iron = MeshBuilder("BoltRail_Iron", 1)
    m_brass = MeshBuilder("BoltRail_Brass", 2)

    # Left & Right Forged Iron Rail Cheeks forming the central bolt groove & sled side tracks
    for side in (-1.0, 1.0):
        m_iron.add_box((side * 0.012, 0.032, -0.125), (0.012, 0.012, 0.430), UV_IRON)
    # Brass-inlaid low-friction bolt channel floor
    m_brass.add_box((0.0, 0.027, -0.125), (0.012, 0.004, 0.430), UV_BRASS)

    # UNOBSTRUCTED FRONT & REAR AIMING SIGHTS (Line of Sight at X = 0.0, Y = +0.068m)
    # Rear Peep / Open Ring Sight at Z = +0.095m
    m_brass.add_box((-0.014, 0.048, 0.095), (0.005, 0.028, 0.010), UV_BRASS)
    m_brass.add_box(( 0.014, 0.048, 0.095), (0.005, 0.028, 0.010), UV_BRASS)
    # Rear sight aperture ring centered at (0.0, 0.068, 0.095) with radius 0.015m
    ring_segs = 16
    ring_pts = []
    for i in range(ring_segs + 1):
        ang = (i / float(ring_segs)) * 2.0 * math.pi
        ring_pts.append((0.015 * math.cos(ang), 0.068 + 0.015 * math.sin(ang), 0.095))
    m_brass.add_lofted_tube(ring_pts, [(0.0025, 0.003)] * len(ring_pts), 8, UV_BRASS, cap_ends=False)

    # Front Hooded Post Sight at Z = -0.350m (Open top arch + precision brass bead at Y = +0.068m)
    m_brass.add_cylinder((0.0, 0.038, -0.350), (0.0, 0.065, -0.350), 0.0025, 0.0018, 8, UV_BRASS)
    m_brass.add_ellipsoid((0.0, 0.068, -0.350), (0.0032, 0.0032, 0.0032), 6, 8, UV_BRASS)
    # Protective wide side ears around front sight (keeping central view open)
    for side in (-1.0, 1.0):
        m_iron.add_box((side * 0.018, 0.056, -0.350), (0.004, 0.030, 0.014), UV_IRON, rot_euler=(0.0, 0.0, -side * 0.20))

    return [m_iron, m_brass]


def build_prod_limb_meshes(is_left=True):
    """Builds ProdLimb_L or ProdLimb_R in local space around pivot [±0.055, +0.036, -0.320]."""
    sign = -1.0 if is_left else 1.0
    suffix = "L" if is_left else "R"
    m_iron = MeshBuilder(f"ProdLimb_{suffix}_Iron", 1)
    m_wood = MeshBuilder(f"ProdLimb_{suffix}_Wood", 0)
    m_brass = MeshBuilder(f"ProdLimb_{suffix}_Brass", 2)
    m_teal = MeshBuilder(f"ProdLimb_{suffix}_Accent", 3)

    # Recurve bow limb spine in local coordinates from pivot (0,0,0) out to tip (sign*0.210, 0.002, 0.060)
    # In world space when unrotated: tip is at X = ±0.265m, Y = +0.038m, Z = -0.260m
    spine = [
        (0.000 * sign,  0.000,  0.000),
        (0.045 * sign,  0.001, -0.010),
        (0.095 * sign,  0.002,  0.002),
        (0.145 * sign,  0.002,  0.028),
        (0.185 * sign,  0.002,  0.052),
        (0.210 * sign,  0.002,  0.060),
    ]
    radii_iron = [
        (0.012, 0.022),
        (0.011, 0.020),
        (0.009, 0.017),
        (0.008, 0.014),
        (0.006, 0.011),
        (0.005, 0.009),
    ]
    m_iron.add_lofted_tube(spine, radii_iron, 10, UV_IRON)

    # Warm hardwood laminated belly backing along the inner curve
    spine_wood = [(p[0], p[1], p[2] + 0.006) for p in spine[:-1]]
    radii_wood = [(r[0] * 0.78, r[1] * 0.72) for r in radii_iron[:-1]]
    m_wood.add_lofted_tube(spine_wood, radii_wood, 8, UV_WOOD)

    # Ivory-and-teal painted feather motif cuff near limb tip
    m_teal.add_cylinder(spine[3], spine[4], 0.012, 0.010, 8, UV_TEAL)

    # Brass Recurve Tip Nock & String Pin at local (sign*0.210, 0.002, 0.060)
    tip = spine[-1]
    m_brass.add_ellipsoid(tip, (0.009, 0.013, 0.011), 6, 10, UV_BRASS)
    m_brass.add_cylinder((tip[0], tip[1] - 0.014, tip[2]), (tip[0], tip[1] + 0.016, tip[2]), 0.004, 0.004, 8, UV_BRASS)

    return [m_iron, m_wood, m_brass, m_teal]


def build_bowstring_meshes():
    """
    Builds BowString node centered at the drawn string nock [0.0, +0.038, +0.045] in rest state,
    with child left/right string segments that pivot & scale to track the limb tips cleanly.
    """
    m_nock = MeshBuilder("BowString_CenterNock", 2)
    # Brass center serving collar & nock bead
    m_nock.add_cylinder((-0.018, 0.0, 0.0), (0.018, 0.0, 0.0), 0.0045, 0.0045, 8, UV_BRASS)
    return [m_nock]


STRING_BASE_LEN = 0.265

def build_bowstring_half_mesh(is_left=True):
    """String segment of base length 0.265m along local (-X if left, +X if right) from center nock."""
    sign = -1.0 if is_left else 1.0
    suffix = "L" if is_left else "R"
    m_cord = MeshBuilder(f"BowString_{suffix}_Cord", 3)
    m_cord.add_cylinder((0.0, 0.0, 0.0), (sign * STRING_BASE_LEN, 0.0, 0.0), 0.0034, 0.0034, 8, UV_HEMP)
    m_cord.add_ellipsoid((sign * STRING_BASE_LEN, 0.0, 0.0), (0.0065, 0.0065, 0.0065), 5, 8, UV_BRASS)
    return [m_cord]


def compute_limb_and_string_pose(flex_angle, z_nock):
    """
    Given limb flex magnitude `flex_angle` (0.0 = brace, 0.26 = full draw) and center string `z_nock`:
    - ProdLimb_L pivots at (-0.055, 0.036, -0.320) with Ry(+flex_angle)
    - ProdLimb_R pivots at (+0.055, 0.036, -0.320) with Ry(-flex_angle)
    - Local tip is at (sign * 0.210, 0.002, +0.060)
    Returns exact (rot_limb_L, rot_limb_R, rot_str_L, rot_str_R, scale_str_L, scale_str_R).
    """
    ca, sa = math.cos(flex_angle), math.sin(flex_angle)
    # Right limb (sign = +1, theta = -flex_angle):
    # x_tip = 0.055 + 0.210*cos(flex) - 0.060*sin(flex)
    # z_tip = -0.320 + 0.210*sin(flex) + 0.060*cos(flex)
    x_tip = 0.055 + 0.210 * ca - 0.060 * sa
    z_tip = -0.320 + 0.210 * sa + 0.060 * ca
    dz = z_tip - z_nock
    dist = math.sqrt(x_tip * x_tip + dz * dz)
    sx = dist / STRING_BASE_LEN
    # For sign = -1 (Left): theta_str_L = atan2(dz, x_tip)
    # For sign = +1 (Right): theta_str_R = atan2(-dz, x_tip)
    theta_str_l = math.atan2(dz, x_tip)
    theta_str_r = math.atan2(-dz, x_tip)
    return (
        euler_to_quat(0.0,  flex_angle, 0.0),
        euler_to_quat(0.0, -flex_angle, 0.0),
        euler_to_quat(0.0, theta_str_l, 0.0),
        euler_to_quat(0.0, theta_str_r, 0.0),
        [round(sx, 6), 1.0, 1.0],
        [round(sx, 6), 1.0, 1.0],
    )


def build_bolt_meshes():
    """
    Builds the primary active Bolt centered at BoltRest [0.0, +0.038, -0.120].
    In local space of Bolt node (origin at [0.0, +0.038, -0.120]):
    - Rear nock is at local Z = +0.160m (world Z = +0.040m, right against the drawn string!)
    - Forged bodkin tip is at local Z = -0.240m (world Z = -0.360m)
    - Total Bolt length = 0.400m
    """
    m_wood = MeshBuilder("Bolt_Shaft", 0)
    m_iron = MeshBuilder("Bolt_BodkinHead", 1)
    m_brass = MeshBuilder("Bolt_Ferrule", 2)
    m_fletch = MeshBuilder("Bolt_Fletching", 3)

    # Hardwood shaft (local Z from +0.155m to -0.165m)
    m_wood.add_cylinder((0.0, 0.0, 0.155), (0.0, 0.0, -0.165), 0.0055, 0.0055, 10, UV_WOOD)
    # Brass rear nock cap & front ferrule collar
    m_brass.add_cylinder((0.0, 0.0, 0.162), (0.0, 0.0, 0.145), 0.0060, 0.0058, 10, UV_BRASS)
    m_brass.add_cylinder((0.0, 0.0, -0.155), (0.0, 0.0, -0.175), 0.0062, 0.0070, 10, UV_BRASS)

    # Forged-iron 4-sided armored bodkin point (local Z from -0.175m to -0.245m)
    m_iron.add_cylinder((0.0, 0.0, -0.175), (0.0, 0.0, -0.200), 0.0070, 0.0110, 4, UV_IRON)
    m_iron.add_cylinder((0.0, 0.0, -0.200), (0.0, 0.0, -0.245), 0.0110, 0.0008, 4, UV_IRON)

    # Ivory-and-Teal 3-Vane Feather Fletching (local Z from +0.055m to +0.140m)
    for i in range(3):
        ang = math.radians(90.0 + i * 120.0) # One top vane + two angled side vanes clearing the rail groove
        uv_choice = UV_TEAL if i < 2 else UV_IVORY
        vane_Spine = [
            (0.005 * math.cos(ang), 0.005 * math.sin(ang), 0.055),
            (0.016 * math.cos(ang), 0.016 * math.sin(ang), 0.085),
            (0.019 * math.cos(ang), 0.019 * math.sin(ang), 0.125),
            (0.006 * math.cos(ang), 0.006 * math.sin(ang), 0.142),
        ]
        m_fletch.add_box(
            (0.012 * math.cos(ang), 0.012 * math.sin(ang), 0.100),
            (0.0025, 0.018, 0.082),
            uv_choice,
            rot_euler=(0.0, 0.0, ang - math.pi * 0.5),
            taper_front=0.35
        )

    return [m_wood, m_iron, m_brass, m_fletch]


def build_mechanism_meshes():
    """Builds moving mechanical nodes: Trigger, StringCatch, StringCarrierSled, RatchetWheel_L/R, BoltLifterArms."""
    # 1. Trigger (pivot at [0.0, -0.008, +0.030])
    m_trig = MeshBuilder("Trigger_Brass", 2)
    trig_pts = [
        (0.0,  0.000,  0.000),
        (0.0, -0.018, -0.004),
        (0.0, -0.034,  0.002),
        (0.0, -0.044,  0.012),
    ]
    m_trig.add_lofted_tube(trig_pts, [(0.0045, 0.006), (0.0045, 0.005), (0.004, 0.005), (0.005, 0.006)], 8, UV_BRASS)

    # 2. StringCatch (Rotating brass nut/sear at [0.0, +0.030, +0.045])
    m_catch = MeshBuilder("StringCatch_Brass", 2)
    m_catch.add_cylinder((-0.012, 0.0, 0.0), (0.012, 0.0, 0.0), 0.011, 0.011, 12, UV_BRASS)
    m_catch.add_box((-0.008, 0.009, -0.002), (0.004, 0.010, 0.008), UV_BRASS)
    m_catch.add_box(( 0.008, 0.009, -0.002), (0.004, 0.010, 0.008), UV_BRASS)

    # 3. StringCarrierSled (Sliding claw carriage at [0.0, +0.036, +0.045])
    m_sled_iron = MeshBuilder("StringCarrierSled_Iron", 1)
    m_sled_brass = MeshBuilder("StringCarrierSled_Brass", 2)
    for side in (-1.0, 1.0):
        # Side runner plates & bird beak hook-handles
        m_sled_iron.add_box((side * 0.022, -0.002, 0.0), (0.008, 0.014, 0.044), UV_IRON)
        m_sled_brass.add_box((side * 0.026,  0.008, -0.008), (0.012, 0.010, 0.016), UV_BRASS)
        # Small brass ring handles on the sled flanks where Bird_01 & Bird_02 hook the string
        m_sled_brass.add_cylinder((side * 0.024, 0.012, -0.008), (side * 0.036, 0.012, -0.008), 0.004, 0.004, 8, UV_BRASS)

    # 4. RatchetWheel_L & RatchetWheel_R (Twin brass windlass tread-wheels at [±0.048, +0.018, +0.065])
    def make_wheel(suffix):
        mw_brass = MeshBuilder(f"RatchetWheel_{suffix}_Brass", 2)
        mw_iron = MeshBuilder(f"RatchetWheel_{suffix}_Iron", 1)
        mw_brass.add_cylinder((-0.007, 0.0, 0.0), (0.007, 0.0, 0.0), 0.024, 0.024, 16, UV_BRASS)
        mw_iron.add_cylinder((-0.009, 0.0, 0.0), (0.009, 0.0, 0.0), 0.010, 0.010, 10, UV_IRON)
        # 8 bird-tread paddles around the wheel rim so Bird_03 & Bird_04 can visibly treadmill it!
        for k in range(8):
            ang = k * (math.pi / 4.0)
            py, pz = 0.025 * math.sin(ang), 0.025 * math.cos(ang)
            mw_brass.add_box((0.0, py, pz), (0.014, 0.004, 0.006), UV_BRASS, rot_euler=(ang, 0.0, 0.0))
        return [mw_brass, mw_iron]

    # 5. BoltLifterArms (Hinged brass cradle arms at [0.0, +0.008, -0.110])
    m_lifter = MeshBuilder("BoltLifterArms_Brass", 2)
    for side in (-1.0, 1.0):
        for z_off in (-0.055, 0.055):
            m_lifter.add_box((side * 0.028, 0.006, z_off), (0.018, 0.005, 0.008), UV_BRASS, rot_euler=(0.0, 0.0, side * 0.25))

    return {
        "Trigger": [m_trig],
        "StringCatch": [m_catch],
        "StringCarrierSled": [m_sled_iron, m_sled_brass],
        "RatchetWheel_L": make_wheel("L"),
        "RatchetWheel_R": make_wheel("R"),
        "BoltLifterArms": [m_lifter],
    }


def build_charming_bird_parts(bird_name):
    """
    Builds one charming Brann's Forge tinker-finch with separate meshes for:
    - Body (plump ivory breast, forge-teal back, fanned tail feathers, tiny brass leg bands & feet, brass collar)
    - Head (child node at local [0.0, +0.022, -0.014]: round teal-and-ivory head, crest tuft, coral beak, obsidian eyes, brass tinkerer goggles!)
    - Wing_L (child node at local [-0.018, +0.014, -0.002])
    - Wing_R (child node at local [+0.018, +0.014, -0.002])
    """
    # Body Node Meshes (origin at bird feet / perch contact so sitting on a perch is exact)
    b_feathers = MeshBuilder(f"{bird_name}_BodyFeathers", 3)
    b_brass = MeshBuilder(f"{bird_name}_BodyBrass", 2)

    # Plump teal outer torso + warm ivory chest puff
    b_feathers.add_ellipsoid((0.0, 0.018,  0.002), (0.019, 0.018, 0.024), 8, 12, UV_TEAL, rot_euler=(-0.18, 0.0, 0.0))
    b_feathers.add_ellipsoid((0.0, 0.016, -0.005), (0.016, 0.015, 0.019), 8, 10, UV_IVORY, rot_euler=(-0.12, 0.0, 0.0))

    # Fanned Ivory-and-Teal Tail Feathers (3 splayed tail plumes at rear +Z)
    for t_idx, x_ang in enumerate((-0.26, 0.0, 0.26)):
        uv_t = UV_IVORY if t_idx == 1 else UV_TEAL
        b_feathers.add_box(
            (math.sin(x_ang) * 0.008, 0.022, 0.032),
            (0.009, 0.003, 0.026),
            uv_t,
            rot_euler=(0.32, x_ang, 0.0),
            taper_front=0.6
        )

    # Sturdy little coral-amber legs & toes gripping the perch + tiny brass leg band
    for side in (-1.0, 1.0):
        b_feathers.add_cylinder((side * 0.008, 0.000, 0.000), (side * 0.008, 0.010, 0.001), 0.0022, 0.0026, 6, UV_BEAK)
        b_feathers.add_box((side * 0.008, 0.001, -0.003), (0.004, 0.0025, 0.009), UV_BEAK)
    b_brass.add_cylinder((-0.008, 0.003, 0.000), (-0.008, 0.007, 0.000), 0.0030, 0.0030, 8, UV_BRASS)

    # Head Child Node Meshes (pivot at [0.0, +0.028, -0.012])
    h_feathers = MeshBuilder(f"{bird_name}_HeadFeathers", 3)
    h_brass = MeshBuilder(f"{bird_name}_HeadGoggles", 2)
    h_iron = MeshBuilder(f"{bird_name}_HeadLenses", 1)

    # Round teal cranium + ivory cheek patches
    h_feathers.add_ellipsoid((0.0, 0.008, -0.002), (0.015, 0.014, 0.016), 8, 12, UV_TEAL)
    h_feathers.add_ellipsoid((0.0, 0.005, -0.006), (0.013, 0.010, 0.013), 6, 10, UV_IVORY)
    # Charming perky double feather crest on top of head
    h_feathers.add_box((0.0, 0.023, 0.004), (0.004, 0.012, 0.008), UV_TEAL, rot_euler=(-0.45, 0.0, 0.0), taper_top=0.4)
    h_feathers.add_box((0.0, 0.020, 0.010), (0.003, 0.010, 0.007), UV_IVORY, rot_euler=(-0.65, 0.0, 0.0), taper_top=0.4)
    # Conical amber-gold beak pointing forward (-Z)
    h_feathers.add_cylinder((0.0, 0.006, -0.015), (0.0, 0.005, -0.029), 0.0050, 0.0008, 8, UV_BEAK)
    # Glossy dark eyes
    for side in (-1.0, 1.0):
        h_feathers.add_ellipsoid((side * 0.012, 0.009, -0.008), (0.0032, 0.0032, 0.0032), 5, 8, UV_EYE)
        # Charming miniature brass tinkerer goggles perched on the bird's forehead!
        h_brass.add_cylinder((side * 0.008, 0.016, -0.011), (side * 0.009, 0.017, -0.015), 0.0055, 0.0055, 10, UV_BRASS)
        h_iron.add_cylinder((side * 0.008, 0.016, -0.012), (side * 0.009, 0.017, -0.0155), 0.0040, 0.0040, 8, UV_IRON)
    h_brass.add_box((0.0, 0.016, -0.013), (0.008, 0.0025, 0.0025), UV_BRASS)

    # Wing_L & Wing_R Child Node Meshes (pivots at [±0.017, +0.022, -0.004])
    def make_wing(is_left=True):
        sign = -1.0 if is_left else 1.0
        w_suffix = "L" if is_left else "R"
        w_mesh = MeshBuilder(f"{bird_name}_Wing_{w_suffix}_Mesh", 3)
        # Layered primary (Teal) and secondary (Ivory tip) wing feathers
        w_mesh.add_ellipsoid((sign * 0.004, -0.004, 0.008), (0.004, 0.011, 0.020), 6, 10, UV_TEAL, rot_euler=(0.15, sign * 0.12, sign * 0.15))
        w_mesh.add_ellipsoid((sign * 0.005, -0.007, 0.014), (0.003, 0.008, 0.016), 6, 8, UV_IVORY, rot_euler=(0.22, sign * 0.15, sign * 0.18))
        return [w_mesh]

    return {
        "body": [b_feathers, b_brass],
        "head": [h_feathers, h_brass, h_iron],
        "wing_l": make_wing(True),
        "wing_r": make_wing(False),
    }


# ---------------------------------------------------------------------------
# 4. SCENE GRAPH & ANIMATION CLIP BUILDER (IDLE, FIRE, RELOAD)
# ---------------------------------------------------------------------------

def build_scene_and_animations():
    nodes = []
    meshes = []

    def register_mesh_group(group_name, builder_list):
        primitives = []
        for b in builder_list:
            if not b.positions:
                continue
            primitives.append({
                "positions": np.array(b.positions, dtype=np.float32),
                "normals": np.array(b.normals, dtype=np.float32),
                "uvs": np.array(b.uvs, dtype=np.float32),
                "indices": np.array(b.indices, dtype=np.uint32),
                "material": b.material_idx,
            })
        mesh_idx = len(meshes)
        meshes.append({"name": group_name, "primitives": primitives})
        return mesh_idx

    def add_node(name, translation=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0, 1.0), scale=(1.0, 1.0, 1.0), mesh_idx=None, parent_idx=None):
        idx = len(nodes)
        node = {
            "name": name,
            "translation": [round(float(x), 6) for x in translation],
            "rotation": [round(float(x), 6) for x in rotation],
            "scale": [round(float(x), 6) for x in scale],
            "children": [],
        }
        if mesh_idx is not None:
            node["mesh"] = mesh_idx
        nodes.append(node)
        if parent_idx is not None:
            nodes[parent_idx]["children"].append(idx)
        return idx

    # Root Node
    root_idx = add_node("Siegebird_Root", (0.0, 0.0, 0.0))

    # 5 Required Empty Attachment Nodes (Y-up, -Z forward)
    add_node("GripMain",    (0.000, -0.075,  0.065), euler_to_quat(math.radians(-14.0), 0.0, 0.0), parent_idx=root_idx)
    add_node("GripSupport", (0.000, -0.042, -0.185), euler_to_quat(0.0, 0.0, 0.0), parent_idx=root_idx)
    add_node("Muzzle",      (0.000,  0.038, -0.420), euler_to_quat(0.0, 0.0, 0.0), parent_idx=root_idx)
    add_node("BoltRest",    (0.000,  0.038, -0.120), euler_to_quat(0.0, 0.0, 0.0), parent_idx=root_idx)
    add_node("Sight",       (0.000,  0.068,  0.085), euler_to_quat(0.0, 0.0, 0.0), parent_idx=root_idx)

    # Weapon Structural Nodes
    wf_mesh = register_mesh_group("WeaponFrame_Mesh", build_weapon_frame_meshes())
    add_node("WeaponFrame", (0.0, 0.0, 0.0), mesh_idx=wf_mesh, parent_idx=root_idx)

    br_mesh = register_mesh_group("BoltRail_Mesh", build_bolt_rail_meshes())
    add_node("BoltRail", (0.0, 0.0, 0.0), mesh_idx=br_mesh, parent_idx=root_idx)

    # Independently Named & Animatable Weapon Mechanism Nodes
    # Drawn rest state: limbs flexed back by 0.26 rad around Y, string drawn to Z = +0.045m
    rl_0, rr_0, sl_0, sr_0, sc_l0, sc_r0 = compute_limb_and_string_pose(0.26, 0.045)
    limb_l_mesh = register_mesh_group("ProdLimb_L_Mesh", build_prod_limb_meshes(True))
    limb_l_idx = add_node("ProdLimb_L", (-0.055, 0.036, -0.320), rl_0, mesh_idx=limb_l_mesh, parent_idx=root_idx)

    limb_r_mesh = register_mesh_group("ProdLimb_R_Mesh", build_prod_limb_meshes(False))
    limb_r_idx = add_node("ProdLimb_R", ( 0.055, 0.036, -0.320), rr_0, mesh_idx=limb_r_mesh, parent_idx=root_idx)

    # BowString assembly (drawn at Z = +0.045m in cocked state)
    bs_center_mesh = register_mesh_group("BowString_Mesh", build_bowstring_meshes())
    bs_idx = add_node("BowString", (0.0, 0.038, 0.045), mesh_idx=bs_center_mesh, parent_idx=root_idx)

    bs_l_mesh = register_mesh_group("BowString_L_Mesh", build_bowstring_half_mesh(True))
    bs_l_idx = add_node("BowString_L", (0.0, 0.0, 0.0), sl_0, scale=sc_l0, mesh_idx=bs_l_mesh, parent_idx=bs_idx)

    bs_r_mesh = register_mesh_group("BowString_R_Mesh", build_bowstring_half_mesh(False))
    bs_r_idx = add_node("BowString_R", (0.0, 0.0, 0.0), sr_0, scale=sc_r0, mesh_idx=bs_r_mesh, parent_idx=bs_idx)

    # Active Bolt at BoltRest (0.0, 0.038, -0.120)
    bolt_mesh = register_mesh_group("Bolt_Mesh", build_bolt_meshes())
    bolt_idx = add_node("Bolt", (0.0, 0.038, -0.120), mesh_idx=bolt_mesh, parent_idx=root_idx)

    # Moving Mechanism Parts
    mech = build_mechanism_meshes()
    trig_idx = add_node("Trigger", (0.0, -0.008, 0.030), mesh_idx=register_mesh_group("Trigger_Mesh", mech["Trigger"]), parent_idx=root_idx)
    catch_idx = add_node("StringCatch", (0.0, 0.030, 0.045), mesh_idx=register_mesh_group("StringCatch_Mesh", mech["StringCatch"]), parent_idx=root_idx)
    sled_idx = add_node("StringCarrierSled", (0.0, 0.036, 0.045), mesh_idx=register_mesh_group("StringCarrierSled_Mesh", mech["StringCarrierSled"]), parent_idx=root_idx)
    wheel_l_idx = add_node("RatchetWheel_L", (-0.048, 0.018, 0.065), mesh_idx=register_mesh_group("RatchetWheel_L_Mesh", mech["RatchetWheel_L"]), parent_idx=root_idx)
    wheel_r_idx = add_node("RatchetWheel_R", ( 0.048, 0.018, 0.065), mesh_idx=register_mesh_group("RatchetWheel_R_Mesh", mech["RatchetWheel_R"]), parent_idx=root_idx)
    lifter_idx = add_node("BoltLifterArms", (0.0, 0.008, -0.110), mesh_idx=register_mesh_group("BoltLifterArms_Mesh", mech["BoltLifterArms"]), parent_idx=root_idx)

    # 6 Independently Named & Animatable Birds
    bird_defs = [
        ("Bird_01_Spotter",     (-0.068, 0.042, -0.250), (0.0, -0.35, 0.0)),
        ("Bird_02_Hooker",      ( 0.068, 0.042, -0.250), (0.0,  0.35, 0.0)),
        ("Bird_03_WinchLeft",   (-0.064, 0.036,  0.065), (0.0, -0.45, 0.0)),
        ("Bird_04_WinchRight",  ( 0.064, 0.036,  0.065), (0.0,  0.45, 0.0)),
        ("Bird_05_LoaderLeft",  (-0.058, 0.004, -0.095), (0.0, -0.55, 0.0)),
        ("Bird_06_LoaderRight", ( 0.058, 0.004, -0.095), (0.0,  0.55, 0.0)),
    ]
    bird_nodes = {}
    for b_name, b_pos, b_rot in bird_defs:
        parts = build_charming_bird_parts(b_name)
        b_idx = add_node(b_name, b_pos, euler_to_quat(*b_rot), mesh_idx=register_mesh_group(f"{b_name}_Mesh", parts["body"]), parent_idx=root_idx)
        h_idx = add_node(f"{b_name}_Head", (0.0, 0.028, -0.012), mesh_idx=register_mesh_group(f"{b_name}_Head_Mesh", parts["head"]), parent_idx=b_idx)
        wl_idx = add_node(f"{b_name}_Wing_L", (-0.017, 0.022, -0.004), mesh_idx=register_mesh_group(f"{b_name}_Wing_L_Mesh", parts["wing_l"]), parent_idx=b_idx)
        wr_idx = add_node(f"{b_name}_Wing_R", ( 0.017, 0.022, -0.004), mesh_idx=register_mesh_group(f"{b_name}_Wing_R_Mesh", parts["wing_r"]), parent_idx=b_idx)
        bird_nodes[b_name] = {
            "root": b_idx,
            "head": h_idx,
            "wing_l": wl_idx,
            "wing_r": wr_idx,
            "base_pos": b_pos,
            "base_rot": b_rot,
        }

    # -----------------------------------------------------------------------
    # BUILD THE 3 ANIMATION CLIPS: Idle (2.4s), Fire (0.8s), Reload (3.2s)
    # -----------------------------------------------------------------------
    animations = []

    # --- CLIP 1: Idle (0.00s - 2.40s, looping) ---
    t_idle = np.linspace(0.0, 2.40, 37, dtype=np.float32)
    idle_channels = []
    for idx_b, (b_name, b_info) in enumerate(bird_nodes.items()):
        phase = idx_b * 1.05
        bx, by, bz = b_info["base_pos"]
        rx0, ry0, rz0 = b_info["base_rot"]
        pos_keys = []
        head_rot_keys = []
        wl_rot_keys = []
        wr_rot_keys = []
        for t in t_idle:
            omega = (t / 2.40) * 2.0 * math.pi
            bob = 0.0025 * math.sin(omega * 2.0 + phase)
            pos_keys.append([bx, by + bob, bz])
            # Curious head tilt & glance toward the bolt rail
            h_yaw = 0.18 * math.sin(omega + phase)
            h_pitch = 0.10 * math.cos(omega * 2.0 + phase)
            head_rot_keys.append(euler_to_quat(h_pitch, h_yaw, 0.08 * math.sin(omega + phase)))
            # Subtle wing flutter pulse
            flap = max(0.0, math.sin(omega * 3.0 + phase) - 0.55) * 0.85
            wl_rot_keys.append(euler_to_quat(0.0, 0.0, -flap))
            wr_rot_keys.append(euler_to_quat(0.0, 0.0,  flap))
        idle_channels.append((b_info["root"], "translation", t_idle, pos_keys))
        idle_channels.append((b_info["head"], "rotation", t_idle, head_rot_keys))
        idle_channels.append((b_info["wing_l"], "rotation", t_idle, wl_rot_keys))
        idle_channels.append((b_info["wing_r"], "rotation", t_idle, wr_rot_keys))
    animations.append({"name": "Idle", "channels": idle_channels})

    # --- CLIP 2: Fire (0.00s - 0.80s, one-shot) ---
    t_fire = np.array([0.00, 0.06, 0.10, 0.15, 0.22, 0.35, 0.55, 0.80], dtype=np.float32)
    fire_states = [
        ( 0.26,  0.045),
        ( 0.25,  0.042),
        ( 0.08, -0.140),
        (-0.04, -0.268),
        ( 0.02, -0.254),
        (-0.01, -0.262),
        ( 0.00, -0.260),
        ( 0.00, -0.260),
    ]
    fire_poses = [compute_limb_and_string_pose(f, z) for f, z in fire_states]
    fire_channels = [
        # Trigger squeeze & release
        (trig_idx, "rotation", t_fire, [
            euler_to_quat(0.00, 0, 0),
            euler_to_quat(0.38, 0, 0),
            euler_to_quat(0.42, 0, 0),
            euler_to_quat(0.35, 0, 0),
            euler_to_quat(0.18, 0, 0),
            euler_to_quat(0.04, 0, 0),
            euler_to_quat(0.00, 0, 0),
            euler_to_quat(0.00, 0, 0),
        ]),
        # StringCatch sear release drop
        (catch_idx, "rotation", t_fire, [
            euler_to_quat( 0.00, 0, 0),
            euler_to_quat(-0.55, 0, 0),
            euler_to_quat(-0.62, 0, 0),
            euler_to_quat(-0.55, 0, 0),
            euler_to_quat(-0.30, 0, 0),
            euler_to_quat(-0.10, 0, 0),
            euler_to_quat( 0.00, 0, 0),
            euler_to_quat( 0.00, 0, 0),
        ]),
        # ProdLimb_L, ProdLimb_R & BowString exact coupled kinematics during Fire
        *([
            (limb_l_idx, "rotation", t_fire, [p[0] for p in fire_poses]),
            (limb_r_idx, "rotation", t_fire, [p[1] for p in fire_poses]),
            (bs_idx, "translation", t_fire, [[0.0, 0.038, z] for _, z in fire_states]),
            (bs_l_idx, "rotation", t_fire, [p[2] for p in fire_poses]),
            (bs_r_idx, "rotation", t_fire, [p[3] for p in fire_poses]),
            (bs_l_idx, "scale", t_fire, [p[4] for p in fire_poses]),
            (bs_r_idx, "scale", t_fire, [p[5] for p in fire_poses]),
        ]),
        # Bolt launches along -Z through Muzzle
        (bolt_idx, "translation", t_fire, [
            [0.0, 0.038, -0.120],
            [0.0, 0.038, -0.125],
            [0.0, 0.038, -0.310],
            [0.0, 0.038, -0.520],
            [0.0, 0.038, -0.620],
            [0.0, 0.038, -0.620],
            [0.0, 0.038, -0.620],
            [0.0, 0.038, -0.620],
        ]),
        (bolt_idx, "scale", t_fire, [
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.01, 0.01, 0.01],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
        ]),
    ]
    # All 6 birds do a charming startled hop & wing flare on shot recoil
    for b_name, b_info in bird_nodes.items():
        bx, by, bz = b_info["base_pos"]
        fire_channels.append((b_info["root"], "translation", t_fire, [
            [bx, by, bz],
            [bx, by, bz],
            [bx, by + 0.014, bz + 0.004],
            [bx, by + 0.018, bz + 0.005],
            [bx, by + 0.008, bz + 0.002],
            [bx, by - 0.002, bz],
            [bx, by + 0.002, bz],
            [bx, by, bz],
        ]))
        fire_channels.append((b_info["wing_l"], "rotation", t_fire, [
            euler_to_quat(0, 0,  0.00),
            euler_to_quat(0, 0, -0.15),
            euler_to_quat(0, 0, -0.95),
            euler_to_quat(0, 0, -1.05),
            euler_to_quat(0, 0, -0.55),
            euler_to_quat(0, 0, -0.15),
            euler_to_quat(0, 0,  0.00),
            euler_to_quat(0, 0,  0.00),
        ]))
        fire_channels.append((b_info["wing_r"], "rotation", t_fire, [
            euler_to_quat(0, 0, 0.00),
            euler_to_quat(0, 0, 0.15),
            euler_to_quat(0, 0, 0.95),
            euler_to_quat(0, 0, 1.05),
            euler_to_quat(0, 0, 0.55),
            euler_to_quat(0, 0, 0.15),
            euler_to_quat(0, 0, 0.00),
            euler_to_quat(0, 0, 0.00),
        ]))
    animations.append({"name": "Fire", "channels": fire_channels})

    # --- CLIP 3: Reload (0.00s - 3.20s, 3-Phase Mechanical Bird-Assisted Choreography) ---
    # Keyframe timestamps (14 milestones across 3.20 seconds):
    t_rel = np.array([
        0.00, 0.25, 0.50, 0.75,   # Phase 1: Sled advances to Z=-0.26m; Bird_01 & Bird_02 hop in & hook string
        1.00, 1.35, 1.70, 2.00,   # Phase 2: Bird_03 & Bird_04 treadmill RatchetWheels; Sled & String draw to Z=+0.045m
        2.20, 2.45, 2.70, 2.95, 3.20  # Phase 3: Bird_05 & Bird_06 + BoltLifterArms lift fresh Bolt into BoltRest
    ], dtype=np.float32)

    rel_states = [
        (0.00, -0.260),
        (0.00, -0.260),
        (0.00, -0.260),
        (0.00, -0.260),
        (0.07, -0.185),
        (0.15, -0.095),
        (0.22, -0.015),
        (0.26,  0.045),
        (0.26,  0.045),
        (0.26,  0.045),
        (0.26,  0.045),
        (0.26,  0.045),
        (0.26,  0.045),
    ]
    rel_poses = [compute_limb_and_string_pose(f, z) for f, z in rel_states]

    reload_channels = [
        # StringCarrierSled slides forward (0.0-0.5s), hooks string, and draws back (0.75-2.0s)
        (sled_idx, "translation", t_rel, [
            [0.0, 0.036,  0.045],
            [0.0, 0.036, -0.110],
            [0.0, 0.036, -0.260],
            [0.0, 0.036, -0.260],
            [0.0, 0.036, -0.185],
            [0.0, 0.036, -0.095],
            [0.0, 0.036, -0.015],
            [0.0, 0.036,  0.045],
            [0.0, 0.036,  0.045],
            [0.0, 0.036,  0.045],
            [0.0, 0.036,  0.045],
            [0.0, 0.036,  0.045],
            [0.0, 0.036,  0.045],
        ]),
        # Coupled ProdLimb_L/R & BowString exact kinematics during Reload
        *([
            (limb_l_idx, "rotation", t_rel, [p[0] for p in rel_poses]),
            (limb_r_idx, "rotation", t_rel, [p[1] for p in rel_poses]),
            (bs_idx, "translation", t_rel, [[0.0, 0.038, z] for _, z in rel_states]),
            (bs_l_idx, "rotation", t_rel, [p[2] for p in rel_poses]),
            (bs_r_idx, "rotation", t_rel, [p[3] for p in rel_poses]),
            (bs_l_idx, "scale", t_rel, [p[4] for p in rel_poses]),
            (bs_r_idx, "scale", t_rel, [p[5] for p in rel_poses]),
        ]),
        # RatchetWheel_L & RatchetWheel_R spin during Phase 2 windlass draw (0.75s - 2.00s)
        (wheel_l_idx, "rotation", t_rel, [
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(1.5, 0, 0),
            euler_to_quat(3.1, 0, 0),
            euler_to_quat(4.7, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
        ]),
        (wheel_r_idx, "rotation", t_rel, [
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(1.5, 0, 0),
            euler_to_quat(3.1, 0, 0),
            euler_to_quat(4.7, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
            euler_to_quat(6.283, 0, 0),
        ]),
        # BoltLifterArms swing upward in Phase 3 (2.00s - 2.95s) to seat the fresh bolt
        (lifter_idx, "translation", t_rel, [
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.008, -0.110],
            [0.0, 0.022, -0.110],
            [0.0, 0.036, -0.110],
            [0.0, 0.032, -0.110],
            [0.0, 0.014, -0.110],
            [0.0, 0.008, -0.110],
        ]),
        # Fresh Bolt rises from side-quiver cradle into BoltRest groove during Phase 3 (2.00s - 2.70s)
        (bolt_idx, "translation", t_rel, [
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.012, -0.120],
            [0.0, -0.010, -0.120],
            [0.0,  0.018, -0.120],
            [0.0,  0.048, -0.120],
            [0.0,  0.038, -0.120],
            [0.0,  0.038, -0.120],
            [0.0,  0.038, -0.120],
        ]),
        (bolt_idx, "scale", t_rel, [
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [0.001, 0.001, 0.001],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
        ]),
    ]

    # Individual Bird Choreography during Reload (0.00s - 3.20s):
    # 1. Bird_01_Spotter & Bird_02_Hooker (Phase 1 active: 0.00s - 0.75s)
    for b_name, sign in [("Bird_01_Spotter", -1.0), ("Bird_02_Hooker", 1.0)]:
        b = bird_nodes[b_name]
        bx, by, bz = b["base_pos"]
        reload_channels.append((b["root"], "translation", t_rel, [
            [bx, by, bz],
            [sign * 0.042, by + 0.018, -0.255],
            [sign * 0.032, by + 0.004, -0.260],
            [bx, by + 0.010, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by + 0.006, bz],
            [bx, by, bz],
        ]))
        reload_channels.append((b["head"], "rotation", t_rel, [
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.35, 0, 0),
            euler_to_quat(0.55, 0, 0),
            euler_to_quat(-0.15, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.0, 0, 0),
            euler_to_quat(0.28, 0, 0),
            euler_to_quat(0.0, 0, 0),
        ]))

    # 2. Bird_03_WinchLeft & Bird_04_WinchRight (Phase 2 active: 0.75s - 2.00s)
    for b_name, sign in [("Bird_03_WinchLeft", -1.0), ("Bird_04_WinchRight", 1.0)]:
        b = bird_nodes[b_name]
        bx, by, bz = b["base_pos"]
        reload_channels.append((b["root"], "translation", t_rel, [
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [sign * 0.050, by + 0.014, bz],
            [sign * 0.048, by + 0.022, bz - 0.004],
            [sign * 0.048, by + 0.016, bz + 0.004],
            [sign * 0.048, by + 0.022, bz - 0.004],
            [bx, by + 0.008, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by + 0.006, bz],
            [bx, by, bz],
        ]))
        reload_channels.append((b["wing_l"], "rotation", t_rel, [
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, -0.4),
            euler_to_quat(0, 0, -0.95),
            euler_to_quat(0, 0, -0.25),
            euler_to_quat(0, 0, -0.95),
            euler_to_quat(0, 0, -0.20),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, -0.35),
            euler_to_quat(0, 0, 0.0),
        ]))
        reload_channels.append((b["wing_r"], "rotation", t_rel, [
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.4),
            euler_to_quat(0, 0, 0.95),
            euler_to_quat(0, 0, 0.25),
            euler_to_quat(0, 0, 0.95),
            euler_to_quat(0, 0, 0.20),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.35),
            euler_to_quat(0, 0, 0.0),
        ]))

    # 3. Bird_05_LoaderLeft (front bolt shaft) & Bird_06_LoaderRight (rear bolt fletching) (Phase 3 active: 2.00s - 3.20s)
    for b_name, sign, z_work in [("Bird_05_LoaderLeft", -1.0, -0.145), ("Bird_06_LoaderRight", 1.0, -0.055)]:
        b = bird_nodes[b_name]
        bx, by, bz = b["base_pos"]
        reload_channels.append((b["root"], "translation", t_rel, [
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [bx, by, bz],
            [sign * 0.044, by - 0.012, z_work],
            [sign * 0.032, by + 0.022, z_work],
            [sign * 0.026, by + 0.044, z_work],
            [sign * 0.034, by + 0.032, z_work],
            [bx, by + 0.008, bz],
            [bx, by, bz],
        ]))
        reload_channels.append((b["wing_l"], "rotation", t_rel, [
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, -0.55),
            euler_to_quat(0, 0, -1.05),
            euler_to_quat(0, 0, -0.95),
            euler_to_quat(0, 0, -0.45),
            euler_to_quat(0, 0, -0.25),
            euler_to_quat(0, 0, 0.0),
        ]))
        reload_channels.append((b["wing_r"], "rotation", t_rel, [
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.0),
            euler_to_quat(0, 0, 0.55),
            euler_to_quat(0, 0, 1.05),
            euler_to_quat(0, 0, 0.95),
            euler_to_quat(0, 0, 0.45),
            euler_to_quat(0, 0, 0.25),
            euler_to_quat(0, 0, 0.0),
        ]))

    animations.append({"name": "Reload", "channels": reload_channels})
    return nodes, meshes, animations


# ---------------------------------------------------------------------------
# 5. BINARY GLTF 2.0 (.GLB) SERIALIZER & EXPORTER
# ---------------------------------------------------------------------------

def export_glb(output_path, nodes, meshes, animations, tex_bytes_tuple):
    bin_Buffer = bytearray()
    buffer_views = []
    accessors = []

    def append_to_bin(raw_bytes, target=None):
        # Pad to 4-byte boundary before and after
        while len(bin_Buffer) % 4 != 0:
            bin_Buffer.append(0)
        offset = len(bin_Buffer)
        bin_Buffer.extend(raw_bytes)
        length = len(raw_bytes)
        while len(bin_Buffer) % 4 != 0:
            bin_Buffer.append(0)
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": length}
        if target is not None:
            bv["target"] = target
        bv_idx = len(buffer_views)
        buffer_views.append(bv)
        return bv_idx

    def add_accessor(arr, component_type, acc_type, target=None, include_minmax=True):
        bv_idx = append_to_bin(arr.tobytes(), target=target)
        acc = {
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": component_type,
            "count": int(arr.shape[0]),
            "type": acc_type,
        }
        if include_minmax:
            if acc_type == "SCALAR":
                acc["min"] = [float(np.min(arr))] if arr.dtype == np.float32 else [int(np.min(arr))]
                acc["max"] = [float(np.max(arr))] if arr.dtype == np.float32 else [int(np.max(arr))]
            else:
                acc["min"] = [float(x) for x in np.min(arr, axis=0)]
                acc["max"] = [float(x) for x in np.max(arr, axis=0)]
        acc_idx = len(accessors)
        accessors.append(acc)
        return acc_idx

    # 1. Embed 3 PBR PNG Textures in BufferViews
    base_bytes, orm_bytes, norm_bytes = tex_bytes_tuple
    bv_base = append_to_bin(base_bytes)
    bv_orm  = append_to_bin(orm_bytes)
    bv_norm = append_to_bin(norm_bytes)

    images = [
        {"name": "Flockwright_BaseColor", "bufferView": bv_base, "mimeType": "image/jpeg"},
        {"name": "Flockwright_ORM",       "bufferView": bv_orm,  "mimeType": "image/jpeg"},
        {"name": "Flockwright_Normal",    "bufferView": bv_norm, "mimeType": "image/jpeg"},
    ]
    samplers = [
        {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
    ]
    textures = [
        {"name": "Tex_BaseColor", "source": 0, "sampler": 0},
        {"name": "Tex_ORM",       "source": 1, "sampler": 0},
        {"name": "Tex_Normal",    "source": 2, "sampler": 0},
    ]

    # 4 Shared PBR Materials referencing the embedded textures
    materials = [
        {
            "name": "Mat_WarmHardwood",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicRoughnessTexture": {"index": 1},
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 1.0,
                "roughnessFactor": 1.0,
            },
            "normalTexture": {"index": 2, "scale": 1.0},
            "occlusionTexture": {"index": 1, "strength": 1.0},
            "doubleSided": False,
        },
        {
            "name": "Mat_ForgedIron",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicRoughnessTexture": {"index": 1},
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 1.0,
                "roughnessFactor": 1.0,
            },
            "normalTexture": {"index": 2, "scale": 1.0},
            "occlusionTexture": {"index": 1, "strength": 1.0},
            "doubleSided": False,
        },
        {
            "name": "Mat_RestrainedBrass",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicRoughnessTexture": {"index": 1},
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 1.0,
                "roughnessFactor": 1.0,
            },
            "normalTexture": {"index": 2, "scale": 0.85},
            "occlusionTexture": {"index": 1, "strength": 1.0},
            "doubleSided": False,
        },
        {
            "name": "Mat_FeathersAndCord",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicRoughnessTexture": {"index": 1},
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 1.0,
                "roughnessFactor": 1.0,
            },
            "normalTexture": {"index": 2, "scale": 1.0},
            "occlusionTexture": {"index": 1, "strength": 1.0},
            "doubleSided": True,
        },
    ]

    # 2. Pack All Meshes & Primitives
    gltf_meshes = []
    total_verts = 0
    total_tris = 0
    for m in meshes:
        gltf_prims = []
        for p in m["primitives"]:
            pos_acc = add_accessor(p["positions"], 5126, "VEC3", target=34962, include_minmax=True)
            norm_acc = add_accessor(p["normals"], 5126, "VEC3", target=34962, include_minmax=False)
            uv_acc = add_accessor(p["uvs"], 5126, "VEC2", target=34962, include_minmax=False)
            idx_arr = p["indices"].astype(np.uint16) if len(p["positions"]) < 65535 else p["indices"].astype(np.uint32)
            idx_comp = 5123 if idx_arr.dtype == np.uint16 else 5125
            idx_acc = add_accessor(idx_arr, idx_comp, "SCALAR", target=34963, include_minmax=True)

            total_verts += len(p["positions"])
            total_tris += len(p["indices"]) // 3
            gltf_prims.append({
                "attributes": {
                    "POSITION": pos_acc,
                    "NORMAL": norm_acc,
                    "TEXCOORD_0": uv_acc,
                },
                "indices": idx_acc,
                "material": p["material"],
                "mode": 4,
            })
        gltf_meshes.append({"name": m["name"], "primitives": gltf_prims})

    # 3. Pack Animation Clips
    gltf_animations = []
    for anim in animations:
        anim_samplers = []
        anim_channels = []
        time_cache = {}
        for node_idx, path, times_arr, values_list in anim["channels"]:
            t_key = tuple(times_arr.tolist())
            if t_key not in time_cache:
                time_cache[t_key] = add_accessor(times_arr.astype(np.float32), 5126, "SCALAR", include_minmax=True)
            in_acc = time_cache[t_key]

            val_arr = np.array(values_list, dtype=np.float32)
            out_type = "VEC4" if path == "rotation" else "VEC3"
            out_acc = add_accessor(val_arr, 5126, out_type, include_minmax=False)

            s_idx = len(anim_samplers)
            anim_samplers.append({
                "input": in_acc,
                "interpolation": "LINEAR",
                "output": out_acc,
            })
            anim_channels.append({
                "sampler": s_idx,
                "target": {"node": node_idx, "path": path},
            })
        gltf_animations.append({
            "name": anim["name"],
            "samplers": anim_samplers,
            "channels": anim_channels,
        })

    # Clean empty children arrays
    clean_nodes = []
    for n in nodes:
        cn = dict(n)
        if not cn["children"]:
            del cn["children"]
        clean_nodes.append(cn)

    gltf_dict = {
        "asset": {
            "version": "2.0",
            "generator": "BrannsForge Siegebird Procedural Builder v1.0",
            "copyright": "2026 Brann's Forge — Game-Ready Handheld Crossbow Asset",
        },
        "scene": 0,
        "scenes": [{"name": "Siegebird_Scene", "nodes": [0]}],
        "nodes": clean_nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "textures": textures,
        "images": images,
        "samplers": samplers,
        "animations": gltf_animations,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_Buffer)}],
    }

    json_bytes = json.dumps(gltf_dict, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_Buffer)
    with open(output_path, "wb") as f:
        # 12-byte GLB header: magic 'glTF' (0x46546C67), version 2, total_length
        f.write(struct.pack("<III", 0x46546C67, 2, total_length))
        # JSON chunk header: length, type 'JSON' (0x4E4F534A)
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        # BIN chunk header: length, type 'BIN\0' (0x004E4942)
        f.write(struct.pack("<II", len(bin_Buffer), 0x004E4942))
        f.write(bin_Buffer)

    print(f"Exported genuine binary glTF 2.0: {output_path}")
    print(f"  Total File Size : {total_length:,} bytes ({total_length / (1024*1024):.2f} MB)")
    print(f"  Nodes           : {len(clean_nodes)} (including 5 empty attachment sockets)")
    print(f"  Meshes          : {len(gltf_meshes)}")
    print(f"  Materials       : {len(materials)} PBR materials")
    print(f"  Textures        : {len(textures)} embedded JPEG textures")
    print(f"  Vertices        : {total_verts:,}")
    print(f"  Triangles       : {total_tris:,}")
    print(f"  Animations      : {[a['name'] for a in gltf_animations]}")
    return gltf_dict, total_verts, total_tris, total_length


if __name__ == "__main__":
    # Brann's Forge: writes out/flockwright.glb beside this script. TEX_RES (default 1024) sizes the atlas; the swatches
    # are low-frequency, so 1024 reads the same in game as the original 2048 at a fraction of the download.
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "out")
    os.makedirs(out_dir, exist_ok=True)
    res = int(os.environ.get("TEX_RES", "1024"))
    tex_bytes, tex_imgs = generate_pbr_textures(res)
    nodes, meshes, animations = build_scene_and_animations()
    glb_path = os.path.join(out_dir, "flockwright.glb")
    export_glb(glb_path, nodes, meshes, animations, tex_bytes)
