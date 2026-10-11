"""Deterministic production GLB cost inventory. Run from any directory.

python scripts/graphics_asset_audit.py --output logs/graphics-assets.json
Requires Pillow; outputs estimates, never claims measured GPU residency.
"""
import argparse
import hashlib
import io
import json
import struct
import time
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def inspect(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    if magic != 0x46546C67 or version != 2 or length != len(raw):
        raise ValueError(f'{path.name}: invalid GLB header')
    chunks, offset = {}, 12
    while offset < length:
        size, kind = struct.unpack_from('<II', raw, offset)
        if offset + 8 + size > length:
            raise ValueError(f'{path.name}: truncated GLB chunk')
        chunks[kind] = raw[offset + 8:offset + 8 + size]
        offset += 8 + size
    doc = json.loads(chunks[0x4E4F534A])
    images = []
    for i, image in enumerate(doc.get('images', [])):
        if 'bufferView' in image:
            view = doc['bufferViews'][image['bufferView']]
            if view.get('buffer', 0) != 0:
                raise ValueError(f'{path.name}: external buffer unsupported')
            start = view.get('byteOffset', 0)
            payload = chunks[0x004E4942][start:start + view['byteLength']]
        else:
            relative = image.get('uri', '')
            image_path = (path.parent / relative).resolve()
            if not relative or not image_path.is_relative_to(path.parent.resolve()):
                raise ValueError(f'{path.name}: nonlocal image URI')
            payload = image_path.read_bytes()
        with Image.open(io.BytesIO(payload)) as im:
            width, height = im.size
        images.append({'index': i, 'width': width, 'height': height,
                       'encodedBytes': len(payload),
                       'rgbaMipBytesEstimate': round(width * height * 4 * 4 / 3),
                       'sha256': hashlib.sha256(payload).hexdigest()})
    primitives = [p for mesh in doc.get('meshes', []) for p in mesh['primitives']]
    triangles = 0
    for p in primitives:
        count = doc['accessors'][p.get('indices', p['attributes']['POSITION'])]['count']
        mode = p.get('mode', 4)
        triangles += count // 3 if mode == 4 else max(0, count - 2) if mode in (5, 6) else 0
    return {'id': path.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'downloadBytes': len(raw), 'meshTriangles': triangles,
            'primitives': len(primitives), 'materials': len(doc.get('materials', [])),
            'skins': len(doc.get('skins', [])), 'animations': len(doc.get('animations', [])),
            'images': images}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output', type=Path, default=ROOT / 'logs/graphics-assets.json')
    args = ap.parse_args()
    start = time.perf_counter()
    assets = [inspect(p) for p in sorted((ROOT / 'multiplayer/public/assets').glob('*.glb'))]
    # Shared images count once across assets. A texture may still be uploaded more
    # than once by the runtime: this is a source budget, not a residency profiler.
    images = {i['sha256']: i for a in assets for i in a['images']}
    summary = {'assets': len(assets), 'downloadBytes': sum(a['downloadBytes'] for a in assets),
               'uniqueImages': len(images),
               'rgbaMipBytesEstimate': sum(i['rgbaMipBytesEstimate'] for i in images.values()),
               'over1024': [a['id'] for a in assets if any(max(i['width'], i['height']) > 1024 for i in a['images'])]}
    report = {'schema': 1, 'scope': 'top-level production GLBs; all LOD meshes counted; no procedural geometry',
              'summary': summary, 'assets': assets}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'summary': summary, 'seconds': round(time.perf_counter() - start, 3), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
