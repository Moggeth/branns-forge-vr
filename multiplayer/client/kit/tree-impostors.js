// Core kit trees beyond the live window: impostors baked from the very same tree models the Simulation's trees use, so
// a tree looks the same whether it is drawn as a model up close or as a card on the far hills.
// - Bake (once, at load, a few dozen small renders): each species from eight directions into two atlases, its colour
//   (lit by flat white light, so it is plain albedo) and its surface normals. No lighting is baked in: the cards are lit
//   live by the same sun, sky and haze as everything else, through day, night and weather.
// - Draw: one instanced draw for every far tree. Each card turns to face the camera around its trunk and shows the
//   baked view nearest the camera's direction, dithering between the two nearest views as you walk round it.
// - No popping: cards thin out with distance one by one, each shrinking away at its own seeded distance, so the
//   forest fades into the haze instead of dropping trees at a ring. The wind sways the crowns like the live trees.
import * as THREE from 'three';
import {enhanceTreeTemplate} from '../forest-resource-art.js';

const FRAMES = 8;
const STYLE = {tree: 'broad', tree_b: 'weeping', tree_young: 'upright'};

/** The species models to bake, or null until every one has loaded. */
export function impostorSources(templates, variants) {
  const out = [];
  for (const v of variants) {
    const name = templates.has(v + '_lod') ? v + '_lod' : v, src = templates.get(name)?.scene;
    if (!src) return null;
    enhanceTreeTemplate(src, {lod: name.endsWith('_lod'), variant: STYLE[v] || 'broad'}); // idempotent; same as tree-view
    out.push(src);
  }
  return out;
}

/** Render every source from FRAMES directions into colour and normal atlases (one row per source). */
export function bakeImpostors(renderer, sources, frameSize = 256) {
  const rows = sources.length, W = frameSize * FRAMES, H = frameSize * rows;
  const target = colorSpace => {
    const rt = new THREE.WebGLRenderTarget(W, H, {type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace});
    rt.texture.anisotropy = 4; return rt;
  };
  const albedo = target(THREE.SRGBColorSpace), normal = target(THREE.NoColorSpace);
  const scene = new THREE.Scene(), light = new THREE.AmbientLight(0xffffff, Math.PI); scene.add(light);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100), normalMaterial = new THREE.MeshNormalMaterial({side: THREE.DoubleSide});
  const dims = [];
  const saved = {target: renderer.getRenderTarget(), autoClear: renderer.autoClear, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    shadow: renderer.shadowMap.enabled, xr: renderer.xr.enabled};
  renderer.autoClear = false; renderer.shadowMap.enabled = false; renderer.xr.enabled = false;
  try {
    for (const [rt, color] of [[albedo, 0x4f7a34], [normal, 0x8080ff]]) {
      rt.scissorTest = false; rt.viewport.set(0, 0, W, H); renderer.setRenderTarget(rt); renderer.setClearColor(color, 0); renderer.clear(true, true, false);
    }
    sources.forEach((src, row) => {
      const tree = src.clone(true); tree.position.set(0, 0, 0); tree.rotation.set(0, 0, 0); tree.scale.set(1, 1, 1); tree.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(tree);
      const R = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) * 1.1, base = Math.min(0, box.min.y), S = Math.max(2 * R, (box.max.y - base) * 1.08);
      dims.push([S, base]);
      scene.add(tree);
      camera.left = -S / 2; camera.right = S / 2; camera.top = S / 2; camera.bottom = -S / 2; camera.near = .01; camera.far = S * 4; camera.updateProjectionMatrix();
      for (let f = 0; f < FRAMES; f++) {
        const a = f / FRAMES * Math.PI * 2;
        camera.position.set(Math.sin(a) * S * 2, base + S / 2, Math.cos(a) * S * 2); camera.lookAt(0, base + S / 2, 0); camera.updateMatrixWorld(true);
        for (const [rt, override] of [[albedo, null], [normal, normalMaterial]]) {
          rt.viewport.set(f * frameSize, row * frameSize, frameSize, frameSize); rt.scissor.copy(rt.viewport); rt.scissorTest = true;
          renderer.setRenderTarget(rt); renderer.clear(false, true, false); // fresh depth for this cell only
          scene.overrideMaterial = override; renderer.render(scene, camera);
        }
      }
      scene.remove(tree);
    });
  } finally {
    scene.overrideMaterial = null;
    for (const rt of [albedo, normal]) { rt.scissorTest = false; rt.viewport.set(0, 0, W, H); }
    renderer.setRenderTarget(saved.target); renderer.autoClear = saved.autoClear; renderer.setClearColor(saved.clear, saved.alpha);
    renderer.shadowMap.enabled = saved.shadow; renderer.xr.enabled = saved.xr;
    normalMaterial.dispose();
  }
  return {albedo, normal, dims, rows, frames: FRAMES, frameSize, dispose() { albedo.dispose(); normal.dispose(); }};
}

/**
 * The far-tree field. set(list, n) takes n packed instances: x, y, z, scale, species row, seed (0..1), r, g, b.
 * fade: {value: Vector2(start, end)} — each tree vanishes (dissolving) at its own seeded distance between the two.
 */
