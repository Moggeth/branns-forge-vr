# Directional proximity voice

Draft feature based on remote main `f1c1c550b85eaa4ac25f9db355d6bd0322fa6ad2`.
No deployment, recording service, new credentials or paid infrastructure is added.

## Player behavior

- In a multiplayer world, open Menu > Nearby voice > **Join voice (listen only)**.
  Joining resumes playback but never requests a microphone. **Enable microphone**
  is the only capture entry point. A denied/busy/missing microphone explains how
  to retry, while listening remains available.
- **Mute microphone** stops the capture track; enabling again is explicit.
  **Deafen** silences playback and stops capture. Listening again does not restart
  capture. Individual participant mute affects only that local listener.
- **Leave voice**, leaving the world, microphone disconnection, hiding the tab,
  loss of signaling/world connection, and host migration release capture. Joining
  a new world starts with voice off. A restored room can reconnect listening,
  but the microphone stays off until enabled again. Pending permissions are
  cancellable: a late stream is immediately stopped if its request is obsolete.
- A **Mic on - mute** button in the desktop world header, or the phone's existing
  World tools drawer, provides a direct mute action. All controls remain in Menu.
  In immersive VR, the existing B/Y action exits to Menu; join/enable there before
  entering VR. There is no new in-headset voice menu or speaking indicator.
- The app never records, transcribes, saves or uploads audio to an application
  server. Audio goes to participating room peers. **Proximity is a playback effect,
  not a confidentiality boundary**: a modified peer could listen outside the range.
  Voice preferences/microphone consent are not persisted.

## Spatial semantics and implementation

`client/voice-audio.js` creates a dedicated, gesture-started AudioContext. Each
remote stream has a MediaStreamAudioSourceNode -> HRTF PannerNode -> participant
gain -> voice master gain. The voice graph is separate from effects and music.
Linear attenuation is full within 2 world metres, fading to silence at 32 metres.
Default master gain is 0.85. Speech sources are omnidirectional; direction is
perceived relative to listener orientation. No wall/terrain occlusion is claimed.

Hero voice originates at the live rendered camera position, including local
prediction, camera height and WebXR room-scale motion. The listener uses the actual
camera forward/up vectors. A desktop/touch God's acoustic position is the overview
focus at terrain height + 1.65m; zoom does not move it. Its orientation still follows
the overview camera. A VR God uses the actual viewer head, like a Hero. The renderer
emits pose after rendering so the XR viewer matrix includes that frame's head pose.
God/Hero role changes use the next rendered pose without reconnecting voice.

Remote positions are ephemeral voice metadata (up to 2 Hz while moving, a
2-second heartbeat while stationary), smoothly applied to audio
parameters. A missing position heartbeat silences the source after 3 seconds and
cleans up the participant after 12 seconds. These are presentation positions,
not authoritative gameplay movement or competitive anti-cheat data.

Chromium may receive RTP without decoding when only a Web Audio source references
the track. A retained **muted** audio element starts that receiver's playout; only
the positional graph is audible. Removing a participant pauses/detaches the element,
disconnects its nodes and closes the peer connection. Leaving voice closes its
AudioContext. Retry can resume browser-suspended audio from a user gesture.

## Transport and limits

`client/voice-route.js` reuses `PeerRoomConnection`'s existing authenticated game
star, including game-data relay fallback, for presence/position/SDP/ICE. The host
stamps the transport sender, enforces current roster and epoch, and forwards only
to room members. Hosts route metadata even when they have not joined voice.
Guests accept forwarded metadata only from the current host. Payloads, positions,
queues and rates are bounded; host batches stay below 32 KB and 10 messages/s per
edge, preserving the game's existing 80 message/s allowance for snapshots. No
cloud Worker, signaling server or gameplay protocol deployment is required.

Audio uses a host-selected symmetric proximity graph for up to 32 room members,
with at most eight audio connections per participant (128 pairs rather than 496).
New pairs enter within 32 metres; existing pairs remain until 40 metres to avoid
edge chatter. Balanced deterministic selection avoids excluding roster-tail
players in dense gatherings. Only the authenticated current host can choose
neighbors, scoped to the game epoch and each voice session. New negotiations
start at most once per 100ms per client. Peer-ID ordering chooses the offerer; async
SDP/ICE operations are serialized and scoped to voice-session and negotiation IDs.
Stopped microphones use replaceTrack(null); re-enabling replaces the audio track
without renegotiating. Failed connections retry at bounded intervals, up to three
offers, and expose manual Retry with a network recovery explanation. Stale epochs,
sessions, negotiations and departed participants cannot revive old media.

