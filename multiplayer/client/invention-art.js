// Procedural invention art for Brann's Forge. +Y up, -Z forward, metres, base at y=0.
// Only dependency: three. Materials and geometries are shared across every model.
import * as THREE from 'three';

let M = null;
let G = null;

function shared() {
  if (M) return;
  const std = (color, roughness, metalness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  M = {
    timber: std(0x9a6434, 0.82, 0.0),
    timberDark: std(0x5e3b1e, 0.88, 0.0),
    plank: std(0xb98049, 0.78, 0.0),
    iron: std(0x26262a, 0.55, 0.85),
    brass: std(0xc9993f, 0.35, 0.95),
    stone: std(0x8d887e, 0.95, 0.0),
    stoneDark: std(0x5f5b55, 0.95, 0.0),
    rope: std(0xc8b07a, 0.95, 0.0),
    ember: std(0x2a0d04, 0.6, 0.0, { emissive: 0xff5a14, emissiveIntensity: 1.6 }),
    crystal: std(0x7ff6ff, 0.12, 0.1, { emissive: 0x19c8e6, emissiveIntensity: 1.25 }),
    filament: new THREE.MeshBasicMaterial({ color: 0x9ffcff, transparent: true, opacity: 0.8, depthWrite: false }),
    water: std(0x3fb8c8, 0.08, 0.2, { emissive: 0x0b5560, emissiveIntensity: 0.6 }),
  };
  G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cone: new THREE.ConeGeometry(0.5, 1, 8),
    crystal: new THREE.OctahedronGeometry(0.5, 0),
    torus: new THREE.TorusGeometry(0.5, 0.06, 6, 20),
    sphere: new THREE.IcosahedronGeometry(0.5, 1),
    wedge: (() => { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 3); g.rotateZ(Math.PI / 2); return g; })(),
    frustum: new THREE.CylinderGeometry(0.38, 0.5, 1, 8),
  };
}

