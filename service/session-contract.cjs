'use strict';

// Pure wire validation. The caller supplies the authenticated role and current
// room lease; neither a browser field nor an invite code establishes authority.
const VERSION = 1;
const MAX_BYTES = 65536;
const MAX_ACKS = 128;
const ROLES = Object.freeze(['hero', 'fairy', 'director']);
const COMMON = Object.freeze(['ping', 'pong', 'resume']);
const TYPES = Object.freeze({
  hero: Object.freeze(['baseline', 'state', 'event', 'presence', 'ack', 'reject', ...COMMON]),
  fairy: Object.freeze(['fairy_input', 'fairy_action', ...COMMON]),
  director: Object.freeze(['director_command', 'director_camera', ...COMMON])
});
const ACTIONS = Object.freeze(['ping', 'shoot', 'reveal', 'perch', 'pickup', 'drop', 'use']);
const CARDS = Object.freeze(['skeletons', 'wisps', 'golem', 'gloom']);
const LANES = Object.freeze(['west', 'north', 'east']);
const FIELDS = Object.freeze(['v', 'sessionId', 'roomEpoch', 'roleGeneration', 'type', 'seq', 'messageId', 'sentAtMs', 'payload']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const token = (value, max = 64) => typeof value === 'string' && value.length >= 1 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const vec2 = value => keys(value, ['x', 'y']) && number(value.x, -1, 1) && number(value.y, -1, 1);

function payloadValid(type, p) {
  switch (type) {
    case 'ping': case 'pong': return keys(p, []);
    case 'resume': return keys(p, ['lastStateSeq']) && integer(p.lastStateSeq, 0);
    case 'fairy_input':
      return keys(p, ['move', 'aim', 'buttons']) && vec2(p.move) && vec2(p.aim) &&
        Array.isArray(p.buttons) && p.buttons.length <= 8 && new Set(p.buttons).size === p.buttons.length &&
        p.buttons.every(button => ACTIONS.includes(button));
    case 'fairy_action':
      return keys(p, ['action'], ['targetId']) && ACTIONS.includes(p.action) &&
        (!Object.hasOwn(p, 'targetId') || token(p.targetId));
    case 'director_command':
      return keys(p, ['command'], ['lane']) &&
        (p.command === 'start' || p.command === 'rematch'
          ? !Object.hasOwn(p, 'lane')
          : CARDS.includes(p.command) && LANES.includes(p.lane));
    case 'director_camera':
      return keys(p, ['yaw', 'pitch', 'zoom']) && number(p.yaw, -Math.PI * 4, Math.PI * 4) &&
        number(p.pitch, 0.38, 1.25) && number(p.zoom, 25, 65);
    case 'baseline':
      return keys(p, ['stateSeq', 'world']) && integer(p.stateSeq, 0) && worldValid(p.world);
    case 'state':
      return keys(p, ['stateSeq', 'entities']) && integer(p.stateSeq, 1) && entitiesValid(p.entities);
    case 'event':
      return keys(p, ['stateSeq', 'eventId', 'kind']) && integer(p.stateSeq, 1) && token(p.eventId) && token(p.kind, 32);
    case 'presence':
      return keys(p, ['fairy', 'director']) && ['vacant', 'local', 'remote', 'grace'].includes(p.fairy) &&
        ['vacant', 'remote', 'grace'].includes(p.director);
    case 'ack': case 'reject':
      return keys(p, ['messageId', 'reason']) && token(p.messageId) && token(p.reason, 32);
    default: return false;
  }
}

function entitiesValid(entities) {
  return Array.isArray(entities) && entities.length <= 128 && entities.every(entity =>
    keys(entity, ['id', 'zoneId', 'x', 'y', 'z']) && token(entity.id) && token(entity.zoneId, 32) &&
    number(entity.x, -10000, 10000) && number(entity.y, -10000, 10000) && number(entity.z, -10000, 10000));
}

function worldValid(world) {
  return keys(world, ['zoneId', 'entities']) && token(world.zoneId, 32) && entitiesValid(world.entities);
}

function frameBytes(raw) {
  return typeof raw === 'string' ? Buffer.byteLength(raw) : Buffer.isBuffer(raw) ? raw.length : -1;
}

function validateFrame(raw, role) {
  if (!ROLES.includes(role)) return { ok: false, reason: 'invalid_role' };
  if (frameBytes(raw) < 2 || frameBytes(raw) > MAX_BYTES) return { ok: false, reason: 'invalid_size' };
  let frame;
  try { frame = JSON.parse(raw.toString()); } catch { return { ok: false, reason: 'invalid_json' }; }
  if (!keys(frame, FIELDS)) return { ok: false, reason: 'invalid_envelope' };
  if (frame.v !== VERSION) return { ok: false, reason: 'invalid_version' };
  if (!token(frame.sessionId) || !integer(frame.roomEpoch, 1) || !integer(frame.roleGeneration, 1) ||
      !integer(frame.seq, 1) || !token(frame.messageId) || !integer(frame.sentAtMs, 0))
    return { ok: false, reason: 'invalid_envelope' };
  if (!TYPES[role].includes(frame.type)) return { ok: false, reason: 'forbidden_type' };
  if (!payloadValid(frame.type, frame.payload)) return { ok: false, reason: 'invalid_payload' };
  return { ok: true, frame };
}

class SequenceGate {
  constructor({ sessionId, roomEpoch, roleGeneration, role, maxAcks = MAX_ACKS }) {
    if (!token(sessionId) || !integer(roomEpoch, 1) || !integer(roleGeneration, 1) ||
        !ROLES.includes(role) || !integer(maxAcks, 1, MAX_ACKS)) throw new TypeError('Invalid gate context');
    this.sessionId = sessionId;
    this.roomEpoch = roomEpoch;
    this.roleGeneration = roleGeneration;
    this.role = role;
    this.maxAcks = maxAcks;
    this.seq = 0;
    this.stateSeq = -1;
    this.acks = new Map();
  }

  // The lease owner must call this only after authorizing a new room epoch or
  // role lease. Old frames are never allowed to advance context themselves.
  advance({ roomEpoch, roleGeneration }) {
    if (!integer(roomEpoch, this.roomEpoch) || !integer(roleGeneration, 1) ||
        (roomEpoch === this.roomEpoch && roleGeneration <= this.roleGeneration))
      throw new RangeError('Context must advance');
    this.roomEpoch = roomEpoch;
    this.roleGeneration = roleGeneration;
    this.seq = 0;
    this.stateSeq = -1;
    this.acks.clear();
  }

  decide(raw) {
    const validation = validateFrame(raw, this.role);
    if (!validation.ok) return { status: 'reject', reason: validation.reason };
    const frame = validation.frame;
    if (frame.sessionId !== this.sessionId) return { status: 'reject', reason: 'wrong_session' };
    if (frame.roomEpoch !== this.roomEpoch) return { status: 'reject', reason: 'stale_room_epoch' };
    if (frame.roleGeneration !== this.roleGeneration) return { status: 'reject', reason: 'stale_role_generation' };
    const fingerprint = JSON.stringify(frame);
    const prior = this.acks.get(frame.messageId);
    if (prior) return prior.seq === frame.seq && prior.fingerprint === fingerprint
      ? { status: 'replay', frame, decision: prior.decision }
      : { status: 'reject', reason: 'message_id_conflict' };
    if (frame.seq !== this.seq + 1) return { status: 'reject', reason: 'sequence_gap' };
    if (this.role === 'hero' && ['baseline', 'state', 'event'].includes(frame.type)) {
      const next = frame.payload.stateSeq;
      if (frame.type === 'baseline') {
        if (next < this.stateSeq) return { status: 'reject', reason: 'stale_state' };
      } else if (this.stateSeq < 0 || next !== this.stateSeq + 1) {
        return { status: 'reject', reason: 'state_gap' };
      }
      this.stateSeq = next;
    }
    this.seq = frame.seq;
    const decision = Object.freeze({ status: 'accept', frame });
    this.acks.set(frame.messageId, { seq: frame.seq, fingerprint, decision });
    if (this.acks.size > this.maxAcks) this.acks.delete(this.acks.keys().next().value);
    return decision;
  }
}

module.exports = { VERSION, MAX_BYTES, MAX_ACKS, ROLES, TYPES, validateFrame, SequenceGate };
