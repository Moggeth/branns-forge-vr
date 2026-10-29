// Manned Timberline presentation for the operator: sighting along the brass range ladder (hold right mouse, or Q) and
// the ammo counter. Sighting is diegetic, like the Siegebird's: the eye glides from the seat to the peep ring on the
// cradle and the view narrows a little (about 1.5x), with the world still all around. The ladder's rungs are honest
// holdovers from the shared flight (client/timberline-ladder.js); nothing here feeds back into the shot.
import './timberline-hud.css';

export const TIMBERLINE_SCOPE=Object.freeze({fov:47,
 // Mouse look slows a little with the zoom so the rungs stay steerable.
 sensitivity:.67});

// The operator's ammo counter: crafted bolts first, then whole shots the carried and stored Wood and Iron pay for.
export function timberlineAmmoText({bolts=0,raw=0}={}){
 if(!bolts&&!raw)return 'Out of ammo';
 const b=`${bolts} bolt${bolts===1?'':'s'}`;if(!raw)return b;const r=`${raw} from Timber/Iron`;return bolts?`${b} + ${r}`:`${raw} shot${raw===1?'':'s'} from Timber/Iron`;}

export function createTimberlineAmmoHud({parent=document.body}={}){
 const el=document.createElement('div');el.className='timberline-ammo';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.hidden=true;
 el.innerHTML='<span class="timberline-ammo-glyph" aria-hidden="true"></span><span class="timberline-ammo-count"></span><span class="timberline-ammo-state"></span>';parent.appendChild(el);
 const count=el.querySelector('.timberline-ammo-count'),state=el.querySelector('.timberline-ammo-state');let last='';
 return {element:el,
  set(info){if(!info){if(!el.hidden)el.hidden=true;last='';return;}const t=info.label||timberlineAmmoText(info),s=info.state||'';const key=`${t}|${s}|${!!info.scoped}`;if(key===last)return;last=key;el.hidden=false;
   count.textContent=t;state.textContent=s;el.classList.toggle('is-empty',!info.bolts&&!info.raw);el.classList.toggle('is-scoped',!!info.scoped);},
  dispose(){el.remove();}};
}
