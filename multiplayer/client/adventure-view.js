// Compact Forge Expedition HUD. Consumes the stable adventureView() model from shared/adventure.js.
// DOM version for desktop/mobile (corner card: stage + next step + progress; expands for the full objective list),
// plus drawAdventurePanel() for a VR CanvasTexture (DOM is invisible in WebXR; unchanged).
// No framework, no Three.js dependency. The DOM is built once and patched in place, so live updates never
// recreate a focused control. Styles live in expedition-hud.css.

// Original 24x24 single-path glyphs (fill-rule evenodd), shared by SVG and Path2D.
export const ADVENTURE_ICONS = Object.freeze({
  timber: 'M3 15h14a3 3 0 0 1 0 6H3a3 3 0 0 1 0-6zm0 2a1 1 0 0 0 0 2 1 1 0 0 0 0-2zM6 4l9 9h-3L4 5zm6-1 2 2-3 3-2-2z',
  stone: 'M5 20 2 13l4-7 7-3 7 4 2 8-5 5zm4-10 3-2 3 2-1 3h-4z',
  gem: 'M7 3h10l5 6-10 12L2 9zm1.5 2L5 9h4.5L11 5zm5.5 0 1.5 4H19l-3.5-4zM12 17l3-7H9z',
  star: 'M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3l-5.8 3.5 1.6-6.6L2.6 8.8l6.8-.5z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9zm0 11c-1 1.5-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-1-2.5-2-4z',
  skull: 'M12 2a8 8 0 0 0-8 8v4l2 2v4h3v-2h2v2h2v-2h2v2h3v-4l2-2v-4a8 8 0 0 0-8-8zm-3.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  path: 'M4 22c2-6 9-6 8-11-1-4 6-5 8-9h2c-2 5-8 6-7.5 9.5C15 17 7 17 6.5 22zM3 5h3v3H3zm14 13h3v3h-3z',
  grove: 'M12 2 6 11h3l-4 6h6v5h2v-5h6l-4-6h3z',
});
const TONE = {idle: '#c9b48a', camp: '#e0a64a', star: '#9fc8ff', rekindle: '#ff7a3a', victory: '#ffd36b', defeat: '#9a8f86'};
const SVG_NS = 'http://www.w3.org/2000/svg';
const RUNNING = ['camp', 'star', 'rekindle'];
const TRACK = [['camp', 'I', 'Camp'], ['star', 'II', 'Star'], ['rekindle', 'III', 'Rekindle']];
// Canonical button order. Existing buttons are never moved, so a focused control survives every live update.
const ORDER = ['retry', 'rematch', 'start', 'deposit', 'lodestar', 'tithe', 'leave'];
const PRIMARY = ['retry', 'rematch', 'start', 'deposit', 'lodestar', 'tithe'];
const SHORT = {start: 'Start', rematch: 'Rematch', retry: 'Retry', leave: 'Leave', deposit: 'Deliver', tithe: 'Tithe', lodestar: 'Lodestar'};
const LABELS = {start: 'Start Expedition', rematch: 'Rematch', retry: 'Retry last stand', leave: 'Leave', deposit: 'Deliver to forge', tithe: 'Tithe (mana)', lodestar: 'Lodestar (mana)'};
const ACTION_ICON = {start: 'flame', rematch: 'flame', retry: 'flame', deposit: 'timber', tithe: 'star', lodestar: 'gem', leave: 'path'};
// Mana costs mirror shared/adventure.js PACING.titheMana / lodestarMana (the server still decides).
const MANA = {tithe: 30, lodestar: 25};
const CARRY = {camp: ['wood', 'stone'], star: ['gems']};
const CARRY_NAMES = {wood: 'timber', stone: 'stone', gems: 'gems'};
// Small UI-only glyphs (24x24) for the toggle and role badges; ADVENTURE_ICONS above stay the shared/VR set.
const UI_GLYPH = {
  chevron: 'M6 9.5 7.5 8l4.5 4.5L16.5 8 18 9.5l-6 6z',
  hero: 'M4 3h3l9 9-3 3-9-9zm11 11 3-3 1.5 1.5-1 1 3.5 3.5-2 2-3.5-3.5-1 1z',
  god: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zm6 11 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9zM6 15l.9 2.1L9 18l-2.1.9L6 21l-.9-2.1L3 18l2.1-.9z',
};

