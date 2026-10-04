// Network-only controller. Fetch only while the browser is open and visible;
// cancel on close, reject stale responses, retain the last successful page on failure.
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';
export function directoryURL(endpoint) {
  const url=new URL(endpoint);
  if (!['ws:','wss:'].includes(url.protocol) || url.pathname!=='/peer/cloud') return null;
  url.protocol=url.protocol==='wss:'?'https:':'http:';url.pathname='/peer/rooms';url.search='';url.hash='';return url;
}
export function createRoomDirectory({endpoint,onChange,fetcher=fetch,visible=()=>!document.hidden,interval=15000}) {
  let opened=false,disposed=false,timer=null,controller=null,generation=0;
  let state={rooms:[],loading:false,error:'',nextCursor:null};
  const emit=()=>onChange({...state});
  function stop(){clearTimeout(timer);timer=null;controller?.abort();controller=null;generation++;}
  function schedule(){clearTimeout(timer);if(opened&&!disposed)timer=setTimeout(()=>{if(visible())refresh();else schedule();},interval);}
  async function refresh(more=false) {
    if(!opened||disposed)return;
    stop();const current=++generation;
    let url;try{url=directoryURL(typeof endpoint==='function'?endpoint():endpoint);}catch{}
    if(!url){state={...state,loading:false,error:'Public worlds need the cloud room service. You can still join a friend by code.'};emit();return;}
    if(more&&state.nextCursor)url.searchParams.set('cursor',state.nextCursor);
    controller=new AbortController();const abort=controller;
    const deadline=setTimeout(()=>abort.abort(),8000);
    state={...state,loading:true,error:''};emit();
    try {
      const response=await fetcher(url,{signal:abort.signal,cache:'no-store',credentials:'omit'});
      if(!response.ok)throw Error(response.status===429?'Too many refreshes. Wait a minute, then try again.':'World list unavailable. Check your connection and refresh; joining by code still works.');
      const result=await response.json();
      if(!Array.isArray(result.rooms)||result.rooms.length>50)throw Error('The world list could not be read. Refresh to try again.');
      const rooms=result.rooms.filter(r=>r && /^\d{8}$/.test(r.code)&&typeof r.hostName==='string'&&Array.isArray(r.players)&&r.players.length<=MAX_PLAYERS&&Number.isInteger(r.count)&&r.count>=1&&r.count<=MAX_PLAYERS&&Number.isInteger(r.maxPlayers)&&r.maxPlayers>=r.count&&r.maxPlayers<=MAX_PLAYERS);
      if(current!==generation)return;
      state={rooms:more?[...new Map([...state.rooms,...rooms].map(r=>[r.code,r])).values()]:rooms,loading:false,error:'',nextCursor:/^room:\d{8}$/.test(result.nextCursor)?result.nextCursor:null};
    } catch(error) {
      if(current!==generation)return;
      state={...state,loading:false,error:abort.signal.aborted?'The world list timed out. Check your connection and refresh.':error.message};
    } finally {
      clearTimeout(deadline);
      if(current===generation){controller=null;emit();schedule();}
    }
  }
  return {open(){if(disposed)return;opened=true;return refresh();},close(){opened=false;stop();state={...state,loading:false};},refresh,more(){return refresh(true);},
    dispose(){disposed=true;opened=false;stop();},get state(){return {...state};}};
}
