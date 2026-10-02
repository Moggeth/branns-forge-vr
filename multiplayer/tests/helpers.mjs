import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export { assert, performance };
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const url = process.env.TEST_WS_URL || 'ws://127.0.0.1:8090/ws';
export const clients = new Set();
export const timings = [];
export async function check(name, fn) {
  const start = performance.now();
  try { await fn(); timings.push({step:name,outcome:'pass',seconds:+((performance.now()-start)/1000).toFixed(3)}); }
  catch (error) { timings.push({step:name,outcome:'fail',seconds:+((performance.now()-start)/1000).toFixed(3)}); throw error; }
}
export async function connect() {
  const c = {ws:new WebSocket(url,{handshakeTimeout:5000,...(process.env.TEST_ORIGIN?{origin:process.env.TEST_ORIGIN}:{})}), messages:[], states:[], errors:[], seq:1, snapshot:null, bytes:0,maxBytes:0};
  clients.add(c);
  c.ws.on('message', raw => {
    c.bytes += raw.length; c.maxBytes = Math.max(c.maxBytes,raw.length);
    const message=JSON.parse(raw.toString());
    c.messages.push(message);
    if (c.messages.length>1000) c.messages.shift();
    if(message.type==='welcome') { c.welcome=message; c.seq=message.nextSeq; }
    if(message.snapshot) c.snapshot=message.snapshot;
    if(message.type==='state') c.states.push({at:performance.now(),bytes:raw.length});
    if(message.type==='error') c.errors.push(message.code);
  });
  await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
  return c;
}
export async function until(fn, label, timeout=5000) {
  const start=performance.now();
  while(performance.now()-start<timeout) { if(fn()) return fn(); await sleep(20); }
  throw new Error(`Timed out: ${label}`);
}
export function send(c,payload) { c.ws.send(JSON.stringify(payload)); }
export function command(c,type,payload={}) { const seq=c.seq++; send(c,{type,seq,...payload}); return seq; }
export async function create(role='hero') {
  const c=await connect();send(c,{type:'create',name:'Synthetic tester',role});
  await until(()=>c.welcome,'create welcome');return c;
}
export async function join(room,role='hero',token) {
  const c=await connect();send(c,{type:'join',room,name:'Synthetic tester',role,...(token?{token}:{})});
  await until(()=>c.welcome||c.errors.length,'join response');return c;
}
export function player(c,id=c.welcome.playerId) { return c.snapshot?.players.find(p=>p.id===id); }
export function validateSnapshot(s) {
  assert.equal(s.maxPlayers,32);assert.ok(s.players.length<=32);
  for(const key of ['enemies','edits','groves']) assert.ok(s[key].length<=64,`${key} cap`);
  for(const p of s.players) {
    assert.ok(['hero','god'].includes(p.role));assert.ok(p.name.length<=24);
    assert.ok(p.position.every(Number.isFinite));assert.ok(Math.abs(p.position[0])<=55.01&&Math.abs(p.position[2])<=55.01);
    assert.ok(Number.isFinite(p.hp)&&p.hp>=0&&p.hp<=100);
    assert.ok(Number.isFinite(p.mana)&&p.mana>=0&&p.mana<=100);
  }
  for(const e of s.enemies) assert.ok(e.position.every(Number.isFinite)&&Number.isFinite(e.hp)&&e.hp>=0);
}
export function cleanup(){for(const c of clients)c.ws.terminate();}
export function report(kind, extra={}) { console.log(JSON.stringify({suite:kind,timings,...extra},null,2)); }
