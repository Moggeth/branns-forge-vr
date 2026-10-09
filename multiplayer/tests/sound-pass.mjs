// Sound pass routing: every cue an event can ask for exists in the kit, the old fallback blip is gone for the moments
// that now have real cues, and the mix/kit build on a mock context without throwing. Run: node tests/sound-pass.mjs
import assert from 'node:assert/strict';
import {cueFor, pickupCue} from '../client/event-sounds.js';
import {createSoundKit} from '../client/sound-kit.js';
import {createAudioMix} from '../client/audio-mix.js';
import {createAmbienceAudio} from '../client/ambience-audio.js';

class Param { constructor(v = 0) { this.value = v; } setValueAtTime() {} exponentialRampToValueAtTime() {} linearRampToValueAtTime() {} setTargetAtTime() {} cancelScheduledValues() {} }
class Node { constructor() { this.out = []; } connect(n) { this.out.push(n); return n; } disconnect() { this.out = []; } }
const source = extra => Object.assign(new Node(), {start() {}, stop() {}, frequency: new Param(440), detune: new Param(), playbackRate: new Param(1), ...extra});
class Mock {
  constructor() { this.currentTime = 1; this.state = 'running'; this.sampleRate = 8000; this.destination = new Node(); this.created = 0; }
  createGain() { this.created++; return Object.assign(new Node(), {gain: new Param(1)}); }
  createOscillator() { this.created++; return source(); }
  createBufferSource() { this.created++; return source(); }
  createBiquadFilter() { this.created++; return Object.assign(new Node(), {frequency: new Param(), Q: new Param()}); }
  createStereoPanner() { return Object.assign(new Node(), {pan: new Param()}); }
  createDynamicsCompressor() { return Object.assign(new Node(), {threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param()}); }
  createBuffer(c, n) { return {getChannelData: () => new Float32Array(n)}; }
}

const context = new Mock(), mix = createAudioMix(context);
const sfx = mix.contextFor('sfx');
assert.equal(sfx.destination, mix.bus('sfx'), 'modules writing to context.destination land on the sfx bus');
assert.equal(sfx.currentTime, 1); assert.equal(typeof sfx.createGain(), 'object');
const kit = createSoundKit({context: sfx, ui: mix.contextFor('ui'), level: mix.level, duck: mix.duck});
const names = new Set(kit.names());

const me = 'p1', at = [0, 0, 0];
const kinds = ['death', 'respawn', 'hit', 'detach', 'joint_tear', 'shockwave', 'radiant_burst', 'shoot', 'fuel_throw', 'flame_emit', 'goo_splat', 'phoenix_ignite', 'timberline_cut', 'timberline_shear', 'stump_gone', 'meteor_unfurl',
  'home_turret_fire', 'home_shield_block', 'home_shield_up', 'home_shield_down', 'home_part_broken', 'home_rebuilt', 'home_siege_won', 'battle_victory', 'battle_start', 'battle_stop', 'battle_wave', 'battle_base_hit',
  'build', 'forge_build', 'forge_repair', 'forge_encounter', 'forge_result', 'workshop_smelt', 'refinery_feed', 'worker_summon', 'worker_delivery', 'resource_use', 'talent_learned',
  'adventure_telegraph', 'adventure_star_impact', 'adventure_stage', 'adventure_foe_down', 'adventure_support', 'adventure_rekindled', 'adventure_reward', 'party_reward', 'adventure_deposit'];
for (const kind of kinds) {
  const cue = cueFor({kind, id: me, by: me, position: at, creature: 'skeleton', material: 'flesh'}, {me}) || cueFor({kind, id: 'x', by: 'y', position: at, creature: 'skeleton'}, {me});
  assert.ok(cue, `${kind} has a cue`); assert.ok(names.has(cue.name), `${kind} -> ${cue.name} exists in the kit`);
  assert.ok(kit.play(cue.name, cue.at === undefined ? at : cue.at, {position: [1, 2, 1], forward: [0, 0, -1], up: [0, 1, 0]}, {...cue.opts, gap: 0}) || cue.name === 'hurt', `${kind} plays`);
}
assert.equal(cueFor({kind: 'death', creature: 'golem', position: at}, {me}).name, null, 'golems keep their own crumble');
assert.equal(cueFor({kind: 'death', id: me, position: at}, {me}).name, 'hero_down');
assert.equal(cueFor({kind: 'shoot', weapon: 'crossbow', by: me, position: at}, {me}), null, 'own Siegebird keeps its own sound');
assert.equal(cueFor({kind: 'shoot', phoenix: true, by: 'x', position: at}, {me}), null, 'phoenix shots keep the phoenix call');
assert.equal(cueFor({kind: 'flame_emit', by: me, position: at}, {me}), null, 'own Wyrmspout uses the flame loop');
assert.ok(names.has(pickupCue({kind: 'pickup', material: 'iron'}).name));
for (const n of ['swing', 'step', 'jump', 'land', 'swap', 'click', 'open']) assert.ok(names.has(n), n);

// Same cue on the same thing in one instant is one sound; far away is silent.
assert.equal(kit.play('detach', at, null, {key: 'd1', gap: .05}), true); assert.equal(kit.play('detach', at, null, {key: 'd1', gap: .05}), false);
assert.equal(kit.play('death_bone', [500, 0, 0], {position: [0, 0, 0], forward: [0, 0, -1]}), false, 'beyond range makes nothing');
// Distance curve: monotonic, full up close.
const ear = {position: [0, 0, 0], forward: [0, 0, -1]};
let prev = 2; for (const d of [0, 4, 10, 20, 30, 44]) { const g = mix.level([d, 0, 0], ear).gain; assert.ok(g <= prev + 1e-9, `falls with distance at ${d}`); prev = g; }
assert.equal(mix.level([0, 0, 0], ear).gain, 1); assert.ok(mix.level([10, 0, 0], ear).pan > 0, 'east of a north-facing ear is on the right');

// Voice budget holds under a flood (32-player brawl).
let played = 0; const flood = createSoundKit({context: sfx, level: mix.level, claim: mix.claim});
for (let i = 0; i < 400; i++) played += flood.play('death_bone', at, null, {key: i, gap: 0}) ? 1 : 0;
assert.ok(played <= 32, `voice budget caps a flood (${played})`);

// Ambience updates without throwing in town, day and night.
const amb = createAmbienceAudio({context: mix.contextFor('ambience'), level: mix.level});
for (const night of [0, 1]) for (let i = 0; i < 40; i++) amb.update({dt: .1, ear: () => ({position: [-27, 2, -38], forward: [0, 0, -1], up: [0, 1, 0]}), sky: () => ({night, weights: {clear: 1}}), state: () => ({battle: {v: 2}}), altitude: () => 2});
amb.dispose();
console.log('sound-pass: ok');
