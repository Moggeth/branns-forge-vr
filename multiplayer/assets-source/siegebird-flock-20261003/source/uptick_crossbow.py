"""Siegebird browser crossbow uptick: rewrite only the two wood textures of the Opus Kingfisher GLB.

Run:  <python with numpy + pillow> uptick_crossbow.py [source.glb] [out.glb]
Default: assets/siegebird-opus/siegebird-opus.glb -> multiplayer/public/assets/crossbow.glb

Why: the Opus builder's wood_image() blends colours that srgb() has already converted to LINEAR, then stores
them in an sRGB-tagged image. The colours are gamma-darkened twice, so the walnut body averages sRGB
(13, 4, 2) and renders nearly black in game. This regenerates the same procedural grain (same seeds, same
maths) with the authored sRGB colours, a touch of figure and pores, and swaps the two JPEGs in place.

Everything else is asserted byte-identical: nodes, meshes, accessors, materials, samplers, the enamel images
and every non-wood buffer view. The Godot copy (godot/assets/siegebird/siegebird.glb) is untouched.
"""
import hashlib, io, json, math, os, struct, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))  # repository root
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'siegebird-opus', 'siegebird-opus.glb')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'multiplayer', 'public', 'assets', 'crossbow.glb')
TAU = math.tau


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def wood_image(size, light, dark, rings, seed, figure=0.0, pores=0.0):
    """The Opus builder's grain (identical RNG draws), blended in sRGB as authored."""
    rng = np.random.default_rng(seed)
    u = np.linspace(0, 1, size, endpoint=False)[None, :]; v = np.linspace(0, 1, size, endpoint=False)[:, None]
    warp = np.zeros((size, size))
    for _ in range(6):
        fu, fv = int(rng.integers(1, 4)), int(rng.integers(1, 5)); ph = rng.uniform(0, TAU)
        warp += rng.uniform(0.004, 0.018) * np.sin(TAU * (fu * u + fv * v) + ph)
    V = v + warp
    g = 0.5 + 0.5 * np.sin(TAU * (rings * V + 0.35 * np.sin(TAU * (2 * u + 3 * V))))
    g = g ** 2.2
    streak = rng.normal(0, 1, (size, size))
    kern = np.ones(41) / 41
    streak = np.apply_along_axis(lambda r: np.convolve(np.concatenate([r[-20:], r, r[:20]]), kern, 'valid'), 1, streak)
    # Uptick blend: the authored rings at a gentler contrast, plus long fibres (vary across V only) so the
    # wood reads as straight-grained walnut rather than bold stripes once its colours are no longer crushed.
    extra = np.random.default_rng(seed + 1000)
    fib = extra.normal(0, 1, (size, 1)); fib = (fib - np.convolve(fib[:, 0], np.ones(9) / 9, 'same')[:, None]) * 0.5
    t = np.clip(0.34 * g + 0.16 * streak * 3 + 0.07 * fib + 0.33, 0, 1)
    # Soft cross-grain figure (chatoyance bands) and fine open pores, both tileable.
    if figure:
        ph = extra.uniform(0, TAU)
        t = np.clip(t + figure * np.sin(TAU * (9 * u + 2 * V) + ph) * (0.5 + 0.5 * np.sin(TAU * 3 * V)), 0, 1)
    col = hex_rgb(dark)[None, None, :] + (hex_rgb(light) - hex_rgb(dark))[None, None, :] * t[..., None]
    if pores:
        p = extra.random((size, size)) < pores
        p = p | np.roll(p, 1, axis=1) | np.roll(p, 2, axis=1)      # short pores drawn along the grain (U)
        col[p] *= 0.62
    return Image.fromarray(np.clip(col * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB')


def jpeg(img, quality=90):
    b = io.BytesIO(); img.save(b, 'JPEG', quality=quality, optimize=True, progressive=False, subsampling=0); return b.getvalue()


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF' and version == 2 and length == len(data)
    jlen, jtype = struct.unpack_from('<I4s', data, 12); assert jtype == b'JSON'
    gltf = json.loads(data[20:20 + jlen])
    blen, btype = struct.unpack_from('<I4s', data, 20 + jlen); assert btype == b'BIN\x00'
    return gltf, data[28 + jlen:28 + jlen + blen]


def write_glb(path, gltf, binary):
    j = json.dumps(gltf, separators=(',', ':')).encode()
    j += b' ' * (-len(j) % 4); binary += b'\x00' * (-len(binary) % 4)
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(j) + 8 + len(binary)) + struct.pack('<I4s', len(j), b'JSON') + j + struct.pack('<I4s', len(binary), b'BIN\x00') + binary
    os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'wb').write(out)
    return out


def main():
    gltf, binary = read_glb(SRC)
    before = json.loads(json.dumps(gltf))
    views = gltf['bufferViews']
    # Same seeds/rings as build_siegebird_opus.py make_materials(); colours as authored there (sRGB), walnut a shade richer.
    replace = {
        'SB_WalnutGrain': jpeg(wood_image(1024, '64402a', '2a170c', 26, 7, figure=0.04, pores=0.006), 86),
        'SB_HeartwoodGrain': jpeg(wood_image(512, '8a4a26', '4a2210', 18, 11, figure=0.03, pores=0.004), 86),
    }
    image_views = {img['name']: img['bufferView'] for img in gltf['images']}
    assert set(replace) <= set(image_views), image_views
    new_bin = bytearray(); report = {}
    for i, view in enumerate(views):
        start = view.get('byteOffset', 0); chunk = binary[start:start + view['byteLength']]
        name = next((n for n, vi in image_views.items() if vi == i and n in replace), None)
        if name:
            report[name] = {'old_bytes': len(chunk), 'new_bytes': len(replace[name]),
                            'old_mean_srgb': [round(x) for x in np.asarray(Image.open(io.BytesIO(chunk)).convert('RGB')).reshape(-1, 3).mean(0)],
                            'new_mean_srgb': [round(x) for x in np.asarray(Image.open(io.BytesIO(replace[name])).convert('RGB')).reshape(-1, 3).mean(0)]}
            chunk = replace[name]
        new_bin += b'\x00' * (-len(new_bin) % 4)
        view['byteOffset'] = len(new_bin); view['byteLength'] = len(chunk); new_bin += chunk
    gltf['buffers'][0]['byteLength'] = len(new_bin) + (-len(new_bin) % 4)
    # Contract: only the two wood image views changed.
    for key in before:
        if key not in ('bufferViews', 'buffers'):
            assert gltf[key] == before[key], f'{key} changed'
    changed = {image_views[n] for n in replace}
    for i, (a, b) in enumerate(zip(before['bufferViews'], gltf['bufferViews'])):
        if i not in changed:
            assert binary[a.get('byteOffset', 0):a.get('byteOffset', 0) + a['byteLength']] == new_bin[b['byteOffset']:b['byteOffset'] + b['byteLength']], f'view {i} changed'
    out = write_glb(OUT, gltf, bytes(new_bin))
    report['source_sha256'] = hashlib.sha256(open(SRC, 'rb').read()).hexdigest()
    report['out_sha256'] = hashlib.sha256(out).hexdigest(); report['out_bytes'] = len(out)
    print('UPTICK_REPORT ' + json.dumps(report))


main()
