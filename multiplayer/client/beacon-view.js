// Watch-Arch beacon presentation: the blue watch-fire in the bronze basket, its beam into the sky (seen from anywhere
// in the meadow; it pulses red on an alarm), a flare over every hostile while it burns, and its sounds and messages.
// Reads snapshot.beacon (shared/watch-beacon.js); never changes gameplay.
// Budget: nothing while cold; five draws while lit (flame, beam, foe flares as one instanced mesh, and the glow from
// client/beacon-glow.js: halo/sparks/owl eyes, ground pool). No lights/textures.
import * as THREE from 'three';
import {BEACON, BEACON_HEARTH} from '../shared/watch-beacon.js';
import {createLandmarkAudio} from './landmark-audio.js';
import {createBeaconGlow} from './beacon-glow.js';

const MAX_FLARES = 24;
const noise = `float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}`;
const additive = {transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false};

// Flame: three crossed quads, a flickering tongue of blue-white crystal fire rising from the coals.
function flameMaterial() {
  return new THREE.ShaderMaterial({...additive,
    uniforms: {uTime: {value: 0}, uLit: {value: 0}, uAlarm: {value: 0}},
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime,uLit,uAlarm;varying vec2 vUv;${noise}
      void main(){
        float y=vUv.y,x=vUv.x*2.-1.;
        float wob=(n(vec2(y*3.-uTime*2.2,uTime*.7))-.5)*.5*y;
        float width=sqrt(max(0.,1.-y))*(.6+.4*n(vec2(uTime*3.,y*2.)))*min(1.,y*5.+.45)*.85;
        float tongues=.75+.5*n(vec2(x*4.+uTime*.5,y*2.5-uTime*3.));
        float body=smoothstep(width*tongues,width*.2,abs(x+wob));
        float lick=n(vec2(x*3.+uTime*.3,y*5.-uTime*4.));
        float core=smoothstep(width*.55,0.,abs(x+wob*.6))*smoothstep(.75,.1,y);
        float a=(body*(.8+lick*.7)*smoothstep(1.,.4,y)+core*.7)*uLit;if(a<.01)discard;
        vec3 mid=vec3(.25,.65,1.25),red=vec3(1.3,.35,.18);
        vec3 c=mix(mid,vec3(.85,.97,1.2),clamp(core+smoothstep(.3,0.,y)*body*.5,0.,1.));c=mix(c,red,uAlarm*.75*(.5+.5*y));
        gl_FragColor=vec4(c*a,a);
      }`,
  });
}
// Beam: an open cone of faint light rising from the basket, brightest at the bottom; red pulses on alarm.
function beamMaterial() {
  return new THREE.ShaderMaterial({...additive,
    uniforms: {uTime: {value: 0}, uLit: {value: 0}, uAlarm: {value: 0}},
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime,uLit,uAlarm;varying vec2 vUv;${noise}
      void main(){
        float y=vUv.y,band=.75+.25*n(vec2(vUv.x*8.,y*6.-uTime*.8));
        float a=pow(1.-y,2.2)*.16*band*uLit;if(a<.003)discard;
        vec3 c=mix(vec3(.3,.7,1.2),vec3(1.3,.25,.15),uAlarm);
        gl_FragColor=vec4(c*a,a);
      }`,
  });
}

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
// Compass word for a position as seen from the forge (north is -z; the watch-arch is north, the outcrop east).
export function compass([x, , z]) {
  if (Math.hypot(x, z) < 8) return 'at the forge';
  const a = Math.atan2(x, -z); return 'to the ' + DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

export function createBeaconView({scene, startingWorld, height = null, night = () => 0, audio = () => null, listener = () => null, report = () => {}}) {
  const group = new THREE.Group(); group.name = 'WatchBeacon'; scene.add(group);
  const quad = new THREE.PlaneGeometry(1.25, 2.3); quad.translate(0, 1.0, 0);
  const flameGeo = (() => { const parts = [0, 1, 2].map(i => quad.clone().rotateY(i * Math.PI / 3)); const g = new THREE.BufferGeometry();
    const merge = k => new THREE.Float32BufferAttribute(parts.flatMap(p => Array.from(p.toNonIndexed().attributes[k].array)), k === 'uv' ? 2 : 3);
    g.setAttribute('position', merge('position')); g.setAttribute('uv', merge('uv')); parts.forEach(p => p.dispose()); return g; })();
  quad.dispose();
  const flameMat = flameMaterial(), flame = new THREE.Mesh(flameGeo, flameMat); flame.renderOrder = 6; flame.visible = false; group.add(flame);
  const beamGeo = new THREE.CylinderGeometry(0.14, 0.42, 70, 12, 1, true); beamGeo.translate(0, 35, 0);
  const beamMat = beamMaterial(), beam = new THREE.Mesh(beamGeo, beamMat); beam.renderOrder = 6; beam.visible = false; group.add(beam);
  // Foe flares: thin vertical light shafts over each hostile, fading upward (baked vertex colour, additive).
  const flareGeo = new THREE.CylinderGeometry(0.06, 0.14, 1, 6, 1, true); flareGeo.translate(0, 0.5, 0);
  { const p = flareGeo.attributes.position, c = []; for (let i = 0; i < p.count; i++) { const t = 1 - p.getY(i); c.push(t * t, t * t * 0.28, t * t * 0.12); } flareGeo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); }
  const flareMat = new THREE.MeshBasicMaterial({...additive, vertexColors: true, opacity: 0.8, fog: false});
  const flares = new THREE.InstancedMesh(flareGeo, flareMat, MAX_FLARES); flares.count = 0; flares.visible = false; flares.frustumCulled = false; flares.renderOrder = 6; group.add(flares);
  for (const o of [flame, beam, flares]) o.raycast = () => {};
  const glow = createBeaconGlow({group, height});
  const sound = createLandmarkAudio({audio, listener}), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  let lit = 0, alarm = 0, seconds = 0, hintAt = -1e9, wasNear = false;

  function handleEvent(event, playerId) {
    const mine = event.by === playerId;
    if (event.kind === 'beacon_fed') {
      sound.roar(event.position, event.fresh ? 0.16 : 0.08); sound.chord(event.position, event.fresh ? [-12, -5, 0, 7] : [0, 7], 0.07, 90, 2.4);
      if (event.fresh) report(mine ? 'The watch-fire is lit. It will sound the horn when foes appear, and you will rise here if you fall.' : 'The watch-fire on the Watch-Arch is lit.');
      else if (mine) report('The watch-fire burns longer.');
    } else if (event.kind === 'beacon_needs' && mine) { sound.bell(event.position, -9, 0.08, 0.8); report('The beacon needs Crystal. Mine it at the Crystal Outcrop.'); }
    else if (event.kind === 'beacon_full' && mine) { sound.bell(event.position, 7, 0.06, 0.8); report('The watch-fire is already banked full.'); }
    else if (event.kind === 'beacon_alarm') {
      alarm = 1; sound.horn([BEACON.x, 0, BEACON.z]);
      report(`The watch-fire flares: ${event.added === 1 ? 'a foe' : event.added + ' foes'} ${compass(event.toward)}!`);
    } else if (event.kind === 'beacon_out') { sound.roar(event.position, 0.05, 0.8); report('The watch-fire has burned out.'); }
    else if (event.kind === 'respawn' && event.id === playerId && Math.hypot(event.position[0] - BEACON_HEARTH.x, event.position[2] - BEACON_HEARTH.z) < 0.5) report('You rise at the Watch-Arch hearth.');
  }

  function update(snapshot, dt) {
    seconds += dt;
    const b = snapshot?.landmarks ? snapshot.beacon : null, tick = snapshot?.tick ?? 0, burning = !!b && tick < b.litUntil;
    lit += ((burning ? 1 : 0) - lit) * Math.min(1, dt * (burning ? 1.6 : 0.8));
    alarm = Math.max(0, alarm - dt * 0.25);
    const at = startingWorld.beacon?.(), show = lit > 0.01 && !!at;
    flame.visible = beam.visible = show; flares.visible = show && flares.count > 0;
    // A one-time nudge when a Hero walks up to the cold beacon.
    const ear = listener()?.position, near = !!ear && Math.hypot(ear[0] - BEACON.x, ear[2] - BEACON.z) < 5.5;
    if (near && !wasNear && !burning && seconds - hintAt > 90) { hintAt = seconds; report('The beacon is cold. Strike its offering dish with Crystal in your pack to light the watch-fire.'); }
    wasNear = near;
    const pulse = alarm * (0.6 + 0.4 * Math.sin(seconds * 9));
    glow.update({at, lit, night: Math.max(0, Math.min(1, night() || 0)), alarm: pulse, seconds, dt});
    if (!show) { flares.count = 0; return; }
    flame.position.set(at.x, at.y, at.z); flame.rotation.y = seconds * 0.4; flame.scale.setScalar(0.85 + lit * 0.25 + pulse * 0.3);
    beam.position.set(at.x, at.y + 0.4, at.z);
    for (const m of [flameMat, beamMat]) { m.uniforms.uTime.value = seconds; m.uniforms.uLit.value = lit; m.uniforms.uAlarm.value = pulse; }
    beamMat.uniforms.uLit.value = lit * (1 + pulse * 1.5);
    // Flares: nearest hostiles to the viewer, each a shaft 14 m tall bobbing gently.
    const foes = (snapshot.enemies || []).filter(e => e.hp > 0 && e.position);
    if (ear && foes.length > MAX_FLARES) foes.sort((a, c) => Math.hypot(a.position[0] - ear[0], a.position[2] - ear[2]) - Math.hypot(c.position[0] - ear[0], c.position[2] - ear[2]));
    let n = 0;
    for (const e of foes) { if (n >= MAX_FLARES) break;
      m4.compose(p3.set(e.position[0], e.position[1] + 2.2, e.position[2]), q, s3.set(1, 14 * (0.9 + 0.1 * Math.sin(seconds * 2 + n)), 1)); flares.setMatrixAt(n++, m4); }
    flares.count = n; flares.instanceMatrix.needsUpdate = true; flares.visible = n > 0;
    flareMat.opacity = (0.35 + pulse * 0.6) * lit;
  }
  function dispose() { scene.remove(group); flameGeo.dispose(); flameMat.dispose(); beamGeo.dispose(); beamMat.dispose(); flareGeo.dispose(); flareMat.dispose(); flares.dispose(); glow.dispose(); }
  return {handleEvent, update, dispose, stats: () => ({lit, flares: flares.count, draws: show3(flame, beam, flares) + glow.draws()})};
}
const show3 = (...o) => o.filter(x => x.visible).length;
