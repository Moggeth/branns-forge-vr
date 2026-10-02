// Brann's Forge — lobby/HUD UI helpers (view layer only).
// Owns no game, session, network or simulation state. Every function either is
// pure (unit-tested in tests/lobby-ui.test.mjs) or binds DOM that index.html
// declares. Each binder returns a dispose() so lobby.js lifecycle stays in charge.

export const ONBOARD_KEY = 'branns-forge.onboarded';
export const SCHEMES = Object.freeze(['desktop', 'touch', 'vr']);

// ------------------------------------------------------------- errors
// Specific codes the network layer emits (client/network.js) that lobby.js's
// regex fallbacks describe wrongly or vaguely. Returns null when unknown so
// lobby.js's friendlyError() keeps its existing behaviour for everything else.
const CODE_TEXT = Object.freeze({
  room_full: 'That world already has eight players. Try again when someone leaves.',
  server_full: 'The forge is hosting as many worlds as it can right now. Wait a minute and try again.',
  room_not_found: 'We couldn’t find a world with that code. Check the digits with your friend.',
  invalid_role: 'That role isn’t available in this world. Pick Hero or God and try again.',
  invalid_token: 'Your rejoin pass expired. Join again with the room code — your world is safe.',
  offline: 'You’re offline. Reconnect to the internet, then try again.',
});
export function knownErrorText(code) {
  const key = String(code || '').toLowerCase();
  return Object.hasOwn(CODE_TEXT, key) ? CODE_TEXT[key] : null;
}

// ------------------------------------------------------------- control scheme
// Pick which controls card to show first. Inputs are plain values so this is testable.
export function detectControlScheme({xrPresenting = false, touchMode = 'auto', coarse = false, maxTouchPoints = 0} = {}) {
  if (xrPresenting) return 'vr';
  if (touchMode === 'on') return 'touch';
  if (touchMode === 'off') return 'desktop';
  return coarse || maxTouchPoints > 0 ? 'touch' : 'desktop';
}

export function describeVr({supported = null, secure = true, role = 'hero'} = {}) {
  if (supported === null) return 'Checking whether this browser can open a VR headset…';
  if (supported) return role === 'hero'
    ? 'VR is ready. Use Enter VR at the top of the screen.'
    : 'VR is ready for Heroes. Switch to Hero in the Menu to enter VR.';
  if (!secure) return 'VR needs a secure (https) page. Open the game from its https address to use a headset.';
  return 'No VR headset found in this browser. Use a WebXR browser such as the Quest Browser, or SteamVR with Chrome or Edge. Everything else works without VR.';
}

// ------------------------------------------------------------- objective banner
// Contract with the Expedition lead: {title, objective, progress, phase, canStart, canRestart}.
// progress: number in [0,1], or {current,total}, or null/undefined (hidden). Nothing else is inferred.
const PHASE_LABEL = Object.freeze({idle: 'Ready', ready: 'Ready', active: 'Under way', running: 'Under way', complete: 'Complete', won: 'Complete', failed: 'Failed', lost: 'Failed'});
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function normalizeObjective(data) {
  if (!data || typeof data !== 'object') return {visible: false};
  const title = clip(data.title, 48), objective = clip(data.objective, 140);
  const phaseKey = clip(data.phase, 24).toLowerCase();
  let fraction = null, progressText = '';
  const p = data.progress;
  if (typeof p === 'number' && Number.isFinite(p)) { fraction = Math.min(1, Math.max(0, p)); progressText = `${Math.round(fraction * 100)}%`; }
  else if (p && typeof p === 'object' && Number.isFinite(p.current) && Number.isFinite(p.total) && p.total > 0) {
    const current = Math.max(0, Math.min(p.total, p.current));
    fraction = current / p.total; progressText = `${Math.round(current)} / ${Math.round(p.total)}`;
  }
  return {
    visible: !!(title || objective),
    title, objective, phaseKey,
    phaseLabel: PHASE_LABEL[phaseKey] || (phaseKey ? phaseKey.replace(/^\w/, c => c.toUpperCase()) : ''),
    fraction, progressText,
    canStart: data.canStart === true, canRestart: data.canRestart === true,
  };
}

