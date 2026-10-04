import assert from 'node:assert/strict';
import {bowShotFromAim,forecastTrajectory} from '../client/ranged-trajectory.js';
import {createWeaponController} from '../client/weapon-controller.js';
const began=performance.now(), base=[0,0,-1];
let previous=-Infinity;
for(let i=-100;i<=100;i++){
 const angle=i*.0005, direction=[-Math.sin(angle),0,-Math.cos(angle)];
 const preview=bowShotFromAim(direction,base,1);
 assert.ok(Math.abs(preview.curve[1]-angle)<1e-12,'no dead cone or snap around initial aim');
 assert.ok(preview.curve[1]>previous);previous=preview.curve[1];
 let aim={origin:[0,2,0],direction:base},shot;
 const controller=createWeaponController({getTool:()=> 'bow',getAim:()=>aim,clock:()=>850,fire:s=>shot=s,special:()=>{}});
 controller.begin();controller.special();aim={...aim,direction};controller.end();
 assert.deepEqual(shot.curve,preview.curve);assert.deepEqual(shot.direction,preview.direction);
 const points=new Float32Array(183);forecastTrajectory({origin:aim.origin,velocity:preview.direction.map(v=>v*preview.speed),curve:preview.curve,out:points,maxTicks:60,sampleEvery:1});
 if(angle)assert.equal(Math.sign(points[180]),-Math.sign(angle),'small aim motion actually changes flight');
}
for(const direction of [[0,0,-1],[0,0,1],[1,0,0],[0,1,0]]){
 const s=bowShotFromAim(direction,base,1);assert.ok([...s.direction,...s.curve].every(Number.isFinite));assert.ok(Math.hypot(...s.curve)<=1.1+1e-12);
}
console.log(`phoenix-aim-continuity: 201 near-zero preview/release/flight samples pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
