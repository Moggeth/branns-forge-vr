// Forge Expedition: an optional, cooperative 10-15 minute run layered on the free sandbox.
// Pure deterministic module (no DOM, clock, RNG or transport). The host owns one adventure per room,
// steps it once per 60 Hz simulation tick, and applies the returned intents to the simulation state.
// Stages: idle -> camp (prepare camp) -> star (recover the fallen star) -> rekindle (survive) -> victory | defeat.

import {makeTerrainRoom} from './terrain.js';

export const ADVENTURE_VERSION = 1;
export const HZ = 60;
export const STAGES = Object.freeze(['idle', 'camp', 'star', 'rekindle', 'victory', 'defeat']);
const RUNNING = ['camp', 'star', 'rekindle'];
const BOUND = 55, FORGE = [0, 0], DEPOSIT_RANGE = 9, DRAIN_RANGE = 11;
const MAX_FOES = 16, MAX_TELEGRAPHS = 8, MAX_LEDGER = 16, MAX_RETRIES = 3, STOCK_CAP = 99;
const GATES = Object.freeze([[-24, -16], [24, -16], [0, -30], [-22, 20], [22, 20]]);
export const STAR_SITES = Object.freeze([[-30, 26], [32, 24], [-4, -38]]);
const SHAPE = ['raise', 'lower', 'sunder', 'wall'], PLANT = ['grove', 'ring'], SUPPORT = ['heal', 'frost', 'lightning', 'crystal', 'starfall'];
const s = secs => Math.round(secs * HZ);
// Authored pacing. All times are stage-elapsed ticks, which only advance while someone is present.
export const PACING = Object.freeze({
  interlude: s(5),
  campPatrols: Object.freeze([s(60), s(150)]),
  campHint: s(200),
  starWarn: s(8), guardDelay: s(3), starHint: s(150),
  waves: Object.freeze([s(10), s(65), s(120)]),
  telegraph: s(6),
  graceAfterFinal: s(60),
  titheCooldown: s(2), titheMana: 30, lodestarMana: 25,
});
const STAGE_TITLES = {idle: 'Forge Expedition', camp: 'I · Prepare the Camp', star: 'II · Recover the Fallen Star',
  rekindle: 'III · Rekindle the Forge', victory: 'The Forge Burns Bright', defeat: 'The Forge Went Dark'};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const int = (v, a, b) => Number.isSafeInteger(v) && v >= a && v <= b;
const num = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xz = p => [p[0], p[2]];
const copy = v => JSON.parse(JSON.stringify(v));
// Small integer hash for authored-but-varied choices (gate order, star site). Not a stream RNG.
function mix(...n) { let h = 2166136261; for (const v of n) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; } return (h >>> 0); }

function blank(seed) {
  return {v: ADVENTURE_VERSION, seed, run: 0, stage: 'idle', elapsed: 0, tick: 0, heroesAtStart: 0,
    need: {wood: 0, stone: 0, star: 0}, stock: {wood: 0, stone: 0}, star: {charge: 0, site: 0, landed: false},
    flame: 0, rekindled: false, waveIndex: 0, retries: 0, hostileUsed: 0, supportUsed: 0,
    deeds: {shape: 0, plant: 0, support: 0, starpath: 0, kills: 0}, foes: [], telegraphs: [], seqs: {}, cool: {},
    renown: {}, rewardedRun: 0, votes: [], notice: '', campReadyAt: 0};
}

export function createAdventure({seed = 41} = {}) {
  if (!Number.isSafeInteger(seed)) throw Error('Invalid adventure seed');
  return blank(seed);
}

// ---- World view helpers. `world` is a simulation snapshot or the live state (read only). ----
function roster(world) {
  const players = Array.isArray(world?.players) ? world.players : [];
  return {players, heroes: players.filter(p => p.role === 'hero'), gods: players.filter(p => p.role === 'god')};
}
const scale = heroes => clamp(heroes, 1, 6);
function needs(heroes) {
  const h = scale(heroes);
  return {wood: Math.min(24, 4 + 2 * h), stone: Math.min(16, 3 + h), star: Math.min(8, 2 + 2 * Math.ceil(h / 2))};
}
// One readable rule for God assistance: Gods may cover a quarter of a resource goal while Heroes are present,
// or all of it when nobody can gather. It is always an explicit, mana-paid action.
function supportCap(adv, heroes, total) { return heroes === 0 ? total : Math.ceil(total / 4); }
function supportTotal(adv) { return adv.stage === 'camp' ? adv.need.wood + adv.need.stone : adv.stage === 'star' ? adv.need.star : 100; }
function gatePoint(adv, k, heroes) {
  const g = GATES[mix(adv.seed, adv.run, k) % GATES.length], inner = heroes === 0 ? .3 : 1; // Idle foes must reach the flame.
  return [g[0] * inner, g[1] * inner];
}
function waveRoster(heroes, wave, retries) {
  if (heroes === 0) return ['skeleton', [2, 2, 3][wave]];
  const h = scale(heroes), soft = Math.min(retries, 2);
  const skeletons = Math.max(1, Math.min(7, [1 + h, 2 + h, 2 + h][wave] - soft));
  const golems = wave === 0 ? 0 : wave === 1 ? (h >= 2 ? 1 : 0) : (h >= 4 ? 2 : 1);
  return ['skeleton', skeletons, 'golem', golems];
}
function phaseNotice(adv, text) { adv.notice = text.slice(0, 96); }

