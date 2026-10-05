// Quick play: put a new player into the fullest open public world in their region,
// or tell the caller to light a new one. Owns no session state; lobby.js starts the join.
// Region buckets come from the room service (Cloudflare continent), never from this browser.
import {directoryURL} from './public-room-directory.js';

const PAGES = 3;               // up to 150 listed worlds; the directory rate limit is 60 requests/minute
const TIMEOUT_MS = 6000;

// Pure: rank listed rooms for this player. Fullest first so the first 32 players share a world;
// oldest code breaks ties so everyone converges on the same one. Exported for tests.
export function rankWorlds(rooms, {region = '', exclude = []} = {}) {
  const skip = new Set(exclude);
  return (Array.isArray(rooms) ? rooms : [])
    .filter(r => r && /^\d{8}$/.test(r.code) && r.joinable !== false && r.status !== 'full' && !skip.has(r.code)
      && Number.isInteger(r.count) && Number.isInteger(r.maxPlayers) && r.count >= 1 && r.count < r.maxPlayers
      // Unknown regions only match each other (old service, or a local test without Cloudflare).
      && String(r.region || '') === String(region || ''))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .map(r => r.code);
}

// Returns {codes:[best first], region}. Any failure returns no codes, so the caller creates a world.
export async function findWorlds({endpoint, exclude = [], fetcher = fetch} = {}) {
  let url;
  try { url = directoryURL(typeof endpoint === 'function' ? endpoint() : endpoint); } catch { url = null; }
  if (!url) return {codes: [], region: ''};
  const rooms = []; let region = '', cursor = null;
  const abort = new AbortController(), deadline = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    for (let page = 0; page < PAGES; page++) {
      const next = new URL(url); if (cursor) next.searchParams.set('cursor', cursor);
      const response = await fetcher(next, {signal: abort.signal, cache: 'no-store', credentials: 'omit'});
      if (!response.ok) break;
      const result = await response.json();
      if (!Array.isArray(result?.rooms)) break;
      if (typeof result.region === 'string' && /^[a-z]{0,2}$/.test(result.region)) region = result.region;
      rooms.push(...result.rooms);
      cursor = /^room:\d{8}$/.test(result.nextCursor) ? result.nextCursor : null;
      if (!cursor) break;
    }
  } catch { /* offline, timed out or unreadable: fall through with what we have */ }
  finally { clearTimeout(deadline); }
  return {codes: rankWorlds(rooms, {region, exclude}), region};
}
