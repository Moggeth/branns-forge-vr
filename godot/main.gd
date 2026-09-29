extends Node3D

const SCENE = preload("res://workshop_scene.gd")
const VOICES = ["vesper", "ripple", "stone", "meridian", "cinder", "marin", "willow", "quartz"]
var service = "http://127.0.0.1:8787"
var scene: Dictionary
var rig: Node3D
var camera: Camera3D
var player_avatar
var hands: Array[XRController3D] = []
var desktop_hand: Node3D
var held: Dictionary = {}
var collected: Dictionary = {}
var imported: Dictionary = {}
var pending: Dictionary = {}
var state: Dictionary = {}
var online = false
var vr = false
var busy = false
var visiting = false
var context_busy = false
var next_poll = 0.0
var next_context = 0.0
var elapsed = 0.0
var last_frame_hitch_log = -10.0
var turn_latched = false
var last_inputs: Dictionary = {}
var cooldown = 0.0
var shield_until = 0.0
var hurts_until = 0.0
var status_until = 0.0
var desktop_pitch = 0.0
var desktop_look
var desktop_swing_ready = 0.0
var desktop_swing_started = -1.0
var desktop_bob_phase = 0.0
var desktop_bob_strength = 0.0
var desktop_last_position = Vector3.ZERO
var desktop_help_panel: PanelContainer
var desktop_hint_override = ""
var desktop_window_mode_before_fullscreen = Window.MODE_WINDOWED
var previous_tips: Dictionary = {}
var hud: Label
var info: Label
var markers: Array[Node3D] = []
var smoke = false
var smoke_steps = 0
var capture_path = ""
var runtime_check = false
var ray_visuals: Array[MeshInstance3D] = []
var adventure
var apples
var pumpkins
var capture_zone = "forge_yard"
var capture_guardian = ""
var capture_guardian_distance = 2.5
var adventure_smoke = false
var diagnostic_offline = false
var active_ability_hand: Node3D
var qol
var recording
var feedback
var button_feedback
var qol_smoke = false
var capture_qol = false
var capture_feedback = false
var tuning
var bomb_art
var capture_bomb_stage=""
var capture_tuning=false
var capture_quick=false
var hand_sockets={}
var aim_nodes={}
var speech_level=0.0
var speech_target=0.0
var speech_seen=-10.0
var speech_busy=false
var speech_next=0.0
var delivery_seen={}
var workshop_delivery
var tool_physics
var melee
var visit_entered=false
var voice_client_message=""
var grips
var siegebird
var collection
var living
var weather
var quests
var playful_tools
var playful_encounters
var playful_feedback
var playful_fair_art
var magnetic_wand
var cargo_playground
var echo_bells
var lantern_gallery
var ember_gallery
var atelier
var forge_lanterns=[]
var discoveries
var fairy_trails
var ember_creek
var hearth_torch
var fairy
var director
var director_local_view
var world_builder
var landscape
var orchard_spell_vfx: Node3D
var orchard_atmosphere
var world_builder_view
var festival_relay
var festival_relay_art
var bankshot
var bankshot_art
var demo_session
var demo_help
var zone_details
var firecraft
var heat_contacts
var wyrmspout
var sunfall
var item_actions
var capture_grips=false
var presence
var capture_presence=false
var bomb_input=preload("res://bomb_input.gd").new()
var animation
var guardians
var guardian_authored
var skeleton_structure
var remains
var animation_lab
var lab_mode=false
var lab_capture_death=false
var workshop
var workshop_suite
var enchantments
var capture_workshop_tier=0
var capture_tinker=false

func _ready():
	# A copied portable runtime may be double-clicked without the safe CMD flags.
	if (OS.has_feature("bellworks_demo") or OS.get_executable_path().get_file().to_lower()=="bellworks.exe") and not OS.get_cmdline_user_args().has("--playful-demo"):
		set_process(false); set_process_input(false)
		print("BELLWORKS_LAUNCHER_REQUIRED: Open Play Desktop.cmd or Play VR.cmd.")
		if DisplayServer.get_name()!="headless": OS.alert("Please open Play Desktop.cmd or Play VR.cmd to start this offline demo.","Bellworks demo")
		get_tree().quit(0)
		return
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--service="): service = argument.trim_prefix("--service=")
		if argument == "--smoke": smoke = true
		if argument.begins_with("--capture="): capture_path = argument.trim_prefix("--capture=")
		if argument == "--runtime-check": runtime_check = true
		if argument == "--capture-qol": capture_qol = true
		if argument == "--capture-feedback": capture_feedback = true
		if argument.begins_with("--capture-bomb-stage="): capture_bomb_stage=argument.trim_prefix("--capture-bomb-stage=")
		if argument == "--capture-tuning": capture_tuning=true
		if argument == "--capture-quick":
			capture_tuning=true
			capture_quick=true
		if argument == "--capture-grips": capture_grips=true
		if argument == "--capture-presence": capture_presence=true
		if argument == "--animation-lab": lab_mode=true; diagnostic_offline=true
		if argument == "--lab-death": lab_capture_death=true
		if argument.begins_with("--capture-workshop-tier="): capture_workshop_tier=int(argument.trim_prefix("--capture-workshop-tier="))
		if argument == "--capture-tinker": capture_tinker=true
		if argument == "--qol-smoke":
			qol_smoke = true
			smoke = true
		if argument.begins_with("--capture-zone="): capture_zone = argument.trim_prefix("--capture-zone=")
		if argument.begins_with("--capture-guardian="): capture_guardian = argument.trim_prefix("--capture-guardian=")
		if argument.begins_with("--capture-guardian-distance="): capture_guardian_distance = maxf(0.8,float(argument.trim_prefix("--capture-guardian-distance=")))
		if argument == "--adventure-smoke":
			adventure_smoke = true
			smoke = true
	diagnostic_offline = OS.get_cmdline_user_args().has("--playful-check") or OS.get_cmdline_user_args().has("--playful-demo") or OS.get_cmdline_user_args().has("--playful-showcase") or OS.get_cmdline_user_args().has("--fuel-combat-check") or OS.get_cmdline_user_args().has("--weather-game-check") or OS.get_cmdline_user_args().has("--quest-check") or OS.get_cmdline_user_args().has("--fire-check") or not capture_path.is_empty() or runtime_check or OS.get_cmdline_user_args().has("--living-showcase") or OS.get_cmdline_user_args().has("--living-check-network") or OS.get_cmdline_user_args().has("--living-check") or OS.get_cmdline_user_args().has("--siegebird-check") or capture_workshop_tier>0 or capture_tinker or OS.get_cmdline_user_args().has("--workshop-check")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--guardian-check") or OS.get_cmdline_user_args().has("--desktop-hero-check") or OS.get_cmdline_user_args().has("--expedition-check") or OS.get_cmdline_user_args().has("--director-check") or OS.get_cmdline_user_args().has("--director-network-check")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--grip-pose-check") or OS.get_cmdline_user_args().has("--world-builder-check") or OS.get_cmdline_user_args().has("--world-builder-preview")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--skeleton-combat-check")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--hand-art-check")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--atmosphere-test")
	diagnostic_offline = diagnostic_offline or OS.get_cmdline_user_args().has("--landscape-check")
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--desktop-hero-preview="): diagnostic_offline=true
	scene = SCENE.build(self)
	scene.status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	scene.status_label.width = 610
	scene.hammer.add_to_group("pickup")
	scene.hammer.set_meta("display_name", "Copperpot's apprentice hammer")
	for rat in scene.rats:
		rat.set_meta("id", "rat-" + str(Time.get_unix_time_from_system()) + "-" + str(rat.get_instance_id()))
		rat.set_meta("alive", true)
		rat.set_meta("home", rat.position)
	rig = Node3D.new()
	add_child(rig)
	rig.position = Vector3(0, 0, 1)
	var xr = XRServer.find_interface("OpenXR")
	vr = xr != null and xr.is_initialized()
	if vr:
		camera = XRCamera3D.new()
		rig.add_child(camera)
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		for side in ["left", "right"]:
			var hand = XRController3D.new()
			hand.tracker = StringName(side + "_hand")
			hand.pose = "grip"
			rig.add_child(hand)
			hands.append(hand)
			var cursor = _sphere(hand, Vector3.ZERO, 0.045, Color("e5b85c"))
			cursor.name = "HandGrip"
	else:
		camera = Camera3D.new()
		rig.add_child(camera)
		camera.position.y = 1.65
		camera.fov = 78
		camera.current = true
		desktop_look = preload("res://desktop_hero_look.gd").new()
		add_child(desktop_look)
		desktop_look.setup(rig,camera,get_window())
		desktop_last_position=rig.global_position
	desktop_hand = Node3D.new()
	camera.add_child(desktop_hand)
	desktop_hand.position = Vector3(0.35, -0.35, -0.55)
	player_avatar=preload("res://player_avatar.gd").new()
	add_child(player_avatar)
	player_avatar.setup(self)
	_hud()
	adventure = preload("res://adventure_runtime.gd").new()
	add_child(adventure)
	adventure.setup(self)
	landscape = preload("res://landscape_runtime.gd").new()
	landscape.setup(self, scene.zones.orchard_highlands.root, diagnostic_offline or smoke)
	orchard_spell_vfx = preload("res://orchard_vfx/orchard_spell_vfx.gd").new()
	orchard_spell_vfx.name = "OrchardSpellVfx"
	orchard_spell_vfx.quality_tier = "vr" if vr else "rts"
	orchard_spell_vfx.grow_saplings_persist = false
	orchard_spell_vfx.visible = false
	add_child(orchard_spell_vfx)
	landscape.visual_event.connect(orchard_spell_vfx.accept_event)
	for event in landscape.get_visual_history_events():
		orchard_spell_vfx.restore_event(event)
	world_builder = preload("res://world_builder_runtime.gd").new()
	add_child(world_builder)
	world_builder.setup(self, diagnostic_offline or smoke)
	world_builder.forest_visual_event.connect(orchard_spell_vfx.accept_event)
	orchard_atmosphere=preload("res://orchard_atmosphere.gd").new()
	add_child(orchard_atmosphere)
	orchard_atmosphere.setup(self)
	apples=preload("res://apple_runtime.gd").new()
	add_child(apples)
	apples.setup(self)
	pumpkins=preload("res://pumpkin_runtime.gd").new()
	add_child(pumpkins)
	pumpkins.setup(self)
	tuning=preload("res://tuning_runtime.gd").new()
	add_child(tuning)
	tuning.setup(self)
	bomb_art=preload("res://bomb_visuals.gd").new()
	add_child(bomb_art)
	bomb_art.setup(self)
	qol = preload("res://qol_runtime.gd").new()
	add_child(qol)
	qol.setup(self)
	recording=preload("res://recording_runtime.gd").new()
	add_child(recording)
	recording.setup(self)
	grips=preload("res://grip_runtime.gd").new()
	add_child(grips)
	grips.setup(self)
	workshop=preload("res://workshop_suite.gd").new()
	add_child(workshop)
	workshop.setup(self)
	workshop_suite=workshop
	enchantments=preload("res://enchantment_runtime.gd").new()
	add_child(enchantments)
	enchantments.setup(self)
	siegebird=preload("res://siegebird_runtime.gd").new()
	add_child(siegebird)
	siegebird.setup(self)
	workshop_delivery=preload("res://workshop_delivery.gd").new()
	add_child(workshop_delivery)
	workshop_delivery.setup(self)
	animation=preload("res://actor_animation.gd").new()
	add_child(animation)
	animation.setup(self)
	guardians=preload("res://guardians/skeleton_guardians.gd").new()
	add_child(guardians)
	guardians.setup(self)
	for enemy in scene.enemies:
		var variant=str(enemy.get_meta("guardian_variant",""))
		if variant!="": guardians.attach(enemy,variant)
	guardian_authored=preload("res://guardian_authored_animation.gd").new()
	add_child(guardian_authored)
	guardian_authored.setup(self)
	for enemy in scene.enemies:
		var variant=str(enemy.get_meta("guardian_variant",""))
		if variant!="": guardian_authored.attach(enemy,variant)
	remains=preload("res://physical_remains.gd").new()
	add_child(remains)
	remains.setup(self)
	skeleton_structure=preload("res://skeleton_structure.gd").new()
	add_child(skeleton_structure)
	skeleton_structure.setup(self)
	tool_physics=preload("res://tool_physics.gd").new()
	add_child(tool_physics)
	tool_physics.setup(self)
	melee=preload("res://melee_contact.gd").new()
	add_child(melee)
	melee.setup(self)
	collection=preload("res://collection_runtime.gd").new()
	add_child(collection)
	collection.setup(self)
	item_actions=preload("res://item_interactions.gd").new()
	add_child(item_actions)
	item_actions.setup(self)
	zone_details=preload("res://zone_details.gd").new(); add_child(zone_details); zone_details.setup(self)
	firecraft=preload("res://firecraft.gd").new(); add_child(firecraft); firecraft.setup(self)
	wyrmspout=preload("res://wyrmspout_runtime.gd").new(); add_child(wyrmspout); wyrmspout.setup(self)
	sunfall=preload("res://sunfall_runtime.gd").new(); add_child(sunfall); sunfall.setup(self)
	living=preload("res://living_runtime.gd").new(); add_child(living); living.setup(self)
	quests=preload("res://quest_runtime.gd").new(); add_child(quests); quests.setup(self)
	playful_feedback=preload("res://playful_feedback.gd").new(); add_child(playful_feedback); playful_feedback.setup(self)
	playful_tools=preload("res://playful_tools.gd").new(); add_child(playful_tools); playful_tools.setup(self)
	magnetic_wand=preload("res://magnetic_wand.gd").new(); add_child(magnetic_wand); magnetic_wand.setup(self)
	cargo_playground=preload("res://cargo_playground.gd").new(); add_child(cargo_playground); cargo_playground.setup(self)
	playful_encounters=preload("res://playful_encounters.gd").new(); add_child(playful_encounters); playful_encounters.setup(self)
	playful_fair_art=preload("res://playful_fair_art.gd").new(); add_child(playful_fair_art); playful_fair_art.setup(self)
	bankshot=preload("res://bankshot_challenge.gd").new(); add_child(bankshot); bankshot.setup(self)
	bankshot_art=preload("res://bankshot_art.gd").new(); add_child(bankshot_art); bankshot_art.setup(self,bankshot)
	festival_relay=load("res://festival_relay.gd").new(); add_child(festival_relay); festival_relay.setup(self)
	festival_relay_art=load("res://festival_relay_art.gd").new(); add_child(festival_relay_art); festival_relay_art.setup(self,festival_relay)
	echo_bells=load("res://echo_bells.gd").new(); add_child(echo_bells); echo_bells.setup(self)
	lantern_gallery=load("res://lantern_gallery.gd").new(); add_child(lantern_gallery); lantern_gallery.setup(self)
	fairy_trails=load("res://fairy_trails.gd").new(); add_child(fairy_trails); fairy_trails.setup(self)
	ember_gallery=load("res://ember_gallery.gd").new(); add_child(ember_gallery); ember_gallery.setup(self)
	hearth_torch=load("res://hearth_torch.gd").new(); add_child(hearth_torch); hearth_torch.setup(self)
	ember_creek=load("res://ember_creek.gd").new(); add_child(ember_creek); ember_creek.setup(self)
	atelier=preload("res://atelier_runtime.gd").new(); add_child(atelier); atelier.setup(self)
	for variant in [
		{"id":"forge_lantern_sol","name":"Forge Lantern · Sol","asset":"res://assets/forge_lantern/sol.glb"},
		{"id":"forge_lantern_opus","name":"Forge Lantern · Opus","asset":"res://assets/forge_lantern/opus.glb"}]:
		if not ResourceLoader.exists(variant.asset): continue
		var lantern=preload("res://forge_lantern.gd").new()
		add_child(lantern)
		lantern.setup(self,variant.id,variant.name,variant.asset)
		forge_lanterns.append(lantern)
	if forge_lanterns.size()==2:
		var comparison_label=WorkshopScene.label(collection.root,"LANTERN STUDY · TWO ARTISTS\nSame controls · grip to compare · shutter opens by hand",Vector3(12.0,2.3,7.0),18)
		comparison_label.rotation.y=-PI/2
	discoveries=preload("res://discoveries.gd").new(); add_child(discoveries); discoveries.setup(self,self)
	hearth_torch.create_stand(ember_gallery.court,Vector3(-3.4,1.05,5))
	if OS.get_cmdline_user_args().has("--fairy-coop"): _start_fairy()
	if OS.get_cmdline_user_args().has("--world-builder") or OS.get_cmdline_user_args().has("--world-builder-check"):
		adventure.travel("orchard_highlands")
		if not OS.get_cmdline_user_args().has("--world-builder-check"):
			_open_world_builder_view()
	if OS.get_cmdline_user_args().has("--director-mode") or OS.get_cmdline_user_args().has("--director-check"):
		var director_native=OS.get_cmdline_user_args().has("--director-window") and not diagnostic_offline
		director=preload("res://director_runtime.gd").new(); add_child(director); director.setup(self,OS.get_cmdline_user_args().has("--director-check"),director_native)
		if director_native:
			director_local_view=preload("res://director_local_view.gd").new()
			director_local_view.visible=false
			add_child(director_local_view)
			director_local_view.setup(self,director)
	if playful_feedback.hints.has("sunskipper"):
		for child in playful_tools.stand.get_children():
			if child is Label3D: child.hide()
	if (not diagnostic_offline and not smoke) or OS.get_cmdline_user_args().has("--weather-game-check"):
		weather=preload("res://weather_runtime.gd").new(); add_child(weather); weather.setup(self)
	heat_contacts=preload("res://heat_contacts.gd").new(); add_child(heat_contacts); heat_contacts.setup(self)
	if ember_gallery!=null: ember_gallery.register_heat_targets()
	if lab_mode:
		animation_lab=preload("res://animation_lab.gd").new()
		add_child(animation_lab)
		animation_lab.setup(self)
	for hand in hands:
		var aim=XRController3D.new()
		aim.tracker=hand.tracker
		aim.pose="aim"
		qol.tracking_space.add_child(aim)
		aim_nodes[str(hand.get_instance_id())]=aim
	button_feedback=preload("res://button_feedback.gd").new()
	button_feedback.game=self
	add_child(button_feedback)
	feedback = preload("res://interaction_feedback.gd").new()
	add_child(feedback)
	feedback.setup(self)
	if not capture_path.is_empty():
		adventure.travel(capture_zone)
		var framing=scene.get("zones",{}).get(capture_zone,{})
		if framing.has("capture_position"):
			camera.global_position=framing.capture_position
			camera.look_at(framing.capture_target)
		if capture_qol:
			qol.page="comfort"
			qol.toggle()
		if capture_feedback:
			feedback.enabled=true
			qol.settings.throw_arc=true
			adventure.begin_bomb(desktop_hand)
	print("START native Godot ", Engine.get_version_info().string, " xr=", vr, " service=", service)
	print("STATE_PATH ", OS.get_user_data_dir())
	if OS.get_cmdline_user_args().has("--living-showcase"):
		var showcase=preload("res://living_showcase.gd").new(); add_child(showcase); showcase.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--weather-game-check"):
		var weather_check=preload("res://weather_game_checks.gd").new(); add_child(weather_check); weather_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--quest-check"):
		var quest_check=preload("res://quest_checks.gd").new(); add_child(quest_check); quest_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--living-check-network"):
		var living_network_check=load("res://living_network_checks.gd").new(); add_child(living_network_check); living_network_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--living-check"):
		var living_check=preload("res://living_checks.gd").new(); add_child(living_check); living_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--siegebird-check"): _siegebird_check.call_deferred()
	if OS.get_cmdline_user_args().has("--wyrmspout-check"): preload("res://wyrmspout_checks.gd").run.call_deferred(self)
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--wyrmspout-capture="): preload("res://wyrmspout_capture.gd").run.call_deferred(self,argument.trim_prefix("--wyrmspout-capture="))
	if OS.get_cmdline_user_args().has("--guardian-check"): preload("res://guardian_checks.gd").run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--skeleton-combat-check"): preload("res://skeleton_combat_checks.gd").run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--hand-art-check"): preload("res://hand_art_checks.gd").run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--landscape-check"):
		var landscape_check = preload("res://landscape_live_checks.gd").new()
		add_child(landscape_check)
		landscape_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--desktop-hero-check"): preload("res://desktop_hero_integration_checks.gd").run.call_deferred(self)
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--desktop-hero-preview="):
			preload("res://desktop_hero_preview.gd").run.call_deferred(self,argument.trim_prefix("--desktop-hero-preview="))
	if OS.get_cmdline_user_args().has("--expedition-check"):
		var expedition_check=preload("res://expedition_checks.gd").new(); add_child(expedition_check); expedition_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--playful-check"):
		var playful_check=preload("res://playful_checks.gd").new(); add_child(playful_check); playful_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--playful-showcase"):
		var playful_showcase=preload("res://playful_showcase.gd").new(); add_child(playful_showcase); playful_showcase.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--playful-demo"):
		if OS.get_cmdline_user_args().has("--demo-persistent"):
			var directory="user://EmberGalleryDemo" if OS.get_cmdline_user_args().has("--ember-gallery-demo") else "user://BellworksDemo"
			for argument in OS.get_cmdline_user_args():
				if argument.begins_with("--demo-save-dir="): directory=argument.trim_prefix("--demo-save-dir=")
			demo_session=load("res://demo_session.gd").new(); add_child(demo_session); demo_session.setup(self,directory)
		demo_help=load("res://demo_help.gd").new(); add_child(demo_help); demo_help.setup(self)
		var check_phase=""
		for argument in OS.get_cmdline_user_args():
			if argument.begins_with("--demo-persistence-check="): check_phase=argument.trim_prefix("--demo-persistence-check=")
		if not check_phase.is_empty():
			var checker=load("res://demo_persistence_checks.gd").new(); add_child(checker); checker.run.call_deferred(self,check_phase)
		else: _start_playful_demo.call_deferred()
	if OS.get_cmdline_user_args().has("--fuel-combat-check"):
		var fuel_check=preload("res://fuel_combat_checks.gd").new(); add_child(fuel_check); fuel_check.run.call_deferred(self)
	if OS.get_cmdline_user_args().has("--fire-check"): firecraft.run_checks.call_deferred()
	if OS.get_cmdline_user_args().has("--siege-ledger-check"):
		set_process(false); preload("res://siegebird_live_checks.gd").run.call_deferred(self)
	if not diagnostic_offline and not OS.get_cmdline_user_args().has("--siege-ledger-check"): _poll()
	# start.ps1 manages the hidden audio helper; normal play never opens a browser.
	if qol_smoke:
		_qol_smoke_test.call_deferred()
	elif adventure_smoke:
		_adventure_smoke_test.call_deferred()
	elif smoke:
		_smoke_test.call_deferred()
	if not capture_path.is_empty() and capture_workshop_tier==0 and not capture_tinker: _capture.call_deferred()
	if runtime_check:
		await get_tree().create_timer(4).timeout
		print("RUNTIME_CHECK xr=", vr)
		get_tree().quit()
	if capture_workshop_tier>0 or capture_tinker: _capture_workshop.call_deferred()
	if OS.get_cmdline_user_args().has("--workshop-check"): _workshop_check.call_deferred()

