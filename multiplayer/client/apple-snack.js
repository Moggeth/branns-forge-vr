// Apple on a stick, presentation (Opus 5.5, 2026-10-04). Authority and rules: shared/fruit.js.
//
// World: hanging apples that were shot are hidden on their tree (tree-fruit-mask.js) and swell back before they regrow;
// a pierced apple leaves its tree with a spray of juice, a few fluttering leaves and a woody thwock, rides its shaft
// down (extrapolated between snapshots, spinning about the shaft), and plants in the soil with a twang or settles.
// Hand: taking one raises it into view; each bite turns the next fresh face to you, lunges in, crunches (a scoop is
// carved at the contact frame, crumbs and juice fly, the view dips), tears away and chews, then turns the eaten side
// back to you so the apple visibly goes down bite by bite; three bites leave a core that drops to the ground, where a
// few songbirds swoop in, peck it to nothing and fly off (apple-feast.js). Desktop/touch ride the camera with the held-item sway; in VR it sits in the right hand and
// a bite happens when the apple reaches your mouth. Remote holders lift it to their face on each bite.
// Timberline: the wire's cut halves spring apart and tumble down showing their section (two bites each); a bolt that
// hits an apple bursts it in a spray of juice, skin and flesh chunks and seeds.
// Nothing here decides anything: the bite is sent on the contact frame and the host heals.
import * as T from 'three';
import {createSnackModel,createApple,setBites} from './apple-art.js';
import {prepareProjectile} from './asset-pose.js';
import {createFruitMask} from './tree-fruit-mask.js';
import {createAppleFeast} from './apple-feast.js';
import {FRUIT,STICKS,appleWorld,APPLE_SLOTS,bitesFor} from '../shared/fruit.js';
import {worldTrees} from '../shared/world-content.js';

export const SNACK_MOTION = Object.freeze({
 raise: .5, bite: 1.05, contact: .34, finish: .6, show: .5, linger: .12,
 idle: {position: [.1, -.085, -.38], tip: [-.5, .36, -.79]},     // camera space: apple centre and shaft direction (to the tip)
 near: {position: [.025, -.06, -.27], tip: [-.86, .2, -.47]},     // wind-up, the next face turning to you
 mouth: {position: [0, -.05, -.155], tip: [-.97, .12, -.2]},     // contact: the apple at your teeth
 tear: {position: [.045, -.08, -.25], tip: [-.85, .02, -.52]},     // pulled away as the chunk comes off
 dip: .03,                                                         // rad the head leans into the bite
 chew: {cycles: 3, amplitude: .0035},
 vrMouth: .15,                                                     // m from the headset that counts as a bite
});
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
const easeOut = t => 1 - Math.pow(1 - t, 3), easeIn = t => t*t*t;
const back = t => { const c = 1.6; return 1 + (c + 1)*Math.pow(t - 1, 3) + c*Math.pow(t - 1, 2); };
const clamp01 = t => Math.max(0, Math.min(1, t));
const hash = id => { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0); };
const FORWARD = new T.Vector3(0, 0, -1);
const v3 = (a = [0, 0, 0]) => new T.Vector3(...a);

