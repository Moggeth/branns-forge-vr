import {mountTouchActions} from './touch-actions.js';
import './touch-actions.css';
import './touch-fullscreen.css';
import {createMobileUI} from './mobile-ui.js';
import {bindStick, bindWorldTouch, bindTouchButton} from './touch-input.js';

export function createMobileControls({game, canvas, onMenu, notify, onChange = () => {},onExpeditionAction=()=>{}}) {
  const ui = createMobileUI(), cleanups = [];
  const direct=mountTouchActions({root:ui.root,onAction:msg=>{
    if(!enabled||!state.active||state.xr||game.weaponState().drawing||game.weaponState().firing)return;
    if(msg.type==='context'){game.collectTarget(msg.targetId);return;}
    if(msg.id==='deliver')onExpeditionAction('deposit');
    if(msg.id==='bandage')game.useResource('wood');
    if(msg.id==='drop')game.release(false);
  }});
  direct.setQuick([{id:'bandage',icon:'âœš',label:'Bandage: use 3 wood to restore 35 health'},{id:'deliver',icon:'â™œ',label:'Deliver carried supplies to the forge'},{id:'drop',icon:'â†“',label:'Drop held item gently'}]);
  document.querySelector('.menu-card').insertBefore(ui.settings, document.getElementById('leave'));
  const coarse = matchMedia('(any-pointer: coarse)'), app = matchMedia('(display-mode: standalone)');
  let state = {active:false, role:'hero', xr:false}, mode = read('mode','auto'), sensitivity = Number(read('sensitivity','1')) || 1;
  let leftHanded = read('leftHanded','false') === 'true', target = false, enabled = false, fullscreenError = '';
  const displayStatus = document.createElement('p'); displayStatus.className='hint'; displayStatus.setAttribute('role','status'); ui.settings.append(displayStatus);
  const modeInput = ui.settings.querySelector('#touchMode'), sensitivityInput = ui.settings.querySelector('#touchSensitivity'), handInput = ui.settings.querySelector('#touchLeftHanded');
  modeInput.value = ['auto','on','off'].includes(mode) ? mode : (mode='auto');
  sensitivityInput.value = Math.max(.5,Math.min(2,sensitivity)); sensitivity = Number(sensitivityInput.value);
  handInput.checked = leftHanded;
  sensitivityInput.dispatchEvent(new Event('input')); 
  function read(key, fallback) {try{return localStorage.getItem('branns-forge.touch.'+key) ?? fallback;}catch{return fallback;}}
  function save(key,value) {try{localStorage.setItem('branns-forge.touch.'+key,value);}catch{}}
  function listen(el,name,fn) {el.addEventListener(name,fn);cleanups.push(()=>el.removeEventListener(name,fn));}
  const sticks = ['left','right'].map(side => bindStick(ui[side+'Stick'], (x,y) => {
    ui.setStick(side,x,y); game.setTouchAxes(side,x*(side==='right'?sensitivity:1),y*(side==='right'?sensitivity:1));
  }, () => enabled && state.active && !state.xr));
  const actionPointers=new Map();let windPointer=null;
  ui.buttons.strike.style.touchAction='none'; // held trigger cannot become browser scroll/pinch
  const actionButtons=[...document.querySelectorAll('[data-equip],[data-spell],#special,#grab,#drop,#throw,#collect,#bridge,.ta-q,.ta-chip')].map(b=>bindTouchButton(b,()=>enabled&&state.active&&!state.xr));
  const worldTouch = bindWorldTouch(canvas,game,{enabled:()=>enabled&&state.active&&!state.xr, role:()=>state.role, sensitivity:()=>sensitivity,onTarget:valid=>{target=valid;render();}});
  function reset() {windPointer=null;actionButtons.forEach(b=>b.reset());actionPointers.clear();attackPointer=null;sticks.forEach(s=>s.reset());worldTouch.reset();game.clearControls();}
  function fullscreenElement() {return document.fullscreenElement || document.webkitFullscreenElement;}
  function fullscreenSupported() {return !!((document.fullscreenEnabled && document.documentElement.requestFullscreen) || (document.webkitFullscreenEnabled && document.documentElement.webkitRequestFullscreen));}
  function render() {
    enabled = mode==='on' || (mode==='auto' && (coarse.matches || navigator.maxTouchPoints>0));
    document.body.classList.toggle('touch-controls-active',enabled && !state.xr);
    document.body.classList.toggle('touch-left-handed',leftHanded);
    ui.root.classList.toggle('is-left-handed',leftHanded);
    game.setTouchEnabled(enabled && !state.xr);
    ui.setState({visible:enabled&&state.active&&!state.xr,role:state.role,fullscreenVisible:!state.xr&&(enabled||coarse.matches||navigator.maxTouchPoints>0),fullscreen:!!fullscreenElement(),fullscreenSupported:fullscreenSupported(),standalone:app.matches||!!navigator.standalone,targeting:target,leftHanded,tool:game.weaponState()?.tool,quickCast:game.touchCastState?.().quick||false});
    displayStatus.textContent = fullscreenError; displayStatus.hidden = !fullscreenError;
    onChange(enabled);
  }
  let fullscreenPending = false;
  function fullscreenFailure() {
    fullscreenError = 'This browser declined fullscreen. Keep playing here, or retry Full screen from the game in its own browser tab.';
    notify(fullscreenError); render();
  }
  async function fullscreen() {
    if (fullscreenPending || state.xr) return;
    reset(); fullscreenError = '';
    try {
      fullscreenPending = true;
      // Invoke directly in the activating gesture; do not await anything first.
      if (fullscreenElement()) {
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
        else await document.webkitExitFullscreen();
      } else if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.webkitFullscreenEnabled && document.documentElement.webkitRequestFullscreen) {
        await document.documentElement.webkitRequestFullscreen();
      } else {
        fullscreenError = 'Fullscreen is unavailable here. Keep playing in this window, or open the game in its own browser tab.';
        notify(fullscreenError);
      }
    } catch { fullscreenFailure(); }
    finally { fullscreenPending = false; render(); }
  }
  function action(event) {
    const button=event.target.closest('[data-touch-action]');if(!button)return;
    const action=button.dataset.touchAction;
    if(action==='fullscreen'){void fullscreen();return;}
    if(action==='menu'){reset();onMenu();return;}
    if(!state.active||state.xr)return;
    if(action==='strike'&&event.detail===0){game.primaryDown();game.primaryUp();}
    if(action==='jump')game.jump();
    if(action==='cast')game.castAim();
    if(action==='cancel'){game.cancelAim();target=false;render();}
    if(action==='center'){game.centerView();target=false;render();}
    if(action==='zoom-in')game.zoomBy(-4);
    if(action==='zoom-out')game.zoomBy(4);
  }
  // Wind: while seated at a Timberline, holding the Jump slot cranks it (a second Hero standing beside it can too, from the cue).
  const jumpButton=ui.buttons.jump;
  listen(jumpButton,'pointerdown',event=>{if(!state.active||state.xr||!game.weaponState()?.manned)return;windPointer=event.pointerId;game.setCrank(true);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(jumpButton,name,event=>{if(event.pointerId!==windPointer)return;windPointer=null;game.setCrank(false);});
  let attackPointer=null;
  listen(ui.root,'pointerdown',event=>{const button=event.target.closest('[data-touch-action="strike"]');if(!button||!state.active||state.xr||attackPointer!==null)return;event.preventDefault();attackPointer=event.pointerId;button.setPointerCapture(event.pointerId);game.primaryDown();});
  listen(ui.root,'pointerup',event=>{if(event.pointerId===attackPointer){attackPointer=null;game.primaryUp();}});
  listen(ui.root,'lostpointercapture',event=>{if(event.pointerId===attackPointer){attackPointer=null;game.clearControls();}});
  listen(ui.root,'pointercancel',event=>{if(event.pointerId===attackPointer){attackPointer=null;game.clearControls();}});
  // Own a button for the whole gesture: snapshot-driven label updates must not eat touch clicks.
  for(const surface of [ui.root,ui.settings,ui.fullscreenSurface]){
    listen(surface,'pointerdown',event=>{const button=event.target.closest('[data-touch-action]');if(!button||button.disabled||button.dataset.touchAction==='strike'||event.button!==0)return;event.preventDefault();actionPointers.set(event.pointerId,button);button.setPointerCapture?.(event.pointerId);});
    listen(surface,'pointerup',event=>{const button=actionPointers.get(event.pointerId);if(!button)return;actionPointers.delete(event.pointerId);const r=button.getBoundingClientRect();if(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)action({target:button,detail:1});if(button.hasPointerCapture?.(event.pointerId))button.releasePointerCapture(event.pointerId);});
    for(const name of ['pointercancel','lostpointercapture'])listen(surface,name,event=>actionPointers.delete(event.pointerId));
    listen(surface,'click',event=>{if(event.detail===0)action(event);});
  }
  listen(modeInput,'change',()=>{reset();mode=modeInput.value;save('mode',mode);render();});
  listen(sensitivityInput,'input',()=>{sensitivity=Number(sensitivityInput.value);save('sensitivity',String(sensitivity));});
  listen(handInput,'change',()=>{reset();leftHanded=handInput.checked;save('leftHanded',String(leftHanded));render();});
  listen(coarse,'change',()=>{reset();render();});listen(app,'change',render);
  listen(window,'blur',reset);
  // Phone browser chrome changes viewport height while fingers remain down. Preserve their ownership;
  // only a genuine rotation/large layout change cancels controls.
  let viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
  listen(window,'resize',()=>{const w=window.innerWidth,h=window.innerHeight;if(Math.abs(w-viewportWidth)>40||Math.abs(h-viewportHeight)>Math.max(150,viewportHeight*.3))reset();viewportWidth=w;viewportHeight=h;render();});
  listen(document,'visibilitychange',()=>{if(document.hidden)reset();else render();});
  listen(window,'pageshow',render);
  const fullscreenChanged=()=>{fullscreenError='';reset();render();};
  listen(document,'fullscreenchange',fullscreenChanged);listen(document,'webkitfullscreenchange',fullscreenChanged);
  listen(document,'webkitfullscreenerror',fullscreenFailure);
  render();
  return {refresh:render,setCue(cue){const ws=game.weaponState(),b=document.getElementById('special'),isAim=ws?.tool==='crossbow';if(b){if(ws?.manned){b.querySelector('.bf-name').textContent='Scope';b.setAttribute('aria-label','Look through the Timberline scope');b.title='Scope (hold right click / Q toggles)';b.setAttribute('aria-pressed',String(!!ws.scoping));}else{b.querySelector('.bf-name').textContent=isAim?'Aim':'Special';b.setAttribute('aria-label',isAim?'Aim down sights':'Weapon special');b.title=isAim?'Aim down sights (hold right click / Q toggles)':'Weapon special (Q)';if(isAim)b.setAttribute('aria-pressed',String(!!ws.aiming));else b.removeAttribute('aria-pressed');}}
   // Seated at the Timberline, Jump becomes Wind (hold to crank) and Attack fires.
   const wind=!!ws?.manned,jump=ui.buttons.jump;if(jump&&jump.dataset.wind!==String(wind)){jump.dataset.wind=String(wind);jump._label.textContent=wind?'Wind':'Jump';jump.setAttribute('aria-label',wind?'Hold to wind the Timberline':'Jump');}ui.setState({tool:ws?.tool});direct.setContext(cue?.kind==='pickup'&&(cue.state==='ready'||ws?.manned)?{kind:'collect',label:cue.action,targetId:cue.target}:null);},get enabled(){return enabled;}, update(next){const changed=state.active!==next.active||state.role!==next.role||state.xr!==next.xr;if(changed){reset();if(state.role!==next.role)target=false;}state=next;render();},dispose(){reset();actionButtons.forEach(b=>b.dispose());sticks.forEach(s=>s.dispose());worldTouch.dispose();cleanups.forEach(fn=>fn());direct.dispose();ui.destroy();}};
}
