extends Node
## One simulation, two viewports and explicitly separate input ownership.
const Flight=preload("res://fairy_flight.gd")
const Preferences=preload("res://fairy_preferences.gd")
const Art=preload("res://fairy_art.gd")
const PING_NAMES=["Look here","Danger","Attack this","Pick this up"]
var game
var active=false
var window:Window
var camera:Camera3D
var avatar:CharacterBody3D
var carrier:Node3D
var art
var lamp:OmniLight3D
var status:Label
var hint:Label
var cfg={"speed":5.0,"boost":2.2,"acceleration":28.0,"deceleration":34.0,"match_reach":.55,"match_scrape":.045,"camera_follow":40.0,"drag":.5,"look_sensitivity":.0026,"controller_look":2.4,"deadzone":.16,"perch_radius":.3,"dislodge_speed":1.8,"throw_gain":3.4,"throw_coast_seconds":1.6,"range":65.0,"dart_damage":4.0,"critical_damage":12.0,"render_scale":1.0,"view_distance":100.0}
var orientation=Basis.IDENTITY
var third_person=false
var acro=false
var health=18.0
var respawn_at=0.0
var invulnerable_until=0.0
var recall=false
var recall_started=0.0
var perch:Node3D
var perch_last=Vector3.ZERO
var perch_velocity=Vector3.ZERO
var carry:Node3D
var carry_mass=0.0
var keys={}
var buttons={}
var pad_buttons={}
var start_chord_used=false
var pad=-1
var focused=true
var mouse_look=false
var shots=[]
var marks=[]
var reveals=[]
var ping_kind=0
var next_shot=0.0
var next_world_control=0.0
var next_ping=0.0
var next_reveal=0.0
var next_dust=0.0
var next_config=0.0
var last_zone=""
var last_host=Vector3.ZERO
var message="Welcome, little wing. F1 shows your controls."
var message_until=0.0
var help_visible=true
var test_mode=false
var camera_position=Vector3.ZERO
var perch_block_until=0.0
var mark_folder:Node3D
var panel:ColorRect
var practice_hand:Node3D
var practice_toss=0.0
var launch_coast=0.0
var handheld
var sensitivity_scale=1.0
var saved_input_accumulation=true
var owns_input_policy=false
var display_mode="maximized"
var practice
var bond
var discoveries
var preferences_ready=false
var held_heat_tip=Vector3.INF
var held_heat_item:Node3D

func setup(g,show_window=true):
	game=g; active=true; last_zone=game.adventure.zone; last_host=game.camera.global_position
	avatar=CharacterBody3D.new(); avatar.name="FairyCompanion"; avatar.collision_layer=0; avatar.collision_mask=1; avatar.motion_mode=CharacterBody3D.MOTION_MODE_FLOATING
	game.add_child(avatar)
	mark_folder=Node3D.new(); mark_folder.name="FairyClues"; game.adventure.zone_groups.forge_yard.add_child(mark_folder)
	# A small discoverable keepsake teaches revealing without unlocking progression.
	mark_folder.position=Vector3(4.2,.94,-3.8); mark_folder.set_meta("zone","forge_yard"); mark_folder.add_to_group("fairy_revealable")
	var keepsake=Art.new(); var stone=keepsake.bead(mark_folder,Vector3.ZERO,Vector3(.08,.055,.08),Color("739995"),.1)
	stone.name="Moonseed"
	keepsake.free()
	var shape=CollisionShape3D.new(); var sphere=SphereShape3D.new(); sphere.radius=.09; shape.shape=sphere; avatar.add_child(shape)
	art=Art.new(); avatar.add_child(art); art.setup(); art.setup_dust(game)
	handheld=preload("res://fairy_handheld.gd").new(); add_child(handheld); handheld.setup(self)
	carrier=Node3D.new(); avatar.add_child(carrier); carrier.position=Vector3(0,-.1,-.1)
	if not game.vr:
		practice_hand=Node3D.new(); game.add_child(practice_hand); game.adventure.build_hand(practice_hand); practice_hand.hide()
		var hint=Label3D.new(); practice_hand.add_child(hint); hint.text="F: perch  /  F4: fling\nF3: bring hand here"; hint.position=Vector3(0,-.18,0); hint.pixel_size=.0008; hint.font_size=22; hint.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	lamp=OmniLight3D.new(); avatar.add_child(lamp); lamp.light_color=Color("65b6ff"); lamp.omni_range=3.0; lamp.light_energy=.65; lamp.shadow_enabled=false
	# A native second window keeps its camera/HUD out of the headset viewport.
	game.get_tree().root.gui_embed_subwindows=false
	window=Window.new(); window.title="Little Wing · local fairy co-op"; window.size=Vector2i(1152,720); window.min_size=Vector2i(720,480); window.use_xr=false; window.world_3d=game.get_world_3d(); window.unresizable=false
	game.add_child(window)
	window.scaling_3d_scale=cfg.render_scale; window.msaa_3d=Viewport.MSAA_DISABLED; window.positional_shadow_atlas_size=1024
	camera=Camera3D.new(); window.add_child(camera); camera.current=true; camera.fov=85; camera.near=.025; camera.far=160
	# The fairy is hidden only from her own first-person camera, never from VR.
	camera.cull_mask=0xFFFFF & ~Art.BODY_LAYER
	var canvas=CanvasLayer.new(); window.add_child(canvas)
	panel=ColorRect.new(); canvas.add_child(panel); panel.color=Color(.025,.07,.085,.85); panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE); panel.offset_top=-165; panel.mouse_filter=Control.MOUSE_FILTER_IGNORE
	status=Label.new(); panel.add_child(status); status.position=Vector2(18,10); status.add_theme_font_size_override("font_size",19); status.modulate=Color("d4fff0")
	hint=Label.new(); panel.add_child(hint); hint.position=Vector2(18,40); hint.add_theme_font_size_override("font_size",15); hint.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	var cross=Label.new(); canvas.add_child(cross); cross.text="·"; cross.add_theme_font_size_override("font_size",30); cross.set_anchors_and_offsets_preset(Control.PRESET_CENTER); cross.mouse_filter=Control.MOUSE_FILTER_IGNORE
	window.window_input.connect(input_event); window.focus_exited.connect(_focus_lost); window.focus_entered.connect(_capture_mouse)
	window.close_requested.connect(stop)
	if DisplayServer.get_name()!="headless":
		var saved=Preferences.read(); sensitivity_scale=saved.sensitivity_scale; third_person=saved.third_person; help_visible=saved.help_visible
		camera.cull_mask=0xFFFFF if third_person else (0xFFFFF & ~Art.BODY_LAYER)
	practice=preload("res://fairy_practice.gd").new(); add_child(practice); practice.setup(self)
	bond=preload("res://fairy_bond.gd").new(); add_child(bond); bond.setup(self)
	discoveries=preload("res://discoveries.gd").new(); add_child(discoveries); discoveries.setup(game,window,self)
	preferences_ready=true
	respawn()
	if show_window and DisplayServer.get_name()!="headless":
		window.show(); set_display_mode("maximized"); _capture_mouse()
		# A 60Hz companion monitor must not throttle a 90/120Hz headset swapchain.
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED,window.get_window_id())
	else: window.hide()
	print("FAIRY_COOP start mode=",("VR+desktop" if game.vr else "desktop rehearsal")," shared_world=true renderer=",RenderingServer.get_current_rendering_method())
	game._notice("Little Wing has joined. Right B calls your fairy home. Offer a still hand or your right shoulder for a perch.",9)
	set_physics_process(true)

