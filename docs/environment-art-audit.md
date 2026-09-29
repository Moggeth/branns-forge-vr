# Environment art baseline — 2026-09-29

This is a visual commissioning baseline for all 12 playable zones, captured from the real shared Godot world after travel applies each zone's lighting and fog. The capture process uses `--world-builder-preview`, which makes the game diagnostic and prevents reads or writes to the live world-builder save. It does not start SteamVR or contact the service. Run from the repository root:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://environment_art_review.gd --quit-after 2400 -- --world-builder-preview
```

The ignored `outputs/environment-art-review/` contains 24 named 1200 × 750 PNGs, two per zone, plus `result.json`. `ground-eye` uses each zone's established capture pose; `elevated-rts` surveys the zone, with cameras below the kitchen and hollow roofs. The manifest records camera poses, expected and captured fog density, scene geometry node counts, sampled image luminance and coarse color-bin counts, elapsed time, and failures. These metrics can flag a blank or unexpectedly flat capture; they are not aesthetic scores. Run `python scripts/make_environment_contact_sheet.py` to rebuild the ignored `contact-sheet.jpg` from the manifest and PNGs (Pillow is needed for this review utility). It took 0.563 s for this baseline; the result is a visual review aid, not an aesthetic score.

Each capture now also records a draw-call count and rendered-object count before PNG readback. Use them to spot large before/after regressions when integrating a zone kit. They are whole-process samples while the live world and a review viewport exist; they are neither isolated GPU timings nor a headset stereo benchmark. Capture pacing makes FPS and process-time samples misleading, so those are deliberately omitted. Run a separate in-game VR performance check before claiming a kit is headset-safe.

The 2026-09-30 ground-eye baseline for the next six art candidates, sampled under that exact capture setup:

| Zone | Draw calls | Rendered objects |
| --- | ---: | ---: |
| Sandstone Quarry | 395 | 591 |
| Ember Foundry | 351 | 544 |
| Enchanted Kitchen | 950 | 1,147 |
| Mushroom Glade | 226 | 420 |
| Pinewood Ruins | 322 | 595 |
| Crystal Hollow | 561 | 834 |

These totals include the running world and the review viewport. Compare like-for-like captures only. The Kitchen is already relatively expensive despite its simple appearance, so extra shelves/props should be batched rather than added as independent nodes.

For the next authored kits, run the route/resource acceptance check before and after integration. It samples a player-sized capsule along the Quarry, Foundry, Kitchen, Glade, Pinewood and Crystal approaches, gathering sites and fight spaces, rejects authored collision that blocks them, and checks existing resource/barrier counts. After importing the first pair, use `-- --zone=sandstone_quarry,ember_foundry --require-authored`; the default checks all six without demanding unfinished kits:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://zone_art_route_checks.gd --quit-after 2400
```

`scripts/Verify-ZoneArt.ps1 -Zones sandstone_quarry,ember_foundry -Render` runs the structural/texture validator, Godot editor import, the relevant route acceptance check and all 24 actual-game captures/contact sheet in that order. Without `-Render` it skips the screenshots. Logs and timing go under ignored `logs/`; the script stops on any failed gate. The dry run on existing Starfall art passed in 4.207 s; the render-inclusive run passed in 17.756 s. This does not replace close visual inspection or HMD performance testing.

## Commission order from the captured images

