// Apple art for "apple on a stick" (Opus 5.5, 2026-10-04). Procedural, no textures, one shared program.
//
// Shape: a lathe apple with a recessed stem well, a five-lobed calyx basin and broad shoulders just above the
// equator, varied per seed (height, lean, lobe phase). Skin: deep red blush over a yellow-green ground colour,
// darker meridian streaks, a russet stem well and pale lenticel dots, waxy roughness. Bites are evaluated in the
// vertex shader: up to three bite spheres scoop the mesh (vertices inside a sphere move onto its far surface),
// with incisor scrape grooves. Exposed flesh is cream, wet when fresh and browning over a minute; near the axis it
// shows the fibrous core and five dark seeds, so three bites leave a real apple core. A shaft hole bruises the skin.
// Halves: a wire-cut half is the body clipped at x = 0 with a flat cap (vertex attribute `cut`), and paints the
// classic lengthwise section on that cap: wet flesh, the pale vascular ring, the papery core with two seeds in their pockets, the stem channel.
// Units: the apple mesh is unit-radius (widest ~1); scale it to the apple's radius in metres.
import * as T from 'three';

// Profile (radius, height) from the calyx centre up to the stem-well floor, unit apple.
const PROFILE = [[0,-.58],[.1,-.62],[.22,-.7],[.36,-.76],[.5,-.75],[.64,-.67],[.78,-.52],[.9,-.3],[.98,-.05],[1,.18],[.96,.4],[.86,.58],[.7,.72],[.52,.8],[.36,.8],[.23,.74],[.13,.67],[.05,.61],[0,.59]];
const SEGMENTS = {high: [96, 84], low: [28, 22]};

function catmull(points, n) {
 const out = [];
 for (let i = 0; i < points.length - 1; i++) {
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
  for (let k = 0; k < n; k++) { const t = k/n, t2 = t*t, t3 = t2*t;
   out.push([0, 1].map(j => .5*((2*p1[j]) + (-p0[j] + p2[j])*t + (2*p0[j] - 5*p1[j] + 4*p2[j] - p3[j])*t2 + (-p0[j] + 3*p1[j] - 3*p2[j] + p3[j])*t3))); }
 }
 out.push(points[points.length - 1]); return out;
}
const rand = seed => { let s = (seed >>> 0) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s >>> 0) % 100000)/100000); };

/** Unit apple body geometry. seed varies the silhouette; quality 'high' (held, near) or 'low' (distant drops/regrowth). */
export function createAppleGeometry({seed = 1, quality = 'high', half = false} = {}) {
 const r = rand(seed*7919 + 13), [radial, rows] = SEGMENTS[quality] || SEGMENTS.high;
 const tall = .9 + r()*.12, lean = (r() - .5)*.08, lobe = r()*Math.PI*2, lobeDepth = .02 + r()*.02, squash = .97 + r()*.06;
 const profile = catmull(PROFILE, Math.max(1, Math.round(rows/(PROFILE.length - 1))));
 const pos = [], idx = [];
 // poles are single vertices; the rings between them wrap without a seam (shading is object-space procedural)
 pos.push(0, profile[0][1]*tall, 0);
 const ringStart = 1, ring = profile.slice(1, -1);
 for (const [rho, y0] of ring) {
  const y = y0*tall, bottom = T.MathUtils.smoothstep(-y0, .2, .8), top = T.MathUtils.smoothstep(y0, .45, .8);
  for (let i = 0; i < radial; i++) { const a = i/radial*Math.PI*2, k = rho*(1 + (lobeDepth*bottom + lobeDepth*.6*top)*Math.cos(5*a + lobe)*.6);
   pos.push(Math.cos(a)*k*squash + lean*y, y, Math.sin(a)*k); }
 }
 const last = pos.length/3; pos.push(lean*profile.at(-1)[1]*tall, profile.at(-1)[1]*tall, 0);
 for (let i = 0; i < radial; i++) idx.push(0, ringStart + (i + 1) % radial, ringStart + i);
 for (let j = 0; j < ring.length - 1; j++) for (let i = 0; i < radial; i++) {
  const a = ringStart + j*radial + i, b = ringStart + j*radial + (i + 1) % radial, c = a + radial, d = b + radial; idx.push(a, b, c, b, d, c);
 }
 const lastRing = ringStart + (ring.length - 1)*radial;
 for (let i = 0; i < radial; i++) idx.push(last, lastRing + i, lastRing + (i + 1) % radial);
 for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]]; // wind outward (counter-clockwise from outside)
 const g = half ? halfGeometry(pos, idx) : new T.BufferGeometry(); if (!half) { g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); }
 g.computeBoundingSphere(); g.boundingSphere.radius = 1.25; // bites only ever move vertices inward
 g.userData.apple = {seed, tall, stemTop: profile.at(-1)[1]*tall, lean}; return g;
}

