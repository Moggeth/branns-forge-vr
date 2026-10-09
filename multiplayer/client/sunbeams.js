// Sunbeams through the trees: soft slanted shafts falling from each nearby crown toward the ground, aligned with the
// sun (or the moon), with drifting dust in them. One instanced draw on every device, including headsets, because the
// beams are geometry (camera-facing around their own axis) rather than a screen effect.
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
    vertexShader: `attribute vec3 aOrigin, aShape; uniform vec3 uAxis; varying vec2 vUv; varying float vSeed, vFade;
      void main(){
        vec3 axis = normalize(uAxis), toCam = normalize(cameraPosition - aOrigin);
        vec3 side = cross(axis, toCam); float s = length(side); side = s > 1e-3 ? side / s : vec3(1.0, 0.0, 0.0);
        float t = -position.y; float w = aShape.y * (0.55 + 0.45 * t); // beams widen as they fall
        vec3 p = aOrigin + axis * (t * aShape.x) + side * position.x * w;
        vUv = vec2(uv.x, t); vSeed = aShape.z;
        float d = distance(cameraPosition, p);
        vFade = smoothstep(1.5, 6.0, d) * (1.0 - smoothstep(30.0, 48.0, d)) * smoothstep(0.08, 0.45, s); // never edge-on or in your face
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength, uTime; varying vec2 vUv; varying float vSeed, vFade;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float x = (vUv.x - 0.5) * 2.0; float across = exp(-x * x * 2.2) * (1.0 - x * x); // soft core, no hard rim
        float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
        float streak = 0.7 + 0.3 * n(vec2(vUv.x * 5.0 + vSeed * 31.0, vUv.y * 1.5 - uTime * 0.05));
        float dust = smoothstep(0.93, 0.99, n(vec2(vUv.x * 40.0 + vSeed * 9.0, vUv.y * 60.0 + uTime * 0.6 + vSeed * 13.0))) * 1.6;
        float flicker = 0.75 + 0.25 * sin(uTime * 0.35 + vSeed * 40.0); // leaves moving over the gap
        float a = across * along * vFade * flicker * (streak + dust) * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
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
        const len = Math.min(9, (crownY - height(x, z) + .2) / slope);
        origin.set([x, crownY - hash(id, k * 3 + 3) * h * .15, z], n * 3); shape.set([len, .7 + .8 * hash(id, k + 11), hash(id, k + 17)], n * 3); n++;
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
      material.uniforms.uStrength.value = strength * tierScale; material.uniforms.uTime.value = time; if (color) material.uniforms.uColor.value.copy(color);
      mesh.visible = strength * tierScale > .005 && trees.length > 0;
      if (!mesh.visible) return;
      // Shafts read as light falling through the leaves, so they always come down steeply under the crown. A low sun
      // keeps its compass direction but never lays the beams flat across the meadow.
      axis.copy(light).negate().normalize();
      const flat = Math.hypot(axis.x, axis.z), drop = Math.max(-axis.y, flat * STEEP);
      if (flat > 1e-4) axis.set(axis.x, -drop, axis.z).normalize(); else axis.set(0, -1, 0);
      material.uniforms.uAxis.value.copy(axis);
      camera.getWorldPosition(cam);
      const key = `${axis.x.toFixed(2)},${axis.y.toFixed(2)},${axis.z.toFixed(2)}`;
      if (time - lastBuild > .6 || key !== axisKey) { lastBuild = time; axisKey = key; rebuild(); }
    },
    stats: () => ({beams: mesh.visible ? built : 0, trees: trees.length, strength: +material.uniforms.uStrength.value.toFixed(3)}),
    dispose() { scene.remove(mesh); geometry.dispose(); base.dispose(); material.dispose(); },
  };
}
