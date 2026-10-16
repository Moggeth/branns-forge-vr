// Expedition Roguelite interface: the run strip (always on during a run), the stage dialog (camp kits, route map,
// upgrade cards, return-or-push-on vote, end card), the Hall of Embers and the launch panel on the welcome screen.
// DOM only, phone-first (large tap targets, one column under 520 px). Reads the authoritative run from snapshots
// (shared/expedition-run.js) and sends {type:'run'} commands; it never decides anything itself.
// Panels re-render only when their content signature changes, so votes and timers never steal a tap mid-press.
import {NODE_KINDS, RUN_FORMATS, RUN_TUNING, BOSSES, routeChoices, nodeHaul, RUN_ENDED, dailySeed} from '../shared/expedition-run.js';
import {BOONS, KITS, KIT_IDS, HALL, HALL_IDS} from '../shared/run-boons.js';
import {enemyMaxHp} from '../shared/combat.js';
import {worldDescriptor} from '../shared/worldgen/registry.js';
import {friendlySeed} from '../shared/worldgen/random.js';
import {loadRunMeta, saveRunMeta, buyHall, hallCost, creditRun, runKey, todayUtc} from './run-meta.js';

const HZ = 60;
// 24x24 single-path glyphs (evenodd).
export const RUN_ICONS = Object.freeze({
  skirmish: 'M4 3l7 7-1.5 1.5L6 8v3L3 8V5zm16 0v2l-3 3V8l-3.5 3.5L12 10l7-7zM9.5 13.5 12 16l-6 6-3-3zm5 0L21 19l-3 3-6-6z',
  elite: 'M12 2a8 8 0 0 0-8 8v4l2 2v4h3v-2h2v2h2v-2h2v2h3v-4l2-2v-4a8 8 0 0 0-8-8zm-3.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  treasure: 'M7 3h10l5 6-10 12L2 9zm1.5 2L5 9h4.5L11 5zm5.5 0 1.5 4H19l-3.5-4zM12 17l3-7H9z',
  hold: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5zm0 3-5 2v4c0 3.4 2.1 6.4 5 7.8 2.9-1.4 5-4.4 5-7.8V7z',
  shrine: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9zm0 11c-1 1.5-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-1-2.5-2-4z',
  underways: 'M3 21V10l9-7 9 7v11h-5v-5h-2v-3h-4v3H8v5zm5-2h2v-3H8zm6 0h2v-3h-2z',
  heart: 'M3 8l4 3 5-7 5 7 4-3-2 12H5zm3.6 10h10.8l.9-5.6-2.3 1.7L12 8.6 8 14.1l-2.3-1.7z',
  ember: 'M12 2c1.2 3.6 5.5 5.4 5.5 10.6A5.5 5.5 0 0 1 6.5 12.6c0-2.6 1.6-4.3 2.6-5.2.1 1.8.9 2.7 1.8 2.7 0-3.4-.6-5.4 1.1-8.1z',
  camp: 'M12 3 2 20h20zm0 5 5.5 10h-3L12 13l-2.5 5h-3z',
  hp: 'M12 21 3.5 12.7A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.7z',
  damage: 'M14 3h7v7l-9.5 9.5-2 2L8 20l-3 3-2-2 3-3-1.5-1.5 2-2zm1.5 2-8 8 3.5 3.5 8-8V5z',
  speed: 'M5 5h8l-2 4h6L8 21l2-8H5z',
  regen: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  armor: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z',
  xp: 'M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3l-5.8 3.5 1.6-6.6L2.6 8.8l6.8-.5z',
  gold: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-1 2h2v1.2c1 .3 1.8 1 2 2h-2c-.1-.4-.5-.7-1-.7s-1 .3-1 .8c0 1.5 4 .9 4 3.7 0 1.1-.8 1.9-2 2.2V18h-2v-1.2c-1.1-.3-1.9-1.1-2-2.3h2c.1.5.5.8 1 .8.6 0 1-.3 1-.8 0-1.6-4-1-4-3.7 0-1.1.8-1.9 2-2.2z',
  flask: 'M9 2h6v2h-1v4.5l5.5 9.5A2.5 2.5 0 0 1 17.3 22H6.7a2.5 2.5 0 0 1-2.2-4l5.5-9.5V4H9z',
  mana: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zm6 11 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z',
  lives: 'M12 2c1.2 3.6 5.5 5.4 5.5 10.6A5.5 5.5 0 0 1 6.5 12.6c0-2.6 1.6-4.3 2.6-5.2.1 1.8.9 2.7 1.8 2.7 0-3.4-.6-5.4 1.1-8.1z',
  axe: 'M14 2c4 1 7 4 8 8l-6 2-2-2-8 12-2-1 8-12-2-2z',
  pick: 'M3 7c5-4 13-4 18 0l-1 1.5c-2-1.3-4-2-6-2.4L5 21l-2-1 8.6-14.4C9 5.9 6.6 6.7 4.5 8z',
  crossbow: 'M3 11h18v2H3zm8-8h2v18h-2zM5 5l2-2 12 12-2 2zM5 19 17 7l2 2L7 21z',
});
const BOON_ICON = b => b.lives ? 'lives' : b.mana ? 'mana' : b.xp ? 'xp' : b.lifesteal ? 'hp' : b.damage ? 'damage' : b.hp ? 'hp' : b.speed ? 'speed' : b.regen ? 'regen' : b.armor ? 'armor' : b.goldPerKill ? 'gold' : b.draughts ? 'flask' : 'ember';
const STAGE_TITLE = {camp: 'Camp', route: 'Choose the route', travel: 'Travel', fight: 'Fight', reward: 'Choose an upgrade', decide: 'Return or push on', won: 'Victory', returned: 'Home safe', fallen: 'The party fell'};
const OUTCOME = {won: ['The Heart is won!', 'Your whole haul is banked twice over.'], returned: ['Home safe', 'You turned back in time and banked the whole haul.'], fallen: ['The party fell', 'A quarter of the haul made it home.']};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', RUN_ICONS[name] || RUN_ICONS.ember); p.setAttribute('fill', 'currentColor'); p.setAttribute('fill-rule', 'evenodd');
  svg.append(p); return svg;
}
const button = (cls, text, onClick, {disabled = false, title = ''} = {}) => { const b = el('button', `btn ${cls}`, text); b.type = 'button'; b.disabled = disabled; if (title) b.title = title; b.addEventListener('click', onClick); return b; };
const clock = secs => `${Math.floor(secs / 60)}:${String(Math.max(0, Math.floor(secs % 60))).padStart(2, '0')}`;
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

