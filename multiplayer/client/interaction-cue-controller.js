// Glue between game.js aim probes (10 Hz) and the cue presenter. Owns the tree index, hysteresis and DOM node.
// Reads the latest snapshot only; never mutates it and never sends commands.
import {decideCue, createCueStabilizer, deliverableNow} from './interaction-cue.js';
import {createCuePresenter} from './interaction-cue-view.js';
import {createTreeIndex} from '../shared/trees.js';
import {terrainHeight} from '../shared/simulation.js';
import './interaction-cue.css';

export function createInteractionCueController(parent, projectWorld = () => null) {
  const presenter = createCuePresenter(parent), stabilizer = createCueStabilizer({enter: 2, holdMs: 300}), trees = createTreeIndex();
  let snapshot = null, previousAt = null, anchorId = null, anchorPoint = null;
  const ctx = {tree: id => trees.get(id) || null, height: (x, z) => terrainHeight(snapshot, x, z), deliver: null};
  function hide() { stabilizer.reset(); presenter.render(null); previousAt = null; anchorId = anchorPoint = null; }
  return {
    /** aim: game probe or null; state: {active, role, xr, mode, position, yaw}; menuOpen from the lobby. */
    sample(aim, state, latest, playerId, menuOpen, now = performance.now()) {
      const self = latest?.players?.find(p => p.id === playerId);
      const view = {active: state.active, role: self?.role, xr: state.xr, menuOpen, mode: state.mode};
      if (!self || !view.active || view.role !== 'hero' || view.xr || menuOpen) return hide(); // instant, no linger
      snapshot = latest; trees.update(latest);
      ctx.deliver = {kinds: deliverableNow(latest.adventure, self.role, self.resources), held: self.resources};
      const predicted = {...self, position: state.position || self.position, yaw: Number.isFinite(state.yaw) ? state.yaw : self.yaw};
      const cue=stabilizer.push(decideCue(view,predicted,latest,aim,ctx),now);presenter.render(cue);
      if(cue){
        const id=cue.target, pickup=(latest.pickups||[]).find(q=>q.id===id), log=(latest.looseLogs||[]).find(q=>q.id===id);
        const building=latest.inventions?.structures.find(q=>q.id===id), tree=ctx.tree(id), deposit=latest.deposits?.find(q=>q.id===id);
        let point=aim?.hit?.targetId===id?aim.hit.point:null;
        if(log)point=log.position;
        else if(pickup)point=[pickup.x,ctx.height(pickup.x,pickup.z)+.25,pickup.z];
        else if(!point&&building)point=[building.position[0],building.position[1]+1,building.position[2]];
        else if(!point&&tree)point=[tree.x,ctx.height(tree.x,tree.z)+1,tree.z];
        else if(!point&&deposit)point=[deposit.x,ctx.height(deposit.x,deposit.z)+.6,deposit.z];
        if(point){anchorId=id;anchorPoint=point;}
        else if(id!==anchorId){anchorId=id;anchorPoint=null;}
        presenter.position(anchorPoint?projectWorld(anchorPoint):null,previousAt===null?0:(now-previousAt)/1000);
      }
      previousAt=now;return cue;
    },
    reset: hide,
    dispose() { hide(); presenter.dispose(); },
  };
}
