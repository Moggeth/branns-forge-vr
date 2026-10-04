// Brann's Forge — physical invention workshop panel. No framework, no deps. Self-contained ip-* classes.
// Three quiet tabs: Build (one-screen tile grid of 12), Stores (smelting, inventory, deposit), Built (use/repair/operate).
// The panel never mutates game state itself: buttons call onAction(action, detail) or onPlace(type);
// the integrated root owns world placement, aiming and authority.

/** All twelve structures. forge is permanent (never placed from here). */
export const STRUCTURES = [
  ['forge', 'Forge', 'Permanent heart of the settlement. Refines ore and powers inventions.', 'anvil'],
  ['foundation', 'Stone Foundation', 'Anchored tile resists earth magic. Build machines on top.', 'stone'],
  ['storehouse', 'Storehouse', 'Safe storage. Stored goods count toward every recipe.', 'storehouse'],
  ['loggingYard', 'Logging Yard', 'Gathers nearby fallen Wood into shared stores.', 'axe'],
  ['prospector', 'Prospector', 'Surveys seams and focuses new geological growth.', 'pick'],
  ['sanctuary', 'Sanctuary', 'Restores the wounded and steadies the ward line.', 'sanctuary'],
  ['barracks', 'Barracks', 'Houses defenders who answer raids.', 'helm'],
  ['timberline', 'Timberline', 'Paired bolts and cutting filament shear trees and bodies.', 'timberline'],
  ['watchtower', 'Watchtower', 'Climb the ramp to its elevated firing deck.', 'tower'],
  ['palisade', 'Palisade', 'Sharpened wall section that slows attackers.', 'palisade'],
  ['launcher', 'Launcher', 'Aimed siege arm. Hurls stone where you point it.', 'launcher'],
  ['ward', 'Ward', 'Crystal rune that shields structures inside its ring.', 'ward'],
  ['trap', 'Trap', 'Hidden jaws that spring on the first raider across.', 'trap'],
];
const STRUCT = Object.fromEntries(STRUCTURES.map(([id, name, purpose, ico]) => [id, { id, name, purpose, ico }]));
const OPERABLE = new Set(['timberline', 'launcher']);

