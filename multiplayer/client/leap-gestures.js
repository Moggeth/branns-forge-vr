// Pure hand -> game adapter. It never creates OS/browser input events.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createLeapGestures(game) {
  let handId=null,center=null,point=null,armed=false,held=false,revision=null,last=0;
  function reset(recenter=false){
    if(held||point)game.cancelAim();
    handId=null;point=null;armed=false;held=false;revision=null;last=0;
    if(recenter)center=null;
  }
  function update(frame,{active,now,rect}) {
    if(!active||frame?.status!=='tracking'||!Number.isFinite(frame.ageMs)||frame.ageMs>180){reset();return 'Paused — show an open hand to resume';}
    const hands=(frame.hands||[]).filter(h=>h&&Array.isArray(h.palm)&&h.palm.length===3&&h.palm.every(Number.isFinite)&&Number.isFinite(h.pinch));
    // Keep one physical hand across frames; never transfer a held cast to a second hand.
    let hand=hands.find(h=>h.id===handId);
    if(!hand){reset();hand=hands.find(h=>h.side==='right')||hands[0];if(!hand)return 'No hand — hold an open hand above the sensor';handId=hand.id;}
    const state=game.touchCastState();
    if(revision!==null&&revision!==state.revision){reset();return 'Spell changed — open your hand before casting';}
    revision=state.revision;
    if(!center){if(hand.pinch>.3)return 'Open your hand at a comfortable centre position';center=[...hand.palm];}
    // Relative to calibration: 320mm across and 240mm up/down cover the canvas.
    const target=[clamp(.5+(hand.palm[0]-center[0])/320,.03,.97),clamp(.5-(hand.palm[1]-center[1])/240,.04,.96)];
    const dt=last?clamp((now-last)/1000,0,.1):1;last=now;
    // Render-rate filtering: suppress resting tremor, follow deliberate motion quickly.
    const error=point?Math.hypot(target[0]-point[0],target[1]-point[1]):1;
    const tau=.006+.018*Math.exp(-error*80);
    const k=1-Math.exp(-dt/tau);
    point=point?point.map((v,i)=>v+(target[i]-v)*k):target;
    if(Math.hypot(point[0]-target[0],point[1]-target[1])<.0001)point=target;
    const valid=game.aimAt(rect.left+point[0]*rect.width,rect.top+point[1]*rect.height);
    if(!valid){if(held)game.cancelAim();held=false;armed=false;revision=game.touchCastState().revision;return 'Aim at the ground, then open your hand';}
    if(hand.pinch<.3){
      if(held&&(state.line||!state.quick))game.castAim();
      held=false;armed=true;
    }else if(hand.pinch>.8&&armed&&!held){
      held=true;armed=false;
      if(state.line)game.beginAimLine();else if(state.quick)game.castAim();
    }
    return held?(state.line?'Drag your hand; release the pinch to cast':'Pinch held — release to rearm'):'Move hand to aim · pinch thumb/index to cast';
  }
  return {update,reset};
}
