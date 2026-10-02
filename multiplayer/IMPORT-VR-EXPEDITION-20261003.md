# VR Hero Expedition panel

Integrated the completed personal Claude.ai Opus 5.5 commission (exact claude-opus-5-5 verified; 766.410 seconds) from work/opus-vr-expedition-20261003. Editable source lives in client/vr-adventure-panel.js; tests use the actual shared adventure model.

Raise the off-hand wrist into view to inspect objectives, carried materials and the next step. Point the other controller and release its trigger on Start, Deliver, Retry, Rematch or Leave. Leave requires a second intentional confirmation. The panel hides while aiming and consumes its paired trigger events so panel interaction cannot also fire a weapon. God VR remains out of scope.

The 0.22 x 0.165 m panel uses one 512 x 384 canvas texture and at most two draws, repainted only on visible model changes. Teardown/session end clear transient state. Existing source/controller mappings and ground/fire/audio hooks retained. Desktop DOM banner hides in XR. Pointer hand can be restored from branns-forge.vr.pointerHand (left/right); no in-game preference selector yet.

Verification: 15 pure/mock-XR tests passed (0.316s command), production build passed (1.293s including asset validation; Vite379ms). Actual Chromium current client loaded without page errors and started Expedition via real DOM click (10.252s); panel correctly hidden outside XR. This is NOT an actual headset comfort/input acceptance claim. Real Three fixture renders were reviewed in the commission folder. Run node --test multiplayer/tests/vr-adventure-panel.mjs from repo root.
