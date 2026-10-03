import {defineConfig} from 'vite';
import {execFileSync} from 'node:child_process';
let revision='local';
try{revision=execFileSync('git',['describe','--always','--dirty'],{encoding:'utf8'}).trim();}catch{}
const build=`${revision} · ${new Date().toISOString().slice(5,16).replace('T',' ')}Z`;
export default defineConfig({define:{__BRANN_BUILD__:JSON.stringify(build)}});
