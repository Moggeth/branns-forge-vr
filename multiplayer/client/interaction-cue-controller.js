// Glue between game.js aim probes (10 Hz) and the cue presenter. Owns the tree index, hysteresis and DOM node.
// Reads the latest snapshot only; never mutates it and never sends commands.
import {decideCue, createCueStabilizer, deliverableNow} from './interaction-cue.js';
import {createCuePresenter} from './interaction-cue-view.js';
import {createTreeIndex} from '../shared/trees.js';
import {terrainHeight} from '../shared/simulation.js';
import './interaction-cue.css';

export function createInteractionCueController(parent) {
  const presenter = createCuePresenter(parent), stabilizer = createCueStabilizer({enter: 2, holdMs: 300}), trees = createTreeIndex();
  let snapshot = null;
  const ctx = {tree: id => trees.get(id) || null, height: (x, z) => terrainHeight(snapshot, x, z), deliver: null};
  function hide() { stabilizer.reset(); presenter.render(null); }
  return {
    /** aim: game probe or null; state: {active, role, xr, mode, position, yaw}; menuOpen from the lobby. */
    sample(aim, state, latest, playerId, menuOpen, now = performance.now()) {
      const self = latest?.players?.find(p => p.id === playerId);
      const view = {active: state.active, role: self?.role, xr: state.xr, menuOpen, mode: state.mode};
      if (!self || !view.active || view.role !== 'hero' || view.xr || menuOpen) return hide(); // instant, no linger
      snapshot = latest; trees.update(latest);
      ctx.deliver = {kinds: deliverableNow(latest.adventure, self.role, self.resources), held: self.resources};
      const predicted = {...self, position: state.position || self.position, yaw: Number.isFinite(state.yaw) ? state.yaw : self.yaw};
      presenter.render(stabilizer.push(decideCue(view, predicted, latest, aim, ctx), now));
    },
    reset: hide,
    dispose() { hide(); presenter.dispose(); },
  };
}
