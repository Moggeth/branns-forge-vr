extends Node
## Native controller -> authenticated local OBS RPC. No AI, frame copying or video encoding here.
const PROFILE="Branns Forge Silent"
const COLLECTION="Branns Forge"
const SOURCE="Brann game only"
var game
var socket=WebSocketPeer.new()
var identified=false
var reconnect_at=0.0
var poll_at=0.0
var pending={}
var serial=0
var active=false
var duration=0.0
var busy=false
var polling=false
var last_path=""
var message=""
var message_until=0.0
var status_label:Label3D
var hold_seconds=1.0
var hold_time=0.0
var hold_latched=false
var hold_armed=false
var password=""
var connect_at=0.0
var launch_at=-30.0
var enabled=false

func setup(owner_game):
	game=owner_game
	enabled=not game.smoke and not game.diagnostic_offline
	if not enabled: return
	status_label=Label3D.new()
	game.camera.add_child(status_label)
	status_label.position=Vector3(-0.24,0.23,-0.9)
	status_label.font_size=23
	status_label.pixel_size=0.0008
	status_label.outline_size=5
	status_label.no_depth_test=true
	status_label.visible=false
	_connect_obs()

func _now()->float: return Time.get_ticks_msec()/1000.0

func _connect_obs():
	reconnect_at=_now()+5.0
	var file=OS.get_environment("APPDATA").path_join("obs-studio/plugin_config/obs-websocket/config.json")
	if not FileAccess.file_exists(file): return
	var config=JSON.parse_string(FileAccess.get_file_as_string(file))
	if not config is Dictionary or not config.get("server_enabled",false): return
	password=str(config.get("server_password",""))
	socket=WebSocketPeer.new()
	socket.connect_to_url("ws://127.0.0.1:%d"%int(config.get("server_port",4455)))
	connect_at=_now()

static func _hash64(value:String)->String:
	return Marshalls.raw_to_base64(value.sha256_buffer())

static func accepts_hotkey(tracker_name:String)->bool:
	return tracker_name.begins_with("right")

func hold_input(pressed:bool,delta:float)->bool:
	if not pressed:
		hold_armed=true
		hold_time=0.0
		hold_latched=false
		return false
	if not hold_armed or hold_latched: return false
	hold_time+=minf(delta,0.1)
	if hold_time<hold_seconds: return false
	hold_latched=true
	return true

func tick(delta):
	if not enabled: return
	socket.poll()
	var connection=socket.get_ready_state()
	if connection==WebSocketPeer.STATE_OPEN:
		while socket.get_available_packet_count()>0:
			var packet=JSON.parse_string(socket.get_packet().get_string_from_utf8())
			if packet is Dictionary: _packet(packet)
	elif connection==WebSocketPeer.STATE_CLOSED:
		if identified:
			identified=false
			_feedback("Recorder disconnected — check OBS",false)
		if _now()>=reconnect_at: _connect_obs()
	elif _now()-connect_at>6.0: socket.close()
	if identified and not polling and not busy and _now()>=poll_at:
		poll_at=_now()+(1.0 if active else 3.0)
		_poll_status()
	var pressed=false
	if game.vr:
		for hand in game.hands:
			if accepts_hotkey(str(hand.tracker)) and hand.get_is_active(): pressed=hand.is_button_pressed("by_button")
	if hold_input(pressed,delta): toggle_recording()
	if status_label!=null:
		status_label.visible=active or _now()<message_until or (hold_time>0.15 and not hold_latched)
		status_label.modulate=Color("ff786c") if active else Color("fff0ce")
		if not identified and active: status_label.text="REC status unknown\nCheck OBS"
		elif hold_time>0.15 and not hold_latched: status_label.text="Hold to %s video  %d%%"%["stop" if active else "start",mini(100,int(100*hold_time/hold_seconds))]
		elif _now()<message_until: status_label.text=message
		elif active: status_label.text="● REC  %02d:%02d\nHold right B · stop"%[int(duration)/60,int(duration)%60]

