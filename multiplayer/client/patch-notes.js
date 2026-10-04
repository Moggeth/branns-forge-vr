// Patch notes: parses the player-facing entries in multiplayer/patch-notes/, groups them
// into numbered patches, and shows them in a modal panel plus a one-time "What's new" toast.
// Pure parsing/grouping (parsePatchNote, groupPatches, unseenEntries) needs no DOM so
// tests/patch-notes.mjs can check every entry under Node.
//
// Entry file: patch-notes/YYYY-MM-DD-slug.md
//   ---
//   date: 2026-10-04 14:50        (Sydney time; the time is optional)
//   area: Weapons                 (one of AREAS)
//   title: Timberline, round two
//   pr: 21                        (optional, never shown)
//   patch: 2026-10-04b            (optional group key; default is the date)
//   headline: Living Steel        (optional; names the patch this entry belongs to)
//   ---
//   - Bullet. "  - " nests one level. **bold** works.
//   > Developer's note paragraph.

export const AREAS = ['Heroes', 'God', 'Weapons', 'Creatures', 'World', 'Building', 'Interface', 'Multiplayer', 'Phones', 'VR', 'Performance', 'Bug fixes', 'Behind the scenes'];
export const SEEN_KEY = 'brann.patchNotes.seen';

const FILE_RE = /(?:^|\/)(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2}))?$/;

export function entryId(path) {
  const m = FILE_RE.exec(path);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Returns {id, date, time, sort, area, title, pr, patch, headline, blocks}. Throws on a malformed entry.
export function parsePatchNote(path, text) {
  const id = entryId(path);
  if (!id) throw new Error(`${path}: name must be YYYY-MM-DD-slug.md (lowercase slug)`);
  const src = String(text).replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!fm) throw new Error(`${path}: missing --- front matter ---`);
  const meta = {};
  for (const line of fm[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${path}: bad front matter line "${line}"`);
    meta[kv[1]] = kv[2].trim();
  }
  const dm = DATE_RE.exec(meta.date || '');
  if (!dm) throw new Error(`${path}: date must be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"`);
  if (dm[1] !== id.slice(0, 10)) throw new Error(`${path}: date ${dm[1]} does not match the file name`);
  if (!AREAS.includes(meta.area)) throw new Error(`${path}: area must be one of ${AREAS.join(', ')}`);
  if (!meta.title) throw new Error(`${path}: title is required`);
  const blocks = parseBody(src.slice(fm[0].length));
  if (!blocks.some(b => b.type === 'list')) throw new Error(`${path}: needs at least one "- " bullet`);
  const time = dm[2] ? `${dm[2]}:${dm[3]}` : '';
  return {
    id, date: dm[1], time, sort: `${dm[1]} ${time || '00:00'} ${id}`,
    area: meta.area, title: meta.title, pr: meta.pr ? Number(meta.pr) : null,
    patch: meta.patch || dm[1], headline: meta.headline || '', blocks,
  };
}

// Blocks: {type:'list', items:[{text, children:[text]}]} | {type:'note', text} | {type:'p', text}
function parseBody(body) {
  const blocks = [];
  let list = null, para = null;
  const end = () => { list = null; para = null; };
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { end(); continue; }
    const top = /^- (.*)$/.exec(line);
    const sub = /^ {2,4}- (.*)$/.exec(line);
    const note = /^> ?(.*)$/.exec(line);
    if (top) {
      if (!list) { list = {type: 'list', items: []}; blocks.push(list); para = null; }
      list.items.push({text: top[1], children: []});
    } else if (sub && list) {
      list.items.at(-1).children.push(sub[1]);
    } else if (note) {
      const last = blocks.at(-1);
      if (last?.type === 'note' && !list && para === last) last.text += ` ${note[1]}`;
      else { para = {type: 'note', text: note[1]}; blocks.push(para); list = null; }
    } else if (list && /^ {2,}\S/.test(line)) {
      const item = list.items.at(-1);
      if (item.children.length) item.children[item.children.length - 1] += ` ${line.trim()}`;
      else item.text += ` ${line.trim()}`;
    } else if (para?.type === 'p') {
      para.text += ` ${line.trim()}`;
    } else {
      para = {type: 'p', text: line.trim()}; blocks.push(para); list = null;
    }
  }
  return blocks;
}

// Groups entries into patches, oldest numbered 0.1. Returns newest first:
// [{key, version, headline, from, to, entries(newest first), newest}]
export function groupPatches(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.patch)) map.set(e.patch, []);
    map.get(e.patch).push(e);
  }
  const patches = [...map.entries()].map(([key, list]) => {
    list.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
    const dates = list.map(e => e.date).sort();
    const headline = [...list].reverse().find(e => e.headline)?.headline || '';
    return {key, headline, from: dates[0], to: dates.at(-1), entries: list, newest: list[0].sort, oldest: list.at(-1).sort};
  });
  patches.sort((a, b) => (a.oldest < b.oldest ? -1 : a.oldest > b.oldest ? 1 : 0));
  patches.forEach((p, i) => { p.version = `0.${i + 1}`; });
  return patches.reverse();
}

// Entries the player has not seen. With no record at all, only the newest patch counts as new.
export function unseenEntries(patches, seenIds) {
  if (!patches.length) return [];
  if (!seenIds) return patches[0].entries;
  const seen = new Set(seenIds);
  return patches.flatMap(p => p.entries).filter(e => !seen.has(e.id));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function formatDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}