function icon(name, size = 18, color = 'currentColor') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ADVENTURE_ICONS[name] || UI_GLYPH[name] || ADVENTURE_ICONS.star); p.setAttribute('fill', color); p.setAttribute('fill-rule', 'evenodd');
  svg.append(p); return svg;
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setAttr = (node, name, value) => { if (value === null) node.removeAttribute(name); else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value); };
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stageIcon = stage => stage === 'rekindle' || stage === 'defeat' ? 'flame' : stage === 'star' || stage === 'victory' ? 'star' : 'timber';

// Mirrors lobby expeditionAction('deposit'): kinds this stage accepts that the viewer carries.
export function deliverableKinds(stage, held = {}) {
  return (CARRY[stage] || ['wood', 'stone', 'gems']).filter(k => (held[k] | 0) > 0);
}

// One short, role-specific next step from the authoritative view (plus carried resources when the caller supplies them).
export function nextStep(view, held = null) {
  const open = id => view.objectives.find(o => o.id === id && !o.done);
  const more = o => o.need - o.have;
  const god = view.role === 'god';
  const can = a => view.actions.includes(a);
  switch (view.stage) {
    case 'idle': return 'Gather. Recover a star. Defend the forge.';
    case 'camp': {
      const wood = open('wood'), stone = open('stone');
      const deeds = view.objectives.filter(o => o.role === 'god' && !o.done && !o.waived);
      if (god) {
        if (deeds.length) return deeds[0].id === 'shape' ? 'Shape a path near camp (Raise, Lower, Sunder or Wall)' : 'Plant a grove for timber (Grove or Ring)';
        if (wood || stone) return can('tithe') ? 'Tithe mana to send the Heroes supplies' : 'Heroes are gathering timber and stone';
        return 'Camp ready. Watch for the star';
      }
      if (held && ((wood && held.wood) || (stone && held.stone))) return 'Deliver what you carry at the forge';
      if (wood) return `Chop timber (${more(wood)} more), bring it to the forge`;
      if (stone) return `Mine stone (${more(stone)} more), bring it to the forge`;
      return deeds.length ? 'Supplies in. Waiting on the God' : 'Camp ready. Watch for the star';
    }
    case 'star': {
      if (open('landed')) return 'Watch the sky for the falling star';
      if (open('guards')) return god ? 'The Heroes must clear the star guardians' : 'Defeat the star guardians';
      const star = open('star');
      if (!star) return 'Star recovered';
      if (god) return can('lodestar') ? `Lodestar star gems home (${more(star)} more)` : `Heroes are mining star gems (${more(star)} more)`;
      if (held?.gems) return 'Deliver star gems at the forge';
      return `Mine star shards with the pick (${more(star)} more)`;
    }
    case 'rekindle': {
      const waves = view.objectives.find(o => o.id === 'waves');
      const wave = `wave ${Math.min(3, (waves?.have || 0) + 1)}/3`;
      return god ? (can('tithe') ? `Tithe mana to feed the flame (${wave})` : `Support the Heroes (${wave})`) : `Guard and feed the forge flame (${wave})`;
    }
    case 'victory': return 'Victory! Rematch or leave';
    case 'defeat': return view.retriesLeft > 0 ? `The flame died. Retry (${view.retriesLeft} left) or leave` : 'The flame died. Rematch or leave';
    default: return '';
  }
}

// Per-button presentation from true data only. `ctx` = {held:{wood,stone,gems}, mana} from the snapshot, both optional.
export function actionModel(view, ctx = {}) {
  const list = ORDER.filter(a => view.actions.includes(a));
  return list.map(id => {
    const b = {id, label: LABELS[id] || id, blocked: '', note: ''};
    if (id === 'deposit' && ctx.held) {
      const kinds = deliverableKinds(view.stage, ctx.held);
      b.note = kinds.length ? kinds.map(k => `${ctx.held[k] | 0} ${CARRY_NAMES[k]}`).join(' · ') : 'nothing carried';
      b.empty = !kinds.length; // still pressable: the lobby answers with gathering guidance
    }
    if (id === 'tithe' || id === 'lodestar') {
      if (id === 'lodestar' && view.star && !view.star.landed) b.blocked = 'star has not landed';
      else if (id === 'lodestar' && view.objectives.some(o => o.id === 'guards' && !o.done)) b.blocked = 'guardians still stand';
      else if (Number.isFinite(ctx.mana) && ctx.mana < MANA[id]) b.blocked = `needs ${MANA[id]} mana`;
      b.note = b.blocked || `${MANA[id]} mana`;
    }
    return b;
  });
}