// Renders into #objectiveBanner. Pass null to hide. Writes only on change.
export function renderObjective(doc, data) {
  const root = doc.getElementById('objectiveBanner');
  if (!root) return null;
  const v = normalizeObjective(data);
  const set = (id, text) => { const el = doc.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
  root.hidden = !v.visible;
  if (!v.visible) return v;
  root.dataset.phase = v.phaseKey;
  set('objectiveTitle', v.title);
  set('objectivePhase', v.phaseLabel);
  set('objectiveText', v.objective);
  const bar = doc.getElementById('objectiveProgress');
  bar.parentElement.hidden = v.fraction === null;
  if (v.fraction !== null) {
    const pct = String(Math.round(v.fraction * 100));
    if (bar.getAttribute('aria-valuenow') !== pct) bar.setAttribute('aria-valuenow', pct);
    bar.setAttribute('aria-valuetext', v.progressText);
    doc.getElementById('objectiveProgressFill').style.transform = `scaleX(${v.fraction})`;
    set('objectiveProgressText', v.progressText);
  }
  doc.getElementById('objectiveStart').hidden = !v.canStart;
  doc.getElementById('objectiveRestart').hidden = !v.canRestart;
  return v;
}

// Start/Restart only forward the click; the owner decides what happens.
export function bindObjectiveActions(doc, {onStart, onRestart} = {}) {
  const pairs = [['objectiveStart', onStart], ['objectiveRestart', onRestart]]
    .map(([id, fn]) => [doc.getElementById(id), event => { event.currentTarget.blur(); fn?.(); }])
    .filter(([el]) => el);
  for (const [el, fn] of pairs) el.addEventListener('click', fn);
  return () => { for (const [el, fn] of pairs) el.removeEventListener('click', fn); };
}

// ------------------------------------------------------------- controls card / onboarding
export function bindControlsCard(doc, {store, scheme = () => 'desktop', role = () => 'hero'} = {}) {
  const card = doc.getElementById('controlsCard');
  if (!card) return {open() {}, close() {}, dispose() {}};
  const lobbyHost = doc.querySelector('#lobby .card'), menuHost = doc.querySelector('#menu .menu-card');
  const triggers = {lobby: doc.getElementById('howToPlay'), menu: doc.getElementById('menuControls')};
  const handlers = [];
  let openedFrom = null;
  const on = (el, type, fn) => { if (el) { el.addEventListener(type, fn); handlers.push([el, type, fn]); } };

  function show(which) {
    for (const tab of card.querySelectorAll('[data-controls-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.controlsTab === which));
    for (const panel of card.querySelectorAll('[data-controls-panel]')) panel.hidden = panel.dataset.controlsPanel !== which;
  }
  function open(from) {
    const host = from === 'menu' ? menuHost : lobbyHost, trigger = triggers[from];
    if (!host) return;
    // Move, never clone: ids stay unique and the menu's focus trap/inert rules cover it.
    if (card.parentElement !== host) trigger?.parentElement === host ? trigger.after(card) : host.append(card);
    openedFrom = from;
    card.dataset.activeRole = role();
    show(SCHEMES.includes(scheme()) ? scheme() : 'desktop');
    card.hidden = false;
    for (const t of Object.values(triggers)) t?.setAttribute('aria-expanded', String(t === trigger));
    doc.getElementById('controlsTitle')?.setAttribute('tabindex', '-1');
    doc.getElementById('controlsTitle')?.focus({preventScroll: false});
  }
  function close({restoreFocus = true} = {}) {
    if (card.hidden) return;
    card.hidden = true;
    const trigger = triggers[openedFrom];
    for (const t of Object.values(triggers)) t?.setAttribute('aria-expanded', 'false');
    try { store?.set(ONBOARD_KEY, '1'); } catch { /* private mode */ }
    doc.body.classList.remove('first-play');
    if (restoreFocus && trigger && trigger.getClientRects().length) trigger.focus({preventScroll: true});
    openedFrom = null;
  }
  const toggle = from => () => (card.hidden || openedFrom !== from ? open(from) : close());
  on(triggers.lobby, 'click', toggle('lobby'));
  on(triggers.menu, 'click', toggle('menu'));
  on(doc.getElementById('controlsClose'), 'click', () => close());
  on(doc.getElementById('controlsDone'), 'click', () => close());
  on(card, 'click', event => { const tab = event.target.closest('[data-controls-tab]'); if (tab) show(tab.dataset.controlsTab); });

  let firstPlay = false;
  try { firstPlay = !store?.get(ONBOARD_KEY); } catch { firstPlay = false; }
  doc.body.classList.toggle('first-play', firstPlay);
  return {open, close, get isOpen() { return !card.hidden; }, dispose() { for (const [el, t, fn] of handlers) el.removeEventListener(t, fn); }};
}

// ------------------------------------------------------------- connectivity hint
// Display-only: never blocks Create/Join (local saves and LAN hosts still work).
export function bindConnectivity(doc, win) {
  const note = doc.getElementById('offlineNote');
  if (!note || !win) return () => {};
  const render = () => { note.hidden = win.navigator?.onLine !== false; };
  win.addEventListener('online', render); win.addEventListener('offline', render);
  render();
  return () => { win.removeEventListener('online', render); win.removeEventListener('offline', render); };
}

// ------------------------------------------------------------- focus release
// A checkbox keeps focus after a mouse/touch toggle, and lobby.js + game.js both ignore
// key events whose target is an INPUT — so after clicking "Quick cast", spell keys and
// WASD silently stop working. Release focus after pointer toggles; keyboard users keep it.
export function releaseFocusAfterPointer(input) {
  if (!input) return () => {};
  const host = input.closest('label') || input;
  let pointer = false;
  const down = () => { pointer = true; };
  const change = () => { if (pointer) input.blur(); pointer = false; };
  const key = () => { pointer = false; };
  host.addEventListener('pointerdown', down); input.addEventListener('change', change); input.addEventListener('keydown', key);
  return () => { host.removeEventListener('pointerdown', down); input.removeEventListener('change', change); input.removeEventListener('keydown', key); };
}
