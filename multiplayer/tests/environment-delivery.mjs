import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {encodeEnvironment,decodeEnvironment} from '../client/environment-codec.js';
import {loadEnvironmentPixels,prefetchEnvironment} from '../client/environment-delivery.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const grey of [false,true]){
 const pixels=Uint16Array.from({length:96},(_,i)=>(i*63131)&65535);
 if(grey)for(let i=0;i<pixels.length;i+=4)pixels[i+1]=pixels[i+2]=pixels[i];
 const encoded=encodeEnvironment(pixels,6,4);assert.deepEqual(decodeEnvironment(encoded).pixels,pixels);
 for(const raw of [false,true]){const result=await loadEnvironmentPixels('/env',{store:new Map(),fetchImpl:async()=>new Response(raw?encoded:gzipSync(encoded))});assert.deepEqual(result.pixels,pixels);}
 for(const broken of [encoded.slice(0,8),encoded.slice(0,-1),new Uint8Array(encoded).fill(0,8,10)])assert.throws(()=>decodeEnvironment(broken));
}
const metadata=JSON.parse(readFileSync(new URL('../public/assets/lighting/room-environment.json',import.meta.url)));
assert.deepEqual(metadata.variants.map(v=>v.size),[128,256]);
for(const variant of metadata.variants){
 const packed=readFileSync(new URL('../public/assets/lighting/'+variant.file,import.meta.url));assert.equal(hash(packed),variant.encodedSha256);
 const result=decodeEnvironment(gunzipSync(packed));assert.equal(result.width,variant.size*3);assert.equal(result.height,variant.size*4);assert.equal(hash(Buffer.from(result.pixels.buffer)),variant.pixelSha256);
 assert.ok(packed.length<result.pixels.byteLength*.08,'fixed lighting must remain much smaller than the half-float pixels');
}
let requests=0;const store=new Map(),encoded=encodeEnvironment(new Uint16Array(4),1,1);
const fetchImpl=async()=>{requests++;return new Response(encoded);};prefetchEnvironment('/env',{store,fetchImpl});await loadEnvironmentPixels('/env',{store,fetchImpl});assert.equal(requests,1);assert.equal(store.size,0);
await assert.rejects(loadEnvironmentPixels('/env',{Decompress:null}),/unavailable/);
await assert.rejects(loadEnvironmentPixels('/env',{fetchImpl:async()=>new Response('',{status:503})}),/503/);
console.log('environment-delivery: exact half-float roundtrip, baked source hashes, HTTP/native decode, prefetch and invalid payload checks passed');
