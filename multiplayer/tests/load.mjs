import {assert,performance,sleep,check,create,join,command,send,until,validateSnapshot,cleanup,report,timings} from './helpers.mjs';
const peers=[];
try {
  await check('32 independent connections and explicit 33rd rejection',async()=>{
    peers.push(await create('god'));
    for(let i=1;i<32;i++) peers.push(await join(peers[0].welcome.room,'god'));
    assert.ok(peers.every(p=>p.welcome));
    await until(()=>peers[0].snapshot.players.length===32,'all 32 in snapshot');
    const extra=await join(peers[0].welcome.room);
    assert.ok(extra.errors.includes('room_full'));assert.ok(!extra.welcome);
  });
  await check('64 structural edits, groves and enemies: explicit overflow rejection',async()=>{
    for(const [spell,key] of [['raise','edits'],['grove','groves'],['skeleton','enemies']]) {
      for(let round=0;round<2;round++) {
        for(let i=0;i<32;i++)command(peers[i],'cast',{spell,point:[35+(i%4),0,35+Math.floor(i/4)]});
        await sleep(850);
      }
      await until(()=>peers[0].snapshot[key].length===64,`${key} reaches cap`);
      const before=peers[0].errors.length;command(peers[0],'cast',{spell,point:[35,0,35]});
      await until(()=>peers[0].errors.length>before,`${key} overflow refusal`);
      assert.equal(peers[0].errors.at(-1),'world_limit');assert.equal(peers[0].snapshot[key].length,64);
    }
    for(let i=0;i<32;i+=2)send(peers[i],{type:'role',role:'hero'});
    await until(()=>peers[0].snapshot.players.filter(p=>p.role==='hero').length===16,'mixed roles under load');
  });
  let metrics;
  await check('concurrent 20Hz input and bounded broadcast snapshots',async()=>{
    peers.forEach(p=>{p.states=[];p.bytes=0;p.maxBytes=0;p.errors=[];});
    const start=performance.now(), duration=Number(process.env.TEST_LOAD_SECONDS||8)*1000;
    let commands=0;
    while(performance.now()-start<duration) {
      for(let i=0;i<peers.length;i++) {
        command(peers[i],'input',{move:{x:Math.sin(commands/640+i),z:Math.cos(commands/640+i)},yaw:i/32*Math.PI*2});commands++;
      }
      await sleep(50);
    }
    peers.forEach(p=>command(p,'input',{move:{x:0,z:0},yaw:0}));await sleep(300);
    const elapsed=(performance.now()-start)/1000;
    for(const p of peers){validateSnapshot(p.snapshot);assert.ok(p.maxBytes<=256*1024);assert.equal(p.errors.length,0);assert.ok(p.states.length>=elapsed*5,'at least 5 broadcasts/s under load');}
    const intervals=peers[0].states.slice(1).map((s,i)=>s.at-peers[0].states[i].at).sort((a,b)=>a-b);
    metrics={players:32,seconds:+elapsed.toFixed(3),commands,broadcastHz:+(peers[0].states.length/elapsed).toFixed(2),p95IntervalMs:+intervals[Math.floor(intervals.length*.95)].toFixed(2),maxSnapshotBytes:Math.max(...peers.map(p=>p.maxBytes)),aggregateBytes:peers.reduce((s,p)=>s+p.bytes,0),errors:peers.reduce((s,p)=>s+p.errors.length,0)};
  });
  report('load',{result:'pass',metrics});
} catch(error) {report('load',{result:'fail',failure:error.message});process.exitCode=1;}
finally {cleanup();}
