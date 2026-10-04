// Local Siegebird reload clock: perfect-wind presses and VR hand cranking. Presentation only; the host judges the
// same press from its own tick clock (shared/combat.js siegebirdPerfect) and owns the quick reload it earns.
//
// Auto wind: the reload plays on the clock (scaled 0.75x after a perfect wind). The first fire press during a reload
// is judged against the pawl latching; a hit or a miss is final for that reload.
// Hand wind (VR): the free hand grips the crank knob and turns it. The wind follows the crank (ratchet: never
// backwards); if the hand lets go the winch carries on by itself. The songbird waits beside the rail until the pawl
// latches, so a slow hand never seats a bolt on an undrawn string. Latching before the bird seats earns the quick reload.
import {SIEGEBIRD, siegebirdPerfect} from '../shared/combat.js';
import {SIEGEBIRD_RELOAD as R, SIEGEBIRD_WINCH as W, easeInOut, siegebirdHandCues} from './siegebird-reload.js';

export const SIEGEBIRD_WIND = Object.freeze({
  predictWindow: 4,      // ticks: narrower than the host's so a borderline press never predicts a quick reload the host refuses
  grabReach: .09,        // m from the crank knob to start a hand wind
  holdReach: .22,        // m: the grip slips off beyond this
  resume: .35,           // s without the hand before the winch winds itself again
  maxStep: Math.PI / 2,  // largest crank turn accepted in one frame (tracking glitches)
});

export function createSiegebirdWind() {
  const turn = W.crankTurns * Math.PI * 2;
  let real = Infinity, t = Infinity, scale = 1, quick = false, pressed = false, verdict = 0;
  let hand = null, held = false, idle = 0, latched = true;

  function wound() { return hand ?? (t < R.windStart ? 0 : easeInOut((t - R.windStart) / (R.windEnd - R.windStart))); }
  function judge(handWound) {
    verdict = siegebirdPerfect(real * 60, {quick, hand: handWound, window: SIEGEBIRD_WIND.predictWindow}) ? 1 : -1;
    return {perfect: verdict === 1, hand: handWound};
  }

  return {
    // A shot left the rail; quick: this reload runs fast (host-confirmed or predicted perfect wind).
    fired({quick: q = false} = {}) {
      quick = !!q; scale = quick ? R.quick : 1; real = 0; t = 0; pressed = false; verdict = 0; hand = null; held = false; idle = 0; latched = false;
    },
    // Advance by dt seconds. grip: {held, delta} from the free VR hand (delta = crank turn this frame, radians).
    // Returns {cues, wind}: hand-wind ratchet cues, and a wind verdict to send to the host when the hand latched.
    update(dt, grip = null) {
      const cues = []; let wind = null;
      if (!Number.isFinite(t)) return {cues, wind};
      real += dt;
      const winding = !latched && t >= R.windStart - .04;
      if (winding && grip?.held) {
        if (hand === null) hand = wound();
        held = true; idle = 0;
        const before = hand;
        hand = Math.min(1, hand + Math.max(0, Math.min(SIEGEBIRD_WIND.maxStep, grip.delta || 0)) / turn);
        cues.push(...siegebirdHandCues(before, hand));
      } else if (hand !== null && !latched) {
        held = false; idle += dt;
        if (idle > SIEGEBIRD_WIND.resume && t >= R.windStart) {
          const before = hand; hand = Math.min(1, hand + dt / scale / (R.windEnd - R.windStart));
          cues.push(...siegebirdHandCues(before, hand));
        }
      }
      t += dt / scale;
      if (hand !== null) {
        if (hand >= 1 && !latched) { latched = true; if (!pressed) { pressed = true; wind = judge(true); } }
        if (!latched && t > R.arrive) t = R.arrive;     // the bird hovers until the string is drawn
      } else if (t >= R.windEnd) latched = true;
      if (t > R.gone + 1) { t = Infinity; real = Infinity; }
      return {cues, wind};
    },
    // Fire pressed while reloading. Returns the verdict to send once per reload, or null.
    press() {
      if (!(t < R.seconds) || pressed || hand !== null) return null;
      pressed = true; return judge(false);
    },
    time: () => t,                  // presentation seconds (Infinity at rest)
    hand: () => (hand === null ? null : hand),
    handHeld: () => held,
    winding: () => Number.isFinite(t) && !latched && t >= R.windStart - .04,
    verdict: () => verdict,         // this reload's local judgement: 1 perfect, -1 missed, 0 none yet
    quick: () => quick,
  };
}
