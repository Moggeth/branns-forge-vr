# Emberwing designer review

[Orbit the assembled model](https://gratis-postcards-apparently-temp.trycloudflare.com/#emberwing-assembled-review-a9e99d756861) ·
[Full-resolution overview](https://gratis-postcards-apparently-temp.trycloudflare.com/reviews/Emberwing-review-sheet.png) ·
[Download the complete review pack](https://gratis-postcards-apparently-temp.trycloudflare.com/reviews/Emberwing-designer-review.zip)

These are public selected-art links, with no sign-in. The tunnel is temporary:
the PC must remain awake and its URL changes after a tunnel restart.
The 41,601,958-byte ZIP contains twelve 1800 × 1800 PNGs, a labelled overview,
original bow/arrow/wings GLBs, an assembled review GLB, editable Blender source,
the deterministic builder, art handoff and two actual game captures. It includes
a short designer brief and numbered feedback questions. No project/service data
or credentials are included.

![Labelled standard views](previews/review-sheet.png)

The six cardinal views, two three-quarter views, grip and phoenix close-ups,
drawn side pose and triangulated wireframe use neutral white studio lighting,
AgX and orthographic cameras. Full bow views share a 1.50 m frame span;
top/bottom and detail views are deliberately enlarged. Camera positions and
frame spans are recorded in the pack's `manifest.json`. The rendered art is the
installed GLB, with a runtime-string approximation. The draw pose adds the real
arrow and modest runtime limb flex. Gameplay, flight/VFX and collision are not
simulated in the orbit showroom; the in-game images provide lighting context.

The original bow remains byte-identical:
`6840d6245b74b0f4c521d6affeaac03846cb4c0523cdb4f132fce1002cfad816`.
No game model, mechanics, controls or live session was changed for this review.

## Reproduce from the repository root

```powershell
& tools/blender-4.5.13-windows-x64/blender.exe --background --python-exit-code 2 --python assets/emberwing-sonnet/review_views.py -- --model godot/weapons/emberwing/bow.glb --out outputs/emberwing-review
python assets/emberwing-sonnet/package_review.py --folder outputs/emberwing-review
```

Pillow is required by the packager. Full images and the archive remain in ignored
`outputs/emberwing-review/`; the curated overview and renderer/packager are
versioned here. The packager includes an explicit file allowlist and checks ZIP
CRC and image resolution. The assembled GLB passed the existing asset contract,
Khronos validation and disposable Godot import. Remote verification checked the
four model lengths, PNG/ZIP sizes and content types, and the overview's SHA-256.

Use the installed `asset-showroom` skill to publish the assembled GLB. For
review-image/download sharing, its static server now accepts `.png` and `.zip`;
copy only the selected overview/archive to
`C:/Users/mog/.codex/asset-showroom/public/reviews/` and verify their URLs.
There is no folder listing or access outside the copied public root. Start,
status and identity-safe stop commands are in that skill; do not stop the game
or unrelated servers. Runtime logs are under
`C:/Users/mog/.codex/asset-showroom/logs/`.

Measured final rendering: **4.735 s** for all twelve views. Packaging/CRC:
**2.019 s**; assembled-model gate: **2.231 s**; remote checks: **1.965 s**.
First wireframe render did not apply the view-layer material override. Explicit
mesh materials and a thin wire modifier fixed it; disabling even-offset avoids
long spikes at acute feather triangles. Two initial tunnel checks failed with
`getaddrinfo` (16.673 / 16.900 s); later DNS lookup succeeded, and the existing
tunnel verified without another restart. Do not treat stale `last-publish.json`
as a verified new URL after failure. Detailed step timing remains in
`logs/work-timing.csv`.
