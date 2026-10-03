// Brann's Forge — readable spellbook pager (no framework, no deps).
// Augments the existing #godHelp .bf-spells buttons IN PLACE: the same <button data-spell>
// elements, attributes and root listeners survive, so init may run before or after
// lobby.js binds them. Cooldown/mana state is rendered only from update() input.
const TICK_HZ = 60;
const NS = 'http://www.w3.org/2000/svg';

// Custom 24x24 silhouettes. Each reads as a distinct shape at 26px on charcoal.
const SKULL = 'M12 2C7 2 4 5.5 4 10c0 2.6 1.2 4.4 3 5.5V19h2v2h2v-2h2v2h2v-2h2v-3.5c1.8-1.1 3-2.9 3-5.5 0-4.5-3-8-8-8zM6.8 10.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM13.2 10.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM12 13l-1.3 2.4h2.6z';
const PINE = 'M12 .8l2.6 4.2h-1.6V6.6h-2V5H9.4z';
export const SPELL_ICONS = Object.freeze({
  skeleton: `<path fill-rule="evenodd" d="${SKULL}"/>`,
  squad: `<g fill-rule="evenodd" stroke="var(--sb-icon-ink,#1a140f)" stroke-width="1.6" paint-order="stroke">`
    + `<path transform="translate(-1.2 5) scale(.62)" d="${SKULL}"/><path transform="translate(10.3 5) scale(.62)" d="${SKULL}"/>`
    + `<path transform="translate(3.6 .4) scale(.7)" d="${SKULL}"/></g>`,
  golem: '<path fill-rule="evenodd" d="M8 2h8v5h3l2.5 6.5h-3.2L17 10v4l2 8h-4.2l-1.3-5h-3l-1.3 5H5l2-8v-4l-1.3 3.5H2.5L5 7h3zM9.8 3.8v1.8h1.6V3.8zM12.6 3.8v1.8h1.6V3.8z"/>',
  raise: '<path d="M1.5 22l6.5-9.5 3.2 4.2 4.3-7.2L22.5 22z"/><path d="M12 1l4.5 4.6h-2.7v3.2h-3.6V5.6H7.5z"/>',
  lower: '<path d="M1.5 15h6.2l2.2 4.2h4.2l2.2-4.2h6.2V22h-21z"/><path d="M10.2 1.5h3.6v4.8h2.7L12 11.6 7.5 6.3h2.7z"/>',
  sunder: '<path d="M1.5 15.5h21V22h-21z" opacity=".45"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M2 18.5l4.5-1.5 2.5 3.5 3-6 3 2.5 3.4-4 3.6 1.5"/><path d="M5 9.5l2.6-3.6 2.4 2.2-1.3 3.4zM13.5 6.5l3.6-2.4 1.2 3.4-2.6 2.2zM10.8 1.8l2 .4-.6 2.2-1.9-.7z"/>',
  wall: '<path fill-rule="evenodd" d="M2.5 8.5h3v-4h3.5v4h2v-4h2v4h2v-4H18.5v4h3V22h-19zM4.5 11v3.2h6.5V11zM13 11v3.2h6.5V11zM4.5 16.4v3.4h3.4v-3.4zM9.9 16.4v3.4h4.2v-3.4zM16.1 16.4v3.4h3.4v-3.4z"/>',
  grove: '<path d="M12 1.5c-3.1 0-5.2 2.2-5.2 4.8-1.9.6-3.3 2.3-3.3 4.3 0 2.7 2.2 4.6 4.9 4.6h2.4V23h2.4v-7.8h2.4c2.7 0 4.9-1.9 4.9-4.6 0-2-1.4-3.7-3.3-4.3 0-2.6-2.1-4.8-5.2-4.8z"/>',
  ring: '<circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.2 2"/>'
    + [0, 60, 120, 180, 240, 300].map(a => `<path transform="rotate(${a} 12 12)" d="${PINE}"/>`).join('')
    + '<circle cx="12" cy="12" r="1.8"/>',
  starfall: '<path d="M16.6 9.8l1.7 3.6 3.9.4-2.9 2.6.8 3.9-3.5-2-3.5 2 .8-3.9-2.9-2.6 3.9-.4z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M2.5 2.5l9.5 9.5M8 2l5.5 5.5M2 8l5.5 5.5" opacity=".85"/>',
  crystal: '<path d="M12 1l4.2 7.2L12 23l-4.2-14.8z"/><path d="M4.4 8.2l3.2 3-1 8.6-3.4-6.2z" opacity=".8"/><path d="M19.6 8.2l-3.2 3 1 8.6 3.4-6.2z" opacity=".8"/>',
  heal: '<path fill-rule="evenodd" d="M6.8 13a4.2 4.2 0 0 1 .3-8.4 5.4 5.4 0 0 1 10.1 1.2A3.6 3.6 0 0 1 17.4 13zM11 6.4v1.9H9.1v1.8H11V12h1.8v-1.9h1.9V8.3h-1.9V6.4z"/><path d="M6.5 15.5l-1.3 3a1.35 1.35 0 1 0 2.6 0zM12 16.5l-1.3 3a1.35 1.35 0 1 0 2.6 0zM17.5 15.5l-1.3 3a1.35 1.35 0 1 0 2.6 0z"/>',
  lightning: '<path d="M14.5 1L4 13.4h6.3L8 23 20 9.6h-6.6L16.8 1z"/>',
  frost: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
    + [0, 60, 120].map(a => `<g transform="rotate(${a} 12 12)"><path d="M12 1.5v21M9 4l3 2.6L15 4M9 20l3-2.6 3 2.6"/></g>`).join('')
    + '</g><circle cx="12" cy="12" r="2.4"/>',
  spring: '<path d="M12 2.5c2.6 3.4 4.4 6 4.4 8.2a4.4 4.4 0 0 1-8.8 0c0-2.2 1.8-4.8 4.4-8.2z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3 18.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M5 22c1.7-1.2 3.3-1.2 5 0s3.3 1.2 5 0 3.3-1.2 4 0"/>',
  blessing: '<path d="M12 1.5l2.3 6.6 6.9.2-5.5 4.2 2 6.7L12 15.2l-5.7 4 2-6.7-5.5-4.2 6.9-.2z"/><ellipse cx="12" cy="21.5" rx="6" ry="1.5" opacity=".55"/>',
  quake: '<path d="M1.5 16h21V22h-21z" opacity=".45"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" d="M12 16l-1.5 2.5 2 1.5-1 2M12 16l3.5 1.5 1 3M12 16l-4 1.2-1.5 2.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3 10.5c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0M5 5.5c1.2-1.5 2.5-1.5 3.7 0s2.5 1.5 3.7 0 2.5-1.5 3.7 0"/>',
});
const QUICK_ICON = '<path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21zm0 2.2a8.3 8.3 0 1 1 0 16.6 8.3 8.3 0 0 1 0-16.6z" opacity=".55"/><path d="M13.4 4.5L7 13.2h4.3l-1.6 6.3 7.3-9h-4.4l2.3-6z"/>';
const ARROW = { prev: '<path d="M15.5 4.5L8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M8.5 4.5L16 12l-7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' };

