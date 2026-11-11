// Hero progression HUD: the level badge and XP meter beside health, the Talents panel and the big level-up banner.
// Presentation only: it reads the snapshot's own player record (xp, talents, tool) and sends learn/reset requests;
// the host decides everything (shared/hero-progress.js).
//
// Talents panel (phone first): a rail of weapon tabs, then the chosen weapon's two specialties. Each specialty shows
// its three ranks as a little ladder (learned, next, or waiting for a level) and one big button that buys the next
// rank. The rail sits on the left when the screen is wide or a phone is sideways, and along the top on a phone
// held upright. Opening the panel shows the weapon in your hand.
import {HERO_LEVEL, TALENTS, TALENT_WEAPONS, heroLevel, levelProgress, levelSteps, xpForLevel, xpToNext, talentPoints, talentRank, maxRank, rankLevel} from '../shared/hero-progress.js';

export const WEAPON_INFO = Object.freeze({
  axe: {name: 'Kingsfell', icon: 'bfi-axe', role: 'Woodsman’s axe'},
  pick: {name: 'Stonewhisper', icon: 'bfi-pick', role: 'Miner’s pick'},
  hammer: {name: 'Sunfall', icon: 'bfi-hammer', role: 'War hammer'},
  crossbow: {name: 'Siegebird', icon: 'bfi-crossbow', role: 'Songbird crossbow'},
  bow: {name: 'Emberwing', icon: 'bfi-bow', role: 'Phoenix bow'},
  wyrmspout: {name: 'Wyrmspout', icon: 'bfi-wyrmspout', role: 'Dragon’s breath'},
  flask: {name: 'Emberdew', icon: 'bfi-flask', role: 'Fire bottles'},
});
// Rail order: the tools you start with, then the ones you forge.
const ORDER = ['axe', 'pick', 'hammer', 'crossbow', 'bow', 'wyrmspout', 'flask'];
const NUMERAL = ['', 'I', 'II', 'III'];
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
};
const icon = (id, cls = 'hp-ico') => el('span', {class: cls, html: `<svg aria-hidden="true"><use href="#${id}"/></svg>`});
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Default: every talent weapon except lab-only ones you have never put a point into. */
export const defaultOwns = (player, weapon) => weapon !== 'flask' || talentRank(player, 'flask', 'firebomb') + talentRank(player, 'flask', 'tar') > 0;

/** Pure view model for the panel and HUD (also used by tests). `owns(player, weapon)` limits the rail. */
export function progressModel(player = {}, {owns = defaultOwns} = {}) {
  const xp = player.xp || 0, level = heroLevel(xp), max = level >= HERO_LEVEL.max, points = talentPoints(player);
  const weapons = ORDER.filter(w => TALENT_WEAPONS.includes(w) && owns(player, w)).map(w => {
    const talents = Object.entries(TALENTS[w]).map(([id, t]) => {
      const rank = talentRank(player, w, id), top = maxRank(w, id), next = rank + 1;
      const ready = t.ready !== false, opensAt = next <= top ? rankLevel(next) : 0;
      const state = rank >= top ? 'mastered' : !ready ? 'soon' : level < opensAt ? 'waiting' : points > 0 ? 'available' : 'locked';
      return {id, name: t.name, text: t.text, ready, rank, top, learned: rank > 0, state, opensAt,
        ranks: (t.ranks || [t.text]).map((line, i) => ({rank: i + 1, line, learned: i < rank, opensAt: rankLevel(i + 1)}))};
    });
    const ranks = talents.reduce((n, t) => n + t.rank, 0), tops = talents.reduce((n, t) => n + t.top, 0);
    return {id: w, ...WEAPON_INFO[w], talents, ranks, tops, canLearn: talents.some(t => t.state === 'available')};
  });
  // The next level that opens a new rank somewhere (a milestone worth naming in the panel).
  const nextGate = [2, 3].map(rankLevel).find(l => l > level) || 0;
  return {level, xp, max, points, progress: levelProgress(xp), nextGate,
    into: max ? 0 : xp - xpForLevel(level), need: max ? 0 : xpToNext(level),
    bonus: Math.round(levelSteps(level) * HERO_LEVEL.damagePerLevel * 100), weapons};
}

