// Loading screen tips: while the lobby status panel is busy (opening a world), a short tip rotates under the
// progress bar. View only; lobby.js still owns the panel, its text and its buttons.
const TIPS = [
  'Press F9, or tap Hero / God on your hotbar, to switch views at any time.',
  'Three cuts in the same notch fells a tree. Chop anywhere you like.',
  'Your world saves itself as you play. Play picks up where you left off.',
  'Same seed, same land: share a seed and a friend can walk your world.',
  'Danger grows the further you roam from the village.',
  'Apples restore health. Shake a tree, or pick them off the grass.',
  'Step up to a Timberline and press E to man it. Hold R to wind it faster.',
  'Hold attack to draw Emberwing, then let go to loose.',
  'Press I to admire your weapon up close.',
  'A God’s blessing lands on Heroes too. So does a careless lightning bolt.',
];

export function startLoadingTips({panel = document.getElementById('lobbyStatus'), tip = document.getElementById('lobbyTip'), every = 4800} = {}) {
  if (!panel || !tip) return null;
  let timer = 0, index = Math.floor(Math.random() * TIPS.length);
  const show = () => { index = (index + 1) % TIPS.length; tip.textContent = TIPS[index]; tip.classList.remove('tip-in'); void tip.offsetWidth; tip.classList.add('tip-in'); };
  const sync = () => {
    const busy = !panel.hidden && panel.classList.contains('busy');
    if (busy && !timer) { show(); timer = setInterval(show, every); }
    else if (!busy && timer) { clearInterval(timer); timer = 0; tip.textContent = ''; }
  };
  const observer = new MutationObserver(sync);
  observer.observe(panel, {attributes: true, attributeFilter: ['class', 'hidden']});
  sync();
  return {dispose() { observer.disconnect(); clearInterval(timer); }};
}
