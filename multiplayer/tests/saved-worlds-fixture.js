// Deterministic fixture saves (timestamps fixed, UTC). Shapes match WorldSaves.list() output.
const at = (d, h, m, s = 0) => Date.UTC(2026, 9, d, h, m, s);
const save = (id, name, savedAt) => ({format: 'branns-forge-world', version: 1, id, name, savedAt, checkpoint: {tick: savedAt % 1000, fixture: true}});

export const SAVES = {
  zero: [],
  one: [save('w-one', 'Little Orchard', at(2, 19, 12))],
  // Mixed order on purpose; the chooser sorts newest-first like WorldSaves.list().
  eight: [
    save('w-a', 'Little Orchard', at(2, 19, 12)),
    save('w-b', 'Little Orchard', at(2, 18, 40, 51)),
    save('w-c', 'Little Orchard', at(2, 18, 40, 7)),
    save('w-d', 'Brannshold — the very long name of a world that keeps going past the edge of a phone', at(1, 21, 3)),
    save('w-e', '<img src=x onerror="window.__xss=1">', at(1, 9, 30)),
    save('w-f', 'Ørchard ‮evil‬ ⚒️🌳', at(30 - 30 + 1, 7, 0) - 86400000 * 3),
    save('w-g', 'بستان صغير', at(1, 6, 15) - 86400000 * 10),
    save('w-h', '   ', at(1, 5, 0) - 86400000 * 40),
  ],
};
