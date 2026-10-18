// The Armoury: a hall in the meadow off Dawnhold's gate (placement and walls in shared/home-bases.js ARMOURY /
// TOWN_SOLIDS.armoury). Its weapon stand holds the Flockwright, the six-bird crew crossbow. A Hero of either side who
// steps up to the stand and presses Use takes one down: from then on it is theirs, on its own hotbar key.
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {armouryPiece, homeBattle, pieceWorld} from './home-bases.js';

export const ARMOURY_RULES = Object.freeze({
  stand: Object.freeze([0, -.35]), // the weapon stand in the hall's own frame (three.js x, z)
  reach: 2.6,
});
export const isArmouryAction = action => action === 'armouryTake';
/** World [x, z] of the Armoury's weapon stand. */
export const armouryStand = () => pieceWorld(armouryPiece(), ARMOURY_RULES.stand);
/** True once a Hero has taken a Flockwright down from the Armoury's stand. */
export const hasFlockwright = p => p?.flockwright === true;

export function armouryAction(state, p) {
  const fail = code => ({ok: false, code, events: []});
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const [x, z] = armouryStand();
  if (Math.hypot(p.position[0] - x, p.position[2] - z) > ARMOURY_RULES.reach) return fail('too_far');
  const first = !hasFlockwright(p);
  p.flockwright = true;
  return {ok: true, events: [{kind: 'armoury_take', id: p.id, by: p.id, first, position: [x, p.position[1] + 1.1, z]}]};
}
