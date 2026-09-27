'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const started=Date.now(),exe=require('electron');
const child=spawn(exe,[__dirname,'--check'],{cwd:__dirname,windowsHide:true,stdio:'ignore',timeout:16000});
child.on('error',error=>{console.error('AUDIO_HOST_CHECK launch failed:',error.code||error.name);process.exitCode=1;});
child.on('exit',(code,signal)=>{const directory=path.join(__dirname,'logs');const logs=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>name.endsWith('.jsonl')).map(name=>path.join(directory,name)).filter(file=>fs.statSync(file).mtimeMs>=started).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs):[];let result=null;
for(const file of logs){for(const line of fs.readFileSync(file,'utf8').trim().split('\n')){try{const row=JSON.parse(line);if(row.pid===child.pid&&['CHECK_PASS','CHECK_FAIL'].includes(row.event))result=row;}catch{}}}
console.log(JSON.stringify(result||{event:'CHECK_FAIL',code,signal,seconds:(Date.now()-started)/1000}));process.exitCode=code===0&&result?.event==='CHECK_PASS'?0:1;});
