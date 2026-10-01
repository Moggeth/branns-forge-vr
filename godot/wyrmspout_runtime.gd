extends Node
## Wyrmspout's deliberately bounded, fully local continuous-fire interaction.
## All values live here so subsequent playtesting can tune them without altering
## the generated model or the general item/ability pipeline.
const ITEM_ID = "55b0c0ee-2622-4207-a3ca-fa006701d47c"
const LINEAGE_ID = "f040e7a4-8c6b-42a5-af56-a74cd4936a47"
const RANGE = 5.6
const FULL_HEAT_SECONDS = 8.0
const COOL_RATE = 0.18
const OVERHEAT_SECONDS = 3.0
const PATCH_SECONDS = 12.0
const MAX_PATCHES = 32
const PATCH_INTERVAL = 0.19
const PATCH_SPACING = 0.34
const STREAM_SPEED = 10.5
const STREAM_GRAVITY = 5.2
const STREAM_LIFETIME = 0.62
const STREAM_RATE = 36.0
const GROUND_FUEL = 0.035
const STREAM_LIGHT_COUNT = 5
var game
var records: Dictionary = {}
var patches: Array = []
var active_hand: Node3D
var active_item: Node3D
var next_patch = 0.0
var next_ground_patch = 0.0
var next_haptic = 0.0
var next_patch_damage = 0.0
var next_player_hurt = 0.0
var next_notice = 0.0
var damage_at: Dictionary = {}
var diagnostic_force_trigger = false
var flame_material: ShaderMaterial
var patch_material: ShaderMaterial
var flame_mesh: ArrayMesh
var flame_sound: AudioStream

func setup(g):
	game = g
	# Same faceted, animated flame language as the bottle-fed liquid fire.
	# A separate hotter shader palette gives the dragon breath its own character.
	flame_mesh = _make_flame_mesh()
	flame_material = flame_mesh.surface_get_material(0)
	patch_material = flame_material.duplicate()
	var wav_bytes = FileAccess.get_file_as_bytes("res://assets/wyrmspout-flame.wav")
	if wav_bytes.size() > 44 and wav_bytes.slice(0, 4).get_string_from_ascii() == "RIFF":
		var wav = AudioStreamWAV.new()
		wav.format = AudioStreamWAV.FORMAT_16_BITS
		wav.mix_rate = 22050
		wav.data = wav_bytes.slice(44)
		wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
		wav.loop_end = int(wav.data.size() / 2)
		flame_sound = wav
	print("WYRM SPOUT ready: continuous flame, heat, 3s overheat, persistent surface fire")

func is_wyrmspout(item: Node) -> bool:
	return is_instance_valid(item) and str(item.get_meta("id", "")) == ITEM_ID

func attach(weapon: Node3D, model: Node3D):
	if not is_wyrmspout(weapon): return
	var muzzle = _find(model, "Muzzle")
	if muzzle == null:
		muzzle = Node3D.new(); muzzle.name = "MuzzleFallback"; model.add_child(muzzle)
		muzzle.position = Vector3(0, 0.08, -0.36)
	var jets: Array = []
	for i in range(28):
		var jet = MeshInstance3D.new()
		jet.name = "DragonBreath%02d" % i
		jet.mesh = flame_mesh
		game.add_child(jet)
		jet.visible = false
		jets.append(jet)
	var light = OmniLight3D.new()
	light.name = "WyrmspoutFirelight"
	muzzle.add_child(light)
	light.light_color = Color("ff8c3a")
	light.light_energy = 0.0
	light.omni_range = 3.2
	light.shadow_enabled = false
	var audio = AudioStreamPlayer3D.new()
	audio.name = "WyrmspoutBreath"
	muzzle.add_child(audio)
	audio.stream = flame_sound
	audio.max_distance = 24
	audio.volume_db = -9
	var heat_nodes: Array = []
	for marker in ["HeatTooth", "HeatSpine", "EmberCore"]:
		_gather_heat(model, marker, heat_nodes)
	var eyes: Array = []
	for marker in ["EyeLeft", "EyeRight"]:
		var eye = _find(model, marker)
		if eye != null: eyes.append({"node": eye, "basis": eye.basis})
	var stream_lights: Array = []
	for i in STREAM_LIGHT_COUNT:
		var moving_light := OmniLight3D.new()
		moving_light.name = "MovingFlameLight%d" % i
		game.add_child(moving_light)
		moving_light.light_color = Color("ff8134")
		moving_light.light_energy = 0.0
		moving_light.omni_range = 2.65
		moving_light.shadow_enabled = false
		stream_lights.append(moving_light)
	records[weapon.get_instance_id()] = {"weapon":weapon,"muzzle":muzzle,"jets":jets,"drops":[],"spawn_debt":0.0,"next_damage":0.0,"light":light,"stream_lights":stream_lights,"audio":audio,"heat":0.0,"locked_until":0.0,"heat_nodes":heat_nodes,"eyes":eyes,"firing":false}
	weapon.set_meta("use_instructions", "Hold trigger: dragon fire · release to cool · 3s lockout on overheat · right B or desktop RMB: vent heat")
	weapon.set_meta("ranged", true)
	weapon.set_meta("grip_min", 0.0)
	weapon.set_meta("grip_max", 0.12)
	print("WYRM SPOUT attached: heat surfaces=",heat_nodes.size()," eyes=",eyes.size())

