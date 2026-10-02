import WebSocket from 'ws';
import {assert,check,create,join,send,until,cleanup,report,url} from './helpers.mjs';

async function upgradeStatus(target,origin){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(target,{handshakeTimeout:3000,...(origin?{origin}:{})});
    ws.once('unexpected-response',(_,response)=>{response.resume();resolve(response.statusCode);ws.terminate();});
    ws.once('open',()=>{resolve(101);ws.close();});
    ws.once('error',reject);
  });
}
try {
  const health=new URL(url);health.protocol=health.protocol==='wss:'?'https:':'http:';health.pathname='/health';
  await check('gateway application health',async()=>{
    const response=await fetch(health,{signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.ready,true);assert.equal(body.protocol,1);assert.equal(body.capacityPerRoom,32);
  });
  await check('untrusted origin and unknown upgrade path rejected',async()=>{
    assert.equal(await upgradeStatus(url,'https://untrusted.invalid'),403);
    const wrong=new URL(url);wrong.pathname='/not-ws';assert.equal(await upgradeStatus(wrong,process.env.TEST_ORIGIN),403);
    if(process.env.TEST_REQUIRE_ORIGIN==='1')assert.equal(await upgradeStatus(url),403);
  });
  await check('allowed traversal create join state and takeover close code',async()=>{
    const one=await create();const two=await join(one.welcome.room,'god');
    await until(()=>one.snapshot.players.length===2,'shared room across gateway');
    send(two,{type:'ping',at:98765});await until(()=>two.messages.some(m=>m.type==='pong'&&m.at===98765),'pong across gateway');
    let closeCode;one.ws.once('close',code=>{closeCode=code;});
    const resumed=await join(one.welcome.room,'hero',one.welcome.token);assert.equal(resumed.welcome.playerId,one.welcome.playerId);
    await until(()=>closeCode!==undefined,'takeover close',3000);assert.equal(closeCode,4001);
  });
  report('gateway',{result:'pass'});
}catch(error){report('gateway',{result:'fail',failure:error.message});process.exitCode=1;}
finally{cleanup();}
