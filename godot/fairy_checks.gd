extends SceneTree
var failures=[]
var count=0
var game
var fairy
var idle={"stick":Vector3.ZERO,"boost":false,"brake":false}
func check(ok,message):
	count+=1
	if not ok: failures.append(message); print("FAIRY_ASSERT ",message)
func _initialize(): run.call_deferred()
func key(code):
	var e=InputEventKey.new(); e.physical_keycode=code; e.pressed=true; fairy.input_event(e)
func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true
	game.adventure.travel("forge_yard")
	game._start_fairy(); fairy=game.fairy; fairy.test_mode=true; fairy.window.hide()
	await physics_frame; await physics_frame
	check(fairy.window.world_3d==game.get_world_3d(),"Fairy and VR host share the authoritative physics world")
	check(not fairy.window.use_xr and fairy.camera!=game.camera,"Desktop camera has no XR binding and never replaces the host camera")
	check(fairy.camera.get_viewport()==fairy.window and game.camera.get_viewport()!=fairy.window,"Cameras and UI belong to different viewports")
	check(fairy.camera.cull_mask & fairy.Art.BODY_LAYER==0,"First person hides own body only")
	key(KEY_V); check(fairy.third_person and fairy.camera.cull_mask & fairy.Art.BODY_LAYER!=0,"View toggle restores butterfly in third person")
	var pose=game.rig.transform; key(KEY_W); fairy.focused=true
	game._desktop_input(.1); check(game.rig.transform==pose,"Fairy keyboard never moves the host")
	var v=fairy.Flight.step(Vector3.ZERO,Basis.IDENTITY,Vector3.FORWARD,1.0,false,false,0,false,fairy.cfg)
	check(v.z< -4,"Hover moves responsively")
	var heavy=fairy.Flight.step(Vector3.ZERO,Basis.IDENTITY,Vector3.FORWARD,1.0,false,false,.6,false,fairy.cfg)
	check(heavy.length()<v.length()*.3,"Bone-sized load dramatically reduces available flight")
	check(fairy.Flight.step(Vector3.ZERO,Basis.IDENTITY,Vector3.FORWARD,1.0,true,true,1,false,fairy.cfg)==Vector3.ZERO,"Overweight cargo cannot be lifted")
	var coast=fairy.Flight.step(Vector3(8,0,0),Basis.IDENTITY,Vector3.ZERO,.1,true,true,0,false,fairy.cfg)
	check(coast.x>7,"Acro preserves momentum")
	key(KEY_C); fairy.turn(0,PI*1.2,.8); check(fairy.orientation.y.y<0,"Acro supports inverted flight and roll")
	fairy.orientation=Basis.IDENTITY; fairy.acro=false; fairy.keys.clear()
	# Actual collision at a high-speed sweep, isolated from existing scenery.
	var wall=StaticBody3D.new(); game.add_child(wall); wall.position=Vector3(0,9,-4)
	var shape=CollisionShape3D.new(); var box=BoxShape3D.new(); box.size=Vector3(10,10,.2); shape.shape=box; wall.add_child(shape)
	await physics_frame
	fairy.avatar.global_position=Vector3(0,9,0); fairy.avatar.velocity=Vector3(0,0,-18); fairy._move(.5)
	check(fairy.avatar.global_position.z> -3.95,"Body sweep does not tunnel through thin scenery")
	# Parent-local normal follows moving surfaces, unlike a HUD ping.
	fairy.leave_mark(Vector3(0,9,-3.9),Vector3.BACK,2,wall)
	var mark=fairy.marks.back().node
	check(mark.global_basis.y.dot(Vector3.BACK)>.99,"Light stem points perpendicular to wall")
	var old=mark.global_position; wall.position.x+=1
	check(absf(mark.global_position.x-old.x-1)<.001,"Marker remains attached to moving surface")
	for i in range(27): fairy.leave_mark(Vector3(i*.1,8,0),Vector3.UP,0)
	check(fairy.marks.size()==24,"Persistent marks have a bounded oldest-first budget")
	# Voluntary stable perch; no inherited roll, deliberate hard motion launches.
	fairy.avatar.global_position=Vector3(0,9,1); var hand=Node3D.new(); game.add_child(hand); hand.global_position=fairy.avatar.global_position
	game.elapsed+=1; fairy.attach(hand); hand.rotation.z=1.2; hand.position.x+=.002
	fairy._ride(.02,idle)
	check(fairy.perch==hand and absf(fairy.orientation.get_euler().z)<.01,"Gentle perch remains attached without rolling the camera")
	hand.position.x+=.15; fairy._ride(.02,idle)
	check(not is_instance_valid(fairy.perch) and fairy.avatar.velocity.x>2,"A deliberate hand movement launches fairy with momentum")
	var launch_speed=fairy.avatar.velocity.length()
	fairy.tick(.1,idle)
	check(fairy.avatar.velocity.length()>launch_speed*.75,"Thrown fairy keeps most momentum after detaching")
	game.elapsed+=1; fairy.attach(hand); hand.position.x+=.04; fairy._ride(.02,idle)
	check(fairy.perch==null and fairy.avatar.velocity.x>4,"A modest flick releases the fairy with useful travel speed")
	game.elapsed+=1; fairy.bond.update_shoulder(); fairy.avatar.global_position=fairy.bond.shoulder.global_position
	fairy.perch_or_leave()
	check(fairy.perch==fairy.bond.shoulder,"Fairy can perch directly on the host shoulder")
	fairy.detach(Vector3.ZERO)
	game.elapsed+=1; key(KEY_F3); fairy.avatar.global_position=fairy.practice_hand.global_position+Vector3.UP*.12; key(KEY_F)
	check(fairy.perch==fairy.practice_hand,"Actual fairy controls offer and perch on a visible practice hand")
	key(KEY_F4); fairy.keys.clear(); fairy.test_mode=false; fairy._physics_process(.02); fairy.test_mode=true
	check(not is_instance_valid(fairy.perch) and fairy.avatar.velocity.length()>1,"Practice toss follows the real hand-motion dislodge route")
	var ring=game.playful_tools; game.elapsed+=1; fairy.avatar.global_position=Vector3(0,9,1); ring.ring.global_position=fairy.avatar.global_position; ring.state="flying"
	fairy.attach(ring.ring); ring.ring.position.x+=.3; fairy._ride(.02,idle)
	check(fairy.perch==ring.ring and fairy.avatar.global_position.distance_to(ring.ring.global_position+Vector3.UP*.12)<.01,"Visible fairy stays on fast-moving Sunskipper rather than trailing behind it")
	fairy.detach(Vector3.ZERO); ring._home()
	# Authoritative ownership and a real rigid object, not an inventory copy.
	var bone=RigidBody3D.new(); game.add_child(bone); bone.mass=.6; bone.add_to_group("pickup"); bone.set_meta("kind","weapon"); bone.global_position=Vector3(0,9,1)
	check(fairy.pick_up(bone),"Loose skeleton-style rigid body can be carried")
	check(bone in game.held.values() and bone.freeze,"Carrying reserves the actual object against simultaneous host pickup")
	fairy.avatar.global_position=Vector3(0,9,1); game.desktop_hand.global_position=bone.global_position; fairy.offer_to(game.desktop_hand)
	check(fairy.carry==null and bone not in game.held.values() and not bone.freeze,"Host handoff relinquishes ownership and restores physical body")
	# Match uses the existing strike/burn/expiry system and heats the shared fuel field.
	var match_item=game.firecraft._prop("match",fairy.avatar.global_position)
	check(fairy.pick_up(match_item),"Fairy can carry a real firecraft match")
	game.firecraft._light(match_item)
	check(game.firecraft._burning(match_item),"Held match burns with the original ten-second lifetime")
	fairy.drop(); check(match_item.has_meta("body") and match_item not in game.held.values(),"Match release goes through native firecraft physics")
	# Enemies: crits are small, ghost immunity is preserved, taunts are temporary.
	var enemy=game.scene.enemies.filter(func(e):return e.get_meta("enemy_type","")=="skeleton")[0]
	var hp=float(enemy.get_meta("hp")); fairy.dart_hit({"collider":enemy,"position":fairy.head_position(enemy)})
	check(is_equal_approx(float(enemy.get_meta("hp")),hp-fairy.cfg.critical_damage),"Precise head dart deals configured critical damage")
	var ghost=game.firecraft.ghosts[0]; var ghost_hp=ghost.get_meta("hp",0)
	fairy.dart_hit({"collider":ghost,"position":ghost.global_position})
	check(ghost.get_meta("hp",0)==ghost_hp and ghost.get_meta("alive"),"Fairy magic cannot kill fire-only ghosts")
	# A dart travels through the actual existing skeleton collider, including the
	# coarse collider front offset that otherwise makes head crits impossible.
	enemy.reparent(game); enemy.show(); enemy.global_position=Vector3(5,9,-2)
	fairy.avatar.global_position=fairy.head_position(enemy)+Vector3(0,0,3); fairy.orientation=Basis.IDENTITY; fairy.avatar.velocity=Vector3.ZERO
	await physics_frame
	game.elapsed+=1; hp=enemy.get_meta("hp"); fairy.shoot(false)
	for i in range(25): fairy._tick_spells(.01)
	check(is_equal_approx(float(enemy.get_meta("hp")),hp-fairy.cfg.critical_damage),"Real swept dart can critically hit an animated head through coarse collision bounds")
	var mark_count=fairy.marks.size(); fairy.avatar.global_position=Vector3(0,9,0); fairy.shoot(true)
	for i in range(70): fairy._tick_spells(.01)
	check(fairy.shots.is_empty() and fairy.marks.size()==24,"Arcing dust projectile sticks to a physical wall under the shared cap")
	check(fairy.marks.back().node.get_parent()==wall,"Projectile-created dust mark belongs to struck surface")
	var pad_event=InputEventJoypadButton.new(); pad_event.device=0; pad_event.button_index=JOY_BUTTON_B; pad_event.pressed=true
	var old_view=fairy.third_person; fairy.window.window_input.emit(pad_event)
	check(fairy.third_person!=old_view and game.rig.transform==pose,"Second-window controller input toggles fairy view without moving the host")
	# A directly overhead fairy must not make the ghost look_at basis degenerate.
	ghost.reparent(game); ghost.show(); ghost.global_position=Vector3(20,8,0); ghost.set_meta("fairy_aggro_until",game.elapsed+5)
	fairy.avatar.global_position=Vector3(20,10,0); game.firecraft._tick_ghosts(.016,[])
	check(ghost.global_basis.is_finite() and ghost.global_position.y>8,"Ghost can pursue an overhead fairy without invalid orientation")
	game.elapsed+=1; fairy.avatar.global_position=game.camera.global_position+Vector3(5,0,0); fairy.avatar.velocity=Vector3(8,0,0)
	game.qol.action("fairy_call")
	check(fairy.recall,"Host wrist-menu action forces recall")
	var v0=fairy.avatar.velocity; fairy.tick(.016,{"stick":Vector3.RIGHT,"boost":true,"brake":false})
	check(fairy.avatar.velocity.x>0 and fairy.avatar.velocity.x<v0.x,"Recall decelerates rather than snapping; steering cannot override it")
	game.elapsed+=9; fairy.tick(.016,idle)
	check(not fairy.recall and fairy.avatar.global_position.distance_to(fairy.pocket())<.1,"Blocked recall has a bounded pocket rescue")
	fairy.invulnerable_until=0; fairy.hurt(100,"fixture")
	check(fairy.health==0 and not fairy.avatar.visible,"Fragile fairy scatters on death")
	game.elapsed+=3.1; fairy.tick(.016,idle)
	check(fairy.health==18 and fairy.avatar.visible and fairy.avatar.global_position.distance_to(fairy.pocket())<.1,"Death returns to host pocket after three seconds")
	fairy.pick_up(bone); game.adventure.travel("pinewood_ruins"); fairy.tick(.016,idle)
	check(fairy.last_zone=="pinewood_ruins" and fairy.avatar.global_position.distance_to(game.camera.global_position)<2,"Host zone travel brings companion into same visible region")
	check(fairy.marks.all(func(m):return not is_instance_valid(m.node) or not m.node.visible),"Old-zone dust marks stay hidden")
	check(bone.get_parent()==game.adventure.zone_groups.forge_yard and bone.get_meta("zone")=="forge_yard" and bone.freeze,"Cross-zone transition leaves cargo frozen in its original region")
	# Heat from the carried match reaches actual unlit oil, without fabricating fuel.
	game.ember_gallery.act("visit"); fairy.tick(.016,idle); await physics_frame
	var fluid=game.firecraft.fluid; var entry=fluid.fields["ember_gallery"]
	while not entry.ready: fluid.scan(entry)
	var spot=game.ember_gallery.CENTER+Vector3(-4,.06,0)
	check(fluid.pour(spot,"ember_gallery",2,false)>0,"Real surface accepts unlit oil for the cooperative match test")
	fluid.tick(.1)
	var fresh=game.firecraft._prop("match",spot); fairy.pick_up(fresh); game.firecraft._light(fresh)
	fairy.orientation=Basis.IDENTITY; fairy.avatar.global_position=spot+Vector3(0,.04,.07); fairy.last_zone="ember_gallery"; fairy.last_host=game.camera.global_position
	fairy.tick(.016,idle); fluid.tick(.1)
	check(entry.field.active_counts().flames>0 if entry.field.has_method("active_counts") else fluid.active_counts().flames>0,"Fairy-carried burning match ignites the actual shared oil")
	fairy.drop()
	game.adventure.travel("forge_yard"); fairy.tick(.016,idle)
	var supply_box=game.firecraft.box
	fairy.avatar.global_position=supply_box.global_position+Vector3(0,.15,.2)
	check(fairy.pick_up(supply_box),"Fairy can carry the real matchbox")
	var was_open=game.firecraft.target_open; fairy.use_supply()
	check(game.firecraft.target_open!=was_open,"Primary action opens or closes held matchbox")
	fairy.drop()
	if supply_box.has_meta("body"): supply_box.get_meta("body").freeze=true
	game.firecraft.opening=1; game.firecraft.target_open=1
	fairy.avatar.global_position=game.firecraft.tray.global_position+Vector3.UP*.1
	fairy.grab_or_drop()
	check(is_instance_valid(fairy.carry) and fairy.carry.get_meta("fire_kind","")=="match","Open drawer supplies an actual carryable match")
	var striking_match=fairy.carry
	fairy.avatar.global_position=supply_box.global_position+Vector3(.28,.08,.12)
	fairy.carrier.global_position=fairy.avatar.global_position
	fairy.use_supply()
	for i in range(50):
		game.elapsed+=.02; fairy.handheld.tick(.02); game.firecraft.tick(.02)
	check(striking_match.get_meta("state")=="lit","Assisted match stroke lights through real striker contact")
	fairy.drop()
	# Primary input is owned by every held item, including non-firecraft pickups.
	var no_shots=fairy.shots.size(); fairy.pick_up(bone); fairy.shoot(false)
	check(fairy.shots.size()==no_shots and fairy.handheld.item==bone,"Held bone swings instead of emitting a dart")
	fairy.drop(); check(not is_instance_valid(fairy.handheld.item),"Dropping cancels ongoing manipulation")
	var vial=game.firecraft._prop("vial",fairy.avatar.global_position); fairy.pick_up(vial); fairy.shoot(false)
	check(fairy.shots.size()==no_shots,"Held vial never fires a fairy dart")
	fairy.drop()
	var blocked_match=game.firecraft._prop("match",fairy.avatar.global_position); fairy.pick_up(blocked_match)
	var barrier=StaticBody3D.new(); game.add_child(barrier); barrier.global_position=supply_box.to_global(Vector3(.16,.05,-.075))
	var barrier_shape=CollisionShape3D.new(); var barrier_box=BoxShape3D.new(); barrier_box.size=Vector3(.025,.35,.35); barrier_shape.shape=barrier_box; barrier.add_child(barrier_shape)
	await physics_frame; await physics_frame
	fairy.use_supply()
	for i in range(50): game.elapsed+=.02; fairy.handheld.tick(.02); game.firecraft.tick(.02)
	check(blocked_match.get_meta("state")=="fresh","Solid obstruction prevents assisted strike and ignition")
	fairy.drop(); barrier.queue_free(); await physics_frame; await physics_frame
	var moving_match=game.firecraft._prop("match",fairy.avatar.global_position); fairy.pick_up(moving_match); fairy.use_supply()
	var box_position=supply_box.global_position; supply_box.global_position+=Vector3.RIGHT*.2; fairy.handheld.tick(.02)
	check(not is_instance_valid(fairy.handheld.item) and moving_match.get_meta("state")=="fresh","Moving matchbox away cancels contact rather than igniting remotely")
	supply_box.global_position=box_position; fairy.drop()
	fairy.avatar.global_position=Vector3(20,9,20); bone.global_position=Vector3(20,9,20.2); fairy.handheld.cue_clock=0; fairy.handheld.tick(.1)
	check(fairy.handheld.cue.visible and fairy.nearest_pickup()==bone,"Reachable object displays a subtle pickup cue")
	fairy.pick_up(bone); fairy.handheld.cue_clock=0; fairy.handheld.tick(.1)
	check(not fairy.handheld.cue.visible,"Pickup cue disappears when carrying")
	fairy.drop()
	var rapid=fairy.Flight.step(Vector3.ZERO,Basis.IDENTITY,Vector3.FORWARD,.1,false,false,0,false,fairy.cfg)
	var settled=fairy.Flight.step(Vector3(0,0,-5),Basis.IDENTITY,Vector3.ZERO,.15,false,false,0,false,fairy.cfg)
	check(rapid.length()>2.5 and settled.length()<.01,"Hover accelerates quickly and stops within 150ms")
	fairy._capture_mouse(); var shot_count=fairy.shots.size(); fairy.next_ping=0
	var mouse=InputEventMouseButton.new(); mouse.pressed=true; mouse.button_index=MOUSE_BUTTON_RIGHT; fairy.input_event(mouse)
	check(fairy.shots.size()==shot_count+1 and fairy.shots.back().ping,"Right mouse casts a dust ping without holding to look")
	mouse.button_index=MOUSE_BUTTON_MIDDLE; fairy.next_reveal=0; fairy.input_event(mouse)
	check(fairy.next_reveal>game.elapsed,"Middle mouse invokes reveal")
	fairy.pick_up(striking_match); mouse.button_index=MOUSE_BUTTON_XBUTTON1; fairy.input_event(mouse)
	check(not is_instance_valid(fairy.carry),"Back mouse releases cargo")
	key(KEY_ESCAPE); shot_count=fairy.shots.size(); mouse.button_index=MOUSE_BUTTON_LEFT; fairy.input_event(mouse)
	check(fairy.mouse_look and fairy.shots.size()==shot_count,"Click after Escape recaptures look without shooting")
	fairy.third_person=false; fairy.orientation=Basis.IDENTITY; fairy._capture_mouse()
	var motion=InputEventMouseMotion.new(); motion.relative=Vector2(900,0); motion.screen_relative=Vector2(10,0)
	fairy.input_event(motion)
	check(absf(fairy.orientation.get_euler().y+10*fairy.cfg.look_sensitivity*fairy.sensitivity_scale)<.00001,"Mouse uses unscaled screen displacement, not viewport-scaled displacement")
	check(fairy.camera.global_basis.is_equal_approx(fairy.orientation),"Camera rotation updates in input handler before any physics tick")
	fairy.orientation=Basis.IDENTITY
	for i in range(10): fairy.input_event(motion)
	var many_events=fairy.orientation; fairy.orientation=Basis.IDENTITY; motion.screen_relative=Vector2(100,0); fairy.input_event(motion)
	check(fairy.orientation.is_equal_approx(many_events),"Equivalent mouse counts produce equal turn across event rates")
	check(not Input.use_accumulated_input,"Captured mouse receives unaccumulated motion events")
	var before_sensitivity=fairy.sensitivity_scale; key(KEY_BRACKETLEFT)
	check(fairy.sensitivity_scale<before_sensitivity,"Sensitivity can be lowered without leaving play")
	var last_orientation=fairy.orientation; fairy._focus_lost(); fairy.input_event(motion)
	check(fairy.orientation==last_orientation and not fairy.owns_input_policy,"Unfocused motion is ignored and global input policy relinquished")
	if OS.get_cmdline_user_args().has("--window-check") and DisplayServer.get_name()!="headless":
		fairy.window.show()
		for display in ["left","right","maximized","fullscreen","windowed"]:
			fairy.set_display_mode(display)
			for frame in range(8): await process_frame
			check(fairy.display_mode==display and fairy.window.size.x>=720,"Native window transition "+display)
		fairy.window.hide(); fairy._focus_lost()
	key(KEY_W); fairy._focus_lost(); check(fairy.keys.is_empty() and not fairy.mouse_look,"Focus loss clears movement and mouse capture")
	fairy.clear_marks(); fairy.leave_mark(Vector3(0,8,0),Vector3.UP,0)
	game.elapsed+=7.9; fairy.tick(.01,idle); check(fairy.marks.size()==1,"Ping remains until its eight-second expiry")
	game.elapsed+=.2; fairy.tick(.01,idle); check(fairy.marks.is_empty(),"Ping expires after eight seconds")
	fairy.leave_mark(Vector3(0,8,0),Vector3.UP,0); fairy.clear_marks(); check(fairy.marks.is_empty(),"Clear-all removes every marker")
	fairy.offer_practice_hand(); check(fairy.practice_hand.visible,"Solo rehearsal offers a visible hand")
	fairy.perch=fairy.practice_hand; key(KEY_F4); check(fairy.perch==null and fairy.avatar.velocity.length()>8,"Practice fling launches immediately without multiplayer")
	var test_vial=Node3D.new(); game.add_child(test_vial); test_vial.position=Vector3(400,100,400); test_vial.set_meta("fire_kind","vial"); test_vial.set_meta("state","fresh"); game.firecraft.props.append(test_vial)
	fairy.drop(); var heat_match=game.firecraft._prop("match",fairy.avatar.global_position); fairy.pick_up(heat_match); heat_match.set_meta("state","lit"); heat_match.set_meta("until",game.elapsed+10)
	fairy.handheld.item=heat_match
	var wick=game.firecraft._tip(test_vial)
	fairy.handheld.heat_sweep(wick-Vector3.RIGHT*.25,wick+Vector3.RIGHT*.25)
	check(test_vial.get_meta("state")=="lit","Swept match contact lights a wick between frames")
	test_vial.set_meta("state","fresh")
	var heat_barrier=StaticBody3D.new(); game.add_child(heat_barrier); heat_barrier.position=wick-Vector3.RIGHT*.1
	var heat_blocker=CollisionShape3D.new(); var block_shape=BoxShape3D.new(); block_shape.size=Vector3(.03,1,1); heat_blocker.shape=block_shape; heat_barrier.add_child(heat_blocker)
	await physics_frame; await physics_frame
	fairy.handheld.heat_sweep(wick-Vector3.RIGHT*.25,wick+Vector3.RIGHT*.25)
	check(test_vial.get_meta("state")=="fresh","Swept ignition cannot pass through a wall")
	fairy.handheld.item=null; game.firecraft.props.erase(test_vial); test_vial.queue_free(); heat_barrier.queue_free()
	fairy.stop(); check(not fairy.active and game.is_inside_tree(),"Closing fairy window leaves host running")
	check(not fairy.art.dust.visible and fairy.reveals.is_empty(),"Closing companion stops particles and clears transient reveals")
	wall.queue_free(); bone.queue_free(); hand.queue_free()
	await process_frame
	print("FAIRY_CHECK_RESULT ",JSON.stringify({"checks":count,"failures":failures}))
	quit(0 if failures.is_empty() else 1)

