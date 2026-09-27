# Item interaction audit — 20 September 2026

Read-only gameplay audit: inspected native input/action paths, model builders,
the local completed commission registry, Living Workshop manifests and existing
native renders (including work/item-actions.png). This is not a fresh headset
playtest. No gameplay changes were made.

## Named equipment

| Equipment | Implemented function beyond swinging | Assessment |
|---|---|---|
| Copperpot’s Promise / apprentice hammer | Trigger Forge Pulse: area damage/slow; three-second cooldown | Functional. Less tactile depth than Siegebird. |
| Orchard’s Edge (called Orchid’s Edge in conversation) | Hold trigger during a physical swing for a stronger cleave; blade can bite into skeletons, stop, or sever parts | Rebuilt authored axe and localized skeleton combat added 27 September. Contextual tree chopping remains. |
| Stonewhisper | Trigger charges an eight-second resonant strike; striking ore yields one bonus material and fractures up to two nearby seams | Mining-specific alternate action, with a physical strike as its release. |
| Mooncap Lantern | Real carried light; trigger creates a temporary slowing mushroom garden | Functional. A physical shutter/spore dispenser would make the magic easier to read. |
| Hollow’s Song | Trigger launches a three-projectile resonance fan; crystal impacts can interact with seals | Functional; hero crystal model. |
| The Last Hearth | Trigger firebolt plus brief protective ward | Functional, but the model is a handled implement rather than a worn gauntlet. |
| Swallow Line | Visible tether, attach/hold-to-reel/pause/drop-to-detach, moving spool | Functional specialised traversal tool; no independent second mode. |
| Pocket Thunder | Grip then trigger forms a bomb; release grip throws | Responsive special interaction, but no distinct alternate bomb mode. |
| Siegebird | Firing, physical crank/reload, finite recoverable/stabbing/throwable bolts, weak-point optic, optional grapple reel and selector | Strongest mechanical/visual benchmark. |

Native item_action_checks.gd tests the six ordinary trigger specials, grapple
attachment/reeling, orientation and projectile persistence. Existing verification
logs contain passing results; no full suite rerun was needed for this source audit.

## Real gaps and deliberate simple objects

- Physical enemy remains, including recovered pieces: assigned bone_club behaviour,
  physical pickup/throw/impact, but no special trigger action. adventure_runtime's
  bone_club trigger path explicitly returns without an extra effect. These meet
  the improvised physical-object idea, not the stronger every-weapon-has-a-special rule.
- Living test garden's three little moons and two joining blocks: grabbable physics
  props without individual active powers. They have explicit uses in gravity and
  joining demonstrations, rather than being finished named inventions.
- New Pruner, Mender, Green Finger, Joiner, Climb Brush and Gesture Seed have actual
  cut/repair/grow/hinge/paint/record mechanics. Their generic primitive-based models
  are proof-of-function prototypes, not Siegebird-standard finished designs. Most
  are single-purpose tools rather than two-mode inventions.
- Lantern Seed v1 is a grabbable trigger-lit lamp. V2 adds following behaviour.
  The first version remains deliberately simple as a history demonstration.
- Moonweaver Gloves applies an appearance/curl/movement profile; it is not yet a
  separate physical wearable with an active secondary action.
- Matchbox, matches and fire vials have coherent physical preparation/use sequences
  (open/pluck/strike/light/throw), so lack of a magic alt-fire is not missing core
  functionality. Vial/match trigger currently gives instructions, not a second power.

## Generation policy gap

The detailed GLB forge path already rejects a trigger behaviour that yields only
cosmetic spark actions, and requires useInstructions (service/forge-worker.js).
The Living Workshop validator allows a package containing just a grabbable body,
which is necessary for material/prop construction. It does not separately classify
finished equipment and require its distinctive secondary interaction. Therefore
the earlier design rule is not uniformly enforced across both creation routes.

Recommended next policy: identify equipment, consumables, materials and scenery;
require equipment to declare its meaningful special interaction, control binding,
feedback and a behaviour test. Keep simple inputs/building pieces valid without
pretending they are finished inventions.

Priorities: alternate bomb mode; differentiated remains/shield interactions if
these are to count as full weapons; authored visual and tactile passes for the
new maker tools; clearer firing/recharge cues for pick, lantern and Last Hearth.
