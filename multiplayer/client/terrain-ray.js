// Exact first-hit query against the rendered shared terrain grid. No Three scene
// traversal: visit only crossed .75 m cells and test their two visible triangles.
import {TERRAIN_GRID} from '../shared/terrain.js';
const {half,segments,step}=TERRAIN_GRID,side=segments+1,EPS=1e-10;
const finite3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createTerrainRaycaster({height}={}) {
  if(typeof height!=='function')throw new Error('terrain ray requires the shared bare-earth height callback');
  const heights=new Float32Array(side*side),stamps=new Uint32Array(side*side);
  let revision=1,queries=0,heightSamples=0,visitedCells=0,lastCells=0;
  function vertex(ix,iz){const index=iz*side+ix;if(stamps[index]!==revision){heights[index]=height(ix*step-half,iz*step-half);stamps[index]=revision;heightSamples++;}return heights[index];}
  function segment(from,to){
    queries++;lastCells=0;if(!finite3(from)||!finite3(to))return null;
    const ox=from[0],oy=from[1],oz=from[2],dx=to[0]-ox,dy=to[1]-oy,dz=to[2]-oz,length=Math.hypot(dx,dy,dz);if(!Number.isFinite(length)||length<1e-12)return null;
    let enter=0,exit=1;
    for(const [o,d]of [[ox,dx],[oz,dz]]){
      if(Math.abs(d)<1e-15){if(o< -half||o>half)return null;continue;}
      let a=(-half-o)/d,b=(half-o)/d;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit+EPS)return null;
    }
    let ix=clamp(Math.floor((ox+dx*enter+half)/step),0,segments-1),iz=clamp(Math.floor((oz+dz*enter+half)/step),0,segments-1);
    const sx=Math.sign(dx),sz=Math.sign(dz),deltaX=sx?step/Math.abs(dx):Infinity,deltaZ=sz?step/Math.abs(dz):Infinity;
    let nextX=sx?((ix+(sx>0?1:0))*step-half-ox)/dx:Infinity,nextZ=sz?((iz+(sz>0?1:0))*step-half-oz)/dz:Infinity;
    // A finite segment can cross at most 2*segments+1 cells in this square.
    for(let count=0;count<=segments*2+2;count++){
      if(ix<0||ix>=segments||iz<0||iz>=segments||enter>exit+EPS)break;
      lastCells++;visitedCells++;const end=Math.min(nextX,nextZ,exit),x0=ix*step-half,z0=iz*step-half;
      const h00=vertex(ix,iz),h10=vertex(ix+1,iz),h01=vertex(ix,iz+1),h11=vertex(ix+1,iz+1);
      for(let upper=0;upper<2;upper++){
        const ax=upper?(h11-h01)/step:(h10-h00)/step,az=upper?(h11-h10)/step:(h01-h00)/step;
        const atOrigin=upper?h11+ax*(ox-x0-step)+az*(oz-z0-step):h00+ax*(ox-x0)+az*(oz-z0),denom=dy-ax*dx-az*dz;
        // Match ground's FrontSide material: upward rays from below do not hit.
        if(!Number.isFinite(denom)||denom>=-1e-14)continue;
        const t=(atOrigin-oy)/denom;if(t<enter-EPS||t>end+EPS||t< -EPS||t>1+EPS)continue;
        const u=(ox+dx*t-x0)/step,v=(oz+dz*t-z0)/step;
        if(u< -EPS||v< -EPS||u>1+EPS||v>1+EPS||(upper?u+v<1-EPS:u+v>1+EPS))continue;
        const f=clamp(t,0,1),nl=Math.hypot(ax,1,az);
        return {point:[ox+dx*f,oy+dy*f,oz+dz*f],normal:[-ax/nl,1/nl,-az/nl],distance:f*length};
      }
      if(end>=exit-EPS)break;
      const crossX=nextX<=nextZ+EPS,crossZ=nextZ<=nextX+EPS;enter=end;
      if(crossX){ix+=sx;nextX+=deltaX;}if(crossZ){iz+=sz;nextZ+=deltaZ;}
    }
    return null;
  }
  return {segment,
    // Clear all cached vertex heights on terrain snapshot/edit/bake changes.
    invalidateTerrain(){revision=(revision+1)>>>0;if(!revision){stamps.fill(0);revision=1;}},
    stats:()=>({queries,heightSamples,visitedCells,lastCells,vertexCapacity:heights.length,maxCells:segments*2+3}),
  };
}