func _find(root: Node, fragment: String) -> Node3D:
	if root is Node3D and root.name.contains(fragment): return root
	for child in root.get_children():
		var found = _find(child, fragment)
		if found != null: return found
	return null

func _gather_heat(root: Node, fragment: String, result: Array):
	if root is MeshInstance3D and root.name.contains(fragment):
		var mesh_instance: MeshInstance3D = root
		for surface in range(mesh_instance.mesh.get_surface_count()):
			var material = mesh_instance.get_active_material(surface)
			if material is StandardMaterial3D:
				var animated: StandardMaterial3D = material.duplicate()
				animated.emission_enabled = true
				animated.emission = Color("ff2707")
				animated.emission_energy_multiplier = 0.0
				mesh_instance.set_surface_override_material(surface, animated)
				result.append(animated)
	for child in root.get_children(): _gather_heat(child, fragment, result)

func start(hand: Node3D) -> bool:
	var item = game.held.get(str(hand.get_instance_id()))
	if not is_wyrmspout(item): return false
	var record = records.get(item.get_instance_id())
	if record == null: return true
	if game.elapsed < record.locked_until:
		if game.elapsed > next_notice:
			next_notice = game.elapsed + 1.0
			game._notice("Wyrmspout is cooling · %.1fs" % (record.locked_until - game.elapsed), 2)
		return true
	active_hand = hand
	active_item = item
	return true

func vent(item: Node3D) -> bool:
	if not is_wyrmspout(item): return false
	var record = records.get(item.get_instance_id())
	if record == null: return true
	if record.firing: return true
	record.heat = maxf(0.0, record.heat - 0.27)
	game._effect(record.muzzle.global_position, Color("ff9c4d"), 0.22, 0.15)
	game._notice("Wyrmspout vented · %d%% heat" % roundi(record.heat * 100), 3)
	return true

func tick(delta: float):
	for id in records.keys():
		var record = records[id]
		if not is_instance_valid(record.weapon):
			for jet in record.jets:
				if is_instance_valid(jet): jet.queue_free()
			for moving_light in record.stream_lights:
				if is_instance_valid(moving_light): moving_light.queue_free()
			records.erase(id)
			continue
		var holding = record.weapon == active_item and is_instance_valid(active_hand) and game.held.get(str(active_hand.get_instance_id())) == active_item and _pressed(active_hand)
		var firing = holding and game.elapsed >= record.locked_until
		if firing:
			record.heat = minf(1.0, record.heat + delta / FULL_HEAT_SECONDS)
			if record.heat >= 1.0:
				record.locked_until = game.elapsed + OVERHEAT_SECONDS
				record.heat = 0.78
				firing = false
				game._notice("Wyrmspout overheated · teeth cooling for 3 seconds", 3)
				game._effect(record.muzzle.global_position, Color("ff3d1d"), 0.4, 0.3)
				game.adventure.haptic(active_hand, "impact")
		else:
			record.heat = maxf(0.0, record.heat - delta * COOL_RATE)
		if not holding and record.weapon == active_item: active_item = null; active_hand = null
		if firing and not record.audio.playing: record.audio.play()
		if not firing and record.firing: record.audio.stop()
		record.firing = firing
		for mat in record.heat_nodes: mat.emission_energy_multiplier = 0.22 + 4.0 * pow(record.heat, 2.0)
		# Most illumination travels with the liquid flame. A tiny muzzle glow
		# preserves the dragon's hot teeth without pretending the player is the fire.
		record.light.light_energy = 0.25 if firing else record.heat * 0.18
		_update_eyes(record, delta)
		if firing: _fire(record, delta)
		_step_stream(record,delta)
		_update_stream_lights(record)
	_update_patches(delta)

