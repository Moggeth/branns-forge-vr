# Embedded arrows and bolts

The shared `projectile_attachment.gd` constraint preserves the struck part, articulated bone name, complete local projectile transform, local impact point, entry direction and penetration depth. Emberwing keeps its 3.5 cm penetration; Siegebird keeps 4.5 cm. The projectile remains in its existing bounded pool. It does not add a rigid body or a joint per arrow.

Rigid pieces follow their mesh transforms. Imported guardian contacts choose the dominant weighted bone at the actual struck triangle; the constraint reads that bone's current global pose directly. Reading the pose avoids a stale BoneAttachment transform when animation and impact happen within the same frame. The constraint is refreshed after both character animation and detached-leg spring articulation.

Death and structural detachment now explicitly hand off existing attachments to their matching physical remains. The handoff evaluates the source's current pose, converts that exact world transform to the new local frame, and preserves the contact metadata. Rigid pieces that are reparented retain their own surface. Baked skinned replacements take over from the hidden living rig; lower-leg and foot attachments follow the spring knee and ankle. Part/source matching prevents a rib arrow from jumping to a different bone. Already transferred projectiles do not migrate back when the living actor respawns. Released guardian shields also receive their attachments. Recovering a crossbow bolt unregisters its constraint before returning it to the hand.

For future replacements, call `game.projectile_attachments.handoff(actor, part, new_body, old_piece)` while the old pose is still available, after the destination is positioned and articulated. Do not choose an arbitrary nearby corpse or recompute entry orientation from the new body's origin. Register with `bind(projectile, surface, hit)`, update with `update(entry)` or the final `tick()`, and unregister recovered objects with `release(projectile)`.

## Verification

`--headless --xr-mode off --audio-driver Dummy --path godot --script res://projectile_attachment_checks.gd` exercises the imported Mossward skull and arm, current-bone following, exact local pose/impact/direction/depth retention, baked authored-skull death transfer, rigid shatter, structural leg detachment, spring knee/ankle motion, and recovered-bolt release. The fixture passed in 0.33 s (13.408 ms in-fixture measured work); it uses no live service or saves.

The actual arrow flight fixture still passes 42 checks in 9.55 s; existing bow checks pass 39 checks in 9.01 s. Weighted-contact tests pass all three guardians in the 0.87 s combined targeted verification. Main service integration passes in 70.787 s, including physical crossbow recovery/ledger paths. Logs and timing records live under ignored `logs/`.

Limits: dominant-bone attachment is a rigid constraint; it does not continuously deform a rigid arrow across several blended skin bones. That keeps the shaft straight and cheap. Existing projectile/remains expiry and caps remain; an attachment disappears when its actual host is retired. This is tested offline, not certified by a new headset playtest. Relaunch normally to load; the running game, SteamVR and saves were preserved.
