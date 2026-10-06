import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameInbox, FRAME_BYTES, INBOX_LIMITS, MAX_MESSAGE_BYTES} from '../peer/frame-inbox.js';

function frames(envelope, id='host:1', epoch=1) {
  const bytes=Buffer.from(JSON.stringify(envelope)), total=Math.ceil(bytes.length/FRAME_BYTES);
  return Array.from({length:total},(_,part)=>JSON.stringify({id,epoch,part,total,body:bytes.subarray(part*FRAME_BYTES,(part+1)*FRAME_BYTES).toString('base64')}));
}
const fragment=(id,part,total=44,body=Buffer.alloc(FRAME_BYTES,65).toString('base64'))=>JSON.stringify({id,epoch:1,part,total,body});

test('exact maximum-sized Unicode recovery frames survive reordering and ArrayBuffer transport',()=>{
  const box=new FrameInbox({fromHost:true}), value={kind:'checkpoint',text:'火🌳'.repeat(70000)};
  const wire=frames(value);let result;
  for(const f of wire.reverse()){const b=Buffer.from(f);result=box.accept(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),1);}
  assert.deepEqual(result,value);assert.equal(box.stats().retainedChars,0);
  assert.equal(box.stats().accepted,1);assert.equal(box.stats().rejected,0);
});
test('unbounded raw frames and guest world-sized messages are refused before reassembly',()=>{
  const box=new FrameInbox();
  assert.equal(box.accept('x'.repeat(2_000_000),1),null);
  assert.equal(box.accept(new ArrayBuffer(2_000_000),1),null);
  for(const f of frames({kind:'message',data:'x'.repeat(40_000)}))box.accept(f,1);
  assert.equal(box.stats().retainedChars,0);assert.equal(box.stats().reasons.frame_size,2);
  assert.ok(box.stats().reasons.malformed);
  assert.deepEqual(box.accept(frames({kind:'message',data:{type:'input',seq:1}})[0],1),{kind:'message',data:{type:'input',seq:1}});
});
test('interleaved incomplete worlds stay within a two-message memory ceiling, expire, and recover',()=>{
  let now=0;const box=new FrameInbox({fromHost:true,now:()=>now});
  for(let part=0;part<43;part++)for(let n=0;n<8;n++)box.accept(fragment(`h:${n}`,part),1);
  const before=box.stats();assert.ok(before.reasons.assembly_bytes);
  assert.ok(before.peakRetainedChars<=Math.ceil(MAX_MESSAGE_BYTES/3)*4*2);
  assert.ok(before.pending<=8);
  now=15001;assert.equal(box.stats().pending,0);assert.equal(box.stats().retainedChars,0);
  assert.deepEqual(box.accept(frames({kind:'message',data:{tick:10}},'fresh')[0],1),{kind:'message',data:{tick:10}});
});
test('oversized assembled messages, malformed base64/UTF-8, duplicates and stale epochs cannot deliver',()=>{
  const box=new FrameInbox({fromHost:true});
  for(const f of frames({text:'x'.repeat(MAX_MESSAGE_BYTES)}))assert.equal(box.accept(f,1),null);
  assert.equal(box.stats().reasons.message_size,1);assert.equal(box.stats().retainedChars,0);
  assert.equal(box.accept(fragment('b',0,1,'===='),1),null);
  assert.equal(box.accept(fragment('u',0,1,Buffer.from([255,255]).toString('base64')),1),null);
  const split=frames({text:'x'.repeat(16000)},'split');box.accept(split[0],1);const retained=box.stats().retainedChars;
  box.accept(split[0],1);assert.equal(box.stats().retainedChars,retained);
  box.accept(frames({kind:'message'},'old',0)[0],1);assert.equal(box.stats().reasons.epoch,1);
  assert.deepEqual(box.accept(split[1],1),{text:'x'.repeat(16000)});
});
test('guest floods have a finite decode budget and do not exhaust another guest or remain latched after recovery',()=>{
  let now=0;const bad=new FrameInbox({now:()=>now}),good=new FrameInbox({now:()=>now});
  const wire=frames({kind:'message',data:{type:'input',seq:1}})[0];
  for(let i=0;i<10000;i++)bad.accept(wire,1);
  assert.equal(bad.stats().accepted,INBOX_LIMITS.guest.framesPerSecond);
  assert.ok(bad.stats().reasons.frame_rate>9000);
  assert.ok(good.accept(wire,1));now=1000;assert.ok(bad.accept(wire,1));
  now=900;assert.ok(bad.accept(wire,1),'clock rollback does not add tokens or latch limits');
});
test('continuous 32-player input and host snapshot/recovery traffic stay below admission limits',()=>{
  let now=0;const guests=Array.from({length:31},()=>new FrameInbox({now:()=>now})),host=new FrameInbox({fromHost:true,now:()=>now});
  const command=frames({kind:'message',data:{type:'input',head:{position:[1,2,3],quaternion:[0,0,0,1]}}})[0];
  const snapshot=frames({kind:'message',data:{kind:'snapshot',text:'x'.repeat(250_000)}});
  const checkpoint=frames({kind:'checkpoint',state:{text:'x'.repeat(490_000)}});
  for(let step=0;step<100;step++){
    now+=50;for(const box of guests)assert.ok(box.accept(command,1));
    for(const f of snapshot)host.accept(f,1);
    if(step%10===0)for(const f of checkpoint)host.accept(f,1);
  }
  assert.equal(host.stats().rejected,0);assert.equal(host.stats().accepted,110);
  assert.ok(guests.every(g=>g.stats().rejected===0));
});
