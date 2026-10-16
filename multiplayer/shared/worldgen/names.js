// Seeded names for regions, settlements and features. Cheerful crafted-fantasy tone: storybook, never grim.
import {createRandom} from './random.js';

const START = ['Bram', 'Thistle', 'Amber', 'Willow', 'Copper', 'Honey', 'Mossy', 'Glen', 'Hollow', 'Bright', 'Ash', 'Fern', 'Merry', 'Sorrel',
  'Pebble', 'Larch', 'Brindle', 'Tansy', 'Rowan', 'Clover', 'Sunny', 'Dapple', 'Kettle', 'Marble', 'Otter', 'Heron', 'Bracken', 'Juniper'];
const END = ['wick', 'ford', 'mere', 'stead', 'brook', 'combe', 'dale', 'holt', 'haven', 'thorpe', 'well', 'bury', 'field', 'side', 'ton', 'ley'];
const REGION = {
  meadow: ['Downs', 'Meads', 'Vale', 'Fields', 'Greens'], forest: ['Wood', 'Weald', 'Greenwood', 'Thicket', 'Boughs'],
  pine: ['Pinewood', 'Firs', 'Needlewood', 'Timberlands'], marsh: ['Fens', 'Mires', 'Reedlands', 'Wetwood'],
  steppe: ['Sunplains', 'Goldlands', 'Barrens', 'Heath'], rock: ['Crags', 'Peaks', 'Scarps', 'Heights'], snow: ['Snowcaps', 'Frostfells', 'Whitepeaks'],
  tundra: ['Moors', 'Frostmoor', 'Bleakfells'], beach: ['Shore', 'Strand', 'Coast', 'Sands'],
};
const SETTLE = {village: ['', ''], harbour: ['', ' Harbour'], mill: ['', ' Mill'], fishery: ['', ''], lumber: ['', ' Camp'], mine: ['', ' Delve'], farm: ['', ' Farm']};
const FEATURE = {
  lake: n => `Lake ${n}`, river: n => `the ${n}`, peak: n => `Mount ${n}`, falls: n => `${n} Falls`, cave: n => `${n} Hollow`,
  ruin: n => `Old ${n}`, shrine: n => `${n} Shrine`, grove: n => `${n} Grove`, camp: n => `${n} Camp`, cache: n => `${n} Cache`,
};
const word = r => r.pick(START) + r.pick(END);
export function placeName(seed, kind = 'village') { const r = createRandom(seed), [a, b] = SETTLE[kind] || ['', '']; return a + word(r) + b; }
export function regionName(seed, biome = 'meadow') { const r = createRandom(seed); return `${r.pick(START)} ${r.pick(REGION[biome] || REGION.meadow)}`; }
export function featureName(seed, kind) {
  const r = createRandom(seed), base = kind === 'river' ? r.pick(START) + r.pick(['water', 'run', 'flow', 'brook', 'rill', 'wend']) : kind === 'peak' ? r.pick(START) + r.pick(['crest', 'horn', 'top', 'spire', 'cap']) : word(r);
  return (FEATURE[kind] || (n => n))(base);
}
