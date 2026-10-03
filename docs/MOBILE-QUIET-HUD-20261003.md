# Quiet mobile HUD — 2026-10-03

## Player-visible change

Touch HUD is substantially smaller in both God and Hero modes. The selected
spell/weapon is the palette opener; tap it to choose from all spells/equipment.
Quick cast remains beside it. Menu and camera actions remain on the screen edge.
World code, invitations, role switching, help and party live under More.
Quest is a compact labelled chip with its primary action; tap to expand details.
God HP appears when damaged, while mana remains visible. Hero keeps both meters.
Thumb pads are translucent. Heal/Deliver/Drop join Actions; contextual Collect
remains directly available. Tiny build tag is retained for screenshot diagnosis.

The change scopes to touch gameplay; desktop and simulation are unchanged.
Palettes preserve existing DOM nodes and handlers. A dismissal scrim eats the
outside tap so closing a palette cannot accidentally cast. All 14 spells retain
names, costs and cooldowns. Open palettes are real wrapping grids, not scrollers.

## Design provenance and integration

Claude Opus 5.5 authored concrete mobile-quiet.js/CSS in the isolated folder
work/opus-mobile-quiet-hud-20261003. Fresh cleaned-child auth verified personal
fauxgrady@gmail.com, claude.ai Pro; init and final metadata both explicitly
claude-opus-5-5. Commission passed in **436.649 seconds**. No API billing.
Codex integrated the module and verified real controls. Preserved the user's
always-visible build tag rather than the proposed hidden mobile tag.

Integration repairs: reset inherited grid-auto-flow:column; layer open palettes
above independent thumb pads; fix stronger legacy quest positioning rules;
move existing quick-action nodes into Actions and restore when leaving touch;
avoid requesting source CSS after Vite bundles it. Related menu repair contains
a hidden checkbox and sizes the left-handed control without reducing its label's
44px touch area. Short landscape damage-number help shares its row.

## Verification

Actual Chromium touch context, built production output, all real UI actions:
- 844x390, 960x440, 1280x591, 390x844 and 844x340 God layouts.
- Hero landscape/portrait; seven owned weapons and all 14 spells selectable.
- Bone button remains available, but equipping requires a collected limb as before.
- Help/party, secondary actions, palette dismissal without casting.
- Quick tap, drag Sunder, manual confirm, pinch/cancel, dual thumbs, jump/attack,
  bow hold through movement release, two-finger special and cancellation.
- Lobby/menu fit checks at 390x650 and 844x340; two-player touch regression plus desktop emergence regression.

At 844x390, sampled input coverage fell from **36.52% to 17.67%** in God mode.
Center region coverage fell from **31.84% to zero**. Hero input coverage is 11.91%.
These percentages measure hit-test coverage, not opacity or a physical-device
usability score. Screenshots reviewed in logs/mobile-quiet-built/captures.
Physical phone/safe-area comfort still needs on-device acceptance.

Commands (cwd multiplayer): node tests/browser-quiet-hud.mjs,
node tests/browser-touch-casting.mjs, node tests/browser-mobile-layout.mjs,
node tests/browser-friends.mjs. Existing Playwright harness accepts ACCEPT_BASE,
PW_CORE, PW_CHROME and BROWSER_QA_DIR. Verify built output, not source CSS injection.

## Measured work and lessons

- Initial discovery/auth/fetch: 0.212 + 1.704 + 1.324 seconds.
- Baseline browser: 4.639 seconds test body (5.108 tool).
- Opus design: 436.649 seconds, exact model/account verified.
- Built HUD/control reachability suite: 13.260 seconds.
- Built touch casting/bow suite: 11.721 seconds.
- Vite builds: 0.342–0.459 seconds; packaged-asset check includes 30 references.
- First layout attempt failed at 7.299 seconds: old column auto-flow created
  implicit columns and independent pads intercepted cells. Explicit row flow
  and open-tray layering corrected both.
- Owned-weapon test initially waited 30 seconds on Bone, correctly rejected by
  authority without a collected limb. Assert only granted equipment as equipable.
- Built Vite removes individual stylesheet link IDs. Do not create a fallback
  request for a nonexistent source CSS path; bundle already contains the styles.
- Menu checks exposed a 372px absolutely positioned hidden checkbox creating
  27px horizontal overflow; constrain the hidden input, not the whole menu.
- A root-cwd test invocation failed in 0.204 seconds. Test commands always use
  explicit multiplayer cwd; diagnostics and runtime state stay in ignored logs.

Final local menu suite: **9.329 seconds**, all four pages fit without scrolling
at 390x650 and 844x340. Short-landscape repair uses reduced gaps, retaining
44px buttons; scope flex layout to the active Controls page to avoid displaying
its settings on other tabs.

Two-client updated-palette test passed in **12.680 seconds**; desktop emergence
regression passed in **7.732 seconds**. The old two-client harness attempted to
tap a now-collapsed spell directly; it now follows the palette UI.
