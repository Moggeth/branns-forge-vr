// Shared by real-browser acceptance and deterministic delayed-recovery regression.
// A connected old peer is NOT evidence that Retry's replacement has negotiated.
export function replacementReady(pair, before, sessions) {
  if (pair?.length !== 2 || !pair[0]?.negotiation || pair[0].negotiation !== pair[1]?.negotiation) return false;
  return pair.every((p, i) => p.id === before[i].id && p.session === sessions[i] &&
    p.remoteId === pair[1-i].id && p.remoteSession === sessions[1-i] &&
    p.connectionState === 'connected' && p.negotiation !== before[i].negotiation);
}
function sameConnectedPair(pair, expected) {
  return pair?.length === 2 && pair.every((p,i) => p.connectionState === 'connected' &&
    ['id','session','remoteId','remoteSession','negotiation'].every(k => p[k] === expected[i][k]));
}
const defaultPause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitForReplacement(readPair, before, sessions, {timeoutMs=20000, now=()=>performance.now(), pause=defaultPause}={}) {
  const deadline=now()+timeoutMs; let pair;
  do {
    pair=await readPair();
    if (now()<=deadline && replacementReady(pair,before,sessions)) return pair;
    if (now()>=deadline) break;
    await pause(Math.min(50,deadline-now()));
  } while (now()<=deadline);
  throw Error(`Replacement voice negotiation timed out: ${JSON.stringify({sessions,pair})}`);
}
export async function waitForRecoveredAudio(readPair, expected, readMeter, {timeoutMs=8000, now=()=>performance.now(), pause=defaultPause}={}) {
  const deadline=now()+timeoutMs; let pair, energy;
  do {
    pair=await readPair();
    if (sameConnectedPair(pair,expected)) {
      energy=await readMeter();
      // Do not accept samples straddling another disconnect/negotiation.
      pair=await readPair();
      if (now()<=deadline && sameConnectedPair(pair,expected) && energy?.length===2 &&
          energy.every(Number.isFinite) && Math.max(...energy)>.001) return energy;
    }
    if (now()>=deadline) break;
    await pause(Math.min(50,deadline-now()));
  } while (now()<=deadline);
  throw Error(`Replacement voice audio timed out: ${JSON.stringify({energy,pair,expected})}`);
}