func _capture():
	await get_tree().create_timer(3).timeout
	if OS.get_cmdline_user_args().has("--capture-windfall"):
		adventure.travel("orchard_highlands")
		var meadow_center:Vector3=scene.zones.orchard_highlands.center
		camera.global_position=meadow_center+Vector3(16,3.2,-21)
		camera.look_at(meadow_center+Vector3(18,1.0,-33))
		camera.fov=72
	if OS.get_cmdline_user_args().has("--capture-landscape-overview"):
		adventure.travel("orchard_highlands")
		var landscape_center: Vector3 = scene.zones.orchard_highlands.center
		camera.global_position = landscape_center + Vector3(0, 150, 190)
		camera.look_at(landscape_center + Vector3(0, 0, 0))
		camera.fov = 73
	if OS.get_cmdline_user_args().has("--capture-landscape-stream"):
		adventure.travel("orchard_highlands")
		var brook_center: Vector3 = scene.zones.orchard_highlands.center
		camera.global_position = brook_center + Vector3(38, 8, -27)
		camera.look_at(brook_center + Vector3(25, -1, -48))
		camera.fov = 70
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-orchard-plot="):
			var index:int=clampi(int(argument.trim_prefix("--capture-orchard-plot=")),0,5)
			var plot:Dictionary=preload("res://orchard_expansion.gd").PLOTS[index]
			adventure.travel("orchard_highlands")
			var at:Vector3=scene.zones.orchard_highlands.center+plot.at
			camera.global_position=at+Vector3(18,6,19)
			camera.look_at(at+Vector3(0,2,0))
			camera.fov=72
	if OS.get_cmdline_user_args().has("--capture-hide-orchard-art") or OS.get_cmdline_user_args().has("--capture-hide-ground-kit") or OS.get_cmdline_user_args().has("--capture-only-orchard-kit"):
		var hide_art:bool=OS.get_cmdline_user_args().has("--capture-hide-orchard-art")
		var only_kit:bool=OS.get_cmdline_user_args().has("--capture-only-orchard-kit")
		var orchard_root:Node3D=scene.zones.orchard_highlands.root
		for visual in orchard_root.find_children("*","GeometryInstance3D",true,false):
			if hide_art and visual.name.begins_with("Orchard_"): visual.visible=false
			if OS.get_cmdline_user_args().has("--capture-hide-ground-kit") and visual.name.begins_with("gk_"): visual.visible=false
			if only_kit and not (visual.name.begins_with("Orchard_") or visual.name.begins_with("gk_")): visual.visible=false
	if not capture_guardian.is_empty():
		for actor in scene.enemies:
			if str(actor.get_meta("guardian_variant", "")) != capture_guardian: continue
			camera.global_position = actor.global_position + actor.global_basis.z * capture_guardian_distance + Vector3.UP * 1.45
			camera.look_at(actor.global_position + Vector3.UP * 0.9)
			await get_tree().create_timer(0.15).timeout
			break
	if OS.get_cmdline_user_args().has("--capture-fire"): firecraft.showcase()
	if OS.get_cmdline_user_args().has("--capture-heat-gallery"):
		adventure.travel("ember_gallery")
		var gallery_center:Vector3=scene.zones.ember_gallery.center
		camera.global_position=gallery_center+Vector3(4.0,1.72,3.8)
		camera.look_at(gallery_center+Vector3(4.0,.60,.5))
	if OS.get_cmdline_user_args().has("--capture-ghosts"):
		firecraft.show_ghosts()
		await get_tree().create_timer(0.35).timeout
	if lab_mode:
		rig.position=Vector3.ZERO
		camera.position=Vector3(1.5,1.6,3.2)
		camera.look_at(Vector3(0,0.9,0))
		animation_lab.clip="attack"
		animation_lab.clock=1.0
		animation_lab.paused=true
		await get_tree().create_timer(0.15).timeout
		if lab_capture_death:
			animation_lab.action("explode")
			await get_tree().create_timer(0.25).timeout
	if capture_presence:
		rig.position=Vector3.ZERO
		camera.position=Vector3(0.8,1.7,-1.8)
		camera.look_at(Vector3(0,1.4,-4))
		state["voiceClient"]={"connected":true,"phase":"listening"}
		await get_tree().create_timer(0.6).timeout
	if capture_grips:
		rig.position=Vector3(0,0,0)
		camera.position=Vector3(0,1.7,0)
		camera.rotation=Vector3.ZERO
		var sample_hands=[]
		for side in ["left","right"]:
			var hand=XRController3D.new()
			hand.set("show_when_tracked",false)
			hand.tracker=StringName(side+"_hand")
			qol.tracking_space.add_child(hand)
			hands.append(hand)
			adventure.build_hand(hand)
			hand.global_basis=_hand_basis(hand).inverse()
			sample_hands.append(hand)
		sample_hands[0].global_position=Vector3(-0.5,1.3,0.75)
		sample_hands[1].global_position=Vector3(0.35,1.3,0.75)
		var axe=adventure._tool_model("woodland_axe")
		add_child(axe)
		grips._attach(sample_hands[0],axe)
		var held_hammer=adventure._tool_model("apprentice_hammer" if OS.get_cmdline_user_args().has("--apprentice-grip") else "crystal_resonator")
		add_child(held_hammer)
		grips._attach(sample_hands[1],held_hammer)
		var hammer=adventure._tool_model("apprentice_hammer")
		grips.slots[1].root.add_child(hammer)
		hammer.position=Vector3(0,-0.3,0)
		grips.slots[1].item=hammer
		var observer=Camera3D.new()
		add_child(observer)
		var focus=sample_hands[1].global_position
		observer.position=focus+Vector3(0.15,-0.2,0.27)
		if OS.get_cmdline_user_args().has("--grip-back"): observer.position=focus+Vector3(0.15,0.22,0.27)
		observer.look_at(focus+Vector3(0,-0.03,-0.02))
		observer.current=true
		await get_tree().create_timer(0.3).timeout
		# Offline XR nodes can hide untracked children. Freeze only the preview meshes.
		for hand in sample_hands:
			var visual=hand.get_meta("hand_visual")
			visual.reparent(self)
			visual.visible=true
			print("GRIP_PREVIEW hand=",hand.global_position," visual=",visual.global_position," visible=",visual.is_visible_in_tree())
			hand.remove_meta("hand_visual")
		await get_tree().process_frame
	if OS.get_cmdline_user_args().has("--capture-delivery"):
		var item=adventure._tool_model("crystal_resonator")
		add_child(item)
		workshop_delivery.present.call_deferred(item,"preview")
		camera.global_position=Vector3(2.8,2.1,0.1)
		camera.look_at(Vector3(0.6,1.2,-3))
		await get_tree().create_timer(2.7).timeout
	if OS.get_cmdline_user_args().has("--capture-chop"):
		adventure.travel("pinewood_ruins")
		for tree in scene.resources:
			if tree.get_meta("requires","")!="axe": continue
			var point=tree.global_position+Vector3(0,1.15,0.3)
			melee.chop(tree,point,Vector3.BACK)
			melee.chop(tree,point+Vector3.UP*0.03,Vector3.BACK)
			camera.global_position=tree.global_position+Vector3(1.0,1.8,2.3)
			camera.look_at(tree.global_position+Vector3(0,1.25,0))
			break
		await get_tree().create_timer(0.15).timeout
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--progression-preview=") and diagnostic_offline:
			var preview=JSON.parse_string(FileAccess.get_file_as_string(arg.trim_prefix("--progression-preview=")))
			if preview is Dictionary: state=preview
			_update_text()
	if OS.get_cmdline_user_args().has("--capture-portals"):
		camera.global_position=Vector3(0,3.0,1.0)
		camera.fov=85
		camera.look_at(Vector3(0,1.15,10.8))
	if OS.get_cmdline_user_args().has("--capture-forge-working"):
		state.jobs=[{"status":"building","estimatedProgress":0.6,"remainingLowSeconds":120,"remainingHighSeconds":300,"sampleCount":1}]
		workshop_delivery._process(0.01)
		workshop_delivery.working_pose(0)
		workshop_delivery.strike()
		workshop_delivery.set_process(false)
		camera.global_position=Vector3(1.0,2.2,-0.3)
		camera.look_at(Vector3(-0.65,1.4,-3.0))
	if OS.get_cmdline_user_args().has("--capture-hand-detail"):
		var sample=Node3D.new()
		add_child(sample)
		adventure.build_hand(sample)
		var visual=sample.get_meta("hand_visual")
		visual.reparent(self)
		visual.position=Vector3(0,40,0)
		visual.rotation=Vector3(-0.15,0.35,0)
		var joints=sample.get_meta("finger_joints")
		for i in range(joints.size()): joints[i].rotation.x=-0.15 if i<3 else -0.70
		WorkshopScene.box(self,Vector3(0,39.68,0),Vector3(20,0.12,20),WorkshopScene.material("304852"))
		camera.global_position=Vector3(0.18,40.20,-0.32)
		camera.look_at(Vector3(0,40,-0.03))
		camera.fov=35
		sample.queue_free()
	if OS.get_cmdline_user_args().has("--capture-rat-detail"):
		# Move one *real, animated* kitchen rat to an isolated review plinth.
		# The capture never mutates the player's saved world.
		adventure.travel("enchanted_kitchen")
		var rat=scene.rats[0]
		rat.global_position=Vector3(0,40,0)
		rat.set_meta("home",rat.global_position)
		WorkshopScene.box(self,Vector3(0,39.86,0),Vector3(20,0.15,20),WorkshopScene.material("4b605a"))
		camera.global_position=Vector3(0.45,40.47,1.15)
		camera.look_at(rat.global_position+Vector3.UP*0.21)
		camera.fov=37
	if OS.get_cmdline_user_args().has("--capture-siegebird"):
		var sample=preload("res://siegebird_checks.gd").load_sample(self)
		if sample!=null:
			sample.position=Vector3(0,1.45,0)
			sample.rotation=Vector3(-PI/2,0.35,0)
			if OS.get_cmdline_user_args().has("--uncocked"):
				var w=siegebird.weapons.back()
				w.loaded=false; w.draw=0.35; w.angle=w.draw*TAU*siegebird.TURNS
				siegebird.mechanism(w)
			camera.fov=48
			camera.global_position=Vector3(0.85,1.90,0.40)
			camera.look_at(Vector3(0,1.45,-0.40))
			for argument in OS.get_cmdline_user_args():
				if argument.begins_with("--siegebird-angle="):
					var angle=argument.trim_prefix("--siegebird-angle=")
					sample.position=Vector3(0,40,0)
					siegebird.weapons.back().label.visible=false
					WorkshopScene.box(self,Vector3(0,39.35,0),Vector3(200,0.1,200),WorkshopScene.material("263d43"))
					var viewpoint=Vector3(1.15,-0.65,0.95)
					if angle=="mechanism": viewpoint=Vector3(1.65,0.40,0.65)
					if angle=="grip": viewpoint=Vector3(0.65,-0.12,-0.2)
					if angle=="front": viewpoint=Vector3(-0.95,1.75,0.90)
					if angle=="top": viewpoint=Vector3(0.15,0.10,1.85)
					camera.global_position=sample.to_global(viewpoint)
					camera.look_at(sample.to_global(Vector3(0,0.40,0)),sample.global_basis.z)
					camera.fov=43
					if angle=="grip": camera.look_at(sample.to_global(Vector3(0,0.23,-0.14)),sample.global_basis.z); camera.fov=35
			for argument in OS.get_cmdline_user_args():
				if argument.begins_with("--siegebird-cycle="):
					await preload("res://siegebird_showcase.gd").capture(self,siegebird.weapons.back(),argument.trim_prefix("--siegebird-cycle="))
					return
			if OS.get_cmdline_user_args().has("--capture-siege-grip"):
				var w=siegebird.weapons.back()
				var grip_hand=Node3D.new(); add_child(grip_hand); adventure.build_hand(grip_hand)
				var visual=grip_hand.get_meta("hand_visual")
				visual.global_transform=Transform3D(sample.global_basis*Basis(Vector3.FORWARD,Vector3.RIGHT,Vector3.DOWN),w.grip.global_position)
				grip_hand.set_meta("siege_trigger",0.6)
				w.trigger.rotation.x=-0.26*0.6
				grip_hand.set_meta("siege_finger_target",w.trigger.to_global(Vector3(0,0.018,-0.046)))
				for step in range(20): preload("res://hand_animation.gd").tick(grip_hand,true,0.016)
				var joints=grip_hand.get_meta("finger_joints")
				print("TRIGGER_ROOT_DISTANCE ",joints[0].global_position.distance_to(grip_hand.get_meta("siege_finger_target")))
				print("TRIGGER_FINGER_GAP ",joints[2].to_global(Vector3(0,0,-0.025)).distance_to(grip_hand.get_meta("siege_finger_target")))
			if OS.get_cmdline_user_args().has("--capture-siege-handle"):
				var w=siegebird.weapons.back()
				held["capture"]=sample
				var capture_hand=Node3D.new(); add_child(capture_hand); adventure.build_hand(capture_hand)
				w.loaded=false; w.draw=0.4; siegebird.mechanism(w)
				capture_hand.global_position=siegebird.knob(w); siegebird.try_grab(capture_hand)
				preload("res://hand_animation.gd").tick(capture_hand,true,0.2)
				var reel=siegebird.extras.reel_item; reel.reparent(self); reel.global_position=w.reel_socket.global_position
				siegebird.extras.release_reel(capture_hand,{"node":reel})
				await get_tree().create_timer(0.15).timeout
			if OS.get_cmdline_user_args().has("--capture-sight"):
				var w=siegebird.weapons.back()
				camera.global_position=w.optic.global_position-w.item.global_basis.y*0.30
				camera.look_at(w.optic.global_position+w.item.global_basis.y,sample.global_basis.z)
	if OS.get_cmdline_user_args().has("--capture-teacups"):
		adventure.travel("enchanted_kitchen")
		camera.global_position=scene.zones.enchanted_kitchen.center+Vector3(-0.7,2.05,5.3)
		camera.look_at(scene.zones.enchanted_kitchen.center+Vector3(-2,1.7,4))
		camera.fov=42
	if OS.get_cmdline_user_args().has("--capture-item-actions"):
		for i in range(4):
			var item=adventure._tool_model(["quarry_pick","grappling_hook","spore_lantern","ember_gauntlet"][i])
			add_child(item); item.position=Vector3((i-1.5)*0.65,1.05,0)
			item.rotation.y=-0.35
		camera.global_position=Vector3(1.4,2.3,2.65)
		camera.look_at(Vector3(0,1.5,0)); camera.fov=48
	if OS.get_cmdline_user_args().has("--profile-bolts"):
		await preload("res://item_action_checks.gd").profile(self)
	if OS.get_cmdline_user_args().has("--capture-collection"):
		state={"tier":3,"tools":[],"recipes":[],"items":[]}
		for id in adventure.ORDER:
			state.recipes.append({"id":id,"tier":1 if adventure.ORDER.find(id)<4 else (2 if adventure.ORDER.find(id)<6 else (3 if id=="crystal_resonator" else 4)),"available":id!="ember_gauntlet"})
		collection.sync()
		var sample=preload("res://siegebird_checks.gd").load_sample(self)
		if sample!=null:
			sample.set_meta("display_name","Siegebird")
			collection.register(sample)
		camera.global_position=Vector3(-0.5,3.6,0.2)
		camera.look_at(Vector3(5.8,1.0,6.0))
		camera.fov=68
	if OS.get_cmdline_user_args().has("--capture-forge-detail"):
		camera.global_position=Vector3(1.4,2.05,0.3)
		camera.look_at(Vector3(-0.3,1.1,-3.2))
	if OS.get_cmdline_user_args().has("--capture-smoke"):
		camera.global_position=Vector3(2,7.8,3)
		camera.look_at(Vector3(-3.0,7.8,-4.9))
		var chimney=find_child("ForgeSmoke",true,false)
		print("SMOKE_PREVIEW node=",chimney," clock=",chimney.clock," puffs=",chimney.puffs.size()," visible=",chimney.is_visible_in_tree())
		if not chimney.puffs.is_empty(): print("SMOKE_PUFF pos=",chimney.puffs[0].global_position," alpha=",chimney.puffs[0].material_override.albedo_color.a)
	if OS.get_cmdline_user_args().has("--capture-skull-detail"):
		camera.global_position=Vector3(0.43,1.72,1.06)
		camera.look_at(Vector3(0,1.63,0))
	if OS.get_cmdline_user_args().has("--capture-possibilities"):
		camera.global_position=Vector3(-6.9,1.85,0.3)
		camera.look_at(Vector3(-6.9,1.7,-4.4))
		for button in scene.buttons:
			if button.get_meta("action","")=="upgrade" and button.global_position.x<0:
				var hint=WorkshopScene.label(self,"Upgrade workshop",button.get_meta("hint_position"),18,Color("97eed3"))
				hint.name="ReservedHoverPreview"
	if OS.get_cmdline_user_args().has("--capture-workshop-path"):
		camera.global_position=Vector3(5.4,1.95,-0.5)
		camera.look_at(Vector3(5.4,1.85,-5.5))
	if OS.get_cmdline_user_args().has("--capture-dummy-detail"):
		camera.global_position=Vector3(-5.6,1.6,5.8)
		camera.look_at(Vector3(-6.7,1.15,2.7))
	if OS.get_cmdline_user_args().has("--capture-pumpkins") or OS.get_cmdline_user_args().has("--capture-pumpkins-offcenter"):
		adventure.travel("forge_yard")
		var pick_preview=Node3D.new(); pick_preview.set_meta("id","quarry_pick"); add_child(pick_preview)
		var axe_preview=Node3D.new(); axe_preview.set_meta("id","woodland_axe"); add_child(axe_preview)
		var face_preview=pumpkins.pumpkins[0]
		for n in 3:
			pumpkins.impact(face_preview.body,pick_preview,face_preview.body.global_position,Vector3.BACK,Vector3.FORWARD*3)
			elapsed+=0.25
		var slice_center=pumpkins.pumpkins[1].body.global_position
		var slice_point=slice_center+Vector3(0,0,0.19) if OS.get_cmdline_user_args().has("--capture-pumpkins-offcenter") else slice_center
		pumpkins.impact(pumpkins.pumpkins[1].body,axe_preview,slice_point,Vector3.BACK,Vector3.UP*4)
		camera.global_position=Vector3(-9.5,1.3,7.5)
		camera.look_at(Vector3(-9.3,0.5,4.6))
		camera.fov=54
		await get_tree().create_timer(0.2).timeout
	if OS.get_cmdline_user_args().has("--capture-palm-menu"):
		camera.global_position=Vector3(0,1.6,0)
		camera.rotation=Vector3.ZERO
		var hand=XRController3D.new()
		add_child(hand)
		hand.tracker="left_hand"
		hand.global_position=Vector3(-0.20,1.61,-0.80)
		hand.global_basis=Basis(Vector3.BACK,PI/2)*Basis(Vector3.RIGHT,-PI/2)*_hand_basis(hand).inverse()
		adventure.build_hand(hand)
		var visual=hand.get_meta("hand_visual")
		visual.reparent(self)
		visual.visible=true
		qol.page="quick"
		qol._build()
		qol.opened=false
		qol.menu.global_transform=qol.palm_menu_transform(hand_socket(hand).global_transform)
		qol.menu.visible=true
		await get_tree().process_frame
	if capture_tuning:
		qol.page="quick" if capture_quick else "tuning"
		qol.toggle()
		await get_tree().create_timer(0.2).timeout
	if capture_bomb_stage in ["forming","ready"]:
		var model=bomb_art.create_bomb(desktop_hand,tuning.value("bomb.radius"))
		bomb_art.update_forming(model,0.5 if capture_bomb_stage=="forming" else 1.0)
		model.set_meta("ready",capture_bomb_stage=="ready")
		desktop_hand.position=Vector3(0.1,-0.12,-0.45)
	if capture_bomb_stage=="burst":
		var point=camera.global_position-camera.global_basis.z*3.5
		point.y=0.15
		bomb_art.explosion(point,3.2)
		await get_tree().create_timer(0.18).timeout
	if OS.get_cmdline_user_args().has("--capture-lantern-pair"):
		adventure.travel("forge_yard")
		camera.global_position=Vector3(9.6,1.72,7.0)
		camera.look_at(Vector3(12.0,1.05,7.0))
		camera.fov=64
		for lantern in forge_lanterns:
			lantern.target_angle=lantern.MAX_OPEN
			lantern.tick(0.4)
		if OS.get_cmdline_user_args().has("--capture-lantern-dark"):
			for child in get_children():
				if child is DirectionalLight3D: child.light_energy=0.03
			var world=get_world_3d().environment
			if world!=null:
				world.ambient_light_energy=0.07
				world.background_mode=Environment.BG_COLOR
				world.background_color=Color("151f2d")
		await get_tree().create_timer(0.15).timeout
	await RenderingServer.frame_post_draw
	var image = get_viewport().get_texture().get_image()
	print("CAPTURE ", image.save_png(capture_path))
	print("RENDER_STATS zone=",adventure.zone," fps=",Engine.get_frames_per_second()," objects=",Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)," draw_calls=",Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	if adventure.zone=="orchard_highlands" and OS.get_cmdline_user_args().has("--capture-orchard-breakdown"):
		var orchard_root:Node3D=scene.zones.orchard_highlands.root
		var buckets:Dictionary={}
		for visual in orchard_root.find_children("*","GeometryInstance3D",true,false):
			if not visual.is_visible_in_tree(): continue
			if not camera.is_position_in_frustum(visual.global_position): continue
			var direct:Node=visual
			while direct.get_parent()!=orchard_root and direct.get_parent()!=null: direct=direct.get_parent()
			var key:String=direct.name
			if key.begins_with("Orchard_"): key="Orchard art"
			if key.begins_with("gk_"): key="Ground kit"
			buckets[key]=int(buckets.get(key,0))+1
		print("ORCHARD_RENDER_BREAKDOWN ",JSON.stringify(buckets))
	get_tree().quit()

