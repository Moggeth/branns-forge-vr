import assert from 'node:assert/strict';
import {setVoiceZones, setVoiceZoneResolver, voiceZoneAt, voiceRelation, voiceZones} from '../client/voice-zones.js';
import {proximityGraph} from '../client/voice-topology.js';
import {VoiceAudio} from '../client/voice-audio.js';
setVoiceZones('taverns', [{id:'mid', kind:'tavern', label:'Middle Tavern', center:[100, 0, 0], radius:30}, {id:'bad', center:[0, 0]}]);
assert.equal(voiceZones().length, 1, 'malformed zones ignored');
assert.equal(voiceZoneAt([110, 1.6, 0])?.id, 'mid'); assert.equal(voiceZoneAt([0, 0, 0]), null); assert.equal(voiceZoneAt([100, 50, 0]), null, 'height bound');
assert.equal(voiceRelation([75, 0, 0], [125, 0, 0]), 'room'); assert.equal(voiceRelation([0, 0, 0], [5, 0, 0]), 'open'); assert.equal(voiceRelation([69, 0, 0], [75, 0, 0]), 'wall');
// 50 m apart is beyond normal voice range, but the same tavern links them.
const node = (id, x) => ({id, active:true, session:'s'+id, position:[x, 1.6, 0]});
const graph = proximityGraph([node('a', 75), node('b', 125), node('c', 0), node('d', 50)]);
assert(graph.get('a').has('b'), 'tavern-mates link across the room'); assert(!graph.get('c').has('d'), 'outdoors keeps the 32 m range');
setVoiceZones('taverns', []); assert.equal(voiceZoneAt([110, 1.6, 0]), null, 'source can clear its zones');
assert(!proximityGraph([node('a', 75), node('b', 125)]).get('a').has('b'));
setVoiceZoneResolver('bases', p => p[0] > 200);
assert.equal(voiceZoneAt([210, 0, 0])?.id, 'tavern', 'boolean resolver (insideTavern) still works');
assert(proximityGraph([node('a', 210), node('b', 250)]).get('a').has('b')); assert(!proximityGraph([node('a', 210), node('b', 300)]).get('a').has('b'), 'room links capped at 80 m');
setVoiceZoneResolver('bases', p => p[0] > 200 ? {id:p[0] > 400 ? 'evil' : 'good', label:'Good Tavern'} : null);
assert.equal(voiceRelation([210, 0, 0], [450, 0, 0]), 'wall', 'two taverns are separate rooms'); setVoiceZoneResolver('bases', null);
// Mix: wall muffles, room flattens falloff.
const param = () => ({value:0, setTargetAtTime(v){this.value = v;}});
const n = () => ({gain:param(), frequency:param(), connect(x){return x || this;}, disconnect(){}, ...Object.fromEntries(['position','forward','up'].flatMap(p => [...'XYZ'].map(a => [p + a, param()])))});
const ctx = {currentTime:0, destination:{}, listener:n(), createGain:n, createPanner:n, createBiquadFilter:n, createMediaStreamSource:n,
  createAnalyser:() => ({...n(), fftSize:0, getFloatTimeDomainData(d){d.fill(.1);}}), close:async () => {}};
const audio = new VoiceAudio(ctx); audio.add('p', {});
audio.position('p', [0, 0, 0], true, 'wall'); const s = audio.sources.get('p');
assert(s.filter.frequency.value < 1000 && s.gain.gain.value < .5, 'through a wall: muffled and quieter');
audio.position('p', [0, 0, 0], true, 'room'); assert(s.panner.refDistance >= 20 && s.filter.frequency.value > 10000 && s.gain.gain.value === 1, 'same tavern: clear across the room');
assert(Math.abs(audio.level('p') - .1) < 1e-6, 'speech level from analyser'); audio.dispose();
console.log('PASS voice zones: tavern links beyond range, wall muffling, room clarity, speaking level');
