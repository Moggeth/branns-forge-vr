// DOM presenter for the contextual harvesting cue (model: interaction-cue.js). Framework-free, built once, never
// intercepts input (pointer-events: none), writes text only when the cue key changes. Not shown inside WebXR:
// DOM is invisible there; the controller hides it whenever the game reports XR.
//
// Two placements:
//  - anchored (default, legacy): a slim plate just below the crosshair, exactly as before. Used until position()
//    receives a finite on-screen target, and whenever the target is lost (null / off-screen / behind camera).
//  - associated: position({x, y, viewportWidth, viewportHeight}, dt) sits the plate beside the projected target,
//    offset left or right (never over it), joined by a faint amber leader ending in a small ring at the target.
// render() and position() are independent: the same cue key returns false from render() yet position() keeps moving.
const PIPS = 5; // largest maxHits (meteor ore); trees use 3
const SVG_NS = 'http://www.w3.org/2000/svg';
const GAP = 24;          // px between target and nearest plate edge
const RING = 9;          // target ring radius; leader starts outside it
const RAISE = 14;        // plate centre sits slightly above the target so the leader reads as a tag, not a strike-through
const EDGE = {top: 8, right: 8, bottom: 56, left: 8}; // bottom keeps clear of the equipment tray / touch buttons
const FLIP_MARGIN = 28;  // hysteresis: the other side must offer this much more room before we flip
const SMOOTH = 16;       // 1/s, exponential approach rate (critically damped feel at 60-120 Hz)
const SNAP_DIST = 220;   // px; jumps larger than this (target swap, resize) snap instead of sliding across the view

