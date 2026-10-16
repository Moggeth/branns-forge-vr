// Weapon feel (2026-10-16): what a first-person melee swing does at the moment it meets something, the camera's
// small kick when a blow lands or a shot leaves, and the air smear behind a fast swing. Presentation only: the shared
// simulation still owns every hit, and the strike packet still leaves at the authored contact (.5 of the swing).
//
// The rule is mechanical coherence: the reaction follows from what the head of the weapon met.
//   bite     steel edge into wood (and a pick spike into rock): the head sinks and sticks, then is wrenched back out
//            along the way it went in.
//   rebound  steel on hard stone or metal, any blow on a golem: a short jar, the head bounces back up its path, and the
//            haft rings in your hands.
//   cleave   a blade through a body: a brief catch, then it carries on through the follow-through.
//   thud     into the dirt, or a hammer into anything soft: a heavy stop, a little sink, pulled back.
//   miss     nothing there: the authored swing plays through untouched.
//
// Camera space: +X right, +Y up, -Z forward. The swing clock below warps the authored swing (weapon-motion.js) instead
// of replacing it, so every tool keeps its own path; `rest` blends the head home when the reaction ends early.
import * as T from 'three';

export const STRIKE_MATERIALS = Object.freeze(['wood', 'stone', 'metal', 'crystal', 'bone', 'flesh', 'earth']);

// hold: s frozen at contact. back: swing progress the head travels back along its path. out: s for that travel.
// home: s to blend back to rest. sink: m pushed on into the surface during the hold. shiver: rad of the hand jar.
// ring: rad of the haft's ring after a rebound (decays). twist: rad of the wrench while pulling out.
// punch: camera kick [pitch, yaw, roll] (rad; +pitch looks up, +yaw turns left, +roll leans left).
export const STRIKE_REACTIONS = Object.freeze({
  bite:    Object.freeze({hold: .085, back: .06, out: .08,  home: .08, sink: .016, shiver: .018, ring: 0,    twist: .2,  punch: [-.009, .006, .008]}),
  rebound: Object.freeze({hold: .04,  back: .13, out: .07,  home: .13, sink: .004, shiver: .03,  ring: .028, twist: 0,   punch: [.013, .004, -.01]}),
  cleave:  Object.freeze({hold: .05,  back: 0,   out: 0,    home: 0,   sink: .01,  shiver: .012, ring: 0,    twist: 0,   punch: [-.006, .008, .006]}),
  thud:    Object.freeze({hold: .07,  back: .05, out: .08,  home: .11, sink: .012, shiver: .02,  ring: 0,    twist: .06, punch: [-.011, .002, .004]}),
});

// Which reaction a tool gives on a material, and how hard the contact reads (impact energy, sound, punch scale).
const TABLE = {
  axe:    {wood: 'bite', stone: 'rebound', metal: 'rebound', crystal: 'rebound', bone: 'cleave', flesh: 'cleave', earth: 'thud'},
  pick:   {wood: 'bite', stone: 'bite', metal: 'rebound', crystal: 'rebound', bone: 'cleave', flesh: 'cleave', earth: 'bite'},
  hammer: {wood: 'thud', stone: 'rebound', metal: 'rebound', crystal: 'rebound', bone: 'thud', flesh: 'thud', earth: 'thud'},
  limb:   {wood: 'rebound', stone: 'rebound', metal: 'rebound', crystal: 'rebound', bone: 'thud', flesh: 'thud', earth: 'thud'},
};
export const STRIKE_ENERGY = Object.freeze({axe: 1.15, pick: 1.1, hammer: 1.8, limb: .9});
// Steel meeting stone or metal throws sparks; bone or wood on stone never does.
export const STEEL_TOOLS = Object.freeze(['axe', 'pick', 'hammer']);

export function strikeReaction(tool, material) {
  if (!material) return null;
  return (TABLE[tool] || TABLE.axe)[material] || 'thud';
}

