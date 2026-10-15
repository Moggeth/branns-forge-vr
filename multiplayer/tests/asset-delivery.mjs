import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {packAsset} from '../scripts/asset-delivery-plugin.mjs';
import {createAssetDelivery,prefetchAssets} from '../client/asset-delivery.js';
import {STARTUP_ASSETS,SECONDARY_ASSETS} from '../client/asset-catalog.js';

test('production packing round-trips every authored GLB byte without changing art',async()=>{
  const root=new URL('../public/assets/',import.meta.url);let input=0,output=0,count=0;
  for(const name of await readdir(root))if(name.endsWith('.glb')){
    const raw=await readFile(new URL(name,root)),packed=await packAsset(raw);
    assert.deepEqual(gunzipSync(packed.bytes),raw,name);
    input+=raw.length;output+=packed.bytes.length;count++;
  }
  assert.ok(count>=60);assert.ok(output<input*.7,'lossless transfer savings must remain material');
  console.log(JSON.stringify({models:count,inputBytes:input,packedBytes:output}));
});

test('content hashes are deterministic and change with the actual model bytes',async()=>{
  const raw=await readFile(new URL('../public/assets/hero.glb',import.meta.url));
  assert.equal((await packAsset(raw)).hash,(await packAsset(raw)).hash);
  assert.notEqual((await packAsset(raw)).hash,(await packAsset(Buffer.concat([raw,Buffer.from([1])]))).hash);
});

for(const automatic of [false,true])test(`loads exact model bytes and original external-image path (${automatic?'HTTP decoding':'native decoding'})`,async()=>{
  const raw=await readFile(new URL('../public/assets/hero.glb',import.meta.url));
  const packed=await packAsset(raw);let paths=[],fallbacks=0;
  const loader={resourcePath:'',load(){throw Error('unexpected fallback');},async parseAsync(bytes,path){assert.deepEqual(Buffer.from(bytes),raw);assert.equal(path,'/assets/');return {model:'hero'};}};
  const load=createAssetDelivery(loader,{packed:{'/assets/hero.glb':'/assets/packed/hero.hash.glb.gz'},fetchImpl:async url=>{paths.push(url);return new Response(automatic?raw:packed.bytes);},onFallback:()=>fallbacks++});
  const result=await new Promise((resolve,reject)=>load('/assets/hero.glb',resolve,undefined,reject));
  assert.deepEqual(result,{model:'hero'});assert.deepEqual(paths,['/assets/packed/hero.hash.glb.gz']);assert.equal(fallbacks,0);
});

for(const failure of ['http','corrupt','parse'])test(`failed packed ${failure} falls back once to the authored file`,async()=>{
  let direct=0,fallbacks=0;const loader={load(url,loaded){direct++;assert.equal(url,'/assets/hero.glb');loaded('original');},async parseAsync(){throw Error('parse');}};
  const load=createAssetDelivery(loader,{packed:{'/assets/hero.glb':'/packed'},fetchImpl:async()=>failure==='http'?new Response('',{status:503}):new Response(failure==='parse'?new Uint8Array([103,108,84,70]):new Uint8Array([1,2,3])),onFallback:()=>fallbacks++});
  assert.equal(await new Promise((resolve,reject)=>load('/assets/hero.glb',resolve,undefined,reject)),'original');
  assert.equal(direct,1);assert.equal(fallbacks,1);
});

test('unsupported decompression and development keep the original loader contract',()=>{
  for(const options of [{packed:{}},{packed:{'/asset':'/packed'},Decompress:null}]){
    const args=[],loader={load(...values){args.push(values);return 'request';}};
    const callbacks=[()=>{},()=>{},()=>{}];assert.equal(createAssetDelivery(loader,options)('/asset',...callbacks),'request');assert.deepEqual(args,[['/asset',...callbacks]]);
  }
});

test('installation failure reports once and never starts a second installation',async()=>{
  let direct=0;const loader={load(){direct++;},parseAsync:async()=>({})};
  const load=createAssetDelivery(loader,{packed:{'/asset':'/packed'},fetchImpl:async()=>new Response(new Uint8Array([103,108,84,70]))});
  const error=await new Promise(resolve=>load('/asset',()=>{throw Error('install');},undefined,resolve));
  assert.equal(error.message,'install');assert.equal(direct,0);
});

test('early transfers are bounded, low priority and omit optional assets',async()=>{
  assert.ok(STARTUP_ASSETS.length>=40);assert.ok(STARTUP_ASSETS.every(name=>!SECONDARY_ASSETS.has(name)));
  const store=new Map(),requests=[],release=[];
  const fetchImpl=(url,options)=>new Promise(resolve=>{requests.push({url,priority:options.priority});release.push(()=>resolve(new Response(new Uint8Array([103,108,84,70]))));});
  prefetchAssets({'/assets/a.glb':'/a','/assets/b.glb':'/b','/assets/c.glb':'/c'},['a','b','c'],{fetchImpl,store,concurrency:2});
  assert.deepEqual(requests,[{url:'/a',priority:'low'},{url:'/b',priority:'low'}]);
  release.splice(0).forEach(run=>run());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,3);release.splice(0).forEach(run=>run());await Promise.all(store.values());
  const loader={load(){throw Error('unexpected raw fallback');},parseAsync:async()=>({ok:true})};
  const load=createAssetDelivery(loader,{packed:{'/assets/c.glb':'/c'},preloads:store,fetchImpl:()=>{throw Error('must consume the early transfer');}});
  assert.deepEqual(await new Promise((resolve,reject)=>load('/assets/c.glb',resolve,undefined,reject)),{ok:true});
  assert.equal(store.has('/c'),false,'release consumed transfer memory');
});
