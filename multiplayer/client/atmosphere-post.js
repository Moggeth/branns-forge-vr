// Desktop atmosphere post: sun shafts through gaps in the canopy (screen-space, from the depth buffer), soft glow on
// the bright magic, a gentle filmic grade and vignette. Phones skip it by default (?fx=high forces it on, ?fx=low off);
// WebXR always renders directly, because a headset needs every millisecond and its own layers.
import * as THREE from 'three';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

export function postTierFromUrl(search = globalThis.location?.search || '', coarse = !!globalThis.matchMedia?.('(pointer: coarse)').matches) {
  const fx = new URLSearchParams(search).get('fx');
  return fx === 'high' ? 'high' : fx === 'low' ? 'off' : coarse ? 'off' : 'high';
}

const QUAD_VERTEX = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Half-float HDR can receive NaNs from a material or overflow from additive VFX.
// Reject them BEFORE bloom spreads one bad fragment over every blur mip. Keep
// ordinary HDR values unchanged; 1024 leaves ample headroom for glow and keeps
// subsequent half-float blur/composite arithmetic below its 65504 limit.
const FINITE_HDR = `
  float bfFiniteHdr(float c) { return isnan(c) ? 0.0 : clamp(c, 0.0, 1024.0); }
  vec3 bfFiniteHdr(vec3 c) { return vec3(bfFiniteHdr(c.r), bfFiniteHdr(c.g), bfFiniteHdr(c.b)); }
`;

