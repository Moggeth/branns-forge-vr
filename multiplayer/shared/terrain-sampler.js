// Caller-owned exact vertex cache shared by visual systems. Call setState on every
// accepted snapshot (including in-place edit changes). No approximate heights/LOD.
import {TERRAIN_GRID,rawTerrainHeight,triangleHeight,terrainFrameKey,terrainDirtyEdits,restoreTerrainEdit} from './terrain.js';
const {half,step,segments}=TERRAIN_GRID,side=segments+1;
export function createTerrainSampler(initial={edits:[]}) {
 const heights=new Float64Array(side*side),valid=new Uint8Array(side*side);
 let state=initial,previous=[],previousTick=Infinity,key=null,samples=0,hits=0,invalidated=0,updates=0;
 function vertex(x,z) {
  const ix=(x+half)/step,iz=(z+half)/step;
  if(ix<0||ix>segments||iz<0||iz>segments||!Number.isInteger(ix)||!Number.isInteger(iz))return rawTerrainHeight(state,x,z);
  const index=iz*side+ix;
  if(valid[index]){hits++;return heights[index];}
  samples++;valid[index]=1;return heights[index]=rawTerrainHeight(state,x,z);
 }
 function setState(next) {
  state=next;const edits=next.edits||[],tick=next.tick??Infinity,nextKey=terrainFrameKey(edits,tick);
  if(nextKey===key)return false;
  // IDs identify edits in real snapshots. Anonymous authoring/test edits take the safe full path.
  const unique=new Set(edits.map(e=>e.id));
  const full=key===null||unique.size!==edits.length||edits.some(e=>e.id===undefined)||previous.some(e=>e.id===undefined);
  const dirty=full?null:terrainDirtyEdits(previous,edits,previousTick,tick);
  if(full){invalidated+=valid.reduce((a,b)=>a+b,0);valid.fill(0);}
  else for(const e of dirty){
   const minX=Math.max(0,Math.ceil((e.x-e.radius+half)/step)),maxX=Math.min(segments,Math.floor((e.x+e.radius+half)/step));
   const minZ=Math.max(0,Math.ceil((e.z-e.radius+half)/step)),maxZ=Math.min(segments,Math.floor((e.z+e.radius+half)/step));
   for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){const index=z*side+x;invalidated+=valid[index];valid[index]=0;}
  }
  previous=edits.map(restoreTerrainEdit);previousTick=tick;key=nextKey;updates++;return true;
 }
 setState(initial);
 return {setState,height:(x,z)=>triangleHeight(vertex,x,z),stats:()=>({samples,hits,invalidated,updates,capacity:heights.length,bytes:heights.byteLength+valid.byteLength})};
}
