import {SPELLS} from './shared/spells.js';
import { createMobileControls } from './client/mobile-controls.js';
import './client/mobile-ui.css';
import { createGame } from './client/game.js';
import { WorldSession } from './client/session.js';
import { WorldSaves, parseSave } from './client/world-saves.js';
import { knownErrorText, detectControlScheme, describeVr, renderObjective, bindObjectiveActions, bindControlsCard, bindConnectivity, releaseFocusAfterPointer } from './lobby-ui.js';
import { adventureView } from './shared/adventure.js';
import { createAdventureBanner } from './client/adventure-view.js';

// ---------------------------------------------------------------- helpers
const $ = id => document.getElementById(id);
const body = document.body;
const canvas = $('world');
// Header controls wrap as room state and viewport width change.
const hudHeader = document.querySelector('.hud-top');
const hudHeaderObserver = new ResizeObserver(() => {
  const bottom = Math.ceil(hudHeader.getBoundingClientRect().bottom);
  if (bottom > 0) $('hud').style.setProperty('--hud-header-bottom', `${bottom}px`);
});
hudHeaderObserver.observe(hudHeader);
const NAME_KEY = 'branns-forge.player-name';
const ROLE_KEY = 'branns-forge.player-role';
const JOIN_TIMEOUT_MS = 15000;
const ROOM_PATTERN = /^\d{8}$/;

function peerEndpoint() {
  let configured = '';
  try { configured = import.meta.env.VITE_PEER_WS_URL || ''; } catch { /* not built with Vite */ }
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = location.port === '5178' ? ':8789' : location.port ? `:${location.port}` : '';
  return `${protocol}//${location.hostname}${port}/peer/ws`;
}

