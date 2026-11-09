---
date: 2026-11-07 20:24
area: Performance
title: Smoother frames everywhere
---
- **Higher, steadier frame rates.** On a fast desktop, Brann's Valley now runs about 40% faster and the Great Wilds about 20% faster, with the slowest frames (the stutters you actually feel) around 50% better in both. On phone-sized screens the Great Wilds runs about 70% faster. With vsync on at 120 Hz, the Great Wilds no longer stutters at all in our test runs.
- **The interface stopped slowing the game down.** The health bar, touch controls and other HUD pieces were rewriting themselves every frame even when nothing had changed, which made the whole page recalculate its layout. Now they only update when something actually changes.
- **Fewer lights doing the same work.** Keep hearts, fires, lanterns, the phoenix and your staff still glow exactly as before, but the game now only spends effort on the few lights near you that you can actually see. Lights fade in and out gently as you move, so nothing pops.
- **No more freeze the first time something new appears.** Meeting a Voltnewt, a new crystal or a fresh weapon trim for the first time used to stall the whole game for a moment while it got ready to draw. Now everything else keeps moving and the new thing appears a few frames later instead.
- Glowing and see-through effects (spell trails, mist, magic) cost about half as much to draw.
- Glowing buttons (unspent talent points, a ready healing draught) now pulse without redrawing the page.
- Trees no longer re-measure the ground under them on every world update.
> More to come: this is the first part of a bigger performance pass.
