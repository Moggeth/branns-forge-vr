import {Vector4} from 'three';
import {afterPaint} from './startup-work.js';

// Upload/prepare actual draw variants a few at a time in a small scissored canvas area behind the lobby. A single
// whole-world first draw can synchronously stall the driver for many seconds.
// Caller compiles the scene/actual render-target variants once beforehand;
// Three.compileAsync traverses every mesh, ignoring these batch camera layers.
export async function warmRender({renderer, scene, camera, cancelled = () => false, batchSize = 24}) {
  const layer = 30, records = [], draws = [];
  scene.traverseVisible(node => {
    if (node.isMesh || node.isPoints || node.isLine || node.isSprite || node.isLight) {
      records.push([node,node.layers.mask,node.frustumCulled]);
      const lit=node.layers.test(camera.layers);node.layers.disable(layer);
      if (node.isLight) {if(lit)node.layers.enable(layer);}
      else { draws.push(node); node.frustumCulled=false; }
    }
  });
  const view=camera.clone();view.layers.set(layer);
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
  const initialWidth=renderer.domElement.width,initialHeight=renderer.domElement.height;
  const started=performance.now();let maxBatchMs=0,batches=0;
  try {
    for(let i=0;i<draws.length;i+=batchSize){
      if(cancelled())break;
      const batch=draws.slice(i,i+batchSize);batch.forEach(n=>n.layers.enable(layer));
      renderer.setRenderTarget(null);
      renderer.setViewport(0,0,64,64);renderer.setScissor(0,0,64,64);renderer.setScissorTest(true);
      const t=performance.now();renderer.render(scene,view);maxBatchMs=Math.max(maxBatchMs,performance.now()-t);batches++;
      batch.forEach(n=>n.layers.disable(layer));
      renderer.setRenderTarget(previous);
      await afterPaint();
    }
  } finally {
    for(const [node,mask,culled] of records){node.layers.mask=mask;node.frustumCulled=culled;}
    renderer.setRenderTarget(previous);
    // Rotation may resize the canvas during an awaited batch. Never restore a stale viewport.
    if(renderer.domElement.width!==initialWidth||renderer.domElement.height!==initialHeight){
      const ratio=renderer.getPixelRatio();renderer.setViewport(0,0,renderer.domElement.width/ratio,renderer.domElement.height/ratio);
    }else renderer.setViewport(viewport);
    renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    renderer.shadowMap.needsUpdate=true;
  }
  return {batches,maxBatchMs,totalMs:performance.now()-started};
}
