// Local physical contact feedback (controller haptics) with truthful ownership.
// Presentation only: never sends actions, never trusts client damage, never moves the camera.
//
// Attribution rules, strongest first:
//  1. event.by (optional, proposed shared stamp of the commanding player) or event.ownerId (embed): exact.
//  2. hammer_slam/pick_burst/axe_cleave: shared sets id = actor player id: exact.
//  3. Hero damage: kind hit/death with id === local player and no enemy `part`: exact (target is us).
//  4. Melee impacts without `by`: correlated with a locally outstanding contact (same target id, nearby
//     authoritative point, short window, same tool generation). Correlation, not identity: a remote peer
//     hitting the same target within POINT_TOLERANCE of our point inside the window is indistinguishable.
//     Plain confirmed impacts therefore add nothing beyond the local contact pulse; only consequences
//     (headshot, notch cut, fell, ore break, detach, kill) add one bounded follow-up.
//  5. Projectile embed/hit: owned projectile ids from authoritative snapshot ownerId (retained briefly).
//  Everything else (remote, distant, unattributed) is suppressed. Distance is never used as identity.

export const MATERIAL_PROFILES = Object.freeze({
  wood: {amplitude: .42, duration: 26}, stone: {amplitude: .55, duration: 18}, metal: {amplitude: .5, duration: 14},
  bone: {amplitude: .38, duration: 22}, earth: {amplitude: .22, duration: 16}, generic: {amplitude: .32, duration: 18},
});
export const TOOL_WEIGHT = Object.freeze({axe: 1, pick: .95, hammer: 1.2, limb: .8});
export const CONSEQUENCE = Object.freeze({
  headshot: {amplitude: .5, duration: 24}, cut: {amplitude: .45, duration: 30}, tree_fell: {amplitude: .6, duration: 60},
  ore_break: {amplitude: .6, duration: 34}, detach: {amplitude: .45, duration: 26}, death: {amplitude: .55, duration: 40},
  hammer_slam: {amplitude: .75, duration: 55}, pick_burst: {amplitude: .6, duration: 35}, axe_cleave: {amplitude: .65, duration: 40},
});
const LIMITS = Object.freeze({minGap: 45, perSecond: 10, maxAmplitude: .85, maxDuration: 70, contactWindow: 700,
  consequenceWindow: 250, pointTolerance: .35, dedupeWindow: 250, projectileMemory: 3000, damageGap: 400, consequenceDelay: 70});
export const MELEE_TOOLS = Object.freeze(['axe', 'pick', 'hammer', 'limb']);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const point3 = p => Array.isArray(p) && p.length === 3 && p.every(finite);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Which physical hand holds or acts for a tool. Mirrors game.js attachWeapon: bow rides the left hand.
export function toolHand(tool, weaponHand) {
  if (weaponHand === 'left' || weaponHand === 'right') return weaponHand;
  return tool === 'bow' ? 'left' : 'right';
}
export const otherHand = hand => hand === 'left' ? 'right' : 'left';

// Pure: shape of the immediate pulse for a real local geometric contact.
export function contactProfile({material = 'generic', tool = 'axe', speed, normal, direction, glance = false} = {}) {
  const base = MATERIAL_PROFILES[material] || MATERIAL_PROFILES.generic;
  let amplitude = base.amplitude * (TOOL_WEIGHT[tool] ?? 1), duration = base.duration;
  if (finite(speed)) amplitude *= clamp(.55 + speed / 8, .6, 1.15);
  if (point3(normal) && point3(direction)) {
    const n = Math.hypot(...normal) * Math.hypot(...direction);
    if (n > 1e-6) { const facing = Math.abs(normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2]) / n;
      if (facing < .35) glance = true; }
  }
  if (glance) { amplitude *= .55; duration *= .7; }
  return {amplitude: clamp(amplitude, 0, LIMITS.maxAmplitude), duration: Math.round(clamp(duration, 5, LIMITS.maxDuration))};
}