func stop():
	if not active: return
	_save_preferences(); bond.stop(); practice.stop(); clear_marks(); launch_coast=0; practice_toss=0
	drop(); detach(Vector3.ZERO); active=false; avatar.hide(); lamp.hide(); window.hide(); _focus_lost()
	for shot in shots: if is_instance_valid(shot.node): shot.node.queue_free()
	shots.clear(); note("Fairy resting. F8 reopens co-op.")
	art.dust.hide()
	if is_instance_valid(practice_hand): practice_hand.hide()
	for mote in art.motes: mote.life=0
	for mark in marks:
		if is_instance_valid(mark.node): mark.node.hide()
	for entry in reveals:
		if is_instance_valid(entry.node): entry.node.queue_free()
	reveals.clear()
	print("FAIRY_COOP stopped; host continues")

func reopen():
	active=true; avatar.show(); lamp.show(); art.dust.show(); respawn(); window.show(); _capture_mouse()
	if DisplayServer.get_name()!="headless": DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED,window.get_window_id())

func set_display_mode(mode:String):
	if DisplayServer.get_name()=="headless": return
	var area=DisplayServer.screen_get_usable_rect(window.current_screen)
	window.mode=Window.MODE_WINDOWED
	match mode:
		"fullscreen": window.mode=Window.MODE_FULLSCREEN
		"maximized": window.mode=Window.MODE_MAXIMIZED
		"left","right":
			window.size=Vector2i(area.size.x/2,area.size.y-40)
			window.position=area.position+Vector2i(0 if mode=="left" else area.size.x/2,32)
		_:
			window.size=Vector2i(mini(1280,area.size.x),mini(800,area.size.y-48))
			window.position=area.position+(area.size-window.size)/2
	display_mode=mode
	note("Display: "+mode+" · F3 hand · F4 launch · Delete clear pings · F11 fullscreen · F6/F7 half screen · F10 maximize")

func _capture_mouse():
	if not active or (discoveries!=null and discoveries.opened): return
	focused=true; mouse_look=true
	if not owns_input_policy:
		saved_input_accumulation=Input.use_accumulated_input; owns_input_policy=true
	Input.use_accumulated_input=false
	if DisplayServer.get_name()!="headless": Input.mouse_mode=Input.MOUSE_MODE_CAPTURED

func _focus_lost():
	if owns_input_policy: Input.use_accumulated_input=saved_input_accumulation; owns_input_policy=false
	focused=false; keys.clear(); buttons.clear(); pad_buttons.clear(); start_chord_used=false; mouse_look=false; Input.mouse_mode=Input.MOUSE_MODE_VISIBLE

func note(text_value):
	message=text_value; message_until=game.elapsed+5

