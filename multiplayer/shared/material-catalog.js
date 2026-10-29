// Shared labels and finite recipe data; legacy `gems` remains the Crystal wire key and `wood` the Timber key.
// No second wood type: physical logs pay Timber directly.
// Three primary materials build everything (2026-10-29): Timber, Iron and Crystal. The rest are extras with a
// few special uses. Ore is never banked: picking it up banks the metal it makes (bankKey), and old saves fold
// carried or stored ore into metal when they load (restoreMaterials).
// New keys append at the end: saves without them restore as 0 (restoreMaterials), so order stays save-compatible.
export const MATERIAL_KEYS=Object.freeze(['wood','stone','iron','mithril','gems','starMetal','ironOre','mithrilOre','starOre','copper','gold','copperOre','goldOre']);
export const MATERIAL_CATALOG=Object.freeze(Object.fromEntries(Object.entries({
 wood:{label:'Timber',use:'The main building material: frames, walls, bridges and bolts.',source:'Fell trees and pick up the logs, or let a Logging Yard gather them.',recipes:['storehouse','loggingYard','timberline','palisade'],primary:true,color:0xa76b37},
 stone:{label:'Stone',use:'Foundations and heavy launcher shot.',source:'Mine boulders, golem remains or newly emerged seams.',recipes:['storehouse','watchtower','launcher'],color:0x92938c},
 iron:{label:'Iron',use:'Mechanisms, fittings and cutting edges.',source:'Mine the rust-coloured iron seams with the pick.',recipes:['timberline','trap','barracks'],primary:true,color:0x9da7ae},
 mithril:{label:'Mithril',use:'Flexible cutting filament and advanced machinery.',source:'Refine rare mithril ore found beyond the starting fields.',recipes:['timberline','launcher'],color:0x7cd4db},
 gems:{label:'Crystal',use:'Wards, magical mechanisms and restorative energy.',source:'Mine glowing crystal growths and fallen meteors.',recipes:['ward','sanctuary'],primary:true,color:0x9a6be8},
 starMetal:{label:'Star metal',use:'Exceptional mechanisms and invention upgrades.',source:'Refine star ore from meteors and awakened meteor creatures.',recipes:['launcher','timberline'],color:0xf2b95c},
 ironOre:{label:'Iron ore',use:'Forge feedstock: one ore makes one Iron.',source:'Mine the rust-coloured seams near the Forge and along the mountain foot.',recipes:['refineIron'],color:0xb26e4f},
 mithrilOre:{label:'Mithril ore',use:'Forge feedstock: one ore makes one Mithril.',source:'Explore pale-blue seams high on the mountain foot.',recipes:['refineMithril'],color:0x74c2cc},
 starOre:{label:'Star ore',use:'Forge feedstock: one ore makes one Star metal.',source:'Mine fallen meteors or rare star veins deep in the mountain foot; awakened creatures yield triple star ore.',recipes:['refineStar'],color:0xe8a854},
 // Groundwork metals: refined and stored like the others; future recipes list themselves here.
 copper:{label:'Copper',use:'Wiring, bells and warm fittings for coming inventions.',source:'Refine copper ore from the green-streaked lodes along the mountain foot.',recipes:[],groundwork:true,color:0xd08a5a},
 gold:{label:'Gold',use:'Inlay, enchanting foci and fine mechanisms for coming inventions.',source:'Recover impacted golden Siegebird bolts or refine gold ore from mountain-foot quartz seams.',recipes:[],groundwork:true,color:0xf2c75a},
 copperOre:{label:'Copper ore',use:'Forge feedstock: one ore makes one Copper.',source:'Mine the glinting green lodes along the mountain foot.',recipes:['refineCopper'],color:0x4f9a7c},
 goldOre:{label:'Gold ore',use:'Forge feedstock: one ore makes one Gold.',source:'Mine the glinting quartz seams up on the mountain foot.',recipes:['refineGold'],color:0xe0b44a}
}).map(([key,value])=>[key,Object.freeze({...value,recipes:Object.freeze(value.recipes)})])));
// groundwork: a mined and refined metal whose first recipes are still to be designed.
/** The three building materials, in display order. Everything else is an extra. */
export const PRIMARY_MATERIALS=Object.freeze(['wood','iron','gems']);
/** Extras that can be held (ores bank as metal, so they never show). */
export const EXTRA_MATERIALS=Object.freeze(['stone','gold','copper','mithril','starMetal']);
export const materialKey=key=>key==='crystal'?'gems':key;
export const materialInfo=key=>Object.hasOwn(MATERIAL_CATALOG,materialKey(key))?MATERIAL_CATALOG[materialKey(key)]:null;
export const materialLabel=key=>materialInfo(key)?.label??String(key);
export const ORE_RECIPES=Object.freeze({
 ironOre:Object.freeze({output:'iron',input:1,amount:1,ticks:120}),
 mithrilOre:Object.freeze({output:'mithril',input:1,amount:1,ticks:150}),
 starOre:Object.freeze({output:'starMetal',input:1,amount:1,ticks:180}),
 copperOre:Object.freeze({output:'copper',input:1,amount:1,ticks:100}),
 goldOre:Object.freeze({output:'gold',input:1,amount:1,ticks:160})
});
/** The material a pickup or reward banks as: ore banks as its metal, everything else as itself. */
export const bankKey=kind=>Object.hasOwn(ORE_RECIPES,kind)?ORE_RECIPES[kind].output:kind;
export const DEPOSIT_CATALOG=Object.freeze({
 stone:Object.freeze({label:'Stone boulder',maxHits:3,resource:'stone',amount:3,color:0x92938c}),
 iron:Object.freeze({label:'Iron seam',maxHits:4,resource:'ironOre',amount:4,color:0xb26e4f}),
 mithril:Object.freeze({label:'Mithril seam',maxHits:5,resource:'mithrilOre',amount:3,color:0x74c2cc}),
 crystal:Object.freeze({label:'Crystal growth',maxHits:5,resource:'gems',amount:4,color:0x9a6be8}),
 meteor:Object.freeze({label:'Meteor',maxHits:5,resource:'starOre',amount:2,color:0xe8a854}),
 // Mountain-foot vein kinds (shared/ore-veins.js); iron and mithril veins reuse the seams above.
 copper:Object.freeze({label:'Copper lode',maxHits:4,resource:'copperOre',amount:4,color:0x4f9a7c}),
 gold:Object.freeze({label:'Gold seam',maxHits:5,resource:'goldOre',amount:3,color:0xe0b44a}),
 star:Object.freeze({label:'Star vein',maxHits:6,resource:'starOre',amount:3,color:0xf2b95c})
});
export const depositReward=kind=>{const d=Object.hasOwn(DEPOSIT_CATALOG,kind)?DEPOSIT_CATALOG[kind]:null;return d?{kind:d.resource,amount:d.amount}:null;};
export const emptyMaterials=()=>Object.fromEntries(MATERIAL_KEYS.map(key=>[key,0]));
/** Strict recovery helper: absent new keys are old saves; malformed present keys are rejected.
 * Ore from older saves folds into its metal (one ore made one bar at the Forge), capped at `cap`. */
export function restoreMaterials(value={},cap=999){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(cap)||cap<0)throw Error('Invalid materials');
 const result=emptyMaterials();
 for(const key of MATERIAL_KEYS){const amount=Object.hasOwn(value,key)?value[key]:key==='gems'&&Object.hasOwn(value,'crystal')?value.crystal:0;if(!Number.isSafeInteger(amount)||amount<0||amount>cap)throw Error(`Invalid material ${key}`);result[key]=amount;}
 for(const [ore,r] of Object.entries(ORE_RECIPES))if(result[ore]){result[r.output]=Math.min(cap,result[r.output]+result[ore]*r.amount);result[ore]=0;}
 return result;
}
