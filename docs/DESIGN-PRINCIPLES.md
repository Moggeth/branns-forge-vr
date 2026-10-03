# Ability and world design principles

Mitch's answers to the Stonewhisper crystal wall questions (project thread, 2026-10-03), written as rules for every
future ability, spell, gadget and world effect. The crystal wall (`multiplayer/CRYSTAL-WALL-20261003.md`) is the first
feature built to them. When a new feature breaks one of these, say so and why in its record.

## 1. Big abilities can do many jobs

An ability doesn't have to pick one role. The crystal wall covers four at once: it is **cover** (blocks walking and
arrows), an **attack** (its rising front damages and throws enemies), **traversal** (its caster end is a walkable ramp
onto the crest, and the front tosses allies up), and a **resource** (each segment can be mined for stone, and it
leaves shards when it shatters). Every role must come from the same physical thing the player sees, not from extra
hidden rules.

## 2. What you see is what you collide with

When the world changes shape, the solid surface changes at the same moment and at the same speed as the visuals, for
every player. There is no instant collision under a slow animation, and no ground that only looks like it moved. The
terrain moves on the authority's fixed 60 Hz tick (as in the Progressive Sunder spell), and presentation is a pure
function of that tick, so late joiners and migrated hosts see the same moment of the same animation. Things that sit
on the crest (crystals) leave the walkable path clear.

## 3. Preview before commit

Big, world-changing abilities show where they will land while the input is held, and act on release; a quick tap
still works. The preview uses the authority's own planning function, so what it shows is exactly what will happen.
It changes colour and pattern when the ability will not work, and the failure message says why and how to recover.

## 4. Spectacle cleans up after itself

Player-made world changes are temporary unless they are deliberate construction. The crystal wall stands for one
minute, warns in its final three seconds, then shatters and sinks. Each caster keeps at most two walls standing; a
third replaces the oldest rather than failing. Permanence is reserved for things the player builds on purpose
(foundations, bridges, structures).

## 5. Earth looks like earth; magic glows blue

Raised ground uses the world's own soil and rock. Magic shows up as light inside it: the resonance blue of the
Stonewhisper gems, crystal facets and light pooling on the ground. The look is a geode: an earthy crust that cracks
open to show light. Avoid flat, untextured lumps (the old wall's black rocks) and default primitives.

## 6. Built for the standalone Quest browser

The weakest device that must stay smooth is the Quest's standalone browser. So: no added real-time lights, no
post-process bloom, and no sorted transparent solids. Glow comes from emissive surfaces, rim light and additive glow
on the ground. Effects batch into a few instanced draws per cast, use shared pooled particles, and do nothing
per frame once settled. Each feature records its draw and triangle budget, and a low-quality path for touch devices.

## 7. Every big moment has sound and feel

A major ability ships with spatial sound and haptics in the same pass. Sounds fire when the visual moment happens
(not when the packet arrives), so everyone hears the same thing, and nothing stale replays on join. The caster
feels the effect in their controller (VR) or phone (vibration), shaped to the motion, such as a wave rolling away.

## 8. Abilities are built to grow

Ship a strong base version with its tuning in one table (`PICK_WALL` in `shared/terrain.js`), so mastery or upgrades
can later extend reach, height, lifetime, segment count or forms without rewriting the ability. There is no mastery
progression system yet. When one exists, it reads and scales those tables; it never forks the code path.
