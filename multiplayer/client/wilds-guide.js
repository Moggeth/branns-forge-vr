// The Great Wilds guide card: where you are, how much you've found, and the nearest place you haven't been yet.
// Lives in the quest card's corner (the forge quest belongs to the classic valley) and reuses its .xhud styling, so on
// short landscape phones it folds to one row. Reads only the snapshot; the host decides what counts as found.
import {worldFor} from '../shared/worldgen/registry.js';
import {sitesOf} from '../shared/wilds.js';
import {inUnderway} from '../shared/underways/space.js';

const KIND = {settlement: 'village', landmark: 'landmark', discovery: 'find', entrance: 'cave'};
const SUB = {ruin: 'ruin', shrine: 'shrine', grove: 'grove', camp: 'camp', cache: 'cache', cave: 'cave mouth', peak: 'peak', falls: 'falls', lake: 'lake',
  harbour: 'harbour', mill: 'mill', fishery: 'fishery', lumber: 'lumber camp', mine: 'mine', farm: 'farm', village: 'village'};
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Compass word for a step (dx, dz): north is -z, the way the map preview and a fresh camera face. */
export function compassWord(dx, dz) {
  const a = Math.atan2(dx, -dz), k = Math.round(a / (Math.PI / 4));
  return POINTS[(k % 8 + 8) % 8];
}
const metres = d => d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;

/** What the card says for this player, or null when it should hide (no world, a God, or below ground). */
export function wildsGuideView(snapshot, playerId) {
  if (!snapshot?.world || !snapshot.wilds) return null;
  const me = snapshot.players?.find(p => p.id === playerId);
  if (!me || me.role !== 'hero' || inUnderway(me.position[0], me.position[2])) return null;
  const world = worldFor(snapshot.world), [x, , z] = me.position, found = new Set(snapshot.wilds.found);
  const sites = sitesOf(world), region = world.regionAt(x, z), danger = Math.max(0, Math.min(5, Math.round(world.dangerAt(x, z))));
  let next = null, best = Infinity;
  for (const s of sites) { if (found.has(s.id)) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < best) { best = d; next = s; } }
  const total = sites.length, have = sites.reduce((n, s) => n + found.has(s.id), 0);
  const kind = next ? SUB[next.sub] || KIND[next.kind] : '';
  return {
    title: region?.name || world.settlements.find(s => s.start)?.name || 'The Great Wilds',
    danger, found: have, total,
    next: next ? {id: next.id, name: next.name, kind, distance: best, way: compassWord(next.x - x, next.z - z)} : null,
    line: next ? `Next: ${next.name}${kind && !next.name.toLowerCase().includes(kind) ? ` (${kind})` : ''}, ${metres(best)} ${compassWord(next.x - x, next.z - z)}.` : 'You have found every place in this land.',
  };
}

const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const COMPASS = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm3.5 4.5-5 2-2 5 5-2z';
const TONE = ['#9be38a', '#b5d36b', '#e0c24a', '#e0a64a', '#ff8a4a', '#ff6a5a'];

export function createWildsGuide(root) {
  const box = document.createElement('section');
  box.className = 'expedition-banner xhud wilds-guide'; box.dataset.expanded = 'false'; box.setAttribute('aria-label', 'Wilds guide');
  box.innerHTML = `<button type="button" class="xhud-toggle" aria-expanded="false"><span class="xhud-stage-icon">${svg(COMPASS)}</span><span class="xhud-title"></span></button>
    <p class="xhud-next" aria-live="polite"></p>
    <div class="xhud-row"><div class="xhud-chips"><span class="xhud-chip wg-found"><span class="xhud-chip-num"></span></span><span class="xhud-chip wg-way"><span class="xhud-chip-num"></span></span><span class="xhud-chip wg-danger"><span class="xhud-chip-num"></span></span></div></div>`;
  root.append(box);
  const $ = s => box.querySelector(s);
  let last = '';
  // Phones fold the card to a chip; a tap opens it (desktop shows everything either way).
  $('.xhud-toggle').addEventListener('click', e => { const open = box.dataset.expanded !== 'true'; box.dataset.expanded = String(open); e.currentTarget.setAttribute('aria-expanded', String(open)); if (e.detail) e.currentTarget.blur(); });
  return {
    update(view) {
      box.hidden = !view; if (!view) return;
      const key = JSON.stringify([view.title, view.line, view.found, view.danger]); if (key === last) return; last = key;
      box.style.setProperty('--xhud-tone', TONE[view.danger]);
      $('.xhud-title').textContent = view.title;
      $('.xhud-next').textContent = view.line;
      $('.wg-found .xhud-chip-num').textContent = `Found ${view.found}/${view.total}`;
      $('.wg-way').hidden = !view.next; if (view.next) $('.wg-way .xhud-chip-num').textContent = `${metres(view.next.distance)} ${view.next.way}`;
      $('.wg-danger .xhud-chip-num').textContent = view.danger ? `Danger ${view.danger}` : 'Safe';
    },
    destroy() { box.remove(); },
  };
}