func input_event(event):
	if not active: return
	if discoveries!=null and discoveries.input_event(event): return
	if event is InputEventKey:
		keys[event.physical_keycode]=event.pressed
		if event.pressed and not event.echo:
			match event.physical_keycode:
				KEY_ESCAPE: _focus_lost(); focused=true
				KEY_F11: set_display_mode("windowed" if display_mode=="fullscreen" else "fullscreen")
				KEY_F10: set_display_mode("maximized" if display_mode!="maximized" else "windowed")
				KEY_F6: set_display_mode("left")
				KEY_F7: set_display_mode("right")
				KEY_BRACKETLEFT,KEY_BRACKETRIGHT:
					sensitivity_scale=clampf(sensitivity_scale*(.9 if event.physical_keycode==KEY_BRACKETLEFT else 1.0/.9),.2,3.0)
					_save_preferences()
					note("Mouse sensitivity: %d%% · [ / ] to adjust"%roundi(sensitivity_scale*100))
				KEY_E: grab_or_drop()
				KEY_F: perch_or_leave()
				KEY_V: toggle_view()
				KEY_C: acro=not acro; note("Acro flight" if acro else "Hover assist")
				KEY_R: reveal()
				KEY_X: ping_kind=(ping_kind+1)%4
				KEY_1,KEY_2,KEY_3,KEY_4: ping_kind=event.physical_keycode-KEY_1
				KEY_F1: help_visible=not help_visible; _save_preferences()
				KEY_F2: practice.toggle(keys.get(KEY_SHIFT,false))
				KEY_F3: offer_practice_hand()
				KEY_H: bond.perch_on_shoulder()
				KEY_J: game.fairy_trails.act("next")
				KEY_K: game.ember_creek.visit()
				KEY_F4: launch_practice()
				KEY_DELETE: clear_marks()
				KEY_HOME: call_home()
				KEY_F8: stop()
	if event is InputEventMouseButton and event.pressed:
		if not mouse_look:
			_capture_mouse(); return
		match event.button_index:
			MOUSE_BUTTON_LEFT: shoot(false)
			MOUSE_BUTTON_RIGHT: shoot(true)
			MOUSE_BUTTON_MIDDLE: reveal()
			MOUSE_BUTTON_XBUTTON1: grab_or_drop()
			MOUSE_BUTTON_XBUTTON2: perch_or_leave()
	if event is InputEventMouseMotion and mouse_look and focused:
		var delta=event.screen_relative
		turn(-delta.x*cfg.look_sensitivity*sensitivity_scale,-delta.y*cfg.look_sensitivity*sensitivity_scale,0)
		# Rotation consumes this event now; no physics-tick wait or smoothing.
		if not third_person: camera.global_basis=orientation
	if event is InputEventJoypadButton and focused:
		pad=event.device
		pad_buttons[event.button_index]=event.pressed
		if event.button_index==JOY_BUTTON_START:
			if event.pressed: start_chord_used=false; note("Hold Start + Y: guide · X: retry · A: hand · B: fling · LB: clear · RB: home")
			elif not start_chord_used: help_visible=not help_visible; _save_preferences()
			return
		if not event.pressed: return
		if pad_buttons.get(JOY_BUTTON_START,false):
			start_chord_used=true
			match event.button_index:
				JOY_BUTTON_DPAD_UP: discoveries.show_menu()
				JOY_BUTTON_Y: practice.toggle()
				JOY_BUTTON_X: practice.toggle(true)
				JOY_BUTTON_A: offer_practice_hand()
				JOY_BUTTON_B: launch_practice()
				JOY_BUTTON_LEFT_SHOULDER: clear_marks()
				JOY_BUTTON_RIGHT_SHOULDER: call_home()
			return
		match event.button_index:
			JOY_BUTTON_A:
				if pad_buttons.get(JOY_BUTTON_DPAD_DOWN,false): bond.perch_on_shoulder()
				else: perch_or_leave()
			JOY_BUTTON_X: grab_or_drop()
			JOY_BUTTON_Y: reveal()
			JOY_BUTTON_B: toggle_view()
			JOY_BUTTON_BACK: acro=not acro
			JOY_BUTTON_DPAD_UP: ping_kind=0
			JOY_BUTTON_DPAD_RIGHT: ping_kind=1
			JOY_BUTTON_DPAD_DOWN: ping_kind=2
			JOY_BUTTON_DPAD_LEFT: ping_kind=3

func toggle_view():
	third_person=not third_person; camera.cull_mask=0xFFFFF if third_person else (0xFFFFF & ~Art.BODY_LAYER)
	_save_preferences()

func axis(id:int)->float:
	if pad<0: return 0
	var value=Input.get_joy_axis(pad,id); var dead=float(cfg.deadzone)
	return signf(value)*pow(maxf(0,(absf(value)-dead)/(1-dead)),1.35)

func key(code)->float: return 1.0 if focused and keys.get(code,false) else 0.0

func controls(dt:float)->Dictionary:
	if discoveries!=null and discoveries.opened: return {"stick":Vector3.ZERO,"boost":false,"brake":true}
	if pad_buttons.get(JOY_BUTTON_START,false): return {"stick":Vector3.ZERO,"boost":false,"brake":true}
	var connected=Input.get_connected_joypads()
	if pad not in connected: pad=connected[0] if not connected.is_empty() else -1
	var stick=Vector3(key(KEY_D)-key(KEY_A),key(KEY_SPACE)-key(KEY_CTRL),key(KEY_S)-key(KEY_W))
	var boost=key(KEY_SHIFT)>0; var brake=key(KEY_ALT)>0
	if pad>=0 and focused:
		stick.x+=axis(JOY_AXIS_LEFT_X); stick.z+=axis(JOY_AXIS_LEFT_Y)
		stick.y+=float(Input.is_joy_button_pressed(pad,JOY_BUTTON_RIGHT_SHOULDER))-float(Input.is_joy_button_pressed(pad,JOY_BUTTON_LEFT_SHOULDER))
		turn(-axis(JOY_AXIS_RIGHT_X)*cfg.controller_look*dt,-axis(JOY_AXIS_RIGHT_Y)*cfg.controller_look*dt,0)
		boost=Input.is_joy_button_pressed(pad,JOY_BUTTON_LEFT_STICK); brake=Input.is_joy_button_pressed(pad,JOY_BUTTON_RIGHT_STICK)
		for action in ["dart","ping"]:
			var pressed=Input.get_joy_axis(pad,JOY_AXIS_TRIGGER_RIGHT if action=="dart" else JOY_AXIS_TRIGGER_LEFT)>.55
			if pressed and not buttons.get(action,false): shoot(action=="ping")
			buttons[action]=pressed
	turn(0,0,(key(KEY_Q)-key(KEY_Z))*2.8*dt)
	return {"stick":stick,"boost":boost,"brake":brake}

