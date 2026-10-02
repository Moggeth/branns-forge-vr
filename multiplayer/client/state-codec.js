// Versioned JSON delta codec for the 20 Hz guest snapshot stream.
//
// The host quantizes (wire-quantize.js) and then publishes each snapshot once. Every capable peer has
// its own (stream, seq) base and receives either a delta against the snapshot it last received or a
// keyframe. Old peers keep the legacy {kind:'snapshot'} message. Checkpoints and saves never pass
// through this module, so they stay full and unquantized.
//
// Wire (all plain JSON inside the existing peer 'message' envelope):
//   host -> guest {kind:'snapshot_delta', epoch, v:1, s:stream, n:seq, b:baseSeq|-1, h:fnv32, k:snapshot | p:patch}
//   guest -> host {kind:'snapshot_codec', epoch, v:[1], need?:'key'}   (capability hello / resync request)
// Patch node P (tagged arrays, so data keys never collide with codec syntax):
//   [0, value]                      replace with value
//   [1, {key:P}, del?|0, order?]    object: changed/added keys, deleted keys, explicit key order if not natural
//   [2, kind, [[key,P]], del?|0, order?]  id-keyed array (kind 0: element.id, kind 1: "x,z" for fireCells)
//   [3, length, [[index,P]]]        positional array of objects
//   [4, {key:value}]                object whose changed/added keys are all whole replacements (compact [1,...])
// The channels are reliable and ordered, but either end may still drop a frame (buffer limits, receive rate
// limits, host migration), so every delta names its base, carries a hash of the full result and is refused
// unless it applies to exactly that base. Refusals ask the host for a keyframe; periodic keyframes bound
// recovery even if that request is lost.

export const CODEC_VERSION = 1;
export const CODEC_LIMITS = Object.freeze({
  depth: 24, nodes: 250_000, arrayLength: 4096, keyLength: 256, streamLength: 64,
  snapshotBytes: 2_000_000, keyframeEvery: 100, resyncMs: 500, peers: 32,
});
const SET = 0, OBJ = 1, KEYED = 2, LIST = 3, REPLACE = 4;
const KIND_ID = 0, KIND_XZ = 1;

export class CodecError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const bad = code => { throw new CodecError(code); };
const hasOwn = Object.hasOwn;
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// FNV-1a over UTF-16 code units of the canonical JSON text: cheap and identical in every JS engine.
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Walks a JSON value: bounded depth, node count and array length; rejects prototype-polluting keys.
function checkValue(value, depth, ctx) {
  if (++ctx.nodes > ctx.limits.nodes) bad('too_large');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) bad('not_finite');
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean' && value !== null) bad('not_json');
    return;
  }
  if (depth > ctx.limits.depth) bad('too_deep');
  if (Array.isArray(value)) {
    if (value.length > ctx.limits.arrayLength) bad('too_long');
    for (const item of value) checkValue(item, depth + 1, ctx);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) bad('not_plain');
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key.length > ctx.limits.keyLength) bad('bad_key');
    checkValue(value[key], depth + 1, ctx);
  }
}

// ---- array keying -------------------------------------------------------------------------------

const validId = v => (typeof v === 'string' && v.length <= 256) || (typeof v === 'number' && Number.isFinite(v));
const keyXZ = e => `${e.x},${e.z}`;
// Returns KIND_ID / KIND_XZ when every element has a unique key of that kind, null otherwise.
function arrayKind(arr) {
  if (!arr.length || !arr.every(isRecord)) return null;
  if (arr.every(e => validId(e.id))) { const ids = new Set(arr.map(e => e.id)); if (ids.size === arr.length) return KIND_ID; }
  if (arr.every(e => !hasOwn(e, 'id') && typeof e.x === 'number' && typeof e.z === 'number')) {
    const keys = new Set(arr.map(keyXZ)); if (keys.size === arr.length) return KIND_XZ;
  }
  return null;
}
const keyFn = kind => kind === KIND_ID ? e => e.id : keyXZ;

// ---- diff (encoder) -----------------------------------------------------------------------------

