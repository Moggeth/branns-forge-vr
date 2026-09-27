'use strict';
const RESOURCES=['rat_tail','lumber','stone','iron','apple','spore','crystal','haunted_bone','sky_bloom','ember_core'];
const CAPABILITIES={strike:1,chop:1,mine:1,bomb:1,spark:1,blast:2,slow:2,pull:2,shield:2,dash:2,grapple:2,ignite:2,enchant:3,resonate:3,flight:4};
const HAPTICS={formation:{amplitude:.18,duration:.6,frequency:75},ready:{amplitude:.65,duration:.08,frequency:150},release:{amplitude:.28,duration:.06,frequency:100},impact:{amplitude:.7,duration:.12,frequency:80}};
const TOOLS=[
  {id:'apprentice_hammer',name:'Copperpot’s Promise',description:'Swing to strike. Trigger releases Forge Pulse: a nearby damaging shockwave with a brief slow, every 3 seconds.',tier:1,capabilities:['strike'],color:'#e6a153'},
  {id:'woodland_axe',name:'Orchard’s Edge',description:'An applewood axe: three aligned physical cuts fell timber. Trigger activates Orchard Shelter: heal 15 and slow nearby enemies for 4 seconds, 8 second cooldown.',tier:1,capabilities:['chop','strike'],color:'#94c87e'},
  {id:'quarry_pick',name:'Stonewhisper',description:'Swing to mine. Trigger charges a resonant strike for eight seconds: gather a little more from that seam and fracture up to two nearby ore seams. Eight-second cooldown.',tier:1,capabilities:['mine','strike'],color:'#80c8eb'},
  {id:'bomb_glove',name:'Pocket Thunder',description:'Squeeze for a heartbeat; release a warm little thunderstorm.',tier:1,capabilities:['bomb'],color:'#f8b64b',formationSeconds:.6},
  {id:'grappling_hook',name:'Swallow Line',description:'A winged grappling reel. Aim and press trigger to attach; hold to reel, release to pause, release grip to detach.',tier:2,capabilities:['grapple'],color:'#e8d59a'},
  {id:'spore_lantern',name:'Mooncap Lantern',description:'Carry for soft fungal light. Trigger plants a slowing spore garden for six seconds.',tier:2,capabilities:['ignite','spark','slow','blast'],color:'#c5a4fb'},
  {id:'crystal_resonator',name:'Hollow’s Song',description:'A purple crystal hammer that shatters brittle barriers with trigger-activated resonance.',tier:3,capabilities:['resonate','blast','enchant'],color:'#73ebf4'},
  {id:'ember_gauntlet',name:'The Last Hearth',description:'Swing to strike. Trigger launches a firebolt and grants a two-second protective ward; three second cooldown.',tier:4,capabilities:['ignite','blast'],color:'#ff9745'}
].map(t=>({...t,cooldown:t.id==='bomb_glove'?2:3,formationSeconds:t.formationSeconds||0,haptics:HAPTICS,builtin:true}));
const UPGRADES=[{tier:2,milestone:'stocked_workshop',name:'A stocked workshop',costs:[{rat_tail:3},{lumber:3,stone:3}]},{tier:3,milestone:'enchanted_anvil',name:'The enchanted anvil',costs:[{iron:3,haunted_bone:3}]},{tier:4,milestone:'everburning_forge',name:'The everburning forge',costs:[{ember_core:1}]}];
function capabilities(value,brief=''){
  if(value!==undefined&&(!Array.isArray(value)||!value.length||value.length>8||value.some(c=>!Object.hasOwn(CAPABILITIES,c))))throw Error('Choose 1-8 supported capabilities.');
  const out=new Set(value||[]);
  // Briefs can only raise the authority floor; an omitted/false declaration cannot cheapen a request.
  const patterns={chop:/\b(axe|chop|lumber)\b/i,mine:/\b(pickaxe|pick|mine|mining)\b/i,bomb:/\b(bomb|grenade|explosive)\b/i,blast:/\b(blast|damage|weapon|sword|hammer|fireball)\b/i,grapple:/\b(grappl\w*|hook)\b/i,flight:/\b(fly|flying|flight|levitat\w*|game.?bend\w*)\b/i,enchant:/\b(enchant\w*|haunted|soul)\b/i,resonate:/\b(resonat\w*|crystal)\b/i,shield:/\b(shield|invulnerab\w*)\b/i,ignite:/\b(ignite|fire|flame|burn)\b/i,dash:/\b(teleport|dash)\b/i,pull:/\b(pull|gravity)\b/i,slow:/\b(slow|freeze|ice)\b/i};
  for(const [c,re] of Object.entries(patterns))if(re.test(brief))out.add(c);
  if(!out.size)out.add('spark');
  return [...out];
}
function policy(args){const list=capabilities(args.capabilities,args.brief);return {tier:Math.max(2,...list.map(c=>CAPABILITIES[c])),capabilities:list};}
module.exports={RESOURCES,CAPABILITIES,HAPTICS,TOOLS,UPGRADES,capabilities,policy};
