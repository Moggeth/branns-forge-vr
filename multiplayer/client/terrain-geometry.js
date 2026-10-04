// Keep the existing terrain grid and exact area-weighted Three normals. Local
// earthworks touch only their vertices and the one-ring normal neighbourhood;
// unchanged ground need not be resampled, renormalized or uploaded to the GPU.
import {Vector3} from 'three';

export function createTerrainGeometryUpdater(geometry) {
  const p=geometry.attributes.position,n=geometry.attributes.normal,ix=geometry.index;
  const {width,height,widthSegments:cols,heightSegments:rows}=geometry.parameters;
  if (!ix || !n || p.count!==(cols+1)*(rows+1)) throw new Error('Terrain updates require an indexed plane grid');
  const side=cols+1,dx=width/cols,dz=height/rows,adj=Array.from({length:p.count},()=>[]);
  for(let f=0;f<ix.count;f+=3)for(let k=0;k<3;k++)adj[ix.getX(f+k)].push(f);
  const stamps=new Uint32Array(p.count),normalStamps=new Uint32Array(p.count);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),cb=new Vector3(),ab=new Vector3(),norm=new Vector3();
  let generation=0,ready=false,last={sampled:0,changed:0,normals:0};
  const changed=[],affected=[];
  const fullPending=new Set();
  for(const attribute of [p,n]){
    const beforeUpload=attribute.onUploadCallback;
    attribute.onUpload(function(){fullPending.delete(attribute);beforeUpload.call(this);});
  }
  // Keep pending ranges from earlier snapshots: the renderer may not yet have
  // uploaded them. Three merges these runs and clears them after upload.
  function upload(attribute,vertices){
    if(fullPending.has(attribute)){attribute.needsUpdate=true;return;}
    vertices.sort((a,b)=>a-b);
    let start=vertices[0],end=start;
    for(let i=1;i<=vertices.length;i++){
      const next=vertices[i];if(next===end+1){end=next;continue;}
      attribute.addUpdateRange(start*3,(end-start+1)*3);start=end=next;
    }
    attribute.needsUpdate=true;
  }
  function update(heightAt,dirty=null){
    if(!ready||!dirty){
      for(let i=0;i<p.count;i++)p.setY(i,heightAt(p.getX(i),p.getZ(i)));
      // Whole-buffer requests also replace any pending partial updates.
      p.clearUpdateRanges();n.clearUpdateRanges();fullPending.add(p);fullPending.add(n);p.needsUpdate=true;
      geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();ready=true;
      return last={sampled:p.count,changed:p.count,normals:n.count,positionUploadBytes:p.array.byteLength,normalUploadBytes:n.array.byteLength};
    }
    generation=(generation+1)>>>0;if(!generation){stamps.fill(0);normalStamps.fill(0);generation=1;}
    changed.length=affected.length=0;let sampled=0;
    for(const e of dirty){
      const r=e.radius+.75,i0=Math.max(0,Math.floor((e.x-r+width/2)/dx)),i1=Math.min(cols,Math.ceil((e.x+r+width/2)/dx));
      const j0=Math.max(0,Math.floor((e.z-r+height/2)/dz)),j1=Math.min(rows,Math.ceil((e.z+r+height/2)/dz));
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const v=j*side+i;if(stamps[v]===generation)continue;
        const x=p.getX(v),z=p.getZ(v);if(Math.hypot(x-e.x,z-e.z)>r)continue;
        stamps[v]=generation;sampled++;const y=Math.fround(heightAt(x,z));if(y===p.getY(v))continue;
        p.setY(v,y);changed.push(v);
        for(const f of adj[v])for(let k=0;k<3;k++){
          const w=ix.getX(f+k);if(normalStamps[w]!==generation){normalStamps[w]=generation;affected.push(w);}
        }
      }
    }
    const fullNormals=affected.length>n.count/3;
    if(fullNormals){n.clearUpdateRanges();fullPending.add(n);geometry.computeVertexNormals();}
    else for(const v of affected){
      n.setXYZ(v,0,0,0);
      // Original triangle order and float32 rounding exactly match Three's full
      // computeVertexNormals, including faces outside the dirty edit itself.
      for(const f of adj[v]){
        a.fromBufferAttribute(p,ix.getX(f));b.fromBufferAttribute(p,ix.getX(f+1));c.fromBufferAttribute(p,ix.getX(f+2));
        cb.subVectors(c,b);ab.subVectors(a,b);cb.cross(ab);
        n.setXYZ(v,n.getX(v)+cb.x,n.getY(v)+cb.y,n.getZ(v)+cb.z);
      }
      norm.fromBufferAttribute(n,v).normalize();n.setXYZ(v,norm.x,norm.y,norm.z);
    }
    if(changed.length){upload(p,changed);if(!fullNormals)upload(n,affected);geometry.computeBoundingSphere();geometry.computeBoundingBox();}
    return last={sampled,changed:changed.length,normals:fullNormals?n.count:affected.length,
      positionUploadBytes:changed.length?(fullPending.has(p)?p.array.byteLength:changed.length*3*p.array.BYTES_PER_ELEMENT):0,
      normalUploadBytes:affected.length?(fullPending.has(n)?n.array.byteLength:affected.length*3*n.array.BYTES_PER_ELEMENT):0};
  }
  return {update,stats:()=>({...last,vertices:p.count})};
}
