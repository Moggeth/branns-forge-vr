extends Node
## Local asymmetric round. Godot owns every unit, hit, and objective; the browser only issues bounded orders.
const WorldZones = preload("res://world_zones.gd")
const ZONE = "pinewood_ruins"
const ROUND_SECONDS = 150.0
const BEACON_OFFSETS = [Vector3(-8,0,3),Vector3(0,0,-5),Vector3(8,0,3)]
const LANES = {"west":Vector3(-11,0,-1),"north":Vector3(0,0,-11),"east":Vector3(11,0,-1)}
const CAMERA_SIZE = Vector2i(1024,576)
const FRAME_INTERVAL = 0.20 ## Five live frames per second; rendering and readback stop without a viewer.
var game
var session_id = ""
var phase = "waiting"
var round_time = 0.0
var next_sync = 0.0
var sync_busy = false
var last_ack = 0
var beacons = []
var summons = []
var warnings = []
var original_enemies = []
var defeated = 0
var gloom_until = 0.0
var gloom_applied = false
var center = Vector3.ZERO
var test_mode = false
var local_mode = false
var tactical_viewport: SubViewport
var tactical_camera: Camera3D
var view_live = false
var view_yaw = 0.64
var view_pitch = 0.84
var view_zoom = 39.0
var next_frame = 0.0
var frame_busy = false
var view_warmup = 0
var frame_count = 0
var frame_ms_sum = 0.0
var frame_ms_max = 0.0
var frame_read_ms_sum = 0.0
var async_capture_supported = true

func setup(owner_game, offline_test = false, native_local = false):
	game = owner_game
	test_mode = offline_test
	local_mode = native_local
	center = game.scene.zones[ZONE].center
	game.adventure.travel(ZONE)
	game._notice("DIRECTOR'S GAME · Find three waystones. Hold position beside each to wake it. Another player directs the threats.",12)
	for enemy in game.scene.enemies:
		if str(enemy.get_meta("zone","")) == ZONE:
			original_enemies.append(enemy)
			enemy.visible = false
			game._set_collisions(enemy,false)
	_build_waystones()
	if not test_mode and not local_mode:
		_build_camera()
		_open_session.call_deferred()
	elif local_mode:
		print("DIRECTOR_LOCAL_SIM one_world=true jpeg_bridge=false")

func _build_camera():
	tactical_viewport = SubViewport.new()
	tactical_viewport.name = "DirectorLiveView"
	tactical_viewport.size = CAMERA_SIZE
	tactical_viewport.world_3d = game.get_world_3d()
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	tactical_viewport.msaa_3d = Viewport.MSAA_2X
	game.add_child(tactical_viewport)
	tactical_camera = Camera3D.new()
	tactical_camera.name = "DirectorCamera"
	tactical_camera.fov = 55.0
	tactical_camera.far = 320.0
	tactical_viewport.add_child(tactical_camera)
	tactical_camera.current = true
	_position_camera()

func _position_camera():
	if tactical_camera == null: return
	var horizontal = cos(view_pitch) * view_zoom
	tactical_camera.global_position = center + Vector3(sin(view_yaw) * horizontal, sin(view_pitch) * view_zoom, cos(view_yaw) * horizontal)
	tactical_camera.look_at(center + Vector3(0,0.8,0),Vector3.UP)

func _build_waystones():
	var root: Node3D = game.adventure.zone_groups[ZONE]
	for i in range(BEACON_OFFSETS.size()):
		var stone = Node3D.new()
		stone.name = "DirectorWaystone%d" % (i+1)
		root.add_child(stone)
		stone.global_position = center+BEACON_OFFSETS[i]
		WorldZones.rock(stone,Vector3(0,0.63,0),Vector3(0.8,1.28,0.62),"667d77")
		var gem = WorldZones.rock(stone,Vector3(0,1.32,0),Vector3(0.38,0.50,0.25),"608381")
		var ring = WorldZones.cyl(stone,Vector3(0,0.035,0),1.0,0.07,"83a7a0","disc",0.25)
		WorldZones.label(stone,"WAYSTONE %d\nSTAND CLOSE"%(i+1),Vector3(0,1.87,0),20,"d9ebd7")
		beacons.append({"root":stone,"gem":gem,"ring":ring,"claimed":false,"charge":0.0})

func _open_session():
	var response = await _director_request("session/start",{"mode":"pinewood_waystones"})
	if response.has("sessionId"):
		session_id = str(response.sessionId)
		print("DIRECTOR_GAME session=",session_id," zone=",ZONE)
	else:
		push_warning("Director tabletop unavailable: "+str(response.get("error","connection failed")))

