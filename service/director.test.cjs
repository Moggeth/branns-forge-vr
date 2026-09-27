'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Director}=require('./director');
function fixture(){let now=100000;const director=new Director(()=>{},()=>now);const started=director.start();const snapshot=(phase='waiting',ack=0,extra={})=>director.snapshot({sessionId:started.sessionId,ack,game:{phase,secondsLeft:150,health:100,defeated:0,incoming:0,beacons:[{},{},{}],enemies:[],...extra}});snapshot();return {director,sessionId:started.sessionId,snapshot,advance:n=>{now+=n}}}
test('the game remains authoritative and commands are acknowledged once',()=>{
 const f=fixture(),d=f.director;const start=d.command({sessionId:f.sessionId,type:'start'}).command;
 assert.deepEqual(d.poll({sessionId:f.sessionId}).commands,[start]);f.snapshot('running',start.id);
 assert.deepEqual(d.poll({sessionId:f.sessionId}).commands,[]);
 const patrol=d.command({sessionId:f.sessionId,type:'skeletons',lane:'west'}).command;
 assert.equal(patrol.type,'skeletons');assert.equal(d.state().budget,5);
 assert.throws(()=>d.command({sessionId:f.sessionId,type:'skeletons',lane:'west'}),/cooling down/);
 assert.throws(()=>d.command({sessionId:f.sessionId,type:'golem',lane:'somewhere'}),/valid card/);
 f.snapshot('running',patrol.id,{enemies:[{alive:true},{alive:true}]});
 assert.equal(d.state().game.enemies.length,2);
});
test('budget regenerates, field caps apply, and stale sessions cannot command',()=>{
 const f=fixture(),d=f.director;const start=d.command({sessionId:f.sessionId,type:'start'}).command;f.snapshot('running',start.id);
 f.advance(3000);assert.equal(d.state().budget,9.6);
 assert.throws(()=>d.command({sessionId:'old',type:'wisps',lane:'east'}),/Reconnect/);
 f.snapshot('running',start.id,{enemies:Array.from({length:8},()=>({alive:true}))});
 assert.throws(()=>d.command({sessionId:f.sessionId,type:'wisps',lane:'east'}),/Too many enemies/);
 f.advance(3100);assert.throws(()=>d.command({sessionId:f.sessionId,type:'gloom',lane:'east'}),/not connected/);
});
test('end state blocks further attacks and allows a fresh round',()=>{
 const f=fixture(),d=f.director;const start=d.command({sessionId:f.sessionId,type:'start'}).command;f.snapshot('director_win',start.id);
 assert.throws(()=>d.command({sessionId:f.sessionId,type:'gloom',lane:'west'}),/Begin the round/);
 const rematch=d.command({sessionId:f.sessionId,type:'rematch'}).command;
 assert.equal(d.state().round,2);assert.equal(d.state().budget,8);
 assert.equal(d.poll({sessionId:f.sessionId}).commands[0].id,rematch.id);
 f.snapshot('waiting',rematch.id);assert.equal(d.state().phase,'waiting');
});
test('live camera is bounded and only the active game can submit a JPEG',()=>{
 const f=fixture(),d=f.director;
 assert.equal(d.camera({sessionId:f.sessionId,yaw:1,pitch:4,zoom:100}).view.pitch,1.25);
 assert.equal(d.state().view.zoom,65);
 assert.throws(()=>d.camera({sessionId:f.sessionId,yaw:NaN,pitch:1,zoom:30}),/Invalid camera/);
 const frame=Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(300),Buffer.from([0xff,0xd9])]);
 assert.equal(d.acceptFrame(f.sessionId,frame).sequence,1);
 assert.equal(d.state().frameSequence,1);
 assert.throws(()=>d.acceptFrame('old',frame),/Stale/);
 assert.throws(()=>d.acceptFrame(f.sessionId,Buffer.alloc(400)),/JPEG/);
 d.start();assert.equal(d.frame,null);
});
