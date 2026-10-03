# Field Guide (F1) / Party (Tab) hold overlays — handoff

Commission: Opus 5.5, 2026-10-03, ~10:13–10:21 local. Everything lives under this commission's `output/`. I did not edit any root or reference file. Nothing was published, committed or sent to an API.

## Files
| File | Purpose |
|---|---|
| `field-overlays.js` | ES module. `createFieldOverlays({ mount, onAction })` and `createBuildTag({ mount, text })`. Plain DOM; no dependencies. |
| `field-overlays.css` | All selectors use the `.fo-` prefix. Reads the existing `--brass`, `--bf-ember`, `--bf-parch`, `--serif` and related tokens, with fallbacks if they are missing. Load it **after** `styles.css`. It does not touch lobby rules. |
| `test.html` | In-browser self-test with 28 assertions. |
| `demo.html` | Design demo using **sample layout data only**. Query params: `kind=help|party`, `input=desktop|touch|vr`, `pinned`, `long`, `tool=`, `name=`, `art=`. |
| `serve.cjs`, `capture.cjs` | Read-only static server on 127.0.0.1:8799, plus a CDP driver (headless Edge on port 9333). The driver runs the tests and writes screenshots and metrics. |
| `shots/` | Final captures. `shots-stage1-before-fixes/` holds the first design stage, which had a clipped "Contrib." header, a horizontal scrollbar at 390 px, entry buttons overlapping the open panel and a weak "?" icon. |
| `capture-log.txt` | The last run's test output and layout metrics. |

## API
```js
import { createFieldOverlays, createBuildTag } from './field-overlays.js';
const fo = createFieldOverlays({ mount: document.body, onAction });
fo.show('help' | 'party', model, { pinned: false }); // hold mode (default) or pinned/modal
fo.update(model);   // re-renders if visible; always caches the model for the touch entry buttons
fo.hide();          // release / blur / cancel
fo.dispose();
fo.visible          // 'help' | 'party' | null
fo.pinned           // boolean
fo.root, fo.entry   // DOM nodes; set fo.entry.hidden = true to suppress the touch entry
const tag = createBuildTag({ text: `dev · ${BUILD_SHA}` }); tag.set(...); tag.dispose();
```
`onAction({ id, kind, source })` fires with these ids:
- `'current-quest'`, `'start-expedition'`, `'menu'` from the party icon bar (`source: 'bar'`).
- `quest.action`, whatever string the root supplied (`source: 'quest'`).
- `'open'` when a touch entry button opens a pinned overlay. Use this to exit pointer lock or pause touch look.
- `'close'` when the user closes a pinned overlay (Close button, Esc or a scrim tap).

`hide()` called by the root does **not** emit `close`.

### Model (everything is optional; missing values are never invented)
```js
{
  tool: 'axe',                 // also selects the fallback sprite #bfi-<tool> when it exists in the page
  role: 'hero' | 'god',        // uses #i-hero / #i-god sprite if present
  inputMode: 'desktop' | 'touch' | 'vr',
  name: 'Axe',                 // equipment display name
  art: 'url',                  // optional thumbnail; on error → sprite → monogram
  help: {
    title: 'Field guide',      // eyebrow text
    basic:   'text' | { label, binding, detail },
    special: 'text' | { label, binding, detail },
    cooldown: 6 | '6 s',       // number → "Cooldown 6 s"
    interactions: [{ label, binding }],
  },
  players: [{ id, name, role, kills, deaths, contribution, isSelf }], // rendered in the order given
  quest: { title, summary, progress, actionLabel, action },
  disabledActions: ['start-expedition'], // optional extension: greys out bar actions
}
```
`binding` can be any of these: `'Q'`, `['Q', 'RMB']` (rendered as alternatives with a "/"), or `{ desktop, touch, vr }`. The object form is resolved by `inputMode`, so the root can supply one per-tool table for all modes. `progress` can be a number 0..1 (bar plus %), `{ value, max, label? }` (bar plus "3 / 5") or a string (text only). A `null` or `undefined` metric renders as "—".

## Behaviour contract (root owns keys and pointer lock)
- **Hold mode** (`pinned: false`) never moves focus, so the root keeps receiving keyup.
  - Help: the panel ignores pointer events, and the HUD scrim is lighter.
  - Party: the panel takes pointer events, so the freed mouse can click its buttons. If a button kept focus, `hide()` restores focus to the element that had it before `show()`.
- **Pinned mode** (touch entry, or the root calling `show(kind, m, { pinned: true })`) uses `aria-modal="true"` and focuses Close. Tab cycles inside the panel; Esc or a scrim tap closes it. On close, focus returns to the element that was focused before.
- Touch entry buttons (help "?" and party) sit fixed at top-right and show only when `body.touch-controls-active` is set, which is the existing class, or when `fo.entry` has a `data-force` attribute. They hide while any overlay is open.
- The footer hint is mode-aware: "Release F1 to close", "Release Tab to return", or "Tap outside or Close".
- All strings are set with `textContent`. The self-test checks this by passing an `<img onerror>` name.

