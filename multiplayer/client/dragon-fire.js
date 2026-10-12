// The streak dragon's fire (docs/VISUAL-FIDELITY-LEVELS.md). Everything is shaped by procedural noise generated once at
// start-up (no downloads). Flames are tongue-shaped billboards stretched along their motion, so licks point the way they
// rise and fast fire streaks like a real jet; each erodes into wisps as it cools from white through yellow and orange to
// deep red. Embers are motion-blurred sparks. Smoke is soft, lit from above and fire-lit underneath while young.
// The breath is physical (shared/dragon-streak.js): a short roaring jet at the mouth, then globs of liquid fire on real
// arcs that splash where they land. Fireballs are churning spheres; impacts flash, throw a dust ring and leave a soot
// mark with cooling cracks that fades away.
//
// Budget (Quest-safe, no lights): 7 draw calls in total, hard caps on every pool (flames 900, smoke 300, jets 4,
// fireballs and globs 160, rings 8, scorch marks 16). Presentation only: the host decides every hit.
import * as THREE from 'three';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const MAX_FLAME = 1100, MAX_SMOKE = 300, MAX_BEAMS = 4, MAX_BALLS = 160, MAX_RINGS = 8, MAX_SCORCH = 16;

// --- Procedural textures ------------------------------------------------------------------------------------------------
function hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/** Tileable fractal value noise in 0..1 sampled at (u, v) in 0..1, `cells` lattice cells across at the first octave. */
function fbm(u, v, cells, octaves, seed) {
  let sum = 0, amp = .5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o, x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = k => ((k % n) + n) % n;
    const a = hash(w(xi), w(yi), seed + o), b = hash(w(xi + 1), w(yi), seed + o), c = hash(w(xi), w(yi + 1), seed + o), d = hash(w(xi + 1), w(yi + 1), seed + o);
    sum += amp * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy); norm += amp; amp *= .5;
  }
  return sum / norm;
}
function dataTexture(size, fill, {repeat = false} = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 4, [r, g = r, b = r, a = 255] = fill(x / size, y / size); data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255; data[i + 3] = a; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
let textures = null;
function sharedTextures() {
  if (textures) return textures;
  // Four puff frames in a 2x2 atlas: a rounded body whose edge is eaten by noise. R = density; G = a second, finer noise
  // the shaders use to erode the puff as it ages, so it breaks into wisps instead of shrinking as a disc.
  const S = 128;
  const puffs = dataTexture(S * 2, (u, v) => {
    const f = (u >= .5 ? 1 : 0) + (v >= .5 ? 2 : 0), x = (u * 2) % 1, y = (v * 2) % 1, dx = x - .5, dy = (y - .5) * 1.08;
    const r = Math.sqrt(dx * dx + dy * dy) * 2, n = fbm(x, y, 4, 4, 11 + f * 7), body = clamp(1 - r * (.85 + .55 * n), 0, 1);
    const edge = Math.min(1, Math.min(x, 1 - x, y, 1 - y) * 14); // keep frames from bleeding into each other
    return [clamp(Math.pow(body, .75) * 1.25, 0, 1) * edge, fbm(x, y, 8, 3, 97 + f), 0];
  });
  // Four flame-tongue frames: a round hot head (top, the way it moves) trailing into a tapering, noise-torn tail.
  // R = density, G = fine noise for erosion.
  const tongues = dataTexture(S * 2, (u, v) => {
    const f = (u >= .5 ? 1 : 0) + (v >= .5 ? 2 : 0), x = (u * 2) % 1, y = (v * 2) % 1, n = fbm(x, y * .7, 4, 4, 31 + f * 5);
    const head = .66 + .06 * (f - 1.5) / 1.5, R = .29, w = y > head ? Math.sqrt(Math.max(0, R * R - (y - head) ** 2)) : R * Math.pow(Math.max(0, (y - .04) / (head - .04)), 1.1);
    const sway = (n - .5) * .18 * (1 - y), body = clamp(1 - Math.abs(x - .5 - sway) / Math.max(1e-3, w * (.75 + .55 * n)), 0, 1);
    const edge = Math.min(1, Math.min(x, 1 - x, y, 1 - y) * 14);
    return [clamp(Math.pow(body, .7) * (.55 + .6 * Math.min(1, y / head)), 0, 1) * edge, fbm(x, y, 8, 3, 131 + f), 0];
  });
  // Tileable noise for the scrolling stream, fireballs, rings and scorch: R coarse, G fine, B a third offset octave.
  const noise = dataTexture(128, (u, v) => [fbm(u, v, 4, 4, 3), fbm(u, v, 8, 3, 5), fbm(u, v, 6, 4, 9)], {repeat: true});
  return textures = {puffs, tongues, noise};
}

// Fire blends premultiplied (src ONE, dst ONE_MINUS_SRC_ALPHA): alpha says how much of the background a fragment hides.
// --- Particle clouds ----------------------------------------------------------------------------------------------------
// kind: 0 flame, 1 ember (fire cloud); 0 smoke, 1 debris (smoke cloud). Rotation spins through life, frame chosen by seed.
const CLOUD_VS = `attribute float size; attribute float age; attribute float seed; attribute float kind; attribute float heat;
  uniform float scale; varying float vAge; varying float vSeed; varying float vKind; varying float vHeat; varying float vRot; varying float vLift;
  void main(){ vAge=age; vSeed=seed; vKind=kind; vHeat=heat; vRot=seed*6.2832+(seed-.5)*3.*age;
    vec4 mv=modelViewMatrix*vec4(position,1.); float s=size*scale/max(.5,-mv.z);
    gl_PointSize=kind>.5?max(s,2.5):s; gl_Position=projectionMatrix*mv; vLift=clamp(position.y*.02,0.,1.); }`;
const PUFF = `uniform sampler2D map; vec2 puffUv(){ vec2 p=gl_PointCoord-.5; float c=cos(vRot),s=sin(vRot); p=vec2(c*p.x-s*p.y,s*p.x+c*p.y)+.5;
  float f=floor(vSeed*3.999); return clamp(p,.02,.98)*.5+vec2(mod(f,2.),floor(f*.5))*.5; }`;
const FIRE_FS = `varying float vAge; varying float vSeed; varying float vKind; varying float vHeat; varying float vRot; varying float vLift; ${PUFF}
  vec3 ramp(float h){ // cool to hot: deep red, red-orange, orange, yellow, white
    vec3 c=mix(vec3(.45,.05,.01),vec3(.95,.25,.03),smoothstep(.0,.3,h)); c=mix(c,vec3(1.,.55,.08),smoothstep(.25,.55,h));
    c=mix(c,vec3(1.,.85,.35),smoothstep(.5,.8,h)); return mix(c,vec3(1.,.98,.88),smoothstep(.8,1.,h)); }
  void main(){
    if(vKind>.5){ vec2 d=gl_PointCoord-.5; float r=dot(d,d)*4.; if(r>1.)discard; float flick=.65+.35*sin(vSeed*90.+vAge*40.);
      gl_FragColor=vec4(ramp(.72-vAge*.5)*(1.-r)*(1.-vAge)*flick*1.1,0.); return; }
    vec4 t=texture2D(map,puffUv()); float d=t.r; if(d<.01)discard;
    float erode=smoothstep(vAge*.95-.15,vAge*.95+.25,d*.75+t.g*.45);
    float h=clamp(d*d*vHeat*(1.1-vAge*1.2),0.,1.);
    float fade=(1.-vAge)*min(1.,vAge*14.+.15);
    float m=erode*fade*smoothstep(.0,.7,d);
    // Premultiplied: cool smoky flame hides the sky behind it, the hot core glows on top. Pure additive washes out to
    // white against the game's bright sky.
    gl_FragColor=vec4(ramp(h)*m*.95,m*mix(.55,.1,h)); }`;
const SMOKE_FS = `varying float vAge; varying float vSeed; varying float vKind; varying float vHeat; varying float vRot; varying float vLift; ${PUFF}
  void main(){
    if(vKind>.5){ vec2 d=gl_PointCoord-.5; if(dot(d,d)>.25)discard; gl_FragColor=vec4(vec3(.16,.12,.1)+.1*vSeed,1.); return; }
    vec4 t=texture2D(map,puffUv()); float d=t.r; if(d<.01)discard;
    float erode=smoothstep(vAge*.8-.1,vAge*.8+.3,d*.7+t.g*.5);
    float top=clamp(.5-(gl_PointCoord.y-.5)*1.2,0.,1.); // lit from above: brighter on top, soot below
    vec3 c=mix(vec3(.16,.12,.11),vec3(.5,.47,.46),vAge*.7+top*.3);
    c=mix(c,vec3(.9,.42,.12),vHeat*(1.-smoothstep(0.,.35,vAge))*(1.-top)); // fire-lit underside while it is young
    gl_FragColor=vec4(c,d*erode*(1.-vAge)*min(1.,vAge*5.)*.55); }`;

// Flames and embers: one instanced quad each, faced to the camera and stretched along its screen-space motion.
const STREAK_VS = `attribute vec3 iPos; attribute vec3 iVel; attribute float iSize; attribute float iAge; attribute float iSeed; attribute float iKind; attribute float iHeat;
  varying vec2 vUv; varying float vAge; varying float vSeed; varying float vKind; varying float vHeat;
  void main(){ vUv=uv; vAge=iAge; vSeed=iSeed; vKind=iKind; vHeat=iHeat;
    vec4 mv=modelViewMatrix*vec4(iPos,1.); vec3 vv=(modelViewMatrix*vec4(iVel,0.)).xyz; float sp=length(vv.xy);
    float ang=iSeed*6.2832+(iSeed-.5)*2.*iAge; vec2 ax=vec2(-sin(ang),cos(ang)), up=vec2(0.,1.);
    float st=1.;
    if(iKind<.5) ax=normalize(mix(ax,up,.65)); // slow flames still lean upward, like licks
    if(sp>.2){ ax=normalize(mix(ax,vv.xy/sp,smoothstep(.2,2.5,sp))); st=1.+min(iKind>.5?9.:2.4,sp*(iKind>.5?.035:.022)/max(iSize,.05)); }
    vec2 ay=vec2(ax.y,-ax.x); mv.xy+=ay*position.x*iSize+ax*(position.y*st-(st-1.)*.5)*iSize; // the head leads, the tail trails behind
    gl_Position=projectionMatrix*mv; }`;
const STREAK_FS = `uniform sampler2D map; varying vec2 vUv; varying float vAge; varying float vSeed; varying float vKind; varying float vHeat;
  vec3 ramp(float h){ vec3 c=mix(vec3(.85,.16,.02),vec3(.98,.3,.04),smoothstep(.0,.28,h)); c=mix(c,vec3(1.,.52,.07),smoothstep(.24,.52,h));
    c=mix(c,vec3(1.,.83,.32),smoothstep(.5,.78,h)); return mix(c,vec3(1.,.97,.86),smoothstep(.8,1.,h)); }
  void main(){
    if(vKind>.5){ float a=abs(vUv.x-.5)*2.; float l=smoothstep(0.,.35,vUv.y)*(1.-a*a); if(l<.01)discard; float flick=.7+.3*sin(vSeed*90.+vAge*45.);
      gl_FragColor=vec4(ramp(.9-vAge*.55)*l*(1.-vAge)*flick*1.2,0.); return; }
    float f=floor(vSeed*3.999); vec4 t=texture2D(map,clamp(vUv,.02,.98)*.5+vec2(mod(f,2.),floor(f*.5))*.5); float d=t.r; if(d<.01)discard;
    float erode=smoothstep(vAge*.9-.12,vAge*.9+.22,d*.7+t.g*.5);
    float h=clamp((d*.85+.15)*d*vHeat*(1.12-vAge*1.15),0.,1.);
    float fade=(1.-vAge*vAge)*min(1.,vAge*16.+.2), m=erode*fade*smoothstep(.05,.75,d);
    // Premultiplied: the cool, sooty edge of a flame hides what is behind it; its hot core glows over it.
    gl_FragColor=vec4(ramp(h)*m*.9,m*m*mix(.5,.06,h)); }`; // the soft edge glows rather than outlining
function streaks(max) {
  const base = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry(), A = {};
  geometry.index = base.index; geometry.setAttribute('position', base.attributes.position); geometry.setAttribute('uv', base.attributes.uv);
  for (const [name, n] of [['iPos', 3], ['iVel', 3], ['iSize', 1], ['iAge', 1], ['iSeed', 1], ['iKind', 1], ['iHeat', 1]]) {
    A[name] = new Float32Array(max * n); geometry.setAttribute(name, new THREE.InstancedBufferAttribute(A[name], n).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({uniforms: {map: {value: sharedTextures().tongues}}, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor});
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 12;
  const life = new Float32Array(max), t = new Float32Array(max), grow = new Float32Array(max), size0 = new Float32Array(max), drag = new Float32Array(max), lift = new Float32Array(max);
  let count = 0, dropped = 0;
  const one = ['iSize', 'iAge', 'iSeed', 'iKind', 'iHeat'];
  return {
    points: mesh,
    add(x, y, z, vx, vy, vz, seconds, s, {growth = 1.8, damping = 1.2, rise = 0, kind = 0, heat = 1} = {}) {
      if (count >= max) { dropped++; return; }
      const i = count++, p = A.iPos, v = A.iVel; p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
      life[i] = seconds; t[i] = 0; size0[i] = s; grow[i] = growth; drag[i] = damping; lift[i] = rise;
      A.iSize[i] = s; A.iAge[i] = 0; A.iSeed[i] = Math.random(); A.iKind[i] = kind; A.iHeat[i] = heat;
    },
    update(dt) {
      const p = A.iPos, vel = A.iVel;
      for (let i = 0; i < count; i++) {
        t[i] += dt; const a = t[i] / life[i];
        if (a >= 1) {
          const j = --count;
          if (i !== j) { for (let k = 0; k < 3; k++) { p[i * 3 + k] = p[j * 3 + k]; vel[i * 3 + k] = vel[j * 3 + k]; } life[i] = life[j]; t[i] = t[j]; size0[i] = size0[j]; grow[i] = grow[j]; drag[i] = drag[j]; lift[i] = lift[j]; for (const n of one) A[n][i] = A[n][j]; }
          i--; continue;
        }
        const k = Math.exp(-drag[i] * dt);
        vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k + lift[i] * dt; vel[i * 3 + 2] *= k;
        p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
        A.iAge[i] = a; A.iSize[i] = size0[i] * (1 + grow[i] * a);
      }
      geometry.instanceCount = count;
      for (const n of ['iPos', 'iVel', ...one]) { const attr = geometry.attributes[n]; attr.needsUpdate = true; attr.clearUpdateRanges?.(); attr.addUpdateRange?.(0, count * attr.itemSize); }
      mesh.visible = count > 0;
    },
    clear() { count = 0; geometry.instanceCount = 0; mesh.visible = false; },
    stats: () => ({count, dropped}),
    dispose() { geometry.dispose(); base.dispose(); material.dispose(); },
  };
}

function cloud(max, {additive}) {
  const geometry = new THREE.BufferGeometry(), A = {};
  for (const [name, n] of [['position', 3], ['size', 1], ['age', 1], ['seed', 1], ['kind', 1], ['heat', 1]]) {
    A[name] = new Float32Array(max * n); geometry.setAttribute(name, new THREE.BufferAttribute(A[name], n).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const material = new THREE.ShaderMaterial({
    uniforms: {scale: {value: 600}, map: {value: sharedTextures().puffs}},
    vertexShader: CLOUD_VS, fragmentShader: additive ? FIRE_FS : SMOKE_FS,
    transparent: true, depthWrite: false, ...(additive ? {blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor} : {blending: THREE.NormalBlending}),
  });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.renderOrder = additive ? 12 : 11;
  const vel = new Float32Array(max * 3), life = new Float32Array(max), t = new Float32Array(max), grow = new Float32Array(max), size0 = new Float32Array(max), drag = new Float32Array(max), lift = new Float32Array(max);
  let count = 0, dropped = 0;
  const per = {size: 1, age: 1, seed: 1, kind: 1, heat: 1};
  return {
    points,
    add(x, y, z, vx, vy, vz, seconds, s, {growth = 1.8, damping = 1.2, rise = 0, kind = 0, heat = 1} = {}) {
      if (count >= max) { dropped++; return; }
      const i = count++, p = A.position; p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = seconds; t[i] = 0; size0[i] = s; grow[i] = growth; drag[i] = damping; lift[i] = rise;
      A.size[i] = s; A.age[i] = 0; A.seed[i] = Math.random(); A.kind[i] = kind; A.heat[i] = heat;
    },
    update(dt) {
      const p = A.position;
      for (let i = 0; i < count; i++) {
        t[i] += dt; const a = t[i] / life[i];
        if (a >= 1) { // swap-remove
          const j = --count;
          if (i !== j) { for (let k = 0; k < 3; k++) { p[i * 3 + k] = p[j * 3 + k]; vel[i * 3 + k] = vel[j * 3 + k]; } life[i] = life[j]; t[i] = t[j]; size0[i] = size0[j]; grow[i] = grow[j]; drag[i] = drag[j]; lift[i] = lift[j]; A.seed[i] = A.seed[j]; A.kind[i] = A.kind[j]; A.heat[i] = A.heat[j]; }
          i--; continue;
        }
        const k = Math.exp(-drag[i] * dt);
        vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k + lift[i] * dt; vel[i * 3 + 2] *= k;
        p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
        A.age[i] = a; A.size[i] = size0[i] * (1 + grow[i] * a);
      }
      geometry.setDrawRange(0, count);
      for (const n of ['position', ...Object.keys(per)]) { const attr = geometry.attributes[n]; attr.needsUpdate = true; attr.clearUpdateRanges?.(); attr.addUpdateRange?.(0, count * attr.itemSize); }
      points.visible = count > 0;
    },
    clear() { count = 0; geometry.setDrawRange(0, 0); points.visible = false; },
    stats: () => ({count, dropped}),
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// --- The breath stream: a tapering tube of scrolling flame from the mouth to the ground. ---------------------------------
const BEAM_VS = `attribute float flick; varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vLen;
  uniform float len;
  uniform float time;
  void main(){ vUv=uv; vLen=len; float ang=atan(position.z,position.x);
    vec3 pos=position+normal*(sin(uv.y*13.-time*11.+ang*3.)*.16+sin(uv.y*7.+time*6.-ang*2.)*.1)*uv.y;
    vec4 wp=modelMatrix*vec4(pos,1.); vN=normalize(mat3(modelMatrix)*normal); vView=normalize(cameraPosition-wp.xyz);
    gl_Position=projectionMatrix*viewMatrix*wp; }`;
const BEAM_FS = `uniform sampler2D noise; uniform float time; uniform float amount; varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vLen;
  void main(){
    float along=vUv.y; // 0 at the mouth, 1 at the ground
    vec2 q=vec2(vUv.x*2.,along*vLen*.08-time*2.6);
    float n=texture2D(noise,q).r*.6+texture2D(noise,q*vec2(1.,2.3)+vec2(.37,-time*1.3)).g*.55;
    float rim=clamp(dot(normalize(vN),vView),0.,1.); // 1 facing us (the middle of the stream), 0 at its edges
    float body=smoothstep(.05,.6,rim)*smoothstep(.0,.08,along)*(1.-smoothstep(.82,1.,along));
    float h=clamp(n*rim*rim*(1.3-along*.8),0.,1.);
    vec3 c=mix(vec3(.8,.16,.02),vec3(1.,.5,.08),smoothstep(.2,.5,h)); c=mix(c,vec3(1.,.9,.55),smoothstep(.62,.95,h));
    float a=body*smoothstep(.45,.95,n+rim*.35)*amount;
    gl_FragColor=vec4(c*a*.85,a*.55); }`;

// --- Fireball cores: churning spheres, instanced. -----------------------------------------------------------------------
const BALL_VS = `attribute float spin; varying vec3 vN; varying vec3 vView; varying vec3 vLocal; varying float vSpin;
  void main(){ vSpin=spin; vLocal=position; vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix*instanceMatrix)*normal); vView=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`;
const BALL_FS = `uniform sampler2D noise; uniform float time; varying vec3 vN; varying vec3 vView; varying vec3 vLocal; varying float vSpin;
  void main(){ float facing=clamp(dot(normalize(vN),vView),0.,1.);
    vec2 q=vec2(atan(vLocal.z,vLocal.x)*.32+vSpin, vLocal.y*.8-time*1.7);
    float n=texture2D(noise,q).r*.65+texture2D(noise,q*2.1+vec2(time*.4,0.)).g*.5;
    float h=clamp(facing*facing*(.15+n*.95),0.,1.);
    vec3 c=mix(vec3(1.,.36,.04),vec3(1.,.6,.1),smoothstep(.15,.45,h)); c=mix(c,vec3(1.,.88,.5),smoothstep(.55,.8,h)); c=mix(c,vec3(1.,.98,.9),smoothstep(.85,1.,h));
    float a=smoothstep(.1,.75,facing+n*.3); gl_FragColor=vec4(c*(.6+.4*h)*a,a*a*(.7-.45*h)); }`;

// --- Shock rings and scorch marks: flat instanced quads. ----------------------------------------------------------------
const FLAT_VS = `attribute vec3 info; varying vec2 vUv; varying vec3 vInfo; void main(){ vUv=uv*2.-1.; vInfo=info; gl_Position=projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.); }`;
const RING_FS = `uniform sampler2D noise; varying vec2 vUv; varying vec3 vInfo; // info: age 0..1, seed, big
  void main(){ float r=length(vUv), u=vInfo.x; float n=texture2D(noise,vec2(atan(vUv.y,vUv.x)*.48+vInfo.y,r*.5-u)).r;
    float edge=.55+.4*u, w=.18+.25*(1.-u); float band=smoothstep(edge-w,edge,r)*(1.-smoothstep(edge,edge+.06,r));
    vec3 c=mix(vec3(.62,.5,.4),vec3(1.,.82,.55),band*(1.-u));
    gl_FragColor=vec4(c,band*(.45+.6*n)*(1.-u)*.85); }`;
const SCORCH_FS = `uniform sampler2D noise; varying vec2 vUv; varying vec3 vInfo; // info: age 0..1, seed, glow 0..1
  void main(){ float r=length(vUv); vec2 q=vUv*.45+vInfo.y; float n=texture2D(noise,q).r, f=texture2D(noise,q*2.7).g;
    float burn=1.-smoothstep(.3+.55*n,.55+.6*n,r); if(burn<.01)discard;
    float u=vInfo.x, fade=1.-smoothstep(.6,1.,u);
    // Cracks of glowing embers that cool from yellow to dull red, then out.
    float crack=smoothstep(.035,.0,abs(f-.5))*smoothstep(.8,.15,r)*smoothstep(.35,.6,n);
    float hot=vInfo.z*(1.-smoothstep(.0,.55,u));
    vec3 ember=mix(vec3(.6,.06,.0),vec3(1.,.62,.15),hot);
    vec3 c=mix(vec3(.13,.1,.08),ember*1.6,crack*clamp(hot*1.4+.15*(1.-u),0.,1.));
    gl_FragColor=vec4(c,burn*fade*(.42+.2*n)); } // soot, not tar: the grass shows through and it fades away`;

export function createDragonFire(group, {lowQuality = () => false} = {}) {
  const T = sharedTextures();
  const flames = streaks(MAX_FLAME), smoke = cloud(MAX_SMOKE, {additive: false});
  group.add(smoke.points, flames.points);
  // Beams.
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 10, true).translate(0, .5, 0);
  { // taper: thin at the mouth, wide at the ground; uv.y runs 0 (mouth) to 1 (ground)
    const p = beamGeo.attributes.position, uv = beamGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), r = .12 + .88 * Math.pow(y, .8); p.setX(i, p.getX(i) * r); p.setZ(i, p.getZ(i) * r); uv.setY(i, y); }
    beamGeo.computeVertexNormals();
  }
  const beams = Array.from({length: MAX_BEAMS}, () => {
    const m = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({uniforms: {noise: {value: T.noise}, time: {value: 0}, amount: {value: 0}, len: {value: 10}}, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor}));
    m.frustumCulled = false; m.visible = false; m.renderOrder = 12; group.add(m); return m;
  });
  // Fireballs.
  const ballMat = new THREE.ShaderMaterial({uniforms: {noise: {value: T.noise}, time: {value: 0}}, vertexShader: BALL_VS, fragmentShader: BALL_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor});
  const ballGeo = new THREE.IcosahedronGeometry(1, 3); ballGeo.setAttribute('spin', new THREE.InstancedBufferAttribute(new Float32Array(MAX_BALLS), 1));
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS); balls.count = 0; balls.frustumCulled = false; balls.renderOrder = 13; group.add(balls);
  // Rings and scorch marks.
  const flat = (max, fs, opts) => {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2); geo.setAttribute('info', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({uniforms: {noise: {value: T.noise}}, vertexShader: FLAT_VS, fragmentShader: fs, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...opts}), max);
    mesh.count = 0; mesh.frustumCulled = false; group.add(mesh); return {mesh, items: []};
  };
  const rings = flat(MAX_RINGS, RING_FS, {}), scorch = flat(MAX_SCORCH, SCORCH_FS, {});
  rings.mesh.renderOrder = 12; scorch.mesh.renderOrder = 10;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
  let time = 0, beamUsed = 0, ballUsed = 0;
  const rnd = (a = 1) => (Math.random() - .5) * 2 * a;
  const density = () => lowQuality() ? .6 : 1;

  function addFlat(set, max, item) { if (set.items.length >= max) set.items.shift(); set.items.push(item); }
  function scorchAt(x, y, z, radius, glow, life = 7) { addFlat(scorch, MAX_SCORCH, {x, y, z, r: radius, glow, seed: Math.random(), t: 0, life, spin: Math.random() * 6.28}); }

  return {
    /**
     * The roaring jet at the mouth this frame, towards `to` (the arcs of fire beyond it are globs). `key` names the dragon.
     * A short tapered tube of scrolling flame plus fast tongues streaking out of it, thin at the lips so the rider sees past.
     */
    breath(key, from, to, amount, dt) {
      dir.subVectors(to, from); const len = dir.length(); if (len < 1) return; dir.divideScalar(len);
      const beam = beams[beamUsed]; if (beam) {
        beamUsed++; const reach = Math.min(len, 7.5) * clamp(amount * 1.2, 0, 1);
        beam.visible = true; beam.position.copy(from).addScaledVector(dir, .5); q.setFromUnitVectors(up, dir); beam.quaternion.copy(q);
        const wide = 1.15 * (.7 + .3 * amount); beam.scale.set(wide, Math.max(.1, reach), wide);
        beam.material.uniforms.amount.value = amount; beam.material.uniforms.len.value = reach * 2.5; beam.material.uniforms.time.value = time + key.length;
      }
      const d = density(), n = Math.ceil(60 * dt * amount * d);
      for (let i = 0; i < n; i++) {
        const sp = 24 + Math.random() * 10, j = 3.2, start = 1 + Math.random() * 1.2;
        flames.add(from.x + dir.x * start, from.y + dir.y * start, from.z + dir.z * start, dir.x * sp + rnd(j), dir.y * sp + rnd(j), dir.z * sp + rnd(j),
          .2 + Math.random() * .16, .38 + Math.random() * .22, {growth: 3.4, damping: 2.2, rise: 2, heat: 1.15});
      }
      if (Math.random() < 14 * dt * amount * d) flames.add(from.x + dir.x * 2, from.y + dir.y * 2, from.z + dir.z * 2, dir.x * 18 + rnd(5), dir.y * 18 + rnd(5), dir.z * 18 + rnd(5), .5 + Math.random() * .4, .07, {kind: 1, growth: 0, damping: .9, rise: -7});
      if (Math.random() < 4 * dt * amount * d) smoke.add(from.x + dir.x * 6, from.y + dir.y * 6 + .5, from.z + dir.z * 6, dir.x * 4, 1.5, dir.z * 4, 1.4 + Math.random(), 1.6, {growth: 2.6, damping: 1, rise: .6, heat: 1});
    },
    breathEnd() {},
    /** One glob of liquid fire on its arc this frame: a white-hot head trailing tongues, sparks and a little smoke. */
    glob(p, v, seed, dt) {
      // The hot head: one short-lived, white-hot tongue each frame, stretched along the arc like a comet.
      flames.add(p.x, p.y, p.z, v.x, v.y, v.z, .05, 1.6, {growth: 0, damping: 0, heat: 1.5});
      const d = density();
      for (let i = 0; i < Math.ceil(46 * dt * d); i++) flames.add(p.x + rnd(.25), p.y + rnd(.25), p.z + rnd(.25), v.x * .35 + rnd(1.2), v.y * .35 + rnd(1.2) + 1, v.z * .35 + rnd(1.2), .22 + Math.random() * .25, .85 + Math.random() * .5, {growth: 1.8, damping: 3, rise: 2.5, heat: 1});
      if (Math.random() < 8 * dt * d) flames.add(p.x, p.y, p.z, v.x * .6 + rnd(3), v.y * .6 + rnd(3), v.z * .6 + rnd(3), .4 + Math.random() * .4, .06, {kind: 1, growth: 0, damping: 1, rise: -9});
      if (Math.random() < 3 * dt * d) smoke.add(p.x, p.y + .3, p.z, rnd(.4), .8, rnd(.4), 1 + Math.random() * .6, 1.1, {growth: 2.4, damping: 1, rise: .5, heat: 1});
    },
    /** A glob landing: a splash of fire that licks up and sputters out; `mark` leaves a small soot mark that fades. */
    splash(x, y, z, mark) {
      const d = density();
      for (let i = 0; i < Math.round(9 * d); i++) { const a = Math.random() * 6.283, sp = 1.5 + Math.random() * 3.5; flames.add(x + rnd(.4), y + .2, z + rnd(.4), Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, .35 + Math.random() * .5, .7 + Math.random() * .6, {growth: 1.2, damping: 2.2, rise: 3, heat: 1.05}); }
      for (let i = 0; i < Math.round(4 * d); i++) { const a = Math.random() * 6.283, sp = 3 + Math.random() * 5; flames.add(x, y + .3, z, Math.cos(a) * sp, 4 + Math.random() * 6, Math.sin(a) * sp, .6 + Math.random() * .7, .07, {kind: 1, growth: 0, damping: .7, rise: -12}); }
      if (Math.random() < .5 * d) smoke.add(x, y + .8, z, rnd(.5), 1.4, rnd(.5), 1.5 + Math.random(), 1.8, {growth: 2.4, damping: .8, rise: .7, heat: 1});
      if (mark) scorchAt(x, y, z, 1.5 + Math.random() * .5, .8, 5);
    },
    /** A fireball in flight this frame (called once per frame per ball). */
    fireball(p, seed, dt) {
      if (ballUsed < MAX_BALLS) {
        const s = 1.05 + .15 * Math.sin(time * 23 + seed * 9);
        m4.compose(p, q.identity(), sv.set(s, s, s)); balls.setMatrixAt(ballUsed, m4); ballGeo.attributes.spin.array[ballUsed] = seed % 1; ballUsed++;
      }
      const d = density();
      flames.add(p.x, p.y, p.z, 0, 0, 0, .1, 3.4, {growth: 0, damping: 0, heat: .7}); // the glow around it
      for (let i = 0; i < Math.ceil(70 * dt * d); i++) flames.add(p.x + rnd(.3), p.y + rnd(.3), p.z + rnd(.3), rnd(.8), rnd(.8) + .6, rnd(.8), .22 + Math.random() * .22, 1 + Math.random() * .4, {growth: 1.2, damping: 2.5, heat: .8});
      if (Math.random() < 14 * dt * d) smoke.add(p.x, p.y, p.z, rnd(.3), .6, rnd(.3), 1.1 + Math.random() * .5, 1.3, {growth: 2.6, damping: 1, rise: .5, heat: 1});
      if (Math.random() < 20 * dt * d) flames.add(p.x, p.y, p.z, rnd(2), rnd(2), rnd(2), .5 + Math.random() * .4, .08, {kind: 1, growth: 0, damping: 1, rise: -4});
    },
    /** A wingbeat's gust at the dragon's world position/orientation: wingtip wisps, and dust on the ground when it is low. */
    gust(pos, quat, power, groundY) {
      const d = density();
      for (const side of [-1, 1]) for (let i = 0; i < Math.round(3 * d); i++) {
        tmp.set(side * (8 + Math.random() * 3), -1 + Math.random(), -1.5 + Math.random() * 2).applyQuaternion(quat).add(pos);
        dir.set(side * 2, -6 - Math.random() * 3, -4).applyQuaternion(quat);
        smoke.add(tmp.x, tmp.y, tmp.z, dir.x, dir.y, dir.z, .7 + Math.random() * .4, 1.4 + Math.random(), {growth: 2.6, damping: 2.6, kind: 0, heat: 0});
      }
      const h = Number.isFinite(groundY) ? pos.y - groundY : 99;
      if (h < 16) for (let i = 0; i < Math.round(22 * d * power * (1 - h / 16)); i++) {
        const a = Math.random() * 6.283, sp = 7 + Math.random() * 6;
        smoke.add(pos.x + Math.cos(a) * 3, groundY + .4, pos.z + Math.sin(a) * 3, Math.cos(a) * sp, .8 + Math.random() * 1.5, Math.sin(a) * sp, 1.1 + Math.random() * .8, 2.2, {growth: 2.2, damping: 1.6, heat: 0});
        if (i % 3 === 0) smoke.add(pos.x + Math.cos(a) * 4, groundY + .5, pos.z + Math.sin(a) * 4, Math.cos(a) * sp * .8, 3 + Math.random() * 3, Math.sin(a) * sp * .8, .9 + Math.random() * .6, .12, {kind: 1, growth: 0, damping: .5, rise: -9});
      }
    },
    /** An impact: flash, fire burst (a rising mushroom for the dive), shock ring, embers, debris, smoke column, scorch. */
    impact(x, y, z, big, radius) {
      const d = density(), n = Math.round((big ? 120 : 45) * d);
      flames.add(x, y + 1, z, 0, 0, 0, big ? .25 : .16, big ? 15 : 8, {growth: .5, damping: 0, heat: 1.4}); // the flash
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = (big ? 10 : 6.5) * (.3 + Math.random()), upv = (big ? 9 : 5) * Math.random();
        flames.add(x + rnd(.5), y + .5, z + rnd(.5), Math.cos(a) * sp, upv + 1, Math.sin(a) * sp, .45 + Math.random() * (big ? .9 : .5), (big ? 2.4 : 1.6) * (.6 + Math.random() * .6), {growth: 1.3, damping: 2.4, rise: 2.5, heat: 1.2});
      }
      if (big) for (let i = 0; i < 26 * d; i++) flames.add(x + rnd(1), y + 1, z + rnd(1), rnd(1), 7 + Math.random() * 5, rnd(1), .8 + Math.random() * .6, 2.6 + Math.random(), {growth: 1.4, damping: 1.4, rise: 1, heat: 1}); // the column
      for (let i = 0; i < (big ? 40 : 16) * d; i++) { const a = Math.random() * 6.283, sp = 5 + Math.random() * 9; flames.add(x, y + .6, z, Math.cos(a) * sp, 5 + Math.random() * 9, Math.sin(a) * sp, .8 + Math.random() * 1.1, .1, {kind: 1, growth: 0, damping: .6, rise: -11}); }
      for (let i = 0; i < (big ? 22 : 8) * d; i++) { const a = Math.random() * 6.283, sp = 3 + Math.random() * 6; smoke.add(x, y + .4, z, Math.cos(a) * sp, 6 + Math.random() * 6, Math.sin(a) * sp, .9 + Math.random() * .6, .16 + Math.random() * .1, {kind: 1, growth: 0, damping: .4, rise: -16}); }
      for (let i = 0; i < (big ? 30 : 12) * d; i++) { const a = Math.random() * 6.283, sp = 2.5 * Math.random(); smoke.add(x + Math.cos(a) * radius * .3, y + 1, z + Math.sin(a) * radius * .3, Math.cos(a) * sp, 1.5 + Math.random() * (big ? 4 : 2), Math.sin(a) * sp, 1.8 + Math.random() * 1.6, big ? 4.2 : 2.8, {growth: 2.3, damping: .9, rise: .9, heat: 1}); }
      addFlat(rings, MAX_RINGS, {x, y: y + .3, z, r: radius * 1.25, seed: Math.random(), t: 0, life: big ? .75 : .5, big: big ? 1 : 0});
      scorchAt(x, y, z, radius * (big ? 1 : .75), 1, big ? 9 : 6);
    },
    update(dt) {
      time += dt;
      for (let i = beamUsed; i < beams.length; i++) beams[i].visible = false;
      balls.count = ballUsed; if (ballUsed) { balls.instanceMatrix.needsUpdate = true; ballGeo.attributes.spin.needsUpdate = true; }
      ballMat.uniforms.time.value = time;
      beamUsed = 0; ballUsed = 0;
      for (const [set, rot] of [[rings, false], [scorch, true]]) {
        set.items = set.items.filter(it => (it.t += dt) < it.life);
        const info = set.mesh.geometry.attributes.info;
        set.items.forEach((it, i) => {
          const u = it.t / it.life, r = set === rings ? it.r * (.3 + .9 * (1 - (1 - u) ** 3)) : it.r * (1 + .08 * Math.min(1, it.t * 4));
          q.setFromAxisAngle(up, rot ? it.spin : 0); m4.compose(tmp.set(it.x, it.y + .06, it.z), q, sv.set(r, 1, r)); set.mesh.setMatrixAt(i, m4);
          info.array[i * 3] = u; info.array[i * 3 + 1] = it.seed; info.array[i * 3 + 2] = set === rings ? it.big : it.glow;
        });
        set.mesh.count = set.items.length; if (set.items.length) { set.mesh.instanceMatrix.needsUpdate = true; info.needsUpdate = true; }
      }
      flames.update(dt); smoke.update(dt);
    },
    setPointScale(s) { smoke.points.material.uniforms.scale.value = s; },
    clear() { flames.clear(); smoke.clear(); rings.items.length = scorch.items.length = 0; },
    stats: () => ({fire: flames.stats(), smoke: smoke.stats(), scorch: scorch.items.length, rings: rings.items.length}),
    dispose() {
      flames.dispose(); smoke.dispose(); beamGeo.dispose(); for (const b of beams) b.material.dispose(); ballGeo.dispose(); ballMat.dispose();
      for (const s of [rings, scorch]) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    },
  };
}
