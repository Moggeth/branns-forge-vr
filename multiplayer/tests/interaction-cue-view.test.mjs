// node test/interaction-cue-view.test.mjs — minimal fake DOM (no jsdom): proves build-once and no repeated writes.
import assert from 'node:assert/strict';
import {createCuePresenter} from '../client/interaction-cue-view.js';

let writes = 0;
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this._text = ''; this.hidden = false; this.className = ''; this.parent = null; }
  set textContent(v) { writes++; this._text = String(v); } get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
const doc = {createElement: tag => new Node(tag)}, hud = new Node('div'); hud.ownerDocument = doc;
const t0 = performance.now();
const p = createCuePresenter(hud), root = hud.children[0];
assert.equal(root.hidden, true); assert.equal(root.attrs['aria-hidden'], 'true');
const cue = {key: 'k1', kind: 'tree', state: 'ready', name: 'Tree', action: 'Chop', control: 'Click', note: '', progress: {done: 2, total: 3}};
assert.equal(p.render(cue), true); const after = writes;
assert.equal(root.hidden, false); assert.equal(root.dataset.state, 'ready');
const [line, note] = root.children, [name, action, key, pips] = line.children;
assert.deepEqual([name.textContent, action.textContent, key.textContent, key.hidden, note.hidden], ['Tree', 'Chop', 'Click', false, true]);
assert.deepEqual(pips.children.map(i => [i.hidden, i.className]), [[false, 'on'], [false, 'on'], [false, ''], [true, ''], [true, '']]);
for (let i = 0; i < 100; i++) assert.equal(p.render({...cue}), false);   // same key: zero DOM writes
assert.equal(writes, after);
p.render({...cue, key: 'k2', kind: 'carry', state: 'full', name: 'Log in hand', action: 'Pack full', control: 'G drop · X throw', progress: null});
assert.equal(pips.hidden, true);
assert.equal(p.render(null), true); assert.equal(root.hidden, true); assert.equal(p.render(null), false);
p.dispose(); assert.equal(hud.children.length, 0);
console.log(`ok   presenter build-once / no-churn / pips / hide / dispose (${(performance.now() - t0).toFixed(1)} ms)`);
