// Deterministic Expedition states built with the real reference createAdventure()/adventureView() (no copied schema).
// Shared by the Node tests and the browser screenshot fixture.
import {createAdventure, adventureView, HZ} from '../shared/adventure.js';

const hero = (resources = {}) => ({id: 'p1', name: 'Brann', role: 'hero', position: [2, 0, 3], hp: 100, mana: 0, resources: {wood: 0, stone: 0, gems: 0, ...resources}});
const ally = {id: 'p2', name: 'Ilse', role: 'hero', position: [-4, 0, 6], hp: 100, mana: 0, resources: {wood: 0, stone: 0, gems: 0}};

function state(stage, patch, resources) {
  const adv = Object.assign(createAdventure({seed: 41}), {stage, run: 1, heroesAtStart: 2, need: {wood: 12, stone: 8, star: 4}}, patch);
  const snapshot = {tick: 9000, players: [hero(resources), ally], enemies: [], edits: [], adventure: adv};
  return {adv, snapshot, playerId: 'p1', view: adventureView(adv, snapshot, 'p1')};
}

export const FIXTURES = {
  idle: () => state('idle', {run: 0, notice: 'Gather at the forge to begin.'}),
  camp: () => state('camp', {elapsed: 95 * HZ, stock: {wood: 5, stone: 2}}, {wood: 3}),
  campEmpty: () => state('camp', {elapsed: 140 * HZ, stock: {wood: 9, stone: 2}}),
  star: () => state('star', {elapsed: 41 * HZ, star: {charge: 1, site: 1, landed: true},
    foes: [{id: 'xv1', kind: 'skeleton', tag: 'g', seen: true, age: 30}],
    telegraphs: [{id: 't1', kind: 'star', x: 32, z: 24, radius: 4, until: 47 * HZ, label: 'Guardians rising'}]}),
  rekindle: () => state('rekindle', {elapsed: 70 * HZ, flame: 62, waveIndex: 2, foes: [{id: 'xv2', kind: 'golem', tag: 'w2', seen: true, age: 60}],
    telegraphs: [{id: 't2', kind: 'gate', x: 24, z: -16, radius: 5, until: 76 * HZ, label: 'East gate breaking'}]}, {stone: 2, gems: 1}),
  defeat: () => state('defeat', {retries: 1, notice: 'The flame died. Retry the last stand or leave.'}),
};
