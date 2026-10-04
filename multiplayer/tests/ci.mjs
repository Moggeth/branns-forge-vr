// Continuous-integration runner: standalone Node checks that need no browser,
// Godot proof server, live network or Windows-only path. Each runs in its own
// process so module state never leaks between checks.
//   node tests/ci.mjs          blocking suite (must pass)
//   node tests/ci.mjs --stale  checks known to fail on main as of 2026-10-03
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';

const suite = [
  'ability-readiness','action-feedback','callouts','forge-smelting','axe-cleave','axe-luminance','meadow-cover','ore-veins',
  'timberline-manned','timberline-long','timberline-stuck-view','adventure','asset-dependencies','asset-pose','combat',
  'combat-performance','combat-session','combat-view','combat-view-perf','contact-feedback',
  'contact-feedback-shared','creature-life-death','crossbow-cords','embedded-skull',
  'emergence-polish','enemy-behaviour','enemy-shadow-budget','expedition-hud','expedition-integration',
  'expedition-presentation.test','fire','fire-authored-samples','fire-performance',
  'fire-spatial-phoenix','forest-resource-integration','forge-protection','foundation-tiles',
  'geode-emberdew-effects','geode-light','glb','hero-equipment','hero-view','hold-overlays',
  'impact-presentation','import-performance','interaction-cue-view.test','interaction-cue.test',
  'inventions-review','legacy-trees','lobby-ui.test','lumber-collection','lumber-session',
  'material-audio','material-economy','meteor-creature','mining-geometry',
  'orchard-presentation','phoenix-bank','pick-luminance','placement-preview',
  'placement-rotation','placement-session','progressive-sunder','quality-performance',
  'ranged-fx','saved-worlds-chooser.test','session','session-reload','settlement-budget',
  'settlement-view','shield-interception','siegebird-aim','siegebird-ballistics',
  'siegebird-flock','siegebird-songbird','siegebird-wind','simulation','skeleton-performance','skin-bounds',
  'skull-surface-regression','solo-session','spell-presentation','spell-spectacle',
  'spell-availability','spell-targeting','starting-world','state-codec','terrain-presentation','terrain-ray',
  'terrain-specials','terrain-storage-budget','terrain-triangles','testing-supplies',
  'throw-momentum-capacity','timber-continuity','timberline-integration','touch-input',
  'tree-growth','tree-integration','tree-land-timing','tree-materials','vr-adventure-panel',
  'vr-input-policy','weapon-controller','weapon-motion','held-sway','weapon-readiness','wood-audio',
  'world-content','world-saves','enemy-motion','golem-presentation','earth-spells','pick-wall-motion','remains-physics','stumplings',
];

// Assertions that disagree with current gameplay (or need assets/tools absent in CI).
// Fix each one and move it into `suite`; never move a passing check out of `suite`.
const stale = [
  'batching','creature-state','dom-contract','expedition-persistence',
  'expedition-real-play','forge','meteor-resources','solo-settlement',
  'fire-presentation', // needs assets/asset-lab gltf-validator install
];

// Not listed: browser-*.mjs and cloud-transport (Playwright), run/load/network/gateway/production
// (Godot proof server), and the *-fixtures/no-ice-fixture helpers.
const names = process.argv.includes('--stale') ? stale : suite;
const failures = [];
const started = performance.now();
for (const name of names) {
  const t = performance.now();
  const run = spawnSync(process.execPath, [`tests/${name}.mjs`], {encoding: 'utf8', timeout: 180_000});
  const ok = run.status === 0;
  console.log(`${ok ? 'pass' : 'FAIL'} ${((performance.now() - t) / 1000).toFixed(1).padStart(5)}s ${name}`);
  if (!ok) {
    failures.push(name);
    console.log(`${run.stdout}${run.stderr}`.trim().split('\n').slice(-25).map(l => `    ${l}`).join('\n'));
  }
}
console.log(`\n${names.length - failures.length}/${names.length} passed in ${((performance.now() - started) / 1000).toFixed(1)}s`);
if (failures.length) { console.log(`failed: ${failures.join(', ')}`); process.exit(1); }
