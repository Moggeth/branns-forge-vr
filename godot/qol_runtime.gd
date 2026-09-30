extends Node
## Comfort settings, wrist inventory and safe reset. No external calls are made here.
var game
const ResourceGuide = preload("res://resource_guide.gd")
var supplies_index := 0
var supplies_selected := 0
var supplies_snapshot := {}
var supplies_pages_cache: Array = []
var next_supplies_sample := 0.0
var settings = {"dominant":"right","turn":"snap","snap_degrees":30,"turn_speed":60,"seated":false,"height_offset":0.0,"reach":3.0,"throw_arc":false}
var menu: Node3D
var title: Label3D
var detail: Label3D
var tracking_space: Node3D
var buttons: Array = []
var page = "quick"
var opened = false
var latch = false
var ready_queue: Array = []
var item_index = 0
var selected_item = ""
var announced = {}
var last_summary = ""
var config_path = "user://comfort.cfg"
var recording_button:Node3D
var presentation_label: Label3D
var demo_reset_until=-1.0
var travel_page=0

func setup(owner_game):
	game = owner_game
	if not game.smoke and not game.diagnostic_offline:
		var cfg = ConfigFile.new()
		if cfg.load(config_path) == OK:
			for key in settings: settings[key] = cfg.get_value("comfort",key,settings[key])
	_validate()
	# Runtime floor calibration changes between sessions; never replay an old offset.
	print("HEIGHT discarded_saved_offset=",settings.height_offset)
	settings.height_offset=0.0
	# The XR origin carries the offset used by stereo rendering as well as poses.
	tracking_space = XROrigin3D.new()
	game.rig.add_child(tracking_space)
	game.camera.reparent(tracking_space)
	for hand in game.hands: hand.reparent(tracking_space)
	apply_height()
	if game.vr:
		var xr=XRServer.find_interface("OpenXR")
		if xr!=null and xr.has_signal("pose_recentered"): xr.pose_recentered.connect(_recenter_height)
	menu = Node3D.new()
	game.add_child(menu)
	menu.name = "WristToolbelt"
	if game.vr: menu.scale=Vector3.ONE*0.75
	game.adventure._box(menu,Vector3(0,0,-0.02),Vector3(0.80,1.04,0.025),Color("162f32"))
	title = _label(menu,"BRANN'S TOOLBELT",Vector3(0,0.43,0),24)
	detail = _label(menu,"",Vector3(0,-0.43,0.008),15)
	detail.width = 570
	detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_build()
	menu.visible = false
	game._notice("Press left B to open or close your hand menu; use your right hand to select. Stand naturally when recentering to reset eye height.",12)

func _validate():
	if settings.dominant not in ["left","right"]: settings.dominant="right"
	if settings.turn not in ["snap","smooth"]: settings.turn="snap"
	settings.snap_degrees = clampi(int(settings.snap_degrees),15,90)
	settings.turn_speed = clampi(int(settings.turn_speed),30,120)
	settings.height_offset = clampf(float(settings.height_offset),-1.5,2.0)
	settings.reach = clampf(float(settings.reach),0.5,5.0)
	settings.seated = bool(settings.seated)
	settings.throw_arc = bool(settings.throw_arc)

func save():
	_validate()
	if game.smoke or game.diagnostic_offline: return
	var cfg = ConfigFile.new()
	for key in settings: cfg.set_value("comfort",key,0.0 if key=="height_offset" else settings[key])
	var err = cfg.save(config_path)
	print("COMFORT save=",err," dominant=",settings.dominant," turn=",settings.turn," seated=",settings.seated)
	if err != OK: game._notice("Comfort settings could not be saved. Current choices still apply.")

func dominant_hand():
	if not game.vr: return game.desktop_hand
	return game.hands[0 if settings.dominant=="left" else 1]

func other_hand():
	if not game.vr: return game.desktop_hand
	return game.hands[1 if settings.dominant=="left" else 0]

func menu_hand():
	if game.vr: return game.hands[1]
	return dominant_hand()

func _recenter_height():
	# Wait for the runtime's updated pose, then replace (never add to) the correction.
	await get_tree().process_frame
	await get_tree().process_frame
	calibrate_height()
	print("HEIGHT recentered raw=",game.camera.position.y," offset=",settings.height_offset)