func _update_stream_lights(record: Dictionary):
	var drops: Array = record.drops
	for i in record.stream_lights.size():
		var moving_light: OmniLight3D = record.stream_lights[i]
		if drops.is_empty():
			moving_light.light_energy = 0.0
			continue
		# Fixed-cost representatives cover the whole near-to-far stream. Their
		# count stays bounded even when dozens of fire droplets are airborne.
		var index: int = mini(drops.size() - 1, int((float(i) + 0.5) * drops.size() / STREAM_LIGHT_COUNT))
		moving_light.global_position = drops[index].position
		moving_light.light_energy = 0.48 + 0.10 * sin(game.elapsed * 17.0 + i * 2.1)

func _pressed(hand: Node3D) -> bool:
	if game.get("travel_navigation")!=null and game.travel_navigation.hero_modal_open(): return false
	if diagnostic_force_trigger:
		var arguments = OS.get_cmdline_user_args()
		if arguments.has("--wyrmspout-check"): return true
		for argument in arguments:
			if argument.begins_with("--wyrmspout-capture="): return true
	if hand is XRController3D:
		return hand.is_button_pressed("trigger_click") or hand.get_float("trigger") > 0.36
	return Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and (game.desktop_look == null or game.desktop_look.captured)

func _update_eyes(record: Dictionary, delta: float):
	var muzzle: Node3D = record.muzzle
	var close = muzzle.global_position.distance_to(game.camera.global_position) < 0.78
	for entry in record.eyes:
		var eye: Node3D = entry.node
		var basis: Basis = entry.basis
		if close:
			var target = eye.to_local(game.camera.global_position).normalized()
			var yaw = clampf(atan2(target.x, -target.z), -0.22, 0.22)
			var pitch = clampf(atan2(target.y, -target.z), -0.18, 0.18)
			basis = entry.basis * Basis.from_euler(Vector3(pitch, yaw, 0))
		eye.basis = eye.basis.slerp(basis, minf(1.0, delta * 5.0))

func _fire(record: Dictionary, delta: float):
	var muzzle: Node3D = record.muzzle
	var origin = muzzle.global_position
	# Blender's empty marker is placed correctly but carries an export rotation;
	# the weapon root is the stable authored forward axis.
	var direction = -record.weapon.global_basis.z.normalized()
	var debt_before:float=record.spawn_debt
	record.spawn_debt += delta * STREAM_RATE
	var spawned=0
	while record.spawn_debt>=1.0 and spawned<8:
		record.spawn_debt-=1.0
		var time_into_frame=(1.0-debt_before+float(spawned))/STREAM_RATE
		spawned+=1
		var used={}
		for drop in record.drops: used[int(drop.index)]=true
		var free_index=-1
		for i in range(record.jets.size()):
			if not used.has(i): free_index=i; break
		if free_index<0: break
		var spread=Vector3(sin(game.elapsed*31+free_index)*0.32,cos(game.elapsed*27+free_index)*0.20,sin(game.elapsed*19+free_index)*0.18)
		var forward=(direction+spread*0.22).normalized()
		var jet:MeshInstance3D=record.jets[free_index]
		jet.visible=true
		# Backdate this emission within the current frame. Slow frames should
		# form one continuous tongue, never clusters of co-located flame.
		record.drops.append({"index":free_index,"position":origin+direction*0.08,"velocity":forward*STREAM_SPEED,"age":0.0,"travel":0.0,"advance":maxf(0.0,delta-time_into_frame),"zone":game.adventure.zone})
	if record.spawn_debt>=1.0: record.spawn_debt=fmod(record.spawn_debt,1.0)
	if game.elapsed >= next_haptic:
		next_haptic = game.elapsed + 0.24
		if active_hand is XRController3D: active_hand.trigger_haptic_pulse("haptic", 70, 0.15 * game.tuning.value("haptics.strength"), 0.07, 0)