/**
 * What the head of a weapon meets at targetId, inferred the way the shared simulation labels its own events
 * (combat.js hit materials, inventions.js structureMaterial, trees.js wood_hit, ore stone_hit). Returns null when it
 * cannot tell, so the caller can fall back to the surface it actually hit.
 */
export function strikeMaterial(targetId, snapshot = {}, {trees = [], structureMaterial = () => 'wood'} = {}) {
  if (targetId === undefined || targetId === null || targetId === 'miss') return null;
  if (targetId === 'ground' || targetId === 'earth') return 'earth';
  if (targetId === 'shrine') return 'metal';
  const enemy = snapshot.enemies?.find(e => e.id === targetId);
  if (enemy) return enemy.kind === 'golem' ? 'stone' : enemy.kind === 'ent' || enemy.kind === 'stumpling' || enemy.kind === 'bramblehog' ? 'wood' : enemy.kind === 'kettlebelly' ? 'metal' : enemy.kind === 'kegtoter' ? 'flesh' : 'bone';
  if (snapshot.players?.some(p => p.id === targetId)) return 'flesh';
  const ore = snapshot.deposits?.find(d => d.id === targetId);
  if (ore) return ore.kind === 'crystal' || ore.special === 'crystal' ? 'crystal' : 'stone';
  if (trees.some(t => t.id === targetId)) return 'wood';
  const building = snapshot.inventions?.structures?.find(b => b.id === targetId);
  if (building) return structureMaterial(building.type);
  if (snapshot.battle?.bases?.some(b => b.id === targetId || b.parts?.some(q => q.id === targetId))) return 'stone';
  if (/geode|outcrop|crystal/i.test(String(targetId))) return 'crystal';
  if (/tree|stump|log|orchard/i.test(String(targetId))) return 'wood';
  return null;
}

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = u => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeOut = u => 1 - (1 - clamp01(u)) ** 3;

/**
 * One melee swing's clock and contact layer. game.js calls begin() when a swing starts, contact() on the frame the
 * strike packet leaves (with what it met, or null for a miss), then frame(now) every frame.
 *   frame().progress   the authored swing progress to pose (weapon-motion.js swingPose)
 *   frame().home       0..1 blend of that pose back to the rest pose (the reaction ended the swing early)
 *   frame().offset / quaternion   camera-space layer on top (sink, shiver, ring, wrench)
 *   frame().done       the swing (and its reaction) is over
 */