/** Resources in display order, with purpose text shown on the Stores tab. */
export const RESOURCES = [
  ['wood', 'Wood', 'Frames, walls and timber ammunition', 'wood'],
  ['stone', 'Stone', 'Foundations, towers and launcher shot', 'stone'],
  ['iron', 'Iron', 'Hinges, blades, trap jaws', 'ingot'],
  ['mithril', 'Mithril', 'Light, strong fittings for advanced work', 'mithril'],
  ['crystal', 'Crystal', 'Wards, sanctuary focus, rune work', 'crystal'],
  ['starMetal', 'Star metal', 'Rarest alloy for master inventions', 'star'],
  ['copper', 'Copper', 'Wiring, bells and warm fittings for coming inventions', 'ingot'],
  ['gold', 'Gold', 'Inlay and enchanting foci for coming inventions', 'ingot'],
];
export const ORES = [
  ['ironOre', 'Iron ore', 'iron', 'Refine at the forge into Iron'],
  ['mithrilOre', 'Mithril ore', 'mithril', 'Refine at the forge into Mithril'],
  ['starOre', 'Star ore', 'starMetal', 'Refine at the forge into Star metal'],
  ['copperOre', 'Copper ore', 'copper', 'Refine at the forge into Copper'],
  ['goldOre', 'Gold ore', 'gold', 'Refine at the forge into Gold'],
];
const RES_NAME = Object.fromEntries([...RESOURCES.map(r => [r[0], r[1]]), ...ORES.map(o => [o[0], o[1]])]);
const RES_ICO = Object.fromEntries([...RESOURCES.map(r => [r[0], r[3]]), ...ORES.map(o => [o[0], 'ore'])]);
const ALIAS = { star_metal: 'starMetal', starmetal: 'starMetal', stars: 'starMetal', gems: 'crystal', iron_ore: 'ironOre', mithril_ore: 'mithrilOre', star_ore: 'starOre', copper_ore: 'copperOre', gold_ore: 'goldOre' };
const key = k => ALIAS[k] || k;

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  close: `<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2.2"/>`,
  anvil: '<path d="M3 7h14c0 2.5 2 4 4 4v2H15l-1 3h3v3H6v-3h3l-1-3c-3 0-5-2.5-5-6z"/>',
  wood: `<ellipse cx="7" cy="12" rx="3.2" ry="5" ${S}/><path d="M7 7h11c1.8 0 3.2 2.2 3.2 5s-1.4 5-3.2 5H7" ${S}/><circle cx="7" cy="12" r="1.2"/>`,
  stone: '<path d="M4 18l2-7 5-4 6 1 3 6-2 5-8 1z"/>',
  ingot: '<path d="M6 9h12l3 7H3z"/><path d="M8 9l1-2h6l1 2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  mithril: '<path d="M6 10h12l3 7H3z"/><path d="M12 2.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>',
  crystal: '<path d="M12 2l5 6-5 14-5-14z"/><path d="M7 8h10M12 2v20" fill="none" stroke="var(--ip-ink,#1a120b)" stroke-width="1"/>',
  star: '<path d="M4 13h16l2 6H2z"/><path d="M12 2l1.6 3.4 3.7.4-2.8 2.5.8 3.6L12 10l-3.3 1.9.8-3.6L6.7 5.8l3.7-.4z"/>',
  ore: '<path d="M4 17l2-7 5-4 6 1 3 6-2 5-8 1z"/><circle cx="10" cy="12" r="1.4" fill="var(--ip-ink,#1a120b)"/><circle cx="14.5" cy="14.5" r="1.1" fill="var(--ip-ink,#1a120b)"/><circle cx="13" cy="9.5" r=".9" fill="var(--ip-ink,#1a120b)"/>',
  storehouse: `<path d="M3 11l9-7 9 7v9H3z" ${S}/><path d="M9 20v-6h6v6M9 14l6 6M15 14l-6 6" ${S} stroke-width="1.2"/>`,
  axe: `<path d="M5 20L16 9" ${S} stroke-width="2"/><path d="M13 4c3 0 6 2 7 5l-4 4c-1-3-3-4-5-4z"/>`,
  pick: `<path d="M6 20L16 10" ${S} stroke-width="2"/><path d="M4 7c4-4 10-4 14 0l-2 1c-3-2-7-2-10 0z"/>`,
  sanctuary: `<path d="M4 20V10a8 8 0 0116 0v10" ${S}/><path d="M8 20v-8a4 4 0 018 0v8M3 20h18" ${S}/><path d="M12 5v3M10.5 6.5h3" ${S} stroke-width="1.2"/>`,
  helm: `<path d="M5 15a7 7 0 0114 0v4H5z" ${S}/><path d="M12 8v11M8 19v-3h8v3" ${S} stroke-width="1.3"/>`,
  timberline: `<path d="M3 19l18-6" ${S}/><ellipse cx="9" cy="13" rx="2.2" ry="3" ${S}/><path d="M9 10h8a2.2 3 0 010 6H9" ${S}/><path d="M18 6l2 2-2 2" ${S} stroke-width="1.3"/>`,
  tower: `<path d="M7 21l1-12h8l1 12M6 9h12V5h-2v2h-2V5h-4v2H8V5H6z" ${S}/><path d="M11 13h2v3h-2z"/>`,
  palisade: `<path d="M5 21V7l1.5-3L8 7v14M10.5 21V6L12 3l1.5 3v15M16 21V7l1.5-3L19 7v14M3 12h18M3 17h18" ${S} stroke-width="1.4"/>`,
  launcher: `<path d="M4 20h14M7 20l4-6 4 6M11 14L19 5" ${S}/><circle cx="19.5" cy="4.5" r="2"/><path d="M14 9l3 3" ${S} stroke-width="1.3"/>`,
  ward: `<circle cx="12" cy="12" r="8.5" ${S} stroke-width="1.3"/><path d="M12 5l2.5 7L12 19l-2.5-7z"/><path d="M5 12h3M16 12h3" ${S} stroke-width="1.3"/>`,
  trap: `<path d="M3 15h18M5 15l1.5-4 1.5 4 1.5-4 1.5 4 1.5-4 1.5 4 1.5-4 1.5 4 1.5-4 1.5 4" ${S} stroke-width="1.3"/><path d="M4 18h16" ${S}/>`,
  hammer: '<path d="M4 20l9-9 2 2-9 9z"/><path d="M11 5l4-2 6 6-2 4-3-3-2 2-3-3 2-2z"/>',
  wrench: `<path d="M14.5 4.5a4 4 0 00-4.8 5.3L4 15.5V20h4.5l5.7-5.7a4 4 0 005.3-4.8l-2.6 2.6-2.8-.6-.6-2.8z" ${S}/>`,
  hand: `<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6 7s-5-2-6.5-5L3 12.5a1.4 1.4 0 012.3-1.6L8 14" ${S} stroke-width="1.4"/>`,
  aim: `<circle cx="12" cy="12" r="7" ${S}/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" ${S}/><circle cx="12" cy="12" r="1.5"/>`,
  chest: `<path d="M3 10h18v10H3zM3 10a9 5 0 0118 0" ${S}/><path d="M12 3v8M9 8l3 3 3-3" ${S}/>`,
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 01-12 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-6 1-10z"/>',
  scroll: `<path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6" ${S}/><path d="M9 9h7M9 13h7M9 17h4" ${S} stroke-width="1.2"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="1.5" ${S}/><path d="M8 11V8a4 4 0 018 0v3" ${S}/>`,
};
const icon = (n, cls = 'ip-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${ICON[n] || ''}</svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = v => v !== undefined && v !== null && v !== '';
const num = v => (Number.isFinite(+v) ? +v : 0);
const RESERVED = new Set(['action', 'label', 'enabled', 'reason', 'cost', 'cooldown', 'detail']);
function legacyDetail(a) {
  if (a && typeof a.detail === 'object' && a.detail) return { ...a.detail };
  const out = {}; for (const [k, v] of Object.entries(a || {})) if (!RESERVED.has(k)) out[k] = v; return out;
}
/** Normalise {wood:3} | [{kind,amount}] | null to a plain map with canonical keys. */
function bag(v) {
  const out = {};
  if (Array.isArray(v)) for (const e of v) { if (e && has(e.kind ?? e.type ?? e.id)) out[key(e.kind ?? e.type ?? e.id)] = num(e.amount ?? e.count ?? e.n); }
  else if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n !== 'object') out[key(k)] = num(n);
  return out;
}
const fmtTime = s => (!has(s) ? '' : typeof s !== 'number' ? String(s) : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.ceil(s % 60)).padStart(2, '0')}s` : `${s >= 10 ? Math.ceil(s) : Math.max(0.1, s).toFixed(1)}s`);

/**
 * createInventionPanel({mount, onAction, onClose, onPlace}) → {show, update, hide, visible, dispose}
 * model: {title?, side?, resources (carried), stock (stored), available? (accessible total override),
 *   structures:[{id,type,name,hp,maxHp,phase,usable?,useLabel?,useReason?,repairCost?,repairEnabled?,repairReason?,cooldown?}],
 *   recipes:[{id,name,description,cost,missing?,enabled,reason?,limit?,count?}],
 *   jobs:[{kind,remaining,label?,structureId?,progress?}], refine?:{ironOre:{enabled,reason,yield}},
 *   canDeposit?, depositReason?, legacyActions?:[{action,label,enabled,reason,...detail}], tab?}
 */
export function createInventionPanel({ mount = document.body, onAction = () => {}, onClose = () => {}, onPlace = () => {} } = {}) {
  const id = `ip${++uidN}`;
  const host = document.createElement('div');
  host.className = 'ip-host'; host.hidden = true;
  host.innerHTML = `<div class="ip-scrim" data-ip-close></div>
    <section class="ip-panel" role="dialog" aria-modal="true" aria-labelledby="${id}-t" tabindex="-1">
      <header class="ip-head"><span class="ip-crest">${icon('hammer')}</span>
        <div class="ip-headtext"><h2 class="ip-title" id="${id}-t">Invention Workshop</h2><p class="ip-sub"></p></div>
        <button type="button" class="ip-x" data-ip-close data-ip-key="close" aria-label="Close workshop (Esc)" title="Close (Esc)">${icon('close')}</button></header>
      <nav class="ip-tabs" role="tablist" aria-label="Workshop sections"></nav>
      <div class="ip-purse" aria-label="Materials: carried and stored"></div>
      <div class="ip-body" role="tabpanel" id="${id}-p" tabindex="-1"></div>
      <p class="ip-live" aria-live="polite"></p>
    </section>`;
  const panel = host.querySelector('.ip-panel'), body = host.querySelector('.ip-body');
  const tabsEl = host.querySelector('.ip-tabs'), purseEl = host.querySelector('.ip-purse');
  const titleEl = host.querySelector('.ip-title'), subEl = host.querySelector('.ip-sub'), liveEl = host.querySelector('.ip-live');
  mount.append(host);

  let model = null, shown = false, returnFocus = null, tab = 'build', scrolls = {}, last = { tabs: '', purse: '', body: '' };
  let filter = 'all', pick = null, entries = [], lastDetail = '';
  // Freeze rerenders while a pointer is down inside the panel so the pointerup lands on the same node.
  let held = false, pending = false, thawT = 0;
  const freeze = () => { clearTimeout(thawT); held = true; };
  const thaw = () => { held = false; if (pending && shown) { pending = false; render(); } };
  const releaseSoon = () => { if (!held) return; clearTimeout(thawT); thawT = setTimeout(thaw, 120); };
  host.addEventListener('pointerdown', freeze);
  window.addEventListener('pointerup', releaseSoon);
  window.addEventListener('pointercancel', thaw);

  function derive(m) {
    const carried = bag(m.resources), stored = bag(m.stock), availOverride = m.available && typeof m.available === 'object' ? bag(m.available) : null;
    const avail = k => (availOverride && has(availOverride[k]) ? availOverride[k] : num(carried[k]) + num(stored[k]));
    return { carried, stored, avail };
  }

  function costRows(cost, missing, d) {
    const c = bag(cost), miss = missing && typeof missing === 'object' ? bag(missing) : null;
    return Object.entries(c).filter(([, n]) => n > 0).map(([k, need]) => {
      const have = d.avail(k), short = miss && has(miss[k]) ? miss[k] : Math.max(0, need - have);
      return { k, need, carried: num(d.carried[k]), stored: num(d.stored[k]), have, short };
    });
  }
  function costHTML(rows, label) {
    if (!rows.length) return '<p class="ip-free">No materials needed</p>';
    return `<ul class="ip-cost" aria-label="${esc(label)}">${rows.map(r => `<li class="ip-c${r.short > 0 ? ' ip-short' : ''}">
      <span class="ip-c-need">${icon(RES_ICO[r.k] || 'ore', 'ip-ico ip-r-' + r.k)}<b>${r.need}</b> ${esc(RES_NAME[r.k] || r.k)}</span>
      <span class="ip-c-have"><span title="Carried">${r.carried}</span><span class="ip-plus">+</span><span title="Stored">${r.stored}</span>
        <span class="ip-sr">carried plus stored</span>${r.short > 0 ? `<span class="ip-c-miss">need ${r.short} more</span>` : '<span class="ip-c-ok">ready</span>'}</span></li>`).join('')}</ul>`;
  }
  const btn = (k, attrs, inner, enabled, reason, cls = '') => {
    const why = !enabled && has(reason) ? `<span class="ip-why" id="${id}-w-${esc(k)}">${esc(reason)}</span>` : '';
    return `<button type="button" class="ip-btn ${cls}" data-ip-key="${esc(k)}" ${attrs} aria-disabled="${enabled ? 'false' : 'true'}"${why ? ` aria-describedby="${id}-w-${esc(k)}"` : ''}>${inner}</button>${why}`;
  };

  // Build: one screen of icon tiles (no scrolling). A ready tile places on press; hovering, focusing or
  // pressing any tile fills the details strip below the grid with its purpose, cost and what is missing.
  function buildEntries(m, d) {
    const recipes = Array.isArray(m.recipes) ? m.recipes : [];
    const byId = new Map(recipes.filter(r => r && has(r.id)).map(r => [key(String(r.id)), r]));
    const ids = [...STRUCTURES.map(s => s[0]), ...[...byId.keys()].filter(k => !STRUCT[k])].filter(k => k !== 'forge');
    const built = Array.isArray(m.structures) ? m.structures : [];
    return ids.map(sid => {
      const s = STRUCT[sid] || { id: sid, name: sid, purpose: '', ico: 'scroll' }, r = byId.get(sid);
      const name = r?.name || s.name, desc = r?.description || s.purpose;
      const rows = r ? costRows(r.cost, r.missing, d) : [], short = rows.filter(x => x.short > 0);
      const enabled = !!r && r.enabled !== false && (r.enabled === true || !short.length);
      const reason = !r ? 'Not offered at this workshop yet'
        : enabled ? '' : (has(r.reason) ? r.reason : short.length ? `Missing ${short.map(x => `${x.short} ${RES_NAME[x.k] || x.k}`).join(', ')}` : 'Unavailable right now');
      return { sid, ico: s.ico, name, desc, rows, enabled, reason, count: built.filter(b => key(String(b.type)) === sid).length, limit: r?.limit };
    });
  }
  function buildTab(m, d) {
    const all = buildEntries(m, d), ready = all.filter(e => e.enabled);
    if (filter === 'ready' && !ready.length) filter = 'all';
    const list = filter === 'ready' ? ready : all;
    entries = all;
    const jobs = (Array.isArray(m.jobs) ? m.jobs : []).filter(j => j && /build|construct|place/i.test(String(j.kind)));
    const out = [];
    if (jobs.length) out.push(`<ul class="ip-jobs" aria-label="Under construction">${jobs.map(j => `<li>${icon(STRUCT[key(j.type ?? j.structureType ?? '')]?.ico || 'hammer')}<span>${esc(j.label || j.name || STRUCT[key(j.type ?? '')]?.name || 'Building')}</span><b>${esc(fmtTime(j.remaining))}</b></li>`).join('')}</ul>`);
    const chip = (k, label, n) => `<button type="button" class="ip-chip" data-ip-filter="${k}" data-ip-key="filter-${k}" aria-pressed="${filter === k}">${label} <em>${n}</em></button>`;
    out.push(`<div class="ip-filters" role="group" aria-label="Show builds">${chip('all', 'All', all.length)}${chip('ready', 'Ready', ready.length)}
      <span class="ip-filters-hint">${ready.length ? 'Press a lit tile to place it' : 'Nothing ready yet: tiles show what each build needs'}</span></div>`);
    out.push(`<ul class="ip-bgrid" aria-label="Builds">${list.map(e => `<li><button type="button" class="ip-btn ip-tile${e.enabled ? ' ip-ready' : ''}" data-ip-key="place-${esc(e.sid)}" data-ip-place="${esc(e.sid)}" data-ip-pick="${esc(e.sid)}" aria-disabled="${e.enabled ? 'false' : 'true'}" aria-describedby="${id}-detail">
        ${icon(e.ico, 'ip-ico ip-big')}<span class="ip-tile-name">${esc(e.name)}</span>
        <span class="ip-tile-cost">${e.rows.map(r => `<span class="${r.short > 0 ? 'ip-short' : ''}">${icon(RES_ICO[r.k] || 'ore', 'ip-ico ip-r-' + r.k)}${r.need}</span>`).join('') || '<span>Free</span>'}</span>
        ${e.count ? `<span class="ip-tile-n" title="${e.count} built">${e.count}</span>` : ''}</button></li>`).join('')}</ul>`);
    out.push(`<div class="ip-detail" id="${id}-detail"></div>`);
    return out.join('');
  }
  function paintDetail() {
    const el = body.querySelector('.ip-detail'); if (!el || !entries.length) return;
    const shownIds = new Set([...body.querySelectorAll('[data-ip-pick]')].map(b => b.dataset.ipPick));
    const e = entries.find(x => x.sid === pick && shownIds.has(x.sid)) || entries.find(x => x.enabled && shownIds.has(x.sid)) || entries.find(x => shownIds.has(x.sid)) || entries[0];
    for (const b of body.querySelectorAll('[data-ip-pick]')) b.classList.toggle('ip-sel', b.dataset.ipPick === e.sid);
    const limit = has(e.limit) ? ` of ${esc(e.limit)}` : '';
    const html = `<span class="ip-detail-ico">${icon(e.ico, 'ip-ico ip-big')}</span>
      <div class="ip-detail-main"><h3>${esc(e.name)}${e.count || limit ? ` <span class="ip-count">${e.count}${limit} built</span>` : ''}</h3><p>${esc(e.desc)}</p>
        ${e.rows.length ? `<ul class="ip-dcost" aria-label="${esc(e.name)} cost">${e.rows.map(r => `<li class="${r.short > 0 ? 'ip-short' : ''}">${icon(RES_ICO[r.k] || 'ore', 'ip-ico ip-r-' + r.k)}<b>${r.need}</b> ${esc(RES_NAME[r.k] || r.k)}<small>${r.short > 0 ? `need ${r.short} more` : `have ${r.have}`}</small></li>`).join('')}</ul>` : '<p class="ip-free">No materials needed</p>'}
        ${e.enabled ? '' : `<p class="ip-dwhy">${esc(e.reason)}</p>`}</div>
      <button type="button" class="ip-btn ip-primary" data-ip-key="placesel" data-ip-placesel="${esc(e.sid)}" aria-disabled="${e.enabled ? 'false' : 'true'}">${icon('hammer')}<span>Place</span></button>`;
    if (html !== lastDetail) { el.innerHTML = html; lastDetail = html; }
  }
  function pickTile(sid) { if (sid && sid !== pick) { pick = sid; paintDetail(); } }

  function storesTab(m, d) {
    const out = [];
    const oreTotal = ORES.reduce((n, [k]) => n + d.avail(k), 0);
    const sm = m.smelt && typeof m.smelt === 'object' ? m.smelt : { ore: oreTotal, enabled: oreTotal > 0, reason: 'No ore carried or stored' };
    const rjobs = (Array.isArray(m.jobs) ? m.jobs : []).filter(j => j && /refin|smelt/i.test(String(j.kind)));
    const ores = ORES.filter(([k]) => d.avail(k) > 0);
    out.push(`<section class="ip-smelt" aria-label="Smelting"><div class="ip-smelt-head">${icon('flame', 'ip-ico ip-big')}<div><h3>Smelting</h3>
      <p>Ore smelts by itself while a hero stands at the Forge. Bars come out in the output bay, one stack per metal.</p></div></div>
      <div class="ip-orechips">${ores.length ? ores.map(([k, name]) => `<span class="ip-orechip">${icon('ore', 'ip-ico ip-r-' + k)}<b>${d.avail(k)}</b> ${esc(name)}</span>`).join('') : '<span class="ip-empty">No ore carried or stored. Mine ore seams with the pick.</span>'}</div>
      ${btn('smelt-all', 'data-ip-act="inventionSmeltAll"', `${icon('flame')}<span>Smelt all ore${num(sm.ore) ? ` (${num(sm.ore)})` : ''}</span>`, !!sm.enabled, sm.reason || 'Nothing to smelt', 'ip-primary ip-wide')}`);
    if (rjobs.length) out.push(`<ul class="ip-sjobs" aria-label="In the furnace">${rjobs.map(j => {
      const total = Math.max(1 / 60, (num(j.finishTick) - num(j.startedTick)) / 60), pct = Math.round(100 * Math.min(1, Math.max(0, 1 - num(j.remaining) / total)));
      const into = key(String(j.output ?? '')), n = num(j.amount) || 1;
      return `<li>${icon(RES_ICO[into] || 'ingot', 'ip-ico ip-r-' + into)}<span>${n} ${esc(RES_NAME[into] || into)}</span><i class="ip-sbar"><i style="width:${pct}%"></i></i><b>${esc(fmtTime(j.remaining))}</b></li>`;
    }).join('')}</ul>`);
    const bay = Array.isArray(m.bay) ? m.bay.filter(b => b && num(b.amount) > 0) : [];
    if (bay.length) out.push(`<div class="ip-bay"><span class="ip-bay-label">Output bay</span>${bay.map(b => `<span class="ip-orechip ip-barchip">${icon(RES_ICO[b.kind] || 'ingot', 'ip-ico ip-r-' + b.kind)}<b>${num(b.amount)}</b> ${esc(RES_NAME[b.kind] || b.kind)} bar${num(b.amount) === 1 ? '' : 's'}</span>`).join('')}
      ${btn('collect-bars', 'data-ip-act="inventionCollectOutput"', `${icon('chest')}<span>Collect all</span>`, true, '')}</div>`);
    out.push('</section>');
    const anyCarried = Object.values(d.carried).some(n => n > 0);
    const depEnabled = has(m.canDeposit) ? !!m.canDeposit : anyCarried;
    out.push(`<div class="ip-deposit">${btn('deposit', 'data-ip-act="inventionDeposit"', `${icon('chest')}<span>Deposit everything carried</span>`, depEnabled,
      m.depositReason || (anyCarried ? 'Storehouse unavailable' : 'You are not carrying anything'), 'ip-wide')}</div>`);
    out.push(`<table class="ip-inv"><caption class="ip-sr">Materials</caption><thead><tr><th scope="col">Material</th><th scope="col">Carried</th><th scope="col">Stored</th></tr></thead><tbody>`);
    for (const [k, name, purpose, ico] of RESOURCES) {
      out.push(`<tr><th scope="row">${icon(ico, 'ip-ico ip-r-' + k)}<span><b>${name}</b><small>${purpose}</small></span></th><td>${num(d.carried[k])}</td><td>${num(d.stored[k])}</td></tr>`);
    }
    out.push('</tbody></table>');
    const craft = Array.isArray(m.craft) ? m.craft : [];
    if (craft.length) {
      out.push(`<h3 class="ip-h3">${icon('flame')} Craft at the forge</h3><ul class="ip-refine">`);
      for (const r of craft) {
        const cost = Object.entries(r.input || {}).map(([k, n]) => `${num(n)} ${RES_NAME[k] || k}`).join(' + ');
        out.push(`<li class="ip-ore">${icon('aim', 'ip-ico')}<div class="ip-ore-main"><b>${esc(r.name)}</b>
        <small>${num(r.have)} on your rack · ${cost} makes ${num(r.output)}</small><small>Each Timberline shot uses one bolt before raw Wood and Iron.</small></div>
        ${btn(`craft-${esc(r.id)}`, `data-ip-act="inventionCraft" data-ip-recipe="${esc(r.id)}"`, `${icon('aim')}<span>Craft ${num(r.output)}</span>`, !!r.enabled, r.reason || 'Unavailable right now')}</li>`);
      }
      out.push('</ul>');
    }
    return out.join('');
  }

  function builtTab(m) {
    const built = Array.isArray(m.structures) ? m.structures : [];
    const jobs = Array.isArray(m.jobs) ? m.jobs : [];
    const out = [];
    if (!built.length) out.push('<p class="ip-empty">Nothing built yet. Place your first invention from Build.</p>');
    out.push('<ul class="ip-built">');
    for (const b of built) {
      if (!b || !has(b.id)) continue;
      const t = key(String(b.type ?? '')), s = STRUCT[t] || { name: t || 'Structure', ico: 'scroll' };
      const sid = String(b.id), max = num(b.maxHp), hp = Math.max(0, Math.min(max || num(b.hp), num(b.hp)));
      const pct = max > 0 ? Math.round((hp / max) * 100) : null;
      const job = jobs.find(j => j && String(j.structureId ?? '') === sid);
      const phase = String(b.phase ?? (job ? job.kind : '') ?? '');
      const building = /build|construct|placing|blueprint/i.test(phase);
      const destroyed = /destroy|ruin|wreck/i.test(phase) || (max > 0 && hp <= 0 && !building);
      const parts = [];
      if (OPERABLE.has(t)) {
        const ok = b.usable !== false && !building && !destroyed && !(num(b.cooldown)>0);
        parts.push(btn(`turn-${sid}`,`data-ip-turn="${esc(sid)}"`,`${icon('wrench')}<span>Turn 45°</span>`,ok,'Wait for loading / turning'));
        parts.push(btn(`op-${sid}`, `data-ip-operate="${esc(sid)}"`, `${icon('aim')}<span>${esc(b.useLabel || 'Aim & fire')}</span>`, ok,
          b.useReason || (building ? 'Still under construction' : destroyed ? 'Destroyed — repair first' : has(b.cooldown) ? `Reloading ${fmtTime(b.cooldown)}` : 'Not ready'), 'ip-primary'));
      } else if (!b.passive && (t !== 'palisade' && t !== 'trap' || b.usable)) {
        const ok = b.usable !== false && !building && !destroyed && !(num(b.cooldown) > 0);
        parts.push(btn(`use-${sid}`, `data-ip-use="${esc(sid)}"`, `${icon('hand')}<span>${esc(b.useLabel || 'Use')}</span>`, ok,
          b.useReason || (building ? 'Still under construction' : destroyed ? 'Destroyed — repair first' : num(b.cooldown) > 0 ? `Ready in ${fmtTime(b.cooldown)}` : 'Nothing to do here now'), 'ip-primary'));
      }
      if (max > 0 && hp < max && !building) {
        const rc = bag(b.repairCost), rcText = Object.entries(rc).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${RES_NAME[k] || k}`).join(' · ');
        const ok = b.repairEnabled !== false;
        parts.push(btn(`rep-${sid}`, `data-ip-repair="${esc(sid)}"`, `${icon('wrench')}<span>Repair${rcText ? ` <small>${esc(rcText)}</small>` : ''}</span>`, ok, b.repairReason || 'Cannot repair right now'));
      }
      out.push(`<li class="ip-bcard${destroyed ? ' ip-down' : ''}">${icon(s.ico, 'ip-ico ip-big')}<div class="ip-card-main">
        <h3>${esc(b.name || s.name)}${phase ? ` <span class="ip-phase">${esc(phase)}${job && has(job.remaining) ? ` · ${esc(fmtTime(job.remaining))}` : ''}</span>` : ''}</h3>
        ${pct != null ? `<div class="ip-hp" role="meter" aria-label="Integrity" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${hp}" aria-valuetext="${hp} of ${max}"><i style="width:${pct}%" class="${pct < 34 ? 'ip-lo' : pct < 67 ? 'ip-mid' : ''}"></i><span>${hp}/${max}</span></div>` : ''}
        ${parts.length ? `<div class="ip-row">${parts.join('')}</div>` : ''}</div></li>`);
    }
    out.push('</ul>');
    const legacy = Array.isArray(m.legacyActions) ? m.legacyActions.filter(a => a && a.action) : [];
    if (legacy.length) {
      out.push(`<h3 class="ip-h3">${icon('scroll')} Settlement orders</h3><div class="ip-legacy">`);
      legacy.forEach((a, i) => out.push(btn(`leg-${i}-${a.action}`, `data-ip-legacy="${i}"`, `<span>${esc(a.label || a.action)}</span>`, a.enabled !== false, a.reason || 'Unavailable')));
      out.push('</div>');
    }
    return out.join('');
  }

  function render() {
    if (!model || !shown) return;
    if (held) { pending = true; return; }
    const m = model, d = derive(m);
    titleEl.textContent = has(m.title) ? m.title : 'Invention Workshop';
    const built = Array.isArray(m.structures) ? m.structures.length : 0;
    const damaged = (m.structures || []).filter(b => b && num(b.maxHp) > 0 && num(b.hp) < num(b.maxHp)).length;
    subEl.textContent = [has(m.side) ? (typeof m.side === 'string' ? m.side[0].toUpperCase() + m.side.slice(1) : String(m.side)) : '', `${built} built`, damaged ? `${damaged} damaged` : ''].filter(Boolean).join(' · ');
    const ready = (m.recipes || []).filter(r => r && r.enabled).length;
    const oreN = ORES.reduce((n, [k]) => n + d.avail(k), 0);
    const T = [['build', 'Build', 'hammer', ready ? `${ready} ready` : ''], ['stores', 'Stores', 'chest', oreN ? `${oreN} ore` : ''], ['built', 'Built', 'tower', damaged ? `${damaged} hurt` : built ? String(built) : '']];
    const tabsHTML = T.map(([k, l, ico, badge]) => `<button type="button" role="tab" id="${id}-tab-${k}" class="ip-tab" data-ip-key="tab-${k}" data-ip-tab="${k}" aria-selected="${tab === k}" aria-controls="${id}-p" tabindex="${tab === k ? 0 : -1}">${icon(ico)}<span>${l}</span>${badge ? `<em>${esc(badge)}</em>` : ''}</button>`).join('');
    const purseHTML = RESOURCES.map(([k, name, , ico]) => `<span class="ip-p" title="${name}: ${num(d.carried[k])} carried, ${num(d.stored[k])} stored">${icon(ico, 'ip-ico ip-r-' + k)}<b>${num(d.carried[k])}</b><i>+${num(d.stored[k])}</i><span class="ip-sr">${name} carried plus stored</span></span>`).join('');
    const bodyHTML = tab === 'stores' ? storesTab(m, d) : tab === 'built' ? builtTab(m) : buildTab(m, d);

    const ae = document.activeElement, focusKey = host.contains(ae) ? ae?.dataset?.ipKey : null;
    if (tabsHTML !== last.tabs) { tabsEl.innerHTML = tabsHTML; last.tabs = tabsHTML; }
    if (purseHTML !== last.purse) { purseEl.innerHTML = purseHTML; last.purse = purseHTML; }
    body.setAttribute('aria-labelledby', `${id}-tab-${tab}`);
    if (bodyHTML !== last.body) {
      const st = body.scrollTop; body.innerHTML = bodyHTML; last.body = bodyHTML; body.scrollTop = st; lastDetail = '';
    }
    if (tab === 'build') paintDetail();
    if (focusKey && document.activeElement !== ae) {
      const el = panel.querySelector(`[data-ip-key="${CSS.escape(focusKey)}"]`);
      (el || body).focus({ preventScroll: true });
    }
  }

  function setTab(k, focus) {
    if (!['build', 'stores', 'built'].includes(k) || k === tab) return;
    // The tab click has already landed, so render immediately instead of waiting for the pointer thaw.
    clearTimeout(thawT); held = false; pending = false;
    scrolls[tab] = body.scrollTop; tab = k; last.body = ''; render(); body.scrollTop = scrolls[k] || 0;
    if (focus) tabsEl.querySelector(`[data-ip-tab="${k}"]`)?.focus({ preventScroll: true });
  }
  const say = t => { liveEl.textContent = ''; requestAnimationFrame(() => { liveEl.textContent = t; }); };
  function nudge(el) { el.classList.remove('ip-shake'); void el.offsetWidth; el.classList.add('ip-shake'); const w = el.getAttribute('aria-describedby'); if (w) say(document.getElementById(w)?.textContent || ''); }

  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-ip-close]')) { e.preventDefault(); close(); return; }
    const tb = t.closest('[data-ip-tab]'); if (tb) { setTab(tb.dataset.ipTab, true); return; }
    const fb = t.closest('[data-ip-filter]'); if (fb) { filter = fb.dataset.ipFilter; last.body = ''; render(); return; }
    const b = t.closest('button.ip-btn'); if (!b) return;
    if (b.dataset.ipPick) pickTile(b.dataset.ipPick);
    if (b.getAttribute('aria-disabled') === 'true') { nudge(b); return; }
    const ds = b.dataset;
    if (ds.ipPlacesel) { onPlace(ds.ipPlacesel); return; }
    if (ds.ipPlace) { onPlace(ds.ipPlace); return; }
    if (ds.ipOperate) { onPlace(`operate:${ds.ipOperate}`); return; }
    if (ds.ipTurn) { onAction('inventionTurn', { structureId: realId(ds.ipTurn) }); return; }
    if (ds.ipUse) { onAction('inventionUse', { structureId: realId(ds.ipUse) }); return; }
    if (ds.ipRepair) { onAction('inventionRepair', { structureId: realId(ds.ipRepair) }); return; }
    if (ds.ipAct === 'inventionDeposit') { onAction('inventionDeposit', {}); return; }
    if (ds.ipAct === 'inventionSmeltAll' || ds.ipAct === 'inventionCollectOutput') { onAction(ds.ipAct, {}); return; }
    if (ds.ipAct === 'inventionRefine') { onAction('inventionRefine', { kind: ds.ipKind, amount: 1 }); return; }
    if (ds.ipAct === 'inventionCraft') { onAction('inventionCraft', { recipe: ds.ipRecipe }); return; }
    if (has(ds.ipLegacy)) { const a = model?.legacyActions?.[+ds.ipLegacy]; if (a) onAction(a.action, legacyDetail(a)); }
  }
  const realId = s => { const b = (model?.structures || []).find(x => String(x?.id) === s); return b ? b.id : s; };

  function focusables() {
    return [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null);
  }
  function onKey(e) {
    if (!shown) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) { e.preventDefault(); return; }
      const first = f[0], lastEl = f[f.length - 1], a = document.activeElement;
      if (!panel.contains(a)) { e.preventDefault(); (e.shiftKey ? lastEl : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && a === lastEl) { e.preventDefault(); first.focus(); }
      e.stopPropagation(); return;
    }
    if (panel.contains(document.activeElement)) {
      const tb = document.activeElement.closest?.('[data-ip-tab]');
      if (tb && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        const order = ['build', 'stores', 'built'], i = order.indexOf(tb.dataset.ipTab);
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (/Left|Up/.test(e.key) ? 2 : 1)) % 3;
        setTab(order[n], true); e.preventDefault();
      }
      e.stopPropagation(); // keep game hotkeys out while the workshop has focus
    }
  }
  const onHover = e => pickTile(e.target.closest?.('[data-ip-pick]')?.dataset.ipPick);
  host.addEventListener('click', onClick);
  host.addEventListener('pointerover', onHover);
  host.addEventListener('focusin', onHover);
  document.addEventListener('keydown', onKey, true);

  function show(next) {
    if (next) model = next;
    if (model && has(model.tab) && !shown) tab = ['build', 'stores', 'built'].includes(model.tab) ? model.tab : tab;
    if (!shown) { returnFocus = document.activeElement; shown = true; host.hidden = false; host.classList.add('ip-open'); last = { tabs: '', purse: '', body: '' }; }
    render();
    requestAnimationFrame(() => { if (shown && !panel.contains(document.activeElement)) (tabsEl.querySelector('[aria-selected="true"]') || panel).focus({ preventScroll: true }); });
  }
  function update(next) { if (next) model = next; if (shown) render(); }
  function hide() {
    if (!shown) return; shown = false; clearTimeout(thawT); held = false; pending = false;
    host.classList.remove('ip-open'); host.hidden = true;
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function close() { hide(); onClose(); }
  function dispose() {
    hide(); host.removeEventListener('pointerdown', freeze); window.removeEventListener('pointerup', releaseSoon); window.removeEventListener('pointercancel', thaw);
    host.removeEventListener('click', onClick); host.removeEventListener('pointerover', onHover); host.removeEventListener('focusin', onHover); document.removeEventListener('keydown', onKey, true); host.remove(); model = null;
  }
  return { show, update, hide, dispose, visible: () => shown, get isOpen() { return shown; }, setTab: k => setTab(k, false) };
}
let uidN = 0;
