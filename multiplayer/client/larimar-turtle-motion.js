// Shellbright's life in Larimar Cove: what the turtle is doing (the brain) and how its body moves (the pose).
//
// The brain is a small fixed-step simulation in the cove's corner space (shared/larimar-cove.js). Every client runs it
// from the same seed and the same world clock, so everyone sees the turtle doing the same thing: each 150 s day of its
// life starts and ends basking on its rock in exactly the same pose, so even a player who joins late or tabs away is
// back in step by the next cycle. In between it slides into the water, swims laps with a real stroke-and-glide rhythm,
// surfaces to breathe, and (only on clients that can see them) swims over to say hello to heroes standing at the
// shore. Then it heads home, hauls itself up onto the rock with the butterfly crawl sea turtles use on land, turns
// round in little shuffles and settles to bask, facing the lake and the town.
//
// The pose is computed every frame from the brain's interpolated state (never stepped), with its own continuous
// oscillators for breathing, blinks and look-arounds: front flippers that fly (power down-stroke, feathered recovery,
// the wave running out to the tip), rear flippers that steer and paddle, a head that counters the body's bob and
// follows whatever has caught its eye, blinks, breaths with an open mouth at the surface, yawns and a stretched-out
// back flipper while basking. Pure maths, no three.js, so the tests can run it in Node.
import {COVE} from '../shared/larimar-cove.js';

export const TURTLE = Object.freeze({
  cycle: 150,          // seconds in one day of its life: bask, swim, come home, bask
  scale: 1.25,         // the model is built pendant-true at 0.9 m nose to tail; in the world it is a little grander
  step: 1 / 30,        // brain step; the pose interpolates between steps
  baskFirst: [8, 30],  // seconds it lingers on the rock at the start of a cycle
  homeAt: 105,         // stop wandering and head home at this point in the cycle
  forceHaulAt: 128,    // if it still is not home, haul out from wherever it is
  slideTime: 3.4, haulTime: 4.4, turnTime: 5.2,
  cruise: .62,         // m/s at a steady stroke
  breatheEvery: [18, 32], breatheFor: [4.5, 7.5],
  bodyDrop: .156,      // origin above the plastron (what rests on the rock), at scale
  surfaceY: -.16,      // origin height below the water while breathing at the surface (shell top above water)
  visitReach: 3.2,     // a hero this close to the water (metres beyond the shoreline) catches its eye
  visitFor: 26, visitCooldown: 14,
});
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), clamp01 = v => clamp(v, 0, 1);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const range = (r, [a, b]) => a + (b - a) * r();

/** The fixed poses the brain moves between, in corner space. y is the body origin's height above the water. */
export function coveAnchors(rockTop = COVE.rock.top) {
  const R = COVE.rock, face = R.face, fu = Math.sin(face), fv = Math.cos(face);
  return {
    bask: {u: R.u - fu * .05, v: R.v - fv * .05, y: rockTop + TURTLE.bodyDrop, yaw: face},
    // in the water off the rock's lake side, facing the rock, ready to climb out
    approach: {u: R.u + fu * 2.15, v: R.v + fv * 2.15, y: TURTLE.surfaceY, yaw: wrap(face + Math.PI)},
    // where the slide off the rock ends, a body-length out into the lake
    launch: {u: R.u + fu * 2.3, v: R.v + fv * 2.3, y: -.48, yaw: face},
    // open water on the rock's line, where it lines up before swimming in
    stage: {u: R.u + fu * 3.9, v: R.v + fv * 3.9},
  };
}

/**
 * lake: {depth(u, v) -> metres of water, centre: {u, v}, radius(u, v) -> 0 centre .. 1 rim}. seed: per cove.
 * Returns a brain with advanceTo(seconds, heroes) -> events and sample(seconds) -> interpolated state.
 */
