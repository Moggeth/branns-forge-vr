// Quick play: region matching, fill-first ranking, paging and graceful failure.
import assert from 'node:assert/strict';
import {rankWorlds, findWorlds} from '../client/quick-play.js';
import {regionOf, roomListing} from '../cloud/room-directory.js';

const row = (code, count, region, extra = {}) => ({code, count, maxPlayers: 32, region, status: 'playing', joinable: true, ...extra});
const rooms = [row('00000001', 3, 'oc'), row('00000002', 31, 'oc'), row('00000003', 32, 'oc', {status: 'full', joinable: false}),
  row('00000004', 20, 'na'), row('00000005', 5, 'oc', {joinable: false, status: 'waiting'}), row('00000006', 31, 'oc')];
assert.deepEqual(rankWorlds(rooms, {region: 'oc'}), ['00000002', '00000006', '00000001'], 'fullest open world in your region first, oldest code breaks ties');
assert.deepEqual(rankWorlds(rooms, {region: 'oc', exclude: ['00000002']}), ['00000006', '00000001'], 'worlds that already failed are skipped');
assert.deepEqual(rankWorlds(rooms, {region: 'eu'}), [], 'nobody nearby: start your own world');
assert.deepEqual(rankWorlds([row('00000009', 1, undefined)], {region: 'oc'}), [], 'unknown-region worlds never pull in a known region');
assert.deepEqual(rankWorlds([row('00000009', 1, undefined)], {region: ''}), ['00000009'], 'unknown matches unknown (old service, local tests)');

assert.equal(regionOf({continent: 'OC'}), 'oc'); assert.equal(regionOf({continent: 'AN'}), 'oc');
assert.equal(regionOf({continent: 'AF'}), 'eu'); assert.equal(regionOf({continent: 'NA'}), 'na');
assert.equal(regionOf({continent: 'oc'}), 'oc', 'internal round trip'); assert.equal(regionOf({continent: 'zz'}), ''); assert.equal(regionOf(undefined), '');
const listing = roomListing({code: '12345678', region: 'oc', created: Date.now(), hostId: 'h', peers: [{id: 'h', name: 'Mitch', role: 'hero'}]}, () => true);
assert.equal(listing.region, 'oc', 'directory rows carry the host region');

const endpoint = 'wss://rooms.example/peer/cloud';
const pages = {'': {rooms: [row('00000001', 2, 'oc')], nextCursor: 'room:00000001', region: 'oc'}, 'room:00000001': {rooms: [row('00000007', 9, 'oc')], nextCursor: null, region: 'oc'}};
const seen = [];
const fetcher = async url => { const c = new URL(url).searchParams.get('cursor') || ''; seen.push(c); return {ok: true, json: async () => pages[c]}; };
assert.deepEqual(await findWorlds({endpoint, fetcher}), {codes: ['00000007', '00000001'], region: 'oc'}, 'pages are merged before ranking');
assert.deepEqual(seen, ['', 'room:00000001']);
assert.deepEqual((await findWorlds({endpoint, fetcher: async () => { throw new Error('offline'); }})).codes, [], 'offline: create a world instead');
assert.deepEqual((await findWorlds({endpoint, fetcher: async () => ({ok: false, status: 429})})).codes, [], 'rate limited: create a world instead');
assert.deepEqual((await findWorlds({endpoint: 'ws://127.0.0.1:8789/peer/ws'})).codes, [], 'local signaling has no directory');
console.log('quick-play: region buckets, fill-first ranking, skips, paging and offline fallback passed');