const store = {
  get(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

const setText = (el, text) => { const value = String(text); if (el.textContent !== value) el.textContent = value; };
const humanize = code => String(code || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());

// Turn whatever the network or simulation reports into a sentence a stranger understands.
function friendlyError(detail) {
  const code = String(detail?.code || '').toLowerCase();
  const raw = typeof detail?.message === 'string' ? detail.message : '';
  const known = knownErrorText(code); if (known) return known;
  if (/not.?found|unknown.?room|no.?room/.test(code)) return 'We couldn’t find a world with that code. Check the digits with your friend.';
  if (code === 'inventory_full') return 'Your supplies are full. Use some before collecting more.';
  if (code === 'insufficient_resources') return 'A bridge needs 3 wood. Chop a tree, then collect its logs.';
  if (/full/.test(code)) return 'That world already has eight players. Try again when someone leaves.';
  if (/rate|busy|limit/.test(code)) return 'The forge is busy right now. Wait a moment and try again.';
  if (/version|protocol/.test(code)) return 'Your page is out of date. Refresh the page and try again.';
  if (code === 'save_failed') return raw && raw.length < 140 ? raw : 'This browser couldn’t save the world. Download a backup from the Menu.';
  if (raw && raw.length < 140 && !/undefined|null|\bat\s+\S+:\d+/.test(raw)) return raw.replace(/^\w/, c => c.toUpperCase()).replace(/([^.!?])$/, '$1.');
  if (code) return `${humanize(code)}.`;
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------- state
let mobile = null, xrActive = false;
let game = null, session = null, rendererReady = false, rendererFailed = false;
let phase = 'lobby';          // lobby | connecting | game
let playerId = null, room = '', connected = false, menuOpen = false;
let appliedRole = null, currentRole = 'hero', spell = 'skeleton', vrSupported = false, vrChecked = false;
let lastAttempt = null, joinTimer = 0, lastSnapshot = null, snapshots = 0, inputs = 0;
let lastEvent = null, lastStatus = 'not connected', rendererStatus = 'starting', lastProblem = 'none';
const shown = {};             // cache of last rendered HUD values

// ---------------------------------------------------------------- lobby form
const nameInput = $('name');
const roomInput = $('room');
nameInput.value = store.get(NAME_KEY);
const savedRole = store.get(ROLE_KEY);
if (savedRole === 'god' || savedRole === 'hero') document.querySelector(`input[name="role"][value="${savedRole}"]`).checked = true;
const chosenRole = () => document.querySelector('input[name="role"]:checked')?.value || 'hero';

nameInput.addEventListener('change', () => store.set(NAME_KEY, nameInput.value.trim()));
for (const radio of document.querySelectorAll('input[name="role"]')) radio.addEventListener('change', () => store.set(ROLE_KEY, chosenRole()));

roomInput.addEventListener('input', () => {
  const digits = roomInput.value.replace(/\D/g, '').slice(0, 8);
  if (roomInput.value !== digits) roomInput.value = digits;
  roomInput.removeAttribute('aria-invalid');
  setText($('roomHelp'), 'Ask your friend for the 8-digit code shown in their game.');
});
roomInput.addEventListener('paste', event => {
  const pasted = event.clipboardData?.getData('text') || '';
  const digits = pasted.replace(/[\s-]/g, '');
  if (ROOM_PATTERN.test(digits)) { event.preventDefault(); roomInput.value = digits; roomInput.dispatchEvent(new Event('input')); }
});

const invited = (new URLSearchParams(location.search).get('room') || '').trim();
if (ROOM_PATTERN.test(invited)) {
  roomInput.value = invited;
  $('joinBlock').classList.add('invited');
  body.classList.add('has-invite');
  $('inviteNote').hidden = false;
  setText($('inviteNote'), 'You’ve been invited! Pick a name and role, then join.');
}

$('lobbyForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.submitter && document.activeElement === nameInput && !roomInput.value.trim()) { $('create').focus(); return; }
  joinFromForm();
});
$('create').addEventListener('click', () => start({create: true}));

function joinFromForm() {
  const code = roomInput.value.trim();
  if (!ROOM_PATTERN.test(code)) {
    roomInput.setAttribute('aria-invalid', 'true');
    setText($('roomHelp'), code ? 'A room code is exactly 8 digits.' : 'Enter the 8-digit code your friend shared.');
    roomInput.focus();
    return;
  }
  start({create: false, room: code});
}

// ---------------------------------------------------------------- saved worlds (lobby)
function refreshSavedWorlds() {
  const summary = $('savedSummary'), resume = $('resume');
  resume.hidden = true;
  let latest = null;
  try { latest = new WorldSaves().list()[0] || null; }
  catch (error) {
    setText(summary, friendlyError({message: error?.message}) + ' You can still open a world file.');
    return;
  }
  if (!latest) { setText(summary, 'No worlds saved in this browser yet. Worlds save themselves while you play.'); return; }
  const when = new Date(latest.savedAt);
  const stamp = isNaN(when) ? '' : ` · saved ${when.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}`;
  setText(summary, `${latest.name}${stamp}`);
  setText(resume, `Resume ${latest.name}`);
  resume.hidden = false;
}
$('savedWorlds').addEventListener('toggle', () => { if ($('savedWorlds').open) refreshSavedWorlds(); });
$('resume').addEventListener('click', () => {
  try {
    const save = new WorldSaves().list()[0];
    if (!save) { refreshSavedWorlds(); return; }
    start({create: true, save});
  } catch (error) { showLobbyProblem(friendlyError({message: error?.message}), {back: true}); }
});
$('import').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('World files must be smaller than 2 MB.');
    const save = parseSave(await file.text());
    start({create: true, save});
  } catch (error) { showLobbyProblem(error?.message ? friendlyError({message: error.message}) : 'That file isn’t a Brann’s Forge world.', {back: true}); }
});

// ---------------------------------------------------------------- lobby status panel
function showLobbyStatus(text, {busy = false, retry = false, back = false, cancel = false} = {}) {
  const panel = $('lobbyStatus');
  panel.hidden = false;
  panel.classList.toggle('busy', busy);
  panel.classList.toggle('problem', !busy);
  setText($('lobbyStatusText'), text);
  $('statusRetry').hidden = !retry;
  $('statusBack').hidden = !back;
  $('statusCancel').hidden = !cancel;
  body.classList.toggle('lobby-busy', busy);
  $('lobbyForm').inert = busy;
}
function showLobbyProblem(text, {retry = false, back = true} = {}) {
  showLobbyStatus(text, {retry, back});
  ($('statusRetry').hidden ? $('statusBack') : $('statusRetry')).focus({preventScroll: true});
}
function hideLobbyStatus() { $('lobbyStatus').hidden = true; body.classList.remove('lobby-busy'); $('lobbyForm').inert = false; }
$('statusRetry').addEventListener('click', () => { if (lastAttempt) start(lastAttempt); });
$('statusBack').addEventListener('click', () => { hideLobbyStatus(); (lastAttempt?.create === false ? roomInput : $('create')).focus(); });
$('statusCancel').addEventListener('click', () => { teardown(); hideLobbyStatus(); setPhase('lobby'); });

