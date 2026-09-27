'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {NORMAL_ORIGIN,voicePage,permissionAllowed}=require('./policy.cjs');
const base={permission:'media',url:NORMAL_ORIGIN+'/voice/?managed=1',isMainFrame:true,mediaTypes:['audio']};
test('only exact loopback voice page gets microphone access',()=>{
  assert.equal(permissionAllowed(base),true);
  for(const url of ['https://127.0.0.1:8787/voice/','http://localhost:8787/voice/','http://127.0.0.1:8788/voice/','http://127.0.0.1:8787.evil.test/voice/','http://user:pass@127.0.0.1:8787/voice/','file:///voice/','http://127.0.0.1:8787/other','http://127.0.0.1:8787/voice/other'])assert.equal(permissionAllowed({...base,url}),false,url);
  assert.equal(voicePage(NORMAL_ORIGIN+'/voice?managed=1'),true);
});
test('video, mixed capture, unknown media, subframes and other permissions are denied',()=>{
  for(const mediaTypes of [[],['video'],['audio','video'],['unknown'],undefined])assert.equal(permissionAllowed({...base,mediaTypes}),false);
  for(const permission of ['display-capture','geolocation','notifications','clipboard-read','speaker-selection','usb','unknown'])assert.equal(permissionAllowed({...base,permission}),false);
  assert.equal(permissionAllowed({...base,isMainFrame:false}),false);assert.equal(permissionAllowed({...base,isMainFrame:undefined}),false);
});
