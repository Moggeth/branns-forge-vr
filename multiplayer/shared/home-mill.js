// The Gold mill in each keep (battle v2). A Hero tips gold ore, copper ore and stone into the hopper (millFeed) and
// the mill grinds it into Gold for the Quartermaster, paid to whoever fed it, coin by coin out of the chute.
// Anyone on the keep's side can lean on the capstan (millCrank, sent while held) to grind three times as fast.
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {itemBonus} from './hero-items.js';
import {baseFallen, homeBattle, homePiece, pieceWorld} from './home-bases.js';

export const MILL = Object.freeze({
  hopper: Object.freeze([0, 3.3]), crank: Object.freeze([-2, 3]), chute: Object.freeze([1.3, 3]), reach: 2.3, crankReach: 1.9,
  // Gold per unit tipped in: gold ore pays double, copper one each, stone a coin for every four.
  rates: Object.freeze({goldOre: 2, copperOre: 1, stone: .25}),
  coinTicks: 75, crankedTicks: 25, crankHold: 12, queue: 12, maxOwed: 999,
});
const fail = code => ({ok: false, code, events: []});
export const millAt = (side, point) => pieceWorld(homePiece(side, 'mill'), point);
export const isMillAction = action => action === 'millFeed' || action === 'millCrank';
const near = (p, [x, z], r) => Math.hypot(p.position[0] - x, p.position[2] - z) <= r;
export const millOf = base => base.mill ??= {queue: [], progress: 0, crankUntil: 0};

export function millAction(state, p, m) {
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const side = p.side || 'party', base = state.battle.bases.find(b => b.side === side);
  if (!base || baseFallen(state, base)) return fail('base_fallen');
  const mill = millOf(base);
  if (m.action === 'millCrank') {
    if (!near(p, millAt(side, MILL.crank), MILL.crankReach)) return fail('too_far');
    const first = mill.crankUntil <= state.tick;
    mill.crankUntil = state.tick + MILL.crankHold;
    return {ok: true, events: first ? [{kind: 'mill_crank', id: p.id, side, position: [...p.position]}] : []};
  }
  if (!near(p, millAt(side, MILL.hopper), MILL.reach)) return fail('too_far');
  const r = p.resources, given = {};
  let worth = 0;
  for (const [kind, rate] of Object.entries(MILL.rates)) {
    let n = r[kind] || 0;
    if (kind === 'stone') n -= n % 4; // stone grinds in fours
    if (n <= 0) continue;
    given[kind] = n; worth += n * rate;
  }
  if (!worth) return fail('nothing_to_mill');
  const gold = Math.floor(worth * (1 + itemBonus(p, 'millBonus')));
  const mine = mill.queue.find(q => q.id === p.id);
  if (!mine && mill.queue.length >= MILL.queue) return fail('mill_busy');
  for (const [kind, n] of Object.entries(given)) r[kind] -= n;
  if (mine) mine.gold = Math.min(MILL.maxOwed, mine.gold + gold); else mill.queue.push({id: p.id, gold: Math.min(MILL.maxOwed, gold)});
  const [x, z] = millAt(side, MILL.hopper);
  return {ok: true, events: [{kind: 'mill_feed', id: p.id, side, given, gold, position: [x, p.position[1] + 1.4, z]}]};
}

/** Per tick: grind one coin at a time for the hero at the head of the queue (faster while cranked). */
export function stepMills(state, events) {
  if (!homeBattle(state)) return;
  for (const base of state.battle.bases) {
    const mill = base.mill; if (!mill?.queue.length || baseFallen(state, base)) continue;
    mill.progress++;
    if (mill.progress < (mill.crankUntil > state.tick ? MILL.crankedTicks : MILL.coinTicks)) continue;
    mill.progress = 0;
    const head = mill.queue[0], hero = state.players.find(p => p.id === head.id);
    if (!hero?.resources) { mill.queue.shift(); continue; } // left the world: their grist is lost
    head.gold--;
    if (head.gold <= 0) mill.queue.shift();
    if ((hero.resources.gold || 0) < 999) hero.resources.gold = (hero.resources.gold || 0) + 1;
    const [x, z] = millAt(base.side, MILL.chute);
    events.push({kind: 'mill_coin', id: hero.id, side: base.side, gold: hero.resources.gold, owed: head.gold, position: [x, base.position[1] + .6, z]});
  }
}

export function restoreMill(m, tick) {
  if (m === undefined) return undefined;
  const ok = m && Array.isArray(m.queue) && m.queue.length <= MILL.queue && Number.isSafeInteger(m.progress) && m.progress >= 0 && m.progress <= MILL.coinTicks
    && Number.isFinite(m.crankUntil) && m.crankUntil >= 0 && m.crankUntil <= tick + MILL.crankHold
    && m.queue.every(q => q && typeof q.id === 'string' && /^[-\w]{1,64}$/.test(q.id) && Number.isSafeInteger(q.gold) && q.gold > 0 && q.gold <= MILL.maxOwed);
  if (!ok) throw Error('Invalid home bases');
  return {queue: m.queue.map(q => ({id: q.id, gold: q.gold})), progress: m.progress, crankUntil: m.crankUntil};
}