export function formatRange(from, to) {
  if (from === to) return formatDate(from);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return `${fd}–${formatDate(to)}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${formatDate(to)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

// ------------------------------------------------------------------ DOM

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Inline markup: **bold** only. Everything else is text, so entries cannot inject HTML.
function inline(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(el('strong', null, part.slice(2, -2)));
    else frag.append(document.createTextNode(part));
  }
  return frag;
}

function renderBlocks(blocks) {
  const out = document.createDocumentFragment();
  for (const b of blocks) {
    if (b.type === 'list') {
      const ul = el('ul', 'pn-list');
      for (const item of b.items) {
        const li = el('li');
        li.append(inline(item.text));
        if (item.children.length) {
          const sub = el('ul', 'pn-list pn-sub');
          for (const c of item.children) { const sli = el('li'); sli.append(inline(c)); sub.append(sli); }
          li.append(sub);
        }
        ul.append(li);
      }
      out.append(ul);
    } else if (b.type === 'note') {
      const p = el('p', 'pn-devnote');
      p.append(el('span', 'pn-devnote-label', 'Developer’s note '));
      p.append(inline(b.text));
      out.append(p);
    } else {
      const p = el('p', 'pn-p');
      p.append(inline(b.text));
      out.append(p);
    }
  }
  return out;
}

function areaSlug(area) { return area.toLowerCase().replace(/[^a-z]+/g, '-'); }

function readSeen(storage) {
  try { const raw = storage?.getItem(SEEN_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeSeen(storage, ids) {
  try { storage?.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* private mode: the toast simply shows again */ }
}

// entries: parsed entries. mount: where the panel and toast live. Returns {open, close, showWhatsNew, patches}.
export function createPatchNotes({entries, mount = document.body, storage = globalThis.localStorage, onOpen, onClose} = {}) {
  const patches = groupPatches(entries);
  const allIds = patches.flatMap(p => p.entries.map(e => e.id));
  let returnFocus = null;

  const backdrop = el('div', 'pn-backdrop');
  backdrop.hidden = true;
  const dialog = el('section', 'pn-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'pnTitle');
  dialog.tabIndex = -1;
  const head = el('header', 'pn-head');
  const titleWrap = el('div', 'pn-head-text');
  const title = el('h2', 'pn-title', 'Patch Notes');
  title.id = 'pnTitle';
  titleWrap.append(title, el('p', 'pn-lede', 'Everything that has changed in Brann’s Forge, newest first.'));
  const close = el('button', 'btn btn-quiet pn-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close patch notes');
  head.append(titleWrap, close);
  const scroller = el('div', 'pn-scroll');
  dialog.append(head, scroller);
  backdrop.append(dialog);
  mount.append(backdrop);

  let rendered = false;
  function render() {
    if (rendered) return;
    rendered = true;
    patches.forEach((p, i) => {
      const box = el('details', 'pn-patch');
      box.open = i === 0;
      const sum = el('summary', 'pn-patch-sum');
      const label = el('span', 'pn-version', `Patch ${p.version}`);
      const name = el('span', 'pn-headline', p.headline || formatRange(p.from, p.to));
      const when = el('span', 'pn-date', p.headline ? formatRange(p.from, p.to) : `${p.entries.length} change${p.entries.length === 1 ? '' : 's'}`);
      sum.append(label, name, when);
      box.append(sum);
      const body = el('div', 'pn-patch-body');
      for (const e of p.entries) {
        const art = el('article', 'pn-entry');
        art.dataset.area = areaSlug(e.area);
        const h = el('h3', 'pn-entry-title');
        h.append(el('span', 'pn-area', e.area), el('span', 'pn-entry-name', e.title));
        art.append(h, renderBlocks(e.blocks));
        body.append(art);
      }
      box.append(body);
      scroller.append(box);
    });
  }

  function open() {
    render();
    hideToast();
    writeSeen(storage, allIds);
    returnFocus = document.activeElement;
    backdrop.hidden = false;
    scroller.scrollTop = 0;
    close.focus({preventScroll: true});
    onOpen?.();
  }
  function closePanel() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus?.({preventScroll: true});
    returnFocus = null;
    onClose?.();
  }
  close.addEventListener('click', closePanel);
  backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) closePanel(); });
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...dialog.querySelectorAll('button, summary')].filter(n => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // Any element with data-open-patch-notes opens the panel (Menu, lobby, other panels).
  document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-open-patch-notes]');
    if (t) { e.preventDefault(); open(); }
  });

  // ---------------------------------------------------------------- What's new toast
  let toast = null;
  function hideToast() { toast?.remove(); toast = null; }
  function showWhatsNew() {
    const fresh = unseenEntries(patches, readSeen(storage));
    if (!fresh.length || toast) return false;
    const latest = patches[0];
    toast = el('aside', 'pn-toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-label', 'What’s new');
    const top = el('p', 'pn-toast-head');
    top.append(el('span', 'pn-toast-kicker', 'What’s new'), el('span', 'pn-toast-patch', `Patch ${latest.version}${latest.headline ? ` · ${latest.headline}` : ''}`));
    const ul = el('ul', 'pn-toast-list');
    for (const e of fresh.slice(0, 3)) ul.append(el('li', null, e.title));
    if (fresh.length > 3) ul.append(el('li', 'pn-toast-more', `and ${fresh.length - 3} more`));
    const row = el('div', 'pn-toast-actions');
    const read = el('button', 'btn btn-secondary', 'Read patch notes');
    read.type = 'button';
    const dismiss = el('button', 'btn btn-quiet', 'Later');
    dismiss.type = 'button';
    read.addEventListener('click', open);
    dismiss.addEventListener('click', () => { writeSeen(storage, allIds); hideToast(); });
    row.append(read, dismiss);
    toast.append(top, ul, row);
    mount.append(toast);
    return true;
  }

  return {open, close: closePanel, showWhatsNew, hideToast, patches, get isOpen() { return !backdrop.hidden; }, root: backdrop};
}
