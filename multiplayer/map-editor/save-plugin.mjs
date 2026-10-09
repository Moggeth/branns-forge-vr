// Dev-server only (`npm run map`): lets the map editor's Save button write shared/map-layout.json on this computer.
// Never part of a build or deploy: Vite only runs `configureServer` for the local dev server.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const FILE = fileURLToPath(new URL('../shared/map-layout.json', import.meta.url));
const KEY = /^[a-z][a-z0-9]*(\.[a-zA-Z0-9]+)*$/;
const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 80;
const okValue = v => num(v) || (Array.isArray(v) && v.length <= 2 && v.every(okValue)) ||
  (!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 3 && Object.entries(v).every(([k, x]) => /^(at|face|yaw|dx|dz)$/.test(k) && okValue(x)));

export function mapEditorSave() {
  let savedAt = 0;
  return {
    name: 'brann-map-editor-save', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__map-layout', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body), moves = data?.moves;
            if (data?.version !== 1 || !moves || typeof moves !== 'object' || Array.isArray(moves)) throw Error('bad layout');
            for (const [k, v] of Object.entries(moves)) if (!KEY.test(k) || !okValue(v)) throw Error(`bad move ${k}`);
            writeFileSync(FILE, JSON.stringify({version: 1, moves}, null, 2) + '\n');
            savedAt = Date.now();
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ok: true, file: 'multiplayer/shared/map-layout.json'}));
          } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ok: false, error: String(e.message || e)})); }
        });
      });
    },
    // The editor already shows what it saved: don't reload it (or a game tab) the moment the file changes.
    handleHotUpdate(ctx) { if (ctx.file.endsWith('map-layout.json') && Date.now() - savedAt < 3000) return []; },
  };
}
