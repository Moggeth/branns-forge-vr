// The town square (2026-10-23): the stalls stand on the cobbles clear of each other and of the keep, Heroes spawn on
// the square facing the heart, the bakery hands over an apple, the bard plays for everyone, and bodies stay out of the
// stalls. Run: node tests/town-square.mjs
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {homePoint,homeSolids,resolveHomeStructures} from '../shared/home-bases.js';
import {SQUARE,SQUARE_PIECES,squarePiece,squareSpot,squarePoles,squareCover,squareAt,squareSpawnYaw,isSquareAction} from '../shared/town-square.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
let seq=0;const act=(sim,id,action)=>sim.command(id,{type:'action',action,seq:++seq});
const put=(w,p,[x,z])=>{p.position=[x,terrainHeight(w,x,z),z];p.vy=0;};
function rig(){
  const sim=createSimulation({room:'SOLO'});const k=sim.adventureWorld();k.battle.status='running';k.tick=5;
  const l=loadSimulation(k);l.addPlayer({id:'h'});l.step();const w=l.adventureWorld(),hero=w.players.find(p=>p.id==='h');hero.role='hero';hero.side='party';hero.hp=hero.maxHp||100;
  return {sim:l,w,hero};
}

test('every stall and pole sits on its own keep\'s cobbles, both keeps mirrored',()=>{
  for(const side of ['party','rivals']){const [cx,cz]=homePoint(side,[0,0]);
    for(const name of SQUARE_PIECES){const {x,z}=squarePiece(side,name),d=Math.hypot(x-cx,z-cz);
      assert.ok(d>SQUARE.innerRadius+1&&d<SQUARE.radius,`${side} ${name} on the square (${d.toFixed(1)} m)`);assert.equal(squareAt(x,z),side);}
    for(const [x,z] of squarePoles(side))assert.ok(squareCover(side,x,z)>0,`${side} pole on the square`);}
  assert.equal(squareAt(0,0),null,'the middle of the field is grass');
});

test('Heroes spawn on the square, facing the heart',()=>{
  const [x,z]=homePoint('party',[0,9.2]),[hx,hz]=homePoint('party',[0,0]),yaw=squareSpawnYaw('party',[x,0,z]);
  assert.equal(squareAt(x,z),'party');
  // the camera looks along -Z rotated by yaw
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw),tx=hx-x,tz=hz-z,d=Math.hypot(tx,tz);assert.ok((fx*tx+fz*tz)/d>.999,'looking at the heart');
});

test('the bakery hands a free apple to a Hero at the counter, and only there',()=>{
  const {sim,w,hero}=rig();
  put(w,hero,homePoint('party',[0,-12]));assert.equal(act(sim,'h','squareApple').code,'too_far');
  const [x,z]=squareSpot('party','bakery');put(w,hero,[x,z]);
  const r=act(sim,'h','squareApple');assert.ok(r.ok,r.code);assert.ok(r.events.some(e=>e.kind==='snack_take'&&e.bakery&&e.by==='h'));
  assert.ok(w.fruit.drops.some(d=>d.heldBy==='h'),'the apple is in hand');
  assert.equal(act(sim,'h','squareApple').code,'hands_full','one at a time');
});

test('the bard plays one of four tunes for the square; Gods cannot ask',()=>{
  const {sim,w,hero}=rig();
  const [x,z]=squareSpot('rivals','stage');put(w,hero,[x,z]);
  const r=act(sim,'h','squareTune');assert.ok(r.ok,r.code);const e=r.events.find(e=>e.kind==='square_tune');
  assert.ok(e&&e.side==='rivals'&&e.song>=0&&e.song<SQUARE.songs,'either keep\'s bard plays for anyone');
  hero.role='god';assert.equal(act(sim,'h','squareTune').code,'hero_required');
  assert.ok(isSquareAction('squareApple')&&isSquareAction('squareTune')&&!isSquareAction('equip'));
});

test('bodies are pushed out of the stalls and the stage, and routing knows them',()=>{
  const {w}=rig();
  for(const name of ['stage','bakery']){const {x,z}=squarePiece('party',name),pos=[x,0,z];resolveHomeStructures(w,pos,.3);
    assert.ok(Math.hypot(pos[0]-x,pos[2]-z)>.5,`pushed out of the ${name}`);}
  const ids=homeSolids('party').map(s=>s.id);for(const name of SQUARE_PIECES)assert.ok(ids.some(id=>id.startsWith(`square-party-${name}`)),name);
});

console.log(`town-square: ${count} ok`);
