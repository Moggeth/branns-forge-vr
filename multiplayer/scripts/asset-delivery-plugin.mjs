import {readdir,readFile} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
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
        return Object.fromEntries(entries);
      })();
      return {code:`export const PACKED_ASSETS=${JSON.stringify(await manifestPromise)};`,map:null};
    },
  };
}
