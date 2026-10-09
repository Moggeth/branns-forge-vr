// Map editor page (map-editor/index.html): a top-down view of the real map built from the game's own layout tables
// (map-editor/model.js). Drag to move, turn with the handle, Save writes shared/map-layout.json through the
// dev server (map-editor/save-plugin.mjs). Local only: never built or deployed.
import * as M from './model.js';

const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const items = M.buildItems(), byKey = new Map(items.map(i => [i.key, i]));
const DRAFT_KEY = 'brann-map-editor-draft-v1', VIEW_KEY = 'brann-map-editor-view-v1';
const store = {get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} }};

// ---------------------------------------------------------------- layers and colours
const ORE = {stone: '#b7b2a6', iron: '#d0835a', mithril: '#7fe2ff', crystal: '#ff86d5'};
const LAYERS = [
  {id: 'keep', label: 'Keeps', color: 'var(--party)'}, {id: 'town', label: 'Back towns', color: 'var(--town)'},
  {id: 'mug', label: 'The Mug', color: 'var(--mug)'}, {id: 'landmark', label: 'Landmarks', color: 'var(--landmark)'},
  {id: 'tree', label: 'Trees', color: 'var(--tree)'}, {id: 'ore', label: 'Ore', color: ORE.crystal}, {id: 'labels', label: 'Labels', color: '#fff'},
];
const shown = Object.fromEntries(LAYERS.map(l => [l.id, true]));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS = {party: css('--party'), rivals: css('--rivals'), town: css('--town'), mug: css('--mug'), landmark: css('--landmark'), tree: css('--tree'), danger: css('--danger'), warn: css('--warn'), accent: css('--accent')};
function colorOf(inst) {
  const g = inst.it.group;
  if (g === 'keep' || g === 'town') return inst.side === 'rivals' ? COLORS.rivals : g === 'town' ? COLORS.town : COLORS.party;
  if (g === 'ore') return ORE[(inst.it.label.split(' ')[0] || '').toLowerCase()] || '#ccc';
  return COLORS[g] || '#ddd';
}

// ---------------------------------------------------------------- view
const view = {cx: 0, cz: 0, scale: 6}; // screen px per metre; north (+z) is up the screen
let W = 0, H = 0, DPR = 1;
const toScreen = (x, z) => [W / 2 + (x - view.cx) * view.scale, H / 2 - (z - view.cz) * view.scale];
const toWorld = (sx, sy) => [view.cx + (sx - W / 2) / view.scale, view.cz - (sy - H / 2) / view.scale];
function resize() {
  const r = canvas.getBoundingClientRect(); DPR = Math.min(2, devicePixelRatio || 1);
  W = r.width; H = r.height; canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR); draw();
}
function fit() { const span = M.WORLD_EXTENT * 2 + 4; view.cx = 0; view.cz = 0; view.scale = Math.max(1, Math.min(W, H) / span); draw(); }

// Terrain: shaded relief of the real ground, sampled once from the game's height field.
const EXT = M.WORLD_EXTENT, TEX = 340;
let terrain = null;
function buildTerrain() {
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const g = c.getContext('2d'), img = g.createImageData(TEX, TEX), step = EXT * 2 / TEX, h = new Float32Array(TEX * TEX);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) h[j * TEX + i] = M.baseHeight(-EXT + (i + .5) * step, EXT - (j + .5) * step);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const k = j * TEX + i, y = h[k], dx = (h[j * TEX + Math.min(TEX - 1, i + 1)] - h[j * TEX + Math.max(0, i - 1)]) / (2 * step), dz = (h[Math.max(0, j - 1) * TEX + i] - h[Math.min(TEX - 1, j + 1) * TEX + i]) / (2 * step);
    const shade = Math.max(.35, Math.min(1.25, 1 + (-dx * .55 + dz * .55) * .6)), slope = Math.min(1, Math.hypot(dx, dz) / 1.6), hi = Math.min(1, Math.max(0, (y - 3) / 22));
    let r = 92 + 30 * (1 - hi), gg = 128 + 18 * (1 - hi), b = 74;
    r = r * (1 - slope) + 128 * slope; gg = gg * (1 - slope) + 120 * slope; b = b * (1 - slope) + 108 * slope;
    r = r * (1 - hi) + 150 * hi; gg = gg * (1 - hi) + 146 * hi; b = b * (1 - hi) + 140 * hi;
    const o = k * 4; img.data[o] = r * shade; img.data[o + 1] = gg * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); terrain = c;
}

