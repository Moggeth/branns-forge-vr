// Continuous-integration runner: standalone Node checks that need no browser,
// Godot proof server, live network or Windows-only path. Each runs in its own
// process so module state never leaks between checks.
//   node tests/ci.mjs          blocking suite (must pass)
//   node tests/ci.mjs --stale  checks known to fail on main as of 2026-10-03
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';

const suite = [
  'mobile-render-budget','rigid-weapon-batch',
  'room-directory','room-capacity','../peer/capacity-test','room-service-gate','cloud-directory-lifecycle','public-room-directory','peer-encoding','frame-inbox','session-publication','terrain-geometry','network-capacity','battle-mode','battle-presentation','hero-pose-performance',
  'proximity-voice','voice-recovery','voice-topology','voice-zones','ice-servers','battle-model','checkpoint-delta','host-handover','adventure-capacity','battle-renderer-contact',
  'enemy-embed-lifecycle','session-held-ore','session-save-recovery','peer-channel-recovery','timberline-sight-cache','phoenix-flare-view','input-reset',
  'ability-readiness','ability-warmup','shared-skin-palettes','merged-creature-skins','home-light-stability','state-codec-performance','entity-id-allocation','action-feedback','callouts','resource-bar','forge-smelting','axe-cleave','axe-luminance','meadow-cover','meadow-timing-guard','ore-veins',
  'timberline-manned','timberline-long','timberline-stuck-view','adventure','asset-dependencies','asset-pose','combat',
  'combat-performance','combat-session','combat-view','combat-view-perf','contact-feedback',
  'contact-feedback-shared','creature-life-death','crossbow-cords','embedded-skull',
  'emergence-polish','enemy-behaviour','enemy-shadow-budget','expedition-hud','expedition-integration',
  'expedition-presentation.test','fire','wyrmspout','wyrmspout-tank','weapon-inspect','emberdew','fire-authored-samples','fire-performance',
  'fire-spatial-phoenix','fire-warmup','forest-resource-integration','forge-protection','foundation-tiles',
  'geode-emberdew-effects','geode-light','glb','hero-equipment','hero-view','hurt-feedback','hold-overlays',
  'impact-presentation','import-performance','interaction-cue-view.test','interaction-cue.test',
  'inventions-review','legacy-trees','lobby-ui.test','lumber-collection','lumber-session',
  'material-audio','material-economy','meteor-creature','mining-geometry',
  'orchard-presentation','phoenix-bank','pick-luminance','placement-preview',
  'placement-rotation','placement-session','progressive-sunder','quality-performance',
  'ranged-fx','phoenix-aim-continuity','golden-bolt-collection','saved-worlds-chooser.test','session','session-reload','settlement-budget',
  'settlement-view','shield-interception','siegebird-aim','siegebird-ballistics',
  'siegebird-flock','siegebird-songbird','siegebird-wind','simulation','skeleton-performance','skin-bounds',
  'skull-surface-regression','solo-session','spell-presentation','spell-spectacle',
  'spell-availability','spell-targeting','starting-world','landmark-performance','waygate','geode-outcrop','watch-beacon','heartstone','sanctuary-kit','state-codec','terrain-presentation','terrain-ray',
  'terrain-specials','terrain-storage-budget','terrain-triangles','testing-supplies',
  'throw-momentum-capacity','timber-continuity','timberline-integration','touch-input',
  'tree-growth','tree-harvest-warmup','mining-warmup','tree-integration','tree-land-timing','tree-materials','tree-batch-upload','vr-adventure-panel',
  'vr-input-policy','weapon-controller','weapon-motion','held-sway','weapon-swap','weapon-readiness','wood-audio',
  'world-content','world-saves','enemy-motion','enemy-interp','golem-presentation','earth-spells','smooth-terrain','grove-growth','spell-schools','remains-physics','bone-physics',
  'phoenix-flight','phoenix-ignite','phoenix-light','phoenix-carry','emberwing-motion','phoenix-flare','pick-wall-motion','stumplings','day-night-weather','rainfall','patch-notes','quick-play','apple-snack','apple-feast','home-bases','siege-damage','keep-ring','home-workshop','home-base-kit','home-ballista','forgeling-kit','hero-progress','home-town','home-town-view','dragon-streak','heavy-launcher','turn-phone','stormreel','sound-pass','map-layout',
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
  const run = spawnSync(process.execPath, [`tests/${name}.mjs`], {cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 180_000});
  const ok = run.status === 0;
  console.log(`${ok ? 'pass' : 'FAIL'} ${((performance.now() - t) / 1000).toFixed(1).padStart(5)}s ${name}`);
  if (!ok) {
    failures.push(name);
    console.log(`${run.stdout}${run.stderr}`.trim().split('\n').slice(-25).map(l => `    ${l}`).join('\n'));
  }
}
console.log(`\n${names.length - failures.length}/${names.length} passed in ${((performance.now() - started) / 1000).toFixed(1)}s`);
if (failures.length) { console.log(`failed: ${failures.join(', ')}`); process.exit(1); }
