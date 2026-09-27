/* Brann's Forge · The Director — HUD controller (no dependencies).
   Contract: GET /api/director/state, POST /api/director/command, GET /api/director/frame?after=SEQ
   Append ?demo to the URL to run against an in-page mock (no backend). */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const game = $('game'), frameImg = $('live-frame');
const CARD_ORDER = ['skeletons', 'wisps', 'golem', 'gloom'];
const LANES = ['west', 'north', 'east'];
const LANE_TITLE = { west: 'the West path', north: 'the North ruins', east: 'the East grove' };
// Fallback anchor points (normalized to the frame) until Godot reports lane screen coordinates.
const LANE_DEFAULT = { west: { x: .2, y: .6 }, north: { x: .5, y: .34 }, east: { x: .8, y: .6 } };
const PHASE_TEXT = {
  offline: 'The world is not awake', waiting: 'Ready to begin', running: 'The forest is stirring',
  adventurer_win: 'The adventurer escaped', director_win: 'The forest held',
};
const DEMO = new URLSearchParams(location.search).has('demo');

let state = null, connected = false, serviceUp = true;
let selectedCard = null;   // card chosen, awaiting a lane click
let lane = null;           // current (sticky) lane — set by hover, focus, click, Q/E
let hoverLane = null;      // lane currently under the pointer
const pendingCards = new Set();
let lastStateAt = 0, lastBudget = null, regenRate = 0, prevHealth = null, prevClaimed = 0;
const wasCooling = {};

const cardEls = Object.fromEntries([...document.querySelectorAll('.card')].map(b => [b.dataset.card, b]));
const markerEls = Object.fromEntries([...document.querySelectorAll('.lane-marker')].map(b => [b.dataset.lane, b]));
const laneBtnEls = [...document.querySelectorAll('.lane-btn')];

