"""Adds titles/labels to renders/contact_sheet_raw.png -> renders/contact_sheet.png (system Python + Pillow)."""
import json
from PIL import Image, ImageDraw, ImageFont
m = json.load(open("manifest.json"))
im = Image.open("renders/contact_sheet_raw.png").convert("RGB")
T = im.width // 3
head = 60
out = Image.new("RGB", (im.width + 250, im.height + head), (40, 44, 38))
out.paste(im, (250, head))
d = ImageDraw.Draw(out)
try:
    f, fb = ImageFont.truetype("arial.ttf", 18), ImageFont.truetype("arialbd.ttf", 22)
except OSError:
    f = fb = ImageFont.load_default()
for c, t in enumerate(("close / VR eye level", "3/4 view", "far: 40 px render, nearest-upscaled")):
    d.text((260 + c * T, 18), t, fill=(235, 235, 220), font=fb)
for r, a in enumerate(m["assets"]):
    y = head + r * T + 20
    d.text((12, y), a["id"], fill=(240, 230, 190), font=fb)
    s = a["size_m"]
    d.text((12, y + 34), f"{a['triangles']} tris, 1 material", fill=(210, 210, 200), font=f)
    d.text((12, y + 58), f"{s[0]:.2f} x {s[1]:.2f} x {s[2]:.2f} m", fill=(210, 210, 200), font=f)
    d.text((12, y + 82), "(W x H x D)", fill=(160, 160, 150), font=f)
out.save("renders/contact_sheet.png")
print("labelled", out.size)
