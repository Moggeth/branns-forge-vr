import layout from './forge-layout.json' with {type: 'json'};

// Placement rotates the artist's -Z front toward the +Z hero spawn.
export const FORGE_BOXES = Object.entries(layout.collision_boxes).map(([name, box]) => ({
  name, min: [-box.max[0], box.min[1], -box.max[2]], max: [-box.min[0], box.max[1], -box.min[2]],
}));
export const FORGE_WORK_POINT = [-layout.sockets.WorkPoint[0], layout.sockets.WorkPoint[1], -layout.sockets.WorkPoint[2]];

export function forgeFloor(x, z, baseY, groundY) {
  const plinth = FORGE_BOXES.find(box => box.name === 'Plinth');
  return x >= plinth.min[0] && x <= plinth.max[0] && z >= plinth.min[2] && z <= plinth.max[2]
    ? Math.max(groundY, baseY + plinth.max[1]) : groundY;
}

// A small conservative character capsule vs authored boxes. Ground-contact feet
// can step onto the 18 cm plinth. Even a restored/teleported actor inside several
// overlapping boxes is moved to the nearest clear candidate in one bounded pass.
export function resolveForge(position, baseY, radius = .28, height = 1.65) {
  if (Math.abs(position[0]) > 2.1 || Math.abs(position[2]) > 2.1) return position;
  const y = position[1] - baseY;
  const boxes = FORGE_BOXES.filter(box => box.name !== 'Plinth' && y < box.max[1] - .015 && y + height > box.min[1]);
  const blocked = (x, z) => boxes.some(box => x > box.min[0] - radius && x < box.max[0] + radius &&
    z > box.min[2] - radius && z < box.max[2] + radius);
  if (!blocked(position[0], position[2])) return position;
  const xs = [position[0]], zs = [position[2]], margin = radius + .001;
  for (const box of boxes) {
    xs.push(box.min[0] - margin, box.max[0] + margin);
    zs.push(box.min[2] - margin, box.max[2] + margin);
  }
  let best = Infinity, bx = position[0], bz = position[2];
  for (const x of xs) for (const z of zs) {
    const d = (x - position[0]) ** 2 + (z - position[2]) ** 2;
    if (d < best && !blocked(x, z)) { best = d; bx = x; bz = z; }
  }
  position[0] = bx; position[2] = bz;
  return position;
}
