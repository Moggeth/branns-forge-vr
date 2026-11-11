// The Hero's arsenal: which weapons a player may draw. Pure; the client reads it to build the hotbar.
//
// Scope (2026-11-11, "Shrink scope and tighten core loop"): the game is focused on a short list of weapons. Shelved
// weapons keep all their code, art and rules, but stay off the hotbar unless Labs is on (add ?labs=1 to the address
// once; ?labs=0 turns it off). To bring one back, take it out of SHELVED_WEAPONS.
export const SHELVED_WEAPONS = Object.freeze(['flask', 'staff']); // Emberdew, Sunthread
export const WEAPON_NAMES = Object.freeze({axe: 'Axe', pick: 'Pick', hammer: 'Sunfall', crossbow: 'Siegebird', bow: 'Emberwing',
  wyrmspout: 'Wyrmspout', flask: 'Emberdew', staff: 'Sunthread', flockwright: 'Flockwright', stormreel: 'Stormreel'});
/** True when this weapon is shelved for the current build (hidden and not drawable). */
export const weaponShelved = (tool, {labs = false} = {}) => !labs && SHELVED_WEAPONS.includes(tool);
