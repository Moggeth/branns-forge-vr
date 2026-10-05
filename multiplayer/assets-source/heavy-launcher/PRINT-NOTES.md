# Heavy Launcher: print notes

This is the same model as the in-game Heavy Launcher, at 1:16 scale (about 18 cm long). It's a working catapult made entirely of printed parts. There are no screws, bands, metal springs or glue. Two printed spiral mainsprings drive the arm.

Files are in `print/`, already oriented for printing, in millimetres.

| Part | File | Qty | Approx. PLA | Notes |
|---|---|---|---|---|
| Base (frame, cheeks, trigger leaf, buffer) | `heavy-launcher-base.stl` | 1 | 130 g | Prints upright. Needs a 96 × 182 mm bed. |
| Throwing arm | `heavy-launcher-arm.stl` | 1 | 32 g | Flat underside down. |
| Cocking lever (yoke) | `heavy-launcher-yoke.stl` | 1 | 16 g | Lies flat in its own swing plane. |
| Right spring drum | `heavy-launcher-spring-right.stl` | 1 | 18 g | Outer face down, pegs up. |
| Left spring drum | `heavy-launcher-spring-left.stl` | 1 | 18 g | Mirror of the right drum. |
| Axle | `heavy-launcher-axle.stl` | 1 | 5 g | Flat side down. |
| Stone | `heavy-launcher-stone.stl` | 3+ | 4 g each | Flat spot down. |

## Settings (PLA)

- **Material:** PLA, 0.4 mm nozzle, 0.2 mm layers. No supports anywhere: holes are teardrop-shaped and every overhang is 45° or less.
- **Spring drums:** 5 walls and 100% infill, so the 1.8 mm spring strip is solid wall lines. Print slowly (about 40 mm/s) and add a 5 mm brim, because the coils are tall, thin walls. Leave the 1.6 mm gaps between coils clean, and snip off any strings.
- **Axle:** 100% infill.
- **Base:** 4 walls, 20% infill. The trigger leaf (1.5 mm) and the buffer arch come out as solid walls.
- **Arm and lever:** 4 walls, 25% infill.
- **Stones:** 100% infill. Heavier stones fly further.
- **Fits:** sliding fits have 0.15 mm clearance per side. If the axle binds, scrape the bores lightly. Don't force it: PLA cracks before it bends.

## Assembly

1. **Arm into the lever.** Hold the cocking lever with its finger bar on top. Push the arm up into it from underneath, hub first, so the hub sits between the lever's two side plates. The cup sticks out past the finger bar, and the bar rests on top of the arm.
2. **Into the frame.** Lower the arm and lever together between the two cheeks. The lever's handle points to the front and rests on the small pointed arch (the buffer). The arm leans back with its tip up, touching the finger bar.
3. **Left drum and axle.** Slide the axle through the left spring drum from the outside, with the gem head outside. The axle's flat must line up with the flat in the drum's hub. Push the axle through the left cheek, the lever, the arm (turn the arm slightly until its flat lines up) and the right cheek.
4. **Set the power.** Before seating each drum, turn its outer ring against the spring by three holes on the power dial, then push the two pegs in. The pegs click into the holes. Do the same on both sides.
5. **Right drum.** Slide the right drum onto the end of the axle, setting the power the same way. Press until the split end of the axle snaps out past the hub.

To take it apart, pinch the axle's split end together and push the axle out.

## Using it

1. **Cock:** hold the base down and lift the lever's front handle. The finger bar presses the arm down until its steel-coloured nose clicks under the trigger leaf at the back. Let go of the handle and it drops back onto the buffer.
2. **Load** a stone into the cup.
3. **Loose:** push the trigger tab (the upright tab at the back right) outward, away from the arm. The arm whips up, hits the finger bar, and the stone leaves at about 40°.

**Keep faces, eyes and pets out of the throwing line.** At the default power, a solid stone leaves at roughly 7 m/s and lands several metres away.

## Power dial

Each hole on the dial is a 30° step. Use the same setting on both drums.

| Holes of preload | Stored energy | Peak spring strain | Lift on the handle | Trigger holds |
|---|---|---|---|---|
| 1 | 0.26 J | 0.61% | 3.9 N | 2.3 N |
| 2 | 0.37 J | 0.77% | 4.9 N | 3.0 N |
| **3 (default)** | **0.48 J** | **0.93%** | **5.9 N** | **3.6 N** |
| 4 | 0.58 J | 1.09% | 6.9 N | 4.2 N |
| 5 | 0.69 J | 1.25% | 7.9 N | 4.8 N |

These numbers are calculated from the model: E = 3.5 GPa, two 1.8 × 12 mm spiral strips, each 295 mm long. I haven't measured them on a printed launcher yet. PLA takes about 1% strain repeatedly but creeps under steady load, so hole 4 is the sensible maximum, and hole 5 is for occasional showing off.

## Looking after PLA springs

- **Don't leave it cocked.** Cock it, load it and loose it. Leaving it latched for hours slowly sets the springs, and it gets weaker.
- **Relax it for storage.** When you put it away, pull each drum's pegs out and let the ring unwind to zero, or leave it at hole 1. Even uncocked, the preload presses the lever onto the buffer arch.
- **Keep it cool.** PLA springs lose strength in a hot car or a sunny window (over about 45 °C).
- If a spring takes a set and the arm feels weak, move the drum one more hole tighter.

## Rebuilding

The files come from `build_heavy_launcher.py` (Blender 4.5+ `bpy`): `python3 build_heavy_launcher.py [--render]`. The same run exports the game model (`public/assets/heavy_launcher.glb`), the print STLs and `out/build_report.json`. That report has a collision sweep through cocking, latching and loosing, manifold and volume checks for every printed part, and the spring numbers above. If any parts collide or a solid is broken, the build stops and nothing is written.
