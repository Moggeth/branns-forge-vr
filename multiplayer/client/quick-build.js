// Brann's Forge — quick-build tray. Framework-free, no deps, self-contained qb-* classes.
// A compact 2x3 tray (one row of six on short landscape) of the six most-used builds plus Catalog.
// It never mutates game state and holds no runtime input state: tiles call onPlace(id) / onCatalog();
// the integrated root owns key bindings (B open, Shift+B bridge, T direct Timberline), placement and authority.

/** Fixed tray order. bridge is the existing bridge action, offered here as a tile. */
export const QUICK_BUILDS = [
  ['foundation', 'Foundation', 'stone'],
  ['timberline', 'Timberline', 'timberline'],
  ['storehouse', 'Storehouse', 'storehouse'],
  ['loggingYard', 'Logging Yard', 'axe'],
  ['sanctuary', 'Sanctuary', 'sanctuary'],
  ['bridge', 'Bridge', 'bridge'],
];
const RES_NAME = {wood: 'Wood', stone: 'Stone', iron: 'Iron', mithril: 'Mithril', crystal: 'Crystal', starMetal: 'Star metal',
  ironOre: 'Iron ore', mithrilOre: 'Mithril ore', starOre: 'Star ore', copper: 'Copper', gold: 'Gold', copperOre: 'Copper ore', goldOre: 'Gold ore', amber: 'Amber'};
const ALIAS = {star_metal: 'starMetal', starmetal: 'starMetal', stars: 'starMetal', gems: 'crystal', iron_ore: 'ironOre',
  mithril_ore: 'mithrilOre', star_ore: 'starOre', logging_yard: 'loggingYard', loggingyard: 'loggingYard'};
