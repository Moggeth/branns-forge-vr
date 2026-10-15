import {decodeEnvironment} from './environment-codec.js';
const preloads=new Map();
export function prefetchEnvironment(url,{fetchImpl=globalThis.fetch,store=preloads}={}){
  if(typeof globalThis.DecompressionStream!=='function'||!url||store.has(url))return;
  store.set(url,fetchImpl(url,{priority:'low'}).then(r=>r.ok?r.arrayBuffer():null).catch(()=>null));
}
export async function loadEnvironmentPixels(url,{fetchImpl=globalThis.fetch,Decompress=globalThis.DecompressionStream,store=preloads}={}){
  if(typeof Decompress!=='function')throw Error('Native environment decoding unavailable');
  let body=await store.get(url);store.delete(url);
  if(!body){const response=await fetchImpl(url);if(!response.ok)throw Error(`Environment delivery HTTP ${response.status}`);body=await response.arrayBuffer();}
  const magic=new Uint8Array(body,0,Math.min(4,body.byteLength)),decoded=magic[0]===66&&magic[1]===70&&magic[2]===69&&magic[3]===78;
  const bytes=decoded?body:await new Response(new Blob([body]).stream().pipeThrough(new Decompress('gzip'))).arrayBuffer();
  return decodeEnvironment(bytes);
}