// Clip the body to x <= 0 and close it with a flat cap facing +X (cut = 1 on cap vertices). The cap is a fan of rings
// round the section's centre (the section of an apple through its axis is star-shaped about that point).
function halfGeometry(pos, idx) {
 const P = i => [pos[i*3], pos[i*3 + 1], pos[i*3 + 2]], out = [], tri = [], edge = new Map(), keep = new Map(), rim = [];
 const vert = p => (out.push(...p), out.length/3 - 1);
 const kept = i => { if (!keep.has(i)) keep.set(i, vert(P(i))); return keep.get(i); };
 const cutAt = (i, j) => { const k = i < j ? i + ',' + j : j + ',' + i; if (edge.has(k)) return edge.get(k);
  const a = P(i), b = P(j), t = a[0]/(a[0] - b[0]), v = vert([0, a[1] + (b[1] - a[1])*t, a[2] + (b[2] - a[2])*t]); edge.set(k, v); rim.push(v); return v; };
 for (let f = 0; f < idx.length; f += 3) {
  const ids = [idx[f], idx[f + 1], idx[f + 2]], inside = ids.map(i => pos[i*3] <= 0), poly = [];
  for (let e = 0; e < 3; e++) { const i = ids[e], j = ids[(e + 1)%3];
   if (inside[e]) poly.push(kept(i)); if (inside[e] !== inside[(e + 1)%3]) poly.push(cutAt(i, j)); }
  for (let k = 1; k + 1 < poly.length; k++) tri.push(poly[0], poly[k], poly[k + 1]);
 }
 const bodyCount = out.length/3, bodyTris = tri.length;
 // the cap: the rim sorted by angle about its centre, then rings blended toward the centre
 const ys = rim.map(v => out[v*3 + 1]), zs = rim.map(v => out[v*3 + 2]), cy = (Math.min(...ys) + Math.max(...ys))/2, cz = (Math.min(...zs) + Math.max(...zs))/2;
 const ring = [...new Set(rim)].sort((a, b) => Math.atan2(out[a*3 + 1] - cy, out[a*3 + 2] - cz) - Math.atan2(out[b*3 + 1] - cy, out[b*3 + 2] - cz));
 const rings = [ring.map(v => vert([0, out[v*3 + 1], out[v*3 + 2]]))];
 for (const k of [.72, .44, .18]) rings.push(ring.map(v => vert([0, cy + (out[v*3 + 1] - cy)*k, cz + (out[v*3 + 2] - cz)*k])));
 const centre = vert([0, cy, cz]), n = ring.length;
 for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) { const a = rings[r][i], b = rings[r][(i + 1)%n], c = rings[r + 1][i], d = rings[r + 1][(i + 1)%n]; tri.push(a, c, b, b, c, d); }
 for (let i = 0; i < n; i++) tri.push(rings.at(-1)[i], centre, rings.at(-1)[(i + 1)%n]);
 const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(out, 3)); g.setIndex(tri);
 // the cap must face +X: flip the winding if the sort ran the other way
 const capStart = tri.length - n*3, [a, b, c] = [tri[capStart], tri[capStart + 1], tri[capStart + 2]].map(v => new T.Vector3(out[v*3], out[v*3 + 1], out[v*3 + 2]));
 if (new T.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).x < 0) for (let f = bodyTris; f < tri.length; f += 3) [tri[f + 1], tri[f + 2]] = [tri[f + 2], tri[f + 1]];
 g.setIndex(tri); g.computeVertexNormals();
 const nrm = g.attributes.normal, cut = new Float32Array(out.length/3);
 for (let v = bodyCount; v < out.length/3; v++) { nrm.setXYZ(v, 1, 0, 0); cut[v] = 1; }
 g.setAttribute('cut', new T.BufferAttribute(cut, 1)); return g;
}

