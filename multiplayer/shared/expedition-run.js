// Expedition Roguelite: a short, replayable seeded adventure (state.run). Pure and deterministic like
// shared/adventure.js: no DOM, clock, RNG stream or transport. The host steps it once per 60 Hz tick and it mutates
// only run-owned state (its foes, shards, the party's lives and boons). Every choice comes from the run seed through
// small integer hashes, so the same seed always builds the same route, encounters and upgrade offers.
//
// Stages: camp -> route (vote a destination) -> travel -> fight -> reward (pick a boon) -> decide (return or push on)
//         -> route ... -> heart (the final destination) -> won | returned | fallen.
// Resets each run: the run world, hero level/XP/talents, boons, kit, inventory and the unbanked haul.
// Persists (each player's device, client/run-meta.js): banked Embers, Hall of Embers unlocks, codex and bests.
import {BOONS, BOON_IDS, BOON_LIMIT, KITS, KIT_IDS, cleanHall, validBoonList, HALL_IDS, HALL} from './run-boons.js';
import {MAX_PLAYERS} from './multiplayer-limits.js';

export const RUN_VERSION = 1;
export const HZ = 60;
const s = secs => Math.round(secs * HZ);
export const RUN_FORMATS = Object.freeze({
  expedition: Object.freeze({id: 'expedition', name: 'Expedition', text: 'Pick a route through branching destinations, grow stronger, and decide after each one: bank your haul or push on toward the Heart.'}),
  daily: Object.freeze({id: 'daily', name: 'Daily Expedition', text: 'Today’s seed, the same for everyone. Your best haul for the day is kept.'}),
});
export const RUN_STAGES = Object.freeze(['camp', 'route', 'travel', 'fight', 'reward', 'decide', 'won', 'returned', 'fallen']);
export const RUN_ENDED = Object.freeze(['won', 'returned', 'fallen']);
// Destination kinds. `haul` is the base Embers reward before tier and push multipliers.
export const NODE_KINDS = Object.freeze({
  skirmish: Object.freeze({name: 'Skirmish', text: 'A skeleton warband holds this ground.', haul: 20}),
  elite: Object.freeze({name: 'Elite', text: 'Meteor golems guard a rich haul.', haul: 40}),
  treasure: Object.freeze({name: 'Star Shards', text: 'Stars are falling here. Crack the shards before the ambush closes in.', haul: 35}),
  hold: Object.freeze({name: 'Hold the Ward', text: 'Stand in the ward circle while waves come.', haul: 30}),
  shrine: Object.freeze({name: 'Shrine', text: 'A quiet shrine: heal up and take a rare upgrade. No fight.', haul: 6}),
  underways: Object.freeze({name: 'Underways', text: 'A way down into the Underways. Its guardians wait at the mouth.', haul: 50}),
  heart: Object.freeze({name: 'The Heart', text: 'The region’s heart and its guardian. Beat it to win the run.', haul: 120}),
});
export const RUN_TUNING = Object.freeze({
  tiers: 4, width: 3, arrive: 9, spacing: 13, vote: s(20), pick: s(30), decide: s(25), interlude: s(3),
  holdNeed: s(40), holdRadius: 6, holdWave: s(12), ambush: s(20), shards: 3, maxFoes: 16, pushMult: .25,
  livesBase: 3, livesMax: 9, fallenKeep: .25, wonMult: 2, killHaul: 1, maxPlayers: MAX_PLAYERS,
  boss: Object.freeze({hpScale: 5, scale: 1.75}),
});
const T = RUN_TUNING;
const TIER_KINDS = [['skirmish', 'treasure', 'shrine', 'skirmish'], ['skirmish', 'elite', 'hold', 'treasure', 'underways'], ['elite', 'hold', 'underways', 'shrine', 'treasure']];
export const BOSSES = Object.freeze({
  colossus: Object.freeze({name: 'Meteor Colossus', kind: 'golem', text: 'A mountain of star-iron, crowned in fire.'}),
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const flat = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xz = p => [p[0], p[2]];
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const num = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const int = (v, a, b) => Number.isSafeInteger(v) && v >= a && v <= b;
const fail = code => ({ok: false, code, events: []});
const ok = (events = []) => ({ok: true, events});
/** Small integer hash for seeded choices (not a stream RNG): the same inputs always give the same number. */
export function mix(...n) { let h = 2166136261; for (const v of n) { const x = typeof v === 'string' ? [...v].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 7) : v | 0; h = Math.imul(h ^ x, 16777619); h ^= h >>> 13; } return h >>> 0; }
export const dailySeed = date => mix('daily', String(date)) % 1_000_000_000;
const nameKey = name => (typeof name === 'string' ? name.trim().toLowerCase().slice(0, 24) : '') || 'guest';

// ---- Route generation ---------------------------------------------------------------------------------------
/**
 * Builds the seeded route: `tiers - 1` tiers of `width` destinations moving outward from camp, then the Heart.
 * `sites` is a list of open [x, z] points (or {id, x, z, kind?, danger?} from a generated world).
 */
export function buildRoute(seed, camp, sites) {
  const pts = sites.map((p, i) => Array.isArray(p) ? {id: `s${i}`, x: p[0], z: p[1]} : {id: String(p.id), x: p.x, z: p.z, kind: p.kind, label: p.label});
  if (pts.length < T.width * (T.tiers - 1) + 1) throw Error('Not enough run sites');
  const far = Math.max(...pts.map(p => flat([p.x, p.z], camp)));
  const used = [];
  const take = (lo, hi, salt) => {
    const band = pts.filter(p => { const d = flat([p.x, p.z], camp) / far; return d >= lo && d <= hi && used.every(u => flat([u.x, u.z], [p.x, p.z]) >= T.spacing); });
    const pool = band.length ? band : pts.filter(p => used.every(u => flat([u.x, u.z], [p.x, p.z]) >= T.spacing * .6));
    if (!pool.length) return null;
    const p = pool[mix(seed, salt, pool.length) % pool.length]; used.push(p); return p;
  };
  // The Heart sits at the far end of the route.
  const heartPool = pts.filter(p => flat([p.x, p.z], camp) / far >= .85);
  const heart = heartPool[mix(seed, 'heart', heartPool.length) % heartPool.length] || pts[0]; used.push(heart);
  const bands = [[.18, .45], [.4, .68], [.6, .88]], nodes = [];
  for (let t = 0; t < T.tiers - 1; t++) {
    const row = [];
    for (let i = 0; i < T.width; i++) { const p = take(...bands[t], `t${t}i${i}`); if (p) row.push(p); }
    // Order each tier left to right (by bearing from camp) so paths read cleanly on the route map.
    row.sort((a, b) => Math.atan2(a.z - camp[1], a.x - camp[0]) - Math.atan2(b.z - camp[1], b.x - camp[0]));
    // Each tier deals its kinds from a seeded shuffle, so a tier never repeats a kind until it runs out.
    const kinds = [...TIER_KINDS[t]].map((k, i) => [mix(seed, t, i, 'deal'), k]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    row.forEach((p, i) => {
      const k = p.kind && NODE_KINDS[p.kind] && p.kind !== 'heart' ? p.kind : kinds[i % kinds.length];
      nodes.push({id: `n${t}${i}`, tier: t, kind: k, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, site: p.id.slice(0, 32), next: []});
    });
  }
  nodes.push({id: 'heart', tier: T.tiers - 1, kind: 'heart', x: Math.round(heart.x * 10) / 10, z: Math.round(heart.z * 10) / 10, site: heart.id.slice(0, 32), next: []});
  // Links: each node reaches its neighbour-aligned nodes in the next tier (1-2 each), and every node is reachable.
  for (let t = 0; t < T.tiers - 1; t++) {
    const a = nodes.filter(n => n.tier === t), b = nodes.filter(n => n.tier === t + 1);
    a.forEach((n, i) => {
      if (b.length === 1) { n.next = [b[0].id]; return; }
      const j = Math.round(i * (b.length - 1) / Math.max(1, a.length - 1));
      const set = new Set([b[j].id]);
      const k = j + (mix(seed, t, i, 'link') % 2 ? 1 : -1);
      if (b[k]) set.add(b[k].id);
      n.next = [...set].sort();
    });
    for (const m of b) if (!a.some(n => n.next.includes(m.id))) { const n = a[Math.min(a.length - 1, b.indexOf(m))]; n.next = [...new Set([...n.next, m.id])].sort(); }
  }
  return nodes;
}

// ---- State ------------------------------------------------------------------------------------------------
export function createRun({format = 'expedition', seed = 1, daily = '', camp = [0, 8], sites = [], bound = 55, boss = ''} = {}) {
  if (!Object.hasOwn(RUN_FORMATS, format)) throw Error('Invalid run format');
  if (!int(seed, 0, 2 ** 31)) throw Error('Invalid run seed');
  const nodes = buildRoute(seed, camp, sites);
  const bosses = Object.keys(BOSSES);
  return {v: RUN_VERSION, format, seed, daily: typeof daily === 'string' ? daily.slice(0, 10) : '', stage: 'camp', elapsed: 0, clock: 0,
    camp: [Math.round(camp[0] * 10) / 10, Math.round(camp[1] * 10) / 10], bound: clamp(bound, 20, 4000), nodes, at: '', path: [], target: '',
    boss: Object.hasOwn(BOSSES, boss) ? boss : bosses[mix(seed, 'boss') % bosses.length],
    lives: T.livesBase, maxLives: T.livesBase, mult: 1, haul: 0, kills: 0, deaths: 0, pushes: 0,
    foes: [], shards: [], objective: {have: 0, need: 0}, wave: 0, nextWave: 0,
    votes: {}, firstVote: 0, offers: {}, picks: {}, rerolls: {}, kits: {}, hall: {}, applied: {}, notice: 'Gather at camp and choose a starting kit.', result: null, seq: 0};
}
export const runActive = run => !!run && !RUN_ENDED.includes(run.stage);
export const runEnded = run => !!run && RUN_ENDED.includes(run.stage);
const node = (run, id) => run.nodes.find(n => n.id === id) || null;
/** Destinations the party may vote for right now. */
export function routeChoices(run) {
  if (run.stage !== 'route') return [];
  if (!run.at) return run.nodes.filter(n => n.tier === 0).map(n => n.id);
  return node(run, run.at)?.next.slice() || [];
}
export const nodeHaul = (run, n) => Math.round(NODE_KINDS[n.kind].haul * (1 + .35 * n.tier) * run.mult);

function present(world) {
  const players = Array.isArray(world?.players) ? world.players : [];
  return {players, heroes: players.filter(p => p.role === 'hero'), gods: players.filter(p => p.role === 'god')};
}
function notice(run, text) { run.notice = String(text).slice(0, 120); }
function enter(run, stage, out, extra = {}) {
  run.stage = stage; run.elapsed = 0; run.votes = {}; run.firstVote = 0;
  out.events.push({kind: 'run_stage', stage, ...extra});
}

// ---- Player upgrades --------------------------------------------------------------------------------------
function grantBoon(state, run, p, id, ctx, out) {
  const b = BOONS[id]; if (!b) return false;
  p.runBoons = Array.isArray(p.runBoons) ? p.runBoons : [];
  if (p.runBoons.length >= BOON_LIMIT) return false;
  p.runBoons.push(id);
  if (b.lives) { run.lives = Math.min(T.livesMax + 3, run.lives + b.lives); run.maxLives = Math.max(run.maxLives, run.lives); }
  if (b.xp && p.role === 'hero') ctx.grantXp?.(state, p, b.xp, out.events, p.position);
  if (b.hp > 0 && p.role === 'hero') p.hp = Math.min(ctx.heroMaxHp(p), p.hp + b.hp);
  if (p.role === 'hero') p.hp = Math.min(p.hp, ctx.heroMaxHp(p));
  out.events.push({kind: 'run_boon', id: p.id, boon: id, position: [...p.position]});
  return true;
}
function applyKit(state, run, p, ctx, out) {
  if (run.applied[p.id] || p.role !== 'hero' && p.role !== 'god') return;
  run.applied[p.id] = true;
  const hall = run.hall[nameKey(p.name)] || {};
  if (p.role === 'hero') {
    const kit = KITS[run.kits[p.id]] || KITS[KIT_IDS[mix(run.seed, nameKey(p.name)) % KIT_IDS.length]];
    run.kits[p.id] = kit.id;
    for (const [k, n] of Object.entries(kit.pack)) p.resources[k] = Math.min(999, (p.resources[k] || 0) + n);
    if (hall.packmule) for (const k of ['wood', 'stone', 'iron']) p.resources[k] = Math.min(999, (p.resources[k] || 0) + 4 * hall.packmule);
    p.tool = kit.tool;
    grantBoon(state, run, p, kit.boon, ctx, out);
    if (hall.seasoned) ctx.grantXp?.(state, p, 30 * hall.seasoned, out.events, p.position);
    p.hp = ctx.heroMaxHp(p);
  }
  run.rerolls[p.id] = hall.reroll || 0;
}
function poolFor(run, p) {
  const hall = run.hall[nameKey(p.name)] || {};
  return BOON_IDS.filter(id => { const b = BOONS[id]; return (b.role === 'any' || b.role === p.role) && (!b.unlock || hall[id]); });
}
function makeOffer(run, p, salt, rare = false) {
  const pool = poolFor(run, p), hall = run.hall[nameKey(p.name)] || {}, n = Math.min(pool.length, 3 + (hall.choice ? 1 : 0));
  const weight = id => BOONS[id].tier === 'common' ? (rare ? 1 : 6) : BOONS[id].tier === 'rare' ? (rare ? 5 : 2) : (rare ? 3 : 1);
  const offer = [], left = [...pool];
  for (let i = 0; i < n && left.length; i++) {
    const total = left.reduce((a, id) => a + weight(id), 0);
    let r = mix(run.seed, salt, nameKey(p.name), i) % total, k = 0;
    while (r >= weight(left[k])) { r -= weight(left[k]); k++; }
    offer.push(left.splice(k, 1)[0]);
  }
  return offer;
}

// ---- Encounters -------------------------------------------------------------------------------------------
function spawn(state, run, out, kind, at, radius, tag, ctx, extra = {}) {
  if (run.foes.length >= T.maxFoes || state.enemies.length >= 64) return null;
  const n = run.seq++, a = mix(run.seed, n, 'ang') / 4294967296 * Math.PI * 2, r = radius * (.6 + (mix(run.seed, n, 'r') % 40) / 100);
  const lim = run.bound - 1, x = clamp(at[0] + Math.cos(a) * r, -lim, lim), z = clamp(at[1] + Math.sin(a) * r, -lim, lim);
  const id = `rx${run.seed % 100000}_${n}`;
  if (state.enemies.some(e => e.id === id)) return null;
  const e = ctx.createEnemy(id, [x, ctx.terrainHeight(state, x, z), z], kind);
  if (kind === 'golem') Object.assign(e, {meteorBorn: true, unfurlTick: state.tick}); else e.emergeTick = state.tick;
  if (extra.boss) ctx.makeBoss(e, extra.boss);
  e.yaw = Math.atan2(at[0] - x, at[1] - z);
  state.enemies.push(e);
  run.foes.push({id, seen: true, tag});
  out.events.push({kind: 'run_spawn', id, creature: kind, position: [...e.position], ...(extra.boss ? {boss: extra.boss} : {})});
  return e;
}
function startFight(state, run, n, heroes, ctx, out) {
  const at = [n.x, n.z], h = clamp(heroes, 1, 6), tier = n.tier, push = run.pushes;
  run.objective = {have: 0, need: 0}; run.wave = 0; run.nextWave = 0; run.shards = [];
  if (n.kind === 'skirmish') for (let i = 0; i < 2 + tier + h + push; i++) spawn(state, run, out, 'skeleton', at, 5, 'w', ctx);
  else if (n.kind === 'elite' || n.kind === 'underways') {
    const golems = 1 + (tier >= 2 ? 1 : 0) + (h >= 3 ? 1 : 0) + (n.kind === 'underways' ? 1 : 0);
    for (let i = 0; i < golems; i++) spawn(state, run, out, 'golem', at, 4, 'g', ctx);
    for (let i = 0; i < 1 + h + push; i++) spawn(state, run, out, 'skeleton', at, 6, 'w', ctx);
  } else if (n.kind === 'treasure') {
    run.objective = {have: 0, need: T.shards};
    for (let i = 0; i < T.shards; i++) {
      const id = `rx${run.seed % 100000}s${run.seq++}`, a = i * 2.0944 + (mix(run.seed, n.id) % 100) / 50;
      const x = n.x + Math.cos(a) * 2.2, z = n.z + Math.sin(a) * 2.2;
      if (state.deposits.length + (state.pendingStarfalls?.length | 0) >= 80) break;
      state.deposits.push({id, x, z, kind: 'meteor', hits: 0, maxHits: 5, depleted: false});
      run.shards.push(id);
    }
    run.objective.need = run.shards.length;
    run.nextWave = s(6);
    out.events.push({kind: 'run_shards', position: [n.x, ctx.terrainHeight(state, n.x, n.z), n.z], ids: [...run.shards]});
  } else if (n.kind === 'hold') {
    run.objective = {have: 0, need: T.holdNeed};
    run.nextWave = s(2);
  } else if (n.kind === 'heart') {
    const boss = BOSSES[run.boss];
    spawn(state, run, out, boss.kind, at, .5, 'boss', ctx, {boss: run.boss});
    for (let i = 0; i < 2 + h; i++) spawn(state, run, out, 'skeleton', at, 7, 'w', ctx);
  }
  notice(run, NODE_KINDS[n.kind].text);
}
function stepFight(state, run, n, heroes, ctx, out) {
  const at = [n.x, n.z], tier = n.tier;
  if (n.kind === 'treasure') {
    const left = run.shards.filter(id => state.deposits.some(d => d.id === id && !d.depleted));
    run.objective.have = run.objective.need - left.length;
    if (run.elapsed >= run.nextWave && left.length) { run.nextWave = run.elapsed + T.ambush; run.wave++; for (let i = 0; i < 2 + Math.floor(tier / 2) + run.pushes; i++) spawn(state, run, out, 'skeleton', at, 11, 'a', ctx); }
    return !left.length && !run.foes.length;
  }
  if (n.kind === 'hold') {
    const inside = heroes.some(p => p.hp > 0 && flat(xz(p.position), at) <= T.holdRadius);
    if (inside && run.objective.have < run.objective.need) run.objective.have++;
    if (run.objective.have < run.objective.need && run.elapsed >= run.nextWave) {
      run.nextWave = run.elapsed + T.holdWave; run.wave++;
      for (let i = 0; i < 2 + tier + run.pushes; i++) spawn(state, run, out, run.wave % 4 === 3 && i === 0 ? 'golem' : 'skeleton', at, 12, 'h', ctx);
    }
    return run.objective.have >= run.objective.need && !run.foes.length;
  }
  return !run.foes.length;
}
function despawn(state, run) {
  const ids = new Set(run.foes.map(f => f.id));
  state.enemies = state.enemies.filter(e => !ids.has(e.id));
  run.foes = [];
}
function finish(state, run, outcome, out) {
  despawn(state, run);
  const banked = outcome === 'won' ? Math.round(run.haul * T.wonMult) : outcome === 'returned' ? run.haul : Math.floor(run.haul * T.fallenKeep);
  run.result = {outcome, banked, haul: run.haul, kills: run.kills, deaths: run.deaths, time: Math.round(run.clock / HZ), path: run.path.map(id => node(run, id)?.kind || 'heart'), tier: run.path.length};
  enter(run, outcome, out, {banked});
  notice(run, outcome === 'won' ? 'The Heart is won! Your whole haul is banked twice over.' : outcome === 'returned' ? 'Home safe. Your haul is banked.' : 'The party fell. A quarter of the haul made it home.');
}
function offerAll(state, run, players, n, out) {
  run.offers = {}; run.picks = {};
  for (const p of players) run.offers[p.id] = makeOffer(run, p, `${n.id}:${run.pushes}`, n.kind === 'shrine' || n.kind === 'heart' || n.kind === 'underways');
  out.events.push({kind: 'run_offers', node: n.id});
}

/** Advance exactly one simulation tick. `events` are all simulation events since the previous call. */
export function stepRun(state, events, ctx) {
  const run = state.run, out = {events: []};
  if (!runActive(run)) return out;
  const {players, heroes} = present(state);
  if (!players.length) return out; // nobody here: the clock and the waves wait
  run.elapsed = Math.min(run.elapsed + 1, 1e9);
  if (run.stage !== 'camp') run.clock = Math.min(run.clock + 1, 1e9);
  // Bookkeeping: run foes that left the world were felled; hero deaths spend the party's shared lives.
  const ids = new Set(state.enemies.map(e => e.id)), pids = new Set(players.map(p => p.id));
  const before = run.foes.length;
  run.foes = run.foes.filter(f => ids.has(f.id));
  if (run.foes.length < before && run.stage === 'fight') { const n = before - run.foes.length; run.kills += n; run.haul += n * T.killHaul; }
  if (run.stage !== 'camp') for (const e of events) if (e?.kind === 'death' && pids.has(e.id)) {
    run.deaths++;
    if (run.lives > 0) { run.lives--; out.events.push({kind: 'run_life', lives: run.lives, id: e.id}); }
    else { finish(state, run, 'fallen', out); return out; }
  }
  // Late joiners get their kit and Hall unlocks as soon as they arrive.
  if (run.stage !== 'camp') for (const p of players) if (!run.applied[p.id]) applyKit(state, run, p, ctx, out);
  if (run.stage === 'route') {
    const choices = routeChoices(run);
    if (choices.length === 1 && run.elapsed > T.interlude) return choose(state, run, choices[0], out), out;
    const votes = Object.entries(run.votes).filter(([id, c]) => pids.has(id) && choices.includes(c));
    if (votes.length && (votes.length >= players.length || run.elapsed - run.firstVote >= T.vote)) choose(state, run, tally(votes, choices), out);
  } else if (run.stage === 'travel') {
    const n = node(run, run.target);
    if (heroes.some(p => p.hp > 0 && flat(xz(p.position), [n.x, n.z]) <= T.arrive) || !heroes.length && run.elapsed > s(8)) {
      if (n.kind === 'shrine') { arrive(state, run, n, players, ctx, out); }
      else { enter(run, 'fight', out, {node: n.id}); startFight(state, run, n, heroes.length, ctx, out); }
    }
  } else if (run.stage === 'fight') {
    const n = node(run, run.target);
    if (stepFight(state, run, n, heroes, ctx, out)) arrive(state, run, n, players, ctx, out);
  } else if (run.stage === 'reward') {
    const waiting = players.filter(p => run.offers[p.id]?.length && !run.picks[p.id]);
    if (!waiting.length || run.elapsed >= T.pick) {
      for (const p of waiting) { run.picks[p.id] = run.offers[p.id][0]; grantBoon(state, run, p, run.offers[p.id][0], ctx, out); }
      if (run.at === 'heart') finish(state, run, 'won', out);
      else { enter(run, 'decide', out); notice(run, `Return and bank ${run.haul} Embers, or push on for a bigger haul (x${(run.mult + T.pushMult).toFixed(2)}).`); }
    }
  } else if (run.stage === 'decide') {
    const votes = Object.entries(run.votes).filter(([id, c]) => pids.has(id) && (c === 'return' || c === 'push'));
    if (votes.length && (votes.length >= players.length || run.elapsed - run.firstVote >= T.decide)) {
      const push = votes.filter(([, c]) => c === 'push').length, back = votes.length - push;
      if (push > back) { run.pushes++; run.mult = Math.round((run.mult + T.pushMult) * 100) / 100; enter(run, 'route', out); notice(run, 'Onward! Choose the next destination.'); }
      else finish(state, run, 'returned', out);
    }
  }
  return out;
}
function tally(votes, choices) {
  const count = new Map(); for (const [, c] of votes) count.set(c, (count.get(c) || 0) + 1);
  return [...choices].sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0) || choices.indexOf(a) - choices.indexOf(b))[0];
}
function choose(state, run, id, out) {
  const n = node(run, id); if (!n) return;
  run.target = id; enter(run, 'travel', out, {node: id});
  notice(run, `Head for the ${NODE_KINDS[n.kind].name}${n.kind === 'heart' ? '' : ` (tier ${n.tier + 1})`}.`);
}
function arrive(state, run, n, players, ctx, out) {
  const gain = nodeHaul(run, n);
  run.haul = Math.min(1e7, run.haul + gain); run.at = n.id; run.path.push(n.id); run.target = '';
  despawn(state, run);
  // Each cleared destination tops the party up a little (a shrine all the way).
  for (const p of players) { if (p.role === 'hero') p.hp = Math.min(ctx.heroMaxHp(p), n.kind === 'shrine' ? ctx.heroMaxHp(p) : p.hp + 30); p.mana = Math.min(100, p.mana + 30); }
  out.events.push({kind: 'run_cleared', node: n.id, haul: gain, position: [n.x, ctx.terrainHeight(state, n.x, n.z), n.z]});
  enter(run, 'reward', out, {node: n.id});
  offerAll(state, run, players, n, out);
  notice(run, `${NODE_KINDS[n.kind].name} cleared: +${gain} Embers. Choose an upgrade.`);
}

