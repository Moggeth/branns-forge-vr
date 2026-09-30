extends Node
## Outdoor weather adapter; shares the desktop lab's tested surface and sound model.
const SAVE="user://weather_state.json"
const OUTDOORS=["forge_yard","sandstone_quarry","pinewood_ruins","mushroom_glade","sky_garden","orchard_highlands"]
const OrchardGround=preload("res://orchard_ground.gd")
const OrchardFoliage=preload("res://orchard_foliage.gd")
var game
var stage
var camera
var env
var sun
var engine
var zone=""
var rebuilding=false
var coverage_ready=false
var next_save=30.0
var zone_states={}
var enabled=true
var diagnostic=false
var next_refresh=0.0
var scanned_revision=-1

func setup(g):
	game=g; stage=g; camera=g.camera
	env=g.get_node("AdventureEnvironment").environment
	sun=g.get_node("AdventureSun")
	diagnostic=game.diagnostic_offline or game.smoke
	engine=preload("res://weather_lab.gd").new(); game.add_child(engine); engine.setup(self,true)
	var q:int=game.orchard_atmosphere.quality
	engine.rain_budget=([220,360,480][q] if game.vr else [300,480,640][q])
	engine.cycle=true; engine.cycle_seconds=1200; engine.automatic=true; engine.automatic_at=210
	if not diagnostic and FileAccess.file_exists(SAVE):
		var data=JSON.parse_string(FileAccess.get_file_as_string(SAVE))
		if data is Dictionary:
			engine.hour=clampf(float(data.get("hour",16)),0,23.99)
			engine.muted=bool(data.get("muted",false)); engine.cycle=bool(data.get("cycle",true)); engine.automatic=bool(data.get("automatic",true)); enabled=bool(data.get("enabled",true))
			var mode=str(data.get("weather","clear")); engine.set_weather(mode if mode in ["clear","rain","snow"] else "clear")
			if data.get("zones") is Dictionary: zone_states=data.zones
	engine.visible=false
	engine.set_overlay_active(false,true)
	refresh.call_deferred()
	print("WEATHER_GAME_READY cycle_seconds=1200 outdoors=6 async_surface_scan=true")

func remember_zone():
	# A cooperative scan temporarily clears these arrays; never persist that scratch state.
	if coverage_ready and zone in OUTDOORS: zone_states[zone]={"snow":engine.snow[0],"wet":engine.wet[0]}

func refresh():
	if rebuilding: return
	var previous_zone=zone
	var preserve_coverage=coverage_ready and enabled and previous_zone==game.adventure.zone
	remember_zone(); rebuilding=true; coverage_ready=false
	zone=game.adventure.zone
	var scan_zone=zone
	engine.surface_root=game.scene.zones.orchard_highlands.root if zone=="orchard_highlands" else null
	# A moving grid scans cooperatively. Keep the previous completed map visible
	# until its replacement is ready; only travel/off actually hides weather.
	if not preserve_coverage:
		engine.visible=false
		engine.overlay.set_shader_parameter("weather_visible",0.0)
	if zone not in OUTDOORS or not enabled:
		engine.ambience.volume_db=-80
		for voice in engine.voices: voice.stop()
		rebuilding=false; return
	var center=Vector2(roundf(camera.global_position.x/8)*8,roundf(camera.global_position.z/8)*8)
	# Surface rasterization needs the next origin, but the shader must retain the
	# previous origin until the new image is uploaded in the same frame.
	engine.ORIGIN=center-Vector2(12,12)
	engine.heights.fill(.04); engine.snow.fill(0); engine.wet.fill(0)
	engine.kinds.fill("earth" if zone=="orchard_highlands" else "stone")
	var start=Time.get_ticks_msec()
	await engine.capture_surfaces(true)
	if not enabled or game.adventure.zone!=scan_zone:
		# Travel or a menu action may have occurred while the scan yielded.
		rebuilding=false
		refresh.call_deferred()
		return
	var state=zone_states.get(zone,{})
	engine.snow.fill(clampf(float(state.get("snow",0)),0,1)); engine.wet.fill(clampf(float(state.get("wet",0)),0,1))
	coverage_ready=true
	for old in engine.overlay_targets:
		if is_instance_valid(old) and old.material_overlay==engine.overlay: old.material_overlay=null
	engine.overlay_targets.clear()
	var possible:Node=game.scene.zones.orchard_highlands.root if zone=="orchard_highlands" else game
	for node in possible.find_children("*","GeometryInstance3D",true,false):
		if not (node is MeshInstance3D or node is MultiMeshInstance3D) or node.is_in_group("distant_horizon") or node.get_meta("atmospheric_ground",false) or node.name.begins_with("gk_grass") or node.name.begins_with("Woodland_") or engine.is_ancestor_of(node): continue
		if node.global_position.distance_to(camera.global_position)>70: continue
		engine.overlay_targets.append(node)
	engine.update_field(); engine.field_texture.update(engine.field_image)
	engine.overlay.set_shader_parameter("grid_origin",engine.ORIGIN)
	engine.set_overlay_active(engine.snow[0]+engine.wet[0]>.03,true)
	engine.overlay.set_shader_parameter("weather_visible",1.0)
	scanned_revision=game.workshop.revision
	engine.visible=true; rebuilding=false; next_refresh=game.elapsed+8
	print("WEATHER_ZONE zone=",zone," scan_wall_ms=",Time.get_ticks_msec()-start)

