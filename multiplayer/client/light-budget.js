// Point-light budget. three.js evaluates EVERY point light in the scene for EVERY lit pixel, whether the light is
// lit, dark (intensity 0) or 200 m away, and any change in the count recompiles every lit shader (a hitch). The game
// keeps nine or more pooled point lights in the scene (keep hearts, fires, phoenix, staff, Stormreel, lantern...),
// so each lit pixel paid for nine lights while usually one or two were doing anything.
//
// The real lights stay where their owners put them and keep all their settings; they are only moved to a layer the
// cameras never draw. A fixed handful of slot lights (always the same count, so no shader ever recompiles) copy the
// most important real lights each frame: brightness x reach, against distance from the viewer. A light that loses its
// slot fades out over a few frames while the new one fades in, so nothing pops.
import * as THREE from 'three';

export const LIGHT_BUDGET = Object.freeze({desktop: 4, phone: 3, xr: 3, hiddenLayer: 31, fadeRate: 10, rescanFrames: 30});

// Point lights created after the budget starts are born on the hidden layer, so a light added mid-play never
// changes the drawn light count (which would recompile shaders) even for the frames before the next rescan.
let bornHidden = false;
function hideNewPointLights() {
  if (bornHidden) return; bornHidden = true;
  Object.defineProperty(THREE.PointLight.prototype, 'layers', {configurable: true,
    get() { return undefined; },
    set(value) { value.set(LIGHT_BUDGET.hiddenLayer); Object.defineProperty(this, 'layers', {value, writable: true, configurable: true, enumerable: true}); }});
}

export function createLightBudget({scene, slots = LIGHT_BUDGET.desktop} = {}) {
  const slotLights = [], state = [];
  hideNewPointLights();
  for (let i = 0; i < slots; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 1, 2); l.layers.set(0); l.name = 'LightBudgetSlot' + i; l.castShadow = false; l.userData.lightBudgetSlot = true; l.userData.ignoreContact = true;
    scene.add(l); slotLights.push(l); state.push({source: null, weight: 0});
  }
  let sources = [], frame = 0;
  const pos = new THREE.Vector3(), eye = new THREE.Vector3(), stats = {slots, sources: 0, lit: 0, swaps: 0};
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function rescan() {
    const next = [];
    scene.traverse(o => { if (o.isPointLight && !o.userData.lightBudgetSlot && !o.castShadow) next.push(o); });
    for (const l of next) l.layers.set(LIGHT_BUDGET.hiddenLayer);
    sources = next; stats.sources = next.length;
  }
  function score(l) {
    if (!(l.intensity > 0) || !shown(l)) return 0;
    l.getWorldPosition(pos);
    const reach = l.distance > 0 ? l.distance : 30, gap = Math.max(0, pos.distanceTo(eye) - reach);
    if (gap > 70) return 0; // beyond the haze: nothing it lights can be seen
    return l.intensity * reach * reach / (reach * reach + 4 * gap * gap);
  }
  // Allocation-free: fixed scratch arrays, insertion sort over a dozen lights.
  const best = new Array(slots).fill(null), bestScore = new Float64Array(slots);
  const wanted = l => { for (let k = 0; k < slots; k++) if (best[k] === l) return true; return false; };
  const held = l => { for (const s of state) if (s.source === l) return true; return false; };
  function update(camera, dt = 1 / 60) {
    if (frame++ % LIGHT_BUDGET.rescanFrames === 0) rescan();
    camera.getWorldPosition(eye);
    best.fill(null); bestScore.fill(0);
    for (const l of sources) {
      const v = score(l); if (!(v > 0) || v <= bestScore[slots - 1]) continue;
      let k = slots - 1; while (k > 0 && bestScore[k - 1] < v) { best[k] = best[k - 1]; bestScore[k] = bestScore[k - 1]; k--; }
      best[k] = l; bestScore[k] = v;
    }
    const fade = Math.min(1, dt * LIGHT_BUDGET.fadeRate); let lit = 0;
    for (let i = 0; i < slots; i++) {
      const s = state[i];
      if (s.source && wanted(s.source)) s.weight = Math.min(1, s.weight + fade); // still wanted: keep (and finish fading in)
      else if (s.source) { s.weight = Math.max(0, s.weight - fade); if (s.weight === 0) s.source = null; } // fade out first
      if (!s.source) for (let k = 0; k < slots; k++) { const l = best[k]; if (l && !held(l)) { s.source = l; s.weight = fade; stats.swaps++; break; } }
      const out = slotLights[i], src = s.source;
      if (!src) { out.intensity = 0; continue; }
      lit++; src.getWorldPosition(out.position); out.color.copy(src.color); out.distance = src.distance; out.decay = src.decay;
      out.intensity = src.intensity * s.weight;
    }
    stats.lit = lit;
  }
  rescan();
  return {update, rescan, slots: slotLights, stats: () => ({...stats})};
}
