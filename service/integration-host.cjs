// Test-only process entry: publish an offline fixture AFTER the native world starts.
const fs=require('node:fs'),path=require('node:path');
if(!process.env.BRANN_ROOT||process.env.BRANN_PORT!=='8788')throw Error('Integration isolation is required.');
const {forge,app,world}=require('./server');
app.post('/test/supplies',(_,res)=>{world.player.resources.iron=2;world.save();res.json({ok:true});});
app.post('/test/delivery',async(_,res)=>{try{res.json(await forge.store.execute('issue_tool',{id:'woodland_axe'},'native-delivery-fixture'));}catch(e){res.status(409).json({error:e.message});}});
setTimeout(()=>{const job=JSON.parse(fs.readFileSync(path.join(process.env.BRANN_ROOT,'fixture.json'),'utf8'));forge.store.jobs.push(job);forge.store.save();console.log('TEST fixture published while native world is running');},3500);