// ---------------------------------------------------------------- phases
function setPhase(next) {
  phase = next;
  body.dataset.phase = next;
  $('lobby').hidden = next === 'game';
  $('hud').hidden = next !== 'game';
  if (next !== 'game') closeMenu(false);
  if (next === 'game') controlsCard?.close({restoreFocus: false});
  syncActive();
}
function syncActive() {
  game?.setActive(phase === 'game' && connected && !menuOpen);
  mobile?.update({active:phase === 'game' && connected && !menuOpen,role:currentRole,xr:xrActive});
  updateLookHint();
}

// ---------------------------------------------------------------- connection
function teardown() {
  clearTimeout(joinTimer);
  game?.setActive(false);
  const old = session; session = null;
  try { old?.dispose(); } catch (error) { console.warn('Session cleanup failed', error); }
  connected = false; playerId = null; appliedRole = null; lastSnapshot = null;
  expeditionBanner?.element.remove(); expeditionBanner = null; game?.setExpedition(null);
  clearNotices();
}

function start(attempt) {
  if (rendererFailed || !game) {
    showLobbyProblem('This browser couldn’t start the 3D world. Try a recent version of Chrome, Edge or Firefox.', {back: true});
    return;
  }
  teardown();
  lastAttempt = attempt;
  const name = nameInput.value.trim() || 'Wanderer';
  store.set(NAME_KEY, nameInput.value.trim());
  const role = chosenRole();
  currentRole = role;
  snapshots = 0; inputs = 0;

  let next;
  try { next = session = new WorldSession({url: peerEndpoint()}); }
  catch (error) { recordProblem(error); showLobbyProblem('We couldn’t open a connection to the forge. Please try again in a moment.', {retry: true}); return; }

  const mine = handler => event => { if (session === next) handler(event.detail); };
  next.addEventListener('welcome', mine(onWelcome));
  next.addEventListener('status', mine(onStatus));
  next.addEventListener('snapshot', mine(onSnapshot));
  next.addEventListener('event', mine(detail => { lastEvent = detail; game?.handleEvent(detail); }));
  next.addEventListener('error', mine(onSessionError));
  next.addEventListener('hosting', mine(() => { refreshHostControls(); }));
  next.addEventListener('host_changed', mine(() => { refreshHostControls(); }));
  next.addEventListener('saved', mine(() => {}));
  next.addEventListener('owner_lost', mine(detail => notice('owner', detail.recoverySaved
    ? 'The host left. A recovery copy is saved in this browser.'
    : 'The host left. A recovery copy could not be saved in this browser. Keep this tab open; use Menu to download a backup if available.', null, detail.recoverySaved ? 'info' : 'warn')));
  next.addEventListener('continue_world_offer', mine(() => {
    removeNotice('waiting');
    notice('continue', 'The host has gone. You can keep this world running from your computer.', {label: 'Continue world here', run: () => { try { session?.continueWorld(); } catch (e) { onSessionError({message: e?.message}); } removeNotice('continue'); }}, 'action');
  }));
  next.addEventListener('continue_offer_expired', mine(() => removeNotice('continue')));
  next.addEventListener('world_waiting', mine(() => {
    removeNotice('continue');
    notice('waiting', 'Waiting for someone to host this world again. The world is paused until then.', {label: 'Try hosting it here', run: () => { try { session?.retryWorld(); } catch (e) { onSessionError({message: e?.message}); } removeNotice('waiting'); }}, 'action');
  }));
  next.addEventListener('peer_connection_state', mine(detail => {
    if (detail?.state === 'failed') notice('relay', 'We couldn’t link directly to another player. Some networks (school, work or mobile) block this, and this preview has no relay server to route around it. Try a home network or have that player host.', null, 'warn');
    else if (detail?.state === 'connected') removeNotice('relay');
  }));

  phase = 'connecting'; body.dataset.phase = 'connecting';
  const verb = attempt.save ? `Bringing back ${attempt.save.name || 'your world'}…` : attempt.create ? 'Lighting the forge for a new world…' : `Looking for world ${attempt.room}…`;
  showLobbyStatus(verb, {busy: true, cancel: true});

  joinTimer = setTimeout(() => {
    if (session !== next || lastSnapshot) return;
    teardown();
    setPhase('lobby');
    showLobbyProblem(attempt.create
      ? 'The forge didn’t answer in time. Check your internet connection and try again.'
      : 'We couldn’t reach that world in time. It may have closed, or the code may be wrong.', {retry: true});
  }, JOIN_TIMEOUT_MS);

  try {
    next.connect({save: attempt.save || null, room: attempt.create ? '' : attempt.room, name, role,
      desktop: !(/OculusBrowser|Quest|Mobile/i.test(navigator.userAgent))});
  } catch (error) {
    recordProblem(error);
    teardown(); setPhase('lobby');
    showLobbyProblem(attempt.save ? 'That saved world couldn’t be loaded. It may be damaged — try another file.' : 'We couldn’t start the connection. Please try again.', {retry: !attempt.save});
  }
}

