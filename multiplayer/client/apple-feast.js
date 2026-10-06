import * as T from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {SIEGEBIRD_PLUMAGES, SIEGEBIRD_BIRD_SCALE, SIEGEBIRD_ROOST, paletteTexture} from './siegebird-flock.js';

// The apple core's last moments: it drops from the hand, rolls to rest on its side, and a few songbirds swoop in,
// land round it, hop and peck it to nothing (it shrinks with every peck, crumbs fly) and fly off again.
// Pure presentation on the presentation clock: the shared simulation has already finished the snack. Every
// client plays it where the core fell (the eater from the hand, everyone else from the snack_done position).
// Birds reuse the Siegebird songbird mesh (assets/siegebird_songbird.glb) and its plumage palettes.

export const APPLE_FEAST = Object.freeze({
 birds: [2, 4],            // how many come (inclusive range)
 wait: .55,                // s after the core settles before the first bird arrives
 stagger: .3,              // s between arrivals
 fly: 1.25,                // s of the swoop in
 from: [6, 9], above: [2.6, 4.2], // where the birds come from: metres out and up
 ring: [.15, .23],         // landing distance round the core (m)
 feast: 2.9,               // s the core lasts once the first bird lands
 leave: 1.9,               // s of the take-off flight before the bird is gone
 pecks: [.32, .7],         // s between a bird's pecks or hops
 gravity: 9.8,
});
const F = APPLE_FEAST;
const UP = new T.Vector3(0, 1, 0);
const hash = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const seeded = seed => { let a = seed >>> 0 || 1; return () => { a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) >>> 0; a = (a + 0x6d2b79f5) >>> 0; return (a >>> 8)/16777216; }; };
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
const clamp01 = t => Math.max(0, Math.min(1, t));
function bezier(p, u, out) { const a = 1 - u; return out.set(0, 0, 0).addScaledVector(p[0], a*a*a).addScaledVector(p[1], 3*a*a*u).addScaledVector(p[2], 3*a*u*u).addScaledVector(p[3], u*u*u); }
function bezierTangent(p, u, out) { const a = 1 - u; return out.set(0, 0, 0).addScaledVector(p[0], -3*a*a).addScaledVector(p[1], 3*a*a - 6*a*u).addScaledVector(p[2], 6*a*u - 3*u*u).addScaledVector(p[3], 3*u*u); }

/** group: scene node for the cores and birds. birdTemplate(): the songbird glTF or null (then the core simply
 *  crumbles away). height(x, z): ground. effects: {crumbs(at, dir, n, size), sounds: {chirp, peck, flutter, thud}}. */
