import * as THREE from 'three';

// Explosions: a billowing fireball, a rolling smoke column, a ground shock ring and a scorch mark that fades.
// Presentation only, driven by authoritative blast events (a powder keg, a bursting Kettlebelly). Every piece is
// pooled and shares one material per layer, so a chain of kegs costs no new shaders and no allocation:
//   fire    a noise-displaced sphere, white-hot at the core cooling through gold and orange to soot; additive, 0.5 s
//   smoke   the same shape in soot and grey, rising and swelling for ~2 s, alpha-blended and soft-edged
//   ring    a dust-and-heat band racing out along the ground to the blast radius
//   scorch  a dark burnt disc on the ground under it, fading over a few seconds
// Style: 'keg' (black powder: orange fire, black smoke), 'kettle' (a boiler: steam-white flash and white cloud) or
// 'crystal' (a golem's heart: blue-white flash and resonance ring only).
// Budget: POOL blasts at once (the oldest recycles), four draws each while alive, zero when idle; phones get a lower
// sphere detail. No lights: the fire is emissive, so it never changes the scene's light count (no shader rebuilds).
//
//   const fx = createBlastFx({scene, height, quality});
//   fx.blast([x,y,z], 'keg', radius); fx.update(dt); fx.stats(); fx.dispose();

export const BLAST_FX = Object.freeze({pool: 4, fire: .55, smoke: 2.2, ring: .6, scorch: 7});

const NOISE = `
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n3(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}`;
// uP: x = progress 0..1, y = seed, z = billow amount, w = upward stretch.
const BALL_VERT = `uniform vec4 uP;varying float vN;varying vec3 vNrm;varying vec3 vView;${NOISE}
void main(){vec3 p=position;float n=fbm(p*1.6+vec3(uP.y,uP.y*.7,uP.x*1.8));vN=n;
 p*=1.+uP.z*(n-.45);p.y*=1.+uP.w*max(p.y,0.);
 vec4 mv=modelViewMatrix*vec4(p,1.);vView=-mv.xyz;vNrm=normalMatrix*normal;gl_Position=projectionMatrix*mv;}`;
const FIRE_FRAG = `uniform vec4 uP;uniform float uOpacity;uniform vec3 uHot;uniform vec3 uWarm;varying float vN;varying vec3 vNrm;varying vec3 vView;
void main(){float rim=clamp(dot(normalize(vNrm),normalize(vView)),0.,1.);
 float heat=clamp(rim*1.25+vN*.6-uP.x*1.15,0.,1.); // the core stays hot longest; the edge and the late ball cool first
 vec3 c=mix(vec3(.18,.05,.02),uWarm,smoothstep(.05,.45,heat));c=mix(c,uHot,smoothstep(.55,.95,heat));
 float a=uOpacity*smoothstep(.05,.6,rim+vN*.25-.1)*(.3+.7*heat);gl_FragColor=vec4(c*a*1.35,a);}`;
const SMOKE_FRAG = `uniform vec4 uP;uniform float uOpacity;uniform vec3 uTint;varying float vN;varying vec3 vNrm;varying vec3 vView;
void main(){float rim=clamp(dot(normalize(vNrm),normalize(vView)),0.,1.);
 float shade=.55+.45*vN+.25*normalize(vNrm).y; // lit from above, lumpy
 float a=uOpacity*smoothstep(.1,.8,rim)*smoothstep(.35,.75,vN+.1+.25*rim);gl_FragColor=vec4(uTint*shade,a);}`;
const FLAT_VERT = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const RING_FRAG = `uniform float uOpacity;uniform vec3 uColor;varying vec2 vUv;void main(){float r=length(vUv*2.-1.);
 float band=smoothstep(.6,.9,r)*(1.-smoothstep(.92,1.,r));gl_FragColor=vec4(uColor,band*uOpacity);}`;
const SCORCH_FRAG = `uniform float uOpacity;uniform float uSeed;varying vec2 vUv;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5);}
void main(){vec2 p=vUv*2.-1.;float r=length(p),a=atan(p.y,p.x);float edge=.7+.12*sin(a*5.+uSeed)+.06*sin(a*11.+uSeed*2.)+.05*h(vec2(floor(a*9.),2.));
 float m=(1.-smoothstep(edge-.5,edge+.05,r))*(.8+.2*sin(r*18.+uSeed));gl_FragColor=vec4(vec3(.05,.04,.035),m*uOpacity*.85);}`;

const STYLES = {
  keg: {hot: [1, .86, .55], warm: [1, .42, .06], smoke: [.2, .18, .16], ring: [1, .7, .35], scorch: true, size: .32, smokeSize: .3, rise: 2.6},
  // A golem's crystal heart giving way: a cold blue-white flash and a resonance ring, no smoke and no scorch.
  crystal: {hot: [.85, .97, 1], warm: [.25, .62, 1], smoke: [0, 0, 0], ring: [.45, .8, 1], scorch: false, smokeless: true, size: .3, smokeSize: 0, rise: 0},
  kettle: {hot: [1, .97, .88], warm: [.9, .62, .35], smoke: [.9, .92, .94], ring: [.95, .97, 1], scorch: false, size: .18, smokeSize: .3, rise: 1.8},
};
const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