/* ── Networking ─────────────────────────────────────────────── */
const api = DEMO ? makeDemo() : {
  async state() { const r = await fetch('/api/director/state', { cache: 'no-store' }); if (!r.ok) throw Error('state ' + r.status); return r.json(); },
  async command(body) {
    const r = await fetch('/api/director/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok || data.ok === false) throw Error(data.error || data.message || 'The forest did not answer.');
    return data;
  },
  async frame(after) { return fetch('/api/director/frame?after=' + encodeURIComponent(after), { cache: 'no-store' }); },
};

async function poll() {
  try {
    const s = await api.state();
    if (!serviceUp) toast('The table reconnected.', 'ok');
    serviceUp = true; applyState(s);
  } catch (e) {
    if (serviceUp) toast('Lost contact with the local service.', 'err');
    serviceUp = false; connected = false; game.dataset.connected = 'false';
    $('connection-text').textContent = 'Service unreachable';
  } finally { setTimeout(poll, document.hidden ? 1000 : 220); }
}

/* Live frame loop: long-poll style; 204 = nothing new yet. */
let frameSeq = 0, frameUrl = null, frameFails = 0, lastFrameAt = 0;
async function frameLoop() {
  let delay = 16;
  try {
    const r = await api.frame(frameSeq);
    if (r.status === 200) {
      const seq = Number(r.headers.get('X-Director-Sequence'));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      await new Promise(res => { frameImg.onload = frameImg.onerror = res; frameImg.src = url; });
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      frameUrl = url;
      frameSeq = Number.isFinite(seq) && seq > 0 ? seq : Math.max(frameSeq + 1, state?.frameSequence || 0);
      lastFrameAt = performance.now(); frameFails = 0;
      if (!game.classList.contains('has-frame')) { game.classList.add('has-frame'); placeLanes(); }
    } else { delay = 170; }
  } catch { frameFails++; delay = Math.min(2000, 100 * frameFails); }
  game.classList.toggle('frame-stale', lastFrameAt > 0 && performance.now() - lastFrameAt > 2500);
  setTimeout(frameLoop, delay);
}

/* ── State → DOM ────────────────────────────────────────────── */
function applyState(s) {
  if (state?.sessionId && state.sessionId !== s.sessionId) {
    frameSeq = 0;
    game.classList.remove('has-frame');
    frameImg.removeAttribute('src');
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    frameUrl = null;
  }
  window.directorUiState = s;
  const now = performance.now();
  // Estimate regeneration from observed budget deltas (server may also provide it).
  const max = maxBudget(s);
  if (s.budgetRate ?? s.regen ?? s.sparkRate) regenRate = +(s.budgetRate ?? s.regen ?? s.sparkRate);
  else if (lastBudget != null && s.phase === 'running' && s.budget > lastBudget && lastBudget < max) {
    const dt = (now - lastStateAt) / 1000;
    if (dt > .05 && dt < 3) regenRate = regenRate ? regenRate * .8 + ((s.budget - lastBudget) / dt) * .2 : (s.budget - lastBudget) / dt;
  }
  if (lastBudget != null && s.budget >= lastBudget + .999) bumpSparks();
  lastBudget = s.budget; lastStateAt = now;

  const prevPhase = state?.phase;
  state = s; connected = !!s.gameConnected;
  game.dataset.phase = s.phase || 'offline';
  game.dataset.connected = String(connected);
  $('connection-text').textContent = connected ? 'Godot connected' : 'Waiting for Godot';

  if (prevPhase && prevPhase !== s.phase) onPhaseChange(prevPhase, s.phase);

  const g = s.game || {};
  // Round / time
  $('round').textContent = 'Round ' + (s.round ?? 1);
  $('phase').textContent = PHASE_TEXT[s.phase] || s.phase || '';
  const secs = Math.max(0, g.secondsLeft ?? 150);
  $('time').textContent = fmtTime(secs);
  $('time').parentElement.classList.toggle('urgent', s.phase === 'running' && secs <= 20);

  // Hero health
  const hpMax = g.maxHealth ?? g.player?.maxHealth ?? 100;
  const hp = Math.max(0, g.health ?? g.player?.health ?? hpMax), pct = Math.min(100, hp / hpMax * 100);
  $('health').textContent = Math.ceil(hp); $('health-max').textContent = hpMax;
  $('hp-fill').style.width = pct + '%'; $('hp-lag').style.width = pct + '%';
  $('hp-meter').setAttribute('aria-valuenow', Math.round(pct));
  const hero = document.querySelector('.hero-panel');
  hero.classList.toggle('hurt', pct <= 60 && pct > 25); hero.classList.toggle('critical', pct <= 25);
  if (prevHealth != null && hp < prevHealth - .5) { hero.classList.remove('flash'); void hero.offsetWidth; hero.classList.add('flash'); }
  prevHealth = hp;

  // Waystones
  const beacons = Array.isArray(g.beacons) ? g.beacons : [];
  const total = Math.max(3, beacons.length);
  const stonesEl = $('stones');
  while (stonesEl.children.length < total) stonesEl.insertAdjacentHTML('beforeend', '<li class="stone"><i></i></li>');
  let claimed = 0;
  [...stonesEl.children].forEach((li, i) => {
    const b = beacons[i] || {}; const c = !!b.claimed; if (c) claimed++;
    li.classList.toggle('claimed', c);
    li.style.setProperty('--c', Math.round(Math.min(1, b.charge || 0) * 100) + '%');
    li.title = c ? 'Awakened' : b.charge ? `Charging ${Math.round(b.charge * 100)}%` : 'Dormant';
  });
  if (claimed > prevClaimed && s.phase === 'running') {
    const li = stonesEl.children[claimed - 1]; li?.classList.add('new'); setTimeout(() => li?.classList.remove('new'), 900);
    toast('A waystone has awakened!', 'info');
  }
  prevClaimed = claimed;
  $('stones-count').textContent = `${claimed}/${total}`;

  // Field stats
  const alive = (g.enemies || []).filter(e => e.alive !== false).length;
  $('enemies').textContent = alive;
  const gl = g.gloom; const gloomOn = !!(gl && (gl === true || gl.active || gl > 0 || gl.secondsLeft > 0));
  $('gloom').textContent = gloomOn ? (typeof gl === 'number' ? Math.ceil(gl) + 's' : gl.secondsLeft ? Math.ceil(gl.secondsLeft) + 's' : 'Active') : '—';
  $('gloom-stat').classList.toggle('on', gloomOn); game.classList.toggle('gloom-on', gloomOn);

  // Cards: static text
  for (const type of CARD_ORDER) {
    const c = s.cards?.[type], el = cardEls[type]; if (!c || !el) continue;
    el.querySelector('[data-cost]').textContent = fmtCost(c.cost);
    el.querySelector('.card-name').textContent = c.name || el.querySelector('.card-name').textContent;
    el.querySelector('[data-sub]').textContent = (c.count ? `${c.count} × ` : '') + subName(type, c);
  }

  // Lanes available / positions
  updateLaneAvailability();
  placeLanes();
  renderOverlay();
  $('sparks-max').textContent = max;
  if ($('sparks-ticks').childElementCount !== Math.round(max)) $('sparks-ticks').innerHTML = '<i></i>'.repeat(Math.round(max));
}

/* Per-frame: cooldown bars, sparks extrapolation, affordability. */
function tick() {
  requestAnimationFrame(tick);
  if (!state) return;
  const s = state, max = maxBudget(s), running = s.phase === 'running';
  const elapsed = (performance.now() - lastStateAt) / 1000;
  const budget = Math.min(max, s.budget + (running && s.budget < max ? regenRate * Math.min(elapsed, .6) : 0));
  $('sparks').textContent = budget.toFixed(1);
  $('sparks-fill').style.width = (budget / max * 100) + '%';
  $('sparks-bar').setAttribute('aria-valuenow', budget.toFixed(1));
  const regen = $('regen');
  if (budget >= max - .01) { regen.textContent = 'Full'; regen.classList.add('full'); }
  else { regen.textContent = '+' + regenRate.toFixed(1) + '/s'; regen.classList.remove('full'); }

  const now = Date.now();
  for (const type of CARD_ORDER) {
    const el = cardEls[type], c = s.cards?.[type]; if (!el || !c) continue;
    const st = cardStatus(type, budget, now);
    el.classList.toggle('cooling', st.cooling);
    el.classList.toggle('poor', st.poor);
    el.classList.toggle('locked', st.locked);
    el.classList.toggle('pending', pendingCards.has(type));
    el.classList.toggle('selected', selectedCard === type);
    el.setAttribute('aria-disabled', String(!!st.reason));
    el.querySelector('[data-reason]').textContent = st.short || '';
    el.title = st.reason ? st.reason : `${c.name} — ${fmtCost(c.cost)} sparks, ${c.cooldown}s recharge. Press ${CARD_ORDER.indexOf(type) + 1}.`;
    if (st.cooling) {
      el.style.setProperty('--cdp', (st.progress * 100).toFixed(1) + '%');
      el.querySelector('[data-cdfill]').style.width = (st.progress * 100).toFixed(1) + '%';
      el.querySelector('[data-cdnum]').textContent = st.remain >= 10 ? Math.ceil(st.remain) : st.remain.toFixed(1);
    }
    if (wasCooling[type] && !st.cooling) { el.classList.remove('ready-pop'); void el.offsetWidth; el.classList.add('ready-pop'); }
    wasCooling[type] = st.cooling;
  }
  // Preview the cost of the selected/hovered card on the sparks bar.
  const pv = $('sparks-preview'), pc = s.cards?.[previewCard];
  if (pc && running) {
    const cost = +pc.cost, from = Math.max(0, budget - cost);
    pv.style.left = (from / max * 100) + '%'; pv.style.width = (Math.min(cost, budget) / max * 100) + '%';
    pv.classList.toggle('short', budget < cost);
    if (budget < cost) { pv.style.left = (budget / max * 100) + '%'; pv.style.width = ((cost - budget) / max * 100) + '%'; }
  } else pv.style.width = '0';
}

function cardStatus(type, budget = state.budget, now = Date.now()) {
  const c = state.cards?.[type];
  const readyAt = +(state.cooldowns?.[type] || 0), dur = Math.max(.001, +(c?.cooldown || 0)) * 1000;
  const remainMs = Math.max(0, readyAt - now), cooling = remainMs > 0;
  const progress = cooling ? Math.min(1, Math.max(0, 1 - remainMs / dur)) : 1;
  const poor = !!c && budget + 1e-6 < +c.cost;
  let reason = '', short = '', locked = false;
  if (!serviceUp) { reason = 'The local service is unreachable.'; short = 'No link'; locked = true; }
  else if (!connected) { reason = 'Godot is not connected yet.'; short = 'No world'; locked = true; }
  else if (state.phase !== 'running') { reason = state.phase === 'waiting' ? 'The round has not begun.' : 'The round is over.'; short = state.phase === 'waiting' ? 'Not begun' : 'Round over'; locked = true; }
  else if (cooling) { reason = `Recharging — ready in ${(remainMs / 1000).toFixed(1)}s.`; short = 'Recharging'; }
  else if (poor) { const need = (+c.cost - budget); reason = `Need ${need.toFixed(1)} more sparks.`; short = `Need ${need.toFixed(1)} ✦`; }
  return { cooling, progress, remain: remainMs / 1000, poor, locked, reason, short };
}

/* ── Commands ───────────────────────────────────────────────── */
async function cast(type, atLane, origin = 'key') {
  const el = cardEls[type]; if (!state || !el) return;
  if (!atLane) { selectCard(type); return; }
  const st = cardStatus(type);
  if (st.reason) { deny(el, st.reason); markerEls[atLane]?.classList.add('miss'); setTimeout(() => markerEls[atLane]?.classList.remove('miss'), 500); return; }
  if (pendingCards.has(type)) return;
  const c = state.cards[type];
  pendingCards.add(type); selectedCard = null; syncArmed();
  el.classList.remove('cast'); void el.offsetWidth; el.classList.add('cast');
  flashAt(atLane);
  try {
    await api.command({ sessionId: state.sessionId, type, lane: atLane });
    toast(`${c.name} answers from ${LANE_TITLE[atLane] || atLane}.`, 'ok');
    // Optimistic: reflect the spend & cooldown immediately; next poll corrects.
    state.budget = Math.max(0, state.budget - c.cost); lastBudget = state.budget;
    state.cooldowns = { ...(state.cooldowns || {}), [type]: Math.max(+(state.cooldowns?.[type] || 0), Date.now() + c.cooldown * 1000) };
  } catch (e) { deny(el, e.message || 'The call failed.'); }
  finally { pendingCards.delete(type); }
}

async function sendPhase() {
  if (!state) return;
  const type = state.phase === 'waiting' ? 'start' : 'rematch';
  const btn = $('start'); btn.classList.add('busy'); btn.disabled = true;
  try { await api.command({ sessionId: state.sessionId, type }); toast(type === 'start' ? 'The contest begins.' : 'A fresh round is prepared.', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
  finally { btn.classList.remove('busy'); renderOverlay(); }
}

function selectCard(type) {
  const st = cardStatus(type);
  if (st.locked) { deny(cardEls[type], st.reason); return; }
  selectedCard = selectedCard === type ? null : type;
  syncArmed();
  if (selectedCard) {
    const extra = st.reason ? ` (${st.reason})` : '';
    setHint(`<b>${state.cards[type].name}</b> ready — click an approach.${extra}`);
  }
}

function deny(el, reason) {
  toast(reason, 'err');
  el?.classList.remove('deny'); void el?.offsetWidth; el?.classList.add('deny');
  if (/spark/i.test(reason)) { const sp = document.querySelector('.sparks'); sp.classList.remove('deny'); void sp.offsetWidth; sp.classList.add('deny'); }
}

/* ── Lanes ──────────────────────────────────────────────────── */
function setLane(l, announce) {
  if (l && !LANES.includes(l)) return;
  lane = l;
  for (const [k, m] of Object.entries(markerEls)) m.classList.toggle('active', k === l);
  for (const b of laneBtnEls) b.setAttribute('aria-pressed', String(b.dataset.lane === l));
  game.style.setProperty('--lane-label', l ? `"Call → ${cap(l)}"` : '""');
  game.classList.toggle('has-lane', !!l);
  syncArmed();
  if (announce && l) setHint(`Approach: <b>${cap(l)}</b>. Press <b>1–4</b> to call.`);
}
function cycleLane(dir) {
  const avail = availableLanes();
  const i = avail.indexOf(lane);
  setLane(avail[(i + dir + avail.length) % avail.length] ?? avail[0], true);
}
function laneActivate(l) {
  setLane(l, true);
  if (selectedCard) cast(selectedCard, l, 'lane');
  else setHint(`Approach: <b>${cap(l)}</b>. Press <b>1–4</b> or click a call.`);
}
function availableLanes() {
  const L = state?.lanes;
  if (Array.isArray(L) && L.length && typeof L[0] === 'string') return L.filter(l => LANES.includes(l));
  return LANES;
}
function updateLaneAvailability() {
  const avail = availableLanes();
  for (const l of LANES) {
    markerEls[l].hidden = !avail.includes(l);
    laneBtnEls.find(b => b.dataset.lane === l).hidden = !avail.includes(l);
  }
  game.dataset.laneCount = avail.length;
}

/* Lane screen coordinates: accepts game.laneScreen | game.lanes | state.lanes as
   {west:{x,y}} or {west:[x,y]} or [{lane|name|id,x,y}], normalized (0–1) or frame pixels. */
function laneCoords() {
  const g = state?.game || {};
  const src = g.laneScreen || g.laneScreenCoords || g.lanesScreen || (typeof g.lanes === 'object' ? g.lanes : null) || (state?.lanes && !Array.isArray(state.lanes) ? state.lanes : null) || (Array.isArray(state?.lanes) && typeof state.lanes[0] === 'object' ? state.lanes : null);
  const out = {};
  if (Array.isArray(src)) for (const e of src) { const k = e.lane || e.name || e.id; if (k) out[k] = e; }
  else if (src) Object.assign(out, src);
  const res = {};
  for (const l of LANES) {
    let p = out[l];
    if (Array.isArray(p)) p = { x: p[0], y: p[1] };
    else if (p && p.screen) p = { ...p.screen, visible: p.visible ?? p.screen.visible };
    else if (p && (p.screenX != null)) p = { x: p.screenX, y: p.screenY, visible: p.visible };
    res[l] = p && Number.isFinite(+p.x) && Number.isFinite(+p.y) ? { x: +p.x, y: +p.y, visible: p.visible !== false && p.onScreen !== false } : { ...LANE_DEFAULT[l], visible: true, fallback: true };
  }
  return res;
}
function placeLanes() {
  const W = innerWidth, H = innerHeight;
  const iw = frameImg.naturalWidth || 1920, ih = frameImg.naturalHeight || 1080;
  const k = Math.max(W / iw, H / ih), ox = (W - iw * k) / 2, oy = (H - ih * k) / 2; // object-fit: cover
  const coords = laneCoords();
  for (const l of LANES) {
    const p = coords[l], m = markerEls[l];
    const nx = p.x <= 1.5 ? p.x * iw : p.x, ny = p.y <= 1.5 ? p.y * ih : p.y;
    const x = ox + nx * k, y = oy + ny * k;
    m.style.setProperty('--x', x.toFixed(1) + 'px'); m.style.setProperty('--y', y.toFixed(1) + 'px');
    m.classList.toggle('offscreen', !p.visible || x < -20 || y < -20 || x > W + 20 || y > H + 20);
  }
}

/* ── Overlay (offline / waiting / results) ─────────────────── */
function renderOverlay() {
  if (!state) return;
  const p = state.phase, g = state.game || {}, btn = $('start');
  if (p === 'running') return; // keep the last card's copy while the overlay fades out
  const claimed = (g.beacons || []).filter(b => b.claimed).length;
  const T = {
    offline: ['The forest sleeps', 'Start Director Mode in Godot. The table wakes when the world does.', null],
    waiting: ['The forest awaits', 'An adventurer enters Pinewood Ruins seeking three waystones. Hold them back until the sands run out — or wear them down.', 'Begin round'],
    adventurer_win: ['The adventurer escaped', 'The waystones blaze and the path lies open. The forest will remember this.', 'Rematch'],
    director_win: ['The forest held', 'Roots and bone and shadow stood firm. A story worth surviving — barely.', 'Rematch'],
  }[p] || ['The Director', PHASE_TEXT[p] || '', null];
  $('po-eyebrow').textContent = p === 'waiting' || p === 'offline' ? "Brann's Forge · The Director" : `Round ${state.round ?? 1} · Complete`;
  $('po-title').textContent = T[0]; $('po-body').textContent = T[1];
  const stats = $('po-stats'), ended = p === 'adventurer_win' || p === 'director_win';
  stats.hidden = !ended;
  if (ended) stats.innerHTML = `<div><b>${claimed}/3</b><span>Waystones</span></div><div><b>${Math.ceil(g.health ?? 0)}</b><span>Hero health</span></div><div><b>${fmtTime(g.secondsLeft ?? 0)}</b><span>Time left</span></div>`;
  btn.hidden = !T[2]; if (T[2]) btn.textContent = T[2];
  if (!btn.classList.contains('busy')) btn.disabled = !connected || !serviceUp;
  if (p === 'offline' && !connected) btn.hidden = true;
}
function onPhaseChange(from, to) {
  selectedCard = null; syncArmed();
  if (to === 'running') { toast('The round has begun. Wake the forest.', 'info'); setTimeout(() => $('start').blur(), 0); }
  if (to === 'director_win') toast('Victory — the forest held.', 'ok');
  if (to === 'adventurer_win') toast('The adventurer broke through.', 'err');
  if (to !== 'running') requestAnimationFrame(() => { if (!$('start').hidden && !$('start').disabled) $('start').focus({ preventScroll: true }); });
}

/* ── Feedback helpers ───────────────────────────────────────── */
let lastToast = '', lastToastAt = 0;
function toast(text, kind = '') {
  const t = performance.now();
  if (text === lastToast && t - lastToastAt < 900) return;
  lastToast = text; lastToastAt = t;
  const list = $('toasts'), li = document.createElement('li');
  li.className = 'toast ' + kind; li.textContent = text; list.prepend(li);
  while (list.children.length > 4) list.lastElementChild.remove();
  setTimeout(() => { li.classList.add('out'); setTimeout(() => li.remove(), 420); }, kind === 'err' ? 3600 : 2600);
}
function flashAt(l) {
  const m = markerEls[l]; if (!m) return;
  m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit');
  const f = $('cast-flash'), cs = getComputedStyle(m);
  f.style.setProperty('--fx', cs.getPropertyValue('--x')); f.style.setProperty('--fy', cs.getPropertyValue('--y'));
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}
function bumpSparks() { const s = document.querySelector('.sparks'); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
function setHint(html) { $('hint').innerHTML = html; }
function syncArmed() {
  game.classList.toggle('card-armed', !!selectedCard);
  if (!selectedCard && state?.phase === 'running')
    setHint(lane ? `Approach: <b>${cap(lane)}</b>. Press <b>1–4</b> to call.` : 'Hover a glowing approach, then press <b>1–4</b>.');
}
let previewCard = null;

/* ── Input ──────────────────────────────────────────────────── */
for (const [l, m] of Object.entries(markerEls)) {
  m.addEventListener('pointerenter', () => { hoverLane = l; setLane(l, !selectedCard); });
  m.addEventListener('pointerleave', () => { if (hoverLane === l) hoverLane = null; });
  m.addEventListener('focus', () => setLane(l, true));
  // Keep lane clicks from starting a host orbit-drag on the stage underneath.
  m.addEventListener('pointerdown', e => e.stopPropagation());
  m.addEventListener('click', () => laneActivate(l));
}
for (const b of laneBtnEls) {
  b.addEventListener('click', () => laneActivate(b.dataset.lane));
  b.addEventListener('pointerenter', () => { hoverLane = b.dataset.lane; });
  b.addEventListener('pointerleave', () => { hoverLane = null; });
}
for (const [type, el] of Object.entries(cardEls)) {
  el.addEventListener('pointerenter', () => { previewCard = type; });
  el.addEventListener('pointerleave', () => { if (previewCard === type) previewCard = selectedCard; });
  el.addEventListener('focus', () => { previewCard = type; });
  el.addEventListener('click', e => {
    // A lane already chosen by hover/Q/E/tap → cast immediately; otherwise arm the card.
    const target = hoverLane || lane;
    if (target) cast(type, target, 'card'); else selectCard(type);
  });
}
$('start').addEventListener('click', sendPhase);
$('fullscreen').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => toast('Press F11 for fullscreen.', 'info'));
}

addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const n = CARD_ORDER[+e.key - 1];
  if (n && e.key.length === 1) {
    e.preventDefault(); if (e.repeat) return;
    previewCard = n;
    if (lane) cast(n, lane, 'key');
    else { selectCard(n); setHint('Choose an approach first — hover a marker or press <b>Q</b>/<b>E</b>.'); }
  } else if (k === 'q') { e.preventDefault(); cycleLane(-1); }
  else if (k === 'e') { e.preventDefault(); cycleLane(1); }
  else if (k === 'escape') { selectedCard = null; previewCard = null; setLane(null); }
  else if ((k === 'enter' || k === ' ') && state && state.phase !== 'running' && document.activeElement === document.body) { e.preventDefault(); if (!$('start').hidden && !$('start').disabled) sendPhase(); }
});
// No page scroll / zoom gestures leaking to the document (host may handle wheel on #stage).
addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener('contextmenu', e => { if (e.target.closest('#stage, .lane-layer')) e.preventDefault(); });
addEventListener('resize', placeLanes);
document.addEventListener('fullscreenchange', placeLanes);

