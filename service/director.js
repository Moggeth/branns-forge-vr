'use strict';
const crypto=require('node:crypto');

const CARDS=Object.freeze({
  skeletons:{name:'Bone patrol',cost:3,count:2,cooldown:5},
  wisps:{name:'Wandering lights',cost:2,count:2,cooldown:4},
  golem:{name:'Stone sentinel',cost:5,count:1,cooldown:9},
  gloom:{name:'Dusk veil',cost:4,count:0,cooldown:18}
});
const LANES=['west','north','east'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);

class Director {
  constructor(log=()=>{},now=()=>Date.now()) {this.log=log;this.now=now;this.reset();}
  reset(){
    this.sessionId='';this.phase='offline';this.commands=[];this.serial=0;this.ack=0;
    this.game={};this.gameAt=0;this.budget=8;this.budgetAt=this.now();
    this.cooldowns={};this.round=0;
    this.frame=null;this.frameSequence=0;this.frameAt=0;this.viewerAt=0;
    this.view={yaw:0.64,pitch:0.84,zoom:39};
  }
  start(){
    this.reset();this.sessionId=crypto.randomUUID();this.phase='waiting';this.round=1;
    this.log('DIRECTOR_SESSION',this.sessionId);
    return this.state();
  }
  replenish(){
    const at=this.now(),elapsed=Math.max(0,Math.min(30,(at-this.budgetAt)/1000));
    this.budget=Math.min(10,this.budget+elapsed*0.55);this.budgetAt=at;
  }
  state(){
    this.replenish();
    return {sessionId:this.sessionId,phase:this.phase,round:this.round,budget:Math.floor(this.budget*10)/10,maxBudget:10,budgetRate:0.55,
      cards:CARDS,lanes:LANES,cooldowns:this.cooldowns,game:this.game,
      gameConnected:this.gameAt>0&&this.now()-this.gameAt<3000,pending:this.commands.filter(c=>c.id>this.ack).length,
      frameSequence:this.frameSequence,frameAt:this.frameAt,view:this.view};
  }
  snapshot(body){
    if(body.sessionId!==this.sessionId||!this.sessionId)throw Error('Stale director session.');
    if(!body.game||typeof body.game!=='object'||Array.isArray(body.game))throw Error('Invalid game snapshot.');
    const g=body.game;
    if(!['waiting','running','adventurer_win','director_win'].includes(g.phase)||!finite(g.secondsLeft)||!finite(g.health)||!finite(g.defeated))throw Error('Invalid game state.');
    if(!Array.isArray(g.enemies)||g.enemies.length>32||!Array.isArray(g.beacons)||g.beacons.length!==3||!finite(g.incoming)||g.incoming<0||g.incoming>18)throw Error('Invalid tabletop entities.');
    this.ack=Math.max(this.ack,Math.min(this.serial,Number.isInteger(body.ack)?body.ack:this.ack));
    this.commands=this.commands.filter(c=>c.id>this.ack);
    this.game=g;this.gameAt=this.now();this.phase=g.phase;
    return {ok:true,ack:this.ack};
  }
  poll(body){
    if(body.sessionId!==this.sessionId||!this.sessionId)throw Error('Stale director session.');
    return {commands:this.commands.filter(c=>c.id>this.ack),phase:this.phase,viewerConnected:this.now()-this.viewerAt<2500,view:this.view};
  }
  camera(body){
    if(body.sessionId!==this.sessionId||!this.sessionId)throw Error('Stale director session.');
    const {yaw,pitch,zoom}=body;
    if(!finite(yaw)||!finite(pitch)||!finite(zoom))throw Error('Invalid camera view.');
    this.view={yaw:Math.max(-Math.PI*4,Math.min(Math.PI*4,yaw)),pitch:Math.max(0.38,Math.min(1.25,pitch)),zoom:Math.max(25,Math.min(65,zoom))};
    return {ok:true,view:this.view};
  }
  acceptFrame(sessionId,bytes){
    if(sessionId!==this.sessionId||!this.sessionId)throw Error('Stale director session.');
    if(!Buffer.isBuffer(bytes)||bytes.length<256||bytes.length>1500000||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)throw Error('Invalid director JPEG frame.');
    this.frame=bytes;this.frameSequence++;this.frameAt=this.now();
    return {ok:true,sequence:this.frameSequence};
  }
  command(body){
    this.replenish();
    if(!this.sessionId||this.now()-this.gameAt>3000)throw Error('The Godot match is not connected.');
    if(body.sessionId!==this.sessionId)throw Error('Reconnect to the current match.');
    const type=String(body.type||'');
    if(type==='start'&&this.phase==='waiting'){
      return this.enqueue(type,'');
    }
    if(type==='rematch'&&['adventurer_win','director_win'].includes(this.phase)){
      this.round++;this.budget=8;this.cooldowns={};return this.enqueue(type,'');
    }
    if(this.phase!=='running')throw Error('Begin the round before playing a card.');
    const card=CARDS[type],lane=String(body.lane||'');
    if(!card||!LANES.includes(lane))throw Error('Select a valid card and approach.');
    if(this.now()<Number(this.cooldowns[type]||0))throw Error(card.name+' is cooling down.');
    if(this.budget<card.cost)throw Error('Not enough sparks yet.');
    const live=this.game.enemies.filter(e=>e&&e.alive).length+this.game.incoming;
    const queued=this.commands.filter(c=>c.id>this.ack).reduce((n,c)=>n+(CARDS[c.type]?.count||0),0);
    if(card.count&&live+queued+card.count>9)throw Error('Too many enemies on the field.');
    this.budget-=card.cost;this.cooldowns[type]=this.now()+card.cooldown*1000;
    return this.enqueue(type,lane);
  }
  enqueue(type,lane){
    const item={id:++this.serial,type,lane};this.commands.push(item);
    this.log('DIRECTOR_COMMAND',item);
    return {ok:true,command:item,state:this.state()};
  }
}
module.exports={Director,CARDS,LANES};
