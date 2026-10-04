import * as THREE from 'three';

// Hero progression and weapon-talent presentation. Presentation only: every effect starts from a host event
// (level_up, talent_learned, firebomb, geode_burst, skewer pierce, tar spill) and animates every rendered frame from
// the presentation clock, never from network ticks.
//   level_up       a golden column of light on the hero, a ring rolling out across the ground, sparks spiralling up
//   talent_learned a smaller gold flare and spiral on the hero
//   firebomb       an orange fireball flash, a shock ring at the bomb's radius and flung embers
//   geode_burst    blue crystal shards bursting from each wall segment, with a flash at each
//   pierce skewer  a short white streak where the bolt punched through
// Budget (Quest/phone safe): a fixed pool of 8 effects, each at most three draws (column, ring, one Points cloud),
// shared geometry, no lights, no shadows, no post.

export const TALENT_FX = Object.freeze({pool: 8, sparks: 56});
const GOLD = new THREE.Color(1, .78, .3), WHITE_GOLD = new THREE.Color(1, .95, .75), FIRE = new THREE.Color(1, .45, .12),
  EMBER = new THREE.Color(1, .72, .3), RESONANCE = new THREE.Color(.25, .6, 1), SHARD = new THREE.Color(.75, .92, 1), TAR = new THREE.Color(.55, .38, .2);

