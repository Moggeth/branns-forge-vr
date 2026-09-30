# Deterministic weapon inspection

Run from the project root:

```powershell
python scripts/weapon_review.py
python scripts/weapon_review.py --weapons woodland_axe,siegebird,emberwing
python scripts/weapon_review.py --check-only --out outputs/weapon-review/checks
python scripts/weapon_review.py --verify-repeat
python scripts/test_weapon_review.py
python scripts/weapon_review.py --list
```

Default output: `outputs/weapon-review/latest/overview.png`, one
`<item-id>/review-sheet.png` per item, original PNGs, `report.json`, and a
CRC-checked `weapon-review.zip`. `--out` selects another folder; `--size`
supports 512, 768 (default), 1024 and 1536. `--force` renders even with an
unchanged cache. Exit 0 means the declared alignment checks passed; exit 1
means inspect the reported poses; exit 2 means the workflow failed.

Measured on this RTX 3080 Ti: the full 20-item batch takes approximately
26 seconds, writes 308 original captures and 20 sheets, and checks 100 pose
conditions. An unchanged rerun took **0.117 seconds**. Headless pose inspection
took 7.725 seconds. The two-run verification took **52.591 seconds**: all 308
PNGs were byte-identical, and every source fingerprint and pose record matched.
The final ZIP is about 27 MB. These are workflow measurements, not VR frame-rate
or headset acceptance measurements.

Keep a baseline with `--out outputs/weapon-review/before` before changing a
pose, then render to `--out outputs/weapon-review/after`. Assemble selected
matching views without another renderer run:

```powershell
python scripts/weapon_review_compare.py outputs/weapon-review/before outputs/weapon-review/after --views quarry_pick:desktop:quarter --out outputs/weapon-review/comparison.png
```

The comparison uses the original captures and reports their measured axis dots;
camera directions and neutral lighting remain fixed, with automatic framing.
The three-pose correction sheet took 0.123 seconds to assemble.

This is one offline **actual Godot batch**, not an AI reconstruction or a
separate Blender attachment approximation. It loads the installed models,
runtime factories, articulated gloves, calibrated controller sockets,
production attachment functions and actual leather/brass holsters. Each
item gets front/back/left/right/top/bottom/three-quarter views, left/right
VR grip views, an FPS pose and a 16:9 player-camera view, and supported holsters.
The six tools with an authored second-grip range also get two-hand views;
Siegebird is checked after rotating the rear wrist 37 degrees with both
hand positions fixed. The rail must remain aligned with those positions.
Managed gadgets (Sunskipper and Copper Kite) use their own actual attachment
paths; their return-to-stand behaviour is not misrepresented as a holster.
The independent axis declarations live in
`godot/weapon_inspection_catalog.json`. Orange is the working axis; cyan is
the pointing ray. Symmetric/decorative objects without a meaningful firing
axis are shown without pretending an arbitrary direction is a failure.

The fixture is a thumb-up, index-forward power grip. Cameras, lighting,
resolution and framing rules are fixed. Shader clocks are frozen to zero
in **diagnostic material copies**; the installed shader is not changed.
This establishes reproducible evidence on the same renderer/machine;
cross-driver pixel identity and headset comfort are not promised.

`--verify-repeat` forces two real engine runs, compares exact source fingerprints
and pose records, and adds `repeat.json` to the review ZIP. Byte equality is
reported separately from a tightly bounded GPU pixel tolerance: at most 8/255
per channel, 0.2% changed pixels and 0.08/255 maximum per-channel RMS, with all
three limits required. A targeted Wyrmspout repeat differed at 69 reflective
texture pixels by at most 5/255; the complete final repeat was byte-identical.
The six Python regression cases reject a one-pixel pose shift, reorientation,
broad subtle material change and a different resolution. Any mismatch retains
before/after PNGs under `repeat-differences/`; a failed repeat removes the cache
manifest so it cannot silently become a cached verification success.

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

## Runtime orientation corrections, 2026-09-30

The baseline exposed five FPS tools using a -Z muzzle-style transform despite
their visible +X striking faces: Copperpot's Promise, the spare apprentice
hammer, Stonewhisper, Hollow's Song and Stormbell. They now use a forward
working face and a grip offset along their actual shaft. The axe's existing
correct blade/haft pose, both Wyrmspout generations' runtime conventions and
Emberwing's authored poses are retained.

All three guardian shields previously faced skyward in the standard power
grip. Their blocking face now follows the index ray, their long axis follows
the thumb, and their handle remains at the same palm contact. Holstered
shields now hang vertically outside the hip rather than forming a horizontal
tray. The Sol and Opus forge lanterns also had identical unmirrored VR poses;
their corrected mirrored poses keep the lamp upright and the grip marker at
the palm. FPS and shutter mechanics are preserved.

`grip_runtime.pose_for()` is the shared production attachment resolver;
Siegebird's one-hand update calls it too. The two-hand position solver is
unchanged. Authored `grip_preferences` and user `grip_adjustments` are
separate. Saved calibrations use item ID, creation version, hand and the
authored pose's content signature. Changing a default therefore invalidates
only that default's calibrations, without deleting any historical entry.
Old unversioned overrides for the corrected profiles, axe, Wyrmspout and
crossbow are ignored. Other legacy calibrations remain readable while their
generic default still equals the historical convention. Re-adjust
a corrected item once with A if you want a custom pose; it then survives
reload and takes precedence over its authored default.

No installed artwork was regenerated for these transform corrections.
Real HMD reach, wrist comfort and holster/body clearance remain playtest
acceptance checks, not something an offline screenshot proves.

## Selected review artefacts

[Before/after grip corrections](https://gratis-postcards-apparently-temp.trycloudflare.com/reviews/weapon-orientation-20260930.png),
[20-item overview](https://gratis-postcards-apparently-temp.trycloudflare.com/reviews/weapon-overview-20260930.png),
and [full-resolution review ZIP](https://gratis-postcards-apparently-temp.trycloudflare.com/reviews/weapon-review-20260930.zip).
The existing showroom host serves only the selected PNGs and image/evidence
archive. Remote size, MIME and SHA-256 verification passed in 4.041 seconds.
This temporary tunnel requires the host PC to stay awake; local outputs persist
even after the link expires. Reuse the asset-showroom skill to publish another
selected pack rather than recreating a server.

Material work timings are recorded in ignored `logs/work-timing.csv` and
`logs/weapon-review-work-timing-20260930.json`; regression outcomes and failed
strategies are in `docs/VERIFICATION.md`.
