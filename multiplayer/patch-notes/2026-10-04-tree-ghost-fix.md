# Tree chopping stays in sync

- Fixed standing ghost trees remaining after a tree was chopped or felled.
- Fixed tree graphics drifting out of sync with the trunks you can hit when growth, harvesting or distance-detail changes happen between rendered frames.
- Preserved pending forest updates for trees returning into view, without adding extra tree meshes or unbounded graphics-update queues.
