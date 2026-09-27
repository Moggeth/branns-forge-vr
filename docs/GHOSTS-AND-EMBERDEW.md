# Ghosts and Emberdew

Added 2026-09-15. Runtime: `godot/firecraft.gd`; live tuning: `godot/firecraft.json` (reloads every three seconds). No external assets, dependencies, or paid generation.

## Play

The Emberdew common-goods table is in the Forge Yard, beside the main workshop at (4.8, 0, 3.5). Supplies are free and replenishing. Take a matchbox and vials; the box has its own pocket at your left hip.

1. Grip the matchbox. Pull the end drawer with your free hand, or tap the holding hand's trigger to thumb it open.
2. Grip an individual match in the exposed tray. Tap the box hand's trigger to close the tray if desired.
3. Stroke the match head along either dark side striker. Merely touching the box does not ignite it.
4. Stow the box at your left hip and take a vial with that hand. Move the burning match gently to its wick for 0.3 seconds.
5. Throw the lit vial. Impact breaks it into a glass/liquid burst and an eight-second pool of fire. You can also hurt yourself with the pool.

Both match and wick burn for **10 seconds**, with a small countdown. Match movement over 1.8 m/s for 0.15 seconds extinguishes it; a short ignition grace prevents the striking stroke immediately blowing it out. A spent match cannot relight. A vial whose wick burns out is inert: it does not explode in your hand. Cold vials shatter without creating fire.

Two ghosts haunt Pinewood Ruins and two haunt Crystal Hollow. Physical weapons, bolts, ordinary bomb blasts and crystal damage cannot damage them. Actual fire (matches, lit wicks, Emberdew pools, Ember Gauntlet fire and explicitly typed generated ignite actions) can destroy them. Nearby flames repel them. They have session-persistent deaths, no automatic respawn and no new resource currency.

## Implementation and limits

- `adventure_runtime.hurt_enemy` guards ghost damage centrally, before normal hit/death/remains logic. Default damage remains physical; `explode` defaults to blast. Never infer fire from an orange effect or weapon name.
- Ghosts are non-solid Areas and have separate movement; physical bolts pass through them. Fire projectile queries include Areas.
- Fire props have separate held ownership and release handlers ahead of generic tools, preventing bomb formation or accidental melee handling. Released props use layer 8 / mask 9 rigid bodies, colliding with scenery and other loose items, not blocking the player.
- Six concurrent vials, twelve matches, four fire pools, six pooled sound voices. Unheld spent props and abandoned matches expire. Held items do not disappear just because their cleanup timer elapsed. Props and ghost deaths currently reset when the game restarts; this is not a new saved inventory system.
- The pouch/hip item and other held props cross portals with you. Off-zone bodies freeze. Crossing zones resets sampled hand motion so teleportation does not count as blowing out a match.
- Bran's world snapshot and voice instructions describe the real supplies and controls. No imaginary delivery/tool is required.
- Fire tuning accepts the existing named numeric keys, clamped 0.05–30. Defaults are in the JSON. Invalid JSON is ignored; prior valid values remain. Stop/start the game using the normal project launchers. No additional service is needed.

## Verification / debugging

`Verify Brann.ps1` includes `--fire-check`: central immunity, explicit fire damage and death, side-striker geometry versus false contacts, gentle wick contact, 10-second lifetimes, spent-match lockout, motion blowout, wick expiry, cold versus lit impacts, pool caps, held ownership, and a real dropped RigidBody hitting the supply table. Diagnostic mode disables service calls and recording. Always require `FIRE_CHECK PASS` AND no script errors, not just Godot's exit code.

Native captures: `work/emberdew-stand.png`, `work/ghosts-fire.png`. Desktop render observed 119 FPS at the stand and 118 FPS with ghosts/fire; these are short desktop samples, not headset performance measurements. Full existing regression suite passed in 34.46 seconds before the final focused fire checks. Physical Knuckles ergonomics still need player feedback.

Look for `FIRECRAFT` entries in `logs/game-*.log` and `logs/fire-check.log`. No frame-by-frame log spam. Future improvements should retain the explicit damage boundary and bounded object budgets.
