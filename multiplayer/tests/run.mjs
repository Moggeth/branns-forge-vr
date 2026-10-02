import {assert,sleep,check,connect,create,join,send,command,until,player,validateSnapshot,cleanup,report} from './helpers.mjs';
let hero,god;
try {
  await check('create/join, multiple heroes and multiple gods',async()=>{
    hero=await create();assert.equal(hero.welcome.protocol,1);assert.ok(hero.welcome.room.length>=12);assert.ok(hero.welcome.token.length>=24);
    const hero2=await join(hero.welcome.room);god=await join(hero.welcome.room,'god');const god2=await join(hero.welcome.room,'god');
    await until(()=>hero.snapshot.players.length===4,'four peers');
    assert.equal(hero.snapshot.players.filter(p=>p.role==='hero').length,2);assert.equal(hero.snapshot.players.filter(p=>p.role==='god').length,2);
    assert.equal(new Set(hero.snapshot.players.map(p=>p.id)).size,4);validateSnapshot(hero.snapshot);
    hero2.ws.close();god2.ws.close();
  });
  await check('authoritative movement replication and 300ms idle stop',async()=>{
    const initial=player(hero).position[0];
    for(let i=0;i<8;i++){command(hero,'input',{move:{x:1,z:0},yaw:.75});await sleep(50);}
    await until(()=>player(god,hero.welcome.playerId)?.position[0]>initial+.5,'movement replication');
    await sleep(500);const stopped=player(hero).position[0];await sleep(400);
    assert.ok(Math.abs(player(hero).position[0]-stopped)<.06,'idle input must stop movement');
    assert.ok(player(hero).position[0]-initial<8,'authoritative bounded speed');
  });
  await check('repeat sequence cannot replace authoritative input',async()=>{
    const seq=command(hero,'input',{move:{x:0,z:0},yaw:.4});await sleep(150);
    send(hero,{type:'input',seq,move:{x:0,z:0},yaw:2});await sleep(200);
    assert.ok(Math.abs(player(hero).yaw-.4)<.01,'duplicate rejected');
  });
  await check('VR poses remain local bounded offsets',async()=>{
    const root=[...player(hero).position];
    command(hero,'input',{move:{x:0,z:0},yaw:.4,head:{position:[0,1.65,0],quaternion:[0,0,0,1]},hands:[{position:[.3,1,-.4],quaternion:[0,0,0,1]}]});
    await until(()=>player(god,hero.welcome.playerId)?.head,'head pose replicated');
    assert.equal(player(god,hero.welcome.playerId).hands.length,1);
    command(hero,'input',{move:{x:0,z:0},yaw:.4,head:{position:[500,500,500],quaternion:[0,0,0,1]}});await sleep(150);
    assert.ok(Math.hypot(...player(hero).head.position)<=2.5);
    assert.ok(Math.hypot(player(hero).position[0]-root[0],player(hero).position[2]-root[2])<.05);
  });
  await check('hero cannot cast; god shared terrain costs mana',async()=>{
    const before=hero.snapshot.edits.length;
    command(hero,'cast',{spell:'raise',point:[0,0,0]});await sleep(200);assert.equal(hero.snapshot.edits.length,before);
    const mana=player(god).mana;command(god,'cast',{spell:'raise',point:[0,0,0]});
    await until(()=>hero.snapshot.edits.length>before,'replicated terrain cast');await until(()=>player(god).mana<mana,'caster receives authoritative mana cost');
    for(let i=0;i<12;i++)command(god,'cast',{spell:'raise',point:[0,0,0]});
    await sleep(300);assert.equal(hero.snapshot.edits.length,before+1,'burst cannot bypass cooldown');validateSnapshot(hero.snapshot);
  });
  await check('role change preserves identity and supports both roles',async()=>{
    const id=hero.welcome.playerId;send(hero,{type:'role',role:'god'});
    await until(()=>player(god,id)?.role==='god','role replicated');assert.equal(player(hero).id,id);
    await sleep(2200);send(hero,{type:'role',role:'hero'});await until(()=>player(hero).role==='hero','hero role restored');
  });
  await check('reconnect preserves identity/sequence and replaces old socket',async()=>{
    const old=hero, seq=hero.seq;
    hero=await join(old.welcome.room,'hero',old.welcome.token);assert.equal(hero.welcome.playerId,old.welcome.playerId);assert.ok(hero.welcome.nextSeq>=seq);
    command(hero,'input',{move:{x:0,z:0},yaw:1.1});await sleep(150);
    if(old.ws.readyState===1)send(old,{type:'input',seq:hero.seq+100,move:{x:1,z:0},yaw:2.2});
    await sleep(200);assert.ok(Math.abs(player(hero).yaw-1.1)<.01,'old socket excluded');
    assert.equal(hero.snapshot.players.filter(p=>p.id===hero.welcome.playerId).length,1);
  });
  await check('nonfinite/oversized input cannot corrupt room',async()=>{
    const bad=await join(hero.welcome.room);
    bad.ws.send('{"type":"input","seq":1,"move":{"x":1e309,"z":0},"yaw":1e309}');
    await sleep(200);validateSnapshot(hero.snapshot);
    const oversized=await join(hero.welcome.room);const previousErrors=oversized.errors.length;
    oversized.ws.send(JSON.stringify({type:'input',seq:2,move:{x:0,z:0},padding:'x'.repeat(9000)}));
    await until(()=>oversized.ws.readyState!==1||oversized.errors.length>previousErrors,'oversized input rejected');
    send(hero,{type:'ping',at:271828});await until(()=>hero.messages.some(m=>m.type==='pong'&&m.at===271828),'healthy peer remains responsive');
  });
  await check('authoritative summon and melee enemy damage',async()=>{
    await sleep(1300);
    const hp=player(hero).position;
    const known=new Set(hero.snapshot.enemies.map(e=>e.id));
    command(god,'cast',{spell:'skeleton',point:[hp[0],hp[1],hp[2]-1.5]});
    const enemy=await until(()=>hero.snapshot.enemies.find(e=>!known.has(e.id)),'summoned enemy');
    const startHp=enemy.hp;
    for(let i=0;i<12;i++){
      const current=hero.snapshot.enemies.find(e=>e.id===enemy.id);if(!current||current.hp<startHp)break;
      const pos=player(hero).position;const yaw=Math.atan2(-(current.position[0]-pos[0]),-(current.position[2]-pos[2]));
      command(hero,'input',{move:{x:0,z:0},yaw});command(hero,'action',{action:'strike',damage:999999});await sleep(600);
    }
    const after=hero.snapshot.enemies.find(e=>e.id===enemy.id);
    assert.ok(!after||after.hp<startHp,'melee reduces authoritative enemy hp');
    assert.ok(after&&after.hp>0,'client damage ignored: one melee strike must not apply supplied 999999 damage');validateSnapshot(hero.snapshot);
    await sleep(250);
    command(god,'cast',{spell:'starfall',point:after.position});
    await until(()=>!hero.snapshot.enemies.some(e=>e.id===enemy.id),'starfall kills damaged enemy');
    assert.ok(hero.snapshot.edits.some(e=>e.kind==='starfall'),'starfall terrain replicated');
    assert.ok(hero.messages.some(e=>e.type==='event'&&e.kind==='death'&&e.id===enemy.id),'death event replicated');
  });
  report('integration',{result:'pass'});
} catch(error) {report('integration',{result:'fail',failure:error.message});process.exitCode=1;}
finally {cleanup();}
