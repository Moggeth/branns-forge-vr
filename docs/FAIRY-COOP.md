# Little Wing — same-PC fairy co-op

Run **Start Fairy Co-op.cmd** for the normal game, including Brann and existing
progress. One person wears the VR headset. The second uses the separate **Little
Wing** desktop window with mouse/keyboard or a gamepad. Click that window to give
it focus. The two cameras share one authoritative world and physics simulation;
desktop inputs cannot steer the VR rig or operate its tools.

For a solo rehearsal, use the portable **Play Flight Practice.cmd**. F3 offers a
visible practice hand nearby; approach and press F to perch, then F4 to toss it.
This hand is only created without XR. It does not replace tracked VR hands.

If the current game was launched before this feature was installed, close its
game window and relaunch. An up-to-date running game can open co-op with **F8**
in the game window, or **Toolbelt > Comfort > Fairy co-op window**. Closing the
fairy window leaves the host game running. F8 reopens it. Stop Brann.cmd remains
the normal project shutdown. Logs are timestamped `logs/game-*.log`, with
`FAIRY_COOP` events for joining, perching, scattering and leaving.

## Play together

- Fly within the host's current region, up to 65m away. Crossing that leash starts
  a gradual return. The host's **right B** or **Comfort > Call Little Wing** forces
  recall; steering cannot cancel it. If geometry blocks the route for eight
  seconds, a sparkle transition returns the fairy to the host's pocket.
- Fly within 30cm of a hand and press **F / A** to perch voluntarily. The view
  stays level, follows position gently, and ignores hand rotation. Flying off or
  pressing F/A detaches. A quick hand movement tosses the fairy with capped,
  inherited momentum. Extreme tracking jumps detach without a violent impulse.
- Perch on **Sunskipper** to ride the returning ring. The camera does not inherit
  its spin. Other held tools also offer a perch, with the hand-style motion limit.
- **E / X** lifts a nearby loose bone, physical pickup, match or fire vial. It is
  the actual shared object, reserved against duplicate grabs. A 0.6kg object cuts
  speed/thrust to a quarter; 0.8kg or more leaves you straining in place until you
  let go. Bringing it to a VR hand and gripping transfers it back. Carrying an
  already-lit match gently to oil ignites it; the normal match timer and blowout
  rules still apply. No free fuel or duplicate inventory items are invented.
- Fire small magical darts with **click / RT**. Body hits deal 4 damage, careful
  head hits 12, at most once every 0.4 seconds. Ghosts still only die to fire.
  Darts and reveal magic draw enemy attention for five seconds. Ground enemies
  stay grounded; ghosts can pursue upward. Enemy attacks, fire, crashes and
  explosions can hurt the fragile fairy.
- At zero health the fairy scatters into sparks, drops cargo, and reappears in
  the host's pocket after three seconds, with two seconds of protection.

## Fairy controls

| Action | Mouse / keyboard | Standard gamepad |
|---|---|---|
| Fly | WASD | Left stick |
| Rise / descend | Space / Ctrl | RB / LB |
| Look / steer | Hold right mouse and move | Right stick |
| Boost / brake | Shift / Alt | L3 / R3 |
| Dart / dust marker | Left / middle click | RT / LT |
| Look / danger / attack / pickup marker | 1 / 2 / 3 / 4 (X cycles) | D-pad up / right / down / left |
| Carry / release | E | X |
| Perch / hop off | F | A |
| Reveal | R | Y |
| First / third person | V | B |
| Hover / acro flight | C | Back |
| Roll in acro | Q / Z | Map rear paddles to Q / Z in Steam Input |
| Controls help | F1 | Start |
| Release mouse | Esc | — |
| Return to friend | Home | Host calls with right VR B |

Hover is approachable six-direction flight with automatic braking. Acro keeps
momentum, supports inverted flight, pitch loops and manual rolls; brake remains
available as a recovery action. Stick deadzone and curved response favour small
aim corrections. The mouse and controller can coexist.

### Steam Controller

The game accepts standard gamepad input or keyboard/mouse emulation. Steam
Controller support uses **Steam Input**, rather than a custom hardware driver.
For the portable demo, add `LittleWing.exe` as a non-Steam game and set launch
options to `--xr-mode on -- --playful-demo --fairy-coop`. Choose a Gamepad layout;
optionally map rear paddles to Q/Z and gyro to mouse for fine aiming. Mouse-look
requires right mouse held, so bind a gyro-enable chord to that input too.
The helper window must have focus. Avoid binding the same action to both a
gamepad button and an emulated mouse button, which could double-trigger it.

