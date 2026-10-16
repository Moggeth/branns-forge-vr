// World creation menu: pick which world a new room starts in. Brann's Valley (the classic arena) stays the default;
// the generated worlds are labelled experimental. Only a small descriptor leaves this menu ({kind, seed, preset});
// every player regenerates the same land from it.
import {PRESETS, PRESET_IDS} from '../shared/worldgen/presets.js';
import {friendlySeed, cleanSeed} from '../shared/worldgen/random.js';
import {worldDescriptor} from '../shared/worldgen/registry.js';
import './world-menu.css';

const MODES = [
  {id: 'arena', title: "Brann's Valley", tag: 'Classic', blurb: 'The hand-built valley: the forge, Dawnhold and Grumblekeep, and the battle for the pylons.'},
  {id: 'wilds', title: 'The Great Wilds', tag: 'Experimental', blurb: 'A seeded land kilometres wide. Rivers run to the sea, forests climb the hills, and danger grows the further you roam from the village.'},
  {id: 'expedition', title: 'Expedition Roguelite', tag: 'Experimental', blurb: 'Short seeded runs out of the forge camp. Pick a route, take boons, and decide when to push on or head home.'},
  {id: 'underways', title: 'The Underways', tag: 'Experimental', blurb: 'Caves beneath the Wilds: delve a procedural dungeon to its finale and bring the treasure home.'},
];

/**
 * createWorldMenu({parent, onStart, available})
 *   onStart({kind:'arena'} | {kind, world}) starts a new room in that world.
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
          <span class="wm-mode-top"><span class="wm-mode-title">${m.title}</span><span class="wm-tag" data-tag="${m.tag.toLowerCase()}">${m.tag}</span></span>
          <span class="wm-mode-blurb">${m.blurb}</span><span class="wm-mode-note" hidden></span></button>`).join('')}
      </div>
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
        <figure class="wm-map"><canvas width="224" height="224" aria-label="Map preview"></canvas><figcaption class="wm-facts">Drawing the map…</figcaption></figure>
      </div>
      <div class="wm-detail" data-for="expedition" hidden><div class="wm-launcher"></div></div>
      <footer class="wm-foot">
        <p class="wm-foot-note"></p>
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
  seed.addEventListener('input', schedulePreview);
  seed.addEventListener('blur', () => { seed.value = cleanSeed(seed.value); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  go.addEventListener('click', () => {
    if (available(mode) !== true) return;
    close();
    onStart(mode === 'arena' ? {kind: 'arena'} : {kind: mode, world: descriptor(mode)});
  });
  function open(initial = mode) { root.hidden = false; select(initial); requestAnimationFrame(() => root.querySelector(`.wm-mode[data-mode="${mode}"]`)?.focus()); }
  function close() { root.hidden = true; }
  return {open, close, isOpen: () => !root.hidden, dispose() { clearTimeout(timer); worker?.terminate(); root.remove(); }};
}
