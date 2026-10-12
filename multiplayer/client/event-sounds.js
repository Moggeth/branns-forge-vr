// Sound pass: which cue (sound-kit.js) each authoritative event gets when no richer kit already voices it. The older
// kits (wood, material, spell, keep ballista, landmarks, dragon, Stormreel, Siegebird, ...) keep their moments; this
// fills the silent ones and replaces the old single-sine fallback blip. Pure routing, so it is easy to test.
//
// cueFor(event, {me}) -> {name, opts} | null

export function cueFor(event, {me = null} = {}) {
  const k = event?.kind; if (!k) return null;
  const mine = event.id === me || event.by === me;
  switch (k) {
    // Combat
    case 'death':
      if (event.id === me) return {name: 'hero_down', opts: {mine: true}};
      if (!event.creature) return {name: 'death_soft'};
      return {name: event.creature === 'skeleton' ? 'death_bone' : event.creature === 'golem' ? null : 'death_soft'};
    case 'respawn': return event.id === me ? {name: 'respawn', opts: {mine: true}} : null;
    case 'hit': return event.id === me && event.material === 'flesh' ? {name: 'hurt', opts: {mine: true, gap: .12}} : null;
    case 'detach': case 'joint_tear': return {name: 'detach', opts: {key: `detach:${event.id}`, gap: .05}};
    case 'shockwave': return {name: 'shockwave'};
    case 'radiant_burst': return {name: 'radiant'};
    case 'shoot': return (event.weapon === 'crossbow' && event.by === me) || event.phoenix || event.flare ? null : {name: 'shoot', opts: {mine}};
    case 'fuel_throw': return mine ? null : {name: 'throw', opts: {hard: !!event.aimed}};
    case 'flame_emit': return mine ? null : {name: 'flame_puff', opts: {key: `flame:${event.by}`, gap: .28}};
    case 'goo_splat': return {name: 'splat'};
    case 'phoenix_ignite': return {name: 'ignite', opts: {key: `ignite:${event.id}`, gap: .5}};
    case 'timberline_cut': case 'timberline_shear': return {name: 'saw', opts: {key: `saw:${event.id}`, gap: .15}};
    case 'stump_gone': return {name: 'bloop'};
    case 'meteor_unfurl': return {name: 'unfurl'};
    // Home bases and battles
    case 'home_turret_fire': return {name: 'turret_fire', at: event.from};
    case 'home_shield_block': return {name: 'shield_block', opts: {key: `block:${event.id}`, gap: .08}};
    case 'home_shield_up': return {name: 'shield_up'};
    case 'home_shield_down': return {name: 'shield_down'};
    case 'home_part_broken': return {name: 'part_broken'};
    case 'home_rebuilt': return {name: 'build', opts: {gain: 1.2}};
    case 'home_siege_won': case 'battle_victory': return {name: 'battle_victory', at: null};
    case 'battle_start': return {name: 'battle_start', at: null};
    case 'battle_stop': return {name: 'battle_stop', at: null};
    case 'battle_wave': return {name: 'battle_wave', at: null};
    case 'battle_base_hit': return {name: 'part_broken', opts: {gain: .7, key: `base:${event.id}`, gap: .4}};
    // Forge and economy
    case 'build': return {name: 'build'};
    case 'forge_build': return {name: 'build', opts: {gain: 1.1}};
    case 'forge_repair': return {name: 'smelt'};
    case 'forge_encounter': return {name: 'battle_wave', at: null};
    case 'forge_result': return {name: event.result === 'defeat' ? 'forge_fail' : 'forge_success'};
    case 'workshop_smelt': case 'refinery_feed': return {name: 'smelt', opts: {key: `smelt:${event.id}`, gap: .3}};
    case 'worker_summon': return {name: 'worker_summon'};
    case 'worker_delivery': return {name: 'deliver', opts: {key: `deliver:${event.id}`, gap: .3}};
    case 'talent_learned': return mine ? {name: 'talent', at: null} : null;
    case 'resource_use': return mine ? {name: 'resource_use'} : null;
    // Adventure
    case 'adventure_telegraph': return {name: 'telegraph'};
    case 'adventure_star_impact': return {name: 'star_impact'};
    case 'adventure_stage': return {name: 'stage', at: null};
    case 'adventure_foe_down': return {name: 'death_soft'};
    case 'adventure_support': case 'adventure_rekindled': return {name: 'support'};
    case 'adventure_reward': case 'party_reward': case 'adventure_deposit': return {name: 'reward'};
    default: return null;
  }
}

/** Pickups the reward/wood kits did not claim (bones, odd parts) get the kit's pling instead of a blip. */
export const pickupCue = event => ({name: 'pickup', opts: {material: event.material || event.resource || event.ore}});