## Exact integration note (root)
```js
// after the HUD exists:
import { createFieldOverlays, createBuildTag } from './field-overlays.js';
// <link rel="stylesheet" href="field-overlays.css"> after styles.css
const fo = createFieldOverlays({ mount: document.body, onAction: (a) => {
  if (a.id === 'open') document.exitPointerLock?.();
  else if (a.id === 'menu') openMenu();
  else if (a.id === 'start-expedition') startExpedition();
  else if (a.id === 'current-quest') focusQuest();
  else if (a.source === 'quest') runQuestAction(a.id);
}});
createBuildTag({ text: `dev · ${BUILD_SHA}` });

const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');
addEventListener('keydown', (e) => {
  if (typing(e)) return;                                   // never hijack Tab/F1 while typing
  if (e.repeat) { if (e.key === 'F1' || e.key === 'Tab') e.preventDefault(); return; }
  if (e.key === 'F1') { e.preventDefault(); fo.show('help', buildFieldModel()); }
  else if (e.key === 'Tab' && !fo.pinned) { e.preventDefault(); document.exitPointerLock?.(); fo.show('party', buildFieldModel()); }
});
addEventListener('keyup', (e) => {
  if (e.key === 'F1' && fo.visible === 'help' && !fo.pinned) fo.hide();
  if (e.key === 'Tab' && fo.visible === 'party' && !fo.pinned) { fo.hide(); /* re-request pointer lock on next canvas click, per existing rule */ }
});
addEventListener('blur', () => { if (!fo.pinned) fo.hide(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !fo.pinned) fo.hide(); });
// whenever equipment, party metrics or quest change: fo.update(buildFieldModel());
```
`buildFieldModel()` belongs to the root. Use the real per-tool text and bindings for all 8 tools (axe, pick, hammer, crossbow, bow, limb, wyrmspout, flask) and the server-authoritative player and quest metrics. The module contains **no** ability text or scores.

## Tests actually performed
- `test.html` in headless Edge 154 via CDP: **ALL PASS 28/28** (log in `capture-log.txt`). It covers hidden start; hold mode not stealing focus; textContent safety; mode-specific and array bindings; skipping blank interactions; cooldown; art fallback; update re-render; "—" for missing metrics; self row; disabled actions; action emission; progress aria; hide; pinned entry and modal; focus on Close; Esc close; focus restore; open/close events; throwing on an unknown kind; build tag; and dispose cleanup.
- Layout metrics from the final run, measured in the browser:
  - At **390×650**, **844×340** and **1280×720**, every panel fits the viewport.
  - `.fo-body` scrolls neither vertically nor horizontally, and no table header is clipped.
  - The only truncation is the deliberately long player name, which gets an ellipsis and a `title`.
- I looked at the screenshots myself: help desktop, party desktop, help touch 390, party 390 with a long name, help/party 844×340, help in VR binding mode (bow sprite), and the touch entry buttons.

## Limitations (exact)
- **Not tested inside the real game page.** The tests did not use the actual HUD, pointer lock, real keyboard F1/Tab, Three.js canvas, iOS/Android devices or real safe-area insets. The screenshots use a gradient background, not a game render.
- **VR:** this is a DOM overlay. It cannot appear inside an immersive WebXR session. `inputMode: 'vr'` only selects VR binding labels, for a desktop mirror or the existing VR panel to reuse. A VR in-headset version would need to go through `vr-adventure-panel.js`.
- The top-right touch entry buttons may collide with existing HUD elements in the real layout. Root should check this and move `.fo-entry` if needed.
- Demo text and numbers are placeholders for layout only, paraphrased from the existing `bf-help-list`. Do not ship them.
- No `art` thumbnail images exist in the references (only GLBs), so captures show the sprite/monogram fallback. Root needs to supply rendered thumbnails if wanted.
- With very long party lists (more than about 6 rows at 844×340), `.fo-body` scrolls vertically. This is intended but untested.
- Budget: about 17 KB JS and 15 KB CSS unminified. No network, fonts or images. A full re-render (`replaceChildren`) happens only on `show`/`update`, not per frame. Throttle `update` calls to metric changes.

## Re-run
```
node output/serve.cjs 8799
msedge --headless=new --disable-gpu --user-data-dir=%TEMP%\fo-edge-cdp --remote-debugging-port=9333 about:blank
node output/capture.cjs
```
Stop only those two processes afterwards. The Edge instances can be identified by the `fo-edge-cdp` profile in their command line.
