'use strict';
const { getQuickJS } = require('quickjs-emscripten');
const {CAPABILITIES,HAPTICS}=require('./progression');
let engine;
const ready = getQuickJS().then(q => { engine = q; });
const actionTypes = ['blast', 'slow', 'pull', 'shield', 'dash', 'bomb', 'spark','chop','mine','ignite','grapple','resonate'];
function validateItem(item) {
  if (!item || typeof item !== 'object') throw Error('Missing item.json.');
  for (const [key, max] of [['name', 60], ['description', 400], ['color', 7]]) {
    if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > max) throw Error(`Invalid item ${key}.`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(item.color)) throw Error('Invalid item color.');
  if (!Number.isFinite(item.cooldown) || item.cooldown < 2 || item.cooldown > 15) throw Error('Cooldown must be 2-15 seconds.');
  let capabilities;
  if(item.capabilities!==undefined){if(!Array.isArray(item.capabilities)||!item.capabilities.length||item.capabilities.length>12||item.capabilities.some(c=>!Object.hasOwn(CAPABILITIES,c)))throw Error('Invalid item capabilities.');capabilities=[...new Set(item.capabilities)];}
  if(item.tier!==undefined&&(!Number.isInteger(item.tier)||item.tier<1||item.tier>4))throw Error('Invalid item tier.');
  const formationSeconds=item.formationSeconds??0;
  if(!Number.isFinite(formationSeconds)||formationSeconds<0||formationSeconds>3)throw Error('Invalid formation duration.');
  const haptics={};for(const phase of Object.keys(HAPTICS)){const h=item.haptics?.[phase]??HAPTICS[phase];if(!h||!Number.isFinite(h.amplitude)||h.amplitude<0||h.amplitude>1||!Number.isFinite(h.duration)||h.duration<0||h.duration>1||!Number.isFinite(h.frequency)||h.frequency<0||h.frequency>320)throw Error('Invalid bounded haptic profile.');haptics[phase]={amplitude:h.amplitude,duration:h.duration,frequency:h.frequency};}
  const handoff={};
  for(const [key,fallback] of [['requestedFunction',item.description],['extraFunction','No additional effect documented.'],['useInstructions','Grip to equip; press trigger to activate.']]){
    const value=item[key]??fallback;if(typeof value!=='string'||!value.trim()||value.length>400)throw Error('Invalid item '+key+'.');handoff[key]=value.trim();
  }
  return { ...handoff, name: item.name.trim(), description: item.description.trim(), color: item.color, cooldown: item.cooldown,...(capabilities?{capabilities}:{}),formationSeconds,haptics,...(item.tier?{tier:item.tier}:{}) };
}
function validateActions(value, state) {
  if (!Array.isArray(value) || value.length > 36) throw Error('Ability must return at most 36 actions.');
  return value.map(a => {
    if (!a || !actionTypes.includes(a.type)) throw Error('Unknown ability action.');
    if(Array.isArray(state.capabilities)&&a.type!=='spark'&&!state.capabilities.includes(a.type)&&!(a.type==='blast'&&state.capabilities.includes('enchant'))&&!(a.type==='dash'&&state.capabilities.includes('flight')))throw Error('Action exceeds commissioned capabilities.');
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || a.x < 1 || a.x >= state.width - 1 || a.y < 1 || a.y >= state.height - 1) throw Error('Action outside the arena.');
    if (Math.hypot(a.x - Math.floor(state.player.x), a.y - Math.floor(state.player.y)) > 6) throw Error('Action too far from the caster.');
    if (a.duration !== undefined && (!Number.isFinite(a.duration) || a.duration < 0 || a.duration > 3000)) throw Error('Invalid action duration.');
    if (a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) throw Error('Invalid action color.');
    return { type: a.type, x: a.x, y: a.y, duration: a.duration ?? 450, color: a.color || '#8be4ff' };
  });
}
function evaluateAbility(source, state) {
  if (!engine) throw Error('Ability engine is still warming up.');
  if (typeof source !== 'string' || source.length > 32000) throw Error('Ability source exceeds 32 KB.');
  const deadline = Date.now() + 30;
  // No host objects, imports, filesystem, network or timers are exposed to QuickJS.
  const result = engine.evalCode(`"use strict";\n${source}\nJSON.stringify(forgeAbility(${JSON.stringify(state)}));`, {
    memoryLimitBytes: 4 * 1024 * 1024, maxStackSizeBytes: 256 * 1024, shouldInterrupt: () => Date.now() > deadline,
  });
  if (typeof result !== 'string' || result.length > 16000) throw Error('Invalid ability result.');
  return validateActions(JSON.parse(result), state);
}
function probeState(x = 10.5, y = 7.5) {
  return { width: 21, height: 15, now: 10000,resources:[],anchors:[],barriers:[], rats: [{id:'rat-1',x:11.5,y:7.5,alive:true}], player: { id: '1', x, y, facingX: 1, facingY: 0 }, players: [{ id: '1', x, y, alive: true }, { id: '2', x: 12.5, y: 7.5, alive: true }], grid: Array.from({ length: 15 }, (_, yy) => Array.from({ length: 21 }, (_, xx) => xx === 0 || xx === 20 || yy === 0 || yy === 14 ? 1 : 0)) };
}
function inspectGLB(buffer) {
  if (buffer.length < 28 || buffer.length > 8 * 1024 * 1024 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw Error('Invalid or oversized GLB.');
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw Error('GLB must begin with JSON.');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  if (!json.meshes?.length || json.meshes.length > 200 || !json.scenes?.length) throw Error('GLB needs 1-200 meshes and a scene.');
  if ((json.buffers || []).some(b => b.uri) || (json.images || []).some(i => i.uri)) throw Error('GLB must embed all resources.');
  if ((json.accessors || []).some(a => a.count > 100000)) throw Error('GLB geometry is too dense.');
  return { meshes: json.meshes.length, bytes: buffer.length };
}
module.exports = { ready, evaluateAbility, validateItem, validateActions, inspectGLB, probeState };