export function createTurtleBrain({lake, seed = 1, anchors = coveAnchors()}) {
  const A = anchors, DT = TURTLE.step;
  let cur = null, prev = null, cycle = -1, plan = null, simT = -Infinity;
  const events = [];
  const visits = new Map(); // hero key -> time its last visit ended (cooldown)

  function newPlan(c) {
    const r = rng((Math.imul(c, 2654435761) ^ (seed * 7919)) >>> 0);
    return {r, baskEnd: range(r, TURTLE.baskFirst), nextBreath: 0};
  }
  function startCycle(c) {
    cycle = c; plan = newPlan(c);
    const b = A.bask;
    cur = {t: c * TURTLE.cycle, mode: 'bask', mt: 0, u: b.u, v: b.v, y: b.y, yaw: b.yaw, pitch: 0, roll: 0, speed: 0, vy: 0, turn: 0,
      phase: 0, amp: 0, glide: 1, bout: 0, surface: 0, crawl: 0, crawlPhase: 0, pivot: 0, bask: 1, hover: 0, headUp: 0,
      breathAt: -99, yawnAt: -99, from: null, wp: null, depthGoal: .6, look: null, visit: null};
    prev = {...cur};
  }
  const pick = () => { // a waypoint well inside the lake, not too near where it is now
    for (let i = 0; i < 24; i++) {
      const a = plan.r() * TAU, k = Math.sqrt(plan.r()) * .58;
      const u = lake.centre.u + Math.cos(a) * k * COVE.lake.ru, v = lake.centre.v + Math.sin(a) * k * COVE.lake.rv;
      if (lake.depth(u, v) > 1.0 && Math.hypot(u - cur.u, v - cur.v) > 2.2) return {u, v};
    }
    return {u: lake.centre.u, v: lake.centre.v};
  };
  function enter(mode) {
    cur.mode = mode; cur.mt = 0; cur.from = {u: cur.u, v: cur.v, y: cur.y, yaw: cur.yaw, pitch: cur.pitch};
    if (mode === 'swim') { cur.wp = pick(); cur.depthGoal = .45 + plan.r() * .5; if (!plan.nextBreath) plan.nextBreath = cur.t + range(plan.r, TURTLE.breatheEvery); }
    if (mode === 'surface') { cur.dur = range(plan.r, TURTLE.breatheFor); cur.breaths = 0; }
    if (mode === 'home') cur.lined = false;
  }
  function steer(target, dt, {speedGoal = TURTLE.cruise, depthGoal = cur.depthGoal, stroke = 1, turnMax = .75, avoid = true} = {}) {
    // heading toward the target, away from the shallows
    let du = target.u - cur.u, dv = target.v - cur.v;
    const ahead = 1.3, au = cur.u + Math.sin(cur.yaw) * ahead, av = cur.v + Math.cos(cur.yaw) * ahead;
    if (avoid && lake.depth(au, av) < .75) { du += (lake.centre.u - au) * 2.2; dv += (lake.centre.v - av) * 2.2; }
    const want = Math.atan2(du, dv), err = wrap(want - cur.yaw);
    const rate = clamp(err * 1.6, -turnMax, turnMax) * clamp(.35 + cur.speed / TURTLE.cruise, .35, 1.3);
    cur.turn += (rate - cur.turn) * (1 - Math.exp(-dt * 3));
    cur.yaw = wrap(cur.yaw + cur.turn * dt);
    // the stroke: bouts of two to four strokes, then a glide; thrust lands on the down-stroke
    const freq = .42 + .2 * clamp01(speedGoal / TURTLE.cruise - .6);
    if (cur.glide > .5) { cur.bout -= dt; if (cur.bout <= 0 && stroke > 0 && (cur.speed < speedGoal * .85 || Math.abs(err) > .9)) { cur.bout = (2 + Math.floor(plan.r() * 3)) / freq; cur.glide = 0; } }
    else { cur.bout -= dt; if (cur.bout <= 0 && cur.phase % TAU < .3) { cur.bout = 1.4 + plan.r() * 2; cur.glide = 1; } }
    const goalAmp = cur.glide > .5 ? 0 : stroke;
    cur.amp += (goalAmp - cur.amp) * (1 - Math.exp(-dt * 2.6));
    cur.phase += dt * TAU * freq * (.25 + .75 * cur.amp);
    const down = Math.max(0, Math.sin(cur.phase + .35 * (1 - Math.cos(cur.phase))));
    const thrust = cur.amp * down * 1.25 * speedGoal;
    cur.speed += (thrust - cur.speed * .62) * dt;
    cur.speed = Math.max(0, cur.speed);
    // depth: glide gently toward the goal, never into the bed
    const floor = -Math.max(.2, lake.depth(cur.u, cur.v) - .32);
    const yGoal = Math.max(floor, -depthGoal);
    cur.vy += ((yGoal - cur.y) * .9 - cur.vy) * (1 - Math.exp(-dt * 1.8));
    cur.y += cur.vy * dt;
    cur.u += Math.sin(cur.yaw) * cur.speed * dt; cur.v += Math.cos(cur.yaw) * cur.speed * dt;
    const pitchGoal = Math.atan2(cur.vy, Math.max(.25, cur.speed)) * .9;
    cur.pitch += (clamp(pitchGoal, -.55, .45) - cur.pitch) * (1 - Math.exp(-dt * 2.5));
    cur.roll += (clamp(-cur.turn * .55, -.4, .4) - cur.roll) * (1 - Math.exp(-dt * 2.5));
    return Math.hypot(target.u - cur.u, target.v - cur.v);
  }
  // keep it in the water whatever happens
  function contain() {
    const r = lake.radius(cur.u, cur.v);
    if (r > .74) { const k = .74 / r; cur.u = lake.centre.u + (cur.u - lake.centre.u) * k; cur.v = lake.centre.v + (cur.v - lake.centre.v) * k; }
  }
  function settle(rate, dt, goal = 0) { const f = 1 - Math.exp(-dt * rate); cur.amp += (goal - cur.amp) * f; cur.speed += (0 - cur.speed) * f; cur.turn += (0 - cur.turn) * f; cur.roll += (0 - cur.roll) * f; }
  function heroToVisit(heroes) {
    if (!heroes?.length) return null;
    let best = null;
    for (const h of heroes) {
      const r = lake.radius(h.u, h.v);
      const beyond = (r - 1) * Math.min(COVE.lake.ru, COVE.lake.rv);
      if (beyond > TURTLE.visitReach || r < .8) continue;
      const cool = visits.get(h.key);
      if (cool !== undefined && cur.t - cool < TURTLE.visitCooldown) continue;
      const d = Math.hypot(h.u - cur.u, h.v - cur.v);
      if (!best || d < best.d) best = {...h, d};
    }
    return best;
  }
  function visitSpot(h) { // a point in water ~0.75 m deep on the line from the lake's centre to the hero
    const du = h.u - lake.centre.u, dv = h.v - lake.centre.v, len = Math.hypot(du, dv) || 1;
    let k = 0;
    for (let s = 0; s < 12; s += .1) { if (lake.depth(lake.centre.u + du / len * s, lake.centre.v + dv / len * s) < .78) break; k = s; }
    return {u: lake.centre.u + du / len * k, v: lake.centre.v + dv / len * k};
  }

  function step(heroes, live) {
    const dt = DT, c = cur, ct = c.t - cycle * TURTLE.cycle;
    c.t += dt; c.mt += dt;
    // continuous little life signs, all deterministic
    if (c.mode === 'bask') {
      c.bask += (1 - c.bask) * (1 - Math.exp(-dt * 1.5)); c.crawl *= Math.exp(-dt * 3); c.pivot *= Math.exp(-dt * 3); c.surface *= Math.exp(-dt * 2);
      const b = A.bask, f = 1 - Math.exp(-dt * 4);
      c.u += (b.u - c.u) * f; c.v += (b.v - c.v) * f; c.y += (b.y - c.y) * f; c.yaw = lerpAngle(c.yaw, b.yaw, f); c.pitch *= 1 - f;
      settle(3, dt); c.glide = 1;
      if (c.yawnAt < c.t - 20 && plan.r() < dt / 25) { c.yawnAt = c.t; if (live) events.push({kind: 'yawn', t: c.t}); }
      if (ct < TURTLE.homeAt && c.mt > 2 && ct >= plan.baskEnd) enter('slide');
    } else if (c.mode === 'slide') {
      const k = c.mt / TURTLE.slideTime, f = c.from, L = A.launch;
      // three lunges forward and down off the rock's lip, then a splash and a glide away under the water
      c.crawlPhase = clamp01(k * 1.15) * 3; c.crawl = 1 - smooth((k - .78) / .22); c.bask *= Math.exp(-dt * 3);
      const along = smooth(k) * .75 + .25 * smooth((k - .55) / .45);
      c.u = lerp(f.u, L.u, along); c.v = lerp(f.v, L.v, along);
      const drop = smooth((k - .35) / .55);
      c.y = lerp(f.y, L.y, drop) + .035 * Math.sin(Math.PI * (c.crawlPhase % 1)) * (1 - drop);
      c.yaw = lerpAngle(f.yaw, L.yaw, smooth(k));
      c.pitch = -.42 * Math.sin(Math.PI * clamp01((k - .3) / .6)); c.speed = .35 * smooth((k - .6) / .4);
      if (live && Math.abs(c.mt - TURTLE.slideTime * .68) < dt / 2) events.push({kind: 'splash', t: c.t, big: true});
      if (k >= 1) { c.crawl = 0; c.amp = .8; c.glide = 0; c.bout = 2 / .5; c.speed = .4; enter('swim'); }
    } else if (c.mode === 'swim') {
      c.bask *= Math.exp(-dt * 4); c.crawl = 0; c.hover *= Math.exp(-dt * 2); c.headUp *= Math.exp(-dt * 2);
      c.surface += (0 - c.surface) * (1 - Math.exp(-dt * 1.5));
      if (steer(c.wp, dt) < .9) { c.wp = pick(); c.depthGoal = .45 + plan.r() * .5; }
      contain();
      const v = ct < TURTLE.homeAt - 6 ? heroToVisit(heroes) : null;
      if (v && live) { c.visit = {key: v.key, u: v.u, v: v.v, since: c.t}; enter('visit'); }
      else if (ct >= TURTLE.homeAt) enter('home');
      else if (c.t >= plan.nextBreath) enter('rise');
    } else if (c.mode === 'rise') {
      steer(c.wp, dt, {depthGoal: -TURTLE.surfaceY, speedGoal: .42}); contain();
      if (c.y > TURTLE.surfaceY - .1 || c.mt > 6) enter('surface');
    } else if (c.mode === 'surface' || c.mode === 'visit') {
      const visiting = c.mode === 'visit';
      let target = c.wp, near = false, look = null;
      if (visiting) {
        const h = heroes?.find(x => x.key === c.visit.key);
        if (h) { c.visit.u = h.u; c.visit.v = h.v; }
        target = visitSpot(c.visit); look = c.visit;
        near = Math.hypot(target.u - c.u, target.v - c.v) < .7;
        const gone = !h || lake.radius(h.u, h.v) > 1 + TURTLE.visitReach * 1.4 / Math.min(COVE.lake.ru, COVE.lake.rv);
        if (gone || c.t - c.visit.since > TURTLE.visitFor || ct >= TURTLE.homeAt) { visits.set(c.visit.key, c.t); c.visit = null; c.look = null; enter(ct >= TURTLE.homeAt ? 'home' : 'swim'); return; }
      }
      c.surface += (1 - c.surface) * (1 - Math.exp(-dt * 2));
      if (near || !visiting) {
        // hold position: hover at the surface, nose up, turn to face whatever it is looking at
        c.hover += (1 - c.hover) * (1 - Math.exp(-dt * 1.6));
        c.headUp += (1 - c.headUp) * (1 - Math.exp(-dt * 1.8));
        settle(1.6, dt, 0); c.glide = 1;
        if (look) { const want = Math.atan2(look.u - c.u, look.v - c.v); c.yaw = lerpAngle(c.yaw, want, 1 - Math.exp(-dt * .9)); }
        else { c.yaw = wrap(c.yaw + Math.sin(c.t * .23 + seed) * .05 * dt); c.u += Math.sin(c.yaw) * .05 * dt; c.v += Math.cos(c.yaw) * .05 * dt; }
        c.vy += ((TURTLE.surfaceY + .015 * Math.sin(c.t * 1.3) - c.y) * 1.2 - c.vy) * (1 - Math.exp(-dt * 2)); c.y += c.vy * dt;
        c.pitch += (-.1 - c.pitch) * (1 - Math.exp(-dt * 2));
        contain();
        // breaths: head lifts, a puff, then the mouth opens to drink in the air
        if (c.t - c.breathAt > (visiting ? 6.5 : 2.6) && c.mt > .8 && (visiting || c.breaths < 2)) { c.breathAt = c.t; c.breaths = (c.breaths || 0) + 1; if (live) events.push({kind: 'breath', t: c.t}); }
      } else {
        c.hover *= Math.exp(-dt * 2); c.headUp += (.6 - c.headUp) * (1 - Math.exp(-dt * 1.2));
        steer(target, dt, {depthGoal: -TURTLE.surfaceY - .05, speedGoal: .55}); contain();
      }
      if (look) c.look = {u: look.u, v: look.v};
      if (!visiting && c.mt >= c.dur && c.t - c.breathAt > 1.6) {
        plan.nextBreath = c.t + range(plan.r, TURTLE.breatheEvery); c.hover = 0;
        if (live) events.push({kind: 'dive', t: c.t});
        c.depthGoal = .7 + plan.r() * .3; c.glide = 0; c.amp = .3; c.bout = 3 / .5;
        enter('swim');
      }
    } else if (c.mode === 'home') {
      c.hover *= Math.exp(-dt * 2); c.headUp *= Math.exp(-dt * 2);
      // line up first: out in open water on the rock's line, then straight in to the rock
      const P = A.approach, S = A.stage;
      if (!c.lined && Math.hypot(S.u - c.u, S.v - c.v) < .8) c.lined = true;
      const goal = c.lined ? P : S, far = Math.hypot(P.u - c.u, P.v - c.v);
      const d0 = steer(goal, dt, {depthGoal: -TURTLE.surfaceY + .1, speedGoal: c.lined ? .38 : .8, turnMax: 1, avoid: !c.lined}); contain();
      const d = c.lined ? d0 : far;
      const aligned = Math.abs(wrap(c.yaw - P.yaw)) < .5;
      if ((d < .45 && aligned) || ct >= TURTLE.forceHaulAt) enter('haul');
      else if (d < 1.1) { c.yaw = lerpAngle(c.yaw, P.yaw, 1 - Math.exp(-dt * 1.2)); }
    } else if (c.mode === 'haul') {
      const k = c.mt / TURTLE.haulTime, f = c.from, B = A.bask;
      c.crawlPhase = clamp01(k) * 4; c.crawl = smooth(k * 5); c.surface *= Math.exp(-dt * 2); settle(4, dt); c.glide = 1;
      // each lunge carries it forward; between lunges it rests (so the path advances in steps)
      const lunge = l => Math.floor(l) + smooth((l % 1 - .3) / .5);
      const along = lunge(c.crawlPhase) / 4;
      c.u = lerp(f.u, B.u, along); c.v = lerp(f.v, B.v, along);
      c.y = lerp(f.y, B.y, smooth(along * 1.25)) + .04 * Math.sin(Math.PI * clamp01((c.crawlPhase % 1 - .3) / .5));
      c.yaw = lerpAngle(f.yaw, A.approach.yaw, smooth(k * 3));
      c.pitch = .32 * Math.sin(Math.PI * clamp01(along * 1.2)) - .05;
      if (live && Math.abs(c.mt - .5) < dt / 2) events.push({kind: 'splash', t: c.t, big: false});
      if (k >= 1) enter('turn');
    } else if (c.mode === 'turn') {
      const k = c.mt / TURTLE.turnTime, f = c.from, B = A.bask;
      // four shuffles round to face the lake again
      const steps = 4, l = clamp01(k) * steps, s = Math.floor(l) + smooth((l % 1 - .25) / .55);
      c.crawlPhase = l; c.crawl = 1 - smooth((k - .85) / .15); c.pivot = Math.sign(wrap(B.yaw - f.yaw)) || 1;
      c.yaw = lerpAngle(f.yaw, B.yaw, s / steps);
      c.u = lerp(f.u, B.u, smooth(k)); c.v = lerp(f.v, B.v, smooth(k)); c.y = B.y + .025 * Math.sin(Math.PI * clamp01((l % 1 - .25) / .55));
      c.pitch *= Math.exp(-dt * 3);
      if (k >= 1) { c.crawl = 0; c.pivot = 0; enter('bask'); c.mt = 3; }
    }
    if (c.mode !== 'visit' && c.mode !== 'surface') c.look = null;
  }

  function resetTo(T) {
    const c = Math.floor(T / TURTLE.cycle);
    startCycle(c); simT = c * TURTLE.cycle;
  }
  return {
    /** Run the brain up to world time T (seconds). heroes: [{key, u, v}] in this cove's corner space. */
    advanceTo(T, heroes) {
      events.length = 0;
      if (!Number.isFinite(T)) return events;
      const c = Math.floor(T / TURTLE.cycle);
      const live = c === cycle && T >= simT && T - simT < 2;
      if (c !== cycle || T < simT - DT || T - simT > 30) resetTo(T); // a new day, a rewind or a long gap: replay from the cycle's start
      let n = 0;
      while (simT + DT <= T && n++ < 6000) { prev = {...cur}; step(heroes, live); simT += DT; }
      return events;
    },
    /** Interpolated state at T (call after advanceTo(T)). */
    sample(T) {
      const k = clamp01((T - (simT - DT)) / DT), a = prev, b = cur, o = {...b};
      if (!a) return o;
      for (const key of ['u', 'v', 'y', 'pitch', 'roll', 'speed', 'vy', 'turn', 'phase', 'amp', 'glide', 'surface', 'crawl', 'crawlPhase', 'bask', 'hover', 'headUp'])
        if (typeof a[key] === 'number' && typeof b[key] === 'number' && Math.abs(b[key] - a[key]) < 2) o[key] = lerp(a[key], b[key], k);
      o.yaw = lerpAngle(a.yaw, b.yaw, k);
      o.t = lerp(a.t, b.t, k);
      return o;
    },
    state: () => cur,
    cycleTime: T => T - Math.floor(T / TURTLE.cycle) * TURTLE.cycle,
  };
}

