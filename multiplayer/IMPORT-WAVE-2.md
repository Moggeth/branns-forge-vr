# Browser import wave 2 — combat and world magic (2026-10-03 Sydney)

Native gameplay remains intact. This wave brings the authored weapon vocabulary and a connected combat/spell loop into the eight-player browser preview.

## Play

Hero: 1 Orchard's Edge, 2 Stonewhisper, 3 Sunfall Sledge, 4 Siegebird, 5 Emberwing, 6 held bone. Click to swing/shoot; hold/release to draw Emberwing. While drawing, Q/right mouse locks the initial direction; rotate to shape the curve, release to fire. Q activates axe/pick/hammer specials. F grabs a loose bone, G drops, X throws. E collects/eats and B builds a three-wood bridge. Touch exposes equipment, Actions and Special plus held Attack. Menu contains the complete mappings.

VR: physical melee tip sweeps; right trigger shoots or holds/releases a drawn arrow, left trigger locks bow curve. Left grip cycles weapons, right grip grabs/drops or collects, right trigger throws a held bone. A/X jumps, right-stick click builds, B/Y exits to Menu. Bow draw strength uses hand separation. Physical headset acceptance remains pending; controller integration is not a claim of headset comfort.

God: fourteen spells: Skeleton, Skeleton Squad, Stone Golem, Raise Earth, Lower Earth, Sunder, Stone Wall, Grove, Tree Ring, Starfall, Crystal Bloom, Healing Rain, Lightning and Frost Nova. The spellbook labels all keyboard shortcuts/costs. Quick cast casts points on key-down and completes lines on key-up. Normal desktop lines drag; touch Cast sets start then end. Cancel clears unfinished lines. All use authoritative world operations and shared events. Healing/frost/lightning have gameplay effects, not just visuals.

## What changed

- Native authored crossbow, bow, arrow, wing, hammer and golem GLBs, with explicit axis/grip/socket adapters and source hashes in public/assets/import-combat.json.
- Actual animated triangles determine projectile contact, including empty bone gaps; the host validates swept paths and anatomical bounds. Skull shots kill skeletons; body shots take multiple hits. Three pick strikes strip golem armour, exposing its core. Rendered part masks reflect structural loss.
- Arrows retain bone-local position/orientation and follow animation; death transfers embeds to baked detached parts. Full leg geometry/bounds includes feet. Bones can be grabbed, dropped, thrown and used as weapons.
- Fixed 60 Hz flight with 20 Hz snapshots; capped 50 ms visual flight extrapolation and held-part interpolation. Posed collision geometry cached once per frame.
- Sonnet 5.5 authored fourteen distinct reticles/spell effects (512 pooled particles, 32 event groups), then a directional material-impact kit (160 chips, 96 sparks, 96 dust; three instanced draws). Ground-relative debris, restrained soft dust, no expanding hit sphere. Exact event contact normals/materials feed the kit, without duplicate enemy embed bursts.
- Opus 5.5 authored compact equipment/spell controls, scrollable at narrow widths, touch Special accessible during Attack, keyboard-operable spell radio group.
- Reset correctly replaces an actor's model when an ID is reused for a different enemy type; Cancel resets line casting; repeated body shots no longer leave enemies immortal at one HP.

## Acceptance and limits

Node suites: combat, session authority/guest rejection, native GLB contacts, full detached leg, local embed pose, save/load, input cancellation, fourteen spells, deterministic bounded VFX, orientation/motion and existing harvest/build/save tests pass. Production build passes; single JS chunk remains about 851 kB / 235 kB gzip (warning retained).

Actual browser fixture tests/combat-playtest.html: Emberwing skull contact kills and produces six parts; forearm contact embeds on LeftArm and leaves 62 HP; crossbow gap misses skeleton and embeds in ground; headshot → grab → throw keeps embed; three actual golem pick contacts reduce armour 3 to 0. Fourteen-spell gallery rendered without runtime errors. Expanded mobile fixture passed 19 synthetic real-input checks in 4.523 s, including bow hold/curve/release/cancel and line cancellation. Portrait 360x640 and landscape 640x360 inspected. These are browser/synthetic checks, not physical phone/headset acceptance.

CPU stress: 8 heroes, 64 enemies, 96 arrows p95 1.782 ms, max 2.493 ms on this machine, including snapshot JSON; excludes GPU/network. Snapshot ~139 kB internally, ~47.6 kB to peers after stripping host-only flight history. 32 actors ×64 native mesh rays took 0.741 s as a batch; caching reduced the earlier equivalent 8.326 s batch to 0.790 s. These are not FPS benchmarks.

Detached limbs are rigid pieces with springy holding, not articulated knee/ankle ragdolls. Late join may reconstruct a detached piece from the rest pose; current clients preserve the live pose. Spell deaths may use fallback limb poses. Resources remain collected pickups, not fully grabbable physics items. Curved arrows have a brief weapon firing cadence, not yet a separate diegetic special recharge. Full native fire/liquid, quiver retrieval, grappling cable and planet remain future import work.

Hosting is still Vercel static assets plus PC-hosted signaling through the existing temporary tunnel, with WebRTC and no configured TURN. Separate-household connectivity is not established by two same-machine clients.

## Artist provenance / lessons

All three commissions verified personal fauxgrady@gmail.com, claude.ai Pro, cleaned child environment and exact canonical model. No API billing or extra usage.
- Sonnet claude-sonnet-5-5 spell kit: 585.550 s successful medium-effort write-first commission, following two 600 s high-effort timeouts (excess exploration/prolonged reasoning). Do not repeat the broad high-effort strategy.
- Opus claude-opus-5-5 HUD: 120.899 s; integrated, corrected Raise Earth label, mobile width and keyboard semantics.
- Sonnet claude-sonnet-5-5 impact kit: 136.370 s; integrated exact material/normal events, tested deterministic pools/expiry/disposal and actual golem scene.

Source/metadata retained under work/sonnet-browser-spells-20261002, work/opus-browser-combat-hud-20261002, work/sonnet-browser-impact-kit-20261002 (ignored commission logs); accepted implementation is tracked in client/. Timings logs/work-timing.csv. Local fixture only needs npm run dev, and mobile fixture additionally needs the peer service. Stop only the owned Vite process, never the user's peer/tunnel.
