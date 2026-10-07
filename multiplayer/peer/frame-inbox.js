// Allocation and work limits belong before JSON/base64 decoding, on both RTC and relay.
// The wire format is unchanged. A guest sends inputs, not half-megabyte world states.
export const FRAME_BYTES = 12_000;
export const MAX_MESSAGE_BYTES = 512 * 1024;
export const INBOX_LIMITS = Object.freeze({
  frameChars: 17_000, maxAssemblies: 8, assemblyMs: 15_000,
  guest: Object.freeze({messageBytes: 16 * 1024, bytesPerSecond: 256 * 1024, framesPerSecond: 160}),
  host: Object.freeze({messageBytes: MAX_MESSAGE_BYTES, bytesPerSecond: 16 * 1024 * 1024, framesPerSecond: 1500}),
});
const decoder = new TextDecoder('utf-8', {fatal:true});
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class FrameInbox {
  constructor({fromHost = false, now = () => performance.now()} = {}) {
    this.limits = fromHost ? INBOX_LIMITS.host : INBOX_LIMITS.guest;
    this.now = now; this.at = now(); this.frames = this.limits.framesPerSecond;
    this.bytes = this.limits.bytesPerSecond; this.pending = new Map(); this.retained = 0;
    this.counts = {accepted:0, rejected:0, expired:0, peakRetainedChars:0};
    this.reasons = {};
  }
  reject(reason) { this.counts.rejected++; this.reasons[reason] = (this.reasons[reason] || 0) + 1; return null; }
  remove(id) { const entry = this.pending.get(id); if (entry) { this.retained -= entry.chars; this.pending.delete(id); } }
  expire(now = this.now()) {
    for (const [id, entry] of this.pending) if (now - entry.at >= INBOX_LIMITS.assemblyMs) { this.remove(id); this.counts.expired++; }
  }
  stats() { this.expire(); return {...this.counts, reasons:{...this.reasons}, pending:this.pending.size, retainedChars:this.retained}; }
  accept(raw, epoch) {
    const now = this.now(), elapsed = Math.max(0, now - this.at) / 1000; this.at = Math.max(this.at, now);
    this.frames = Math.min(this.limits.framesPerSecond, this.frames + elapsed * this.limits.framesPerSecond);
    this.bytes = Math.min(this.limits.bytesPerSecond, this.bytes + elapsed * this.limits.bytesPerSecond);
    this.expire(now);
    // Bound even malformed input before decoding or allocating its parsed object.
    if (this.frames < 1) return this.reject('frame_rate');
    this.frames--;
    const size = typeof raw === 'string' ? raw.length : raw instanceof ArrayBuffer ? raw.byteLength : -1;
    if (size < 0 || size > INBOX_LIMITS.frameChars) return this.reject('frame_size');
    if (this.bytes < size) return this.reject('byte_rate');
    this.bytes -= size;
    let frame;
    try { frame = JSON.parse(typeof raw === 'string' ? raw : decoder.decode(raw)); } catch { return this.reject('malformed'); }
    if (!frame || frame.epoch !== epoch) return this.reject('epoch');
    if (typeof frame.id !== 'string' || !frame.id.length || frame.id.length > 128 ||
        !Number.isSafeInteger(frame.part) || !Number.isSafeInteger(frame.total) || frame.total < 1 ||
        frame.total > Math.ceil(this.limits.messageBytes / FRAME_BYTES) || frame.part < 0 || frame.part >= frame.total ||
        typeof frame.body !== 'string' || !frame.body.length || frame.body.length > FRAME_BYTES / 3 * 4 || !base64.test(frame.body))
      return this.reject('malformed');
    const bytes = frame.body.length / 4 * 3 - (frame.body.endsWith('==') ? 2 : frame.body.endsWith('=') ? 1 : 0);
    let entry = this.pending.get(frame.id);
    if (entry && entry.parts.length !== frame.total) { this.remove(frame.id); return this.reject('malformed'); }
    if (!entry) {
      if (this.pending.size >= INBOX_LIMITS.maxAssemblies) return this.reject('assembly_count');
      entry = {parts:Array(frame.total), count:0, chars:0, bytes:0, at:now};
      this.pending.set(frame.id, entry);
    }
    if (entry.parts[frame.part] !== undefined) return this.reject('duplicate_part');
    if (entry.bytes + bytes > this.limits.messageBytes) { this.remove(frame.id); return this.reject('message_size'); }
    // At most two full encoded messages retained per edge, regardless of interleaving.
    if (this.retained + frame.body.length > Math.ceil(this.limits.messageBytes / 3) * 4 * 2) {
      this.remove(frame.id); return this.reject('assembly_bytes');
    }
    entry.parts[frame.part] = frame.body; entry.count++; entry.chars += frame.body.length; entry.bytes += bytes;
    this.retained += frame.body.length;
    this.counts.peakRetainedChars = Math.max(this.counts.peakRetainedChars, this.retained);
    if (entry.count !== frame.total) return null;
    this.remove(frame.id);
    let envelope;
    try {
      const buffer = new Uint8Array(entry.bytes); let offset = 0;
      for (const part of entry.parts) { const text = atob(part); for (let i = 0; i < text.length; i++) buffer[offset++] = text.charCodeAt(i); }
      envelope = JSON.parse(decoder.decode(buffer));
    } catch { return this.reject('malformed'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return this.reject('malformed');
    this.counts.accepted++; return envelope;
  }
}