function sameOrder(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

function diff(a, b) {
  if (a === b) return undefined;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [SET, b];
  return Array.isArray(b) ? diffArray(a, b) : diffObject(a, b);
}

function diffObject(a, b) {
  const changes = {}, bKeys = Object.keys(b), del = [], expected = [];
  let changed = false, whole = true;
  for (const key of Object.keys(a)) { if (hasOwn(b, key)) expected.push(key); else del.push(key); }
  for (const key of bKeys) {
    if (hasOwn(a, key)) { const p = diff(a[key], b[key]); if (p !== undefined) { changes[key] = p; changed = true; if (p[0] !== SET) whole = false; } }
    else { changes[key] = [SET, b[key]]; expected.push(key); changed = true; }
  }
  const order = sameOrder(expected, bKeys) ? null : bKeys;
  if (!changed && !del.length && !order) return undefined;
  if (whole && !del.length && !order) { for (const key in changes) changes[key] = changes[key][1]; return [REPLACE, changes]; }
  return order ? [OBJ, changes, del.length ? del : 0, order] : del.length ? [OBJ, changes, del] : [OBJ, changes];
}

function diffArray(a, b) {
  if (!b.length) return a.length ? [SET, b] : undefined;
  const kind = arrayKind(b);
  if (kind !== null && (a.length === 0 || arrayKind(a) === kind)) {
    const key = keyFn(kind), old = new Map(a.map(e => [key(e), e])), upd = [], expected = [], present = new Set();
    const bKeys = b.map(key);
    for (let i = 0; i < b.length; i++) present.add(bKeys[i]);
    const del = [];
    for (const e of a) { const k = key(e); if (present.has(k)) expected.push(k); else del.push(k); }
    for (let i = 0; i < b.length; i++) {
      const k = bKeys[i], prev = old.get(k);
      if (prev === undefined) { upd.push([k, [SET, b[i]]]); expected.push(k); }
      else { const p = diff(prev, b[i]); if (p !== undefined) upd.push([k, p]); }
    }
    const order = sameOrder(expected, bKeys) ? null : bKeys;
    if (!upd.length && !del.length && !order) return undefined;
    const out = [KEYED, kind, upd];
    if (del.length || order) out.push(del.length ? del : 0);
    if (order) out.push(order);
    return out;
  }
  // Positional: objects/arrays get per-index patches; primitive arrays (poses, part lists) are replaced whole.
  let structured = false;
  for (const item of b) if (item !== null && typeof item === 'object') { structured = true; break; }
  if (!structured) {
    if (a.length === b.length) { let same = true; for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) { same = false; break; } if (same) return undefined; }
    return [SET, b];
  }
  const ops = [];
  for (let i = 0; i < b.length; i++) {
    const p = i < a.length ? diff(a[i], b[i]) : [SET, b[i]];
    if (p !== undefined) ops.push([i, p]);
  }
  if (!ops.length && a.length === b.length) return undefined;
  return [LIST, b.length, ops];
}

/** Pure: patch that turns `base` into `next` (both JSON values), or undefined when they are equal. */
export function encodeDelta(base, next) { return diff(base, next); }

// ---- apply (decoder) ----------------------------------------------------------------------------

const MISSING = Symbol('missing');

function apply(base, p, depth, ctx) {
  if (!Array.isArray(p) || depth > ctx.limits.depth) bad('malformed');
  if (++ctx.nodes > ctx.limits.nodes) bad('too_large');
  const op = p[0];
  if (op === SET) {
    if (p.length !== 2) bad('malformed');
    checkValue(p[1], depth, ctx); return p[1];
  }
  if (base === MISSING) bad('missing_base');
  if (op === OBJ) return applyObject(base, p, depth, ctx);
  if (op === KEYED) return applyKeyed(base, p, depth, ctx);
  if (op === LIST) return applyList(base, p, depth, ctx);
  if (op === REPLACE) return applyReplace(base, p, depth, ctx);
  return bad('malformed');
}