export function createAppleSnack({scene, camera, templates, height, audio = () => null, listener = () => null, haptic = () => {}, send = () => {}, reducedMotion = false}) {
 const group = new T.Group(); group.name = 'AppleSnack'; scene.add(group);
 const mask = createFruitMask();
 const drops = new Map();            // id -> {data, model, from, at, spin, spinRate, wobble, landed}
 let snapshot = null, playerId = null, held = null, heldId = null;
 const tmpQ = new T.Quaternion(), tmpV = new T.Vector3(), tmpV2 = new T.Vector3(), tmpM = new T.Matrix4();

 // ---------------------------------------------------------------- particles (pooled, one draw call per kind)
 const crumbGeo = new T.IcosahedronGeometry(1, 0), dropGeo = new T.IcosahedronGeometry(1, 1), leafGeo = new T.PlaneGeometry(1, 1.6);
 const crumbMat = new T.MeshStandardMaterial({color: 0xd9c27e, roughness: .7}), juiceMat = new T.MeshStandardMaterial({color: 0xf3e6a8, roughness: .12, transparent: true, opacity: .8, depthWrite: false});
 const leafMat = new T.MeshStandardMaterial({color: 0x2f5a1e, roughness: .55, side: T.DoubleSide});
 const moteMat = new T.MeshBasicMaterial({color: 0xffe9a0, transparent: true, opacity: .9, blending: T.AdditiveBlending, depthWrite: false});
 function pool(geo, mat, n, name) { const m = new T.InstancedMesh(geo, mat, n); m.name = name; m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage); group.add(m); return {mesh: m, list: [], cap: n}; }
 const chunkMat = new T.MeshStandardMaterial({color: 0xffffff, roughness: .55});
 const chunkGeo = new T.DodecahedronGeometry(1, 0), chunks = pool(chunkGeo, chunkMat, 40, 'AppleChunks'); chunks.coloured = true; chunks.mesh.setColorAt(0, new T.Color()); chunks.mesh.instanceColor.setUsage(T.DynamicDrawUsage);
 const SKIN = new T.Color(.42, .03, .02), FLESH = new T.Color(.74, .55, .22), SEED = new T.Color(.16, .07, .025);
 const crumbs = pool(crumbGeo, crumbMat, 48, 'AppleCrumbs'), juice = pool(dropGeo, juiceMat, 64, 'AppleJuice'), leaves = pool(leafGeo, leafMat, 24, 'AppleLeaves'), motes = pool(dropGeo, moteMat, 24, 'HealMotes');
 let rng = 1; const rand = () => ((rng = Math.imul(rng ^ (rng >>> 15), 2246822507) ^ 0x9e3779b9) >>> 0)/4294967296;
 function emit(p, item) { if (p.list.length >= p.cap) p.list.shift(); p.list.push(item); }
 function stepPool(p, dt, fn) {
  let n = 0;
  for (let i = p.list.length - 1; i >= 0; i--) { const q = p.list[i]; q.age += dt; if (q.age >= q.life) { p.list.splice(i, 1); continue; } }
  for (const q of p.list) { fn(q, dt); tmpM.compose(q.p, q.q || tmpQ.identity(), tmpV.setScalar(q.s*(q.fade ? Math.min(1, (q.life - q.age)/.35) : 1))); if (q.sx) tmpM.scale(tmpV2.set(q.sx, 1, 1)); if (q.sv) tmpM.scale(q.sv); p.mesh.setMatrixAt(n++, tmpM); }
  p.mesh.count = n; if (n) p.mesh.instanceMatrix.needsUpdate = true;
  if (p.coloured && n) { let k = 0; for (const q of p.list) p.mesh.setColorAt(k++, q.color); p.mesh.instanceColor.needsUpdate = true; }
 }
 const gravity = (q, dt, g = 9.8, drag = .6) => { q.v.y -= g*dt; q.v.multiplyScalar(Math.exp(-drag*dt)); q.p.addScaledVector(q.v, dt);
  const floor = height(q.p.x, q.p.z); if (q.p.y < floor + q.s) { q.p.y = floor + q.s; q.v.set(q.v.x*.3, Math.abs(q.v.y)*.15, q.v.z*.3); if (q.spin) q.spin.multiplyScalar(.4); } };
 function crumbBurst(at, dir, n = 12, power = 1) {
  for (let i = 0; i < n; i++) { const v = v3([rand() - .5, rand()*.6 - .1, rand() - .5]).multiplyScalar(1.6*power).addScaledVector(dir, (.6 + rand())*power);
   emit(crumbs, {p: at.clone().add(v3([rand() - .5, rand() - .5, rand() - .5]).multiplyScalar(.02)), v, s: .0035 + rand()*.004, age: 0, life: 1.4 + rand()*1.2, fade: true,
    q: new T.Quaternion().setFromEuler(new T.Euler(rand()*6, rand()*6, rand()*6)), spin: v3([rand() - .5, rand() - .5, rand() - .5]).multiplyScalar(20)}); }
 }
 function juiceBurst(at, dir, n = 10, power = 1, size = 1) {
  for (let i = 0; i < n; i++) { const v = v3([rand() - .5, rand() - .3, rand() - .5]).multiplyScalar(1.2*power).addScaledVector(dir, (1 + rand()*1.5)*power);
   emit(juice, {p: at.clone(), v, s: (.002 + rand()*.0025)*size, age: 0, life: .45 + rand()*.4, fade: true, sx: 1.6}); }
 }
 function leafFlutter(at, n = 5) {
  for (let i = 0; i < n; i++) emit(leaves, {p: at.clone().add(v3([rand() - .5, rand()*.4, rand() - .5]).multiplyScalar(.7)), v: v3([rand() - .5, -.2, rand() - .5]), s: .035 + rand()*.02, age: 0, life: 3 + rand()*2, fade: true,
   q: new T.Quaternion().setFromEuler(new T.Euler(rand()*6, rand()*6, rand()*6)), phase: rand()*6, spin: v3([rand() - .5, rand() - .5, rand() - .5]).multiplyScalar(4)});
 }
 // A bolt bursts an apple: chunks of skin and flesh, seeds and a spray of juice fan out along the bolt's line.
 function appleBurst(at, dir, radius = .08) {
  for (let i = 0; i < 28; i++) { const skin = i%3 === 0, seed = i >= 25;
   const v = v3([rand() - .5, rand() - .3, rand() - .5]).multiplyScalar(4.5).addScaledVector(dir, 2 + rand()*5);
   // irregular pulp lumps; skin comes off as thin curled flakes, seeds as small dark drops
   const sv = seed ? v3([.6, 1, .6]) : skin ? v3([1, .22 + rand()*.15, .7 + rand()*.5]) : v3([.6 + rand()*.6, .5 + rand()*.5, .7 + rand()*.6]);
   emit(chunks, {p: at.clone().add(v3([rand() - .5, rand() - .5, rand() - .5]).multiplyScalar(radius)), v, s: seed ? .0045 : radius*(.1 + rand()*.16), sv, age: 0, life: 2.2 + rand()*1.6, fade: true,
    q: new T.Quaternion().setFromEuler(new T.Euler(rand()*6, rand()*6, rand()*6)), spin: v3([rand() - .5, rand() - .5, rand() - .5]).multiplyScalar(26), color: seed ? SEED : skin ? SKIN : FLESH}); }
  juiceBurst(at, dir, 22, 2.2, 2.2); juiceBurst(at, dir, 16, 1.2, 1); crumbBurst(at, dir, 16, 1.8);
 }
 function healMotes(at) {
  for (let i = 0; i < 9; i++) emit(motes, {p: at.clone().add(v3([(rand() - .5)*.32, (rand() - .7)*.12, (rand() - .5)*.12])), v: v3([(rand() - .5)*.06, .1 + rand()*.12, (rand() - .5)*.06]), s: .003 + rand()*.0035, age: -rand()*.25, life: 1.1 + rand()*.6, fade: true});
 }
 function stepParticles(dt) {
  stepPool(chunks, dt, (q, dt) => { gravity(q, dt, 9.8, .5); if (q.spin) q.q.multiply(tmpQ.setFromEuler(new T.Euler(q.spin.x*dt, q.spin.y*dt, q.spin.z*dt))); });
  stepPool(crumbs, dt, (q, dt) => { gravity(q, dt, 9.8, .4); if (q.spin) q.q.multiply(tmpQ.setFromEuler(new T.Euler(q.spin.x*dt, q.spin.y*dt, q.spin.z*dt))); });
  stepPool(juice, dt, (q, dt) => { gravity(q, dt, 9.8, .3); q.q = (q.q || new T.Quaternion()).setFromUnitVectors(new T.Vector3(1, 0, 0), tmpV.copy(q.v).normalize()); });
  stepPool(leaves, dt, (q, dt) => { // a leaf falls slowly, swinging side to side and turning over
   q.v.y = Math.max(q.v.y - 2*dt, -.55); const sway = Math.sin(q.age*3.2 + q.phase); q.p.x += (q.v.x + sway*.35)*dt; q.p.z += (q.v.z + Math.cos(q.age*2.7 + q.phase)*.25)*dt; q.p.y += q.v.y*dt;
   const floor = height(q.p.x, q.p.z) + .01; if (q.p.y < floor) { q.p.y = floor; q.v.set(0, 0, 0); } else q.q.multiply(tmpQ.setFromEuler(new T.Euler(q.spin.x*dt, q.spin.y*dt, q.spin.z*dt)));
  });
  stepPool(motes, dt, (q, dt) => { if (q.age < 0) return; q.p.addScaledVector(q.v, dt); q.v.y += .05*dt; });
 }

 // ---------------------------------------------------------------- sound: synthesized, distance-attenuated
 function gainAt(position, near = 1) { const l = listener()?.position; if (!l || !position) return near; return near*Math.max(0, 1 - Math.hypot(position[0] - l[0], position[1] - l[1], position[2] - l[2])/28); }
 let noiseBuffer = null;
 function noise(ctx) { if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer; noiseBuffer = ctx.createBuffer(1, ctx.sampleRate*.6, ctx.sampleRate); const d = noiseBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; return noiseBuffer; }
 function burst(ctx, at, {type = 'bandpass', freq = 2000, q = 1, gain = .2, attack = .002, decay = .08, offset = 0, rate = 1}) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = noise(ctx); src.playbackRate.value = rate;
  f.type = type; f.frequency.value = freq; f.Q.value = q; const t = at + offset;
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + attack + decay);
  src.connect(f).connect(g).connect(ctx.destination); src.start(t, Math.random()*.3); src.stop(t + attack + decay + .05); src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
 }
 function tone(ctx, at, {from = 160, to = 70, gain = .12, decay = .12, type = 'sine', offset = 0}) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = at + offset; o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + decay);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + .004); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + decay + .05); o.onended = () => { o.disconnect(); g.disconnect(); };
 }
 const sounds = {
  // a crisp fracture: a cluster of bright cracks over a juicy, wet body
  crunch(level = 1, soft = false) { const ctx = audio(); if (!ctx || level < .01) return; const t = ctx.currentTime;
   const cracks = soft ? 2 : 5 + Math.floor(Math.random()*3);
   for (let i = 0; i < cracks; i++) burst(ctx, t, {freq: 2400 + Math.random()*3200, q: 1.4, gain: (soft ? .05 : .2)*level*(1 - i*.08), decay: .018 + Math.random()*.02, offset: i*(.008 + Math.random()*.012)});
   burst(ctx, t, {type: 'lowpass', freq: soft ? 900 : 1500, q: .7, gain: (soft ? .06 : .14)*level, attack: .006, decay: soft ? .09 : .16, rate: .7});
   if (!soft) burst(ctx, t, {freq: 700, q: 3, gain: .07*level, attack: .01, decay: .12, offset: .03, rate: .5}); // the wet squelch
  },
  pierce(position) { const ctx = audio(), k = gainAt(position); if (!ctx || k < .01) return; const t = ctx.currentTime;
   tone(ctx, t, {from: 210, to: 95, gain: .16*k, decay: .09}); burst(ctx, t, {freq: 1800, q: 2, gain: .18*k, decay: .03});
   burst(ctx, t, {type: 'highpass', freq: 3500, q: .5, gain: .05*k, attack: .03, decay: .35, offset: .02}); // the canopy rustles
  },
  land(position, planted) { const ctx = audio(), k = gainAt(position, .8); if (!ctx || k < .01) return; const t = ctx.currentTime;
   if (planted) { tone(ctx, t, {from: 120, to: 60, gain: .14*k, decay: .1}); burst(ctx, t, {type: 'lowpass', freq: 500, gain: .12*k, decay: .07});
    tone(ctx, t, {from: 330, to: 300, gain: .035*k, decay: .5, type: 'triangle', offset: .01}); } // the shaft twangs
   else { tone(ctx, t, {from: 140, to: 80, gain: .1*k, decay: .07}); burst(ctx, t, {type: 'lowpass', freq: 700, gain: .07*k, decay: .05}); }
  },
  // the wire: a bright metallic shing through wet flesh
  slice(position) { const ctx = audio(), k = gainAt(position); if (!ctx || k < .01) return; const t = ctx.currentTime;
   burst(ctx, t, {type: 'highpass', freq: 5200, q: .7, gain: .12*k, attack: .004, decay: .22}); tone(ctx, t, {from: 2400, to: 1900, gain: .03*k, decay: .25, type: 'triangle'});
   burst(ctx, t, {freq: 900, q: 2, gain: .1*k, attack: .006, decay: .09, offset: .015, rate: .6});
  },
  // a heavy bolt through an apple: a wet, juicy splat over a woody punch
  splat(position) { const ctx = audio(), k = gainAt(position, 1.1); if (!ctx || k < .01) return; const t = ctx.currentTime;
   tone(ctx, t, {from: 150, to: 50, gain: .2*k, decay: .14}); burst(ctx, t, {type: 'lowpass', freq: 1100, q: .8, gain: .26*k, attack: .003, decay: .2, rate: .55});
   for (let i = 0; i < 4; i++) burst(ctx, t, {freq: 2200 + Math.random()*2400, q: 1.3, gain: .12*k, decay: .03, offset: i*.012});
   burst(ctx, t, {type: 'highpass', freq: 3200, q: .5, gain: .06*k, attack: .04, decay: .5, offset: .05}); // spatter and leaves
  },
  take() { const ctx = audio(); if (!ctx) return; burst(ctx, ctx.currentTime, {freq: 1200, q: 1, gain: .05, attack: .02, decay: .12}); },
  flick() { const ctx = audio(); if (!ctx) return; burst(ctx, ctx.currentTime, {type: 'highpass', freq: 2600, gain: .05, attack: .03, decay: .14}); },
  // the core hits the grass: a soft, woody thud
  thud(position, speed = 1) { const ctx = audio(), k = gainAt(position, .7)*Math.min(1, .35 + speed*.25); if (!ctx || k < .01) return; const t = ctx.currentTime;
   tone(ctx, t, {from: 170, to: 90, gain: .09*k, decay: .06}); burst(ctx, t, {type: 'lowpass', freq: 650, gain: .06*k, decay: .05});
  },
  // a songbird: two or three quick rising whistles
  chirp(position, level = 1) { const ctx = audio(), k = gainAt(position, .5)*level; if (!ctx || k < .01) return; const t = ctx.currentTime, n = 2 + Math.floor(Math.random()*2), f = 2600 + Math.random()*900;
   for (let i = 0; i < n; i++) tone(ctx, t, {from: f*(.92 + Math.random()*.1), to: f*(1.25 + Math.random()*.2), gain: .028*k, decay: .05 + Math.random()*.03, type: 'triangle', offset: i*(.075 + Math.random()*.04)});
  },
  // a beak on the core: a tiny dry tick
  peck(position, level = 1) { const ctx = audio(), k = gainAt(position, .45)*level; if (!ctx || k < .01) return; burst(ctx, ctx.currentTime, {freq: 3400 + Math.random()*900, q: 4, gain: .05*k, decay: .012}); },
  // wings: a soft feathery flurry
  flutter(position, level = 1) { const ctx = audio(), k = gainAt(position, .5)*level; if (!ctx || k < .01) return; const t = ctx.currentTime;
   for (let i = 0; i < 4; i++) burst(ctx, t, {type: 'bandpass', freq: 900 + Math.random()*500, q: .8, gain: .03*k, attack: .01, decay: .045, offset: i*.055});
  },
 };
 const feast = createAppleFeast({group, birdTemplate: () => templates?.get?.('siegebird_songbird') || null, height,
  effects: {crumbs: (at, dir, n, power) => crumbBurst(at, dir, n, power),
   sounds: {thud: (p, s) => sounds.thud(p.toArray(), s), chirp: (p, l) => sounds.chirp(p.toArray(), l), peck: (p, l) => sounds.peck(p.toArray(), l), flutter: (p, l) => sounds.flutter(p.toArray(), l)}}});

 // ---------------------------------------------------------------- world drops
 function stickVisual(stick) { if (!STICKS[stick]) return null; const v = prepareProjectile(templates, stick); v?.traverse(o => { o.userData.ignoreContact = true; if (o.isMesh) o.castShadow = true; }); return v; }
 function makeModel(data, quality) {
  const model = createSnackModel({stick: data.stick, stickVisual: stickVisual(data.stick), seed: hash(data.id) % 997 + 1, radius: data.radius || .08, quality, physical: quality === 'high', half: !!data.half});
  model.root.traverse(o => { o.userData.ignoreContact = true; if (o.isMesh) o.castShadow = true; }); return model;
 }
 function syncDrops(s) {
  const seen = new Set();
  for (const d of s.fruit?.drops || []) {
   seen.add(d.id); let e = drops.get(d.id);
   if (!e) { e = {data: d, model: makeModel(d, 'low'), spin: 0, spinRate: d.mode === 'air' ? 8 + (hash(d.id) % 9) : 0, wobble: null, at: performance.now()/1000, born: performance.now()/1000};
    e.model.root.position.fromArray(d.position); orient(e.model, d, e.model.root.quaternion); group.add(e.model.root); drops.set(d.id, e); }
   if (e.data.mode === 'air' && d.mode === 'planted' && !e.wobble) e.wobble = {t: 0, amp: .32};
   if (e.data.mode === 'air' && d.mode === 'rest' && !e.wobble) e.wobble = {t: 0, amp: .1};
   e.from = e.model.root.position.clone(); e.data = d; e.at = performance.now()/1000;
   setBites(e.model.apple.material, e.model.apple.spheres, d.bites, {age: 30});
  }
  for (const [id, e] of drops) if (!seen.has(id)) { e.model.root.removeFromParent(); e.model.dispose(); drops.delete(id); }
 }
 const pose = {q: new T.Quaternion(), p: new T.Vector3(), tip: new T.Vector3(), axis: new T.Vector3()};
 // a drop's facing: a shaft along its shared dir; a half with its flat face along its shared cut normal
 function orient(model, d, out) { return model.half && d.cut ? out.setFromUnitVectors(model.faceNormal, tmpV2.fromArray(d.cut)) : out.setFromUnitVectors(FORWARD, tmpV2.fromArray(d.dir)); }
 function updateDrops(dt, now) {
  for (const [id, e] of drops) {
   const d = e.data, root = e.model.root;
   if (d.heldBy === playerId) { root.visible = false; continue; } root.visible = true;
   const age = Math.min(.12, now - e.at);
   if (d.mode === 'air') { pose.p.fromArray(d.position).addScaledVector(tmpV.fromArray(d.velocity), age); pose.p.y -= 4.9*age*age; }
   else if (d.mode === 'held') { // a remote hero holds it up; on each bite it goes to their face
    pose.p.fromArray(d.position); if (e.lift) { e.lift.t += dt; const k = Math.sin(Math.min(1, e.lift.t/.55)*Math.PI); pose.p.y += .28*k; if (e.lift.t > .55) e.lift = null; }
   } else pose.p.fromArray(d.position);
   root.position.lerp(pose.p, d.mode === 'air' ? 1 : 1 - Math.exp(-dt*14));
   orient(e.model, d, pose.q);
   root.quaternion.slerp(pose.q, d.mode === 'air' ? 1 - Math.exp(-dt*18) : 1 - Math.exp(-dt*10));
   if (d.mode === 'air') e.spin += e.spinRate*dt; else e.spinRate *= Math.exp(-6*dt);
   if (STICKS[d.stick]) e.model.spin.rotation.z = e.spin;
   else if (d.mode === 'air' && !d.half) e.model.spin.rotation.x += Math.hypot(d.velocity[0], d.velocity[2])/(d.radius || .08)*dt*.5; // a bare apple tumbles
   if (e.wobble) { // the planted shaft quivers about its buried tip; a resting one rocks once
    e.wobble.t += dt; const w = e.wobble.amp*Math.exp(-5.5*e.wobble.t)*Math.sin(e.wobble.t*42); if (e.wobble.t > 1.2) e.wobble = null;
    const tipOffset = (STICKS[d.stick]?.apple || 0), dir = tmpV.fromArray(d.dir); pose.tip.copy(root.position).addScaledVector(dir, tipOffset);
    pose.axis.crossVectors(dir, T.Object3D.DEFAULT_UP); if (pose.axis.lengthSq() < 1e-6) pose.axis.set(1, 0, 0); pose.axis.normalize();
    tmpQ.setFromAxisAngle(pose.axis, w*(reducedMotion ? .3 : 1)); root.position.sub(pose.tip).applyQuaternion(tmpQ).add(pose.tip); root.quaternion.premultiply(tmpQ);
   }
  }
 }

 // ---------------------------------------------------------------- regrowth: an apple swelling back on its branch
 const growMaterial = createApple({seed: 5, quality: 'low'}).material, growGeo = createApple({seed: 9, quality: 'low'}).body.geometry;
 const growing = new T.InstancedMesh(growGeo, growMaterial, 32); growing.name = 'AppleRegrowth'; growing.count = 0; growing.frustumCulled = false; group.add(growing);
 let growList = [];
 function syncGrowth(s) {
  growList = []; const missing = s.fruit?.missing || []; if (!missing.length) return;
  const trees = new Map(worldTrees(s).map(t => [t.id, t]));
  for (const m of missing) { const remaining = m.tick + FRUIT.regrowTicks - s.tick; if (remaining > FRUIT.growTicks || growList.length >= 32) continue;
   const t = trees.get(m.tree); if (!t) continue; const w = appleWorld(t, m.slot, height(t.x, t.z)); growList.push({...w, end: m.tick + FRUIT.regrowTicks, seed: m.slot}); }
 }
 function updateGrowth(renderTick) {
  let n = 0;
  for (const g of growList) { const k = clamp01(1 - (g.end - renderTick)/FRUIT.growTicks), s = g.radius*back(k)*(k > 0 ? 1 : 0);
   tmpM.compose(tmpV.fromArray(g.position).add(tmpV2.set(0, -g.radius*(1 - k)*.6, 0)), tmpQ.setFromAxisAngle(T.Object3D.DEFAULT_UP, g.seed), tmpV2.setScalar(Math.max(.0001, s))); growing.setMatrixAt(n++, tmpM); }
  growing.count = n; if (n) growing.instanceMatrix.needsUpdate = true;
 }

 // ---------------------------------------------------------------- the snack in my hand
 const anchor = new T.Group(); anchor.name = 'SnackAnchor'; camera.add(anchor);
 const idlePose = {p: v3(SNACK_MOTION.idle.position), d: v3(SNACK_MOTION.idle.tip).normalize()};
 function heldPose(name) { const m = SNACK_MOTION[name]; return {p: v3(m.position), d: v3(m.tip).normalize()}; }
 const P = {near: heldPose('near'), mouth: heldPose('mouth'), tear: heldPose('tear'), low: {p: v3([.3, -.62, -.32]), d: v3([-.2, .8, -.55]).normalize()}};
 function startHeld(d) {
  disposeHeld(); const model = makeModel(d, 'high'); anchor.add(model.root);
  held = {id: d.id, data: d, of: bitesFor(d), model, bites: d.bites, phase: 'raise', t: 0, roll: 0, rollFrom: 0, rollTo: 0, sentBite: false, blend: 0, done: false, chew: 0, vrCooldown: 0, ages: [99, 99, 99]};
  held.roll = rollFor(held, d.bites); heldId = d.id; sounds.take();
 }
 function disposeHeld() { if (!held) return; held.model.root.removeFromParent(); held.model.dispose(); held = null; heldId = null; }
 // Roll about the shaft so a root-space direction looks at the camera (camera +Z) from the mouth pose.
 function rollToward(b) {
  q0.setFromUnitVectors(FORWARD, P.mouth.d); const t = tmpV.copy(P.mouth.p).negate().normalize().applyQuaternion(q0.invert()); // camera direction in root space
  return Math.atan2(t.y, t.x) - Math.atan2(b.y, b.x);
 }
 // Where the eaten side faces: the mean of the first k bites' directions (root space).
 function eatenSide(h, k, out = new T.Vector3()) { out.set(0, 0, 0); for (let i = 0; i < Math.min(k, h.of); i++) out.add(h.model.biteDirection(i, tmpV2)); return out.lengthSq() > 1e-8 ? out.normalize() : out; }
 // Bite i's face, turned a little toward what is already eaten so the old scoops stay in sight on the silhouette.
 function rollFor(h, i) {
  const b = h.model.biteDirection(Math.min(h.of - 1, i), new T.Vector3());
  if (i > 0) b.addScaledVector(eatenSide(h, i, tmpV3), .45).normalize();
  return rollToward(b);
 }
 // After a bite: show the eaten side (both scoops after two bites, so the apple reads two-thirds gone).
 const tmpV3 = new T.Vector3(), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
 function showRoll(h) { return h.roll + wrap(rollToward(eatenSide(h, h.bites, tmpV3)) - h.roll); }
 const fromDir = new T.Vector3(), q0 = new T.Quaternion();
 function place(h, a, b, k, roll) {
  h.model.root.position.lerpVectors(a.p, b.p, k);
  fromDir.lerpVectors(a.d, b.d, k).normalize();
  h.model.root.quaternion.setFromUnitVectors(FORWARD, fromDir);
  // keep the shaft's "up" steady (no corkscrew), then roll the apple about the shaft
  h.model.spin.rotation.z = roll;
 }
 function biteContact(h) {
  h.bites++; h.ages[h.bites - 1] = 0;
  setBites(h.model.apple.material, h.model.apple.spheres, Math.min(h.of, h.bites), {age: 0});
  h.model.root.updateMatrixWorld(true);
  const at = h.model.apple.root.localToWorld(h.model.apple.spheres[Math.min(h.of - 1, h.bites - 1)].centre.clone().multiplyScalar(.8)), toward = camera.getWorldDirection(tmpV).negate();
  crumbBurst(at, toward.clone().multiplyScalar(-.4).add(v3([0, -.6, 0])), 14, .8); juiceBurst(at, v3([0, .2, 0]).addScaledVector(toward, -.6), 8, .9);
  sounds.crunch(1); haptic('bite');
  if (!h.sentBite) { h.sentBite = true; send('snack', {op: 'bite'}); }
  const eye = camera.getWorldPosition(new T.Vector3()); healMotes(eye.addScaledVector(camera.getWorldDirection(tmpV), .5).add(v3([0, -.12, 0])));
 }
 /** Bite request (primary action, Collect on the held snack, or the VR mouth). Returns true when a bite starts. */
 function bite() {
  if (!held || held.done || held.phase === 'bite' || held.phase === 'finish' || held.bites >= held.of || held.phase === 'raise' && held.t < SNACK_MOTION.raise*.8) return !!held;
  held.phase = 'bite'; held.t = 0; held.sentBite = false; held.rollFrom = held.roll; held.rollTo = rollFor(held, held.bites); return true;
 }
 function updateHeld(dt, {xrHand, xrHead, sway}) {
  const h = held; if (!h) { anchor.visible = false; return 0; }
  h.t += dt; for (let i = 0; i < 3; i++) h.ages[i] += dt;
  setBites(h.model.apple.material, h.model.apple.spheres, Math.min(h.of, h.bites), {age: h.ages[Math.max(0, h.bites - 1)]});
  if (xrHand) { // VR: in the right hand; your own mouth is the bite
   anchor.visible = false; if (h.model.root.parent !== xrHand) { xrHand.add(h.model.root); h.model.root.position.set(0, .02, -.16); h.model.root.quaternion.setFromEuler(new T.Euler(-.7, .3, 0)); }
   h.vrCooldown -= dt; if (h.phase === 'raise' && h.t > .3) h.phase = 'idle';
   if (xrHead && h.vrCooldown <= 0 && h.bites < h.of) { h.model.apple.root.getWorldPosition(tmpV); if (tmpV.distanceTo(xrHead.getWorldPosition(tmpV2)) < SNACK_MOTION.vrMouth) { h.vrCooldown = .6; h.sentBite = false; biteContact(h); if (h.bites >= h.of) { h.phase = 'finish'; h.t = 0; } } }
   if (h.phase === 'finish' && h.t > .5 && !h.flicked) dropCore(h);
   if (h.phase === 'finish' && h.t > 1.2) h.done = true; // the bare shaft leaves the hand
   return 1;
  }
  if (h.model.root.parent !== anchor) anchor.add(h.model.root);
  anchor.visible = true; let blend = 1, dip = 0, chew = 0;
  if (h.phase === 'raise') { const k = clamp01(h.t/SNACK_MOTION.raise); place(h, P.low, idlePose, back(k), h.roll + (1 - k)*1.2); blend = k; if (k >= 1) h.phase = 'idle'; }
  else if (h.phase === 'show') { const k = ease(clamp01(h.t/SNACK_MOTION.show)); h.roll = h.rollFrom + (h.rollTo - h.rollFrom)*k; place(h, idlePose, idlePose, 0, h.roll); if (k >= 1) { h.phase = 'idle'; h.t = 0; } }
  else if (h.phase === 'idle') place(h, idlePose, idlePose, 0, h.roll + Math.sin(h.t*1.3)*.03);
  else if (h.phase === 'bite') {
   const t = h.t, c = SNACK_MOTION.contact, roll = h.rollFrom + (h.rollTo - h.rollFrom)*ease(clamp01(t/c));
   if (t < .22) place(h, idlePose, P.near, ease(t/.22), roll);
   else if (t < c) { const k = easeIn(clamp01((t - .22)/(c - .22))); place(h, P.near, P.mouth, k, roll); dip = k; }
   else if (t < c + .16) { if (!h.contacted) { h.contacted = true; biteContact(h); } const k = easeOut((t - c)/.16); place(h, P.mouth, P.tear, k, roll - .12*Math.sin(k*Math.PI)); dip = 1 - k*.5; }
   else { const k = ease(clamp01((t - c - .16)/(SNACK_MOTION.bite - c - .16))); place(h, P.tear, idlePose, k, roll); dip = .5*(1 - k); chew = clamp01((t - c)/(SNACK_MOTION.bite - c + .4)); }
   if (h.contacted && !h.chewed && t > c + .3) { h.chewed = 1; sounds.crunch(.7, true); }
   if (h.chewed === 1 && t > c + .5) { h.chewed = 2; sounds.crunch(.5, true); }
   if (t >= SNACK_MOTION.bite) { h.contacted = false; h.chewed = 0; h.roll = h.rollTo; if (h.bites >= h.of) { h.phase = 'finish'; h.t = 0; } else { h.phase = 'show'; h.t = 0; h.rollFrom = h.roll; h.rollTo = showRoll(h); } }
  }
  else if (h.phase === 'finish') { // a beat to see the core, then it slides off the shaft and drops; the bare shaft lowers
   const t = h.t, L = SNACK_MOTION.linger; if (t < L) place(h, idlePose, idlePose, 0, h.roll); else { if (!h.flicked) dropCore(h); const k = clamp01((t - L)/(SNACK_MOTION.finish - L)); place(h, idlePose, P.low, ease(k), h.roll); blend = 1 - k; }
   if (t >= SNACK_MOTION.finish) h.done = true;
  }
  // chewing: the view bobs gently a few times after each bite
  if (chew > 0 && chew < 1 && !reducedMotion) h.chew = Math.sin(chew*Math.PI*2*SNACK_MOTION.chew.cycles)*SNACK_MOTION.chew.amplitude*(1 - chew); else h.chew = 0;
  h.dip = dip*SNACK_MOTION.dip*(reducedMotion ? .3 : 1);
  if (sway) { h.model.root.position.add(sway.position); h.model.root.quaternion.premultiply(sway.quaternion); }
  h.blend = blend; return blend;
 }
 function coreModel(half, radius) { // the eaten core (or a half's eaten shell), as a free world object
  const core = createApple({seed: 3, quality: 'low', half}); setBites(core.material, core.spheres, half ? FRUIT.halfBites : FRUIT.bites, {age: 40});
  core.root.scale.setScalar(radius); core.root.userData.dispose = core.dispose; group.add(core.root); return core;
 }
 function dropCore(h) {
  h.flicked = true; sounds.flick(); h.model.root.updateMatrixWorld(true);
  const apple = h.model.apple.root; apple.getWorldPosition(tmpV); apple.getWorldQuaternion(tmpQ);
  const core = coreModel(h.model.half, h.model.radius); core.root.quaternion.copy(tmpQ);
  const fwd = camera.getWorldDirection(tmpV2).clone(); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
  const right = v3([1, 0, 0]).applyQuaternion(camera.getWorldQuaternion(new T.Quaternion())); right.y = 0;
  // it slips off the shaft and falls a little out in front, so you watch the birds come for it
  feast.drop(core.root, {position: tmpV.clone(), velocity: fwd.multiplyScalar(.9).addScaledVector(right, .3).add(v3([0, .8, 0])).toArray(), radius: h.model.radius*.42, key: h.id, spin: [5, 1.5, 3]});
  apple.visible = false;
 }
 // ---------------------------------------------------------------- snapshots and events
 function sync(s, me) {
  snapshot = s; playerId = me; syncDrops(s); syncGrowth(s); mask.sync(s);
  const mine = (s.fruit?.drops || []).find(d => d.heldBy === me);
  if (mine && (!held || held.id !== mine.id)) startHeld(mine);
  if (held) {
   if (mine) { held.data = mine; if (mine.bites > held.bites) held.bites = mine.bites; }
   else if (!held.done && held.phase !== 'finish' && !(held.phase === 'bite' && held.bites >= held.of)) disposeHeld(); // dropped, or eaten on the host before our anim
  }
 }
 function event(e, me = playerId) {
  if (!e?.kind?.startsWith?.('apple_') && !e?.kind?.startsWith?.('snack_')) return false;
  const at = Array.isArray(e.position) ? v3(e.position) : null;
  if (e.kind === 'apple_pierce' && at) {
   const dir = v3(e.direction || [0, -1, 0]); juiceBurst(at, dir, e.stick === 'none' ? 5 : 10, 1.1); if (!e.shed) leafFlutter(at, e.stick === 'none' ? 3 : 5); sounds.pierce(e.position);
   if (e.by === me) haptic('pierce');
  }
  if (e.kind === 'apple_slice' && at) { // the halves part along the cut: juice off both faces, a few leaves
   const n = v3(e.normal || [1, 0, 0]); juiceBurst(at, n, 6, .8); juiceBurst(at, n.clone().negate(), 6, .8); leafFlutter(at, 3); sounds.slice(e.position);
   if (e.by === me) haptic('pierce');
  }
  if (e.kind === 'apple_burst' && at) { appleBurst(at, v3(e.direction || [0, 0, -1]), e.radius || .08); leafFlutter(at, 6); sounds.splat(e.position); if (e.by === me) haptic('pierce'); }
  if ((e.kind === 'apple_land' || e.kind === 'apple_bounce') && at) { sounds.land(e.position, !!e.planted); if (e.planted) crumbBurst(at.clone().add(v3([0, -.15, 0])), v3([0, 1, 0]), 4, .4); }
  if (e.kind === 'snack_bite' && e.by !== me && at) { const d = drops.get(e.id); if (d) d.lift = {t: 0}; setTimeout(() => sounds.crunch(gainAt(e.position, .9)), 200); }
  if (e.kind === 'snack_done' && e.by !== me && at) { // someone else finished one: their core drops and the birds come too
   sounds.flick(); const d = drops.get(e.id)?.data, core = coreModel(!!d?.half, d?.radius || .08);
   feast.drop(core.root, {position: at.clone().add(v3([0, .1, 0])), velocity: [0, .6, 0], radius: (d?.radius || .08)*.42, key: e.id});
  }
  return true;
 }
 /** Per frame. Returns how far the snack has taken over the hand (0..1): the caller lowers/hides its weapon by it. */
 function update(dt, {now = performance.now()/1000, renderTick = snapshot?.tick || 0, xrHand = null, xrHead = null, sway = null} = {}) {
  stepParticles(dt); updateDrops(dt, now); updateGrowth(renderTick); feast.update(dt, now); mask.flush();
  const blend = updateHeld(dt, {xrHand, xrHead, sway});
  if (held?.done) disposeHeld();
  return blend;
 }
 return {group, anchor, sync, event, update, bite, mask,
  holding: () => !!held && !held.done, heldId: () => heldId,
  /** Camera offsets to apply after the camera pose is set: the lean into a bite and the chew bob. */
  view: () => held ? {pitch: -(held.dip || 0), y: held.chew || 0} : null,
  attachTrees: treeView => mask.attach(treeView),
  stats: () => ({drops: drops.size, held: !!held, crumbs: crumbs.list.length, chunks: chunks.list.length, juice: juice.list.length, leaves: leaves.list.length, growing: growing.count, masked: mask.stats(), feast: feast.state()}),
  dispose() { disposeHeld(); for (const e of drops.values()) e.model.dispose(); drops.clear(); feast.dispose(); group.removeFromParent(); anchor.removeFromParent(); mask.dispose();
   for (const g of [crumbGeo, chunkGeo, dropGeo, leafGeo]) g.dispose(); for (const m of [crumbMat, chunkMat, juiceMat, leafMat, moteMat, growMaterial]) m.dispose(); }};
}
