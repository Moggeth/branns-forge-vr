extends SceneTree
## Isolated desktop art laboratory. Does not start main, XR, service, voice or save systems.
const W=preload("res://workshop_scene.gd")
var stage:Node3D
var art:Node3D
var camera:Camera3D
var env:Environment
var sun:DirectionalLight3D
var original_env:Environment
var original_sun={}
var materials=[]
var original_materials=[]
var lights=[]
var mode=1
var strength=1.0
var clock=0.0
var yaw=0.48
var pitch=0.23
var distance=13.0
var target=Vector3(0,1.1,-3)
var previous_mouse=Vector2.ZERO
var last_keys={}
var automatic=false
var motion_paused=false
var ready_demo=false
var names=["Original palette","01 · Golden hour","02 · Hearth at dusk","03 · Enchanted workshop"]
var descriptions=["Existing forge palette and assets. Gameplay menus are hidden in all views.","Honey-coloured sunlight, cool shade, textured timber and a living garden.","Deep blue evening, warm lanterns and copper catching the forge light.","Violet twilight, luminous crystals and slow drifting magical motes."]
var heading:Label
var caption:Label
var stats:Label
var buttons=[]
var motes:MultiMeshInstance3D
var grass:ShaderMaterial
var output=""
var camera_index=0
var pending_capture=false
var weather_lab
var weather_mode=false

func _initialize():
	call_deferred("build")

func build():
	root.window_input.connect(_input)
	root.title="Brann's Forge · Visual Laboratory"
	root.size=Vector2i(1440,900)
	root.position=Vector2i(80,70)
	root.msaa_3d=Viewport.MSAA_4X
	stage=Node3D.new(); root.add_child(stage)
	W.build(stage)
	# Remove game-only menu furniture equally in all four art comparisons.
	for node in stage.get_children():
		if node is Node3D and (node.get_meta("kind","")=="button" or node.position.distance_to(Vector3(5.4,1.9,-5.55))<.1 or node.position.distance_to(Vector3(-6.9,1.9,-4.55))<.15): node.visible=false
	for node in stage.find_children("*","Label3D",true,false): node.visible=false
	for node in stage.find_children("*","CollisionObject3D",true,false): node.collision_layer=0; node.collision_mask=0
	env=stage.get_node("AdventureEnvironment").environment
	sun=stage.get_node("AdventureSun")
	original_env=env.duplicate()
	original_sun={"rotation":sun.rotation,"color":sun.light_color,"energy":sun.light_energy}
	for node in stage.find_children("*","MeshInstance3D",true,false):
		var m=node.material_override
		if m is StandardMaterial3D and not m.emission_enabled and not materials.has(m): materials.append(m); original_materials.append(m.duplicate())
	art=Node3D.new(); stage.add_child(art)
	make_details()
	camera=Camera3D.new(); stage.add_child(camera); camera.current=true; camera.fov=48; camera.far=180
	update_camera()
	make_ui()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-demos="): output=arg.trim_prefix("--capture-demos=")
	apply_mode(1)
	weather_mode=OS.get_cmdline_user_args().has("--weather-lab")
	if weather_mode:
		weather_lab=preload("res://weather_lab.gd").new(); stage.add_child(weather_lab); weather_lab.setup(self)
		heading.text="A living forge"
		caption.text="Stars overhead, rain on the roof, snow underfoot. Try a little bottled fire."
		buttons[0].get_parent().hide()
		for child in heading.get_parent().get_children():
			if child is HSlider or (child is Label and child.text=="Treatment strength"): child.hide()
	ready_demo=true
	print("VISUAL_DEMO_READY renderer=Mobile isolated=true presets=3")
	if OS.get_cmdline_user_args().has("--weather-check"):
		var failures=weather_lab.checks()
		print("WEATHER_CHECK_RESULT ",JSON.stringify(failures))
		if not failures.is_empty(): quit(1); return
		if output.is_empty(): ready_demo=false; quit(); return
	if not output.is_empty():
		if weather_mode: capture_weather.call_deferred()
		else: capture_all.call_deferred()

