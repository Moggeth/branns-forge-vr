'use strict';
// Bounded game facts, not player-authored instructions. One quip per departure,
// at most once per 30 seconds; quiet distance updates never force a response.
function presenceEvent(snapshot, memory, now=Date.now()) {
  const p=snapshot.presence;
  if(!snapshot.visiting || !p || !Number.isFinite(p.distance))return null;
  const signature=p.phase+':'+Math.floor(p.distance/2);
  if(signature===memory.signature || now-(memory.at??-Infinity)<1500)return null;
  const changed=p.phase!==memory.phase;
  memory.signature=signature;memory.phase=p.phase;memory.at=now;
  const quip=changed&&p.phase==='leaving'&&now-(memory.quipAt??-Infinity)>30000;
  if(quip)memory.quipAt=now;
  return {type:quip?'session.commentary.append':'session.thinking.append',delegation_id:null,
    content:`Game observation: player is ${p.distance.toFixed(1)} metres away; presence=${p.phase}. `+(quip?'They have started walking away while conversation is still open. If natural, offer one short affectionate blacksmith quip about their departure. Do not interrupt their speech, guilt them, demand a reply, invent what they said, or repeat yourself. Silence is also fine.':p.phase==='near'?'They are nearby again. Any earlier departure observation is obsolete. No announcement needed.':'Use this as quiet spatial context; no announcement needed.')};
}
module.exports={presenceEvent};
