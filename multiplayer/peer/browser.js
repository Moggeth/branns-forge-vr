// Browser WebRTC star transport. The signaling service sees membership and SDP, never game state.
import {SnapshotDeltaEncoder,SnapshotDeltaDecoder,supportsCodec} from '../client/state-codec.js';
const FRAME_BYTES = 12_000;
const MAX_MESSAGE_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const preparedOwner = new WeakMap();
const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }));
const open = channel => channel?.readyState === 'open';
// Pre-welcome rejections that no automatic retry can fix.
const TERMINAL_JOIN_ERRORS = new Set(['room_not_found', 'room_full', 'invalid_room', 'invalid_identity', 'server_full', 'rate_limited']);

export class PeerRoomConnection extends EventTarget {
  get identity() { return { room: this.room, peerId: this.peerId, role: this.role, secret: this.secret }; }
  constructor({ url, iceServers = null } = {}) {
    super();
    this.url = url;
    this.iceServers = iceServers;
    this.socket = null;
    this.peers = new Map();
    this.roster = new Map();
    this.room = ''; this.peerId = ''; this.secret = ''; this.hostId = ''; this.epoch = 0;
    this.role = 'hero'; this.isHost = false; this.relayConfigured = false;
    this.checkpoint = null; this.checkpointRevision = -1;
    this.reconnectAttempt = 0; this.closed = true; this.generation = 0;
    this.frameSequence = 0;
    // Independent negotiated recovery stream. Never quantize checkpoints: host
    // migration must recover exact simulation state, not the display snapshot.
    this.checkpointEncoder = new SnapshotDeltaEncoder({keyframeEvery:20});
    this.checkpointDecoder = new SnapshotDeltaDecoder();
    this.checkpointHelloAt = 0;
  }
  connect({ room = '', name = 'Adventurer', role = 'hero', desktop = true, secret = '' } = {}) {
    this.close();
    this.checkpoint = null; this.checkpointRevision = -1;
    this.peerId = ''; this.hostId = ''; this.epoch = 0; this.isHost = false; this.roster.clear();
    this.checkpointAdvertisedAt = 0;
    this.closed = false; this.room = room.toUpperCase(); this.secret = secret;
    this.name = name; this.role = role; this.desktop = desktop === true;
    this.reconnectAttempt = 0; this.#openSocket();
  }
  #signal(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  #openSocket() {
    if (this.closed) return;
    const generation = ++this.generation;
    emit(this, 'status', { state: this.peerId ? 'signaling_reconnecting' : 'connecting', playable: this.#playable() });
    let socket;
    try {
      const endpoint = new URL(this.url);
      if (endpoint.pathname === '/peer/cloud' && this.room) endpoint.searchParams.set('room', this.room);
      socket = new WebSocket(endpoint.href);
    } catch (error) { emit(this, 'error', { code: 'invalid_endpoint', message: String(error) }); return; }
    this.socket = socket; this.joined = false;
    const timeout = setTimeout(() => { if (generation === this.generation) socket.close(4000, 'Signaling timeout'); }, 12_000);
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return socket.close();
      this.#signal(this.room ? { type: 'join', room: this.room, name: this.name, role: this.role, desktop: this.desktop, ...(this.secret ? { secret: this.secret } : {}) }
        : { type: 'create', name: this.name, role: this.role, desktop: this.desktop });
    });
    socket.addEventListener('message', event => {
      if (generation !== this.generation || typeof event.data !== 'string' || event.data.length > 64 * 1024) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        const resume = this.peerId === message.peerId && this.epoch === message.epoch && this.hostId === message.hostId;
        if (!resume) this.#resetPeers();
        clearTimeout(timeout); this.reconnectAttempt = 0; this.joined = true;
        this.room = message.room; this.peerId = message.peerId; this.secret = message.secret;
        this.hostId = message.hostId; this.epoch = message.epoch; this.isHost = this.hostId === this.peerId;
        this.iceServers = this.iceServers || message.iceServers;
        this.relayConfigured = !!message.relayConfigured;
        this.relayTransport = message.relayTransport;
        this.roster = new Map((message.peers || []).map(peer => [peer.id, peer]));
        for (const [id, peer] of this.peers) if (open(peer.channel) && !peer.relay && this.roster.has(id)) {
          const member = this.roster.get(id); member.signalingOnline = member.online; member.online = true;
        }
        this.roster.set(this.peerId, { id: this.peerId, name: this.name, role: this.role, desktop: this.desktop, online: true });
        emit(this, 'welcome', { room: this.room, peerId: this.peerId, secret: this.secret, epoch: this.epoch, hostId: this.hostId, role: this.role, isHost: this.isHost, peers: [...this.roster.values()], relayConfigured: this.relayConfigured, resume });
        emit(this, 'roster', { peers: [...this.roster.values()], epoch: this.epoch });
        emit(this, 'status', { state: this.isHost ? 'hosting' : this.#playable() ? 'connected' : 'connecting_to_host', relayConfigured: this.relayConfigured });
        if (!this.isHost && this.roster.get(this.hostId)?.online === false) emit(this, 'owner_lost', { epoch: this.epoch });
        if (this.isHost) for (const peer of this.roster.values()) if (peer.id !== this.peerId && peer.online) this.#connectPeer(peer.id, true);
        if (!this.isHost && this.checkpointRevision >= 0) this.#signal({ type: 'checkpoint_ready', revision: this.checkpointRevision });
        clearInterval(this.heartbeat);
        if (this.relayTransport === 'websocket') this.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping'); }, 30000);
        clearInterval(this.liveness);
        this.liveness = setInterval(() => {
          const host = this.peers.get(this.hostId);
          if (this.isHost || !host?.everReady || host.awaitingHost || this.#playable()) return;
          host.awaitingHost = true;
          emit(this, 'owner_lost', { epoch: this.epoch }); emit(this, 'status', { state: 'owner_lost' }); this.retryWorld();
        }, 1000);
      } else this.#handleSignal(message);
    });
    socket.addEventListener('close', event => {
      clearTimeout(timeout);
      if (generation !== this.generation || this.closed) return;
      clearInterval(this.heartbeat);
      if ([1008,1009,4001].includes(event.code)) { this.#resetPeers(); this.closed = true; emit(this, 'error', { code: 'signaling_rejected', message: 'Room connection was rejected.' }); emit(this, 'status', { state: 'disconnected' }); return; }
      // Keep healthy direct edges. Relay edges and unfinished negotiations need a fresh handshake.
      for (const [id, peer] of this.peers) if (peer.relay || !open(peer.channel)) this.#removePeer(id);
      emit(this, 'status', { state: 'signaling_reconnecting', playable: this.#playable() });
      if (!this.secret) { this.closed = true; emit(this, 'error', { code: 'signaling_unavailable', message: 'Could not create a room.' }); return; }
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.reconnectAttempt++, 5));
      this.reconnectTimer = setTimeout(() => this.#openSocket(), delay);
    });
    socket.addEventListener('error', () => { if (generation === this.generation) emit(this, 'status', { state: 'signaling_reconnecting', playable: this.#playable() }); });
  }
  #playable() {
    const host = this.peers.get(this.hostId);
    // RTC can report an open data channel for tens of seconds after a tab/device disappears.
    // Actual recent host traffic, not that stale flag, decides whether migration is unnecessary.
    return !!this.peerId && (this.isHost || (host && Date.now() - (host.receivedAt || 0) < 4000 &&
      (host.relay ? this.socket?.readyState === WebSocket.OPEN : open(host.channel))));
  }
  #handleSignal(message) {
    if (message.type === 'error') {
      // Frames already in flight during a handoff/departure must not produce error toasts.
      if (message.code === 'stale_epoch' && message.expectedEpoch === this.epoch) return;
      if (message.code === 'peer_unavailable' && message.peerId && (!this.roster.get(message.peerId)?.online || this.roster.get(message.peerId)?.signalingOnline === false)) return;
      if (!this.joined && message.code === 'invalid_secret' && this.secret) {
        // The seat expired (offline too long or reclaimed by a full room). Join again as a new player
        // instead of retrying a dead credential forever.
        this.secret = '';
        emit(this, 'status', { state: 'rejoining', reason: 'seat_expired' });
        this.#signal({ type: 'join', room: this.room, name: this.name, role: this.role, desktop: this.desktop });
        return;
      }
      emit(this, 'error', message);
      if (!this.joined && TERMINAL_JOIN_ERRORS.has(message.code)) this.close();
      return;
    }
    if (message.type === 'peer_joined') {
      if (message.epoch !== this.epoch) return;
      this.roster.set(message.peer.id, message.peer);
      emit(this, 'peer_joined', message.peer); emit(this, 'roster', { peers: [...this.roster.values()], epoch: this.epoch });
      if (this.isHost) this.#connectPeer(message.peer.id, true);
    } else if (message.type === 'peer_left') {
      if (message.epoch !== this.epoch) return;
      const edge = this.peers.get(message.peerId);
      if (!message.deliberate && !message.removed && !edge?.relay && open(edge?.channel)) {
        const member = this.roster.get(message.peerId); if (member) member.signalingOnline = false; return;
      }
      const peer = this.roster.get(message.peerId); if (peer) peer.online = false;
      if (message.removed === true && message.peerId !== this.peerId) this.roster.delete(message.peerId);
      this.#removePeer(message.peerId);
      emit(this, 'peer_left', { peerId: message.peerId }); emit(this, 'roster', { peers: [...this.roster.values()], epoch: this.epoch });
    } else if (message.type === 'signal') {
      if (message.epoch !== this.epoch || !this.roster.has(message.from)) return;
      this.#receiveSignal(message.from, message.signal).catch(error => emit(this, 'error', { code: 'webrtc_signal', message: String(error) }));
    } else if (message.type === 'owner_lost') {
      if (message.epoch !== this.epoch) return;
      if (!message.deliberate && this.#playable()) return;
      emit(this, 'owner_lost', { epoch: this.epoch }); emit(this, 'status', { state: 'owner_lost' });
    } else if (message.type === 'continue_world_offer') {
      // A signaling-only failure is not a failed game host. Never fork a healthy authority.
      if (!message.graceful && this.#playable()) return this.declineWorld();
      if (message.epoch !== this.epoch || this.checkpointRevision < message.revision || !this.desktop) return this.declineWorld();
      emit(this, 'continue_world_offer', { epoch: this.epoch, revision: message.revision, graceful: !!message.graceful, checkpoint: this.checkpoint });
    } else if (message.type === 'host_changed') {
      if (message.epoch !== this.epoch + 1) return;
      this.#resetPeers(); this.epoch = message.epoch; this.hostId = message.hostId; this.isHost = this.peerId === this.hostId;
      const host = this.roster.get(this.hostId); if (host) host.online = true;
      emit(this, 'host_changed', { hostId: this.hostId, previousHostId: message.previousHostId, epoch: this.epoch, isHost: this.isHost });
      if (this.isHost) {
        emit(this, 'host_promoted', { epoch: this.epoch, checkpoint: this.checkpoint, revision: this.checkpointRevision, peers: [...this.roster.values()] });
        emit(this, 'status', { state: 'hosting' });
        for (const peer of this.roster.values()) if (peer.id !== this.peerId && peer.online) this.#connectPeer(peer.id, true);
      } else { emit(this, 'status', { state: 'connecting_to_host' }); }
    } else if (message.type === 'world_waiting' && this.#playable()) {
      return;
    } else if (message.type === 'relay_request') {
      if (message.epoch !== this.epoch || !this.roster.has(message.from) || (!this.isHost && message.from !== this.hostId)) return;
      this.#connectPeer(message.from, false);
      if (this.#activateRelay(message.from)) this.#signal({ type: 'relay_request', to: message.from, epoch: this.epoch });
    } else if (message.type === 'relay') {
      if (message.epoch === this.epoch && this.peers.get(message.from)?.relay) this.#receiveData(message.from, message.frame);
    } else if (message.type === 'room_expired') {
      emit(this, 'error', { code: 'room_expired', message: 'This room expired.' }); this.close();
    } else emit(this, message.type, message);
  }
  #connectPeer(id, initiator) {
    if (this.peers.has(id)) return;
    if (typeof RTCPeerConnection !== 'function') { emit(this, 'error', { code: 'webrtc_unavailable', message: 'This browser does not support peer connections.' }); return; }
    const connection = new RTCPeerConnection({ iceServers: this.iceServers || [] });
    const peer = { connection, channel: null, pending: new Map(), epoch: this.epoch, messagesAt: 0, messagesCount: 0, offerSent: !initiator, localIceQueue: [] };
    this.peers.set(id, peer);
    if (this.relayTransport === 'websocket') peer.relayTimer = setTimeout(() => {
      if (this.peers.get(id) === peer && !open(peer.channel) && !peer.relay) this.#signal({ type: 'relay_request', to: id, epoch: this.epoch });
    }, 8000);
    connection.onicecandidate = event => {
      if (!event.candidate || peer.epoch !== this.epoch) return;
      if (!peer.offerSent) { peer.localIceQueue.push(event.candidate); return; }
      this.#signal({ type: 'signal', to: id, epoch: this.epoch, signal: { type: 'ice', candidate: event.candidate } });
    };
    connection.onconnectionstatechange = () => {
      if (['failed','closed','disconnected'].includes(connection.connectionState)) {
        emit(this, 'peer_connection_state', { peerId: id, state: connection.connectionState, relayConfigured: this.relayConfigured });
        if (connection.connectionState === 'failed' && !peer.relay) {
          if (this.relayTransport === 'websocket') this.#signal({ type: 'relay_request', to: id, epoch: this.epoch });
          else this.#removePeer(id);
        }
      }
    };
    connection.ondatachannel = event => this.#bindChannel(id, event.channel);
    if (initiator) {
      const channel = connection.createDataChannel('forge', { ordered: true }); this.#bindChannel(id, channel);
      connection.createOffer().then(offer => connection.setLocalDescription(offer)).then(() => {
        this.#signal({ type: 'signal', to: id, epoch: this.epoch, signal: { type: 'offer', sdp: connection.localDescription } });
        peer.offerSent = true;
        for (const candidate of peer.localIceQueue) this.#signal({ type: 'signal', to: id, epoch: this.epoch, signal: { type: 'ice', candidate } });
        peer.localIceQueue = [];
      })
        .catch(error => emit(this, 'error', { code: 'webrtc_offer', message: String(error) }));
    }
  }
  async #receiveSignal(id, signal) {
    if (!signal || !['offer','answer','ice'].includes(signal.type)) return;
    // Only the server-appointed host can initiate a fresh star edge.
    if (signal.type === 'offer' && id !== this.hostId) return;
    if (signal.type === 'offer') { this.#removePeer(id); this.#connectPeer(id, false); }
    const peer = this.peers.get(id); if (!peer) return;
    if (signal.type === 'offer') {
      await peer.connection.setRemoteDescription(signal.sdp);
      const answer = await peer.connection.createAnswer(); await peer.connection.setLocalDescription(answer);
      this.#signal({ type: 'signal', to: id, epoch: this.epoch, signal: { type: 'answer', sdp: peer.connection.localDescription } });
    } else if (signal.type === 'answer' && this.isHost) await peer.connection.setRemoteDescription(signal.sdp);
    else if (signal.type === 'ice') {
      if (!peer.connection.remoteDescription) { (peer.iceQueue ||= []).push(signal.candidate); return; }
      await peer.connection.addIceCandidate(signal.candidate);
    }
    if (peer.connection.remoteDescription && peer.iceQueue) {
      for (const candidate of peer.iceQueue) await peer.connection.addIceCandidate(candidate);
      peer.iceQueue = null;
    }
  }
  #bindChannel(id, channel) {
    const peer = this.peers.get(id); if (!peer) return;
    peer.channel = channel; channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (peer.epoch !== this.epoch || peer.relay) return;
      clearTimeout(peer.relayTimer); this.#edgeReady(id);
    };
    channel.onclose = () => {
      if (this.peers.get(id) !== peer || peer.relay) return;
      // A failed data channel does not mean the member left the signaling room.
      // Keep the edge until the relay handshake completes; removing it here
      // strands both sides because retry_world cannot replace an online host.
      if (this.relayTransport === 'websocket' && this.roster.get(id)?.online &&
          this.#signal({ type: 'relay_request', to: id, epoch: this.epoch })) {
        emit(this, 'peer_connection_state', { peerId: id, state: 'reconnecting', relayConfigured: this.relayConfigured });
        return;
      }
      this.#removePeer(id);
      const roster = this.roster.get(id); if (roster) roster.online = false;
      emit(this, 'peer_left', { peerId: id });
      emit(this, 'peer_disconnected', { peerId: id });
      if (id === this.hostId) { emit(this, 'owner_lost', { epoch: this.epoch }); emit(this, 'status', { state: 'owner_lost' }); this.retryWorld(); }
    };
    channel.onerror = () => emit(this, 'peer_connection_state', { peerId: id, state: 'error', relayConfigured: this.relayConfigured });
    channel.onmessage = event => { if (!peer.relay) this.#receiveData(id, event.data); };
  }
  #activateRelay(id) {
    const peer = this.peers.get(id);
    if (!peer || peer.relay || this.relayTransport !== 'websocket') return false;
    peer.relay = true; clearTimeout(peer.relayTimer);
    this.#edgeReady(id); return true;
  }
  #edgeReady(id) {
    this.peers.get(id).everReady = true;
    emit(this, 'peer_connected', { peerId: id });
    emit(this, 'status', { state: this.isHost ? 'hosting' : 'connected', peerId: id, transport: this.peers.get(id)?.relay ? 'cloud-relay' : 'webrtc' });
    if (this.isHost && this.checkpoint) this.#sendEnvelope(id, { kind: 'checkpoint', revision: this.checkpointRevision, state: this.checkpoint });
    if (!this.isHost && id === this.hostId) {this.checkpointDecoder.reset();this.#checkpointHello(true);}
  }
  #checkpointHello(force = false) {
    if (this.isHost || !this.hostId || (!force && Date.now()-this.checkpointHelloAt<2000)) return;
    if (this.#sendEnvelope(this.hostId,{kind:'checkpoint_codec',v:[1],need:'key'})) this.checkpointHelloAt=Date.now();
  }
  #acceptCheckpoint(id,state,revision) {
    this.checkpoint = state; this.checkpointRevision = revision;
    // Coordinator metadata needs only a periodic readiness update.
    if (!this.checkpointAdvertisedAt || Date.now()-this.checkpointAdvertisedAt>10000) {
      if (this.#signal({type:'checkpoint_ready',revision})) this.checkpointAdvertisedAt=Date.now();
    }
    emit(this,'checkpoint',{from:id,state,revision,epoch:this.epoch});
  }
  #receiveData(id, data) {
    const peer = this.peers.get(id); if (!peer || peer.epoch !== this.epoch) return;
    let frame; try { frame = JSON.parse(typeof data === 'string' ? data : decoder.decode(data)); } catch { return; }
    if (!frame || frame.epoch !== this.epoch || !Number.isSafeInteger(frame.part) || !Number.isSafeInteger(frame.total) || frame.total < 1 || frame.total > 64 || frame.part < 0 || frame.part >= frame.total || typeof frame.body !== 'string' || frame.body.length > FRAME_BYTES * 2) return;
    peer.receivedAt = Date.now();
    if (peer.awaitingHost && id === this.hostId) { peer.awaitingHost = false; emit(this, 'status', { state: 'connected' }); }
    const key = String(frame.id);
    let entry = peer.pending.get(key);
    if (!entry) {
      for (const [pendingId, pending] of peer.pending) if (Date.now() - pending.started > 15_000) peer.pending.delete(pendingId);
      if (peer.pending.size >= 8) return;
      entry = { parts: Array(frame.total), count: 0, started: Date.now() }; peer.pending.set(key, entry);
    }
    if (entry.parts.length !== frame.total || Date.now() - entry.started > 15_000) { peer.pending.delete(key); return; }
    if (entry.parts[frame.part] === undefined) { entry.parts[frame.part] = frame.body; entry.count++; }
    if (entry.count !== frame.total) return;
    peer.pending.delete(key);
    let chunks; try { chunks = entry.parts.map(part => Uint8Array.from(atob(part), character => character.charCodeAt(0))); } catch { return; }
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0); if (length > MAX_MESSAGE_BYTES) return;
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let envelope; try { envelope = JSON.parse(decoder.decode(bytes)); } catch { return; }
    if (!envelope || typeof envelope !== 'object') return;
    if (envelope.kind === 'checkpoint_codec') {
      if (!this.isHost || !supportsCodec(envelope)) return;
      const now=Date.now();
      if (peer.checkpointHelloAt !== undefined && now-peer.checkpointHelloAt<500) return;
      peer.checkpointHelloAt=now;this.checkpointEncoder.enable(id);
    } else if (envelope.kind === 'checkpoint_delta') {
      if (id !== this.hostId || !Number.isSafeInteger(envelope.revision) || envelope.revision<0 || envelope.revision<this.checkpointRevision) return;
      const result=this.checkpointDecoder.accept(envelope.frame);
      if (result.request) this.#checkpointHello(true);
      if (result.snapshot) this.#acceptCheckpoint(id,result.snapshot,envelope.revision);
    } else if (envelope.kind === 'checkpoint') {
      if (id !== this.hostId || !Number.isSafeInteger(envelope.revision) || envelope.revision < 0 || envelope.revision < this.checkpointRevision) return;
      this.#acceptCheckpoint(id,envelope.state,envelope.revision);
      this.#checkpointHello(); // Old hosts safely ignore this; retry if initial negotiation was dropped.
    } else if (envelope.kind === 'message') {
      if (!this.isHost && id !== this.hostId) return;
      const now = Date.now();
      if (now - peer.messagesAt >= 1000) { peer.messagesAt = now; peer.messagesCount = 0; }
      if (++peer.messagesCount > 80) return;
      emit(this, 'message', { from: id, data: envelope.data });
    }
  }
  #prepareEnvelope(envelope) {
    let serialized; try { serialized = encoder.encode(JSON.stringify(envelope)); } catch { return false; }
    if (!serialized.length || serialized.length > MAX_MESSAGE_BYTES) return false;
    const total = Math.ceil(serialized.length / FRAME_BYTES);
    if (total > 64) return false;
    const bodies = [];
    for (let part = 0; part < total; part++) {
      const chunk = serialized.subarray(part * FRAME_BYTES, (part + 1) * FRAME_BYTES);
      bodies.push(btoa(String.fromCharCode(...chunk)));
    }
    const prepared = Object.freeze({epoch:this.epoch, peerId:this.peerId, bodies:Object.freeze(bodies)});
    preparedOwner.set(prepared, this);
    return prepared;
  }
  #sendPreparedEnvelope(id, prepared) {
    if (!prepared || preparedOwner.get(prepared) !== this || prepared.epoch !== this.epoch || prepared.peerId !== this.peerId) return false;
    const peer = this.peers.get(id), channel = peer?.relay ? this.socket : peer?.channel;
    if ((peer?.relay ? channel?.readyState !== WebSocket.OPEN : !open(channel)) || channel.bufferedAmount > 1024 * 1024) return false;
    const idSequence = `${this.peerId}:${++this.frameSequence}`, total = prepared.bodies.length;
    try {
      for (let part = 0; part < total; part++) {
        // Check between fragments too: relay peers share one socket's send buffer.
        if (channel.bufferedAmount > 1024 * 1024) return false;
        const frame = JSON.stringify({id:idSequence, epoch:this.epoch, part, total, body:prepared.bodies[part]});
        channel.send(peer?.relay ? JSON.stringify({type:'relay', to:id, epoch:this.epoch, frame}) : frame);
      }
    } catch { return false; } // A channel may close between its readiness check and send.
    return true;
  }
  #sendEnvelope(id, envelope) { return this.#sendPreparedEnvelope(id, this.#prepareEnvelope(envelope)); }
  // Explicit per-publication preparation; no object-identity cache that could retain stale mutations.
  prepareMessage(data) { return this.#prepareEnvelope({kind:'message', data}); }
  sendPrepared(to, prepared) { if (!this.isHost && to !== this.hostId) return false; return this.#sendPreparedEnvelope(to, prepared); }
  send(to, data) { if (!this.isHost && to !== this.hostId) return false; return this.#sendEnvelope(to, { kind: 'message', data }); }
  broadcast(data) { if (!this.isHost || !this.peers.size) return false; const prepared = this.prepareMessage(data); let sent = 0; for (const id of this.peers.keys()) if (this.sendPrepared(id, prepared)) sent++; return sent; }
  setCheckpoint(state, revision) {
    if (!this.isHost || !Number.isSafeInteger(revision) || revision < 0 || revision < this.checkpointRevision) return false;
    this.checkpoint = state; this.checkpointRevision = revision;
    // Only desktop peers can be offered the world, so only they need 2 Hz recovery points. Others
    // keep a local backup at the 10 s autosave cadence instead of ~130 KB/s of unused checkpoints.
    const now = Date.now();
    let encoded=false;
    if (this.checkpointEncoder.size) {
      try {this.checkpointEncoder.publish(state);encoded=true;} catch {/* Old/oversized schema keeps legacy recovery. */}
    }
    const prepared=new Map();
    for (const [id, peer] of this.peers) {
      if (this.roster.get(id)?.desktop !== true && now - (peer.checkpointAt || 0) < 10_000) continue;
      const frame=encoded?this.checkpointEncoder.frame(id,this.epoch):null;
      const key=frame?frame.b:'legacy';
      if (!prepared.has(key)) prepared.set(key,this.#prepareEnvelope(frame?{kind:'checkpoint_delta',revision,frame}:{kind:'checkpoint',state,revision}));
      if (this.#sendPreparedEnvelope(id,prepared.get(key))) peer.checkpointAt=now;
      else if (frame) this.checkpointEncoder.resync(id);
    }
    return true;
  }
  continueWorld() { return this.#signal({ type: 'continue_world', epoch: this.epoch }); }
  declineWorld() { return this.#signal({ type: 'decline_world', epoch: this.epoch }); }
  retryWorld() { return this.#signal({ type: 'retry_world', epoch: this.epoch }); }
  transferHost(peerId) { if (!this.isHost) return false; return this.#signal({ type: 'transfer_host', to: peerId }); }
  #removePeer(id) { const peer = this.peers.get(id); if (!peer) return; this.peers.delete(id); this.checkpointEncoder.forget(id); clearTimeout(peer.relayTimer); peer.channel?.close(); peer.connection.close(); }
  #resetPeers() { for (const id of this.peers.keys()) this.#removePeer(id); this.checkpointEncoder.reset();this.checkpointDecoder.reset();this.checkpointHelloAt=0; }
  close() {
    // Tell the room this is deliberate so it can free the seat or hand the world over immediately.
    if (this.joined && this.socket?.readyState === WebSocket.OPEN) { try { this.socket.send(JSON.stringify({ type: 'leave' })); } catch { /* closing */ } }
    this.closed = true; this.joined = false; ++this.generation; clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat); clearInterval(this.liveness); this.#resetPeers();
    this.socket?.close(1000); this.socket = null;
    emit(this, 'status', { state: 'disconnected' });
  }
}
