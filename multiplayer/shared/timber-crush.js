// "Timber!" (axe talent): a tree you fell crushes the foes it lands on. The trunk's footprint is the line from its
// stump along the way it fell, as long as the tree is tall; every foe under that line takes a heavy blow and is thrown.
// Runs on the host after the trees step, from the tree_land events (the exact tick the trunk touches the ground), so
// the hit lands when you see the crash. Pure and deterministic.
import {talentRank} from './hero-progress.js';
import {friendlyEnemyHit} from './battle-mode.js';

// [half-width of the crush line in metres, damage] per rank.
export const TIMBER_RANKS = Object.freeze([Object.freeze([1.1, 60]), Object.freeze([1.4, 90]), Object.freeze([1.8, 130])]);
const ENEMY_RADIUS = .45;

/** Who felled this tree and how hard their Timber! hits, or null. */
function feller(state, h) {
  const p = h?.by && state.players.find(q => q.id === h.by && q.role === 'hero');
  const rank = p ? Math.min(3, talentRank(p, 'axe', 'timber')) : 0;
  return rank ? {p, rank} : null;
}

/** Distance from (x, z) to the segment a..b on the ground plane. */
function toSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Crush foes under every trunk that landed in events[from..]. ctx: {trees (tree index), hitEnemyPart, combat, terrainHeight}. */
export function timberCrush(state, events, from, ctx) {
  const out = [];
  for (let i = from; i < events.length; i++) {
    const e = events[i]; if (e?.kind !== 'tree_land') continue;
    const h = state.harvestedTrees?.find(t => t.id === e.id), who = feller(state, h);
    if (h) delete h.by; // only a falling tree needs its feller (saves of landed trees never carry it)
    const tree = who && ctx.trees.get(e.id); if (!tree) continue;
    // tree_land's position sits 2 m along the fall, so it gives the direction; the trunk reaches the tree's height.
    const dx = e.position[0] - tree.x, dz = e.position[2] - tree.z, d = Math.hypot(dx, dz) || 1;
    const length = Math.max(2, tree.height || 6), ax = tree.x, az = tree.z, bx = ax + dx / d * length, bz = az + dz / d * length;
    const [width, damage] = TIMBER_RANKS[who.rank - 1], hits = [];
    for (const enemy of [...state.enemies]) {
      if (enemy.hp <= 0 || toSegment(enemy.position[0], enemy.position[2], ax, az, bx, bz) > width + ENEMY_RADIUS) continue;
      if (friendlyEnemyHit(state, enemy, {ownerId: who.p.id})) continue;
      // A refused hit (ward, tavern peace) neither counts nor throws the foe.
      if (!ctx.hitEnemyPart(state, enemy, 'torso', damage, {tool: 'axe', point: [enemy.position[0], enemy.position[1] + 1, enemy.position[2]], ownerId: who.p.id}, ctx.combat, out)) continue;
      hits.push(enemy.id); if (state.enemies.includes(enemy)) enemy.launchTick = state.tick;
    }
    if (hits.length) out.push({kind: 'timber_crush', id: e.id, by: who.p.id, rank: who.rank, position: [...e.position],
      from: [ax, ctx.terrainHeight(ax, az), az], to: [bx, ctx.terrainHeight(bx, bz), bz], hits});
  }
  events.push(...out);
}
