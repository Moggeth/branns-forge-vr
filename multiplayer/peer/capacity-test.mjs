import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';

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
  async function enter(room,simCapacity,secret){const c=connect();await once(c.ws,'open');c.send({type:room?'join':'create',room,name:'Compatibility',role:'hero',desktop:true,simCapacity,secret});return c;}
  const host=await enter(), h=await host.wait('welcome');assert.equal(h.maxPeers,8);
  const guest=await enter(h.room),g=await guest.wait('welcome');assert.equal(g.maxPeers,8);
  for(let i=2;i<8;i++)assert.equal((await (await enter(h.room,32)).wait('welcome')).maxPeers,8);
  assert.equal((await (await enter(h.room,32)).wait('error')).code,'room_full');
  assert.equal((await (await enter(h.room,32,h.secret)).wait('welcome')).maxPeers,8);
  const upgraded=await enter(h.room,32,g.secret),u=await upgraded.wait('welcome');assert.equal(u.maxPeers,32);assert.equal(u.peerId,g.peerId);
  assert.equal((await (await enter(h.room,32)).wait('welcome')).maxPeers,32);
  assert.equal((await (await enter(h.room,undefined,g.secret)).wait('error')).code,'client_update_required');
  const fresh=await enter(undefined,32),f=await fresh.wait('welcome');assert.equal(f.maxPeers,32);
  const freshGuest=await enter(f.room,32),fg=await freshGuest.wait('welcome');
  assert.equal((await (await enter(f.room,undefined,fg.secret)).wait('error')).code,'client_update_required');assert.equal(freshGuest.ws.readyState,WebSocket.OPEN);
  const denied=await enter(f.room),e=await denied.wait('error');assert.equal(e.code,'client_update_required');assert.match(e.message,/Refresh/);
  console.log('peer mixed-version admission, all-member refresh, reconnect identity, downgrade rejection: passed');
} finally {
  for (const ws of all) ws.terminate();
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), delay(1000)]);
}