func _capture_workshop():
	# Offline visual fixture only: no service request or inventory mutation.
	var tier=4 if capture_tinker else clampi(capture_workshop_tier,1,4)
	state=JSON.parse_string(FileAccess.get_file_as_string("res://workshop_fixture.json"))
	state.tier=tier; state.workshop.donations.tier=tier+1 if tier<4 else null
	for entry in state.upgrades: entry.available=int(entry.tier)==tier+1; entry.completed=int(entry.tier)<=tier
	if tier<4:
		var sample="rat_tail" if tier==1 else ("iron" if tier==2 else "ember_core")
		state.workshop.tokens=[{"id":"preview-1","resource":sample,"place":"bucket","zone":"forge_yard","position":{"x":0,"y":0,"z":0}}]
		state.workshop.donations.counts={sample:1}
	for spec in state.workshop.catalog:
		if int(spec.tier)<=tier: state.workshop.modules.append({"id":"preview-"+spec.kind,"kind":spec.kind})
	workshop.sync_state()
	enchantments.ingest(state.get("workshop",{}))
	camera.global_position=Vector3(5.4,2.5,-1.6) if not capture_tinker else Vector3(11,2.3,-0.7)
	camera.look_at(Vector3(5.4,0.95,-4.7) if not capture_tinker else Vector3(11,0.8,-3))
	if OS.get_cmdline_user_args().has("--capture-pouch"):
		workshop.pouch_open=true; workshop.pouch_index=3; workshop._update_pouch(); workshop.pouch.reparent(self)
		camera.global_position=workshop.pouch.global_position+Vector3(0.22,0.60,0.65); camera.look_at(workshop.pouch.global_position+Vector3.UP*0.2)
	if OS.get_cmdline_user_args().has("--workshop-overview"):
		camera.global_position=Vector3(20,12,21); camera.look_at(Vector3(0,2,-5))
	await get_tree().create_timer(0.25).timeout
	await _capture()

func _hud():
	var layer = CanvasLayer.new()
	add_child(layer)
	var panel=PanelContainer.new()
	layer.add_child(panel)
	panel.position=Vector2(16,14)
	panel.custom_minimum_size=Vector2(470,0)
	panel.add_theme_stylebox_override("panel",_desktop_panel_style())
	var column=VBoxContainer.new()
	panel.add_child(column)
	hud = Label.new()
	column.add_child(hud)
	hud.add_theme_font_size_override("font_size", 18)
	hud.add_theme_color_override("font_color", Color("ffe2a1"))
	info = Label.new()
	column.add_child(info)
	info.add_theme_font_size_override("font_size", 14)
	info.add_theme_color_override("font_color",Color("d5e2d6"))
	info.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	info.custom_minimum_size.x=450
	info.text="Click to look · WASD move · E take · F1 controls"
	desktop_help_panel=PanelContainer.new()
	column.add_child(desktop_help_panel)
	desktop_help_panel.custom_minimum_size=Vector2(470,0)
	desktop_help_panel.add_theme_stylebox_override("panel",_desktop_panel_style())
	var help=Label.new()
	desktop_help_panel.add_child(help)
	help.add_theme_font_size_override("font_size",15)
	help.add_theme_color_override("font_color",Color("e6ebdd"))
	help.text="MOVE  WASD walk · Mouse look · Esc cursor\nGEAR  E take/drop · Left click primary · Right click alternate\nCROSSBOW  R cock + seat bolt · Hold R to reel tether\nTOOLS  1–8 equip · F destination · G travel\nWORLD  T teleport · U workshop · V talk to Brann\nVIEW  F11 fullscreen · Q turn left · F1 close help"
	desktop_help_panel.visible=false
	var cross = Label.new()
	layer.add_child(cross)
	cross.text = "+"
	cross.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	cross.add_theme_font_size_override("font_size", 28)
	layer.visible = not vr and capture_path.is_empty()

func _desktop_panel_style()->StyleBoxFlat:
	var style=StyleBoxFlat.new()
	style.bg_color=Color(0.055,0.085,0.09,0.82)
	style.border_color=Color(0.63,0.48,0.26,0.9)
	style.set_border_width_all(1)
	style.set_corner_radius_all(7)
	style.content_margin_left=12
	style.content_margin_right=12
	style.content_margin_top=8
	style.content_margin_bottom=8
	return style

func _process(delta):
	elapsed += delta
	if not smoke and delta>0.09 and elapsed-last_frame_hitch_log>2.0:
		last_frame_hitch_log=elapsed
		var forge_stage="idle"
		for job in state.get("jobs",[]):
			if str(job.get("status","")) in ["queued","building","validating"]:
				forge_stage=str(job.get("status")); break
		print("FRAME_HITCH ms=",snappedf(delta*1000,0.1)," forge=",forge_stage," zone=",adventure.zone if adventure!=null else "startup")
	if desktop_look!=null:
		desktop_look.set_enabled(not smoke and not (fairy!=null and fairy.active) and not (discoveries!=null and discoveries.opened) and not (qol!=null and qol.opened))
	if recording!=null: recording.tick(delta)
	if wyrmspout!=null: wyrmspout.tick(delta)
	if sunfall!=null: sunfall.tick(delta)
	if firecraft!=null: firecraft.tick(delta)
	if hearth_torch!=null: hearth_torch.tick(delta)
	if ember_gallery!=null: ember_gallery.tick(delta)
	if fairy_trails!=null: fairy_trails.tick(delta)
	if ember_creek!=null: ember_creek.tick(delta)
	if atelier!=null: atelier.tick(delta)
	for lantern in forge_lanterns: lantern.tick(delta)
	if not smoke:
		if vr: _xr_input()
		elif (director_local_view==null or not is_instance_valid(director_local_view) or not director_local_view.has_focus()) and (world_builder_view==null or not is_instance_valid(world_builder_view) or not world_builder_view.has_focus()): _desktop_input(delta)
	if not vr and not smoke: _desktop_weapon_motion(delta)
	if elapsed > next_poll and not busy and not diagnostic_offline:
		next_poll = elapsed + 2.0
		_poll()
	if elapsed > next_context and not context_busy and not diagnostic_offline:
		next_context = elapsed + 0.75
		_send_context()
	var p = camera.global_position
	if not smoke:
		var distance=Vector2(p.x-scene.brann.global_position.x,p.z-scene.brann.global_position.z).length()
		if presence!=null: presence.proximity()
		if visiting and not visit_entered:
			_notice("Near Brann · conversation starting. Point at Brann and press trigger to talk or retry.",8)
		visit_entered=visiting
	_speech_tick(delta)
	adventure.tick(delta)
	if apples!=null: apples.tick(delta)
	if pumpkins!=null: pumpkins.tick(delta)
	if living!=null: living.tick(delta)
	if quests!=null: quests.tick(delta)
	if cargo_playground!=null: cargo_playground.tick(delta)
	if magnetic_wand!=null: magnetic_wand.tick(delta)
	if playful_encounters!=null: playful_encounters.tick(delta)
	if playful_fair_art!=null: playful_fair_art.tick(delta)
	if bankshot!=null: bankshot.tick(delta)
	if bankshot_art!=null: bankshot_art.tick(delta)
	if echo_bells!=null: echo_bells.tick(delta)
	if lantern_gallery!=null: lantern_gallery.tick(delta)
	if playful_tools!=null: playful_tools.tick(delta)
	if playful_feedback!=null: playful_feedback.tick(delta)
	if festival_relay!=null: festival_relay.tick(delta)
	if festival_relay_art!=null: festival_relay_art.tick(delta)
	if demo_session!=null: demo_session.tick(delta)
	if weather!=null: weather.tick(delta)
	if heat_contacts!=null: heat_contacts.tick(delta)
	if director!=null: director.tick(delta)
	if is_instance_valid(director_local_view): director_local_view.tick(delta)
	if world_builder!=null: world_builder.tick(delta)
	if is_instance_valid(world_builder_view): world_builder_view.tick(delta)
	if workshop!=null: workshop.tick(delta)
	if enchantments!=null: enchantments.tick(delta)
	grips.tick(delta)
	siegebird.tick(delta)
	collection.tick()
	item_actions.tick(delta)
	qol.tick(delta)
	if feedback != null: feedback.tick(delta)
	bomb_art.audio_volume=0.0 if diagnostic_offline else tuning.value("audio.volume")
	bomb_art.tick(delta)
	remains.tick()
	var working = workshop_delivery.finishing
	var ready_count = 0
	for job in state.get("jobs", []):
		if job.status in ["queued", "building", "validating"]: working = true
		if job.status == "ready" and not collected.has(job.id): ready_count += 1
	scene.question.visible = ready_count > 0 or int(state.get("tails", 0)) >= 5
	# workshop_delivery owns the strike pose and its synchronized sound/sparks.
	for rat in scene.rats:
		if not is_instance_valid(rat) or not rat.get_meta("alive", true): continue
		if not rat.is_visible_in_tree(): continue
		var home: Vector3 = rat.get_meta("home", rat.position)
		var speed = 0.35 if elapsed < rat.get_meta("slow_until", 0.0) else 1.0
		var phase = float(rat.get_instance_id() % 10)
		var goal = home + Vector3(sin(elapsed * 0.6 + phase), 0, cos(elapsed * 0.4 + phase) * 0.45)
		var diff = goal - rat.position
		rat.position += diff.limit_length(delta * speed * 0.65)
		if diff.length() > 0.05: rat.rotation.y = atan2(diff.x, diff.z)
		if not visiting and elapsed > hurts_until and elapsed > shield_until and Vector2(rat.global_position.x, rat.global_position.z).distance_to(Vector2(p.x, p.z)) < 0.4:
			hurts_until = elapsed + 4.0
			rat.set_meta("bite_at",elapsed)
			_notice("A rat nipped you! Brann's workshop is safe.")
		var bite_age=elapsed-float(rat.get_meta("bite_at",-100.0))
		rat.set_meta("combat_phase","strike" if bite_age<0.65 else "idle")
		rat.set_meta("combat_progress",clampf(bite_age/0.65,0,1))
	var struck=[]
	animation.tick(delta)
	guardians.tick(delta)
	guardian_authored.tick(delta)
	melee.tick(delta)
	for key in held.keys():
		var weapon = held[key]
		if not is_instance_valid(weapon): continue
		if melee.handles(weapon) or weapon.get_meta("crossbow",false) or weapon.has_meta("fire_kind"): continue
		if weapon in struck: continue
		struck.append(weapon)
		if grips.adjusting.has(key):
			previous_tips.erase(key)
			continue
		var tip: Vector3 = weapon.to_global(weapon.get_meta("tip",Vector3.UP*0.7))
		if previous_tips.has(key) and vr:
			var previous: Vector3 = previous_tips[key]
			if tip.distance_to(previous) / maxf(delta, 0.001) > 0.8 and elapsed >= cooldown:
				for rat in scene.rats:
					if rat.get_meta("alive", false) and Geometry3D.get_closest_point_to_segment(rat.global_position + Vector3.UP * 0.18, previous, tip).distance_to(rat.global_position + Vector3.UP * 0.18) < 0.4:
						_kill_rat(rat)
						cooldown = elapsed + 0.35
				for target in scene.get("resources",[]) + scene.get("enemies",[]) + scene.get("barriers",[]):
					if is_instance_valid(target) and target.visible and Geometry3D.get_closest_point_to_segment(target.global_position + Vector3.UP*0.7,previous,tip).distance_to(target.global_position+Vector3.UP*0.7)<0.75:
						adventure.interact(target,weapon.get_meta("id","apprentice_hammer"),grips.grips.get(key,{}).get("hand",weapon.get_parent()))
		previous_tips[key] = tip
	_update_text()

