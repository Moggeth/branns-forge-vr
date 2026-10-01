# Skeleton animation and physical continuity — 1 October 2026

Mossward, Prismwatch and Cinderkeep now use Sonnet 5.5-authored bent-knee rigs and eight clips: idle, walk, attack, stagger, left/right turn and left/right hop. Their existing silhouettes, shields and materials are preserved. Codex owns gameplay, procedural corrections, integration and verification.

## Play

Relaunch normally through Brann's Forge Launcher to load the scripts and meshes. The current game, forge service, SteamVR and saves were left intact during development. Find the three guardians in Pinewood, Crystal Hollow and Ember Foundry, or summon a shield patrol from World Builder. No new controls are needed.

Feet independently anchor to the ground during stance, lift through swing and replant when turning. Knees bend forward and ankles follow modest slopes; the gameplay root remains under adventure/navigation control. Idle, walk, turn, attack and stopping poses blend rather than snapping. Movement adds a small lean, delayed skull follow and restrained loose-bone sway.

Head, arm, shield-side and torso hits now produce local recoil. Ordinary hits keep a living skeleton's root planted; strong hits interrupt it with a short stagger and balance step. After death, the physical scatter remains. A missing leg selects a one-legged hop with real airborne foot clearance; losing the shield arm creates an asymmetric stance and a brief glance at the missing part. Losing the weapon arm prevents attacks, and losing both legs prevents locomotion.

Attacks have a visible windup, a committed strike and a recovery. Contact samples the moving hand/weapon segment against the Hero or fairy capsule after animation, with a once-per-attack latch and solid-wall rejection. Dodging the swing can avoid damage. Each guardian's approach range is derived from its own imported attack rather than one generic radius: **Mossward 1.03 m, Prismwatch 1.00 m, Cinderkeep 1.30 m**. The profile is cached across instances and invalidated when its mesh, clip or scale changes. Basic Director skeletons and World Builder duelists retain their procedural art and powers; their animated right-arm geometry uses the same sweep/contact mechanism, with a measured **0.82 m** approach range and a bounded allowance for the fused mesh's width.

Severed parts and death remains retain their actual visible pose, mesh and materials. Part motion is inherited, with bounded additional scatter. A detached leg retains its bent knee and ankle, springs around their actual captured joint positions, and has a full-length collider plus moving foot collider/contact tip. Bolts hit the posed weighted bone geometry; lower-leg attachments follow their knee/ankle rather than the hip alone. The authored torso is still one mesh; individual rib extraction remains limited to procedural skeletons.

## Ownership and contracts

- `guardian_authored_animation.gd`: clip selection, short pose transitions, movement personality, local reactions, injury state, shield visibility and restore.
- `guardian_foot_placement.gd`: world-space stance anchors, terrain probes, two-bone IK and turning/balance steps. It never moves the actor root. The direct chain is `Left/RightLeg → Left/RightKnee → Left/RightFoot`, with +Z as the forward knee pole.
- `skeleton_attack_contact.gd`: bounded animation-sweep/capsule contact and shared reach profiles. Probing restores the complete rendered bone pose, visual transform and adapter/AnimationPlayer state.
- `adventure_runtime.gd`: pursuit, attack phase timing, planted living roots, interruption and damage. `main.gd` resolves skeleton contacts after the animation/guardian ticks.
- `skeleton_pose_handoff.gd`: CPU skin snapshot with normals/tangents, material preservation, actual knee/ankle pivots and two-sample pose velocity history.
- `skeleton_structure.gd` and `physical_remains.gd`: live detachment, corpse parts, spring response, pickups, skull identity and lifetime/body budgets.
- `guardians/skeleton_guardians.gd`: posed weighted-mesh projectile contact, per-frame bake cache and dominant-bone bolt attachment.

Restore resets anchors, injury/recoil state, transitions and motion history. Teleports or loss of ground reset stance anchors. Shield visibility is synchronized even in hidden regions so a stolen shield does not return in the authored mesh.

The art source, verified identity/model, original delivery and reproducible builder are in [the commission handoff](../assets/source-commissions/sonnet-skeleton-motion-20261001/README.md). Each installed GLB has **13 bones / eight clips / seven meshes**; triangles remain **17,092 / 14,454 / 18,454**. There is no separate jaw bone; secondary motion uses the existing skull and body. Source scenes and inputs are tracked intentionally; runtime captures, imports and logs remain ignored.

## Checks and review

From the project root, using the bundled engine:

```powershell
$engine = 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://guardian_foot_placement_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://skeleton_attack_contact_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://guardian_motion_checks.gd -- --bench
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://skeleton_pose_handoff_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://skeleton_projectile_contact_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://skeleton_attack_runtime_checks.gd -- --world-builder-preview
& $engine --headless --xr-mode off --audio-driver Dummy --path godot -- --guardian-check
& $engine --headless --xr-mode off --audio-driver Dummy --path godot -- --skeleton-combat-check
& $engine --xr-mode off --audio-driver Dummy --path godot --script res://guardian_motion_review.gd
```

The last command uses an offscreen, unfocusable native renderer and writes **37 settled views** plus `manifest.json` to `outputs/skeleton-motion-review/`. It covers walk phases, turning, head/shield-side recoil, grounded/airborne hops, windup/strike/recovery, restoration and close foot/weapon socket guides. Guides mark joint centres; an ankle centre about 10 cm above the surface is not a floating sole. Every capture settles the pose transition for 18 fixed simulation ticks before readback. Headless runs cannot validate images.

Final foot, contact, motion, snapshot and projectile checks pass on all three rigs. The actual-Main check removes ordinary player invulnerability as a mask for duplicate damage: a centered Hero takes one hit, a dodge takes none, disarm/stagger prevents attacking, and the actor root stays planted. It also checks approach, hit-once, dodge and disarm for a procedural duelist with no guardian entry. Existing guardian and skeleton-combat gates also pass. Detailed logs and measured steps are under ignored `logs/`, with failures/recovery in [verification lessons](VERIFICATION.md).

## Measured cost and limits

Isolated headless CPU samples with the installed rigs measured approximately **0.56–0.66 ms for 12 / 1.43–1.67 ms for 30 / 2.62–2.83 ms for 60 actors per update**, over 30 updates per count. This measures authored animation, corrections and pose sampling; it is not a GPU, whole-world or headset frame-rate claim. Terrain probes are limited to two per visible actor update. Hidden-region actors skip posing after shield synchronization.

Capturing a 1,170–1,256-vertex leg took about **0.76–0.88 ms**. Weighted lower-leg projectile queries measured **1.30–1.35 ms** for the first bake and **0.38–0.40 ms** for a same-frame cached query. Loose remains retain the existing **120-body / 90-second** budget and skip settled spring work. No lights or texture families were added by this animation pass.

The deterministic Blender rebuild took **1.942 s** and matched all three installed SHA-256 hashes. Generic asset gates took **2.28–2.37 s per asset**, including disposable Godot imports. The final native review took roughly **3.1 s**. Those timings overlap with parallel work and must not be summed as total task duration.

Headset acceptance remains a playtest: review close combat timing, very steep/irregular ground, large crowds and perceived detached-leg weight in VR. IK and impact response are bounded gameplay approximations. A single held rigid body carries the spring-deformed leg, rather than a costly full limb ragdoll.