export function createHeroProgressUI({hudSelf, mount = document.body, owns = defaultOwns, onLearn = () => {}, onReset = () => {}, onOpen = () => {}, onClose = () => {}} = {}) {
  let player = {}, model = progressModel({}, {owns}), open = false, lastFocus = null, hero = true, bannerTimer = 0, shownKey = '', chosen = '';

  // HUD: level badge (opens the panel) and a gold XP meter under health and mana.
  const badgeNum = el('span', {class: 'hp-badge-num', text: '1'}), pip = el('span', {class: 'hp-pip', hidden: true});
  const badge = el('button', {type: 'button', class: 'hp-badge', title: 'Talents (N)', 'aria-keyshortcuts': 'N', onclick: () => toggle()},
    [el('span', {class: 'hp-badge-lv', text: 'Lv'}), badgeNum, pip]);
  const xpFill = el('span', {class: 'meter-fill hp-xp-fill'}), xpText = el('span', {class: 'meter-value', text: '0 / 30'});
  const xpMeter = el('div', {class: 'meter hp-xp', title: 'Experience'}, [el('span', {class: 'meter-label', text: 'XP'}), el('span', {class: 'meter-track'}, xpFill), xpText]);
  if (hudSelf) { hudSelf.querySelector('.hud-self-text')?.before(badge); hudSelf.querySelector('.meters')?.append(xpMeter); }

  // Panel.
  const title = el('h2', {class: 'hp-title', id: 'hpTalentsTitle', text: 'Talents'});
  const pointsChip = el('span', {class: 'hp-points'});
  const lede = el('p', {class: 'hp-lede'});
  const levelBar = el('span', {class: 'hp-level-fill'}), levelText = el('span', {class: 'hp-level-text'});
  const levelRow = el('div', {class: 'hp-level-row'}, [el('span', {class: 'hp-level-track'}, levelBar), levelText]);
  const closeBtn = el('button', {type: 'button', class: 'btn btn-chip hp-close', 'aria-label': 'Close talents', text: '✕', onclick: () => close()});
  const rail = el('div', {class: 'hp-rail', role: 'tablist', 'aria-label': 'Weapons'});
  const page = el('div', {class: 'hp-page', role: 'tabpanel'});
  const resetBtn = el('button', {type: 'button', class: 'btn btn-chip hp-reset', text: 'Reset talents (free)', onclick: () => onReset()});
  const footNote = el('p', {class: 'hp-foot-note'});
  const dialog = el('div', {class: 'hp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hpTalentsTitle', tabindex: '-1'}, [
    el('div', {class: 'hp-head'}, [el('div', {class: 'hp-head-text'}, [el('div', {class: 'hp-title-row'}, [title, pointsChip]), lede, levelRow]), closeBtn]),
    el('div', {class: 'hp-body'}, [rail, el('div', {class: 'hp-scroll'}, page)]),
    el('div', {class: 'hp-foot'}, [footNote, resetBtn]),
  ]);
  const backdrop = el('div', {class: 'hp-backdrop', hidden: true, onclick: e => { if (e.target === backdrop) close(); }}, dialog);
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.code === 'KeyN') { e.preventDefault(); close(); return; }
    // Arrow keys walk the weapon rail; number keys jump to a weapon.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && rail.contains(document.activeElement)) {
      const tabs = [...rail.children], i = tabs.indexOf(document.activeElement), step = ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1;
      const next = tabs[(i + step + tabs.length) % tabs.length]; if (next) { e.preventDefault(); select(next.dataset.weapon, true); }
      return;
    }
    if (/^Digit[1-9]$/.test(e.code)) { const w = model.weapons[Number(e.code.slice(5)) - 1]; if (w) { e.preventDefault(); select(w.id, true); } return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button:not([disabled])')]; if (!items.length) return;
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
  });
  mount.append(backdrop);

  // Level-up banner: a big gold title that bursts in, holds, and drifts away (CSS animation, every frame).
  const bannerLevel = el('span', {class: 'hp-banner-level'}), bannerSub = el('span', {class: 'hp-banner-sub'});
  const banner = el('div', {class: 'hp-banner', hidden: true, role: 'status', 'aria-live': 'polite'}, [el('span', {class: 'hp-banner-rays', 'aria-hidden': 'true'}), el('span', {class: 'hp-banner-kicker', text: 'Level up!'}), bannerLevel, bannerSub]);
  mount.append(banner);

  const current = () => model.weapons.find(w => w.id === chosen) || model.weapons[0];
  function pickDefault() {
    const held = model.weapons.find(w => w.id === player.tool);
    chosen = (held && (held.canLearn || !model.weapons.some(w => w.canLearn)) ? held : model.weapons.find(w => w.canLearn) || held || model.weapons[0])?.id || '';
  }
  function select(id, focusTab = false) {
    if (!model.weapons.some(w => w.id === id)) return;
    chosen = id; renderRail(); renderPage();
    if (focusTab) rail.querySelector(`[data-weapon="${id}"]`)?.focus({preventScroll: true});
  }
  function renderRail() {
    rail.replaceChildren(...model.weapons.map((w, i) => el('button', {type: 'button', class: 'hp-tab', role: 'tab', 'data-weapon': w.id,
      'aria-selected': String(w.id === current()?.id), tabindex: w.id === current()?.id ? '0' : '-1', 'data-can-learn': w.canLearn ? '1' : false,
      'aria-label': `${w.name}: ${w.ranks} of ${w.tops} ranks${w.canLearn ? ', a rank to learn' : ''}`, title: `${w.name} (${i + 1})`, onclick: () => select(w.id)}, [
      icon(w.icon, 'hp-tab-ico'), el('span', {class: 'hp-tab-name', text: w.name}),
      el('span', {class: 'hp-tab-count', text: `${w.ranks}/${w.tops}`}),
    ])));
  }
  function talentCard(w, t) {
    const next = t.rank + 1;
    const label = t.state === 'mastered' ? (t.top > 1 ? 'Mastered' : 'Learned')
      : t.state === 'soon' ? 'Coming soon'
      : t.state === 'waiting' ? `Rank ${NUMERAL[next]} opens at level ${t.opensAt}`
      : t.state === 'available' ? (t.rank ? `Learn rank ${NUMERAL[next]} · 1 point` : 'Learn · 1 point')
      : 'Needs a talent point';
    const ladder = t.top > 1 ? el('ol', {class: 'hp-ranks'}, t.ranks.map(r => el('li', {class: 'hp-rank', 'data-state': r.learned ? 'learned' : r.rank === next ? (t.state === 'waiting' ? 'waiting' : 'next') : 'later'}, [
      el('span', {class: 'hp-rank-num', text: NUMERAL[r.rank]}),
      el('span', {class: 'hp-rank-line', text: r.line}),
      ...(!r.learned && r.opensAt > model.level ? [el('span', {class: 'hp-rank-gate', text: `Lv ${r.opensAt}`})] : []),
    ]))) : null;
    return el('article', {class: 'hp-talent', 'data-state': t.state, 'data-talent': t.id}, [
      el('header', {class: 'hp-talent-head'}, [
        el('span', {class: 'hp-talent-name', text: t.name}),
        t.top > 1 ? el('span', {class: 'hp-pips', 'aria-label': `Rank ${t.rank} of ${t.top}`}, t.ranks.map(r => el('span', {class: 'hp-pip-dot', 'data-on': r.learned ? '1' : false}))) : null,
      ]),
      el('p', {class: 'hp-talent-text', text: t.text}),
      ladder,
      el('button', {type: 'button', class: 'hp-learn', 'data-state': t.state, disabled: t.state !== 'available',
        'aria-label': `${t.name}: ${label}`, onclick: () => onLearn(w.id, t.id)}, label),
    ]);
  }
  function renderPage() {
    const focused = dialog.contains(document.activeElement) ? document.activeElement.closest('.hp-talent')?.dataset.talent : null;
    const w = current();
    if (!w) { page.replaceChildren(el('p', {class: 'hp-empty', text: 'Forge a weapon to unlock its talents.'})); return; }
    page.replaceChildren(
      el('header', {class: 'hp-weapon-head'}, [icon(w.icon), el('div', {}, [el('h3', {text: w.name}), el('p', {text: `${w.role} · ${w.ranks} of ${w.tops} ranks`})])]),
      el('div', {class: 'hp-talents'}, w.talents.map(t => talentCard(w, t))),
    );
    if (focused) { const again = page.querySelector(`.hp-talent[data-talent="${focused}"] .hp-learn`); (again && !again.disabled ? again : dialog).focus({preventScroll: true}); }
  }
  function render() {
    badgeNum.textContent = String(model.level);
    pip.hidden = !model.points; pip.textContent = model.points ? `+${model.points}` : '';
    badge.classList.toggle('hp-has-points', model.points > 0);
    badge.setAttribute('aria-label', `Level ${model.level}${model.points ? `, ${plural(model.points, 'talent point')} to spend` : ''}. Open talents.`);
    xpFill.style.transform = `scaleX(${model.progress.toFixed(4)})`;
    xpText.textContent = model.max ? 'Max' : `${model.into} / ${model.need}`;
    title.textContent = `Level ${model.level}`;
    pointsChip.textContent = model.points ? `${plural(model.points, 'point')} to spend` : 'No points';
    pointsChip.dataset.has = model.points ? '1' : '';
    lede.textContent = model.points ? 'Spend a point on any weapon. Each specialty grows over three ranks.'
      : model.max ? 'Max level. Reset any time to try a different mix.'
      : 'Fight, fell trees, break ore and explore to level up.';
    levelBar.style.width = `${(model.progress * 100).toFixed(1)}%`;
    levelText.textContent = model.max ? `+${model.bonus}% health and damage` : `${model.into} / ${model.need} XP to level ${model.level + 1}`;
    footNote.textContent = `+${model.bonus}% health and damage from levels.${model.nextGate ? ` Rank ${model.nextGate === rankLevel(2) ? 'II' : 'III'} talents open at level ${model.nextGate}.` : ''}`;
    resetBtn.disabled = !model.weapons.some(w => w.ranks > 0) && !Object.values(player.talents || {}).some(l => l?.length);
    if (open) { renderRail(); renderPage(); }
  }
  function update(next, {role = 'hero'} = {}) {
    hero = role === 'hero';
    badge.hidden = xpMeter.hidden = !hero;
    if (!hero && open) close();
    const key = `${next?.xp || 0}|${JSON.stringify(next?.talents || {})}|${open ? next?.tool : ''}`;
    player = next || {};
    if (key === shownKey) return; shownKey = key;
    model = progressModel(player, {owns}); render();
  }
  function show() {
    if (open || !hero) return;
    open = true; lastFocus = document.activeElement; pickDefault(); renderRail(); renderPage(); backdrop.hidden = false; onOpen();
    requestAnimationFrame(() => (page.querySelector('.hp-learn[data-state="available"]') || rail.querySelector('[aria-selected="true"]') || closeBtn).focus({preventScroll: true}));
  }
  function close() {
    if (!open) return;
    open = false; backdrop.hidden = true; onClose();
    if (lastFocus?.isConnected && lastFocus !== document.body) lastFocus.focus?.({preventScroll: true});
  }
  function toggle() { open ? close() : show(); }
  function levelUp(event) {
    bannerLevel.textContent = `Level ${event.level}`;
    const gate = [2, 3].find(r => rankLevel(r) === event.level);
    const touch = globalThis.matchMedia?.('(pointer: coarse)').matches;
    bannerSub.textContent = gate ? `Rank ${NUMERAL[gate]} talents unlocked · ${touch ? 'tap your level' : 'press N'}`
      : `Talent point ready${touch ? ' · tap your level' : ' · press N'}`;
    banner.hidden = false; banner.classList.remove('hp-banner-play'); void banner.offsetWidth; banner.classList.add('hp-banner-play');
    badge.classList.remove('hp-badge-pop'); void badge.offsetWidth; badge.classList.add('hp-badge-pop');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { banner.hidden = true; banner.classList.remove('hp-banner-play'); }, 3600);
  }
  function dispose() { clearTimeout(bannerTimer); badge.remove(); xpMeter.remove(); backdrop.remove(); banner.remove(); }
  return {update, show, close, toggle, levelUp, dispose, select, root: backdrop, get isOpen() { return open; }};
}
