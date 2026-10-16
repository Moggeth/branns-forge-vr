// Expedition Roguelite on the VR wrist panel. The DOM run dialog is invisible in WebXR, so this turns the run into the
// same view shape the Forge Expedition wrist panel already draws (client/vr-adventure-panel.js), with up to three
// trigger buttons for whatever the stage needs: a kit, a route choice, an upgrade, return or push on.
// Pure (no DOM, no Three): button ids are 'run:<action>:<value>' and runVrAction() turns one into a run command.
import {NODE_KINDS, RUN_TUNING, OMENS, routeChoices, nodeHaul, tradePrice, RUN_ENDED} from '../shared/expedition-run.js';
import {BOONS, KITS, KIT_IDS} from '../shared/run-boons.js';
import {runStripModel} from './run-panel.js';

const TONE = {camp: '#e0a64a', route: '#e0a64a', travel: '#ffb35a', fight: '#ff7a4a', reward: '#9fc8ff', decide: '#ffd36b', won: '#ffd36b', returned: '#c9b48a', fallen: '#9a8f86'};
const KIND_ICON = {skirmish: 'skull', elite: 'skull', treasure: 'gem', hold: 'star', shrine: 'flame', underways: 'stone', heart: 'flame', trader: 'gem'};
const short = (text, n = 16) => text.length > n ? `${text.slice(0, n - 1)}…` : text;

/** Wrist-panel view for the run, or null outside a run. */
export function runWristView(snapshot, playerId, {isHost = false} = {}) {
  const run = snapshot?.run; if (!run) return null;
  const players = snapshot.players || [], me = players.find(p => p.id === playerId), m = runStripModel(run, playerId, snapshot.enemies || []);
  const rows = [], buttons = [];
  let next = m.objective;
  const info = (icon, label) => rows.push({icon, label, have: 0, need: 0, done: false, info: true});
  if (run.stage === 'camp') {
    const kit = run.kits[playerId];
    if (me?.role === 'hero') {
      const nextKit = KIT_IDS[(KIT_IDS.indexOf(kit) + 1) % KIT_IDS.length];
      info('timber', kit ? `Kit: ${KITS[kit].name}. ${KITS[kit].text}` : 'Choose a starting kit, then set out');
      buttons.push({id: `run:kit:${nextKit}`, label: kit ? `Kit: ${short(KITS[nextKit].name, 12)}` : `Kit: ${KITS[KIT_IDS[0]].name}`});
    } else info('star', 'Gods pick God upgrades after each destination');
    if (run.omen && run.omen !== 'calm') info('star', `Omen: ${OMENS[run.omen]?.name}. ${OMENS[run.omen]?.text}`);
    buttons.push({id: 'run:begin:', label: 'Set out'});
    next = 'Pick a kit, then set out';
  } else if (run.stage === 'route') {
    for (const id of routeChoices(run)) {
      const n = run.nodes.find(q => q.id === id), k = NODE_KINDS[n.kind], mine = run.votes[playerId] === id;
      buttons.push({id: `run:route:${id}`, label: `${mine ? '✓ ' : ''}${short(k.name, 14)}`});
      info(KIND_ICON[n.kind] || 'star', n.kind === 'trader' ? `${k.name}: spend your haul` : `${k.name}: ◆ ${nodeHaul(run, n)}`);
    }
    next = 'Vote for the next destination';
  } else if (run.stage === 'reward') {
    const offer = run.offers[playerId] || [], picked = run.picks[playerId], at = run.nodes.find(q => q.id === run.at);
    if (at?.kind === 'trader') {
      // The smith: the two upgrades the party can afford (cheapest first) and a button to keep the Embers.
      const wares = offer.map(id => ({id, price: tradePrice(run, at, id)})).sort((a, b) => a.price - b.price);
      for (const {id, price} of wares) info('gem', `${BOONS[id].name} ◆ ${price}: ${BOONS[id].text}`);
      if (!picked) { for (const {id, price} of wares.filter(w => w.price <= run.haul).slice(0, 2)) buttons.push({id: `run:boon:${id}`, label: `${short(BOONS[id].name, 10)} ◆${price}`}); buttons.push({id: 'run:skip:', label: 'Keep Embers'}); }
      next = picked === 'skip' ? 'Kept your Embers. Waiting for the party' : picked ? `Bought ${BOONS[picked]?.name}. Waiting for the party` : `The Wandering Smith · haul ◆ ${run.haul}`;
    } else {
      for (const id of offer) { const b = BOONS[id]; info('star', `${b.name}: ${b.text}`); if (!picked) buttons.push({id: `run:boon:${id}`, label: short(b.name, 14)}); }
      next = picked ? `Chose ${BOONS[picked]?.name}. Waiting for the party` : 'Choose one upgrade for this run';
    }
  } else if (run.stage === 'decide') {
    info('path', `Haul ◆ ${run.haul} · ${run.lives} spare li${run.lives === 1 ? 'fe' : 'ves'}`);
    info('skull', `Push on: ×${(run.mult + RUN_TUNING.pushMult).toFixed(2)} haul, more danger`);
    const vote = run.votes[playerId];
    buttons.push({id: 'run:decide:return', label: `${vote === 'return' ? '✓ ' : ''}Return`}, {id: 'run:decide:push', label: `${vote === 'push' ? '✓ ' : ''}Push on`});
    next = 'Bank the haul, or push on?';
  } else if (RUN_ENDED.includes(run.stage)) {
    const r = run.result || {};
    info('gem', `Banked ◆ ${r.banked ?? 0} Embers`); info('skull', `${r.kills ?? 0} foes · ${r.path?.length ?? 0} destinations`);
    if (isHost) buttons.push({id: 'run:again:', label: 'New run'});
    buttons.push({id: 'run:leave:', label: 'Leave'});
    next = m.title;
  }
  const objective = m.progress !== null ? [{icon: KIND_ICON[m.kind] || 'star', label: m.objective, have: Math.round(m.progress * 100), need: 100, done: false}] : [];
  return {mode: 'run', stage: run.stage, title: `${m.format} · ${m.title}`, tone: TONE[run.stage], nextStep: next,
    objectives: [...objective, ...rows].slice(0, 3), telegraphs: [], notice: run.notice, elapsedSeconds: Math.floor(run.elapsed / 60),
    party: {heroes: players.filter(p => p.role === 'hero').length, gods: players.filter(p => p.role === 'god').length},
    actions: [], buttons: buttons.slice(0, 3), track: [], carry: [['gem', run.haul], ['flame', run.lives]]};
}

/** Turns a wrist button id into a run command: {action, payload} | {local:'again'|'leave'} | null. */
export function runVrAction(id) {
  const [ns, action, value] = String(id).split(':');
  if (ns !== 'run') return null;
  if (action === 'again' || action === 'leave') return {local: action};
  if (action === 'kit') return {action, payload: {kit: value}};
  if (action === 'begin' || action === 'skip') return {action, payload: {}};
  if (action === 'route') return {action, payload: {node: value}};
  if (action === 'boon') return {action, payload: {boon: value}};
  if (action === 'decide') return {action, payload: {choice: value}};
  return null;
}
