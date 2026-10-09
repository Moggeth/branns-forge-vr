// Sound pass cue kit (procedural Web Audio, no files). Fills the moments that used to fall through to a single sine
// "blip" or played nothing at all: enemy deaths, pickups, building, UI clicks, weapon swaps, footfalls, home-base
// alarms and more. Each cue is a few layered voices (noise through a filter, a pitched body, a sparkle on top), short,
// and placed with the mix's shared distance + pan curve so a crowded fight stays readable instead of noisy.
//
//   const kit = createSoundKit({context, level: mix.level, claim: mix.claim, duck: mix.duck});
//   kit.play('pickup', position, ear, {material: 'iron'});   // ear = listener pose; omit position for "in my hands"
//
// Tone rules (memory): goofy, charming and optimistic; magic rings blue and glassy; earth cracks like a geode.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const semis = (f, n) => f * 2 ** (n / 12);

export function createSoundKit({context, level = () => ({gain: 1, pan: 0}), claim = () => true, duck = () => {}, ui = null} = {}) {
  if (!context?.createOscillator) return {play() {}, has: () => false, stats: () => ({}), dispose() {}};
  const out = context.createGain(); out.gain.value = 1; out.connect(context.destination);
  const uiOut = ui ? (() => { const g = ui.createGain(); g.gain.value = 1; g.connect(ui.destination); return g; })() : out;
  const n = context.sampleRate * 1.5 | 0, noiseBuf = context.createBuffer(1, n, context.sampleRate), d = noiseBuf.getChannelData(0);
  let s = 77777; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = ((s >>> 9) / 4194304) - 1; }
  const stats = {played: 0, culled: 0, quiet: 0}, last = new Map();

  // ---- voices ------------------------------------------------------------------------------------------------------
  const env = (g, t, attack, peak, release, hold = 0) => { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + attack); if (hold) g.gain.setValueAtTime(Math.max(.0002, peak), t + attack + hold); g.gain.exponentialRampToValueAtTime(.0001, t + attack + hold + release); return t + attack + hold + release + .03; };
  function noise(dest, t, {type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = .005, peak = .1, release = .2, hold = 0, rate = 1} = {}) {
    const src = context.createBufferSource(), f = context.createBiquadFilter(), g = context.createGain();
    src.buffer = noiseBuf; src.playbackRate.value = rate; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + hold + release);
    src.connect(f).connect(g).connect(dest); const end = env(g, t, attack, peak, release, hold); src.start(t, Math.random() * 1.2); src.stop(end);
  }
  function tone(dest, t, {type = 'sine', f0 = 440, f1 = f0, attack = .005, peak = .05, release = .3, hold = 0, detune = 0} = {}) {
    const o = context.createOscillator(), g = context.createGain(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + hold + release);
    o.connect(g).connect(dest); const end = env(g, t, attack, peak, release, hold); o.start(t); o.stop(end);
  }
  // Glassy bell: slightly inharmonic partials, upper ones fading first (the game's "blue resonance" voice).
  function bell(dest, t, f, peak = .04, decay = 1) { for (const [r, a] of [[1, 1], [2.01, .45], [2.76, .3], [5.4, .12]]) tone(dest, t, {f0: f * r, peak: peak * a, attack: .003, release: decay / (1 + r * .35)}); }
  const thump = (dest, t, f0 = 120, f1 = 45, peak = .2, release = .2) => tone(dest, t, {f0, f1, peak, attack: .003, release});
  function rattle(dest, t, count, {spread = .04, f = 1800, peak = .06} = {}) { for (let i = 0; i < count; i++) noise(dest, t + i * spread * (.6 + Math.random() * .8), {f0: f * (.8 + Math.random() * .5), q: 7, attack: .002, peak, release: .05}); }

  // ---- cues --------------------------------------------------------------------------------------------------------
  // Each: (dest, t, opts) -> void. Seconds is how long it can ring (voice budget); range is the audible distance.
  const CUES = {
    // Combat --------------------------------------------------------------------------------------------------------
    // Skeleton falls apart: a clattering collapse, a hollow bonk and a little falling "wah" of a whistle. Goofy.
    death_bone: {seconds: 1.1, range: 40, play(o, t) { rattle(o, t, 9, {spread: .05, f: 1500, peak: .07}); thump(o, t + .28, 180, 70, .12, .18); tone(o, t + .05, {type: 'triangle', f0: 660, f1: 220, attack: .02, peak: .022, release: .55}); }},
    // A golem/stone body coming apart: a geode crack, then rubble settling.
    death_stone: {seconds: 1.4, range: 50, play(o, t) { noise(o, t, {type: 'highpass', f0: 3200, f1: 1400, peak: .12, release: .14}); thump(o, t, 90, 32, .3, .5); for (let i = 0; i < 6; i++) noise(o, t + .15 + i * .09 + Math.random() * .05, {f0: 500 + Math.random() * 500, q: 3, peak: .07, release: .09}); bell(o, t + .05, 1180, .02, .9); }},
    // Anything else: a soft "poof" of a body vanishing in a puff, with a falling note.
    death_soft: {trim: 3, seconds: .9, range: 36, play(o, t) { noise(o, t, {type: 'lowpass', f0: 1800, f1: 300, attack: .01, peak: .12, release: .35}); tone(o, t, {type: 'triangle', f0: 520, f1: 180, peak: .03, release: .4}); }},
    // Bone popped off (arm, skull): a cartoon "pok" with a wobble.
    detach: {trim: 3, seconds: .4, range: 32, play(o, t) { tone(o, t, {f0: 900, f1: 340, peak: .07, attack: .002, release: .09}); noise(o, t, {f0: 2400, q: 5, peak: .07, release: .04}); tone(o, t + .05, {type: 'triangle', f0: 300, f1: 420, peak: .02, release: .15}); }},
    // Ground shockwave: a whump you feel, with grit thrown up.
    shockwave: {seconds: 1, range: 55, duck: [.25, .6], play(o, t) { thump(o, t, 75, 28, .35, .55); noise(o, t, {type: 'lowpass', f0: 900, f1: 140, peak: .16, release: .5}); noise(o, t + .06, {f0: 2200, f1: 900, q: 1.2, peak: .05, release: .25}); }},
    // A hero hit by an enemy: a muffled body thud and a short grunt-ish down-sweep (no voice samples).
    hurt: {trim: 2.5, seconds: .4, range: 24, play(o, t) { thump(o, t, 150, 60, .2, .14); noise(o, t, {type: 'lowpass', f0: 700, f1: 250, peak: .1, release: .12}); tone(o, t + .01, {type: 'sawtooth', f0: 210, f1: 150, peak: .012, release: .12}); }},
    // A shot that had no special sound of its own: a light bowstring twang.
    shoot: {trim: 2, seconds: .5, range: 34, play(o, t) { tone(o, t, {type: 'triangle', f0: 190, f1: 150, peak: .07, attack: .002, release: .28}); noise(o, t, {f0: 900, f1: 3000, q: 1.2, peak: .06, release: .12}); }},
    // A shield bubble taking a blow / going up / going down.
    shield_block: {seconds: .7, range: 45, play(o, t) { bell(o, t, 660, .05, .6); noise(o, t, {type: 'highpass', f0: 3500, peak: .05, release: .1}); tone(o, t, {f0: 140, f1: 90, peak: .08, release: .2}); }},
    shield_up: {seconds: 1.6, range: 60, play(o, t) { [0, 4, 7, 12].forEach((n, i) => bell(o, t + i * .08, semis(523, n), .035, 1.2)); noise(o, t, {type: 'highpass', f0: 2500, f1: 5000, attack: .3, peak: .04, release: .8}); }},
    shield_down: {seconds: 1.4, range: 70, duck: [.2, .8], play(o, t) { noise(o, t, {type: 'highpass', f0: 4000, f1: 1200, peak: .16, release: .5}); [12, 7, 3, 0].forEach((n, i) => bell(o, t + .05 + i * .07, semis(440, n), .03, .7)); thump(o, t, 110, 40, .2, .4); }},
    // A home-base piece knocked out (pylon, turret, gate).
    part_broken: {seconds: 1.3, range: 60, duck: [.2, .7], play(o, t) { noise(o, t, {type: 'lowpass', f0: 1600, f1: 160, peak: .2, release: .8}); thump(o, t, 95, 30, .3, .6); rattle(o, t + .15, 6, {f: 900, peak: .05, spread: .07}); }},
    // A keep turret firing its bolt.
    turret_fire: {trim: 3, seconds: .5, range: 50, play(o, t) { thump(o, t, 160, 70, .14, .1); noise(o, t, {f0: 600, f1: 2600, q: 1, peak: .08, release: .18}); tone(o, t, {type: 'triangle', f0: 240, f1: 180, peak: .04, release: .2}); }},
    // Melee swing: an air whoosh that leads the blow. Axe is broad and woody, pick is a quick sharp cut, hammer is a
    // big slow "vwoom", a swung bone is a light whip.
    swing: {seconds: .5, range: 0, play(o, t, {tool = 'axe'} = {}) {
      const [f0, f1, q, dur, peak, body] = {pick: [900, 3200, 1.6, .16, .2, 0], hammer: [300, 1100, 1.1, .3, .14, 1], limb: [1200, 3600, 2, .13, .12, 0]}[tool] || [500, 2000, 1.3, .22, .15, .6];
      noise(o, t, {f0, f1, q, attack: dur * .55, peak, release: dur * .45});
      noise(o, t + dur * .2, {type: 'highpass', f0: 3800, attack: dur * .4, peak: peak * .25, release: dur * .3});
      if (body) tone(o, t + dur * .3, {f0: 120, f1: 80, attack: dur * .3, peak: .03 * body, release: dur * .5});
    }},
    // Your Hero knocked out: a dull thump, the world pulls away (a falling, muffled chord). Then the respawn chime.
    hero_down: {seconds: 2, range: 30, duck: [.45, 1.6], play(o, t) { thump(o, t, 110, 38, .3, .5); noise(o, t, {type: 'lowpass', f0: 900, f1: 120, peak: .14, release: .9}); [7, 3, 0].forEach((n, i) => tone(o, t + .15 + i * .18, {type: 'triangle', f0: semis(392, n), f1: semis(392, n) * .97, peak: .035, release: .7})); }},
    respawn: {seconds: 1.6, range: 30, play(o, t) { noise(o, t, {type: 'highpass', f0: 2500, f1: 6000, attack: .35, peak: .05, release: .6}); [0, 7, 12, 16].forEach((n, i) => bell(o, t + .2 + i * .09, semis(523, n), .03, 1)); }},
    // Golden radiant burst: a bright flash-bang of chimes.
    radiant: {seconds: 1.4, range: 50, play(o, t) { noise(o, t, {type: 'highpass', f0: 3000, f1: 1500, peak: .12, release: .25}); thump(o, t, 140, 60, .15, .25); [12, 16, 19, 24].forEach((n, i) => bell(o, t + .03 + i * .04, semis(523, n), .035, 1.1)); }},
    // Timberline blade biting through timber: a short saw "zzrip".
    saw: {trim: 4, seconds: .5, range: 40, play(o, t) { noise(o, t, {f0: 1400, f1: 2400, q: 3, attack: .01, peak: .09, release: .25, rate: 1.5}); tone(o, t, {type: 'sawtooth', f0: 95, f1: 120, peak: .02, release: .25}); }},
    // A meteor egg unfurling into a creature: a cracking shell and a hatchling squeak.
    unfurl: {seconds: 1.2, range: 45, play(o, t) { for (let i = 0; i < 4; i++) noise(o, t + i * .11, {type: 'highpass', f0: 2800 + i * 300, peak: .07, release: .06}); thump(o, t + .45, 140, 60, .14, .2); tone(o, t + .55, {type: 'triangle', f0: 600, f1: 1100, peak: .03, release: .25}); }},
    // Something catching phoenix fire: a soft "fwoomp".
    ignite: {seconds: .9, range: 40, play(o, t) { noise(o, t, {type: 'lowpass', f0: 300, f1: 2400, attack: .08, peak: .14, release: .55}); tone(o, t, {f0: 90, f1: 140, attack: .05, peak: .06, release: .4}); }},
    // A goo blob splatting: a wet "splortch".
    splat: {trim: 3, seconds: .5, range: 30, play(o, t) { noise(o, t, {type: 'lowpass', f0: 1600, f1: 250, peak: .1, release: .2}); tone(o, t, {f0: 300, f1: 90, peak: .05, release: .15}); tone(o, t + .06, {type: 'triangle', f0: 520, f1: 260, peak: .015, release: .1}); }},
    // A stumpling ducking back into the dirt for good: a little "bloop".
    bloop: {trim: 2.5, seconds: .5, range: 26, play(o, t) { tone(o, t, {f0: 700, f1: 240, peak: .04, release: .2}); noise(o, t + .05, {type: 'lowpass', f0: 800, peak: .05, release: .15}); }},
    // Emberdew flask thrown: the glass swishes through the air with a slosh inside.
    throw: {trim: 3, seconds: .5, range: 30, play(o, t, {hard = false} = {}) { noise(o, t, {f0: 700, f1: hard ? 2600 : 1800, q: 1.2, attack: .05, peak: hard ? .07 : .05, release: .2}); noise(o, t + .04, {type: 'lowpass', f0: 500, f1: 260, q: 4, peak: .04, release: .18}); }},
    // Someone else's Wyrmspout: short gusts of flame (your own uses the full flame loop).
    flame_puff: {trim: 2, seconds: .4, range: 40, play(o, t) { noise(o, t, {type: 'lowpass', f0: 500, f1: 1600, attack: .04, peak: .1, release: .3}); noise(o, t, {f0: 2600, q: .8, peak: .02, release: .2}); }},
    // Adventure beats: a rising warning before a big attack lands, then the hit; a cheerful sting for each stage.
    telegraph: {seconds: 1.2, range: 60, play(o, t) { tone(o, t, {type: 'triangle', f0: 330, f1: 660, attack: .7, peak: .04, release: .2}); noise(o, t, {f0: 600, f1: 2400, attack: .7, peak: .04, release: .2}); }},
    star_impact: {seconds: 1.4, range: 60, duck: [.3, .9], play(o, t) { thump(o, t, 90, 30, .3, .6); noise(o, t, {type: 'lowpass', f0: 1400, f1: 140, peak: .16, release: .8}); bell(o, t + .03, 880, .04, 1.2); bell(o, t + .07, 1320, .03, 1); }},
    stage: {seconds: 1.6, range: 0, play(o, t) { horn(o, t, [262, 392, 523], .04, .14); }},
    support: {seconds: 1, range: 40, play(o, t) { [0, 4, 7].forEach((n, i) => bell(o, t + i * .07, semis(659, n), .03, .8)); }},
    // Battle beats: a warm horn rising (start), a triumphant fanfare (victory), a lower pair (stop/lost).
    battle_start: {trim: 0.7, seconds: 2, range: 0, play(o, t) { horn(o, t, [196, 262, 330], .055); }},
    battle_victory: {trim: 0.7, seconds: 2.4, range: 0, play(o, t) { horn(o, t, [262, 330, 392, 523], .05, .11); [0, 4, 7, 12, 16].forEach((n, i) => bell(o, t + .5 + i * .06, semis(784, n), .02, 1.4)); }},
    battle_stop: {trim: 0.7, seconds: 1.6, range: 0, play(o, t) { horn(o, t, [262, 196], .045, .25); }},
    // A wave of enemies arriving: drum hits and a short horn.
    battle_wave: {trim: 0.6, seconds: 1.8, range: 0, play(o, t) { for (let i = 0; i < 3; i++) { thump(o, t + i * .22, 110, 55, .18, .2); noise(o, t + i * .22, {type: 'lowpass', f0: 600, f1: 200, peak: .06, release: .12}); } horn(o, t + .7, [165, 220], .04, .3); }},

    // Gathering and building -------------------------------------------------------------------------------------
    // Picking something up: a bright two-note pling. Ore and gems sparkle; gold clinks like coins; stone is drier.
    pickup: {seconds: .8, range: 20, play(o, t, {material} = {}) {
      if (material === 'gold') { for (let i = 0; i < 3; i++) bell(o, t + i * .05, 2100 + i * 230, .025, .3); return; }
      const sparkle = ['iron', 'copper', 'mithril', 'gems', 'crystal', 'ore'].includes(material), base = material === 'gems' || material === 'crystal' ? 1047 : material === 'stone' ? 523 : 784;
      tone(o, t, {type: 'triangle', f0: base, peak: .05, release: .12}); tone(o, t + .07, {type: 'triangle', f0: base * 1.5, peak: .05, release: .25});
      if (sparkle) for (let i = 0; i < 4; i++) tone(o, t + .09 + i * .035, {f0: base * 3 * (1 + i * .12), peak: .012, release: .18});
      noise(o, t, {type: 'highpass', f0: 3000, peak: .02, release: .05});
    }},
    // A building/structure finished: a wooden thunk, a mallet tap and a rising chime.
    build: {seconds: 1.4, range: 40, play(o, t) { thump(o, t, 140, 60, .2, .16); noise(o, t, {f0: 700, q: 2, peak: .08, release: .1}); noise(o, t + .16, {f0: 1100, q: 3, peak: .06, release: .07}); [0, 4, 7, 12].forEach((n, i) => tone(o, t + .25 + i * .07, {type: 'triangle', f0: semis(523, n), peak: .03, release: .4})); }},
    // A blueprint placed (planned, not built yet): a soft paper "fwip" and a pencil tick.
    place: {trim: 2, seconds: .4, range: 20, play(o, t) { noise(o, t, {f0: 1800, f1: 4200, q: .9, peak: .05, release: .12}); tone(o, t + .08, {type: 'triangle', f0: 880, peak: .025, release: .1}); }},
    // Forge results.
    forge_success: {seconds: 1.8, range: 40, play(o, t) { for (let i = 0; i < 3; i++) bell(o, t + i * .2, i === 2 ? 1320 : 990, .05, .9); noise(o, t + .45, {type: 'lowpass', f0: 3000, f1: 400, peak: .08, release: .6}); [0, 4, 7, 12].forEach((n, i) => tone(o, t + .5 + i * .07, {type: 'triangle', f0: semis(659, n), peak: .025, release: .5})); }},
    forge_fail: {seconds: 1, range: 40, play(o, t) { bell(o, t, 740, .04, .4); tone(o, t + .12, {type: 'triangle', f0: 330, f1: 247, peak: .04, release: .4}); noise(o, t + .1, {type: 'lowpass', f0: 1200, f1: 300, peak: .05, release: .35}); }},
    // Smelting/refining: a hiss of steam and a dull metal clank.
    smelt: {seconds: 1, range: 30, play(o, t) { noise(o, t, {type: 'highpass', f0: 2800, f1: 5200, attack: .04, peak: .06, release: .6}); bell(o, t, 420, .05, .5); thump(o, t, 120, 70, .1, .1); }},
    // A worker (stumpy little helper) summoned / delivering.
    worker_summon: {trim: 1.4, seconds: .9, range: 30, play(o, t) { tone(o, t, {type: 'triangle', f0: 520, f1: 980, peak: .04, release: .18}); tone(o, t + .12, {type: 'triangle', f0: 700, f1: 1250, peak: .04, release: .2}); noise(o, t, {f0: 1200, f1: 2600, peak: .03, release: .25}); }},
    deliver: {trim: 1.4, seconds: .6, range: 26, play(o, t) { thump(o, t, 160, 80, .12, .1); tone(o, t + .06, {type: 'triangle', f0: 660, peak: .03, release: .15}); tone(o, t + .13, {type: 'triangle', f0: 880, peak: .03, release: .2}); }},
    // Hero level-ups and rewards that had no voice of their own.
    reward: {seconds: 1.4, range: 30, play(o, t) { [0, 4, 7, 11, 14].forEach((n, i) => bell(o, t + i * .06, semis(784, n), .025, .9)); }},
    resource_use: {trim: 4, seconds: .4, range: 18, play(o, t) { tone(o, t, {type: 'triangle', f0: 600, f1: 450, peak: .03, release: .12}); noise(o, t, {f0: 1500, q: 2, peak: .03, release: .06}); }},

    // Hero movement and hands ------------------------------------------------------------------------------------
    // Footfall: a soft, short scuff, grassy by default; stone is crisper, snow is a muffled crunch, wet adds a splash.
    step: {trim: 5, seconds: .2, range: 0, play(o, t, {surface = 'grass', weight = 1} = {}) {
      const p = .05 * weight;
      if (surface === 'snow') { noise(o, t, {f0: 1400, f1: 900, q: .8, attack: .01, peak: p * 1.1, release: .1}); noise(o, t + .02, {type: 'lowpass', f0: 600, peak: p * .6, release: .08}); }
      else if (surface === 'stone') { noise(o, t, {f0: 2600, q: 1.4, peak: p * .9, release: .05}); thump(o, t, 160, 90, p * 1.2, .05); }
      else if (surface === 'wet') { noise(o, t, {f0: 1900, f1: 3200, q: 1.2, peak: p, release: .09}); thump(o, t, 120, 70, p, .06); }
      else { noise(o, t, {f0: 900, f1: 650, q: .9, attack: .006, peak: p, release: .08}); thump(o, t, 110, 60, p * .8, .06); }
    }},
    jump: {trim: 10, seconds: .25, range: 0, play(o, t) { noise(o, t, {f0: 700, f1: 1400, q: .8, peak: .04, release: .1}); }},
    land: {trim: 1.5, seconds: .35, range: 0, play(o, t, {weight = 1} = {}) { thump(o, t, 120, 45, .14 * weight, .14); noise(o, t, {type: 'lowpass', f0: 900, f1: 300, peak: .07 * weight, release: .12}); }},
    // Swapping tools: leather "shff" as one goes on the back and a short ring as the other comes out.
    swap: {seconds: .5, range: 0, play(o, t, {metal = true} = {}) { noise(o, t, {f0: 900, f1: 2200, q: .8, attack: .02, peak: .05, release: .12}); if (metal) { tone(o, t + .14, {f0: 2400, f1: 2300, peak: .012, release: .3}); tone(o, t + .14, {f0: 3610, peak: .006, release: .2}); } else thump(o, t + .13, 220, 140, .05, .05); }},

    // UI ----------------------------------------------------------------------------------------------------------
    click: {trim: 12, seconds: .12, range: 0, ui: true, play(o, t) { tone(o, t, {type: 'triangle', f0: 1250, f1: 900, peak: .03, attack: .001, release: .045}); noise(o, t, {type: 'highpass', f0: 4000, peak: .012, release: .015}); }},
    confirm: {seconds: .4, range: 0, ui: true, play(o, t) { tone(o, t, {type: 'triangle', f0: 784, peak: .035, release: .1}); tone(o, t + .07, {type: 'triangle', f0: 1175, peak: .035, release: .22}); }},
    open: {trim: 3, seconds: .3, range: 0, ui: true, play(o, t) { noise(o, t, {f0: 1200, f1: 3000, q: .9, peak: .025, release: .1}); tone(o, t + .02, {type: 'triangle', f0: 660, f1: 880, peak: .02, release: .12}); }},
    close: {trim: 3, seconds: .3, range: 0, ui: true, play(o, t) { noise(o, t, {f0: 3000, f1: 1200, q: .9, peak: .022, release: .1}); tone(o, t + .02, {type: 'triangle', f0: 880, f1: 600, peak: .018, release: .1}); }},
    deny: {seconds: .3, range: 0, ui: true, play(o, t) { tone(o, t, {type: 'square', f0: 220, peak: .012, release: .08}); tone(o, t + .1, {type: 'square', f0: 196, peak: .012, release: .1}); }},
    talent: {seconds: 1, range: 0, ui: true, play(o, t) { bell(o, t, 988, .035, .8); bell(o, t + .08, 1319, .03, .9); noise(o, t, {type: 'highpass', f0: 4200, peak: .02, release: .4}); }},
  };
  function horn(o, t, notes, peak = .05, gap = .18) {
    notes.forEach((f, i) => {
      const at = t + i * gap, last = i === notes.length - 1, lp = context.createBiquadFilter(), g = context.createGain();
      lp.type = 'lowpass'; lp.Q.value = 1.5; lp.frequency.setValueAtTime(400, at); lp.frequency.linearRampToValueAtTime(1800, at + .08); lp.frequency.linearRampToValueAtTime(800, at + (last ? .7 : .2));
      lp.connect(g).connect(o); const end = env(g, at, .03, peak, last ? .5 : .1, last ? .25 : .06);
      for (const cents of [-6, 6]) { const osc = context.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = cents; osc.connect(lp); osc.start(at); osc.stop(end); }
    });
  }

  function play(name, position = null, ear = null, opts = {}) {
    const cue = CUES[name]; if (!cue || context.state !== 'running') return false;
    const now = context.currentTime, key = opts.key ?? name, gap = opts.gap ?? .03;
    if (now - (last.get(key) ?? -1) < gap) return false; // the same cue on the same thing in the same instant is one sound
    const where = cue.range && position ? level(position, ear, {range: cue.range, minimum: opts.mine ? .45 : 0}) : {gain: 1, pan: 0};
    const gain = where.gain * (opts.gain ?? 1); if (gain < .01) { stats.quiet++; return false; }
    if (!claim(cue.seconds)) { stats.culled++; return false; }
    last.set(key, now); if (last.size > 256) last.clear();
    const g = context.createGain(); g.gain.value = clamp(gain * (cue.trim ?? 1), 0, 12);
    const dest = cue.ui ? uiOut : out;
    let pan = null; if (where.pan && context.createStereoPanner) { pan = context.createStereoPanner(); pan.pan.value = where.pan; g.connect(pan).connect(dest); } else g.connect(dest);
    cue.play(g, now + .005, opts); stats.played++;
    if (cue.duck && gain > .35) duck(cue.duck[0] * Math.min(1, gain), cue.duck[1]);
    setTimeout(() => { g.disconnect(); pan?.disconnect(); }, cue.seconds * 1000 + 300);
    return true;
  }
  return {play, has: name => !!CUES[name], names: () => Object.keys(CUES), stats: () => ({...stats}), dispose() { out.disconnect(); if (uiOut !== out) uiOut.disconnect(); }};
}
