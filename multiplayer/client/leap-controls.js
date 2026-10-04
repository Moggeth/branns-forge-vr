import {createLeapGestures} from './leap-gestures.js';

export function mountLeapControls({game,canvas,canControl,notify}) {
  const gestures=createLeapGestures(game);
  let enabled=false,disposed=false,stream=null,latest=null,receivedAt=0,lastMessage='';
  const stats={frames:0,aimUpdates:0,ageMs:0,inputMs:0,maxInputMs:0};
  const button=document.createElement('button'),calibrate=document.createElement('button');
  for(const el of [button,calibrate]){el.type='button';el.className='btn btn-chip';document.querySelector('.hud-top .hud-right')?.append(el);}
  if(!button.isConnected)document.getElementById('menuButton').before(button,calibrate);
  button.id='leapToggle';calibrate.id='leapCalibrate';calibrate.textContent='Recenter hand';calibrate.hidden=true;
  button.textContent='Hands: off';button.setAttribute('aria-pressed','false');
  function message(text,toast=false){if(text!==lastMessage){button.title=text;calibrate.title=text;lastMessage=text;if(toast)notify(text);}}
  function pause(){gestures.reset();latest=null;}
  const blur=()=>pause();window.addEventListener('blur',blur);document.addEventListener('visibilitychange',blur);
  function connect(){
    stream=new EventSource('/__leap/stream');
    stream.onmessage=event=>{
      try{
        const value=JSON.parse(event.data);
        if(!Number.isFinite(value.ageMs)||!Array.isArray(value.hands))return;
        if(Number.isFinite(value.sentAt))value.ageMs+=Math.max(0,Date.now()-value.sentAt);
        if(!value.hands.length||value.status!=='tracking'||value.ageMs>180)gestures.reset();
        latest=value;receivedAt=performance.now();stats.frames++;
        if(value.status==='error'){gestures.reset();message(value.message,true);}
      }catch{pause();}
    };
    stream.onerror=()=>{pause();message(stream.readyState===2?'Leap stream closed. Close extra preview tabs, then switch Hands off/on to retry.':'Leap disconnected. Reconnecting; check the preview launcher and Ultraleap Tracking Service.',true);};
  }
  button.addEventListener('click',()=>{
    enabled=!enabled;pause();gestures.reset(true);stream?.close();stream=null;
    button.textContent=enabled?'Hands: on':'Hands: off';button.setAttribute('aria-pressed',String(enabled));calibrate.hidden=!enabled;
    if(enabled){connect();message('Hold an open hand to centre it. Move to aim; pinch to cast. WASD/wheel still move the camera.',true);}
  });
  calibrate.addEventListener('click',()=>{gestures.reset(true);message('Open your hand in a comfortable position to recenter.',true);});
  // Camera has moved, but the world has not rendered yet. Latest frame only.
  game.setHandInputFrame(now=>{
    if(disposed)return;
    const active=enabled&&canControl()&&!document.hidden&&document.hasFocus();
    if(!active||!latest){gestures.reset();return;}
    const started=performance.now();
    stats.ageMs=latest.ageMs+Math.max(0,started-receivedAt);
    const hint=gestures.update({...latest,ageMs:stats.ageMs},{active,now,rect:canvas.getBoundingClientRect()});
    stats.aimUpdates++;stats.inputMs=performance.now()-started;stats.maxInputMs=Math.max(stats.maxInputMs,stats.inputMs);
    message(hint);
  });
  // Read-only counters and timing; no coordinates or recordings.
  Object.defineProperty(canvas,'brannLeapDiagnostics',{configurable:true,value:()=>({...stats,enabled,streamState:stream?.readyState??null})});
  return {dispose(){disposed=true;stream?.close();game.setHandInputFrame(null);pause();delete canvas.brannLeapDiagnostics;button.remove();calibrate.remove();window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',blur);}};
}
