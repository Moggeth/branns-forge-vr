import {inventionView} from '../shared/inventions.js';
// In-world VR Hero panel for the Forge Expedition. One CanvasTexture quad hovers above the off-hand wrist, faces the
// head, and is operated by the pointer-hand select ray (trigger). It consumes adventureView() from shared/adventure.js
// plus the viewer's carried resources and emits only lobby expeditionAction names; it owns no world state.
// Budget: <= 2 draw calls (panel + ray cursor), canvas redraw only when the drawn model changes, no DOM reads in XR.
import * as THREE from 'three';
import {ADVENTURE_ICONS} from './adventure-view.js';
import {settlementView} from '../shared/resources.js';
import {ORE_RECIPES} from '../shared/material-catalog.js';
const ORE_KINDS = Object.keys(ORE_RECIPES);

// Canvas pixels and physical metres. 512 px across 0.22 m is ~18 px per degree at 0.45 m.
export const PANEL = Object.freeze({px: 512, py: 384, width: 0.22, height: 0.165});
export const GATE = Object.freeze({
  lift: 0.075,          // m above the grip origin (world up), so the panel clears the hand and controller
  near: 0.16, far: 0.78, // m from head; outside this the wrist is not being looked at
  showAngle: 28, hideAngle: 40, // deg between head forward and the panel; hysteresis avoids flicker
  showAim: 0.6, hideAim: 0.78,  // dot(panel hand forward, head forward): an aimed/bow-holding hand hides the panel
  reach: 1.5,           // m max ray length from the pointer hand
  confirmMs: 4000, confirmMinMs: 350, repeatMs: 600, hintMs: 3000,
});
const TONE = {idle: '#c9b48a', camp: '#e0a64a', star: '#9fc8ff', rekindle: '#ff7a3a', victory: '#ffd36b', defeat: '#9a8f86'};
const INK = '#f3e7d3', DIM = '#bfae95', BG = '#18120e', PANEL_BG = '#211913', OK = '#9be38a', WARN = '#ffcf7a', DANGER = '#e8664a';
const HERO_ACTIONS = ['deposit', 'start', 'rematch', 'retry', 'leave']; // display order; leave is always last (far right)
const LABELS = {start: 'Start', rematch: 'Rematch', retry: 'Retry stand', leave: 'Leave', deposit: 'Deliver', confirm: 'Confirm leave', cancel: 'Stay'};
const STAGES = [['camp', 'I Camp'], ['star', 'II Star'], ['rekindle', 'III Rekindle']];
const CARRY = [['wood', 'timber'], ['stone', 'stone'], ['gems', 'gem']];

