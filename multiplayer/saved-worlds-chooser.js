// Brann's Forge — saved-world chooser (view layer only).
// Lists up to eight browser-local world saves and lets the player pick one, then
// explicitly Resume it or Download its backup. Owns no storage, session or network:
// the caller passes save summaries in and receives the chosen id through callbacks.
// Never writes localStorage, never uses innerHTML, never acts on selection alone.
//
// State machine (pure reducer below, unit-tested in tests/saved-worlds-chooser.test.mjs):
//   loading ─loaded(n>0)→ ready ─select→ ready
//   loading ─loaded(0)──→ empty          ready ─begin(action)→ busy ─finish→ ready
//   any ─storage-error──→ unavailable    busy ─fail(text)→ ready + polite message, selection kept
//   ready ─loaded(list without the selected id)→ ready, newest selected, explanatory message
// Busy ignores further select/begin events, so taps can't start duplicate joins or downloads.

export const MAX_SAVES = 8;
const NAME_MAX = 64;
const FALLBACK_NAME = 'Unnamed world';
// C0/C1 controls become spaces; bidi overrides/isolates are dropped: they can reorder neighbouring UI text.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CHARS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export const TEXT = Object.freeze({
  legend: 'Worlds saved in this browser',
  note: 'Kept on this device only. Resuming opens the world in a new room.',
  latest: 'Latest',
  resume: 'Resume selected',
  download: 'Download backup',
  opening: name => `Opening ${name}…`,
  downloading: name => `Preparing ${name} backup…`,
  empty: 'No worlds saved in this browser yet. Worlds save themselves while you play.',
  unavailable: 'Saved worlds in this browser can’t be read right now. You can still open a world file.',
  vanished: 'The world you picked is no longer saved here, so the newest one is selected instead.',
  resumeFailed: 'That world couldn’t be opened. Try again, or download its backup.',
  downloadFailed: 'The backup couldn’t be downloaded. Try again in a moment.',
});

// ------------------------------------------------------------- pure helpers
export function displayName(value) {
  const text = String(value ?? '').replace(BIDI_CHARS, '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, NAME_MAX).join('') || FALLBACK_NAME;
}

// Accepts WorldSaves.list() output (or bare {id,name,savedAt}); returns safe summaries, newest first.
export function toSummaries(saves) {
  const seen = new Set(), out = [];
  for (const save of Array.isArray(saves) ? saves : []) {
    const id = typeof save?.id === 'string' ? save.id.slice(0, 80) : '';
    if (!id || seen.has(id) || !Number.isFinite(save.savedAt)) continue;
    seen.add(id);
    out.push({id, name: displayName(save.name), savedAt: save.savedAt});
  }
  return out.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVES);
}

export function formatSavedAt(ms, {locale, timeZone, seconds = false} = {}) {
  const when = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(when.getTime())) return 'Unknown time';
  const opts = {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone};
  if (seconds) opts.second = '2-digit';
  try { return new Intl.DateTimeFormat(locale, opts).format(when); }
  catch { return when.toISOString().slice(0, 19).replace('T', ' '); }
}

// Adds the visible timestamp. Entries that would read identically show seconds so they stay distinguishable.
export function labelSummaries(summaries, opts = {}) {
  const minute = summaries.map(s => formatSavedAt(s.savedAt, opts));
  const clash = new Set(minute.filter((text, i) => minute.indexOf(text) !== i));
  return summaries.map((s, i) => ({...s, when: clash.has(minute[i]) ? formatSavedAt(s.savedAt, {...opts, seconds: true}) : minute[i]}));
}

// Backup filename: portable, no path characters, readable when sorted.
export function backupFileName(save) {
  const slug = displayName(save?.name).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/[\s_]+/g, '-').toLowerCase().slice(0, 40) || 'world';
  const d = new Date(save?.savedAt);
  const pad = n => String(n).padStart(2, '0');
  const stamp = Number.isNaN(d.getTime()) ? 'undated' : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `branns-forge-${slug}-${stamp}.json`;
}

export const initialState = Object.freeze({phase: 'loading', saves: [], selectedId: null, busy: null, message: null});

