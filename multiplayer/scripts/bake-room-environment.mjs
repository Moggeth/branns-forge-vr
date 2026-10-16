// Start Vite, then BAKE_BASE=http://127.0.0.1:5196 node scripts/bake-room-environment.mjs.
// PW_CORE/PW_CHROME use the acceptance suite's isolated browser setup.
import {launch} from '../tests/browser-acceptance-lib.mjs';
import {encodeEnvironment} from '../client/environment-codec.js';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {fingerprintSource} from './lighting-fingerprint.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),{browser,page}=await launch();
const output=new URL('../public/assets/lighting/',import.meta.url);mkdirSync(output,{recursive:true});
try{
 await page.goto((process.env.BAKE_BASE||'http://127.0.0.1:5196')+'/tests/environment-bake.html');await page.waitForFunction(()=>window.bakeRoomEnvironment);
 const manifest={three:JSON.parse(readFileSync(new URL('../node_modules/three/package.json',import.meta.url))).version,source:fingerprintSource(readFileSync(new URL('../node_modules/three/examples/jsm/environments/RoomEnvironment.js',import.meta.url))),atmosphere:fingerprintSource(readFileSync(new URL('../client/atmosphere-materials.js',import.meta.url))),sigma:.04,near:.1,far:100,format:'BFEN v1; predicted half floats; gzip',variants:[]};
 for(const size of [128,256]){
  const result=await page.evaluate(size=>window.bakeRoomEnvironment(size),size),raw=Buffer.from(result.base64,'base64');delete result.base64;
  const pixels=new Uint16Array(raw.buffer,raw.byteOffset,raw.length/2),encoded=encodeEnvironment(pixels,result.width,result.height),packed=gzipSync(encoded,{level:9}),name=`room-${size}.bfenv.gz`;
  writeFileSync(new URL(name,output),packed);manifest.variants.push({...result,file:name,bytes:packed.length,pixelSha256:hash(raw),encodedSha256:hash(packed)});console.log(JSON.stringify({...result,bytes:packed.length}));
 }
 if(page.errors.length)throw Error(page.errors.join('\n'));
 writeFileSync(new URL('room-environment.json',output),JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();}
