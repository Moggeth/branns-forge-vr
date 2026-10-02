// Compact Forge Expedition objective banner. Consumes the stable adventureView() model from shared/adventure.js.
// DOM version for desktop/mobile, plus drawAdventurePanel() for a VR CanvasTexture (DOM is invisible in WebXR).
// No framework, no Three.js dependency; re-renders only when the view model actually changes.

// Original 24x24 single-path glyphs (fill-rule evenodd), shared by SVG and Path2D.
export const ADVENTURE_ICONS = Object.freeze({
  timber: 'M3 15h14a3 3 0 0 1 0 6H3a3 3 0 0 1 0-6zm0 2a1 1 0 0 0 0 2 1 1 0 0 0 0-2zM6 4l9 9h-3L4 5zm6-1 2 2-3 3-2-2z',
  stone: 'M5 20 2 13l4-7 7-3 7 4 2 8-5 5zm4-10 3-2 3 2-1 3h-4z',
  gem: 'M7 3h10l5 6-10 12L2 9zm1.5 2L5 9h4.5L11 5zm5.5 0 1.5 4H19l-3.5-4zM12 17l3-7H9z',
  star: 'M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3l-5.8 3.5 1.6-6.6L2.6 8.8l6.8-.5z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9zm0 11c-1 1.5-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-1-2.5-2-4z',
  skull: 'M12 2a8 8 0 0 0-8 8v4l2 2v4h3v-2h2v2h2v-2h2v2h3v-4l2-2v-4a8 8 0 0 0-8-8zm-3.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  path: 'M4 22c2-6 9-6 8-11-1-4 6-5 8-9h2c-2 5-8 6-7.5 9.5C15 17 7 17 6.5 22zM3 5h3v3H3zm14 13h3v3h-3z',
  grove: 'M12 2 6 11h3l-4 6h6v5h2v-5h6l-4-6h3z',
});
const TONE = {idle: '#c9b48a', camp: '#e0a64a', star: '#9fc8ff', rekindle: '#ff7a3a', victory: '#ffd36b', defeat: '#9a8f86'};
const SVG_NS = 'http://www.w3.org/2000/svg';
const LABELS = {start: 'Start Expedition', rematch: 'Rematch', retry: 'Retry last stand', leave: 'Leave', deposit: 'Deliver to forge', tithe: 'Tithe (mana)', lodestar: 'Lodestar (mana)'};

function icon(name, size = 18, color = 'currentColor') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ADVENTURE_ICONS[name] || ADVENTURE_ICONS.star); p.setAttribute('fill', color); p.setAttribute('fill-rule', 'evenodd');
  svg.append(p); return svg;
}
const el = (tag, style, text) => { const e = document.createElement(tag); if (style) e.style.cssText = style; if (text !== undefined) e.textContent = text; return e; };

