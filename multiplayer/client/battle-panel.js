// Brann's Forge — Battle mode menu panel (view layer only).
// Owns no game, network or simulation state. The root calls update(model)
// whenever the battle snapshot changes (throttled is fine); DOM is built once and
// only text/attributes that changed are written. Clicks become onAction({action, side?}).
// The root routes {action:'side'} through the existing inventionSide control.

export const SIDE_NAME = Object.freeze({party: 'Dawn', rivals: 'Dusk'});
const BOT_CAP = 16;
const otherSide = side => (side === 'rivals' ? 'party' : 'rivals');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Pure: normalise the client model. Exported for tests.
export function normalizeBattle(m = {}) {
  const status = ['off', 'running', 'victory'].includes(m?.status) ? m.status : 'off';
  const bases = {party: null, rivals: null};
  for (const b of Array.isArray(m?.bases) ? m.bases : []) {
    if (!b || !(b.side in bases)) continue;
    const maxHp = Math.max(1, num(b.maxHp, 400));
    bases[b.side] = {hp: Math.max(0, Math.min(maxHp, Math.round(num(b.hp)))), maxHp};
  }
  return {
    status, isHost: m?.isHost === true, connected: m?.connected !== false,
    battleCompatible: m?.battleCompatible !== false,
    selfSide: m?.selfSide === 'rivals' ? 'rivals' : 'party',
    canChangeSide: m?.canChangeSide === true, expeditionActive: m?.expeditionActive === true,
    wave: Math.max(0, Math.floor(num(m?.wave))),
    nextWaveSeconds: Number.isFinite(Number(m?.nextWaveSeconds)) ? Math.max(0, Math.ceil(Number(m.nextWaveSeconds))) : null,
    bots: {party: Math.max(0, Math.floor(num(m?.bots?.party))), rivals: Math.max(0, Math.floor(num(m?.bots?.rivals)))},
    bases, winner: m?.winner === 'party' || m?.winner === 'rivals' ? m.winner : null,
  };
}

// Compact one-line status for the quest bar. Empty string when battle is off.
export function battleSummary(model) {
  const v = normalizeBattle(model);
  if (v.status === 'off') return '';
  const you = SIDE_NAME[v.selfSide];
  if (v.status === 'victory') {
    if (!v.winner) return 'Battle over';
    return `${SIDE_NAME[v.winner]} wins the battle · ${v.winner === v.selfSide ? 'Victory' : 'Defeat'}`;
  }
  const hp = side => (v.bases[side] ? `${v.bases[side].hp}` : '—');
  const next = v.nextWaveSeconds === null ? '' : ` · next ${v.nextWaveSeconds}s`;
  return `Battle (${you}) · Dawn ${hp('party')} vs Dusk ${hp('rivals')} · wave ${v.wave}${next}`;
}

const OBJECTIVE = 'Destroy the opposing sanctuary. Four soldiers join each side every 15 seconds, up to 16 per side. Fight enemy bots and defend your base; player-versus-player attacks are off.';
const BETA = 'Beta. Rooms hold up to 32 players plus up to 32 wave bots; smoothness depends on the host’s device.';

