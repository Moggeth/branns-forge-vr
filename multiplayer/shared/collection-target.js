import {isTestingGift,giftContents} from './testing-supplies.js';
import {MATERIAL_KEYS,materialLabel,bankKey} from './material-catalog.js';
import {capsuleDistance, TREE_LIMITS} from './trees.js';
import {partPosition} from './combat.js';
import {rotateVector} from './trees.js';
import {fruitCandidate} from './fruit.js';

export const COLLECTION_REACH = TREE_LIMITS.reach;
export const INVENTORY_CAP = 999;
const dist = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export const collectionEye = p => [p.position[0],p.position[1]+1.1,p.position[2]];

// Embedded golden bolts retain their existing identity: removing that embed is
// the authoritative one-time reward. Flying bolts and ordinary arrows never pay.
export function goldenBoltPickup(state, embed) {
 if (embed?.kind !== 'bolt' || embed.golden !== true) return null;
 let position;
 if (embed.targetId === 'world' || embed.targetId === 'terrain') position = embed.point;
 else {
  const loose = state.detachedParts?.find(d => d.id === embed.targetId);
  const enemy = state.enemies?.find(e => e.id === embed.targetId);
  if (loose) position = rotateVector(embed.localPoint, loose.quaternion).map((n,i) => n + loose.position[i]);
  else if (enemy) position = partPosition(enemy, embed.part); // authority's moving anatomical envelope
  else return null;
 }
 if (!position?.every(Number.isFinite)) return null;
 return {id:embed.id, kind:'gold', amount:1, x:position[0], y:position[1], z:position[2], embedded:true};
}

/** Read-only shared target contract. ctx.height(x,z) follows current terrain; visible(from,to,id) may further restrict client presentation. */
export function collectibleCandidate(state,p,id,ctx={}) {
 if(p?.role!=='hero'||!p.position||p.hp<=0)return null;
 if(state.fruit?.drops?.some(d=>d.id===id))return fruitCandidate(state,p,id,ctx); // apple on a stick (shared/fruit.js)
 const log=(state.looseLogs||[]).find(l=>l.id===id);
 const q=log||(state.pickups||[]).find(q=>q.id===id)||goldenBoltPickup(state,(state.embeds||[]).find(e=>e.id===id));
 if(!q||q.side&&q.side!==(p.side||'party'))return null;
 return candidateFor(p,q,!!log,ctx,state);
}
function candidateFor(p,q,log,ctx,state) {
 if(q.side&&q.side!==(p.side||'party'))return null;
 if(p?.role!=='hero'||!p.position||p.hp<=0)return null;
 const position=log?[...q.position]:[q.x,!q.embedded&&ctx.height?ctx.height(q.x,q.z):q.y,q.z];
 const eye=collectionEye(p),held=!!log&&q.heldBy===p.id;
 if(log&&q.heldBy&&!held)return null;
 const distance=log?capsuleDistance(q,eye):dist(p.position,position);
 if(!held&&distance>COLLECTION_REACH)return null;
 const kind=log?'wood':q.kind, amount=log?1:q.amount;
 if(![...MATERIAL_KEYS,'apple'].includes(kind))return null;
 const target={id:q.id,type:log?'log':q.embedded?'embed':'pickup',kind,amount,position,distance,held,
  full:isTestingGift(q)?giftContents(state).some(item=>(p.resources?.[bankKey(item.kind)]||0)+item.amount>INVENTORY_CAP):kind!=='apple'&&(p.resources?.[bankKey(kind)]||0)+amount>INVENTORY_CAP, // ore fills the pack as its metal
  unnecessary:false}; // an apple is always worth picking up: it's a snack you eat in three bites
 // Terrain occlusion remains deterministic on host and clients. Stop above the resource surface.
 if(!held){
  const end=[position[0],position[1]+(q.embedded?0:log?.12:.25),position[2]];
  if(ctx.height){const length=dist(eye,end),steps=Math.ceil(length/.15);for(let i=1;i<steps;i++){const t=i/steps,x=eye[0]+(end[0]-eye[0])*t,y=eye[1]+(end[1]-eye[1])*t,z=eye[2]+(end[2]-eye[2])*t;if(y<ctx.height(x,z)+.025)return null;}}
  if(ctx.visible&&!ctx.visible(eye,end,q.id))return null;
 }
 return target;
}

/** E, cues and highlights use this identical ordering: held log first, then nearest eligible pickup/log; stable ID breaks ties. */
export function nearestCollectible(state,p,ctx={}) {
 const held=(state.looseLogs||[]).find(l=>l.heldBy===p?.id);
 if(held)return collectibleCandidate(state,p,held.id,ctx);
 let best=fruitCandidate(state,p,null,ctx); // the held snack first, else the nearest apple drop
 if(best?.held)return best;
 for(const q of [...(state.pickups||[]),...(state.looseLogs||[]),...(state.embeds||[]).map(e=>goldenBoltPickup(state,e)).filter(Boolean)]){
  const c=candidateFor(p,q,Array.isArray(q.position),ctx,state);if(!c||c.full||c.unnecessary)continue;
  if(!best||c.distance<best.distance||c.distance===best.distance&&c.id<best.id)best=c;
 }
 return best;
}
