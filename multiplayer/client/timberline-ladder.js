// The Timberline's open brass range ladder: where each rung sits so that a target behind its pip at that range is hit.
// Worked out from the same shared v3 flight the authority steps (shared/timberline-flight.js), including the parallax
// between the sighting eye (above and behind the trunnion) and the bolts, so the rungs are honest holdovers.
// Coordinates are the kit's Elevation frame in Blender units: y forward along the rails, z up, origin at the trunnion.
// The Blender build reads source/ladder_marks.json (written by tools/timberline-ladder.mjs) to place the rungs;
// tests/timberline-long.mjs checks that file still matches this flight.
import {timberlineFlightAt} from '../shared/timberline-flight.js';
import {mannedShot,MANNED} from '../shared/inventions.js';

export const TIMBERLINE_LADDER=Object.freeze({
 eye:Object.freeze({y:-.40,z:.42}),   // the peep ring's eye point (Socket_ScopeEye)
 ladderY:.30,                          // the ladder's plane, .7 m ahead of the eye
 targetHeight:1,                       // marks are for a chest-high target on level ground
 ranges:Object.freeze([25,50,100,150,200,250,300]),
 trunnion:1.05,                        // trunnion above the base (shared: origin 1.3 minus 0.25)
});

// Height of the pair centre where it crosses horizontal distance d, for a machine at the origin aimed at pitch p.
function heightAtRange(p,d){const q=mannedShot({yaw:0,position:[0,0,0]},{yaw:0,pitch:p});let lo=0,hi=12;
 for(let i=0;i<40;i++){const m=(lo+hi)/2;if(-timberlineFlightAt(q,m).centre[2]<d)lo=m;else hi=m;}return timberlineFlightAt(q,hi).centre[1];}
// Pitch that puts the pair through a target at range d (null when it is out of the machine's reach).
export function ladderPitch(d,{targetHeight=TIMBERLINE_LADDER.targetHeight}={}){let lo=MANNED.pitchMin,hi=MANNED.pitchMax;
 if(heightAtRange(hi,d)<targetHeight)return null;for(let i=0;i<40;i++){const m=(lo+hi)/2;if(heightAtRange(m,d)<targetHeight)lo=m;else hi=m;}return (lo+hi)/2;}

// Each rung: {range, pitch, z} where z is the rung's height in the Elevation frame (the pip tip sits on it).
export function ladderMarks(L=TIMBERLINE_LADDER){
 return L.ranges.map(range=>{const p=ladderPitch(range,L);if(p===null)return null;const c=Math.cos(p),s=Math.sin(p);
  // Target in the pitched Elevation frame: forward f = range, up h = target height above the trunnion.
  const f=range,h=L.targetHeight-L.trunnion,ty=f*c+h*s,tz=-f*s+h*c,k=(L.ladderY-L.eye.y)/(ty-L.eye.y);
  return {range,pitch:+p.toFixed(6),z:+(L.eye.z+(tz-L.eye.z)*k).toFixed(5)};}).filter(Boolean);
}
