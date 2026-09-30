# Starfall presentation source-scene check (2026-10-01)

Run from the repository root:

```powershell
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://starfall_presentation_checks.gd --quit-after 1800 -- --world-builder-check
```

The offline fixture loads Main in World Builder check mode. It checks ten cached
crystal meshes for single surfaces, bounded nondegenerate triangles and winding
consistent with normals. It verifies six reusable effect slots, four particle
MultiMeshes, two temporary lights, three shared nearby crystal lights and six
audio voices. Eight simultaneous meteor sources must remain within the slot
budget, emit entry/impact/reveal sound hooks in order, expire cleanly and release
watchers when their source nodes leave the tree. Meteor gems and Crystal Fault
spires must use the authored shared shader material and crystal group, with no
individual lights. A real meteor callback must change the crater height before
returning and expose its matching collider by the next physics frame, while a
pick strike still grants the gem and records a scar.
The extended check also proves that a representative event light follows the
falling meteor head and remains the same light through impact. After the sink
tween, a terrain ray excluding the meteor collider must place the shell's lowest
point within 0.25 m of the crater bed. Reloading its saved record must retain
that seating, one mined gem unit and the visible mining scar.

The check does not render the shaders or judge their appearance in a headset.
After it passes, visual review is still needed for glow, legibility and stereo
comfort. The headless check disables the landscape save and uses no resident
service or VR process.

During development, a Main run hit parse errors in concurrently edited Map UI
functions `_supplies_pages` and `_supplies_detail`. Wait for the owning UI change
to compile before retrying the source-scene fixture. Godot's ArrayMesh front
face is clockwise, so the conventional triangle cross product points opposite
an outward normal. The winding assertion uses that engine convention; an
earlier read-only suspicion based on counterclockwise convention was incorrect.
The direct shape assignment changes the heightfield on contact, while Godot's
physics query broadphase registers the replacement collider on the next physics
frame. The check rejects an old surface in the interim and verifies the new one
after one frame. Godot also suffixes duplicate node names (`Spire2`, etc.), so
the fault assertion counts crystals by group membership in the new fault group.
The first settlement fixture placed its rock beyond the runtime's 52 m near
radius; the visibility manager correctly replaced that live node with a distant
batch during the tween. Keep the source fixture inside the near radius when
checking a live shell. A first expression also treated `global_scale` as a
property rather than using the actual core scale; the corrected check uses the
mesh AABB, core transform and scale. These were fixture errors, not regressions.
