'use strict';
const fs=require('node:fs'),path=require('node:path');
const entries=[
["crossbow.gravity", 4.0, 0, 9.8, 0.2, "Bolt drop", "Downward acceleration in metres per second squared."],
["crossbow.bolt_lifetime", 120, 15, 300, 15, "Embedded bolt lifetime", "Seconds embedded bolts remain."],
["crossbow.bolt_cap", 20, 5, 40, 1, "Embedded bolt limit", "Oldest embedded bolt is removed above this limit."],
["grapple.reel_speed", 2.8, 0.5, 5, 0.1, "Reel speed", "Continuous pull speed; release trigger to pause."],
['crossbow.trigger_break',0.72,0.3,0.95,0.01,'Trigger break','Analog pressure needed to release the sear. Release below 0.15 to reset.'],
['crossbow.drag',0.12,0,0.5,0.01,'Bolt air resistance','Gradual velocity loss per second.'],
['crossbow.bolt_speed',44,8,65,1,'Bolt speed','Base bolt velocity; a Brann per-item live profile overrides this.'],
['crossbow.crank_reach',.13,.06,.22,.01,'Crank grip reach','Hand distance from the winding knob needed to grab it.'],
['crossbow.load_reach',.19,.08,.3,.01,'Bolt seating reach','Forgiving rail catch distance; the bolt must also point along the rail.'],
['crossbow.damage',95,10,140,5,'Bolt damage','Base impact damage; a Brann per-item live profile overrides this.'],
['enemy.stride',1,.5,2,.05,'Stride length','Animation stride multiplier; gait follows actual travel.'],
['enemy.bob',1,0,2,.05,'Body weight shift','Cosmetic body bob multiplier.'],
['enemy.turn_speed',5,1,12,.5,'Enemy turn speed','Facing response per second.'],
['enemy.windup',1.2,.4,3,.1,'Attack wind-up','Seconds before the visible strike; applies on next attack.'],
['enemy.recovery',2.5,.5,5,.1,'Attack recovery','Recovery seconds after a strike; applies on next attack.'],
['enemy.recoil',1,0,2,.1,'Hit reaction','Cosmetic recoil strength, not gameplay stagger.'],
['enemy.death_scatter',1,0,2,.1,'Death scatter','Impulse multiplier for physical character pieces.'],
['grip.secondary_reach',.18,.08,.3,.01,'Second hand reach','Distance from the handle for a support grip or regrip.'],
['grip.smoothing',.65,0,1,.05,'Held-object steadiness','Subtly damps VR hand-held jitter. Zero keeps exact tracking; larger deliberate motions stay responsive. Desktop and head tracking are unchanged.'],
['holster.reach',.2,.1,.35,.01,'Holster reach','Distance from a hip slot to store or retrieve tools.'],
['holster.height',.65,.4,.9,.05,'Hip offset','Distance below the headset to the estimated belt.'],
['input.grip_press',.6,.15,.95,.05,'Grip to grab','Squeeze value needed to begin grabbing. Release is clamped below this value.'],
['input.grip_release',.5,.05,.9,.05,'Release earlier', 'Higher values release earlier as your fingers open. Effective maximum is grab threshold minus0.05.'],
['hands.pitch_degrees',-90,-180,180,5,'Hand pitch','Visual hand and held-tool pitch correction.'],
['hands.yaw_degrees',0,-180,180,5,'Hand yaw','Visual hand and held-tool yaw correction.'],
['hands.roll_degrees',0,-180,180,5,'Hand roll','Visual hand and held-tool roll correction.'],
['player.eye_height',1.7,1.1,2.1,.05,'Target eye height','Eye height used when you press Calibrate height.'],
['bomb.formation_seconds',.45,.1,2,.05,'Formation time','Seconds to form a ready bomb.'],
['bomb.radius',.095,.05,.2,.005,'Bomb radius','Visual and collision radius in metres.'],
['throw.gain',1.45,.5,3,.05,'Throw gain','Multiplier applied to sampled hand velocity.'],
['throw.window_seconds',.12,.04,.3,.01,'Sampling window','Strongest recent hand motion retained for a forgiving release.'],
['throw.assist_lift',.65,0,2,.05,'Release lift','Upward assistance in metres per second.'],
['throw.min_speed',1,0,3,.1,'Throw threshold','Below this hand speed, release drops instead of launching.'],
['throw.max_speed',18,5,30,.5,'Speed limit','Maximum launch velocity in metres per second.'],
['bomb.fuse_seconds',3,.5,8,.1,'Fuse duration','Maximum live lifetime after release.'],
['bomb.impact_delay',.85,0,3,.05,'Impact delay','Seconds between first impact and detonation.'],
['bomb.bounce',.25,0,.9,.05,'Bounce','Collision restitution.'],
['bomb.gravity',1,.1,2,.05,'Gravity scale','Gravity multiplier for thrown bombs.'],
['bomb.blast_radius',3.2,1,6,.1,'Blast radius','Explosion influence radius in metres.'],
['bomb.damage',45,5,120,5,'Bomb damage','Damage to enemies within the blast radius.'],
['bomb.self_damage_ratio',.65,0,1,.05,'Self damage','Player damage fraction relative to enemy damage.'],
['vfx.intensity',1,0,2,.05,'Effect intensity','Overall explosion brightness and scale emphasis.'],
['vfx.duration',.75,.2,2,.05,'Effect duration','Explosion effect duration in seconds.'],
['vfx.spark_count',24,0,64,1,'Spark count','Number of explosion sparks.','integer'],
['audio.volume',.65,0,1,.05,'Effects volume','Bomb sound effect volume.'],
['haptics.strength',1,0,1.5,.05,'Haptic strength','Global multiplier; final device amplitude stays bounded.'],
['locomotion.speed',2.7,.5,6,.1,'Movement speed','Left-stick VR and desktop movement speed in metres per second.'],
['combat.enemy_speed',1,.25,2,.05,'Enemy speed','Enemy movement multiplier.'],
['playful.ring_toss_gain',1,.5,1.5,.05,'Ring toss strength','Sunskipper launch multiplier; applies on next toss, capped at 21 metres per second.'],
['playful.ring_gravity',1.1,0,3,.1,'Ring drop','Sunskipper downward acceleration in metres per second squared; changes during flight.'],
['playful.ring_recall_speed',18,4,18,.5,'Ring recall speed','Sunskipper return speed in metres per second; changes during recall.'],
['playful.magnet_range',4.5,1.5,4.5,.1,'Wand reach','Maximum cargo acquisition distance in metres; lowering it also releases distant held cargo.'],
['playful.magnet_pull',22,10,22,1,'Wand pull acceleration','Maximum cargo acceleration in metres per second squared; lower values make distant pulling gentler.'],
['playful.magnet_fling',4.2,1,5.8,.2,'Wand toss speed','Forward cargo fling speed in metres per second; final combined velocity stays below 6.'],
["playful.ring_curve", 4.2, 0, 9, 0.2, "Ring banking curve", "Sideways turn strength at full bank; flat throws stay straight."],
["playful.ring_drag", 0.025, 0, 0.2, 0.005, "Ring air drag", "Gentle speed loss while gliding."],
["playful.ring_recall_accel", 28, 6, 60, 1, "Ring recall pull", "Acceleration pulling momentum back towards the hand; no instant reversal."],
["playful.ring_bounce", 0.84, 0.4, 1, 0.02, "Ring bounce energy", "Speed retained after mirror-angle scenery ricochets."],
['worldbuilder.mana_regen_multiplier',4,1,8,.25,'Mana recovery speed','World Builder Mana recovery relative to the original 0.055 Mana per second. Four is the testing pace.']
];
const SCHEMA=Object.fromEntries(entries.map(([key,value,min,max,step,label,help,type='number'])=>[key,{type,default:value,min,max,step,label,help,group:key.split('.')[0]}]));
const defaults=()=>Object.fromEntries(Object.entries(SCHEMA).map(([k,s])=>[k,s.default]));
const PRESETS={default:{},gentle:{'throw.gain':1.2,'throw.assist_lift':.8,'bomb.fuse_seconds':4,'bomb.self_damage_ratio':.4,'haptics.strength':.7},punchy:{'throw.gain':1.7,'throw.assist_lift':.5,'bomb.fuse_seconds':2.5,'vfx.intensity':1.3,'haptics.strength':1.2},'normal-mana':{'worldbuilder.mana_regen_multiplier':1},'fast-mana':{'worldbuilder.mana_regen_multiplier':4}};
function values(input,base){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Tuning values must be an object.');const result={...base};for(const [key,value] of Object.entries(input)){const rule=Object.hasOwn(SCHEMA,key)?SCHEMA[key]:null;if(!rule)throw Error('Unknown tuning key: '+key);if(typeof value!=='number'||!Number.isFinite(value)||(rule.type==='integer'&&!Number.isInteger(value))||value<rule.min||value>rule.max)throw Error('Invalid tuning value: '+key);result[key]=value;}return result;}
class Tuning {
constructor(directory,log=()=>{}){this.file=path.join(directory,'tuning.json');this.log=log;this.revision=0;this.values=defaults();this.previous=null;fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Number.isSafeInteger(saved.revision)||saved.revision<0)throw Error('Invalid tuning revision; preserve tuning.json for recovery.');this.values=values(saved.values,defaults());this.previous=saved.previous?values(saved.previous,defaults()):null;this.revision=saved.revision;}}
snapshot(){return {revision:this.revision,values:{...this.values},schema:structuredClone(SCHEMA),canUndo:!!this.previous,presets:Object.keys(PRESETS)};}
change(request){if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Invalid tuning request.');if(request.expectedRevision!==undefined&&request.expectedRevision!==this.revision)throw Error('Tuning changed elsewhere. Reload before applying.');for(const k of Object.keys(request))if(!['values','expectedRevision','action','preset'].includes(k))throw Error('Unknown tuning request field: '+k);if([request.values!==undefined,request.action!==undefined,request.preset!==undefined].filter(Boolean).length!==1)throw Error('Choose values, action or preset.');let next;if(request.action==='undo'){if(!this.previous)throw Error('No previous tuning snapshot.');next={...this.previous};}else if(request.action==='reset')next=defaults();else if(request.action!==undefined)throw Error('Unknown tuning action.');else if(request.preset!==undefined){if(!Object.hasOwn(PRESETS,request.preset))throw Error('Unknown tuning preset.');next=values(PRESETS[request.preset],defaults());}else next=values(request.values,this.values);
const record={revision:this.revision+1,values:next,previous:{...this.values}};const temporary=this.file+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(record,null,2));fs.renameSync(temporary,this.file);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
this.previous=record.previous;this.values=next;this.revision=record.revision;this.log('TUNING',this.revision,request.action||request.preset||Object.keys(request.values).join(','));return this.snapshot();}
}
module.exports={Tuning,SCHEMA,defaults};
