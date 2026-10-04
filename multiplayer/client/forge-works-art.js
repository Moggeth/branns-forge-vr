// Brann's Forge — the Forge works: smelting furnace, output chute and the bar output bay.
// Authored procedurally for the browser (Quest-safe: no lights, a handful of draw calls, shared materials).
// +Y up, metres. The group sits at the furnace centre (world 2.5, 0); the bay is centred on +X so it lands on
// OUTPUT_BAY (shared/inventions.js). The furnace mouth and both signs face +Z, towards where Heroes arrive.
// Presentation only: it reads authoritative jobs and bay stacks and never changes state.
import * as THREE from 'three';
import {OUTPUT_BAY} from '../shared/inventions.js';

const FURNACE_AT = [2.5, 0];
export const FORGE_WORKS_ORIGIN = Object.freeze(FURNACE_AT);
const BAY_X = OUTPUT_BAY.x0 + OUTPUT_BAY.step * (OUTPUT_BAY.order.length - 1) / 2 - FURNACE_AT[0], BAY_Z = OUTPUT_BAY.z - FURNACE_AT[1];
export const BAY_SIGIL = Object.freeze({iron: 0xcfd8de, mithril: 0x5fe6ff, starMetal: 0xffa63a, copper: 0xff8a52, gold: 0xffd24a});

function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// Coursed stone: every triangle takes the colour of the block its centroid falls in, mortar where it nears a joint.
function paintCourses(geo, {course = .17, blocks = 11, base = [.5, .45, .39], spread = .12, mortar = .55, soot = 0} = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, col = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const m = a.add(b).add(c).multiplyScalar(1 / 3), row = Math.floor(m.y / course), fy = m.y / course - row;
    const ang = (Math.atan2(m.z, m.x) / (Math.PI * 2) + 1) * blocks + row * .5, cell = Math.floor(ang), fx = ang - cell;
    const joint = fy < .1 || fx < .05 || fx > .95, h = hash(row * 31 + cell), t = (h - .5) * spread;
    let k = joint ? mortar : 1;
    const dark = soot ? Math.max(0, 1 - Math.hypot(m.x, m.z + .6) / .7) * soot * (m.y < 1 ? 1 : .3) : 0;
    k *= 1 - dark;
    for (let v = 0; v < 3; v++) { col[(i + v) * 3] = (base[0] + t) * k; col[(i + v) * 3 + 1] = (base[1] + t * .9) * k; col[(i + v) * 3 + 2] = (base[2] + t * .8) * k; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}

function signTexture(lines, accent) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
  const g = canvas.getContext('2d'); if (!g) return null;
  const wood = g.createLinearGradient(0, 0, 0, 160); wood.addColorStop(0, '#5b3a1f'); wood.addColorStop(1, '#3d2614');
  g.fillStyle = wood; g.fillRect(0, 0, 512, 160);
  g.globalAlpha = .18; g.strokeStyle = '#1d1209'; g.lineWidth = 2;
  for (let y = 12; y < 160; y += 17) { g.beginPath(); g.moveTo(0, y + Math.sin(y) * 3); g.bezierCurveTo(170, y - 6, 340, y + 6, 512, y - 2); g.stroke(); }
  g.globalAlpha = 1; g.strokeStyle = '#c9993f'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 62px Georgia, serif'; g.fillStyle = '#1a0f07'; g.fillText(lines[0], 258, 62);
  g.fillStyle = accent; g.fillText(lines[0], 256, 59);
  g.font = '600 28px Georgia, serif'; g.fillStyle = '#f2e6cd'; g.fillText(lines[1], 256, 118);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}

