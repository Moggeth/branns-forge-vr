# Activity input and cancellation review

The final bounded activity review inspected main input routing, Echo clappers, Sunskipper ownership, Lantern receiver cancellation, cargo levers, Festival travel, ordinary fair actions and tool switching. No normal saves, services or resident applications were used.

Two concrete defects were identified and handed to the coordinator for shared-runtime fixes:

1. **Desktop world buttons were unreachable while using the Sunskipper.** Main invoked the ring trigger before checking world buttons. A held-ring click changed power; E threw; an in-flight click recalled; catching attached the ring again. Consequently a normal click on Lantern PLAY AGAIN/PUT AWAY or other activity controls never reached the button action. The coordinator added desktop-only, nearby activity-button priority after physical clapper/cargo ownership blockers and before ring/wand triggers. Ordinary empty-space clicks, VR behavior and unrelated actions retain their existing semantics.
2. **Pocket travel could arrive in an invisible court from another adventure zone.** `living_runtime.safe_travel` moved the rig but left the source zone selected. Activity courts are parented to `adventure.zone_groups.forge_yard`; travelling from Pinewood therefore left those visuals hidden even though their physical floor was reachable. The minimal coordinator fix derives the destination zone from the validated floor collider's ancestor chain and activates that zone only after landing checks succeed. Failed travel must preserve the original zone and visibility.

The focused regression is `godot/arcade_input_ownership_checks.gd`:

```powershell
./tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://arcade_input_ownership_checks.gd --quit-after 300
```

It runs the real `main._trigger` method with real Sunskipper, magnetic wand and Echo ownership. Main startup is overridden so no service/save lifecycle runs. The aimed button hit is a bounded synthetic `_ray` result: this is a dispatch/ownership regression, not a full physical mouse-ray walkthrough. Safe-travel floor and standing-clearance queries use actual Godot physics geometry. The coordinator separately owns full-process button-ray verification.

Coverage includes held/in-flight ring button clicks, held-wand buttons, ordinary power/recall/magnetic input, out-of-range and unrelated actions, unchanged VR priority, clapper trigger blocking, no stealing an occupied clapper hand, cancellation after external travel, failed-landing preservation, and destination-zone visibility.

After both coordinator fixes, all 18 focused assertions passed with no script errors or warnings. Process wall time was 0.965 seconds; the native test body reported 0.026 seconds.

Other inspected paths were consistent: Lantern abort clears its accepted throw ID before a late hit can advance the round; ring return rejects a newly occupied hand; external travel moves a held Echo clapper outside its distance guard and cancels without ringing; Echo restart/abandon clears an armed pull immediately; cargo resets release the magnetic target before returning parcels. No additional substantive defect was established.

Fixture lessons: a minimal tuning double still needs `value(key)` because real ring release reads toss tuning, and a bare Living runtime still needs a components double for `busy(hand)`. Missing either can print native script errors even when the process exit code is zero. Treat script-error output as a failure, correct the double, and require a clean run. Runtime filenames are `adventure_runtime.gd`, `qol_runtime.gd`, and `living_runtime.gd`; use `rg --files` before guessing a shorter name.

Measured inspection and check timings are recorded in `logs/playful-encounters-timing.csv`.

## Final bounded review: inactive controller ownership

A later review found one additional reproducible cancellation gap: main skips input for an inactive XR controller, while Echo's clapper tick only checks whether the holder object exists, conflicts with another owner, or has moved too far. A valid but inactive controller therefore retains the clapper and blocks the other hand from taking any bell.

A disposable headless probe instantiated the real Echo module with an inactive `XRController3D` in the retained-holder state. After 300 ticks (4.8 simulated seconds), `get_is_active()` was false, `busy(hand)` remained true, and a second hand at another clapper could not grab it. This verifies inactive-state handling; it does not claim a physical headset disconnect test. The probe was removed and normal saves were disabled.

Recommended correction: cancel activity ownership when an XR controller becomes inactive, without invoking ordinary throwing/release actions. A central check before main's inactive-controller `continue` can use Echo's cancellation, cargo's non-launching release, and ring/wand home methods. Calling generic `adventure.release` would be wrong here because it can throw the ring or ring an armed clapper. Similar retained-owner guards in cargo, ring and wand warrant the same narrowly bounded cleanup; their missing inactive checks were inspected in source, while Echo was the directly reproduced case. The coordinator owns any production integration and its verification.

The coordinator then authorized and received the localized fix: `main._cancel_inactive_playful_hand(hand)` runs before the inactive XR input skip and cancels only the affected hand's Echo, cargo, ring and wand ownership. The new `inactive_playful_hand_checks.gd` constructs all four real modules with diagnostic saving disabled. Its 18 checks passed cleanly in 0.949 seconds, confirming no note, throw or cargo launch, safe magnetic-target release, immediate other-hand access, and preservation of tools already owned by a different hand. Desktop/synthetic non-XR hands are unaffected. No normal saves, resident process, headset or packaged ZIP was accessed.