/* ── Utils ──────────────────────────────────────────────────── */
function maxBudget(s) { return +(s?.maxBudget ?? s?.budgetMax ?? s?.maxSparks ?? 10) || 10; }
function fmtTime(sec) { sec = Math.ceil(sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function fmtCost(c) { return Number.isInteger(+c) ? String(c) : (+c).toFixed(1); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function subName(type, c) { return { skeletons: c.count === 1 ? 'Skeleton' : 'Skeletons', wisps: c.count === 1 ? 'Wisp' : 'Wisps', golem: c.count > 1 ? 'Golems' : 'Golem', gloom: 'Gloom' }[type] + (c.cooldown ? ` · ${c.cooldown}s` : ''); }

/* ── Demo backend (?demo) ───────────────────────────────────── */
function makeDemo() {
  const cards = { skeletons: { name: 'Bone patrol', cost: 3, count: 2, cooldown: 5 }, wisps: { name: 'Wandering lights', cost: 2, count: 2, cooldown: 4 }, golem: { name: 'Stone sentinel', cost: 5, count: 1, cooldown: 9 }, gloom: { name: 'Dusk veil', cost: 4, count: 1, cooldown: 18 } };
  const S = { sessionId: 'demo', phase: 'waiting', round: 1, budget: 6, cards, lanes: LANES, cooldowns: {}, gameConnected: true, pending: [], frameSequence: 0,
    game: { secondsLeft: 150, health: 100, beacons: [{ claimed: false, charge: 0 }, { claimed: false, charge: 0 }, { claimed: false, charge: 0 }], enemies: [], player: { x: 0, z: 8 }, gloom: false } };
  let last = Date.now(), eid = 0;
  if (new URLSearchParams(location.search).get('demo') === 'run') Object.assign(S, { phase: 'running', budget: 3.4, cooldowns: { golem: Date.now() + 5200, wisps: Date.now() + 1400 } });
  const step = () => { const now = Date.now(), dt = (now - last) / 1000; last = now; if (S.phase !== 'running') return; const g = S.game;
    S.budget = Math.min(10, S.budget + dt * .5); g.secondsLeft = Math.max(0, g.secondsLeft - dt);
    g.health = Math.max(0, g.health - dt * g.enemies.length * .25);
    const b = g.beacons.find(b => !b.claimed); if (b) { b.charge += dt * .03; if (b.charge >= 1) b.claimed = true; }
    if (Math.random() < dt * .3) g.enemies.pop();
    if (g.beacons.every(b => b.claimed)) S.phase = 'adventurer_win'; else if (g.secondsLeft <= 0 || g.health <= 0) S.phase = 'director_win'; };
  return {
    async state() { step(); return JSON.parse(JSON.stringify(S)); },
    async command({ type, lane }) { await new Promise(r => setTimeout(r, 120)); step();
      if (type === 'start' || type === 'rematch') { Object.assign(S, { phase: 'running', budget: 6, cooldowns: {}, round: S.round + (type === 'rematch') }); Object.assign(S.game, { secondsLeft: 150, health: 100, enemies: [], beacons: S.game.beacons.map(() => ({ claimed: false, charge: 0 })) }); return { ok: true }; }
      const c = cards[type]; if (S.budget < c.cost) throw Error('Not enough sparks.'); if ((S.cooldowns[type] || 0) > Date.now()) throw Error('That call is still recharging.');
      S.budget -= c.cost; S.cooldowns[type] = Date.now() + c.cooldown * 1000;
      if (type === 'gloom') { S.game.gloom = { active: true, secondsLeft: 12 }; setTimeout(() => S.game.gloom = false, 12000); }
      else for (let i = 0; i < c.count; i++) S.game.enemies.push({ id: ++eid, type, lane, alive: true });
      return { ok: true }; },
    async frame() { await new Promise(r => setTimeout(r, 500)); return new Response(null, { status: 204 }); },
  };
}

setLane(null); syncArmed();
if (DEMO) {
  frameImg.src='/director/demo-frame.jpg';
  frameImg.addEventListener('load',()=>{game.classList.add('has-frame');placeLanes()},{once:true});
}
poll(); if (!DEMO) frameLoop(); requestAnimationFrame(tick);
})();
