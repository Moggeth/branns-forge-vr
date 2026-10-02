// DOM contract test — Node built-ins only (no jsdom, no browser).
// Usage: node tests/dom-contract.mjs [path/to/index.html] [--expect-fail]
// Validates: unique ids, every id lobby.js / mobile-controls.js / lobby-ui.js looks up,
// superset of the reference ids + data attributes, weapon & spell catalogue coverage,
// keyboard-shortcut agreement with game.js, accessible names, ARIA references,
// handler coverage for every control, CONTROL-AUDIT.md coverage, and stale-text guards.
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const expectFail = args.includes('--expect-fail');
const target = resolve(root, args.find(a => !a.startsWith('--')) || 'index.html');
// Integrated copy: handlers are checked in the live sources; the id-preservation baseline is the pre-integration index.html.
const LIVE = {'reference/index.html': 'tests/fixtures/index.baseline.html', 'ui/lobby-ui.js': 'lobby-ui.js'};
const read = p => readFileSync(resolve(root, LIVE[p] || p.replace(/^reference\//, '')), 'utf8');

const html = readFileSync(target, 'utf8');
const refHtml = read('reference/index.html');
const lobbyJs = read('reference/lobby.js');
const gameJs = read('reference/client/game.js');
const mobileControlsJs = read('reference/client/mobile-controls.js');
const mobileUiJs = read('reference/client/mobile-ui.js');
const helperJs = existsSync(resolve(root, 'lobby-ui.js')) ? read('ui/lobby-ui.js') : '';
const audit = existsSync(resolve(root, 'CONTROL-AUDIT.md')) ? read('CONTROL-AUDIT.md') : '';
const {SPELLS, WEAPONS} = await import(pathToFileURL(resolve(root, 'shared/spells.js')).href);

const failures = [], passes = [];
const check = (name, problems) => { (problems.length ? failures : passes).push({name, problems}); };

// ---- tiny tag scanner (start tags only; comments stripped) ----
const strip = s => s.replace(/<!--[\s\S]*?-->/g, '');
function tags(src) {
  const out = [];
  for (const m of strip(src).matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    out.push({tag: m[1].toLowerCase(), attrs, index: m.index});
  }
  return out;
}
const T = tags(html), refT = tags(refHtml);
const ids = T.filter(t => 'id' in t.attrs).map(t => t.attrs.id);
const idSet = new Set(ids);
const literalIds = src => [...src.matchAll(/(?:\$|getElementById)\(\s*'([\w-]+)'\s*\)/g)].map(m => m[1]);

// 1. unique ids
check('ids are unique', ids.filter((id, i) => ids.indexOf(id) !== i).map(id => `duplicate id "${id}"`));

// 2. every id the scripts look up exists
for (const [name, src] of [['lobby.js', lobbyJs], ['mobile-controls.js', mobileControlsJs], ['lobby-ui.js', helperJs]]) {
  const wanted = [...new Set(literalIds(src))];
  check(`ids required by ${name} (${wanted.length})`, wanted.filter(id => !idSet.has(id)).map(id => `missing #${id}`));
}
const NEW_IDS = ['objectiveBanner', 'objectiveTitle', 'objectivePhase', 'objectiveText', 'objectiveProgress', 'objectiveProgressFill', 'objectiveProgressText',
  'objectiveStart', 'objectiveRestart', 'controlsCard', 'controlsTitle', 'controlsClose', 'controlsDone', 'howToPlay', 'menuControls', 'offlineNote', 'vrNote'];
check(`new UI ids for lobby-ui.js / lobby.js.patch (${NEW_IDS.length})`, NEW_IDS.filter(id => !idSet.has(id)).map(id => `missing #${id}`));
const tabs = T.filter(t => 'data-controls-tab' in t.attrs), panels = T.filter(t => 'data-controls-panel' in t.attrs);
check('controls card: one panel per device tab', [
  ...tabs.filter(t => !panels.some(p => p.attrs['data-controls-panel'] === t.attrs['data-controls-tab'])).map(t => `tab ${t.attrs['data-controls-tab']} has no panel`),
  ...(tabs.filter(t => t.attrs['aria-pressed'] === 'true').length === 1 ? [] : ['exactly one tab must start pressed']),
  ...['desktop', 'touch', 'vr'].filter(k => !tabs.some(t => t.attrs['data-controls-tab'] === k)).map(k => `missing ${k} tab`),
].filter(() => idSet.has('controlsCard')));
check('mobile-controls/mobile-ui mount points', [
  /class="[^"]*\bmenu-card\b/.test(html) ? null : 'missing .menu-card (mobile-controls inserts settings there)',
  idSet.has('leave') ? null : 'missing #leave (settings insert-before anchor)',
  idSet.has('techDetails') ? null : 'missing #techDetails (mobile-ui mount anchor)',
].filter(Boolean));

// 3. superset of reference ids and data-* hooks
const refIds = refT.filter(t => 'id' in t.attrs).map(t => t.attrs.id);
check(`reference ids preserved (${refIds.length})`, refIds.filter(id => !idSet.has(id)).map(id => `dropped #${id}`));
const dataSig = list => new Set(list.flatMap(t => Object.entries(t.attrs).filter(([k]) => /^data-(equip|spell|school|notice)$/.test(k)).map(([k, v]) => `${k}=${v}`)));
const newData = dataSig(T);
check('reference data-* hooks preserved', [...dataSig(refT)].filter(s => !newData.has(s)).map(s => `dropped [${s}]`));
const refNames = new Set(refT.filter(t => t.attrs.name).map(t => `${t.attrs.name}=${t.attrs.value ?? ''}`));
const newNames = new Set(T.filter(t => t.attrs.name).map(t => `${t.attrs.name}=${t.attrs.value ?? ''}`));
check('form control name/value pairs preserved', [...refNames].filter(n => !newNames.has(n)).map(n => `dropped name ${n}`));

// 4. weapons: exactly the catalogue, slot shortcuts, icon + label
const buttons = [...strip(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(m => {
  const attrs = tags(`<button${m[1]}>`)[0].attrs;
  return {attrs, inner: m[2], text: m[2].replace(/<kbd>[\s\S]*?<\/kbd>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()};
});
const equip = buttons.filter(b => b.attrs['data-equip']);
check(`eight weapons present (${equip.length})`, [
  ...WEAPONS.filter(w => !equip.some(b => b.attrs['data-equip'] === w.id)).map(w => `missing weapon ${w.id}`),
  ...equip.filter(b => !WEAPONS.some(w => w.id === b.attrs['data-equip'])).map(b => `unknown weapon ${b.attrs['data-equip']}`),
  ...equip.filter(b => { const w = WEAPONS.find(x => x.id === b.attrs['data-equip']); return w && b.attrs['aria-keyshortcuts'] !== String(w.slot); }).map(b => `${b.attrs['data-equip']} shortcut ${b.attrs['aria-keyshortcuts']} != slot`),
  ...equip.filter(b => !/<svg\b/.test(b.inner) || !/class="bf-name"/.test(b.inner)).map(b => `${b.attrs['data-equip']} lacks icon or .bf-name label`),
]);
const gameEquipment = (gameJs.match(/const equipment=\[([^\]]+)\]/) || [, ''])[1].match(/'(\w+)'/g)?.map(s => s.slice(1, -1)) || [];
check('weapon order matches game.js digit mapping', equip.map(b => b.attrs['data-equip']).join() === gameEquipment.join() ? [] : [`html ${equip.map(b => b.attrs['data-equip'])} vs game ${gameEquipment}`]);

// 5. spells: 14, costs, shortcuts agree with game.js spellKeys
const spellBtns = buttons.filter(b => b.attrs['data-spell']);
const codeToKey = c => c.startsWith('Digit') ? c.slice(5) : c.startsWith('Key') ? c.slice(3) : ({Minus: '-', Equal: '=', Backquote: '`'})[c];
const spellKeys = Object.fromEntries([...(gameJs.match(/const spellKeys=\{([^}]+)\}/) || [, ''])[1].matchAll(/(\w+):'(\w+)'/g)].map(m => [m[2], codeToKey(m[1])]));
check(`fourteen spells present (${spellBtns.length})`, [
  ...SPELLS.filter(s => !spellBtns.some(b => b.attrs['data-spell'] === s.id)).map(s => `missing spell ${s.id}`),
  ...spellBtns.filter(b => !SPELLS.some(s => s.id === b.attrs['data-spell'])).map(b => `unknown spell ${b.attrs['data-spell']}`),
  ...spellBtns.filter(b => { const s = SPELLS.find(x => x.id === b.attrs['data-spell']); return s && !new RegExp(`\\b${s.cost}\\b`).test(b.attrs.title || ''); }).map(b => `${b.attrs['data-spell']} title cost mismatch`),
  ...spellBtns.filter(b => spellKeys[b.attrs['data-spell']] !== b.attrs['aria-keyshortcuts']).map(b => `${b.attrs['data-spell']} key ${b.attrs['aria-keyshortcuts']} != game.js ${spellKeys[b.attrs['data-spell']]}`),
  ...spellBtns.filter(b => !/^<kbd>|<kbd>/.test(b.inner) || !b.inner.includes(`<kbd>${b.attrs['aria-keyshortcuts']}</kbd>`)).map(b => `${b.attrs['data-spell']} visible kbd != aria-keyshortcuts`),
]);
const lineSpells = SPELLS.filter(s => s.target === 'line').map(s => s.id);
check('line spells are labelled as lines', spellBtns.filter(b => lineSpells.includes(b.attrs['data-spell']) && !/line/i.test(b.attrs.title)).map(b => `${b.attrs['data-spell']} title doesn't say line`));

// 6. accessible names
check(`buttons have accessible names (${buttons.length})`, buttons.filter(b => !b.text && !b.attrs['aria-label'] && !b.attrs['aria-labelledby']).map(b => `unnamed button ${JSON.stringify(b.attrs)}`));
const inputs = T.filter(t => (t.tag === 'input' && t.attrs.type !== 'hidden') || t.tag === 'select');
check(`inputs are labelled (${inputs.length})`, inputs.filter(t => {
  if (t.attrs['aria-label'] || t.attrs['aria-labelledby']) return false;
  if (t.attrs.id && new RegExp(`<label[^>]*\\bfor="${t.attrs.id}"`).test(html)) return false;
  const before = strip(html).slice(0, strip(html).indexOf(`id="${t.attrs.id}"`) > -1 ? strip(html).indexOf(`id="${t.attrs.id}"`) : 0);
  const open = before.lastIndexOf('<label'), close = before.lastIndexOf('</label>');
  return t.attrs.type === 'radio' ? false : !(open > close);
}).map(t => `unlabelled ${t.tag}#${t.attrs.id || t.attrs.name}`));

// 7. ARIA references resolve
const refsBad = [];
for (const t of T) for (const k of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'])
  if (t.attrs[k] && (t.tag !== 'output')) for (const id of t.attrs[k].split(/\s+/)) if (!idSet.has(id)) refsBad.push(`${t.tag} ${k}="${id}" dangles`);
check('ARIA/label references resolve', refsBad);

// 8. every control has a handler somewhere
const handlerSrc = lobbyJs + '\n' + helperJs + '\n' + mobileControlsJs;
const unhandled = [];
for (const b of buttons) {
  const a = b.attrs;
  if (a['data-equip']) { if (!/\[data-equip\]/.test(lobbyJs)) unhandled.push('data-equip'); continue; }
  if (a['data-spell']) { if (!/\[data-spell\]/.test(lobbyJs)) unhandled.push('data-spell'); continue; }
  if (a['data-controls-tab']) { if (!/data-controls-tab/.test(helperJs)) unhandled.push('data-controls-tab'); continue; }
  if (a.type === 'submit') continue; // form submit handled by #lobbyForm listener
  if (!a.id || !handlerSrc.includes(`'${a.id}'`)) unhandled.push(`button ${a.id || b.text} has no handler`);
}
for (const id of ['import', 'quickCast', 'name', 'room', 'savedWorlds', 'techDetails']) if (idSet.has(id) && !handlerSrc.includes(`'${id}'`)) unhandled.push(`#${id} has no handler`);
if (!/\$\('lobbyForm'\)\.addEventListener\('submit'/.test(lobbyJs)) unhandled.push('#lobbyForm submit unhandled');
const touchActions = [...mobileUiJs.matchAll(/actionButton\('([\w-]+)'/g)].map(m => m[1]).concat('fullscreen');
for (const act of new Set(touchActions)) if (!mobileControlsJs.includes(`action==='${act}'`) && !(act === 'strike' && mobileControlsJs.includes('data-touch-action="strike"'))) unhandled.push(`touch action ${act} unhandled`);
check(`every control has a handler (${buttons.length} buttons + ${new Set(touchActions).size} touch actions)`, unhandled);

// 9. audit document covers every control
if (target.endsWith('index.html') || !expectFail) {
  const controlKeys = [...new Set([...buttons.map(b => b.attrs.id || (b.attrs['data-equip'] && `data-equip="${b.attrs['data-equip']}"`) || (b.attrs['data-spell'] && `data-spell="${b.attrs['data-spell']}"`) || (b.attrs['data-controls-tab'] && `data-controls-tab="${b.attrs['data-controls-tab']}"`)).filter(Boolean),
    ...inputs.map(t => t.attrs.id).filter(Boolean), ...[...new Set(touchActions)].map(a => `touch:${a}`)])];
  check(`CONTROL-AUDIT.md covers every control (${controlKeys.length})`, audit ? controlKeys.filter(k => !audit.includes(k.replace(/^data-(\w+)="(.+)"$/, '$2'))).map(k => `audit lacks ${k}`) : ['CONTROL-AUDIT.md missing']);
}

// 10. stale-text guards (real defects in the reference)
check('help text matches eight weapons', /Weapons<\/b>\s*—\s*1–6/.test(html) ? ['hero help still says weapons 1–6'] : []);
check('no HUD sprite nested in .hud-bottom', /class="hud-bottom"[\s\S]*?class="bf-sprite"[\s\S]*?id="heroTools"/.test(html) ? ['bf-sprite defs nested inside .hud-bottom'] : []);

// ---- report ----
for (const p of passes) console.log(`ok   ${p.name}`);
for (const f of failures) { console.log(`FAIL ${f.name}`); for (const x of f.problems.slice(0, 12)) console.log(`     - ${x}`); }
console.log(`\n${passes.length} passed, ${failures.length} failed — ${target.replace(root, '.')}`);
process.exitCode = expectFail ? (failures.length ? 0 : 1) : (failures.length ? 1 : 0);
