extends Node3D
var vis
var frame = 0
var bomb
var shots = {}
func _ready():
	var env = WorldEnvironment.new()
	var e = Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.09,0.11,0.15)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.35,0.4,0.5)
	e.glow_enabled = true
	e.glow_intensity = 0.6
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	add_child(env)
	var sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50,30,0)
	sun.light_energy = 0.8
	add_child(sun)
	var floor_body = StaticBody3D.new()
	var col = CollisionShape3D.new()
	var box = BoxShape3D.new(); box.size = Vector3(40,1,40)
	col.shape = box
	floor_body.add_child(col)
	floor_body.position = Vector3(0,-0.5,0)
	add_child(floor_body)
	var fm = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size=Vector2(40,40)
	fm.mesh = pm
	var mat = StandardMaterial3D.new(); mat.albedo_color = Color(0.25,0.22,0.2)
	fm.material_override = mat
	add_child(fm)
	var cam = Camera3D.new()
	cam.position = Vector3(0.0,1.4,3.2)
	add_child(cam)
	cam.look_at(Vector3(0,0.5,0))
	vis = load("res://pocket_thunder/pocket_thunder_visuals.gd").new()
	add_child(vis)
	vis.setup(self)
	bomb = vis.create_bomb(self, 0.095)
	bomb.position = Vector3(0,0.4,0)
	bomb.scale = Vector3.ONE * 1.6
	vis.update_forming(bomb, 0.5)
func _process(_d):
	frame += 1
	vis.tick(1.0/60.0)
	if frame == 3: shot("00_forming")
	if frame == 5: vis.update_forming(bomb, 1.0)
	if frame == 8: shot("01_ready")
	if frame == 10:
		bomb.visible = false
		vis.explosion(Vector3(0,0.4,0), 2.4, 1.0, 0.75, 32, Vector3(1,0,-0.2))
	var t = frame - 10
	var marks = {2:"02_snap_33ms",5:"03_snap_end_83ms",8:"04_pop_133ms",13:"05_peak_217ms",22:"06_expand_367ms",40:"07_settle_667ms",75:"08_embers_1250ms",110:"09_smoke_1830ms"}
	if marks.has(t): shot(marks[t])
	if t == 118:
		print("PT_OK bursts=", vis.bursts.size())
		get_tree().quit()
func shot(n):
	get_viewport().get_texture().get_image().save_png("res://shots/%s.png" % n)
