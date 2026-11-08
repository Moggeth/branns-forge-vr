// Contextual thumb action chip. View-only: it never applies damage or mutates gameplay.
// mountTouchActions({root, onAction}) -> { setContext(ctx), setQuick(list), dispose() }
// ctx: null | { kind: 'attack'|'mine'|'collect'|'talk', label, targetId, progress? (0..1) }
import {setText, setAttr, setHidden, setData} from './dom-write.js';
// onAction({type:'context', kind, targetId}) — host should AIM + start a real swing at targetId
//   (same path as the existing primary Attack), never instant server damage. Held bow draw is untouched:
//   host should ignore context taps while a draw is held.
// setQuick([{id, icon, label, badge?}]) — up to 4 always-reachable actions (e.g. forge, expedition, ping).
const ICON = { attack: '⚔', mine: '⛏', collect: '✋', talk: '✉' };

export function mountTouchActions({ root = document.body, onAction }) {
  const wrap = document.createElement('div'); wrap.className = 'ta-wrap';
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'ta-chip'; chip.hidden = true;
  chip.innerHTML = '<span class="ta-ring"></span><span class="ta-icon"></span><span class="ta-label"></span>';
  const quick = document.createElement('div'); quick.className = 'ta-quick';
  wrap.append(quick, chip); root.appendChild(wrap);
  let ctx = null;
  const fire = (ev) => { ev.preventDefault(); ev.stopPropagation();
    if (ctx && onAction) { chip.classList.remove('ta-pulse'); void chip.offsetWidth; chip.classList.add('ta-pulse');
      onAction({ type: 'context', kind: ctx.kind, targetId: ctx.targetId }); } };
  chip.addEventListener('click', fire);
  quick.addEventListener('click', (ev) => { const b = ev.target.closest('[data-id]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation(); onAction && onAction({ type: 'quick', id: b.dataset.id }); });

  function setContext(next) {
    // Called every frame from the aim cue: write only what changed.
    ctx = next || null; setHidden(chip, !ctx); if (!ctx) return;
    setData(chip, 'kind', ctx.kind);
    setText(chip.querySelector('.ta-icon'), ICON[ctx.kind] || '•');
    setText(chip.querySelector('.ta-label'), ctx.label || ctx.kind);
    setAttr(chip, 'aria-label', (ctx.label || ctx.kind));
    const p = String(Math.max(0, Math.min(1, ctx.progress ?? 0))); if (chip.style.getPropertyValue('--ta-p') !== p) chip.style.setProperty('--ta-p', p);
  }
  function setQuick(list = []) {
    quick.replaceChildren(...list.slice(0, 4).map((q) => { const b = document.createElement('button');
      b.type = 'button'; b.className = 'ta-q'; b.dataset.id = q.id; b.setAttribute('aria-label', q.label);
      b.innerHTML = `<span>${q.icon || ''}</span><small>${({bandage:'Heal',deliver:'Deliver',drop:'Drop',inspect:'Inspect'})[q.id]||q.id}</small>`; return b; }));
  }
  function dispose() { wrap.remove(); }
  return { setContext, setQuick, dispose };
}
