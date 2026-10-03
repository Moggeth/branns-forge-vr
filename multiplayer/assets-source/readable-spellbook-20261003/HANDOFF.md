# Handoff — readable spellbook + forge drawer (Opus 5.5, 2026-10-03)

Files (all in `output/`): `spellbook.js` `spellbook.css` `forge-panel.js` `forge-panel.css` `preview.html` (static demo, synthetic data only) and this note.
No framework, no deps, no network. ES modules matching `reference/spells.js`.

## Verification done
- `node --check` passes on both modules (Node 24.14).
- Node logic test: `spellState` cooldown/mana math (45-tick cooldown, 60 Hz), `formatRemaining`, all 14 spell icons present, `actionDetail` extracts `{kind, amount}` for forgeSupply.
- **Not done:** no browser render or screenshot was taken, and the 390×844 and 844×390 layouts were not visually checked. To review them, serve the parent folder from any loopback static server and open `output/preview.html` (`?touch=1` simulates touch play, `?forge=1` opens the drawer).

## 1. Spellbook — `createSpellbook({root, spells, icons?})`
```js
import { SPELLS } from './spells.js';
import { createSpellbook } from './spellbook.js';
// MUST run before lobby.js's `for (button of [data-spell]) addEventListener('click', …)` block.
const spellbook = createSpellbook({ root: $('godHelp'), spells: SPELLS /*, icons: {golem:'/art/golem.webp'} */ });
// in the existing 10 Hz HUD refresh, with the interpolated tick:
spellbook.update({ mana, tick, spellTicks /* {spellId: lastCastTick} */, selected: spell, enabled: phase==='game' && currentRole==='god' });
spellbook.dispose(); // restores the original DOM
```
- **The existing buttons are augmented in place.** The same `<button data-spell>` nodes, their `aria-checked`, `tabIndex`, `kbd` and `.bf-cost` stay. `.bf-spells` is *moved* into a `.sb-bar` pager shell, which keeps its listeners, so root bindings work whether init runs before or after them. It is still safest to init first, as the brief asks.
- **Every spell stays reachable:** prev/next arrows (shown only when the row overflows, `aria-disabled` at each edge), the vertical mouse wheel while the pointer is over the bar, mouse/pen drag, native touch pan, and focus-scroll for the root's existing arrow-key handler. The old fade mask is removed.
- **Drag never selects:** a drag past 6 px sets a flag, and a capture-phase click listener on `.bf-spells` swallows the click that follows. Capture on the ancestor runs before the root's per-button listeners. The wheel only calls `preventDefault` when the row can actually scroll, so canvas input outside the bar is untouched.
- **Mana vs cooldown:**
  - *Not enough mana:* a cold blue wash, a blue icon and a **red cost badge**.
  - *Cooldown:* a dark conic veil sweeping from 12 o'clock (`--sb-cd` = remaining fraction) plus compact seconds (`0.6`, `12`).
  - Both can show at once. Buttons are never `disabled`; status goes into `title` and `aria-description`.
- **Cooldown data comes only from `update()`:** remaining = `cooldown − (tick − spellTicks[id])` ticks ÷ 60. There are no timers of its own.
- **`selected`** adds `.sb-selected` and auto-scrolls the card into view if it is hidden. `aria-checked` stays owned by root `chooseSpell`.
- **Icons:** 14 custom inline-SVG silhouettes (`SPELL_ICONS` export), tinted by the existing `data-school` colour. Supplied generated art (`icons[id]` or `spec.iconUrl`) takes priority.
- **QuickCast:** a bolt-in-ring icon is inserted after `input#quickCast`. Off means dim. On means an ember outline, a glow and `· on`. It plays one 0.8 s pulse on activation, skipped under `prefers-reduced-motion`. The root's `change` listener and the input itself are unchanged.
- **Legend:** one `li.sb-legend` is appended to the existing `.bf-help-list` and removed on dispose.
- **Sizes:**
  - Desktop cards are 62×66 px; the bar is ≤100 px tall.
  - Coarse pointers get cards of at least 56×52 px, and the arrows are 34×44 px.
  - Names never clip: cards grow (`min-width`) rather than truncate.
  - Touch landscape reserves `clamp(110px, 19vw, 190px)` on each side for thumbsticks, plus safe areas (tune with `--sb-reserve`). Touch portrait uses the full safe width.
