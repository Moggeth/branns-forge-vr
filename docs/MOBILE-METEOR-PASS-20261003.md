# Mobile, meteor and skeleton pass

Direct user follow-up to the paused sprint. Both bounded personal Opus commissions finished before the weekly reset.

## Provenance and measured timings
Both verified fauxgrady@gmail.com, claude.ai pro, requested/actual claude-opus-5-5 in cleaned child environments. Mobile: work/opus-mobile-compact-20261003, 336.470 s. Meteor: work/opus-meteor-creature-20261003, 419.036 s. Root reviewed and integrated. No API billing or paid extra usage.

Measured tool groups: menu failure 35.447 s; event instrumentation 4.592 s; menu fix/verification 8.865 s; bow/casting 10.878 s; collectible tap/actual seeded meteor 9.564 s; simulation/combat/codec/resource/bounds 0.904 s; 58-module build 0.310 s; final layout 8.722 s; final contact/performance/browser 4.832 s. Detailed commission metadata and QA logs are retained under ignored work/logs.

## Lessons
- A modal opened on touch pointer-up can receive the compatibility click on its newly exposed backdrop and immediately close. Require the gesture to start on the backdrop before closing.
- Small phone-toolbar height changes must not clear a second finger's held bow. Repeated setActive(true) is idempotent; genuine rotation, large layout changes and trigger cancellation still clear input.
- CDP partial touchEnd lists released fingers. Restore viewport before reusing coordinates in subsequent tests.
- Imported trees=[] does not remove deterministic generated trees; not a supported save field.
- Use rg --files and -g patterns on PowerShell, not guessed paths or shell wildcard operands.
- Explicit UTF-8 for Python file I/O: default cp1252 rejected existing smart punctuation before writes. Failed documentation command plus unnecessarily continued layout test took 9.004 s. Check failures before dependent work.

## Evidence and limits
Exact contact suite preserves bone gaps, animated embedding, severed poses, source isolation. Bounds cover 4,320 animated mesh poses and 15 exact contacts. Chromium 32-skeleton miss mean 0.8225 ms/p95 1.1 ms; eight shadow casters reduce fixture draws 1,729 to 1,081. Four are used on touch. This is desktop measurement, not phone FPS.

Portrait 390×650 and landscape 844×340 lobby/all four menu pages fit. Real touch quick cast, Sunder drag, normal confirmation, pinch/cancel, two sticks, jump, attack, held bow/special/release pass. A visible loose gem collected via tap. A seeded Starfall produced the meteor-born golem. Thirteen authority tests cover chance, reward once, overflow saves, ordinary deposits, spending, range and raw-ore rejection; seven art tests cover unfolding, late join, shared materials and cleanup. Physical phone/headset/separate-network acceptance remains outstanding.

Commands: node multiplayer/tests/meteor-resources.mjs; meteor-creature.mjs; skin-bounds.mjs; enemy-shadow-budget.mjs in same directory. Browser suites: browser-mobile-layout.mjs, browser-touch-casting.mjs, browser-touch-resources.mjs using existing acceptance helper/environment. Root QA on 5188/8799; preserve original 8789 peer/tunnel.

Production build caught one cp1252 em dash in the newly added lobby error message (1.077 s); the engineering build excludes lobby.js and did not catch it. Repaired only the invalid byte span, preserving existing UTF-8. Production build is mandatory before deployment.