func make_details():
	var rng=RandomNumberGenerator.new(); rng.seed=4712
	var paving=W.material("b6a07d",0,0.88)
	for i in range(16):
		var tile=W.cylinder(art,Vector3(sin(i*.74)*.55,.06,4.9-i*.48),.39,.09,paving)
		tile.scale.z=.7; tile.rotation.y=rng.randf()*TAU
	# Reusable texture: gentle grain rather than photo-realistic visual noise.
	var im=Image.create(128,128,false,Image.FORMAT_RGB8)
	for y in range(128):
		for x in range(128):
			var value=.86+.06*sin(x*.45+sin(y*.08)*1.8)+rng.randf_range(-.025,.025)
			im.set_pixel(x,y,Color(value,value,value))
	im.generate_mipmaps()
	var texture=ImageTexture.create_from_image(im)
	for m in materials:
		if m.albedo_color.r>m.albedo_color.b*1.18 and m.metallic<.3:
			m.set_meta("demo_texture",texture)
	# A shared vertex shader moves all instanced grass without per-blade scripts.
	grass=ShaderMaterial.new()
	var shader=Shader.new()
	shader.code="shader_type spatial; render_mode cull_disabled; uniform float breeze=1.0; varying float h; void vertex(){h=UV.y; vec3 w=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; VERTEX.x+=sin(TIME*1.2+w.x*.7+w.z)*.06*UV.y*breeze;} void fragment(){ALBEDO=mix(vec3(.13,.24,.10),vec3(.47,.58,.22),h); ROUGHNESS=.95;}"
	grass.shader=shader
	var surface=SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for angle in [0.0,PI*.5]:
		for v in [Vector3(-.05,0,0),Vector3(.05,0,0),Vector3(.015,.32,0)]:
			surface.set_uv(Vector2(.5,1.0 if v.y>0 else 0.0)); surface.set_normal(Vector3.FORWARD.rotated(Vector3.UP,angle)); surface.add_vertex(v.rotated(Vector3.UP,angle))
	var grass_mesh=surface.commit(); grass_mesh.surface_set_material(0,grass)
	var mm=MultiMesh.new(); mm.transform_format=MultiMesh.TRANSFORM_3D; mm.mesh=grass_mesh; mm.instance_count=1800
	for i in range(mm.instance_count):
		var x=rng.randf_range(-10,10); var z=rng.randf_range(-1,10)
		if abs(x)<1.15: x+=2.0*sign(x+.001)
		mm.set_instance_transform(i,Transform3D(Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3.ONE*rng.randf_range(.6,1.5)),Vector3(x,.04,z)))
	var field=MultiMeshInstance3D.new(); field.multimesh=mm; field.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; art.add_child(field)
	for side in [-1,1]:
		for i in range(3):
			var p=Vector3(side*(3.4+i*.9),.0,1.2+i*1.25)
			W.cylinder(art,p+Vector3.UP*.21,.25,.4,W.material("9c6148"),.32)
			for j in range(5):
				var flower=p+Vector3(rng.randf_range(-.22,.22),rng.randf_range(.45,.72),rng.randf_range(-.22,.22))
				W.cylinder(art,flower-Vector3.UP*.15,.013,.3,W.material("526b35"))
				W.ball(art,flower,Vector3(.11,.06,.11),W.material("e1c876" if i%2==0 else "aa94be"))
	# A small cabinet makes the working forge feel stocked without complex models.
	var shelfwood=W.material("765338")
	var clay=W.material("9d7958")
	for y in [.85,1.65,2.4]:
		preload("res://workshop_details.gd").clipped_box(art,Vector3(4.65,y,-5.2),Vector3(2.6,.12,.48),shelfwood)
		for j in range(5):
			var p=Vector3(3.65+j*.45,y+.20,-5.2)
			W.cylinder(art,p,.12,.28,clay,.09)
			W.cylinder(art,p+Vector3.UP*.17,.095,.06,shelfwood)
	for x in [3.4,5.9]: W.box(art,Vector3(x,1.58,-5.37),Vector3(.09,1.9,.10),shelfwood)
	# Real game hero assets, placed on a dedicated display table.
	var wood=W.material("795839")
	preload("res://workshop_details.gd").clipped_box(art,Vector3(3.1,.8,.2),Vector3(2.1,.14,.85),wood)
	for x in [2.25,3.95]: W.box(art,Vector3(x,.38,.2),Vector3(.13,.76,.65),wood)
	var axe=Node3D.new(); art.add_child(axe); axe.position=Vector3(2.65,.91,.15); axe.rotation.z=-.3
	preload("res://hero_axe.gd").new().build(axe)
	var hammer=Node3D.new(); art.add_child(hammer); hammer.position=Vector3(3.5,.9,.2); hammer.rotation.z=.24
	preload("res://hero_hammer.gd").new().build(hammer)
	for i in range(7):
		var gem=W.cylinder(art,Vector3(-4.5+(i%3)*.23,.25+(i%3)*.12,-1.8+floor(i/3.)*.22),.12,.5+(i%3)*.24,W.material("899ad1",.25,.22,.7),0)
		gem.rotation.z=(i-3)*.13
	for p in [Vector3(-4.7,2.0,-2),Vector3(3.7,2.1,-3.5)]:
		W.box(art,p,Vector3(.24,.4,.24),W.material("daa75b",.1,.5,1))
		for h in [-.23,.23]: W.box(art,p+Vector3.UP*h,Vector3(.32,.06,.32),W.material("423c33",.65,.36))
		var light=OmniLight3D.new(); art.add_child(light); light.position=p; light.omni_range=5; light.light_color=Color("ffb45d"); light.light_energy=1.2; lights.append(light)
	var magic=OmniLight3D.new(); art.add_child(magic); magic.position=Vector3(-4.2,.8,-1.5); magic.omni_range=5; magic.light_color=Color("9287ff"); lights.append(magic)
	# Bounded opaque motes keep transparency overdraw out of this demo.
	var mesh=SphereMesh.new(); mesh.radius=.018; mesh.height=.036; mesh.radial_segments=6; mesh.rings=3; mesh.material=W.material("ffcd7c",0,.7,1.4)
	var particles=MultiMesh.new(); particles.transform_format=MultiMesh.TRANSFORM_3D; particles.mesh=mesh; particles.instance_count=48
	motes=MultiMeshInstance3D.new(); motes.multimesh=particles; motes.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; art.add_child(motes)
	var probe=ReflectionProbe.new(); probe.position=Vector3(0,1,-3); probe.size=Vector3(17,9,15); probe.max_distance=30; probe.intensity=.55; art.add_child(probe)

