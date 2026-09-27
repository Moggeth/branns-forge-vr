# Brann's Forge VR native client

The Unity native client uses only `http://127.0.0.1:8787` and has no credentials. It supports OpenXR through the configured Windows runtime and a desktop fallback.

## Controls

Desktop: WASD move, right mouse looks, left mouse uses the held weapon or clicks the ray-hit board, E grabs/drops, Q/R snap-turn, T bounded teleport, and H hands tails to Brann.

OpenXR: grip grabs/drops physical items and tail pickups; trigger attacks with the equipped item or ray-clicks the board; left touchpad click teleports only to the bounded floor; right stick snap-turns. There is no continuous locomotion.

## Native/service contract

Native polls `GET /api/vr/state`, sends `/api/vr/context` once per second with invariant-culture coordinates, actual equipped item ID, visit state, and live rat/dummy targets. `VrState.voice` is `{ enabled, voice, revision }`; voices cycle through `vesper`, `ripple`, `stone`, `meridian`, `cinder`, `marin`, `willow`, and `quartz`. Visiting with voice enabled opens the companion. Commission starts only from a spoken/typed companion brief; the board never submits a default brief.

Only `ready` jobs appear on the rack. Brann is busy for `queued`, `building`, or `validating`; the question marker means a ready rack item or five uncollected tails. Native displays server-provided errors without later polling overwriting them.

Ready models load directly with `GLTFast.GltfImport.Load` and `InstantiateMainSceneAsync`. The importer is retained, duplicate imports are prevented, the actual instantiated model is bounds-scaled, and its root gets a physical grip collider. Failed models do not create substitute or empty equipment.

## Play behaviour

The starter hammer is entirely local for physical swings and desktop attacks. Rats only respond to weapon hits, report their unique kill before their tail can be requested, roam locally, and their physical tails are preserved until the server confirms collection. Server abilities receive current target/context and execute locally: blast damage, slow, pull, shield, comfortable teleport dash, delayed bomb blast, or decorative sparks. Service durations are milliseconds and are converted to seconds.

## Build and verification

Open `native/` in Unity 6000.0.33f1, resolve packages, then run **Brann Forge → Validate** and **Brann Forge → Build Windows**. No service call is made during build.

- Test desktop and SteamVR/OpenXR fallback, board ray actions, grip tail collection, and five-tail hand-in.
- Confirm a ready commission creates only its loaded glTF root, equips its real ID, and applies abilities to a rat or `TestDummy`.
- Confirm a rejected kill/tail/hand-in/commission request keeps local state intact and shows the returned service error.
