# Weapon feel baseline — 2026-09-29

The ordinary living skeleton has 66 HP. It stays planted on ordinary hits, reacts locally, can shed bones, and becomes dramatic physics debris on death. A decent melee strike is usually several hits; a forceful blade or blunt impact can be two. These are feel targets rather than a demand for a visible HP bar. The shield guardians reduce frontal body damage; side/rear attacks, shield theft and a clear skull shot are deliberate counters. The focused `weapon_balance_checks.gd` passed for all three shield types, and `desktop_hero_integration_checks.gd` passed primary/alternate routing, swing alignment and crossbow access.

| Tool | Distinct reason to use it | Primary / secondary | Current balance observation |
| --- | --- | --- | --- |
| Copperpot's Promise | Early all-purpose hammer and reliable ghost counter | Strike / fire Forge Pulse | Pulse deals 18 fire in a short radius on a 3 s cooldown. A 36-HP ghost takes two pulses; physical strikes still cannot hurt it. Desktop `1`, then right-click; VR grip then trigger. |
| Orchard's Edge | Precise timber and bone cutting | Swing/chop / trigger-powered cleave | Contact speed, edge orientation and mass matter; a blade can bite into a skeleton rather than pass through it. Strong strikes can remove a limb. |
| Stonewhisper | Ore harvesting and richer seam breaks | Pick strike / charge a strike for 8 s | Mining utility matters independently of combat damage. Its visual silhouette is queued for a specialist art redesign. |
| Pocket Thunder | Arc a thrown area burst around cover | Form/throw / tuned blast | Current default blast is about 45 damage and exposes the thrower to self-damage. It is not a ghost counter because ghosts remain fire-only. |
| Swallow Line | Reach height and reposition | Attach / hold to reel, release to pause | Traversal utility is the core identity, not direct damage. |
| Mooncap Lantern | Carry light and control an area | Carry / six-second slowing spore garden | A support tool; its visual clarity is a later art target. |
| Hollow's Song | Resonance and seal-opening magic | Strike / three-shot crystal resonance | It is not currently fire. Making its ordinary crystal damage kill ghosts would contradict the established fire-only rule; a future flame attunement could extend it coherently. |
| The Last Hearth | Fire projectile and short ward | Strike / 38-damage firebolt plus ward | Heavy fire option after progression; can hurt ghosts. |
| Siegebird | Deliberate precision and tactile reload | Fire / bolt or grapple selector with reel | Current base bolt is 95 damage and skull hits double. Unshielded body hits can already be lethal to a basic skeleton, while frontal shields reduce them sharply. With the now-unlimited quiver, review whether the reload rhythm alone sufficiently balances that power in a live playtest. |
| Wyrmspout | Sustained flammable stream and area denial | Continuous fire / vent heat | Surface fire, heat and cooldown distinguish it from a one-shot bolt; active flame can hurt ghosts. |

The desktop Hero uses left-click for the primary melee swing and right-click for the secondary action. `9` equips an owned Siegebird; `R` reloads or reels when tethered. The first-person axe preview after the fog fix is `outputs/overnight-axe-fps-after-fog.png`. In-game HMD strength, collision feel, and the relative value of unlimited bolts remain playtest questions; do not infer them from numeric checks alone.
