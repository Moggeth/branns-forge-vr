import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {roomListing,DIRECTORY_TTL} from '../cloud/room-directory.js';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';

const now=Date.now(), peers=Array.from({length:MAX_PLAYERS},(_,i)=>({id:String(i),name:'Player '+i,role:i?'hero':'god',secret:'hidden',revision:123,offlineAt:now-6000}));
const room={code:'01234567',peers,hostId:'0',created:now,secret:'hidden'};
const listing=roomListing(room,()=>true,now);
assert.equal(listing.status,'full');assert.equal(listing.joinable,false);
assert.equal(listing.players.length,MAX_PLAYERS);assert.equal(listing.maxPlayers,MAX_PLAYERS);assert.ok(!JSON.stringify(listing).includes('hidden'));
assert.deepEqual(Object.keys(listing.players[0]),['name','role']);
assert.equal(roomListing(room,id=>id==='0',now).joinable,true);
assert.equal(roomListing({...room,peers:peers.map(p=>({...p,offlineAt:now}))},id=>id==='0',now).joinable,false,'recently disconnected guests retain their reconnect seats');
assert.equal(roomListing(room,id=>id==='1',now).status,'waiting');
assert.equal(roomListing({...room,migrating:true},()=>true,now).joinable,false);
assert.equal(roomListing(room,()=>false,now),null);
assert.equal(roomListing({...room,created:now-8*3600_000},()=>true,now),null);
assert.equal(roomListing(room,()=>true,now).expiresAt,now+DIRECTORY_TTL);

// Exercise the actual DO code with its storage contract; live lifecycle is cloud/directory-test.mjs.
let source=await readFile(new URL('../cloud/directory.js',import.meta.url),'utf8');
source=source.replace("import {DurableObject} from 'cloudflare:workers';",'class DurableObject {constructor(ctx){this.ctx=ctx;}}');
source=source.replace("import {DIRECTORY_TTL} from './room-directory.js';",`const DIRECTORY_TTL=${DIRECTORY_TTL};`);
const {ForgeDirectory}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const data=new Map();let alarm=null;
const storage={async put(k,v){data.set(k,v);},async delete(k){for(const key of Array.isArray(k)?k:[k])data.delete(key);},
  async getAlarm(){return alarm;},async setAlarm(v){alarm=v;},async list({prefix,limit,startAfter=''}){return new Map([...data].sort(([a],[b])=>a.localeCompare(b)).filter(([k])=>k.startsWith(prefix)&&k>startAfter).slice(0,limit));}};
const dir=new ForgeDirectory({storage});
for(let i=0;i<111;i++){const code=String(i).padStart(8,'0');await dir.fetch(new Request('https://directory/update',{method:'POST',body:JSON.stringify({code,listing:{...listing,code,expiresAt:i===1?0:now+DIRECTORY_TTL}})}));}
let cursor='',seen=[];
do{const page=await(await dir.fetch(new Request('https://directory/list?cursor='+cursor))).json();seen.push(...page.rooms);cursor=page.nextCursor;}while(cursor);
assert.equal(seen.length,110);assert.equal(new Set(seen.map(r=>r.code)).size,110);assert.ok(!seen.some(r=>'expiresAt' in r));
await dir.alarm();assert.ok(!data.has('room:00000001'));
await dir.fetch(new Request('https://directory/update',{method:'POST',body:JSON.stringify({code:'00000002',listing:null})}));assert.ok(!data.has('room:00000002'));
assert.equal((await dir.fetch(new Request('https://directory/update',{method:'POST',body:JSON.stringify({code:'bad',listing})}))).status,400);
console.log('room-directory: public field allowlist, full/waiting/empty/expiry, pagination and cleanup passed');