export function createBlastFx({scene, height = () => 0, quality = 'high'} = {}) {
  const low = quality === 'low', detail = low ? 3 : 4;
  const ballGeo = new THREE.IcosahedronGeometry(1, detail), discGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const make = () => {
    const fire = new THREE.Mesh(ballGeo, new THREE.ShaderMaterial({vertexShader: BALL_VERT, fragmentShader: FIRE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {uP: {value: new THREE.Vector4()}, uOpacity: {value: 0}, uHot: {value: new THREE.Color()}, uWarm: {value: new THREE.Color()}}}));
    const smoke = new THREE.Mesh(ballGeo, new THREE.ShaderMaterial({vertexShader: BALL_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false,
      uniforms: {uP: {value: new THREE.Vector4()}, uOpacity: {value: 0}, uTint: {value: new THREE.Color()}}}));
    const ring = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({vertexShader: FLAT_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
      uniforms: {uOpacity: {value: 0}, uColor: {value: new THREE.Color()}}}));
    const scorch = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({vertexShader: FLAT_VERT, fragmentShader: SCORCH_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: {uOpacity: {value: 0}, uSeed: {value: 0}}}));
    fire.renderOrder = 6; smoke.renderOrder = 5; ring.renderOrder = 4; scorch.renderOrder = 1;
    const parts = {fire, smoke, ring, scorch};
    for (const [k, m] of Object.entries(parts)) { m.name = `blast-${k}`; m.visible = false; m.frustumCulled = false; m.userData.ignoreContact = true; scene?.add(m); }
    return {...parts, age: Infinity, alive: false, radius: 3, style: STYLES.keg, seed: 0, x: 0, y: 0, z: 0, gy: 0};
  };
  const pool = Array.from({length: BLAST_FX.pool}, make);
  let next = 0, live = 0;
  const stats = {blasts: 0, recycled: 0};

  function blast(position, style = 'keg', radius = 3) {
    if (!Array.isArray(position)) return;
    const b = pool[next]; next = (next + 1) % pool.length;
    if (b.alive) stats.recycled++; else live++;
    const S = STYLES[style] || STYLES.keg;
    Object.assign(b, {alive: true, age: 0, radius, style: S, seed: (Math.abs(position[0] * 13.1 + position[2] * 7.7) % 50) + stats.blasts * 3.3, x: position[0], y: position[1], z: position[2], gy: height(position[0], position[2])});
    b.fire.material.uniforms.uHot.value.setRGB(...S.hot); b.fire.material.uniforms.uWarm.value.setRGB(...S.warm);
    b.smoke.material.uniforms.uTint.value.setRGB(...S.smoke); b.ring.material.uniforms.uColor.value.setRGB(...S.ring);
    b.scorch.material.uniforms.uSeed.value = b.seed;
    b.fire.position.set(b.x, b.y + .45, b.z); b.ring.position.set(b.x, b.gy + .12, b.z); b.scorch.position.set(b.x, b.gy + .03, b.z);
    b.scorch.rotation.y = b.seed;
    stats.blasts++;
    pose(b);
  }
  function pose(b) {
    const a = b.age, S = b.style, R = b.radius;
    // Fire: punches out fast (ease-out), then cools and sags.
    const fu = a / BLAST_FX.fire, fire = b.fire.material.uniforms;
    b.fire.visible = fu < 1;
    if (b.fire.visible) {
      const grow = 1 - (1 - Math.min(1, fu * 2.2)) ** 3;
      b.fire.scale.setScalar(R * S.size * (.25 + .85 * grow));
      fire.uP.value.set(fu, b.seed, .55 + .35 * fu, .25 * fu); fire.uOpacity.value = .8 * (1 - smooth(fu)) ** 1.3;
    }
    // Smoke: takes over from the fire, rolls up and out, then thins.
    const su = a / BLAST_FX.smoke, smoke = b.smoke.material.uniforms;
    b.smoke.visible = !S.smokeless && a > .06 && su < 1;
    if (b.smoke.visible) {
      const k = 1 - (1 - su) ** 2;
      b.smoke.position.set(b.x, b.y + .5 + S.rise * k, b.z);
      b.smoke.scale.setScalar(R * S.smokeSize * (.35 + .75 * k));
      smoke.uP.value.set(su, b.seed + 4, .7, .2 + .3 * su); smoke.uOpacity.value = smooth(a / .25) * (1 - smooth((su - .3) / .7)) * .6;
    }
    // Shock ring: races out to the edge of the blast in a third of a second, then fades.
    const ru = a / BLAST_FX.ring, ring = b.ring.material.uniforms;
    b.ring.visible = ru < 1;
    if (b.ring.visible) { b.ring.scale.setScalar(.3 + R * (1 - (1 - Math.min(1, ru * 1.6)) ** 2)); ring.uOpacity.value = (1 - smooth(ru)) * .35; }
    // Scorch: appears under the fire and fades long after.
    const cu = a / BLAST_FX.scorch, sc = b.scorch.material.uniforms;
    b.scorch.visible = S.scorch && cu < 1;
    if (b.scorch.visible) { b.scorch.scale.setScalar(R * .55 * (.5 + .5 * smooth(a / .15))); sc.uOpacity.value = smooth(a / .1) * (1 - smooth((cu - .5) / .5)); }
    if (!b.fire.visible && !b.smoke.visible && !b.ring.visible && !b.scorch.visible) { b.alive = false; live--; }
  }
  function update(dt) {
    if (!live) return;
    dt = Math.min(Math.max(dt || 0, 0), 1 / 15);
    for (const b of pool) if (b.alive) { b.age += dt; pose(b); }
  }
  function dispose() {
    for (const b of pool) for (const k of ['fire', 'smoke', 'ring', 'scorch']) { b[k].removeFromParent(); b[k].material.dispose(); }
    ballGeo.dispose(); discGeo.dispose();
  }
  return {blast, update, dispose, stats: () => ({...stats, live, pool: pool.length}), pool};
}
