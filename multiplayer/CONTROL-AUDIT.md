# Brann's Forge — control audit (2026-10-03)

Scope: every button, input, touch action and gesture in `reference/index.html`, `reference/lobby.js`,
`reference/client/mobile-ui.js`, `mobile-controls.js`, `touch-input.js` (+ the `game.js` key handlers
they call). Evidence is static reading of the snapshot plus `tests/dom-contract.mjs` and
`tests/lobby-ui.test.mjs`. **No browser was launched; no runtime/visual claim is made.**

Legend — **OK** works as read · **FIXED** defect with a patch in `ui/` · **RISK** observed but not
patched (reason given) · **NEW** control added by this commission.

## Defects found and fixed

| # | Defect (evidence) | Fix | File |
|---|---|---|---|
| D1 | Hero help says “Weapons — 1–6”; game.js maps Digit1–8 to eight weapons. | Text → 1–8, mentions hold-to-breathe Wyrmspout. | `ui/index.html` |
| D2 | Wyrmspout/Emberdew chips used Unicode glyphs with no `.bf-name` class, so touch/compact CSS that targets `.bf-name` and `svg` skipped them (inconsistent size/labels). | Original `#bfi-wyrmspout`/`#bfi-flask` symbols + `.bf-name`. Contract test enforces icon+label for every weapon. | `ui/index.html` |
| D3 | HUD icon sprite and a stray comment were nested inside `.hud-bottom` (layout container). | Sprite moved to top of `<body>`; ids unchanged. | `ui/index.html` |
| D4 | Touch **Cancel** disabled unless a tapped target exists, but `game.cancelAim()` is also the only way to drop a centre-aimed line start (Sunder/Wall `castStart`). Stuck half-line on touch. | `cancel.disabled = !god`; label “Cancel aim or line”. | `ui/mobile-ui.js.patch` |
| D5 | Clicking **Quick cast** (`#quickCast`) leaves the checkbox focused; lobby.js capture listener and game.js both ignore keys whose target is an INPUT → spell keys and WASD pan silently stop until the user clicks elsewhere. | `releaseFocusAfterPointer()` blurs after pointer toggles only (keyboard users keep focus). Unit-tested. | `ui/lobby-ui.js`, `ui/lobby.js.patch` |
| D6 | In-game **Rejoin** notice calls `start()` while `#lobby` is hidden: notices are cleared and the “Looking for world…” status + Cancel render into the hidden lobby — up to 15 s of nothing. | Rejoin calls `setPhase('lobby')` first (captures room code before teardown). | `ui/lobby.js.patch` |
| D7 | `server_full` matched `/full/` → “That world already has eight players” (wrong). `invalid_role`/`invalid_token` produced “Invalid role.” style text. | `knownErrorText(code)` consulted first; unknown codes fall through unchanged. | `ui/lobby-ui.js`, patch |
| D8 | Import error fallback `friendlyError(..) \|\| 'That file isn’t…'` unreachable (friendlyError always returns text; empty messages became “Something went wrong”). | Use fallback when the error has no message. | patch |
| D9 | Enter in **Your name** with no room code submits the form → “Enter the 8-digit code your friend shared” error for a first-time player who wanted Create. | Moves focus to **Create a world** instead (no error, no auto-start). | patch |
| D10 | VR unsupported: `#vr` silently hidden; no explanation anywhere. | `#vrNote` in the controls card via `describeVr()` (checking / ready / God role / needs https / no headset). | `ui/index.html`, patch |
| D11 | Touch guide said “Axe / Pick buttons — choose the harvesting tool” (stale, eight weapons now); no mention of Special or bone actions. | Rows updated in `mobile-ui.js` guide. | `ui/mobile-ui.js.patch` |
| D12 | Sunder/Wall spell titles did not say they are line spells. | Titles now “· line”; contract test checks against `SPELLS[].target`. | `ui/index.html` |
| D13 | `mobile-ui.css` still sizes legacy `.spell-tray .spell`; the current `.bf-spell` / `.bf-chip` have no touch sizing in the snapshot. | 48 px min targets under `(any-pointer: coarse)`, snap-scroll bars, kbd hidden on touch. | `ui/styles.css` |
| D14 | No role gating guaranteed by the files in the snapshot (combat-hud.css not present): both toolbars could render. | `body[data-role] .bf-hero/.bf-god` gating (body role is already set by `applyRoleUi`). | `ui/styles.css` |

