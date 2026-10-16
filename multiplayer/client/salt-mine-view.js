// The Brinedeep salt mines, drawn (the shape and rules are shared/salt-mines.js and shared/salt-mine-rules.js).
// Level 2 presentation, presentation only: nothing here changes heights, collision or raycast targets.
//
// - The cave: one floor and one shell (walls + vaulted roof) per mine, built once from the shared shape so the walls
//   stand exactly where walkers stop. A grid over the mine is pulled onto the wall line, the roof follows the shared
//   arch, and a wall ribbon hangs from the roof's rim to below the floor, so the cave is closed. Pink and white rock
//   salt in strata bands with baked occlusion; the shader adds fine grain and glowing salt-lamp veins (emissive only).
// - Outside: a cap of mountain over the tunnel (the ground's own material) and a rock headwall round the portal, so
//   from the meadow or the God's view the mountain looks whole. The mountain shell is drawn over the hall
//   (client/mountain-arena.js reads the unmined surface there).
// - Inside: daylight and sky give way to the salt's glow. The camera's depth into a mine (shared mineDepth) dims the
//   sun, sky light and reflections, closes the fog in to a warm rose dusk and hushes the weather; one pooled point
//   light rides with the viewer as their lantern (always in the scene, zero outside: no shader recompiles).
// - The kit (Blender, assets-source/salt-mine-kit -> /assets/salt-mine-kit.glb): the timbered portal, tunnel sets,
//   rails, an ore cart, lanterns, showpiece salt clusters, firedamp vents and brine-pool rims, instanced.
// - Hazards: dust trickling where the roof is about to fall and a growing shadow under it; the fall itself (rocks and
//   a dust burst); the firedamp's yellow-green seep over full vents and the blast.
import * as THREE from 'three';
import {createSaltMineProps} from './salt-mine-props.js';
import {createSaltMineHazards} from './salt-mine-hazards.js';
import {MINE, MINE_SIDES, mineArch, mineDepth, mineField, mineInside, minePoint, mineSideAt, minePortal, portalAlong, pathLength} from '../shared/salt-mines.js';
import {DAMP_VENTS, SALT, SEAM_SPOTS, spotPoint} from '../shared/salt-mine-rules.js';

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// Small deterministic value noise for baking (the shader has its own).
const h3 = (x, y, z) => { let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t, c = (a, b, d) => h3(ix + a, iy + b, iz + d);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), sx), L(c(0, 1, 0), c(1, 1, 0), sx), sy), L(L(c(0, 0, 1), c(1, 0, 1), sx), L(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
const fbm = (x, y, z) => .55 * vnoise(x, y, z) + .3 * vnoise(x * 2.1 + 7, y * 2.1, z * 2.1) + .15 * vnoise(x * 4.3, y * 4.3 + 3, z * 4.3);

export const MINE_LOOK = Object.freeze({
  // Rock-salt strata: blush, rose, milk-white and a warm iron-stained band (linear-ish sRGB, multiplied by AO).
  bands: Object.freeze([[.86, .62, .62], [.78, .47, .5], [.92, .86, .82], [.7, .55, .5], [.85, .6, .6]]),
  floor: Object.freeze([.8, .64, .57]),
  glow: 0xff7f95, amber: 0xffb070,
  fog: 0x1d0e13,                  // the rose dusk deep inside
  lantern: Object.freeze({color: 0xffc07a, intensity: 9, distance: 13, decay: 1.6}),
  dim: Object.freeze({sun: 1, hemi: .9, env: .82}), // fraction of each light removed at full depth
});

// ---- Shared salt-rock shading: grain and glowing veins in world space, patched into a standard material.
const mineUniforms = {uMineTime: {value: 0}, uMineGlow: {value: 1}, uMineGlowColor: {value: new THREE.Color(MINE_LOOK.glow)}, uMineAmber: {value: new THREE.Color(MINE_LOOK.amber)}};
const NOISE_GLSL = `
float mh(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float mn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
export function patchSaltRock(material, {veins = 1, grain = 1, key = 'salt-rock', low = false, cleave = 1} = {}) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, mineUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMineWorld; varying vec3 vMineN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMineWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vMineN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMineWorld; varying vec3 vMineN; uniform float uMineTime, uMineGlow; uniform vec3 uMineGlowColor, uMineAmber;${NOISE_GLSL}
// Rock salt grows as a mosaic of interlocked crystals: irregular blocks, each its own shade of pink or milk and its
// faces tilted a touch so each catches the lantern on its own, with hairline fissures between some of them where the
// inner glow bleeds out. 3D cellular noise in world space (no texture coordinates, so nothing stretches).
vec3 mineH3(vec3 p){ return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }
vec2 mineCells(vec3 p, out vec3 cellId){
  vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; cellId = i;
  ${low ? 'vec3 e = min(f, 1.0 - f); cellId = i; return vec2(.3, min(e.x, min(e.y, e.z)) * 2.0); // phones: plain staggered blocks' : ''}
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)), o = mineH3(i + g), r = g + o * vec3(.85, .55, .85) - f;
    float d = max(abs(r.x), max(abs(r.y) * 1.25, abs(r.z))); // a boxy metric: blocky, cleaved crystals, not bubbles
    if (d < d1) { d2 = d1; d1 = d; cellId = i + g; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2 - d1);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 mineId; vec2 mineC = mineCells(vMineWorld * vec3(1.35, 1.7, 1.35) + vec3(0.0, 13.0, 0.0), mineId);
        float mineR = mh(mineId * 1.37 + 4.1), mineRF = mn(vMineWorld * 9.0);
        float mineAA = max(fwidth(mineC.y), 1e-4);
        // fissures only along some block edges (a broad noise picks which), so it reads cracked, not tiled
        float mineCrack = (1.0 - smoothstep(.0, .016 + mineAA, mineC.y)) * smoothstep(.45, .7, mn(vMineWorld * 1.3 + 2.0));
        mineCrack *= ${cleave.toFixed(3)};
        float mineGrain = mn(vMineWorld * 6.0)${low ? '' : ' * .6 + mn(vMineWorld * 17.0) * .4'};
        // block shade: milkier or rosier blocks, a few nearly clear; fine frosting within each
        vec3 mineTint = mix(vec3(1.05, 1.0, .99), vec3(1.0, .9, .92), smoothstep(.35, .95, mineR)) * (.95 + .1 * mineRF);
        diffuseColor.rgb *= mix(vec3(1.0), mineTint, ${(.8 * cleave).toFixed(3)});
        diffuseColor.rgb *= ${(1 - .22 * grain).toFixed(3)} + ${(.44 * grain).toFixed(3)} * mineGrain;
        diffuseColor.rgb *= 1.0 - .22 * mineCrack;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // each block tilts on its own (world space, then into view space)
        vec3 mineTilt = (vec3(mh(mineId + 1.3), mh(mineId + 2.9), mh(mineId + 5.1)) - .5) * ${(.26 * cleave).toFixed(3)};
        normal = normalize(normal + mat3(viewMatrix) * mineTilt);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Salt-lamp light from inside the rock: a soft warm glow that swells through the rosy strata (the vertex colour's
        // blush), breathing slowly in broad patches, bleeding from the fissures between blocks, and pin-point glints
        // where crystal faces catch it.
        float mineBlush = clamp((vColor.r - vColor.b) * 2.6, 0.0, 1.0);
        float mineSwell = smoothstep(.35, .85, mn(vMineWorld * vec3(.32, .8, .32) + vec3(0.0, uMineTime * .015, 0.0)));
        float minePulse = .82 + .18 * sin(uMineTime * .6 + vMineWorld.x * .5 + vMineWorld.z * .4);
        float mineGlint = ${low ? '0.0' : 'smoothstep(.93, .985, mn(vMineWorld * 23.0)) * .9'};
        float mineClear = smoothstep(.88, .99, mineR); // the odd near-clear block lit from behind
        vec3 mineGlow = mix(uMineGlowColor, uMineAmber, mn(vMineWorld * .35));
        totalEmissiveRadiance += mineGlow * ((.04 + .2 * mineBlush * mineSwell + .25 * mineClear * mineSwell + .16 * mineCrack * (.25 + mineSwell)) * ${veins.toFixed(3)} * minePulse + mineGlint * ${(.6 * veins).toFixed(3)}) * uMineGlow * vColor.rgb;`);
  };
  material.customProgramCacheKey = () => key + (low ? '-low' : '');
  return material;
}

