import { createServer } from 'node:http';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {clientCapacity,roomCapacity} from './room-capacity.js';
import {MAX_PLAYERS,SIGNAL_MESSAGES_PER_EDGE} from '../shared/multiplayer-limits.js';

const here = dirname(fileURLToPath(import.meta.url));
const number = (name, fallback) => { const value = Number(process.env[name]); return Number.isFinite(value) && value > 0 ? value : fallback; };
const config = {
  host: process.env.PEER_HOST || '127.0.0.1',
  port: number('PEER_PORT', 8789),
  origins: (process.env.PEER_ORIGINS || 'http://127.0.0.1:5178,http://localhost:5178').split(',').map(x => x.trim()).filter(Boolean),
  maxRooms: number('PEER_MAX_ROOMS', 100),
  maxPeers: Math.min(MAX_PLAYERS, Math.floor(number('PEER_MAX_PEERS', MAX_PLAYERS))),
  idleMs: number('PEER_ROOM_IDLE_MS', 30 * 60_000),
  maxAgeMs: number('PEER_ROOM_MAX_AGE_MS', 8 * 60 * 60_000),
  shutdownIdleMs: Number(process.env.PEER_SHUTDOWN_IDLE_MS || 0),
  disconnectGraceMs: number('PEER_DISCONNECT_GRACE_MS', 15_000),
  // A full room may reclaim a seat from a guest that has been offline this long.
  evictOfflineMs: Number.isFinite(Number(process.env.PEER_EVICT_OFFLINE_MS)) && Number(process.env.PEER_EVICT_OFFLINE_MS) >= 0 ? Number(process.env.PEER_EVICT_OFFLINE_MS) : 5_000,
  offerMs: number('PEER_CONTINUE_OFFER_MS', 120_000),
  turnUrl: process.env.PEER_TURN_URL || '',
  turnSecret: process.env.PEER_TURN_SECRET || '',
  turnTtl: Math.min(3600, number('PEER_TURN_TTL_SEC', 600)),
  stunUrls: (process.env.PEER_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(x => x.trim()).filter(Boolean),
  logPath: process.env.PEER_LOG_PATH || resolve(here, 'logs', 'server.jsonl'),
};
if (!config.origins.length) throw new Error('PEER_ORIGINS must contain an exact allowed browser origin');
mkdirSync(dirname(config.logPath), { recursive: true });
function log(event, extra = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...extra });
  appendFileSync(config.logPath, line + '\n');
  process.stdout.write(line + '\n');
}
process.on('uncaughtException', error => { log('uncaught_exception', { message: error.message, stack: error.stack }); process.exitCode = 1; server.close(); });
process.on('unhandledRejection', error => log('unhandled_rejection', { message: String(error) }));

