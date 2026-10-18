// The Flockwright (the Armoury's crossbow, shared/armoury.js): every copy, held or on a remote hero's back hand, plays
// the model's own clips. Idle loops (the six goggled birds bob and peek); a shot plays Fire, then Reload, fitted to
// the host's cycle (shared/combat.js FLOCKWRIGHT) so the crew seats the next bolt just as the weapon can fire again.
// Presentation only: clips advance on the frame clock, never on sim ticks.
import * as THREE from 'three';
import {FLOCKWRIGHT} from '../shared/combat.js';

export const FLOCKWRIGHT_TIMING = Object.freeze({fire: .38, reload: FLOCKWRIGHT.cycleTicks / 60 - .38, blend: .08});
// First-person poses for the weapon anchor (the model's GripMain socket is the pivot). Hip: low right, nose a touch
// left. Aim: the rear ring sight and the front bead on the view axis, close to the eye.
export const FLOCKWRIGHT_POSE = Object.freeze({hip: Object.freeze([.2, -.22, -.4]), aim: Object.freeze([0, -.143, -.3]), aimRate: 12});

export function createFlockwrightRigs() {
  let clips = null;
  const rigs = new Map();   // model -> {mixer, actions, phase}
  function setClips(animations = []) {
    const byName = Object.fromEntries(animations.map(c => [c.name, c]));
    if (byName.Idle && byName.Fire && byName.Reload) clips = byName;
    for (const model of [...rigs.keys()]) rigs.delete(model);   // rebuilt on next use with the real clips
  }
  function rig(model) {
    if (!model || !clips) return null;
    let r = rigs.get(model);
    if (r) return r;
    const mixer = new THREE.AnimationMixer(model);
    const actions = {idle: mixer.clipAction(clips.Idle), fire: mixer.clipAction(clips.Fire), reload: mixer.clipAction(clips.Reload)};
    for (const a of [actions.fire, actions.reload]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions.fire.timeScale = clips.Fire.duration / FLOCKWRIGHT_TIMING.fire;
    actions.reload.timeScale = clips.Reload.duration / FLOCKWRIGHT_TIMING.reload;
    actions.idle.play();
    r = {mixer, actions, phase: 'idle'};
    mixer.addEventListener('finished', e => {
      if (e.action === actions.fire && r.phase === 'fire') { r.phase = 'reload'; actions.reload.reset().play(); actions.fire.crossFadeTo(actions.reload, .04, false); }
      else if (e.action === actions.reload && r.phase === 'reload') { r.phase = 'idle'; actions.idle.reset().play(); actions.reload.crossFadeTo(actions.idle, FLOCKWRIGHT_TIMING.blend, false); }
    });
    rigs.set(model, r);
    return r;
  }
  /** A bolt left this copy: trigger, limbs snap, birds startle, then the crew reloads. */
  function fired(model) {
    const r = rig(model); if (!r) return;
    const {idle, fire, reload} = r.actions;
    r.phase = 'fire'; reload.stop(); fire.reset().setEffectiveWeight(1).play();
    if (idle.isRunning()) idle.crossFadeTo(fire, .03, false);
  }
  /** Advance every copy that is in the scene. */
  function update(dt) {
    for (const [model, r] of rigs) {
      let shown = !!model.parent;
      for (let o = model; o && shown; o = o.parent) if (!o.visible) shown = false;
      if (shown) r.mixer.update(dt);
    }
  }
  function forget(model) { const r = rigs.get(model); if (!r) return; r.mixer.stopAllAction(); rigs.delete(model); }
  const phase = model => rigs.get(model)?.phase ?? null;
  return {setClips, rig, fired, update, forget, phase, stats: () => ({rigs: rigs.size, clips: !!clips})};
}
