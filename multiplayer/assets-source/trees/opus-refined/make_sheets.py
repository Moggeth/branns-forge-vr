"""Compose review sheets from real Cycles renders. python make_sheets.py  (run from this folder)"""
import os
from PIL import Image, ImageDraw

def label(im, text):
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 8 + 7 * len(text), 18), fill=(0, 0, 0)); d.text((4, 3), text, fill=(255, 255, 255)); return im

def grid(cells, cols, size, path):
    rows = (len(cells) + cols - 1) // cols; sheet = Image.new('RGB', (cols * size, rows * size), (40, 40, 40))
    for i, (p, t) in enumerate(cells):
        if p and os.path.exists(p): sheet.paste(label(Image.open(p).convert('RGB').resize((size, size), Image.LANCZOS), t), ((i % cols) * size, (i // cols) * size))
    sheet.save(path); print('wrote', path, sheet.size)

v = ('front', 'three_quarter', 'overhead')
grid([('before/%s.png' % x, 'BEFORE sonnet tree %s' % x) for x in v] + [('out/%s.png' % x, 'AFTER opus tree %s' % x) for x in v], 3, 480, 'out/before_after.png')
rd = 'out/renders'
if os.path.isdir(rd):
    cells = []
    for nm in ('tree', 'tree_b', 'tree_young'):
        cells += [('%s/%s_%s.png' % (rd, nm, x), '%s %s' % (nm, x)) for x in ('front', 'three_quarter', 'rts')]
    for nm in ('tree_lod', 'tree_b_lod', 'tree_young_lod'):
        cells += [('%s/%s_%s.png' % (rd, nm, x), '%s %s' % (nm, x)) for x in ('three_quarter', 'rts')] + [(None, '')]
    grid(cells, 3, 400, 'out/contact_sheet.png')