function telegraph(adv, out, t) {
  if (adv.telegraphs.length >= MAX_TELEGRAPHS) adv.telegraphs.shift();
  adv.telegraphs.push(t); out.events.push({...copy(t), kind: 'adventure_telegraph', telegraph: t.kind});
}
function spawnFoes(adv, out, list, at, tag) {
  let n = 0;
  for (let i = 0; i < list.length; i += 2) for (let k = 0; k < list[i + 1]; k++) {
    if (adv.foes.length >= MAX_FOES) break;
    const angle = n * 2.39996, r = n ? 1.6 + .35 * n : 0, x = clamp(at[0] + Math.cos(angle) * r, -BOUND, BOUND), z = clamp(at[1] + Math.sin(angle) * r, -BOUND, BOUND);
    const id = `xv${adv.run}${tag}_${n}`; n++;
    adv.foes.push({id, kind: list[i], tag, seen: false, age: 0});
    out.intents.push({type: 'spawn', id, kind: list[i], x, z});
  }
}
function despawnAll(adv, out) {
  if (adv.foes.length) out.intents.push({type: 'despawn', ids: adv.foes.map(f => f.id)});
  adv.foes = [];
}

// FIX (expedition playtest 2026-10-03): the world has five 2-stone boulders and ore depletion persists across runs and
// sandbox play, so 4+ Hero camps (need 12-16) and every Hero-only rematch could never finish. Camp entry tops up mineable
// stone to the goal with new boulders on a fixed ring around the forge (deterministic, bounded, validated by the sim).
const questOreReusable = d => d.depleted === true && typeof d.id === 'string' && d.id.startsWith('xv');
function restockStone(adv, world, out) {
  const deposits = Array.isArray(world?.deposits) ? world.deposits : [];
  const loose = (Array.isArray(world?.pickups) ? world.pickups : []).filter(q => q.kind === 'stone').reduce((n, q) => n + (q.amount | 0), 0);
  const carried = roster(world).heroes.reduce((n, p) => n + (p.resources?.stone | 0), 0);
  let have = loose + carried + 2 * deposits.filter(d => d.kind === 'stone' && !d.depleted).length;
  // Depleted expedition ores (xv ids) are reusable slots, so endless rematches stay inside the 80-deposit cap; world/user ores are never evicted.
  const free = 80 - deposits.length - (Array.isArray(world?.pendingStarfalls) ? world.pendingStarfalls.length : 0) + deposits.filter(questOreReusable).length;
  for (let i = 0; have < adv.need.stone && i < 8 && i < free; i++, have += 2) {
    const a = .45 + i * 2.39996, r = 6.5 + (i % 2) * 1.5;
    out.intents.push({type: 'deposit', kind: 'stone', id: `xv${adv.run}r${i}`, x: Math.cos(a) * r, z: Math.sin(a) * r});
  }
}
function enterStage(adv, stage, world, out) {
  const {heroes} = roster(world);
  adv.stage = stage; adv.elapsed = 0; adv.supportUsed = 0; adv.hostileUsed = 0; adv.telegraphs = []; adv.votes = [];
  adv.heroesAtStart = Math.min(8, heroes.length);
  if (stage === 'camp') { adv.need = {...adv.need, ...needs(heroes.length), star: 0}; adv.stock = {wood: 0, stone: 0}; restockStone(adv, world, out); }
  if (stage === 'star') { adv.need.star = needs(heroes.length).star; adv.star = {charge: 0, site: mix(adv.seed, adv.run, 99) % STAR_SITES.length, landed: false}; }
  if (stage === 'rekindle') { adv.flame = heroes.length ? 25 : 40; adv.rekindled = false; adv.waveIndex = 0; }
  if(stage==='star'||stage==='rekindle'){out.intents.push({type:'partyReward',health:20,mana:30,wood:stage==='rekindle'?3:0,stone:0,gems:0});out.events.push({kind:'party_reward',stage,health:20,mana:30});}
  phaseNotice(adv, STAGE_TITLES[stage]);
  out.events.push({kind: 'adventure_stage', stage, run: adv.run});
}

// ---- Public API ----

