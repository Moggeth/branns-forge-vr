# What deserves to become the browser game?

Decision date: 2026-10-02. This is a migration recommendation, not an instruction to delete native work.
No further gameplay or asset bulk import was performed during this audit.

## The game I would keep

One beautiful, legible Orchard. Up to eight friends inhabit the same persistent room as Heroes or Gods.
Gods grow resources, alter routes and create readable challenges. Heroes fight, harvest, build crossings
and recover useful loot. Destruction creates new opportunities rather than only deleting progress.

The first complete loop should be: **God calls Starfall → Hero dodges → mines the meteor → uses the
material to improve the shared world → God creates the next challenge.** Alongside it: grow trees,
cut them properly, carry logs, build a crossing. Skeleton fights provide the physical comedy.

Prioritize these existing ideas and assets:

- Orchard's Edge; a real cut → fall → usable log interaction.
- Stonewhisper; mineral contact → chips/fracture → tangible ore.
- Mossward skeleton; readable attacks, exact body-part hits, planted living reactions and playful remains.
- Emberwing after projectile contacts and attachments are ready: ordinary arrows first, curved phoenix shot second.
- Selected Orchard trees, ground-surface clutter, streambank rocks and landscape geology.
- Real terrain changes: Raise Earth, Sunder, paths, tree growth and the mineable Starfall loop.
- Physical skull basket objective, apples/healing and small useful construction.
- FPS, touch and WebXR as inputs into those same rules, not separate games.

Candidate means **worth bringing over after acceptance**, not already production-ready in this browser.
The current browser proof still uses simplified melee/terrain/enemy rules. Correct facing does not
establish bone-accurate browser collision, dismemberment or full native feature parity.

## Everything I would not import unchanged

| Existing area | Decision | Replacement / reason |
|---|---|---|
| Godot main scene and monolithic main.gd | Rebuild | Browser simulation, presentation, input, save and networking have separate ownership. No line-for-line port. |
| Native OpenXR/action maps, Windows launcher, SteamVR bootstrap, abandoned Unity shell | Leave out | WebXR and browser launch replace the desktop plumbing. Keep native project independently runnable. |
| Native filesystem saves, quest outbox, service-owned progression | Rebuild | Versioned room checkpoint, explicit owner/runner rights and unique authoritative events. No shared local save assumption. |
| Per-weapon rotation patches/calibration values | Leave out | Reviewed source basis, units, sockets, FPS/XR poses and import gate; see multiplayer/ORIENTATION.md. |
| Native player body, hand IK, holsters and held smoothing code | Rebuild selectively | Keep useful assets/ergonomic lessons; local tracked presentation must remain responsive and agree with authoritative interactions. |
| Separate keyboard/VR actions and conflicting shortcuts | Rebuild | One action vocabulary exposed through desktop, touch and WebXR. |
| Native dual OS-window/PiP arrangement | Leave out | Browser panels/views only; avoid rendering two full cameras by default on phones/headsets. |
| Native FFmpeg recorder / machine paths | Leave out of web client | Optional browser recording later, separate from gameplay. |
| Flat prototype world, uniformly scattered tree ring and generic capsule avatars | Replace | Curated Orchard composition; recognizable avatar roles, terrain/vegetation fields and graceful quality tiers. |
| Prototype enemy target capsules as final hit volumes | Replace | Shared bone/shape contact data and bounded swept attacks; UI labels never participate in collision. |
| Prototype click-cone melee as final combat | Replace | Explicit swing/contact/recovery, material response and spatial contacts. |
| World-space embedded arrows and enemy-wide attachments | Leave out | Bone-local impact transform transferred with the struck part on dismemberment. |
| Generic sphere flashes / gray dust for every impact | Leave out | Bounded material-specific effects at actual contact points, paired with audio/haptics. |
| Tree damage decals without successive structural cuts, whole-tree base toppling | Leave out | Cut-height split, readable stages, stump retained and useful logs. |
| Meteor decorative shell without matching mining contact | Rebuild | Correct winding/materials, matching surface collision, progressive damage and mineable contents. |
| Multiple independent ignition/fire implementations | Leave out | One material/heat/contact system; Wyrmspout, torches and burning liquid become sources within it. |
| Circular puddle decals as final liquid appearance | Replace | Connected bounded wet surface patches, flow/edge treatment and one ignition rule. |
| Godot terrain meshes/colliders/shaders copied directly | Rebuild | Retain deterministic fields/operators; browser rendering, collision and navigation adapters consume one world state. |
| Weather implemented as camera-following surface effects | Leave out | World-anchored surface state; local precipitation volume may follow viewer without moving settled snow. |
| Full expensive atmosphere/post-processing stack | Rebuild selectively | Coherent sun/ambient/material response first, then scalable fog, weather and effects with mobile/VR profiling. |
| RPG levels/titles/workshop tiers and XP for routine actions | Defer/reimagine | First demonstrate why collecting resources is fun. Avoid bringing an unexplained progression ladder into the room. |
| Generic hunt/gather-and-return quests | Leave out | Situational shared objectives: recover a skull, build a crossing, survive an event, mine the crash site. |
| Unlimited hostile God destruction | Reimagine | Telegraphs, costs, counterplay, protected spawn, recovery and room rules; not helpless Hero punishment. |
| Full construction economy and workers | Rebuild in stages | First physical bridge/ramp placement; later trustworthy navigation, jobs, resource ownership and damage. |
| All separate map loading/teleport destinations | Defer | One coherent curated map first. Keep only purposeful portal travel later. |
| Whole Little Orchard planet | Defer | Great experiment, but local gravity, seamless navigation, water and XR comfort expand scope dramatically. |
| Fairy flight, perch/shoulder, throwing, co-op controls and preference systems | Defer | A distinct extra role with replication and comfort needs; preserve for a later focused expansion. |
| Brann live Codex/Claude generation, voice service and arbitrary invention execution | Defer | Keep character/presence eventually, but public clients must never run privileged tooling or require developer credentials. |
| Dynamic living-component code/package installation | Leave out of MVP | Curated validated content packs instead; arbitrary user-created behaviours need an explicit security/compatibility boundary. |
| Jev/TypeSafe additions | Leave out | No necessary gameplay role in this focused slice. |
| Every debug gallery, museum, practice scene and showcase | Developer tooling only | Preserve regression/visual references without filling the playable world with test content. |

