// ICE servers handed to every player in the welcome message. Voice audio is
// direct WebRTC between players; STUN alone fails on most mobile networks
// (carrier-grade NAT), so when a Cloudflare TURN key is configured the
// Worker adds short-lived relay credentials. Without the two secrets this
// stays STUN-only, exactly as before.
//   wrangler secret put TURN_KEY_ID
//   wrangler secret put TURN_KEY_API_TOKEN
export const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TTL_S = 12 * 3600, REUSE_MS = 6 * 3600_000, TIMEOUT_MS = 1500;
let cached = null;

// Browsers time out on port 53 TURN URLs behind some firewalls; Cloudflare's guidance is to drop them.
const usable = url => typeof url === 'string' && /^(stun|turns?):/.test(url) && !/:53(\?|$)/.test(url);
export function normalizeTurn(body) {
  const list = Array.isArray(body?.iceServers) ? body.iceServers : body?.iceServers ? [body.iceServers] : [];
  return list.map(s => ({ urls: [].concat(s.urls || []).filter(usable), username: s.username, credential: s.credential }))
    .filter(s => s.urls.length && (s.urls.every(u => u.startsWith('stun:')) || (typeof s.username === 'string' && typeof s.credential === 'string')))
    .map(s => s.username ? s : { urls: s.urls });
}
export async function iceServers(env, { fetch: get = globalThis.fetch, now = Date.now() } = {}) {
  if (!env?.TURN_KEY_ID || !env?.TURN_KEY_API_TOKEN) return STUN;
  if (cached && now - cached.at < REUSE_MS) return cached.servers;
  try {
    const response = await get(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_S }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw Error(`TURN ${response.status}`);
    const turn = normalizeTurn(await response.json());
    if (!turn.some(s => s.username)) throw Error('TURN response had no relay');
    cached = { at: now, servers: [...STUN, ...turn] };
    return cached.servers;
  } catch (error) {
    console.log(JSON.stringify({ event: 'turn_unavailable', message: String(error?.message || error) }));
    return cached?.servers || STUN; // a stale-but-valid set beats none; credentials outlive REUSE_MS
  }
}
export const resetIceCache = () => { cached = null; };
