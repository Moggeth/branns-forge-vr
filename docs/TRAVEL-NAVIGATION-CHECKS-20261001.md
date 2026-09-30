# Travel and Map scene check (2026-10-01)

Run from the repository root:

```powershell
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://travel_navigation_checks.gd --quit-after 1800 -- --world-builder-check
```

The fixture loads the actual offline Main scene. It checks World Builder's
initial asynchronous Orchard arrival, F selection and its HUD label, G travel,
direct Map selection before travel, and G from Map. While Map is open it verifies
that the Hero's locomotion update is gated, melee is cancelled, bow drawing is
cancelled/blocked, and Wyrmspout's trigger is blocked. It then raises the
Orchard's arrival after startup and uses ordinary travel to return to a current,
supported, clear landing. A destination without any floor must leave zone and
pose unchanged. Finally, a narrow obstacle at a simulated room-scale HMD offset
must reject movement even when the rig-centred capsule would fit.

The co-op modal extension uses hidden synthetic Fairy and RTS windows. Fairy's
own Map must consume Fairy input without stopping Hero locomotion or cancelling
a Hero draw/swing/bow ability. A strategic RTS Map likewise must leave Hero
ability alone; a Hero-primary RTS Map must cancel and block Hero combat. The
fixture checks that Main's own M still opens a Hero-owned modal, and that freeing
either secondary window removes its view from the navigation registry.

This fixture uses `--world-builder-check`, which disables the landscape save and
normal external service path. It never changes resident saves or processes. A
headset pass remains needed to establish actual room-scale comfort and map
legibility in the headset. The initial startup assertion checks the asynchronous
normal path on a clean offline Orchard; the raised-ground assertion exercises the
same travel path after the scene is ready, since injecting a saved deformation
before Main's `_ready()` would touch resident save state.

Failed strategy learning: a first draft inferred `before` from a dynamic Main
property, which Godot 4.7 refused to parse; type local vectors explicitly in
scene fixtures. A synthetic held W `Input.parse_input_event` did not update
`Input.is_physical_key_pressed()` in the headless runner. To prove Map blocks the
locomotion call, place the rig above ground, call `_desktop_input`, and assert
that gravity did not advance it. The target HUD is updated on a 0.2-second
throttle, so force the scheduled refresh before inspecting its text in a
deterministic fixture.
The first co-op check incorrectly expected the whole view registry to be empty
after a secondary window was freed; the already-closed Main view remains cached.
The corrected check tests removal by the freed window's instance ID. In the
headless fixture, an off-ground Hero advances under `_desktop_input` while the
synthetic Fairy Map is open, directly proving the scoped gate allows Hero motion.
