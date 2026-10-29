// Brann's Forge — compact settlement/forge drawer (God + Hero). No framework, no deps.
// Renders only what the root's settlementView provides; every button calls onAction(action, detail).
// Nothing here starts a raid on its own: forgeEncounter needs a second deliberate press.
const KINDS = [['wood', 'Timber'], ['stone', 'Stone'], ['gems', 'Crystal']];
const STAGES = [['gather', 'Gather'], ['improve', 'Improve / Defend'], ['raid', 'Raid'], ['reward', 'Rewards']];
const STAGE_OF = { forgeSupply: 'gather', forgeAssign: 'gather', forgeSummon: 'gather', forgeContribute: 'gather',
  forgeUpgrade: 'improve', forgeDefend: 'improve', forgeRepair: 'improve', forgeEncounter: 'raid' };
const RESERVED = new Set(['action', 'label', 'enabled', 'reason', 'cost', 'cooldown', 'detail']);
const ICON = {
  wood: '<path d="M3 17.5l12-12 3.5 3.5-12 12z"/><circle cx="18.6" cy="5.4" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  stone: '<path d="M4 18l2-7 5-4 6 1 3 6-2 5-8 1z"/>',
  gems: '<path d="M7 3h10l4 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 21l-3-12M12 21l3-12" fill="none" stroke="var(--fs-ink,#17120e)" stroke-width="1.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/>',
  anvil: '<path d="M3 7h14c0 2.5 2 4 4 4v2H15l-1 3h3v3H6v-3h3l-1-3c-3 0-5-2.5-5-6z"/>',
};
const icon = (name, cls = 'fs-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${ICON[name] || ''}</svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = v => v !== undefined && v !== null && v !== '';

function fmtCost(cost) {
  if (!has(cost)) return '';
  if (typeof cost === 'number' || typeof cost === 'string') return String(cost);
  if (typeof cost === 'object') return Object.entries(cost).filter(([, n]) => has(n) && n !== 0).map(([k, n]) => `${n} ${k}`).join(' · ');
  return '';
}
function fmtCooldown(cd) {
  if (!has(cd) || cd === 0) return '';
  return typeof cd === 'number' ? `${cd >= 10 ? Math.ceil(cd) : Math.max(0.1, cd).toFixed(1)}s` : String(cd);
}
function fmtEncounter(enc) {
  if (!has(enc)) return null;
  if (typeof enc !== 'object') return { title: String(enc), lines: [] };
  const title = enc.title ?? enc.label ?? enc.name ?? enc.kind ?? 'Encounter';
  const lines = [];
  for (const key of ['status', 'state', 'phase', 'threat', 'reward', 'rewards', 'result']) {
    const v = enc[key]; if (!has(v)) continue;
    lines.push(`${key[0].toUpperCase()}${key.slice(1)}: ${typeof v === 'object' ? fmtCost(v) : v}`);
  }
  return { title: String(title), lines };
}
/** Extra fields on an action entry become its detail payload (e.g. forgeSupply {kind, amount}). */
export function actionDetail(a) {
  if (a && typeof a.detail === 'object' && a.detail) return { ...a.detail };
  const out = {}; for (const [k, v] of Object.entries(a || {})) if (!RESERVED.has(k)) out[k] = v; return out;
}

/**
 * createForgePanel({mount, onAction, onClose}) → {show, update, hide, dispose, visible(), isOpen}
 *   model = settlementView {title, goal, stock:{wood,stone,gems}, level, defenses,
 *           workers:[{id,job,phase,cargo}], encounter, actions:[{action,label,enabled,reason,cost,cooldown?}]}
 */
export function createForgePanel({ mount = document.body, onAction = () => {}, onClose = () => {} } = {}) {
  const host = document.createElement('div');
  host.className = 'fs-host'; host.hidden = true;
  host.innerHTML = `<div class="fs-scrim" data-fs-close></div>
    <section class="fs-panel" role="dialog" aria-modal="true" aria-labelledby="fs-title-${uid()}" tabindex="-1">
      <header class="fs-head"><span class="fs-crest">${icon('anvil')}</span>
        <div class="fs-headtext"><h2 class="fs-title"></h2><p class="fs-sub"></p></div>
        <button type="button" class="fs-x" data-fs-close aria-label="Close forge (Esc)" title="Close (Esc)">${icon('close')}</button></header>
      <div class="fs-body"></div>
    </section>`;
  const panel = host.querySelector('.fs-panel'), body = host.querySelector('.fs-body');
  const titleEl = host.querySelector('.fs-title'); titleEl.id = panel.getAttribute('aria-labelledby');
  const subEl = host.querySelector('.fs-sub');
  mount.append(host);

  let model = null, shown = false, returnFocus = null, armed = null, armTimer = 0;
  let lastHTML='',pointerHeld=false,pendingRender=false,thawTimer=0;
  function freeze(){clearTimeout(thawTimer);pointerHeld=true;}
  function thaw(){pointerHeld=false;if(pendingRender&&shown){pendingRender=false;render();}}
  function releasePointer(){clearTimeout(thawTimer);thawTimer=setTimeout(thaw,100);}
  function clicked(){clearTimeout(thawTimer);thawTimer=setTimeout(thaw,0);}
  host.addEventListener('pointerdown',freeze);
  host.addEventListener('click',clicked);
  window.addEventListener('pointerup',releasePointer);
  window.addEventListener('pointercancel',thaw);

  function render() {
    if (!model) return;
    if(pointerHeld){pendingRender=true;return;}
    const m = model, stock = m.stock || {}, actions = Array.isArray(m.actions) ? m.actions : [];
    const workers = Array.isArray(m.workers) ? m.workers : [];
    titleEl.textContent = has(m.title) ? m.title : 'Forge';
    subEl.textContent = [has(m.level) ? `Level ${m.level}` : '', has(m.defenses) ? `Defences ${m.defenses}` : ''].filter(Boolean).join(' · ');
    const nextIdx = actions.findIndex(a => a && a.enabled);
    const next = actions[nextIdx];
    const stage = next ? STAGE_OF[next.action] : null;
    const assign = actions.find(a => a?.action === 'forgeAssign');
    const assignBlocked = assign && !assign.enabled;
    const enc = fmtEncounter(m.encounter);

    const html = [];
    // goal + next step
    html.push(`<div class="fs-goal">${has(m.goal) ? `<p class="fs-goal-text"><span class="fs-k">Goal</span> ${esc(m.goal)}</p>` : ''}
      <p class="fs-next" aria-live="polite">${next ? `<span class="fs-k">Next</span> ${esc(next.label || next.action)}${fmtCost(next.cost) ? ` <span class="fs-cost">${esc(fmtCost(next.cost))}</span>` : ''}`
        : actions.length ? '<span class="fs-k">Next</span> Nothing affordable yet — see reasons below.' : ''}</p>
      <ol class="fs-loop" aria-label="Forge loop">${STAGES.map(([k, l]) => `<li class="${k === stage ? 'fs-on' : ''}"${k === stage ? ' aria-current="step"' : ''}>${l}</li>`).join('')}</ol></div>`);
    // stock
    html.push(`<dl class="fs-stock">${KINDS.map(([k, l]) => `<div class="fs-res fs-${k}">${icon(k)}<dt>${l}</dt><dd>${has(stock[k]) ? esc(stock[k]) : '—'}</dd></div>`).join('')}</dl>`);
    // actions
    if (actions.length) {
      html.push('<div class="fs-actions" role="group" aria-label="Forge actions">');
      actions.forEach((a, i) => {
        if (!a?.action || a.action==='forgeAssign') return;
        const cost = fmtCost(a.cost), cd = fmtCooldown(a.cooldown), isArmed = armed === i;
        const raid = a.action === 'forgeEncounter';
        const label = isArmed ? `Confirm: ${a.label || a.action}` : (a.label || a.action);
        const why = !a.enabled && has(a.reason) ? `<span class="fs-why" id="fs-why-${i}">${esc(a.reason)}</span>` : '';
        html.push(`<button type="button" class="fs-act${i === nextIdx ? ' fs-next-act' : ''}${raid ? ' fs-raid' : ''}${isArmed ? ' fs-armed' : ''}"
          data-fs-key="act-${i}" data-fs-act="${i}" aria-disabled="${a.enabled ? 'false' : 'true'}"${why ? ` aria-describedby="fs-why-${i}"` : ''}>
          <span class="fs-act-label">${esc(label)}</span>
          <span class="fs-act-meta">${cost ? `<span class="fs-cost">${esc(cost)}</span>` : ''}${cd ? `<span class="fs-cd">${esc(cd)}</span>` : ''}</span>
          ${why}</button>`);
      });
      html.push('</div>');
    }
    // workers
    if (workers.length) {
      html.push(`<section class="fs-workers" aria-label="Workers"><h3 class="fs-h3">Workers <span class="fs-count">${workers.length}</span></h3>
        ${assignBlocked && has(assign.reason) ? `<p class="fs-why fs-why-block">${esc(assign.reason)}</p>` : ''}<ul class="fs-wlist">`);
      for (const w of workers) {
        const wid = esc(w.id);
        html.push(`<li class="fs-worker"><div class="fs-wmeta"><b class="fs-wname">${wid}</b>
          <span class="fs-wphase">${esc(w.phase ?? '')}${has(w.cargo) && w.cargo !== 0 ? ` · carrying ${esc(typeof w.cargo === 'object' ? fmtCost(w.cargo) : w.cargo)}` : ''}</span></div>
          <div class="fs-seg" role="radiogroup" aria-label="Job for ${wid}">${KINDS.map(([k, l]) => {
            const on = w.job === k;
            return `<button type="button" role="radio" class="fs-segbtn fs-${k}" aria-checked="${on}" data-fs-key="w-${wid}-${k}" data-fs-worker="${wid}" data-fs-kind="${k}"
              ${assignBlocked ? 'aria-disabled="true"' : ''} title="${l}">${icon(k)}<span>${l}</span></button>`;
          }).join('')}</div></li>`);
      }
      html.push('</ul></section>');
    }
    // encounter
    if (enc) html.push(`<section class="fs-enc">${icon('shield')}<div><b>${esc(enc.title)}</b>${enc.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`);
    if (!actions.length && !workers.length) html.push('<p class="fs-empty">No forge actions are available right now.</p>');

    const nextHTML=html.join('');if(nextHTML===lastHTML)return;lastHTML=nextHTML;
    const focusKey = host.contains(document.activeElement) ? document.activeElement?.dataset?.fsKey : null;
    const scroll = body.scrollTop;
    body.innerHTML = nextHTML;
    body.scrollTop = scroll;
    if (focusKey) body.querySelector(`[data-fs-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  function disarm() { armed = null; clearTimeout(armTimer); }
  function onClick(e) {
    if (e.target.closest('[data-fs-close]')) { e.preventDefault(); close(); return; }
    const seg = e.target.closest('[data-fs-worker]');
    if (seg) {
      if (seg.getAttribute('aria-disabled') === 'true' || seg.getAttribute('aria-checked') === 'true') return;
      const w = (model?.workers || []).find(x => String(x.id) === seg.dataset.fsWorker);
      onAction('forgeAssign', { workerId: w ? w.id : seg.dataset.fsWorker, kind: seg.dataset.fsKind });
      return;
    }
    const btn = e.target.closest('[data-fs-act]'); if (!btn) return;
    const i = Number(btn.dataset.fsAct), a = model?.actions?.[i];
    if (!a || !a.enabled) { btn.classList.remove('fs-shake'); void btn.offsetWidth; btn.classList.add('fs-shake'); return; }
    if (a.action === 'forgeEncounter' && armed !== i) {   // deliberate two-step raid start
      armed = i; clearTimeout(armTimer); armTimer = setTimeout(() => { disarm(); render(); }, 3500); render(); return;
    }
    disarm(); onAction(a.action, actionDetail(a));
  }
  function onKey(e) {
    if (!shown) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    // stop game hotkeys while the drawer has focus; arrow keys move within a worker's job selector
    if (panel.contains(document.activeElement)) {
      const seg = document.activeElement.closest?.('.fs-seg');
      if (seg && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const btns = [...seg.querySelectorAll('button')], i = btns.indexOf(document.activeElement);
        btns[(i + (e.key === 'ArrowLeft' ? btns.length - 1 : 1)) % btns.length].focus(); e.preventDefault();
      }
      e.stopPropagation();
    }
  }
  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);

  function show(next) {
    if (next) model = next;
    if (!shown) { returnFocus = document.activeElement; shown = true; host.hidden = false; host.classList.add('fs-open'); }
    render();
    const target = body.querySelector('.fs-next-act') || panel.querySelector('.fs-x');
    requestAnimationFrame(() => { if (shown && !panel.contains(document.activeElement)) (target || panel).focus({ preventScroll: true }); });
  }
  function update(next) { if (next) model = next; if (armed != null && !model?.actions?.[armed]?.enabled) disarm(); if (shown) render(); }
  function hide() {
    if (!shown) return; shown = false; disarm();
    clearTimeout(thawTimer);pointerHeld=false;pendingRender=false;lastHTML='';
    host.classList.remove('fs-open'); host.hidden = true;
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function close() { hide(); onClose(); }
  function dispose() { hide();host.removeEventListener('pointerdown',freeze);host.removeEventListener('click',clicked);window.removeEventListener('pointerup',releasePointer);window.removeEventListener('pointercancel',thaw);host.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); host.remove(); model = null; }
  return { show, update, hide, dispose, visible: () => shown, get isOpen() { return shown; } };
}
let uidN = 0; function uid() { return (++uidN).toString(36); }
