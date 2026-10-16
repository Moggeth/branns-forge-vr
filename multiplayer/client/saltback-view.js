// Saltback presentation (client only): the salt-mine hermit crab (public/assets/saltback-crab.glb,
// assets-source/saltback-crab/README.md). One skinned mesh per crab, cloned with SkeletonUtils; geometry, clips and the
// three materials are shared by every crab. No lights: the salt-lamp shell glows through an emissive term driven by
// the CrabShell vertex-colour alpha (the authored glow mask), one shared breathing pulse.
//
// Ownership: entry.root stays simulation-owned (interpolated position/yaw from enemy-interp.js). This module only poses
// the crab's bones, every frame, from the interpolated render tick: one-shot clips (Emerge, the reversed-Emerge dive,
// Pinch, Hurt) take their time straight from sim ticks, loops (Idle, Scuttle) advance with the frame's dt and the
// rendered travel. Nothing is stepped per packet. The mixer is ours (never in game.js's mixer set): each frame we set
// every action's time and weight and apply with update(0).
//
// Sim contract (shared/salt-mine-rules.js): yaw faces -Z like every enemy; the crab turns its side to its path, so its
// travel is mostly along its own left/right. Model frame: +Z forward, +X the crab's left; Scuttle at timeScale 1 walks
// along +X at 0.4 m/s. A pinch winds up for SALT.crab.windup ticks and hits on that tick, which is the Pinch clip's
// 0.35 s keyed snap (21 ticks at 60 Hz), so clip time = ticks since attackTick / 60.
//
// Combat contacts: bone names map through combat-view canonicalPart (LegL* -> leftLeg, LegR* -> rightLeg, the rest ->
// torso); every part exists on a crab, so every rendered triangle is a valid hit. The rig's 'Root' bone is renamed
// 'CrabRoot' (tracks too) so enemy-motion.js, which drives any visual with a 'Root' bone as a skeleton, finds nothing
// to pose on a crab.
import * as THREE from 'three';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';
import {SALT} from '../shared/salt-mine-rules.js';
import {createParticles, softTexture} from './ent-view.js';

const TICK = 60, C = SALT.crab, WINDUP_S = C.windup / TICK, EMERGE_S = C.emergeTicks / TICK, DIVE_S = C.diveTicks / TICK;
const SCUTTLE_SPEED = .4, SCALE = 1.08; // a touch over authored size: the sim's crab is .55 m tall with a .36 m radius
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t, ease = (dt, rate) => 1 - Math.exp(-dt * rate);
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const CLIPS = ['Idle', 'Scuttle', 'Pinch', 'Hurt', 'Death', 'Emerge'];
const GLOW = new THREE.Color(1, .5, .6), SALT_PINK = [.98, .72, .8], SALT_WHITE = [1, .93, .95];

/**
 * createSaltbackView({scene, load(), height(x,z), quality, sound(name, position, opts)})
 *   install(gltf)             share the crab template (rename Root, set up materials); returns false if incomplete
 *   build(data) -> visual      null until installed (the first request calls load() once)
 *   update(actors, tick, dt, threats)  pose every crab (after enemy motion, before combat contacts)
 *   release(entry, snapshot)  a crab that died keeps a corpse that rolls over and sinks; one that dived just goes
 *   event(event)              emerge/dive/pinch/loot/hit bursts and cues
 *   tick(dt)                  particles, corpses and the shared glow pulse
 */