function onWelcome(detail) {
  playerId = detail.peerId;
  room = String(detail.room || '');
  const url = new URL(location.href);
  url.search = ''; url.searchParams.set('room', room);
  try { history.replaceState(null, '', url); } catch { /* sandboxed */ }
  roomInput.value = ROOM_PATTERN.test(room) ? room : roomInput.value;
  setText($('hudRoom'), room); setText($('menuRoom'), room);
  setText($('hudName'), nameInput.value.trim() || 'Wanderer');
  hideLobbyStatus();
  setPhase('game');
  notice('loading', 'Gathering the world…', null, 'info');
  refreshHostControls();
}

const STATUS_TEXT = {
  connecting: 'Connecting…',
  reconnecting: 'Connection dropped — reconnecting you now…',
  disconnected: 'You’ve been disconnected from this world.',
  closed: 'This world’s connection closed.',
};
function onStatus(detail) {
  const state = String(detail?.state || '');
  lastStatus = state || 'unknown';
  connected = state === 'connected' || state === 'hosting';
  syncActive();
  if (phase === 'connecting' && !playerId && state === 'closed') {
    teardown(); setPhase('lobby');
    showLobbyProblem('We couldn’t reach the forge. Check your internet connection and try again.', {retry: true});
    return;
  }
  if (phase !== 'game') return;
  if (connected) { for (const id of ['net','owner','waiting','continue','relay']) removeNotice(id); return; }
  if (state === 'reconnecting' || state === 'connecting') notice('net', STATUS_TEXT[state], null, 'info');
  else if (state === 'disconnected' || state === 'closed') {
    notice('net', `${STATUS_TEXT[state]} Your progress is saved in this browser.`, {label: 'Rejoin', run: () => { const code = room; setPhase('lobby'); start({create: false, room: code}); }}, 'warn');
  }
}

function onSessionError(detail) {
  recordProblem(detail);
  const message = friendlyError(detail);
  if (phase === 'connecting' && !playerId) {
    teardown(); setPhase('lobby');
    showLobbyProblem(message, {retry: true});
  } else if (phase === 'game') toast(message);
}

function recordProblem(problem) {
  const text = problem?.code ? `${problem.code}: ${problem.message ?? ''}` : (problem?.message || String(problem));
  lastProblem = text.slice(0, 300);
  console.warn('[Brann’s Forge]', problem);
}

// ---------------------------------------------------------------- Forge Expedition (optional co-op run, shared/adventure.js)
let expeditionBanner = null;
function expeditionAction(action) {
  const snap = lastSnapshot, adv = snap?.adventure, self = snap?.players.find(p => p.id === playerId);
  if (!session || !adv || !self) return;
  const send = payload => session.command('adventure', payload);
  if (action === 'start' || action === 'rematch') return void send({action: 'start'});
  if (action === 'retry' || action === 'leave') return void send({action});
  if (action === 'deposit') {
    // One message per carried kind the current stage can use; the simulation takes only what is still needed.
    const kinds = adv.stage === 'camp' ? ['wood', 'stone'] : adv.stage === 'star' ? ['gems'] : ['wood', 'stone', 'gems'];
    const carried = kinds.filter(k => (self.resources?.[k] || 0) > 0);
    if (!carried.length) return void toast(adv.stage === 'star' ? 'Mine star shards with the pick, then bring the gems to the forge.' : 'Gather timber or stone first, then bring it to the forge.');
    for (const kind of carried) send({action: 'deposit', kind, amount: Math.min(99, self.resources[kind])});
    return;
  }
  if (action === 'tithe') {
    const kind = adv.stage === 'camp' ? (adv.stock.wood / Math.max(1, adv.need.wood) <= adv.stock.stone / Math.max(1, adv.need.stone) ? 'wood' : 'stone') : undefined;
    return void send(kind ? {action, kind} : {action});
  }
  if (action === 'lodestar') { const star = adventureView(adv, snap, playerId).star; if (star) send({action, point: [star.x, 0, star.z]}); }
}

