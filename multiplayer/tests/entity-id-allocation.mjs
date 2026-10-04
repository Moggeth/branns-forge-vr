import assert from 'node:assert/strict';
import {nextEntityId} from '../shared/entity-id.js';
const fields=['players','enemies','edits','groves','pendingStarfalls','deposits','pickups','bridges','projectiles','embeds','detachedParts','fireSurfaces','looseLogs','meteorRewards','awakenedTrees','wildTrees'];
// Reference collision rules from the previous allocator, deliberately retaining
// its copied/flattened snapshot as an independent oracle.
function reference(state,prefix){const all=[...fields.flatMap(k=>state[k]||[]),...(state.settlement?.workers||[]),...(state.fruit?.drops||[])].flatMap(x=>x.editId?[x.id,x.editId]:[x.id]);let id;do{id=prefix+(++state.idCounter);}while(all.some(x=>x===id||x.startsWith(id+'_')||x.startsWith(id+'-')));return id;}
let comparisons=0;
for(let seed=0;seed<50;seed++) {
  const state=Object.fromEntries(fields.map((k,i)=>[k,Array.from({length:20},(_,j)=>({id:['f','e','p'][j%3]+(j*3+i+seed)+(j%4===0?'_child':j%4===1?'-tree0':''),...(j%3===0?{editId:'f'+(j*4+i+seed)}:{})}))]));
  state.settlement={workers:[{id:'f3-child'}]};state.fruit={drops:[{id:'f4_suffix'}]};state.idCounter=seed;
  const old=structuredClone(state);
  for(let i=0;i<150;i++) {
    const prefix=['f','e','p'][i%3],expected=reference(old,prefix),actual=nextEntityId(state,prefix);
    assert.equal(actual,expected);assert.equal(state.idCounter,old.idCounter);comparisons++;
    // Mutation between calls, plus nested edit aliases and removals.
    state.pickups.push({id:actual});old.pickups.push({id:expected});
    if(i%5===0){state.pickups.shift();old.pickups.shift();}
  }
}
assert.equal(nextEntityId({idCounter:0,players:[{id:'f10'}]},'f'),'f1','numeric prefixes without delimiter are distinct');
console.log(`Entity IDs: ${comparisons} allocations match collision oracle, including mutations and aliases`);
