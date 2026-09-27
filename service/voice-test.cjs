const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('voice visit lifecycle and in-game retry use mocked transport only',async()=>{
let current={tails:0,favours:0,jobs:[],visiting:false,voice:{enabled:true,voice:'vesper',revision:0}},microphones=0,closed=0,stopped=0;const speechReports=[];
const elements={};const element=id=>elements[id]??=( {value:'',textContent:'',disabled:false,replaceChildren(...children){this.value=children[0]?.value||'';},play:async()=>{},srcObject:null});
const context=vm.createContext({console,URLSearchParams,location:{search:''},document:{getElementById:element},Option:function(text,value){this.text=text;this.value=value;},navigator:{mediaDevices:{getUserMedia:async()=>{microphones++;return {getTracks:()=>[{stop:()=>stopped++}],getAudioTracks:()=>[{}]};}}},MediaStream:function(){},RTCPeerConnection:class{constructor(){this.iceGatheringState='complete';}addTrack(){}createDataChannel(){return {};}async createOffer(){return {sdp:'v=0'};}async setLocalDescription(v){this.localDescription=v;}async setRemoteDescription(){}close(){}},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{},addEventListener:()=>{},crypto:{randomUUID:()=> 'test'},fetch:async(url,options)=>{
let result={};if(url==='/api/forge/config')result={configured:true,token:'test',voices:['vesper','stone']};if(url==='/api/vr/state')result=current;if(url==='/api/forge/session')result={session:{id:'mock'},transport:{sdp:'v=0'}};if(url.endsWith('/close'))closed++;if(url==='/api/vr/speech')speechReports.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>result};}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'public/voice.js'),'utf8'),context);
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};await flush();assert.equal(microphones,0);
current={...current,visiting:true};await vm.runInContext('poll()',context);await flush();assert.equal(microphones,1);
current={...current,visiting:false};await vm.runInContext('poll()',context);await flush();assert.equal(closed,1);assert.equal(stopped,1);
current={...current,visiting:true};await vm.runInContext('poll()',context);await flush();assert.equal(microphones,2);
await vm.runInContext('manualStop=true; stop()',context);await flush();
assert.deepEqual(speechReports.at(-1),{level:0,active:false},'stop clears speech without requiring AudioContext');
await vm.runInContext('poll()',context);await flush();assert.equal(microphones,2,'an unchanged voice revision must respect manual stop');
current={...current,voice:{enabled:true,voice:'stone',revision:1}};await vm.runInContext('poll()',context);await flush();assert.equal(microphones,3,'retry revision must restart even without leaving workshop');assert.equal(element('voice').value,'stone');
await vm.runInContext('stop()',context);
});

