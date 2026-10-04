// Stonewhisper crystal wall sound (procedural Web Audio, no assets). Driven by crystal-wall.js presentation events, so
// sound lands exactly when each segment visibly cracks open, for every peer, and late joiners hear nothing stale.
//   rise    a low earth groan that rolls out along the wall while the front travels (one voice per cast),
//   bloom   each segment rings a glassy, inharmonic bell on the next note of a rising pentatonic run -> the wave is a
//           little arpeggio; tall segments ring lower and fuller,
//   warn    a soft tremolo shimmer when a wall has 3 s left,
//   break   a bright glass burst + low thump per shattering segment (capped).
// Spatialised with equal-power panners; bounded to MAX_VOICES concurrent sources; all gains ramp (no clicks).
const MAX_VOICES=14,PENTA=[0,2,4,7,9,12,14,16,19,21];
export function createCrystalWallAudio({context,master=.55}={}){
 if(!context)return null;
 const out=context.createGain();out.gain.value=master;out.connect(context.destination);
 let voices=0,noise=null,stats={played:0,culled:0};
 function noiseBuffer(){if(noise)return noise;const n=context.sampleRate*1.5|0,b=context.createBuffer(1,n,context.sampleRate),d=b.getChannelData(0);let s=12345;for(let i=0;i<n;i++){s=(Math.imul(s,1103515245)+12345)|0;d[i]=((s>>>9)/4194304)-1;}return noise=b;}
 function panner(position,listener){const p=context.createPanner();p.panningModel='equalpower';p.distanceModel='inverse';p.refDistance=3;p.maxDistance=60;p.rolloffFactor=1.1;
  const set=(param,v)=>param?param.value=v:null;
  if(p.positionX){set(p.positionX,position[0]);set(p.positionY,position[1]+1);set(p.positionZ,position[2]);}else p.setPosition?.(position[0],position[1]+1,position[2]);
  const l=context.listener;if(listener){if(l.positionX){l.positionX.value=listener.position[0];l.positionY.value=listener.position[1];l.positionZ.value=listener.position[2];l.forwardX.value=listener.forward[0];l.forwardY.value=listener.forward[1];l.forwardZ.value=listener.forward[2];l.upX.value=listener.up[0];l.upY.value=listener.up[1];l.upZ.value=listener.up[2];}else{l.setPosition?.(...listener.position);l.setOrientation?.(...listener.forward,...listener.up);}}
  p.connect(out);return p;}
 function claim(){if(voices>=MAX_VOICES){stats.culled++;return false;}voices++;stats.played++;return true;}
 function release(node,at){node.onended=()=>{voices=Math.max(0,voices-1);};node.stop(at);}
 function env(gain,t,peak,attack,decay){gain.gain.setValueAtTime(0.0001,t);gain.gain.exponentialRampToValueAtTime(peak,t+attack);gain.gain.exponentialRampToValueAtTime(0.0001,t+attack+decay);}
 function bell(position,listener,freq,level,decay){if(!claim())return;const t=context.currentTime,dest=panner(position,listener),bus=context.createGain();bus.gain.value=level;bus.connect(dest);
  // glass/bell partial ratios (slightly inharmonic) with faster decay on upper partials
  const partials=[[1,1],[2.01,.5],[2.76,.42],[5.4,.22],[8.93,.1]];let last=null;
  for(const [r,a] of partials){const o=context.createOscillator(),g=context.createGain();o.type='sine';o.frequency.value=freq*r;env(g,t,a,.004,decay/(1+r*.35));o.connect(g).connect(bus);o.start(t);last=o;o.stop(t+decay+.05);}
  last.onended=()=>{voices=Math.max(0,voices-1);};}
 function rumble(position,listener,seconds,level=.5){if(!claim())return;const t=context.currentTime,dest=panner(position,listener),src=context.createBufferSource(),lp=context.createBiquadFilter(),g=context.createGain(),sub=context.createOscillator(),sg=context.createGain();
  src.buffer=noiseBuffer();src.loop=true;lp.type='lowpass';lp.Q.value=4;lp.frequency.setValueAtTime(70,t);lp.frequency.exponentialRampToValueAtTime(240,t+seconds*.7);lp.frequency.exponentialRampToValueAtTime(90,t+seconds+.4);
  env(g,t,level,.05,seconds+.35);sub.type='sine';sub.frequency.setValueAtTime(42,t);sub.frequency.exponentialRampToValueAtTime(68,t+seconds);env(sg,t,level*.8,.04,seconds+.3);
  src.connect(lp).connect(g).connect(dest);sub.connect(sg).connect(dest);src.start(t);sub.start(t);sub.stop(t+seconds+.5);release(src,t+seconds+.5);}
 function crack(position,listener,level){if(!claim())return;const t=context.currentTime,dest=panner(position,listener),src=context.createBufferSource(),hp=context.createBiquadFilter(),g=context.createGain();
  src.buffer=noiseBuffer();src.playbackRate.value=1.4;hp.type='highpass';hp.frequency.value=2600;env(g,t,level,.002,.22);src.connect(hp).connect(g).connect(dest);src.start(t,Math.random());release(src,t+.3);
  const thump=context.createOscillator(),tg=context.createGain();thump.type='sine';thump.frequency.setValueAtTime(120,t);thump.frequency.exponentialRampToValueAtTime(45,t+.18);env(tg,t,level*.9,.003,.2);thump.connect(tg).connect(dest);thump.start(t);thump.stop(t+.25);}
 function shimmer(position,listener){if(!claim())return;const t=context.currentTime,dest=panner(position,listener),o=context.createOscillator(),g=context.createGain(),lfo=context.createOscillator(),lg=context.createGain();
  o.type='triangle';o.frequency.value=1760;lfo.frequency.value=9;lg.gain.value=.05;lfo.connect(lg).connect(g.gain);env(g,t,.07,.3,2.4);o.connect(g).connect(dest);o.start(t);lfo.start(t);lfo.stop(t+2.8);release(o,t+2.8);}
 return {
  /** pick_burst authority event: one rolling groan per cast. */
  cast(event,listener){if(context.state!=='running'||!event?.path?.length)return;const mid=event.path[Math.floor(event.path.length/2)];rumble(mid,listener,(event.durationTicks||50)/60,.55);},
  /** God's Raise Wall / Sunder spell event: the rolling groan (deeper, longer for the rampart; the chasm opens with a
   * tearing crack and grinds lower). */
  line({kind,position,seconds},listener){if(context.state!=='running'||!position)return;
   if(kind==='sunder'){crack(position,listener,.34);rumble(position,listener,seconds,.62);}else rumble(position,listener,seconds+.3,.7);},
  /** drained crystal-wall presentation events. */
  play(events,listener){if(context.state!=='running'||!events)return;
   for(const e of events.burst){const h=e.height||2.4,note=PENTA[Math.min(PENTA.length-1,e.segment)],freq=520*Math.pow(2,note/12)*(1.15-h/2.4*.25);
    // a chasm's lining rings a fifth lower and darker, under a little stone crack, as it splits open
    if(e.kind==='sunder'){bell(e.position,listener,freq*.67,.09+.04*h/2.4,1.4+h*.2);if(e.segment%2===0)crack(e.position,listener,.16);}
    else bell(e.position,listener,freq,.11+.05*h/2.4,1.6+h*.25);}
   let breaks=0;for(const e of events.shatter){if(breaks++<4)crack(e.position,listener,.28);bell(e.position,listener,1900+Math.random()*900,.05,.6);}
   const warned=new Set();for(const e of events.warn)if(!warned.has(e.wall)){warned.add(e.wall);shimmer(e.position,listener);}},
  stats:()=>({...stats,voices}),
  dispose(){out.disconnect();}};
}