export function createCuePresenter(parent, doc = parent.ownerDocument) {
  const view = doc.defaultView;
  const el = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
  const root = el('div', 'bf-cue'), head = el('div', 'bf-cue-line'), name = el('span', 'bf-cue-name'),
    act = el('div', 'bf-cue-act'), action = el('span', 'bf-cue-action'),
    key = el('kbd', 'bf-cue-key'), pips = el('span', 'bf-cue-pips'), note = el('div', 'bf-cue-note');
  root.hidden = true; root.setAttribute('aria-hidden', 'true'); // visual aid; the help drawer carries the same controls
  pips.setAttribute('aria-hidden', 'true');
  const pipNodes = Array.from({length: PIPS}, () => pips.appendChild(el('i')));
  head.append(name, pips); act.append(action, key); root.append(head, act, note);

  // Leader: one SVG, one polyline + one ring. Hidden with the cue; never receives input.
  const svg = doc.createElementNS(SVG_NS, 'svg'), poly = doc.createElementNS(SVG_NS, 'polyline'), ring = doc.createElementNS(SVG_NS, 'circle');
  svg.setAttribute('class', 'bf-cue-leader'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  ring.setAttribute('r', String(RING)); svg.append(poly, ring); svg.style.display = 'none';
  parent.append(svg, root);

  const reduce = view?.matchMedia ? view.matchMedia('(prefers-reduced-motion: reduce)') : null; // read per frame, no listener
  let shownKey = null, size = null, cur = null, side = 0, placed = null, measuredViewport = '';

  const measure = () => { size = {w: root.offsetWidth || 1, h: root.offsetHeight || 1}; };
  function unanchor() {
    if (!root.classList.contains('bf-cue--placed')) return;
    root.classList.remove('bf-cue--placed', 'bf-cue--flip'); root.style.transform = ''; svg.style.display = 'none'; size = null;
    cur = null; side = 0; placed = null;
  }

  function place(t, dt) {
    const vw = t.viewportWidth, vh = t.viewportHeight;
    // Responsive type and wrapping change dimensions even when the target/key
    // remains unchanged across a phone rotation. Read layout only on that change.
    const viewportKey = `${vw}:${vh}`;
    if (!size || measuredViewport !== viewportKey) { measure(); measuredViewport = viewportKey; }
    const {w, h} = size;
    const roomR = vw - EDGE.right - (t.x + GAP), roomL = t.x - GAP - EDGE.left;
    // Side choice with hysteresis: keep the current side while it fits; flip only for a clearly roomier side.
    let s = side;
    if (!s) s = roomR >= w || roomR >= roomL ? 1 : -1;
    else { const mine = s > 0 ? roomR : roomL, other = s > 0 ? roomL : roomR; if (mine < w && other > mine + FLIP_MARGIN) s = -s; }
    side = s;
    const fits = (s > 0 ? roomR : roomL) >= w;
    let x, y;
    if (fits) { x = s > 0 ? t.x + GAP : t.x - GAP - w; y = t.y - RAISE - h / 2; }
    else { // Neither side fits (narrow portrait, long note): drop below the target, still never on it.
      x = t.x - w / 2; y = t.y + GAP;
      if (y + h > vh - EDGE.bottom) y = t.y - GAP - h; // or above, when the target is low
    }
    x = Math.min(Math.max(x, EDGE.left), Math.max(EDGE.left, vw - EDGE.right - w));
    y = Math.min(Math.max(y, EDGE.top), Math.max(EDGE.top, vh - EDGE.bottom - h));

    const snap = !cur || reduce?.matches || !(dt > 0) || Math.hypot(x - cur.x, y - cur.y) > SNAP_DIST;
    if (snap) cur = {x, y};
    else { const k = 1 - Math.exp(-SMOOTH * Math.min(dt, 0.1)); cur = {x: cur.x + (x - cur.x) * k, y: cur.y + (y - cur.y) * k}; }
    const px = Math.round(cur.x * 2) / 2, py = Math.round(cur.y * 2) / 2; // half-pixel steps: smooth, no subpixel shimmer
    root.style.transform = `translate3d(${px}px,${py}px,0)`;

    // Leader: target ring edge -> short elbow -> nearest plate edge (vertical mid). Below/above mode joins the near edge.
    const below = !fits, ex = below ? Math.min(Math.max(t.x, px + 10), px + w - 10) : (px + w / 2 < t.x ? px + w : px);
    const ey = below ? (py > t.y ? py : py + h) : py + h / 2;
    const dx = ex - t.x, dy = ey - t.y, d = Math.hypot(dx, dy) || 1;
    const sx = t.x + dx / d * (RING + 2), sy = t.y + dy / d * (RING + 2);
    const bx = below ? ex : ex - Math.sign(dx || 1) * 8, by = ey;
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`); svg.setAttribute('width', String(vw)); svg.setAttribute('height', String(vh));
    poly.setAttribute('points', d > RING + 6 ? `${sx.toFixed(1)},${sy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}` : '');
    ring.setAttribute('cx', t.x.toFixed(1)); ring.setAttribute('cy', t.y.toFixed(1));
    svg.dataset.state = root.dataset.state || '';
    root.classList.toggle('bf-cue--flip', !below && s < 0); // brass accent edge faces the leader
    placed = {x: px, y: py, width: w, height: h, side: below ? (py > t.y ? 'below' : 'above') : s > 0 ? 'right' : 'left'};
    return placed;
  }

  return {
    render(cue) {
      const next = cue ? cue.key : null;
      if (next === shownKey) return false;
      shownKey = next;
      if (!cue) { root.hidden = true; svg.style.display = 'none'; unanchor(); return true; }
      root.dataset.kind = cue.kind; root.dataset.state = cue.state;
      name.textContent = cue.name; action.textContent = cue.action;
      key.textContent = cue.control; key.hidden = !cue.control;
      note.textContent = cue.note; note.hidden = !cue.note;
      const p = cue.progress;
      pips.hidden = !p;
      if (p) pipNodes.forEach((n, i) => { n.hidden = i >= p.total; n.className = i < p.done ? 'on' : ''; });
      root.hidden = false;
      size = null; // text changed: re-measure on the next position() (one layout read per key change, not per frame)
      if (root.classList.contains('bf-cue--placed')) svg.style.display = '';
      return true;
    },
    /**
     * target: {x, y, viewportWidth, viewportHeight} in CSS px (client space of the fixed overlay), or null when
     * the object is behind the camera / unknown. deltaSeconds: frame dt. Returns the applied placement
     * {x, y, width, height, side:'left'|'right'|'below'|'above'} or null (hidden, or anchored under the crosshair).
     */
    position(target, deltaSeconds = 0) {
      if (root.hidden) return null;
      const t = target, vw = t?.viewportWidth ?? view?.innerWidth, vh = t?.viewportHeight ?? view?.innerHeight;
      const ok = t && Number.isFinite(t.x) && Number.isFinite(t.y) && vw > 0 && vh > 0
        && t.x >= 0 && t.x <= vw && t.y >= 0 && t.y <= vh;
      if (!ok) { unanchor(); return null; }
      if (!root.classList.contains('bf-cue--placed')) { root.classList.add('bf-cue--placed'); svg.style.display = ''; size = null; cur = null; side = 0; }
      return place({x: t.x, y: t.y, viewportWidth: vw, viewportHeight: vh}, deltaSeconds);
    },
    /** Last applied placement (for acceptance checks); null when anchored or hidden. */
    get placement() { return placed; },
    element: root,
    leader: svg,
    dispose() { root.remove(); svg.remove(); shownKey = null; size = cur = placed = null; },
  };
}
