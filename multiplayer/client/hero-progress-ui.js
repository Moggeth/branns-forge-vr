// Hero progression HUD: the level badge and XP meter beside health, the Talents panel (two specialties per weapon,
// one point each) and the big level-up banner. Presentation only: it reads the snapshot's own player record
// (xp, talents, maxHp) and sends learn/reset requests; the host decides everything (shared/hero-progress.js).
import {HERO_LEVEL, TALENTS, TALENT_WEAPONS, heroLevel, levelProgress, xpForLevel, xpToNext, talentPoints, hasTalent} from '../shared/hero-progress.js';

export const WEAPON_INFO = Object.freeze({
  axe: {name: 'Axe', icon: 'bfi-axe', role: 'Woodsman’s cleaver'},
  pick: {name: 'Stonewhisper', icon: 'bfi-pick', role: 'Miner’s pick'},
  crossbow: {name: 'Siegebird', icon: 'bfi-crossbow', role: 'Songbird crossbow'},
  bow: {name: 'Emberwing', icon: 'bfi-bow', role: 'Phoenix bow'},
  flask: {name: 'Emberdew', icon: 'bfi-flask', role: 'Fire bottles'},
  wyrmspout: {name: 'Wyrmspout', icon: 'bfi-wyrmspout', role: 'Dragon’s breath'},
});
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
};
const icon = id => el('span', {class: 'hp-ico', html: `<svg aria-hidden="true"><use href="#${id}"/></svg>`});

/** Pure view model for the panel and HUD (also used by tests). */
export function progressModel(player = {}) {
  const xp = player.xp || 0, level = heroLevel(xp), max = level >= HERO_LEVEL.max;
  return {
    level, xp, max, points: talentPoints(player), progress: levelProgress(xp),
    into: max ? 0 : xp - xpForLevel(level), need: max ? 0 : xpToNext(level),
    bonus: Math.round((level - 1) * HERO_LEVEL.damagePerLevel * 100),
    weapons: TALENT_WEAPONS.map(w => ({id: w, ...WEAPON_INFO[w], talents: Object.entries(TALENTS[w]).map(([id, t]) => ({
      id, name: t.name, text: t.text, ready: t.ready !== false, learned: hasTalent(player, w, id)}))})),
  };
}

