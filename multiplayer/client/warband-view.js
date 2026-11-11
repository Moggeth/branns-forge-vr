// What the God sees of their Warband (shared/warband.js): a brass ring under each selected Forgeling, a pin on each
// one's own march point, health bars from above, and a ripple where an order lands. Everything is pooled (at most
// six Forgelings, four ripples), drawn every frame from the interpolated actor roots, and costs a handful of draws.
// The landing drop is presentation too: a Forgeling falls down its shaft of forge-light for WARBAND.landTicks.
import * as THREE from 'three';
import {WARBAND} from '../shared/warband.js';

const GOLD = 0xffc857, RESONANCE = 0x6fb8ff, EMBER = 0xff6a3a, HURT = 0xff5a4a, HEALTHY = 0x8fe08a;
const DROP = 4; // metres: what a 0.9 s fall from rest covers

function ringGeometry(inner, outer, segments = 40) { const g = new THREE.RingGeometry(inner, outer, segments); g.rotateX(-Math.PI / 2); return g; }
const glow = color => new THREE.MeshBasicMaterial({color, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false});

export function createWarbandView({scene, heightAt}) {
 const root = new THREE.Group(); root.name = 'WarbandView'; scene.add(root);
 const selRing = ringGeometry(.62, .78), selTicks = ringGeometry(.86, .94, 12), pinRing = ringGeometry(.16, .3, 16), ripple = ringGeometry(.86, 1, 48);
 const barBack = new THREE.PlaneGeometry(.9, .1), barFill = new THREE.PlaneGeometry(1, .07); barFill.translate(.5, 0, 0);
 const mats = {sel: glow(GOLD), tick: glow(RESONANCE), pin: glow(GOLD), move: glow(GOLD), attack: glow(EMBER),
  back: new THREE.MeshBasicMaterial({color: 0x1a140f, transparent: true, opacity: .7, depthWrite: false, toneMapped: false}),
  fill: new THREE.MeshBasicMaterial({color: HEALTHY, depthWrite: false, toneMapped: false, vertexColors: false})};
 const fills = []; // per-bar and per-ripple materials: each tints and fades on its own
 const slots = Array.from({length: WARBAND.perOwner}, (_, i) => {
  const ring = new THREE.Mesh(selRing, mats.sel), ticks = new THREE.Mesh(selTicks, mats.tick), pin = new THREE.Mesh(pinRing, mats.pin);
  const bar = new THREE.Group(), back = new THREE.Mesh(barBack, mats.back), fillMat = mats.fill.clone(), fill = new THREE.Mesh(barFill, fillMat);
  fills.push(fillMat); fill.position.set(-.45, 0, .001); bar.add(back, fill);
  for (const m of [ring, ticks, pin, bar]) { m.visible = false; m.renderOrder = 6; m.frustumCulled = false; root.add(m); }
  ring.name = `WarbandSelect${i}`; return {ring, ticks, pin, bar, fill};
 });
 const ripples = Array.from({length: 4}, () => { const move = mats.move.clone(), attack = mats.attack.clone(), m = new THREE.Mesh(ripple, move); fills.push(move, attack); m.visible = false; m.renderOrder = 6; root.add(m); return {mesh: m, move, attack, age: 9, target: null, at: new THREE.Vector3()}; });
 let next = 0, time = 0;

 /** Landing: the root falls from DROP metres to the ground over the first WARBAND.landTicks of its life. */
 function present(entry, renderTick) {
  const born = entry.data?.warband?.born; if (born === undefined) return;
  const u = (renderTick - born) / WARBAND.landTicks; if (u >= 1 || u < 0) return;
  entry.root.position.y += DROP * (1 - u * u); // constant acceleration from rest
 }
 /** An order ripple at a point (move/hold) or under a target (attack), which it follows while it fades. */
 function ping(kind, position, target = null) {
  const r = ripples[next++ % ripples.length]; r.age = 0; r.target = target; r.mesh.material = kind === 'attack' ? r.attack : r.move;
  r.at.set(position[0], heightAt(position[0], position[2]) + .08, position[2]);
 }
 /**
  * units: [{entry, data, selected}] for the viewer's own Forgelings; god: true in the strategy view.
  * actorOf(id) returns an actor entry (for ripples that follow a target).
  */
 function update({units, god, camera, dt, actorOf}) {
  time += dt;
  const pulse = .82 + .18 * Math.sin(time * 5);
  slots.forEach((s, i) => {
   const u = units[i];
   const show = !!u && u.entry?.root.visible !== false;
   s.ring.visible = s.ticks.visible = show && u.selected;
   s.bar.visible = show && god;
   const order = u?.data.warband?.order;
   s.pin.visible = show && u.selected && god && (order?.kind === 'move' || order?.kind === 'hold') && !!order.point;
   if (!show) return;
   const p = u.entry.root.position;
   if (s.ring.visible) { const y = heightAt(p.x, p.z) + .06; s.ring.position.set(p.x, y, p.z); s.ticks.position.set(p.x, y, p.z); s.ticks.rotation.y = time * .8; s.ring.scale.setScalar(pulse); }
   if (s.pin.visible) { const [x, , z] = order.point; s.pin.position.set(x, heightAt(x, z) + .07, z); }
   if (s.bar.visible) {
    const hp = Math.max(0, Math.min(1, (u.data.hp ?? WARBAND.hp) / WARBAND.hp));
    s.bar.position.set(p.x, p.y + 2.25, p.z); s.bar.quaternion.copy(camera.quaternion); s.fill.scale.x = .9 * hp;
    s.fill.material.color.setHex(hp > .5 ? HEALTHY : hp > .25 ? GOLD : HURT);
   }
  });
  for (const r of ripples) {
   if (r.age >= .75) { r.mesh.visible = false; continue; }
   r.age += dt; const k = Math.min(1, r.age / .75);
   const follow = r.target ? actorOf(r.target)?.root.position : null;
   if (follow) r.at.set(follow.x, heightAt(follow.x, follow.z) + .08, follow.z);
   r.mesh.visible = true; r.mesh.position.copy(r.at); r.mesh.scale.setScalar(.35 + 1.65 * (1 - (1 - k) ** 3));
   r.mesh.material.opacity = .95 * (1 - k);
  }
 }
 return {present, ping, update, dispose() {
  scene.remove(root);
  for (const g of [selRing, selTicks, pinRing, ripple, barBack, barFill]) g.dispose();
  for (const m of [...Object.values(mats), ...fills]) m.dispose();
 }};
}
