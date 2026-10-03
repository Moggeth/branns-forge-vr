"""Assemble the captured firing sequence into an animated preview.

    python tools/assemble.py <capture dir> <out.gif> [width]

Reads <capture dir>/seq_fire/{machine,flight,wide,reload}_NNN.png (from
tools/capture.mjs fire) and writes one looping GIF plus a WebP alongside it.
Needs Pillow only.
"""
import glob
import sys
from pathlib import Path

from PIL import Image, ImageDraw

src = Path(sys.argv[1]) / 'seq_fire'
out = Path(sys.argv[2])
width = int(sys.argv[3]) if len(sys.argv) > 3 else 640

# (pass, frame stride, ms per frame, caption)
PASSES = [
    ('machine', 2, 50, 'Release: synchronized strings, recoil (4x slow)'),
    ('flight', 2, 50, 'Vanes flick open, pair spreads, filament snaps taut, cut (slow)'),
    ('wide', 2, 33, 'Real time: tree felled'),
    ('reload', 3, 100, 'Reload: claws run forward, windlass cocks both sides (real time)'),
]

frames, durations = [], []
for name, stride, ms, caption in PASSES:
    files = sorted(glob.glob(str(src / f'{name}_*.png')))[::stride]
    for f in files:
        im = Image.open(f).convert('RGB')
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.rectangle([0, im.height - 22, im.width, im.height], fill=(20, 18, 16))
        d.text((8, im.height - 17), caption, fill=(236, 226, 210))
        frames.append(im)
        durations.append(ms)
    durations[-1] += 500

pal = [f.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
pal[0].save(out, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True, disposal=1)
frames[0].save(out.with_suffix('.webp'), save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=70, method=4)
print(out, len(frames), 'frames', out.stat().st_size, 'bytes;', out.with_suffix('.webp').stat().st_size, 'bytes webp')
