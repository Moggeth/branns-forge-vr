// Brann's Forge — mobile touch HUD (view layer only).
// Builds DOM; owns no input handling, timers or animation frames.
// Codex owns pointer identity/capture, gameplay mapping, Fullscreen API and cleanup.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Original 24×24 stroke icons; currentColor so CSS controls tint.
const ICONS = {
  strike: '<path d="M19.5 4.5l-.7 3.4-8.4 8.4-2.7-2.7 8.4-8.4z"/><path d="M6.2 12.4l5.4 5.4M4.5 19.5l3.2-3.2"/>',
  jump: '<path d="M12 15V5"/><path d="M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19c2.2-1.6 4.5-2.4 7-2.4s4.8.8 7 2.4"/>',
  cast: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8.5l1.1 2.4 2.4 1.1-2.4 1.1L12 15.5l-1.1-2.4L8.5 12l2.4-1.1z"/><path d="M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6" opacity=".55"/>',
  cancel: '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
  'zoom-in': '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>',
  'zoom-out': '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>',
  center: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="10.2" r="1.6"/><path d="M9.4 15.2c.6-1.4 1.5-2.1 2.6-2.1s2 .7 2.6 2.1"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  'fullscreen-exit': '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('mui-icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function actionButton(action, label, { cls = '', iconName = action, showLabel = true } = {}) {
  const labelNode = el('span', { class: 'mui-btn-label', text: label });
  const button = el('button', {
    type: 'button',
    class: `mui-btn ${cls}`.trim(),
    'aria-label': label,
    dataset: { touchAction: action },
  }, [icon(iconName), showLabel ? labelNode : null]);
  button._label = labelNode;
  return button;
}

function stick(side, label) {
  const knob = el('div', { class: 'mui-knob', 'aria-hidden': 'true' });
  const node = el('div', {
    class: `mui-stick mui-stick-${side}`,
    role: 'group',
    'aria-label': label,
    dataset: { stick: side },
  }, [
    el('div', { class: 'mui-stick-ring', 'aria-hidden': 'true' }, [
      el('span', { class: 'mui-stick-tick t-n' }),
      el('span', { class: 'mui-stick-tick t-e' }),
      el('span', { class: 'mui-stick-tick t-s' }),
      el('span', { class: 'mui-stick-tick t-w' }),
    ]),
    knob,
    el('span', { class: 'mui-stick-caption', 'aria-hidden': 'true' }),
  ]);
  node._knob = knob;
  node._caption = node.lastChild;
  return node;
}

function guideRows(rows) {
  const dl = el('dl', { class: 'mui-guide-list' });
  for (const [input, effect] of rows) dl.append(el('dt', { text: input }), el('dd', { text: effect }));
  return dl;
}

function guideBlock(title, rows) {
  return el('div', { class: 'mui-guide-block' }, [el('h4', { text: title }), guideRows(rows)]);
}

function buildSettings() {
  const fsButton = el('button', {
    type: 'button',
    class: 'btn btn-secondary mui-fs-setting',
    'aria-pressed': 'false',
    dataset: { touchAction: 'fullscreen' },
  }, [icon('fullscreen'), el('span', { class: 'mui-btn-label', text: 'Full screen' })]);
  const fsNote = el('p', { class: 'hint mui-fs-note', hidden: true });

  const sensOut = el('output', { class: 'mui-sens-value', for: 'touchSensitivity', text: '1.0×' });

  const section = el('section', { id: 'touchSettings', class: 'menu-section mui-settings', 'aria-labelledby': 'touchSettingsTitle' }, [
    el('h3', { id: 'touchSettingsTitle', text: 'Display & controls' }),
    el('div', { class: 'mui-setting-row mui-fs-row' }, [fsButton]),
    fsNote,
    el('div', { class: 'mui-setting-row' }, [
      el('label', { for: 'touchMode', text: 'Touch controls' }),
      el('select', { id: 'touchMode', name: 'touchMode', class: 'mui-select' }, [
        el('option', { value: 'auto', text: 'Automatic', selected: true }),
        el('option', { value: 'on', text: 'Always on' }),
        el('option', { value: 'off', text: 'Off' }),
      ]),
    ]),
    el('div', { class: 'mui-setting-row' }, [
      el('label', { for: 'touchSensitivity', text: 'Look sensitivity' }),
      el('div', { class: 'mui-range-wrap' }, [
        el('input', { id: 'touchSensitivity', name: 'touchSensitivity', type: 'range', min: '0.5', max: '2', step: '0.1', value: '1' }),
        sensOut,
      ]),
    ]),
    el('label', { class: 'mui-setting-row mui-check', for: 'touchLeftHanded' }, [
      el('span', { text: 'Left-handed (swap sticks)' }),
      el('input', { id: 'touchLeftHanded', name: 'touchLeftHanded', type: 'checkbox' }),
    ]),
    el('details', { class: 'mui-guide' }, [
      el('summary', { text: 'Controls guide' }),
      el('div', { class: 'mui-guide-body' }, [
        guideBlock('Hero · touch', [
          ['Left stick', 'Move'],
          ['Right stick', 'Look (or drag the world)'],
          ['Attack', 'Swing; impact occurs at the visible contact phase'],
          ['Axe / Pick buttons', 'Choose the harvesting tool'],
          ['Collect / Eat', 'Pick up nearby loot or heal with an apple'],
          ['Bridge', 'Spend 3 wood to build ahead'],
          ['Jump', 'Jump'],
        ]),
        guideBlock('God · touch', [
          ['Left stick', 'Pan'],
          ['Right stick', 'Orbit and tilt'],
          ['＋ / − or pinch', 'Zoom'],
          ['Tap the world', 'Aim at that spot (does not cast)'],
          ['Cast', 'Cast at aim; for a line, confirm the start and then the end'],
          ['Cancel', 'Return to centre aim'],
          ['Spell drawer', 'Choose one of fourteen spells'],
          ['Centre', 'Centre on your hero'],
        ]),
        guideBlock('Hero · desktop', [
          ['WASD / arrows', 'Move'],
          ['Mouse / click', 'Look / swing / shoot; hold and release to draw bow'],
          ['1–6', 'Choose weapon'], ['Q / right mouse', 'Special; while drawing bow, lock curve origin then aim'], ['F / G / X', 'Grab / drop / throw'], ['E / B', 'Collect or eat / build bridge'],
          ['Space', 'Jump'],
          ['Esc', 'Release the cursor'],
        ]),
        guideBlock('God · desktop', [
          ['WASD', 'Pan'],
          ['Right-drag', 'Orbit and tilt'],
          ['Wheel', 'Zoom'],
          ['1–9, 0, −, =, backtick, T', 'Choose spell (quick-cast toggle available)'],
          ['Click', 'Cast'],
        ]),
        guideBlock('Hero · VR', [
          ['Left stick', 'Move'],
          ['Swing melee weapon', 'Tip collision strikes the target'],
          ['Right trigger', 'Shoot crossbow; hold bow arrow, physically draw, release; throw a held bone'], ['Left trigger while bow drawn', 'Lock initial direction; move bow to set curve'], ['Trigger with melee weapon', 'Weapon special'],
          ['Primary face button (A/X)', 'Jump'],
          ['Left squeeze', 'Cycle five weapons'],
          ['Right squeeze', 'Grab or drop a bone; otherwise collect / eat'],
          ['Right stick click', 'Build bridge (3 wood)'],
          ['Secondary face button (B/Y)', 'Exit VR and open Menu'],
        ]),
        guideBlock('Menu', [
          ['In a world', 'Switch role, copy code or invite, download a backup, reset (host, with confirmation), leave'],
          ['Lobby', 'Import or resume a save, create or join a world'],
        ]),
        el('p', { class: 'hint mui-guide-note', text: 'Browser preview: basic movement, swings and spells only — no weapon inventory from the full game.' }),
      ]),
    ]),
  ]);
  section._fsButton = fsButton;
  section._fsNote = fsNote;
  section._sensOut = sensOut;
  return section;
}

function mountSettings(settings) {
  const host = document.getElementById('menuPanel') || document.querySelector('#menu .menu-card');
  if (!host) return false;
  const before = host.querySelector('#techDetails') || host.querySelector('#leave');
  if (before && before.parentNode === host) host.insertBefore(settings, before);
  else host.append(settings);
  return true;
}

export function createMobileUI({ mount = true } = {}) {
  const leftStick = stick('left', 'Move stick');
  const rightStick = stick('right', 'Look stick');

  const strike = actionButton('strike', 'Attack', { cls: 'mui-primary mui-hero-only' });
  const jump = actionButton('jump', 'Jump', { cls: 'mui-secondary mui-hero-only' });
  const cast = actionButton('cast', 'Cast', { cls: 'mui-primary mui-god-only' });
  const cancel = actionButton('cancel', 'Cancel aim', { cls: 'mui-secondary mui-god-only' });
  cancel._label.textContent = 'Cancel';

  const menuBtn = actionButton('menu', 'Menu', { cls: 'mui-util', showLabel: false });
  menuBtn.setAttribute('aria-haspopup', 'dialog');
  const fsBtn = actionButton('fullscreen', 'Full screen', { cls: 'mui-util mui-fs', showLabel: false });
  fsBtn.setAttribute('aria-pressed', 'false');
  const zoomIn = actionButton('zoom-in', 'Zoom in', { cls: 'mui-util mui-god-only', showLabel: false });
  const zoomOut = actionButton('zoom-out', 'Zoom out', { cls: 'mui-util mui-god-only', showLabel: false });
  const center = actionButton('center', 'Centre on hero', { cls: 'mui-util mui-god-only', showLabel: false });

  const reticleLabel = el('span', { class: 'mui-reticle-label', 'aria-live': 'polite' });
  const reticle = el('div', { class: 'mui-reticle', 'aria-hidden': 'false' }, [
    el('span', { class: 'mui-reticle-ring', 'aria-hidden': 'true' }),
    el('span', { class: 'mui-reticle-dot', 'aria-hidden': 'true' }),
    reticleLabel,
  ]);

  const root = el('div', {
    id: 'touchControls',
    class: 'mui-root',
    hidden: true,
    dataset: { role: 'hero', targeting: 'false', leftHanded: 'false' },
  }, [
    reticle,
    el('div', { class: 'mui-util-bar', role: 'toolbar', 'aria-label': 'View' }, [menuBtn, fsBtn, zoomIn, zoomOut, center]),
    leftStick,
    rightStick,
    el('div', { class: 'mui-actions', role: 'toolbar', 'aria-label': 'Actions' }, [jump, strike, cancel, cast]),
  ]);

  const settings = buildSettings();
  const sens = settings.querySelector('#touchSensitivity');
  const onSens = () => { settings._sensOut.textContent = `${Number(sens.value).toFixed(1)}×`; };
  sens.addEventListener('input', onSens); // display-only echo of the slider value

  if (mount) {
    document.body.append(root);
    mountSettings(settings);
  }

  const state = { visible: false, role: 'hero', fullscreen: false, fullscreenSupported: true, standalone: false, targeting: false, leftHanded: false };

  function render() {
    const { visible, role, fullscreen, fullscreenSupported, standalone, targeting, leftHanded } = state;
    const god = role === 'god';
    root.hidden = !visible;
    root.dataset.role = god ? 'god' : 'hero';
    root.dataset.targeting = String(!!(god && targeting));
    root.dataset.leftHanded = String(!!leftHanded);
    document.body.classList.toggle('touch-controls-active', !!visible);

    leftStick.setAttribute('aria-label', god ? 'Pan stick' : 'Move stick');
    rightStick.setAttribute('aria-label', god ? 'Orbit stick' : 'Look stick');
    leftStick._caption.textContent = god ? 'Pan' : 'Move';
    rightStick._caption.textContent = god ? 'Orbit' : 'Look';

    cast._label.textContent = god && targeting ? 'Cast here' : 'Cast';
    cast.setAttribute('aria-label', god && targeting ? 'Cast at target' : 'Cast at centre aim');
    cancel.disabled = !(god && targeting);
    reticleLabel.textContent = god && targeting ? 'Target set' : '';

    for (const btn of [fsBtn, settings._fsButton]) {
      btn.setAttribute('aria-pressed', String(!!fullscreen));
      const label = fullscreen ? 'Exit full screen' : 'Full screen';
      btn.setAttribute('aria-label', label);
      btn.querySelector('.mui-icon').innerHTML = ICONS[fullscreen ? 'fullscreen-exit' : 'fullscreen'];
      const text = btn.querySelector('.mui-btn-label');
      if (text) text.textContent = label;
    }
    fsBtn.hidden = !fullscreenSupported;
    settings._fsButton.hidden = !fullscreenSupported;
    const note = settings._fsNote;
    if (standalone) {
      note.hidden = false;
      note.textContent = 'Running as an installed app — the browser bars are already hidden.';
    } else if (!fullscreenSupported) {
      note.hidden = false;
      note.textContent = 'Full screen isn’t available in this browser. Add to Home Screen opens an app-like display on supported devices.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }

  function setState(next = {}) {
    for (const key of Object.keys(state)) if (key in next) state[key] = next[key];
    render();
  }

  function setStick(side, x = 0, y = 0) {
    const node = side === 'right' ? rightStick : side === 'left' ? leftStick : null;
    if (!node) return;
    let nx = Number.isFinite(x) ? x : 0;
    let ny = Number.isFinite(y) ? y : 0;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    node.style.setProperty('--kx', nx.toFixed(3));
    node.style.setProperty('--ky', ny.toFixed(3));
    node.classList.toggle('is-active', len > 0.02);
  }

  function destroy() {
    sens.removeEventListener('input', onSens);
    root.remove();
    settings.remove();
    document.body.classList.remove('touch-controls-active');
  }

  render();
  return {
    root, leftStick, rightStick, settings, setState, setStick, destroy,
    buttons: { strike, jump, cast, cancel, menu: menuBtn, fullscreen: fsBtn, zoomIn, zoomOut, center },
  };
}
