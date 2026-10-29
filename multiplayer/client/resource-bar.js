// Always-visible supplies strip. Three big primary chips (Timber, Iron, Crystal) that always show, each with
// its name, the count you carry and what waits in your stores; then a small row of extras that appears only
// while you hold some. Presentation only: it reads the snapshot and never changes state.
import {MATERIAL_CATALOG,MATERIAL_KEYS,PRIMARY_MATERIALS,EXTRA_MATERIALS,ORE_RECIPES,bankKey,materialLabel} from '../shared/material-catalog.js';

export const RESOURCE_BAR_GROUPS = Object.freeze([PRIMARY_MATERIALS, EXTRA_MATERIALS]);
export const RESOURCE_BAR_KEYS = Object.freeze(RESOURCE_BAR_GROUPS.flat());
/** Always shown, at zero too: the three materials every build is made from. */
export const RESOURCE_BAR_CORE = PRIMARY_MATERIALS;
/** Ore is never banked (it banks as metal), so it has no slot; a stray ore count still adds to its metal. */
const ORE_KEYS = MATERIAL_KEYS.filter(k => Object.hasOwn(ORE_RECIPES, k));

const rgb = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const shade = (n, f) => '#' + rgb(n).map(c => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)).toString(16).padStart(2, '0')).join('');
const ORE_OF = {ironOre: 'iron', mithrilOre: 'mithril', starOre: 'starMetal', copperOre: 'copper', goldOre: 'gold'};

