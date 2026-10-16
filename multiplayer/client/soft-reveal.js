// Temporary coverage fade; keep original authored surfaces and GPU ownership.
// Alpha hashing writes depth without transparent sorting or a hard arrival edge.
export function createSoftReveal(root,{seconds=1.2}={}){
  const records=[],copies=new Map();let age=0,done=false;
  root.traverse(node=>{if(!node.material)return;const original=node.material;
    const clone=material=>{if(!copies.has(material)){const m=material.clone();m.onBeforeCompile=material.onBeforeCompile;m.customProgramCacheKey=material.customProgramCacheKey;m.alphaHash=true;m.opacity=0;copies.set(material,m);}return copies.get(material);};
    node.material=Array.isArray(original)?original.map(clone):clone(original);records.push([node,original]);
  });
  function finish(){if(done)return;done=true;for(const [node,material]of records)node.material=material;for(const material of copies.values())material.dispose();}
  return {update(dt){if(done)return;age+=Math.max(0,dt);const t=Math.min(1,age/seconds),fade=t*t*(3-2*t);for(const [original,material]of copies)material.opacity=original.opacity*fade;if(t===1)finish();},finish,get done(){return done;}};
}
