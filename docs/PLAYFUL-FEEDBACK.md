# Playful feedback and discovery

`godot/playful_feedback.gd` adds a small reusable visual/audio language for the
Sunskipper and Bellworks activities. The coordinator creates `game.playful_feedback`,
adds it to the scene, calls `setup(game)` before activity setup, and calls
`tick(delta)` every frame. It only requires `game.camera` and `game.vr`.

## Events and nearby instructions

- `pulse(world_position, kind, strength=1.0)` accepts `throw`, `recall`, `hit`,
  `catch`, `progress`, `reward`, or `warning`. Unknown events use hit feedback.
- `register_hint(id, stand, title, desktop_text, vr_text, offset=Vector3(0,1.6,0))`
  returns success. Offset is a world-aligned displacement from the stand origin.
  Use explicit line breaks for short, readable controls. IDs replace prior entries.
- `set_hint_status(id, text)` updates the nearby progress line without recreating nodes.
- `unregister_hint(id)` removes the visual aid. Freed stands clean up automatically.

From 4 to 11 meters away, each visible stand shows its name and a downward arrow
with “Come closer to try”. Within 4 meters it shows the appropriate desktop or VR
controls and current status; the ground halo brightens. Instructions use large
cream text with a dark outline and depth testing, rather than color alone. Hidden
stands hide their hints. Hints farther than 11 meters disappear. Instructions are
world anchored and do not follow the user's face. The halo is static and introduces
no blinking, flashing, or dynamic lights. Registration should be limited to useful
interactive stations to avoid overlapping text.

## Resource and audio limits

The complete system has one 48-instance prism MultiMesh, six positional audio
players, seven cached mono WAV streams, and at most twelve discovery markers.
Events reuse slots and do not add nodes, meshes, materials, lights, or WAV resources.
Particle lifetime is at most 1.05 seconds. Stereo placement and distance attenuation
come from AudioStreamPlayer3D. All source audio is synthesized once using softly
enveloped sine partials at setup; no recordings, APIs, files, or paid calls are needed.
Three slight pitch variations avoid identical repeated notes. Per-kind 0.11 second
sound throttling and a fixed six-voice pool bound collision storms. Event audio is
quiet, brief and non-looping; it is not an ambient music track.

`enabled=false` hides all feedback and stops current voices on the next tick.
`audio_enabled=false` suppresses new sounds. `reduced_motion=true` reduces each
event to at most three slow moving motes. These are public integration controls;
this module does not add a settings menu or write player preferences.
Audio stays enabled in an interactive `--playful-demo` even when the rest of the
game operates offline. Automated/render captures should use the Dummy audio driver.

## Offline verification and recovery

Run the portable engine with `--headless --audio-driver Dummy --xr-mode off
--path godot --script res://playful_feedback_checks.gd --log-file <absolute-log-path>`.
The isolated fake game does not load the main scene, network or player saves.
The test covers 1200 event bursts, bounded node counts, retiring lifetimes,
desktop/VR instructions, progress text, far/hidden/freed stand behavior, hint limits,
bounded procedural audio peaks, spatial sound placement, sound throttling and disable.
Latest result: `PLAYFUL_FEEDBACK_RESULT []`, 0.399 seconds measured engine invocation.
Measured steps live in `logs/playful-feedback-timing.csv`.

Observed failure lessons:

- Windows PowerShell does not expand `godot/*.gd` as a ripgrep filename. Search with
  `rg -g '*.gd' <pattern> godot` or pass concrete paths. The failed discovery took 0.109s.
- A relative `--log-file ../logs/...` was interpreted under `user://` by the engine,
  producing a reserved Windows pipe-path warning. Always pass an absolute log path.
- The headless dummy renderer returns identity matrices from MultiMesh transform
  readback; it does not validate stored GPU state. The initial 0.280-second test
  reported 48 false invisible-mote failures for this reason. Assert authoritative
  CPU lifetimes in the offline test; verify rendered particle retirement centrally
  in a real rendering session. Do not keep retrying dummy-renderer GPU assertions.

Actual headset readability, stereo placement and user comfort require a headset
playtest. These checks do not make claims about those qualities or rendered FPS.