func turn(yaw:float,pitch:float,roll:float):
	if not is_instance_valid(perch) and acro:
		orientation=(orientation*Basis(Vector3.UP,yaw)*Basis(Vector3.RIGHT,pitch)*Basis(Vector3.BACK,roll)).orthonormalized()
	else:
		var angles=orientation.get_euler(); angles.z=0; angles.y+=yaw; angles.x=clampf(angles.x+pitch,-1.45,1.45); orientation=Basis.from_euler(angles)

func _physics_process(dt):
	if not active or test_mode: return
	if practice_toss>0 and is_instance_valid(practice_hand):
		practice_hand.global_position+=(-orientation.z+Vector3.UP*.3)*5*dt; practice_toss-=dt
	tick(minf(dt,.05),controls(dt))

func tick(dt:float,control:Dictionary):
	if not active: return
	_reload_settings()
	bond.tick(dt)
	if last_zone!=game.adventure.zone or last_host.distance_to(game.camera.global_position)>12:
		practice.stop(); launch_coast=0; practice_toss=0
		if is_instance_valid(practice_hand): practice_hand.hide()
		drop(last_zone); detach(Vector3.ZERO); recall=false; avatar.global_position=pocket()+Vector3.UP*.35; avatar.velocity=Vector3.ZERO; camera_position=avatar.global_position
		last_zone=game.adventure.zone; note("Together again — following your friend’s journey.")
	last_host=game.camera.global_position
	_tick_spells(dt)
	for m in marks.duplicate():
		if not is_instance_valid(m.node) or game.elapsed>=m.get("expires",0):
			if is_instance_valid(m.node): m.node.queue_free()
			marks.erase(m)
		else: m.node.visible=m.zone==game.adventure.zone
	art.animate(dt,1-Flight.load_factor(carry_mass),is_instance_valid(perch))
	if health<=0:
		if game.elapsed>=respawn_at: respawn()
		else: _camera_tick(dt); _hud(); return
	if is_instance_valid(carry) and carry not in game.held.values(): carry=null; carry_mass=0
	elif not is_instance_valid(carry): carry=null; carry_mass=0
	if is_instance_valid(perch): _ride(dt,control)
	elif recall:
		var target=game.camera.global_position-game.camera.global_basis.z*.7+Vector3.UP*.15
		avatar.velocity=Flight.return_velocity(avatar.velocity,target-avatar.global_position,dt)
		_move(dt)
		if avatar.global_position.distance_to(target)<.45:
			recall=false; avatar.velocity*=.2; note("Your friend called you back.")
		elif game.elapsed-recall_started>8:
			# A blocked corridor must not let the companion defeat the host's recall.
			art.burst(avatar.global_position,Color("c8fff2")); avatar.global_position=pocket(); avatar.velocity=Vector3.ZERO; recall=false; note("A pocket-path carried you safely home.")
	else:
		launch_coast=maxf(0,launch_coast-dt)
		var flight_cfg=cfg
		if launch_coast>0 and control.stick.length()<.05 and not control.brake:
			flight_cfg=cfg.duplicate(); flight_cfg.deceleration=0.9
		avatar.velocity=Flight.step(avatar.velocity,orientation,control.stick,dt,acro,control.boost,carry_mass,control.brake,flight_cfg)
		if not focused: avatar.velocity=avatar.velocity.move_toward(Vector3.ZERO,(0.9 if launch_coast>0 else 16.0)*dt)
		_move(dt)
		if avatar.global_position.distance_to(game.camera.global_position)>cfg.range: call_home()
		if avatar.global_position.y< -12: hurt(100,"Lost in the wilds")
	art.basis=orientation
	carrier.global_transform=Transform3D(orientation,avatar.global_position+orientation*Vector3(0,-.045,-.07))
	if game.elapsed>=next_dust:
		next_dust=game.elapsed+.04; art.sprinkle(avatar.global_position, -avatar.velocity*.08,Color("8fd4ff"),1.1)
	if is_instance_valid(carry) and carry.has_meta("fire_kind"):
		carry.set_meta("zone",game.adventure.zone)
		if game.firecraft._burning(carry):
			var action_item=handheld.item
			handheld.item=carry
			var heat_tip=game.firecraft._tip(carry)
			handheld.heat_sweep(held_heat_tip if held_heat_item==carry and held_heat_tip.is_finite() else heat_tip,heat_tip)
			held_heat_tip=heat_tip; held_heat_item=carry
			handheld.item=action_item
		else: held_heat_tip=Vector3.INF; held_heat_item=null
	if game.firecraft.fluid!=null:
		var fluid=game.firecraft.fluid; var entry=fluid.fields.get(game.adventure.zone,{})
		if not entry.is_empty() and entry.ready and fluid.nearest_fire(entry.field,avatar.global_position,.55)!=Vector3.INF: hurt(6,"Too close to the fire")
	handheld.tick(dt)
	practice.tick(dt,control)
	_camera_tick(dt); _hud()

