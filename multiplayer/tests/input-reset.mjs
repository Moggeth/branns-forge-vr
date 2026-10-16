import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the real cleanup body without loading the WebGL application. Browser
// blur/pointer-lock/visibility delivery remains a separate acceptance concern.
const source = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
const start = source.indexOf('  function clearInput() {');
const end = source.indexOf('  function cancelInventionPlacement()', start);
assert.ok(start >= 0 && end > start, 'locate the production input-reset function');
const noop = () => {};
for (const active of [false, true]) {
  const sent = [];
  const context = {
    active, disposed: false, aiming: true, scoping: true, crankHeld: true,
    weapons: {cancel: noop}, specialSwing: {}, cancelWallAim: noop,
    pickupHighlight: {clear: noop}, nearestPickup: {}, feedback: {reset: noop},
    updateFireAudio: noop, cancelCast: noop, swingContact: false, swingAt: 50,
    keys: new Set(['KeyW']), jumpPending: true, rightDrag: true, move: {set: noop},
    touchAxes: {left: {x: 1, y: 1}}, xrButtons: new Map(), presses: new Map(),
    zeroInputTimer: null, clearTimeout: noop, performance: {now: () => 100}, sentAt: 0,
    sendInput: (now, zero) => sent.push({now, zero}), dragonRide: {clearInput: noop},
    strikeClock: {cancel: noop}, viewPunch: {reset: noop},
  };
  runInNewContext(source.slice(start, end) + '\nclearInput();', context);
  assert.equal(context.scoping, false, 'scope hold clears even when mouseup was lost');
  assert.equal(context.aiming, false);
  assert.equal(context.crankHeld, false);
  assert.equal(context.keys.size, 0);
  assert.equal(context.touchAxes.left.x, 0);
  assert.equal(sent.length, Number(active), 'active cleanup preserves the stop packet');
}
console.log('input-reset: scope, aim, crank and movement clear after interrupted input');