func _step_stream(record:Dictionary,delta:float):
	for drop in record.drops.duplicate():
		var jet:MeshInstance3D=record.jets[int(drop.index)]
		if drop.zone!=game.adventure.zone or float(drop.age)>=STREAM_LIFETIME or float(drop.travel)>=RANGE:
			jet.visible=false; record.drops.erase(drop); continue
		var start:Vector3=drop.position
		var advance:float=float(drop.get("advance",delta))
		drop.erase("advance")
		drop.age+=advance
		var local_down:Vector3=game.gravity_direction_at(start) if game.has_method("gravity_direction_at") else Vector3.DOWN
		drop.velocity=drop.velocity*exp(-0.4*advance)+local_down*STREAM_GRAVITY*advance
		var finish=start+drop.velocity*advance
		drop.travel+=finish.distance_to(start)
		var query=PhysicsRayQueryParameters3D.create(start,finish,1)
		query.collide_with_areas=true
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if game.heat_contacts!=null and game.elapsed>=float(record.get("next_heat",0)) and finish.distance_to(start)<=.75:
			record.next_heat=game.elapsed+.045
			game.heat_contacts.sweep(start,hit.position if not hit.is_empty() else finish,.24,350,game.adventure.zone,"wyrm_stream",null,advance)
		if not hit.is_empty():
			var struck=game._owner(hit.collider)
			if struck!=null and str(struck.get_meta("kind","")) in ["enemy","rat"]:
				_hurt(struck,drop.velocity.normalized())
			var impact_up:Vector3=game.local_up_at(hit.position) if game.has_method("local_up_at") else Vector3.UP
			if hit.normal.dot(impact_up) > 0.55:
				# Ground packets get their own cadence. A wall or enemy hit must not
				# consume the next floor splash's chance to leave burning fuel.
				if game.elapsed >= next_ground_patch:
					next_ground_patch = game.elapsed + 0.11
					_ignite_surface(hit)
			elif game.elapsed>=next_patch:
				next_patch=game.elapsed+PATCH_INTERVAL
				_ignite_surface(hit)
			jet.visible=false; record.drops.erase(drop); continue
		drop.position=finish
		var age_fraction=clampf(float(drop.age)/STREAM_LIFETIME,0,1)
		# The mesh itself has a 0.36 m diameter: this is a world-scale flame,
		# not the old billboard's tiny sprite scale. Neighbouring packets overlap.
		var size=(0.60+0.25*age_fraction)*(1-smoothstep(0.76,1.0,age_fraction))
		var turn=Quaternion(Vector3.UP,-drop.velocity.normalized())
		jet.global_transform=Transform3D(Basis(turn),finish)
		jet.scale=Vector3(maxf(.03,size),maxf(.03,size*1.4),maxf(.03,size))
	if not record.drops.is_empty() and game.elapsed>=record.next_damage:
		record.next_damage=game.elapsed+0.16
		_damage_stream(record)

func _damage_stream(record:Dictionary):
	# Damage follows the actual drooping packets, so a wall or an early ground
	# impact cannot be burned through by an invisible straight cone.
	for enemy in game.scene.rats + game.scene.get("enemies", []) + game.scene.dummies:
		if not is_instance_valid(enemy) or not enemy.is_visible_in_tree() or not enemy.get_meta("alive",true): continue
		var enemy_up:Vector3=game.local_up_at(enemy.global_position) if game.has_method("local_up_at") else Vector3.UP
		var point=enemy.global_position+enemy_up*0.65
		for drop in record.drops:
			if point.distance_to(drop.position)>0.42+float(drop.age)*0.18: continue
			_hurt(enemy,drop.velocity.normalized())
			break

func _hurt(enemy:Node3D,direction:Vector3):
	var id=enemy.get_instance_id()
	if game.elapsed<damage_at.get(id,0.0): return
	damage_at[id]=game.elapsed+0.32
	if enemy.get_meta("enemy_type","")=="ghost": game.firecraft.hurt_ghost(enemy,32,"fire")
	elif enemy.get_meta("kind","")=="rat": game._kill_rat(enemy)
	elif enemy in game.scene.dummies: game._dummy_hit(enemy)
	else: game.adventure.hurt_enemy(enemy,15,active_hand,direction*0.8,"fire")

