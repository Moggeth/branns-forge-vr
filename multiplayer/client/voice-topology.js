// A single host selects undirected edges. Independent nearest-N lists can
// disagree and repeatedly tear down each other's offers in a crowded room.
import {voiceZoneAt} from './voice-zones.js';
export const VOICE_ROOM_RANGE=80,VOICE_MEMBERS=32,VOICE_NEIGHBORS=8,VOICE_JOIN_RANGE=32,VOICE_LEAVE_RANGE=40;
export function proximityGraph(members,previous=new Map(),zones){
  const nodes=[...members].filter(m=>m.active&&Array.isArray(m.position)&&m.position.length===3&&m.position.every(Number.isFinite)).sort((a,b)=>a.id.localeCompare(b.id));
  const graph=new Map(nodes.map(n=>[n.id,new Set()])),edges=[];
  // Players sharing a voice zone (a tavern) are linked first, at any distance inside it.
  const zone=new Map(nodes.map(n=>[n.id,voiceZoneAt(n.position,zones)?.id??null]));
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],distance=Math.hypot(...a.position.map((v,k)=>v-b.position[k])),held=previous.get(a.id)?.has(b.id)&&previous.get(b.id)?.has(a.id),room=zone.get(a.id)!==null&&zone.get(a.id)===zone.get(b.id)&&distance<=VOICE_ROOM_RANGE;
    if(room||distance<=(held?VOICE_LEAVE_RANGE:VOICE_JOIN_RANGE))edges.push({a:a.id,b:b.id,distance,held:!!held,room});
  }
  edges.sort((a,b)=>Number(b.held)-Number(a.held)||Number(b.room)-Number(a.room)||a.distance-b.distance||a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
  const add=({a,b})=>{graph.get(a).add(b);graph.get(b).add(a);};
  for(const edge of edges)if(edge.held&&graph.get(edge.a).size<VOICE_NEIGHBORS&&graph.get(edge.b).size<VOICE_NEIGHBORS)add(edge);
  // A newcomer must not be starved forever by a fully occupied stable graph.
  // Release at most one crowded neighbour's farthest link to give an isolated
  // participant a slot, without isolating the displaced endpoint in turn.
  for(const node of nodes)if(!graph.get(node.id).size){
    for(const edge of edges.filter(e=>!e.held&&(e.a===node.id||e.b===node.id))){
      const other=edge.a===node.id?edge.b:edge.a,links=graph.get(other);
      if(links.size>=VOICE_NEIGHBORS){
        const replace=edges.filter(e=>e.held&&(e.a===other||e.b===other)).sort((a,b)=>b.distance-a.distance).find(e=>{const id=e.a===other?e.b:e.a;return links.has(id)&&graph.get(id).size>1;});
        if(!replace)continue;const id=replace.a===other?replace.b:replace.a;links.delete(id);graph.get(id).delete(other);
      }
      add(edge);break;
    }
  }
  // Add nearest available links in balanced rounds. Filling a sorted clique
  // first would strand player10/19/28 when many players occupy the same point.
  const pending=edges.filter(e=>!e.held);
  for(let degree=0;degree<VOICE_NEIGHBORS;degree++)for(const edge of pending){
    const a=graph.get(edge.a),b=graph.get(edge.b);
    if(!a.has(edge.b)&&Math.min(a.size,b.size)<=degree&&Math.max(a.size,b.size)<VOICE_NEIGHBORS)add(edge);
  }
  return graph;
}