The mesh reuses the room's existing ICE server configuration. The deployed game
relay is a **data WebSocket relay, not a TURN media relay**. Voice works only where
WebRTC media can connect directly or an already configured TURN service can relay
it. No TURN credentials/service were created. Restrictive NAT/firewalls can therefore
permit gameplay while blocking voice. This is a concrete coverage limitation, not
something the frontend can fix. All clients, including the host, need this version
to route guest-to-guest voice metadata; older clients can still play without voice.

Supported targets are the active Three.js browser game, all shared Hero/God modes,
desktop and touch browsers with secure-context WebRTC/Web Audio/microphone support,
and WebXR browsers supporting those APIs. Solo mode has no voice peers. The archived
Godot/native projects are outside this browser feature. Mobile OS suspension,
headphone routing, acoustic echo behavior and physical headset comfort still require
device testing. Eight-peer bandwidth/CPU endurance and separate-network/TURN behavior
are not established by same-machine tests.

## Verification

- `node tests/proximity-voice.mjs`: bounded authenticated routing, finite poses,
  Hero/God/XR acoustic semantics, HRTF/range configuration, denied permission/retry,
  no capture from join, stopped tracks, deafen, late permission, reconnect cleanup.
- `node tests/browser-voice.mjs`: three actual Chromium clients using the existing
  local room transport and synthetic oscillator MediaStreams; host outside voice,
  guest-to-guest RTP and measured stereo output, movement/head turning, attenuation,
  hard range cutoff, mute/deafen, permission denial, track release, failed connection
  recovery, retry and participant departure. No call can reach a physical microphone.
- Retry verification requires the remote member to observe the new voice session,
  both endpoints to connect with the same fresh negotiation ID, and audible samples
  from that connection within an 8-second deadline. Every run retries both the
  lower-ID offerer and higher-ID answerer. The 20-second negotiation deadline and
  original RMS threshold are retained; a fixed 700ms delay is no longer used as
  evidence of recovery. The failed-connection test uses the same replacement check.
- `node tests/voice-recovery.mjs`: deterministic delayed-session/connection/audio
  timelines for both retry roles. It rejects an old connected peer, continued
  silence, and samples from a connection replaced during measurement. These checks
  exercise the same waiting helpers as the real-browser test and run in CI.
- `node tests/browser-voice-game.mjs`: actual Hero desktop + God phone-sized touch UI,
  explicit join/microphone buttons, denial/retry, touch camera orbit and God focus,
  quick mute, deafen, leave, and console checks. Uses a synthetic microphone API mock.
- `npm run build:check`, `npm run build`, `node tests/ci.mjs` are the packaging and
  aggregate checks. The existing Windows CRLF failure in `patch-notes.mjs` scans old
  front matter (`pr: 7`) as player text; it is already addressed in separate PR #33
  and is not modified here.

Local browser setup: start `peer/server.mjs` on an unused loopback port with matching
PEER_ORIGINS, and Vite with VITE_PEER_WS_URL pointing to it. Harness configuration:
ACCEPT_BASE, VOICE_WS_URL, PW_CORE and PW_CHROME. Example ports used here: 5196/8796.
Browser evidence and timings are in ignored `logs/browser-acceptance/`; these tests
do not verify physical microphones, phones, headsets or internet NAT traversal.

API references: [WebRTC](https://www.w3.org/TR/webrtc/),
[Web Audio](https://www.w3.org/TR/webaudio/).

## 32-member topology verification

Run `node multiplayer/tests/voice-topology.mjs`, `proximity-voice.mjs` and
`voice-recovery.mjs` from the repository root (use the same tests-directory prefix).
The 32-member synthetic transport check covers symmetric bounded selection,
coincident-position fairness, spatial hysteresis, low-rate presence, stale-host
and session rejection, retry, moving out of range, host migration and no automatic
microphone capture. It observed 127 active pairs and 19,220 moving-state forwards
over 10 seconds, versus 99,200 for an unbounded 10Hz full mesh. These are metadata
and topology checks, not 32 real microphones, WAN/TURN or physical device acceptance.

Recovery lesson: a new-session topology message includes current selected peer
presence. A retry clears local membership; delivering just neighbor IDs would
allow an immediate SDP offer to arrive before the next position heartbeat and be
discarded. Session-bound presence seeding prevents that race.

The existing real-browser voice acceptance also passed with this topology: three
Chromium pages, guest-to-guest synthetic audio while the host stays out of voice,
left/right/head-turn positioning, distance cutoff, mute/deafen, track release,
offerer and answerer retries, failed-connection recovery and departure cleanup.
No physical microphone was accessed. This does not establish 32 live media feeds.