/** A short woody stem rising out of the well, and (seeded) one leaf. Unit apple space, Y up. */
export function createAppleStem({seed = 1} = {}) {
 const r = rand(seed*31 + 7), group = new T.Group(); group.name = 'AppleStem';
 const bend = (r() - .5)*.35, base = .5;
 const curve = new T.CatmullRomCurve3([new T.Vector3(0, base - .04, 0), new T.Vector3(.02 + bend*.2, base + .18, .01), new T.Vector3(.06 + bend*.6, base + .38, .02), new T.Vector3(.13 + bend, base + .5, .03)]);
 const stem = new T.Mesh(new T.TubeGeometry(curve, 10, .042, 6, false), STEM_MATERIAL); stem.name = 'Stem'; group.add(stem);
 const cap = new T.Mesh(new T.SphereGeometry(.04, 6, 4), STEM_MATERIAL); cap.position.copy(curve.getPoint(1)); group.add(cap);
 if (r() < .55) { // a single leaf on a short petiole, gently cupped
  const shape = new T.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(.15, .08, .19, .4, 0, .66); shape.bezierCurveTo(-.19, .4, -.15, .08, 0, 0);
  const geo = new T.ShapeGeometry(shape, 10), p = geo.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -x*x*1.6 + Math.sin(y*4.4)*.025); // cup + ripple
   const vein = Math.exp(-(x*x)/.0006), edge = Math.min(1, Math.abs(x)/.18); col.push(.045 + .05*vein - .01*edge, .12 + .1*vein - .03*edge + .03*y, .02 + .025*vein); }
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const leaf = new T.Mesh(geo, LEAF_MATERIAL); leaf.name = 'Leaf'; leaf.position.copy(curve.getPoint(.55)); leaf.rotation.set(-.9 - r()*.4, r()*Math.PI*2, .5 + r()*.4); group.add(leaf);
 }
 return group;
}
const STEM_MATERIAL = new T.MeshStandardMaterial({color: 0x4a3018, roughness: .85}); STEM_MATERIAL.name = 'AppleStem';
const LEAF_MATERIAL = new T.MeshStandardMaterial({vertexColors: true, roughness: .5, side: T.DoubleSide}); LEAF_MATERIAL.name = 'AppleLeaf';