function keyList(list, ctx, check) {
  if (list === undefined || list === 0) return [];
  if (!Array.isArray(list) || list.length > ctx.limits.arrayLength) bad('malformed');
  for (const k of list) if (!check(k)) bad('malformed');
  return list;
}
const stringKey = ctx => k => typeof k === 'string' && k.length <= ctx.limits.keyLength && k !== '__proto__';

function applyObject(base, p, depth, ctx) {
  const [, changes, delRaw, orderRaw] = p;
  if (p.length < 2 || p.length > 4 || !isRecord(base) || !isRecord(changes)) bad('malformed');
  const del = new Set(keyList(delRaw, ctx, stringKey(ctx)));
  const changeKeys = Object.keys(changes);
  if (changeKeys.length > ctx.limits.arrayLength) bad('too_long');
  for (const k of changeKeys) if (!stringKey(ctx)(k) || del.has(k)) bad('malformed');
  for (const k of del) if (!hasOwn(base, k)) bad('missing_base');
  let order;
  if (orderRaw !== undefined) {
    order = keyList(orderRaw, ctx, stringKey(ctx));
    const unique = new Set(order);
    const expected = Object.keys(base).filter(k => !del.has(k)).concat(changeKeys.filter(k => !hasOwn(base, k)));
    if (unique.size !== order.length || unique.size !== expected.length || !expected.every(k => unique.has(k))) bad('malformed');
  } else {
    order = Object.keys(base).filter(k => !del.has(k));
    for (const k of changeKeys) if (!hasOwn(base, k)) order.push(k);
  }
  const out = {};
  for (const k of order) out[k] = hasOwn(changes, k) ? apply(hasOwn(base, k) ? base[k] : MISSING, changes[k], depth + 1, ctx) : base[k];
  return out;
}

function applyReplace(base, p, depth, ctx) {
  const [, values] = p;
  if (p.length !== 2 || !isRecord(base) || !isRecord(values)) bad('malformed');
  const keys = Object.keys(values);
  if (keys.length > ctx.limits.arrayLength) bad('too_long');
  const out = {};
  for (const k of Object.keys(base)) out[k] = base[k];
  for (const k of keys) {
    if (!stringKey(ctx)(k)) bad('malformed');
    checkValue(values[k], depth + 1, ctx); out[k] = values[k];
  }
  return out;
}

function applyKeyed(base, p, depth, ctx) {
  const [, kind, upd, delRaw, orderRaw] = p;
  if (p.length < 3 || p.length > 5 || !Array.isArray(base) || (kind !== KIND_ID && kind !== KIND_XZ) || !Array.isArray(upd) || upd.length > ctx.limits.arrayLength) bad('malformed');
  const key = keyFn(kind), validKey = kind === KIND_ID ? validId : stringKey(ctx);
  const current = new Map();
  for (const e of base) {
    if (!isRecord(e)) bad('missing_base');
    const k = key(e); if (!validKey(k) || current.has(k)) bad('missing_base');
    current.set(k, e);
  }
  const del = keyList(delRaw, ctx, validKey);
  for (const k of del) if (!current.delete(k)) bad('missing_base');
  const deleted = new Set(del), added = [], touched = new Set();
  for (const entry of upd) {
    if (!Array.isArray(entry) || entry.length !== 2 || !validKey(entry[0]) || touched.has(entry[0]) || deleted.has(entry[0])) bad('malformed');
    const [k, patch] = entry; touched.add(k);
    const prev = current.has(k) ? current.get(k) : MISSING;
    const value = apply(prev, patch, depth + 1, ctx);
    if (!isRecord(value) || key(value) !== k) bad('malformed');
    if (prev === MISSING) added.push(k);
    current.set(k, value);
  }
  if (current.size > ctx.limits.arrayLength) bad('too_long');
  let order;
  if (orderRaw !== undefined) {
    order = keyList(orderRaw, ctx, validKey);
    if (new Set(order).size !== order.length || order.length !== current.size || !order.every(k => current.has(k))) bad('malformed');
  } else {
    order = [];
    for (const e of base) { const k = key(e); if (!deleted.has(k)) order.push(k); }
    order.push(...added);
  }
  return order.map(k => current.get(k));
}

