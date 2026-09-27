# Brann's built-in activity awareness

The ordinary native context heartbeat can include `playful`. The service validates
it and provides fixed controls/location guidance plus current progress to Brann's
existing live, text and delegated backend paths. No new voice architecture, tools,
paid requests, XP grants, inventory changes or server-side activity saves were added.

## Native input schema

```json
{
  "schema": 1,
  "input": "desktop",
  "sunskipper": {"state":"home", "mode":1, "reward":""},
  "bellworks": {
    "discovered":true, "stage":0, "notes":[0], "melody":0,
    "gold":0, "ready":false, "claimed":false, "wins":0
  },
  "copperKite": {
    "discovered":true, "earned":false, "rounds":0,
    "settled":[false,true,false], "canLaunch":false, "launched":false
  }
}
```

The envelope requires schema 1 and input `desktop` or `vr`. Each subsystem is
optional. Strings are exact enums: Sunskipper state `home`, `held`, `flying` or
`returning`; reward empty or `bellwright`. Mode is an integer 0–2. Bellworks stage
is 0–3; notes are at most three distinct integers 0–2; melody 0–4; gold 0–3.
Wins and cargo rounds are integers 0–1,000,000. Boolean fields require actual JSON
booleans; numeric strings are rejected. Settled contains exactly three booleans;
map native elapsed settling seconds to `seconds >= 1` before sending. Map the native
ready/can_launch property to the exact camelCase `canLaunch` key.

Invalid subsystem objects become unknown (`null`), without destroying valid sibling
reports or rejecting the ordinary native heartbeat. An incompatible envelope becomes
unknown. Missing `playful` clears prior activity context, preserving older-client
compatibility. Unknown properties and all client prose are dropped. Arrays are copied
and bounded. Consistency checks prevent claimed-with-zero-wins, earned-with-zero-rounds,
ready-before-final-trial, or ready cargo without all three settled parcels.

## Truth and freshness

`World.context.playful` stores only sanitized data. `World.snapshot().playful` emits
fixed server-authored help and progress summaries; it identifies its source as a
native report. This is informational telemetry, not an authoritative reward ledger.
Existing server inventory, forge, workshop and RPG fields remain independent.

Activity progress expires after five seconds without a context heartbeat. The
snapshot then labels current progress unknown and confirms no reward. Ordinary
`inspect_forge` refreshes Brann's snapshot. Only a fresh claimed/earned flag confirms
the Bellwright or Copper Gardener reward. A ready-to-claim performance stays unclaimed;
reset/replay can retain a previously earned reward without marking the new round done.
Sunskipper's appearance string alone does not confirm a Bellwright trophy.

Brann's additional instructions explain that these are existing activities at real
stands and gates. They cannot be conjured, equipped, delivered or rewarded by speech.
The ring uses grip/E to take and throw, held trigger/click for power, and empty-hand
trigger/click for recall. Copper Kite uses grip/E to equip or put away, trigger/click
to pull then gently release, and A/X to fling. Only the three marked cargo blocks
currently qualify. Settling SUN/LEAF/MOON then activating GROW COPPER BLOOM earns its
flower. Built-in mechanics do not imply arbitrary live-generated mechanics; genuine
new inventions must respect inspected Living Workshop capability support.

## Exact integration changes and recovery

- New `service/playful-context.js`: pure validation, fixed summaries and instructions.
- `service/world.js`: import helper, normalize one new heartbeat field, summarize one
  snapshot field with the existing heartbeat freshness threshold.
- `service/forge.js`: import and append the fixed instructions to existing text,
  live-session and live-delegation requests. Existing prompt text and startup
  inventory/tool context remain intact; no tool descriptions or schemas changed.
- New `service/playful-context-test.cjs`: bounded/malicious input cases, reward and
  freshness distinctions, exact controls, read-only World/inspect_forge behavior,
  actual live-session route with wholly mocked external transport.

Before edits, both existing files were copied to
`work/playful-context-backup-20260921-071836/`. The running production service was
not restarted or contacted. The coordinator owns final native payload integration
and any service rollout.

Run `node --test service/playful-context-test.cjs service/delivery-test.cjs
service/voice-test.cjs` from the project root. All 17 targeted tests passed in
1.714 seconds. The complete offline `node --test '*test.cjs'` suite from `service/`
passed all 86 tests in 0.663 seconds. HTTP fixtures bind ephemeral loopback ports;
external API and socket transports are mocked. Production port 8787 and player
saves are untouched. Tests verify payloads and behavior, not an actual paid spoken
conversation or model response quality.

Discovery lesson: search actual files before assuming a `voice.cjs` module; voice
prompt/context integration lives in `forge.js` and `world.js`. For paths under
`service`, use component-wide exclusions such as `-g '!**/node_modules/**'` and
`-g '!**/output/**'`; root-relative exclusions like `!node_modules/**` do not match
`service/node_modules/...` when searching from the project root. The initial broad
discovery was successful but noisy; focused root files avoid runtime/generated trees.

Measured timing is appended to `logs/playful-feedback-timing.csv`.