// ---------------------------------------------------------------- state, undo, problems
let selected = null; // {it, side}
let hover = null;
let undoStack = [], redoStack = [], savedText = M.layoutFile(items);
const snapshot = () => items.map(i => JSON.stringify(i.value));
const restore = snap => { items.forEach((it, n) => { it.value = JSON.parse(snap[n]); }); };
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); changed(); }
let insts = [], probs = [], badSet = new Set(), groundSet = new Set();
function recompute() {
  insts = M.instances(items);
  const ov = M.overlaps(insts), ground = M.badGround(insts);
  badSet = new Set(ov.flatMap(o => [o.a, o.b]));
  groundSet = new Set(ground.map(g => g.p));
  probs = [...ov.map(o => ({kind: 'overlap', text: `${nameOf(o.a)} overlaps ${nameOf(o.b)} by ${o.depth.toFixed(1)} m`, at: o.a.it.fixed ? o.b : o.a})),
    ...ground.map(g => ({kind: 'ground', text: `${nameOf(g.p)} is ${g.why}`, at: g.p}))];
}
const sideName = side => side === 'party' ? 'Dawnhold' : side === 'rivals' ? 'Grumblekeep' : '';
const nameOf = inst => inst.side && inst.it.group !== 'fixed' ? `${inst.it.label} (${sideName(inst.side)})` : inst.it.label;
function changed({keepRedo = true} = {}) {
  recompute(); renderPanel(); draw();
  const text = M.layoutFile(items), dirty = text !== savedText;
  $('save').classList.toggle('dirty', dirty);
  $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  if (dirty) store.set(DRAFT_KEY, {base: savedText, moves: M.exportMoves(items)}); else store.del(DRAFT_KEY);
}

