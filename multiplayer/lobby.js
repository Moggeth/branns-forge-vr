import {ProximityVoice} from './client/proximity-voice.js';
import {createVoiceControls} from './client/voice-controls.js';
import {mountQuietHud} from './mobile-quiet.js';
import {createFieldOverlays,createBuildTag} from './client/field-overlays.js';
import {equipmentHelp} from './client/equipment-help.js';
import {bindHoldOverlays} from './client/hold-overlays.js';
import './client/field-overlays.css';
import {createMenuTabs} from './mobile-compact.js';
import {RESOURCE_RECIPES} from './shared/resources.js';
import {settlementView} from './shared/resources.js';
import {spellbookReadiness} from './client/ability-readiness.js';
import {spellUnavailable} from './client/spell-availability.js';
import {actionError} from './client/action-feedback.js';
import {createCallouts} from './client/callouts.js';
import './client/callouts.css';
import './client/hotbar.css';
import './client/resource-bar.css';
import {createResourceBar} from './client/resource-bar.js';
import {createSpellbook} from './client/spellbook.js';
import {createInventionPanel} from './client/invention-panel.js';
import {createQuickBuild} from './client/quick-build.js';
import './client/quick-build.css';
import {createRunHud,createRunLauncher,nextRunOptions} from './client/run-panel.js';
import {runWristView,runVrAction} from './client/run-vr.js';
import './client/run-panel.css';
import {inventionView} from './shared/inventions.js';
import './client/invention-panel.css';
import './client/spellbook.css';
import './client/forge-panel.css';
import {SPELLS,SPELL_SCHOOLS} from './shared/spells.js';
import {BLOOM,bloomLevel,nextBloom} from './shared/bloom.js';
import {siegebirdGoldenChance} from './shared/combat.js';
import { createMobileControls } from './client/mobile-controls.js';
import './client/mobile-ui.css';
import {afterPaint} from './client/startup-work.js';
import {LocalRoomConnection} from './client/local-room.js';
import { WorldSession } from './client/session.js';
import { createWildsGuide, wildsGuideView } from './client/wilds-guide.js';
import './client/wilds-guide.css';
import { WorldSaves, parseSave } from './client/world-saves.js';
import { createSavedWorldsChooser, downloadSave } from './saved-worlds-chooser.js';
import { knownErrorText, detectControlScheme, describeVr, renderObjective, bindObjectiveActions, bindControlsCard, bindConnectivity, releaseFocusAfterPointer } from './lobby-ui.js';
import { adventureView } from './shared/adventure.js';
import {battlePanelModel,battleQuestView} from './client/battle-model.js';
import {createRoomDirectory} from './client/public-room-directory.js';
import {worldDescriptor} from './shared/worldgen/registry.js';
import {createWorldMenu} from './client/world-menu.js';
import {friendlySeed} from './shared/worldgen/random.js';
import {findWorlds} from './client/quick-play.js';
import {createPublicRoomBrowser} from './client/public-rooms.js';
import {createBattlePanel} from './client/battle-panel.js';
import './client/public-rooms.css';
import './client/battle-panel.css';
import { createAdventureBanner, nextStep, actionModel } from './client/adventure-view.js';
import { createInteractionCueController } from './client/interaction-cue-controller.js';
import { rewardBanner } from './client/reward-moments.js';
import {createPatchNotes} from './client/patch-notes.js';
import {PATCH_NOTE_ENTRIES} from './client/patch-notes-data.js';
import './client/patch-notes.css';
import {createHeroProgressUI} from './client/hero-progress-ui.js';
import {createQuartermasterUI} from './client/quartermaster-ui.js';
import {insideTavern} from './shared/taverns.js';
import './client/hero-progress.css';
import './client/quartermaster.css';
import './client/ui-polish.css';

// ---------------------------------------------------------------- helpers
const $ = id => document.getElementById(id);
const body = document.body;
const canvas = $('world');
// Header controls wrap as room state and viewport width change.
const hudHeader = document.querySelector('.hud-top');
const hudHeaderObserver = new ResizeObserver(() => {
  const bottom = Math.ceil(hudHeader.getBoundingClientRect().bottom);
  if (bottom > 0) $('hud').style.setProperty('--hud-header-bottom', `${bottom}px`);
  syncFieldHudLayout();
});
hudHeaderObserver.observe(hudHeader);
// Bottom HUD lane: anything that floats above the hotbar (the dragon call) sits on top of this stack, never over it.
const hudBottom = document.querySelector('.hud-bottom');
function syncBottomLane(){const top=hudBottom?.getBoundingClientRect().top;if(top>0)document.documentElement.style.setProperty('--hud-bottom-clear',`${Math.ceil(innerHeight-top)}px`);}
const hudBottomObserver = hudBottom ? new ResizeObserver(syncBottomLane) : null;
hudBottomObserver?.observe(hudBottom); addEventListener('resize', syncBottomLane);
function syncFieldHudLayout(){const tools=$('heroTools');if(tools)$('hud').style.setProperty('--field-tools-bottom',`${Math.ceil(tools.getBoundingClientRect().bottom)}px`);}
const fieldToolsObserver=new ResizeObserver(syncFieldHudLayout);fieldToolsObserver.observe($('heroTools'));
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
  const reason=detail?.reason ?? detail?.result?.reason;
  if(typeof reason==='string'&&reason.trim()&&reason.length<=280)return reason;
  const code = String(detail?.code || '').toLowerCase();
  const raw = typeof detail?.message === 'string' ? detail.message : '';
  const action=actionError(code,{world:lastSnapshot||{},player:lastSnapshot?.players?.find(p=>p.id===playerId)||{},command:lastGameplayCommand});if(action)return action;
  const known = knownErrorText(code); if (known) return known;
  if (/not.?found|unknown.?room|no.?room/.test(code)) return 'We couldn’t find a world with that code. Check the digits with your friend.';
  if (code === 'inventory_full') return 'Your supplies are full. Use some before collecting more.';
  if (code === 'insufficient_resources') return 'Not enough supplies. Check the cost, then collect more.';
  if (code === 'not_needed') return 'Already fully restored — no supplies were used.';
  if (code === 'out_of_reach') return 'Move closer to collect that item.';
  const inventionErrors={protected_forge:'Keep the forge work area clear. Build outside its protected apron.',occupied:'Leave room around trees, rocks and buildings.',uneven_ground:'Choose flatter ground for this invention.',not_your_structure:'That structure belongs to the other side.',no_influence:'Build or repair an Influence source near this area.',machine_loading:'The machine is loading or turning. Wait a moment.',turn_machine:'Turn the machine in Workshop / Built, then aim again.',refinery_full:'The furnace is full. Collect bars from the output bay as batches finish, then smelt the rest.',nothing_to_smelt:'You have no ore to smelt. Mine ore seams with the pick, then bring it to the Forge.',output_empty:'No finished bars in the output bay yet.',deposit_before_switch:'Deposit carried resources and finish refining before changing side.',machine_manned:'Someone is already manning that Timberline.',rack_full:'Your bolt rack is full (99 bolts).',not_operator:'Step onto the Timberline first (E).'};
  if(inventionErrors[code])return inventionErrors[code];
  if (/full/.test(code)) return 'That world has no free player slots. Choose another world or try again when someone leaves.';
  if (/version|protocol/.test(code)) return 'Your page is out of date. Refresh the page and try again.';
  if (code === 'save_failed') return raw && raw.length < 140 ? raw : 'This browser couldn’t save the world. Download a backup from the Menu.';
  if (raw && raw.length < 140 && !/undefined|null|\bat\s+\S+:\d+/.test(raw)) return raw.replace(/^\w/, c => c.toUpperCase()).replace(/([^.!?])$/, '$1.');
  if (code) return `${humanize(code)}. Retry once; if it persists, download a recovery save from Menu and reconnect.`;
  return 'The request could not be completed. Retry once; if it persists, reconnect from Menu.';
}