// ---- The cave, built in corner space for one mine and placed in world space.
function grad(u, v) {
  const e = .04, d = (a, b) => mineField(a, b).d;
  const gu = (d(u + e, v) - d(u - e, v)) / (2 * e), gv = (d(u, v + e) - d(u, v - e)) / (2 * e), l = Math.hypot(gu, gv) || 1;
  return [gu / l, gv / l];
}
// The portal plane: through path point 1, across the first stretch of path. s < 0 is the cutting outside.
const P0 = MINE.path[0], P1 = MINE.path[MINE.portal], PORTAL_DIR = (() => { const du = P1[0] - P0[0], dv = P1[1] - P0[1], l = Math.hypot(du, dv); return [du / l, dv / l]; })();
const portalS = (u, v) => (u - P1[0]) * PORTAL_DIR[0] + (v - P1[1]) * PORTAL_DIR[1];
// The same, for building the cave: only near the portal (the grotto lies behind the portal's plane, far off to the side).
const caveS = (u, v) => Math.hypot(u - P1[0], v - P1[1]) > 6 ? 9 : portalS(u, v);
/** Pull a corner-space point onto the cave: inside the wall line and not out past the portal. */
function pullIn(u, v) {
  for (let k = 0; k < 4; k++) {
    let moved = false;
    const s = caveS(u, v);
    if (s < 0) { u -= PORTAL_DIR[0] * s; v -= PORTAL_DIR[1] * s; moved = true; }
    const over = mineField(u, v).d - MINE.wall;
    if (over > 1e-4) { const [gu, gv] = grad(u, v); u -= gu * over; v -= gv * over; moved = true; }
    if (!moved) break;
  }
  return [u, v];
}

