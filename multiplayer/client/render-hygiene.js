// Render hygiene: global fixes for three.js behaviours that cost a lot every frame without changing the picture.
// Imported first by lobby.js so it is installed before any material exists.
import * as THREE from 'three';

// Transparent two-sided materials are drawn in TWO passes by three.js (back faces, then front faces). Each pass flips
// material.side and bumps material.version, so the renderer re-resolves the shader program twice per object per
// frame (rebuilding its cache-key string each time) and issues two draw calls. Effects that do not write depth
// (additive glows, rings, ribbons, cards: every transparent two-sided material in the game today) blend to the same
// picture in one pass, so they default to one. Evaluated at draw/compile time, so start-up warm-up compiles the same
// shader variant play uses. An explicit forceSinglePass assignment still wins.
export const SINGLE_PASS = {installed: false};
export function installSinglePassDefault() {
  if (SINGLE_PASS.installed) return; SINGLE_PASS.installed = true;
  Object.defineProperty(THREE.Material.prototype, 'forceSinglePass', {
    configurable: true,
    get() { return this._bfSinglePass ?? (this.transparent === true && this.depthWrite === false); },
    set(value) { this._bfSinglePass = value === true ? true : undefined; },
  });
}
installSinglePassDefault();

// three.js recomposes EVERY object's local matrix every frame (matrixAutoUpdate) and then, because composing marks
// the world matrix dirty, re-multiplies every world matrix below it. Most of the scene (keeps, towns, rocks, props)
// never moves, so that was thousands of matrix builds per frame for nothing. Compose only when position, rotation
// or scale actually changed since the last compose; moving things behave exactly as before, and anything that
// marks matrixWorldNeedsUpdate itself still updates. Objects that manage their own matrix already set
// matrixAutoUpdate = false and are untouched.
export const MATRIX_CACHE = {installed: false};
export function installMatrixDirtyCheck(Object3D = THREE.Object3D) {
  if (MATRIX_CACHE.installed) return; MATRIX_CACHE.installed = true;
  const compose = Object3D.prototype.updateMatrix;
  Object3D.prototype.updateMatrix = function updateMatrix() {
    const p = this.position, q = this.quaternion, s = this.scale;
    let c = this._bfTRS;
    if (c === undefined) c = this._bfTRS = new Float64Array(10).fill(NaN);
    else if (this.pivot == null && c[0] === p.x && c[1] === p.y && c[2] === p.z && c[3] === q._x && c[4] === q._y && c[5] === q._z && c[6] === q._w && c[7] === s.x && c[8] === s.y && c[9] === s.z) return;
    c[0] = p.x; c[1] = p.y; c[2] = p.z; c[3] = q._x; c[4] = q._y; c[5] = q._z; c[6] = q._w; c[7] = s.x; c[8] = s.y; c[9] = s.z;
    compose.call(this);
  };
}
installMatrixDirtyCheck();

// Opaque draw order. three.js sorts opaque draws purely front-to-back, so consecutive draws keep switching shader
// programs and materials, and every material switch re-uploads all of that material's uniforms. Sort by coarse
// distance band first (near / mid / far, so the big early-depth win of drawing near things first is kept), then by
// material, then front-to-back inside the material.
const band = z => z < .975 ? 0 : z < .9955 ? 1 : 2; // NDC depth: roughly < 4 m, < 20 m, beyond (near .05, far 180)
export function stateSortOpaque(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const za = band(a.z), zb = band(b.z); if (za !== zb) return za - zb;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