/** Inline SVG for one material: logs, stone, crystal, ore (rock with metal flecks) and cast bars. */
export function resourceIcon(key) {
  const c = MATERIAL_CATALOG[key]?.color ?? 0x999999;
  const hi = shade(c, .45), mid = shade(c, 0), lo = shade(c, -.38), ink = '#1a120b';
  let body;
  if (key === 'wood') body = `<path d="M7.5 4.5h10a3 4 0 010 8h-10z" fill="${lo}" stroke="${ink}" stroke-width="1"/><ellipse cx="7.5" cy="8.5" rx="3" ry="4" fill="#d9a96c" stroke="${ink}" stroke-width="1"/><ellipse cx="7.5" cy="8.5" rx="1.6" ry="2.2" fill="none" stroke="#a46f3a" stroke-width=".8"/>
    <path d="M6 11h12.5a3.5 4.6 0 010 9.2H6z" fill="${mid}" stroke="${ink}" stroke-width="1"/><path d="M7 13.4h9.5M7 17.8h8.5" stroke="${lo}" stroke-width="1" stroke-linecap="round"/>
    <ellipse cx="6" cy="15.6" rx="3.5" ry="4.6" fill="#e3b77c" stroke="${ink}" stroke-width="1"/><ellipse cx="6" cy="15.6" rx="2" ry="2.8" fill="none" stroke="#b07a42" stroke-width=".9"/><circle cx="6" cy="15.6" r=".8" fill="#8a5a2c"/>
    <path d="M13.2 4.6c.9 2.4.9 13.5 0 15.6" fill="none" stroke="#6b8f3a" stroke-width="1.4" stroke-linecap="round"/>`;
  else if (key === 'stone') body = `<path d="M3.5 17.5l2-7 5.5-4.5 6.5 1.5 3 6.5-2.5 5-9 .5z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M11 6l1.2 5.6L5.5 10.5M12.2 11.6l7.8 1.9M12.2 11.6l-2.6 7.2" fill="none" stroke="${lo}" stroke-width=".9"/><path d="M11 6l6.5 1.5-5.3 4.1z" fill="${hi}" opacity=".85"/>`;
  else if (key === 'gems') body = `<path d="M12 2l4.5 6-4.5 14-4.5-14z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M12 2l-4.5 6h9z" fill="${hi}"/><path d="M12 8v14" stroke="${lo}" stroke-width=".8"/>
    <path d="M17.5 10l2.5 3-2.5 7-2.2-6.5z" fill="${lo}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/><path d="M6.5 11l-2.5 3 2.5 6 2-6z" fill="${lo}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/>`;
  else if (ORE_OF[key]) {
    const m = MATERIAL_CATALOG[ORE_OF[key]].color, mh = shade(m, .35), ml = shade(m, -.2);
    body = `<path d="M3.5 17l2.5-7.5 5-4 6.5 1.5 3 6-2.5 5.5-9 .5z" fill="#6f6a63" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M11 5.5l6.5 1.5-5 4z" fill="#8d877e"/>
      <path d="M8 11.5l2.2-1 1.2 2-1.8 1.6z" fill="${mh}" stroke="${ml}" stroke-width=".6"/><path d="M13.5 13.5l2.4-.6.6 2.2-2.2.9z" fill="${mh}" stroke="${ml}" stroke-width=".6"/><path d="M10.5 16l1.6-.3.3 1.5-1.6.4z" fill="${mh}"/>
      <path d="M17.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#fff6d8"/>`;
  } else if (key === 'iron') {
    // Two stacked iron bars with a cool steel sheen: reads as Iron at a glance, not just "a bar".
    body = `<path d="M2.5 19.5h13l-1.8-5H4.3z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M4.3 14.5h9.4l.9 2.4H3.4z" fill="${hi}"/>
      <path d="M8.5 13.5h13l-1.8-5h-9.4z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M10.3 8.5h9.4l.9 2.4H9.4z" fill="${hi}"/>
      <path d="M11.5 9.6h5M5.5 15.6h5" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".75"/><path d="M8.5 13.5h13v1.2h-13zM2.5 19.5h13v1.2h-13z" fill="${lo}"/>`;
  } else {
    body = `<path d="M3 16.5h18l-2.4-6.5H5.4z" fill="${mid}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M5.4 10h13.2l1.4 3.8H4z" fill="${hi}"/>
      <path d="M3 16.5h18v2H3z" fill="${lo}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/><path d="M7 11.4h6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7"/>`;
    if (key === 'starMetal') body += '<path d="M12 3l1 2.2 2.4.3-1.8 1.6.5 2.4L12 8.3 9.9 9.5l.5-2.4-1.8-1.6 2.4-.3z" fill="#fff1c2" stroke="#1a120b" stroke-width=".6"/>';
  }
  return `<svg class="rb-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const count = n => (n >= 1000 ? `${Math.floor(n / 100) / 10}k` : String(n));
const SHORT = Object.freeze({wood: 'Timber', iron: 'Iron', gems: 'Crystal'});

export function createResourceBar(mount) {
  const root = document.createElement('div');
  root.className = 'res-bar'; root.id = 'resourceBar'; root.setAttribute('role', 'status'); root.setAttribute('aria-label', 'Supplies');
  const chip = (k, primary) => primary
    ? `<span class="rb-item rb-primary" data-res="${k}" data-zero="true" data-core="true" style="--rb-tint:${'#' + (MATERIAL_CATALOG[k].color).toString(16).padStart(6, '0')}">${resourceIcon(k)}<span class="rb-txt"><b>0</b><small>${SHORT[k]}<i></i></small></span></span>`
    : `<span class="rb-item rb-extra" data-res="${k}" data-zero="true">${resourceIcon(k)}<b>0</b><i></i></span>`;
  root.innerHTML = `<span class="rb-group rb-main">${PRIMARY_MATERIALS.map(k => chip(k, true)).join('')}</span>`
    + `<span class="rb-group rb-extras" data-empty="true"><span class="rb-extras-label">Extras</span>${EXTRA_MATERIALS.map(k => chip(k, false)).join('')}</span>`;
  mount.append(root);
  const extras = root.querySelector('.rb-extras');
  const items = Object.fromEntries([...root.querySelectorAll('[data-res]')].map(el => [el.dataset.res, {el, b: el.querySelector('b'), i: el.querySelector('i'), key: '', n: 0}]));
  function update(carried = {}, stored = {}) {
    const total = (bag, k) => Math.max(0, bag?.[k] | 0) + ORE_KEYS.reduce((n, o) => n + (bankKey(o) === k ? Math.max(0, bag?.[o] | 0) : 0), 0);
    let anyExtra = false;
    for (const k of RESOURCE_BAR_KEYS) {
      const n = total(carried, k), s = total(stored, k), it = items[k], sig = n + '/' + s;
      if (!PRIMARY_MATERIALS.includes(k) && (n || s)) anyExtra = true;
      if (it.key === sig) continue;
      if (it.key && n > it.n) { it.el.classList.remove('rb-gain'); void it.el.offsetWidth; it.el.classList.add('rb-gain'); }
      it.key = sig; it.n = n; it.b.textContent = count(n); it.i.textContent = s ? `+${count(s)}` : '';
      it.el.dataset.zero = String(!n && !s);
      const label = `${materialLabel(k)}: ${n} carried${s ? `, ${s} in your stores` : ''}`;
      it.el.title = label; it.el.setAttribute('aria-label', label);
    }
    if (extras.dataset.empty !== String(!anyExtra)) extras.dataset.empty = String(!anyExtra);
  }
  return {root, update, dispose: () => root.remove()};
}
