# Resource and itemisation audit — 2026-10-01

This is a source audit of the native Hero (FPS/VR), Little Wing, World
Builder and War Director paths. It did not call the running service or alter
player saves. The modes share a live world, but their spendable ledgers are
different.

| Owner | Authoritative balance | Production and spending | Current visibility |
| --- | --- | --- | --- |
| Hero FPS/VR | `service/world.js` player resources in `player.json`: rat tails, lumber, stone, iron, apple, spore, crystal, haunted bone, sky bloom, ember core; forging favours and workshop tier are also there. | Physical resource gathering and enemy drops call `/api/vr/gather`; five tails can earn a favour. Workshop tiers use alternative exact material bundles: tier 2 = 3 tails **or** 3 lumber + 3 stone; tier 3 = 3 iron + 3 haunted bone; tier 4 = 1 ember core. Base recipes are free once tier unlocked. Death drops the carried resource wallet for recovery. See `service/progression.js`, `service/world.js` and `godot/adventure_runtime.gd`. | Forge summary names the next tier's options and current/required counts (`godot/progression_ui.gd`). Hero status lists only positive resources; the wrist detail truncates the list to four (`godot/qol_runtime.gd:258-269`). |
| World Builder | `world_builder_v1.json` keeps Mana, settlement `wood`, star gems, star iron and recovered Ent seeds. These are **not** Hero lumber, ordinary crystals or service resources. | Mana starts at 12, caps at 20 and regenerates at 0.055/s (or selected 4× preset). Helpers deliver timber to the stockpile; harvested physical logs and fallen Ents can credit it. Starfall costs 8 Mana and mined meteorites yield star gems or iron. Crystal Fault spends 2 gems + 2 Mana; Earthen Wall uses 2 star iron if available, otherwise 4 Mana. Constructions spend stockpile lumber, with length-based exact cost; helpers cost 2. See `godot/world_builder_runtime.gd`, `world_builder_construction.gd`, `world_builder_ents.gd`. | Mana orb, selected cost and cooldown, lumber/helper strip, 3D status gems/iron and placement previews exist (`world_builder_view.gd`, `world_builder_command_panel.gd`). There is no one-place account of why Hero lumber cannot build a bridge. |
| Little Wing | Fairy-local 18 health; no monetary wallet or shared ammunition. | Dart, dust ping and Faelight reveal use timers (0.4 s, 0.45 s and 5 s) and capped live projectiles; carrying a physical matchbox/match uses actual shared-world props. Health recovers on local respawn. See `godot/fairy_coop.gd`. | Fairy HUD shows health, flight/camera mode and selected ping. Timer readiness and carried item are conveyed mainly by action/notice, not continuously (`fairy_coop.gd:646-650`). |
| War Director | Round-local Sparks, separate from World Builder Mana; local view and service director each start at 8, cap at 10 and regenerate at 0.55/s. | Bone Patrol 3, Wisps 2, Golem 5, Dusk Veil 4 Sparks; each has an independent 5/4/9/18 s cooldown. Native local view also checks a nine-enemy live limit. See `godot/director_local_view.gd` and `service/director.js`. | Native view shows Sparks and each card's cost/recharge, but disables a card for phase, insufficient Sparks or cooldown without putting the precise reason on the disabled button. The service web director provides a specific `cardStatus` reason/tooltip (`service/public/director/ui.js`). |

Equipment and supply distinctions:

- Hero's built-in tool access is the hand menu Tools page and desktop number keys; commissioned inventions are a separate Inventions page, filtered to imported items, with an explicit Equip action (`godot/qol_runtime.gd`, `godot/main.gd`). Service context `equipped` is a transient held-item report; ownership lives in `player.tools`/deliveries (`service/world.js:44,74`). A guide should say **owned**, **ready**, **held/equipped**, and **recharging** separately.
- Siegebird bolts and Emberwing arrows are unlimited. Siegebird still uses physical bolt tokens and loaded-chamber state; `service/supplies.js` retains legacy `available=6`, `MAX_STOCK`, and a free `buy` action for compatibility, while its snapshot explicitly returns `infinite: true` and `price: {}`. Native rack/belt and control hints already say free or unlimited (`godot/siegebird_extras.gd`, `item_control_hints.gd`, `phoenix_bow.gd`). Do not expose `available=6` as remaining ammo or imply iron buys bolts. The token ledger can fill at 240 outstanding physical tokens, which is a bookkeeping limit, not a consumable stock.
- Firecraft's common matches and vials replenish without a Hero-wallet cost, but an ignited match/vial wick lasts about ten seconds (`service/world.js:78`). This is a duration, not an ammo price.
- Workshop material pieces use the same Hero ledger. `material-take` debits the pouch and creates a durable loose token; `donate` reserves that token in a bucket; `withdraw` makes it loose again; `material-return` credits it to the pouch; the lever consumes the exact reserved set (`service/workshop-ledger.js`). Pouch, bucket, loose and held are locations for one resource, not balances to add. The service snapshot exposes token locations, bucket counts, material uses and module costs.