const VERT_HEAD = /* glsl */`
uniform vec4 uBite[3]; uniform vec3 uBiteAxis; uniform vec3 uShaft; uniform vec4 uCut; attribute float cut;
varying vec3 vApple; varying float vFlesh; varying float vCut; varying vec3 vBiteAxisDist;
`;
// Scoop: any vertex inside a bite sphere moves to the sphere surface on the far side from its centre (into the apple).
// Grooves: incisors drag parallel scrapes across the scoop (along uBiteAxis).
const VERT_BITE = /* glsl */`
 vec3 appleP = position; vec3 appleN = objectNormal; vFlesh = 1.0; vCut = 0.0;
 if (uCut.w > 0.0) { vCut = cut; vFlesh = cut > .5 ? -1.0 : 1.0; } // a half's flat cap is all flesh
 for (int i = 0; i < 3; i++) {
  vec4 b = uBite[i]; if (b.w <= 0.0) continue;
  vec3 d = appleP - b.xyz; float l = length(d);
  vec3 u = d / max(l, 1e-4);
  float groove = 1.0 + .03 * sin(dot(u, uBiteAxis) * 24.0 + float(i) * 1.7);
  float rad = b.w * groove;
  vFlesh = min(vFlesh, l / rad - 1.0); // signed distance to the bite, interpolated so the skin edge is per-pixel smooth
  if (l < rad) { // project from a point beyond the bite centre onto the sphere's far (inner) wall: continuous at the rim, never outward
   vec3 o = b.xyz + normalize(b.xyz) * rad * 1.25, dir = normalize(appleP - o), m = o - b.xyz;
   float bb = dot(m, dir), t = -bb + sqrt(max(bb*bb - dot(m, m) + rad*rad, 0.0));
   appleP = o + dir * t; appleN = normalize(b.xyz - appleP); }
 }
 objectNormal = appleN; vApple = appleP;
`;
const FRAG_HEAD = /* glsl */`
uniform vec3 uSkinDeep; uniform vec3 uSkinBright; uniform vec3 uGround; uniform vec3 uSunSide; uniform float uSeed; uniform float uBrown; uniform float uWet; uniform vec3 uShaft; uniform vec4 uCut;
varying vec3 vApple; varying float vFlesh; varying float vCut;
float aH(vec3 p) { p = fract(p*.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float aN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
 return mix(mix(mix(aH(i), aH(i + vec3(1,0,0)), f.x), mix(aH(i + vec3(0,1,0)), aH(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(aH(i + vec3(0,0,1)), aH(i + vec3(1,0,1)), f.x), mix(aH(i + vec3(0,1,1)), aH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float appleRough = 1.0; float appleFlesh = 0.0;
`;
const FRAG_COLOR = /* glsl */`
 {
  vec3 p = vApple; vec3 n = normalize(p); float az = atan(p.z, p.x); float flesh01 = smoothstep(.012, -.012, vFlesh);
  // skin: ground colour, sun-side blush broken by meridian streaks and speckle; russet well; lenticels
  float sun = dot(n, normalize(uSunSide)) * .5 + .5;
  float mottle = aN(p * 3.1 + uSeed * 7.0);
  float blush = smoothstep(.05, .6, sun * .8 + mottle * .35 + .22);
  float streak = smoothstep(.35, .85, aN(vec3(az * 7.0, p.y * 1.4, uSeed * 3.0))) * smoothstep(-.9, -.2, p.y) * smoothstep(1.0, .55, p.y);
  vec3 skin = mix(uGround, mix(uSkinBright, uSkinDeep, .55 + .45 * aN(p * 9.0)), blush);
  skin = mix(skin, uSkinDeep * .62, streak * blush * .55);
  float well = smoothstep(.5, .3, length(p.xz)) * smoothstep(.35, .55, p.y);
  skin = mix(skin, vec3(.3, .24, .07) * (.8 + .4 * aN(vec3(az * 9.0, p.y * 20.0, 1.0))), well * .5);
  float calyx = smoothstep(.36, .12, length(p.xz)) * smoothstep(-.4, -.7, p.y);
  skin = mix(skin, vec3(.17, .12, .05), calyx * .8);
  vec3 q = n * 30.0; vec3 cell = floor(q); vec3 f = fract(q) - .5; float h = aH(cell + uSeed);
  float dotL = smoothstep(.12, .05, length(f - (vec3(aH(cell + 1.7), aH(cell + 3.1), aH(cell + 5.3)) - .5) * .5)) * step(.62, h) * (1.0 - well);
  skin = mix(skin, mix(vec3(.62, .42, .16), vec3(.75, .62, .3), 1.0 - blush), dotL * .45);
  // shaft hole: torn skin and a bruise ring where the arrow went through
  vec3 sa = normalize(uShaft); float axisDist = length(p - sa * dot(p, sa));
  float hole = smoothstep(.17, .07, axisDist);
  skin = mix(skin, vec3(.24, .08, .03), hole * .7);
  // flesh: cream, fibrous toward the core, wet when fresh, browning with age; seeds in five pockets round the axis
  float along = dot(p, sa); vec3 perp = p - sa * along; float coreR = length(perp);
  vec3 b1 = normalize(cross(sa, vec3(1.0, 0.0, 0.0))), b2 = cross(sa, b1);
  vec3 flesh = vec3(.8, .63, .28) * (.93 + .1 * aN(p * 22.0)) * mix(vec3(1.0), vec3(.98, .9, .72), smoothstep(.55, .25, coreR));
  flesh = mix(flesh, vec3(.66, .48, .24), uBrown);
  float seedA = mod(atan(dot(perp, b2), dot(perp, b1)) + uSeed, 1.2566) - .6283;
  float seed = smoothstep(.075, .04, length(vec2(seedA * coreR * 1.5, (coreR - .2) * 1.4)) + abs(along) * .12) * step(abs(along), .3);
  flesh = mix(flesh, vec3(.18, .09, .04), seed);
  if (uCut.w > 0.0) { // the lengthwise section: (u across, v along the stem axis) on the cut face
   vec3 cu = normalize(cross(uCut.xyz, vec3(0.0, 1.0, 0.0))); float u = dot(p, cu), v = p.y;
   float ring = abs(length(vec2(u * 1.05, (v - .02) * .92)) - .5);                       // the vascular bundle ring
   float core = length(vec2(u * 1.7, (v + .02) * .95));                                   // papery core: a soft heart
   float pocket = length(vec2((abs(u) - .13) * 2.4, (v + .02) * 1.1));                   // two carpel pockets
   vec2 sd = vec2(abs(u) - .12, v + .03); sd = vec2(sd.x * .94 - sd.y * .34, sd.x * .34 + sd.y * .94); // tilted inward
   float seedS = length(vec2(sd.x / (.05 + .025 * smoothstep(.1, -.1, sd.y)), sd.y / .1));      // tear-drop, broad end down
   float channel = smoothstep(.035, .012, abs(u)) * smoothstep(.15, .5, v);              // stem channel
   float calyxTube = smoothstep(.04, .015, abs(u)) * smoothstep(-.32, -.6, v);
   vec3 sect = vec3(.86, .7, .36) * (.95 + .07 * aN(vec3(u * 26.0, v * 26.0, uSeed)));
   sect = mix(sect, vec3(.95, .84, .52), smoothstep(.03, .008, ring) * .6);
   sect = mix(sect, vec3(.93, .8, .48), smoothstep(.36, .3, core) * .7);
   sect = mix(sect, vec3(.74, .58, .3), smoothstep(.36, .34, core) * smoothstep(.3, .34, core) * .8); // core membrane line
   sect = mix(sect, vec3(.62, .48, .24), smoothstep(.2, .15, pocket));
   sect = mix(sect, vec3(.2, .085, .03) * (1.0 + .9 * smoothstep(.7, .0, length(sd / vec2(.03, .05) - vec2(-.4, .5)))), smoothstep(1.0, .85, seedS));
   sect = mix(sect, vec3(.66, .54, .28), max(channel, calyxTube) * .7);
   sect = mix(sect, vec3(.66, .48, .24), uBrown);
   flesh = mix(flesh, sect, vCut);
  }
  vec3 c = mix(skin, flesh, flesh01);
  c = mix(c, vec3(.86, .78, .5), flesh01 * smoothstep(-.05, -.008, vFlesh) * .45 * (1.0 - vCut)); // a bright, fresh-cut lip
  c *= mix(1.0, .7, flesh01 * smoothstep(-.04, -.3, vFlesh) * (1.0 - vCut)); // the deep of a scoop sits in its own shade (not a flat cut)
  diffuseColor.rgb = c;
  appleRough = mix(mix(.42, .55, mottle) * (1.0 - dotL * .2), mix(.6, .86, 1.0 - uWet) * (.9 + .2 * aN(p * 40.0)), flesh01);
  appleFlesh = flesh01;
 }
`;

