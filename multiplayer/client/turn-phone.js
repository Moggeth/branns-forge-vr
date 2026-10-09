// "Turn for more adventure": a friendly prompt for phones held upright, plus fullscreen on the
// first tap after the phone is turned sideways. Browsers only grant fullscreen from a tap, and
// iPhone Safari never grants it to pages, so every step degrades to "keep playing as you are".
import './turn-phone.css';
import {shouldShowTurnPrompt, shouldAutoFullscreen} from './turn-phone-policy.js';
export {shouldShowTurnPrompt, shouldAutoFullscreen};

const DISMISS_KEY = 'brann.turnPrompt';

const SCENE = `
<svg class="tp-art" viewBox="24 24 152 152" aria-hidden="true">
  <defs>
    <clipPath id="tpScreen"><rect x="72" y="44" width="56" height="112" rx="6"/></clipPath>
    <linearGradient id="tpSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb7e6"/><stop offset=".7" stop-color="#ffd9a0"/></linearGradient>
    <radialGradient id="tpGlow"><stop offset="0" stop-color="#bfe3ff"/><stop offset="1" stop-color="#7fb6e8" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="tp-arrow" fill="none" stroke="#ecd29a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 62 A58 58 0 0 1 162 112"/><path d="M154 104 l8 9 l6 -11"/>
  </g>
  <g class="tp-phone">
    <rect x="66" y="38" width="68" height="124" rx="12" fill="#2a2118" stroke="#c9a45c" stroke-width="2.5"/>
    <g clip-path="url(#tpScreen)">
      <g class="tp-world">
        <rect x="30" y="30" width="140" height="140" fill="url(#tpSky)"/>
        <circle class="tp-sun" cx="60" cy="86" r="7" fill="#ffe08a"/>
        <path d="M30 116 L52 92 L66 104 L84 84 L104 106 L122 88 L146 108 L170 94 L170 170 L30 170Z" fill="#8fb4c9" opacity=".7"/>
        <path d="M30 122 Q62 108 96 120 T170 116 L170 170 L30 170Z" fill="#7fbf5a"/>
        <path d="M30 132 Q80 124 120 131 T170 128 L170 170 L30 170Z" fill="#5a9c43"/>
        <g class="tp-tree" transform="translate(8 0)"><rect x="52" y="108" width="4" height="16" rx="1.5" fill="#7a5233"/><circle cx="54" cy="104" r="10" fill="#4f9a3c"/><circle cx="48" cy="109" r="6" fill="#5fae47"/><circle cx="60" cy="108" r="6.5" fill="#5fae47"/><circle cx="51" cy="101" r="1.6" fill="#e2453c"/><circle cx="58" cy="106" r="1.6" fill="#e2453c"/></g>
        <g class="tp-crystals"><circle cx="146" cy="118" r="14" fill="url(#tpGlow)" class="tp-crystal-glow"/><path d="M138 128 L141 112 L145 128Z M143 128 L148 106 L152 128Z M150 128 L154 115 L157 128Z" fill="#8cc4f2" stroke="#e4f4ff" stroke-width=".8"/></g>
        <path class="tp-bird" d="M120 72 q3 -3 6 0 q3 -3 6 0" fill="none" stroke="#3b3a44" stroke-width="1.4" stroke-linecap="round"/>
        <g class="tp-hero">
          <ellipse cx="100" cy="133" rx="6" ry="1.6" fill="#000" opacity=".18"/>
          <rect x="96" y="120" width="8" height="10" rx="3" fill="#e8692b"/>
          <rect x="96.5" y="129" width="3" height="4" rx="1" fill="#4a3424"/><rect x="100.5" y="129" width="3" height="4" rx="1" fill="#4a3424"/>
          <circle cx="100" cy="115.5" r="4.6" fill="#f2c79a"/>
          <path d="M95.4 114.5 q4.6 -6 9.2 0 z" fill="#8a6a33"/>
          <circle cx="101.6" cy="115.6" r=".7" fill="#2a2118"/>
          <g class="tp-pick"><rect x="103.5" y="110" width="1.6" height="12" rx=".8" fill="#9c6b3f"/><path d="M99 110.5 Q104.3 106.5 109.6 110.5 L104.3 109Z" fill="#c9d4dc" stroke="#7fb6e8" stroke-width=".6"/></g>
        </g>
        <g class="tp-sparkles" fill="#fff4c4"><path d="M70 86 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2z"/><path d="M134 82 l1 2.6 l2.6 1 l-2.6 1 l-1 2.6 l-1 -2.6 l-2.6 -1 l2.6 -1z"/><path d="M118 98 l.8 2 l2 .8 l-2 .8 l-.8 2 l-.8 -2 l-2 -.8 l2 -.8z"/></g>
      </g>
    </g>
    <rect x="72" y="44" width="56" height="112" rx="6" fill="none" stroke="#14110e" stroke-width="1.5"/>
    <rect x="92" y="47" width="16" height="3" rx="1.5" fill="#14110e"/>
  </g>
</svg>`;

