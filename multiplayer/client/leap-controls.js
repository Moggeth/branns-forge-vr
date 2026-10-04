import {createLeapGestures} from './leap-gestures.js';

export function mountLeapControls({game,canvas,canControl,notify}) {
  const gestures=createLeapGestures(game);
  let enabled=false,disposed=false,timer,request,lastMessage='';
  const button=document.createElement('button'),calibrate=document.createElement('button');
  for(const el of [button,calibrate]){el.type='button';el.className='btn btn-chip';document.querySelector('.hud-top .hud-right')?.append(el);}
  // Reuse the current header styling; no separate overlay or persistent hand skeleton.
  if(!button.isConnected)document.getElementById('menuButton').before(button,calibrate);
  button.id='leapToggle';calibrate.id='leapCalibrate';calibrate.textContent='Recenter hand';calibrate.hidden=true;
  button.textContent='Hands: off';button.setAttribute('aria-pressed','false');
  function message(text){button.title=text;calibrate.title=text;if(text!==lastMessage){lastMessage=text;notify(text);}}
  function pause(){gestures.reset();request?.abort();}
  const blur=()=>pause();window.addEventListener('blur',blur);document.addEventListener('visibilitychange',blur);
  button.addEventListener('click',()=>{
    enabled=!enabled;pause();gestures.reset(true);button.textContent=enabled?'Hands: on':'Hands: off';button.setAttribute('aria-pressed',String(enabled));calibrate.hidden=!enabled;
    if(enabled)message('God mode: hold an open hand comfortably above Leap to centre it. Move left/right and up/down; pinch to cast. WASD/wheel still move the camera.');
  });
  calibrate.addEventListener('click',()=>{gestures.reset(true);message('Open your hand in a comfortable position to recenter.');});
  async function poll(){
    if(disposed)return;
    try{
      if(enabled&&canControl()&&!document.hidden&&document.hasFocus()){
        const requestedAt=performance.now();
        request=new AbortController();const timeout=setTimeout(()=>request?.abort(),500);
        let frame;
        try{const r=await fetch('/__leap/frame',{signal:request.signal,cache:'no-store'});if(!r.ok)throw Error('bridge unavailable');frame=await r.json();}finally{clearTimeout(timeout);}
        // Recheck after await: menu/focus may have changed while the fetch was in flight.
        if(disposed||!enabled)return;
        const active=canControl()&&!document.hidden&&document.hasFocus();
        frame.ageMs+=performance.now()-requestedAt;
        const hint=gestures.update(frame,{active,now:performance.now(),rect:canvas.getBoundingClientRect()});
        if(frame.status==='error')message(frame.message);else message(hint);
      }else gestures.reset();
    }catch(error){gestures.reset();if(enabled&&error.name!=='AbortError')message('Leap unavailable. Start the Leap preview launcher and check Ultraleap Tracking Service.');}
    finally{if(!disposed)timer=setTimeout(poll,33);}
  }
  poll();
  return {dispose(){disposed=true;clearTimeout(timer);pause();button.remove();calibrate.remove();window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',blur);}};
}