func tick(delta):
	if engine==null: return
	if game.adventure.zone!=zone:
		if not rebuilding: refresh.call_deferred()
		return
	if not enabled or zone not in OUTDOORS or rebuilding:
		if engine.cycle: engine.hour=fposmod(engine.hour+delta*24/engine.cycle_seconds,24)
		# The world clock advances outside the weather-covered zones too.
		# Keep their distant scenery aligned with the current sky colour.
		if not rebuilding: game.adventure.sync_horizon()
		return
	var middle=engine.ORIGIN+Vector2(12,12)
	if game.elapsed>next_refresh and (Vector2(camera.global_position.x,camera.global_position.z).distance_to(middle)>7 or game.workshop.revision!=scanned_revision):
		refresh.call_deferred(); return
	engine.tick(delta)
	OrchardFoliage.weather(engine.wind,engine.wind_strength,engine.wet[0])
	preload("res://ground_surface_palette.gd").weather(engine.wet[0],engine.snow[0])
	if zone=="orchard_highlands":
		OrchardGround.weather(engine.wet[0],engine.snow[0])
		game.orchard_atmosphere.tick(engine.hour,engine.weather,engine.wind)
	game.adventure.sync_horizon()
	# Rain meeting existing outdoor fire has a quiet hiss, without changing combat damage.
	if engine.weather=="rain" and game.firecraft!=null and int(game.elapsed*2)!=int((game.elapsed-delta)*2):
		for pool in game.firecraft.pools:
			if pool.zone!=zone: continue
			var p=pool.node.global_position; var id=engine.cell_index(p)
			if id>=0 and absf(engine.heights[id]-p.y)<.4: engine.sound("hiss",p); break
	if game.elapsed>=next_save: next_save=game.elapsed+30; save()

func save():
	if diagnostic: return
	remember_zone()
	var file=FileAccess.open(SAVE+".tmp",FileAccess.WRITE)
	if file==null: push_warning("WEATHER_SAVE unavailable"); return
	file.store_string(JSON.stringify({"hour":engine.hour,"weather":engine.weather,"muted":engine.muted,"cycle":engine.cycle,"automatic":engine.automatic,"enabled":enabled,"zones":zone_states})); file.close()
	if DirAccess.rename_absolute(SAVE+".tmp",SAVE)!=OK: push_warning("WEATHER_SAVE replace failed")

func _exit_tree():
	if is_instance_valid(engine): save()

func rows()->Array:
	return [["Clear skies","weather:clear"],["Rain","weather:rain"],["Snow","weather:snow"],["Sunrise / melt","weather:morning"],["Night / stars","weather:night"],["Cycle: "+("on" if engine.cycle else "off"),"weather:cycle"],["Auto weather: "+("on" if engine.automatic else "off"),"weather:auto"],["Sound: "+("off" if engine.muted else "on"),"weather:mute"],["Weather: "+("on" if enabled else "off"),"weather:enabled"]]

func action(value:String):
	match value:
		"clear","rain","snow": engine.set_weather(value); engine.automatic=false
		"morning": engine.hour=10.0; engine.set_weather("clear"); engine.automatic=false
		"night": engine.hour=0.0; engine.set_weather("clear"); engine.automatic=false
		"cycle": engine.cycle=not engine.cycle
		"auto": engine.automatic=not engine.automatic; engine.automatic_at=engine.elapsed+180
		"mute":
			engine.muted=not engine.muted
			if engine.muted:
				for voice in engine.voices: voice.stop()
		"enabled":
			enabled=not enabled
			if not enabled:
				engine.visible=false
				engine.overlay.set_shader_parameter("weather_visible",0.0)
				game.adventure._apply_zone_environment(zone)
			refresh.call_deferred()
	save(); game.qol._build()
	game._notice("Weather · "+engine.weather+" · %02d:%02d"%[int(engine.hour),int(fposmod(engine.hour,1)*60)],4)
