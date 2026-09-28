# Fire and fuel audit (2026-09-28)

This began as a source-code audit. The native implementation landed on 2026-09-28; the original gap table below is retained as a historical record. The exact combination that failed in the user's earlier playtest remains unknown.

## Implemented

- `heat_contacts.gd` accepts bounded hot points and swept segments with zone, radius, strength, duration and source identity. It queries only local fuel cells, clips at solid geometry, reaches pending spills during the first surface scan, heats fresh match/vial wicks and Living Workshop material components, and melts nearby snow. Native matches, fairy matches, hearth torch, Wyrmspout packets and attached flames, Sunfall, Ember Gauntlet, scripted ignition, burning authored fixtures and generated heat emitters call this route. Existing combat fire damage still follows its own typed damage rules.
- Burning surface fuel ignites adjacent fuel through the existing 10 Hz solver, plus nearby wicks and combustible components. Local water wets and quenches fuel, authored fixtures and generated materials; rain wetness transfers to the active surface field where the weather sampler reaches it.
- Siegebird bolts exposed to a flame at firing carry a brief glowing hot tip. Their swept flight and impact can light fuel or materials, and a hot bolt can damage a ghost as fire. Normal bolts remain physical projectiles.
- The Ember Gallery has a real three-sample basin: dry timber, damp timber that steams before ignition, and easy-lighting oilcloth. Torch, match, stream, spill and water experiments use the shared contacts, with no success-button substitute.
- Future Living Workshop packages can declare `{"type":"emitter","config":{"kind":"heat","strength":100,"interval":0.2}}` on a visible entity and use the existing `material` component's `ignition`, `absorption` and `hardness` settings for receivers. These data-driven components now exchange heat with native fuel and props without reloading the game. A completely novel mechanic still needs authored code or a supported component; a descriptive prompt alone cannot execute arbitrary new behavior.
- The liquid display uses connected mostly opaque tiles with an irregular meniscus, restrained pearlescent oil glints and slow surface motion. All 4096 cells retain physical fuel state; dense fire displays at most 640 sampled flame meshes, while all burning cells still contribute to spreading, damage and three pooled light regions.

Desktop checks: `scripts/check-fuel-combat.ps1`, `--siegebird-check`, `--wyrmspout-check`, `--living-check`, `fairy_heat_checks.gd` and `hearth_torch_checks.gd`. The Weather Lab `--fuel-stress --fuel-stress-count=1|10|40` capture prints FPS and solver/texture/visual update times. The 40-bottle quiet-PC capture settled at the lab's 120 FPS cap after an 88 FPS first sample; this is not a headset benchmark. See `docs/VERIFICATION.md` for the timing and capture evidence.

## Original behavior before the implementation

| Source | Can ignite other things? | Gap |
| --- | --- | --- |
| Emberdew vial | Lit impact adds burning fuel; unlit impact adds fuel | Player-held match lights a fresh vial wick but does not ignite a spill. |
| Surface fuel | Burning cells ignite adjacent fueled cells | Limited to one 24 m, single-height-layer field per zone, eight zones and 40 bottle equivalents. |
| Hearth torch | Calls `fuel_combat.ignite_near` and lights nearby wicks | Has its own contact path. |
| Fairy-carried match | Sweeps against fuel, vials and lamps | Reads ready grid cells directly, missing pending fuel during the surface scan. |
| Wyrmspout | Floor hit deposits new burning fuel | Wall/enemy/rejected-floor hits make separate patches that damage but do not ignite existing fuel. |
| Ember Gauntlet, Sunfall, scripted `ignite` | Inflict `"fire"` combat damage | Do not transmit heat to fuel or props. |
| Living Workshop material components | Have their own heat/wetness/ignition rules | Native flames do not feed that system. |

`firecraft.gd` gathers match, vial, Wyrmspout, pool, torch and fuel flame positions for ghost fear/damage. That list is not an ignition bus. The player match-to-spill gap is the clearest likely explanation for the reported failed combination; other combinations above can fail for the same reason. Fire damage and transferable heat are currently separate concepts.

The ground fuel *looks* circular because `weather_lab.gd` draws a nine-sided cylinder of radius 0.25 m for each occupied grid cell. The underlying 64×64 conservative fuel simulation already handles spreading, burning, wetness and rain at 10 Hz. It uses shared MultiMeshes and at most three pooled shadowless fire lights. Keep this foundation while changing the surface presentation.

## Proposed unification

Add a small `HeatContact` service. Each hot source reports zone, point or swept segment, radius, strength, duration and identity; receivers expose fuel, wick, lamp, combustible component or ghost responses. Water uses the same local-contact rules for wetting and quenching. Route contacts through `fuel_combat.gd` so interactions during asynchronous surface scanning are retained. Keep source-specific intensity: match, torch, flamethrower and burning puddle need not heat equally. `"fire"` damage should not itself be the ignition API.

Use the existing fuel solver and Living Workshop material model as adapters, not a giant new solver. Require zone/occlusion checks and swept contact for moving flames. Coalesce repeated heat contacts at the 10 Hz simulation step and query only nearby cells. Avoid scanning all 4096 cells per source or adding one real light per flame. Future Bran-created items should declare the heat contacts they emit and accept alongside their visual and combat behavior.

## Liquid visual experiment

In Weather Lab, compare a connected puddle surface built from occupied cells against a shader-only connected-tile treatment. Prefer irregular, softly broken edges and slight downhill flow over distinct discs. Use restrained pearlescent teal/amber/violet glints at glancing angles, a slow moving normal, and darker pooled areas; it should still read as flammable liquid. Chunk a mesh into, for example, 8×8-cell regions and rebuild only dirty chunks at the existing 10 Hz rate. Keep the current fuel values and three pooled lights.

Transparency and broad surface overdraw may be expensive or sort poorly in stereo. Start mostly opaque with a soft edge treatment, then measure CPU mesh rebuild, draw calls, GPU frame time and headset readability at 1, 10 and 40 bottle-equivalent scenes. No VR performance claim follows from this audit.

## Original work packages

1. **Interaction consistency:** player match → unlit spill; burning spill → adjacent spill; torch and Wyrmspout stream/patch → spill, including during a pending surface scan. Add water/rain quenching, zone and occlusion regressions.
2. **Liquid art:** prototype connected puddles in Weather Lab, measure in VR, then replace cylinder-per-cell visuals.
3. **Combustible props:** bridge native heat into Living Workshop receivers. Start with authored timber, cloth and an oil-soaked target.
4. **Combination playground:** lay an unlit trail, light either end with a match, torch or flamethrower; let poured water cut it. Then add a briefly hot bolt, snow melting near fire, and wet timber steaming before it ignites.

The fixed 24 m single-layer fuel field cannot yet coat walls or cover arbitrarily large regions. Wyrmspout currently falls back to separate fire patches when a floor hit is rejected. Cross-zone fuel is session-only and paused in inactive zones. These bounds should remain explicit until expanded.

Existing checks and the new gallery/contact assertions cover the cross-source paths. VR frame-time and comfort still require a live headset capture; no desktop result proves that case.

## Learning and timing

The older fuel guide and README described fuel combat as opt-in, but `firecraft.gd` now constructs the fuel adapter in ordinary non-diagnostic play. Verify the current setup path before relying on experimental-mode notes. Source inspection and Git checks completed in roughly 0.05–1.5 seconds per measured command/tool call; no build, playtest or asset generation was run. A first documentation patch failed because it matched only a sentence embedded in a longer Markdown line; use exact whole-line context when patching this README.