func tick(delta):
	if phase == "running":
		round_time += delta
		_update_waystones(delta)
		_update_warnings()
		_count_defeated()
		if game.adventure.zone != ZONE:
			game._notice("You left the Pinewood contest. The director holds the forest.",6)
			_finish("director_win")
		elif game.adventure.dying or game.adventure.hp <= 0.0: _finish("director_win")
		elif beacons.all(func(b): return b.claimed): _finish("adventurer_win")
		elif round_time >= ROUND_SECONDS: _finish("director_win")
	_update_gloom()
	if view_live and not frame_busy and game.elapsed >= next_frame and view_warmup >= 2:
		next_frame = game.elapsed + FRAME_INTERVAL
		_send_frame()
	elif view_live: view_warmup += 1
	if not test_mode and not local_mode and session_id != "" and not sync_busy and game.elapsed >= next_sync:
		next_sync = game.elapsed + 0.15
		_sync()

func _update_waystones(delta):
	var player = game.camera.global_position
	for i in range(beacons.size()):
		var b = beacons[i]
		if b.claimed: continue
		var p: Vector3 = b.root.global_position
		var near = Vector2(player.x-p.x,player.z-p.z).length() < 1.35
		b.charge = clampf(float(b.charge)+(delta if near else -delta*1.5),0.0,1.8)
		b.gem.material_override = WorldZones.mat("e1d28b" if near else "608381",1.2 if near else 0.12)
		b.ring.scale.x = 1.0+float(b.charge)*0.13
		b.ring.scale.z = b.ring.scale.x
		if b.charge >= 1.8:
			b.claimed = true
			b.gem.material_override = WorldZones.mat("ffd47d",1.8)
			b.ring.material_override = WorldZones.mat("f4c777",1.2)
			game._effect(p+Vector3.UP*1.3,Color("ffe5a2"),0.8,1.8)
			game._notice("Waystone %d awakened · %d / 3"%[i+1,_claimed()],3)

func _claimed() -> int:
	var count = 0
	for b in beacons:
		if b.claimed: count += 1
	return count

func _warning(type: String,lane: String):
	var p: Vector3 = center+LANES.get(lane,LANES.north)
	var player: Vector3 = game.camera.global_position
	if Vector2(player.x-p.x,player.z-p.z).length() < 4.5:
		p += Vector3(0,0,-3) if lane != "north" else Vector3(3,0,0)
	var marker = Node3D.new()
	game.adventure.zone_groups[ZONE].add_child(marker)
	marker.global_position = p
	WorldZones.cyl(marker,Vector3(0,0.05,0),0.92,0.10,"ef9565","disc",0.8)
	WorldZones.label(marker,"INCOMING",Vector3(0,1.3,0),21,"ffd2a5")
	warnings.append({"type":type,"position":p,"until":game.elapsed+2.2,"marker":marker})
	game._notice("The ground glows at the %s approach!"%lane,2)

func _update_warnings():
	for w in warnings.duplicate():
		if game.elapsed < float(w.until): continue
		if is_instance_valid(w.marker): w.marker.queue_free()
		warnings.erase(w)
		_spawn(w.type,w.position)

func _spawn(type: String,at: Vector3):
	var creature = "skeleton" if type == "skeletons" else ("wisp" if type == "wisps" else "golem")
	var count = 2 if type in ["skeletons","wisps"] else 1
	for i in range(count):
		var p = at+Vector3((float(i)-0.5)*1.35,0,0)
		WorldZones.enemy(game,game.scene,ZONE,p,creature)
		var enemy: Node3D = game.scene.enemies.back()
		enemy.set_meta("director_spawned",true)
		enemy.set_meta("alive",true)
		enemy.set_meta("home",p)
		var hp = {"skeleton":56,"wisp":38,"golem":95}[creature]
		enemy.set_meta("hp",hp)
		enemy.set_meta("max_hp",hp)
		enemy.set_meta("damage",11 if creature != "golem" else 18)
		enemy.set_meta("id","director-"+str(enemy.get_instance_id()))
		enemy.reparent(game.adventure.zone_groups[ZONE])
		game.animation.register(enemy)
		summons.append(enemy)
	game._effect(at+Vector3.UP,Color("e0b9fa"),0.55,1.1)

func _count_defeated():
	for enemy in summons:
		if is_instance_valid(enemy) and not enemy.get_meta("alive",true) and not enemy.get_meta("director_counted",false):
			enemy.set_meta("director_counted",true)
			defeated += 1

