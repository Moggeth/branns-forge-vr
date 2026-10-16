// Yield to input/painting between bounded construction and asset-install jobs.
export const yieldToBrowser = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
export const afterPaint = () => new Promise(resolve => {
  // Hidden tabs may suspend RAF indefinitely; they must still be able to finish loading.
  const timer = setTimeout(resolve, 100);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); resolve(); }, 0));
});

export function createAssetQueue({concurrency = 2, yieldTask = yieldToBrowser} = {}) {
  const pending = []; let running = 0, enabled = false, completed = 0;
  let background = false, backgroundConcurrency = 1;
  async function pump() {
    while (enabled && running < concurrency) {
      let index = pending.findIndex(job => job.essential);
      if(index<0 && background && pending.length && running<backgroundConcurrency)index=0;
      if (index < 0) return;
      const job = pending.splice(index, 1)[0]; running++;
      void (async () => { try { await yieldTask(); job.resolve(await job.run()); } catch (e) { job.reject(e); } finally { running--; completed++; pump(); } })();
    }
  }
  return {
    add(run, essential = true, key = null) { return new Promise((resolve,reject) => { pending.push({run,essential,key,resolve,reject}); pump(); }); },
    prioritize(key) { const job=pending.find(job=>job.key===key);if(job){job.essential=true;pending.splice(pending.indexOf(job),1);pending.unshift(job);pump();} },
    start() { enabled = true; pump(); },
    background({concurrency:limit=1}={}) { background = true; backgroundConcurrency=Math.max(1,Math.min(concurrency,limit));pump(); },
    stats: () => ({pending: pending.length, running, completed, background}),
  };
}

// Apply before first GPU upload. Share resized images across textures using the
// same GLTF source; protect nearby held weapons with a larger budget at the caller.
export async function prepareAssetTextures(root, {renderer, maxSize = Infinity, yieldTask = yieldToBrowser, stats = {}, upload = true, cancelled = () => false}) {
  const textures = new Set(), sources = new Set(), resizedImages = new Map();
  root.traverse(n => { for (const material of [n.material].flat()) if (material) for (const value of Object.values(material)) if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value); });
  for (const texture of textures) {
    if(cancelled())break;
    const source = texture.source, image = source?.data;
    if (image && !sources.has(source) && Math.max(image.width || 0, image.height || 0) > maxSize && globalThis.createImageBitmap && !texture.isCompressedTexture) {
      const factor = maxSize/Math.max(image.width,image.height);
      try {
        const resized = resizedImages.get(image) || await createImageBitmap(image, {resizeWidth: Math.max(1,Math.round(image.width*factor)), resizeHeight: Math.max(1,Math.round(image.height*factor)), resizeQuality: 'high'});
        resizedImages.set(image,resized);
        source.data = resized; texture.needsUpdate = true;
        stats.textureBytesSaved = (stats.textureBytesSaved || 0) + Math.round((image.width*image.height-resized.width*resized.height)*4*4/3);
        stats.texturesResized = (stats.texturesResized || 0)+1;

      } catch { /* Unsupported image source: keep the original, never lose an asset. */ }
    }
    sources.add(source);
    if(cancelled())break;
    if(upload)renderer.initTexture(texture);
    await yieldTask();
  }
  for(const image of resizedImages.keys())image.close?.();
  return textures.size;
}