/** Shared apple material factory: each apple gets its own instance (bite uniforms), one program for all. */
export function createAppleMaterial({physical = false, seed = 1, sunSide = [.4, .5, .7]} = {}) {
 const r = rand(seed*131 + 3), Base = physical ? T.MeshPhysicalMaterial : T.MeshStandardMaterial;
 const m = new Base({color: 0xffffff, roughness: 1, metalness: 0, ...(physical ? {clearcoat: .35, clearcoatRoughness: .38, sheen: .15, sheenRoughness: .6, sheenColor: new T.Color(.9, .6, .5)} : {})});
 m.name = physical ? 'AppleSkinNear' : 'AppleSkin';
 const deep = new T.Color().setRGB(.17 + r()*.05, .008, .01), bright = new T.Color().setRGB(.42 + r()*.08, .03 + r()*.02, .015);
 const uniforms = {uBite: {value: [new T.Vector4(), new T.Vector4(), new T.Vector4()]}, uBiteAxis: {value: new T.Vector3(0, 1, 0)}, uShaft: {value: new T.Vector3(0, 1, 0)}, uCut: {value: new T.Vector4()},
  uSkinDeep: {value: new T.Vector3(deep.r, deep.g, deep.b)}, uSkinBright: {value: new T.Vector3(bright.r, bright.g, bright.b)}, uGround: {value: new T.Vector3(.46, .36, .05)},
  uSunSide: {value: new T.Vector3(...sunSide)}, uSeed: {value: seed % 97}, uBrown: {value: 0}, uWet: {value: 1}};
 m.userData.apple = uniforms;
 m.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
   .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_BITE)
   .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = appleP;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
   .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
   .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = appleRough;')
   .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n material.clearcoat *= 1.0 - appleFlesh;\n#endif\n#ifdef USE_SHEEN\n material.sheenColor *= 1.0 - appleFlesh;\n#endif');
 };
 m.customProgramCacheKey = () => 'apple-v2' + (physical ? 'p' : 's');
 return m;
}