func palm_menu_transform(socket:Transform3D)->Transform3D:
	var mount=Basis(Vector3.RIGHT,Vector3.BACK,Vector3.DOWN)*Basis(Vector3.BACK,-PI/2)*0.6
	# The local left-middle edge (-0.40, 0) sits on the palm attachment.
	return socket*Transform3D(mount,Vector3(0,-0.065,0.14)+mount*Vector3(0.40,0,0))

func apply_height():
	tracking_space.position.y = float(settings.height_offset)

func calibrate_height():
	cancel_forming()
	var target=game.tuning.value("player.eye_height")
	if target<0.5: target=1.7
	settings.height_offset=clampf(target-game.camera.position.y,-1.5,2.0)
	apply_height()
	game.adventure.motion.clear()
	game.tuning.history.clear()
	game.previous_tips.clear()
	game._notice("Eye height calibrated to %.2fm. Stand or sit naturally before calibrating."%target,8)
	print("HEIGHT target=",target," raw=",game.camera.position.y," offset=",settings.height_offset)

func _label(parent,text_value,pos,size):
	var label = Label3D.new()
	parent.add_child(label)
	label.text=text_value
	label.position=pos
	label.font_size=size
	label.pixel_size=0.00125
	label.modulate=Color("fff0ce")
	label.outline_size=3
	return label

func _button(text_value,action,pos,width=0.34):
	var body=StaticBody3D.new()
	body.collision_layer=4
	menu.add_child(body)
	body.position=pos
	body.set_meta("action","qol:"+action)
	var shape=CollisionShape3D.new()
	var box=BoxShape3D.new()
	box.size=Vector3(width,0.055,0.028)
	shape.shape=box
	body.add_child(shape)
	game.adventure._box(body,Vector3.ZERO,box.size,Color("30585a"))
	var text=_label(body,text_value,Vector3(0,0,0.02),15)
	text.width=int(width/0.00125)-12
	text.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	buttons.append(body)
	return body

func _travel_rows()->Array:
	var rows=[]
	for id in game.adventure.ZONES: rows.append([id.replace("_"," ").capitalize(),"travel:"+id])
	rows.append_array([["Ember Gallery","fair:ember"],["Bellworks Fair","fair:bellworks"],["Copper Kite Cargo","fair:cargo"],["Bankshot Bell","fair:bankshot"],["Festival Relay","fair:relay"],["Echo Bells","fair:echo"],["Lantern Parade","fair:lantern"],["Hall of Inventions","fair:archive"],["Tune playful tools","fair:tuning"]])
	return rows