export function createSaltbackView({scene, load = () => {}, height = () => 0, quality = 'high', sound = () => {}} = {}) {
 const low = quality === 'low', tex = softTexture(), chips = createParticles(scene, low ? 90 : 180, false, tex);
 const glow = {value: 1}, corpses = [], states = new WeakMap(), crabIds = new Set();
 let template = null, clips = null, requested = false, clock = 0, materials = [];
 function install(gltf) {
  let mesh = null; gltf.scene.traverse(n => { if (n.isSkinnedMesh && !mesh) mesh = n; if (n.isBone && n.name === 'Root') n.name = 'CrabRoot'; });
  const byName = Object.fromEntries((gltf.animations || []).map(c => [c.name, c]));
  if (!mesh || !CLIPS.every(n => byName[n])) return false;
  for (const clip of Object.values(byName)) for (const t of clip.tracks) if (t.name.startsWith('Root.')) t.name = 'Crab' + t.name;
  for (const m of [mesh.material].flat()) {
   m.transparent = false; m.alphaTest = 0; m.depthWrite = true; m.vertexColors = true; materials.push(m);
   if (m.name !== 'CrabShell') continue;
   // The glow mask is COLOR_0.a on the shell: emissive += rose * mask * pulse. Opaque, so three keeps alpha at 1.
   m.emissive.setRGB(0, 0, 0);
   m.onBeforeCompile = shader => {
    shader.uniforms.saltGlow = glow; shader.uniforms.saltGlowColor = {value: GLOW};
    shader.fragmentShader = 'uniform float saltGlow;\nuniform vec3 saltGlowColor;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
     '#include <emissivemap_fragment>\n#ifdef USE_COLOR_ALPHA\n totalEmissiveRadiance += saltGlowColor * vColor.a * saltGlow;\n#endif');
   };
   m.customProgramCacheKey = () => 'saltback-shell-glow';
   m.userData.saltGlow = glow; // the shared pulse uniform (review tools read it)
   m.needsUpdate = true;
  }
  mesh.castShadow = !low; mesh.receiveShadow = true; mesh.frustumCulled = false; // skinned bounds lag the clips (Emerge, Death)
  template = gltf.scene; clips = byName; return true;
 }
 function build(data) {
  if (data?.kind !== 'saltback') return null;
  if (!template) { if (!requested) { requested = true; load(); } return null; }
  const model = cloneSkinnedAsset(template), bones = {};
  model.traverse(n => { if (n.isBone) bones[n.name] = n; if (n.isMesh) n.userData.saltback = true; });
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const name of CLIPS) { const a = mixer.clipAction(clips[name]); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0); actions[name] = a; }
  const body = new THREE.Group(); body.name = 'SaltbackBody'; body.rotation.y = Math.PI; body.scale.setScalar(SCALE); body.add(model); // built facing +Z; the sim faces -Z
  const visual = new THREE.Group(); visual.name = 'Saltback'; visual.add(body);
  const seed = hash(data.id);
  visual.userData.saltback = {mixer, actions, body, model, bones, seed, eyeRest: {EyeL: new THREE.Quaternion(), EyeR: new THREE.Quaternion()}};
  return visual;
 }
 const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler(), weights = {};
 function apply(rig, times, w) {
  for (const name of CLIPS) {
   const a = rig.actions[name], wt = w[name] || 0, d = a.getClip().duration;
   a.time = clamp(times[name] ?? 0, 0, d - 1e-4); a.setEffectiveWeight(wt);
  }
  rig.mixer.update(0);
 }
 function pose(entry, tick, dt, threats) {
  const visual = entry.visual, rig = visual.userData.saltback, d = entry.data; if (!rig || !d) return;
  entry.root.getWorldPosition(v1); crabIds.add(d.id);
  let st = states.get(visual);
  if (!st) { st = {last: v1.clone(), vx: 0, move: 0, idle: (rig.seed % 997) / 997 * 2, scuttle: 0, look: 0, yaw: 0, pitch: 0, clickAt: clock + 1.5 + (rig.seed % 7) * .5, snapped: d.attackTick, hurt: d.hurtTick}; states.set(visual, st); }
  // Rendered travel in the crab's own frame (+X = its left = Scuttle's travel at a positive timeScale).
  const dx = v1.x - st.last.x, dz = v1.z - st.last.z; st.last.copy(v1);
  const yaw = entry.root.rotation.y, teleport = Math.hypot(dx, dz) > 1;
  const along = teleport || dt <= 0 ? 0 : (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) / dt; // model +X in world = (-cos yaw, 0, sin yaw)
  const fwd = teleport || dt <= 0 ? 0 : -(dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dt; // model +Z in world = the sim's forward (-sin yaw, 0, -cos yaw)
  st.vx = lerp(st.vx, clamp(along, -4, 4), ease(dt, 10));
  const speed = Math.hypot(st.vx, fwd * .5);
  st.move = lerp(st.move, speed > .12 ? 1 : 0, ease(dt, speed > .12 ? 12 : 6));
  // Loops: Idle on the wall clock, Scuttle by distance so planted feet never skate (signed for -X travel).
  const iDur = rig.actions.Idle.getClip().duration, sDur = rig.actions.Scuttle.getClip().duration;
  st.idle = (st.idle + dt) % iDur;
  const gait = (Math.abs(st.vx) > .05 ? st.vx : st.move > .05 ? fwd : 0) / (SCUTTLE_SPEED * SCALE); // the body is scaled, so are its strides
  st.scuttle = ((st.scuttle + dt * gait) % sDur + sDur) % sDur;
  // One-shots straight from interpolated sim ticks.
  const age = (tick - (d.wakeTick ?? -1e9)) / TICK, dive = d.diveTick !== undefined ? (tick - d.diveTick) / TICK : -1;
  const pinch = (tick - (d.attackTick ?? -1e9)) / TICK, hurt = (tick - (d.hurtTick ?? -1e9)) / TICK;
  const hDur = rig.actions.Hurt.getClip().duration, pDur = rig.actions.Pinch.getClip().duration;
  let wE = 0, tE = 0;
  if (dive >= 0) { const k = clamp(dive / DIVE_S); wE = smooth(dive / .12); tE = EMERGE_S * (1 - k); } // Emerge reversed: eyes drop, shake, sink
  else if (age >= 0 && age < EMERGE_S + .15) { wE = 1 - smooth((age - EMERGE_S) / .15); tE = Math.min(age, EMERGE_S); }
  const pEnv = pinch >= 0 && pinch < pDur ? smooth(pinch / .06) * (1 - smooth((pinch - (pDur - .12)) / .12)) : 0;
  const hEnv = hurt >= 0 && hurt < hDur + .1 ? smooth(hurt / .04) * (1 - smooth((hurt - hDur + .05) / .15)) * .9 : 0;
  let rem = 1 - wE; const wP = rem * pEnv; rem -= wP; const wH = rem * hEnv; rem -= wH;
  weights.Emerge = wE; weights.Pinch = wP; weights.Hurt = wH; weights.Idle = rem * (1 - st.move); weights.Scuttle = rem * st.move; weights.Death = 0;
  apply(rig, {Idle: st.idle, Scuttle: st.scuttle, Pinch: pinch, Hurt: hurt, Emerge: tE, Death: 0}, weights);
  // The dive sinks a little further than Emerge's start so the shell's top crystals go under too.
  rig.body.position.y = dive >= 0 ? -smooth((dive / DIVE_S - .6) / .4) * .2 : 0;
  // Cues: the crusher's snap on the sim's hit tick, and sparse chatter while it is about.
  if (d.attackTick !== st.snapped && pinch >= WINDUP_S) { st.snapped = d.attackTick; if (pinch < WINDUP_S + .25) { sound('saltback_pinch', v1.toArray(), {mine: true, key: `crab-pinch-${d.id}`}); burst(clawTip(rig, v1), 5, .7, SALT_WHITE); } }
  if (clock > st.clickAt) { st.clickAt = clock + 3 + ((rig.seed + Math.floor(clock)) % 9) * .6; if (wE < .5 && d.hp > 0) sound('saltback_click', v1.toArray(), {mine: true, key: `crab-click-${d.id}`, gain: st.move > .5 ? .9 : .6}); }
  // Eyes: the stalks swivel to the nearest Hero (procedural, after the mixer); not while surfacing, sinking or hurt.
  let best = 6, target = null;
  for (const p of threats || []) { const dd = Math.hypot(p[0] - v1.x, p[2] - v1.z); if (dd < best) { best = dd; target = p; } }
  let wantYaw = 0, wantPitch = 0, wantLook = 0;
  if (target) {
   v2.set(target[0], target[1] + 1.4, target[2]); rig.body.worldToLocal(v2); // crab model space: +Z forward
   wantYaw = clamp(Math.atan2(v2.x, v2.z), -1.1, 1.1); wantPitch = clamp(Math.atan2(v2.y - .5, Math.hypot(v2.x, v2.z)), -.2, .45);
   wantLook = (1 - wE) * (1 - hEnv) * smooth((6 - best) / 2);
  }
  st.look = lerp(st.look, wantLook, ease(dt, 4)); st.yaw = lerp(st.yaw, wantYaw, ease(dt, 7)); st.pitch = lerp(st.pitch, wantPitch, ease(dt, 7));
  if (st.look > .01) for (const [name, k] of [['EyeL', 1], ['EyeR', .85]]) {
   const bone = rig.bones[name]; if (!bone) continue;
   q1.setFromEuler(e1.set(-st.pitch * .5 * st.look, st.yaw * k * st.look, 0)); bone.quaternion.premultiply(q1);
  }
 }
 function clawTip(rig, fallback) { const b = rig.bones.PincerR; return b ? b.getWorldPosition(v2) : fallback; }
 function burst(at, n, spread, color = SALT_PINK, up = 1.6) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = spread * (.4 + Math.random()), w = .85 + Math.random() * .25;
   chips.emit({x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: up * (.5 + Math.random()), vz: Math.sin(a) * s, life: .6 + Math.random() * .5, size: .03 + Math.random() * .035, grav: -9.8, drag: .4, ground: true,
    r: color[0] * w, g: color[1] * w, b: color[2] * w}); }
 }
 function update(actors, tick, dt, threats) { clock += dt; let n = 0; for (const entry of actors.values()) if (entry.enemy && entry.visual?.userData.saltback) { pose(entry, tick, dt, threats); n++; } return n; }
 function event(e) {
  if (!e?.kind) return;
  const at = Array.isArray(e.position) ? v1.fromArray(e.position) : null;
  if ((e.kind === 'hit' || e.kind === 'headshot') && e.material === 'stone' && at && crabIds.has(e.id)) burst(at, low ? 4 : 7, .9);
  if (e.kind === 'saltback_emerge' && at) { sound('saltback_burrow', at.toArray(), {mine: true}); v2.set(at.x, height(at.x, at.z) + .05, at.z); burst(v2, low ? 8 : 14, .8, SALT_WHITE, 1.2); }
  if (e.kind === 'saltback_dive' && at) { sound('saltback_burrow', at.toArray(), {mine: true}); v2.set(at.x, height(at.x, at.z) + .05, at.z); burst(v2, low ? 6 : 10, .6, SALT_WHITE, 1); }
  if (e.kind === 'saltback_loot' && at) burst(at.setY(at.y + .3), low ? 10 : 18, 1.2);
  if (e.kind === 'saltback_gone') crabIds.delete(e.id);
 }
 // A felled crab rolls onto its back (Death, clamped), lies a moment, then sinks into the salt. A crab that dived is
 // already under: it simply goes. The live actor gets an empty stand-in so the game frees nothing twice.
 function release(entry, snapshot) {
  const visual = entry.visual, rig = visual?.userData?.saltback; if (!rig) return false;
  const id = entry.data?.id, dived = entry.data?.diveTick !== undefined && (snapshot?.tick ?? 0) >= entry.data.diveTick;
  scene.attach(visual); entry.visual = new THREE.Group(); entry.visual.userData.released = true;
  crabIds.delete(id); states.delete(visual);
  if (dived) { endCorpse({visual, rig}); return true; }
  for (const n of CLIPS) rig.actions[n].setEffectiveWeight(0);
  rig.body.position.y = 0;
  corpses.push({visual, rig, age: 0});
  return true;
 }
 function endCorpse(c) { c.visual.removeFromParent(); c.rig.mixer.stopAllAction(); c.rig.mixer.uncacheRoot(c.rig.model); c.visual.traverse(n => n.skeleton?.dispose()); }
 function tick(dt) {
  if (!glow.hold) glow.value = .85 + .3 * Math.sin(clock * 1.25) + .08 * Math.sin(clock * 3.1);
  const dDur = clips ? clips.Death.duration : 1.2;
  for (let i = corpses.length - 1; i >= 0; i--) {
   const c = corpses[i]; c.age += dt;
   weights.Death = 1; weights.Idle = weights.Scuttle = weights.Pinch = weights.Hurt = weights.Emerge = 0;
   apply(c.rig, {Death: Math.min(c.age, dDur)}, weights);
   if (!c.puff && c.age > .55) { c.puff = true; c.visual.getWorldPosition(v1); burst(v1.setY(v1.y + .25), low ? 8 : 14, 1.1); }
   const sink = smooth((c.age - dDur - 1.4) / .9); c.rig.body.position.y = -sink * .7;
   if (c.age > dDur + 2.4) { endCorpse(c); corpses.splice(i, 1); }
  }
  chips.tick(dt, height);
 }
 function stats() { return {installed: !!template, corpses: corpses.length, chips: chips.count(), glow: +glow.value.toFixed(3)}; }
 function dispose() {
  for (const c of corpses) endCorpse(c); corpses.length = 0; chips.dispose(); tex.dispose();
  if (template) { template.traverse(n => n.geometry?.dispose()); for (const m of materials) m.dispose(); template = null; }
 }
 return {install, build, update, release, event, tick, stats, dispose, ready: () => !!template};
}
