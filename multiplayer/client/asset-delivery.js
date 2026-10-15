// Native streaming decompression preserves every authored model byte. The
// content hash gives repeated visits an immutable URL without stale art after updates.
const prefetched=new Map();
const consumedByStore=new WeakMap();
function consumed(store){if(!consumedByStore.has(store))consumedByStore.set(store,new Set());return consumedByStore.get(store);}
export function prefetchAssets(packed,names,{fetchImpl=globalThis.fetch,concurrency=4,store=prefetched}={}){
  if(typeof globalThis.DecompressionStream!=='function')return;
  const pending=names.map(name=>packed[`/assets/${name}.glb`]).filter(url=>url&&!store.has(url));
  let next=0;
  for(let i=0;i<Math.min(concurrency,pending.length);i++)void(async()=>{
    while(next<pending.length){
      const url=pending[next++];
      if(consumed(store).has(url)||store.has(url))continue;
      // Low network priority keeps the welcome screen and game modules first.
      const body=fetchImpl(url,{priority:'low'}).then(response=>{if(!response.ok)throw Error('Asset prefetch failed');return response.arrayBuffer();}).catch(()=>null);
      store.set(url,body);await body;
    }
  })();
}
export function createAssetDelivery(loader,{packed={},fetchImpl=globalThis.fetch,
  Decompress=globalThis.DecompressionStream,onFallback=()=>{},preloads=prefetched}={}){
  const direct=loader.load.bind(loader);
  return (url,onLoad,onProgress,onError)=>{
    if(!packed[url]||typeof Decompress!=='function')return direct(url,onLoad,onProgress,onError);
    consumed(preloads).add(packed[url]);
    void (async()=>{
      let gltf;
      try{
        const early=preloads.get(packed[url]);preloads.delete(packed[url]);
        let body=early?await early:null;
        if(!body){
          const response=await fetchImpl(packed[url]);
          if(!response.ok||!response.body)throw Error(`Model delivery returned HTTP ${response.status}`);
          body=await response.arrayBuffer();
        }
        // Static servers may supply Content-Encoding and browsers then decode
        // automatically. Inspect the payload, not the header, to avoid decoding twice.
        const magic=new Uint8Array(body,0,Math.min(4,body.byteLength));
        const decoded=magic[0]===0x67&&magic[1]===0x6c&&magic[2]===0x54&&magic[3]===0x46;
        const bytes=decoded?body:await new Response(new Blob([body]).stream().pipeThrough(new Decompress('gzip'))).arrayBuffer();
        const path=loader.resourcePath||url.slice(0,url.lastIndexOf('/')+1);
        gltf=await loader.parseAsync(bytes,path);
      }catch(error){onFallback(url,error);direct(url,onLoad,onProgress,onError);return;}
      // Installation failures are not network failures: never install a model twice.
      onLoad(gltf);
    })().catch(error=>onError?.(error));
  };
}
