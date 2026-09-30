# Item controls and input audit

The 20 entries in `godot/weapon_inspection_catalog.json` are covered by the explicit binding map in `godot/item_control_hints.gd`. The map is used for the FPS corner hint and the short VR item billboard. These are controls of installed native behaviours, not prose copied from a model or generated invention. FPS `Space` jumps, `E` takes or deliberately drops held equipment, and `X` throws it with a sampled impulse; Sunskipper uses `E` to throw its ring and Copper Kite uses `X` to toss captured cargo. VR grip takes or releases equipment.

| Item | FPS | VR | Action owner |
|---|---|---|---|
| Copperpot's Promise, apprentice hammer | LMB strike; RMB Forge Pulse | Swing; trigger Forge Pulse | `melee_contact`, `item_interactions` |
| Orchard's Edge | LMB swing/chop; hold RMB through contact for Power Cleave | Swing/chop; hold trigger through contact | `melee_contact`, `item_interactions` |
| Stonewhisper | LMB mine; RMB charge for 8 seconds, then strike ore | Swing/mine; trigger charge, then strike | `melee_contact`, `item_interactions` |
| Swallow Line | LMB attach/hold to reel, release to pause; RMB detach | Trigger attach/hold to reel, release to pause; release grip to detach | `item_interactions` |
| Mooncap Lantern | Carry for light; RMB spore garden | Carry for light; trigger spore garden | `item_interactions` |
| Hollow's Song | LMB strike; RMB resonance fan | Swing; trigger resonance fan | `melee_contact`, `item_interactions` |
| The Last Hearth | LMB strike; RMB firebolt and ward | Swing; trigger firebolt and ward | `melee_contact`, `item_interactions` |
| Apprentice hammer | LMB strike; RMB Forge Pulse | Swing; trigger Forge Pulse | `melee_contact`, `item_interactions` |
| Glowmoth Lantern | LMB swing; RMB release/recall moth | Trigger release/recall moth | `atelier_runtime`, `glowmoth` |
| Stormbell | LMB strike to charge; RMB chime | Swing to charge; trigger chime | `melee_contact`, `atelier_runtime`, `stormbell` |
| Forge Lantern Sol and Opus | LMB toggle shutter/light | Trigger toggle; free hand pulls physical shutter | `forge_lantern` |
| Siegebird | LMB fire; R cock/seat unlimited bolt; C at rack fit/return real reel; RMB switch bolt/grapple when fitted; hold R to reel live tether | Trigger fire/release tether; free hand crank/seat belt bolt; physical reel/socket and brass selector | `siegebird_runtime`, `siegebird_extras` |
| Wyrmspout v2 | Hold LMB fire; release to cool; RMB vent | Hold trigger fire; right B vent | `wyrmspout_runtime` |
| Emberwing | Hold LMB draw, release fire; hold RMB and turn for phoenix arc | Grip bow/string, draw/release; bend for phoenix arc | `phoenix_bow` |
| Sunskipper | LMB change power/recall; E throw; Q/R bank | Trigger change power/recall; release grip to throw; wrist bank | `playful_tools` |
| Copper Kite | LMB pull/drop marked block; X toss | Trigger pull/drop; A toss | `magnetic_wand` |
| Mossward, Prismwatch and Cinderkeep shields | LMB bash; RMB variant ability | Face shield to block, swing to bash, trigger variant ability | `guardians/skeleton_guardians` |

The review catalogue omits Pocket Thunder because it is a worn hand ability. Its FPS hold/release formation and VR grip/trigger/throw path are owned by `adventure_runtime` and the bomb input code. It also omits the older Wyrmspout v1 and historical generated GLBs; they must be checked against the live registered item, not treated as the v2 native asset.

For generated GLB inventions, `use_instructions` is authored content and may describe VR gestures. The FPS hint intentionally uses a generic `LMB use / RMB alternate where supported` message instead of replacing the word “trigger” with “RMB”. An invention's real action can be a melee contact, an enchantment alternate, the registered Sunfall adapter, or the server `/api/vr/ability` route. The dispatch must check the actual installed item before promising a specific effect. Living Workshop components and plain pickup props likewise have no universal alternate attack.

The managed/generated route audit is narrower than the native catalogue: `main._trigger` asks the local service for `/api/vr/ability` only after native handlers decline; `enchantment_runtime.alternate` can own a Verdant heal or Hearth ward; `melee_contact.strike` delegates registered Sunfall contacts to its adapter. `living_runtime.trigger` handles installed Living Workshop components and package inspection. These paths have different preconditions and some generated objects are just materials or props. An unregistered GLB or a historical item without its adapter gets no promised special action in the HUD.

## Siegebird reel and axe state

`siegebird_extras.desktop_toggle_reel(hand)` transfers the **one existing reel** between its supply rack and the held bow. It requires the player to stand within 3 metres of the rack in the forge yard, rejects a live tether, and refuses to take a reel held by another hand or bow. Removing it clears grapple mode and returns the same node to the rack. VR physical fitting, selector flipping, and bolt handling remain separate. FPS `C` is the missing input hook; the FPS hint reports whether the reel is fitted and whether the tether is live.

`item_interactions.desktop_axe_state(item, right_button_held)` arms Orchard's Edge only while RMB is held, exposes `axe_power_ready` for the HUD, and shows a persistent small glow at the axe tip. `melee_contact._powered` still checks RMB at the actual strike contact; a tap before a later swing does not count. `desktop_axe_impact(item, point, powered)` provides a visible contact burst when Main reports a powered hit.

## Main dispatch points

The main scene owns keyboard and mouse input. Its integration must route `C` to `desktop_toggle_reel`, call the hint mapper from `_desktop_hint`, and update `desktop_axe_state` every desktop frame. `_desktop_alternate` must arm the axe before generic alternates and call `atelier.trigger` for Glowmoth/Stormbell. `_desktop_primary` must pass Forge Lantern clicks to its shutter action before the generic melee branch. `E` must be a deliberate drop with sampled hand velocity cleared; `X` uses the sampled velocity for a real throw, and `Space` uses the locomotion jump path. A generated invention with an installed server ability needs a desktop alternate fallback that calls `_trigger`; this should be limited to registered generated inventions so plain props are not advertised as weapons.

## Fast check

From the repository root, run:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://item_control_checks.gd
```

Expected output is `ITEM_CONTROL_RESULT []` and exit code 0. This check loads no player save, service, or VR session. It verifies all 20 hints, the physical reel transfer and guards, generated instruction fallback, and the desktop axe readiness marker. The full main-scene check is much slower because it loads the complete workshop inventory before reaching item checks.

Measured during this change: catalogue and route inspection completed in three shell reads of 0.4–0.8 seconds each; the first isolated check reached `ITEM_CONTROL_RESULT []` but remained in OpenXR shutdown for more than 15 seconds. Adding `--xr-mode off` made the same check exit in 0.43 seconds. A later axe-marker check exposed a missing-meta warning in 0.42 seconds; guarding `get_meta` with `has_meta` removed it, and the final check exited cleanly in 0.55 seconds. Use the XR-off command above for this repeatable diagnostic.