// Advance exactly one simulation tick. `events` are all simulation events since the previous call
// (step() plus command() results). Returns {events, intents}; apply intents before the next sim tick.
export function stepAdventure(adv, world, events = []) {
  const out = {events: [], intents: []};
  adv.tick = clamp(adv.tick + 1, 0, Number.MAX_SAFE_INTEGER);
  if (!RUNNING.includes(adv.stage)) return out;
  const {players, heroes} = roster(world);
  if (!players.length) return out; // Empty room: pause the authored clock rather than punishing absence.
  adv.elapsed++;
  const enemyIds = new Set((world.enemies || []).map(e => e.id));
  for (const e of events) if (e && e.kind === 'spell' && Array.isArray(e.position)) {
    const p = xz(e.position);
    if (SHAPE.includes(e.spell) && flat(p, FORGE) <= 32) adv.deeds.shape = Math.min(999, adv.deeds.shape + 1);
    if (PLANT.includes(e.spell)) adv.deeds.plant = Math.min(999, adv.deeds.plant + 1);
    if (SUPPORT.includes(e.spell) && e.phase !== 'impact') adv.deeds.support = Math.min(999, adv.deeds.support + 1);
    if (adv.stage === 'star' && SHAPE.includes(e.spell) && segmentDistance(p, FORGE, STAR_SITES[adv.star.site]) <= 6) adv.deeds.starpath = Math.min(999, adv.deeds.starpath + 1);
  }
  // Foe bookkeeping: a foe counts as defeated only after it was observed in the world.
  adv.foes = adv.foes.filter(f => {
    f.age = Math.min(f.age + 1, 1e6);
    if (enemyIds.has(f.id)) { f.seen = true; return true; }
    if (f.seen) { adv.deeds.kills = Math.min(999, adv.deeds.kills + 1); out.events.push({kind: 'adventure_foe_down', id: f.id}); }
    return !f.seen && f.age <= 30;
  });
  adv.telegraphs = adv.telegraphs.filter(t => t.until > adv.elapsed);
  if (adv.stage === 'camp') stepCamp(adv, world, heroes, out);
  else if (adv.stage === 'star') stepStar(adv, world, heroes, out);
  else stepRekindle(adv, world, heroes, out);
  return out;
}

function stepCamp(adv, world, heroes, out) {
  const t = adv.elapsed;
  for (const [i, at] of PACING.campPatrols.entries()) {
    if (t === at - PACING.telegraph) { const p = gatePoint(adv, 10 + i, heroes.length); telegraph(adv, out, {id: `xv${adv.run}tp${i}`, kind: 'gate', x: p[0], z: p[1], radius: 3, until: at, label: 'Skeleton patrol'}); }
    if (t === at) spawnFoes(adv, out, ['skeleton', heroes.length ? 2 : 1], gatePoint(adv, 10 + i, heroes.length), `p${i}`);
  }
  if (t === PACING.campHint && !campDone(adv, world)) phaseNotice(adv, 'Trees give timber (axe) and boulders give stone (pick). Bring them to the forge.');
  if (campDone(adv, world)) {
    if (!adv.campReadyAt) adv.campReadyAt = t;
    if (t - adv.campReadyAt >= PACING.interlude) { adv.campReadyAt = 0; adv.stock = {wood: 0, stone: 0}; enterStage(adv, 'star', world, out); }
  } else adv.campReadyAt = 0;
}
function campDone(adv, world) {
  const gods = roster(world).gods.length;
  return adv.stock.wood >= adv.need.wood && adv.stock.stone >= adv.need.stone && (!gods || (adv.deeds.shape > 0 && adv.deeds.plant > 0));
}

function stepStar(adv, world, heroes, out) {
  const t = adv.elapsed, site = STAR_SITES[adv.star.site], impact = PACING.interlude + PACING.starWarn;
  if (t === PACING.interlude) telegraph(adv, out, {id: `xv${adv.run}ts`, kind: 'star', x: site[0], z: site[1], radius: 6, until: impact, label: 'Falling star — stand clear'});
  if (t === impact) {
    adv.star.landed = true;
    out.intents.push({type: 'crater', id: `xv${adv.run}c`, x: site[0], z: site[1], radius: 5, height: -1});
    // One shard (2 gems when mined) per two charges needed, so Heroes never depend on God crystals.
    for (let i = 0; i < adv.need.star / 2; i++) out.intents.push({type: 'deposit', id: `xv${adv.run}s${i}`, x: site[0] + Math.cos(i * 1.57) * 1.6, z: site[1] + Math.sin(i * 1.57) * 1.6});
    out.events.push({kind: 'adventure_star_impact', position: [site[0], 0, site[1]]});
    telegraph(adv, out, {id: `xv${adv.run}tg`, kind: 'guard', x: site[0], z: site[1] + 3, radius: 3, until: impact + PACING.guardDelay, label: 'Star guardians wake'});
  }
  if (t === impact + PACING.guardDelay) {
    const h = heroes.length;
    spawnFoes(adv, out, h ? ['golem', 1, 'skeleton', h >= 3 ? 4 : 2] : ['skeleton', 2], [site[0], site[1] + 3], 'g');
  }
  if (t === PACING.starHint && adv.star.charge < adv.need.star) phaseNotice(adv, 'Mine the star shards with a pick and carry the gems to the forge.');
  if (adv.star.landed && adv.star.charge >= adv.need.star) enterStage(adv, 'rekindle', world, out);
}

