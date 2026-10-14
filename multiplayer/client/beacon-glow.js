// Watch-fire glow for the beacon (presentation only, drawn by client/beacon-view.js while the fire burns).
// Faked light, no lights: a soft halo round the flame, rising crystal sparks, the bronze owl's eyes glowing, and a
// pool of blue firelight draped over the ground round the tower. All of it swells after dark (night 0..1).
// Budget: two draws while lit (halo + sparks + eyes as one instanced billboard mesh; the ground pool), none while cold.
import * as THREE from 'three';
import {BASKET} from './watch-arch-art.js';

const SPARKS = 56, HALO = 0, EYES = 1, FIRST_SPARK = 3, COUNT = FIRST_SPARK + SPARKS;
const POOL_R = 10, POOL_RINGS = 7, POOL_SEG = 28;
const additive = {transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false};

// One camera-facing quad per instance. kind 0 = halo, 1 = an owl eye, 2 = a spark rising from the coals and fading.
function glowMaterial() {
  return new THREE.ShaderMaterial({...additive,
    uniforms: {uTime: {value: 0}, uLit: {value: 0}, uNight: {value: 0}, uAlarm: {value: 0}, uFire: {value: new THREE.Vector3()},
      uEyeL: {value: new THREE.Vector3()}, uEyeR: {value: new THREE.Vector3()}, uEyes: {value: 0}},
    vertexShader: `attribute vec2 aSeed;attribute float aKind;uniform float uTime,uLit,uNight,uAlarm,uEyes;uniform vec3 uFire,uEyeL,uEyeR;
      varying vec2 vUv;varying float vKind,vFade;
      void main(){
        vUv=position.xy;vKind=aKind;vec3 c;float size;vFade=1.;
        if(aKind<.5){c=uFire+vec3(0.,.35,0.);size=(2.6+3.2*uNight)*(.92+.08*sin(uTime*7.3)+.05*sin(uTime*13.1))*(1.+uAlarm*.4);}
        else if(aKind<1.5){c=aSeed.x<.5?uEyeL:uEyeR;size=.34+.08*uNight;vFade=uEyes*(.85+.15*sin(uTime*3.1+aSeed.x*2.));}
        else{float t=fract(uTime*(.22+.16*aSeed.y)+aSeed.x*7.31);float a=aSeed.x*43.7+t*(2.+aSeed.y*3.);
          float r=.12+.35*aSeed.y+t*(.5+aSeed.x*.6);
          c=uFire+vec3(cos(a)*r,.15+t*(2.6+2.2*aSeed.y),sin(a)*r);
          size=(.07+.06*aSeed.y)*(1.-t*.6);vFade=smoothstep(0.,.08,t)*(1.-t)*(1.-t);}
        vec4 mv=modelViewMatrix*vec4(c,1.);mv.xy+=position.xy*size;if(aKind<.5){mv.xy+=position.xy*size*clamp(-mv.z/16.-1.,0.,1.5);mv.z+=1.6;} // halo holds its size with distance, and is pulled toward the eye so the parapet does not slice it
        gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform float uLit,uNight,uAlarm;varying vec2 vUv;varying float vKind,vFade;
      void main(){
        float d=length(vUv)*2.;if(d>1.)discard;
        vec3 blue=mix(vec3(.25,.62,1.15),vec3(1.25,.32,.16),uAlarm);float a;vec3 c;
        if(vKind<.5){float core=exp(-d*d*9.),wide=pow(1.-d,2.4);a=(core*.55+wide*(.16+.22*uNight))*uLit;c=mix(blue,vec3(.85,.95,1.15),core);}
        else if(vKind<1.5){float core=exp(-d*d*14.),ring=pow(1.-d,2.);a=(core+ring*.5)*vFade*uLit;c=mix(vec3(.4,.85,1.2),vec3(1.,1.,1.1),core);}
        else{float core=exp(-d*d*10.);a=core*vFade*uLit*(.9+.6*uNight);c=mix(blue,vec3(.95,1.,1.2),core*.7);}
        if(a<.004)discard;gl_FragColor=vec4(c*a,a);}`,
  });
}