export function reduce(state, event) {
  const busy = state.phase === 'busy';
  switch (event.type) {
    case 'loaded': {
      const saves = toSummaries(event.saves);
      if (!saves.length) return {...state, phase: busy ? 'busy' : 'empty', saves, selectedId: null, message: null};
      const kept = saves.some(s => s.id === state.selectedId);
      const lost = !!state.selectedId && !kept;
      return {...state, phase: busy ? 'busy' : 'ready', saves, selectedId: kept ? state.selectedId : saves[0].id,
        message: lost ? {tone: 'info', text: TEXT.vanished} : state.message?.tone === 'info' ? null : state.message};
    }
    case 'storage-error':
      return {...state, phase: 'unavailable', saves: [], selectedId: null, busy: null, message: null};
    case 'select':
      if (busy || !state.saves.some(s => s.id === event.id)) return state;
      return {...state, selectedId: event.id, message: null};
    case 'begin':
      if (busy || state.phase !== 'ready' || !['resume', 'download'].includes(event.action)) return state;
      return {...state, phase: 'busy', busy: event.action, message: null};
    case 'finish':
      return busy ? {...state, phase: state.saves.length ? 'ready' : 'empty', busy: null} : state;
    case 'fail':
      return {...state, phase: state.saves.length ? 'ready' : 'empty', busy: null,
        message: {tone: 'warn', text: event.text || (state.busy === 'download' ? TEXT.downloadFailed : TEXT.resumeFailed)}};
    default: return state;
  }
}

// Optional helper for the caller's onDownload: the save object from WorldSaves.list() is already the
// portable, credential-free file format, so it is written as-is.
export function downloadSave(save, {doc = globalThis.document, url = globalThis.URL} = {}) {
  const blob = new Blob([JSON.stringify(save)], {type: 'application/json'});
  const href = url.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = href; a.download = backupFileName(save); a.hidden = true;
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => url.revokeObjectURL(href), 1500);
}

// ------------------------------------------------------------- DOM view
let instances = 0;

/**
 * Mount the chooser into `host` (an empty element inside #savedWorlds .saved-body).
 * @param {HTMLElement} host
 * @param {{onResume?: (id:string, summary:object) => (void|Promise<unknown>),
 *          onDownload?: (id:string, summary:object) => (void|Promise<unknown>),
 *          locale?: string, timeZone?: string, showEmpty?: boolean}} options
 * showEmpty=false hides the chooser's own empty/unavailable text when the lobby's #savedSummary already says it.
 * Callbacks may return a promise. A synchronous return or resolved promise ends the busy state for
 * downloads; resume stays busy until the caller calls finish() or fail(), because joining
 * is asynchronous and owned by lobby.js. A throw/rejection becomes a polite retryable message.
 */