func _move(dt):
	var before=avatar.velocity
	var collision=avatar.move_and_collide(avatar.velocity*dt)
	if collision:
		avatar.velocity=avatar.velocity.slide(collision.get_normal())*.7
		if before.length()>8: hurt(4,"Mind those wings!")

func pocket()->Vector3:
	return game.camera.global_position+game.camera.global_basis.x*.28-Vector3.UP*.55

func respawn():
	held_heat_tip=Vector3.INF; held_heat_item=null
	launch_coast=0; practice_toss=0; perch=null
	health=18; invulnerable_until=game.elapsed+2; avatar.show(); lamp.show(); avatar.global_position=pocket(); avatar.velocity=Vector3.UP*.4
	orientation=Basis(Vector3.UP,game.camera.global_rotation.y); camera_position=avatar.global_position; recall=false
	if is_instance_valid(practice_hand): offer_practice_hand()
	art.burst(avatar.global_position,Color("cbf7e6")); note("Safe in your friend’s pocket. Ready to flutter?")

func hurt(amount:float,reason:String):
	if health<=0 or game.elapsed<invulnerable_until: return
	health=maxf(0,health-amount); invulnerable_until=game.elapsed+.8
	art.burst(avatar.global_position,Color("ffb2ba")); note(reason)
	if health<=0:
		drop(); detach(Vector3.ZERO); recall=false; avatar.hide(); lamp.hide(); respawn_at=game.elapsed+3
		print("FAIRY_COOP scattered reason=",reason," respawn=3s")

func launch_practice():
	if not is_instance_valid(practice_hand) or perch!=practice_hand: note("Perch on the practice hand first: F / A."); return
	practice_toss=.2; detach(-orientation.z*9+Vector3.UP*2); launch_coast=.85; practice.record("launch"); note("Wheee! Steer or brake to take control. Home / Start + RB returns you safely.")

func offer_practice_hand():
	if not is_instance_valid(practice_hand): return
	practice_hand.show(); practice_hand.global_position=avatar.global_position-orientation.z*.45-Vector3.UP*.16; practice_hand.rotation=Vector3(0,orientation.get_euler().y,PI); practice_hand.scale=Vector3.ONE*1.5
	note("Visible practice hand ahead: F to perch, F4 to launch, F3 to recall hand.")

func clear_marks():
	for mark in marks:
		if is_instance_valid(mark.node): mark.node.queue_free()
	marks.clear()
	for shot in shots.duplicate():
		if shot.ping: shot.node.queue_free(); shots.erase(shot)
	if practice!=null: practice.record("clear")
	note("All dust marks cleared.")

func call_home():
	if not active or health<=0: return
	launch_coast=0; practice_toss=0
	var momentum=perch_velocity if is_instance_valid(perch) else avatar.velocity
	drop(); detach(momentum); recall=true; recall_started=game.elapsed
	note("Your friend is calling — returning!")
	game._notice("Little Wing is coming back to you.",3)

func perch_or_leave():
	if health<=0 or recall: return
	if is_instance_valid(perch): detach(Vector3.UP*1.2); return
	var candidates=[]
	for hand in game.hands:
		if hand.get_is_active(): candidates.append(game.hand_socket(hand))
	# The solo host hand has no visible mesh; use the visible practice hand.
	if is_instance_valid(practice_hand) and practice_hand.visible: candidates.append(practice_hand)
	if bond!=null and is_instance_valid(bond.shoulder): candidates.append(bond.shoulder)
	var ring=game.playful_tools
	if ring!=null and ring.ring.is_visible_in_tree(): candidates.append(ring.ring)
	for item in game.held.values():
		if is_instance_valid(item) and item!=carry and item is Node3D: candidates.append(item)
	var best=null; var distance=float(cfg.perch_radius)
	for target in candidates:
		var d=avatar.global_position.distance_to(target.global_position)
		if d<(maxf(distance,.6) if target==practice_hand else distance): distance=d; best=target
	if best==null: note("Fly close to a hand or Sunskipper, then perch."); return
	attach(best)

func attach(target:Node3D):
	if not is_instance_valid(target) or game.elapsed<perch_block_until: return
	drop(); perch=target; perch_last=target.global_position; perch_velocity=Vector3.ZERO; avatar.velocity=Vector3.ZERO
	var angles=orientation.get_euler(); angles.z=0; orientation=Basis.from_euler(angles)
	note("Perched. F / A hops off. A quick hand toss launches you!")
	print("FAIRY_COOP perch target=",target.name)

func detach(launch:Vector3):
	perch=null; avatar.velocity=launch.limit_length(24); perch_block_until=game.elapsed+.3
	if avatar.velocity.length()>2.0: launch_coast=float(cfg.get("throw_coast_seconds",1.6))