// Ground pool: a disc draped on the terrain (heights resampled when the beacon moves), brightest at the tower foot,
// broken by slow flicker; additive, so it reads as blue firelight on the grass at night and almost nothing at noon.
function poolMaterial() {
  return new THREE.ShaderMaterial({...additive, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {uTime: {value: 0}, uLit: {value: 0}, uNight: {value: 0}, uAlarm: {value: 0}},
    vertexShader: 'attribute float aR;varying float vR;varying vec2 vXZ;void main(){vR=aR;vXZ=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime,uLit,uNight,uAlarm;varying float vR;varying vec2 vXZ;
      void main(){
        float fall=pow(1.-vR,1.4);
        float flick=.86+.08*sin(uTime*6.1+vXZ.x*.7)+.06*sin(uTime*9.7-vXZ.y*.9);
        float a=fall*flick*uLit*(.04+.7*uNight);if(a<.003)discard;
        vec3 c=mix(vec3(.22,.55,1.),vec3(1.,.3,.15),uAlarm);gl_FragColor=vec4(c*a,a);}`,
  });
}

export function createBeaconGlow({group, height = null}) {
  const quad = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.instanceCount = COUNT;
  const seeds = new Float32Array(COUNT * 2), kinds = new Float32Array(COUNT);
  kinds[HALO] = 0; kinds[EYES] = 1; kinds[EYES + 1] = 1; seeds[EYES * 2] = 0; seeds[(EYES + 1) * 2] = 1;
  for (let i = FIRST_SPARK; i < COUNT; i++) { kinds[i] = 2; seeds[i * 2] = ((i * 0.618034) % 1); seeds[i * 2 + 1] = ((i * 0.754877 + 0.3) % 1); }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2)); geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  const glowMat = glowMaterial(), glow = new THREE.Mesh(geo, glowMat); glow.frustumCulled = false; glow.renderOrder = 7; glow.visible = false;

  // Polar disc, centre vertex first; aR is the normalised radius for the falloff.
  const pos = [], rr = [], idx = [];
  pos.push(0, 0, 0); rr.push(0);
  for (let r = 1; r <= POOL_RINGS; r++) for (let k = 0; k < POOL_SEG; k++) { const a = k / POOL_SEG * Math.PI * 2, d = (r / POOL_RINGS) ** 1.3 * POOL_R; pos.push(Math.cos(a) * d, 0, Math.sin(a) * d); rr.push(d / POOL_R); }
  for (let k = 0; k < POOL_SEG; k++) idx.push(0, 1 + (k + 1) % POOL_SEG, 1 + k);
  for (let r = 1; r < POOL_RINGS; r++) for (let k = 0; k < POOL_SEG; k++) {
    const a = 1 + (r - 1) * POOL_SEG + k, b = 1 + (r - 1) * POOL_SEG + (k + 1) % POOL_SEG, c = a + POOL_SEG, d = b + POOL_SEG; idx.push(a, b, d, a, d, c); }
  const poolGeo = new THREE.BufferGeometry(); poolGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); poolGeo.setAttribute('aR', new THREE.Float32BufferAttribute(rr, 1)); poolGeo.setIndex(idx);
  const poolMat = poolMaterial(), pool = new THREE.Mesh(poolGeo, poolMat); pool.frustumCulled = false; pool.renderOrder = 5; pool.visible = false;
  for (const o of [glow, pool]) { o.raycast = () => {}; group.add(o); }
  let drapedAt = '', drapeTimer = 0; const e = new THREE.Vector3();

  // Re-drape when the beacon moves (terrain edits) or every couple of seconds; 197 height samples.
  function drape(at, dt) {
    const key = at.x.toFixed(2) + ',' + at.z.toFixed(2) + ',' + at.y.toFixed(2); drapeTimer -= dt;
    if (key === drapedAt && drapeTimer > 0) return; drapedAt = key; drapeTimer = 2;
    const p = poolGeo.attributes.position, ground = at.y - (2.95 + BASKET.fire) + 0.15; // tower foot (starting-world: basket at th - 0.25)
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, (height ? height(at.x + x, at.z + z) : ground) + 0.06); }
    p.needsUpdate = true; pool.position.set(at.x, 0, at.z);
  }

  function update({at, lit, night, alarm, seconds, dt}) {
    const show = lit > 0.01 && !!at; glow.visible = pool.visible = show; if (!show) return;
    drape(at, dt);
    const u = glowMat.uniforms; u.uTime.value = seconds; u.uLit.value = lit; u.uNight.value = night; u.uAlarm.value = alarm; u.uFire.value.set(at.x, at.y, at.z);
    const eyes = BASKET.eyes, c = Math.cos(at.yaw || 0), s = Math.sin(at.yaw || 0), base = at.y - BASKET.fire;
    for (const [side, v] of [[-1, u.uEyeL.value], [1, u.uEyeR.value]]) { e.set(side * eyes.x, eyes.y, eyes.z); v.set(at.x + e.x * c + e.z * s, base + e.y, at.z - e.x * s + e.z * c); }
    u.uEyes.value = at.owl ? 1 : 0;
    const q = poolMat.uniforms; q.uTime.value = seconds; q.uLit.value = lit; q.uNight.value = night; q.uAlarm.value = alarm;
  }
  function dispose() { quad.dispose(); geo.dispose(); glowMat.dispose(); poolGeo.dispose(); poolMat.dispose(); }
  return {update, dispose, draws: () => (glow.visible ? 1 : 0) + (pool.visible ? 1 : 0)};
}