const rooms = new Map();
const ipBuckets = new Map();
const code = () => String(randomInt(100_000_000)).padStart(8, '0');
const secret = () => randomBytes(32).toString('base64url');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (ws, value) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
const fail = (ws, code, message) => send(ws, { type: 'error', code, message });
const broadcast = (room, message, except) => { for (const peer of room.peers.values()) if (peer.ws !== except) send(peer.ws, message); };
const touch = room => { room.lastActivity = Date.now(); };
const publicPeer = peer => ({ id: peer.id, name: peer.name, role: peer.role, desktop: peer.desktop, online: !!peer.ws && peer.ws.readyState === WebSocket.OPEN, checkpointRevision: peer.revision });
function iceServers(peerId) {
  const servers = config.stunUrls.map(url => ({ urls: url }));
  if (config.turnUrl && config.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + config.turnTtl}:${peerId}`;
    const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
    servers.push({ urls: config.turnUrl, username, credential });
  }
  return servers;
}
function welcome(peer, room) {
  send(peer.ws, { type: 'welcome', protocol: 1, room: room.code, peerId: peer.id, secret: peer.secret, role: peer.role,
    hostId: room.hostId, epoch: room.epoch, maxPeers: roomCapacity(room,config.maxPeers), peers: [...room.peers.values()].filter(p => p !== peer).map(publicPeer),
    iceServers: iceServers(peer.id), relayConfigured: !!(config.turnUrl && config.turnSecret) });
}
function connected(room, peer) { return peer?.ws?.readyState === WebSocket.OPEN && room.peers.get(peer.id) === peer; }
function clearOffer(room) { clearTimeout(room.offerTimer); room.offer = null; }
function eligible(room) { return [...room.peers.values()].filter(p => p.id !== room.hostId && p.desktop && clientCapacity(p.simCapacity)>=room.peers.size && connected(room, p) && p.revision >= 0).sort((a,b) => b.revision - a.revision || a.id.localeCompare(b.id)); }
function nextOffer(room) {
  clearOffer(room);
  if (!rooms.has(room.code)) return;
  const candidate = eligible(room).find(p => !room.tried.has(p.id));
  if (!candidate) { broadcast(room, { type: 'world_waiting', epoch: room.epoch, message: 'The host left. Waiting for a desktop player with a checkpoint.' }); return; }
  room.tried.add(candidate.id);
  room.offer = { peerId: candidate.id, epoch: room.epoch, graceful: false };
  send(candidate.ws, { type: 'continue_world_offer', epoch: room.epoch, revision: candidate.revision, graceful: false });
  room.offerTimer = setTimeout(() => {
    send(candidate.ws, { type: 'continue_offer_expired', epoch: room.epoch, graceful: false });
    nextOffer(room);
  }, config.offerMs).unref();
}
function hostGone(room) {
  if (!rooms.has(room.code) || room.hostId && connected(room, room.peers.get(room.hostId))) return;
  room.migrating = true; room.tried = new Set();
  broadcast(room, { type: 'owner_lost', epoch: room.epoch });
  nextOffer(room);
}
function onDeparture(peer, ws) {
  const room = peer.room;
  if (peer.ws !== ws || !rooms.has(room.code)) return;
  peer.ws = null; peer.offlineAt = Date.now();
  // An explicit leave releases a guest seat at once; a crash keeps it for reconnect.
  const removed = !!peer.leaving && room.hostId !== peer.id;
  if (removed) room.peers.delete(peer.id);
  broadcast(room, { type: 'peer_left', maxPeers:roomCapacity(room,config.maxPeers), peerId: peer.id, epoch: room.epoch, ...(removed ? { removed: true } : {}) });
  if (room.hostId === peer.id) {
    broadcast(room, { type: 'owner_lost', epoch: room.epoch });
    clearTimeout(room.hostGraceTimer);
    // A host that chose to leave will not return: offer the world immediately.
    if (peer.leaving) hostGone(room);
    else room.hostGraceTimer = setTimeout(() => hostGone(room), config.disconnectGraceMs).unref();
  } else if (room.offer?.peerId === peer.id) nextOffer(room);
  touch(room);
  log('peer_disconnected', { room: room.code, peerId: peer.id, host: room.hostId === peer.id });
}
function bucket(map, key, limit, intervalMs) {
  const now = Date.now(); const entry = map.get(key) || { tokens: limit, at: now, limit };
  // New host edges need an immediate bounded ICE burst, not ten seconds of refill
  // at the old one-edge capacity. Shrinking membership clamps the budget again.
  entry.tokens = Math.min(limit, entry.tokens + Math.max(0,limit-(entry.limit??limit)) + (now - entry.at) * limit / intervalMs); entry.at = now; entry.limit = limit;
  map.set(key, entry); if (entry.tokens < 1) return false; entry.tokens -= 1; return true;
}
function validName(v) { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 24 && !/[\u0000-\u001f<>]/.test(v); }
function validRole(v) { return v === 'hero' || v === 'god'; }
function attach(ws, room, peer) {
  if (peer.ws && peer.ws !== ws) peer.ws.close(4001, 'Session replaced');
  peer.ws = ws; ws.peer = peer; peer.lastSeen = Date.now(); peer.leaving = false; touch(room);
  if (room.hostId === peer.id) clearTimeout(room.hostGraceTimer);
  if (room.hostId === peer.id && !room.migrating) clearOffer(room);
  welcome(peer, room);
  broadcast(room, { type: 'peer_joined', maxPeers:roomCapacity(room,config.maxPeers), peer: publicPeer(peer), epoch: room.epoch }, ws);
  if (room.migrating && !room.offer && peer.desktop && peer.revision >= 0) { room.tried.delete(peer.id); nextOffer(room); }
  log('peer_connected', { room: room.code, peerId: peer.id, role: peer.role, host: room.hostId === peer.id });
}
function handle(ws, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(ws, 'bad_message', 'Invalid message.');
  const edges = ws.peer && ws.peer.id === ws.peer.room.hostId ? Math.max(1,Math.min(config.maxPeers-1,[...ws.peer.room.peers.values()].filter(p=>connected(ws.peer.room,p)).length-1)) : 1;
  if (!bucket(ws.rate, 'messages', SIGNAL_MESSAGES_PER_EDGE * edges, 10_000)) return ws.close(1008, 'Rate limit');
  if (!ws.peer) {
    if (message.type !== 'create' && message.type !== 'join') return fail(ws, 'not_joined', 'Create or join a room first.');
    if (!validName(message.name) || !validRole(message.role)) return fail(ws, 'invalid_identity', 'Choose a valid name and role.');
    const capacity=clientCapacity(message.simCapacity);
    if (message.type === 'create') {
      if (!bucket(ipBuckets, ws.ip, 12, 60_000)) return fail(ws, 'rate_limited', 'Too many room requests.');
      if (rooms.size >= config.maxRooms) return fail(ws, 'server_full', 'Room service is full.');
      let roomCode; do roomCode = code(); while (rooms.has(roomCode));
      const room = { code: roomCode, peers: new Map(), hostId: null, epoch: 1, created: Date.now(), lastActivity: Date.now(), tried: new Set(), offer: null, migrating: false };
      const peer = { id: secret().slice(0, 16), secret: secret(), name: message.name.trim(), role: message.role, desktop: message.desktop === true, simCapacity:capacity, revision: -1, ws: null, room };
      room.hostId = peer.id; room.peers.set(peer.id, peer); rooms.set(roomCode, room); attach(ws, room, peer);
      log('room_created', { room: roomCode }); return;
    }
    if (!bucket(ipBuckets, `join:${ws.ip}`, 40, 60_000)) return fail(ws, 'rate_limited', 'Too many join attempts. Please wait a moment.');
    const roomCode = String(message.room || '').replace(/[\s-]/g, '');
    if (!/^\d{8}$/.test(roomCode)) return fail(ws, 'invalid_room', 'Enter the eight-digit room code.');
    const room = rooms.get(roomCode);
    if (!room) return fail(ws, 'room_not_found', 'Room not found or expired.');
    if (message.secret) {
      const peer = [...room.peers.values()].find(p => safeEqual(p.secret, message.secret));
      if (!peer) return fail(ws, 'invalid_secret', 'This reconnect credential is invalid.');
      if (capacity<room.peers.size) return fail(ws,'client_update_required','Refresh the game before rejoining: this world has more players than your version supports.');
      peer.simCapacity=capacity; peer.name = message.name.trim(); peer.role = message.role; peer.desktop = message.desktop === true;
      attach(ws, room, peer); return;
    }
    if (capacity<roomCapacity(room,config.maxPeers)) return fail(ws,'client_update_required','Refresh the game to join this 32-player world, then enter the room code again.');
    const limit=roomCapacity(room,config.maxPeers);
    if (room.peers.size >= limit) {
      // Crashed or reloaded guests keep a seat; reclaim the longest-offline one for a new arrival.
      const now = Date.now();
      const stale = [...room.peers.values()].filter(p => p.id !== room.hostId && !p.ws && room.offer?.peerId !== p.id && now - (p.offlineAt || 0) >= config.evictOfflineMs)
        .sort((a, b) => (a.offlineAt || 0) - (b.offlineAt || 0))[0];
      if (!stale || room.peers.size>limit) return fail(ws, 'room_full', `All ${limit} seats are occupied or reconnecting. Choose another world or retry shortly.`);
      room.peers.delete(stale.id);
      broadcast(room, { type: 'peer_left', maxPeers:roomCapacity(room,config.maxPeers), peerId: stale.id, epoch: room.epoch, removed: true });
      log('peer_evicted', { room: room.code, peerId: stale.id });
    }
    const peer = { id: secret().slice(0, 16), secret: secret(), name: message.name.trim(), role: message.role, desktop: message.desktop === true, simCapacity:capacity, revision: -1, ws: null, room };
    room.peers.set(peer.id, peer); attach(ws, room, peer); return;
  }
  const peer = ws.peer, room = peer.room;
  if (peer.ws !== ws || !rooms.has(room.code)) return;
  touch(room); peer.lastSeen = Date.now();
  if (message.type === 'signal') {
    const target = room.peers.get(message.to);
    if (!connected(room, target) || target.id === peer.id) return fail(ws, 'peer_unavailable', 'That player is unavailable.');
    if (message.epoch !== room.epoch || !['offer','answer','ice'].includes(message.signal?.type)) return fail(ws, 'stale_epoch', 'Room ownership changed.');
    send(target.ws, { type: 'signal', from: peer.id, epoch: room.epoch, signal: message.signal });
  } else if (message.type === 'checkpoint_ready') {
    if (peer.id === room.hostId || !peer.desktop) return;
    if (Number.isSafeInteger(message.revision) && message.revision >= 0) {
      peer.revision = message.revision;
      if (room.migrating && !room.offer) nextOffer(room);
    }
  } else if (message.type === 'transfer_host') {
    if (peer.id !== room.hostId) return fail(ws, 'not_host', 'Only the host can transfer ownership.');
    const target = room.peers.get(message.to);
    if (!target?.desktop || !connected(room, target) || target.revision < 0) return fail(ws, 'no_checkpoint', 'That desktop player needs a checkpoint before transfer.');
    if (clientCapacity(target.simCapacity)<room.peers.size) return fail(ws,'client_update_required','That player must refresh the game before hosting this many players.');
    clearOffer(room); room.offer = { peerId: target.id, epoch: room.epoch, graceful: true };
    send(target.ws, { type: 'continue_world_offer', epoch: room.epoch, revision: target.revision, graceful: true });
    room.offerTimer = setTimeout(() => { send(target.ws, { type: 'continue_offer_expired', epoch: room.epoch, graceful: true }); clearOffer(room); send(peer.ws, { type: 'transfer_timeout' }); }, config.offerMs).unref();
  } else if (message.type === 'continue_world') {
    if (!room.offer || room.offer.peerId !== peer.id || message.epoch !== room.epoch || peer.revision < 0) return fail(ws, 'no_offer', 'No current world continuation offer.');
    if (clientCapacity(peer.simCapacity)<room.peers.size) return fail(ws,'client_update_required','Refresh the game before hosting this many players.');
    clearOffer(room); clearTimeout(room.hostGraceTimer); room.migrating = false;
    const previousHostId = room.hostId; room.hostId = peer.id; room.epoch++;
    broadcast(room, { type: 'host_changed', maxPeers:roomCapacity(room,config.maxPeers), hostId: peer.id, previousHostId, epoch: room.epoch });
    log('host_changed', { room: room.code, hostId: peer.id, epoch: room.epoch });
  } else if (message.type === 'decline_world') {
    if (room.offer?.peerId !== peer.id) return;
    const graceful = room.offer.graceful; clearOffer(room);
    if (graceful) send(room.peers.get(room.hostId)?.ws, { type: 'transfer_declined', peerId: peer.id });
    else nextOffer(room);
  } else if (message.type === 'retry_world') {
    if (!room.migrating || room.offer || connected(room, room.peers.get(room.hostId))) return;
    room.tried.clear(); nextOffer(room);
  } else if (message.type === 'leave') {
    peer.leaving = true; ws.close(1000, 'Left room');
  } else if (message.type === 'ping') send(ws, { type: 'pong', at: message.at });
  else fail(ws, 'unknown_type', 'Unsupported message.');
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/peer/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: [...rooms.values()].reduce((n,r) => n + [...r.peers.values()].filter(p => connected(r,p)).length, 0), uptimeSeconds: Math.floor(process.uptime()) }));
  } else if (req.method === 'GET' && req.url === '/peer/config') {
    const origin = req.headers.origin;
    if (!config.origins.includes(origin)) { res.writeHead(403); res.end(); return; }
    res.setHeader('access-control-allow-origin', origin);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ protocol: 1, maxPeers: config.maxPeers, iceServers: iceServers(`config-${secret().slice(0,12)}`), relayConfigured: !!(config.turnUrl && config.turnSecret) }));
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (req.url !== '/peer/ws' || !config.origins.includes(origin)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  const ip = req.socket.remoteAddress || 'unknown';
  if (!bucket(ipBuckets, `upgrade:${ip}`, MAX_PLAYERS * 2, 60_000)) { socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { ws.ip = ip; ws.rate = new Map(); ws.lastPong = Date.now(); wss.emit('connection', ws); });
});
wss.on('connection', ws => {
  ws.on('pong', () => { ws.lastPong = Date.now(); if (ws.peer) touch(ws.peer.room); });
  ws.on('message', raw => { try { handle(ws, JSON.parse(raw.toString())); } catch { fail(ws, 'bad_json', 'Invalid JSON.'); } });
  ws.on('close', () => { if (ws.peer) onDeparture(ws.peer, ws); });
  ws.on('error', error => log('socket_error', { message: error.message }));
});
const maintenance = setInterval(() => {
  const now = Date.now();
  if (rooms.size > 0) lastRoomTime = now;
  for (const ws of wss.clients) { if (now - ws.lastPong > 90_000) ws.terminate(); else ws.ping(); }
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) if (!peer.ws && peer.id !== room.hostId && room.offer?.peerId !== peer.id && now - (peer.lastSeen || room.created) > 60_000) {
      room.peers.delete(peer.id);
      broadcast(room,{type:'peer_left',peerId:peer.id,epoch:room.epoch,removed:true,maxPeers:roomCapacity(room,config.maxPeers)});
    }
    if (now - room.lastActivity > config.idleMs || now - room.created > config.maxAgeMs) {
      clearOffer(room); clearTimeout(room.hostGraceTimer); broadcast(room, { type: 'room_expired' });
      for (const peer of room.peers.values()) peer.ws?.close(4000, 'Room expired'); rooms.delete(room.code); log('room_expired', { room: room.code });
    }
  }
  for (const [key, entry] of ipBuckets) if (now - entry.at > 5 * 60_000) ipBuckets.delete(key);
  if (config.shutdownIdleMs > 0 && rooms.size === 0 && now - lastRoomTime >= config.shutdownIdleMs) shutdown('idle');
}, 30_000).unref();
let lastRoomTime = Date.now();
function shutdown(signal) {
  log('shutdown', { signal }); clearInterval(maintenance);
  for (const ws of wss.clients) ws.close(1001, 'Server shutdown');
  server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
server.listen(config.port, config.host, () => log('startup', { host: config.host, port: config.port, origins: config.origins, maxPeers: config.maxPeers, relayConfigured: !!(config.turnUrl && config.turnSecret) }));