// ---------------------------------------------------------------- pure view model (testable without Three/canvas)
export function carried(snapshot, playerId) {
  const r = snapshot?.players?.find(p => p.id === playerId)?.resources || {};
  return {wood: r.wood | 0, stone: r.stone | 0, gems: r.gems | 0};
}
// Mirrors lobby expeditionAction('deposit'): kinds the current stage accepts that the hero is carrying.
export function deliverable(stage, held) {
  const kinds = stage === 'camp' ? ['wood', 'stone'] : stage === 'star' ? ['gems'] : ['wood', 'stone', 'gems', ...ORE_KINDS, 'iron'];
  return kinds.filter(k => (held[k] || 0) > 0);
}
export function nextStep(view, held) {
  if(typeof view.nextStep==='string')return view.nextStep;
  const open = id => view.objectives.find(o => o.id === id && !o.done);
  const more = o => o.need - o.have;
  switch (view.stage) {
    case 'idle': return 'Start when your party is ready';
    case 'camp': {
      const wood = open('wood'), stone = open('stone');
      if ((wood && held.wood) || (stone && held.stone)) return 'Deliver what you carry at the forge';
      if (wood) return `Chop timber (${more(wood)} more) and bring it back`;
      if (stone) return `Mine stone (${more(stone)} more) and bring it back`;
      const god = view.objectives.find(o => o.role === 'god' && !o.done && !o.waived);
      return god ? 'Supplies in. Waiting on the God' : 'Camp ready. Hold for the star';
    }
    case 'star': {
      if (open('landed')) return 'Watch the sky for the falling star';
      if (open('guards')) return 'Defeat the star guardians';
      const star = open('star');
      if (star && held.gems) return 'Deliver star gems at the forge';
      return star ? `Mine star shards with the pick (${more(star)} more)` : 'Star recovered';
    }
    case 'rekindle': {
      const waves = view.objectives.find(o => o.id === 'waves');
      return `Guard the forge flame (wave ${Math.min(3, (waves?.have || 0) + 1)}/3)`;
    }
    case 'victory': return 'Victory! Rematch or leave';
    case 'defeat': return view.retriesLeft > 0 ? `The flame died. Retry (${view.retriesLeft} left) or leave` : 'The flame died. Rematch or leave';
    default: return '';
  }
}
// Buttons in canvas pixels. ui: {confirmLeave, hover, pressed, hint}. At most three, 70 px tall (~3 cm).
export function layoutButtons(ids, ui = {}) {
  const list = ui.confirmLeave ? ['confirm', 'cancel'] : ids;
  const x0 = 14, x1 = PANEL.px - 14, gap = 10, y = 302, h = 70, w = (x1 - x0 - gap * (list.length - 1)) / Math.max(1, list.length);
  return list.map((id, i) => ({id, x: Math.round(x0 + i * (w + gap)), y, w: Math.round(w), h}));
}
export function heroPanelModel(view, held, ui = {}) {
  const stageIndex = STAGES.findIndex(([s]) => s === view.stage);
  const ids = HERO_ACTIONS.filter(a => view.actions.includes(a));
  const canDeliver = deliverable(view.stage, held).length > 0;
  const buttons = layoutButtons(ids, ui).map(b => ({...b, label: LABELS[b.id] || b.id,
    enabled: b.id !== 'deposit' || canDeliver, hover: ui.hover === b.id, pressed: ui.pressed === b.id,
    tone: b.id === 'confirm' ? DANGER : b.id === 'leave' || b.id === 'cancel' ? DIM : null}));
  const info = (icon, label) => ({icon, label, info: true});
  const rows = view.objectives.length ? view.objectives.filter(o => !o.waived || view.objectives.length <= 3).slice(0, 3)
    .map(o => ({icon: o.icon, label: o.label, have: o.have, need: o.need, done: o.done, waived: !!o.waived}))
    : [info('path', `Camp, star, rekindle: party of ${view.party.heroes} Hero${view.party.heroes === 1 ? '' : 'es'}, ${view.party.gods} God${view.party.gods === 1 ? '' : 's'}`),
      ...(view.stage === 'defeat' ? [info('flame', `Last-stand retries left: ${view.retriesLeft}`)] : []),
      ...(view.renown ? [info('star', `Your renown: ${view.renown}`)] : [])];
  const t = view.telegraphs[0];
  const alert = ui.hint ? {text: ui.hint, color: WARN} : ui.confirmLeave ? {text: 'Leave the expedition for everyone?', color: DANGER}
    : t ? {text: `${t.label} - ${t.secondsLeft}s`, color: WARN, icon: t.kind === 'star' ? 'star' : 'skull'}
    : view.notice && view.notice !== view.title ? {text: view.notice, color: DIM} : null;
  return {stage: view.stage, title: view.title, tone: TONE[view.stage] || INK,
    timer: !['camp', 'star', 'rekindle'].includes(view.stage) ? '' : `${Math.floor(view.elapsedSeconds / 60)}:${String(view.elapsedSeconds % 60).padStart(2, '0')}`,
    track: view.mode==='battle'?[]:STAGES.map(([s, label], i) => ({label, state: view.stage === 'victory' || (stageIndex >= 0 && i < stageIndex) ? 'done' : i === stageIndex ? 'now' : 'todo'})),
    rows, next: nextStep(view, held), alert, carry: CARRY.map(([k, icon]) => ({icon, count: held[k] || 0})), buttons};
}
export function forgePanelPages(settlement){
 const pages=settlement.actions.filter(a=>a.action!=='forgeAssign').map(a=>({...a,id:`forge:${a.action}:${a.detail?.kind||a.detail?.structureId||''}`,category:a.action==='forgeSupply'?'Supplies':'Forge'}));
 const assign=settlement.actions.find(a=>a.action==='forgeAssign');
 for(const w of settlement.workers)for(const kind of ['wood','stone','gems',...ORE_KINDS,'iron'])if(kind!==w.job)pages.push({id:`forge:job:${w.id}:${kind}`,action:'forgeAssign',label:`Assign ${kind}`,title:`${w.name||w.id} · ${w.job}`,category:'Workers',enabled:assign?.enabled!==false&&!w.cargo,reason:w.cargo?'Wait for this worker to deliver cargo':assign?.reason||'',detail:{workerId:w.id,kind},cost:{},phase:w.phase});
 return pages;
}
export function forgePanelModel(settlement,pageId,ui={}){
 const pages=forgePanelPages(settlement),page=pages.find(p=>p.id===pageId)||pages[0],index=Math.max(0,pages.indexOf(page));
 const cost=Object.entries(page?.cost||{}).filter(([,n])=>n>0).map(([k,n])=>`${n} ${k}`).join(' · ');
 const ids=ui.confirmRaid?['raid-confirm','raid-cancel']:['forge-prev',page?.id||'forge-none','forge-next'];
 const buttons=layoutButtons(ids).map(b=>({...b,label:b.id==='forge-prev'?'Previous':b.id==='forge-next'?'Next':b.id==='raid-confirm'?'Confirm raid':b.id==='raid-cancel'?'Cancel':page?.label||'Unavailable',enabled:b.id===page?.id?!!page.enabled:true,hover:ui.hover===b.id,pressed:ui.pressed===b.id,tone:b.id==='raid-confirm'?DANGER:null,reason:page?.reason||''}));
 return {stage:'camp',title:'Bran’s Forge',tone:TONE.camp,timer:'',carryLabel:'Stores',carry:CARRY.map(([k,icon])=>({icon,count:settlement.stock[k]||0})),
  track:['Forge','Workers','Supplies'].map(label=>({label,state:label===page?.category?'now':'todo'})),
  rows:[{icon:'timber',label:page?.title||page?.label||'Forge',info:true},{icon:'stone',label:cost?`Cost: ${cost}`:page?.phase?`Worker: ${page.phase}`:`Forge ${settlement.level}/3 · wards ${settlement.defenses}/3`,info:true},{icon:'star',label:page?.cooldown>0?`Ready in ${Math.ceil(page.cooldown)} seconds`:page?.enabled?'Ready':page?.reason||'',info:true}],
  next:ui.confirmRaid?'Start the next raid against the forge?':settlement.goal,
  alert:{text:ui.hint||`Page ${index+1} / ${pages.length}${settlement.encounter?` · ${settlement.encounter.foes.length} raiders`:''}`,color:ui.confirmRaid?DANGER:DIM},buttons,pageId:page?.id};
}
function sectionButton(section,ui){return {id:section==='forge'?'nav-quest':'nav-forge',label:section==='forge'?'Quest':'Forge',x:376,y:9,w:120,h:36,enabled:true,hover:ui.hover===(section==='forge'?'nav-quest':'nav-forge'),pressed:false};}
export function hitButton(buttons, u, v, pad = 4) {
  return buttons.find(b => u >= b.x - pad && u <= b.x + b.w + pad && v >= b.y - pad && v <= b.y + b.h + pad) || null;
}
// Panel-local metres (x right, y up, origin at centre) -> canvas pixels.
export const toCanvas = (x, y) => ({u: (x / PANEL.width + .5) * PANEL.px, v: (.5 - y / PANEL.height) * PANEL.py});

