"""Labelled contact sheet from output/renders/*_threequarter.png (system Python + Pillow).
  python output/builder/contact_sheet.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
report = json.load(open(os.path.join(OUT, "build_report.json")))
items = [a for a in report["assets"] if a.get("renders")]
cell, cols = 360, 5
rows = (len(items) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + 44) + 50), (32, 30, 28))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 17); small = ImageFont.truetype("arial.ttf", 13); big = ImageFont.truetype("arial.ttf", 24)
except OSError:
    font = small = big = ImageFont.load_default()
d.text((12, 12), "Brann's Forge VR - orchard environment library (three-quarter views, auto-framed; not to common scale)", fill=(240, 226, 200), font=big)
for i, a in enumerate(items):
    x, y = (i % cols) * cell, 50 + (i // cols) * (cell + 44)
    im = Image.open(os.path.join(OUT, a["renders"]["threequarter"])).convert("RGB").resize((cell - 8, cell - 8))
    sheet.paste(im, (x + 4, y + 4))
    s = a["size"]
    d.text((x + 8, y + cell - 2), a["id"], fill=(250, 240, 215), font=font)
    d.text((x + 8, y + cell + 20), f"{s[0]:.1f} x {s[1]:.1f} x {s[2]:.1f} m   {a['triangles']} tris", fill=(190, 180, 160), font=small)
sheet.save(os.path.join(OUT, "renders", "contact_sheet.png"))
print("contact sheet", len(items))
