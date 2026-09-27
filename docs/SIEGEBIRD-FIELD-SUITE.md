# Siegebird field suite — 2026-09-17

The original articulated GLB and two-hand aiming solver are preserved. New controls, optics, ammunition and reel parts are additive.

## Play

- Grip the crank: the visual hand eases onto the knob over 0.08 seconds, with curled fingers. Raw tracking remains untouched. Grip release, tracking loss or dropping the weapon detaches it. Separation over 0.38 m for 0.15 seconds, or 0.65 m immediately, breaks attachment. Regripping resumes ratchet progress.
- Wind twice (once with Quickwind), release the crank, take a bolt from the front belt quiver, align it tip-forward on the rail, and release. Trigger fires. Return a held bolt by releasing near the quiver.
- Bolt supply is unlimited and free. Take a fresh physical bolt from the belt whenever needed; the Field Supplies pack remains as a reminder but charges nothing. Loaded chambers persist. A new chamber starts unloaded; crank and seat a bolt in VR, or press R on desktop to reload.
- Base damage 95, speed 28 m/s, gravity 2.4 m/s². Skeleton headshots do double damage. The crystal sight highlights weak points as standard. Three tiny ballistic references correspond to 5/10/20 m. The optional legacy Truesight module extends detection from 25 to 42 m.
- Grip embedded bolt shafts to retrieve and reload them. A bolt that kills an enemy drops physically. Stone/metal get a shallow bite, timber/actors a deeper seat with different sound. Loose/fired bolts last two minutes; embedded cap 20. Ghosts still ignore bolts.
- Grip the free reel on the supply table and release it against the side socket opposite the crank. Grip the small brass selector to switch bolt/grapple mode. Hooked prongs distinguish grapple bolts.
- Fire at scenery or a brass anchor, then grip and wind the crank to pull yourself in. **Holding-controller trigger releases the line immediately**, even while cranking. Dropping/stowing, losing the surface or changing zone detaches. Movement uses a capsule sweep; safe anchors approach above a ledge and descend to the landing point.

## Brann's live adjustments

`configure_invention` publishes parameters from `game.interactionCatalog`. The currently registered profile is Siegebird: damage (65–140), bolt speed (18–36), reel speed (0.5–3), crank break distance (0.2–0.55), snap time (0.03–0.15) and loading reach (0.08–0.28). Held equipment updates after the normal state refresh; snap time applies on the next grip. Explicit per-item profiles override global tuning baselines.

Examples: “Make the crank more forgiving,” “Slow the grapple down,” or “Increase Siegebird's power.” The native game logs `INTERACTION_PROFILE_APPLIED` and reports applied revisions in Brann's context. Published and applied are distinct states.

Existing generation already imports completed GLBs and validated sandboxed trigger abilities during play. This suite **does not hot-load arbitrary native scripts, new physics systems or arbitrary environments**. New native behaviors still need implementation and a game restart. Do not promise unlimited functionality.

## Reusable components

- `godot/anchored_hand.gd`: target-relative hand rendering and easing, separate from controller input.
- `godot/traversal_tether.gd`: surface-local attachment, persistent rope mesh, capsule-swept movement and staged landing.
- `service/supplies.js`: persistent finite rounds, unique tokens, legal ownership transitions, idempotent requests, transactional rollback, validated stock and bounded retirement. Chambers are keyed by weapon ID.
- `godot/siegebird_extras.gd`: concrete shop, reel, native ammunition transactions, reticles and live-profile application.
- `service/interaction-profiles.js`: validated profile publication and discoverable capability limits. Other native systems can register profiles in future; only Siegebird is exposed today.

Stock/chambers persist across launches. Loose world bolts do not: held rounds return to stock on resume and previously fired rounds are retired. This prevents duplication but is not full cross-session world persistence. Receipt history retains 128 request IDs; immediate retries reuse the same ID. Stock is capped at 120 and the active token ledger at 240, with retirement as scene objects expire.

## Verification and maintenance

Run `Verify Brann.ps1` for all checks. Native crossbow checks cover attachment/escape/release, drivetrain, forward-only seating, trigger and dry fire, two-hand aim, live profile application, reel installation, tether release, and reeling to an actual Sky Garden landing. Native HTTP checks buy, draw, load, fire, recover and return a bolt, then release during an asynchronous draw and verify conservation. Service tests cover persistence, duplicates, illegal transitions, rollback, bounds and corrupt saves.

Fast iteration:

```
node --test service/supplies-test.cjs service/interaction-profiles-test.cjs
node scripts/check-siege-ledger.cjs
```

The latter reuses the latest isolated full-verifier fixture, refuses occupied port 8788 and writes `logs/siege-focused-ledger.log`. It makes no paid API calls. Native mechanism command: bundled Godot with `--headless --xr-mode off --path godot --quit-after 1200 -- --siegebird-check`. Require `SIEGEBIRD_RESULT []` and no script errors.

`work/siege-handle.png` shows the actual hand/knob pose. Generate it with `--capture-siegebird --siegebird-angle=mechanism --capture-siege-handle` added to an ordinary capture. Isolated desktop sample: 115 FPS, 144 draw calls; this is not a headset performance guarantee. Knuckles ergonomics, sight comfort and reel speed still need player feedback.

