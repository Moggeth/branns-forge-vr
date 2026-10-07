import {VoiceRoute} from './voice-route.js';
import {VoiceAudio, SPEAKING_THRESHOLD, SPEAKING_HOLD_MS} from './voice-audio.js';
import {voiceZoneAt, voiceRelation} from './voice-zones.js';
import {VOICE_NEIGHBORS} from './voice-topology.js';

const errorText = error => ({
  NotAllowedError:'Microphone permission was denied. Allow the microphone in site settings, then press Enable microphone again.',
  NotFoundError:'No microphone was found. Connect one, then press Enable microphone again.',
  NotReadableError:'The microphone is busy or unavailable. Close other microphone apps, then try again.',
}[error?.name] || 'Voice could not start. Check browser audio permissions, then retry voice.');

export class ProximityVoice extends EventTarget {
  constructor(connection, {mediaDevices = globalThis.navigator?.mediaDevices, createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), createPeer = options => new RTCPeerConnection(options), now = () => Date.now()} = {}) {
    super(); this.connection = connection; this.mediaDevices = mediaDevices; this.createContext = createContext; this.createPeer = createPeer; this.now = now;
    this.active = false; this.disposed = false; this.pending = false; this.captureGeneration = 0; this.joinGeneration = 0; this.session = crypto.randomUUID();
    this.selected=new Map();this.lastPresence=null;this.nextOfferAt=0;this.zone=null;this.speakingUntil=0;
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
      audioState:this.audio?.context.state || 'off', message:this.message || '', speaking:this.selfSpeaking(),
      zone:this.zone ? {id:this.zone.id, kind:this.zone.kind, label:this.zone.label} : null,
      peers:[...this.members].map(([id, m]) => ({id, name:this.connection.roster.get(id)?.name || 'Player', microphone:m.mic,
        state:this.peers.get(id)?.pc.connectionState || (m.attempts >= 3 ? 'blocked' : 'waiting'), muted:this.muted.has(id), speaking:this.peerSpeaking(id)}))};
  }
  // Loud on the latest sample, or within the hold after it (a slow frame can delay the 10 Hz tick past the hold).
  selfSpeaking() { return !!this.stream && (this.selfLoud || this.now() < this.speakingUntil); }
  peerSpeaking(id) { const m = this.members.get(id); return !!m && m.mic && !this.muted.has(id) && !this.audio?.deafened && (m.loud || this.now() < (m.speakingUntil || 0)); }
  /** Who is talking right now, for in-world and HUD indicators. Cheap; safe to call every frame. */
  activity() {
    const peers = new Set(); if (this.active) for (const id of this.members.keys()) if (this.peerSpeaking(id)) peers.add(id);
    return {self:this.selfSpeaking(), peers};
  }
  updatePose(pose) {
    this.pose = pose; if (this.active) this.audio?.listener(pose);
    const zone = voiceZoneAt(pose?.position);
    if (zone?.id !== this.zone?.id) { this.zone = zone; this.changed(); }
  }
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
      this.stream = stream; this.audio?.watchMicrophone?.(stream);
      track.onended = () => { if (this.stream === stream) { this.stopMicrophone(); this.message = 'Microphone disconnected. Reconnect it and enable microphone again.'; this.changed(); } };
      for (const [id, p] of this.peers) p.sender?.replaceTrack(track).catch(() => this.fail(id, p));
      this.message = 'Microphone on: nearby players in voice can hear you.'; this.announce();
    } catch (error) { if (generation === this.captureGeneration) this.message = errorText(error); }
    finally { if (generation === this.captureGeneration) this.pending = false; this.changed(); }
  }
  stopMicrophone() {
    ++this.captureGeneration; this.pending = false;
    const stream = this.stream; this.stream = null; this.audio?.unwatchMicrophone?.(); this.speakingUntil = 0; this.selfLoud = false;
    stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    for (const p of this.peers.values()) p.sender?.replaceTrack(null).catch(() => {});
    this.message = 'Microphone off. Enable it when you want to speak.';
    this.announce(); this.changed();
  }
  deafen(value) { if (value) this.stopMicrophone(); this.audio?.deafen(value); this.changed(); }
  mute(id, value) { value ? this.muted.add(id) : this.muted.delete(id); this.audio?.mute(id, value); this.changed(); }
  announce(force=true) {
    if (this.disposed || this.active && !this.pose) return;
    const now=this.now(),position=this.pose?.position,last=this.lastPresence;
    const moved=position&&last?.position&&Math.hypot(...position.map((v,i)=>v-last.position[i]))>.25;
    if(!force&&last&&now-last.at<(moved?500:2000))return;
    this.lastPresence={at:now,position:position?[...position]:null};
    this.route.send('*', {type:'state', session:this.session, active:this.active, mic:!!this.stream, position});
  }
  tick() {
    if (!this.active || this.disposed) return;
    this.announce(false);
    const now = this.now(), before = this.speakingSignature();
    this.selfLoud = !!this.stream && this.audio?.microphoneLevel?.() > SPEAKING_THRESHOLD;
    if (this.selfLoud) this.speakingUntil = now + SPEAKING_HOLD_MS;
    for (const [id, m] of this.members) {
      if (!this.route.member(id) || now - m.seen > 12000) { this.remove(id); continue; }
      this.audio?.position(id, m.position, now - m.seen < 3000 && m.mic, voiceRelation(this.pose?.position, m.position));
      m.loud = m.mic && this.audio?.level?.(id) > SPEAKING_THRESHOLD;
      if (m.loud) m.speakingUntil = now + SPEAKING_HOLD_MS;
      const p = this.peers.get(id);
      if (p && now - p.started > 15000 && p.pc.connectionState !== 'connected') this.fail(id, p);
      if (this.eligible(id)&&!this.peers.has(id) && this.connection.peerId < id && now >= m.retryAt && m.attempts < 3&&now>=this.nextOfferAt) {this.nextOfferAt=now+100;void this.offer(id);}
    }
    if (this.speakingSignature() !== before) this.changed();
  }
  speakingSignature() { const a = this.activity(); return (a.self ? '+' : '-') + [...a.peers].sort().join(','); }
  receive(id, b) {
    if (!this.active || this.disposed) return;
    if(b.type==='neighbors'){
      if(id!==this.connection.hostId||b.session!==this.session)return;
      // A retry cleared local presence. Seed selected members from the host's
      // current generation before early SDP arrives, rather than discard it.
      for(const peer of b.peers)this.receive(peer.id,{type:'state',active:true,...peer});
      const next=new Map(b.peers.map(p=>[p.id,p.session]));
      for(const peerId of this.peers.keys())if(next.get(peerId)!==this.members.get(peerId)?.session)this.closePeer(peerId);
      for(const [peerId,session]of next)if(this.selected.get(peerId)!==session){const m=this.members.get(peerId);if(m){m.attempts=0;m.retryAt=this.now()+Math.abs([...peerId].reduce((n,c)=>n+c.charCodeAt(0),0)%150);}}
      this.selected=next;this.changed();return;
    }
    if(id === this.connection.peerId) return;
    if (b.type === 'state') {
      if (!b.active) { this.remove(id); return; }
      let m = this.members.get(id);
      if (m?.session !== b.session) { this.remove(id); m = null; }
      const fresh = !m, changed = m?.mic !== b.mic;
      if (!m) { m = {session:b.session, attempts:0, retryAt:0}; this.members.set(id, m); }
      Object.assign(m, {position:b.position, mic:b.mic, seen:this.now()});
      if (fresh) this.announce(false);
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
  eligible(id){return this.selected.get(id)===this.members.get(id)?.session&&this.selected.has(id);}
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
    const m = this.members.get(id); if (!m || this.peers.has(id)||!this.eligible(id)||this.peers.size>=VOICE_NEIGHBORS) return;
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
    if (!this.active || !m || m.session !== b.session || b.targetSession !== this.session||!this.eligible(id)) return;
    let p = this.peers.get(id);
    if (b.type !== 'offer' && p?.negotiation !== b.negotiation) return;
    if (b.type === 'offer') {
      if (id >= this.connection.peerId||!this.peers.has(id)&&this.peers.size>=VOICE_NEIGHBORS) return;
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
  clearPeers() { for (const id of this.peers.keys()) this.closePeer(id); this.members.clear();this.selected.clear();this.lastPresence=null;this.nextOfferAt=0; }
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