func _ride(dt:float,control:Dictionary):
	if not perch.is_visible_in_tree(): detach(Vector3.ZERO); return
	var change=perch.global_position-perch_last; perch_last=perch.global_position
	if change.length()>1.5: detach(Vector3.ZERO); return
	var velocity=change/maxf(dt,.001); perch_velocity=perch_velocity.lerp(velocity,1-exp(-18*dt))
	var ring=game.playful_tools; var riding_ring=ring!=null and perch==ring.ring
	if not riding_ring and velocity.length()>cfg.dislodge_speed:
		# Use the current hand flick for the launch. The smooth velocity alone
		# lagged one frame behind, so a quick release lost most of its throw.
		var throw_velocity=perch_velocity.lerp(velocity,0.75)
		detach(throw_velocity*cfg.throw_gain+Vector3.UP*1.2); note("Wheee! Your wings are yours again."); return
	if riding_ring and ring.state=="home": detach(perch_velocity*.5); return
	if control.stick.length()>.25: detach(perch_velocity+orientation*control.stick*2); return
	var destination=perch.global_position+Vector3.UP*.12
	# Keep the visible feet on the perch. Only the camera is smoothed; smoothing
	# the body here left it visibly trailing a thrown ring by almost a metre.
	var movement=destination-avatar.global_position
	var collision=avatar.move_and_collide(movement)
	if collision or avatar.global_position.distance_to(destination)>1.0: detach(perch_velocity)

func can_carry(item)->bool:
	if not is_instance_valid(item) or not item is Node3D or not item.is_visible_in_tree() or item in game.held.values(): return false
	if item.has_meta("fire_kind"): return item.get_meta("fire_kind") in ["match","vial","box"]
	return item is RigidBody3D and item.is_in_group("pickup") and not game.grips.is_stowed(item)

func wants_box()->bool:
	return bool(keys.get(KEY_SHIFT,false)) or (pad>=0 and Input.is_joy_button_pressed(pad,JOY_BUTTON_LEFT_STICK))

func match_drawer_reachable()->bool:
	var box=game.firecraft.box
	return is_instance_valid(box) and box.is_visible_in_tree() and game.firecraft.opening>.65 and avatar.global_position.distance_to(game.firecraft.tray.global_position)<.5

func grab_or_drop():
	if health<=0 or recall: return
	if is_instance_valid(carry): drop(); return
	var box=game.firecraft.box
	if wants_box() and can_carry(box) and avatar.global_position.distance_to(box.global_position)<.5:
		pick_up(box); return
	if match_drawer_reachable() and not wants_box():
		if game.firecraft.props.filter(func(n):return n.get_meta("fire_kind","")=="match").size()<12:
			pick_up(game.firecraft._prop("match",avatar.global_position)); return
		note("Twelve matches are already out. Pick up a loose one first."); return
	var best=nearest_pickup()
	if best==null: note("Get close to a loose bone, match or bottle; Back / E / X lifts it."); return
	pick_up(best)

func nearest_pickup():
	var candidates=game.get_tree().get_nodes_in_group("pickup")+game.firecraft.props
	var best=null; var distance=.5
	for item in candidates:
		if not can_carry(item): continue
		if item==game.firecraft.box and game.firecraft.opening>.65 and not wants_box(): continue
		var d=avatar.global_position.distance_to(item.global_position)
		if d<distance and _clear(avatar.global_position,item.global_position,item): best=item; distance=d
	return best

func pick_up(item):
	if not can_carry(item): return false
	carry=item; carry_mass=float(item.mass) if item is RigidBody3D else (.025 if item.get_meta("fire_kind","")=="match" else .18)
	if item.has_meta("fire_kind"):
		game.firecraft._attach(carrier,item); item.transform=Transform3D.IDENTITY; item.rotation.z=-.35
	else:
		item.freeze=true; item.linear_velocity=Vector3.ZERO; item.angular_velocity=Vector3.ZERO; item.reparent(carrier); item.position=Vector3.ZERO; game.held[str(carrier.get_instance_id())]=item
	game._set_collisions(item,false)
	if carry_mass>=.8: avatar.velocity=Vector3.ZERO; note("Heave… too heavy! E / X lets go.")
	else: note("Carrying "+str(item.get_meta("display_name",item.get_meta("fire_kind","a treasure")))+". Gently does it.")
	return true

func drop(zone_override=""):
	held_heat_tip=Vector3.INF; held_heat_item=null
	if handheld!=null: handheld.cancel()
	if not is_instance_valid(carry): carry=null; carry_mass=0; return
	var zone_id=game.adventure.zone if zone_override.is_empty() else zone_override
	var item=carry; item.set_meta("zone",zone_id)
	var parent=game.adventure.zone_groups.get(zone_id,game)
	if item.has_meta("fire_kind"):
		item.set_meta("velocity",avatar.velocity); game.firecraft.release(carrier)
		if item.has_meta("body"): item.get_meta("body").reparent(parent)
	else:
		game.held.erase(str(carrier.get_instance_id())); item.reparent(parent); item.freeze=false; item.sleeping=false; item.linear_velocity=avatar.velocity; item.set_meta("born",game.elapsed); item.set_meta("player_thrown",true)
	game._set_collisions(item,true); carry=null; carry_mass=0
	if zone_id!=game.adventure.zone:
		if item is RigidBody3D: item.freeze=true
		elif item.has_meta("body"): item.get_meta("body").freeze=true

func offer_to(hand:Node3D):
	if active and is_instance_valid(carry) and hand.global_position.distance_to(carry.global_position)<.23: drop()

func perched_on(hand:Node3D)->bool:
	return active and is_instance_valid(perch) and (perch==hand or perch==game.hand_socket(hand))

func _clear(from:Vector3,to:Vector3,target=null)->bool:
	var q=PhysicsRayQueryParameters3D.create(from,to,1); var hit=game.get_world_3d().direct_space_state.intersect_ray(q)
	return hit.is_empty() or hit.get("collider")==target or game._owner(hit.get("collider"))==target

