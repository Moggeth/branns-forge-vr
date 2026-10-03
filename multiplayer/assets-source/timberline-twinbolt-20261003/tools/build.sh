#!/usr/bin/env bash
# Rebuild GLBs with Blender 4.5 (bpy module or BLENDER binary), then capture renders.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PY="${BPY_PYTHON:-python3}"
if [ -n "${BLENDER:-}" ]; then
  "$BLENDER" --background --factory-startup --python-exit-code 2 --python "$HERE/source/build_timberline.py" -- --out "$HERE/out"
else
  "$PY" "$HERE/source/build_timberline.py" --out "$HERE/out"
fi
