# Home bases kit (Dawnhold and Grumblekeep)

`build_bases.py` builds every base piece for both sides with procedural textures and writes `bases_kit.glb` here.
It reuses the landmark kit's texture, mesh and masonry helpers (`../landmarks-20261004/build_landmarks.py`).

    pip install bpy==4.5.*
    python3 build_bases.py
    cp bases_kit.glb ../../multiplayer/public/assets/
    python3 render_bases.py both 64      # optional Cycles previews in renders/, laid out like the game

Piece names, pivots and anchors are listed at the top of `build_bases.py`. `client/home-base-art.js` lays the pieces out
with `shared/home-bases.js` `HOME_LAYOUT`, bakes the static decor into one mesh per material and keeps the moving parts
(heart crystal and rings, bell, fountain water, pylon and spire crystals, ballista yoke, bow and bolt) separate.
`tests/home-base-kit.mjs` checks the shipped kit's pieces, anchors, packed colours and size.
Textures, renders and the local .glb are regenerated and not committed.
