// Browser WebRTC star transport. The signaling service sees membership and SDP, never game state.
const FRAME_BYTES = 12_000;
const MAX_MESSAGE_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
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
  }
  connect({ room = '', name = 'Adventurer', role = 'hero', desktop = true, secret = '' } = {}) {
    this.close();
    this.checkpoint = null; this.checkpointRevision = -1;
    this.peerId = ''; this.hostId = ''; this.epoch = 0; this.isHost = false; this.roster.clear();
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
    emit(this, 'status', { state: this.reconnectAttempt ? 'reconnecting' : 'connecting' });
    let socket;
    try { socket = new WebSocket(this.url); } catch (error) { emit(this, 'error', { code: 'invalid_endpoint', message: String(error) }); return; }
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
        clearTimeout(timeout); this.reconnectAttempt = 0; this.joined = true;
        this.room = message.room; this.peerId = message.peerId; this.secret = message.secret;
        this.hostId = message.hostId; this.epoch = message.epoch; this.isHost = this.hostId === this.peerId;
        this.iceServers = this.iceServers || message.iceServers;
        this.relayConfigured = !!message.relayConfigured;
        this.roster = new Map((message.peers || []).map(peer => [peer.id, peer]));
        this.roster.set(this.peerId, { id: this.peerId, name: this.name, role: this.role, desktop: this.desktop, online: true });
        emit(this, 'welcome', { room: this.room, peerId: this.peerId, secret: this.secret, epoch: this.epoch, hostId: this.hostId, role: this.role, isHost: this.isHost, peers: [...this.roster.values()], relayConfigured: this.relayConfigured });
        emit(this, 'roster', { peers: [...this.roster.values()], epoch: this.epoch });
        emit(this, 'status', { state: this.isHost ? 'hosting' : 'connecting_to_host', relayConfigured: this.relayConfigured });
        if (!this.isHost && this.roster.get(this.hostId)?.online === false) emit(this, 'owner_lost', { epoch: this.epoch });
        if (this.isHost) for (const peer of this.roster.values()) if (peer.id !== this.peerId && peer.online) this.#connectPeer(peer.id, true);
      } else this.#handleSignal(message);
    });
    socket.addEventListener('close', event => {
      clearTimeout(timeout);
      if (generation !== this.generation || this.closed) return;
      this.#resetPeers();
      if ([1008,1009,4001].includes(event.code)) { this.closed = true; emit(this, 'error', { code: 'signaling_rejected', message: 'Room connection was rejected.' }); emit(this, 'status', { state: 'disconnected' }); return; }
      emit(this, 'status', { state: 'reconnecting' });
      if (!this.secret) { this.closed = true; emit(this, 'error', { code: 'signaling_unavailable', message: 'Could not create a room.' }); return; }
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.reconnectAttempt++, 5));
      this.reconnectTimer = setTimeout(() => this.#openSocket(), delay);
    });
    socket.addEventListener('error', () => { if (generation === this.generation) emit(this, 'status', { state: 'signaling_unreachable' }); });
  }
  #handleSignal(message) {
    if (message.type === 'error') {
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
      const peer = this.roster.get(message.peerId); if (peer) peer.online = false;
      if (message.removed === true && message.peerId !== this.peerId) this.roster.delete(message.peerId);
      this.#removePeer(message.peerId);
      emit(this, 'peer_left', { peerId: message.peerId }); emit(this, 'roster', { peers: [...this.roster.values()], epoch: this.epoch });
    } else if (message.type === 'signal') {
      if (message.epoch !== this.epoch || !this.roster.has(message.from)) return;
      this.#receiveSignal(message.from, message.signal).catch(error => emit(this, 'error', { code: 'webrtc_signal', message: String(error) }));
    } else if (message.type === 'owner_lost') {
      if (message.epoch !== this.epoch) return;
      emit(this, 'owner_lost', { epoch: this.epoch }); emit(this, 'status', { state: 'owner_lost' });
    } else if (message.type === 'continue_world_offer') {
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
    connection.onicecandidate = event => {
      if (!event.candidate || peer.epoch !== this.epoch) return;
      if (!peer.offerSent) { peer.localIceQueue.push(event.candidate); return; }
      this.#signal({ type: 'signal', to: id, epoch: this.epoch, signal: { type: 'ice', candidate: event.candidate } });
    };
    connection.onconnectionstatechange = () => {
      if (['failed','closed','disconnected'].includes(connection.connectionState)) {
        emit(this, 'peer_connection_state', { peerId: id, state: connection.connectionState, relayConfigured: this.relayConfigured });
        if (connection.connectionState === 'failed') this.#removePeer(id);
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
      if (peer.epoch !== this.epoch) return;
      emit(this, 'peer_connected', { peerId: id });
      emit(this, 'status', { state: this.isHost ? 'hosting' : 'connected', peerId: id });
      if (this.isHost && this.checkpoint) this.#sendEnvelope(id, { kind: 'checkpoint', revision: this.checkpointRevision, state: this.checkpoint });
    };
    channel.onclose = () => emit(this, 'peer_disconnected', { peerId: id });
    channel.onerror = () => emit(this, 'peer_connection_state', { peerId: id, state: 'error', relayConfigured: this.relayConfigured });
    channel.onmessage = event => this.#receiveData(id, event.data);
  }
  #receiveData(id, data) {
    const peer = this.peers.get(id); if (!peer || peer.epoch !== this.epoch) return;
    let frame; try { frame = JSON.parse(typeof data === 'string' ? data : decoder.decode(data)); } catch { return; }
    if (!frame || frame.epoch !== this.epoch || !Number.isSafeInteger(frame.part) || !Number.isSafeInteger(frame.total) || frame.total < 1 || frame.total > 64 || frame.part < 0 || frame.part >= frame.total || typeof frame.body !== 'string' || frame.body.length > FRAME_BYTES * 2) return;
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
    if (envelope.kind === 'checkpoint') {
      if (id !== this.hostId || !Number.isSafeInteger(envelope.revision) || envelope.revision < 0 || envelope.revision < this.checkpointRevision) return;
      this.checkpoint = envelope.state; this.checkpointRevision = envelope.revision;
      this.#signal({ type: 'checkpoint_ready', revision: envelope.revision });
      emit(this, 'checkpoint', { from: id, state: envelope.state, revision: envelope.revision, epoch: this.epoch });
    } else if (envelope.kind === 'message') {
      if (!this.isHost && id !== this.hostId) return;
      const now = Date.now();
      if (now - peer.messagesAt >= 1000) { peer.messagesAt = now; peer.messagesCount = 0; }
      if (++peer.messagesCount > 80) return;
      emit(this, 'message', { from: id, data: envelope.data });
    }
  }
  #sendEnvelope(id, envelope) {
    const channel = this.peers.get(id)?.channel; if (!open(channel) || channel.bufferedAmount > 1024 * 1024) return false;
    let serialized; try { serialized = encoder.encode(JSON.stringify(envelope)); } catch { return false; }
    if (!serialized.length || serialized.length > MAX_MESSAGE_BYTES) return false;
    const idSequence = `${this.peerId}:${++this.frameSequence}`;
    const total = Math.ceil(serialized.length / FRAME_BYTES);
    if (total > 64) return false;
    for (let part = 0; part < total; part++) {
      const chunk = serialized.subarray(part * FRAME_BYTES, (part + 1) * FRAME_BYTES);
      channel.send(JSON.stringify({ id: idSequence, epoch: this.epoch, part, total, body: btoa(String.fromCharCode(...chunk)) }));
    }
    return true;
  }
  send(to, data) { if (!this.isHost && to !== this.hostId) return false; return this.#sendEnvelope(to, { kind: 'message', data }); }
  broadcast(data) { if (!this.isHost) return false; let sent = 0; for (const id of this.peers.keys()) if (this.send(id, data)) sent++; return sent; }
  setCheckpoint(state, revision) {
    if (!this.isHost || !Number.isSafeInteger(revision) || revision < 0 || revision < this.checkpointRevision) return false;
    this.checkpoint = state; this.checkpointRevision = revision;
    // Only desktop peers can be offered the world, so only they need 2 Hz recovery points. Others
    // keep a local backup at the 10 s autosave cadence instead of ~130 KB/s of unused checkpoints.
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (this.roster.get(id)?.desktop !== true && now - (peer.checkpointAt || 0) < 10_000) continue;
      if (this.#sendEnvelope(id, { kind: 'checkpoint', state, revision })) peer.checkpointAt = now;
    }
    return true;
  }
  continueWorld() { return this.#signal({ type: 'continue_world', epoch: this.epoch }); }
  declineWorld() { return this.#signal({ type: 'decline_world', epoch: this.epoch }); }
  retryWorld() { return this.#signal({ type: 'retry_world', epoch: this.epoch }); }
  transferHost(peerId) { if (!this.isHost) return false; return this.#signal({ type: 'transfer_host', to: peerId }); }
  #removePeer(id) { const peer = this.peers.get(id); if (!peer) return; peer.channel?.close(); peer.connection.close(); this.peers.delete(id); }
  #resetPeers() { for (const id of this.peers.keys()) this.#removePeer(id); }
  close() {
    // Tell the room this is deliberate so it can free the seat or hand the world over immediately.
    if (this.joined && this.socket?.readyState === WebSocket.OPEN) { try { this.socket.send(JSON.stringify({ type: 'leave' })); } catch { /* closing */ } }
    this.closed = true; this.joined = false; ++this.generation; clearTimeout(this.reconnectTimer); this.#resetPeers();
    this.socket?.close(1000); this.socket = null;
    emit(this, 'status', { state: 'disconnected' });
  }
}