func _build():
	for button in buttons:
		button.free()
	buttons.clear()
	recording_button=null
	detail.position.y=-0.14 if page in ["inventions","supplies"] else (-0.075 if page=="journal" else -0.43)
	detail.font_size=13 if page=="supplies" else (14 if page=="inventions" else (18 if page=="journal" else 15))
	var tabs=["quick","journal","supplies","travel","comfort","inventions","tuning","weather"]
	if OS.get_cmdline_user_args().has("--playful-demo"): tabs[-1]="demo"
	for i in range(tabs.size()):
		_button("Dev tools" if tabs[i]=="tools" else tabs[i].capitalize(),"page:"+tabs[i],Vector3(-0.2925+(i%4)*0.195,0.355-floorf(i/4.0)*0.065,0.005),0.185)
	var rows=[]
	match page:
		"demo":
			if game.demo_help!=null: rows=game.demo_help.rows()
			if game.demo_session!=null:
				rows.append(["Save progress","demo:save"])
				rows.append(["Confirm reset" if game.elapsed<demo_reset_until else "Reset demo progress","demo:reset"])
		"weather":
			if game.weather!=null: rows=game.weather.rows()
		"journal":
			if game.quests!=null: rows=game.quests.rows()
		"tools":
			for id in game.adventure.ORDER: rows.append([game.adventure.TOOL_NAMES[id],"tool:"+id])
			if game.archery!=null and is_instance_valid(game.archery.bow): rows.append(["Emberwing bow","archery:equip"])
		"travel":
			var places=_travel_rows()
			travel_page=clampi(travel_page,0,maxi(0,ceili(places.size()/12.0)-1))
			rows=places.slice(travel_page*12,travel_page*12+12)
		"supplies":
			var pages:=_supplies_pages()
			supplies_index=clampi(supplies_index,0,maxi(0,pages.size()-1))
			if not pages.is_empty():
				for index in pages[supplies_index].rows.size():
					var entry:Dictionary=pages[supplies_index].rows[index]
					rows.append([_supplies_row_title(entry),"supply:select:"+str(index)])
		"comfort":
			rows=[
				["Hand: "+settings.dominant,"dominant"],
				["Turn: "+settings.turn,"turn"],
				["Snap: %d°"%settings.snap_degrees,"snap"],
				["Smooth: %d°/s"%settings.turn_speed,"speed"],
				["Seated: "+("on" if settings.seated else "off"),"seated"],
				["Calibrate eye height","calibrate"],
				["Height −5cm","lower"],
				["Height +5cm","higher"],
				["Reach: %.1fm"%settings.reach,"reach"],
				["Throw arc: "+("on" if settings.throw_arc else "off"),"arc"]]
			rows.append(["Call Little Wing","fairy_call"])
			rows.append(["Fairy co-op window","fairy_start"])
		"inventions":
			rows=[["Previous item","item_prev"],["Next item","item_next"],["Present within reach","present"],["Equip selected","equip"],["Compare previous","compare"],["Refine with Brann","refine"]]
		"tuning": game.tuning.build_menu(false)
		"quick": game.tuning.build_menu(true)
	if page=="quick": rows.append(["Dev tools","page:tools"])
	for i in range(rows.size()):
		_button(rows[i][0],rows[i][1],Vector3(-0.185 if i%2==0 else 0.185,0.185-floorf(i/2.0)*0.075,0.005))
	if page=="travel":
		_button("Previous places","places:previous",Vector3(-0.185,-.265,.005))
		_button("More places","places:next",Vector3(.185,-.265,.005))
	if page=="supplies":
		_button("Previous ledger","supply:previous",Vector3(-.185,-.265,.005))
		_button("Next ledger","supply:next",Vector3(.185,-.265,.005))
	if page=="quick":
		recording_button=_button("Start video","record",Vector3(-0.185,-0.34,0.005))
	else:
		if page=="travel" and game.get("world_reset")!=null:
			_button("Yes, reset world" if game.world_reset.is_armed() else "Reset World…","world:reset",Vector3(-0.185,-0.34,0.005))
		else: _button("Recall tools + return","home",Vector3(-0.185,-0.34,0.005))
	_button("Close","close",Vector3(0.185,-0.34,0.005))
	game._set_collisions(menu,opened)

func toggle():
	if opened and game.get("world_reset")!=null: game.world_reset.cancel()
	game.tuning.dragging=""
	opened=not opened
	menu.visible=opened
	game._set_collisions(menu,opened)
	if opened:
		cancel_forming()
		_build()
		_place(true)
	print("TOOLBELT open=",opened," page=",page)

func cancel_forming():
	for key in game.adventure.ready_bombs:
		var orb=game.adventure.ready_bombs[key]
		if is_instance_valid(orb): orb.queue_free()
	game.adventure.ready_bombs.clear()
	game.adventure.formation.clear()

func _place(immediate=false,delta=0.016):
	var pos:Vector3
	var anchor=game.hands[0] if game.vr else other_hand()
	if game.vr and anchor.get_is_active():
		menu.global_transform=palm_menu_transform(game.hand_socket(anchor).global_transform)
		return
	else:
		pos=game.camera.global_position-game.camera.global_basis.z*0.85
	if immediate: menu.global_position=pos
	else: menu.global_position=menu.global_position.lerp(pos,clampf(delta*14,0,1))
	if menu.global_position.distance_to(game.camera.global_position)>0.1:
		menu.look_at(game.camera.global_position,Vector3.UP,true)

static func allows_menu_button(tracker_name:String)->bool:
	return tracker_name.begins_with("left")