Bounded fixes for the shared guide and adjacent UI:

1. Label balances by owner: **Hero pouch / Brann workshop**, **Orchard settlement**, **Little Wing**, **Director round**. Present Hero lumber and settlement lumber as separate lines with a plain sentence explaining the boundary. Preserve the existing save authorities; a UI guide should not combine ledgers.
2. Show all ten Hero pouch resource counts, including zero, in an expandable Supplies/Map view. Show reserved, loose and held workshop pieces separately with a same-ledger explanation. Display tier progress as `pouch + bucket / required`; only a fully filled selected bucket is ready for the lever. The four-entry wrist truncation should lead to that full view.
3. In World Builder, show the current Mana, lumber, gems, iron and seeds together, plus the actual placement cost and the first blocking reason (unimplemented, cooldown, insufficient currency, invalid ground/geometry). The exact bridge/ramp/stairs/boardwalk cost must come from `world_builder_construction.gd` plan, not just catalogue minimums. Clarify Earthen Wall's star-iron-first choice.
4. In the native Director view, give disabled cards a visible reason such as “Round not started,” “Need 1.2 Sparks,” “Recharge 3.4 s,” or “Field at capacity.” The browser director already computes equivalent reasons.
5. Describe Little Wing's darts, dust and reveal as free timed actions, with a visible reveal countdown and carried-item name when practical. Label Siegebird/Emberwing as unlimited supply with physical reload/draw steps. Retire any UI label that uses legacy `supplies.available` as a finite ammo count.

The repeated wildcard-path inspection attempt failed because PowerShell passed
`godot/little_wing*`, `godot/director*` and `service/director*.js` as literal
paths to `rg`. The verified fast path is `rg --files <folder> | rg '<name>'`,
then open exact returned files. The source mapping required no service call.

## Native guide adapter

`godot/resource_guide.gd` provides `ResourceGuide.build(game) -> Dictionary`
for the new Map/Supplies overlay. It returns `equipment_line`, `wallets`,
`items` and `costs`. Each wallet has `title`, `description` and `rows`; rows
have `name`, `amount`, `purpose`. Items have `name`, `state`, `description`;
costs have `name`, `cost`, `state`, `description`. It samples live state when
called, makes no service requests, and does not cache or mutate balances.
Call it when opening or refreshing the overlay, at no more than 5 Hz. Hero
counts display `—` while the forge service is offline; Orchard balances
remain readable from their local save. World Builder statuses call the actual
spell availability method, with placement-dependent costs explicitly marked.
The equipment line uses the installed `item_control_hints.gd` binding. Item
rows include built-in tools, delivered inventions, real collection homes,
Siegebird, Emberwing, Hearthlight, Emberdew matches/vials and the skull quest
basket when those native objects exist. This captures generated Wyrm Spout
versions and Sunfall without a guessed fixed inventory. Material descriptions
and module prices use the live service workshop catalogue. Native Director
statuses include round phase, card cooldown, Sparks and field count.

`resource_guide_checks.gd` uses an offline full native scene and synthetic
service snapshot. It verifies separate Hero/settlement lumber and crystals,
zero-inclusive Hero counts, reserved/loose/held workshop tokens, fully filled
bucket readiness, module and spell tier/cooldown reasons, locked actions,
held Stonewhisper controls, native collection and generated items, common
goods, offline balance handling, fairy timer, Director Sparks and unlimited
ammunition wording. Final result:
`RESOURCE_GUIDE_RESULT {"failures":[],"wallets":4,"items":22,"costs":35}`
in 8.2 seconds. One repeat emitted Godot's two-instance ObjectDB teardown
warning after the named result; an 8.4-second verbose repeat was clean. No
script or engine errors remained. An earlier 8.3-second run reported six engine formatting
errors despite an empty result array: Godot's `%` formatter does not support
`%g`. Use `%.2f` or `String.num` and require no `ERROR:`/`SCRIPT ERROR`
alongside the named empty result. A corrected run passed in 9.5 seconds.