// Pure: classify one broadcast event. Returns {owner:'local'|'remote'|'none', reason, ...}.
export function attributeEvent(event, {playerId, contacts = [], ownedProjectiles, now = 0}) {
  if (!event || typeof event !== 'object' || event.fire) return {owner: 'none', reason: 'ignored'};
  const kind = event.kind;
  // Being the damaged hero is local regardless of who caused it (enemy events carry `part`; hero damage does not).
  if ((kind === 'hit' || kind === 'death') && playerId != null && event.id === playerId && event.part === undefined)
    return {owner: 'local', reason: 'self-target', damage: kind};
  const stamped = event.by !== undefined ? event.by : kind === 'embed' && event.ownerId !== undefined ? event.ownerId : undefined;
  if (stamped !== undefined && (playerId == null || stamped !== playerId)) return {owner: 'remote', reason: 'stamped'};
  if (['hammer_slam', 'pick_burst', 'axe_cleave'].includes(kind))
    return playerId != null && event.id === playerId ? {owner: 'local', reason: 'actor-id', consequence: kind} : {owner: 'remote', reason: 'actor-id'};
  if (kind === 'embed') {
    if (stamped !== undefined || ownedProjectiles?.has(event.id)) return {owner: 'local', reason: stamped !== undefined ? 'stamped' : 'owned-projectile', projectile: true, enemy: !event.impact};
    return {owner: 'none', reason: 'unowned-projectile'};
  }
  const direct = {hit: 1, headshot: 1, wood_hit: 1, stone_hit: 1}[kind];
  const follow = {detach: 'sourceId', death: 'id', tree_fell: 'id', ore_break: 'id'}[kind];
  if (!direct && !follow) return stamped !== undefined ? {owner: 'local', reason: 'stamped-other'} : {owner: 'none', reason: 'unattributed-kind'};
  const target = direct ? event.id : event[follow];
  const live = contacts.filter(c => c.target === target);
  let match = null;
  if (direct) {
    match = live.filter(c => !c.confirmedAt && now - c.at <= LIMITS.contactWindow &&
      (!point3(event.position) || !point3(c.point) || distance(event.position, c.point) <= LIMITS.pointTolerance))
      .sort((a, b) => distance(event.position || a.point, a.point) - distance(event.position || b.point, b.point))[0] || null;
  } else match = live.find(c => c.confirmedAt && now - c.confirmedAt <= LIMITS.consequenceWindow) || null;
  if (match) return {owner: 'local', reason: stamped !== undefined ? 'stamped' : 'contact-correlation', contact: match, direct: !!direct};
  return stamped !== undefined ? {owner: 'local', reason: 'stamped-uncorrelated'} : {owner: 'none', reason: 'no-local-contact'};
}

