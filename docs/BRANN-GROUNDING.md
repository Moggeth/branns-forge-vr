# Brann grounding and native starter-tool delivery

## Diagnosed gap

The backend previously handled issue_tool by calling World.craft, which only recorded ownership and returned a recipe. Native polling imported bespoke items, but no command told the running game to instantiate/equip an issued predefined axe. A successful backend result could therefore be narrated while nothing changed in VR. Existing saves with an explicit partial tools array could also omit the free bomb glove from model context.

## Delivery protocol

ForgeStore.execute forwards the model function call id into World.issueTool(args,key). Root server wiring must use issueTool:(args,key)=>world.issueTool(args,key). World persists a uniquely identified delivery alongside player ownership. A replay of the same call id returns the same result and cannot queue twice; a conflicting tool for that id is rejected.

World.progression and snapshot expose deliveries as pending records {id,toolId,status,createdAt}, without internal request keys. The native game polls these, creates/equips or presents the tool, then calls the root's POST /api/vr/delivery-ack with {id}. That route calls World.ackDelivery. Only ACK sets delivered and the equipped context; acknowledgments are replay-safe and persist across restart. lastDelivery reports the most recently confirmed item. Until ACK, returned message explicitly says queued and not yet confirmed in hand. Pending queue limit16 and total ledger limit1000 fail explicitly rather than lose idempotency history.

Direct native /craft remains ownership/recipe-only so an ordinary physical selection does not accidentally enqueue a second tool. Unknown crossbow is never accepted by issue_tool; a bespoke supported crossbow request must take the real commission path. Tier and visit checks remain enforced. Delivery writes roll back in-memory player state if saving fails.

## Grounded conversation

Starting Live instructions and every text backend turn include an actual game snapshot as data. inspect_forge remains the fresh-state tool during conversation. All four tier1 starter tools are repaired in ownership migration, including bomb_glove, and defaultCombatTool identifies it explicitly. Owned inventory is distinct from currently equipped; no held item is inferred from ownership.

Instructions require an actual issue_tool/commission_item result before claiming an action, distinguish pending delivery from delivered, queued/building/validating from ready, and require actual upgrade costs. Ordinary axe/pick/hammer/glove use free issue_tool; custom inventions use commission_item. Completed model text cannot grant items by itself. These grounding measures constrain the tool path and improve the prompt; they do not mathematically guarantee a generative voice will never say an inaccurate sentence.

Commission dispatch returns an explicit status message from actual registry state. FORGE tool result logs tool/id/status, and DELIVERY queued/confirmed logs establish where handoff stopped. No speculative success is emitted when a required native callback is absent.

## Verification

27 backend tests passed0.404270s before the additional sideband test. Five delivery tests then passed0.359275s (runner0.211552s), including actual mocked Live response-event processing through a local Express session and fake WebSocket: function output returns pending, a response continuation is emitted, duplicate call ids create one native command. All API transport is stubbed; only a temporary local HTTP listener is used. No paid call, worker job, normal service restart or runtime player-data write occurred.

Tests also cover persistence/replay ACK, missing-starter repair, exact tier2 costs, unknown/locked tools, failed-save rollback and queued/building/ready/failed commission messages. Native delivery/ACK rollout remains the coordinator's integration boundary.

Coordinator integration is now connected: server issueTool forwards the call id,
native polling equips pending tools, and /api/vr/delivery-ack confirms receipt.
The native fixture verified axe equip plus ACK and no duplicate on another poll.
Full32test and3fixture verification passed in21.357s before XR rollout.
