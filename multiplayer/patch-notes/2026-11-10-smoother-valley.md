---
date: 2026-11-10 16:29
area: Performance
title: Smoother frames, part two
---
- **Brann's Valley draws faster.** About 45 idle effects (sparks, shards, crumbs, spent bolts, tracers) were each paying the full cost of being drawn every frame, even with nothing to show. They now cost nothing until they're used. In our tests that makes drawing the scene 7–23% faster, depending on where you look.
- The Voltnewts on the Stormspires and the keep Timberlines only animate their limbs and gears while you can see them. Voltnewts more than 40 m away keep going about their business without the fine detail.
- Effects that are winding down no longer re-send all of their data to your graphics card every frame.
> Everything looks exactly the same. This is the second part of the performance pass.