func use_supply()->bool:
	if not is_instance_valid(carry): return false
	var kind=carry.get_meta("fire_kind","")
	if kind=="box":
		game.firecraft.target_open=0 if game.firecraft.target_open>.5 else 1
		note("Matchbox open. Set it down, then reach into the drawer with Back / E." if game.firecraft.target_open>0 else "Matchbox closed."); return true
	handheld.begin()
	return true

func shoot(ping:bool):
	if not active or health<=0 or recall: return
	if not ping and interact_world_control(): return
	if not ping and use_supply(): return
	if game.elapsed<(next_ping if ping else next_shot): return
	if ping: next_ping=game.elapsed+.45
	else: next_shot=game.elapsed+.4
	if shots.size()>=24: return
	var node=art.bead(game,avatar.global_position-orientation.z*.13,Vector3.ONE*(.045 if ping else .025),Art.COLORS[ping_kind] if ping else Color("e0bcff"),2)
	shots.append({"node":node,"velocity":-orientation.z*(9.0 if ping else 24.0)+avatar.velocity*.25,"ping":ping,"kind":ping_kind,"age":0.0,"zone":game.adventure.zone})

func _tick_spells(dt):
	for shot in shots.duplicate():
		shot.age+=dt
		if shot.zone!=game.adventure.zone or shot.age>4:
			shot.node.queue_free(); shots.erase(shot); continue
		if shot.ping: shot.velocity.y-=4.0*dt
		var from=shot.node.global_position; var to=from+shot.velocity*dt
		var query=PhysicsRayQueryParameters3D.create(from,to,1|8); query.collide_with_areas=true
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if not hit.is_empty():
			hit["direction"]=shot.velocity.normalized()
			if shot.ping: leave_mark(hit.position,hit.normal,shot.kind,hit.collider)
			else: dart_hit(hit)
			art.burst(hit.position,Art.COLORS[shot.kind] if shot.ping else Color("dabaff")); shot.node.queue_free(); shots.erase(shot)
		else:
			shot.node.global_position=to; art.sprinkle(to,Vector3.ZERO,Art.COLORS[shot.kind] if shot.ping else Color("d4baff"),.25)
	for entry in reveals.duplicate():
		if not is_instance_valid(entry.node) or game.elapsed>=entry.until or entry.zone!=game.adventure.zone:
			if is_instance_valid(entry.node): entry.node.queue_free()
			reveals.erase(entry)

func leave_mark(pos:Vector3,normal:Vector3,kind:int,target=null):
	while marks.size()>=24:
		var old=marks.pop_front(); if is_instance_valid(old.node): old.node.queue_free()
	var node=art.marker(game,pos,normal,kind)
	if target is Node3D and is_instance_valid(target): node.reparent(target)
	marks.append({"node":node,"zone":game.adventure.zone,"kind":kind,"expires":game.elapsed+8.0}); note(PING_NAMES[kind]+" — dust mark placed")
	if practice!=null: practice.record("ping")

func head_position(enemy)->Vector3:
	if game.animation!=null:
		var actor=game.animation.actors.get(enemy.get_instance_id(),{})
		if actor.has("joints") and actor.joints.has("head"): return actor.joints.head.global_position
	return enemy.global_position+Vector3.UP*(1.85 if enemy.get_meta("enemy_type","") in ["golem","boss"] else 1.48)

func dart_hit(hit:Dictionary):
	var target=game._owner(hit.collider)
	if target==null: return
	if str(target.get_meta("action","")).begins_with("fairytrail:") or str(target.get_meta("action","")).begins_with("creek:"):
		game._button(target.get_meta("action")); return
	if target.get_meta("kind","")=="enemy":
		# World enemy colliders are coarse boxes. Judge the aim line against the
		# animated head, not distance from the box's protruding front surface.
		var head_delta=head_position(target)-Vector3(hit.position)
		var crit=head_delta.slide(Vector3(hit.get("direction",-orientation.z)).normalized()).length()<.20 and head_delta.length()<1.2
		game.adventure.hurt_enemy(target,cfg.critical_damage if crit else cfg.dart_damage,null,-orientation.z*.1,"fairy")
		target.set_meta("fairy_aggro_until",game.elapsed+5)
		note("A tiny perfect shot!" if crit else "A little sting — keep your friend in the fight.")
	elif target.get_meta("kind","")=="rat":
		var hp=float(target.get_meta("fairy_hp",12))-cfg.dart_damage; target.set_meta("fairy_hp",hp)
		if hp<=0: game._kill_rat(target)

func reveal():
	if health<=0 or recall or game.elapsed<next_reveal: return
	var feedback_before=message
	bond.duet(); game.fairy_trails.pulse(self)
	next_reveal=game.elapsed+5; art.burst(avatar.global_position,Color("c8ffe9"))
	for enemy in game.scene.get("enemies",[]):
		if not is_instance_valid(enemy) or not enemy.is_visible_in_tree() or not enemy.get_meta("alive",true): continue
		var p=head_position(enemy)
		if avatar.global_position.distance_to(p)>8 or not _clear(avatar.global_position,p,enemy): continue
		var node=art.marker(game,p,Vector3.UP,2); node.scale=Vector3.ONE*.45; node.reparent(enemy)
		reveals.append({"node":node,"until":game.elapsed+5,"zone":game.adventure.zone})
		enemy.set_meta("fairy_aggro_until",game.elapsed+5)
	# Extension point for authored secrets; never expose harvested/disabled objects.
	for secret in game.get_tree().get_nodes_in_group("fairy_revealable"):
		if secret is Node3D and secret.is_visible_in_tree() and secret.global_position.distance_to(avatar.global_position)<8 and str(secret.get_meta("zone",game.adventure.zone))==game.adventure.zone:
			var node=art.marker(game,secret.global_position,Vector3.UP,0); reveals.append({"node":node,"until":game.elapsed+5,"zone":game.adventure.zone})
	if message==feedback_before: note("Faelight reveals weak points and draws attention.")

