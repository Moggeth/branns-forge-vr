// Mining feel (2026-10-29): what a deposit itself does when a pick lands in it, and how it gives way on the last blow.
// Presentation only: the shared simulation still owns every hit, the damage count and the reward.
//
//   shudder   the struck rock rocks back on its bed away from the blow and squashes a touch, then settles (a damped
//             spring, so it reads at any frame rate and never steps at snapshot rate).
//   heat      the freshly opened fracture faces glow ember-orange for a moment after each blow; minerals that carry their
//             own light (crystal, mithril, star ore) glow steadily brighter the deeper the pick has gone.
//   burst     the last blow: every shell still on the rock is thrown outward, tumbles, bounces on the ground and sinks
//             away, under a heavy spray of rubble, ore flecks, sparks and a dust cloud from the impact artist.
//
// Budget: no lights, no new materials (shells keep the rock's own shared materials), at most BURST_CAP flying shells in
// the world at once; one pivot Group per flying shell, freed when it lands and shrinks away.
import * as T from 'three';

export const MINING_FEEL = Object.freeze({
  tilt: .05,        // rad the rock rocks back on an ordinary blow (more as it weakens)
  squash: .045,     // fraction of height it squashes on the blow
  frequency: 8.5,   // Hz of the settle
  damping: 11,      // 1/s decay of the settle
  burstCap: 48,     // flying shells at once across every breaking rock
  burstLife: [1.2, 1.8],
});
// Inner light of minerals that glow on their own (mechanical coherence: crystal and star ore carry light; iron does not).
export const MINERAL_GLOW = Object.freeze({crystal: 0x9a6be8, mithril: 0x6fe0f0, meteor: 0xff8a12, star: 0xff8a12});
// The ember of a fresh fracture after a steel blow.
export const STRIKE_HEAT = 0xd8601e;

const UP = new T.Vector3(0, 1, 0);

