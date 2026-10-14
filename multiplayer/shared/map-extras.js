// Buildings placed from the map editor's build menu (shared/map-layout.js MAP_EXTRAS): cottages, wells and lantern
// posts that stand in every world as solid scenery, using the back towns' footprints. Trees and ore placed there join
// the starting trees and deposits instead (shared/world-content.js). Pure maths: no clocks, randomness or DOM.
import {MAP_EXTRAS} from './map-layout.js';
import {BACK_TOWN_SOLIDS} from './home-workshop.js';

export const EXTRA_BUILDINGS = Object.freeze({
  cottage: BACK_TOWN_SOLIDS.cottage, cottageB: BACK_TOWN_SOLIDS.cottage2, well: BACK_TOWN_SOLIDS.well,
  lantern: Object.freeze([{at: [0, 0], r: .15}]),
});
export const extraBuildings = (extras = MAP_EXTRAS) => extras.filter(e => EXTRA_BUILDINGS[e.kind]);
const BUILT = extraBuildings();
const REACH = 4; // every extra building fits inside this radius

/** World [x, z] of a point in a placed extra's own frame (three.js yaw, like the keep pieces). */
export const extraWorld = (e, [px, pz]) => { const c = Math.cos(e.yaw), s = Math.sin(e.yaw); return [e.x + px * c + pz * s, e.z - px * s + pz * c]; };
const extraLocal = (e, [wx, wz]) => { const c = Math.cos(e.yaw), s = Math.sin(e.yaw), dx = wx - e.x, dz = wz - e.z; return [dx * c - dz * s, dx * s + dz * c]; };

/** Push a body out of any placed cottage, well or lantern post (mutates position). */
export function resolveMapExtras(position, radius = .3, list = BUILT) {
  for (const e of list) {
    if (Math.abs(position[0] - e.x) > REACH + radius || Math.abs(position[2] - e.z) > REACH + radius) continue;
    for (const sol of EXTRA_BUILDINGS[e.kind]) {
      const [u, v] = extraLocal(e, [position[0], position[2]]), [cu, cv] = sol.at;
      let nu = u, nv = v;
      if (sol.r !== undefined) {
        const du = u - cu, dv = v - cv, d = Math.hypot(du, dv), min = sol.r + radius;
        if (d >= min) continue;
        if (d > 1e-4) { nu = cu + du / d * min; nv = cv + dv / d * min; } else nu = cu + min;
      } else {
        const hu = sol.half[0] + radius, hv = sol.half[1] + radius, du = u - cu, dv = v - cv;
        if (Math.abs(du) >= hu || Math.abs(dv) >= hv) continue;
        if (hu - Math.abs(du) < hv - Math.abs(dv)) nu = cu + Math.sign(du || 1) * hu; else nv = cv + Math.sign(dv || 1) * hv;
      }
      [position[0], position[2]] = extraWorld(e, [nu, nv]);
    }
  }
  return position;
}
