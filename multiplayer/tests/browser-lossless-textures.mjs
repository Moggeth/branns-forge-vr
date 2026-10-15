// Run against a production preview/deployment. Compare browser-decoded GPU pixels,
// independently of the build encoder's raw-pixel check, including transparent RGB.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,stubUnavailableRooms} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch();
try{
  await page.route('**/__texture-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Texture delivery QA</title>'}));
  await page.goto(BASE+'/__texture-qa');
  const result=await page.evaluate(async()=>{
    const report=await (await fetch('/assets/download-report.json')).json();
    // Content-addressed model names are discoverable from resource entries in
    // the generated report, not from minifier-specific JavaScript variable names.
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 required');
    const texture=gl.createTexture(),frame=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindFramebuffer(gl.FRAMEBUFFER,frame);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    async function pixels(bytes,type,colorSpaceConversion){
      // GLTF ImageBitmapLoader disables colour conversion; external textures use
      // the browser default. Exercise both paths without premultiplied rounding.
      const bitmap=await createImageBitmap(new Blob([bytes],{type}),{premultiplyAlpha:'none',colorSpaceConversion});
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete pixel comparison target');
      const data=new Uint8Array(bitmap.width*bitmap.height*4);gl.readPixels(0,0,bitmap.width,bitmap.height,gl.RGBA,gl.UNSIGNED_BYTE,data);bitmap.close();return data;
    }
    let images=0,samples=0;
    async function compare(a,b,at,bt,label){for(const conversion of ['none','default']){const x=await pixels(a,at,conversion),y=await pixels(b,bt,conversion);if(x.length!==y.length||x.some((v,i)=>v!==y[i]))throw Error('Browser pixels changed: '+label+' '+conversion);samples+=x.length;}images++;}
    const parse=bytes=>{const view=new DataView(bytes),n=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),bin=new Uint8Array(bytes,28+n);return {json,image:i=>{const v=json.bufferViews[json.images[i].bufferView];return bin.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}};};
    for(const model of report.models.filter(m=>m.before!==m.after)){
      const original=parse(await(await fetch('/assets/'+model.name)).arrayBuffer()),response=await fetch(model.url),body=await response.arrayBuffer();
      const decoded=new Uint8Array(body)[0]===103?body:await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),packed=parse(decoded);
      for(let i=0;i<(original.json.images||[]).length;i++)if(original.json.images[i].mimeType!==packed.json.images[i].mimeType)await compare(original.image(i),packed.image(i),original.json.images[i].mimeType,packed.json.images[i].mimeType,model.name+':'+i);
    }
    for(const item of report.textures)await compare(await(await fetch('/assets/'+item.name)).arrayBuffer(),await(await fetch(item.url)).arrayBuffer(),'image/png','image/webp',item.name);
    gl.deleteFramebuffer(frame);gl.deleteTexture(texture);return {images,samples};
  });
  assert.ok(result.images>=50);assert.deepEqual(page.errors,[]);record('browser-lossless-pixels','pass',result);
}finally{await browser.close();}
// Both network errors and undecodable responses must recover the complete ground.
for(const failure of ['http','decode']){
  const {browser,page}=await launch({touch:true,viewport:{width:390,height:844}});
  try{
    const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
    await stubUnavailableRooms(page);
    await page.route(/\/assets\/packed\/meadow_albedo\.[a-f0-9]+\.webp$/,route=>route.fulfill(failure==='http'?{status:503,body:'Deliberate texture failure'}:{contentType:'image/webp',body:'Deliberate invalid image'}));
    await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#world')?.brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
    const startup=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().startup);
    assert.equal(startup.error,null);assert.ok(requests.includes('/assets/meadow_albedo.png'));
    assert.deepEqual(page.errors.filter(e=>!(failure==='http'&&/HTTP 503 .*meadow_albedo/.test(e))),[]);
    record('texture-fallback-'+failure,'pass',{startup});
  }finally{await browser.close();}
}
save('lossless-textures');
