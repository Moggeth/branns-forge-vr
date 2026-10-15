import * as T from 'three';
import {loadEnvironmentPixels} from './environment-delivery.js';
import {BAKED_ENVIRONMENTS} from './asset-delivery-manifest.js';

// The same fixed RoomEnvironment, stored as exact half floats rather than
// rendered into CubeUV on each visit. Fallback retains the original lighting.
export function createRoomEnvironment({renderer,scene,size,stats={},cancelled=()=>false}){
  let resource=null,released=false;const started=performance.now();
  const ready=(async()=>{
    try{
      const data=await loadEnvironmentPixels(BAKED_ENVIRONMENTS[size]);
      if(data.width!==size*3||data.height!==size*4)throw Error('Environment size mismatch');
      if(released||cancelled())return;
      const texture=new T.DataTexture(data.pixels,data.width,data.height,T.RGBAFormat,T.HalfFloatType);
      texture.mapping=T.CubeUVReflectionMapping;texture.colorSpace=T.LinearSRGBColorSpace;
      texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
      resource=texture;scene.environment=texture;stats.source='baked';
    }catch(error){
      stats.fallbackReason=String(error.message||error);if(released||cancelled())return;
      const {RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js');
      if(released||cancelled())return;
      const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);
      try{resource=pmrem.fromScene(room,.04,.1,100,{size});scene.environment=resource.texture;stats.source='generated';}
      finally{room.dispose();pmrem.dispose();}
    }finally{stats.readyMs=performance.now()-started;}
  })();
  return {ready,dispose(){released=true;resource?.dispose();resource=null;}};
}
