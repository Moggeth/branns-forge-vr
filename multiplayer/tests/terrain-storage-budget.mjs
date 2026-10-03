// Research fixture only. This does not introduce terrainBase into the protocol.
// Run: node multiplayer/tests/terrain-storage-budget.mjs
import assert from 'node:assert/strict';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {createEnemy,PARTS} from '../shared/combat.js';
import {SnapshotDeltaEncoder,SnapshotDeltaDecoder} from '../client/state-codec.js';
import {quantizeWire} from '../client/wire-quantize.js';
const started=performance.now(),bytes=x=>Buffer.byteLength(JSON.stringify(x)),N=133,TILE=16;
let seed=731;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
function busyWorld(){
 const sim=createSimulation();for(let i=0;i<8;i++)sim.addPlayer({id:`p${i}`,role:i?'hero':'god'});
 for(let i=0;i<4;i++)assert.equal(sim.command('p0',{type:'action',seq:i+1,action:'forgeSummon'}).ok,true);
 const s=sim.checkpoint(),position=i=>[Math.sin(i)*35,1.123456789012345,Math.cos(i)*35];
 s.enemies=Array.from({length:64},(_,i)=>({...createEnemy(`enemy${i}`,position(i),i%4?'skeleton':'golem'),scorch:Object.fromEntries(PARTS.map(p=>[p,.123456789012345]))}));
 s.edits=Array.from({length:64},(_,i)=>({id:`edit${i}`,kind:'raise',x:i%8*10-35,z:Math.floor(i/8)*10-35,radius:6,height:2}));
 s.deposits=Array.from({length:80},(_,i)=>({id:`ore${i}`,kind:'stone',x:i%10*7-35,z:Math.floor(i/10)*7-28,hits:0,maxHits:3,depleted:false}));
 s.pickups=Array.from({length:256},(_,i)=>({id:`pickup${i}`,kind:'wood',x:i%16*4-30,z:Math.floor(i/16)*4-30,y:1.123456789012345,amount:2}));
 s.projectiles=Array.from({length:96},(_,i)=>({id:`shot${i}`,ownerId:`p${i%8}`,kind:'arrow',position:position(i),previousPosition:position(i+.01),velocity:[1.123456789012345,2.123456789012345,3.123456789012345],curve:[0,0,0],bornTick:0,trail:Array.from({length:16},(_,j)=>position(i+j*.01))}));
 s.detachedParts=Array.from({length:96},(_,i)=>({id:`part${i}`,sourceId:`enemy${i%64}`,kind:'skeleton',part:PARTS[i%6],position:position(i),quaternion:[0,0,0,1],velocity:[.123456789012345,0,0],angularVelocity:[1,2,3],bornTick:0,heldBy:null,localBounds:{min:[-.25,-.5,-.25],max:[.25,.5,.25]},hitIds:s.enemies.map(e=>e.id)}));
 s.embeds=Array.from({length:192},(_,i)=>({id:`embed${i}`,kind:'arrow',targetId:`enemy${i%64}`,part:'head',localPoint:[0,.1,0],localQuaternion:[0,0,0,1],point:position(i),normal:[0,1,0],localNormal:[0,1,0],penetration:.12,boneName:'Head'}));
 s.fireCells=Array.from({length:256},(_,i)=>({x:(i%16)*.5,z:Math.floor(i/16)*.5,fuel:.812345678901234,heat:.912345678901234,burning:true,wetUntil:0,expiresTick:1800}));
 s.fireSurfaces=Array.from({length:32},(_,i)=>({id:`f${9000+i}`,position:position(i),normal:[0,1,0],expiresTick:150}));
 return loadSimulation(s);
}
function raster(kernels){
 const a=new Float64Array(N*N*2);
 for(let n=0;n<kernels;n++){
  const scar=n%3===0,x=random()*96-48,z=random()*96-48,r=scar?1.35:6,h=scar?-.12:n%2?2:-2,c=scar?1:0;
  for(let j=Math.max(0,Math.ceil((z-r+49.5)/.75));j<=Math.min(N-1,Math.floor((z+r+49.5)/.75));j++)for(let i=Math.max(0,Math.ceil((x-r+49.5)/.75));i<=Math.min(N-1,Math.floor((x+r+49.5)/.75));i++){
   const t=Math.max(0,1-Math.hypot(i*.75-49.5-x,j*.75-49.5-z)/r);a[(j*N+i)*2+c]+=h*t*t*(3-2*t);
  }
 }
 return a;
}
function tiles(a,compressed=false){
 const out=[];
 for(let tz=0;tz<Math.ceil(N/TILE);tz++)for(let tx=0;tx<Math.ceil(N/TILE);tx++){
  const values=[];for(let j=tz*TILE;j<Math.min(N,(tz+1)*TILE);j++)for(let i=tx*TILE;i<Math.min(N,(tx+1)*TILE);i++)values.push(a[(j*N+i)*2],a[(j*N+i)*2+1]);
  if(!values.some(n=>n!==0))continue;
  const raw=Buffer.alloc(values.length*8);values.forEach((n,i)=>raw.writeDoubleLE(n,i*8));
  const encoded=compressed?deflateRawSync(raw):raw,decoded=compressed?inflateRawSync(encoded):encoded;
  assert.deepEqual(decoded,raw,'lossless float64 round trip');
  out.push({id:`${tx},${tz}`,data:encoded.toString('base64')});
 }
 return {v:1,revision:1,encoding:compressed?'f64le-deflate':'f64le',tiles:out};
}
const sim=busyWorld(),checkpoint=sim.checkpoint(),snapshot=quantizeWire({...sim.snapshot(),projectiles:sim.snapshot().projectiles.map(({trail,...shot})=>shot)});
const report={note:'Research only; busy fixture fills principal caps, not a mathematical maximum JSON envelope.',busyCheckpointBytes:bytes({kind:'checkpoint',revision:1,state:checkpoint}),busySnapshotBytes:bytes({kind:'message',data:{kind:'snapshot',epoch:1,snapshot}}),cases:[]};
for(const count of [64,512,4096]){
 const rasterStart=performance.now(),a=raster(count),raw=tiles(a),packed=tiles(a,true),buildMs=performance.now()-rasterStart;
 let maxFloat32Error=0,maxFixed16Error=0;for(const n of a){maxFloat32Error=Math.max(maxFloat32Error,Math.abs(n-Math.fround(n)));maxFixed16Error=Math.max(maxFixed16Error,Math.abs(n-Math.round(n*65536)/65536));}
 const row={kernels:count,tiles:raw.tiles.length,rawBytes:bytes(raw),deflateBytes:bytes(packed),buildMs,maxFloat32Error,maxFixed16Error,checkpointRawBytes:bytes({kind:'checkpoint',revision:1,state:{...checkpoint,terrainBase:raw}}),checkpointDeflateBytes:bytes({kind:'checkpoint',revision:1,state:{...checkpoint,terrainBase:packed}})};
 for(const [label,terrainBase] of [['raw',raw],['deflate',packed]]){
  const enc=new SnapshotDeltaEncoder(),dec=new SnapshotDeltaDecoder(),frames=120;for(let i=1;i<8;i++)enc.enable(`peer${i}`);
  let totalBytes=0,deltaBytes=0,keyBytes=0,decoderMs=0;const t=performance.now();
  for(let tick=1;tick<=frames;tick++){
   enc.publish({...snapshot,tick,terrainBase});
   for(let i=1;i<8;i++){const frame=enc.frame(`peer${i}`,1),size=bytes({kind:'message',data:frame});totalBytes+=size;if(frame.k)keyBytes=Math.max(keyBytes,size);else deltaBytes=Math.max(deltaBytes,size);
    if(i===1){const t=performance.now(),result=dec.accept(JSON.parse(JSON.stringify(frame)));decoderMs+=performance.now()-t;assert.ok(result.snapshot,result.error);}
   }
  }
  row[label]={meanPublishAndSevenPeersMs:(performance.now()-t-decoderMs)/frames,meanOneGuestDecodeMs:decoderMs/frames,maxDeltaBytes:deltaBytes,maxKeyframeBytes:keyBytes,totalBytesForSixSeconds:totalBytes,desktopCheckpointTerrainBytesPerSecondPerPeer:bytes(terrainBase)*2};
 }
 report.cases.push(row);
}
report.elapsedSeconds=(performance.now()-started)/1000;
console.log(JSON.stringify(report,null,2));