const canon = k => ALIAS[k] || k;
const has = v => v !== undefined && v !== null && v !== '';
const num = v => (Number.isFinite(+v) ? +v : 0);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  stone: '<path d="M4 18l2-7 5-4 6 1 3 6-2 5-8 1z"/>',
  timberline: `<path d="M3 19l18-6" ${S}/><ellipse cx="9" cy="13" rx="2.2" ry="3" ${S}/><path d="M9 10h8a2.2 3 0 010 6H9" ${S}/>`,
  storehouse: `<path d="M3 11l9-7 9 7v9H3z" ${S}/><path d="M9 20v-6h6v6M9 14l6 6M15 14l-6 6" ${S} stroke-width="1.2"/>`,
  axe: `<path d="M5 20L16 9" ${S} stroke-width="2"/><path d="M13 4c3 0 6 2 7 5l-4 4c-1-3-3-4-5-4z"/>`,
  sanctuary: `<path d="M4 20V10a8 8 0 0116 0v10" ${S}/><path d="M8 20v-8a4 4 0 018 0v8M3 20h18" ${S}/>`,
  bridge: `<path d="M2 10h20M2 10c4 0 6 4 10 4s6-4 10-4M5 10v8M19 10v8M12 14v4" ${S}/>`,
  scroll: `<path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H8a2 2 0 01-2-2z" ${S}/><path d="M9 9h7M9 12h7M9 15h5" ${S} stroke-width="1.2"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2.2"/>`,
};
const icon = (n, cls = 'qb-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">${ICON[n] || ICON.scroll}</svg>`;

/** Normalise {wood:3} | [{kind,amount}] | null to a plain map with canonical keys (same as the workshop panel). */
function bag(v) {
  const out = {};
  if (Array.isArray(v)) for (const e of v) { if (e && has(e.kind ?? e.type ?? e.id)) out[canon(e.kind ?? e.type ?? e.id)] = num(e.amount ?? e.count ?? e.n); }
  else if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n !== 'object') out[canon(k)] = num(n);
  return out;
}
const list = m => Object.entries(m).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${RES_NAME[k] || k}`).join(' · ');
let uidN = 0;

/**
 * createQuickBuild({parent, onPlace, onCatalog, onClose}) -> {show(recipes), hide(), visible(), dispose()}
 * recipes: [{id, name?, cost?, missing?, enabled?, reason?}] (the workshop panel's recipe shape), or
 *          {recipes, available?} where available is {kind: total accessible} used to derive shortfalls.
 * Missing recipe for a tile => tile shown disabled "Not offered here". Re-calling show() while open refreshes
 * affordability in place and keeps keyboard focus on the same tile.
 */
export function createQuickBuild({parent = document.body, onPlace = () => {}, onCatalog = () => {}, onClose = () => {}} = {}) {
  const doc = parent.ownerDocument || document, win = doc.defaultView || window, id = `qb${++uidN}`;
  const host = doc.createElement('div');
  host.className = 'qb-host'; host.hidden = true;
  host.innerHTML = `<section class="qb-tray" role="dialog" aria-modal="false" aria-labelledby="${id}-t">
      <header class="qb-head"><h2 class="qb-title" id="${id}-t">Quick build</h2>
        <span class="qb-hint" aria-hidden="true"><kbd>1</kbd>–<kbd>6</kbd> place · <kbd>C</kbd> catalog · <kbd>Esc</kbd></span>
        <button type="button" class="qb-x" data-qb-close aria-label="Close quick build (Esc)">${icon('close')}</button></header>
      <ul class="qb-grid" role="list"></ul>
      <p class="qb-live qb-sr" aria-live="polite"></p>
    </section>`;
  const tray = host.querySelector('.qb-tray'), grid = host.querySelector('.qb-grid'), live = host.querySelector('.qb-live');
  parent.appendChild(host);

  let shown = false, returnFocus = null, state = new Map(), lastHTML = '';

  function model(input) {
    const recipes = Array.isArray(input) ? input : Array.isArray(input?.recipes) ? input.recipes : [];
    const avail = input && !Array.isArray(input) && input.available ? bag(input.available) : null;
    const byId = new Map(recipes.filter(r => r && has(r.id)).map(r => [canon(String(r.id)), r]));
    return QUICK_BUILDS.map(([qid, label, ico], i) => {
      const r = byId.get(qid), cost = bag(r?.cost);
      let short = r && r.missing && typeof r.missing === 'object' ? bag(r.missing) : {};
      if (r && !r.missing && avail) for (const [k, n] of Object.entries(cost)) if (n > num(avail[k])) short[k] = n - num(avail[k]);
      short = Object.fromEntries(Object.entries(short).filter(([, n]) => n > 0));
      const shortTxt = list(short);
      const enabled = !!r && r.enabled !== false && (r.enabled === true || !shortTxt);
      const reason = !r ? 'Not offered here' : enabled ? '' : has(r.reason) ? String(r.reason) : shortTxt ? `Need ${shortTxt}` : 'Unavailable';
      return {qid, name: qid === 'foundation' ? label : r?.name || label, ico, n: i + 1, costTxt: list(cost), shortTxt, enabled, reason};
    });
  }

  function paint(tiles) {
    state = new Map(tiles.map(t => [t.qid, t]));
    const html = tiles.map(t => `<li><button type="button" class="qb-tile${t.enabled ? '' : ' qb-off'}" data-qb-place="${esc(t.qid)}"
        aria-disabled="${t.enabled ? 'false' : 'true'}" aria-keyshortcuts="${t.n}" aria-describedby="${id}-d-${t.n}">
        <span class="qb-n" aria-hidden="true">${t.n}</span>${icon(t.ico)}<span class="qb-name">${esc(t.name)}</span>
        <span class="qb-cost" id="${id}-d-${t.n}">${t.enabled ? esc(t.costTxt || 'Free') : `<span class="qb-miss">${esc(t.reason)}</span>`}${!t.enabled && t.costTxt ? `<span class="qb-sr">. Costs ${esc(t.costTxt)}</span>` : ''}</span>
      </button></li>`).join('') + `<li class="qb-cat-li"><button type="button" class="qb-tile qb-cat" data-qb-catalog aria-keyshortcuts="C">
        ${icon('scroll')}<span class="qb-name">Catalog</span><span class="qb-cost">All builds</span></button></li>`;
    if (html === lastHTML) return;
    const focused = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement.dataset.qbPlace || (doc.activeElement.hasAttribute('data-qb-catalog') ? '*' : '') : '';
    grid.innerHTML = html; lastHTML = html;
    if (focused) (focused === '*' ? grid.querySelector('[data-qb-catalog]') : grid.querySelector(`[data-qb-place="${focused}"]`))?.focus({preventScroll: true});
  }

  function close(reason) { if (!shown) return; hide(); onClose(reason); }
  function place(qid) {
    const t = state.get(qid);
    if (!t) return;
    if (!t.enabled) { live.textContent = `${t.name}: ${t.reason}`; return; } // disabled tiles explain, never act
    hide(); onPlace(qid);
  }
  function catalog() { hide(); onCatalog(); }

  const onClick = e => {
    const b = e.target.closest?.('button');
    if (!b || !host.contains(b)) return;
    if (b.hasAttribute('data-qb-close')) close('button');
    else if (b.hasAttribute('data-qb-catalog')) catalog();
    else if (b.dataset.qbPlace) place(b.dataset.qbPlace);
  };
  // Outside press closes and is consumed so dismissal cannot also swing/cast into the world.
  // The coordinator's own Build button carries data-qb-toggle so its click can toggle without a close/reopen race.
  const onOutside = e => { if (!tray.contains(e.target) && !e.target.closest?.('[data-qb-toggle]')) { e.preventDefault(); e.stopImmediatePropagation(); close('outside'); } };
  const onKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    const k = e.key, digit = /^Digit([1-6])$/.exec(e.code || '');
    if(e.repeat&&!k.startsWith('Arrow')){e.preventDefault();e.stopImmediatePropagation();return;}
    let used = true;
    if (k === 'Escape') close('escape');
    else if (k === 'b' || k === 'B') { if (e.shiftKey) used = false; else close('toggle'); } // B toggles; Shift+B stays the bridge
    else if (digit) place(QUICK_BUILDS[+digit[1] - 1][0]);
    else if (k === 'c' || k === 'C') catalog();
    else if (k.startsWith('Arrow') && host.contains(doc.activeElement)) move(k);
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  function move(k) {
    const btns = [...grid.querySelectorAll('button')], i = btns.indexOf(doc.activeElement);
    const cols = Math.max(1, Math.round(grid.clientWidth / Math.max(1, btns[0]?.offsetWidth || 1)));
    const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols}[k] || 0;
    btns[Math.min(btns.length - 1, Math.max(0, i + step))]?.focus();
  }

  function show(recipes) {
    paint(model(recipes));
    if (shown) return;
    shown = true; host.hidden = false; returnFocus = doc.activeElement;
    host.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey, true);
    // Defer arming the outside-press so the press that opened the tray (touch Build button) does not close it.
    win.requestAnimationFrame ? win.requestAnimationFrame(() => { if (shown) doc.addEventListener('pointerdown', onOutside, true); })
      : doc.addEventListener('pointerdown', onOutside, true);
    // Focus only for keyboard/desktop use: avoids a focus ring flash on touch. Pointer-locked games still get 1-6.
    if (!win.matchMedia?.('(pointer: coarse)').matches) (grid.querySelector('.qb-tile:not(.qb-off)') || grid.querySelector('button'))?.focus({preventScroll: true});
  }
  function hide() {
    if (!shown) return;
    shown = false; host.hidden = true; live.textContent = '';
    host.removeEventListener('click', onClick);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onOutside, true);
    const rf = returnFocus; returnFocus = null;
    if (rf && rf.isConnected && typeof rf.focus === 'function' && host.contains(doc.activeElement)) rf.focus({preventScroll: true});
  }
  return {
    show, hide,
    visible: () => shown,
    element: host,
    dispose() { hide(); host.remove(); state.clear(); lastHTML = ''; },
  };
}
