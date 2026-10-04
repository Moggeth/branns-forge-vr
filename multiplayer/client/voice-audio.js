export const VOICE_RANGE = 32;
export const VOICE_REFERENCE = 2;
export function acousticPosition({role, xr, position, focus}) {
  // Overview zoom must not move God's ears or voice hundreds of metres away.
  return role === 'god' && !xr ? [focus[0], focus[1] + 1.65, focus[2]] : [...position];
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
    const c = this.context, source = c.createMediaStreamSource(stream), panner = c.createPanner(), gain = c.createGain();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
    panner.refDistance = VOICE_REFERENCE; panner.maxDistance = VOICE_RANGE; panner.rolloffFactor = 1;
    // Omnidirectional speaking: spatial direction comes from listener/head pose.
    panner.coneInnerAngle = 360; panner.coneOuterAngle = 360;
    gain.gain.value = 0; source.connect(panner).connect(gain).connect(this.output);
    // Chromium's RTC receiver may not start decoding until a media element plays
    // the stream. Keep it muted: ONLY the spatial Web Audio graph is audible.
    const media = typeof globalThis.Audio === 'function' ? new Audio() : null;
    if (media) { media.muted = true; media.autoplay = true; media.srcObject = stream; void media.play().catch(this.onPlaybackError); }
    this.sources.set(id, {source, panner, gain, media, muted:false});
  }
  listener(pose) {
    if (!pose) return;
    const l = this.context.listener, t = this.context.currentTime;
    if (l.positionX) {
      coordinates(l, 'position', pose.position, t); coordinates(l, 'forward', pose.forward, t); coordinates(l, 'up', pose.up, t);
    } else { l.setPosition(...pose.position); l.setOrientation(...pose.forward, ...pose.up); }
  }
  position(id, position, audible = true) {
    const s = this.sources.get(id); if (!s) return;
    const t = this.context.currentTime;
    if (s.panner.positionX) coordinates(s.panner, 'position', position, t); else s.panner.setPosition(...position);
    s.gain.gain.setTargetAtTime(audible && !s.muted ? 1 : 0, t, .025);
  }
  mute(id, value) { const s = this.sources.get(id); if (s) { s.muted = value; if (value) s.gain.gain.value = 0; } }
  deafen(value) { this.deafened = value; this.output.gain.value = value ? 0 : .85; }
  remove(id) { const s = this.sources.get(id); if (!s) return; if (s.media) { s.media.pause(); s.media.srcObject = null; } s.source.disconnect(); s.panner.disconnect(); s.gain.disconnect(); this.sources.delete(id); }
  dispose() { for (const id of this.sources.keys()) this.remove(id); this.output.disconnect(); void this.context.close().catch(() => {}); }
}
