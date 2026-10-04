// Idle-hidden effects otherwise compile on their first cast. Use isolated draw
// representatives with the runtime materials: no actions, audio or world edits.
export function createAbilityWarmup(T, scene) {
 const group = new T.Group(), geometries = [];
 group.name = 'AbilityShaderWarmup';
 scene.traverse(source => {
  const materials = [source.material].flat();
  if (!(source.isMesh || source.isPoints) || source.isSkinnedMesh || source.isInstancedMesh ||
      !materials.some(m => m?.isShaderMaterial)) return;
  const geometry = source.geometry.clone(); geometries.push(geometry);
  geometry.setDrawRange(0, Math.min(geometry.index?.count ?? geometry.attributes.position.count, 6));
  const mesh = source.isPoints ? new T.Points(geometry, source.material) : new T.Mesh(geometry, source.material);
  mesh.name = `warm-${source.name}`; mesh.frustumCulled = false;
  mesh.position.set(0,1,-3); mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
  mesh.customDepthMaterial = source.customDepthMaterial; mesh.customDistanceMaterial = source.customDistanceMaterial;
  group.add(mesh);
 });
 let disposed = false;
 return {group, stats:{draws:group.children.length}, dispose(){
  if(disposed)return;disposed=true;group.removeFromParent();
  for(const g of geometries)g.dispose();group.clear();
 }};
}
