'use strict';
const $=id=>document.getElementById(id);let itemSignature='';const requestedRefinement=new URLSearchParams(location.search).get('refine');let refinementApplied=false;let config,pc,stream,session,heartbeat,timeout,busy=false,generation=0,wasDesired=false,lastRevision=-1,latest,manualStop=false;
let speechMeter=null,speechPending=null,speechSending=false;
const managedAudio=new URLSearchParams(location.search).get('managed')==='1';
let clientMessage='Audio helper ready.',retryAt=0,clientPhase='idle';
function reportSpeech(level,active){
  speechPending={level:Math.max(0,Math.min(1,Number(level)||0)),active:!!active};
  if(speechSending)return;
  speechSending=true;
  (async()=>{try{while(speechPending){const body=speechPending;speechPending=null;try{await api('/api/vr/speech',body,true);}catch{/* Animation may fail independently of voice playback. */}}}finally{speechSending=false;}})();
}
function stopSpeech(){
  const prior=speechMeter;speechMeter=null;
  if(prior){
    clearInterval(prior.timer);
    prior.audio.removeEventListener?.('playing',prior.resume);
    prior.audio.removeEventListener?.('pause',prior.silence);
    prior.audio.removeEventListener?.('ended',prior.silence);
    prior.track.removeEventListener?.('ended',prior.ended);
    for(const node of [prior.source,prior.analyser,prior.sink]){try{node?.disconnect();}catch{}}
    try{prior.context.close()?.catch(()=>{});}catch{}
  }
  // The zero is serialized behind any in-flight level update, so old audio
  // cannot arrive after the stop reset and leave Brann's mouth open.
  reportSpeech(0,false);
}
function watchRemoteSpeech(remote,track){
  if(speechMeter)stopSpeech();
  const AudioContextType=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioContextType)return;
  const audio=$('audio');let context,source,analyser,sink;
  try{
    context=new AudioContextType();
    source=context.createMediaStreamSource(remote);
    analyser=context.createAnalyser();analyser.fftSize=512;
    sink=context.createGain();sink.gain.value=0;
    source.connect(analyser);analyser.connect(sink);sink.connect(context.destination);
    const samples=new Float32Array(analyser.fftSize);
    const meter={context,source,analyser,sink,audio,track,level:0,timer:null};
    meter.resume=()=>{if(speechMeter===meter)try{context.resume()?.catch(()=>{});}catch{}};
    meter.silence=()=>{if(speechMeter===meter){meter.level=0;reportSpeech(0,false);}};
    meter.ended=()=>{if(speechMeter===meter)stopSpeech();};
    speechMeter=meter;
    audio.addEventListener?.('playing',meter.resume);
    audio.addEventListener?.('pause',meter.silence);
    audio.addEventListener?.('ended',meter.silence);
    track.addEventListener?.('ended',meter.ended);
    meter.timer=setInterval(()=>{
      if(speechMeter!==meter)return;
      if(context.state!=='running'||audio.paused===true||audio.muted===true||audio.volume===0||track.readyState==='ended'){meter.silence();return;}
      try{
        analyser.getFloatTimeDomainData(samples);
        let power=0;for(const sample of samples)power+=sample*sample;
        const rms=Math.sqrt(power/samples.length);
        const target=rms<0.005?0:Math.min(1,rms*7);
        meter.level=target>meter.level?meter.level*0.2+target*0.8:meter.level*0.55+target*0.45;
        if(meter.level<0.02)meter.level=0;
        reportSpeech(Math.round(meter.level*1000)/1000,meter.level>0);
      }catch{meter.silence();}
    },100);
    meter.resume();
  }catch{
    for(const node of [source,analyser,sink]){try{node?.disconnect();}catch{}}
    try{context?.close()?.catch(()=>{});}catch{}
    reportSpeech(0,false);
  }
}
function status(text){clientPhase=text.includes("listening")?"listening":text.includes("Opening")?"opening":text.includes("Connecting")||text.includes("getting ready")?"connecting":(/error|failed|retry|disconnected/i.test(text)?"error":"idle");if(managedAudio)text=text.replaceAll('Press Talk / retry.','Point at Brann and press trigger to retry.').replaceAll('Press Talk to continue.','Point at Brann and press trigger to continue.').replaceAll('or press Talk.','or point at him and press trigger.');$('status').textContent=text;clientMessage=text;}
async function api(url,body,keepalive=false){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(managedAudio?{'x-brann-audio-managed':'1'}:{}),...(config?{'x-forge-token':config.token}:{})},body:body===undefined?undefined:JSON.stringify(body),keepalive});if(r.status===204)return {};const data=await r.json();if(!r.ok){const error=Error(data.error||`Request failed (${r.status})`);error.status=r.status;throw error;}return data;}
function reportTranscriptEvent(event){if(!session||!['conversation.item.input_audio_transcription.completed','input_audio_transcription.completed'].includes(event?.type)||typeof event.transcript!=='string'||!event.transcript.trim())return;const safe={type:event.type,item_id:event.item_id||event.event_id,transcript:event.transcript};api(`/api/forge/session/${encodeURIComponent(session)}/transcript`,{event:safe}).catch(()=>{});}
async function stop(message='Conversation ended. Your commissions continue.'){generation++;busy=false;clearInterval(heartbeat);clearTimeout(timeout);stopSpeech();const prior=session;session=null;pc?.close();pc=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('audio').srcObject=null;if(prior)api(`/api/forge/session/${encodeURIComponent(prior)}/close`,{},true).catch(()=>{});status(message);}
async function start(){if(busy||pc)return;if(!config?.configured){status('No API key is configured. Restart the service with your authorized personal API setup.');return;}manualStop=false;busy=true;const attempt=++generation;status('Opening the headset microphone…');try{
stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:$('mic').value?{exact:$('mic').value}:undefined,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(attempt!==generation){stream.getTracks().forEach(t=>t.stop());stream=null;return;}
const connection=new RTCPeerConnection();pc=connection;stream.getAudioTracks().forEach(t=>connection.addTrack(t,stream));connection.ontrack=e=>{if(connection!==pc||e.track.kind==='video')return;const remote=new MediaStream([e.track]);$('audio').srcObject=remote;watchRemoteSpeech(remote,e.track);$('audio').play().catch(()=>{reportSpeech(0,false);status('Press Play in the audio controls to hear Brann.');});};
const events=connection.createDataChannel('oai-events');events.onmessage=({data})=>{if(connection!==pc)return;try{const e=JSON.parse(data);reportTranscriptEvent(e);if(e.type==='session.started'){busy=false;status('Brann is listening. Speak naturally.');}if(e.type==='session.closed'){manualStop=true;stop();}if(e.type==='error')status('Voice error: '+(e.error?.message||e.error?.code||'unknown'));}catch{}};
connection.onconnectionstatechange=()=>{if(connection===pc&&['failed','disconnected'].includes(connection.connectionState)){manualStop=true;stop('Voice disconnected. Press Talk / retry.');}};
await connection.setLocalDescription(await connection.createOffer());if(connection.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Microphone connection timed out.')),10000);connection.addEventListener('icegatheringstatechange',()=>{if(connection.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
if(attempt!==generation)return;const answer=await api('/api/forge/session',{sdp:connection.localDescription.sdp,voice:$('voice').value,model:'gpt-5.6-terra'});if(attempt!==generation){api(`/api/forge/session/${encodeURIComponent(answer.session.id)}/close`,{}).catch(()=>{});return;}
session=answer.session.id;await connection.setRemoteDescription({type:'answer',sdp:answer.transport.sdp});heartbeat=setInterval(()=>api(`/api/forge/session/${encodeURIComponent(session)}/heartbeat`,{}).catch(()=>stop('Voice connection ended. Retry when ready.')),5000);timeout=setTimeout(()=>{manualStop=true;stop('Three-minute conversation ended. Press Talk to continue.');},175000);status('Connecting to Brann…');
}catch(e){if(attempt===generation){const retryable=managedAudio&&(e.status===429||e.status>=500);manualStop=!retryable;stop(retryable?'Brann is getting ready; retrying shortly.':e.message+' Point at Brann and press trigger to retry.');retryAt=retryable?Date.now()+11000:0;}}finally{if(attempt===generation)busy=false;}}
function renderInventions(items){
const signature=JSON.stringify(items);if(signature===itemSignature)return;itemSignature=signature;
const selected=$('baseItem').value;$('baseItem').replaceChildren(new Option('Create a new invention',''),...items.map(i=>new Option(i.name+' · version '+(i.version||1),i.id)));if(items.some(i=>i.id===selected))$('baseItem').value=selected;
const cards=items.slice().reverse().map(i=>{const card=document.createElement('article');const title=document.createElement('h3');title.textContent=i.name+' · version '+(i.version||1);card.append(title);
for(const [label,value] of [['Requested function',i.requestedFunction||i.description],['Brann’s extra',i.extraFunction||'No additional effect documented.'],['How to use',i.useInstructions||'Grip to equip; press trigger to activate.']]){const p=document.createElement('p');p.textContent=label+': '+value;card.append(p);}
if(i.previousItemId){const prior=items.find(p=>p.id===i.previousItemId);const p=document.createElement('small');p.textContent='Previous version retained: '+(prior?.name||i.previousItemId)+'. Both remain on your rack.';card.append(p);}
const button=document.createElement('button');button.textContent='Refine this version';button.onclick=()=>{$('baseItem').value=i.id;$('brief').focus();};card.append(button);return card;});
$('inventions').replaceChildren(...cards);if(requestedRefinement&&!refinementApplied){const chosen=items.find(i=>i.id===requestedRefinement);if(chosen){refinementApplied=true;$('baseItem').value=chosen.id;$('refineHelp').textContent='Refining '+chosen.name+'. Type the changes below and press Forge with Astra, or tell Brann which item and changes you want using Talk. Your previous version stays available.';$('brief').focus();}}if(!cards.length)$('inventions').textContent='Completed inventions will appear here and on your in-game rack.';
}
async function poll(){try{latest=await api('/api/vr/state');renderInventions(latest.items||[]);$('bounty').textContent=`Workshop tier ${latest.tier||1} · ${latest.favours} legacy favours`;$('jobs').textContent=latest.jobs.map(j=>`${j.status}: ${j.stage}`).join('\n');$('commission').disabled=((latest.tier||1)<2&&latest.favours<1)||!latest.visiting;
const revised=latest.voice.revision!==lastRevision;
if(revised){lastRevision=latest.voice.revision;$('voice').value=latest.voice.voice;manualStop=false;}
const superseded=!managedAudio&&latest.voiceClient?.managed; if(superseded&&(pc||busy))stop('Voice is handled inside the game.'); const desired=!superseded&&latest.visiting&&latest.voice.enabled;if(desired&&(!wasDesired||revised||(retryAt&&Date.now()>=retryAt))&&!manualStop){retryAt=0;start();}if(!desired&&wasDesired)stop();wasDesired=desired; if(managedAudio)await api('/api/vr/voice-client',{managed:true,message:clientMessage,phase:clientPhase});
}catch(e){if(pc||busy)stop('Workshop disconnected; microphone stopped.');wasDesired=false;status(e.message);}}
$('talk').onclick=start;$('stop').onclick=()=>{manualStop=true;stop();api('/api/vr/voice',{enabled:false,voice:$('voice').value}).catch(()=>{});};
$('voice').onchange=()=>api('/api/vr/voice',{enabled:latest?.voice.enabled??true,voice:$('voice').value}).catch(e=>status(e.message));
$('devices').onclick=async()=>{try{const grant=await navigator.mediaDevices.getUserMedia({audio:true});grant.getTracks().forEach(t=>t.stop());const devices=await navigator.mediaDevices.enumerateDevices();$('mic').replaceChildren(new Option('Windows default microphone',''),...devices.filter(d=>d.kind==='audioinput').map(d=>new Option(d.label,d.deviceId)));status('Select the Vive microphone, then Talk / retry.');}catch(e){status(e.message);}};
$('commission').onclick=async()=>{try{const result=await api('/api/vr/commission',{brief:$('brief').value,baseItemId:$('baseItem').value||null,requestId:crypto.randomUUID()});status(result.stage);poll();}catch(e){status(e.message);}};
addEventListener('pagehide',()=>stop());
api('/api/forge/config').then(c=>{config=c;$('voice').replaceChildren(...c.voices.map(v=>new Option(v[0].toUpperCase()+v.slice(1),v)));status('Ready. Visit Brann in the game, or press Talk.');poll();setInterval(poll,1000);}).catch(e=>status(e.message));

