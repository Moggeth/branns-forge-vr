// Retired playtest gift (one Timberline's worth of materials by the forge). New worlds no longer get it; worlds saved
// while it existed keep their pile, which still collects as one bundle. Represented by ordinary saved pickups.
export const GIFT_POSITION=Object.freeze([-1.2,6.2]);
export const GIFT_IDS=Object.freeze(['timberlineGift_wood','timberlineGift_iron','timberlineGift_mithril']);
export const isTestingGift=q=>GIFT_IDS.includes(typeof q==='string'?q:q?.id);
export const giftContents=state=>(state.pickups||[]).filter(isTestingGift);
export function createTestingSupplies(cost,height){return Object.entries(cost).map(([kind,amount])=>({id:'timberlineGift_'+kind,kind,amount,x:GIFT_POSITION[0],z:GIFT_POSITION[1],y:height(...GIFT_POSITION),side:'party'}));}