// ------------------------------------------------------------------------------------------------ the pose
// Bone angles are radians about the turtle's own axes (x pitch, nose-down positive; y yaw, to its left; z roll, left
// side up), as client/larimar-turtle-art.js applies them. Left bones mirror to the right by flipping y and z.
const POSE = {
  glide: {F1: [0, .75, -.05], F2: [0, .35, 0], F3: [0, .2, 0], B1: [0, .3, 0], B2: [0, .1, 0]},
  bask: {F1: [.05, .5, -.16], F2: [0, .25, -.08], F3: [0, .12, -.05], B1: [0, .35, -.05], B2: [0, .1, 0]},
};
const add3 = (o, k, x, y, z) => { const a = o[k] || (o[k] = [0, 0, 0]); a[0] += x; a[1] += y; a[2] += z; };
/**
 * Pose for one frame. s: brain.sample(T). t: seconds (continuous). look: {u, v, y?} in corner space, or null.
 * mem: per-turtle scratch object (blink and look smoothing; pass the same object every frame). dt: frame seconds.
 * Returns {root: {u, v, y, yaw, pitch, roll}, bones: {name: [x, y, z]}, lids, jaw, glow, puff}.
 */
export function turtlePose(s, t, {look = null, mem = {}, dt = 1 / 60, seed = 1} = {}) {
  const B = {};
  const amp = s.amp * (1 - s.crawl) * (1 - s.bask), glide = clamp01(s.glide) * (1 - s.crawl) * (1 - s.bask);
  const hover = s.hover * (1 - s.crawl), crawl = s.crawl, bask = s.bask * (1 - crawl);
  const x = s.phase + .35 * (1 - Math.cos(s.phase));   // a quicker power stroke, slower recovery
  const cx = Math.cos(x), sx = Math.sin(x);
  // ---- front flippers: flight stroke, glide tuck, hover scull, crawl push, bask rest
  const scullT = t * 1.05;
  for (const [sg, side] of [[1, 'L'], [-1, 'R']]) {
    const f1 = [0, 0, 0], f2 = [0, 0, 0], f3 = [0, 0, 0];
    const mixIn = (arr, src, w) => { arr[0] += src[0] * w; arr[1] += src[1] * w; arr[2] += src[2] * w; };
    const swimW = 1 - crawl - bask;
    // swimming: amp drives the stroke, glide blends toward the tucked pose
    const strokeW = swimW * (1 - glide * (1 - amp)) * (1 - hover);
    mixIn(f1, [.42 * sx * amp, (.16 - .3 * Math.cos(x - .5)) * amp, (.5 * cx + .06) * amp], strokeW);
    mixIn(f2, [.16 * Math.sin(x - .4) * amp, .05 * amp, .22 * Math.cos(x - .6) * amp], strokeW);
    mixIn(f3, [.22 * Math.sin(x - .8) * amp, .08 * Math.sin(x) * amp, .2 * Math.cos(x - 1.1) * amp], strokeW);
    const tuck = swimW * glide * (1 - amp) * (1 - hover);
    mixIn(f1, POSE.glide.F1, tuck); mixIn(f2, POSE.glide.F2, tuck); mixIn(f3, POSE.glide.F3, tuck);
    // hovering at the surface: slow sculls, the two sides a little out of step
    const sp = scullT + (sg > 0 ? 0 : 1.9);
    mixIn(f1, [.28 * Math.sin(sp + .5), .28 + .14 * Math.sin(sp), .1 + .1 * Math.cos(sp)], swimW * hover);
    mixIn(f2, [.12 * Math.sin(sp), .1, .06 * Math.cos(sp - .5)], swimW * hover);
    mixIn(f3, [.18 * Math.sin(sp - .6), .06, .06 * Math.cos(sp - 1)], swimW * hover);
    // crawling: both front flippers reach forward, plant and push the body on (the butterfly crawl)
    if (crawl > 0) {
      const cp = s.crawlPhase % 1, pivotInner = s.pivot * sg < 0 ? .45 : 1;
      const reach = smooth(cp / .3) * (1 - smooth((cp - .3) / .5)), push = smooth((cp - .3) / .5), lift = Math.sin(Math.PI * clamp01((cp - .78) / .22));
      const yawA = lerp(-.38, .62, push) * (cp > .78 ? 1 - smooth((cp - .78) / .22) : 1) + (cp > .78 ? -.38 * smooth((cp - .78) / .22) : 0);
      mixIn(f1, [.1, yawA * pivotInner, -.22 + .2 * reach + .3 * lift - .12 * push], crawl);
      mixIn(f2, [0, .15 * push, -.15 * push + .1 * lift], crawl);
      mixIn(f3, [-.12 * push, .1, -.1 + .15 * lift], crawl);
    }
    mixIn(f1, POSE.bask.F1, bask); mixIn(f2, POSE.bask.F2, bask); mixIn(f3, POSE.bask.F3, bask);
    // an idle twitch now and then while basking (deterministic per side)
    const tw = Math.max(0, Math.sin(t * .31 + sg * 1.7 + seed)) ** 24 * bask;
    f1[2] += .14 * tw; f2[2] += .1 * tw;
    for (const [n, a] of [['FinF1', f1], ['FinF2', f2], ['FinF3', f3]]) B[n + side] = [a[0], a[1] * sg, a[2] * sg];
    // ---- rear flippers: rudders that steer, paddles while hovering, pushers on land, a long stretch while basking
    const b1 = [0, 0, 0], b2 = [0, 0, 0];
    const rud = clamp(-s.turn * .9 * sg, -.45, .45);
    mixIn(b1, [.05 * Math.cos(x - 2) * amp, .28 + rud + .04 * glide, .08 * Math.cos(x - 2.2) * amp], swimW * (1 - hover));
    mixIn(b2, [.12 * Math.sin(x - 2.6) * amp, .1 + .5 * rud, 0], swimW * (1 - hover));
    const pp = t * 1.9 + (sg > 0 ? 0 : Math.PI);
    mixIn(b1, [.15 * Math.sin(pp), .3 + .28 * Math.sin(pp), .12 * Math.sin(pp + 1)], swimW * hover);
    mixIn(b2, [.25 * Math.sin(pp - .7), .15, 0], swimW * hover);
    if (crawl > 0) { const cp = s.crawlPhase % 1; mixIn(b1, [0, .3 + .25 * smooth((cp - .35) / .4), -.1], crawl); mixIn(b2, [.1, .1, 0], crawl); }
    // basking: one back flipper stretched right out behind (the left), the other tucked; they swap every few cycles
    const stretchLeft = Math.floor((t + seed * 37) / 47) % 2 === 0;
    const stretch = (sg > 0) === stretchLeft;
    mixIn(b1, stretch ? [0, .95, -.06] : POSE.bask.B1, bask); mixIn(b2, stretch ? [-.05, .32, 0] : POSE.bask.B2, bask);
    // a lazy toe-curl of the stretched flipper
    if (stretch) b2[0] += .18 * Math.max(0, Math.sin(t * .4 + seed)) ** 8 * bask;
    B['FinB1' + side] = [b1[0], b1[1] * sg, b1[2] * sg]; B['FinB2' + side] = [b2[0], b2[1] * sg, b2[2] * sg];
  }
  // ---- body: pitch and heave with the stroke, breathing heave while basking
  const bodyPitch = .05 * Math.sin(x - .8) * amp, breatheBody = .012 * Math.sin(t * 1.25) * bask;
  B.Body = [bodyPitch + (crawl ? -.06 * Math.sin(Math.PI * clamp01(((s.crawlPhase % 1) - .3) / .5)) * crawl : 0), 0, .03 * Math.sin(t * .7) * hover];
  // ---- head and neck: counter the body, lead the turns, look at what interests it, breathe, yawn
  mem.look ??= {yaw: 0, pitch: 0}; mem.blink ??= {next: t + 2, at: -9}; mem.eyes ??= {yaw: 0, pitch: 0};
  let lookYaw = .12 * Math.sin(t * .37 + seed) * (1 - hover) + .5 * clamp(s.turn, -.8, .8), lookPitch = .05 * Math.sin(t * .51 + seed * 2);
  // basking look-arounds: every so often it lifts its head and has a slow look about
  const about = Math.max(0, Math.sin(t * .19 + seed * 3)) ** 3 * bask;
  lookYaw += .55 * Math.sin(t * .27 + seed) * about; lookPitch -= .18 * about;
  if (look) {
    const dx = look.u - s.u, dz = look.v - s.v, want = wrap(Math.atan2(dx, dz) - s.yaw), dist = Math.hypot(dx, dz);
    lookYaw = clamp(want, -1.0, 1.0); lookPitch = -clamp(Math.atan2((look.y ?? 1.6) - s.y, Math.max(dist, .5)) * .8, -.2, .75);
  }
  const lf = 1 - Math.exp(-dt * (look ? 3 : 1.6));
  mem.look.yaw += (lookYaw - mem.look.yaw) * lf; mem.look.pitch += (lookPitch - mem.look.pitch) * lf;
  // breath: rise .35 s, a puff at .25 s, jaw open from .5 to 1.3 s, back down by 2 s
  const bt = t - (s.breathAt ?? -99), breathUp = smooth(bt / .35) * (1 - smooth((bt - 1.4) / .6));
  const jawBreath = smooth((bt - .45) / .2) * (1 - smooth((bt - 1.15) / .25));
  const yt = t - (s.yawnAt ?? -99), yawn = smooth((yt - .3) / .6) * (1 - smooth((yt - 1.9) / .7));
  const up = clamp01(s.headUp) * (1 - crawl) + breathUp * .8;
  const hello = look ? .06 * Math.sin(t * 2.1) * Math.max(0, Math.sin(t * .45)) ** 6 : 0; // a little nod now and then
  const restDown = bask * (.16 - .2 * about);
  B.Neck = [-.55 * bodyPitch - .3 * up + restDown + .5 * mem.look.pitch * .5 - .12 * yawn, mem.look.yaw * .45, 0];
  B.Head = [-.35 * bodyPitch - .2 * up + .5 * restDown + mem.look.pitch * .5 + hello - .2 * yawn
    + (crawl ? -.18 * Math.sin(Math.PI * clamp01(((s.crawlPhase % 1) - .3) / .5)) * crawl : 0),
    mem.look.yaw * .55, (look ? .14 * Math.sin(t * .6) : .04 * Math.sin(t * .29 + seed)) * (1 - crawl)];
  const jaw = clamp01(.34 * jawBreath + .5 * yawn + .02 * bask * Math.max(0, Math.sin(t * .9)) ** 10);
  B.Jaw = [jaw, 0, 0];
  B.Tail = [.05 * Math.sin(x - 2.4) * amp, clamp(-s.turn * .6, -.5, .5) + .06 * Math.sin(t * .8) * (1 - bask), 0];
  // ---- eyes lead the head toward a look target; blinks (slower and heavier while basking)
  const eyeYaw = clamp((look ? lookYaw : lookYaw * .5) - mem.look.yaw * .55 - mem.look.yaw * .45, -.4, .4);
  mem.eyes.yaw += (eyeYaw - mem.eyes.yaw) * (1 - Math.exp(-dt * 8));
  if (t >= mem.blink.next) { mem.blink.at = t; mem.blink.next = t + 2.5 + 4.5 * ((Math.sin(t * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1; }
  const bk = t - mem.blink.at, slow = 1 + 1.4 * bask;
  const blink = bk < .09 * slow ? smooth(bk / (.09 * slow)) : 1 - smooth((bk - .09 * slow) / (.17 * slow));
  const sleepy = .32 * bask * (1 - about) + .2 * yawn;
  const lids = clamp01(Math.max(blink * (bk < .5 * slow ? 1 : 0), sleepy) - .15 * up);
  for (const side of ['L', 'R']) B['Eye' + side] = [0, mem.eyes.yaw, 0];
  // ---- root: in corner space; the body heaves on the down-stroke and with the crawl
  const heave = .02 * Math.cos(x - .4) * amp + breatheBody;
  return {root: {u: s.u, v: s.v, y: s.y + heave, yaw: s.yaw, pitch: s.pitch, roll: s.roll}, bones: B, lids, jaw,
    puff: bt >= .2 && bt < .3 ? 1 : 0, breath: breathUp};
}