func _damage_cone(origin: Vector3, direction: Vector3, length: float):
	for enemy in game.scene.rats + game.scene.get("enemies", []) + game.scene.dummies:
		if not is_instance_valid(enemy) or not enemy.is_visible_in_tree() or not enemy.get_meta("alive", true): continue
		var enemy_up:Vector3=game.local_up_at(enemy.global_position) if game.has_method("local_up_at") else Vector3.UP
		var point = enemy.global_position + enemy_up * 0.7
		var along = (point - origin).dot(direction)
		if along < 0 or along > length + 0.5: continue
		if point.distance_to(origin + direction * clampf(along, 0, length)) > 0.42 + along * 0.10: continue
		_hurt(enemy,direction)

func _make_flame_mesh()->ArrayMesh:
	var surface=SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var radii=[0.08,0.18,0.12,0.075,0.0]
	for ring in 4:
		for segment in 8:
			var a=segment*TAU/8; var b=(segment+1)*TAU/8
			var v=[Vector3(cos(a)*radii[ring],ring*.17-.325,sin(a)*radii[ring]),Vector3(cos(b)*radii[ring],ring*.17-.325,sin(b)*radii[ring]),Vector3(cos(b)*radii[ring+1],(ring+1)*.17-.325,sin(b)*radii[ring+1]),Vector3(cos(a)*radii[ring+1],(ring+1)*.17-.325,sin(a)*radii[ring+1])]
			for j in [0,1,2,0,2,3]: surface.set_uv(Vector2(.5,(v[j].y+.325)/.68)); surface.add_vertex(v[j])
	surface.generate_normals()
	var shader=Shader.new()
	shader.code="""shader_type spatial;
render_mode unshaded,cull_disabled;
varying float h; varying float seed;
void vertex(){
 h=UV.y; vec2 anchor=MODEL_MATRIX[3].xz;
 seed=fract(sin(dot(anchor,vec2(12.9898,78.233)))*43758.5453);
 float phase=seed*6.283185;
 float flutter=mix(1.0,3.4,step(.66,seed));
 float growth=.65+seed*.65+sin(TIME*(2.2+seed)*flutter+phase)*.10;
 VERTEX.y=(VERTEX.y+.325)*growth-.325;
 VERTEX.xz*=.76+fract(seed*7.17)*.42;
 VERTEX.x+=sin(TIME*(3.1+seed)*flutter+phase+h*2.0)*h*h*.105;
 VERTEX.z+=cos(TIME*2.7*flutter+phase*1.3+h)*h*h*.075;
}
void fragment(){
 float crown=smoothstep(.40,.98,h);
 vec3 ember=mix(vec3(1.0,.22,.02),vec3(.62,.028,.002),crown);
 float centre=pow(abs(dot(normalize(NORMAL),normalize(VIEW))),2.0);
 float core=centre*smoothstep(.02,.23,h)*(1.0-smoothstep(.36,.77,h));
 vec3 flame=mix(ember,vec3(1.0,.78,.20),core*.90);
 ALBEDO=flame; EMISSION=flame*1.25;
}"""
	var material=ShaderMaterial.new(); material.shader=shader
	surface.set_material(material)
	return surface.commit()