function svg(markup, cls) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false');
  el.setAttribute('fill', 'currentColor'); if (cls) el.setAttribute('class', cls);
  el.innerHTML = markup; return el;
}
function span(cls, text) { const el = document.createElement('span'); el.className = cls; if (text != null) el.textContent = text; return el; }

/** Pure cooldown/mana state; exported for tests and for root-side tooltips. */
export function spellState(spec, { mana = 0, tick = 0, lastCast } = {}) {
  const cd = Math.max(0, Number(spec?.cooldown) || 0);
  const elapsed = lastCast == null || !Number.isFinite(Number(lastCast)) ? Infinity : Number(tick) - Number(lastCast);
  const remainingTicks = cd > 0 && elapsed < cd ? Math.max(0, cd - Math.max(0, elapsed)) : 0;
  const cost = Number(spec?.cost) || 0;
  return {
    cooling: remainingTicks > 0,
    remaining: remainingTicks / TICK_HZ,             // seconds
    fraction: cd > 0 ? remainingTicks / cd : 0,       // 1 = just cast, 0 = ready
    short: Math.max(0, cost - (Number(mana) || 0)),   // mana still needed
    noMana: (Number(mana) || 0) < cost,
  };
}
export function formatRemaining(sec) { return sec >= 10 ? String(Math.ceil(sec)) : sec >= 0.05 ? sec.toFixed(1) : ''; }

