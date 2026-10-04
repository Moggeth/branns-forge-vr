import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';

// Pre-capability clients simulate/load at most eight human records. Absence is
// deliberately legacy, never permission to admit more people than they can load.
export const clientCapacity = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_PLAYERS ? value : 8;
export function roomCapacity(room, serverLimit = MAX_PLAYERS) {
  const peers = room?.peers instanceof Map ? [...room.peers.values()] : room?.peers || [];
  return Math.min(serverLimit, ...(peers.length ? peers.map(p=>clientCapacity(p.simCapacity)) : [8]));
}
