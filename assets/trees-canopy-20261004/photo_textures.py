# Photo textures from Mitch's walk (2026-10-04): crops of his own photos become tileable game textures.
# Sources in photo/ are tight crops (no street, cars or people). Run with any Python that has Pillow + numpy:
#   python photo_textures.py            -> photo/*.jpg game textures, read by build_trees.py and the client
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); P = os.path.join(HERE, 'photo')

def load(name, size):
    return np.asarray(Image.open(os.path.join(P, name)).convert('RGB').resize(size, Image.LANCZOS), np.float32) / 255

def flatten_light(a, radius):
    """Divide out the slow light falloff across a round trunk so the tile has even exposure, keep the mean colour."""
    img = Image.fromarray((a * 255).astype(np.uint8)); blur = np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255
    lum = blur.mean(axis=2, keepdims=True); return np.clip(a / np.maximum(lum, .03) * lum.mean(), 0, 1)

def seamless(a, axis, n):
    """Wrap an image of n + margin pixels into an n-pixel tile: the margin past the far edge cross-fades over the near
    edge, so the tile continues straight into itself without a seam and without repeating any feature."""
    m = a.shape[axis] - n; t = np.clip(np.arange(m) / max(1, m - 1), 0, 1); t = t * t * (3 - 2 * t)
    a = np.moveaxis(a, axis, 0); out = a[:n].copy(); far = a[n:n + m]
    w = t.reshape(-1, *([1] * (a.ndim - 1)))
    blend = far * (1 - w) + out[:m] * w
    k = 1 / np.sqrt(np.maximum(w ** 2 + (1 - w) ** 2, .5)); mean = out.mean(axis=(0, 1), keepdims=True)
    out[:m] = np.clip(mean + (blend - mean) * k, 0, 1)  # keep contrast through the blend strip
    return np.moveaxis(out, 0, axis)