export function createHeroProgressUI({hudSelf, mount = document.body, onLearn = () => {}, onReset = () => {}, onOpen = () => {}, onClose = () => {}} = {}) {
  let model = progressModel({}), open = false, lastFocus = null, hero = true, bannerTimer = 0, shownKey = '';

  // HUD: level badge (opens the panel) and a gold XP meter under health and mana.
  const badgeNum = el('span', {class: 'hp-badge-num', text: '1'}), pip = el('span', {class: 'hp-pip', hidden: true});
  const badge = el('button', {type: 'button', class: 'hp-badge', title: 'Talents (N)', 'aria-keyshortcuts': 'N', onclick: () => toggle()},
    [el('span', {class: 'hp-badge-lv', text: 'Lv'}), badgeNum, pip]);
  const xpFill = el('span', {class: 'meter-fill hp-xp-fill'}), xpText = el('span', {class: 'meter-value', text: '0 / 30'});
  const xpMeter = el('div', {class: 'meter hp-xp', title: 'Experience'}, [el('span', {class: 'meter-label', text: 'XP'}), el('span', {class: 'meter-track'}, xpFill), xpText]);
  if (hudSelf) { hudSelf.querySelector('.hud-self-text')?.before(badge); hudSelf.querySelector('.meters')?.append(xpMeter); }

  // Panel.
  const title = el('h2', {class: 'hp-title', id: 'hpTalentsTitle', text: 'Talents'});
  const lede = el('p', {class: 'hp-lede'});
  const levelBar = el('span', {class: 'hp-level-fill'});
  const levelRow = el('div', {class: 'hp-level-row'}, [el('span', {class: 'hp-level-track'}, levelBar), el('span', {class: 'hp-level-text'})]);
  const closeBtn = el('button', {type: 'button', class: 'btn btn-chip hp-close', 'aria-label': 'Close talents', text: '✕', onclick: () => close()});
  const grid = el('div', {class: 'hp-grid'});
  const resetBtn = el('button', {type: 'button', class: 'btn btn-chip hp-reset', text: 'Reset talents (free)', onclick: () => onReset()});
  const footNote = el('p', {class: 'hp-foot-note', text: 'Every level: +20% health, +20% weapon damage and one talent point.'});
  const dialog = el('div', {class: 'hp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hpTalentsTitle', tabindex: '-1'}, [
    el('div', {class: 'hp-head'}, [el('div', {class: 'hp-head-text'}, [title, lede, levelRow]), closeBtn]),
    el('div', {class: 'hp-scroll'}, grid),
    el('div', {class: 'hp-foot'}, [footNote, resetBtn]),
  ]);
  const backdrop = el('div', {class: 'hp-backdrop', hidden: true, onclick: e => { if (e.target === backdrop) close(); }}, dialog);
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.code === 'KeyN') { e.preventDefault(); close(); return; }
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

  function renderGrid() {
    // Re-rendering replaces the buttons: keep keyboard focus on the same specialty (or the dialog).
    const focused = dialog.contains(document.activeElement) ? document.activeElement.closest('.hp-talent')?.dataset.talent : null;
    grid.replaceChildren(...model.weapons.map(w => el('section', {class: 'hp-weapon', 'data-weapon': w.id}, [
      el('header', {class: 'hp-weapon-head'}, [icon(w.icon), el('div', {}, [el('h3', {text: w.name}), el('p', {text: w.role})])]),
      ...w.talents.map(t => {
        const state = t.learned ? 'learned' : !t.ready ? 'soon' : model.points > 0 ? 'available' : 'locked';
        const label = state === 'learned' ? 'Learned' : state === 'soon' ? 'Coming soon' : state === 'available' ? 'Learn · 1 point' : 'Needs a point';
        return el('button', {type: 'button', class: 'hp-talent', 'data-state': state, 'data-talent': t.id, disabled: state !== 'available',
          'aria-label': `${t.name}. ${t.text} ${label}.`, onclick: () => onLearn(w.id, t.id)}, [
          el('span', {class: 'hp-talent-name', text: t.name}), el('span', {class: 'hp-talent-text', text: t.text}), el('span', {class: 'hp-talent-state', text: label})]);
      }),
    ])));
    if (focused) { const again = grid.querySelector(`.hp-talent[data-talent="${focused}"]`); (again && !again.disabled ? again : dialog).focus({preventScroll: true}); }
  }
  function render() {
    badgeNum.textContent = String(model.level);
    pip.hidden = !model.points; pip.textContent = model.points ? `+${model.points}` : '';
    badge.classList.toggle('hp-has-points', model.points > 0);
    badge.setAttribute('aria-label', `Level ${model.level}${model.points ? `, ${model.points} talent point${model.points > 1 ? 's' : ''} to spend` : ''}. Open talents.`);
    xpFill.style.transform = `scaleX(${model.progress.toFixed(4)})`;
    xpText.textContent = model.max ? 'Max' : `${model.into} / ${model.need}`;
    title.textContent = `Talents · Level ${model.level}`;
    lede.textContent = model.points ? `You have ${model.points} talent point${model.points > 1 ? 's' : ''} to spend. Pick your favourite weapons.`
      : model.max ? 'Max level. Reset any time to try a different mix.' : 'Earn XP from fights, felling trees and breaking ore to level up.';
    levelBar.style.width = `${(model.progress * 100).toFixed(1)}%`;
    levelRow.lastChild.textContent = model.max ? `+${model.bonus}% health and damage` : `${model.into} / ${model.need} XP · +${model.bonus}% health and damage`;
    resetBtn.disabled = !model.weapons.some(w => w.talents.some(t => t.learned));
    if (open) renderGrid();
  }
  function update(player, {role = 'hero'} = {}) {
    hero = role === 'hero';
    badge.hidden = xpMeter.hidden = !hero;
    if (!hero && open) close();
    const key = `${player?.xp || 0}|${JSON.stringify(player?.talents || {})}`;
    if (key === shownKey) return; shownKey = key;
    model = progressModel(player || {}); render();
  }
  function show() {
    if (open || !hero) return;
    open = true; lastFocus = document.activeElement; renderGrid(); backdrop.hidden = false; onOpen();
    requestAnimationFrame(() => (dialog.querySelector('.hp-talent[data-state="available"]') || closeBtn).focus({preventScroll: true}));
  }
  function close() {
    if (!open) return;
    open = false; backdrop.hidden = true; onClose();
    if (lastFocus?.isConnected && lastFocus !== document.body) lastFocus.focus?.({preventScroll: true});
  }
  function toggle() { open ? close() : show(); }
  function levelUp(event) {
    bannerLevel.textContent = `Level ${event.level}`;
    bannerSub.textContent = `+20% health and damage · talent point ready${matchMedia?.('(pointer: coarse)').matches ? '' : ' (press N)'}`;
    banner.hidden = false; banner.classList.remove('hp-banner-play'); void banner.offsetWidth; banner.classList.add('hp-banner-play');
    badge.classList.remove('hp-badge-pop'); void badge.offsetWidth; badge.classList.add('hp-badge-pop');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { banner.hidden = true; banner.classList.remove('hp-banner-play'); }, 3600);
  }
  function dispose() { clearTimeout(bannerTimer); badge.remove(); xpMeter.remove(); backdrop.remove(); banner.remove(); }
  return {update, show, close, toggle, levelUp, dispose, root: backdrop, get isOpen() { return open; }};
}