func make_ui():
	var layer=CanvasLayer.new(); root.add_child(layer)
	var panel=PanelContainer.new(); panel.position=Vector2(24,24); layer.add_child(panel)
	var style=StyleBoxFlat.new(); style.bg_color=Color(.045,.075,.09,.94); style.corner_radius_top_left=12; style.corner_radius_top_right=12; style.corner_radius_bottom_left=12; style.corner_radius_bottom_right=12; style.content_margin_left=20; style.content_margin_right=20; style.content_margin_top=16; style.content_margin_bottom=16; panel.add_theme_stylebox_override("panel",style)
	var col=VBoxContainer.new(); col.add_theme_constant_override("separation",10); panel.add_child(col)
	var eyebrow=Label.new(); eyebrow.text="BRANN’S FORGE  /  VISUAL LAB"; eyebrow.add_theme_color_override("font_color",Color("b8bdad")); col.add_child(eyebrow)
	heading=Label.new(); heading.add_theme_font_size_override("font_size",28); col.add_child(heading)
	caption=Label.new(); caption.custom_minimum_size.x=385; caption.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; col.add_child(caption)
	var row=HBoxContainer.new(); col.add_child(row)
	for i in range(4):
		var b=Button.new(); b.text=["0 Original","1 Golden","2 Hearth","3 Enchanted"][i]; b.pressed.connect(func():apply_mode(i)); row.add_child(b); buttons.append(b)
	var label=Label.new(); label.text="Treatment strength"; col.add_child(label)
	var slider=HSlider.new(); slider.min_value=0; slider.max_value=1; slider.step=.01; slider.value=1; slider.value_changed.connect(func(v):strength=v; apply_mode(mode)); col.add_child(slider)
	var controls=HBoxContainer.new(); col.add_child(controls)
	for entry in [["Change view",0],["Auto orbit",1],["Pause motion",2]]:
		var b=Button.new(); b.text=entry[0]; var action=entry[1]; b.pressed.connect(func():control(action)); controls.add_child(b)
	var help=Label.new(); help.text="Right-drag: orbit · Wheel: zoom · 0–3: looks
V: view · Space: orbit · P: pause · Esc: close
Desktop art demo · Headset performance not measured"; help.add_theme_font_size_override("font_size",13); col.add_child(help)
	stats=Label.new(); stats.position=Vector2(24,850); stats.add_theme_font_size_override("font_size",14); layer.add_child(stats)

