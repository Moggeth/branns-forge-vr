// Voice zones: places where talking is the point (taverns, sanctuaries).
// Every client registers the same static world data, so the voice host's
// topology and each listener's mix agree without any new network message.
//
//   setVoiceZones('taverns', [{id:'tavern-middle', kind:'tavern', label:'The Middle Tavern',
//     center:[x, y, z], radius:9, height:6}]);   // height optional (vertical half-extent)
//   setVoiceZones('taverns', []);                 // remove that source's zones
//
// Inside one zone: everyone in it is linked and heard clearly across the room.
// Across a zone edge: voices are muffled, as if through the walls.
// A zone with kind 'tavern' or 'sanctuary' also invites players to join voice.
const sources = new Map(), resolvers = new Map();
let all = [];
const finite = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export const INVITING = new Set(['tavern', 'sanctuary']);

export function setVoiceZones(source, zones = []) {
  const clean = zones.filter(z => z && typeof z.id === 'string' && finite(z.center) && z.radius > 0)
    .map(z => ({id:z.id, kind:z.kind || 'tavern', label:z.label || 'Tavern', center:[...z.center], radius:+z.radius, height:z.height > 0 ? +z.height : 8}));
  if (clean.length) sources.set(source, clean); else sources.delete(source);
  all = [...sources.values()].flat();
}
export const voiceZones = () => all;
/** Dynamic zones from world state: fn(position) returns {id, kind, label} or null. Pass null to remove. */
export function setVoiceZoneResolver(source, fn) { if (typeof fn === 'function') resolvers.set(source, fn); else resolvers.delete(source); }
export function voiceZoneAt(position, zones = all) {
  if (!finite(position)) return null;
  if (zones === all) for (const fn of resolvers.values()) {
    let zone = null; try { zone = fn(position); } catch { zone = null; }
    if (typeof zone === 'string') return {id:zone, kind:'tavern', label:'Tavern'};
    if (zone) return {id:String(zone.id ?? 'tavern'), kind:zone.kind || 'tavern', label:zone.label || zone.name || 'Tavern'};
  }
  let best = null, bestDistance = Infinity;
  for (const z of zones) {
    const d = Math.hypot(position[0] - z.center[0], position[2] - z.center[2]);
    if (d <= z.radius && Math.abs(position[1] - z.center[1]) <= z.height && d < bestDistance) { best = z; bestDistance = d; }
  }
  return best;
}
/** How a listener hears a speaker: 'open' (outdoors, normal falloff), 'room' (same zone), 'wall' (one side of a zone edge). */
export function voiceRelation(listener, speaker, zones = all) {
  const a = voiceZoneAt(listener, zones)?.id ?? null, b = voiceZoneAt(speaker, zones)?.id ?? null;
  return a === b ? (a ? 'room' : 'open') : 'wall';
}
