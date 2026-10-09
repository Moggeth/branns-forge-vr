// The world's living sound bed, procedural Web Audio (no files). Rain, wind and thunder stay in day-night-weather.js;
// this adds what makes the valley feel inhabited:
//   day      songbirds trading little phrases from the trees around you (fewer in rain, none in snow or at night),
//   night    a soft cricket chorus and the odd goofy owl ("hoo-HOO"), never anything spooky,
//   always   a faint breeze that grows when the God looks down from up high,
//   towns    warm tavern chatter with mug clinks and a lute plucking away, a trickling fountain and a creaky mill
//            near each keep, all placed in the world so you hear them grow as you walk up.
// Runs on the ambience bus (ducked under huge moments by audio-mix.js). Four quiet loops at most plus sparse one-shots;
// update() is cheap and only re-plans a few times a second, so it is phone- and Quest-safe.
import {taverns} from '../shared/taverns.js';
import {HOME_LAYOUT, homePiece, homePoint} from '../shared/home-bases.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

export function createAmbienceAudio({context, level = () => ({gain: 1, pan: 0}), claim = () => true, phone = false} = {}) {
  if (!context?.createOscillator) return null;
  const out = context.createGain(); out.gain.value = 1; out.connect(context.destination);
  const n = context.sampleRate * 2 | 0, noise = context.createBuffer(1, n, context.sampleRate), data = noise.getChannelData(0);
  let s = 424242; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; data[i] = ((s >>> 9) / 4194304) - 1; }
  const stats = {birds: 0, owls: 0, clinks: 0, plucks: 0, creaks: 0};

  // ---- loops -------------------------------------------------------------------------------------------------------
  function placed() { const g = context.createGain(); g.gain.value = 0; const p = context.createStereoPanner?.(); if (p) { g.connect(p).connect(out); } else g.connect(out); return {g, p}; }
  function noiseLoop(type, freq, q, dest) { const src = context.createBufferSource(), f = context.createBiquadFilter(); src.buffer = noise; src.loop = true; src.playbackRate.value = .9 + Math.random() * .2; f.type = type; f.frequency.value = freq; f.Q.value = q; src.connect(f).connect(dest); src.start(0, Math.random() * 1.5); return {src, f}; }
  // Breeze: lowpassed noise with a slow swell (an LFO on the filter), so it breathes instead of hissing.
  const breeze = placed(), breezeNoise = noiseLoop('lowpass', 520, .5, breeze.g), swell = context.createOscillator(), swellDepth = context.createGain();
  swell.frequency.value = .07; swellDepth.gain.value = 220; swell.connect(swellDepth).connect(breezeNoise.f.frequency); swell.start();
  // Crickets: a 4.4 kHz tone gated by a fast chirp pulse and a slower on/off phrase, plus a second cricket a little off.
  const crickets = placed();
  const cricketVoices = [[4400, 29, .9], [4950, 23, .6]].map(([f, rate, phrase]) => {
    const o = context.createOscillator(), gate = context.createGain(), pulse = context.createOscillator(), pulseDepth = context.createGain(), slow = context.createOscillator(), slowDepth = context.createGain(), vca = context.createGain();
    o.frequency.value = f; pulse.type = 'square'; pulse.frequency.value = rate; pulseDepth.gain.value = .5; gate.gain.value = .5;
    slow.type = 'square'; slow.frequency.value = phrase; slowDepth.gain.value = .5; vca.gain.value = .5;
    pulse.connect(pulseDepth).connect(gate.gain); slow.connect(slowDepth).connect(vca.gain);
    o.connect(gate).connect(vca).connect(crickets.g); o.start(); pulse.start(); slow.start();
    return [o, pulse, slow];
  });
  // Tavern chatter: two bands of noise wobbling like voices at a table. Fountain: bright, bubbly noise.
  const tavern = placed(), chatter = noiseLoop('bandpass', 520, 1.4, tavern.g), chatter2 = noiseLoop('bandpass', 1150, 2.2, tavern.g);
  const babble = context.createOscillator(), babbleDepth = context.createGain(); babble.frequency.value = 3.1; babbleDepth.gain.value = 260; babble.connect(babbleDepth).connect(chatter.f.frequency); babble.start();
  const babble2 = context.createOscillator(), babble2Depth = context.createGain(); babble2.frequency.value = 4.7; babble2Depth.gain.value = 420; babble2.connect(babble2Depth).connect(chatter2.f.frequency); babble2.start();
  const fountain = placed(), trickle = noiseLoop('bandpass', 2600, .9, fountain.g);
  const bubble = context.createOscillator(), bubbleDepth = context.createGain(); bubble.type = 'triangle'; bubble.frequency.value = 7.3; bubbleDepth.gain.value = 900; bubble.connect(bubbleDepth).connect(trickle.f.frequency); bubble.start();

  // ---- one-shots ---------------------------------------------------------------------------------------------------
  function shot(position, ear, gain, seconds, range = 40) {
    if (!claim(seconds)) return null;
    const p = position ? level(position, ear, {range}) : {gain: 1, pan: (Math.random() * 2 - 1) * .8};
    if (p.gain * gain < .002) return null;
    const g = context.createGain(); g.gain.value = p.gain * gain;
    if (context.createStereoPanner) { const pn = context.createStereoPanner(); pn.pan.value = p.pan; g.connect(pn).connect(out); setTimeout(() => { g.disconnect(); pn.disconnect(); }, seconds * 1000 + 200); }
    else { g.connect(out); setTimeout(() => g.disconnect(), seconds * 1000 + 200); }
    return g;
  }
  function whistle(dest, t, f0, f1, dur, peak) {
    const o = context.createOscillator(), g = context.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * .2); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + .02);
  }
  // Songbird: each bird gets a voice (base pitch, a favourite trill) and sings a 2-6 note phrase.
  function bird(loud) {
    const g = shot(null, null, loud, 1.4); if (!g) return; stats.birds++;
    const t = context.currentTime + .02, base = 2200 + Math.random() * 1600, notes = 2 + (Math.random() * 5 | 0), style = Math.random();
    for (let i = 0; i < notes; i++) {
      const at = t + i * (.07 + Math.random() * .06), f = base * (1 + (Math.random() - .3) * .35);
      if (style < .4) whistle(g, at, f, f * 1.45, .06, .05); else if (style < .75) whistle(g, at, f * 1.3, f * .8, .07, .05); else { whistle(g, at, f, f * 1.1, .03, .04); whistle(g, at + .035, f * 1.2, f * .9, .04, .04); }
    }
  }
  // Owl: two soft, round "hoo"s, the second a touch higher, like it is asking a question. Charming, not eerie.
  function owl(loud) {
    const g = shot(null, null, loud, 1.6); if (!g) return; stats.owls++;
    const t = context.currentTime + .02, f = 380 + Math.random() * 60;
    [[0, 1, .28], [.42, 1.12, .4]].forEach(([at, r, dur]) => {
      const o = context.createOscillator(), lp = context.createBiquadFilter(), v = context.createGain(); o.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 900;
      o.frequency.setValueAtTime(f * r * .94, t + at); o.frequency.exponentialRampToValueAtTime(f * r, t + at + .06); o.frequency.exponentialRampToValueAtTime(f * r * .9, t + at + dur);
      v.gain.setValueAtTime(.0001, t + at); v.gain.exponentialRampToValueAtTime(.07, t + at + .07); v.gain.exponentialRampToValueAtTime(.0001, t + at + dur);
      o.connect(lp).connect(v).connect(g); o.start(t + at); o.stop(t + at + dur + .02);
    });
  }
  function clink(position, ear) {
    const g = shot(position, ear, .5, .7, 26); if (!g) return; stats.clinks++;
    const t = context.currentTime + .01, f = 1700 + Math.random() * 500;
    for (const [r, a] of [[1, .05], [2.4, .025], [3.9, .012]]) { const o = context.createOscillator(), v = context.createGain(); o.frequency.value = f * r; v.gain.setValueAtTime(a, t); v.gain.exponentialRampToValueAtTime(.0001, t + .35 / r); o.connect(v).connect(g); o.start(t); o.stop(t + .4); }
    if (Math.random() < .4) { const o = context.createOscillator(), v = context.createGain(); o.frequency.value = f * 1.07; v.gain.setValueAtTime(.03, t + .09); v.gain.exponentialRampToValueAtTime(.0001, t + .35); o.connect(v).connect(g); o.start(t + .09); o.stop(t + .4); }
  }
  // Lute: a little plucked run on a cheerful pentatonic, from inside the tavern.
  let lutePhrase = 0;
  function lute(position, ear) {
    const g = shot(position, ear, .55, 2.6, 26); if (!g) return; stats.plucks++;
    const t = context.currentTime + .02, root = [196, 220, 247, 262][lutePhrase++ % 4], notes = 4 + (Math.random() * 3 | 0);
    for (let i = 0; i < notes; i++) {
      const f = root * 2 ** (PENTA[(i * 2 + lutePhrase + (Math.random() * 3 | 0)) % PENTA.length] / 12), at = t + i * (.18 + (i % 2) * .08);
      const o = context.createOscillator(), lp = context.createBiquadFilter(), v = context.createGain(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 6, at); lp.frequency.exponentialRampToValueAtTime(f * 1.2, at + .25); v.gain.setValueAtTime(.0001, at); v.gain.exponentialRampToValueAtTime(.04, at + .004); v.gain.exponentialRampToValueAtTime(.0001, at + .5);
      o.connect(lp).connect(v).connect(g); o.start(at); o.stop(at + .55);
    }
  }
  // Mill: a slow wooden creak (a resonant, pitch-wobbling squeak through a body filter).
  function creak(position, ear) {
    const g = shot(position, ear, .5, 1, 24); if (!g) return; stats.creaks++;
    const t = context.currentTime + .01, src = context.createBufferSource(), bp = context.createBiquadFilter(), v = context.createGain();
    src.buffer = noise; src.playbackRate.value = .5; bp.type = 'bandpass'; bp.Q.value = 18; bp.frequency.setValueAtTime(260, t); bp.frequency.linearRampToValueAtTime(380, t + .35); bp.frequency.linearRampToValueAtTime(300, t + .7);
    v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(.5, t + .08); v.gain.exponentialRampToValueAtTime(.0001, t + .8); src.connect(bp).connect(v).connect(g); src.start(t, Math.random()); src.stop(t + .85);
  }

  // ---- planning ----------------------------------------------------------------------------------------------------
  let plan = 0, nextBird = 2, nextOwl = 5, nextClink = 1, nextLute = 3, nextCreak = 2, sites = null, sitesKey = '';
  function townSites(state) {
    const list = taverns(state), key = list.length ? 'town' : '';
    if (key === sitesKey) return sites; sitesKey = key;
    if (!list.length) return sites = null;
    const fountains = ['party', 'rivals'].map(side => homePoint(side, HOME_LAYOUT.fountain)), mills = ['party', 'rivals'].map(side => { const m = homePiece(side, 'mill'); return [m.x, m.z]; });
    return sites = {taverns: list.map(t => [t.placed.x, t.placed.z]), fountains, mills};
  }
  const nearest = (list, ear) => { let best = null, d = Infinity; for (const p of list || []) { const dd = Math.hypot(p[0] - ear.position[0], p[1] - ear.position[2]); if (dd < d) { d = dd; best = p; } } return best && {at: [best[0], 0, best[1]], d}; };
  const setLoop = (loop, gain, pan = 0) => { const t = context.currentTime; loop.g.gain.setTargetAtTime(gain, t, .6); loop.p?.pan.setTargetAtTime(pan, t, .3); };

  return {
    /** Once per frame (cheap; re-plans four times a second). ear: () => listener pose; sky: () => skyCycle.stats() (night
     * 0..1, weather weights); state: () => snapshot; altitude: () => camera height above the ground. */
    update({ear: earOf, sky: skyOf, state: stateOf, altitude: altitudeOf, dt = 0} = {}) {
      if (context.state !== 'running') return;
      plan -= dt; nextBird -= dt; nextOwl -= dt; nextClink -= dt; nextLute -= dt; nextCreak -= dt;
      if (plan > 0) return; plan = .25;
      const ear = earOf?.(), sky = skyOf?.(), state = stateOf?.(), altitude = altitudeOf?.() ?? 2; if (!ear) return;
      const night = clamp(sky?.night ?? 0, 0, 1), w = sky?.weights || {}, wet = clamp((w.rain || 0) + (w.storm || 0) * 1.4, 0, 1), snow = clamp(w.snow || 0, 0, 1);
      const high = clamp((altitude - 6) / 40, 0, 1), calm = (1 - wet * .8) * (1 - snow) * (1 - high * .7);
      setLoop(breeze, .035 + .05 * high + .02 * snow);
      setLoop(crickets, .012 * clamp((night - .35) / .4, 0, 1) * (1 - wet) * (1 - snow) * (1 - high * .6));
      const town = townSites(state);
      if (town) {
        const tv = nearest(town.taverns, ear), fn = nearest(town.fountains, ear), ml = nearest(town.mills, ear);
        const tvL = tv && tv.d < 30 ? level(tv.at, ear, {range: 30, near: 5}) : {gain: 0, pan: 0}, fnL = fn && fn.d < 18 ? level(fn.at, ear, {range: 18, near: 2}) : {gain: 0, pan: 0};
        setLoop(tavern, .06 * tvL.gain, tvL.pan); setLoop(fountain, .045 * fnL.gain, fnL.pan);
        if (tv && tv.d < 24 && nextClink <= 0) { nextClink = 1.2 + Math.random() * 3.5; clink(tv.at, ear); }
        if (tv && tv.d < 24 && nextLute <= 0) { nextLute = 3 + Math.random() * 4; lute(tv.at, ear); }
        if (ml && ml.d < 22 && nextCreak <= 0) { nextCreak = 2.4 + Math.random() * 2.5; creak(ml.at, ear); }
      } else { setLoop(tavern, 0); setLoop(fountain, 0); }
      const day = 1 - clamp((night - .2) / .5, 0, 1);
      if (nextBird <= 0) { nextBird = (phone ? 3 : 2) + Math.random() * 5; if (day * calm > .15) bird(.55 * day * calm); }
      if (nextOwl <= 0) { nextOwl = 16 + Math.random() * 22; if (night > .6 && calm > .4) owl(.5 * calm); }
    },
    stats: () => ({...stats}),
    dispose() {
      for (const node of [breezeNoise.src, swell, chatter.src, chatter2.src, babble, babble2, trickle.src, bubble, ...cricketVoices.flat()]) { try { node.stop(); } catch { /* stopped */ } }
      out.disconnect();
    },
  };
}
