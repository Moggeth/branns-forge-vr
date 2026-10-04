// Human room seats. Simulation-owned bots do not consume coordinator identities.
export const MAX_PLAYERS = 32;
export const MAX_PENDING_ROOM_SOCKETS = 8;
export const OFFLINE_SEAT_GRACE_MS = 5000;
export const SIGNAL_MESSAGES_PER_EDGE = 120;
export const RELAY_BYTES_PER_EDGE = 2 * 1024 * 1024;
export const RELAY_MESSAGES_PER_EDGE = 200;
