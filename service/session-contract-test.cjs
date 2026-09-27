'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VERSION, MAX_BYTES, validateFrame, SequenceGate } = require('./session-contract.cjs');

const id = 'room_123';
const make = (type, payload, overrides = {}) => JSON.stringify({
  v: VERSION, sessionId: id, roomEpoch: 1, roleGeneration: 1,
  type, seq: 1, messageId: 'msg_1', sentAtMs: 1000, payload, ...overrides
});
const gate = role => new SequenceGate({ sessionId: id, roomEpoch: 1, roleGeneration: 1, role });

test('role is supplied by authenticated caller and cross-role commands fail', () => {
  const command = make('director_command', { command: 'skeletons', lane: 'west' });
  assert.equal(validateFrame(command, 'director').ok, true);
  assert.equal(validateFrame(command, 'fairy').reason, 'forbidden_type');
  assert.equal(validateFrame(make('baseline', { stateSeq: 0, world: { zoneId: 'pinewood', entities: [] } }), 'director').reason, 'forbidden_type');
  assert.equal(validateFrame(make('fairy_action', { action: 'shoot' }), 'hero').reason, 'forbidden_type');
  assert.equal(validateFrame(command, 'spectator').reason, 'invalid_role');
});

test('JSON, size, version, unknown fields, and nonfinite values are rejected', () => {
  assert.equal(validateFrame('{x', 'fairy').reason, 'invalid_json');
  assert.equal(validateFrame(' '.repeat(MAX_BYTES + 1), 'fairy').reason, 'invalid_size');
  assert.equal(validateFrame(make('ping', {}, { v: 2 }), 'fairy').reason, 'invalid_version');
  assert.equal(validateFrame(make('ping', {}, { participantId: 'forged' }), 'fairy').reason, 'invalid_envelope');
  assert.equal(validateFrame(make('director_camera', { yaw: 0, pitch: 0.8, zoom: 1e300 }), 'director').reason, 'invalid_payload');
  assert.equal(validateFrame(make('fairy_input', { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, buttons: ['shoot', 'shoot'] }), 'fairy').reason, 'invalid_payload');
  assert.equal(validateFrame(make('fairy_action', { action: 'shoot', damage: 999 }), 'fairy').reason, 'invalid_payload');
  assert.equal(validateFrame(make('director_command', { command: 'start', lane: 'west' }), 'director').reason, 'invalid_payload');
  assert.equal(validateFrame(make('baseline', { stateSeq: 0, world: { zoneId: 'z', entities: [], save: 'private' } }), 'hero').reason, 'invalid_payload');
});

test('sequence gap, replay, and message-id conflict decisions are deterministic', () => {
  const g = gate('director');
  const first = make('director_command', { command: 'start' });
  assert.equal(g.decide(first).status, 'accept');
  assert.equal(g.decide(first).status, 'replay');
  assert.equal(g.decide(make('director_command', { command: 'rematch' })).reason, 'message_id_conflict');
  const third = make('ping', {}, { seq: 3, messageId: 'msg_3' });
  assert.equal(g.decide(third).reason, 'sequence_gap');
  assert.equal(g.decide(make('ping', {}, { seq: 2, messageId: 'msg_2' })).status, 'accept');
  assert.equal(g.decide(third).status, 'accept');
  assert.equal(g.decide(first).status, 'replay');
});

test('old epochs and role generations fail even when a sequence restarts', () => {
  const g = gate('fairy');
  const old = make('fairy_action', { action: 'ping' });
  assert.equal(g.decide(old).status, 'accept');
  g.advance({ roomEpoch: 1, roleGeneration: 2 });
  assert.equal(g.decide(old).reason, 'stale_role_generation');
  const current = make('fairy_action', { action: 'ping' }, { roleGeneration: 2 });
  assert.equal(g.decide(current).status, 'accept');
  g.advance({ roomEpoch: 2, roleGeneration: 1 });
  assert.equal(g.decide(current).reason, 'stale_room_epoch');
  assert.equal(g.decide(make('ping', {}, { roomEpoch: 2 })).status, 'accept');
  assert.throws(() => g.advance({ roomEpoch: 2, roleGeneration: 1 }), /advance/);
});

test('hero baseline establishes state sequence and gaps require a new baseline', () => {
  const g = gate('hero');
  const state = (seq, stateSeq) => make('state', { stateSeq, entities: [] }, { seq, messageId: `msg_${seq}` });
  assert.equal(g.decide(state(1, 1)).reason, 'state_gap');
  assert.equal(g.decide(make('baseline', { stateSeq: 40, world: { zoneId: 'pinewood', entities: [] } })).status, 'accept');
  assert.equal(g.decide(state(2, 42)).reason, 'state_gap');
  assert.equal(g.decide(state(2, 41)).status, 'accept');
  assert.equal(g.decide(make('baseline', { stateSeq: 40, world: { zoneId: 'pinewood', entities: [] } }, { seq: 3, messageId: 'msg_3' })).reason, 'stale_state');
  assert.equal(g.decide(make('baseline', { stateSeq: 49, world: { zoneId: 'pinewood', entities: [] } }, { seq: 3, messageId: 'msg_3' })).status, 'accept');
});

test('ack cache is bounded; evicted repeats remain blocked by sequence', () => {
  const g = new SequenceGate({ sessionId: id, roomEpoch: 1, roleGeneration: 1, role: 'director', maxAcks: 2 });
  for (let seq = 1; seq <= 3; seq++) assert.equal(g.decide(make('ping', {}, { seq, messageId: `m_${seq}` })).status, 'accept');
  assert.equal(g.acks.size, 2);
  assert.equal(g.decide(make('ping', {}, { seq: 1, messageId: 'm_1' })).reason, 'sequence_gap');
});