function buildCave(side, height, {step = .4} = {}) {
  const u0 = 46, u1 = 70, v0 = 40, v1 = 69, nu = Math.ceil((u1 - u0) / step) + 1, nv = Math.ceil((v1 - v0) / step) + 1;
  const N = nu * nv, cu = new Float32Array(N), cv = new Float32Array(N), keep = new Uint8Array(N), outside = new Uint8Array(N);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = j * nu + i, u = u0 + i * step, v = v0 + j * step, f = mineField(u, v), inside = MINE.wall - f.d, s = caveS(u, v);
    // keep vertices inside and a step beyond the walls (they are pulled onto the wall line); never the cutting
    keep[k] = inside > -step * 1.5 && s > -step * 1.5 && Math.abs(u - v) < 26 ? 1 : 0;
    outside[k] = inside < 0 || s < 0 ? 1 : 0;
    if (keep[k]) { const [pu, pv] = outside[k] ? pullIn(u, v) : [u, v]; cu[k] = pu; cv[k] = pv; }
  }
  // Triangles: every grid triangle with at least one vertex really inside.
  const tris = [];
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
    for (const t of [[a, c, b], [b, c, d]]) if (t.every(n => keep[n]) && t.some(n => !outside[n])) {
      // drop slivers folded flat onto the wall
      const ax = cu[t[1]] - cu[t[0]], ay = cv[t[1]] - cv[t[0]], bx = cu[t[2]] - cu[t[0]], by = cv[t[2]] - cv[t[0]];
      if (Math.abs(ax * by - ay * bx) > step * step * .02) tris.push(t);
    }
  }
  // Re-index the used vertices.
  const remap = new Int32Array(N).fill(-1), used = [];
  for (const t of tris) for (const n of t) if (remap[n] < 0) { remap[n] = used.length; used.push(n); }
  const V = used.length, world = new Float32Array(V * 2), floorY = new Float32Array(V), roofH = new Float32Array(V), inside = new Float32Array(V), rim = new Uint8Array(V);
  for (let q = 0; q < V; q++) {
    const n = used[q], [x, z] = minePoint(side, [cu[n], cv[n]]), a = mineArch(cu[n], cv[n]);
    world[q * 2] = x; world[q * 2 + 1] = z; floorY[q] = height(x, z); roofH[q] = a.height; inside[q] = Math.max(0, a.inside);
  }
  // Rim edges: used by one triangle only. Those on the portal plane stay open (the portal frame and headwall).
  const edgeCount = new Map(), key = (a, b) => a < b ? a * 1e6 + b : b * 1e6 + a;
  for (const t of tris) for (let e = 0; e < 3; e++) { const a = remap[t[e]], b = remap[t[(e + 1) % 3]], k = key(a, b); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  const rimEdges = [];
  for (const t of tris) for (let e = 0; e < 3; e++) {
    const a = remap[t[e]], b = remap[t[(e + 1) % 3]];
    if (edgeCount.get(key(a, b)) !== 1) continue;
    const pa = caveS(cu[used[a]], cv[used[a]]), pb = caveS(cu[used[b]], cv[used[b]]);
    if (Math.abs(pa) < .02 && Math.abs(pb) < .02) continue;
    rimEdges.push([a, b]); rim[a] = rim[b] = 1;
  }
  return {side, tris: tris.map(t => t.map(n => remap[n])), V, world, floorY, roofH, inside, rim, rimEdges, corner: used.map(n => [cu[n], cv[n]])};
}

