import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import sharp from 'sharp';
import {createLosslessImageOptimizer,optimizeModel,readModel} from '../scripts/lossless-textures.mjs';
import {packAsset} from '../scripts/asset-delivery-plugin.mjs';
import {loadDeliveredTexture} from '../client/texture-delivery.js';
import {STARTUP_ASSETS} from '../client/asset-catalog.js';
const root=new URL('../public/assets/',import.meta.url);
const viewBytes=(model,index)=>{const v=model.json.bufferViews[index];return model.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);};
const pixels=async bytes=>sharp(bytes).ensureAlpha().raw().toBuffer();
test('all packaged models keep exact geometry, materials, animation and image pixels',async()=>{
  const optimizeImage=createLosslessImageOptimizer();let before=0,after=0,changed=0;
  for(const name of (await readdir(root)).filter(n=>n.endsWith('.glb'))){
    const raw=await readFile(new URL(name,root)),output=await optimizeModel(raw,optimizeImage),source=readModel(raw),target=readModel(output);
    const imageViews=new Set((source.json.images||[]).map(i=>i.bufferView));
    for(let index=0;index<source.json.bufferViews.length;index++)if(!imageViews.has(index))assert.deepEqual(viewBytes(target,index),viewBytes(source,index),`${name} binary view ${index}`);
    for(let index=0;index<(source.json.images||[]).length;index++){
      const a=source.json.images[index],b=target.json.images[index];
      if(a.bufferView===undefined)continue;
      if(a.mimeType===b.mimeType)assert.deepEqual(viewBytes(target,b.bufferView),viewBytes(source,a.bufferView));
      else{assert.equal(b.mimeType,'image/webp');assert.deepEqual(await pixels(viewBytes(source,a.bufferView)),await pixels(viewBytes(target,b.bufferView)),`${name} image ${index}`);changed++;}
    }
    // Only physical buffer layout, lossless image containers and their required
    // extension declarations can change. Compare all remaining scene semantics.
    const normalize=model=>{
      const j=structuredClone(model.json);delete j.buffers;
      for(const view of j.bufferViews){delete view.byteOffset;delete view.byteLength;}
      for(const image of j.images||[])delete image.mimeType;
      for(const texture of j.textures||[])if(texture.extensions?.EXT_texture_webp){texture.source=texture.extensions.EXT_texture_webp.source;delete texture.extensions.EXT_texture_webp;if(!Object.keys(texture.extensions).length)delete texture.extensions;}
      for(const field of ['extensionsUsed','extensionsRequired']){j[field]=(j[field]||[]).filter(e=>e!=='EXT_texture_webp');if(!j[field].length)delete j[field];}
      return j;
    };
    assert.deepEqual(normalize(target),normalize(source),`${name} scene semantics`);
    if(STARTUP_ASSETS.includes(name.slice(0,-4))){before+=(await packAsset(raw)).bytes.length;after+=Math.min((await packAsset(output)).bytes.length,(await packAsset(raw)).bytes.length);}
  }
  assert.ok(changed>30);assert.ok(after<before*.9,'initial model delivery must improve materially');console.log(JSON.stringify({initialBefore:before,initialAfter:after,convertedImages:changed}));
});
test('external PNG copies preserve dimensions and all decoded channels',async()=>{
  const optimizeImage=createLosslessImageOptimizer();let before=0,after=0;
  for(const name of (await readdir(root)).filter(n=>n.endsWith('.png'))){
    const raw=await readFile(new URL(name,root)),output=await optimizeImage(raw),a=await sharp(raw).metadata(),b=await sharp(output).metadata();
    assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.deepEqual(await pixels(raw),await pixels(output),name);before+=raw.length;after+=output.length;
  }
  assert.ok(after<before*.9);console.log(JSON.stringify({externalBefore:before,externalAfter:after}));
});
test('lossless mode preserves even invisible RGB, and skips profiled inputs',async()=>{
  const optimize=createLosslessImageOptimizer(),data=Buffer.alloc(64*64*4);
  for(let i=0;i<data.length;i+=4){data[i]=211;data[i+1]=57;data[i+2]=93;data[i+3]=i%8?255:0;}
  const source=await sharp(data,{raw:{width:64,height:64,channels:4}}).png({compressionLevel:0}).toBuffer(),output=await optimize(source);
  assert.equal((await sharp(output).metadata()).format,'webp');assert.deepEqual(await pixels(output),data);
  const profiled=await sharp(source).withIccProfile('srgb').png().toBuffer();assert.deepEqual(await optimize(profiled),profiled);
});
test('texture delivery falls back once on download/decode failure and preserves callbacks',()=>{
  for(const fail of [false,true]){
    const calls=[],image={},progress=()=>{},error=()=>{};
    const loader={load(url,onLoad,onProgress,onError){calls.push(url);assert.equal(onProgress,progress);if(url==='/small'&&fail)onError(Error('decode'));else onLoad(image);return image;}};
    let installs=0;loadDeliveredTexture(loader,'/raw',tex=>{assert.equal(tex,image);installs++;},progress,error,{'/raw':'/small'});
    assert.deepEqual(calls,fail?['/small','/raw']:['/small']);assert.equal(installs,1);
  }
});
