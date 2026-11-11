---
date: 2026-11-11 15:30
area: Performance
title: Smoother frames, part three
---
- **The mine entrances in the Great Wilds are much cheaper to draw.** Each Underways entrance was ten separate pieces (frame, rocks, lanterns, rails, cart and sign). Now it's two. Looking towards the mines costs about 35 fewer draws per frame.
- **Aiming is lighter.** The game checks what you're pointing at ten times a second. It used to test every keep, workshop and ballista on the map. Now it only tests the ones near your line of sight, which saves about 2 ms per check.
- Idle sparks from skeleton hits no longer re-send their data to your graphics card while nothing is flying.
> Everything looks exactly the same. This is the third part of the performance pass.
