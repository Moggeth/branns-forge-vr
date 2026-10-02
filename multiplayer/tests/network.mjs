import {RoomConnection} from '../client/network.js';
import {assert,check,sleep,report} from './helpers.mjs';

class FakeSocket extends EventTarget {
  static OPEN=1;
  static instances=[];
  constructor(){super();this.readyState=0;this.sent=[];FakeSocket.instances.push(this);}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(data){this.sent.push(JSON.parse(data));}
  message(value){const event=new Event('message');event.data=JSON.stringify(value);this.dispatchEvent(event);}
  close(code=1000){this.readyState=3;const event=new Event('close');event.code=code;this.dispatchEvent(event);}
}
const original=globalThis.WebSocket;globalThis.WebSocket=FakeSocket;
const connections=[];
function connection(){const c=new RoomConnection('ws://synthetic.invalid');connections.push(c);c.connect({room:'synthetic-room',token:'synthetic-token'});return c;}
function welcome(socket,nextSeq=42){socket.message({type:'welcome',room:'synthetic-room',token:'synthetic-token',playerId:'synthetic-player',nextSeq,snapshot:{players:[]}});}
try{
  await check('commands gated until welcome sequence restoration',async()=>{
    const c=connection(),socket=c.socket;socket.open();assert.equal(c.send('input',{move:{x:0,z:0}}),false);assert.equal(socket.sent.length,1);
    welcome(socket);assert.equal(c.send('input',{move:{x:0,z:0}}),true);assert.equal(socket.sent.at(-1).seq,42);c.close();
  });
  await check('invalid reconnect token is terminal and discarded',async()=>{
    const c=connection(),socket=c.socket;socket.open();socket.message({type:'error',code:'invalid_token',message:'Synthetic invalid token'});
    assert.equal(c.closed,true);assert.equal(c.identity.token,'');assert.equal(c.socket,null);assert.equal(c.timer,undefined);
  });
  await check('expired/full room errors are terminal',async()=>{
    for(const code of ['room_not_found','room_full','server_full']){
      const c=connection();c.socket.open();c.socket.message({type:'error',code,message:'Synthetic rejection'});assert.equal(c.closed,true);assert.equal(c.timer,undefined);
    }
  });
  await check('session takeover does not fight replacement connection',async()=>{
    const c=connection(),socket=c.socket;socket.open();welcome(socket);socket.close(4001);assert.equal(c.closed,true);assert.equal(c.timer,undefined);
  });
  await check('transient disconnect retries and restores next sequence',async()=>{
    const c=connection(),socket=c.socket;socket.open();welcome(socket);socket.close(1006);await sleep(550);
    assert.notEqual(c.socket,socket);assert.equal(c.joined,false);c.socket.open();welcome(c.socket,91);c.send('action',{action:'strike'});assert.equal(c.socket.sent.at(-1).seq,91);c.close();
  });
  report('network',{result:'pass'});
}catch(error){report('network',{result:'fail',failure:error.message});process.exitCode=1;}
finally{connections.forEach(c=>c.close());globalThis.WebSocket=original;}
