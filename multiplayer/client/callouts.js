// Brann's Forge — floating callouts. Failures read like an MMO's red error text: a short,
// standalone line high in the centre that fades on its own, never a box over the hotbar.
// Info messages (gifts, Bloom, copies) use the same lane in warm parchment, under the errors.
// Pure presentation: no game state, no input, pointer-events off.
//
//   const c = createCallouts({ mount, info: toastElement });
//   c.error('You are not holding an item. Pick one up before trying to drop or throw it.');
//   c.info('Rising to the heavens…');

const MAX_ERRORS = 3;
const ERROR_MS = 1800, HINT_MS = 900, INFO_MS = 3400, FADE_MS = 500;

// "Headline. Recovery hint." → the headline is the red line, the hint sits small beneath it.
export function splitFailure(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/^(.+?[.!?…])\s+(?=[A-Z“"(])(.+)$/s);
  if (!m) return { headline: s, hint: '' };
  return { headline: m[1], hint: m[2] };
}

export function createCallouts({ mount, info = null, now = () => performance.now() } = {}) {
  if (!mount) throw new Error('createCallouts: mount is required');
  const lane = document.createElement('div');
  lane.className = 'callouts';
  const errors = document.createElement('div');
  errors.className = 'callout-errors';
  errors.setAttribute('role', 'alert');
  errors.setAttribute('aria-live', 'assertive');
  lane.append(errors);
  if (info) { info.classList.add('callout-info'); lane.append(info); }
  mount.append(lane);
  let infoTimer = 0;

  function retire(line) {
    clearTimeout(line._t);
    line.classList.add('out');
    line._t = setTimeout(() => line.remove(), FADE_MS);
  }

  function error(text) {
    const { headline, hint } = splitFailure(text);
    if (!headline) return;
    // Repeating the same failure re-arms the line instead of stacking duplicates.
    let line = [...errors.children].find(n => n.dataset.headline === headline && !n.classList.contains('out'));
    if (line) {
      line.classList.remove('pulse'); void line.offsetWidth; line.classList.add('pulse');
    } else {
      line = document.createElement('div');
      line.className = 'callout-error';
      line.dataset.headline = headline;
      const h = document.createElement('span');
      h.className = 'callout-headline';
      h.textContent = headline;
      line.append(h);
      if (hint) {
        const p = document.createElement('span');
        p.className = 'callout-hint';
        p.textContent = hint;
        line.append(p);
      }
      errors.prepend(line);
      const live = [...errors.children].filter(n => !n.classList.contains('out'));
      for (const old of live.slice(MAX_ERRORS)) retire(old);
    }
    clearTimeout(line._t);
    line._t = setTimeout(() => retire(line), ERROR_MS + (hint ? HINT_MS : 0));
    line._at = now();
  }

  function showInfo(text) {
    if (!info) return;
    const value = String(text ?? '');
    if (info.textContent !== value) info.textContent = value;
    info.classList.add('show');
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => info.classList.remove('show'), INFO_MS);
  }

  function clear() {
    for (const n of [...errors.children]) { clearTimeout(n._t); n.remove(); }
    if (info) { clearTimeout(infoTimer); info.classList.remove('show'); }
  }

  function dispose() { clear(); lane.remove(); }

  return { error, info: showInfo, clear, dispose, el: lane };
}
