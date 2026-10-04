import assert from 'node:assert/strict';
import {splitFailure} from '../client/callouts.js';
import {actionError} from '../client/action-feedback.js';
assert.deepEqual(splitFailure('You are not holding an item. Pick one up before trying to drop or throw it.'),{headline:'You are not holding an item.',hint:'Pick one up before trying to drop or throw it.'});
assert.deepEqual(splitFailure('Magic is recovering: 0.5s.'),{headline:'Magic is recovering: 0.5s.',hint:''});
assert.deepEqual(splitFailure('Leave VR before switching perspective.'),{headline:'Leave VR before switching perspective.',hint:''});
// Decimal numbers never split a headline.
assert.equal(splitFailure(actionError('cooldown',{world:{tick:115},player:{castTick:100},command:{type:'cast'}})).hint,'');
assert.equal(splitFailure('').headline,'');
// Every authored recovery message yields a short red headline.
for(const code of ['out_of_reach','hands_full','nothing_held','insufficient_mana','overheated','guarded','fully_built','no_tree','ent_limit']){const {headline}=splitFailure(actionError(code));assert.ok(headline.length>0&&headline.length<=90,`${code}: ${headline}`);}
console.log('callouts: failure headlines and hints split cleanly');
