# Invention adventure progression

The service is authoritative for workshop progression and commission scope. The
single-player native client is trusted to report real world pickups, damage and
physical interaction events. This boundary is deliberately local, not a multiplayer
anti-cheat system. Voice tools cannot create materials or bypass workshop tiers.

| Tier | Permanent upgrade | One-time offering | New possibilities |
|---|---|---|---|
| 1 | Apprentice hearth | None | Free hammer, axe, pick and Pocket Thunder bomb glove |
| 2 | Stocked workshop | 3 rat tails OR 3 lumber + 3 stone | Swallowline grappling hook, Mooncap Lantern, custom tools |
| 3 | Enchanted anvil | 3 iron + 3 haunted bones | Hollow’s Song resonator, enchanted custom combinations |
| 4 | Everburning forge | 1 foundry guardian ember core | The Last Hearth gauntlet, powerful custom combinations |

Each upgrade consumes its offering once and implies a continuing material supply.
Unlocked predefined tools can be issued repeatedly free. Custom commissions at an
unlocked tier cost no further gathered materials. They still run the actual Astra
medium worker, make original Blender geometry and execute bounded JavaScript.
A carried legacy favour may fund a tier2 commission before upgrading; it is not
consumed when the permanent workshop tier already covers the invention. Old
five-tail hand-ins remain compatible. Failed/interrupted/cancelled legacy spending
refunds exactly once. No saved player state or historical commissions are copied,
erased or reset by development tests.

The server combines an explicit enumerated capability list with deterministic
keyword floors in the full brief. A declared spark cannot cheapen a flying axe.
Every new generated item and every activation is checked against its paid scope;
unknown capabilities fail before worker launch. This bounds expressive generated
behavior; it is not a semantic oracle for arbitrary natural-language designs.
Brann should explain supported interpretations honestly. Flight currently means
safe teleport/anchor travel, not unconstrained continuous flying.

## API for the native game

All routes use loopback /api/vr. GET state returns legacy tails/favours/items/jobs/
voice/visiting plus tier, resources, unlocks, owned tools, all recipes, upgrades,
health/maxHealth and drop. Generated ability state separates combat targets from
resources/anchors/barriers and preserves enemy_type. Predefined tool entries carry capabilities, color,
formationSeconds and bounded haptics for formation/ready/release/impact.

- POST context: position{x,y,z},zone,visiting,equipped,health,targets[],controllers[],
  interaction. Controllers accept hand,profile,haptics,tracked. Interaction accepts
  phase,hand,squeeze,formationSeconds. Health is bounded0–100.
- POST gather: id (unique persistent world event),resource,amount (integer1–5).
  Canonical resources: rat_tail,lumber,stone,iron,apple,spore,crystal,haunted_bone,
  sky_bloom,ember_core. Compatibility aliases timber/spores/ember/bones/tails.
  Only the foundry boss may emit ember/ember_core. Replayed ids award nothing.
- POST upgrade: tier2–4; requires a fresh workshop visit, preceding tier and an
  affordable offering. Already-completed requests are idempotent.
- POST unlock: milestone stocked_workshop,enchanted_anvil,everburning_forge;
  exactly the same payment path as upgrade, never a free grant.
- POST craft: id from state.recipes; requires workshop and sufficient tier.
  Returns tool and full progression state. Starter tools already belong to player.
- POST equip: id; validates owned builtin or ready commission. Returns equipped.
- POST death: optional position,zone; transfers all expedition materials including
  carried tails into a persistent satchel, keeps tools/upgrades/favours, restores
  health100. A previous unrecovered satchel is merged into this one so repeated
  mistakes never silently destroy resources. Consequence is recovery travel.
- POST recover: optional id; requires current native context in the same zone,
  within3m of satchel. Recovers once. Returns full progression state.
- POST ability: id,position,forward,targets,optional interaction. Actions are
  caster-local then translated back to world XYZ, including elevated/distant zones.

Gathers, upgrades, crafting, deaths and recoveries log timestamped lifecycle events
in service/logs. State uses the existing atomic player.json temporary-file rename.
Do not delete malformed state; preserve and inspect its parse error. Existing old
reservation strings and new structured reservations both recover safely.

## Verification and fast paths

Run Node --test service/test.cjs service/voice-test.cjs service/progression-test.cjs.
All tests isolate temporary state and make no paid API/worker calls. Coverage
includes legacy migration, alternate workshop offering, all four tiers, free repeat
crafts, duplicate pickups across restarts, satchel merge/nearby recovery, commission
scope/refund/duplicate requests, remote elevated actions and bounded haptics.

Connected native integration passed in 12.844 seconds: original late-import,
equip and generated rat damage plus all-eight-zone travel, starter physical release,
0.6-second formation/release, real scene lumber/stone gathering, permanent tier2,
anchor grapple teleport, actual skeleton/boss damage and physical loot through tier4,
resonator barrier shattering, self-damage, repeated-death satchel merging/recovery,
permanent-tool retention and generated JavaScript damage in distant Crystal Hollow. Run it with
Node service/integration.cjs; it uses isolated port8788 and generated offline assets.

Node unit verification does not prove native travel/physics, physical controller
bindings, actual haptics or voice-to-original-asset generation. Use the connected
native integration and a headset playtest for those. The original BomberWLAN
process and runtime state must remain untouched. No Git initialization performed.

When extending capabilities, update progression.js, tool schema, runtime action
validation, this contract and native effect handling together. An enum alone does
not implement an engine behavior. Tests should include the actual effect path.

## Capability audit corrections

The native smoke exposed no assertion failures, but independent action review found
metadata and contract gaps. Mooncap Lantern now advertises its actual slow/damage
capabilities; The Last Hearth no longer falsely advertises a shield. Native blast
and resonator barrier handling were brought into line with their descriptions.
Scene resources/anchors no longer masquerade as enemies in generated scripts.

The predefined Pocket Thunder interaction owns the 0.6-second formation mechanic.
Generated item formationSeconds is currently bounded/preserved metadata; it does
not yet create arbitrary custom formation hooks. Generated held items can supply
validated haptic profiles. Do not promise general custom passive/formation scripts.
