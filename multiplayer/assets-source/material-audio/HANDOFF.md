# Material impact audio kit — HANDOFF (Opus 5.5, 2026-10-03)

Status: **complete for this checkpoint, not integrated.** This is the checkpoint after the current release and must not block it. Nothing outside this folder was edited. `reference/*.js` are read-only copies. I did not touch the captain's or root files, `../opus-wood-audio-20261003/`, git, the network, APIs or credentials.

## Files

| File | Purpose |
|---|---|
| `generate_material_audio.py` | Deterministic numpy synthesis that rebuilds everything. No samples, downloads or copyrighted sources. |
| `assets/*.wav` | 13 one-shots, mono PCM16 32 kHz, **651,452 B total** |
| `assets/*.ogg` | Vorbis q4 copies (ffmpeg/libvorbis, bitexact), **126,598 B total**. WAV + OGG together = **778,050 B**, under 1 MB. |
| `material_audio_contact_sheet.wav` / `.ogg` | 26.2 s review sequence for listening only; do not ship it (described below) |
| `metrics.json` | Per-sound waveform and spectral metrics, sizes and generator timings |
| `material-audio.js` | ES module: `createMaterialAudio({context, ...})` returns `{load, unlock, handles, play, tick, dispose, setListener, stats}`. Pure exports: `materialLayersFor`, `materialOf`, `energyOf`, `energyShape`. |
| `test_material_audio_assets.py` | 147 objective checks on the shipped files |
| `test-material-audio.mjs` | 12 adapter tests on a mock WebAudio graph that counts edges; they load the real WAVs |
| `timing.json` | Monotonic session timing |

## Sound design

Every sound is built from layers: a strike transient, an inharmonic modal body and band-limited granular debris. None of them is an oscillator beep or plain white noise.

- **pick_stone a/b/c** (mining, pick/axe on the golem)
  - 0.25 ms steel tip tick
  - Dense, heavily damped stone modes (930–4150 Hz, 3–10 ms decays): the "tock"
  - The pick's own steel ring at −17 dB (2.87/4.63/6.0 kHz, 18–45 ms): the restrained, mature chink
  - Crushing grit, 1.4–6.5 kHz, with 1.1 ms granular amplitude jitter and a 55 ms decay
  - A 450–1600 Hz crunch for weight, a small handle thud, and 7–9 crumbs
  - Variants: modal scale ×1.0/0.94/1.07 plus different seeds.
- **metal_ricochet a/b/c** (shrine and any `material:'metal'`)
  - Bright strike, then 8 inharmonic plate modes (ratios 1, 1.004, 1.59, 2.14, 2.141, 2.65, 3.25, 3.92). The near-equal pairs beat, so the ring shimmers rather than holding one pitch.
  - Mode decays 50–320 ms
  - A falling "zing" partial (22–32% glide over 80 ms) gives the ricochet
  - A short 2.2–7 kHz scrape and a dull body knock
  - Base frequencies 1180/1310/1090 Hz
- **bone_crack a/b/c** (skeletons and headshots)
  - 2–4 micro-fractures inside 16 ms, each with its own short 1.45/2.38/3.62 kHz resonance (3–6 ms)
  - A hollow 430/690/1010 Hz knock, a dry snap and 4 splinters
  - Under 2.2% of the energy is below 200 Hz, and there is no metallic tail
- **stone_fracture a/b** (hammer on stone, golem armour break, hammer slam)
  - 70→46 Hz thump
  - Low stone body (176–905 Hz, 20–90 ms)
  - Hammer-face tick and a broadband granular crack
  - A slab breaking off at 0.15/0.18 s, with its own low modes
  - 26 rubble fragments that thin out over about 1.1 s
- **ore_break a/b** (reward)
  - A lighter fracture at −6 dB
  - 7–8 crystal shards falling at their own times between 0.06 and 0.6 s. Each is a short inharmonic glassy set (1.9–3.6 kHz fundamental ×1/2.76/5.4, capped below 5.8 kHz, 20–70 ms).
  - A pebble patter
  - Bright and rewarding without a sustained tone or hiss
