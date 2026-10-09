// The orientation dialog must work before the simulation/Three.js dependency
// graph downloads or evaluates. Keep this entry small and independently usable.
import {mountTurnPhone} from './client/turn-phone.js';
import {afterPaint} from './client/startup-work.js';
mountTurnPhone();
await afterPaint();
try { await import('./lobby.js'); }
catch (error) {
  console.error('Game startup failed', error);
  const message = document.createElement('p');
  message.setAttribute('role','alert');
  message.textContent = 'The game could not finish loading. Check your connection and refresh to retry.';
  document.querySelector('#lobby')?.append(message);
}
