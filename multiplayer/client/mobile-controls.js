import {createMobileUI} from './mobile-ui.js';
import {bindStick, bindWorldTouch} from './touch-input.js';

export function createMobileControls({game, canvas, onMenu, notify, onChange = () => {}}) {
  const ui = createMobileUI(), cleanups = [];
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
  const worldTouch = bindWorldTouch(canvas,game,{enabled:()=>enabled&&state.active&&!state.xr, role:()=>state.role, sensitivity:()=>sensitivity,onTarget:valid=>{target=valid;render();}});
  function reset() {attackPointer=null;sticks.forEach(s=>s.reset());worldTouch.reset();game.clearControls();}
  function fullscreenElement() {return document.fullscreenElement || document.webkitFullscreenElement;}
  function fullscreenSupported() {return !!((document.fullscreenEnabled && document.documentElement.requestFullscreen) || (document.webkitFullscreenEnabled && document.documentElement.webkitRequestFullscreen));}
  function render() {
    enabled = mode==='on' || (mode==='auto' && (coarse.matches || navigator.maxTouchPoints>0));
    document.body.classList.toggle('touch-controls-active',enabled && !state.xr);
    document.body.classList.toggle('touch-left-handed',leftHanded);
    ui.root.classList.toggle('is-left-handed',leftHanded);
    game.setTouchEnabled(enabled && !state.xr);
    ui.setState({visible:enabled&&state.active&&!state.xr,role:state.role,fullscreen:!!fullscreenElement(),fullscreenSupported:fullscreenSupported(),standalone:app.matches||!!navigator.standalone,targeting:target,leftHanded});
    displayStatus.textContent = fullscreenError; displayStatus.hidden = !fullscreenError;
    onChange(enabled);
  }
  async function fullscreen() {
    reset(); fullscreenError = '';
    try {
      if (fullscreenElement()) await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      else if (fullscreenSupported()) await (document.documentElement.requestFullscreen?.() ?? document.documentElement.webkitRequestFullscreen?.());
      else notify('Fullscreen is unavailable here. Use your browser’s Add to Home Screen option for an app-like display.');
    } catch {fullscreenError='This browser declined fullscreen. You can keep playing in this window or use Add to Home Screen.';notify(fullscreenError);}
    render();
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
  let attackPointer=null;
  listen(ui.root,'pointerdown',event=>{const button=event.target.closest('[data-touch-action="strike"]');if(!button||!state.active||state.xr||attackPointer!==null)return;event.preventDefault();attackPointer=event.pointerId;button.setPointerCapture(event.pointerId);game.primaryDown();});
  listen(ui.root,'pointerup',event=>{if(event.pointerId===attackPointer){attackPointer=null;game.primaryUp();}});
  listen(ui.root,'pointercancel',event=>{if(event.pointerId===attackPointer){attackPointer=null;game.clearControls();}});
  listen(ui.root,'click',action);listen(ui.settings,'click',action);
  listen(modeInput,'change',()=>{reset();mode=modeInput.value;save('mode',mode);render();});
  listen(sensitivityInput,'input',()=>{sensitivity=Number(sensitivityInput.value);save('sensitivity',String(sensitivity));});
  listen(handInput,'change',()=>{reset();leftHanded=handInput.checked;save('leftHanded',String(leftHanded));render();});
  listen(coarse,'change',()=>{reset();render();});listen(app,'change',render);
  listen(window,'blur',reset);listen(window,'resize',reset);
  listen(document,'visibilitychange',()=>{if(document.hidden)reset();});
  listen(document,'fullscreenchange',()=>{reset();render();});listen(document,'webkitfullscreenchange',()=>{reset();render();});
  render();
  return {get enabled(){return enabled;}, update(next){const changed=state.active!==next.active||state.role!==next.role||state.xr!==next.xr;if(changed){reset();if(state.role!==next.role)target=false;}state=next;render();},dispose(){reset();sticks.forEach(s=>s.dispose());worldTouch.dispose();cleanups.forEach(fn=>fn());ui.destroy();}};
}
