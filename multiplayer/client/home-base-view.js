// Dawnhold and Grumblekeep presentation. Reads the authoritative home bases from
// the snapshot (shared/home-bases.js) and animates everything on the frame clock:
// dome shimmer and fades, heart bob, turret aim, zaps and ballista bolts.
// Code-built stand-ins draw until the Blender kit (client/home-base-art.js) loads, then the bases rebuild from it.
import * as THREE from 'three';
import {HOME, HOME_LAYOUT, HOME_SCALE, barracksYaw, gateYaw as baseGateYaw, homePoint} from '../shared/home-bases.js';
import {terrainHeight} from '../shared/terrain.js';
import {buildKitBase, prepareHomeKit} from './home-base-art.js';
import {homeBallistaYaw} from '../shared/home-ballista.js';
import {createKeepBallistaView} from './keep-ballista-view.js';
import {createSiegeDamageView} from './siege-damage-view.js';

const STYLE = {
  party: {stone: 0xb9ad97, trim: 0xc49a52, glow: 0x5fb4ff, wood: 0x8a6440, roof: 0x3d4a5c, accent: 0x2f6fd0, dome: new THREE.Color(0x58b4ff)},
  rivals: {stone: 0x4f4656, trim: 0x5a3a2c, glow: 0xa45cff, wood: 0x2e2a2c, roof: 0xe6dac0, accent: 0x6b2a8c, dome: new THREE.Color(0xb46cff)},
};
const BONE = 0xe8dcc0, OOZE = 0x8cff4a, SOCKET = 0x150b18;

const domeVertex = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`;
const domeFragment = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uFlash; uniform vec3 uFlashAt;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec2 g = vec2(atan(vP.z, vP.x) * 7.0, vP.y * 0.9);
  vec2 c = abs(fract(g + vec2(0.0, uTime * 0.05)) - 0.5);
  float hex = smoothstep(0.46, 0.5, max(c.x, c.y));
  float ring = exp(-pow((distance(vP, uFlashAt) - uFlash * 9.0) * 1.4, 2.0)) * (1.0 - uFlash);
  float a = (0.05 + rim * 0.55 + hex * 0.16 + ring * 0.8) * uAlpha;
  if (vP.y < -0.6) discard;
  gl_FragColor = vec4(uColor * (0.7 + rim + ring * 1.5), a);
}`;

function mat(color, extra = {}) { return new THREE.MeshStandardMaterial({color, roughness: .82, metalness: 0, flatShading: true, ...extra}); }
function glowMat(color, intensity = 1.4) { return new THREE.MeshStandardMaterial({color, emissive: color, emissiveIntensity: intensity, roughness: .3, flatShading: true}); }