export function mountTurnPhone({doc = document, win = window} = {}) {
  const media = q => win.matchMedia?.(q) ?? {matches: false, addEventListener() {}};
  const coarse = media('(pointer: coarse)'), portraitQuery = media('(orientation: portrait)'), standaloneQuery = media('(display-mode: standalone), (display-mode: fullscreen)');
  const read = () => { try { return win.sessionStorage.getItem(DISMISS_KEY); } catch { return null; } };
  const write = value => { try { win.sessionStorage.setItem(DISMISS_KEY, value); } catch {} };
  // Automated browser checks set this so a portrait test phone isn't covered by the prompt.
  const quiet = () => !!win.__brannQuietTurnPrompt;
  const root = doc.documentElement;
  const fullscreenElement = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  const fullscreenSupported = () => !!((doc.fullscreenEnabled && root.requestFullscreen) || (doc.webkitFullscreenEnabled && root.webkitRequestFullscreen));
  const canLock = () => typeof win.screen?.orientation?.lock === 'function';
  const touch = () => coarse.matches || (win.navigator.maxTouchPoints || 0) > 0;
  const xr = () => doc.body.classList.contains('xr');
  const portrait = () => portraitQuery.matches;
  const standalone = () => standaloneQuery.matches || !!win.navigator.standalone;

  const el = doc.createElement('div');
  el.className = 'turn-phone'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'turnPhoneTitle');
  el.innerHTML = `<div class="tp-card">${SCENE}
    <h2 id="turnPhoneTitle" class="tp-title">Turn for more adventure!</h2>
    <p class="tp-line">The world is much bigger on its side.</p>
    <button type="button" class="btn btn-primary tp-go" hidden>Turn it for me</button>
    <button type="button" class="tp-stay">Stay upright</button>
  </div>`;
  doc.body.append(el);
  const go = el.querySelector('.tp-go');

  let dismissed = read() === 'dismissed', turnedOnce = false, armed = false;

  async function enterFullscreen() {
    try {
      if (root.requestFullscreen && doc.fullscreenEnabled) await root.requestFullscreen({navigationUI: 'hide'});
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      else return false;
    } catch { return false; }
    // Hold landscape while full screen so a tilt while lying down doesn't flip the view.
    if (canLock()) await win.screen.orientation.lock('landscape').catch(() => {});
    return true;
  }

  function render() {
    if (quiet()) { el.hidden = true; return; }
    const show = shouldShowTurnPrompt({touch: touch(), portrait: portrait(), narrow: win.innerWidth <= 600, xr: xr(), dismissed, turnedOnce});
    if (show === !el.hidden) return;
    el.hidden = !show;
    doc.body.classList.toggle('turn-phone-open', show);
    // "Turn it for me" works only where the page may go full screen and rotate itself (Android Chrome).
    go.hidden = !(fullscreenSupported() && canLock());
  }

  function orientationChanged() {
    if (!portrait()) {
      if (!turnedOnce && el.hidden === false) write('turned');
      turnedOnce = true;
      // Turning sideways is the signal: the next tap anywhere goes full screen.
      if (!fullscreenElement()) armed = true;
    } else armed = false;
    render();
  }

  let firing = false;
  function firstTap(event) {
    if (firing || quiet()) return;
    const onFullscreenButton = !!event.target?.closest?.('[data-touch-action="fullscreen"], .tp-card');
    if (!shouldAutoFullscreen({armed, touch: touch(), landscape: !portrait(), xr: xr(), standalone: standalone(), fullscreen: !!fullscreenElement(), supported: fullscreenSupported(), onFullscreenButton})) return;
    armed = false; firing = true;
    void enterFullscreen().finally(() => { firing = false; });
  }

  go.addEventListener('click', async () => {
    dismissed = true; write('dismissed');
    // Acknowledge the tap before awaiting platform permission/orientation promises.
    render();
    void enterFullscreen();
  });
  el.querySelector('.tp-stay').addEventListener('click', () => { dismissed = true; write('dismissed'); render(); });

  portraitQuery.addEventListener?.('change', orientationChanged);
  win.addEventListener('resize', render);
  // pointerup and touchend both carry the tap's permission to go full screen; whichever comes first wins.
  doc.addEventListener('pointerup', firstTap, true);
  doc.addEventListener('touchend', firstTap, true);

  // Already sideways on load: the first tap (usually Play) goes full screen.
  if (!portrait() && touch()) armed = true;
  if (read() === 'turned') turnedOnce = true;
  render();
  return {element: el, render, state: () => ({visible: !el.hidden, armed, dismissed, turnedOnce})};
}