// Bite placement around the shaft: three scoops 120 degrees apart leave the core along the shaft.
// shaftLocal: unit shaft direction in apple space. Returns centres/radii in apple space for bites 0..2.
export function biteSpheres(shaftLocal, seed = 1, half = false) {
 const a = new T.Vector3(...shaftLocal).normalize(), side = Math.abs(a.x) < .9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
 const p1 = side.clone().sub(a.clone().multiplyScalar(side.dot(a))).normalize(), p2 = new T.Vector3().crossVectors(a, p1), start = (seed % 7)*.4;
 if (half) return [0, 1].map(i => { // a half is bitten round its dome, either side of its middle
  const dir = new T.Vector3(-1, (i - .5)*.9, (i - .5)*.5).normalize(); return {centre: dir.clone().multiplyScalar(.97), radius: .5, direction: dir, angle: i}; });
 return [0, 1, 2].map(i => { const phi = start + i*Math.PI*2/3, dir = p1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(p2, Math.sin(phi));
  return {centre: dir.clone().multiplyScalar(.97).addScaledVector(a, (i - 1)*.07), radius: i === 2 ? .7 : .66, direction: dir, angle: phi}; });
}

/** Apply `count` bites (0-3) to an apple material; ages: seconds since each bite (browning, wetness). */
export function setBites(material, spheres, count, {age = 0, axis = null} = {}) {
 const u = material.userData.apple; if (!u) return;
 for (let i = 0; i < 3; i++) { const s = spheres[i]; if (i < count && s) u.uBite.value[i].set(s.centre.x, s.centre.y, s.centre.z, s.radius); else u.uBite.value[i].set(0, 0, 0, 0); }
 if (axis) u.uBiteAxis.value.copy(axis);
 u.uBrown.value = Math.min(.75, Math.max(0, (age - 8)/90)); u.uWet.value = Math.max(0, 1 - age/25);
}

