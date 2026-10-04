import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {terrainHeight} from '../shared/simulation.js';

class Connection extends EventTarget {
  constructor() { super(); this.roster = new Map(); this.hostId = 'host'; this.epoch = 1; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  connect() {
    this.roster.set('host', {id:'host', name:'Host', role:'hero', online:true});
    this.emit('welcome', {room:'12345678', peerId:'host', hostId:'host', role:'hero'});
  }
  send() { return true; }
  broadcast() {}
  setCheckpoint(state, revision) { this.checkpoint = state; this.checkpointRevision = revision; }
  close() {}
}

for (const {capacity, carried} of [{capacity:0, carried:0}, {capacity:256, carried:0}, {capacity:256, carried:999}, {capacity:255, carried:9}]) {
  test(`held ore conserved through repeated reconnects: ${capacity} pickups, ${carried} carried`, () => {
    const connection = new Connection(), values = new Map();
    const session = new WorldSession({connection, storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}});
    try {
      session.connect(); clearInterval(session.timer);
      connection.roster.set('guest', {id:'guest', name:'Guest', role:'hero', online:true});
      connection.emit('peer_connected', {peerId:'guest'});
      const state = session.simulation.adventureWorld(), player = state.players.find(p=>p.id==='guest');
      player.position = [12, terrainHeight(state,12,12), 12];
      state.pickups = [{id:'testOre',kind:'ironOre',amount:1,x:12,z:12,y:player.position[1]}];
      assert.equal(session.simulation.command('guest',{type:'action',seq:1,action:'inventionLiftOre',targetId:'testOre'}).ok,true);
      player.resources.ironOre = carried;
      for(let i=0;i<capacity;i++) state.pickups.push({id:`filler${i}`,kind:'wood',amount:1,x:20,z:20,y:0});
      const total = () => {
        const world = session.simulation.adventureWorld();
        return world.pickups.filter(p=>p.kind==='ironOre').reduce((n,p)=>n+p.amount,0)
          + world.players.reduce((n,p)=>n+p.resources.ironOre+(p.heldOre==='ironOre'?1:0),0);
      };
      const before = total();
      for(let i=0;i<3;i++) {
        connection.roster.get('guest').online=false; connection.emit('peer_left',{peerId:'guest'});
        connection.roster.get('guest').online=true; connection.emit('peer_joined',{id:'guest'});
        assert.equal(total(),before,'ground + pack + held ore remains constant');
        const returning = session.simulation.adventureWorld().players.find(p=>p.id==='guest');
        assert.equal(returning.resources.ironOre,capacity===256?carried:0);
        assert.equal(returning.heldOre,capacity===256?'ironOre':undefined);
      }
    } finally { session.dispose(); }
  });
}
