# Quartermaster item art (2026-10-09)

`build_items.py` models every hero item sold at the keep Quartermaster (`multiplayer/shared/hero-items.js`), plus the
Healing Draught and the tavern's Hearty Ale, as small storied props, and renders each as a shop icon (Cycles,
transparent background, three-quarter view, warm key and cool rim) to `multiplayer/public/assets/items/<id>.webp`
(192 px, a few KB each). The shop (`multiplayer/client/quartermaster-ui.js`) shows them and falls back to the old glyph
if a picture fails to load.

    python3.11 -m pip install bpy==4.5.* pillow
    python3.11 build_items.py                    # every icon, 64 samples
    python3.11 build_items.py hat,locket 32 sheet # a subset at 32 samples, plus renders/sheet.png

| id | What it is |
|---|---|
| breastplate | Dawnhold infantry cuirass, enamel sun boss, one honest dent |
| boots | Tall leather boots with brass coil springs under the heels |
| whetstone | Blue grit stone worn into a dip, oak holder, honing-oil flask |
| kettle | Palm-sized copper kettle with a cord-wrapped handle and a tin cup |
| purse | Fat leather pouch spilling coins and a gold nugget |
| belt | Bandolier with two Healing Draughts in holsters |
| charm | Forgeling-hammered round shield, cog-toothed rim, crystal boss, braided cord |
| leech | Apothecary jar of green tonic, wax-sealed, with a glossy leech |
| hat | Navy tricorn, gold braid, white plume, brass ballista-bolt badge |
| crown | Iron circlet with gold battlements, ram's-horn curls, a ruby |
| locket | Gold heart locket swung open on a glowing heartstone |
| draught | Round flask of glowing blue tonic with a paper tag |
| ale | Oak-staved, brass-bound tankard with foam spilling over |

Renders in `renders/` are regenerated and not committed.
