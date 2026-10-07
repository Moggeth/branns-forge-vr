import assert from 'node:assert/strict';
import {launch,BASE,here} from './browser-acceptance-lib.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const started=performance.now(),{browser,page}=await launch({viewport:{width:320,height:240}});
try{
await page.route('**/__hdr-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas id="probe"></canvas>'}));
await page.goto(BASE+'/__hdr-probe');
const results=await page.evaluate(async()=>{
 const T=await import('/node_modules/three/build/three.module.js');const {createAtmospherePost}=await import('/client/atmosphere-post.js');
 const renderer=new T.WebGLRenderer({canvas:document.getElementById('probe'),preserveDrawingBuffer:true});renderer.setSize(320,240);renderer.toneMapping=T.ACESFilmicToneMapping;
 const scene=new T.Scene();scene.background=new T.Color(.22,.5,.3);const camera=new T.PerspectiveCamera(60,320/240,.1,100);camera.position.z=3;
 const post=createAtmospherePost({renderer,tier:'high'});post.set({bloom:.6,rays:0});
 const material=new T.ShaderMaterial({uniforms:{bad:{value:0}},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float bad;void main(){gl_FragColor=vec4(vec3(bad),1.);}'});
 const mesh=new T.Mesh(new T.PlaneGeometry(.04,.04),material);scene.add(mesh);const pixels=new Uint8Array(320*240*4),gl=renderer.getContext(),out=[];
 for(const [name,value] of [['normal',2],['nan',NaN],['infinity',Infinity],['negative-infinity',-Infinity],['overflow',1e30],['recovered',2]]) {
 material.uniforms.bad.value=value;post.render(scene,camera);gl.readPixels(0,0,320,240,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let black=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]<12)black++;out.push({name,blackFraction:black/(320*240),error:gl.getError()});}
 post.dispose();material.dispose();mesh.geometry.dispose();renderer.dispose();return out;
});writeFileSync(join(here,'hdr-safety.json'),JSON.stringify(results,null,2));console.log(results);for(const r of results)assert.ok(r.blackFraction<.01,`${r.name}: a tiny invalid effect blackened ${r.blackFraction*100}% of the view`);assert.deepEqual(page.errors,[]);console.log('HDR safety pass',((performance.now()-started)/1000).toFixed(3));
}finally{await browser.close();}