def tile(name, out, size, radius, tint=(1, 1, 1), gain=1.0):
    m = size[0] // 5; a = flatten_light(load(name, (size[0] + m, size[1] + m)), radius)
    a = seamless(seamless(a, 1, size[0]), 0, size[1])
    a = np.clip(a * np.array(tint, np.float32) * gain, 0, 1)
    img = Image.fromarray((a * 255 + .5).astype(np.uint8))
    img.save(os.path.join(P, out + '.jpg'), quality=86, optimize=True)
    img.resize((size[0] // 2, size[1] // 2), Image.LANCZOS).save(os.path.join(P, out + '_half.jpg'), quality=84, optimize=True)
    print(out, size, os.path.getsize(os.path.join(P, out + '.jpg')) // 1024, 'KB')

def save_rgba(arr, out):
    """256-colour palette PNG with alpha: a third of the size of full RGBA, indistinguishable on foliage cutouts."""
    img = Image.fromarray((arr * 255 + .5).astype(np.uint8), 'RGBA').quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(os.path.join(P, out + '.png'), optimize=True)

def ivy(out='ivy', n=512):
    """Ivy from the fence photo: a seamless leaf mat whose alpha keeps the lit leaf faces and drops the dark gaps, so
    where the mesh fades out at a ragged edge it breaks along real leaf outlines."""
    m = n // 5; a = load('ivy_source.jpg', (n + m, n + m)); a = seamless(seamless(a, 1, n), 0, n)
    img = Image.fromarray((a * 255).astype(np.uint8)); lum = a.mean(axis=2)
    local = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(n / 40)), np.float32) / 255
    leaf = np.clip((lum - local * .82) / .12, 0, 1)                      # brighter than the shadowed gaps around it
    green = np.clip((a[..., 1] - a[..., 2]) / .08, 0, 1)                    # leaves are green/yellow, gaps and fence grey
    alpha = np.clip(leaf * .7 + green * .5, 0, 1) ** .8
    rgba = np.concatenate([a, alpha[..., None]], -1)
    save_rgba(rgba, out)
    print(out, os.path.getsize(os.path.join(P, out + '.png')) // 1024, 'KB')

def daisies(out='daisies', cell=128, cols=4, rows=2):
    """Lawn daisy heads cut out of the daisy photo: yellow centres are found, each head is masked by its white petals
    and packed into a cols x rows sprite sheet (RGBA, transparent background)."""
    src = np.asarray(Image.open(os.path.join(P, 'daisy_source.jpg')).convert('RGB'), np.float32) / 255
    r, g, b = src[..., 0], src[..., 1], src[..., 2]; mx, mn = src.max(2), src.min(2)
    yellow = (r > .7) & (g > .5) & (b < .35) & (r - b > .45)
    white = (mn > .62) & (mx - mn < .22)
    # connected yellow blobs -> head centres (simple flood fill, the photo has a handful of heads)
    seen = np.zeros_like(yellow); heads = []; H, W = yellow.shape
    ys, xs = np.nonzero(yellow)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]: continue
        stack = [(y0, x0)]; seen[y0, x0] = True; pts = []
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and yellow[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; stack.append((yy, xx))
        if len(pts) < 300: continue
        p = np.array(pts); cy, cx = p.mean(0); rc = np.sqrt(len(pts) / np.pi)
        # petal radius: how far white extends around the centre
        yy, xx = np.mgrid[max(0, int(cy - rc * 5)):min(H, int(cy + rc * 5)), max(0, int(cx - rc * 5)):min(W, int(cx + rc * 5))]
        d = np.hypot(yy - cy, xx - cx); wmask = white[yy, xx]
        if wmask.sum() < len(pts): continue  # a closed bud: no white petals
        rp = np.percentile(d[wmask], 92)
        if rp < 2.4 * rc or (wmask & (d < rp)).sum() < 4 * len(pts): continue  # half-open bud or a stray yellow fleck
        heads.append((len(pts), cy, cx, rc, rp))
    heads.sort(reverse=True); heads = heads[:cols * rows]
    heads += heads[:cols * rows - len(heads)]  # fill the sheet; repeats are mirrored below
    sheet = np.zeros((rows * cell, cols * cell, 4), np.float32)
    for k, (_, cy, cx, rc, rp) in enumerate(heads):
        R = rp * 1.08; box = (int(cx - R), int(cy - R), int(cx + R), int(cy + R))
        crop = Image.fromarray((src * 255).astype(np.uint8)).crop(box).resize((cell, cell), Image.LANCZOS)
        if k >= len(set(h[1] for h in heads[:k])) and any(h[1] == cy for h in heads[:k]): crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
        c = np.asarray(crop, np.float32) / 255; cr, cg, cb = c[..., 0], c[..., 1], c[..., 2]; cmx, cmn = c.max(2), c.min(2)
        yy, xx = np.mgrid[0:cell, 0:cell]; d = np.hypot(yy - cell / 2 + .5, xx - cell / 2 + .5) / (cell / 2)
        petal = np.clip((cmn - .5) / .14, 0, 1) * np.clip((.3 - (cmx - cmn)) / .1, 0, 1)
        centre = np.clip((d * (R / rc) < 1.25) * 1.0, 0, 1)
        a = np.maximum(petal, centre) * np.clip((1.02 - d) / .06, 0, 1)
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.8)), np.float32) / 255
        col = np.where(a[..., None] > .02, c, np.array([.92, .92, .86]))  # bleed petal white into the transparent margin
        y0, x0 = (k // cols) * cell, (k % cols) * cell
        sheet[y0:y0 + cell, x0:x0 + cell] = np.concatenate([col, a[..., None]], -1)
    save_rgba(sheet, out)
    print(out, len(heads), 'heads', os.path.getsize(os.path.join(P, out + '.png')) // 1024, 'KB')

if __name__ == '__main__':
    tile('oak_bark_source.jpg', 'oak_bark', (1024, 1024), 90, gain=.94)  # rough grey-brown furrowed plates, moss flecks
    ivy(); daisies()
