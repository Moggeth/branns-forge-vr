// Sunbeams through the trees: soft slanted shafts falling from each nearby crown toward the ground, aligned with the
// sun (or the moon), with drifting dust in them. One instanced draw on every device, including headsets, because the
// beams are geometry (camera-facing around their own axis) rather than a screen effect.
// v2 look: a shaft is a loose bundle of leaf-gap rays inside a wide, very soft envelope, not a solid bar. Colour is
// pulled toward warm cream (never saturated gold), intensity follows a forward-scatter phase (brighter when you look
// toward the light, faint from the side), and every edge (sides, crown, ground, camera, distance) feathers out.
// Fill cost: instances that are fully faded (too close/far, edge-on) collapse to a degenerate point in the vertex
// shader, so they rasterise nothing; the dust term is cheap and the fragment work is bounded to two value noises.
import * as THREE from 'three';

const STEEP = Math.tan(62 * Math.PI / 180); // beams fall at least 62 degrees below the horizon
const hash = (s, n) => { let h = 2166136261 ^ n; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };

export function createSunbeams({scene, height, quality = 'high'}) {
  const tierScale = quality === 'low' ? .65 : 1; // no tone-mapped post on phones, so keep the additive glow gentler
  const perTree = quality === 'low' ? 2 : 3, maxTrees = quality === 'low' ? 14 : 26, max = perTree * maxTrees;
  const base = new THREE.PlaneGeometry(1, 1, 1, 6); base.translate(0, -.5, 0); // y: 0 at the crown .. -1 at the ground
  const geometry = new THREE.InstancedBufferGeometry(); geometry.index = base.index;
  geometry.setAttribute('position', base.attributes.position); geometry.setAttribute('uv', base.attributes.uv);
  const origin = new Float32Array(max * 3), shape = new Float32Array(max * 3); // shape: length, width, seed
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3)); geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 3));
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: {uAxis: {value: new THREE.Vector3(0, -1, 0)}, uColor: {value: new THREE.Color(1, .85, .6)}, uStrength: {value: 0}, uTime: {value: 0}},
    vertexShader: /* glsl */`attribute vec3 aOrigin, aShape; uniform vec3 uAxis; varying vec2 vUv; varying float vSeed, vFade;
      void main(){
        vec3 axis = uAxis / max(length(uAxis), 1e-4); // the CPU always sends a unit vector; guard anyway
        vec3 toCamRaw = cameraPosition - aOrigin; float camD = length(toCamRaw);
        vec3 toCam = toCamRaw / max(camD, 1e-3);
        vec3 side = cross(axis, toCam); float s = length(side); side = s > 1e-3 ? side / s : vec3(1.0, 0.0, 0.0);
        // Whole-instance visibility: distance band and edge-on. Fully faded beams collapse and cost no fill.
        float inst = smoothstep(1.0, 5.0, camD) * (1.0 - smoothstep(30.0, 46.0, camD)) * smoothstep(0.1, 0.5, s);
        if (inst < 0.002) { vUv = vec2(0.0); vSeed = 0.0; vFade = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // outside the clip volume
        float t = -position.y; float w = aShape.y * (0.6 + 0.6 * t); // beams widen as they fall
        vec3 p = aOrigin + axis * (t * aShape.x) + side * position.x * w;
        vUv = vec2(uv.x, t); vSeed = aShape.z;
        float d = distance(cameraPosition, p);
        // Forward scatter: shafts glow when you look up toward the light through them and thin out from the side.
        vec3 view = (p - cameraPosition) / max(d, 1e-3);
        float phase = 0.4 + 0.6 * smoothstep(-0.2, 0.85, dot(view, -axis));
        vFade = inst * smoothstep(1.5, 6.0, d) * (1.0 - smoothstep(30.0, 48.0, d)) * phase; // never in your face
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uStrength, uTime; varying vec2 vUv; varying float vSeed, vFade;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        if (vFade < 0.002) discard;
        float x = (vUv.x - 0.5) * 2.0;
        float envelope = exp(-x * x * 1.6) * (1.0 - x * x); // wide, rim-free; reaches 0 exactly at the quad edges
        // Leaf-gap rays: a few soft streaks across the envelope that sway slowly (leaves moving over the gaps). They
        // stretch along the beam, so the shaft reads as a bundle of light rather than one hard golden bar.
        float sway = sin(uTime * 0.31 + vSeed * 37.0) * 0.35;
        float rays = n(vec2(x * 2.6 + sway + vSeed * 29.0, vUv.y * 0.9 - uTime * 0.03));
        rays = 0.35 + 0.65 * smoothstep(0.25, 0.85, rays);
        // Brightest just under the crown, dissolving long before the ground so there is no hard foot.
        float along = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        float dust = smoothstep(0.94, 0.99, n(vec2(vUv.x * 36.0 + vSeed * 9.0, vUv.y * 54.0 + uTime * 0.5 + vSeed * 13.0))) * 1.2;
        float breathe = 0.8 + 0.2 * sin(uTime * 0.35 + vSeed * 40.0);
        float a = envelope * along * vFade * breathe * (rays + dust * envelope) * uStrength;
        // Cream, not gold: keep 55% of the caller's hue, the rest luminance (Rec.709), so a warm sun reads as soft light.
        vec3 c = mix(vec3(dot(uColor, vec3(0.2126, 0.7152, 0.0722))), uColor, 0.55);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'sunbeams'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = 15;
  scene.add(mesh);
  let trees = [], lastBuild = -1e9, built = 0, axisKey = '';
  const cam = new THREE.Vector3(), axis = new THREE.Vector3(0, -1, 0);

  function rebuild() {
    const near = trees.map(t => [t, (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2]).filter(([, d]) => d < 46 * 46).sort((a, b) => a[1] - b[1]).slice(0, maxTrees);
    let n = 0; const slope = Math.max(.6, -axis.y);
    for (const [t] of near) {
      const ground = height(t.x, t.z), h = Math.max(3, t.height || 6), crownY = ground + h * .62, r = .7 + h * .12, id = t.id || `${t.x},${t.z}`;
      for (let k = 0; k < perTree; k++) {
        const a = hash(id, k * 3 + 1) * Math.PI * 2, q = r * (.25 + .7 * hash(id, k * 3 + 2));
        const x = t.x + Math.cos(a) * q, z = t.z + Math.sin(a) * q;
        const len = Math.max(.5, Math.min(9, (crownY - height(x, z) + .2) / slope));
        // Wider than v1 (1.1..2.3 m) but the envelope is softer, so total light per beam stays about the same.
        origin.set([x, crownY - hash(id, k * 3 + 3) * h * .15, z], n * 3); shape.set([len, 1.1 + 1.2 * hash(id, k + 11), hash(id, k + 17)], n * 3); n++;
      }
    }
    geometry.instanceCount = built = n;
    geometry.attributes.aOrigin.needsUpdate = true; geometry.attributes.aShape.needsUpdate = true;
  }

  return {
    mesh,
    setTrees(list) { const next = Array.isArray(list) ? list : []; if (next !== trees) { trees = next; lastBuild = -1e9; } },
    // light: unit vector pointing from the scene toward the sun/moon.
    update({camera, light, strength = 0, color, time = 0}) {
      material.uniforms.uStrength.value = strength * tierScale; material.uniforms.uTime.value = time % 3600; if (color) material.uniforms.uColor.value.copy(color);
      mesh.visible = strength * tierScale > .005 && trees.length > 0;
      if (!mesh.visible) return;
      // Shafts read as light falling through the leaves, so they always come down steeply under the crown. A low sun
      // keeps its compass direction but never lays the beams flat across the meadow.
      if (light && Math.hypot(light.x, light.y, light.z) > 1e-4) axis.copy(light).negate().normalize(); else axis.set(0, -1, 0);
      const flat = Math.hypot(axis.x, axis.z), drop = Math.max(-axis.y, flat * STEEP);
      if (flat > 1e-4) axis.set(axis.x, -drop, axis.z).normalize(); else axis.set(0, -1, 0);
      material.uniforms.uAxis.value.copy(axis);
      camera.getWorldPosition(cam);
      const key = `${axis.x.toFixed(2)},${axis.y.toFixed(2)},${axis.z.toFixed(2)}`;
      if (time - lastBuild > .6 || time < lastBuild || key !== axisKey) { lastBuild = time; axisKey = key; rebuild(); }
    },
    stats: () => ({beams: mesh.visible ? built : 0, trees: trees.length, strength: +material.uniforms.uStrength.value.toFixed(3)}),
    dispose() { scene.remove(mesh); geometry.dispose(); base.dispose(); material.dispose(); },
  };
}
