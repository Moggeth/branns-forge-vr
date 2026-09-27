'use strict';
// Small diagnostic client for the OBS 5.x protocol. Credentials never leave local memory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const WebSocket=require('../service/node_modules/ws');
async function connect(){
 const config=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'obs-studio/plugin_config/obs-websocket/config.json'),'utf8').replace(/^\uFEFF/,''));
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket('ws://127.0.0.1:'+config.server_port); const pending=new Map();
  const timeout=setTimeout(()=>{ws.close();reject(Error('OBS connection timed out'));},5000);
  ws.on('error',reject);
  ws.on('message',raw=>{
   const m=JSON.parse(raw); const d=m.d;
   if(m.op===0){
    const data={rpcVersion:1,eventSubscriptions:0};
    if(d.authentication){const hash=s=>crypto.createHash('sha256').update(s).digest('base64');data.authentication=hash(hash(config.server_password+d.authentication.salt)+d.authentication.challenge);}
    ws.send(JSON.stringify({op:1,d:data}));
   }
   if(m.op===2){clearTimeout(timeout);resolve({close:()=>ws.close(),call:(requestType,requestData={})=>new Promise((res,rej)=>{
    const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);rej(Error(requestType+' timed out'));},7000);
    pending.set(requestId,{res,rej,timer});ws.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));
   })});}
   if(m.op===7){const p=pending.get(d.requestId);if(!p)return;pending.delete(d.requestId);clearTimeout(p.timer);d.requestStatus.result?p.res(d.responseData||{}):p.rej(Error(d.requestType+': '+d.requestStatus.comment));}
  });
  ws.on('close',()=>{clearTimeout(timeout);for(const p of pending.values()){clearTimeout(p.timer);p.rej(Error('OBS disconnected'));}pending.clear();});
 });
}
module.exports={connect};
if(require.main===module)(async()=>{const c=await connect();try{console.log(JSON.stringify(await c.call(process.argv[2]||'GetRecordStatus',JSON.parse(process.argv[3]||'{}')),null,2));}finally{c.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
