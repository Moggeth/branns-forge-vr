// run inside page (perf-bench --breakdown scripts/perf-dom.js): what the page restyles every frame.
// Counts DOM mutations per element for 4 s and lists running CSS animations/transitions.
(async () => {
  const name = el => { if (!el || el.nodeType !== 1) el = el?.parentElement; if (!el) return '?'; let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; if (el.classList?.length) s += '.' + [...el.classList].slice(0, 3).join('.'); const p = el.parentElement; return (p ? (p.id ? '#' + p.id : p.classList?.[0] ? '.' + p.classList[0] : p.tagName.toLowerCase()) + ' > ' : '') + s; };
  const counts = new Map(); let frames = 0, run = true;
  const tick = () => { frames++; if (run) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const mo = new MutationObserver(list => { for (const m of list) { const k = m.type + (m.attributeName ? ':' + m.attributeName : '') + ' ' + name(m.target); counts.set(k, (counts.get(k) || 0) + 1); } });
  mo.observe(document.documentElement, {subtree: true, attributes: true, childList: true, characterData: true});
  await new Promise(r => setTimeout(r, 4000)); run = false; mo.disconnect();
  const anims = document.getAnimations().filter(a => a.playState === 'running').map(a => { const t = a.effect?.target; const kf = a.effect?.getKeyframes?.() || []; return (a.animationName || a.transitionProperty || a.constructor.name) + ' [' + [...new Set(kf.flatMap(k => Object.keys(k).filter(x => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))].join(',') + '] ' + name(t) + (t && t.getClientRects().length === 0 ? ' (not rendered)' : ''); });
  const layers = [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return (s.backdropFilter && s.backdropFilter !== 'none') || s.willChange !== 'auto'; }).map(e => name(e) + ' ' + getComputedStyle(e).backdropFilter + ' wc=' + getComputedStyle(e).willChange + (e.getClientRects().length ? '' : ' (hidden)'));
  return {frames, mutations: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60), anims, layers, elements: document.querySelectorAll('*').length};
})()
