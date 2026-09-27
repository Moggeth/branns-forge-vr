// Focused native HTTP check using an EXISTING offline fixture from the full verifier.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..');const roots=fs.readdirSync(path.join(project,'work')).filter(n=>n.startsWith('integration-')&&fs.existsSync(path.join(project,'work',n,'fixture.json'))).sort((a,b)=>fs.statSync(path.join(project,'work',b)).mtimeMs-fs.statSync(path.join(project,'work',a)).mtimeMs);
if(!roots.length)throw Error('Run Verify Brann.ps1 to create an isolated fixture first.');
const root=path.join(project,'work',roots[0]);
(async()=>{try{await fetch('http://127.0.0.1:8788/health');throw Error('Test port already occupied.');}catch(e){if(e.message==='Test port already occupied.')throw e;}
 const host=spawn(process.execPath,['integration-host.cjs'],{cwd:path.join(project,'service'),windowsHide:true,env:{...process.env,OPENAI_API_KEY:'',BRANN_PORT:'8788',BRANN_DATA_DIR:path.join(root,'data'),BRANN_ROOT:root}});
 try{for(let n=0;;n++){try{const h=await fetch('http://127.0.0.1:8788/health').then(r=>r.json());if(h.pid!==host.pid)throw Error('Wrong fixture host');break;}catch(e){if(n>40)throw e;await new Promise(r=>setTimeout(r,100));}}
 const out=await new Promise((resolve,reject)=>{const p=spawn(path.join(project,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),['--verbose','--headless','--xr-mode','off','--path',path.join(project,'godot'),'--quit-after','2000','--','--siege-ledger-check','--service=http://127.0.0.1:8788'],{windowsHide:true});let text='';p.stdout.on('data',d=>text+=d);p.stderr.on('data',d=>text+=d);p.on('error',reject);p.on('exit',code=>{fs.writeFileSync(path.join(project,'logs/siege-focused-ledger.log'),text);const gameplayLog=text.split('SIEGE_LEDGER_RESULT')[0];if(code||/SCRIPT ERROR:|^ERROR:/m.test(gameplayLog)||!text.includes('SIEGE_LEDGER_RESULT []'))reject(Error('Native ledger failed: inspect logs/siege-focused-ledger.log'));else resolve(text);});});console.log(out.split('\n').filter(x=>/SIEGE_LEDGER|Leaked instance|leaked at exit/.test(x)).join('\n'));
 }finally{host.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
