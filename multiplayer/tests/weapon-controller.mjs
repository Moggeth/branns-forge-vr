import assert from 'node:assert/strict';import {createWeaponController} from '../client/weapon-controller.js';
let now=0,tool='bow',aim={origin:[0,1,0],direction:[0,0,-1]},shots=[],specials=0;
const control=createWeaponController({getTool:()=>tool,getAim:()=>aim,clock:()=>now,fire:x=>shots.push(x),special:()=>specials++});
control.begin();now=850;control.special();aim={...aim,direction:[-.6,0,-.8]};control.end();assert.equal(shots.length,1);assert.deepEqual(shots[0].direction,[0,0,-1]);assert.ok(shots[0].curve[1]>.6);assert.equal(shots[0].draw,1);
control.begin();control.cancel();control.end();assert.equal(shots.length,1,'menu cancellation never fires');
tool='crossbow';control.begin();assert.equal(shots.length,2);tool='hammer';assert.equal(control.begin(),false);control.special();assert.equal(specials,1);console.log('weapon-controller: curve axis, draw strength, cancellation and crossbow pass');
