import {VoiceRoute} from './voice-route.js';
import {VoiceAudio} from './voice-audio.js';

const errorText = error => ({
  NotAllowedError:'Microphone permission was denied. Allow the microphone in site settings, then press Enable microphone again.',
  NotFoundError:'No microphone was found. Connect one, then press Enable microphone again.',
  NotReadableError:'The microphone is busy or unavailable. Close other microphone apps, then try again.',
}[error?.name] || 'Voice could not start. Check browser audio permissions, then retry voice.');

export class ProximityVoice extends EventTarget {
  constructor(connection, {mediaDevices = globalThis.navigator?.mediaDevices, createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), createPeer = options => new RTCPeerConnection(options), now = () => Date.now()} = {}) {
    super(); this.connection = connection; this.mediaDevices = mediaDevices; this.createContext = createContext; this.createPeer = createPeer; this.now = now;
    this.active = false; this.disposed = false; this.pending = false; this.captureGeneration = 0; this.joinGeneration = 0; this.session = crypto.randomUUID();
    this.peers = new Map(); this.members = new Map(); this.muted = new Set(); this.removers = [];
    this.route = new VoiceRoute(connection, (id, body) => this.receive(id, body));
    const on = (type, fn) => { connection.addEventListener(type, fn); this.removers.push(() => connection.removeEventListener(type, fn)); };
    on('welcome', () => this.reset()); on('host_changed', () => this.reset());
    on('peer_connected', () => this.announce());
    on('peer_left', ({detail}) => this.remove(detail.peerId));
    on('status', ({detail}) => {
      this.online = ['hosting','connected'].includes(detail.state);
      if (['disconnected','owner_lost','signaling_reconnecting'].includes(detail.state)) {
        this.stopMicrophone(); this.clearPeers();
        this.message = 'Voice interrupted; microphone stopped. When the world reconnects, retry voice and enable your microphone again.'; this.changed();
      }
    });
    this.visibility = () => { if (globalThis.document?.hidden) { this.stopMicrophone(); this.message = 'Microphone stopped while this tab was hidden. Enable it again when ready.'; this.changed(); } };
    globalThis.document?.addEventListener('visibilitychange', this.visibility);
    this.timer = setInterval(() => this.tick(), 100);
  }
  changed() { this.dispatchEvent(new Event('change')); }
  state() {
    return {active:this.active, microphone:!!this.stream, pending:this.pending, deafened:!!this.audio?.deafened,
      audioState:this.audio?.context.state || 'off', message:this.message || '',
      peers:[...this.members].map(([id, m]) => ({id, name:this.connection.roster.get(id)?.name || 'Player', microphone:m.mic,
        state:this.peers.get(id)?.pc.connectionState || (m.attempts >= 3 ? 'blocked' : 'waiting'), muted:this.muted.has(id)}))};
  }
  updatePose(pose) { this.pose = pose; if (this.active) this.audio?.listener(pose); }
  async join() {
    if (this.disposed || this.connection.local) return;
    const generation = ++this.joinGeneration;
    try {
      if (!this.online) { this.message = 'Connect to a multiplayer world before joining voice.'; this.changed(); return; }
      if (typeof globalThis.RTCPeerConnection !== 'function') { this.message = 'Voice needs a browser with WebRTC support. Try a recent Chrome, Edge, Firefox or Safari browser.'; this.changed(); return; }
      this.audio ??= new VoiceAudio(this.createContext(), () => { this.message = 'Voice playback was blocked. Press Retry voice / audio to allow playback.'; this.changed(); });
      this.audio.context.onstatechange = () => this.changed();
      await this.audio.context.resume();
      if (this.disposed || generation !== this.joinGeneration) return;
      this.active = true; this.message = 'Listening nearby. Microphone is off. Headphones help prevent echo.';
      this.announce(); this.changed();
    } catch (error) { this.message = errorText(error); this.changed(); }
  }
  async enableMicrophone() {
    if (!this.active || this.disposed || this.pending || this.stream) return;
    if (!this.online) { this.message = 'Reconnect to the world before enabling your microphone.'; this.changed(); return; }
    if (this.audio.deafened) { this.message = 'Turn listening on before enabling your microphone.'; this.changed(); return; }
    const generation = ++this.captureGeneration; this.pending = true; this.changed();
    try {
      if (!this.mediaDevices?.getUserMedia) { this.message = 'Microphone capture is unavailable. Open the game over HTTPS in a browser that supports microphone access.'; return; }
      // This method is called only from the explicit user microphone button.
      const stream = await this.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1}, video:false});
      if (generation !== this.captureGeneration || !this.active || this.disposed) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getAudioTracks()[0];
      if (!track) { stream.getTracks().forEach(t => t.stop()); throw new Error('no audio track'); }
      this.stream = stream;
      track.onended = () => { if (this.stream === stream) { this.stopMicrophone(); this.message = 'Microphone disconnected. Reconnect it and enable microphone again.'; this.changed(); } };
      for (const [id, p] of this.peers) p.sender?.replaceTrack(track).catch(() => this.fail(id, p));
      this.message = 'Microphone on: nearby players in voice can hear you.'; this.announce();
    } catch (error) { if (generation === this.captureGeneration) this.message = errorText(error); }
    finally { if (generation === this.captureGeneration) this.pending = false; this.changed(); }
  }
  stopMicrophone() {
    ++this.captureGeneration; this.pending = false;
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    for (const p of this.peers.values()) p.sender?.replaceTrack(null).catch(() => {});
    this.message = 'Microphone off. Enable it when you want to speak.';
    this.announce(); this.changed();
  }
  deafen(value) { if (value) this.stopMicrophone(); this.audio?.deafen(value); this.changed(); }
  mute(id, value) { value ? this.muted.add(id) : this.muted.delete(id); this.audio?.mute(id, value); this.changed(); }
  announce() {
    if (this.disposed || this.active && !this.pose) return;
    this.route.send('*', {type:'state', session:this.session, active:this.active, mic:!!this.stream, position:this.pose?.position});
  }
  tick() {
    if (!this.active || this.disposed) return;
    this.announce();
    const now = this.now();
    for (const [id, m] of this.members) {
      if (!this.route.member(id) || now - m.seen > 12000) { this.remove(id); continue; }
      this.audio?.position(id, m.position, now - m.seen < 3000 && m.mic);
      const p = this.peers.get(id);
      if (p && now - p.started > 15000 && p.pc.connectionState !== 'connected') this.fail(id, p);
      if (!this.peers.has(id) && this.connection.peerId < id && now >= m.retryAt && m.attempts < 3) void this.offer(id);
    }
  }
  receive(id, b) {
    if (!this.active || this.disposed || id === this.connection.peerId) return;
    if (b.type === 'state') {
      if (!b.active) { this.remove(id); return; }
      let m = this.members.get(id);
      if (m?.session !== b.session) { this.remove(id); m = null; }
      const fresh = !m, changed = m?.mic !== b.mic;
      if (!m) { m = {session:b.session, attempts:0, retryAt:0}; this.members.set(id, m); }
      Object.assign(m, {position:b.position, mic:b.mic, seen:this.now()});
      if (fresh) this.announce();
      if (fresh || changed) this.changed();
      return;
    }
    const m = this.members.get(id);
    if (!m || b.session !== m.session || b.targetSession !== this.session) return;
    // Ordered game messages serialize SDP and candidates; async RTC calls also need serialization.
    if ((m.pendingSignals || 0) >= 32) return;
    m.pendingSignals = (m.pendingSignals || 0) + 1;
    m.queue = (m.queue || Promise.resolve()).then(() => this.signal(id, b)).catch(() => {
      const p = this.peers.get(id); if (this.members.get(id) === m && p?.negotiation === b.negotiation) this.fail(id, p);
    }).finally(() => { m.pendingSignals--; });
  }
  sendSignal(id, body) {
    const m = this.members.get(id); if (!m) return false;
    return this.route.send(id, {...body, session:this.session, targetSession:m.session, negotiation:this.peers.get(id)?.negotiation});
  }
  makePeer(id, initiator, negotiation = crypto.randomUUID()) {
    const pc = this.createPeer({iceServers:this.connection.iceServers || []});
    const p = {pc, negotiation, started:this.now(), ice:[], localIce:[], descriptionSent:false}; this.peers.set(id, p);
    const alive = () => !this.disposed && this.active && this.peers.get(id) === p;
    p.alive = alive;
    if (initiator) p.sender = pc.addTransceiver('audio', {direction:'sendrecv'}).sender;
    pc.onicecandidate = ({candidate}) => {
      if (!alive() || !candidate) return;
      const value = candidate.toJSON();
      if (p.descriptionSent) this.sendSignal(id, {type:'ice', candidate:value}); else p.localIce.push(value);
    };
    pc.ontrack = ({track}) => {
      if (!alive() || track.kind !== 'audio') return;
      this.audio.add(id, new MediaStream([track])); this.audio.mute(id, this.muted.has(id));
      track.onended = () => { if (alive()) this.audio?.remove(id); };
    };
    pc.onconnectionstatechange = () => {
      if (!alive()) return;
      if (pc.connectionState === 'connected') this.message = this.stream ? 'Microphone on: nearby players in voice can hear you.' : 'Voice connected; microphone off.';
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.fail(id, p);
      else if (pc.connectionState === 'disconnected') { this.audio?.remove(id); this.fail(id, p); }
      this.changed();
    };
    return p;
  }
  flushIce(id, p) { p.descriptionSent = true; for (const candidate of p.localIce) this.sendSignal(id, {type:'ice', candidate}); p.localIce = []; }
  async offer(id) {
    const m = this.members.get(id); if (!m || this.peers.has(id)) return;
    m.attempts++;
    let p;
    try {
      p = this.makePeer(id, true);
      await p.sender.replaceTrack(this.stream?.getAudioTracks()[0] || null); if (!p.alive()) return;
      await p.pc.setLocalDescription(await p.pc.createOffer()); if (!p.alive()) return;
      this.sendSignal(id, {type:'offer', description:p.pc.localDescription.toJSON()}); this.flushIce(id, p);
    } catch { if (p) this.fail(id, p); else { m.retryAt = this.now() + 10000; this.message = 'This browser could not create a voice connection. Try a browser with WebRTC support, then retry voice.'; this.changed(); } }
  }
  async signal(id, b) {
    const m = this.members.get(id);
    if (!this.active || !m || m.session !== b.session || b.targetSession !== this.session) return;
    let p = this.peers.get(id);
    if (b.type !== 'offer' && p?.negotiation !== b.negotiation) return;
    if (b.type === 'offer') {
      if (id >= this.connection.peerId) return;
      this.closePeer(id); p = this.makePeer(id, false, b.negotiation);
      await p.pc.setRemoteDescription(b.description); if (!p.alive()) return;
      const transceiver = p.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
      if (!transceiver) throw new Error('Missing audio');
      transceiver.direction = 'sendrecv'; p.sender = transceiver.sender;
      await p.sender.replaceTrack(this.stream?.getAudioTracks()[0] || null); if (!p.alive()) return;
      await p.pc.setLocalDescription(await p.pc.createAnswer()); if (!p.alive()) return;
      this.sendSignal(id, {type:'answer', description:p.pc.localDescription.toJSON()}); this.flushIce(id, p);
    } else if (b.type === 'answer' && p && id > this.connection.peerId && p.pc.signalingState === 'have-local-offer') {
      await p.pc.setRemoteDescription(b.description);
    } else if (b.type === 'ice' && p) {
      if (!p.pc.remoteDescription) { if (p.ice.length < 64) p.ice.push(b.candidate); return; }
      await p.pc.addIceCandidate(b.candidate);
    }
    if (p?.alive() && p.pc.remoteDescription) { for (const candidate of p.ice) await p.pc.addIceCandidate(candidate); p.ice = []; }
  }
  fail(id, p) {
    if (this.peers.get(id) !== p) return;
    this.closePeer(id);
    const m = this.members.get(id); if (m) m.retryAt = this.now() + 10000;
    this.message = 'A voice connection failed. Retry voice; if it stays blocked, try another network. The game relay cannot carry audio.'; this.changed();
  }
  closePeer(id) { const p = this.peers.get(id); this.peers.delete(id); if (p) { p.pc.ontrack = p.pc.onicecandidate = p.pc.onconnectionstatechange = null; p.pc.close(); } this.audio?.remove(id); }
  remove(id) { this.closePeer(id); if (this.members.delete(id)) this.changed(); }
  clearPeers() { for (const id of this.peers.keys()) this.closePeer(id); this.members.clear(); }
  reset() { this.stopMicrophone(); this.clearPeers(); this.session = crypto.randomUUID(); this.announce(); this.changed(); }
  async retry() { this.reset(); await this.join(); }
  leave() {
    ++this.joinGeneration;
    this.active = false; this.stopMicrophone(); this.clearPeers(); this.audio?.dispose(); this.audio = null;
    this.session = crypto.randomUUID(); this.message = 'Voice off. Microphone released.'; this.changed();
  }
  dispose() {
    if (this.disposed) return;
    this.leave(); this.disposed = true; clearInterval(this.timer); this.route.dispose(); this.removers.forEach(fn => fn());
    globalThis.document?.removeEventListener('visibilitychange', this.visibility);
  }
}
