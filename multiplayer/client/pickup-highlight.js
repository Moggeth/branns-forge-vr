import * as T from 'three';

/** One shared, depth-tested ground marker for the exact E target; no per-item material or light. */
export function createPickupHighlight({scene}) {
 const geometry=new T.RingGeometry(.28,.31,32);
 const material=new T.MeshBasicMaterial({color:0xe9c982,transparent:true,opacity:.44,depthTest:true,depthWrite:false,side:T.DoubleSide});
 const ring=new T.Mesh(geometry,material);ring.name='collectible-highlight';ring.rotation.x=-Math.PI/2;ring.visible=false;ring.renderOrder=2;ring.raycast=()=>{};scene.add(ring);
 let targetId=null;
 return {
  /** Pass the same shared nearestCollectible result sent by E. null immediately hides stale/uncollectible targets. */
  update(target,now=0,height=null) {
   if(!target||target.held||target.full||target.unnecessary){ring.visible=false;targetId=null;return;}
   targetId=target.id;ring.visible=true;
   const [x,y,z]=target.position;ring.position.set(x,(height?height(x,z):y)+.035,z);
   ring.scale.setScalar(target.type==='log'?1.75:1);material.opacity=.38+Math.sin(now*.003)*.06;
  },
  clear(){ring.visible=false;targetId=null;},
  stats:()=>({targetId,meshes:1,materials:1,visible:ring.visible}),
  dispose(){ring.removeFromParent();geometry.dispose();material.dispose();}
 };
}
