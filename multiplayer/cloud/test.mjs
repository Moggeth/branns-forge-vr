import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';
const started = performance.now(), base = process.env.CLOUD_TEST_URL || 'http://127.0.0.1:8791';
const origin = process.env.CLOUD_TEST_ORIGIN || 'http://127.0.0.1:5178', all = [];
async function connect(room = '') {
  const url = new URL('/peer/cloud', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; if (room) url.searchParams.set('room', room);
  const ws = new WebSocket(url, { origin }), inbox = [], waiters = [];
  all.push(ws);
  ws.on('message', raw => {
    if (raw.toString() === 'pong') return;
    const m = JSON.parse(raw); inbox.push(m);
    for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
  });
  await once(ws, 'open');
  return { ws, send: m => ws.send(JSON.stringify(m)), wait(type, predicate = () => true) {
    const match = m => m.type === type && predicate(m), found = inbox.find(match); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => { const w = { match, resolve }; w.timer = setTimeout(() => reject(Error(`Timeout ${type}`)), 10000); waiters.push(w); });
  }};
}
const identity = { name: 'Cloud verification', role: 'hero', desktop: true };
try {
  assert.equal((await (await fetch(base + '/peer/health')).json()).service, 'cloud-rooms');
  assert.equal((await fetch(base + '/peer/cloud', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const host = await connect(); host.send({ type: 'create', ...identity }); const h = await host.wait('welcome');
  assert.match(h.room, /^\d{8}$/); assert.equal(h.hostId, h.peerId); assert.equal(h.relayTransport, 'websocket');
  const guest = await connect(h.room); guest.send({ type: 'join', room: h.room, ...identity, role: 'god' }); const g = await guest.wait('welcome');
  const third = await connect(h.room); third.send({ type: 'join', room: h.room, ...identity }); const t = await third.wait('welcome');
  guest.send({ type: 'relay', to: t.peerId, epoch: 1, frame: 'forbidden' }); assert.equal((await guest.wait('error')).code, 'invalid_route');
  guest.send({ type: 'relay_request', to: h.peerId, epoch: 1 }); assert.equal((await host.wait('relay_request')).from, g.peerId);
  host.send({ type: 'relay', to: g.peerId, epoch: 1, frame: 'opaque-test-frame' }); assert.equal((await guest.wait('relay')).frame, 'opaque-test-frame');
  guest.send({ type: 'checkpoint_ready', revision: 12 }); guest.send({ type: 'ping', at: 12 }); await guest.wait('pong', m => m.at === 12);
  host.send({ type: 'transfer_host', to: g.peerId }); const offer = await guest.wait('continue_world_offer'); assert.equal(offer.graceful, true);
  guest.send({ type: 'continue_world', epoch: 1 }); assert.equal((await host.wait('host_changed')).epoch, 2);
  host.send({ type: 'relay', to: g.peerId, epoch: 1, frame: 'stale' }); assert.equal((await host.wait('error')).code, 'stale_epoch');
  // A fresh socket proves saved reconnect credentials/room epoch are authoritative.
  host.ws.close(); const resumed = await connect(h.room); resumed.send({ type: 'join', room: h.room, ...identity, secret: h.secret });
  const r = await resumed.wait('welcome'); assert.equal(r.peerId, h.peerId); assert.equal(r.epoch, 2); assert.equal(r.hostId, g.peerId);
  for (let i = 0; i < MAX_PLAYERS-3; i++) { const c = await connect(h.room); c.send({ type: 'join', room: h.room, ...identity }); await c.wait('welcome'); }
  const ninth = await connect(h.room); ninth.send({ type: 'join', room: h.room, ...identity }); assert.equal((await ninth.wait('error')).code, 'room_full');
  resumed.send({ type: 'checkpoint_ready', revision: 20 }); resumed.send({ type: 'ping', at: 20 }); await resumed.wait('pong', m => m.at === 20); guest.send({ type: 'leave' });
  assert.equal((await resumed.wait('continue_world_offer')).revision, 20); resumed.send({ type: 'continue_world', epoch: 2 });
  assert.equal((await resumed.wait('host_changed', m => m.epoch === 3)).hostId, h.peerId);
  console.log(JSON.stringify({ ok: true, room: h.room, checks: ['origins', '8-digit-room', 'relay-isolation', 'relay-forwarding', `${MAX_PLAYERS}-player-cap`, 'transfer-epoch', 'reconnect-identity', 'host-leave-recovery'], seconds: (performance.now() - started) / 1000 }));
} finally { for (const ws of all) { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'leave' })); ws.close(); } }
