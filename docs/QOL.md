# Day-one quality of life

Press **B on either Knuckles controller** to open the toolbelt beside your
non-dominant wrist. Point with the other hand and press trigger. **Tab** opens it
on desktop; aim with the crosshair and left click. B, Close or desktop Escape
closes it. Attacks and movement are suppressed while it is open.

## Six implemented improvements

1. **Recall tools + return** cancels forming/live bombs, stops thrown tool motion,
   returns to the Forge Yard, and arranges dropped weapons on the rack. Held tools,
   health and progression remain. Material satchels are not recovered for free.
2. **Bomb clarity** adds amber formation progress, a mint ready ring and text,
   an armed fuse countdown, and a nearby explosion warning. Existing formation,
   readiness, release and impact haptics remain. The optional throw arc previews
   current measured velocity; it cannot predict a future arm movement.
3. **Wrist toolbelt** offers tools, eight destinations, health/material totals,
   comfort settings and the invention archive. Owned tools and finished inventions
   can be selected directly. Locked/first-issue tools still obey workshop rules.
4. **Comfort and reach** supports left/right dominance, 15/30/45/90-degree snaps,
   optional smooth turning at30/60/90/120 degrees per second, seated calibration,
   five-centimetre height adjustments, and distance grabbing from0.5 to5 metres.
   Grab uses a physics ray, respects walls, and works on weapons, tails, satchels
   and hand-collectable resources. Mining/chopping still require appropriate tools.
5. **World feedback** brackets the aimed target and explains compatible actions,
   missing tools or reach. Enemy windups and exposed cores get readable cues.
   Successful gathering shows the amount with floating text and motes.
6. **Invention handoff** announces verified ready items once per loaded session,
   presents them within reach on returning to the yard, and labels their requested
   function and documented extra. Inventions allows selection, presentation,
   equipping and comparison with an earlier version. Refine opens the companion
   with that version selected; it does not submit or spend automatically.

## Settings and implementation

Comfort settings are saved to Godot user://comfort.cfg, normally:
%APPDATA%/Godot/app_userdata/Brann's Forge VR/comfort.cfg.
Camera and tracked controllers share a height-offset parent; the tracked headset
pose itself is not rewritten. Reset by stopping the game and renaming that file.
Diagnostics/smokes ignore and never overwrite the player's comfort file.

godot/qol_runtime.gd owns menu, comfort, recall and native handoff.
godot/interaction_feedback.gd owns feedback visuals.
main.gd integrates input, setup, captures and QoL smoke; adventure_runtime.gd
supplies exact bomb fuse timestamps. The service preserves immutable version
lineage and summaries; see QOL-HANDOFF.md and QOL-FEEDBACK.md.

Closed menu collision shapes are disabled, not just hidden. This prevents an
invisible wrist panel blocking rays or movement. Desktop and VR tooltips use the
same configured reach. Item pickup consumes the grip event so collecting a tail
does not simultaneously start forming a bomb.

## Verification

Verify Brann.ps1 runs20offline tests and three connected Godot fixtures: original
late GLB import, four-tier adventure, and QoL. QoL exercises physical menu ray
selection, comfort modes, tool selection, safe recall, closed-menu collision,
compatible/incompatible feedback, ready/armed bomb cues, within-reach generated
handoff, archive equip and distance-grab range/wall occlusion. No paid generation
or voice is used. Capture examples: --capture=<png> --capture-qol or
--capture=<png> --capture-feedback, always --xr-mode off for desktop diagnostics.
Visual captures disable service calls and normal HUD.

The desktop menu and bomb render were visually inspected. Wrist fit, new haptic
readability and comfort preferences still require the user's headset feedback.
Native VR startup verification after rollout is logged separately.

The height hierarchy is locomotion Node3D -> offset XROrigin3D -> directly parented
tracked camera and controllers. This keeps stereo rendering and tracked scene
nodes aligned; do not insert a plain Node3D between XROrigin3D and tracked nodes.
