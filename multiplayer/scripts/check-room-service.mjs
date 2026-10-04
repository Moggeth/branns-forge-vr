// Read-only release gate: deploy the cloud coordinator before its browser client.
import {pathToFileURL} from 'node:url';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';

export async function checkRoomService({peerUrl,timeoutMs=8000,fetchImpl=fetch}={}) {
  let endpoint;
  try { endpoint=new URL(peerUrl); } catch { throw Error('Set PEER_URL to the cloud WebSocket endpoint before publishing.'); }
  const local=['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname);
  if(endpoint.pathname!=='/peer/cloud'||!['wss:','ws:'].includes(endpoint.protocol)||endpoint.protocol==='ws:'&&!local||endpoint.username||endpoint.password)
    throw Error('PEER_URL must be wss://host/peer/cloud (local ws:// is allowed for verification).');
  endpoint.protocol=endpoint.protocol==='wss:'?'https:':'http:';endpoint.search='';endpoint.hash='';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const read=async path=>{
    const url=new URL(endpoint);url.pathname=path;
    let response;
    try { response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json'}}); }
    catch { throw Error(controller.signal.aborted?'Room-service readiness timed out. Check the Worker and retry before publishing.':'Room service could not be reached. Check PEER_URL and deploy the Worker before publishing.'); }
    if(response.status!==200)throw Error(`${path} returned HTTP ${response.status}. Deploy the Worker with the v2 directory migration before publishing the website.`);
    try { return await response.json(); } catch { throw Error(`${path} did not return valid JSON. Check the Worker deployment before publishing.`); }
  };
  try {
    const [health,directory]=await Promise.all([read('/peer/health'),read('/peer/rooms')]);
    if(!health?.ok||health.service!=='cloud-rooms'||!Number.isSafeInteger(health.maxPeers)||health.maxPeers<MAX_PLAYERS)
      throw Error(`The cloud room service must support at least ${MAX_PLAYERS} players. Deploy the current Worker before publishing the website.`);
    if(!directory||!Array.isArray(directory.rooms)||directory.rooms.length>50||!directory.rooms.every(r=>r&&/^\d{8}$/.test(r.code)&&Number.isSafeInteger(r.count)&&Number.isSafeInteger(r.maxPlayers)&&r.count>=0&&r.count<=r.maxPlayers&&typeof r.joinable==='boolean'&&Array.isArray(r.players))||!(directory.nextCursor===null||typeof directory.nextCursor==='string'&&/^room:\d{8}$/.test(directory.nextCursor)))
      throw Error('The public room directory returned an invalid listing. Verify the v2 Worker migration before publishing.');
    return {maxPeers:health.maxPeers,rooms:directory.rooms.length};
  } finally {clearTimeout(timer);controller.abort();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const started=performance.now();
  try {
    const result=await checkRoomService({peerUrl:process.env.PEER_URL||process.env.VITE_PEER_WS_URL});
    console.log(`Room service ready: ${result.maxPeers} human seats; public directory responds (${((performance.now()-started)/1000).toFixed(3)}s).`);
  } catch(error) {console.error(`Room-service release gate failed: ${error.message}`);process.exitCode=1;}
}
