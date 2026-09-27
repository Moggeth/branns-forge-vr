extends Node
## Bellworks fair dressings. No gameplay collision, lights, service calls or saved state.
const ART = preload("res://world_zones.gd")
const BAKE = preload("res://workshop_art.gd")
const WOOD = "795940"
const BRASS = "c8a36a"
const ROPE = "d6c09a"
const LEAF = "82955d"
const FLAGS = ["68ada0","d1a36b","9890b4"]
var game
var court: Node3D
var root: Node3D
var static_art: Node3D
var suspensions = []
var gold_trolley: Node3D
var clock = 0.0
var source_parts = 0

func setup(owner_game):
	if is_instance_valid(root): return
	game = owner_game
	if game.get("playful_encounters") == null: return
	court = game.playful_encounters.court
	if not is_instance_valid(court): return
	root = Node3D.new(); root.name = "BellworksFestivalArt"; court.add_child(root)
	static_art = Node3D.new(); static_art.name = "BatchedScenery"; root.add_child(static_art)
	_landscape()
	_bunting()
	_details()
	source_parts = static_art.get_child_count()
	BAKE.bake(static_art)
	for child in static_art.get_children():
		if child is GeometryInstance3D: child.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_suspensions()
	tick(0)
	print("PLAYFUL_FAIR_ART source_parts=",source_parts," static_batches=",static_art.get_child_count()," suspensions=",suspensions.size()," lights=0 collision=0")

func _landscape():
	# Small isolated garden island fills the view below/behind the existing fenced court.
	var soil = ART.cyl(static_art,Vector3(0,-1.25,0),1,2.3,"77766b")
	soil.scale.x = 23; soil.scale.z = 29
	var turf = ART.cyl(static_art,Vector3(0,-.22,0),1,.35,LEAF)
	turf.scale.x = 21; turf.scale.z = 26
	for i in range(9):
		var x = float(i-4)*2.7
		var z = -10.9-absf(x)*.12
		ART.rock(static_art,Vector3(x,.25,z),Vector3(4.6,2.2+float(i%3)*.6,3.5),LEAF if i%2==0 else "718567")
		if i%2 == 0: ART.rock(static_art,Vector3(x,.65,z+.15),Vector3(2.2,2.8,2),"939f92")
	for side in [-1,1]:
		for z in [-9.8,-6.4,1.4,6.8]:
			if side==1 and z==1.4: continue # Keep cargo bridge approach visually clear.
			ART.rock(static_art,Vector3(side*8.1,-.08,z),Vector3(1.8,1.1,2.1),"939f92")
		# Rounded low-poly canopies frame the fair without covering any target.
		for i in range(2):
			var p = Vector3(side*(8.9+i*.8),0,-9.8+i*4)
			ART.cyl(static_art,p+Vector3.UP*1.4,.17,2.8,WOOD)
			ART.rock(static_art,p+Vector3(0,3.3,0),Vector3(3.3,3.5,3.1),LEAF)
			ART.rock(static_art,p+Vector3(side*.75,3.1,.35),Vector3(2.4,2.7,2.4),"a2af6d")

func _bunting():
	# Pennants and ropes follow the existing perimeter posts, never cross the toss lane.
	for side in [-1,1]:
		for section in range(2):
			var start = -7.0+float(section)*7.0
			for j in range(8):
				var t = float(j)/8.0
				var t2 = float(j+1)/8.0
				var a = Vector3(side*6.48,4.0-sin(t*PI)*.48,start+t*7)
				var b = Vector3(side*6.48,4.0-sin(t2*PI)*.48,start+t2*7)
				ART.line(static_art,a,b,.024,ROPE)
				_pennant((a+b)*.5,side,FLAGS[(j+section)%FLAGS.size()])

func _pennant(position: Vector3, side: int, color: String):
	var surface = SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	# Cloth hangs in the YZ plane and is visible from both sides of the fair.
	var points = [Vector3(0,0,-.25),Vector3(0,0,.25),Vector3(0,-.6,0)]
	for i in [0,1,2,2,1,0]:
		surface.set_normal(Vector3(side,0,0)); surface.add_vertex(points[i])
	var flag = MeshInstance3D.new(); flag.mesh = surface.commit(); flag.material_override = ART.mat(color)
	static_art.add_child(flag); flag.position = position