function raysMaterial(samples) {
  return new THREE.ShaderMaterial({
    uniforms: {tDepth: {value: null}, sunUv: {value: new THREE.Vector2(.5, .5)}, aspect: {value: 1}, strength: {value: 0}, jitter: {value: 0}},
    vertexShader: QUAD_VERTEX,
    fragmentShader: `uniform sampler2D tDepth; uniform vec2 sunUv; uniform float aspect, strength, jitter; varying vec2 vUv;
      float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + jitter) * 43758.5453); }
      void main(){
        if (strength <= 0.0) { gl_FragColor = vec4(0.0); return; }
        vec2 delta = (sunUv - vUv) / float(${samples}); vec2 uv = vUv + delta * rnd(vUv * 977.0);
        float illum = 0.0, decay = 1.0;
        for (int i = 0; i < ${samples}; i++) {
          vec2 d = uv - sunUv; d.x *= aspect;
          float sky = step(0.99995, texture2D(tDepth, uv).x) * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          illum += sky * decay * exp(-dot(d, d) * 6.0);
          decay *= 0.965; uv += delta;
        }
        gl_FragColor = vec4(vec3(illum / float(${samples}) * strength), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
}

function finalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {tScene: {value: null}, tRays: {value: null}, rayColor: {value: new THREE.Color()}, vignette: {value: .28}, lift: {value: new THREE.Color(0, 0, 0)},
      gain: {value: new THREE.Color(1, 1, 1)}, saturation: {value: 1}, contrast: {value: 1}, time: {value: 0}},
    vertexShader: QUAD_VERTEX,
    fragmentShader: `${FINITE_HDR}
      uniform sampler2D tScene, tRays; uniform vec3 rayColor, lift, gain; uniform float vignette, saturation, contrast, time; varying vec2 vUv;
      void main(){
        vec3 c = bfFiniteHdr(texture2D(tScene, vUv).rgb) + bfFiniteHdr(texture2D(tRays, vUv).rgb) * rayColor;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        c = c * gain + lift * (1.0 - c);
        vec2 v = vUv - 0.5; c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(v, v) * 2.2);
        c += (fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // dither against banding in mist
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: true,
  });
}

export function createAtmospherePost({renderer, tier = postTierFromUrl()}) {
  const enabled = tier === 'high' && renderer?.capabilities?.isWebGL2 !== false;
  const size = new THREE.Vector2(), stats = {tier, enabled, frames: 0, rays: 0, bloom: 0, w: 0, h: 0, sceneCalls: 0};
  if (!enabled) return {render: (scene, camera) => renderer.render(scene, camera), set() {}, stats: () => ({...stats}), dispose() {}};
  const depth = new THREE.DepthTexture(1, 1); depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4, depthTexture: depth});
  const raysRT = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthBuffer: false});
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .45, .55, 1.0);
  const highPass = bloom.materialHighPassFilter;
  const sample = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!highPass.fragmentShader.includes(sample)) throw new Error('Bloom shader changed: update the finite-HDR input guard.');
  highPass.fragmentShader = FINITE_HDR + highPass.fragmentShader.replace(sample,
    `${sample}\n texel = vec4(bfFiniteHdr(texel.rgb), 1.0);`);
  const rays = raysMaterial(48), final = finalMaterial();
  const raysQuad = new FullScreenQuad(rays), finalQuad = new FullScreenQuad(final);
  const sunWorld = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3(), sunDir = new THREE.Vector3(0, 1, 0);
  const params = {rays: 0, rayColor: new THREE.Color(1, .9, .7), bloom: .45, bloomThreshold: 1};

  function resize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.floor(size.x)), h = Math.max(1, Math.floor(size.y));
    if (w === stats.w && h === stats.h) return;
    stats.w = w; stats.h = h;
    sceneRT.setSize(w, h); raysRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); bloom.setSize(w, h);
  }
  function render(scene, camera) {
    if (renderer.xr.isPresenting) { renderer.render(scene, camera); return; }
    resize(); stats.frames++;
    const prior = renderer.getRenderTarget();
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera); stats.sceneCalls = renderer.info.render.calls;
    // Sun position on screen; shafts fade as the sun leaves the view.
    camera.getWorldPosition(camPos); camera.getWorldDirection(camDir);
    sunWorld.copy(camPos).addScaledVector(sunDir, 120).project(camera);
    const facing = THREE.MathUtils.smoothstep(camDir.dot(sunDir), .05, .45), edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunWorld.x), Math.abs(sunWorld.y)), 1.1, 1.9);
    const strength = params.rays * facing * edge; stats.rays = +strength.toFixed(3);
    rays.uniforms.strength.value = strength;
    if (strength > .001) {
      rays.uniforms.tDepth.value = depth; rays.uniforms.sunUv.value.set(sunWorld.x * .5 + .5, sunWorld.y * .5 + .5);
      rays.uniforms.aspect.value = size.x / Math.max(1, size.y); rays.uniforms.jitter.value = (stats.frames % 64) * .37;
      renderer.setRenderTarget(raysRT); raysQuad.render(renderer);
    }
    bloom.strength = params.bloom; bloom.threshold = params.bloomThreshold; stats.bloom = +params.bloom.toFixed(3);
    if (params.bloom > .01) bloom.render(renderer, null, sceneRT, 0, false);
    final.uniforms.tScene.value = sceneRT.texture; final.uniforms.tRays.value = raysRT.texture;
    final.uniforms.rayColor.value.copy(params.rayColor).multiplyScalar(strength > .001 ? 1 : 0);
    final.uniforms.time.value = (stats.frames % 997) * .013;
    renderer.setRenderTarget(prior); finalQuad.render(renderer);
  }
  // Compile the scene against the SAME HDR target used during play. Compiling
  // only against the default framebuffer misses the no-tone-mapping variants.
  async function prepare(scene,camera,prepareWorld) {
    const prior=renderer.getRenderTarget();
    const geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,final),stage=new THREE.Scene();stage.add(quad);
    const eye=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    try {
      renderer.setRenderTarget(sceneRT);
      if(prepareWorld)await prepareWorld();else await renderer.compileAsync(scene,camera);
      for(const material of [highPass,...bloom.separableBlurMaterials,bloom.compositeMaterial,bloom.materialCopy,rays]) {
        if(!material)continue;quad.material=material;await renderer.compileAsync(stage,eye);
      }
      renderer.setRenderTarget(prior);quad.material=final;await renderer.compileAsync(stage,eye);
    } finally {renderer.setRenderTarget(prior);geometry.dispose();}
  }
  // Day/night drives these: sun direction, shaft strength and colour, glow, and the grade.
  function set({sun, rays: r, rayColor, bloom: b, bloomThreshold, vignette, lift, gain, saturation, contrast} = {}) {
    if (sun) sunDir.copy(sun).normalize();
    if (r !== undefined) params.rays = r; if (rayColor) params.rayColor.copy(rayColor);
    if (b !== undefined) params.bloom = b; if (bloomThreshold !== undefined) params.bloomThreshold = bloomThreshold;
    const u = final.uniforms;
    if (vignette !== undefined) u.vignette.value = vignette; if (lift) u.lift.value.copy(lift); if (gain) u.gain.value.copy(gain);
    if (saturation !== undefined) u.saturation.value = saturation; if (contrast !== undefined) u.contrast.value = contrast;
  }
  return {
    render, set, prepare, stats: () => ({...stats}),
    dispose() { sceneRT.dispose(); raysRT.dispose(); depth.dispose(); bloom.dispose(); rays.dispose(); final.dispose(); raysQuad.dispose(); finalQuad.dispose(); },
  };
}
