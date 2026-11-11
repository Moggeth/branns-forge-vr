// Empty-draw skip. Effect pools (sparks, shards, trails, crumbs, stuck bolts, tracers...) stay in the scene with
// nothing to show: an InstancedMesh at count 0, an instanced geometry at instanceCount 0, or a drawRange of 0. three.js
// still pays the whole cost of a draw for them before it notices there is nothing to draw: it binds the shader,
// re-uploads the material's uniforms and binds the vertex arrays. In the Valley about 45 such draws ran every frame,
// in every view, on the main pass and again in the shadow pass.
//
// This skips them before any of that work. Nothing that has something to show is ever skipped, and objects keep their
// onBeforeRender callbacks (three runs those before this point). ?emptyskip=off restores the old behaviour for A/B runs.
export function isEmptyDraw(geometry, object, group) {
  if (object.isInstancedMesh && object.count === 0) return true;
  if (geometry.isInstancedBufferGeometry && geometry.instanceCount === 0) return true;
  if (geometry.drawRange.count === 0 || (group && group.count === 0)) return true;
  const index = geometry.index;
  return index ? index.count === 0 : geometry.attributes.position?.count === 0;
}

export function installEmptyDrawSkip(renderer) {
  const original = renderer.renderBufferDirect, stats = {skipped: 0};
  renderer.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
    if (isEmptyDraw(geometry, object, group)) { stats.skipped++; return; }
    return original.call(this, camera, scene, geometry, material, object, group);
  };
  return {stats: () => ({...stats}), dispose() { renderer.renderBufferDirect = original; }};
}
