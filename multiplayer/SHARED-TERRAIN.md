# Shared terrain, weapon specials and scoreboard

`shared/terrain.js` is the sole numerical world-height contract. Rendering,
client prediction and authority must import it. `terrainHeight(state,x,z,false)`
excludes bridge decks for ground meshes; default `true` includes walkable decks.
`moveOnTerrain(state,position,dx,dz,radius=.28)` mutates X/Z for one fixed step,
sliding along slopes. Normal gravity/floor resolution follows it.

Mountains begin at `max(abs(x),abs(z))=46`, rise via smoothstep to a modulated
11–17 metre crest at 55, and protect their outer faces from excavation. The
normal ground slope stops walking before the rim; a radius-aware inner bound
at 50 prevents jumping or raised terrain bypassing the mountain. Restored old
heroes outside the rim are brought inside on their first step and can walk
inward. Enemy collision uses the same boundary.

Ordinary earth deformation is clamped to +/-6 metres above the immutable base.
Axe scars have a separate cumulative +/-0.65 metre bound. Adjacent pick-wall
kernels combine using their maximum rather than stacking heights; final total
deformation remains bounded. Pickups follow edited ground immediately, actors
rise out of new ground immediately and descend under existing gravity.
Trees/ore use the shared height at their X/Z; rendering must rebuild/reanchor
when the edit list changes, including removals.

## Special contracts

- Axe: six shallow `axe_sunder` edits (`radius:1.35,height:-.12`) at forward
  distances 1.2, 2.5, 3.8, 5.1, 6.4, 7.7 metres from the original position.
  Three ordinary mineable stone deposits appear at alternating points.
  Enemies in that footprint take 55 damage before armour and are knocked
  forward 1.1 metres if alive.
- Pick: seven `pick_wall` edits (`radius:1,height:2.4`) follow forward distance
  `.9+.8*i` and right offset `.075*i*i`. Each has a stone deposit with
  `special:'pick_wall',editId:<linked edit id>`. Three precise pick hits deplete
  the deposit, remove its linked terrain, and emit one normal two-stone pickup.
  Other wall segments remain. The curved footprint deals 65 damage before armour.
- Both use the existing 240-tick cooldown. All prospective edits/deposits and
  pending meteor reservations are checked before IDs, cooldown or damage change.
  Casts outside the inner 46 metre bowl reject. Capacity rejection is permanent
  until capacity becomes available; depleted deposit tombstones are retained.

Presentation events retain `kind:'axe_cleave'` or `'pick_burst'` and include
`weapon,tick,id,position,direction,path,editIds,depositIds`. `position` is the
original grounded player position. `path` is an array of world [x,y,z] points
after terrain changes; clients can animate a bowling wave along it. Damage
and terrain changes are immediate authoritative effects, not a delayed projectile.
Snapshots alone reconstruct persistent results for late join and host migration.

Checkpoint validation accepts only the fixed new edit profiles and one-to-one
wall/deposit links. Active walls without a mineable deposit, mismatched X/Z,
duplicate links and depleted deposits whose wall remains are rejected.
Unknown edit/stat fields are discarded. Removed wall edit IDs remain reserved
by their deposit tombstone, even after importing a checkpoint with a low counter.

Player `stats` contain `kills,deaths,harvested,contribution`. Contribution means
actual credited enemy HP damage, capped by remaining HP after armour reduction.
Kills credit the finishing direct strike, projectile, thrown limb, axe/pick/
hammer special or direct lightning spell. Hero death increments on respawn.
Environmental/fire damage and delayed meteor damage currently have no owner
attribution. Harvested is the supplies-collection count maintained by resource
collection. Legacy saves initialize zeros. Every number is capped at one billion.

## Verification and lessons (2026-10-03)

Run `node multiplayer/tests/terrain-specials.mjs` for geometry bounds, atomic
capacity/meteor reservation failures, replay duplicates, saved wall linkage,
mining collapse, old-save rim recovery, slope collision and kill attribution.
It also verifies identical authority results after JSON checkpoint migration.

Passing related suites: simulation, combat, combat-session, enemy-behaviour,
fire, forge, world-saves, meteor-resources, starting-world and state-codec.
This establishes deterministic gameplay; root integration must still verify
actual rendered geometry, client prediction, phone controls and presentation.

The expedition restock assertion initially failed at `expedition-persistence.mjs:21`.
Review confirmed a stale fixture: the new sanctuary cache already supplies four
loose stone and restock correctly counts it, while the test required four more
units in fresh boulders. Exhaust loose stone in the tests specifically targeting
mineable-restock behavior; a separate case verifies intact caches prevent
redundant restocking. All expedition persistence tests now pass (0.014 seconds).
No adventure implementation change was required.

A contact review found a bridge/ore discrepancy: rendering anchors deposits to
bare earth, while mining previously tested against any bridge deck above it.
Ore validation now explicitly excludes decks. A focused test hits the actual
1.2 metre raised tip of normal and wall deposits beneath a five metre deck.
After terrain edits, stored pickup heights also follow visible bare earth.

The ground renderer keeps its existing 0.75 metre cells. Public terrainHeight
now interpolates the exact matching triangle with Float32 vertex heights;
rawTerrainHeight is the analytical authoring field sampled only at vertices.
Thus physics/anchors match visible support, including narrow walls. See
assets-source/weapon-mastery/INTEGRATION.md for the 220-ray proof and timings. Artist crystals taller than two metres above their terrain anchor
would exceed the current mining surface envelope and require a shared contract
update. The currently imported 1.2 metre boulder surface fits this envelope.
Legacy clients running an older simulation cannot load the new edit kinds;
all peers should refresh to the same release before hosting/migrating a room.
Legacy saved worlds load into this release with zero-initialized statistics.

Test authoring lessons: normalize trigonometric signed zero in wire event
directions (`-Math.sin(0)` is `-0`, JSON restores `0`) before deep comparisons.
Use `rg --files multiplayer | rg terrain` for discovery: the existing renderer
field is `client/terrain-deformation-field.js`, not `terrain-field.js`.

Measured work: implementation and verification interval 10:11:30.596–10:18:20.710
Australia/Sydney, 410.114 seconds. Shared regression command batch 1.873 seconds
(including the documented expedition failure); additional capacity/recovery/
resource/state-codec batch 0.560 seconds. Focused special suite 0.022 seconds.
Enemy worst-population simulation measured 1.479 ms/tick on this machine.

Independent review/fix/test work measured 160.739 seconds; expanded terrain suite 0.025 seconds.

God Sunder now has authoritative progressive deformation; see [PROGRESSIVE-SUNDER.md](PROGRESSIVE-SUNDER.md) for its tick/save/renderer contract and spatial marker integration. Axe weapon-special scars retain the immediate behaviour documented above.