// ---------------------------------------------------------------- drawing
function pathShape(shape) {
  ctx.beginPath();
  if (shape.r !== undefined) { const [x, y] = toScreen(shape.x, shape.z); ctx.arc(x, y, Math.max(2, shape.r * view.scale), 0, Math.PI * 2); return; }
  M.boxCorners(shape).forEach(([x, z], n) => { const [sx, sy] = toScreen(x, z); n ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
  ctx.closePath();
}
const visible = inst => inst.it.group === 'fixed' || shown[inst.it.group];
function draw() {
  if (!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#20252b'; ctx.fillRect(0, 0, W, H);
  if (terrain) { const [x0, y0] = toScreen(-EXT, EXT); ctx.imageSmoothingEnabled = true; ctx.drawImage(terrain, x0, y0, EXT * 2 * view.scale, EXT * 2 * view.scale); }
  // Grid every 10 m, and the open meadow's edge.
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.07)';
  for (let v = -70; v <= 70; v += 10) { let [a, b] = toScreen(v, -EXT), [c, d] = toScreen(v, EXT); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); [a, b] = toScreen(-EXT, v); [c, d] = toScreen(EXT, v); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
  ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.22)'; { const [a, b] = toScreen(-50, 50); ctx.strokeRect(a, b, 100 * view.scale, 100 * view.scale); } ctx.setLineDash([]);
  // Keep domes.
  for (const side of M.SIDES) { const [x, z] = M.HOME_SITES[side], [sx, sy] = toScreen(x, z); ctx.beginPath(); ctx.arc(sx, sy, M.HOME.domeRadius * view.scale, 0, Math.PI * 2); ctx.strokeStyle = side === 'party' ? 'rgba(111,178,255,.35)' : 'rgba(185,140,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  // Landmark paths.
  if (shown.landmark) for (const p of M.paths(items)) {
    ctx.beginPath(); p.points.forEach(([x, z], n) => { const [sx, sy] = toScreen(x, z); n ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.strokeStyle = 'rgba(214,184,132,.75)'; ctx.lineWidth = Math.max(2, p.width * view.scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  // Ghost of the authored spot for the selected item.
  if (selected) for (const side of M.sidesOf(selected.it)) {
    const ghost = {...selected.it, value: selected.it.authored};
    if (JSON.stringify(ghost.value) === JSON.stringify(selected.it.value)) break;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2;
    for (const s of M.footprint(ghost, side)) { pathShape(s); ctx.stroke(); }
    const a = M.placement(ghost, side), b = M.placement(selected.it, side), [ax, ay] = toScreen(a.x, a.z), [bx, by] = toScreen(b.x, b.z);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
  }
  // Footprints, smallest last so trees and lanterns stay clickable on top of buildings.
  const list = insts.filter(visible).sort((a, b) => b.r - a.r);
  for (const inst of list) {
    const col = inst.fixed ? '#e9e2d0' : colorOf(inst), bad = badSet.has(inst), steep = groundSet.has(inst);
    const isSel = selected && inst.it === selected.it, twin = isSel && inst.side !== selected.side;
    if (inst.floor) { pathShape(inst.floor); ctx.globalAlpha = isSel ? .22 : .12; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
    for (const s of inst.shapes) {
      pathShape(s);
      ctx.globalAlpha = inst.fixed ? .25 : isSel ? .6 : .42; ctx.fillStyle = bad ? COLORS.danger : col; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = isSel ? 2.5 : 1.3; ctx.strokeStyle = bad ? COLORS.danger : isSel ? '#fff' : hover?.it === inst.it ? '#fff' : col;
      if (twin) ctx.setLineDash([5, 4]);
      if (steep && !bad) { ctx.strokeStyle = COLORS.warn; ctx.setLineDash([3, 3]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // Front arrow for buildings that face somewhere.
    if (inst.it.rotatable) {
      const pl = M.placement(inst.it, inst.side), len = Math.max(14, inst.r * view.scale * .9), [sx, sy] = toScreen(pl.x, pl.z);
      const ex = sx + Math.sin(pl.yaw) * len, ey = sy - Math.cos(pl.yaw) * len;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      const ah = 6, ang = Math.atan2(ey - sy, ex - sx); ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ah * Math.cos(ang - .5), ey - ah * Math.sin(ang - .5)); ctx.lineTo(ex - ah * Math.cos(ang + .5), ey - ah * Math.sin(ang + .5)); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }
  // Rotate handle on the grabbed copy.
  const hnd = handle();
  if (hnd) { ctx.beginPath(); ctx.moveTo(hnd.cx, hnd.cy); ctx.lineTo(hnd.x, hnd.y); ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(hnd.x, hnd.y, 8, 0, Math.PI * 2); ctx.fillStyle = COLORS.accent; ctx.fill(); ctx.strokeStyle = '#2a1d05'; ctx.stroke(); }
  // Labels.
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const inst of list) {
    const isSel = selected && inst.it === selected.it, big = inst.r * view.scale > 18 || inst.it.group === 'landmark';
    if (!isSel && hover?.it !== inst.it && !(shown.labels && big && view.scale > 4)) continue;
    if (!isSel && shown.labels && inst.it.group === 'keep' && inst.it.kind === 'point' && view.scale < 9) continue;
    const [sx, sy] = toScreen(inst.x, inst.z), text = inst.it.label;
    // The selection's label sits below it, clear of its turn handle (which points the way it faces).
    const ly = isSel ? sy + inst.r * view.scale + 12 : sy - inst.r * view.scale - 10, w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(15,17,21,.78)'; ctx.fillRect(sx - w / 2, ly - 9, w, 18);
    ctx.fillStyle = '#fff'; ctx.fillText(text, sx, ly);
  }
}

// ---------------------------------------------------------------- picking
function inShape(s, x, z, pad) {
  if (s.r !== undefined) return Math.hypot(x - s.x, z - s.z) <= s.r + pad;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z, u = dx * c - dz * sn, v = dx * sn + dz * c;
  return Math.abs(u) <= s.hu + pad && Math.abs(v) <= s.hv + pad;
}
function pick(sx, sy) {
  const [x, z] = toWorld(sx, sy), pad = 6 / view.scale;
  let best = null;
  for (const inst of insts) {
    if (inst.fixed || !visible(inst)) continue;
    if (Math.hypot(x - inst.x, z - inst.z) > inst.r + pad) continue;
    if ((inst.shapes.some(s => inShape(s, x, z, pad)) || (inst.floor && inShape(inst.floor, x, z, pad))) && (!best || inst.r < best.r)) best = inst;
  }
  return best;
}
function handle() {
  if (!selected || !selected.it.rotatable) return null;
  const pl = M.placement(selected.it, selected.side), inst = insts.find(i => i.it === selected.it && i.side === selected.side);
  const [cx, cy] = toScreen(pl.x, pl.z), len = Math.max(34, (inst?.r || 3) * view.scale + 18);
  return {cx, cy, x: cx + Math.sin(pl.yaw) * len, y: cy - Math.cos(pl.yaw) * len};
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let drag = null; // {mode: 'move' | 'turn' | 'pan' | 'pinch', ...}
const snapOn = e => !e.altKey;
const snapTo = (v, step) => Math.round(v / step) * step;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = {mode: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], scale: view.scale, cx: view.cx, cz: view.cz}; return; }
  const hnd = handle();
  if (hnd && Math.hypot(e.offsetX - hnd.x, e.offsetY - hnd.y) < 14) { pushUndo(); drag = {mode: 'turn'}; canvas.classList.add('dragging'); return; }
  const hit = pick(e.offsetX, e.offsetY);
  if (hit) {
    selected = {it: hit.it, side: hit.side};
    const pl = M.placement(hit.it, hit.side), [wx, wz] = toWorld(e.offsetX, e.offsetY);
    drag = {mode: 'move', off: [pl.x - wx, pl.z - wz], start: [e.offsetX, e.offsetY], moved: false, before: snapshot()};
    canvas.classList.add('dragging'); renderPanel(); draw(); return;
  }
  drag = {mode: 'pan', start: [e.offsetX, e.offsetY], cx: view.cx, cz: view.cz, click: true}; canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  const [wx, wz] = toWorld(e.offsetX, e.offsetY);
  $('hud').textContent = `x ${wx.toFixed(1)}  z ${wz.toFixed(1)}  ground ${M.baseHeight(wx, wz).toFixed(1)} m${selected ? `  ·  ${selected.it.label}` : ''}`;
  if (!drag) { const h = pick(e.offsetX, e.offsetY); if (h?.it !== hover?.it) { hover = h; canvas.classList.toggle('over', !!h); draw(); } return; }
  if (drag.mode === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    view.scale = Math.max(1, Math.min(80, drag.scale * dist / drag.dist));
    const [mx, mz] = [drag.cx + (drag.mid[0] - W / 2) / drag.scale, drag.cz - (drag.mid[1] - H / 2) / drag.scale];
    view.cx = mx - (mid[0] - W / 2) / view.scale; view.cz = mz + (mid[1] - H / 2) / view.scale; draw(); return;
  }
  if (drag.mode === 'pan') {
    if (Math.hypot(e.offsetX - drag.start[0], e.offsetY - drag.start[1]) > 4) drag.click = false;
    view.cx = drag.cx - (e.offsetX - drag.start[0]) / view.scale; view.cz = drag.cz + (e.offsetY - drag.start[1]) / view.scale; draw(); return;
  }
  if (drag.mode === 'move') {
    if (!drag.moved && Math.hypot(e.offsetX - drag.start[0], e.offsetY - drag.start[1]) < 4) return;
    if (!drag.moved) { undoStack.push(drag.before); redoStack = []; drag.moved = true; }
    let x = wx + drag.off[0], z = wz + drag.off[1];
    if (snapOn(e)) { x = snapTo(x, .25); z = snapTo(z, .25); }
    M.moveTo(selected.it, selected.side, x, z, byKey); recompute(); renderSelection(); draw(); return;
  }
  if (drag.mode === 'turn') {
    const pl = M.placement(selected.it, selected.side); let yaw = Math.atan2(wx - pl.x, wz - pl.z);
    if (snapOn(e)) yaw = snapTo(yaw, Math.PI / 24);
    M.turnTo(selected.it, selected.side, yaw); recompute(); renderSelection(); draw();
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === 'pan' && drag.click) { selected = null; renderPanel(); draw(); }
  if (drag.mode === 'pinch') { drag = pointers.size ? {mode: 'pan', start: [...pointers.values()][0], cx: view.cx, cz: view.cz} : null; return; }
  const did = drag.mode === 'turn' || drag.moved;
  drag = null; canvas.classList.remove('dragging');
  if (did) changed();
  saveView();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.shiftKey && selected?.it.rotatable) { // Shift+scroll turns the selection 5 degrees a notch
    const pl = M.placement(selected.it, selected.side); pushUndo(); M.turnTo(selected.it, selected.side, pl.yaw + Math.sign(e.deltaY || e.deltaX) * Math.PI / 36); changed(); return;
  }
  const [wx, wz] = toWorld(e.offsetX, e.offsetY); view.scale = Math.max(1, Math.min(80, view.scale * Math.exp(-e.deltaY * .0015)));
  view.cx = wx - (e.offsetX - W / 2) / view.scale; view.cz = wz + (e.offsetY - H / 2) / view.scale; draw(); saveView();
}, {passive: false});
let viewTimer = 0;
function saveView() { clearTimeout(viewTimer); viewTimer = setTimeout(() => store.set(VIEW_KEY, view), 300); }

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (e.key === 'f' || e.key === 'F') { fit(); return; }
  if (e.key === 'Escape') { selected = null; renderPanel(); draw(); return; }
  if (!selected) return;
  const step = e.shiftKey ? 1 : .1, nudge = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]}[e.key];
  if (nudge) { e.preventDefault(); const pl = M.placement(selected.it, selected.side); pushUndo(); M.moveTo(selected.it, selected.side, pl.x + nudge[0], pl.z + nudge[1], byKey); changed(); return; }
  if ((e.key === 'q' || e.key === 'e' || e.key === 'Q' || e.key === 'E') && selected.it.rotatable) {
    const pl = M.placement(selected.it, selected.side), d = (e.shiftKey ? 1 : 15) * Math.PI / 180 * (e.key.toLowerCase() === 'q' ? -1 : 1);
    pushUndo(); M.turnTo(selected.it, selected.side, pl.yaw + d); changed(); return;
  }
  if (e.key === 'r' || e.key === 'R') resetSelected();
});

// ---------------------------------------------------------------- side panel
const fmt = v => (+v).toFixed(2);
const GROUP_NAMES = {keep: 'Keep piece', town: 'Back-town piece', mug: 'Shared tavern', landmark: 'Landmark', tree: 'Starting tree', ore: 'Starting ore'};
function renderSelection() {
  const el = $('selection');
  if (!selected) { el.innerHTML = '<p class="empty">Click or tap anything on the map to move it.</p>'; return; }
  const {it, side} = selected, pl = M.placement(it, side), deg = ((pl.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const moved = JSON.stringify(it.value) !== JSON.stringify(it.authored);
  const mirror = it.frame !== 'world' ? '<span class="badge">mirrored in both keeps</span>' : '';
  const editing = it.frame !== 'world' ? `Editing the ${sideName(side)} copy` : GROUP_NAMES[it.group];
  el.innerHTML = `<div class="card">
    <div class="sel-name">${it.label}</div>
    <div class="sel-sub">${editing}${mirror}${moved ? '<span class="badge" style="color:var(--accent)">moved</span>' : ''}</div>
    <div class="row"><label>Position</label><div class="pair"><input id="in-x" type="number" step="0.25" value="${fmt(pl.x)}" aria-label="x"><input id="in-z" type="number" step="0.25" value="${fmt(pl.z)}" aria-label="z"></div></div>
    ${it.rotatable ? `<div class="row"><label>Facing</label><input id="in-yaw" type="range" min="0" max="360" step="1" value="${deg.toFixed(0)}" aria-label="Facing in degrees"></div>` : ''}
    <div class="row"><label></label><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" id="reset-sel" ${moved ? '' : 'disabled'}>Reset to original</button></div></div>
  </div>`;
  const setPos = () => { const x = +$('in-x').value, z = +$('in-z').value; if (!Number.isFinite(x) || !Number.isFinite(z)) return; pushUndo(); M.moveTo(it, side, x, z, byKey); changed(); };
  $('in-x').onchange = setPos; $('in-z').onchange = setPos;
  if (it.rotatable) {
    const yawIn = $('in-yaw');
    yawIn.onpointerdown = () => pushUndo();
    yawIn.oninput = () => { M.turnTo(it, side, +yawIn.value * Math.PI / 180); recompute(); draw(); };
    yawIn.onchange = () => changed();
  }
  $('reset-sel').onclick = resetSelected;
}
function resetSelected() {
  if (!selected) return; const it = selected.it;
  pushUndo(); it.value = JSON.parse(JSON.stringify(it.authored));
  for (const k of it.carry || []) { const o = byKey.get(k); if (o) o.value = JSON.parse(JSON.stringify(o.authored)); }
  changed();
}
function focus(inst) {
  selected = inst.it.group === 'fixed' ? null : {it: inst.it, side: inst.side};
  view.cx = inst.x; view.cz = inst.z; view.scale = Math.max(view.scale, 9); renderPanel(); draw(); saveView();
}
function renderPanel() {
  renderSelection();
  const pe = $('problems');
  if (!probs.length) pe.innerHTML = '<p class="ok">Nothing overlaps and nothing sits on a cliff.</p>';
  else {
    pe.innerHTML = `<ul class="problems">${probs.map((p, n) => `<li data-n="${n}" class="${p.kind === 'ground' ? 'warn' : ''}">${p.text}</li>`).join('')}</ul>`;
    pe.querySelectorAll('li').forEach(li => { li.onclick = () => focus(probs[+li.dataset.n].at); });
  }
  const moves = Object.keys(M.exportMoves(items));
  $('moves').innerHTML = moves.length ? `${moves.length} placement${moves.length === 1 ? '' : 's'} moved from the code's layout. <button class="btn small" id="reset-all">Reset everything</button>` : 'Nothing moved yet.';
  const ra = $('reset-all'); if (ra) ra.onclick = () => { if (!confirm('Put every placement back where the code has it?')) return; pushUndo(); for (const it of items) it.value = JSON.parse(JSON.stringify(it.authored)); changed(); };
}

// ---------------------------------------------------------------- save, copy, play
let toastTimer = 0;
function toast(text, bad = false) { const t = $('toast'); t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 6000 : 3000); }
async function save() {
  const text = M.layoutFile(items);
  try {
    const r = await fetch('/__map-layout', {method: 'POST', headers: {'content-type': 'application/json'}, body: text});
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) throw Error(out.error || `HTTP ${r.status}`);
    savedText = text; store.del(DRAFT_KEY); changed();
    toast(`Saved to ${out.file}. Play-test, or Copy layout and paste it to Claude.`);
  } catch (e) {
    download(text);
    toast(`Couldn't write the file (${e.message}). Downloaded map-layout.json instead.`, true);
  }
}
function download(text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'application/json'})); a.download = 'map-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  const text = M.layoutFile(items);
  try { await navigator.clipboard.writeText(text); toast('Layout copied. Paste it to Claude in the project thread.'); }
  catch { download(text); toast('Clipboard blocked here, so the layout downloaded as map-layout.json instead.'); }
}
$('save').onclick = save; $('copy').onclick = copy; $('undo').onclick = undo; $('redo').onclick = redo; $('fit').onclick = fit;
$('play').onclick = () => { if (M.layoutFile(items) !== savedText) toast('Save first: the game reads the saved layout.', true); else open('/', '_blank'); };
$('sheet').onclick = () => { const s = $('side'); s.classList.toggle('collapsed'); $('sheet').textContent = s.classList.contains('collapsed') ? 'Show' : 'Hide'; requestAnimationFrame(resize); };