## Complete registered equipment decisions

| Equipment | First browser release |
|---|---|
| Orchard's Edge | Keep asset/concept; rebuild contact and forestry. |
| Stonewhisper | Keep asset/concept; rebuild satisfying mining. |
| Emberwing | Keep distinctive ranged identity; integrate after accurate projectile contacts. |
| Mossward shield | Keep as enemy equipment first; player pickup when ownership/physics work. |
| Copperpot's Promise | Defer; overlaps starter melee. Reintroduce only with a distinct building/repair purpose. |
| Copperpot's apprentice hammer | Exclude from initial loadout; redundant hammer variant. |
| Swallow Line | Defer; grappling needs robust networked traversal and VR comfort. |
| Mooncap Lantern | Defer; include only when darkness creates useful choices. |
| Hollow's Song | Defer/reimagine as ore/crystal interaction, not another unrelated tool. |
| The Last Hearth | Defer; fold into the eventual shared fire vocabulary. |
| Glowmoth Lantern | Defer; choose one excellent light tool rather than several equivalents. |
| Stormbell | Defer; needs meaningful weather gameplay before a dedicated item. |
| Forge lantern (Sol) | Keep as comparison/reference; do not ship two competing test versions. |
| Forge lantern (Opus) | Candidate static dressing later; no separate equipment slot now. |
| Siegebird | Defer; Emberwing wins the initial ranged slot. Cable/grapple attachment returns only with a distinct purpose. |
| Wyrmspout v2 | Strong next-wave candidate; rebuild against unified fire once core contacts/terrain are solid. |
| Sunskipper | Defer; returning-flight/minigame scope is separate from the first loop. |
| Copper Kite | Defer; another managed toy/flight interaction, not essential first content. |
| Prismwatch shield | Defer with its guardian; avoid cosmetic enemy multiplication before differentiated behaviour. |
| Cinderkeep shield | Defer with its guardian for the same reason. |

Additional systems outside the weapon inspection catalogue: **Sunfall Sledge** (defer until heavy impact
has a distinct role); **Pocket Thunder** (defer wearable grenade interface); **Wyrmspout v1** (do not revive
superseded version); **matchbox, fuel bottles, hearth torch** (rebuild together in the fire pass);
**magnetic wand, Moonweaver gloves, lantern seeds and generated inventions** (experimental, defer).
Physical pumpkins are useful later as training targets, but dynamic slicing and three-stab faces should
not precede reliable combat/harvesting. Resource pickups remain useful; do not carry over every historic
resource currency or loot type just because it exists.

## Complete God ability decisions

