extends Node
## A shallow three-step progress strip. Relay owns text, timer, actions and rewards.
const ART=preload("res://world_zones.gd")
const BAKE=preload("res://workshop_art.gd")
const CENTERS=[-.85,0.0,.85]
var game
var relay
var root:Node3D
var rosette:Node3D
var highlights=[]
var checks=[]
var clock=0.0
var display_stage=-1
var display_mode=""
var display_timed=false

func setup(owner_game,owner_relay):
	if is_instance_valid(root):return
	game=owner_game;relay=owner_relay
	if relay==null or not is_instance_valid(relay.board):return
	root=Node3D.new();root.name="FestivalRelayProgressArt";relay.board.add_child(root)
	for i in range(3):
		var icon=Node3D.new();root.add_child(icon);icon.position=Vector3(CENTERS[i],.76,.125)
		# Three small festival batons carry recognizable activity emblems.
		var stick=ART.box(icon,Vector3(-.13,0,0),Vector3(.035,.20,.025),"d5ad69");stick.rotation.z=-.25
		for y in [-.065,.065]:ART.box(icon,Vector3(-.13+y*.25,y,.014),Vector3(.057,.022,.012),"f4dda5")
		if i==0:
			_ring(icon,Vector3(.04,0,0),.073,.099,"f4dda5")
		elif i==1:
			ART.box(icon,Vector3(.04,0,0),Vector3(.16,.16,.022),"be8f68")
			ART.line(icon,Vector3(-.026,-.067,.016),Vector3(.106,.067,.016),.019,"f4dda5")
			ART.line(icon,Vector3(-.026,.067,.016),Vector3(.106,-.067,.016),.019,"f4dda5")
		else:
			for petal in range(5):
				var angle=float(petal)*TAU/5
				ART.rock(icon,Vector3(.04+cos(angle)*.059,sin(angle)*.059,0),Vector3(.074,.074,.023),"c1cfa0")
			ART.rock(icon,Vector3(.04,0,.014),Vector3(.066,.066,.019),"f4dda5")
		_bake(icon)
		var highlight=ART.box(root,Vector3(CENTERS[i]-.03,.76,.095),Vector3(.39,.24,.012),"497e73")
		highlight.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		highlights.append(highlight)
		var mark=Node3D.new();root.add_child(mark);mark.position=Vector3(CENTERS[i]+.25,.76,.135)
		ART.line(mark,Vector3(-.052,0,0),Vector3(-.013,-.035,0),.021,"bce8b8")
		ART.line(mark,Vector3(-.013,-.035,0),Vector3(.055,.049,0),.021,"bce8b8")
		_bake(mark);checks.append(mark)
	_build_rosette()
	tick(0)
	print("FESTIVAL_RELAY_ART ",JSON.stringify(debug_snapshot()))

func _bake(parent):
	BAKE.bake(parent)
	for child in parent.get_children():
		if child is GeometryInstance3D:child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _ring(parent,point,inner,outer,color):
	var node=MeshInstance3D.new();parent.add_child(node)
	var mesh=TorusMesh.new();mesh.inner_radius=inner;mesh.outer_radius=outer;mesh.rings=16;mesh.ring_segments=4
	node.mesh=mesh;node.position=point;node.rotation.x=PI/2;node.material_override=ART.mat(color)

func _build_rosette():
	rosette=Node3D.new();root.add_child(rosette);rosette.position=Vector3(1.36,.76,.12)
	for i in range(8):
		var angle=float(i)*TAU/8
		var petal=ART.box(rosette,Vector3(cos(angle)*.064,sin(angle)*.064,0),Vector3(.095,.044,.019),"deb56d")
		petal.rotation.z=angle
	_ring(rosette,Vector3(0,0,.012),.052,.073,"f4dda5")
	ART.rock(rosette,Vector3(0,0,.014),Vector3(.07,.07,.016),"bce8b8")
	_bake(rosette)

func tick(delta):
	if not is_instance_valid(root) or not is_instance_valid(relay):return
	clock=fmod(clock+maxf(float(delta),0),TAU/.7)
	display_mode=str(relay.mode)
	display_stage=clampi(int(relay.stage),0,2)
	display_timed=bool(relay.timed)
	for i in range(3):
		highlights[i].visible=display_mode=="running" and i==display_stage
		checks[i].visible=display_mode=="complete" or (display_mode=="running" and i<display_stage)
	rosette.visible=display_mode=="complete"
	rosette.rotation.z=sin(clock*.7)*.075

func debug_snapshot()->Dictionary:
	return {"render_meshes":_mesh_count(root),"mode":display_mode,"stage":display_stage,"timed":display_timed,"lights":0,"collisions":0}

func _mesh_count(node)->int:
	if not is_instance_valid(node):return 0
	var result=1 if node is MeshInstance3D else 0
	for child in node.get_children():result+=_mesh_count(child)
	return result