// root: container element. onAction(actionName) is called for button presses; the caller adds seq/kind/point.
export function createAdventureBanner(root, {onAction = () => {}} = {}) {
  const box = el('section', 'position:absolute;top:10px;left:50%;transform:translateX(-50%);min-width:240px;max-width:min(92vw,420px);' +
    'background:rgba(24,18,14,.82);color:#f3e7d3;font:13px/1.3 system-ui,sans-serif;border-radius:10px;padding:8px 12px;' +
    'box-shadow:0 2px 10px #0008;pointer-events:auto;user-select:none;z-index:20');
  box.className = 'expedition-banner';
  box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  root.append(box);
  let last = '';
  box.addEventListener('click', e => { const b = e.target.closest('button[data-action]'); if (b) onAction(b.dataset.action); });
  return {
    element: box,
    update(view) {
      const key = JSON.stringify(view);
      if (key === last) return false; last = key;
      box.replaceChildren();
      const tone = TONE[view.stage] || '#fff';
      box.style.borderTop = `3px solid ${tone}`;
      const head = el('div', 'display:flex;align-items:center;gap:6px;font-weight:600;font-size:14px');
      head.append(icon(view.stage === 'rekindle' ? 'flame' : view.stage === 'star' ? 'star' : 'timber', 18, tone), el('span', '', view.title));
      if (view.stage !== 'idle') head.append(el('span', 'margin-left:auto;opacity:.7;font-weight:400', `${Math.floor(view.elapsedSeconds / 60)}:${String(view.elapsedSeconds % 60).padStart(2, '0')}`));
      box.append(head);
      if (view.notice && view.notice !== view.title) box.append(el('div', 'opacity:.85;margin:3px 0', view.notice));
      for (const o of view.objectives) {
        const row = el('div', `display:flex;align-items:center;gap:6px;margin-top:4px;${o.waived ? 'opacity:.55' : ''}`);
        row.append(icon(o.icon, 16, o.done ? '#9be38a' : tone), el('span', 'flex:1', o.label), el('span', 'font-variant-numeric:tabular-nums', o.done ? '✓' : `${o.have}/${o.need}`));
        box.append(row);
        if (o.need > 1 && !o.done) {
          const bar = el('div', 'height:3px;background:#ffffff22;border-radius:2px;margin:2px 0 0 22px');
          bar.append(el('div', `height:3px;width:${Math.round(100 * o.have / o.need)}%;background:${tone};border-radius:2px`));
          box.append(bar);
        }
      }
      for (const t of view.telegraphs) {
        const warn = el('div', 'display:flex;align-items:center;gap:6px;margin-top:5px;color:#ffcf7a;font-weight:600');
        warn.append(icon(t.kind === 'star' ? 'star' : 'skull', 16, '#ffcf7a'), el('span', '', `${t.label} — ${t.secondsLeft}s`));
        box.append(warn);
      }
      const extra = [];
      if (view.godSupportLeft && view.role === 'god') extra.push(`God aid left: ${view.godSupportLeft}`);
      if (view.challengeLeft && view.role === 'god') extra.push(`Challenge budget: ${view.challengeLeft}`);
      if (view.stage === 'defeat') extra.push(`Retries left: ${view.retriesLeft}`);
      if (view.renown) extra.push(`Renown ${view.renown}`);
      if (extra.length) box.append(el('div', 'opacity:.7;margin-top:4px;font-size:12px', extra.join(' · ')));
      const buttons = view.actions.filter(a => a !== 'deposit' || view.stage !== 'idle');
      if (buttons.length) {
        const bar = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px');
        for (const a of buttons) {
          const b = el('button', `min-height:32px;padding:4px 10px;border-radius:6px;border:1px solid ${tone};background:#0000;color:inherit;font:inherit;cursor:pointer`, LABELS[a] || a);
          b.dataset.action = a; bar.append(b);
        }
        box.append(bar);
      }
      return true;
    },
    destroy() { box.remove(); },
  };
}

// VR / world-space panel: draw into a 2D canvas context (e.g. 512x256 CanvasTexture). Returns true if redrawn.
const paths = {};
export function drawAdventurePanel(ctx, view, width = 512, height = 256, cache = {}) {
  const key = JSON.stringify(view);
  if (cache.key === key) return false; cache.key = key;
  const tone = TONE[view.stage] || '#fff', s = width / 512;
  ctx.save(); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(24,18,14,.88)'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = tone; ctx.fillRect(0, 0, width, 6 * s);
  const glyph = (name, x, y, size, color) => {
    paths[name] ||= new Path2D(ADVENTURE_ICONS[name]);
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.fillStyle = color; ctx.fill(paths[name], 'evenodd'); ctx.restore();
  };
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3e7d3'; ctx.font = `600 ${26 * s}px system-ui,sans-serif`;
  ctx.fillText(view.title, 16 * s, 30 * s, width - 32 * s);
  let y = 66 * s;
  ctx.font = `${20 * s}px system-ui,sans-serif`;
  for (const o of view.objectives.slice(0, 4)) {
    glyph(o.icon, 16 * s, y - 11 * s, 22 * s, o.done ? '#9be38a' : tone);
    ctx.globalAlpha = o.waived ? .5 : 1; ctx.fillStyle = '#f3e7d3';
    ctx.fillText(o.label, 46 * s, y, width - 150 * s);
    ctx.textAlign = 'right'; ctx.fillText(o.done ? '✓' : `${o.have}/${o.need}`, width - 16 * s, y); ctx.textAlign = 'left';
    ctx.globalAlpha = 1; y += 34 * s;
  }
  const t = view.telegraphs[0];
  if (t && y < height - 10 * s) { ctx.fillStyle = '#ffcf7a'; glyph(t.kind === 'star' ? 'star' : 'skull', 16 * s, y - 11 * s, 22 * s, '#ffcf7a'); ctx.fillText(`${t.label} — ${t.secondsLeft}s`, 46 * s, y, width - 62 * s); }
  ctx.restore();
  return true;
}