func tick(delta):
	if game.get("world_reset")!=null and game.world_reset.armed_until>=0.0 and game.elapsed>=game.world_reset.armed_until:
		game.world_reset.cancel()
		if opened and page=="travel": _build()
	if demo_reset_until>=0 and game.elapsed>=demo_reset_until:
		demo_reset_until=-1.0
		if opened and page=="demo": _build()
	if game.vr:
		var pressed=false
		for hand in game.hands:
			pressed=pressed or (allows_menu_button(str(hand.tracker)) and hand.get_is_active() and hand.is_button_pressed("by_button"))
		if pressed and not latch: toggle()
		latch=pressed
	if opened:
		if is_instance_valid(recording_button) and game.recording!=null:
			for child in recording_button.get_children():
				if child is Label3D: child.text=game.recording.button_text()
		_place(false,delta)
		if page in ["tuning","quick"] and not game.vr: game.tuning.slider_input(game.camera,Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))
		var resources=[]
		for key in game.state.get("resources",{}):
			var n=int(game.state.resources[key])
			if n>0: resources.append("%s %d"%[key.replace("_"," "),n])
		if page=="demo":
			detail.text=game.demo_session.status_text() if game.demo_session!=null else "Offline preview · progress resets on exit."
		elif page=="travel":
			detail.text="Places %d / %d · Choose somewhere to play"%[travel_page+1,ceili(_travel_rows().size()/12.0)]
			if game.get("travel_navigation")!=null: detail.text+="\nSelected: "+game.travel_navigation.destination_name()
			if game.get("world_reset")!=null and game.world_reset.is_armed(): detail.text="Are you sure? Reset terrain, trees, buildings and meteors.\nCharacter progress stays. Yes, reset world confirms; Close cancels."
		elif page=="supplies": _supplies_detail()
		elif page=="journal":
			detail.text=game.quests.journal() if game.quests!=null else "Your field journal is loading."
		elif page!="inventions":
			detail.text="Health %d · Workshop %d\n%s"%[game.adventure.hp,game.state.get("tier",1),", ".join(resources.slice(0,4))]
		else: _item_detail()
		if page in ["quick","comfort"]:
			detail.text+="\nEye %.2fm · raw %.2fm · target %.2fm"%[game.camera.global_position.y-game.rig.global_position.y,game.camera.position.y,game.tuning.value("player.eye_height")]
	if game.get("feedback")!=null: game.feedback.throw_arc_enabled=settings.throw_arc
	if not ready_queue.is_empty() and game.adventure.zone=="forge_yard" and not opened:
		var id=ready_queue.pop_front()
		present(id)
	# Announce once per loaded session, never invent an extra capability.
	for item in game.state.get("items",[]):
		if game.imported.has(item.id) and not announced.has(item.id):
			announced[item.id]=true
			var message=str(item.get("announcement",item.name+" is ready. Open Inventions to inspect it."))
			game._notice(message,14)
			game.adventure.haptic(dominant_hand(),"ready")
			ready_queue.append(item.id)

func keyboard(event)->bool:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode==KEY_TAB:
		toggle()
		return true
	if opened and event is InputEventKey and event.pressed and event.physical_keycode==KEY_ESCAPE:
		toggle()
		return true
	if opened and event is InputEventMouseButton and event.button_index==MOUSE_BUTTON_LEFT:
		if event.pressed: menu_trigger(game.camera)
		return true
	return false

func menu_trigger(source):
	if not opened: return false
	if game.vr and source in game.hands: source=game.aim_source(source)
	# Personal UI has its own picking layer: a presented weapon must not block it.
	var query=PhysicsRayQueryParameters3D.create(source.global_position,source.global_position-source.global_basis.z*5,4)
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	var target=game._owner(hit.get("collider"))
	if target!=null and str(target.get_meta("action","")).begins_with("qol:"):
		if str(target.get_meta("action","")).begins_with("qol:slider:"): return true
		if not game.button_feedback.press(target,menu_hand()): return true
		action(str(target.get_meta("action")).trim_prefix("qol:"))
	return true

