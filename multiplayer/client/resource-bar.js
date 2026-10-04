// Always-visible supplies strip: one small painted icon and a count per material (carried, plus stored when the
// side's stores hold some). Presentation only: it reads the snapshot and never changes state.
import {MATERIAL_CATALOG,materialLabel} from '../shared/material-catalog.js';

// Basics, then ores, then refined metals. Each ore sits in the same column order as the metal it smelts into.
export const RESOURCE_BAR_GROUPS = Object.freeze([
  Object.freeze(['wood', 'stone', 'gems']),
  Object.freeze(['ironOre', 'mithrilOre', 'starOre', 'copperOre', 'goldOre']),
  Object.freeze(['iron', 'mithril', 'starMetal', 'copper', 'gold']),
]);
export const RESOURCE_BAR_KEYS = Object.freeze(RESOURCE_BAR_GROUPS.flat());
/** Always shown on small touch screens even at zero; other materials appear there once you have some. */
export const RESOURCE_BAR_CORE = Object.freeze(['wood', 'stone', 'gems']);

const rgb = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const shade = (n, f) => '#' + rgb(n).map(c => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)).toString(16).padStart(2, '0')).join('');
const ORE_OF = {ironOre: 'iron', mithrilOre: 'mithril', starOre: 'starMetal', copperOre: 'copper', goldOre: 'gold'};

/** Inline SVG for one material: logs, stone, crystal, ore (rock with metal flecks) and cast bars. */
export function resourceIcon(key) {
  const c = MATERIAL_CATALOG[key]?.color ?? 0x999999;
  const hi = shade(c, .45), mid = shade(c, 0), lo = shade(c, -.38), ink = '#1a120b';
  let body;
  if (key === 'wood') body = `<path d="M6 7h12.5a3.5 5 0 010 10H6z" fill="${mid}" stroke="${ink}" stroke-width="1"/><path d="M7 9.2h10M7 14.8h9" stroke="${lo}" stroke-width="1" stroke-linecap="round"/>
    <ellipse cx="6" cy="12" rx="3.5" ry="5" fill="#e3b77c" stroke="${ink}" stroke-width="1"/><ellipse cx="6" cy="12" rx="2" ry="3" fill="none" stroke="#b07a42" stroke-width=".9"/><circle cx="6" cy="12" r=".8" fill="#8a5a2c"/>`;
  else if (key === 'stone') body = `<path d="M3.5 17.5l2-7 5.5-4.5 6.5 1.5 3 6.5-2.5 5-9 .5z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M11 6l1.2 5.6L5.5 10.5M12.2 11.6l7.8 1.9M12.2 11.6l-2.6 7.2" fill="none" stroke="${lo}" stroke-width=".9"/><path d="M11 6l6.5 1.5-5.3 4.1z" fill="${hi}" opacity=".85"/>`;
  else if (key === 'gems') body = `<path d="M12 2l4.5 6-4.5 14-4.5-14z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M12 2l-4.5 6h9z" fill="${hi}"/><path d="M12 8v14" stroke="${lo}" stroke-width=".8"/>
    <path d="M17.5 10l2.5 3-2.5 7-2.2-6.5z" fill="${lo}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/><path d="M6.5 11l-2.5 3 2.5 6 2-6z" fill="${lo}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/>`;
  else if (ORE_OF[key]) {
    const m = MATERIAL_CATALOG[ORE_OF[key]].color, mh = shade(m, .35), ml = shade(m, -.2);
    body = `<path d="M3.5 17l2.5-7.5 5-4 6.5 1.5 3 6-2.5 5.5-9 .5z" fill="#6f6a63" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M11 5.5l6.5 1.5-5 4z" fill="#8d877e"/>
      <path d="M8 11.5l2.2-1 1.2 2-1.8 1.6z" fill="${mh}" stroke="${ml}" stroke-width=".6"/><path d="M13.5 13.5l2.4-.6.6 2.2-2.2.9z" fill="${mh}" stroke="${ml}" stroke-width=".6"/><path d="M10.5 16l1.6-.3.3 1.5-1.6.4z" fill="${mh}"/>
      <path d="M17.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#fff6d8"/>`;
  } else {
    body = `<path d="M3 16.5h18l-2.4-6.5H5.4z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M5.4 10h13.2l1.4 3.8H4z" fill="${hi}"/>
      <path d="M3 16.5h18v2H3z" fill="${lo}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M7 11.4h6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7"/>`;
    if (key === 'starMetal') body += '<path d="M12 3l1 2.2 2.4.3-1.8 1.6.5 2.4L12 8.3 9.9 9.5l.5-2.4-1.8-1.6 2.4-.3z" fill="#fff1c2" stroke="#1a120b" stroke-width=".6"/>';
  }
  return `<svg class="rb-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const count = n => (n >= 1000 ? `${Math.floor(n / 100) / 10}k` : String(n));

export function createResourceBar(mount) {
  const root = document.createElement('div');
  root.className = 'res-bar'; root.id = 'resourceBar'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Supplies');
  root.innerHTML = RESOURCE_BAR_GROUPS.map(g => `<span class="rb-group">${g.map(k => `<span class="rb-item" data-res="${k}" data-zero="true"${RESOURCE_BAR_CORE.includes(k) ? ' data-core="true"' : ''}>${resourceIcon(k)}<b>0</b><i></i></span>`).join('')}</span>`).join('');
  mount.append(root);
  const items = Object.fromEntries([...root.querySelectorAll('[data-res]')].map(el => [el.dataset.res, {el, b: el.querySelector('b'), i: el.querySelector('i'), key: '', n: 0}]));
  function update(carried = {}, stored = {}) {
    for (const k of RESOURCE_BAR_KEYS) {
      const n = Math.max(0, carried?.[k] | 0), s = Math.max(0, stored?.[k] | 0), it = items[k], sig = n + '/' + s;
      if (it.key === sig) continue;
      if (it.key && n > it.n) { it.el.classList.remove('rb-gain'); void it.el.offsetWidth; it.el.classList.add('rb-gain'); }
      it.key = sig; it.n = n; it.b.textContent = count(n); it.i.textContent = s ? `+${count(s)}` : '';
      it.el.dataset.zero = String(!n && !s);
      const label = `${materialLabel(k)}: ${n} carried${s ? `, ${s} stored` : ''}`;
      it.el.title = label; it.el.setAttribute('aria-label', label);
    }
  }
  return {root, update, dispose: () => root.remove()};
}