// Add a scaled/positioned mesh of a shared geometry. r = [rx, ry, rz].
function part(parent, geo, mat, s, p, r) {
  const m = new THREE.Mesh(G[geo], M[mat]);
  m.scale.set(s[0], s[1], s[2]);
  m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function group(parent, p = [0, 0, 0], name) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  if (name) g.name = name;
  parent.add(g);
  return g;
}
// Beam between two points (box section w x h).
function beam(parent, mat, a, b, w = 0.1, h = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(G.box, M[mat]);
  m.scale.set(w, h, len);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.lookAt(B.x + (m.parent ? 0 : 0), B.y, B.z);
  m.position.set(0, 0, 0);
  parent.add(m);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  m.quaternion.copy(q);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- models
const BUILDERS = {
  storehouse(root, P) {
    part(root, 'box', 'stoneDark', [3.4, 0.12, 2.8], [0, 0.06, 0]);
    for (const [x, z] of [[-1.6, -1.3], [1.6, -1.3], [-1.6, 1.3], [1.6, 1.3]]) part(root, 'box', 'timberDark', [0.16, 2.3, 0.16], [x, 1.27, z]);
    part(root, 'box', 'timber', [3.5, 0.14, 0.18], [0, 2.4, -1.3]);
    part(root, 'box', 'timber', [3.5, 0.14, 0.18], [0, 2.4, 1.3]);
    part(root, 'box', 'plank', [3.8, 0.08, 1.7], [0, 2.75, -0.7], [0.45, 0, 0]);
    part(root, 'box', 'plank', [3.8, 0.08, 1.7], [0, 2.75, 0.7], [-0.45, 0, 0]);
    part(root, 'box', 'timberDark', [3.9, 0.14, 0.14], [0, 3.08, 0]);
    // stacked crates with iron straps
    const crates = [[-0.9, 0.42, -0.3, 0.6], [-0.25, 0.42, -0.45, 0.6], [-0.6, 0.98, -0.35, 0.5], [0.8, 0.38, 0.2, 0.52], [0.85, 0.85, 0.15, 0.42]];
    for (const [x, y, z, s] of crates) {
      part(root, 'box', 'plank', [s, s * 0.9, s], [x, y + 0.0, z], [0, x * 0.3, 0]);
      part(root, 'box', 'iron', [s * 1.03, s * 0.12, s * 1.03], [x, y, z], [0, x * 0.3, 0]);
    }
    // barrels and a sack-y ore pile
    part(root, 'frustum', 'timber', [0.5, 0.75, 0.5], [0.3, 0.5, -0.8]);
    part(root, 'torus', 'iron', [0.5, 0.5, 0.5], [0.3, 0.6, -0.8], [Math.PI / 2, 0, 0]);
    part(root, 'frustum', 'timber', [0.45, 0.7, 0.45], [1.15, 0.47, -0.7]);
    part(root, 'sphere', 'rope', [0.55, 0.4, 0.5], [-0.9, 0.3, 0.8]);
    part(root, 'sphere', 'rope', [0.45, 0.35, 0.42], [-0.45, 0.27, 0.9]);
    P.lantern = part(root, 'crystal', 'crystal', [0.12, 0.2, 0.12], [1.6, 2.15, -1.3]);
  },

  loggingYard(root, P) {
    part(root, 'box', 'stoneDark', [3.6, 0.1, 1.6], [0, 0.05, 0]);
    for (const x of [-1.4, -0.5, 0.5, 1.4]) for (const z of [-0.55, 0.55]) part(root, 'box', 'timberDark', [0.14, 0.8, 0.14], [x, 0.5, z]);
    part(root, 'box', 'timber', [3.2, 0.12, 1.2], [0, 0.95, 0]);
    // conveyor rollers
    P.rollers = [];
    for (let i = 0; i < 5; i++) P.rollers.push(part(root, 'cyl', 'iron', [0.12, 1.1, 0.12], [-1.3 + i * 0.6, 1.06, 0], [Math.PI / 2, 0, 0]));
    P.log = part(root, 'cyl', 'timber', [0.36, 2.2, 0.36], [0, 1.3, 0], [0, 0, Math.PI / 2]);
    // circular saw on spindle
    P.saw = group(root, [0.6, 1.2, 0]);
    part(P.saw, 'cyl', 'iron', [0.95, 0.03, 0.95], [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(P.saw, 'cyl6', 'brass', [0.2, 0.08, 0.2], [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(root, 'box', 'iron', [0.12, 0.3, 0.12], [0.6, 1.0, -0.22]);
    // flywheel drive beside
    P.fly = group(root, [-0.4, 1.0, -1.25]);
    part(P.fly, 'torus', 'iron', [1.5, 1.5, 2.0], [0, 0, 0]);
    for (let i = 0; i < 3; i++) part(P.fly, 'box', 'timberDark', [1.4, 0.07, 0.05], [0, 0, 0], [0, 0, (i * Math.PI) / 3]);
    part(P.fly, 'cyl', 'brass', [0.18, 0.2, 0.18], [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(root, 'box', 'timberDark', [0.14, 1.0, 0.14], [-0.4, 0.5, -1.25]);
    part(root, 'box', 'rope', [1.0, 0.03, 0.03], [0.1, 1.1, -0.75], [0, 0.9, 0]);
    // log pile
    for (let i = 0; i < 3; i++) part(root, 'cyl', 'timber', [0.3, 1.6, 0.3], [-0.3 + i * 0.32, 0.17, 1.35], [0, 0, Math.PI / 2]);
    part(root, 'cyl', 'timber', [0.3, 1.6, 0.3], [-0.14, 0.45, 1.35], [0, 0, Math.PI / 2]);
  },

  prospector(root, P) {
    part(root, 'box', 'stoneDark', [2.8, 0.08, 2.0], [0, 0.04, 0]);
    // surveying desk
    for (const [x, z] of [[-1.1, -0.6], [-0.2, -0.6], [-1.1, 0.0], [-0.2, 0.0]]) part(root, 'box', 'timberDark', [0.08, 0.85, 0.08], [x, 0.45, z]);
    part(root, 'box', 'plank', [1.1, 0.07, 0.8], [-0.65, 0.9, -0.3], [-0.12, 0, 0]);
    part(root, 'box', 'rope', [0.6, 0.01, 0.45], [-0.7, 0.95, -0.3], [-0.12, 0, 0.08]);
    part(root, 'cyl', 'brass', [0.06, 0.4, 0.06], [-0.35, 1.1, -0.45], [0.3, 0, -0.9]);
    // tripod theodolite
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; beam(root, 'timber', [0.9 + Math.cos(a) * 0.35, 0, -0.7 + Math.sin(a) * 0.35], [0.9, 1.25, -0.7], 0.04); }
    P.scope = group(root, [0.9, 1.3, -0.7]);
    part(P.scope, 'cyl', 'brass', [0.09, 0.45, 0.09], [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(P.scope, 'cyl', 'iron', [0.13, 0.05, 0.13], [0, 0, -0.22], [Math.PI / 2, 0, 0]);
    // ore bench with sorted crystals
    part(root, 'box', 'timber', [1.6, 0.1, 0.6], [0.3, 0.7, 0.55]);
    part(root, 'box', 'timberDark', [0.1, 0.65, 0.5], [-0.4, 0.33, 0.55]);
    part(root, 'box', 'timberDark', [0.1, 0.65, 0.5], [1.0, 0.33, 0.55]);
    part(root, 'sphere', 'stoneDark', [0.3, 0.22, 0.28], [-0.1, 0.84, 0.55]);
    part(root, 'sphere', 'iron', [0.22, 0.18, 0.2], [0.3, 0.82, 0.5]);
    P.gem = part(root, 'crystal', 'crystal', [0.12, 0.24, 0.12], [0.7, 0.88, 0.55]);
    part(root, 'box', 'iron', [0.3, 0.12, 0.2], [0.75, 0.81, 0.4]);
    part(root, 'cyl', 'iron', [0.04, 0.6, 0.04], [1.2, 0.3, 0.9], [0.3, 0, 0.2]);
    part(root, 'box', 'iron', [0.22, 0.06, 0.08], [1.25, 0.6, 0.98], [0.3, 0, 0.2]);
  },

  sanctuary(root, P) {
    part(root, 'cyl', 'stoneDark', [4.0, 0.15, 4.0], [0, 0.075, 0]);
    part(root, 'cyl', 'stone', [3.4, 0.15, 3.4], [0, 0.22, 0]);
    // basin
    part(root, 'frustum', 'stone', [1.4, 0.55, 1.4], [0, 0.57, 0], [Math.PI, 0, 0]);
    P.water = part(root, 'cyl', 'water', [1.15, 0.04, 1.15], [0, 0.82, 0]);
    part(root, 'torus', 'brass', [1.42, 1.42, 1.0], [0, 0.85, 0], [Math.PI / 2, 0, 0]);
    P.crystal = part(root, 'crystal', 'crystal', [0.25, 0.5, 0.25], [0, 1.25, 0]);
    // ring of columns with lintels
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 1.6, z = Math.sin(a) * 1.6;
      part(root, 'cyl6', 'stone', [0.3, 2.2, 0.3], [x, 1.4, z]);
      part(root, 'box', 'stoneDark', [0.42, 0.14, 0.42], [x, 2.55, z]);
      const b = ((i + 0.5) / 6) * Math.PI * 2;
      part(root, 'box', 'stone', [1.7, 0.16, 0.26], [Math.cos(b) * 1.39, 2.68, Math.sin(b) * 1.39], [0, -b + Math.PI / 2, 0]);
    }
  },

  barracks(root, P) {
    part(root, 'box', 'stoneDark', [3.4, 0.25, 2.6], [0, 0.125, 0]);
    part(root, 'box', 'plank', [3.0, 1.7, 2.2], [0, 1.1, 0]);
    for (const x of [-1.5, 1.5]) for (const z of [-1.1, 1.1]) part(root, 'box', 'timberDark', [0.2, 1.8, 0.2], [x, 1.15, z]);
    part(root, 'box', 'timberDark', [3.2, 0.14, 2.4], [0, 2.0, 0]);
    part(root, 'box', 'timber', [3.4, 0.09, 1.55], [0, 2.4, -0.62], [0.6, 0, 0]);
    part(root, 'box', 'timber', [3.4, 0.09, 1.55], [0, 2.4, 0.62], [-0.6, 0, 0]);
    part(root, 'wedge', 'plank', [0.1, 0.9, 2.0], [-1.5, 2.33, 0], [0, 0, 0]);
    part(root, 'wedge', 'plank', [0.1, 0.9, 2.0], [1.5, 2.33, 0], [0, 0, 0]);
    // door and shield
    part(root, 'box', 'timberDark', [0.8, 1.3, 0.06], [0, 0.9, -1.12]);
    part(root, 'box', 'iron', [0.85, 0.06, 0.08], [0, 1.2, -1.14]);
    part(root, 'cyl', 'brass', [0.55, 0.05, 0.55], [0, 1.75, -1.16], [Math.PI / 2, 0, 0]);
    // weapon rack: spears and axes
    part(root, 'box', 'timber', [1.6, 0.08, 0.08], [0.5, 0.9, -1.45]);
    for (let i = 0; i < 4; i++) {
      part(root, 'cyl', 'timberDark', [0.04, 1.6, 0.04], [-0.1 + i * 0.4, 0.82, -1.45], [-0.12, 0, 0]);
      part(root, 'cone', 'iron', [0.07, 0.22, 0.07], [-0.1 + i * 0.4, 1.7, -1.55]);
    }
    part(root, 'box', 'timber', [0.08, 0.95, 0.08], [-0.25, 0.47, -1.45]);
    part(root, 'box', 'timber', [0.08, 0.95, 0.08], [1.25, 0.47, -1.45]);
    P.banner = part(root, 'box', 'crystal', [0.04, 0.5, 0.3], [1.55, 2.0, -1.15]);
  },

  watchtower(root, P) {
    const H = 3, S = 1.15;
    for (const x of [-1, 1]) for (const z of [-1, 1]) part(root, 'box', 'timberDark', [0.18, H, 0.18], [x * (S - 0.12), H / 2, z * (S - 0.12)]);
    // cross bracing
    beam(root, 'timber', [-1.03, 0.2, -1.03], [1.03, 2.6, -1.03], 0.08);
    beam(root, 'timber', [1.03, 0.2, -1.03], [-1.03, 2.6, -1.03], 0.08);
    beam(root, 'timber', [-1.03, 0.2, -1.03], [-1.03, 2.6, 1.03], 0.08);
    beam(root, 'timber', [1.03, 0.2, -1.03], [1.03, 2.6, 1.03], 0.08);
    part(root, 'box', 'plank', [2 * S, 0.12, 2 * S], [0, H - 0.06, 0]);
    part(root, 'box', 'iron', [2 * S + 0.04, 0.06, 2 * S + 0.04], [0, H - 0.12, 0]);
    // railings: front/sides full; rear (+Z) leaves centre opening for ramp
    const rh = H + 0.95;
    for (const x of [-1, 1]) for (const z of [-1, 1]) part(root, 'box', 'timberDark', [0.1, 1.0, 0.1], [x * (S - 0.05), H + 0.5, z * (S - 0.05)]);
    part(root, 'box', 'timber', [2 * S, 0.08, 0.08], [0, rh, -(S - 0.05)]);
    part(root, 'box', 'timber', [0.08, 0.08, 2 * S], [-(S - 0.05), rh, 0]);
    part(root, 'box', 'timber', [0.08, 0.08, 2 * S], [S - 0.05, rh, 0]);
    part(root, 'box', 'timber', [0.6, 0.08, 0.08], [-0.85, rh, S - 0.05]);
    part(root, 'box', 'timber', [0.6, 0.08, 0.08], [0.85, rh, S - 0.05]);
    part(root, 'box', 'timber', [2 * S, 0.06, 0.06], [0, H + 0.5, -(S - 0.05)]);
    // ramp: x=0, from z=1.15 at y=3 down to z=5.2 at y=0
    const dz = 5.2 - 1.15, ang = Math.atan2(H, dz), len = Math.hypot(H, dz);
    part(root, 'box', 'plank', [1.0, 0.1, len], [0, H / 2 - 0.05, 1.15 + dz / 2], [ang, 0, 0]);
    for (const x of [-0.55, 0.55]) part(root, 'box', 'timberDark', [0.08, 0.16, len], [x, H / 2, 1.15 + dz / 2], [ang, 0, 0]);
    for (const t of [0.35, 0.65]) part(root, 'box', 'timberDark', [0.14, H * (1 - t), 0.14], [0, (H * (1 - t)) / 2, 1.15 + dz * t]);
    // signal brazier
    part(root, 'frustum', 'iron', [0.4, 0.25, 0.4], [0.7, H + 0.12, -0.7], [Math.PI, 0, 0]);
    P.flame = part(root, 'crystal', 'crystal', [0.2, 0.35, 0.2], [0.7, H + 0.4, -0.7]);
  },

  palisade(root, P) {
    // arc of sharpened stakes around a central gate on -Z
    const R = 2;
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + 0.45 + (i / 11) * (Math.PI * 2 - 0.9);
      const x = Math.cos(a) * R, z = Math.sin(a) * R, h = 1.7 + ((i * 37) % 5) * 0.06;
      part(root, 'cyl6', 'timber', [0.28, h, 0.28], [x, h / 2, z]);
    }
    part(root, 'torus', 'rope', [4.0, 4.0, 2.0], [0, 1.2, 0], [Math.PI / 2, 0, 0]);
    // gate frame
    for (const x of [-0.85, 0.85]) part(root, 'box', 'timberDark', [0.24, 2.4, 0.24], [x, 1.2, -R]);
    part(root, 'box', 'timberDark', [2.0, 0.22, 0.26], [0, 2.3, -R]);
    part(root, 'cyl', 'brass', [0.18, 0.06, 0.18], [0, 2.3, -R - 0.14], [Math.PI / 2, 0, 0]);
    P.doors = [];
    for (const side of [-1, 1]) {
      const hinge = group(root, [side * 0.73, 0, -R], 'gateLeaf');
      for (let k = 0; k < 3; k++) part(hinge, 'box', 'plank', [0.22, 1.9, 0.1], [-side * (0.13 + k * 0.24), 1.0, 0]);
      part(hinge, 'box', 'iron', [0.74, 0.08, 0.12], [-side * 0.37, 0.5, -0.02]);
      part(hinge, 'box', 'iron', [0.74, 0.08, 0.12], [-side * 0.37, 1.5, -0.02]);
      hinge.userData.side = side;
      P.doors.push(hinge);
    }
  },

  launcher(root, P) {
    part(root, 'box', 'timberDark', [0.18, 0.18, 2.6], [-0.6, 0.15, 0]);
    part(root, 'box', 'timberDark', [0.18, 0.18, 2.6], [0.6, 0.15, 0]);
    part(root, 'box', 'timberDark', [1.4, 0.16, 0.18], [0, 0.15, -1.1]);
    part(root, 'box', 'timberDark', [1.4, 0.16, 0.18], [0, 0.15, 1.1]);
    for (const x of [-0.6, 0.6]) {
      beam(root, 'timber', [x, 0.2, -0.8], [x, 1.3, 0], 0.14);
      beam(root, 'timber', [x, 0.2, 0.8], [x, 1.3, 0], 0.14);
      for (const z of [-1.1, 1.1]) part(root, 'cyl', 'iron', [0.4, 0.1, 0.4], [x + Math.sign(x) * 0.1, 0.22, z], [0, 0, Math.PI / 2]);
    }
    part(root, 'cyl', 'iron', [0.1, 1.4, 0.1], [0, 1.3, 0], [0, 0, Math.PI / 2]);
    // arm pivots at y=1.3; rest pose points back/down, fires toward -Z
    P.arm = group(root, [0, 1.3, 0]);
    part(P.arm, 'box', 'timber', [0.16, 0.16, 2.2], [0, 0, 0.5]);
    part(P.arm, 'box', 'iron', [0.2, 0.2, 0.08], [0, 0, 0.3]);
    part(P.arm, 'box', 'iron', [0.2, 0.2, 0.08], [0, 0, -0.2]);
    part(P.arm, 'box', 'stoneDark', [0.5, 0.45, 0.45], [0, -0.25, -0.5]);
    P.cup = group(P.arm, [0, 0.1, 1.55]);
    part(P.cup, 'frustum', 'iron', [0.36, 0.14, 0.36], [0, 0, 0], [Math.PI, 0, 0]);
    P.stone = part(P.cup, 'sphere', 'stone', [0.3, 0.3, 0.3], [0, 0.15, 0]);
    // winch
    P.winch = group(root, [0, 0.45, 1.0]);
    part(P.winch, 'cyl', 'timberDark', [0.22, 1.0, 0.22], [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const x of [-0.45, 0.45]) part(P.winch, 'torus', 'brass', [0.55, 0.55, 0.8], [x, 0, 0], [0, Math.PI / 2, 0]);
    part(root, 'box', 'stoneDark', [0.3, 0.3, 0.3], [0.9, 0.15, 0.7]);
    part(root, 'sphere', 'stone', [0.26, 0.26, 0.26], [0.9, 0.42, 0.7]);
  },

  ward(root, P) {
    part(root, 'cyl6', 'stoneDark', [2.4, 0.3, 2.4], [0, 0.15, 0]);
    part(root, 'frustum', 'stone', [1.2, 1.8, 1.2], [0, 1.2, 0]);
    part(root, 'cyl6', 'stoneDark', [1.25, 0.18, 1.25], [0, 2.18, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      beam(root, 'brass', [Math.cos(a) * 0.62, 2.2, Math.sin(a) * 0.62], [Math.cos(a) * 0.25, 3.1, Math.sin(a) * 0.25], 0.06);
      part(root, 'crystal', 'crystal', [0.14, 0.4, 0.14], [Math.cos(a) * 1.0, 0.45, Math.sin(a) * 1.0], [0, 0, 0.3]);
    }
    P.crystal = part(root, 'crystal', 'crystal', [0.45, 0.95, 0.45], [0, 2.9, 0]);
    P.ring = group(root, [0, 2.9, 0]);
    part(P.ring, 'torus', 'brass', [1.1, 1.1, 1.0], [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(P.ring, 'torus', 'iron', [0.8, 0.8, 1.0], [0, 0, 0], [0.5, 0, 0]);
  },

  trap(root, P) {
    part(root, 'cyl', 'iron', [1.4, 0.06, 1.4], [0, 0.03, 0]);
    part(root, 'cyl', 'brass', [0.35, 0.08, 0.35], [0, 0.08, 0]);
    part(root, 'box', 'iron', [0.1, 0.1, 1.6], [0, 0.07, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      part(root, 'cyl', 'iron', [0.12, 0.25, 0.12], [Math.cos(a) * 0.85, 0.05, Math.sin(a) * 0.85], [0, 0, 0]);
    }
    part(root, 'box', 'rope', [0.04, 0.04, 0.6], [0, 0.03, 1.05]);
    P.jaws = [];
    for (const side of [-1, 1]) {
      const j = group(root, [0, 0.1, 0], 'jaw');
      part(j, 'torus', 'iron', [1.1, 0.7, 1.1], [0, 0.35, 0], [0, Math.PI / 2, 0]);
      for (let k = 0; k < 6; k++) part(j, 'cone', 'iron', [0.07, 0.18, 0.07], [0, 0.7, -0.45 + k * 0.18]);
      j.userData.side = side;
      P.jaws.push(j);
    }
    P.trigger = part(root, 'crystal', 'crystal', [0.12, 0.08, 0.12], [0, 0.16, 0]);
  },

  influence(root, P) {
    part(root, 'cyl6', 'stoneDark', [2.4, 0.2, 2.4], [0, 0.1, 0]);
    part(root, 'cyl6', 'stone', [1.8, 0.2, 1.8], [0, 0.3, 0]);
    part(root, 'box', 'stone', [0.7, 2.4, 0.7], [0, 1.6, 0], [0, Math.PI / 4, 0]);
    part(root, 'cone', 'stone', [1.0, 0.5, 1.0], [0, 3.05, 0], [0, Math.PI / 4, 0]);
    for (const y of [0.9, 2.1]) part(root, 'box', 'brass', [0.74, 0.08, 0.74], [0, y, 0], [0, Math.PI / 4, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      part(root, 'crystal', 'crystal', [0.12, 0.3, 0.12], [Math.cos(a) * 0.36, 1.5, Math.sin(a) * 0.36]);
      part(root, 'box', 'stoneDark', [0.25, 0.4, 0.25], [Math.cos(a) * 1.05, 0.45, Math.sin(a) * 1.05]);
    }
    P.crystal = part(root, 'crystal', 'crystal', [0.4, 0.75, 0.4], [0, 3.7, 0]);
  },

  forgeRefinery(root, P) {
    // stone furnace chamber
    part(root, 'box', 'stoneDark', [1.4, 0.15, 1.4], [0, 0.075, 0]);
    part(root, 'frustum', 'stone', [1.1, 0.9, 1.1], [0, 0.6, 0]);
    part(root, 'box', 'iron', [0.45, 0.35, 0.1], [0, 0.45, -0.48]);
    P.glow = part(root, 'box', 'ember', [0.34, 0.24, 0.06], [0, 0.45, -0.52]);
    part(root, 'torus', 'iron', [1.0, 1.0, 1.0], [0, 0.95, 0], [Math.PI / 2, 0, 0]);
    // hopper lip at y=1.2
    part(root, 'frustum', 'iron', [0.85, 0.25, 0.85], [0, 1.075, 0], [Math.PI, 0, 0]);
    part(root, 'torus', 'brass', [0.86, 0.86, 1.0], [0, 1.2, 0], [Math.PI / 2, 0, 0]);
    part(root, 'cyl', 'iron', [0.14, 0.7, 0.14], [0.35, 1.3, 0.35]);
    // output chute and ingot tray
    beam(root, 'iron', [0.45, 0.5, -0.1], [0.95, 0.25, -0.1], 0.14, 0.06);
    part(root, 'box', 'timberDark', [0.5, 0.12, 0.5], [1.05, 0.12, -0.1]);
    P.ingots = [];
    for (let i = 0; i < 3; i++) P.ingots.push(part(root, 'box', 'brass', [0.12, 0.06, 0.28], [0.93 + i * 0.13, 0.21, -0.1]));
    // bellows
    part(root, 'box', 'timber', [0.35, 0.14, 0.5], [-0.75, 0.35, 0.1]);
    P.bellows = part(root, 'box', 'rope', [0.33, 0.12, 0.45], [-0.75, 0.45, 0.1]);
  },

  timberline(root, P) {
    // --- static base: stone plinth, iron race ring, timber outriggers
    part(root, 'cyl6', 'stoneDark', [2.4, 0.18, 2.4], [0, 0.09, 0]);
    part(root, 'cyl', 'stone', [1.9, 0.14, 1.9], [0, 0.25, 0]);
    part(root, 'torus', 'iron', [1.85, 1.85, 1.2], [0, 0.32, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(root, 'box', 'timberDark', [0.18, 0.16, 0.7], [Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0], [0, -a + Math.PI / 2, 0]);
      part(root, 'cyl', 'brass', [0.12, 0.06, 0.12], [Math.cos(a) * 1.25, 0.23, Math.sin(a) * 1.25]);
    }
    // --- swivel carriage (yaw)
    const yaw = (P.yaw = group(root, [0, 0.32, 0], 'yaw'));
    part(yaw, 'cyl', 'iron', [1.4, 0.1, 1.4], [0, 0.05, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(yaw, 'cyl6', 'brass', [0.07, 0.05, 0.07], [Math.cos(a) * 0.62, 0.11, Math.sin(a) * 0.62]);
    }
    for (const x of [-0.32, 0.32]) {
      part(yaw, 'box', 'timber', [0.12, 0.85, 0.9], [x, 0.52, 0.05]); // cheeks
      part(yaw, 'box', 'iron', [0.14, 0.08, 0.92], [x, 0.94, 0.05]);
      part(yaw, 'cyl', 'brass', [0.16, 0.16, 0.16], [x, 0.8, 0.05], [0, 0, Math.PI / 2]);
    }
    part(yaw, 'cyl', 'iron', [0.07, 0.82, 0.07], [0, 0.8, 0.05], [0, 0, Math.PI / 2]); // trunnion
    // elevation cradle at trunnion; launch line at world y=1.3 (0.32+0.98)
    const cradle = (P.cradle = group(yaw, [0, 0.98, 0.05], 'cradle'));
    // stock (fixed) with twin load rails
    part(cradle, 'box', 'timberDark', [0.36, 0.14, 1.9], [0, -0.14, 0.15]);
    for (const x of [-0.09, 0.09]) part(cradle, 'box', 'iron', [0.035, 0.035, 1.8], [x, -0.05, 0.15]);
    part(cradle, 'box', 'brass', [0.4, 0.06, 0.06], [0, -0.1, -0.78]);
    // bow prod: heavy limbs swept back, iron tipped
    const prod = (P.prod = group(cradle, [0, -0.04, -0.72], 'prod'));
    part(prod, 'box', 'iron', [0.3, 0.16, 0.16], [0, 0, 0]);
    P.limbs = [];
    for (const s of [-1, 1]) {
      const limb = group(prod, [s * 0.14, 0, 0]);
      part(limb, 'box', 'timber', [0.85, 0.09, 0.12], [s * 0.42, 0, 0.0]);
      part(limb, 'box', 'iron', [0.3, 0.1, 0.13], [s * 0.2, 0, 0]);
      part(limb, 'cyl6', 'brass', [0.07, 0.14, 0.07], [s * 0.86, 0, 0]);
      limb.userData.side = s;
      P.limbs.push(limb);
    }
    // bowstring (two segments meeting at the nock) as thin rope beams
    P.stringL = part(cradle, 'box', 'rope', [0.015, 0.015, 1], [0, 0, 0]);
    P.stringR = part(cradle, 'box', 'rope', [0.015, 0.015, 1], [0, 0, 0]);
    // recoil slider: nock block that runs back on rails and recovers
    const slider = (P.slider = group(cradle, [0, 0, 0], 'slider'));
    part(slider, 'box', 'iron', [0.3, 0.1, 0.16], [0, -0.02, -0.3]);
    part(slider, 'box', 'brass', [0.32, 0.03, 0.05], [0, 0.04, -0.36]);
    // twin bolts (group hidden after fire, reloaded by progress)
    const bolts = (P.bolts = group(cradle, [0, 0, 0], 'bolts'));
    for (const x of [-0.09, 0.09]) {
      part(bolts, 'cyl', 'timber', [0.035, 1.25, 0.035], [x, 0.03, -0.9], [Math.PI / 2, 0, 0]);
      part(bolts, 'cone', 'iron', [0.07, 0.2, 0.07], [x, 0.03, -1.62], [-Math.PI / 2, 0, 0]);
      part(bolts, 'box', 'brass', [0.004, 0.06, 0.14], [x, 0.06, -0.32]);
    }
    // cyan cutting filament linking the bolt tips
    P.filament = part(bolts, 'box', 'filament', [0.18, 0.012, 0.012], [0, 0.03, -1.66]);
    P.tipGlow = part(bolts, 'crystal', 'crystal', [0.05, 0.05, 0.05], [0, 0.03, -1.66]);
    // windlass at the rear with spokes
    const windlass = (P.windlass = group(cradle, [0, -0.12, 1.02], 'windlass'));
    part(windlass, 'cyl', 'timberDark', [0.12, 0.5, 0.12], [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const x of [-0.27, 0.27]) {
      part(windlass, 'torus', 'iron', [0.45, 0.45, 0.6], [x, 0, 0], [0, Math.PI / 2, 0]);
      part(windlass, 'box', 'timber', [0.04, 0.44, 0.04], [x, 0, 0]);
      part(windlass, 'box', 'timber', [0.04, 0.04, 0.44], [x, 0, 0]);
    }
    // spare bolt rack on the carriage
    part(yaw, 'box', 'timberDark', [0.1, 0.4, 0.5], [0.52, 0.3, 0.45]);
    for (const y of [0.4, 0.5]) part(yaw, 'cyl', 'timber', [0.03, 0.9, 0.03], [0.58, y, 0.3], [Math.PI / 2, 0, 0]);
    // gunner's brass sight
    part(cradle, 'box', 'brass', [0.03, 0.12, 0.03], [0, 0.08, -0.6]);
  },
};

// ---------------------------------------------------------------- public API
export const INVENTION_TYPES = Object.keys(BUILDERS);

export function createInventionModel(type) {
  shared();
  const build = BUILDERS[type];
  if (!build) throw new Error(`Unknown invention type: ${type}`);
  const root = new THREE.Group();
  root.name = `invention:${type}`;
  const parts = {};
  build(root, parts);
  root.userData.inventionType = type;
  root.userData.parts = parts;
  root.userData.state = { open: 0, jaw: 1, recoil: 0 };
  if (type === 'timberline') root.userData.launchHeight = 1.3;
  if (type === 'launcher') root.userData.launchHeight = 1.3;
  if (type === 'forgeRefinery') root.userData.hopperHeight = 1.2;
  if (type === 'watchtower') root.userData.deckHeight = 3;
  animateInventionModel(root, {});
  return root;
}

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

export function animateInventionModel(root, o = {}) {
  const P = root.userData.parts, S = root.userData.state;
  if (!P) return;
  const time = o.time ?? 0;
  const dt = Math.min(0.1, Math.max(0, time - (S.t ?? time)));
  S.t = time;
  const active = o.active ?? true;
  const fireAge = o.fireAge ?? Infinity;
  const progress = THREE.MathUtils.clamp(o.progress ?? 1, 0, 1);
  const damage = THREE.MathUtils.clamp(o.damage ?? 0, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
  root.rotation.z = damage > 0.5 ? Math.sin(time * 0.7) * 0.0 + (damage - 0.5) * 0.06 : 0;

  switch (root.userData.inventionType) {
    case 'loggingYard': {
      const spd = active ? 1 : 0;
      P.saw.rotation.z = -time * 14 * spd;
      P.fly.rotation.z = time * 3 * spd;
      for (const r of P.rollers) r.rotation.y = time * 6 * spd;
      P.log.position.x = active ? -1.1 + ((time * 0.35) % 2.2) : 0;
      break;
    }
    case 'prospector':
      P.scope.rotation.y = Math.sin(time * 0.5) * 0.8;
      P.gem.rotation.y = time;
      break;
    case 'sanctuary':
      P.crystal.position.y = 1.25 + Math.sin(time * 1.3) * 0.08;
      P.crystal.rotation.y = time * 0.6;
      P.water.position.y = 0.82 + Math.sin(time * 2) * 0.01;
      break;
    case 'barracks':
      P.banner.rotation.y = Math.sin(time * 1.7) * 0.25;
      break;
    case 'storehouse':
      P.lantern.rotation.y = time;
      break;
    case 'watchtower':
      P.flame.scale.y = 0.3 + 0.08 * pulse;
      P.flame.rotation.y = time * 2;
      break;
    case 'palisade': {
      S.open = damp(S.open, THREE.MathUtils.clamp(o.open ?? 0, 0, 1), 4, dt || 1);
      for (const d of P.doors) d.rotation.y = d.userData.side * S.open * 1.45;
      break;
    }
    case 'launcher': {
      // rest: arm cocked back (cup low over +Z). charge winds further; fireAge swings over toward -Z.
      const charge = THREE.MathUtils.clamp(o.charge ?? 1, 0, 1);
      const cocked = -0.55 - 0.2 * charge;
      let a = cocked;
      if (fireAge < 0.25) a = cocked + (fireAge / 0.25) * 2.3;
      else if (fireAge < 1.6) a = cocked + 2.3 - Math.min(1, (fireAge - 0.25) / 1.35) * 2.3 * (1 - 0);
      P.arm.rotation.x = -a;
      P.stone.visible = !(fireAge < 1.6 && fireAge > 0.2) && progress > 0.5;
      P.winch.rotation.x = charge * 6;
      P.cup.rotation.x = a * 0.6;
      break;
    }
    case 'ward':
      P.crystal.rotation.y = time * 0.8;
      P.crystal.position.y = 2.9 + Math.sin(time * 1.5) * 0.06;
      P.ring.rotation.y = time * (active ? 0.9 : 0.1);
      P.ring.rotation.x = Math.sin(time * 0.6) * 0.15;
      break;
    case 'trap': {
      S.jaw = damp(S.jaw, o.armed === false ? 0 : 1, o.armed === false ? 30 : 4, dt || 1);
      for (const j of P.jaws) j.rotation.z = j.userData.side * S.jaw * 1.45;
      P.trigger.visible = o.armed !== false;
      break;
    }
    case 'influence':
      P.crystal.rotation.y = time * 0.5;
      P.crystal.position.y = 3.7 + Math.sin(time) * 0.1;
      break;
    case 'forgeRefinery':
      M.ember.emissiveIntensity = active ? 1.2 + 0.6 * pulse : 0.2;
      P.bellows.position.y = 0.45 + (active ? 0.05 * Math.sin(time * 3) : 0);
      P.ingots.forEach((g, i) => (g.visible = progress > (i + 1) / 4));
      break;
    case 'timberline':
      animateTimberline(P, S, o, time, fireAge, progress, dt);
      break;
  }
}

function animateTimberline(P, S, o, time, fireAge, progress, dt) {
  if (o.yaw !== undefined) P.yaw.rotation.y = o.yaw;
  P.cradle.rotation.x = 0.03 + 0.015 * Math.sin(time * 0.4);
  // draw: 1 = cocked and loaded. fire releases instantly; reload follows progress.
  const fired = fireAge < 1.2;
  const draw = fired ? Math.min(1, Math.max(0, (fireAge - 0.6) / 0.6)) * progress : progress;
  // mechanical recoil: whole cradle kicks back then springs home (damped)
  const kick = fireAge < 1.0 ? Math.exp(-fireAge * 7) * Math.cos(fireAge * 22) * 0.12 : 0;
  P.cradle.position.z = 0.05 + Math.max(0, kick);
  P.prod.position.y = -0.04 + (fireAge < 0.4 ? Math.sin(fireAge * 60) * 0.01 * (1 - fireAge / 0.4) : 0);
  // limbs flex forward when drawn
  const flex = 0.05 + 0.32 * draw;
  for (const l of P.limbs) l.rotation.y = -l.userData.side * flex;
  // nock slider position along the rails
  const nockZ = -0.72 + 0.62 * draw;
  P.slider.position.z = nockZ + 0.3;
  // strings from limb tips to nock
  const tipX = 0.14 + 0.86 * Math.cos(flex), tipZ = -0.72 + 0.86 * Math.sin(flex);
  setString(P.stringL, [-tipX, -0.04, tipZ], [0, -0.02, nockZ - 0.06]);
  setString(P.stringR, [tipX, -0.04, tipZ], [0, -0.02, nockZ - 0.06]);
  // bolts: gone during flight, slide in on reload
  P.bolts.visible = !fired || fireAge > 0.6;
  P.bolts.position.z = (draw - 1) * 0.62; // bolts ride forward with the nock while undrawn
  P.windlass.rotation.x = -draw * 9;
  const armedGlow = 0.6 + 0.4 * Math.sin(time * 8);
  P.filament.scale.y = 0.012 * (0.8 + 0.4 * armedGlow);
  P.tipGlow.rotation.y = time * 3;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
function setString(mesh, a, b) {
  _a.set(...a); _b.set(...b);
  mesh.position.copy(_a).add(_b).multiplyScalar(0.5);
  const len = _a.distanceTo(_b);
  mesh.scale.z = len;
  mesh.quaternion.setFromUnitVectors(_z, _b.sub(_a).normalize());
}

export function countInventionMeshes(root) {
  let n = 0;
  root.traverse((c) => { if (c.isMesh) n++; });
  return n;
}

export function disposeInventionArt() {
  if (G) for (const g of Object.values(G)) g.dispose();
  if (M) for (const m of Object.values(M)) m.dispose();
  G = null;
  M = null;
}