function applyList(base, p, depth, ctx) {
  const [, length, ops] = p;
  if (p.length !== 3 || !Array.isArray(base) || !Number.isSafeInteger(length) || length < 0 || length > ctx.limits.arrayLength || !Array.isArray(ops) || ops.length > length) bad('malformed');
  const out = base.slice(0, length), seen = new Set();
  for (const entry of ops) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || entry[0] >= length || seen.has(entry[0])) bad('malformed');
    seen.add(entry[0]);
    out[entry[0]] = apply(entry[0] < base.length ? base[entry[0]] : MISSING, entry[1], depth + 1, ctx);
  }
  for (let i = base.length; i < length; i++) if (!seen.has(i)) bad('malformed');
  return out;
}

/** Pure: applies a patch from encodeDelta to `base`. Throws CodecError on malformed or mismatched input. */
export function applyDelta(base, patch, limits = CODEC_LIMITS) {
  if (patch === undefined) return base;
  return apply(base, patch, 0, {nodes: 0, limits});
}

const validSnapshot = s => isRecord(s) && Number.isSafeInteger(s.tick) && Array.isArray(s.players);

// ---- per-peer stream state ----------------------------------------------------------------------

const randomStream = () => {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

/** Guest capability hello; also used as the keyframe (resync) request with need:'key'. */
export function codecHello(need = false) { return need ? {kind: 'snapshot_codec', v: [CODEC_VERSION], need: 'key'} : {kind: 'snapshot_codec', v: [CODEC_VERSION]}; }
export function supportsCodec(message) { return isRecord(message) && Array.isArray(message.v) && message.v.length <= 8 && message.v.includes(CODEC_VERSION); }

/**
 * Host side. publish() once per 20 Hz snapshot (already quantized), then frame(peerId, epoch) for each
 * peer: a snapshot_delta message, or null for peers without the capability (send them the legacy
 * snapshot). If a send fails, call resync(peerId). Call reset() on host promotion / world reset.
 */
export class SnapshotDeltaEncoder {
  constructor({keyframeEvery = CODEC_LIMITS.keyframeEvery, limits = CODEC_LIMITS, verify = true} = {}) {
    this.keyframeEvery = Math.max(1, keyframeEvery); this.limits = limits; this.verify = verify;
    this.peers = new Map(); this.seq = 0; this.stream = randomStream();
    this.current = null; this.previous = null; this.delta = undefined;
    this.stats = {keyframes: 0, deltas: 0, publishMs: 0, diffMs: 0};
  }
  get size() { return this.peers.size; }
  enable(peerId) {
    if (!this.peers.has(peerId) && this.peers.size >= this.limits.peers) return false;
    this.peers.set(peerId, {base: -1, keyAt: -Infinity, needKey: true});
    return true;
  }
  forget(peerId) { this.peers.delete(peerId); }
  resync(peerId) { const peer = this.peers.get(peerId); if (peer) peer.needKey = true; }
  reset() {
    this.stream = randomStream(); this.current = null; this.previous = null; this.delta = undefined;
    for (const peer of this.peers.values()) { peer.base = -1; peer.needKey = true; }
  }
  /** Registers the next quantized snapshot. Throws CodecError when it cannot be encoded (send legacy). */
  publish(snapshot) {
    const start = performance.now();
    const text = JSON.stringify(snapshot);
    if (typeof text !== 'string' || text.length > this.limits.snapshotBytes) { this.reset(); bad('too_large'); }
    const next = JSON.parse(text); // Exactly what JSON transport would deliver; also detaches from the caller.
    try { checkValue(next, 0, {nodes: 0, limits: this.limits}); if (!validSnapshot(next)) bad('schema'); }
    catch (error) { this.reset(); throw error; }
    this.previous = this.current;
    this.current = {seq: ++this.seq, value: next, hash: this.verify ? hashText(text) : undefined};
    this.delta = undefined;
    this.stats.publishMs += performance.now() - start;
    return this.current.seq;
  }
  #patch() {
    if (this.delta === undefined) {
      const start = performance.now();
      this.delta = encodeDelta(this.previous.value, this.current.value) ?? null;
      this.stats.diffMs += performance.now() - start;
    }
    return this.delta;
  }
  frame(peerId, epoch) {
    const peer = this.peers.get(peerId), cur = this.current;
    if (!peer || !cur) return null;
    const base = this.previous?.seq;
    const key = peer.needKey || peer.base !== base || base === undefined || cur.seq - peer.keyAt >= this.keyframeEvery;
    const message = {kind: 'snapshot_delta', epoch, v: CODEC_VERSION, s: this.stream, n: cur.seq, b: key ? -1 : base};
    if (cur.hash !== undefined) message.h = cur.hash;
    if (key) {
      message.k = cur.value; peer.needKey = false; this.stats.keyframes++;
      // Stagger periodic keyframes so peers that joined together do not all get one on the same tick.
      peer.keyAt = peer.keyAt === -Infinity ? cur.seq - (hashText(String(peerId)) % this.keyframeEvery) : cur.seq;
    } else {
      const patch = this.#patch();
      if (patch !== null) message.p = patch;
      this.stats.deltas++;
    }
    peer.base = cur.seq;
    return message;
  }
}

