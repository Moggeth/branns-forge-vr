# Echo Bells

A generated, untimed call-and-response concert in the optional pocket court at `(185, 0, 65)`. Safe arrival is `(185, 0, 70)`. Travel only visits; choose **NEW ROUND** to begin. The return button travels to Bellworks after held tools are released.

The three bells have both names and physical symbols: **SUN / CIRCLE**, **MOON / DIAMOND**, and **STAR / CROSS**. They play three gentle pitches. Each demonstrated note also lights its bell and appears by name on the large central cue label, so sound and colour are never the only cues.

The first generated melody has two notes. Watch or listen, then wait for **YOUR TURN**. Correctly repeat the complete phrase to add another note, up to five. The existing prefix stays the same; each added note differs from its preceding note. Remembering all lengths from two through five earns the **Echo Keeper** medal. There is no response timer.

- Desktop: click the appropriate bell.
- VR: grip a bell's reachable clapper, pull it about 10cm, then release to ring. Merely gripping or making a short movement does not ring it. One grip produces at most one note.
- **REPLAY MELODY** demonstrates the current phrase again and clears the partial response.
- A wrong note waits for **RETRY**; Retry demonstrates the same phrase again.
- **NEW ROUND** explicitly starts a fresh generated melody. **ABANDON** puts away the current concert. Neither removes earned records.

Replay, Retry or a wrong note marks the current concert assisted. Correct assisted phrases still improve **Best**, earn the medal, and increase completions. **First listen** improves only on phrases correctly echoed before any assistance in that concert. If a player earns a first-listen three-note record and then needs help at four notes, the honest earlier three-note record remains.

## Native integration

The module is `godot/echo_bells.gd`. Main owns setup/tick, action routing and grip arbitration.

- `setup(game)`, `tick(delta)`, `act(action)`.
- World action prefix `echo:`; actions `visit`, `leave`, `practice` (aliases `start`, `new_round`), `replay`, `retry`, `abandon`, `note0`, `note1`, `note2`.
- `try_grab(hand, desktop=false) -> bool`, `busy(hand) -> bool`, `release(hand) -> bool`. Main consumes trigger/bomb actions while this module owns a hand; releasing the clapper rings it. Desktop grip is deliberately not claimed because desktop bell input is clicking.
- `progress_snapshot()`, static `fresh_state()`, static `_valid(value)`, `restore_progress(value) -> bool`.
- Public inspectable fields: `court`, `board`, `label`, `cue_label`, `bells`, `clappers`, `players`, `glows`, `medal`; transient `mode`, `sequence`, `answer_index`, `cue_index`, `assisted`, `holder`, `held_bell`, `pull_armed`.

Modes are `idle`, `playing`, `answering`, `failed`, `complete`. Playback waits 0.65 seconds before the first note, spaces notes by 0.95 seconds and highlights each for 0.60 seconds. Clicks or grips cannot answer during playback. There are exactly three pooled audio players and three short, generated PCM waveforms; no external audio, paid generation or service calls.

Grip acquisition must be within 0.24m of a clapper. Physical movement is visually clamped to 0.18m; a pull of at least 0.10m arms the bell. Release samples live hand position too, so a quick pull/release within one frame remains usable. Moving over 0.55m from the grip origin or acquiring conflicting hand ownership cancels without ringing. Restart, abandon and restore discard pending pulls and return clappers home. Restoration is also safe before visual setup for demo adapter use.

Bell positions are court-local x `[-2.7, 0, 2.7]`, y `1.8`, z `-1`; resting clappers are each bell-local `(0, -0.65, 0.2)`. The main board is local `(-4.4, 1.65, 3.8)` with a 4.4m width. It leaves the central arrival capsule clear. Main status, buttons and note names have glyph sizes of at least approximately 0.09m. All floor/rail collisions are explicit, bounded geometry.

## Progress and verification

Normal progress lives at `user://echo_bells.json` with exact durable fields:

```json
{"schema":1,"revision":0,"medal":false,"completions":0,"bestLength":0,"bestUnassistedLength":0}
```

Counts are finite integers: revision up to 100,000,000; completions up to 1,000,000; best lengths are 0, 2, 3, 4 or 5. First-listen best cannot exceed overall best. Medal, a five-note best and at least one completion must agree. Partial correct phrases of two through four notes are legitimate durable records without a medal. Unknown or transient fields are rejected. No melody, answer position, audio state or held clapper is persisted.

The normal writer validates a flushed `.tmp` file, preserves a valid prior primary as `.bak`, then replaces the primary. Startup recovers the highest valid revision among those three candidates. Diagnostic and smoke setup disable this normal save path. The optional demo adapter may store the same achievements in its explicitly enabled demo namespace; older schema-1 demo files without `echoBells` remain valid. Save failures appear on the board, and startup prints `ECHO_BELLS_READY` for diagnosis.

Run the focused suite from the project directory:

```powershell
./tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://echo_bells_checks.gd --quit-after 300
```

The 52 checks cover generated phrase growth, readable visual cues, unlimited response time, assistance and best records, actual VR grip/pull/release, same-frame input, ownership conflicts, no phantom notes, restore/abandon, strict validation, atomic TEMP-fixture save recovery and real arrival floor/capsule clearance. Headless runs construct and inspect all three waveforms but skip audio playback to avoid AudioServer shutdown races. Save fixtures never touch the normal user namespace and are removed after testing.

For an interactive check, visit Echo Bells, complete the two-note phrase via clappers, use Replay on a later phrase, finish through five, and verify the assisted overall best versus first-listen record. Check both visible cues and the three pitches. The coordinator owns main-process walkthrough and display verification.

Measured timings are in `logs/playful-encounters-timing.csv`.
