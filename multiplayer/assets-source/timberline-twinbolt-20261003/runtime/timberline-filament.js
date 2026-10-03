// Timberline cutting filament: a dynamic, gameplay-driven cord.
// Gameplay supplies both endpoints and a tension; nothing is baked into a
// mesh. One small tube (segments x sides vertices) is rewritten in place
// each update, so there is no per-frame allocation.
//
//   const f = new TimberlineFilament();
//   scene.add(f.object);
//   f.setEndpoints(eyeL, eyeR);  // Vector3s in the filament's parent space
//   f.setTension(0..1.3);        // 0 slack (sags), 1 taut, >1 strained
//   f.setVia(hornPoint | null);  // drape over the loaded rest
//   f.setBow(point, depth, dir); // impact bow (depth 0 clears it)
//   f.pluck(amount);             // standing-wave twang when it snaps taut
//   f.update(dt, camera, viewportHeightPx);
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _p = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function createFilamentMaterial() {
  return new THREE.MeshStandardMaterial({
    name: 'TL_Filament', color: 0xd9e3ee, metalness: 1, roughness: 0.22,
    emissive: 0x8fa6bd, emissiveIntensity: 0,
  });
}

export class TimberlineFilament {
  constructor({segments = 28, sides = 5, radius = 0.0032, minPixelRadius = 0.75, material = null, length = 1.12} = {}) {
    this.segments = segments;
    this.sides = sides;
    this.radius = radius;
    this.minPixelRadius = minPixelRadius;
    this.length = length;           // physical eye-to-eye length (m)
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3(1, 0, 0);
    this.via = null;
    this.tension = 1;
    this.sagDir = new THREE.Vector3(0, -1, 0);
    this.bowPoint = null;
    this.bowDepth = 0;
    this.bowDir = new THREE.Vector3(0, 0, 1);
    this.pluckAmp = 0;
    this.pluckPhase = 0;
    this.glint = 0;
    this.points = Array.from({length: segments + 1}, () => new THREE.Vector3());
    const verts = (segments + 1) * sides;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(verts * 3);
    this.nrm = new Float32Array(verts * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < sides; j++) {
        const k = (j + 1) % sides;
        const a0 = i * sides + j, a1 = i * sides + k, b0 = (i + 1) * sides + j, b1 = (i + 1) * sides + k;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    geo.setIndex(idx);
    this.material = material || createFilamentMaterial();
    this.object = new THREE.Mesh(geo, this.material);
    this.object.name = 'TimberlineFilament';
    this.object.frustumCulled = false;   // bounds change every frame
    this.object.castShadow = false;
  }

  setEndpoints(a, b) { this.a.copy(a); this.b.copy(b); return this; }
  setTension(t) { this.tension = t; return this; }
  setLength(m) { this.length = m; return this; }
  setVia(p) { this.via = p ? (this.via || new THREE.Vector3()).copy(p) : null; return this; }
  setSagDirection(d) { this.sagDir.copy(d).normalize(); return this; }
  setBow(point, depth = 0, dir = null) {
    if (!point || depth <= 0) { this.bowPoint = null; this.bowDepth = 0; return this; }
    this.bowPoint = (this.bowPoint || new THREE.Vector3()).copy(point);
    this.bowDepth = depth;
    if (dir) this.bowDir.copy(dir).normalize();
    return this;
  }
  pluck(amount = 1) { this.pluckAmp = Math.max(this.pluckAmp, amount); this.pluckPhase = 0; return this; }

  _layout(dt) {
    const n = this.segments;
    const pts = this.points;
    this.pluckPhase += dt;
    this.pluckAmp *= Math.exp(-dt / 0.12);
    if (this.via) {
      // Draped over the horn: two shallow spans meeting at the rest point.
      const half = Math.floor(n / 2);
      for (let i = 0; i <= n; i++) {
        const onA = i <= half;
        const s = onA ? i / half : (i - half) / (n - half);
        const from = onA ? this.a : this.via, to = onA ? this.via : this.b;
        pts[i].lerpVectors(from, to, s);
        const span = from.distanceTo(to);
        pts[i].addScaledVector(_up, -0.012 * span * 4 * s * (1 - s));
      }
      return;
    }
    const chord = this.a.distanceTo(this.b);
    const slack = Math.max(0, this.length - chord);
    // Parabolic sag from real slack, plus a tension-driven droop when gameplay says slack.
    const geoSag = Math.sqrt(Math.max(0, 0.375 * chord * slack));
    const tSag = Math.max(0, 1 - this.tension) * chord * 0.16;
    const sag = Math.max(geoSag, tSag);
    let sc = 0.5;
    if (this.bowPoint && chord > 1e-4) {
      _t.subVectors(this.b, this.a);
      sc = THREE.MathUtils.clamp(_p.subVectors(this.bowPoint, this.a).dot(_t) / (chord * chord), 0.05, 0.95);
    }
    const pl = this.pluckAmp * 0.03 * Math.sin(this.pluckPhase * 2 * Math.PI * 22);
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      pts[i].lerpVectors(this.a, this.b, s);
      pts[i].addScaledVector(this.sagDir, sag * 4 * s * (1 - s));
      if (this.bowDepth > 0) {
        // A cord pushed at one point forms a V; round the apex a little.
        const tri = s < sc ? s / sc : (1 - s) / (1 - sc);
        pts[i].addScaledVector(this.bowDir, this.bowDepth * Math.pow(tri, 1.15));
      }
      if (pl) pts[i].addScaledVector(_up, pl * Math.sin(Math.PI * s));
    }
  }

  update(dt = 0, camera = null, viewportHeight = 1080) {
    this._layout(dt);
    const n = this.segments, sides = this.sides, pts = this.points;
    let pixelScale = 0;
    if (camera) {
      camera.getWorldPosition(_cam);
      this.object.parent?.worldToLocal?.(_cam);
      const fov = camera.isPerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : 0;
      pixelScale = fov ? (2 * Math.tan(fov / 2)) / viewportHeight : 0;
    }
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      if (i < n) _t.subVectors(pts[i + 1], p); else _t.subVectors(p, pts[i - 1]);
      _t.normalize();
      _n.copy(Math.abs(_t.y) < 0.9 ? _up : _bn.set(1, 0, 0)).cross(_t).normalize();
      _bn.crossVectors(_t, _n);
      let r = this.radius;
      if (pixelScale) r = Math.max(r, this.minPixelRadius * pixelScale * p.distanceTo(_cam));
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2;
        const c = Math.cos(ang), s = Math.sin(ang);
        const k = (i * sides + j) * 3;
        const nx = _n.x * c + _bn.x * s, ny = _n.y * c + _bn.y * s, nz = _n.z * c + _bn.z * s;
        this.pos[k] = p.x + nx * r; this.pos[k + 1] = p.y + ny * r; this.pos[k + 2] = p.z + nz * r;
        this.nrm[k] = nx; this.nrm[k + 1] = ny; this.nrm[k + 2] = nz;
      }
    }
    const g = this.object.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    // A restrained glint when strained so the line reads against foliage.
    const target = THREE.MathUtils.clamp((this.tension - 0.7) * 0.9, 0, 0.35) + this.pluckAmp * 0.25;
    this.glint += (target - this.glint) * Math.min(1, dt * 20 || 1);
    this.material.emissiveIntensity = this.glint;
    return this;
  }

  dispose() { this.object.geometry.dispose(); this.material.dispose(); }
}