func _update_gloom():
	var dark = phase == "running" and game.elapsed < gloom_until
	if not dark and not gloom_applied: return
	var world: WorldEnvironment = game.get_node_or_null("AdventureEnvironment") as WorldEnvironment
	if world == null: return
	if dark:
		world.environment.ambient_light_energy = 0.13
		world.environment.fog_enabled = true
		world.environment.fog_density = 0.025
		world.environment.fog_light_color = Color("667495")
		gloom_applied = true
	elif gloom_applied:
		gloom_applied = false
		game.adventure._apply_zone_environment(ZONE)

func _finish(result: String):
	if phase != "running": return
	phase = result
	gloom_until = 0.0
	for enemy in summons:
		if is_instance_valid(enemy): enemy.set_meta("director_paused",true)
	game._notice("The waystones shine! Adventurer wins." if result == "adventurer_win" else "The forest holds. Director wins.",12)
	print("DIRECTOR_RESULT phase=",phase," seconds=",snappedf(round_time,0.1)," beacons=",_claimed()," defeated=",defeated)

func _rematch():
	for enemy in summons:
		if is_instance_valid(enemy):
			game.scene.enemies.erase(enemy)
			enemy.queue_free()
	summons.clear()
	for w in warnings:
		if is_instance_valid(w.marker): w.marker.queue_free()
	warnings.clear()
	for b in beacons:
		b.claimed = false
		b.charge = 0.0
		b.gem.material_override = WorldZones.mat("608381",0.12)
		b.ring.material_override = WorldZones.mat("83a7a0",0.25)
	defeated = 0
	round_time = 0.0
	gloom_until = 0.0
	phase = "waiting"
	game.adventure.hp = 100.0
	game.adventure.travel(ZONE)
	game._notice("New round ready. The director may begin when you're set.",6)

func apply_command(command: Dictionary):
	var type = str(command.get("type",""))
	if type == "rematch" and phase in ["adventurer_win","director_win"]: _rematch()
	elif type == "start" and phase == "waiting":
		phase = "running"
		round_time = 0.0
		game.adventure.travel(ZONE)
		game._notice("The director has begun! Wake all three waystones before the forest closes.",8)
	elif phase == "running" and type == "gloom":
		gloom_until = game.elapsed+12.0
		game._notice("Dusk veil! Stay near a light—or ask Little Wing to guide you.",5)
	elif phase == "running" and type in ["skeletons","wisps","golem"]:
		_warning(type,str(command.get("lane","north")))

func _snapshot() -> Dictionary:
	var p: Vector3 = game.camera.global_position-center
	var entities = []
	for enemy in summons:
		if not is_instance_valid(enemy): continue
		var e: Vector3 = enemy.global_position-center
		entities.append({"id":str(enemy.get_meta("id","")),"type":str(enemy.get_meta("enemy_type","")),"x":snappedf(e.x,0.01),"z":snappedf(e.z,0.01),"alive":bool(enemy.get_meta("alive",true)),"hp":float(enemy.get_meta("hp",0))})
	var stones = []
	for b in beacons:
		var v: Vector3 = b.root.global_position-center
		stones.append({"x":v.x,"z":v.z,"claimed":b.claimed,"charge":snappedf(float(b.charge)/1.8,0.01)})
	var snapshot = {"phase":phase,"zone":ZONE,"secondsLeft":maxf(0,ROUND_SECONDS-round_time),"health":game.adventure.hp,"defeated":defeated,"incoming":warnings.reduce(func(total,w): return total+(2 if w.type in ["skeletons","wisps"] else 1),0),"player":{"x":snappedf(p.x,0.01),"z":snappedf(p.z,0.01)},"beacons":stones,"enemies":entities,"gloom":phase == "running" and game.elapsed < gloom_until}
	if tactical_camera != null:
		var marks = {}
		for lane in LANES:
			var world_point: Vector3 = center+LANES[lane]+Vector3(0,0.7,0)
			if tactical_camera.is_position_behind(world_point): continue
			var screen_point = tactical_camera.unproject_position(world_point)
			marks[lane] = {"x":snappedf(screen_point.x/float(CAMERA_SIZE.x),0.001),"y":snappedf(screen_point.y/float(CAMERA_SIZE.y),0.001)}
		snapshot["lanes"] = marks
	if game.fairy != null and game.fairy.active:
		var f: Vector3 = game.fairy.avatar.global_position-center
		snapshot["fairy"] = {"x":snappedf(f.x,0.01),"z":snappedf(f.z,0.01)}
	return snapshot

