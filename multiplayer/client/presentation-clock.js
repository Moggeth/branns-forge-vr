// Presentation-only fractional simulation time. Never feeds gameplay authority.
// Snapshot delivery can be 20 Hz while display poses advance at any refresh rate.
// A new host resumes from its last recovery point, a fraction of a second behind what was shown.
// Small rewinds like that ease in (time runs slightly slow until it lines up) instead of replaying.
export function createPresentationClock({rate=60,maxLeadSeconds=.3,easeRewindSeconds=1.5}={}) {
  let anchor=null,anchorMs=0,shown=0,lastMs=0;
  return {
    observe(tick,nowMs,{reset=false}={}) {
      if(!Number.isFinite(tick)||!Number.isFinite(nowMs))return;
      if(anchor===null||reset||tick<anchor-easeRewindSeconds*rate){shown=tick;lastMs=nowMs;}
      // Duplicate snapshots must not restart the extrapolation window.
      if(anchor===null||tick!==anchor||reset){anchor=tick;anchorMs=nowMs;}
    },
    sample(nowMs) {
      if(anchor===null)return 0;
      const elapsed=Math.max(0,(nowMs-lastMs)/1000);lastMs=Math.max(lastMs,nowMs);
      const age=Math.max(0,(nowMs-anchorMs)/1000);
      const target=anchor+Math.min(maxLeadSeconds,age)*rate;
      const advance=elapsed*rate,candidate=shown+advance;
      // Smooth packet jitter without rewinding poses or snapping at arrivals.
      const correction=Math.max(-advance*.2,Math.min(advance*.2,target-candidate));
      // While the source is live, being ahead of it (a rewound new host) only slows time down:
      // never frozen, never backwards. A stalled source still holds at the lead cap.
      const cap=anchor+maxLeadSeconds*rate,next=candidate+correction;
      shown=Math.max(shown,age<maxLeadSeconds?next:Math.min(next,cap));
      return shown;
    }
  };
}
