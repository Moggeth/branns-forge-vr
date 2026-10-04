import { DurableObject } from 'cloudflare:workers';
import {clientCapacity,roomCapacity} from '../peer/room-capacity.js';
import {roomListing, DIRECTORY_REFRESH} from './room-directory.js';
import {MAX_PLAYERS, MAX_PENDING_ROOM_SOCKETS, OFFLINE_SEAT_GRACE_MS, SIGNAL_MESSAGES_PER_EDGE, RELAY_BYTES_PER_EDGE, RELAY_MESSAGES_PER_EDGE} from '../shared/multiplayer-limits.js';
export {ForgeDirectory} from './directory.js';

// One hibernating coordinator per room. Simulation and saves stay on players' devices.
// Direct WebRTC is preferred; bounded opaque WebSocket frames can bridge restrictive NATs.
const MAX_PEERS = MAX_PLAYERS, MAX_AGE = 8 * 3600_000, EMPTY_AGE = 30 * 60_000;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const roomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, '0');
const send = (ws, m) => { try { ws?.send(JSON.stringify(m)); } catch { /* departure handled by socket event */ } };
const error = (ws, code, message, context = {}) => send(ws, { type: 'error', code, message, ...context });
const cleanCode = v => String(v || '').replace(/[\s-]/g, '');
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/peer/health') return json({ ok: true, service: 'cloud-rooms', protocol: 1, maxPeers: MAX_PEERS, relay: 'bounded-websocket' });
    if (url.pathname === '/peer/rooms') {
      const origin = request.headers.get('Origin');
      if (origin && !(env.ALLOWED_ORIGINS || '').split(',').includes(origin)) return new Response('Origin denied', {status:403});
      const headers = {'cache-control':'no-store',vary:'Origin',...(origin?{'access-control-allow-origin':origin}:{})};
      if (request.method !== 'GET') return new Response('Use GET to browse rooms',{status:405,headers});
      if (env.DIRECTORY_LIMIT && !(await env.DIRECTORY_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'local'})).success)
        return Response.json({error:'Please wait a minute, then refresh the world list.'},{status:429,headers});
      const cursor=url.searchParams.get('cursor') || '';
      if (cursor && !/^room:\d{8}$/.test(cursor)) return Response.json({error:'Refresh the world list to start again.'},{status:400,headers});
      const result=await env.DIRECTORY.get(env.DIRECTORY.idFromName('public')).fetch('https://directory/list?cursor='+encodeURIComponent(cursor));
      return new Response(result.body,{status:result.status,headers:{...headers,'content-type':'application/json'}});
    }
    if (url.pathname !== '/peer/cloud') return new Response('Not found', { status: 404 });
    if (!(env.ALLOWED_ORIGINS || '').split(',').includes(request.headers.get('Origin'))) return new Response('Origin denied', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (env.JOIN_LIMIT && !(await env.JOIN_LIMIT.limit({ key: ip })).success) return new Response('Please wait before joining again', { status: 429 });
    const requested = url.searchParams.get('room');
    if (requested && !/^\d{8}$/.test(cleanCode(requested))) return new Response('Invalid room code', { status: 400 });
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = requested ? cleanCode(requested) : roomCode();
      const target = new URL(request.url); target.searchParams.set('room', code); target.searchParams.set('mode', requested ? 'join' : 'create');
      const response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(target, request));
      if (response.status !== 409 || requested) return response;
    }
    return new Response('Please try again', { status: 503 });
  }
};

