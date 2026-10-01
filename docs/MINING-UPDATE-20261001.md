# Mining Update: physical extraction slice

The first slice connects Stonewhisper, Starfall, ordinary deposits, physical rewards and existing resource uses. Work a local seam repeatedly: crack, expose, extract, then deliberately collect. Hitting a rock no longer immediately credits the inventory. Existing pick art, Sonnet-authored swing, adaptive held-object inertia, material audio, haptics and hard-surface resistance remain in use.

## Play

- FPS: left-click with Stonewhisper to work a seam; hold right-click to charge resonance (8 seconds), then strike. Aim at a freed chunk and press **E** to collect without dropping the pick. E elsewhere retains gentle drop; X retains throw.
- VR: strike with a sharp pick point, then collect a loose chunk with a nearby free-hand grip. Shaft and shallow glancing contacts do not extract material.
- RTS: cast Starfall, leave its impact area, and mine the landed meteor as the Hero. Star-gems feed Crystal Fault; star iron feeds Earthen Wall. Ordinary stone, iron and crystal enter the Hero pouch through the existing workshop bridge.
- Existing mining deposits share staged extraction. Additional deterministic deposits sample supported ground, slopes, moisture and protected traversal areas.
- Picks work local golem armour: repeated work at a plate can break it and expose a weak point. This does not add golem limb dismemberment.

Relaunch normally to load. This task did not restart the resident game, SteamVR or service, and did not reset user saves.

## Systems and bounds

`mining_damage.gd` is the shared material/angle/energy and local damage model. Six profiles exist: stone, iron, crystal, meteor, ice and obsidian. Profile support does not mean ice/obsidian deposits now exist. A single capped high-energy hit cannot instantly extract fresh ore. Nearby contacts accumulate at the same bounded, serialisable damage site.

`mining_deposits.gd` owns ordinary deposit state, respawn generations and deterministic reward IDs. `landscape_meteor.gd` owns meteor veins, scars and depleted reserves. `golem_runtime.gd` applies these rules to armour regions. `mining_runtime.gd` integrates contacts and collection with the actual game.

`mining_pickups.gd` preserves up to 6,144 pending rewards but activates only the nearest 16 physical bodies. Distant rewards are records; sleeping chunks remain collectible. Claim identity and pending removal share one atomic world save. Ordinary inventory delivery uses a persistent outbox, idempotent service IDs and retry. A per-world epoch avoids reset-world claim collisions. Full stockpiles/queues preserve chunks; extraction pauses at the pending limit. World files share an 8 MiB read/write limit; over-limit writes preserve the previous save. Mining records have independent count, finite-number and coordinate validation. Older saves remain compatible.

## Artist and review

Claude Sonnet 5.5 produced `mining_visual_art.gd`: opaque faceted crystals, shell chunks, staged fracture relief and shared material shaders. Commissions verified personal `fauxgrady@gmail.com`, Claude.ai Pro and explicit `claude-sonnet-5-5`; inherited API billing overrides were removed. No paid extra usage or publication was commissioned.

The initial commission reached 420.325 s, then a 72.710 s finalize run verified source and isolated renders. Actual-game review revealed overly ornamental bronze/white fractures. Broad refinement spent 150.362 s without edits. A narrow material revision delivered source and handoff in 31.135 s, but reached its six-turn CLI cap before a successful final result. Its metadata verifies the model; Codex reviewed the material diff and independently compiled, integrated and rendered it. Source archive preserves that distinction.

Ten native captures in ignored `outputs/mining-update/` show first contact, exposure, extraction and physical rewards from FPS/overhead, plus quarry views. Fractures now use a more restrained stone treatment. The shell still uses bounded surface relief, not arbitrary destructive mesh cutting. Briefs, metadata and handoffs are in `assets/source-commissions/sonnet-mining-20261001/`.

Art cache: 24 meshes, ten shared materials, two shaders. Fracture stages: 179–185, 343–474, 708–865 triangles; crystals 280–294; shell chips 313–320. No per-crystal lights, transparency or refraction. Existing pooled Starfall lighting follows exposure.

## Verification and measured cost

- Damage, meteor state, pickup JSON/duplicates/budgets, ordinary deposits and golem checks passed.
- Full-game extraction/save/reload/collection check passed in 10.088 s before final queue guards; final result is in `logs/mining-update-complete.log`.
- Native visual review: ten captures, zero assertion failures, 16.535 s engine time. Warm CPU microbench: 1,000 damage calls 6.219 ms; 1,000 ticks with 16 physical pickups 7.580 ms. These are **not** HMD frame-rate measurements. Capture startup logged a 148 ms hitch; broader startup/rendering hitches remain.
- Pick orientation: 24 checks, zero failures, 16.627 s; actual attachment/holster diagrams, not headset comfort certification.
- Service tests passed; disposable full service/game integration passed in 68.813 s, including actor timing, contact, QoL and crossbow ledger.
- Spell, pooled-presentation and 128-record Starfall scaling checks passed. Measured steps/retries are in ignored `logs/work-timing.csv`.

Offline checks disable XR/audio and use disposable world fixtures. No headset playtest. Full fixture reports four ObjectDB instances at shutdown; this warning is distinct from assertion failures.

## Next extensions

This is the requested first vertical slice. Outstanding: mineable Crystal Fault spires, RTS worker mining orders, ice/obsidian world deposits, richer crystal growth/fracture animation, arbitrary shell chunk removal and deeper golem dismemberment. Shared contact/damage interfaces support those extensions.

## Reproduce

Run `node service/test.cjs`, then `node service/integration.cjs` (disposable service port 8788). Focused Godot scripts: `mining_damage_checks.gd`, `mining_pickup_checks.gd`, `mining_deposits_checks.gd`, `landscape_meteor_checks.gd`, `golem_checks.gd`. Full `mining_update_checks.gd` requires `-- --world-builder-check`.

Native capture: bundled Godot console with `--xr-mode off --audio-driver Dummy --no-focus --position -16000,-16000 --resolution 1280x800 --path godot --script res://mining_visual_capture.gd --quit-after 2400 -- --world-builder-check`. Headless GPU readback is unavailable. Local developer evidence is not a remotely hosted showroom.
