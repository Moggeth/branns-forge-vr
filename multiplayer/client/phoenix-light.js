import * as THREE from 'three';
// The phoenix carries its own light. One real point light, pooled for every phoenix on screen, rides the
// phoenix nearest the camera and lights whatever it passes: the ground, trees, foes, buildings. At night it
// is the point of the ability — a bird of fire sweeping the dark, lighting the world for a moment as it goes —
// so its strength follows the sky: modest by day, bright and far-reaching at night.
//
// Phone and Quest safe: exactly one light, always in the scene and never toggled visible (a change in the
// light count recompiles every lit material), no shadows. Idle, it sits at zero intensity. Ignite flashes
// borrow the same light for a beat, so a phoenix hit throws a burst of firelight over its target.
export const PHOENIX_LIGHT = Object.freeze({
  color: 0xff9a3c,
  day: {intensity: 7, distance: 7},      // in daylight a warm lick of light, no more
  night: {intensity: 75, distance: 17},  // in the dark it lights the field around it
  flash: {intensity: 140, distance: 13, seconds: .35}, // the bite of a phoenix hit
  fade: 7,                               // how fast it brightens and dims (1/s)
});

export function createPhoenixLight({scene, night = () => 0, camera = null} = {}) {
  const light = new THREE.PointLight(PHOENIX_LIGHT.color, 0, PHOENIX_LIGHT.day.distance, 2);
  light.name = 'PhoenixLight'; light.castShadow = false; light.userData.ignoreContact = true;
  scene.add(light);
  const target = new THREE.Vector3(), eye = new THREE.Vector3(), look = new THREE.Vector3(), candidate = new THREE.Vector3();
  let best = Infinity, strength = 0, has = false, flashAge = Infinity, clock = 0;
  const flashAt = new THREE.Vector3();

  // A phoenix offers itself each frame; the nearest one the player can see wins the light. A bird just off
  // screen would light ground the player can see while the bird they are watching stays dark, so birds
  // outside the middle of the view count as far further away.
  function offer(position, weight = 1) {
    if (weight <= .02) return;
    if (camera) { camera.getWorldPosition(eye); camera.getWorldDirection(look); } else { eye.set(0, 0, 0); look.set(0, 0, -1); }
    candidate.copy(position).sub(eye);
    const span = candidate.length(), facing = span > .01 ? candidate.dot(look) / span : 1;
    const d = span * span * (facing > .75 ? 1 : 12) / Math.max(.05, weight);
    if (d < best) { best = d; target.copy(position); strength = weight; has = true; }
  }
  // A phoenix hit: the light jumps to the wound and flares.
  function flash(position) {
    if (!Array.isArray(position)) return;
    flashAt.fromArray(position); flashAge = 0;
  }
  function update(dt) {
    clock += dt; flashAge += dt;
    const n = Math.min(1, Math.max(0, night() || 0)), D = PHOENIX_LIGHT.day, N = PHOENIX_LIGHT.night, F = PHOENIX_LIGHT.flash;
    let goal = 0, distance = D.distance + (N.distance - D.distance) * n;
    const flashing = flashAge < F.seconds;
    if (flashing) {
      // The flash wins over a bird in flight: the hit is the moment worth lighting.
      const k = 1 - flashAge / F.seconds;
      target.copy(flashAt);
      goal = F.intensity * (.35 + .65 * n) * k * k; distance = F.distance * (.6 + .4 * n);
    } else if (has) {
      // A living flame: two slow breaths and a fast flicker, bounded so it never strobes.
      const flicker = .86 + .08 * Math.sin(clock * 9.1) + .06 * Math.sin(clock * 23.3 + 1.7);
      goal = (D.intensity + (N.intensity - D.intensity) * n) * strength * flicker;
    }
    // The light sits exactly on its bird: an arrow covers most of a metre a frame, so any chase would trail
    // the glow visibly behind it. A hand-off to another bird jumps, but the intensity eases across it.
    if (flashing || has) light.position.copy(target);
    // Brighten quickly, fade a touch slower: the dark closes in behind the bird rather than snapping shut.
    const rate = goal > light.intensity ? PHOENIX_LIGHT.fade * 2.2 : PHOENIX_LIGHT.fade;
    light.intensity += (goal - light.intensity) * (1 - Math.exp(-rate * dt));
    if (light.intensity < .02 && !goal) light.intensity = 0;
    light.distance = distance;
    best = Infinity; has = false; strength = 0;
    return light.intensity;
  }
  function dispose() { light.removeFromParent(); light.dispose(); }
  return {light, offer, flash, update, dispose, stats: () => ({intensity: +light.intensity.toFixed(2), distance: +light.distance.toFixed(2), lights: 1})};
}
