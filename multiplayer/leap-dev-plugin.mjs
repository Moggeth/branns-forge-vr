import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync, appendFileSync} from 'node:fs';

// Deliberately dev-only and same-origin: no public port, CORS or mixed-content workaround.
export function leapDevPlugin() {
  return {name:'forge-local-leap', apply:'serve', configureServer(server) {
    if(process.env.FORGE_LEAP !== '1') return;
    const logDir=fileURLToPath(new URL('../logs/',import.meta.url));mkdirSync(logDir,{recursive:true});
    const log=message=>appendFileSync(`${logDir}/leap-bridge.log`,`${new Date().toISOString()} ${message}\n`);
    let latest={status:'starting',hands:[]},received=0,buffer='',child;
    const streams=new Set();
    const packet=()=>JSON.stringify({...latest,sentAt:Date.now(),ageMs:received?Math.round(performance.now()-received):99999});
    function publish(){for(const res of streams){if(res.writableLength>8192){res.destroy();streams.delete(res);}else res.write(`data: ${packet()}\n\n`);}}
    const stop=()=>{for(const res of streams)res.end();streams.clear();if(child&&!child.killed)child.kill();};
    server.httpServer?.once('listening',()=>{
      child=spawn(process.env.FORGE_PYTHON||'python',['-u',fileURLToPath(new URL('../scripts/leap_frames.py',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      log(`reader started pid=${child.pid}`);
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        buffer+=chunk;let end;
        let changed=false;
        while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{latest=JSON.parse(line);received=performance.now();changed=true;}catch{log('invalid reader frame discarded');}}
        // Coalesce catch-up bursts: never replay a backlog of old hand poses.
        if(changed)publish();
        if(buffer.length>65536){buffer='';log('reader buffer reset');}
      });
      child.stderr.on('data',chunk=>log(String(chunk).trim()));
      child.on('error',error=>{latest={status:'error',hands:[],message:'Leap reader could not start. Check Python and logs/leap-bridge.log.'};publish();log(error.message);});
      child.on('exit',code=>{latest={status:'error',hands:[],message:'Leap reader stopped. Restart the preview; check Ultraleap Tracking Service and logs/leap-bridge.log.'};publish();log(`reader exited code=${code}`);});
    });
    server.httpServer?.once('close',stop);process.once('exit',stop);
    const close=server.close.bind(server);server.close=async()=>{stop();await close();process.removeListener('exit',stop);};
    server.middlewares.use('/__leap',(req,res,next)=>{
      if(!['/frame','/stream'].includes(req.url?.split('?')[0]))return next();
      const host=req.headers.host||'';
      const origin=req.headers.origin;
      if(req.method!=='GET'||!/^127\.0\.0\.1:\d+$/.test(host)||(origin&&origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site'){
        res.writeHead(403);res.end('Local same-origin access only');return;
      }
      res.setHeader('Cache-Control','no-store');
      if(req.url?.split('?')[0]==='/stream'){
        if(streams.size>=4){res.writeHead(429);res.end('Close another Leap preview tab before reconnecting.');return;}
        res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');
        res.socket?.setNoDelay(true);res.flushHeaders();res.write(`retry: 1000\ndata: ${packet()}\n\n`);
        streams.add(res);res.once('close',()=>streams.delete(res));return;
      }
      res.setHeader('Content-Type','application/json');res.end(packet());
    });
  }};
}
