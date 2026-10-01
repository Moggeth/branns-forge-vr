# Handoff: strata/fissure recolour (mining_visual_art.gd)

Only the shared material parameter dictionaries in the material builder were edited. APIs, meshes, vertex colours and budgets are unchanged.

## `fissure` / `fissure_hot` (shared)
- `base_color`: `Color.WHITE` -> `Color(0.36, 0.36, 0.38)`. This tints the warm vertex-colour lip to dull charcoal.
- `fresh_color`: `Color(0.7, 0.4, 0.22)` -> `Color(0.42, 0.44, 0.46)` (exposed grey mineral).
- `rough`: 0.95 -> 0.97. `fresh_rough`: 0.8 -> 0.88.
- `grain_amount`: 0.3 -> 0.4, for a more ragged crust.
- Added a restrained cyan glint: `sheen_color` `(0.2, 0.7, 0.85)`, `sheen_amount` 0.08, `sheen_power` 5.0.
- `fissure_hot` still merges its orange emissive; that is untouched.

## `strata`
- `base_color`: `(0.38, 0.30, 0.24)` -> `(0.11, 0.11, 0.125)` (charcoal).
- `band_color`: `(0.74, 0.50, 0.28)` gold -> `(0.36, 0.38, 0.40)` grey. `band_amount`: 0.6 -> 0.55.
- `fresh_color`: `(0.60, 0.47, 0.34)` -> `(0.50, 0.52, 0.54)`.
- `fresh_band_color`: `(0.38, 0.27, 0.18)` -> `(0.20, 0.22, 0.24)`.
- `rough`: 0.9 -> 0.96. `fresh_rough`: 0.75 -> 0.85.
- Added `grain_amount` 0.4.
- Added a cyan glint: `sheen_color` `(0.2, 0.75, 0.9)`, `sheen_amount` 0.1, `sheen_power` 5.0.
- `vcol_mix`, `band_scale`, `fresh_band_amount` and `grain_scale` are unchanged.

## Verification
- Godot 4.7.2 headless `--check-only --script res://mining_visual_art.gd` reported no errors.
- No render capture was done (time cap), so the visual result still needs a look.
- `_LIP`, `_CREST`, `_SKIRT` and `_FLOOR` vertex colours were not touched. If the lip still reads warm in renders, lower `_LIP` saturation next.
