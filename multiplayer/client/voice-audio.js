export const VOICE_RANGE = 32;
export const VOICE_REFERENCE = 2;
// Speaking detection: RMS of the raw (pre-distance) voice, held briefly so
// the indicator does not flicker between words.
export const SPEAKING_THRESHOLD = .018, SPEAKING_HOLD_MS = 450;
// 'room': both in one tavern, heard clearly across it. 'wall': one side of a
// zone edge, muffled and quieter. 'open': normal outdoor falloff.
const MIX = {open:{ref:VOICE_REFERENCE, max:VOICE_RANGE, cutoff:20000, gain:1}, room:{ref:24, max:VOICE_RANGE + 8, cutoff:20000, gain:1}, wall:{ref:VOICE_REFERENCE, max:VOICE_RANGE, cutoff:700, gain:.4}};
export function acousticPosition({role, xr, position, focus}) {
  // Overview zoom must not move God's ears or voice hundreds of metres away.
  return role === 'god' && !xr ? [focus[0], focus[1] + 1.65, focus[2]] : [...position];
}
function rms(analyser, owner) {
  if (!analyser?.getFloatTimeDomainData) return 0;
  const data = owner.scratch?.length === analyser.fftSize ? owner.scratch : (owner.scratch = new Float32Array(analyser.fftSize));
  analyser.getFloatTimeDomainData(data);
  let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}
function coordinates(node, prefix, values, time) {
  for (let i = 0; i < 3; i++) node[prefix + 'XYZ'[i]].setTargetAtTime(values[i], time, .035);
}
export class VoiceAudio {
  constructor(context, onPlaybackError = () => {}) {
    this.onPlaybackError = onPlaybackError;
    this.context = context; this.sources = new Map(); this.deafened = false;
    this.output = context.createGain(); this.output.gain.value = .85; this.output.connect(context.destination);
  }
  add(id, stream) {
    this.remove(id);
    const c = this.context, source = c.createMediaStreamSource(stream), panner = c.createPanner(), gain = c.createGain(), filter = c.createBiquadFilter?.(), analyser = c.createAnalyser?.();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
    panner.refDistance = VOICE_REFERENCE; panner.maxDistance = VOICE_RANGE; panner.rolloffFactor = 1;
    // Omnidirectional speaking: spatial direction comes from listener/head pose.
    panner.coneInnerAngle = 360; panner.coneOuterAngle = 360;
    gain.gain.value = 0;
    if (filter) { filter.type = 'lowpass'; filter.frequency.value = 20000; source.connect(panner).connect(filter).connect(gain).connect(this.output); }
    else source.connect(panner).connect(gain).connect(this.output);
    if (analyser) { analyser.fftSize = 1024; source.connect(analyser); }
    // Chromium's RTC receiver may not start decoding until a media element plays
    // the stream. Keep it muted: ONLY the spatial Web Audio graph is audible.
    const media = typeof globalThis.Audio === 'function' ? new Audio() : null;
    if (media) { media.muted = true; media.autoplay = true; media.srcObject = stream; void media.play().catch(this.onPlaybackError); }
    this.sources.set(id, {source, panner, gain, filter, analyser, media, muted:false, relation:'open', loud:0});
  }
  listener(pose) {
    if (!pose) return;
    const l = this.context.listener, t = this.context.currentTime;
    if (l.positionX) {
      coordinates(l, 'position', pose.position, t); coordinates(l, 'forward', pose.forward, t); coordinates(l, 'up', pose.up, t);
    } else { l.setPosition(...pose.position); l.setOrientation(...pose.forward, ...pose.up); }
  }
  position(id, position, audible = true, relation = 'open') {
    const s = this.sources.get(id); if (!s) return;
    const t = this.context.currentTime, mix = MIX[relation] || MIX.open;
    if (s.panner.positionX) coordinates(s.panner, 'position', position, t); else s.panner.setPosition(...position);
    if (s.relation !== relation) { s.relation = relation; s.panner.refDistance = mix.ref; s.panner.maxDistance = mix.max; }
    s.filter?.frequency.setTargetAtTime(mix.cutoff, t, .08);
    s.gain.gain.setTargetAtTime(audible && !s.muted ? mix.gain : 0, t, .025);
  }
  /** Raw speech level of one remote voice (0..~0.5), independent of distance. */
  level(id) { return rms(this.sources.get(id)?.analyser, this); }
  /** Watch the local microphone for the "you are talking" indicator. Never routed to the speakers. */
  watchMicrophone(stream) {
    this.unwatchMicrophone();
    const c = this.context; if (!stream || !c.createAnalyser) return;
    const source = c.createMediaStreamSource(stream), analyser = c.createAnalyser(), sink = c.createGain();
    analyser.fftSize = 1024; sink.gain.value = 0; source.connect(analyser).connect(sink).connect(c.destination);
    this.microphone = {source, analyser, sink};
  }
  unwatchMicrophone() { const m = this.microphone; if (!m) return; this.microphone = null; m.source.disconnect(); m.analyser.disconnect(); m.sink.disconnect(); }
  microphoneLevel() { return rms(this.microphone?.analyser, this); }
  mute(id, value) { const s = this.sources.get(id); if (s) { s.muted = value; if (value) s.gain.gain.value = 0; } }
  deafen(value) { this.deafened = value; this.output.gain.value = value ? 0 : .85; }
  remove(id) { const s = this.sources.get(id); if (!s) return; if (s.media) { s.media.pause(); s.media.srcObject = null; } s.source.disconnect(); s.panner.disconnect(); s.filter?.disconnect(); s.analyser?.disconnect(); s.gain.disconnect(); this.sources.delete(id); }
  dispose() { for (const id of this.sources.keys()) this.remove(id); this.unwatchMicrophone(); this.output.disconnect(); void this.context.close().catch(() => {}); }
}