export function createStrikeClock({reducedMotion = false} = {}) {
  let start = -Infinity, duration = 1, contactAt = null, reaction = null, kind = null;
  const offset = new T.Vector3(), quaternion = new T.Quaternion(), euler = new T.Euler(0, 0, 0, 'XYZ');
  const out = {progress: -1, home: 0, offset, quaternion, done: true, kind: null, phase: 'idle', trail: 0, contact: .5};
  const motion = reducedMotion ? .35 : 1;

  function begin(now, seconds) { start = now; duration = Math.max(.05, seconds); contactAt = null; reaction = null; kind = null; }
  function contact(now, nextKind) {
    if (contactAt !== null) return;
    contactAt = now; kind = nextKind || 'miss'; reaction = STRIKE_REACTIONS[kind] || null;
  }
  function cancel() { start = -Infinity; contactAt = null; reaction = null; kind = null; }
  /** Seconds this swing's reaction keeps the weapon busy after contact (for tests and the cooldown budget). */
  function tail(nextKind) { const r = STRIKE_REACTIONS[nextKind]; return r ? r.hold + r.out + r.home : 0; }

  function frame(now) {
    offset.set(0, 0, 0); quaternion.identity(); out.home = 0; out.kind = kind; out.trail = 0;
    const t = now - start;
    if (!(t >= 0)) { out.progress = -1; out.done = true; out.phase = 'idle'; return out; }
    let p = t / duration;
    // The swing reaches contact (.5) on its own clock; until the packet leaves the head keeps moving.
    if (contactAt === null || !reaction) {
      out.contact = .5; out.progress = p; out.done = p >= 1; out.phase = p < .5 ? 'swing' : 'through';
      out.trail = contactAt === null ? 1 : Math.max(0, 1 - (now - contactAt) / .12);
      return out;
    }
    const r = reaction, u = now - contactAt, cp = out.contact = Math.max(.5, (contactAt - start) / duration);
    const shiverDecay = Math.exp(-u * 26), jar = r.shiver * motion * shiverDecay;
    let rx = 0, ry = 0, rz = 0;
    out.trail = Math.max(0, 1 - u / .08);
    if (u < r.hold) {
      // Stuck at the contact: driven on a little further, trembling with the blow.
      out.progress = cp; out.phase = 'hold';
      offset.z -= r.sink * easeOut(u / r.hold) * motion;
      rx += Math.sin(u * 2 * Math.PI * 31) * jar; rz += Math.sin(u * 2 * Math.PI * 23 + 1.1) * jar * .7;
    } else if (kind === 'cleave') {
      // Through the body: the follow-through resumes, a little slower for the weight it carried through.
      const v = (u - r.hold) / duration;
      out.progress = cp + v * .95; out.phase = 'through'; out.done = out.progress >= 1;
      offset.z -= r.sink * (1 - smooth((u - r.hold) / .08)) * motion;
      rx += Math.sin(u * 2 * Math.PI * 31) * jar;
      quaternion.setFromEuler(euler.set(rx, ry, rz));
      return out;
    } else if (u < r.hold + r.out) {
      // Wrenched (or bounced) back out along the way it came in.
      const w = (u - r.hold) / r.out, back = kind === 'rebound' ? easeOut(w) : smooth(w);
      out.progress = cp - r.back * back; out.phase = 'out';
      offset.z -= r.sink * (1 - back) * motion;
      rz += r.twist * Math.sin(Math.PI * w) * motion;
      rx -= r.twist * .35 * Math.sin(Math.PI * w) * motion;
    } else {
      const w = (u - r.hold - r.out) / Math.max(.01, r.home);
      out.progress = cp - r.back; out.home = smooth(w); out.phase = 'home'; out.done = w >= 1;
    }
    if (r.ring) { const ring = r.ring * motion * Math.exp(-(u - r.hold * .5) * 9) * (u > r.hold * .5 ? 1 : 0); rx += Math.sin(u * 2 * Math.PI * 17) * ring; ry += Math.sin(u * 2 * Math.PI * 13 + .7) * ring * .6; }
    quaternion.setFromEuler(euler.set(rx, ry, rz));
    return out;
  }
  return {begin, contact, cancel, frame, tail, get kind() { return kind; }};
}

/**
 * Small view kick on hits and shots: a stiff damped spring so the view snaps and settles in about a quarter second,
 * never drifts, and never stacks into a shake. Applied around the render only, so aim rays never see it.
 */
export function createViewPunch({reducedMotion = false, stiffness = 260, damping = 22, limit = .045} = {}) {
  const x = [0, 0, 0], v = [0, 0, 0], scale = reducedMotion ? .3 : 1;
  const STEP = 1 / 240;
  function kick([pitch = 0, yaw = 0, roll = 0] = [], amount = 1) {
    const a = amount * scale;
    v[0] += pitch * a * 38; v[1] += yaw * a * 38; v[2] += roll * a * 38;
  }
  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), .05);
    for (let left = dt; left > 1e-6; left -= STEP) {
      const h = Math.min(STEP, left);
      for (let i = 0; i < 3; i++) { v[i] += (-stiffness * x[i] - damping * v[i]) * h; x[i] += v[i] * h; x[i] = Math.max(-limit, Math.min(limit, x[i])); }
    }
    return x;
  }
  function reset() { x.fill(0); v.fill(0); }
  const active = () => Math.abs(x[0]) + Math.abs(x[1]) + Math.abs(x[2]) + (Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])) * .01 > 1e-5;
  return {kick, update, reset, active, get value() { return x; }};
}

