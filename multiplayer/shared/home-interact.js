// Hands-on home base pieces (battle v2), for Heroes of the base's own side:
//   homeDrink: a long drink at the healing well heals 40 at once and fills your Healing Draught (each hero every 10 s).
//   homeBell:  ringing the barracks bell sends a squad out now (once per base every 75 s).
// Ballistas are manned in shared/home-ballista.js; hammer repairs go through attackBattleBase.
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {HOME, HOME_LAYOUT, baseFallen, bellPostAt, homeBattle, homePoint} from './home-bases.js';
import {spawnSquad} from './battle-mode.js';
import {heroMaxHp} from './hero-progress.js';
import {draughtCap, fillDraughts} from './home-shop.js';

const fail = code => ({ok: false, code, events: []});
const near = (p, [x, z], r) => Math.hypot(p.position[0] - x, p.position[2] - z) <= r;
export const isHomeAction = action => action === 'homeDrink' || action === 'homeBell';

/** c: {createEnemy, nextId, terrainHeight} */
export function homeAction(state, p, m, c) {
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const base = state.battle.bases.find(b => b.side === (p.side || 'party'));
  if (!base || baseFallen(state, base)) return fail('base_fallen');
  if (m.action === 'homeDrink') {
    if (!near(p, homePoint(base.side, HOME_LAYOUT.fountain), HOME.drink.reach)) return fail('too_far');
    if (state.tick < (p.drinkTick ?? -1e9) + HOME.drink.cooldown) return fail('cooldown');
    if (p.hp >= heroMaxHp(p) && (p.draughts || 0) >= draughtCap(p)) return fail('not_needed');
    const before = p.hp;
    p.hp = Math.min(heroMaxHp(p), p.hp + HOME.drink.heal); p.drinkTick = state.tick;
    const filled = fillDraughts(p), [x, z] = homePoint(base.side, HOME_LAYOUT.fountain);
    return {ok: true, events: [{kind: 'home_drink', id: p.id, side: base.side, hp: p.hp, healed: p.hp - before, filled, draughts: p.draughts,
      readyTick: state.tick + HOME.drink.cooldown, position: [...p.position], well: [x, p.position[1], z]}]};
  }
  if (m.action === 'homeBell') {
    if (!near(p, bellPostAt(base.side), HOME.bell.reach)) return fail('too_far');
    if (state.tick < (base.bellReadyTick ?? 0)) return fail('cooldown');
    const count = spawnSquad(state, c, base, `b${state.tick}`);
    if (!count) return fail('squad_full');
    base.bellReadyTick = state.tick + HOME.bell.cooldown;
    const [x, z] = bellPostAt(base.side);
    return {ok: true, events: [{kind: 'home_bell', id: p.id, side: base.side, count, readyTick: base.bellReadyTick, position: [x, c.terrainHeight(state, x, z), z]}]};
  }
  return fail('invalid_action');
}
