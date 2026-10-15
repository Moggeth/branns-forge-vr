import {readdir,readFile} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fingerprintSource} from './lighting-fingerprint.mjs';
const compress=promisify(gzip);
const root=new URL('../public/assets/',import.meta.url);
export async function packAsset(bytes){
  const packed=await compress(bytes,{level:9});
  return {bytes:packed,hash:createHash('sha256').update(packed).digest('hex').slice(0,16)};
}
export function assetDelivery(){
  let manifestPromise;
  return {name:'lossless-asset-delivery',apply:'build',
    buildStart(){manifestPromise=undefined;},
    async transform(code,id){
      if(!id.replaceAll('\\','/').endsWith('/client/asset-delivery-manifest.js'))return null;
      manifestPromise??=(async()=>{
        const entries=[];let raw=0,packed=0;
        for(const name of (await readdir(root)).filter(n=>n.endsWith('.glb')).sort()){
          const input=await readFile(new URL(name,root)),output=await packAsset(input);
          if(output.bytes.length>=input.length)continue;
          const fileName=`assets/packed/${name.slice(0,-4)}.${output.hash}.glb.gz`;
          this.emitFile({type:'asset',fileName,source:output.bytes});
          entries.push([`/assets/${name}`,`/${fileName}`]);raw+=input.length;packed+=output.bytes.length;
        }
        console.log(`asset-delivery: ${entries.length} exact GLBs, ${raw} -> ${packed} bytes (${Math.round((1-packed/raw)*100)}% smaller)`);
        const environments={},lighting=new URL('lighting/',root),metadata=JSON.parse(await readFile(new URL('room-environment.json',lighting),'utf8'));
        const threeVersion=JSON.parse(await readFile(new URL('../node_modules/three/package.json',import.meta.url),'utf8')).version;
        const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
        if(metadata.sigma!==.04||metadata.near!==.1||metadata.far!==100||metadata.variants.map(v=>v.size).join(',')!=='128,256'||metadata.three!==threeVersion||metadata.source!==fingerprintSource(await readFile(new URL('../node_modules/three/examples/jsm/environments/RoomEnvironment.js',import.meta.url)))||metadata.atmosphere!==fingerprintSource(await readFile(new URL('../client/atmosphere-materials.js',import.meta.url))))throw Error('Fixed lighting bake is stale; regenerate with scripts/bake-room-environment.mjs');
        for(const variant of metadata.variants){
          const bytes=await readFile(new URL(variant.file,lighting)),hash=digest(bytes);
          if(hash!==variant.encodedSha256)throw Error('Fixed lighting bake hash mismatch');
          const fileName=`assets/packed/room-${variant.size}.${hash.slice(0,16)}.bfenv.gz`;
          this.emitFile({type:'asset',fileName,source:bytes});environments[variant.size]=`/${fileName}`;
        }
        return {models:Object.fromEntries(entries),environments};
      })();
      const manifest=await manifestPromise;
      return {code:`export const PACKED_ASSETS=${JSON.stringify(manifest.models)};export const BAKED_ENVIRONMENTS=${JSON.stringify(manifest.environments)};`,map:null};
    },
  };
}