// ---------------------------------------------------------------- snapshots → HUD (text only, never re-rendered)
function onSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return;
  clearTimeout(joinTimer);
  lastSnapshot = snapshot; snapshots++;
  if (snapshots === 1) removeNotice('loading');
  const self = snapshot.players.find(player => player.id === playerId);
  if (self) {
    const waitSeconds = Number.isFinite(self.roleTick) ? Math.max(0, Math.ceil((120 - (snapshot.tick - self.roleTick)) / 60)) : 0;
    for (const radio of document.querySelectorAll('input[name="menuRole"]')) {
      // Selection reflects the accepted role, including rejected/late commands.
      radio.checked = radio.value === self.role;
      radio.disabled = radio.value !== self.role && waitSeconds > 0;
    }
    setText($('roleSwitchHint'), waitSeconds > 0
      ? `You can switch roles again in ${waitSeconds} second${waitSeconds === 1 ? '' : 's'}.`
      : 'Switching releases any held attack, drawn bow or pending line cast.');
  }
  if (self && self.role && self.role !== appliedRole) {
    appliedRole = self.role; currentRole = self.role;
    if (session?.identity) session.identity.role = self.role;
    game.setRole(self.role);
    applyRoleUi(self.role);
  }
  try { game.applySnapshot(snapshot, playerId); } catch (error) { recordProblem(error); }
  if (snapshot.adventure) try {
    const view = adventureView(snapshot.adventure, snapshot, playerId);
    if (!expeditionBanner) { expeditionBanner = createAdventureBanner($('hud'), {onAction: expeditionAction}); expeditionBanner.element.style.top = 'calc(var(--hud-header-bottom, 56px) + 10px)'; }
    expeditionBanner.update(view);
    // DOM is invisible in WebXR: the same view drives the in-world wrist panel (it repaints only when its model changes).
    if (xrActive) game.setExpedition(view, snapshot, playerId);
  } catch (error) { recordProblem(error); }
  else if (xrActive) game.setExpedition(null);

  const count = `${snapshot.players.length} of ${snapshot.maxPlayers ?? 8} here`;
  if (shown.players !== count) { shown.players = count; setText($('hudPlayers'), count); }
  if (self) {
    setText($('resources'), `Wood ${self.resources?.wood||0} · Stone ${self.resources?.stone||0} · Gems ${self.resources?.gems||0}`);
    for(const b of document.querySelectorAll('[data-equip]'))b.setAttribute('aria-pressed',String(b.dataset.equip===(self.tool||'axe')));
    const weaponText={axe:'Axe · click to chop · Q power cleave',pick:'Stonewhisper · click to mine · Q resonance',hammer:'Sunfall · click to strike · Q ground slam',crossbow:'Siegebird · click to fire · unlimited bolts',bow:'Emberwing · hold attack to draw, release to fire · Q then aim to curve',limb:'Bone · click to strike · G drop · X throw',wyrmspout:`Wyrmspout · hold attack: flame · Q: vent · Heat ${Math.round((self.heat||0)*100)}%${self.overheatUntil>snapshot.tick?' · Cooling':''}`,flask:`Emberdew · attack: toss fuel · Q: ${self.flaskLit?'extinguish':'light'} wick · ${self.flaskLit?'LIT':'unlit'}`}[self.tool||'axe'];if($('weaponHint'))setText($('weaponHint'),weaponText);
    meter('hp', self.hp, self.maxHp ?? self.hpMax ?? self.maxHealth ?? 100);
    meter('mana', self.mana, self.maxMana ?? self.manaMax ?? 100);
  }
  if (snapshots % 15 === 0) refreshHostControls();
  if (menuOpen && $('techDetails').open && snapshots % 10 === 0) renderTech();
}

function meter(kind, value, max) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const m = Number(max) > 0 ? Number(max) : null;
  const key = `${v}/${m}`;
  if (shown[kind] === key) return;
  shown[kind] = key;
  setText($(`${kind}Text`), m ? `${v} / ${Math.round(m)}` : String(v));
  const fill = $(`${kind}Fill`);
  fill.parentElement.hidden = !m;
  if (m) fill.style.transform = `scaleX(${Math.min(1, v / m)})`;
}

