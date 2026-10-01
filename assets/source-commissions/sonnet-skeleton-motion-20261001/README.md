# Skeleton motion source — 1 October 2026

Sonnet 5.5 authored the rig/clip changes in this isolated commission; Codex integrated and verified them. The personal Claude.ai Pro subscription and exact `claude-sonnet-5-5` model were verified in a cleaned child environment. `metadata.json` records the completed 507.388 s commission. `metadata-01.json` preserves the earlier 600.298 s timeout, which produced inspection only and was not accepted as a delivery. No metered API or extra usage was used.

`input/` contains the previous installed GLBs required by the builder. `output/` contains the editable Blender scenes, deterministic builder, measured source manifest and artist's original handoff. That handoff describes the artist's delivery state; the integration results below supersede its unverified status. The installed exports are `godot/guardians/rigged/{mossward,prismwatch,cinderkeep}_rig.glb`.

From the project root:

```powershell
& 'tools/blender-4.5.13-windows-x64/blender.exe' -b --python 'assets/source-commissions/sonnet-skeleton-motion-20261001/output/build_skeleton_motion.py' -- --out "$PWD/outputs/skeleton-motion-rebuild"
pwsh -NoProfile -File scripts/check-guardian-rigs.ps1 -OutputDirectory outputs/skeleton-motion-rebuild
python scripts/asset_lab.py inspect assets/asset-lab/mossward-motion.json outputs/skeleton-motion-rebuild/mossward_rig.glb
```

Repeat the last inspect command for Prismwatch and Cinderkeep. Do not use `asset_lab.py build` for these three specs: this family builder uses `--out`, rather than the pilot builder's CLI contract. Rebuild took **1.942 s**, and all three resulting GLBs exactly matched the installed SHA-256 hashes. Each has 13 bones, eight clips and seven meshes; triangle counts are unchanged at **17,092 / 14,454 / 18,454**. All three pass the asset/import gates. The seven glTF `NODE_SKINNED_MESH_NON_ROOT` warnings per asset are the preserved Blender armature hierarchy; there are no validator errors. Imported transforms, materials, pose bounds and ground/attack captures were reviewed.

The generic asset specs check actual scene nodes. Knees, feet and weapon sockets are Skeleton3D bones; the rig and gameplay checks verify that separate contract. The native motion review produces 37 settled phase/angle/detail images under ignored `outputs/skeleton-motion-review/`.

See [integration, tests and limits](../../../docs/SKELETON-ANIMATION-20261001.md). Relaunch normally to load the installed GLBs and scripts. Resident game processes, services and saves were not restarted or modified during verification.