func _update_text():
	var voice = state.get("voice", {}).get("voice", "vesper")
	var display_item=adventure.TOOL_NAMES.get(adventure.selected,adventure.selected)
	var current_item=held.get(str(desktop_hand.get_instance_id())) if desktop_hand!=null else null
	if is_instance_valid(current_item): display_item=str(current_item.get_meta("display_name",current_item.get_meta("id","Equipped tool")))
	var bounty = "Workshop Tier %d · %s" % [state.get("tier",1),display_item]
	scene.bounty_label.text = preload("res://progression_ui.gd").summary(state)
	preload("res://progression_ui.gd").update_cards(scene.buttons,state)
	scene.voice_label.text = "Brann's voice: " + voice.capitalize() + "  ·  Voice button cycles"
	hud.text = "BRANN'S FORGE  ·  " + bounty + ("  ·  " + quests.level_line() if quests!=null and not quests.data.is_empty() else "")
	if not vr: info.text=desktop_hint_override if not desktop_hint_override.is_empty() else _desktop_hint()
	if elapsed > status_until:
		var equipped = "Grip a weapon on the rack"
		if not held.is_empty():
			var weapon = held.values()[0]
			if is_instance_valid(weapon):
				equipped = str(weapon.get_meta("display_name", "Workshop hammer")) + (" · ready" if cooldown <= elapsed else " · recharging %.1fs" % (cooldown - elapsed))
		scene.status_label.text = equipped if online else "Forge service offline · local hammer still works"

func _notice(message: String, seconds = 7.0):
	print("GAME ", message)
	status_until = elapsed + seconds
	if scene.has("status_label"): scene.status_label.text = message

func _open_world_builder_view() -> void:
	if is_instance_valid(world_builder_view):
		world_builder_view.grab_focus()
		return
	if world_builder == null: return
	world_builder_view = preload("res://world_builder_view.gd").new()
	world_builder_view.visible = false
	add_child(world_builder_view)
	world_builder_view.setup(self, world_builder)
	print("WORLD_BUILDER_VIEW opened for the same live simulation; vr=", vr)

func _unhandled_input(event):
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode==KEY_F9:
		_open_world_builder_view(); return
	if not vr and event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode==KEY_F11:
			_desktop_fullscreen(); return
		if event.physical_keycode==KEY_F1 and desktop_help_panel!=null:
			desktop_help_panel.visible=not desktop_help_panel.visible
			return
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode==KEY_F8:
		if desktop_look!=null: desktop_look.release_capture()
		_start_fairy(); return
	if fairy!=null and fairy.active and not vr: return
	if vr or smoke: return
	if discoveries!=null and discoveries.input_event(event): return
	if qol.keyboard(event): return
	if desktop_look!=null:
		desktop_look.set_enabled(not (discoveries!=null and discoveries.opened) and not qol.opened)
		if desktop_look.handle_event(event): return
	if adventure.keyboard(event): return
	var mouse_action=preload("res://desktop_hero_actions.gd").route(event,false,false,Callable(self,"_desktop_primary"),Callable(self,"_desktop_alternate"))
	if mouse_action.handled: return
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_E: _grip(desktop_hand, true)
			KEY_X:
				if magnetic_wand!=null: magnetic_wand.secondary(desktop_hand)
			KEY_Q: _snap(deg_to_rad(qol.settings.snap_degrees))
			KEY_R:
				if siegebird.desktop_weapon(desktop_hand)!=null:
					if not siegebird.extras.tethered(siegebird.desktop_weapon(desktop_hand)): siegebird.desktop_reload(desktop_hand)
				else: _snap(-deg_to_rad(qol.settings.snap_degrees))
			KEY_T: _teleport(camera)
			KEY_H: _button("upgrade")
			KEY_V: _button("retry")

func _desktop_primary() -> void:
	var item=held.get(str(desktop_hand.get_instance_id()))
	if is_instance_valid(item) and item.get_meta("guardian_shield",false):
		guardians.desktop_bash(desktop_hand,camera)
		return
	if is_instance_valid(item) and melee.handles(item) and not item.get_meta("guardian_shield",false) and str(item.get_meta("id",""))!="grappling_hook":
		# Desktop has no physical swing. Use one deliberate ray strike while the
		# tracked VR path continues to use contact speed and blade constraints.
		var hit=_ray(camera,3.2)
		var target=_owner(hit.get("collider")) if hit.has("collider") else null
		if target!=null and (target.has_meta("action") or target.get_meta("kind","")=="brann"):
			_trigger(desktop_hand,true)
			return
		if elapsed<desktop_swing_ready: return
		desktop_swing_ready=elapsed+0.42
		desktop_swing_started=elapsed
		if target!=null: melee.strike(target,hit.position,hit.normal,2.4,desktop_hand,item)
		else: _effect(camera.global_position-camera.global_basis.z*0.8,Color("e9c184"),0.07,0.10)
		return
	_trigger(desktop_hand,true)

func _desktop_alternate() -> bool:
	var item=held.get(str(desktop_hand.get_instance_id()))
	if not is_instance_valid(item): return false
	if wyrmspout!=null and wyrmspout.vent(item): return true
	var crossbow=siegebird.desktop_weapon(desktop_hand)
	if crossbow!=null and crossbow.reel_installed:
		crossbow.grapple_mode=not crossbow.grapple_mode
		siegebird.mechanism(crossbow)
		_notice("Siegebird: grapple bolts" if crossbow.grapple_mode else "Siegebird: standard bolts",3)
		return true
	if str(item.get_meta("id",""))=="grappling_hook":
		if not item_actions.grapple.is_empty():
			item_actions.detach()
			_notice("Swallow Line released.",2)
		return true
	if magnetic_wand!=null and magnetic_wand.secondary(desktop_hand): return true
	if enchantments.alternate(item,desktop_hand): return true
	if guardians.trigger(desktop_hand,camera): return true
	if item_actions.trigger(desktop_hand,camera): return true
	return false

func _desktop_input(delta):
	if discoveries!=null and discoveries.opened: return
	if fairy!=null and fairy.active: return
	if qol.opened: return
	var movement = Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W): movement.z -= 1
	if Input.is_physical_key_pressed(KEY_S): movement.z += 1
	if Input.is_physical_key_pressed(KEY_A): movement.x -= 1
	if Input.is_physical_key_pressed(KEY_D): movement.x += 1
	var step = rig.basis * movement.normalized() * delta * tuning.value("locomotion.speed") * guardians.movement_multiplier()
	_move_to(rig.position + step)

func _desktop_weapon_motion(delta:float):
	if desktop_hand==null: return
	var distance=Vector2(rig.global_position.x-desktop_last_position.x,rig.global_position.z-desktop_last_position.z).length()
	desktop_last_position=rig.global_position
	var moving=not (discoveries!=null and discoveries.opened) and not qol.opened and distance>0.0001 and distance<0.25
	var target=clampf(distance/maxf(delta,0.001)/4.0,0,1) if moving else 0.0
	desktop_bob_strength=move_toward(desktop_bob_strength,target,delta*3.5)
	if desktop_bob_strength>0.001: desktop_bob_phase+=delta*10.0
	var bob=desktop_bob_strength
	var swing=0.0
	if desktop_swing_started>=0:
		var progress=(elapsed-desktop_swing_started)/0.38
		if progress>=1: desktop_swing_started=-1
		else: swing=sin(progress*PI)
	desktop_hand.position=Vector3(0.35+sin(desktop_bob_phase)*0.008*bob,-0.35+absf(cos(desktop_bob_phase))*0.012*bob,-0.55+0.11*swing)
	desktop_hand.rotation=Vector3(-0.28*swing,0.12*swing,0.018*sin(desktop_bob_phase)*bob-0.58*swing)
	var crossbow=siegebird.desktop_weapon(desktop_hand)
	if crossbow!=null and siegebird.extras.tethered(crossbow) and Input.is_physical_key_pressed(KEY_R):
		siegebird.extras.reel(crossbow,delta*TAU*1.4,delta)

func _desktop_fullscreen():
	var window=get_window()
	if window.mode==Window.MODE_FULLSCREEN or window.mode==Window.MODE_EXCLUSIVE_FULLSCREEN:
		window.mode=desktop_window_mode_before_fullscreen
	else:
		desktop_window_mode_before_fullscreen=window.mode
		window.mode=Window.MODE_FULLSCREEN

func _desktop_hint()->String:
	var crossbow=siegebird.desktop_weapon(desktop_hand)
	if crossbow!=null:
		var state_text="reloading" if crossbow.get("desktop_reloading",false) else ("ready" if crossbow.loaded else ("cocked · empty" if crossbow.draw>=0.999 else "empty"))
		return "Siegebird %s · unlimited bolts · LMB fire · R reload · F1 controls"%state_text
	var item=held.get(str(desktop_hand.get_instance_id()))
	if wyrmspout!=null and wyrmspout.is_wyrmspout(item): return "Wyrmspout · hold LMB for fire · release to cool · RMB vent · F1 controls"
	if is_instance_valid(item) and str(item.get_meta("id","")).begins_with("forge_lantern_"): return "Lantern · LMB toggle shutter · E drop · F1 controls"
	if is_instance_valid(item) and melee.handles(item):
		var action=str(item_actions.CONTROLS.get(str(item.get_meta("id","")),"Swing: strike · Trigger: special"))
		action=action.replace("Swing:","LMB").replace("Trigger:","RMB").replace("trigger:","RMB")
		return action + " · E drop · F1 controls"
	return "WASD move · Click to look · LMB use · E take · F1 controls · F11 fullscreen"

func _xr_input():
	for hand in hands:
		# Roll about the already-corrected finger axis, mirrored for the two palms.
		hand_socket(hand).basis=_hand_basis(hand)
	for hand in hands:
		if not hand.get_is_active():
			_cancel_inactive_playful_hand(hand)
			continue
		var key = str(hand.get_instance_id())
		if fairy!=null and fairy.active and str(hand.tracker).begins_with("right"):
			var calling=hand.is_button_pressed("by_button")
			if calling and not last_inputs.get("fairy_call",false): fairy.call_home()
			last_inputs["fairy_call"]=calling
		var was_gripped = last_inputs.get(key + "g", false)
		var grip = tuning.grip_state(hand.get_float("grip"),was_gripped,hand.is_button_pressed("grip_click"))
		var trigger = hand.is_button_pressed("trigger_click") or hand.get_float("trigger") > 0.65
		var held_tool=held.get(key)
		# Left B belongs exclusively to the hand menu. Right B can vent a
		# Wyrmspout held in either hand without competing with that menu.
		var vent_pressed=str(hand.tracker).begins_with("right") and hand.is_button_pressed("by_button")
		var vent_tool=held_tool
		if vent_pressed and wyrmspout!=null and not wyrmspout.is_wyrmspout(vent_tool) and not hands.is_empty():
			vent_tool=held.get(str(hands[0].get_instance_id()))
		if wyrmspout!=null and wyrmspout.is_wyrmspout(vent_tool) and vent_pressed and not last_inputs.get(key+"wv",false) and (fairy==null or not fairy.active): wyrmspout.vent(vent_tool)
		last_inputs[key+"wv"]=vent_pressed
		if is_instance_valid(held_tool) and held_tool.get_meta("crossbow",false) and not qol.opened:
			trigger=hand.get_float("trigger")>(0.15 if last_inputs.get(key+"t",false) else tuning.value("crossbow.trigger_break"))
		if not qol.opened and not firecraft.busy(hand): grips.adjust(hand,hand.is_button_pressed("ax_button"))
		if qol.opened and qol.page in ["tuning","quick"] and hand==qol.menu_hand(): tuning.slider_input(aim_source(hand),trigger)
		var grabbed=false
		if grip and not was_gripped and not qol.opened:
			grabbed = _grip(hand, false)
		if bomb_input.tick(key,grip,was_gripped,trigger,last_inputs.get(key+"t",false),grabbed,held.has(key) or _lantern_shutter_busy(hand) or ((playful_tools!=null and playful_tools.claims_trigger(hand)) or (magnetic_wand!=null and magnetic_wand.claims_trigger(hand)) or ((cargo_playground!=null and cargo_playground.busy(hand)) or (echo_bells!=null and echo_bells.busy(hand)))) or firecraft.busy(hand) or siegebird.busy(hand) or (living!=null and living.claims_trigger(hand)) or workshop.busy(hand) or enchantments.busy(hand),qol.opened or (fairy!=null and fairy.perched_on(hand)),elapsed):
			adventure.begin_bomb(hand)
		if not grip and was_gripped:
			print("GRIP_RELEASE hand=",hand.tracker," amount=",snappedf(hand.get_float("grip"),0.01)," threshold=",tuning.value("input.grip_release"))
			adventure.release(hand)
		if trigger and not last_inputs.get(key + "t", false) and _trigger_allowed(hand,grip): _trigger(hand, false)
		last_inputs[key + "g"] = grip
		last_inputs[key + "t"] = trigger
		var pointer=aim_source(hand)
		var ray = _ray(pointer, 8.0)
		_draw_ray(pointer.global_position, ray.get("position", pointer.global_position - pointer.global_basis.z * 6.0), hands.find(hand))
	if hands.size() == 2:
		if qol.opened: return
		if hands[0].get_is_active(): _walk_stick(hands[0].get_vector2("primary"),get_process_delta_time())
		var axis = hands[1].get_vector2("primary")
		if qol.settings.turn == "smooth" and absf(axis.x)>0.2:
			_snap(-axis.x*deg_to_rad(qol.settings.turn_speed)*get_process_delta_time())
		elif absf(axis.x) > 0.75 and not turn_latched:
			_snap(-signf(axis.x) * deg_to_rad(qol.settings.snap_degrees))
			turn_latched = true
		if absf(axis.x) < 0.3: turn_latched = false
		var teleport_pressed = qol.other_hand().is_button_pressed("primary_click")
		if teleport_pressed and not last_inputs.get("teleport", false): _teleport(qol.other_hand())
		last_inputs["teleport"] = teleport_pressed

func _snap(angle):
	tuning.history.clear()
	adventure.motion.clear()
	var head = camera.global_position
	rig.rotation.y += angle
	var difference = head - camera.global_position
	difference.y = 0
	_move_to(rig.position + difference)

func hand_socket(hand:Node3D)->Node3D:
	if not hand is XRController3D: return hand
	var key=str(hand.get_instance_id())
	if not hand_sockets.has(key):
		var socket=Node3D.new()
		socket.name="CalibratedGrip"
		hand.add_child(socket)
		socket.basis=_hand_basis(hand)
		hand_sockets[key]=socket
	return hand_sockets[key]

func _hand_basis(hand:XRController3D)->Basis:
	var side=1.0 if str(hand.tracker).begins_with("left") else -1.0
	var pitch=tuning.value("hands.pitch_degrees") if tuning!=null else -90.0
	var yaw=tuning.value("hands.yaw_degrees") if tuning!=null else 0.0
	var roll=tuning.value("hands.roll_degrees") if tuning!=null else 0.0
	return Basis.from_euler(Vector3(deg_to_rad(pitch),deg_to_rad(yaw),0))*Basis(Vector3.BACK,deg_to_rad(90*side+roll))

func aim_source(source:Node3D)->Node3D:
	# The calibrated hand points along -Z; runtime aim poses differ across devices.
	# Use the same stable axis as the visible index finger, independent of its curl.
	return hand_socket(source) if source is XRController3D and source in hands else source

func _walk_stick(axis:Vector2,delta:float):
	if axis.length()<0.18: return
	var strength=clampf((axis.length()-0.18)/0.82,0,1)
	var forward=-camera.global_basis.z
	forward.y=0
	if forward.length()<0.01: forward=-rig.global_basis.z
	forward=forward.normalized()
	var right=forward.cross(Vector3.UP)
	var direction=(right*axis.x+forward*axis.y).normalized()
	var destination=rig.position+direction*strength*tuning.value("locomotion.speed")*guardians.movement_multiplier()*delta
	_move_to(destination)

func _cancel_inactive_playful_hand(hand):
	if not hand is XRController3D or hand.get_is_active(): return
	if hearth_torch!=null and hearth_torch.busy(hand): hearth_torch.home()
	if ember_gallery!=null and ember_gallery.busy(hand): ember_gallery.home()
	# Tracking loss cancels ownership; ordinary release would throw or ring.
	if echo_bells!=null and echo_bells.busy(hand): echo_bells._cancel_grip()
	if cargo_playground!=null and cargo_playground.busy(hand): cargo_playground.release(hand)
	if playful_tools!=null and playful_tools.busy(hand): playful_tools._home()
	if magnetic_wand!=null and magnetic_wand.busy(hand): magnetic_wand._home()

func _move_to(destination: Vector3):
	var bounded = destination
	var floor_query = PhysicsRayQueryParameters3D.create(destination+Vector3.UP*3.0,destination+Vector3.DOWN*4.0,1)
	var floor_hit = get_world_3d().direct_space_state.intersect_ray(floor_query)
	if floor_hit.is_empty() or floor_hit.normal.y<0.8: return
	var floor_owner = _owner(floor_hit.collider)
	if floor_owner==null or floor_owner.get_meta("kind","") not in ["floor","solid"]: return
	if floor_owner.get_meta("kind","")=="solid" and float(floor_hit.position.y)-rig.global_position.y>0.35: return
	bounded.y = float(floor_hit.position.y)+0.02
	var query = PhysicsShapeQueryParameters3D.new()
	var capsule = CapsuleShape3D.new()
	capsule.radius = 0.2
	capsule.height = 1.5
	query.shape = capsule
	query.collision_mask = 1
	query.transform = Transform3D(Basis.IDENTITY, bounded + Vector3.UP * 0.95)
	if get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty(): rig.position = bounded

func _teleport(source: Node3D):
	var hit = _ray(source, 12.0)
	if hit.is_empty() or hit.normal.y < 0.8: return
	var target = _owner(hit.collider)
	if target == null or target.get_meta("kind", "") != "floor": return
	var destination: Vector3 = hit.position
	var offset = camera.global_position - rig.global_position
	destination -= Vector3(offset.x, 0, offset.z)
	_move_to(destination)
	tuning.history.clear()
	adventure.motion.clear()

func _ray(source: Node3D, distance: float) -> Dictionary:
	source=aim_source(source)
	var start = source.global_position
	var query = PhysicsRayQueryParameters3D.create(start, start - source.global_basis.z * distance)
	query.collide_with_areas = true
	return get_world_3d().direct_space_state.intersect_ray(query)

func _owner(node):
	while node != null and node != self:
		if node.has_meta("pickup_proxy"): return node.get_meta("pickup_proxy")
		if node.has_meta("kind") or node.has_meta("action"): return node
		node = node.get_parent()
	return null

func _trigger_allowed(hand,gripping:bool)->bool:
	return not gripping or held.has(str(hand.get_instance_id())) or ((playful_tools!=null and playful_tools.claims_trigger(hand)) or (magnetic_wand!=null and magnetic_wand.claims_trigger(hand)) or ((cargo_playground!=null and cargo_playground.busy(hand)) or (echo_bells!=null and echo_bells.busy(hand)))) or qol.opened or (living!=null and living.claims_trigger(hand))

func _notification(what):
	if what==NOTIFICATION_WM_CLOSE_REQUEST:
		if demo_session!=null: demo_session.save_now()
		if living!=null: living._save()
		if world_builder!=null: world_builder.save()

