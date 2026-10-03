# Solo play and physical world feedback

Both solo roles now have a finite-resource forge loop: recruit up to four workers, assign timber/stone/gems, improve the forge, build wards, challenge raids and earn supplies. Open **Forge** under the God spell bar, **Manage forge** from the menu/party screen, or the VR wrist panel's Forge page. Heroes must be near the forge. Raids require confirmation. Resources, workers and encounters persist in recovery saves. See [solo settlement](SOLO-SETTLEMENT-20261003.md) for costs and authoritative validation.

The compact 14-spell bar supports arrows, wheel, drag and keyboard selection. Cards show cost, shared 0.75-second casting recovery and unavailable reasons. Quick Cast has its own active glyph. Each spatial spell has a distinct surface-conforming marker; Sunder deforms collision and visible earth progressively. See [progressive Sunder](../multiplayer/PROGRESSIVE-SUNDER.md).

Skeletons emerge from soil and golems assemble their articulated pieces. Damage and local scorch persist through collapse and detached remains. Optional small damage numbers are off by default in menu controls. See [creature life/death](CREATURE-LIFE-DEATH-20261003.md).

Held weapons now have Opus-authored diegetic readiness: axe edge runes, pick crystal settings, hammer collar, crossbow dial, bow embers, bone etching, flame heat/vent rings and flask collar. Shared authoritative ticks drive them. Melee backswing remains the basic attack recovery cue; the added melee indicators show special recovery. A separate pristine flask template prevents copying live indicators into thrown bottles. Lifecycle instances use WeakMap rather than circular Object3D.userData, preserving clone safety.

## Verification and measured timing

- UI Opus5.5 commission381.085s; weapon readiness900.884s timed out while rendering, followed by verified73.493s finish; both used freshly verified personal claude.ai subscription, exact requested/init/final model for completed deliverables.
- Terrain and creature commissions723.470s and842.793s; provenance in their linked handoffs. No metered API or paid extra usage.
- Combined simulation/terrain/creature/session/readiness tests:21 passing in2.549s. Independent readiness tests use real shipped GLBs and held limbs; availability suite compares544 cases with authority. VR wrist tests20 passing.
- Browser solo workflow8.669s: all14 spells accessible, casting recovery shown, worker recruitment and reassignment, deliberate raid confirmation, damage-number setting, drawer bounds and labels at390x844,844x390,1024x768,1280x720. No browser errors. Actual screenshots in ignored logs/solo-world-feedback/captures.
- Browser weapon mastery10.257s: delayed axe release, persistent curved pick wall, left-hand bow and zero browser errors. Build350–356ms.
- Solo worst-case simulation64enemies/4workers/64edits: mean5.205ms,p95 9.340ms,max12.301ms in1200ticks. Fixture CPU timing is not GPU frame rate.

## Lessons and recovery

Use built Vite preview for browser acceptance while other owners edit source; HMR can reset a live room mid-test. QA peer uses PEER_PORT, not PORT; an incorrect variable caused EADDRINUSE on8789 without affecting the resident peer. Preserve that original peer/tunnel. Measure settled panels after their220ms entrance animation; measuring immediately produced a false out-of-bounds failure. Forge button cost badges must wrap underneath labels, not compete for one row and squeeze names to one letter per line. Initial terrain signatures use null; empty string is a valid empty-edit signature and previously skipped initial terrain geometry construction.

Run browser acceptance with PW_CORE/PW_CHROME pointing to installed Playwright/Chromium, ACCEPT_BASE to a disposable preview and BROWSER_QA_DIR to ignored logs. Tests use real controls and a read-only acceptance probe. Physical headset, phone GPU and separate-network acceptance remain unverified.

The next user-requested mining/weapons/UI/performance pass is separate from this checkpoint. Public deployment status is recorded after verification rather than inferred from local tests.