// ---- Commands ---------------------------------------------------------------------------------------------
/** {type:'run', action, ...} from a player. Mutates state.run (and the player). */
export function runAction(state, p, m, ctx) {
  const run = state.run;
  if (!run) return fail('no_run');
  if (!p) return fail('not_joined');
  const out = {events: []}, {players} = present(state);
  if (m.action === 'hall') {
    const key = nameKey(p.name);
    if (!Object.hasOwn(run.hall, key) && Object.keys(run.hall).length >= 64) return fail('hall_full');
    if (run.applied[p.id]) return fail('already_applied');
    run.hall[key] = cleanHall(m.hall); return ok();
  }
  if (runEnded(run)) return fail('run_over');
  if (m.action === 'kit') {
    if (!Object.hasOwn(KITS, m.kit) || p.role !== 'hero') return fail('invalid_kit');
    if (run.applied[p.id]) return fail('kit_locked');
    run.kits[p.id] = m.kit; return ok([{kind: 'run_kit', id: p.id, kit: m.kit}]);
  }
  if (m.action === 'begin') {
    if (run.stage !== 'camp') return fail('already_begun');
    const hallBest = k => Math.max(0, ...players.map(q => run.hall[nameKey(q.name)]?.[k] || 0));
    const heroes = players.filter(q => q.role === 'hero').length;
    run.lives = run.maxLives = clamp(T.livesBase + Math.max(0, heroes - 1) + hallBest('spark'), 1, T.livesMax);
    for (const q of players) applyKit(state, run, q, ctx, out);
    enter(run, 'route', out); notice(run, 'Choose your first destination.');
    return ok(out.events);
  }
  if (m.action === 'route') {
    if (!routeChoices(run).includes(m.node)) return fail('invalid_route');
    if (!Object.keys(run.votes).length) run.firstVote = run.elapsed;
    run.votes[p.id] = m.node; return ok([{kind: 'run_vote', id: p.id, node: m.node}]);
  }
  if (m.action === 'boon') {
    if (run.stage !== 'reward' || run.picks[p.id] || !run.offers[p.id]?.includes(m.boon)) return fail('invalid_boon');
    run.picks[p.id] = m.boon; grantBoon(state, run, p, m.boon, ctx, out); return ok(out.events);
  }
  if (m.action === 'reroll') {
    if (run.stage !== 'reward' || run.picks[p.id] || !run.offers[p.id] || !(run.rerolls[p.id] > 0)) return fail('no_reroll');
    run.rerolls[p.id]--; run.offers[p.id] = makeOffer(run, p, `${run.at}:reroll${run.rerolls[p.id]}:${run.pushes}`, true); return ok();
  }
  if (m.action === 'decide') {
    if (run.stage !== 'decide' || !['return', 'push'].includes(m.choice)) return fail('invalid_decision');
    if (!Object.keys(run.votes).length) run.firstVote = run.elapsed;
    run.votes[p.id] = m.choice; return ok([{kind: 'run_vote', id: p.id, choice: m.choice}]);
  }
  return fail('invalid_run_action');
}