export function createHomeBaseView({scene, timberline = () => null}) {
  const root = new THREE.Group(); root.name = 'home-bases'; scene.add(root);
  const bases = new Map(), effects = [], effectPool = [], localAim = new Map();
  let snapshot = null, enabled = false, kit = null;
  // The gate ballistas: once their models load, Dawnhold's are taken over by Timberlines and Grumblekeep's by Gnashjaw rigs.
  const keep = createKeepBallistaView({root, height: (x, z) => terrainHeight(snapshot, x, z, false), timberline});
  // Siege hits: chips, sparks, cracks and a health bar over whatever was struck (client/siege-damage-view.js).
  const damage = createSiegeDamageView({root, height: (x, z) => terrainHeight(snapshot, x, z, false), lookup: id => {
    for (const b of bases.values()) {
      if (b.id === id) return {object: b.heart.proxy || b.heart.group, side: b.side, kind: 'heart', data: b.data};
      const p = b.parts.get(id); if (p) return {object: p.group, side: b.side, kind: p.kind, data: p.data, part: p};
    }
    return null;
  }});
  const adoptKeep = b => { for (const p of b.parts.values()) if (p.kind === 'ballista') keep.adopt(p); };
  // Lights stay in the renderer even when the bases are hidden. Changing the
  // visible light count invalidates EVERY lit shader (including terrain/trees).
  // Two fixed slots keep join/leave/mode changes from recompiling the whole world.
  const heartLights = new Map(['party', 'rivals'].map(side => {
    const light = new THREE.PointLight(STYLE[side].glow, 0, 16, 2);
    light.name = `HomeHeart:${side}`; scene.add(light); return [side, light];
  }));
  function syncHeartLight(b) {
    const source = b.heart.light, light = heartLights.get(b.side);
    source.visible = false; // the authored attachment remains a pose/intensity source
    source.getWorldPosition(light.position); light.color.copy(source.color);
    light.intensity = source.intensity; light.distance = source.distance; light.decay = source.decay;
  }
  const waterMats = {party: new THREE.MeshStandardMaterial({color: 0x2a6fb8, emissive: 0x3d9cff, emissiveIntensity: .55, roughness: .08, metalness: .1, transparent: true, opacity: .82}),
    rivals: new THREE.MeshStandardMaterial({color: 0x3c8f12, emissive: 0x8cff4a, emissiveIntensity: .9, roughness: .3, transparent: true, opacity: .92})};
  const shared = {};
  for (const side of ['party', 'rivals']) {
    const s = STYLE[side];
    shared[side] = {stone: mat(s.stone), trim: mat(s.trim, {metalness: side === 'party' ? .45 : .2, roughness: .5}), glow: glowMat(s.glow),
      wood: mat(s.wood), roof: mat(s.roof), accent: mat(s.accent), bone: mat(BONE), ooze: glowMat(OOZE, 1.4), socket: mat(SOCKET)};
  }
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6), cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone6: new THREE.CylinderGeometry(.5, 1, 1, 6), cone4: new THREE.CylinderGeometry(.45, 1, 1, 4), spike: new THREE.ConeGeometry(1, 1, 5),
    crystal: new THREE.OctahedronGeometry(1, 0), ball: new THREE.SphereGeometry(1, 12, 8), ring: new THREE.TorusGeometry(1, .06, 6, 28),
    disc: new THREE.CylinderGeometry(1, 1, 1, 24), dome: new THREE.SphereGeometry(HOME.domeRadius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2 + .05),
  };
  const add = (parent, g, m, [x, y, z], [sx, sy, sz] = [1, 1, 1], ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.y = ry; o.castShadow = false; o.receiveShadow = false; parent.add(o); return o; };
  const tag = (obj, id) => obj.traverse(n => { if (n.isMesh) n.userData.targetId = id; });

  function buildHeart(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals';
    add(g, evil ? geo.cyl6 : geo.cyl8, M.stone, [0, .25, 0], [2.8, .5, 2.8]); add(g, evil ? geo.cyl6 : geo.cyl8, M.stone, [0, .65, 0], [2.2, .4, 2.2]);
    if (evil) {
      add(g, geo.cone6, M.trim, [0, 1.5, -.3], [1.3, 1.3, 1.3]); add(g, geo.disc, M.ooze, [0, 2.17, -.3], [1.05, .08, 1.05]);
      add(g, geo.ball, M.bone, [0, 1.6, 1.0], [.55, .5, .52]);
      for (const x of [-.2, .2]) { add(g, geo.ball, M.socket, [x, 1.65, 1.42], [.16, .16, .1]); add(g, geo.ball, M.ooze, [x, 1.65, 1.5], [.06, .06, .06]); }
      for (let i = 0; i < 4; i++) add(g, geo.cyl8, M.trim, [.9 + (i % 2) * .15, 2.6 + i, -1.3], [.34 - i * .03, 1.05, .34 - i * .03], i * .4).rotation.x = (i % 2 ? .2 : -.15);
    } else {
      add(g, geo.box, M.stone, [0, 1.4, -.6], [2, 1.1, 1.4]); add(g, geo.box, glowMat(0xff7a2a, 2.5), [0, 1.3, .12], [1, .55, .08]);
      add(g, geo.cyl8, M.trim, [0, 3.0, -.9], [.38, 3, .38]);
      add(g, geo.box, mat(0x2a2a2e), [-1.3, 1.6, 1.2], [1.2, .26, .42]); add(g, geo.box, mat(0x2a2a2e), [-1.3, 1.2, 1.2], [.5, .6, .4]);
    }
    const heart = new THREE.Group(); heart.position.set(0, 4.6, evil ? -.2 : .4); g.add(heart);
    const core = add(heart, geo.crystal, M.glow, [0, 0, 0], [.75, 1.45, .75]);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(heart, geo.crystal, M.glow, [Math.cos(a) * .45, -.6, Math.sin(a) * .45], [.18, .45, .18]).rotation.z = Math.cos(a) * .5; }
    const r1 = add(heart, geo.ring, M.trim, [0, 0, 0], [1.15, 1.15, 1.15]), r2 = add(heart, geo.ring, M.trim, [0, 0, 0], [1.4, 1.4, 1.4]);
    r1.rotation.set(.5, .2, 0); r2.rotation.set(-.3, .7, 0);
    const light = new THREE.PointLight(STYLE[side].glow, 6, 14, 2); heart.add(light);
    return {group: g, heart, core, rings: [r1, r2], light};
  }

  function buildBarracks(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals';
    add(g, geo.box, M.stone, [0, .35, 0], [6.4, .7, 4.4]); add(g, geo.box, evil ? M.stone : M.wood, [0, 1.9, 0], [5.8, 2.4, 3.8]);
    if (evil) {
      for (let i = 0; i < 6; i++) { const r = add(g, geo.ring, M.bone, [-2.5 + i, 3.1, 0], [2.2, 2.2, 2.6]); r.rotation.y = Math.PI / 2; }
      add(g, geo.ball, M.bone, [0, 2.2, 2.3], [1.3, 1.25, 1.0]); add(g, geo.box, M.socket, [0, 1.0, 3.1], [1.2, 1.0, .3]);
      for (const x of [-.45, .45]) { add(g, geo.ball, M.socket, [x, 2.5, 3.15], [.35, .35, .2]); add(g, geo.ball, M.ooze, [x, 2.5, 3.32], [.12, .12, .1]); }
    } else {
      const shape = new THREE.Shape([new THREE.Vector2(-2.6, 0), new THREE.Vector2(2.6, 0), new THREE.Vector2(0, 2.3)]);
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {depth: 7, bevelEnabled: false}), M.roof);
      roof.rotation.y = Math.PI / 2; roof.position.set(-3.5, 3.1, 0); g.add(roof);
      add(g, geo.box, mat(0x2a2a2e), [0, 1.5, 1.95], [1.8, 2.2, .2]); add(g, geo.cyl8, M.trim, [0, 1.65, 2.08], [.42, .08, .42]).rotation.x = Math.PI / 2;
      for (const x of [-2.3, 2.3]) { add(g, geo.box, M.accent, [x, 2.4, 1.98], [.8, 1.6, .04]); add(g, geo.ball, M.glow, [x, 2.6, 2.04], [.13, .13, .13]); }
    }
    return g;
  }

  function buildFountain(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals';
    if (evil) {
      add(g, geo.ball, M.trim, [0, .9, 0], [1.6, 1.1, 1.6]); add(g, geo.disc, M.ooze, [0, 1.7, 0], [1.4, .06, 1.4]);
      const bubbles = []; for (let i = 0; i < 6; i++) bubbles.push(add(g, geo.ball, M.ooze, [Math.cos(i * 1.7) * .7, 1.8, Math.sin(i * 1.7) * .7], [.14, .14, .14]));
      g.userData.bubbles = bubbles;
    } else {
      add(g, geo.disc, M.stone, [0, .35, 0], [2, .7, 2]); add(g, geo.disc, glowMat(0x4aa8ff, 1.2), [0, .66, 0], [1.75, .06, 1.75]);
      add(g, geo.cyl8, M.stone, [0, 1.3, 0], [.32, 1.5, .32]); add(g, geo.disc, M.stone, [0, 2.05, 0], [.95, .3, .95]);
      g.userData.bubbles = [add(g, geo.crystal, M.glow, [0, 2.6, 0], [.25, .5, .25])];
    }
    const l = new THREE.PointLight(evil ? OOZE : STYLE.party.glow, 3, 8, 2); l.position.y = 2; g.add(l);
    return g;
  }

  function buildPylon(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals';
    add(g, evil ? geo.cyl6 : geo.cyl8, M.stone, [0, .25, 0], [.9, .5, .9]);
    const column = new THREE.Group(); g.add(column);
    if (evil) for (let i = 0; i < 6; i++) add(column, geo.cone6, i % 2 ? M.trim : M.stone, [0, .8 + i * .62, 0], [.5 - i * .05, .66, .5 - i * .05], i * .4);
    else { add(column, geo.cone4, M.stone, [0, 2.3, 0], [.55, 4, .55], Math.PI / 4); for (const y of [1.2, 2.6]) add(column, geo.ring, M.trim, [0, y, 0], [.5, .5, .5]).rotation.x = Math.PI / 2; }
    const crown = new THREE.Group(); crown.position.y = 4.6; column.add(crown);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; add(crown, geo.crystal, M.glow, [Math.cos(a) * .18, 0, Math.sin(a) * .18], [.16, .55, .16]).rotation.z = Math.cos(a) * .35; }
    const orb = add(crown, geo.ball, M.glow, [0, .7, 0], [.3, .3, .3]);
    return {group: g, column, crown, orb};
  }

  function buildSpire(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals';
    add(g, evil ? geo.cyl6 : geo.cyl8, M.stone, [0, .4, 0], [1.1, .8, 1.1]);
    if (evil) for (let i = 0; i < 5; i++) { const a = i * 1.26; add(g, geo.spike, M.stone, [Math.cos(a) * .3, 2.4, Math.sin(a) * .3], [.32, 4.2 - i * .4, .32]).rotation.set(Math.sin(a) * .1, 0, Math.cos(a) * .1); }
    else { add(g, geo.cone6, M.stone, [0, 3.2, 0], [.6, 5, .6]); for (const y of [1.6, 3, 4.6]) add(g, geo.ring, M.trim, [0, y, 0], [.6 - y * .06, .6 - y * .06, .6 - y * .06]).rotation.x = Math.PI / 2; }
    const tipY = evil ? 4.7 : 6.1, tip = new THREE.Group(); tip.position.y = tipY; g.add(tip);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(tip, geo.crystal, M.glow, [Math.cos(a) * .2 * (i ? 1 : 0), 0, Math.sin(a) * .2 * (i ? 1 : 0)], i ? [.16, .6, .16] : [.3, .9, .3]).rotation.z = i ? Math.cos(a) * .4 : 0; }
    const halo = add(tip, geo.ring, M.glow, [0, 1.0, 0], [.7, .7, .7]); halo.rotation.x = Math.PI / 2;
    return {group: g, tip, halo, tipY};
  }

  function buildBallista(side, M) {
    const g = new THREE.Group(), evil = side === 'rivals', frame = evil ? M.trim : M.wood, bow = evil ? M.bone : M.trim;
    add(g, geo.cyl8, M.stone, [0, .35, 0], [.95, .7, .95]);
    const head = new THREE.Group(); head.position.y = 1.0; g.add(head);
    add(head, geo.box, frame, [0, 0, 0], [.6, .45, .6]); add(head, geo.box, frame, [0, .3, .6], [.24, .18, 2.2]);
    for (const s of [-1, 1]) add(head, geo.box, bow, [s * .72, .35, 1.25], [1.4, .13, .13], -s * .35);
    add(head, geo.cyl6, frame, [0, .42, .9], [.04, 2.0, .04]).rotation.x = Math.PI / 2;
    if (evil) { add(head, geo.ball, M.bone, [0, .72, .5], [.24, .22, .24]); add(head, geo.ball, M.ooze, [0, .74, .72], [.05, .05, .05]); }
    return {group: g, head, aim: 0, targetAim: 0};
  }

  function domeFor(side) {
    const dome = new THREE.Mesh(geo.dome, new THREE.ShaderMaterial({vertexShader: domeVertex, fragmentShader: domeFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {uColor: {value: STYLE[side].dome}, uTime: {value: 0}, uAlpha: {value: 1}, uFlash: {value: 1}, uFlashAt: {value: new THREE.Vector3()}}}));
    dome.renderOrder = 5; const [x, z] = homePoint(side, [0, 0]); dome.position.set(x, terrainHeight(snapshot, x, z, false) - .3, z); return dome;
  }

  function buildBase(data) {
    if (kit) {
      const built = buildKitBase(kit, data, {height: (x, z) => terrainHeight(snapshot, x, z, false), glowColor: STYLE[data.side].glow, ball: geo.ball, ooze: shared.rivals.ooze, glow: shared[data.side].glow, ring: geo.ring});
      built.water.traverse(n => { if (n.isMesh) n.material = waterMats[data.side]; });
      root.add(built.group); const dome = domeFor(data.side); built.group.add(dome);
      return {side: data.side, id: data.id, ...built, dome, domeAlpha: 1, heartAlive: 1, data, bellSwing: 0};
    }
    const side = data.side, M = shared[side], group = new THREE.Group();
    group.name = `home-${side}`; root.add(group);
    const gateYaw = baseGateYaw(side); // local +Z points out of the gate
    const K = HOME_SCALE; // buildings grow with the widened keep; ballistas keep their crew size
    const place = (obj, local, extraYaw = 0, scale = K) => { const [x, z] = homePoint(side, local); obj.position.set(x, terrainHeight(snapshot, x, z, false), z); obj.rotation.y = gateYaw + extraYaw; obj.scale.multiplyScalar(scale); group.add(obj); return obj; };
    // (the ring's floor is the town square's cobbles: client/town-square-view.js)
    const heart = buildHeart(side, M); place(heart.group, [0, 0], 0, 1.25 * K); tag(heart.group, data.id);
    place(buildBarracks(side, M), HOME_LAYOUT.barracks, barracksYaw(side) - gateYaw);
    const fountain = place(buildFountain(side, M), HOME_LAYOUT.fountain);
    const parts = new Map();
    for (const part of data.parts) {
      const local = part.kind === 'pylon' ? HOME_LAYOUT.pylons[+part.id.at(-1)] : part.kind === 'spire' ? HOME_LAYOUT.spires[+part.id.at(-1)] : HOME_LAYOUT.ballistas[+part.id.at(-1)];
      const built = part.kind === 'pylon' ? buildPylon(side, M) : part.kind === 'spire' ? buildSpire(side, M) : buildBallista(side, M);
      place(built.group, local, 0, part.kind === 'ballista' ? 1 : K); if (part.kind !== 'ballista') built.scale = K; tag(built.group, part.id); built.kind = part.kind; built.alive = 1; built.data = part; parts.set(part.id, built);
    }
    const dome = domeFor(side); group.add(dome);
    return {side, id: data.id, group, heart, fountain, parts, dome, domeAlpha: 1, heartAlive: 1, data};
  }

  function spawnEffect(kind, from, to, color) {
    let fx = effectPool.pop();
    if (!fx) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({transparent: true, depthWrite: false}));
      const bolt = new THREE.Mesh(geo.cyl6, glowMat(0xffffff, 1.5)); bolt.scale.set(.05, .9, .05);
      fx = {line, bolt}; root.add(line, bolt);
    }
    fx.kind = kind; fx.from = new THREE.Vector3(...from); fx.to = new THREE.Vector3(...to); fx.start = performance.now(); fx.life = kind === 'zap' ? 220 : 420;
    fx.line.material.color.set(color); fx.bolt.material.color.set(color); fx.bolt.material.emissive.set(color);
    fx.line.visible = kind === 'zap'; fx.bolt.visible = kind === 'bolt' || kind === 'burst'; if (kind === 'burst') fx.life = 700; effects.push(fx);
  }

  function sync(s) {
    snapshot = s; enabled = s?.battle?.v === 2 && s.battle.status === 'running'; root.visible = enabled;
    if (!enabled) { for (const light of heartLights.values()) light.intensity = 0; return; }
    for (const data of s.battle.bases) {
      let b = bases.get(data.side);
      if (!b) { b = buildBase(data); bases.set(data.side, b); adoptKeep(b); }
      b.data = data; syncHeartLight(b);
      for (const part of data.parts) { const p = b.parts.get(part.id); if (p) p.data = part; }
    }
    keep.sync(s);
  }

  function disposeBase(b) {
    for (const p of b.parts.values()) keep.release(p);
    b.group.removeFromParent(); b.dome.material.dispose();
    for (const m of b.baked || []) m.geometry.dispose();
    if (b.heart.proxy) { b.heart.proxy.geometry.dispose(); b.heart.proxy.material.dispose(); }
  }

  function installKit(gltf) {
    const k = prepareHomeKit(gltf); if (!k) return false;
    kit = k; damage.reset(); for (const b of bases.values()) disposeBase(b); bases.clear();
    if (snapshot) sync(snapshot);
    return true;
  }

  function event(ev) {
    if (!enabled) return;
    keep.event(ev);
    damage.event(ev);
    if (ev.kind === 'battle_wave') for (const b of bases.values()) b.bellSwing = 1;
    if (ev.kind === 'home_bell') { const b = bases.get(ev.side); if (b) b.bellSwing = 1.4; }
    // A drink lifts a ring of the fountain's own glow; a mend sparkles once up the mended piece.
    if (ev.kind === 'home_drink' || ev.kind === 'home_part_repaired') spawnEffect('burst', ev.position, ev.position, STYLE[ev.side]?.glow ?? 0xffffff);
    if (ev.kind === 'home_turret_fire') {
      const b = bases.get(ev.side), color = STYLE[ev.side]?.glow ?? 0xffffff, from = [...ev.from];
      const tp = b?.parts.get(ev.id);
      from[1] += ev.turret === 'spire' ? (tp?.tipY ?? (ev.side === 'rivals' ? 5.2 : 6.6)) * (tp?.scale ?? HOME_SCALE) : 1.45;
      const to = [ev.to[0], ev.to[1] + 1.1, ev.to[2]];
      spawnEffect(ev.turret === 'spire' ? 'zap' : 'bolt', from, to, color);
      const p = b?.parts.get(ev.id); if (p?.head) p.targetAim = Math.atan2(ev.to[0] - ev.from[0], ev.to[2] - ev.from[2]);
    }
    if (ev.kind === 'home_shield_block') {
      const b = bases.get(ev.side); if (!b) return;
      b.dome.material.uniforms.uFlash.value = 0; b.flashStart = performance.now();
      b.dome.material.uniforms.uFlashAt.value.set(0, 6, 0);
    }
  }

  function update(dt, camera, tick = snapshot?.tick, viewportHeight = 1080) {
    if (!enabled || !snapshot) return;
    keep.update(dt, tick, camera, viewportHeight);
    if (camera) damage.update(dt, camera);
    const now = performance.now(), t = now / 1000, k = 1 - Math.exp(-dt * 6);
    for (const b of bases.values()) {
      const data = b.data, fallen = data.fallenUntil > snapshot.tick, pylonsUp = data.parts.some(p => p.kind === 'pylon' && p.hp > 0), shield = !fallen && pylonsUp;
      b.domeAlpha += ((shield ? 1 : 0) - b.domeAlpha) * k;
      const u = b.dome.material.uniforms; u.uTime.value = t; u.uAlpha.value = b.domeAlpha * (0.85 + Math.sin(t * 2.1) * .05); b.dome.visible = b.domeAlpha > .01;
      if (b.flashStart) { u.uFlash.value = Math.min(1, (now - b.flashStart) / 700); if (u.uFlash.value >= 1) b.flashStart = 0; }
      const heartUp = fallen ? 0 : 1; b.heartAlive += (heartUp - b.heartAlive) * k;
      const h = b.heart; h.heart.position.y = (h.heartY ?? 4.6) + Math.sin(t * 1.3) * .18; h.core.rotation.y = t * .6;
      if (h.kit) { h.rings[0].rotation.set(.55, t * .8, 0); h.rings[1].rotation.set(-.42 + Math.sin(t * .4) * .1, -t * .55, .3); }
      else { h.rings[0].rotation.z = t * .7; h.rings[1].rotation.x = -t * .5; }
      if (b.bell) { b.bellSwing = Math.max(0, b.bellSwing - dt * .25); b.bell.rotation.x = Math.sin(t * 6.5) * .55 * b.bellSwing + Math.sin(t * .9) * .03; }
      if (b.water) { b.water.position.y = Math.sin(t * 1.7) * .012; waterMats[b.side].emissiveIntensity = (b.side === 'rivals' ? .9 : .55) + Math.sin(t * 2.3) * .12; }
      const hurt = 1 - data.hp / data.maxHp; h.heart.scale.setScalar(.15 + .85 * b.heartAlive); h.light.intensity = 6 * b.heartAlive * (1 + hurt * Math.max(0, Math.sin(t * 9)));
      syncHeartLight(b);
      for (const bubble of b.fountain.userData.bubbles || []) { bubble.position.y = (bubble.userData.baseY ?? (b.side === 'rivals' ? 1.75 : 2.6)) + Math.abs(Math.sin(t * 2 + bubble.id)) * .25; }
      for (const p of b.parts.values()) {
        const alive = p.data.hp > 0 && !fallen ? 1 : 0; p.alive += (alive - p.alive) * k;
        if (p.kind === 'pylon') { p.column.scale.y = .25 + .75 * p.alive; p.crown.visible = p.alive > .2; p.orb.position.y = (p.orbY ?? .7) + Math.sin(t * 2 + p.group.position.x) * .12; if (p.orbY !== undefined) p.orb.rotation.y = t * .8; }
        else if (p.kind === 'spire') { p.tip.visible = p.alive > .2; p.halo.rotation.z = t * 1.5; p.tip.position.y = p.tipY * (.35 + .65 * p.alive); }
        else if (!p.keep) {
          // Manned: the operator's own predicted aim drives it at once; others see the replicated aim, eased. Unmanned: it tracks its last target.
          const mine = localAim.get(p.data.id), aim = mine || (p.data.operator ? {yaw: p.data.aimYaw || 0, pitch: p.data.aimPitch || 0} : null);
          const want = aim ? homeBallistaYaw(b.side) + aim.yaw + Math.PI : p.targetAim, wantPitch = aim ? aim.pitch : 0, kk = mine ? 1 : k;
          p.aim += Math.atan2(Math.sin(want - p.group.rotation.y - p.aim), Math.cos(want - p.group.rotation.y - p.aim)) * kk; p.head.rotation.y = p.aim; p.head.visible = p.alive > .2;
          p.pitch = (p.pitch ?? 0) + (wantPitch - (p.pitch ?? 0)) * kk; if (p.bow) p.bow.rotation.x = -p.pitch;
          if (p.bolt) { const loaded = snapshot.tick >= (p.data.readyTick ?? 0) - 60 ? 1 : 0; p.boltShow = (p.boltShow ?? 1) + (loaded - (p.boltShow ?? 1)) * k; p.bolt.scale.setScalar(Math.max(.001, p.boltShow)); }
        }
      }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i], u = (now - fx.start) / fx.life;
      if (u >= 1) { fx.line.visible = fx.bolt.visible = false; effects.splice(i, 1); effectPool.push(fx); continue; }
      if (fx.kind === 'zap') {
        const pos = fx.line.geometry.attributes.position; pos.setXYZ(0, ...fx.from.toArray()); pos.setXYZ(1, fx.to.x + Math.sin(now) * .1, fx.to.y, fx.to.z); pos.needsUpdate = true;
        fx.line.material.opacity = 1 - u;
      } else if (fx.kind === 'burst') {
        fx.bolt.position.set(fx.from.x, fx.from.y + .4 + u * 2.2, fx.from.z); fx.bolt.rotation.set(0, 0, 0);
        fx.bolt.scale.set(.05 + u * .5, .9 * (1 - u) + .05, .05 + u * .5); fx.bolt.material.opacity = 1 - u; fx.bolt.material.transparent = true;
      } else {
        fx.bolt.scale.set(.05, .9, .05); fx.bolt.material.opacity = 1;
        fx.bolt.position.lerpVectors(fx.from, fx.to, Math.min(1, u * 1.2)); fx.bolt.lookAt(fx.to); fx.bolt.rotateX(Math.PI / 2);
      }
    }
    void camera;
  }

  function targets() {
    if (!enabled || !snapshot) return [];
    const out = [];
    for (const b of bases.values()) {
      if (b.data.fallenUntil > snapshot.tick) continue;
      for (const p of b.parts.values()) if (p.data.hp > 0) out.push(p.group);
      if (!b.data.parts.some(p => p.kind === 'pylon' && p.hp > 0)) out.push(b.heart.proxy || b.heart.group);
    }
    return out;
  }

  const setLocalAim = (id, aim) => { keep.setLocalAim(id, aim); if (aim) localAim.set(id, aim); else localAim.delete(id); };
  function installKeepKit(gltf) { if (!keep.install(gltf)) return false; for (const b of bases.values()) adoptKeep(b); return true; }
  /** The Timberline model arrived: hand Dawnhold's gate ballistas over to it. */
  const timberlineReady = () => { for (const b of bases.values()) adoptKeep(b); };
  return {sync, event, update, targets, installKit, installKeepKit, timberlineReady, keep, setLocalAim, object: root, damageStats: () => damage.stats(), stats: () => ({kit: !!kit, bases: bases.size, staticDraws: [...bases.values()].reduce((n, b) => n + (b.draws || 0), 0)}),
    dispose() { keep.dispose(); damage.dispose(); for (const light of heartLights.values()) {light.removeFromParent(); light.dispose();} root.removeFromParent(); for (const g of Object.values(geo)) g.dispose(); }};
}