- **Flesh and wood fallbacks: deliberately not made.** The game has no flesh enemies: skeletons are `bone` and golems are `stone`, per `combat.js:39`. Wood belongs to the wood kit. A fallback with no event to drive it would only add bytes.

## Measured budgets (from `metrics.json`, after int16 quantisation)

| sound | dur s | peak dBFS | RMS dBFS | max 50 ms RMS | attack ms | −20 dB ms | −40 dB ms | centroid Hz | >6 kHz % | <200 Hz % | peak-band | WAV B | OGG B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pick_stone_a | 0.46 | -3.0 | -30.6 | -21.1 | 1.4 | 23.8 | 331 | 1588 | 1.33 | 5.2 | 0.30 | 29,484 | 7,678 |
| pick_stone_b | 0.46 | -3.0 | -31.1 | -21.5 | 1.4 | 24.1 | 229 | 1555 | 1.27 | 5.0 | 0.29 | 29,484 | 7,706 |
| pick_stone_c | 0.46 | -3.0 | -30.2 | -20.6 | 1.4 | 27.5 | 189 | 1680 | 1.12 | 4.2 | 0.30 | 29,484 | 7,613 |
| metal_ricochet_a | 0.95 | -4.5 | -25.6 | -15.7 | 4.1 | 288 | 941 | 1967 | 0.03 | 0.0 | 0.29 | 60,844 | 8,618 |
| metal_ricochet_b | 0.95 | -4.5 | -25.3 | -15.6 | 3.9 | 410 | 944 | 2193 | 0.06 | 0.0 | 0.29 | 60,844 | 8,115 |
| metal_ricochet_c | 0.95 | -4.5 | -25.0 | -15.3 | 6.1 | 311 | 942 | 1795 | 0.03 | 0.1 | 0.30 | 60,844 | 8,192 |
| bone_crack_a | 0.38 | -4.0 | -31.3 | -22.5 | 1.1 | 28.3 | 75 | 1422 | 3.29 | 1.6 | 0.25 | 24,364 | 5,472 |
| bone_crack_b | 0.38 | -4.0 | -31.4 | -22.6 | 9.4 | 26.3 | 115 | 1655 | 1.95 | 1.4 | 0.22 | 24,364 | 5,460 |
| bone_crack_c | 0.38 | -4.0 | -29.4 | -20.6 | 1.1 | 26.6 | 169 | 1391 | 3.33 | 2.2 | 0.29 | 24,364 | 5,871 |
| stone_fracture_a | 1.30 | -1.5 | -23.3 | -11.0 | 1.5 | 31.7 | 619 | 257 | 0.05 | 67.0 | 0.38 | 83,244 | 16,138 |
| stone_fracture_b | 1.30 | -1.5 | -23.6 | -11.2 | 1.5 | 35.1 | 1151 | 244 | 0.12 | 67.4 | 0.38 | 83,244 | 16,084 |
| ore_break_a | 1.10 | -3.5 | -20.1 | -13.6 | 1.5 | 31.7 | 842 | 2257 | 0.09 | 13.5 | 0.15 | 70,444 | 14,689 |
| ore_break_b | 1.10 | -3.5 | -19.8 | -13.9 | 1.5 | 35.1 | 740 | 2162 | 0.08 | 10.5 | 0.12 | 70,444 | 14,962 |

The "peak-band" column is the energy fraction within ±25 Hz of the spectral peak; a sine beep scores about 1.0. bone_crack_b's 9.4 ms attack is real: its second micro-fracture is louder than its first.

**What the asset tests enforce:**

- **Hygiene** (all sounds):
  - peak ≤ −1 dBFS, with zero clipped samples
  - edge samples < 0.002 and DC < 0.002
  - mono / 16-bit / 32 kHz
  - per-family duration windows
- **Character limits** (all sounds):
  - anti-beep: peak-band < 0.45
  - anti-hiss: under 6% of the energy above 6 kHz
  - attack < 20 ms
  - "not loud noise": max 50 ms RMS < −9 dBFS