export function createBattlePanel({mount, onAction, doc = mount?.ownerDocument || document} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
  const setAttr = (n, k, v) => { if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
  const show = (n, on) => { if (n.hidden === on) n.hidden = !on; };
  const uid = Math.random().toString(36).slice(2, 8);

  // ---- static shell
  const root = el('section', 'menu-section bf-bt');
  const headingId = `bf-bt-h-${uid}`;
  root.setAttribute('aria-labelledby', headingId);
  const head = el('div', 'bf-bt-head');
  const h = el('h3', 'bf-bt-title', 'Battle mode'); h.id = headingId;
  const beta = el('span', 'bf-bt-beta', 'Beta');
  const pill = el('span', 'bf-bt-pill');
  head.append(h, beta, pill);

  const objective = el('p', 'hint bf-bt-objective', OBJECTIVE);
  const betaNote = el('p', 'bf-bt-note', BETA);

  // live stats
  const stats = el('div', 'bf-bt-stats');
  const waveLine = el('p', 'bf-bt-wave');
  stats.setAttribute('role', 'group'); stats.setAttribute('aria-label', 'Battle status');
  const sideRows = {};
  for (const side of ['party', 'rivals']) {
    const row = el('div', 'bf-bt-side'); row.dataset.side = side;
    const label = el('span', 'bf-bt-side-name', SIDE_NAME[side]);
    const you = el('span', 'bf-bt-you', 'You');
    const bots = el('span', 'bf-bt-bots');
    const meter = el('div', 'bf-bt-meter');
    meter.setAttribute('role', 'meter'); meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-label', `${SIDE_NAME[side]} sanctuary health`);
    const fill = el('span', 'bf-bt-fill'); meter.append(fill);
    const hp = el('span', 'bf-bt-hp');
    row.append(label, you, bots, meter, hp);
    stats.append(row);
    sideRows[side] = {row, you, bots, meter, fill, hp};
  }
  const live = el('p', 'bf-bt-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  stats.prepend(waveLine);

  // side chooser (everyone)
  const sideGroup = el('div', 'bf-bt-sides');
  sideGroup.setAttribute('role', 'group'); sideGroup.setAttribute('aria-label', 'Choose your side');
  const sideLabel = el('span', 'bf-bt-label', 'Your side');
  const sideBtns = {party: btn('btn bf-bt-sidebtn', 'Dawn'), rivals: btn('btn bf-bt-sidebtn', 'Dusk')};
  sideBtns.party.dataset.side = 'party'; sideBtns.rivals.dataset.side = 'rivals';
  const sideReason = el('p', 'bf-bt-reason'); sideReason.id = `bf-bt-sr-${uid}`;
  sideGroup.append(sideLabel, sideBtns.party, sideBtns.rivals);

  // host controls with inline two-step confirmation
  const hostBox = el('div', 'bf-bt-host');
  const primary = btn('btn bf-bt-primary');
  const secondary = btn('btn btn-quiet bf-bt-secondary');
  const hostReason = el('p', 'bf-bt-reason'); hostReason.id = `bf-bt-hr-${uid}`;
  const confirmBox = el('div', 'bf-bt-confirm'); confirmBox.setAttribute('role', 'alertdialog');
  const confirmText = el('p', 'bf-bt-confirm-text'); confirmText.id = `bf-bt-ct-${uid}`;
  confirmBox.setAttribute('aria-describedby', confirmText.id);
  confirmBox.setAttribute('aria-label', 'Confirm battle change');
  const confirmNo = btn('btn btn-quiet bf-bt-no');
  const confirmYes = btn('btn bf-bt-yes');
  const confirmRow = el('div', 'bf-bt-row'); confirmRow.append(confirmNo, confirmYes);
  confirmBox.append(confirmText, confirmRow);
  const hostRow = el('div', 'bf-bt-row'); hostRow.append(primary, secondary);
  hostBox.append(hostRow, hostReason, confirmBox);
  const guestNote = el('p', 'bf-bt-reason bf-bt-guest', 'The host controls Battle mode. You can choose your side.');

  root.append(head, objective, stats, live, sideGroup, sideReason, hostBox, guestNote, betaNote);
  mount?.append(root);

  // ---- state
  let view = normalizeBattle({});
  let pending = null;           // {action, label, text, danger} awaiting confirmation
  let primaryAction = null, secondaryAction = null, lastStatus = null, lastWinner = null, lastSide = null;

  const ACTIONS = {
    start: {label: 'Enable battle mode', confirm: 'Turn on Battle mode for everyone? Dawn and Dusk wave bots begin spawning. Expeditions can’t start while a battle runs.', yes: 'Enable', no: 'Not now', danger: false},
    stop: {label: 'Disable battle mode', confirm: 'End the battle for everyone? The battle stops for everyone and the world returns to adventure.', yes: 'End battle', no: 'Keep fighting', danger: true},
    reset: {label: 'Play again', confirm: 'Start a fresh battle? Both sanctuaries return to full health and waves restart.', yes: 'Restart', no: 'Cancel', danger: false},
  };

  function ask(action) {
    const a = ACTIONS[action];
    pending = action;
    setText(confirmText, a.confirm);
    setText(confirmYes, a.yes);
    setText(confirmNo, a.no);
    confirmYes.className = `btn ${a.danger ? 'btn-danger' : 'btn-primary'} bf-bt-yes`;
    paint();
    confirmNo.focus();          // safe default: Enter/Space on arrival cancels
  }
  function cancel(refocus = true) {
    if (!pending) return;
    pending = null; paint();
    if (refocus) primary.focus();
  }

  function paint() {
    const v = view, running = v.status === 'running', victory = v.status === 'victory', active = running || victory;
    root.dataset.status = v.status;
    setText(pill, running ? 'Running' : victory ? 'Battle over' : 'Off');

    // stats
    show(stats, active);
    if (active) {
      setText(waveLine, running
        ? `Wave ${v.wave}${v.nextWaveSeconds === null ? '' : ` · next in ${v.nextWaveSeconds}s`}`
        : v.winner ? `${SIDE_NAME[v.winner]} destroyed the ${SIDE_NAME[otherSide(v.winner)]} sanctuary.` : 'The battle has ended.');
      for (const side of ['party', 'rivals']) {
        const r = sideRows[side], b = v.bases[side];
        show(r.you, v.selfSide === side);
        setText(r.bots, `${Math.min(v.bots[side], BOT_CAP)}/${BOT_CAP} bots`);
        r.row.classList.toggle('is-winner', victory && v.winner === side);
        if (b) {
          setAttr(r.meter, 'aria-valuemax', String(b.maxHp));
          setAttr(r.meter, 'aria-valuenow', String(b.hp));
          setText(r.hp, `${b.hp}/${b.maxHp}`);
          const t = `scaleX(${b.hp / b.maxHp})`;
          if (r.fill.style.transform !== t) r.fill.style.transform = t;
        } else setText(r.hp, '—');
      }
    }
    // Announce only state transitions, not every countdown tick.
    if (v.status !== lastStatus || v.winner !== lastWinner || v.selfSide !== lastSide) {
      setText(live, victory ? (v.winner ? `${SIDE_NAME[v.winner]} wins the battle.` : 'The battle has ended.')
        : running ? `Battle mode is on. You fight for ${SIDE_NAME[v.selfSide]}.` : lastStatus ? 'Battle mode is off.' : '');
      lastStatus = v.status; lastWinner = v.winner; lastSide = v.selfSide;
    }

    // side chooser
    for (const side of ['party', 'rivals']) {
      const b = sideBtns[side], mine = v.selfSide === side;
      setAttr(b, 'aria-pressed', String(mine));
      b.classList.toggle('btn-secondary', mine);
      b.classList.toggle('btn-quiet', !mine);
      const blocked = !mine && (!v.canChangeSide || !v.connected);
      setAttr(b, 'aria-disabled', String(blocked));
      if (blocked) setAttr(b, 'aria-describedby', sideReason.id); else b.removeAttribute('aria-describedby');
    }
    const sideMsg = !v.connected ? 'Reconnecting… you can change sides once you’re back online.'
      : !v.canChangeSide ? 'Deposit carried resources and let your side’s forge finish refining, then switch sides.' : '';
    setText(sideReason, sideMsg);
    show(sideReason, !!sideMsg);

    // host controls
    show(hostBox, v.isHost);
    show(guestNote, !v.isHost);
    show(hostRow, !pending);
    show(confirmBox, !!pending);
    if (v.isHost) {
      primaryAction = v.status === 'off' ? 'start' : victory ? 'reset' : 'stop';
      secondaryAction = victory ? 'stop' : null;
      setText(primary, ACTIONS[primaryAction].label);
      primary.classList.toggle('btn-primary', primaryAction !== 'stop');
      primary.classList.toggle('btn-danger-quiet', primaryAction === 'stop');
      show(secondary, !!secondaryAction);
      if (secondaryAction) setText(secondary, 'Return to adventure');
      const reason = !v.battleCompatible ? 'Someone is using an older game version. Have everyone refresh before enabling Battle mode.'
        : !v.connected ? 'Reconnecting… battle controls return when the connection does.'
        : v.status === 'off' && v.expeditionActive ? 'An expedition is running. Finish or end it from the quest bar, then enable Battle mode.'
          : v.status === 'off' ? 'Adventure stays the default. Expeditions can’t run during a battle.' : '';
      const blocked = !v.connected || (!v.battleCompatible && primaryAction!=='stop') || (v.status === 'off' && v.expeditionActive);
      setAttr(primary, 'aria-disabled', String(blocked));
      setAttr(secondary, 'aria-disabled', String(!v.connected));
      if (blocked) setAttr(primary, 'aria-describedby', hostReason.id); else primary.removeAttribute('aria-describedby');
      setText(hostReason, reason);
      show(hostReason, !!reason);
      hostReason.classList.toggle('is-blocked', blocked);
    }
  }

  // ---- events
  const handlers = [
    [primary, 'click', () => { if (primary.getAttribute('aria-disabled') !== 'true' && primaryAction) ask(primaryAction); }],
    [secondary, 'click', () => { if (secondary.getAttribute('aria-disabled') !== 'true' && secondaryAction) ask(secondaryAction); }],
    [confirmNo, 'click', () => cancel()],
    [confirmYes, 'click', () => {
      const action = pending;
      if (!action) return;
      if(!view.isHost||!view.connected||(action!=='stop'&&!view.battleCompatible)||(action==='start'&&view.expeditionActive)){cancel();return;}
      pending = null; paint(); primary.focus();
      onAction?.({action});
    }],
    [confirmBox, 'keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } }],
    [sideGroup, 'click', e => {
      const b = e.target.closest?.('.bf-bt-sidebtn');
      if (!b || b.getAttribute('aria-disabled') === 'true' || b.dataset.side === view.selfSide) return;
      onAction?.({action: 'side', side: b.dataset.side});
    }],
  ];
  for (const [n, t, f] of handlers) n.addEventListener(t, f);

  function update(model) {
    const next = normalizeBattle(model);
    // A status/host/connection change invalidates whatever the host was about to confirm.
    if (pending && (next.status !== view.status || !next.isHost || !next.connected || (pending!=='stop'&&!next.battleCompatible) || (pending==='start'&&next.expeditionActive))) {
      const hadFocus = root.contains(doc.activeElement);
      pending = null; view = next; paint();
      if (hadFocus && next.isHost) primary.focus();
      return;
    }
    view = next; paint();
  }
  function dispose() {
    for (const [n, t, f] of handlers) n.removeEventListener(t, f);
    root.remove();
  }

  paint();
  return {update, dispose, element: root};
}
