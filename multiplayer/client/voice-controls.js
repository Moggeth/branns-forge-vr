// Reuse the existing menu/button styles; keep touch/fullscreen layout ownership separate.
import './voice-controls.css';
export function createVoiceControls({card, getVoice, openMenu = () => {}}) {
  const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'btn btn-chip'; badge.dataset.voiceBadge = ''; badge.hidden = true;
  document.querySelector('.hud-room')?.append(badge);
  badge.addEventListener('click', () => { const v = getVoice(); if (v?.stream) v.stopMicrophone(); else openMenu(); });
  const section = document.createElement('section');
  section.className = 'menu-section voice-controls'; section.dataset.mcPage = 'play'; section.setAttribute('aria-label', 'Proximity voice');
  section.innerHTML = `<h3>Nearby voice</h3>
    <p class="hint">Hear direction and distance within 32 metres. Heroes speak from their head; God speaks and listens at the overview focus. In VR, B/Y returns here for voice controls.</p>
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
    badge.hidden = !s?.active;
    badge.textContent = s?.microphone ? 'Mic on - mute' : s?.deafened ? 'Deafened' : 'Listening';
    badge.setAttribute('aria-label', s?.microphone ? 'Microphone on. Mute microphone' : 'Open voice controls');
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
      row.firstChild.textContent = `${p.name}: ${p.state}, ${p.microphone ? 'mic on' : 'mic off'}`;
      row.lastChild.textContent = `${p.muted ? 'Unmute' : 'Mute'} ${p.name}`; row.lastChild.setAttribute('aria-pressed', String(p.muted));
    }
  }
  update(); return {update, dispose:() => {section.remove();badge.remove();}};
}
