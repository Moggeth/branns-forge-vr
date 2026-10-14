# Sunthread, the Radiant staff (2026-10-10)

The first piece of the "Radiant" direction: a pearl-white enamel staff wound with a glowing gold sun-thread, a
sky-blue leather grip, and a crown of two gold lyre blades cradling a sun-ray halo around a faceted sun crystal.
Built to light the world around it, not just itself.

Visual fidelity target: level 3 for the held model and its effects (fine detail, extra layers, reduced-motion
variant, one shared light). Checked in a desktop browser only; phone and headset are not checked yet.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy
python3.11 build_radiant_staff.py -- --out ../../public/assets/staff.glb
python3.11 build_radiant_staff.py -- --render out/review          # review renders (out/review is ignored)
```

The build asserts the triangle budget (under 8,000; currently about 5,600) and the runtime nodes below.

## Look bench

`bench/index.html` drops the real model and effects into a plain lit yard, with no game around them, which makes
the light, beam and nova quick to judge. From `multiplayer/`, run `python3 -m http.server 5199`, then open
`http://127.0.0.1:5199/assets-source/radiant-staff/bench/?mode=beam&night=1&foe=1`
(`mode` is held, beam or nova).

## Runtime contract

glTF frame is -Z forward, +Y up, metres, with `GripAnchor` at the origin (the centre of the hand).

- `Crown`: the head. Glow sprites, the star-flare and orbiting motes are added under it at runtime.
- `SunCore`: the faceted sun crystal. It spins and bobs.
- `Halo`: the ring of sun-blades behind the crystal.
- `BeamOrigin`: where the sun-thread leaves the crown.
- `Foot`: the gold ferrule and its sunstone.

Materials are named for client/radiant-staff.js, which patches the shared template once:
`Sunstone`, `HaloGlow`, `ThreadGlow` and `Skystone` breathe and swell with charge, and `Enamel` gets a pearl
sheen. Everything else (the single shared point light, the ground light pools, the beam, sparks and the
Radiant Nova) is runtime presentation in that file.