export function createForgeWorks() {
  const disposables = [];
  const own = x => (disposables.push(x), x);
  const std = (color, roughness, metalness, extra = {}) => own(new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra}));
  const M = {
    stone: std(0xffffff, .93, 0, {vertexColors: true}),
    iron: std(0x2b2a2d, .5, .85),
    ironWorn: std(0x4a4440, .62, .7),
    brass: std(0xc9993f, .34, .95),
    timber: std(0x8a5a2e, .84, 0),
    timberDark: std(0x553519, .88, 0),
    throat: std(0x1a0602, .7, 0, {emissive: 0xff5a14, emissiveIntensity: 1.4}),
    mouth: std(0x220803, .6, 0, {emissive: 0xff6a1c, emissiveIntensity: 1.6}),
    ring: own(new THREE.MeshBasicMaterial({color: 0xffc35a, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending})),
  };
  const root = new THREE.Group(); root.name = 'ForgeWorks';
  const add = (geo, mat, p = [0, 0, 0], r = null, name = '') => {
    const m = new THREE.Mesh(own(geo), mat); m.position.set(...p); if (r) m.rotation.set(...r); m.castShadow = m.receiveShadow = true; if (name) m.name = name; root.add(m); return m;
  };

  // ---- furnace: coursed-stone bottle kiln with a sooted mouth, iron bands and a brass-lipped ore hopper
  const profile = [[0, 0], [.7, 0], [.7, .14], [.64, .16], [.62, .4], [.6, .7], [.55, .92], [.5, 1.02], [.53, 1.05], [.53, 1.1], [0, 1.1]].map(([x, y]) => new THREE.Vector2(x, y));
  const kiln = new THREE.LatheGeometry(profile, 36);
  add(paintCourses(kiln, {base: [.34, .29, .25], spread: .1, soot: .8}), M.stone, [0, 0, 0], null, 'Kiln');
  for (const [y, r] of [[.36, .632], [.84, .577]]) add(new THREE.TorusGeometry(r, .022, 6, 40), M.iron, [0, y, 0], [Math.PI / 2, 0, 0]);
  // arched mouth facing +Z: iron frame, glowing coals
  const arch = new THREE.Shape(); arch.moveTo(-.2, 0); arch.lineTo(.2, 0); arch.lineTo(.2, .2); arch.absarc(0, .2, .2, 0, Math.PI, false); arch.lineTo(-.2, 0);
  const archFrame = new THREE.Shape(); archFrame.moveTo(-.27, -.04); archFrame.lineTo(.27, -.04); archFrame.lineTo(.27, .2); archFrame.absarc(0, .2, .27, 0, Math.PI, false); archFrame.lineTo(-.27, -.04);
  archFrame.holes.push(arch);
  add(new THREE.ExtrudeGeometry(archFrame, {depth: .06, bevelEnabled: false, curveSegments: 10}), M.iron, [0, .2, .6]);
  const coals = add(new THREE.ShapeGeometry(arch, 10), M.mouth, [0, .2, .615], null, 'FurnaceMouth');
  // hopper: iron funnel with brass rim and an ember throat you can see from above
  const funnel = new THREE.LatheGeometry([[.12, 0], [.18, .02], [.46, .22], [.5, .26], [.46, .26], [.16, .05], [.1, .03]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
  add(funnel, M.ironWorn, [0, 1.06, 0], null, 'Hopper');
  add(new THREE.TorusGeometry(.49, .028, 8, 36), M.brass, [0, 1.32, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.CircleGeometry(.14, 16), M.throat, [0, 1.1, 0], [-Math.PI / 2, 0, 0], 'HopperThroat');
  const ring = add(new THREE.TorusGeometry(.56, .035, 6, 40), M.ring, [0, 1.36, 0], [Math.PI / 2, 0, 0], 'FeedRing'); ring.castShadow = false;
  // bellows on the forge side, a soot-black flue cap
  add(new THREE.BoxGeometry(.34, .1, .52), M.timber, [-.86, .3, .05], [0, 0, .1]);
  const bellows = add(new THREE.BoxGeometry(.3, .14, .46), M.timberDark, [-.86, .4, .05], [0, 0, .1]);
  add(new THREE.CylinderGeometry(.03, .03, .42, 8), M.iron, [-.62, .36, .05], [0, 0, Math.PI / 2 - .25]);

  // ---- chute: riveted iron trough from the furnace flank down into the bay
  const chuteFrom = new THREE.Vector3(.42, .62, .42), chuteTo = new THREE.Vector3(OUTPUT_BAY.x0 - FURNACE_AT[0] - .05, .27, BAY_Z - .2);
  const chute = new THREE.Group(); chute.position.copy(chuteFrom).lerp(chuteTo, .5); chute.lookAt(chuteTo.x, chuteTo.y, chuteTo.z); root.add(chute);
  const len = chuteFrom.distanceTo(chuteTo);
  for (const [x, y, w, h] of [[0, 0, .3, .03], [-.14, .06, .025, .12], [.14, .06, .025, .12]]) { const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, len)), M.iron); m.position.set(x, y, 0); m.castShadow = true; chute.add(m); }
  const chuteGlow = new THREE.Mesh(own(new THREE.PlaneGeometry(.24, len * .9)), M.throat); chuteGlow.rotation.x = -Math.PI / 2; chuteGlow.position.y = .018; chute.add(chuteGlow);
  add(new THREE.CylinderGeometry(.035, .045, .5, 8), M.timberDark, [chuteFrom.x * .4 + chuteTo.x * .6, .22, chuteFrom.z * .4 + chuteTo.z * .6]);

  // ---- output bay: dressed-stone plinth, five timber cradles with iron corners, a sigil per metal on the back wall
  const bayLen = OUTPUT_BAY.step * OUTPUT_BAY.order.length + .3;
  const plinth = new THREE.BoxGeometry(bayLen, .1, 1, 20, 1, 6);
  add(paintCourses(plinth, {course: .6, blocks: 6, base: [.47, .43, .38], spread: .08, mortar: .7}), M.stone, [BAY_X, .05, BAY_Z], null, 'OutputBay');
  for (const x of [-bayLen / 2, bayLen / 2]) add(new THREE.BoxGeometry(.06, .06, 1.04), M.ironWorn, [BAY_X + x, .1, BAY_Z]);
  const wall = new THREE.BoxGeometry(bayLen, .42, .16, 16, 3, 1);
  add(paintCourses(wall, {course: .14, blocks: 22, base: [.4, .36, .32], spread: .12}), M.stone, [BAY_X, .31, BAY_Z - .44]);
  const sigils = new Map();
  OUTPUT_BAY.order.forEach((metal, i) => {
    const x = OUTPUT_BAY.x0 + i * OUTPUT_BAY.step - FURNACE_AT[0];
    add(new THREE.BoxGeometry(.56, .03, .56), M.timber, [x, .115, BAY_Z + .02]);
    for (const dx of [-.27, .27]) add(new THREE.BoxGeometry(.03, .035, .58), M.iron, [x + dx, .13, BAY_Z + .02]);
    const color = BAY_SIGIL[metal];
    const glow = std(color, .25, .6, {emissive: color, emissiveIntensity: .35});
    const gem = add(new THREE.OctahedronGeometry(.06, 0), glow, [x, .37, BAY_Z - .34], [0, Math.PI / 4, 0], 'Sigil:' + metal);
    add(new THREE.TorusGeometry(.08, .012, 6, 18), M.brass, [x, .37, BAY_Z - .355]);
    sigils.set(metal, {gem, material: glow, lit: 0});
    if (i) add(new THREE.BoxGeometry(.08, .1, .2), M.ironWorn, [x - OUTPUT_BAY.step / 2, .56, BAY_Z - .44]);
  });

  // ---- signs: carved boards so a first-time Hero knows where ore goes and where bars come out
  const signs = [];
  function sign(lines, accent, p, ry = 0, postHeight = 0) {
    const g = new THREE.Group(); g.position.set(...p); g.rotation.y = ry; root.add(g);
    const tex = signTexture(lines, accent); if (tex) own(tex);
    const face = tex ? own(new THREE.MeshStandardMaterial({map: tex, roughness: .8})) : M.timberDark;
    const board = new THREE.Mesh(own(new THREE.BoxGeometry(.78, .25, .035)), [M.timberDark, M.timberDark, M.timberDark, M.timberDark, face, face]);
    board.castShadow = true; g.add(board);
    if (postHeight) { const post = new THREE.Mesh(own(new THREE.CylinderGeometry(.035, .04, postHeight, 8)), M.timberDark); post.position.y = -postHeight / 2 - .1; post.castShadow = true; g.add(post); }
    signs.push(g); return g;
  }
  sign(['ORE IN', 'Bring ore: it smelts itself'], '#ffb067', [-.5, 1.62, .62], .3, 1.5);
  sign(['BARS OUT', 'One stack per metal'], '#ffe08a', [BAY_X, .82, BAY_Z - .44], 0, 0);

  // ---- sparks: one shared additive Points burst pool for feeds and outputs
  const SPARKS = 48, spPos = new Float32Array(SPARKS * 3), spVel = new Float32Array(SPARKS * 3), spLife = new Float32Array(SPARKS);
  const spGeo = own(new THREE.BufferGeometry()); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const spMat = own(new THREE.PointsMaterial({color: 0xffb35a, size: .06, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending}));
  const sparks = new THREE.Points(spGeo, spMat); sparks.frustumCulled = false; sparks.name = 'ForgeSparks'; root.add(sparks);
  let spNext = 0;
  function burst(local, count = 16, up = 2.2) {
    for (let n = 0; n < count; n++) { const i = spNext++ % SPARKS, a = hash(spNext) * Math.PI * 2, s = .5 + hash(spNext + 7) * 1.1;
      spPos.set([local.x, local.y, local.z], i * 3); spVel.set([Math.cos(a) * s, up * (.6 + hash(spNext + 3) * .6), Math.sin(a) * s], i * 3); spLife[i] = .5 + hash(spNext + 11) * .5; }
  }

  let heat = 0, feedPulse = 0;
  // o: {time, dt, jobs, feedReady, bay:{metal:amount}}
  function animate(o = {}) {
    const time = o.time || 0, dt = Math.min(.1, Math.max(0, o.dt || 0)), jobs = o.jobs | 0;
    heat += ((jobs ? 1 : .15) - heat) * (1 - Math.exp(-dt * 2.5));
    const flick = .82 + .18 * Math.sin(time * 9.1) * Math.sin(time * 3.7 + 1);
    M.mouth.emissiveIntensity = (.35 + 1.6 * heat) * flick;
    M.throat.emissiveIntensity = (.25 + 1.5 * heat) * (.9 + .1 * Math.sin(time * 6));
    bellows.scale.y = 1 + (jobs ? .35 * Math.max(0, Math.sin(time * 3.2)) : 0);
    feedPulse += ((o.feedReady ? 1 : 0) - feedPulse) * (1 - Math.exp(-dt * 4));
    M.ring.opacity = .12 + feedPulse * (.45 + .3 * Math.sin(time * 4));
    ring.scale.setScalar(1 + feedPulse * .04 * Math.sin(time * 4));
    for (const [metal, s] of sigils) { const want = (o.bay?.[metal] | 0) > 0 ? 1 : 0; s.lit += (want - s.lit) * (1 - Math.exp(-dt * 3)); s.material.emissiveIntensity = .3 + s.lit * (1.1 + .25 * Math.sin(time * 2 + metal.length)); s.gem.rotation.y = Math.PI / 4 + time * (.3 + s.lit * .9); }
    coals.scale.y = .96 + .04 * flick;
    let live = 0;
    for (let i = 0; i < SPARKS; i++) { if (spLife[i] <= 0) { spPos[i * 3 + 1] = -50; continue; } live++; spLife[i] -= dt; spVel[i * 3 + 1] -= 6 * dt;
      for (let k = 0; k < 3; k++) spPos[i * 3 + k] += spVel[i * 3 + k] * dt; }
    spGeo.attributes.position.needsUpdate = true; sparks.visible = live > 0;
  }
  // World-space events from the authority: feed at the hopper, output at a bay slot.
  function event(ev) {
    if (!ev?.position) return;
    const local = new THREE.Vector3(ev.position[0] - root.position.x, ev.position[1] - root.position.y, ev.position[2] - root.position.z);
    if (ev.kind === 'refinery_feed') burst(new THREE.Vector3(0, 1.3, 0), 14, 2.4);
    if (ev.kind === 'refinery_output') { burst(new THREE.Vector3(local.x, .3, local.z), 18, 1.6); burst(chuteTo.clone(), 6, 1); }
  }
  animate({});
  return {
    root, animate, event,
    place(height) { root.position.set(FURNACE_AT[0], height, FURNACE_AT[1]); },
    stats: () => ({sigils: sigils.size, signs: signs.length, meshes: root.children.length}),
    dispose() { root.removeFromParent(); for (const d of disposables) d.dispose?.(); disposables.length = 0; },
  };
}
