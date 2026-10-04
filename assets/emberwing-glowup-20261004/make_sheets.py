"""Compose review sheets from render_review.py PNGs (bpy image IO + numpy; no PIL).
python3.11 make_sheets.py -- --src RENDER_DIR --out SHEET_DIR"""
import bpy, sys, os
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
SRC = os.path.abspath(argv[argv.index("--src") + 1]); OUT = os.path.abspath(argv[argv.index("--out") + 1]); os.makedirs(OUT, exist_ok=True)

FONT = {  # 5x7 bitmap glyphs (rows top->bottom)
 'A': ["01110","10001","10001","11111","10001","10001","10001"], 'B': ["11110","10001","11110","10001","10001","10001","11110"],
 'C': ["01111","10000","10000","10000","10000","10000","01111"], 'D': ["11110","10001","10001","10001","10001","10001","11110"],
 'E': ["11111","10000","11110","10000","10000","10000","11111"], 'F': ["11111","10000","11110","10000","10000","10000","10000"],
 'G': ["01111","10000","10000","10111","10001","10001","01111"], 'H': ["10001","10001","11111","10001","10001","10001","10001"],
 'I': ["11111","00100","00100","00100","00100","00100","11111"], 'K': ["10001","10010","11100","10010","10001","10001","10001"],
 'L': ["10000","10000","10000","10000","10000","10000","11111"], 'M': ["10001","11011","10101","10001","10001","10001","10001"],
 'N': ["10001","11001","10101","10011","10001","10001","10001"], 'O': ["01110","10001","10001","10001","10001","10001","01110"],
 'P': ["11110","10001","11110","10000","10000","10000","10000"], 'Q': ["01110","10001","10001","10001","10101","10010","01101"], 'R': ["11110","10001","11110","10100","10010","10001","10001"],
 'S': ["01111","10000","01110","00001","00001","00001","11110"], 'T': ["11111","00100","00100","00100","00100","00100","00100"],
 'U': ["10001","10001","10001","10001","10001","10001","01110"], 'V': ["10001","10001","10001","10001","01010","01010","00100"],
 'W': ["10001","10001","10001","10101","10101","11011","10001"], 'X': ["10001","01010","00100","00100","01010","10001","10001"],
 'Y': ["10001","01010","00100","00100","00100","00100","00100"], 'Z': ["11111","00010","00100","01000","10000","10000","11111"],
 '0': ["01110","10011","10101","11001","10001","10001","01110"], '1': ["00100","01100","00100","00100","00100","00100","01110"],
 '2': ["01110","10001","00010","00100","01000","10000","11111"], '3': ["11110","00001","01110","00001","00001","00001","11110"],
 '_': ["00000","00000","00000","00000","00000","00000","11111"], '-': ["00000","00000","00000","11111","00000","00000","00000"],
 '/': ["00001","00010","00010","00100","01000","01000","10000"], '+': ["00000","00100","00100","11111","00100","00100","00000"],
 ' ': ["00000"] * 7, '(': ["00010","00100","01000","01000","01000","00100","00010"], ')': ["01000","00100","00010","00010","00010","00100","01000"],
 '.': ["00000","00000","00000","00000","00000","00000","00100"], ',': ["00000","00000","00000","00000","00000","00100","01000"],
}
def label(img, text, x, y, scale=3, col=(1.0, 0.85, 0.55)):
    """Draw text into img (H, W, 4 float, row 0 = TOP) at top-left (x, y)."""
    cx = x
    for ch in text.upper():
        g = FONT.get(ch, FONT[' '])
        for r, row in enumerate(g):
            for c, bit in enumerate(row):
                if bit == '1':
                    img[y + r * scale:y + (r + 1) * scale, cx + c * scale:cx + (c + 1) * scale, :3] = col
        cx += 6 * scale

def load(name):
    p = os.path.join(SRC, name + ".png"); im = bpy.data.images.load(p)
    w, h = im.size; a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()   # row 0 = top
    bpy.data.images.remove(im); return a

def save(arr, name):
    h, w = arr.shape[:2]; im = bpy.data.images.new(name, w, h, alpha=False)
    im.pixels.foreach_set(arr[::-1].ravel()); im.filepath_raw = os.path.join(OUT, name + ".png"); im.file_format = "PNG"; im.save()
    print("sheet", im.filepath_raw, w, h)

BG = np.array((0.09, 0.09, 0.10, 1.0), np.float32)
def grid(rows, pad=12, head=46):
    """rows: list of (list of (image, caption))."""
    hs = [max(im.shape[0] for im, _ in r) for r in rows]; ws = [sum(im.shape[1] for im, _ in r) + pad * (len(r) + 1) for r in rows]
    H = sum(hs) + (pad + head) * len(rows) + pad; W = max(ws)
    out = np.tile(BG, (H, W, 1)); y = pad
    for r, h in zip(rows, hs):
        x = pad
        for im, cap in r:
            label(out, cap[: max(1, im.shape[1] // 18 - 1)], x + 4, y + 12, 3)
            out[y + head:y + head + im.shape[0], x:x + im.shape[1]] = im; x += im.shape[1] + pad
        y += h + head + pad
    return out

def scale_half(a):  # 2x2 box downsample
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2; a = a[:h, :w]
    return a.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3))

save(grid([[(load("before-threequarter"), "before - three-quarter"), (load("after-threequarter"), "after - three-quarter")],
           [(load("before-front"), "before - archer side"), (load("after-front"), "after - archer side")],
           [(load("before-player"), "before - first person"), (load("after-player"), "after - first person")]]), "bow-before-after")
save(grid([[(load("before-head"), "before - phoenix head"), (load("after-head"), "after - beak ridge, ember tear, torc")],
           [(load("after-limb"), "after - gold inlay, ember veins"), (load("after-nock"), "after - sinew-wrapped string nock")]]), "bow-details")
save(grid([[(load("arrow-lineup"), "left to right: head_0 x fletch_0-3, head_1 x fletch_0-3, head_2 x fletch_0-3")],
           [(scale_half(load("arrow-heads")), "head_0  head_1  head_2"), (scale_half(load("arrow-heads-side")), "heads in profile")]]), "arrow-variants")
save(grid([[(load("arrow-fletches"), "fletch_0 flame / fletch_1 barred / fletch_2 long gold / fletch_3 sapphire tip")],
           [(load("arrow-embedded-close"), "whipping, ember runes, crest"), (load("arrow-nock"), "phoenix nock with ember ring")],
           [(load("arrow-embedded"), "embedded at 0.4 m"), (load("oldarrow-side"), "before - original arrow")]]), "arrow-closeups")
