// Staged cosmetic growth for INTACT instanced trees (no gameplay state): inside the same 1400 ms window a newly planted
// tree starts as a thin sapling, its trunk lengthens, branches sprout from the trunk, foliage then fruit pop out of the
// crown and the tree finishes with a damped jostle. Implemented as per-part local matrices fed to tree-batch.js, so the
// authored GLB hierarchy (Trunk/Roots/Branches/Leaves/Fruit) stays shared and instanced; no clones, no new geometry.
// At t >= GROW_MS every part matrix is exactly identity (callers then write the plain mature path).
import * as T from 'three';

export const GROW_MS = 1400;
const MIN = .002; // never a zero scale: the instancing normal transform divides by the squared column length
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = x => { x = clamp01(x); return x*x*(3 - 2*x); };
const outCubic = x => { x = clamp01(x); return 1 - (1 - x)**3; };
const outBack = (x, k = 1.6) => { x = clamp01(x); if (x >= 1) return 1; const y = x - 1; return 1 + (k + 1)*y*y*y + k*y*y; };
const span = (t, a, b) => clamp01((t - a)/(b - a));

/** Deterministic per-tree 0..1 hash (FNV-1a), used for jostle phase/direction and a tiny stagger. */
export function growthSeed(id) { let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000)/100000; }

/** Normalised progress 0..1 for a birth time; 1 for saved/late-join trees (born -1e9). */
export const growthProgress = (born, now) => clamp01((now - born)/GROW_MS);

const profiles = new WeakMap(), box = new T.Box3(), pb = new T.Box3();
/** Per-kit pivots in Tree-root space, cached (kits are rebuilt on asset reload, so the cache follows them). */
export function growthProfile(kit) {
 let p = profiles.get(kit); if (p) return p; const b = {};
 for (const [part, list] of Object.entries(kit.parts)) { box.makeEmpty(); for (const e of list) { if (!e.geometry.boundingBox) e.geometry.computeBoundingBox(); box.union(pb.copy(e.geometry.boundingBox).applyMatrix4(e.matrix)); } b[part] = box.clone(); }
 const trunkTop = b.Trunk ? b.Trunk.max.y : 4, crown = b.Leaves || b.Branches || b.Trunk;
 const branchBase = b.Branches ? Math.max(.3, b.Branches.min.y) : trunkTop*.5;
 const c = crown.getCenter(new T.Vector3()); c.y = crown.min.y + (crown.max.y - crown.min.y)*.42;
 p = {trunkTop, branchBase, crownCentre: c, crownHeight: crown.max.y}; profiles.set(kit, p); return p;
}

/** Scalar pose for normalised progress g (0..1) and seed s. Every channel is exactly its mature value at g = 1. */
export function growthPose(g, s = 0) {
 if (g >= 1) return {trunkXZ: 1, trunkY: 1, roots: 1, branches: 1, leaves: 1, fruit: 1, tiltX: 0, tiltZ: 0, done: true};
 const j = (s - .5)*.04; // +/-2% stagger on the inner milestones; window start/end never move
 const trunkY = .2 + .8*outCubic(span(g, 0, .55 + j)), trunkXZ = .28 + .72*smooth(span(g, 0, .72));
 const roots = .35 + .65*smooth(span(g, 0, .4));
 const branches = MIN + (1 - MIN)*outBack(span(g, .14 + j, .58 + j), 1.2);
 // a small bud tuft rides the sapling tip early (living crown, not a bare stick), then the full canopy pops out
 const bud = .1*smooth(span(g, .02, .16)), leaves0 = Math.max(MIN + bud, MIN + (1 - MIN)*outBack(span(g, .38 + j, .78), 1.9)), fruit = MIN + (1 - MIN)*outBack(span(g, .6, .84), .6); // low overshoot: fruit scaled about the crown centre must stay inside foliage
 const u = span(g, .74, 1), decay = (1 - u)*(1 - u), a = s*Math.PI*2; // settle: damped, exactly zero at u = 1
 const wob = decay*Math.sin(u*Math.PI*6), tilt = .03*decay*Math.sin(u*Math.PI*5 + .4);
 return {trunkXZ, trunkY, roots, branches, leaves: leaves0*(1 + .055*wob), fruit, tiltX: tilt*Math.cos(a), tiltZ: tilt*Math.sin(a), done: false};
}

const tm = new T.Matrix4(), sm = new T.Matrix4(), sway = new T.Matrix4(), carry = new T.Matrix4(), rq = new T.Quaternion(), re = new T.Euler(), sv = new T.Vector3();
const about = (out, pivotIn, pivotOut, sx, sy, sz) => out.makeTranslation(pivotOut.x, pivotOut.y, pivotOut.z).multiply(sm.makeScale(sx, sy, sz)).multiply(tm.makeTranslation(-pivotIn.x, -pivotIn.y, -pivotIn.z));
const pIn = new T.Vector3(), pOut = new T.Vector3();
/** Fills local (pre-part) matrices for one tree: {Trunk, Roots, Branches, Leaves, Fruit} -> Matrix4 in Tree-root space.
 *  Roots never tilt and stay anchored at y = 0; trunk scales about the ground anchor on the trunk axis. */
export function growthMatrices(profile, pose, out = {}) {
 for (const k of ['Trunk', 'Roots', 'Branches', 'Leaves', 'Fruit']) out[k] ||= new T.Matrix4();
 sway.makeRotationFromQuaternion(rq.setFromEuler(re.set(pose.tiltX, 0, pose.tiltZ)));
 out.Roots.makeScale(pose.roots, .6 + .4*pose.roots, pose.roots);
 out.Trunk.makeScale(pose.trunkXZ, pose.trunkY, pose.trunkXZ).premultiply(sway);
 // branches ride the growing trunk: their authored base height is carried to the scaled trunk height, then sprout outward
 about(out.Branches, pIn.set(0, profile.branchBase, 0), pOut.set(0, profile.branchBase*pose.trunkY, 0), pose.branches, pose.branches, pose.branches).premultiply(sway);
 const c = profile.crownCentre, carried = sv.copy(c).applyMatrix4(about(carry, pIn.set(0, profile.branchBase, 0), pOut.set(0, profile.branchBase*pose.trunkY, 0), pose.branches, pose.branches, pose.branches));
 about(out.Leaves, c, carried, pose.leaves, pose.leaves, pose.leaves).premultiply(sway);
 about(out.Fruit, c, carried, pose.fruit, pose.fruit, pose.fruit).premultiply(sway);
 return out;
}
export const isIdentity = m => m.equals(new T.Matrix4());
