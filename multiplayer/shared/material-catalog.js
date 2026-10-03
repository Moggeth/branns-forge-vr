// Shared labels and finite recipe data; legacy `gems` remains the Crystal wire key.
// No second wood type: physical logs pay Wood directly.
export const MATERIAL_KEYS=Object.freeze(['wood','stone','iron','mithril','gems','starMetal','ironOre','mithrilOre','starOre']);
export const MATERIAL_CATALOG=Object.freeze(Object.fromEntries(Object.entries({
 wood:{label:'Wood',use:'Frames, ammunition shafts and repairs.',source:'Fell trees, gather Wood or deliver trunks to a Logging Yard.',recipes:['storehouse','loggingYard','timberline','palisade'],color:0xa76b37},
 stone:{label:'Stone',use:'Foundations, walls and heavy ammunition.',source:'Mine boulders, golem remains or newly emerged seams.',recipes:['storehouse','watchtower','launcher'],color:0x92938c},
 iron:{label:'Iron',use:'Mechanisms, reinforcement and cutting edges.',source:'Refine iron ore at the Forge or recover skeleton equipment.',recipes:['timberline','trap','barracks'],color:0x9da7ae},
 mithril:{label:'Mithril',use:'Flexible cutting filament and advanced machinery.',source:'Refine rare mithril ore found beyond the starting fields.',recipes:['timberline','launcher'],color:0x7cd4db},
 gems:{label:'Crystal',use:'Wards, magical mechanisms and restorative energy.',source:'Mine crystal growth or salvage magical encounters.',recipes:['ward','sanctuary'],color:0x9a6be8},
 starMetal:{label:'Star metal',use:'Exceptional mechanisms and invention upgrades.',source:'Refine star ore from meteors and awakened meteor creatures.',recipes:['launcher','timberline'],color:0xf2b95c},
 ironOre:{label:'Iron ore',use:'Forge feedstock: one ore makes one Iron.',source:'Mine the rust-coloured seams near the Forge.',recipes:['refineIron'],color:0xb26e4f},
 mithrilOre:{label:'Mithril ore',use:'Forge feedstock: one ore makes one Mithril.',source:'Explore distant pale-blue mineral seams.',recipes:['refineMithril'],color:0x74c2cc},
 starOre:{label:'Star ore',use:'Forge feedstock: one ore makes one Star metal.',source:'Mine fallen meteors; awakened creatures yield triple star ore.',recipes:['refineStar'],color:0xe8a854}
}).map(([key,value])=>[key,Object.freeze({...value,recipes:Object.freeze(value.recipes)})])));
export const materialKey=key=>key==='crystal'?'gems':key;
export const materialInfo=key=>Object.hasOwn(MATERIAL_CATALOG,materialKey(key))?MATERIAL_CATALOG[materialKey(key)]:null;
export const materialLabel=key=>materialInfo(key)?.label??String(key);
export const ORE_RECIPES=Object.freeze({
 ironOre:Object.freeze({output:'iron',input:1,amount:1,ticks:120}),
 mithrilOre:Object.freeze({output:'mithril',input:1,amount:1,ticks:150}),
 starOre:Object.freeze({output:'starMetal',input:1,amount:1,ticks:180})
});
export const DEPOSIT_CATALOG=Object.freeze({
 stone:Object.freeze({label:'Stone boulder',maxHits:3,resource:'stone',amount:2,color:0x92938c}),
 iron:Object.freeze({label:'Iron seam',maxHits:4,resource:'ironOre',amount:4,color:0xb26e4f}),
 mithril:Object.freeze({label:'Mithril seam',maxHits:5,resource:'mithrilOre',amount:3,color:0x74c2cc}),
 crystal:Object.freeze({label:'Crystal growth',maxHits:5,resource:'gems',amount:2,color:0x9a6be8}),
 meteor:Object.freeze({label:'Meteor',maxHits:5,resource:'starOre',amount:2,color:0xe8a854})
});
export const depositReward=kind=>{const d=Object.hasOwn(DEPOSIT_CATALOG,kind)?DEPOSIT_CATALOG[kind]:null;return d?{kind:d.resource,amount:d.amount}:null;};
export const emptyMaterials=()=>Object.fromEntries(MATERIAL_KEYS.map(key=>[key,0]));
/** Strict recovery helper: absent new keys are old saves; malformed present keys are rejected. */
export function restoreMaterials(value={},cap=999){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(cap)||cap<0)throw Error('Invalid materials');
 const result=emptyMaterials();
 for(const key of MATERIAL_KEYS){const amount=Object.hasOwn(value,key)?value[key]:key==='gems'&&Object.hasOwn(value,'crystal')?value.crystal:0;if(!Number.isSafeInteger(amount)||amount<0||amount>cap)throw Error(`Invalid material ${key}`);result[key]=amount;}
 return result;
}
