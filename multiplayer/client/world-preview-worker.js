// Off-thread world preview for the world-creation menu: generate the seeded world and paint a small map.
import {generateWorld} from '../shared/worldgen/generate.js';
import {paintWorldMap} from '../shared/worldgen/map-image.js';
self.onmessage = ({data}) => {
  const {id, seed, preset, px = 224} = data || {};
  try {
    const world = generateWorld({seed, preset});
    const img = paintWorldMap(world, px);
    const start = world.settlements.find(s => s.start);
    self.postMessage({id, width: img.width, height: img.height, data: img.data.buffer,
      facts: {rivers: world.rivers.length, lakes: world.lakes.length, settlements: world.settlements.length, caves: world.entrances.length,
        start: start?.name || '', regions: world.regions.slice(0, 4).map(r => r.name)}}, [img.data.buffer]);
  } catch (error) { self.postMessage({id, error: String(error?.message || error)}); }
};
