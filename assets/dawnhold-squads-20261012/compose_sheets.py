"""Lay the transparent renders out as review sheets: python3 compose_sheets.py <out_dir>"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(HERE, 'renders')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'sheets'); os.makedirs(OUT, exist_ok=True)
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'; SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
UNITS = [('forgeling', 'Forgeling', 'Line soldier · hammer and forge shield'),
         ('anvilback', 'Anvilback', 'Heavy · anvil tower shield, bellows boiler'),
         ('glintshot', 'Glintshot', 'Ranged · crystal repeater, spyglass'),
         ('mender', 'Mender', 'Support · Hearthfire lantern crook'),
         ('fusewick', 'Fusewick', 'Sapper · Emberdew keg'),
         ('crew', 'Sunlance Cart crew', 'Siege crewman · flat cap and goggles')]
LEVEL = 'Level 2 candidate · Blender render, not yet checked in game'


def bg(w, h):
    im = Image.new('RGB', (w, h))
    top, bot = (232, 238, 246), (244, 236, 222)
    for y in range(h):
        t = y / h; im.paste(tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)), (0, y, w, y + 1))
    return im.convert('RGBA')


def paste(dst, path, xy, size=None):
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 0 if v < 10 else min(255, int((v - 10) * 1.05)))
    im.putalpha(a)
    if size: im = im.resize(size, Image.LANCZOS)
    w, h = im.size; f = max(1, w // 8)
    edge = Image.new('L', (w, h), 255); de = ImageDraw.Draw(edge)
    for x in range(f):
        v = int(255 * x / f); de.line([(x, 0), (x, h)], fill=v); de.line([(w - 1 - x, 0), (w - 1 - x, h)], fill=v)
    from PIL import ImageChops
    im.putalpha(ImageChops.multiply(im.getchannel('A'), edge))
    dst.alpha_composite(im, xy)


def title(d, x, y, name, sub):
    d.text((x, y), name, font=ImageFont.truetype(SERIF, 54), fill=(44, 52, 74))
    d.text((x, y + 66), sub, font=ImageFont.truetype(SANS, 24), fill=(80, 88, 104))
    d.text((x, y + 100), LEVEL, font=ImageFont.truetype(SANS, 20), fill=(130, 120, 100))


for key, name, sub in UNITS:
    views = ['front', 'three', 'side', 'back']
    W, H = 4 * 560 + 900, 1000
    im = bg(W, H); d = ImageDraw.Draw(im)
    for i, v in enumerate(views):
        p = os.path.join(R, f'{key}_{v}.png')
        if os.path.exists(p): paste(im, p, (i * 560 - 40, 110), (640, 900))
    p = os.path.join(R, f'{key}_face.png')
    if os.path.exists(p): paste(im, p, (W - 880, 150), (840, 840))
    title(d, 40, 24, name, sub)
    for i, v in enumerate(['Front', 'Three-quarter', 'Side', 'Back']):
        d.text((i * 560 + 240, H - 44), v, font=ImageFont.truetype(SANS, 22), fill=(110, 110, 120))
    im.convert('RGB').save(os.path.join(OUT, f'{key}.jpg'), quality=90)

# siege cart sheet
views = [v for v in ('cart_three', 'cart_side', 'cart_rear') if os.path.exists(os.path.join(R, v + '.png'))]
if views:
    im = bg(3 * 1100, 1000); d = ImageDraw.Draw(im)
    for i, v in enumerate(views): paste(im, os.path.join(R, v + '.png'), (i * 1100 - 90, 130), (1280, 900))
    title(d, 40, 24, 'Sunlance Cart', 'Mobile siege · a mini keep ballista on wheels, pushed by its crewman')
    im.convert('RGB').save(os.path.join(OUT, 'sunlance_cart.jpg'), quality=90)

# roster lineup from the three-quarter views
keys = [k for k, _, _ in UNITS if k != 'crew'] + ['cart_three']
im = bg(5 * 470 + 1100, 1000); d = ImageDraw.Draw(im); x = -60
for k in keys:
    p = os.path.join(R, (k if k == 'cart_three' else f'{k}_three') + '.png')
    if not os.path.exists(p): continue
    if k == 'cart_three': paste(im, p, (x, 160), (1100, 773)); x += 1100
    else: paste(im, p, (x, 120), (600, 844)); x += 470
d.text((40, 24), 'Dawnhold squads', font=ImageFont.truetype(SERIF, 54), fill=(44, 52, 74))
d.text((40, 92), 'Forgeling · Anvilback · Glintshot · Mender · Fusewick · Sunlance Cart     ' + LEVEL, font=ImageFont.truetype(SANS, 24), fill=(80, 88, 104))
im.convert('RGB').save(os.path.join(OUT, '00-roster.jpg'), quality=90)
print('sheets ->', OUT)
