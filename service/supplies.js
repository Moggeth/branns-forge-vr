'use strict';

// Persistent token ledger for physical bolts. Supply itself is unlimited. This module has
// no dependency on World so it can be used by combat and inventory code alike.
const PACK_SIZE = 6;
const MAX_STOCK = 120;
const MAX_TOKENS = 240;
const MAX_RECEIPTS = 128;
const VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,99}$/;

function ensure(world) {
  assertWorld(world);
  if (world.player.supplies === undefined) {
    const before = clone(world.player);
    world.player.supplies = fresh();
    try { world.save(); } catch (error) { world.player = before; throw error; }
  } else validate(world.player.supplies);
  return snapshotFrom(world.player.supplies);
}

function snapshot(world) {
  ensure(world);
  return snapshotFrom(world.player.supplies);
}

function apply(world, request) {
  ensure(world);
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('A supplies request is required.');
  const { action, requestId } = request;
  if (!REQUEST_ID.test(requestId || '')) throw Error('A safe UUID-like requestId is required.');
  if (!['buy', 'draw', 'return', 'load', 'fire', 'recover', 'resume', 'discard'].includes(action)) throw Error('Unknown supplies action.');
  const supplies = world.player.supplies;
  const prior = supplies.receipts.find(receipt => receipt.requestId === requestId);
  const fingerprint = requestFingerprint(request);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw Error('requestId already belongs to another supplies request.');
    return {...prior.result, ...snapshotFrom(supplies)};
  }

  const before = clone(world.player);
  try {
    const result = perform(world, request);
    const state = world.player.supplies;
    state.revision++;
    state.receipts.push({requestId, fingerprint, result: clone(result)});
    if (state.receipts.length > MAX_RECEIPTS) state.receipts.splice(0, state.receipts.length - MAX_RECEIPTS);
    validate(state);
    world.save();
    return {...result, ...snapshotFrom(state)};
  } catch (error) {
    world.player = before;
    throw error;
  }
}

function perform(world, request) {
  const state = world.player.supplies;
  switch (request.action) {
    case 'buy': {
      // Compatibility with older clients: never charge or limit supply.
      return {};
    }
    case 'draw': {
      if (Object.keys(state.tokens).length >= MAX_TOKENS) throw Error('Bolt token ledger is full; recover fired bolts or restart the session.');
      const token = nextToken(state);
      state.tokens[token] = 'held';
      return {token};
    }
    case 'return': {
      const token = held(state, request.token);
      delete state.tokens[token]; // terminal tokens are reclaimed; receipts retain idempotent responses.
      return {token};
    }
    case 'load': {
      const token = held(state, request.token);
      const weaponId = weapon(request.weaponId);
      if (Object.hasOwn(state.chambers, weaponId)) throw Error('That weapon chamber is already loaded.');
      state.tokens[token] = 'loaded';
      state.chambers[weaponId] = token;
      return {token};
    }
    case 'fire': {
      const weaponId = weapon(request.weaponId);
      const token = state.chambers[weaponId];
      if (!token) throw Error('That weapon chamber is empty.');
      if (state.tokens[token] !== 'loaded') throw Error('Invalid loaded bolt state.');
      delete state.chambers[weaponId];
      state.tokens[token] = 'fired';
      return {token};
    }
    case 'recover': {
      const token = tokenId(request.token);
      if (state.tokens[token] !== 'fired') throw Error('That fired bolt cannot be recovered.');
      state.tokens[token] = 'held';
      return {token};
    }
    case 'discard': {
      const token=tokenId(request.token); if(!['held','fired'].includes(state.tokens[token]))throw Error('Bolt cannot be retired.'); delete state.tokens[token]; return {token};
    }
    case 'resume': {
      for (const [token, status] of Object.entries(state.tokens)) {
        if (status === 'held') delete state.tokens[token];
        else if (status === 'fired') delete state.tokens[token];
      }
      return {};
    }
  }
}

function fresh() { return {version: VERSION, available: PACK_SIZE, tokens: {}, chambers: {}, receipts: [], revision: 0, sequence: 0}; }

function snapshotFrom(state) { return {available: PACK_SIZE, infinite: true, price: {}, packSize: PACK_SIZE, chambers: {...state.chambers}, revision: state.revision}; }
function assertWorld(world) { if (!world || !world.player || typeof world.player !== 'object' || typeof world.save !== 'function') throw Error('A persistent world is required.'); }
function weapon(value) { if (typeof value !== 'string' || !SAFE_ID.test(value)) throw Error('Invalid weaponId.'); return value; }
function tokenId(value) { if (typeof value !== 'string' || !SAFE_ID.test(value) || !value.startsWith('bolt-')) throw Error('Invalid bolt token.'); return value; }
function held(state, value) { const token = tokenId(value); if (state.tokens[token] !== 'held') throw Error('That bolt is not held.'); return token; }
function nextToken(state) { do { state.sequence++; if (!Number.isSafeInteger(state.sequence)) throw Error('Bolt token sequence exhausted.'); } while (Object.hasOwn(state.tokens, `bolt-${state.sequence.toString(36)}`)); return `bolt-${state.sequence.toString(36)}`; }
function requestFingerprint(request) {
  const allowed = {buy: [], draw: [], return: ['token'], load: ['token', 'weaponId'], fire: ['weaponId'], recover: ['token'], resume: [], discard:['token']}[request.action];
  if (!allowed) throw Error('Unknown supplies action.');
  for (const key of Object.keys(request)) if (!['action', 'requestId', ...allowed].includes(key)) throw Error('Unexpected supplies request field.');
  const data = {action: request.action};
  for (const key of allowed) data[key] = request[key];
  return JSON.stringify(data);
}
function validate(state) {
  if (!plainObject(state) || state.version !== VERSION || !Number.isSafeInteger(state.available) || state.available < 0 || state.available > MAX_STOCK || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !plainObject(state.tokens) || !plainObject(state.chambers) || !Array.isArray(state.receipts)) throw Error('Invalid saved supplies state; preserve player.json for recovery.');
  const tokens = Object.entries(state.tokens);
  if (tokens.length > MAX_TOKENS || Object.keys(state.chambers).length > MAX_TOKENS || state.receipts.length > MAX_RECEIPTS) throw Error('Invalid saved supplies ledger size.');
  for (const [token, status] of tokens) if (!SAFE_ID.test(token) || !token.startsWith('bolt-') || !['held', 'loaded', 'fired'].includes(status)) throw Error('Invalid saved bolt token.');
  const loaded = new Set();
  for (const [weaponId, token] of Object.entries(state.chambers)) { if (!SAFE_ID.test(weaponId) || state.tokens[token] !== 'loaded' || loaded.has(token)) throw Error('Invalid saved weapon chamber.'); loaded.add(token); }
  if (tokens.filter(([, status]) => status === 'loaded').length !== loaded.size) throw Error('Invalid saved loaded bolt state.');
  const ids = new Set();
  for (const receipt of state.receipts) {
    if (!plainObject(receipt) || !REQUEST_ID.test(receipt.requestId || '') || typeof receipt.fingerprint !== 'string' || receipt.fingerprint.length > 400 || !plainObject(receipt.result) || ids.has(receipt.requestId) || Object.keys(receipt.result).some(key => key !== 'token')) throw Error('Invalid saved supplies receipt.');
    ids.add(receipt.requestId);
    if (receipt.result.token !== undefined) tokenId(receipt.result.token);
  }
}
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function clone(value) { return structuredClone(value); }

module.exports = {ensure, snapshot, apply};