func _packet(packet:Dictionary):
	var data=packet.get("d",{})
	match int(packet.get("op",-1)):
		0:
			var auth={"rpcVersion":1,"eventSubscriptions":64}
			if data.has("authentication"):
				auth.authentication=_hash64(_hash64(password+str(data.authentication.salt))+str(data.authentication.challenge))
			socket.send_text(JSON.stringify({"op":1,"d":auth}))
		2:
			identified=true
			password=""
			poll_at=0.0
			print("RECORDING OBS connected")
		5:
			if data.get("eventType","")=="RecordStateChanged":
				var event=data.get("eventData",{})
				if event.get("outputState","") in ["OBS_WEBSOCKET_OUTPUT_STARTED","OBS_WEBSOCKET_OUTPUT_STOPPED"]:
					var was=active
					active=bool(event.get("outputActive",false))
					last_path=str(event.get("outputPath",last_path))
					poll_at=0.0
					if active!=was and not busy: _feedback("Recording started" if active else "Video saved",true)
		7:
			var id=str(data.get("requestId",""))
			if pending.has(id): pending[id]=data

func _rpc(type:String,data:Dictionary={})->Dictionary:
	if not identified: return {"error":"OBS is not connected"}
	serial+=1
	var id="brann-"+str(serial)
	pending[id]=null
	var err=socket.send_text(JSON.stringify({"op":6,"d":{"requestType":type,"requestId":id,"requestData":data}}))
	if err!=OK:
		pending.erase(id)
		return {"error":"OBS send failed"}
	var deadline=_now()+6.0
	while pending.get(id)==null and identified and _now()<deadline: await get_tree().process_frame
	var response=pending.get(id)
	pending.erase(id)
	if response==null: return {"error":"OBS did not confirm — check recording status"}
	if not response.get("requestStatus",{}).get("result",false):
		return {"error":str(response.get("requestStatus",{}).get("comment","OBS rejected request"))}
	return response.get("responseData",{})

func _poll_status():
	polling=true
	var result=await _rpc("GetRecordStatus")
	polling=false
	if result.has("error"): return
	active=bool(result.get("outputActive",false))
	duration=float(result.get("outputDuration",0))/1000.0

func toggle_recording():
	if not enabled or busy: return
	if not identified:
		if _now()-launch_at>15.0:
			launch_at=_now()
			var launcher=ProjectSettings.globalize_path("res://../scripts/Start-OBS.ps1")
			OS.create_process("powershell.exe",PackedStringArray(["-NoProfile","-ExecutionPolicy","Bypass","-File",launcher]),false)
		_feedback("Opening recorder…\nHold right B again when ready",false)
		return
	busy=true
	await _change_recording()
	busy=false
	poll_at=0.0

func _change_recording():
	var profile=await _rpc("GetProfileList")
	var collection=await _rpc("GetSceneCollectionList")
	if profile.get("currentProfileName","")!=PROFILE or collection.get("currentSceneCollectionName","")!=COLLECTION:
		_feedback("Select Branns Forge Silent\nand Branns Forge in OBS",false)
		return
	var state=await _rpc("GetRecordStatus")
	if state.has("error"):
		_feedback(state.error,false)
		return
	active=bool(state.get("outputActive",false))
	var result:Dictionary
	if active:
		_feedback("Saving video…",false)
		result=await _rpc("StopRecord")
		if not result.has("error"):
			active=false
			last_path=str(result.get("outputPath",""))
			print("RECORDING saved ",last_path)
			_feedback("Video saved\n"+last_path.get_file(),true)
	else:
		# Only our known game source and scene can be recorded from this control.
		var source=await _rpc("GetSceneItemId",{"sceneName":COLLECTION,"sourceName":SOURCE})
		if source.has("error"):
			_feedback("Game capture source missing\nRun OBS setup",false)
			return
		var geometry=await _rpc("GetSceneItemTransform",{"sceneName":COLLECTION,"sceneItemId":source.sceneItemId})
		if float(geometry.get("sceneItemTransform",{}).get("sourceWidth",0))<=0:
			_feedback("Game mirror unavailable\nRestore the game window",false)
			return
		result=await _rpc("SetCurrentProgramScene",{"sceneName":COLLECTION})
		if not result.has("error"): result=await _rpc("StartRecord")
		if not result.has("error"):
			active=true
			duration=0
			_feedback("Recording started\nHold right B · stop",true)
	if result.has("error"): _feedback(result.error,false)

func _feedback(text:String,success:bool):
	message=text
	message_until=_now()+6.0
	print("RECORDING ",text.replace("\n"," "))
	if success and game.vr:
		for hand in game.hands:
			if accepts_hotkey(str(hand.tracker)): game.adventure.haptic(hand,"ready")

func button_text()->String:
	if busy: return "Saving…" if active else "Starting…"
	if not identified: return "Connect recorder"
	return "Stop video" if active else "Start video"
