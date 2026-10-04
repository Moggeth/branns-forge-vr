// Every patch-notes entry parses, reads as player-facing text, and groups into numbered patches.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parsePatchNote, groupPatches, unseenEntries, formatRange} from '../client/patch-notes.js';

const dir = fileURLToPath(new URL('../patch-notes/', import.meta.url));
const names = readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'README.md');
assert.ok(names.length > 0, 'patch-notes/ has entries');

// Player-facing wording: no code, file names, PR numbers or internal jargon.
const BANNED = [
  [/`/, 'backticks'],
  [/\b[\w.-]+\.(m?js|ts|glb|gltf|json|md|py|css|html|blend)\b/i, 'a file name'],
  [/\b(client|shared|tests?|multiplayer|assets?)\/\w/i, 'a source path'],
  [/(^|\s)#\d+\b|\bPR\b|pull request/i, 'a PR reference'],
  [/\b(refactor|regression|authority|snapshot|instanced|draw calls?|shader|GLB|CI)\b/, 'developer jargon'],
];
const entries = [];
for (const name of names) {
  const text = readFileSync(dir + name, 'utf8');
  const e = parsePatchNote(name, text); // throws with the file name on any format problem
  assert.ok(e.title.length <= 60, `${name}: title is over 60 characters`);
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const [re, what] of BANNED) {
    for (const line of [e.title, ...body.split('\n')]) assert.ok(!re.test(line), `${name}: reads like a code note (${what}): "${line.trim()}"`);
  }
  entries.push(e);
}
const ids = new Set();
for (const e of entries) { assert.ok(!ids.has(e.id), `duplicate entry ${e.id}`); ids.add(e.id); }

// Grouping: oldest patch is 0.1, newest first, entries newest first, one headline per explicit group.
const patches = groupPatches(entries);
assert.equal(patches.at(-1).version, '0.1');
assert.equal(patches[0].version, `0.${patches.length}`);
for (const p of patches) {
  for (let i = 1; i < p.entries.length; i++) assert.ok(p.entries[i - 1].sort >= p.entries[i].sort, `${p.key} entries are newest first`);
  const heads = new Set(p.entries.map(e => e.headline).filter(Boolean));
  assert.ok(heads.size <= 1, `patch ${p.key} has more than one headline: ${[...heads].join(', ')}`);
}
for (let i = 1; i < patches.length; i++) assert.ok(patches[i - 1].oldest >= patches[i].oldest, 'patches are newest first');

// Parser edge cases on a synthetic entry.
const sample = parsePatchNote('patch-notes/2030-01-02-sample.md', [
  '---', 'date: 2030-01-02 09:30', 'area: Weapons', 'title: Sample', 'pr: 99', '---',
  'Intro line', 'continues here.', '', '- One **bold** thing', '  - nested', '- Two', '  wraps on', '', '> Note one', '> and two',
].join('\n'));
assert.equal(sample.time, '09:30');
assert.equal(sample.patch, '2030-01-02');
assert.deepEqual(sample.blocks, [
  {type: 'p', text: 'Intro line continues here.'},
  {type: 'list', items: [{text: 'One **bold** thing', children: ['nested']}, {text: 'Two wraps on', children: []}]},
  {type: 'note', text: 'Note one and two'},
]);
const bad = (name, text, re) => assert.throws(() => parsePatchNote(name, text), re);
bad('2030-01-02-x.md', '---\ndate: 2030-01-03\narea: World\ntitle: T\n---\n- a\n', /does not match/);
bad('2030-01-02-x.md', '---\ndate: 2030-01-02\narea: Nowhere\ntitle: T\n---\n- a\n', /area must be/);
bad('2030-01-02-x.md', '---\ndate: 2030-01-02\narea: World\ntitle: T\n---\nNo bullets\n', /bullet/);
bad('2030-1-2-x.md', '', /YYYY-MM-DD/);

// What's new: first visit shows only the newest patch; later visits show only unseen entries.
assert.deepEqual(unseenEntries(patches, null).map(e => e.id), patches[0].entries.map(e => e.id));
const all = patches.flatMap(p => p.entries.map(e => e.id));
assert.deepEqual(unseenEntries(patches, all), []);
assert.deepEqual(unseenEntries(patches, all.slice(1)).map(e => e.id), [all[0]]);
assert.equal(formatRange('2026-09-27', '2026-10-02'), '27 September – 2 October 2026');
assert.equal(formatRange('2026-10-04', '2026-10-04'), '4 October 2026');

console.log(`patch-notes: ${entries.length} entries in ${patches.length} patches, newest Patch ${patches[0].version}`);
