// Set an effect pool's live instance count and mark only that much of its buffers for upload. Pools used to flag the
// whole instanceMatrix (and colours) every frame even with nothing alive, so three.js re-sent tens of kilobytes per
// pool per frame. An empty pool uploads nothing, and a live one only its live slots.
export function setLiveInstances(mesh, n) {
  mesh.count = n;
  if (n === 0) return false; // nothing drawn, nothing to send; the next live frame rewrites every slot it shows
  for (const a of [mesh.instanceMatrix, mesh.instanceColor]) {
    if (!a) continue; a.clearUpdateRanges(); a.addUpdateRange(0, Math.min(a.count, n) * a.itemSize); a.needsUpdate = true;
  }
  return true;
}
