// Pull-request gate: a PR that changes the game must add or update a patch-notes entry.
// CI checks out the PR merge commit, so HEAD^1 is the base and HEAD^2 the PR head.
//   node tests/patch-notes-required.mjs            (CI, on pull_request)
//   node tests/patch-notes-required.mjs <base-ref> (locally, e.g. origin/main)
// Opt out for a change players cannot notice by putting "[no patch notes]" in a commit message.
import {execFileSync} from 'node:child_process';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const root = git('rev-parse', '--show-toplevel');
const run = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();

let base = process.argv[2], head = 'HEAD';
if (!base) {
  let parents = [];
  try { parents = run('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1); } catch { /* shallow */ }
  if (parents.length === 2) [base, head] = parents;
  else if (process.env.GITHUB_BASE_REF) base = `origin/${process.env.GITHUB_BASE_REF}`;
  else { console.log('patch-notes-required: no base to compare against; skipped'); process.exit(0); }
}
const mergeBase = run('merge-base', base, head);
const changed = run('diff', '--name-only', mergeBase, head).split('\n').filter(Boolean);

// What players can notice: everything the browser game ships, not its tests, tools, docs or art sources.
const GAME = /^multiplayer\/(client|shared|public|peer|server)\/|^multiplayer\/[^/]+\.(js|mjs|css|html)$/;
const NOT_GAME = /^multiplayer\/(vite\.config|gateway)\.|\.md$/;
const game = changed.filter(f => GAME.test(f) && !NOT_GAME.test(f));
const notes = changed.filter(f => /^multiplayer\/patch-notes\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(f));
const optOut = /\[no patch notes\]/i.test(run('log', '--format=%B', `${mergeBase}..${head}`));

if (!game.length) console.log('patch-notes-required: no game files changed');
else if (notes.length) console.log(`patch-notes-required: ${game.length} game files changed, entries: ${notes.join(', ')}`);
else if (optOut) console.log('patch-notes-required: game files changed, opted out with [no patch notes]');
else {
  console.log(`This PR changes the game (${game.slice(0, 5).join(', ')}${game.length > 5 ? ', …' : ''}) but adds no patch notes.`);
  console.log('Add multiplayer/patch-notes/YYYY-MM-DD-short-name.md describing the change for players.');
  console.log('See multiplayer/patch-notes/README.md. For a change no player can notice, put [no patch notes] in a commit message.');
  process.exit(1);
}
