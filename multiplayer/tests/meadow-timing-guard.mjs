// End-to-end proof that allowing one timing outlier cannot hide repeated slowness.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const loader = new URL('./fixtures/meadow-timing-loader.mjs', import.meta.url).href;
const test = fileURLToPath(new URL('./meadow-cover.mjs', import.meta.url));
for (const [mode, expectedExit, injections] of [['once', 0, 1], ['twice', 1, 2], ['sustained', 1, 7]]) {
  const run = spawnSync(process.execPath, ['--experimental-loader', loader, test], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: {...process.env, MEADOW_TIMING_FAULT: mode},
  });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.ifError(run.error);
  assert.equal(run.status, expectedExit, `${mode}: unexpected test result\n${output}`);
  assert.equal((output.match(/^meadow timing fault:/gm) || []).length, injections, `${mode}: actual refill injections`);
  if (expectedExit) {
    assert.match(output, /^FAIL bounded instances, four draws, nearest-first budgeted fill that converges/m);
    assert.match(output, /second-slowest .*limit 7\.5 ms/);
    assert.match(output, /^1 failed$/m, 'only the intended performance assertion should fail');
  } else assert.match(output, /^all 5 passed$/m, 'all structural and performance checks still run');
  console.log(`meadow timing guard: ${mode}, ${injections} real 20 ms pauses, expected exit ${expectedExit}`);
}
