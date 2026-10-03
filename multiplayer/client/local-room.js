// Explicit single-device transport. Uses the same WorldSession, authority, saves,
// inputs and renderer; never opens a WebSocket, WebRTC peer or public room.
export class LocalRoomConnection extends EventTarget {
 constructor(){super();this.local=true;this.epoch=1;this.peers=new Map();this.roster=new Map();this.checkpointRevision=-1;}
 connect({name='Wanderer',role='hero',save}={}){
  this.hostId=save?.checkpoint?.players?.[0]?.id||'solo-player';
  const peer={id:this.hostId,peerId:this.hostId,name,role,online:true,desktop:true};
  this.roster.set(this.hostId,peer);
  this.dispatchEvent(new CustomEvent('welcome',{detail:{...peer,room:'SOLO',hostId:this.hostId,peers:[peer],local:true}}));
  this.dispatchEvent(new CustomEvent('status',{detail:{state:'hosting',local:true}}));
 }
 close(){this.roster.clear();this.peers.clear();}
 send(){return false;}
 broadcast(){return 0;}
 setCheckpoint(_state,revision){this.checkpointRevision=revision;}
}
