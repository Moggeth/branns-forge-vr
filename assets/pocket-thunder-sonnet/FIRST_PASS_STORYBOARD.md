# Pocket Thunder blast storyboard (duration 0.75 s default; all times scale by duration/0.75)
Captured frames: previews_godot/ (60 fps, harness in godot/preview_harness).

| t (ms) | Beat | Visual | Light |
|---|---|---|---|
| -fuse | Fuse | Heart pulse speeds 6.2 -> 22 rad/s, amplitude 3.5% -> 9.5% via `update_fuse` | heart emission +50% |
| 0 | explosion() called | Bomb model hidden by gameplay; amber core glow appears at heart size | light 0 -> 0.35 |
| 0-60 | SNAP (anticipation) | Core inhales 0.9 -> 0.32 scale, alpha 0.3 -> 0.8; audio tick | ramp |
| 60 | POP | Core bursts outward (0.5 -> 1.5x, fades by 260 ms, alpha <= 0.5); 14 chips + 40 sparks + 20 embers launch, directionally biased by velocity | jump to 2.6 (amber ffb066, not white) |
| 60-200 | Shock | Floor runic disc leads (crisp rim, rune notches), fresnel dome to 0.85 R by 440 ms | exp decay k=6.5 (half-life ~110 ms) |
| 100-400 | Burst | Sparks are velocity-aligned streaks with drag; chips tumble, glow cools amber->dark by 900 ms | < 0.3 by 360 ms |
| 200-600 | Wash | Disc reaches R at 610 ms and fades; smoke puffs start at 140 ms with warm underlight | light released (<0.02) ~ 600 ms |
| 600-1400 | Settle | Chips ground at raycast floor and stop spinning; sparks gone by 810 ms | none |
| 1000-2000 | Embers/smoke | Embers drift and flicker up to 1.9x duration, smoke dissolves by 1.7x | none |
| 1950 | Recycle | Rig hidden, light returned to pool | |
