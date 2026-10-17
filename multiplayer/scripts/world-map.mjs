import {generateWorld} from '../shared/worldgen/generate.js';
import {paintWorldMap} from '../shared/worldgen/map-image.js';
import sharp from 'sharp';
const seed = process.argv[2] || 'mossy-heron-417';
const presets = process.argv[3] ? process.argv[3].split(',') : ['continent','archipelago','highlands','riverlands'];
for (const preset of presets) {
  const w = generateWorld({seed, preset});
  const img = paintWorldMap(w, 640);
  await sharp(Buffer.from(img.data.buffer), {raw: {width: img.width, height: img.height, channels: 4}}).png().toFile(`${process.env.OUT || 'logs'}/${preset}-${seed}.png`);
  console.log(preset, 'done');
}
