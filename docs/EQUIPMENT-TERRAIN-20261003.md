# Equipment, party and terrain mastery — 2026-10-03

Fresh user request after the expired overnight sprint; the old automation stays paused.
Root owns integration and release. Personal subscription `fauxgrady@gmail.com`,
`claude.ai`, explicit and actual `claude-opus-5-5` verified for each commission.
No API billing or paid extra usage. Concrete artist outputs and metadata are in
`multiplayer/assets-source/{field-guide-party-ui-20261003,mountain-arena-20261003,
weapon-mastery-20261003,weapon-mastery,mastery-material-review-20261003}`.

## Delivered behavior

- Held F1 live equipment guide; held Tab real K/D/damage and active party objective,
  mouse release, trusted-keyup relock. Pinned phone equivalents, focus confinement,
  blur/Escape cleanup, stable pressed buttons while snapshots update. Current quest
  before a run is Prepare an expedition; running/rematch actions use real quest state.
- Build tag contains git revision, dirty marker for local edits and UTC build time.
- Opus axe/pick mesh refinements preserve original geometry/socket contracts and
  height normalization. Axe underhand special releases at 45% of an 0.8s animation;
  scars/ore persist. Pick seven-segment curved wall grows, persists and is mineable.
- Shared authoritative/render terrain uses exact Float32 triangle interpolation,
  not a second analytic approximation. Steep mountain slopes replace the flat
  world's arbitrary grass edge; outer safety bound is behind visible rock slopes.
- New chunk geometry and recessed cut faces replace whole-boulder scale damage.
  Remaining faces are real raycast targets; chips are excluded. Crystal walls use
  instanced meshes: 2,184 triangles, 28 draws per seven-segment wall, shared resources.
- Shared E target selection drives pickup highlighting and direct one-wood lumber
  collection. VR physical grip → waist pouch grants two wood, with fresh ordered
  pose packets, elapsed motion validation, no duplicate reward, and explicit throw
  kept separate. Existing satchel asset reused for visible pouch.
- Emberwing lateral mirror applies only to left hand, leaving firing/up axes intact.

## Verification and measured timings

| Material step | Outcome | Seconds |
|---|---|---:|
| Opus field/party design | Concrete JS/CSS, personal/exact model verified | 442.276 |
| Opus mountain arena | Concrete geometry/ground shader | 500.267 |
| Opus weapon mastery | Two GLBs, motion, wall/fracture modules | 680.545 |
| Opus material critique follow-up | Crystal/mineral and mountain shader refinements | 177.045 |
| Shared terrain/special implementation | Persistent bounded saveable mechanics | 410.114 |
| Shared independent review | Bridge mining validation and old fixtures corrected | 160.739 |
| Art integration and terrain parity review | Actual GLB raycasts, instancing, exact grid | 697.178 |
| Harvest/help follow-up | Actual controls, pouch asset, hold tests | 369.000 |
| VR transport review | Fresh pose ordering, local/remote bonus tests | 377.000 |
| Fourteen related unit suites | All passed | 3.413 |
| Overlay browser acceptance | Desktop, phone portrait/landscape and relock | 13.007 |
| Two-friend browser | Join, shared expedition and terrain | 11.085 |
| Direct E lumber browser | Visible eligible marker and one-time collection | 4.111 |
| Final specials browser | Delayed axe and persistent seven-piece pick wall | 9.921 |
| Textured fracture browser | Two real touch swings, exposed cavities | 6.763 |

Measurements overlap parallel work; do not sum them as elapsed project time.
Root discovered/started this pass at 00:09:19 UTC; implementation and pre-release
verification reached 00:54:56 UTC (2,737 s). Tool executions and artist wrappers
also retain detailed ignored timing records under logs/.

220 raycasts against real Three PlaneGeometry: maximum ground/collision error
1.97e-14 m. 10,000 worst-case 64-edit height queries: 24.69 ms. Eight-player,
64-enemy, 64-edit simulation: 2.814 ms/tick here, below 16.67 ms for 60 Hz.
These are this computer's measurements, not a phone/headset performance guarantee.

Browser tests: `browser-field-overlays.mjs`, `browser-weapon-mastery.mjs`,
`browser-lumber-highlight.mjs`, `browser-mining-fracture.mjs`, `browser-friends.mjs`.
Use existing README/browser acceptance helper setup; screenshots and JSON reports
live under ignored `logs/browser-acceptance`. Physical phone and headset acceptance
remain unverified. Local and remote VR command routing is covered by
`tests/lumber-session.mjs`; it does not simulate physical tracking comfort.

## Failures and learned fast paths

- Do not run browser scenarios against Vite while another owner edits imports:
  HMR resets the session mid-test (first mastery run interrupted at 15.9s). Freeze
  edits during final scenarios; use immutable built previews for release checks.
- Special cooldown was authoritative but absent from public player snapshots;
  browser check timed out at 34.7s. Publish optional `specialTick` to make visual
  windup gating agree with authority. Never use timeout waits as proof of behavior.
- Test fixtures must satisfy real save validation before launching a browser:
  physical logs require numeric `log` IDs and an existing tree source, and stone
  deposits require maxHits=3. Invalid fixtures wasted ~32s waiting for a room.
- Touch mining test initially tapped behind the bottom equipment row. Look down
  through real touch input before projecting the visible rock target. UI occlusion
  is not a physics defect; inspect screenshots and hit coordinates before changing code.
- New fracture faces cannot reuse packed atlas UVs derived from arbitrary position:
  actual browser showed rainbow swatches. Use artist-authored UV-free mineral
  material for interiors, retain original textured exterior, dispose owned materials.
- The old pick burst VFX duplicated the persistent wall with huge temporary cyan
  crystals. The wall now owns its own emergence; no duplicate generic spell geometry.
- Ground exactness requires triangle interpolation, not bilinear interpolation.
  Renderer grid changes must also update TERRAIN_GRID and terrain-triangles tests.
- Old world-content tests ignored starting-world caches and meteors; assert deltas
  from initial state. Floating point mirror assertions must tolerate signed zero.
- Native event microtasks can run between listeners; trusted-keyup status must
  survive the entire dispatch to restore pointer lock (clear next task, not microtask).
- Do not throttle the hand pose preceding a one-shot grip/pouch action. Keep ordered
  transport and do not let a throw enter the pouch branch. Physical grab selects a
  nearby capsule even when the controller ray points away.

The original peer on 8789 and its tunnel are preserved. Root QA uses separate
8799/5188 processes; stop only those owned sessions at handoff. Release details
are appended after public verification.