| Priority | Zones | Evidence and Sonnet art brief |
| --- | --- | --- |
| 1 | Gloamfen | Both views are broad, low-contrast teal planes. The sparse central structure and thin silhouettes lack a strong foreground or a readable route. Commission layered wetland masses, root/reed clusters, focal ruins, and controlled luminous accents that preserve player navigation. |
| 2 | Sky Garden, Cloudbreak Keep | Both floating regions have attractive distant clouds but bare, rectangular near islands. Ground-eye views show limited shelter, vertical detail, and distinct arrival landmarks. Commission island edge/underside forms, plant and architectural kits, and a stronger path rhythm while preserving existing traversal and grapple positions. |
| 3 | Starfall Ridge | Color and crystals establish the theme, but the eye view has a wide uniform foreground and the overhead view reads as scattered props. Commission varied rock strata, deliberate crystal clusters, and a clear path/landmark sequence. |
| 4 | Sandstone Quarry, Ember Foundry | Both have recognizable silhouettes and warm palettes. Quarry floor and walls repeat broad shapes; Foundry's central ground is a large uninterrupted plane. Commission surface breakup, industrial/mining detail, and grouped work areas without obscuring gates, resources, or combat space. |
| 5 | Enchanted Kitchen, Mushroom Glade | Kitchen reads cleanly but is highly symmetrical with repetitive shelves/floor; Glade has a strong pond and mushrooms but a sparse perimeter. Add small authored detail and material variation after the large environmental gaps above. |
| Reference quality | Forge Yard, Pinewood Ruins, Crystal Hollow, Orchard Highlands | The Forge has readable authored architecture, Pinewood a clear path and gate, Crystal Hollow a strong light and crystal focal point, and Orchard layered vegetation and terrain. Use these as density and readability references while keeping each zone's own identity. |

The zone root counts support the visual triage only loosely: Gloamfen has 33 visible geometry nodes, Cloudbreak Keep 26, Sky Garden 73, Starfall Ridge 196, and Orchard Highlands 1,518. MultiMesh nodes can contain many instances, and other game systems may add visuals outside the zone root. Judge the PNGs first.

Priority 3 has since been integrated: [Starfall Ridge's authored valley and actual-game comparison](STARFALL-ART-20260930.md). Priorities 1 and 2 likewise have their own art handoffs. Quarry has [an authored mining-yard pass](QUARRY-ART-20260930.md) and Foundry has [an authored basalt-and-iron pass](FOUNDRY-ART-20260930.md).

The [Enchanted Kitchen rebuild](KITCHEN-ART-20260930.md) now replaces its uniform shelves and ceiling with an authored timber hall. The first per-piece import cost 1,327 ground-eye draws, above the 950 pre-art baseline; compiling its static layout into 20 material batches reduced that to 862. This is a useful pattern for small self-contained destinations, while outdoor kits still need chunks for culling and local editing.

## Capture failure and recovery

The first default run completed 24 files in 8.53 script seconds, but most were nearly solid haze. Hiding the horizon did not restore Pinewood; the game's own `--capture-zone=pinewood_ruins` reproduced the haze. A fresh Godot `Environment` probe showed that assigning `fog_mode=0` resets `fog_density` from `0.001` to `1.0`. `adventure_runtime.gd` restored `fog_mode` after setting the zone density. Commit `497b2c1` moved the density assignment after the grade defaults. The final default run after that fix completed 24 files in 8.97 script seconds (10.63 wall seconds), with no capture failures or fog audit notes. Orchard deliberately applies its separate 0.0028 atmosphere grade over its 0.0008 zone palette.

If a future run looks flat, check `audit_notes` and the fog fields in `result.json` before issuing an art commission. `--review-correct-fog` writes to `outputs/environment-art-review-corrected-fog/` and temporarily reapplies the intended fog inside the disposable capture process for diagnosis. `--review-hide-horizon` similarly produces a separate diagnostic output directory. Neither option changes source assets or live saves. For the canonical baseline, omit both options.

Measured tool steps: repo and existing capture inspection 1.5 s; first capture 10.15 s wall / 8.53 s script; contact sheet generation 0.8 s; horizon-hidden discrimination 10.5 s; native game reproduction 10.9 s; environment probe runs 10.6–11.2 s each; final capture 10.63 s wall / 8.97 s script; contact sheet generation 0.8 s. The costly repeat was caused by the fog mode side effect; checking live `fog_density` directly would be the faster first diagnostic next time.
