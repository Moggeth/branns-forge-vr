"""PNG helpers with no PIL: read the review PNGs, tile them into one contact sheet, label-free.

python3.11 make_sheet.py -- --src DIR --out FILE.png [--cols 3] [--cell 420]
Also:  python3.11 make_sheet.py -- --atlas FILE.png      (dumps the builder's texture atlas)
"""
import sys, os, zlib, struct
import numpy as np

def read_png(path):
    d = open(path, "rb").read(); assert d[:8] == b"\x89PNG\r\n\x1a\n"
    i = 8; w = h = None; bitd = ct = None; idat = b""; plte = None
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]; typ = d[i + 4:i + 8]; chunk = d[i + 8:i + 8 + ln]; i += 12 + ln
        if typ == b"IHDR": w, h, bitd, ct = (*struct.unpack(">IIBB", chunk[:10]),)
        elif typ == b"IDAT": idat += chunk
        elif typ == b"PLTE": plte = np.frombuffer(chunk, np.uint8).reshape(-1, 3)
        elif typ == b"IEND": break
    assert bitd == 8, f"{path}: only 8-bit PNGs"
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat); stride = w * nch
    out = np.zeros((h, stride), np.uint8); prev = np.zeros(stride, np.uint8); p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = np.frombuffer(raw[p:p + stride], np.uint8).astype(np.int32).copy(); p += stride
        pv = prev.astype(np.int32)
        if f == 1:
            for x in range(nch, stride): line[x] = (line[x] + line[x - nch]) & 255
        elif f == 2:
            line = (line + pv) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + pv[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                c = pv[x - nch] if x >= nch else 0
                b = pv[x]; pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        prev = line.astype(np.uint8); out[y] = prev
    img = out.reshape(h, w, nch)
    if ct == 3: img = plte[img[..., 0]]
    if nch == 1: img = np.repeat(img, 3, axis=2)
    if nch == 2: img = np.repeat(img[..., :1], 3, axis=2)
    return img[..., :3]

def write_png(path, rgb):
    h, w = rgb.shape[:2]
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))
    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)

def resize(img, nw, nh):
    h, w = img.shape[:2]
    yi = (np.arange(nh) * h // nh).clip(0, h - 1); xi = (np.arange(nw) * w // nw).clip(0, w - 1)
    return img[yi][:, xi]

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    def arg(k, d=None): return argv[argv.index(k) + 1] if k in argv else d
    SRC = arg("--src"); DST = arg("--out"); CELL = int(arg("--cell", "420")); COLS = int(arg("--cols", "3"))
    order = (arg("--order") or "threequarter,side,front,beat-up,beat-down,top,rear,insky,insky-far").split(",")
    files = [os.path.join(SRC, f"{arg('--prefix', 'phoenix')}-{n}.png") for n in order]
    files = [f for f in files if os.path.exists(f)]
    imgs = [resize(read_png(f), CELL, CELL) for f in files]
    rows = (len(imgs) + COLS - 1) // COLS
    pad = 6
    sheet = np.full((rows * (CELL + pad) + pad, COLS * (CELL + pad) + pad, 3), 22, np.uint8)
    for k, im in enumerate(imgs):
        r, c = divmod(k, COLS)
        sheet[pad + r * (CELL + pad):pad + r * (CELL + pad) + CELL, pad + c * (CELL + pad):pad + c * (CELL + pad) + CELL] = im
    write_png(DST, sheet)
    print("WROTE", DST, sheet.shape, "from", [os.path.basename(f) for f in files])
