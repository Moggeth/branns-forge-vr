// Bound the shadow pass without hiding models, lowering animation frequency or
// touching materials/collision geometry. Update at most five times a second.
export function createEnemyShadowBudget({maxCasters=8,range=18,intervalMs=200}={}) {
  const records=new Map();let last=-Infinity,updates=0,writes=0,activeCasters=0,shadowMeshes=0;
  let cap=Math.max(0,Math.floor(maxCasters));const distanceLimit=Math.max(0,range)**2,interval=Math.max(200,intervalMs);
  function write(record,enabled){for(const item of record.meshes){const next=enabled&&item.allowed;if(item.mesh.castShadow!==next){item.mesh.castShadow=next;writes++;}}record.enabled=enabled;}
  function update(actors,focus,now=performance.now(),quality={}) {
    if(quality.maxCasters!==undefined)setMaxCasters(quality.maxCasters);
    if(!focus||now-last<interval)return false;last=now;updates++;
    const x=focus.x??focus[0],z=focus.z??focus[2];if(!Number.isFinite(x)||!Number.isFinite(z))return false;
    const present=new Set(),candidates=[];
    for(const entry of actors.values()) {
      if(!entry.enemy||!entry.visual||!entry.root)continue;
      const visual=entry.visual;present.add(visual);let record=records.get(visual);
      if(!record){const meshes=[];visual.traverse(n=>{if(n.isMesh)meshes.push({mesh:n,allowed:n.castShadow});});record={meshes,enabled:null};records.set(visual,record);}
      const distance=(entry.root.position.x-x)**2+(entry.root.position.z-z)**2;
      if(distance<=distanceLimit&&record.meshes.some(m=>m.allowed))candidates.push({record,distance,id:String(entry.data?.id??'')});
    }
    for(const [visual]of records)if(!present.has(visual))records.delete(visual);
    candidates.sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
    const selected=new Set(candidates.slice(0,cap).map(c=>c.record));activeCasters=selected.size;shadowMeshes=0;
    for(const record of records.values()){const enabled=selected.has(record);if(record.enabled!==enabled)write(record,enabled);if(enabled)shadowMeshes+=record.meshes.filter(m=>m.allowed).length;}
    return true;
  }
  function setMaxCasters(value){const next=Math.max(0,Math.floor(value));if(Number.isFinite(next)&&next!==cap){cap=next;last=-Infinity;}}
  function stats(){return{trackedActors:records.size,activeCasters,shadowMeshes,updates,writes,maxCasters:cap,range:Math.sqrt(distanceLimit)};}
  function dispose(){for(const record of records.values())for(const item of record.meshes)item.mesh.castShadow=item.allowed;records.clear();activeCasters=shadowMeshes=0;}
  return{update,setMaxCasters,stats,dispose};
}
