// Brann's Forge — hold overlays: Field Guide (F1) and Party (Tab).
// Plain DOM, no dependencies. All text goes through textContent; root owns keys,
// pointer lock and every number shown here (missing values render as "—").
//
//   const fo = createFieldOverlays({ mount, onAction });
//   fo.show('help' | 'party', model, { pinned })  // pinned = touch/click entry (modal, has Close)
//   fo.update(model)                              // re-render visible overlay; also caches for entry buttons
//   fo.hide()                                     // release / blur / cancel
//   fo.dispose()
//   onAction({ id, kind, source })  ids: 'current-quest' | 'start-expedition' | 'menu' | quest.action | 'close' | 'open'

const SVG_NS = 'http://www.w3.org/2000/svg';
const DASH = '—';
const ROLE_ICON = { hero: 'i-hero', god: 'i-god' };
const ACTION_ICONS = {
  'current-quest': 'M6 3h9l3 3v15H6z M9 9h6 M9 13h6 M9 17h4',
  'start-expedition': 'M5 21V4 M5 4h11l-2 4 2 4H5',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M6 6l12 12 M18 6L6 18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.01',
  party: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a2.5 2.5 0 1 0 0-5 M3 19c.5-3 2.5-5 5-5s4.5 2 5 5 M15 14c2.3 0 4.3 1.7 5 5',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function pathIcon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fo-ico');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

// Reuse the page's own sprite (#bfi-axe, #i-hero …) when present; never ship duplicate art.
function spriteIcon(id) {
  if (!id || !document.getElementById(id)) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fo-ico');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

function monogram(text) {
  const s = el('span', 'fo-mono', String(text || '?').trim().charAt(0).toUpperCase() || '?');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function present(v) { return v !== undefined && v !== null && v !== ''; }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10) / 10) : (present(v) ? String(v) : DASH); }

// binding: "Q" | ["Q", "RMB"] | { desktop, touch, vr } (picked by inputMode)
function pickBinding(binding, mode) {
  if (binding && typeof binding === 'object' && !Array.isArray(binding)) {
    return binding[mode] ?? binding.desktop ?? binding.touch ?? binding.vr ?? null;
  }
  return binding;
}

function keys(binding, mode) {
  const b = pickBinding(binding, mode);
  const wrap = el('span', 'fo-keys');
  const list = Array.isArray(b) ? b : present(b) ? [b] : [];
  list.forEach((k, i) => {
    if (i) wrap.append(el('span', 'fo-or', '/'));
    wrap.append(el('kbd', null, k));
  });
  return wrap;
}

// basic/special: "text" | { label, binding, detail }
function normEntry(v) {
  if (!present(v)) return null;
  if (typeof v === 'object') return { label: v.label, binding: v.binding, detail: v.detail };
  return { label: v, binding: null, detail: null };
}

function fmtCooldown(c) {
  if (!present(c)) return null;
  return typeof c === 'number' ? `${Math.round(c * 10) / 10} s` : String(c);
}

const RELEASE_HINT = {
  help: { desktop: 'Release F1 to close', touch: 'Tap outside or Close', vr: 'Release to close' },
  party: { desktop: 'Release Tab to return', touch: 'Tap outside or Close', vr: 'Release to close' },
};

