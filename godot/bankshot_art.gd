extends Node
## Visual-only Bankshot garden. Challenge owns every collider, target and reward state.
const ART=preload("res://world_zones.gd")
const BAKE=preload("res://workshop_art.gd")
const GOLD="deb366"
const INK="40595a"
const STONE="969b87"
const LEAF="809568"
var game
var challenge
var root:Node3D
var scenery:Node3D
var target_art:Node3D
var medal_art:Node3D
var source_parts=0
var clock=0.0

func setup(owner_game,owner_challenge):
	if is_instance_valid(root):return
	game=owner_game;challenge=owner_challenge
	if challenge==null or not is_instance_valid(challenge.court):return
	root=Node3D.new();root.name="BankshotGardenArt";challenge.court.add_child(root)
	scenery=Node3D.new();scenery.name="BatchedGarden";root.add_child(scenery)
	_garden()
	_wall_motifs()
	source_parts=scenery.get_child_count();_bake(scenery)
	_target_trim()
	_medal()
	print("BANKSHOT_ART ",JSON.stringify(debug_snapshot()))

func _bake(parent:Node3D):
	BAKE.bake(parent)
	for child in parent.get_children():
		if child is GeometryInstance3D:child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _garden():
	# A local garden base; existing floor/fences remain the playable boundary.
	var foundation=ART.cyl(scenery,Vector3(0,-.92,0),1,1.7,"747769")
	foundation.scale.x=22;foundation.scale.z=26
	var turf=ART.cyl(scenery,Vector3(0,-.16,0),1,.24,LEAF)
	turf.scale.x=21;turf.scale.z=25
	for side in [-1,1]:
		for z in [-7.5,-5.4,1.8,5.8,8]:
			ART.rock(scenery,Vector3(side*7.8,.08,z),Vector3(1.2,.85,1.5),STONE)
		for z in [-6,6.9]:_flowers(Vector3(side*6.55,0,z),side)
		# Wall corner feet and timber cap have visibly grounded joins.
		ART.box(scenery,Vector3(side*4.68,.18,-4),Vector3(.5,.36,.5),STONE)
		ART.box(scenery,Vector3(side*4.68,1.75,-4),Vector3(.2,3.4,.28),"846649")
		for y in [.55,2.8]:ART.box(scenery,Vector3(side*4.68,y,-3.84),Vector3(.31,.10,.06),GOLD)
		# Small topiary silhouettes behind the backboard, not in the shot volume.
		var point=Vector3(side*6.4,0,-7.7)
		ART.cyl(scenery,point+Vector3.UP*1.2,.14,2.4,"846649")
		ART.rock(scenery,point+Vector3.UP*2.7,Vector3(2.5,2.9,2.6),LEAF)
		ART.rock(scenery,point+Vector3(side*.5,2.45,.3),Vector3(1.8,1.8,1.8),"a4ae75")
		for i in range(7):
			var z=-7.0+float(i)*2.15
			ART.box(scenery,Vector3(side*6.25,.014,z),Vector3(.46,.025,.72),"b9b295")
	for x in [-5.0,0,5.0]:ART.rock(scenery,Vector3(x,.1,-9.5),Vector3(5,1.65,2.7),LEAF)

func _flowers(point:Vector3,side:int):
	ART.cyl(scenery,point+Vector3.UP*.22,.31,.44,"aa765a")
	ART.cyl(scenery,point+Vector3.UP*.45,.34,.08,GOLD)
	for i in range(4):
		var angle=float(i)*2.4
		var bloom=point+Vector3(cos(angle)*.22,.73+float(i%2)*.13,sin(angle)*.22)
		ART.line(scenery,point+Vector3.UP*.45,bloom,.025,LEAF)
		ART.rock(scenery,bloom,Vector3(.19,.15,.19),"ead89d" if side>0 else "a4c9bd")

