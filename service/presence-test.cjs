const {test}=require('node:test'),assert=require('node:assert/strict');
const {presenceEvent}=require('./presence');
test('presence sends quiet context and one bounded departure quip, cancelling on return',()=>{
 const m={},state=(phase,distance=3.5)=>({visiting:true,presence:{phase,distance}});
 assert.equal(presenceEvent(state('near',2),m,0).type,'session.thinking.append');
 const leave=presenceEvent(state('leaving'),m,2000);
 assert.equal(leave.type,'session.commentary.append');assert.equal(leave.delegation_id,null);
 assert.equal(presenceEvent(state('leaving'),m,4000),null);
 assert.match(presenceEvent(state('near',2),m,6000).content,/obsolete/);
 assert.equal(presenceEvent(state('leaving'),m,8000).type,'session.thinking.append');
 assert.equal(presenceEvent({...state('away'),visiting:false},m,10000),null);
 assert.equal(presenceEvent({visiting:true,presence:{distance:NaN}},m,10000),null);
});
