# Browser tree and Expedition integration (pre-release)

Integrated Opus tree cutting at the hit height, physical falling trunks and three collectible logs; instanced intact forests; refined tree/resource assets with editable sources; optional Forge Expedition with solo Hero/God and cooperative stages; UI controls audit; enemy motion and reconnect reliability.

NOT YET DEPLOYED. Browser acceptance remains required for batched axe hits, fall/log pickup, God/RTS and phone layout. The completed ground/fire art and wood audio will be integrated separately. A browser networking test also found reload input sequence rejection; that fix and snapshot compression are the next networking checkpoint.

Root independently verified real-command Expedition scenarios (2.368s), persistence (0.086s), tree integration (0.089s), 535-tree batching (0.280s), legacy trees (0.200s), UI DOM contract (0.108s), session (0.067s), fire (0.085s), enemy motion (1.009s), asset dependencies (0.062s), and Vite check build (0.375s, existing bundle warning). Captain additionally ran 33 Node test files. Neither proves physical headset/mobile acceptance. Root visually reviewed actual tree/resource asset renders; game acceptance pending.

Commission actual personal Claude.ai Opus5.5 verified. Captain attempt1 704.598s reached85turn cap; attempt2 678.784s finished with explicit partial scope. The stated45min exhaustion in its handoff is inaccurate: use wrapper monotonic elapsed. Full integration provenance lives beside editable art. Preserve source files separately from runtime assets.

Lessons: normalize Windows backslashes in baseline manifest keys before hash comparison. Initial safe merge aborted with no writes because path keys differed, not file hashes. Python captured Node UTF-8 successfully but printing Unicode to a CP1252 console failed after build; use ASCII-safe JSON for summaries. Tests themselves passed. Large integration briefs should not collapse unverified browser acceptance into a completed status.
