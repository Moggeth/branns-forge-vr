import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSave,parseSave,WorldSaves} from '../client/world-saves.js';
test('portable save preserves world data and removes connection secrets', () => {
  const input = {seed:41, edits:[{height:2}], players:[{token:'private',name:'Mog'}],secret:'private'};
  const save = parseSave(JSON.stringify(makeSave(input)));
  assert.equal(save.checkpoint.seed,41);
  assert.equal(save.checkpoint.players[0].name,'Mog');
  assert.ok(!JSON.stringify(save).includes('private'));
  assert.equal(input.secret,'private');
});
test('malformed, oversized and prototype-bearing files are rejected', () => {
  assert.throws(() => parseSave('{'));
  assert.throws(() => parseSave(' '.repeat(2_000_001)));
  assert.throws(() => makeSave({x:NaN}));
  assert.throws(() => makeSave(JSON.parse('{"__proto__":{"polluted":true}}')));
});
test('autosave replaces same world and bounds unrelated recovery copies', () => {
  const map = new Map(); const store = new WorldSaves({getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)});
  for(let i=0;i<10;i++) store.put(makeSave({seed:i},{id:String(i),now:i}));
  assert.equal(store.list().length,8);
  store.put(makeSave({seed:42},{id:'9',now:20}));
  assert.equal(store.list()[0].checkpoint.seed,42);
  assert.equal(store.list().length,8);
});
