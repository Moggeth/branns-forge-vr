// DOM presenter for the contextual harvesting cue (model: interaction-cue.js). Framework-free, built once, never
// intercepts input (pointer-events: none), writes text only when the cue key changes. Not shown inside WebXR:
// DOM is invisible there; the controller hides it whenever the game reports XR.
const PIPS = 5; // largest maxHits (meteor ore); trees use 3

export function createCuePresenter(parent, doc = parent.ownerDocument) {
  const el = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
  const root = el('div', 'bf-cue'), line = el('div', 'bf-cue-line'), name = el('span', 'bf-cue-name'), action = el('span', 'bf-cue-action'),
    key = el('kbd', 'bf-cue-key'), pips = el('span', 'bf-cue-pips'), note = el('div', 'bf-cue-note');
  root.hidden = true; root.setAttribute('aria-hidden', 'true'); // visual aid; the help drawer carries the same controls
  pips.setAttribute('aria-hidden', 'true');
  const pipNodes = Array.from({length: PIPS}, () => pips.appendChild(el('i')));
  line.append(name, action, key, pips); root.append(line, note); parent.appendChild(root);
  let shownKey = null;
  return {
    render(cue) {
      const next = cue ? cue.key : null;
      if (next === shownKey) return false;
      shownKey = next;
      if (!cue) { root.hidden = true; return true; }
      root.dataset.kind = cue.kind; root.dataset.state = cue.state;
      name.textContent = cue.name; action.textContent = cue.action;
      key.textContent = cue.control; key.hidden = !cue.control;
      note.textContent = cue.note; note.hidden = !cue.note;
      const p = cue.progress;
      pips.hidden = !p;
      if (p) pipNodes.forEach((n, i) => { n.hidden = i >= p.total; n.className = i < p.done ? 'on' : ''; });
      root.hidden = false;
      return true;
    },
    element: root,
    dispose() { root.remove(); shownKey = null; },
  };
}