func _ignite_surface(hit: Dictionary):
	var position: Vector3 = hit.position
	if game.heat_contacts!=null: game.heat_contacts.touch(position,.44,380,game.adventure.zone,"wyrm_impact",null,.1)
	var target=game._owner(hit.collider)
	var kind=str(target.get_meta("kind","")) if target!=null else ""
	# Ground impacts join the very same spreading liquid-fire simulation as a
	# thrown Emberdew bottle, rather than showing a separate billboard patch.
	var impact_up:Vector3=game.local_up_at(position) if game.has_method("local_up_at") else Vector3.UP
	if game.adventure.zone!="orchard_planet" and hit.normal.dot(impact_up)>0.55 and kind not in ["enemy","rat"] and game.firecraft!=null and game.firecraft.fluid!=null:
		if game.firecraft.fluid.pour(position,game.adventure.zone,GROUND_FUEL,true)>0:
			game.firecraft.fluid.ignite_near(position,0.34)
			return
		# A local fire patch remains the fallback when the finite fluid field is
		# full or the impact lies outside its current region. Floor hits never vanish.
	for patch in patches:
		if is_instance_valid(patch.node) and patch.node.global_position.distance_to(position) < PATCH_SPACING:
			patch.until = game.elapsed + PATCH_SECONDS
			return
	while patches.size() >= MAX_PATCHES:
		var oldest = patches.pop_front()
		if is_instance_valid(oldest.node): oldest.node.queue_free()
	var parent: Node3D = target if kind in ["enemy","rat"] else (hit.collider if hit.collider is Node3D else game.adventure.zone_groups.get(game.adventure.zone, game))
	var root = Node3D.new()
	root.name = "WyrmspoutLingeringFire"
	parent.add_child(root)
	root.global_position = position + hit.normal * 0.025
	root.global_basis = Basis(Quaternion(Vector3.UP, impact_up))
	var light = OmniLight3D.new()
	light.omni_range = 1.3
	light.light_color = Color("ff7a2c")
	light.light_energy = 0.55 if patches.size() % 4 == 0 else 0.0
	root.add_child(light)
	var quads: Array = []
	for i in range(3):
		var sprite = MeshInstance3D.new()
		sprite.mesh = flame_mesh
		sprite.material_override = patch_material
		root.add_child(sprite)
		quads.append(sprite)
	patches.append({"node":root,"quads":quads,"light":light,"until":game.elapsed + PATCH_SECONDS,"zone":game.adventure.zone})

func _update_patches(delta: float):
	for patch in patches.duplicate():
		if not is_instance_valid(patch.node) or game.elapsed >= patch.until:
			if is_instance_valid(patch.node): patch.node.queue_free()
			patches.erase(patch)
			continue
		var p: Vector3 = patch.node.global_position
		var visible = patch.zone == game.adventure.zone
		patch.node.visible = visible
		if not visible: continue
		var remainder = clampf((patch.until - game.elapsed) / 1.3, 0, 1)
		for i in range(patch.quads.size()):
			var sprite: MeshInstance3D = patch.quads[i]
			var position = p + Vector3((i - 1) * 0.11, 0.19 + 0.04 * sin(game.elapsed * 8 + i), 0)
			sprite.global_transform = Transform3D(Basis.IDENTITY, position)
			sprite.scale = Vector3.ONE * (1.0 + 0.16 * sin(game.elapsed * 12 + i * 2)) * remainder
		patch.light.light_energy = (0.35 + 0.18 * sin(game.elapsed * 13)) * remainder if patch.light.light_energy > 0 else 0.0
	if game.elapsed >= next_patch_damage:
		next_patch_damage = game.elapsed + 0.4
		for patch in patches:
			if not is_instance_valid(patch.node) or patch.zone != game.adventure.zone or not patch.node.is_visible_in_tree(): continue
			var source: Vector3 = patch.node.global_position
			if game.heat_contacts!=null: game.heat_contacts.touch(source,.45,170,game.adventure.zone,"wyrm_patch",patch.node,.4)
			for enemy in game.scene.rats + game.scene.get("enemies", []):
				if not is_instance_valid(enemy) or not enemy.is_visible_in_tree() or not enemy.get_meta("alive", true): continue
				if enemy.global_position.distance_to(source) > 0.85: continue
				if enemy.get_meta("enemy_type", "") == "ghost": game.firecraft.hurt_ghost(enemy,24,"fire")
				elif enemy.get_meta("kind", "") == "rat": game._kill_rat(enemy)
				else: game.adventure.hurt_enemy(enemy, 7, null, Vector3.ZERO, "fire")
			var player_up:Vector3=game.local_up_at(game.camera.global_position) if game.has_method("local_up_at") else Vector3.UP
			if game.elapsed >= next_player_hurt and (game.camera.global_position - player_up * 1.5).distance_to(source) < 0.6:
				next_player_hurt = game.elapsed + 1.2
				game.adventure.take_damage(4, "Wyrmspout flame")

func flame_sources() -> Array:
	var sources: Array = []
	for patch in patches:
		if is_instance_valid(patch.node) and patch.zone == game.adventure.zone: sources.append(patch.node.global_position)
	return sources