func _grip(hand: Node3D, desktop: bool):
	if fairy!=null: fairy.offer_to(hand)
	if fairy!=null and fairy.perched_on(hand): return true
	var key = str(hand.get_instance_id())
	if desktop and (workshop.busy(hand) or enchantments.busy(hand) or living.busy(hand) or ((playful_tools!=null and playful_tools.busy(hand)) or (magnetic_wand!=null and magnetic_wand.busy(hand)) or ((cargo_playground!=null and cargo_playground.busy(hand)) or (echo_bells!=null and echo_bells.busy(hand))))):
		adventure.release(hand,true); return true
	if held.has(key):
		if desktop: adventure.release(hand,true)
		return true
	for lantern in forge_lanterns:
		if lantern.try_grab_shutter(hand,desktop): return true
	if apples!=null and apples.try_grab(hand,desktop): return true
	if hearth_torch!=null and hearth_torch.try_grab(hand,desktop): return true
	if ember_gallery!=null and ember_gallery.try_grab(hand,desktop): return true
	if echo_bells!=null and echo_bells.try_grab(hand,desktop): return true
	if lantern_gallery!=null and lantern_gallery.try_grab(hand,desktop): return true
	if bankshot!=null and bankshot.try_grab(hand,desktop): return true
	if cargo_playground!=null and cargo_playground.try_grab(hand,desktop): return true
	if magnetic_wand!=null and magnetic_wand.try_grab(hand,desktop): return true
	if playful_tools!=null and playful_tools.try_grab(hand,desktop): return true
	if living!=null and living.try_grab(hand): return true
	if firecraft.try_grab(hand,desktop): return true
	if workshop!=null and workshop.try_grab(hand): return true
	if enchantments!=null and enchantments.try_grab(hand): return true
	if siegebird.try_grab(hand): return true
	if grips.try_grab(hand): return true
	if guardians.grip(hand): return true
	var pick = null
	if desktop:
		var hit = _ray(camera, 3.0)
		if hit.has("collider"): pick = _owner(hit.collider)
	if pick != null and pick.get_meta("kind", "") not in ["weapon", "tail", "resource", "cache"]: pick = null
	if pick == null:
		var distance = 2.1 if desktop else 0.45
		for candidate in get_tree().get_nodes_in_group("pickup"):
			if not is_instance_valid(candidate) or not candidate.is_visible_in_tree(): continue
			if candidate in held.values() or grips.is_stowed(candidate): continue
			var d = candidate.global_position.distance_to(hand.global_position)
			if d < distance:
				distance = d
				pick = candidate
	if pick == null: pick = qol.distance_pick(hand)
	if pick in held.values() or grips.is_stowed(pick): pick=null
	if pick == null: return false
	var kind = pick.get_meta("kind", "")
	if kind == "cache": adventure.recover()
	elif kind == "resource": adventure.interact(pick,"hand",hand)
	elif kind == "tail":
		_collect_tail(pick)
	elif kind == "weapon":
		if pick.has_meta("collection_id"):
			collection.take(pick,hand)
			return true
		for held_key in held.keys():
			if held[held_key] == pick: held.erase(held_key)
		grips._attach(hand,pick)
		collected[pick.get_meta("id", "starter_hammer")] = true
		_notice("Equipped " + str(pick.get_meta("display_name", "workshop hammer")))
		adventure.haptic(hand,"ready")
		if is_instance_valid(qol.presentation_label) and qol.presentation_label.get_parent()==pick:
			qol.presentation_label.queue_free()
	return true

func _lantern_shutter_busy(hand: Node3D) -> bool:
	for lantern in forge_lanterns:
		if lantern.busy(hand): return true
	return false

func _start_fairy():
	if fairy!=null:
		if fairy.active: fairy.window.grab_focus()
		else: fairy.reopen()
		return
	fairy=load("res://fairy_coop.gd").new(); add_child(fairy); fairy.setup(self)

func _set_collisions(node: Node, enabled: bool):
	if node is CollisionShape3D: node.set_deferred("disabled", not enabled)
	for child in node.get_children(): _set_collisions(child, enabled)

func _trigger(hand: Node3D, desktop: bool):
	var source = camera if desktop else aim_source(hand)
	if qol.menu_trigger(source): return
	for lantern in forge_lanterns:
		if lantern.trigger(hand): return
	if echo_bells!=null and echo_bells.busy(hand): return
	if cargo_playground!=null and cargo_playground.busy(hand): return
	# Desktop has one hand: visible activity controls must remain usable with a toy.
	if desktop and _desktop_activity_button(source,hand): return
	if hearth_torch!=null and hearth_torch.trigger(hand): return
	if ember_gallery!=null and ember_gallery.trigger(hand): return
	if magnetic_wand!=null and magnetic_wand.trigger(hand): return
	if playful_tools!=null and playful_tools.trigger(hand): return
	var living_hit=_ray(source,8.0)
	var living_target=_owner(living_hit.collider) if living_hit.has("collider") else null
	if living!=null and living.trigger(hand,living_target): return
	if atelier!=null and atelier.trigger(hand,source): return
	if guardians.trigger(hand,source): return
	if firecraft.trigger(hand): return
	if apples!=null and apples.bite(hand): return
	if workshop.busy(hand) or enchantments.busy(hand): return
	var held_item=held.get(str(hand.get_instance_id()))
	if held_item!=null and not desktop: enchantments.alternate(held_item,hand)
	if siegebird.trigger(hand): return
	var hit = _ray(source, 6.0)
	if hit.has("collider"):
		var target = _owner(hit.collider)
		if siegebird.extras.interact(target,hand): return
		if zone_details.interact(target,hand): return
		if target!=null and target.get_meta("kind","")=="brann":
			if camera.global_position.distance_to(scene.brann.global_position+Vector3.UP*1.3)<3.5:
				visiting=true
				await _send_context()
				await _button("retry")
			else: _notice("Come a little closer to talk to Brann.")
			return
		if target != null and target.has_meta("action"):
			if not button_feedback.press(target,hand): return
			_button(str(target.get_meta("action")))
			return
	if zone_details.held_action(hand): return
	if wyrmspout!=null and wyrmspout.start(hand): return
	if item_actions.trigger(hand,source): return
	if adventure.trigger(hand,source): return
	var key = str(hand.get_instance_id())
	if not held.has(key):
		_notice("Grip a weapon first (E on desktop).")
		return
	if elapsed < cooldown: return
	var weapon = held[key]
	var id = weapon.get_meta("id", "starter_hammer")
	if id == "starter_hammer":
		cooldown = elapsed + 0.55
		var forward = -source.global_basis.z
		for target in scene.rats + scene.dummies:
			var difference = target.global_position + Vector3.UP * 0.2 - source.global_position
			if difference.length() < 2.6 and difference.normalized().dot(forward) > 0.72:
				if target.get_meta("kind", "") == "rat": _kill_rat(target)
				else: _dummy_hit(target)
		_effect(hand.global_position - source.global_basis.z * 0.6, Color("ffc774"), 0.2, 0.25)
	else:
		cooldown = elapsed + 0.3
		var response = await _request("/api/vr/ability", {"id":id,"position":_vec(camera.global_position),"forward":_vec(-source.global_basis.z),"targets":_targets(camera.global_position)})
		if response.has("error"):
			_notice(response.error)
			return
		cooldown = elapsed + float(response.get("cooldown", 4))
		active_ability_hand = hand
		adventure.haptic(hand,"release")
		for action in response.get("actions", []): _apply_action(action)

func _desktop_activity_button(source:Node3D,hand:Node3D)->bool:
	if not ((hearth_torch!=null and hearth_torch.busy(hand)) or (ember_gallery!=null and ember_gallery.busy(hand)) or (playful_tools!=null and playful_tools.claims_trigger(hand)) or (magnetic_wand!=null and magnetic_wand.claims_trigger(hand))): return false
	var hit=_ray(source,6.0)
	var target=_owner(hit.get("collider"))
	if target==null or not target.has_meta("action"): return false
	var action=str(target.get_meta("action"))
	var activity=false
	for prefix in ["ember:","playful_encounter:","cargo:","bankshot:","festival:","echo:","lantern_gallery:"]:
		if action.begins_with(prefix): activity=true; break
	if not activity: return false
	if button_feedback.press(target,hand): _button(action)
	return true

func _button(action: String):
	if action.begins_with("creek:") and ember_creek!=null:
		ember_creek.act(action.trim_prefix("creek:")); return
	if action.begins_with("fairytrail:") and fairy_trails!=null:
		fairy_trails.act(action.trim_prefix("fairytrail:")); return
	if action.begins_with("ember:") and ember_gallery!=null:
		ember_gallery.act(action.trim_prefix("ember:")); return
	if action.begins_with("echo:") and echo_bells!=null:
		echo_bells.act(action.trim_prefix("echo:")); return
	if action.begins_with("lantern_gallery:") and lantern_gallery!=null:
		lantern_gallery.act(action.trim_prefix("lantern_gallery:")); return
	if action.begins_with("festival:") and festival_relay!=null:
		festival_relay.act(action.trim_prefix("festival:")); return
	if action.begins_with("bankshot:") and bankshot!=null:
		bankshot.act(action.trim_prefix("bankshot:")); return
	if action.begins_with("cargo:") and cargo_playground!=null:
		cargo_playground.act(action.trim_prefix("cargo:")); return
	if action.begins_with("playful_encounter:") and playful_encounters!=null:
		playful_encounters.act(action.trim_prefix("playful_encounter:")); return
	if workshop!=null and workshop.action(action): return
	if enchantments!=null and enchantments.action(action): return
	if action.begins_with("collection:"):
		collection.return_item(action.trim_prefix("collection:"))
		return
	if action.begins_with("lab:") and animation_lab!=null:
		animation_lab.action(action.trim_prefix("lab:"))
		return
	if action.begins_with("qol:"):
		qol.action(action.trim_prefix("qol:"))
		return
	if adventure.button(action): return
	match action:
		"handin":
			var response = await _request("/api/vr/handin", {})
			_notice(response.get("error", "Five tails accepted. One forging favour earned."))
			_poll()
		"retry":
			await _request("/api/vr/voice", {"enabled":true,"voice":state.get("voice", {}).get("voice", "vesper")})
			_notice("Connecting to Brann…" if state.get("voiceClient",{}).get("connected",false) else "Audio helper is not connected. Relaunch using Start Brann VR.",8)
		"voice":
			var current = state.get("voice", {}).get("voice", "vesper")
			var next = VOICES[(VOICES.find(current) + 1) % VOICES.size()]
			await _request("/api/vr/voice", {"enabled":true,"voice":next})
			_notice("Voice: " + next.capitalize() + ". Applies to the next conversation.")
			_poll()
		"commission":
			_notice("Tell Brann your invention idea. Finished tools arrive on their named collection stands.", 12)
			_button("retry")

func _targets(origin: Vector3) -> Array:
	# service/world.js accepts at most 100 targets. Keep all scene nodes available
	# locally, and send the nearest useful subset for context and abilities.
	var candidates = []
	var order = 0
	for target in scene.rats + scene.dummies + scene.get("enemies",[]) + scene.get("resources",[]) + scene.get("barriers",[]) + scene.get("anchors",[]):
		if not is_instance_valid(target): continue
		var entry = _vec(target.global_position)
		entry.id = str(target.get_meta("id", "dummy-" + str(target.get_instance_id())))
		entry.type = target.get_meta("kind", "dummy")
		entry.enemy_type = target.get_meta("enemy_type", "")
		entry.resource = target.get_meta("resource", "")
		entry.requires = target.get_meta("requires", "")
		entry.alive = target.get_meta("alive", true)
		var distance_sq = target.global_position.distance_squared_to(origin)
		var threat = entry.alive and entry.type in ["rat", "dummy", "enemy", "skeleton", "boss", "guardian", "golem", "wisp"]
		var nearby = distance_sq <= 144.0
		var priority = 0 if threat and nearby else (1 if nearby else (2 if threat else 3))
		candidates.append({"entry":entry,"distance_sq":distance_sq,"priority":priority,"order":order})
		order += 1
	candidates.sort_custom(func(a, b):
		if a.priority != b.priority: return a.priority < b.priority
		if a.distance_sq != b.distance_sq: return a.distance_sq < b.distance_sq
		return a.order < b.order
	)
	var list = []
	for candidate in candidates.slice(0, 100): list.append(candidate.entry)
	return list

func _send_context():
	if diagnostic_offline: return
	context_busy = true
	var id = ""
	if not held.is_empty(): id = held.values()[0].get_meta("id", "starter_hammer")
	var controllers = []
	for hand in hands: controllers.append({"hand":"left" if str(hand.tracker).begins_with("left") else "right","profile":"OpenXR","haptics":true,"tracked":hand.get_is_active()})
	await _request("/api/vr/context", {"position":_vec(camera.global_position),"visiting":visiting,"equipped":id,"targets":_targets(camera.global_position),"zone":adventure.zone,"controllers":controllers,"interactionProfilesApplied":siegebird.extras.applied_versions,"interaction":adventure.last_interaction,"health":adventure.hp,"playful":_playful_context(),"worldChallenges":[adventure.hollow.context()] if adventure.hollow != null else [],"presence":{"distance":presence.distance if presence!=null else 0.0,"phase":presence.phase if presence!=null else "away"}})
	context_busy = false

func _poll():
	if busy: return
	busy = true
	var response = await _request("/api/vr/state")
	online = not response.has("error")
	if online:
		if int(response.get("workshop",{}).get("revision",0))<workshop.revision:
			busy=false; return
		state = response
		if workshop!=null: workshop.sync_state()
		if enchantments!=null: enchantments.ingest(state.get("workshop",{}))
		var voice_status=str(state.get("voiceClient",{}).get("message",""))
		if visiting and voice_status!=voice_client_message and not voice_status.is_empty():
			voice_client_message=voice_status
			_notice(voice_status,8)
		tuning.ingest(state.get("tuning",{}))
		if living!=null: living.sync(state.get("liveWorkshop",{}))
		if quests!=null: quests.ingest(state.get("rpg",{}))
		adventure._sync_cache()
		for item in state.get("items", []):
			if not imported.has(item.id) and not pending.has(item.id): _import_item(item)
		collection.sync()
		await _receive_deliveries()
	busy = false

func _receive_deliveries():
	for delivery in state.get("deliveries",[]):
		var id=str(delivery.get("id",""))
		var tool_id=str(delivery.get("toolId",""))
		if id.is_empty() or not adventure.TOOL_NAMES.has(tool_id): continue
		if not delivery_seen.has(id):
			if adventure.operation: continue
			var item=adventure._tool_model(tool_id)
			add_child(item)
			await workshop_delivery.present(item,id)
			delivery_seen[id]=true
			print("DELIVERY_NATIVE id=",id," tool=",tool_id)
		await _request("/api/vr/delivery-ack",{"id":id})

func _speech_tick(delta):
	if presence==null:
		presence=preload("res://brann_presence.gd").new()
		add_child(presence)
		presence.setup(self)
	if not diagnostic_offline and not smoke and visiting and elapsed>=speech_next and not speech_busy:
		speech_next=elapsed+0.1
		_poll_speech()
	var target=speech_target if visiting and elapsed-speech_seen<0.8 else 0.0
	speech_level=lerpf(speech_level,target,clampf(delta*18,0,1))
	var head=scene.brann.get_meta("speech_head")
	var beard=scene.brann.get_meta("speech_beard")
	presence.tick(delta)
	beard.position.y=-speech_level*(0.012+0.005*sin(elapsed*25))

func _poll_speech():
	speech_busy=true
	var response=await _request("/api/vr/speech")
	speech_target=clampf(float(response.get("level",0)),0,1) if response.get("active",false) else 0.0
	speech_seen=elapsed
	speech_busy=false

func _request(path: String, body = null) -> Dictionary:
	if diagnostic_offline: return {"error":"Visual diagnostic: service calls disabled."}
	var http = HTTPRequest.new()
	add_child(http)
	http.timeout = 15
	var error = http.request(service + path, PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_GET if body == null else HTTPClient.METHOD_POST, "" if body == null else JSON.stringify(body))
	if error != OK:
		http.queue_free()
		return {"error":"Forge connection failed.","transportError":true}
	var reply = await http.request_completed
	http.queue_free()
	if reply[0] != HTTPRequest.RESULT_SUCCESS: return {"error":"Forge connection was interrupted. Reconnecting to check your progress.","transportError":true}
	var decoded = JSON.parse_string(reply[3].get_string_from_utf8())
	if not decoded is Dictionary: return {"error":"Invalid forge response.","transportError":true}
	return decoded

func _kill_rat(rat: Node3D):
	if not rat.get_meta("alive", true): return
	rat.set_meta("alive", false)
	if quests!=null: quests.enemy_defeated(rat,"rat")
	remains.shatter(rat)
	rat.visible = false
	_set_collisions(rat, false)
	var id = str(rat.get_meta("id"))
	var tail = Node3D.new()
	add_child(tail)
	tail.global_position = rat.global_position + Vector3.UP * 0.12
	tail.reparent(adventure.zone_groups.get("enchanted_kitchen",self))
	tail.set_meta("kind", "tail")
	tail.set_meta("id", id)
	tail.add_to_group("pickup")
	for i in range(6):
		_sphere(tail, Vector3(sin(i * 0.5) * 0.12, 0.04, i * 0.05), 0.035, Color("efb477"))
	_collider(tail, Vector3(0.35, 0.18, 0.4), Vector3(0.05, 0.05, 0.1))
	var label = Label3D.new()
	tail.add_child(label)
	label.position.y = 0.25
	label.text = "TAIL · GRIP"
	label.font_size = 24
	label.pixel_size = 0.003
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_notice("Rat defeated. Grip its tail to collect it.")
	_request("/api/vr/kill", {"id":id})
	_respawn(rat)

func _respawn(rat: Node3D):
	await get_tree().create_timer(9.0).timeout
	if not is_instance_valid(rat): return
	rat.set_meta("quest_death_recorded",false)
	rat.position = rat.get_meta("home")
	rat.set_meta("id", "rat-" + str(Time.get_unix_time_from_system()) + "-" + str(rat.get_instance_id()))
	rat.set_meta("alive", true)
	animation.restore(rat)
	rat.visible = true
	_set_collisions(rat, true)

func _collect_tail(tail: Node3D):
	if tail.get_meta("collecting", false): return
	tail.set_meta("collecting", true)
	var id = str(tail.get_meta("id"))
	# Idempotent registration closes the race with an outstanding kill request.
	var registered = await _request("/api/vr/kill", {"id":id})
	var result = registered if registered.has("error") else await _request("/api/vr/tail", {"id":id})
	if result.has("error"):
		tail.set_meta("collecting", false)
		_notice(result.error)
	else:
		tail.queue_free()
		_notice("Tail collected. Bring five to Brann.")
		_poll()

