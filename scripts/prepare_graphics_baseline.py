"""Prepare read-only source from a Git revision for same-server render comparisons.

Run from any directory: python scripts/prepare_graphics_baseline.py <revision>.
Shares unchanged /assets URLs with the candidate; not suitable for asset changes.
"""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile
import time

start = time.perf_counter()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('revision')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
revision = subprocess.check_output(
    ['git', 'rev-parse', '--verify', args.revision + '^{commit}'], cwd=repo, text=True
).strip()
asset_changes = subprocess.check_output(
    ['git', 'diff', '--name-only', revision, '--', 'multiplayer/public'], cwd=repo, text=True
).strip()
if asset_changes:
    raise SystemExit('Public assets differ. Use separate complete checkouts for this comparison.')
dest = repo / 'multiplayer/tests/.graphics-baseline'
marker = dest / 'baseline.json'
if dest.exists() and not marker.exists():
    raise SystemExit(f'Refusing to overwrite an unowned directory: {dest}')
if marker.exists() and json.loads(marker.read_text())['revision'] != revision:
    raise SystemExit('Remove the previous owned baseline before changing revisions.')
archive = subprocess.check_output([
    'git', 'archive', revision, 'multiplayer/client', 'multiplayer/shared',
    'multiplayer/assets-source',
], cwd=repo)
count = 0
with tarfile.open(fileobj=io.BytesIO(archive)) as source:
    for entry in source:
        if not entry.isfile() or not entry.name.endswith(('.js', '.json')):
            continue
        target = dest / Path(entry.name).relative_to('multiplayer')
        if not target.resolve().is_relative_to(dest.resolve()):
            raise SystemExit('Unsafe archive path')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.extractfile(entry).read())
        count += 1
result = {'revision': revision, 'sourceFiles': count, 'seconds': time.perf_counter()-start}
marker.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
