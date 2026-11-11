// The Warband button: how many Forgelings you command, and the one-tap way to command them.
// God view: tap to take command (every Forgeling is selected and the next tap on the land is an order); tap again to let go.
// Hero view: tap to call them back to your side. Hidden until the first Muster. Presentation only: the game owns state.
import {WARBAND} from '../shared/warband.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2.5 13.2h13.2c0 2.2-1.7 3.6-3.8 3.8l1.5 3.2h1.7V22H5.4v-1.8h1.7l1.5-3.2C5 16.6 2.5 15.4 2.5 13.2zM16.2 13.2h5.3l-1.3 2.4h-4.1z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M5.5 1.8v7.6M10 1v8.4M14.5 1.8v7.6" opacity=".85"/></svg>';

export function createWarbandHud({mount, onPress}) {
 const button = document.createElement('button');
 button.type = 'button'; button.id = 'warbandButton'; button.className = 'bf-warband'; button.hidden = true;
 button.innerHTML = `<span class="bf-warband-icon">${ICON}</span><span class="bf-warband-text"><span class="bf-warband-name">Warband</span><span class="bf-warband-count"></span></span><kbd>G</kbd>`;
 const count = button.querySelector('.bf-warband-count'), name = button.querySelector('.bf-warband-name');
 button.addEventListener('click', event => { event.preventDefault(); onPress(); button.blur(); });
 mount.append(button);
 let last = '';
 return {
  element: button,
  /** n: living Forgelings; role: 'god' | 'hero'; commanding: God view command mode is on; hurt: any below half health. */
  update({n, role, commanding, hurt}) {
   const key = `${n}|${role}|${commanding}|${hurt}`; if (key === last) return; last = key;
   button.hidden = n <= 0;
   count.textContent = `${n}/${WARBAND.perOwner}`;
   name.textContent = role === 'god' ? (commanding ? 'Commanding' : 'Warband') : 'Rally';
   button.dataset.role = role; button.setAttribute('aria-pressed', role === 'god' && commanding ? 'true' : 'false');
   button.classList.toggle('bf-warband-hurt', !!hurt);
   button.title = role === 'god'
    ? (commanding ? 'Commanding your Forgelings: tap or right-click the land to march, an enemy to attack. Tap here or press Esc to stop. (G)' : 'Take command of your Forgelings (G)')
    : 'Call your Forgelings back to your side';
   button.setAttribute('aria-label', button.title);
  },
  dispose() { button.remove(); },
 };
}