function stepRekindle(adv, world, heroes, out) {
  const t = adv.elapsed;
  for (const [i, at] of PACING.waves.entries()) {
    const gate = gatePoint(adv, 20 + i, heroes.length);
    if (t === at - PACING.telegraph) telegraph(adv, out, {id: `xv${adv.run}tw${i}`, kind: 'gate', x: gate[0], z: gate[1], radius: 3, until: at, label: `Wave ${i + 1} of 3`});
    if (t === at) { spawnFoes(adv, out, waveRoster(heroes.length, i, adv.retries), gate, `w${i}${adv.retries}`); adv.waveIndex = i + 1; }
  }
  const lastWave = PACING.waves[PACING.waves.length - 1];
  if (t === lastWave + PACING.graceAfterFinal && adv.foes.length) { despawnAll(adv, out); phaseNotice(adv, 'The last attackers flee from the flame.'); }
  // Flame per tick: steady heat while the forge stands, drained by any enemy close to it.
  const forgeUp = !world.shrine || world.shrine.hp > 0;
  let drain = 0;
  for (const e of world.enemies || []) if (Array.isArray(e.position) && flat(xz(e.position), FORGE) <= DRAIN_RANGE) drain += e.kind === 'golem' ? 2 : 1;
  adv.flame = clamp(adv.flame + ((forgeUp ? .5 : 0) - drain * .45) / HZ, 0, 100);
  if (adv.flame >= 100 && !adv.rekindled) { adv.rekindled = true; out.events.push({kind: 'adventure_rekindled'}); }
  if (adv.flame <= 0) { adv.stage = 'defeat'; adv.elapsed = 0; despawnAll(adv, out); phaseNotice(adv, 'The flame died. Retry the last stand or leave.'); out.events.push({kind: 'adventure_stage', stage: 'defeat', run: adv.run}); return; }
  if (adv.rekindled && adv.waveIndex >= 3 && !adv.foes.length) victory(adv, world, out);
}

