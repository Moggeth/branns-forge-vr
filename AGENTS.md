# Brann's Forge VR — working agreements
The playable project is godot/ (Godot 4.7.2 + SteamVR OpenXR). service/ is its isolated Node forge/voice/bounty bridge. native/ preserves an unbuilt Unity draft; it is not the runnable project and is not on the critical path. Unity 6000.0.33f1 failed licensing on this machine. Do not retry Unity builds until that external state changes.

Preserve C:/Users/mog/OneDrive/Documents/BomberWLAN unchanged. Source provenance: master, 6459255, public remote, 19 local commits ahead at discovery. Do not push there. No new Git repository has been initialized: await explicit user authorization. Global agreements from the task apply, including measured timings, small scoped commits after initialization, account/visibility checks before remote work, durable logging and README handoff.

Read README.md and docs/VERIFICATION.md before recurring costly work. Fast verification is service/test.cjs then service/integration.cjs. The integration test uses port 8788 and work/integration-* with generated offline test fixtures; never copy historical runtime jobs or spend on live API/generation merely to test UI. Normal service is loopback 8787. Source game uses separate ports and is not modified or restarted.

Secrets: reuse authorized OPENAI_API_KEY in memory or source .env.local if present. Never print or commit keys; worker child environments exclude API keys. Paid voice begins only on game workshop visit or Talk. Do not launch a paid voice test without a task need.

Use logs/work-timing.csv for measured work and docs/VERIFICATION.md for failed-strategy evidence and recovery. The desktop **Brann's Forge** shortcut opens `Brann's Forge Launcher.cmd`; older batch shortcuts live in `launcher/legacy/`. The launcher's Stop button calls stop.ps1, which checks process identity and start time before stopping this project's processes. Never stop all node/Godot/SteamVR processes.

WorkCodex: wrapper fails in a new non-Git directory without --skip-git-repo-check. Project work/workcodex is a copy with only that CLI flag added. It preserves the configured Azure provider, sandbox and metadata-only logging. Do not initialize Git to work around this. Unity draft delegation returned useful ideas but was not runtime-verified; always independently check generated code against service schemas and real engine behavior.