/**
 * Options for the next run from this one. On a generated world a new run gets a fresh world of the same preset and
 * size (the world resets with the run); "same seed again" replays the same world and route exactly.
 */
export function nextRunOptions(snapshot, {seed, same = false} = {}) {
  const run = snapshot?.run, world = snapshot?.world;
  const base = same && run ? {format: run.format, seed: run.seed, daily: run.daily} : {format: 'expedition', seed};
  if (!world) return base;
  return {...base, world: same ? world : worldDescriptor({kind: 'expedition', seed: friendlySeed(seed), preset: world.preset, size: world.size})};
}

/** Pure model of the strip, so tests and the VR panel can share it. */
export function runStripModel(run, viewerId = '', enemies = []) {
  if (!run) return null;
  const n = run.nodes.find(q => q.id === (run.target || run.at));
  const kind = n ? NODE_KINDS[n.kind] : null;
  let objective = '', progress = null;
  if (run.stage === 'travel' && n) objective = `Head for the ${kind.name}${n.kind === 'heart' ? '' : ` · tier ${n.tier + 1}`}`;
  else if (run.stage === 'fight' && n) {
    if (n.kind === 'hold') { objective = 'Hold the ward circle'; progress = run.objective.need ? run.objective.have / run.objective.need : 0; }
    else if (n.kind === 'treasure') { objective = `Crack the star shards ${run.objective.have}/${run.objective.need}`; progress = run.objective.need ? run.objective.have / run.objective.need : 0; }
    else if (n.kind === 'heart') {
      const boss = enemies.find(e => typeof e.boss === 'string'), max = boss ? enemyMaxHp(boss) : 1;
      objective = boss ? `${BOSSES[boss.boss]?.name || 'Guardian'} · ${run.foes.length - 1} guard${run.foes.length === 2 ? '' : 's'}` : `${run.foes.length} foe${run.foes.length === 1 ? '' : 's'} left`;
      progress = boss ? Math.max(0, boss.hp) / max : null;
    } else if (n.kind === 'underways' && run.delve) objective = run.objective.have ? 'Hoard won! Take the way out' : 'Delve: find the guardian and its hoard';
    else objective = `${run.foes.length} foe${run.foes.length === 1 ? '' : 's'} left`;
  } else objective = STAGE_TITLE[run.stage] || '';
  return {format: RUN_FORMATS[run.format]?.name || 'Expedition', seed: run.seed, stage: run.stage, title: STAGE_TITLE[run.stage], objective, progress,
    lives: run.lives, maxLives: run.maxLives, haul: run.haul, mult: run.mult, tier: run.path.length, tiers: RUN_TUNING.tiers, notice: run.notice, kind: n?.kind || 'camp', ended: RUN_ENDED.includes(run.stage)};
}

