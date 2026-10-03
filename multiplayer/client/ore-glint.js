// Ore glint: the subtle sparkle that lets players spot mountain-foot veins (shared/ore-veins.js) from across the
// Orchard. Each live vein gets a soft breathing glow in its ore's colour plus a few star-shaped sparkles that flash
// in turn on its surface. Presentation only: one additive Points draw, no lights, no raycast, no collision.
// Close up the glow fades back so the authored rock reads; far away a minimum pixel size keeps it findable.
import * as THREE from 'three';

export const ORE_GLINT_VERSION = 1;
const SPARKS = 6, PER = SPARKS + 1;
export const GLINT_COLORS = Object.freeze({
  copper: [1, .6, .36], iron: [1, .72, .5], gold: [1, .84, .38], mithril: [.58, .94, 1], star: [1, .7, .3],
  crystal: [.8, .6, 1], meteor: [1, .7, .3],
});

function hash(i, seed) {
  let h = (Math.imul((i + 4096) >>> 0, 0x8da6b343) ^ Math.imul((seed + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}
const idSeed = id => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };

export function createOreGlint({scene, renderer = null, height = () => 0, capacity = 16} = {}) {
  if (!scene) throw new Error('createOreGlint requires scene');
  const n = capacity * PER, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), meta = new Float32Array(n * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('glint', new THREE.BufferAttribute(meta, 2)); // x: phase seed, y: 1 = glow, 0 = sparkle
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = {uTime: {value: 0}, uPx: {value: 600}};
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec3 color; attribute vec2 glint; uniform float uTime, uPx;
      varying vec3 vColor; varying float vAlpha, vGlow;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0); float dist = max(.1, -mv.z);
        vColor = color; vGlow = glint.y;
        float near = smoothstep(4.0, 16.0, dist); // close up the rock itself carries the read
        if (glint.y > .5) {
          float breathe = .75 + .25 * sin(uTime * 1.7 + glint.x * 6.283);
          gl_PointSize = clamp(max(2.2 * uPx / dist, 16.0), 0.0, 128.0);
          vAlpha = (.08 + .34 * near) * breathe;
        } else {
          float cycle = fract(uTime * (.42 + .16 * fract(glint.x * 7.3)) + glint.x);
          float flash = pow(max(0.0, 1.0 - abs(cycle - .5) * 9.0), 2.0); // brief star flashes, one at a time
          gl_PointSize = clamp(max(.34 * uPx / dist, 8.0) * (.4 + .6 * flash), 0.0, 64.0);
          vAlpha = flash * (.55 + .45 * near);
        }
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vAlpha, vGlow;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
        float a;
        if (vGlow > .5) a = exp(-r * r * 4.5);
        else { vec2 q = abs(p); a = exp(-r * 9.0) + exp(-q.x * 22.0) * exp(-q.y * 2.6) + exp(-q.y * 22.0) * exp(-q.x * 2.6); }
        a *= vAlpha * (1.0 - smoothstep(.85, 1.0, r));
        if (a < .004) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), vGlow > .5 ? .1 : .45), a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'ore-glint'; points.frustumCulled = false; points.renderOrder = 5; points.raycast = () => {};
  scene.add(points);
  let key = '', count = 0;
  const size = new THREE.Vector2();
  function sync(snapshot) {
    const veins = (snapshot?.deposits || []).filter(d => Number.isInteger(d.vein) && !d.depleted).slice(0, capacity);
    const next = veins.map(d => d.id + ':' + d.hits).join('|') + '#' + (snapshot?.edits?.length || 0);
    if (next === key) return false;
    key = next; count = veins.length;
    veins.forEach((d, v) => {
      const s = idSeed(d.id), y = height(d.x, d.z), c = GLINT_COLORS[d.kind] || [1, 1, 1];
      for (let k = 0; k < PER; k++) {
        const i = v * PER + k, glow = k === SPARKS;
        const a = hash(k, s) * Math.PI * 2, up = .25 + .75 * hash(k, s + 1), r = glow ? 0 : .45 + .2 * hash(k, s + 2);
        pos[i * 3] = d.x + Math.cos(a) * r * Math.sqrt(1 - up * up * .6); pos[i * 3 + 1] = y + (glow ? .9 : .15 + up * .9); pos[i * 3 + 2] = d.z + Math.sin(a) * r * Math.sqrt(1 - up * up * .6);
        col.set(c, i * 3); meta[i * 2] = hash(k, s + 3); meta[i * 2 + 1] = glow ? 1 : 0;
      }
    });
    geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = geometry.attributes.glint.needsUpdate = true;
    geometry.setDrawRange(0, count * PER);
    return true;
  }
  return {
    points, sync,
    update(dt, camera) {
      uniforms.uTime.value += Math.min(.1, Math.max(0, dt || 0));
      if (renderer && camera?.projectionMatrix) { renderer.getDrawingBufferSize(size); uniforms.uPx.value = camera.projectionMatrix.elements[5] * size.y * .5; }
    },
    stats: () => ({version: ORE_GLINT_VERSION, draws: count ? 1 : 0, veins: count, points: count * PER}),
    dispose() { scene.remove(points); geometry.dispose(); material.dispose(); },
  };
}
