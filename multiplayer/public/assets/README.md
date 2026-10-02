# Reused authored assets

These bounded copies keep the multiplayer build independent of the full native
asset tree. All came from this repository, with no new 3D generation this turn.

| Copy | Source relative to repository |
| --- | --- |
| tree.glb | godot/assets/orchard/apple_tree_mature_lod1.glb |
| skeleton.glb | godot/guardians/rigged/mossward_rig.glb |
| axe.glb | godot/weapons/orchards_edge.glb |

manifest.json records size/SHA-256 of the exact copied files. Recopy intentionally
when updating the native art and regenerate hashes; do not pull in the entire
native asset library for this browser proof. Total GLB download is about 5.67 MB.
