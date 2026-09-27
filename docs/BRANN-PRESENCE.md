# Brann presence implementation

Native brann_presence.gd owns proximity and presentation; speech amplitude still
comes only from remote playback. Voice helper heartbeats now include a bounded
phase (idle/opening/connecting/listening/error), which server.js validates and
expires with the existing six-second heartbeat timeout. Native visuals never
claim readiness merely because the player is close.

Native context sends presence.distance and phase alongside position, equipment,
health and zone. World.updateContext bounds these fields. The existing Live
sideband samples the authoritative snapshot once a second; presence.js emits
session.thinking.append for quiet state changes and session.commentary.append
for a departure opportunity, with delegation_id null and event_id. Identical
buckets are suppressed, updates are at least 1.5 s apart, quips 30 s apart.
Returning near explicitly supersedes prior departure context. Closing sessions
receive no new observations. BRANN presence sent logs record command submission,
not proof of spoken delivery. Existing Live error logs expose rejected commands.

Protocol reference verified September 12, 2026:
https://developers.openai.com/api/docs/guides/live-conversations
The startup instructions cannot be changed with session.update; use context
append events. No Realtime conversation.item event is used with GPT-Live.

Tuning for Codex: exported departure_grace_seconds, conversation_max_distance,
gaze_follow_speed and glance_interval_seconds in brann_presence.gd. Explosion
intensity/duration remain live native sliders; art layers live in bomb_visuals.gd.
Do not change calibrated player hand transforms while tuning Brann's smith hammer.

Verify Brann.ps1 runs mocked presence/voice transport, native approach/departure/
return/timeout checks and gaze/clasp bounds, plus existing grip and combat checks.
For visual inspection use --capture-presence or --capture-bomb-stage=burst with
--capture=<absolute png> and --service=http://127.0.0.1:8799. These are offline,
without microphone or paid generation. Use the managed start.ps1/stop.ps1 scripts;
inspect logs/runtime.json and latest game/service logs for recovery. Real headset
comfort and model-generated departure timing remain playtest questions.
