import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const port = 20000 + randomInt(20000);
const origin = 'http://127.0.0.1:5178';
const url = `ws://127.0.0.1:${port}/peer/ws`;
const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: { ...process.env, PEER_HOST: '127.0.0.1', PEER_PORT: String(port), PEER_ORIGINS: origin,
    PEER_DISCONNECT_GRACE_MS: '100', PEER_CONTINUE_OFFER_MS: '500', PEER_ROOM_IDLE_MS: '5000',
    PEER_LOG_PATH: `${process.cwd()}/multiplayer/peer/logs/test-server.jsonl` }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stderr.on('data', chunk => output += chunk);
const all = [];
async function ready() {
  for (let tries = 0; tries < 50; tries++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/peer/health`); if (response.ok) return; } catch {}
    await delay(50);
  }
  throw new Error('Server did not start: ' + output);
}
function connect() {
  const ws = new WebSocket(url, { origin });
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString()); inbox.push(message);
    for (const waiter of [...waiters]) if (waiter.predicate(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message); }
  });
  all.push(ws);
  return { ws, inbox, wait(type, predicate = () => true) {
    const found = inbox.find(message => message.type === type && predicate(message)); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => { const waiter = { predicate: m => m.type === type && predicate(m), resolve }; waiters.push(waiter); setTimeout(() => { const at = waiters.indexOf(waiter); if (at >= 0) { waiters.splice(at, 1); reject(new Error(`Timed out: ${type}`)); } }, 2000).unref(); });
  }, send(value) { ws.send(JSON.stringify(value)); } };
}
try {
  await ready();
  const bad = new WebSocket(url, { origin: 'https://evil.example' });
  await assert.rejects(once(bad, 'open'));
  const health = await (await fetch(`http://127.0.0.1:${port}/peer/health`)).json();
  assert.equal(health.ok, true);
  const configResponse = await fetch(`http://127.0.0.1:${port}/peer/config`, { headers: { origin } });
  assert.equal(configResponse.status, 200);
  assert.ok((await configResponse.json()).iceServers.length >= 1);
  assert.equal((await fetch(`http://127.0.0.1:${port}/peer/config`, { headers: { origin: 'https://evil.example' } })).status, 403);
  const host = connect(); await once(host.ws, 'open');
  host.send({ type: 'create', name: 'Host', role: 'hero', desktop: true });
  const first = await host.wait('welcome');
  assert.match(first.room, /^[A-HJ-NP-Z2-9]{16}$/);
  assert.equal(first.epoch, 1); assert.equal(first.hostId, first.peerId);
  assert.ok(first.secret.length >= 40);
  const guest = connect(); await once(guest.ws, 'open');
  guest.send({ type: 'join', room: first.room, name: 'God', role: 'god', desktop: true });
  const joined = await guest.wait('welcome');
  assert.equal(joined.peers[0].id, first.peerId);
  assert.equal((await host.wait('peer_joined')).peer.id, joined.peerId);
  guest.send({ type: 'checkpoint_ready', revision: 7 });
  guest.send({ type: 'signal', to: first.peerId, epoch: 1, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'test' } } });
  assert.equal((await host.wait('signal')).from, joined.peerId);
  host.send({ type: 'transfer_host', to: joined.peerId });
  assert.equal((await guest.wait('continue_world_offer')).revision, 7);
  guest.send({ type: 'continue_world', epoch: 1 });
  assert.equal((await guest.wait('host_changed')).epoch, 2);
  assert.equal((await host.wait('host_changed')).hostId, joined.peerId);
  host.send({ type: 'signal', to: joined.peerId, epoch: 1, signal: { type: 'ice', candidate: {} } });
  assert.equal((await host.wait('error', m => m.code === 'stale_epoch')).code, 'stale_epoch');
  host.send({ type: 'checkpoint_ready', revision: 5 });
  guest.ws.close();
  await host.wait('owner_lost', m => m.epoch === 2);
  const offer = await host.wait('continue_world_offer', m => m.epoch === 2);
  assert.equal(offer.revision, 5);
  assert.equal((await host.wait('continue_offer_expired', m => m.epoch === 2)).graceful, false);
  await host.wait('world_waiting', m => m.epoch === 2);
  host.send({ type: 'retry_world' });
  await host.wait('continue_world_offer', m => m.epoch === 2 && m !== offer);
  host.send({ type: 'continue_world', epoch: 2 });
  assert.equal((await host.wait('host_changed', m => m.epoch === 3)).hostId, first.peerId);
  const rejoin = connect(); await once(rejoin.ws, 'open');
  rejoin.send({ type: 'join', room: first.room, name: 'God', role: 'god', desktop: true, secret: joined.secret });
  assert.equal((await rejoin.wait('welcome')).peerId, joined.peerId);
  for (let i = 0; i < 6; i++) { const p = connect(); await once(p.ws, 'open'); p.send({ type: 'join', room: first.room, name: `P${i}`, role: 'hero', desktop: true }); await p.wait('welcome'); }
  const ninth = connect(); await once(ninth.ws, 'open'); ninth.send({ type: 'join', room: first.room, name: 'Ninth', role: 'hero', desktop: true });
  assert.equal((await ninth.wait('error')).code, 'room_full');
  console.log('peer signaling: passed');
} finally {
  for (const ws of all) ws.terminate();
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), delay(1000)]);
}
