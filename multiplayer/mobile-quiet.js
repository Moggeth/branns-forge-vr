// Brann's Forge — quiet mobile in-game HUD (view layer only).
// mountQuietHud() -> { close(), dispose() }
// Never moves, clones or rebuilds existing HUD nodes: every ID and gameplay listener stays intact.
// It adds four small nodes once (More button, tray close-scrim, spell/weapon palette toggles' labels)
// and drives body[data-mq-tray] = '' | 'tools' | 'spells' | 'weapons' | 'actions'.
// All styling is scoped to body.touch-controls-active in mobile-quiet.css; desktop is untouched.

const TRAYS = new Set(['tools', 'spells', 'weapons']);
const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="mui-icon"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>';

export function mountQuietHud({ doc = document } = {}) {
  const body = doc.body;
  const hud = doc.getElementById('hud');
  const room = hud?.querySelector('.hud-room');
  const spells = doc.querySelector('#godHelp .bf-spells');
  const equip = doc.querySelector('#heroTools .bf-equip');
  const actionsDrawer = doc.querySelector('#heroTools .bf-actions-drawer');
  const hpText = doc.getElementById('hpText');
  if (!hud || !body) return null;
  const off = [];
  const on = (el, type, fn, opts) => { if (!el) return; el.addEventListener(type, fn, opts); off.push(() => el.removeEventListener(type, fn, opts)); };
  const active = () => body.classList.contains('touch-controls-active');

  // ---- stylesheet goes last in <head>, after Vite-injected styles and after #compactStyles (moved by lobby.js).
  // index.html should declare <link id="quietStyles" href="./mobile-quiet.css"> (Vite bundles it like #compactStyles).
  const link = doc.getElementById('quietStyles');
  // Vite merges link styles into its hashed CSS bundle in production. Only
  // reorder the development link; never request a missing source stylesheet.
  if(link) doc.head.append(link);
  // Specificity anchor: every rule is ":root[data-mq] body.touch-controls-active ...", which ties or beats
  // the layered mobile-compact.css role overrides, and wins ties by loading last.
  doc.documentElement.dataset.mq = 'on';

  // ---- tools tray: .hud-room itself becomes the drawer (copy code/invite, switch role, help, party, world code).
  if (room) {
    room.id ||= 'mqTools';
    room.setAttribute('aria-label', 'World tools');
  }
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'mui-btn mui-util mq-more';
  more.setAttribute('aria-label', 'World tools: invite, role, help, party');
  more.setAttribute('aria-expanded', 'false');
  if (room) more.setAttribute('aria-controls', room.id);
  more.innerHTML = MORE_ICON;

  // The More button lives with the persistent top-right controls. #touchControls is created by
  // createMobileUI before this mounts; fall back to the HUD top bar if not.
  const utilBar = doc.querySelector('#touchControls .mui-util-bar');
  (utilBar || hud.querySelector('.hud-top') || hud).append(more);

  // ---- scrim: catches the first tap outside an open tray so it never becomes a cast/swing.
  const scrim = doc.createElement('div');
  scrim.className = 'mq-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  hud.prepend(scrim);

  // ---- palette toggles get explicit accessible state (selected cell doubles as the opener).
  // Radios/toggles can't carry aria-expanded, so the containers describe the disclosure instead.
  spells?.setAttribute('data-mq-palette', 'spells');
  equip?.setAttribute('data-mq-palette', 'weapons');
  const describe = (el, text) => { if (!el) return; const old = el.getAttribute('aria-description'); el.setAttribute('aria-description', text); off.push(() => (old == null ? el.removeAttribute('aria-description') : el.setAttribute('aria-description', old))); };
  describe(spells, 'On touch, tap the current spell to show all spells');
  describe(equip, 'On touch, tap the current weapon to show all weapons');

  const quickActions=doc.querySelector('.ta-quick'), quickHome=quickActions?.parentElement;
  const actionsBody=actionsDrawer?.querySelector('.bf-actions');
  function dockQuickActions(){if(!quickActions)return;const parent=active()?actionsBody:quickHome;if(parent&&quickActions.parentElement!==parent)parent.append(quickActions);}
  dockQuickActions();
  let tray = '';
  function set(next) {
    next = TRAYS.has(next) && active() ? next : '';
    if (next !== 'actions' && actionsDrawer?.open && next) actionsDrawer.open = false;
    if (next === tray) return;
    tray = next;
    if (tray) body.dataset.mqTray = tray; else delete body.dataset.mqTray;
    more.setAttribute('aria-expanded', String(tray === 'tools'));
    spells?.setAttribute('data-mq-open', String(tray === 'spells'));
    equip?.setAttribute('data-mq-open', String(tray === 'weapons'));
  }
  function close() {
    set('');
    if (actionsDrawer?.open) actionsDrawer.open = false;
    for (const d of hud.querySelectorAll('#godHelp details.bf-help[open], #heroTools details.bf-help[open]')) d.open = false;
  }
  const toggle = (name) => set(tray === name ? '' : name);

  on(more, 'click', (e) => { e.stopPropagation(); toggle('tools'); });
  on(scrim, 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); close(); });

  // Spell cells: when collapsed only the selected cell is visible; tapping it opens the palette.
  // Choosing any spell (lobby.js listener runs too, unchanged) closes it. Capture phase so we read
  // the pre-click state; we never stop propagation.
  on(spells, 'click', (e) => {
    if (!active()) return;
    const btn = e.target.closest('[data-spell]');
    if (!btn) return;
    const wasSelected = btn.getAttribute('aria-checked') === 'true';
    if (tray !== 'spells' && wasSelected) set('spells');
    else set('');
  }, true);
  on(equip, 'click', (e) => {
    if (!active()) return;
    const btn = e.target.closest('[data-equip]');
    if (!btn) return;
    const shown = btn.getAttribute('aria-pressed') === 'true' || !equip.querySelector('[aria-pressed="true"]');
    if (tray !== 'weapons' && shown) set('weapons');
    else set('');
  }, true);
  // Keyboard/switch users on a touch device: focusing a cell opens its palette so arrow keys never land on hidden cells.
  on(spells, 'focusin', (e) => { if (active() && e.target.matches?.(':focus-visible')) set('spells'); });
  on(equip, 'focusin', (e) => { if (active() && e.target.matches?.(':focus-visible')) set('weapons'); });
  // Actions <details> is its own disclosure; opening it closes the other trays.
  on(actionsDrawer, 'toggle', () => { if (actionsDrawer.open) set(''); });
  // Any action inside the open drawer returns to the world.
  on(actionsDrawer?.querySelector('.bf-actions'), 'click', (e) => { if (active() && e.target.closest('button')) actionsDrawer.open = false; });
  // Tools: any button press in the drawer (copy, role switch, help, party) closes it.
  on(room, 'click', (e) => { if (active() && tray === 'tools' && e.target.closest('button')) setTimeout(() => set(''), 0); });
  on(doc, 'keydown', (e) => { if (e.key === 'Escape' && tray) { close(); } });

  // ---- God HP: hide the bar while healthy. Observes the one text node lobby.js already writes.
  function syncHp() {
    const m = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(hpText?.textContent || '');
    const full = !!m && Number(m[1]) >= Number(m[2]);
    if (full) body.dataset.mqHpFull = ''; else delete body.dataset.mqHpFull;
  }
  const hpObs = hpText ? new MutationObserver(syncHp) : null;
  hpObs?.observe(hpText, { childList: true, characterData: true, subtree: true });
  syncHp();

  // ---- leaving touch mode, opening the menu or a field overlay closes trays.
  const bodyObs = new MutationObserver(() => {
    dockQuickActions();
    if (!active() || body.classList.contains('field-overlay-open') || body.dataset.phase !== 'game') close();
  });
  bodyObs.observe(body, { attributes: true, attributeFilter: ['class', 'data-phase'] });
  const menu = doc.getElementById('menu');
  const menuObs = menu ? new MutationObserver(() => { if (!menu.hidden) close(); }) : null;
  menuObs?.observe(menu, { attributes: true, attributeFilter: ['hidden'] });

  return {
    close,
    get tray() { return tray; },
    dispose() {
      off.splice(0).forEach((f) => f());
      hpObs?.disconnect(); bodyObs.disconnect(); menuObs?.disconnect();
      close();
      if(quickActions&&quickHome)quickHome.append(quickActions);
      delete body.dataset.mqHpFull;
      spells?.removeAttribute('data-mq-palette'); spells?.removeAttribute('data-mq-open');
      equip?.removeAttribute('data-mq-palette'); equip?.removeAttribute('data-mq-open');
      more.remove(); scrim.remove();
      delete doc.documentElement.dataset.mq;
    },
  };
}
