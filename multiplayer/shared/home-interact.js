// Hands-on home base pieces (battle v2), for Heroes of the base's own side:
//   homeDrink: a long drink at the fountain heals 40 at once (one drink per base every 20 s).
//   homeBell:  ringing the barracks bell sends a squad out now (once per base every 75 s).
// Ballistas are manned in shared/home-ballista.js; hammer repairs go through attackBattleBase.
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {HOME, HOME_LAYOUT, baseFallen, bellPostAt, homeBattle, homePoint} from './home-bases.js';
import {spawnSquad} from './battle-mode.js';

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
    if (state.tick < (base.drinkReadyTick ?? 0)) return fail('cooldown');
    if (p.hp >= 100) return fail('not_needed');
    p.hp = Math.min(100, p.hp + HOME.drink.heal); base.drinkReadyTick = state.tick + HOME.drink.cooldown;
    return {ok: true, events: [{kind: 'home_drink', id: p.id, side: base.side, hp: p.hp, readyTick: base.drinkReadyTick, position: [...p.position]}]};
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
