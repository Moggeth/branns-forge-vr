// Expedition Roguelite in the world: a beacon of light over the chosen destination (dim beacons over the open route
// choices while the party votes), a ground ring that marks where a fight starts or the ward circle to hold (filling
// as it is held), and the crowned Heart guardian. Phone- and Quest-safe: one shared material per look, at most four
// beacons, no lights; everything animates from the render clock every frame.
import * as THREE from 'three';
import {NODE_KINDS, RUN_TUNING, routeChoices} from '../shared/expedition-run.js';

export const RUN_KIND_COLOR = Object.freeze({skirmish: 0xffb35a, elite: 0xff6a4a, treasure: 0x8fd0ff, hold: 0x8fe08a, shrine: 0xffe08a, underways: 0xb98cff, heart: 0xff4f6d});
const BEAM_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const BEAM_FS = `uniform vec3 uColor; uniform float uT; uniform float uAlpha; varying vec2 vUv;
void main(){ float edge=pow(1.0-abs(vUv.x*2.0-1.0),1.6); float fall=pow(1.0-vUv.y,1.4);
 float bands=.65+.35*sin(vUv.y*28.0-uT*3.0); float a=edge*fall*bands*uAlpha; gl_FragColor=vec4(uColor*(1.2+.8*fall),a); }`;
const RING_FS = `uniform vec3 uColor; uniform float uT; uniform float uAlpha; uniform float uFill; varying vec2 vUv;
void main(){ float ang=vUv.x; float dash=step(.45,fract(ang*36.0+uT*.6)); float filled=step(ang,uFill);
 float a=mix(.35+.4*dash,1.0,filled)*uAlpha*(1.0-abs(vUv.y*2.0-1.0)); gl_FragColor=vec4(mix(uColor,vec3(1.0,.95,.8),filled*.35)*1.4,a); }`;

function beamMaterial(color, alpha, T) {
  return new THREE.ShaderMaterial({uniforms: {uColor: {value: new THREE.Color(color)}, uT: T, uAlpha: {value: alpha}}, vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false});
}

export function createRunPresentation({scene, height = () => 0}) {
  const T = {value: 0}, root = new THREE.Group(); root.name = 'RunPresentation'; scene.add(root);
  const beamGeo = new THREE.CylinderGeometry(.9, 1.4, 26, 20, 1, true).translate(0, 13, 0);
  const mats = new Map(), dims = new Map();
  const mat = (kind, dim) => { const m = dim ? dims : mats; if (!m.has(kind)) m.set(kind, beamMaterial(RUN_KIND_COLOR[kind] || 0xffb35a, dim ? .28 : .9, T)); return m.get(kind); };
  const beams = Array.from({length: 4}, () => { const b = new THREE.Mesh(beamGeo, mat('skirmish')); b.visible = false; b.frustumCulled = false; b.renderOrder = 3; root.add(b); return b; });
  // A thin ring laid on the ground (radius 1, scaled per use), uv.x runs around it for dashes and the hold fill.
  const ringGeo = new THREE.RingGeometry(.94, 1.06, 96, 1);
  { const uv = ringGeo.attributes.uv, pos = ringGeo.attributes.position; for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - .94) / .12); } }
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.ShaderMaterial({uniforms: {uColor: {value: new THREE.Color(0xffb35a)}, uT: T, uAlpha: {value: 0}, uFill: {value: 0}}, vertexShader: BEAM_VS, fragmentShader: RING_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2});
  // The ring hugs uneven ground: each vertex is lifted to the terrain under it when the ring moves.
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.visible = false; ring.renderOrder = 3; root.add(ring);
  const ringBase = ringGeo.attributes.position.array.slice();
  let run = null, fade = 0, ringKey = '';

  function conformRing(x, z, r) {
    const key = `${x},${z},${r}`; if (key === ringKey) return; ringKey = key;
    const pos = ringGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const px = ringBase[i * 3] * r, pz = ringBase[i * 3 + 2] * r; pos.setXYZ(i, px, height(x + px, z + pz) - height(x, z) + .08, pz); }
    pos.needsUpdate = true; ringGeo.computeBoundingSphere();
  }
  return {
    setRun(next) { run = next || null; },
    update(now, dt) {
      T.value = now / 1000;
      for (const b of beams) b.visible = false;
      ring.visible = false;
      if (!run) return;
      const stage = run.stage, target = run.nodes.find(n => n.id === run.target);
      let used = 0;
      const place = (n, dim) => { if (used >= beams.length) return; const b = beams[used++]; b.material = mat(n.kind, dim); b.position.set(n.x, height(n.x, n.z) - .2, n.z); b.scale.setScalar(n.kind === 'heart' ? 1.5 : dim ? .7 : 1); b.visible = true; };
      if (stage === 'route' || stage === 'camp') for (const id of stage === 'camp' ? run.nodes.filter(n => n.tier === 0).map(n => n.id) : routeChoices(run)) { const n = run.nodes.find(q => q.id === id); if (n) place(n, true); }
      if ((stage === 'travel' || stage === 'fight') && target) {
        place(target, false);
        const hold = stage === 'fight' && target.kind === 'hold', r = hold ? RUN_TUNING.holdRadius : RUN_TUNING.arrive;
        if (stage === 'travel' || hold) {
          fade = Math.min(1, fade + dt * 2);
          conformRing(target.x, target.z, r); ring.position.set(target.x, height(target.x, target.z), target.z); ring.scale.set(r, 1, r);
          ringMat.uniforms.uColor.value.setHex(RUN_KIND_COLOR[target.kind] || 0xffb35a); ringMat.uniforms.uAlpha.value = .85 * fade;
          ringMat.uniforms.uFill.value = hold && run.objective.need ? run.objective.have / run.objective.need : 0;
          ring.visible = true;
        }
      } else fade = 0;
    },
    dispose() { scene.remove(root); beamGeo.dispose(); ringGeo.dispose(); ringMat.dispose(); for (const m of [...mats.values(), ...dims.values()]) m.dispose(); },
  };
}

