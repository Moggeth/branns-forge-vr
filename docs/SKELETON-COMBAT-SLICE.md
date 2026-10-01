# Skeleton combat slice — 27 September 2026

The first combat proving ground is Orchard's Edge against Mossward skeletons. Jev is deliberately not part of this feature. The system is intentionally narrow: the axe is the only blade with edge-aware contact, and skeletons are the only enemies with persistent body-part damage. Generalize to picks, golems, and other weapons only after a headset playtest establishes satisfying force, bite, and release thresholds.

## Play

Use Orchard's Edge normally to strike a skeleton. The edge (+X in the authored GLB) hits as a blade; the poll or a broadside hit acts as a blunt strike. Strike the same limb again to break it off, or hold the gripping hand's trigger through a swing for a much stronger cleave. On desktop, hold right mouse while left-clicking to use the powered swing. A blade that lacks enough energy stops in the target. Pull it back to free it; a fast yank may tear a loose bone onto the axe, where the other hand can pick it off. Detached bones are physical pickups and clubs. Blunt force causes local recoil, stagger and joint damage while an ordinary living skeleton holds its ground; death releases the dramatic physical scatter. A missing leg slows it and selects a one-legged hop; missing arms weaken or disable its attack. Armor/shields still block frontal hits under the existing guardian rules.

The damage calculation uses contact speed, item mass, blade alignment, and a finite energy budget for follow-through. These are **gameplay approximations**, not a rigid-body simulation of cutting through anatomy. Tune the thresholds in `godot/melee_contact.gd` and `godot/skeleton_structure.gd` after headset feedback. The scripted desktop swing exercises the same contact path but cannot validate VR hand comfort or perceived force.

## Assets and ownership

- `godot/weapons/orchards_edge.glb` is the playable textured axe. The isolated Opus 5.5 commission, Blender builder/source, renders, measurements, and handoff are in `work/opus-axe-20260927/output/`. The asset has an applewood/leather grip, a steel edge and poll, and named edge/grip markers. Its geometric mass estimate is not used; gameplay mass is 1.65 kg. The original GLB has its cutting edge at +X; the playable `AxeHeadOrientation` mount turns the art 180° around the +Y handle, placing the edge and contact tip at −X without altering the controller grip. The collider is recentered toward −X, and melee classification distinguishes that edge from the +X poll. Keep those four pieces in sync when replacing axe art.
- The installed Mossward, Prismwatch and Cinderkeep GLBs now have articulated knees/feet and eight Sonnet 5.5-authored clips. The earlier Mossward knee commission is superseded by the tracked family source in `assets/source-commissions/sonnet-skeleton-motion-20261001/`. See [the current motion/contact handoff](SKELETON-ANIMATION-20261001.md) for rebuilds, independent foot planting, injury movement, attack sweeps and measured checks.
- `godot/skeleton_structure.gd` owns persistent cracks, local stress, part detachment, and degraded movement/attack metadata. `godot/melee_contact.gd` owns the weapon contact and bite/withdrawal rules. `godot/physical_remains.gd` retains loose bones, including a bone lodged on a held or stowed axe.
- Authored guardian remains are now baked from the visible weighted pose at detachment/death, preserving geometry, materials and motion. Detached legs keep spring knees/ankles and a collider/contact tip covering the foot. Legacy rigid pieces remain a fallback for procedural actors. The torso of an imported guardian is a single skinned group and currently cracks rather than shedding an individual rib while alive. Procedural skeletons can shed ribs.

## Verification and recovery

Run from the project root with the bundled Godot executable:

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot -- --skeleton-combat-check
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot -- --guardian-check
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://guardian_authored_animation_checks.gd
pwsh -NoProfile -File scripts/check-guardian-rigs.ps1 -OutputDirectory outputs/skeleton-motion-rebuild
```

Expect `SKELETON_COMBAT_RESULT []`, `GUARDIAN_RESULT []`, `GUARDIAN_AUTHORED_ANIMATION_PASS assets=3`, and rig JSON rows with `failures:[]` and knee/foot chains. Rebuild the motion family before inspecting `outputs/skeleton-motion-rebuild` using the command in its [source handoff](../assets/source-commissions/sonnet-skeleton-motion-20261001/README.md). The guardian scene check cracks and severs an authored Mossward arm, in addition to shield and respawn checks. `grip_pose_checks.gd` additionally verifies axe edge/tip alignment and blade-versus-poll classification with both simulated VR hands. Current motion captures are under `outputs/skeleton-motion-review/`; the earlier `outputs/mossward-knee-combat.png` and `outputs/orchards-edge-orientation-fixed.png` are historical references. Rendered fixtures do not establish headset motion acceptance. Copy only verified GLBs into `godot/`, run Godot editor import, and inspect its log as well as running the script checks: import can exit 0 despite a script parse error. Relaunch normally to load GDScript and GLB changes.
