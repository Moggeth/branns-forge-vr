// Pure WebXR Hero input routing. Hands come only from XRInputSource.handedness, never from controller index.
// No THREE, no snapshot mutation: callers pass plain source maps/arrays and act on the returned decisions.
// Shared simulation still validates every action; this module only decides which local press means what.

// With two controllers the left trigger is the special/curve hand for these tools (bow: left holds the bow,
// right draws). Every other tool keeps the left trigger on primaryDown, exactly as before.
export const LEFT_SPECIAL_TOOLS = ['bow', 'wyrmspout', 'flask'];
const entries = sources => sources instanceof Map ? [...sources.entries()] : [...(sources || [])];

export function indexFor(sources, hand) {
  for (const [i, s] of entries(sources)) if (s?.handedness === hand) return i;
  return undefined;
}
export const preferredWeaponHand = tool => tool === 'bow' ? 'left' : 'right';

// Mirrors game.js attachWeapon: tracked-pointer sources only, preferred hand first, else the first tracked one.
export function weaponMount(tool, sources) {
  const tracked = entries(sources).filter(([, s]) => s?.targetRayMode === 'tracked-pointer');
  const hit = tracked.find(([, s]) => s.handedness === preferredWeaponHand(tool)) || tracked[0];
  return hit ? {index: hit[0], hand: hit[1].handedness} : null;
}

// Which controller a ray comes from. 'weapon': the hand the weapon is actually attached to (weaponHand from
// attachWeapon), then the mount rule. 'press': the controller that produced the press, if still connected.
// null means "no usable controller": the caller falls back to the head/camera rather than a blind index 0.
export function aimIndex({purpose = 'weapon', tool, sources, weaponHand = null, pressIndex} = {}) {
  const list = entries(sources);
  if (purpose === 'press' && list.some(([i]) => i === pressIndex)) return pressIndex;
  if (weaponHand) { const i = indexFor(list, weaponHand); if (i !== undefined) return i; }
  return weaponMount(tool, list)?.index ?? null;
}

// Does a controller other than the left one exist? 'none'-handed sources count as the primary (right) hand.
const hasNonLeft = list => list.some(([, s]) => s && s.handedness !== 'left');
const hasLeft = list => list.some(([, s]) => s?.handedness === 'left');

// Trigger meaning at selectstart. 'throw' | 'special' | 'primary'.
// - The primary hand is right/'none'; with only a left controller connected, the left becomes the primary hand.
// - Holding a loose log/limb: the primary-hand trigger throws it (as before); the off hand keeps its weapon role.
export function triggerRole({tool, hand, sources, holding = false} = {}) {
  const list = entries(sources);
  const offHand = hand === 'left' && hasNonLeft(list);
  if (holding && !offHand) return 'throw';
  if (offHand && LEFT_SPECIAL_TOOLS.includes(tool)) return 'special';
  return 'primary';
}

// Sticks that drive walking: left/'none' as before; if only a right controller exists, its stick walks
// (the right stick is otherwise unbound, so this adds no conflict).
export function moveIndexes(sources) {
  const pads = entries(sources).filter(([, s]) => s?.gamepad);
  const walk = pads.filter(([, s]) => s.handedness !== 'right');
  return (walk.length ? walk : pads).map(([i]) => i);
}

// xr-standard gamepad edges for one source. Returns the next latched state and the press-edge actions.
// buttons: 1 squeeze, 3 thumbstick click, 4 A/X, 5 B/Y. Familiar bindings are unchanged; the only addition is
// left thumbstick click = 'interact' (collect / eat / stow a held log), which was previously unbound in VR.
export function buttonActions(source, previous = {}, {hero = true, active = true} = {}) {
  const b = source?.gamepad?.buttons || [];
  const state = {squeeze: !!b[1]?.pressed, stick: !!b[3]?.pressed, jump: !!b[4]?.pressed, menu: !!b[5]?.pressed};
  const actions = [];
  if (!active) return {state, actions};
  const edge = k => state[k] && !previous[k];
  const hand = source?.handedness;
  if (edge('menu')) actions.push('menu');
  if (!hero) return {state, actions};
  if (edge('jump')) actions.push('jump');
  if (edge('squeeze')) actions.push(hand === 'left' ? 'cycle' : 'hand');
  if (edge('stick')) { if (hand === 'right') actions.push('bridge'); else if (hand === 'left') actions.push('interact'); }
  return {state, actions};
}

// Press ownership: selectend always goes to whoever took the matching selectstart, independent of later
// handedness, tool, role or panel changes. invalidate() keeps the pairing but makes the release inert
// (used after equip/role/menu changes so a release can never fire with a different tool).
export function createPressRouter() {
  const owners = new Map();
  return {
    begin(index, owner, tool = null) { const stale = owners.get(index) || null; owners.set(index, {owner, tool}); return stale; },
    end(index) { const p = owners.get(index) || null; owners.delete(index); return p; },
    // Controller lost without selectend: returns what was held so the caller can cancel (never fire) it.
    lose(index) { return this.end(index); },
    invalidate() { for (const p of owners.values()) if (p.owner !== 'panel') p.owner = 'inert'; },
    clear() { const all = [...owners.entries()]; owners.clear(); return all; },
    owners: () => new Map([...owners].map(([i, p]) => [i, {...p}])),
  };
}