// ---------------------------------------------------------------- state
let mobile = null, xrActive = false;
let quietHud=null;
let fieldOverlays=null,holdOverlays=null,fieldKind=null,fieldPinned=false,restoreFieldLock=false,fieldKeyupTrusted=false;
let resourceBar=null,forgePanel=null,forgeOpen=false,spellbook=null,quickBuild=null,quickBuildOpen=false;
// Expedition Roguelite (client/run-panel.js): the run strip and stage dialogs, and the welcome-screen launcher.
let runModal=false;
let voice = null;
const voiceControls = createVoiceControls({card:document.querySelector('#menu .menu-card'), getVoice:() => voice, openMenu});
let game = null, session = null, rendererReady = false, rendererFailed = false;
let rendererPromise=null, startRevision=0;
let phase = 'lobby';          // lobby | connecting | game
let playerId = null, room = '', connected = false, menuOpen = false, patchNotesOpen = false, talentsOpen = false, shopOpen = false;
let appliedRole = null, currentRole = 'hero', spell = 'grove', vrSupported = false, vrChecked = false;
let lastAttempt = null, joinTimer = 0, lastSnapshot = null, snapshots = 0, inputs = 0;
let handoverTimer = 0;
let lastEvent = null, lastStatus = 'not connected', rendererStatus = 'starting', lastProblem = 'none';
let lastGameplayCommand={};
function command(type,payload={}){lastGameplayCommand={type,...payload};return session?.command(type,payload);}
const shown = {};             // cache of last rendered HUD values

// Public discovery owns no game state. Close cancels a pending join and polling;
// successful joins close only after clearing the pending marker.
let directoryPending=null;
const roomBrowser=createPublicRoomBrowser({
  onJoin:code=>{directoryPending=code;roomInput.value=code;roomBrowser.render({pendingCode:code,error:''});start({create:false,room:code});},
  onCreate:()=>{roomBrowser.close();start({create:true});},
  onRefresh:()=>directory.refresh(),onMore:()=>directory.more(),
  onClose:()=>{directory.close();if(directoryPending){directoryPending=null;teardown();hideLobbyStatus();setPhase('lobby');}roomBrowser.render({pendingCode:null});}
});
const directory=createRoomDirectory({endpoint:peerEndpoint,onChange:state=>roomBrowser.render({...state,pendingCode:directoryPending})});
// Welcome screen keeps only role + Play + guides; the public world browser has no lobby launcher.
const battlePanel=createBattlePanel({mount:document.querySelector('#menu .menu-card'),onAction:({action,side})=>{
  if(!connected)return;
  if(action==='side')command('action',{action:'inventionSide',side});
  else if(isHost())command('battle',{action});
}});
battlePanel.element.dataset.mcPage='battle';
function refreshBattlePanel(){battlePanel.update(battlePanelModel(lastSnapshot,playerId,{isHost:isHost(),connected,battleCompatible:!!session?.connection.local||session?.connection.maxPeers>=32}));}

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
  $('joinBlock').classList.add('invited');   // stays hidden: Play joins this world directly
  $('inviteNote').hidden = false;
  setText($('inviteNote'), 'You’ve been invited! Pick a name and role, then join.');
}

$('lobbyForm').addEventListener('submit', event => {
  event.preventDefault();
  if ($('joinBlock').hidden) { quickPlay(); return; }   // Enter in the name field means Play (always now)
  if (!event.submitter && document.activeElement === nameInput && !roomInput.value.trim()) { $('create').focus(); return; }
  joinFromForm();
});
// The local map editor's Play button opens /?solo on the dev server: Play then starts a solo world on this
// computer, no room service needed. Builds ignore it (import.meta.env.DEV is false there).
const devSolo = import.meta.env?.DEV && new URLSearchParams(location.search).has('solo');
// A shared world link (?world=wilds&seed=mossy-heron-417&preset=continent) starts that generated world when you create one.
const linkedWorld = (() => { const q = new URLSearchParams(location.search), kind = q.get('world'); if (!kind) return null;
  try { return worldDescriptor({kind, seed: q.get('seed') || friendlySeed(Date.now() % 100000), preset: q.get('preset') || 'continent'}); } catch { return null; } })();
$('create').addEventListener('click', () => devSolo ? start({create: true, solo: true}) : linkedWorld ? start({create: true}) : quickPlay());

// Quick play: join the fullest open world in your region, or start one if none has room.
// A world that turns out full or gone is skipped; after three misses we just light a new one.
let quickSearch = 0;
async function quickPlay(tried = []) {
  // A tap during loading must keep invite/quick-play semantics after the renderer arrives.
  if (!game && !rendererFailed) {
    const revision = ++startRevision;
    showLobbyStatus('Preparing the world…', {busy: true, cancel: true});
    await rendererPromise;
    if (revision !== startRevision) return;
  }
  if (rendererFailed || !game) { start({create: true}); return; }
  // An invite link (or QR scan) goes straight to that world; if it has closed, fall back to quick play.
  if (!tried.length && ROOM_PATTERN.test(invited)) { start({create: false, room: invited, quick: {tried: [invited]}}); return; }
  const search = ++quickSearch;
  teardown(); phase = 'connecting'; body.dataset.phase = 'connecting';
  showLobbyStatus('Finding a world near you…', {busy: true, cancel: true});
  const {codes} = tried.length >= 3 ? {codes: []} : await findWorlds({endpoint: peerEndpoint, exclude: tried});
  if (search !== quickSearch || phase !== 'connecting') return;   // cancelled meanwhile
  if (codes.length) start({create: false, room: codes[0], quick: {tried: [...tried, codes[0]]}});
  else start({create: true, quick: {tried}});
}
function quickFallback() {
  if (!lastAttempt?.quick || lastAttempt.create) return false;
  const tried = lastAttempt.quick.tried;
  teardown(); quickPlay(tried);
  return true;
}
$('solo').addEventListener('click',()=>start({create:true,solo:true}));
// The Great Wilds: discoveries, ambushes and cleared sites as short banners (shared/wilds.js events).
function wildsBanner(e, me) {
  if (!e?.kind?.startsWith?.('wilds_')) return null;
  const stars = t => '★'.repeat(Math.max(1, Math.min(5, Math.round(t || 0))));
  if (e.kind === 'wilds_ambush') return `Guardians rise at ${e.name}!`;
  if (e.kind === 'wilds_cleared') return `${e.name} is clear. Its treasure is yours.`;
  if (e.kind !== 'wilds_discovery' || (e.by && e.by !== me && e.site !== 'region')) return null;
  if (e.site === 'region') return `You enter ${e.name} · danger ${stars(e.tier)}`;
  if (e.site === 'settlement') return `Discovered ${e.name}, a ${e.sub === 'harbour' ? 'harbour' : e.sub === 'village' ? 'village' : e.sub}.`;
  if (e.site === 'entrance') return `Discovered ${e.name}, a cave mouth. The Underways lie below.`;
  if (e.site === 'landmark') return `Discovered ${e.name}.`;
  return `You found ${e.name}. Search it.`;
}
// World creation menu: the classic valley or a generated world (Great Wilds, plus the experimental modes as they land).
const worldMenu = createWorldMenu({
  available: kind => ['arena', 'wilds', 'expedition', 'underways'].includes(kind) ? true : 'Arriving in a coming update. This mode is still being built.',
  onStart: async choice => {
    if (choice.kind === 'expedition') { runLauncher.open(); return; } // the run launcher picks format, seed and kit
    if (!game && !rendererFailed) { const revision = ++startRevision; showLobbyStatus('Preparing the world…', {busy: true, cancel: true}); await rendererPromise; if (revision !== startRevision) return; }
    start({create: true, solo: devSolo, ...(choice.world ? {world: choice.world} : {})});
  }});
$('newWorld').addEventListener('click', () => worldMenu.open());
$('statusSolo').addEventListener('click',()=>start({create:true,solo:true,save:lastAttempt?.save,run:lastAttempt?.run}));

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
// Fresh read at action time: the chooser only holds {id,name,savedAt}, never a possibly stale checkpoint.
const findSave = id => new WorldSaves().list().find(save => save.id === id) || null;
const savedChooser = createSavedWorldsChooser($('savedWorldChooser'), {
  showEmpty: false,   // #savedSummary already explains empty and unreadable storage
  onResume(id) {
    const save = findSave(id);   // a throw here becomes the chooser's polite, retryable message
    if (!save) { savedChooser.finish(); refreshSavedWorlds(); return; }   // vanished: newest is selected, nothing launches
    start({create: true, save, fromChooser: true});
  },
  onDownload(id) {
    const save = findSave(id);
    if (!save) { refreshSavedWorlds(); return; }
    downloadSave(save);
  },
});