- **Variants**: 2–3 per family. Centroids stay within 1.3× of each other and pairwise correlation is < 0.8, so they are not copies.
- **Per family**:
  - pick: drops 20 dB within 60 ms, sits more than 30 dB down at 300 ms, and more than 35% of its 20–200 ms tail is in the 1.4–6.5 kHz grit band
  - bone: −40 dB within 220 ms and under 5% of the energy below 200 Hz
  - metal: its 300 ms tail is more than 20 dB above the pick's, with no sub energy
  - fracture: its −40 dB tail lasts longer than 500 ms
  - ore: more than 40% of its 1.8–6 kHz energy arrives after 150 ms, i.e. it really is a shard cascade
- **Ordering between families**:
  - fracture centroid < 600 Hz < pick
  - bone's sub fraction is below the pick's
  - fracture's 50 ms RMS is more than 5 dB above the pick's
  - the ore is brighter than the pick
- **Determinism and size**:
  - a fresh synthesis is bit-identical to the PCM on disk
  - WAV ≤ 1 MB, and WAV + OGG ≤ 1 MB

**Failures I hit and fixed along the way:**

- The first stone_fracture had 81% of its energy below 200 Hz and stone_fracture_b scored peak-band 0.53, which made it a sub "boom". I shortened and lightened the thump and raised the crack.
- The pick's handle thud took 15% of its energy below 200 Hz.
- In the ore sound, the shard cascade first came out too front-loaded (0.38 < 0.4). My next fix made a late shard louder than the crack, so the attack landed at 378 ms. I rebalanced the shards to sit at 0.15–0.22 of the crack's level.

## Review sequence (`material_audio_contact_sheet.ogg`, 26.2 s)

First, all 13 sounds in file order, with 0.5 s gaps. Then a 9 s scenario:

1. Three pick bites
2. Ore break at 1.9 s
3. Pick on the golem plus armour break at 3.2 s
4. Three bone hits, including a stronger one standing in for a headshot
5. Two metal ricochets
6. Hammer fracture at 7.6 s

The sheet is normalised to −1 dBFS peak.

## Adapter (`material-audio.js`)

### Inputs: real fields only, no world physics

It reads the event fields that already exist:

- `kind`
- `material`, inferred exactly as `game.js:460` does, so sound and chips always agree
- `energy`, clamped to 0.2–2 as in `impact-presentation.js`
- `normal`
- `position`
- `id`, `part`, `impact`
- `tick`

### Mapping (`materialLayersFor`, pure)

| Event | Sound |
|---|---|
| `hit` / `headshot` `material:'bone'` | `bone_crack` (headshot ×1.15 gain, ×1.05 rate) |
| `hit` `material:'stone'`, energy < 1.5 (pick/axe on golem) | `pick_stone` |
| `hit` `material:'stone'`, energy ≥ 1.5 (`combat.js:39` hammer = 1.8) | `stone_fracture` |
| `hit` `material:'metal'`, or id `'shrine'` | `metal_ricochet` |
| `armor_break` (`combat.js:33`, pick on golem) | `stone_fracture` at 0.7 gain, ×1.18 rate (a smaller plate). The same strike's `hit` adds the pick bite. |
| `stone_hit` (ore mining, `combat.js:97`) | `pick_stone` |
| `ore_break` | `ore_break` |
| `hammer_slam` | `stone_fracture`, ×0.92 rate |
| `embed` with `impact:true` (arrow into the world) | stone → quiet `pick_stone` ×1.2, bone → `bone_crack`, metal → `metal_ricochet` |
| `embed` with `impact:false` | nothing: the enemy hit event already sounds |
| `wood_hit`/`tree_*`/`pickup`/`shoot`/`death`/`detach`/`pick_burst`/`axe_cleave`, or an unknown material | `[]`, so the legacy path still runs |

### Energy, pitch and normal

- **Energy:**
  - gain = clamp(0.4 + 0.6·e, 0.45, 1.35)
  - rate = clamp(1 − 0.05·(e − 1), 0.95, 1.04): heavier contacts are slightly lower, not only louder
- **Deterministic variation:** the same FNV-1a `hash01` as the wood kit, over `kind|id|part|tick|position(cm)`, picks the variant, a rate within ±3–6% and gain ±1.5 dB. `play(event, listener, tick)` falls back to the caller's snapshot tick when the event has none.
- **Normal:**
  - The source is placed 4 cm out along the struck face.
  - If the listener is clearly behind the surface (dot < −0.35·distance, more than 1 m away), it gets a 1.8 kHz lowpass and ×0.7 gain. This is a judgement from the event's own normal, not a geometry query.