// ---- Save validation --------------------------------------------------------------------------------------
const KEYS = ['v', 'format', 'seed', 'daily', 'stage', 'elapsed', 'clock', 'camp', 'bound', 'nodes', 'at', 'path', 'target', 'boss', 'lives', 'maxLives',
  'mult', 'haul', 'kills', 'deaths', 'pushes', 'foes', 'shards', 'objective', 'wave', 'nextWave', 'votes', 'firstVote', 'offers', 'picks', 'rerolls', 'kits', 'hall', 'applied', 'notice', 'result', 'seq'];
function idMap(o, ok, max = 64) { if (!record(o) || Object.keys(o).length > max) return false; return Object.entries(o).every(([k, v]) => /^[a-z0-9 _'.-]{1,64}$/i.test(k) && k !== '__proto__' && ok(v)); }
/** Strict whitelist validation of a saved run. Returns a clean copy or throws. */
export function restoreRun(saved) {
  const r = saved, bad = code => { throw Error(`Invalid run: ${code}`); };
  if (!record(r) || r.v !== RUN_VERSION) bad('version');
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) bad(`key_${k}`.slice(0, 40));
  for (const k of KEYS) if (!Object.hasOwn(r, k)) bad(`missing_${k}`);
  if (!Object.hasOwn(RUN_FORMATS, r.format) || !int(r.seed, 0, 2 ** 31) || typeof r.daily !== 'string' || r.daily.length > 10 || !RUN_STAGES.includes(r.stage)) bad('header');
  if (!int(r.elapsed, 0, 1e9) || !int(r.clock, 0, 1e9) || !Array.isArray(r.camp) || r.camp.length !== 2 || !r.camp.every(v => num(v, -4000, 4000)) || !num(r.bound, 20, 4000)) bad('clock');
  if (!Array.isArray(r.nodes) || r.nodes.length < 2 || r.nodes.length > 40) bad('nodes');
  const nodeIds = new Set();
  for (const n of r.nodes) {
    if (!record(n) || Object.keys(n).length !== 7 || !validId(n.id) || nodeIds.has(n.id) || !int(n.tier, 0, 9) || !Object.hasOwn(NODE_KINDS, n.kind) || !num(n.x, -4000, 4000) || !num(n.z, -4000, 4000) || typeof n.site !== 'string' || n.site.length > 32 || !Array.isArray(n.next) || n.next.length > 4) bad('node');
    nodeIds.add(n.id);
  }
  for (const n of r.nodes) if (!n.next.every(id => nodeIds.has(id))) bad('link');
  const nodeRef = id => id === '' || nodeIds.has(id);
  if (!nodeRef(r.at) || !nodeRef(r.target) || !Array.isArray(r.path) || r.path.length > 12 || !r.path.every(id => nodeIds.has(id)) || !Object.hasOwn(BOSSES, r.boss)) bad('path');
  if (!int(r.lives, 0, 20) || !int(r.maxLives, 0, 20) || !num(r.mult, 1, 20) || !int(r.haul, 0, 1e7) || !int(r.kills, 0, 1e9) || !int(r.deaths, 0, 1e9) || !int(r.pushes, 0, 20)) bad('score');
  if (!Array.isArray(r.foes) || r.foes.length > T.maxFoes || !r.foes.every(f => record(f) && Object.keys(f).length === 3 && validId(f.id) && f.seen === true && typeof f.tag === 'string' && f.tag.length <= 8)) bad('foes');
  if (!Array.isArray(r.shards) || r.shards.length > 8 || !r.shards.every(validId)) bad('shards');
  if (!record(r.objective) || Object.keys(r.objective).length !== 2 || !int(r.objective.have, 0, 1e7) || !int(r.objective.need, 0, 1e7)) bad('objective');
  if (!int(r.wave, 0, 1e6) || !int(r.nextWave, 0, 1e9) || !int(r.firstVote, 0, 1e9) || !int(r.seq, 0, 1e9)) bad('waves');
  if (!idMap(r.votes, v => typeof v === 'string' && (nodeIds.has(v) || v === 'return' || v === 'push'))) bad('votes');
  if (!idMap(r.offers, v => validBoonList(v) && v.length <= 4) || !idMap(r.picks, v => Object.hasOwn(BOONS, v)) || !idMap(r.rerolls, v => int(v, 0, 9))) bad('offers');
  if (!idMap(r.kits, v => Object.hasOwn(KITS, v)) || !idMap(r.applied, v => v === true) || !idMap(r.hall, v => record(v) && Object.entries(v).every(([k, n]) => HALL_IDS.includes(k) && int(n, 1, HALL[k].max)))) bad('players');
  if (typeof r.notice !== 'string' || r.notice.length > 120) bad('notice');
  if (r.result !== null && !(record(r.result) && RUN_ENDED.includes(r.result.outcome) && int(r.result.banked, 0, 1e8) && int(r.result.haul, 0, 1e7) && int(r.result.kills, 0, 1e9) && int(r.result.deaths, 0, 1e9) && int(r.result.time, 0, 1e8) && int(r.result.tier, 0, 12) && Array.isArray(r.result.path) && r.result.path.length <= 12 && r.result.path.every(k => Object.hasOwn(NODE_KINDS, k)) && Object.keys(r.result).length === 7)) bad('result');
  return structuredClone(r);
}