function speechFixture({blockFirstActive=false,managed=false}={}){
  let testState=null,nextSessionStatus=200;
  const calls=[],intervals=new Map(),sources=[],contexts=[],elements={};let serial=0,amplitude=0.08,releaseActive;
  const node=()=>({value:'',textContent:'',paused:false,muted:false,volume:1,events:new Map(),replaceChildren(...children){this.value=children[0]?.value||'';},play:async()=>{},addEventListener(name,fn){this.events.set(name,fn);},removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}});
  const element=id=>elements[id]??=node();
  const track={kind:'audio',id:'remote-brann',readyState:'live',events:new Map(),addEventListener(name,fn){this.events.set(name,fn);},removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}};
  const microphone={id:'local-microphone',getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{kind:'audio'}]};
  class AudioContextMock{
    constructor(){this.state='running';this.closed=0;this.disconnects=0;this.destination={};contexts.push(this);}
    link(){return {connect(){},disconnect:()=>{this.disconnects++;}};}
    createMediaStreamSource(remote){sources.push(remote);return this.link();}
    createAnalyser(){return {...this.link(),fftSize:512,getFloatTimeDomainData:buffer=>buffer.fill(amplitude)};}
    createGain(){return {...this.link(),gain:{value:1}};}
    async resume(){}
    async close(){this.closed++;this.state='closed';}
  }
  const context=vm.createContext({console,URLSearchParams,location:{search:managed?'?managed=1':''},document:{getElementById:element},Option:function(text,value){this.text=text;this.value=value;},AudioContext:AudioContextMock,MediaStream:function(tracks){this.tracks=tracks;},navigator:{mediaDevices:{getUserMedia:async()=>microphone}},RTCPeerConnection:class{constructor(){this.iceGatheringState='complete';}addTrack(){}createDataChannel(){return {};}async createOffer(){return {sdp:'v=0'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(){}close(){}},setInterval:(fn,ms)=>{const id=++serial;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),setTimeout:()=>99,clearTimeout:()=>{},addEventListener:()=>{},fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url==='/api/vr/state'&&testState)return {ok:true,status:200,json:async()=>testState};
    if(url==='/api/forge/session'&&nextSessionStatus!==200){const status=nextSessionStatus;nextSessionStatus=200;return {ok:false,status,json:async()=>({error:'Please wait before starting another conversation.'})};}
    if(url==='/api/vr/speech'&&body.active&&blockFirstActive){blockFirstActive=false;await new Promise(resolve=>{releaseActive=resolve;});}
    const result=url==='/api/forge/config'?{configured:true,token:'test',voices:['vesper']}:url==='/api/vr/state'?{items:[],tails:0,favours:0,jobs:[],visiting:false,voice:{enabled:true,voice:'vesper',revision:0}}:url==='/api/forge/session'?{session:{id:'mock'},transport:{sdp:'v=0'}}:{};
    return {ok:true,status:200,json:async()=>result};
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/voice.js'),'utf8'),context);
  const flush=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
  return {context,calls,intervals,sources,contexts,element,track,microphone,flush,setState:value=>{testState=value;},failSession:status=>{nextSessionStatus=status;},setAmplitude:value=>{amplitude=value;},releaseActive:()=>releaseActive?.(),sample:()=>{for(const timer of intervals.values())if(timer.ms===100)timer.fn();}};
}

test('managed audio starts from native state and retries cooldown without a browser click',async()=>{
 const f=speechFixture({managed:true});await f.flush();
 assert.ok(f.calls.some(c=>c.url==='/api/vr/voice-client'&&c.body.managed));
 f.setState({items:[],favours:0,jobs:[],visiting:true,voice:{enabled:true,voice:'vesper',revision:1}});
 f.failSession(429);
 await vm.runInContext('poll()',f.context);await f.flush();
 assert.equal(vm.runInContext('manualStop',f.context),false);
 assert.ok(vm.runInContext('retryAt',f.context)>0);
 vm.runInContext('retryAt=Date.now()-1',f.context);
 await vm.runInContext('poll()',f.context);await f.flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/forge/session').length,2);
 assert.equal(vm.runInContext('session',f.context),'mock');
 await vm.runInContext('manualStop=true;stop()',f.context);
 await vm.runInContext('poll()',f.context);await f.flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/forge/session').length,2);
});

test('ordinary browser yields to the managed game audio helper',async()=>{
 const f=speechFixture();await f.flush();
 f.setState({items:[],favours:0,jobs:[],visiting:true,voice:{enabled:true,voice:'vesper',revision:1},voiceClient:{managed:true}});
 await vm.runInContext('poll()',f.context);await f.flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/forge/session').length,0);
});

test('speech animation meters only remote playback and releases audio resources on stop',async()=>{
  const f=speechFixture();await f.flush();
  await vm.runInContext('start()',f.context);await f.flush();
  assert.equal(f.sources.length,0,'microphone acquisition must not create a speech analyser');
  f.context.remoteTrack=f.track;vm.runInContext('pc.ontrack({track:remoteTrack})',f.context);await f.flush();
  assert.equal(f.sources.length,1);assert.equal(f.sources[0].tracks[0],f.track);assert.notEqual(f.sources[0],f.microphone);
  f.sample();await f.flush();
  const active=f.calls.filter(call=>call.url==='/api/vr/speech').at(-1).body;
  assert.equal(active.active,true);assert.ok(active.level>0&&active.level<=1,'RMS maps to bounded speech level');
  f.element('audio').muted=true;f.sample();await f.flush();
  assert.deepEqual(f.calls.filter(call=>call.url==='/api/vr/speech').at(-1).body,{level:0,active:false},'muted playback does not animate Brann');
  f.element('audio').muted=false;f.setAmplitude(0);for(let i=0;i<8;i++)f.sample();await f.flush();
  assert.deepEqual(f.calls.filter(call=>call.url==='/api/vr/speech').at(-1).body,{level:0,active:false},'silent remote audio closes the mouth');
  await vm.runInContext('stop()',f.context);await f.flush();
  assert.equal(f.contexts[0].closed,1);assert.equal(f.contexts[0].disconnects,3);
  assert.ok([...f.intervals.values()].every(timer=>timer.ms!==100),'speech sampling interval is removed');
  assert.equal(f.element('audio').events.size,0);assert.equal(f.track.events.size,0);
  assert.deepEqual(f.calls.filter(call=>call.url==='/api/vr/speech').at(-1).body,{level:0,active:false});
});

test('disconnect zero follows an in-flight speech level and replacement tracks close prior contexts',async()=>{
  const f=speechFixture({blockFirstActive:true});await f.flush();await vm.runInContext('start()',f.context);await f.flush();
  f.context.remoteTrack=f.track;vm.runInContext('pc.ontrack({track:remoteTrack})',f.context);await f.flush();f.sample();await f.flush();
  vm.runInContext("pc.connectionState='disconnected';pc.onconnectionstatechange()",f.context);await f.flush();
  assert.equal(f.contexts[0].closed,1);
  f.releaseActive();await f.flush();
  const reports=f.calls.filter(call=>call.url==='/api/vr/speech');assert.equal(reports[0].body.active,true);assert.deepEqual(reports.at(-1).body,{level:0,active:false},'stop reset must be delivered after the earlier active sample');
  await vm.runInContext('start()',f.context);await f.flush();
  vm.runInContext('pc.ontrack({track:remoteTrack});pc.ontrack({track:remoteTrack})',f.context);await f.flush();
  assert.equal(f.contexts.length,3);assert.equal(f.contexts[1].closed,1,'a replaced remote stream closes its analyser context');
  assert.equal([...f.intervals.values()].filter(timer=>timer.ms===100).length,1);
  await vm.runInContext('stop()',f.context);await f.flush();assert.equal(f.contexts[2].closed,1);
});


test('refinement URL waits for completed item, preselects once and never submits',async()=>{
const selected='00000000-0000-4000-8000-000000000007';let items=[],posts=0,focuses=0;
const elements={};const node=()=>({value:'',textContent:'',children:[],replaceChildren(...children){this.children=children;this.value=children[0]?.value||'';},append(...children){this.children.push(...children);},focus(){focuses++;},play:async()=>{}});const element=id=>elements[id]??=node();
const context=vm.createContext({console,URLSearchParams,location:{search:'?refine='+selected},document:{getElementById:element,createElement:node},Option:function(text,value){this.text=text;this.value=value;},setInterval:()=>1,addEventListener:()=>{},fetch:async(url,options)=>{if(options.method==='POST')posts++;const result=url==='/api/forge/config'?{configured:false,token:'test',voices:['vesper']}:{items,tails:0,favours:0,jobs:[],visiting:false,voice:{enabled:false,voice:'vesper',revision:0}};return {ok:true,status:200,json:async()=>result};}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'public/voice.js'),'utf8'),context);for(let i=0;i<5;i++)await new Promise(setImmediate);
assert.equal(element('baseItem').value,'');assert.equal(posts,0);
items=[{id:selected,name:'Hearthbell',version:1,description:'Ringing hammer.'}];await vm.runInContext('poll()',context);
assert.equal(element('baseItem').value,selected);assert.match(element('refineHelp').textContent,/Refining Hearthbell/);assert.equal(focuses,1);assert.equal(posts,0,'opening refine must not start generation or paid voice');
element('baseItem').value='';items=[...items,{id:'another',name:'Second tool',version:1,description:'Other.'}];await vm.runInContext('poll()',context);assert.equal(element('baseItem').value,'','subsequent polling must preserve player selection');assert.equal(focuses,1);assert.equal(posts,0);
});

test('voice helper forwards completed transcript text only, never raw audio or partial speech',async()=>{const f=speechFixture();await f.flush();vm.runInContext("session='mock'; reportTranscriptEvent({type:'response.audio.delta',delta:'private-audio'}); reportTranscriptEvent({type:'conversation.item.input_audio_transcription.delta',delta:'partial'}); reportTranscriptEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'utterance-1',transcript:'Make a moon lantern',audio:'must-not-forward'});",f.context);await f.flush();const sent=f.calls.filter(c=>c.url.endsWith('/transcript'));assert.equal(sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(sent[0].body)),{event:{type:'conversation.item.input_audio_transcription.completed',item_id:'utterance-1',transcript:'Make a moon lantern'}});});
