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
    const stop=()=>{if(child&&!child.killed)child.kill();};
    server.httpServer?.once('listening',()=>{
      child=spawn(process.env.FORGE_PYTHON||'python',['-u',fileURLToPath(new URL('../scripts/leap_frames.py',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      log(`reader started pid=${child.pid}`);
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        buffer+=chunk;let end;
        while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{latest=JSON.parse(line);received=performance.now();}catch{log('invalid reader frame discarded');}}
        if(buffer.length>65536){buffer='';log('reader buffer reset');}
      });
      child.stderr.on('data',chunk=>log(String(chunk).trim()));
      child.on('error',error=>{latest={status:'error',hands:[],message:'Leap reader could not start. Check Python and logs/leap-bridge.log.'};log(error.message);});
      child.on('exit',code=>{latest={status:'error',hands:[],message:'Leap reader stopped. Restart the preview; check Ultraleap Tracking Service and logs/leap-bridge.log.'};log(`reader exited code=${code}`);});
    });
    server.httpServer?.once('close',stop);process.once('exit',stop);
    server.middlewares.use('/__leap/frame',(req,res)=>{
      const host=req.headers.host||'';
      const origin=req.headers.origin;
      if(req.method!=='GET'||!/^127\.0\.0\.1:\d+$/.test(host)||(origin&&origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site'){
        res.writeHead(403);res.end('Local same-origin access only');return;
      }
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      res.end(JSON.stringify({...latest,ageMs:received?Math.round(performance.now()-received):99999}));
    });
  }};
}