func apply_mode(which):
	mode=which
	var presets=[{}, {"sky":"739dae","horizon":"e5caa1","ambient":"9ebcc9","energy":.32,"sun":"ffe0a3","power":1.65,"rotation":Vector3(-23,-40,0),"fog":"c6bca0","density":.002}, {"sky":"101d3e","horizon":"536983","ambient":"8ca4d0","energy":.25,"sun":"a1c0eb","power":.36,"rotation":Vector3(-40,-35,0),"fog":"536584","density":.005}, {"sky":"262341","horizon":"ad849e","ambient":"a4a0d2","energy":.30,"sun":"d8c0f0","power":.65,"rotation":Vector3(-28,-55,0),"fog":"8b829f","density":.006}]
	var original=mode==0
	var weight=0.0 if original else strength
	art.visible=weight>0
	var p=presets[mode if not original else 1]
	var sky=env.sky.sky_material
	var old_sky=original_env.sky.sky_material
	# Duplicate sky once: original environment must remain an immutable comparison.
	if env.sky==original_env.sky:
		env.sky=env.sky.duplicate(); env.sky.sky_material=sky.duplicate(); sky=env.sky.sky_material
	sky.sky_top_color=old_sky.sky_top_color.lerp(Color(p.sky),weight)
	sky.sky_horizon_color=old_sky.sky_horizon_color.lerp(Color(p.horizon),weight)
	sky.ground_horizon_color=sky.sky_horizon_color
	env.ambient_light_color=original_env.ambient_light_color.lerp(Color(p.ambient),weight)
	env.ambient_light_energy=lerpf(original_env.ambient_light_energy,p.energy,weight)
	env.fog_light_color=original_env.fog_light_color.lerp(Color(p.fog),weight)
	env.fog_density=lerpf(original_env.fog_density,p.density,weight)
	sun.light_color=original_sun.color.lerp(Color(p.sun),weight); sun.light_energy=lerpf(original_sun.energy,p.power,weight)
	sun.rotation=original_sun.rotation.lerp(p.rotation*PI/180.0,weight)
	for i in range(materials.size()):
		var m=materials[i]; var old=original_materials[i]
		m.albedo_texture=m.get_meta("demo_texture",null) if weight>.01 and m.has_meta("demo_texture") else old.albedo_texture
		m.texture_filter=BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		m.roughness=lerpf(old.roughness,maxf(.24,old.roughness-.12),weight)
	for i in range(lights.size()): lights[i].light_energy=(2.2 if mode==2 else 1.1)*weight if i<2 else (2.7 if mode==3 else .35)*weight
	motes.visible=mode in [2,3]
	grass.set_shader_parameter("breeze",0.0 if motion_paused else weight)
	heading.text=names[mode]; caption.text=descriptions[mode]
	for i in range(buttons.size()): buttons[i].modulate=Color("f3cf8b") if i==mode else Color.WHITE
	print("VISUAL_DEMO_PRESET ",mode," strength=",strength)

func control(action):
	if action==0:
		camera_index=(camera_index+1)%3
		if camera_index==0: target=Vector3(0,1.1,-3); distance=13; yaw=.48; pitch=.23
		elif camera_index==1: target=Vector3(-.6,1.2,-3.4); distance=6; yaw=-.27; pitch=.16
		else: target=Vector3(3.1,1.22,.15); distance=3.1; yaw=.65; pitch=.26
		update_camera()
	elif action==1: automatic=not automatic
	else:
		motion_paused=not motion_paused
		stage.process_mode=Node.PROCESS_MODE_DISABLED if motion_paused else Node.PROCESS_MODE_INHERIT
		grass.set_shader_parameter("breeze",0.0 if motion_paused else strength)

func update_camera():
	camera.position=target+Vector3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch))*distance
	camera.look_at(target)

