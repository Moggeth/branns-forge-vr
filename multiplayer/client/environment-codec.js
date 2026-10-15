// Bit-exact half-float CubeUV storage. Predict adjacent samples per channel,
// then separate low/high bytes for gzip. Neutral RGB shares one plane.
export function encodeEnvironment(pixels,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||!(pixels instanceof Uint16Array)||pixels.length!==width*height*4)throw Error('Invalid environment pixels');
  let grey=true;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==pixels[i+1]||pixels[i]!==pixels[i+2]){grey=false;break;}
  const channels=grey?[0,3]:[0,1,2,3],count=width*height,bytes=new Uint8Array(16+count*channels.length*2),header=new DataView(bytes.buffer);
  bytes.set([66,70,69,78]);header.setUint16(4,width,true);header.setUint16(6,height,true);bytes[8]=channels.length;bytes[9]=1;
  channels.forEach((channel,plane)=>{let previous=0;const base=16+plane*count*2;for(let i=0;i<count;i++){const value=pixels[i*4+channel],delta=(value-previous)&65535;bytes[base+i]=delta&255;bytes[base+count+i]=delta>>>8;previous=value;}});
  return bytes;
}
export function decodeEnvironment(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<16||bytes[0]!==66||bytes[1]!==70||bytes[2]!==69||bytes[3]!==78||bytes[9]!==1)throw Error('Invalid environment header');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint16(4,true),height=view.getUint16(6,true),channels=bytes[8],count=width*height;
  if(!width||!height||width>4096||height>4096||![2,4].includes(channels)||bytes.length!==16+count*channels*2)throw Error('Invalid environment dimensions');
  const pixels=new Uint16Array(count*4);
  for(let plane=0;plane<channels;plane++){const base=16+plane*count*2,channel=channels===2?(plane===0?0:3):plane;let previous=0;
    for(let i=0;i<count;i++){const value=(previous+bytes[base+i]+bytes[base+count+i]*256)&65535;pixels[i*4+channel]=value;if(channels===2&&channel===0){pixels[i*4+1]=value;pixels[i*4+2]=value;}previous=value;}
  }
  return {width,height,pixels};
}