const COLUMN_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const COLUMN_FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform float uFade, uTime;
varying vec2 vUv;
void main() {
  // Bright at the ground, thinning to nothing overhead; slow bands climb the column.
  float rise = pow(1. - vUv.y, 1.6), bands = .75 + .25 * sin(vUv.y * 22. - uTime * 9. + vUv.x * 6.2832 * 3.);
  float a = rise * bands * uFade;
  gl_FragColor = vec4(uColor * a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const RING_FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform float uFade;
varying vec2 vUv;
void main() {
  // A soft bright band at the rim with a faint wash inside it (distance from the plane's centre in uv space).
  float r = length(vUv - .5) * 2.;
  float band = exp(-pow((r - .86) * 9., 2.)) + .18 * smoothstep(.86, 0., r);
  gl_FragColor = vec4(uColor * band * uFade, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Round soft sparks with a clamped on-screen size (a spark right at your eye never fills the view).
const SPARK_VERTEX = /* glsl */`
uniform float uSize, uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(.1, -mv.z), 1., 18.);
}`;
const SPARK_FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - .5) * 2.;
  float a = pow(max(0., 1. - d), 2.) * uOpacity;
  gl_FragColor = vec4(uColor * a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * scene: THREE scene. height(x,z): ground height. heroPosition(id): live presented position of a hero
 * (local player included) or null, so the column rides a hero who keeps moving. viewerInside(id): true when the camera
 * stands inside that hero (first person), so their own column opens wider and stays a soft veil instead of a gold wall.
 */
export function createTalentFx({scene, height = () => 0, heroPosition = () => null, viewerInside = () => false, reducedMotion = false} = {}) {
  const columnGeo = new THREE.CylinderGeometry(.55, .75, 6, 24, 1, true); columnGeo.translate(0, 3, 0);
  const ringGeo = new THREE.PlaneGeometry(2, 2); ringGeo.rotateX(-Math.PI / 2);
  const pool = [];
  for (let i = 0; i < TALENT_FX.pool; i++) {
    const column = new THREE.Mesh(columnGeo, new THREE.ShaderMaterial({uniforms: {uColor: {value: GOLD.clone()}, uFade: {value: 0}, uTime: {value: 0}},
      vertexShader: COLUMN_VERTEX, fragmentShader: COLUMN_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
    const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({uniforms: {uColor: {value: GOLD.clone()}, uFade: {value: 0}},
      vertexShader: COLUMN_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    const positions = new Float32Array(TALENT_FX.sparks * 3), sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    sparkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const sparks = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({uniforms: {uColor: {value: WHITE_GOLD.clone()}, uOpacity: {value: 0}, uSize: {value: .16}, uScale: {value: 450}},
      vertexShader: SPARK_VERTEX, fragmentShader: SPARK_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    for (const m of [column, ring, sparks]) { m.visible = false; m.frustumCulled = m !== sparks; m.renderOrder = 4; m.userData.ignoreContact = true; scene.add(m); }
    column.name = 'talent-fx-column'; ring.name = 'talent-fx-ring'; sparks.name = 'talent-fx-sparks';
    pool.push({column, ring, sparks, positions, active: false, age: 0, life: 1, kind: '', seeds: [], origin: new THREE.Vector3(), follow: null, radius: 1, points: []});
  }
  let next = 0, clock = 0;
  const take = () => { const fx = pool.find(f => !f.active) || pool[next]; next = (pool.indexOf(fx) + 1) % pool.length; return fx; };

  function start(kind, origin, {life, radius = 1, follow = null, columnColor, ringColor, sparkColor, sparkSize = .16, points = null} = {}) {
    const fx = take();
    Object.assign(fx, {active: true, kind, age: 0, life, radius, follow, points: points || [[origin.x, origin.y, origin.z]]});
    fx.origin.copy(origin);
    fx.column.visible = !!columnColor; if (columnColor) fx.column.material.uniforms.uColor.value.copy(columnColor);
    fx.ring.visible = !!ringColor; if (ringColor) fx.ring.material.uniforms.uColor.value.copy(ringColor);
    fx.sparks.visible = !!sparkColor; if (sparkColor) { fx.sparks.material.uniforms.uColor.value.copy(sparkColor); fx.sparks.material.uniforms.uSize.value = sparkSize; }
    const seed = origin.x * 13.1 + origin.z * 7.7 + clock * 3.3;
    fx.seeds = Array.from({length: TALENT_FX.sparks}, (_, i) => [hash(seed + i), hash(seed + i * 1.7 + 9), hash(seed + i * 2.3 + 17)]);
    update(0);
    return fx;
  }
  const at = (p) => new THREE.Vector3(p[0], Number.isFinite(p[1]) ? p[1] : height(p[0], p[2]), p[2]);

  function handle(event) {
    const kind = event?.kind, p = event?.position;
    if (!Array.isArray(p) || p.length !== 3) return false;
    if (kind === 'level_up') {
      start('level', at(p), {life: 2.6, radius: 4.5, follow: event.id, columnColor: GOLD, ringColor: GOLD, sparkColor: WHITE_GOLD, sparkSize: .18});
      return true;
    }
    if (kind === 'talent_learned') { start('learn', at(p), {life: 1.3, radius: 1.8, follow: event.id, ringColor: GOLD, sparkColor: WHITE_GOLD, sparkSize: .12}); return true; }
    if (kind === 'firebomb') { start('bomb', at(p), {life: .95, radius: event.radius || 2.6, columnColor: FIRE, ringColor: FIRE, sparkColor: EMBER, sparkSize: .2}); return true; }
    if (kind === 'geode_burst') {
      const points = (Array.isArray(event.points) ? event.points : [p]).slice(0, 14);
      start('geode', at(p), {life: 1.1, radius: event.radius || 2.6, ringColor: RESONANCE, sparkColor: SHARD, sparkSize: .17, points});
      return true;
    }
    if (kind === 'pierce' && event.skewer) { start('skewer', at(p), {life: .35, radius: .6, sparkColor: WHITE_GOLD, sparkSize: .09}); return true; }
    if (kind === 'fuel_spill' && event.tar) { start('tar', at([p[0], NaN, p[2]]), {life: .9, radius: event.radius || 2.1, ringColor: TAR}); return true; }
    return false;
  }

  function update(dt) {
    clock += dt;
    for (const fx of pool) {
      if (!fx.active) continue;
      fx.age += dt;
      const t = fx.age / fx.life;
      if (t >= 1) { fx.active = false; fx.column.visible = fx.ring.visible = fx.sparks.visible = false; continue; }
      // A level-up column rides its hero; everything else stays where it happened.
      const followed = fx.follow != null && heroPosition(fx.follow);
      if (followed) fx.origin.set(followed.x, followed.y, followed.z);
      const o = fx.origin, ground = height(o.x, o.z), base = Number.isFinite(ground) ? Math.min(o.y, ground + .05) : o.y;
      const fadeIn = Math.min(1, t * 8), fadeOut = 1 - Math.pow(t, fx.kind === 'level' ? 2.2 : 1.4);
      if (fx.column.visible) {
        const u = fx.column.material.uniforms;
        const inside = fx.follow != null && viewerInside(fx.follow);
        u.uFade.value = fadeIn * fadeOut * (fx.kind === 'level' ? 1.15 : .9) * (inside ? .22 : 1); u.uTime.value = clock;
        const swell = reducedMotion ? 1 : .55 + .45 * Math.min(1, t * 5);
        fx.column.position.set(o.x, base, o.z);
        // A firebomb's column is a squat fireball that balloons and burns out; a level-up column is tall and steady.
        if (fx.kind === 'bomb') fx.column.scale.set(fx.radius * .7 * (.4 + swell), .22 + .2 * swell, fx.radius * .7 * (.4 + swell));
        else { const wide = fx.follow != null && viewerInside(fx.follow) ? 2.4 : 1; fx.column.scale.set(swell * wide, .4 + .6 * Math.min(1, t * 3), swell * wide); }
      }
      if (fx.ring.visible) {
        const roll = reducedMotion ? 1 : 1 - Math.pow(1 - Math.min(1, t * 1.6), 3);
        fx.ring.material.uniforms.uFade.value = fadeOut * (fx.kind === 'tar' ? .7 : 1);
        fx.ring.position.set(o.x, base + .06, o.z); fx.ring.scale.setScalar(Math.max(.05, fx.radius * (fx.kind === 'tar' ? .8 + .2 * roll : roll)));
      }
      if (fx.sparks.visible) {
        const arr = fx.positions, n = TALENT_FX.sparks;
        for (let i = 0; i < n; i++) {
          const [a, b, c] = fx.seeds[i], k = i * 3;
          if (fx.kind === 'level' || fx.kind === 'learn') {
            // Spiral up and out around the hero.
            const s = Math.min(1, t * (.9 + b * .6)), angle = a * 6.2832 + s * (4 + c * 3), r = (fx.kind === 'level' ? .5 : .3) + s * (fx.kind === 'level' ? 1.2 : .6) * b;
            arr[k] = o.x + Math.cos(angle) * r; arr[k + 1] = base + .2 + s * (fx.kind === 'level' ? 4.2 : 2) * (.5 + .5 * c); arr[k + 2] = o.z + Math.sin(angle) * r;
          } else {
            // Burst outward from the source point(s) and fall.
            const src = fx.points[i % fx.points.length], angle = a * 6.2832, speed = (fx.kind === 'skewer' ? 2.5 : fx.radius * 1.6) * (.4 + .6 * b);
            const s = fx.age, up = (fx.kind === 'geode' ? 3.6 : 4.4) * c, gravity = 9.8;
            const sy = Number.isFinite(src[1]) ? src[1] : height(src[0], src[2]);
            arr[k] = src[0] + Math.cos(angle) * speed * s; arr[k + 1] = Math.max(height(src[0], src[2]), sy + .4 + up * s - .5 * gravity * s * s); arr[k + 2] = src[2] + Math.sin(angle) * speed * s;
          }
        }
        fx.sparks.geometry.attributes.position.needsUpdate = true;
        fx.sparks.material.uniforms.uOpacity.value = fadeIn * fadeOut;
      }
    }
  }
  function dispose() {
    for (const fx of pool) for (const m of [fx.column, fx.ring, fx.sparks]) { m.removeFromParent(); m.material.dispose(); if (m === fx.sparks) m.geometry.dispose(); }
    columnGeo.dispose(); ringGeo.dispose();
  }
  return {handle, update, dispose, stats: () => ({active: pool.filter(f => f.active).length})};
}

/** Short synthesized cues (no assets): a rising level-up fanfare, a learn chime, a firebomb whoomph, a crystal shatter. */
export function playTalentSound(context, event, gain = 1) {
  if (!context || gain <= .01 || context.state === 'closed') return false;
  const now = context.currentTime, out = context.createGain();
  out.gain.value = gain; out.connect(context.destination);
  const tone = (hz, at, dur, level, type = 'triangle') => {
    const o = context.createOscillator(), g = context.createGain();
    o.type = type; o.frequency.setValueAtTime(hz, now + at);
    g.gain.setValueAtTime(.0001, now + at); g.gain.exponentialRampToValueAtTime(level, now + at + .015); g.gain.exponentialRampToValueAtTime(.0001, now + at + dur);
    o.connect(g).connect(out); o.start(now + at); o.stop(now + at + dur + .05); o.onended = () => { o.disconnect(); g.disconnect(); };
  };
  const noise = (at, dur, level, filter, hz) => {
    const len = Math.max(1, Math.floor(context.sampleRate * dur)), buf = context.createBuffer(1, len, context.sampleRate), d = buf.getChannelData(0);
    let h = 1234567; for (let i = 0; i < len; i++) { h = Math.imul(h, 48271) % 2147483647; d[i] = ((h / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 2.5); }
    const src = context.createBufferSource(), f = context.createBiquadFilter(), g = context.createGain();
    src.buffer = buf; f.type = filter; f.frequency.value = hz; g.gain.value = level;
    src.connect(f).connect(g).connect(out); src.start(now + at); src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  };
  const kind = event?.kind;
  if (kind === 'level_up') {
    // A bright rising fanfare: C E G C', then a shimmering high chord.
    [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => tone(hz, i * .09, .5, .22));
    [1046.5, 1318.5, 1568].forEach(hz => tone(hz, .4, 1.4, .1, 'sine'));
    noise(.38, .9, .05, 'highpass', 5000);
  } else if (kind === 'talent_learned') { tone(880, 0, .3, .16); tone(1318.5, .08, .55, .14, 'sine'); }
  else if (kind === 'talent_reset') { tone(659.25, 0, .25, .12); tone(440, .1, .4, .1, 'sine'); }
  else if (kind === 'firebomb') { noise(0, .55, .55, 'lowpass', 700); tone(70, 0, .45, .3, 'sine'); }
  else if (kind === 'geode_burst') { noise(0, .45, .25, 'highpass', 2500); [2093, 2637, 3136].forEach((hz, i) => tone(hz, .02 + i * .04, .5, .07, 'sine')); }
  else if (kind === 'pierce') tone(1400, 0, .12, .05, 'sine');
  else { out.disconnect(); return false; }
  setTimeout(() => out.disconnect(), 2500);
  return true;
}
