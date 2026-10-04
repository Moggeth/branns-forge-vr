// Waygate presentation: rune glow on the sanctuary menhirs, the portal in the trilithon, the return circle at the
// destination, and their sound. Reads snapshot.waygate (shared/waygate.js); never changes gameplay.
// Budget: two extra draws while the gate is open (portal, return circle), none while it is shut. No lights or textures.
import * as THREE from 'three';
import {GATE, WAYSTONES, currentDestination} from '../shared/waygate.js';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16]; // stone index -> scale step; the full ring is a rising pentatonic chord

function portalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uOpen: {value: 0}},
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime,uOpen;varying vec2 vUv;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec2 p=vUv*2.-1.;float r=length(p),a=atan(p.y,p.x);
        float edge=smoothstep(uOpen,uOpen-.08,r);if(edge<=0.)discard;
        float swirl=n(vec2(a*2.5+uTime*.7-r*5.,r*4.-uTime*1.3))*.65+n(vec2(a*6.-uTime*1.1,r*9.))*.35;
        float rim=smoothstep(uOpen-.32,uOpen-.02,r);
        vec3 deep=vec3(.05,.22,.5),bright=vec3(.45,.9,1.3);
        vec3 c=mix(deep,bright,swirl*.7+rim*.8);
        float alpha=(.35+swirl*.35+rim*.6)*edge;
        gl_FragColor=vec4(c*alpha,alpha);
      }`,
  });
}

export function createWaygateView({scene, startingWorld, height, audio = () => null, listener = () => null, report = () => {}}) {
  const group = new THREE.Group(); group.name = 'Waygate'; scene.add(group);
  const portalGeo = new THREE.CircleGeometry(1, 48), portalMat = portalMaterial();
  const portal = new THREE.Mesh(portalGeo, portalMat); portal.scale.set(0.8, 1.8, 1); portal.rotation.y = Math.PI / 2; portal.visible = false;
  portal.renderOrder = 5; group.add(portal);
  const circleGeo = new THREE.RingGeometry(0.55, 0.85, 40, 1), circleMat = portalMaterial();
  const circle = new THREE.Mesh(circleGeo, circleMat); circle.rotation.x = -Math.PI / 2; circle.visible = false; circle.renderOrder = 5; group.add(circle);
  const levels = Array(WAYSTONES.length).fill(0), flash = Array(WAYSTONES.length).fill(0);
  let open = 0, wasOpen = false, seconds = 0, destKey = '';

  // Glassy stone bell: the struck stone's note, brighter and longer when it is the one that completes the chord.
  function bell(position, step, level, decay) {
    const ctx = audio(); if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, ear = listener(), d = ear ? Math.hypot(position[0] - ear.position[0], position[2] - ear.position[2]) : 0;
    const gain = level * Math.max(0, 1 - d / 45); if (gain < 0.004) return;
    const bus = ctx.createGain(); bus.gain.value = gain; bus.connect(ctx.destination);
    const f = 196 * Math.pow(2, step / 12);
    for (const [ratio, amp] of [[1, 1], [2.0, 0.45], [2.98, 0.25], [4.16, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + ratio * 0.3));
      o.connect(g).connect(bus); o.start(t); o.stop(t + decay + 0.1); o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    setTimeout(() => bus.disconnect(), (decay + 0.3) * 1000);
  }
  // Opening swell: the whole chord rolled upward over a low hum.
  function chord(position) { PENTA.forEach((s, i) => setTimeout(() => bell(position, s, 0.09, 3.2), i * 70)); bell(position, -12, 0.14, 4); }
  function whoosh(position, level = 0.12) {
    const ctx = audio(); if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.75); o.onended = () => { o.disconnect(); g.disconnect(); };
    void position;
  }

  function handleEvent(event, playerId) {
    if (event.kind === 'waystone_ring') { flash[event.index] = 1; bell(event.position, PENTA[event.index] ?? 0, 0.16, 2.2); }
    else if (event.kind === 'waygate_open') { chord(event.position); report(`The waygate is open to ${event.name} for 60 seconds. Walk through the trilithon.`); }
    else if (event.kind === 'waygate_tune') { bell(event.position, 12, 0.12, 1.4); report(`The waygate is tuned to ${event.name}.`); }
    else if (event.kind === 'waygate_close') bell(event.position, -5, 0.1, 2.5);
    else if (event.kind === 'waygate_travel') { whoosh(event.position, event.id === playerId ? 0.16 : 0.06); }
  }

  function update(snapshot, dt) {
    seconds += dt;
    const w = snapshot?.landmarks ? snapshot.waygate : null, tick = snapshot?.tick ?? 0, isOpen = !!w && tick < w.openUntil;
    for (let i = 0; i < levels.length; i++) {
      const left = w ? (w.lit[i] - tick) / 60 : 0;
      const target = isOpen ? 1 : left > 0 ? Math.min(1, 0.55 + left / 6) : 0;
      levels[i] += (Math.max(target, flash[i]) - levels[i]) * Math.min(1, dt * 6);
      flash[i] = Math.max(0, flash[i] - dt * 1.5);
    }
    open += ((isOpen ? 1 : 0) - open) * Math.min(1, dt * (isOpen ? 2.2 : 3.5));
    if (open < 0.01 && !isOpen) open = 0;
    startingWorld.setLit?.(levels); startingWorld.tick?.(seconds, open);
    portal.visible = circle.visible = open > 0;
    if (open > 0) {
      const gy = height(GATE.x, GATE.z);
      portal.position.set(GATE.x, gy + 1.8, GATE.z);
      portalMat.uniforms.uTime.value = seconds; portalMat.uniforms.uOpen.value = 0.06 + open * 0.94;
      if (w) { const d = currentDestination(snapshot); const key = d.id + d.x + d.z;
        if (key !== destKey) { destKey = key; circle.position.set(d.x, height(d.x, d.z) + 0.06, d.z); } }
      circleMat.uniforms.uTime.value = seconds * 1.4; circleMat.uniforms.uOpen.value = 0.06 + open * 0.94;
    }
    wasOpen = isOpen;
  }
  function stats() { return {open: wasOpen, amount: open, draws: portal.visible ? 2 : 0, lit: levels.filter(l => l > 0.5).length}; }
  function dispose() { scene.remove(group); portalGeo.dispose(); portalMat.dispose(); circleGeo.dispose(); circleMat.dispose(); }
  return {group, handleEvent, update, stats, dispose, targets: () => []};
}