/**
 * createRunHud({parent, command(action, payload), isHost(), newRun({format, seed, daily}), leave(), toast(text), onModal(open)})
 * update(snapshot, playerId) every snapshot.
 */
export function createRunHud({parent, command, isHost = () => false, newRun = () => {}, leave = () => {}, toast = () => {}, onModal = () => {}}) {
  let meta = loadRunMeta(), lastRun = null, lastSnap = null, viewer = '', sig = '', modalStage = '', hidden = false, hallSent = '', creditNote = null, routeFocus = '';
  // ---- strip ----
  const strip = el('div', 'rx-strip'); strip.hidden = true; strip.setAttribute('role', 'status');
  const sLeft = el('div', 'rx-strip-id'), sMid = el('div', 'rx-strip-mid'), sRight = el('div', 'rx-strip-score');
  const sKind = el('span', 'rx-strip-kind'), sObj = el('span', 'rx-strip-obj'), sBar = el('span', 'rx-strip-bar'), sFill = el('span', 'rx-strip-fill');
  sBar.append(sFill); sMid.append(sKind, sObj, sBar);
  const sLives = el('span', 'rx-lives'), sHaul = el('span', 'rx-haul');
  sRight.append(sLives, sHaul);
  const sOpen = button('rx-strip-open', 'Open', () => { hidden = false; sig = ''; render(); });
  strip.append(sLeft, sMid, sRight, sOpen);
  // ---- stage dialog ----
  const backdrop = el('div', 'rx-backdrop'); backdrop.hidden = true;
  const dialog = el('section', 'rx-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1;
  backdrop.append(dialog);
  // ---- Hall of Embers ----
  const hallBack = el('div', 'rx-backdrop rx-hall-backdrop'); hallBack.hidden = true;
  const hallDialog = el('section', 'rx-dialog rx-hall'); hallDialog.setAttribute('role', 'dialog'); hallDialog.setAttribute('aria-modal', 'true'); hallBack.append(hallDialog);
  parent.append(strip, backdrop, hallBack);

  function setModal(open) { const was = !backdrop.hidden || !hallBack.hidden; backdrop.hidden = !open; if (was !== (open || !hallBack.hidden)) onModal(open || !hallBack.hidden); }
  const send = (action, payload = {}) => command(action, payload);

  function header(title, sub, ico) {
    const h = el('header', 'rx-head'), badge = el('span', 'rx-head-ico'); badge.append(icon(ico, 28));
    const t = el('div', 'rx-head-text'); t.append(el('h2', 'rx-title', title)); if (sub) t.append(el('p', 'rx-lede', sub));
    const min = button('btn-quiet rx-min', 'Hide', () => { hidden = true; setModal(false); render(); }, {title: 'Hide this panel (reopen from the run bar)'});
    h.append(badge, t); if (!RUN_ENDED.includes(lastRun?.stage)) h.append(min);
    return h;
  }
  function timerNote(run, total, label) {
    const p = el('p', 'rx-timer'); p.dataset.total = total; p.dataset.label = label; return p;
  }

  // ---- camp: starting kits ----
  function campView(run, me, players) {
    const box = el('div', 'rx-body');
    box.append(header('Expedition camp', `Seed ${run.seed}${run.daily ? ` · Daily ${run.daily}` : ''}. Choose a starting kit, then set out. Reach and defeat the Heart, or turn back in time to bank your haul.`, 'camp'));
    const scroll = el('div', 'rx-scroll');
    if (me?.role === 'hero') {
      scroll.append(el('h3', 'rx-sub', 'Your starting kit'));
      const grid = el('div', 'rx-cards');
      for (const id of KIT_IDS) {
        const k = KITS[id], picked = run.kits[viewer] === id;
        const card = el('button', `rx-card rx-kit${picked ? ' rx-picked' : ''}`); card.type = 'button'; card.setAttribute('aria-pressed', String(picked));
        const top = el('span', 'rx-card-top'); top.append(icon(k.tool, 30)); top.append(el('span', 'rx-card-name', k.name));
        card.append(top, el('span', 'rx-card-text', k.text), el('span', 'rx-card-foot', `Starts with ${BOONS[k.boon].name}`));
        card.addEventListener('click', () => send('kit', {kit: id}));
        grid.append(card);
      }
      scroll.append(grid);
    } else scroll.append(el('p', 'rx-note', 'Gods guide the party from above and pick God upgrades after each destination.'));
    const party = el('ul', 'rx-party');
    for (const p of players) { const li = el('li'); li.append(icon(p.role === 'god' ? 'mana' : KITS[run.kits[p.id]]?.tool || 'camp', 16), el('span', '', `${p.name}${p.id === viewer ? ' (you)' : ''}`), el('em', '', p.role === 'god' ? 'God' : KITS[run.kits[p.id]]?.name || 'Choosing…')); party.append(li); }
    scroll.append(el('h3', 'rx-sub', 'The party'), party);
    const rules = el('details', 'rx-rules'); rules.append(el('summary', '', 'What resets and what you keep'));
    rules.append(el('p', '', 'Each run resets the world, your level, talents, upgrades, kit, pack and the haul you carry. You keep the Embers you bank, your Hall of Embers unlocks, the codex and your best runs.'));
    scroll.append(rules);
    const foot = el('footer', 'rx-foot');
    foot.append(button('btn-quiet', 'Hall of Embers', openHall), button('btn-primary rx-go', 'Set out', () => send('begin')));
    box.append(scroll, foot);
    return box;
  }

  // ---- route map ----
  function routeView(run, players) {
    const box = el('div', 'rx-body'), choices = routeChoices(run);
    box.append(header(run.at ? 'Choose the next destination' : 'Choose your first destination', `Danger and rewards rise with every tier. Haul multiplier ×${run.mult.toFixed(2)}.`, 'skirmish'));
    const scroll = el('div', 'rx-scroll');
    const map = el('div', 'rx-map'), tiers = RUN_TUNING.tiers;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'rx-links'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    const pos = new Map();
    for (let t = 0; t < tiers; t++) { const row = run.nodes.filter(n => n.tier === t); row.forEach((n, i) => pos.set(n.id, [(t + .5) / tiers * 100, (i + .5) / row.length * 100])); }
    const visited = new Set(run.path);
    const campAt = [-4, 50];
    const line = (a, b, cls) => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]); l.setAttribute('class', cls); l.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(l); };
    for (const n of run.nodes.filter(q => q.tier === 0)) line(campAt, pos.get(n.id), run.path[0] === n.id ? 'rx-l-done' : !run.at ? 'rx-l-open' : 'rx-l-off');
    for (const n of run.nodes) for (const m of n.next) line(pos.get(n.id), pos.get(m), visited.has(n.id) && visited.has(m) ? 'rx-l-done' : n.id === run.at ? 'rx-l-open' : 'rx-l-off');
    map.append(svg);
    const votes = {}; for (const [id, c] of Object.entries(run.votes)) if (players.some(p => p.id === id)) (votes[c] ??= []).push(id);
    for (const n of run.nodes) {
      const [x, y] = pos.get(n.id), open = choices.includes(n.id), done = visited.has(n.id), mine = run.votes[viewer] === n.id;
      const b = el('button', `rx-node rx-k-${n.kind}${open ? ' rx-open' : ''}${done ? ' rx-done' : ''}${mine ? ' rx-mine' : ''}${routeFocus === n.id ? ' rx-focus' : ''}`);
      b.type = 'button'; b.style.left = `${x}%`; b.style.top = `${y}%`; b.disabled = !open && !done && routeFocus !== n.id && false;
      b.setAttribute('aria-label', `${NODE_KINDS[n.kind].name}, tier ${n.tier + 1}${open ? ', open' : done ? ', visited' : ''}`);
      b.append(icon(n.kind, n.kind === 'heart' ? 28 : 22));
      if (votes[n.id]) { const v = el('span', 'rx-votes', String(votes[n.id].length)); b.append(v); }
      b.addEventListener('click', () => { routeFocus = n.id; sig = ''; render(); });
      map.append(b);
    }
    scroll.append(map);
    const focus = run.nodes.find(n => n.id === routeFocus) || run.nodes.find(n => n.id === choices[0]);
    if (focus) {
      const card = el('div', `rx-detail rx-k-${focus.kind}`), top = el('div', 'rx-detail-top');
      top.append(icon(focus.kind, 26), el('strong', '', NODE_KINDS[focus.kind].name), el('span', 'rx-tier', focus.kind === 'heart' ? 'Final' : `Tier ${focus.tier + 1}`));
      card.append(top, el('p', '', focus.kind === 'heart' ? `${NODE_KINDS.heart.text} Guardian: ${BOSSES[run.boss].name}. ${BOSSES[run.boss].text}` : NODE_KINDS[focus.kind].text));
      card.append(el('p', 'rx-reward', `Haul: about ${nodeHaul(run, focus)} Embers${focus.kind === 'heart' ? ', and the whole haul doubles' : ''}`));
      const open = choices.includes(focus.id);
      if (open) card.append(button('btn-primary rx-go', run.votes[viewer] === focus.id ? 'Your vote is in' : players.length > 1 ? 'Vote for this route' : 'Go here', () => send('route', {node: focus.id}), {disabled: run.votes[viewer] === focus.id}));
      else card.append(el('p', 'rx-note', run.path.includes(focus.id) ? 'Already cleared.' : 'Not reachable from here.'));
      scroll.append(card);
    }
    if (players.length > 1) scroll.append(timerNote(run, RUN_TUNING.vote, 'The route is chosen in'));
    box.append(scroll);
    return box;
  }

  // ---- upgrade cards ----
  function rewardView(run, me) {
    const box = el('div', 'rx-body'), offer = run.offers[viewer] || [], picked = run.picks[viewer];
    const n = run.nodes.find(q => q.id === run.at);
    box.append(header(picked ? 'Upgrade chosen' : 'Choose an upgrade', n ? `${NODE_KINDS[n.kind].name} cleared. Upgrades last until the run ends.` : '', 'xp'));
    const scroll = el('div', 'rx-scroll'), grid = el('div', 'rx-cards');
    for (const id of offer) {
      const b = BOONS[id], chosen = picked === id;
      const card = el('button', `rx-card rx-boon rx-t-${b.tier}${chosen ? ' rx-picked' : ''}`); card.type = 'button'; card.disabled = !!picked && !chosen;
      const top = el('span', 'rx-card-top'); top.append(icon(BOON_ICON(b), 30), el('span', 'rx-card-name', b.name));
      card.append(el('span', 'rx-tierflag', b.tier), top, el('span', 'rx-card-text', b.text));
      card.addEventListener('click', () => { if (!picked) send('boon', {boon: id}); });
      grid.append(card);
    }
    scroll.append(grid);
    if (!picked && run.rerolls[viewer] > 0) scroll.append(button('btn-quiet rx-reroll', `Reroll (${run.rerolls[viewer]} left)`, () => send('reroll')));
    if (me?.runBoons?.length) { const have = el('p', 'rx-note'); have.textContent = `Your upgrades: ${me.runBoons.map(id => BOONS[id]?.name).filter(Boolean).join(', ')}`; scroll.append(have); }
    scroll.append(timerNote(run, RUN_TUNING.pick, picked ? 'Waiting for the party ·' : 'Picked for you in'));
    box.append(scroll);
    return box;
  }

  // ---- return or push on ----
  function decideView(run, players) {
    const box = el('div', 'rx-body'), next = run.nodes.find(n => n.id === run.at)?.next.map(id => run.nodes.find(n => n.id === id)) || [];
    box.append(header('Return or push on?', 'Turning back banks everything you carry. Pushing on raises the danger and the haul.', 'ember'));
    const scroll = el('div', 'rx-scroll'), row = el('div', 'rx-choice');
    const votes = c => Object.entries(run.votes).filter(([id, v]) => v === c && players.some(p => p.id === id)).length;
    const back = el('button', `rx-card rx-decide rx-return${run.votes[viewer] === 'return' ? ' rx-picked' : ''}`); back.type = 'button';
    const bTop = el('span', 'rx-card-top'); bTop.append(icon('camp', 30), el('span', 'rx-card-name', 'Return to camp'));
    back.append(bTop, el('span', 'rx-big', `Bank ${run.haul}`), el('span', 'rx-card-text', 'End the run safely with your whole haul.'), el('span', 'rx-card-foot', `${votes('return')} vote${votes('return') === 1 ? '' : 's'}`));
    back.addEventListener('click', () => send('decide', {choice: 'return'}));
    const push = el('button', `rx-card rx-decide rx-push${run.votes[viewer] === 'push' ? ' rx-picked' : ''}`); push.type = 'button';
    const pTop = el('span', 'rx-card-top'); pTop.append(icon(next.some(n => n?.kind === 'heart') ? 'heart' : 'skirmish', 30), el('span', 'rx-card-name', next.some(n => n?.kind === 'heart') ? 'Face the Heart' : 'Push on'));
    push.append(pTop, el('span', 'rx-big', `×${(run.mult + RUN_TUNING.pushMult).toFixed(2)}`), el('span', 'rx-card-text', `Next: ${next.filter(Boolean).map(n => NODE_KINDS[n.kind].name).join(' or ')}. Falling keeps only a quarter.`), el('span', 'rx-card-foot', `${votes('push')} vote${votes('push') === 1 ? '' : 's'}`));
    push.addEventListener('click', () => send('decide', {choice: 'push'}));
    row.append(back, push); scroll.append(row);
    scroll.append(el('p', 'rx-note', `${run.lives} spare li${run.lives === 1 ? 'fe' : 'ves'} left. Ties turn back.`));
    if (players.length > 1) scroll.append(timerNote(run, RUN_TUNING.decide, 'The party decides in'));
    box.append(scroll);
    return box;
  }

  // ---- end card ----
  function endView(run) {
    const r = run.result, [title, line] = OUTCOME[run.stage] || ['Run over', ''];
    const box = el('div', `rx-body rx-end rx-end-${run.stage}`);
    box.append(header(title, line, run.stage === 'won' ? 'heart' : run.stage === 'returned' ? 'camp' : 'ember'));
    const scroll = el('div', 'rx-scroll');
    const banked = el('div', 'rx-banked'); banked.append(icon('ember', 34), el('strong', '', `+${r.banked}`), el('span', '', 'Embers banked'));
    scroll.append(banked);
    if (creditNote) scroll.append(el('p', 'rx-note', creditNote));
    const stats = el('dl', 'rx-stats');
    for (const [k, v] of [['Destinations', `${r.tier}`], ['Haul carried', `${r.haul}`], ['Foes felled', `${r.kills}`], ['Falls', `${r.deaths}`], ['Time', clock(r.time)], ['Seed', `${run.seed}`]]) { stats.append(el('dt', '', k), el('dd', '', v)); }
    scroll.append(stats);
    const path = el('div', 'rx-path'); for (const k of r.path) { const s = el('span', `rx-path-step rx-k-${k}`); s.append(icon(k, 18)); s.title = NODE_KINDS[k].name; path.append(s); }
    scroll.append(path);
    const foot = el('footer', 'rx-foot rx-foot-wrap');
    if (isHost()) {
      foot.append(button('btn-primary', 'New expedition', () => newRun(nextRunOptions(lastSnap, {seed: randomSeed()}))));
      foot.append(button('btn', 'Same seed again', () => newRun(nextRunOptions(lastSnap, {same: true}))));
    } else foot.append(el('p', 'rx-note', 'The host can start the next run.'));
    foot.append(button('btn-quiet', 'Hall of Embers', openHall), button('btn-quiet', 'Leave', leave));
    box.append(scroll, foot);
    return box;
  }

  // ---- Hall of Embers ----
  function renderHall() {
    hallDialog.replaceChildren();
    const h = el('header', 'rx-head'), badge = el('span', 'rx-head-ico'); badge.append(icon('ember', 28));
    const t = el('div', 'rx-head-text'); t.append(el('h2', 'rx-title', 'Hall of Embers'), el('p', 'rx-lede', `${meta.embers} Embers to spend. Unlocks are permanent and apply when you join a run.`));
    h.append(badge, t, button('btn-quiet rx-min', 'Close', closeHall));
    const scroll = el('div', 'rx-scroll'), list = el('div', 'rx-hall-list');
    for (const id of HALL_IDS) {
      const u = HALL[id], lv = meta.hall[id] || 0, cost = hallCost(meta, id);
      const row = el('div', 'rx-hall-row'), text = el('div', 'rx-hall-text'), pips = el('span', 'rx-pips');
      for (let i = 0; i < u.max; i++) pips.append(el('span', i < lv ? 'rx-pip rx-pip-on' : 'rx-pip'));
      text.append(el('strong', '', u.name), pips, el('span', '', u.text));
      row.append(text, cost === null ? el('span', 'rx-maxed', 'Mastered') : button(meta.embers >= cost ? 'btn-primary' : 'btn', `${cost}`, () => { const r = buyHall(meta, id); if (r.ok) { saveRunMeta(meta); toast(`${u.name} unlocked${u.max > 1 ? ` (level ${r.level})` : ''}.`); } else if (r.code === 'too_poor') toast(`You need ${r.need} more Embers.`); renderHall(); }, {disabled: meta.embers < cost}));
      list.append(row);
    }
    scroll.append(list);
    const stats = el('p', 'rx-note', `Lifetime Embers: ${meta.lifetime}${meta.best ? ` · Best run: ${meta.best.banked} (seed ${meta.best.seed})` : ''}${meta.codex.bosses.length ? ` · Guardians beaten: ${meta.codex.bosses.map(b => BOSSES[b]?.name || b).join(', ')}` : ''}`);
    scroll.append(stats);
    hallDialog.append(h, scroll);
  }
  function openHall() { meta = loadRunMeta(); renderHall(); hallBack.hidden = false; onModal(true); }
  function closeHall() { hallBack.hidden = true; onModal(!backdrop.hidden); }

  function signature(run, players, me) {
    const live = players.map(p => p.id).join();
    if (run.stage === 'camp') return `camp|${JSON.stringify(run.kits)}|${live}|${me?.role}`;
    if (run.stage === 'route') return `route|${run.at}|${JSON.stringify(run.votes)}|${live}|${routeFocus}|${run.mult}`;
    if (run.stage === 'reward') return `reward|${run.at}|${JSON.stringify(run.offers[viewer])}|${run.picks[viewer] || ''}|${run.rerolls[viewer] || 0}|${(me?.runBoons || []).length}`;
    if (run.stage === 'decide') return `decide|${run.at}|${JSON.stringify(run.votes)}|${run.lives}|${live}`;
    if (RUN_ENDED.includes(run.stage)) return `end|${run.stage}|${creditNote}|${isHost()}`;
    return '';
  }
  function render() {
    const run = lastRun, players = lastSnap?.players || [], me = players.find(p => p.id === viewer);
    if (!run) { strip.hidden = true; setModal(false); return; }
    // Strip
    const m = runStripModel(run, viewer, lastSnap?.enemies || []);
    strip.hidden = false; strip.dataset.stage = run.stage;
    setText(sLeft, `${m.format} · ${m.seed}`);
    sKind.replaceChildren(icon(m.kind === 'camp' ? 'camp' : m.kind, 16));
    setText(sObj, m.objective);
    sBar.hidden = m.progress === null; sFill.style.transform = `scaleX(${m.progress ?? 0})`;
    if (sLives.dataset.v !== `${m.lives}/${m.maxLives}`) { sLives.dataset.v = `${m.lives}/${m.maxLives}`; sLives.replaceChildren(icon('lives', 16), el('b', '', String(m.lives))); sLives.title = `${m.lives} spare li${m.lives === 1 ? 'fe' : 'ves'}`; }
    setText(sHaul, `◆ ${m.haul}${m.mult > 1 ? ` ×${m.mult.toFixed(2)}` : ''}`);
    // Dialog
    const modal = ['camp', 'route', 'reward', 'decide', ...RUN_ENDED].includes(run.stage);
    if (modalStage !== run.stage) { modalStage = run.stage; hidden = false; routeFocus = ''; sig = ''; }
    sOpen.hidden = !(modal && hidden);
    if (!modal || hidden) { setModal(false); return; }
    const next = signature(run, players, me);
    if (next !== sig) {
      sig = next;
      const view = run.stage === 'camp' ? campView(run, me, players) : run.stage === 'route' ? routeView(run, players) : run.stage === 'reward' ? rewardView(run, me) : run.stage === 'decide' ? decideView(run, players) : endView(run);
      dialog.replaceChildren(view);
    }
    setModal(true);
    tickTimers();
  }
  function tickTimers() {
    const run = lastRun; if (!run) return;
    for (const p of dialog.querySelectorAll('.rx-timer')) {
      const total = Number(p.dataset.total), started = run.stage === 'reward' ? 0 : Object.keys(run.votes).length ? run.firstVote : null;
      setText(p, started === null ? 'Waiting for the first vote.' : `${p.dataset.label} ${Math.max(0, Math.ceil((total - (run.elapsed - started)) / HZ))} s`);
    }
  }
  const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000;

  return {
    update(snapshot, playerId) {
      lastSnap = snapshot; viewer = playerId; const run = snapshot?.run || null;
      const prev = lastRun; lastRun = run;
      if (run) {
        // Send this device's Hall unlocks once per run (the host clamps and applies them when the run sets out).
        const key = `${snapshot.room}:${run.seed}:${run.format}`;
        if (hallSent !== key && playerId && snapshot.players.some(p => p.id === playerId) && !run.applied[playerId]) { hallSent = key; meta = loadRunMeta(); if (Object.keys(meta.hall).length) send('hall', {hall: meta.hall}); }
        if (RUN_ENDED.includes(run.stage) && (!prev || !RUN_ENDED.includes(prev.stage) || !creditNote)) {
          meta = loadRunMeta();
          const me = snapshot.players.find(p => p.id === playerId);
          const r = creditRun(meta, run, {boons: me?.runBoons || [], key: runKey(run, snapshot.room)});
          if (r.credited) { saveRunMeta(meta); creditNote = `${r.amount} Embers banked. You now have ${meta.embers}.${r.newBest ? ' A new best run!' : ''}${r.dailyBest ? ' Your best daily haul today!' : ''}`; }
          else if (!creditNote) creditNote = `You have ${meta.embers} Embers.`;
        }
        if (!RUN_ENDED.includes(run.stage)) creditNote = null;
      }
      render();
    },
    handleEvent(e) {
      if (!lastRun) return;
      if (e.kind === 'run_life') toast(e.lives > 0 ? `An Ember gutters out. ${e.lives} spare li${e.lives === 1 ? 'fe' : 'ves'} left.` : 'Last Ember! One more fall ends the run.');
      else if (e.kind === 'run_cleared') toast(`Destination cleared: +${e.haul} Embers to the haul.`);
      else if (e.kind === 'run_spawn' && e.boss) toast(`${BOSSES[e.boss]?.name || 'The guardian'} awakens!`);
    },
    openHall, closeHall,
    get modal() { return !backdrop.hidden || !hallBack.hidden; },
    get active() { return !!lastRun; },
    dispose() { strip.remove(); backdrop.remove(); hallBack.remove(); },
  };
}