func _wall_motifs():
	ART.box(scenery,Vector3(0,3.38,-4),Vector3(9.8,.16,.32),GOLD)
	# Raised enamel diamond is a bounce emblem, not an exact trajectory or hidden hitbox.
	var center=Vector3(0,1.7,-3.86)
	var plaque=ART.box(scenery,center,Vector3(.86,.86,.024),INK);plaque.rotation.z=PI/4
	var points=[Vector3(0,.64,0),Vector3(.64,0,0),Vector3(0,-.64,0),Vector3(-.64,0,0)]
	for i in range(4):ART.line(scenery,center+points[i]+Vector3(0,0,.025),center+points[(i+1)%4]+Vector3(0,0,.025),.065,GOLD)
	ART.rock(scenery,center+Vector3(0,0,.055),Vector3(.22,.22,.08),"f4d998")
	# Paired angled inlays read as a bounce, without prescribing a false fixed trajectory.
	for side in [-1,1]:
		var inner=center+Vector3(side*.97,0,.025)
		var outer=center+Vector3(side*1.6,-.4,.025)
		ART.line(scenery,outer,inner,.055,GOLD)
		ART.line(scenery,inner,inner+Vector3(side*.03,-.22,0),.045,GOLD)
		for x in [2.3,3.4]:
			var pin=ART.cyl(scenery,Vector3(side*x,.38,-3.855),.055,.032,GOLD)
			pin.rotation.x=PI/2

func _target_trim():
	if not is_instance_valid(challenge.target):return
	target_art=Node3D.new();target_art.name="BankshotTargetRim";challenge.target.add_child(target_art)
	# No inner disk: the challenge's actual target remains visible and authoritative.
	_ring(target_art,Vector3(0,0,.19),.78,.84,GOLD)
	_ring(target_art,Vector3(0,0,.17),.85,.89,INK)
	for i in range(4):
		var angle=float(i)*PI/2
		var tip=Vector3(cos(angle),sin(angle),0)*.96+Vector3(0,0,.18)
		var diamond=ART.box(target_art,tip,Vector3(.13,.13,.04),"b4dbcd");diamond.rotation.z=PI/4
	_bake(target_art)

func _medal():
	if not is_instance_valid(challenge.medal):return
	medal_art=Node3D.new();medal_art.name="BankshotMedallionDetail";challenge.medal.add_child(medal_art)
	# Inspection-sized double-faced enamel medallion with two cloth ribbons.
	for side in [-1,1]:
		var ribbon=ART.box(medal_art,Vector3(side*.12,-.28,-.02),Vector3(.13,.36,.035),"649b8f");ribbon.rotation.z=side*.2
	var disk=ART.cyl(medal_art,Vector3.ZERO,.29,.075,GOLD);disk.rotation.x=PI/2
	var face=ART.cyl(medal_art,Vector3(0,0,.045),.235,.025,INK);face.rotation.x=PI/2
	_ring(medal_art,Vector3(0,0,.063),.247,.271,"f4d998")
	for sign_value in [-1,1]:
		var a=Vector3(-.14,-.08,sign_value*.085)
		var b=Vector3(0,.12,sign_value*.085)
		var c=Vector3(.14,-.08,sign_value*.085)
		ART.line(medal_art,a,b,.033,GOLD);ART.line(medal_art,b,c,.033,GOLD)
	_bake(medal_art)

func _ring(parent:Node3D,point:Vector3,inner:float,outer:float,color:String):
	var ring=MeshInstance3D.new();parent.add_child(ring)
	var torus=TorusMesh.new();torus.inner_radius=inner;torus.outer_radius=outer;torus.rings=20;torus.ring_segments=4
	ring.mesh=torus;ring.material_override=ART.mat(color);ring.position=point;ring.rotation.x=PI/2

func tick(delta:float):
	clock+=maxf(delta,0)
	if is_instance_valid(medal_art):medal_art.rotation.y=sin(clock*.65)*.15

func debug_snapshot()->Dictionary:
	var batches=scenery.get_child_count() if is_instance_valid(scenery) else 0
	var target_meshes=target_art.get_child_count() if is_instance_valid(target_art) else 0
	var medal_meshes=medal_art.get_child_count() if is_instance_valid(medal_art) else 0
	return {"source_parts":source_parts,"static_batches":batches,"render_meshes":batches+target_meshes+medal_meshes,"lights":0,"collisions":0}