func _details():
	for side in [-1,1]:
		for z in [-7,0,7]:
			# Gold post caps, stone feet and planted urns stay beside the side rail.
			ART.cyl(static_art,Vector3(side*6.5,.15,z),.24,.3,"939f92")
			ART.cyl(static_art,Vector3(side*6.5,4.25,z),.14,.15,BRASS)
			_pot(Vector3(side*6.1,0,z+.7),z)
		for z in [-6,-2,2,6]:
			ART.box(static_art,Vector3(side*6.65,1.03,z),Vector3(.28,.1,3.8),BRASS)
		# Grounded beam feet and decorative corner braces.
		ART.box(static_art,Vector3(side*4.8,.13,-4),Vector3(.48,.26,.54),"939f92")
		ART.line(static_art,Vector3(side*4.8,2.7,-4),Vector3(side*4.1,3.3,-4),.13,BRASS)
		# Back gantry supports the gold-bell trolley.
		ART.box(static_art,Vector3(side*4.8,2.08,-5.8),Vector3(.16,4.16,.16),WOOD)
		ART.box(static_art,Vector3(side*4.8,.13,-5.8),Vector3(.42,.26,.44),"939f92")
	ART.box(static_art,Vector3(0,4.13,-5.8),Vector3(9.8,.14,.2),BRASS)
	# Inlaid warm border lines leave existing scoring line visually dominant.
	for side in [-1,1]: ART.box(static_art,Vector3(side*5.6,.006,0),Vector3(.035,.01,15.5),"c8b78d")
	for i in range(9): ART.box(static_art,Vector3(float(i-4)*1.1,.007,7.5),Vector3(.72,.012,.43),"a9a88a")

func _pot(position: Vector3, seed_value: int):
	ART.cyl(static_art,position+Vector3.UP*.29,.34,.58,"ae7758","taper")
	ART.cyl(static_art,position+Vector3.UP*.58,.37,.11,BRASS)
	ART.cyl(static_art,position+Vector3.UP*.62,.30,.045,"655340")
	for i in range(5):
		var angle = float(i)*2.3999
		var flower = position+Vector3(cos(angle)*.21,.91+float(i%2)*.14,sin(angle)*.21)
		ART.line(static_art,position+Vector3.UP*.6,flower,.025,LEAF)
		ART.rock(static_art,flower,Vector3(.16,.14,.16),FLAGS[absi(i+seed_value)%3])
		ART.rock(static_art,position+Vector3(cos(angle)*.25,.72,sin(angle)*.25),Vector3(.30,.18,.22),LEAF)

func _suspensions():
	for i in range(game.playful_encounters.bells.size()):
		var hanger = Node3D.new(); root.add_child(hanger)
		var cord = ART.cyl(hanger,Vector3.ZERO,.024,1,ROPE)
		var eyelet = MeshInstance3D.new(); hanger.add_child(eyelet)
		var torus = TorusMesh.new(); torus.inner_radius=.06; torus.outer_radius=.085; torus.rings=8; torus.ring_segments=4
		eyelet.mesh=torus; eyelet.material_override=ART.mat(BRASS); eyelet.rotation.x=PI/2
		cord.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		eyelet.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		suspensions.append({"root":hanger,"cord":cord,"eyelet":eyelet,"bell":weakref(game.playful_encounters.bells[i]),"gold":i==3})
	gold_trolley = Node3D.new(); root.add_child(gold_trolley)
	ART.box(gold_trolley,Vector3.ZERO,Vector3(.38,.24,.3),WOOD)
	for x in [-.13,.13]:
		var wheel = ART.cyl(gold_trolley,Vector3(x,.11,0),.13,.12,BRASS)
		wheel.rotation.x=PI/2
	BAKE.bake(gold_trolley)
	for child in gold_trolley.get_children(): child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func tick(delta: float):
	clock += maxf(delta,0)
	if not is_instance_valid(root): return
	for hanger in suspensions:
		var bell = hanger.bell.get_ref()
		hanger.root.visible = is_instance_valid(bell) and bell.visible
		if hanger.gold: gold_trolley.visible = hanger.root.visible
		if not hanger.root.visible: continue
		var end = bell.position+Vector3.UP*.32
		var start = Vector3(bell.position.x,4.03 if hanger.gold else 3.26,bell.position.z)
		var direction = end-start
		hanger.cord.position = (start+end)*.5
		hanger.cord.basis = Basis(Quaternion(Vector3.UP,direction.normalized())).scaled(Vector3(.048,direction.length(),.048))
		hanger.eyelet.position = end
		if hanger.gold: gold_trolley.position = start+Vector3.UP*.12

func debug_snapshot()->Dictionary:
	return {"source_parts":source_parts,"static_batches":static_art.get_child_count() if is_instance_valid(static_art) else 0,"suspensions":suspensions.size(),"lights":0,"collisions":0}