export class ForgeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx; this.env = env; this.room = null; this.sockets = new Map();
    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room') || null;
      for (const ws of ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a?.id) this.sockets.set(a.id, ws); }
    });
    // Ping frames handled by the runtime do not wake a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  online(id) { return this.sockets.get(id)?.readyState === 1; }
  peers() { return this.room?.peers || []; }
  publicPeer(p) { return { id: p.id, name: p.name, role: p.role, desktop: p.desktop, online: this.online(p.id), checkpointRevision: p.revision }; }
  broadcast(message, except) { for (const [id, ws] of this.sockets) if (id !== except) send(ws, message); }
  seatReleaseDeadlines() {
    const r=this.room;
    if(!r||r.peers.length<roomCapacity(r))return [];
    return r.peers.filter(p=>p.id!==r.hostId&&p.id!==r.offer?.peerId&&!this.online(p.id))
      .map(p=>p.offlineAt+OFFLINE_SEAT_GRACE_MS);
  }
  async updateDirectory(force = false) {
    if (!this.env.DIRECTORY || !this.room) return;
    const now=Date.now();
    const seatReleased=this.seatReleaseDeadlines().some(at=>at<=now&&at>(this.directoryAt||0));
    if (!force && !seatReleased && now-(this.directoryAt || 0)<DIRECTORY_REFRESH) return;
    this.directoryAt=now;
    try {
      const result=await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('public')).fetch('https://directory/update',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:this.room.code,listing:roomListing(this.room,id=>this.online(id),now)})
      });
      if (!result.ok) throw new Error('directory_update_failed');
    } catch { console.warn(JSON.stringify({event:'directory_update_failed',room:this.room.code})); }
  }
  async save() { if (this.room) await this.ctx.storage.put('room', this.room); }
  async schedule() {
    const r = this.room; const now = Date.now();
    const pending = this.ctx.getWebSockets().filter(ws => !ws.deserializeAttachment()?.id).map(ws => (ws.deserializeAttachment()?.opened || now) + 12000);
    const deadlines = [...pending];
    if (r) {
      deadlines.push(r.created + MAX_AGE);
      if (this.sockets.size && this.env.DIRECTORY) deadlines.push((this.directoryAt || now) + DIRECTORY_REFRESH);
      // A full room becomes joinable after the short reconnect reservation,
      // not only after the next minute-long directory heartbeat.
      if (this.env.DIRECTORY) deadlines.push(...this.seatReleaseDeadlines().filter(at=>at>now));
      if (!this.sockets.size) deadlines.push(r.lastActivity + EMPTY_AGE);
      if (r.graceAt) deadlines.push(r.graceAt);
      if (r.offer) deadlines.push(r.offer.expires);
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(now + 50, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    const url = new URL(request.url), create = url.searchParams.get('mode') === 'create';
    if (create && (this.room || this.ctx.getWebSockets().length)) return new Response('Occupied', { status: 409 });
    // A bounded pending socket lets the existing client receive a useful room_not_found error.
    if (this.ctx.getWebSockets().length >= MAX_PEERS + MAX_PENDING_ROOM_SOCKETS) return new Response('Room busy; wait a moment and retry.', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ opened: Date.now(), mode: create ? 'create' : 'join', code: url.searchParams.get('room'), messages: 0, at: Date.now() });
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }
  async attach(ws, p) {
    const r = this.room, old = this.sockets.get(p.id);
    if (old && old !== ws) old.close(4001, 'Session replaced');
    this.sockets.set(p.id, ws); p.offlineAt = 0; p.leaving = false;
    ws.serializeAttachment({ ...ws.deserializeAttachment(), id: p.id });
    r.lastActivity = Date.now();
    if (p.id === r.hostId) { r.graceAt = 0; if (!r.offer?.graceful) { r.offer = null; r.migrating = false; r.tried = []; } }
    await this.save();
    await this.updateDirectory(true);
    send(ws, { type: 'welcome', protocol: 1, room: r.code, peerId: p.id, secret: p.secret, role: p.role, hostId: r.hostId, epoch: r.epoch,
      maxPeers: roomCapacity(r), peers: this.peers().filter(q => q.id !== p.id).map(q => this.publicPeer(q)),
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }], relayConfigured: true, relayTransport: 'websocket' });
    this.broadcast({ type: 'peer_joined', maxPeers:roomCapacity(r), peer: this.publicPeer(p), epoch: r.epoch }, p.id);
    await this.schedule();
    console.log(JSON.stringify({ event: 'peer_connected', room: r.code, count: this.sockets.size }));
  }
  async nextOffer() {
    const r = this.room; r.offer = null;
    const candidate = this.peers().filter(p => p.id !== r.hostId && p.desktop && clientCapacity(p.simCapacity)>=r.peers.length && p.revision >= 0 && this.online(p.id) && !r.tried.includes(p.id))
      .sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))[0];
    if (!candidate) this.broadcast({ type: 'world_waiting', epoch: r.epoch, message: 'Waiting for a desktop player with a recovery checkpoint.' });
    else {
      r.tried.push(candidate.id); r.offer = { peerId: candidate.id, epoch: r.epoch, graceful: false, expires: Date.now() + Number(this.env.OFFER_MS || 120000) };
      send(this.sockets.get(candidate.id), { type: 'continue_world_offer', epoch: r.epoch, revision: candidate.revision, graceful: false });
    }
    await this.save(); await this.schedule();
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 32768) return ws.close(1009, 'Message too large');
    let m; try { m = JSON.parse(raw); } catch { return error(ws, 'bad_json', 'Invalid JSON.'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return error(ws, 'bad_message', 'Invalid message.');
    const a = ws.deserializeAttachment(), now = Date.now();
    if (now - a.at > 10000) { a.at = now; a.messages = 0; }
    const edges = a.id === this.room?.hostId ? Math.max(1,Math.min(MAX_PEERS-1,this.sockets.size-1)) : 1;
    if (m.type !== 'relay') { if (++a.messages > SIGNAL_MESSAGES_PER_EDGE * edges) return ws.close(1008, 'Rate limit'); ws.serializeAttachment(a); }
    if (!a.id) {
      if (!['create', 'join'].includes(m.type)) return error(ws, 'not_joined', 'Create or join first.');
      if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 24 || /[\u0000-\u001f<>]/.test(m.name) || !['hero', 'god'].includes(m.role)) return error(ws, 'invalid_identity', 'Choose a valid name and role.');
      if (m.type !== a.mode) return error(ws, 'invalid_room', 'Please reconnect to this room.');
      if (m.type === 'create') {
        if (this.room) return error(ws, 'room_exists', 'Please try creating again.');
        this.room = { code: a.code, peers: [], hostId: '', epoch: 1, created: now, lastActivity: now, tried: [], migrating: false, offer: null, graceAt: 0 };
      } else if (cleanCode(m.room) !== a.code || !/^\d{8}$/.test(a.code)) return error(ws, 'invalid_room', 'Enter the eight-digit room code.');
      else if (!this.room) return error(ws, 'room_not_found', 'Room not found or expired.');
      const r = this.room, capacity=clientCapacity(m.simCapacity);
      if (m.secret) {
        const p = this.peers().find(q => q.secret === m.secret);
        if (!p) return error(ws, 'invalid_secret', 'This reconnect credential expired.');
        if (capacity<r.peers.length) return error(ws,'client_update_required','Refresh the game before rejoining: this world has more players than your version supports.');
        p.simCapacity=capacity; p.name = m.name.trim(); p.role = m.role; p.desktop = m.desktop === true;
        return this.attach(ws, p);
      }
      if (r.peers.length && capacity<roomCapacity(r)) return error(ws,'client_update_required','Refresh the game to join this 32-player world, then enter the room code again.');
      const limit=roomCapacity(r);
      if (this.peers().length >= limit) {
        const stale = this.peers().filter(p => p.id !== r.hostId && p.id !== r.offer?.peerId && !this.online(p.id) && now - p.offlineAt >= OFFLINE_SEAT_GRACE_MS).sort((a, b) => a.offlineAt - b.offlineAt)[0];
        if (!stale || r.peers.length>limit) return error(ws, 'room_full', `All ${limit} seats are occupied or reconnecting. Choose another world or retry shortly.`);
        r.peers = r.peers.filter(p => p !== stale); this.broadcast({ type: 'peer_left', maxPeers:roomCapacity(r), peerId: stale.id, epoch: r.epoch, removed: true });
      }
      const p = { id: token().slice(0, 16), secret: token(), name: m.name.trim(), role: m.role, desktop: m.desktop === true, simCapacity:capacity, revision: -1, offlineAt: 0 };
      r.peers.push(p); if (!r.hostId) r.hostId = p.id;
      return this.attach(ws, p);
    }
    const r = this.room, p = this.peers().find(q => q.id === a.id);
    if (!r || !p || this.sockets.get(p.id) !== ws) return;
    await this.updateDirectory();
    if (m.type === 'signal' || m.type === 'relay' || m.type === 'relay_request') {
      if (m.epoch !== r.epoch) return error(ws, 'stale_epoch', 'Room ownership changed.', { expectedEpoch: r.epoch });
      if (!this.online(m.to)) {
        // Late ICE/relay frames are normal during a leave or handoff. Membership events already
        // explain the departure; do not turn each queued frame into a user-visible error.
        if (this.peers().some(q => q.id === m.to) && ['signal','relay'].includes(m.type)) return;
        return error(ws, 'peer_unavailable', 'That player is unavailable.', { peerId: m.to });
      }
      if (m.to === p.id) return error(ws, 'peer_unavailable', 'That player is unavailable.');
      if (p.id !== r.hostId && m.to !== r.hostId) return error(ws, 'invalid_route', 'Game connections must go through the host.');
      if (m.type === 'signal' && !['offer', 'answer', 'ice'].includes(m.signal?.type)) return error(ws, 'bad_message', 'Invalid signal.');
      if (m.type === 'relay') {
        if (typeof m.frame !== 'string' || m.frame.length > 25000) return ws.close(1009, 'Relay frame too large');
        // Scale the host's bounded budget to its actual online edges; guests still have one.
        if (now - (a.relayAt || 0) >= 1000) { a.relayAt = now; a.relayBytes = 0; a.relayMessages = 0; }
        a.relayBytes = (a.relayBytes || 0) + m.frame.length; a.relayMessages = (a.relayMessages || 0) + 1;
        if (a.relayBytes > edges * RELAY_BYTES_PER_EDGE || a.relayMessages > edges * RELAY_MESSAGES_PER_EDGE) return ws.close(1008, 'Relay budget exceeded');
        ws.serializeAttachment(a);
      }
      send(this.sockets.get(m.to), { type: m.type, from: p.id, epoch: r.epoch, ...(m.type === 'signal' ? { signal: m.signal } : m.type === 'relay' ? { frame: m.frame } : {}) });
      return;
    }
    if (m.type === 'checkpoint_ready') {
      if (p.id !== r.hostId && p.desktop && Number.isSafeInteger(m.revision) && m.revision >= 0) {
        p.revision = m.revision;
        if (r.migrating && !r.offer) { r.tried = r.tried.filter(id => id !== p.id); return this.nextOffer(); }
        await this.save();
      }
      return;
    } else if (m.type === 'transfer_host') {
      if (p.id !== r.hostId) return error(ws, 'not_host', 'Only the host can transfer ownership.');
      const target = this.peers().find(q => q.id === m.to && q.desktop && q.revision >= 0 && this.online(q.id));
      if (target && clientCapacity(target.simCapacity)<r.peers.length) return error(ws,'client_update_required','That player must refresh the game before hosting this many players.');
      if (!target || target.id === p.id) return error(ws, 'no_checkpoint', 'That player needs a checkpoint first.');
      r.offer = { peerId: target.id, epoch: r.epoch, graceful: true, expires: now + Number(this.env.OFFER_MS || 120000) };
      send(this.sockets.get(target.id), { type: 'continue_world_offer', epoch: r.epoch, revision: target.revision, graceful: true });
    } else if (m.type === 'continue_world') {
      if (r.offer?.peerId !== p.id || m.epoch !== r.epoch || p.revision < 0) return error(ws, 'no_offer', 'No current continuation offer.');
      if (clientCapacity(p.simCapacity)<r.peers.length) return error(ws,'client_update_required','Refresh the game before hosting this many players.');
      const previousHostId = r.hostId; r.hostId = p.id; r.epoch++; r.offer = null; r.migrating = false; r.graceAt = 0;
      await this.save(); await this.updateDirectory(true); this.broadcast({ type: 'host_changed', maxPeers:roomCapacity(r), hostId: p.id, previousHostId, epoch: r.epoch });
    } else if (m.type === 'decline_world') {
      if (r.offer?.peerId !== p.id) return;
      const graceful = r.offer.graceful; r.offer = null;
      if (graceful) send(this.sockets.get(r.hostId), { type: 'transfer_declined', peerId: p.id });
      else await this.nextOffer();
    } else if (m.type === 'retry_world') {
      if (r.migrating && !r.offer && !this.online(r.hostId)) { r.tried = []; await this.nextOffer(); }
    } else if (m.type === 'leave') { p.leaving = true; await this.depart(ws); ws.close(1000, 'Left room'); return; }
    else if (m.type === 'ping') { send(ws, { type: 'pong', at: m.at }); return; }
    else return error(ws, 'unknown_type', 'Unsupported message.');
    await this.save(); await this.schedule();
  }
  async depart(ws) {
    const id = ws.deserializeAttachment()?.id, r = this.room, p = this.peers().find(q => q.id === id);
    if (!r || !p || this.sockets.get(id) !== ws) { await this.schedule(); return; }
    this.sockets.delete(id); p.offlineAt = Date.now(); r.lastActivity = Date.now();
    const removed = p.leaving && id !== r.hostId;
    if (removed) r.peers = r.peers.filter(q => q !== p);
    this.broadcast({ type: 'peer_left', maxPeers:roomCapacity(r), peerId: id, epoch: r.epoch, removed: !!removed, deliberate: !!p.leaving });
    if (id === r.hostId) {
      this.broadcast({ type: 'owner_lost', epoch: r.epoch, deliberate: !!p.leaving });
      r.graceAt = Date.now() + (p.leaving ? 50 : Number(this.env.DISCONNECT_GRACE_MS || 15000));
    } else if (r.offer?.peerId === id) await this.nextOffer();
    await this.save(); await this.updateDirectory(true); await this.schedule();
  }
  async webSocketClose(ws) { await this.depart(ws); try { ws.close(); } catch {} }
  async webSocketError(ws) { await this.depart(ws); try { ws.close(1011, 'Connection error'); } catch {} }
  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) if (!ws.deserializeAttachment()?.id && now - (ws.deserializeAttachment()?.opened || 0) >= 12000) ws.close(1008, 'Join timeout');
    const r = this.room;
    if (!r) return this.schedule();
    if (now >= r.created + MAX_AGE || (!this.sockets.size && now >= r.lastActivity + EMPTY_AGE)) {
      this.broadcast({ type: 'room_expired' }); for (const ws of this.ctx.getWebSockets()) ws.close(4000, 'Room expired');
      this.sockets.clear(); await this.updateDirectory(true); this.room = null; await this.ctx.storage.deleteAll(); return;
    }
    if (r.graceAt && now >= r.graceAt) {
      r.graceAt = 0;
      if (!this.online(r.hostId)) { r.migrating = true; r.tried = []; await this.nextOffer(); }
    }
    if (r.offer && now >= r.offer.expires) {
      const offer = r.offer; send(this.sockets.get(offer.peerId), { type: 'continue_offer_expired', epoch: r.epoch, graceful: offer.graceful }); r.offer = null;
      if (offer.graceful) send(this.sockets.get(r.hostId), { type: 'transfer_timeout' }); else await this.nextOffer();
    }
    await this.updateDirectory(); await this.save(); await this.schedule();
  }
}
