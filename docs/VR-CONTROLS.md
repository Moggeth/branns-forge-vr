# Hero VR controls (WebXR multiplayer client)

Source of truth: `multiplayer/client/vr-input-policy.js` (pure routing) wired from `multiplayer/client/game.js`.
Hands are always taken from `XRInputSource.handedness`. Controller index is never used to infer a hand.
Shared simulation stays authoritative: every press becomes a validated `onAction(...)` message, or input to the local
weapon controller. Client helpers never mutate snapshots.

Buttons follow the WebXR `xr-standard` gamepad mapping: 0 trigger (select), 1 grip, 3 thumbstick click,
4 A/X, 5 B/Y.

## Two controllers (normal)

| Input | Hero function | Notes |
|---|---|---|
| Left stick | Walk | Dead zone 0.14. `'none'`-handed pads also walk. |
| Right stick | (unbound) | There is no snap or smooth turn; turn with your head or body. |
| A / X (either hand) | Jump | Edge-triggered. |
| B / Y (either hand) | Exit VR to Menu | Ends the XR session. Weapon input is cancelled first. Familiar binding, kept as is (see Review items). |
| Right trigger | Primary | Crossbow fires on press. Bow: hold to nock and draw, release to loose. Wyrmspout: hold to breathe flame. Flask: pour. Melee tools: weapon special (the swing itself is physical tip contact). |
| Right trigger, holding a log or bone | Throw it | Aims from the right controller. Takes priority over the weapon. |
| Left trigger, bow / wyrmspout / flask | Special | Bow: while drawing, lock the curve base. Wyrmspout: special. Flask: light or snuff. Releasing it does nothing. |
| Left trigger, other tools | Primary | Unchanged from before (melee: special, crossbow: fire). |
| Left grip | Cycle weapons | Skips Bone (`limb`). Cancels any draw or flame. |
| Right grip | Grab / drop | Drops a held log or bone. Otherwise grabs what the right controller points at. With nothing to grab, it interacts (collect or eat). |
| Left stick click | Interact | **New** (previously unbound). Collect, eat, or **stow a held log**. Same message as desktop `E`. |
| Right stick click | Build bridge | Uses 3 wood. Server validates. |
| Wrist Expedition panel (left wrist, right pointer) | Panel buttons | A right-trigger press that starts on the panel belongs to the panel. It never attacks, and its release goes back to the panel. |
| Swing (axe / pick / hammer) | Strike | Physical tip contact. Haptics play on the hand that holds the weapon. |

Bow two-hand semantics are unchanged. The bow rides the left hand and the right hand draws. Draw strength comes from the
hand separation when both grips are tracked. Otherwise it is time-based (850 ms to full).

## Press ownership and cancellation

- Whatever handles `selectstart` (panel, primary, special, throw, God cast) owns that press. The matching `selectend` goes
  back to the same owner. Before this change, any left-hand release was dropped, and the panel could swallow a later
  weapon release.
- Changing weapon (`equip`) or exiting via the menu makes open presses inert: a release can never fire with a different tool.
- `clearInput` (role change, `setActive(false)`, blur, hidden tab, session start/end) clears all ownership.
- Losing a controller that holds an open primary press cancels it: no shot from a half-drawn bow, and any flame stops.
  A panel press on a lost controller clears without activating.
- Buttons already held when a controller (re)connects are latched, so they do not fire. This stops a held B/Y from exiting
  VR on reconnect.

## Absent, opposite-hand and single controller

| Situation | Behaviour |
|---|---|
| Only a left controller | The weapon (including the bow) attaches to it. Its trigger is **primary**, so flame, bow draw and crossbow work, and its release ends them. Holding a log, the trigger throws. Left stick walks. Left grip cycles. Left stick click interacts or stows. There is no grab (needs the right grip) and no bridge. |
| Only a right controller | Weapon on the right. Trigger is primary or throw. **Right stick walks** (new fallback; the right stick is otherwise unbound). Right grip grabs, drops or interacts. Stick click builds a bridge. There is no weapon cycling, no left-trigger special, and no wrist panel (it needs a left wrist). |
| Handedness `'none'` | Treated as the primary (right) hand for the trigger. Its stick walks. Its grip grabs or drops. Its stick click is unbound. |
| No tracked controller | The weapon returns to the head anchor. Aim falls back to the head, never a stale index 0. |
| Weapon in the "other" hand | Aim, projectile origin and haptics follow the hand the weapon is actually attached to (`weaponHand`). Grab, drop and throw aim from the controller that pressed. |
| Missing haptic actuator | Pulses are skipped and counted (`feedback.stats().noActuator`). Nothing throws. |

## Unchanged

- Desktop: WASD, Space, 1–8, E, B, F, G, X, Q and mouse. Touch layout. Authored grips and swing poses. God role (VR
  God is out of scope; the screen fallback is preserved).

## Review items (not changed in this commission)

1. B/Y exits VR on one press with no confirmation. It is familiar, but a stray press is disruptive. Consider a hold or
   a wrist confirm in a future pass.
2. With two controllers and a log held, the left trigger keeps its weapon role. For melee tools that is the special
   (axe cleave and similar), and the server decides whether a full hand blocks it.
3. Single controller: there is no special for wyrmspout or flask, and no curve lock for the bow. Adding these would
   overload a button.
