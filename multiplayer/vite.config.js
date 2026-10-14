import {defineConfig} from 'vite';
import {execFileSync} from 'node:child_process';
import {mapEditorSave} from './map-editor/save-plugin.mjs';
let revision='local';
try{revision=execFileSync('git',['describe','--always','--dirty'],{encoding:'utf8'}).trim();}catch{}
const build=`${revision} · ${new Date().toISOString().slice(5,16).replace('T',' ')}Z`;
// mapEditorSave only runs on the local dev server (npm run map); builds and deploys never include the map editor.
export default defineConfig({define:{__BRANN_BUILD__:JSON.stringify(build)},plugins:[mapEditorSave()]});