const store = {
  get() { try { return globalThis.localStorage?.getItem('branns-forge.expedition.expanded') === '1'; } catch { return false; } },
  set(v) { try { globalThis.localStorage?.setItem('branns-forge.expedition.expanded', v ? '1' : '0'); } catch { /* private mode */ } },
};
let uid = 0;

// root: container element. onAction(actionName) is called for button presses; the caller adds seq/kind/point.
// update(view, ctx?) patches in place. ctx {held, mana} is optional true snapshot data used only for button feedback.
export function createAdventureBanner(root, {onAction = () => {}, expanded = store.get()} = {}) {
  const id = `xhud-${++uid}`;
  const box = el('section', 'expedition-banner xhud');
  box.setAttribute('aria-labelledby', `${id}-title`);
  box.dataset.expanded = String(!!expanded);

  const toggle = el('button', 'xhud-toggle'); toggle.type = 'button';
  setAttr(toggle, 'aria-expanded', String(!!expanded)); setAttr(toggle, 'aria-controls', `${id}-body`);
  const stageGlyph = el('span', 'xhud-stage-icon');
  const title = el('span', 'xhud-title'); title.id = `${id}-title`;
  const roleBadge = el('span', 'xhud-role');
  const timer = el('span', 'xhud-timer'); timer.setAttribute('aria-hidden', 'true');
  const chevron = el('span', 'xhud-chevron'); chevron.append(icon('chevron', 18));
  const toggleHint = el('span', 'xhud-sr'); // "Show/Hide objectives" for screen readers
  toggle.append(stageGlyph, title, roleBadge, timer, chevron, toggleHint);

  const next = el('p', 'xhud-next'); next.setAttribute('aria-live', 'polite');
  const alerts = el('div', 'xhud-alerts');
  const alertSay = el('p', 'xhud-sr'); alertSay.setAttribute('aria-live', 'assertive');
  const row = el('div', 'xhud-row');
  const chips = el('div', 'xhud-chips');
  const actions = el('div', 'xhud-actions'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Expedition actions');
  row.append(chips, actions);

  const body = el('div', 'xhud-body'); body.id = `${id}-body`; body.hidden = !expanded;
  const track = el('ol', 'xhud-track'); track.setAttribute('aria-label', 'Expedition stages');
  const trackItems = TRACK.map(([, num, name]) => { const li = el('li', '', `${num} ${name}`); track.append(li); return li; });
  const notice = el('p', 'xhud-notice');
  const goals = el('ul', 'xhud-goals'); goals.setAttribute('aria-label', 'Objectives');
  const optional = el('ul', 'xhud-goals xhud-optional'); optional.setAttribute('aria-label', 'Optional objectives');
  const facts = el('p', 'xhud-facts');
  body.append(track, notice, goals, optional, facts);

  const confirm = el('div', 'xhud-confirm'); confirm.hidden = true; confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', 'Confirm leaving');
  const confirmText = el('p', '', '');
  const confirmYes = el('button', 'xhud-btn xhud-danger', 'Leave for everyone'); confirmYes.type = 'button'; confirmYes.dataset.confirm = 'leave';
  const confirmNo = el('button', 'xhud-btn', 'Stay'); confirmNo.type = 'button'; confirmNo.dataset.confirm = 'stay';
  confirm.append(confirmText, confirmYes, confirmNo);

  box.append(toggle, confirm, next, alerts, alertSay, row, body);
  root.append(box);

  let last = '', view = null, ctx = {}, isExpanded = !!expanded, confirmTimer = 0, leaveSentStage = '';
  const buttons = new Map(), chipNodes = new Map(), goalNodes = new Map(), optNodes = new Map(), alertNodes = new Map(), busy = new Map();

  function setExpanded(v, persist = true) {
    isExpanded = !!v; box.dataset.expanded = String(isExpanded); body.hidden = !isExpanded;
    setAttr(toggle, 'aria-expanded', String(isExpanded)); setText(toggleHint, isExpanded ? 'Hide objectives' : 'Show all objectives');
    if (persist) store.set(isExpanded);
    if (view) renderActions();
  }
  function closeConfirm(refocus) {
    clearTimeout(confirmTimer); const had = !confirm.hidden; confirm.hidden = true;
    if (had && refocus) (buttons.get('leave')?.isConnected ? buttons.get('leave') : toggle).focus();
  }
  function markBusy(action) {
    const b = buttons.get(action); if (!b) return;
    clearTimeout(busy.get(action)); b.dataset.busy = 'true'; setAttr(b, 'aria-busy', 'true');
    busy.set(action, setTimeout(() => clearBusy(action), 1200));
  }
  function clearBusy(action) {
    clearTimeout(busy.get(action)); busy.delete(action);
    const b = buttons.get(action); if (b) { delete b.dataset.busy; setAttr(b, 'aria-busy', null); }
  }

  toggle.addEventListener('click', e => { setExpanded(!isExpanded); if (e.detail) toggle.blur(); });
  box.addEventListener('click', e => {
    const c = e.target.closest('button[data-confirm]');
    if (c) {
      const yes = c.dataset.confirm === 'leave'; closeConfirm(!yes || !e.detail);
      if (yes) { leaveSentStage = view?.stage || ''; onAction('leave'); markBusy('leave'); if (view) render(); }
      return;
    }
    const b = e.target.closest('button[data-action]');
    if (!b || !box.contains(b)) return;
    const action = b.dataset.action;
    if (b.getAttribute('aria-disabled') === 'true' || busy.has(action)) return;
    if (action === 'leave') {
      setText(confirmText, view && RUNNING.includes(view.stage) ? 'End the expedition for everyone? A majority of players must agree.' : 'Return everyone to free building?');
      confirm.hidden = false; clearTimeout(confirmTimer); confirmTimer = setTimeout(() => closeConfirm(false), 8000);
      confirmNo.focus(); return;
    }
    onAction(action); markBusy(action);
    if (e.detail) b.blur(); // pointer press: hand keys straight back to the game, like the other HUD buttons
  });
  // Keys used to operate the HUD must not also reach game key handlers that listen on the window bubble phase.
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!confirm.hidden) { e.preventDefault(); closeConfirm(true); }
      else if (isExpanded) { e.preventDefault(); setExpanded(false); toggle.focus(); }
      else e.target.blur?.();
      e.stopPropagation(); return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') e.stopPropagation();
  });
  box.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });

  function keyed(map, container, list, make, patch) {
    const want = new Set(list.map(x => x.key));
    for (const [k, node] of map) if (!want.has(k)) { node.remove(); map.delete(k); }
    let prev = null;
    for (const item of list) {
      let node = map.get(item.key);
      if (!node) { node = make(item); map.set(item.key, node); }
      const expected = prev ? prev.nextSibling : container.firstChild;
      if (node !== expected) container.insertBefore(node, expected); // only new nodes move in practice
      patch(node, item); prev = node;
    }
  }

  function renderActions() {
    const model = actionModel(view, ctx);
    const terminal = !RUNNING.includes(view.stage);
    // Collapsed: the one obvious next action. Expanded (or end screens): everything, Leave last.
    const primary = model.find(b => PRIMARY.includes(b.id));
    const shown = isExpanded ? model : model.filter(b => b.id === primary?.id || (terminal && b.id === 'leave'));
    const focused = [...buttons.entries()].find(([, n]) => n === document.activeElement)?.[0];
    keyed(buttons, actions, shown.map(b => ({...b, key: b.id})), b => {
      const n = el('button', 'xhud-btn'); n.type = 'button'; n.dataset.action = b.id;
      const short = el('span', 'xhud-btn-short', SHORT[b.id] || b.id); short.setAttribute('aria-hidden', 'true');
      n.append(icon(ACTION_ICON[b.id] || 'star', 16), el('span', 'xhud-btn-label'), short, el('span', 'xhud-btn-note'));
      return n;
    }, (n, b) => {
      setText(n.querySelector('.xhud-btn-label'), b.label); setText(n.querySelector('.xhud-btn-note'), b.note);
      n.classList.toggle('xhud-primary', b.id === primary?.id); n.classList.toggle('xhud-quiet', b.id === 'leave');
      setAttr(n, 'aria-disabled', b.blocked ? 'true' : null); setAttr(n, 'title', b.blocked ? `${b.label}: ${b.blocked}` : null);
      if (b.empty) n.dataset.empty = 'true'; else delete n.dataset.empty;
    });
    actions.hidden = !shown.length;
    if (focused && !buttons.has(focused)) toggle.focus(); // a focused action vanished (stage change): keep keyboard users in the HUD
  }

  function render() {
    const v = view, tone = TONE[v.stage] || '#f3e7d3', running = RUNNING.includes(v.stage);
    box.dataset.stage = v.stage; box.dataset.role = v.role; box.style.setProperty('--xhud-tone', tone);
    if (box.dataset.glyph !== stageIcon(v.stage)) { box.dataset.glyph = stageIcon(v.stage); stageGlyph.replaceChildren(icon(stageIcon(v.stage), 18)); }
    setText(title, v.title);
    if (roleBadge.dataset.role !== v.role) { roleBadge.dataset.role = v.role; roleBadge.replaceChildren(icon(v.role === 'god' ? 'god' : 'hero', 13), el('span', '', v.role === 'god' ? 'God' : 'Hero')); }
    setText(timer, running ? clock(v.elapsedSeconds) : '');
    setText(toggleHint, isExpanded ? 'Hide objectives' : 'Show all objectives');
    const leaveNote = leaveSentStage && leaveSentStage === v.stage && running ? 'Leave vote sent. A majority must agree. ' : '';
    if (leaveSentStage && leaveSentStage !== v.stage) leaveSentStage = '';
    setText(next, leaveNote + nextStep(v, ctx.held || null));

    // Collapsed progress chips: non-waived objectives, compact "icon have/need" with a hairline bar.
    const main = v.objectives.filter(o => !o.waived);
    keyed(chipNodes, chips, main.map(o => ({...o, key: o.id})), () => {
      const n = el('span', 'xhud-chip'); n.append(el('span', 'xhud-chip-icon'), el('span', 'xhud-chip-num'), el('span', 'xhud-chip-bar'));
      n.lastChild.append(el('span')); return n;
    }, (n, o) => {
      if (n.dataset.icon !== o.icon) { n.dataset.icon = o.icon; n.firstChild.replaceChildren(icon(o.icon, 14)); }
      n.dataset.done = String(o.done); n.dataset.mine = String(o.role === v.role || o.role === 'all');
      setText(n.children[1], o.done ? '✓' : o.id === 'flame' ? `${o.have}%` : `${o.have}/${o.need}`);
      setAttr(n, 'title', `${o.label}: ${o.done ? 'done' : `${o.have} of ${o.need}`}`);
      n.lastChild.firstChild.style.transform = `scaleX(${o.need ? Math.min(1, o.have / o.need) : 0})`;
    });
    chips.hidden = !main.length;

    // Telegraphs: always visible, even collapsed. Countdown is visual; the label is announced once per new warning.
    const tel = v.telegraphs.map(t => ({...t, key: `${t.kind}|${t.label}|${t.until ?? ''}`}));
    const fresh = tel.filter(t => !alertNodes.has(t.key));
    keyed(alertNodes, alerts, tel, t => {
      const n = el('p', 'xhud-alert'); n.append(icon(t.kind === 'star' ? 'star' : 'skull', 16), el('span', 'xhud-alert-label', t.label), el('span', 'xhud-alert-time'));
      n.lastChild.setAttribute('aria-hidden', 'true'); return n;
    }, (n, t) => setText(n.lastChild, `${t.secondsLeft}s`));
    alerts.hidden = !tel.length;
    if (fresh.length) setText(alertSay, fresh.map(t => t.label).join('. '));

    // Expanded body.
    const stageIndex = TRACK.findIndex(([s]) => s === v.stage);
    trackItems.forEach((li, i) => { li.dataset.state = v.stage === 'victory' || (stageIndex >= 0 && i < stageIndex) ? 'done' : i === stageIndex ? 'now' : 'todo'; setAttr(li, 'aria-current', i === stageIndex ? 'step' : null); });
    track.hidden = v.stage === 'idle';
    setText(notice, v.notice && v.notice !== v.title ? v.notice : ''); notice.hidden = !notice.textContent;
    const goalItems = v.objectives.map(o => ({...o, key: o.id, waived: !!o.waived}));
    const goalMake = () => { const li = el('li', 'xhud-goal'); li.append(el('span', 'xhud-goal-icon'), el('span', 'xhud-goal-label'), el('span', 'xhud-goal-who'), el('span', 'xhud-goal-num'), el('span', 'xhud-chip-bar')); li.lastChild.append(el('span')); return li; };
    const goalPatch = (li, o) => {
      if (li.dataset.icon !== o.icon) { li.dataset.icon = o.icon; li.firstChild.replaceChildren(icon(o.icon, 16)); }
      li.dataset.done = String(o.done); li.dataset.mine = String(o.role === v.role || o.role === 'all');
      setText(li.children[1], o.label); setText(li.children[2], o.role === 'god' ? 'God' : o.role === 'hero' ? 'Hero' : '');
      setText(li.children[3], o.done ? '✓' : `${o.have}/${o.need}`);
      li.lastChild.hidden = o.done || o.need <= 1; li.lastChild.firstChild.style.transform = `scaleX(${o.need ? Math.min(1, o.have / o.need) : 0})`;
    };
    // Separate keyed lists: when a God joins or leaves, waived flips and the row moves between them cleanly.
    keyed(goalNodes, goals, goalItems.filter(o => !o.waived), goalMake, goalPatch);
    const optItems = goalItems.filter(o => o.waived);
    keyed(optNodes, optional, optItems, goalMake, goalPatch);
    goals.hidden = !goals.childElementCount; optional.hidden = !optItems.length;
    const f = [];
    if (v.stage === 'idle' || !v.objectives.length) f.push(`Party: ${plural(v.party.heroes, 'Hero', 'Heroes')}, ${plural(v.party.gods, 'God')}`);
    if (v.role === 'god' && running) f.push(`God aid left: ${v.godSupportLeft}`, `Challenge budget: ${v.challengeLeft}`);
    if (v.stage === 'defeat') f.push(`Retries left: ${v.retriesLeft}`);
    if (v.renown) f.push(`Your renown: ${v.renown}`);
    setText(facts, f.join(' · ')); facts.hidden = !f.length;

    renderActions();
    if (!running && !confirm.hidden && v.stage === 'idle') closeConfirm(false);
  }

  return {
    element: box,
    update(nextView, nextCtx = {}) {
      const c = {held: nextCtx.held ? {wood: nextCtx.held.wood | 0, stone: nextCtx.held.stone | 0, gems: nextCtx.held.gems | 0} : undefined,
        mana: Number.isFinite(nextCtx.mana) ? Math.floor(nextCtx.mana) : undefined};
      const key = JSON.stringify([nextView, c]);
      if (key === last) return false;
      const prev = view; last = key; view = nextView; ctx = c;
      // A press stays "busy" until the authoritative view answers (or 1.2 s passes); timer-only ticks don't count.
      if (prev && busy.size) {
        const strip = x => JSON.stringify({...x, elapsedSeconds: 0, telegraphs: 0});
        if (strip(prev) !== strip(nextView)) for (const a of [...busy.keys()]) clearBusy(a);
      }
      if (prev && prev.stage !== nextView.stage) closeConfirm(false);
      render();
      return true;
    },
    setExpanded(v) { setExpanded(v); },
    destroy() { closeConfirm(false); for (const a of [...busy.keys()]) clearBusy(a); box.remove(); },
  };
}