function stratumColour(x, y, z, out) {
  const B = MINE_LOOK.bands, t = y * 1.35 + 2.2 * fbm(x * .23, y * .18, z * .23) + .6 * Math.sin(x * .11 + z * .07);
  const f = ((t % B.length) + B.length) % B.length, i = Math.floor(f), k = smooth((f - i - .65) / .35), a = B[i], b = B[(i + 1) % B.length];
  for (let c = 0; c < 3; c++) out[c] = lerp(a[c], b[c], k);
  return out;
}
const C3 = [0, 0, 0];
// Distance from the track's centre line (the path from the cutting, run on 2.6 m into the hall, as the kit lays it).
const TRACK = (() => {
  const P = MINE.path, a = P[P.length - 2], b = P[P.length - 1], du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
  return [...P.slice(0, -1).map(p => [p[0], p[1]]), [b[0] + du / l * 2.6, b[1] + dv / l * 2.6]];
})();
function trackDistance(u, v) {
  let best = Infinity;
  for (let i = 0; i < TRACK.length - 1; i++) {
    const a = TRACK[i], b = TRACK[i + 1], du = b[0] - a[0], dv = b[1] - a[1], t = clamp(((u - a[0]) * du + (v - a[1]) * dv) / (du * du + dv * dv));
    best = Math.min(best, Math.hypot(u - a[0] - du * t, v - a[1] - dv * t));
  }
  return best;
}
function caveGeometries(cave, {low = false} = {}) {
  const {V, world, floorY, roofH, inside, tris, rimEdges, corner} = cave;
  // Roof: vaulted, with hanging lumps away from the walls; faces down into the cave.
  const rp = new Float32Array(V * 3), rc = new Float32Array(V * 3);
  for (let q = 0; q < V; q++) {
    const x = world[q * 2], z = world[q * 2 + 1], lumps = clamp(inside[q] / 1.2) * (.18 + .3 * fbm(x * .55, 3.1, z * .55));
    const y = floorY[q] + roofH[q] - lumps;
    rp.set([x, y, z], q * 3);
    stratumColour(x, y, z, C3); const ao = .62 + .38 * smooth(1 - inside[q] / 3.5) * .5 + .2 * fbm(x * 1.3, y, z * 1.3);
    rc.set([C3[0] * ao, C3[1] * ao, C3[2] * ao], q * 3);
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.BufferAttribute(rp, 3)); roof.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  roof.setIndex(tris.flatMap(([a, b, c]) => [a, c, b])); // reversed from the floor's winding (both draw double-sided, lit by facing)
  // Floor: worked salt rock, lighter, a crust of white near the walls; faces up.
  const fp = new Float32Array(V * 3), fc = new Float32Array(V * 3);
  for (let q = 0; q < V; q++) {
    const x = world[q * 2], z = world[q * 2 + 1], y = floorY[q] + .035, crust = 1 - smooth(inside[q] / .9), n = fbm(x * .9, 0, z * .9);
    fp.set([x, y, z], q * 3);
    // Worked salt: a white crust creeping out from the walls, boots polishing a warmer path down the middle of the
    // passages, and the track's bed of grey-brown ballast.
    const [u, v] = corner[q], f = mineField(u, v), worn = smooth((-f.tunnel - .35) / .9) * (1 - f.hall * .7), bed = 1 - smooth((trackDistance(u, v) - .55) / .3);
    const F = MINE_LOOK.floor, w = .35 * crust + .15 * n - .12 * worn, ao = (.78 + .22 * smooth(inside[q] / .6)) * (.92 + .16 * n) * (1 + .06 * worn);
    let r = lerp(F[0], .97, w) * ao, g = lerp(F[1], .93, w) * ao, b = lerp(F[2], .9, w) * ao;
    const grit = .82 + .3 * fbm(x * 4.1, 1.7, z * 4.1);
    r = lerp(r, .46 * grit, bed * .85); g = lerp(g, .38 * grit, bed * .85); b = lerp(b, .34 * grit, bed * .85);
    fc.set([r, g, b], q * 3);
  }
  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.BufferAttribute(fp, 3)); floor.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  floor.setIndex(tris.flat());
  // Walls: a ribbon down from the roof's rim to below the floor, bulging out a little (never into walking space).
  const rows = low ? 4 : 12, wp = [], wc = [], wi = [];
  const ribbonOf = new Map();
  const column = q => {
    if (ribbonOf.has(q)) return ribbonOf.get(q);
    const x = world[q * 2], z = world[q * 2 + 1], [u, v] = corner[q], [gu, gv] = grad(u, v), side = cave.side;
    const [ox, oz] = side === 'east' ? [gu, -gv] : [-gu, gv]; // outward, in world space
    const base = wp.length / 3, top = floorY[q] + roofH[q], bottom = floorY[q] - .2;
    for (let r = 0; r <= rows; r++) {
      // bulging out into the rock, with the strata standing out as ledges the lantern can rake across
      const t = r / rows, y = lerp(top, bottom, t), ledge = .13 * Math.pow(.5 + .5 * Math.sin(y * 5.4 + 3 * fbm(x * .3, y * .2, z * .3)), 5);
      const bulge = Math.sin(Math.PI * t) * (.1 + .5 * fbm(x * .9, y * 1.1, z * .9)) + .12 * fbm(x * 2.7, y * 2.7, z * 2.7) - ledge * (low ? 0 : 1) + (r === rows ? .08 : 0);
      const px = x + ox * bulge, pz = z + oz * bulge;
      wp.push(px, y, pz);
      stratumColour(px, y, pz, C3); const ao = (.58 + .42 * smooth((y - floorY[q]) / 1.1)) * (.85 + .3 * fbm(px * 1.7, y * 1.7, pz * 1.7));
      wc.push(C3[0] * ao, C3[1] * ao, C3[2] * ao);
    }
    ribbonOf.set(q, base); return base;
  };
  for (const [a, b] of rimEdges) {
    const A = column(a), B = column(b);
    for (let r = 0; r < rows; r++) wi.push(A + r, A + r + 1, B + r, B + r, A + r + 1, B + r + 1);
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); walls.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3)); walls.setIndex(wi);
  // Walls must face into the cave: check one triangle against the outward direction and flip if needed.
  orientInward(walls, cave);
  // Roof and walls share one draw.
  const shell = mergeShell(roof, walls);
  for (const g of [shell, floor]) { g.computeVertexNormals(); g.computeBoundingSphere(); }
  roof.dispose(); walls.dispose();
  return {shell, floor};
}
function orientInward(walls, cave) {
  const p = walls.attributes.position, idx = walls.index; if (!idx || idx.count < 3) return;
  let votes = 0;
  for (let t = 0; t < Math.min(idx.count, 300); t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const ax = p.getX(b) - p.getX(a), ay = p.getY(b) - p.getY(a), az = p.getZ(b) - p.getZ(a), bx = p.getX(c) - p.getX(a), by = p.getY(c) - p.getY(a), bz = p.getZ(c) - p.getZ(a);
    const nx = ay * bz - az * by, nz = ax * by - ay * bx;
    const mx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, mz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    const [u, v] = cave.side === 'east' ? [mx, -mz] : [-mx, mz], [gu, gv] = grad(u, v), [ox, oz] = cave.side === 'east' ? [gu, -gv] : [-gu, gv];
    votes += Math.sign(nx * ox + nz * oz);
  }
  if (votes > 0) { const a = idx.array; for (let t = 0; t < a.length; t += 3) { const s = a[t + 1]; a[t + 1] = a[t + 2]; a[t + 2] = s; } idx.needsUpdate = true; }
}
function mergeShell(a, b) {
  const pa = a.attributes.position.array, pb = b.attributes.position.array, ca = a.attributes.color.array, cb = b.attributes.color.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const col = new Float32Array(ca.length + cb.length); col.set(ca); col.set(cb, ca.length);
  const ia = a.index.array, ib = b.index.array, off = pa.length / 3, index = new Uint32Array(ia.length + ib.length); index.set(ia); for (let i = 0; i < ib.length; i++) index[ia.length + i] = ib[i] + off;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// The headwall stands this far into the mountain behind the portal plane, so the kit's rock-salt collar round the
// timber frame shows in front of it.
const HEAD_BACK = 1.25;
// ---- Outside: the cap of mountain over the tunnel and the headwall round the portal (the ground's material).
function buildCapAndHeadwall(side, height, unmined) {
  const pos = [], idx = [], step = .5;
  // Cap: over every carved cell past the portal plane up to where the mountain shell takes over (Chebyshev 52.6).
  const u0 = 49, u1 = 55, v0 = 49, v1 = 55, nu = Math.round((u1 - u0) / step) + 1, nv = Math.round((v1 - v0) / step) + 1, map = new Int32Array(nu * nv).fill(-1);
  const inCap = (u, v) => portalS(u, v) > -.6 && Math.max(u, v) < 52.9 && mineField(u, v).d < MINE.wall + MINE.blend + .8;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = u0 + i * step, v = v0 + j * step; if (!inCap(u, v)) continue;
    const [x, z] = minePoint(side, [u, v]); map[j * nu + i] = pos.length / 3; pos.push(x, unmined(x, z) + .05, z);
  }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = map[j * nu + i], b = map[j * nu + i + 1], c = map[(j + 1) * nu + i], d = map[(j + 1) * nu + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    idx.push(a, c, b, b, c, d);
  }
  // Headwall: the rock face across the portal plane, from the cave's arch (or the cutting's floor beyond its walls)
  // up to the mountain's surface.
  const lat = [-PORTAL_DIR[1], PORTAL_DIR[0]], rows = 6, cols = 26, half = 4.6, base = pos.length / 3;
  for (let c = 0; c <= cols; c++) {
    const t = -half + 2 * half * c / cols, u = P1[0] + lat[0] * t + PORTAL_DIR[0] * HEAD_BACK, v = P1[1] + lat[1] * t + PORTAL_DIR[1] * HEAD_BACK, [x, z] = minePoint(side, [u, v]);
    const f = mineField(u, v), insideCave = MINE.wall - f.d > 0, floor = height(x, z);
    const bottom = insideCave ? floor + mineArch(u + PORTAL_DIR[0] * .02, v + PORTAL_DIR[1] * .02).height - .05 : floor - .3, top = Math.max(bottom + .3, unmined(x, z) + .05);
    for (let r = 0; r <= rows; r++) {
      const k = r / rows, y = lerp(bottom, top, k), push = Math.sin(Math.PI * k) * .18 * fbm(x * .7, y * .7, z * .7);
      const [ox, oz] = side === 'east' ? [-PORTAL_DIR[0] * push, PORTAL_DIR[1] * push] : [PORTAL_DIR[0] * push, -PORTAL_DIR[1] * push];
      pos.push(x + ox, y, z + oz);
    }
  }
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) { const a = base + c * (rows + 1) + r, b = a + rows + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); // the ground's own UVs (PlaneGeometry(120, 120) laid flat) so its textures and mask line up with the mountain round it
  const uv = new Float32Array(pos.length / 3 * 2); for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = (pos[i * 3] + 60) / 120; uv[i * 2 + 1] = (60 - pos[i * 3 + 2]) / 120; }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // the headwall must face out of the mountain toward the meadow
  g.computeVertexNormals();
  const n = g.attributes.normal, p = g.attributes.position, mid = base + (cols / 2) * (rows + 1) + rows / 2, [ox, oz] = side === 'east' ? [-PORTAL_DIR[0], PORTAL_DIR[1]] : [PORTAL_DIR[0], -PORTAL_DIR[1]];
  if (n.getX(mid) * ox + n.getZ(mid) * oz < 0) { const a = g.index.array; for (let t = (idx.length - cols * rows * 6); t < a.length; t += 3) { const s = a[t + 1]; a[t + 1] = a[t + 2]; a[t + 2] = s; } g.index.needsUpdate = true; g.computeVertexNormals(); }
  void p; g.computeBoundingSphere();
  return g;
}