export function createSavedWorldsChooser(host, {onResume, onDownload, locale, timeZone, showEmpty = true} = {}) {
  const doc = host.ownerDocument;
  const uid = `sw${++instances}`;
  let state = initialState;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const root = el('div', 'sw');
  const group = el('fieldset', 'sw-group');
  const legend = el('legend', 'sw-legend', TEXT.legend);
  const note = el('p', 'hint sw-note', TEXT.note);
  note.id = `${uid}-note`;
  const list = el('ul', 'sw-list');
  list.setAttribute('role', 'list');
  group.setAttribute('aria-describedby', note.id);
  group.append(legend, note, list);
  const empty = el('p', 'hint sw-empty');
  const message = el('p', 'sw-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const actions = el('div', 'sw-actions');
  const resume = el('button', 'btn btn-secondary sw-resume', TEXT.resume);
  const download = el('button', 'btn btn-quiet sw-download', TEXT.download);
  resume.type = download.type = 'button';
  actions.append(resume, download);
  root.append(empty, group, message, actions);
  host.replaceChildren(root);

  const selected = () => state.saves.find(s => s.id === state.selectedId) || null;

  function render() {
    const {phase, saves} = state;
    root.dataset.state = phase;
    const labelled = labelSummaries(saves, {locale, timeZone});
    // Rebuild rows only when the list itself changes; selection/busy changes only toggle attributes,
    // so a focused radio keeps focus across renders.
    const key = labelled.map(s => `${s.id}\u0000${s.name}\u0000${s.when}`).join('\u0001');
    if (list.dataset.key !== key) {
      const focusedId = doc.activeElement?.closest?.('.sw-row') && list.contains(doc.activeElement) ? doc.activeElement.value : null;
      list.replaceChildren(...labelled.map((s, i) => {
        const item = el('li', 'sw-item');
        const label = el('label', 'sw-row');
        const radio = el('input', 'sw-radio');
        radio.type = 'radio'; radio.name = `${uid}-world`; radio.value = s.id;
        const name = el('span', 'sw-name'); name.append(el('bdi', null, s.name));
        const time = el('time', 'sw-when', s.when);
        time.dateTime = new Date(s.savedAt).toISOString();
        label.append(radio, name, time);
        if (i === 0) label.append(el('span', 'sw-tag', TEXT.latest));
        item.append(label);
        return item;
      }));
      list.dataset.key = key;
      if (focusedId) list.querySelector(`input[value="${CSS.escape(focusedId)}"]`)?.focus({preventScroll: true});
    }
    const isBusy = phase === 'busy';
    for (const radio of list.querySelectorAll('.sw-radio')) {
      radio.checked = radio.value === state.selectedId;
      radio.closest('.sw-row').classList.toggle('is-selected', radio.checked);
      radio.setAttribute('aria-disabled', String(isBusy));
    }
    group.hidden = !saves.length;
    empty.hidden = !showEmpty || !(phase === 'empty' || phase === 'unavailable');
    empty.textContent = phase === 'unavailable' ? TEXT.unavailable : TEXT.empty;
    actions.hidden = !saves.length;
    const pick = selected();
    const whenText = labelled.find(s => s.id === pick?.id)?.when || '';
    // Visible text stays short; the accessible name starts with it (label-in-name) and adds which world.
    resume.setAttribute('aria-label', pick ? `${TEXT.resume}: ${pick.name}, saved ${whenText}` : TEXT.resume);
    download.setAttribute('aria-label', pick ? `${TEXT.download}: ${pick.name}, saved ${whenText}` : TEXT.download);
    for (const button of [resume, download]) {
      // aria-disabled (not disabled) so a keyboard user's focus stays on the button they pressed.
      button.setAttribute('aria-disabled', String(isBusy || !pick));
      button.setAttribute('aria-busy', String(isBusy && state.busy === (button === resume ? 'resume' : 'download')));
    }
    const text = isBusy && pick ? (state.busy === 'resume' ? TEXT.opening(pick.name) : TEXT.downloading(pick.name)) : state.message?.text || '';
    if (message.textContent !== text) message.textContent = text;
    message.dataset.tone = isBusy ? 'busy' : state.message?.tone || '';
    message.hidden = !text;
  }

  function dispatch(event) { const next = reduce(state, event); if (next !== state) { state = next; render(); } return state; }

  async function run(action) {
    const pick = selected(), fn = action === 'resume' ? onResume : onDownload;
    if (!pick || !fn || state.phase === 'busy' || dispatch({type: 'begin', action}).busy !== action) return;
    try {
      await fn(pick.id, pick);
      if (action === 'download' && state.busy === 'download') dispatch({type: 'finish'});
    } catch {
      if (state.busy === action) { dispatch({type: 'fail'}); (action === 'resume' ? resume : download).focus({preventScroll: true}); }
    }
  }

  const onChange = event => {
    const radio = event.target.closest?.('.sw-radio');
    if (!radio) return;
    if (state.phase === 'busy') { render(); return; }   // revert the native check while busy
    dispatch({type: 'select', id: radio.value});
  };
  const onResumeClick = () => run('resume');
  const onDownloadClick = () => run('download');
  list.addEventListener('change', onChange);
  resume.addEventListener('click', onResumeClick);
  download.addEventListener('click', onDownloadClick);
  render();

  return {
    element: root,
    /** Pass WorldSaves.list() output (full saves or {id,name,savedAt} summaries). Keeps a still-present selection. */
    setSaves(saves) { dispatch({type: 'loaded', saves}); },
    /** Local storage could not be read; existing file import still works. */
    setUnavailable() { dispatch({type: 'storage-error'}); },
    /** End a resume/download busy state (for example after the lobby status Cancel or Back). */
    finish() { dispatch({type: 'finish'}); },
    /** End busy with a polite, retryable message. Selection is kept; focus returns to the failed action. */
    fail(text, {focus = true} = {}) {
      const action = state.busy;
      dispatch({type: 'fail', text});
      if (focus) (action === 'download' ? download : resume).focus({preventScroll: true});
    },
    select(id) { dispatch({type: 'select', id}); },
    get selectedId() { return state.selectedId; },
    get state() { return state; },
    /** Put focus back on the selected row, or on Resume after a failed attempt. */
    focus({action = false} = {}) {
      const target = action ? resume : list.querySelector('.sw-radio:checked') || resume;
      if (target.getClientRects().length) target.focus({preventScroll: false});
    },
    dispose() {
      list.removeEventListener('change', onChange);
      resume.removeEventListener('click', onResumeClick);
      download.removeEventListener('click', onDownloadClick);
      root.remove();
    },
  };
}