/**
 * createSpellbook({root, spells, icons?}) → {update, dispose, scrollToSpell}
 *   root   : #godHelp (container holding .bf-spells and input#quickCast)
 *   spells : SPELLS catalogue [{id,label,cost,cooldown(ticks@60Hz),target,iconUrl?}]
 *   icons  : optional {spellId: url} for supplied generated art; falls back to SPELL_ICONS vectors.
 */
export function createSpellbook({ root, spells = [], icons = {} } = {}) {
  const list = root?.querySelector('.bf-spells');
  if (!list) throw new Error('createSpellbook: root must contain .bf-spells');
  const byId = new Map(spells.map(s => [s.id, s]));
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const off = [];   // listener removers
  const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); off.push(() => el.removeEventListener(type, fn, opts)); };

  // ---- pager shell: [prev] [viewport=.bf-spells] [next]. Moving the node keeps its listeners.
  const shell = document.createElement('div'); shell.className = 'sb-bar'; shell.setAttribute('data-sb', '');
  const prev = document.createElement('button'), next = document.createElement('button');
  for (const [btn, dir, label] of [[prev, 'prev', 'Previous spells'], [next, 'next', 'More spells']]) {
    btn.type = 'button'; btn.className = `sb-page sb-${dir}`; btn.setAttribute('aria-label', label); btn.title = label;
    btn.tabIndex = -1;   // keyboard users scroll by focusing spells; arrows are pointer affordances
    btn.append(svg(ARROW[dir]));
  }
  list.before(shell); shell.append(prev, list, next);
  list.classList.add('sb-track');
  root.classList.add('sb-root');

  // ---- augment each spell button
  const cards = new Map();
  for (const btn of list.querySelectorAll('[data-spell]')) {
    const id = btn.dataset.spell, spec = byId.get(id) || { id, label: btn.textContent.trim() };
    btn.classList.add('sb-card');
    const label=btn.querySelector('.bf-name');if(label)label.textContent=spec.label||id;
    const art = span('sb-art');
    const url = icons[id] || spec.iconUrl;
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; img.draggable = false; img.decoding = 'async'; art.append(img); }
    else art.append(svg(SPELL_ICONS[id] || '<circle cx="12" cy="12" r="8"/>'));
    const veil = span('sb-veil'), secs = span('sb-secs'); veil.setAttribute('aria-hidden', 'true'); secs.setAttribute('aria-hidden', 'true');
    btn.prepend(art); btn.append(veil, secs);
    if (spec.target === 'line') btn.dataset.sbLine = '';
    const key = btn.querySelector('kbd')?.textContent?.trim() || btn.getAttribute('aria-keyshortcuts') || '';
    const desc = `${spec.label || id} · ${spec.cost ?? '?'} mana${spec.target === 'line' ? ' · line' : ''}${key ? ` · key ${key}` : ''}`;
    cards.set(id, { btn, spec, art, veil, secs, desc, last: '' });
    btn.title = desc;
  }

  // ---- paging arrows + edge state (never a mask that hides reachable items)
  const pageBy = dir => list.scrollBy({ left: dir * Math.max(64, list.clientWidth * 0.8), behavior: reduceMotion?.matches ? 'auto' : 'smooth' });
  on(prev, 'click', e => { e.stopPropagation(); pageBy(-1); });
  on(next, 'click', e => { e.stopPropagation(); pageBy(1); });
  const edges = () => {
    const max = list.scrollWidth - list.clientWidth;
    const overflow = max > 2;
    shell.classList.toggle('sb-overflow', overflow);
    prev.setAttribute('aria-disabled', String(!overflow || list.scrollLeft <= 1));
    next.setAttribute('aria-disabled', String(!overflow || list.scrollLeft >= max - 1));
  };
  on(list, 'scroll', edges, { passive: true });
  const ro = globalThis.ResizeObserver ? new ResizeObserver(edges) : null; ro?.observe(list);
  on(globalThis, 'resize', edges, { passive: true });

  // ---- wheel: vertical wheel scrolls the row only while the pointer is over the bar and it can move
  on(shell, 'wheel', e => {
    if (e.ctrlKey) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 1 || (delta < 0 && list.scrollLeft <= 0) || (delta > 0 && list.scrollLeft >= max)) return;
    e.preventDefault(); e.stopPropagation();
    list.scrollLeft += e.deltaMode === 1 ? delta * 32 : delta;
  }, { passive: false });

  // ---- mouse/pen drag to scroll (touch uses native pan-x). A drag never becomes a spell click.
  let drag = null, suppressClick = false;
  on(list, 'pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, left: list.scrollLeft, moved: false };
  });
  on(list, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; list.setPointerCapture?.(e.pointerId); shell.classList.add('sb-dragging'); }
    if (drag.moved) { list.scrollLeft = drag.left - dx; e.preventDefault(); }
  });
  const endDrag = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    try { list.releasePointerCapture?.(drag.id); } catch { /* not captured */ }
    drag = null; shell.classList.remove('sb-dragging');
  };
  on(list, 'pointerup', endDrag); on(list, 'pointercancel', endDrag); on(list, 'lostpointercapture', endDrag);
  // Capture phase on the ancestor runs before the root's target listeners on each button.
  on(list, 'click', e => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }, true);
  on(list, 'dragstart', e => e.preventDefault());

  // ---- keyboard: whatever gets focus is scrolled fully clear of the arrows
  on(list, 'focusin', e => {
    const btn = e.target.closest?.('[data-spell]'); if (!btn) return;
    const l = btn.offsetLeft, r = l + btn.offsetWidth, pad = 6;
    if (l < list.scrollLeft + pad) list.scrollLeft = l - pad;
    else if (r > list.scrollLeft + list.clientWidth - pad) list.scrollLeft = r - list.clientWidth + pad;
  });

  // ---- QuickCast: deliberate icon + state; the root's change listener is untouched.
  const quick = root.querySelector('#quickCast') || document.getElementById('quickCast');
  const quickLabel = quick?.closest('label');
  let quickIcon = null, pulseTimer = 0;
  const syncQuick = pulse => {
    if (!quickLabel) return;
    quickLabel.classList.toggle('sb-qc-on', !!quick.checked);
    quickLabel.dataset.sbState = quick.checked ? 'on' : 'off';
    if (pulse && quick.checked && !reduceMotion?.matches) {
      quickLabel.classList.remove('sb-qc-pulse'); void quickLabel.offsetWidth; quickLabel.classList.add('sb-qc-pulse');
      clearTimeout(pulseTimer); pulseTimer = setTimeout(() => quickLabel.classList.remove('sb-qc-pulse'), 900);
    }
  };
  if (quickLabel) {
    quickLabel.classList.add('sb-qc');
    quickIcon = svg(QUICK_ICON, 'sb-qc-icon'); quick.after(quickIcon);
    on(quick, 'change', () => syncQuick(true));
    syncQuick(false);
  }

  // ---- legend appended to the existing help drawer (readable, removed on dispose)
  const helpList = root.querySelector('.bf-help-list');
  let legend = null;
  if (helpList) {
    legend = document.createElement('li'); legend.className = 'sb-legend';
    legend.innerHTML = '<b>Spell cards</b> — <span class="sb-lg-cost">red cost</span> means not enough mana yet. '
      + 'Mana is the only limit: aim anywhere and the spell lands. Every card stays selectable. '
      + 'Scroll the row with ‹ ›, mouse wheel, drag or arrow keys.';
    helpList.append(legend);
  }

  // ---- update: render only what the root reports
  let lastSelected = null;
  function update({ mana = 0, tick = 0, spellTicks = {}, selected, enabled = true, blocked = {} } = {}) {
    shell.classList.toggle('sb-off', !enabled);
    for (const [id, c] of cards) {
      const s = spellState(c.spec, { mana, tick, lastCast: spellTicks?.[id] });
      const secText = s.cooling ? formatRemaining(s.remaining) : '';
      const reason=blocked[id]||(!enabled?'Unavailable':'');
      const key = `${s.cooling ? Math.round(s.fraction * 200) : 0}|${s.noMana ? s.short : 0}|${secText}|${reason}`;
      if (key === c.last) continue;
      c.last = key;
      c.btn.classList.toggle('sb-cooling', s.cooling);
      c.btn.classList.toggle('sb-nomana', s.noMana);
      c.btn.classList.toggle('sb-blocked',!!reason&&!s.cooling&&!s.noMana);
      c.btn.classList.toggle('sb-locked',/^Unlocks/.test(reason));
      c.btn.style.setProperty('--sb-cd', s.cooling ? s.fraction.toFixed(3) : '0');
      c.secs.textContent = secText;
      const status = s.cooling ? ` · recharging ${secText}s` : s.noMana ? ` · needs ${Math.ceil(s.short)} more mana` : reason?` · ${reason}`:' · ready';
      c.btn.setAttribute('aria-description', status.slice(3));
      c.btn.title = c.desc + status;
    }
    if (selected && selected !== lastSelected && cards.has(selected)) {
      lastSelected = selected;
      for (const [id, c] of cards) c.btn.classList.toggle('sb-selected', id === selected);
      scrollToSpell(selected, true);
    }
    if (quickLabel && quickLabel.classList.contains('sb-qc-on') !== !!quick.checked) syncQuick(false);
    edges();
  }
  function scrollToSpell(id, onlyIfHidden = false) {
    const c = cards.get(id); if (!c) return;
    const l = c.btn.offsetLeft, r = l + c.btn.offsetWidth;
    const visible = l >= list.scrollLeft - 1 && r <= list.scrollLeft + list.clientWidth + 1;
    if (onlyIfHidden && visible) return;
    list.scrollLeft = l < list.scrollLeft ? l - 6 : r - list.clientWidth + 6;
  }
  function dispose() {
    off.splice(0).forEach(f => f()); ro?.disconnect(); clearTimeout(pulseTimer);
    for (const c of cards.values()) {
      c.art.remove(); c.veil.remove(); c.secs.remove();
      c.btn.classList.remove('sb-card', 'sb-cooling', 'sb-nomana', 'sb-selected');
      c.btn.style.removeProperty('--sb-cd'); c.btn.removeAttribute('aria-description'); delete c.btn.dataset.sbLine;
    }
    shell.before(list); shell.remove(); list.classList.remove('sb-track'); root.classList.remove('sb-root');
    quickIcon?.remove(); quickLabel?.classList.remove('sb-qc', 'sb-qc-on', 'sb-qc-pulse'); if (quickLabel) delete quickLabel.dataset.sbState;
    legend?.remove();
  }
  edges();
  return { update, dispose, scrollToSpell };
}
