import {OFFLINE_SEAT_GRACE_MS} from '../shared/multiplayer-limits.js';
import {roomCapacity} from '../peer/room-capacity.js';
// Explicit public fields only; never expose internal IDs or reconnect credentials.
export const DIRECTORY_REFRESH = 60_000;
export const DIRECTORY_TTL = 150_000;
// Coarse ping buckets for quick play, from Cloudflare's continent code (request.cf.continent).
// Africa shares Europe's routes and Antarctica shares Oceania's; unknown stays ''.
const REGION_OF = {NA:'na', SA:'sa', EU:'eu', AF:'eu', AS:'as', OC:'oc', AN:'oc'};
export const REGIONS = ['na','sa','eu','as','oc'];
export function regionOf(cf) {
  const key = String(cf?.continent || '').toUpperCase();
  return REGION_OF[key] || (REGIONS.includes(key.toLowerCase()) ? key.toLowerCase() : '');
}
export function roomListing(room, online, now = Date.now()) {
  const members = room.peers.filter(p => online(p.id));
  if (!members.length || now >= room.created + 8 * 3600_000) return null;
  const host = room.peers.find(p => p.id === room.hostId);
  const ready = !!host && online(host.id) && !room.migrating;
  const capacity=roomCapacity(room);
  const vacant = room.peers.length < capacity || room.peers.length===capacity && room.peers.some(p=>p.id!==room.hostId && p.id!==room.offer?.peerId && !online(p.id) && now-p.offlineAt>=OFFLINE_SEAT_GRACE_MS);
  return {code:room.code, region:room.region || '', hostName:host?.name || 'Wanderer',
    players:members.map(p => ({name:p.name,role:p.role})),count:members.length,maxPlayers:Math.max(capacity,members.length),
    joinable:ready && vacant,status:!ready?'waiting':!vacant?'full':'playing',
    expiresAt:Math.min(now+DIRECTORY_TTL,room.created+8*3600_000)};
}