export function createSaltMineView({scene, ground, height, unmined, quality = 'high', sound = () => {}, kick = () => {}} = {}) {
  const low = quality === 'low', group = new THREE.Group(); group.name = 'SaltMines'; scene.add(group);
  const rockMat = patchSaltRock(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .82, metalness: 0, emissive: 0x000000, envMapIntensity: .5, side: THREE.DoubleSide}), {low});
  const floorMat = patchSaltRock(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .9, metalness: 0, envMapIntensity: .4, side: THREE.DoubleSide}), {veins: .35, grain: .7, key: 'salt-floor', low});
  const mines = {};
  const geos = new Set(), stat = {buildMs: 0, triangles: 0, depth: 0, lantern: 0};
  const t0 = performance.now();
  for (const side of MINE_SIDES) {
    const cave = buildCave(side, height, {step: low ? .55 : .4}), {shell, floor} = caveGeometries(cave, {low});
    const shellMesh = new THREE.Mesh(shell, rockMat), floorMesh = new THREE.Mesh(floor, floorMat);
    for (const m of [shellMesh, floorMesh]) { m.raycast = () => {}; m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false; m.userData.presentationOnly = true; group.add(m); geos.add(m.geometry); }
    shellMesh.name = `SaltMine_${side}_shell`; floorMesh.name = `SaltMine_${side}_floor`;
    floorMesh.material.polygonOffset = true; floorMesh.material.polygonOffsetFactor = -1; floorMesh.material.polygonOffsetUnits = -1;
    const cap = new THREE.Mesh(buildCapAndHeadwall(side, height, unmined), ground.material);
    cap.name = `SaltMine_${side}_cap`; cap.raycast = () => {}; cap.receiveShadow = true; cap.matrixAutoUpdate = false; cap.userData.presentationOnly = true; group.add(cap); geos.add(cap.geometry);
    stat.triangles += (shell.index.count + floor.index.count + cap.geometry.index.count) / 3;
    mines[side] = {cave, shellMesh, floorMesh, cap};
  }
  stat.buildMs = performance.now() - t0;

  // The viewer's lantern: one pooled light, always present.
  const L = MINE_LOOK.lantern, lantern = new THREE.PointLight(L.color, 0, L.distance, L.decay);
  lantern.name = 'MineLantern'; lantern.castShadow = false; lantern.userData.ignoreContact = true; scene.add(lantern);
  const props = createSaltMineProps({scene, height, quality});
  const hazards = createSaltMineHazards({scene, height, rockMaterial: rockMat, quality, kick, sound, lantern});
  const eye = new THREE.Vector3(), look = new THREE.Vector3(), fogDeep = new THREE.Color(MINE_LOOK.fog), tmpC = new THREE.Color();
  let depth = 0, time = 0, primed = false; const lastEye = new THREE.Vector3();

  return {
    group, mines,
    /** How deep the viewer is in a mine (0..1), eased: the client uses it to hush weather and ambience. */
    depth: () => depth,
    /** After the sky, weather and orchard have set the day's light for this frame: dim it by the viewer's depth. */
    update(dt, {camera, sun, hemisphere, fog, renderer, snapshot, tick = 0} = {}) {
      time += dt; mineUniforms.uMineTime.value = time;
      camera.getWorldPosition(eye);
      const target = mineDepth(eye.x, eye.z) * (eye.y < height(eye.x, eye.z) + 4.5 ? 1 : 0);
      // Eased as you walk in; snapped on the first frame and after a jump (a respawn or a teleport across the map).
      if (!primed || Math.abs(target - depth) > .6 && eye.distanceTo(lastEye) > 4) depth = target; else depth += (target - depth) * Math.min(1, dt * 3.2);
      primed = true; lastEye.copy(eye);
      if (Math.abs(depth - target) < .002) depth = target;
      const k = smooth(depth), D = MINE_LOOK.dim;
      if (k > 0) {
        if (sun) sun.intensity *= 1 - D.sun * k;
        if (hemisphere) hemisphere.intensity *= 1 - D.hemi * k;
        scene.environmentIntensity = (scene.environmentIntensity ?? 1) * (1 - D.env * k);
        if (fog) { fog.color.lerp(fogDeep, k); if (fog.isFog) { fog.near = lerp(fog.near, 7, k); fog.far = lerp(fog.far, 34, k); } }
      }
      camera.getWorldDirection(look);
      lantern.position.copy(eye).addScaledVector(look, .55); lantern.position.y += .25;
      lantern.intensity = L.intensity * k; stat.lantern = lantern.intensity; stat.depth = depth;
      // The salt glows a touch brighter as your eyes adjust deep inside.
      mineUniforms.uMineGlow.value = .75 + .35 * k;
      props.update(dt, .8 + .4 * k, {snapshot, tick});
      hazards.update(dt, {snapshot, tick, camera});
      void tmpC;
    },
    /** Sim events: creaks, falls and firedamp blasts. */
    event(event) { hazards.event(event, eye); },
    props, hazards,
    stats: () => ({...stat, draws: group.children.length, kit: props.stats(), hazards: hazards.stats()}),
    dispose() {
      scene.remove(group); scene.remove(lantern); props.dispose(); hazards.dispose();
      for (const g of geos) g.dispose(); rockMat.dispose(); floorMat.dispose();
    },
  };
}
