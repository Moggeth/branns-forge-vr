// Brann's Forge — public world browser (view layer only).
// Owns no networking, timers or session state. The root module fetches rooms,
// calls render() (e.g. every 15 s or after Refresh/More), and handles callbacks.
// Every server/player string is written with textContent; nothing is parsed as HTML.
// Rows are keyed by room code and reused across renders so focus, expanded
// participant lists and scroll position survive periodic refreshes.

export const PUBLIC_NOTICE = 'Multiplayer worlds are public. Anyone can join.';
const MAX_PLAYERS = 32;
const STATUS_TEXT = Object.freeze({playing: 'Playing', waiting: 'Waiting for host', full: 'Full'});
const ROLE_TEXT = Object.freeze({hero: 'Hero', god: 'God', host: 'Host'});

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// Pure: sanitise one row from the root into what the view draws. Exported for tests.
export function normalizeRoom(row) {
  if (!row || typeof row !== 'object') return null;
  const code = String(row.code ?? '').replace(/\D/g, '').slice(0, 8);
  if (code.length !== 8) return null;
  const maxPlayers = int(row.maxPlayers, 1, MAX_PLAYERS, MAX_PLAYERS);
  const players = (Array.isArray(row.players) ? row.players : []).slice(0, MAX_PLAYERS).map(p => {
    const roleKey = clip(p?.role, 16).toLowerCase();
    return {name: clip(p?.name, 24) || 'Unnamed', role: ROLE_TEXT[roleKey] || (roleKey ? roleKey.replace(/^\w/, c => c.toUpperCase()) : '')};
  });
  const count = int(row.count ?? players.length, 0, MAX_PLAYERS, players.length);
  let status = clip(row.status, 16).toLowerCase();
  if (count >= maxPlayers) status = 'full';
  else if (!STATUS_TEXT[status]) status = count > 0 ? 'playing' : 'waiting';
  return {
    code, hostName: clip(row.hostName, 24) || 'Unnamed host', players, count, maxPlayers, status,
    joinable: row.joinable !== false && status !== 'full',
  };
}

export const formatCode = code => `${code.slice(0, 4)} ${code.slice(4)}`;

// Optional launcher the root can place beside "Create world". Uses existing .btn styles.
export function createPublicRoomsLauncher({doc = document, onOpen} = {}) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary bf-pr-launch';
  button.textContent = 'Browse public worlds';
  button.addEventListener('click', () => onOpen?.(button));
  return button;
}

