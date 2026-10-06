// The portrait prompt and first-tap fullscreen decisions. Real phone behaviour (Android fullscreen,
// iPhone Safari's refusal) is browser-dependent and is not established here.
import assert from 'node:assert/strict';
import {shouldShowTurnPrompt, shouldAutoFullscreen} from '../client/turn-phone-policy.js';

const phone = {touch: true, portrait: true, narrow: true, xr: false, dismissed: false, turnedOnce: false};
assert.equal(shouldShowTurnPrompt(phone), true, 'upright phone sees the prompt');
assert.equal(shouldShowTurnPrompt({...phone, portrait: false}), false, 'sideways phone does not');
assert.equal(shouldShowTurnPrompt({...phone, touch: false}), false, 'narrow desktop window does not');
assert.equal(shouldShowTurnPrompt({...phone, narrow: false}), false, 'upright tablet does not');
assert.equal(shouldShowTurnPrompt({...phone, xr: true}), false, 'headset does not');
assert.equal(shouldShowTurnPrompt({...phone, dismissed: true}), false, 'Stay upright is respected');
assert.equal(shouldShowTurnPrompt({...phone, turnedOnce: true}), false, 'once turned, never nags again');

const tap = {armed: true, touch: true, landscape: true, xr: false, standalone: false, fullscreen: false, supported: true, onFullscreenButton: false};
assert.equal(shouldAutoFullscreen(tap), true, 'first tap after turning goes full screen');
for (const [key, value, why] of [
  ['armed', false, 'only after turning sideways'], ['landscape', false, 'not while upright'], ['xr', true, 'never in a headset'],
  ['standalone', true, 'home-screen app is already full screen'], ['fullscreen', true, 'already full screen'],
  ['supported', false, 'iPhone Safari cannot'], ['onFullscreenButton', true, 'the full screen button toggles itself'], ['touch', false, 'desktop never'],
]) assert.equal(shouldAutoFullscreen({...tap, [key]: value}), false, why);
console.log('turn-phone: ok');
