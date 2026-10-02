# Portable browser art

Editable Blender scenes, deterministic Python generators, embedded GLBs and contracts are retained here. Runtime files live separately in `../public/assets/`. Run builders with Blender 4.5.13, `--background --factory-startup --python-exit-code 2 --python <builder> -- --out <absolute output directory> --no-render`. Omit `--no-render` for actual camera renders. Do not rebuild into the runtime folder until reviewed.

- Current tree builder: `trees/opus-refined/build_trees.py`; three variants, near/far LOD, log/endcap. The older `trees/build_trees.py` is retained provenance, not the runtime version. Exact trunk geometry is shared across the art refinement to preserve carving/collision.
- Resource builder: `resources/build_resources.py`; gem, stone, apple, star iron, satchel and hinged coffer. The last three are optional source-library assets, not newly invented gameplay.
- Coordinate contract: metres, +Y up, -Z front; ground origin and Grip/ResourcePivot sockets documented in each kit contract.

Independent root rebuild on 2026-10-03: all 8 tree GLBs byte-identical to runtime (1.977 seconds), all 6 resource GLBs byte-identical to runtime/optional library (1.225 seconds). Logs under ignored `logs/portable-rebuild-20261003/`. This proves deterministic rebuilding on the installed toolchain; it does not substitute for in-game visual or headset acceptance.
