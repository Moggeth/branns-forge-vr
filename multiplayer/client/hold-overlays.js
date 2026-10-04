// Hold-key state is separate from presentation and always releases on blur/visibility loss.
// A held Tab keeps swallowing its own key-repeat until the physical key is released, even after
// the overlay hands off to a panel (e.g. Manage forge); otherwise every repeat walks that panel's
// focus trap like a web form.
export function bindHoldOverlays({win=window,doc=document,canParty=()=>true,onChange=()=>{}}){
 const keys=new Set(),swallow=new Set();let pinned=null,current=null;
 const typing=e=>/INPUT|TEXTAREA|SELECT/.test(e?.target?.tagName)||e?.target?.isContentEditable;
 const eat=e=>{e.preventDefault();e.stopImmediatePropagation();};
 function sync(){const next=keys.has('F1')?'equipment':keys.has('Tab')?'party':pinned;if(next!==current){current=next;onChange(next);}}
 function down(e){
  if(e.code==='F1'||e.code==='Tab'&&canParty()&&!typing(e)){eat(e);keys.add(e.code);swallow.add(e.code);sync();}
  else if(e.code==='Tab'&&!typing(e)&&(swallow.has('Tab')||e.repeat))eat(e);
  else if(current&&e.code==='Escape'){eat(e);clear();}
 }
 function up(e){if(keys.has(e.code)||swallow.has(e.code)){eat(e);swallow.delete(e.code);if(keys.delete(e.code))sync();}}
 function clear(){keys.clear();pinned=null;sync();}
 function release(){swallow.clear();clear();}
 const visibility=()=>{if(doc.hidden)release();};
 win.addEventListener('keydown',down,true);win.addEventListener('keyup',up,true);win.addEventListener('blur',release);doc.addEventListener('visibilitychange',visibility);
 return {open(kind){pinned=kind;sync();},close:clear,get current(){return current;},dispose(){release();win.removeEventListener('keydown',down,true);win.removeEventListener('keyup',up,true);win.removeEventListener('blur',release);doc.removeEventListener('visibilitychange',visibility);}};
}