func _apply_action(action: Dictionary):
	var position = Vector3(action.x, action.get("y",0.15), action.z)
	var seconds = clampf(float(action.get("duration", 450)) / 1000.0, 0.08, 3.0)
	var color = Color(action.get("color", "#8be4ff"))
	_effect(position, color, seconds, 0.7)
	match action.type:
		"chop", "mine", "ignite", "grapple", "resonate":
			var tool = {"chop":"woodland_axe","mine":"quarry_pick","ignite":"ember_gauntlet","grapple":"grappling_hook","resonate":"crystal_resonator"}[action.type]
			for target in scene.get("resources",[]) + scene.get("barriers",[]) + scene.get("anchors",[]):
				if is_instance_valid(target) and target.global_position.distance_to(position)<2: adventure.interact(target,tool)
			if action.type=="ignite":
				adventure.explode(position,2,35,null,-1.0,"fire")
				if heat_contacts!=null: heat_contacts.touch(position,1.8,350,adventure.zone,"scripted_ignite",null,.1)
		"blast": _flame(position, seconds)
		"slow", "pull":
			for rat in scene.rats + scene.get("enemies",[]):
				if rat.get_meta("alive", true) and _same_tile(rat.global_position, position):
					if action.type == "slow": rat.set_meta("slow_until", elapsed + seconds)
					else:
						var destination:Vector3=rat.position+(rig.position-rat.position).normalized()*0.65
						var query=PhysicsRayQueryParameters3D.create(rat.global_position+Vector3.UP*0.8,destination+Vector3.UP*0.8,1)
						if get_world_3d().direct_space_state.intersect_ray(query).is_empty(): rat.position=destination
		"shield":
			shield_until = elapsed + seconds
			_notice("A ward surrounds you.")
		"dash": _move_to(position)
		"bomb": _bomb(position)

func _same_tile(a: Vector3, b: Vector3) -> bool:
	return absf(a.x - b.x) <= 0.55 and absf(a.z - b.z) <= 0.55

func _blast(position: Vector3):
	for wall in scene.get("barriers",[]):
		if is_instance_valid(wall) and wall.visible and wall.global_position.distance_to(position)<2:
			wall.visible=false
			_set_collisions(wall,false)
	for enemy in scene.get("enemies",[]):
		if _same_tile(enemy.global_position,position): adventure.hurt_enemy(enemy,45,active_ability_hand)
	for target in scene.rats + scene.dummies:
		if _same_tile(target.global_position, position):
			if target.get_meta("kind", "") == "rat": _kill_rat(target)
			else: _dummy_hit(target)

func _flame(position: Vector3, seconds: float):
	_blast(position)
	var remaining = seconds
	while remaining > 0.1:
		await get_tree().create_timer(0.1).timeout
		remaining -= 0.1
		for rat in scene.rats:
			if rat.get_meta("alive", false) and _same_tile(rat.global_position, position): _kill_rat(rat)

func _bomb(position: Vector3):
	adventure.throw_bomb(position+Vector3.UP*0.2,Vector3.ZERO,Vector3.ZERO,active_ability_hand)

func _dummy_hit(dummy: Node3D):
	dummy.set_meta("hits", int(dummy.get_meta("hits", 0)) + 1)
	_effect(dummy.global_position + Vector3.UP, Color("ffcc66"), 0.4, 0.5)
	_notice("Practice target hit · " + str(dummy.get_meta("hits")))

func _effect(position: Vector3, color: Color, seconds: float, size: float):
	var node = _sphere(self, position, size * 0.5, color)
	var tween = create_tween()
	tween.tween_property(node, "scale", Vector3.ONE * 0.03, seconds)
	tween.tween_callback(node.queue_free)

func _sphere(parent: Node3D, position: Vector3, radius: float, color: Color) -> MeshInstance3D:
	var mesh = MeshInstance3D.new()
	var shape = SphereMesh.new()
	shape.radius = radius
	shape.height = radius * 2
	shape.radial_segments = 12
	shape.rings = 6
	mesh.mesh = shape
	var material = StandardMaterial3D.new()
	material.albedo_color = color
	mesh.material_override = material
	parent.add_child(mesh)
	mesh.position = position
	return mesh

func _collider(parent: Node3D, size: Vector3, center: Vector3):
	var body = StaticBody3D.new()
	parent.add_child(body)
	var collision = CollisionShape3D.new()
	body.add_child(collision)
	var shape = BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	collision.position = center

func _draw_ray(start: Vector3, end: Vector3, index: int):
	while ray_visuals.size() <= index:
		var visual = MeshInstance3D.new()
		add_child(visual)
		ray_visuals.append(visual)
	var segment = ray_visuals[index]
	var mesh = ImmediateMesh.new()
	var material = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = Color(1.0, 0.8, 0.35, 0.8)
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, material)
	mesh.surface_add_vertex(start)
	mesh.surface_add_vertex(end)
	mesh.surface_end()
	segment.mesh = mesh

func _import_item(item: Dictionary):
	pending[item.id] = true
	var http = HTTPRequest.new()
	add_child(http)
	http.timeout = 20
	http.body_size_limit = 8 * 1024 * 1024
	var url = str(item.modelUrl)
	# Use the configured local service even when an isolated test port is selected.
	var marker = url.find("/forge-assets/")
	if marker < 0:
		pending.erase(item.id)
		http.queue_free()
		return
	var error = http.request(service + url.substr(marker))
	if error != OK:
		pending.erase(item.id)
		http.queue_free()
		return
	var response = await http.request_completed
	http.queue_free()
	if response[0] != HTTPRequest.RESULT_SUCCESS or response[1] != 200:
		pending.erase(item.id)
		_notice("Could not load " + item.name + ". Retrying on the next rack refresh.")
		return
	var document = GLTFDocument.new()
	var gltf_state = GLTFState.new()
	var is_wyrm = str(item.id)==wyrmspout.ITEM_ID
	var asset_bytes=FileAccess.get_file_as_bytes(siegebird.ASSEMBLY_PATH) if str(item.id)==siegebird.ITEM_ID else (FileAccess.get_file_as_bytes("res://assets/wyrmspout.glb") if is_wyrm and FileAccess.file_exists("res://assets/wyrmspout.glb") else response[3])
	error = document.append_from_buffer(asset_bytes, "", gltf_state)
	if error != OK:
		pending.erase(item.id)
		_notice("The finished model could not be imported (" + str(error) + ").")
		return
	var model = document.generate_scene(gltf_state)
	if model == null:
		pending.erase(item.id)
		return
	var weapon = Node3D.new()
	add_child(weapon)
	weapon.add_child(model)
	var bounds = _bounds(model, Transform3D.IDENTITY)
	var longest = maxf(bounds.size.x, maxf(bounds.size.y, bounds.size.z))
	var ratio = (minf(1.0, 0.46 / maxf(longest, 0.01)) if is_wyrm else 1.1 / maxf(longest, 0.01))
	model.scale *= ratio
	if not is_wyrm: model.position -= Vector3(bounds.get_center().x, bounds.position.y, bounds.get_center().z) * ratio
	weapon.position = scene.rack.global_position + Vector3((imported.size() % 4) * 0.38 - 0.5, 0.12, floorf(imported.size() / 4.0) * 0.45)
	weapon.reparent(adventure.zone_groups.get("forge_yard",self))
	weapon.set_meta("kind", "weapon")
	weapon.set_meta("id", item.id)
	weapon.set_meta("display_name", str(item.name) + (" v%d" % int(item.version) if int(item.get("version",1)) > 1 else ""))
	weapon.set_meta("description", item.description)
	weapon.set_meta("lineage_id",item.get("lineageId",item.id))
	weapon.set_meta("creation_version",item.get("version",1))
	weapon.set_meta("provenance",item.get("provenance",{}))
	weapon.set_meta("use_instructions",item.get("useInstructions","Grip to hold; trigger activates the invention."))
	weapon.set_meta("haptics",item.get("haptics",{}))
	siegebird.attach(weapon,model)
	if is_wyrm: wyrmspout.attach(weapon,model)
	if sunfall!=null: sunfall.attach(weapon,model)
	weapon.add_to_group("pickup")
	if is_wyrm: _collider(weapon, Vector3(0.17, 0.25, 0.43), Vector3(0, 0.06, -0.15))
	else: _collider(weapon, Vector3(0.3, 1.1, 0.3), Vector3(0, 0.55, 0))
	imported[item.id] = weapon
	pending.erase(item.id)
	await workshop_delivery.present(weapon,"invention:"+str(item.id))
	print("LIVE_IMPORT ", item.id, " bytes=", response[3].size())

func _bounds(node: Node, transform: Transform3D) -> AABB:
	var result = AABB()
	var current = transform
	if node is Node3D: current = transform * node.transform
	if node is MeshInstance3D: result = current * node.get_aabb()
	for child in node.get_children():
		var child_bounds = _bounds(child, current)
		if child_bounds.size != Vector3.ZERO:
			result = child_bounds if result.size == Vector3.ZERO else result.merge(child_bounds)
	return result

func _vec(vector: Vector3) -> Dictionary:
	return {"x":vector.x,"y":vector.y,"z":vector.z}

func _smoke_test():
	await get_tree().create_timer(2).timeout
	print("SMOKE scene rats=", scene.rats.size(), " desktop=", not vr)
	if scene.rats.size() < 1 or not online:
		get_tree().quit(2)
		return
	for index in range(5):
		var rat = scene.rats[index % scene.rats.size()]
		rat.set_meta("alive", true)
		rat.set_meta("id", "smoke-" + str(Time.get_unix_time_from_system()) + "-" + str(index))
		_kill_rat(rat)
		await get_tree().create_timer(0.2).timeout
		for tail in get_tree().get_nodes_in_group("pickup"):
			if tail.get_meta("kind", "") == "tail": await _collect_tail(tail)
	rig.position = Vector3(0, 0, -2.5)
	visiting = true
	await _send_context()
	var handin = await _request("/api/vr/handin", {})
	print("SMOKE handin=", JSON.stringify(handin))
	await _poll()
	await get_tree().create_timer(3).timeout
	print("SMOKE imported=", imported.size(), " favour=", state.get("favours", -1))
	var successful = int(state.get("favours", 0)) >= 1 and not handin.has("error") and imported.size() == 1
	if successful:
		var weapon = imported.values()[0]
		var deadline=elapsed+10.0
		while not weapon.get_meta("delivery_ready",true) and elapsed<deadline: await get_tree().process_frame
		desktop_hand.global_position=weapon.global_position
		_grip(desktop_hand, false)
		print("SMOKE equipped=", not held.is_empty())
		var rat = scene.rats[0]
		rat.set_meta("alive", true)
		rat.visible = true
		rat.position = Vector3(0, 0.2, 0)
		var result = await _request("/api/vr/ability", {"id":imported.keys()[0],"position":_vec(Vector3.ZERO),"forward":_vec(Vector3.FORWARD),"targets":_targets(Vector3.ZERO)})
		for action in result.get("actions", []): _apply_action(action)
		print("SMOKE generated_damage=", not rat.get_meta("alive", true))
		successful = successful and not held.is_empty() and not rat.get_meta("alive", true)
	get_tree().quit(0 if successful else 3)

func _adventure_smoke_test():
	adventure.test_mode=true
	await get_tree().create_timer(2).timeout
	var failures=[]
	if not online: failures.append("isolated service unavailable")
	if scene.get("zones",{}).size()<adventure.ZONES.size(): failures.append("expedition zones missing")
	for id in adventure.ZONES:
		adventure.travel(id)
		if adventure.zone!=id: failures.append("travel "+id)
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,-3)
	visiting=true
	await _send_context()
	await adventure.select_tool("woodland_axe",desktop_hand)
	if held.is_empty(): failures.append("starter axe did not equip")
	adventure.release(desktop_hand)
	if not held.is_empty(): failures.append("physical release failed")
	adventure.begin_bomb(desktop_hand)
	await get_tree().create_timer(0.7).timeout
	var key=str(desktop_hand.get_instance_id())
	if not adventure.ready_bombs.has(key) or not adventure.ready_bombs[key].get_meta("ready",false): failures.append("bomb formation")
	adventure.release(desktop_hand,true)
	if adventure.formation.has(key): failures.append("bomb release")
	for resource_id in ["lumber","stone"]:
		var found=false
		for resource in scene.get("resources",[]):
			if str(resource.get_meta("resource",resource.get_meta("resource_id","")))==resource_id:
				adventure.interact(resource,"woodland_axe" if resource_id=="lumber" else "quarry_pick")
				await get_tree().create_timer(0.4).timeout
				found=true
				break
		if not found: failures.append("missing "+resource_id)
	await _poll()
	if int(state.get("resources",{}).get("lumber",0))<3: failures.append("axe gathering")
	if int(state.get("resources",{}).get("stone",0))<3: failures.append("pick gathering")
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,-3)
	visiting=true
	await adventure.upgrade()
	if int(state.get("tier",1))<2: failures.append("tier2 handin")
	await adventure.select_tool("grappling_hook",desktop_hand)
	for anchor in scene.get("anchors",[]):
		adventure.interact(anchor,"grappling_hook")
		if rig.global_position.distance_to(anchor.get_meta("destination",Vector3.ZERO))>0.1: failures.append("grapple teleport")
		break
	for enemy in scene.get("enemies",[]):
		adventure.hurt_enemy(enemy,1000)
		if enemy.get_meta("alive",true): failures.append("enemy defeat")
		break
	adventure.travel("sandstone_quarry")
	var response=await _request("/api/vr/gather",{"id":"smoke-death-"+str(Time.get_unix_time_from_system()),"resource":"iron","amount":3})
	await _poll()
	await adventure.die()
	if state.get("drop")==null: failures.append("recoverable death drop")
	else:
		var drop=state.drop
		adventure.travel(str(drop.zone))
		rig.global_position=Vector3(drop.position.x,drop.position.y,drop.position.z)
		await adventure.recover()
		if state.get("drop")!=null: failures.append("cache recovery")
		if int(state.get("resources",{}).get("iron",0))<3: failures.append("resources restored")
	# Exercise ordinary combat damage and physically collect the spawned bone loot.
	for enemy in scene.get("enemies",[]):
		if str(enemy.get_meta("enemy_type",""))=="skeleton":
			adventure.explode(enemy.global_position,3.2,45)
			adventure.explode(enemy.global_position,3.2,45)
			break
	await _smoke_collect_resource_drops("haunted_bone")
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,-3)
	visiting=true
	await adventure.upgrade()
	if int(state.get("tier",1))!=3: failures.append("tier3 bone offering")
	await adventure.select_tool("crystal_resonator",desktop_hand)
	for wall in scene.get("barriers",[]):
		adventure.interact(wall,"crystal_resonator")
		if wall.visible: failures.append("resonator barrier")
		break
	adventure.travel("ember_foundry")
	for enemy in scene.get("enemies",[]):
		if str(enemy.get_meta("enemy_type",""))=="boss":
			adventure.explode(enemy.global_position,3.2,45)
			if not enemy.get_meta("alive",true): failures.append("boss dies to one basic bomb")
			for hit in range(10): adventure.explode(enemy.global_position,3.2,45)
			if enemy.get_meta("alive",true): failures.append("boss combat")
			break
	await _smoke_collect_resource_drops("ember_core")
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,-3)
	visiting=true
	await adventure.upgrade()
	if int(state.get("tier",1))!=4: failures.append("eternal forge core offering")
	await adventure.select_tool("ember_gauntlet",desktop_hand)
	# Bomb consequences use the actual explosion path, with spawn protection elapsed.
	shield_until=0
	hurts_until=0
	adventure.hp=100
	adventure.explode(camera.global_position,3.2,45)
	if adventure.hp>=100: failures.append("bomb self damage")
	# Death cache moves/merges across deaths while workshop and tools remain permanent.
	await _request("/api/vr/gather",{"id":"smoke-second-death-"+str(Time.get_unix_time_from_system()),"resource":"apple","amount":3})
	adventure.travel("pinewood_ruins")
	await adventure.die()
	var first_cache_position=adventure.cache.global_position if is_instance_valid(adventure.cache) else Vector3.ZERO
	await _request("/api/vr/gather",{"id":"smoke-third-death-"+str(Time.get_unix_time_from_system()),"resource":"spore","amount":3})
	adventure.travel("mushroom_glade")
	await adventure.die()
	if not is_instance_valid(adventure.cache) or adventure.cache.global_position.distance_to(first_cache_position)<10: failures.append("cache relocation")
	if int(state.get("tier",1))!=4: failures.append("permanent tier after death")
	if state.get("drop")!=null:
		var drop=state.drop
		adventure.travel(str(drop.zone))
		rig.global_position=Vector3(drop.position.x,drop.position.y,drop.position.z)
		await adventure.recover()
		if int(state.get("resources",{}).get("apple",0))<3 or int(state.get("resources",{}).get("spore",0))<3: failures.append("merged cache resources")
	# The late-loaded generated JS fixture also works far from the origin.
	if not imported.is_empty():
		adventure.travel("crystal_hollow")
		var center:Vector3=scene.zones.crystal_hollow.center
		for rat in scene.rats: rat.set_meta("alive",false)
		var rat=scene.rats[0]
		rat.global_position=center+Vector3(1,0.2,0)
		rat.set_meta("alive",true)
		var result=await _request("/api/vr/ability",{"id":imported.keys()[0],"position":_vec(center),"forward":_vec(Vector3.FORWARD),"targets":_targets(center)})
		for action in result.get("actions",[]): _apply_action(action)
		if rat.get_meta("alive",true): failures.append("generated remote zone damage")
	print("ADVENTURE_SMOKE ",JSON.stringify({"failures":failures,"tier":state.get("tier",1),"zones":scene.get("zones",{}).size(),"resources":state.get("resources",{})}))
	get_tree().quit(0 if failures.is_empty() else 4)

func _smoke_collect_resource_drops(resource_id:String):
	for pickup in get_tree().get_nodes_in_group("pickup"):
		if pickup.get_meta("kind","")=="resource" and pickup.get_meta("resource","")==resource_id:
			rig.global_position=pickup.global_position
			_grip(desktop_hand,true)
			# A held tool takes one release first; retry the normal pickup path.
			if pickup.visible: adventure.interact(pickup,"hand",desktop_hand)
			await get_tree().create_timer(0.35).timeout
	await _poll()