// ---------------------------------------------------------------- canvas drawing (one call per model change)
const glyphs = {};
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
export function drawHeroPanel(ctx, m) {
  const {px: W, py: H} = PANEL;
  const glyph = (name, x, y, size, color) => {
    if (typeof Path2D === 'undefined') return;
    glyphs[name] ||= new Path2D(ADVENTURE_ICONS[name] || ADVENTURE_ICONS.star);
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.fillStyle = color; ctx.fill(glyphs[name], 'evenodd'); ctx.restore();
  };
  ctx.save(); ctx.clearRect(0, 0, W, H);
  roundRect(ctx, 2, 2, W - 4, H - 4, 18); ctx.fillStyle = BG; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = m.tone; ctx.stroke();
  ctx.fillStyle = m.tone; ctx.fillRect(18, 3, W - 36, 5);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  glyph(m.stage === 'rekindle' ? 'flame' : m.stage === 'star' ? 'star' : 'timber', 14, 15, 28, m.tone);
  ctx.fillStyle = INK; ctx.font = '600 25px system-ui,sans-serif'; ctx.fillText(m.title, 50, 30, W - 140);
  if (m.timer) { ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = '22px system-ui,sans-serif'; ctx.fillText(m.timer, W - 16, 30); ctx.textAlign = 'left'; }
  // Stage track
  const tw = (W - 28 - 12) / 3;
  m.track.forEach((s, i) => {
    const x = 14 + i * (tw + 6);
    ctx.fillStyle = s.state === 'todo' ? '#ffffff22' : m.tone; ctx.globalAlpha = s.state === 'done' ? .55 : 1;
    roundRect(ctx, x, 54, tw, 8, 4); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = s.state === 'now' ? INK : DIM; ctx.font = `${s.state === 'now' ? 600 : 400} 16px system-ui,sans-serif`;
    ctx.fillText((s.state === 'done' ? '✓ ' : '') + s.label, x + 2, 76, tw - 4);
  });
  // Objectives
  let y = 104;
  ctx.font = '19px system-ui,sans-serif';
  for (const o of m.rows) {
    ctx.globalAlpha = o.waived ? .5 : 1;
    glyph(o.icon, 14, y - 11, 22, o.done ? OK : m.tone);
    ctx.fillStyle = o.info ? DIM : INK; ctx.fillText(o.label, 44, y - 2, o.info ? W - 60 : W - 150);
    if (o.info) { ctx.globalAlpha = 1; y += 31; continue; }
    ctx.textAlign = 'right'; ctx.fillStyle = o.done ? OK : INK; ctx.fillText(o.done ? '✓' : `${o.have}/${o.need}`, W - 16, y - 2); ctx.textAlign = 'left';
    if (!o.done && o.need > 1) { ctx.fillStyle = '#ffffff1f'; ctx.fillRect(44, y + 11, W - 60, 4); ctx.fillStyle = m.tone; ctx.fillRect(44, y + 11, (W - 60) * o.have / o.need, 4); }
    ctx.globalAlpha = 1; y += 31;
  }
  // Next step
  roundRect(ctx, 10, 196, W - 20, 36, 8); ctx.fillStyle = PANEL_BG; ctx.fill(); ctx.fillStyle = m.tone; ctx.fillRect(10, 200, 4, 28);
  ctx.fillStyle = INK; ctx.font = '600 20px system-ui,sans-serif'; ctx.fillText(m.next, 24, 214, W - 44);
  // Alert / notice
  if (m.alert) {
    ctx.fillStyle = m.alert.color; ctx.font = '600 17px system-ui,sans-serif';
    if (m.alert.icon) glyph(m.alert.icon, 14, 236, 18, m.alert.color);
    ctx.fillText(m.alert.text, m.alert.icon ? 38 : 16, 246, W - 54);
  }
  // Carried resources
  ctx.fillStyle = DIM; ctx.font = '16px system-ui,sans-serif'; ctx.fillText(m.carryLabel||'Carrying', 16, 278);
  m.carry.forEach((c, i) => {
    const x = 112 + i * 128;
    glyph(c.icon, x, 266, 22, c.count ? INK : '#ffffff44');
    ctx.fillStyle = c.count ? INK : '#ffffff55'; ctx.font = '600 20px system-ui,sans-serif'; ctx.fillText(String(c.count), x + 30, 278);
  });
  // Buttons
  for (const b of m.buttons) {
    const tone = b.tone || m.tone;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.globalAlpha = b.enabled ? 1 : .45;
    ctx.fillStyle = b.pressed ? tone : b.hover ? `${tone}55` : PANEL_BG; ctx.fill();
    ctx.lineWidth = b.hover ? 4 : 2; ctx.strokeStyle = tone; ctx.stroke();
    ctx.fillStyle = b.pressed ? BG : INK; ctx.textAlign = 'center'; ctx.font = '600 22px system-ui,sans-serif';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (b.id === 'deposit' && !b.enabled ? -9 : 0), b.w - 12);
    if (b.id === 'deposit' && !b.enabled) { ctx.font = '15px system-ui,sans-serif'; ctx.fillStyle = DIM; ctx.fillText('carry first', b.x + b.w / 2, b.y + b.h / 2 + 15); }
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- Three.js panel + XR interaction
const defaultCanvas = () => typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), {width: PANEL.px, height: PANEL.py})
  : new OffscreenCanvas(PANEL.px, PANEL.py);

