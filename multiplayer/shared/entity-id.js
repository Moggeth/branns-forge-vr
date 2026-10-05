export function nextEntityId(state, prefix) {
  // Scan the existing collections in place. A burst of drops used to copy and
  // flatten every world object for EACH ID, then allocate suffix strings again
  // for every comparison. Preserve exact collision/prefix rules and ordering.
  const lists=[state.players,state.enemies,state.edits,state.groves,state.pendingStarfalls,state.deposits,state.pickups,state.bridges,state.projectiles,state.embeds,state.detachedParts,state.fireSurfaces,state.looseLogs,state.meteorRewards,state.settlement?.workers,state.awakenedTrees,state.wildTrees,state.fruit?.drops];
  for (;;) {
    const id=`${prefix}${++state.idCounter}`,under=id+'_',dash=id+'-';let used=false;
    for (const list of lists) {
      for (const item of list||[]) {
        const a=item.id,b=item.editId;
        if(a===id||a.startsWith(under)||a.startsWith(dash)||b&&(b===id||b.startsWith(under)||b.startsWith(dash))){used=true;break;}
      }
      if(used)break;
    }
    if(!used)return id;
  }
}
