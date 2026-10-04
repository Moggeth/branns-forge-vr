"""Siegebird browser crossbow material pass over the Opus Kingfisher GLB (geometry and nodes untouched).

v1 (2026-10-03): the two wood textures regenerated in correct sRGB.
v2 (2026-10-04): figured walnut with an oiled clearcoat and pore normals; brushed, tarnished brass and bronze
(shared wear albedo + roughness/metal maps); blued steel with temper-colour iridescence; waxed-linen cord sheen;
polished horn. Only materials, textures, images and image buffer views change.

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


def fbm(size, seed, octaves=5, base=4, aniso=(1.0, 1.0)):
    """Tileable value-noise fBm in [0,1] (bilinear lattice, wrapped). aniso stretches features along U or V."""
    rng = np.random.default_rng(seed); out = np.zeros((size, size)); amp = 1.0; total = 0.0
    for o in range(octaves):
        fu, fv = max(1, int(base * 2 ** o * aniso[0])), max(1, int(base * 2 ** o * aniso[1]))
        lat = rng.random((fv, fu))
        y = np.linspace(0, fv, size, endpoint=False); x = np.linspace(0, fu, size, endpoint=False)
        y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int); ty = (y - y0)[:, None]; tx = (x - x0)[None, :]
        ty = ty * ty * (3 - 2 * ty); tx = tx * tx * (3 - 2 * tx)
        a = lat[y0 % fv][:, x0 % fu]; b = lat[y0 % fv][:, (x0 + 1) % fu]; c = lat[(y0 + 1) % fv][:, x0 % fu]; d = lat[(y0 + 1) % fv][:, (x0 + 1) % fu]
        out += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty); total += amp; amp *= 0.5
    return out / total


def walnut_v2(size, light, dark, seed):
    """Figured walnut: fine straight fibres along U, broad heartwood streaks, soft cross figure and open pores.
    Returns (albedo Image, pore mask array) - the mask also drives the pore normal map."""
    u = np.linspace(0, 1, size, endpoint=False)[None, :]; v = np.linspace(0, 1, size, endpoint=False)[:, None]
    warp = (fbm(size, seed + 1, 4, 2) - .5) * .05
    V = v + warp
    rng = np.random.default_rng(seed)
    lines = np.zeros((size, size))
    for k, amp in ((58, .5), (131, .3), (263, .2)):          # fine growth lines (all integer -> tileable)
        lines += amp * (0.5 + 0.5 * np.sin(np.pi * 2 * (k * V + rng.uniform(0, 1))))
    fib = fbm(size, seed + 2, 5, 3, aniso=(.12, 2.5))          # long fibres stretched along U
    streak = fbm(size, seed + 3, 3, 2, aniso=(.35, 1.4))       # broad dark/light heartwood streaks
    figure = 0.5 + 0.5 * np.sin(np.pi * 2 * (7 * u + 2 * V) + 6 * fbm(size, seed + 4, 3, 2))
    t = .48 + .16 * (lines - .5) + .22 * (fib - .5) + .34 * (streak - .5) + .05 * (figure - .5)
    t = np.clip(t, 0, 1)
    col = hex_rgb(dark)[None, None, :] + (hex_rgb(light) - hex_rgb(dark))[None, None, :] * t[..., None]
    pore_rng = np.random.default_rng(seed + 5)
    pores = pore_rng.random((size, size)) < .0045
    pores = pores | np.roll(pores, 1, axis=1) | np.roll(pores, 2, axis=1) | np.roll(pores, 3, axis=1)
    col[pores] *= .58
    return Image.fromarray(np.clip(col * 255 + .5, 0, 255).astype(np.uint8), 'RGB'), pores.astype(float)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * .5; dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * .5
    n = np.dstack([-dx * strength, dy * strength, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(np.clip((n * .5 + .5) * 255 + .5, 0, 255).astype(np.uint8), 'RGB')


def metal_wear(size, seed):
    """Shared metal wear set: albedo multiplier (tarnish mottle + fine brushing) and glTF metallicRoughness
    (G roughness, B metalness). Factors per material set the colour and the roughness scale."""
    brush = fbm(size, seed, 6, 4, aniso=(.06, 6.0))            # fine directional brushing along U
    mottle = fbm(size, seed + 1, 4, 3)
    tarnish = np.clip((mottle - .52) * 3.2, 0, 1) ** 1.5
    lum = np.clip(.93 + .09 * (brush - .5) - .2 * tarnish, 0, 1)
    tint = np.dstack([lum, lum * (1 - .05 * tarnish), lum * (1 - .14 * tarnish)])
    rough = np.clip(.62 + .5 * (brush - .5) + .55 * tarnish, 0, 1)   # multiplied by each material's roughnessFactor
    mr = np.dstack([np.ones_like(rough), rough, np.ones_like(rough)])
    to = lambda a: Image.fromarray(np.clip(a * 255 + .5, 0, 255).astype(np.uint8), 'RGB')
    return to(tint), to(mr)


def png(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True); return b.getvalue()


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


def add_image(gltf, name, mime, data, new_views):
    gltf['images'].append({'name': name, 'mimeType': mime, 'bufferView': len(gltf['bufferViews']) + len(new_views)})
    new_views.append(data)
    gltf['textures'].append({'sampler': 0, 'source': len(gltf['images']) - 1})
    return len(gltf['textures']) - 1


def main():
    gltf, binary = read_glb(SRC)
    before = json.loads(json.dumps(gltf))
    views = gltf['bufferViews']
    walnut, pores = walnut_v2(1024, '6a4630', '2a170c', 7)
    replace = {
        'SB_WalnutGrain': jpeg(walnut, 86),
        'SB_HeartwoodGrain': jpeg(wood_image(512, '8a4a26', '4a2210', 18, 11, figure=0.03, pores=0.004), 86),
    }
    image_views = {img['name']: img['bufferView'] for img in gltf['images']}
    assert set(replace) <= set(image_views), image_views
    # v2 additions: walnut pore normals and the shared metal wear set (appended as new images / views).
    new_views = []
    tint, mr = metal_wear(512, 21)
    tex = {'walnut_normal': add_image(gltf, 'SB_WalnutPores', 'image/jpeg', jpeg(normal_from_height(pores * -1.0 + fbm(1024, 9, 3, 6) * .3, 2.2), 90), new_views),
           'metal_tint': add_image(gltf, 'SB_MetalWearTint', 'image/jpeg', jpeg(tint, 88), new_views),
           'metal_mr': add_image(gltf, 'SB_MetalWearMR', 'image/jpeg', jpeg(mr, 90), new_views)}
    mats = {m['name']: m for m in gltf['materials']}
    ext = set(gltf.get('extensionsUsed', []))
    w = mats['SB_Walnut']; w['normalTexture'] = {'index': tex['walnut_normal'], 'scale': .6}
    w['pbrMetallicRoughness']['roughnessFactor'] = .52
    w.setdefault('extensions', {})['KHR_materials_clearcoat'] = {'clearcoatFactor': .42, 'clearcoatRoughnessFactor': .22}   # hand-rubbed oil
    h = mats['SB_Heartwood']; h.setdefault('extensions', {})['KHR_materials_clearcoat'] = {'clearcoatFactor': .5, 'clearcoatRoughnessFactor': .18}
    for name, colour, rough in (('SB_Brass', [.80, .52, .16, 1], .34), ('SB_Bronze', [.42, .2, .085, 1], .5)):
        m = mats[name]; pbr = m['pbrMetallicRoughness']
        pbr['baseColorFactor'] = colour; pbr['baseColorTexture'] = {'index': tex['metal_tint']}
        pbr['metallicRoughnessTexture'] = {'index': tex['metal_mr']}; pbr['metallicFactor'] = 1.0; pbr['roughnessFactor'] = rough
    st = mats['SB_Steel']; pbr = st['pbrMetallicRoughness']    # rust-blued steel with temper colours
    pbr['baseColorFactor'] = [.055, .075, .13, 1]; pbr['metallicFactor'] = 1.0; pbr['roughnessFactor'] = .42
    pbr['metallicRoughnessTexture'] = {'index': tex['metal_mr']}
    st.setdefault('extensions', {})['KHR_materials_iridescence'] = {'iridescenceFactor': .65, 'iridescenceIor': 1.8,
        'iridescenceThicknessMinimum': 260, 'iridescenceThicknessMaximum': 420}
    cord = mats['SB_Cord']; cord['pbrMetallicRoughness']['baseColorFactor'] = [.62, .5, .3, 1]; cord['pbrMetallicRoughness']['roughnessFactor'] = .6
    cord.setdefault('extensions', {})['KHR_materials_sheen'] = {'sheenColorFactor': [.55, .5, .4], 'sheenRoughnessFactor': .45}   # waxed linen
    horn = mats['SB_Horn']; horn.setdefault('extensions', {})['KHR_materials_clearcoat'] = {'clearcoatFactor': .7, 'clearcoatRoughnessFactor': .1}
    lea = mats['SB_Leather']; lea['pbrMetallicRoughness']['roughnessFactor'] = .5
    lea.setdefault('extensions', {})['KHR_materials_sheen'] = {'sheenColorFactor': [.18, .09, .07], 'sheenRoughnessFactor': .6}
    ext |= {'KHR_materials_clearcoat', 'KHR_materials_iridescence', 'KHR_materials_sheen'}
    gltf['extensionsUsed'] = sorted(ext)

    new_bin = bytearray(); report = {}
    for i, view in enumerate(views[:len(before['bufferViews'])]):
        start = view.get('byteOffset', 0); chunk = binary[start:start + view['byteLength']]
        name = next((n for n, vi in image_views.items() if vi == i and n in replace), None)
        if name:
            report[name] = {'old_bytes': len(chunk), 'new_bytes': len(replace[name]),
                            'new_mean_srgb': [round(x) for x in np.asarray(Image.open(io.BytesIO(replace[name])).convert('RGB')).reshape(-1, 3).mean(0)]}
            chunk = replace[name]
        new_bin += b'\x00' * (-len(new_bin) % 4)
        view['byteOffset'] = len(new_bin); view['byteLength'] = len(chunk); new_bin += chunk
    for data in new_views:
        new_bin += b'\x00' * (-len(new_bin) % 4)
        views.append({'buffer': 0, 'byteOffset': len(new_bin), 'byteLength': len(data)}); new_bin += data
    gltf['buffers'][0]['byteLength'] = len(new_bin) + (-len(new_bin) % 4)
    # Contract: geometry, nodes, animations and every non-image buffer view are unchanged.
    for key in before:
        if key not in ('bufferViews', 'buffers', 'materials', 'images', 'textures', 'extensionsUsed'):
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