## Lobby

| Control | Handler (reference) | Status / notes |
|---|---|---|
| `#name` input | `change` → localStorage | OK. Added `#nameHelp` (“Leave blank to be Wanderer”); `enterkeyhint="next"`. FIXED D9. |
| role radios `name=role` hero / god | `change` → localStorage | OK. Cards now state both device reach and detail line; checked card gets ember ring + ✓ via `:has()` (degrades to existing style if unsupported). |
| `#create` | `start({create:true})` | OK. Disabled when renderer fails (existing). |
| `#room` input | digits-only `input`, paste normaliser | OK. `aria-invalid` now visibly red. Tabular digits. |
| `#join` (submit) | `#lobbyForm` submit → `joinFromForm` | OK. FIXED D9 for name-field Enter. |
| `#statusRetry` | `start(lastAttempt)` | OK. |
| `#statusBack` | hide status, focus room/create | OK. |
| `#statusCancel` | teardown → lobby | OK. Visible during rejoin after D6. |
| `#savedWorlds` (details) | `toggle` → refresh | OK. |
| `#resume` | `start({create:true, save})` | OK. |
| `#import` file input (label `.file-btn`) | parse ≤ 2 MB then start | OK. Focus ring via `:focus-within`. FIXED D8. |
| `#howToPlay` | `bindControlsCard` toggle | NEW. Pulses (3×, reduced-motion aware) until first close — first-play flow. |
| `#offlineNote` | `bindConnectivity` | NEW. Display-only; never blocks Create/Join or saves. |

## Controls card (`#controlsCard`, single instance moved between lobby and menu)

| Control | Status |
|---|---|
| `#controlsTabDesktop` / `#controlsTabTouch` / `#controlsTabVr` (`data-controls-tab` desktop, touch, vr) | NEW. Segmented `aria-pressed` buttons, not ARIA tabs: lobby.js's window-capture key listener stops propagation of all keys in lobby/menu, so arrow-key tab behaviour cannot work without editing lobby.js. All three are ordinary Tab stops. Default panel from `detectControlScheme()` (XR → vr, touch mode on/auto+coarse → touch). |
| `#controlsClose`, `#controlsDone` | NEW. Close, mark onboarding done (`branns-forge.onboarded`), restore focus to the trigger. |
| Role highlight | Section for the current/chosen role gets an ember border (`data-active-role`). |

## HUD top

| Control | Handler | Status |
|---|---|---|
| `#copyCode`, `#copyInvite` | `copy()` with execCommand fallback + toast | OK. Hidden under touch (available in Menu) by mobile-ui.css. |
| `#vr` | `game.enterVR()`, toast on failure | OK. Hidden unless supported **and** Hero. FIXED D10 (explanation). |
| `#menuButton` | `openMenu` | OK. Touch uses `touch:menu` instead. |
| `#objectiveStart`, `#objectiveRestart` | `bindObjectiveActions` → `objectiveHooks.onStart/onRestart` | NEW. Hidden unless `canStart === true` / `canRestart === true`. They only forward the click. |

## Hero toolbar

| Control | Handler | Status |
|---|---|---|
| `data-equip` axe, pick, hammer, crossbow, bow, limb, wyrmspout, flask | `game.equip(id)`, `blur()` | OK; eight, order = game.js `equipment` = keys 1–8 (contract-tested). FIXED D2. On 360 px the bar snap-scrolls with an edge fade. |
| Actions drawer (summary “More actions”) | native `<details>` | OK. |
| `#collect` / `#bridge` / `#grab` / `#drop` / `#throw` | interact / buildBridge / grab / release / release(true) | OK; each blurs after click. |
| `#special` | `game.special()` | OK. Outside the drawer so a second thumb reaches it while Attack is held (verified by reading: Attack uses pointer capture on its own button; Special is a separate element). 56 px. |
| Hero help (summary “How to fight”) | native | FIXED D1. Hidden under touch (card in Menu replaces it). |

