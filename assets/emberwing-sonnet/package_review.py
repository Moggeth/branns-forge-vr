"""Label the standard render plate and bundle only the selected Emberwing files."""
import argparse
import json
import shutil
import struct
import time
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument("--folder", required=True)
args = parser.parse_args()
started = time.perf_counter()
folder = Path(args.folder).resolve()
source = Path(__file__).resolve().parent
project = source.parent.parent
manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
model_bytes = (project/"godot/weapons/emberwing/bow.glb").read_bytes()
chunk_length = struct.unpack_from("<I", model_bytes, 12)[0]
model_json = json.loads(model_bytes[20:20+chunk_length])
primitives = [p for mesh in model_json["meshes"] for p in mesh["primitives"]]
triangles = sum(model_json["accessors"][p["indices"]]["count"]//3 for p in primitives)
model_summary = f"{triangles:,} triangles, {len(primitives)} material surfaces and {len(model_json['materials'])} materials"
font_path = "C:/Windows/Fonts/segoeui.ttf"
title_font = ImageFont.truetype(font_path, 42)
label_font = ImageFont.truetype(font_path, 24)
small_font = ImageFont.truetype(font_path, 21)
card = 600
header = 128
canvas = Image.new("RGB", (card*4, header+660*3), "#151b20")
draw = ImageDraw.Draw(canvas)
draw.text((28,18), "EMBERWING / REFINED DESIGN REVIEW", font=title_font, fill="#f2eee4")
draw.text((30,77), "Installed model · neutral lighting · orthographic cameras · 1.25 m tall", font=label_font, fill="#b6c0c8")
for index, record in enumerate(manifest["views"]):
    with Image.open(folder / record["file"]) as raw:
        if raw.size != (1800,1800):
            raise ValueError(f"Unexpected image resolution: {record['file']} {raw.size}")
        raw.load()
        picture = raw.resize((card,card), Image.Resampling.LANCZOS)
    x, y = (index%4)*card, header+(index//4)*660
    canvas.paste(picture, (x,y))
    draw.text((x+16,y+608), record["title"], font=small_font, fill="#f2eee4")
    draw.text((x+16,y+635), f"{index+1:02d}  |  frame span {record['orthographic_span_m']:.2f} m", font=ImageFont.truetype(font_path,16), fill="#aeb8c0")
canvas.save(folder / "Emberwing-review-sheet.png")
files = {
    "bow-game.glb": project/"godot/weapons/emberwing/bow.glb",
    "arrow.glb": project/"godot/weapons/emberwing/arrow.glb",
    "wings.glb": project/"godot/weapons/emberwing/wings.glb",
    "source.blend": source/"source.blend",
    "builder.py": source/"builder.py",
    "review_views.py": source/"review_views.py",
    "art-handoff.md": source/"HANDOFF.md",
    "in-game-bow.png": source/"previews/game.png",
    "in-game-winged-arrow.png": source/"previews/flight.png",
}
for filename in ["flight_builder.py", "REFINEMENT.md", "finish-report.json", "STRUCTURE-HANDOFF.md"]:
    if (source/filename).is_file(): files[filename] = source/filename
for filename in ["refined-hands.png", "refined-night.png", "refined-detail.png"]:
    if (source/"previews"/filename).is_file(): files[filename] = source/"previews"/filename
for name, path in files.items():
    shutil.copy2(path, folder/name)
readme = """# Emberwing designer review

This pack contains 12 unretouched, 1800 x 1800 PNG views of the installed
Emberwing bow, a labelled overview, actual game and articulated-hand captures,
the installed GLBs, a rest-pose assembly with string, and editable Blender source/builder.

01 front (-Z firing side), 02 back (+Z string/player side), 03 left (-X),
04 right (+X), 05 top (+Y), 06 bottom (-Y), 07/08 three-quarter,
09 grip/raised arrow guide, 10 phoenix/materials, 11 side at 50 cm draw,
12 triangulated wireframe. All cameras are orthographic. Front/back/side and
three-quarter views share a 1.50 m frame span; top/bottom and details are
enlarged. Exact directions, dimensions and timing are in manifest.json.

Blender EEVEE, AgX, neutral white studio lights, no bloom or colour retouch.
Gold and emissive surfaces naturally differ from the game renderer; compare
the in-game images before judging the complete lighting/VFX experience.
The hand and night images use actual Godot gloves and materials in synthetic
controller poses. They establish geometry and lighting, not headset comfort.
The review GLB adds only the runtime string approximation to the same mesh;
bow-game.glb is the exact game file. The assembly is not a replacement asset.
The draw view includes the real arrow, string displacement and runtime limb
flex approximation. GLB art excludes game code, physical controls, flight,
wing banking, collision and sound.

Useful review questions:
- Is the silhouette clearly a phoenix bow rather than a fern or metal fan?
- Do front, back and side views feel equally intentional?
- Are the solid leather grip, open arrow window, nocks and string mechanically legible?
- Are the gold, wood/leather, ember interiors and blue accents distinct enough?
- Is the phoenix head convincing at ordinary hand-held viewing distance?
- What should be simplified, reshaped or retextured first?

Please refer to view numbers and mark up the original PNGs where useful.
The bow is approximately 1.25 m tall with a hand-sized solid oval grip.
MODEL_SUMMARY. The playable arrow travels
along local -Z; +Y is up. Preserve Grip/ArrowRest/StringTop/StringBottom and
UpperLimb/LowerLimb/PhoenixCore/ArrowGuide markers in proposed replacement models.
ArrowRest is the braced string nock at (0,.115,.10); ArrowGuide is the
physical guide at (0,.115,-.012). StringTop/Bottom belong to the limb pivots.

Rebuild the bow with builder.py; add --all to rebuild all three installed
assets using flight_builder.py. Arrow and wing artwork is intentionally kept
byte-identical to the original playable version. See art-handoff.md and
REFINEMENT.md for verification, measured costs and remaining limitations.
"""
readme = readme.replace("MODEL_SUMMARY", model_summary)
(folder/"START-HERE.md").write_text(readme, encoding="utf-8")
archive = folder / "Emberwing-designer-review.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    selected = set(files) | {v["file"] for v in manifest["views"]} | {
        "START-HERE.md", "manifest.json", "Emberwing-review-sheet.png",
        "Emberwing-assembled-review.glb"}
    for name in sorted(selected):
        bundle.write(folder/name, "Emberwing-review/"+name)
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise ValueError("Review archive failed its CRC check")
print(json.dumps({"views":len(manifest["views"]),"archive":str(archive),
                  "bytes":archive.stat().st_size,"seconds":round(time.perf_counter()-started,3)}))
