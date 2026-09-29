#!/usr/bin/env python3
"""Validate authored zone placement manifests and their GLBs before Godot import."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import sys
import time
from pathlib import Path

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:  # Structural checks still work without Pillow.
    Image = None
    UnidentifiedImageError = OSError


def number(value: object, positive: bool = False) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and (not positive or value > 0))


def vec3(value: object, positive: bool = False) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(number(v, positive) for v in value)


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("truncated GLB header")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("invalid GLB magic, version, or length")
    chunks = []
    offset = 12
    while offset < length:
        if offset + 8 > length:
            raise ValueError("truncated GLB chunk header")
        size, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        if size % 4 or offset + size > length:
            raise ValueError("invalid GLB chunk length")
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != b"JSON" or len(chunks) > 2:
        raise ValueError("missing or misplaced GLB JSON chunk")
    if len(chunks) == 2 and chunks[1][0] != b"BIN\0":
        raise ValueError("invalid GLB binary chunk")
    try:
        doc = json.loads(chunks[0][1].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid glTF JSON: {exc}") from exc
    if not isinstance(doc, dict) or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("glTF asset.version must be 2.0")
    return doc, chunks[1][1] if len(chunks) == 2 else b""


def winding_sample(primitive: dict, accessors: list, views: list, binary: bytes) -> tuple[int, int]:
    """Count sampled triangles whose winding opposes their exported normals."""
    attrs = primitive["attributes"]
    position_id, normal_id = attrs.get("POSITION"), attrs.get("NORMAL")
    if primitive.get("mode", 4) != 4 or not isinstance(position_id, int) or not isinstance(normal_id, int):
        return 0, 0
    if not 0 <= position_id < len(accessors) or not 0 <= normal_id < len(accessors):
        return 0, 0
    positions, normals = accessors[position_id], accessors[normal_id]
    if (positions.get("componentType") != 5126 or positions.get("type") != "VEC3"
            or normals.get("componentType") != 5126 or normals.get("type") != "VEC3"):
        return 0, 0
    indexed = "indices" in primitive
    indices = accessors[primitive["indices"]] if indexed else positions
    index_formats = {5121: "B", 5123: "H", 5125: "I"}
    if indexed and (indices.get("componentType") not in index_formats or indices.get("type") != "SCALAR"):
        return 0, 0

    def read(acc: dict, item: int, width: int, fmt: str) -> tuple:
        view = views[acc["bufferView"]]
        stride = view.get("byteStride", struct.calcsize("<" + fmt * width))
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0) + item * stride
        return struct.unpack_from("<" + fmt * width, binary, offset)

    def vertex(index: int, acc: dict) -> tuple[float, float, float]:
        return read(acc, index, 3, "f")

    count = indices.get("count", 0) // 3
    if count == 0:
        return 0, 0
    tested = 0
    opposed = 0
    for triangle in range(0, count, max(1, count // 80)):
        if indexed:
            fmt = index_formats[indices["componentType"]]
            a, b, c = (read(indices, triangle * 3 + corner, 1, fmt)[0] for corner in range(3))
        else:
            a, b, c = triangle * 3, triangle * 3 + 1, triangle * 3 + 2
        if max(a, b, c) >= min(positions["count"], normals["count"]):
            continue
        p0, p1, p2 = (vertex(i, positions) for i in (a, b, c))
        n0, n1, n2 = (vertex(i, normals) for i in (a, b, c))
        ux, uy, uz = (p1[j] - p0[j] for j in range(3))
        vx, vy, vz = (p2[j] - p0[j] for j in range(3))
        cross = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        dot = sum(cross[j] * (n0[j] + n1[j] + n2[j]) for j in range(3))
        if abs(dot) < 1e-8:
            continue
        tested += 1
        opposed += dot < 0
    return opposed, tested


def glb_summary(path: Path, errors: list[str], warnings: list[str]) -> dict:
    doc, binary = read_glb(path)
    label = path.name
    arrays = {}
    for key in ("meshes", "materials", "textures", "images", "accessors", "bufferViews", "buffers"):
        arrays[key] = doc.get(key, [])
        if not isinstance(arrays[key], list):
            raise ValueError(f"glTF {key} must be an array")
    views = arrays["bufferViews"]
    buffers = arrays["buffers"]
    for i, buffer in enumerate(buffers):
        if not isinstance(buffer, dict) or not isinstance(buffer.get("byteLength"), int) or buffer["byteLength"] < 0:
            errors.append(f"{label}: invalid buffer {i}")
        elif "uri" in buffer:
            errors.append(f"{label}: external buffer {i} is unsupported in a GLB")
        elif buffer["byteLength"] > len(binary):
            errors.append(f"{label}: buffer {i} exceeds BIN chunk")
    for i, view in enumerate(views):
        if not isinstance(view, dict):
            errors.append(f"{label}: invalid bufferView {i}")
            continue
        index, offset, size = view.get("buffer"), view.get("byteOffset", 0), view.get("byteLength")
        if (not isinstance(index, int) or index < 0 or index >= len(buffers)
                or not isinstance(offset, int) or offset < 0 or not isinstance(size, int) or size < 0
                or offset + size > len(binary)):
            errors.append(f"{label}: bufferView {i} exceeds BIN chunk")
    accessors = arrays["accessors"]
    for i, acc in enumerate(accessors):
        if not isinstance(acc, dict) or not isinstance(acc.get("count"), int) or acc["count"] < 0:
            errors.append(f"{label}: invalid accessor {i}")
        elif "bufferView" in acc and (not isinstance(acc["bufferView"], int) or not 0 <= acc["bufferView"] < len(views)):
            errors.append(f"{label}: invalid accessor bufferView {i}")
    triangles = 0
    primitives = 0
    nonwhite_vertex_color = False
    for mesh in arrays["meshes"]:
        if not isinstance(mesh, dict) or not isinstance(mesh.get("primitives"), list):
            errors.append(f"{label}: invalid mesh")
            continue
        for primitive in mesh["primitives"]:
            if not isinstance(primitive, dict) or not isinstance(primitive.get("attributes"), dict):
                errors.append(f"{label}: invalid mesh primitive")
                continue
            pos = primitive["attributes"].get("POSITION")
            color_id = primitive["attributes"].get("COLOR_0")
            if isinstance(color_id, int) and 0 <= color_id < len(accessors):
                color = accessors[color_id]
                view_id = color.get("bufferView")
                components = {5121: ("B", 1, 255.0), 5123: ("H", 2, 65535.0), 5126: ("f", 4, 1.0)}
                if (color.get("type") in ("VEC3", "VEC4") and color.get("componentType") in components
                        and isinstance(view_id, int) and 0 <= view_id < len(views)):
                    fmt, width, maximum = components[color["componentType"]]
                    view = views[view_id]
                    channels = 3 if color["type"] == "VEC3" else 4
                    stride = view.get("byteStride", channels * width)
                    origin = view.get("byteOffset", 0) + color.get("byteOffset", 0)
                    for vertex in range(0, color.get("count", 0), max(1, color.get("count", 0) // 32)):
                        offset = origin + vertex * stride
                        if offset + channels * width > len(binary):
                            break
                        sample = struct.unpack_from("<" + fmt * channels, binary, offset)
                        if any(channel < maximum * 0.98 for channel in sample[:3]):
                            nonwhite_vertex_color = True
                            break
            index = primitive.get("indices", pos)
            material = primitive.get("material")
            if (not isinstance(pos, int) or not 0 <= pos < len(accessors)
                    or not isinstance(index, int) or not 0 <= index < len(accessors)
                    or material is not None and (not isinstance(material, int) or not 0 <= material < len(arrays["materials"]))):
                errors.append(f"{label}: primitive has invalid accessor or material reference")
                continue
            mode = primitive.get("mode", 4)
            count = accessors[index].get("count", 0)
            if mode == 4:
                if count % 3:
                    errors.append(f"{label}: triangle index count is not divisible by 3")
                triangles += count // 3
            elif mode in (5, 6):
                triangles += max(0, count - 2)
            else:
                warnings.append(f"{label}: primitive mode {mode} is excluded from triangle count")
            if mode == 4:
                opposed, tested = winding_sample(primitive, accessors, views, binary)
                if tested >= 8 and opposed / tested > 0.90:
                    errors.append(f"{label}: {opposed}/{tested} sampled triangles have winding opposite to normals")
            primitives += 1
    if primitives == 0:
        errors.append(f"{label}: no mesh primitives")
    base_images = set()
    image_sizes: dict[str, int] = {}
    image_bytes_total = 0
    for i, material in enumerate(arrays["materials"]):
        if not isinstance(material, dict):
            errors.append(f"{label}: invalid material {i}")
            continue
        pbr = material.get("pbrMetallicRoughness", {})
        if not isinstance(pbr, dict):
            errors.append(f"{label}: invalid material PBR {i}")
            continue
        texture_ref = pbr.get("baseColorTexture")
        if texture_ref is None:
            continue
        index = texture_ref.get("index") if isinstance(texture_ref, dict) else None
        if not isinstance(index, int) or not 0 <= index < len(arrays["textures"]):
            errors.append(f"{label}: invalid base-color texture reference in material {i}")
            continue
        texture = arrays["textures"][index]
        source = texture.get("source") if isinstance(texture, dict) else None
        if not isinstance(source, int) or not 0 <= source < len(arrays["images"]):
            errors.append(f"{label}: invalid base-color image reference in material {i}")
            continue
        base_images.add(source)
    for i, image in enumerate(arrays["images"]):
        if not isinstance(image, dict) or "uri" in image:
            errors.append(f"{label}: image {i} is not embedded")
            continue
        view_index = image.get("bufferView")
        if not isinstance(view_index, int) or not 0 <= view_index < len(views):
            errors.append(f"{label}: invalid embedded image {i}")
            continue
        if image.get("mimeType") not in ("image/png", "image/jpeg", "image/webp"):
            errors.append(f"{label}: unsupported image MIME type {i}")
        view = views[view_index]
        if not isinstance(view, dict) or not isinstance(view.get("byteLength"), int):
            continue
        start = view.get("byteOffset", 0)
        image_bytes = binary[start:start + view["byteLength"]]
        if len(image_bytes) != view["byteLength"]:
            errors.append(f"{label}: truncated embedded image {i}")
            continue
        image_sizes[hashlib.sha256(image_bytes).hexdigest()] = len(image_bytes)
        image_bytes_total += len(image_bytes)
        if i in base_images and Image is not None:
            try:
                with Image.open(io.BytesIO(image_bytes)) as opened:
                    rgb = opened.convert("RGB")
                    if not rgb.getbbox():
                        errors.append(f"{label}: all-black base-color image {i}")
            except (OSError, ValueError, UnidentifiedImageError) as exc:
                errors.append(f"{label}: unreadable base-color image {i}: {exc}")
    if base_images and Image is None:
        errors.append("Pillow is required to inspect base-color pixels; install Pillow and retry")
    return {"triangles": triangles, "primitives": primitives, "materials": len(arrays["materials"]),
            "embedded_images": len(arrays["images"]), "base_color_images": len(base_images),
            "embedded_image_bytes": image_bytes_total, "image_sizes": image_sizes,
            "nonwhite_vertex_color": nonwhite_vertex_color}


def validate(path: Path) -> dict:
    start = time.perf_counter()
    errors: list[str] = []
    warnings: list[str] = []
    result = {"manifest": str(path), "ok": False, "assets": 0, "placements": 0,
              "triangles_unique": 0, "triangles_instanced": 0, "primitives": 0,
              "materials": 0, "embedded_images": 0, "embedded_image_bytes": 0,
              "unique_image_bytes": 0, "errors": errors, "warnings": warnings}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            raise ValueError("manifest must be an object")
        if type(doc.get("schema")) is not int or doc["schema"] != 1:
            errors.append("schema must be 1")
        assets = doc.get("assets")
        placements = doc.get("placements")
        meta = doc.get("asset_meta", {})
        if not isinstance(assets, dict) or not assets:
            errors.append("assets must be a nonempty object")
            assets = {}
        if not isinstance(placements, list) or len(placements) > 2000:
            errors.append("placements must be an array with at most 2000 entries")
            placements = []
        if not isinstance(meta, dict):
            errors.append("asset_meta must be an object")
            meta = {}
        result["assets"] = len(assets)
        result["placements"] = len(placements)
        counts: dict[str, int] = {}
        unique_images: dict[str, int] = {}
        for i, entry in enumerate(placements):
            if not isinstance(entry, dict):
                errors.append(f"placement {i}: must be an object")
                continue
            asset = entry.get("asset")
            if not isinstance(asset, str) or asset not in assets:
                errors.append(f"placement {i}: unknown asset {asset!r}")
            else:
                counts[asset] = counts.get(asset, 0) + 1
            if not vec3(entry.get("position")):
                errors.append(f"placement {i}: position must contain three finite numbers")
            scale = entry.get("scale", 1)
            if not ((number(scale, positive=True) and scale <= 8)
                    or (vec3(scale, positive=True) and all(component <= 8 for component in scale))):
                errors.append(f"placement {i}: scale must be a number or vec3 in (0, 8]")
            if not number(entry.get("yaw_degrees", 0)):
                errors.append(f"placement {i}: yaw_degrees must be finite")
            if entry.get("collision", "none") not in ("none", "asset_default"):
                errors.append(f"placement {i}: unsupported collision mode")
            if entry.get("collision") == "asset_default":
                spec = meta.get(asset, {}).get("collision") if isinstance(meta.get(asset), dict) else None
                if not spec:
                    errors.append(f"placement {i}: asset_default needs asset_meta collision")
        for asset, value in meta.items():
            if asset not in assets or not isinstance(value, dict):
                errors.append(f"asset_meta {asset}: unknown asset or non-object")
                continue
            specs = value.get("collision", [])
            if isinstance(specs, dict):
                specs = [specs]
            if not isinstance(specs, list):
                errors.append(f"asset_meta {asset}: collision must be an array or object")
                continue
            for i, spec in enumerate(specs):
                label = f"asset_meta {asset} collision {i}"
                if not isinstance(spec, dict):
                    errors.append(f"{label}: must be an object")
                elif spec.get("shape") == "box":
                    if not vec3(spec.get("size"), positive=True):
                        errors.append(f"{label}: box size must be positive vec3")
                elif spec.get("shape") == "cylinder":
                    if not number(spec.get("radius"), True) or not number(spec.get("height"), True):
                        errors.append(f"{label}: cylinder radius and height must be positive")
                else:
                    errors.append(f"{label}: unsupported shape")
                if isinstance(spec, dict) and not vec3(spec.get("offset", [0, 0, 0])):
                    errors.append(f"{label}: offset must be finite vec3")
        for asset, filename in assets.items():
            if not isinstance(asset, str) or not asset:
                errors.append("asset identifiers must be nonempty strings")
                continue
            if (not isinstance(filename, str) or not filename or Path(filename).name != filename
                    or "/" in filename or "\\" in filename or Path(filename).suffix.lower() != ".glb"):
                errors.append(f"asset {asset}: expected local .glb filename")
                continue
            glb_path = path.parent / filename
            if not glb_path.is_file():
                errors.append(f"asset {asset}: missing GLB {filename}")
                continue
            try:
                summary = glb_summary(glb_path, errors, warnings)
            except (OSError, ValueError, TypeError, KeyError, IndexError, struct.error) as exc:
                errors.append(f"asset {asset}: malformed GLB {filename}: {exc}")
                continue
            if doc.get("vertex_color_multiply") and not summary["nonwhite_vertex_color"]:
                errors.append(f"asset {asset}: vertex-color mode needs nonwhite COLOR_0")
            result["triangles_unique"] += summary["triangles"]
            result["triangles_instanced"] += summary["triangles"] * counts.get(asset, 0)
            for key in ("primitives", "materials", "embedded_images"):
                result[key] += summary[key]
            result["embedded_image_bytes"] += summary["embedded_image_bytes"]
            unique_images.update(summary["image_sizes"])
        result["unique_image_bytes"] = sum(unique_images.values())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        errors.append(f"manifest unreadable: {exc}")
    result["ok"] = not errors
    result["seconds"] = round(time.perf_counter() - start, 3)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifests", nargs="+", type=Path, help="placement.json paths")
    args = parser.parse_args()
    results = [validate(path) for path in args.manifests]
    print(json.dumps({"ok": all(item["ok"] for item in results), "results": results}, separators=(",", ":")))
    return 0 if all(item["ok"] for item in results) else 1


if __name__ == "__main__":
    sys.exit(main())