func attracts(enemy)->bool:
	return active and health>0 and enemy.is_visible_in_tree() and game.elapsed<float(enemy.get_meta("fairy_aggro_until",0)) and enemy.global_position.distance_to(avatar.global_position)<12

func _camera_tick(dt):
	var target=avatar.global_position+Vector3.UP*.04
	var desired=target+orientation.z*1.1+Vector3.UP*.22 if third_person else target
	if third_person:
		var hit=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(target,desired,1))
		if hit.has("position"): desired=hit.position+hit.normal*.08
	camera_position=camera_position.lerp(desired,1-exp(-(9 if is_instance_valid(perch) else cfg.camera_follow)*dt))
	camera.global_transform=Transform3D(orientation,camera_position)
	if third_person and camera_position.distance_to(target)>.1: camera.look_at(target,orientation.y)

func _hud():
	var ui_scale=clampf(window.size.y/900.0,1.0,2.0)
	hint.size.x=window.size.x-36*ui_scale
	status.position=Vector2(18,10)*ui_scale; hint.position=Vector2(18,40)*ui_scale
	status.add_theme_font_size_override("font_size",roundi((19 if window.size.x>=1000 else 14)*ui_scale))
	hint.add_theme_font_size_override("font_size",roundi(15*ui_scale))
	panel.offset_top=(-(245 if window.size.x>=1000 else 330) if help_visible else -115)*ui_scale
	status.text="LITTLE WING   •   %d / 18   •   %s   •   %s   •   %s"%[ceili(health),"ACRO" if acro else "HOVER", "THIRD PERSON" if third_person else "FIRST PERSON",PING_NAMES[ping_kind]]
	var prompt=message if game.elapsed<message_until else ("Perched on your friend" if is_instance_valid(perch) else ("Returning to your friend" if recall else "Fly, explore, and leave a little light behind."))
	if help_visible:
		hint.text="WASD / left stick fly · Space/Ctrl / shoulders rise/fall · Mouse / right stick look · Shift / L3 boost\nClick / RT use item or dart · Right click / LT dust · 1–4 / D-pad mark · Back mouse / E / X carry · F / A perch · Middle / R / Y reveal\nV / B camera · C / Back acro · Q/Z roll (map rear paddles) · Alt / R3 brake · Esc cursor · F1 help\nF2 practice · F3 hand · F4 fling · H shoulder · J night walks · K Ember Creek · Delete clear pings\nHold Start + Y guide / X retry / A hand / B fling / LB clear / RB home\n"+prompt
	else: hint.text=prompt+"\nF3 hand · F4 launch · Delete clear pings · F11 fullscreen · F6/F7 half screen · F10 maximize · [ / ] sensitivity\nF1 / Start: controls   •   Host: Right B or Toolbelt → Comfort → Call Little Wing"

func _reload_settings():
	if game.elapsed<next_config: return
	next_config=game.elapsed+3
	if not FileAccess.file_exists("res://fairy_coop.json"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string("res://fairy_coop.json"))
	if not parsed is Dictionary: return
	var limits={"speed":Vector2(1,12),"boost":Vector2(1,3),"acceleration":Vector2(4,45),"deceleration":Vector2(4,55),"match_reach":Vector2(.25,.7),"match_scrape":Vector2(.025,.1),"camera_follow":Vector2(12,60),"drag":Vector2(.05,4),"look_sensitivity":Vector2(.0005,.01),"controller_look":Vector2(.5,5),"deadzone":Vector2(.05,.4),"perch_radius":Vector2(.15,.5),"dislodge_speed":Vector2(1,6),"throw_gain":Vector2(.5,5.0),"throw_coast_seconds":Vector2(.2,3.0),"range":Vector2(15,100),"dart_damage":Vector2(1,8),"critical_damage":Vector2(3,20),"render_scale":Vector2(.5,1),"view_distance":Vector2(40,160)}
	for name in cfg:
		if (parsed.get(name) is float or parsed.get(name) is int) and is_finite(float(parsed[name])): cfg[name]=clampf(float(parsed[name]),limits[name].x,limits[name].y)
	window.scaling_3d_scale=cfg.render_scale; camera.far=cfg.view_distance

func _save_preferences():
	if not preferences_ready or test_mode or DisplayServer.get_name()=="headless": return
	Preferences.write({"sensitivity_scale":sensitivity_scale,"third_person":third_person,"help_visible":help_visible})

func interact_world_control()->bool:
	var query=PhysicsRayQueryParameters3D.create(avatar.global_position,avatar.global_position-orientation.z*4,1|8)
	query.collide_with_areas=true; query.exclude=[avatar.get_rid()]
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty(): return false
	var target=game._owner(hit.collider)
	if target==null: return false
	var action=str(target.get_meta("action",""))
	if not (action.begins_with("creek:") or action.begins_with("fairytrail:")): return false
	if game.elapsed>=next_world_control:
		next_world_control=game.elapsed+.25; game.playful_feedback.pulse(hit.position,"progress",.25); game._button(action)
	return true
