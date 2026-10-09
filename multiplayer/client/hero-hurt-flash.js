import * as THREE from 'three';

// A struck remote Hero flashes: a warm crimson rim of light hugs the body and fades in about a third of a second.
// Drawn as an additive skinned shell that shares the body's geometry and skeleton, so it follows every pose and
// costs nothing while hidden. One small material per Hero (the body materials are shared per palette).

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main(){
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = normalize(transformedNormal); vV = normalize(-mvPosition.xyz);
}`;
const FRAG = /* glsl */`
uniform float uFlash;
varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - max(0.0, dot(normalize(vN), normalize(vV)));
  float rim = .22 + 1.1 * f * f;
  gl_FragColor = vec4(vec3(1.0, .26, .16) * rim * uFlash, 1.0);
}`;

export const HERO_HURT_FLASH = Object.freeze({length: .34, peak: .85});

/** Lazily builds the shell for `meshes` (SkinnedMesh list). Returns {strike(), update(dt), dispose()}. */
export function createHeroHurtFlash(meshes) {
  let shells = null, material = null, t = Infinity;
  function build() {
    material = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, uniforms: {uFlash: {value: 0}},
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false});
    shells = [];
    for (const src of meshes) {
      if (!src?.isSkinnedMesh || !src.parent) continue;
      const shell = new THREE.SkinnedMesh(src.geometry, material);
      shell.name = `${src.name}_HurtFlash`; shell.bindMode = src.bindMode;
      shell.bind(src.skeleton, src.bindMatrix);
      shell.position.copy(src.position); shell.quaternion.copy(src.quaternion); shell.scale.copy(src.scale);
      shell.frustumCulled = false; shell.renderOrder = 2; shell.visible = false;
      src.parent.add(shell); shells.push([src, shell]);
    }
  }
  return {
    strike() { if (!shells) build(); t = 0; },
    update(dt) {
      if (!shells || t === Infinity) return;
      t += dt;
      const k = t / HERO_HURT_FLASH.length, on = k < 1;
      material.uniforms.uFlash.value = on ? HERO_HURT_FLASH.peak * Math.min(1, t / .03) * (1 - k) ** 2 : 0;
      for (const [src, shell] of shells) shell.visible = on && src.visible;
      if (!on) t = Infinity;
    },
    dispose() { if (!shells) return; for (const [, shell] of shells) shell.removeFromParent(); material.dispose(); shells = null; },
  };
}
