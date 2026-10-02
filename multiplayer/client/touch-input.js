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
  const on = (name, handler) => {canvas.addEventListener(name, handler, {passive: false}); handlers.push([name, handler]);};
  const span = () => {const p = [...points.values()]; return p.length === 2 ? Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y) : null;};
  function reset() {
    const ids = [...points.keys()]; points.clear(); pinch = null;
    for (const id of ids) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  on('pointerdown', event => {
    if (!enabled() || event.pointerType === 'mouse' || points.size >= 2) return;
    event.preventDefault();
    points.set(event.pointerId, {x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:false});
    canvas.setPointerCapture?.(event.pointerId);
    if (points.size > 1) {for (const p of points.values()) p.moved = true; pinch = span();}
  });
  on('pointermove', event => {
    const p = points.get(event.pointerId); if (!p) return;
    event.preventDefault();
    const dx = event.clientX-p.x, dy = event.clientY-p.y;
    p.x = event.clientX; p.y = event.clientY;
    if (Math.hypot(p.x-p.startX,p.y-p.startY) > 8) p.moved = true;
    if (points.size === 2) {
      const next = span();
      if (role() === 'god' && pinch !== null) game.zoomBy((pinch-next)*0.07);
      pinch = next;
    } else if (p.moved) game.lookByPixels(dx*sensitivity(), dy*sensitivity());
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) on(name, event => {
    const p = points.get(event.pointerId); if (!p) return;
    points.delete(event.pointerId); pinch = null;
    if (name === 'pointerup' && !p.moved && role() === 'god' && enabled()) onTarget(game.aimAt(event.clientX,event.clientY));
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  return {reset, dispose() {reset(); for(const [name,fn] of handlers) canvas.removeEventListener(name,fn);}};
}
