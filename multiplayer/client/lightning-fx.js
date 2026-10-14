// Lightning presentation shared by the Stormreel and the Stormspire: jagged forked arcs, spark showers, strike glows and
// ground rings. Everything is pooled into a handful of draw calls (arcs: one mesh; sparks: one Points; glows: one
// InstancedMesh; rings: one InstancedMesh) and no lights are added, so it stays phone- and Quest-safe.
//
// Arcs are camera-facing ribbons with a hot white core fading to resonance blue at the edges. Each arc re-forks a few
// times a second while it lives (that flicker is the look of lightning, not a stepped animation) and its brightness
// follows a strike-and-restrike envelope. Positions are world space; time comes from the caller's frame dt.
import * as THREE from 'three';

export const LIGHTNING_CAPS = Object.freeze({quads: 1800, arcs: 40, sparks: 320, glows: 24, rings: 12});   // headroom for a live Stormreel circuit (arc channels, crawling fire on its victims)
const BLUE = new THREE.Color(0x58c8ff), CORE = new THREE.Color(0xeefbff), MOLTEN = new THREE.Color(0xff7a1a);   // molten: arc-weld spatter cools white -> orange

function gradientTexture() {
  // Across the ribbon (v): transparent edge -> blue glow -> white core -> blue -> edge.
  const w = 4, h = 64, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const d = Math.abs(y / (h - 1) - .5) * 2, core = Math.max(0, 1 - d / .22) ** 1.6, glow = Math.max(0, 1 - d) ** 2.2;
    const r = 88 + (238 - 88) * core, g = 200 + (251 - 200) * core, b = 255;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = Math.min(255, 255 * (glow * .55 + core)); }
  }
  const t = new THREE.DataTexture(data, w, h); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; return t;
}
function dotTexture() {
  const s = 32, data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - s / 2 + .5, y - s / 2 + .5) / (s / 2), a = Math.max(0, 1 - d) ** 2, i = (y * s + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 * a;
  }
  const t = new THREE.DataTexture(data, s, s); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; return t;
}

/** Midpoint-displaced jagged path between a and b (Vector3s), `depth` subdivisions, offsets scaled by `rough`. */
export function jagged(a, b, {depth = 5, rough = .18, rand = Math.random, out = []} = {}) {
  const pts = [a.clone(), b.clone()], len = a.distanceTo(b), dir = b.clone().sub(a).normalize();
  const side = Math.abs(dir.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, side).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
  let amp = len * rough;
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const m = pts[i - 1].clone().add(pts[i]).multiplyScalar(.5);
      m.addScaledVector(u, (rand() - .5) * amp).addScaledVector(v, (rand() - .5) * amp);
      next.push(m, pts[i]);
    }
    pts.length = 0; pts.push(...next); amp *= .52;
  }
  out.length = 0; out.push(...pts); return out;
}