function victory(adv, world, out) {
  adv.stage = 'victory'; adv.elapsed = 0; adv.telegraphs = [];
  if (adv.rewardedRun !== adv.run) { // Team reward exactly once per run, to everyone present at the finish.
    adv.rewardedRun = adv.run;
    const award = 10 + 5 * Math.max(0, 2 - adv.retries) + Math.min(10, adv.deeds.starpath + (adv.deeds.support > 0 ? 3 : 0));
    for (const p of roster(world).players.slice(0, 8)) {
      if (!(p.id in adv.renown) && Object.keys(adv.renown).length >= MAX_LEDGER) delete adv.renown[Object.keys(adv.renown)[0]];
      adv.renown[p.id] = Math.min(9999, (adv.renown[p.id] || 0) + award);
    }
    out.intents.push({type:'partyReward',health:100,mana:100,wood:6,stone:4,gems:3});
    out.events.push({kind: 'adventure_reward', run: adv.run, renown: award,wood:6,stone:4,gems:3});
  }
  phaseNotice(adv, 'Victory! Each player earned 6 wood, 4 stone, 3 gems and a full restore. Rematch?');
  out.events.push({kind: 'adventure_stage', stage: 'victory', run: adv.run});
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
  const t = len ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

const ok = (intents = [], events = []) => ({ok: true, intents, events});
const fail = code => ({ok: false, code, intents: [], events: []});

// Player request. message: {type:'adventure', seq, action, ...}. Validated against the world view; any resource
// or mana cost is returned as a debit intent which the host must apply in the same synchronous turn.
export function adventureAction(adv, playerId, message, world) {
  if (!validId(playerId) || !record(message)) return fail('invalid_message');
  const {players, heroes, gods} = roster(world);
  const p = players.find(x => x.id === playerId);
  if (!p) return fail('not_joined');
  if (!int(message.seq, 1, Number.MAX_SAFE_INTEGER)) return fail('invalid_sequence');
  if (message.seq <= (adv.seqs[playerId] || 0)) return fail('duplicate_sequence');
  if (!(playerId in adv.seqs) && Object.keys(adv.seqs).length >= MAX_LEDGER) {
    const stale = Object.keys(adv.seqs).find(id => !players.some(q => q.id === id));
    if (!stale) return fail('ledger_full');
    delete adv.seqs[stale];
  }
  adv.seqs[playerId] = message.seq; // A valid new sequence is consumed even if the payload is rejected.
  const out = {events: [], intents: []};
  const action = message.action;
  if (action === 'start') {
    if (RUNNING.includes(adv.stage)) return fail('already_running');
    if (adv.foes.length) despawnAll(adv, out);
    adv.run = Math.min(adv.run + 1, 99999); adv.retries = 0; adv.deeds = {shape: 0, plant: 0, support: 0, starpath: 0, kills: 0}; adv.cool = {};
    enterStage(adv, 'camp', world, out);
    return ok(out.intents, out.events);
  }
  if (action === 'retry') {
    if (adv.stage !== 'defeat') return fail('invalid_stage');
    if (adv.retries >= MAX_RETRIES) return fail('no_retries');
    adv.retries++; enterStage(adv, 'rekindle', world, out);
    return ok(out.intents, out.events);
  }
  if (action === 'leave') { // Majority of present players returns the room to free sandbox.
    if (adv.stage === 'idle') return fail('invalid_stage');
    if (!adv.votes.includes(playerId)) adv.votes.push(playerId);
    adv.votes = adv.votes.filter(id => players.some(q => q.id === id)).slice(0, 8);
    if (adv.votes.length * 2 > players.length || !RUNNING.includes(adv.stage)) {
      despawnAll(adv, out); adv.stage = 'idle'; adv.elapsed = 0; adv.telegraphs = []; adv.votes = []; phaseNotice(adv, 'Expedition ended. Free building resumes.');
      out.events.push({kind: 'adventure_stage', stage: 'idle', run: adv.run});
    }
    return ok(out.intents, out.events);
  }
  if (!RUNNING.includes(adv.stage)) return fail('invalid_stage');
  if (action === 'deposit') {
    if (p.role !== 'hero') return fail('role_required');
    if (!['wood', 'stone', 'gems'].includes(message.kind) || !int(message.amount, 1, 99)) return fail('invalid_action');
    if (flat(xz(p.position), FORGE) > DEPOSIT_RANGE) return fail('too_far');
    const have = p.resources?.[message.kind] | 0;
    const room = depositRoom(adv, message.kind);
    const amount = Math.min(message.amount, have, room);
    if (room <= 0) return fail('not_needed');
    if (amount <= 0) return fail('insufficient_resources');
    credit(adv, message.kind, amount);
    out.intents.push({type: 'debit', playerId, kind: message.kind, amount});
    out.events.push({kind: 'adventure_deposit', id: playerId, resource: message.kind, amount});
    return ok(out.intents, out.events);
  }
  if (action === 'tithe' || action === 'lodestar') {
    if (p.role !== 'god') return fail('role_required');
    const manaCost = action === 'tithe' ? PACING.titheMana : PACING.lodestarMana;
    if (adv.tick - (adv.cool[playerId] ?? -1e9) < PACING.titheCooldown) return fail('cooldown');
    if (!num(p.mana, 0, 1000) || p.mana < manaCost) return fail('insufficient_mana');
    const cap = supportCap(adv, heroes.length, supportTotal(adv)) - adv.supportUsed;
    if (cap <= 0) return fail('support_spent');
    let kind, amount;
    if (action === 'lodestar') {
      if (adv.stage !== 'star' || !adv.star.landed) return fail('invalid_stage');
      if (!Array.isArray(message.point) || message.point.length !== 3 || !message.point.every(v => num(v, -1000, 1000))) return fail('invalid_action');
      if (flat(xz(message.point), STAR_SITES[adv.star.site]) > 6) return fail('too_far');
      if (adv.foes.some(f => f.tag === 'g')) return fail('guarded');
      kind = 'gems'; amount = 1;
    } else {
      if (adv.stage === 'star') return fail('use_lodestar');
      kind = adv.stage === 'rekindle' ? 'flame' : message.kind;
      if (adv.stage === 'camp' && !['wood', 'stone'].includes(kind)) return fail('invalid_action');
      amount = adv.stage === 'rekindle' ? 5 : heroes.length ? 1 : 2;
    }
    amount = Math.min(amount, cap, kind === 'flame' ? Math.ceil(100 - adv.flame) : depositRoom(adv, kind));
    if (amount <= 0) return fail('not_needed');
    if (kind === 'flame') adv.flame = clamp(adv.flame + amount, 0, 100); else credit(adv, kind, amount);
    adv.supportUsed += amount; adv.cool[playerId] = adv.tick;
    out.intents.push({type: 'mana', playerId, amount: manaCost});
    out.events.push({kind: 'adventure_support', id: playerId, action, amount});
    return ok(out.intents, out.events);
  }
  return fail('unknown_action');
}
function depositRoom(adv, kind) {
  if (adv.stage === 'camp') return kind === 'wood' ? adv.need.wood - adv.stock.wood : kind === 'stone' ? adv.need.stone - adv.stock.stone : 0;
  if (adv.stage === 'star') return kind === 'gems' ? adv.need.star - adv.star.charge : 0;
  const per = {wood: 4, stone: 2, gems: 10}[kind] || 0; // Rekindle: fuel converts to flame without overfill.
  return per ? Math.ceil((100 - adv.flame) / per) : 0;
}
function credit(adv, kind, amount) {
  if (adv.stage === 'camp') adv.stock[kind] = Math.min(STOCK_CAP, adv.stock[kind] + amount);
  else if (adv.stage === 'star') adv.star.charge = Math.min(adv.need.star, adv.star.charge + amount);
  else adv.flame = clamp(adv.flame + amount * {wood: 4, stone: 2, gems: 10}[kind], 0, 100);
}

// Workers deliver into real shared stores. Spending those stores on the existing
// expedition follows the same stage caps as a Hero deposit, with no mana subsidy.
export function contributeSettlement(adv, stock) {
  if (!RUNNING.includes(adv.stage)) return {ok:false,code:'invalid_stage',events:[]};
  const events=[];
  for (const kind of ['wood','stone','gems']) {
    const amount=Math.min(stock[kind],Math.max(0,depositRoom(adv,kind)));
    if (!amount) continue;
    stock[kind]-=amount;credit(adv,kind,amount);
    events.push({kind:'adventure_deposit',id:'forge',resource:kind,amount});
  }
  return events.length?{ok:true,events}:{ok:false,code:'not_needed',events:[]};
}

// Call before forwarding a God `cast` to the simulation. During a run, hostile summons are a bounded team
// "challenge" budget: none near the forge, none while no Hero can answer, and a per-stage cap.
// God casts are never refused by expedition rules; summons only land outside the forge keep-out
// (shared/spells.js settleCastPoint). hostileUsed stays in saves for compatibility.
export const expeditionRunning = adv => RUNNING.includes(adv?.stage);

// Apply intents to a raw simulation state object. ctx = {createEnemy, terrainHeight}. Debit/mana intents
// are re-checked so a stale intent can never mint resources. Returns {applied, skipped}.
export function applyAdventureIntents(state, intents, {createEnemy, terrainHeight}) {
  let applied = 0; const skipped = [];
  const taken = id => [...state.enemies, ...state.deposits, ...state.edits, ...state.pickups].some(x => x.id === id);
  for (const it of intents) {
    if(it.type==='partyReward'){for(const p of state.players){p.hp=Math.min(100,p.hp+it.health);p.mana=Math.min(100,p.mana+it.mana);for(const k of ['wood','stone','gems'])p.resources[k]=Math.min(999,p.resources[k]+it[k]);}applied++;}
    else if (it.type === 'spawn') {
      if (state.enemies.length >= 64 || taken(it.id)) { skipped.push(it.id); continue; }
      state.enemies.push({...createEnemy(it.id, [it.x, terrainHeight(state, it.x, it.z), it.z], it.kind),emergeTick:state.tick}); applied++;
    } else if (it.type === 'deposit') {
      // The save validator caps deposits + pending starfalls at 80 together.
      const full = () => state.deposits.length + (state.pendingStarfalls?.length | 0) >= 80;
      if (full()) { const old = state.deposits.findIndex(questOreReusable); if (old >= 0) state.deposits.splice(old, 1); }
      if (full() || taken(it.id)) { skipped.push(it.id); continue; }
      state.deposits.push(it.kind === 'stone' ? {id: it.id, x: it.x, z: it.z, kind: 'stone', hits: 0, maxHits: 3, depleted: false} : {id: it.id, x: it.x, z: it.z, kind: 'meteor', hits: 0, maxHits: 5, depleted: false}); applied++;
    } else if (it.type === 'crater') {
      makeTerrainRoom(state, 1 + state.pendingStarfalls.length);
      if (state.edits.length + state.pendingStarfalls.length >= 64 || taken(it.id)) { skipped.push(it.id); continue; }
      state.edits.push({id: it.id, kind: 'starfall', x: it.x, z: it.z, radius: it.radius, height: it.height});
      for (const a of [...state.players, ...state.enemies]) a.position[1] = Math.max(a.position[1], terrainHeight(state, a.position[0], a.position[2]));
      applied++;
    } else if (it.type === 'despawn') {
      const ids = new Set(it.ids); state.enemies = state.enemies.filter(e => !ids.has(e.id)); applied++;
    } else if (it.type === 'debit' || it.type === 'mana') {
      const p = state.players.find(q => q.id === it.playerId);
      const have = !p ? -1 : it.type === 'mana' ? p.mana : p.resources[it.kind];
      if (have < it.amount) { skipped.push(it.playerId); continue; }
      if (it.type === 'mana') p.mana -= it.amount; else p.resources[it.kind] -= it.amount;
      applied++;
    }
  }
  return {applied, skipped};
}

// Zero-change fallback for the unmodified simulation: round-trip through checkpoint/load. Use only when intents
// exist (a few dozen times per run); prefer the three-line `applyAdventure` hook in ADVENTURE-INTEGRATION.md.
export function applyIntentsViaCheckpoint(game, intents, {loadSimulation, createEnemy, terrainHeight}) {
  if (!intents.length) return {game, applied: 0, skipped: []};
  const state = game.checkpoint();
  const result = applyAdventureIntents(state, intents, {createEnemy, terrainHeight});
  return {game: loadSimulation(state), ...result};
}

export function checkpointAdventure(adv) { return copy(adv); }

// Strict whitelist validation of a saved adventure. Returns {ok:true, adventure} or {ok:false, code}.
export function validateRestore(saved) {
  try { return {ok: true, adventure: restore(saved)}; } catch (e) { return {ok: false, code: String(e.message).slice(0, 64)}; }
}
const KEYS = ['v', 'seed', 'run', 'stage', 'elapsed', 'tick', 'heroesAtStart', 'need', 'stock', 'star', 'flame', 'rekindled', 'waveIndex',
  'retries', 'hostileUsed', 'supportUsed', 'deeds', 'foes', 'telegraphs', 'seqs', 'cool', 'renown', 'rewardedRun', 'votes', 'notice', 'campReadyAt'];
function exact(o, keys, name, optional = []) {
  if (!record(o)) throw Error(`bad_${name}`);
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k)) throw Error(`unknown_${name}_${k}`.slice(0, 64));
  for (const k of keys) if (!Object.hasOwn(o, k)) throw Error(`missing_${name}_${k}`.slice(0, 64));
}
function idMap(o, name, max, valueOk) {
  if (!record(o) || Object.keys(o).length > max) throw Error(`bad_${name}`);
  for (const [k, v] of Object.entries(o)) if (!validId(k) || !valueOk(v)) throw Error(`bad_${name}`);
}
function restore(a) {
  exact(a, KEYS, 'adventure');
  const MAXT = Number.MAX_SAFE_INTEGER;
  if (a.v !== ADVENTURE_VERSION) throw Error('version');
  if (!int(a.seed, Number.MIN_SAFE_INTEGER, MAXT) || !int(a.run, 0, 99999) || !STAGES.includes(a.stage)) throw Error('bad_header');
  if (!int(a.elapsed, 0, 60 * 60 * 60) || !int(a.tick, 0, MAXT) || !int(a.heroesAtStart, 0, 8)) throw Error('bad_clock');
  if (!int(a.campReadyAt, 0, a.elapsed)) throw Error('bad_clock');
  exact(a.need, ['wood', 'stone', 'star'], 'need');
  if (!int(a.need.wood, 0, 24) || !int(a.need.stone, 0, 16) || !int(a.need.star, 0, 8)) throw Error('bad_need');
  exact(a.stock, ['wood', 'stone'], 'stock');
  if (!int(a.stock.wood, 0, a.need.wood) || !int(a.stock.stone, 0, a.need.stone)) throw Error('bad_stock');
  exact(a.star, ['charge', 'site', 'landed'], 'star');
  if (!int(a.star.charge, 0, a.need.star) || !int(a.star.site, 0, STAR_SITES.length - 1) || typeof a.star.landed !== 'boolean') throw Error('bad_star');
  if (!num(a.flame, 0, 100) || typeof a.rekindled !== 'boolean' || !int(a.waveIndex, 0, 3) || !int(a.retries, 0, MAX_RETRIES)) throw Error('bad_rekindle');
  if (!int(a.hostileUsed, 0, 14) || !int(a.supportUsed, 0, 100) || !int(a.rewardedRun, 0, a.run)) throw Error('bad_budget');
  exact(a.deeds, ['shape', 'plant', 'support', 'starpath', 'kills'], 'deeds');
  if (!Object.values(a.deeds).every(v => int(v, 0, 999))) throw Error('bad_deeds');
  if (!Array.isArray(a.foes) || a.foes.length > MAX_FOES) throw Error('bad_foes');
  const ids = new Set();
  for (const f of a.foes) { exact(f, ['id', 'kind', 'tag', 'seen', 'age'], 'foe'); if (!validId(f.id) || !f.id.startsWith('xv') || ids.has(f.id) || !['skeleton', 'golem'].includes(f.kind) || !/^[a-z0-9]{1,4}$/.test(f.tag) || typeof f.seen !== 'boolean' || !int(f.age, 0, 1e6)) throw Error('bad_foe'); ids.add(f.id); }
  if (!Array.isArray(a.telegraphs) || a.telegraphs.length > MAX_TELEGRAPHS) throw Error('bad_telegraphs');
  for (const t of a.telegraphs) { exact(t, ['id', 'kind', 'x', 'z', 'radius', 'until', 'label'], 'telegraph'); if (!validId(t.id) || !['gate', 'star', 'guard'].includes(t.kind) || !num(t.x, -BOUND, BOUND) || !num(t.z, -BOUND, BOUND) || !num(t.radius, 0, 10) || !int(t.until, 0, 60 * 60 * 60) || typeof t.label !== 'string' || t.label.length > 48) throw Error('bad_telegraph'); }
  idMap(a.seqs, 'seqs', MAX_LEDGER, v => int(v, 0, MAXT));
  idMap(a.cool, 'cool', MAX_LEDGER, v => int(v, -1e9, MAXT));
  idMap(a.renown, 'renown', MAX_LEDGER, v => int(v, 0, 9999));
  if (!Array.isArray(a.votes) || a.votes.length > 8 || !a.votes.every(validId) || new Set(a.votes).size !== a.votes.length) throw Error('bad_votes');
  if (typeof a.notice !== 'string' || a.notice.length > 96) throw Error('bad_notice');
  if (!RUNNING.includes(a.stage) && a.stage !== 'defeat' && a.foes.length) throw Error('bad_foes');
  return copy(a); // Whitelisted keys only; prototype keys such as __proto__ fail `exact`.
}