## God spellbook

| Control | Handler | Status |
|---|---|---|
| `data-spell` skeleton, raise, grove, starfall, sunder, wall, ring, golem, squad, crystal, lower, heal, lightning, frost, spring, blessing, quake, awaken, wildwake (19) | `chooseSpell` + roving tabindex + arrow keys (game phase only) | OK. Costs, keys and kbd glyphs contract-tested against `SPELLS` and game.js `spellKeys`. School colour stripe added. FIXED D12. Spring, Blessing and Quake (Y, U, I) show locked until Bloom 1, 2 and 3. |
| `#quickCast` checkbox | `game.setQuickCast` | FIXED D5. 44 px label hit area. |
| Cast help (summary “How to cast”) | native | OK (text clarified). |

## Menu dialog

| Control | Handler | Status |
|---|---|---|
| `#resumePlay` | `closeMenu()` | OK; receives focus on open. |
| menu role radios `name=menuRole` | `session.command('role')` | OK. Hint added: switching releases held controls — verified by reading: opening the menu calls `game.setActive(false)` → `clearInput()` (weapons.cancel, `castStart=null`, keys cleared); `game.setRole()` calls `clearInput()` again; touch `mobile.update()` → `reset()` on role change. |
| `#menuCopyCode`, `#menuCopyInvite` | `copy()` | OK. |
| `#menuControls` | `bindControlsCard('menu')` | NEW. Card moves inside `.menu-card`, so the existing focus trap and Esc-to-close cover it. |
| `#download` | Blob download | OK. |
| `#reset` → `#resetYes` / `#resetNo` | `session.resetWorld()` | OK; host-only via `refreshHostControls`. Confirm now `role="alertdialog"` with label. |
| `#techDetails` | `renderTech` | OK. |
| `#leave` | teardown → lobby | OK. |
| Backdrop click / Esc / Tab trap | lobby.js | OK. |

## Touch layer (mobile-ui.js / mobile-controls.js / touch-input.js)

| Control | Status |
|---|---|
| `touch:strike` Attack | OK. `pointerdown` → `primaryDown` with pointer capture; `pointerup` → `primaryUp`; `pointercancel` → `clearControls`; keyboard activation (`detail===0`) does down+up. Hold-to-draw bow and hold Wyrmspout flame work by this path. |
| `touch:jump` | OK. |
| `touch:cast` | OK. Line spells: first press sets start, second casts (game.js `castAt`). |
| `touch:cancel` | FIXED D4. |
| `touch:menu` | OK; resets controls before opening. |
| `touch:fullscreen` (+ settings copy) | OK — fails gracefully: hidden with explanatory note when unsupported (iPhone Safari), rejection caught → status text + toast, `fullscreenchange` resets sticks. |
| `touch:zoom-in`, `touch:zoom-out`, `touch:center` | OK (God only). |
| Left/right sticks | OK. Per-pointer ownership, capture, dead zone 0.12, reset on up/cancel/lost capture. |
| World drag / two-point pinch | OK. Max two canvas pointers; second finger marks both as moved (no accidental God aim tap); pinch zooms God only. |
| `#touchMode` select, `#touchSensitivity` range, `#touchLeftHanded` checkbox | OK. Persisted under `branns-forge.touch.*`. |
| RISK R1 | `window resize` → `reset()` releases sticks mid-drag. Desired on rotation; on mobile browsers whose toolbar collapses it could drop a held stick. Not patched: needs device evidence. |
| RISK R2 | Attack has no `lostpointercapture` handler; `update()`/`reset()` covers role/menu/XR changes, so only exotic capture loss could leave a held draw. Not patched without device evidence. |

## Keyboard / focus

- Typing in any INPUT/TEXTAREA/SELECT never moves the hero (window capture listener + game.js guard). OK.
- Toolbar buttons blur after click so Space/Enter don't re-trigger them. OK. Objective buttons also blur (NEW).
- `:focus-visible` ember double ring on every control (styles.css).
- Gap: no visible keyboard route to the canvas pointer-lock without a mouse — inherent to Pointer Lock; documented in the card (“Click world”).
