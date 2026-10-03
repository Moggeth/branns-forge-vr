// Orchard's Edge special: the cleave (2026-10-03, replaces the axe's Sunder line). One wide horizontal sweep in front
// of the hero. Every skeleton inside the arc is cut down in one hit (armoured golems take a heavy blow and are thrown
// back), and every standing tree inside it is felled away from the hero with the usual log yield. No terrain edits,
// no deposits. Pure and deterministic: no clock, no RNG; the client draws the sweep from the event.
import {terrainHeight} from './terrain.js';
import {worldTrees} from './world-content.js';
import {chopTree, trunkRadius, treeScale, isFelled, CUT_RANGE} from './trees.js';
import {specialCooldown} from './special-cooldowns.js';

// Tunable; room for mastery to grow reach, arc and the tree cap later.
export const AXE_CLEAVE = Object.freeze({
  reach: 4.5,          // metres from the hero to the far edge of the sweep
  arc: 140,            // degrees, centred on facing
  inner: .6,           // anything closer than this counts as in front regardless of angle
  body: .45,           // enemy body radius added to the reach
  height: 2.6,         // max vertical separation for a hit
  golemDamage: 120,    // to the torso of an armoured golem (armour still applies)
  knockback: 1.6,      // metres, survivors only
  trees: 4,            // most trees felled by one cleave, nearest first
  cutHeight: .85,      // felling cut, authored metres above the root flare (inside CUT_RANGE)
});

const facingOf = p => [-Math.sin(p.yaw) || 0, -Math.cos(p.yaw) || 0];
// Inside the sweep: within reach (plus a target radius) and within half the arc of facing, or right at the hero's feet.
export function inCleave(p, x, z, radius = 0) {
  const [fx, fz] = facingOf(p), dx = x - p.position[0], dz = z - p.position[2], d = Math.hypot(dx, dz);
  if (d > AXE_CLEAVE.reach + radius) return false;
  if (d < AXE_CLEAVE.inner + radius) return true;
  return (fx * dx + fz * dz) / d >= Math.cos(AXE_CLEAVE.arc / 2 * Math.PI / 180) - radius / d;
}

/** Targets of a cleave from the current state, without changing anything. */
export function planCleave(state, p) {
  const y = p.position[1];
  const enemies = state.enemies.filter(e => Math.abs(e.position[1] - y) < AXE_CLEAVE.height && inCleave(p, e.position[0], e.position[2], AXE_CLEAVE.body));
  const felled = new Set(state.harvestedTrees.filter(isFelled).map(h => h.id));
  const trees = worldTrees(state).filter(t => !felled.has(t.id))
    .map(t => ({t, floor: terrainHeight(state, t.x, t.z), d: Math.hypot(t.x - p.position[0], t.z - p.position[2])}))
    .filter(({t, floor}) => Math.abs(floor - y) < AXE_CLEAVE.height && inCleave(p, t.x, t.z, trunkRadius(t, 1)))
    .sort((a, b) => a.d - b.d || (a.t.id < b.t.id ? -1 : 1)).slice(0, AXE_CLEAVE.trees);
  return {enemies, trees};
}

export function axeCleave(state, p, ctx, hitEnemyPart) {
  if (state.tick - (p.specialTick ?? -1000) < specialCooldown('axe')) return {ok: false, code: 'cooldown', events: []};
  const {enemies, trees} = planCleave(state, p), [fx, fz] = facingOf(p), events = [], hits = [], felled = [];
  const position = [p.position[0], terrainHeight(state, p.position[0], p.position[2]), p.position[2]];
  p.specialTick = state.tick;
  for (const enemy of enemies) {
    const armored = enemy.kind === 'golem';
    hitEnemyPart(state, enemy, 'torso', armored ? AXE_CLEAVE.golemDamage : Math.max(1, enemy.hp),
      {tool: 'axe', point: [enemy.position[0], enemy.position[1] + 1, enemy.position[2]], normal: [-fx, 0, -fz], ownerId: p.id}, ctx, events);
    hits.push(enemy.id);
    if (state.enemies.includes(enemy)) {
      enemy.position[0] = Math.max(-49, Math.min(49, enemy.position[0] + fx * AXE_CLEAVE.knockback));
      enemy.position[2] = Math.max(-49, Math.min(49, enemy.position[2] + fz * AXE_CLEAVE.knockback));
    }
  }
  for (const {t, floor, d} of trees) {
    // Cut on the hero's side of the trunk so it falls away from them; an existing notch keeps its height.
    const wound = state.harvestedTrees.find(h => h.id === t.id), s = treeScale(t);
    const height = wound ? wound.cutHeight : floor + Math.min(CUT_RANGE[1], Math.max(CUT_RANGE[0], AXE_CLEAVE.cutHeight)) * s;
    const nx = d > 1e-3 ? (p.position[0] - t.x) / d : -fx, nz = d > 1e-3 ? (p.position[2] - t.z) / d : -fz, r = trunkRadius(t, height - floor);
    const point = [t.x + nx * r, height, t.z + nz * r];
    let fell = false;
    for (let cut = 0; cut < 3 && !fell; cut++) {
      const chop = chopTree(state, t, point, [nx, 0, nz], {terrainHeight: (x, z) => terrainHeight(state, x, z)});
      if (chop.code || !chop.events?.some(e => !e.glance)) break;
      events.push(...chop.events.map(e => ({...e, by: p.id}))); fell = chop.events.some(e => e.kind === 'tree_fell');
    }
    if (fell) felled.push(t.id);
  }
  events.unshift({kind: 'axe_cleave', weapon: 'axe', id: p.id, tick: state.tick, position, direction: [fx, 0, fz],
    reach: AXE_CLEAVE.reach, arc: AXE_CLEAVE.arc, hits, trees: felled});
  return {ok: true, events};
}
