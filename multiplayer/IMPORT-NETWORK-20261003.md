# Browser networking checkpoint

Versioned per-peer delta snapshots now negotiate with compatible clients and fall back to complete snapshots for older clients. Missing bases, corrupted frames, resets and host migration request/rebuild keyframes. Saves/checkpoints stay complete and unquantized. Simulation remains60Hz; snapshots20Hz.

Reloaded clients seed a monotonic command counter and adopt host-provided sequence floors without lowering host replay protection. This prevents the previous12-30second input rejection. The host parks only resources that could not be dropped because of pickup limits; a returning player cannot duplicate the dropped pack.

Verification: Opus5.5 personal Claude.ai commission871.981seconds. Real Chromium WebRTC, seven contexts: zero console errors in final runs; reload movement2-59ms afterchannelopen, zero duplicate errors; patched client under legacyhost32-204ms. Channel reopening itself remainsvariable33ms-2.6seconds. Earliercodecstudy39checks passed; default3player wire17.1vs50.3KB/s. Separate8player syntheticload75-85% snapshottraffic reduction. These are LAN/loopback results, NOT internet/TURN/physicalQuest acceptance.

Root independently reran session-reload7, state-codec9, session4, expedition-persistence and expedition-integration on the actual checkout: allpass,2.602seconds includingcopy. Exact tree/adventure/fire snapshotroundtrip verified; loose-log coverage comes from existingExpedition playtest, not the codecfixture which hadnotyetlandedthetree.

Commands from multiplayer/: node tests/session-reload.mjs; node tests/state-codec.mjs; node tests/session.mjs; node tests/expedition-persistence.mjs. Browser repro source/results retained in ignored work/opus-network-finalize-20261003/harness and logs; ownedhelperports5193/8800wereclosed. Originalpeer8789/tunnelunchanged.

Release status: integrated and deployed at https://branns-forge-multiplayer.vercel.app. Latest verified release source8e6423e, deployment dpl_31TT4GgXj561D62e4e6zQapW3y42. Public two-context Hero/God join, movement, Grove replication and nested audio asset loading passed11.164s. Later two-context Starfall/Healing Rain updated Hero health100->78->100 on both peers in8.520s. Hosted menu acceptance verified save download, reset cancellation/confirmation, recovery retained and import in10.377s. The seven-context reload result above remains a local browser result; public tests are separate contexts on one machine, not separate-network/TURN evidence.

Limitations: oldunpatchedclients still flood when they reload. Parked undropped resources are memory-only and expire120seconds; fullpickup-cap/worldownership loss can still lose those resources. NoTURNguarantee oralways-oncloudhost. Hashchecks detectcorruption, not hostileauthenticatedhosts. The public frontend still depends on the PC-hosted peer connection service.

Reset recovery guarantee (17:38 UTC): routine autosave reports errors without throwing, so calling it before reset could erase a world even when storage was full. Reset now writes its recovery save synchronously and aborts on failure before changing simulation, world ID or checkpoint revision. Five session tests pass (Node76.306ms; test+privatevisibility command0.917s), including quota failure then successful retry.
