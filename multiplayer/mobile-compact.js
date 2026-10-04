// Brann's Forge — compact menu tabs (view layer only).
// Adds a tablist to #menu .menu-card and tags existing children with data-mc-page.
// Never moves, clones or removes existing nodes, so every ID and listener stays intact.
// Owns no gameplay state. Root may tag new menu children with data-mc-page="play|controls|world"
// (and optionally data-mc-col="a|b" for the landscape two-column layout).

const COMPACT_QUERY = '(max-width: 760px), (max-height: 560px)';
const PAGES = [
  { id: 'play', label: 'Play' },
  { id: 'controls', label: 'Input' },
  { id: 'world', label: 'World' },
  { id: 'supplies', label: 'Stock' },
  { id: 'battle', label: 'Battle' },
];
const FIXED = new Set(['resumePlay', 'leave']);

function pageFor(node) {
  if (node.dataset.mcPage) return null; // already tagged (by root or a previous pass)
  if (node.classList.contains('menu-head') || node.classList.contains('mc-tabs') || FIXED.has(node.id)) return null;
  if (node.matches('fieldset.roles')) return ['play', 'a'];
  if (node.querySelector?.('#menuCopyCode')) return ['play', 'b'];
  if (node.id === 'touchSettings') return ['controls', null];
  if (node.id === 'menuControls' || node.id === 'controlsCard') return ['controls', null];
  if (node.querySelector?.('#download')) return ['world', 'a'];
  if (node.id === 'techDetails') return ['world', 'b'];
  return ['play', null]; // unknown future sections stay reachable on the first page
}

export function createMenuTabs({ card = document.querySelector('#menu .menu-card'), query = COMPACT_QUERY } = {}) {
  if (!card) return null;
  const media = window.matchMedia(query);
  let active = 'play';
  const forced = new Map(); // details element -> original open state

  const bar = document.createElement('div');
  bar.className = 'mc-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Menu sections');
  const tabs = PAGES.map(({ id, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mc-tab';
    b.id = `mcTab-${id}`;
    b.dataset.mcTab = id;
    b.setAttribute('role', 'tab');
    b.textContent = label;
    bar.append(b);
    return b;
  });
  const head = card.querySelector(':scope > .menu-head');
  (head ? head.after(bar) : card.prepend(bar));

  function tag() {
    for (const child of card.children) {
      const result = pageFor(child);
      if (!result) continue;
      child.dataset.mcPage = result[0];
      if (result[1]) child.dataset.mcCol = result[1];
    }
  }

  function keepOpen(event) {
    const d = event.currentTarget;
    if (card.dataset.mcTabs === 'on' && !d.open) d.open = true;
  }

  function forceDetails(on) {
    for (const d of card.querySelectorAll(':scope > details.saved, :scope > details.tech')) {
      if (on) {
        if (!forced.has(d)) { forced.set(d, d.open); d.addEventListener('toggle', keepOpen); }
        d.dataset.mcForced = '';
        d.open = true;
      } else if (forced.has(d)) {
        d.removeEventListener('toggle', keepOpen);
        d.open = forced.get(d);
        delete d.dataset.mcForced;
        forced.delete(d);
      }
    }
  }

  function select(id, { focus = false } = {}) {
    active = PAGES.some((p) => p.id === id) ? id : 'play';
    card.dataset.mcActive = active;
    for (const t of tabs) {
      const on = t.dataset.mcTab === active;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
  }

  function apply() {
    const on = media.matches;
    card.dataset.mcTabs = on ? 'on' : 'off';
    bar.hidden = !on;
    tag();
    forceDetails(on);
    select(active);
  }

  function onClick(event) {
    const t = event.target.closest('.mc-tab');
    if (t) select(t.dataset.mcTab);
  }
  function onKey(event) {
    const i = tabs.findIndex((t) => t.dataset.mcTab === active);
    let n = -1;
    if (event.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') n = 0;
    else if (event.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    event.preventDefault();
    select(tabs[n].dataset.mcTab, { focus: true });
  }
  // When the shared How-to card is moved into the menu, show it on Controls; new root sections get tagged.
  const observer = new MutationObserver((records) => {
    tag();
    if (card.dataset.mcTabs === 'on') forceDetails(true);
    for (const r of records) for (const n of r.addedNodes) {
      if (n.id === 'controlsCard' && card.dataset.mcTabs === 'on') select('controls');
    }
  });

  bar.addEventListener('click', onClick);
  bar.addEventListener('keydown', onKey);
  media.addEventListener('change', apply);
  observer.observe(card, { childList: true });
  apply();

  return {
    select,
    get active() { return active; },
    refresh: apply,
    destroy() {
      observer.disconnect();
      media.removeEventListener('change', apply);
      bar.removeEventListener('click', onClick);
      bar.removeEventListener('keydown', onKey);
      forceDetails(false);
      for (const child of card.children) { delete child.dataset.mcPage; delete child.dataset.mcCol; }
      delete card.dataset.mcTabs; delete card.dataset.mcActive;
      bar.remove();
    },
  };
}
