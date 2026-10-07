// The keep Quartermaster's shop (an Overwatch Stadium style item kit) and the town HUD bits: the Healing Draught
// chip (V, or tap it) and the tavern sanctuary banner. Presentation only: it reads the snapshot's own player record
// (resources.gold, items, draughts) and sends buy/sell/drink requests; the host decides everything
// (shared/home-shop.js, shared/hero-items.js, shared/taverns.js).
import {ITEMS, ITEM_IDS, ITEM_SLOTS, sellPrice} from '../shared/hero-items.js';
import {HOME_NAMES} from '../shared/home-bases.js';
import {draughtCap} from '../shared/home-shop.js';
import {TAVERN_NAMES} from '../shared/taverns.js';

// Each item's little shelf picture and accent.
export const ITEM_ART = Object.freeze({
  breastplate: {glyph: '🛡️', hue: 38}, boots: {glyph: '👢', hue: 28}, whetstone: {glyph: '🪨', hue: 210}, kettle: {glyph: '🫖', hue: 18},
  purse: {glyph: '👛', hue: 46}, belt: {glyph: '🧪', hue: 200}, charm: {glyph: '🧿', hue: 215}, leech: {glyph: '🪱', hue: 340},
  hat: {glyph: '🎩', hue: 25}, crown: {glyph: '👑', hue: 48}, locket: {glyph: '💖', hue: 330},
});
const TIERS = Object.freeze([['common', 'Everyday kit'], ['rare', 'Fine goods'], ['epic', 'Keep treasures']]);
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
};

/** Pure view model (also used by tests). */
export function shopModel(player = {}) {
  const gold = player.resources?.gold || 0, owned = Array.isArray(player.items) ? player.items : [], full = owned.length >= ITEM_SLOTS;
  return {
    gold, full, side: player.side === 'rivals' ? 'rivals' : 'party', slots: Array.from({length: ITEM_SLOTS}, (_, i) => owned[i] || null),
    items: ITEM_IDS.map(id => {
      const it = ITEMS[id], have = owned.includes(id);
      const state = have ? 'owned' : full ? 'full' : gold >= it.cost ? 'buy' : 'poor';
      return {id, name: it.name, text: it.text, cost: it.cost, tier: it.tier, sell: sellPrice(id), state};
    }),
  };
}

