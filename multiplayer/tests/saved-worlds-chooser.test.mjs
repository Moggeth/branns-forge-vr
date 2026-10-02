// node --test tests/saved-worlds-chooser.test.mjs   (pure logic; DOM behaviour is in fixture/run-fixture.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import {displayName, toSummaries, formatSavedAt, labelSummaries, backupFileName, reduce, initialState, TEXT, MAX_SAVES} from '../saved-worlds-chooser.js';
import {SAVES} from './saved-worlds-fixture.js';

const opts = {locale: 'en-GB', timeZone: 'UTC'};
const load = saves => reduce(initialState, {type: 'loaded', saves});

test('display names are cleaned but never empty', () => {
  assert.equal(displayName('  Little\n\tOrchard  '), 'Little Orchard');
  assert.equal(displayName('‮evil‬'), 'evil');
  assert.equal(displayName(''), 'Unnamed world');
  assert.equal(displayName(null), 'Unnamed world');
  assert.equal(displayName('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'markup is kept as text, not stripped or parsed');
  assert.equal(Array.from(displayName('🌳'.repeat(80))).length, 64, 'clips by code point, never splitting a surrogate pair');
});

test('summaries are deduped, validated, newest first and capped at eight', () => {
  const list = toSummaries([...SAVES.eight, SAVES.eight[0], {id: '', savedAt: 1}, {id: 'nan', savedAt: NaN}, null, {id: 'extra', name: 'x', savedAt: 0}]);
  assert.equal(list.length, MAX_SAVES);
  assert.deepEqual(list.map(s => s.savedAt), [...list.map(s => s.savedAt)].sort((a, b) => b - a));
  assert.ok(!('checkpoint' in list[0]), 'summaries never carry world data');
  assert.deepEqual(toSummaries('nope'), []);
});

test('timestamps are readable and identical minutes gain seconds', () => {
  assert.equal(formatSavedAt(Date.UTC(2026, 9, 2, 19, 5), opts), '2 Oct 2026, 19:05');
  assert.equal(formatSavedAt(NaN, opts), 'Unknown time');
  const labelled = labelSummaries(toSummaries(SAVES.eight), opts);
  const same = labelled.filter(s => s.when.startsWith('2 Oct 2026, 18:40'));
  assert.equal(same.length, 2);
  assert.notEqual(same[0].when, same[1].when, 'same-minute saves stay distinguishable');
});

test('backup file names are portable', () => {
  assert.match(backupFileName({name: '../..\\Ørchard: “night” <b>', savedAt: Date.UTC(2026, 0, 2, 3, 4)}), /^branns-forge-ørchard-night-b-2026010\d-\d{4}\.json$/);
  assert.equal(backupFileName({name: '🌳🌳', savedAt: NaN}), 'branns-forge-world-undated.json');
});

test('zero, one and eight saves', () => {
  assert.equal(load([]).phase, 'empty');
  const one = load(SAVES.one);
  assert.equal(one.phase, 'ready'); assert.equal(one.selectedId, SAVES.one[0].id);
  const eight = load(SAVES.eight);
  assert.equal(eight.saves.length, 8); assert.equal(eight.selectedId, eight.saves[0].id, 'newest selected by default');
});

test('selection is separate from activation and survives refresh', () => {
  let s = load(SAVES.eight);
  const old = s.saves[6].id;
  s = reduce(s, {type: 'select', id: old});
  assert.equal(s.selectedId, old); assert.equal(s.phase, 'ready', 'selecting never starts anything');
  s = reduce(s, {type: 'select', id: 'missing'});
  assert.equal(s.selectedId, old, 'unknown ids are ignored');
  s = reduce(s, {type: 'loaded', saves: SAVES.eight});
  assert.equal(s.selectedId, old); assert.equal(s.message, null);
});

test('a vanished selection falls back to newest without launching', () => {
  let s = reduce(load(SAVES.eight), {type: 'select', id: SAVES.eight[5].id});
  s = reduce(s, {type: 'loaded', saves: SAVES.eight.filter(x => x.id !== SAVES.eight[5].id)});
  assert.equal(s.phase, 'ready'); assert.equal(s.busy, null);
  assert.equal(s.selectedId, s.saves[0].id);
  assert.equal(s.message.text, TEXT.vanished);
  assert.equal(reduce(s, {type: 'select', id: s.saves[1].id}).message, null, 'message clears on the next choice');
});

test('busy blocks duplicates; failure keeps selection and allows retry', () => {
  let s = reduce(load(SAVES.eight), {type: 'select', id: SAVES.eight[3].id});
  s = reduce(s, {type: 'begin', action: 'resume'});
  assert.equal(s.phase, 'busy');
  assert.equal(reduce(s, {type: 'begin', action: 'resume'}), s, 'second resume ignored');
  assert.equal(reduce(s, {type: 'begin', action: 'download'}), s, 'download ignored while resuming');
  assert.equal(reduce(s, {type: 'select', id: SAVES.eight[0].id}), s, 'selection locked while busy');
  assert.equal(reduce(s, {type: 'loaded', saves: SAVES.eight}).phase, 'busy', 'refresh does not cancel busy');
  s = reduce(s, {type: 'fail'});
  assert.equal(s.phase, 'ready'); assert.equal(s.selectedId, SAVES.eight[3].id); assert.equal(s.message.text, TEXT.resumeFailed);
  s = reduce(s, {type: 'begin', action: 'download'});
  assert.equal(s.busy, 'download');
  s = reduce(s, {type: 'fail'});
  assert.equal(s.message.text, TEXT.downloadFailed);
  assert.equal(reduce(s, {type: 'begin', action: 'resume'}).busy, 'resume', 'retry allowed');
});

test('storage errors and invalid actions', () => {
  const s = reduce(load(SAVES.eight), {type: 'storage-error'});
  assert.equal(s.phase, 'unavailable'); assert.equal(s.saves.length, 0);
  assert.equal(reduce(s, {type: 'begin', action: 'resume'}), s, 'nothing to resume');
  assert.equal(reduce(load([]), {type: 'begin', action: 'download'}).phase, 'empty');
  assert.equal(reduce(load(SAVES.one), {type: 'begin', action: 'delete'}).phase, 'ready', 'no other actions exist');
});

test('module source never uses innerHTML or writes storage', async () => {
  const {readFile} = await import('node:fs/promises');
  const src = (await readFile(new URL('../saved-worlds-chooser.js', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|\.setItem\(/);
});
