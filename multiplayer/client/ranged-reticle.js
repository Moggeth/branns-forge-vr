// Screen-space DOM reticle for flat first-person and touch. Zero WebGL draws.
// Hidden whenever role !== 'hero', a menu is open, or renderer.xr.isPresenting
// (VR keeps the physical weapon/guide only, so no doubled fixed-screen reticle).
export const RETICLE_TOOLS = Object.freeze({crossbow: 'siegebird', bow: 'emberwing', wyrmspout: 'wyrmspout', flask: 'emberdew', stormreel: 'stormreel'});

const SVG = {
  siegebird: '<path class="rr-s" d="M-11-7v-4h4M7-11h4v4M11 7v4H7M-7 11h-4V7"/><circle class="rr-f" r="1.3"/>',
  emberwing: '<g class="rr-feather"><path class="rr-s" d="M-13 0l-5-3.5M-13 0l-5 3.5M-13 0h-3"/></g><g class="rr-feather rr-r"><path class="rr-s" d="M13 0l5-3.5M13 0l5 3.5M13 0h3"/></g><path class="rr-s rr-thin" d="M0-4v-3M0 4v3"/><circle class="rr-f" r="1.1"/>',
  wyrmspout: '<path class="rr-s" d="M-6 9L-15 19M6 9l9 10"/><path class="rr-s rr-thin" d="M-9 13q9 4 18 0"/><circle class="rr-f" r="1.2"/>',
  emberdew: '<circle class="rr-f" r="2"/><circle class="rr-s rr-thin" r="5.5"/>',
  stormreel: '<path class="rr-s" d="M-12-3l3 3-3 3M12-3l-3 3 3 3"/><path class="rr-s rr-thin" d="M1-8l-3 6h4l-3 6"/><circle class="rr-f" r="1.1"/>',
};

export function createRangedReticle({parent = globalThis.document?.body} = {}) {
  const root = document.createElement('div');
  root.className = 'rr-root'; root.setAttribute('aria-hidden', 'true'); root.hidden = true;
  root.innerHTML = '<svg class="rr-svg" viewBox="-24 -24 48 48"></svg>';
  parent.appendChild(root);
  const svg = root.firstChild; let style = null, last = '';
  // input: {tool, role, menuOpen, presenting, drawing, draw, curved, recoil, firing}
  function set({tool, role = 'hero', menuOpen = false, presenting = false, drawing = false, draw = 0, curved = false, recoil = 0, firing = false} = {}) {
    const next = role === 'hero' && !menuOpen && !presenting ? RETICLE_TOOLS[tool] || null : null;
    root.hidden = !next;
    if (!next) return null;
    if (next !== style) { style = next; svg.innerHTML = SVG[next]; root.dataset.weapon = next; }
    // Feathers close in as the draw builds; brackets kick on recoil.
    const key = `${drawing ? 1 : 0}${curved ? 1 : 0}${firing ? 1 : 0}${draw.toFixed(2)}${recoil.toFixed(2)}`;
    if (key !== last) {
      last = key;
      root.style.setProperty('--rr-draw', drawing ? draw.toFixed(3) : '0');
      root.style.setProperty('--rr-recoil', recoil.toFixed(3));
      root.classList.toggle('rr-drawing', !!drawing); root.classList.toggle('rr-curved', !!curved); root.classList.toggle('rr-firing', !!firing);
    }
    return next;
  }
  function dispose() { root.remove(); }
  return {element: root, set, dispose};
}