func _qol_smoke_test():
	adventure.test_mode=true
	await get_tree().create_timer(4).timeout
	var failures=[]
	if not online: failures.append("service unavailable")
	qol.toggle()
	if not qol.opened or qol.buttons.size()<12: failures.append("wrist menu")
	await get_tree().physics_frame
	var menu_ray=Node3D.new()
	add_child(menu_ray)
	menu_ray.global_position=camera.global_position
	for button in qol.buttons:
		if button.get_meta("action","")=="qol:page:comfort":
			menu_ray.look_at(button.global_position)
			break
	qol.menu_trigger(menu_ray)
	if qol.page!="comfort": failures.append("physical menu ray selection")
	menu_ray.queue_free()
	qol.action("dominant")
	if qol.settings.dominant!="left": failures.append("dominant hand")
	qol.action("turn")
	if qol.settings.turn!="smooth": failures.append("turn mode")
	qol.action("seated")
	qol.action("higher")
	if not qol.settings.seated or qol.tracking_space.position.y<=0: failures.append("seated tracking offset")
	var old_camera_height=camera.position.y
	camera.position.y=0.85
	qol.action("calibrate")
	if absf(camera.global_position.y-rig.global_position.y-tuning.value("player.eye_height"))>0.01: failures.append("eye height calibration")
	var calibrated_offset=qol.settings.height_offset
	qol.calibrate_height()
	if not is_equal_approx(calibrated_offset,qol.settings.height_offset): failures.append("height calibration accumulated")
	qol.action("seated")
	if absf(camera.global_position.y-rig.global_position.y-tuning.value("player.eye_height"))>0.01: failures.append("standing calibration discarded")
	camera.position.y=old_camera_height
	qol.action("arc")
	if not qol.settings.throw_arc: failures.append("throw arc setting")
	qol.settings.height_offset=0.0
	qol.settings.seated=false
	qol.apply_height()
	qol.action("page:tools")
	var before_dev_state=state.duplicate(true)
	state["tier"]=1
	var dev_state=state.duplicate(true)
	await qol.action("tool:crystal_resonator")
	var dev_tool=held.get(str(desktop_hand.get_instance_id()))
	if not is_instance_valid(dev_tool) or dev_tool.get_meta("id","")!="crystal_resonator" or not dev_tool.get_meta("dev_spawn",false): failures.append("dev crystal spawn at tier 1")
	if state!=dev_state: failures.append("dev spawn changed progression")
	adventure.release(desktop_hand)
	await adventure.select_tool("crystal_resonator",desktop_hand)
	if held.has(str(desktop_hand.get_instance_id())): failures.append("board bypassed tier after dev spawn")
	state=before_dev_state
	await qol.action("tool:woodland_axe")
	if not held.has(str(desktop_hand.get_instance_id())): failures.append("wrist equip")
	adventure.release(desktop_hand)
	await get_tree().process_frame
	var material_before=state.get("resources",{}).duplicate()
	var health_before=adventure.hp
	adventure.travel("pinewood_ruins")
	qol.recall_home()
	if adventure.zone!="forge_yard" or not adventure.thrown.is_empty(): failures.append("safe return")
	if adventure.hp!=health_before or state.get("resources",{})!=material_before: failures.append("recall preserves consequences")
	for target in scene.resources:
		if target.get_meta("requires","")=="axe":
			if not feedback.describe_target(target,"woodland_axe",1).compatible: failures.append("compatible gather hint")
			if feedback.describe_target(target,"quarry_pick",1).compatible: failures.append("wrong tool hint")
			break
	adventure.selected="bomb_glove"
	adventure.begin_bomb(desktop_hand)
	await get_tree().create_timer(0.7).timeout
	var bomb_key=str(desktop_hand.get_instance_id())
	if not feedback.formations.has(bomb_key) or not str(feedback.formations[bomb_key].label.text).begins_with("READY"): failures.append("ready bomb cue")
	adventure.release(desktop_hand,true)
	await get_tree().create_timer(0.05).timeout
	if feedback.flying.is_empty(): failures.append("armed bomb cue")
	qol.recall_home()
	await get_tree().physics_frame
	for button in qol.buttons:
		for child in button.get_children():
			if child is CollisionShape3D and not child.disabled: failures.append("closed menu blocks physics")
	for pickup in get_tree().get_nodes_in_group("pickup"):
		if pickup.get_meta("kind","")=="weapon" and not pickup in held.values():
			if pickup.has_meta("collection_id"):
				var home=collection.homes[pickup.get_meta("collection_id")]
				if pickup.global_position.distance_to(home.stand.global_position+Vector3.UP*0.98)>0.1: failures.append("collection recall")
			elif pickup.global_position.distance_to(scene.rack.global_position)>6: failures.append("tool recall")
	if imported.is_empty(): failures.append("generated item missing")
	else:
		var id=imported.keys()[0]
		qol.present(id)
		if imported[id].global_position.distance_to(camera.global_position)>1.2: failures.append("within reach handoff")
		qol.equip(id)
		if held.get(str(desktop_hand.get_instance_id()))!=imported[id]: failures.append("invention selection")
		if not collected.has(id): failures.append("handoff collected")
	# Real ray pickup respects an intervening wall and configurable reach.
	adventure.release(desktop_hand)
	adventure.thrown.clear()
	var pick=imported.values()[0] if not imported.is_empty() else scene.hammer
	pick.global_position=camera.global_position-camera.global_basis.z*2.0-Vector3.UP*0.45
	_set_collisions(pick,true)
	await get_tree().physics_frame
	qol.settings.reach=3.0
	if qol.distance_pick(desktop_hand)!=pick: failures.append("distance grab")
	qol.settings.reach=0.5
	if qol.distance_pick(desktop_hand)==pick: failures.append("reach bound")
	qol.settings.reach=3.0
	var obstruction=Node3D.new()
	add_child(obstruction)
	obstruction.global_position=camera.global_position-camera.global_basis.z
	_collider(obstruction,Vector3.ONE,Vector3.ZERO)
	await get_tree().physics_frame
	if qol.distance_pick(desktop_hand)==pick: failures.append("distance grab through wall")
	obstruction.queue_free()
	await _bomb_tuning_checks(failures)
	print("QOL_SMOKE ",JSON.stringify({"failures":failures,"settings":qol.settings,"buttons":qol.buttons.size()}))
	get_tree().quit(0 if failures.is_empty() else 5)

func _bomb_tuning_checks(failures:Array):
	await _poll()
	var original=tuning.values.duplicate()
	var sample_history=[{"t":elapsed-0.06,"v":Vector3(0,2,-4)}]
	var assisted:Vector3=tuning.estimate(sample_history,Vector3(0,0,-0.2))
	if assisted.z>-5.7: failures.append("late release motion retained")
	if tuning.estimate([],Vector3.ZERO)!=Vector3.ZERO: failures.append("stationary bomb must drop")
	if tuning.estimate([{"t":elapsed-1,"v":Vector3(0,0,-10)}],Vector3.ZERO)!=Vector3.ZERO: failures.append("expired motion ignored")
	if tuning.estimate([],Vector3(0,0,-100)).length()>18.01: failures.append("throw speed bounded")
	var before_revision=tuning.revision
	var response=await _request("/api/vr/tuning",{"values":{"bomb.formation_seconds":0.2,"bomb.fuse_seconds":5.0},"expectedRevision":before_revision})
	if response.has("error"): failures.append("live tuning write")
	await _poll()
	if tuning.value("bomb.formation_seconds")!=0.2: failures.append("live tuning poll")
	qol.cancel_forming()
	adventure.begin_bomb(desktop_hand)
	await get_tree().create_timer(0.27).timeout
	var key=str(desktop_hand.get_instance_id())
	if not adventure.ready_bombs.get(key).get_meta("ready",false): failures.append("tuned formation duration")
	adventure.release(desktop_hand,true)
	var body=get_tree().get_nodes_in_group("magic_bomb").back()
	var original_fuse=float(body.get_meta("fuse_at"))
	response=await _request("/api/vr/tuning",{"values":{"bomb.fuse_seconds":1.0},"expectedRevision":tuning.revision})
	await _poll()
	if float(body.get_meta("fuse_at"))!=original_fuse: failures.append("in-flight fuse mutated")
	qol.recall_home()
	qol.page="quick"
	qol.toggle()
	await get_tree().physics_frame
	var ray=Node3D.new()
	add_child(ray)
	ray.global_position=camera.global_position
	ray.look_at(tuning.slider_nodes["throw.gain"].body.global_position)
	tuning.slider_input(ray,true)
	if tuning.dragging!="throw.gain": failures.append("native slider ray")
	var chosen=tuning.draft_value
	tuning.slider_input(ray,false)
	await get_tree().create_timer(0.3).timeout
	if not is_equal_approx(tuning.value("throw.gain"),chosen): failures.append("native slider persistence")
	# An external change during dragging must reject the stale gesture.
	await get_tree().physics_frame
	ray.look_at(tuning.slider_nodes["throw.gain"].body.global_position)
	tuning.slider_input(ray,true)
	response=await _request("/api/vr/tuning",{"values":{"throw.gain":1.8},"expectedRevision":tuning.revision})
	await _poll()
	tuning.slider_input(ray,false)
	await get_tree().create_timer(0.3).timeout
	if not is_equal_approx(tuning.value("throw.gain"),1.8): failures.append("stale slider overwrote external tuning")
	ray.queue_free()
	qol.toggle()
	response=await _request("/api/vr/tuning",{"values":original,"expectedRevision":tuning.revision})
	await _poll()
	bomb_art.explosion(Vector3(0,1,-4),3.2,1,0.2,0)
	await get_tree().create_timer(0.5).timeout
	if not bomb_art.bursts.is_empty(): failures.append("explosion effects not cleaned up")
	await _controller_checks(failures)

func _controller_checks(failures:Array):
	if workshop==null or workshop.stage_groups.size()!=3: failures.append("living workshop stages missing")
	if enchantments==null or not is_instance_valid(enchantments.bench): failures.append("tinker bench missing")
	workshop.checks(failures)
	enchantments.checks(failures)
	zone_details.checks(failures)
	collection.checks(failures)
	await preload("res://siegebird_checks.gd").run(self,failures)
	await preload("res://item_action_checks.gd").run(self,failures)
	await preload("res://workshop_checks.gd").run(self,failures)
	if tuning.grip_state(0.55,false): failures.append("grip starts below press threshold")
	if not tuning.grip_state(0.7,false): failures.append("grip press missing")
	if not tuning.grip_state(0.55,true): failures.append("grip hysteresis")
	if tuning.grip_state(0.49,true): failures.append("early release threshold")
	if tuning.grip_state(0.3,false): failures.append("grip regrab while opening")
	var tracked=XRController3D.new()
	qol.tracking_space.add_child(tracked)
	var socket=hand_socket(tracked)
	if not (-socket.basis.z).is_equal_approx(Vector3.DOWN): failures.append("hand pitch alignment")
	tracked.tracker="left_hand"
	var left_basis=_hand_basis(tracked)
	tracked.tracker="right_hand"
	var right_basis=_hand_basis(tracked)
	if not left_basis.y.is_equal_approx(-right_basis.y): failures.append("hand palms not mirrored")
	if not left_basis.z.is_equal_approx(right_basis.z): failures.append("hand roll changed finger direction")
	workshop_delivery.working_pose(0)
	var hammer_face=scene.brann.get_meta("smith_hammer").to_global(workshop_delivery.HAMMER_FACE)
	if hammer_face.distance_to(workshop_delivery.CONTACT)>0.005: failures.append("smith hammer misses workpiece")
	for portal in scene.get("portals",[]):
		if portal.get_meta("zone","")!="forge_yard": continue
		var toward=(Vector3(0,portal.global_position.y,-4)-portal.global_position).normalized()
		if portal.global_basis.z.dot(toward)<0.99: failures.append("portal faces away from Brann")
	if workshop_delivery.impacts.size()!=8: failures.append("forge impact pool missing variants")
	var ledger=preload("res://progression_ui.gd")
	var sample_state={"tier":2,"resources":{"iron":1,"haunted_bone":2},"upgrades":[{"tier":3,"name":"The enchanted anvil","costs":[{"iron":3,"haunted_bone":3}]}]}
	var ledger_text=ledger.summary(sample_state)
	if not ledger_text.contains("iron 1/3 + haunted bone 2/3") or not ledger_text.contains("NEXT · The enchanted anvil"): failures.append("progression ledger lost live requirements")
	if not ledger.summary({"tier":4}).contains("All forge tiers unlocked"): failures.append("completed progression still asks for upgrades")
	var button_sample=Node3D.new()
	add_child(button_sample)
	button_sample.set_meta("action","upgrade")
	WorkshopScene.box(button_sample,Vector3.ZERO,Vector3(0.3,0.06,0.03),WorkshopScene.material("30585a"))
	if not button_feedback.press(button_sample,desktop_hand): failures.append("first UI press ignored")
	if button_feedback.press(button_sample,desktop_hand): failures.append("UI rapid duplicate not suppressed")
	var sample_entry=button_feedback.entries[button_sample.get_instance_id()]
	if sample_entry.until<=elapsed: failures.append("UI press feedback missing")
	button_sample.free()
	var palm_pose=Transform3D(Basis.IDENTITY,Vector3.ZERO)
	var fingers_right=Transform3D(Basis(Vector3.BACK,PI/2)*Basis(Vector3.RIGHT,-PI/2),Vector3.ZERO)
	if qol.palm_menu_transform(fingers_right).basis.y.normalized().dot(Vector3.UP)<0.99: failures.append("palm menu not upright with fingers right")
	var mount=qol.palm_menu_transform(palm_pose)
	if not (mount*Vector3(-0.40,0,0)).is_equal_approx(Vector3(0,-0.065,0.14)): failures.append("menu left edge not on palm anchor")
	if qol.allows_menu_button("right_hand") or not qol.allows_menu_button("left_hand"): failures.append("menu button not left only")
	var hand_data=XRHandTracker.new()
	hand_data.has_tracking_data=true
	for i in range(5):
		hand_data.set_hand_joint_flags(6+i,XRHandTracker.HAND_JOINT_FLAG_POSITION_VALID)
		hand_data.set_hand_joint_transform(6+i,Transform3D(Basis.IDENTITY,Vector3(0,0,-0.025*i)))
	var finger_art=preload("res://hand_animation.gd")
	var straight=finger_art.bends(hand_data,[6,7,8,9,10])
	if straight.size()!=3 or straight[1]>0.01: failures.append("straight finger flex incorrect")
	hand_data.set_hand_joint_transform(9,Transform3D(Basis.IDENTITY,Vector3(0,-0.025,-0.05)))
	var bent=finger_art.bends(hand_data,[6,7,8,9,10])
	if bent.size()!=3 or bent[1]<1.0: failures.append("independent finger bend lost")
	if not finger_art.bends(hand_data,[11,12,13,14,15]).is_empty(): failures.append("untracked finger accepted")
	hand_data.has_tracking_data=false
	if not finger_art.bends(hand_data,[6,7,8,9,10]).is_empty(): failures.append("tracking loss did not fall back")
	var moved=Transform3D(Basis(Vector3.FORWARD,0.6),Vector3(1,2,3))
	if not (moved.affine_inverse()*qol.palm_menu_transform(moved)).is_equal_approx(mount): failures.append("palm menu is not rigid")
	for side in ["left_hand","right_hand"]:
		tracked.tracker=side
		var sample=adventure._tool_model("apprentice_hammer")
		add_child(sample)
		grips._attach(tracked,sample)
		var expected=Vector3.RIGHT if side=="left_hand" else Vector3.LEFT
		if not sample.basis.y.is_equal_approx(expected): failures.append("tool not aligned across palm "+side)
		if not (sample.transform*Vector3(0,0.13,0)).is_equal_approx(Vector3(0,-0.045,-0.035)): failures.append("handle misses curled grip "+side)
		held.erase(str(tracked.get_instance_id()))
		grips.grips.erase(str(tracked.get_instance_id()))
		sample.queue_free()
		# The two Wyrmspout models have different authored forward axes. Keep
		# both hands locked to the controller ray as grip code evolves.
		for wyrm_id in [grips.WYRM_V1,grips.WYRM_V2]:
			var wyrm_sample=Node3D.new()
			wyrm_sample.set_meta("id",wyrm_id)
			add_child(wyrm_sample)
			grips._attach(tracked,wyrm_sample)
			var authored_forward=Vector3.UP if wyrm_id==grips.WYRM_V1 else Vector3.FORWARD
			if (wyrm_sample.global_basis*authored_forward).normalized().dot(-hand_socket(tracked).global_basis.z)<0.98:
				failures.append("Wyrmspout forward axis misses controller ray: "+side+" "+wyrm_id)
			if wyrm_id==grips.WYRM_V2:
				var expected_roll=Vector3.DOWN if side=="left_hand" else Vector3.UP
				if (wyrm_sample.basis*Vector3.RIGHT).dot(expected_roll)<0.98:
					failures.append("Wyrmspout roll correction changed: "+side)
			held.erase(str(tracked.get_instance_id()))
			grips.grips.erase(str(tracked.get_instance_id()))
			wyrm_sample.queue_free()
	var sample_pose=Transform3D(Basis(Vector3.FORWARD,0.21),Vector3(0.02,-0.03,-0.04))
	if not grips._array_to_pose(grips._pose_to_array(sample_pose)).is_equal_approx(sample_pose): failures.append("saved grip pose failed round-trip")
	tracked.queue_free()
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,1)
	var before=rig.position
	_walk_stick(Vector2(0,0.1),0.1)
	if rig.position!=before: failures.append("stick deadzone")
	_walk_stick(Vector2(0,1),0.1)
	if rig.position.z>=before.z-0.05: failures.append("left stick forward")
	if absf(rig.position.y-before.y)>0.03: failures.append("head pitch moves vertically")
	var block=Node3D.new()
	add_child(block)
	_collider(block,Vector3(2,2,0.2),rig.position+Vector3(0,1,-0.4))
	await get_tree().physics_frame
	before=rig.position
	_walk_stick(Vector2(0,1),0.1)
	if rig.position.distance_to(before)>0.01: failures.append("stick walked through wall")
	block.queue_free()
	print("CONTROLLER_CHECKS ",JSON.stringify({"failures":failures,"press":tuning.value("input.grip_press"),"release":tuning.value("input.grip_release")}))
	await _brann_checks(failures)

func _brann_checks(failures:Array):
	adventure.travel("forge_yard")
	rig.position=Vector3(0,0,-2)
	visiting=true
	await _send_context()
	var voice_before=int(state.get("voice",{}).get("revision",0))
	var saved_camera=camera.transform
	camera.look_at(scene.brann.global_position+Vector3.UP*1.6)
	await _trigger(desktop_hand,true)
	await _poll()
	if int(state.get("voice",{}).get("revision",0))<=voice_before: failures.append("Brann trigger did not start conversation")
	camera.transform=saved_camera
	var response=await _request("/test/delivery",{})
	if response.get("status","")!="pending": failures.append("voice tool did not queue")
	await _poll()
	var delivery_id=str(response.get("delivery",{}).get("id",""))
	var first=workshop_delivery.delivered.get(delivery_id)
	if not is_instance_valid(first) or first.get_meta("id","")!="woodland_axe" or not first.get_meta("delivery_ready",false): failures.append("voice axe not on bench")
	if is_instance_valid(first) and first in held.values(): failures.append("delivery stole hand")
	await _poll()
	if workshop_delivery.delivered.get(delivery_id)!=first: failures.append("delivery duplicated on polling")
	if state.get("lastDelivery",{}).get("status","")!="delivered": failures.append("native delivery not acknowledged")
	response=await _request("/api/vr/speech",{"level":0.8,"active":true})
	await _poll_speech()
	_speech_tick(0.1)
	if scene.brann.get_meta("speech_beard").position.y>=0: failures.append("speech beard did not animate")
	await _request("/api/vr/speech",{"level":0.0,"active":false})
	await _poll_speech()
	_speech_tick(0.1)
	if absf(scene.brann.get_meta("speech_beard").position.y)>0.001: failures.append("speech beard did not stop")
	await _presence_checks(failures)

