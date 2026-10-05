// Placement tooltip: what you are building, how to place, rotate and cancel, and why a spot is refused.
// DOM only. Touch shows real Place / Rotate / Cancel buttons; desktop shows key hints. Hidden in VR.
import './build-blueprint-hud.css';

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ICON = {
  place: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V9h-4.5"/>',
  cancel: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[n]}</svg>`;

/**
 * createBlueprintHud({parent, onPlace, onRotate, onCancel}) -> {set(state|null), element, dispose()}
 * state: {name, mode:'desktop'|'touch', valid, reason, operate, cursor}
 */
export function createBlueprintHud({parent = document.body, onPlace = () => {}, onRotate = () => {}, onCancel = () => {}} = {}) {
  const root = document.createElement('div');
  root.className = 'bp-hud'; root.hidden = true; root.setAttribute('role', 'status');
  parent.appendChild(root);
  let last = '';
  const press = e => {
    const b = e.target.closest?.('[data-bp]'); if (!b || !root.contains(b)) return;
    // Buttons sit over the world canvas: never let the press fall through to looking, swinging or casting.
    e.preventDefault(); e.stopPropagation();
    if (e.type !== 'pointerup' && e.type !== 'click') return;
    if (e.type === 'click' && e.detail !== 0) return; // pointerup already acted; keyboard clicks (detail 0) still work
    ({place: onPlace, rotate: onRotate, cancel: onCancel})[b.dataset.bp]?.();
  };
  for (const name of ['pointerdown', 'pointerup', 'click']) root.addEventListener(name, press);

  function set(state) {
    if (!state) { if (!root.hidden) { root.hidden = true; last = ''; } return; }
    const {name = 'Building', mode = 'desktop', valid = true, reason = '', operate = false, cursor = false} = state;
    const key = `${name}|${mode}|${valid}|${reason}|${operate}|${cursor}`;
    root.hidden = false;
    if (key === last) return;
    last = key; root.dataset.mode = mode; root.classList.toggle('bp-bad', !valid);
    const title = operate ? `Aiming ${esc(name)}` : `Placing ${esc(name)}`;
    const why = !valid && reason ? `<p class="bp-why">${esc(reason)}</p>` : '';
    if (mode === 'touch') {
      root.innerHTML = `${why}<div class="bp-bar"><span class="bp-title">${title}<small>${operate ? 'Tap a target' : 'Drag to look · tap ground to move it'}</small></span>
        <button type="button" class="bp-btn bp-go" data-bp="place"${valid ? '' : ' aria-disabled="true"'}>${icon('place')}<span>${operate ? 'Fire' : 'Place'}</span></button>
        ${operate ? '' : `<button type="button" class="bp-btn" data-bp="rotate">${icon('rotate')}<span>Rotate</span></button>`}
        <button type="button" class="bp-btn bp-no" data-bp="cancel">${icon('cancel')}<span>Cancel</span></button></div>`;
    } else {
      const click = cursor ? 'Click' : 'Left-click';
      root.innerHTML = `${why}<div class="bp-bar"><span class="bp-title">${title}</span>
        <span class="bp-keys"><span><kbd>${click}</kbd> ${operate ? 'Fire' : 'Place'}</span>
        ${operate ? '' : '<span><kbd>R</kbd> / <kbd>Wheel</kbd> Rotate</span>'}
        <span><kbd>Right-click</kbd> / <kbd>Esc</kbd> Cancel</span>
        ${operate ? '' : '<span class="bp-soft"><kbd>Shift</kbd> keep building</span>'}</span></div>`;
    }
  }
  return {
    set, element: root,
    dispose() { for (const name of ['pointerdown', 'pointerup', 'click']) root.removeEventListener(name, press); root.remove(); },
  };
}
