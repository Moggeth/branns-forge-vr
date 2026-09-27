// Input for the second Godot camera. The local service clamps every requested angle.
(() => {
  const stage=document.getElementById('stage');
  let drag=null,latest=null,busy=false,lastSent=0;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  async function send(force=false){
    if(busy||!latest||!window.directorUiState?.sessionId)return;
    if(!force&&performance.now()-lastSent<65)return;
    busy=true;lastSent=performance.now();
    const view=latest;latest=null;
    try{await fetch('/api/director/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:window.directorUiState.sessionId,...view})})}
    catch{}
    finally{busy=false;if(latest)send(true)}
  }
  stage.addEventListener('pointerdown',event=>{
    if(event.button!==0||!window.directorUiState?.sessionId)return;
    const view=window.directorUiState.view||{yaw:.64,pitch:.84,zoom:39};
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view}};
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    latest={yaw:drag.view.yaw-dx*.006,pitch:clamp(drag.view.pitch-dy*.005,.38,1.25),zoom:drag.view.zoom};
    send();
  });
  function release(){if(!drag)return;drag=null;send(true)}
  stage.addEventListener('pointerup',release);
  stage.addEventListener('pointercancel',release);
  stage.addEventListener('lostpointercapture',release);
  stage.addEventListener('wheel',event=>{
    event.preventDefault();
    const base=latest||window.directorUiState?.view;
    if(!base)return;
    latest={...base,zoom:clamp(base.zoom+Math.sign(event.deltaY)*2,25,65)};
    send(true);
  },{passive:false});
})();
