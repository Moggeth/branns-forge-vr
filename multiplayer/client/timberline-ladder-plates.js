// Small iron range plates beside each rung of the Timberline's brass ladder, with engraved ivory numbers.
// One merged mesh per machine (one draw call), parented to the Elevation node so it pitches with the ladder.
// The rung sockets (Socket_Rung_<metres>) come from the kit build, which places them from client/timberline-ladder.js.
import * as THREE from 'three';

const W=.03,H=.016,CELL_W=128,CELL_H=64;
let atlas=null;
function plateMaterial(ranges){
 const key=ranges.join(',');if(atlas?.key===key)return atlas.material;
 const c=document.createElement('canvas');c.width=CELL_W;c.height=CELL_H*ranges.length;const x=c.getContext('2d');
 ranges.forEach((r,i)=>{const y=i*CELL_H;x.fillStyle='#2a2522';x.fillRect(0,y,CELL_W,CELL_H);x.strokeStyle='#8a6a32';x.lineWidth=5;x.strokeRect(3,y+3,CELL_W-6,CELL_H-6);
  x.font='700 44px Georgia, serif';x.textAlign='center';x.textBaseline='middle';x.fillStyle='rgba(0,0,0,.6)';x.fillText(String(r),CELL_W/2+2,y+CELL_H/2+4);x.fillStyle='#efe3c4';x.fillText(String(r),CELL_W/2,y+CELL_H/2+2);});
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
 atlas={key,material:new THREE.MeshBasicMaterial({map,toneMapped:false,fog:true})};return atlas.material;
}

// nodes: the machine's node map. Returns the plate mesh (or null when the kit has no rung sockets).
export function addLadderPlates(nodes){
 const elev=nodes.Elevation,rungs=Object.keys(nodes).filter(k=>/^Socket_Rung_\d+$/.test(k)).map(k=>({range:+k.slice(12),node:nodes[k]})).sort((a,b)=>a.range-b.range);
 if(!elev||!rungs.length)return null;
 const n=rungs.length,pos=[],uv=[],idx=[],p=new THREE.Vector3(),inv=new THREE.Matrix4();elev.updateWorldMatrix(true,true);inv.copy(elev.matrixWorld).invert();
 rungs.forEach(({node},i)=>{p.setFromMatrixPosition(node.matrixWorld).applyMatrix4(inv);
  // Facing the eye (+Z is backwards in Three), standing off the brass a hair so it never z-fights. Plates alternate
  // right and left of the ladder so the close 25 and 50 m rungs never overlap.
  const x0=i%2?-p.x-W:p.x,x1=x0+W,y0=p.y-H/2,y1=p.y+H/2,z=p.z+.003,v0=1-(i+1)/n,v1=1-i/n,b=i*4;
  pos.push(x0,y0,z,x1,y0,z,x1,y1,z,x0,y1,z);uv.push(0,v0,1,v0,1,v1,0,v1);idx.push(b,b+1,b+2,b,b+2,b+3);});
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
 const mesh=new THREE.Mesh(g,plateMaterial(rungs.map(r=>r.range)));mesh.name='TimberlineLadderPlates';mesh.userData.ignoreContact=true;elev.add(mesh);return mesh;
}