// Layer chips.
$('layers').innerHTML = LAYERS.map(l => `<button class="chip" data-id="${l.id}" aria-pressed="true"><i style="background:${l.color}"></i>${l.label}</button>`).join('');
$('layers').querySelectorAll('.chip').forEach(b => { b.onclick = () => { shown[b.dataset.id] = !shown[b.dataset.id]; b.setAttribute('aria-pressed', shown[b.dataset.id]); if (selected && !shown[selected.it.group]) selected = null; renderPanel(); draw(); }; });

// Unsaved moves from a previous visit (only offered while the file on disk is the one they were made against).
const draft = store.get(DRAFT_KEY);
if (draft && draft.base === savedText && draft.moves && Object.keys(draft.moves).length) {
  $('draft').classList.add('show');
  $('draft-restore').onclick = () => {
    pushUndo();
    for (const it of items) if (draft.moves[it.key] !== undefined) it.value = JSON.parse(JSON.stringify(draft.moves[it.key]));
    $('draft').classList.remove('show'); changed();
  };
  $('draft-discard').onclick = () => { store.del(DRAFT_KEY); $('draft').classList.remove('show'); };
} else if (draft) store.del(DRAFT_KEY);

// ---------------------------------------------------------------- start
new ResizeObserver(resize).observe(canvas);
buildTerrain(); recompute(); renderPanel();
resize();
const savedView = store.get(VIEW_KEY);
if (savedView && Number.isFinite(savedView.scale)) Object.assign(view, savedView); else fit();
changed();
$('hud').textContent = 'Drag anything to move it · scroll to zoom · F to fit';
window.__mapEditor = {items, view, save: () => M.layoutFile(items), select: key => { const it = byKey.get(key); selected = it ? {it, side: M.sidesOf(it)[0]} : null; renderPanel(); draw(); }};
