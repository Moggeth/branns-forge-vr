import {fork, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const started=performance.now();
const state=await mkdtemp(join(tmpdir(),'branns-multiplayer-production-'));
const env={...process.env,NODE_ENV:'production',PORT:'18090',SIMULATION_PORT:'18091',WORLD_DATA_DIR:state,ALLOWED_ORIGINS:'https://multiplayer-test.invalid',TEST_WS_URL:'ws://127.0.0.1:18090/ws',TEST_ORIGIN:'https://multiplayer-test.invalid',TEST_REQUIRE_ORIGIN:'1'};
const child=fork(join(root,'gateway.mjs'),[],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
let diagnostic='';child.stdout.on('data',b=>diagnostic+=b);child.stderr.on('data',b=>diagnostic+=b);
try {
  let ready=false;
  for(let attempt=0;attempt<50;attempt++){
    if(child.exitCode!==null)throw Error('Owned gateway exited before readiness');
    ready=await fetch('http://127.0.0.1:18090/health').then(r=>r.ok).catch(()=>false);
    if(ready)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error('Owned gateway did not become ready');
  const run=promisify(execFile);
  for(const suite of ['gateway.mjs','run.mjs']) {
    const result=await run(process.execPath,[join(root,'tests',suite)],{cwd:root,env,timeout:30000});
    process.stdout.write(result.stdout);
  }
  console.log(JSON.stringify({check:'production fixture',result:'pass',seconds:(performance.now()-started)/1000}));
} finally {
  const ended=new Promise(resolveExit=>child.once('exit',resolveExit));
  if(child.connected)child.send({type:'shutdown'});
  if(child.exitCode===null)await ended;
  await mkdir(join(root,'logs'),{recursive:true});
  await writeFile(join(root,'logs','production-fixture.log'),diagnostic);
}
