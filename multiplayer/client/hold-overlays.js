// Hold-key state is separate from presentation and always releases on blur/visibility loss.
export function bindHoldOverlays({win=window,doc=document,canParty=()=>true,onChange=()=>{}}){
 const keys=new Set();let pinned=null,current=null;
 const typing=e=>/INPUT|TEXTAREA|SELECT/.test(e?.target?.tagName)||e?.target?.isContentEditable;
 function sync(){const next=keys.has('F1')?'equipment':keys.has('Tab')?'party':pinned;if(next!==current){current=next;onChange(next);}}
 function down(e){if(e.code==='F1'||e.code==='Tab'&&canParty()&&!typing(e)){e.preventDefault();e.stopImmediatePropagation();keys.add(e.code);sync();}else if(current&&e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();clear();}}
 function up(e){if(keys.has(e.code)){e.preventDefault();e.stopImmediatePropagation();keys.delete(e.code);sync();}}
 function clear(){keys.clear();pinned=null;sync();}
 const visibility=()=>{if(doc.hidden)clear();};
 win.addEventListener('keydown',down,true);win.addEventListener('keyup',up,true);win.addEventListener('blur',clear);doc.addEventListener('visibilitychange',visibility);
 return {open(kind){pinned=kind;sync();},close:clear,get current(){return current;},dispose(){clear();win.removeEventListener('keydown',down,true);win.removeEventListener('keyup',up,true);win.removeEventListener('blur',clear);doc.removeEventListener('visibilitychange',visibility);}};
}