export function createLightningFx({scene, quality = 1} = {}) {
  const C = LIGHTNING_CAPS, quadCap = Math.round(C.quads * (quality < 1 ? .6 : 1));
  // ---- arcs: one dynamic ribbon mesh
  const pos = new Float32Array(quadCap * 4 * 3), uv = new Float32Array(quadCap * 4 * 2), col = new Float32Array(quadCap * 4 * 3), idx = new Uint32Array(quadCap * 6);
  for (let q = 0; q < quadCap; q++) { const v = q * 4; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const arcMat = new THREE.MeshBasicMaterial({map: gradientTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false});
  const arcMesh = new THREE.Mesh(geo, arcMat); arcMesh.frustumCulled = false; arcMesh.renderOrder = 12; arcMesh.name = 'LightningArcs';
  arcMesh.raycast = () => {}; arcMesh.userData.ignoreContact = true;
  const arcs = [];
  // ---- sparks
  const sparkPos = new Float32Array(C.sparks * 3), sparkCol = new Float32Array(C.sparks * 3), sparks = [];
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const dot = dotTexture();
  const sparkMat = new THREE.PointsMaterial({size: .07, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false});
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat); sparkPoints.frustumCulled = false; sparkPoints.renderOrder = 12; sparkPoints.raycast = () => {};
  // ---- glows (billboard quads, instanced) and ground rings (instanced, flat)
  const glowMat = new THREE.MeshBasicMaterial({map: dot, color: 0x9fdcff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false});
  const glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, C.glows); glowMesh.count = 0; glowMesh.frustumCulled = false; glowMesh.renderOrder = 13; glowMesh.raycast = () => {};
  glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(C.glows * 3), 3);
  const ringGeo = new THREE.RingGeometry(.86, 1, 48).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({color: 0x6fd2ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false});
  const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, C.rings); ringMesh.count = 0; ringMesh.frustumCulled = false; ringMesh.renderOrder = 11; ringMesh.raycast = () => {};
  ringMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(C.rings * 3), 3);
  const glows = [], rings = [];
  const object = new THREE.Group(); object.name = 'LightningFx'; object.add(arcMesh, sparkPoints, glowMesh, ringMesh);
  object.traverse(n => { n.userData.ignoreContact = true; });
  scene?.add(object);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), side = new THREE.Vector3(), eye = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), c3 = new THREE.Color();

  /**
   * Strike an arc from a to b. Options: life (s), width (m), rough, branches (forks), restrikes (bright pulses),
   * follow (a function returning [a, b] each frame, for arcs that ride moving things), hue (THREE.Color multiplier).
   */
  function strike(a, b, {life = .28, width = .07, rough = .16, depth = 5, branches = 2, restrikes = 2, follow = null, intensity = 1, hue = null} = {}) {
    if (arcs.length >= C.arcs) arcs.shift();
    const arc = {a: a.clone(), b: b.clone(), life, age: 0, width, rough, depth, branches, restrikes, follow, intensity, hue, paths: [], next: 0};
    arcs.push(arc); return arc;
  }
  function refork(arc) {
    arc.paths.length = 0;
    const main = jagged(arc.a, arc.b, {depth: arc.depth, rough: arc.rough});
    arc.paths.push({pts: main, w: 1});
    for (let k = 0; k < arc.branches; k++) {
      const i = 1 + Math.floor(Math.random() * (main.length * .7)), from = main[Math.min(i, main.length - 2)];
      const len = arc.a.distanceTo(arc.b) * (.15 + Math.random() * .25);
      const dir = main[Math.min(i + 1, main.length - 1)].clone().sub(from).normalize();
      dir.x += (Math.random() - .5) * 1.4; dir.y += (Math.random() - .5) * 1.4; dir.z += (Math.random() - .5) * 1.4; dir.normalize();
      arc.paths.push({pts: jagged(from, from.clone().addScaledVector(dir, len), {depth: Math.max(2, arc.depth - 2), rough: arc.rough * 1.3}), w: .45});
    }
  }
  function burst(at, {count = 24, speed = 4, up = .6, normal = null, life = .5, molten = false} = {}) {
    const n = normal ? (normal.isVector3 ? normal : tmp2.fromArray(normal)) : null;
    for (let i = 0; i < count; i++) {
      if (sparks.length >= C.sparks) sparks.shift();
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5 + up, Math.random() - .5).normalize().multiplyScalar(speed * (.35 + Math.random() * .65));
      if (n && v.dot(n) < 0) v.addScaledVector(n, -2 * v.dot(n));
      sparks.push({p: (at.isVector3 ? at : tmp.fromArray(at)).clone(), v, age: 0, life: life * (.5 + Math.random() * .7), molten});
    }
  }
  function glow(at, {size = 1.6, life = .35, color = 0x9fdcff} = {}) {
    if (glows.length >= C.glows) glows.shift();
    glows.push({p: (at.isVector3 ? at : tmp.fromArray(at)).clone(), size, life, age: 0, color: new THREE.Color(color)});
  }
  function ring(at, {radius = 2.5, life = .5, color = 0x6fd2ff} = {}) {
    if (rings.length >= C.rings) rings.shift();
    rings.push({p: (at.isVector3 ? at : tmp.fromArray(at)).clone(), radius, life, age: 0, color: new THREE.Color(color)});
  }

  let quadsUsed = 0;
  function writeRibbon(pts, width, bright, hue, camPos) {
    for (let i = 1; i < pts.length && quadsUsed < quadCap; i++) {
      const a = pts[i - 1], b = pts[i];
      tmp.subVectors(b, a); eye.subVectors(camPos, a);
      side.crossVectors(tmp, eye); const l = side.length(); if (l < 1e-6) continue; side.multiplyScalar(width / l);
      const base = quadsUsed * 4, t0 = (i - 1) / (pts.length - 1), t1 = i / (pts.length - 1);
      const taper0 = 1 - t0 * .55, taper1 = 1 - t1 * .55;
      pos.set([a.x + side.x * taper0, a.y + side.y * taper0, a.z + side.z * taper0, a.x - side.x * taper0, a.y - side.y * taper0, a.z - side.z * taper0,
        b.x + side.x * taper1, b.y + side.y * taper1, b.z + side.z * taper1, b.x - side.x * taper1, b.y - side.y * taper1, b.z - side.z * taper1], base * 3);
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], base * 2);
      c3.copy(CORE).lerp(BLUE, .25); if (hue) c3.multiply(hue); c3.multiplyScalar(bright);
      for (let k = 0; k < 4; k++) col.set([c3.r, c3.g, c3.b], (base + k) * 3);
      quadsUsed++;
    }
  }

  function update(dt, camera) {
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    quadsUsed = 0;
    for (let i = arcs.length - 1; i >= 0; i--) {
      const arc = arcs[i]; arc.age += dt;
      if (arc.age >= arc.life) { arcs.splice(i, 1); continue; }
      if (arc.follow) { const [a, b] = arc.follow(); if (a && b) { arc.a.copy(a); arc.b.copy(b); } }
      arc.next -= dt; if (arc.next <= 0 || !arc.paths.length) { refork(arc); arc.next = 1 / 22 + Math.random() * .03; }
      // Strike-and-restrike envelope: a bright first stroke, then dimmer return strokes, then a fade.
      const t = arc.age / arc.life, pulses = Math.max(1, arc.restrikes + 1), phase = (t * pulses) % 1;
      const bright = arc.intensity * (1 - t * .6) * (.55 + .45 * Math.exp(-phase * 6));
      for (const path of arc.paths) writeRibbon(path.pts, arc.width * path.w * (.8 + .4 * Math.exp(-phase * 5)), bright * (path.w < 1 ? .7 : 1), arc.hue, camPos);
    }
    geo.setDrawRange(0, quadsUsed * 6);
    if (quadsUsed) { geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
    arcMesh.visible = quadsUsed > 0;
    // sparks: ballistic, cooling from white to blue to nothing
    let n = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.age += dt; if (s.age >= s.life) { sparks.splice(i, 1); continue; }
      s.v.y -= 9 * dt; s.v.multiplyScalar(Math.exp(-1.5 * dt)); s.p.addScaledVector(s.v, dt);
    }
    for (const s of sparks) { const k = 1 - s.age / s.life; sparkPos.set([s.p.x, s.p.y, s.p.z], n * 3); c3.copy(CORE).lerp(s.molten ? MOLTEN : BLUE, s.molten ? Math.sqrt(1 - k) : 1 - k).multiplyScalar(k * 1.4); sparkCol.set([c3.r, c3.g, c3.b], n * 3); n++; }
    sparkGeo.setDrawRange(0, n); if (n) { sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true; }
    sparkPoints.visible = n > 0;
    // glows face the camera
    let g = 0; camera.getWorldQuaternion(q);
    for (let i = glows.length - 1; i >= 0; i--) { const o = glows[i]; o.age += dt; if (o.age >= o.life) glows.splice(i, 1); }
    for (const o of glows) { const k = 1 - o.age / o.life, s = o.size * (.6 + .4 * k); m4.compose(o.p, q, s3.set(s, s, s)); glowMesh.setMatrixAt(g, m4); glowMesh.setColorAt(g, c3.copy(o.color).multiplyScalar(k * k)); g++; }
    glowMesh.count = g; if (g) { glowMesh.instanceMatrix.needsUpdate = true; glowMesh.instanceColor.needsUpdate = true; }
    let r = 0;
    for (let i = rings.length - 1; i >= 0; i--) { const o = rings[i]; o.age += dt; if (o.age >= o.life) rings.splice(i, 1); }
    for (const o of rings) { const t = o.age / o.life, s = o.radius * (.25 + .75 * Math.sqrt(t)); m4.compose(tmp.copy(o.p).setY(o.p.y + .06), q.identity(), s3.set(s, 1, s)); ringMesh.setMatrixAt(r, m4); ringMesh.setColorAt(r, c3.copy(o.color).multiplyScalar((1 - t) ** 1.5)); r++; }
    ringMesh.count = r; if (r) { ringMesh.instanceMatrix.needsUpdate = true; ringMesh.instanceColor.needsUpdate = true; }
  }
  return {object, strike, burst, glow, ring, update,
    busy: () => arcs.length + sparks.length + glows.length + rings.length > 0,
    stats: () => ({arcs: arcs.length, quads: quadsUsed, sparks: sparks.length, glows: glows.length, rings: rings.length}),
    dispose() { object.removeFromParent(); geo.dispose(); arcMat.map.dispose(); arcMat.dispose(); sparkGeo.dispose(); sparkMat.dispose(); dot.dispose(); glowMesh.geometry.dispose(); glowMat.dispose(); ringGeo.dispose(); ringMat.dispose(); }};
}