export function createImpostorField({bake, capacity, fade, time}) {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, .5, 0); // two rows so the wind can bend the crown
  geometry.index = quad.index; geometry.setAttribute('position', quad.attributes.position); geometry.setAttribute('uv', quad.attributes.uv);
  geometry.setAttribute('normal', quad.attributes.normal);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4), iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const iTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  for (const a of [iPos, iData, iTint]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iPos', iPos); geometry.setAttribute('iData', iData); geometry.setAttribute('iTint', iTint); geometry.instanceCount = 0;
  const material = new THREE.MeshStandardMaterial({roughness: .88, metalness: 0, side: THREE.DoubleSide});
  const uniforms = {
    impAlbedo: {value: bake.albedo.texture}, impNormal: {value: bake.normal.texture}, impFade: fade, impTime: time,
    impDims: {value: bake.dims.map(d => new THREE.Vector2(d[0], d[1]))}, impGrid: {value: new THREE.Vector2(bake.frames, bake.rows)},
    impSize: {value: new THREE.Vector2(bake.frames * bake.frameSize, bake.rows * bake.frameSize)},
  };
  const rows = bake.rows;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iPos; attribute vec2 iData; attribute vec3 iTint;
        uniform vec2 impDims[${rows}]; uniform vec2 impGrid; uniform vec2 impFade; uniform float impTime;
        varying vec2 vImpUv; varying float vImpFrame; varying float vImpRow; varying float vImpKeep; varying vec3 vImpTint; varying float vImpSeed;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 impToCam = cameraPosition - iPos.xyz; vec2 impDir = normalize(impToCam.xz + vec2(1e-5, 0.0));
        vec3 objectNormal = vec3(impDir.x, 0.0, impDir.y);`)
      .replace('#include <begin_vertex>', `
        // Far trees bow out one by one, each at its own seeded distance, shrinking away over 80 m (no dither noise).
        float impDist = length(impToCam.xz), impAt = mix(impFade.x, impFade.y, iData.y);
        float impKeep = 1.0 - smoothstep(impAt - 40.0, impAt + 40.0, impDist);
        float impScale = iPos.w * impKeep;
        vec2 impD = impDims[int(iData.x + .5)]; float impS = impD.x * impScale;
        vec3 impRight = vec3(impDir.y, 0.0, -impDir.x);
        vec3 transformed = iPos.xyz + impRight * position.x * impS + vec3(0.0, impD.y * impScale + position.y * impS, 0.0);
        float impSway = position.y * position.y * impS * .025;
        transformed.xz += vec2(sin(impTime * 1.3 + iData.y * 40.0), cos(impTime * 1.07 + iData.y * 31.0)) * impSway;
        float impAz = atan(impDir.x, impDir.y);
        vImpFrame = mod(impAz / 6.2831853 * impGrid.x + impGrid.x, impGrid.x);
        vImpUv = vec2(position.x + .5, position.y); vImpRow = iData.x; vImpTint = iTint; vImpSeed = iData.y;
        vImpKeep = impKeep;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D impAlbedo, impNormal; uniform vec2 impGrid, impSize;
        varying vec2 vImpUv; varying float vImpFrame; varying float vImpRow; varying float vImpKeep; varying vec3 vImpTint; varying float vImpSeed;
        float impIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }`)
      .replace('#include <color_fragment>', `
        float impN = impIGN(gl_FragCoord.xy);
        if (vImpKeep <= 0.0) discard;
        float impF0 = floor(vImpFrame), impFi = mod(smoothstep(.3, .7, vImpFrame - impF0) > impN ? impF0 + 1.0 : impF0, impGrid.x);
        vec2 impUv = vec2((impFi + clamp(vImpUv.x, .004, .996)) / impGrid.x, (vImpRow + clamp(vImpUv.y, .004, .996)) / impGrid.y);
        vec4 impC = texture(impAlbedo, impUv);
        // Coverage that holds at every mip: averaged-down leaf gaps would otherwise thin a far crown into specks.
        vec2 impPx = impUv * impSize;
        float impLod = .5 * log2(max(max(dot(dFdx(impPx), dFdx(impPx)), dot(dFdy(impPx), dFdy(impPx))), 1e-6));
        float impAlpha = impC.a * (1.0 + clamp(impLod, 0.0, 3.0) * .17);
        if ((impAlpha - .5) / max(fwidth(impAlpha), 1e-4) + .5 < .5) discard;  // sharpened: crowns keep a crisp edge
        diffuseColor.rgb *= impC.rgb * vImpTint;
        vec3 impNv = texture(impNormal, impUv).xyz * 2.0 - 1.0;
        float impA = impFi / impGrid.x * 6.2831853;
        vec3 impNw = normalize(vec3(cos(impA), 0.0, -sin(impA)) * impNv.x + vec3(0.0, 1.0, 0.0) * impNv.y + vec3(sin(impA), 0.0, cos(impA)) * impNv.z);`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(impNw, 0.0)).xyz);');
  };
  material.customProgramCacheKey = () => 'kit-impostor-v1-' + rows;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'wilds-tree-impostors'; mesh.frustumCulled = false; mesh.userData.ignoreContact = true;
  return {
    mesh,
    capacity,
    /** Write n packed instances (x, y, z, scale, row, seed, r, g, b per tree). */
    set(data, n) {
      const P = iPos.array, D = iData.array, C = iTint.array;
      n = Math.min(n, capacity);
      for (let k = 0; k < n; k++) {
        const o = k * 9;
        P[k * 4] = data[o]; P[k * 4 + 1] = data[o + 1]; P[k * 4 + 2] = data[o + 2]; P[k * 4 + 3] = data[o + 3];
        D[k * 2] = data[o + 4]; D[k * 2 + 1] = data[o + 5]; C[k * 3] = data[o + 6]; C[k * 3 + 1] = data[o + 7]; C[k * 3 + 2] = data[o + 8];
      }
      for (const a of [iPos, iData, iTint]) a.needsUpdate = true;
      geometry.instanceCount = n;
    },
    count: () => geometry.instanceCount,
    dispose() { geometry.dispose(); quad.dispose(); material.dispose(); bake.dispose(); },
  };
}