Valve references: [gamepad emulation](https://partner.steamgames.com/doc/features/steam_controller/getting_started_for_devs),
[Steam Controller configuration](https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=353370&issueid=362&nodeid=30).
Physical Steam Controller and headset acceptance still require a human playtest.

## Magic and persistence

Dust is an arcing projectile. On contact it makes a coloured glowing patch with
a stem perpendicular to the surface; petal counts distinguish the four messages
alongside colour. It follows movable struck surfaces. Up to 24 marks persist for
the session, removing the oldest at the cap; inactive-region marks hide and
return on revisit. Marks are not saved across relaunch. Closing co-op hides them;
reopening restores the retained marks. Sparks and temporary reveals stop cleanly.

Reveal outlines nearby enemy heads and authored `fairy_revealable` clues for five
seconds. A small Moonseed at the forge teaches the clue effect. This extension
point does not unhide collected resources or bypass workshop progression.

Zone travel keeps both players together. Dropped cargo remains in the old region,
with its original ownership and collision rules. The fairy cannot independently
activate another region while the host is playing elsewhere.

## Scope, tuning and performance

`godot/fairy_coop.json` reloads every three seconds in source play: movement,
boost, drag, acceleration, deadzone, sensitivity, perch distance, toss threshold,
throw gain, range, dart damage and desktop render scale/distance are clamped.
This makes live refinement possible without rebuilding the normal source game.
Portable snapshots embed their copy; rebuild them after changes.

The extra native desktop window shares World3D but has `use_xr=false`, its own
camera and its own UI. Native windows stay separate from the XR viewport.
The desktop scene defaults to 75% render scale, 100m far plane, no MSAA and a
1024px local shadow atlas. Its VSync is disabled so a 60Hz companion monitor does
not deliberately throttle the headset. This is not adaptive resolution or a
guarantee of headset frame rate. Butterfly geometry is batched by animated part;
96 pooled dust particles, 24 projectiles, 24 markers and one small shadowless
fairy light bound the added effects. A second view still costs rendering work.

This initial version includes precision darts, reveal and physical carrying.
Fairy bombs/sticky grenades are not included. There is no network multiplayer,
separate fairy progression, or independent-region streaming. Normal game progress
is unchanged; the optional offline demo resets on exit and needs no paid service.

## Verification / recovery

`node scripts/check-fairy.cjs` checks the actual main scene with disposable
offline state: separate viewports, input routing, flight, collision, physical
projectile hits, head crits, ghost immunity, perching, throws, ownership, handoff,
zone drops, carried-match oil ignition, forced recall, death and cleanup.
`--pack outputs/fairy-coop-build/LittleWing.pck` verifies the exported snapshot.
`godot/fairy_capture.gd` produces actual two-window render captures and scoped
desktop GPU measurements in `outputs/fairy-coop/`.
Build with `scripts/Build-FairyCoop.ps1`. Test/capture/build logs and measured
durations live under `logs/`; `docs/VERIFICATION.md` records fixes and limitations.
If the fairy window is lost, F8 focuses it; if a controller disconnects, flight
coasts/brakes and the next connected controller is selected. Close/reopen co-op
to reset the fairy to the host. Never restart SteamVR merely to reset the fairy.

Blue-light update: solo practice starts at the Forge Yard common-goods bench with loose matches, the real matchbox and bottles. Back mouse/E picks up or drops. Click/RT opens a held box; set it down and pick a match from its open drawer. Carry a fresh match within 40 cm of the box and click/RT for an assisted physical striker stroke. Fly gently with Alt/brake to preserve the flame. Escape frees the cursor; the next click resumes looking without firing. V shows the new blue winged-light body.

MATCH-BAT UPDATE
Nearby reachable pickups show a small Back/E hint. Left click/RT belongs to the held item: open/close a matchbox, swing a match, or swat with another object. No darts while carrying. Right-click still casts a guiding dust mark.
Bring a fresh match within about half a metre of the matchbox and click. The fairy winds up, meets the side panel, scrapes along it and recovers. A blocked path or a box moved out of reach cancels the strike. Ignition requires actual collider contact and enough scrape distance; sparks and the warm flare follow ignition. Dropping cancels the animation. Matches retain their ten-second life and blowout rules.
Hover now accelerates at 28 m/s� and stops at 34 m/s�, with the same 5 m/s top speed. Camera follow is tighter; perch smoothing remains gentle. These and match reach/scrape distance remain editable in godot/fairy_coop.json, hot-reloaded by the source game.

DISPLAY & PRECISE LOOK: starts maximized. F11 toggles fullscreen; F10 maximize/windowed; F6/F7 left/right half-screen on the current monitor. Escape releases the pointer. [ / ] changes sensitivity for this session. Captured aiming uses unscaled screen deltas, no added mouse acceleration or smoothing, and immediate first-person camera rotation. Gentle perch positional smoothing remains.

MATCHBOX & FUEL UPDATE: Back mouse/E near an open box takes one match. Hold Shift while picking up to lift the whole box (controller: hold L3 + X). Closed boxes pick up normally. Dropped boxes have a low-bounce body and an open-drawer collider.
Spilled fuel burns for approximately eight seconds. Unlit fuel lasts roughly 50% longer than the original demo (measured single bottle: 26.4 -> 39.8 seconds on flat ground). Lamps and torches retain their longer lifetimes. Match and wick timers remain ten seconds. Tuning: spill_burn_seconds and spill_unlit_lifetime_scale in firecraft.json.
SOLO HAND: F3 brings the visible practice hand nearby. F perches; F4 flings you forward. Steer or brake to regain control; Home recalls you. Pings expire after eight seconds; Delete clears all pings. A lit match swing can ignite nearby wicks and fuel along its actual path, blocked by solid walls.

OPTIONAL GUIDED PRACTICE
At the Forge Yard, F2 starts Flight & Flame. Follow the blue in-world board: perch, fling, brake, take a match, strike it, share its flame with a bottle wick, cast a dust marker, then clear it. F2 pauses; Shift+F2 starts again. Retry drops what you carry and stops your flight; it does not reset the world or award progression. V chooses first/third person; [ / ] adjusts mouse sensitivity. Camera choice, sensitivity and help visibility save separately in fairy_preferences.cfg under Godot's Brann's Forge VR user-data folder. Hover remains the safe starting flight mode; C toggles acro during play.
