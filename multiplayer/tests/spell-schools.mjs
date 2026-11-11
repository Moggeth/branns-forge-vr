// God spells are grouped into four schools. Every spell belongs to exactly one, the spell bar lists them
// school by school, and each school's shortcuts sit on one keyboard row.
// Run: node tests/spell-schools.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SPELLS, SPELL_SCHOOLS} from '../shared/spells.js';

const ids = SPELLS.map(s => s.id), grouped = SPELL_SCHOOLS.flatMap(s => s.spells);
assert.deepEqual(SPELL_SCHOOLS.map(s => s.id), ['grow', 'shape', 'summon', 'sky']);
assert.deepEqual([...grouped].sort(), [...ids].sort(), 'every spell is in exactly one school');
assert.equal(new Set(grouped).size, grouped.length);
for (const s of SPELLS) assert.equal(SPELL_SCHOOLS.find(x => x.spells.includes(s.id)).id, s.school, `${s.id} school`);
for (const school of SPELL_SCHOOLS) assert.ok(school.spells.length <= 6, `${school.id} fits one phone row`);

// The bar lists buttons in school order with the school on each button.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const buttons = [...html.matchAll(/data-school="(\w+)"\s+data-spell="(\w+)"[^>]*aria-keyshortcuts="([^"]+)"/g)].map(m => ({school: m[1], id: m[2], key: m[3]}));
assert.deepEqual(buttons.map(b => b.id), grouped, 'bar order follows the schools');
for (const b of buttons) assert.equal(b.school, SPELLS.find(s => s.id === b.id).school, `${b.id} button school`);

// One keyboard row per school, and the God never loses W/A/S/D (camera) or B (build).
const game = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
const keys = Object.fromEntries([...game.match(/const spellKeys=\{([^}]+)\}/)[1].matchAll(/(\w+):'(\w+)'/g)].map(m => [m[2], m[1]]));
assert.deepEqual(Object.keys(keys).sort(), [...ids].sort(), 'every spell has a key');
const rows = {grow: /^Digit[1-6]$/, summon: /^(Digit[7-90]|Minus|Equal)$/, shape: /^Key[QERTYU]$/, sky: /^Key[ZXCV]$/};
for (const s of SPELLS) assert.match(keys[s.id], rows[s.school], `${s.id} key on the ${s.school} row`);
for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyB']) assert.ok(!Object.values(keys).includes(code), `${code} stays free`);
console.log('spell-schools: four schools cover all spells, bar order and keyboard rows match');
