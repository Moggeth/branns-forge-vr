# Four-creation Luna trial

Open `outputs/atelier-trial-20260924/Play Atelier.cmd` for the offline desktop showroom, or `Play Atelier VR.cmd` for VR. Four named stands and a training dummy are provided. No API requests or persistent progression changes. Close the window to stop; diagnostics are in the package logs/atelier.log.

- Orchid’s Edge: refined blade, leaf inlay, jewel setting, wrapped grip. Existing chopping and Shelter alternate action preserved.
- Copperpot apprentice hammer: forged steel cheeks, exposed copper collars, maker mark, leather grip. Existing interactions and Brann’s striking geometry preserved.
- Glowmoth Lantern: grip to carry, trigger to deploy a separate scouting light; trigger again to recall. Hinged lid, moving wings, wall-aware travel. If a return path is blocked it pauses; clear the route and retry.
- Stormbell: strike a dummy/enemy to charge (three levels); aim and trigger to spend that charge on a directional chime. Walls block damage. Ghost fire immunity remains intact.

Desktop: WASD walk, hold right mouse to look, E pick up/drop, left click use. VR: grip to hold, trigger to activate. Collection return buttons recover dropped items. New gadgets have collection homes in the main game too.

## Evaluation
Four gpt-6-luna owners authored the assets. Three worker slots were available, so the fourth started when the first freed a slot. Parent supplied integration, visual review, geometry corrections and gameplay verification. Useful parallel first passes, but not unattended finished art: render review caught reversed faces, buried decoration, disconnected construction and overbright wings that parsing/bounds checks missed. No reliable per-agent token/cost measurements were available.

Final actual-render geometry: axe 14,502 triangles / 9 surfaces; hammer 2,042 / 8; carried lantern 3,596 / 15; Stormbell 8,185 / 19. These are complexity counts, not measured VR frame-time claims.

Source integration: 25 atelier checks and 75 fairy regression checks passed. Three native rendered angles per item are in outputs/atelier-review. Headset ergonomics still need human playtesting. The new gadgets use bounded effects and existing pickup/collection infrastructure; they are hand-authored runtime capabilities, not evidence of unrestricted live generation.

Rebuild: scripts/Build-Atelier.ps1. Verify: node scripts/check-atelier.cjs; node scripts/check-fairy.cjs. Pack verification: node scripts/check-atelier.cjs --pack outputs/atelier-trial-20260924/LittleWing.pck.