// Stable data view-model for HUD/UI: everything a banner, VR wrist panel or RTS panel needs, nothing more.
export function adventureView(adv, world, viewerId) {
  const {players, heroes, gods} = roster(world);
  const me = players.find(p => p.id === viewerId);
  const role = me?.role || 'hero';
  const goal = (id, label, have, need, extra = {}) => ({id, label, have: Math.min(have, need), need, done: have >= need, ...extra});
  const objectives = [];
  if (adv.stage === 'camp') {
    objectives.push(goal('wood', 'Timber delivered to the forge', adv.stock.wood, adv.need.wood, {icon: 'timber', role: 'hero'}));
    objectives.push(goal('stone', 'Stone delivered to the forge', adv.stock.stone, adv.need.stone, {icon: 'stone', role: 'hero'}));
    const waived = !gods.length;
    objectives.push(goal('shape', waived ? 'Shape a path (no God present: optional)' : 'God: shape a path near camp', adv.deeds.shape, 1, {icon: 'path', role: 'god', waived}));
    objectives.push(goal('plant', waived ? 'Plant a grove (no God present: optional)' : 'God: plant a grove for timber', adv.deeds.plant, 1, {icon: 'grove', role: 'god', waived}));
  } else if (adv.stage === 'star') {
    objectives.push(goal('landed', 'Watch for the falling star', adv.star.landed ? 1 : 0, 1, {icon: 'star', role: 'all'}));
    objectives.push(goal('star', heroes.length ? 'Star gems delivered (Gods may Lodestar a share)' : 'Lodestar the star home (clear its guardians first)', adv.star.charge, adv.need.star, {icon: 'gem', role: 'all'}));
    objectives.push(goal('guards', 'Star guardians defeated', adv.foes.some(f => f.tag === 'g') ? 0 : 1, 1, {icon: 'skull', role: 'all'}));
  } else if (adv.stage === 'rekindle') {
    objectives.push(goal('flame', 'Forge flame', Math.floor(adv.flame), 100, {icon: 'flame', role: 'all'}));
    objectives.push(goal('waves', 'Waves endured', adv.waveIndex - (adv.waveIndex && adv.foes.length ? 1 : 0), 3, {icon: 'skull', role: 'all'}));
  }
  const t = adv.telegraphs.map(x => ({...x, secondsLeft: Math.max(0, Math.ceil((x.until - adv.elapsed) / HZ))}));
  const cap = RUNNING.includes(adv.stage) ? Math.max(0, supportCap(adv, heroes.length, supportTotal(adv)) - adv.supportUsed) : 0;
  const actions = [];
  if (!RUNNING.includes(adv.stage)) actions.push(adv.stage === 'idle' ? 'start' : 'rematch');
  if (adv.stage === 'defeat' && adv.retries < MAX_RETRIES) actions.push('retry');
  if (adv.stage !== 'idle') actions.push('leave');
  if (role === 'hero' && RUNNING.includes(adv.stage)) actions.push('deposit');
  if (role === 'god' && cap > 0) actions.push(adv.stage === 'star' ? 'lodestar' : 'tithe');
  return {stage: adv.stage, run: adv.run, title: STAGE_TITLES[adv.stage], notice: adv.notice, role,
    elapsedSeconds: Math.floor(adv.elapsed / HZ), objectives, telegraphs: t,
    flame: adv.stage === 'rekindle' ? Math.floor(adv.flame) : null, retriesLeft: MAX_RETRIES - adv.retries,
    godSupportLeft: cap,
    renown: me ? adv.renown[me.id] || 0 : 0, party: {heroes: heroes.length, gods: gods.length}, actions,
    star: adv.stage === 'star' ? {x: STAR_SITES[adv.star.site][0], z: STAR_SITES[adv.star.site][1], landed: adv.star.landed} : null};
}
