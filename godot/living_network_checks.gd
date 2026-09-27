extends Node
## Offline isolated service plus real native scene lifecycle. No voice/generation requests.
var game
var failures=[]
var serial=0

func check(ok:bool,message:String):
	if not ok: failures.append(message)

func package(version:int)->Dictionary:
	return {"schema":1,"id":"network-lantern","version":version,"name":"Network lantern v"+str(version),"kind":"device","scope":{"kind":"design","targetId":"network-lantern"},"provenance":{"prompt":"Keep my held lantern while improving it.","interpretation":"Offline integration fixture","origin":"demo","parentIds":[]},"dependencies":[],"entities":[{"id":"lantern","name":"Lantern","shape":"box","position":[-6,1,6],"size":[.2,.3,.2],"color":"#ddaa55" if version==1 else "#55aadd","material":"wood","static":false,"components":[{"type":"grabbable","config":{"mass":1}},{"type":"trigger","config":{"event":"triggered"}}]}],"links":[],"rules":[]}

func request(action:String,payload:Dictionary)->Dictionary:
	serial+=1
	if action in ["publish","rollback","publish-batch"]: payload["requestId"]="native-network-"+str(serial)
	return await game._request("/api/vr/living/"+action,payload)

func refresh()->Dictionary:
	var state=await game._request("/api/vr/state")
	check(state.has("liveWorkshop"),"State missing Living Workshop")
	if state.has("liveWorkshop"): game.living.sync(state.liveWorkshop)
	return state.get("liveWorkshop",{})

func step(count:int=8):
	for i in range(count):
		game.elapsed+=1.0/90.0
		game.living.tick(1.0/90.0)
		await get_tree().process_frame

func drain():
	for i in range(300):
		await step(1)
		if not game.living.network_busy and game.living.ack_queue.is_empty() and game.living.events_queue.is_empty(): return
	failures.append("Native event/ACK queue failed to drain")

func run(owner_game):
	game=owner_game
	game.set_process(false); game.smoke=true; game.diagnostic_offline=false
	game.living.next_save=1e12
	var one=package(1)
	var published=await request("publish",{"package":one})
	check(published.get("status","")=="published","HTTP initial publish failed")
	await refresh(); await step(12); await drain()
	check(game.living.active.has(one.id),"Initial native package did not activate")
	if not game.living.active.has(one.id): finish(); return
	var state=await refresh()
	check(state.deployments[one.id].status=="applied","Initial application not acknowledged")
	var old=game.living.active[one.id].entities.lantern.node
	var hand=Node3D.new(); game.add_child(hand); hand.global_position=old.global_position
	check(game.living.components.try_grab(hand),"Fixture lantern could not be physically grabbed")
	var two=package(2)
	await request("publish",{"package":two}); await refresh(); await step(12); await drain()
	check(game.living.active[one.id].manifest.version==1,"Held version changed before release")
	check(is_instance_valid(old),"Held original was destroyed")
	state=await refresh(); check(state.deployments[one.id].status=="deferred","Held update was not reported deferred")
	check(game.living.components.release(hand),"Release failed")
	await step(12); await drain(); state=await refresh()
	check(game.living.active[one.id].manifest.version==2,"Released package did not update")
	check(state.deployments[one.id].status=="applied","Released update missing application ACK")
	check(state.history.size()==2,"Both immutable versions not preserved")
	var invalid=package(3); invalid.entities[0].components.append({"type":"unknown_engine","config":{}})
	var rejected=await request("publish",{"package":invalid}); check(rejected.has("error"),"Unsupported engine primitive was accepted")
	await refresh(); await step(4); check(game.living.active[one.id].manifest.version==2,"Rejected revision disturbed working version")
	await request("rollback",{"id":one.id,"version":1}); await refresh(); await step(12); await drain()
	check(game.living.active[one.id].manifest.version==1,"Historical rollback did not activate")
	await request("rollback",{"id":one.id,"version":0}); await refresh(); await step(12); await drain(); state=await refresh()
	check(not game.living.active.has(one.id),"Unpublish left native geometry active")
	check(state.deployments[one.id].status=="applied" and state.deployments[one.id].version==0,"Removal missing native ACK")
	check(state.history.size()==2,"Removal erased history")
	hand.queue_free(); await step(2)
	finish()

func finish():
	game.diagnostic_offline=true
	print("LIVING_NETWORK_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)