/**
 * Guest side. accept(message) returns {snapshot} when a full snapshot is available, or {error} plus an
 * optional `request` (codecHello(true)) to send to the host, rate limited. The returned snapshot is a
 * fresh object each time, so renderers may mutate it without corrupting the delta base.
 */
export class SnapshotDeltaDecoder {
  constructor({limits = CODEC_LIMITS, resyncMs = CODEC_LIMITS.resyncMs, now = () => Date.now()} = {}) {
    this.limits = limits; this.resyncMs = resyncMs; this.now = now;
    this.stats = {applied: 0, keyframes: 0, rejected: 0, stale: 0, requests: 0};
    this.reset();
  }
  reset() { this.stream = null; this.seq = -1; this.base = null; this.lastRequest = -Infinity; }
  #refuse(error) {
    this.stats.rejected++;
    const now = this.now();
    if (now - this.lastRequest < this.resyncMs) return {error};
    this.lastRequest = now; this.stats.requests++;
    return {error, request: codecHello(true)};
  }
  accept(message) {
    const m = message;
    if (!isRecord(m) || m.kind !== 'snapshot_delta') return this.#refuse('malformed');
    if (m.v !== CODEC_VERSION) return this.#refuse('version');
    if (typeof m.s !== 'string' || !m.s || m.s.length > this.limits.streamLength || !Number.isSafeInteger(m.n) || m.n < 1 ||
        !Number.isSafeInteger(m.b) || m.b < -1 || m.b >= m.n || (m.h !== undefined && (!Number.isSafeInteger(m.h) || m.h < 0 || m.h > 0xffffffff)) ||
        (m.b === -1) !== hasOwn(m, 'k') || (hasOwn(m, 'k') && hasOwn(m, 'p'))) return this.#refuse('malformed');
    if (m.s === this.stream && m.n <= this.seq) { this.stats.stale++; return {error: 'stale'}; }
    let value;
    try {
      if (m.b === -1) {
        checkValue(m.k, 0, {nodes: 0, limits: this.limits}); value = m.k;
      } else {
        if (m.s !== this.stream || this.base === null) return this.#refuse('missing_base');
        if (m.b !== this.seq) return this.#refuse('gap');
        value = hasOwn(m, 'p') ? applyDelta(this.base, m.p, this.limits) : this.base;
      }
      if (!validSnapshot(value)) bad('schema');
    } catch (error) { return this.#refuse(error instanceof CodecError ? error.code : 'malformed'); }
    const text = JSON.stringify(value);
    if (text.length > this.limits.snapshotBytes) return this.#refuse('too_large');
    if (m.h !== undefined && hashText(text) !== m.h) return this.#refuse('hash_mismatch');
    this.stream = m.s; this.seq = m.n; this.base = value;
    if (m.b === -1) this.stats.keyframes++; else this.stats.applied++;
    return {snapshot: JSON.parse(text)};
  }
}
