'use strict';
const {app,BrowserWindow,session}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {NORMAL_ORIGIN,localOrigin,voicePage,permissionAllowed}=require('./policy.cjs');
const check=process.argv.includes('--check'),started=Date.now();
const base=__dirname,logDir=path.join(base,'logs'),stateDir=path.join(base,'state');
fs.mkdirSync(logDir,{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const logFile=path.join(logDir,`audio-host-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
function log(event,details={}){const row={time:new Date().toISOString(),event,pid:process.pid,...details};fs.appendFileSync(logFile,JSON.stringify(row)+'\n');}
function fault(event,error){log(event,{name:error?.name||'Error',code:error?.code||null,frames:String(error?.stack||'').split('\n').slice(1,4).map(line=>line.trim())});}
let win,server,healthTimer,healthPending=false,servicePid=null,serviceWasUp=false,pageLoaded=false,origin=NORMAL_ORIGIN,stopping=false,diagnosticHeartbeat=false;
app.setName('Brann Audio Host');
app.setPath('userData',path.join(stateDir,check?`check-${process.pid}`:'chromium'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if(check)app.commandLine.appendSwitch('use-fake-device-for-media-stream');
if(!app.requestSingleInstanceLock()){log('duplicate-instance');app.quit();}
else{
  app.on('second-instance',()=>log('duplicate-launch-ignored'));
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{stopping=true;clearInterval(healthTimer);server?.close();log('stopping',{seconds:(Date.now()-started)/1000});});
  app.on('web-contents-created',(_event,contents)=>{
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.on('will-navigate',(event,url)=>{if(!voicePage(url,origin)){event.preventDefault();log('navigation-blocked');}});
    contents.on('will-frame-navigate',(event,details)=>{if(details&&!voicePage(details.url,origin))event.preventDefault();});
    contents.on('will-redirect',(event,url)=>{if(!voicePage(url,origin)){event.preventDefault();log('redirect-blocked');}});
    contents.setWindowOpenHandler(()=>{log('new-window-blocked');return {action:'deny'};});
  });
  process.on('uncaughtException',error=>{fault('uncaught-exception',error);app.exit(1);});
  process.on('unhandledRejection',error=>fault('unhandled-rejection',error));
  process.on('SIGTERM',()=>app.quit());process.on('SIGINT',()=>app.quit());
  app.whenReady().then(boot).catch(error=>{fault('startup-failed',error);app.exit(1);});
}
async function boot(){
  if(check)origin=await diagnosticServer();
  const isolated=session.fromPartition(check?`diagnostic-${process.pid}`:'persist:brann-audio',{cache:false});
  isolated.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>{
    if(!win||contents!==win.webContents||!localOrigin(requestingOrigin,origin))return false;
    return permissionAllowed({permission,url:details.requestingUrl||contents.getURL(),origin,isMainFrame:details.isMainFrame,mediaTypes:details.mediaType?[details.mediaType]:[]});
  });
  isolated.setPermissionRequestHandler((contents,permission,callback,details)=>{
    const allowed=!!win&&contents===win.webContents&&voicePage(contents.getURL(),origin)&&permissionAllowed({permission,url:details.requestingUrl,origin,isMainFrame:details.isMainFrame,mediaTypes:details.mediaTypes});
    log('permission',{permission,allowed});callback(allowed);
  });
  isolated.setDevicePermissionHandler(()=>false);
  isolated.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
  isolated.on('will-download',event=>event.preventDefault());
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!localOrigin(details.url,origin)}));
  win=new BrowserWindow({show:false,width:640,height:420,skipTaskbar:true,autoHideMenuBar:true,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webviewTag:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required',webSecurity:true,allowRunningInsecureContent:false,spellcheck:false,devTools:false}});
  win.setMenu(null);
  if(check)win.webContents.setAudioMuted(true);
  win.webContents.on('did-finish-load',()=>{pageLoaded=true;log('renderer-ready',{hidden:!win.isVisible(),managed:true});});
  win.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame){pageLoaded=false;log('renderer-load-failed',{code});}});
  win.webContents.on('render-process-gone',(_event,details)=>{pageLoaded=false;log('renderer-gone',{reason:details.reason});});
  // Do not copy renderer console text: it can contain conversation or credentials.
  win.webContents.on('console-message',(_event,details)=>{if(details.level==='error')log('renderer-console-error');});
  log('started',{electron:process.versions.electron,mode:check?'check':'managed',origin});
  if(!check)fs.writeFileSync(path.join(stateDir,'host.json'),JSON.stringify({pid:process.pid,startedAt:new Date(started).toISOString(),origin,electron:process.versions.electron},null,2));
  await checkHealth();healthTimer=setInterval(checkHealth,2000);
  if(check)setTimeout(()=>finishCheck({timeout:true}),12000).unref();
}
function readHealth(){return new Promise((resolve,reject)=>{const request=http.get(origin+'/health',response=>{let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy(Error('Oversized health reply'));});response.on('end',()=>{try{const value=JSON.parse(body);if(response.statusCode!==200||value.app!=='branns-forge-vr'||!Number.isInteger(value.pid))throw Error('Unexpected service');resolve(value);}catch(error){reject(error);}});});request.setTimeout(1200,()=>request.destroy(Error('Health timeout')));request.on('error',reject);});}
async function checkHealth(){
  if(healthPending||stopping)return;healthPending=true;
  try{
    const health=await readHealth();const changed=servicePid!==health.pid;
    if(changed||!serviceWasUp||!pageLoaded){
      if(changed&&servicePid!==null)log('service-restarted',{priorPid:servicePid,currentPid:health.pid});
      servicePid=health.pid;serviceWasUp=true;
      await win.loadURL(origin+'/voice/?managed=1');
    }
  }catch{if(serviceWasUp)log('service-offline');serviceWasUp=false;}
  finally{healthPending=false;}
}
async function diagnosticServer(){
  server=http.createServer((request,response)=>{
    if(request.url==='/health'){response.setHeader('Content-Type','application/json');return response.end(JSON.stringify({app:'branns-forge-vr',pid:process.pid}));}
    if(request.url==='/api/vr/voice-client'&&request.method==='POST'){diagnosticHeartbeat=true;response.setHeader('Content-Type','application/json');return response.end('{}');}
    if(request.url==='/diagnostic/result'&&request.method==='POST'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{response.end('{}');try{finishCheck(JSON.parse(body));}catch{finishCheck({invalidResult:true});}});return;}
    if(request.url?.startsWith('/voice/')){response.setHeader('Content-Type','text/html');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; frame-src 'none'");return response.end(diagnosticHTML);}
    response.statusCode=404;response.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;
}
let checkFinished=false;
function finishCheck(result){
  if(checkFinished)return;checkFinished=true;
  const details={...result,heartbeat:diagnosticHeartbeat,hidden:!!win&&!win.isVisible(),singleWindow:BrowserWindow.getAllWindows().length===1};
  const passed=['noNode','audioGranted','videoDenied','mixedDenied','autoplay','mediaPlayback','heartbeat','hidden','singleWindow','popupDenied'].every(key=>details[key]===true);
  log(passed?'CHECK_PASS':'CHECK_FAIL',{...details,seconds:(Date.now()-started)/1000});
  server?.close();app.exit(passed?0:2);
}
const diagnosticHTML=`<!doctype html><html><body><script>
(async()=>{const result={noNode:typeof require==='undefined'&&typeof process==='undefined'};
await fetch('/api/vr/voice-client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({managed:true,message:'isolated-check'})});
try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});result.audioGranted=stream.getAudioTracks().length===1;stream.getTracks().forEach(track=>track.stop());}catch{result.audioGranted=false;}
for(const [key,constraints]of [['videoDenied',{video:true}],['mixedDenied',{audio:true,video:true}]]){try{const stream=await navigator.mediaDevices.getUserMedia(constraints);stream.getTracks().forEach(track=>track.stop());result[key]=false;}catch{result[key]=true;}}
try{const context=new AudioContext();await context.resume();result.autoplay=context.state==='running';const source=context.createOscillator(),quiet=context.createGain(),destination=context.createMediaStreamDestination();quiet.gain.value=0;source.connect(quiet);quiet.connect(destination);source.start();const audio=document.createElement('audio');audio.srcObject=destination.stream;document.body.append(audio);await audio.play();result.mediaPlayback=!audio.paused;audio.pause();destination.stream.getTracks().forEach(track=>track.stop());source.stop();await context.close();}catch{result.autoplay=false;result.mediaPlayback=false;}
result.popupDenied=window.open('https://example.invalid/')===null;
await fetch('/diagnostic/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
})().catch(()=>fetch('/diagnostic/result',{method:'POST',body:JSON.stringify({scriptError:true})}));
</script></body></html>`;