/** The welcome-screen launcher: pick a format and seed, see your Embers, open the Hall. */
export function createRunLauncher({parent, onStart, openHall}) {
  const back = el('div', 'rx-backdrop rx-launch-backdrop'); back.hidden = true;
  const dialog = el('section', 'rx-dialog rx-launch'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  back.append(dialog); parent.append(back);
  let format = 'expedition';
  function render() {
    const meta = loadRunMeta(), today = todayUtc();
    dialog.replaceChildren();
    const h = el('header', 'rx-head'), badge = el('span', 'rx-head-ico'); badge.append(icon('heart', 28));
    const t = el('div', 'rx-head-text'); t.append(el('h2', 'rx-title', 'Expedition Roguelite'), el('p', 'rx-lede', 'Experimental. Short seeded adventures: pick a route, grow stronger, then bank your haul or push on toward the Heart.'));
    h.append(badge, t, button('btn-quiet rx-min', 'Close', close));
    const scroll = el('div', 'rx-scroll'), grid = el('div', 'rx-cards rx-formats');
    for (const id of Object.keys(RUN_FORMATS)) {
      const f = RUN_FORMATS[id], card = el('button', `rx-card${format === id ? ' rx-picked' : ''}`); card.type = 'button'; card.setAttribute('aria-pressed', String(format === id));
      const top = el('span', 'rx-card-top'); top.append(icon(id === 'daily' ? 'xp' : 'skirmish', 28), el('span', 'rx-card-name', f.name));
      const best = id === 'daily' ? meta.daily[today] : meta.best;
      card.append(top, el('span', 'rx-card-text', f.text), el('span', 'rx-card-foot', id === 'daily' ? `Today ${today}${best ? ` · best ${best.banked}` : ''}` : best ? `Best ${best.banked} Embers` : 'No runs yet'));
      card.addEventListener('click', () => { format = id; render(); });
      grid.append(card);
    }
    scroll.append(grid);
    const seedRow = el('label', 'rx-seed'); seedRow.append(el('span', '', 'Seed (optional)'));
    const input = el('input'); input.type = 'text'; input.inputMode = 'numeric'; input.placeholder = format === 'daily' ? String(dailySeed(today)) : 'Random'; input.disabled = format === 'daily'; input.maxLength = 9;
    seedRow.append(input); scroll.append(seedRow);
    scroll.append(el('p', 'rx-note', `${meta.embers} Embers banked. Each run resets the world, your level, upgrades and pack; banked Embers and Hall unlocks stay.`));
    const foot = el('footer', 'rx-foot');
    foot.append(button('btn-quiet', 'Hall of Embers', () => openHall()));
    foot.append(button('btn-primary rx-go', 'Start expedition', () => {
      const typed = parseInt(input.value.replace(/\D/g, ''), 10);
      const seed = format === 'daily' ? dailySeed(today) : Number.isSafeInteger(typed) && typed > 0 ? typed % 2 ** 31 : (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000;
      close(); onStart({format, seed, ...(format === 'daily' ? {daily: today} : {})});
    }));
    dialog.append(h, scroll, foot);
  }
  function open() { render(); back.hidden = false; dialog.querySelector('.rx-go')?.focus(); }
  function close() { back.hidden = true; }
  back.addEventListener('click', e => { if (e.target === back) close(); });
  return {open, close, get open_() { return !back.hidden; }};
}