func action(value):
	if value=="world:reset" and game.get("world_reset")!=null:
		if game.vr:
			if game.world_reset.is_armed(): game.world_reset.confirm_vr()
			else: game.world_reset.arm_vr()
			_build()
		else: game.world_reset.request(game)
		return
	if value=="close" and game.get("world_reset")!=null: game.world_reset.cancel()
	if value.begins_with("supply:"):
		var pages:=_supplies_pages()
		if value in ["supply:next","supply:previous"]:
			supplies_index=posmod(supplies_index+(1 if value=="supply:next" else -1),maxi(1,pages.size()))
			supplies_selected=0
			_build()
		else: supplies_selected=int(value.get_slice(":",2))
		_supplies_detail()
		return
	if value in ["places:next","places:previous"]:
		var count=maxi(1,ceili(_travel_rows().size()/12.0))
		travel_page=posmod(travel_page+(1 if value=="places:next" else -1),count)
		_build(); return
	if value.begins_with("demo:"):
		if value=="demo:save" and game.demo_session!=null:
			game.demo_session.save_now(); game._notice(game.demo_session.status_text(),6)
		elif value=="demo:reset" and game.demo_session!=null:
			if game.elapsed<demo_reset_until:
				demo_reset_until=-1.0
				game._notice("Demo progress reset. A backup was kept." if game.demo_session.reset() else "Reset could not finish. "+game.demo_session.status_text(),7)
			else:
				demo_reset_until=game.elapsed+10
				game._notice("Press Confirm reset within ten seconds to clear only this demo's progress. Your main game is unaffected.",10)
		else:
			if game.demo_help!=null: game.demo_help.act(value.trim_prefix("demo:"))
		_build(); return
	if value.begins_with("fair:"):
		cancel_forming()
		if value=="fair:ember": game.ember_gallery.act("visit")
		elif value=="fair:bellworks": game.playful_encounters.act("enter")
		elif value=="fair:cargo": game.cargo_playground.act("visit")
		elif value=="fair:bankshot": game.bankshot.act("visit")
		elif value=="fair:relay": game.festival_relay.act("visit")
		elif value=="fair:echo": game.echo_bells.act("visit")
		elif value=="fair:lantern": game.lantern_gallery.act("visit")
		elif value=="fair:archive": game.living.museum.act("enter")
		elif value=="fair:tuning":
			page="tuning"; game.tuning.action("playful"); return
		opened=false; menu.visible=false; game._set_collisions(menu,false)
		return
	if value.begins_with("weather:"):
		if game.weather!=null: game.weather.action(value.trim_prefix("weather:"))
		return
	if value.begins_with("quest:"):
		game.quests.act(value.trim_prefix("quest:")); return
	if value=="record":
		if game.recording!=null: game.recording.toggle_recording()
		return
	if value.begins_with("tune:"):
		game.tuning.action(value.trim_prefix("tune:"))
		return
	if value.begins_with("page:"):
		game.tuning.dragging=""
		page=value.trim_prefix("page:")
		_build()
		return
	if value.begins_with("tool:"):
		game.adventure.dev_spawn_tool(value.trim_prefix("tool:"),dominant_hand())
		opened=false
		menu.visible=false
		game._set_collisions(menu,false)
		return
	if value.begins_with("travel:"):
		cancel_forming()
		game.adventure.travel(value.trim_prefix("travel:"))
		opened=false
		menu.visible=false
		game._set_collisions(menu,false)
		return
	match value:
		"fairy_call":
			if game.fairy!=null: game.fairy.call_home()
		"fairy_start": game._start_fairy()
		"close": toggle()
		"home": recall_home()
		"dominant": settings.dominant="left" if settings.dominant=="right" else "right"
		"turn": settings.turn="smooth" if settings.turn=="snap" else "snap"
		"snap": settings.snap_degrees={15:30,30:45,45:90,90:15}.get(settings.snap_degrees,30)
		"speed": settings.turn_speed=30 if settings.turn_speed>=120 else settings.turn_speed+30
		"seated": settings.seated=not settings.seated
		"calibrate": calibrate_height()
		"lower":
			settings.height_offset-=0.05
		"higher":
			settings.height_offset+=0.05
		"reach": settings.reach=0.5 if settings.reach>=5 else settings.reach+0.5
		"arc": settings.throw_arc=not settings.throw_arc
		"item_prev": item_index-=1
		"item_next": item_index+=1
		"present": present(_item_id())
		"equip": equip(_item_id())
		"compare": compare()
		"refine":
			var id=_item_id()
			if not id.is_empty(): OS.shell_open(game.service+"/voice?refine="+id.uri_encode())
			game._notice("Tell Brann what to change. The previous version remains available.",12)
	save()
	apply_height()
	_build()

