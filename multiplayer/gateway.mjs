import http from 'node:http';
import {spawn} from 'node:child_process';
import {createReadStream, existsSync, mkdirSync, appendFileSync} from 'node:fs';
import {resolve, dirname, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8090);
const simulationPort = Number(process.env.SIMULATION_PORT || 8081);
const production = process.env.NODE_ENV === 'production';
const allowed = new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:5178,http://127.0.0.1:5178,http://localhost:8090,http://127.0.0.1:8090').split(',').map(x=>x.trim()).filter(Boolean));
if (production && !process.env.ALLOWED_ORIGINS) throw Error('ALLOWED_ORIGINS required in production');
if (port === simulationPort) throw Error('Gateway and simulation ports must differ');
mkdirSync(resolve(root, 'logs'), {recursive:true});
const log = (event, fields={}) => {
  const line = JSON.stringify({at:new Date().toISOString(),event,...fields});
  console.log(line); appendFileSync(resolve(root,'logs/gateway.jsonl'),line+'\n');
};
const localGodot = resolve(root,'../tools/godot/Godot_v4.7.2-stable_win64_console.exe');
const binary = process.env.GODOT_BIN || (existsSync(localGodot) ? localGodot : 'godot');
const child = spawn(binary, ['--headless','--audio-driver','Dummy','--path',resolve(root,'server')], {
  windowsHide:true, stdio:['ignore','pipe','pipe'], cwd:root,
  env:{...process.env,PORT:String(simulationPort),BIND_ADDRESS:'127.0.0.1',WORLD_DATA_DIR:process.env.WORLD_DATA_DIR || resolve(root,'state')}
});
let childFailed = false;
// Server logs must be metadata-only; never record protocol frames or room credentials.
child.stdout.on('data', b => appendFileSync(resolve(root,'logs/simulation.log'),b));
child.stderr.on('data', b => appendFileSync(resolve(root,'logs/simulation.log'),b));
child.on('error', error => {childFailed=true; log('simulation_start_failed',{code:error.code || 'unknown'});});
child.on('exit', (code,signal)=> {childFailed=true; log('simulation_exit',{code,signal}); if(!stopping) shutdown(1);});

const sockets = new Set();
const pairs = new Map();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png'};
let healthCheckedAt = 0, healthReady = false, healthPending = null;
function checkHealth() {
  if (childFailed) return Promise.resolve(false);
  if (healthPending) return healthPending;
  if (Date.now() - healthCheckedAt < 1000) return Promise.resolve(healthReady);
  healthPending = new Promise(resolveHealth => {
    const probe = new WebSocket(`ws://127.0.0.1:${simulationPort}`);
    let finished = false;
    const finish = ready => {if(finished)return;finished=true;clearTimeout(timeout);probe.terminate();healthReady=ready;healthCheckedAt=Date.now();healthPending=null;resolveHealth(ready);};
    const timeout=setTimeout(()=>finish(false),500);
    probe.once('open',()=>probe.send(JSON.stringify({type:'ping',at:1})));
    probe.on('message',data=>{try{if(JSON.parse(data).type==='pong')finish(true);}catch{finish(false);}});
    probe.once('error',()=>finish(false));probe.once('close',()=>finish(false));
  });
  return healthPending;
}
const server = http.createServer((req,res)=> {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if (req.url === '/health') {
    checkHealth().then(ready => {res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ready,protocol:1,capacityPerRoom:32}));});
    return;
  }
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
  let path;try {path=decodeURIComponent(new URL(req.url,'http://gateway').pathname);} catch {res.writeHead(400);return res.end();}
  const base=resolve(root,'dist');
  const target=resolve(base,'.'+(path==='/'?'/index.html':path));
  if (!target.startsWith(base+sep) || !existsSync(target)) {res.writeHead(404);return res.end('Not found');}
  res.setHeader('Content-Type',mime[extname(target)] || 'application/octet-stream');
  if(req.method==='HEAD')return res.end();
  const stream=createReadStream(target);stream.on('error',()=>res.destroy());stream.pipe(res);
});
const websocket = new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=> {
  const origin=req.headers.origin;
  if(req.url !== '/ws' || childFailed || sockets.size>=320 || (origin ? !allowed.has(origin) : production)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
  }
  websocket.handleUpgrade(req,socket,head,client=>websocket.emit('connection',client));
});
websocket.on('connection',client=> {
  sockets.add(client);
  const upstream=new WebSocket(`ws://127.0.0.1:${simulationPort}`);
  pairs.set(client,upstream);
  const pending=[];let messages=0;let window=Date.now();
  client.on('message',(data,binary)=> {
    if(Date.now()-window>=1000){messages=0;window=Date.now();}
    if(binary || ++messages>80 || data.length>8192 || upstream.bufferedAmount>65536){client.close(1008,'Input limit');return;}
    if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary:false});
    else if(pending.length<8)pending.push(data); else client.close(1008,'Connecting');
  });
  upstream.on('open',()=>{for(const data of pending)upstream.send(data,{binary:false});pending.length=0;});
  upstream.on('message',(data,binary)=> {
    if(client.readyState!==WebSocket.OPEN)return;
    if(client.bufferedAmount>524288){client.close(1013,'Connection too slow');return;}
    client.send(data,{binary});
  });
  upstream.on('error',()=>client.close(1011,'World unavailable'));
  upstream.on('close',(code,reason)=>client.close([1005,1006,1015].includes(code) ? 1012 : code, reason.toString() || 'World disconnected'));
  client.on('error',()=>{});
  client.on('close',()=>{sockets.delete(client);pairs.delete(client);upstream.close();});
});
let stopping=false;
function shutdown(code=0) {
  if(stopping)return;stopping=true;
  for(const client of sockets)client.close(1001,'Server restarting');
  for(const upstream of pairs.values())upstream.close();
  server.close();child.kill('SIGTERM');
  setTimeout(()=>process.exit(code),1500).unref();
}
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
// Private parent-process channel for owned diagnostic lifecycle; no HTTP control endpoint.
if (process.send) process.on('message', message => {if(message?.type === 'shutdown')shutdown();});
process.on('uncaughtException',error=> {log('uncaught',{message:error.message});shutdown(1);});
process.on('unhandledRejection',error=> {log('unhandled',{message:String(error)});shutdown(1);});
server.listen(port,'0.0.0.0',()=>log('gateway_started',{port,simulationPort,production}));
