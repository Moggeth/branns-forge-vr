// The Underways' surface entrances: a timbered mine portal set into the hillside, its lanterns, rails running out of
// the dark and a weathered sign with the mine's name. Presentation only (the mouth's rule is shared/underways/rules.js).
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {underwayKit} from './props.js';

const rng = seed => { let s = seed >>> 0 || 1; return () => (s = Math.imul(s ^ s >>> 15, 0x2c1b3c6d) + 0x6d2b79f5 >>> 0, (s >>> 8) / 16777216); };
function colored(geo, color, glow = 0, jitter = 0, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3), gl = new Float32Array(n), pl = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = jitter ? 1 + ((Math.imul(Math.floor(i / 3) + seed * 77, 2654435761) >>> 0) % 1000 / 1000 - .5) * jitter : 1; c[i * 3] = color[0] * k; c[i * 3 + 1] = color[1] * k; c[i * 3 + 2] = color[2] * k; gl[i] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1)); g.setAttribute('aPropLight', new THREE.BufferAttribute(pl, 3));
  return g;
}
function frameGeometry() {
  const T = [.43, .28, .16], D = [.3, .19, .1], parts = [];
  const beam = (w, h, d, x, y, z, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateZ(rz); g.translate(x, y, z); parts.push(colored(g, T, 0, .14, x * 10 + y)); const c = new THREE.BoxGeometry(w * .88, h * 1.004, d * .88); c.rotateZ(rz); c.translate(x, y, z); parts.push(colored(c, D)); };
  beam(.42, 3.4, .42, -1.45, 1.7, 0); beam(.42, 3.4, .42, 1.45, 1.7, 0); // posts
  beam(3.7, .46, .5, 0, 3.4, 0); beam(3.2, .26, .3, 0, 3.0, .12);         // lintel and under-beam
  beam(.24, 1.1, .28, -1.05, 2.75, .1, -.75); beam(.24, 1.1, .28, 1.05, 2.75, .1, .75); // knee braces
  // Name board on the lintel: brass-edged plank with carved letters picked out in light.
  const board = new THREE.BoxGeometry(2.3, .5, .08); board.translate(0, 3.42, .3); parts.push(colored(board, [.5, .34, .18], 0, .1));
  const rim = new THREE.BoxGeometry(2.42, .58, .05); rim.translate(0, 3.42, .27); parts.push(colored(rim, [.78, .58, .26]));
  const r = rng(5);
  for (let k = 0; k < 11; k++) { const g = new THREE.BoxGeometry(.11 + r() * .06, .22, .02); g.translate(-.9 + k * .18, 3.42, .345); parts.push(colored(g, [1, .85, .55], .55)); }
  // Iron hanging hooks and two lanterns either side of the mouth.
  const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)); g.computeVertexNormals(); return g;
}
function rockCollar(seed) {
  // Boulders and slabs piled round the frame so the portal sits in the hill (the terrain carries on behind them).
  const r = rng(seed), parts = [], rock = [[.46, .4, .34], [.38, .33, .29], [.52, .46, .39]];
  const place = (x, y, z, s, sy = .8) => { const g = new THREE.DodecahedronGeometry(s, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const n = 1 + (r() - .5) * .22; p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * sy, p.getZ(i) * n); } g.rotateY(r() * 6); g.translate(x, y, z); parts.push(colored(g, rock[Math.floor(r() * 3)], 0, .22, Math.floor(x * 10 + y))); };
  for (const side of [-1, 1]) {
    place(side * 2.35, .55, -.25, .95, .9); place(side * 2.15, 1.75, -.5, .8); place(side * 2.6, 2.7, -.9, .95); place(side * 3.3, .7, -.8, .9, .75); place(side * 2.0, 3.45, -.6, .75);
  }
  place(0, 4.15, -.85, 1.25, .6); place(-1.1, 3.95, -.9, .9, .7); place(1.15, 4.0, -1.0, .95, .7);
  const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)); g.computeVertexNormals(); return g;
}
// The dark of the tunnel: a gradient that is deepest at the centre and carries a faint warm lamp-glow from inside.
const mouthMaterial = () => new THREE.ShaderMaterial({
  uniforms: {uTime: {value: 0}},
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `varying vec2 vUv; uniform float uTime;
    void main(){ vec2 p=vUv-vec2(.5,.38); float d=length(p*vec2(1.0,1.25));
      vec3 col=mix(vec3(.11,.08,.06),vec3(.012,.01,.012),smoothstep(.05,.42,1.0-d)*.9+.1);
      float glow=exp(-pow(length((vUv-vec2(.5,.16))*vec2(1.8,4.0)),2.0)*2.0)*(.85+.15*sin(uTime*2.3));
      col+=vec3(1.0,.62,.3)*glow*.16; gl_FragColor=vec4(col,1.0);
      #include <colorspace_fragment>
    }`,
});

export function createUnderwayPortal({scene, sites = [], height = null, propMat}) {
  const kit = underwayKit(), group = new THREE.Group(); group.name = 'UnderwayPortals'; scene.add(group);
  const frame = frameGeometry(), mats = [], made = [];
  for (const s of sites) {
    const y = height ? height(s.mouth[0], s.mouth[1]) : s.y, g = new THREE.Group();
    g.position.set(s.mouth[0], y, s.mouth[1]); g.rotation.y = s.yaw; // local -z leads into the hill
    const f = new THREE.Mesh(frame, propMat); f.position.z = -.25; g.add(f);
    const collar = new THREE.Mesh(rockCollar(s.id.length * 13 + 7), propMat); collar.position.z = -.25; g.add(collar);
    const mm = mouthMaterial(); mats.push(mm);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 3.15), mm); mouth.position.set(0, 1.55, -.3); g.add(mouth);
    const lit = geo => { const c = geo.clone(); const n = c.attributes.position.count; c.setAttribute('aPropLight', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return c; };
    for (const side of [-1, 1]) { const l = new THREE.Mesh(lit(kit.lantern), propMat); l.position.set(side * 1.95, -.05, .05); l.rotation.y = side * .5 + Math.PI; l.scale.setScalar(.85); g.add(l); }
    for (let k = 0; k < 3; k++) { const rl = new THREE.Mesh(lit(kit.rails), propMat); rl.position.set(0, -.02 + (height ? height(s.mouth[0], s.mouth[1] + k * 2 + .7) - y : 0) * .9, k * 2 + .7); g.add(rl); }
    const cart = new THREE.Mesh(lit(kit.cart), propMat); cart.position.set(2.3, height ? height(s.mouth[0] + 2.3, s.mouth[1] + 2.8) - y : 0, 2.8); cart.rotation.y = .35; g.add(cart);
    const sign = new THREE.Mesh(lit(kit.sign), propMat); sign.position.set(-2.6, height ? height(s.mouth[0] - 2.6, s.mouth[1] + 2.2) - y : 0, 2.2); sign.rotation.y = Math.PI + .5; g.add(sign);
    g.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.userData.presentationOnly = true; o.castShadow = true; o.receiveShadow = true; } });
    mouth.castShadow = false;
    group.add(g); made.push({s, g});
  }
  let time = 0;
  return {
    update(dt, {inside = false} = {}) { time += dt; for (const m of mats) m.uniforms.uTime.value = time; group.visible = !inside; },
    stats: () => ({portals: made.length}),
    dispose() { scene.remove(group); frame.dispose(); for (const m of mats) m.dispose(); group.traverse(o => { if (o.isMesh && o.geometry !== frame) o.geometry.dispose(); }); },
  };
}
