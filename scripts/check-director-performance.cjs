'use strict';
// Read-only source audit; --native-window starts an isolated, five-second Godot window probe.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const runtime = read('godot/director_runtime.gd');
const ui = read('service/public/director/ui.js');
const server = read('service/server.js');
const director = read('service/director.js');
const must = (source, regex, label) => assert.match(source, regex, label);

must(runtime, /CAMERA_SIZE\s*=\s*Vector2i\(1024,576\)/, 'capture size changed');
must(runtime, /FRAME_INTERVAL\s*=\s*0\.20/, 'frame cadence changed');
must(runtime, /SubViewport\.UPDATE_ONCE/, 'on-demand viewport changed');
must(runtime, /tactical_viewport\.world_3d\s*=\s*game\.get_world_3d\(\)/, 'world sharing changed');
must(runtime, /texture_get_data_async/, 'async GPU readback changed');
must(runtime, /save_jpg_to_buffer\(0\.78\)/, 'JPEG encoder changed');
must(runtime, /game\.elapsed\s*\+\s*0\.15/, 'state cadence changed');
must(ui, /setTimeout\(poll, document\.hidden \? 1000 : 220\)/, 'browser poll changed');
must(server, /app\.post\('\/api\/director\/frame'/, 'frame POST changed');
must(director, /viewerAt<2500/, 'viewer heartbeat changed');

const width=1024,height=576,fps=5,rgba=width*height*4;
const report={mode:'source-audit',size:[width,height],maxCaptureFps:fps,rgbaBytesPerFrame:rgba,rgbaMiBPerSecond:Math.round(rgba*fps/1048576*100)/100,headsetBudgetMs:{90:11.11,120:8.33},secondCamera:'SubViewport shared World3D, MSAA 2x',capture:'GPU async readback -> Image -> JPEG q=.78 -> local HTTP -> browser image',viewerHeartbeatMs:2500};
const log=path.join(root,'logs/director-frame-check.log');
if(fs.existsSync(log)){
 const matches=[...fs.readFileSync(log,'utf8').matchAll(/DIRECTOR_FRAME[^\r\n]*/g)].map(x=>x[0]);
 report.priorDesktopFrameSamples=matches.slice(-3);
}
console.log('DIRECTOR_PERFORMANCE_AUDIT '+JSON.stringify(report));

if(process.argv.includes('--native-window')){
 const executable=path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe');
 const script=path.join(root,'scripts/check-director-performance.gd');
 const started=performance.now();
 const child=spawnSync(executable,['--xr-mode','off','--audio-driver','Dummy','--path',path.join(root,'godot'),'--script',script],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
 const output=(child.stdout||'')+(child.stderr||'');
 if(child.error) throw child.error;
 assert.equal(child.status,0,output);
 assert.doesNotMatch(output,/SCRIPT ERROR:|\bERROR:/,output);
 must(output,/DIRECTOR_NATIVE_WINDOW_RESULT /,'native window probe did not finish');
 const line=output.match(/DIRECTOR_NATIVE_WINDOW_RESULT (.*)/)[1];
 const result=JSON.parse(line);
 assert.equal(result.shared_world,true);
 assert.deepEqual(result.second_view_image,[640,360]);
 assert.ok(result.sampled_colors>1,'second window did not show scene content');
 console.log('DIRECTOR_NATIVE_WINDOW_RESULT '+line);
 console.log('DIRECTOR_PROBE_WALL_SECONDS '+((performance.now()-started)/1000).toFixed(3));
}
