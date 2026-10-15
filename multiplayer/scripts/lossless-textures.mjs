// Build-time packaging only: source art, mesh data and material values stay intact.
import sharp from 'sharp';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const aligned=n=>(n+3)&~3;
export function createLosslessImageOptimizer(){
  const cache=new Map();
  return bytes=>{
    const key=digest(bytes);
    if(!cache.has(key))cache.set(key,(async()=>{
      const info=await sharp(bytes).metadata();
      // Preserve unusual colour/profile/orientation contracts in their source format.
      if(info.format!=='png'||info.depth!=='uchar'||info.icc||info.orientation>1||info.pages>1)return bytes;
      const output=await sharp(bytes).webp({lossless:true,nearLossless:false,exact:true,effort:5}).toBuffer();
      if(output.length>=bytes.length)return bytes;
      const before=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const after=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(before.info.width!==after.info.width||before.info.height!==after.info.height||!before.data.equals(after.data))throw Error('Lossless texture changed decoded pixels');
      return output;
    })());
    return cache.get(key);
  };
}
export function readModel(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected a GLB 2 model');
  const length=bytes.readUInt32LE(12),offset=20+length;
  if(bytes.readUInt32LE(offset+4)!==0x004e4942||offset+8+bytes.readUInt32LE(offset)!==bytes.length)throw Error('Expected one embedded model buffer');
  const json=JSON.parse(bytes.subarray(20,offset).toString('utf8'));
  if(json.buffers.length!==1||json.buffers[0].uri)throw Error('Expected one embedded model buffer');
  return {json,bin:bytes.subarray(offset+8)};
}
export async function optimizeModel(bytes,optimizeImage=createLosslessImageOptimizer()){
  const {json,bin}=readModel(bytes),images=new Map(),converted=new Set();
  for(const image of json.images||[]){
    if(image.mimeType!=='image/png'||image.bufferView===undefined)continue;
    const view=json.bufferViews[image.bufferView],source=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
    const output=await optimizeImage(source);
    if(!output.equals(source)){images.set(image.bufferView,output);image.mimeType='image/webp';converted.add(json.images.indexOf(image));}
  }
  if(!converted.size)return bytes;
  // Retain every bufferView index and its exact non-image contents. Shared image
  // bytes can share an aligned range without changing any accessor or mesh.
  const parts=[],ranges=new Map();let offset=0;
  for(let index=0;index<json.bufferViews.length;index++){
    const view=json.bufferViews[index],data=images.get(index)||bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),key=digest(data);
    let range=ranges.get(key);
    if(!range){range={offset,length:data.length};ranges.set(key,range);parts.push(data,Buffer.alloc(aligned(data.length)-data.length));offset+=aligned(data.length);}
    view.byteOffset=range.offset;view.byteLength=range.length;
  }
  for(const texture of json.textures||[])if(converted.has(texture.source)){
    texture.extensions={...texture.extensions,EXT_texture_webp:{source:texture.source}};delete texture.source;
  }
  for(const field of ['extensionsUsed','extensionsRequired'])json[field]=[...new Set([...(json[field]||[]),'EXT_texture_webp'])];
  json.buffers[0].byteLength=offset;
  const text=Buffer.from(JSON.stringify(json)),header=Buffer.alloc(20),binaryHeader=Buffer.alloc(8),padding=Buffer.alloc(aligned(text.length)-text.length,0x20);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+aligned(text.length)+8+offset,8);header.writeUInt32LE(aligned(text.length),12);header.writeUInt32LE(0x4e4f534a,16);
  binaryHeader.writeUInt32LE(offset,0);binaryHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,text,padding,binaryHeader,...parts]);
}