// controllers/grips: the renderer.xr target-ray and grip spaces (index-aligned). sources: Map<index, XRInputSource>.
// onAction(name, detail): lobby routes forge* to ordinary authority actions, others to expeditionAction.
export function createVRAdventurePanel({parent, controllers, grips, sources, onAction = () => {}, pointerHand = 'right',
  createCanvas = defaultCanvas, now = () => performance.now()}) {
  const canvas = createCanvas(), ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({map: texture, alphaTest: .5, toneMapped: false, fog: false});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.width, PANEL.height), material);
  mesh.name = 'vr-adventure-panel'; mesh.visible = false;
  mesh.userData.ignoreContact = true; mesh.raycast = () => {}; // never a world/weapon target
  const cursor = new THREE.Mesh(new THREE.CircleGeometry(.0028, 12), new THREE.MeshBasicMaterial({color: 0xfff1c8, toneMapped: false, fog: false, depthTest: false}));
  cursor.renderOrder = 1; cursor.visible = false; cursor.raycast = () => {}; mesh.add(cursor);
  parent.add(mesh);

  let view = null, held = {wood: 0, stone: 0, gems: 0}, model = null, key = '', drawn = 0, shown = false, disposed = false;
  let hover = null, onPanel = false, pressed = null, confirmAt = 0, hint = null, hintUntil = 0, lastSent = {};
  let settlement=null,section='quest',pageId=null,raidConfirmAt=0,lastSourceCount=0;
  const inverse = new THREE.Matrix4(), origin = new THREE.Vector3(), dir = new THREE.Vector3(), head = new THREE.Vector3();
  const headFwd = new THREE.Vector3(), anchor = new THREE.Vector3(), handFwd = new THREE.Vector3(), quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), local = new THREE.Vector3();

  const indexOf = hand => { for (const [i, s] of sources) if (s.handedness === hand) return i; return undefined; };
  const pointerIndex=()=>indexOf(pointerHand)??(sources.size===1?sources.keys().next().value:undefined);
  const panelHand = () => pointerHand === 'left' ? 'right' : 'left';
  function redraw() {
    if (!view) return false;
    const t = now();
    if (hint && t > hintUntil) hint = null;
    if (confirmAt && t - confirmAt > GATE.confirmMs) confirmAt = 0;
    if(raidConfirmAt&&t-raidConfirmAt>GATE.confirmMs)raidConfirmAt=0;
    const ui={confirmLeave:!!confirmAt,confirmRaid:!!raidConfirmAt,hover,pressed:pressed?.button||null,hint};
    model=section==='forge'&&settlement?forgePanelModel(settlement,pageId,ui):heroPanelModel(view,held,ui);
    if(section==='forge')pageId=model.pageId;
    if(settlement){model.timer='';model.buttons.push(sectionButton(section,ui));}
    const next = JSON.stringify(model);
    if (next === key) return false;
    key = next; drawHeroPanel(ctx, model); texture.needsUpdate = true; drawn++;
    return true;
  }
  function hide() { shown = false; mesh.visible = false; cursor.visible = false; onPanel = false; hover = null; }
  // Pointer ray against the panel quad in panel-local space. Returns {u, v, button} or null.
  function pointerHit() {
    const i = pointerIndex();
    if (!shown || i === undefined || !controllers[i]) return null;
    controllers[i].updateWorldMatrix(true, false);
    origin.setFromMatrixPosition(controllers[i].matrixWorld);
    dir.set(0, 0, -1).transformDirection(controllers[i].matrixWorld);
    inverse.copy(mesh.matrixWorld).invert();
    origin.applyMatrix4(inverse); dir.transformDirection(inverse);
    if (dir.z >= -1e-4) return null; // parallel or from behind
    const t = -origin.z / dir.z;
    if (t <= 0 || t > GATE.reach) return null;
    local.copy(origin).addScaledVector(dir, t);
    if (Math.abs(local.x) > PANEL.width / 2 || Math.abs(local.y) > PANEL.height / 2) return null;
    const {u, v} = toCanvas(local.x, local.y);
    return {u, v, x: local.x, y: local.y, button: model ? hitButton(model.buttons, u, v) : null};
  }
  function pulse(i, strength, ms) { sources.get(i)?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms)?.catch?.(() => {}); }
  function activate(id) {
    const t = now();
    if(id==='nav-forge'||id==='nav-quest'){section=id==='nav-forge'?'forge':'quest';confirmAt=0;raidConfirmAt=0;hint=null;return;}
    if(id==='forge-prev'||id==='forge-next'){const pages=forgePanelPages(settlement),i=pages.findIndex(p=>p.id===pageId);pageId=pages[(i+(id==='forge-next'?1:-1)+pages.length)%pages.length]?.id;raidConfirmAt=0;return;}
    if(id==='raid-cancel'){raidConfirmAt=0;return;}
    if(id==='raid-confirm'){
      const action=settlement?.actions.find(a=>a.action==='forgeEncounter');
      if(raidConfirmAt&&t-raidConfirmAt>=GATE.confirmMinMs&&action?.enabled){raidConfirmAt=0;send('forgeEncounter',t);}
      else if(!action?.enabled){raidConfirmAt=0;hint=action?.reason||'Raid unavailable';hintUntil=t+GATE.hintMs;}return;
    }
    if(id.startsWith('forge:')){
      const action=forgePanelPages(settlement).find(a=>a.id===id);
      if(!action?.enabled){hint=action?.reason||'Action unavailable';hintUntil=t+GATE.hintMs;return;}
      if(action.action==='forgeEncounter'){raidConfirmAt=t;return;}
      send(action.action,t,action.detail,id);return;
    }
    if (id === 'cancel') { confirmAt = 0; return; }
    if (id === 'leave') { confirmAt = t; return; }
    if (id === 'confirm') { if (confirmAt && t - confirmAt >= GATE.confirmMinMs) { confirmAt = 0; send('leave', t); } return; }
    if (id === 'deposit' && !deliverable(view.stage, held).length) {
      hint = view.stage === 'star' ? 'Mine star shards with the pick first' : 'Gather timber or stone first'; hintUntil = t + GATE.hintMs; return;
    }
    send(id, t);
  }
  function send(id, t, detail={},key=id) { if (t - (lastSent[key] ?? -Infinity) < GATE.repeatMs) return; lastSent[key] = t; onAction(id,detail); }

  return {
    mesh,
    // Call from lobby onSnapshot (via game hook) with adventureView(...) and the snapshot; null hides the panel.
    update(nextView, snapshot, playerId) {
      if (disposed) return false;
      const wasEmpty=!view;view = nextView || null; held = carried(snapshot, playerId);
      settlement=snapshot?.settlement?settlementView(snapshot,playerId):null;
      if(settlement&&snapshot.inventions){const m=inventionView(snapshot,playerId);settlement.stock=m.stock;settlement.goal='Gather, refine, invent. Place with the controller ray.';settlement.actions=[{action:'inventionDeposit',label:'Deposit all',enabled:m.canDeposit},{action:'inventionCollectOutput',label:'Collect metal',enabled:snapshot.pickups.some(q=>q.id.startsWith('ingot')&&q.side===m.side)},...ORE_KINDS.map(kind=>({action:'inventionRefine',label:'Refine '+kind,enabled:m.refine[kind].enabled,detail:{kind,amount:1}})),...m.recipes.filter(r=>r.id!=='forge').map(r=>({action:'inventionPlace',label:'Build '+r.name,cost:r.cost,enabled:r.enabled,reason:'Gather the recipe materials',detail:{kind:r.id}})),...m.structures.filter(b=>b.type!=='forge'&&!b.passive).map(b=>({action:['timberline','launcher'].includes(b.type)?'inventionAim':'inventionUse',label:b.useLabel+' '+b.name,enabled:b.hp>0&&b.usable,detail:{structureId:b.id}})),...m.structures.filter(b=>['timberline','launcher'].includes(b.type)).map(b=>({action:'inventionTurn',label:'Turn 45° '+b.name,enabled:b.hp>0&&b.usable&&!b.cooldown,detail:{structureId:b.id}})),...m.structures.filter(b=>b.type!=='forge'&&b.hp<b.maxHp).map(b=>({action:'inventionRepair',label:'Repair '+b.name,cost:b.repairCost,enabled:b.repairEnabled,detail:{structureId:b.id}})),{action:'inventionAssault',label:'Call assault',enabled:!snapshot.inventions.assault},...settlement.actions.filter(a=>['forgeSummon','forgeAssign'].includes(a.action))];}
      if(wasEmpty&&settlement&&view?.stage==='idle')section='forge';
      if (!view) { hide(); pressed = null; confirmAt = 0;raidConfirmAt=0;section='quest';pageId=null;return false; }
      return redraw();
    },
    setPointerHand(hand) { if (hand === 'left' || hand === 'right') { pointerHand = hand; pressed = null; hide(); } },
    // Per XR frame, after controller poses update. headObject: renderer.xr.getCamera(). suppressed: e.g. role !== 'hero'.
    tick(headObject, {suppressed = false} = {}) {
      if (disposed) return;
      const single=sources.size===1,pi = single?pointerIndex():indexOf(panelHand());
      const grip = pi === undefined ? null : sources.get(pi)?.gripSpace ? grips[pi] : controllers[pi];
      if (!view || suppressed || !grip || !headObject) { hide(); return; }
      grip.updateWorldMatrix(true, false); headObject.updateWorldMatrix(true, false);
      anchor.setFromMatrixPosition(grip.matrixWorld).addScaledVector(up, GATE.lift);
      head.setFromMatrixPosition(headObject.matrixWorld);
      headFwd.set(0, 0, -1).transformDirection(headObject.matrixWorld);
      if(single)anchor.copy(head).addScaledVector(headFwd,.48);
      if(lastSourceCount!==sources.size){if(pressed)pressed.cancelled=true;lastSourceCount=sources.size;}
      handFwd.set(0, 0, -1).transformDirection(grip.matrixWorld);
      const toPanel = local.copy(anchor).sub(head), dist = toPanel.length();
      const angle = THREE.MathUtils.radToDeg(toPanel.divideScalar(dist || 1).angleTo(headFwd)), aim = handFwd.dot(headFwd);
      const visible = single?headFwd.y<(shown?-.12:-.22):dist >= GATE.near && dist <= GATE.far && angle <= (shown ? GATE.hideAngle : GATE.showAngle) && aim <= (shown ? GATE.hideAim : GATE.showAim);
      if (!visible) { if (shown) { hide(); redraw(); } return; }
      shown = true; mesh.visible = true;
      mesh.parent.updateWorldMatrix(true, false); mesh.position.copy(mesh.parent.worldToLocal(anchor)); mesh.lookAt(head); mesh.updateMatrixWorld(true);
      const hit = pointerHit();
      onPanel = !!hit; cursor.visible = onPanel;
      if (hit) cursor.position.set(hit.x, hit.y, .002);
      const nextHover = hit?.button?.enabled !== false ? hit?.button?.id || null : null;
      if (nextHover !== hover) { hover = nextHover; if (hover) pulse(pointerIndex(), .08, 12); }
      redraw(); // no-op unless hover/press/confirm/hint changed the drawn model
    },
    // Wire first in game.js selectstart/selectend. true = consumed: the game must not fire, strike or cast this press.
    handleSelectStart(index) {
      if (disposed || index !== pointerIndex()) return false;
      const hit = pointerHit();
      if (!hit) return false;
      pressed = {index, button: hit.button?.id || null}; redraw();
      return true;
    },
    handleSelectEnd(index) {
      if (!pressed || pressed.index !== index) return false;
      const started = pressed.cancelled?null:pressed.button, hit = pointerHit();
      pressed = null;
      if (started && hit?.button?.id === started) { activate(started); pulse(index, .3, 25); }
      redraw();
      return true;
    },
    // XR sessionend / controller loss: drop all transient interaction state.
    endSession() { hide(); pressed = null; confirmAt = 0;raidConfirmAt=0; hint = null; lastSent = {}; },
    state: () => ({shown, onPanel, hover, pressed: pressed && {...pressed}, confirmLeave: !!confirmAt,confirmRaid:!!raidConfirmAt,section, hint, redraws: drawn, pointerHand, model}),
    dispose() {
      if (disposed) return; disposed = true;
      parent.remove(mesh); mesh.geometry.dispose(); material.dispose(); texture.dispose();
      cursor.geometry.dispose(); cursor.material.dispose();
    },
  };
}