function applyRoleUi(role) {
  body.dataset.role = role;
  setText($('hudRole'), role === 'god' ? 'God' : 'Hero');
  $('hudRoleUse').setAttribute('href', role === 'god' ? '#i-god' : '#i-hero');
  for (const radio of document.querySelectorAll('input[name="menuRole"]')) radio.checked = radio.value === role;
  $('vr').hidden = !(vrSupported && role === 'hero');
  setText($('vrNote'), describeVr({supported: vrChecked ? vrSupported : null, secure: window.isSecureContext !== false, role}));
  if (role !== 'hero' && document.pointerLockElement === canvas) document.exitPointerLock?.();
  mobile?.update({active:phase === 'game' && connected && !menuOpen,role:currentRole,xr:xrActive});
  updateLookHint();
}

function isHost() { return !!session?.simulation; }
function refreshHostControls() {
  const host = isHost();
  $('resetArea').hidden = !host;
  $('resetNote').hidden = host;
  if (!host) $('resetConfirm').hidden = true;
}

// ---------------------------------------------------------------- notices & toast
function notice(id, text, action, tone = 'info') {
  let el = document.querySelector(`[data-notice="${id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'notice';
    el.dataset.notice = id;
    el.setAttribute('role', tone === 'warn' || tone === 'action' ? 'alert' : 'status');
    const p = document.createElement('p'); el.append(p);
    $('notices').append(el);
  }
  el.dataset.tone = tone;
  setText(el.querySelector('p'), text);
  el.querySelector('button')?.remove();
  if (action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-primary';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    el.append(button);
  }
}
function removeNotice(id) { document.querySelector(`[data-notice="${id}"]`)?.remove(); }
function clearNotices() { $('notices').replaceChildren(); }

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  setText(el, text);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

// ---------------------------------------------------------------- clipboard (user-initiated only)
function inviteUrl() {
  const url = new URL(location.href);
  url.search = ''; url.hash = '';
  url.searchParams.set('room', room);
  return url.href;
}
async function copy(text, button, doneLabel) {
  const original = button.dataset.label || (button.dataset.label = button.textContent);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.className = 'visually-hidden';
    document.body.append(area); area.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
  }
  if (ok) {
    button.textContent = doneLabel; button.classList.add('copied');
    setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1800);
  } else toast(`Couldn’t copy automatically. Share this: ${text}`);
}
$('copyCode').addEventListener('click', e => copy(room, e.currentTarget, 'Copied!'));
$('copyInvite').addEventListener('click', e => copy(inviteUrl(), e.currentTarget, 'Link copied!'));
$('menuCopyCode').addEventListener('click', e => copy(room, e.currentTarget, 'Copied!'));
$('menuCopyInvite').addEventListener('click', e => copy(inviteUrl(), e.currentTarget, 'Link copied!'));

// ---------------------------------------------------------------- menu
function openMenu() {
  if (phase !== 'game' || menuOpen) return;
  menuOpen = true;
  if (document.pointerLockElement) document.exitPointerLock?.();
  refreshHostControls();
  for (const radio of document.querySelectorAll('input[name="menuRole"]')) radio.checked = radio.value === currentRole;
  $('resetConfirm').hidden = true;
  $('menu').hidden = false;
  $('hud').inert = true;
  body.classList.add('menu-open');
  syncActive();
  renderTech();
  $('resumePlay').focus();
}
function closeMenu(focusCanvas = true) {
  if (!menuOpen) return;
  menuOpen = false;
  $('menu').hidden = true;
  $('hud').inert = false;
  body.classList.remove('menu-open');
  syncActive();
  if (focusCanvas && phase === 'game') $('menuButton').focus({preventScroll: true});
}
$('menuButton').addEventListener('click', openMenu);
$('resumePlay').addEventListener('click', () => closeMenu());
$('menu').addEventListener('click', event => { if (event.target === $('menu')) closeMenu(); });
function trapMenuFocus(event) {
  if (event.key !== 'Tab') return;
  const focusable = [...$('menu').querySelectorAll('button,input,select,summary,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
}
$('leave').addEventListener('click', () => {
  teardown();
  room = '';
  try { const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url); } catch { /* ignore */ }
  setPhase('lobby');
  hideLobbyStatus();
  $('create').focus();
});

for (const radio of document.querySelectorAll('input[name="menuRole"]')) radio.addEventListener('change', () => {
  if (!radio.checked) return;
  const role = radio.value;
  store.set(ROLE_KEY, role);
  const lobbyRadio = document.querySelector(`input[name="role"][value="${role}"]`);
  if (lobbyRadio) lobbyRadio.checked = true;
  if (!session?.command('role', {role})) toast('You can switch roles once you’re connected.');
  else toast(role === 'god' ? 'Rising to the heavens…' : 'Descending to the land…');
});

$('download').addEventListener('click', () => {
  try {
    if (!session) throw new Error('Join a world first.');
    const blob = new Blob([JSON.stringify(session.exportSave())], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `branns-forge-world-${room || 'backup'}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) {
    recordProblem(error);
    toast(/checkpoint/i.test(error?.message || '') ? 'The world is still arriving — try again in a moment.' : friendlyError({message: error?.message}));
  }
});
$('reset').addEventListener('click', () => { $('resetConfirm').hidden = false; $('resetNo').focus(); });
$('resetNo').addEventListener('click', () => { $('resetConfirm').hidden = true; $('reset').focus(); });
$('resetYes').addEventListener('click', () => {
  try { session?.resetWorld(); $('resetConfirm').hidden = true; closeMenu(); toast('The world has been reset. A recovery copy was saved.'); }
  catch (error) { recordProblem(error); refreshHostControls(); toast(friendlyError({message: error?.message})); }
});