function refreshSavedWorlds() {
  const summary = $('savedSummary'), resume = $('resume');
  resume.hidden = true;
  let latest = null;
  try { const saves = new WorldSaves().list(); savedChooser.setSaves(saves); latest = saves[0] || null; }
  catch (error) {
    savedChooser.setUnavailable();
    setText(summary, friendlyError({message: error?.message}) + ' You can still open a world file.');
    return;
  }
  if (!latest) { setText(summary, 'No worlds saved in this browser yet. Worlds save themselves while you play.'); return; }
  const when = new Date(latest.savedAt);
  const stamp = isNaN(when) ? '' : ` · saved ${when.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}`;
  setText(summary, `${latest.name}${stamp}`);
  setText(resume, 'Resume latest');
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
  $('statusSolo').hidden = busy;
  $('statusBack').hidden = !back;
  $('statusCancel').hidden = !cancel;
  body.classList.toggle('lobby-busy', busy);
  $('lobbyForm').inert = busy;
  $('savedWorlds').inert = busy;   // no second Resume/import/download while a world is opening
}
function showLobbyProblem(text, {retry = false, back = true} = {}) {
  showLobbyStatus(text, {retry, back});
  if(roomBrowser.isOpen){directoryPending=null;roomBrowser.render({pendingCode:null,error:text});return;}
  ($('statusRetry').hidden ? $('statusBack') : $('statusRetry')).focus({preventScroll: true});
}
function hideLobbyStatus() { $('lobbyStatus').hidden = true; body.classList.remove('lobby-busy'); $('lobbyForm').inert = false; $('savedWorlds').inert = false; savedChooser.finish(); }
$('statusRetry').addEventListener('click', () => { if (lastAttempt?.quick) quickPlay(); else if (lastAttempt) start(lastAttempt); });
$('statusBack').addEventListener('click', () => {
  hideLobbyStatus();
  if (lastAttempt?.fromChooser) savedChooser.focus({action: true});   // selection was kept; Resume selected retries
  else (lastAttempt?.create === false && !lastAttempt.quick ? roomInput : $('create')).focus();
});
$('statusCancel').addEventListener('click', () => { quickSearch++; teardown(); hideLobbyStatus(); setPhase('lobby'); });

// ---------------------------------------------------------------- phases
function setPhase(next) {
  phase = next;
  body.dataset.phase = next;
  $('lobby').hidden = next === 'game';
  $('hud').hidden = next !== 'game';
  if (next !== 'game') {restoreFieldLock=false;holdOverlays?.close();closeMenu(false);}
  if (next === 'lobby' && $('savedWorlds').open) refreshSavedWorlds();   // autosaves/reset copies made while playing
  if (next === 'game') controlsCard?.close({restoreFocus: false});
  syncActive();
}
function syncActive() {
  $('hud').inert=menuOpen||!!fieldKind||forgeOpen||quickBuildOpen;
  if (phase !== 'game' || !connected || menuOpen || fieldKind || quickBuildOpen || xrActive || currentRole !== 'hero') interactionCue?.reset();
  game?.setActive(phase === 'game' && connected && !menuOpen && !patchNotesOpen && !talentsOpen && !shopOpen && !fieldKind && !forgeOpen && !quickBuildOpen && !runModal);
  mobile?.update({active:phase === 'game' && connected && !menuOpen && !patchNotesOpen && !talentsOpen && !shopOpen && !fieldKind && !forgeOpen && !quickBuildOpen && !runModal,role:currentRole,xr:xrActive});
  if(fieldOverlays)fieldOverlays.entry.hidden=phase!=='game'||menuOpen||!!fieldKind||xrActive;
  updateLookHint();
}

// ---------------------------------------------------------------- connection
function teardown() {
  startRevision++;
  voice?.dispose(); voice = null; voiceControls.update();
  closeQuickBuild();closeForge();
  restoreFieldLock=false;holdOverlays?.close();
  clearTimeout(joinTimer);
  game?.setActive(false);
  const old = session; session = null;
  try { old?.dispose(); } catch (error) { console.warn('Session cleanup failed', error); }
  connected = false; playerId = null; appliedRole = null; lastSnapshot = null;
  expeditionBanner?.destroy(); expeditionBanner = null; game?.setExpedition(null); wildsGuide?.destroy(); wildsGuide = null;
  runHud.update(null, null); runModal = false;
  interactionCue?.reset();
  clearNotices();
}

async function start(attempt) {
  const revision=++startRevision;
  if(!game&&!rendererFailed){
    showLobbyStatus('Preparing the world…', {busy:true, cancel:true});
    await rendererPromise;
    if(revision!==startRevision)return;
  }
  attempt={...attempt,solo:!!attempt.solo||attempt.save?.checkpoint?.room==='SOLO'};
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
  try { next = session = new WorldSession(attempt.solo?{connection:new LocalRoomConnection()}:{url:peerEndpoint()}); }
  catch (error) { recordProblem(error); showLobbyProblem('We couldn’t open a connection to the forge. Please try again in a moment.', {retry: true}); return; }

  if (!attempt.solo) { voice = new ProximityVoice(next.connection); voice.addEventListener('change', voiceControls.update); }
  voiceControls.update();
  const mine = handler => event => { if (session === next) handler(event.detail); };
  next.addEventListener('welcome', mine(onWelcome));
  next.addEventListener('status', mine(onStatus));
  next.addEventListener('snapshot', mine(onSnapshot));
  next.addEventListener('event', mine(detail => { lastEvent = detail; game?.handleEvent(detail); const banner=rewardBanner(detail,lastSnapshot?.players?.find(p=>p.id===playerId)?.side||'party'); if(banner)toast(banner); const wild=wildsBanner(detail,playerId); if(wild)toast(wild); if(detail.kind==='respawn'&&detail.id===playerId)toast('Back on your feet. Three seconds of protection to get your bearings.');if(detail.kind==='shop_buy'&&detail.id===playerId)quartermaster.bought(detail.item);if(detail.kind==='level_up'){if(detail.id===playerId)heroProgress.levelUp(detail);else{const who=lastSnapshot?.players?.find(p=>p.id===detail.id)?.name;if(who)toast(`${who} reached level ${detail.level}!`);}} if(detail.kind==='god_gift')giftToast(detail); if(detail.kind==='bloom_level')bloomToast(detail); if(detail.kind==='weather')toast(detail.by===playerId?'Rain is coming. Groves bloom twice as fast and Heroes mend while it falls.':'The God calls the rain: you slowly mend while it falls.'); runHud.handleEvent(detail); if(detail.kind==='party_reward')toast('Expedition milestone: +20 health, +30 mana for the party.'); if(detail.kind==='adventure_reward')toast('Expedition complete! Fully restored, +6 wood, +4 stone, +3 gems each.'); }));
  next.addEventListener('error', mine(onSessionError));
  next.addEventListener('hosting', mine(() => { refreshHostControls(); }));
  next.addEventListener('host_changed', mine(detail => {
    refreshHostControls();
    if (phase !== 'game') return;
    const who = lastSnapshot?.players?.find(p => p.id === detail?.hostId)?.name;
    toast(detail?.isHost ? 'You’re carrying the world now. Play on!' : who ? `${who} is carrying the world now.` : 'The world carries on with a new host.');
  }));
  next.addEventListener('saved', mine(() => {}));
  // The next player takes the world over by themselves, so a host leaving shows nothing unless
  // the switch is unusually slow; then a quiet note explains the pause.
  next.addEventListener('owner_lost', mine(detail => {
    if (detail.recoveryAvailable && !detail.recoverySaved) notice('owner', 'The host left. A recovery copy could not be saved in this browser. Keep this tab open; use Menu to download a backup if available.', null, 'warn');
  }));
  next.addEventListener('continue_world_offer', mine(() => { removeNotice('waiting'); }));
  next.addEventListener('continue_offer_expired', mine(() => removeNotice('continue')));
  next.addEventListener('world_waiting', mine(() => {
    removeNotice('continue');
    notice('waiting', 'Waiting for someone to host this world again. The world is paused until then.', {label: 'Try hosting it here', run: () => { try { session?.retryWorld(); } catch (e) { onSessionError({message: e?.message}); } removeNotice('waiting'); }}, 'action');
  }));
  next.addEventListener('peer_connection_state', mine(detail => {
    if (detail?.state === 'failed') notice('relay', detail.relayConfigured
      ? 'Direct connection unavailable. Connecting through the cloud relay…'
      : 'We couldn’t link directly to another player. This room service has no relay configured. Try a different network or have that player host.', null, detail.relayConfigured ? 'info' : 'warn');
    else if (detail?.state === 'connected') removeNotice('relay');
  }));

  phase = 'connecting'; body.dataset.phase = 'connecting';
  const verb = attempt.save ? `Bringing back ${attempt.save.name || 'your world'}…` : attempt.create ? 'Lighting the forge for a new world…' : attempt.quick ? (attempt.room === invited ? 'Joining your friend’s world…' : 'Joining a world near you…') : `Looking for world ${attempt.room}…`;
  showLobbyStatus(verb, {busy: true, cancel: true});

  joinTimer = setTimeout(() => {
    if (session !== next || lastSnapshot) return;
    if (quickFallback()) return;
    teardown();
    setPhase('lobby');
    showLobbyProblem(attempt.create
      ? 'The forge didn’t answer in time. Check your internet connection and try again.'
      : 'We couldn’t reach that world in time. It may have closed, or the code may be wrong.', {retry: true});
  }, JOIN_TIMEOUT_MS);

  try {
    next.connect({save: attempt.save || null, room: attempt.create ? '' : attempt.room, name, role, ...(attempt.create && attempt.run && !attempt.save ? {run: attempt.run} : {}),
      ...(attempt.create && !attempt.save && !attempt.run && (attempt.world || linkedWorld) ? {world: attempt.world || linkedWorld} : {}),
      // Any device can carry the world on when the host leaves (phones and headsets host new worlds already).
      desktop: true});
  } catch (error) {
    recordProblem(error);
    teardown(); setPhase('lobby');
    showLobbyProblem(attempt.save ? 'That saved world couldn’t be loaded. It may be damaged — try another file.' : 'We couldn’t start the connection. Please try again.', {retry: !attempt.save});
  }
}