func _supplies_pages() -> Array:
	# The native folio and physical toolbelt consume one read-only guide. Keep
	# generation and pagination off the per-frame VR interaction path.
	if supplies_snapshot.is_empty() or game.elapsed>=next_supplies_sample:
		next_supplies_sample=game.elapsed+0.2
		supplies_snapshot=ResourceGuide.build(game)
		supplies_pages_cache.clear()
		for wallet in supplies_snapshot.wallets:
			var wallet_rows:Array=wallet.rows
			for offset in range(0,wallet_rows.size(),8):
				supplies_pages_cache.append({"title":wallet.title,"rows":wallet_rows.slice(offset,offset+8)})
		for section in ["items","costs"]:
			var entries:Array=supplies_snapshot[section]
			for offset in range(0,entries.size(),8):
				supplies_pages_cache.append({"title":"Equipment" if section=="items" else "Actions and costs","rows":entries.slice(offset,offset+8)})
	return supplies_pages_cache

func _supplies_row_title(entry:Dictionary) -> String:
	# Complex prices and precise restrictions appear in the selected detail;
	# narrow palm buttons show the name and current balance/availability.
	return str(entry.name)+"\n"+str(entry.get("amount",entry.get("state","")))

func _supplies_detail() -> void:
	var pages:Array=_supplies_pages()
	if pages.is_empty():
		detail.text="Supplies are still loading."
		return
	supplies_index=clampi(supplies_index,0,pages.size()-1)
	var ledger:Dictionary=pages[supplies_index]
	var entries:Array=ledger.rows
	supplies_selected=clampi(supplies_selected,0,maxi(0,entries.size()-1))
	# Refresh labels without rebuilding collision buttons under the pointing hand.
	for button in buttons:
		var action_name:String=str(button.get_meta("action",""))
		if not action_name.begins_with("qol:supply:select:"): continue
		var index:int=int(action_name.get_slice(":",3))
		for child in button.get_children():
			if child is Label3D:
				child.text=_supplies_row_title(entries[index]) if index<entries.size() else "No longer available"
				child.modulate=Color("fbd590") if index==supplies_selected else Color("fff0ce")
	detail.text="%s · %d / %d"%[str(ledger.title),supplies_index+1,pages.size()]
	if entries.is_empty(): return
	var entry:Dictionary=entries[supplies_selected]
	detail.text+="\n"+str(entry.name)
	if entry.has("amount"): detail.text+=" · "+str(entry.amount)
	elif entry.has("cost"): detail.text+="\nCost: "+str(entry.cost)+" · "+str(entry.get("state",""))
	else: detail.text+=" · "+str(entry.get("state",""))
	detail.text+="\n"+str(entry.get("purpose",entry.get("description","")))

func recall_home():
	cancel_forming()
	for bomb in game.get_tree().get_nodes_in_group("magic_bomb"):
		bomb.set_meta("exploded",true)
		bomb.queue_free()
	game.adventure.thrown.clear()
	var slot=0
	for item in game.get_tree().get_nodes_in_group("pickup"):
		if not is_instance_valid(item) or item.get_meta("kind","")!="weapon" or item in game.held.values(): continue
		if game.grips.is_stowed(item): continue
		if item.get_meta("remains",false): continue
		if item.has_meta("collection_id") and game.collection.return_item(str(item.get_meta("collection_id"))):
			slot+=1
			continue
		game.tool_physics.detach(item)
		item.reparent(game.adventure.zone_groups.forge_yard)
		item.global_position=game.scene.rack.global_position+Vector3((slot%5)*0.35-0.7,0.15,floorf(slot/5.0)*0.38)
		item.rotation=Vector3.ZERO
		item.visible=true
		game._set_collisions(item,true)
		slot+=1
	game.adventure.travel("forge_yard")
	game.previous_tips.clear()
	opened=false
	menu.visible=false
	game._set_collisions(menu,false)
	game._notice("Home safe. %d dropped tools recalled. Expedition satchels remain where you dropped them."%slot,10)
	print("RECALL tools=",slot)