// VR / world-space panel: draw into a 2D canvas context (e.g. 512x256 CanvasTexture). Returns true if redrawn.
const paths = {};
export function drawAdventurePanel(ctx, view, width = 512, height = 256, cache = {}) {
  const key = JSON.stringify(view);
  if (cache.key === key) return false; cache.key = key;
  const tone = TONE[view.stage] || '#fff', s = width / 512;
  ctx.save(); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(24,18,14,.88)'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = tone; ctx.fillRect(0, 0, width, 6 * s);
  const glyph = (name, x, y, size, color) => {
    paths[name] ||= new Path2D(ADVENTURE_ICONS[name]);
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.fillStyle = color; ctx.fill(paths[name], 'evenodd'); ctx.restore();
  };
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3e7d3'; ctx.font = `600 ${26 * s}px system-ui,sans-serif`;
  ctx.fillText(view.title, 16 * s, 30 * s, width - 32 * s);
  let y = 66 * s;
  ctx.font = `${20 * s}px system-ui,sans-serif`;
  for (const o of view.objectives.slice(0, 4)) {
    glyph(o.icon, 16 * s, y - 11 * s, 22 * s, o.done ? '#9be38a' : tone);
    ctx.globalAlpha = o.waived ? .5 : 1; ctx.fillStyle = '#f3e7d3';
    ctx.fillText(o.label, 46 * s, y, width - 150 * s);
    ctx.textAlign = 'right'; ctx.fillText(o.done ? '✓' : `${o.have}/${o.need}`, width - 16 * s, y); ctx.textAlign = 'left';
    ctx.globalAlpha = 1; y += 34 * s;
  }
  const t = view.telegraphs[0];
  if (t && y < height - 10 * s) { ctx.fillStyle = '#ffcf7a'; glyph(t.kind === 'star' ? 'star' : 'skull', 16 * s, y - 11 * s, 22 * s, '#ffcf7a'); ctx.fillText(`${t.label} — ${t.secondsLeft}s`, 46 * s, y, width - 62 * s); }
  ctx.restore();
  return true;
}