function onWelcome(detail) {
  directoryPending=null;roomBrowser.close();
  playerId = detail.peerId;
  room = String(detail.room || '');
  const url = new URL(location.href);
  url.search = ''; if(!detail.local)url.searchParams.set('room', room);
  try { history.replaceState(null, '', url); } catch { /* sandboxed */ }
  roomInput.value = ROOM_PATTERN.test(room) ? room : roomInput.value;
  setText($('hudRoom'), detail.local?'Solo':room); setText($('menuRoom'), detail.local?'Solo — this device':room);
  for(const id of ['copyCode','copyInvite','menuCopyCode','menuCopyInvite','showInviteQr'])$(id).disabled=!!detail.local;
  $('inviteQr').hidden=!!detail.local;
  $('inviteQr').open=false;
  $('inviteQrImage').hidden=true;
  setText($('hudName'), nameInput.value.trim() || 'Wanderer');
  hideLobbyStatus();
  setPhase('game');
  if (!detail.resume) notice('loading', 'Gathering the world…', null, 'info');
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
  // While the world moves to a new host the game stays live under your hands (no lost pointer
  // lock or hidden controls); only a slow switch earns a note.
  const handing = phase === 'game' && (state === 'owner_lost' || state === 'connecting_to_host');
  if (handing && !handoverTimer) handoverTimer = setTimeout(() => { if (handoverTimer) notice('owner', 'The host left. Moving the world to another player…', null, 'info'); }, 6000);
  if (!handing) { clearTimeout(handoverTimer); handoverTimer = 0; }
  connected = handing || state === 'connected' || state === 'hosting' || (state === 'signaling_reconnecting' && detail.playable);
  syncActive();
  refreshBattlePanel();
  if (phase === 'connecting' && !playerId && state === 'closed') {
    teardown(); setPhase('lobby');
    showLobbyProblem('We couldn’t reach the forge. Check your internet connection and try again.', {retry: true});
    return;
  }
  if (phase !== 'game') return;
  if (state === 'signaling_reconnecting') {
    notice('net', detail.playable ? 'Game connected. Restoring invites…' : 'Restoring the room connection…', null, 'info'); return;
  }
  if (handing) return;
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
    if (quickFallback()) return;
    teardown(); setPhase('lobby');
    showLobbyProblem(message, {retry: true});
  } else if (phase === 'game') fail(message);
}

function recordProblem(problem) {
  const text = problem?.code ? `${problem.code}: ${problem.message ?? ''}` : (problem?.message || String(problem));
  lastProblem = text.slice(0, 300);
  console.warn('[Brann’s Forge]', problem);
}

