# Multiplayer proof contract v1
All positions are metres, Y up, world x/z bounds +/-55. Server owns world. Transport JSON over WebSocket, max inbound 8 KiB; outbound snapshot <=256 KiB. No local forge/voice bridge. 32 players/room, multiple hero and god roles. Guest identity with cryptographic reconnect token, shareable random room code (12+ chars); no account service in proof.

Client messages:
{"type":"create","name":"Mog","role":"hero"}
{"type":"join","room":"CODE","name":"Friend","role":"god","token":"optional reconnect token"}
{"type":"input","seq":1,"move":{"x":0,"z":1},"yaw":0,"jump":false,"head":{"position":[0,1.65,0],"quaternion":[0,0,0,1]},"hands":[{"position":[0,1,0],"quaternion":[0,0,0,1]}]}
input move is world-space normalized planar direction; yaw is Y rotation radians (forward is -Z). head/hands are optional LOCAL offsets to authoritative player root, max reach2.5m; no world teleport. Server clamps/validates.
{"type":"action","seq":2,"action":"strike"} server uses yaw/reach/cooldown, never client damage.
{"type":"cast","seq":3,"spell":"skeleton|raise|grove|starfall","point":[0,0,0]} god only; range bounds, cost/cooldown/caps authoritative.
{"type":"role","role":"hero|god"} preserve identity, cooldown prevents role spam.
{"type":"ping","at":123}
Actions/input share monotonic seq across reconnect for client instance; welcome contains nextSeq to continue. Reject repeats. Resume rotates token only if old token acknowledged? Prefer stable token until room expiration; atomically replace old socket and invalidate its ability to submit.

Server:
{"type":"welcome","protocol":1,"room":"CODE","playerId":"id","token":"secret","nextSeq":1,"snapshot":{...}}
{"type":"state","snapshot":{...}}
{"type":"error","code":"room_full","message":"This room is full."}
{"type":"pong","at":123}
{"type":"event","kind":"hit|death|cast|join|leave","position":[0,0,0],"id":"..."}
Snapshot {tick,time,seed:41,room,players:[{id,name,role,position:[x,y,z],yaw,hp,mana,head?,hands?}],enemies:[{id,position:[x,y,z],yaw,hp}],edits:[{id,kind:'raise|starfall',x,z,radius,height}],groves:[{id,x,z}],maxPlayers:32}
Guest names plaintext display via textContent, max24 chars. Never place token in URL/log; room code in URL allowed. Tab hidden/reconnect sends zero input; input timeout 300ms stops movement. Room persists terrain/groves to user data separate from existing saves; disconnected players grace60s then drop; idle room sleeps/expires bound. Structural edits bounded64, enemies64, grovepoints64. Explicit room capacity, no unlimited claims.

Base world height (shared deterministic formula): 0.45*sin(x*0.09)*cos(z*0.07). Each edit radial smoothstep contribution: t=clamp(1-distance/radius,0,1); height += edit.height*t*t*(3-2*t). Surface water optional presentation only. Land movement uses surface function, raise lifts actors safely. Spawn [0,height(0,0),8].

Client game module public API: export createGame({canvas,onAction,onCast,onInput,onStatus}) -> {applySnapshot(snapshot,playerId),setRole(role),setSpell(spell),enterVR(),canVR() async,setActive(active),dispose()}. Renderer can keep render loop internal. No DOM UI design in this module. Root UI creates canvas/controls and wraps network. Game triggers onInput object payload excluding type/seq at <=20Hz; onAction('strike'); onCast(spell,[x,y,z]); setActive(false) clears input/pointer. Assets /assets/tree.glb /assets/skeleton.glb /assets/axe.glb optional lazy imports fallback simple placeholder only while loading. Camera local prediction for responsiveness reconciled to server state. VR movement stick relative head yaw, teleport optional not required; use trigger strike. God orbit WASD pan/rightdrag, point-click cast. All assets server-origin and GLTFLoader from pinned three dependency.

Owned files: server agent multiplayer/server/* and server unit checks if useful; client agent multiplayer/client/game.js only; root network/UI/package/deploy; verification agent multiplayer/tests/* after server/client ready. No active native game modifications, public deployment by root only.
