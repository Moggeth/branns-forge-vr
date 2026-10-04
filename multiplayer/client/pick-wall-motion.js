// Stonewhisper crystal wall: what the held pick does while you aim and cast (2026-10-04). Presentation only.
// Camera space: +X right, +Y up, -Z forward. The result is a LAYER on top of whatever pose the held pick already has
// (rest pose, idle bob, any sway): game.js adds `offset` to the anchor position and premultiplies `quaternion`, so
// rotations turn about the grip in camera axes.
//   hold     the pick rises toward the centre of view with its head leaning toward the target, then breathes with a faint resonance shiver while held;
//            `focus` (0..1) feeds the gem glow so the head brightens as it gathers.
//   release  a quick draw back, then a hard slam forward and down into the ground (the wall's seam starts there),
//            a small rebound, and back to rest. A tap (release before the rise finished) slams from wherever it got to.
//   cancel   eases back to rest (tool switch, menu, died).
import * as T from 'three';

export const PICK_WALL_MOTION=Object.freeze({rise:.26,slam:.44,relax:.22,strike:.4});
// time (fraction of the slam), offset x/y/z (m), pitch about +X (deg; + tips the head back), roll (deg, about -Z), yaw (deg, about +Y)
const HOLD=[-.07,.09,-.04,-8,-6,0];
const SLAM=[
 [0,   null],                       // the pose at release (full HOLD, or partway for a tap)
 [.18, [-.07,.13,-.01,12,-6,-2]],   // hitch: the head draws back for one last gather
 [.40, [-.05,-.11,-.21,-64,-4,6]],  // STRIKE: head driven forward and down
 [.56, [-.04,-.07,-.16,-52,-3,4]],  // rebound off the ground
 [1,   [0,0,0,0,0,0]],
];
const D=T.MathUtils.DEG2RAD,X=new T.Vector3(1,0,0),Y=new T.Vector3(0,1,0),Z=new T.Vector3(0,0,1);
const clamp01=v=>Math.min(1,Math.max(0,Number.isFinite(v)?v:0)),smooth=u=>u*u*(3-2*u);
const easeOut=u=>1-(1-u)**3;
const scaled=(k,s)=>k.map(v=>v*s);

// Catmull-Rom across the slam keys (zero tangents at the ends), per channel.
function slamChannel(keys,i,u,c){
 const k0=keys[i],k1=keys[i+1],span=k1[0]-k0[0],t=(u-k0[0])/span,t2=t*t,t3=t2*t;
 const tan=j=>j<=0||j>=keys.length-1?0:(keys[j+1][1][c]-keys[j-1][1][c])/(keys[j+1][0]-keys[j-1][0])*span;
 return k0[1][c]*(2*t3-3*t2+1)+tan(i)*(t3-2*t2+t)+k1[1][c]*(-2*t3+3*t2)+tan(i+1)*(t3-t2);
}

export function createPickWallMotion({reducedMotion=false}={}){
 // phase: null | 'hold' | 'slam' | 'relax'; at = phase start (seconds); from = channel values the phase started from
 let phase=null,at=0,from=null;const values=new Array(6).fill(0);
 const offset=new T.Vector3(),quaternion=new T.Quaternion(),_q=new T.Quaternion();
 const result={offset,quaternion,focus:0,phase:null};
 function holdValues(t){
  const rise=easeOut(clamp01(t/PICK_WALL_MOTION.rise)),k=scaled(HOLD,rise);
  if(!reducedMotion&&t>0){ // breathing + a fine shiver that grows as the charge settles
   const settle=smooth(clamp01((t-PICK_WALL_MOTION.rise)/.5));
   k[1]+=Math.sin(t*2.6)*.006*settle;k[3]+=Math.sin(t*2.6+.6)*1.6*settle;
   k[0]+=Math.sin(t*37)*.0016*settle;k[1]+=Math.sin(t*43+1.3)*.0014*settle;k[4]+=Math.sin(t*31)*.5*settle;
  }
  return k;
 }
 function current(now){
  if(!phase)return null;
  const t=Math.max(0,now-at);
  if(phase==='hold'){const k=holdValues(t);return {k,focus:easeOut(clamp01(t/(PICK_WALL_MOTION.rise*1.6)))};}
  if(phase==='slam'){
   const u=t/PICK_WALL_MOTION.slam;if(u>=1){phase=null;return null;}
   const keys=SLAM.map(([time,k])=>[time,k||from]);let i=0;while(i<keys.length-2&&u>=keys[i+1][0])i++;
   const k=[0,1,2,3,4,5].map(c=>slamChannel(keys,i,u,c));
   return {k,focus:u<PICK_WALL_MOTION.strike?1:Math.max(0,1-(u-PICK_WALL_MOTION.strike)/.3)};
  }
  const u=t/PICK_WALL_MOTION.relax;if(u>=1){phase=null;return null;}
  const s=1-smooth(u);return {k:scaled(from,s),focus:0};
 }
 function snapshot(now){const c=current(now);return c?c.k.slice():values.fill(0).slice();}
 return {
  /** Start (or keep) aiming. Repeated calls while already holding are no-ops. */
  hold(now){if(phase==='hold')return;from=null;phase='hold';at=now;},
  /** Cast: slam from wherever the pick is now. Returns true when the slam starts. */
  release(now){if(phase!=='hold')return false;from=snapshot(now);phase='slam';at=now;return true;},
  /** Abandon the aim without casting; ease back. */
  cancel(now){if(phase!=='hold')return;from=snapshot(now);phase='relax';at=now;},
  /** Drop everything instantly (tool swapped away, VR started). */
  reset(){phase=null;from=null;},
  get active(){return phase!==null;},
  /** True during the authored slam (the sway layer steps aside for it, as it does for swings). */
  get slamming(){return phase==='slam';},
  /** Layer for this frame, or null when the pick is not doing anything wall-related. Reuses its objects. */
  pose(now){
   const c=current(now);if(!c){result.phase=null;result.focus=0;return null;}
   const [x,y,z,pitch,roll,yaw]=c.k;offset.set(x,y,z);
   quaternion.setFromAxisAngle(Z,-roll*D).multiply(_q.setFromAxisAngle(Y,yaw*D)).multiply(_q.setFromAxisAngle(X,pitch*D));
   result.focus=c.focus;result.phase=phase;return result;
  },
 };
}
