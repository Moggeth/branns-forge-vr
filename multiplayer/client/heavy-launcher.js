// Heavy Launcher presentation: the Blender-built spring catapult (assets-source/heavy-launcher), animated
// every frame from the structure's fire and reload clocks. Pure presentation: no gameplay state lives here.
//
// The mechanism, as modelled and printed: two spiral mainsprings drive the arm; the cocking yoke presses it
// down until the nose clicks under the sear leaf; loosing whips the arm up into the yoke's finger bar, which
// drops its handle onto the buffer leaf. Angles below come from the builder's contract.json.
import * as THREE from 'three';

export const HEAVY_LAUNCHER = Object.freeze({
  cock: -0.6108652381980153,      // arm angle when latched (0 = pointing straight back, + = tip rising)
  stop: 0.8726646259971648,       // arm angle against the yoke's finger bar
  yokeRest: 1.0286452564241888,   // yoke angle resting on the buffer
  yokeOffset: 0.15598063042702404,// finger bar rides this far above the arm
  windKeys: 4,                    // spring morph targets, evenly spaced across the swing
  release: [0, 2.5805885013378975, 0.21552191387488176], // stone's centre at the stop, model space
  swing: 0.085,                   // seconds from loosing to the slam
});
const SWING = HEAVY_LAUNCHER.stop - HEAVY_LAUNCHER.cock;
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => t * t * (3 - 2 * t);

// Arm, yoke, sear and stone pose at one moment of the cycle. fireAge in seconds since loosing (Infinity if
// never), progress 0..1 through the reload (1 = cocked and loaded).
export function heavyLauncherPose(fireAge, progress) {
  const H = HEAVY_LAUNCHER, p = clamp01(progress);
  let arm = H.cock, yoke = H.yokeRest, sear = 0, stone = 1, drop = 0, buffer = 0;
  if (p < 1 && fireAge < 60) {
    if (fireAge < H.swing) {                                   // loosed: springs accelerate the arm
      const t = fireAge / H.swing; arm = H.cock + SWING * t * t; sear = 1; stone = 1;
    } else {
      const a = fireAge - H.swing;
      const bounce = Math.exp(-a * 9) * Math.abs(Math.sin(a * 34)) * 0.07;   // slam rings through yoke and buffer
      arm = H.stop + bounce; yoke = H.yokeRest + bounce; buffer = bounce / 0.07;
      sear = clamp01(1 - (fireAge - 0.25) / 0.2); stone = 0;
      if (p > 0.12 && p <= 0.62) {                             // the yoke lifts and drives the arm down
        const u = ease((p - 0.12) / 0.5);
        yoke = H.yokeRest - (H.yokeRest - (H.cock + H.yokeOffset)) * u; arm = Math.min(arm, yoke - H.yokeOffset);
      } else if (p > 0.62) {                                    // latched; yoke falls back onto its buffer
        arm = H.cock;
        const click = p < 0.66 ? (p - 0.62) / 0.04 : 1;
        sear = p < 0.66 ? Math.sin(click * Math.PI) * 0.6 : 0;
        const f = clamp01((p - 0.66) / 0.18), fall = f * f;
        yoke = H.cock + H.yokeOffset + (H.yokeRest - H.cock - H.yokeOffset) * fall;
        if (f >= 1) { const b = (p - 0.84) * 6; yoke = H.yokeRest + Math.exp(-b * 8) * Math.abs(Math.sin(b * 22)) * 0.04; buffer = (yoke - H.yokeRest) / 0.07; }
        if (p > 0.8) { const s = clamp01((p - 0.8) / 0.16); stone = 1; drop = (1 - s) * (1 - s); }
      }
    }
  }
  return { arm, yoke, sear, stone, drop, buffer, wind: clamp01((H.stop - arm) / SWING) };
}

export function createHeavyLauncher(gltf, { castShadow = false } = {}) {
  const object = gltf.scene.clone(true);
  const nodes = {};
  object.traverse(n => { if (n.name) nodes[n.name] = n; if (n.isMesh) { n.castShadow = castShadow; n.receiveShadow = true; } });
  const springs = [];
  for (const name of ['Cassette_L', 'Cassette_R']) nodes[name]?.traverse(n => { if (n.morphTargetInfluences) springs.push(n); });
  const ballHome = nodes.Ball.position.clone();
  // Crystal materials are cloned per launcher so each one glows with its own spring tension.
  const glow = [], swap = new Map();
  object.traverse(n => { if (!n.isMesh || !(n.material?.emissiveIntensity > 0)) return; if (!swap.has(n.material)) { const c = n.material.clone(); swap.set(n.material, c); glow.push(c); } n.material = swap.get(n.material); });
  const glowBase = glow.map(m => m.emissiveIntensity);
  let last = null;

  function animate({ time = 0, fireAge = Infinity, progress = 1, active = true } = {}) {
    const P = heavyLauncherPose(fireAge, progress);
    nodes.Arm.rotation.x = -P.arm;
    nodes.Yoke.rotation.x = -P.yoke;
    nodes.Sear.rotation.y = -P.sear * 0.11;                // leaf flexes outward (+X) off the nose
    nodes.Buffer.scale.y = 1 - Math.min(1, P.buffer) * 0.18;
    nodes.Ball.visible = P.stone > 0;
    nodes.Ball.position.copy(ballHome); nodes.Ball.position.y += P.drop * 1.6;   // drops into the cup on reload
    nodes.Ball.rotation.x = P.drop * 5;
    // spring coils: blend the two nearest wind keys (piecewise linear between exact windings)
    const s = P.wind * HEAVY_LAUNCHER.windKeys, i = Math.min(HEAVY_LAUNCHER.windKeys - 1, Math.floor(s)), f = s - i;
    if (last !== s) {
      for (const m of springs) { const w = m.morphTargetInfluences; w.fill(0); if (i === 0) w[0] = f; else { w[i - 1] = 1 - f; w[i] = f; } }
      last = s;
    }
    // resonance crystals brighten as the springs take up tension
    const k = active ? 0.55 + 0.45 * P.wind + 0.08 * Math.sin(time * 2.3) : 0.15;
    glow.forEach((m, j) => { m.emissiveIntensity = glowBase[j] * k; });
    return P;
  }

  // World position of the stone at the moment it leaves the cup.
  function releasePoint(out = new THREE.Vector3()) {
    object.updateWorldMatrix(true, false);
    return out.fromArray(HEAVY_LAUNCHER.release).applyMatrix4(object.matrixWorld);
  }

  animate();
  return { object, nodes, animate, releasePoint, dispose() { object.removeFromParent(); for (const m of glow) m.dispose(); } };
}
