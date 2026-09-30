"""Compose output/contact-sheet.png from tile albedos + prop thumbnails (run after blender_scene.py)."""
import os, sys, json
from PIL import Image, ImageDraw, ImageFont
out = os.path.abspath(sys.argv[1])
man = json.load(open(os.path.join(out, "manifest.json")))
stats = json.load(open(os.path.join(out, "prop_stats.json")))
T = 256
fams = ["meadow", "loam", "stone", "sand", "snow", "ash"]
cols = 6
rows_p = 3
W, H = cols * 320, 40 + 2 * 300 + rows_p * 360 + 20
sheet = Image.new("RGB", (W, H), (26, 24, 22))
d = ImageDraw.Draw(sheet)
try:
    f = ImageFont.truetype("arial.ttf", 16)
except Exception:
    f = ImageFont.load_default()
d.text((12, 10), "Brann's Forge ground kit - 6 seamless PBR tiles (albedo over normal) and 18 clutter props (tri counts)", fill=(235, 225, 205), font=f)
for i, fam in enumerate(fams):
    x = i * 320 + 32
    sheet.paste(Image.open(os.path.join(out, "materials", f"{fam}_albedo.png")).convert("RGB").resize((T, T), Image.LANCZOS), (x, 40))
    sheet.paste(Image.open(os.path.join(out, "materials", f"{fam}_normal.png")).convert("RGB").resize((T, T), Image.LANCZOS), (x, 40 + 270))
    d.text((x, 40 + 2 * 270 - 2), fam, fill=(235, 225, 205), font=f)
y0 = 40 + 2 * 300
for i, p in enumerate(man["props"]):
    im = Image.open(os.path.join(out, "_thumbs", p["id"] + ".png")).convert("RGB").resize((312, 312), Image.LANCZOS)
    x, y = (i % cols) * 320 + 4, y0 + (i // cols) * 360
    sheet.paste(im, (x, y))
    d.text((x + 6, y + 316), f"{p['id']}  {stats[p['id']]['tris']} tris", fill=(235, 225, 205), font=f)
sheet.save(os.path.join(out, "..", "contact-sheet.png"))
print("contact sheet ok")
