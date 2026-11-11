// Labs: features shelved from the focused game stay reachable for testing. ?labs=1 turns Labs on for this browser,
// ?labs=0 turns it off again (the choice is remembered, because joining a room clears the address).
let on = false;
try {
  const q = new URLSearchParams(globalThis.location?.search || '').get('labs');
  if (q !== null) globalThis.localStorage?.setItem('brannLabs', q === '0' ? '0' : '1');
  on = globalThis.localStorage?.getItem('brannLabs') === '1';
} catch { on = /[?&]labs(?!=0)/.test(globalThis.location?.search || ''); }
export const labsOn = () => on;