export function createQuartermasterUI({mount = document.body, hudSelf = null, onBuy = () => {}, onSell = () => {}, onDrink = () => {}, onOpen = () => {}, onClose = () => {}} = {}) {
  let model = shopModel({}), open = false, lastFocus = null, shownKey = '', hero = true;

  const coin = el('span', {class: 'qm-coin', 'aria-hidden': 'true'});
  const goldText = el('strong', {class: 'qm-gold-num', text: '0'});
  const title = el('h2', {class: 'qm-title', id: 'qmTitle', text: 'The Quartermaster'});
  const lede = el('p', {class: 'qm-lede', text: 'Six pockets, no refunds on dents. Sell anything back for half.'});
  const closeBtn = el('button', {type: 'button', class: 'btn btn-chip qm-close', 'aria-label': 'Close the shop', text: '✕', onclick: () => close()});
  const slots = el('ol', {class: 'qm-slots', 'aria-label': 'Your item slots'});
  const shelves = el('div', {class: 'qm-shelves'});
  const note = el('p', {class: 'qm-note', text: 'Earn Gold by felling enemy troops, and by tipping gold ore, copper ore and stone into the keep’s mill. Items stay with you through every fall.'});
  const dialog = el('div', {class: 'qm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qmTitle', tabindex: '-1'}, [
    el('div', {class: 'qm-head'}, [
      el('div', {class: 'qm-awning', 'aria-hidden': 'true'}),
      el('div', {class: 'qm-head-row'}, [el('div', {class: 'qm-head-text'}, [title, lede]), el('div', {class: 'qm-purse', title: 'Your Gold'}, [coin, goldText]), closeBtn]),
      slots]),
    el('div', {class: 'qm-scroll'}, [shelves, note]),
  ]);
  const backdrop = el('div', {class: 'qm-backdrop', hidden: true, onclick: e => { if (e.target === backdrop) close(); }}, dialog);
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button:not([disabled])')]; if (!items.length) return;
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
  });
  mount.append(backdrop);

  // HUD: Healing Draught chip (tap or V) and the tavern banner.
  const draughtNum = el('span', {class: 'qm-draught-num', text: '0'});
  const draught = el('button', {type: 'button', class: 'qm-draught', hidden: true, title: 'Drink a Healing Draught (V)', 'aria-keyshortcuts': 'V', onclick: () => onDrink()},
    [el('span', {class: 'qm-draught-flask', 'aria-hidden': 'true'}), draughtNum, el('kbd', {class: 'qm-key', text: 'V'})]);
  const tavernName = el('strong'), tavernNote = el('span');
  const tavern = el('div', {class: 'qm-tavern', hidden: true, role: 'status', 'aria-live': 'polite'}, [el('span', {class: 'qm-tavern-mug', 'aria-hidden': 'true', text: '🍺'}), el('span', {class: 'qm-tavern-text'}, [tavernName, tavernNote])]);
  (hudSelf || mount).append(draught); mount.append(tavern);
  let tavernAt = '', tavernTimer = 0;

  const art = id => { const a = ITEM_ART[id] || {glyph: '✦', hue: 40}; return el('span', {class: 'qm-art', style: `--qm-hue:${a.hue}`, 'aria-hidden': 'true', text: a.glyph}); };
  function renderSlots() {
    slots.replaceChildren(...model.slots.map((id, i) => id
      ? el('li', {class: 'qm-slot', 'data-filled': ''}, [art(id), el('span', {class: 'qm-slot-name', text: ITEMS[id].name}),
        el('button', {type: 'button', class: 'qm-sell', 'data-item': id, 'aria-label': `Sell ${ITEMS[id].name} for ${sellPrice(id)} Gold`, onclick: () => onSell(id)}, [el('span', {text: 'Sell'}), el('b', {text: `+${sellPrice(id)}`})])])
      : el('li', {class: 'qm-slot', 'aria-label': `Empty slot ${i + 1}`}, el('span', {class: 'qm-slot-empty', text: String(i + 1)}))));
  }
  function renderShelves() {
    const focused = dialog.contains(document.activeElement) ? document.activeElement.dataset.item : null;
    shelves.replaceChildren(...TIERS.map(([tier, label]) => el('section', {class: 'qm-shelf', 'data-tier': tier}, [
      el('h3', {class: 'qm-shelf-title'}, [el('span', {text: label}), el('small', {text: tier})]),
      el('div', {class: 'qm-grid'}, model.items.filter(it => it.tier === tier).map(it => {
        const label = it.state === 'owned' ? 'In your pack' : it.state === 'full' ? 'Pockets full' : it.state === 'poor' ? `Need ${it.cost - model.gold} more` : 'Buy';
        return el('button', {type: 'button', class: 'qm-item', 'data-state': it.state, 'data-item': it.id, disabled: it.state !== 'buy',
          'aria-label': `${it.name}. ${it.text} Costs ${it.cost} Gold. ${label}.`, onclick: () => onBuy(it.id)}, [
          art(it.id), el('span', {class: 'qm-item-name', text: it.name}), el('span', {class: 'qm-item-text', text: it.text}),
          el('span', {class: 'qm-item-foot'}, [el('span', {class: 'qm-price'}, [el('span', {class: 'qm-coin qm-coin-sm', 'aria-hidden': 'true'}), String(it.cost)]), el('span', {class: 'qm-item-state', text: label})])]);
      }))])));
    if (focused) { const again = dialog.querySelector(`[data-item="${focused}"]:not([disabled])`); (again || dialog).focus({preventScroll: true}); }
  }
  function render() {
    goldText.textContent = String(model.gold);
    title.textContent = `${HOME_NAMES[model.side]} Quartermaster`;
    dialog.dataset.side = model.side;
    if (open) { renderSlots(); renderShelves(); }
  }
  /** Per snapshot. self: the local player; tavern: the tavern you stand in (shared/taverns.js) or null. */
  function update(self, {role = 'hero', tavern: inTavern = null, tick = 0} = {}) {
    hero = role === 'hero' && !!self;
    if (!hero && open) close();
    const n = self?.draughts || 0, cap = hero ? draughtCap(self) : 0;
    draught.hidden = !hero; draughtNum.textContent = `${n}/${cap}`; draught.disabled = !n;
    draught.classList.toggle('qm-draught-ready', n > 0 && (self?.hp ?? 0) < (self?.maxHp ?? 100));
    const key = `${self?.resources?.gold || 0}|${(self?.items || []).join(',')}|${self?.side}`;
    if (key !== shownKey) { shownKey = key; model = shopModel(self || {}); render(); }
    const at = hero && inTavern ? inTavern.id : '';
    if (at !== tavernAt) {
      tavernAt = at; clearTimeout(tavernTimer);
      if (at) {
        tavernName.textContent = TAVERN_NAMES[inTavern.side] || 'The tavern';
        tavernNote.textContent = (self?.heartyUntil ?? 0) > tick ? 'Sanctuary: no fighting in here. Pull up a stool and have a natter.' : 'Sanctuary: no fighting in here. Ask the bar for a Hearty Ale, and have a natter.';
        tavern.hidden = false; tavern.classList.remove('qm-tavern-play'); void tavern.offsetWidth; tavern.classList.add('qm-tavern-play');
        tavernTimer = setTimeout(() => tavern.classList.add('qm-tavern-quiet'), 5200);
      } else { tavern.hidden = true; tavern.classList.remove('qm-tavern-quiet'); }
    }
  }
  function show() {
    if (open || !hero) return;
    open = true; lastFocus = document.activeElement; renderSlots(); renderShelves(); backdrop.hidden = false; onOpen();
    requestAnimationFrame(() => (dialog.querySelector('.qm-item[data-state="buy"]') || closeBtn).focus({preventScroll: true}));
  }
  function close() {
    if (!open) return;
    open = false; backdrop.hidden = true; onClose();
    if (lastFocus?.isConnected && lastFocus !== document.body) lastFocus.focus?.({preventScroll: true});
  }
  /** A purchase lands: the new item's card does a happy little hop. */
  function bought(id) { const card = dialog.querySelector(`.qm-slot [data-item="${id}"]`)?.closest('.qm-slot'); card?.classList.add('qm-pop'); }
  function dispose() { clearTimeout(tavernTimer); backdrop.remove(); draught.remove(); tavern.remove(); }
  return {update, show, close, toggle: () => open ? close() : show(), bought, dispose, root: backdrop, get isOpen() { return open; }};
}