/** A complete apple (body + stem/leaf) for the world or the hand. Returns {root, body, material, spheres, shaftLocal}. */
export function createApple({seed = 1, quality = 'high', physical = false, shaftTilt = .52, half = false} = {}) {
 const root = new T.Group(); root.name = 'Apple';
 const material = createAppleMaterial({physical, seed}), body = new T.Mesh(createAppleGeometry({seed, quality, half}), material); body.name = 'AppleBody'; root.add(body);
 const stem = createAppleStem({seed}); stem.position.x = body.geometry.userData.apple.lean*.5; stem.position.y = body.geometry.userData.apple.stemTop - .5; root.add(stem);
 // the shaft runs close to the core (a candy-apple line), tilted so the stem stands beside it
 // a half is cut lengthwise through the stem: its flat face looks along +X, its stem axis is Y
 const shaftLocal = half ? new T.Vector3(0, 1, 0) : new T.Vector3(0, Math.cos(shaftTilt), Math.sin(shaftTilt));
 material.userData.apple.uShaft.value.copy(shaftLocal);
 if (half) { material.userData.apple.uCut.value.set(1, 0, 0, 1); stem.visible = seed % 2 === 0; stem.traverse(n => { if (n.name === 'Leaf') n.visible = false; }); }
 const spheres = biteSpheres(shaftLocal.toArray(), seed, half);
 return {root, body, stem, material, spheres, shaftLocal, dispose() { body.geometry.dispose(); material.dispose(); stem.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }};
}

const STICK_APPLE = {arrow: .26, bolt: .17};
/** Apple on its shaft. Root frame: apple centre at the origin, shaft along -Z toward the tip (the projectile
 *  visual's own forward), so a drop orients the root to its shared `dir`. stickVisual: a prepared projectile
 *  visual (client/asset-pose.js prepareProjectile) or null for a bare apple. */
export function createSnackModel({stick = 'arrow', stickVisual = null, seed = 1, radius = .085, quality = 'high', physical = false, half = false} = {}) {
 const root = new T.Group(); root.name = 'AppleSnack';
 const apple = createApple({seed, quality, physical, half}), spin = new T.Group(); spin.name = 'AppleSpin';
 apple.root.scale.setScalar(radius);
 apple.root.quaternion.setFromUnitVectors(apple.shaftLocal, new T.Vector3(0, 0, -1));
 apple.root.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), ((seed*2.399) % (Math.PI*2))));
 spin.add(apple.root); root.add(spin);
 let shaft = null;
 if (stickVisual) {
  stickVisual.updateMatrixWorld(true); const box = new T.Box3().setFromObject(stickVisual);
  shaft = new T.Group(); shaft.name = 'SnackShaft'; shaft.add(stickVisual); stickVisual.position.z -= box.min.z + (STICK_APPLE[stick] ?? .22); spin.add(shaft);
  shaft.userData.length = box.max.z - box.min.z; shaft.userData.tail = box.max.z - box.min.z - (STICK_APPLE[stick] ?? .22);
 }
 const faceNormal = new T.Vector3(1, 0, 0).applyQuaternion(apple.root.quaternion); // a half's flat face, root space
 return {root, spin, apple, shaft, radius, stick, half, faceNormal,
  // world/root-space direction of bite i's face, for turning it toward the mouth
  biteDirection(i, out = new T.Vector3()) { return out.copy(apple.spheres[i].direction).applyQuaternion(apple.root.quaternion); },
  dispose() { apple.dispose(); }};
}