export function createPublicRoomBrowser({onJoin, onCreate, onRefresh, onMore, onClose, doc = document, mount} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
  const setAttr = (n, k, v) => { if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
  let uid = 0; const id = p => `bf-pr-${p}-${++uid}-${Math.random().toString(36).slice(2, 6)}`;

  // ---- static shell (built once)
  const dialog = el('dialog', 'bf-pr');
  const titleId = id('title'), noticeId = id('notice');
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('aria-describedby', noticeId);

  const head = el('header', 'bf-pr-head');
  const title = el('h2', 'bf-pr-title', 'Public worlds'); title.id = titleId;
  const closeBtn = btn('bf-pr-close', '×'); closeBtn.setAttribute('aria-label', 'Close public worlds');
  const notice = el('p', 'bf-pr-notice', PUBLIC_NOTICE); notice.id = noticeId;
  const sub = el('p', 'bf-pr-sub', 'Solo play stays offline and never appears here.');
  const titleRow = el('div', 'bf-pr-titlerow'); titleRow.append(title, closeBtn);
  head.append(titleRow, notice, sub);

  const body = el('div', 'bf-pr-body');
  const live = el('div', 'bf-pr-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  const errorBox = el('div', 'bf-pr-error'); errorBox.hidden = true; errorBox.setAttribute('role', 'alert');
  const errorText = el('p', 'bf-pr-error-text');
  const retryBtn = btn('btn btn-quiet bf-pr-retry', 'Try again');
  errorBox.append(errorText, retryBtn);
  const placeholder = el('div', 'bf-pr-placeholder'); placeholder.hidden = true;
  const placeholderText = el('p', 'bf-pr-placeholder-text');
  const emptyCreate = btn('btn btn-secondary bf-pr-empty-create', 'Create world');
  placeholder.append(placeholderText, emptyCreate);
  const list = el('ul', 'bf-pr-list'); list.setAttribute('aria-label', 'Online public worlds');
  const moreBtn = btn('btn btn-quiet bf-pr-more', 'Show more worlds'); moreBtn.hidden = true;
  body.append(errorBox, placeholder, list, moreBtn);

  const foot = el('footer', 'bf-pr-foot');
  const refreshBtn = btn('btn btn-quiet bf-pr-refresh', 'Refresh');
  const createBtn = btn('btn btn-primary bf-pr-create', 'Create world');
  foot.append(live, refreshBtn, createBtn);

  dialog.append(head, body, foot);
  (mount || doc.body).append(dialog);

  // ---- state
  const rows = new Map();       // code -> {li, refs, data}
  const expanded = new Set();   // codes whose participant list is open
  let state = {rooms: [], loading: false, error: '', nextCursor: null, pendingCode: null};
  let returnFocus = null, open = false;

  function makeRow(code) {
    const li = el('li', 'bf-pr-row'); li.dataset.code = code;
    const main = el('div', 'bf-pr-main');
    const host = el('p', 'bf-pr-host');
    const meta = el('p', 'bf-pr-meta');
    const codeEl = el('span', 'bf-pr-code', formatCode(code)); codeEl.setAttribute('aria-label', `World code ${code.split('').join(' ')}`);
    const count = el('span', 'bf-pr-count');
    const status = el('span', 'bf-pr-status');
    meta.append(codeEl, count, status);
    main.append(host, meta);
    const join = btn('btn btn-secondary bf-pr-join', 'Join');
    const listId = id('people');
    const toggle = btn('bf-pr-toggle');
    toggle.setAttribute('aria-controls', listId);
    const people = el('ul', 'bf-pr-people'); people.id = listId;
    li.append(main, join, toggle, people);
    join.addEventListener('click', () => {
      const r = rows.get(code);
      if (!r || join.getAttribute('aria-disabled') === 'true') return;
      onJoin?.(code, r.data);
    });
    toggle.addEventListener('click', () => {
      if (expanded.has(code)) expanded.delete(code); else expanded.add(code);
      paintPeople(rows.get(code));
    });
    return {li, data: null, peopleKey: '', refs: {host, codeEl, count, status, join, toggle, people}};
  }

  function paintPeople(r) {
    const {toggle, people} = r.refs, d = r.data, isOpen = expanded.has(d.code);
    setAttr(toggle, 'aria-expanded', String(isOpen));
    setText(toggle, `${isOpen ? 'Hide' : 'Show'} players (${d.players.length})`);
    toggle.hidden = d.players.length === 0;
    people.hidden = !isOpen || d.players.length === 0;
    const key = JSON.stringify(d.players);
    if (key === r.peopleKey) return;
    r.peopleKey = key;
    people.replaceChildren(...d.players.map(p => {
      const item = el('li', 'bf-pr-person');
      item.append(el('span', 'bf-pr-person-name', p.name));
      if (p.role) item.append(el('span', 'bf-pr-person-role', p.role));
      return item;
    }));
  }

  function paintRow(r, d) {
    r.data = d;
    const {host, count, status, join} = r.refs;
    const pending = state.pendingCode === d.code, busy = !!state.pendingCode;
    setText(host, d.hostName);
    setText(count, `${d.count}/${d.maxPlayers}`);
    setAttr(count, 'aria-label', `${d.count} of ${d.maxPlayers} players`);
    setText(status, STATUS_TEXT[d.status]);
    r.li.dataset.status = d.status;
    setText(join, pending ? 'Joining…' : d.status === 'full' ? 'Full' : 'Join');
    const blocked = !d.joinable || busy;
    setAttr(join, 'aria-disabled', String(blocked));   // aria-disabled keeps focus in place on refresh
    setAttr(join, 'aria-label', pending ? `Joining ${d.hostName}'s world` : `Join ${d.hostName}'s world, ${d.count} of ${d.maxPlayers} players`);
    r.li.classList.toggle('is-pending', pending);
    paintPeople(r);
  }

  function render(next = {}) {
    state = {...state, ...next};
    const focused = dialog.contains(doc.activeElement) ? doc.activeElement : null;
    const seen = new Set(), ordered = [];
    for (const raw of Array.isArray(state.rooms) ? state.rooms : []) {
      const d = normalizeRoom(raw);
      if (!d || seen.has(d.code)) continue;
      seen.add(d.code);
      let r = rows.get(d.code);
      if (!r) { r = makeRow(d.code); rows.set(d.code, r); }
      paintRow(r, d);
      ordered.push(r.li);
    }
    let lostFocus = false;
    for (const [code, r] of rows) if (!seen.has(code)) {
      if (focused && r.li.contains(focused)) lostFocus = true;
      r.li.remove(); rows.delete(code); expanded.delete(code);
    }
    ordered.forEach((li, i) => { if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null); });
    if (focused && focused.isConnected && doc.activeElement !== focused) focused.focus({preventScroll: true});
    else if (lostFocus) refreshBtn.focus({preventScroll: true});

    const hasRooms = ordered.length > 0, error = clip(state.error, 200), loading = !!state.loading;
    list.hidden = !hasRooms;
    setAttr(body, 'aria-busy', String(loading));
    errorBox.hidden = !error;
    setText(errorText, error ? (hasRooms ? `${error} Showing the last list we received.` : error) : '');
    setAttr(retryBtn, 'aria-disabled', String(loading));
    placeholder.hidden = hasRooms || !!error;
    setText(placeholderText, loading ? 'Looking for public worlds…' : 'No public worlds are open right now. Start one and friends can find it here.');
    emptyCreate.hidden = loading;
    placeholder.dataset.loading = String(loading);
    moreBtn.hidden = !state.nextCursor || !hasRooms;
    setText(moreBtn, loading && state.nextCursor ? 'Loading…' : 'Show more worlds');
    setAttr(moreBtn, 'aria-disabled', String(loading));
    setText(refreshBtn, loading ? 'Refreshing…' : 'Refresh');
    setAttr(refreshBtn, 'aria-disabled', String(loading));
    setAttr(createBtn, 'aria-disabled', String(!!state.pendingCode));
    setAttr(emptyCreate, 'aria-disabled', String(!!state.pendingCode));
    setText(live, state.pendingCode ? `Joining world ${formatCode(String(state.pendingCode))}…`
      : loading ? 'Loading worlds…' : hasRooms ? `${ordered.length} public world${ordered.length === 1 ? '' : 's'} online` : '');
  }

  // ---- events
  const guard = fn => e => { if (e.currentTarget.getAttribute('aria-disabled') === 'true') return; fn(e); };
  const handlers = [
    [closeBtn, 'click', () => close()],
    [retryBtn, 'click', guard(() => onRefresh?.())],
    [refreshBtn, 'click', guard(() => onRefresh?.())],
    [moreBtn, 'click', guard(() => onMore?.(state.nextCursor))],
    [createBtn, 'click', guard(() => onCreate?.())],
    [emptyCreate, 'click', guard(() => onCreate?.())],
    [dialog, 'cancel', e => { e.preventDefault(); close(); }],          // Escape
    [dialog, 'click', e => { if (e.target === dialog) close(); }],      // backdrop tap
    [dialog, 'keydown', e => {                                          // trap for non-modal fallback
      if (e.key === 'Escape' && !dialog.matches(':modal')) { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter(n => !n.hidden && n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }],
  ];
  for (const [n, t, f] of handlers) n.addEventListener(t, f);

  function openDialog(trigger) {
    if (open) return;
    returnFocus = trigger || doc.activeElement;
    open = true;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    render();
    (list.querySelector('.bf-pr-join:not([aria-disabled="true"])') || refreshBtn).focus();
  }
  function close() {
    if (!open) return;
    open = false;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open');
    const back = returnFocus; returnFocus = null;
    if (back?.isConnected) back.focus?.();
    onClose?.();
  }
  function dispose() {
    if (open) { open = false; if (dialog.open) dialog.close?.(); }
    for (const [n, t, f] of handlers) n.removeEventListener(t, f);
    rows.clear(); expanded.clear();
    dialog.remove();
  }

  render();
  return {open: openDialog, close, render, dispose, get isOpen() { return open; }};
}