// ---------------------------------------------------------------- Forge Expedition (optional co-op run, shared/adventure.js)
let expeditionBanner = null, wildsGuide = null;
let interactionCue = null; // contextual harvesting cue (client/interaction-cue*.js); hidden in menus, God view and XR
function expeditionAction(action,detail={}) {
  if((action.startsWith('forge')||action.startsWith('invention'))){command('action',{action,...detail});return;}
  const runCmd = runVrAction(action);
  if (runCmd) {
    if (runCmd.local === 'leave') return void $('leave').click();
    if (runCmd.local === 'again') { try { session?.startRun(nextRunOptions(lastSnapshot, {seed: (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000})); } catch (error) { toast(error.message); } return; }
    return void command('run', {action: runCmd.action, ...runCmd.payload});
  }
  const snap = lastSnapshot, adv = snap?.adventure, self = snap?.players.find(p => p.id === playerId);
  if (!session || !adv || !self) return;
  const send = payload => command('adventure', payload);
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
const fireSampleProvider = enemy => game?.fireSamples(enemy.id);
function onSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return;
  session?.simulation?.setFireSamples(fireSampleProvider);
  clearTimeout(joinTimer);
  lastSnapshot = snapshot; snapshots++;
  if (snapshots === 1) removeNotice('loading');
  const self = snapshot.players.find(player => player.id === playerId);
  if (self) {
    setText($('supplyCount'),`Wood ${self.resources?.wood||0} · Stone ${self.resources?.stone||0} · Gems ${self.resources?.gems||0}`);
    for(const b of document.querySelectorAll('[data-resource-use]')){const kind=b.dataset.resourceUse,r=RESOURCE_RECIPES[kind];setText(b,`${r[self.role]} · ${r.cost} ${kind}`);b.disabled=(self.resources?.[kind]||0)<r.cost;}
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
  if (snapshot.run && expeditionBanner) { expeditionBanner.destroy(); expeditionBanner = null; } // the run strip replaces the quest card
  if (snapshot.world && expeditionBanner) { expeditionBanner.destroy(); expeditionBanner = null; } // generated worlds have their own discoveries, not the valley's forge quest
  if (snapshot.world && !snapshot.run) try { (wildsGuide ||= createWildsGuide($('hud'))).update(wildsGuideView(snapshot, playerId)); } catch (error) { recordProblem(error); }
  else if (wildsGuide) { wildsGuide.destroy(); wildsGuide = null; }
  if (snapshot.adventure && !snapshot.run && !snapshot.world) try {
    const view = battleQuestView(snapshot,playerId)||adventureView(snapshot.adventure, snapshot, playerId);
    if (!expeditionBanner) expeditionBanner = createAdventureBanner($('hud'), {onAction: expeditionAction});
    expeditionBanner.update(view, {held: self?.resources, mana: self?.mana});
    // DOM is invisible in WebXR: the same view drives the in-world wrist panel (it repaints only when its model changes).
    if (xrActive) game.setExpedition(view, snapshot, playerId);
  } catch (error) { recordProblem(error); }
  else if (xrActive && snapshot.run) try { game.setExpedition(runWristView(snapshot, playerId, {isHost: isHost()}), snapshot, playerId); } catch (error) { recordProblem(error); }
  else if (xrActive) game.setExpedition(null);

  const count = session?.connection.local?'This device':`${snapshot.players.length} of ${session?.connection.maxPeers ?? snapshot.maxPlayers ?? 32} here`;
  if (shown.players !== count) { shown.players = count; setText($('hudPlayers'), count); }
  if (self) {
    setText($('resources'), `Wood ${self.resources?.wood||0} · Stone ${self.resources?.stone||0} · Gems ${self.resources?.gems||0}`);
    resourceBar ??= createResourceBar(document.querySelector('.hud-bottom')||$('hud'));
    resourceBar.update(self.resources, snapshot.inventions?.stockpiles?.[self.side==='rivals'?'rivals':'party']);
    for(const b of document.querySelectorAll('[data-equip]'))b.setAttribute('aria-pressed',String(b.dataset.equip===(self.tool||'axe')));
    const weaponText={staff:'Sunthread · hold click for a sun-thread · Q Radiant Nova',axe:'Axe · click to chop · Q sundering strike',pick:'Stonewhisper · click to mine · hold Q to aim crystal wall',hammer:'Sunfall · click to strike · Q ground slam',crossbow:`Siegebird · click to fire · songbirds bring each bolt · golden bird ${(siegebirdGoldenChance(self.siegebird?.hits||0,!!self.talents?.crossbow?.includes('flock'))*100).toFixed(1)}%`,bow:'Emberwing · hold attack to draw, release to fire · right click then aim to curve · Q phoenix flare',limb:'Bone · click to strike · G drop · X throw',wyrmspout:`Wyrmspout · hold to spray sticky fire · Q: Gout · Tank ${Math.round((1-(self.heat||0))*100)}%${self.overheatUntil>snapshot.tick?' · Refilling':''}`,stormreel:'Stormreel · hold to charge, release to fire · + and \u2212 bolts in one foe close the circuit · G spikes it · Q reels in',flask:mobile?.enabled?'Emberdew · attack: hurl a lit bottle · Special: Cinder Cluster':'Emberdew · click to toss fuel · hold right click to light and aim · hold Q for Cinder Cluster'}[self.tool||'axe'];if($('weaponHint'))setText($('weaponHint'),weaponText);
    meter('hp', self.hp, self.maxHp ?? self.hpMax ?? self.maxHealth ?? 100);
    heroProgress.update(self, {role: currentRole});
    quartermaster.update(self, {role: currentRole, tavern: insideTavern(snapshot, self.position), tick: snapshot.tick ?? 0});
    meter('mana', self.mana, self.maxMana ?? self.manaMax ?? 100);
  }
  runHud.update(snapshot, playerId);
  if (snapshots % 15 === 0) refreshHostControls();
  if (menuOpen && $('techDetails').open && snapshots % 10 === 0) renderTech();
  refreshFieldModel();
  updateBloomMeter(snapshot.bloom||0);
  if(self)spellbook?.update({...spellbookReadiness(self,snapshot.tick,spell,connected&&currentRole==='god'),blocked:Object.fromEntries(SPELLS.map(s=>[s.id,spellUnavailable(snapshot,self,s.id)]))});
  if(forgeOpen)forgePanel?.update(workshopModel(snapshot));
  if(quickBuildOpen)quickBuild?.show(quickBuildModel(snapshot));
  if(menuOpen)refreshBattlePanel();
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
  $('perspectiveButton').querySelector('use').setAttribute('href',role==='hero'?'#i-god':'#i-hero');
  $('perspectiveButton').querySelector('span').textContent=role==='hero'?'God':'Hero';
  $('perspectiveButton').setAttribute('aria-label',`Switch to ${role==='hero'?'God strategy':'Hero first-person'} view (F9)`);
  for(const b of document.querySelectorAll('[data-role-switch]')){const next=role==='hero'?'god':'hero';b.dataset.next=next;b.querySelector('use').setAttribute('href',`#i-${next}`);b.querySelector('.bf-name').textContent=next==='god'?'God':'Hero';b.title=`Play as ${next==='god'?'God':'Hero'} (F9)`;b.setAttribute('aria-label',`Play as ${next==='god'?'God: shape the world from above':'Hero: explore and fight'} (F9)`);}
  setText($('vrNote'), describeVr({supported: vrChecked ? vrSupported : null, secure: window.isSecureContext !== false, role}));
  if (role !== 'hero' && document.pointerLockElement === canvas) document.exitPointerLock?.();
  mobile?.update({active:phase === 'game' && connected && !menuOpen && !fieldKind,role:currentRole,xr:xrActive});
  updateLookHint();
}

function isHost() { return !!session?.simulation; }
function refreshHostControls() {
  refreshBattlePanel();
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

// God spells leave Hero boons (shared/god-boons.js). Tell the Hero who got one, and the caster what the spell left.
const GIFT_TEXT={stone_boulder:'a stone boulder to mine',iron_seam:'an iron seam to mine',crystal:'crystal shards along the crack',apple:'fruit that heals',ore:'ore shaken loose'};
let lastGiftToast=0;
const BLOOM_UNLOCKS=Object.fromEntries(SPELLS.filter(s=>s.bloom).map(s=>[s.bloom,s.label]));
function bloomToast(e){toast(`The world blooms: level ${e.level}. ${BLOOM_UNLOCKS[e.level]?`${BLOOM_UNLOCKS[e.level]} is unlocked for the God.`:''}`.trim());const m=$('bloomMeter');if(m){m.classList.remove('bf-bloom-up');void m.offsetWidth;m.classList.add('bf-bloom-up');}}
let lastBloomText='';
function updateBloomMeter(points=0){const m=$('bloomMeter');if(!m)return;const level=bloomLevel(points),next=nextBloom(points),prev=level?BLOOM.levels[level-1]:0,text=next?`Bloom ${level} · ${points}/${next}`:`Bloom ${level} · full`;if(text===lastBloomText)return;lastBloomText=text;
  m.style.setProperty('--bloom',`${next?Math.round((points-prev)/(next-prev)*100):100}%`);m.setAttribute('aria-valuenow',String(points));m.querySelector('.bf-bloom-text').textContent=text;m.title=next?`Bloom grows as life thrives: groves, fruit eaten, foes felled by Heroes. ${next-points} more unlocks ${BLOOM_UNLOCKS[level+1]||'the next spell'}.`:'Every Bloom spell is unlocked.';}
function giftToast(e) {
  if(e.gift==='charge'&&e.id===playerId)return toast(`Lightning struck close: your weapon is charged for ${e.hits} heavy hits.`);
  if(e.gift==='swift'&&e.id===playerId)return toast('Frost quickens your step for six seconds.');
  if(e.gift==='blessing'&&e.id===playerId)return toast(`Blessed: health restored and your weapon charged for ${e.hits} heavy hits.`);
  if(e.by===playerId&&GIFT_TEXT[e.gift]&&performance.now()-lastGiftToast>4000){lastGiftToast=performance.now();toast(`Your spell left the Heroes ${GIFT_TEXT[e.gift]}.`);}
}
// Info and failures share one floating lane high in the centre (client/callouts.js), clear of the hotbar.
let callouts=null;
const calloutLane=()=>callouts??=createCallouts({mount:$('hud'),info:$('toast')});
function toast(text) { calloutLane().info(text); }
const runHud = createRunHud({parent: body,
  command: (action, payload) => session?.command('run', {action, ...payload}),
  isHost: () => isHost(),
  newRun: run => { try { session?.startRun(run); } catch (error) { toast(error.message); } },
  leave: () => $('leave').click(),
  toast: text => toast(text),
  onModal: open => { runModal = open; if (open) { game?.clearControls(); if (document.pointerLockElement) document.exitPointerLock?.(); } syncActive(); }});
const runLauncher = createRunLauncher({parent: body, openHall: () => runHud.openHall(), onStart: run => start({create: true, run, ...(devSolo ? {solo: true} : {})})});
$('runLaunch')?.addEventListener('click', () => runLauncher.open());
// Failures: short red standalone text that fades on its own (the recovery hint sits small beneath).
function fail(text) { if (text) calloutLane().error(text); }

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

// Lazy and local: opening an invite never sends its URL to a QR service.
let qrRequest = 0;
$('inviteQr').addEventListener('toggle', async () => {
  const request = ++qrRequest;
  if (!$('inviteQr').open || $('inviteQr').hidden) return;
  const url = inviteUrl();
  $('inviteQrImage').hidden = true;
  $('inviteQrStatus').textContent = 'Preparing QR code…';
  try {
    const {default: QRCode} = await import('qrcode');
    const src = await QRCode.toDataURL(url, {width:512,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}});
    if (request !== qrRequest || url !== inviteUrl() || !$('inviteQr').open) return;
    $('inviteQrImage').src = src;
    $('inviteQrImage').hidden = false;
    $('inviteQrStatus').textContent = `Scan with your phone camera to join world ${room}.`;
    if (menuOpen) $('inviteQrImage').scrollIntoView({block:'center'});
  } catch {
    if (request === qrRequest) $('inviteQrStatus').textContent = 'QR code could not load. Use Copy invite link above, or close and reopen this section to retry.';
  }
});
$('showInviteQr').addEventListener('click', () => {
  openMenu();
  $('inviteQr').open = true;
  $('inviteQr').scrollIntoView({block:'center'});
  $('inviteQr').querySelector('summary').focus({preventScroll:true});
});

// ---------------------------------------------------------------- menu
function openMenu() {
  if (phase !== 'game' || menuOpen) return;
  closeQuickBuild();closeForge();
  restoreFieldLock=false;holdOverlays?.close();
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
let menuBackdropPointer = false;
$('menu').addEventListener('pointerdown', event => { menuBackdropPointer = event.target === $('menu'); });
$('menu').addEventListener('click', event => { if (event.target === $('menu') && menuBackdropPointer) closeMenu(); menuBackdropPointer = false; });
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

function changePerspective(role=currentRole==='hero'?'god':'hero'){
  if(!connected||phase!=='game')return;
  if(xrActive){fail('Leave VR before switching perspective.');return;}
  const self=lastSnapshot?.players.find(p=>p.id===playerId);
  if(self&&lastSnapshot.tick-self.roleTick<120){fail(actionError('cooldown',{world:lastSnapshot,player:self,command:{type:'role'}}));return;}
  game?.clearControls();closeQuickBuild();if(forgeOpen)closeForge();holdOverlays?.close();if(menuOpen)closeMenu(false);
  if(role==='hero'&&!mobile?.enabled){try{canvas.requestPointerLock?.()?.catch?.(()=>{});}catch{}}
  store.set(ROLE_KEY, role);
  const lobbyRadio = document.querySelector(`input[name="role"][value="${role}"]`);
  if (lobbyRadio) lobbyRadio.checked = true;
  if (!command('role', {role})) toast('You can switch roles once you’re connected.');
  else toast(role === 'god' ? 'Rising to the heavens…' : 'Descending to the land…');
}
for (const radio of document.querySelectorAll('input[name="menuRole"]')) radio.addEventListener('change',()=>{if(radio.checked)changePerspective(radio.value);});
$('perspectiveButton').addEventListener('click',()=>changePerspective());

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

$('damageNumbers').addEventListener('change',()=>{const enabled=$('damageNumbers').checked;store.set('branns-forge.damage-numbers',enabled?'on':'off');game?.setDamageNumbers(enabled);});

// ---------------------------------------------------------------- spells
spellbook=createSpellbook({root:$('godHelp'),spells:SPELLS,schools:SPELL_SCHOOLS});
// One-press God / Hero switch, the first slot of whichever hotbar is showing (F9 still works; touch keeps its tray entry).
function makeRoleSwitch(){const b=document.createElement('button');b.type='button';b.className='bf-roleswitch';b.dataset.roleSwitch='';b.setAttribute('aria-keyshortcuts','F9');
 b.innerHTML='<span class="bf-roleswitch-ring"><svg aria-hidden="true"><use href="#i-god"/></svg></span><span class="bf-name">God</span><kbd>F9</kbd>';
 b.addEventListener('click',()=>{changePerspective();b.blur();});return b;}
document.querySelector('#heroTools .bf-bar')?.prepend(makeRoleSwitch());
(document.querySelector('#godHelp .sb-bar')||document.querySelector('#godHelp'))?.prepend(makeRoleSwitch());
function closeForge(){forgeOpen=false;forgePanel?.hide();syncActive();}
function openForge(){
  if(phase!=='game'||!lastSnapshot||xrActive)return;
  closeQuickBuild();restoreFieldLock=false;holdOverlays?.close();closeMenu(false);
  forgeOpen=true;document.exitPointerLock?.();syncActive();
  forgePanel.show(workshopModel(lastSnapshot));
}
function workshopModel(snapshot){const m=inventionView(snapshot,playerId),self=snapshot.players.find(p=>p.id===playerId),legacy=settlementView(snapshot,playerId);return {...m,legacyActions:[{action:'inventionCollectOutput',label:'Collect finished metal',enabled:snapshot.pickups.some(q=>q.id.startsWith('ingot')&&q.side===m.side)},{action:'inventionAssault',label:'Call a rewarded assault',enabled:!snapshot.inventions?.assault},{action:'inventionPlaceInfluence',label:'Build God Influence',enabled:true},{action:'inventionSide',label:m.side==='party'?'Join rival side (deposit first)':'Join cooperative side (deposit first)',detail:{side:m.side==='party'?'rivals':'party'},enabled:!self.heldOre&&!Object.values(self.resources).some(n=>n>0)},...(m.side==='party'?[...legacy.actions.filter(a=>a.action==='forgeSummon'),...legacy.workers.flatMap(w=>['wood','stone','gems','ironOre','mithrilOre','starOre','iron'].map(kind=>({action:'forgeAssign',label:w.name+': gather '+kind,enabled:!w.cargo,detail:{workerId:w.id,kind}})))]:[])]};}
forgePanel=createInventionPanel({mount:body,onAction:(action,detail)=>{if(action==='inventionPlaceInfluence'){closeForge();game.beginInventionPlacement('influence');return;}command('action',{action,...detail});},onPlace:type=>{closeForge();game.beginInventionPlacement(type);},onClose:closeForge});
for(const button of document.querySelectorAll('[data-open-forge]'))button.addEventListener('click',openForge);
function quickBuildModel(snapshot){
  const model=inventionView(snapshot,playerId),self=snapshot.players.find(p=>p.id===playerId),wood=self?.resources?.wood||0;
  return {...model,recipes:[...(model.recipes||[]),{id:'bridge',name:'Bridge',cost:{wood:3},missing:{wood:Math.max(0,3-wood)},enabled:self?.role==='hero'&&wood>=3,reason:self?.role!=='hero'?'Switch to Hero to build a bridge':wood<3?`Carry ${3-wood} more Wood`:''}]};
}
function closeQuickBuild(){quickBuildOpen=false;quickBuild?.hide();body.classList.remove('quick-build-open');syncActive();}
function openQuickBuild(){
  if(phase!=='game'||!connected||!lastSnapshot||xrActive)return;
  if(quickBuildOpen){closeQuickBuild();return;}
  closeForge();restoreFieldLock=false;holdOverlays?.close();closeMenu(false);quietHud?.close();
  game?.clearControls();document.exitPointerLock?.();quickBuildOpen=true;body.classList.add('quick-build-open');
  quickBuild.show(quickBuildModel(lastSnapshot));syncActive();
}
function directTimberline(){
  if(phase!=='game'||!connected||currentRole!=='hero'||xrActive)return;
  const recipe=quickBuildModel(lastSnapshot).recipes.find(r=>r.id==='timberline');
  if(!recipe?.enabled){openQuickBuild();fail('Gather the highlighted Timberline materials first.');return;}
  closeQuickBuild();game.beginInventionPlacement('timberline');
}
quickBuild=createQuickBuild({parent:body,onPlace:id=>{closeQuickBuild();if(id==='bridge')game.buildBridge();else game.beginInventionPlacement(id);},onCatalog:()=>{closeQuickBuild();openForge();forgePanel.setTab('build');},onClose:closeQuickBuild});
$('quickBuildButton').addEventListener('click',openQuickBuild);

function updateSpellHint(){const spec=SPELLS.find(s=>s.id===spell);if(!spec)return;const quick=$('quickCast')?.checked;setText($('spellHint'),`${spec.label} · ${spec.cost} mana · ${spec.target==='line'?(quick?'Drag to cast; or tap two ends':'Drag to aim; touch Cast confirms'):(quick?'Tap ground to cast':'Aim, then cast')}`);}
function chooseSpell(next) {
  spell = next;
  spellbook?.scrollToSpell(next,true);
  updateSpellHint();
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
for(const button of document.querySelectorAll('[data-resource-use]'))button.addEventListener('click',()=>command('action',{action:'useResource',kind:button.dataset.resourceUse}));
$('collect').addEventListener('click',()=>{game?.interact();$('collect').blur();});
$('bridge').addEventListener('click',()=>{game?.buildBridge();$('bridge').blur();});
for(const [id,method] of [['grab','grab'],['drop','release']])$(id)?.addEventListener('click',()=>{game?.[method]();$(id).blur();});
// Special is press-and-release: the pick shows its wall footprint while held and raises it on release (touch buttons
// activate on release, so 'click' is the release); other weapons fire on that same click.
$('special')?.addEventListener('pointerdown',()=>{if(game?.weaponState()?.tool==='pick')game.specialPress(true);});
// A finger dragged off the button never casts (release outside does not click); drop the footprint instead.
for(const name of ['pointercancel','lostpointercapture'])$('special')?.addEventListener(name,()=>game?.cancelSpecialAim?.());
$('special')?.addEventListener('click',()=>{game?.specialPress?game.specialPress(false):game?.special();$('special').blur();});
$('throw')?.addEventListener('click',()=>{game?.release(true);$('throw').blur();});
$('quickCast')?.addEventListener('change',()=>{game?.setQuickCast($('quickCast').checked);updateSpellHint();mobile?.update({active:phase==='game'&&connected&&!menuOpen&&!fieldKind,role:currentRole,xr:xrActive});});
releaseFocusAfterPointer($('quickCast'));
// ---------------------------------------------------------------- held field guide and party
function fieldModel() {
  const self=lastSnapshot?.players.find(p=>p.id===playerId),role=phase==='game'?(self?.role||currentRole):chosenRole();
  const inputMode=xrActive?'vr':mobile?.enabled?'touch':'desktop',tool=game?.weaponState()?.tool||self?.tool||'axe';
  const help=equipmentHelp(tool,inputMode,role),adv=lastSnapshot?.adventure;
  const model={tool,role,inputMode,name:help.title,help:{...help,title:'Field guide'},players:(lastSnapshot?.players||[]).map(p=>({id:p.id,name:p.name,role:p.role,kills:p.stats?.kills??0,deaths:p.stats?.deaths??0,contribution:p.stats?.contribution??0,isSelf:p.id===playerId})),disabledActions:[]};
  const battle=battleQuestView(lastSnapshot,playerId);
  if(battle){model.quest={title:battle.title,summary:`${battle.nextStep} ${battle.notice}`};model.disabledActions.push('start-expedition');return model;}
  if(!adv||!self){model.quest={title:'Prepare an expedition',summary:phase==='game'?'The world is arriving. Gather your party at the forge.':'Create or join a world, then gather your party at the forge.'};model.disabledActions.push('start-expedition');return model;}
  const view=adventureView(adv,lastSnapshot,playerId),actions=actionModel(view,{held:self.resources,mana:self.mana});
  const primary=actions.find(a=>['retry','rematch','start','deposit','lodestar','tithe'].includes(a.id));
  const objectives=view.objectives.filter(o=>!o.waived),done=objectives.reduce((n,o)=>n+(o.need>0?Math.min(1,o.have/o.need):1),0);
  model.quest={title:view.stage==='idle'?'Prepare an expedition':view.title,summary:nextStep(view,self.resources),...(objectives.length?{progress:{value:done,max:objectives.length,label:objectives.map(o=>`${o.have}/${o.need} ${o.label}`).join(' · ')}}:{}),...(primary?{action:primary.id,actionLabel:primary.label}:{})};
  if(!view.actions.some(a=>a==='start'||a==='rematch'))model.disabledActions.push('start-expedition');
  for(const a of actions)if(a.blocked||!connected)model.disabledActions.push(a.id);
  if(!connected)model.disabledActions.push('start-expedition');
  return model;
}
function refreshFieldModel(){fieldOverlays?.update(fieldModel());}
function fieldChanged(kind) {
  if(kind){closeQuickBuild();if(forgeOpen)closeForge();}
  const wasOpen=!!fieldKind;
  if(kind&&!wasOpen)restoreFieldLock=document.pointerLockElement===canvas;
  fieldKind=kind;body.classList.toggle('field-overlay-open',!!kind);
  if(kind){game?.clearControls();fieldOverlays.show(kind==='equipment'?'help':'party',fieldModel(),{pinned:fieldPinned});}
  else{fieldOverlays?.hide();fieldPinned=false;}
  syncActive();
  if(!kind&&wasOpen){
    const restore=restoreFieldLock;restoreFieldLock=false;
    if(restore&&fieldKeyupTrusted&&phase==='game'&&connected&&!menuOpen&&!xrActive&&currentRole==='hero'&&!document.hidden&&document.hasFocus()){
      try{const request=canvas.requestPointerLock?.();request?.catch?.(()=>updateLookHint());}catch{updateLookHint();}
    }
  }
}
function fieldAction(a){
  if(a.id==='forge'){openForge();return;}
  if(a.id==='switch-role'){changePerspective();return;}
  if(a.id==='build'){openQuickBuild();return;}
  if(a.id==='open'){fieldPinned=true;holdOverlays.open(a.kind==='help'?'equipment':'party');return;}
  if(a.id==='close'){holdOverlays.close();return;}
  if(a.id==='menu'){openMenu();return;}
  if(a.id==='patch-notes'){holdOverlays.close();patchNotes.open();return;}
  if(a.id==='current-quest'){fieldOverlays.root.querySelector('.fo-quest')?.scrollIntoView({block:'nearest'});return;}
  if(a.id==='start-expedition'){const stage=lastSnapshot?.adventure?.stage;if(['idle','victory','defeat'].includes(stage))expeditionAction(stage==='idle'?'start':'rematch');return;}
  if(a.source==='quest')expeditionAction(a.id);
}
fieldOverlays=createFieldOverlays({mount:body,onAction:fieldAction});
// Use the existing header's flow; no extra fixed controls over the phone utility dock.
document.querySelector('.hud-room').append(fieldOverlays.entry);
const fieldBuildTag=createBuildTag({mount:body,text:typeof __BRANN_BUILD__!=='undefined'?String(__BRANN_BUILD__):'dev · local'});
// This listener precedes the hold router, whose keyup closes synchronously in this trusted gesture.
window.addEventListener('keyup',event=>{fieldKeyupTrusted=event.isTrusted&&(event.code==='F1'||event.code==='Tab');setTimeout(()=>{fieldKeyupTrusted=false;},0);},true);
holdOverlays=bindHoldOverlays({canParty:()=>phase==='game'&&!patchNotes.isOpen&&!menuOpen&&!forgeOpen&&!quickBuildOpen&&!xrActive&&!fieldPinned,onChange:fieldChanged});
refreshFieldModel();

// ---------------------------------------------------------------- keyboard & pointer
// Hero levels and weapon talents (client/hero-progress-ui.js): badge + XP beside health, N opens the Talents panel.
const heroProgress=createHeroProgressUI({hudSelf:document.querySelector('.hud-self'),mount:body,
  onLearn:(weapon,talent)=>command('action',{action:'talent',weapon,talent}),onReset:()=>command('action',{action:'talent',reset:true}),
  onOpen:()=>{talentsOpen=true;closeQuickBuild();holdOverlays?.close();game?.clearControls();if(document.pointerLockElement)document.exitPointerLock?.();syncActive();},
  onClose:()=>{talentsOpen=false;syncActive();}});
// The keep Quartermaster (client/quartermaster-ui.js): E at the shop counter opens it; V or the vitals chip drinks a draught.
const quartermaster=createQuartermasterUI({mount:body,hudSelf:document.querySelector('.hud-self'),
  onBuy:item=>command('action',{action:'homeShop',buy:item}),onSell:item=>command('action',{action:'homeShop',sell:item}),onDrink:()=>command('action',{action:'drinkDraught'}),
  onOpen:()=>{shopOpen=true;closeQuickBuild();holdOverlays?.close();game?.clearControls();if(document.pointerLockElement)document.exitPointerLock?.();syncActive();},
  onClose:()=>{shopOpen=false;syncActive();}});
if(/acceptanceProbe/.test(location.search))window.__qaUI={quartermaster,heroProgress,patchNotes:null};
// Dev-only run probe for the Expedition Roguelite capture script (tests/browser-expedition-run.mjs).
if(import.meta.env?.DEV&&/acceptanceProbe/.test(location.search))window.__qaRun={session:()=>session,snapshot:()=>lastSnapshot,playerId:()=>playerId};
function openTalents(){if(phase!=='game'||!connected||currentRole!=='hero'||xrActive)return;heroProgress.toggle();}
const patchNotes=createPatchNotes({entries:PATCH_NOTE_ENTRIES,mount:body,onOpen:()=>{patchNotesOpen=true;game?.clearControls();if(document.pointerLockElement)document.exitPointerLock?.();syncActive();},onClose:()=>{patchNotesOpen=false;syncActive();}});
const isTyping = target => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
// Capture phase on window runs before the game's listeners: typing never moves your hero.
for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, event => {
  if(roomBrowser.isOpen)return;
  if(event.key==='Escape'&&event.target.closest?.('.bf-bt-confirm'))return;
  if(patchNotes.isOpen){if(!patchNotes.root.contains(event.target))event.stopImmediatePropagation();return;} // the dialog owns its keys
  if(quartermaster.isOpen){if(!quartermaster.root.contains(event.target)){event.stopImmediatePropagation();if(type==='keydown'&&event.key==='Escape'){event.preventDefault();quartermaster.close();}}return;} // the shop owns its keys
  if(heroProgress.isOpen){if(!heroProgress.root.contains(event.target)){event.stopImmediatePropagation();if(type==='keydown'&&(event.key==='Escape'||event.code==='KeyN')){event.preventDefault();heroProgress.close();}}return;} // so does the Talents panel
  if(event.code==='F9'&&phase==='game'&&!isTyping(event.target)){event.preventDefault();event.stopImmediatePropagation();if(type==='keydown'&&!event.repeat)changePerspective();return;}
  if(quickBuildOpen&&!isTyping(event.target)){
    const trayKey=/^Digit[1-6]$/.test(event.code)||['KeyB','KeyC','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code);
    if(type==='keydown'&&trayKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey)return;
    if(['Tab','Enter','Space'].includes(event.code))return;
    event.stopImmediatePropagation();return;
  }
  if(type==='keydown'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!isTyping(event.target)&&phase==='game'&&connected&&!menuOpen&&!fieldKind&&!forgeOpen&&!xrActive){
    if(event.code==='KeyB'){event.preventDefault();event.stopImmediatePropagation();openQuickBuild();return;}
    if(event.code==='KeyT'&&currentRole==='hero'){event.preventDefault();event.stopImmediatePropagation();directTimberline();return;}
    if(event.code==='KeyN'&&currentRole==='hero'){event.preventDefault();event.stopImmediatePropagation();openTalents();return;}
  }
  // Pinned panels own their focus trap; gameplay is already inactive. Let their DOM key handler run.
  if(fieldPinned&&fieldOverlays?.root.contains(event.target))return;
  if (isTyping(event.target) || phase !== 'game' || menuOpen || fieldKind) {
    if (type === 'keydown' && menuOpen) trapMenuFocus(event);
    if (type === 'keydown' && event.key === 'Escape' && menuOpen) { event.preventDefault(); closeMenu(); }
    if (isTyping(event.target) || menuOpen || phase !== 'game' || fieldKind) event.stopPropagation();
    return;
  }

}, true);

// game.js owns the canvas pointer-lock gesture; duplicate requests can race.
document.addEventListener('pointerlockchange', updateLookHint);
function updateLookHint() {
  $('lookHint').hidden = !(phase === 'game' && connected && !menuOpen && !forgeOpen && !quickBuildOpen && !fieldKind && currentRole === 'hero' && document.pointerLockElement !== canvas && !xrActive && !mobile?.enabled);
}

$('vr').addEventListener('click', async () => {
  try { await game.enterVR(); }
  catch (error) { recordProblem(error); fail('VR couldn’t start. Make sure your headset is connected and awake, then try again.'); }
});

// ---------------------------------------------------------------- startup
window.addEventListener('error', event => { recordProblem(event.error || {message: event.message}); });
window.addEventListener('unhandledrejection', event => { recordProblem(event.reason); event.preventDefault(); });

rendererPromise=(async()=>{
try {
  await afterPaint();
  const {createGameAsync}=await import('./client/game.js');
  game = await createGameAsync({
    canvas,
    isHost, onSelection: chooseSpell,
    onVoicePose: pose => voice?.updatePose(pose),
    voiceActivity: () => voice?.active ? voice.activity() : null,
    onAction: (action, details = {}) => action==='placementFeedback'?fail(details.reason):action==='openWorkshop'?openForge():action==='openShop'?quartermaster.show():action==='projectileHit'?session?.projectileContact(details):command('action', {action, ...details}),
    onCast: (chosen, point, details={}) => command('cast', {spell: chosen, point,...details}),
    onInput: input => { if (session?.command('input', input)) inputs++; },
    onNotice: text => toast(text),
    onStatus: status => { rendererStatus = String(status); if(/^World renderer ready/.test(rendererStatus))rendererReady=true; if(/capture.*(blocked|failed)|requires a gesture|could not load|unavailable|preparation failed/i.test(rendererStatus))toast(rendererStatus); },
    onXRChange: value => { closeQuickBuild();restoreFieldLock=false;holdOverlays?.close();xrActive = value; if (!value) game?.setExpedition(null); body.classList.toggle('xr',value); syncActive(); },
    onMenu: openMenu,
    onExpeditionAction: expeditionAction,
    onAimProbe: (aim, state) => { interactionCue ??= createInteractionCueController($('hud'),point=>game.projectWorld(point)); const cue=interactionCue.sample(aim, state, lastSnapshot, playerId, menuOpen || forgeOpen || quickBuildOpen || !!fieldKind); mobile?.setCue(cue); },
  });
  const graphics=$('graphicsMode');graphics.value=store.get('branns-forge.graphics')||'auto';graphics.addEventListener('change',()=>game.setGraphicsMode(graphics.value));
  game.setDamageNumbers(store.get('branns-forge.damage-numbers')==='on');
  $('damageNumbers').checked=store.get('branns-forge.damage-numbers')==='on';
  game.setExpeditionPointerHand(store.get('branns-forge.vr.pointerHand') === 'left' ? 'left' : 'right');
  mobile = createMobileControls({game,canvas,onMenu:openMenu,notify:toast,onChange:()=>{updateLookHint();refreshFieldModel();},onExpeditionAction:expeditionAction});
  document.head.append($('compactStyles'));
  createMenuTabs();
  quietHud=mountQuietHud();
  const touchBuild=document.createElement('button');touchBuild.type='button';touchBuild.className='mui-btn mui-util qb-entry';touchBuild.dataset.qbToggle='';touchBuild.setAttribute('aria-label','Quick build');touchBuild.setAttribute('title','Quick build');touchBuild.innerHTML='<svg class="mui-icon" aria-hidden="true"><use href="#bfi-hammer"/></svg><span>Build</span>';touchBuild.addEventListener('click',openQuickBuild);document.querySelector('#touchControls .mui-util-bar')?.append(touchBuild);
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

})();

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
patchNotes.showWhatsNew();
if (ROOM_PATTERN.test(invited)) (nameInput.value ? $('create') : nameInput).focus({preventScroll: true});

// A host stepping away hands the world to someone still playing before its timers are throttled.
document.addEventListener('visibilitychange', () => { if (document.hidden) try { session?.handOver(); } catch { /* best effort */ } });
// Phones often skip beforeunload; pagehide is the last chance to tell the room we left.
window.addEventListener('pagehide', () => { try { session?.dispose(); } catch { /* closing */ } });
window.addEventListener('pageshow', event => { if (event.persisted && phase === 'game') location.reload(); });
window.addEventListener('beforeunload', () => { try { directory.dispose(); roomBrowser.dispose(); battlePanel.dispose(); voice?.dispose(); voiceControls.dispose(); quietHud?.dispose(); quickBuild?.dispose();forgePanel?.dispose();spellbook?.dispose();holdOverlays?.dispose();fieldOverlays?.dispose();fieldBuildTag.dispose();fieldToolsObserver.disconnect();hudHeaderObserver.disconnect();hudBottomObserver?.disconnect(); mobile?.dispose(); game?.dispose(); session?.dispose(); } catch { /* closing */ } });

// Read-only diagnostic evidence for browser QA; excludes reconnect credentials.
window.brannHarness = Object.freeze({
  state: () => ({phase, connected, solo:!!session?.connection.local, menuOpen, forgeOpen, quickBuildOpen, fieldOverlay:fieldKind, controlsActive: phase === 'game' && connected && !menuOpen && !patchNotesOpen && !forgeOpen && !quickBuildOpen && !fieldKind, touch:mobile?.enabled, xr:xrActive, playerId, role: appliedRole, snapshots, inputs, lastEvent, rendererReady, host: isHost()}),
  network: () => session ? {transport:session.connection.diagnostics?.() || null, simulation:{...session.metrics}} : null,
  voice: () => voice ? structuredClone({...voice.state(), pose:voice.pose}) : null,
  controls: () => game?.controlsSnapshot(),
  snapshot: () => lastSnapshot ? structuredClone(lastSnapshot) : null,
});