export function createContactFeedback({sources = () => [], playerId = () => null, tool = () => 'axe', weaponHand = () => null,
  presenting = () => true, clock = () => performance.now(), schedule = (f, ms) => setTimeout(f, ms), cancel = id => clearTimeout(id),
  projectileConfirm = true, limits = {}} = {}) {
  const L = {...LIMITS, ...limits};
  let disposed = false, generation = 0, drawFull = false, lastDamage = -Infinity;
  let contacts = [];
  const owned = new Map(); // projectile id -> last seen time
  const recent = new Map(); // dedupe key -> time
  const hands = {left: {last: -Infinity, times: []}, right: {last: -Infinity, times: []}};
  const timers = new Set();
  const stats = {pulses: 0, rejected: 0, throttled: 0, noActuator: 0, suppressed: 0, local: 0, duplicates: 0, stale: 0};

  function actuatorFor(hand) {
    try { for (const source of sources() || []) if (source?.handedness === hand) return source.gamepad?.hapticActuators?.[0] || null; }
    catch { /* source list mutated mid-iteration; treat as no actuator */ }
    return null;
  }
  function pulse(hand, {amplitude, duration}) {
    if (disposed || !presenting() || (hand !== 'left' && hand !== 'right')) return false;
    const now = clock(), h = hands[hand];
    h.times = h.times.filter(t => now - t < 1000);
    if (now - h.last < L.minGap || h.times.length >= L.perSecond) { stats.throttled++; return false; }
    const actuator = actuatorFor(hand);
    if (!actuator || typeof actuator.pulse !== 'function') { stats.noActuator++; return false; }
    h.last = now; h.times.push(now);
    const a = clamp(amplitude, 0, L.maxAmplitude), d = Math.round(clamp(duration, 5, L.maxDuration));
    try { const result = actuator.pulse(a, d); if (result && typeof result.catch === 'function') result.catch(() => { stats.rejected++; }); }
    catch { stats.rejected++; return false; }
    stats.pulses++; return true;
  }
  function later(ms, f) { const token = generation; const id = schedule(() => { timers.delete(id); if (!disposed && token === generation) f(); }, ms); timers.add(id); }
  function prune(now) {
    contacts = contacts.filter(c => now - c.at <= L.contactWindow || (c.confirmedAt && now - c.confirmedAt <= L.consequenceWindow));
    for (const [k, t] of recent) if (now - t > L.dedupeWindow) recent.delete(k);
    for (const [k, t] of owned) if (now - t > L.projectileMemory) owned.delete(k);
  }
  function duplicate(event, now) {
    const p = point3(event.position) ? event.position.map(v => Math.round(v * 20)).join(',') : '';
    const key = `${event.kind}|${event.id ?? ''}|${event.tick ?? ''}|${event.cuts ?? ''}|${event.part ?? ''}|${p}`;
    if (recent.has(key)) return true; recent.set(key, now); return false;
  }

  return {
    // Real geometric contact detected locally (VR physical melee). Pulses now; registers ownership for confirmation.
    contact({targetId, point, normal, direction, speed, material, tool: used = tool(), hand} = {}) {
      if (disposed || !MELEE_TOOLS.includes(used) || used !== tool()) return false;
      const now = clock(); prune(now);
      const side = hand === 'left' || hand === 'right' ? hand : toolHand(used, weaponHand());
      if (targetId !== undefined && targetId !== 'miss') contacts.push({target: targetId, point: point3(point) ? [...point] : null, tool: used, hand: side, generation, at: now, confirmedAt: 0});
      if (contacts.length > 8) contacts.splice(0, contacts.length - 8);
      return pulse(side, contactProfile({material, tool: used, speed, normal, direction}));
    },
    // Local release of a ranged weapon (the string/limb actually leaves the hand). Not an impact.
    release(used = tool(), {golden = false} = {}) {
      if (disposed) return false; drawFull = false;
      if (used === 'bow') { const bow = toolHand('bow', weaponHand()); const a = pulse(bow, {amplitude: .4, duration: 22});
        pulse(otherHand(bow), {amplitude: .25, duration: 12}); return a; }
      if (used === 'crossbow') return pulse(toolHand(used, weaponHand()), golden ? {amplitude: .85, duration: 60} : {amplitude: .55, duration: 28});
      return false;
    },
    // Siegebird reload on the weapon hand: every other ratchet tooth, the latch, and the bird seating the bolt.
    siegebird(cue, {golden = false, index = 0} = {}) {
      if (disposed || tool() !== 'crossbow') return false;
      const hand = toolHand('crossbow', weaponHand());
      if (cue === 'click') return index % 2 === 0 && pulse(hand, {amplitude: .1, duration: 8});
      if (cue === 'latch') return pulse(hand, {amplitude: .22, duration: 14});
      if (cue === 'seat') return pulse(hand, golden ? {amplitude: .6, duration: 55} : {amplitude: .3, duration: 18});
      return false;
    },
    // Weapon-controller draw state. One tension tick on the string hand at full draw; nothing continuous.
    draw(state) {
      if (disposed || tool() !== 'bow') { drawFull = false; return false; }
      if (!state?.drawing) { drawFull = false; return false; }
      if (state.draw >= .999 && !drawFull) { drawFull = true; return pulse(otherHand(toolHand('bow', weaponHand())), {amplitude: .12, duration: 10}); }
      return false;
    },
    // Authoritative snapshot: remember which projectiles the local player owns (ownerId is public snapshot data).
    sync(snapshot, id = playerId()) {
      if (disposed || !snapshot) return; const now = clock();
      for (const p of snapshot.projectiles || []) if (id != null && p?.ownerId === id) owned.set(p.id, now);
    },
    handleEvent(event) {
      if (disposed || !event) return null;
      const now = clock(); prune(now);
      if (duplicate(event, now)) { stats.duplicates++; return {owner: 'none', reason: 'duplicate'}; }
      const result = attributeEvent(event, {playerId: playerId(), contacts, ownedProjectiles: owned, now});
      if (result.owner !== 'local') { stats.suppressed++; return result; }
      const current = tool();
      if (result.contact) {
        const c = result.contact;
        if (c.generation !== generation || c.tool !== current) { stats.stale++; contacts = contacts.filter(x => x !== c); return {...result, owner: 'none', reason: 'stale-contact'}; }
        stats.local++;
        // A plain confirmed impact adds nothing: the contact pulse already happened at real contact time.
        let extra = null;
        if (result.direct) { c.confirmedAt = now;
          extra = event.kind === 'headshot' ? CONSEQUENCE.headshot : event.kind === 'wood_hit' && event.cuts >= 1 && event.cuts < 3 && !event.glance ? CONSEQUENCE.cut : null; }
        else extra = CONSEQUENCE[event.kind] || null;
        // At most one follow-up per contact: a kill that detaches four limbs is one heavier thump, not five.
        if (extra && !c.followed) { c.followed = true; later(L.consequenceDelay, () => pulse(c.hand, extra)); }
        return result;
      }
      stats.local++;
      if (result.consequence) { if (MELEE_TOOLS.includes(current)) pulse(toolHand(current, weaponHand()), CONSEQUENCE[result.consequence]); return result; }
      // Bounded whole-body response when we are the damaged hero; death follows its hit after a short gap.
      if (result.damage === 'death') { lastDamage = now; later(L.consequenceDelay, () => { const p = {amplitude: .5, duration: 50}; pulse('left', p); pulse('right', p); }); return result; }
      if (result.damage) { if (now - lastDamage >= L.damageGap) { lastDamage = now; const p = {amplitude: .28, duration: 30}; pulse('left', p); pulse('right', p); } return result; }
      // Faint confirm for our own projectile striking an enemy; world embeds stay silent (no fake hand impact at range).
      if (result.projectile) { if (projectileConfirm && result.enemy && ['bow', 'crossbow'].includes(current))
          pulse(toolHand(current, weaponHand()), {amplitude: .14, duration: 12}); return result; }
      return result;
    },
    // Equip, role change, XR session start/end, menu cancel: no stale contact may vibrate the next tool.
    reset() { generation++; contacts = []; drawFull = false; for (const id of timers) cancel(id); timers.clear(); },
    dispose() { if (disposed) return; this.reset(); disposed = true; owned.clear(); recent.clear(); },
    stats: () => ({...stats, pending: contacts.length, owned: owned.size, generation, disposed}),
  };
}
