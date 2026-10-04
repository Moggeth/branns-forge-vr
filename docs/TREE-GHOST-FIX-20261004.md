# Standing ghost trees after harvesting

Reported: some visible trees could not be chopped; felling could leave an intact
copy in the same place. Reproduced on the current main, cb51b67.

`tree-batch.js` swap-removes a harvested tree's intact instance. Snapshot sync,
growth animation and distance-detail switches each call `flush()`, sometimes
several times before the renderer uploads the buffer. Each flush discarded the
previous pending ranges. The GPU could retain the old tree transform while the
CPU slot/target map had already changed. Offscreen batches could retain that
disagreement even longer. This explains both a duplicate standing tree and a
visible trunk whose real interaction position was somewhere else.

The fix unions outstanding dirty intervals and clears them only after Three
acknowledges upload. There remains at most one interval per part buffer, including
when hundreds of updates arrive while culled. Geometry and tree gameplay rules
are unchanged.

Regression: `cd multiplayer; node tests/tree-batch-upload.mjs`. It uses Three's
real WebGLAttributes uploader with in-memory GL buffer storage; CPU-only matrix
assertions would miss this bug. The unmodified implementation failed at "chop
followed by growth: GPU and interaction positions disagree". Nine cases now pass:
consecutive pending changes, LOD/removal, capacity growth, deferred uploads, and
single-slot upload bounds, plus the real authored GLBs through wounded, landed
and late-loaded states. This establishes upload correctness, not a fresh physical
phone/headset playtest. No browser, cursor capture or VR runtime was needed.

Measured verification: initial reproduction command 0.197 s; first focused
regression plus existing tree checks 0.677 s; extended authored regression
54.039 ms; extended test and production build command 1.102 s. The old `batching`
suite remains in the repository's explicit stale list: its shader/growth and
geometry-count assumptions report six failures. Its authored trunk targeting,
single-tree de-instancing and resource ownership cases passed. The new regression
is in the required suite, not the non-blocking historical list. Full-suite and
deployment evidence is captured in ignored `logs/tree-fix-*`.

The complete local run passed 158/159 suites in 106.5 s; the only failure was
missing front matter in the new patch note, corrected before release. Re-ran the
patch-note parser after adding the required date, area and title. Always copy the
current patch-note schema before writing an entry: these files feed the live UI.

Recurring lesson: never clear a BufferAttribute's pending update ranges merely
because a newer simulation/render update arrived. Merge them or retain a pending
whole-buffer upload until renderer acknowledgement, as with terrain geometry.
Always test more than one flush between uploads and offscreen/culling delays.
