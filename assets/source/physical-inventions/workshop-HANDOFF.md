# Invention workshop panel: handoff (Opus 5.5, 2026-10-03)

## Files (all in this folder; nothing outside it was edited)
- `invention-panel.js`: ES module with no dependencies. Exports `createInventionPanel`, plus the `STRUCTURES`, `RESOURCES` and `ORES` catalogues.
- `invention-panel.css`: self-contained styles. Every class uses the `ip-*` prefix, so they don't collide with `fs-*` in forge-panel.
- `preview.html`: mock fixture. It pushes a snapshot every 250 ms and logs callbacks. To view it, serve the folder (for example `npx http-server` or `python -m http.server`) and open it in device emulation at 390x650 and 844x390.
- `forge-panel.js/css`: reference copies. They are unchanged, and the existing forge drawer still works.

## API
```js
const p = createInventionPanel({ mount, onAction, onClose, onPlace });
p.show(model); p.update(model); p.hide(); p.visible(); p.dispose(); p.setTab('build'|'stores'|'built');
```
| UI | Callback |
|---|---|
| Build card "Place X" | `onPlace(id)` (root handles world placement) |
| Timberline/Launcher "Aim & fire" | `onPlace('operate:' + structureId)` |
| Built "Use" | `onAction('inventionUse', {structureId})` |
| Built "Repair" | `onAction('inventionRepair', {structureId})` |
| Stores "Deposit everything carried" | `onAction('inventionDeposit', {})` |
| Stores "Refine 1" | `onAction('inventionRefine', {kind:'ironOre'|'mithrilOre'|'starOre', amount:1})` |
| Settlement orders (`model.legacyActions[]`) | `onAction(a.action, detail)`, using the same detail rules as forge-panel's `actionDetail`, so workers/raid actions keep working |
| ✕, scrim, Escape | `hide()` then `onClose()` |

`structureId` is returned in its original type (number or string), the same way forge-panel does it.

## Model (every field is optional; missing values fall back sensibly)
- `resources` is what the player carries and `stock` is what's stored. `available` is an optional override for the accessible total. Without it, accessible = carried + stored. Maps can be `{wood:3}` or `[{kind,amount}]`. Aliases are accepted: `star_metal`, `gems` (crystal) and `iron_ore`.
- `recipes[]`: `{id, name?, description?, cost, missing?, enabled?, reason?, limit?}`. Each cost line shows the amount needed, carried + stored, and either **"need N more"** or "ready". If `missing` is provided it wins; otherwise the shortfall is calculated. If `enabled` is absent, the panel derives it from the shortfall. If `enabled:false`, the reason shown is the explicit `reason` if there is one, otherwise "Missing 2 Iron, 1 Crystal".
- All 12 structures always appear in Build. `forge` shows as Permanent with no place button. A structure that has no recipe is disabled with the reason "Not offered at this workshop yet".
- `structures[]`: `{id, type, name?, hp, maxHp, phase, usable?, useLabel?, useReason?, cooldown?, repairCost?, repairEnabled?, repairReason?}`.
  - Use is blocked while the phase matches build/construct, or when hp is 0 or the phase is destroyed. Each case shows a specific reason.
  - Palisade and trap have no Use button unless `usable:true`.
  - Repair only appears when `hp < maxHp`.
- `jobs[]`: `{kind, remaining, structureId?, type?, ore?}`. Build jobs appear on the Build tab, refine jobs on the matching ore row, and a job with a `structureId` appears in that structure's phase line.
- `refine?: {ironOre:{enabled, reason, yield}}` overrides the default rule, which enables refining when at least 1 ore is carried or stored. `canDeposit?` and `depositReason?` do the same for Deposit.
- `side`, `title` and `tab` (the initial tab) are cosmetic.

## Behaviour guarantees
- **Focus survives snapshots:** each region (tabs, purse, body) is diffed as an HTML string and only replaced when it changes. Focus is restored by `data-ip-key`, and scroll position is kept per tab.
- **Pointerup isn't swallowed:** rerenders are deferred while a pointer is down inside the panel, then flushed 120 ms after pointerup.
- **Keyboard:** Escape closes. Tab/Shift+Tab are trapped in the dialog. The tablist supports Arrow/Home/End. Other key events are stopped while focus is inside, so game hotkeys don't fire.
- **Disabled buttons:** they use `aria-disabled` and stay focusable. The reason is always visible beneath the button and linked with `aria-describedby`. Pressing a disabled button shakes it and announces the reason through a polite live region.
- **Layout:**
  - Portrait (≤560 px wide) is a bottom sheet up to 92dvh.
  - Short landscape (height ≤500) puts the tabs in a left rail, so all the vertical space goes to content.
  - Desktop is a centred dialog of 720x640 or smaller.
  - Only the body scrolls. Safe-area insets are respected. Tap targets are at least 44 px.
- No gameplay HUD is added. The panel only exists while it is shown.

## Integration notes for the root
1. Import the CSS once, create the panel when the workshop opens (or lazily), and push snapshots with `update()`.
2. `onPlace(id)` should usually call `hide()` (or leave the panel visible while it is in a non-modal placement mode), then start the root's ghost placement. Do the same for `operate:` aiming. When the root finishes, it can call `show()` again.
3. The server must still validate everything. The panel's enable/disable state is advisory.
4. To keep the old forge drawer, pass its worker and raid actions through `legacyActions` instead of removing them.

## Verification status
- Checked: `node --check` passes, and the module import lists all exports with 12 structures.
- **Not checked:** no browser screenshots were taken at 390x650 or 844x390 within the 10-minute budget, and the module hasn't been wired into the integrated root. Before accepting it, open `preview.html` in device emulation. Confirm there is no horizontal overflow in the purse strip at 390 px, that focus holds on a button through the 250 ms ticks, and that Place and Use clicks fire while snapshots are live.