func _process(delta):
	if not ready_demo: return false
	if not motion_paused: clock+=delta
	if weather_lab!=null and not motion_paused: weather_lab.tick(delta)
	if automatic and not motion_paused: yaw+=delta*.08
	var mouse=root.get_mouse_position()
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var movement=mouse-previous_mouse; yaw-=movement.x*.005; pitch=clampf(pitch+movement.y*.005,-.05,1.1)
	previous_mouse=mouse
	for key in [KEY_0,KEY_1,KEY_2,KEY_3,KEY_V,KEY_SPACE,KEY_P,KEY_ESCAPE]:
		var down=Input.is_key_pressed(key)
		if down and not last_keys.get(key,false):
			if key>=KEY_0 and key<=KEY_3:
				if not weather_mode: apply_mode(key-KEY_0)
			elif key==KEY_V: control(0)
			elif key==KEY_SPACE: control(1)
			elif key==KEY_P: control(2)
			elif key==KEY_ESCAPE: quit()
		last_keys[key]=down
	update_camera()
	for i in range(48):
		var t=clock*.12+i*.713
		motes.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY,Vector3(sin(i*2.31)*6+sin(t)*.3,.4+fposmod(t,3),-2+cos(i*1.83)*4)))
	stats.text="Mobile renderer · %d FPS · %d draw calls · %s"%[Engine.get_frames_per_second(),Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"Motion paused" if motion_paused else "Live animation"]
	return false

func _input(event):
	if weather_lab!=null: weather_lab.pointer(event)
	if event is InputEventMouseButton and event.pressed:
		if event.button_index==MOUSE_BUTTON_WHEEL_UP: distance=maxf(1.3,distance*.91)
		elif event.button_index==MOUSE_BUTTON_WHEEL_DOWN: distance=minf(28,distance*1.1)

func capture_all():
	await create_timer(2).timeout
	for i in range(4):
		apply_mode(i)
		await create_timer(1.2).timeout
		await RenderingServer.frame_post_draw
		var result=root.get_texture().get_image().save_png(output+"/look-"+str(i)+".png")
		print("VISUAL_DEMO_CAPTURE mode=",i," result=",result," draw_calls=",Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	# Exercise visible preset buttons and camera controls before declaring completion.
	buttons[0].pressed.emit()
	assert(mode==0 and not art.visible)
	buttons[3].pressed.emit()
	assert(mode==3 and art.visible)
	var before=camera.position
	control(0)
	assert(camera.position.distance_to(before)>1)
	control(2); assert(motion_paused)
	control(2); assert(not motion_paused)
	print("VISUAL_DEMO_CONTROLS_PASS")
	print("VISUAL_DEMO_CAPTURE_COMPLETE")
	ready_demo=false
	stage.queue_free()
	materials.clear(); original_materials.clear(); lights.clear()
	WorldZones.mats.clear(); WorldZones.meshes.clear()
	await process_frame
	await process_frame
	quit()

func capture_weather():
	await create_timer(1).timeout
	for preset in (["stress"] if OS.get_cmdline_user_args().has("--fuel-stress") else ["night","rain","snow","fire"]):
		weather_lab.hour=0 if preset=="night" else 16
		target=Vector3(0,7,-4) if preset=="night" else Vector3(0,1.1,-3)
		distance=18 if preset=="night" else 13; yaw=.2 if preset=="night" else .48; pitch=-.12 if preset=="night" else .23
		weather_lab.set_weather(preset if preset in ["rain","snow"] else "clear")
		if preset=="stress":
			weather_lab.wet.fill(0); weather_lab.snow.fill(0)
			for i in range(40):
				var point=weather_lab.point(weather_lab.cell_index(Vector3(-9+(i%8)*2.5,0,-6+floorf(i/8.0)*3)))
				weather_lab.spill(point+Vector3.UP*.025,true)
			for i in range(12): weather_lab.simulation(.1)
			target=Vector3(0,1,1); distance=22; pitch=.8
		if preset=="snow":
			for i in range(160): weather_lab.simulation(.1)
		if preset=="fire":
			weather_lab.snow.fill(0); weather_lab.wet.fill(0)
			var fire_target=weather_lab.point(weather_lab.cell_index(Vector3(1.5,0,6)))+Vector3.UP*.025
			weather_lab.spill(fire_target)
			target=fire_target+Vector3.UP*.6; distance=6; yaw=.35; pitch=.65
			for i in range(20): weather_lab.simulation(.1)
		await create_timer(1.5).timeout
		await RenderingServer.frame_post_draw
		print("WEATHER_CAPTURE ",preset," result=",root.get_texture().get_image().save_png(output+"/weather-"+preset+".png"))
	print("WEATHER_CAPTURE_COMPLETE")
	ready_demo=false
	quit()