function renderTech() {
  setText($('techConnection'), lastStatus);
  setText($('techRenderer'), rendererStatus);
  const s = lastSnapshot;
  setText($('techMetrics'), s ? `tick ${s.tick} · players ${s.players?.length}/${s.maxPlayers} · enemies ${s.enemies?.length ?? 0} · edits ${s.edits?.length ?? 0} · groves ${s.groves?.length ?? 0} · snapshots ${snapshots} · inputs ${inputs} · host ${isHost() ? 'you' : 'other'}` : 'no snapshot yet');
  setText($('techEvent'), lastEvent ? `${lastEvent.kind || 'event'} at ${(lastEvent.position || []).map(v => Number(v).toFixed(1)).join(', ')}` : 'none');
  setText($('techError'), lastProblem);
}
$('techDetails').addEventListener('toggle', renderTech);

// ---------------------------------------------------------------- spells
function chooseSpell(next) {
  spell = next;
  const spec=SPELLS.find(s=>s.id===next);if($('spellHint')&&spec)setText($('spellHint'),`${spec.label} · ${spec.cost} mana · ${spec.target==='line'?'Drag a line; on touch, Cast start then Cast end':'Aim, then cast'}`);
  try { game?.setSpell(next); } catch (error) { recordProblem(error); }
  for (const button of document.querySelectorAll('[data-spell]')) {const selected=button.dataset.spell===next;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
}
for (const button of document.querySelectorAll('[data-spell]')) button.addEventListener('click', () => { chooseSpell(button.dataset.spell); button.blur(); });
document.querySelector('.bf-spells')?.addEventListener('keydown',event=>{
  const buttons=[...document.querySelectorAll('[data-spell]')],index=buttons.indexOf(event.target);
  if(index<0||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?buttons.length-1:1))%buttons.length;
  chooseSpell(buttons[next].dataset.spell);buttons[next].focus();buttons[next].scrollIntoView({block:'nearest',inline:'nearest'});
});

for(const button of document.querySelectorAll('[data-equip]'))button.addEventListener('click',()=>{game?.equip(button.dataset.equip);button.blur();});
$('collect').addEventListener('click',()=>{game?.interact();$('collect').blur();});
$('bridge').addEventListener('click',()=>{game?.buildBridge();$('bridge').blur();});
for(const [id,method] of [['special','special'],['grab','grab'],['drop','release']])$(id)?.addEventListener('click',()=>{game?.[method]();$(id).blur();});
$('throw')?.addEventListener('click',()=>{game?.release(true);$('throw').blur();});
$('quickCast')?.addEventListener('change',()=>game?.setQuickCast($('quickCast').checked));
releaseFocusAfterPointer($('quickCast'));
// ---------------------------------------------------------------- keyboard & pointer
const isTyping = target => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
// Capture phase on window runs before the game's listeners: typing never moves your hero.
for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, event => {
  if (isTyping(event.target) || phase !== 'game' || menuOpen) {
    if (type === 'keydown' && menuOpen) trapMenuFocus(event);
    if (type === 'keydown' && event.key === 'Escape' && menuOpen) { event.preventDefault(); closeMenu(); }
    if (isTyping(event.target) || menuOpen || phase !== 'game') event.stopPropagation();
    return;
  }

}, true);

