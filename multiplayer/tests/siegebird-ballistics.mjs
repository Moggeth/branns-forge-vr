import assert from 'node:assert/strict';
import {solveSiegebirdBallistics,sampleSiegebirdTrajectory,SIEGEBIRD_BALLISTICS} from '../client/siegebird-ballistics.js';
import {combatAction,stepCombat} from '../shared/combat.js';
const began=performance.now();
const yaw=Math.PI/4;
const rotateY=([x,y,z],a)=>[Math.cos(a)*x+Math.sin(a)*z,y,-Math.sin(a)*x+Math.cos(a)*z];
const rotateX=([x,y,z],a)=>[x,Math.cos(a)*y-Math.sin(a)*z,Math.sin(a)*y+Math.cos(a)*z];
function runtimeCross(muzzle,direction,range,pitch=0){
  const toWorld=v=>rotateY(rotateX(v,pitch),yaw),toLocal=v=>rotateX(rotateY(v,-yaw),-pitch);
  const player={id:'hero',position:[0,0,0],tool:'crossbow',attackTick:-1000};
  const state={tick:0,players:[player],projectiles:[],detachedParts:[],enemies:[]};
  const context={terrainHeight:()=>-200,nextId:()=> 'shot'};
  const fire=combatAction(state,player,{action:'fire',origin:toWorld(muzzle),direction:toWorld(direction)},context);
  assert.equal(fire.ok,true);assert.ok(Math.abs(Math.hypot(...state.projectiles[0].velocity)-42)<1e-9);
  let previous=[...muzzle];
  for(let tick=1;tick<480;tick++){
    state.tick=tick;stepCombat(state,context,[]);
    assert.equal(state.projectiles.length,1,'fixture remains inside actual world bounds');
    const position=toLocal(state.projectiles[0].position);
    if(position[2]<=-range){const fraction=(-range-previous[2])/(position[2]-previous[2]);return previous.map((n,i)=>n+(position[i]-n)*fraction);}
    previous=position;
  }
  assert.fail('actual shot never reached target plane');
}
for(const muzzle of [[.35,-.25,-.8],[-.35,-.25,-.8],[0,0,0],[.12,.15,-1.1]])for(const pitch of [0,.35,-.35]){
  const gravity=[0,-3*Math.cos(pitch),3*Math.sin(pitch)];
  const solved=solveSiegebirdBallistics({muzzle,gravity});assert.equal(solved.valid,true);
  assert.ok(Math.abs(Math.hypot(...solved.direction)-1)<1e-12);
  const actual=runtimeCross(muzzle,solved.direction,30,pitch);
  assert.ok(Math.hypot(actual[0],actual[1],actual[2]+30)<.03,`30m zero from ${muzzle} at pitch ${pitch}`);
  for(const mark of solved.holdovers){
    const actual=runtimeCross(muzzle,solved.direction,mark.range,pitch);
    assert.ok(Math.hypot(...actual.map((n,i)=>n-mark.position[i]))<1e-8,'holdover matches actual fixed-step physics');
    assert.ok(mark.verticalAngle>0,'aim-up holdover compensates drop beyond zero');
    assert.ok(mark.verticalAngle<.15,'holdover stays useful rather than becoming a lob');
    assert.ok(Math.abs(mark.horizontalAngle)<.04,'sideways parallax correction remains subtle');
  }
  assert.ok(solved.holdovers[1].verticalAngle>solved.holdovers[0].verticalAngle,'70m needs more holdover than 50m');
}
for(const distance of [10,20,40]){
  const muzzle=[.3,-.15,-.7],solved=solveSiegebirdBallistics({muzzle,zeroDistance:distance});
  assert.equal(solved.valid,true);const actual=runtimeCross(muzzle,solved.direction,distance);
  assert.ok(Math.hypot(actual[0],actual[1])<.03,'zero distance is configurable');
}
const right=solveSiegebirdBallistics({muzzle:[.35,-.25,-.8]});
assert.ok(right.yaw<0,'right-offset muzzle points slightly left to converge');
assert.ok(right.elevation>0,'low muzzle elevates to reach the sight line');
assert.ok(right.holdovers[0].horizontalAngle>0,'beyond zero, leftward convergence requires slight right hold');
for(const options of [{muzzle:[NaN,0,0]},{zeroDistance:0},{zeroDistance:Infinity},{muzzle:[0,0,-30]},{gravity:[0,Infinity,0]},{muzzle:[1e9,0,0]}]){
  const result=solveSiegebirdBallistics(options);assert.equal(result.valid,false);assert.ok(result.direction.every(Number.isFinite));
}
assert.equal(sampleSiegebirdTrajectory({direction:[0,0,0]}),null);
assert.equal(sampleSiegebirdTrajectory({range:NaN}),null);
assert.deepEqual(SIEGEBIRD_BALLISTICS,{speed:42,gravity:3,drag:.045,dt:1/60});
console.log(`siegebird-ballistics: exact runtime zero/50m/70m, mirrored grips, tilted cameras, configurable zero, invalid input pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
