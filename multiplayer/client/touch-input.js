// Pointer ownership is per control, so two thumbs and action buttons coexist.
export function stickVector(dx, dy, radius, deadZone = 0.12) {
  const distance = Math.hypot(dx, dy), length = Math.min(1, distance / Math.max(1, radius));
  if (length <= deadZone || !Number.isFinite(distance)) return {x: 0, y: 0};
  const strength = (length - deadZone) / (1 - deadZone);
  return {x: dx / distance * strength, y: dy / distance * strength};
}

export function bindStick(element, onValue, enabled = () => true) {
  let owner = null, center = null;
  const handlers = [];
  const on = (name, handler) => { element.addEventListener(name, handler); handlers.push([name, handler]); };
  function value(event) {
    const v = stickVector(event.clientX - center.x, event.clientY - center.y, center.radius);
    onValue(v.x, v.y);
  }
  function reset() {
    const id = owner; owner = null; center = null; onValue(0, 0);
    if (id !== null && element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
  }
  on('pointerdown', event => {
    if (!enabled() || owner !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    owner = event.pointerId;
    const rect = element.getBoundingClientRect();
    center = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: Math.min(rect.width, rect.height) * .36};
    element.setPointerCapture?.(owner); value(event);
  });
  on('pointermove', event => { if (event.pointerId !== owner) return; event.preventDefault(); value(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on(name, event => { if (event.pointerId === owner) reset(); });
  return {reset, dispose() { reset(); for (const [name, fn] of handlers) element.removeEventListener(name, fn); }};
}

export function bindWorldTouch(canvas, game, {enabled, role, sensitivity, onTarget = () => {}}) {
  const points = new Map(), handlers = [];
  let pinch = null;
  const on = (name, fn) => {canvas.addEventListener(name, fn, {passive:false}); handlers.push([name,fn]);};
  const span = () => {const p=[...points.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):null;};
  const current = () => game.touchCastState?.() || {line:false,quick:false,revision:0};
  const valid = p => enabled() && role()===p.role && current().revision===p.cast.revision;
  const onWorld = e => !canvas.ownerDocument?.elementFromPoint || canvas.ownerDocument.elementFromPoint(e.clientX,e.clientY)===canvas;
  function cancelLine() { if ([...points.values()].some(p=>p.lineStarted)) { game.cancelAim?.(); onTarget(false); } }
  function reset() {
    cancelLine(); onTarget(false); const ids=[...points.keys()];points.clear();pinch=null;
    for(const id of ids)if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
  }
  on('pointerdown', e => {
    if(!enabled()||e.pointerType==='mouse'||points.size>=2)return;
    e.preventDefault();
    const p={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,blocked:false,role:role(),cast:current()};
    points.set(e.pointerId,p);canvas.setPointerCapture?.(e.pointerId);
    if(points.size===2){cancelLine();for(const q of points.values()){q.blocked=true;q.moved=true;}pinch=span();return;}
    if(p.role==='god'&&p.cast.line){
      p.hadStart=!!p.cast.start; p.lineStarted=game.aimAt(e.clientX,e.clientY);
      if(p.lineStarted){game.beginAimLine();onTarget(true);}else p.blocked=true;
    }
  });
  on('pointermove', e => {
    const p=points.get(e.pointerId);if(!p)return;e.preventDefault();
    if(!enabled()||role()!==p.role){reset();return;}
    const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
    if(Math.hypot(p.x-p.startX,p.y-p.startY)>8)p.moved=true;
    if(points.size===2){const next=span();if(role()==='god'&&pinch!==null)game.zoomBy((pinch-next)*.07);pinch=next;return;}
    if(p.blocked)return;
    if(!valid(p)){p.blocked=true;return;}
    if(p.role==='god'&&p.cast.line){onTarget(game.aimAt(p.x,p.y));return;}
    if(p.moved)game.lookByPixels(dx*sensitivity(),dy*sensitivity());
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])on(name,e=>{
    const p=points.get(e.pointerId);if(!p)return;e.preventDefault();
    const accept=name==='pointerup'&&!p.blocked&&valid(p)&&onWorld(e);
    points.delete(e.pointerId);pinch=null;
    if(p.role==='god'){
      if(accept&&(p.cast.line||!p.moved)){
        const hit=game.aimAt(e.clientX,e.clientY);onTarget(hit);
        if(hit&&p.cast.quick&&(!p.cast.line||p.moved||p.hadStart))game.castAim();
        else if(!hit&&p.lineStarted){game.cancelAim?.();onTarget(false);}
      }else if(p.lineStarted){game.cancelAim?.();onTarget(false);}
    }
    if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  return {reset,dispose(){reset();for(const [name,fn]of handlers)canvas.removeEventListener(name,fn);}};
}
// Native compatibility clicks are only reliable for the primary finger. Route touch/pen button presses explicitly,
// keeping keyboard and mouse clicks intact, so the other thumb can use Special while Attack remains held.
export function bindTouchButton(button, enabled = () => true) {
 const held=new Set(),handlers=[];let activatedAt=-Infinity;
 const on=(name,fn,capture=false)=>{button.addEventListener(name,fn,capture);handlers.push([name,fn,capture]);};
 on('pointerdown',e=>{if(!enabled()||e.pointerType==='mouse'||button.disabled)return;e.preventDefault();held.add(e.pointerId);button.setPointerCapture?.(e.pointerId);});
 on('pointerup',e=>{if(!held.delete(e.pointerId))return;e.preventDefault();const r=button.getBoundingClientRect();if(enabled()&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){activatedAt=performance.now();button.click();}if(button.hasPointerCapture?.(e.pointerId))button.releasePointerCapture(e.pointerId);});
 for(const name of ['pointercancel','lostpointercapture'])on(name,e=>held.delete(e.pointerId));
 on('click',e=>{if(e.detail>0&&performance.now()-activatedAt<500){e.preventDefault();e.stopImmediatePropagation();}},true);
 return {reset(){held.clear();},dispose(){held.clear();for(const [name,fn,capture]of handlers)button.removeEventListener(name,fn,capture);}};
}
