import {PACKED_TEXTURES} from './asset-delivery-manifest.js';
// Keep the authored PNG available when a browser cannot decode the smaller copy
// or its request fails. Install exactly once, using the same TextureLoader flags.
export function loadDeliveredTexture(loader,url,onLoad,onProgress,onError,packed=PACKED_TEXTURES){
  if(!packed[url])return loader.load(url,onLoad,onProgress,onError);
  return loader.load(packed[url],onLoad,onProgress,()=>loader.load(url,onLoad,onProgress,onError));
}
