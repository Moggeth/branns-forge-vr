// Explicit public fields only; never expose internal IDs or reconnect credentials.
export const DIRECTORY_REFRESH = 60_000;
export const DIRECTORY_TTL = 150_000;
export function roomListing(room, online, now = Date.now()) {
  const members = room.peers.filter(p => online(p.id));
  if (!members.length || now >= room.created + 8 * 3600_000) return null;
  const host = room.peers.find(p => p.id === room.hostId);
  const ready = !!host && online(host.id) && !room.migrating;
  return {code:room.code, hostName:host?.name || 'Wanderer',
    players:members.map(p => ({name:p.name,role:p.role})),count:members.length,maxPlayers:8,
    joinable:ready && members.length < 8,status:!ready?'waiting':members.length>=8?'full':'playing',
    expiresAt:Math.min(now+DIRECTORY_TTL,room.created+8*3600_000)};
}
