// Reuse the existing menu/button styles; keep touch/fullscreen layout ownership separate.
import './voice-controls.css';
import {INVITING} from './voice-zones.js';
const MIC = '<svg class="voice-mic-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="11.5" rx="3.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/><path class="voice-slash" d="M4 4l16 16"/></svg>';
export function createVoiceControls({card, getVoice, openMenu = () => {}}) {
  // One-tap voice: Join voice -> Mic off (tap to talk) -> Mic on (tap to mute).
  // Lives in the HUD chip row on desktop and floats above the touch controls on phones.
  const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'btn btn-chip voice-quick'; badge.dataset.voiceBadge = ''; badge.hidden = true;
  badge.innerHTML = `${MIC}<span class="voice-quick-label"></span><span class="voice-quick-count"></span>`;
  const menuChip = document.querySelector('.hud-room #menuButton');
  if (menuChip) menuChip.before(badge); else document.querySelector('.hud-room')?.append(badge);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'voice-fab'; fab.dataset.voiceFab = ''; fab.hidden = true; fab.innerHTML = MIC;
  const hud = document.getElementById('hud') || document.body; hud.append(fab); // inside the HUD: hidden/inert with it while menus are open
  const invite = document.createElement('div'); invite.className = 'voice-invite'; invite.hidden = true; invite.setAttribute('role', 'status');
  invite.innerHTML = '<span></span><button type="button" class="btn btn-secondary" data-voice-invite>Join voice</button>';
  hud.append(invite);
  let invitedZone = null, inviteTimer = 0;
  const quick = () => {
    const v = getVoice(); if (!v) return;
    const s = v.state();
    if (!s.active) void v.join(); else if (s.deafened) openMenu(); else if (s.microphone || s.pending) v.stopMicrophone(); else void v.enableMicrophone();
  };
  badge.addEventListener('click', quick); fab.addEventListener('click', quick);
  invite.querySelector('button').addEventListener('click', () => { quick(); invite.hidden = true; });
  const section = document.createElement('section');
  section.className = 'menu-section voice-controls'; section.dataset.mcPage = 'play'; section.setAttribute('aria-label', 'Proximity voice');
  section.innerHTML = `<h3>Nearby voice</h3>
    <p class="hint">Hear direction and distance within 32 metres; inside a tavern everyone in the room hears each other clearly. A glowing speech badge floats over whoever is talking. Heroes speak from their head; God speaks and listens at the overview focus. In VR, B/Y returns here for voice controls.</p>
    <p class="hint">Joining only listens. Enable your microphone separately. Voice goes to room participants; distance is a playback effect, not a privacy boundary. The game does not record voice.</p>
    <div class="voice-actions"><button type="button" class="btn btn-secondary" data-voice="join">Join voice (listen only)</button>
    <button type="button" class="btn btn-secondary" data-voice="mic">Enable microphone</button>
    <button type="button" class="btn btn-secondary" data-voice="deafen">Deafen</button>
    <button type="button" class="btn btn-secondary" data-voice="retry">Retry voice / audio</button></div>
    <p class="hint" data-voice-status role="status" aria-live="polite"></p><div data-voice-peers></div>`;
  (card.querySelector('#menuCopyCode')?.closest('.menu-section') || card.querySelector('.menu-head')).after(section);
  const button = name => section.querySelector(`[data-voice="${name}"]`);
  section.addEventListener('click', event => {
    const action = event.target.closest('[data-voice]')?.dataset.voice, v = getVoice(); if (!v) return;
    if (action === 'join') { if (v.active) v.leave(); else void v.join(); }
    if (action === 'mic') { if (v.stream || v.pending) v.stopMicrophone(); else void v.enableMicrophone(); }
    if (action === 'deafen') v.deafen(!v.state().deafened);
    if (action === 'retry') void v.retry();
  });
  function update() {
    const v = getVoice(), s = v?.state();
    const mode = !s ? 'none' : !s.active ? 'off' : s.deafened ? 'deafened' : s.microphone ? 'live' : s.pending ? 'pending' : 'muted';
    const label = {off:'Join voice', deafened:'Deafened', live:'Mic on', pending:'Mic…', muted:'Mic off'}[mode] || '';
    const aria = {off:'Join nearby voice (listen only)', deafened:'Voice deafened. Open voice controls', live:'Microphone on. Tap to mute', pending:'Waiting for microphone permission. Tap to cancel', muted:'Microphone off. Tap to talk'}[mode] || '';
    const voices = s?.peers.filter(p => p.state === 'connected').length || 0;
    for (const el of [badge, fab]) {
      el.hidden = mode === 'none'; el.dataset.mode = mode;
      el.classList.toggle('is-speaking', !!s?.speaking); el.setAttribute('aria-label', aria); el.title = aria;
      el.setAttribute('aria-pressed', String(mode === 'live'));
    }
    badge.querySelector('.voice-quick-label').textContent = label;
    badge.querySelector('.voice-quick-count').textContent = voices ? String(voices) : '';
    fab.dataset.count = voices ? String(voices) : '';
    // Taverns: invite once per visit; disappears on leaving or after a while.
    const zone = s?.zone && INVITING.has(s.zone.kind) ? s.zone : null;
    if (zone?.id !== invitedZone) {
      invitedZone = zone?.id ?? null; clearTimeout(inviteTimer);
      const ask = zone && mode !== 'live' && mode !== 'deafened';
      if (ask) {
        invite.firstChild.textContent = `${zone.label}: take a breather. Voice is welcome in here.`;
        invite.lastChild.textContent = mode === 'off' ? 'Join voice' : 'Turn mic on';
        inviteTimer = setTimeout(() => { invite.hidden = true; }, 9000);
      }
      invite.hidden = !ask;
    } else if (!invite.hidden && (mode === 'live' || !zone)) invite.hidden = true;
    button('join').disabled = !v;
    button('join').textContent = s?.active ? 'Leave voice' : 'Join voice (listen only)';
    button('mic').disabled = !s?.active || s.deafened;
    button('mic').textContent = s?.pending ? 'Cancel microphone request' : s?.microphone ? 'Mute microphone' : 'Enable microphone';
    button('mic').setAttribute('aria-pressed', String(!!s?.microphone));
    button('deafen').disabled = !s?.active; button('deafen').textContent = s?.deafened ? 'Listen again (mic stays off)' : 'Deafen';
    button('deafen').setAttribute('aria-pressed', String(!!s?.deafened)); button('retry').disabled = !s?.active;
    const status = !v ? 'Voice is available in multiplayer worlds on browsers with WebRTC and Web Audio.' :
      `${s.active ? s.deafened ? 'Deafened; microphone off.' : s.microphone ? 'Microphone ON.' : 'Listening; microphone off.' : 'Voice off.'} ${s.message}${s.active && s.audioState !== 'running' ? ' Audio is paused; press Retry voice / audio.' : ''}`;
    const statusElement = section.querySelector('[data-voice-status]'); if (statusElement.textContent !== status) statusElement.textContent = status;
    const peers = section.querySelector('[data-voice-peers]');
    // Keep focused buttons stable across presence/mic updates.
    for (const row of [...peers.children]) if (!s?.peers.some(p => p.id === row.dataset.peer)) row.remove();
    for (const p of s?.peers || []) {
      let row = [...peers.children].find(r => r.dataset.peer === p.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'voice-peer-line'; row.dataset.peer = p.id;
        const label = document.createElement('span'), mute = document.createElement('button'); mute.className = 'btn btn-secondary'; mute.type = 'button';
        mute.addEventListener('click', () => { const voice = getVoice(); if (voice) voice.mute(p.id, !voice.muted.has(p.id)); });
        row.append(label, mute); peers.append(row);
      }
      row.firstChild.textContent = `${p.speaking ? '🔊 ' : ''}${p.name}: ${p.state}, ${p.speaking ? 'talking' : p.microphone ? 'mic on' : 'mic off'}`;
      row.lastChild.textContent = `${p.muted ? 'Unmute' : 'Mute'} ${p.name}`; row.lastChild.setAttribute('aria-pressed', String(p.muted));
    }
  }
  update(); return {update, dispose:() => {clearTimeout(inviteTimer);section.remove();badge.remove();fab.remove();invite.remove();}};
}
