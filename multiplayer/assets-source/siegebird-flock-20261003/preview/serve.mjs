// Read-only static server for the Siegebird flock previews. Serves the multiplayer folder,
// maps /assets/* to public/assets/* like Vite does, and three from node_modules.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css'};
const port = Number(process.env.PORT || 8823);
createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/assets/')) path = '/public' + path;
  if (path.startsWith('/three/')) path = '/node_modules/three/' + path.slice(7);
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'}).end(body); }
  catch { res.writeHead(404).end('missing ' + path); }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on ${port}`));