/** Kicks for shots leaving each ranged weapon (pitch climbs with the muzzle, never enough to lose the target). */
export const SHOT_PUNCH = Object.freeze({
  crossbow: [.012, 0, -.004], bow: [.004, 0, .003], stormreel: [.01, .002, -.006], gout: [.016, 0, 0],
  flask: [-.004, .004, .004], nova: [.008, 0, 0],
});

/**
 * Remembers impacts this client already showed and heard ahead of the authority, so the matching authoritative
 * event does not play twice. A prediction is consumed by the first event of a compatible kind within reach and time.
 */
export function createImpactLedger({reach = .9, window = 1.2} = {}) {
  const entries = [];
  function record(position, material, now) {
    entries.push({position: [...position], material, at: now});
    if (entries.length > 16) entries.shift();
  }
  function consume(event, now) {
    if (!event?.position || !['hit', 'headshot', 'wood_hit', 'stone_hit'].includes(event.kind)) return false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (now - e.at > window) continue;
      const p = event.position, d = Math.hypot(p[0] - e.position[0], p[1] - e.position[1], p[2] - e.position[2]);
      if (d <= reach) { entries.splice(i, 1); return true; }
    }
    while (entries.length && now - entries[0].at > window) entries.shift();
    return false;
  }
  return {record, consume, get size() { return entries.length; }};
}

/**
 * The smear a fast swing leaves in the air: a ribbon between the weapon's tip and a point down its head, sampled
 * from the swing's own analytic path (not from past frames), so it is equally smooth at 30 or 144 fps. One draw call,
 * 2 x SAMPLES vertices rewritten only while a swing is in the air. Lives in the camera like the held weapon.
 */
export const TRAIL = Object.freeze({samples: 14, span: .2, inner: .58, tint: Object.freeze({axe: 0xfff3dc, pick: 0xdcefff, hammer: 0xfff0d6, limb: 0xf7f1e4}), alpha: .34});

export function createSwingTrail({samples = TRAIL.samples} = {}) {
  const positions = new Float32Array(samples * 2 * 3), colors = new Float32Array(samples * 2 * 4);
  const index = [];
  for (let i = 0; i < samples - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; index.push(a, b, c, b, d, c); }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 4).setUsage(T.DynamicDrawUsage));
  geometry.setIndex(index);
  const material = new T.MeshBasicMaterial({vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false, toneMapped: false});
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'swing-trail'; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 12;
  const tint = new T.Color(), tip = new T.Vector3(), inner = new T.Vector3();
  let drawn = 0;

  /**
   * sample(p) -> {position, quaternion, tip} of the weapon anchor at swing progress p (camera space), or null.
   * head: newest progress shown; tail: oldest. strength 0..1 fades the whole ribbon.
   */
  function update({sample, head, tail, strength = 1, tipLocal, tool = 'axe'}) {
    if (!(strength > .01) || !(head > tail) || !sample || !tipLocal) { mesh.visible = false; return false; }
    tint.setHex(TRAIL.tint[tool] ?? TRAIL.tint.axe);
    for (let i = 0; i < samples; i++) {
      const f = i / (samples - 1), p = tail + (head - tail) * f, pose = sample(p);
      if (!pose) { mesh.visible = false; return false; }
      tip.copy(tipLocal).applyQuaternion(pose.quaternion).add(pose.position);
      inner.copy(tipLocal).multiplyScalar(TRAIL.inner).applyQuaternion(pose.quaternion).add(pose.position);
      tip.toArray(positions, i * 6); inner.toArray(positions, i * 6 + 3);
      // Brightest at the newest, outer edge; feathered to nothing at the tail and toward the haft.
      const a = TRAIL.alpha * strength * f * f * (3 - 2 * f);
      colors.set([tint.r, tint.g, tint.b, a, tint.r, tint.g, tint.b, 0], i * 8);
    }
    geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    mesh.visible = true; drawn++;
    return true;
  }
  function hide() { mesh.visible = false; }
  function dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); }
  return {mesh, update, hide, dispose, stats: () => ({visible: mesh.visible, drawn})};
}