func _sync():
	sync_busy = true
	var response = await _director_request("poll",{"sessionId":session_id})
	# Dummy headless rendering has no texture to read back; simulation/network checks still run.
	var should_view = bool(response.get("viewerConnected",false)) and DisplayServer.get_name() != "headless"
	if should_view != view_live:
		view_live = should_view
		view_warmup = 0
		tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	if response.has("view"):
		var view: Dictionary = response.view
		view_yaw = float(view.get("yaw",view_yaw))
		view_pitch = float(view.get("pitch",view_pitch))
		view_zoom = float(view.get("zoom",view_zoom))
		_position_camera()
	for command in response.get("commands",[]):
		var id = int(command.get("id",0))
		if id <= last_ack: continue
		apply_command(command)
		last_ack = id
	await _director_request("snapshot",{"sessionId":session_id,"ack":last_ack,"game":_snapshot()})
	sync_busy = false

func _send_frame():
	if tactical_viewport == null or session_id == "": return
	frame_busy = true
	# Render the second camera only for captured frames, rather than every headset frame.
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	# Ask the rendering device for an asynchronous GPU download after drawing.
	await RenderingServer.frame_post_draw
	if not view_live or tactical_viewport == null:
		frame_busy = false
		return
	if async_capture_supported:
		var rd = RenderingServer.get_rendering_device()
		var rd_texture = RenderingServer.texture_get_rd_texture(tactical_viewport.get_texture().get_rid())
		if rd != null and rd_texture.is_valid() and rd.texture_get_format(rd_texture).format == RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM:
			var result = rd.texture_get_data_async(rd_texture,0,_on_frame_data)
			if result == OK: return
		async_capture_supported = false
		push_warning("Director GPU async capture unavailable; using synchronous capture.")
	var encode_started = Time.get_ticks_usec()
	var image = tactical_viewport.get_texture().get_image()
	if image == null or image.is_empty():
		frame_busy = false
		return
	var read_ms = float(Time.get_ticks_usec()-encode_started)/1000.0
	_upload_frame_image(image,encode_started,read_ms)

func _on_frame_data(bytes: PackedByteArray):
	if not view_live or bytes.size() != CAMERA_SIZE.x*CAMERA_SIZE.y*4:
		frame_busy = false
		return
	var started = Time.get_ticks_usec()
	var image = Image.create_from_data(CAMERA_SIZE.x,CAMERA_SIZE.y,false,Image.FORMAT_RGBA8,bytes)
	_upload_frame_image(image,started,0.0)

func _upload_frame_image(image: Image, encode_started: int, read_ms: float):
	var jpg = image.save_jpg_to_buffer(0.78)
	if jpg.is_empty():
		frame_busy = false
		return
	var frame_ms = float(Time.get_ticks_usec()-encode_started)/1000.0
	frame_count += 1
	frame_ms_sum += frame_ms
	frame_read_ms_sum += read_ms
	frame_ms_max = maxf(frame_ms_max,frame_ms)
	if frame_count == 1 or frame_count % 60 == 0:
		print("DIRECTOR_FRAME samples=",frame_count," total_avg_ms=",snappedf(frame_ms_sum/frame_count,0.1)," read_avg_ms=",snappedf(frame_read_ms_sum/frame_count,0.1)," total_max_ms=",snappedf(frame_ms_max,0.1)," async=",async_capture_supported," jpg_bytes=",jpg.size())
	var http = HTTPRequest.new()
	game.add_child(http)
	http.timeout = 3.0
	var error = http.request_raw(game.service+"/api/director/frame",PackedStringArray(["Content-Type: image/jpeg","X-Director-Session: "+session_id]),HTTPClient.METHOD_POST,jpg)
	if error == OK: await http.request_completed
	http.queue_free()
	frame_busy = false

func _director_request(path: String, body: Dictionary) -> Dictionary:
	var http = HTTPRequest.new()
	game.add_child(http)
	http.timeout = 4.0
	var error = http.request(game.service+"/api/director/"+path,PackedStringArray(["Content-Type: application/json"]),HTTPClient.METHOD_POST,JSON.stringify(body))
	if error != OK:
		http.queue_free()
		return {"error":"Director link unavailable."}
	var reply = await http.request_completed
	http.queue_free()
	if reply[0] != HTTPRequest.RESULT_SUCCESS: return {"error":"Director link interrupted."}
	var data = JSON.parse_string(reply[3].get_string_from_utf8())
	return data if data is Dictionary else {"error":"Invalid director response."}