| Decision | Abilities |
|---|---|
| Core candidates | Carve Path, Sunder, Raise Earth, Earthen Wall, Starfall, Grow Grove, Grow Forest, Tree Ring, Bridge, Ramp, Bone Duelist. |
| Rebuild/merge later | Crystal Fault (spend mined crystals); Awaken Ent and Calm Ent (one coherent lifecycle); Stairs and Boardwalk (construction variants); Skeleton Squad and Shield Patrol (encounter variants); Stone Sentinel; Mark Harvest and Summon Lumberjack (one dependable worker loop). |
| Defer | Rat Stream (swarm budget/clarity); Haunting (fire-only enemy before unified fire); Plant Magical Seed (overlaps forest growth). |
| Do not expose as completed features | Outpost, Tower, Platform, Gate, Barricade: each explicitly has implemented:false in the native catalogue. Recreate properly when building needs them. |

Retain a small immediately understandable palette. These recommendations do not remove the four existing
browser proof spells. The inventory lists every native spell individually, including disabled ones.

## Regions, creatures and side activities

**Map:** Orchard is the base. Reuse selected Forge Yard and Pinewood Ruins dressing as places within it.
A small quarry/Starfall site and crystal pocket can support mining without recreating entire maps.
Do not port complete Crystal Hollow, Sandstone Quarry, Mushroom Glade, Sky Garden, Ember Foundry,
Gloamfen, Starfall Ridge, Cloudbreak Keep or Enchanted Kitchen layouts in the first release.
Their asset families remain available; each individual GLB has an inventory row. Defer standalone
Ember Creek, horizon/showroom/demo regions and the spherical planet.

**Enemies:** Mossward skeleton first. Golem is the next substantial opponent, after hard-surface combat.
Defer Prismwatch/Cinderkeep variants, rats/swarms, fire-only ghosts, minotaur and Ember Warden boss.
Ent awakening is promising later because it connects combat to player-grown forests; do not import it
as just another unrelated enemy. Keep animal/ambient dressing sparse until it supports the chosen map.

**Activities to leave out initially:** Bellworks and Echo Bells, Bankshot, Hollow challenge, Cargo
Playground, Festival Relay, lamp-lighting/lantern galleries, Living Museum, arcade walkthroughs,
collection/discovery reward chains, resource-guide museum and separate practice courts.
The complete living-demo register also excludes the Open-Hand Test Garden, Fire/Water/New Growth,
Copper Heart Engine, Lantern and Listener, Pocket of Moonlight, Tools That Make Tools, Glass-Eye
Practice Yard, Moonweaver Gloves, both Lantern Seed stages, Unfinished Lullaby and Cinderloop.
Preserve them as references, not obligations to fill the browser world.

**Quests:** rebuild Skulls for the forge as an authoritative physical delivery. Do not directly port
A quieter yard, Bones to pick, Timber for tomorrow or A solid foundation; these are count-and-return
quests. A three-skull basket can teach contact, dismemberment, pickup and shared progress at once.

## Complete file register and limits of this review

[inventory.csv](inventory.csv) assigns every tracked file under godot/, native/ and launcher/ a
conservative disposition, plus individual registered weapon, spell, quest and living-demo entries.
[coverage.json](coverage.json) records counts. Regenerate with
`python scripts/browser_migration_inventory.py`; unselected/new content is explicitly deferred rather
than silently approved. Nothing is copied or deleted by that command.

- CANDIDATE: source worth evaluating for the focused loop, not unconditional import approval.
- REBUILD: preserve useful intent, recreate the browser implementation.
- DEFER: leave out of the initial browser game; potentially valuable later.
- EXCLUDE: don't carry over this implementation/placeholder/infrastructure.
- TOOLING: retain offline acceptance/reference only.
- DEPENDENCY-ONLY: textures, materials, configs and other sidecars ship only when required by a selected feature.

Coverage is file/catalogue-level, not a claim of exhaustive manual playtesting or visual judgment of all
329 models. Unregistered content embedded inside a script inherits that script's conservative disposition.
Native service code is covered by the system decisions above, not a claim that every service function was
individually audited. No public art pack includes credentials, saves, AI prompts or developer tooling.

## Acceptance before expanding the port

1. Asset basis, units, grip/foot origin, animation and real rendered orientation pass the browser gate.
2. Hit geometry follows visible parts; hand/weapon contact never depends on a UI box.
3. One complete fun interaction works in FPS, touch and VR, with corresponding controls and readable feedback.
4. Two peers agree about impacts, pickups, costs, terrain changes and recovery; eight-player stress test follows.
5. Representative phone/desktop/headset frame and network budgets pass; 60 Hz simulation is measured, not inferred from rendering FPS.
6. The new feature adds a useful choice or shared story. Otherwise keep it out of the initial build.

This produces a smaller game with a much stronger identity, while retaining the native project as a
valuable library of assets, experiments and proven interaction ideas.