export function createAppleFeast({group, birdTemplate = () => null, height, effects = {}}) {
 const feasts = [], pool = [], materials = [];
 const tmp = {f: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(), back: new T.Vector3(), m: new T.Matrix4(), q: new T.Quaternion(), qr: new T.Quaternion(), v: new T.Vector3(), w: new T.Vector3()};
 const fx = {crumbs: () => {}, ...effects}, sound = name => (...a) => fx.sounds?.[name]?.(...a);

 function plumage(i) {
  if (!materials[i]) materials[i] = new T.MeshStandardMaterial({name: `AppleFeastBird_${SIEGEBIRD_PLUMAGES[i].id}`, map: paletteTexture(SIEGEBIRD_PLUMAGES[i].palette), roughness: .62, metalness: 0});
  return materials[i];
 }
 function takeBird(template) {
  const b = pool.pop(); if (b) return b;
  const root = clone(template.scene); root.name = 'AppleFeastBird'; root.scale.setScalar(SIEGEBIRD_BIRD_SCALE*1.15);
  const meshes = []; root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; n.userData.ignoreContact = true; meshes.push(n); } });
  return {root, meshes, wings: ['SongbirdWingL', 'SongbirdWingR', 'SongbirdWingL_Tip', 'SongbirdWingR_Tip'].map(n => root.getObjectByName(n))};
 }

 // Orient a bird: forward f (world, any length), pitch (nose up +), roll about forward; origin is the feet.
 function orient(bird, f, pitch, roll) {
  const {right, up, back, m, q, qr} = tmp, d = tmp.f.copy(f); d.y *= .6; if (d.lengthSq() < 1e-8) d.set(0, 0, -1); d.normalize();
  right.crossVectors(d, UP); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
  d.applyAxisAngle(right, pitch).normalize(); up.crossVectors(right, d).normalize(); back.copy(d).negate();
  m.makeBasis(right, up, back); q.setFromRotationMatrix(m); qr.setFromAxisAngle(d, roll); bird.root.quaternion.multiplyQuaternions(qr, q);
 }
 function flap(bird, time, rate, amp, dihedral, hover) {
  const phase = time*rate*Math.PI*2, beat = Math.sin(phase + .35*Math.sin(phase)), angle = dihedral + amp*.62*beat, tip = .55*amp*Math.sin(phase - 1.1), sweep = hover*.45*Math.cos(phase);
  const [wl, wr, tl, tr] = bird.wings;
  wr?.rotation.set(0, -sweep, angle); wl?.rotation.set(0, sweep, -angle); tr?.rotation.set(0, -sweep*.4, tip); tl?.rotation.set(0, sweep*.4, -tip);
 }
 function fold(bird, open = 0) { // wings swept back along the flanks; open half-spreads them for a hop
  const R = SIEGEBIRD_ROOST, [wl, wr, tl, tr] = bird.wings, k = 1 - .45*open, o = .5*open;
  wr?.rotation.set(0, -R.foldSweep*k, R.foldAngle*k + o); wl?.rotation.set(0, R.foldSweep*k, -(R.foldAngle*k + o));
  tr?.rotation.set(0, -R.foldTipYaw*k, R.foldTip*k); tl?.rotation.set(0, R.foldTipYaw*k, -R.foldTip*k);
 }

 /** The core leaves the hand. core: an apple root (already in `group`), position: its world position,
  *  velocity: initial world velocity, radius: the core's resting radius. key seeds the birds (same on every client). */
 function drop(core, {position, velocity = [0, 0, 0], radius = .035, key = 'core', spin = [6, 2, 4]} = {}) {
  const rand = seeded(hash(key)), base = core.scale.x;
  core.position.copy(position);
  const yaw = rand()*Math.PI*2, rest = new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2*(rand() < .5 ? 1 : -1), yaw, (rand() - .5)*.5, 'YXZ'));
  const count = F.birds[0] + Math.floor(rand()*(F.birds[1] - F.birds[0] + 1)), taken = new Set();
  const birds = Array.from({length: count}, (_, i) => {
   let p = Math.floor(rand()*SIEGEBIRD_PLUMAGES.length); while (taken.has(p) && taken.size < SIEGEBIRD_PLUMAGES.length) p = (p + 1) % SIEGEBIRD_PLUMAGES.length; taken.add(p);
   const around = (i + rand()*.6)/count*Math.PI*2 + rand()*.4;
   return {plumage: p, arrive: i*F.stagger*(.75 + rand()*.5), from: rand()*Math.PI*2, out: F.from[0] + rand()*(F.from[1] - F.from[0]), up: F.above[0] + rand()*(F.above[1] - F.above[0]),
    around, ring: F.ring[0] + rand()*(F.ring[1] - F.ring[0]), next: .15 + rand()*.3, peck: -1, hop: null, leaveAt: F.feast + .1 + rand()*.45, away: rand()*Math.PI*2, side: rand() < .5 ? -1 : 1,
    rand: seeded(hash(key + ':' + i)), bird: null, phase: 'wait', phaseAt: 0};
  });
  const f = {core, base, radius, v: new T.Vector3(...velocity), spin: new T.Vector3(...spin), rest, mode: 'fall', t: 0, settled: -1, eaten: 0, birds, gone: false, bounces: 0};
  feasts.push(f); return f;
 }

 function stepCore(f, dt) {
  const c = f.core, g = height(c.position.x, c.position.z);
  if (f.mode === 'fall') {
   f.v.y -= F.gravity*dt; c.position.addScaledVector(f.v, dt);
   c.rotation.x += f.spin.x*dt; c.rotation.y += f.spin.y*dt; c.rotation.z += f.spin.z*dt;
   if (c.position.y < g + f.radius) {
    c.position.y = g + f.radius; const hit = Math.abs(f.v.y);
    if (hit > .9 && f.bounces < 2) { f.bounces++; f.v.set(f.v.x*.45, hit*.28, f.v.z*.45); f.spin.multiplyScalar(.45); sound('thud')(c.position, hit); fx.crumbs(c.position.clone(), new T.Vector3(0, 1, 0), 3, .5); }
    else { f.mode = 'roll'; f.v.y = 0; f.settled = f.t; sound('thud')(c.position, hit*.6); }
   }
  } else { // a short roll onto its side, then still
   const k = 1 - Math.exp(-dt*7); c.quaternion.slerp(f.rest, k); f.v.multiplyScalar(Math.exp(-dt*5)); c.position.x += f.v.x*dt; c.position.z += f.v.z*dt;
   c.position.y += (height(c.position.x, c.position.z) + f.radius*.82 - c.position.y)*k;
  }
  f.t += dt;
 }

 function stepBird(f, b, dt, now, template) {
  const c = f.core.position, since = f.t - f.settled - F.wait - b.arrive;
  if (since < 0 || !template || b.phase === 'gone') return;
  if (!b.bird) { b.bird = takeBird(template); for (const m of b.bird.meshes) m.material = plumage(b.plumage); group.add(b.bird.root); b.phase = 'in'; b.phaseAt = since; sound('chirp')(c, 1); }
  const bird = b.bird, land = tmp.v.set(c.x + Math.cos(b.around)*b.ring, 0, c.z + Math.sin(b.around)*b.ring); land.y = height(land.x, land.z);
  const toCore = tmp.w.set(c.x - land.x, 0, c.z - land.z);
  bird.root.visible = true;
  if (b.phase === 'in') {
   const u = clamp01((since - b.phaseAt)/F.fly), e = 1 - Math.pow(1 - u, 2.4);
   const start = new T.Vector3(c.x + Math.cos(b.from)*b.out, land.y + b.up, c.z + Math.sin(b.from)*b.out);
   const p = b.path ||= [start, start.clone().lerp(land, .45).setY(land.y + b.up*.75), land.clone().add(toCore.clone().normalize().multiplyScalar(-.5)).setY(land.y + .45), land.clone()];
   bezier(p, e, bird.root.position); const dir = bezierTangent(p, Math.min(.98, e), new T.Vector3());
   const flare = clamp01((u - .72)/.28), glide = u > .3 && u < .6 ? Math.sin(Math.PI*(u - .3)/.3) : 0;
   dir.lerp(toCore, flare*.9); orient(bird, dir, .12 + flare*.7, b.side*.5*Math.sin(Math.PI*Math.min(1, u*1.2))*(1 - flare));
   flap(bird, now, 10 + flare*5, .95*(1 - .8*glide), .12 + .2*glide, flare);
   if (u >= 1) { b.phase = 'eat'; b.phaseAt = since; b.next = .12 + b.rand()*.25; sound('flutter')(c, .6); }
  } else if (b.phase === 'eat') {
   const local = since - b.phaseAt, base = land, look = toCore;
   let pitch = -.08, lift = 0, open = 0, sideStep = 0;
   if (local >= b.next) { // choose the next beat: mostly pecks, sometimes a hop round the core
    if (b.rand() < .78 && f.eaten < 1) { b.peck = local; if (f.core.visible) { f.eaten = Math.min(1, f.eaten + .085); fx.crumbs(c.clone().add(look.clone().normalize().multiplyScalar(-.02)), new T.Vector3(-look.x, 1.4, -look.z).normalize(), 2, .35); sound('peck')(c, .7 + b.rand()*.3); } }
    else { b.hop = {at: local, from: b.around, to: b.around + (b.rand() - .5)*1.1}; if (b.rand() < .4) sound('chirp')(c, .55); }
    b.next = local + F.pecks[0] + b.rand()*(F.pecks[1] - F.pecks[0]);
   }
   if (b.peck >= 0 && local - b.peck < .24) { const k = (local - b.peck)/.24; pitch = -.08 - .85*(k < .3 ? k/.3 : 1 - (k - .3)/.7); } // stab down, ease back up
   if (b.hop) { const k = clamp01((local - b.hop.at)/.22); b.around = b.hop.from + (b.hop.to - b.hop.from)*ease(k); lift = .045*Math.sin(Math.PI*k); open = Math.sin(Math.PI*k); if (k >= 1) b.hop = null; }
   bird.root.position.set(base.x, height(base.x, base.z) + lift, base.z); orient(bird, look, pitch, sideStep);
   if (open > .05) flap(bird, now, 14, .5*open, .2, .6); else fold(bird, 0);
   if (f.t - f.settled - F.wait >= b.leaveAt || f.gone) { b.phase = 'out'; b.phaseAt = since; b.out0 = bird.root.position.clone(); if (b.rand() < .6) sound('chirp')(c, .8); sound('flutter')(c, .8); }
  } else if (b.phase === 'out') {
   const u = clamp01((since - b.phaseAt)/F.leave), e = Math.pow(u, 1.3), o = b.out0;
   const away = new T.Vector3(Math.cos(b.away), 0, Math.sin(b.away));
   const p = b.pathOut ||= [o.clone(), o.clone().add(new T.Vector3(0, .35, 0)).addScaledVector(away, .25), o.clone().add(new T.Vector3(0, 2.2, 0)).addScaledVector(away, 3), o.clone().add(new T.Vector3(0, 6, 0)).addScaledVector(away, 11)];
   bezier(p, e, bird.root.position); const dir = bezierTangent(p, Math.max(.02, e), new T.Vector3());
   orient(bird, dir, .25 + .3*Math.max(0, 1 - u*3), b.side*.45*Math.sin(Math.PI*Math.min(1, u*1.4)));
   flap(bird, now, 12, 1, .15, Math.max(0, 1 - u*4));
   if (u >= 1) { b.phase = 'gone'; bird.root.visible = false; bird.root.removeFromParent(); pool.push(bird); b.bird = null; }
  }
 }

 function update(dt, now = performance.now()/1000) {
  const template = birdTemplate();
  for (let i = feasts.length - 1; i >= 0; i--) {
   const f = feasts[i]; stepCore(f, dt);
   if (f.settled >= 0) {
    const since = f.t - f.settled - F.wait;
    if (!template) f.eaten = Math.min(1, f.eaten + dt*clamp01(since)/2.2); // no birds loaded: it simply crumbles away
    for (const b of f.birds) stepBird(f, b, dt, now, template);
    if (since > F.feast + .2) f.eaten = Math.min(1, f.eaten + dt*.6);
   }
   // the core wears down with every peck, then is gone in a last puff
   const s = f.base*(1 - .82*ease(clamp01(f.eaten)));
   f.core.scale.setScalar(f.core.scale.x + (s - f.core.scale.x)*(1 - Math.exp(-dt*14)));
   if (f.core.visible && f.eaten >= 1 && f.core.scale.x < f.base*.24) { f.core.visible = false; f.gone = true; fx.crumbs(f.core.position.clone(), new T.Vector3(0, 1, 0), 5, .45); }
   if (f.gone && f.birds.every(b => b.phase === 'gone' || (b.phase === 'wait' && !template))) { f.core.removeFromParent(); f.core.userData.dispose?.(); feasts.splice(i, 1); }
   else if (f.t > 30) { for (const b of f.birds) if (b.bird) { b.bird.root.removeFromParent(); pool.push(b.bird); } f.core.removeFromParent(); f.core.userData.dispose?.(); feasts.splice(i, 1); }
  }
 }

 return {drop, update, active: () => feasts.length, birds: () => feasts.reduce((n, f) => n + f.birds.filter(b => b.bird).length, 0),
  state: () => feasts.map(f => ({mode: f.mode, eaten: +f.eaten.toFixed(2), visible: f.core.visible, birds: f.birds.map(b => b.phase)})),
  dispose() { for (const f of feasts) { for (const b of f.birds) b.bird?.root.removeFromParent(); f.core.removeFromParent(); f.core.userData.dispose?.(); } feasts.length = 0; pool.length = 0; for (const m of materials) { m?.map?.dispose(); m?.dispose(); } }};
}
