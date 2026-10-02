// Portable, versioned world files. Connection credentials never belong in saves.
export const SAVE_VERSION = 1;
const MAX_BYTES = 2_000_000;
const KEY = 'branns-forge.worlds.v1';
const SECRET_KEYS = new Set(['token', 'secret', 'socket', 'password', 'credentials', 'iceServers']);

function clean(value, depth = 0) {
  if (depth > 24) throw new Error('World data is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('World contains an invalid number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(v => clean(v, depth + 1));
  if (typeof value !== 'object') throw new Error('World contains unsupported data.');
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid world field.');
    if (!SECRET_KEYS.has(key)) result[key] = clean(item, depth + 1);
  }
  return result;
}

export function makeSave(checkpoint, {name = 'Little Orchard', id = crypto.randomUUID(), now = Date.now()} = {}) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new Error('No world checkpoint available.');
  const save = {format:'branns-forge-world', version:SAVE_VERSION, id:String(id).slice(0,80), name:String(name).trim().slice(0,64) || 'Little Orchard', savedAt:now, checkpoint:clean(checkpoint)};
  if (JSON.stringify(save).length > MAX_BYTES) throw new Error('World save exceeds the supported size.');
  return save;
}

export function parseSave(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('Choose a Brann’s Forge world file smaller than 2 MB.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('This is not a valid world file.'); }
  if (value?.format !== 'branns-forge-world' || value.version !== SAVE_VERSION || !Number.isFinite(value.savedAt)) throw new Error('Unsupported world save version.');
  return makeSave(value.checkpoint, {id:value.id, name:value.name, now:value.savedAt});
}

export class WorldSaves {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  list() {
    const raw = this.storage.getItem(KEY);
    if (!raw) return [];
    let values;
    try { values = JSON.parse(raw); } catch { throw new Error('Local saves are unreadable. Import a backup to recover.'); }
    if (!Array.isArray(values) || values.length > 8) throw new Error('Local save index is invalid.');
    return values.map(value => parseSave(JSON.stringify(value))).sort((a,b) => b.savedAt - a.savedAt);
  }
  put(save) {
    const verified = parseSave(JSON.stringify(save));
    const list = [verified, ...this.list().filter(item => item.id !== verified.id)].slice(0,8);
    try { this.storage.setItem(KEY, JSON.stringify(list)); }
    catch { throw new Error('Browser storage is full or unavailable. Download a world backup instead.'); }
    return verified;
  }
  remove(id) { this.storage.setItem(KEY, JSON.stringify(this.list().filter(item => item.id !== id))); }
}
