// The Stormreel strike is so bright the world around it goes dark (Mitch, 2026-10-10: "darkens the surrounding area by
// default of how bright it is"). Presentation only. Two layers, both brief:
//  - the tone-mapping exposure dips, so lit surfaces dim while every lightning material (drawn untonemapped) stays white-hot;
//  - a dark veil over the screen with a clear round window on the arc, following it on screen every frame, so the
//    sky and anything not tone mapped darken too. The HUD sits above it.
import * as THREE from 'three';

export function createStormDarken({camera, renderer, root = globalThis.document?.body, reduced = false} = {}) {
  let dark = 0, hold = 0, exposure = null, el = null;
  const at = new THREE.Vector3(), p = new THREE.Vector3();
  function veil() {
    if (el || !root) return el;
    el = document.createElement('div'); el.className = 'storm-darken';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0';
    root.appendChild(el); return el;
  }
  return {
    /** k 0..1 at the strike's world position (Vector3); fades with distance but never to nothing within sight. */
    hit(k, where, from) {
      const d = where && from ? Math.hypot(where.x - from.x, where.z - from.z) : 0;
      const f = k * Math.max(.3, 1 - d / 140) * (reduced ? .45 : 1);
      if (f > dark) { dark = f; hold = .16; if (where) at.copy(where); }
    },
    update(dt) {
      if (dark > .001) {
        if (exposure === null) exposure = renderer.toneMappingExposure;
        renderer.toneMappingExposure = exposure * (1 - .6 * Math.min(1, dark));
        if (hold > 0) hold -= dt; else dark = Math.max(0, dark - dt * (.6 + dark * .9));
        const v = veil();
        if (v) {
          p.copy(at).project(camera); const behind = p.z > 1, x = behind ? 50 : (p.x * .5 + .5) * 100, y = behind ? 50 : (.5 - p.y * .5) * 100;
          v.style.background = `radial-gradient(circle 34vmin at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(4,8,22,0) 0%, rgba(4,8,22,.15) 35%, rgba(4,8,22,.88) 100%)`;
          v.style.opacity = String(Math.min(1, dark));
        }
      } else if (exposure !== null) { renderer.toneMappingExposure = exposure; exposure = null; dark = 0; if (el) el.style.opacity = '0'; }
    },
    level: () => dark,
  };
}
