# Copper Kite magnetic wand

Copper Kite is a physical cargo toy in Bellworks' east annex. Its pedestal is at
**(136, 0, 69)**. It works offline and uses only explicitly registered cargo from
`cargo_playground.gd`; it does not pull arbitrary scenery or existing bones.

Grip / E takes the wand. Aim at a marked parcel and press trigger / left click
to attract it. Guide it slowly with the wand; the glowing orb and thin mint tether
show the connection. Trigger again drops the parcel almost motionless for precise
nest placement. **A in VR / X on desktop** gives a gentle forward toss. Release grip / E
to drop the parcel gently and put away the wand. The cargo playground explains
the parcel sorting objective and owns its three blocks, nests and reward.

Only one parcel can be charged. Acquisition is limited to 4.5 metres and 2kg,
with a 5m tether break. A spring applies at most 22m/s² acceleration; normal
gravity and collision remain active. Speed is limited during control to 6m/s;
a deliberate toss uses 4.2m/s forward plus 0.8m/s upward. Trigger-drop limits
remaining speed to 0.2m/s and spin to 0.3rad/s. Putting away the wand reduces
remaining owned velocity to at most 2m/s. A wall obstructing the line breaks the
connection. Long teleports drop the parcel while the held wand travels with you.

## Integration

Initialize `game.magnetic_wand.setup(game)` before cargo setup, then cargo calls
`register_body(body, cargo_root)` for each of its parcels. Root calls `tick(delta)`
each frame for pose, tether and travel checks. **Do not call `_physics_process`
manually**: the module applies its spring in Godot's normal physics callback.

| Interface | Purpose |
|---|---|
| `try_grab(hand, desktop=false)` | Grip/E near pedestal, before generic pickup |
| `trigger(hand)` | Pull eligible aimed cargo; next trigger drops gently |
| `secondary(hand)` | Explicit 4.2m/s toss; root binds desktop X |
| `release(hand)` | First-class grip-release handling; puts wand home |
| `busy(hand)` / `claims_trigger(hand)` | Prevent competing items and bomb input |
| `register_body(body, owner_root)` | Explicitly whitelist a direct child cargo body |
| `can_move(body)` | Revalidate mass, ownership, type and forbidden metadata |
| `release_target(body=null, gentle=true)` | Cargo reset safely drops only this charge |
| `revoke_body(body)` | Remove eligibility and any current charge |
| `target` | Current charged body; cargo scoring must exclude it |

Registration stores the exact owning parent and a per-wand metadata token. A
foreign parent, foreign token, held/holstered state, freeze, excess mass, live
bomb metadata, actor identity or Living/assembly metadata excludes the body.
Those rules are checked again during the pull. The wand never reparents or freezes
a block and never writes gameplay damage or inventory. Competing hands also check
Sunskipper, Living, workshop systems, generic held objects and bomb formation.

Sunskipper received one authorized ownership-check addition for `magnetic_wand`.
Its prior file was backed up to
`work/magnetic-backup-20260921-071605/playful_tools.gd` before that edit.

The wand writes no save data or service requests. Its `MAGNETIC_WAND` setup,
capture and toss events appear in the normal launcher game log. Restart returns
the wand to the stand; cargo reset/recovery remains cargo module responsibility.

## Isolated verification

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://magnetic_wand_checks.gd
```

The harness initializes no main scene, services or user saves. It runs **43
checks**, including a real physics pull from **1.022m to 0.069m** away from the
hold point, toss, wall interruption, gentle drop, whitelist and all ownership
exclusions, travel and retrieval. Latest result: zero failures, clean exit,
**1.241 seconds** process wall time. Engine physics portion took 0.904 seconds.

Rendered tether/layout and headset feel require central visual/headset testing.
The module's headless tests establish physical motion and bounded interaction,
not headset comfort or artwork appearance.

## Implementation lessons

- Follow the explicit XR-off fast path from `PLAYFUL-TOOLS.md`; headless alone
  is insufficient to prevent OpenXR initialization in this project.
- Registry membership alone is insufficient. Recheck the exact registered parent,
  ownership token, foreign held state, current mass and freeze during attraction.
- Keep pulling bodies simulated. Reparenting or freezing a parcel would undermine
  nesting, bounce and cargo ownership; a damped spring preserves those systems.
- `WorldZones.box` encodes dimensions in node scale. Resizing tether length must
  retain its **0.017m x 0.017m** cross-section rather than overwrite XY with 1.
- The core trigger must support precision placement. An initial pull/toss toggle
  made sorting awkward, so trigger now pulls/drops, while A/X explicitly flings.
  VR A is edge-detected inside `tick`; desktop X calls `secondary(hand)` from root.

Timing details: `logs/magnetic-wand-timing.csv`.