export function createMiningFeel({scene, height = () => 0, emit = () => null, reducedMotion = false} = {}) {
  const motion = reducedMotion ? .35 : 1;
  const shudders = new Map(); // root -> {t, amp, squash, axis, q0, s0}
  const debris = [];
  const stats = {strikes: 0, bursts: 0, flying: 0};
  const axis = new T.Vector3(), q = new T.Quaternion();

  /**
   * A pick blow landed on a deposit. root: the deposit's scene root; fracture: its mining-fracture controller (or null);
   * kind: deposit kind; normal: world surface normal at the blow; weakness: 0 fresh .. 1 about to break.
   */
  function strike({root, fracture = null, kind = 'stone', normal = null, weakness = 0} = {}) {
    if (!root) return;
    stats.strikes++;
    let entry = shudders.get(root);
    if (!entry) { entry = {t: 0, amp: 0, squash: 0, axis: new T.Vector3(1, 0, 0), q0: root.quaternion.clone(), s0: root.scale.clone()}; shudders.set(root, entry); }
    // Rock back away from the blow: tip about the horizontal axis perpendicular to the blow's push.
    const n = normal && normal.length >= 3 ? axis.set(normal[0], 0, normal[2]) : axis.set(0, 0, 1);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    entry.axis.crossVectors(UP, n.normalize().negate()).normalize();
    const w = Math.min(1, Math.max(0, weakness));
    entry.t = 0; entry.amp = MINING_FEEL.tilt * (.7 + .6 * w) * motion; entry.squash = MINING_FEEL.squash * (.8 + .5 * w) * motion;
    fracture?.heat?.(.8 + .4 * w, STRIKE_HEAT);
    const glow = MINERAL_GLOW[kind];
    if (glow) fracture?.glow?.(glow, .25 + .75 * w);
  }

  // Last shell gone: free the split geometry and whatever the owner kept alive for it (its own tinted materials).
  function finish(owner) { if (owner.finished) return; owner.finished = true; owner.fracture?.dispose?.(); owner.done?.(); }

  function settle(root, entry) {
    root.quaternion.copy(entry.q0); root.scale.copy(entry.s0); shudders.delete(root);
  }

  /**
   * The deposit gave way. Takes ownership of root (already untargeted by the caller); fracture/light are disposed when
   * the last shell has gone. position: [x,y,z] of the rock's foot; kind picks the spray's mineral.
   */
  function burst({root, fracture = null, light = null, kind = 'stone', position = null, attach = null, done = null} = {}) {
    if (!root) return;
    stats.bursts++;
    const entry = shudders.get(root);
    if (entry) settle(root, entry);
    root.updateMatrixWorld(true);
    const foot = position || root.position.toArray();
    // No damage yet (a one-blow break): split it now so it still comes apart in pieces.
    if (!fracture && attach) fracture = attach(root);
    const shells = fracture?.release?.() || [];
    light?.dispose?.();
    const owner = {fracture, root, pending: 0, done};
    const room = Math.max(0, MINING_FEEL.burstCap - debris.length);
    let seed = 0; for (const c of String(foot.map(v => v.toFixed(2)))) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) | 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (i >= room) { s.mesh.removeFromParent(); continue; }
      const pivot = new T.Group(); pivot.position.copy(s.centroid); scene.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(s.mesh);
      const out = s.out.clone(); out.y = Math.max(out.y, 0) * .6 + .25; out.normalize();
      const speed = 1.1 + rnd() * 1.1;
      const [lo, hi] = MINING_FEEL.burstLife;
      debris.push({pivot, owner, t: 0, life: lo + rnd() * (hi - lo), v: out.multiplyScalar(speed).add(new T.Vector3(0, 1.7 + rnd() * 1.1, 0)),
        spin: new T.Vector3(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4), rest: false, bounces: 0,
        radius: Math.max(.06, (s.mesh.geometry.boundingSphere?.radius || .3) * .3)});
      owner.pending++;
    }
    // Whatever is left of the rock (craters, inner walls) vanishes under the dust and flash.
    root.removeFromParent();
    if (!owner.pending) finish(owner);
    const at = [foot[0], foot[1] + .45, foot[2]];
    emit({material: 'ore:' + kind, position: at, normal: [0, 1, 0], energy: 2, burst: true, steel: true, seed: seed | 0});
    emit({material: 'ore:' + kind, position: [foot[0], foot[1] + .15, foot[2]], normal: [0, 1, 0], energy: 1.6, burst: true, steel: false, seed: (seed ^ 0x5bd1e995) | 0});
  }

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, .05);
    for (const [root, e] of shudders) {
      e.t += dt;
      const decay = Math.exp(-e.t * MINING_FEEL.damping);
      if (decay < .01 || !root.parent) { settle(root, e); continue; }
      const wave = Math.cos(e.t * Math.PI * 2 * MINING_FEEL.frequency);
      q.setFromAxisAngle(e.axis, e.amp * decay * wave);
      root.quaternion.copy(e.q0).premultiply(q);
      const sq = e.squash * Math.exp(-e.t * MINING_FEEL.damping * 1.6) * wave;
      root.scale.set(e.s0.x * (1 + sq * .5), e.s0.y * (1 - sq), e.s0.z * (1 + sq * .5));
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], p = d.pivot;
      d.t += dt;
      if (!d.rest) {
        d.v.y -= 9.8 * dt;
        p.position.addScaledVector(d.v, dt);
        p.rotation.x += d.spin.x * dt; p.rotation.y += d.spin.y * dt; p.rotation.z += d.spin.z * dt;
        const floor = height(p.position.x, p.position.z) + d.radius;
        if (p.position.y < floor) {
          p.position.y = floor;
          if (d.v.y < -1.4 && d.bounces < 2) { d.bounces++; d.v.y *= -.32; d.v.x *= .5; d.v.z *= .5; d.spin.multiplyScalar(.45); }
          else d.rest = true;
        }
      }
      // Sink into the grass and shrink away over the last half second.
      // Broken pieces read smaller than the rock they came from; they also sink and shrink away over the last half second.
      const k = Math.min(1, Math.max(0, (d.life - d.t) / .5)), e = k * k * (3 - 2 * k);
      p.scale.setScalar(Math.max(.001, e * (1 - .3 * Math.min(1, d.t / .25))));
      if (d.rest) p.position.y -= dt * .08;
      if (d.t >= d.life) {
        p.removeFromParent(); debris.splice(i, 1);
        if (--d.owner.pending <= 0) finish(d.owner);
      }
    }
    stats.flying = debris.length;
  }

  function dispose() {
    for (const [root, e] of shudders) settle(root, e);
    const owners = new Set();
    for (const d of debris) { d.pivot.removeFromParent(); owners.add(d.owner); }
    debris.length = 0;
    for (const o of owners) finish(o);
  }

  return {strike, burst, update, dispose, stats: () => ({...stats, shuddering: shudders.size})};
}
