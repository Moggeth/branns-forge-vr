# Shared-world RTS direction

The goal is two people meaningfully shaping and inhabiting one world. The World Builder creates terrain, routes, living actors and encounters that the Hero can physically use or answer. Cooperation and playful opposition should create choices for both players. A spell that only changes a map icon or spawns disposable hazards does not meet that goal.

## Playable foundation

The Orchard Highlands World Builder and the VR/FPS Hero run on the **same PC, in the same Godot `World3D` and simulation**. The elevated window is another camera and controller for the live orchard. This is local asymmetric play, not networking. The Hero already has a visible head, torso and limbs in the shared scene; convincing tracking and equipment presentation still need physical headset review. The builder can watch the Hero cross a real bridge or fight a patrol in that scene.

The current playable slice includes:

| System | Current behavior |
| --- | --- |
| Mana | The settlement save uses `mana`; old `aether` values migrate without resetting reserves. The 20-point cap starts at 12. A tuning control exposes normal 1× and testing 4× regeneration; 4× is the current default. |
| Casting controls | The native illustrated command panel groups Land, Life, Construction and Encounters. It shows reserves, costs, cooldowns and unavailable reasons, supports 1–9 selection and world-space casting, and keeps a spell selected for repeated casts. |
| Land and life | Paths, ravines, raised earth, earthen walls, forest lines and rings, Starfall and Crystal Fault edit the Hero's terrain. Grown trees and landed, mineable meteorites persist. |
| Construction | The older three-lumber marked brook crossing remains. The new two-endpoint bridge, ramp, stairs and boardwalk commands preview placement and dimension-based lumber cost, then create collidable decks and worker routes. |
| Ents | Existing orchard trees awaken in place with trunk-fitted face/limbs. Species, size and shared fire/water affect them. Calmed Apple guardians produce edible healing fruit; defeat leaves grabbable timber and a magical seed. Recovered seeds plant persistent, species-preserving trees. |
| Patrols | Skeleton orders warn the Hero, spawn physical enemies and can earn bounded completion rewards for varied, objective-based clears. Rewards are keyed by sector to discourage repeating one easy site. |

The settlement's delivered lumber stockpile and the Hero's pouch are **separate inventories**. Workers deliver timber to the settlement; scenic-log pickup and Ent defeat credit it once through explicit hooks. A general pouch/settlement exchange still needs a resource and balance rule. The existing save is the authority for settlement edits, with limits on paths, structures, trees, meteorites and threats. Offline checks use disposable state; ordinary play shares the persistent orchard.

## Next dependencies

1. **Finish and verify the current local slice.** Check the panel at narrow and desktop window sizes, mouse and 1–9 controls, explicit cost/cooldown feedback, repeated selection, cancel behavior, saved-state migration, free bridge collision and worker traversal. Then play in the Vive Pro 2 with both players present. Desktop screenshots and headless checks do not establish headset comfort or stereo frame time.
2. **Make routes serve practical work.** Add small supply outposts only after defining delivery, storage, pickup and recovery against the existing separate inventories. Equipment or consumables placed from the map must exist as physical objects the Hero can take or return. Extend the same placement and collision contract to watchtowers, climbing platforms, gates and barricades. Rafts, cranes, pulley lifts, traps and siege gadgets are later construction candidates.
3. **Deepen Ent consequences.** The bounded fruit, timber and seed loop is now playable and tested. Next review species-specific movement in VR, persist wider forest burning/charred regrowth, and improve newly grown fruit-tree interactions. Preserve tree identity through save, harvest, combat and reload; inspect ground and elevated views rather than accepting only a debug fixture.
4. **Build the physical component golem.** Require recognisable nearby timber, stone, metal and a visible lantern or magical heart. The builder assembles and commands; the Hero installs or repairs the heart, supplies parts or climbs aboard. Composition should affect weight, burning and lightning behavior, and recoverable components should remain visible. The command-panel entry is a future placeholder, not a playable summon.
5. **Give weather bottles a purpose.** Rain should solve water, soil or fire problems; sunlight should unlock a light-sensitive route, fruit or ghost encounter; frost should offer a temporary crossing or cool machinery. The full loop is capture, carry into a place the builder cannot reach, apply to shared material rules, and gain access or resources.
6. **Review the Meteor Menagerie candidates.** Starfall currently makes a crater, damage and mineable material; no meteor creature emerges. Evaluate Orbit Wisp and Starmaw first for distinct physical interactions and manageable animation. Geode Hopper and Cinder Tortoise remain candidates. Test an encounter plus a resource opportunity, with texture and material quality preserved from concept art rather than modelling every fragment.
7. **Add talents and remote play later.** Talents should unlock interactions such as fruit-bearing magical forests, curved bridges or mineable terrain, rather than small numerical buffs. Remote networking must wait for clear authoritative state, ownership and conflict rules; the current promise is two players on one PC.

## Shared-world acceptance criteria

- A builder action produces a visible, persistent change in the same scene the Hero occupies. The Hero can walk, climb, mine, harvest, fight or carry something as a consequence; the result survives a normal relaunch.
- Every placement states its exact resource cost and failure reason before commitment. Invalid geometry or blocked terrain leaves Mana, lumber, materials and cooldown unchanged. Successful actions spend once and begin one visible cooldown.
- A route or structure supports real Hero collision and a worker route, including after a second nearby structure is added. Terrain edits, water and trees update local traversal without losing previously saved objects.
- Creature encounters give the Hero warning and a meaningful objective, use bounded populations and rewards, and cannot repeatedly pay from one safe location. The original tree or meteor site remains identifiable throughout its encounter.
- The strategic camera can identify the Hero, their equipment and the result of physical interaction without putting body geometry in the headset view. Verify this with actual tracked play, not only a desktop proxy.
- Both perspectives remain responsive at the intended hardware target. Bound active actors, structure records, particle effects, save size and secondary viewport work; measure VR frame time during a two-player session before increasing caps.

The [World Builder handoff](WORLD-BUILDER.md) records current controls and save behavior; [terraforming evidence](TERRAFORMING-SPELLS.md) shows actual-world land edits.