Use the existing start/stop launchers. Logs remain under `logs/`; ammo/profile state lives in `service/data/player.json`. Preserve that file for recovery rather than resetting it. No new dependency or credential was introduced.

Interaction references: [Valve's interaction system](https://valvesoftware.github.io/steamvr_unity_plugin/articles/Interaction-System.html) and [Unity XR attachment easing](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@2.0/manual/xr-grab-interactable.html). The implementation remains native Godot.

Final suite verification: 37.704634 seconds, including native HTTP round conservation and actual Sky Garden landing. No script errors or audio leaks in the final suite. Forge service update took approximately 3.5 seconds; player/tuning backups were saved under work/backups/player-before-siegebird-suite-* and tuning-before-siegebird-suite-*. Existing collection and progression retained; new supply ledger has six initial rounds. The game was closed, so no VR session was interrupted or launched. Features load on the next normal game start; supported profile changes subsequently apply live.


## Siegebird III — tactile refinement (17 September 2026)

The shaped walnut/leather grip now sits below the stock, with copper bird relief, an open guard and an actuating trigger shoe. Squeeze through take-up to fire: `crossbow.trigger_break` defaults to 0.72, resetting below 0.15. The trigger moves with analog pressure, and a bounded three-link index-finger solve seats the fingertip on its shoe while other fingers retain tracking. Two-hand aim still uses the two hand positions; the supported grip range now follows the new handle height.

The drive is 4 cm closer to the stock, with bearing blocks and shafts entering the body. The drum has a tangent take-off at its winding radius. A flanged return pulley has a recessed groove and an analytic tangent exit towards the sled. Blender and native runtime use the same 18-segment cable path, plus two constant-length bowstring segments. Braided shader markings advance by cable travel during winding; no per-frame mesh allocation. Drum travel/radius/gear ratio remain linked. This is a stylised mechanism, not a manufacturable engineering claim.

Flight defaults: 44 m/s (previously 28), gravity 4 m/s² (previously 2.4), linear drag 0.12/s. Exact exponential integration keeps drag stable with frame rate; optic range references use the matching trajectory. All three flight settings and trigger break remain in the tuning schema. Existing per-item profiles can override base speed; the current player's profile was empty when applying these settings, saved at tuning revision 12.

Grip an embedded shaft to retrieve it, then release near the quiver to restash. The quiver stays visible in VR and while holding a bolt. Loose/hand-held bolts retain their finite-ammo token, can stab for 24 physical damage on a swept-tip hit (0.4 second cooldown, minimum 0.8 m/s), and carry sampled hand velocity when thrown. They do not bypass ghosts' fire-only immunity. Fired bolts still embed and persist under the existing 120-second / 20-bolt policy. Hand-thrown bolts use rigid-body collisions and remain loose rather than auto-embedding.

The hip belt no longer follows every glance: yaw has a 55-degree torso dead zone, freezes while looking down or the pouch is open, and resumes gently after looking forward and closing it. Position continues to follow the player.

Validation: 129 sampled assembly poses with no tested intersections; analytic spool/guide tangency; preserved two-hand aim; stabbing hit; pouch yaw lock/recovery; full native/service suite and finite-ammo ledger recovery/return. Full suite passed in 37.74 seconds; latest model build and native checks took 11.02 seconds. Inspected side and grip renders (`work/siege-refined-side.png`, `work/siege-refined-grip.png`). Synthetic fingertip gap was 0.031 mm after solving. This checks authored contact, not individual headset/controller ergonomics. Isolated desktop capture: 117 FPS / 185 draw calls, not a headset performance guarantee.

Capture a reusable close-up with `--capture=../work/siege-refined-grip.png --capture-siegebird --siegebird-angle=grip --capture-siege-grip` on the ordinary Godot desktop/offline command.

## 19 September polish pass

- Added countersunk grip fasteners, leather stitching and a copper heel. Small cosmetic parts are batched by material (three meshes), preserving the existing silhouette and moving-part contracts.
- Added a modest status jewel and concise matching labels: winding percentage, place bolt, ready, grapple ready, and pending transaction. Repaired three corrupted Unicode labels/notices.
- Trigger-finger seating now uses the final weapon pose in the current frame. Finger roll follows the palm rather than world-up. Other fingers continue normal tracking; no aiming/physics changes.
- Belt follow now finishes a gentle turn instead of stopping abruptly at the outer dead zone. Looking-down detection has hysteresis, and reaching into the belt freezes yaw in VR alongside the existing open-pouch lock.
- Braided cable shading fades fine contrast at distance to reduce shimmer; the bowstring pattern uses actual segment lengths.

Validation: both authored close-up and side renders inspected; 129 sampled assembly poses passed; rolled-finger contact and belt settling regression checks added; full service/native/ledger suite passed in 40.30 seconds. Model build plus native checks: 11.13 seconds. Final synthetic fingertip contact gap: 0.025 mm. Captures: `work/siege-polished-grip.png` and `work/siege-polished-side.png` (8.04 / 5.31 seconds). These are desktop checks, not headset ergonomic validation. Load these native/model changes on the next game launch; no service restart or player-state migration is required.