export function createFieldOverlays({ mount, onAction } = {}) {
  if (!mount) throw new Error('createFieldOverlays: mount is required');
  const emit = (id, extra) => { try { onAction?.({ id, kind: state.kind, ...extra }); } catch (e) { console.error(e); } };

  const state = { kind: null, pinned: false, model: null, restoreFocus: null };
  let renderedSignature='', pointerHeld=false, pendingUpdate=false, thawTimer=0;

  const root = el('div', 'fo-root');
  root.hidden = true;
  const scrim = el('div', 'fo-scrim');
  const panel = el('section', 'fo-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'fo-title');
  panel.tabIndex = -1;
  root.append(scrim, panel);

  // Touch / click entry: two small corner buttons. Root decides visibility via
  // body.touch-controls-active (existing class) or by toggling `entry.hidden`.
  const entry = el('div', 'fo-entry');
  entry.setAttribute('role', 'group');
  entry.setAttribute('aria-label', 'Field guide and party');
  for (const kind of ['help', 'party']) {
    const b = el('button', 'fo-entry-btn');
    b.type = 'button';
    b.dataset.foOpen = kind;
    b.setAttribute('aria-label', kind === 'help' ? 'Field guide' : 'Party and quest');
    b.setAttribute('aria-haspopup', 'dialog');
    b.append(pathIcon(ACTION_ICONS[kind]));
    entry.append(b);
  }
  mount.append(root, entry);

  function onEntryClick(e) {
    const b = e.target.closest('[data-fo-open]');
    if (!b) return;
    const kind = b.dataset.foOpen;
    if (state.kind === kind && state.pinned) { hide(); emit('close'); return; }
    show(kind, state.model || {}, { pinned: true });
    emit('open', { kind });
  }
  function onPanelClick(e) {
    const b = e.target.closest('[data-fo-action]');
    if (!b || b.disabled) return;
    const id = b.dataset.foAction;
    if (id === 'close') { hide(); emit('close'); return; }
    emit(id, { source: b.dataset.foSource || 'bar' });
  }
  function onScrim() { if (state.pinned) { hide(); emit('close'); } }
  function onKey(e) {
    if (!state.pinned) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); emit('close'); return; }
    if (e.key === 'Tab') { // focus trap while pinned (hold mode leaves Tab to root)
      const f = [...panel.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  entry.addEventListener('click', onEntryClick);
  panel.addEventListener('click', onPanelClick);
  scrim.addEventListener('click', onScrim);
  root.addEventListener('keydown', onKey);

  function header(m, kind) {
    const h = el('header', 'fo-head');
    const art = el('div', 'fo-art');
    if (kind === 'help') {
      const fallback = () => spriteIcon('bfi-' + m.tool) || monogram(m.name || m.tool);
      if (present(m.art)) {
        const img = el('img');
        img.alt = '';
        img.decoding = 'async';
        img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
        img.src = String(m.art);
        art.append(img);
      } else art.append(fallback());
    } else {
      art.append(pathIcon(ACTION_ICONS.party));
    }
    const titles = el('div', 'fo-titles');
    const eyebrow = el('p', 'fo-eyebrow', kind === 'help' ? (m.help?.title || 'Field guide') : 'Party');
    const title = el('h2', 'fo-title', kind === 'help' ? (m.name || m.tool || 'Equipment') : (m.quest?.title ? 'Expedition' : 'Party'));
    title.id = 'fo-title';
    titles.append(eyebrow, title);
    h.append(art, titles);
    if (present(m.role)) {
      const r = el('span', 'fo-role');
      const ri = spriteIcon(ROLE_ICON[m.role]);
      if (ri) r.append(ri);
      r.append(el('span', null, m.role));
      h.append(r);
    }
    if (state.pinned) {
      const c = el('button', 'fo-close');
      c.type = 'button';
      c.dataset.foAction = 'close';
      c.setAttribute('aria-label', 'Close');
      c.append(pathIcon(ACTION_ICONS.close));
      h.append(c);
    }
    return h;
  }

  function primaryRow(kindLabel, entryVal, mode, extraPill) {
    const e = normEntry(entryVal);
    if (!e) return null;
    const row = el('div', 'fo-primary');
    row.dataset.slot = kindLabel.toLowerCase();
    const top = el('div', 'fo-primary-top');
    top.append(el('span', 'fo-slot', kindLabel));
    if (present(pickBinding(e.binding, mode))) top.append(keys(e.binding, mode));
    if (extraPill) top.append(el('span', 'fo-pill', extraPill));
    row.append(top, el('p', 'fo-primary-text', e.label));
    if (present(e.detail)) row.append(el('p', 'fo-detail', e.detail));
    return row;
  }

  function renderHelp(m) {
    const mode = m.inputMode || 'desktop';
    const help = m.help || {};
    const body = el('div', 'fo-body fo-help');
    const prim = el('div', 'fo-prims');
    const b = primaryRow('Basic', help.basic, mode);
    const s = primaryRow('Special', help.special, mode, fmtCooldown(help.cooldown) && `Cooldown ${fmtCooldown(help.cooldown)}`);
    if (b) prim.append(b);
    if (s) prim.append(s);
    if (prim.childElementCount) body.append(prim);
    const list = (help.interactions || []).filter((i) => i && present(i.label));
    if (list.length) {
      const dl = el('dl', 'fo-inter');
      dl.setAttribute('aria-label', 'Interactions');
      for (const i of list) {
        const row = el('div', 'fo-inter-row');
        row.append(el('dt', null, i.label));
        const dd = el('dd');
        dd.append(keys(i.binding, mode));
        row.append(dd);
        dl.append(row);
      }
      body.append(dl);
    }
    if (!body.childElementCount) body.append(el('p', 'fo-empty', 'No controls for this equipment.'));
    return body;
  }

  function progressNode(p) {
    if (!present(p)) return null;
    // number 0..1 → bar; { value, max, label } → bar + label; string → text
    let frac = null, label = null;
    if (typeof p === 'number' && Number.isFinite(p)) { frac = p; label = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`; }
    else if (typeof p === 'object' && Number.isFinite(p.value) && Number.isFinite(p.max) && p.max > 0) {
      frac = p.value / p.max; label = p.label ?? `${p.value} / ${p.max}`;
    } else label = typeof p === 'object' ? p.label : p;
    const w = el('div', 'fo-progress');
    if (frac !== null) {
      const bar = el('div', 'fo-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-label', 'Quest progress');
      const fill = el('span');
      fill.style.width = pct + '%';
      bar.append(fill);
      w.append(bar);
    }
    if (present(label)) w.append(el('span', 'fo-progress-label', label));
    return w;
  }

  function renderParty(m) {
    const body = el('div', 'fo-body fo-party');
    const players = Array.isArray(m.players) ? m.players : [];
    const board = el('div', 'fo-board');
    const table = el('table', 'fo-table');
    const cap = el('caption', 'fo-sr', 'Party scoreboard');
    const thead = el('thead');
    const hr = el('tr');
    for (const [t, cls, title] of [['Player', 'fo-c-name'], ['K', 'fo-c-num', 'Kills'], ['D', 'fo-c-num', 'Deaths'], ['Dmg', 'fo-c-num', 'Damage dealt']]) {
      const th = el('th', cls, t);
      th.scope = 'col';
      if (title) { th.title = title; th.setAttribute('aria-label', title); }
      hr.append(th);
    }
    thead.append(hr);
    const tb = el('tbody');
    for (const p of players) {
      const tr = el('tr');
      if (p.isSelf) tr.className = 'fo-self';
      const name = el('th', 'fo-c-name');
      name.scope = 'row';
      const inner = el('span', 'fo-pname');
      const ri = spriteIcon(ROLE_ICON[p.role]);
      if (ri) inner.append(ri); else if (present(p.role)) inner.append(monogram(p.role));
      const nm = el('span', 'fo-ptext', present(p.name) ? p.name : 'Unnamed');
      nm.title = present(p.name) ? String(p.name) : '';
      inner.append(nm);
      if (p.isSelf) inner.append(el('span', 'fo-you', 'you'));
      if (present(p.role)) inner.append(el('span', 'fo-sr', `, ${p.role}`));
      name.append(inner);
      tr.append(name, el('td', 'fo-c-num', num(p.kills)), el('td', 'fo-c-num', num(p.deaths)), el('td', 'fo-c-num', num(p.contribution)));
      tb.append(tr);
    }
    table.append(cap, thead, tb);
    board.append(table);
    if (!players.length) board.append(el('p', 'fo-empty', 'Waiting for party data.'));
    body.append(board);

    const q = m.quest;
    const card = el('div', 'fo-quest');
    card.append(el('p', 'fo-slot', 'Active quest'));
    if (q && present(q.title)) {
      card.append(el('h3', 'fo-quest-title', q.title));
      if (present(q.summary)) card.append(el('p', 'fo-quest-sum', q.summary));
      const pr = progressNode(q.progress);
      if (pr) card.append(pr);
      if (present(q.actionLabel) && present(q.action)) {
        const a = el('button', 'fo-btn fo-btn-primary', q.actionLabel);
        a.type = 'button';
        a.dataset.foAction = String(q.action);
        a.dataset.foSource = 'quest';
        a.disabled = (m.disabledActions || []).includes(String(q.action));
        card.append(a);
      }
    } else card.append(el('p', 'fo-empty', 'No active quest.'));
    body.append(card);
    return body;
  }

  function footer(m, kind) {
    const f = el('footer', 'fo-foot');
    if (kind === 'party') {
      const bar = el('div', 'fo-actions');
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Party actions');
      const disabled = new Set(m.disabledActions || []);
      for (const [id, label] of [['current-quest', 'Current quest'], ['start-expedition', 'Start expedition'], ['menu', 'Menu']]) {
        const b = el('button', 'fo-btn fo-btn-icon');
        b.type = 'button';
        b.dataset.foAction = id;
        b.disabled = disabled.has(id);
        b.title = label;
        b.append(pathIcon(ACTION_ICONS[id]), el('span', 'fo-btn-label', label));
        bar.append(b);
      }
      f.append(bar);
    }
    const mode = m.inputMode || 'desktop';
    f.append(el('p', 'fo-release', state.pinned ? (mode === 'touch' ? 'Tap outside or Close' : 'Esc or Close') : RELEASE_HINT[kind][mode] || RELEASE_HINT[kind].desktop));
    return f;
  }

  function render() {
    const signature=JSON.stringify([state.kind,state.pinned,state.model]);
    if(signature===renderedSignature)return;
    renderedSignature=signature;
    const m = state.model || {};
    const kind = state.kind;
    const hadFocus = panel.contains(document.activeElement) ? document.activeElement.dataset?.foAction : null;
    root.dataset.kind = kind;
    root.dataset.mode = state.pinned ? 'pinned' : 'hold';
    root.dataset.input = m.inputMode || 'desktop';
    if (present(m.tool)) root.dataset.tool = m.tool; else delete root.dataset.tool;
    panel.setAttribute('aria-modal', state.pinned ? 'true' : 'false');
    panel.replaceChildren(header(m, kind), kind === 'help' ? renderHelp(m) : renderParty(m), footer(m, kind));
    if (hadFocus) panel.querySelector(`[data-fo-action="${CSS.escape(hadFocus)}"]`)?.focus();
  }

  function show(kind, model, opts = {}) {
    if (kind !== 'help' && kind !== 'party') throw new Error(`createFieldOverlays.show: unknown kind ${kind}`);
    if (model) state.model = model;
    const wasOpen = !root.hidden;
    state.kind = kind;
    state.pinned = !!opts.pinned;
    if (!wasOpen || state.pinned) {
      const a = document.activeElement;
      if (!wasOpen) state.restoreFocus = a && a !== document.body && !panel.contains(a) ? a : null;
    }
    render();
    root.hidden = false;
    entry.querySelectorAll('[data-fo-open]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.foOpen === kind)));
    // Hold mode never steals focus (root is watching keyup); pinned is a real modal.
    if (state.pinned) (panel.querySelector('.fo-close') || panel).focus({ preventScroll: true });
  }

  function update(model) {
    if (model) state.model = model;
    if (!root.hidden) { if(pointerHeld)pendingUpdate=true;else render(); }
  }

  function hide() {
    if (root.hidden) return;
    const restore = state.restoreFocus;
    const refocus = state.pinned || panel.contains(document.activeElement);
    root.hidden = true;
    clearTimeout(thawTimer); pointerHeld=pendingUpdate=false; renderedSignature='';
    state.kind = null;
    state.pinned = false;
    state.restoreFocus = null;
    panel.replaceChildren();
    entry.querySelectorAll('[data-fo-open]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (refocus && restore && restore.isConnected) restore.focus({ preventScroll: true });
  }

  // Hold a button's DOM identity from pointerdown through click while snapshots continue.
  function pointerDown(){clearTimeout(thawTimer);pointerHeld=true;}
  function thaw(){clearTimeout(thawTimer);pointerHeld=false;if(pendingUpdate&&!root.hidden){pendingUpdate=false;render();}}
  function pointerUp(){clearTimeout(thawTimer);thawTimer=setTimeout(thaw,100);}
  function clickDone(){clearTimeout(thawTimer);thawTimer=setTimeout(thaw,0);}
  root.addEventListener('pointerdown',pointerDown);
  root.addEventListener('click',clickDone);
  window.addEventListener('pointerup',pointerUp);
  window.addEventListener('pointercancel',thaw);

  function dispose() {
    hide();
    entry.removeEventListener('click', onEntryClick);
    panel.removeEventListener('click', onPanelClick);
    scrim.removeEventListener('click', onScrim);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown',pointerDown);root.removeEventListener('click',clickDone);
    window.removeEventListener('pointerup',pointerUp);window.removeEventListener('pointercancel',thaw);clearTimeout(thawTimer);
    root.remove();
    entry.remove();
  }

  return {
    show, update, hide, dispose,
    get visible() { return root.hidden ? null : state.kind; },
    get pinned() { return !root.hidden && state.pinned; },
    root, entry,
  };
}

// Small always-readable build tag. Root passes the SHA; nothing is fetched here.
export function createBuildTag({ mount, text } = {}) {
  const tag = el('div', 'fo-build', text ?? '');
  tag.setAttribute('aria-hidden', 'true');
  (mount || document.body).append(tag);
  return { set(t) { tag.textContent = t ?? ''; }, dispose() { tag.remove(); }, el: tag };
}
