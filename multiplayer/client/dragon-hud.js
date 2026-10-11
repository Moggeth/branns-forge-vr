// Dragon streak HUD (DOM, view only). Five flame pips that fill with each killing blow, a glowing "Slay Thee, Sun Birdy Above"
// button once it is earned, and while riding: a ride timer, and three attack buttons with their charge or recharge
// shown as a fill. On touch the attack buttons are big thumb targets on the free (movement) side; on desktop they are a
// compact key-hint bar. Writes to the DOM only when a shown value changes.
import './dragon-hud.css';

const ICON = {
  breath: '<path d="M4 13c3-1 5-4 6-8 1 3 0 5 1 6 1-2 3-3 4-6 1 4 5 6 5 10a8 8 0 0 1-16 0z" opacity=".9"/><path d="M9 15c0-2 2-3 2-5 2 2 4 3 4 5a3 3 0 0 1-6 0z" fill="#fff3c4" stroke="none"/>',
  fireball: '<circle cx="15" cy="9" r="4.2"/><path d="M12 12L4 20M14.5 13.5L8 20M10.5 10.5L4 16"/>',
  dive: '<path d="M12 3v12"/><path d="M6.5 10L12 16l5.5-6"/><path d="M4 20c2.6-1.6 5.3-2.4 8-2.4s5.4.8 8 2.4"/><path d="M7 17.5l-1.5-2M17 17.5l1.5-2" opacity=".7"/>',
  view: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.6"/>',
  dragon: '<path d="M3 15c3-1 4-4 7-4 2 0 3 1 4 2l3-4 1 4 3-1-2 4c-1 3-4 4-7 4-4 0-6-2-9-5z"/><circle cx="15.5" cy="13" r=".9" fill="currentColor"/><path d="M10 11l-2-5 4 3M13 10l1-5 2 4"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
export const ATTACK_TEXT = Object.freeze({
  breath: {name: 'Fire Breath', key: 'Hold click', touch: 'Hold'},
  fireball: {name: 'Fireballs', key: 'Right-click', touch: 'Tap'},
  dive: {name: 'Comet Dive', key: 'Space', touch: 'Tap'},
});

export function createDragonHud({root = document.body, onCall, onAttack, onView}) {
  const wrap = document.createElement('div'); wrap.className = 'dragon-hud';
  wrap.innerHTML = `
    <div class="dragon-streak" hidden><span class="dragon-streak-pips"></span><span class="dragon-streak-text"></span></div>
    <button type="button" class="dragon-call" hidden>${svg('dragon')}<span class="dragon-call-text">Slay Thee, Sun Birdy Above</span><kbd>H</kbd></button>
    <div class="dragon-ride" hidden>
      <div class="dragon-timer"><span class="dragon-timer-name">Slay Thee, Sun Birdy Above</span><span class="dragon-timer-bar"><i></i></span><span class="dragon-timer-left"></span><button type="button" class="dragon-view" aria-label="Change view">${svg('view')}<kbd>C</kbd></button></div>
      <div class="dragon-attacks">${['breath', 'fireball', 'dive'].map(k => `<button type="button" class="dragon-attack" data-attack="${k}" aria-label="${ATTACK_TEXT[k].name}"><span class="dragon-fill"></span>${svg(k)}<span class="dragon-attack-name">${ATTACK_TEXT[k].name}</span><kbd>${ATTACK_TEXT[k].key}</kbd></button>`).join('')}</div>
    </div>`;
  root.append(wrap);
  const $ = s => wrap.querySelector(s), streak = $('.dragon-streak'), pips = $('.dragon-streak-pips'), streakText = $('.dragon-streak-text'), call = $('.dragon-call'), ride = $('.dragon-ride');
  const bar = $('.dragon-timer-bar i'), left = $('.dragon-timer-left'), buttons = Object.fromEntries([...wrap.querySelectorAll('.dragon-attack')].map(b => [b.dataset.attack, b]));
  const shown = {};
  const set = (key, value, apply) => { if (shown[key] !== value) { shown[key] = value; apply(value); } };
  const held = new Map();
  // Pointer events own each button for the whole press, so a held breath survives a finger sliding a little.
  for (const [kind, b] of Object.entries(buttons)) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch {} held.set(e.pointerId, kind); onAttack?.(kind, true); });
    const up = e => { if (!held.has(e.pointerId)) return; held.delete(e.pointerId); onAttack?.(kind, false); };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(n, up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  const view = wrap.querySelector('.dragon-view');
  view.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); onView?.(); });
  call.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
  call.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onCall?.(); });
  return {
    /** model: {streak, need, ready, touch, riding: null | {left (s), total (s), breath 0..1, fireball 0..1, dive 0..1, open, held: {breath}}} */
    render(m) {
      document.body.classList.toggle('dragon-riding', !!m.riding);
      wrap.classList.toggle('is-touch', !!m.touch);
      set('streakShown', !m.riding && !m.ready && m.streak > 0, v => { streak.hidden = !v; });
      set('streak', `${m.streak}/${m.need}`, () => {
        pips.innerHTML = Array.from({length: m.need}, (_, i) => `<i class="${i < m.streak ? 'on' : ''}"></i>`).join('');
        streakText.textContent = `${m.need - m.streak} more for Slay Thee, Sun Birdy Above`;
        streak.classList.remove('bump'); void streak.offsetWidth; streak.classList.add('bump');
      });
      set('ready', !m.riding && !!m.ready, v => { call.hidden = !v; });
      set('riding', !!m.riding, v => { ride.hidden = !v; if (!v) held.clear(); });
      if (!m.riding) return;
      const r = m.riding;
      set('left', Math.ceil(r.left), v => { left.textContent = `${v}s`; });
      bar.style.transform = `scaleX(${Math.max(0, Math.min(1, r.left / r.total)).toFixed(3)})`;
      for (const k of ['breath', 'fireball', 'dive']) {
        const b = buttons[k], v = Math.max(0, Math.min(1, r[k]));
        b.style.setProperty('--fill', v.toFixed(3));
        set(k + 'Ready', r.open && (k === 'breath' ? v > .05 : v >= 1), on => b.classList.toggle('is-ready', on));
        set(k + 'Held', !!r.held?.[k], on => b.classList.toggle('is-held', on));
      }
    },
    nudge(kind) { const b = buttons[kind]; if (!b) return; b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); },
    dispose() { document.body.classList.remove('dragon-riding'); wrap.remove(); },
  };
}