- Extra exports: `spellState()` and `formatRemaining()` (pure), and `scrollToSpell(id)` on the instance.

## 2. Forge drawer — `createForgePanel({mount, onAction, onClose})`
```js
import { createForgePanel } from './forge-panel.js';
const forge = createForgePanel({ mount: document.body,
  onAction: (action, detail) => session?.command('action', { action, ...detail }),
  onClose: () => {/* root bookkeeping */} });
forge.show(settlementView); forge.update(settlementView); forge.hide(); forge.visible(); /* also forge.isOpen */ forge.dispose();
```
- **Renders only the model.** Actions appear exactly as provided, with `label`, `cost` (number, string or `{wood:10}`) and `cooldown` (a number is shown as seconds; a string is shown as-is). Disabled actions use `aria-disabled` so they stay focusable, and show their `reason` in red. Pressing one shakes it and sends nothing. Missing stock values show `—`. Nothing is invented.
- **`detail` for buttons:** `action.detail` if present, otherwise every non-display field. For example, `{action:'forgeSupply', kind:'wood', amount:10}` → `onAction('forgeSupply', {kind:'wood', amount:10})`.
- **Worker job selector:** a Wood/Stone/Gems radiogroup that calls `onAction('forgeAssign', {workerId, kind})`. If the model includes a disabled `forgeAssign` action, the selector is blocked and shows that action's reason.
- **Economy loop strip:** Gather › Improve/Defend › Raid › Rewards. It highlights the stage of the *first enabled action*, which is also marked "Next" with a glowing button. Mapping: Supply/Assign/Summon/Contribute → Gather, Upgrade/Defend → Improve, Encounter → Raid.
- **No auto-raids:** `forgeEncounter` needs a second press ("Confirm: …") within 3.5 s. Nothing fires on show or update.
- **Accessibility:** a `role=dialog`, `aria-modal` drawer. Escape closes it and calls `onClose`, and a scrim click does the same. Tab is trapped inside, and focus returns to the previous element on hide. Keydown is stopped while focus is inside, so game hotkeys don't fire. Focus and scroll are preserved across `update()`.
- **Layout:**
  - Desktop: right drawer ≤380 px.
  - Portrait ≤560 px (390×844): bottom sheet, max 82 dvh.
  - Short landscape ≤480 px tall (844×390): a 560 px two-column drawer.
  - The body scrolls internally and never spills. Safe areas are respected, and all targets are at least 44 px.
- **Styling:** every class is `fs-*`, theme tokens are scoped to `.fs-host`, and nothing depends on the mount. Supports reduced motion and forced colours.

## Integration checklist for root (Codex-owned)
1. Add `<link>` tags for `spellbook.css` (after styles.css / combat-hud.css) and `forge-panel.css`.
2. In lobby.js, call `createSpellbook` before line ~632's `[data-spell]` binding loop, and add `spellbook.update(...)` to the HUD refresh. Keep the `.bf-spells` keydown handler as it is.
3. Build `settlementView` from authoritative session state, and call `forge.update()` on every state push while it is visible.
4. F1/Tab/field panels, the core HUD and game refs are untouched by both modules.

## Known limits / next refinements
- Not visually reviewed in a real browser (see Verification).
- The thumbstick reserve is a CSS estimate. Align `--sb-reserve` with the real mobile stick radius.
- Encounter objects are shown as title plus any of `status/state/phase/threat/reward/rewards/result`. Extend this if the server schema differs.
