// Interactive local prototype. Stop with Ctrl+C; the owned Leap reader closes with it.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
process.env.FORGE_LEAP='1';
process.env.VITE_PEER_WS_URL||='wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud';
const server=await createServer({root:fileURLToPath(new URL('./',import.meta.url)),server:{host:'127.0.0.1',port:5194,strictPort:true}});
await server.listen();
console.log('Leap God prototype: http://127.0.0.1:5194/?leap — choose God, Play solo, then Hands: off to enable.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
