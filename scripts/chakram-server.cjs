"use strict";
// Only the public showcase directory is exposed. No forge API, saves or uploads.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../outputs/chakram'),port=Number(process.env.CHAKRAM_PORT||8846);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png'};
const log=(kind,data)=>console.log(JSON.stringify({at:new Date().toISOString(),kind,...data}));
process.on('uncaughtException',error=>{log('uncaught',{error:error.stack});process.exit(1);});
http.createServer((req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'no-referrer','Content-Length':fs.statSync(file).size});
  if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(file);stream.on('error',e=>{log('read_error',{message:e.message});res.destroy();});stream.pipe(res);
 }catch(error){log('request_error',{message:error.message});res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>log('ready',{port,root}));
