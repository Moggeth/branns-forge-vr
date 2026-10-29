// World creation menu: pick which world a new room starts in. The Great Wilds is the single-player home and comes
// first; Brann's Valley is the classic hand-built map. Worlds start as your own solo world unless "Open to friends"
// is ticked, which lights a public room instead. Only a small descriptor leaves this menu ({kind, seed, preset});
// every player regenerates the same land from it.
import {PRESETS, PRESET_IDS} from '../shared/worldgen/presets.js';
import {friendlySeed, cleanSeed} from '../shared/worldgen/random.js';
import {worldDescriptor} from '../shared/worldgen/registry.js';
import './world-menu.css';

const MODES = [
  {id: 'wilds', title: 'The Great Wilds', tag: 'Recommended', blurb: 'A seeded land kilometres wide. Rivers run to the sea, forests climb the hills, and danger grows the further you roam from the village.'},
  {id: 'arena', title: "Brann's Valley", tag: 'Classic', blurb: 'The hand-built valley: the forge, Dawnhold and Grumblekeep. The keeps are at peace unless you start the keep war.'},
  {id: 'expedition', title: 'Expedition Roguelite', tag: 'Experimental', blurb: 'Short seeded runs out of the forge camp. Pick a route, take boons, and decide when to push on or head home.'},
  {id: 'underways', title: 'The Underways', tag: 'Experimental', blurb: 'Caves beneath the Wilds: delve a procedural dungeon to its finale and bring the treasure home.'},
];
// Little painted scenes for each card (inline SVG, no downloads). Same sunlit palette as the title screen.
const ART = {
  wilds: `<rect width="160" height="72" fill="#86c9ee"/><circle cx="118" cy="30" r="11" fill="#fff4cf"/><circle cx="118" cy="30" r="20" fill="#fff4cf" opacity=".3"/>
    <path d="M0 44 22 30 38 38 58 24 80 38 98 30 120 40 140 28 160 36V72H0Z" fill="#a9bfe0"/><path d="M58 24 64 29 58 28 52 30Z M140 28 146 32 136 32Z" fill="#fff"/>
    <path d="M0 52C30 42 60 46 90 50S140 46 160 50V72H0Z" fill="#8cc865"/><path d="M84 50C80 56 92 60 84 72H98C102 62 92 58 96 50Z" fill="#6cc6ef"/>
    <path d="M0 60C40 54 70 60 100 62S140 58 160 60V72H0Z" fill="#4f9a42"/>
    <g class="wm-art-sway"><rect x="25" y="46" width="3" height="9" fill="#6b4426"/><circle cx="26.5" cy="44" r="7" fill="#4f9a40"/><rect x="132" y="48" width="3" height="8" fill="#6b4426"/><circle cx="133.5" cy="46" r="6" fill="#5fae48"/><circle cx="24" cy="42" r="1.4" fill="#e0443a"/></g>`,
  arena: `<rect width="160" height="72" fill="#f6c98f"/><circle cx="80" cy="26" r="16" fill="#fff0c4" opacity=".7"/>
    <path d="M0 50C30 40 60 44 80 46S130 40 160 48V72H0Z" fill="#7cbf58"/><path d="M0 60C40 54 120 54 160 60V72H0Z" fill="#4f9a42"/>
    <g><rect x="14" y="30" width="22" height="22" fill="#d9cfbf"/><path d="M12 30h26v-5h-4v3h-4v-3h-4v3h-4v-3h-4v3h-2z" fill="#c8bca8"/><path d="M25 16v10" stroke="#6b4426" stroke-width="1.4"/><path d="M25 16h9l-2 3 2 3h-9z" fill="#4f9ee8"/><rect x="22" y="42" width="6" height="10" rx="3" fill="#6b4426"/></g>
    <g><rect x="124" y="30" width="22" height="22" fill="#8f877e"/><path d="M122 30h26v-5h-4v3h-4v-3h-4v3h-4v-3h-4v3h-2z" fill="#7a736b"/><path d="M135 16v10" stroke="#4a3426" stroke-width="1.4"/><path d="M135 16h9l-2 3 2 3h-9z" fill="#d8513a"/><rect x="132" y="42" width="6" height="10" rx="3" fill="#3a2a20"/></g>
    <g><path d="M66 48V38l14-8 14 8v10z" fill="#ead9b9"/><path d="M63 39l17-10 17 10-2 2-15-9-15 9z" fill="#c9533a"/><rect x="87" y="26" width="5" height="10" fill="#8d7d6a"/><rect x="76" y="40" width="8" height="8" rx="4" fill="#ffb347"/>
    <circle class="wm-art-puff" cx="89.5" cy="24" r="3" fill="#fff"/><circle class="wm-art-puff wm-art-puff-2" cx="89.5" cy="24" r="3" fill="#fff"/></g>`,
  expedition: `<rect width="160" height="72" fill="#9fd3ee"/><path d="M0 40 30 26 54 36 80 22 110 34 136 24 160 32V72H0Z" fill="#b8c9e4"/>
    <path d="M0 50C30 44 70 50 100 46S140 44 160 48V72H0Z" fill="#93cc68"/><path d="M0 62C50 56 110 58 160 62V72H0Z" fill="#5aa548"/>
    <path d="M18 64C40 60 46 52 70 54S104 48 116 42 136 34 142 30" fill="none" stroke="#fff6e0" stroke-width="2.2" stroke-dasharray="3 4" stroke-linecap="round"/>
    <g transform="translate(18 62)"><path d="M-6 3 6 3 0-1z" fill="#6b4426"/><path class="wm-art-flame" d="M0-12C4-7 4-3 0 1-4-3-4-7 0-12Z" fill="#ffb347"/><path class="wm-art-flame" d="M0-7C2-4 2-2 0 0-2-2-2-4 0-7Z" fill="#fff0b8"/></g>
    <g transform="translate(142 30)"><path d="M0 0V-16" stroke="#6b4426" stroke-width="1.6"/><path class="wm-art-flag" d="M0-16h11l-3 3.5 3 3.5H0z" fill="#e8692b"/></g>
    <g fill="#ffd166"><path d="M70 49l1.4 3 3 .4-2.2 2 .6 3-2.8-1.5-2.8 1.5.6-3-2.2-2 3-.4z"/><path d="M110 37l1 2.2 2.4.3-1.8 1.6.5 2.3-2.1-1.2-2.1 1.2.5-2.3-1.8-1.6 2.4-.3z"/></g>`,
  underways: `<rect width="160" height="72" fill="#2a3446"/><path d="M0 0H160V72H0Z" fill="#3b4558"/><path d="M0 18C20 8 40 14 60 6S110 4 130 10 150 6 160 8V0H0Z" fill="#525d72"/>
    <path d="M40 72V46C40 26 58 16 80 16S120 26 120 46V72Z" fill="#11151f"/><path d="M48 72V48C48 32 62 24 80 24S112 32 112 48V72Z" fill="#070a10"/>
    <ellipse class="wm-art-glow" cx="80" cy="60" rx="40" ry="14" fill="#7fd3ff" opacity=".22"/>
    <g><path d="M60 72 64 52 69 72Z" fill="#8fdcff"/><path d="M68 72 74 44 79 72Z" fill="#b8ecff"/><path d="M88 72 92 50 97 72Z" fill="#7fd0ff"/><path d="M95 72 99 58 103 72Z" fill="#5bb8f0"/></g>
    <g><path d="M10 72 22 54 34 72Z" fill="#6a7486"/><path d="M128 72 140 50 156 72Z" fill="#6a7486"/></g>
    <g transform="translate(132 40)"><path d="M0-10V-2" stroke="#3a2a20" stroke-width="1.2"/><rect x="-3.5" y="-2" width="7" height="9" rx="2" fill="#ffcf6e"/><circle class="wm-art-glow" r="12" cy="2" fill="#ffcf6e" opacity=".25"/></g>`,
};
/**
 * createWorldMenu({parent, onStart, available})
 *   onStart({kind:'arena', friends} | {kind, world, friends}) starts a new world; friends:false means solo.
 *   available(kind) -> true | string  (a string explains why a mode is not ready yet)
 */