// ---- The crowned Heart guardian ----
const crownMat = new THREE.MeshStandardMaterial({color: 0xffd27a, emissive: 0xff8a2a, emissiveIntensity: 1.6, metalness: .6, roughness: .3, flatShading: true});
const gemMat = new THREE.MeshStandardMaterial({color: 0xff6a8a, emissive: 0xff3a5a, emissiveIntensity: 2.2, roughness: .2, flatShading: true});
let crownGeo = null, gemGeo = null;
function crownGeometry() {
  if (crownGeo) return crownGeo;
  // A band of seven tall facets, alternating heights, like a crown hammered from star-iron.
  const parts = [];
  const band = new THREE.CylinderGeometry(.5, .56, .16, 14, 1, true); parts.push(band);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, tall = i % 2 ? .42 : .62, spike = new THREE.ConeGeometry(.11, tall, 4);
    spike.translate(0, .08 + tall / 2, 0); spike.rotateY(a); spike.translate(Math.cos(a) * .5, 0, Math.sin(a) * .5); parts.push(spike);
  }
  const merged = mergeSimple(parts); for (const g of parts) g.dispose();
  crownGeo = merged; gemGeo = new THREE.OctahedronGeometry(.12, 0);
  return crownGeo;
}
function mergeSimple(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g), count = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3); let o = 0;
  for (const g of geos) { g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  for (const g of geos) if (!list.includes(g)) g.dispose();
  return out;
}
/** Crowns a golem model (the Meteor Colossus): a star-iron crown and a glowing gem riding its Head node. */
export function dressBoss(model) {
  const head = model.getObjectByName('Head'), mesh = model.getObjectByName('HeadMesh');
  if (!head || model.userData.bossCrown) return false;
  const crown = new THREE.Group(); crown.name = 'BossCrown';
  const band = new THREE.Mesh(crownGeometry(), crownMat), gem = new THREE.Mesh(gemGeo, gemMat);
  gem.position.set(0, .2, .55); band.castShadow = false; for (const m of [band, gem]) m.userData.ignoreContact = true;
  crown.add(band, gem);
  // Fit the crown to the head: sit it on top of the head mesh, a little wider than the skull.
  let top = .5, width = .5;
  if (mesh?.geometry) { mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix); top = box.max.y; width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * .55; }
  crown.position.set(0, top - width * .12, 0); crown.scale.setScalar(width / .5);
  crown.userData.ignoreContact = true; crown.traverse(o => { o.userData.ignoreContact = true; o.raycast = () => {}; });
  head.add(crown); model.userData.bossCrown = crown;
  return true;
}
