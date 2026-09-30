# Deterministic weapon inspection

Run from the project root:

```powershell
python scripts/weapon_review.py
python scripts/weapon_review.py --weapons woodland_axe,siegebird,emberwing
python scripts/weapon_review.py --check-only --out outputs/weapon-review/checks
python scripts/weapon_review.py --list
```

Default output: `outputs/weapon-review/latest/overview.png`, one
`<item-id>/review-sheet.png` per item, original PNGs, `report.json`, and a
CRC-checked `weapon-review.zip`. `--out` selects another folder; `--size`
supports 512, 768 (default), 1024 and 1536. `--force` renders even with an
unchanged cache. Exit 0 means the declared alignment checks passed; exit 1
means inspect the reported poses; exit 2 means the workflow failed.

This is one offline **actual Godot batch**, not an AI reconstruction or a
separate Blender attachment approximation. It loads the installed models,
runtime factories, articulated gloves, calibrated controller sockets,
production attachment functions and actual leather/brass holsters. Each
item gets front/back/left/right/top/bottom/three-quarter views, left/right
VR grip views, an FPS pose and a 16:9 player-camera view, and both holsters.
The independent axis declarations live in
`godot/weapon_inspection_catalog.json`. Orange is the working axis; cyan is
the pointing ray. Symmetric/decorative objects without a meaningful firing
axis are shown without pretending an arbitrary direction is a failure.

The fixture is a thumb-up, index-forward power grip. Cameras, lighting,
resolution and framing rules are fixed. Shader clocks are frozen to zero
in **diagnostic material copies**; the installed shader is not changed.
This establishes reproducible evidence on the same renderer/machine;
cross-driver pixel identity and headset comfort are not promised.

The workflow does not contact the service, initialise OpenXR, read/write
player saves, start/stop a live game, or request new art. The tiny GPU
window is off-screen and cannot take focus. Headless mode checks transforms
without trying to read textures from Godot's dummy renderer.

The cache hashes source contents and imported meshes/textures; a local
size/mtime-validated digest index makes an unchanged rerun cheap. A runtime,
asset, material, catalogue, script or requested-settings change invalidates
the cache. Engine output is captured in timestamped
`logs/weapon-review-*.log`; timings append to `logs/work-timing.csv`.
Missing reports/result markers, script errors, engine errors and absent
visible meshes fail explicitly. Never accept exit status alone as proof
that Godot ran the test.

Coverage is explicit. Pocket Thunder is a worn ability covered by the
hand/bomb diagnostics; it is not a loose weapon. The historical first
Wyrmspout mesh is not installed as a native asset and is not silently
replaced with the second version. Arbitrary generated inventions need a
catalogue adapter and an independently reviewed axis/grip contract before
they can be marked inspected. The report records these omissions.

For the next weapon: declare the authored working/up axes, grip origin,
per-hand default poses and holster intent; add its real runtime factory to
the catalogue; render it; inspect both hand views and the FPS player view;
run its functional/mechanical checks as well. A numerical green check does
not establish that fingers actually wrap around a handle or that the
model's visible blade agrees with its declared axis.