### Spatial

- Graph per voice: `BufferSource → Gain → [lowpass] → Panner(inverse, ref 2 m, rolloff 1.15) → master(0.7) → destination`.
- **Culling** is per sound: bone/pick 35 m, metal 45 m, ore 50 m, fracture 60 m. Beyond that, no nodes are created at all.
- **Air absorption** beyond 8 m: lowpass at max(2400, 16000/(1 + (d − 8)/10)).

### Pool and cooldowns

- The hard ceiling is **12** connected voices and the `maxVoices` option is clamped to it: 10 audible plus 2 release slots for 35 ms steal fades.
- Stealing works the same way as in the wood kit:
  - lowest priority first, then oldest
  - a new voice is dropped if everything playing outranks it
- Priorities: ore 9 > fracture 8 > metal 6 > pick/bone 5.
- Per-sound caps: pick 4, bone 4, metal 2, fracture 2, ore 2.
- Cooldowns:
  - the same sound on the same id within 45 ms is dropped (duplicate packets, multi-contact flams)
  - global spacing per sound: pick 20 ms, bone 15 ms, metal 30 ms, fracture 50 ms
  - ore is never throttled, because rewards must not vanish

### Lifetime

- `onended` disconnects every node of a voice.
- `tick()` reaps voices more than 0.25 s past their end, for cases where `onended` is lost.
- `dispose()` hard-stops everything, disconnects master and clears buffers; later calls do nothing.
- Missing buffers are skipped, not queued.

### Listener

The listener uses `driveListener:false` by default, because the wood kit already drives `context.listener` every frame. The kit only tracks the position, for culling and occlusion. Pass `driveListener:true` if the wood kit is ever removed.

### Haptics and camera

Not touched; a source test asserts this. The existing `pulse(.25,35)` at `game.js:464` is generic and does not use contact energy, so per the brief I did not override it. A later root change could scale it with `energyOf(event)`; that is the root's decision.

### Combined voice budget with the wood kit

| | hard ceiling | audible | release slots |
|---|---|---|---|
| wood-audio.js | 16 | 14 | 2 |
| material-audio.js | 12 | 10 | 2 |
| **combined** | **28** | **24** | 4 |

- Worst case is 28 concurrent BufferSource chains. The material kit adds at most 12 × 4 = 48 graph edges plus 1 master edge, and 12 × (source + gain + panner + filter) = 48 nodes.
- In practice the two kits rarely peak together: chopping and mining or fighting are different activities.
- If a 16-voice **total** is required on mobile, construct them as `createWoodAudio({..., maxVoices: 10})` and `createMaterialAudio({..., maxVoices: 6})`. Both clamp safely and keep their priority stealing.

### Adapter tests (`test-material-audio.mjs`)

1. Mapping on the real `combat.js` and `game.js` event shapes, including what is excluded; `energyOf`/`energyShape`; hash range and mean
2. All 13 real WAVs load through the injected context
3. Determinism of variant, rate and gain
4. Energy: the gain ratio equals the shaping; harder hits play at a lower rate; normal offset; back-face occlusion filter
5. Far cull creates zero nodes; air-absorption cutoff at 50 m
6. Exact cooldown semantics; ore is never throttled
7. A 300-event mixed burst never exceeds 12 voices or 48 edges, the ore reward survives, and edges return exactly to baseline
8. `maxVoices:40` is clamped to 12
9. Per-sound cap
10. Reaping after a lost `onended`
11. `dispose` leaves 0 voices, 0 buffers and 0 edges
12. The source never constructs an AudioContext or touches haptics, vibration, shake or the camera

## Integration (root only; line numbers refer to `reference/game.js`)

Place the module at `client/material-audio.js` and the assets at `assets/material-audio/*.wav`, served at `/assets/material-audio/` next to `/assets/wood-audio/`.

