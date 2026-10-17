import assert from 'node:assert/strict';
import {weaponReadiness, spellbookReadiness} from '../client/ability-readiness.js';
import {SPELLS} from '../shared/spells.js';
const p = {attackTick:100, specialTick:100, castTick:100, mana:30};
assert.equal(weaponReadiness(p,'axe',310).specialReady,.5);
assert.equal(weaponReadiness(p,'pick',220).specialSeconds,2);
assert.equal(weaponReadiness(p,'crossbow',130).attackReady,.5);
assert.equal(weaponReadiness(p,'bow',133).attackReady,1);
// Emberwing's Special is Phoenix Flare (Q): a 10 s recharge.
assert.equal(weaponReadiness(p,'bow',101).hasSpecialCooldown,true);assert.equal(weaponReadiness({specialTick:0},'bow',300).specialReady,.5);
assert.equal(weaponReadiness({...p,heat:1,overheatUntil:280},'wyrmspout',190).attackSeconds,1.5);
assert.equal(weaponReadiness({...p,heat:1,overheatUntil:280},'wyrmspout',281).overheated,false);
assert.equal(weaponReadiness({},'axe',0).specialReady,1);
const book=spellbookReadiness(p,120,'frost');
assert.equal(Object.keys(book.spellTicks).length,SPELLS.length);
assert.ok(Object.values(book.spellTicks).every(t=>t===100));
assert.equal(book.selected,'frost');
console.log('ability-readiness: authoritative cooldowns, weapon switches, overheat and shared spell recovery passed');