func distance_pick(hand):
	var source=game.camera if not game.vr else game.aim_source(hand)
	var hit=game._ray(source,float(settings.reach))
	var target=game._owner(hit.get("collider"))
	if target!=null and target.is_visible_in_tree() and target.get_meta("kind","") in ["weapon","tail","cache"]:
		return target
	if target!=null and target.is_visible_in_tree() and target.get_meta("kind","")=="resource" and target.get_meta("requires","") in ["","hand","none"]:
		return target
	return null

func _items():
	return game.state.get("items",[]).filter(func(item):return game.imported.has(item.id))

func _item_id():
	var items=_items()
	if items.is_empty(): return ""
	item_index=posmod(item_index,items.size())
	return str(items[item_index].id)

func _item_detail():
	var items=_items()
	if items.is_empty():
		detail.text="No finished inventions yet.\nAsk Brann for something at workshop tier 2."
		return
	item_index=posmod(item_index,items.size())
	var item=items[item_index]
	selected_item=item.id
	detail.text="%s · v%d\n%s\nExtra: %s"%[str(item.name).left(55),item.get("version",1),str(item.get("requestedFunction",item.get("description",""))).left(140),str(item.get("extraFunction","No extra specified.")).left(90)]

func present(id):
	if not game.imported.has(id): return
	if not game.imported[id].get_meta("delivery_ready",true):
		game._notice("Brann is still finishing that item.")
		return
	if game.adventure.zone!="forge_yard":
		game._notice("Return to Brann to receive the finished invention.")
		return
	var item=game.imported[id]
	if item in game.held.values(): return
	game.tool_physics.detach(item)
	item.reparent(game.adventure.zone_groups.forge_yard)
	var forward=-game.camera.global_basis.z
	forward.y=0
	if forward.length()<0.1: forward=Vector3.FORWARD
	var pos=game.camera.global_position+forward.normalized()*0.65+Vector3.DOWN*0.45
	var ray=PhysicsRayQueryParameters3D.create(game.camera.global_position,pos,1)
	var hit=game.get_world_3d().direct_space_state.intersect_ray(ray)
	if not hit.is_empty(): pos=hit.position+(game.camera.global_position-hit.position).normalized()*0.2
	item.global_position=pos
	item.rotation=Vector3.ZERO
	item.visible=true
	game._set_collisions(item,true)
	game._effect(pos,Color("93ead0"),0.7,0.5)
	var explanation=str(item.get_meta("description",""))
	var extra="No extra specified."
	for spec in _items():
		if spec.id==id:
			explanation=str(spec.get("requestedFunction",spec.get("description","")))
			extra=str(spec.get("extraFunction","No extra specified."))
	if is_instance_valid(presentation_label): presentation_label.queue_free()
	presentation_label=_label(item,"BRANN PRESENTS\n"+str(item.get_meta("display_name","Your invention"))+"\n"+explanation.left(130)+"\nExtra: "+extra.left(90),Vector3(0,0.95,0),18)
	presentation_label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	presentation_label.width=430
	presentation_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	game._notice(str(item.get_meta("display_name","Your invention"))+" — "+explanation+" Extra: "+extra,16)
	print("HANDOFF presented=",id)

func equip(id):
	if not game.imported.has(id): return
	if not game.imported[id].get_meta("delivery_ready",true):
		game._notice("Brann is still finishing that item.")
		return
	var hand=dominant_hand()
	game.adventure.release(hand)
	var item=game.imported[id]
	if is_instance_valid(presentation_label): presentation_label.queue_free()
	for key in game.held.keys():
		if game.held[key]==item: game.held.erase(key)
	game.grips._attach(hand,item)
	item.visible=true
	game._set_collisions(item,false)
	game.collected[id]=true
	game.adventure.haptic(hand,"ready")
	game._notice("Equipped "+str(item.get_meta("display_name",id)))
	opened=false
	menu.visible=false
	game._set_collisions(menu,false)

func compare():
	var items=_items()
	if items.is_empty(): return
	var current=items[posmod(item_index,items.size())]
	var old_id=str(current.get("previousItemId",""))
	for i in range(items.size()):
		if items[i].id==old_id:
			item_index=i
			present(old_id)
			return
	game._notice("This is the first version. Later refinements keep their previous item.")