export function createWorldMenu({parent = document.body, onStart = () => {}, available = () => true, mountLauncher = null} = {}) {
  const root = document.createElement('div');
  root.className = 'wm-backdrop'; root.hidden = true;
  root.innerHTML = `
    <section class="wm-dialog" role="dialog" aria-modal="true" aria-labelledby="wmTitle">
      <header class="wm-head">
        <div><p class="wm-kicker">New world</p><h2 id="wmTitle" class="wm-title">Where shall the forge be lit?</h2></div>
        <button type="button" class="wm-close" aria-label="Close">×</button>
      </header>
      <div class="wm-modes" role="radiogroup" aria-label="World">
        ${MODES.map(m => `<button type="button" class="wm-mode" role="radio" aria-checked="false" data-mode="${m.id}">
          <svg class="wm-art" viewBox="0 0 160 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${ART[m.id]}</svg>
          <span class="wm-mode-top"><span class="wm-mode-title">${m.title}</span><span class="wm-tag" data-tag="${m.tag.toLowerCase()}">${m.tag}</span></span>
          <span class="wm-mode-blurb">${m.blurb}</span><span class="wm-mode-note" hidden></span></button>`).join('')}
      </div>
      <div class="wm-body">
      <p class="wm-chosen" aria-live="polite"></p>
      <div class="wm-detail" data-for="wilds" hidden>
        <div class="wm-form">
          <label class="wm-field"><span>Landscape</span>
            <select class="wm-preset">${PRESET_IDS.map(id => `<option value="${id}">${PRESETS[id].name}</option>`).join('')}</select></label>
          <p class="wm-preset-blurb"></p>
          <label class="wm-field"><span>Seed</span>
            <span class="wm-seed-row"><input class="wm-seed" maxlength="48" spellcheck="false" autocomplete="off" aria-describedby="wmSeedHelp">
            <button type="button" class="wm-dice" aria-label="New random seed" title="New random seed">⚄</button></span></label>
          <p id="wmSeedHelp" class="wm-help">Same seed and landscape, same world, for everyone. Share it with friends.</p>
        </div>
        <figure class="wm-map"><span class="wm-map-frame"><canvas width="224" height="224" aria-label="Map preview"></canvas><span class="wm-compass" aria-hidden="true">N</span></span><figcaption class="wm-facts">Drawing the map…</figcaption></figure>
      </div>
      <div class="wm-detail wm-steps-detail" data-for="arena" hidden>
        <ul class="wm-steps">
          <li><span class="wm-step-n">1</span><span><b>Start by Brann’s forge</b>, with taverns, orchards and ore close by.</span></li>
          <li><span class="wm-step-n">2</span><span><b>Visit Dawnhold and Grumblekeep</b>, the two keeps, at peace for now.</span></li>
          <li><span class="wm-step-n">3</span><span><b>Start the keep war</b> from the Menu whenever you fancy a fight.</span></li>
        </ul>
      </div>
      <div class="wm-detail wm-steps-detail" data-for="expedition" hidden>
        <ul class="wm-steps">
          <li><span class="wm-step-n">1</span><span><b>Choose a run</b> and its seed on the next screen.</span></li>
          <li><span class="wm-step-n">2</span><span><b>Pick a route</b> out of the forge camp and take boons as you go.</span></li>
          <li><span class="wm-step-n">3</span><span><b>Push on or head home</b> with what you found. Every run is new land.</span></li>
        </ul>
        <div class="wm-launcher"></div>
      </div>
      </div>
      <footer class="wm-foot">
        <p class="wm-foot-note"></p>
        <label class="wm-friends" title="Off: your own world on this device. On: a public world friends can join."><input type="checkbox" class="wm-friends-box" role="switch"><span class="wm-switch" aria-hidden="true"></span><span class="wm-friends-text"><span>Open to friends</span><small class="wm-friends-sub">Off: just you, on this device</small></span></label>
        <button type="button" class="btn btn-quiet wm-cancel">Back</button>
        <button type="button" class="btn btn-primary wm-go">Start this world</button>
      </footer>
    </section>`;
  parent.appendChild(root);
  const $ = s => root.querySelector(s);
  const preset = $('.wm-preset'), seed = $('.wm-seed'), canvas = $('canvas'), facts = $('.wm-facts'), go = $('.wm-go');
  let mode = 'wilds', previewId = 0, timer = 0, worker = null, launcherMounted = false;
  seed.value = friendlySeed(Math.floor(Math.random() * 1e6));
  const descriptor = kind => worldDescriptor({kind, seed: cleanSeed(seed.value), preset: preset.value});

  function select(next) {
    mode = next;
    for (const b of root.querySelectorAll('.wm-mode')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    for (const d of root.querySelectorAll('.wm-detail')) d.hidden = !(d.dataset.for === mode || (mode === 'underways' && d.dataset.for === 'wilds'));
    const ok = available(mode);
    go.disabled = ok !== true; $('.wm-foot-note').textContent = ok === true ? '' : ok;
    $('.wm-chosen').textContent = MODES.find(m => m.id === mode)?.blurb || '';
    go.textContent = mode === 'arena' ? 'Start in the valley' : mode === 'expedition' ? 'Start a run' : mode === 'underways' ? 'Start by a cave' : 'Start this world';
    if (mode === 'expedition' && mountLauncher && !launcherMounted) { launcherMounted = true; mountLauncher($('.wm-launcher')); }
    if (mode === 'wilds' || mode === 'underways') schedulePreview();
  }
  function schedulePreview() { clearTimeout(timer); timer = setTimeout(preview, 250); }
  function preview() {
    $('.wm-preset-blurb').textContent = PRESETS[preset.value]?.blurb || '';
    const id = ++previewId; facts.textContent = 'Drawing the map…'; canvas.classList.add('wm-busy');
    try { worker ||= new Worker(new URL('./world-preview-worker.js', import.meta.url), {type: 'module'}); }
    catch { facts.textContent = 'The map preview is not available in this browser.'; return; }
    worker.onmessage = ({data}) => {
      if (data.id !== previewId) return;
      canvas.classList.remove('wm-busy');
      if (data.error) { facts.textContent = 'Could not draw this world.'; return; }
      canvas.width = data.width; canvas.height = data.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0);
      const f = data.facts;
      facts.textContent = `You start in ${f.start}. ${f.rivers} rivers, ${f.lakes} lakes, ${f.settlements} settlements, ${f.caves} caves.`;
    };
    worker.postMessage({id, seed: cleanSeed(seed.value), preset: preset.value, px: 224});
  }
  root.addEventListener('click', e => {
    const m = e.target.closest('.wm-mode'); if (m) { select(m.dataset.mode); return; }
    if (e.target === root || e.target.closest('.wm-close,.wm-cancel')) close();
  });
  $('.wm-dice').addEventListener('click', () => { seed.value = friendlySeed(Math.floor(Math.random() * 1e6)); schedulePreview(); });
  preset.addEventListener('change', schedulePreview);
  $('.wm-friends-box').addEventListener('change', e => { $('.wm-friends-sub').textContent = e.target.checked ? 'On: friends can find and join it' : 'Off: just you, on this device'; });
  seed.addEventListener('input', schedulePreview);
  seed.addEventListener('blur', () => { seed.value = cleanSeed(seed.value); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  go.addEventListener('click', () => {
    if (available(mode) !== true) return;
    close();
    const friends = $('.wm-friends-box').checked;
    onStart(mode === 'arena' ? {kind: 'arena', friends} : {kind: mode, world: descriptor(mode), friends});
  });
  function open(initial = mode) { root.hidden = false; select(initial); requestAnimationFrame(() => root.querySelector(`.wm-mode[data-mode="${mode}"]`)?.focus()); }
  function close() { root.hidden = true; }
  return {open, close, isOpen: () => !root.hidden, dispose() { clearTimeout(timer); worker?.terminate(); root.remove(); }};
}
