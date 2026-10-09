// Taverns: one in each keep and The Muddled Mug, shared by both sides, off the lane south of the Forge.
// A tavern is a sanctuary: nobody inside can be hurt, nobody inside can hurt anyone, monsters are shooed out of the
// door, and heroes slowly mend. The barkeep pours a Hearty Ale (full health, then 20% less damage for three minutes).
// Voice is encouraged inside (insideTavern() is the hook the voice chat can read).
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {HOME_SITES, NEUTRAL_TAVERN, TAVERN_SCALE, homeBattle, homePiece, neutralTavern, pieceLocal, pieceWorld} from './home-bases.js';
import {heroMaxHp} from './hero-progress.js';

const at = (x, z) => Object.freeze([x * TAVERN_SCALE, z * TAVERN_SCALE]);
const zone = (min, max) => Object.freeze({min: at(...min), max: at(...max)});
export const TAVERN = Object.freeze({
  // Drawn and walled at TAVERN_SCALE times the kit (shared/home-bases.js); everything below is already scaled.
  scale: TAVERN_SCALE,
  // The safe zone in each tavern's own frame: the hall plus its front porch.
  keepZone: zone([-4.2, -3.3], [4.2, 4.6]),
  neutralZone: zone([-5.7, -4.3], [5.7, 5.8]),
  regenEvery: 20, regenHp: 1, // 3 health a second
  bar: Object.freeze({keep: at(0, -1.75), neutral: at(0, -2.55)}), barReach: 2.6,
  aleTicks: 180 * 60, aleArmor: .2,
});
export const TAVERN_NAMES = Object.freeze({party: 'The Gilded Anvil', rivals: 'The Rattling Tankard', neutral: 'The Muddled Mug'});

/** Every tavern in a home-base world: [{id, side ('party' | 'rivals' | 'neutral'), label, placed, zone, bar}]. */
export function taverns(state) {
  if (state?.battle?.v !== 2) return [];
  const keep = side => ({id: `tavern-${side}`, side, label: TAVERN_NAMES[side], placed: homePiece(side, 'tavern'), zone: TAVERN.keepZone, bar: TAVERN.bar.keep});
  return [keep('party'), keep('rivals'), {id: 'tavern-neutral', side: 'neutral', label: TAVERN_NAMES.neutral, placed: neutralTavern(), zone: TAVERN.neutralZone, bar: TAVERN.bar.neutral}];
}
const inZone = (t, [x, , z]) => { const [u, v] = pieceLocal(t.placed, [x, z]); return u >= t.zone.min[0] && u <= t.zone.max[0] && v >= t.zone.min[1] && v <= t.zone.max[1]; };
/** The tavern a point stands in, or null. Only while the home bases run. */
export function insideTavern(state, position) {
  if (!homeBattle(state) || !Array.isArray(position)) return null;
  // Cheap reject: every tavern sits within 26 m of a keep centre or 10 m (scaled) of the shared tavern.
  const near = Object.values(HOME_SITES).some(([a, b]) => Math.abs(position[0] - a) < 26 && Math.abs(position[2] - b) < 26)
    || Math.hypot(position[0] - NEUTRAL_TAVERN.at[0], position[2] - NEUTRAL_TAVERN.at[1]) < 10 * TAVERN_SCALE;
  if (!near) return null;
  for (const t of taverns(state)) if (inZone(t, position)) return t;
  return null;
}
/** True when a hero is sheltered by a tavern: no damage reaches them and theirs reaches no one. */
export const tavernSafe = (state, p) => !!p && p.role === 'hero' && !!insideTavern(state, p.position);
export const tavernBar = t => pieceWorld(t.placed, t.bar);

/** Shoos a monster or hostile bot out of any tavern's door (mutates position). */
export function resolveTaverns(state, position, radius = .4) {
  const t = insideTavern(state, position); if (!t) return position;
  const [u, v] = pieceLocal(t.placed, [position[0], position[2]]);
  [position[0], position[2]] = pieceWorld(t.placed, [u, t.zone.max[1] + radius]);
  return position;
}

/** Per tick: heroes inside a tavern mend slowly. */
export function stepTaverns(state) {
  if (!homeBattle(state) || state.tick % TAVERN.regenEvery) return;
  for (const p of state.players) if (p.role === 'hero' && p.hp > 0 && p.hp < heroMaxHp(p) && insideTavern(state, p.position)) p.hp = Math.min(heroMaxHp(p), p.hp + TAVERN.regenHp);
}

/** The Hearty Ale's damage cut for a hero right now (0 when none). */
export const aleArmor = (state, p) => (p?.heartyUntil ?? 0) > state.tick ? TAVERN.aleArmor : 0;

/** tavernAle: at any tavern's bar, a hero is poured a Hearty Ale. */
export function tavernAle(state, p) {
  const fail = code => ({ok: false, code, events: []});
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const t = taverns(state).find(t => { const [x, z] = tavernBar(t); return Math.hypot(p.position[0] - x, p.position[2] - z) <= TAVERN.barReach; });
  if (!t) return fail('too_far');
  if ((p.heartyUntil ?? 0) > state.tick) return fail('cooldown');
  p.hp = heroMaxHp(p); p.heartyUntil = state.tick + TAVERN.aleTicks;
  const [x, z] = tavernBar(t);
  return {ok: true, events: [{kind: 'tavern_ale', id: p.id, tavern: t.id, hp: p.hp, until: p.heartyUntil, position: [x, p.position[1] + 1.1, z]}]};
}