```diff
@@ line 19
 import {createWoodAudio} from './wood-audio.js';
+import {createMaterialAudio} from './material-audio.js';
@@ line 438
-  let audioContext=null;let lastSound=0;let woodAudio=null;
+  let audioContext=null;let lastSound=0;let woodAudio=null;let materialAudio=null;
@@ line 442 (inside unlockAudio's try, after woodAudio.unlock();)
+materialAudio??=createMaterialAudio({context:audioContext,baseUrl:'/assets/material-audio/'});materialAudio.unlock();
@@ line 456 (after the woodSound line; before the kind whitelist, so armor_break, which the whitelist drops, is voiced)
+    const materialSound=!woodSound&&!!materialAudio?.handles(event);if(materialSound)materialAudio.play(event,listenerPose(),snapshot.tick);
@@ line 463 (legacy oscillator)
-    const now=performance.now();if(audioContext&&!woodSound&&now-lastSound>45){
+    const now=performance.now();if(audioContext&&!woodSound&&!materialSound&&now-lastSound>45){
@@ line 701 (frame), after woodAudio?.tick(listenerPose());
+materialAudio?.tick(ear);   // reuse the pose object listenerPose() just filled; no second camera read
@@ line 834 (dispose), after woodAudio?.dispose();woodAudio=null;
+materialAudio?.dispose();materialAudio=null;
```

Notes for root:

- Visual impacts (`impacts.emit`) and the haptic pulse are unchanged; only the oscillator is skipped for events this kit voiced.
- `listenerPose()` returns the shared `ear` object, which is already allocation-free in the current `game.js`.
- `hit` events reach `handleEvent` with `combat.js` fields: `material` is `'stone'` for golems and `'bone'` for skeletons, `energy` is 1.8 for the hammer, and `normal` is present. No server change is needed.
- `pick_burst` still uses the legacy beep together with the crystal spell visual, while each ore it touches sends a `stone_hit`, which this kit voices. If that doubles up audibly, root may skip the beep for `pick_burst` too; that is a one-token change, and I left it alone.
- **Unverified emitter:** `game.js:460` handles `ore_break`, but neither `combat.js` nor `game.js` in `reference/` emits it. Ore depletion in `combat.js:97` only sets `depleted` and pushes a pickup. If the mining module does not send `ore_break`, the reward sound will never play. A minimal authoritative fix is `events.push({kind:'ore_break',id:ore.id,position:[...]})` where `ore.depleted=true` is set. In the reference copy that happens only at `combat.js:97`; any physical-strike mining path elsewhere needs the same push. I did not edit shared code.
- `stone_hit` events from the special carry no `normal`/`energy`, so the adapter uses an upward normal fallback (no offset, no occlusion) and energy 1. Physical pick strikes that do carry them are shaped automatically.

## Timings (monotonic)

See `timing.json`. Generator: synthesis 0.09 s, plus WAV 0.13 s, plus Vorbis 1.38 s. Asset tests: 0.14 s in-script. Adapter tests: 20.7 ms in-test, 79 ms wall including Node startup.

## Honest limitations

- **I did not listen to any of this.** I had no playback path. Quality claims rest on the layer design and on the objective metrics above. Someone should listen to `material_audio_contact_sheet.ogg` on headphones and on a phone speaker before shipping, especially:
  - whether the pick "chink" at −17 dB is present enough
  - whether the metal ring is too long for frequent hits
  - the relative level of the ore reward, which has the highest RMS by design and might want −2 dB in the adapter
- The metrics are proxies. Passing anti-beep and anti-hiss does not prove a sound is satisfying.
- The adapter was tested against a mock graph, not a real browser. These have not been exercised:
  - real `decodeAudioData`
  - Safari's callback form
  - `setTargetAtTime` steal fades
  - HRTF/equalpower output
  - iOS unlock
- Ship WAV (the default `ext:'wav'`, 651 KB). Older iOS Safari cannot decode Ogg Vorbis.
- Back-face occlusion is a heuristic from one normal: no ray test and no thickness. It only muffles; it never silences.
- The armour-break mapping assumes golem plates are stone (`combat.js` gives golems `material:'stone'`). If the art direction makes them metal, change one line so `armor_break` maps to `metal_ricochet` at about 0.7 gain.
