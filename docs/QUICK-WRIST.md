# Quick wrist settings and explicit eye-height calibration

Raise an empty left hand within0.2–0.7m of the headset, near face height, with its OpenXR aim direction pointing toward your face. Holding the pose for0.45s opens Quick. Lowering/turning away for0.75s closes only a gesture-opened menu; active slider dragging defers closing. A latch prevents repeated reopen while the same pose is held. B remains a manual toggle and manually opened menus stay open when the wrist lowers. Holding a tool in the left hand or forming/holding a bomb prevents gesture opening.

Quick calls the native tuning panel's quick-key list. The coordinating tuning module defines the current grip thresholds, hand pose rotations, movement speed and target eye-height sliders. Both Quick and Comfort show current eye height relative to the player rig, raw tracked camera height and requested target. The Quick footer includes Calibrate height; Comfort has the same action.

Calibration is explicit: stand or sit naturally, then press Calibrate height. The tracking-space offset becomes target eye height minus raw camera.position.y, clamped to−1.5 through+2m. The existing comfort.cfg stores the offset. It applies independently of the seated preference and is never inferred from a startup pose. Lower/higher adjustments also apply in either mode. Calibration cancels forming bombs and clears hand motion, recent throw samples and tip history so repositioning cannot become an accidental strong throw.

Native ray picking uses game.aim_source(hand), and invention equipment parents to game.hand_socket(hand). This separates the actual OpenXR aim pose from the adjusted grip/visual socket. The gesture uses aim direction, not the raw grip axis.

Parser verified with Godot --headless --xr-mode off --script qol_runtime.gd --check-only in0.263561s. Actual gesture orientation/dwell ergonomics need a headset check. Coordinator owns the revised native smoke assertion: seated preference alone no longer implies a new calibration; call the explicit action and verify the offset remains when seated is switched off.

Editing lesson: a generated JavaScript replacement used Python triple-quoted strings and failed before any write (0.331244s combined command, subsequently parsing unchanged code). Use apply_patch for multiline GDScript edits and check each command exit before treating a subsequent parser success as evidence the edit applied.

Auto-opened panels always anchor to the left hand and menu_hand() returns the right controller for pointing, including for left-handed users. Manual panels retain the user's dominant pointer. Placement updates immediately after the auto-open flag is set. Follow-up parser passed in0.265630s.