func _presence_checks(failures):
	var before=camera.global_transform
	var old_elapsed=elapsed
	var old_visiting=visiting
	var old_zone=adventure.zone
	adventure.zone="forge_yard"
	visiting=false
	camera.global_position=scene.brann.global_position+Vector3(0,1.7,2)
	presence.proximity()
	if not visiting or presence.phase!="near": failures.append("presence approach")
	camera.global_position.z=scene.brann.global_position.z+3.5
	presence.proximity()
	if not visiting or presence.phase!="leaving": failures.append("departure grace missing")
	elapsed+=3
	presence.proximity()
	if not visiting: failures.append("departure ended too early")
	camera.global_position.z=scene.brann.global_position.z+2.5
	presence.proximity()
	if presence.phase!="near": failures.append("return did not cancel departure")
	camera.global_position.z=scene.brann.global_position.z+3.5
	presence.proximity()
	elapsed+=6.1
	presence.proximity()
	if visiting: failures.append("departure did not close")
	visiting=true
	camera.global_position.z=scene.brann.global_position.z+7
	presence.proximity()
	if visiting: failures.append("distant voice remains open")
	visiting=true
	camera.global_position=scene.brann.global_position+Vector3(20,4,1)
	presence.tick(1)
	if absf(scene.brann.get_meta("speech_head").rotation.y)>0.91: failures.append("head turn not bounded")
	if scene.brann.get_meta("presence_rune").scale.x>0.12: failures.append("presence clasp oversized")
	camera.global_transform=before
	elapsed=old_elapsed
	visiting=old_visiting
	adventure.zone=old_zone
	presence.leaving_since=-1
	print("PRESENCE_CHECKS ",JSON.stringify({"failures":failures}))
	await _request("/api/vr/speech",{"level":0.8,"active":true})
	await get_tree().create_timer(0.7).timeout
	await _poll_speech()
	if speech_target!=0: failures.append("stale speech did not expire")
	await _grip_checks(failures)
	await _contact_checks(failures)
	await _actor_checks(failures)

func _contact_checks(failures):
	var tool=adventure._tool_model("woodland_axe")
	add_child(tool)
	for surface in [scene.rack.global_position,Vector3(-0.35,1.21,-2.9)]:
		tool.global_position=surface+Vector3.UP*0.35
		tool.rotation=Vector3(0,0,PI/2)
		tool_physics.drop(tool,Vector3.ZERO,Vector3.ZERO)
		await get_tree().create_timer(1.0).timeout
		var body=tool.get_meta("drop_body")
		if body.global_position.y<surface.y-0.15: failures.append("tool fell through furniture")
		if body.collision_layer&1: failures.append("loose tool blocks movement layer")
		if _owner(body)!=tool: failures.append("physics tool pickup proxy")
		tool_physics.detach(tool)
	var tree=Node3D.new()
	add_child(tree)
	tree.position=Vector3(15,0,15)
	tree.set_meta("requires","axe")
	tree.set_meta("kind","resource")
	tree.set_meta("resource","lumber")
	WorldZones.tree(tree,Vector3.ZERO,4.7)
	if melee.chop(tree,tree.position+Vector3(0.3,1,0),Vector3.RIGHT): failures.append("tree felled on first hit")
	if melee.chop(tree,tree.position+Vector3(0.3,1.5,0),Vector3.RIGHT): failures.append("different height shared cut")
	if melee.chop(tree,tree.position+Vector3(0.3,1.05,0),Vector3.RIGHT): failures.append("tree felled on second matching hit")
	if not melee.chop(tree,tree.position+Vector3(0.3,1.08,0),Vector3.RIGHT): failures.append("third matching hit did not fell")
	await get_tree().create_timer(0.3).timeout
	var saved_held=held.duplicate()
	held={str(desktop_hand.get_instance_id()):tool}
	var wall=StaticBody3D.new()
	add_child(wall)
	wall.position=Vector3(0.43,6,10)
	var shape=CollisionShape3D.new()
	shape.shape=BoxShape3D.new()
	shape.shape.size=Vector3(1,1,0.1)
	wall.add_child(shape)
	tool.transform=Transform3D(Basis.IDENTITY,Vector3(0,5.4,10.4))
	await get_tree().physics_frame
	melee.tick(0.016)
	tool.position.z=9.8
	melee.tick(0.016)
	if tool.to_global(tool.get_meta("tip")).z<9.99: failures.append("held blade passed through solid")
	var track=melee.tracks.get(tool.get_instance_id(),{})
	if track.get("block",{}).is_empty(): failures.append("contact did not latch")
	tool.position.z+=0.8
	melee.tick(0.016)
	if not track.get("block",{}).is_empty(): failures.append("withdrawal did not release blade")
	held=saved_held
	melee.tracks.erase(tool.get_instance_id())
	wall.queue_free()
	var hp_before=adventure.hp
	adventure.hp=60
	melee.alternate(tool,desktop_hand)
	melee.alternate(tool,desktop_hand)
	if adventure.hp!=60 or not tool.get_meta("axe_power_armed",false): failures.append("axe alternate should arm a physical powered swing without healing")
	adventure.hp=hp_before
	tool.queue_free()
	tree.queue_free()
	print("CONTACT_CHECKS ",JSON.stringify({"failures":failures}))

func _actor_checks(failures):
	var data={"enemies":[]}
	preload("res://world_zones.gd").enemy(self,data,"forge_yard",Vector3(3,0,0),"skeleton")
	var actor=data.enemies[0]
	actor.set_meta("hp",60)
	actor.set_meta("home",actor.global_position)
	animation.register(actor)
	var actor_rig=animation.actors[actor.get_instance_id()]
	animation.pose(actor,"walk",0.25)
	if absf(actor_rig.joints.leg_l.rotation.x)<0.1: failures.append("walk clip did not articulate leg")
	animation.pose(actor,"idle",0.0)
	if absf(actor_rig.joints.leg_l.rotation.x)>0.01: failures.append("idle continues walking")
	animation.pose(actor,"attack",0.6)
	if actor_rig.joints.arm_r.rotation.x> -0.8: failures.append("attack lacks wind-up")
	var saved_time=elapsed
	var saved_health=adventure.hp
	var saved_hurts=hurts_until
	var saved_shield=shield_until
	hurts_until=0
	shield_until=0
	adventure._step_attack(actor,1,"skeleton")
	if actor.get_meta("combat_phase","")!="windup" or adventure.hp!=saved_health: failures.append("windup deals early damage")
	elapsed+=tuning.value("enemy.windup")+0.1
	adventure._step_attack(actor,1,"skeleton")
	if actor.get_meta("combat_phase","")!="strike" or not actor.get_meta("attack_damage_done",false): failures.append("strike and damage timeline disagree")
	var once_health=adventure.hp
	hurts_until=0
	adventure._step_attack(actor,1,"skeleton")
	if adventure.hp!=once_health: failures.append("strike damage repeats")
	elapsed=saved_time
	adventure.hp=saved_health
	hurts_until=saved_hurts
	shield_until=saved_shield
	var parts=actor_rig.pieces.duplicate()
	var poses=parts.map(func(p):return p.global_transform)
	var before=remains.bodies.size()
	actor.set_meta("combat_phase","windup")
	adventure.hurt_enemy(actor,1000,null,Vector3(0,0.5,0))
	var spawned=remains.bodies.slice(before)
	if spawned.size()!=parts.size(): failures.append("death lost visible pieces")
	for i in range(parts.size()):
		if not parts[i].get_parent() is RigidBody3D: failures.append("bone not physical")
		if not parts[i].global_transform.is_equal_approx(poses[i]): failures.append("death discontinuity")
	var count=remains.bodies.size()
	adventure.hurt_enemy(actor,1000)
	if remains.bodies.size()!=count: failures.append("death repeats debris")
	var old_hp=adventure.hp
	adventure._step_attack(actor,1,"skeleton")
	if adventure.hp!=old_hp: failures.append("dead actor attacks")
	if not spawned.is_empty():
		var bone=spawned[0]
		grips._attach(desktop_hand,bone)
		if not bone.freeze or held.get(str(desktop_hand.get_instance_id()))!=bone: failures.append("bone grab failed")
		bone.set_meta("born",elapsed-200)
		remains.tick()
		if bone.is_queued_for_deletion(): failures.append("held bone expired")
		adventure.release(desktop_hand,true)
		if bone.freeze: failures.append("bone release stayed frozen")
		bone.global_position=Vector3(3,1.5,0)
		bone.linear_velocity=Vector3.ZERO
		await get_tree().create_timer(1.25).timeout
		if bone.global_position.y< -0.2: failures.append("bone fell through floor")
		if not bone.get_meta("player_thrown",false): failures.append("released bone cannot impact")
		var victim=Node3D.new()
		add_child(victim)
		victim.set_meta("kind","enemy")
		victim.set_meta("hp",100)
		bone.linear_velocity=Vector3(4,0,0)
		bone.set_meta("damage_at",0)
		remains._impact(bone,victim)
		var hit_health=float(victim.get_meta("hp"))
		if hit_health>=100: failures.append("thrown bone deals no damage")
		remains._impact(bone,victim)
		if float(victim.get_meta("hp"))!=hit_health: failures.append("bone contact repeats damage")
		victim.queue_free()
	animation.restore(actor)
	if actor_rig.pieces.size()!=parts.size(): failures.append("respawn rig incomplete")
	if not spawned.is_empty() and not is_instance_valid(parts[0]): failures.append("respawn stole old bones")
	if not spawned.is_empty(): grips._attach(desktop_hand,spawned[0])
	for cycle in range(8):
		remains.shatter(actor)
		animation.restore(actor)
	if remains.bodies.size()>remains.MAX_BODIES: failures.append("unbounded debris")
	if not spawned.is_empty() and spawned[0].is_queued_for_deletion(): failures.append("debris cap evicted held bone")
	adventure.release(desktop_hand,true)
	for body in remains.bodies:
		if is_instance_valid(body) and body.get_meta("source_actor",0)==actor.get_instance_id(): body.queue_free()
	for home in actor_rig.homes:
		if home.has("template") and is_instance_valid(home.template): home.template.free()
	animation.actors.erase(actor.get_instance_id())
	actor.queue_free()
	print("ACTOR_CHECKS ",JSON.stringify({"failures":failures,"pieces":parts.size()}))

func _grip_checks(failures:Array):
	_bomb_safety_checks(failures)
	qol.recall_home()
	adventure.release(desktop_hand)
	var a=Node3D.new()
	var b=Node3D.new()
	add_child(a)
	add_child(b)
	a.position=Vector3(0,1.2,0)
	b.position=Vector3(0,1.6,0)
	var axe=adventure._tool_model("woodland_axe")
	add_child(axe)
	axe.global_position=a.global_position
	axe.reparent(a)
	var ka=str(a.get_instance_id())
	var kb=str(b.get_instance_id())
	held[ka]=axe
	grips.bind(a,axe)
	if not grips.try_grab(b): failures.append("second hand cannot grip axe handle")
	if held.get(ka)!=held.get(kb): failures.append("two-hand ownership mismatch")
	b.position=Vector3(0.3,1.5,0)
	grips.tick(0.016)
	if axe.global_basis.y.dot((b.position-a.position).normalized())<0.99: failures.append("two-hand axe alignment")
	var pose=axe.global_transform
	adventure.release(a)
	if not axe.global_transform.is_equal_approx(pose): failures.append("primary release snapped axe")
	if held.has(ka) or held.get(kb)!=axe: failures.append("primary handoff lost tool")
	if adventure.thrown.any(func(entry):return entry.node==axe): failures.append("two-hand release threw held axe")
	# Reposition the free hand on the handle, then release the other.
	a.global_position=axe.to_global(Vector3(0,0.08,0))
	if not grips.try_grab(a): failures.append("support hand cannot regrip")
	grips.tick(0.016)
	pose=axe.global_transform
	adventure.release(b)
	if not axe.global_transform.is_equal_approx(pose): failures.append("secondary release snapped axe")
	grips.adjust(a,true)
	pose=axe.global_transform
	a.rotation.y+=0.5
	if not axe.global_transform.is_equal_approx(pose): failures.append("loose grip follows wrist")
	a.global_position=axe.to_global(Vector3(0,0.2,0))
	grips.adjust(a,false)
	if not is_equal_approx(grips.grips[ka].point.y,0.2): failures.append("handle slide not retained")
	var preference=axe.transform
	# Gentle release at a hip stores; it survives travel and recall.
	grips._place_belt(1)
	a.global_position=grips.slots[0].root.global_position
	adventure.motion[ka]={"velocity":Vector3.ZERO}
	adventure.release(a)
	if not grips.is_stowed(axe) or held.has(ka): failures.append("hip storage failed")
	adventure.travel("pinewood_ruins")
	grips._place_belt(1)
	if not grips.is_stowed(axe): failures.append("travel lost holstered tool")
	qol.recall_home()
	grips._place_belt(1)
	if not grips.is_stowed(axe): failures.append("recall removed holstered tool")
	a.global_position=grips.slots[0].root.global_position
	if not grips.try_grab(a) or held.get(ka)!=axe: failures.append("holster draw failed")
	if not axe.transform.is_equal_approx(preference): failures.append("draw lost grip adjustment")
	# A fast release beside the belt must remain a throw.
	adventure.motion[ka]={"velocity":Vector3(0,0,-3)}
	adventure.release(a)
	if grips.is_stowed(axe) or not axe.has_meta("drop_body") or axe.get_meta("drop_body").linear_velocity.length()<1: failures.append("holster swallowed throw")
	tool_physics.detach(axe)
	axe.queue_free()
	a.queue_free()
	b.queue_free()
	print("GRIP_CHECKS ",JSON.stringify({"failures":failures}))

func _bomb_safety_checks(failures):
	var saved_enemies=scene.enemies
	var saved_zone=adventure.zone
	var saved_camera=camera.global_transform
	var skeleton=Node3D.new()
	add_child(skeleton)
	skeleton.set_meta("enemy_type","skeleton")
	scene.enemies=[skeleton]
	adventure.zone="pinewood_ruins"
	for direction in [Vector3.RIGHT,Vector3.LEFT,Vector3.BACK,Vector3.FORWARD]:
		camera.global_position=skeleton.global_position+direction*4+Vector3.UP*1.7
		adventure._enemies(0)
		if skeleton.global_basis.z.dot(direction)<0.99: failures.append("skeleton approaches backwards")
	scene.enemies=saved_enemies
	adventure.zone=saved_zone
	camera.global_transform=saved_camera
	skeleton.queue_free()
	var guard=preload("res://bomb_input.gd").new()
	if guard.tick("a",true,false,false,false,false,false,false,0): failures.append("grip alone made bomb")
	if guard.tick("a",true,true,false,false,false,false,false,2): failures.append("held grip made bomb")
	guard.tick("a",true,true,true,false,false,false,false,3)
	if not guard.tick("a",true,true,true,true,false,false,false,3.2): failures.append("deliberate bomb chord failed")
	if guard.tick("a",true,true,true,true,false,false,false,4): failures.append("bomb chord repeated")
	guard.tick("b",true,false,false,false,true,false,false,0)
	guard.tick("b",true,true,true,false,false,false,false,1)
	if guard.tick("b",true,true,true,true,false,false,false,2): failures.append("resource pickup became bomb")
	guard.tick("c",true,false,true,true,false,false,false,0)
	if guard.tick("c",true,true,true,true,false,false,false,2): failures.append("preheld trigger armed bomb")
	guard.tick("d",true,false,false,false,false,false,false,0)
	guard.tick("d",true,true,true,false,false,false,false,1)
	guard.tick("d",false,true,true,true,false,false,false,1.05)
	if guard.tick("d",true,false,true,true,false,false,false,2): failures.append("cancelled grip armed bomb")
	print("BOMB_SAFETY_CHECKS ",JSON.stringify({"failures":failures}))

func _siegebird_check():
	state=JSON.parse_string(FileAccess.get_file_as_string("res://workshop_fixture.json")); state.tier=4
	var failures=[]
	await preload("res://siegebird_checks.gd").run(self,failures)
	await preload("res://item_action_checks.gd").run(self,failures)
	await preload("res://workshop_checks.gd").run(self,failures)
	print("SIEGEBIRD_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 5)

func _workshop_check():
	state=JSON.parse_string(FileAccess.get_file_as_string("res://workshop_fixture.json")); state.tier=4; state.workshop.donations.tier=null
	workshop.sync_state(); enchantments.ingest(state.workshop)
	var failures=[]; workshop.checks(failures); enchantments.checks(failures)
	await preload("res://workshop_checks.gd").run(self,failures)
	print("WORKSHOP_ISOLATED_CHECK ",JSON.stringify(failures))
	await get_tree().process_frame
	get_tree().quit(0 if failures.is_empty() else 5)

func _start_playful_demo():
	await get_tree().physics_frame
	await get_tree().physics_frame
	living._demo_archive_sync()
	if OS.get_cmdline_user_args().has("--fairy-coop") and not vr:
		adventure.travel("forge_yard")
		camera.global_position=Vector3(4.5,1.7,4.5); camera.look_at(Vector3(4.5,1.05,3.5))
		for i in range(3):
			var match_item=firecraft._prop("match",Vector3(4.48+i*.10,.94,3.72))
			match_item.rotation.x=PI/2
		firecraft.target_open=1
		if fairy!=null:
			fairy.respawn(); fairy.note("Matches and bottles ahead! Back mouse / E lifts. Click opens a held box or strikes a match nearby.")
		return
	if OS.get_cmdline_user_args().has("--ember-gallery-demo"):
		ember_gallery.act("visit")
		desktop_hint_override="EMBER GALLERY · Offline · Tab > Travel for every activity\nWASD walk · right mouse look · E take / drop / throw · click trigger\nTake a torch. Pour, ignite and tame the fire. Progress saved separately."
		return
	if OS.get_cmdline_user_args().has("--atelier-demo"):
		desktop_hint_override="ATELIER · Offline four-item trial\nWASD walk · right mouse look · E take / drop · click alternate action"
		return
	playful_encounters.act("enter")
	desktop_hint_override="BELLWORKS · Offline demo · "+("Tab > Demo for save status" if demo_session!=null else "progress resets when closed")+"\nWASD walk · hold right mouse to look · E take / throw · left click power / recall\nTake Sunskipper from the left stand. Hit all three bells, then follow the board."
	_notice("Welcome to Bellworks. Take the Sunskipper and try the three bell trials.",10)

func _playful_context()->Dictionary:
	var context={"schema":1,"input":"vr" if vr else "desktop"}
	if playful_tools!=null: context["sunskipper"]={"state":playful_tools.state,"mode":playful_tools.mode,"reward":playful_tools.reward}
	if playful_encounters!=null:
		var progress=playful_encounters.progress_snapshot()
		progress.erase("schema"); progress.erase("revision"); context["bellworks"]=progress
	if cargo_playground!=null:
		var progress=cargo_playground.progress_snapshot()
		context["copperKite"]={"discovered":progress.discovered,"earned":progress.earned,"rounds":progress.rounds,"settled":[progress.settled[0]>=1,progress.settled[1]>=1,progress.settled[2]>=1],"canLaunch":progress.ready,"launched":progress.launched}
	return context
