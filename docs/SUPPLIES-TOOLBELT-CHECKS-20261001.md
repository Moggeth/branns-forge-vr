# Supplies toolbelt offline check — 2026-10-01

`godot/supplies_toolbelt_checks.gd` instantiates the actual Main scene with `--world-builder-check`. The fixture confirms offline Orchard mode, opens the default Quick page with Tab, and follows the Supplies tab through every wallet, equipment and action page. It compares every selected row against the shared ResourceGuide snapshot, including exact costs, restriction states and descriptions. It checks eight-row pagination, next/previous wrap, separate Hero and settlement ledgers, and read-only behavior across all menu actions. A live stockpile change must refresh its label and detail while preserving the selection body's and collision shape's instance IDs. The check also tests the left-hand B binding and local detail/button bounds where Godot exposes a text AABB.

Run from the repository root:

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://supplies_toolbelt_checks.gd -- --world-builder-check
```

The first complete run visited 13 pages and 74 rows. It found one source gap: Pocket Thunder had an empty Guide description, so its Supplies detail stated only `Owned`. The shared Guide owner supplied the missing physical controls; the final fixture reports `SUPPLIES_TOOLBELT_RESULT {"failures":[],"pages":13,"rows":74}`. The fixture treats a missing description as a failure even when `String.contains("")` would trivially pass; this guards future native items.

Measured steps (seconds, command wall time): discovery 1.5; first native check 9.91; name-specific diagnosis 9.14; empty-description assertion 9.47; live-label/pointer-collider extension 8.65; final native check after Guide repair 8.27. These runs used `--xr-mode off`, avoiding OpenXR allocation and any live save or service.