// game.js owns the canvas pointer-lock gesture; duplicate requests can race.
document.addEventListener('pointerlockchange', updateLookHint);
function updateLookHint() {
  $('lookHint').hidden = !(phase === 'game' && connected && !menuOpen && currentRole === 'hero' && document.pointerLockElement !== canvas && !xrActive && !mobile?.enabled);
}

$('vr').addEventListener('click', async () => {
  try { await game.enterVR(); }
  catch (error) { recordProblem(error); toast('VR couldn’t start. Make sure your headset is connected and awake, then try again.'); }
});

// ---------------------------------------------------------------- startup
window.addEventListener('error', event => { recordProblem(event.error || {message: event.message}); });
window.addEventListener('unhandledrejection', event => { recordProblem(event.reason); event.preventDefault(); });

try {
  game = createGame({
    canvas,
    isHost, onSelection: chooseSpell,
    onAction: (action, details = {}) => action==='projectileHit'?session?.projectileContact(details):session?.command('action', {action, ...details}),
    onCast: (chosen, point, details={}) => session?.command('cast', {spell: chosen, point,...details}),
    onInput: input => { if (session?.command('input', input)) inputs++; },
    onStatus: status => { rendererStatus = String(status); },
    onXRChange: value => { xrActive = value; if (!value) game?.setExpedition(null); body.classList.toggle('xr',value); syncActive(); },
    onMenu: openMenu,
    onExpeditionAction: expeditionAction,
  });
  game.setExpeditionPointerHand(store.get('branns-forge.vr.pointerHand') === 'left' ? 'left' : 'right');
  mobile = createMobileControls({game,canvas,onMenu:openMenu,notify:toast,onChange:updateLookHint});
  rendererReady = true;
  game.setActive(false);
  chooseSpell(spell);game.setQuickCast($('quickCast')?.checked||false);
  Promise.resolve().then(() => game.canVR()).then(supported => {
    vrSupported = !!supported; vrChecked = true;
    applyRoleUi(currentRole);
  }).catch(() => { vrSupported = false; vrChecked = true; applyRoleUi(currentRole); });
} catch (error) {
  rendererFailed = true;
  recordProblem(error);
  showLobbyProblem('This browser couldn’t start the 3D world. Try a recent version of Chrome, Edge or Firefox with hardware acceleration on.', {back: false});
  $('create').disabled = true; $('join').disabled = true;
}

const controlsCard = bindControlsCard(document, {store,
  role: () => phase === 'game' ? currentRole : chosenRole(),
  scheme: () => detectControlScheme({xrPresenting: xrActive, touchMode: store.get('branns-forge.touch.mode') || 'auto', coarse: matchMedia('(any-pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints || 0})});
bindConnectivity(document, window);
// Expedition integration point: the owning module assigns these; buttons stay hidden unless canStart/canRestart.
export const objectiveHooks = {onStart: null, onRestart: null};
bindObjectiveActions(document, {onStart: () => objectiveHooks.onStart?.(), onRestart: () => objectiveHooks.onRestart?.()});
export const setObjective = data => renderObjective(document, data);
applyRoleUi(chosenRole());
setPhase('lobby');
if (ROOM_PATTERN.test(invited)) (nameInput.value ? $('join') : nameInput).focus({preventScroll: true});

window.addEventListener('beforeunload', () => { try { hudHeaderObserver.disconnect(); mobile?.dispose(); game?.dispose(); session?.dispose(); } catch { /* closing */ } });

// Read-only diagnostic evidence for browser QA; excludes reconnect credentials.
window.brannHarness = Object.freeze({
  state: () => ({phase, connected, menuOpen, controlsActive: phase === 'game' && connected && !menuOpen, touch:mobile?.enabled, xr:xrActive, playerId, role: appliedRole, snapshots, inputs, lastEvent, rendererReady, host: isHost()}),
  controls: () => game?.controlsSnapshot(),
  snapshot: () => lastSnapshot ? structuredClone(lastSnapshot) : null,
});
